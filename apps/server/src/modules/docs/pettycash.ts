import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { d, settlementTotals } from '@buddy/core';
import type { Db } from '../../db.js';
import { badRequest, notFound, parse, requireCompany, type AuthContext } from '../../http.js';
import { logActivity } from '../../audit.js';
import { periodFor } from '../gl/journals.js';
import { cancelDocument, postDocument, unpostDocument, docNoFor, docNoInput } from './engine.js';
import { branchOf, clearMoneyParts, loadMethods, num, paymentsSchema, readMoneyParts, releaseCheques, writePayments } from './payments.js';

/**
 * เงินสดย่อย (คู่มือบทที่ 15): DP บันทึกการจ่ายจากเงินสดย่อย (ไม่ลงบัญชี) → VR เบิกชดเชย (รวม DP แล้วลงบัญชี Dr ค่าใช้จ่าย / Cr เงินสด-เช็ค)
 * การตั้งวงเงิน = DP ที่บรรทัดเป็นบัญชีเงินสดย่อย แล้วเบิกด้วย VR (Dr เงินสดย่อย / Cr ธนาคาร)
 * DP ที่ย้ายจาก Express มี ref_no = เลขที่ VR ที่เบิกแล้ว
 */
type Ctx = AuthContext & { companyId: string };
const uuid = z.string().uuid();
const optId = uuid.nullable().optional().transform((v) => v ?? null);
const str = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ไม่ถูกต้อง');

const dpBody = z.object({
  doc_type_id: uuid, doc_no: docNoInput, doc_date: isoDate, remark: str(2000),
  lines: z.array(z.object({ account_id: uuid, department_id: optId, description: str(200), amount: num })).min(1, 'ป้อนรายการที่จ่ายอย่างน้อย 1 บรรทัด').max(200),
});
const vrBody = z.object({
  doc_type_id: uuid, doc_no: docNoInput, doc_date: isoDate, remark: str(2000),
  dp_ids: z.array(uuid).min(1, 'เลือกใบจ่ายเงินสดย่อยที่จะเบิกชดเชยอย่างน้อย 1 ใบ').max(500),
  cash_amount: num.nullable().optional(), payments: paymentsSchema,
});

/** VR ที่เบิก DP ใบนี้แล้ว (ไม่นับ VR ที่ยกเลิก) · ข้อมูลที่ย้ายมาใช้ ref_no */
const reimbursedBy = (dpAlias: string) => sql`coalesce((SELECT v.doc_no FROM doc_link l JOIN doc_header v ON v.id = l.to_header_id
    WHERE l.from_header_id = ${sql.ref(dpAlias + '.id')} AND l.link_type = 'REIMBURSE' AND l.deleted_at IS NULL AND v.doc_status <> 'C' AND v.deleted_at IS NULL LIMIT 1), ${sql.ref(dpAlias + '.ref_no')})`;

async function docType(db: Db, a: Ctx, id: string, cls: string, isNew: boolean) {
  const dt = await db.selectFrom('md_doc_type').select(['id', 'doc_class', 'department_id', 'status']).where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
  if (!dt || dt.doc_class !== cls) throw badRequest(cls === 'DP' ? 'เลือกประเภทเอกสารของการจ่ายเงินสดย่อย' : 'เลือกประเภทเอกสารของการเบิกชดเชย');
  if (isNew && dt.status !== 'A') throw badRequest('ประเภทเอกสารนี้เลิกใช้แล้ว');
  return dt;
}

