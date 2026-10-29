import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { CASH_KINDS, computeDoc, d, dueDate, settlementTotals, type CashKind } from '@buddy/core';
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
/** รหัสที่ใช้ในบรรทัด: รายได้อื่น = 4 · ค่าใช้จ่ายอื่น = 5 (และ 2 ตามข้อมูลที่ย้ายจาก Express — ดู HANDOFF เรื่อง item_type) */
const CODE_TYPES: Record<string, string[]> = { OI: ['4'], OE: ['5', '2'] };

const body = z.object({
  doc_type_id: uuid, doc_date: isoDate, party_id: optId, party_name: str(200), party_tax_branch_no: str(5), your_ref: str(60),
  ref_no: str(30), ref_date: isoDate.nullable().optional(), department_id: optId, salesperson_id: optId,
  credit_days: z.coerce.number().int().min(0).max(999).nullable().optional(), price_type: z.enum(['0', '1', '2']), vat_rate: num, remark: str(2000),
  lines: z.array(z.object({ item_id: optId, description: str(200), amount: num, department_id: optId })).min(1, 'ป้อนรายการอย่างน้อย 1 บรรทัด').max(200),
  /** มัดจำรับ/รายได้อื่น: ยอดที่ลูกค้าหักภาษี ณ ที่จ่ายไว้ */
  wht_amount: num.default('0'),
  cash_amount: num.nullable().optional(),
  payments: paymentsSchema, wht: whtSchema,
});
type Body = z.infer<typeof body>;

