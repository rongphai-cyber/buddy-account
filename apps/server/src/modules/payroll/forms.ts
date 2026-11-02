import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { addressProblem, d, payWht50, pnd1Rows, round2, ssoForm, thaiAddress, w50IssueDate, ZERO, type PayTotals, type TaxBearer } from '@buddy/core';
import type { Db } from '../../db.js';
import { badRequest, notFound, parse, requireCompany } from '../../http.js';
import { logActivity } from '../../audit.js';
import { empName, payLaw, payItems, paySettings, uuid, type Ctx } from './master.js';

/**
 * แบบฟอร์มและรายงานระบบเงินเดือน (ระยะ 2): สลิป · ภ.ง.ด.1 / 1ก · 50 ทวิ ประจำปี · สปส.1-10 · ทะเบียนเงินเดือน · สรุปรายปี · ค่าใช้จ่ายตามแผนก
 * ยอดจากรอบที่บันทึกแล้ว (N/P) เท่านั้น — ร่างแจ้งเตือน · ปีภาษี/เดือนภาษี = เดือนที่จ่าย
 */
const monthQ = z.string().regex(/^\d{4}-\d{2}$/, 'เลือกเดือน');
const yearQ = z.coerce.number().int().min(2000).max(2100);
const optUuid = uuid.optional().or(z.literal('').transform(() => undefined));
type Totals = PayTotals & { employee_id: string; gross: string; non_taxable: string; sso_wage: string; sso_er: string; pvd_er: string; net_pay: string; other_deductions: string; pay_date: string };

/** ยอดรวมรายพนักงานจากรอบที่บันทึกแล้วในช่วงเดือนภาษี [from, to] (วันที่ 1 ของเดือน) */
export async function totalsBy(db: Db, companyId: string, from: string, to: string, branchId?: string) {
  return (await sql<Totals>`SELECT re.employee_id, sum(re.regular) AS regular, sum(re.special) AS special, sum(re.employer_paid_tax) AS employer_paid_tax, sum(re.tax) AS tax,
      sum(re.sso_ee) AS sso_ee, sum(re.sso_er) AS sso_er, sum(re.sso_wage) AS sso_wage, sum(re.pvd_ee) AS pvd_ee, sum(re.pvd_er) AS pvd_er, sum(re.gross) AS gross, sum(re.non_taxable) AS non_taxable,
      sum(re.net_pay) AS net_pay, sum(re.other_deductions) AS other_deductions, max(r.pay_date)::text AS pay_date
      FROM pay_run_employee re JOIN pay_run r ON r.id = re.run_id
     WHERE re.company_id = ${companyId} AND re.deleted_at IS NULL AND r.deleted_at IS NULL AND r.status IN ('N','P') AND r.tax_month BETWEEN ${from} AND ${to}
       ${branchId ? sql`AND r.branch_id = ${branchId}` : sql``}
     GROUP BY re.employee_id`.execute(db)).rows;
}
export async function draftCount(db: Db, companyId: string, from: string, to: string, branchId?: string) {
  let q = db.selectFrom('pay_run').select(sql<number>`count(*)::int`.as('n')).where('company_id', '=', companyId).where('deleted_at', 'is', null).where('status', '=', 'D').where('tax_month', '>=', from).where('tax_month', '<=', to);
  if (branchId) q = q.where('branch_id', '=', branchId);
  return Number((await q.executeTakeFirst())?.n ?? 0);
}
export async function employees(db: Db, companyId: string, ids: string[]) {
  if (!ids.length) return [];
  return db.selectFrom('pay_employee as e').leftJoin('md_department as dp', 'dp.id', 'e.department_id')
    .select(['e.id', 'e.code', 'e.title', 'e.first_name', 'e.last_name', 'e.tax_id', 'e.tax_bearer', 'e.position', 'e.end_date', 'e.hire_date', 'e.department_id', 'dp.code as department_code', 'dp.name_th as department_name',
      'e.reg_house_no', 'e.reg_moo', 'e.reg_village', 'e.reg_building', 'e.reg_soi', 'e.reg_road', 'e.reg_subdistrict', 'e.reg_district', 'e.reg_province', 'e.reg_postcode', 'e.bank_account_no', 'e.pay_method'])
    .where('e.company_id', '=', companyId).where('e.id', 'in', ids).execute();
}
export type Emp = Awaited<ReturnType<typeof employees>>[number];
export const addrOf = (e: Emp) => ({ house_no: e.reg_house_no, moo: e.reg_moo, village: e.reg_village, building: e.reg_building, soi: e.reg_soi, road: e.reg_road, subdistrict: e.reg_subdistrict, district: e.reg_district, province: e.reg_province, postcode: e.reg_postcode });
const mask = (v: string | null | undefined) => (v ? `•••${v.slice(-4)}` : null);

