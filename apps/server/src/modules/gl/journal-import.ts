import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { compareJournalSides, d, formatDate, JOURNAL_IMPORT_COLUMNS, JOURNAL_IMPORT_FORMAT_LABEL, JOURNAL_IMPORT_NEED_LABEL, JOURNAL_IMPORT_TAX_LABEL, journalImportHeader, journalImportKey, journalImportSide, mapJournalImport, ZERO,
  type ImportIssue, type JournalCompareSide, type JournalImportVoucher, type YearSystem, missingCodeRows } from '@buddy/core';
import type { Db } from '../../db.js';
import { AppError, badRequest, forbidden, parse, requireCompany } from '../../http.js';
import { logActivity } from '../../audit.js';
import { companySettings } from '../../company-template.js';
import { buildXlsx } from '../../xlsx.js';
import { allowedFor } from '../permissions.js';
import { readTable } from '../trade-import.js';
import { codesBody, mappingBody, transformTable } from '../import-map.js';
import { branchOf } from '../docs/payments.js';
import { createJournal, periodFor, updateJournal } from './journals.js';
import { addManualVat } from '../vat.js';
import { saveWht } from '../wht.js';

/**
 * นำเข้าใบสำคัญจาก Excel (เจ้าของ 17/11/2569 ขั้นที่ 1) — ลงบัญชีด้วย createJournal เดียวกับหน้าจอสมุดรายวัน
 * ตรวจ (commit=false): หารหัสทั้งแฟ้ม แล้วลองบันทึกทุกใบใน SAVEPOINT แล้วถอยกลับ · บันทึก (commit=true): ทุกใบในทรานแซกชันเดียว ผิดใบเดียวไม่บันทึกเลย
 * ทุกใบบันทึก sys_activity_log (ADD จาก createJournal) + IMPORT สรุปแฟ้ม · ทุก query กรอง company_id จาก session
 * แยกเป็นฟังก์ชัน importJournals ให้ MCP/API เรียกซ้ำได้ (ขั้นที่ 2)
 */
/** บริบทผู้ใช้จาก session (บริษัท ผู้ใช้ สาขา) — แบบเดียวกับที่ branchOf/createJournal ใช้ */
type Ctx = Parameters<typeof branchOf>[1];
/** ใบสำคัญซ้ำ (เจ้าของ 18/11/2569): ไม่นำเข้า (ค่าเริ่มต้น) · ทับเอกสารเดิม · สร้างเป็นเอกสารใหม่ */
export type JournalImportAction = 'skip' | 'overwrite' | 'new';
export type JournalImportMatch = {
  by: 'voucher_no' | 'ref'; voucher_no: string; doc_status: string; can_overwrite: boolean; why_not: string | null;
  file: JournalCompareSide; current: JournalCompareSide; diffs: string[];
};
export type JournalImportResult = {
  key: string; group: string; book: string; row: number; date: string; ref: string | null; description: string | null; lines: number; debit: string; credit: string; diff: string;
  voucher_no: string | null; taxes: number;
  /** ok = นำเข้าเป็นใบใหม่ · dup = ตรงกับใบที่มีอยู่ (ดู action/match) · error = ต้องแก้ · หลังนำเข้า: created / overwritten / skipped */
  status: 'ok' | 'dup' | 'error' | 'created' | 'overwritten' | 'skipped'; action: JournalImportAction | null; match: JournalImportMatch | null;
};
type Existing = { id: string; voucher_no: string; voucher_date: string; journal_book_id: string; reference: string | null; description: string | null; doc_status: string;
  source_header_id: string | null; source_module: string | null; source_system: string | null; total_debit: string };

