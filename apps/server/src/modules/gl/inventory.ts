import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { d } from '@buddy/core';
import type { Db } from '../../db.js';
import { badRequest, notFound, parse, requireCompany, type AuthContext } from '../../http.js';
import { logActivity } from '../../audit.js';
import { leafTotals, loadChart, closingOf } from './balances.js';

/**
 * บัญชีสินค้าคงเหลือ Periodic (คู่มือบทที่ 15 S-GL-14/15, Express GLINV)
 * Periodic ไม่ลงบัญชีสินค้าในสมุดรายวัน → งบการเงิน (ข้อมูลชนิด INV) ใช้ยอดปลายงวดที่ยืนยันที่นี่ · ไม่มี = ใช้ยอดบัญชี
 * ยอดจากระบบสินค้าคำนวณสดจาก v_stock_move (สินค้าที่กลุ่มบัญชีผูกบัญชีนี้ · บัญชีสินค้าของบัญชีเพื่อลงรายวันรวมสินค้าที่ไม่ได้ผูก)
 */
type Ctx = AuthContext & { companyId: string };
const uuid = z.string().uuid();

async function yearOf(db: Db, companyId: string, fyId?: string) {
  const q = db.selectFrom('gl_fiscal_year').select(['id', 'code', 'start_date', 'end_date']).where('company_id', '=', companyId).where('deleted_at', 'is', null);
  const fy = fyId ? await q.where('id', '=', fyId).executeTakeFirst() : await q.where('start_date', '<=', sql<string>`current_date`).orderBy('start_date', 'desc').executeTakeFirst() ?? await q.orderBy('start_date').executeTakeFirst();
  if (!fy) throw notFound('ปีบัญชี');
  const periods = await db.selectFrom('gl_period').select(['period_no', 'start_date', 'end_date']).where('company_id', '=', companyId).where('fiscal_year_id', '=', fy.id).where('deleted_at', 'is', null).orderBy('period_no').execute();
  return { fy, periods };
}
/** มูลค่าสินค้าคงเหลือจากระบบสินค้า ณ วันที่ ของสินค้าที่ผูกกับบัญชีนี้ */
async function systemValue(db: Db, companyId: string, accountId: string, date: string) {
  const isDefault = !!(await db.selectFrom('gl_default_account').select('id').where('company_id', '=', companyId).where('role', '=', 'INVENTORY').where('account_id', '=', accountId).where('deleted_at', 'is', null).executeTakeFirst());
  const r = (await sql<{ v: string }>`SELECT coalesce(sum(m.value), 0) AS v FROM v_stock_move m JOIN md_item i ON i.id = m.item_id LEFT JOIN md_item_account_group g ON g.id = i.account_group_id
      WHERE m.company_id = ${companyId} AND m.doc_date <= ${date} AND (g.inventory_account_id = ${accountId} ${isDefault ? sql`OR g.inventory_account_id IS NULL` : sql``})`.execute(db)).rows[0]!;
  return d(r.v);
}
const dayBefore = (iso: string) => new Date(new Date(iso + 'T00:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);

export function inventoryAccountRoutes(app: FastifyInstance, db: Db) {
  /** บัญชีที่ใช้เป็นบัญชีสินค้าคงเหลือ (กลุ่มบัญชีสินค้า + บัญชีเพื่อลงรายวัน + ที่เคยป้อน) */
  app.get('/api/v1/gl/inventory-accounts', async (req) => {
    const a = requireCompany(req);
    const rows = (await sql`SELECT g.id, g.account_no, g.name_th FROM gl_account g WHERE g.company_id = ${a.companyId} AND g.deleted_at IS NULL AND NOT g.is_control AND (
        (g.account_group = '1' AND g.id IN (SELECT ag.inventory_account_id FROM md_item_account_group ag JOIN md_item i ON i.account_group_id = ag.id AND i.item_type = '0' AND i.deleted_at IS NULL
           WHERE ag.company_id = ${a.companyId} AND ag.deleted_at IS NULL))
        OR g.id IN (SELECT account_id FROM gl_default_account WHERE company_id = ${a.companyId} AND role = 'INVENTORY' AND deleted_at IS NULL)
        OR g.id IN (SELECT account_id FROM gl_inventory_balance WHERE company_id = ${a.companyId} AND deleted_at IS NULL)) ORDER BY g.account_no`.execute(db)).rows;
    return { rows };
  });

  app.get('/api/v1/gl/inventory', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ account_id: uuid, fiscal_year_id: uuid.optional(), department_id: uuid.optional() }), req.query);
    const acc = await db.selectFrom('gl_account').select(['id', 'account_no', 'name_th']).where('id', '=', q.account_id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!acc) throw notFound('บัญชี');
    const { fy, periods } = await yearOf(db, a.companyId, q.fiscal_year_id);
    const saved = await db.selectFrom('gl_inventory_balance').select(['period_no', 'amount', 'source']).where('company_id', '=', a.companyId).where('fiscal_year_id', '=', fy.id).where('account_id', '=', acc.id)
      .where('deleted_at', 'is', null).$if(!!q.department_id, (x) => x.where('department_id', '=', q.department_id!)).$if(!q.department_id, (x) => x.where('department_id', 'is', null)).execute();
    const chart = await loadChart(db, a.companyId);
    const start = String(fy.start_date).slice(0, 10);
    const glAt = async (date: string) => { const t = (await leafTotals(db, a.companyId, chart, start, date, q.department_id ? { departmentId: q.department_id } : {})).get(acc.id); return t ? closingOf(t).toFixed(2) : '0.00'; };
    const glOpening = (await leafTotals(db, a.companyId, chart, start, start, q.department_id ? { departmentId: q.department_id } : {})).get(acc.id)?.opening.toFixed(2) ?? '0.00';
    const row = async (no: number, date: string) => {
      const s = saved.find((x) => x.period_no === no);
      return { period_no: no, date, entered: s ? d(s.amount).toFixed(2) : null, source: s?.source ?? null,
        system: q.department_id ? null : (await systemValue(db, a.companyId, acc.id, date)).toFixed(2), gl: no === 0 ? glOpening : await glAt(date) };
    };
    const rows = [await row(0, dayBefore(start))];
    for (const p of periods) rows.push(await row(p.period_no, String(p.end_date).slice(0, 10)));
    return { account: acc, fiscal_year: fy, rows };
  });

  /** บันทึกยอดปลายงวด (ว่าง = ไม่ใช้ — งบใช้ยอดบัญชี) · ยอดยกมาต้องเท่ายอดยกมาในระบบบัญชี */
  app.put('/api/v1/gl/inventory', async (req) => {
    const a = requireCompany(req);
    const b = parse(z.object({ account_id: uuid, fiscal_year_id: uuid, department_id: uuid.nullable().optional().transform((v) => v ?? null),
      rows: z.array(z.object({ period_no: z.number().int().min(0).max(13), amount: z.union([z.string(), z.number()]).nullable().transform((v) => (v === null || v === '' ? null : String(v))), source: z.enum(['M', 'S']).default('M') })).max(14) }), req.body);
    return save(db, a, b);
  });

  /** S-GL-15 คำนวณยอดคงเหลือจากระบบสินค้า: งวด 0 = ยอดยกมา · −1 = ทุกงวด (งวดที่ยังไม่มีรายการ = ยอดงวดล่าสุด) */
  app.post('/api/v1/gl/inventory/compute', async (req) => {
    const a = requireCompany(req);
    const b = parse(z.object({ account_id: uuid, fiscal_year_id: uuid, period: z.number().int().min(-1).max(13) }), req.body);
    const { fy, periods } = await yearOf(db, a.companyId, b.fiscal_year_id);
    const start = String(fy.start_date).slice(0, 10);
    const targets = [...(b.period <= 0 ? [{ period_no: 0, date: dayBefore(start) }] : []), ...periods.filter((p) => b.period === -1 || p.period_no === b.period).map((p) => ({ period_no: p.period_no, date: String(p.end_date).slice(0, 10) }))];
    if (b.period === 0) targets.splice(1);
    const cur = await db.selectFrom('gl_inventory_balance').select(['period_no', 'amount', 'source']).where('company_id', '=', a.companyId).where('fiscal_year_id', '=', fy.id).where('account_id', '=', b.account_id).where('department_id', 'is', null).where('deleted_at', 'is', null).execute();
    const rows = new Map(cur.map((r) => [r.period_no, { period_no: r.period_no, amount: d(r.amount).toFixed(2) as string | null, source: r.source as 'M' | 'S' }]));
    for (const t of targets) rows.set(t.period_no, { period_no: t.period_no, amount: (await systemValue(db, a.companyId, b.account_id, t.date)).toFixed(2), source: 'S' });
    return save(db, a, { account_id: b.account_id, fiscal_year_id: fy.id, department_id: null, rows: [...rows.values()] });
  });
}