/** ผู้จ่ายเงิน (บริษัท + สาขาที่ยื่น) */
export async function payer(db: Db, companyId: string, branchId?: string) {
  const c = await db.selectFrom('sys_company').select(['name_th', 'address_th', 'tax_id', 'social_security_no', 'phone']).where('id', '=', companyId).executeTakeFirstOrThrow();
  const b = branchId ? await db.selectFrom('sys_branch').select(['code', 'name', 'tax_branch_no', 'is_head_office']).where('id', '=', branchId).where('company_id', '=', companyId).executeTakeFirst() : null;
  if (branchId && !b) throw notFound('สาขา');
  const s = await paySettings(db, companyId);
  return { name: c.name_th, address: (c.address_th ?? '').replace(/\n/g, ' '), tax_id: c.tax_id, branch_no: b?.tax_branch_no ?? '00000', branch_name: b ? (b.is_head_office ? 'สำนักงานใหญ่' : b.name) : 'ทุกสาขา',
    phone: c.phone, sso_employer_no: s.sso_employer_no || c.social_security_no || '', sso_branch_no: s.sso_branch_no };
}
/** ยอดยกมาต้นปีของพนักงาน (นับในเงินได้ทั้งปี 1ก / 50 ทวิ) */
async function openings(db: Db, companyId: string, year: number) {
  return db.selectFrom('pay_ytd_opening').select(['employee_id', 'regular', 'special', 'tax', 'sso', 'pvd']).where('company_id', '=', companyId).where('tax_year', '=', year).where('deleted_at', 'is', null).execute();
}
/** ยอดทั้งปี = รอบที่บันทึกแล้ว + ยอดยกมา */
export async function yearTotals(db: Db, companyId: string, year: number, branchId?: string) {
  const t = await totalsBy(db, companyId, `${year}-01-01`, `${year}-12-01`, branchId);
  const m = new Map(t.map((x) => [x.employee_id, { ...x }]));
  if (!branchId) for (const o of await openings(db, companyId, year)) {
    const x = m.get(o.employee_id) ?? { employee_id: o.employee_id, regular: '0', special: '0', employer_paid_tax: '0', tax: '0', sso_ee: '0', pvd_ee: '0', sso_er: '0', sso_wage: '0', pvd_er: '0', gross: '0', non_taxable: '0', net_pay: '0', other_deductions: '0', pay_date: `${year}-01-01` };
    m.set(o.employee_id, { ...x, regular: d(x.regular).plus(o.regular).toFixed(2), special: d(x.special).plus(o.special).toFixed(2), tax: d(x.tax).plus(o.tax).toFixed(2), sso_ee: d(x.sso_ee).plus(o.sso).toFixed(2), pvd_ee: d(x.pvd_ee).plus(o.pvd).toFixed(2) });
  }
  return [...m.values()];
}
export const endOfMonth = (ym: string) => { const [y, m] = ym.split('-').map(Number); return `${ym}-${String(new Date(Date.UTC(y!, m!, 0)).getUTCDate()).padStart(2, '0')}`; };

