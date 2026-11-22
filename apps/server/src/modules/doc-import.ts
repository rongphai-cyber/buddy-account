import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { BANK_KINDS, d, docImportKindOf, formatDate, importHeaderText, importNeedLabel, mapDocImport, PAYMENT_IMPORT_COLUMNS, SETTLE_KINDS, STOCK_KINDS,
  type DocImportDoc, type DocImportKind, type ImportIssue, type YearSystem } from '@buddy/core';
import type { Db } from '../db.js';
import { AppError, badRequest, forbidden, notFound, parse, requireCompany, type AuthContext } from '../http.js';
import { logActivity } from '../audit.js';
import { buildXlsx, type XlsxSheet } from '../xlsx.js';
import { allowedFor } from './permissions.js';
import { fileNumbers, PAY_SHEET_RULE, paySheetByRef, paySheetOf, readSheets, whtEntry } from './trade-import.js';
import { buildPayments, finder, loadRefs, methodsOf, type PayInfo } from './import-fields.js';
import { body as settleBody, saveSettle } from './docs/settle.js';
import { body as bankBody, save as saveBank } from './docs/bankdocs.js';
import { body as stockBody, writeStockDoc } from './docs/stockdocs.js';
import { dpBody, saveDp } from './docs/pettycash.js';

/**
 * นำเข้าเอกสารอื่นที่ลงบัญชีจาก Excel (HANDOFF 171 — เจ้าของ 21/11/2569 "ทุกเอกสารที่จะคีย์ ขอมีอ่านบิลด้วย Ai และ นำเข้า Excel")
 * รับชำระหนี้/จ่ายชำระหนี้ · ฝาก ถอน โอน รายได้/ค่าใช้จ่ายธนาคาร · เบิกใช้ โอนย้ายคลัง ปรับปรุงสินค้า/ต้นทุน · จ่ายเงินสดย่อย
 * กติกาเดียวกับนำเข้าขาย/ซื้อ: ตรวจ (ลองบันทึกใน SAVEPOINT แล้วถอยกลับ — ไม่บันทึก) → นำเข้า (ทุกฉบับในทรานแซกชันเดียว ผิดฉบับเดียวไม่บันทึกเลย)
 * บันทึกด้วยฟังก์ชันเดียวกับหน้าจอ (ลงบัญชีทันที) · ทุก query กรอง company_id จาก session · ไม่เพิ่มข้อมูลหลักให้ (ต้องมีในโปรแกรมแล้ว)
 * เลขที่อ้างอิงเก็บในช่องอ้างอิงของเอกสาร (your_ref) ใช้กันนำเข้าซ้ำ · บันทึก sys_activity_log (ADD ทุกฉบับ + IMPORT สรุปแฟ้ม)
 */
type Ctx = AuthContext & { companyId: string };
const MAX_FILE = 10 * 1024 * 1024;
type Row = { ref: string; row: number; date: string; party: string | null; lines: number; amount: string | null; doc_no: string | null; doc_no_source: 'file' | 'auto'; warnings: string[];
  pay_source?: 'main' | 'sheet' | 'cash'; cash_remainder?: string | null; cash_name?: string | null };
type Ready = { doc: DocImportDoc; party: string | null; body: Record<string, unknown> & { doc_no: string | null }; payInfo?: PayInfo; paySource?: 'main' | 'sheet' | 'cash' };

const importBody = z.object({
  file_name: z.string().trim().min(1).max(200), data: z.string().min(1, 'เลือกแฟ้ม').max(Math.ceil(MAX_FILE * 1.4) + 200, 'แฟ้มใหญ่เกิน 10 MB'),
  doc_type_id: z.string({ required_error: 'เลือกประเภทเอกสาร' }).uuid('เลือกประเภทเอกสาร'), commit: z.boolean().default(false),
});
const kindOf = (path: string) => { const K = docImportKindOf(path); if (!K) throw notFound('ชนิดเอกสาร'); return K; };

