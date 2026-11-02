import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { calcPay, d, daysInMonth, GL_ROLES, payrollJournal, round2, sum, type PaidMonth, type PayLineInput, type SameMonth } from '@buddy/core';
import type { Db } from '../../db.js';
import { badRequest, conflict, notFound, parse, requireCompany } from '../../http.js';
import { logActivity } from '../../audit.js';
import { branchOf } from '../docs/payments.js';
import { checkAccount } from '../parties.js';
import { checkLines, createJournal, periodFor } from '../gl/journals.js';
import { voidJournal } from '../cheques.js';
import { loadChartTemplate } from '../../company-template.js';
import { empName, isoDate, money, optMoney, optStr, payItems, payLaw, paySettings, salarySteps, uuid, type Ctx, type PayItemRow } from './master.js';

const gone = (a: Ctx) => ({ deleted_at: sql`now()` as never, updated_by: a.userId });
const jsonb = (v: unknown) => sql`${JSON.stringify(v)}::jsonb` as never;
export const RUN_STATUS_TH: Record<string, string> = { D: 'ร่าง', N: 'บันทึกแล้ว', P: 'จ่ายแล้ว', C: 'ยกเลิก' };
const firstOfMonth = (iso: string) => `${iso.slice(0, 7)}-01`;
const endOfMonthIso = (iso: string) => `${iso.slice(0, 7)}-${String(daysInMonth(+iso.slice(0, 4), +iso.slice(5, 7))).padStart(2, '0')}`;

export type Run = { id: string; doc_no: string | null; run_type: string; branch_id: string | null; period_from: string; period_to: string; pay_date: string; tax_month: string; status: string;
  journal_id: string | null; pay_journal_id: string | null; pay_account_id: string | null; paid_date: string | null; note: string | null };
export async function loadRun(db: Db, a: Ctx, id: string, lock = false): Promise<Run> {
  let q = db.selectFrom('pay_run').select(['id', 'doc_no', 'run_type', 'branch_id', 'period_from', 'period_to', 'pay_date', 'tax_month', 'status', 'journal_id', 'pay_journal_id', 'pay_account_id', 'paid_date', 'note'])
    .where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null);
  if (lock) q = q.forUpdate();
  const r = await q.executeTakeFirst();
  if (!r) throw notFound('รอบเงินเดือน');
  return { ...r, period_from: String(r.period_from).slice(0, 10), period_to: String(r.period_to).slice(0, 10), pay_date: String(r.pay_date).slice(0, 10), tax_month: String(r.tax_month).slice(0, 10), paid_date: r.paid_date ? String(r.paid_date).slice(0, 10) : null };
}
/** เดือนภาษีที่ยื่น ภ.ง.ด.1 หรือประกันสังคมแล้ว (ยังไม่ยกเลิก) — แก้/ยกเลิก/ลบรอบเงินเดือนของเดือนนั้นไม่ได้ */
export async function assertNotFiled(db: Db, companyId: string, taxMonth: string) {
  const f = await db.selectFrom('pay_filing').select(['form', 'filed_date']).where('company_id', '=', companyId).where('period', '=', taxMonth).where('status', '=', 'A')
    .where('form', 'in', ['PND1', 'SSO']).where('deleted_at', 'is', null).executeTakeFirst();
  if (f) throw badRequest(`เดือนนี้ยื่น${f.form === 'PND1' ? ' ภ.ง.ด.1 ' : 'ประกันสังคม'}แล้ว — แก้/ยกเลิกรอบเงินเดือนไม่ได้ (ถ้าต้องแก้: ยกเลิกการยื่นที่ เงินเดือน › ภาษีและประกันสังคม › การยื่น/นำส่ง แล้วยื่นใหม่ หรือทำรอบเพิ่มเติมแล้วยื่นเพิ่มเติม)`);
}
export const mustDraft = (r: Run) => {
  if (r.status !== 'D') throw badRequest(`รอบเงินเดือน ${r.doc_no ?? ''} ${RUN_STATUS_TH[r.status]} — กด "แก้ไข" (เปิดกลับเป็นร่าง) ก่อนจึงแก้ได้`.replace('  ', ' '));
};

/** พนักงานของสาขา (ว่าง = สำนักงานใหญ่) ที่ทำงานอยู่ในงวด */
async function employeesFor(db: Db, a: Ctx, r: Run) {
  const hq = (await db.selectFrom('sys_branch').select('is_head_office').where('id', '=', r.branch_id ?? '00000000-0000-0000-0000-000000000000').executeTakeFirst())?.is_head_office ?? true;
  return db.selectFrom('pay_employee').select(['id']).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).where('status', '=', 'A')
    .where('hire_date', '<=', r.period_to).where((eb) => eb.or([eb('end_date', 'is', null), eb('end_date', '>=', r.period_from)]))
    .where((eb) => (hq ? eb.or([eb('branch_id', 'is', null), eb('branch_id', '=', r.branch_id)]) : eb('branch_id', '=', r.branch_id))).orderBy('code').execute();
}

/** ยอดรายเดือนก่อนเดือนนี้ของปีเดียวกัน (ทุกรอบที่ไม่ยกเลิก รวมร่าง) + ยอดยกมาต้นปี */
async function priorMonths(db: Db, companyId: string, employeeId: string, taxMonth: string) {
  const y = taxMonth.slice(0, 4);
  const rows = (await sql<{ m: string; regular: string; special: string; tax: string; tax_special: string; sso: string; pvd: string }>`
    SELECT r.tax_month::text AS m, sum(re.regular) AS regular, sum(re.special) AS special, sum(re.tax) AS tax, sum(re.tax_special) AS tax_special, sum(re.sso_ee) AS sso, sum(re.pvd_ee) AS pvd
      FROM pay_run_employee re JOIN pay_run r ON r.id = re.run_id
     WHERE re.company_id = ${companyId} AND re.employee_id = ${employeeId} AND re.deleted_at IS NULL AND r.deleted_at IS NULL AND r.status <> 'C'
       AND r.tax_month >= ${`${y}-01-01`} AND r.tax_month < ${taxMonth} GROUP BY r.tax_month ORDER BY r.tax_month`.execute(db)).rows;
  const ytd = await db.selectFrom('pay_ytd_opening').selectAll().where('company_id', '=', companyId).where('employee_id', '=', employeeId).where('tax_year', '=', Number(y)).where('deleted_at', 'is', null).executeTakeFirst();
  const month = Number(taxMonth.slice(5, 7));
  const prior: PaidMonth[] = [];
  const covered = new Set(rows.map((r) => Number(r.m.slice(5, 7))));
  if (ytd && ytd.through_month < month) {
    prior.push({ regular: ytd.regular, special: ytd.special, tax: ytd.tax, special_tax: ytd.special_tax, sso: ytd.sso, pvd: ytd.pvd });
    for (let k = 1; k <= ytd.through_month; k++) covered.add(k);
  }
  for (const r of rows) prior.push({ regular: r.regular, special: r.special, tax: r.tax, special_tax: r.tax_special, sso: r.sso, pvd: r.pvd });
  return { prior, covered };
}
/** รอบอื่นในเดือนภาษีเดียวกัน (ไม่ยกเลิก) */
async function sameMonth(db: Db, companyId: string, employeeId: string, runId: string, taxMonth: string): Promise<SameMonth> {
  const r = (await sql<SameMonth>`SELECT coalesce(sum(re.regular),0) AS regular, coalesce(sum(re.special),0) AS special, coalesce(sum(re.sso_wage),0) AS sso_wage, coalesce(sum(re.sso_ee),0) AS sso_ee,
      coalesce(sum(re.sso_er),0) AS sso_er, coalesce(sum(re.pvd_ee),0) AS pvd, coalesce(sum(re.tax),0) AS tax, coalesce(sum(re.tax_special),0) AS tax_special
      FROM pay_run_employee re JOIN pay_run r ON r.id = re.run_id
     WHERE re.company_id = ${companyId} AND re.employee_id = ${employeeId} AND re.run_id <> ${runId} AND re.deleted_at IS NULL AND r.deleted_at IS NULL AND r.status <> 'C' AND r.tax_month = ${taxMonth}`.execute(db)).rows[0]!;
  return r;
}

