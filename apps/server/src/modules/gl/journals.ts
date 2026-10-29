import { sql } from 'kysely';
import { d, round2, validateJournal, voucherNoPattern, type JournalLineInput } from '@buddy/core';
import type { Db } from '../../db.js';
import { AppError, badRequest, notFound } from '../../http.js';
import { logActivity } from '../../audit.js';

export interface JournalInput {
  journal_book_id: string;
  voucher_date: string;
  voucher_no?: string | null;
  description?: string | null;
  reference?: string | null;
  branch_id?: string | null;
  lines: Array<JournalLineInput & { line_no?: number }>;
}

export async function periodFor(db: Db, companyId: string, date: string) {
  const p = await db.selectFrom('gl_period as p').innerJoin('gl_fiscal_year as y', 'y.id', 'p.fiscal_year_id')
    .select(['p.id', 'p.period_no', 'p.is_locked', 'p.start_date', 'p.end_date', 'y.code as year_code'])
    .where('p.company_id', '=', companyId).where('p.deleted_at', 'is', null)
    .where('p.start_date', '<=', date).where('p.end_date', '>=', date)
    .orderBy('p.period_no').executeTakeFirst();
  if (!p) throw new AppError(400, 'NO_PERIOD', 'วันที่ไม่อยู่ในรอบบัญชี (Message# 71) — กำหนดรอบบัญชีปีนี้ก่อนที่เมนู เริ่มระบบ › รอบบัญชี');
  if (p.is_locked) throw new AppError(400, 'PERIOD_LOCKED', `วันที่อยู่ในงวดที่ปิดแล้ว (Message# 1021) — งวดที่ ${p.period_no} ปี ${p.year_code}`);
  return p;
}

/**
 * ออกเลขที่ใบสำคัญอัตโนมัติตามค่าเริ่มต้น gl.voucher_numbering (คู่มือบทที่ 5 S-SET-10 ข้อ 2):
 * ตัวนำเลขที่ของสมุด + 1 YMMDDxx / 2 YMMxxxx / 3 YYMMxxxx / 4 YYMMDDxxx เช่น JV520101001 · 0 = ป้อนเลขเอง (คืนค่าว่าง)
 */
export async function nextVoucherNo(db: Db, companyId: string, bookId: string, date: string, style = '4') {
  const book = await db.selectFrom('gl_journal_book').select(['prefix']).where('id', '=', bookId).where('company_id', '=', companyId).executeTakeFirst();
  if (!book) throw notFound('สมุดรายวัน');
  const co = await db.selectFrom('sys_company').select('year_system').where('id', '=', companyId).executeTakeFirst();
  const pat = voucherNoPattern(style, book.prefix, date, (co?.year_system as 'B' | 'C') ?? 'B');
  if (!pat) return '';
  const last = await db.selectFrom('gl_journal').select('voucher_no')
    .where('company_id', '=', companyId).where('voucher_no', 'like', `${pat.base}%`)
    .where(sql<boolean>`length(voucher_no) = ${pat.base.length + pat.width}`)
    .orderBy('voucher_no', 'desc').limit(1).executeTakeFirst();
  const n = last ? Number(last.voucher_no.slice(pat.base.length)) + 1 : 1;
  if (String(n).length > pat.width) throw badRequest(`เลขที่ใบสำคัญของช่วงนี้เต็มแล้ว (${pat.base}${'9'.repeat(pat.width)}) — เปลี่ยนลำดับเลขที่ที่ เริ่มระบบ › ค่าเริ่มต้นแต่ละระบบ › ระบบบัญชี`);
  return pat.base + String(n).padStart(pat.width, '0');
}

async function checkLines(db: Db, companyId: string, lines: JournalInput['lines']) {
  const ids = [...new Set(lines.map((l) => l.account_id).filter((x): x is string => !!x))];
  const accts = ids.length ? await db.selectFrom('gl_account').select(['id', 'account_no', 'is_control', 'status', 'use_department'])
    .where('company_id', '=', companyId).where('id', 'in', ids).where('deleted_at', 'is', null).execute() : [];
  const byId = new Map(accts.map((a) => [a.id, a]));
  const issues = validateJournal(lines, {
    isPostable: (id) => {
      const a = byId.get(id);
      if (!a) return 'ไม่พบบัญชีนี้ในผังบัญชี';
      if (a.is_control) return `บัญชี ${a.account_no} เป็นบัญชีคุม ลงรายการไม่ได้ ให้ใช้บัญชีย่อย`;
      if (a.status !== 'A') return `บัญชี ${a.account_no} เลิกใช้แล้ว`;
      return true;
    },
  });
  lines.forEach((l, i) => {
    const a = l.account_id ? byId.get(l.account_id) : undefined;
    if (a?.use_department && !l.department_id) issues.push({ line: i, field: 'department_id', message: `บรรทัดที่ ${i + 1}: บัญชี ${a.account_no} ต้องระบุแผนก` });
  });
  const depts = [...new Set(lines.map((l) => l.department_id).filter((x): x is string => !!x))];
  if (depts.length) {
    const ok = await db.selectFrom('md_department').select('id').where('company_id', '=', companyId).where('id', 'in', depts).execute();
    if (ok.length !== depts.length) issues.push({ message: 'มีแผนกที่ไม่พบในระบบ' });
  }
  if (issues.length) throw badRequest(issues[0]!.message, issues);
}

