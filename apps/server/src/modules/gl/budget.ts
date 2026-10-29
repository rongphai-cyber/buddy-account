import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { d, ZERO, addMonths, type Decimal } from '@buddy/core';
import type { Db } from '../../db.js';
import { badRequest, notFound, parse, requireCompany, type AuthContext } from '../../http.js';
import { logActivity } from '../../audit.js';
import { fiscalYearOf, isPL, type Chart } from './balances.js';

const uuid = z.string().uuid();
const money = z.union([z.string(), z.number()]).nullable().optional();

/** ปีบัญชีที่เลือก (หรือตามวันทำการ) — ต้องเป็นของบริษัทนี้ */
async function yearOf(db: Db, a: AuthContext & { companyId: string }, id?: string) {
  const y = id
    ? await db.selectFrom('gl_fiscal_year').select(['id', 'code', 'start_date', 'end_date']).where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst()
    : await fiscalYearOf(db, a.companyId, a.workDate ?? new Date().toISOString().slice(0, 10));
  if (!y) throw id ? notFound('ปีบัญชี') : badRequest('วันทำการไม่อยู่ในรอบบัญชี — เลือกปีบัญชีก่อน');
  return { id: y.id, code: y.code, start_date: y.start_date, end_date: y.end_date };
}

/**
 * งบประมาณของทุกบัญชี (รวมขึ้นบัญชีคุม) ในช่วง [from, to] ตามด้านปกติของบัญชี — ใช้กับคอลัมน์ BUD / PTD BUD ของแบบงบ
 * งบประมาณป้อนเป็นยอดตามด้านปกติ (ค่าใช้จ่าย/รายได้ที่คาดไว้เป็นบวก) จึงไม่ต้องกลับเครื่องหมาย
 */
export async function budgetTotals(db: Db, companyId: string, chart: Chart, from: string, to: string, departmentId?: string | null): Promise<Map<string, Decimal>> {
  const rows = await sql<{ account_id: string; amt: string }>`
    SELECT b.account_id, sum(b.amount) AS amt
      FROM gl_budget b JOIN gl_period p ON p.id = b.period_id
     WHERE b.company_id = ${companyId} AND b.deleted_at IS NULL AND p.start_date >= ${from}::date AND p.end_date <= ${to}::date
       AND (${departmentId ?? null}::uuid IS NULL OR b.department_id = ${departmentId ?? null}::uuid)
     GROUP BY b.account_id`.execute(db);
  const out = new Map<string, Decimal>();
  for (const r of rows.rows) {
    let cur: string | null | undefined = r.account_id;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) { seen.add(cur); out.set(cur, (out.get(cur) ?? ZERO).plus(d(r.amt))); cur = chart.byId.get(cur)?.parent_id; }
  }
  return out;
}

