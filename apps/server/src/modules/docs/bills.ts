import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { BILL_KINDS, d, type BillKind } from '@buddy/core';
import type { Db } from '../../db.js';
import { badRequest, notFound, parse, requireCompany, type AuthContext } from '../../http.js';
import { logActivity } from '../../audit.js';
import { cancelDocument, docNoFor, docNoInput } from './engine.js';
import { branchOf } from './payments.js';

type Ctx = AuthContext & { companyId: string };
const uuid = z.string().uuid();
const optId = uuid.nullable().optional().transform((v) => v ?? null);
const str = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ไม่ถูกต้อง');

const body = z.object({
  doc_type_id: uuid, doc_no: docNoInput, doc_date: isoDate, party_id: z.string({ required_error: 'เลือกลูกค้า/ผู้จำหน่าย', invalid_type_error: 'เลือกลูกค้า/ผู้จำหน่าย' }).uuid('เลือกลูกค้า/ผู้จำหน่าย'),
  /** วันที่ไปวางบิล (อาจคนละวันกับวันที่เอกสาร) */
  visit_date: isoDate.nullable().optional(),
  appointment_date: isoDate.nullable().optional(), payment_terms: str(60), remark: str(2000), department_id: optId, salesperson_id: optId,
  items: z.array(z.object({ invoice_header_id: uuid })).min(1, 'เลือกบิลอย่างน้อย 1 ใบ (F5 เลือกบิลค้าง)').max(500),
});
type Body = z.infer<typeof body>;

/** บิลค้างที่ยังไม่อยู่ในใบวางบิลอื่น (bill_id = ใบที่กำลังแก้) */
async function billable(db: Db, companyId: string, K: BillKind, partyId: string, billId: string | null, only?: string[]) {
  const view = K.module === 'AR' ? 'v_ar_outstanding' : 'v_ap_outstanding';
  const partyCol = K.party === 'customer' ? 'customer_id' : 'supplier_id';
  return (await sql<{ header_id: string; doc_class: string; doc_no: string; doc_date: string; due_date: string | null; ref_no: string | null; amount: string; settled: string; outstanding: string; department_id: string | null }>`
    SELECT o.header_id, o.doc_class, o.doc_no, o.doc_date, o.due_date, h.ref_no, o.amount, o.settled, o.outstanding, h.department_id
      FROM ${sql.table(view)} o JOIN doc_header h ON h.id = o.header_id
     WHERE o.company_id = ${companyId} AND o.${sql.ref(partyCol)} = ${partyId} AND o.doc_class = ANY(${K.open}::text[])
       AND ${only ? sql`o.header_id = ANY(${only}::uuid[])` : sql`o.outstanding <> 0`}
       AND NOT EXISTS (SELECT 1 FROM doc_bill_item bi JOIN doc_header b ON b.id = bi.bill_header_id
                        WHERE bi.invoice_header_id = o.header_id AND bi.deleted_at IS NULL AND b.doc_status <> 'C' AND b.deleted_at IS NULL AND b.id IS DISTINCT FROM ${billId})
     ORDER BY o.due_date NULLS LAST, o.doc_date, o.doc_no`.execute(db)).rows;
}

