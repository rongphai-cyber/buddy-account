import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { allocateKit, computeDoc, d, dueDate, TRADE_KINDS, type TradeKind } from '@buddy/core';
import type { Db } from '../../db.js';
import { badRequest, notFound, parse, requireCompany, type AuthContext } from '../../http.js';
import { logActivity } from '../../audit.js';
import { companySettings } from '../../company-template.js';
import { periodFor } from '../gl/journals.js';
import { activeSettlement, cancelDocument, postDocument, unpostDocument, docNoFor, docNoInput } from './engine.js';
import { checkNegative, issueCost, recostAfter, stockSettings } from './stockcost.js';
import { checkWht, readMoneyParts, whtSchema, writeWht } from './payments.js';

type Ctx = AuthContext & { companyId: string };
const uuid = z.string().uuid();
const optId = uuid.nullable().optional().transform((v) => v ?? null);
const str = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));
const num = z.union([z.number(), z.string()]).transform((v) => String(v === '' ? 0 : v)).refine((v) => !Number.isNaN(Number(v)), 'ต้องเป็นตัวเลข');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ไม่ถูกต้อง');

export const tradeBody = z.object({
  doc_type_id: uuid, doc_no: docNoInput, doc_date: isoDate, party_id: z.string({ required_error: 'เลือกลูกค้า/ผู้จำหน่าย', invalid_type_error: 'เลือกลูกค้า/ผู้จำหน่าย' }).uuid('เลือกลูกค้า/ผู้จำหน่าย'), bill_to_customer_id: optId,
  party_tax_branch_no: str(5), your_ref: str(30), ref_no: str(30), ref_date: isoDate.nullable().optional(), ref_header_id: optId,
  department_id: optId, salesperson_id: optId, sales_area_code: str(10), ship_via_code: str(10), ship_to_id: optId, warehouse_id: optId,
  credit_days: z.coerce.number().int().min(0).max(999).nullable().optional(), due_date: isoDate.nullable().optional(),
  price_type: z.enum(['0', '1', '2']), vat_rate: num, vat_basis: z.enum(['1', '2']).nullable().optional(), discount_text: str(20),
  remark: str(2000), payment_terms: str(60),
  /** ใบสั่งขาย/ใบสั่งซื้อ: วันส่งของ/รับของ */
  delivery_date: isoDate.nullable().optional(),
  lines: z.array(z.object({
    item_id: uuid, description: str(200), warehouse_id: optId, qty: num, unit_id: optId, factor: num.optional(), unit_price: num,
    discount_text: str(20), is_free: z.boolean().default(false), return_to_stock: z.boolean().default(false), department_id: optId,
    /** บิลที่อ้างใบสั่งขาย/ใบสั่งซื้อ: บรรทัดต้นทาง */
    source_line_id: optId, delivery_date: isoDate.nullable().optional(),
    /** ประเภท VAT รายบรรทัด (ข้อกำหนดเจ้าของ): 0 = ยกเว้น VAT · 1 = มี VAT · 2 = อัตรา 0% — ไม่ส่ง = ตามแฟ้มสินค้า · หน้าเอกสารมาก่อนแฟ้มสินค้า */
    vat_code: z.enum(['0', '1', '2']).nullable().optional(),
  })).min(1, 'ป้อนรายการสินค้าอย่างน้อย 1 บรรทัด').max(500),
  payments: z.array(z.object({ payment_method_id: uuid, amount: num, reference_no: str(30) })).max(20).default([]),
  /** หักเงินมัดจำ (AI → บิลขาย, AE → บิลซื้อ) ยอดตามประเภทราคาของบิล */
  deposits: z.array(z.object({ header_id: uuid, amount: num })).max(20).default([]),
  /** ซื้อเงินสด: ภาษีหัก ณ ที่จ่าย (เข้าแฟ้ม ภ.ง.ด.3/53 + 50 ทวิ) · ขายเงินสด: ยอดที่ลูกค้าหักไว้ (ลูกค้าออก 50 ทวิ ให้) */
  wht: whtSchema, wht_amount: num.default('0'),
});
type Body = z.infer<typeof tradeBody>;
/** บิลที่หักเงินมัดจำได้ (ขายเชื่อ/ขายสด/ซื้อเชื่อ/ซื้อสด) */
const DEPOSIT_CLASSES = ['IV', 'HS', 'RR', 'HP'];
/** ผลต่อสต๊อกของเอกสาร (รหัส POSOPR ของ Express): 9 ขาย −, 2 รับคืน +, 0 ซื้อ +, 7 ส่งคืน − (atLine: มูลค่าตามบรรทัด ไม่ใช่ต้นทุนเฉลี่ย) */
const STOCK_MOVE: Record<string, { code: string; eff: 1 | -1; purchase?: boolean; onlyReturn?: boolean; atLine?: boolean }> = {
  IV: { code: '9', eff: -1 }, HS: { code: '9', eff: -1 }, CN: { code: '2', eff: 1, onlyReturn: true }, RR: { code: '0', eff: 1, purchase: true }, HP: { code: '0', eff: 1, purchase: true }, DN: { code: '7', eff: -1, onlyReturn: true, atLine: true },
};