/** งบประมาณ — คู่มือบทที่ 15 S-GL-17 (บัญชี › 4. งบประมาณ): ป้อนรายงวด เทียบยอดจริงปีปัจจุบันและปีที่แล้ว */
export function budgetRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/v1/gl/budget', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ fiscal_year_id: uuid.optional() }), req.query);
    const y = await yearOf(db, a, q.fiscal_year_id);
    const years = await db.selectFrom('gl_fiscal_year').select(['id', 'code', 'start_date', 'end_date']).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).orderBy('start_date', 'desc').execute();
    const rows = await db.selectFrom('gl_budget as b').innerJoin('gl_period as p', 'p.id', 'b.period_id').innerJoin('gl_account as g', 'g.id', 'b.account_id').leftJoin('md_department as dp', 'dp.id', 'b.department_id')
      .select(['b.account_id', 'g.account_no', 'g.name_th', 'g.account_group', 'b.department_id', 'dp.code as department_code', sql<string>`sum(b.amount)`.as('total')])
      .where('b.company_id', '=', a.companyId).where('b.deleted_at', 'is', null).where('p.fiscal_year_id', '=', y.id)
      .groupBy(['b.account_id', 'g.account_no', 'g.name_th', 'g.account_group', 'b.department_id', 'dp.code']).orderBy('g.account_no').orderBy('dp.code').execute();
    return { year: y, years, rows: rows.map((r) => ({ ...r, total: d(r.total).toFixed(2) })) };
  });

  app.get('/api/v1/gl/budget/entry', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ fiscal_year_id: uuid.optional(), account_id: uuid, department_id: uuid.optional() }), req.query);
    const y = await yearOf(db, a, q.fiscal_year_id);
    const acc = await db.selectFrom('gl_account').select(['id', 'account_no', 'name_th', 'account_group']).where('id', '=', q.account_id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!acc) throw notFound('บัญชี');
    const dept = q.department_id ?? null;
    const periods = await db.selectFrom('gl_period').select(['id', 'period_no', 'start_date', 'end_date']).where('company_id', '=', a.companyId).where('fiscal_year_id', '=', y.id).where('deleted_at', 'is', null).orderBy('period_no').execute();
    const bud = await db.selectFrom('gl_budget').select(['period_id', 'amount']).where('company_id', '=', a.companyId).where('account_id', '=', acc.id)
      .where(sql<boolean>`department_id IS NOT DISTINCT FROM ${dept}::uuid`).where('deleted_at', 'is', null).where('period_id', 'in', periods.length ? periods.map((p) => p.id) : ['00000000-0000-0000-0000-000000000000']).execute();
    const budBy = new Map(bud.map((b) => [b.period_id, d(b.amount)]));
    // ยอดจริงรายเดือนตามด้านปกติ: ปีนี้และปีที่แล้ว (ใบสำคัญ + ยอดปีที่แล้วที่ป้อนเอง)
    const lyStart = addMonths(y.start_date, -12);
    const mv = await sql<{ m: number; amt: string }>`
      WITH x AS (
        SELECT j.voucher_date AS dt, l.debit - l.credit AS amt
          FROM gl_journal j JOIN gl_journal_line l ON l.journal_id = j.id AND l.deleted_at IS NULL
         WHERE j.company_id = ${a.companyId} AND j.doc_status = 'N' AND j.deleted_at IS NULL AND l.account_id = ${acc.id}
           AND (${dept}::uuid IS NULL OR l.department_id = ${dept}::uuid)
           AND j.voucher_date >= ${lyStart}::date AND j.voucher_date <= ${y.end_date}::date
        UNION ALL
        SELECT pp.end_date, pb.debit - pb.credit
          FROM gl_prior_year_balance pb JOIN gl_period pp ON pp.fiscal_year_id = pb.fiscal_year_id AND pp.period_no = pb.period_no AND pp.deleted_at IS NULL
         WHERE pb.company_id = ${a.companyId} AND pb.deleted_at IS NULL AND pb.account_id = ${acc.id} AND pb.period_no > 0
           AND (${dept}::uuid IS NULL OR pb.department_id = ${dept}::uuid)
           AND pp.end_date >= ${lyStart}::date AND pp.end_date < ${y.start_date}::date)
      SELECT (EXTRACT(YEAR FROM age(date_trunc('month', dt), date_trunc('month', ${lyStart}::date))) * 12
            + EXTRACT(MONTH FROM age(date_trunc('month', dt), date_trunc('month', ${lyStart}::date))))::int AS m, sum(amt) AS amt
        FROM x GROUP BY 1`.execute(db);
    const byMonth = new Map(mv.rows.map((r) => [r.m, d(r.amt)]));
    const nat = (v: Decimal) => (acc.account_group === '1' || acc.account_group >= '5' ? v : v.neg());
    return {
      year: y, account: acc, department_id: dept, is_pl: isPL(acc.account_group),
      periods: periods.map((p) => ({
        period_id: p.id, period_no: p.period_no, start_date: p.start_date, end_date: p.end_date,
        budget: (budBy.get(p.id) ?? ZERO).toFixed(2),
        actual: nat(byMonth.get(p.period_no + 11) ?? ZERO).toFixed(2),
        last_year: nat(byMonth.get(p.period_no - 1) ?? ZERO).toFixed(2),
      })),
    };
  });

  const body = z.object({
    fiscal_year_id: uuid.optional(), account_id: uuid, department_id: uuid.nullable().optional(),
    periods: z.array(z.object({ period_no: z.number().int().min(1).max(12), amount: money })).max(12),
  });

  app.put('/api/v1/gl/budget/entry', async (req) => {
    const a = requireCompany(req);
    const b = parse(body, req.body);
    const y = await yearOf(db, a, b.fiscal_year_id);
    const acc = await db.selectFrom('gl_account').select(['id', 'account_no', 'is_control']).where('id', '=', b.account_id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!acc) throw badRequest('ไม่พบบัญชีนี้ในผังบัญชี');
    if (acc.is_control) throw badRequest(`บัญชี ${acc.account_no} เป็นบัญชีคุม — ป้อนงบประมาณที่บัญชีย่อย (บัญชีคุมรวมยอดให้เอง)`);
    const dept = b.department_id ?? null;
    if (dept && !(await db.selectFrom('md_department').select('id').where('id', '=', dept).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst())) throw badRequest('ไม่พบแผนกนี้');
    if (new Set(b.periods.map((p) => p.period_no)).size !== b.periods.length) throw badRequest('งวดซ้ำกัน');
    const periods = await db.selectFrom('gl_period').select(['id', 'period_no']).where('company_id', '=', a.companyId).where('fiscal_year_id', '=', y.id).where('deleted_at', 'is', null).execute();
    const pid = new Map(periods.map((p) => [p.period_no, p.id]));
    return db.transaction().execute(async (tx) => {
      const ids = periods.map((p) => p.id);
      const before = ids.length ? await tx.selectFrom('gl_budget').select(['period_id', 'amount']).where('company_id', '=', a.companyId).where('account_id', '=', acc.id)
        .where(sql<boolean>`department_id IS NOT DISTINCT FROM ${dept}::uuid`).where('deleted_at', 'is', null).where('period_id', 'in', ids).execute() : [];
      if (ids.length) await tx.updateTable('gl_budget').set({ deleted_at: sql`now()` as never, updated_by: a.userId }).where('company_id', '=', a.companyId).where('account_id', '=', acc.id)
        .where(sql<boolean>`department_id IS NOT DISTINCT FROM ${dept}::uuid`).where('deleted_at', 'is', null).where('period_id', 'in', ids).execute();
      const rows = b.periods.filter((p) => !d(p.amount).isZero() && pid.has(p.period_no))
        .map((p) => ({ company_id: a.companyId, account_id: acc.id, department_id: dept, period_id: pid.get(p.period_no)!, amount: d(p.amount).toFixed(2), created_by: a.userId }));
      if (rows.length) await tx.insertInto('gl_budget').values(rows).execute();
      const total = rows.reduce((s, r) => s.plus(d(r.amount)), ZERO);
      await logActivity(tx, a, { module: 'GL', action: 'BUDGET', docNo: acc.account_no, table: 'gl_budget', rowId: acc.id, detail: { fiscal_year: y.code, department_id: dept, before, total: total.toFixed(2) } });
      return { total: total.toFixed(2) };
    });
  });
}
