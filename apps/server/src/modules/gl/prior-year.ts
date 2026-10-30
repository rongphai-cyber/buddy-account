import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { d, ZERO, addDays, addMonths } from '@buddy/core';
import type { Db } from '../../db.js';
import { badRequest, notFound, parse, requireCompany, type AuthContext } from '../../http.js';
import { logActivity } from '../../audit.js';
import { createFiscalYear } from '../../company-template.js';
import { closingOf, fiscalYearOf, isPL, leafTotals, loadChart } from './balances.js';

const uuid = z.string().uuid();
const money = z.union([z.string(), z.number()]).nullable().optional();

/**
 * ยอดปีที่แล้ว — คู่มือบทที่ 15 S-GL-16 (บัญชี › 3.2 ยอดปีที่แล้ว)
 * ปีที่แล้วที่มีใบสำคัญในระบบ: ยอดคำนวณจากใบสำคัญ (ดูได้อย่างเดียว)
 * ปีที่แล้วที่ไม่มีใบสำคัญ (เริ่มใช้กลางปี/ย้ายจากโปรแกรมอื่น): ป้อนยอดยกมาและยอดเคลื่อนไหวรายงวดเอง ใช้ทำงบเปรียบเทียบเท่านั้น
 */
export function priorYearRoutes(app: FastifyInstance, db: Db) {
  /** ปีปัจจุบัน (ที่เลือกหรือตามวันทำการ) และปีที่แล้วของมัน */
  async function years(a: AuthContext & { companyId: string }, currentId?: string) {
    const cur = currentId
      ? await db.selectFrom('gl_fiscal_year').select(['id', 'code', 'start_date', 'end_date']).where('id', '=', currentId).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst()
      : await fiscalYearOf(db, a.companyId, a.workDate ?? new Date().toISOString().slice(0, 10));
    if (!cur) throw currentId ? notFound('ปีบัญชี') : badRequest('วันทำการไม่อยู่ในรอบบัญชี — เลือกปีบัญชีปัจจุบันก่อน');
    const start = addMonths(cur.start_date, -12);
    const end = addDays(cur.start_date, -1);
    const prior = await db.selectFrom('gl_fiscal_year').select(['id', 'code', 'start_date', 'end_date']).where('company_id', '=', a.companyId).where('deleted_at', 'is', null)
      .where('start_date', '<=', end).where('end_date', '>=', start).orderBy('start_date').executeTakeFirst();
    const v = await db.selectFrom('gl_journal').select(sql<number>`count(*)`.as('n')).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).where('doc_status', '=', 'N')
      .where('voucher_date', '>=', start).where('voucher_date', '<=', end).executeTakeFirstOrThrow();
    return {
      current: { id: cur.id, code: cur.code, start_date: cur.start_date, end_date: cur.end_date },
      prior: { id: prior?.id ?? null, code: prior?.code ?? String(Number(end.slice(0, 4)) + 543), start_date: prior?.start_date ?? start, end_date: prior?.end_date ?? end },
      voucher_count: Number(v.n),
    };
  }

  app.get('/api/v1/gl/prior-year', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ fiscal_year_id: uuid.optional() }), req.query);
    const y = await years(a, q.fiscal_year_id);
    const list = await db.selectFrom('gl_fiscal_year').select(['id', 'code', 'start_date', 'end_date']).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).orderBy('start_date', 'desc').execute();
    const rows = y.prior.id ? await db.selectFrom('gl_prior_year_balance as b').innerJoin('gl_account as g', 'g.id', 'b.account_id').leftJoin('md_department as dp', 'dp.id', 'b.department_id')
      .select(['b.account_id', 'g.account_no', 'g.name_th', 'g.account_group', 'b.department_id', 'dp.code as department_code',
        sql<string>`sum(CASE WHEN b.period_no = 0 THEN b.debit - b.credit ELSE 0 END)`.as('opening'),
        sql<string>`sum(CASE WHEN b.period_no > 0 THEN b.debit ELSE 0 END)`.as('debit'),
        sql<string>`sum(CASE WHEN b.period_no > 0 THEN b.credit ELSE 0 END)`.as('credit')])
      .where('b.company_id', '=', a.companyId).where('b.fiscal_year_id', '=', y.prior.id).where('b.deleted_at', 'is', null)
      .groupBy(['b.account_id', 'g.account_no', 'g.name_th', 'g.account_group', 'b.department_id', 'dp.code']).orderBy('g.account_no').orderBy('dp.code').execute() : [];
    let dr = ZERO, cr = ZERO;
    const out = rows.map((r) => {
      const closing = d(r.opening).plus(d(r.debit)).minus(d(r.credit));
      if (closing.isPositive()) dr = dr.plus(closing); else cr = cr.plus(closing.neg());
      return { ...r, opening: d(r.opening).toFixed(2), debit: d(r.debit).toFixed(2), credit: d(r.credit).toFixed(2), closing: closing.toFixed(2) };
    });
    return { ...y, years: list, rows: out, closing_debit: dr.toFixed(2), closing_credit: cr.toFixed(2) };
  });

  app.get('/api/v1/gl/prior-year/entry', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ fiscal_year_id: uuid.optional(), account_id: uuid, department_id: uuid.optional() }), req.query);
    const y = await years(a, q.fiscal_year_id);
    const acc = await db.selectFrom('gl_account').select(['id', 'account_no', 'name_th', 'account_group', 'is_control']).where('id', '=', q.account_id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!acc) throw notFound('บัญชี');
    const dept = q.department_id ?? null;
    const months = Array.from({ length: 12 }, (_, i) => ({ period_no: i + 1, start_date: addMonths(y.prior.start_date, i), end_date: addDays(addMonths(y.prior.start_date, i + 1), -1), debit: '0.00', credit: '0.00' }));
    let opening = { debit: '0.00', credit: '0.00' };
    if (y.voucher_count > 0) {
      // ปีที่แล้วมีใบสำคัญ: แสดงยอดจากใบสำคัญ (ดูอย่างเดียว)
      const mv = await sql<{ m: number; dr: string; cr: string }>`
        SELECT (EXTRACT(YEAR FROM age(date_trunc('month', j.voucher_date), date_trunc('month', ${y.prior.start_date}::date))) * 12
              + EXTRACT(MONTH FROM age(date_trunc('month', j.voucher_date), date_trunc('month', ${y.prior.start_date}::date))))::int + 1 AS m,
               sum(l.debit) AS dr, sum(l.credit) AS cr
          FROM gl_journal j JOIN gl_journal_line l ON l.journal_id = j.id AND l.deleted_at IS NULL
         WHERE j.company_id = ${a.companyId} AND j.doc_status = 'N' AND j.deleted_at IS NULL AND l.account_id = ${acc.id}
           AND (${dept}::uuid IS NULL OR l.department_id = ${dept}::uuid)
           AND j.voucher_date BETWEEN ${y.prior.start_date}::date AND ${y.prior.end_date}::date
         GROUP BY 1`.execute(db);
      for (const r of mv.rows) { const p = months[r.m - 1]; if (p) { p.debit = d(r.dr).toFixed(2); p.credit = d(r.cr).toFixed(2); } }
      const chart = await loadChart(db, a.companyId);
      const t = (await leafTotals(db, a.companyId, chart, y.prior.start_date, y.prior.start_date, { departmentId: dept })).get(acc.id);
      if (t) opening = t.opening.isNegative() ? { debit: '0.00', credit: t.opening.neg().toFixed(2) } : { debit: t.opening.toFixed(2), credit: '0.00' };
    } else if (y.prior.id) {
      const rows = await db.selectFrom('gl_prior_year_balance').select(['period_no', 'debit', 'credit']).where('company_id', '=', a.companyId).where('fiscal_year_id', '=', y.prior.id)
        .where('account_id', '=', acc.id).where(sql<boolean>`department_id IS NOT DISTINCT FROM ${dept}::uuid`).where('deleted_at', 'is', null).execute();
      for (const r of rows) {
        const v = { debit: d(r.debit).toFixed(2), credit: d(r.credit).toFixed(2) };
        if (r.period_no === 0) opening = v; else Object.assign(months[r.period_no - 1]!, v);
      }
    }
    // ยอดยกมาปีปัจจุบัน (จากหน้ายอดยกมา/ใบสำคัญ) — ไว้เทียบกับยอดคงเหลือสิ้นปีที่แล้ว
    const chart = await loadChart(db, a.companyId);
    const cur = (await leafTotals(db, a.companyId, chart, y.current.start_date, y.current.start_date, { departmentId: dept })).get(acc.id);
    return { ...y, account: acc, department_id: dept, read_only: y.voucher_count > 0, opening, periods: months, current_opening: (cur?.opening ?? ZERO).toFixed(2), is_pl: isPL(acc.account_group) };
  });

  const body = z.object({
    fiscal_year_id: uuid.optional(), account_id: uuid, department_id: uuid.nullable().optional(),
    opening: z.object({ debit: money, credit: money }),
    periods: z.array(z.object({ period_no: z.number().int().min(1).max(12), debit: money, credit: money })).max(12),
  });

  app.put('/api/v1/gl/prior-year/entry', async (req) => {
    const a = requireCompany(req);
    const b = parse(body, req.body);
    const y = await years(a, b.fiscal_year_id);
    if (y.voucher_count > 0) throw badRequest(`ปี ${y.prior.code} มีใบสำคัญในระบบแล้ว ${y.voucher_count.toLocaleString()} ใบ — ยอดปีที่แล้วคำนวณจากใบสำคัญ ไม่ต้องป้อนเอง`);
    if (y.prior.id && y.prior.start_date !== addMonths(y.current.start_date, -12)) throw badRequest(`ปีบัญชี ${y.prior.code} ไม่ได้เริ่มก่อนปีปัจจุบัน 12 เดือนพอดี — ตรวจรอบบัญชีที่เมนู เริ่มระบบ › รอบบัญชี`);
    const acc = await db.selectFrom('gl_account').select(['id', 'account_no', 'account_group', 'is_control', 'status']).where('id', '=', b.account_id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!acc) throw badRequest('ไม่พบบัญชีนี้ในผังบัญชี');
    if (acc.is_control) throw badRequest(`บัญชี ${acc.account_no} เป็นบัญชีคุม ป้อนยอดไม่ได้ ให้ใช้บัญชีย่อย`);
    const dept = b.department_id ?? null;
    if (dept) {
      const dp = await db.selectFrom('md_department').select('id').where('id', '=', dept).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
      if (!dp) throw badRequest('ไม่พบแผนกนี้');
    }
    const all = [{ period_no: 0, debit: b.opening.debit, credit: b.opening.credit }, ...b.periods];
    if (all.some((r) => d(r.debit).isNegative() || d(r.credit).isNegative())) throw badRequest('จำนวนเงินติดลบไม่ได้ — ป้อนอีกด้านแทน (เดบิต/เครดิต)');
    if (new Set(b.periods.map((p) => p.period_no)).size !== b.periods.length) throw badRequest('งวดซ้ำกัน');
    if (isPL(acc.account_group) && !(d(b.opening.debit).isZero() && d(b.opening.credit).isZero()))
      throw badRequest(`บัญชี ${acc.account_no} เป็นบัญชีรายได้/ค่าใช้จ่าย ไม่มียอดยกมา — ป้อนเฉพาะยอดรายงวด`);
    return db.transaction().execute(async (tx) => {
      // ปีที่แล้วยังไม่มีในรอบบัญชี: สร้างให้ และปิดงวดไว้ (ป้อนยอดเองแล้ว จึงไม่ควรมีใบสำคัญในปีนั้นอีก)
      let fyId = y.prior.id;
      if (!fyId) {
        // ปีที่สร้างเพื่อเก็บยอดเปรียบเทียบอย่างเดียว = ปิดบัญชีแล้ว · ไม่เลื่อนวันเริ่มใช้โปรแกรม (ยอดยกมา/ลูกหนี้-เจ้าหนี้-สินค้ายกมายังลงวันก่อนวันเริ่มใช้ได้)
        fyId = await createFiscalYear(tx, a.companyId, y.prior.start_date, a.userId);
        await tx.updateTable('gl_fiscal_year').set({ status: 'C', updated_by: a.userId }).where('id', '=', fyId).execute();
      }
      await tx.updateTable('gl_period').set({ is_locked: true, locked_by: a.userId, locked_at: sql`now()` as never }).where('company_id', '=', a.companyId).where('fiscal_year_id', '=', fyId).where('is_locked', '=', false).execute();
      const before = await tx.selectFrom('gl_prior_year_balance').select(['period_no', 'debit', 'credit']).where('company_id', '=', a.companyId).where('fiscal_year_id', '=', fyId).where('account_id', '=', acc.id)
        .where(sql<boolean>`department_id IS NOT DISTINCT FROM ${dept}::uuid`).where('deleted_at', 'is', null).orderBy('period_no').execute();
      // ชุดเดิมทำเครื่องหมายลบ (ไม่ลบจริง) แล้วเขียนชุดใหม่
      await tx.updateTable('gl_prior_year_balance').set({ deleted_at: sql`now()` as never, updated_by: a.userId }).where('company_id', '=', a.companyId).where('fiscal_year_id', '=', fyId)
        .where('account_id', '=', acc.id).where(sql<boolean>`department_id IS NOT DISTINCT FROM ${dept}::uuid`).where('deleted_at', 'is', null).execute();
      const rows = all.filter((r) => !d(r.debit).isZero() || !d(r.credit).isZero())
        .map((r) => ({ company_id: a.companyId, fiscal_year_id: fyId, account_id: acc.id, department_id: dept, period_no: r.period_no, debit: d(r.debit).toFixed(2), credit: d(r.credit).toFixed(2), created_by: a.userId }));
      if (rows.length) await tx.insertInto('gl_prior_year_balance').values(rows).execute();
      await logActivity(tx, a, { module: 'GL', action: 'PRIOR_YEAR', docNo: acc.account_no, table: 'gl_prior_year_balance', rowId: acc.id, detail: { fiscal_year: y.prior.code, department_id: dept, before, rows: rows.length } });
      const closing = closingOf({ opening: d(b.opening.debit).minus(d(b.opening.credit)), debit: b.periods.reduce((s, p) => s.plus(d(p.debit)), ZERO), credit: b.periods.reduce((s, p) => s.plus(d(p.credit)), ZERO) });
      return { fiscal_year_id: fyId, closing: closing.toFixed(2) };
    });
  });
}