/** คิดเงินเดือนพนักงานหนึ่งคนในรอบ แล้วเขียนยอด/บรรทัดใหม่ (บรรทัดที่ป้อนเองคงไว้) */
export async function calcEmployee(tx: Db, a: Ctx, run: Run, reId: string, ctx: { items: PayItemRow[]; law: Awaited<ReturnType<typeof payLaw>>; settings: Awaited<ReturnType<typeof paySettings>> }) {
  const re = await tx.selectFrom('pay_run_employee').selectAll().where('id', '=', reId).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirstOrThrow();
  const e = await tx.selectFrom('pay_employee').selectAll().where('id', '=', re.employee_id).where('company_id', '=', a.companyId).executeTakeFirstOrThrow();
  const steps = (await salarySteps(tx, a.companyId, [e.id])).get(e.id) ?? [];
  const year = Number(run.pay_date.slice(0, 4));
  const allowances = ((await tx.selectFrom('pay_allowance').select('allowance_values').where('employee_id', '=', e.id).where('company_id', '=', a.companyId).where('tax_year', '=', year).where('deleted_at', 'is', null).executeTakeFirst())?.allowance_values ?? {}) as Record<string, string | number | boolean>;
  const byId = new Map(ctx.items.map((x) => [x.id, x]));
  const sys = (c: string) => ctx.items.find((x) => x.system_code === c);
  const wage = sys('WAGE');
  if (!wage) throw badRequest('ไม่พบรายการเงินเดือน (IN001) — เปิดเมนู เงินเดือน › รายการเงินได้/เงินหัก แล้วลองใหม่');
  const kept = await tx.selectFrom('pay_run_line').select(['item_id', 'qty', 'amount', 'source', 'note']).where('run_employee_id', '=', re.id).where('deleted_at', 'is', null).where('source', 'in', ['MANUAL', 'IMPORT']).orderBy('sort_order').execute();
  const lines: PayLineInput[] = kept.filter((l) => byId.has(l.item_id) && byId.get(l.item_id)!.calc !== 'WAGE' && byId.get(l.item_id)!.calc !== 'SYSTEM')
    .map((l) => ({ item: byId.get(l.item_id)!, qty: l.qty, amount: l.amount, source: l.source as 'MANUAL' | 'IMPORT', note: l.note }));
  if (run.run_type === 'R') {
    const rec = await tx.selectFrom('pay_recurring').select(['item_id', 'amount', 'note']).where('employee_id', '=', e.id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null)
      .where('from_month', '<=', firstOfMonth(run.period_to)).where((eb) => eb.or([eb('to_month', 'is', null), eb('to_month', '>=', firstOfMonth(run.period_from))])).execute();
    for (const r of rec) { const it = byId.get(r.item_id); if (it && it.status === 'A') lines.unshift({ item: it, amount: r.amount, source: 'RECUR', note: r.note }); }
  }
  const { prior, covered } = await priorMonths(tx, a.companyId, e.id, run.tax_month);
  const same = await sameMonth(tx, a.companyId, e.id, run.id, run.tax_month);
  const hire = String(e.hire_date).slice(0, 10), end = e.end_date ? String(e.end_date).slice(0, 10) : null;
  const out = calcPay({
    rules: ctx.law.rules, sso: ctx.law.ssoOn(run.pay_date), settings: ctx.settings, run_type: run.run_type === 'B' ? 'B' : 'R',
    period_from: run.period_from, period_to: run.period_to, pay_date: run.pay_date,
    employee: { hire_date: hire, end_date: end, tax_bearer: e.tax_bearer as 'W', sso_insured: e.sso_insured, pvd_member: ctx.settings.use_pvd && e.pvd_member, pvd_employee_rate: e.pvd_employee_rate, pvd_employer_rate: e.pvd_employer_rate, allowances },
    salary: steps, wage_item: wage, system_items: { TAX: sys('TAX'), SSO: sys('SSO'), PVD: sys('PVD') },
    salary_manual: re.salary_manual, work_days: re.work_days, work_hours: re.work_hours, lines, prior, same_month: same, tax_manual: re.tax_manual,
  });
  // เดือนก่อนหน้าในปีที่ไม่มีรอบ/ยอดยกมา → ภาษีจะต่ำไป (เตือน)
  const m = Number(run.tax_month.slice(5, 7));
  const missing: number[] = [];
  for (let k = out.calc.start_month; k < m; k++) if (!covered.has(k)) missing.push(k);
  await tx.updateTable('pay_run_line').set(gone(a)).where('run_employee_id', '=', re.id).where('deleted_at', 'is', null).execute();
  for (const [i, l] of out.lines.entries())
    await tx.insertInto('pay_run_line').values({ company_id: a.companyId, run_id: run.id, run_employee_id: re.id, item_id: l.item_id, qty: l.qty, rate: l.rate, multiplier: l.multiplier, amount: l.amount, source: l.source, note: l.note?.slice(0, 200) ?? null, sort_order: i, created_by: a.userId }).execute();
  await tx.updateTable('pay_run_employee').set({
    department_id: e.department_id, wage_type: steps.at(-1)?.wage_type ?? e.wage_type, tax_bearer: e.tax_bearer,
    regular: out.regular.toFixed(2), special: out.special.toFixed(2), non_taxable: out.non_taxable.toFixed(2), gross: out.gross.toFixed(2), sso_wage: out.sso_wage.toFixed(2), sso_ee: out.sso_ee.toFixed(2), sso_er: out.sso_er.toFixed(2),
    pvd_base: out.pvd_base.toFixed(2), pvd_ee: out.pvd_ee.toFixed(2), pvd_er: out.pvd_er.toFixed(2), tax: out.tax.toFixed(2), tax_special: out.tax_special.toFixed(2), employer_paid_tax: out.employer_paid_tax.toFixed(2),
    other_deductions: out.other_deductions.toFixed(2), net_pay: out.net_pay.toFixed(2), tax_calc: jsonb({ ...out.calc, missing_months: missing, law_year: ctx.law.lawYear }), updated_by: a.userId,
  }).where('id', '=', re.id).execute();
}
export async function calcCtx(db: Db, a: Ctx, run: Run) {
  return { items: await payItems(db, a.companyId), law: await payLaw(db, a.companyId, Number(run.pay_date.slice(0, 4))), settings: await paySettings(db, a.companyId) };
}
export async function totals(tx: Db, a: Ctx, runId: string) {
  const t = (await sql<Record<string, string>>`SELECT count(*)::int AS headcount, coalesce(sum(gross),0) AS gross, coalesce(sum(tax),0) AS tax, coalesce(sum(sso_ee),0) AS sso_ee, coalesce(sum(sso_er),0) AS sso_er,
      coalesce(sum(pvd_ee),0) AS pvd_ee, coalesce(sum(pvd_er),0) AS pvd_er, coalesce(sum(other_deductions),0) AS ded, coalesce(sum(net_pay),0) AS net
      FROM pay_run_employee WHERE run_id = ${runId} AND company_id = ${a.companyId} AND deleted_at IS NULL`.execute(tx)).rows[0]!;
  await tx.updateTable('pay_run').set({ headcount: Number(t.headcount), total_gross: t.gross!, total_tax: t.tax!, total_sso_ee: t.sso_ee!, total_sso_er: t.sso_er!, total_pvd_ee: t.pvd_ee!, total_pvd_er: t.pvd_er!,
    total_deductions: t.ded!, total_net: t.net!, calculated_at: sql`now()` as never, updated_by: a.userId }).where('id', '=', runId).execute();
}
async function recalcAll(tx: Db, a: Ctx, run: Run) {
  const c = await calcCtx(tx, a, run);
  const res = await tx.selectFrom('pay_run_employee as re').innerJoin('pay_employee as e', 'e.id', 're.employee_id').select('re.id').where('re.run_id', '=', run.id).where('re.company_id', '=', a.companyId).where('re.deleted_at', 'is', null).orderBy('e.code').execute();
  for (const r of res) await calcEmployee(tx, a, run, r.id, c);
  await totals(tx, a, run.id);
}

