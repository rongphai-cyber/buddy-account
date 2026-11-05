/**
 * คืนเงินมัดจำ RD (05/11/2569 — WTS-Living ย้ายออก) · Express ไม่มีเอกสารนี้ (คู่มือบทที่ 12 มีแต่ AI แล้วหักในบิลขาย)
 * Buddy เพิ่มเป็นหมวดเอกสารใหม่ในระบบลูกหนี้ (ประเภทเอกสาร/เลขที่ของตัวเอง สมุดรายวันจ่าย):
 *  ลูกค้า + ใบรับเงินมัดจำ (AI ไม่มี VAT) ที่จะคืนพร้อมยอด (≤ คงเหลือ) + จ่ายเงินสด/โอน/เช็ค (วิธีจ่ายชำระ ใช้ส่วนชำระเดียวกับใบสำคัญจ่าย)
 *  ลงบัญชี Dr เงินมัดจำรับล่วงหน้า (ตามใบมัดจำ) / Cr เงินสด-ธนาคาร-เช็คจ่าย · doc_link DEPOSIT AI → RD ยอดคงเหลือของมัดจำลดลง
 *  ยกเลิก = สถานะ C → ยอดมัดจำกลับคืน (view ไม่นับเอกสารที่ยกเลิก) · ใบมัดจำที่มีใบคืนเงินอ้างอยู่ยกเลิก/ลบไม่ได้ (usedBy)
 */
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { d, DEPOSIT_REFUND as K, settlementTotals } from '@buddy/core';
import type { Db } from '../../db.js';
import { badRequest, notFound, parse, requireCompany, type AuthContext } from '../../http.js';
import { checkOwned } from '../../owned.js';
import { previewQuery, previewSave } from './preview.js';
import { logActivity } from '../../audit.js';
import { periodFor } from '../gl/journals.js';
import { cancelDocument, postDocument, unpostDocument, docNoFor, docNoInput } from './engine.js';
import { checkReceivedDeposits, clearDepositLinks, depositsSchema, readDepositLinks, writeDepositLinks } from './deposits.js';
import { clearMoneyParts, loadMethods, num, paymentsSchema, readMoneyParts, releaseCheques, saveBranch, writePayments } from './payments.js';

type Ctx = AuthContext & { companyId: string };
const uuid = z.string().uuid();
const optId = uuid.nullable().optional().transform((v) => v ?? null);
const str = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ไม่ถูกต้อง');

const body = z.object({
  branch_id: z.string().uuid().nullable().optional(), doc_type_id: uuid, doc_no: docNoInput, doc_date: isoDate,
  party_id: z.string({ required_error: 'เลือกลูกค้า', invalid_type_error: 'เลือกลูกค้า' }).uuid('เลือกลูกค้า'),
  department_id: optId, salesperson_id: optId, your_ref: str(60), remark: str(2000),
  /** ใบรับเงินมัดจำที่คืน + ยอดคืน (ไม่เกินคงเหลือ) */
  deposits: depositsSchema.refine((x) => x.length > 0, 'เลือกใบมัดจำที่จะคืนอย่างน้อย 1 ใบ'),
  /** ว่าง = ส่วนที่เหลือหลังจ่ายโดยวิธีอื่นเป็นเงินสด */
  cash_amount: num.nullable().optional(),
  payments: paymentsSchema,
});
type Body = z.infer<typeof body>;