export async function importJournals(db: Db, a: Ctx, vouchers: JournalImportVoucher[], parseErrors: ImportIssue[], commit: boolean,
  opt: { actions?: Record<string, JournalImportAction>; hasTax?: boolean } = {}) {
  const issues: ImportIssue[] = [...parseErrors];
  const actions = opt.actions ?? {};
  const up = (xs: Array<string | null>) => [...new Set(xs.filter((x): x is string => !!x).map((x) => x.toUpperCase()))];
  const books = await db.selectFrom('gl_journal_book').select(['id', 'code', 'prefix', 'name_th']).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).execute();
  const bookBy = new Map<string, (typeof books)[number]>();
  for (const b of books) { if (b.code) bookBy.set(b.code.toUpperCase(), b); }
  for (const b of books) { if (b.prefix?.trim()) bookBy.set(b.prefix.trim().toUpperCase(), b); }   // ตัวนำหน้า (PV) มาก่อนรหัส (01)
  const bookName = (id: string) => { const b = books.find((x) => x.id === id); return b?.prefix?.trim() || b?.code || ''; };
  const accNos = up(vouchers.flatMap((v) => v.lines.map((l) => l.account))), deptCodes = up(vouchers.flatMap((v) => v.lines.map((l) => l.department))), jobCodes = up(vouchers.flatMap((v) => v.lines.map((l) => l.job)));
  // เลขที่บัญชีที่ Excel/OCR ทำขีดหาย (111101 แทน 1111-01): เทียบเฉพาะตัวเลข เมื่อตรงบัญชีเดียวเท่านั้น
  const digits = (s: string) => s.replace(/\D/g, '');
  const accDigits = [...new Set(accNos.map(digits).filter((x) => x.length >= 3))];
  const accts = accNos.length ? (await sql<{ id: string; account_no: string }>`SELECT id, account_no FROM gl_account WHERE company_id = ${a.companyId} AND deleted_at IS NULL
      AND (upper(account_no) = ANY(${accNos}::text[]) OR regexp_replace(account_no, '[^0-9]', '', 'g') = ANY(${accDigits}::text[]))`.execute(db)).rows : [];
  const depts = deptCodes.length ? (await sql<{ id: string; code: string }>`SELECT id, code FROM md_department WHERE company_id = ${a.companyId} AND deleted_at IS NULL AND upper(code) = ANY(${deptCodes}::text[])`.execute(db)).rows : [];
  const jobs = jobCodes.length ? (await sql<{ id: string; code: string }>`SELECT id, code FROM md_project WHERE company_id = ${a.companyId} AND deleted_at IS NULL AND upper(code) = ANY(${jobCodes}::text[])`.execute(db)).rows : [];
  const accBy = new Map(accts.map((x) => [x.account_no.toUpperCase(), x.id])), deptBy = new Map(depts.map((x) => [x.code.toUpperCase(), x.id])), jobBy = new Map(jobs.map((x) => [x.code.toUpperCase(), x.id]));
  const accOf = (no: string) => {
    const exact = accBy.get(no.toUpperCase());
    if (exact) return exact;
    const hit = accts.filter((x) => digits(x.account_no) === digits(no) && digits(no).length >= 3);
    return hit.length === 1 ? hit[0]!.id : null;
  };

  // ใบสำคัญที่มีอยู่ซึ่งตรงกับแฟ้ม: เลขที่ใบสำคัญเดียวกัน (ทุกสมุด รวมใบยกเลิก — ยังจองเลข) หรืออ้างอิงเดิมในสมุดเดิม (ใบที่ยังไม่ยกเลิก)
  const cols = ['id', 'voucher_no', 'voucher_date', 'journal_book_id', 'reference', 'description', 'doc_status', 'source_header_id', 'source_module', 'source_system', 'total_debit'] as const;
  const manualNos = [...new Set(vouchers.map((v) => v.voucher_no).filter((x): x is string => !!x))];
  const byNo = manualNos.length ? await db.selectFrom('gl_journal').select(cols).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).where('voucher_no', 'in', manualNos).execute() : [];
  const refs = [...new Set(vouchers.map((v) => v.ref).filter((x): x is string => !!x))];
  const byRef = refs.length ? await db.selectFrom('gl_journal').select(cols).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).where('doc_status', '<>', 'C').where('reference', 'in', refs).execute() : [];
  const style = String((await companySettings(db, a.companyId))['gl.voucher_numbering'] ?? '4');
  const branchId = await branchOf(db, a, null);

  type Op = { v: JournalImportVoucher; r: JournalImportResult; input: Parameters<typeof createJournal>[2]; overwrite: string | null };
  const ops: Op[] = [];
  const results: JournalImportResult[] = [];
  const seenRef = new Map<string, number>();
  // แถวที่ผิดรูปแบบแล้ว (เช่น ไม่ดุล) ไม่ต้องลองบันทึกซ้ำ — แจ้งข้อผิดพลาดครั้งเดียว
  const badRows = new Set(parseErrors.map((e) => e.row));
  const found: Array<{ v: JournalImportVoucher; r: JournalImportResult; e: Existing; by: 'voucher_no' | 'ref'; bookId: string }> = [];
  for (const v of vouchers) {
    const D = d(v.debit), C = d(v.credit);
    const r: JournalImportResult = { key: journalImportKey(v), group: v.group, book: v.book, row: v.row, date: v.date, ref: v.ref, description: v.description, lines: v.lines.length,
      debit: v.debit, credit: v.credit, diff: D.minus(C).toFixed(2), voucher_no: v.voucher_no, taxes: v.lines.filter((l) => l.tax).length, status: 'ok', action: null, match: null };
    results.push(r);
    if (v.invalid || badRows.has(v.row) || v.lines.some((l) => badRows.has(l.row))) { r.status = 'error'; continue; }
    const n0 = issues.length;
    const tag = `${v.book} กลุ่ม ${v.group}`;
    const book = bookBy.get(v.book.toUpperCase());
    if (!book) issues.push({ row: v.row, message: `${tag}: ไม่พบสมุดรายวัน "${v.book}" — ใช้ตัวนำหน้าหรือรหัสสมุด (${books.map((b) => b.prefix || b.code).join(' ')})` });
    if (book && v.voucher_no) {
      // ตัวนำหน้าของสมุด = ตัวเดียวกับที่ nextVoucherNo ใช้ออกเลขอัตโนมัติ (สมุด PV → PV…)
      const pre = book.prefix?.trim().toUpperCase() ?? '';
      if (pre && (!v.voucher_no.startsWith(pre) || v.voucher_no.length <= pre.length))
        issues.push({ row: v.row, message: `${tag}: เลขที่ใบสำคัญ ${v.voucher_no} ต้องขึ้นต้นด้วย ${pre} (ตัวนำหน้าของสมุด ${v.book}) แล้วตามด้วยเลขที่ เช่น ${pre}0000001 — หรือเว้นว่างให้ระบบออกเลข` });
    }
    if (book && v.ref) {
      const k = `${book.id}|${v.ref}`;
      if (seenRef.has(k)) issues.push({ row: v.row, message: `${tag}: อ้างอิง ${v.ref} ซ้ำกับกลุ่มอื่นในแฟ้มเดียวกัน (แถว ${seenRef.get(k)})` });
      else seenRef.set(k, v.row);
    }
    const lines = v.lines.map((l) => {
      const acc = accOf(l.account);
      if (!acc) issues.push({ row: l.row, message: `ไม่พบเลขที่บัญชี ${l.account} ในผังบัญชี — ตรวจเลขที่บัญชี (ถ้า Excel เปลี่ยนเป็นตัวเลข ให้ตั้งรูปแบบช่องเป็นข้อความแล้วพิมพ์ใหม่)` });
      const dep = l.department ? deptBy.get(l.department.toUpperCase()) : null;
      if (l.department && !dep) issues.push({ row: l.row, message: `ไม่พบแผนก ${l.department}` });
      const job = l.job ? jobBy.get(l.job.toUpperCase()) : null;
      if (l.job && !job) issues.push({ row: l.row, message: `ไม่พบ Job ${l.job}` });
      // คำอธิบายรายการว่าง = คำอธิบายของใบสำคัญ (เจ้าของ 17/11/2569 — แสดงในบัญชีแยกประเภท)
      return { account_id: acc ?? null, department_id: dep ?? null, project_id: job ?? null, description: l.description ?? v.description, debit: l.debit, credit: l.credit };
    });
    if (issues.length > n0 || !book) { r.status = 'error'; continue; }
    const input = { journal_book_id: book.id, voucher_date: v.date, voucher_no: v.voucher_no ?? (style === '0' ? v.group : null), branch_id: branchId, description: v.description, reference: v.ref, lines };
    const e = (v.voucher_no ? byNo.find((x) => x.voucher_no === v.voucher_no) : undefined) ?? (v.ref ? byRef.find((x) => x.reference === v.ref && x.journal_book_id === book.id) : undefined);
    ops.push({ v, r, input, overwrite: null });
    if (e) found.push({ v, r, e: e as unknown as Existing, by: e.voucher_no === v.voucher_no ? 'voucher_no' : 'ref', bookId: book.id });
  }

  // เปรียบเทียบกับใบที่มีอยู่ + ทับได้หรือไม่ (ตัวตรวจเดียวกับหน้าจอสมุดรายวัน · ไม่รับรหัสใบสำคัญจากหน้าจอ — หาเองจากแฟ้มในบริษัทของ session)
  if (found.length) {
    const ids = [...new Set(found.map((f) => f.e.id))];
    const lines = await db.selectFrom('gl_journal_line as l').innerJoin('gl_account as g', 'g.id', 'l.account_id').leftJoin('md_department as dp', 'dp.id', 'l.department_id').leftJoin('md_project as pj', 'pj.id', 'l.project_id')
      .select(['l.journal_id', 'g.account_no', 'l.description', 'dp.code as dept', 'pj.code as job', 'l.debit', 'l.credit']).where('l.company_id', '=', a.companyId).where('l.journal_id', 'in', ids).where('l.deleted_at', 'is', null).orderBy('l.journal_id').orderBy('l.line_no').execute();
    const vat = await db.selectFrom('tax_vat_entry').select(['journal_id', 'vat_kind', 'tax_invoice_no', 'tax_invoice_date', 'base_amount', 'vat_amount']).where('company_id', '=', a.companyId).where('journal_id', 'in', ids).where('is_manual', '=', true).where('doc_status', '=', 'N').where('deleted_at', 'is', null).execute();
    const wht = await db.selectFrom('tax_wht_entry').select(['journal_id', 'form_type', 'certificate_no', 'certificate_date', 'paid_amount', 'tax_amount']).where('company_id', '=', a.companyId).where('journal_id', 'in', ids).where('doc_status', '=', 'N').where('deleted_at', 'is', null).execute();
    const settled = new Set((await db.selectFrom('doc_settlement').select('payment_journal_id').where('company_id', '=', a.companyId).where('payment_journal_id', 'in', ids).where('deleted_at', 'is', null).execute()).map((x) => x.payment_journal_id));
    const cheque = new Set((await db.selectFrom('fin_cheque').select('source_journal_id').where('company_id', '=', a.companyId).where('source_journal_id', 'in', ids).where('deleted_at', 'is', null).execute()).map((x) => x.source_journal_id));
    const ymd = (x: unknown) => (x instanceof Date ? x.toISOString() : String(x ?? '')).slice(0, 10);
    for (const f of found) {
      const e = f.e, date = ymd(e.voucher_date);
      const current: JournalCompareSide = {
        voucher_no: e.voucher_no, book: bookName(e.journal_book_id), date, ref: e.reference ?? '', description: e.description ?? '', debit: d(e.total_debit).toFixed(2),
        lines: lines.filter((l) => l.journal_id === e.id).map((l) => ({ account: l.account_no, description: l.description ?? e.description ?? '', department: l.dept ?? '', job: l.job ?? '', debit: d(l.debit).toFixed(2), credit: d(l.credit).toFixed(2) })),
        taxes: [...vat.filter((t) => t.journal_id === e.id).map((t) => ({ kind: t.vat_kind, no: t.tax_invoice_no ?? '', date: ymd(t.tax_invoice_date), base: d(t.base_amount).toFixed(2), amount: d(t.vat_amount).toFixed(2) })),
          ...wht.filter((t) => t.journal_id === e.id).map((t) => ({ kind: t.form_type, no: t.certificate_no ?? '', date: ymd(t.certificate_date), base: d(t.paid_amount).toFixed(2), amount: d(t.tax_amount).toFixed(2) }))],
      };
      const file = { ...journalImportSide(f.v), book: bookName(f.bookId) };
      let why: string | null = null;
      if (e.doc_status === 'C') why = `ใบ ${e.voucher_no} ยกเลิกแล้ว — ลบใบนั้นที่หน้าสมุดรายวันก่อน หรือเลือก "สร้างเป็นเอกสารใหม่"`;
      else if (e.source_header_id || (e.source_module && e.source_module !== 'GL') || e.source_system) why = `ใบ ${e.voucher_no} มาจากเอกสาร/ระบบอื่น — แก้ที่เอกสารต้นทาง`;
      else if (e.journal_book_id !== f.bookId) why = `ใบ ${e.voucher_no} อยู่ในสมุด ${bookName(e.journal_book_id)} ไม่ใช่สมุด ${f.v.book} — แก้สมุดในแฟ้ม หรือเลือก "สร้างเป็นเอกสารใหม่"`;
      else if (settled.has(e.id)) why = `ใบ ${e.voucher_no} ใช้รับ/จ่ายชำระเอกสารอยู่ — ยกเลิกการรับ/จ่ายชำระก่อน`;
      else if (cheque.has(e.id)) why = `ใบ ${e.voucher_no} มีเช็คที่ป้อนจากใบนี้ — แก้ที่หน้าสมุดรายวัน`;
      else { try { await periodFor(db, a.companyId, date); } catch (x) { if (!(x instanceof AppError)) throw x; why = `ใบ ${e.voucher_no}: ${x.message}`; } }
      const act: JournalImportAction = actions[f.r.key] ?? 'skip';
      f.r.match = { by: f.by, voucher_no: e.voucher_no, doc_status: e.doc_status, can_overwrite: !why, why_not: why, file, current, diffs: compareJournalSides(file, current, !!opt.hasTax) };
      f.r.status = 'dup'; f.r.action = act;
      const op = ops.find((o) => o.v === f.v)!;
      const tag = `${f.v.book} กลุ่ม ${f.v.group}`;
      if (act === 'overwrite') {
        const twice = found.find((g) => g !== f && g.e.id === e.id && g.r.action === 'overwrite');
        if (twice) { issues.push({ row: f.v.row, message: `${tag}: ใบ ${e.voucher_no} ถูกเลือกให้ทับจากหลายกลุ่มในแฟ้ม (แถว ${twice.v.row}) — เลือกทับได้กลุ่มเดียว` }); f.r.status = 'error'; }
        else if (why) { issues.push({ row: f.v.row, message: `${tag}: ทับเอกสารเดิมไม่ได้ — ${why}` }); f.r.status = 'error'; }
        else { op.overwrite = e.id; op.input.voucher_no = null; f.r.voucher_no = e.voucher_no; }
      } else if (act === 'new') {
        // เลขที่ซ้ำ → ระบบออกเลขใหม่ · ซ้ำเฉพาะอ้างอิง → ใช้เลขที่ในแฟ้มได้
        if (f.by === 'voucher_no' || (style === '0' && op.input.voucher_no === e.voucher_no)) {
          if (style === '0') { issues.push({ row: f.v.row, message: `${tag}: บริษัทนี้ตั้งให้ป้อนเลขที่เอง — ใส่เลขที่ใบสำคัญใหม่ในแฟ้มแทน "สร้างเป็นเอกสารใหม่"` }); f.r.status = 'error'; }
          else { op.input.voucher_no = null; f.r.voucher_no = null; }
        }
      }
    }
  }
  if (commit && issues.length) throw badRequest(`นำเข้าไม่ได้ — มีข้อผิดพลาด ${issues.length} รายการ กด "ตรวจแฟ้ม" ดูรายละเอียดแล้วแก้แฟ้ม`, issues.slice(0, 200).map((x) => ({ field: `row:${x.row}`, message: x.message })));

  // ใบที่จะทำจริง: ใบใหม่ + ใบซ้ำที่เลือกทับ/สร้างใหม่ (ไม่นำเข้า = ข้าม)
  const run = ops.filter((o) => o.r.status === 'ok' || (o.r.status === 'dup' && o.r.action !== 'skip'));
  // ใบที่กำหนดเลขเองบันทึกก่อน — เลขอัตโนมัติ (nextVoucherNo = เลขมากสุดของรูปแบบ + 1) จึงไม่ชนเลขที่นำเข้า
  const order = (o: Op) => (o.overwrite ? 1 : o.input.voucher_no ? 0 : 2);
  run.sort((p, q) => order(p) - order(q));
  // ตรวจ: ทำเหมือนบันทึกจริงทั้งแฟ้มใน SAVEPOINT แล้วถอยทั้งหมดตอนท้าย (ผลตรวจ = ผลบันทึก) · บันทึก: ผิดใบใดโยนข้อผิดพลาด ทั้งแฟ้มไม่บันทึก
  if (!commit) await sql`SAVEPOINT journal_import_check`.execute(db);
  for (const x of run) {
    await sql`SAVEPOINT journal_import`.execute(db);
    try {
      let jid: string, jno: string;
      if (x.overwrite) {
        // ทับเอกสารเดิม = แก้ใบสำคัญด้วย updateJournal เดียวกับหน้าจอ (ตรวจงวด/บัญชี/Job + log EDIT) · คงสาขาเดิม
        const u = await updateJournal(db, a, x.overwrite, { ...x.input, voucher_no: null, branch_id: null });
        jid = u.id; jno = u.voucher_no;
        // แฟ้มมีคอลัมน์ภาษี = รายการภาษีของใบนี้ตามแฟ้ม: ยกเลิกรายการภาษีที่ป้อนเองเดิม (สถานะ C เหมือนยกเลิกในแฟ้มภาษี) แล้วเพิ่มตามแฟ้ม
        if (opt.hasTax) await cancelJournalTaxes(db, a, jid);
      } else {
        const j = await createJournal(db, a, x.input, style);
        jid = j.id; jno = j.voucher_no;
      }
      if (!x.overwrite || opt.hasTax) await addTaxes(db, a, x, jid);
      x.r.voucher_no = commit || x.overwrite || x.r.voucher_no ? jno : null;
      if (commit) x.r.status = x.overwrite ? 'overwritten' : 'created';
      await sql`RELEASE SAVEPOINT journal_import`.execute(db);
    } catch (e) {
      await sql`ROLLBACK TO SAVEPOINT journal_import`.execute(db);
      if (!(e instanceof AppError)) throw e;
      x.r.status = 'error';
      issues.push({ row: x.v.row, message: `${x.v.book} กลุ่ม ${x.v.group}: ${e.message}` });
    }
  }
  if (!commit) { await sql`ROLLBACK TO SAVEPOINT journal_import_check`.execute(db); await sql`RELEASE SAVEPOINT journal_import_check`.execute(db); }
  if (commit && issues.length) throw badRequest(`นำเข้าไม่ได้ — ${issues[0]!.message} (แถว ${issues[0]!.row})`, issues.slice(0, 200).map((x) => ({ field: `row:${x.row}`, message: x.message })));
  if (commit) for (const r of results) if (r.status === 'dup') r.status = 'skipped';
  issues.sort((p, q) => p.row - q.row);
  const sum = (xs: JournalImportResult[], k: 'debit' | 'credit') => xs.reduce((t, r) => t.plus(d(r[k])), ZERO);
  const done = results.filter((r) => (commit ? r.status === 'created' || r.status === 'overwritten' : r.status === 'ok' || (r.status === 'dup' && r.action !== 'skip')));
  const td = sum(results, 'debit'), tc = sum(results, 'credit');
  return {
    ok: !issues.length, committed: commit, vouchers: results, errors: issues, total_debit: td.toFixed(2), total_credit: tc.toFixed(2), total_diff: td.minus(tc).toFixed(2),
    import_count: done.length, import_debit: sum(done, 'debit').toFixed(2), dup_count: results.filter((r) => r.match).length, has_tax: !!opt.hasTax,
  };
}

