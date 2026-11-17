/**
 * ต้นทุนตาม Job / โครงการ (เจ้าของ 17/11/2569 · HANDOFF 129)
 * - แฟ้ม Job: รหัส ชื่อ ลูกค้า เลขที่สัญญา ผู้รับผิดชอบ วันเริ่ม/สิ้นสุด สถานะ (A กำลังทำ / I ปิดแล้ว) มูลค่าสัญญา หมายเหตุ + งบประมาณรายบัญชี
 * - เจ้าของเลือก: 1ข ไม่บังคับใส่ Job (ผังบัญชีใช้ร่วมกันทุก Job) · 2ก Job ที่ปิดแล้วห้ามใช้ในเอกสารใหม่ ใบเก่าคงเดิม
 *   3ก ขาย/รายได้ใส่ Job ได้ (กำไรต่อ Job) · 4ก งบรายบัญชีต้นทุน · 5ก ซื้อเข้าคลังที่ใส่ Job = ต้นทุนตอนเบิกใช้ (OU)
 * - รายงานคำนวณสดจากบรรทัดใบสำคัญที่มี Job (กติกาข้อ 8): หมวด 4 = รายได้ · หมวด 5 = ต้นทุน/ค่าใช้จ่าย
 *   หมวด 1–3 ที่มี Job (เช่น ซื้อสินค้าเข้าคลังโดยใส่ Job) แสดงแยก "ซื้อเข้าคลังสำหรับ Job — ยังไม่เป็นต้นทุนจนกว่าจะเบิก" ไม่นับซ้ำ
 */
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { d, ZERO, type Decimal } from '@buddy/core';
import type { Db } from '../db.js';
import { badRequest, notFound, parse, requireCompany } from '../http.js';
import { checkOwned } from '../owned.js';
import { logActivity } from '../audit.js';
import { companySettings, setSetting } from '../company-template.js';

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ไม่ถูกต้อง');
const opt = (n: number) => z.string().trim().max(n).nullable().optional().transform((v) => v || null);
const money = z.union([z.string(), z.number()]).nullable().optional().transform((v, ctx) => {
  if (v === null || v === undefined || v === '') return null;
  try { return d(v).toFixed(2); } catch { ctx.addIssue({ code: 'custom', message: 'จำนวนเงินไม่ถูกต้อง' }); return z.NEVER; }
});

/** Job ที่ใช้ในเอกสาร: ต้องเป็นของบริษัทนี้ · ปิดแล้ว (I) ใช้ได้เฉพาะที่เอกสารนี้มีอยู่เดิม (keep) — เจ้าของ 17/11/2569 ข้อ 2ก */
export async function checkJobs(db: Db, companyId: string, refs: Array<{ id: string | null | undefined; line?: number }>, keep: Set<string> = new Set()) {
  const want = refs.filter((r): r is { id: string; line?: number } => !!r.id);
  if (!want.length) return;
  await checkOwned(db, companyId, want.map((r) => ({ table: 'md_project', id: r.id, field: 'project_id', ...(r.line ? { line: r.line } : {}), label: 'Job/โครงการ' })));
  const closed = new Map((await db.selectFrom('md_project').select(['id', 'code']).where('company_id', '=', companyId).where('status', '=', 'I')
    .where('id', 'in', [...new Set(want.map((r) => r.id))]).execute()).map((x) => [x.id, x.code]));
  const bad = want.find((r) => closed.has(r.id) && !keep.has(r.id));
  if (!bad) return;
  const code = closed.get(bad.id)!;
  const msg = `${bad.line ? `บรรทัดที่ ${bad.line}: ` : ''}Job ${code} ปิดแล้ว ใช้ในเอกสารใหม่ไม่ได้ — เลือก Job ที่กำลังทำ หรือเปิด Job ใหม่ที่ บัญชี › Job/โครงการ`;
  throw badRequest(msg, [{ field: 'project_id', ...(bad.line ? { line: bad.line } : {}), message: 'เลือก Job ที่กำลังทำ' }]);
}