async function saveRefund(db: Db, a: Ctx, id: string | null, b: Body) {
  const dt = await db.selectFrom('md_doc_type').select(['id', 'doc_class', 'department_id', 'status']).where('id', '=', b.doc_type_id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
  if (!dt || dt.doc_class !== K.cls) throw badRequest(`เลือกประเภทเอกสารของ${K.label} (หมวด RD) — ไม่มีให้เพิ่มที่ เริ่มระบบ › เลขที่เอกสาร`);
  if (!id && dt.status !== 'A') throw badRequest('ประเภทเอกสารนี้เลิกใช้แล้ว');
  const party = await db.selectFrom('md_customer').select(['id', 'code', 'title', 'name', 'address_1', 'address_2', 'address_3', 'zip_code', 'tax_id', 'tax_branch_no', 'status'])
    .where('id', '=', b.party_id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
  if (!party) throw badRequest('ไม่พบลูกค้านี้', [{ field: 'party_id', message: 'เลือกลูกค้า' }]);
  await checkOwned(db, a.companyId, [{ table: 'md_department', id: b.department_id, field: 'department_id' }, { table: 'md_salesperson', id: b.salesperson_id, field: 'salesperson_id' }]);
  const dep = await checkReceivedDeposits(db, a.companyId, { use: 'RD', customerId: party.id, partyCode: party.code, ownId: id, date: b.doc_date, deposits: b.deposits });
  const methods = await loadMethods(db, a.companyId, 'P', b.payments);
  const total = dep.total.toFixed(2);
  const t = settlementTotals({ settlements: [total], payments: b.payments.map((p) => p.amount), cash: b.cash_amount });
  if (d(t.cash).lt(0)) throw badRequest(`จ่ายโดยวิธีอื่นรวม ${t.other} มากกว่ายอดคืนเงินมัดจำ ${total} — ลดยอดจ่ายโดยวิธีอื่น`);
  if (!t.ok) throw badRequest(`ยอดคืนเงินมัดจำ ${total} ไม่เท่ากับยอดจ่ายจริง ${t.paid} — ล้างช่องเงินสดให้คำนวณเอง หรือแก้ยอดจ่ายโดยวิธีอื่น`);

  const name = [party.title, party.name].filter(Boolean).join(' ').slice(0, 200);
  const branchId = await saveBranch(db, a, id, b.branch_id);
  const header = {
    ...(branchId ? { branch_id: branchId } : {}),
    doc_type_id: dt.id, doc_class: K.cls, module: K.module, doc_date: b.doc_date, payment_date: b.doc_date, customer_id: party.id, supplier_id: null,
    party_name: name || null, party_address: [party.address_1, party.address_2, party.address_3, party.zip_code].filter(Boolean).join(' ').slice(0, 500) || null,
    party_tax_id: party.tax_id, party_tax_branch_no: party.tax_branch_no, your_ref: b.your_ref, remark: b.remark, department_id: b.department_id ?? dt.department_id, salesperson_id: b.salesperson_id,
    price_type: '0', vat_rate: '0', vat_amount: '0', amount: total, amount_after_discount: total, deposit_amount: total, net_amount: total,
    wht_amount: '0', cash_amount: t.cash, cheque_amount: t.other, updated_by: a.userId,
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
      await clearDepositLinks(tx, id);
    } else {
      docNo = await docNoFor(tx, a.companyId, dt.id, b.doc_no);
      hid = (await tx.insertInto('doc_header').values({ ...header, company_id: a.companyId, branch_id: branchId!, doc_no: docNo, doc_status: 'N', created_by: a.userId }).returning('id').executeTakeFirstOrThrow()).id;
    }
    await writeDepositLinks(tx, a, hid!, dep.rows);
    await writePayments(tx, a, { headerId: hid!, direction: 'P', payDate: b.doc_date, methods, payments: b.payments, customerId: party.id, supplierId: null, partyName: name, departmentId: header.department_id });
    const curJ = id ? await tx.selectFrom('gl_journal').select('id').where('source_header_id', '=', id).where('doc_status', '=', 'N').where('deleted_at', 'is', null).executeTakeFirst() : undefined;
    const posted = await postDocument(tx, a, hid!, curJ?.id);
    if (!posted.journal_id && curJ) await unpostDocument(tx, a, hid!);
    await logActivity(tx, a, { module: K.module, action: id ? 'EDIT' : 'ADD', docNo, table: 'doc_header', rowId: hid, detail: { deposits: dep.rows } });
    return { id: hid, doc_no: docNo, journal_id: posted.journal_id, net_amount: total, cash_amount: t.cash, warnings: [] as string[] };
  });
}

