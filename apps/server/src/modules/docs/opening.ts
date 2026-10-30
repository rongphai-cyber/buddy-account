import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { computeDoc, d, dueDate } from '@buddy/core';
import type { Db } from '../../db.js';
import { badRequest, notFound, parse, requireCompany, type AuthContext } from '../../http.js';
import { logActivity } from '../../audit.js';
import { cancelDocument } from './engine.js';
import { branchOf } from './payments.js';

/**
 * ลูกหนี้/เจ้าหนี้คงค้างยกมา (คู่มือ S-OB-03/04): บิลค้าง ณ วันเริ่มใช้ — เลขที่ป้อนเอง ลงวันที่ก่อนเริ่มใช้
 * เป็นเอกสาร IV/RR ที่ is_opening = true: ไม่ลงบัญชี (ยอดบัญชีป้อนที่ บันทึกยอดยกมา) ไม่ตัดสต๊อก ไม่เข้าแฟ้มภาษี
 * ภาษีเกณฑ์เงินสด (ไม่ระบุวันที่ภาษีเกิด) เกิดเมื่อรับ/จ่ายชำระในระบบ
 */
type Ctx = AuthContext & { companyId: string };
export const OPENING_KINDS = [
  { path: 'ar-opening', cls: 'IV', module: 'AR', menu: 'FI.AR.OB', party: 'customer', label: 'ลูกหนี้คงค้าง-ยกมา' },
  { path: 'ap-opening', cls: 'RR', module: 'AP', menu: 'FI.AP.OB', party: 'supplier', label: 'เจ้าหนี้คงค้าง-ยกมา' },
] as const;
type Kind = (typeof OPENING_KINDS)[number];
const uuid = z.string().uuid();
const optId = uuid.nullable().optional().transform((v) => v ?? null);
const str = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));
const num = z.union([z.number(), z.string()]).transform((v) => String(v === '' ? 0 : v)).refine((v) => !Number.isNaN(Number(v)), 'ต้องเป็นตัวเลข');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ไม่ถูกต้อง');
const body = z.object({
  party_id: z.string({ required_error: 'เลือกลูกค้า/ผู้จำหน่าย', invalid_type_error: 'เลือกลูกค้า/ผู้จำหน่าย' }).uuid('เลือกลูกค้า/ผู้จำหน่าย'),
  doc_no: z.string().trim().min(1, 'ป้อนเลขที่เอกสาร (แนะนำใส่ปีนำหน้า เช่น IV67/0001)').max(30), doc_date: isoDate, ref_no: str(30),
  department_id: optId, salesperson_id: optId, credit_days: z.coerce.number().int().min(0).max(999).nullable().optional(), due_date: isoDate.nullable().optional(),
  price_type: z.enum(['0', '1', '2']), amount: num, discount_text: str(20), vat_rate: num,
  /** ปัดเศษไม่ตรงบิล: อัตรา 0% แล้วป้อนจำนวนภาษีเอง (คู่มือหน้า 143) */
  vat_amount: num.nullable().optional(),
  /** วันที่ภาษีเกิดขึ้นแล้ว — ว่าง = เกณฑ์เงินสด (ภาษีเกิดเมื่อชำระ) */
  vat_date: isoDate.nullable().optional(), remark: str(2000),
});

/** วันเริ่มใช้โปรแกรม = วันเริ่มปีบัญชีแรกที่ยังไม่ปิด */
async function startDate(db: Db, companyId: string) {
  const y = await db.selectFrom('gl_fiscal_year').select('start_date').where('company_id', '=', companyId).where('deleted_at', 'is', null).where('status', '<>', 'C').orderBy('start_date').executeTakeFirst();
  return y ? String(y.start_date).slice(0, 10) : null;
}