/** แบบฟอร์ม .xlsx: แผ่นนำเข้า (หัวสีชมพู * = ต้องมี · สีเหลือง = ต้องมีถ้า…) · แผ่นรับ/จ่ายชำระ (รับ/จ่ายชำระหนี้) · แผ่นคำอธิบาย */
export function buildDocTemplate(K: DocImportKind, sample: { date: string; prefix: string }): Buffer {
  const cols = K.columns;
  const kinds = (cs: Array<{ need: string }>) => Object.fromEntries(cs.map((c, i) => [i, c.need === 'req' ? 'req' : c.need === 'cond' ? 'cond' : null] as const).filter((x) => x[1])) as Record<number, 'req' | 'cond'>;
  const ex = (r: 0 | 1) => cols.map((c) => (c.key === 'date' ? sample.date : c.key === 'ref' && !K.lines && r === 1 ? c.example[0].replace(/1$/, '2') : c.example[r]));
  const sheets: XlsxSheet[] = [{ name: 'นำเข้า', rows: [cols.map((c) => importHeaderText(c)), ex(0), ex(1)], headKinds: kinds(cols),
    textCols: cols.map((c, i) => (c.format === 'number' ? -1 : i)).filter((i) => i >= 0), numCols: cols.map((c, i) => (c.format === 'number' ? i : -1)).filter((i) => i >= 0),
    widths: cols.map((c) => (['remark', 'description'].includes(c.key) ? 28 : 16)) }];
  const recv = K.module === 'AR', payName = recv ? 'รับชำระ' : 'จ่ายชำระ';
  const pcols = PAYMENT_IMPORT_COLUMNS.filter((c) => c.key !== 'cheque_date');
  if (K.payments) sheets.push({ name: payName, rows: [[PAY_SHEET_RULE], pcols.map((c) => importHeaderText(c))], headAt: 1, headKinds: kinds(pcols), widths: pcols.map(() => 18) });
  const help: string[][] = [['คอลัมน์', 'จำเป็น', 'คำอธิบาย'], ...cols.map((c) => [c.th, importNeedLabel(c), c.hint]), ['', '', ''],
    ['', '', K.lines ? `หนึ่งแถว = ${K.line} · แถวที่เลขที่อ้างอิงเดียวกันรวมเป็น${K.label}ฉบับเดียว — ช่องของหัวเอกสารใส่แถวแรกพอ แถวต่อมาเว้นว่างหรือใส่ค่าเดิม` : `หนึ่งแถว = ${K.label}หนึ่งฉบับ (เลขที่อ้างอิงห้ามซ้ำในแฟ้ม)`],
    ['', '', 'หัวคอลัมน์สีชมพู มี * = ต้องมี · สีเหลือง = ต้องมีตามเงื่อนไข · อื่น ๆ เว้นว่างได้ (ค่าเริ่มต้นเดียวกับหน้าจอ)'],
    ['', '', 'ช่องรหัส (คู่ค้า บัญชีเงินฝาก คลัง สินค้า บัญชี แผนก Job วิธีชำระ) ใส่รหัสหรือชื่อที่มีในโปรแกรมแล้ว — ระบบไม่เพิ่มข้อมูลหลักให้'],
    ['', '', `เลขที่เอกสาร: เว้นว่าง = ระบบออกเลขตามประเภทเอกสาร · ใส่เอง = ต้องขึ้นต้นด้วยตัวนำหน้าของประเภทเอกสาร (เช่น ${sample.prefix}…) และไม่ซ้ำ`],
    ['', '', 'เลือกแฟ้มแล้วระบบตรวจก่อน (ยังไม่บันทึก) · กดนำเข้าแล้วบันทึกและลงบัญชีทุกฉบับพร้อมกัน — ถ้าผิดฉบับเดียวจะไม่บันทึกเลย · เลขที่อ้างอิงที่เคยนำเข้าแล้วนำเข้าซ้ำไม่ได้'],
    ...(K.payments ? [['', '', ''], [`แผ่น "${payName}"`, '', `แบ่ง${recv ? 'รับ' : 'จ่าย'}หลายวิธี: ใส่เฉพาะวิธีที่ไม่ใช่เงินสด หนึ่งแถว = หนึ่งวิธี — ส่วนที่เหลือของยอดที่ต้อง${recv ? 'รับ' : 'จ่าย'} (ยอดที่ตัดบิล − ภาษีหัก ณ ที่จ่าย) = เงินสด · รวมเกินยอด = ผิด · ใส่ทั้งคอลัมน์วิธีชำระและแผ่นนี้ = ผิด`],
      ...pcols.map((c) => [c.th, importNeedLabel(c), c.hint])] : []),
    ['', '', 'ลบแถวตัวอย่างก่อนใช้ · ชื่อหัวคอลัมน์ห้ามแก้ (สลับลำดับได้) · บันทึกเป็น .xlsx (หรือ .csv เฉพาะแผ่นนำเข้า)']];
  sheets.push({ name: 'คำอธิบาย', rows: help, widths: [26, 34, 110] });
  return buildXlsx(sheets);
}