const usedLines = (lines: JournalInput['lines']) => lines.filter((l) => l.account_id || !d(l.debit).isZero() || !d(l.credit).isZero());

/** sourceModule: ใบสำคัญที่ระบบอื่นสร้าง (เช่น BK ผ่านเช็ค) แก้จากหน้าบัญชีไม่ได้ · เรียกใน transaction ของผู้เรียกได้ (ลงบัญชีพร้อมเอกสาร) */
export async function createJournal(db: Db, ctx: { companyId: string; userId: string; branchId: string | null }, input: JournalInput, style = '4', opt: { sourceModule?: string } = {}) {
  const lines = usedLines(input.lines);
  const inTx = <T>(f: (tx: Db) => Promise<T>) => (db.isTransaction ? f(db) : db.transaction().execute(f));
  return inTx(async (tx) => {
    const p = await periodFor(tx, ctx.companyId, input.voucher_date);
    await checkLines(tx, ctx.companyId, lines);
    const book = await tx.selectFrom('gl_journal_book').select('id').where('id', '=', input.journal_book_id).where('company_id', '=', ctx.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!book) throw badRequest('ไม่พบสมุดรายวันที่เลือก');
    const voucherNo = input.voucher_no?.trim() || (await nextVoucherNo(tx, ctx.companyId, input.journal_book_id, input.voucher_date, style));
    if (!voucherNo) throw badRequest('ป้อนเลขที่ใบสำคัญ (บริษัทนี้ตั้งลำดับเลขที่เป็น "ป้อนเลขเอง")', [{ field: 'voucher_no', message: 'ป้อนเลขที่ใบสำคัญ' }]);
    const dup = await tx.selectFrom('gl_journal').select('id').where('company_id', '=', ctx.companyId).where('voucher_no', '=', voucherNo).where('deleted_at', 'is', null).executeTakeFirst();
    if (dup) throw badRequest(`เลขที่ใบสำคัญ ${voucherNo} มีอยู่แล้ว`);
    const totalD = round2(lines.reduce((s, l) => s.plus(d(l.debit)), d(0)));
    const j = await tx.insertInto('gl_journal').values({
      company_id: ctx.companyId, branch_id: input.branch_id ?? ctx.branchId, journal_book_id: input.journal_book_id, voucher_no: voucherNo,
      voucher_date: input.voucher_date, period_id: p.id, description: input.description ?? null, reference: input.reference ?? null,
      source_module: opt.sourceModule ?? 'GL', status: 'P', doc_status: 'N', posted_by: ctx.userId, posted_at: sql`now()` as never,
      total_debit: totalD.toFixed(2), total_credit: totalD.toFixed(2), created_by: ctx.userId, updated_by: ctx.userId,
    }).returning(['id', 'voucher_no']).executeTakeFirstOrThrow();
    await insertLines(tx, ctx.companyId, j.id, lines, ctx.userId);
    await logActivity(tx, ctx, { module: 'GL', action: 'ADD', docNo: j.voucher_no, table: 'gl_journal', rowId: j.id });
    return j;
  });
}

async function insertLines(tx: Db, companyId: string, journalId: string, lines: JournalInput['lines'], userId: string) {
  let n = 0;
  for (const l of lines) {
    n++;
    await tx.insertInto('gl_journal_line').values({
      company_id: companyId, journal_id: journalId, line_no: n, account_id: l.account_id!, department_id: l.department_id ?? null,
      description: l.description ?? null, debit: round2(l.debit).toFixed(2), credit: round2(l.credit).toFixed(2), created_by: userId,
    }).execute();
  }
}