async function saveDp(db: Db, a: Ctx, id: string | null, b: z.infer<typeof dpBody>) {
  const dt = await docType(db, a, b.doc_type_id, 'DP', !id);
  const accs = await db.selectFrom('gl_account').select(['id', 'account_no', 'is_control', 'status']).where('company_id', '=', a.companyId).where('id', 'in', [...new Set(b.lines.map((l) => l.account_id))]).where('deleted_at', 'is', null).execute();
  const byId = new Map(accs.map((x) => [x.id, x]));
  b.lines.forEach((l, i) => {
    const acc = byId.get(l.account_id);
    if (!acc) throw badRequest(`บรรทัดที่ ${i + 1}: ไม่พบเลขที่บัญชี`);
    if (acc.is_control) throw badRequest(`บรรทัดที่ ${i + 1}: ${acc.account_no} เป็นบัญชีคุม ใช้บันทึกรายการไม่ได้`);
    if (d(l.amount).lte(0)) throw badRequest(`บรรทัดที่ ${i + 1}: ป้อนจำนวนเงิน`);
  });
  const total = b.lines.reduce((s, l) => s.plus(d(l.amount)), d(0)).toFixed(2);
  const header = { doc_type_id: dt.id, doc_class: 'DP', module: 'PC', doc_date: b.doc_date, remark: b.remark, department_id: dt.department_id, amount: total, net_amount: total, price_type: '0', updated_by: a.userId };
  return db.transaction().execute(async (tx) => {
    await periodFor(tx, a.companyId, b.doc_date);
    let hid = id, docNo: string;
    if (id) {
      const cur = (await sql<{ doc_no: string; doc_status: string; doc_class: string; vr: string | null }>`SELECT h.doc_no, h.doc_status, h.doc_class, ${reimbursedBy('h')} AS vr FROM doc_header h
          WHERE h.id = ${id} AND h.company_id = ${a.companyId} AND h.deleted_at IS NULL`.execute(tx)).rows[0];
      if (!cur || cur.doc_class !== 'DP') throw notFound('ใบจ่ายเงินสดย่อย');
      if (cur.doc_status === 'C') throw badRequest('เอกสารนี้ถูกยกเลิกแล้ว แก้ไขไม่ได้');
      if (cur.vr) throw badRequest(`${cur.doc_no} เบิกชดเชยแล้วใน ${cur.vr} — ยกเลิกใบเบิกชดเชยก่อน`);
      docNo = cur.doc_no;
      await tx.updateTable('doc_header').set(header).where('id', '=', id).execute();
      await tx.updateTable('doc_line').set({ deleted_at: sql`now()` as never }).where('header_id', '=', id).where('deleted_at', 'is', null).execute();
    } else {
      docNo = await docNoFor(tx, a.companyId, dt.id, b.doc_no);
      hid = (await tx.insertInto('doc_header').values({ ...header, company_id: a.companyId, branch_id: await branchOf(tx, a), doc_no: docNo, doc_status: 'N', created_by: a.userId }).returning('id').executeTakeFirstOrThrow()).id;
    }
    await tx.insertInto('doc_line').values(b.lines.map((l, i) => ({ company_id: a.companyId, header_id: hid!, line_no: i + 1, line_kind: 'G', account_id: l.account_id, department_id: l.department_id, description: l.description,
      line_amount: d(l.amount).toFixed(2), net_amount: d(l.amount).toFixed(2), stock_effect: 0, created_by: a.userId }))).execute();
    await logActivity(tx, a, { module: 'PC', action: id ? 'EDIT' : 'ADD', docNo, table: 'doc_header', rowId: hid });
    return { id: hid, doc_no: docNo, net_amount: total };
  });
}

