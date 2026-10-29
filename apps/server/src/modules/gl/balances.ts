import { sql } from 'kysely';
import { d, ZERO, Decimal } from '@buddy/core';
import type { Db } from '../../db.js';

/**
 * ยอดบัญชีคำนวณสดจากใบสำคัญทุกครั้ง (ไม่มียอดสะสมที่ต้อง "คำนวณใหม่" แบบ Express)
 * - บัญชีงบดุล (หมวด 1–3): ยอดยกมา = ยอดยกมาต้นปีแรก (gl_balance.opening) + รายการทั้งหมดก่อนวันเริ่ม
 * - บัญชีกำไรขาดทุน (หมวด 4 ขึ้นไป): นับเฉพาะในปีบัญชี
 * - กำไร(ขาดทุน)ของปีก่อน ๆ ปิดเข้าบัญชีกำไรสะสม (บทบาท RETAINED_EARNINGS) โดยอัตโนมัติ — แทนการ "ประมวลผลสิ้นปี" (คู่มือบทที่ 22)
 * - ยอดปีที่แล้วที่ป้อนเอง (gl_prior_year_balance) นับเฉพาะเมื่อช่วงที่คำนวณอยู่ในปีนั้น — ใช้ทำงบเปรียบเทียบ ไม่กระทบยอดปีปัจจุบัน
 */
export interface AccountRow {
  id: string; account_no: string; name_th: string; name_en: string | null; parent_id: string | null; level: number;
  account_group: string; is_control: boolean; normal_side: string; use_department: boolean; status: string;
}
export interface Totals { opening: Decimal; debit: Decimal; credit: Decimal }
export const closingOf = (t: Totals) => t.opening.plus(t.debit).minus(t.credit);
export const isPL = (group: string) => group >= '4';

export class Chart {
  readonly byId = new Map<string, AccountRow>();
  readonly byNo = new Map<string, AccountRow>();
  readonly children = new Map<string, string[]>();
  constructor(rows: AccountRow[]) {
    for (const r of rows) { this.byId.set(r.id, r); this.byNo.set(r.account_no, r); }
    for (const r of rows) if (r.parent_id && this.byId.has(r.parent_id)) {
      const a = this.children.get(r.parent_id) ?? []; a.push(r.id); this.children.set(r.parent_id, a);
    }
    for (const a of this.children.values()) a.sort((x, y) => this.byId.get(x)!.account_no.localeCompare(this.byId.get(y)!.account_no));
  }
  /** บัญชีนั้นและบัญชีย่อยทั้งหมด */
  family(id: string): string[] {
    const out: string[] = []; const st = [id];
    while (st.length) { const x = st.pop()!; out.push(x); for (const c of this.children.get(x) ?? []) st.push(c); }
    return out;
  }
  roots(): AccountRow[] { return [...this.byId.values()].filter((a) => !a.parent_id || !this.byId.has(a.parent_id)).sort((a, b) => a.account_no.localeCompare(b.account_no)); }
  /** ยอดตามด้านปกติของหมวดบัญชี: สินทรัพย์/ค่าใช้จ่าย = เดบิตเป็นบวก, หนี้สิน/ทุน/รายได้ = เครดิตเป็นบวก */
  natural(id: string, debitPositive: Decimal): Decimal {
    const g = this.byId.get(id)?.account_group ?? '1';
    return g === '1' || g >= '5' ? debitPositive : debitPositive.neg();
  }
}

export async function loadChart(db: Db, companyId: string): Promise<Chart> {
  const rows = await db.selectFrom('gl_account')
    .select(['id', 'account_no', 'name_th', 'name_en', 'parent_id', 'level', 'account_group', 'is_control', 'normal_side', 'use_department', 'status'])
    .where('company_id', '=', companyId).where('deleted_at', 'is', null).orderBy('account_no').execute();
  return new Chart(rows);
}

export async function fiscalYearOf(db: Db, companyId: string, date: string) {
  return db.selectFrom('gl_fiscal_year').select(['id', 'code', 'start_date', 'end_date', 'status'])
    .where('company_id', '=', companyId).where('deleted_at', 'is', null)
    .where('start_date', '<=', date).where('end_date', '>=', date)
    .orderBy('start_date', 'desc').executeTakeFirst();
}

export async function retainedEarningsLeaf(db: Db, companyId: string, chart: Chart): Promise<string | null> {
  const r = await db.selectFrom('gl_default_account').select('account_id').where('company_id', '=', companyId).where('role', '=', 'RETAINED_EARNINGS').where('deleted_at', 'is', null).executeTakeFirst();
  let id = r?.account_id ?? null;
  // ถ้าเป็นบัญชีคุม ใช้บัญชีย่อยตัวแรก
  while (id && chart.byId.get(id)?.is_control && chart.children.get(id)?.length) id = chart.children.get(id)![0]!;
  return id;
}

/** departmentIds: หลายแผนก (เช่นคอลัมน์แบบงบที่ใช้ wildcard ขาย*) — รายการว่าง = ไม่มีแผนกที่ตรง ได้ยอดศูนย์ */
export interface BalanceFilter { branchId?: string | null; departmentId?: string | null; departmentIds?: string[] | null }
const NO_DEPT = '00000000-0000-0000-0000-000000000000';
export const deptCsv = (f: BalanceFilter) => (f.departmentIds ? (f.departmentIds.length ? f.departmentIds.join(',') : NO_DEPT) : f.departmentId ?? null);