async function saveCash(db: Db, a: Ctx, K: CashKind, id: string | null, b: Body) {
  const dt = await db.selectFrom('md_doc_type').select(['id', 'doc_class', 'department_id', 'status']).where('id', '=', b.doc_type_id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
  if (!dt || dt.doc_class !== K.cls) throw badRequest(`เลือกประเภทเอกสารของ${K.label}`);
  if (!id && dt.status !== 'A') throw badRequest('ประเภทเอกสารนี้เลิกใช้แล้ว');
  const word = K.party === 'customer' ? 'ลูกค้า' : 'ผู้จำหน่าย';
  if (K.partyRequired && !b.party_id) throw badRequest(`เลือก${word}`, [{ field: 'party_id', message: `เลือก${word}` }]);
  const partyTbl = K.party === 'customer' ? 'md_customer' : 'md_supplier';
  const party = b.party_id ? await db.selectFrom(partyTbl).select(['id', 'code', 'title', 'name', 'address_1', 'address_2', 'address_3', 'zip_code', 'tax_id', 'tax_branch_no', 'status', 'credit_days']).where('id', '=', b.party_id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst() : null;
  if (b.party_id && !party) throw badRequest(`ไม่พบ${word}นี้`);
  if (!id && party?.status === 'I') throw badRequest(`${party.code} เลิกใช้แล้ว — เปลี่ยนสถานะที่รายละเอียด${word}ก่อน`);

  // บรรทัด: มัดจำ = คำอธิบาย + จำนวนเงิน · รายได้/ค่าใช้จ่ายอื่น = รหัส (ตารางรหัสรายได้/ค่าใช้จ่าย) + จำนวนเงิน
  const itemIds = [...new Set(b.lines.map((l) => l.item_id).filter((x): x is string => !!x))];
  const items = itemIds.length ? await db.selectFrom('md_item').select(['id', 'code', 'name_th', 'item_type', 'vat_code']).where('company_id', '=', a.companyId).where('id', 'in', itemIds).where('deleted_at', 'is', null).execute() : [];
  const byId = new Map(items.map((i) => [i.id, i]));
  b.lines.forEach((l, i) => {
    if (K.lines === 'code') {
      const it = l.item_id ? byId.get(l.item_id) : undefined;
      if (!it) throw badRequest(`บรรทัดที่ ${i + 1}: เลือกรหัส${K.cls === 'OI' ? 'รายได้' : 'ค่าใช้จ่าย'}`);
      if (!CODE_TYPES[K.cls]!.includes(it.item_type ?? '')) throw badRequest(`บรรทัดที่ ${i + 1}: ${it.code} ไม่ใช่รหัส${K.cls === 'OI' ? 'รายได้อื่น' : 'ค่าใช้จ่ายอื่น'} — กำหนดที่รายละเอียด${K.cls === 'OI' ? 'รายได้' : 'ค่าใช้จ่าย'}อื่น ๆ`);
    } else if (l.item_id) throw badRequest(`บรรทัดที่ ${i + 1}: ${K.label}ป้อนคำอธิบายและจำนวนเงินเท่านั้น`);
    else if (!l.description) throw badRequest(`บรรทัดที่ ${i + 1}: ป้อนคำอธิบาย`);
    if (d(l.amount).isZero()) throw badRequest(`บรรทัดที่ ${i + 1}: ป้อนจำนวนเงิน`);
  });
  const calc = computeDoc({ price_type: b.price_type, vat_rate: b.vat_rate, lines: b.lines.map((l) => ({ qty: 1, unit_price: l.amount, vat_exempt: l.item_id ? byId.get(l.item_id)?.vat_code === '0' : false })) });
  if (calc.errors.length) throw badRequest(calc.errors[0]!, calc.errors.map((m) => ({ message: m })));
  if (d(calc.net_amount).lte(0)) throw badRequest('จำนวนเงินรวมทั้งสิ้นต้องมากกว่า 0');

  if (b.wht.length && !K.whtEntries) throw badRequest(`${K.label}ป้อนเพียงยอดภาษีที่ถูกหัก — รายละเอียด 50 ทวิ ออกโดยผู้จ่าย`);
  const wht = b.wht.length ? checkWht(b.wht) : d(b.wht_amount);
  if (wht.lt(0)) throw badRequest('ภาษีหัก ณ ที่จ่ายต้องไม่ติดลบ');
  const methods = await loadMethods(db, a.companyId, K.direction, b.payments);
  // จำนวนเงินรวมทั้งสิ้น = ยอดชำระจริง (เงินสด + ชำระโดยอื่น + ภาษีหัก ณ ที่จ่าย) เสมอ (คู่มือหน้า 171, 189, 233)
  const t = settlementTotals({ settlements: [calc.net_amount], wht: wht.toFixed(2), payments: b.payments.map((p) => p.amount), cash: b.cash_amount });
  if (d(t.cash).lt(0)) throw badRequest(`ชำระโดยวิธีอื่นรวม ${t.other} มากกว่ายอดที่ต้อง${K.direction === 'R' ? 'รับ' : 'จ่าย'} ${t.due}`);
  if (!t.ok) throw badRequest(`จำนวนเงินรวมทั้งสิ้น ${calc.net_amount} ไม่เท่ากับยอดชำระจริง ${d(t.paid).plus(wht).toFixed(2)} — ล้างช่องเงินสดให้คำนวณเอง`);

  const name = party ? [party.title, party.name].filter(Boolean).join(' ') : (b.party_name ?? '');
  const credit = b.credit_days ?? 0;
  const header = {
    doc_type_id: dt.id, doc_class: K.cls, module: K.module, doc_date: b.doc_date, payment_date: b.doc_date,
    customer_id: K.party === 'customer' ? party?.id ?? null : null, supplier_id: K.party === 'supplier' ? party?.id ?? null : null,
    party_name: name.slice(0, 200) || null, party_address: party ? [party.address_1, party.address_2, party.address_3, party.zip_code].filter(Boolean).join(' ').slice(0, 500) || null : null,
    party_tax_id: party?.tax_id ?? null, party_tax_branch_no: b.party_tax_branch_no ?? party?.tax_branch_no ?? null,
    your_ref: b.your_ref, ref_no: b.ref_no, ref_date: b.ref_date ?? null, department_id: b.department_id ?? dt.department_id, salesperson_id: b.salesperson_id,
    credit_days: K.deposit ? credit : null, due_date: K.deposit ? dueDate(b.doc_date, credit) : null,
    price_type: b.price_type, vat_rate: b.vat_rate, vat_basis: '1', vat_date: b.ref_date ?? b.doc_date,
    amount: calc.amount, amount_after_discount: calc.amount_after_discount, zero_rate_amount: calc.zero_rate_amount, taxable_amount: calc.taxable_amount, vat_amount: calc.vat_amount, net_amount: calc.net_amount,
    wht_amount: wht.toFixed(2), cash_amount: t.cash, cheque_amount: t.other, remark: b.remark, updated_by: a.userId,
  };
  return db.transaction().execute(async (tx) => {
    await periodFor(tx, a.companyId, b.doc_date);
    let hid = id, docNo: string;
    if (id) {
      const cur = await tx.selectFrom('doc_header').select(['doc_no', 'doc_status', 'doc_class', 'doc_date', 'amount']).where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
      if (!cur || cur.doc_class !== K.cls) throw notFound(K.label);
      if (cur.doc_status === 'C') throw badRequest('เอกสารนี้ถูกยกเลิกแล้ว แก้ไขไม่ได้');
      await periodFor(tx, a.companyId, String(cur.doc_date).slice(0, 10));
      if (K.deposit) {
        const used = await depositUsed(tx, id);
        if (used.gt(d(calc.amount))) throw badRequest(`มัดจำนี้หักในบิลไปแล้ว ${used.toFixed(2)} — ยอดมัดจำต้องไม่น้อยกว่านี้`);
      }
      await releaseCheques(tx, a, id, cur.doc_no);
      docNo = cur.doc_no;
      await tx.updateTable('doc_header').set(header).where('id', '=', id).execute();
      await clearMoneyParts(tx, id);
      await tx.updateTable('doc_line').set({ deleted_at: sql`now()` as never }).where('header_id', '=', id).where('deleted_at', 'is', null).execute();
    } else {
      docNo = await issueDocNo(tx, a.companyId, dt.id);
      hid = (await tx.insertInto('doc_header').values({ ...header, company_id: a.companyId, branch_id: await branchOf(tx, a), doc_no: docNo, doc_status: 'N', created_by: a.userId }).returning('id').executeTakeFirstOrThrow()).id;
    }
    await tx.insertInto('doc_line').values(b.lines.map((l, i) => ({
      company_id: a.companyId, header_id: hid!, line_no: i + 1, line_kind: 'I', item_id: l.item_id, description: l.description ?? (l.item_id ? byId.get(l.item_id)!.name_th : null),
      department_id: l.department_id ?? header.department_id, qty: '1', factor: '1', base_qty: '1', unit_price: l.amount, line_amount: calc.lines[i]!.line_amount, net_amount: calc.lines[i]!.net_amount,
      vat_code: l.item_id ? byId.get(l.item_id)!.vat_code : null, stock_effect: 0, created_by: a.userId,
    }))).execute();
    await writePayments(tx, a, { headerId: hid!, direction: K.direction, payDate: b.doc_date, methods, payments: b.payments, customerId: header.customer_id, supplierId: header.supplier_id, partyName: name, departmentId: header.department_id });
    if (b.wht.length) {
      if (!name) throw badRequest('ป้อนชื่อผู้ถูกหักภาษี (เลือกผู้จำหน่าย หรือป้อนชื่อ) ก่อนบันทึกภาษีหัก ณ ที่จ่าย');
      await writeWht(tx, a, { headerId: hid!, docNo, payDate: b.doc_date, wht: b.wht, supplierId: header.supplier_id, departmentId: header.department_id,
        payee: { name, address: header.party_address, tax_id: header.party_tax_id, branch_no: header.party_tax_branch_no } });
    }
    const curJ = id ? await tx.selectFrom('gl_journal').select('id').where('source_header_id', '=', id).where('doc_status', '=', 'N').where('deleted_at', 'is', null).executeTakeFirst() : undefined;
    const posted = await postDocument(tx, a, hid!, curJ?.id);
    if (!posted.journal_id && curJ) await unpostDocument(tx, a, hid!);
    await logActivity(tx, a, { module: K.module, action: id ? 'EDIT' : 'ADD', docNo, table: 'doc_header', rowId: hid });
    return { id: hid, doc_no: docNo, journal_id: posted.journal_id, net_amount: calc.net_amount, cash_amount: t.cash };
  });
}

/** ยอดมัดจำที่หักในบิลแล้ว (บิลที่ยังไม่ยกเลิก) */
async function depositUsed(db: Db, headerId: string) {
  const r = (await sql<{ used: string }>`SELECT used FROM v_deposit_outstanding WHERE header_id = ${headerId}`.execute(db)).rows[0];
  return d(r?.used ?? 0);
}

export function cashDocRoutes(app: FastifyInstance, db: Db) {
  for (const K of CASH_KINDS) {
    const base = `/api/v1/${K.path}`;
    const partyCol = K.party === 'customer' ? 'customer_id' : 'supplier_id';
    const partyTbl = K.party === 'customer' ? 'md_customer' : 'md_supplier';
    app.get(base, async (req) => {
      const a = requireCompany(req);
      const q = parse(z.object({ q: z.string().optional(), from: isoDate.optional(), to: isoDate.optional(), party_id: uuid.optional(), status: z.enum(['N', 'C', 'all']).default('all'), type_id: uuid.optional(),
        limit: z.coerce.number().int().min(1).max(1000).default(200), offset: z.coerce.number().int().min(0).default(0) }), req.query);
      const like = q.q?.trim() ? `%${q.q.trim()}%` : null;
      const where = sql.join([
        sql`h.company_id = ${a.companyId}`, sql`h.doc_class = ${K.cls}`, sql`h.deleted_at IS NULL`,
        ...(q.from ? [sql`h.doc_date >= ${q.from}`] : []), ...(q.to ? [sql`h.doc_date <= ${q.to}`] : []),
        ...(q.party_id ? [sql`h.${sql.ref(partyCol)} = ${q.party_id}`] : []), ...(q.status !== 'all' ? [sql`h.doc_status = ${q.status}`] : []), ...(q.type_id ? [sql`h.doc_type_id = ${q.type_id}`] : []),
        ...(like ? [sql`(h.doc_no ILIKE ${like} OR h.party_name ILIKE ${like} OR p.code ILIKE ${like} OR h.your_ref ILIKE ${like} OR h.ref_no ILIKE ${like})`] : []),
      ], sql` AND `);
      const from = sql`FROM doc_header h LEFT JOIN ${sql.table(partyTbl)} p ON p.id = h.${sql.ref(partyCol)} WHERE ${where}`;
      const total = (await sql<{ n: number }>`SELECT count(*) AS n ${from}`.execute(db)).rows[0]!.n;
      const rows = (await sql`SELECT h.id, h.doc_no, h.doc_date, h.due_date, h.party_name, p.code AS party_code, h.ref_no, h.amount, h.vat_amount, h.net_amount, h.wht_amount, h.doc_status,
          ${K.deposit ? sql`(SELECT o.outstanding FROM v_deposit_outstanding o WHERE o.header_id = h.id)` : sql`NULL`} AS remaining ${from} ORDER BY h.doc_date DESC, h.doc_no DESC LIMIT ${q.limit} OFFSET ${q.offset}`.execute(db)).rows;
      return { total: Number(total), rows };
    });
    app.get(`${base}/:id`, async (req) => {
      const a = requireCompany(req);
      const { id } = parse(z.object({ id: uuid }), req.params);
      const h = await db.selectFrom('doc_header').selectAll().where('id', '=', id).where('company_id', '=', a.companyId).where('doc_class', '=', K.cls).where('deleted_at', 'is', null).executeTakeFirst();
      if (!h) throw notFound(K.label);
      const lines = await db.selectFrom('doc_line as l').leftJoin('md_item as i', 'i.id', 'l.item_id')
        .select(['l.line_no', 'l.item_id', 'i.code as item_code', 'l.description', 'l.line_amount as amount', 'l.net_amount', 'l.department_id'])
        .where('l.header_id', '=', id).where('l.deleted_at', 'is', null).orderBy('l.line_no').execute();
      const { payments, wht } = await readMoneyParts(db, a.companyId, id);
      const partyId = h.customer_id ?? h.supplier_id;
      const pc = partyId ? await db.selectFrom(partyTbl).select('code').where('id', '=', partyId).executeTakeFirst() : undefined;
      const usedBy = K.deposit ? (await sql<{ id: string; doc_no: string; doc_date: string; doc_class: string; amount: string }>`SELECT t.id, t.doc_no, t.doc_date, t.doc_class, l.amount FROM doc_link l JOIN doc_header t ON t.id = l.to_header_id
          WHERE l.from_header_id = ${id} AND l.link_type = 'DEPOSIT' AND l.deleted_at IS NULL AND t.doc_status <> 'C' AND t.deleted_at IS NULL ORDER BY t.doc_date, t.doc_no`.execute(db)).rows : [];
      const rem = K.deposit ? (await sql<{ outstanding: string }>`SELECT outstanding FROM v_deposit_outstanding WHERE header_id = ${id}`.execute(db)).rows[0]?.outstanding ?? null : null;
      return { ...h, party_code: pc?.code ?? null, lines, payments, wht, used_by: usedBy, remaining: rem, editable: h.doc_status !== 'C' };
    });
    app.post(base, async (req) => saveCash(db, requireCompany(req), K, null, parse(body, req.body)));
    app.put(`${base}/:id`, async (req) => saveCash(db, requireCompany(req), K, parse(z.object({ id: uuid }), req.params).id, parse(body, req.body)));
    app.post(`${base}/:id/cancel`, async (req) => {
      const a = requireCompany(req);
      const { id } = parse(z.object({ id: uuid }), req.params);
      const { reason } = parse(z.object({ reason: z.string().trim().min(1, 'ป้อนเหตุผลที่ยกเลิก').max(200) }), req.body);
      const h = await db.selectFrom('doc_header').select(['id', 'doc_no']).where('id', '=', id).where('company_id', '=', a.companyId).where('doc_class', '=', K.cls).where('deleted_at', 'is', null).executeTakeFirst();
      if (!h) throw notFound(K.label);
      return cancelDocument(db, a, id, reason, async (tx) => {
        if (K.deposit && (await depositUsed(tx, id)).gt(0)) throw badRequest(`${h.doc_no} หักในบิลแล้ว — ยกเลิกบิลที่หักมัดจำนี้ก่อน`);
        await releaseCheques(tx, a, id, h.doc_no);
        await tx.updateTable('tax_wht_entry').set({ doc_status: 'C', updated_by: a.userId }).where('company_id', '=', a.companyId).where('header_id', '=', id).where('deleted_at', 'is', null).execute();
      });
    });
  }
  /** มัดจำคงเหลือของคู่ค้า — ใช้หักในบิลขาย/ซื้อ (ประเภทราคาต้องตรงกับบิล คู่มือหน้า 210) */
  app.get('/api/v1/deposits/open', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ module: z.enum(['AR', 'AP']), party_id: uuid, invoice_id: uuid.optional() }), req.query);
    const own = q.invoice_id ? sql`(SELECT coalesce(sum(l.amount), 0) FROM doc_link l WHERE l.from_header_id = o.header_id AND l.to_header_id = ${q.invoice_id} AND l.link_type = 'DEPOSIT' AND l.deleted_at IS NULL)` : sql`0`;
    const rows = (await sql`SELECT o.header_id, o.doc_class, o.doc_no, o.doc_date, o.due_date, o.price_type, o.amount, o.outstanding + ${own} AS outstanding, ${own} AS own
      FROM v_deposit_outstanding o WHERE o.company_id = ${a.companyId} AND o.module = ${q.module} AND o.${sql.ref(q.module === 'AR' ? 'customer_id' : 'supplier_id')} = ${q.party_id}
        AND (o.outstanding > 0 OR ${own} <> 0) ORDER BY o.doc_date, o.doc_no`.execute(db)).rows;
    return { rows };
  });
}