// ---------------------------------------------------------------- ใบสำคัญ
/** เลขที่รอบเงินเดือน PY + ปี 2 หลัก (ตามระบบปีของบริษัท) + เดือนที่จ่าย + ลำดับ 4 หลัก เช่น PY69010001 */
async function runDocNo(tx: Db, companyId: string, payDate: string) { return nextPayNo(tx, companyId, 'PY', payDate); }
/** เลขที่ระบบเงินเดือน: ตัวนำ + ปี 2 หลัก (ตามระบบปีของบริษัท) + เดือน + ลำดับ 4 หลัก — ไม่ซ้ำกับเลขที่ใบสำคัญที่มีอยู่ */
export async function nextPayNo(tx: Db, companyId: string, lead: string, payDate: string) {
  const co = await tx.selectFrom('sys_company').select('year_system').where('id', '=', companyId).executeTakeFirstOrThrow();
  const y = Number(payDate.slice(0, 4)) + (co.year_system === 'B' ? 543 : 0);
  const prefix = `${lead}${String(y).slice(-2)}${payDate.slice(5, 7)}`;
  const max = (await sql<{ v: string | null }>`SELECT max(v) AS v FROM (SELECT doc_no AS v FROM pay_run WHERE company_id = ${companyId} AND doc_no LIKE ${prefix + '%'}
      UNION ALL SELECT voucher_no FROM gl_journal WHERE company_id = ${companyId} AND voucher_no LIKE ${prefix + '%'}) x WHERE length(v) = ${prefix.length + 4}`.execute(tx)).rows[0]?.v;
  return prefix + String((max ? Number(max.slice(-4)) || 0 : 0) + 1).padStart(4, '0');
}
export async function bookFor(db: Db, companyId: string, kind: 'PAYROLL' | 'PAYROLL_PAY') {
  const r = await db.selectFrom('gl_journal_route').select('journal_book_id').where('company_id', '=', companyId).where('txn_kind', '=', kind).where('deleted_at', 'is', null).executeTakeFirst();
  const b = r?.journal_book_id ?? (await db.selectFrom('gl_journal_book').select('id').where('company_id', '=', companyId).where('code', '=', '00').where('deleted_at', 'is', null).executeTakeFirst())?.id
    ?? (await db.selectFrom('gl_journal_book').select('id').where('company_id', '=', companyId).where('deleted_at', 'is', null).orderBy('code').executeTakeFirst())?.id;
  if (!b) throw badRequest('ไม่พบสมุดรายวันสำหรับลงบัญชีเงินเดือน — สร้างสมุดรายวันทั่วไป (00) ก่อน หรือกำหนดที่ เริ่มระบบ › การเชื่อมต่อบัญชี › สมุดรายวัน');
  return b;
}
const ROLE_LABEL = new Map(GL_ROLES.map((r) => [r.role, r.label]));
/** บรรทัดใบสำคัญเงินเดือนพร้อมเลขที่บัญชี — บทบาทที่ยังไม่กำหนดบัญชี = แจ้งให้กำหนด (ไม่ลงบัญชีพัก) */
async function runPosting(db: Db, a: Ctx, run: Run) {
  const items = new Map((await payItems(db, a.companyId)).map((x) => [x.id, x]));
  const res = await db.selectFrom('pay_run_employee').select(['id', 'department_id', 'tax', 'employer_paid_tax', 'sso_ee', 'sso_er', 'pvd_ee', 'pvd_er', 'net_pay']).where('run_id', '=', run.id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).execute();
  const lines = await db.selectFrom('pay_run_line').select(['run_employee_id', 'item_id', 'amount']).where('run_id', '=', run.id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).execute();
  const emps = res.map((e) => ({ ...e, lines: lines.filter((l) => l.run_employee_id === e.id).map((l) => { const it = items.get(l.item_id)!; return { amount: l.amount, kind: it.kind, sign: it.sign, gl_role: it.gl_role, account_id: it.account_id, system_code: it.system_code }; }) }));
  const pl = payrollJournal(emps);
  const roles = await db.selectFrom('gl_default_account').select(['role', 'account_id']).where('company_id', '=', a.companyId).where('role', 'like', 'PAY_%').where('deleted_at', 'is', null).execute();
  const roleAcc = new Map(roles.map((r) => [r.role, r.account_id]));
  const out = pl.map((l) => ({ ...l, account_id: l.account_id ?? roleAcc.get(l.role) ?? null }));
  const missing = [...new Set(out.filter((l) => !l.account_id).map((l) => l.role))];
  const ids = [...new Set(out.map((l) => l.account_id).filter((x): x is string => !!x))];
  const accs = ids.length ? await db.selectFrom('gl_account').select(['id', 'account_no', 'name_th']).where('company_id', '=', a.companyId).where('id', 'in', ids).execute() : [];
  const deps = await db.selectFrom('md_department').select(['id', 'code']).where('company_id', '=', a.companyId).execute();
  return {
    lines: out.map((l) => ({ ...l, role_label: ROLE_LABEL.get(l.role) ?? l.role, account_no: accs.find((x) => x.id === l.account_id)?.account_no ?? null, account_name: accs.find((x) => x.id === l.account_id)?.name_th ?? null, department_code: deps.find((x) => x.id === l.department_id)?.code ?? null })),
    missing: missing.map((r) => ({ role: r, label: ROLE_LABEL.get(r) ?? r })),
    debit: round2(sum(out.map((l) => l.debit))).toFixed(2), credit: round2(sum(out.map((l) => l.credit))).toFixed(2),
  };
}
/** เขียนใบสำคัญ: ใบใหม่ (createJournal) หรือใบเดิมเลขเดิม (บรรทัดเก่าเก็บเป็นประวัติ) */
export async function writeJournal(tx: Db, a: Ctx, existing: string | null, head: { book: string; no: string; date: string; desc: string; branch: string | null }, lines: Array<{ account_id: string; department_id: string | null; debit: string; credit: string; role?: string }>) {
  const jl = lines.map((l) => ({ account_id: l.account_id, department_id: l.department_id, debit: l.debit, credit: l.credit, description: head.desc.slice(0, 200) }));
  if (!existing) return (await createJournal(tx, { companyId: a.companyId, userId: a.userId, branchId: head.branch }, { journal_book_id: head.book, voucher_no: head.no, voucher_date: head.date, description: head.desc, reference: head.no, branch_id: head.branch, lines: jl as never }, '4', { sourceModule: 'PAY' })).id;
  const p = await periodFor(tx, a.companyId, head.date);
  await checkLines(tx, a.companyId, jl as never);
  const total = round2(sum(lines.map((l) => l.debit))).toFixed(2);
  await tx.updateTable('gl_journal_line').set(gone(a)).where('journal_id', '=', existing).where('deleted_at', 'is', null).execute();
  await tx.updateTable('gl_journal').set({ journal_book_id: head.book, voucher_date: head.date, period_id: p.id, description: head.desc.slice(0, 200), reference: head.no, branch_id: head.branch,
    doc_status: 'N', status: 'P', posted_by: a.userId, posted_at: sql`now()` as never, total_debit: total, total_credit: total, updated_by: a.userId }).where('id', '=', existing).execute();
  let n = 0;
  for (const l of lines) await tx.insertInto('gl_journal_line').values({ company_id: a.companyId, journal_id: existing, line_no: ++n, account_id: l.account_id, department_id: l.department_id, description: head.desc.slice(0, 200), debit: l.debit, credit: l.credit, posting_role: l.role ?? null, created_by: a.userId }).execute();
  await logActivity(tx, a, { module: 'GL', action: 'EDIT', docNo: head.no, table: 'gl_journal', rowId: existing, detail: { source: 'PAY' } });
  return existing;
}
const runDesc = (r: Run, no: string) => `${r.run_type === 'B' ? 'เงินได้เพิ่มเติม' : 'เงินเดือน'} ${no} งวด ${r.period_from} ถึง ${r.period_to}`;