export function payrollFormRoutes(app: FastifyInstance, db: Db) {
  // ---- สลิปเงินเดือน (ทั้งรอบ หรือรายคน ?re=)
  app.get('/api/v1/pay/runs/:id/slips', async (req) => {
    const a = requireCompany(req);
    const id = parse(z.object({ id: uuid }), req.params).id;
    const q = parse(z.object({ re: optUuid }), req.query);
    const run = await db.selectFrom('pay_run').select(['id', 'doc_no', 'run_type', 'period_from', 'period_to', 'pay_date', 'tax_month', 'status', 'branch_id', 'created_at']).where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!run) throw notFound('รอบเงินเดือน');
    const tm = String(run.tax_month).slice(0, 10), y = tm.slice(0, 4);
    let reQ = db.selectFrom('pay_run_employee').selectAll().where('run_id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null);
    if (q.re) reQ = reQ.where('id', '=', q.re);
    const res = await reQ.execute();
    const emps = new Map((await employees(db, a.companyId, res.map((r) => r.employee_id))).map((e) => [e.id, e]));
    const lines = await db.selectFrom('pay_run_line as l').innerJoin('pay_item as i', 'i.id', 'l.item_id').select(['l.run_employee_id', 'i.code', 'i.name_th', 'i.name_en', 'i.kind', 'i.sign', 'i.system_code', 'l.qty', 'l.amount', 'l.note'])
      .where('l.run_id', '=', id).where('l.company_id', '=', a.companyId).where('l.deleted_at', 'is', null).orderBy('l.sort_order').execute();
    // ยอดสะสมทั้งปีถึงเดือนนี้: รอบที่บันทึกแล้ว (รวมรอบนี้แม้เป็นร่าง) + ยอดยกมา
    const ytd = (await sql<{ employee_id: string; income: string; tax: string; sso: string; pvd: string }>`SELECT re.employee_id, sum(re.regular + re.special) AS income, sum(re.tax) AS tax, sum(re.sso_ee) AS sso, sum(re.pvd_ee) AS pvd
        FROM pay_run_employee re JOIN pay_run r ON r.id = re.run_id
       WHERE re.company_id = ${a.companyId} AND re.deleted_at IS NULL AND r.deleted_at IS NULL AND (r.status IN ('N','P') OR r.id = ${id})
         AND r.tax_month BETWEEN ${`${y}-01-01`} AND ${tm} GROUP BY re.employee_id`.execute(db)).rows;
    const ops = await openings(db, a.companyId, Number(y));
    const p = await payer(db, a.companyId);
    const images = (await sql<{ kind: string; mime: string; data: string }>`SELECT kind, mime, data FROM sys_company_image WHERE company_id = ${a.companyId} AND kind = 'LOGO' AND deleted_at IS NULL LIMIT 1`.execute(db)).rows;
    const slips = res.map((r) => {
      const e = emps.get(r.employee_id)!;
      const y1 = ytd.find((x) => x.employee_id === r.employee_id), o = ops.find((x) => x.employee_id === r.employee_id);
      const ls = lines.filter((l) => l.run_employee_id === r.id);
      return {
        run_employee_id: r.id, code: e.code, name: empName(e), position: e.position, department: e.department_name, tax_id: mask(e.tax_id), bank_account: e.pay_method === 'B' ? mask(e.bank_account_no) : null,
        earnings: ls.filter((l) => l.kind === 'E').map((l) => ({ name: l.name_th, name_en: l.name_en, qty: l.qty, amount: d(l.amount).times(l.sign).toFixed(2), note: l.note })),
        deductions: ls.filter((l) => l.kind === 'D').map((l) => ({ name: l.name_th, name_en: l.name_en, amount: l.amount })),
        gross: r.gross, deductions_total: d(r.gross).minus(r.net_pay).toFixed(2), net_pay: r.net_pay, employer_paid_tax: r.employer_paid_tax, sso_er: r.sso_er, pvd_er: r.pvd_er,
        ytd: { income: d(y1?.income ?? 0).plus(o ? d(o.regular).plus(o.special) : ZERO).toFixed(2), tax: d(y1?.tax ?? 0).plus(o?.tax ?? 0).toFixed(2), sso: d(y1?.sso ?? 0).plus(o?.sso ?? 0).toFixed(2), pvd: d(y1?.pvd ?? 0).plus(o?.pvd ?? 0).toFixed(2) },
      };
    }).sort((x, y2) => x.code.localeCompare(y2.code));
    return { company: p, logo: images[0] ? `data:${images[0].mime};base64,${images[0].data}` : null, run: { ...run, period_from: String(run.period_from).slice(0, 10), period_to: String(run.period_to).slice(0, 10), pay_date: String(run.pay_date).slice(0, 10), draft: run.status === 'D' }, slips };
  });
  app.post('/api/v1/pay/runs/:id/slips/printed', async (req) => {
    const a = requireCompany(req);
    const id = parse(z.object({ id: uuid }), req.params).id;
    const run = await db.selectFrom('pay_run').select('doc_no').where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!run) throw notFound('รอบเงินเดือน');
    await logActivity(db, a, { module: 'PAY', action: 'PRINT', docNo: run.doc_no, table: 'pay_run', rowId: id, detail: { form: 'สลิปเงินเดือน', count: parse(z.object({ count: z.number().int().min(0).max(100000).default(0) }), req.body ?? {}).count } });
    return { ok: true };
  });

  // ---- ภ.ง.ด.1 รายเดือน
  app.get('/api/v1/pay/pnd1', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ month: monthQ, branch_id: optUuid, taxed_only: z.enum(['0', '1']).default('0') }), req.query);
    const from = `${q.month}-01`;
    const t = await totalsBy(db, a.companyId, from, from, q.branch_id);
    const emps = new Map((await employees(db, a.companyId, t.map((x) => x.employee_id))).map((e) => [e.id, e]));
    const r = pnd1Rows(t.map((x) => { const e = emps.get(x.employee_id)!; return { employee_id: e.id, code: e.code, title: e.title, first_name: e.first_name, last_name: e.last_name, tax_id: e.tax_id, bearer: e.tax_bearer as TaxBearer,
      pay_date: x.pay_date <= endOfMonth(q.month) ? x.pay_date : endOfMonth(q.month), totals: x }; }), { taxedOnly: q.taxed_only === '1' });
    return { month: q.month, payer: await payer(db, a.companyId, q.branch_id), ...r, drafts: await draftCount(db, a.companyId, from, from, q.branch_id) };
  });
  // ---- ภ.ง.ด.1ก ประจำปี (รวมยอดยกมา · ต้องมีที่อยู่ตามทะเบียนบ้าน)
  app.get('/api/v1/pay/pnd1a', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ year: yearQ, branch_id: optUuid }), req.query);
    const t = await yearTotals(db, a.companyId, q.year, q.branch_id);
    const emps = new Map((await employees(db, a.companyId, t.map((x) => x.employee_id))).map((e) => [e.id, e]));
    const r = pnd1Rows(t.map((x) => { const e = emps.get(x.employee_id)!; return { employee_id: e.id, code: e.code, title: e.title, first_name: e.first_name, last_name: e.last_name, tax_id: e.tax_id, bearer: e.tax_bearer as TaxBearer,
      pay_date: `${q.year}-12-31`, totals: x, address: thaiAddress(addrOf(e)) }; }));
    const rows = r.rows.map((x) => ({ ...x, problem: x.problem ?? addressProblem(addrOf(emps.get(x.employee_id)!)) }));
    return { year: q.year, payer: await payer(db, a.companyId, q.branch_id), ...r, rows, drafts: await draftCount(db, a.companyId, `${q.year}-01-01`, `${q.year}-12-01`, q.branch_id) };
  });

  // ---- 50 ทวิ ประจำปี: เลขที่ออกครั้งเดียวเก็บถาวร (เล่มที่ = ปี พ.ศ. · เลขที่ = ลำดับตามรหัสพนักงาน)
  const w50List = async (a: Ctx, year: number) => {
    const t = await yearTotals(db, a.companyId, year);
    const emps = new Map((await employees(db, a.companyId, t.map((x) => x.employee_id))).map((e) => [e.id, e]));
    const certs = await db.selectFrom('pay_wht_cert').select(['employee_id', 'book_no', 'run_no', 'issue_date', 'print_count']).where('company_id', '=', a.companyId).where('tax_year', '=', year).where('deleted_at', 'is', null).execute();
    const p = await payer(db, a.companyId);
    return t.map((x) => {
      const e = emps.get(x.employee_id)!;
      const c = certs.find((k) => k.employee_id === e.id);
      const issue = c ? String(c.issue_date).slice(0, 10) : w50IssueDate(year, e.end_date ? String(e.end_date).slice(0, 10) : null);
      const data = payWht50({ payer: { name: p.name, address: p.address, tax_id: p.tax_id, branch_no: p.branch_no }, payee: { name: empName(e), address: thaiAddress(addrOf(e)), tax_id: e.tax_id },
        book_no: c?.book_no ?? '', run_no: c ? String(c.run_no).padStart(3, '0') : '', issue_date: issue, totals: x, bearer: e.tax_bearer as TaxBearer });
      return { employee_id: e.id, code: e.code, name: empName(e), income: data.lines[0]!.amount, tax: data.lines[0]!.tax, sso: x.sso_ee, pvd: x.pvd_ee, issued: !!c, print_count: c?.print_count ?? 0,
        problem: !e.tax_id ? 'ไม่มีเลขประจำตัวประชาชน' : null, data };
    }).filter((r) => d(r.income).gt(0) || d(r.tax).gt(0)).sort((x, y) => x.code.localeCompare(y.code));
  };
  app.get('/api/v1/pay/w50', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ year: yearQ }), req.query);
    return { year: q.year, rows: await w50List(a, q.year), drafts: await draftCount(db, a.companyId, `${q.year}-01-01`, `${q.year}-12-01`) };
  });
  app.post('/api/v1/pay/w50/issue', async (req) => {
    const a = requireCompany(req);
    const b = parse(z.object({ year: yearQ }), req.body);
    const rows = (await w50List(a, b.year)).filter((r) => !r.issued);
    if (!rows.length) return { issued: 0 };
    const book = String(b.year + 543);
    return db.transaction().execute(async (tx) => {
      let n = Number((await tx.selectFrom('pay_wht_cert').select(sql<number>`coalesce(max(run_no), 0)`.as('m')).where('company_id', '=', a.companyId).where('book_no', '=', book).where('deleted_at', 'is', null).executeTakeFirst())?.m ?? 0);
      for (const r of rows) await tx.insertInto('pay_wht_cert').values({ company_id: a.companyId, employee_id: r.employee_id, tax_year: b.year, book_no: book, run_no: ++n, issue_date: r.data.issue_date, created_by: a.userId }).execute();
      await logActivity(tx, a, { module: 'PAY', action: 'W50_ISSUE', docNo: `50 ทวิ ปี ${book}`, table: 'pay_wht_cert', detail: { count: rows.length } });
      return { issued: rows.length };
    });
  });
  app.post('/api/v1/pay/w50/printed', async (req) => {
    const a = requireCompany(req);
    const b = parse(z.object({ year: yearQ, employee_ids: z.array(uuid).min(1).max(5000) }), req.body);
    const r = await db.updateTable('pay_wht_cert').set({ print_count: sql`print_count + 1` as never, last_printed_at: sql`now()` as never }).where('company_id', '=', a.companyId).where('tax_year', '=', b.year)
      .where('employee_id', 'in', b.employee_ids).where('deleted_at', 'is', null).executeTakeFirst();
    if (!Number(r.numUpdatedRows)) throw badRequest('ยังไม่ได้ออกเลขที่หนังสือรับรอง — กด "ออกเลขที่" ก่อนพิมพ์');
    await logActivity(db, a, { module: 'PAY', action: 'PRINT', docNo: `50 ทวิ ปี ${b.year + 543}`, table: 'pay_wht_cert', detail: { count: Number(r.numUpdatedRows) } });
    return { ok: true };
  });

  // ---- สปส.1-10
  app.get('/api/v1/pay/sso', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ month: monthQ, branch_id: optUuid }), req.query);
    const from = `${q.month}-01`;
    const t = (await totalsBy(db, a.companyId, from, from, q.branch_id)).filter((x) => d(x.sso_ee).gt(0) || d(x.sso_er).gt(0));
    const emps = new Map((await employees(db, a.companyId, t.map((x) => x.employee_id))).map((e) => [e.id, e]));
    const law = await payLaw(db, a.companyId, Number(q.month.slice(0, 4)));
    const f = ssoForm(t.map((x) => { const e = emps.get(x.employee_id)!; return { employee_id: e.id, code: e.code, title: e.title, first_name: e.first_name, last_name: e.last_name, tax_id: e.tax_id, wage: x.sso_wage, ee: x.sso_ee, er: x.sso_er }; }),
      law.ssoOn(endOfMonth(q.month)));
    return { month: q.month, payer: await payer(db, a.companyId, q.branch_id), ...f, drafts: await draftCount(db, a.companyId, from, from, q.branch_id) };
  });

  // ---- รายงาน
  app.get('/api/v1/pay/reports/register', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ month: monthQ, branch_id: optUuid }), req.query);
    const from = `${q.month}-01`;
    const rows = (await sql<{ employee_id: string; item_id: string; amount: string }>`SELECT re.employee_id, l.item_id, sum(l.amount * i.sign) AS amount
        FROM pay_run_line l JOIN pay_run_employee re ON re.id = l.run_employee_id JOIN pay_run r ON r.id = l.run_id JOIN pay_item i ON i.id = l.item_id
       WHERE l.company_id = ${a.companyId} AND l.deleted_at IS NULL AND re.deleted_at IS NULL AND r.deleted_at IS NULL AND r.status IN ('N','P') AND r.tax_month = ${from}
         ${q.branch_id ? sql`AND r.branch_id = ${q.branch_id}` : sql``} GROUP BY re.employee_id, l.item_id`.execute(db)).rows;
    const t = await totalsBy(db, a.companyId, from, from, q.branch_id);
    const emps = new Map((await employees(db, a.companyId, t.map((x) => x.employee_id))).map((e) => [e.id, e]));
    const items = (await payItems(db, a.companyId)).filter((i) => rows.some((r) => r.item_id === i.id));
    const cols = items.map((i) => ({ key: i.id, code: i.code, label: i.name_th, kind: i.kind, system_code: i.system_code }));
    const out = t.map((x) => { const e = emps.get(x.employee_id)!; return { code: e.code, name: empName(e), department: e.department_code, values: Object.fromEntries(cols.map((c) => [c.key, rows.find((r) => r.employee_id === x.employee_id && r.item_id === c.key)?.amount ?? null])),
      gross: x.gross, tax: x.tax, sso_ee: x.sso_ee, pvd_ee: x.pvd_ee, other: x.other_deductions, net: x.net_pay, sso_er: x.sso_er, pvd_er: x.pvd_er }; }).sort((x, y) => x.code.localeCompare(y.code));
    return { month: q.month, columns: cols, rows: out, drafts: await draftCount(db, a.companyId, from, from, q.branch_id) };
  });
  app.get('/api/v1/pay/reports/yearly', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ year: yearQ, measure: z.enum(['gross', 'tax', 'sso_ee', 'net_pay']).default('gross') }), req.query);
    const m = (await sql<{ employee_id: string; month: number; v: string }>`SELECT re.employee_id, extract(month FROM r.tax_month)::int AS month, sum(${sql.ref(`re.${q.measure}`)}) AS v
        FROM pay_run_employee re JOIN pay_run r ON r.id = re.run_id
       WHERE re.company_id = ${a.companyId} AND re.deleted_at IS NULL AND r.deleted_at IS NULL AND r.status IN ('N','P') AND r.tax_month BETWEEN ${`${q.year}-01-01`} AND ${`${q.year}-12-01`}
       GROUP BY re.employee_id, month`.execute(db)).rows;
    const ids = [...new Set(m.map((x) => x.employee_id))];
    const emps = await employees(db, a.companyId, ids);
    const rows = emps.map((e) => { const months = Array.from({ length: 12 }, (_, k) => m.find((x) => x.employee_id === e.id && x.month === k + 1)?.v ?? '0'); return { code: e.code, name: empName(e), months, total: months.reduce((s, v) => s.plus(v), ZERO).toFixed(2) }; })
      .sort((x, y) => x.code.localeCompare(y.code));
    return { year: q.year, measure: q.measure, rows, months: Array.from({ length: 12 }, (_, k) => rows.reduce((s, r) => s.plus(r.months[k]!), ZERO).toFixed(2)) };
  });
  app.get('/api/v1/pay/reports/cost', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ from: monthQ, to: monthQ }), req.query);
    if (q.to < q.from) throw badRequest('เดือนสิ้นสุดต้องไม่ก่อนเดือนเริ่ม');
    const r = (await sql<{ department_id: string | null; n: number; gross: string; sso_er: string; pvd_er: string; borne: string }>`SELECT re.department_id, count(DISTINCT re.employee_id)::int AS n, sum(re.gross) AS gross, sum(re.sso_er) AS sso_er, sum(re.pvd_er) AS pvd_er, sum(re.employer_paid_tax) AS borne
        FROM pay_run_employee re JOIN pay_run r ON r.id = re.run_id
       WHERE re.company_id = ${a.companyId} AND re.deleted_at IS NULL AND r.deleted_at IS NULL AND r.status IN ('N','P') AND r.tax_month BETWEEN ${`${q.from}-01`} AND ${`${q.to}-01`}
       GROUP BY re.department_id`.execute(db)).rows;
    const deps = await db.selectFrom('md_department').select(['id', 'code', 'name_th']).where('company_id', '=', a.companyId).execute();
    const rows = r.map((x) => { const dp = deps.find((k) => k.id === x.department_id); const total = d(x.gross).plus(x.sso_er).plus(x.pvd_er).plus(x.borne);
      return { department: dp ? `${dp.code} ${dp.name_th}` : '(ไม่ระบุแผนก)', headcount: x.n, gross: round2(x.gross).toFixed(2), sso_er: round2(x.sso_er).toFixed(2), pvd_er: round2(x.pvd_er).toFixed(2), borne: round2(x.borne).toFixed(2), total: round2(total).toFixed(2) }; })
      .sort((x, y) => x.department.localeCompare(y.department));
    const sumOf = (k: 'gross' | 'sso_er' | 'pvd_er' | 'borne' | 'total') => rows.reduce((s, x) => s.plus(x[k]), ZERO).toFixed(2);
    return { from: q.from, to: q.to, rows, total: { gross: sumOf('gross'), sso_er: sumOf('sso_er'), pvd_er: sumOf('pvd_er'), borne: sumOf('borne'), total: sumOf('total') } };
  });
}