/** ลองบันทึกทุกฉบับใน SAVEPOINT: ตรวจ = ถอยกลับเสมอ · นำเข้า = เก็บเมื่อไม่มีข้อผิดพลาดเลย */
async function tryAll(db: Db, commit: boolean, issues: ImportIssue[], ready: Ready[], save: (x: Ready) => Promise<Row>) {
  const results: Row[] = [];
  if (commit && issues.length) return { results, ran: false };
  await sql`SAVEPOINT doc_import_all`.execute(db);
  // เลขที่ตามแฟ้มก่อน — เลขอัตโนมัติไม่ชนเลขที่แฟ้มใช้
  for (const x of [...ready].sort((p, q) => Number(!!q.body.doc_no) - Number(!!p.body.doc_no))) {
    await sql`SAVEPOINT doc_import`.execute(db);
    try {
      results.push(await save(x));
      await sql`RELEASE SAVEPOINT doc_import`.execute(db);
    } catch (e) {
      await sql`ROLLBACK TO SAVEPOINT doc_import`.execute(db);
      if (!(e instanceof AppError)) throw e;
      issues.push({ row: x.doc.row, message: `เลขที่อ้างอิง ${x.doc.ref}: ${e.message}` });
    }
  }
  await sql.raw(commit && !issues.length ? 'RELEASE SAVEPOINT doc_import_all' : 'ROLLBACK TO SAVEPOINT doc_import_all').execute(db);
  if (!commit) for (const r of results) if (r.doc_no_source !== 'file') r.doc_no = null;
  return { results: results.sort((p, q) => p.row - q.row), ran: true };
}

