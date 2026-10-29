import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { d, SETTLE_KINDS, settlementTotals, type SettleKind } from '@buddy/core';
import type { Db } from '../../db.js';
import { badRequest, notFound, parse, requireCompany, type AuthContext } from '../../http.js';
import { logActivity } from '../../audit.js';
import { periodFor } from '../gl/journals.js';
import { cancelDocument, issueDocNo, postDocument, unpostDocument } from './engine.js';
import { branchOf, checkWht, clearMoneyParts, loadMethods, num, paymentsSchema, readMoneyParts, releaseCheques, whtSchema, writePayments, writeWht } from './payments.js';

type Ctx = AuthContext & { companyId: string };
const uuid = z.string().uuid();
const optId = uuid.nullable().optional().transform((v) => v ?? null);
const str = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ไม่ถูกต้อง');
const money = (v: ReturnType<typeof d>) => v.toDecimalPlaces(2).toFixed(2);

const body = z.object({
  doc_type_id: uuid, doc_date: isoDate, payment_date: isoDate.nullable().optional(),
  party_id: z.string({ required_error: 'เลือกลูกค้า/ผู้จำหน่าย', invalid_type_error: 'เลือกลูกค้า/ผู้จำหน่าย' }).uuid('เลือกลูกค้า/ผู้จำหน่าย'),
  department_id: optId, salesperson_id: optId, your_ref: str(60), remark: str(2000),
  settlements: z.array(z.object({ invoice_header_id: uuid, amount: num, vat_amount: num.nullable().optional() }))
    .min(1, 'เลือกบิลที่จะตัดชำระอย่างน้อย 1 ใบ (F5 เลือกบิลค้าง)').max(500),
  interest_amount: num.default('0'), cash_discount_amount: num.default('0'), wht_amount: num.default('0'),
  /** ว่าง = ส่วนที่เหลือหลังชำระโดยวิธีอื่นเป็นเงินสด */
  cash_amount: num.nullable().optional(),
  payments: paymentsSchema,
  /** รายละเอียดภาษีหัก ณ ที่จ่าย (S-PU-C4) สำหรับทะเบียน ภ.ง.ด.3/53 และพิมพ์ 50 ทวิ — ได้ 2 ประเภทเงินได้ */
  wht: whtSchema,
});
type Body = z.infer<typeof body>;

/** บิลค้างของคู่ค้า + ยอดที่ใบนี้ตัดไว้เดิม (กรณีแก้ไข) — ยอดเป็นบวกเสมอ ใบลดหนี้แสดงเครื่องหมายลบตอนรวม */
async function openItems(db: Db, companyId: string, K: SettleKind, partyId: string, receiptId: string | null, only?: string[]) {
  const view = K.module === 'AR' ? 'v_ar_outstanding' : 'v_ap_outstanding';
  const partyCol = K.party === 'customer' ? 'customer_id' : 'supplier_id';
  const own = receiptId ? sql`(SELECT coalesce(sum(s.amount), 0) FROM doc_settlement s WHERE s.payment_header_id = ${receiptId} AND s.invoice_header_id = o.header_id AND s.deleted_at IS NULL)` : sql`0`;
  return (await sql<{ header_id: string; doc_class: string; doc_no: string; doc_date: string; due_date: string | null; amount: string; outstanding: string; own: string; vat_basis: string | null; net_amount: string; vat_amount: string; ref_no: string | null; bill_no: string | null }>`
    SELECT o.header_id, o.doc_class, o.doc_no, o.doc_date, o.due_date, abs(o.amount) AS amount, abs(o.outstanding) + ${own} AS outstanding, ${own} AS own,
           h.vat_basis, h.net_amount, h.vat_amount, h.ref_no,
           (SELECT b.doc_no FROM doc_bill_item bi JOIN doc_header b ON b.id = bi.bill_header_id
             WHERE bi.invoice_header_id = o.header_id AND bi.deleted_at IS NULL AND b.doc_status <> 'C' AND b.deleted_at IS NULL ORDER BY b.doc_date DESC LIMIT 1) AS bill_no
      FROM ${sql.table(view)} o JOIN doc_header h ON h.id = o.header_id
     WHERE o.company_id = ${companyId} AND o.${sql.ref(partyCol)} = ${partyId}
       AND ${only ? sql`o.header_id = ANY(${only}::uuid[])` : sql`(o.outstanding <> 0 OR ${own} <> 0)`}
     ORDER BY o.due_date NULLS LAST, o.doc_date, o.doc_no`.execute(db)).rows;
}

