import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { bahtText, checkApprove, checkPrint, checkUnapprove, d, DOC_CLASSES, docMenuOf, findReport, normalizeLayout, PRINT_BASES, printFamily, printMenu, type ApprovalRule, type ApprovalState } from '@buddy/core';
import type { Db } from '../db.js';
import { AppError, badRequest, forbidden, notFound, parse, requireCompany, type AuthContext } from '../http.js';
import { logActivity } from '../audit.js';
import { allowedFor } from './permissions.js';

const uuid = z.string().uuid();
const kindParam = z.object({ kind: z.enum(['doc', 'journal']), id: uuid });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ไม่ถูกต้อง');
const scopeRe = /^[A-Z]{2,4}$/;
type Ctx = AuthContext & { companyId: string };
type Row = Record<string, string | null>;
const money = (v: unknown) => d(String(v ?? 0)).toFixed(2);
const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const joinAddr = (...p: Array<string | null | undefined>) => p.map((x) => (x ?? '').trim()).filter(Boolean).join(' ');

/** หัวเอกสาร + กฎรับรองของประเภทเอกสาร/สมุดรายวัน (กรองบริษัทจาก session เสมอ) */
async function loadHead(db: Db, a: Ctx, kind: 'doc' | 'journal', id: string) {
  if (kind === 'doc') {
    const r = (await sql<Row & { print_count: number; approve_level: number | null; reprint_level: number | null; is_opening: boolean }>`
      SELECT h.*, t.code AS type_code, t.name_th AS type_name, t.name_en AS type_name_en, t.approve_level, t.approve_method, t.reprint_level
        FROM doc_header h JOIN md_doc_type t ON t.id = h.doc_type_id
       WHERE h.id = ${id} AND h.company_id = ${a.companyId} AND h.deleted_at IS NULL`.execute(db)).rows[0];
    if (!r) throw notFound('เอกสาร');
    return { row: r, scope: r.doc_class!, no: r.doc_no!, table: 'doc_header',
      rule: { approveLevel: r.approve_level ?? 0, method: r.approve_method, reprintLevel: r.reprint_level ?? 0 } as ApprovalRule,
      state: { printCount: r.print_count, approved: !!r.approved_by, cancelled: r.doc_status === 'C' } as ApprovalState };
  }
  const r = (await sql<Row & { print_count: number; approve_level: number; reprint_level: number | null }>`
    SELECT j.*, b.code AS book_code, b.name_th AS book_name, b.name_en AS book_name_en, b.approve_level, b.approve_method, b.reprint_level
      FROM gl_journal j JOIN gl_journal_book b ON b.id = j.journal_book_id
     WHERE j.id = ${id} AND j.company_id = ${a.companyId} AND j.deleted_at IS NULL`.execute(db)).rows[0];
  if (!r) throw notFound('ใบสำคัญ');
  return { row: r, scope: 'GL', no: r.voucher_no!, table: 'gl_journal',
    rule: { approveLevel: r.approve_level ?? 0, method: r.approve_method, reprintLevel: r.reprint_level ?? 0 } as ApprovalRule,
    state: { printCount: r.print_count, approved: !!r.approved_by, cancelled: r.doc_status === 'C' } as ApprovalState };
}

async function journalLines(db: Db, journalIds: string[]) {
  if (!journalIds.length) return [];
  return (await sql<Row>`SELECT l.journal_id, g.account_no AS code, g.name_th AS account_name, l.description, dp.code AS dept, l.debit, l.credit
      FROM gl_journal_line l JOIN gl_account g ON g.id = l.account_id LEFT JOIN md_department dp ON dp.id = l.department_id
     WHERE l.journal_id IN (${sql.join(journalIds)}) AND l.deleted_at IS NULL ORDER BY l.journal_id, l.line_no`.execute(db)).rows
    .map((l) => ({ code: txt(l.code), name: l.description && l.description !== l.account_name ? `${l.account_name} — ${l.description}` : txt(l.account_name), dept: txt(l.dept),
      debit: d(l.debit ?? 0).isZero() ? '' : money(l.debit), credit: d(l.credit ?? 0).isZero() ? '' : money(l.credit) }));
}