export function docImportRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/v1/doc-import/:path/template', async (req, reply) => {
    const a = requireCompany(req);
    const K = kindOf(parse(z.object({ path: z.string() }), req.params).path);
    const co = await db.selectFrom('sys_company').select('year_system').where('id', '=', a.companyId).executeTakeFirstOrThrow();
    const dt = await db.selectFrom('md_doc_type').select('code').where('company_id', '=', a.companyId).where('doc_class', '=', K.cls).where('status', '=', 'A').where('deleted_at', 'is', null).orderBy('code').executeTakeFirst();
    reply.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('content-disposition', `attachment; filename="import-${K.cls}.xlsx"`);
    return buildDocTemplate(K, { date: formatDate(new Date().toISOString().slice(0, 10), co.year_system as YearSystem), prefix: dt?.code ?? K.cls });
  });

  app.post('/api/v1/doc-import/:path', async (req) => {
    const a = requireCompany(req);
    const K = kindOf(parse(z.object({ path: z.string() }), req.params).path);
    const b = parse(importBody, req.body);
    if (!(await allowedFor(db, a, K.menu, 'add')).allowed) throw forbidden(`ไม่มีสิทธิ์เพิ่ม${K.label} — นำเข้าไม่ได้`);
    const dt = await db.selectFrom('md_doc_type').select(['id', 'code', 'doc_class', 'status']).where('id', '=', b.doc_type_id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!dt || dt.doc_class !== K.cls || dt.status !== 'A') throw badRequest(`เลือกประเภทเอกสารของ${K.label}ที่ยังใช้งาน`);
    const co = await db.selectFrom('sys_company').select('year_system').where('id', '=', a.companyId).executeTakeFirstOrThrow();
    const ys = co.year_system as YearSystem;
    const sheets = readSheets(b.file_name, Buffer.from(b.data.replace(/^data:[^,]*,/, ''), 'base64'));
    const { docs, errors } = mapDocImport(sheets[0]?.rows ?? [], ys, K);
    const issues: ImportIssue[] = [...errors];
    const warnings: string[] = [];
    const own = await fileNumbers(db, a.companyId, dt.code, ys, docs, issues, warnings);
    // นำเข้าซ้ำ: เลขที่อ้างอิงเดียวกันในเอกสารชนิดนี้ที่ยังไม่ยกเลิก
    const refs = docs.map((x) => x.ref);
    const prior = new Map((refs.length ? (await sql<{ your_ref: string; doc_no: string }>`SELECT your_ref, doc_no FROM doc_header WHERE company_id = ${a.companyId} AND doc_class = ${K.cls}
        AND doc_status <> 'C' AND deleted_at IS NULL AND your_ref = ANY(${refs}::text[])`.execute(db)).rows : []).map((r) => [r.your_ref, r.doc_no]));
    for (const x of docs) if (prior.has(x.ref)) issues.push({ row: x.row, message: `เลขที่อ้างอิง ${x.ref} เคยนำเข้าแล้วเป็น ${prior.get(x.ref)} — ลบแถวนี้ออก หรือยกเลิก ${prior.get(x.ref)} ก่อน` });
    const ok = docs.filter((x) => !prior.has(x.ref));
    const base = (x: DocImportDoc) => ({ doc_type_id: dt.id, doc_no: own.get(x.ref) ?? null, doc_date: x.head.date! });
    const plan = K.group === 'settle' ? await planSettle(db, a, K, ok, ys, sheets, base, issues, warnings)
      : K.group === 'bank' ? await planBank(db, a, K, ok, base, issues)
      : K.group === 'stock' ? await planStock(db, a, K, ok, base, issues)
      : await planPetty(db, a, ok, base, issues);
    const { results, ran } = await tryAll(db, b.commit, issues, plan, async (x) => {
      const r = await plan.save(x);
      // เลขที่อ้างอิงในแฟ้ม → ช่องอ้างอิงของเอกสาร (กันนำเข้าซ้ำ — เอกสารที่หน้าจอไม่มีช่องอ้างอิง)
      await sql`UPDATE doc_header SET your_ref = ${x.doc.ref} WHERE id = ${r.id} AND company_id = ${a.companyId} AND your_ref IS DISTINCT FROM ${x.doc.ref}`.execute(db);
      return { ref: x.doc.ref, row: x.doc.row, date: x.doc.head.date!, party: x.party, lines: Math.max(x.doc.lines.length, 1), amount: r.net_amount != null ? d(r.net_amount).toFixed(2) : null, doc_no: r.doc_no,
        doc_no_source: x.body.doc_no ? 'file' : 'auto', warnings: r.warnings ?? [], ...(x.paySource ? { pay_source: x.paySource, cash_remainder: x.payInfo?.remainder ?? null, cash_name: x.payInfo?.cash_name ?? null } : {}) };
    });
    issues.sort((p, q) => p.row - q.row);
    if (b.commit && issues.length) throw badRequest(ran ? `นำเข้าไม่ได้ — ${issues[0]!.message} (แถว ${issues[0]!.row})` : `นำเข้าไม่ได้ — มีข้อผิดพลาด ${issues.length} รายการ กด "ตรวจแฟ้มอีกครั้ง" ดูรายละเอียด`,
      issues.slice(0, 200).map((x) => ({ field: `row:${x.row}`, message: x.message })));
    if (b.commit) await logActivity(db, a, { module: K.module, action: 'IMPORT', docNo: results[0]?.doc_no ?? null, detail: { file: b.file_name, kind: K.cls, docs: results.length, first: results[0]?.doc_no, last: results.at(-1)?.doc_no } });
    return { ok: !issues.length, committed: b.commit, docs: results, errors: issues, file_docs: docs.length, file_warnings: warnings, total: results.reduce((t, r) => t.plus(d(r.amount ?? 0)), d(0)).toFixed(2) };
  });
}

type Base = (x: DocImportDoc) => { doc_type_id: string; doc_no: string | null; doc_date: string };
type SaveOut = { id: string; doc_no: string; net_amount?: string | null; warnings?: string[] };
type Plan = Ready[] & { save: (x: Ready) => Promise<SaveOut> };
const plan = (rs: Ready[], save: (x: Ready) => Promise<SaveOut>): Plan => Object.assign(rs, { save });
const notFoundMsg = (what: string, col: string, v: string, fix: string) => `ไม่พบ${what} "${v}" (คอลัมน์ "${col}") — ${fix}`;