/** Job ที่เอกสาร/ใบสำคัญมีอยู่เดิม (ใช้ตอนแก้ — Job ที่ปิดภายหลังยังคงไว้ได้) */
export async function jobsOfDoc(db: Db, companyId: string, headerId: string | null | undefined) {
  if (!headerId) return new Set<string>();
  const r = await sql<{ id: string }>`SELECT project_id AS id FROM doc_line WHERE company_id = ${companyId} AND header_id = ${headerId} AND project_id IS NOT NULL
    UNION SELECT project_id FROM doc_header WHERE company_id = ${companyId} AND id = ${headerId} AND project_id IS NOT NULL`.execute(db);
  return new Set(r.rows.map((x) => x.id));
}
export async function jobsOfJournal(db: Db, companyId: string, journalId: string | null | undefined) {
  if (!journalId) return new Set<string>();
  const r = await db.selectFrom('gl_journal_line').select('project_id').where('company_id', '=', companyId).where('journal_id', '=', journalId).where('project_id', 'is not', null).execute();
  return new Set(r.map((x) => x.project_id!));
}

const jobBody = z.object({
  code: z.string().trim().min(1, 'ป้อนรหัส Job').max(10, 'รหัส Job ไม่เกิน 10 ตัวอักษร'), name_th: z.string().trim().min(1, 'ป้อนชื่อ Job/โครงการ').max(120), name_en: opt(120),
  customer_id: uuid.nullable().optional(), ref_no: opt(30), manager: opt(60), start_date: isoDate.nullable().optional(), end_date: isoDate.nullable().optional(),
  status: z.enum(['A', 'I']).default('A'), contract_amount: money, note: opt(2000),
  budgets: z.array(z.object({ account_id: uuid, amount: money })).max(500).default([]),
});

type Row = { project_id: string; account_id: string; account_no: string; name_th: string; name_en: string | null; account_group: string; dr: string; cr: string };
/** ยอดจากใบสำคัญที่มี Job (ยังไม่ยกเลิก) รายบัญชี · ช่วงวันที่ว่าง = ตั้งแต่เริ่ม Job (สะสม) */
async function actuals(db: Db, companyId: string, q: { from?: string; to?: string; project_id?: string; branch_id?: string }) {
  return (await sql<Row>`
    SELECT l.project_id, l.account_id, g.account_no, g.name_th, g.name_en, g.account_group, sum(l.debit) AS dr, sum(l.credit) AS cr
      FROM gl_journal_line l JOIN gl_journal j ON j.id = l.journal_id JOIN gl_account g ON g.id = l.account_id
     WHERE j.company_id = ${companyId} AND j.doc_status = 'N' AND j.deleted_at IS NULL AND l.deleted_at IS NULL AND l.project_id IS NOT NULL
       AND (${q.project_id ?? null}::uuid IS NULL OR l.project_id = ${q.project_id ?? null}::uuid)
       AND (${q.from ?? null}::date IS NULL OR j.voucher_date >= ${q.from ?? null}::date) AND (${q.to ?? null}::date IS NULL OR j.voucher_date <= ${q.to ?? null}::date)
       AND (${q.branch_id ?? null}::uuid IS NULL OR coalesce(j.branch_id, (SELECT hb.id FROM sys_branch hb WHERE hb.company_id = ${companyId} AND hb.is_head_office AND hb.deleted_at IS NULL ORDER BY hb.code LIMIT 1)) = ${q.branch_id ?? null}::uuid)
     GROUP BY l.project_id, l.account_id, g.account_no, g.name_th, g.name_en, g.account_group`.execute(db)).rows;
}
/** หมวด 4 รายได้ (เครดิต − เดบิต) · หมวด 5 ต้นทุน (เดบิต − เครดิต) · อื่น = ซื้อเข้าคลัง/รายการงบดุลที่ระบุ Job (เดบิต − เครดิต) */
const kindOf = (g: string) => (g === '4' ? 'revenue' : g === '5' ? 'cost' : 'other');
const amountOf = (r: Row) => (r.account_group === '4' ? d(r.cr).minus(d(r.dr)) : d(r.dr).minus(d(r.cr)));
const pct = (a: Decimal, b: Decimal) => (b.isZero() ? null : a.div(b).times(100).toDecimalPlaces(2).toFixed(2));