/** ภาษีของแถว (เจ้าของเลือก ก 18/11/2569) — ฟังก์ชันเดียวกับแท็บภาษีของใบสำคัญ ผูก journal_id (ยกเลิกใบสำคัญ = ยกเลิกรายการภาษี) */
async function addTaxes(db: Db, a: Ctx, x: { v: JournalImportVoucher; input: Parameters<typeof createJournal>[2] }, journalId: string) {
  for (const [i, l] of x.v.lines.entries()) {
    const t = l.tax;
    if (!t) continue;
    const date = t.date ?? x.v.date, dept = x.input.lines[i]!.department_id ?? null, desc = x.input.lines[i]!.description ?? null;
    try {
      if (t.kind === 'P' || t.kind === 'S') {
        await addManualVat(db, a, t.kind, { tax_invoice_no: t.no!, tax_invoice_date: date, month: t.month ?? date.slice(0, 7), is_late: false, department_id: dept, description: desc,
          party_name: t.party, party_tax_id: t.party_tax_id, party_tax_branch_no: t.party_branch, base_amount: t.base, vat_amount: t.amount, zero_rate_amount: '0', exempt_amount: '0',
          nonclaim_base: '0', nonclaim_vat: '0', remark: null, doc_no: null, doc_date: null, journal_id: journalId, header_id: null });
      } else {
        await saveWht(db, a, null, { form_type: t.kind, certificate_no: t.no, certificate_date: date, is_late: false, supplier_id: null, payee_name: t.party!, payee_address: null,
          payee_tax_id: t.party_tax_id, payee_tax_branch_no: t.party_branch, income_type: t.income_type ?? 'ค่าบริการ', condition: '1', paid_amount: t.base, rate: t.rate ?? '0', tax_amount: t.amount, header_id: null, journal_id: journalId });
      }
    } catch (e) {
      if (e instanceof AppError) e.message = `แถว ${l.row} ${JOURNAL_IMPORT_TAX_LABEL[t.kind]}: ${e.message}`;
      throw e;
    }
  }
}