/** หัว + บรรทัด + วิธีชำระของเอกสาร (บันทึกใหม่หรือแก้ไข) แล้วลงบัญชีในทรานแซกชันเดียวกัน */
export async function saveTrade(db: Db, a: Ctx, K: TradeKind, id: string | null, b: Body) {
  const dt = await db.selectFrom('md_doc_type').select(['id', 'doc_class', 'warehouse_id', 'department_id', 'vat_rate', 'price_type', 'status']).where('id', '=', b.doc_type_id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
  if (!dt || dt.doc_class !== K.cls) throw badRequest(`เลือกประเภทเอกสารของ${K.label}`);
  if (!id && dt.status !== 'A') throw badRequest('ประเภทเอกสารนี้เลิกใช้แล้ว');
  const partyTbl = K.party === 'customer' ? 'md_customer' : 'md_supplier';
  const party = await db.selectFrom(partyTbl).select(['id', 'code', 'title', 'name', 'address_1', 'address_2', 'address_3', 'zip_code', 'tax_id', 'tax_branch_no', 'status', 'credit_days']).where('id', '=', b.party_id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
  if (!party) throw badRequest(`ไม่พบ${K.party === 'customer' ? 'ลูกค้า' : 'ผู้จำหน่าย'}นี้`);
  if (!id && party.status === 'I') throw badRequest(`${party.code} เลิกใช้แล้ว — เปลี่ยนสถานะที่รายละเอียด${K.party === 'customer' ? 'ลูกค้า' : 'ผู้จำหน่าย'}ก่อน`);
  // ชื่อบนใบกำกับ: Bill to (คู่มือหน้า 197) — ผู้ถูกตั้งหนี้ยังเป็นรหัสลูกค้า
  const billTo = b.bill_to_customer_id && K.party === 'customer' ? await db.selectFrom('md_customer').select(['title', 'name', 'address_1', 'address_2', 'address_3', 'zip_code', 'tax_id', 'tax_branch_no']).where('id', '=', b.bill_to_customer_id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst() : undefined;
  if (b.bill_to_customer_id && K.party === 'customer' && !billTo) throw badRequest('ไม่พบลูกค้า Bill to');
  const shown = billTo ?? party;
  const items = await db.selectFrom('md_item as i').leftJoin('md_item_account_group as g', 'g.id', 'i.account_group_id')
    .select(['i.id', 'i.code', 'i.name_th', 'i.item_type', 'i.vat_code', 'i.base_unit_id', 'i.status', 'i.std_cost', 'g.cost_method']).where('i.company_id', '=', a.companyId).where('i.id', 'in', [...new Set(b.lines.map((l) => l.item_id))]).where('i.deleted_at', 'is', null).execute();
  const byId = new Map(items.map((i) => [i.id, i]));
  b.lines.forEach((l, i) => {
    const it = byId.get(l.item_id);
    if (!it) throw badRequest(`บรรทัดที่ ${i + 1}: ไม่พบรหัสสินค้า`);
    if (K.module === 'AR' && it.item_type === '5') throw badRequest(`บรรทัดที่ ${i + 1}: ${it.code} เป็นรหัสค่าใช้จ่าย ใช้ในเอกสารขายไม่ได้`);
    if (K.module === 'AP' && it.item_type === '4') throw badRequest(`บรรทัดที่ ${i + 1}: ${it.code} เป็นรหัสรายได้ ใช้ในเอกสารซื้อไม่ได้`);
    if (!(Number(l.qty) !== 0) && !(Number(l.unit_price) !== 0)) throw badRequest(`บรรทัดที่ ${i + 1}: ป้อนจำนวนและราคา`);
  });
  if (K.refInvoice && !b.ref_header_id && !b.ref_no) throw badRequest('ป้อนเลขที่ใบกำกับที่อ้างถึง', [{ field: 'ref_no', message: 'ต้องอ้างใบกำกับเดิม' }]);
  if (b.ref_header_id) {
    const ref = await db.selectFrom('doc_header').select(['doc_no', 'doc_date', K.party === 'customer' ? 'customer_id' : 'supplier_id']).where('id', '=', b.ref_header_id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!ref) throw badRequest('ไม่พบใบกำกับที่อ้างถึง');
    b.ref_no = ref.doc_no; b.ref_date = String(ref.doc_date).slice(0, 10);
  }
  // อ้างใบสั่งขาย/ใบสั่งซื้อ: บรรทัดต้นทางของคู่ค้ารายนี้ ไม่เกินยอดค้างส่ง (ยอดที่บิลนี้ส่งไว้เดิมนับกลับ)
  const srcIds = b.lines.map((l) => l.source_line_id).filter((x): x is string => !!x);
  if (srcIds.length && !K.orderRef) throw badRequest(`${K.label}อ้างใบสั่งไม่ได้`);
  if (new Set(srcIds).size !== srcIds.length) throw badRequest('อ้างบรรทัดใบสั่งเดียวกันซ้ำ');
  const srcRows = srcIds.length ? (await sql<{ line_id: string; doc_no: string; doc_class: string; party: string | null; item_id: string | null; remaining_qty: string; own: string }>`
      SELECT o.line_id, o.doc_no, o.doc_class, coalesce(o.customer_id, o.supplier_id) AS party, o.item_id, o.remaining_qty,
             coalesce((SELECT sum(x.qty) FROM doc_line x WHERE x.source_line_id = o.line_id AND x.header_id = ${id} AND x.deleted_at IS NULL), 0) AS own
        FROM v_order_line o WHERE o.company_id = ${a.companyId} AND o.line_id = ANY(${srcIds}::uuid[])`.execute(db)).rows : [];
  const srcById = new Map(srcRows.map((x) => [x.line_id, x]));
  b.lines.forEach((l, i) => {
    if (!l.source_line_id) return;
    const o = srcById.get(l.source_line_id);
    if (!o || o.doc_class !== K.orderRef || o.party !== party.id) throw badRequest(`บรรทัดที่ ${i + 1}: ไม่พบรายการค้างส่งในใบสั่งของ${party.code}`);
    if (o.item_id !== l.item_id) throw badRequest(`บรรทัดที่ ${i + 1}: รหัสสินค้าต้องตรงกับใบสั่ง ${o.doc_no}`);
    const left = d(o.remaining_qty).plus(d(o.own));
    if (d(l.qty).gt(left)) throw badRequest(`บรรทัดที่ ${i + 1}: จำนวน ${l.qty} มากกว่ายอดค้าง${K.module === 'AR' ? 'ส่ง' : 'รับ'}ของ ${o.doc_no} (${left.toString()})`);
  });

  // หักมัดจำ: ใบมัดจำของคู่ค้ารายนี้ ประเภทราคาเดียวกับบิล ไม่เกินยอดคงเหลือ (ยอดที่บิลนี้หักไว้เดิมนับกลับ)
  if (b.deposits.length && !DEPOSIT_CLASSES.includes(K.cls)) throw badRequest(`${K.label}หักเงินมัดจำไม่ได้`);
  const depIds = b.deposits.map((x) => x.header_id);
  if (new Set(depIds).size !== depIds.length) throw badRequest('เลือกใบมัดจำซ้ำ');
  const depRows = depIds.length ? (await sql<{ header_id: string; doc_no: string; price_type: string; outstanding: string; party: string | null }>`
      SELECT o.header_id, o.doc_no, o.price_type, o.outstanding + coalesce((SELECT sum(l.amount) FROM doc_link l WHERE l.from_header_id = o.header_id AND l.to_header_id = ${id} AND l.link_type = 'DEPOSIT' AND l.deleted_at IS NULL), 0) AS outstanding,
             coalesce(o.customer_id, o.supplier_id) AS party
        FROM v_deposit_outstanding o WHERE o.company_id = ${a.companyId} AND o.module = ${K.module} AND o.header_id = ANY(${depIds}::uuid[])`.execute(db)).rows : [];
  const depById = new Map(depRows.map((x) => [x.header_id, x]));
  const depositTotal = b.deposits.reduce((sum, x, i) => {
    const o = depById.get(x.header_id);
    if (!o || o.party !== party.id) throw badRequest(`หักมัดจำบรรทัดที่ ${i + 1}: ไม่พบใบมัดจำของ${party.code}`);
    if (o.price_type !== b.price_type) throw badRequest(`${o.doc_no}: ประเภทราคาของใบมัดจำต้องเหมือนกับบิล (คู่มือหน้า 210)`);
    if (d(x.amount).lte(0) || d(x.amount).gt(d(o.outstanding))) throw badRequest(`${o.doc_no}: หักมัดจำได้ไม่เกินยอดคงเหลือ ${d(o.outstanding).toFixed(2)}`);
    return sum.plus(d(x.amount));
  }, d(0));
  // ประเภท VAT รายบรรทัด: ที่เลือกบนเอกสาร > แฟ้มสินค้า (ว่าง = มี VAT)
  const lineVat = (l: { item_id: string; vat_code?: '0' | '1' | '2' | null }) => { const c = l.vat_code ?? byId.get(l.item_id)?.vat_code; return c === '0' || c === '2' ? c : '1'; };
  const calc = computeDoc({ price_type: b.price_type, vat_rate: b.vat_rate, discount_text: b.discount_text, deposit_amount: depositTotal.toFixed(2),
    lines: b.lines.map((l) => ({ qty: l.qty, unit_price: l.is_free ? 0 : l.unit_price, discount_text: l.discount_text, vat_code: lineVat(l) })) });
  if (calc.errors.length) throw badRequest(calc.errors[0]!, calc.errors.map((m) => ({ message: m })));
  const payTotal = b.payments.reduce((s, p) => s.plus(d(p.amount)), d(0));
  if (!K.payments && b.payments.length) throw badRequest(`${K.label}ไม่มีการรับ/จ่ายเงินในเอกสาร — ใช้เมนูรับ/จ่ายชำระหนี้`);
  if (b.wht.length && K.cls !== 'HP') throw badRequest(K.cls === 'HS' ? 'ขายเงินสดป้อนเพียงยอดภาษีที่ถูกหัก — หนังสือรับรอง 50 ทวิ ลูกค้าเป็นผู้ออก' : `${K.label}ไม่มีภาษีหัก ณ ที่จ่ายในเอกสาร — ป้อนตอนรับ/จ่ายชำระ`);
  if (!d(b.wht_amount).isZero() && K.cls !== 'HS') throw badRequest(K.cls === 'HP' ? 'ซื้อเงินสด: ป้อนรายละเอียดภาษีหัก ณ ที่จ่าย (แบบ ประเภทเงินได้ อัตรา) ไม่ใช่ยอดอย่างเดียว' : `${K.label}ไม่มีภาษีหัก ณ ที่จ่ายในเอกสาร — ป้อนตอนรับ/จ่ายชำระ`);
  const wht = K.cls === 'HP' ? checkWht(b.wht) : d(b.wht_amount);
  if (wht.lt(0)) throw badRequest('ภาษีหัก ณ ที่จ่ายต้องไม่ติดลบ');
  if (payTotal.plus(wht).gt(d(calc.net_amount))) throw badRequest('ยอดชำระด้วยวิธีอื่นรวมภาษีหัก ณ ที่จ่าย มากกว่ายอดเงินรวมทั้งสิ้น');
  const credit = b.credit_days ?? (K.payments || K.cls === 'QT' || K.cls === 'PO' ? 0 : party.credit_days ?? 0);
  const header = {
    doc_type_id: dt.id, doc_class: K.cls, module: K.order ?? K.module, doc_date: b.doc_date, delivery_date: K.order && K.cls !== 'QT' ? b.delivery_date ?? b.doc_date : null,
    customer_id: K.party === 'customer' ? party.id : null, supplier_id: K.party === 'supplier' ? party.id : null, bill_to_customer_id: billTo ? b.bill_to_customer_id : null,
    party_name: [shown.title, shown.name].filter(Boolean).join(' ').slice(0, 200), party_address: [shown.address_1, shown.address_2, shown.address_3, shown.zip_code].filter(Boolean).join(' ').slice(0, 500) || null,
    party_tax_id: shown.tax_id, party_tax_branch_no: b.party_tax_branch_no || shown.tax_branch_no || '00000',
    your_ref: b.your_ref, ref_no: b.ref_no, ref_date: b.ref_date ?? null, department_id: b.department_id ?? dt.department_id, salesperson_id: b.salesperson_id,
    sales_area_code: b.sales_area_code, ship_via_code: b.ship_via_code, ship_to_id: b.ship_to_id, warehouse_id: b.warehouse_id ?? dt.warehouse_id,
    credit_days: credit, due_date: b.due_date ?? dueDate(b.doc_date, credit), price_type: b.price_type, vat_rate: b.vat_rate, vat_basis: b.vat_basis ?? '1',
    amount: calc.amount, discount_text: b.discount_text, discount_amount: calc.discount_amount, amount_after_discount: calc.amount_after_discount,
    deposit_amount: calc.deposit_amount, zero_rate_amount: calc.zero_rate_amount, exempt_amount: calc.exempt_amount, taxable_amount: calc.taxable_amount, vat_amount: calc.vat_amount, net_amount: calc.net_amount,
    cash_amount: K.payments ? d(calc.net_amount).minus(payTotal).minus(wht).toFixed(2) : '0', cheque_amount: K.payments ? payTotal.toFixed(2) : '0', wht_amount: wht.toFixed(2),
    remark: b.remark, payment_terms: b.payment_terms, vat_date: b.doc_date, updated_by: a.userId,
  };
  return db.transaction().execute(async (tx) => {
    await periodFor(tx, a.companyId, b.doc_date);
    let hid = id, docNo: string;
    if (id) {
      const cur = await tx.selectFrom('doc_header').select(['doc_no', 'doc_status', 'doc_class', 'doc_date', 'is_opening']).where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
      if (!cur || cur.doc_class !== K.cls) throw notFound(K.label);
      if (cur.is_opening) throw badRequest(`${cur.doc_no} เป็นยอดยกมา — แก้ที่เมนู บันทึกรายการ${K.module === 'AR' ? 'ลูกหนี้' : 'เจ้าหนี้'}คงค้าง-ยกมา`);
      if (cur.doc_status === 'C') throw badRequest('เอกสารนี้ถูกยกเลิกแล้ว แก้ไขไม่ได้');
      await periodFor(tx, a.companyId, String(cur.doc_date).slice(0, 10));
      if (K.order && (await orderDelivered(tx, id))) throw badRequest(`${cur.doc_no} มีการ${K.module === 'AR' ? 'ส่งของ' : 'รับของ'}แล้ว แก้ไขไม่ได้ — ยกเลิกยอดค้างรายบรรทัดแทน`);
      if (await activeSettlement(tx, a.companyId, id))
        throw badRequest(`${cur.doc_no} มีการรับ/จ่ายชำระแล้ว แก้ไขไม่ได้ — ยกเลิกใบเสร็จ/ใบสำคัญจ่ายที่ตัดเอกสารนี้ก่อน`);
      docNo = cur.doc_no;
      await tx.updateTable('doc_header').set(header).where('id', '=', id).execute();
      for (const t of ['doc_line', 'doc_payment', 'tax_wht_entry'] as const) await tx.updateTable(t).set({ deleted_at: sql`now()` as never }).where('header_id', '=', id).where('deleted_at', 'is', null).execute();
      await tx.updateTable('doc_link').set({ deleted_at: sql`now()` as never }).where('to_header_id', '=', id).where('link_type', '=', 'DEPOSIT').where('deleted_at', 'is', null).execute();
    } else {
      docNo = await docNoFor(tx, a.companyId, dt.id, b.doc_no);
      hid = (await tx.insertInto('doc_header').values({ ...header, company_id: a.companyId, branch_id: a.branchId ?? (await tx.selectFrom('sys_branch').select('id').where('company_id', '=', a.companyId).where('is_head_office', '=', true).executeTakeFirstOrThrow()).id,
        doc_no: docNo, doc_status: 'N', created_by: a.userId }).returning('id').executeTakeFirstOrThrow()).id;
    }
    // ตัด/รับสต๊อก + ต้นทุน (T4.2): เฉพาะสินค้าทั่วไป (ชนิด 0) · ลดหนี้/ส่งคืนเฉพาะบรรทัดที่ติ๊กคืนสินค้า
    const mv = STOCK_MOVE[K.cls];
    const st = mv ? await stockSettings(tx, a.companyId) : null;
    const stock: Array<{ warehouse_id: string | null; stock_effect: number; movement_code: string | null; cost_amount: string | null; cost_unit: string | null }> = [];
    const issues = new Map<string, { itemId: string; warehouseId: string; qty: ReturnType<typeof d>; code: string }>();
    const kitRows: Array<{ parent: number; item_id: string; description: string; unit_id: string | null; warehouse_id: string; base_qty: string; stock_effect: number; movement_code: string; cost_amount: string; cost_unit: string }> = [];
    const warnings: string[] = [];
    const warnBelow = mv?.eff === -1 && (K.cls === 'IV' || K.cls === 'HS') && (await companySettings(tx, a.companyId))['ar.warn_below_cost'] !== false;
    for (const [i, l] of b.lines.entries()) {
      const it = byId.get(l.item_id)!;
      const wh = l.warehouse_id ?? header.warehouse_id ?? st?.mainWarehouseId ?? null;
      const isKit = it.item_type === '1' || it.item_type === '2';
      if (!mv || (it.item_type !== '0' && !isKit) || (mv.onlyReturn && !l.return_to_stock)) { stock.push({ warehouse_id: wh, stock_effect: 0, movement_code: null, cost_amount: null, cost_unit: null }); continue; }
      if (isKit) {
        // สินค้าชุด (S-IC-03): ตัด/รับสต๊อกที่ส่วนประกอบ (บรรทัด K อ้างบรรทัดชุด) — รายได้/ราคาซื้ออยู่ที่บรรทัดชุด
        stock.push({ warehouse_id: wh, stock_effect: 0, movement_code: null, cost_amount: null, cost_unit: null });
        const comps = await explodeKit(tx, a.companyId, it.id, d(l.qty).times(d(l.factor ?? 1)).abs());
        if (!comps.length) throw badRequest(`บรรทัดที่ ${i + 1}: สินค้าชุด ${it.code} ยังไม่มีรายการสินค้าประกอบ — กำหนดที่ รายละเอียดสินค้าชุด`);
        const alloc = (mv.eff > 0 && mv.purchase) || mv.atLine ? allocateKit(calc.lines[i]!.net_amount, comps.map((c) => ({ qty: c.qty.toString(), price: c.std_cost ?? 0, fallback: c.item_std_cost ?? 1 }))) : null;
        let kitCost = d(0);
        for (const [ci, c] of comps.entries()) {
          const cwh = c.warehouse_id ?? wh;
          if (!cwh) throw badRequest(`บรรทัดที่ ${i + 1}: เลือกคลังสินค้า`);
          const cc = alloc ? alloc[ci]!.toFixed(2)
            : await issueCost(tx, a.companyId, { itemId: c.item_id, warehouseId: cwh, byWarehouse: st!.byWarehouse, date: b.doc_date, qty: c.qty.toString(), method: mv.eff > 0 ? 'A' : c.cost_method, fallbackUnit: c.item_std_cost });
          kitCost = kitCost.plus(d(cc));
          kitRows.push({ parent: i, item_id: c.item_id, description: c.name_th, unit_id: c.base_unit_id, warehouse_id: cwh, base_qty: c.qty.toString(), stock_effect: mv.eff, movement_code: mv.code, cost_amount: cc, cost_unit: c.qty.isZero() ? '0' : d(cc).div(c.qty).toDecimalPlaces(4).toString() });
          if (mv.eff < 0) { const k = `${c.item_id}|${cwh}`; const x = issues.get(k); issues.set(k, { itemId: c.item_id, warehouseId: cwh, qty: (x?.qty ?? d(0)).plus(c.qty), code: c.code }); }
        }
        if (warnBelow && !l.is_free && d(calc.lines[i]!.net_amount).lt(kitCost)) warnings.push(`บรรทัดที่ ${i + 1}: ${it.code} ขายต่ำกว่าทุน (ยอดขาย ${d(calc.lines[i]!.net_amount).toFixed(2)} < ทุนส่วนประกอบ ${kitCost.toFixed(2)})`);
        continue;
      }
      if (!wh) throw badRequest(`บรรทัดที่ ${i + 1}: เลือกคลังสินค้า (หรือกำหนดคลังหลักที่ค่าเริ่มต้นระบบสินค้า)`);
      const bq = d(l.qty).times(d(l.factor ?? 1)).abs();
      // รับเข้าจากการซื้อ/ส่งคืนผู้จำหน่าย = มูลค่าก่อน VAT หลังเฉลี่ยส่วนลด (ส่งคืนลดสินค้าในบัญชีด้วยยอดเดียวกัน) · จ่ายออก/รับคืน = ต้นทุนตามวิธีของกลุ่มบัญชี
      const cost = (mv.eff > 0 && mv.purchase) || mv.atLine ? d(calc.lines[i]!.net_amount).toFixed(2)
        : await issueCost(tx, a.companyId, { itemId: it.id, warehouseId: wh, byWarehouse: st!.byWarehouse, date: b.doc_date, qty: bq.toString(), method: mv.eff > 0 ? 'A' : it.cost_method, fallbackUnit: it.std_cost });
      stock.push({ warehouse_id: wh, stock_effect: mv.eff, movement_code: mv.code, cost_amount: cost, cost_unit: bq.isZero() ? '0' : d(cost).div(bq).toDecimalPlaces(4).toString() });
      // ขายต่ำกว่าทุนให้เตือน (ค่าเริ่มต้นระบบขาย ข้อ 5) — บันทึกได้ แจ้งให้ทราบ
      if (warnBelow && !l.is_free && d(calc.lines[i]!.net_amount).lt(d(cost))) warnings.push(`บรรทัดที่ ${i + 1}: ${it.code} ขายต่ำกว่าทุน (ยอดขาย ${d(calc.lines[i]!.net_amount).toFixed(2)} < ทุน ${d(cost).toFixed(2)})`);
      if (mv.eff < 0) { const k = `${it.id}|${wh}`; const x = issues.get(k); issues.set(k, { itemId: it.id, warehouseId: wh, qty: (x?.qty ?? d(0)).plus(bq), code: it.code }); }
    }
    if (st) await checkNegative(tx, a.companyId, st, issues);
    const inserted = await tx.insertInto('doc_line').values(b.lines.map((l, i) => ({
      company_id: a.companyId, header_id: hid!, line_no: i + 1, line_kind: 'I', item_id: l.item_id, description: l.description ?? byId.get(l.item_id)!.name_th,
      warehouse_id: stock[i]!.warehouse_id, stock_effect: stock[i]!.stock_effect, movement_code: stock[i]!.movement_code, cost_amount: stock[i]!.cost_amount, cost_unit: stock[i]!.cost_unit,
      department_id: l.department_id ?? header.department_id, qty: l.qty, unit_id: l.unit_id ?? byId.get(l.item_id)!.base_unit_id,
      factor: l.factor ?? '1', base_qty: d(l.qty).times(d(l.factor ?? 1)).abs().toString(), unit_price: l.is_free ? '0' : l.unit_price, discount_text: l.discount_text,
      discount_amount: calc.lines[i]!.discount_amount, line_amount: calc.lines[i]!.line_amount, net_amount: calc.lines[i]!.net_amount,
      vat_code: lineVat(l), is_free: l.is_free, return_to_stock: l.return_to_stock, salesperson_id: b.salesperson_id, created_by: a.userId,
      source_line_id: l.source_line_id, ordered_qty: K.order ? l.qty : null, delivery_date: K.order && K.cls !== 'QT' ? l.delivery_date ?? b.delivery_date ?? b.doc_date : null,
    }))).returning(['id', 'line_no']).execute();
    if (kitRows.length) {
      const idOf = new Map(inserted.map((x) => [x.line_no, x.id]));
      await tx.insertInto('doc_line').values(kitRows.map((k, n) => ({ company_id: a.companyId, header_id: hid!, line_no: b.lines.length + n + 1, line_kind: 'K', item_id: k.item_id, description: k.description,
        warehouse_id: k.warehouse_id, department_id: b.lines[k.parent]!.department_id ?? header.department_id, qty: k.base_qty, base_qty: k.base_qty, unit_id: k.unit_id, factor: '1',
        stock_effect: k.stock_effect, movement_code: k.movement_code, cost_amount: k.cost_amount, cost_unit: k.cost_unit, line_amount: '0', net_amount: '0', source_line_id: idOf.get(k.parent + 1)!, created_by: a.userId }))).execute();
    }
    if (b.deposits.length) await tx.insertInto('doc_link').values(b.deposits.map((x) => ({ company_id: a.companyId, from_header_id: x.header_id, to_header_id: hid!, link_type: 'DEPOSIT', amount: d(x.amount).toFixed(2), created_by: a.userId }))).execute();
    if (b.payments.length) await tx.insertInto('doc_payment').values(b.payments.map((p, i) => ({ company_id: a.companyId, header_id: hid!, line_no: i + 1, payment_method_id: p.payment_method_id, amount: p.amount, reference_no: p.reference_no, created_by: a.userId }))).execute();
    if (b.wht.length) await writeWht(tx, a, { headerId: hid!, docNo, payDate: b.doc_date, wht: b.wht, supplierId: header.supplier_id, departmentId: header.department_id,
      payee: { name: header.party_name, address: header.party_address, tax_id: header.party_tax_id, branch_no: header.party_tax_branch_no } });
    // บันทึก = ลงบัญชีทันที (แก้ไข = ลงใบสำคัญเดิมใหม่)
    const curJ = id ? await tx.selectFrom('gl_journal').select('id').where('source_header_id', '=', id).where('doc_status', '=', 'N').where('deleted_at', 'is', null).executeTakeFirst() : undefined;
    const posted = await postDocument(tx, a, hid!, curJ?.id);
    if (!posted.journal_id && curJ) await unpostDocument(tx, a, hid!);
    if (mv) await recostAfter(tx, a, hid!);
    // วงเงินลูกค้า (ค่าเริ่มต้นระบบขาย ข้อ 9/14): ยอดค้างรวมบิลนี้เกินวงเงิน → ไม่อนุญาต เว้นแต่ตั้ง "ยอมให้ออกเอกสารไปก่อน" หรือผู้บันทึกมีระดับอนุมัติตามกำหนด
    if ((K.cls === 'IV' || K.cls === 'DR') && d(calc.net_amount).gt(0)) {
      const cl = await tx.selectFrom('md_customer').select(['code', 'credit_limit']).where('id', '=', party.id).executeTakeFirst();
      if (cl?.credit_limit && d(cl.credit_limit).gt(0)) {
        const exp = d((await sql<{ v: string }>`SELECT coalesce(sum(outstanding), 0) AS v FROM v_ar_outstanding WHERE company_id = ${a.companyId} AND customer_id = ${party.id}`.execute(tx)).rows[0]!.v);
        if (exp.gt(cl.credit_limit)) {
          const cs = await companySettings(tx, a.companyId);
          const lvl = Number(cs['ar.over_credit_level'] ?? 9);
          const msg = `ลูกค้า ${cl.code} ขายเกินวงเงิน — ยอดค้างรวมบิลนี้ ${exp.toFixed(2)} วงเงิน ${d(cl.credit_limit).toFixed(2)} (เกิน ${exp.minus(cl.credit_limit).toFixed(2)})`;
          if (cs['ar.allow_over_credit'] !== true && !a.isAdmin && a.approvalLevel < lvl) throw badRequest(`${msg} — ต้องให้ผู้มีระดับอนุมัติ ${lvl} ขึ้นไปบันทึก หรือขอเพิ่มวงเงินที่รายละเอียดลูกค้า`);
          warnings.push(msg);
        }
      }
    }
    await logActivity(tx, a, { module: K.module, action: id ? 'EDIT' : 'ADD', docNo, table: 'doc_header', rowId: hid });
    return { id: hid, doc_no: docNo, journal_id: posted.journal_id, net_amount: calc.net_amount, warnings };
  });
}

type KitPart = { item_id: string; code: string; name_th: string; base_unit_id: string | null; qty: ReturnType<typeof d>; warehouse_id: string | null; std_cost: string | null; item_std_cost: string | null; cost_method: string | null };
/** ส่วนประกอบของสินค้าชุด (ชุดซ้อนชุดแตกต่อ) × จำนวนชุด — เฉพาะสินค้าที่มีสต๊อก */
async function explodeKit(db: Db, companyId: string, kitId: string, qty: ReturnType<typeof d>, depth = 0): Promise<KitPart[]> {
  if (depth > 8) throw badRequest('สินค้าชุดซ้อนกันเกิน 8 ระดับ — ตรวจระดับสินค้าของชุด');
  const rows = await db.selectFrom('md_item_bom as b').innerJoin('md_item as i', 'i.id', 'b.component_item_id').leftJoin('md_item_account_group as g', 'g.id', 'i.account_group_id')
    .select(['b.component_item_id as item_id', 'i.code', 'i.name_th', 'i.base_unit_id', 'i.item_type', 'b.qty', 'b.warehouse_id', 'b.std_cost', 'i.std_cost as item_std_cost', 'g.cost_method'])
    .where('b.parent_item_id', '=', kitId).where('b.company_id', '=', companyId).where('b.deleted_at', 'is', null).where('i.deleted_at', 'is', null).orderBy('b.line_no').execute();
  const out: KitPart[] = [];
  for (const r of rows) {
    const q = qty.times(d(r.qty));
    if (r.item_type === '1' || r.item_type === '2') out.push(...await explodeKit(db, companyId, r.item_id, q, depth + 1));
    else if (r.item_type === '0') out.push({ item_id: r.item_id, code: r.code, name_th: r.name_th, base_unit_id: r.base_unit_id, qty: q, warehouse_id: r.warehouse_id, std_cost: r.std_cost, item_std_cost: r.item_std_cost, cost_method: r.cost_method });
  }
  return out;
}

/** มีบิลอ้างใบสั่งนี้แล้วหรือไม่ */
async function orderDelivered(db: Db, headerId: string) {
  return !!(await sql`SELECT 1 FROM doc_line x JOIN doc_line o ON o.id = x.source_line_id JOIN doc_header t ON t.id = x.header_id
      WHERE o.header_id = ${headerId} AND x.deleted_at IS NULL AND x.line_kind <> 'K' AND t.doc_status <> 'C' AND t.deleted_at IS NULL LIMIT 1`.execute(db)).rows.length;
}

export function tradeRoutes(app: FastifyInstance, db: Db) {
  /** S-IV-02/03, S-PU-03a: ใบสั่งที่ยังค้างส่ง/ค้างรับของคู่ค้า พร้อมบรรทัด (invoice_id = บิลที่กำลังแก้ ให้นับยอดที่บิลนั้นอ้างไว้กลับ) */
  app.get('/api/v1/orders/open', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ cls: z.enum(['SO', 'PO']), party_id: uuid, invoice_id: uuid.optional() }), req.query);
    const own = q.invoice_id ? sql`coalesce((SELECT sum(x.qty) FROM doc_line x WHERE x.source_line_id = o.line_id AND x.header_id = ${q.invoice_id} AND x.deleted_at IS NULL), 0)` : sql`0`;
    const rows = (await sql<{ header_id: string; doc_no: string; doc_date: string; price_type: string; line_id: string; line_no: number; item_id: string | null; item_code: string | null; description: string | null;
        warehouse_id: string | null; unit_id: string | null; factor: string; unit_price: string; discount_text: string | null; is_free: boolean; delivery_date: string | null; ordered_qty: string; remaining_qty: string }>`
      SELECT o.header_id, o.doc_no, o.doc_date, o.price_type, o.line_id, o.line_no, o.item_id, i.code AS item_code, o.description, o.warehouse_id, o.unit_id, o.factor, o.unit_price, o.discount_text, o.is_free,
             o.delivery_date, o.ordered_qty, o.remaining_qty + ${own} AS remaining_qty
        FROM v_order_line o LEFT JOIN md_item i ON i.id = o.item_id
       WHERE o.company_id = ${a.companyId} AND o.doc_class = ${q.cls} AND ${sql.ref(q.cls === 'SO' ? 'o.customer_id' : 'o.supplier_id')} = ${q.party_id} AND o.remaining_qty + ${own} > 0
       ORDER BY o.doc_date, o.doc_no, o.line_no`.execute(db)).rows;
    return { rows };
  });
  for (const K of TRADE_KINDS) {
    const base = `/api/v1/${K.path}`;
    const partyCol = K.party === 'customer' ? 'customer_id' : 'supplier_id';
    app.get(base, async (req) => {
      const a = requireCompany(req);
      const q = parse(z.object({ q: z.string().optional(), from: isoDate.optional(), to: isoDate.optional(), party_id: uuid.optional(), status: z.enum(['N', 'C', 'all']).default('all'), type_id: uuid.optional(),
        limit: z.coerce.number().int().min(1).max(1000).default(200), offset: z.coerce.number().int().min(0).default(0) }), req.query);
      const view = K.module === 'AR' ? 'v_ar_outstanding' : 'v_ap_outstanding';
      const party = K.party === 'customer' ? 'md_customer' : 'md_supplier';
      const like = q.q?.trim() ? `%${q.q.trim()}%` : null;
      const where = sql.join([
        sql`h.company_id = ${a.companyId}`, sql`h.doc_class = ${K.cls}`, sql`h.deleted_at IS NULL`,
        ...(q.from ? [sql`h.doc_date >= ${q.from}`] : []), ...(q.to ? [sql`h.doc_date <= ${q.to}`] : []),
        ...(q.party_id ? [sql`h.${sql.ref(partyCol)} = ${q.party_id}`] : []), ...(q.status !== 'all' ? [sql`h.doc_status = ${q.status}`] : []), ...(q.type_id ? [sql`h.doc_type_id = ${q.type_id}`] : []),
        ...(like ? [sql`(h.doc_no ILIKE ${like} OR h.party_name ILIKE ${like} OR p.code ILIKE ${like} OR h.your_ref ILIKE ${like})`] : []),
      ], sql` AND `);
      const from = sql`FROM doc_header h LEFT JOIN ${sql.table(party)} p ON p.id = h.${sql.ref(partyCol)} WHERE ${where}`;
      const total = (await sql<{ n: number }>`SELECT count(*) AS n ${from}`.execute(db)).rows[0]!.n;
      const rows = (await sql`SELECT h.id, h.doc_no, h.doc_date, h.due_date, h.delivery_date, h.party_name, p.code AS party_code, h.net_amount, h.vat_amount, h.doc_status, h.gl_posted, h.ref_no,
          (SELECT o.outstanding FROM ${sql.table(view)} o WHERE o.header_id = h.id) AS outstanding ${from} ORDER BY h.doc_date DESC, h.doc_no DESC LIMIT ${q.limit} OFFSET ${q.offset}`.execute(db)).rows;
      return { total: Number(total), rows };
    });
    app.get(`${base}/:id`, async (req) => {
      const a = requireCompany(req);
      const { id } = parse(z.object({ id: uuid }), req.params);
      const h = await db.selectFrom('doc_header').selectAll().where('id', '=', id).where('company_id', '=', a.companyId).where('doc_class', '=', K.cls).where('deleted_at', 'is', null).executeTakeFirst();
      if (!h) throw notFound(K.label);
      const lines = await db.selectFrom('doc_line as l').leftJoin('md_item as i', 'i.id', 'l.item_id').leftJoin('md_unit as u', 'u.id', 'l.unit_id')
        .select(['l.id', 'l.line_no', 'l.item_id', 'i.code as item_code', 'l.description', 'l.source_line_id', 'l.delivery_date', 'l.warehouse_id', 'l.qty', 'l.unit_id', 'u.code as unit_code', 'l.factor', 'l.unit_price', 'l.discount_text', 'l.discount_amount', 'l.line_amount', 'l.net_amount', 'l.vat_code', 'l.is_free', 'l.return_to_stock', 'l.department_id'])
        .where('l.header_id', '=', id).where('l.deleted_at', 'is', null).where('l.line_kind', '<>', 'K').orderBy('l.line_no').execute();
      const payments = await db.selectFrom('doc_payment as p').leftJoin('md_payment_method as m', 'm.id', 'p.payment_method_id').select(['p.line_no', 'p.payment_method_id', 'm.code as method_code', 'm.name_th as method_name', 'p.amount', 'p.reference_no'])
        .where('p.header_id', '=', id).where('p.deleted_at', 'is', null).orderBy('p.line_no').execute();
      const settled = await db.selectFrom('doc_settlement as s').innerJoin('doc_header as r', 'r.id', 's.payment_header_id').select(['r.id', 'r.doc_no', 'r.doc_date', 'r.doc_class', 's.amount', 'r.doc_status'])
        .where('s.invoice_header_id', '=', id).where('s.deleted_at', 'is', null).orderBy('r.doc_date').execute();
      const view = K.module === 'AR' ? 'v_ar_outstanding' : 'v_ap_outstanding';
      const out = (await sql<{ outstanding: string }>`SELECT outstanding FROM ${sql.table(view)} WHERE header_id = ${id}`.execute(db)).rows[0];
      const pc = await db.selectFrom(K.party === 'customer' ? 'md_customer' : 'md_supplier').select('code').where('id', '=', (h.customer_id ?? h.supplier_id)!).executeTakeFirst();
      const deposits = (await sql<{ header_id: string; doc_no: string; amount: string }>`SELECT l.from_header_id AS header_id, f.doc_no, l.amount FROM doc_link l JOIN doc_header f ON f.id = l.from_header_id
          WHERE l.to_header_id = ${id} AND l.link_type = 'DEPOSIT' AND l.deleted_at IS NULL ORDER BY f.doc_no`.execute(db)).rows;
      // ใบสั่ง: ยอดค้างรายบรรทัด + บิลที่ส่ง/รับแล้ว · บิล: ใบสั่งที่อ้าง
      const orderLines = K.order && K.cls !== 'QT' ? (await sql<{ line_id: string; line_no: number; ordered_qty: string; cancelled_qty: string; delivered_qty: string; remaining_qty: string }>`
          SELECT line_id, line_no, ordered_qty, cancelled_qty, delivered_qty, remaining_qty FROM v_order_line WHERE header_id = ${id} ORDER BY line_no`.execute(db)).rows : [];
      const deliveries = K.order ? (await sql`SELECT t.id, t.doc_no, t.doc_date, t.doc_class, o.line_no AS order_line_no, i.code AS item_code, x.qty
          FROM doc_line x JOIN doc_line o ON o.id = x.source_line_id JOIN doc_header t ON t.id = x.header_id LEFT JOIN md_item i ON i.id = x.item_id
         WHERE o.header_id = ${id} AND x.deleted_at IS NULL AND t.doc_status <> 'C' AND t.deleted_at IS NULL ORDER BY t.doc_date, t.doc_no`.execute(db)).rows : [];
      const cancels = K.order ? await db.selectFrom('doc_line').select(['id', 'line_no', 'cancelled_qty', 'cancel_reason_code', 'cancel_date']).where('header_id', '=', id).where('deleted_at', 'is', null).where('cancelled_qty', '>', '0').orderBy('line_no').execute() : [];
      const sources = K.orderRef ? (await sql<{ line_id: string; source_line_id: string; doc_no: string; header_id: string }>`SELECT x.id AS line_id, x.source_line_id, oh.doc_no, oh.id AS header_id FROM doc_line x JOIN doc_line o ON o.id = x.source_line_id JOIN doc_header oh ON oh.id = o.header_id
          WHERE x.header_id = ${id} AND x.deleted_at IS NULL`.execute(db)).rows : [];
      const converted = K.cls === 'QT' ? (await sql<{ id: string; doc_no: string; doc_date: string }>`SELECT t.id, t.doc_no, t.doc_date FROM doc_link l JOIN doc_header t ON t.id = l.to_header_id
          WHERE l.from_header_id = ${id} AND l.link_type = 'CONVERT' AND l.deleted_at IS NULL AND t.doc_status <> 'C' AND t.deleted_at IS NULL ORDER BY t.doc_date`.execute(db)).rows : [];
      return { ...h, converted, party_code: pc?.code ?? null, lines: lines.map((l) => ({ ...l, ...(orderLines.find((o) => o.line_no === l.line_no) ?? {}), source: sources.find((x) => x.line_id === (l as { id?: string }).id) ?? null })),
        deliveries, cancels, payments, deposits, wht: K.payments ? (await readMoneyParts(db, a.companyId, id)).wht : [], settlements: settled, outstanding: out?.outstanding ?? null, editable: h.doc_status !== 'C' && !h.is_opening && !settled.some((x) => x.doc_status !== 'C') && !(deliveries as unknown[]).length };
    });
    app.post(base, async (req) => saveTrade(db, requireCompany(req), K, null, parse(tradeBody, req.body)));
    app.put(`${base}/:id`, async (req) => saveTrade(db, requireCompany(req), K, parse(z.object({ id: uuid }), req.params).id, parse(tradeBody, req.body)));
    app.post(`${base}/:id/cancel`, async (req) => {
      const a = requireCompany(req);
      const { id } = parse(z.object({ id: uuid }), req.params);
      const { reason } = parse(z.object({ reason: z.string().trim().min(1, 'ป้อนเหตุผลที่ยกเลิก').max(200) }), req.body);
      const h = await db.selectFrom('doc_header').select('id').where('id', '=', id).where('company_id', '=', a.companyId).where('doc_class', '=', K.cls).where('deleted_at', 'is', null).executeTakeFirst();
      if (!h) throw notFound(K.label);
      return cancelDocument(db, a, id, reason, K.payments ? async (tx) => {
        await tx.updateTable('tax_wht_entry').set({ doc_status: 'C', updated_by: a.userId }).where('company_id', '=', a.companyId).where('header_id', '=', id).where('deleted_at', 'is', null).execute();
      } : K.order ? async (tx) => {
        if (await orderDelivered(tx, id)) throw badRequest(`มีการ${K.module === 'AR' ? 'ส่งของ' : 'รับของ'}ตามใบสั่งนี้แล้ว — ยกเลิกยอดค้างรายบรรทัดแทน`);
      } : undefined);
    });
    if (K.order && K.cls !== 'QT') {
      /** ยกเลิกยอดค้างส่ง/ค้างรับรายบรรทัด พร้อมวันที่และเหตุผล (คู่มือหน้า 207) — ไม่ยกเลิกทั้งเอกสาร */
      app.post(`${base}/:id/lines/:lineId/cancel`, async (req) => {
        const a = requireCompany(req);
        const { id, lineId } = parse(z.object({ id: uuid, lineId: uuid }), req.params);
        const b = parse(z.object({ qty: num, reason_code: str(10), date: isoDate }), req.body);
        return db.transaction().execute(async (tx) => {
          const o = (await sql<{ remaining_qty: string; doc_no: string; line_no: number }>`SELECT o.remaining_qty, o.doc_no, o.line_no FROM v_order_line o
              WHERE o.company_id = ${a.companyId} AND o.header_id = ${id} AND o.line_id = ${lineId} AND o.doc_class = ${K.cls}`.execute(tx)).rows[0];
          if (!o) throw notFound('บรรทัดใบสั่ง');
          const q = d(b.qty);
          if (q.lte(0) || q.gt(d(o.remaining_qty))) throw badRequest(`ยกเลิกได้ไม่เกินยอดค้าง ${d(o.remaining_qty).toString()}`);
          const cur = await tx.selectFrom('doc_line').select(['cancelled_qty', 'remaining_qty']).where('id', '=', lineId).executeTakeFirstOrThrow();
          // บรรทัดที่ย้ายจาก Express: remaining_qty เป็นยอดตั้งต้น ณ วันย้าย — ลดตามที่ยกเลิก
          await tx.updateTable('doc_line').set({ cancelled_qty: d(cur.cancelled_qty ?? 0).plus(q).toString(), cancel_reason_code: b.reason_code, cancel_date: b.date,
            ...(cur.remaining_qty !== null ? { remaining_qty: d(cur.remaining_qty).minus(q).toString() } : {}), updated_by: a.userId }).where('id', '=', lineId).execute();
          await logActivity(tx, a, { module: K.order!, action: 'CANCEL_LINE', docNo: o.doc_no, table: 'doc_line', rowId: lineId, detail: { line_no: o.line_no, qty: b.qty, reason: b.reason_code } });
          return { ok: true };
        });
      });
    }
  }
  /** แปลงใบเสนอราคาเป็นใบสั่งขาย (คู่มือหน้า 203) — คัดลอกหัวและบรรทัด ผูก doc_link CONVERT */
  app.post('/api/v1/quotations/:id/convert', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(z.object({ doc_type_id: uuid.optional(), doc_date: isoDate, delivery_date: isoDate.nullable().optional() }), req.body);
    const qt = await db.selectFrom('doc_header').selectAll().where('id', '=', id).where('company_id', '=', a.companyId).where('doc_class', '=', 'QT').where('deleted_at', 'is', null).executeTakeFirst();
    if (!qt) throw notFound('ใบเสนอราคา');
    if (qt.doc_status === 'C') throw badRequest('ใบเสนอราคานี้ถูกยกเลิกแล้ว');
    const soType = b.doc_type_id ?? (await db.selectFrom('md_doc_type').select('id').where('company_id', '=', a.companyId).where('doc_class', '=', 'SO').where('status', '=', 'A').where('deleted_at', 'is', null).orderBy('code').executeTakeFirst())?.id;
    if (!soType) throw badRequest('ยังไม่มีประเภทเอกสารใบสั่งขาย — เพิ่มที่ เริ่มระบบ › เลขที่เอกสาร');
    const lines = await db.selectFrom('doc_line').select(['item_id', 'description', 'warehouse_id', 'qty', 'unit_id', 'factor', 'unit_price', 'discount_text', 'is_free', 'department_id', 'vat_code'])
      .where('header_id', '=', id).where('deleted_at', 'is', null).where('item_id', 'is not', null).where('line_kind', '<>', 'K').orderBy('line_no').execute();
    const K = TRADE_KINDS.find((k) => k.cls === 'SO')!;
    const so = await saveTrade(db, a, K, null, parse(tradeBody, {
      doc_type_id: soType, doc_date: b.doc_date, delivery_date: b.delivery_date ?? b.doc_date, party_id: qt.customer_id, bill_to_customer_id: qt.bill_to_customer_id, party_tax_branch_no: qt.party_tax_branch_no,
      your_ref: qt.your_ref, department_id: qt.department_id, salesperson_id: qt.salesperson_id, sales_area_code: qt.sales_area_code, ship_via_code: qt.ship_via_code,
      price_type: qt.price_type, vat_rate: qt.vat_rate ?? 0, discount_text: qt.discount_text, remark: qt.remark,
      lines: lines.map((l) => ({ ...l, qty: l.qty, factor: l.factor, unit_price: l.unit_price, vat_code: l.vat_code === '0' || l.vat_code === '1' || l.vat_code === '2' ? l.vat_code : null })),
    }));
    await db.insertInto('doc_link').values({ company_id: a.companyId, from_header_id: id, to_header_id: so.id!, link_type: 'CONVERT', created_by: a.userId }).execute();
    return so;
  });
  /** ค่าตั้งต้นของหน้าจอเอกสาร: ประเภทเอกสารของหมวด อัตรา VAT ประเภทราคา (ค่าเริ่มต้นระบบ → ประเภทเอกสาร) */
  app.get('/api/v1/trade-defaults/:cls', async (req) => {
    const a = requireCompany(req);
    const { cls } = parse(z.object({ cls: z.string().max(4) }), req.params);
    const s = await companySettings(db, a.companyId);
    const types = await db.selectFrom('md_doc_type').select(['id', 'code', 'name_th', 'next_no', 'price_type', 'vat_rate', 'vat_basis', 'warehouse_id', 'department_id'])
      .where('company_id', '=', a.companyId).where('doc_class', '=', cls).where('status', '=', 'A').where('deleted_at', 'is', null).orderBy('code').execute();
    // ภาระภาษีของสินค้าบริการ (ค่าเริ่มต้นระบบขาย ข้อ 11): 1 เกณฑ์สิทธิ 2 เกณฑ์เงินสด 3 ให้ผู้ใช้เลือกตอนเปิดบิล
    return { types, main_warehouse_id: (await stockSettings(db, a.companyId)).mainWarehouseId, vat_rate: s['gen.vat_rate'] ?? 7, price_type: s['gen.price_type'] ?? '2', service_vat_basis: String(s[cls === 'IV' || cls === 'HS' || cls === 'DR' || cls === 'CN' ? 'ar.service_vat_basis' : 'ap.service_vat_basis'] ?? '3') };
  });
}