async function saveVr(db: Db, a: Ctx, id: string | null, b: z.infer<typeof vrBody>) {
  const dt = await docType(db, a, b.doc_type_id, 'VR', !id);
  if (new Set(b.dp_ids).size !== b.dp_ids.length) throw badRequest('เลือกใบจ่ายซ้ำ');
  const dps = (await sql<{ id: string; doc_no: string; doc_status: string; vr: string | null }>`SELECT h.id, h.doc_no, h.doc_status, ${reimbursedBy('h')} AS vr FROM doc_header h
      WHERE h.company_id = ${a.companyId} AND h.doc_class = 'DP' AND h.deleted_at IS NULL AND h.id = ANY(${b.dp_ids}::uuid[])`.execute(db)).rows;
  const ownNo = id ? (await db.selectFrom('doc_header').select('doc_no').where('id', '=', id).where('company_id', '=', a.companyId).executeTakeFirst())?.doc_no : undefined;
  b.dp_ids.forEach((x, i) => {
    const dp = dps.find((p) => p.id === x);
    if (!dp || dp.doc_status === 'C') throw badRequest(`รายการที่ ${i + 1}: ไม่พบใบจ่ายเงินสดย่อย`);
    if (dp.vr && dp.vr !== ownNo) throw badRequest(`${dp.doc_no} เบิกชดเชยแล้วใน ${dp.vr}`);
  });
  // รวมรายการจ่ายตามบัญชี + แผนก (คู่มือ: ตารางบนดึงอัตโนมัติจาก DP ในช่วงที่เลือก)
  const agg = (await sql<{ account_id: string; department_id: string | null; amount: string; n: number }>`SELECT l.account_id, l.department_id, sum(l.net_amount) AS amount, count(*)::int AS n
      FROM doc_line l WHERE l.header_id = ANY(${b.dp_ids}::uuid[]) AND l.deleted_at IS NULL AND l.line_kind = 'G' GROUP BY 1, 2 ORDER BY 1, 2`.execute(db)).rows;
  const net = agg.reduce((s, x) => s.plus(d(x.amount)), d(0));
  if (net.lte(0)) throw badRequest('ใบจ่ายที่เลือกไม่มียอดเงิน');
  const methods = await loadMethods(db, a.companyId, 'P', b.payments);
  const t = settlementTotals({ settlements: [net.toFixed(2)], payments: b.payments.map((p) => p.amount), cash: b.cash_amount });
  if (d(t.cash).lt(0)) throw badRequest(`จ่ายด้วยวิธีอื่นรวม ${t.other} มากกว่ายอดเบิกชดเชย ${t.due}`);
  if (!t.ok) throw badRequest(`ยอดเบิกชดเชย ${t.due} ไม่เท่ากับยอดจ่ายจริง ${t.paid} — ล้างช่องเงินสดให้คำนวณเอง`);
  const header = { doc_type_id: dt.id, doc_class: 'VR', module: 'PC', doc_date: b.doc_date, payment_date: b.doc_date, remark: b.remark, department_id: dt.department_id, price_type: '0',
    amount: net.toFixed(2), net_amount: net.toFixed(2), cash_amount: t.cash, cheque_amount: t.other, updated_by: a.userId };
  return db.transaction().execute(async (tx) => {
    await periodFor(tx, a.companyId, b.doc_date);
    let hid = id, docNo: string;
    if (id) {
      const cur = await tx.selectFrom('doc_header').select(['doc_no', 'doc_status', 'doc_class', 'doc_date']).where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
      if (!cur || cur.doc_class !== 'VR') throw notFound('ใบเบิกชดเชย');
      if (cur.doc_status === 'C') throw badRequest('เอกสารนี้ถูกยกเลิกแล้ว แก้ไขไม่ได้');
      await periodFor(tx, a.companyId, String(cur.doc_date).slice(0, 10));
      await releaseCheques(tx, a, id, cur.doc_no);
      docNo = cur.doc_no;
      await tx.updateTable('doc_header').set(header).where('id', '=', id).execute();
      await clearMoneyParts(tx, id);
      await tx.updateTable('doc_line').set({ deleted_at: sql`now()` as never }).where('header_id', '=', id).where('deleted_at', 'is', null).execute();
      await tx.updateTable('doc_link').set({ deleted_at: sql`now()` as never }).where('to_header_id', '=', id).where('link_type', '=', 'REIMBURSE').where('deleted_at', 'is', null).execute();
    } else {
      docNo = await docNoFor(tx, a.companyId, dt.id, b.doc_no);
      hid = (await tx.insertInto('doc_header').values({ ...header, company_id: a.companyId, branch_id: await branchOf(tx, a), doc_no: docNo, doc_status: 'N', created_by: a.userId }).returning('id').executeTakeFirstOrThrow()).id;
    }
    await tx.insertInto('doc_line').values(agg.map((x, i) => ({ company_id: a.companyId, header_id: hid!, line_no: i + 1, line_kind: 'G', account_id: x.account_id, department_id: x.department_id,
      description: `เบิกชดเชย ${x.n} รายการ`, line_amount: d(x.amount).toFixed(2), net_amount: d(x.amount).toFixed(2), stock_effect: 0, created_by: a.userId }))).execute();
    await tx.insertInto('doc_link').values(b.dp_ids.map((x) => ({ company_id: a.companyId, from_header_id: x, to_header_id: hid!, link_type: 'REIMBURSE', created_by: a.userId }))).execute();
    await writePayments(tx, a, { headerId: hid!, direction: 'P', payDate: b.doc_date, methods, payments: b.payments, customerId: null, supplierId: null, partyName: b.remark ?? 'เบิกชดเชยเงินสดย่อย', departmentId: header.department_id });
    const curJ = id ? await tx.selectFrom('gl_journal').select('id').where('source_header_id', '=', id).where('doc_status', '=', 'N').where('deleted_at', 'is', null).executeTakeFirst() : undefined;
    const posted = await postDocument(tx, a, hid!, curJ?.id);
    if (!posted.journal_id && curJ) await unpostDocument(tx, a, hid!);
    await logActivity(tx, a, { module: 'PC', action: id ? 'EDIT' : 'ADD', docNo, table: 'doc_header', rowId: hid });
    return { id: hid, doc_no: docNo, journal_id: posted.journal_id, net_amount: net.toFixed(2), cash_amount: t.cash };
  });
}