// ---------------------------------------------------------------- รายละเอียดรอบ
async function runDetail(db: Db, a: Ctx, id: string) {
  const run = await loadRun(db, a, id);
  const res = await db.selectFrom('pay_run_employee as re').innerJoin('pay_employee as e', 'e.id', 're.employee_id').leftJoin('md_department as dp', 'dp.id', 're.department_id')
    .select(['re.id', 're.employee_id', 'e.code', 'e.title', 'e.first_name', 'e.last_name', 'e.position', 'e.hire_date', 'e.end_date', 'dp.code as department_code', 're.wage_type', 're.tax_bearer', 're.work_days', 're.work_hours',
      're.salary_manual', 're.salary_manual_reason', 're.tax_manual', 're.regular', 're.special', 're.non_taxable', 're.gross', 're.sso_wage', 're.sso_ee', 're.sso_er', 're.pvd_base', 're.pvd_ee', 're.pvd_er',
      're.tax', 're.tax_special', 're.employer_paid_tax', 're.other_deductions', 're.net_pay', 're.tax_calc'])
    .where('re.run_id', '=', id).where('re.company_id', '=', a.companyId).where('re.deleted_at', 'is', null).orderBy('e.code').execute();
  const lines = await db.selectFrom('pay_run_line as l').innerJoin('pay_item as i', 'i.id', 'l.item_id')
    .select(['l.id', 'l.run_employee_id', 'l.item_id', 'i.code', 'i.name_th', 'i.kind', 'i.calc', 'i.sign', 'l.qty', 'l.rate', 'l.multiplier', 'l.amount', 'l.source', 'l.note'])
    .where('l.run_id', '=', id).where('l.company_id', '=', a.companyId).where('l.deleted_at', 'is', null).orderBy('l.sort_order').execute();
  const h = await db.selectFrom('pay_run').select(['headcount', 'total_gross', 'total_tax', 'total_sso_ee', 'total_sso_er', 'total_pvd_ee', 'total_pvd_er', 'total_deductions', 'total_net', 'calculated_at', 'cancel_reason']).where('id', '=', id).executeTakeFirstOrThrow();
  const branch = run.branch_id ? await db.selectFrom('sys_branch').select(['code', 'name']).where('id', '=', run.branch_id).executeTakeFirst() : null;
  const jn = async (jid: string | null) => (jid ? (await db.selectFrom('gl_journal').select(['voucher_no', 'doc_status']).where('id', '=', jid).executeTakeFirst()) ?? null : null);
  const warnings: string[] = [];
  for (const e of res) {
    const c = e.tax_calc as { missing_months?: number[]; law_year?: number | null; over_withheld?: string } | null;
    if (c?.missing_months?.length) warnings.push(`${e.code} ${empName(e)}: ยังไม่มีเงินเดือนเดือนที่ ${c.missing_months.join(', ')} ของปีนี้ — ภาษีจะต่ำไป (ป้อนยอดยกมาต้นปีที่ทะเบียนพนักงาน)`);
    if (d(e.net_pay).lt(0)) warnings.push(`${e.code} ${empName(e)}: เงินได้สุทธิติดลบ — ลดรายการหัก`);
    if (c?.over_withheld && d(c.over_withheld).gt(0)) warnings.push(`${e.code} ${empName(e)}: ภาษีที่หักทั้งปีเกินภาษีที่ต้องเสีย ${c.over_withheld} บาท`);
  }
  const lawYear = (res[0]?.tax_calc as { law_year?: number | null } | null)?.law_year;
  if (lawYear && lawYear !== Number(run.pay_date.slice(0, 4))) warnings.unshift(`ยังไม่มีอัตราภาษีของปี ${Number(run.pay_date.slice(0, 4)) + 543} ในโปรแกรม — ใช้อัตราปี ${lawYear + 543} (ตรวจที่ เงินเดือน › อัตราภาษีและประกันสังคม)`);
  return { ...run, ...h, status_th: RUN_STATUS_TH[run.status], branch_code: branch?.code ?? null, branch_name: branch?.name ?? null, journal: await jn(run.journal_id), pay_journal: await jn(run.pay_journal_id),
    employees: res.map((e) => ({ ...e, name: empName(e), lines: lines.filter((l) => l.run_employee_id === e.id) })), warnings };
}