/**
 * ยอดยกมา/เดบิต/เครดิต ของบัญชีย่อยทุกบัญชีในช่วง [from, to]
 * ยอดยกมาคิดตามกฎปิดบัญชีสิ้นปีข้างบน (ใช้ปีบัญชีที่มีวัน from)
 */
export async function leafTotals(db: Db, companyId: string, chart: Chart, from: string, to: string, f: BalanceFilter = {}): Promise<Map<string, Totals>> {
  const fy = await fiscalYearOf(db, companyId, from);
  const fyStart = fy?.start_date ?? from;
  const branch = f.branchId ?? null, dept = deptCsv(f);
  const rows = await sql<{ account_id: string; pl: boolean; op_bs: string; op_fy: string; prior: string; debit: string; credit: string }>`
    WITH mv AS (
      SELECT l.account_id, j.voucher_date AS d, l.debit, l.credit
        FROM gl_journal j JOIN gl_journal_line l ON l.journal_id = j.id AND l.deleted_at IS NULL
       WHERE j.company_id = ${companyId} AND j.doc_status = 'N' AND j.deleted_at IS NULL AND j.voucher_date <= ${to}::date
         AND (${branch}::uuid IS NULL OR j.branch_id = ${branch}::uuid)
         AND (${dept}::text IS NULL OR l.department_id = ANY(string_to_array(${dept}::text, ',')::uuid[]))
      UNION ALL
      SELECT b.account_id, (p.start_date - 1) AS d, GREATEST(b.opening, 0), GREATEST(-b.opening, 0)
        FROM gl_balance b JOIN gl_period p ON p.id = b.period_id
       WHERE b.company_id = ${companyId} AND b.deleted_at IS NULL AND b.opening <> 0 AND ${branch}::uuid IS NULL
         AND p.start_date <= ${to}::date
         AND (${dept}::text IS NULL OR b.department_id = ANY(string_to_array(${dept}::text, ',')::uuid[]))
      UNION ALL
      -- ยอดปีที่แล้วที่ป้อนเอง (S-GL-16): ใช้เฉพาะเมื่อคำนวณภายในปีนั้น ไม่ยกไปปีถัดไป (ยอดยกมาปีถัดไปมาจากหน้ายอดยกมา)
      SELECT x.account_id, x.d, x.debit, x.credit FROM (
        SELECT pb.account_id, CASE WHEN pb.period_no = 0 THEN y.start_date - 1 ELSE pp.end_date END AS d, pb.debit, pb.credit
          FROM gl_prior_year_balance pb JOIN gl_fiscal_year y ON y.id = pb.fiscal_year_id
          LEFT JOIN gl_period pp ON pp.fiscal_year_id = pb.fiscal_year_id AND pp.period_no = pb.period_no AND pp.deleted_at IS NULL
         WHERE pb.company_id = ${companyId} AND pb.deleted_at IS NULL AND pb.fiscal_year_id = ${fy?.id ?? null}::uuid AND ${branch}::uuid IS NULL
           AND (${dept}::text IS NULL OR pb.department_id = ANY(string_to_array(${dept}::text, ',')::uuid[]))) x
       WHERE x.d <= ${to}::date
    )
    SELECT mv.account_id, (a.account_group >= '4') AS pl,
           COALESCE(SUM(mv.debit - mv.credit) FILTER (WHERE mv.d < ${from}::date), 0) AS op_bs,
           COALESCE(SUM(mv.debit - mv.credit) FILTER (WHERE mv.d < ${from}::date AND mv.d >= ${fyStart}::date), 0) AS op_fy,
           COALESCE(SUM(mv.debit - mv.credit) FILTER (WHERE mv.d < ${fyStart}::date), 0) AS prior,
           COALESCE(SUM(mv.debit) FILTER (WHERE mv.d >= ${from}::date), 0) AS debit,
           COALESCE(SUM(mv.credit) FILTER (WHERE mv.d >= ${from}::date), 0) AS credit
      FROM mv JOIN gl_account a ON a.id = mv.account_id
     GROUP BY mv.account_id, a.account_group`.execute(db);
  const out = new Map<string, Totals>();
  let priorPL = ZERO;
  for (const r of rows.rows) {
    out.set(r.account_id, { opening: d(r.pl ? r.op_fy : r.op_bs), debit: d(r.debit), credit: d(r.credit) });
    if (r.pl) priorPL = priorPL.plus(d(r.prior));
  }
  if (!priorPL.isZero()) {
    const re = await retainedEarningsLeaf(db, companyId, chart);
    if (re) {
      const t = out.get(re) ?? { opening: ZERO, debit: ZERO, credit: ZERO };
      out.set(re, { ...t, opening: t.opening.plus(priorPL) });
    }
  }
  return out;
}

/** รวมยอดบัญชีย่อยขึ้นไปที่บัญชีคุมทุกระดับ */
export function rollUp(chart: Chart, leaf: Map<string, Totals>): Map<string, Totals> {
  const out = new Map<string, Totals>();
  for (const [id, t] of leaf) {
    let cur: string | null | undefined = id;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const x = out.get(cur) ?? { opening: ZERO, debit: ZERO, credit: ZERO };
      out.set(cur, { opening: x.opening.plus(t.opening), debit: x.debit.plus(t.debit), credit: x.credit.plus(t.credit) });
      cur = chart.byId.get(cur)?.parent_id;
    }
  }
  return out;
}