/** ข้อมูลสำหรับพิมพ์เอกสาร (รูปแบบเดียวทุกชนิดเอกสาร — แบบฟอร์มเลือกคอลัมน์/ช่องที่จะแสดง) */
async function printData(db: Db, a: Ctx, kind: 'doc' | 'journal', id: string) {
  const H = await loadHead(db, a, kind, id);
  const h = H.row;
  const co = (await sql<Row>`SELECT c.name_th, c.name_en, c.address_th, c.phone, c.tax_id, c.year_system, b.name AS branch_name, b.tax_branch_no, b.address AS branch_address, b.is_head_office
      FROM sys_company c LEFT JOIN sys_branch b ON b.id = ${h.branch_id ?? null} AND b.company_id = c.id WHERE c.id = ${a.companyId}`.execute(db)).rows[0]!;
  const company = { name: txt(co.name_th), name_en: txt(co.name_en), address: txt(co.branch_address || co.address_th), phone: txt(co.phone), tax_id: txt(co.tax_id),
    branch: co.tax_branch_no ? (co.is_head_office || co.tax_branch_no === '00000' ? 'สำนักงานใหญ่' : `สาขาที่ ${co.tax_branch_no}`) : '' };
  if (kind === 'journal') {
    const lines = await journalLines(db, [id]);
    return { kind, scope: 'GL', family: 'journal' as const, title: txt(h.book_name) || 'ใบสำคัญ', title_en: txt(h.book_name_en), doc_no: txt(h.voucher_no), doc_date: txt(h.voucher_date),
      cancelled: h.doc_status === 'C', company, party: null, fields: { remark: txt(h.description), voucher_no: txt(h.voucher_no), your_ref: txt(h.reference) },
      lines, totals: [{ label: 'รวม', value: money(h.total_debit), value2: money(h.total_credit) }], amount_text: '', payments: [], notes: [], journal: [],
      print_count: H.state.printCount, approved: H.state.approved };
  }
  const fam = printFamily(H.scope);
  const party = h.customer_id || h.supplier_id ? (await sql<Row>`SELECT p.code, p.name, p.address_1, p.address_2, p.address_3, p.zip_code, p.phone, p.tax_id, p.tax_branch_no
      FROM ${sql.table(h.customer_id ? 'md_customer' : 'md_supplier')} p WHERE p.id = ${h.customer_id ?? h.supplier_id} AND p.company_id = ${a.companyId}`.execute(db)).rows[0] : undefined;
  const billTo = h.bill_to_customer_id ? (await sql<Row>`SELECT code, name, address_1, address_2, address_3, zip_code, phone, tax_id, tax_branch_no FROM md_customer WHERE id = ${h.bill_to_customer_id} AND company_id = ${a.companyId}`.execute(db)).rows[0] : undefined;
  const pp = billTo ?? party;
  const branchNo = h.party_tax_branch_no ?? pp?.tax_branch_no ?? null;
  const partyOut = pp || h.party_name ? { code: txt(pp?.code), name: txt(h.party_name || pp?.name), address: txt(h.party_address) || joinAddr(pp?.address_1, pp?.address_2, pp?.address_3, pp?.zip_code),
    phone: txt(pp?.phone), tax_id: txt(h.party_tax_id || pp?.tax_id), branch: branchNo ? (branchNo === '00000' ? 'สำนักงานใหญ่' : `สาขาที่ ${branchNo}`) : '' } : null;
  const look = async (table: string, idv: string | null | undefined, cols = 'code, name_th AS name') => (idv ? (await sql<Row>`SELECT ${sql.raw(cols)} FROM ${sql.table(table)} WHERE id = ${idv} AND company_id = ${a.companyId}`.execute(db)).rows[0] : undefined);
  const [slm, dept, wh, toWh, bank, toBank, jnl] = await Promise.all([look('md_salesperson', h.salesperson_id, 'code, name'), look('md_department', h.department_id), look('md_warehouse', h.warehouse_id),
    look('md_warehouse', h.to_warehouse_id), look('md_bank_account', h.bank_account_id, 'code, name'), look('md_bank_account', h.to_bank_account_id, 'code, name'),
    h.journal_id ? (await sql<Row>`SELECT voucher_no FROM gl_journal WHERE id = ${h.journal_id} AND company_id = ${a.companyId}`.execute(db)).rows[0] : undefined]);
  const nm = (x?: Row) => (x ? [x.code, x.name].filter(Boolean).join(' ') : '');
  const fields: Record<string, string> = {
    due_date: txt(h.due_date), credit_days: txt(h.credit_days), your_ref: txt(h.your_ref), ref_no: txt(h.ref_no), salesperson: nm(slm), department: nm(dept),
    delivery_date: txt(h.delivery_date), ship_via: txt(h.ship_via_code), payment_terms: txt(h.payment_terms), appointment_date: txt(h.appointment_date),
    warehouse: nm(wh), to_warehouse: nm(toWh), bank_account: nm(bank), to_bank_account: nm(toBank), voucher_no: txt(jnl?.voucher_no), remark: txt(h.remark),
  };

  let lines: Array<Record<string, string>> = [];
  if (fam === 'settle') {
    lines = (await sql<Row>`SELECT i.doc_no, i.doc_date, i.due_date, i.doc_class, i.net_amount, s.amount FROM doc_settlement s JOIN doc_header i ON i.id = s.invoice_header_id
        WHERE s.payment_header_id = ${id} AND s.deleted_at IS NULL ORDER BY i.doc_date, i.doc_no`.execute(db)).rows
      .map((r, i) => ({ no: String(i + 1), code: txt(r.doc_no), ref_date: txt(r.doc_date), due_date: txt(r.due_date), name: DOC_CLASSES[r.doc_class ?? '']?.label ?? '', ref_amount: money(r.net_amount), amount: money(r.amount) }));
  } else if (fam === 'bill') {
    lines = (await sql<Row>`SELECT i.doc_no, i.doc_date, i.due_date, i.doc_class, b.amount FROM doc_bill_item b JOIN doc_header i ON i.id = b.invoice_header_id
        WHERE b.bill_header_id = ${id} AND b.deleted_at IS NULL ORDER BY i.doc_date, i.doc_no`.execute(db)).rows
      .map((r, i) => ({ no: String(i + 1), code: txt(r.doc_no), ref_date: txt(r.doc_date), due_date: txt(r.due_date), name: DOC_CLASSES[r.doc_class ?? '']?.label ?? '', amount: money(r.amount) }));
  } else {
    const rows = (await sql<Row & { is_free: boolean }>`SELECT l.id AS line_id, l.line_kind, it.code AS item_code, g.account_no, g.name_th AS account_name, l.description, w.code AS wh, l.qty, u.name_th AS unit,
          l.unit_price, l.discount_text, l.line_amount, l.cost_unit, l.cost_amount, l.is_free, dp.code AS dept
        FROM doc_line l LEFT JOIN md_item it ON it.id = l.item_id LEFT JOIN gl_account g ON g.id = l.account_id LEFT JOIN md_warehouse w ON w.id = l.warehouse_id
        LEFT JOIN md_unit u ON u.id = l.unit_id LEFT JOIN md_department dp ON dp.id = l.department_id
       WHERE l.header_id = ${id} AND l.deleted_at IS NULL AND l.line_kind <> 'K' ORDER BY l.line_no`.execute(db)).rows;
    const stockCost = fam === 'stock';
    const lineNotes = new Map<string, string[]>();
    for (const n of (await sql<{ line_id: string; text: string }>`SELECT line_id, text FROM doc_note WHERE header_id = ${id} AND line_id IS NOT NULL AND deleted_at IS NULL ORDER BY seq`.execute(db)).rows) {
      if (!lineNotes.has(n.line_id)) lineNotes.set(n.line_id, []); lineNotes.get(n.line_id)!.push(n.text);
    }
    lines = rows.map((r, i) => ({
      no: String(i + 1), code: txt(r.item_code || r.account_no), name: txt(r.description || r.account_name) + (r.is_free ? ' (ของแถม)' : '') + (lineNotes.get(r.line_id!) ? '\n' + lineNotes.get(r.line_id!)!.join('\n') : ''), wh: txt(r.wh), dept: txt(r.dept),
      qty: r.qty !== null && !d(r.qty).isZero() ? d(r.qty).toString() : '', unit: txt(r.unit),
      price: stockCost ? (r.cost_unit ? d(r.cost_unit).toFixed(2) : '') : r.unit_price !== null && !d(r.unit_price).isZero() ? d(r.unit_price).toFixed(2) : '',
      disc: txt(r.discount_text), amount: stockCost ? (r.cost_amount ? money(r.cost_amount) : '') : money(r.line_amount),
    }));
    if (!lines.length && fam === 'bank') lines = [{ no: '1', code: '', name: txt(h.remark) || txt(h.type_name), amount: money(h.net_amount ?? h.amount) }];
  }
  const payments = (await sql<Row>`SELECT m.name_th AS method, p.reference_no, p.amount, c.cheque_no, c.cheque_date, c.bank_branch FROM doc_payment p
      LEFT JOIN md_payment_method m ON m.id = p.payment_method_id LEFT JOIN fin_cheque c ON c.id = p.cheque_id
     WHERE p.header_id = ${id} AND p.deleted_at IS NULL ORDER BY p.line_no`.execute(db)).rows
    .map((p) => ({ method: txt(p.method), ref: txt(p.cheque_no || p.reference_no), date: txt(p.cheque_date), amount: money(p.amount) }));
  const notes = (await sql<{ text: string }>`SELECT text FROM doc_note WHERE header_id = ${id} AND line_id IS NULL AND deleted_at IS NULL ORDER BY seq`.execute(db)).rows.map((n) => n.text);
  const jl = h.journal_id ? await journalLines(db, [h.journal_id]) : [];

  const nz = (v: unknown) => !d(String(v ?? 0)).isZero();
  const totals: Array<{ label: string; value: string }> = [];
  // ใบเพิ่มหนี้/ใบลดหนี้ (ประมวลรัษฎากร ม.86/9 86/10 · คู่มือ S-PU-04a): พิมพ์ใบกำกับเดิม มูลค่าตามใบกำกับเดิม มูลค่าที่ถูกต้อง และผลต่าง
  if (fam === 'trade' && ['CN', 'DR', 'DN', 'CP'].includes(H.scope) && h.ref_no) {
    // มูลค่าไม่รวม VAT = ยอดสุทธิ − VAT (ใช้ได้ทุกประเภทราคา)
    const base = (x: Row) => d(String(x.net_amount ?? 0)).minus(d(String(x.vat_amount ?? 0)));
    const ref = (await sql<Row>`SELECT doc_no, doc_date::text AS doc_date, net_amount, vat_amount FROM doc_header
        WHERE company_id = ${a.companyId} AND deleted_at IS NULL AND doc_no = ${h.ref_no} AND doc_class IN (${sql.join(h.module === 'AR' ? ['IV', 'HS'] : ['RR', 'HP'])})
          AND ${h.customer_id ? sql`customer_id = ${h.customer_id}` : sql`supplier_id = ${h.supplier_id}`} ORDER BY doc_date DESC LIMIT 1`.execute(db)).rows[0];
    fields.ref_invoice = `${txt(h.ref_no)}${h.ref_date ? ` ลงวันที่ ${h.ref_date}` : ''}`;
    if (ref) {
      const orig = base(ref), diff = base(h);
      const correct = ['CN', 'DN'].includes(H.scope) ? orig.minus(diff) : orig.plus(diff);
      totals.push({ label: 'มูลค่าสินค้าตามใบกำกับเดิม', value: orig.toFixed(2) }, { label: 'มูลค่าที่ถูกต้อง', value: correct.toFixed(2) }, { label: 'ผลต่าง', value: diff.toFixed(2) });
    }
  }
  if (fam === 'trade') {
    totals.push({ label: 'รวมเงิน', value: money(h.amount) });
    if (nz(h.discount_amount)) totals.push({ label: `ส่วนลด ${txt(h.discount_text)}`.trim(), value: money(h.discount_amount) }, { label: 'หลังหักส่วนลด', value: money(h.amount_after_discount) });
    if (nz(h.deposit_amount)) totals.push({ label: 'หักเงินมัดจำ', value: money(h.deposit_amount) });
    if (h.price_type !== '0') totals.push({ label: 'มูลค่าสินค้า/บริการ', value: money(h.taxable_amount) }, { label: `ภาษีมูลค่าเพิ่ม ${d(h.vat_rate ?? 0).toString()}%`, value: money(h.vat_amount) });
    totals.push({ label: 'จำนวนเงินรวมทั้งสิ้น', value: money(h.net_amount) });
  } else if (fam === 'settle') {
    totals.push({ label: 'รวมยอดชำระ', value: lines.reduce((s, l) => s.plus(d(l.amount || 0)), d(0)).toFixed(2) });
    if (nz(h.cash_discount_amount)) totals.push({ label: 'ส่วนลดเงินสด', value: money(h.cash_discount_amount) });
    if (nz(h.interest_amount)) totals.push({ label: 'ดอกเบี้ย', value: money(h.interest_amount) });
    if (nz(h.fx_amount)) totals.push({ label: d(h.fx_amount).gt(0) ? 'กำไรจากอัตราแลกเปลี่ยน' : 'ขาดทุนจากอัตราแลกเปลี่ยน', value: money(d(h.fx_amount).abs()) });
    if (nz(h.wht_amount)) totals.push({ label: 'ภาษีหัก ณ ที่จ่าย', value: money(h.wht_amount) });
    totals.push({ label: 'ยอดสุทธิ', value: money(h.net_amount) });
  } else if (fam === 'stock') {
    if (lines.some((l) => l.amount)) totals.push({ label: 'รวมมูลค่า', value: lines.reduce((s, l) => s.plus(d(l.amount || 0)), d(0)).toFixed(2) });
  } else {
    if (nz(h.vat_amount)) totals.push({ label: 'มูลค่าก่อนภาษี', value: money(h.taxable_amount) }, { label: 'ภาษีมูลค่าเพิ่ม', value: money(h.vat_amount) });
    if (nz(h.wht_amount)) totals.push({ label: 'ภาษีหัก ณ ที่จ่าย', value: money(h.wht_amount) });
    totals.push({ label: 'รวมทั้งสิ้น', value: money(nz(h.net_amount) ? h.net_amount : h.amount) });
  }
  const net = totals.at(-1)?.value ?? '0';
  return { kind, scope: H.scope, family: fam, title: txt(h.type_name) || DOC_CLASSES[H.scope]?.label || 'เอกสาร', title_en: txt(h.type_name_en), doc_no: txt(h.doc_no), doc_date: txt(h.doc_date),
    cancelled: h.doc_status === 'C', company, party: partyOut, fields, lines, totals, amount_text: fam === 'stock' ? '' : bahtText(net), payments, notes, journal: jl,
    print_count: H.state.printCount, approved: H.state.approved };
}