async function save(db: Db, a: Ctx, b: { account_id: string; fiscal_year_id: string; department_id: string | null; rows: Array<{ period_no: number; amount: string | null; source: 'M' | 'S' }> }) {
  for (const [tbl, v] of [['gl_account', b.account_id], ['gl_fiscal_year', b.fiscal_year_id], ['md_department', b.department_id]] as const)
    if (v && !(await db.selectFrom(tbl).select('id').where('id', '=', v).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst())) throw badRequest('ไม่พบบัญชี/ปีบัญชี/แผนกที่เลือก');
  const acc = await db.selectFrom('gl_account').select(['account_no', 'is_control']).where('id', '=', b.account_id).executeTakeFirstOrThrow();
  if (acc.is_control) throw badRequest(`บัญชี ${acc.account_no} เป็นบัญชีคุม — เลือกบัญชีย่อย`);
  for (const r of b.rows) if (r.amount !== null && (Number.isNaN(Number(r.amount)) || d(r.amount).lt(0))) throw badRequest(`งวด ${r.period_no}: ยอดคงเหลือต้องเป็นตัวเลขไม่ติดลบ`);
  return db.transaction().execute(async (tx) => {
    const del = tx.updateTable('gl_inventory_balance').set({ deleted_at: sql`now()` as never, updated_by: a.userId }).where('company_id', '=', a.companyId).where('fiscal_year_id', '=', b.fiscal_year_id).where('account_id', '=', b.account_id).where('deleted_at', 'is', null);
    await (b.department_id ? del.where('department_id', '=', b.department_id) : del.where('department_id', 'is', null)).execute();
    const keep = b.rows.filter((r) => r.amount !== null);
    if (keep.length) await tx.insertInto('gl_inventory_balance').values(keep.map((r) => ({ company_id: a.companyId, fiscal_year_id: b.fiscal_year_id, account_id: b.account_id, department_id: b.department_id, period_no: r.period_no, amount: d(r.amount!).toFixed(2), source: r.source, created_by: a.userId, updated_by: a.userId }))).execute();
    await logActivity(tx, a, { module: 'GL', action: 'EDIT', docNo: acc.account_no, table: 'gl_inventory_balance', rowId: null, detail: { periods: keep.length } });
    return { saved: keep.length };
  });
}