/** รับชำระหนี้/จ่ายชำระหนี้: คู่ค้าที่มีแล้ว · บิลค้างของคู่ค้ารายนั้น (เลขที่เอกสาร หรือเลขที่ใบกำกับผู้จำหน่าย) · ยอด = ยอดคงค้าง ถ้าไม่ใส่ · วิธีชำระ/แผ่นรับจ่ายชำระ (ส่วนที่เหลือ = เงินสด) */
async function planSettle(db: Db, a: Ctx, K: DocImportKind, docs: DocImportDoc[], ys: YearSystem, sheets: Array<{ name: string; rows: string[][] }>, base: Base, issues: ImportIssue[], warnings: string[]) {
  const SK = SETTLE_KINDS.find((k) => k.cls === K.cls)!;
  const recv = SK.direction === 'R', w = recv ? 'ลูกค้า' : 'ผู้จำหน่าย';
  const parties = (await sql<{ id: string; code: string; name: string; tax_id: string | null; wht_form: string | null; wht_income_desc: string | null }>`SELECT id, code, name, replace(coalesce(tax_id, ''), '-', '') AS tax_id,
      ${recv ? sql`NULL` : sql`wht_form`} AS wht_form, ${recv ? sql`NULL` : sql`wht_income_desc`} AS wht_income_desc
      FROM ${sql.table(recv ? 'md_customer' : 'md_supplier')} WHERE company_id = ${a.companyId} AND deleted_at IS NULL`.execute(db)).rows;
  const findP = finder(parties);
  const partyOf = (v: string) => { const f = findP(v); return f ? parties.find((p) => p.id === f.id) : parties.find((p) => p.tax_id && p.tax_id === v.replace(/\D/g, '')); };
  const R = await loadRefs(db, a.companyId);
  const method = await methodsOf(db, a.companyId, SK.direction);
  const paysBy = paySheetByRef(paySheetOf(sheets), ys, docs.map((x) => x.ref), true, K.label, issues, warnings);
  const view = recv ? 'v_ar_outstanding' : 'v_ap_outstanding';
  const out: Ready[] = [];
  for (const x of docs) {
    const n0 = issues.length;
    const bad = (row: number, m: string) => issues.push({ row, message: m });
    const p = partyOf(x.head.party!);
    if (!p) { bad(x.row, notFoundMsg(w, `รหัส${w}`, x.head.party!, `ใส่รหัส ชื่อ หรือเลขผู้เสียภาษีของ${w}ที่มีในโปรแกรม`)); continue; }
    const dept = x.head.department ? R.dept(x.head.department) : undefined;
    if (x.head.department && !dept) bad(x.row, notFoundMsg('แผนก', 'แผนก', x.head.department, 'ใส่รหัสหรือชื่อแผนกที่มีในโปรแกรม'));
    const open = (await sql<{ header_id: string; doc_class: string; doc_no: string; ref_no: string | null; outstanding: string; net_amount: string; vat_amount: string }>`SELECT o.header_id, o.doc_class, o.doc_no, h.ref_no,
        abs(o.outstanding)::text AS outstanding, h.net_amount::text AS net_amount, h.vat_amount::text AS vat_amount
        FROM ${sql.table(view)} o JOIN doc_header h ON h.id = o.header_id
       WHERE o.company_id = ${a.companyId} AND o.${sql.ref(recv ? 'customer_id' : 'supplier_id')} = ${p.id} AND o.outstanding <> 0`.execute(db)).rows;
    const up = (v: string | null) => (v ?? '').trim().toUpperCase();
    const setts: Array<{ invoice_header_id: string; amount: string }> = [];
    let due = d(0), base0 = d(0);
    for (const l of x.lines) {
      const v = up(l.v.bill ?? '');
      const hits = open.filter((o) => up(o.doc_no) === v || (!recv && up(o.ref_no) === v));
      if (!hits.length) { bad(l.row, `ไม่พบบิลค้าง "${l.v.bill}" ของ${w} ${p.code} — ใส่เลขที่เอกสารที่ยังค้างชำระ${recv ? '' : ' หรือเลขที่ใบกำกับของผู้จำหน่าย'} (บิลที่ตัดครบแล้ว/ยกเลิก/ของคู่ค้ารายอื่นใช้ไม่ได้)`); continue; }
      if (hits.length > 1) { bad(l.row, `เลขที่ "${l.v.bill}" ตรงกับบิลค้างหลายใบ (${hits.map((h) => h.doc_no).join(', ')}) — ใส่เลขที่เอกสารในโปรแกรม`); continue; }
      const o = hits[0]!;
      if (setts.some((s) => s.invoice_header_id === o.header_id)) { bad(l.row, `บิล ${o.doc_no} ซ้ำในเลขที่อ้างอิง ${x.ref}`); continue; }
      const amt = l.v.amount ? d(l.v.amount) : d(o.outstanding);
      if (amt.lte(0)) { bad(l.row, `ยอดชำระของ ${o.doc_no} ต้องมากกว่า 0`); continue; }
      if (amt.gt(d(o.outstanding))) { bad(l.row, `ยอดชำระ ${amt.toFixed(2)} ของ ${o.doc_no} มากกว่ายอดคงค้าง ${d(o.outstanding).toFixed(2)}`); continue; }
      setts.push({ invoice_header_id: o.header_id, amount: amt.toFixed(2) });
      const sign = o.doc_class === SK.neg ? -1 : 1;
      due = due.plus(amt.times(sign));
      // ฐานภาษีหัก ณ ที่จ่าย = ยอดชำระก่อน VAT ตามสัดส่วนของบิล
      base0 = base0.plus(d(o.net_amount).isZero() ? amt.times(sign) : amt.times(sign).times(d(o.net_amount).minus(d(o.vat_amount))).div(d(o.net_amount)));
    }
    if (issues.length > n0) continue;
    let wht: unknown[] = [], whtAmt = d(0);
    if (recv && x.head.wht_amount) whtAmt = d(x.head.wht_amount);
    if (!recv && (x.head.wht_amount || x.head.wht_rate)) {
      const form = x.head.wht_form ? (/53/.test(x.head.wht_form) ? 'S53' : /3/.test(x.head.wht_form) ? 'S03' : null) : null;
      if (x.head.wht_form && !form) { bad(x.row, `แบบ ภ.ง.ด. "${x.head.wht_form}" ใช้ 3 หรือ 53`); continue; }
      const e = whtEntry({ rate: x.head.wht_rate ?? null, amount: x.head.wht_amount ?? null, income: x.head.wht_income ?? null, form }, base0.toDecimalPlaces(2), p, p.tax_id);
      wht = [e]; whtAmt = d(e.tax_amount);
    }
    const payInfo: PayInfo = { remainder: null, cash_name: null };
    const sheet = paysBy.get(x.ref) ?? [];
    const payments = buildPayments({ info: payInfo, ref: x.ref, row: x.row, due: due.minus(whtAmt).toFixed(2), label: K.label, recv, main: { method: x.head.pay_method ?? null, pay_ref: x.head.pay_ref ?? null }, sheet, method, issues });
    if (!payments) continue;
    out.push({ doc: x, party: `${p.code} ${p.name}`, payInfo, paySource: sheet.length ? 'sheet' : x.head.pay_method ? 'main' : 'cash',
      body: { ...base(x), party_id: p.id, department_id: dept?.id ?? null, your_ref: x.ref, remark: x.head.remark ?? null, settlements: setts, wht_amount: recv ? whtAmt.toFixed(2) : '0', wht, payments } });
  }
  return plan(out, async (x) => saveSettle(db, a, SK, null, parse(settleBody, x.body)) as Promise<SaveOut>);
}