async function loadEditable(tx: Db, companyId: string, id: string) {
  const j = await tx.selectFrom('gl_journal').selectAll().where('id', '=', id).where('company_id', '=', companyId).where('deleted_at', 'is', null).executeTakeFirst();
  if (!j) throw notFound('ใบสำคัญ');
  if (j.doc_status === 'C') throw badRequest('ใบสำคัญนี้ถูกยกเลิกแล้ว');
  if (j.source_header_id || (j.source_module && j.source_module !== 'GL')) throw badRequest('ใบสำคัญนี้มาจากเอกสารของระบบอื่น — ให้แก้ที่เอกสารต้นทาง');
  await periodFor(tx, companyId, j.voucher_date);
  return j;
}

export async function updateJournal(db: Db, ctx: { companyId: string; userId: string; branchId: string | null }, id: string, input: JournalInput) {
  const lines = usedLines(input.lines);
  return db.transaction().execute(async (tx) => {
    const j = await loadEditable(tx, ctx.companyId, id);
    const p = await periodFor(tx, ctx.companyId, input.voucher_date);
    await checkLines(tx, ctx.companyId, lines);
    const before = await tx.selectFrom('gl_journal_line').select(['account_id', 'department_id', 'description', 'debit', 'credit']).where('journal_id', '=', id).orderBy('line_no').execute();
    const totalD = round2(lines.reduce((s, l) => s.plus(d(l.debit)), d(0)));
    await tx.deleteFrom('gl_journal_line').where('journal_id', '=', id).execute();
    await insertLines(tx, ctx.companyId, id, lines, ctx.userId);
    await tx.updateTable('gl_journal').set({
      journal_book_id: input.journal_book_id, voucher_date: input.voucher_date, period_id: p.id, description: input.description ?? null,
      reference: input.reference ?? null, total_debit: totalD.toFixed(2), total_credit: totalD.toFixed(2), updated_by: ctx.userId,
    }).where('id', '=', id).execute();
    await logActivity(tx, ctx, { module: 'GL', action: 'EDIT', docNo: j.voucher_no, table: 'gl_journal', rowId: id, detail: { before: { date: j.voucher_date, description: j.description, lines: before } } });
    return { id, voucher_no: j.voucher_no };
  });
}

export async function cancelJournal(db: Db, ctx: { companyId: string; userId: string }, id: string, reason: string) {
  return db.transaction().execute(async (tx) => {
    const j = await loadEditable(tx, ctx.companyId, id);
    await tx.updateTable('gl_journal').set({ doc_status: 'C', updated_by: ctx.userId }).where('id', '=', id).execute();
    await logActivity(tx, ctx, { module: 'GL', action: 'CANCEL', docNo: j.voucher_no, table: 'gl_journal', rowId: id, detail: { reason } });
    return { id, voucher_no: j.voucher_no };
  });
}

export async function getJournal(db: Db, companyId: string, id: string) {
  const j = await db.selectFrom('gl_journal as j').innerJoin('gl_journal_book as b', 'b.id', 'j.journal_book_id')
    .leftJoin('doc_header as h', 'h.id', 'j.source_header_id')
    .leftJoin('sys_user as u', 'u.id', 'j.created_by')
    .select(['j.id', 'j.voucher_no', 'j.voucher_date', 'j.description', 'j.reference', 'j.journal_book_id', 'j.branch_id', 'j.source_module', 'j.source_header_id',
      'j.status', 'j.doc_status', 'j.total_debit', 'j.total_credit', 'j.created_at', 'j.updated_at', 'j.print_count', 'b.code as book_code', 'b.name_th as book_name',
      'h.doc_no as source_doc_no', 'h.doc_class as source_doc_class', 'u.display_name as created_by_name'])
    .where('j.id', '=', id).where('j.company_id', '=', companyId).executeTakeFirst();
  if (!j) throw notFound('ใบสำคัญ');
  const lines = await db.selectFrom('gl_journal_line as l').innerJoin('gl_account as a', 'a.id', 'l.account_id').leftJoin('md_department as dp', 'dp.id', 'l.department_id')
    .select(['l.id', 'l.line_no', 'l.account_id', 'a.account_no', 'a.name_th as account_name', 'l.department_id', 'dp.code as department_code', 'l.description', 'l.debit', 'l.credit', 'l.posting_role', 'l.resolved_from'])
    .where('l.journal_id', '=', id).where('l.deleted_at', 'is', null).orderBy('l.line_no').execute();
  const editable = j.doc_status === 'N' && !j.source_header_id && (!j.source_module || j.source_module === 'GL');
  return { ...j, lines, editable };
}