/** ทับใบสำคัญ: ยกเลิกรายการภาษีที่ป้อนเองของใบนี้ (ภาษีซื้อ/ขาย is_manual · หัก ณ ที่จ่ายที่ไม่ได้มาจากเอกสาร) — สถานะ C + log เหมือนปุ่มยกเลิกในแฟ้มภาษี */
async function cancelJournalTaxes(db: Db, a: Ctx, journalId: string) {
  const vat = await db.updateTable('tax_vat_entry').set({ doc_status: 'C', updated_by: a.userId }).where('company_id', '=', a.companyId).where('journal_id', '=', journalId)
    .where('is_manual', '=', true).where('doc_status', '=', 'N').where('deleted_at', 'is', null).returning(['id', 'tax_invoice_no']).execute();
  const wht = await db.updateTable('tax_wht_entry').set({ doc_status: 'C', updated_by: a.userId }).where('company_id', '=', a.companyId).where('journal_id', '=', journalId)
    .where('header_id', 'is', null).where('doc_status', '=', 'N').where('deleted_at', 'is', null).returning(['id', 'certificate_no', 'payee_name']).execute();
  for (const r of vat) await logActivity(db, a, { module: 'TAX', action: 'CANCEL', docNo: r.tax_invoice_no, table: 'tax_vat_entry', rowId: r.id, detail: { reason: 'นำเข้าทับใบสำคัญ' } });
  for (const r of wht) await logActivity(db, a, { module: 'TAX', action: 'CANCEL', docNo: r.certificate_no ?? r.payee_name, table: 'tax_wht_entry', rowId: r.id, detail: { reason: 'นำเข้าทับใบสำคัญ' } });
}