/** ฝาก/ถอน/โอน/รายได้/ค่าใช้จ่ายธนาคาร: หนึ่งแถว = หนึ่งฉบับ · บัญชีเงินฝากตามรหัส ชื่อ หรือเลขที่บัญชี */
async function planBank(db: Db, a: Ctx, K: DocImportKind, docs: DocImportDoc[], base: Base, issues: ImportIssue[]) {
  const BK = BANK_KINDS.find((k) => k.cls === K.cls)!;
  const banks = (await sql<{ id: string; code: string; name: string; account_number: string | null }>`SELECT id, code, name, account_number FROM md_bank_account WHERE company_id = ${a.companyId} AND deleted_at IS NULL`.execute(db)).rows;
  const f = finder(banks);
  const bankOf = (v: string) => f(v) ?? banks.find((b) => b.account_number && b.account_number.replace(/\D/g, '') === v.replace(/\D/g, '') && v.replace(/\D/g, ''));
  const R = await loadRefs(db, a.companyId);
  const out: Ready[] = [];
  for (const x of docs) {
    const n0 = issues.length;
    const from = bankOf(x.head.bank!), to = x.head.to_bank ? bankOf(x.head.to_bank) : undefined;
    const col = K.columns.find((c) => c.key === 'bank')!.th;
    if (!from) issues.push({ row: x.row, message: notFoundMsg('บัญชีเงินฝาก', col, x.head.bank!, 'ใส่รหัส ชื่อ หรือเลขที่บัญชีตาม เริ่มระบบ › บัญชีเงินฝาก') });
    if (x.head.to_bank && !to) issues.push({ row: x.row, message: notFoundMsg('บัญชีเงินฝาก', 'บัญชีที่โอนเข้า', x.head.to_bank, 'ใส่รหัส ชื่อ หรือเลขที่บัญชีตาม เริ่มระบบ › บัญชีเงินฝาก') });
    const dept = x.head.department ? R.dept(x.head.department) : undefined;
    if (x.head.department && !dept) issues.push({ row: x.row, message: notFoundMsg('แผนก', 'แผนก', x.head.department, 'ใส่รหัสหรือชื่อแผนกที่มีในโปรแกรม') });
    if (issues.length > n0) continue;
    out.push({ doc: x, party: `${from!.code} ${from!.name}`, body: { ...base(x), department_id: dept?.id ?? null, remark: x.head.remark ?? null, bank_account_id: from!.id, to_bank_account_id: to?.id ?? null,
      amount: x.head.amount!, ...(x.head.fee ? { fee: x.head.fee } : {}), ...(x.head.wht ? { wht: x.head.wht } : {}) } });
  }
  return plan(out, async (x) => saveBank(db, a, BK, null, parse(bankBody, x.body)) as Promise<SaveOut>);
}