const runBody = z.object({
  run_type: z.enum(['R', 'B']).default('R'),
  /** เดือนของงวด YYYY-MM */
  month: z.string().regex(/^\d{4}-\d{2}$/, 'เลือกเดือน'),
  pay_date: isoDate.nullable().optional(), branch_id: uuid.nullable().optional(), note: optStr(200),
});
const empInputBody = z.object({
  work_days: optMoney, work_hours: optMoney, salary_manual: optMoney, salary_manual_reason: optStr(200), tax_manual: optMoney,
  lines: z.array(z.object({ item_id: uuid, qty: optMoney, amount: optMoney, note: optStr(200) })).max(200).default([]),
});
const reasonBody = z.object({ reason: z.string().trim().min(1, 'ป้อนเหตุผล').max(200) });

export function payrollRunRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/v1/pay/runs', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() }), req.query);
    let s = db.selectFrom('pay_run as r').leftJoin('sys_branch as b', 'b.id', 'r.branch_id')
      .select(['r.id', 'r.doc_no', 'r.run_type', 'r.period_from', 'r.period_to', 'r.pay_date', 'r.tax_month', 'r.status', 'r.headcount', 'r.total_gross', 'r.total_tax', 'r.total_sso_ee', 'r.total_sso_er', 'r.total_net', 'r.note', 'b.code as branch_code', 'b.name as branch_name'])
      .where('r.company_id', '=', a.companyId).where('r.deleted_at', 'is', null);
    if (q.year) s = s.where('r.tax_month', '>=', `${q.year}-01-01`).where('r.tax_month', '<=', `${q.year}-12-01`);
    if (a.branchId) s = s.where('r.branch_id', '=', a.branchId);
    return (await s.orderBy('r.tax_month', 'desc').orderBy('r.created_at', 'desc').limit(1000).execute()).map((r) => ({ ...r, status_th: RUN_STATUS_TH[r.status] }));
  });
  app.get('/api/v1/pay/runs/:id', async (req) => runDetail(db, requireCompany(req), parse(z.object({ id: uuid }), req.params).id));

  app.post('/api/v1/pay/runs', async (req) => {
    const a = requireCompany(req);
    const b = parse(runBody, req.body);
    const from = `${b.month}-01`, to = endOfMonthIso(from);
    const payDate = b.pay_date ?? to;
    if (payDate < from) throw badRequest('วันที่จ่ายต้องไม่ก่อนวันแรกของงวด', [{ field: 'pay_date', message: 'ตรวจวันที่' }]);
    const branch = await branchOf(db, a, b.branch_id ?? null);
    await periodFor(db, a.companyId, payDate);
    if (b.run_type === 'R') {
      const dup = await db.selectFrom('pay_run').select(['doc_no', 'status']).where('company_id', '=', a.companyId).where('run_type', '=', 'R').where('period_from', '=', from).where('status', '<>', 'C')
        .where('branch_id', '=', branch).where('deleted_at', 'is', null).executeTakeFirst();
      if (dup) throw conflict(`มีรอบเงินเดือนปกติของเดือนนี้แล้ว (${dup.doc_no ?? 'ร่าง'}) — เปิดรอบเดิม หรือสร้าง "รอบเพิ่มเติม/โบนัส"`);
    }
    return db.transaction().execute(async (tx) => {
      const id = (await tx.insertInto('pay_run').values({ company_id: a.companyId, run_type: b.run_type, branch_id: branch, period_from: from, period_to: to, pay_date: payDate, tax_month: firstOfMonth(payDate), status: 'D', note: b.note, created_by: a.userId, updated_by: a.userId })
        .returning('id').executeTakeFirstOrThrow()).id;
      const run = await loadRun(tx, a, id);
      // รอบโบนัส: เริ่มว่าง (เลือกพนักงานเอง) · รอบปกติ: พนักงานทุกคนของสาขาที่ทำงานอยู่ในงวด
      const emps = b.run_type === 'R' ? await employeesFor(tx, a, run) : [];
      for (const e of emps) await tx.insertInto('pay_run_employee').values({ company_id: a.companyId, run_id: id, employee_id: e.id, created_by: a.userId }).execute();
      await recalcAll(tx, a, run);
      await logActivity(tx, a, { module: 'PAY', action: 'ADD', docNo: `ร่าง ${b.month}`, table: 'pay_run', rowId: id, detail: { run_type: b.run_type, pay_date: payDate, employees: emps.length } });
      return { id };
    });
  });
  app.put('/api/v1/pay/runs/:id', async (req) => {
    const a = requireCompany(req);
    const id = parse(z.object({ id: uuid }), req.params).id;
    const b = parse(z.object({ pay_date: isoDate, note: optStr(200) }), req.body);
    return db.transaction().execute(async (tx) => {
      const run = await loadRun(tx, a, id, true);
      mustDraft(run);
      if (b.pay_date < run.period_from) throw badRequest('วันที่จ่ายต้องไม่ก่อนวันแรกของงวด', [{ field: 'pay_date', message: 'ตรวจวันที่' }]);
      await periodFor(tx, a.companyId, b.pay_date);
      await tx.updateTable('pay_run').set({ pay_date: b.pay_date, tax_month: firstOfMonth(b.pay_date), note: b.note, updated_by: a.userId }).where('id', '=', id).execute();
      await recalcAll(tx, a, await loadRun(tx, a, id));
      await logActivity(tx, a, { module: 'PAY', action: 'EDIT', docNo: run.doc_no, table: 'pay_run', rowId: id, detail: { before: { pay_date: run.pay_date, note: run.note } } });
      return { ok: true };
    });
  });
  app.post('/api/v1/pay/runs/:id/calculate', async (req) => {
    const a = requireCompany(req);
    const id = parse(z.object({ id: uuid }), req.params).id;
    return db.transaction().execute(async (tx) => {
      const run = await loadRun(tx, a, id, true);
      mustDraft(run);
      await recalcAll(tx, a, run);
      return { ok: true };
    });
  });
  app.post('/api/v1/pay/runs/:id/employees', async (req) => {
    const a = requireCompany(req);
    const id = parse(z.object({ id: uuid }), req.params).id;
    const b = parse(z.object({ employee_ids: z.array(uuid).min(1).max(5000) }), req.body);
    return db.transaction().execute(async (tx) => {
      const run = await loadRun(tx, a, id, true);
      mustDraft(run);
      const emps = await tx.selectFrom('pay_employee').select(['id', 'code', 'hire_date']).where('company_id', '=', a.companyId).where('id', 'in', b.employee_ids).where('deleted_at', 'is', null).execute();
      if (emps.length !== new Set(b.employee_ids).size) throw badRequest('ไม่พบพนักงานบางคน — เลือกใหม่');
      const late = emps.find((e) => String(e.hire_date).slice(0, 10) > run.period_to);
      if (late) throw badRequest(`พนักงาน ${late.code} เริ่มงานหลังงวดนี้`);
      const have = new Set((await tx.selectFrom('pay_run_employee').select('employee_id').where('run_id', '=', id).where('deleted_at', 'is', null).execute()).map((r) => r.employee_id));
      const c = await calcCtx(tx, a, run);
      for (const e of emps.filter((x) => !have.has(x.id))) {
        const reId = (await tx.insertInto('pay_run_employee').values({ company_id: a.companyId, run_id: id, employee_id: e.id, created_by: a.userId }).returning('id').executeTakeFirstOrThrow()).id;
        await calcEmployee(tx, a, run, reId, c);
      }
      await totals(tx, a, id);
      return { ok: true };
    });
  });
  app.delete('/api/v1/pay/runs/:id/employees/:reId', async (req) => {
    const a = requireCompany(req);
    const p = parse(z.object({ id: uuid, reId: uuid }), req.params);
    return db.transaction().execute(async (tx) => {
      const run = await loadRun(tx, a, p.id, true);
      mustDraft(run);
      const r = await tx.updateTable('pay_run_employee').set(gone(a)).where('id', '=', p.reId).where('run_id', '=', p.id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
      if (!Number(r.numUpdatedRows)) throw notFound('พนักงานในรอบ');
      await tx.updateTable('pay_run_line').set(gone(a)).where('run_employee_id', '=', p.reId).where('deleted_at', 'is', null).execute();
      await totals(tx, a, p.id);
      return { ok: true };
    });
  });
  app.put('/api/v1/pay/runs/:id/employees/:reId', async (req) => {
    const a = requireCompany(req);
    const p = parse(z.object({ id: uuid, reId: uuid }), req.params);
    const b = parse(empInputBody, req.body);
    return db.transaction().execute(async (tx) => {
      const run = await loadRun(tx, a, p.id, true);
      mustDraft(run);
      const re = await tx.selectFrom('pay_run_employee').select(['id', 'employee_id']).where('id', '=', p.reId).where('run_id', '=', p.id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
      if (!re) throw notFound('พนักงานในรอบ');
      if (b.salary_manual != null && !b.salary_manual_reason) throw badRequest('ป้อนเหตุผลที่แก้เงินเดือนเอง (เก็บเป็นหลักฐาน)', [{ field: 'salary_manual_reason', message: 'ป้อนเหตุผล' }]);
      const items = new Map((await payItems(tx, a.companyId)).map((x) => [x.id, x]));
      for (const [i, l] of b.lines.entries()) {
        const it = items.get(l.item_id);
        if (!it) throw badRequest(`บรรทัดที่ ${i + 1}: ไม่พบรายการนี้`, [{ field: 'item_id', line: i, message: 'เลือกรายการ' }]);
        if (it.calc === 'WAGE' || it.calc === 'SYSTEM') throw badRequest(`บรรทัดที่ ${i + 1}: ${it.name_th} โปรแกรมคิดให้ — แก้เงินเดือนที่ช่อง "เงินเดือนป้อนเอง" ภาษีที่ช่อง "ภาษีป้อนเอง"`, [{ field: 'item_id', line: i, message: 'รายการของโปรแกรม' }]);
        const isQty = it.calc === 'HOURS' || it.calc === 'DAYS' || it.calc === 'MINUTES';
        if (isQty ? l.qty == null || d(l.qty).lt(0) : l.amount == null || d(l.amount).lt(0)) throw badRequest(`บรรทัดที่ ${i + 1}: ${it.name_th} ป้อน${isQty ? 'จำนวน' : 'จำนวนเงิน'} (ไม่ติดลบ)`, [{ field: isQty ? 'qty' : 'amount', line: i, message: 'ป้อนตัวเลข' }]);
      }
      await tx.updateTable('pay_run_employee').set({ work_days: b.work_days, work_hours: b.work_hours, salary_manual: b.salary_manual, salary_manual_reason: b.salary_manual != null ? b.salary_manual_reason : null, tax_manual: b.tax_manual, updated_by: a.userId }).where('id', '=', re.id).execute();
      await tx.updateTable('pay_run_line').set(gone(a)).where('run_employee_id', '=', re.id).where('source', 'in', ['MANUAL', 'IMPORT']).where('deleted_at', 'is', null).execute();
      for (const [i, l] of b.lines.entries()) {
        const it = items.get(l.item_id)!;
        const isQty = it.calc === 'HOURS' || it.calc === 'DAYS' || it.calc === 'MINUTES';
        await tx.insertInto('pay_run_line').values({ company_id: a.companyId, run_id: run.id, run_employee_id: re.id, item_id: l.item_id, qty: isQty ? l.qty : null, amount: isQty ? '0' : d(l.amount).toFixed(2), source: 'MANUAL', note: l.note, sort_order: 100 + i, created_by: a.userId }).execute();
      }
      await calcEmployee(tx, a, run, re.id, await calcCtx(tx, a, run));
      await totals(tx, a, run.id);
      return { ok: true };
    });
  });

  /** บทบาทบัญชีเงินเดือนที่ยังว่าง → บัญชีของบริษัทที่เลขที่และชื่อตรงกับผังตัวอย่าง ไทย–อังกฤษ (ไม่ทับที่กำหนดไว้แล้ว) */
  app.post('/api/v1/pay/default-accounts', async (req) => {
    const a = requireCompany(req);
    const t = await loadChartTemplate('th_en');
    const name = new Map(t.accounts.map((x) => [x.no, x.th]));
    return db.transaction().execute(async (tx) => {
      const have = new Set((await tx.selectFrom('gl_default_account').select('role').where('company_id', '=', a.companyId).where('role', 'like', 'PAY_%').where('deleted_at', 'is', null).execute()).map((r) => r.role));
      const accs = await tx.selectFrom('gl_account').select(['id', 'account_no', 'name_th']).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).where('is_control', '=', false).where('status', '=', 'A').execute();
      const filled: Array<{ role: string; account_no: string }> = [], missing: string[] = [];
      for (const r of GL_ROLES.filter((x) => x.role.startsWith('PAY_') && !have.has(x.role))) {
        const no = t.default_roles[r.role];
        const acc = no ? accs.find((x) => x.account_no === no && x.name_th.trim() === (name.get(no) ?? '').trim()) : undefined;
        if (!acc) { missing.push(r.label); continue; }
        await tx.insertInto('gl_default_account').values({ company_id: a.companyId, role: r.role, account_id: acc.id, created_by: a.userId }).execute();
        filled.push({ role: r.label, account_no: acc.account_no });
      }
      if (filled.length) await logActivity(tx, a, { module: 'SET', action: 'EDIT', docNo: 'การเชื่อมต่อบัญชี (เงินเดือน)', table: 'gl_default_account', detail: { filled } });
      return { filled, missing };
    });
  });
  app.get('/api/v1/pay/runs/:id/posting-preview', async (req) => {
    const a = requireCompany(req);
    return runPosting(db, a, await loadRun(db, a, parse(z.object({ id: uuid }), req.params).id));
  });
  /** บันทึก = ออกเลขที่ + ลงบัญชีตั้งค้างจ่ายในทรานแซกชันเดียว */
  app.post('/api/v1/pay/runs/:id/post', async (req) => {
    const a = requireCompany(req);
    const id = parse(z.object({ id: uuid }), req.params).id;
    return db.transaction().execute(async (tx) => {
      const run = await loadRun(tx, a, id, true);
      mustDraft(run);
      await recalcAll(tx, a, run);
      const det = await runDetail(tx, a, id);
      if (!det.employees.length) throw badRequest('รอบนี้ยังไม่มีพนักงาน — เพิ่มพนักงานก่อนบันทึก');
      const neg = det.employees.find((e) => d(e.net_pay).lt(0));
      if (neg) throw badRequest(`${neg.code} ${neg.name}: เงินได้สุทธิติดลบ ${neg.net_pay} — ลดรายการหักก่อนบันทึก`);
      const pv = await runPosting(tx, a, run);
      if (pv.missing.length) throw badRequest(`ลงบัญชีเงินเดือนไม่ได้: ยังไม่ได้กำหนดบัญชี ${pv.missing.map((m) => m.label).join(', ')} — กำหนดที่ เริ่มระบบ › การเชื่อมต่อบัญชี (หมวด "เงินเดือน") หรือที่รายการเงินได้/เงินหัก`);
      if (pv.debit !== pv.credit) throw badRequest(`ใบสำคัญเงินเดือนไม่ดุล (Dr ${pv.debit} / Cr ${pv.credit}) — คำนวณใหม่แล้วลองอีกครั้ง`);
      const no = run.doc_no ?? (await runDocNo(tx, a.companyId, run.pay_date));
      const jid = pv.lines.length ? await writeJournal(tx, a, run.journal_id, { book: await bookFor(tx, a.companyId, 'PAYROLL'), no, date: run.pay_date, desc: runDesc(run, no), branch: run.branch_id }, pv.lines.map((l) => ({ ...l, account_id: l.account_id! }))) : null;
      await tx.updateTable('pay_run').set({ status: 'N', doc_no: no, journal_id: jid, updated_by: a.userId }).where('id', '=', id).execute();
      await logActivity(tx, a, { module: 'PAY', action: 'POST', docNo: no, table: 'pay_run', rowId: id, detail: { gross: det.total_gross, tax: det.total_tax, net: det.total_net, headcount: det.headcount } });
      return { ok: true, doc_no: no, journal_id: jid };
    });
  });
  /** แก้ไขรอบที่บันทึกแล้ว: เปิดกลับเป็นร่าง ใบสำคัญเดิมเป็นสถานะยกเลิก (บันทึกใหม่ = ใบเดิมเลขเดิม) */
  app.post('/api/v1/pay/runs/:id/reopen', async (req) => {
    const a = requireCompany(req);
    const id = parse(z.object({ id: uuid }), req.params).id;
    const b = parse(reasonBody, req.body);
    return db.transaction().execute(async (tx) => {
      const run = await loadRun(tx, a, id, true);
      await assertNotFiled(tx, a.companyId, run.tax_month);
      if (run.status === 'P') throw badRequest(`รอบ ${run.doc_no} จ่ายเงินแล้ว — ยกเลิกการจ่ายก่อนจึงแก้ไขได้`);
      if (run.status !== 'N') throw badRequest(`รอบนี้${RUN_STATUS_TH[run.status]} แก้ไขไม่ได้`);
      await voidJournal(tx, a, run.journal_id, `แก้ไขรอบเงินเดือน: ${b.reason}`);
      await tx.updateTable('pay_run').set({ status: 'D', updated_by: a.userId }).where('id', '=', id).execute();
      await logActivity(tx, a, { module: 'PAY', action: 'REOPEN', docNo: run.doc_no, table: 'pay_run', rowId: id, detail: { reason: b.reason } });
      return { ok: true };
    });
  });
  /** จ่ายเงินเดือน: Dr เงินเดือนค้างจ่าย / Cr เงินสด-เงินฝาก (ใบสำคัญ PA…) */
  app.post('/api/v1/pay/runs/:id/pay', async (req) => {
    const a = requireCompany(req);
    const id = parse(z.object({ id: uuid }), req.params).id;
    const b = parse(z.object({ paid_date: isoDate, account_id: uuid }), req.body);
    return db.transaction().execute(async (tx) => {
      const run = await loadRun(tx, a, id, true);
      if (run.status !== 'N') throw badRequest(run.status === 'D' ? 'บันทึกรอบเงินเดือนก่อน แล้วจึงจ่าย' : `รอบนี้${RUN_STATUS_TH[run.status]}`);
      await checkAccount(tx, a.companyId, b.account_id, 'account_id');
      const accrued = (await tx.selectFrom('gl_default_account').select('account_id').where('company_id', '=', a.companyId).where('role', '=', 'PAY_ACCRUED').where('deleted_at', 'is', null).executeTakeFirst())?.account_id;
      if (!accrued) throw badRequest('ยังไม่ได้กำหนดบัญชีเงินเดือนค้างจ่าย — กำหนดที่ เริ่มระบบ › การเชื่อมต่อบัญชี (หมวด "เงินเดือน")');
      if (b.account_id === accrued) throw badRequest('เลือกบัญชีเงินสด/เงินฝากที่จ่ายเงิน (ไม่ใช่บัญชีเงินเดือนค้างจ่าย)', [{ field: 'account_id', message: 'เลือกบัญชีที่จ่าย' }]);
      if (b.paid_date < run.period_from) throw badRequest('วันที่จ่ายต้องไม่ก่อนงวดเงินเดือน', [{ field: 'paid_date', message: 'ตรวจวันที่' }]);
      const net = (await tx.selectFrom('pay_run').select('total_net').where('id', '=', id).executeTakeFirstOrThrow()).total_net;
      let jid: string | null = null;
      if (d(net).gt(0)) {
        const no = `PA${run.doc_no!.slice(2)}`;
        jid = await writeJournal(tx, a, run.pay_journal_id, { book: await bookFor(tx, a.companyId, 'PAYROLL_PAY'), no, date: b.paid_date, desc: `จ่ายเงินเดือน ${run.doc_no}`, branch: run.branch_id },
          [{ account_id: accrued, department_id: null, debit: d(net).toFixed(2), credit: '0.00', role: 'PAY_ACCRUED' }, { account_id: b.account_id, department_id: null, debit: '0.00', credit: d(net).toFixed(2) }]);
      }
      await tx.updateTable('pay_run').set({ status: 'P', paid_date: b.paid_date, pay_account_id: b.account_id, pay_journal_id: jid, updated_by: a.userId }).where('id', '=', id).execute();
      await logActivity(tx, a, { module: 'PAY', action: 'PAY', docNo: run.doc_no, table: 'pay_run', rowId: id, detail: { paid_date: b.paid_date, amount: net } });
      return { ok: true };
    });
  });
  app.post('/api/v1/pay/runs/:id/unpay', async (req) => {
    const a = requireCompany(req);
    const id = parse(z.object({ id: uuid }), req.params).id;
    const b = parse(reasonBody, req.body);
    return db.transaction().execute(async (tx) => {
      const run = await loadRun(tx, a, id, true);
      if (run.status !== 'P') throw badRequest('รอบนี้ยังไม่ได้จ่ายเงิน');
      await voidJournal(tx, a, run.pay_journal_id, `ยกเลิกการจ่ายเงินเดือน: ${b.reason}`);
      await tx.updateTable('pay_run').set({ status: 'N', updated_by: a.userId }).where('id', '=', id).execute();
      await logActivity(tx, a, { module: 'PAY', action: 'UNPAY', docNo: run.doc_no, table: 'pay_run', rowId: id, detail: { reason: b.reason } });
      return { ok: true };
    });
  });
  /** ยกเลิก = สถานะ C (ไม่ลบ) ใบสำคัญยกเลิกตาม · จ่ายแล้วต้องยกเลิกการจ่ายก่อน */
  app.post('/api/v1/pay/runs/:id/cancel', async (req) => {
    const a = requireCompany(req);
    const id = parse(z.object({ id: uuid }), req.params).id;
    const b = parse(reasonBody, req.body);
    return db.transaction().execute(async (tx) => {
      const run = await loadRun(tx, a, id, true);
      await assertNotFiled(tx, a.companyId, run.tax_month);
      if (run.status === 'C') throw badRequest('รอบนี้ถูกยกเลิกแล้ว');
      if (run.status === 'P') throw badRequest(`รอบ ${run.doc_no} จ่ายเงินแล้ว — ยกเลิกการจ่ายก่อนจึงยกเลิกรอบได้`);
      if (run.status === 'D' && !run.doc_no) throw badRequest('รอบร่างที่ยังไม่เคยบันทึก ลบได้เลยโดยไม่ต้องยกเลิก');
      await voidJournal(tx, a, run.journal_id, `ยกเลิกรอบเงินเดือน: ${b.reason}`);
      await tx.updateTable('pay_run').set({ status: 'C', cancel_reason: b.reason, updated_by: a.userId }).where('id', '=', id).execute();
      await logActivity(tx, a, { module: 'PAY', action: 'CANCEL', docNo: run.doc_no, table: 'pay_run', rowId: id, detail: { reason: b.reason } });
      return { ok: true };
    });
  });
  /** ลบ: ร่างที่ยังไม่เคยบันทึก หรือรอบที่ยกเลิกแล้ว (deleted_at ทั้งชุด รวมใบสำคัญ — เลขที่ว่างให้ใช้ใหม่) */
  app.delete('/api/v1/pay/runs/:id', async (req) => {
    const a = requireCompany(req);
    const id = parse(z.object({ id: uuid }), req.params).id;
    return db.transaction().execute(async (tx) => {
      const run = await loadRun(tx, a, id, true);
      if (run.status !== 'D') await assertNotFiled(tx, a.companyId, run.tax_month);
      if (!(run.status === 'C' || (run.status === 'D' && !run.doc_no))) throw badRequest(run.doc_no ? `ยกเลิกรอบ ${run.doc_no} ก่อนจึงลบได้` : 'ลบได้เฉพาะรอบร่างหรือรอบที่ยกเลิกแล้ว');
      for (const jid of [run.journal_id, run.pay_journal_id].filter((x): x is string => !!x)) {
        const j = await tx.selectFrom('gl_journal').select(['voucher_date', 'doc_status']).where('id', '=', jid).executeTakeFirst();
        if (j && j.doc_status !== 'C') throw badRequest('ใบสำคัญของรอบนี้ยังไม่ถูกยกเลิก');
        if (j) await periodFor(tx, a.companyId, String(j.voucher_date).slice(0, 10));
        await tx.updateTable('gl_journal_line').set(gone(a)).where('journal_id', '=', jid).where('deleted_at', 'is', null).execute();
        await tx.updateTable('gl_journal').set(gone(a)).where('id', '=', jid).execute();
      }
      for (const t of ['pay_run_line', 'pay_run_employee'] as const) await tx.updateTable(t).set(gone(a)).where('run_id', '=', id).where('deleted_at', 'is', null).execute();
      await tx.updateTable('pay_run').set(gone(a)).where('id', '=', id).execute();
      await logActivity(tx, a, { module: 'PAY', action: 'DELETE', docNo: run.doc_no ?? `ร่าง ${run.period_from.slice(0, 7)}`, table: 'pay_run', rowId: id });
      return { ok: true };
    });
  });
}