async function save(db: Db, a: Ctx, K: Kind, id: string | null, b: z.infer<typeof body>) {
  const start = await startDate(db, a.companyId);
  if (start && b.doc_date >= start) throw badRequest(`วันที่ต้องก่อนวันเริ่มใช้โปรแกรม (${start}) — ยอดยกมาคือบิลที่ค้าง ณ วันเริ่มใช้`);
  const partyTbl = K.party === 'customer' ? 'md_customer' : 'md_supplier';
  const party = await db.selectFrom(partyTbl).select(['id', 'code', 'title', 'name', 'address_1', 'address_2', 'address_3', 'zip_code', 'tax_id', 'tax_branch_no', 'credit_days']).where('id', '=', b.party_id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
  if (!party) throw badRequest(`ไม่พบ${K.party === 'customer' ? 'ลูกค้า' : 'ผู้จำหน่าย'}นี้`);
  const dt = await db.selectFrom('md_doc_type').select(['id']).where('company_id', '=', a.companyId).where('doc_class', '=', K.cls).where('deleted_at', 'is', null).orderBy('code').executeTakeFirst();
  if (!dt) throw badRequest(`ยังไม่มีประเภทเอกสาร${K.cls === 'IV' ? 'ขายเงินเชื่อ' : 'ซื้อเงินเชื่อ'} — เพิ่มที่ เริ่มระบบ › เลขที่เอกสาร`);
  const manualVat = b.vat_amount != null && d(b.vat_rate).isZero();
  const calc = computeDoc({ price_type: b.price_type, vat_rate: b.vat_rate, discount_text: b.discount_text, lines: [{ qty: 1, unit_price: b.amount }] });
  if (calc.errors.length) throw badRequest(calc.errors[0]!);
  const vat = manualVat ? d(b.vat_amount!) : d(calc.vat_amount);
  const net = manualVat ? d(calc.amount_after_discount).plus(b.price_type === '1' ? 0 : vat) : d(calc.net_amount);
  if (net.lte(0)) throw badRequest('จำนวนเงินรวมทั้งสิ้นต้องมากกว่า 0');
  const credit = b.credit_days ?? party.credit_days ?? 0;
  const header = {
    doc_class: K.cls, module: K.module, doc_no: b.doc_no, doc_date: b.doc_date, is_opening: true, customer_id: K.party === 'customer' ? party.id : null, supplier_id: K.party === 'supplier' ? party.id : null,
    party_name: [party.title, party.name].filter(Boolean).join(' ').slice(0, 200), party_address: [party.address_1, party.address_2, party.address_3, party.zip_code].filter(Boolean).join(' ').slice(0, 500) || null,
    party_tax_id: party.tax_id, party_tax_branch_no: party.tax_branch_no, ref_no: b.ref_no, department_id: b.department_id, salesperson_id: b.salesperson_id,
    credit_days: credit, due_date: b.due_date ?? dueDate(b.doc_date, credit), price_type: b.price_type, vat_rate: b.vat_rate, discount_text: b.discount_text,
    amount: calc.amount, discount_amount: calc.discount_amount, amount_after_discount: calc.amount_after_discount, taxable_amount: manualVat ? net.minus(vat).toFixed(2) : calc.taxable_amount,
    vat_amount: vat.toFixed(2), net_amount: net.toFixed(2), vat_basis: b.vat_date ? '1' : '2', vat_date: b.vat_date ?? null, remark: b.remark, gl_posted: 'N', updated_by: a.userId,
  };
  return db.transaction().execute(async (tx) => {
    // ยอดยกมาไม่ลงบัญชี — ลงวันที่ในปีก่อนที่ปิดงวดแล้วได้ (วันที่ต้องก่อนวันเริ่มใช้โปรแกรม ตรวจแล้วข้างบน)
    await sql`SELECT set_config('app.allow_locked_period', 'on', true)`.execute(tx);
    const dup = await tx.selectFrom('doc_header').select('id').where('company_id', '=', a.companyId).where('doc_type_id', '=', dt.id).where('doc_no', '=', b.doc_no).where('deleted_at', 'is', null).executeTakeFirst();
    if (dup && dup.id !== id) throw badRequest(`เลขที่ ${b.doc_no} มีอยู่แล้ว — แนะนำใส่ปีนำหน้าเพื่อไม่ให้ซ้ำกับเลขปีปัจจุบัน`);
    let hid = id;
    if (id) {
      const cur = await tx.selectFrom('doc_header').select(['doc_status', 'is_opening', 'doc_class']).where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
      if (!cur || !cur.is_opening || cur.doc_class !== K.cls) throw notFound(K.label);
      if (cur.doc_status === 'C') throw badRequest('เอกสารนี้ถูกยกเลิกแล้ว แก้ไขไม่ได้');
      const paid = (await sql`SELECT 1 FROM doc_settlement s LEFT JOIN doc_header p ON p.id = s.payment_header_id WHERE s.invoice_header_id = ${id} AND s.deleted_at IS NULL AND coalesce(p.doc_status, 'N') <> 'C' LIMIT 1`.execute(tx)).rows.length;
      if (paid) throw badRequest('บิลนี้มีการรับ/จ่ายชำระแล้ว แก้ไขไม่ได้');
      await tx.updateTable('doc_header').set(header).where('id', '=', id).execute();
    } else {
      hid = (await tx.insertInto('doc_header').values({ ...header, company_id: a.companyId, branch_id: await branchOf(tx, a), doc_type_id: dt.id, doc_status: 'N', created_by: a.userId }).returning('id').executeTakeFirstOrThrow()).id;
    }
    await logActivity(tx, a, { module: K.module, action: id ? 'EDIT' : 'ADD', docNo: b.doc_no, table: 'doc_header', rowId: hid, detail: { opening: true } });
    return { id: hid, doc_no: b.doc_no, net_amount: net.toFixed(2) };
  });
}

export function openingRoutes(app: FastifyInstance, db: Db) {
  for (const K of OPENING_KINDS) {
    const base = `/api/v1/${K.path}`;
    const partyTbl = K.party === 'customer' ? 'md_customer' : 'md_supplier';
    const partyCol = K.party === 'customer' ? 'customer_id' : 'supplier_id';
    const view = K.module === 'AR' ? 'v_ar_outstanding' : 'v_ap_outstanding';
    app.get(base, async (req) => {
      const a = requireCompany(req);
      const q = parse(z.object({ q: z.string().optional(), status: z.enum(['N', 'C', 'all']).default('all'), limit: z.coerce.number().int().min(1).max(2000).default(500) }), req.query);
      const like = q.q?.trim() ? `%${q.q.trim()}%` : null;
      const rows = (await sql`SELECT h.id, h.doc_no, h.doc_date, h.due_date, h.ref_no, h.party_name, p.code AS party_code, h.net_amount, h.vat_basis, h.doc_status,
          (SELECT o.outstanding FROM ${sql.table(view)} o WHERE o.header_id = h.id) AS outstanding
          FROM doc_header h LEFT JOIN ${sql.table(partyTbl)} p ON p.id = h.${sql.ref(partyCol)}
         WHERE h.company_id = ${a.companyId} AND h.doc_class = ${K.cls} AND h.is_opening AND h.deleted_at IS NULL
           ${q.status !== 'all' ? sql`AND h.doc_status = ${q.status}` : sql``} ${like ? sql`AND (h.doc_no ILIKE ${like} OR h.party_name ILIKE ${like} OR p.code ILIKE ${like})` : sql``}
         ORDER BY p.code, h.doc_date, h.doc_no LIMIT ${q.limit}`.execute(db)).rows as Array<{ outstanding: string | null; doc_status: string }>;
      const start = await startDate(db, a.companyId);
      return { rows, start_date: start, total: rows.filter((r) => r.doc_status !== 'C').reduce((s, r) => s.plus(d(r.outstanding ?? 0)), d(0)).toFixed(2) };
    });
    app.get(`${base}/:id`, async (req) => {
      const a = requireCompany(req);
      const { id } = parse(z.object({ id: uuid }), req.params);
      const h = await db.selectFrom('doc_header').selectAll().where('id', '=', id).where('company_id', '=', a.companyId).where('doc_class', '=', K.cls).where('is_opening', '=', true).where('deleted_at', 'is', null).executeTakeFirst();
      if (!h) throw notFound(K.label);
      const pc = await db.selectFrom(partyTbl).select('code').where('id', '=', (h.customer_id ?? h.supplier_id)!).executeTakeFirst();
      const settled = (await sql`SELECT coalesce(p.id, j.id) AS id, CASE WHEN p.id IS NULL THEN 'GL' ELSE p.doc_class END AS doc_class, coalesce(p.doc_no, j.voucher_no) AS doc_no, coalesce(p.doc_date, j.voucher_date) AS doc_date, s.amount, coalesce(p.doc_status, j.doc_status) AS doc_status
          FROM doc_settlement s LEFT JOIN doc_header p ON p.id = s.payment_header_id LEFT JOIN gl_journal j ON j.id = s.payment_journal_id
         WHERE s.invoice_header_id = ${id} AND s.deleted_at IS NULL ORDER BY 2`.execute(db)).rows as Array<{ doc_status: string }>;
      const out = (await sql<{ outstanding: string }>`SELECT outstanding FROM ${sql.table(view)} WHERE header_id = ${id}`.execute(db)).rows[0];
      return { ...h, party_code: pc?.code ?? null, settlements: settled, outstanding: out?.outstanding ?? null, editable: h.doc_status !== 'C' && !settled.some((x) => x.doc_status !== 'C'), start_date: await startDate(db, a.companyId) };
    });
    app.post(base, async (req) => save(db, requireCompany(req), K, null, parse(body, req.body)));
    app.put(`${base}/:id`, async (req) => save(db, requireCompany(req), K, parse(z.object({ id: uuid }), req.params).id, parse(body, req.body)));
    app.post(`${base}/:id/cancel`, async (req) => {
      const a = requireCompany(req);
      const { id } = parse(z.object({ id: uuid }), req.params);
      const { reason } = parse(z.object({ reason: z.string().trim().min(1, 'ป้อนเหตุผลที่ยกเลิก').max(200) }), req.body);
      const h = await db.selectFrom('doc_header').select('id').where('id', '=', id).where('company_id', '=', a.companyId).where('doc_class', '=', K.cls).where('is_opening', '=', true).where('deleted_at', 'is', null).executeTakeFirst();
      if (!h) throw notFound(K.label);
      return cancelDocument(db, a, id, reason);
    });
  }
}