/** พิมพ์เอกสาร (S-RD-01 · S-UI-08/09/10) · รับรองเอกสาร (S-UI-11/12 · S-GL-10) · รายละเอียดแฟ้มข้อมูล (S-RD-06) · แบบฟอร์ม (S-RD-02) · รายงานของผู้ใช้ (S-RD-03/04) */
export function printRoutes(app: FastifyInstance, db: Db) {
  const formsOf = async (a: Ctx, scope: string) => (await db.selectFrom('sys_print_form').select(['slot', 'name', 'base', 'layout', 'status', 'updated_at'])
    .where('company_id', '=', a.companyId).where('scope', '=', scope).where('deleted_at', 'is', null).orderBy('slot').execute())
    .map((f) => ({ ...f, layout: typeof f.layout === 'string' ? JSON.parse(f.layout) : f.layout }));

  app.get('/api/v1/print/:kind/:id', async (req) => {
    const a = requireCompany(req);
    const { kind, id } = parse(kindParam, req.params);
    const data = await printData(db, a, kind, id);
    const H = await loadHead(db, a, kind, id);
    return { data, forms: printMenu(data.scope, await formsOf(a, data.scope), data.title), rule: H.rule, block: checkPrint(H.rule, H.state, a.approvalLevel, a.isAdmin) };
  });

  /** ก่อนสั่งพิมพ์ออกเครื่องพิมพ์: ตรวจกฎรับรอง/พิมพ์ซ้ำ แล้วนับจำนวนครั้งที่พิมพ์ (ดูทางจอภาพไม่นับ) */
  app.post('/api/v1/print/:kind/:id/printed', async (req) => {
    const a = requireCompany(req);
    const { kind, id } = parse(kindParam, req.params);
    const b = parse(z.object({ slot: z.number().int().min(1).max(9).default(1) }), req.body ?? {});
    const H = await loadHead(db, a, kind, id);
    const r = await allowedFor(db, a, docMenuOf(H.scope, !!H.row.is_opening), 'print');
    if (r.screenOnly) throw forbidden('สิทธิ์ของคุณพิมพ์ได้เฉพาะแสดงทางจอภาพ — ติดต่อผู้ดูแลระบบเพื่อขอสิทธิ์พิมพ์ออกเครื่องพิมพ์');
    const why = checkPrint(H.rule, H.state, a.approvalLevel, a.isAdmin);
    if (why) throw new AppError(409, 'PRINT_BLOCKED', why);
    await db.updateTable(H.table as 'doc_header').set({ print_count: sql`print_count + 1` as never, last_printed_by: a.userId, last_printed_at: sql`now()` as never })
      .where('id', '=', id).where('company_id', '=', a.companyId).execute();
    await logActivity(db, a, { module: kind === 'doc' ? String(H.row.module) : 'GL', action: H.state.printCount > 0 ? 'REPRINT' : 'PRINT', docNo: H.no, table: H.table, rowId: id, detail: { slot: b.slot, count: H.state.printCount + 1 } });
    return { print_count: H.state.printCount + 1 };
  });

  /** รับรองเอกสารใบนี้ (Alt+O) / ยกเลิกการรับรอง (Ctrl+O) */
  app.post('/api/v1/approve/:kind/:id', async (req) => {
    const a = requireCompany(req);
    const { kind, id } = parse(kindParam, req.params);
    const { undo } = parse(z.object({ undo: z.boolean().default(false) }), req.body ?? {});
    const H = await loadHead(db, a, kind, id);
    const why = undo ? checkUnapprove(H.rule, H.state, a.approvalLevel, a.isAdmin) : checkApprove(H.rule, H.state, a.approvalLevel, a.isAdmin);
    if (why) throw new AppError(409, 'APPROVE_BLOCKED', why);
    await db.updateTable(H.table as 'doc_header').set(undo ? { approved_by: null, approved_at: null } : { approved_by: a.userId, approved_at: sql`now()` as never })
      .where('id', '=', id).where('company_id', '=', a.companyId).execute();
    await logActivity(db, a, { module: kind === 'doc' ? String(H.row.module) : 'GL', action: undo ? 'UNAPPROVE' : 'APPROVE', docNo: H.no, table: H.table, rowId: id });
    return { approved: !undo };
  });

  /** รับรองเอกสารเป็นช่วง (Alt+Shift+O · S-UI-12): ตามประเภทเอกสาร/สมุดรายวัน ช่วงเลขที่และวันที่ — นับที่รับรองได้และไม่ได้พร้อมเหตุผล */
  app.post('/api/v1/approve-range', async (req) => {
    const a = requireCompany(req);
    const b = parse(z.object({ kind: z.enum(['doc', 'journal']), type_id: uuid, from_no: z.string().trim().max(30).optional().default(''), to_no: z.string().trim().max(30).optional().default(''),
      from_date: isoDate, to_date: isoDate }), req.body ?? {});
    if (b.from_date > b.to_date) throw badRequest('วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด');
    const ids = b.kind === 'doc'
      ? (await sql<{ id: string }>`SELECT id FROM doc_header WHERE company_id = ${a.companyId} AND doc_type_id = ${b.type_id} AND deleted_at IS NULL AND doc_status <> 'C' AND approved_by IS NULL
          AND doc_date BETWEEN ${b.from_date} AND ${b.to_date} ${b.from_no ? sql`AND doc_no >= ${b.from_no}` : sql``} ${b.to_no ? sql`AND doc_no <= ${b.to_no}` : sql``} ORDER BY doc_no LIMIT 5001`.execute(db)).rows
      : (await sql<{ id: string }>`SELECT id FROM gl_journal WHERE company_id = ${a.companyId} AND journal_book_id = ${b.type_id} AND deleted_at IS NULL AND doc_status <> 'C' AND approved_by IS NULL
          AND voucher_date BETWEEN ${b.from_date} AND ${b.to_date} ${b.from_no ? sql`AND voucher_no >= ${b.from_no}` : sql``} ${b.to_no ? sql`AND voucher_no <= ${b.to_no}` : sql``} ORDER BY voucher_no LIMIT 5001`.execute(db)).rows;
    if (ids.length > 5000) throw badRequest('ช่วงนี้มีเอกสารเกิน 5,000 ใบ — แบ่งช่วงวันที่ให้แคบลง');
    let approved = 0;
    const skipped: Array<{ doc_no: string; reason: string }> = [];
    for (const { id } of ids) {
      const H = await loadHead(db, a, b.kind, id);
      const why = checkApprove(H.rule, H.state, a.approvalLevel, a.isAdmin);
      if (why) { skipped.push({ doc_no: H.no, reason: why }); continue; }
      await db.updateTable(H.table as 'doc_header').set({ approved_by: a.userId, approved_at: sql`now()` as never }).where('id', '=', id).where('company_id', '=', a.companyId).execute();
      await logActivity(db, a, { module: b.kind === 'doc' ? String(H.row.module) : 'GL', action: 'APPROVE', docNo: H.no, table: H.table, rowId: id, detail: { range: true } });
      approved++;
    }
    return { approved, not_approved: skipped.length, skipped: skipped.slice(0, 200) };
  });

  /** รายละเอียดแฟ้มข้อมูลของเอกสาร (S-RD-06): ผู้สร้าง/แก้ไข/พิมพ์/รับรอง ลำดับระเบียน */
  app.get('/api/v1/record-info/:kind/:id', async (req) => {
    const a = requireCompany(req);
    const { kind, id } = parse(kindParam, req.params);
    const H = await loadHead(db, a, kind, id);
    const h = H.row;
    const users = [h.created_by, h.updated_by, h.last_printed_by, h.approved_by].filter((x): x is string => !!x);
    const names = new Map(users.length ? (await db.selectFrom('sys_user').select(['id', 'username', 'display_name']).where('id', 'in', users).execute()).map((u) => [u.id, `${u.username} ${u.display_name}`]) : []);
    const who = (x: string | null | undefined) => (x ? names.get(x) ?? '' : '');
    const pos = kind === 'doc'
      ? (await sql<{ n: string; total: string }>`SELECT count(*) FILTER (WHERE doc_no <= ${h.doc_no}) AS n, count(*) AS total FROM doc_header WHERE company_id = ${a.companyId} AND doc_type_id = ${h.doc_type_id} AND deleted_at IS NULL`.execute(db)).rows[0]!
      : (await sql<{ n: string; total: string }>`SELECT count(*) FILTER (WHERE voucher_no <= ${h.voucher_no}) AS n, count(*) AS total FROM gl_journal WHERE company_id = ${a.companyId} AND journal_book_id = ${h.journal_book_id} AND deleted_at IS NULL`.execute(db)).rows[0]!;
    const lines = kind === 'doc' ? (await sql<{ n: string }>`SELECT count(*) AS n FROM doc_line WHERE header_id = ${id} AND deleted_at IS NULL`.execute(db)).rows[0]!.n
      : (await sql<{ n: string }>`SELECT count(*) AS n FROM gl_journal_line WHERE journal_id = ${id} AND deleted_at IS NULL`.execute(db)).rows[0]!.n;
    const log = await db.selectFrom('sys_activity_log').select(['occurred_at', 'action', 'user_id']).where('company_id', '=', a.companyId).where('row_id', '=', id).orderBy('seq', 'desc').limit(20).execute();
    const logUsers = [...new Set(log.map((l) => l.user_id).filter((x): x is string => !!x && !names.has(x)))];
    if (logUsers.length) for (const u of await db.selectFrom('sys_user').select(['id', 'username', 'display_name']).where('id', 'in', logUsers).execute()) names.set(u.id, `${u.username} ${u.display_name}`);
    return {
      table: H.table, table_th: kind === 'doc' ? 'หัวเอกสาร (doc_header) + บรรทัดรายการ (doc_line)' : 'ใบสำคัญ (gl_journal) + รายการเดบิต/เครดิต (gl_journal_line)',
      doc_no: H.no, type: kind === 'doc' ? `${h.type_code} ${h.type_name}` : `${h.book_code} ${h.book_name}`, id, line_count: Number(lines),
      created_at: h.created_at, created_by: who(h.created_by), updated_at: h.updated_at, updated_by: who(h.updated_by), row_version: h.row_version,
      print_count: H.state.printCount, last_printed_at: h.last_printed_at ?? null, last_printed_by: who(h.last_printed_by ?? null),
      approved_at: h.approved_at ?? null, approved_by: who(h.approved_by), status: h.doc_status, gl_posted: h.gl_posted ?? null,
      rule: H.rule, position: { index: Number(pos.n), total: Number(pos.total) },
      log: log.map((l) => ({ at: l.occurred_at, action: l.action, user: who(l.user_id) })),
    };
  });

  // ---- แบบฟอร์มพิมพ์ของบริษัท (S-RD-02 ทำแบบใหม่: แก้จากหน้าจอแทนภาษารายงาน)
  app.get('/api/v1/print-forms', async (req) => {
    const a = requireCompany(req);
    const { scope } = parse(z.object({ scope: z.string().regex(scopeRe, 'ชนิดเอกสารไม่ถูกต้อง') }), req.query);
    const rows = await formsOf(a, scope);
    const latest = scope === 'GL'
      ? (await sql<{ id: string }>`SELECT id FROM gl_journal WHERE company_id = ${a.companyId} AND deleted_at IS NULL ORDER BY voucher_date DESC, created_at DESC LIMIT 1`.execute(db)).rows[0]
      : (await sql<{ id: string }>`SELECT id FROM doc_header WHERE company_id = ${a.companyId} AND doc_class = ${scope} AND deleted_at IS NULL ORDER BY doc_date DESC, created_at DESC LIMIT 1`.execute(db)).rows[0];
    return { menu: printMenu(scope, rows), custom: rows, sample: latest ? { kind: scope === 'GL' ? 'journal' : 'doc', id: latest.id } : null };
  });
  app.put('/api/v1/print-forms/:scope/:slot', async (req) => {
    const a = requireCompany(req);
    const p = parse(z.object({ scope: z.string().regex(scopeRe), slot: z.coerce.number().int().min(1).max(9) }), req.params);
    const b = parse(z.object({ name: z.string().trim().min(1, 'ป้อนชื่อแบบฟอร์ม').max(120), base: z.enum(PRINT_BASES.map((x) => x.key) as [string, ...string[]]), layout: z.unknown(), status: z.enum(['A', 'I']).default('A') }), req.body);
    const layout = JSON.stringify(normalizeLayout(p.scope, b.base as 'grid', b.layout));
    const cur = await db.selectFrom('sys_print_form').select('id').where('company_id', '=', a.companyId).where('scope', '=', p.scope).where('slot', '=', p.slot).where('deleted_at', 'is', null).executeTakeFirst();
    if (cur) await db.updateTable('sys_print_form').set({ name: b.name, base: b.base, layout, status: b.status, updated_by: a.userId }).where('id', '=', cur.id).execute();
    else await db.insertInto('sys_print_form').values({ company_id: a.companyId, scope: p.scope, slot: p.slot, name: b.name, base: b.base, layout, status: b.status, created_by: a.userId, updated_by: a.userId }).execute();
    await logActivity(db, a, { module: 'RP', action: cur ? 'EDIT' : 'ADD', docNo: `${p.scope}-${p.slot}`, table: 'sys_print_form', detail: { name: b.name, base: b.base } });
    return { ok: true };
  });
  app.delete('/api/v1/print-forms/:scope/:slot', async (req) => {
    const a = requireCompany(req);
    const p = parse(z.object({ scope: z.string().regex(scopeRe), slot: z.coerce.number().int().min(1).max(9) }), req.params);
    const r = await db.updateTable('sys_print_form').set({ deleted_at: sql`now()` as never, updated_by: a.userId }).where('company_id', '=', a.companyId).where('scope', '=', p.scope).where('slot', '=', p.slot).where('deleted_at', 'is', null).executeTakeFirst();
    if (!r.numUpdatedRows) throw notFound('แบบฟอร์มที่บริษัทกำหนด (ฟอร์มต้นแบบในโปรแกรมลบไม่ได้)');
    await logActivity(db, a, { module: 'RP', action: 'DELETE', docNo: `${p.scope}-${p.slot}`, table: 'sys_print_form' });
    return { ok: true };
  });

  // ---- รายงานที่ผู้ใช้สร้างจากรายงานต้นฉบับ (S-RD-03/04 ทำแบบใหม่: บันทึกเงื่อนไข + คอลัมน์ แทนภาษารายงาน)
  const custom = z.object({ code: z.string().trim().regex(/^[A-Z0-9]{1,10}$/i, 'รหัสรายงานใช้ตัวอักษรอังกฤษ/ตัวเลข 1–10 ตัว').transform((v) => v.toUpperCase()),
    base_code: z.string().trim().min(1).max(10), name: z.string().trim().min(1, 'ป้อนชื่อรายงาน').max(120), params: z.record(z.unknown()).default({}),
    hidden_cols: z.array(z.string().max(40)).max(40).default([]), landscape: z.boolean().nullable().default(null) });
  app.get('/api/v1/rpt-custom', async (req) => {
    const a = requireCompany(req);
    const rows = await db.selectFrom('sys_report_custom').select(['id', 'code', 'base_code', 'name', 'params', 'hidden_cols', 'landscape', 'updated_at'])
      .where('company_id', '=', a.companyId).where('deleted_at', 'is', null).orderBy('code').execute();
    return rows.map((r) => ({ ...r, params: typeof r.params === 'string' ? JSON.parse(r.params) : r.params, hidden_cols: typeof r.hidden_cols === 'string' ? JSON.parse(r.hidden_cols) : r.hidden_cols ?? [] }));
  });
  const saveCustom = async (a: Ctx, b: z.infer<typeof custom>, id?: string) => {
    if (!findReport(b.base_code)) throw badRequest('ไม่พบรายงานต้นฉบับ ' + b.base_code);
    const dup = await db.selectFrom('sys_report_custom').select('id').where('company_id', '=', a.companyId).where('code', '=', b.code).where('deleted_at', 'is', null).executeTakeFirst();
    if (dup && dup.id !== id) throw badRequest(`รหัสรายงาน ${b.code} มีอยู่แล้ว — ใช้รหัสอื่น`);
    const vals = { code: b.code, base_code: b.base_code, name: b.name, params: JSON.stringify(b.params), hidden_cols: JSON.stringify(b.hidden_cols), landscape: b.landscape, updated_by: a.userId };
    if (id) {
      const r = await db.updateTable('sys_report_custom').set(vals).where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
      if (!r.numUpdatedRows) throw notFound('รายงานของผู้ใช้');
    } else id = (await db.insertInto('sys_report_custom').values({ ...vals, company_id: a.companyId, created_by: a.userId }).returning('id').executeTakeFirstOrThrow()).id;
    await logActivity(db, a, { module: 'RP', action: 'SAVE_REPORT', docNo: b.code, table: 'sys_report_custom', rowId: id, detail: { base: b.base_code, name: b.name } });
    return { id };
  };
  app.post('/api/v1/rpt-custom', async (req) => saveCustom(requireCompany(req), parse(custom, req.body)));
  app.put('/api/v1/rpt-custom/:id', async (req) => saveCustom(requireCompany(req), parse(custom, req.body), parse(z.object({ id: uuid }), req.params).id));
  app.delete('/api/v1/rpt-custom/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const r = await db.updateTable('sys_report_custom').set({ deleted_at: sql`now()` as never, updated_by: a.userId }).where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!r.numUpdatedRows) throw notFound('รายงานของผู้ใช้');
    await logActivity(db, a, { module: 'RP', action: 'DELETE', table: 'sys_report_custom', rowId: id });
    return { ok: true };
  });
}