/** ใบเสร็จ/ใบสำคัญจ่าย: ตัดบิล ผลต่าง วิธีชำระ เช็ค ภาษีหัก ณ ที่จ่าย แล้วลงบัญชีในทรานแซกชันเดียวกัน */
async function saveSettle(db: Db, a: Ctx, K: SettleKind, id: string | null, b: Body) {
  const dt = await db.selectFrom('md_doc_type').select(['id', 'doc_class', 'department_id', 'status']).where('id', '=', b.doc_type_id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
  if (!dt || dt.doc_class !== K.cls) throw badRequest(`เลือกประเภทเอกสารของ${K.label}`);
  if (!id && dt.status !== 'A') throw badRequest('ประเภทเอกสารนี้เลิกใช้แล้ว');
  const partyTbl = K.party === 'customer' ? 'md_customer' : 'md_supplier';
  const party = await db.selectFrom(partyTbl).select(['id', 'code', 'title', 'name', 'address_1', 'address_2', 'address_3', 'zip_code', 'tax_id', 'tax_branch_no', 'status']).where('id', '=', b.party_id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
  if (!party) throw badRequest(`ไม่พบ${K.party === 'customer' ? 'ลูกค้า' : 'ผู้จำหน่าย'}นี้`);
  const payDate = b.payment_date ?? b.doc_date;

  // บิลที่ตัด: ของคู่ค้ารายนี้ ยังไม่ยกเลิก ไม่เกินยอดคงค้าง
  const ids = b.settlements.map((s) => s.invoice_header_id);
  if (new Set(ids).size !== ids.length) throw badRequest('เลือกบิลซ้ำในใบเดียวกัน');
  const open = new Map((await openItems(db, a.companyId, K, party.id, id, ids)).map((o) => [o.header_id, o]));
  const setts = b.settlements.map((s, i) => {
    const o = open.get(s.invoice_header_id);
    if (!o) throw badRequest(`บรรทัดที่ ${i + 1}: ไม่พบบิลค้างของ${party.code} (บิลถูกยกเลิก หรือเป็นของคู่ค้ารายอื่น)`);
    const amt = d(s.amount);
    if (amt.lte(0)) throw badRequest(`${o.doc_no}: ป้อนยอดชำระมากกว่า 0`);
    if (amt.gt(d(o.outstanding))) throw badRequest(`${o.doc_no}: ยอดชำระ ${money(amt)} มากกว่ายอดคงค้าง ${money(d(o.outstanding))}`);
    // ภาษีเกณฑ์เงินสด (ค่าบริการ): ภาษีส่วนที่ชำระ = ยอดชำระ × VAT ÷ ยอดรวมของบิล (คู่มือ S-RE-01b แก้ได้)
    const vat = s.vat_amount != null && s.vat_amount !== '' ? d(s.vat_amount) : o.vat_basis === '2' && !d(o.net_amount).isZero() ? amt.times(d(o.vat_amount)).div(d(o.net_amount)) : d(0);
    return { o, amount: money(amt), vat: money(vat), sign: o.doc_class === K.neg ? -1 : 1, rectype: K.open[o.doc_class]! };
  });

  // ภาษีหัก ณ ที่จ่าย: ใบสำคัญจ่ายป้อนรายละเอียดได้ → ยอดรวมแทนช่องยอด
  if (b.wht.length && K.cls !== 'PS') throw badRequest('ใบเสร็จรับเงินป้อนเพียงยอดภาษีที่ถูกหัก — รายละเอียด 50 ทวิ ออกโดยลูกค้า');
  const wht = b.wht.length ? checkWht(b.wht) : d(b.wht_amount);
  for (const [v, n] of [[wht, 'ภาษีหัก ณ ที่จ่าย'], [d(b.cash_discount_amount), 'ส่วนลดเงินสด'], [d(b.interest_amount), 'ดอกเบี้ย']] as const) if (v.lt(0)) throw badRequest(`${n}ต้องไม่ติดลบ`);

  const mById = await loadMethods(db, a.companyId, K.direction, b.payments);

  const t = settlementTotals({ settlements: setts.map((s) => d(s.amount).times(s.sign).toFixed(2)), interest: b.interest_amount, discount: b.cash_discount_amount, wht: wht.toFixed(2),
    payments: b.payments.map((p) => p.amount), cash: b.cash_amount });
  if (d(t.due).lt(0)) throw badRequest(`ยอดชำระตามใบกำกับติดลบ (${t.due}) — ใบลดหนี้มากกว่าบิลที่เลือก`);
  if (d(t.cash).lt(0)) throw badRequest(`ชำระโดยวิธีอื่นรวม ${t.other} มากกว่ายอดที่ต้อง${K.direction === 'R' ? 'รับ' : 'จ่าย'} ${t.due}`);
  if (!t.ok) throw badRequest(`ยอดชำระตามใบกำกับ ${t.due} ไม่เท่ากับยอดชำระจริง ${t.paid} (Message# ${K.cls === 'RE' ? '4025' : '4066'}) — ปรับเงินสด ส่วนลด ดอกเบี้ย หรือภาษีหัก ณ ที่จ่าย`);

  const header = {
    doc_type_id: dt.id, doc_class: K.cls, module: K.module, doc_date: b.doc_date, payment_date: payDate,
    customer_id: K.party === 'customer' ? party.id : null, supplier_id: K.party === 'supplier' ? party.id : null,
    party_name: [party.title, party.name].filter(Boolean).join(' ').slice(0, 200), party_address: [party.address_1, party.address_2, party.address_3, party.zip_code].filter(Boolean).join(' ').slice(0, 500) || null,
    party_tax_id: party.tax_id, party_tax_branch_no: party.tax_branch_no, department_id: b.department_id ?? dt.department_id, salesperson_id: b.salesperson_id,
    your_ref: b.your_ref, remark: b.remark, price_type: '0', amount: t.billed, net_amount: t.billed,
    vat_amount: money(setts.reduce((s, x) => s.plus(d(x.vat).times(x.sign)), d(0))), vat_date: payDate,
    wht_amount: money(wht), interest_amount: money(d(b.interest_amount)), cash_discount_amount: money(d(b.cash_discount_amount)),
    cash_amount: t.cash, cheque_amount: t.other, updated_by: a.userId,
  };
  return db.transaction().execute(async (tx) => {
    await periodFor(tx, a.companyId, b.doc_date);
    let hid = id, docNo: string;
    if (id) {
      const cur = await tx.selectFrom('doc_header').select(['doc_no', 'doc_status', 'doc_class', 'doc_date']).where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
      if (!cur || cur.doc_class !== K.cls) throw notFound(K.label);
      if (cur.doc_status === 'C') throw badRequest('เอกสารนี้ถูกยกเลิกแล้ว แก้ไขไม่ได้');
      await periodFor(tx, a.companyId, String(cur.doc_date).slice(0, 10));
      await releaseCheques(tx, a, id, cur.doc_no);
      docNo = cur.doc_no;
      await tx.updateTable('doc_header').set(header).where('id', '=', id).execute();
      await clearMoneyParts(tx, id);
      await tx.updateTable('doc_settlement').set({ deleted_at: sql`now()` as never }).where('payment_header_id', '=', id).where('deleted_at', 'is', null).execute();
    } else {
      docNo = await issueDocNo(tx, a.companyId, dt.id);
      hid = (await tx.insertInto('doc_header').values({ ...header, company_id: a.companyId, branch_id: await branchOf(tx, a), doc_no: docNo, doc_status: 'N', created_by: a.userId }).returning('id').executeTakeFirstOrThrow()).id;
    }
    // express_rectype: รหัสรายการตัดแบบ Express (3 บิล 4 เพิ่มหนี้ 5 ลดหนี้) — เครื่องลงบัญชีใช้กลับเครื่องหมายใบลดหนี้
    await tx.insertInto('doc_settlement').values(setts.map((s) => ({ company_id: a.companyId, payment_header_id: hid!, invoice_header_id: s.o.header_id, express_rectype: s.rectype, amount: s.amount, vat_amount: s.vat, created_by: a.userId }))).execute();
    await writePayments(tx, a, { headerId: hid!, direction: K.direction, payDate, methods: mById, payments: b.payments, customerId: header.customer_id, supplierId: header.supplier_id, partyName: header.party_name, departmentId: header.department_id });
    await writeWht(tx, a, { headerId: hid!, docNo, payDate, wht: b.wht, supplierId: header.supplier_id, departmentId: header.department_id,
      payee: { name: header.party_name || party.code, address: header.party_address, tax_id: party.tax_id, branch_no: party.tax_branch_no } });
    const curJ = id ? await tx.selectFrom('gl_journal').select('id').where('source_header_id', '=', id).where('doc_status', '=', 'N').where('deleted_at', 'is', null).executeTakeFirst() : undefined;
    const posted = await postDocument(tx, a, hid!, curJ?.id);
    if (!posted.journal_id && curJ) await unpostDocument(tx, a, hid!);
    await logActivity(tx, a, { module: K.module, action: id ? 'EDIT' : 'ADD', docNo, table: 'doc_header', rowId: hid });
    return { id: hid, doc_no: docNo, journal_id: posted.journal_id, net_amount: t.billed, cash_amount: t.cash };
  });
}

export function settleRoutes(app: FastifyInstance, db: Db) {
  for (const K of SETTLE_KINDS) {
    const base = `/api/v1/${K.path}`;
    const partyCol = K.party === 'customer' ? 'customer_id' : 'supplier_id';
    const partyTbl = K.party === 'customer' ? 'md_customer' : 'md_supplier';
    app.get(base, async (req) => {
      const a = requireCompany(req);
      const q = parse(z.object({ q: z.string().optional(), from: isoDate.optional(), to: isoDate.optional(), party_id: uuid.optional(), status: z.enum(['N', 'C', 'all']).default('all'),
        limit: z.coerce.number().int().min(1).max(1000).default(200), offset: z.coerce.number().int().min(0).default(0) }), req.query);
      const like = q.q?.trim() ? `%${q.q.trim()}%` : null;
      const where = sql.join([
        sql`h.company_id = ${a.companyId}`, sql`h.doc_class = ${K.cls}`, sql`h.deleted_at IS NULL`,
        ...(q.from ? [sql`h.doc_date >= ${q.from}`] : []), ...(q.to ? [sql`h.doc_date <= ${q.to}`] : []),
        ...(q.party_id ? [sql`h.${sql.ref(partyCol)} = ${q.party_id}`] : []), ...(q.status !== 'all' ? [sql`h.doc_status = ${q.status}`] : []),
        ...(like ? [sql`(h.doc_no ILIKE ${like} OR h.party_name ILIKE ${like} OR p.code ILIKE ${like} OR h.your_ref ILIKE ${like})`] : []),
      ], sql` AND `);
      const from = sql`FROM doc_header h LEFT JOIN ${sql.table(partyTbl)} p ON p.id = h.${sql.ref(partyCol)} WHERE ${where}`;
      const total = (await sql<{ n: number }>`SELECT count(*) AS n ${from}`.execute(db)).rows[0]!.n;
      const rows = (await sql`SELECT h.id, h.doc_no, h.doc_date, h.payment_date, h.party_name, p.code AS party_code, h.net_amount, h.wht_amount, h.cash_amount, h.cheque_amount, h.doc_status, h.gl_posted,
          (SELECT count(*) FROM doc_settlement s WHERE s.payment_header_id = h.id AND s.deleted_at IS NULL)::int AS bills ${from} ORDER BY h.doc_date DESC, h.doc_no DESC LIMIT ${q.limit} OFFSET ${q.offset}`.execute(db)).rows;
      return { total: Number(total), rows };
    });
    /** S-RE-01a / S-PU-07a: บิลค้างของคู่ค้า (receipt_id = ใบที่กำลังแก้ ให้นับยอดที่ใบนั้นตัดไว้กลับเป็นค้าง) */
    app.get(`${base}/open-items`, async (req) => {
      const a = requireCompany(req);
      const q = parse(z.object({ party_id: uuid, receipt_id: uuid.optional() }), req.query);
      const p = await db.selectFrom(partyTbl).select('id').where('id', '=', q.party_id).where('company_id', '=', a.companyId).executeTakeFirst();
      if (!p) throw notFound(K.party === 'customer' ? 'ลูกค้า' : 'ผู้จำหน่าย');
      return { rows: await openItems(db, a.companyId, K, p.id, q.receipt_id ?? null) };
    });
    app.get(`${base}/:id`, async (req) => {
      const a = requireCompany(req);
      const { id } = parse(z.object({ id: uuid }), req.params);
      const h = await db.selectFrom('doc_header').selectAll().where('id', '=', id).where('company_id', '=', a.companyId).where('doc_class', '=', K.cls).where('deleted_at', 'is', null).executeTakeFirst();
      if (!h) throw notFound(K.label);
      const partyId = (h.customer_id ?? h.supplier_id)!;
      const settlements = await db.selectFrom('doc_settlement as s').innerJoin('doc_header as i', 'i.id', 's.invoice_header_id')
        .select(['s.invoice_header_id', 'i.doc_class', 'i.doc_no', 'i.doc_date', 'i.due_date', 'i.net_amount as invoice_amount', 's.amount', 's.vat_amount'])
        .where('s.payment_header_id', '=', id).where('s.deleted_at', 'is', null).orderBy('i.doc_date').orderBy('i.doc_no').execute();
      const open = new Map((await openItems(db, a.companyId, K, partyId, id, settlements.map((s) => s.invoice_header_id))).map((o) => [o.header_id, o.outstanding]));
      const { payments, wht } = await readMoneyParts(db, a.companyId, id);
      const pc = await db.selectFrom(partyTbl).select('code').where('id', '=', partyId).executeTakeFirst();
      return { ...h, party_code: pc?.code ?? null, settlements: settlements.map((s) => ({ ...s, outstanding: open.get(s.invoice_header_id) ?? s.amount })), payments, wht, editable: h.doc_status !== 'C' };
    });
    app.post(base, async (req) => saveSettle(db, requireCompany(req), K, null, parse(body, req.body)));
    app.put(`${base}/:id`, async (req) => saveSettle(db, requireCompany(req), K, parse(z.object({ id: uuid }), req.params).id, parse(body, req.body)));
    app.post(`${base}/:id/cancel`, async (req) => {
      const a = requireCompany(req);
      const { id } = parse(z.object({ id: uuid }), req.params);
      const { reason } = parse(z.object({ reason: z.string().trim().min(1, 'ป้อนเหตุผลที่ยกเลิก').max(200) }), req.body);
      const h = await db.selectFrom('doc_header').select(['id', 'doc_no']).where('id', '=', id).where('company_id', '=', a.companyId).where('doc_class', '=', K.cls).where('deleted_at', 'is', null).executeTakeFirst();
      if (!h) throw notFound(K.label);
      // ยกเลิก = สถานะ C: รายการตัดบิลไม่ถูกนับในยอดคงค้างอีก (view) · เช็คออกจากทะเบียน · ภาษีหัก ณ ที่จ่ายเป็นยกเลิก
      return cancelDocument(db, a, id, reason, async (tx) => {
        await releaseCheques(tx, a, id, h.doc_no);
        await tx.updateTable('tax_wht_entry').set({ doc_status: 'C', updated_by: a.userId }).where('company_id', '=', a.companyId).where('header_id', '=', id).where('deleted_at', 'is', null).execute();
      });
    });
  }
}