/** เอกสารคลัง: สินค้าที่มีสต๊อก · คลังหัว/บรรทัด · หน่วย (ย่อย ขาย ซื้อ) · Job */
async function planStock(db: Db, a: Ctx, K: DocImportKind, docs: DocImportDoc[], base: Base, issues: ImportIssue[]) {
  const SK = STOCK_KINDS.find((k) => k.cls === K.cls)!;
  const items = (await sql<{ id: string; code: string; name: string; item_type: string; base_unit_id: string | null; sales_unit_id: string | null; sales_factor: string | null; purchase_unit_id: string | null; purchase_factor: string | null }>`SELECT id, code, name_th AS name, item_type,
      base_unit_id, sales_unit_id, sales_factor::text AS sales_factor, purchase_unit_id, purchase_factor::text AS purchase_factor FROM md_item WHERE company_id = ${a.companyId} AND deleted_at IS NULL`.execute(db)).rows;
  const fi = finder(items);
  const units = (await sql<{ id: string; code: string; name: string }>`SELECT id, code, name_th AS name FROM md_unit WHERE company_id = ${a.companyId} AND deleted_at IS NULL`.execute(db)).rows;
  const fu = finder(units);
  const R = await loadRefs(db, a.companyId);
  const out: Ready[] = [];
  for (const x of docs) {
    const n0 = issues.length;
    const nf = (row: number, what: string, col: string, v: string, fix: string) => issues.push({ row, message: notFoundMsg(what, col, v, fix) });
    const wh = x.head.warehouse ? R.wh(x.head.warehouse) : undefined, wh2 = x.head.to_warehouse ? R.wh(x.head.to_warehouse) : undefined;
    if (x.head.warehouse && !wh) nf(x.row, 'คลัง', K.columns.find((c) => c.key === 'warehouse')!.th, x.head.warehouse, 'ใส่รหัสหรือชื่อคลังที่มีในโปรแกรม');
    if (x.head.to_warehouse && !wh2) nf(x.row, 'คลัง', 'คลังปลายทาง', x.head.to_warehouse, 'ใส่รหัสหรือชื่อคลังที่มีในโปรแกรม');
    const dept = x.head.department ? R.dept(x.head.department) : undefined, job = x.head.project ? R.job(x.head.project) : undefined;
    if (x.head.department && !dept) nf(x.row, 'แผนก', 'แผนก', x.head.department, 'ใส่รหัสหรือชื่อแผนกที่มีในโปรแกรม');
    if (x.head.project && !job) nf(x.row, 'Job', 'Job/โครงการ', x.head.project, 'ใส่รหัสหรือชื่อ Job ที่มีในโปรแกรม');
    const lines = x.lines.map((l) => {
      const it = fi(l.v.item);
      if (!it) { nf(l.row, 'สินค้า', 'รหัสสินค้า', l.v.item!, 'ใส่รหัสหรือชื่อสินค้าที่มีในโปรแกรม (ระบบไม่เพิ่มสินค้าให้)'); return null; }
      const full = items.find((i) => i.id === it.id)!;
      if (full.item_type !== '0') { issues.push({ row: l.row, message: `${full.code} ไม่ใช่สินค้าที่มีสต๊อก (บริการ/สินค้าชุด/รายได้/ค่าใช้จ่าย) — ใช้กับเอกสารคลังไม่ได้` }); return null; }
      let unitId = full.base_unit_id, factor = '1';
      if (l.v.unit) {
        const u = fu(l.v.unit);
        if (u && u.id === full.base_unit_id) { /* หน่วยย่อย */ } else if (u && u.id === full.sales_unit_id) { unitId = u.id; factor = full.sales_factor ?? '1'; } else if (u && u.id === full.purchase_unit_id) { unitId = u.id; factor = full.purchase_factor ?? '1'; }
        else { issues.push({ row: l.row, message: `หน่วย ${l.v.unit} ไม่ใช่หน่วยของสินค้า ${full.code} — ใช้หน่วยย่อย หน่วยขาย หรือหน่วยซื้อของสินค้านั้น` }); return null; }
      }
      const lj = l.v.line_job ? R.job(l.v.line_job) : undefined;
      if (l.v.line_job && !lj) { nf(l.row, 'Job', 'Job รายบรรทัด', l.v.line_job, 'ใส่รหัสหรือชื่อ Job ที่มีในโปรแกรม'); return null; }
      return { item_id: full.id, description: l.v.description ?? null, warehouse_id: null, qty: l.v.qty ?? '0', unit_id: unitId, factor, ...(l.v.unit_cost ? { unit_cost: l.v.unit_cost } : {}),
        ...(SK.cls === 'CA' ? { amount: l.v.amount } : {}), project_id: lj?.id ?? (SK.cls === 'OU' ? job?.id ?? null : null) };
    });
    if (issues.length > n0 || lines.some((l) => !l)) continue;
    out.push({ doc: x, party: wh ? `${wh.code}${wh2 ? ` → ${wh2.code}` : ''}` : null, body: { ...base(x), department_id: dept?.id ?? null, project_id: job?.id ?? null, remark: x.head.remark ?? null, your_ref: x.ref,
      warehouse_id: wh?.id ?? null, to_warehouse_id: wh2?.id ?? null, lines: lines.map((l) => ({ ...l!, warehouse_id: l!.warehouse_id ?? wh?.id ?? null })) } });
  }
  return plan(out, async (x) => db.transaction().execute((tx) => writeStockDoc(tx, a, SK, null, parse(stockBody, x.body))) as Promise<SaveOut>);
}

