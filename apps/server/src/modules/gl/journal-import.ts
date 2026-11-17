import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { d, formatDate, JOURNAL_IMPORT_COLUMNS, mapJournalImport, ZERO, type ImportIssue, type JournalImportVoucher, type YearSystem } from '@buddy/core';
import type { Db } from '../../db.js';
import { AppError, badRequest, forbidden, parse, requireCompany } from '../../http.js';
import { logActivity } from '../../audit.js';
import { companySettings } from '../../company-template.js';
import { buildXlsx } from '../../xlsx.js';
import { allowedFor } from '../permissions.js';
import { readTable } from '../trade-import.js';
import { branchOf } from '../docs/payments.js';
import { createJournal } from './journals.js';

/**
 * นำเข้าใบสำคัญจาก Excel (เจ้าของ 17/11/2569 ขั้นที่ 1) — ลงบัญชีด้วย createJournal เดียวกับหน้าจอสมุดรายวัน
 * ตรวจ (commit=false): หารหัสทั้งแฟ้ม แล้วลองบันทึกทุกใบใน SAVEPOINT แล้วถอยกลับ · บันทึก (commit=true): ทุกใบในทรานแซกชันเดียว ผิดใบเดียวไม่บันทึกเลย
 * ทุกใบบันทึก sys_activity_log (ADD จาก createJournal) + IMPORT สรุปแฟ้ม · ทุก query กรอง company_id จาก session
 * แยกเป็นฟังก์ชัน importJournals ให้ MCP/API เรียกซ้ำได้ (ขั้นที่ 2)
 */
/** บริบทผู้ใช้จาก session (บริษัท ผู้ใช้ สาขา) — แบบเดียวกับที่ branchOf/createJournal ใช้ */
type Ctx = Parameters<typeof branchOf>[1];
export type JournalImportResult = { group: string; book: string; row: number; date: string; ref: string | null; description: string | null; lines: number; debit: string; voucher_no: string | null };