export function projectRoutes(app: FastifyInstance, db: Db) {
  /** ตัวเลือก Job ในเอกสาร — enabled = บริษัทเปิดใช้ Job (เปิดให้อัตโนมัติเมื่อเพิ่ม Job แรก) */
  app.get('/api/v1/projects/options', async (req) => {
    const a = requireCompany(req);
    const s = await companySettings(db, a.companyId);
    const rows = await db.selectFrom('md_project').select(['id', 'code', 'name_th', 'name_en', 'status']).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).orderBy('code').execute();
    return { enabled: s['gen.use_project'] === true, rows };
  });

  app.get('/api/v1/projects', async (req) => {
    const a = requireCompany(req);
    return db.selectFrom('md_project as p').leftJoin('md_customer as c', 'c.id', 'p.customer_id')
      .select(['p.id', 'p.code', 'p.name_th', 'p.name_en', 'p.customer_id', 'c.code as customer_code', 'c.name as customer_name', 'p.ref_no', 'p.manager', 'p.start_date', 'p.end_date', 'p.status', 'p.contract_amount', 'p.note',
        sql<string>`coalesce((SELECT sum(b.est_expense) FROM md_project_budget b JOIN gl_account g ON g.id = b.account_id WHERE b.project_id = p.id AND b.deleted_at IS NULL AND g.account_group = '5'), 0)`.as('budget_total')])
      .where('p.company_id', '=', a.companyId).where('p.deleted_at', 'is', null).orderBy('p.code').execute();
  });

  app.get('/api/v1/projects/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const p = await db.selectFrom('md_project as p').leftJoin('md_customer as c', 'c.id', 'p.customer_id')
      .select(['p.id', 'p.code', 'p.name_th', 'p.name_en', 'p.customer_id', 'c.code as customer_code', 'c.name as customer_name', 'p.ref_no', 'p.manager', 'p.start_date', 'p.end_date', 'p.status', 'p.contract_amount', 'p.note'])
      .where('p.id', '=', id).where('p.company_id', '=', a.companyId).where('p.deleted_at', 'is', null).executeTakeFirst();
    if (!p) throw notFound('Job/โครงการ');
    const budgets = await db.selectFrom('md_project_budget as b').innerJoin('gl_account as g', 'g.id', 'b.account_id')
      .select(['b.account_id', 'g.account_no', 'g.name_th as account_name', 'b.est_expense as amount'])
      .where('b.project_id', '=', id).where('b.company_id', '=', a.companyId).where('b.deleted_at', 'is', null).orderBy('g.account_no').execute();
    const used = await db.selectFrom('gl_journal_line').select('id').where('company_id', '=', a.companyId).where('project_id', '=', id).where('deleted_at', 'is', null).limit(1).executeTakeFirst();
    return { ...p, budgets, used: !!used };
  });

  /** งบรายบัญชี: บัญชีย่อยของบริษัทนี้ ไม่ซ้ำ — แทนที่ทั้งชุดทุกครั้งที่บันทึก */
  async function saveBudgets(tx: Db, a: { companyId: string; userId: string | null }, projectId: string, rows: Array<{ account_id: string; amount: string | null }>) {
    const keep = rows.filter((r) => r.amount !== null && !d(r.amount).isZero());
    const dup = keep.find((r, i) => keep.findIndex((x) => x.account_id === r.account_id) !== i);
    if (dup) throw badRequest('งบประมาณมีเลขที่บัญชีซ้ำ — รวมเป็นบรรทัดเดียว', [{ field: 'budgets', message: 'บัญชีซ้ำ' }]);
    await checkOwned(tx, a.companyId, keep.map((r, i) => ({ table: 'gl_account', id: r.account_id, field: 'account_id', line: i + 1 })));
    const ctl = keep.length ? await tx.selectFrom('gl_account').select('account_no').where('company_id', '=', a.companyId).where('id', 'in', keep.map((r) => r.account_id)).where('is_control', '=', true).executeTakeFirst() : undefined;
    if (ctl) throw badRequest(`บัญชี ${ctl.account_no} เป็นบัญชีคุม — ตั้งงบที่บัญชีย่อย`, [{ field: 'budgets', message: 'เลือกบัญชีย่อย' }]);
    await tx.deleteFrom('md_project_budget').where('project_id', '=', projectId).where('company_id', '=', a.companyId).where('account_id', 'is not', null).execute();
    if (keep.length) await tx.insertInto('md_project_budget').values(keep.map((r) => ({ company_id: a.companyId, project_id: projectId, account_id: r.account_id, est_expense: r.amount, created_by: a.userId }))).execute();
  }
  async function checkBody(b: z.infer<typeof jobBody>, companyId: string, id?: string) {
    if (b.start_date && b.end_date && b.end_date < b.start_date) throw badRequest('วันสิ้นสุดต้องไม่ก่อนวันเริ่ม', [{ field: 'end_date', message: 'วันสิ้นสุดต้องไม่ก่อนวันเริ่ม' }]);
    await checkOwned(db, companyId, [{ table: 'md_customer', id: b.customer_id, field: 'customer_id' }]);
    let q = db.selectFrom('md_project').select(['id', 'name_th']).where('company_id', '=', companyId).where('code', '=', b.code).where('deleted_at', 'is', null);
    if (id) q = q.where('id', '<>', id);
    const dup = await q.executeTakeFirst();
    if (dup) throw badRequest(`รหัส Job ${b.code} ซ้ำกับ "${dup.name_th}" — ใช้รหัสอื่น`, [{ field: 'code', message: 'รหัสซ้ำ' }]);
  }
  const cols = (b: z.infer<typeof jobBody>) => ({ code: b.code, name_th: b.name_th, name_en: b.name_en, customer_id: b.customer_id ?? null, ref_no: b.ref_no, manager: b.manager,
    start_date: b.start_date ?? null, end_date: b.end_date ?? null, status: b.status, contract_amount: b.contract_amount, note: b.note });

  app.post('/api/v1/projects', async (req) => {
    const a = requireCompany(req);
    const b = parse(jobBody, req.body);
    await checkBody(b, a.companyId);
    return db.transaction().execute(async (tx) => {
      const r = await tx.insertInto('md_project').values({ ...cols(b), company_id: a.companyId, created_by: a.userId }).returning('id').executeTakeFirstOrThrow();
      await saveBudgets(tx, a, r.id, b.budgets);
      // Job แรกของบริษัท → เปิดใช้ Job (คอลัมน์ Job แสดงในเอกสาร) — ปิดเองได้ที่ รายละเอียดกิจการ
      const set = await tx.selectFrom('sys_setting').select('id').where('company_id', '=', a.companyId).where('branch_id', 'is', null).where('key', '=', 'gen.use_project').where('deleted_at', 'is', null).executeTakeFirst();
      if (!set) await setSetting(tx, a.companyId, 'gen.use_project', true, a.userId ?? undefined);
      await logActivity(tx, a, { module: 'GL', action: 'ADD', docNo: b.code, table: 'md_project', rowId: r.id });
      return r;
    });
  });

  app.put('/api/v1/projects/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(jobBody, req.body);
    const cur = await db.selectFrom('md_project').select(['id', 'code']).where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!cur) throw notFound('Job/โครงการ');
    await checkBody(b, a.companyId, id);
    await db.transaction().execute(async (tx) => {
      await tx.updateTable('md_project').set({ ...cols(b), updated_by: a.userId }).where('id', '=', id).where('company_id', '=', a.companyId).execute();
      await saveBudgets(tx, a, id, b.budgets);
      await logActivity(tx, a, { module: 'GL', action: 'EDIT', docNo: b.code, table: 'md_project', rowId: id });
    });
    return { id };
  });

  app.delete('/api/v1/projects/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const cur = await db.selectFrom('md_project').select(['id', 'code']).where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!cur) throw notFound('Job/โครงการ');
    const used = await sql<{ n: number }>`SELECT (SELECT count(*) FROM doc_line WHERE company_id = ${a.companyId} AND project_id = ${id} AND deleted_at IS NULL)
      + (SELECT count(*) FROM doc_header WHERE company_id = ${a.companyId} AND project_id = ${id} AND deleted_at IS NULL)
      + (SELECT count(*) FROM gl_journal_line WHERE company_id = ${a.companyId} AND project_id = ${id} AND deleted_at IS NULL) AS n`.execute(db);
    if (Number(used.rows[0]?.n ?? 0) > 0) throw badRequest(`Job ${cur.code} มีเอกสาร/รายการบัญชีแล้ว ลบไม่ได้ — เปลี่ยนสถานะเป็น "ปิดแล้ว" แทน`);
    await db.transaction().execute(async (tx) => {
      await tx.updateTable('md_project_budget').set({ deleted_at: sql`now()` as never }).where('project_id', '=', id).where('company_id', '=', a.companyId).execute();
      await tx.updateTable('md_project').set({ deleted_at: sql`now()` as never, updated_by: a.userId }).where('id', '=', id).where('company_id', '=', a.companyId).execute();
      await logActivity(tx, a, { module: 'GL', action: 'DELETE', docNo: cur.code, table: 'md_project', rowId: id });
    });
    return { ok: true };
  });

  /* ---------------------------------------------------------------- รายงานต้นทุน/กำไรตาม Job */
  const rq = z.object({ from: isoDate.optional(), to: isoDate.optional(), status: z.enum(['A', 'I', 'all']).default('all'), branch_id: uuid.optional() });
  /** สรุปทุก Job: รายได้ ต้นทุน กำไร เทียบมูลค่าสัญญา/งบ — ช่วงวันที่ว่าง = สะสมตั้งแต่เริ่ม */
  app.get('/api/v1/reports/jobs', async (req) => {
    const a = requireCompany(req);
    const q = parse(rq, req.query);
    if (q.from && q.to && q.from > q.to) throw badRequest('วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด');
    let pq = db.selectFrom('md_project as p').leftJoin('md_customer as c', 'c.id', 'p.customer_id')
      .select(['p.id', 'p.code', 'p.name_th', 'p.name_en', 'p.status', 'p.start_date', 'p.end_date', 'p.contract_amount', 'c.code as customer_code', 'c.name as customer_name',
        sql<string>`coalesce((SELECT sum(b.est_expense) FROM md_project_budget b JOIN gl_account g ON g.id = b.account_id WHERE b.project_id = p.id AND b.deleted_at IS NULL AND g.account_group = '5'), 0)`.as('budget')])
      .where('p.company_id', '=', a.companyId).where('p.deleted_at', 'is', null);
    if (q.status !== 'all') pq = pq.where('p.status', '=', q.status);
    const jobs = await pq.orderBy('p.code').execute();
    const act = await actuals(db, a.companyId, q);
    const T = { revenue: ZERO, cost: ZERO, other: ZERO, budget: ZERO, contract: ZERO };
    const rows = jobs.map((j) => {
      const m = { revenue: ZERO, cost: ZERO, other: ZERO };
      for (const r of act) if (r.project_id === j.id) m[kindOf(r.account_group)] = m[kindOf(r.account_group)].plus(amountOf(r));
      const profit = m.revenue.minus(m.cost), budget = d(j.budget), contract = d(j.contract_amount ?? 0);
      T.revenue = T.revenue.plus(m.revenue); T.cost = T.cost.plus(m.cost); T.other = T.other.plus(m.other); T.budget = T.budget.plus(budget); T.contract = T.contract.plus(contract);
      return { ...j, contract_amount: j.contract_amount === null ? null : contract.toFixed(2), revenue: m.revenue.toFixed(2), cost: m.cost.toFixed(2), profit: profit.toFixed(2), margin: pct(profit, m.revenue),
        budget: budget.toFixed(2), budget_left: budget.minus(m.cost).toFixed(2), budget_used: pct(m.cost, budget), stock_for_job: m.other.toFixed(2) };
    });
    const profit = T.revenue.minus(T.cost);
    return { from: q.from ?? null, to: q.to ?? null, rows,
      totals: { revenue: T.revenue.toFixed(2), cost: T.cost.toFixed(2), profit: profit.toFixed(2), margin: pct(profit, T.revenue), budget: T.budget.toFixed(2), contract_amount: T.contract.toFixed(2), stock_for_job: T.other.toFixed(2) } };
  });

  /** รายละเอียด Job เดียว: รายบัญชี (รายได้ / ต้นทุนเทียบงบ / ซื้อเข้าคลังสำหรับ Job) — คลิกบัญชีไปแยกประเภทที่กรอง Job นี้ */
  app.get('/api/v1/reports/jobs/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const q = parse(rq, req.query);
    if (q.from && q.to && q.from > q.to) throw badRequest('วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด');
    const job = await db.selectFrom('md_project as p').leftJoin('md_customer as c', 'c.id', 'p.customer_id')
      .select(['p.id', 'p.code', 'p.name_th', 'p.name_en', 'p.status', 'p.start_date', 'p.end_date', 'p.contract_amount', 'p.ref_no', 'p.manager', 'c.code as customer_code', 'c.name as customer_name'])
      .where('p.id', '=', id).where('p.company_id', '=', a.companyId).where('p.deleted_at', 'is', null).executeTakeFirst();
    if (!job) throw notFound('Job/โครงการ');
    const act = await actuals(db, a.companyId, { ...q, project_id: id });
    const bud = await db.selectFrom('md_project_budget as b').innerJoin('gl_account as g', 'g.id', 'b.account_id')
      .select(['b.account_id', 'g.account_no', 'g.name_th', 'g.name_en', 'g.account_group', 'b.est_expense'])
      .where('b.project_id', '=', id).where('b.company_id', '=', a.companyId).where('b.deleted_at', 'is', null).execute();
    const map = new Map<string, { account_id: string; account_no: string; name_th: string; name_en: string | null; kind: string; actual: Decimal; budget: Decimal | null }>();
    for (const r of act) map.set(r.account_id, { account_id: r.account_id, account_no: r.account_no, name_th: r.name_th, name_en: r.name_en, kind: kindOf(r.account_group), actual: amountOf(r), budget: null });
    for (const b of bud) {
      const x = map.get(b.account_id!) ?? { account_id: b.account_id!, account_no: b.account_no, name_th: b.name_th, name_en: b.name_en, kind: kindOf(b.account_group), actual: ZERO, budget: null };
      x.budget = d(b.est_expense ?? 0); map.set(b.account_id!, x);
    }
    const all = [...map.values()].sort((x, y) => x.account_no.localeCompare(y.account_no));
    const part = (k: string) => {
      const rows = all.filter((x) => x.kind === k).map((x) => ({ account_id: x.account_id, account_no: x.account_no, name_th: x.name_th, name_en: x.name_en, actual: x.actual.toFixed(2),
        budget: x.budget?.toFixed(2) ?? null, diff: x.budget ? x.budget.minus(x.actual).toFixed(2) : null, used: x.budget ? pct(x.actual, x.budget) : null }));
      const actual = all.filter((x) => x.kind === k).reduce((s, x) => s.plus(x.actual), ZERO), budget = all.filter((x) => x.kind === k).reduce((s, x) => s.plus(x.budget ?? ZERO), ZERO);
      return { rows, actual: actual.toFixed(2), budget: budget.toFixed(2), diff: budget.minus(actual).toFixed(2), used: pct(actual, budget) };
    };
    const revenue = part('revenue'), cost = part('cost'), other = part('other');
    const profit = d(revenue.actual).minus(d(cost.actual));
    return { job, from: q.from ?? null, to: q.to ?? null, revenue, cost, other, profit: profit.toFixed(2), margin: pct(profit, d(revenue.actual)) };
  });
}