/** จ่ายเงินสดย่อย (DP): บัญชีค่าใช้จ่ายตามเลขที่/ชื่อบัญชี (ไม่ใช่บัญชีคุม) · แผนก/Job รายบรรทัด */
async function planPetty(db: Db, a: Ctx, docs: DocImportDoc[], base: Base, issues: ImportIssue[]) {
  const accs = (await sql<{ id: string; code: string; name: string; is_control: boolean }>`SELECT id, account_no AS code, name_th AS name, is_control FROM gl_account WHERE company_id = ${a.companyId} AND deleted_at IS NULL AND status = 'A'`.execute(db)).rows;
  const fa = finder(accs);
  const R = await loadRefs(db, a.companyId);
  const out: Ready[] = [];
  for (const x of docs) {
    const n0 = issues.length;
    const lines = x.lines.map((l) => {
      const ac = fa(l.v.account);
      if (!ac) { issues.push({ row: l.row, message: notFoundMsg('บัญชี', 'รหัสบัญชี', l.v.account!, 'ใส่เลขที่บัญชีหรือชื่อบัญชีในผังบัญชี') }); return null; }
      if (accs.find((y) => y.id === ac.id)!.is_control) { issues.push({ row: l.row, message: `${ac.code} เป็นบัญชีคุม ใช้บันทึกรายการไม่ได้ — ใช้บัญชีย่อย` }); return null; }
      const dept = l.v.department ? R.dept(l.v.department) : undefined, job = l.v.project ? R.job(l.v.project) : undefined;
      if (l.v.department && !dept) { issues.push({ row: l.row, message: notFoundMsg('แผนก', 'แผนก', l.v.department, 'ใส่รหัสหรือชื่อแผนกที่มีในโปรแกรม') }); return null; }
      if (l.v.project && !job) { issues.push({ row: l.row, message: notFoundMsg('Job', 'Job/โครงการ', l.v.project, 'ใส่รหัสหรือชื่อ Job ที่มีในโปรแกรม') }); return null; }
      return { account_id: ac.id, department_id: dept?.id ?? null, project_id: job?.id ?? null, description: l.v.description ?? null, amount: l.v.amount! };
    });
    if (issues.length > n0 || lines.some((l) => !l)) continue;
    out.push({ doc: x, party: null, body: { ...base(x), remark: x.head.remark ?? null, lines } });
  }
  return plan(out, async (x) => saveDp(db, a, null, parse(dpBody, x.body)) as Promise<SaveOut>);
}