export async function importJournals(db: Db, a: Ctx, vouchers: JournalImportVoucher[], parseErrors: ImportIssue[], commit: boolean) {
  const issues: ImportIssue[] = [...parseErrors];
  const up = (xs: Array<string | null>) => [...new Set(xs.filter((x): x is string => !!x).map((x) => x.toUpperCase()))];
  const books = await db.selectFrom('gl_journal_book').select(['id', 'code', 'prefix', 'name_th']).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).execute();
  const bookBy = new Map<string, (typeof books)[number]>();
  for (const b of books) { if (b.code) bookBy.set(b.code.toUpperCase(), b); }
  for (const b of books) { if (b.prefix?.trim()) bookBy.set(b.prefix.trim().toUpperCase(), b); }   // ตัวนำหน้า (PV) มาก่อนรหัส (01)
  const accNos = up(vouchers.flatMap((v) => v.lines.map((l) => l.account))), deptCodes = up(vouchers.flatMap((v) => v.lines.map((l) => l.department))), jobCodes = up(vouchers.flatMap((v) => v.lines.map((l) => l.job)));
  const accts = accNos.length ? (await sql<{ id: string; account_no: string }>`SELECT id, account_no FROM gl_account WHERE company_id = ${a.companyId} AND deleted_at IS NULL AND upper(account_no) = ANY(${accNos}::text[])`.execute(db)).rows : [];
  const depts = deptCodes.length ? (await sql<{ id: string; code: string }>`SELECT id, code FROM md_department WHERE company_id = ${a.companyId} AND deleted_at IS NULL AND upper(code) = ANY(${deptCodes}::text[])`.execute(db)).rows : [];
  const jobs = jobCodes.length ? (await sql<{ id: string; code: string }>`SELECT id, code FROM md_project WHERE company_id = ${a.companyId} AND deleted_at IS NULL AND upper(code) = ANY(${jobCodes}::text[])`.execute(db)).rows : [];
  const accBy = new Map(accts.map((x) => [x.account_no.toUpperCase(), x.id])), deptBy = new Map(depts.map((x) => [x.code.toUpperCase(), x.id])), jobBy = new Map(jobs.map((x) => [x.code.toUpperCase(), x.id]));
  // นำเข้าซ้ำ: อ้างอิงเดิมในสมุดเดิม ที่ยังไม่ยกเลิก
  const refs = [...new Set(vouchers.map((v) => v.ref).filter((x): x is string => !!x))];
  const prior = refs.length ? (await sql<{ reference: string; journal_book_id: string; voucher_no: string }>`SELECT reference, journal_book_id, voucher_no FROM gl_journal
      WHERE company_id = ${a.companyId} AND doc_status <> 'C' AND deleted_at IS NULL AND reference = ANY(${refs}::text[])`.execute(db)).rows : [];
  const style = String((await companySettings(db, a.companyId))['gl.voucher_numbering'] ?? '4');
  const branchId = await branchOf(db, a, null);

  const ready: Array<{ v: JournalImportVoucher; input: Parameters<typeof createJournal>[2] }> = [];
  const seenRef = new Map<string, number>();
  // แถวที่ผิดรูปแบบแล้ว (เช่น ไม่ดุล) ไม่ต้องลองบันทึกซ้ำ — แจ้งข้อผิดพลาดครั้งเดียว
  const badRows = new Set(parseErrors.map((e) => e.row));
  for (const v of vouchers) {
    if (badRows.has(v.row) || v.lines.some((l) => badRows.has(l.row))) continue;
    const n0 = issues.length;
    const tag = `${v.book} กลุ่ม ${v.group}`;
    const book = bookBy.get(v.book.toUpperCase());
    if (!book) issues.push({ row: v.row, message: `${tag}: ไม่พบสมุดรายวัน "${v.book}" — ใช้ตัวนำหน้าหรือรหัสสมุด (${books.map((b) => b.prefix || b.code).join(' ')})` });
    if (book && v.ref) {
      const dup = prior.find((x) => x.reference === v.ref && x.journal_book_id === book.id);
      if (dup) issues.push({ row: v.row, message: `${tag}: อ้างอิง ${v.ref} เคยนำเข้าแล้วเป็น ${dup.voucher_no} — ลบกลุ่มนี้ออก หรือยกเลิก ${dup.voucher_no} ก่อน` });
      const k = `${book.id}|${v.ref}`;
      if (seenRef.has(k)) issues.push({ row: v.row, message: `${tag}: อ้างอิง ${v.ref} ซ้ำกับกลุ่มอื่นในแฟ้มเดียวกัน (แถว ${seenRef.get(k)})` });
      else seenRef.set(k, v.row);
    }
    const lines = v.lines.map((l) => {
      const acc = accBy.get(l.account.toUpperCase());
      if (!acc) issues.push({ row: l.row, message: `ไม่พบเลขที่บัญชี ${l.account} ในผังบัญชี` });
      const dep = l.department ? deptBy.get(l.department.toUpperCase()) : null;
      if (l.department && !dep) issues.push({ row: l.row, message: `ไม่พบแผนก ${l.department}` });
      const job = l.job ? jobBy.get(l.job.toUpperCase()) : null;
      if (l.job && !job) issues.push({ row: l.row, message: `ไม่พบ Job ${l.job}` });
      // คำอธิบายรายการว่าง = คำอธิบายของใบสำคัญ (เจ้าของ 17/11/2569 — แสดงในบัญชีแยกประเภท)
      return { account_id: acc ?? null, department_id: dep ?? null, project_id: job ?? null, description: l.description ?? v.description, debit: l.debit, credit: l.credit };
    });
    if (issues.length > n0 || !book) continue;
    ready.push({ v, input: { journal_book_id: book.id, voucher_date: v.date, voucher_no: style === '0' ? v.group : null, branch_id: branchId, description: v.description, reference: v.ref, lines } });
  }
  if (commit && issues.length) throw badRequest(`นำเข้าไม่ได้ — มีข้อผิดพลาด ${issues.length} รายการ กด "ตรวจแฟ้ม" ดูรายละเอียดแล้วแก้แฟ้ม`, issues.slice(0, 200).map((x) => ({ field: `row:${x.row}`, message: x.message })));

  // ลองบันทึกทีละใบใน SAVEPOINT — ตรวจ: ถอยทุกใบ · บันทึก: เก็บไว้ (ผิดใบใดโยนข้อผิดพลาด ทั้งแฟ้มไม่บันทึก)
  const results: JournalImportResult[] = [];
  for (const x of ready) {
    await sql`SAVEPOINT journal_import`.execute(db);
    try {
      const j = await createJournal(db, a, x.input, style);
      results.push({ group: x.v.group, book: x.v.book, row: x.v.row, date: x.v.date, ref: x.v.ref, description: x.v.description, lines: x.v.lines.length, debit: x.v.debit, voucher_no: commit ? j.voucher_no : null });
      await sql.raw(commit ? 'RELEASE SAVEPOINT journal_import' : 'ROLLBACK TO SAVEPOINT journal_import').execute(db);
    } catch (e) {
      await sql`ROLLBACK TO SAVEPOINT journal_import`.execute(db);
      if (!(e instanceof AppError)) throw e;
      issues.push({ row: x.v.row, message: `${x.v.book} กลุ่ม ${x.v.group}: ${e.message}` });
    }
  }
  if (commit && issues.length) throw badRequest(`นำเข้าไม่ได้ — ${issues[0]!.message} (แถว ${issues[0]!.row})`, issues.slice(0, 200).map((x) => ({ field: `row:${x.row}`, message: x.message })));
  issues.sort((p, q) => p.row - q.row);
  return { ok: !issues.length, committed: commit, vouchers: results, errors: issues, total_debit: results.reduce((t, r) => t.plus(d(r.debit)), ZERO).toFixed(2) };
}

const MAX_FILE = 10 * 1024 * 1024;
const importBody = z.object({
  file_name: z.string().trim().min(1).max(200), data: z.string().min(1, 'เลือกแฟ้ม').max(Math.ceil(MAX_FILE * 1.4) + 200, 'แฟ้มใหญ่เกิน 10 MB'), commit: z.boolean().default(false),
});