async function saveBill(db: Db, a: Ctx, K: BillKind, id: string | null, b: Body) {
  const dt = await db.selectFrom('md_doc_type').select(['id', 'doc_class', 'department_id', 'status']).where('id', '=', b.doc_type_id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
  if (!dt || dt.doc_class !== K.cls) throw badRequest(`เลือกประเภทเอกสารของ${K.label}`);
  if (!id && dt.status !== 'A') throw badRequest('ประเภทเอกสารนี้เลิกใช้แล้ว');
  const partyTbl = K.party === 'customer' ? 'md_customer' : 'md_supplier';
  const party = await db.selectFrom(partyTbl).select(['id', 'code', 'title', 'name', 'address_1', 'address_2', 'address_3', 'zip_code', 'tax_id', 'tax_branch_no', 'payment_terms']).where('id', '=', b.party_id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
  if (!party) throw badRequest(`ไม่พบ${K.party === 'customer' ? 'ลูกค้า' : 'ผู้จำหน่าย'}นี้`);
  const ids = b.items.map((x) => x.invoice_header_id);
  if (new Set(ids).size !== ids.length) throw badRequest('เลือกบิลซ้ำ');
  const open = new Map((await billable(db, a.companyId, K, party.id, id, ids)).map((o) => [o.header_id, o]));
  b.items.forEach((x, i) => { if (!open.has(x.invoice_header_id)) throw badRequest(`บรรทัดที่ ${i + 1}: บิลนี้ไม่ใช่บิลค้างของ${party.code} หรืออยู่ในใบวางบิลอื่นแล้ว`); });
  // ยอดในใบวางบิล = ยอดค้าง ณ วันที่ทำใบ (ใบลดหนี้เป็นยอดลบ)
  const items = b.items.map((x) => open.get(x.invoice_header_id)!);
  const total = items.reduce((s, o) => s.plus(d(o.outstanding)), d(0));
  const header = {
    doc_type_id: dt.id, doc_class: K.cls, module: K.module, doc_date: b.doc_date, ref_date: b.visit_date ?? null, appointment_date: b.appointment_date ?? null,
    customer_id: K.party === 'customer' ? party.id : null, supplier_id: K.party === 'supplier' ? party.id : null,
    party_name: [party.title, party.name].filter(Boolean).join(' ').slice(0, 200), party_address: [party.address_1, party.address_2, party.address_3, party.zip_code].filter(Boolean).join(' ').slice(0, 500) || null,
    party_tax_id: party.tax_id, party_tax_branch_no: party.tax_branch_no, payment_terms: b.payment_terms ?? party.payment_terms, remark: b.remark,
    department_id: b.department_id ?? dt.department_id, salesperson_id: b.salesperson_id, amount: total.toFixed(2), net_amount: total.toFixed(2), updated_by: a.userId,
  };
  return db.transaction().execute(async (tx) => {
    let hid = id, docNo: string;
    if (id) {
      const cur = await tx.selectFrom('doc_header').select(['doc_no', 'doc_status', 'doc_class']).where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
      if (!cur || cur.doc_class !== K.cls) throw notFound(K.label);
      if (cur.doc_status === 'C') throw badRequest('เอกสารนี้ถูกยกเลิกแล้ว แก้ไขไม่ได้');
      docNo = cur.doc_no;
      await tx.updateTable('doc_header').set(header).where('id', '=', id).execute();
      await tx.updateTable('doc_bill_item').set({ deleted_at: sql`now()` as never }).where('bill_header_id', '=', id).where('deleted_at', 'is', null).execute();
    } else {
      docNo = await docNoFor(tx, a.companyId, dt.id, b.doc_no);
      hid = (await tx.insertInto('doc_header').values({ ...header, company_id: a.companyId, branch_id: await branchOf(tx, a), doc_no: docNo, doc_status: 'N', created_by: a.userId }).returning('id').executeTakeFirstOrThrow()).id;
    }
    await tx.insertInto('doc_bill_item').values(items.map((o) => ({ company_id: a.companyId, bill_header_id: hid!, invoice_header_id: o.header_id, amount: d(o.outstanding).toFixed(2), created_by: a.userId }))).execute();
    await logActivity(tx, a, { module: K.module, action: id ? 'EDIT' : 'ADD', docNo, table: 'doc_header', rowId: hid });
    return { id: hid, doc_no: docNo, net_amount: total.toFixed(2) };
  });
}

export function billRoutes(app: FastifyInstance, db: Db) {
  for (const K of BILL_KINDS) {
    const base = `/api/v1/${K.path}`;
    const partyCol = K.party === 'customer' ? 'customer_id' : 'supplier_id';
    const partyTbl = K.party === 'customer' ? 'md_customer' : 'md_supplier';
    app.get(base, async (req) => {
      const a = requireCompany(req);
      const q = parse(z.object({ q: z.string().optional(), from: isoDate.optional(), to: isoDate.optional(), status: z.enum(['N', 'C', 'all']).default('all'), type_id: uuid.optional(), order: z.enum(['date', 'appointment']).default('date'),
        limit: z.coerce.number().int().min(1).max(1000).default(200) }), req.query);
      const like = q.q?.trim() ? `%${q.q.trim()}%` : null;
      const where = sql.join([
        sql`h.company_id = ${a.companyId}`, sql`h.doc_class = ${K.cls}`, sql`h.deleted_at IS NULL`,
        ...(q.from ? [sql`h.doc_date >= ${q.from}`] : []), ...(q.to ? [sql`h.doc_date <= ${q.to}`] : []), ...(q.status !== 'all' ? [sql`h.doc_status = ${q.status}`] : []), ...(q.type_id ? [sql`h.doc_type_id = ${q.type_id}`] : []),
        ...(like ? [sql`(h.doc_no ILIKE ${like} OR h.party_name ILIKE ${like} OR p.code ILIKE ${like})`] : []),
      ], sql` AND `);
      const from = sql`FROM doc_header h LEFT JOIN ${sql.table(partyTbl)} p ON p.id = h.${sql.ref(partyCol)} WHERE ${where}`;
      const total = (await sql<{ n: number }>`SELECT count(*) AS n ${from}`.execute(db)).rows[0]!.n;
      const rows = (await sql`SELECT h.id, h.doc_no, h.doc_date, h.ref_date AS visit_date, h.appointment_date, h.party_name, p.code AS party_code, h.net_amount, h.doc_status,
          (SELECT count(*) FROM doc_bill_item bi WHERE bi.bill_header_id = h.id AND bi.deleted_at IS NULL)::int AS bills ${from}
          ORDER BY ${q.order === 'appointment' ? sql`h.appointment_date NULLS LAST, h.doc_no` : sql`h.doc_date DESC, h.doc_no DESC`} LIMIT ${q.limit}`.execute(db)).rows;
      return { total: Number(total), rows };
    });
    app.get(`${base}/open-items`, async (req) => {
      const a = requireCompany(req);
      const q = parse(z.object({ party_id: uuid, bill_id: uuid.optional() }), req.query);
      const p = await db.selectFrom(partyTbl).select('id').where('id', '=', q.party_id).where('company_id', '=', a.companyId).executeTakeFirst();
      if (!p) throw notFound(K.party === 'customer' ? 'ลูกค้า' : 'ผู้จำหน่าย');
      return { rows: await billable(db, a.companyId, K, p.id, q.bill_id ?? null) };
    });
    app.get(`${base}/:id`, async (req) => {
      const a = requireCompany(req);
      const { id } = parse(z.object({ id: uuid }), req.params);
      const h = await db.selectFrom('doc_header').selectAll().where('id', '=', id).where('company_id', '=', a.companyId).where('doc_class', '=', K.cls).where('deleted_at', 'is', null).executeTakeFirst();
      if (!h) throw notFound(K.label);
      const view = K.module === 'AR' ? 'v_ar_outstanding' : 'v_ap_outstanding';
      const items = (await sql`SELECT bi.invoice_header_id, i.doc_class, i.doc_no, i.doc_date, i.due_date, i.ref_no, bi.amount, o.outstanding
          FROM doc_bill_item bi JOIN doc_header i ON i.id = bi.invoice_header_id LEFT JOIN ${sql.table(view)} o ON o.header_id = bi.invoice_header_id
         WHERE bi.bill_header_id = ${id} AND bi.deleted_at IS NULL ORDER BY i.due_date NULLS LAST, i.doc_date, i.doc_no`.execute(db)).rows;
      const pc = await db.selectFrom(partyTbl).select('code').where('id', '=', (h.customer_id ?? h.supplier_id)!).executeTakeFirst();
      return { ...h, visit_date: h.ref_date, party_code: pc?.code ?? null, items, editable: h.doc_status !== 'C' };
    });
    app.post(base, async (req) => saveBill(db, requireCompany(req), K, null, parse(body, req.body)));
    app.put(`${base}/:id`, async (req) => saveBill(db, requireCompany(req), K, parse(z.object({ id: uuid }), req.params).id, parse(body, req.body)));
    /** S-BI-02 บันทึกวันนัดรับ/จ่ายเงิน (ไม่ต้องเปิดแก้ทั้งใบ) */
    app.post(`${base}/:id/appointment`, async (req) => {
      const a = requireCompany(req);
      const { id } = parse(z.object({ id: uuid }), req.params);
      const { date } = parse(z.object({ date: isoDate.nullable() }), req.body);
      const h = await db.selectFrom('doc_header').select(['doc_no', 'doc_status']).where('id', '=', id).where('company_id', '=', a.companyId).where('doc_class', '=', K.cls).where('deleted_at', 'is', null).executeTakeFirst();
      if (!h) throw notFound(K.label);
      if (h.doc_status === 'C') throw badRequest('เอกสารนี้ถูกยกเลิกแล้ว');
      await db.transaction().execute(async (tx) => {
        await tx.updateTable('doc_header').set({ appointment_date: date, updated_by: a.userId }).where('id', '=', id).execute();
        await logActivity(tx, a, { module: K.module, action: 'EDIT', docNo: h.doc_no, table: 'doc_header', rowId: id, detail: { appointment_date: date } });
      });
      return { ok: true };
    });
    app.post(`${base}/:id/cancel`, async (req) => {
      const a = requireCompany(req);
      const { id } = parse(z.object({ id: uuid }), req.params);
      const { reason } = parse(z.object({ reason: z.string().trim().min(1, 'ป้อนเหตุผลที่ยกเลิก').max(200) }), req.body);
      const h = await db.selectFrom('doc_header').select('id').where('id', '=', id).where('company_id', '=', a.companyId).where('doc_class', '=', K.cls).where('deleted_at', 'is', null).executeTakeFirst();
      if (!h) throw notFound(K.label);
      return cancelDocument(db, a, id, reason);
    });
  }
}