export function pettyCashRoutes(app: FastifyInstance, db: Db) {
  const listQ = z.object({ q: z.string().optional(), from: isoDate.optional(), to: isoDate.optional(), status: z.enum(['N', 'C', 'all']).default('all'), type_id: uuid.optional(), open: z.coerce.boolean().optional(), vr_id: uuid.optional(),
    limit: z.coerce.number().int().min(1).max(1000).default(300) });
  const where = (companyId: string, cls: string, q: z.infer<typeof listQ>) => {
    const like = q.q?.trim() ? `%${q.q.trim()}%` : null;
    return sql.join([sql`h.company_id = ${companyId}`, sql`h.doc_class = ${cls}`, sql`h.deleted_at IS NULL`,
      ...(q.from ? [sql`h.doc_date >= ${q.from}`] : []), ...(q.to ? [sql`h.doc_date <= ${q.to}`] : []), ...(q.status !== 'all' ? [sql`h.doc_status = ${q.status}`] : []), ...(q.type_id ? [sql`h.doc_type_id = ${q.type_id}`] : []),
      ...(like ? [sql`(h.doc_no ILIKE ${like} OR h.remark ILIKE ${like})`] : [])], sql` AND `);
  };
  /** DP · open=true → ยังไม่เบิกชดเชย (vr_id = ใบเบิกที่กำลังแก้ ให้ DP ของใบนั้นเลือกได้) */
  app.get('/api/v1/petty-payments', async (req) => {
    const a = requireCompany(req);
    const q = parse(listQ, req.query);
    const own = q.vr_id ? sql`EXISTS (SELECT 1 FROM doc_link l WHERE l.from_header_id = h.id AND l.to_header_id = ${q.vr_id} AND l.link_type = 'REIMBURSE' AND l.deleted_at IS NULL)` : sql`false`;
    const rows = (await sql`SELECT * FROM (SELECT h.id, h.doc_no, h.doc_date, h.remark, h.net_amount, h.doc_status, ${reimbursedBy('h')} AS vr_no, ${own} AS own,
        (SELECT count(*) FROM doc_line l WHERE l.header_id = h.id AND l.deleted_at IS NULL)::int AS lines
        FROM doc_header h WHERE ${where(a.companyId, 'DP', q)}) x ${q.open ? sql`WHERE x.doc_status <> 'C' AND (x.vr_no IS NULL OR x.own)` : sql``}
        ORDER BY x.doc_date DESC, x.doc_no DESC LIMIT ${q.limit}`.execute(db)).rows;
    return { rows };
  });
  app.get('/api/v1/petty-payments/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const h = (await sql<Record<string, unknown> & { doc_status: string; vr_no: string | null }>`SELECT h.*, ${reimbursedBy('h')} AS vr_no FROM doc_header h WHERE h.id = ${id} AND h.company_id = ${a.companyId} AND h.doc_class = 'DP' AND h.deleted_at IS NULL`.execute(db)).rows[0];
    if (!h) throw notFound('ใบจ่ายเงินสดย่อย');
    const lines = await db.selectFrom('doc_line as l').leftJoin('gl_account as g', 'g.id', 'l.account_id').select(['l.line_no', 'l.account_id', 'g.account_no', 'g.name_th as account_name', 'l.department_id', 'l.description', 'l.net_amount as amount'])
      .where('l.header_id', '=', id).where('l.deleted_at', 'is', null).orderBy('l.line_no').execute();
    return { ...h, lines, editable: h.doc_status !== 'C' && !h.vr_no };
  });
  app.post('/api/v1/petty-payments', async (req) => saveDp(db, requireCompany(req), null, parse(dpBody, req.body)));
  app.put('/api/v1/petty-payments/:id', async (req) => saveDp(db, requireCompany(req), parse(z.object({ id: uuid }), req.params).id, parse(dpBody, req.body)));
  app.post('/api/v1/petty-payments/:id/cancel', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const { reason } = parse(z.object({ reason: z.string().trim().min(1, 'ป้อนเหตุผลที่ยกเลิก').max(200) }), req.body);
    const h = (await sql<{ doc_no: string; vr: string | null }>`SELECT h.doc_no, ${reimbursedBy('h')} AS vr FROM doc_header h WHERE h.id = ${id} AND h.company_id = ${a.companyId} AND h.doc_class = 'DP' AND h.deleted_at IS NULL`.execute(db)).rows[0];
    if (!h) throw notFound('ใบจ่ายเงินสดย่อย');
    if (h.vr) throw badRequest(`${h.doc_no} เบิกชดเชยแล้วใน ${h.vr} — ยกเลิกใบเบิกชดเชยก่อน`);
    // รายการภาษีซื้อ/ภาษีหัก ณ ที่จ่ายที่ป้อนจากใบนี้ยกเลิกตาม
    return cancelDocument(db, a, id, reason, async (tx) => {
      await tx.updateTable('tax_vat_entry').set({ doc_status: 'C', updated_by: a.userId }).where('company_id', '=', a.companyId).where('header_id', '=', id).where('deleted_at', 'is', null).execute();
      await tx.updateTable('tax_wht_entry').set({ doc_status: 'C', updated_by: a.userId }).where('company_id', '=', a.companyId).where('header_id', '=', id).where('deleted_at', 'is', null).execute();
    });
  });

  app.get('/api/v1/petty-reimbursements', async (req) => {
    const a = requireCompany(req);
    const q = parse(listQ, req.query);
    const rows = (await sql`SELECT h.id, h.doc_no, h.doc_date, h.remark, h.net_amount, h.cash_amount, h.cheque_amount, h.doc_status,
        (SELECT count(*) FROM doc_link l WHERE l.to_header_id = h.id AND l.link_type = 'REIMBURSE' AND l.deleted_at IS NULL)::int AS dps
        FROM doc_header h WHERE ${where(a.companyId, 'VR', q)} ORDER BY h.doc_date DESC, h.doc_no DESC LIMIT ${q.limit}`.execute(db)).rows;
    return { rows };
  });
  app.get('/api/v1/petty-reimbursements/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const h = await db.selectFrom('doc_header').selectAll().where('id', '=', id).where('company_id', '=', a.companyId).where('doc_class', '=', 'VR').where('deleted_at', 'is', null).executeTakeFirst();
    if (!h) throw notFound('ใบเบิกชดเชย');
    const lines = await db.selectFrom('doc_line as l').leftJoin('gl_account as g', 'g.id', 'l.account_id').select(['l.line_no', 'l.account_id', 'g.account_no', 'g.name_th as account_name', 'l.department_id', 'l.description', 'l.net_amount as amount'])
      .where('l.header_id', '=', id).where('l.deleted_at', 'is', null).orderBy('l.line_no').execute();
    // DP ที่เบิก: ลิงก์ (ใหม่) หรือ ref_no = เลขที่ใบนี้ (ข้อมูลที่ย้ายมา)
    const dps = (await sql`SELECT p.id, p.doc_no, p.doc_date, p.remark, p.net_amount FROM doc_header p
        WHERE p.company_id = ${a.companyId} AND p.doc_class = 'DP' AND p.deleted_at IS NULL
          AND (EXISTS (SELECT 1 FROM doc_link l WHERE l.from_header_id = p.id AND l.to_header_id = ${id} AND l.link_type = 'REIMBURSE' AND l.deleted_at IS NULL) OR p.ref_no = ${h.doc_no})
        ORDER BY p.doc_date, p.doc_no`.execute(db)).rows;
    const { payments } = await readMoneyParts(db, a.companyId, id);
    return { ...h, lines, dps, payments, editable: h.doc_status !== 'C' };
  });
  app.post('/api/v1/petty-reimbursements', async (req) => saveVr(db, requireCompany(req), null, parse(vrBody, req.body)));
  app.put('/api/v1/petty-reimbursements/:id', async (req) => saveVr(db, requireCompany(req), parse(z.object({ id: uuid }), req.params).id, parse(vrBody, req.body)));
  app.post('/api/v1/petty-reimbursements/:id/cancel', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const { reason } = parse(z.object({ reason: z.string().trim().min(1, 'ป้อนเหตุผลที่ยกเลิก').max(200) }), req.body);
    const h = await db.selectFrom('doc_header').select(['id', 'doc_no']).where('id', '=', id).where('company_id', '=', a.companyId).where('doc_class', '=', 'VR').where('deleted_at', 'is', null).executeTakeFirst();
    if (!h) throw notFound('ใบเบิกชดเชย');
    // ยกเลิก = สถานะ C: ใบจ่ายที่เบิกกลับมาเบิกใหม่ได้ (ลิงก์ไปใบที่ยกเลิกไม่นับ) · เช็คออกจากทะเบียน
    return cancelDocument(db, a, id, reason, async (tx) => { await releaseCheques(tx, a, id, h.doc_no); });
  });
}