export function journalImportRoutes(app: FastifyInstance, db: Db) {
  /** แฟ้มตัวอย่าง: แผ่น "นำเข้า" (หัวคอลัมน์ + ตัวอย่าง 2 ใบ ใช้บัญชี/สมุดจริงของบริษัท) + แผ่น "คำอธิบาย" */
  app.get('/api/v1/gl/journal-import/template', async (req, reply) => {
    const a = requireCompany(req);
    const co = await db.selectFrom('sys_company').select('year_system').where('id', '=', a.companyId).executeTakeFirstOrThrow();
    const books = await db.selectFrom('gl_journal_book').select(['code', 'prefix']).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).orderBy('code').execute();
    const bk = (p: string, i: number) => books.find((b) => b.prefix?.trim().toUpperCase() === p)?.prefix?.trim() ?? (books[i]?.prefix?.trim() || books[i]?.code || p);
    const acc = async (grp: string) => (await db.selectFrom('gl_account').select('account_no').where('company_id', '=', a.companyId).where('deleted_at', 'is', null).where('is_control', '=', false).where('status', '=', 'A')
      .where('account_no', 'like', `${grp}%`).orderBy('account_no').executeTakeFirst())?.account_no ?? '';
    const [exp, cash, accr] = [await acc('5'), await acc('111'), await acc('21')];
    const date = formatDate(new Date().toISOString().slice(0, 10), co.year_system as YearSystem);
    const cols = JOURNAL_IMPORT_COLUMNS;
    const sample: Array<Record<string, string>> = [
      { book: bk('PV', 1), group: '1', date, ref: 'INV-6901', description: 'จ่ายค่าไฟฟ้าเดือนตุลาคม', account: exp, line_description: 'ค่าไฟฟ้าสำนักงาน', debit: '1500', credit: '' },
      { book: bk('PV', 1), group: '1', date, ref: '', description: '', account: cash, line_description: '', debit: '', credit: '1500' },
      { book: bk('JV', 0), group: '2', date, ref: 'ADJ-01', description: 'ปรับปรุงค่าใช้จ่ายค้างจ่าย', account: exp, line_description: '', debit: '800', credit: '' },
      { book: bk('JV', 0), group: '2', date, ref: '', description: '', account: accr || cash, line_description: '', debit: '', credit: '800' },
    ];
    const textCols = cols.map((c, i) => (['book', 'group', 'date', 'ref', 'account', 'department', 'job'].includes(c.key) ? i : -1)).filter((i) => i >= 0);
    const help = [['คอลัมน์', 'จำเป็น', 'คำอธิบาย'], ...cols.map((c) => [c.th, c.required ? 'ต้องมี' : '', c.hint]), ['', '', ''],
      ['', '', 'หนึ่งแถว = หนึ่งบรรทัดบัญชี · แถวที่สมุดและเลขที่กลุ่มเดียวกันรวมเป็นใบสำคัญใบเดียว (วันที่ อ้างอิง คำอธิบาย ใส่แถวแรกของกลุ่ม) · ทุกใบยอดเดบิต = เครดิต'],
      ['', '', 'กด "ตรวจแฟ้ม" ก่อน (ไม่บันทึก) แล้วจึง "นำเข้า" — ผิดใบเดียวไม่บันทึกเลย · ลบแถวตัวอย่างก่อนใช้ · ชื่อหัวคอลัมน์ห้ามแก้ (สลับลำดับได้) · บันทึกเป็น .xlsx หรือ .csv'],
      ['', '', `สมุดรายวันของบริษัทนี้: ${books.map((b) => b.prefix?.trim() || b.code).join(' ')}`]];
    reply.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('content-disposition', 'attachment; filename="import-journal.xlsx"');
    return buildXlsx([
      { name: 'นำเข้า', rows: [cols.map((c) => c.th), ...sample.map((s) => cols.map((c) => s[c.key] ?? ''))], textCols, widths: cols.map((c) => (c.key.includes('description') ? 30 : 13)) },
      { name: 'คำอธิบาย', rows: help, widths: [16, 9, 110] },
    ]);
  });

  app.post('/api/v1/gl/journal-import', async (req) => {
    const a = requireCompany(req);
    const b = parse(importBody, req.body);
    if (!(await allowedFor(db, a, 'GL.JNL', 'add')).allowed) throw forbidden('ไม่มีสิทธิ์เพิ่มใบสำคัญ — นำเข้าไม่ได้');
    const co = await db.selectFrom('sys_company').select('year_system').where('id', '=', a.companyId).executeTakeFirstOrThrow();
    const rows = readTable(b.file_name, Buffer.from(b.data.replace(/^data:[^,]*,/, ''), 'base64'));
    const { vouchers, errors } = mapJournalImport(rows, co.year_system as YearSystem);
    const r = await importJournals(db, a, vouchers, errors, b.commit);
    if (b.commit) await logActivity(db, a, { module: 'GL', action: 'IMPORT', docNo: r.vouchers[0]?.voucher_no ?? null, detail: { file: b.file_name, vouchers: r.vouchers.length, first: r.vouchers[0]?.voucher_no, last: r.vouchers.at(-1)?.voucher_no } });
    return { ...r, file_vouchers: vouchers.length };
  });
}