const MAX_FILE = 10 * 1024 * 1024;
const importBody = z.object({
  file_name: z.string().trim().min(1).max(200), data: z.string().min(1, 'เลือกแฟ้ม').max(Math.ceil(MAX_FILE * 1.4) + 200, 'แฟ้มใหญ่เกิน 10 MB'), commit: z.boolean().default(false),
  // the choice for each duplicate voucher, keyed by book|group from the check result (never a journal id)
  actions: z.record(z.string().max(80), z.enum(['skip', 'overwrite', 'new'])).optional(),
  /** ให้ AI จัดรูปแบบ Excel (HANDOFF 168): การจับคู่คอลัมน์ที่ผู้ใช้ยืนยัน · เลขที่บัญชีที่ยอมรับจากคำแนะนำ (แถว → เลขที่บัญชี) */
  mapping: mappingBody.optional(), codes: codesBody,
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
    const role = async (r: string) => (await db.selectFrom('gl_default_account as x').innerJoin('gl_account as g', 'g.id', 'x.account_id').select('g.account_no')
      .where('x.company_id', '=', a.companyId).where('x.deleted_at', 'is', null).where('x.role', '=', r).executeTakeFirst())?.account_no ?? '';
    const [ivat, whtp] = [await role('INPUT_VAT'), await role('WHT_PAYABLE')];
    const date = formatDate(new Date().toISOString().slice(0, 10), co.year_system as YearSystem);
    const cols = JOURNAL_IMPORT_COLUMNS;
    const pv = bk('PV', 1);
    const sample: Array<Record<string, string>> = [
      // กลุ่ม 1 กำหนดเลขที่ใบสำคัญเอง (ขึ้นต้นตามสมุด) · กลุ่ม 2–3 เว้นว่าง = ระบบออกเลข
      { book: pv, group: '1', voucher_no: `${pv.toUpperCase()}0000001`, date, ref: 'INV-6901', description: 'จ่ายค่าไฟฟ้าเดือนตุลาคม', account: exp, line_description: 'ค่าไฟฟ้าสำนักงาน', debit: '1500', credit: '' },
      { book: pv, group: '1', date, ref: '', description: '', account: ivat || cash, line_description: '', debit: '105', credit: '', tax: 'ภาษีซื้อ', tax_no: 'INV-6901', tax_date: date, party: 'บริษัท ผู้ขาย จำกัด', party_tax_id: '0105550123451', party_branch: '00000', tax_base: '1500' },
      { book: pv, group: '1', date, ref: '', description: '', account: cash, line_description: '', debit: '', credit: '1605' },
      { book: pv, group: '2', date, ref: 'SV-0001', description: 'จ่ายค่าบริการทำความสะอาด', account: exp, line_description: '', debit: '2000', credit: '' },
      { book: pv, group: '2', date, ref: '', description: '', account: whtp || accr || cash, line_description: '', debit: '', credit: '60', tax: 'ภงด53', party: 'บริษัท ตัวอย่าง จำกัด', party_tax_id: '', tax_base: '2000', tax_rate: '3', income_type: 'ค่าบริการ' },
      { book: pv, group: '2', date, ref: '', description: '', account: cash, line_description: '', debit: '', credit: '1940' },
      { book: bk('JV', 0), group: '3', date, ref: 'ADJ-01', description: 'ปรับปรุงค่าใช้จ่ายค้างจ่าย', account: exp, line_description: '', debit: '800', credit: '' },
      { book: bk('JV', 0), group: '3', date, ref: '', description: '', account: accr || cash, line_description: '', debit: '', credit: '800' },
    ];
    const textCols = cols.map((c, i) => (c.format === 'code' || c.format === 'date' || c.format === 'month' ? i : -1)).filter((i) => i >= 0);
    const numCols = cols.map((c, i) => (c.format === 'number' ? i : -1)).filter((i) => i >= 0);
    const headKinds = Object.fromEntries(cols.map((c, i) => [i, c.need === 'tax' ? 'cond' : c.need === 'optional' ? null : 'req'] as const).filter((x) => x[1])) as Record<number, 'req' | 'cond'>;
    const help = [['คอลัมน์', 'ต้องใส่ / ว่างได้', 'รูปแบบช่องใน Excel', 'คำอธิบาย'], ...cols.map((c) => [journalImportHeader(c), JOURNAL_IMPORT_NEED_LABEL[c.need], JOURNAL_IMPORT_FORMAT_LABEL[c.format], c.hint]), ['', '', '', ''],
      ['', '', '', 'หนึ่งแถว = หนึ่งบรรทัดบัญชี · แถวที่สมุดและเลขที่กลุ่มเดียวกันรวมเป็นใบสำคัญใบเดียว (วันที่ อ้างอิง คำอธิบาย ใส่แถวแรกของกลุ่ม) · ทุกใบยอดเดบิต = เครดิต'],
      ['', '', '', `เลขที่ใบสำคัญ: เว้นว่าง = ระบบออกเลขให้ตามสมุด · ใส่เอง = ต้องขึ้นต้นด้วยตัวนำหน้าของสมุดนั้น (เช่น สมุด ${pv} → ${pv.toUpperCase()}0000001) ห้ามซ้ำกับใบสำคัญที่มีอยู่ ใบที่ยกเลิกแล้วต้องลบก่อนจึงใช้เลขเดิมได้ · ถ้าเลขที่ใส่เองตรงรูปแบบที่ระบบออกให้ เลขอัตโนมัติถัดไปจะต่อจากเลขนั้น`],
      ['', '', '', 'ภาษี: ใส่คอลัมน์ "ภาษี" และรายละเอียดเฉพาะแถวของบัญชีภาษี (ภาษีซื้อ ภาษีขาย ภาษีหัก ณ ที่จ่ายค้างจ่าย) — ยอดเดบิต/เครดิตของแถวนั้น = ยอดภาษี ระบบเติมแฟ้มภาษีซื้อ/ภาษีขาย/ภ.ง.ด.3/53 ให้ ดูได้ที่แท็บภาษีของใบสำคัญ'],
      ['', '', '', 'ใบกำกับหลายใบในใบสำคัญเดียว = แยกแถวบัญชีภาษีหนึ่งแถวต่อหนึ่งใบกำกับ · ยกเลิกใบสำคัญ = ยกเลิกรายการภาษีที่นำเข้าด้วย'],
      ['', '', '', 'กด "ตรวจแฟ้ม" ก่อน (ไม่บันทึก) แล้วจึง "นำเข้า" — ผิดใบเดียวไม่บันทึกเลย · ลบแถวตัวอย่างก่อนใช้ · ชื่อหัวคอลัมน์ห้ามแก้ (สลับลำดับได้) · บันทึกเป็น .xlsx หรือ .csv'],
      ['', '', '', 'หัวคอลัมน์สีชมพูมี * = ต้องใส่ · สีเหลือง = ใส่เมื่อมีภาษี (ใบที่ไม่มีภาษีเว้นว่างได้ทั้งหมด) · สีม่วงอ่อน = ว่างได้ · ช่องรหัส/เลขที่/วันที่ตั้งเป็นข้อความไว้แล้ว (เลข 0 ข้างหน้าไม่หาย) · ช่องเงินเป็นตัวเลข #,##0.00'],
      ['', '', '', 'แฟ้มจากที่อื่นหรือจาก OCR: ตัวเลขแบบข้อความ จุลภาค ช่องว่าง เลขไทย ขีด (-) แทนศูนย์ วันที่แบบข้อความหรือช่องวันที่ของ Excel เลขผู้เสียภาษีที่เลข 0 ข้างหน้าหาย รับได้ — ค่าที่ไม่แน่ใจระบบแจ้งแถวให้แก้'],
      ['', '', '', `สมุดรายวันของบริษัทนี้: ${books.map((b) => b.prefix?.trim() || b.code).join(' ')}`]];
    reply.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('content-disposition', 'attachment; filename="import-journal.xlsx"');
    return buildXlsx([
      { name: 'นำเข้า', rows: [cols.map(journalImportHeader), ...sample.map((s) => cols.map((c) => s[c.key] ?? ''))], textCols, numCols, headKinds, widths: cols.map((c) => (c.key.includes('description') || c.key === 'party' ? 30 : 13)) },
      { name: 'คำอธิบาย', rows: help, widths: [18, 30, 40, 100] },
    ]);
  });

  app.post('/api/v1/gl/journal-import', async (req) => {
    const a = requireCompany(req);
    const b = parse(importBody, req.body);
    if (!(await allowedFor(db, a, 'GL.JNL', 'add')).allowed) throw forbidden('ไม่มีสิทธิ์เพิ่มใบสำคัญ — นำเข้าไม่ได้');
    const co = await db.selectFrom('sys_company').select('year_system').where('id', '=', a.companyId).executeTakeFirstOrThrow();
    const tf = transformTable(readTable(b.file_name, Buffer.from(b.data.replace(/^data:[^,]*,/, ''), 'base64')), 'journal', b.mapping, b.codes);
    const rows = tf.table;
    const { vouchers, errors, hasTax } = mapJournalImport(rows, co.year_system as YearSystem);
    if (Object.values(b.actions ?? {}).includes('overwrite') && !(await allowedFor(db, a, 'GL.JNL', 'edit')).allowed) throw forbidden('ไม่มีสิทธิ์แก้ไขใบสำคัญ — เลือก "สร้างเป็นเอกสารใหม่" หรือ "ไม่นำเข้า" แทน "ทับเอกสารเดิม"');
    const r = await importJournals(db, a, vouchers, errors, b.commit, { actions: b.actions, hasTax });
    const saved = r.vouchers.filter((x) => x.status === 'created' || x.status === 'overwritten');
    if (b.commit) await logActivity(db, a, { module: 'GL', action: 'IMPORT', docNo: saved[0]?.voucher_no ?? null, detail: { file: b.file_name, created: saved.filter((x) => x.status === 'created').length,
      overwritten: saved.filter((x) => x.status === 'overwritten').map((x) => x.voucher_no), skipped: r.vouchers.filter((x) => x.status === 'skipped').length, first: saved[0]?.voucher_no, last: saved.at(-1)?.voucher_no, mapped: tf.mapped, codes: Object.keys(b.codes ?? {}).length } });
    return { ...r, file_vouchers: vouchers.length, mapped: tf.mapped, skipped_rows: tf.skipped, row_shift: tf.rowShift, need_codes: b.commit ? [] : missingCodeRows(rows, 'journal') };
  });
}