export function depositRefundRoutes(app: FastifyInstance, db: Db) {
  const base = `/api/v1/${K.path}`;
  app.get(base, async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ q: z.string().optional(), from: isoDate.optional(), to: isoDate.optional(), party_id: uuid.optional(), status: z.enum(['N', 'C', 'all']).default('all'), type_id: uuid.optional(),
      limit: z.coerce.number().int().min(1).max(1000).default(200), offset: z.coerce.number().int().min(0).default(0) }), req.query);
    const like = q.q?.trim() ? `%${q.q.trim()}%` : null;
    const where = sql.join([
      sql`h.company_id = ${a.companyId}`, sql`h.doc_class = ${K.cls}`, sql`h.deleted_at IS NULL`, ...(a.branchId ? [sql`h.branch_id = ${a.branchId}`] : []),
      ...(q.from ? [sql`h.doc_date >= ${q.from}`] : []), ...(q.to ? [sql`h.doc_date <= ${q.to}`] : []),
      ...(q.party_id ? [sql`h.customer_id = ${q.party_id}`] : []), ...(q.status !== 'all' ? [sql`h.doc_status = ${q.status}`] : []), ...(q.type_id ? [sql`h.doc_type_id = ${q.type_id}`] : []),
      ...(like ? [sql`(h.doc_no ILIKE ${like} OR h.party_name ILIKE ${like} OR p.code ILIKE ${like} OR h.your_ref ILIKE ${like}
        OR EXISTS (SELECT 1 FROM doc_link l JOIN doc_header f ON f.id = l.from_header_id WHERE l.to_header_id = h.id AND l.link_type = 'DEPOSIT' AND l.deleted_at IS NULL AND f.doc_no ILIKE ${like}))`] : []),
    ], sql` AND `);
    const from = sql`FROM doc_header h LEFT JOIN md_customer p ON p.id = h.customer_id WHERE ${where}`;
    const total = (await sql<{ n: number }>`SELECT count(*) AS n ${from}`.execute(db)).rows[0]!.n;
    const rows = (await sql`SELECT h.id, (SELECT b.code FROM sys_branch b WHERE b.id = h.branch_id) AS branch_code, h.doc_no, h.doc_date, h.party_name, p.code AS party_code, h.your_ref, h.net_amount, h.cash_amount, h.cheque_amount, h.doc_status,
        (SELECT string_agg(f.doc_no, ', ' ORDER BY f.doc_no) FROM doc_link l JOIN doc_header f ON f.id = l.from_header_id WHERE l.to_header_id = h.id AND l.link_type = 'DEPOSIT' AND l.deleted_at IS NULL) AS deposit_nos
        ${from} ORDER BY h.doc_date DESC, h.doc_no DESC LIMIT ${q.limit} OFFSET ${q.offset}`.execute(db)).rows;
    return { total: Number(total), rows };
  });
  app.get(`${base}/:id`, async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const h = await db.selectFrom('doc_header').selectAll().where('id', '=', id).where('company_id', '=', a.companyId).where('doc_class', '=', K.cls).where('deleted_at', 'is', null).executeTakeFirst();
    if (!h) throw notFound(K.label);
    const pc = h.customer_id ? await db.selectFrom('md_customer').select('code').where('id', '=', h.customer_id).where('company_id', '=', a.companyId).executeTakeFirst() : undefined;
    const { payments } = await readMoneyParts(db, a.companyId, id);
    return { ...h, party_code: pc?.code ?? null, deposits: await readDepositLinks(db, a.companyId, id), payments, editable: h.doc_status !== 'C' };
  });
  app.post(`${base}/posting-preview`, async (req) => { const a = requireCompany(req); const { id } = parse(previewQuery, req.query); return previewSave(db, a.companyId, (tx) => saveRefund(tx, a, id ?? null, parse(body, req.body))); });
  app.post(base, async (req) => saveRefund(db, requireCompany(req), null, parse(body, req.body)));
  app.put(`${base}/:id`, async (req) => saveRefund(db, requireCompany(req), parse(z.object({ id: uuid }), req.params).id, parse(body, req.body)));
  app.post(`${base}/:id/cancel`, async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const { reason } = parse(z.object({ reason: z.string().trim().min(1, 'ป้อนเหตุผลที่ยกเลิก').max(200) }), req.body);
    const h = await db.selectFrom('doc_header').select(['id', 'doc_no']).where('id', '=', id).where('company_id', '=', a.companyId).where('doc_class', '=', K.cls).where('deleted_at', 'is', null).executeTakeFirst();
    if (!h) throw notFound(K.label);
    // ยกเลิก = สถานะ C: ยอดมัดจำกลับเป็นคงเหลือ (view ไม่นับใบที่ยกเลิก) · เช็คจ่ายออกจากทะเบียน
    return cancelDocument(db, a, id, reason, async (tx) => { await releaseCheques(tx, a, id, h.doc_no); });
  });
}
