/**
 * ระบบเงินเดือน ระยะ 1 — ทะเบียนพนักงาน รอบเงินเดือน ภาษี ภ.ง.ด.1 ประกันสังคม ลงบัญชี (PGlite ในหน่วยความจำ)
 * ตัวเลขชุดเดียวกับชุดทดสอบรอบเงินเดือนของ WTS-ERP · ทดสอบข้ามบริษัท/ข้ามลูกค้าไม่ได้ทุกเส้น
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { openDatabase, type Database } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { taxIdCheckDigit } from '@buddy/core';

let database: Database;
let app: FastifyInstance;
let cookie = '';
async function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown) {
  const r = await app.inject({ method, url, payload: body as object, headers: cookie ? { cookie } : {} });
  const set = r.headers['set-cookie'];
  if (set) cookie = (Array.isArray(set) ? set[0]! : set).split(';')[0]!;
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
}
const pid = (n: number) => { const b = `110170023${String(n).padStart(3, '0')}`; return b + taxIdCheckDigit(b); };

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.BUDDY_REQUIRE_ADMIN_2FA = '0';
  process.env.BUDDY_SECRET_KEY ??= Buffer.alloc(32, 7).toString('base64');
  const cfg = { ...loadConfig({}), databaseUrl: undefined, dataDir: 'memory://' };
  database = await openDatabase(cfg);
  await migrate(database, cfg.migrationsDir, () => {});
  app = await buildApp(database, cfg);
  await call('POST', '/api/v1/setup', { username: 'admin', display_name: 'ผู้ดูแล', password: 'secret123' });
}, 120_000);
afterAll(async () => { await app?.close(); await database?.close(); });

describe('ระบบเงินเดือน', () => {
  let co = '', other = '', dept = '', cash = '', A = '', B = '', C = '', jan = '', feb = '';
  type Emp = { code: string; regular: string; special: string; gross: string; sso_ee: string; sso_er: string; tax: string; tax_special: string; other_deductions: string; net_pay: string; id: string; lines: Array<{ code: string; amount: string; qty: string | null; note: string | null }>; tax_calc: Record<string, unknown> };
  const emp = (run: { employees: Emp[] }, code: string) => run.employees.find((e) => e.code === code)!;

  it('seeds items, takes employees with salary history, masks the ID, checks the ID digit', async () => {
    co = (await call('POST', '/api/v1/companies', { code: 'PAYCO', name_th: 'บริษัท เงินเดือน จำกัด', fiscal_start: '2026-01-01', chart: 'th_en' })).body.id;
    other = (await call('POST', '/api/v1/companies', { code: 'PAYOT', name_th: 'อีกบริษัท', fiscal_start: '2026-01-01', chart: 'th_en' })).body.id;
    await call('POST', '/api/v1/auth/select', { company_id: co });
    const items = (await call('GET', '/api/v1/pay/items')).body;
    expect(items.map((x: { code: string }) => x.code)).toContain('IN001');
    expect(items).toHaveLength(20);
    dept = (await call('POST', '/api/v1/departments', { code: 'ACC', name_th: 'บัญชี' })).body.id;
    cash = (await call('GET', '/api/v1/gl/accounts')).body.find((x: { account_no: string }) => x.account_no === '1111-01').id;
    const base = { hire_date: '2025-01-01', wage_type: 'M', rate: '30000', sso_insured: true, tax_bearer: 'W', pay_method: 'C' };
    expect((await call('POST', '/api/v1/pay/employees', { ...base, code: 'E01', first_name: 'เอ', tax_id: '1101700230709' })).body.error.message).toMatch(/หลักสุดท้าย/);
    A = (await call('POST', '/api/v1/pay/employees', { ...base, code: 'E01', title: 'นาย', first_name: 'เอ', last_name: 'ทดสอบ', tax_id: pid(1), department_id: dept })).body.id;
    expect((await call('POST', '/api/v1/pay/employees', { ...base, code: 'E01', first_name: 'ซ้ำ' })).status).toBe(409);
    expect((await call('POST', '/api/v1/pay/employees', { ...base, code: 'E09', first_name: 'เลขซ้ำ', tax_id: pid(1) })).body.error.message).toMatch(/E01/);
    B = (await call('POST', '/api/v1/pay/employees', { ...base, code: 'E02', first_name: 'บี', hire_date: '2026-01-16' })).body.id;
    C = (await call('POST', '/api/v1/pay/employees', { ...base, code: 'E03', first_name: 'ซี', wage_type: 'D', rate: '400' })).body.id;
    const a = (await call('GET', `/api/v1/pay/employees/${A}`)).body;
    expect([a.tax_id, a.tax_id_masked, a.salary.length, a.salary[0].rate]).toEqual([undefined, `•••${pid(1).slice(-4)}`, 1, '30000.00']);
    expect((await call('POST', `/api/v1/pay/employees/${A}/reveal`)).body.tax_id).toBe(pid(1));
    // แก้โดยไม่ส่งเลขบัตร = คงเลขเดิม
    expect((await call('PUT', `/api/v1/pay/employees/${A}`, { ...base, code: 'E01', title: 'นาย', first_name: 'เอ', last_name: 'ทดสอบ', department_id: dept })).status).toBe(200);
    expect((await call('POST', `/api/v1/pay/employees/${A}/reveal`)).body.tax_id).toBe(pid(1));
    // รายการประจำของ B: เบี้ยเลี้ยง 1,500 · หักเบิกล่วงหน้า 2,000
    const id = (c: string) => items.find((x: { code: string }) => x.code === c).id;
    expect((await call('POST', `/api/v1/pay/employees/${B}/recurring`, { item_id: id('IN001'), amount: '1', from_month: '2026-01-01' })).body.error.message).toMatch(/จำนวนเงิน/);
    expect((await call('POST', `/api/v1/pay/employees/${B}/recurring`, { item_id: id('IN006'), amount: '1500', from_month: '2026-01-01' })).status).toBe(200);
    expect((await call('POST', `/api/v1/pay/employees/${B}/recurring`, { item_id: id('ES005'), amount: '2000', from_month: '2026-01-01', to_month: '2026-01-31' })).status).toBe(200);
    // ค่าลดหย่อน: จำนวนบุตรต้องเป็นจำนวนคน
    expect((await call('PUT', `/api/v1/pay/employees/${A}/allowances/2026`, { values: { child: 30000 } })).body.error.message).toMatch(/จำนวนคน/);
  });

  it('January run: wages, recurring items, daily staff, SSO and PND1 tax like WTS-ERP', async () => {
    const r = await call('POST', '/api/v1/pay/runs', { month: '2026-01' });
    expect(r.status).toBe(200);
    jan = r.body.id;
    expect((await call('POST', '/api/v1/pay/runs', { month: '2026-01' })).status).toBe(409);   // รอบปกติเดือนเดียวกันซ้ำไม่ได้
    let run = (await call('GET', `/api/v1/pay/runs/${jan}`)).body;
    expect([run.status, run.headcount]).toEqual(['D', 3]);
    const a = emp(run, 'E01');
    expect([a.regular, a.sso_ee, a.sso_er, a.tax, a.net_pay]).toEqual(['30000.00', '875.00', '875.00', '164.58', '28960.42']);
    expect(a.tax_calc.annual_regular_tax).toBe('1975.00');
    const b = emp(run, 'E02');
    expect(b.lines[0]).toMatchObject({ code: 'IN001', amount: '16000.00', note: '16 วัน × 30000.00 ÷ 30' });
    expect([b.special, b.gross, b.sso_ee, b.tax, b.other_deductions, b.net_pay]).toEqual(['1500.00', '17500.00', '800.00', '0.00', '2000.00', '14700.00']);
    expect(emp(run, 'E03').gross).toBe('0.00');
    const cId = run.employees.find((e: Emp) => e.code === 'E03').id;
    expect((await call('PUT', `/api/v1/pay/runs/${jan}/employees/${cId}`, { work_days: '20', salary_manual: '1' })).body.error.message).toMatch(/เหตุผล/);
    expect((await call('PUT', `/api/v1/pay/runs/${jan}/employees/${cId}`, { work_days: '20' })).status).toBe(200);
    run = (await call('GET', `/api/v1/pay/runs/${jan}`)).body;
    expect([emp(run, 'E03').gross, emp(run, 'E03').sso_ee, emp(run, 'E03').net_pay]).toEqual(['8000.00', '400.00', '7600.00']);
    expect([run.total_gross, run.total_tax, run.total_sso_ee, run.total_sso_er, run.total_deductions, run.total_net]).toEqual(['55500.00', '164.58', '2075.00', '2075.00', '2000.00', '51260.42']);
  });

  it('save = number + payroll journal in one transaction (Dr expenses by dept / Cr WHT, SSO, deductions, accrued)', async () => {
    const pv = (await call('GET', `/api/v1/pay/runs/${jan}/posting-preview`)).body;
    expect(pv.missing).toEqual([]);
    expect([pv.debit, pv.credit]).toEqual(['57575.00', '57575.00']);   // เงินได้ 55,500 + ประกันสังคมนายจ้าง 2,075
    const byRole = (role: string) => pv.lines.filter((l: { role: string }) => l.role === role);
    expect(byRole('PAY_SALARY').map((l: { account_no: string; department_id: string | null; debit: string }) => [l.account_no, l.department_id === dept, l.debit])).toEqual([['5411-01', true, '30000.00'], ['5411-01', false, '24000.00']]);
    expect(byRole('PAY_WHT1_PAYABLE')[0]).toMatchObject({ account_no: '2132-01', credit: '164.58' });
    expect(byRole('PAY_SSO_PAYABLE')[0]).toMatchObject({ account_no: '2131-04', credit: '4150.00' });
    expect(byRole('PAY_EMPLOYEE_ADVANCE')[0]).toMatchObject({ account_no: '1152-00', credit: '2000.00' });
    expect(byRole('PAY_ACCRUED')[0]).toMatchObject({ account_no: '2131-01', credit: '51260.42' });
    const p = await call('POST', `/api/v1/pay/runs/${jan}/post`);
    expect(p.status).toBe(200);
    expect(p.body.doc_no).toMatch(/^PY(69|26)010001$/);
    const j = (await call('GET', `/api/v1/gl/journals/${p.body.journal_id}`)).body;
    expect([j.voucher_no, j.source_module, j.total_debit, j.doc_status, j.editable]).toEqual([p.body.doc_no, 'PAY', '57575.00', 'N', false]);
    // บันทึกแล้วแก้ตัวเลขไม่ได้จนกว่าจะเปิดกลับเป็นร่าง
    const cId = (await call('GET', `/api/v1/pay/runs/${jan}`)).body.employees.find((e: Emp) => e.code === 'E03').id;
    expect((await call('PUT', `/api/v1/pay/runs/${jan}/employees/${cId}`, { work_days: '21' })).body.error.message).toMatch(/แก้ไข/);
    const log = (await sql<{ n: number }>`SELECT count(*)::int AS n FROM sys_activity_log WHERE company_id = ${co} AND module = 'PAY' AND action = 'POST'`.execute(database.db)).rows[0]!.n;
    expect(log).toBe(1);
  });

  it('February: OT is occasional income (part ข), bonus run in the same month nets tax and SSO', async () => {
    feb = (await call('POST', '/api/v1/pay/runs', { month: '2026-02' })).body.id;
    let run = (await call('GET', `/api/v1/pay/runs/${feb}`)).body;
    const ot = (await call('GET', '/api/v1/pay/items')).body.find((x: { code: string }) => x.code === 'IN002').id;
    await call('PUT', `/api/v1/pay/runs/${feb}/employees/${emp(run, 'E01').id}`, { lines: [{ item_id: ot, qty: '10' }] });
    run = (await call('GET', `/api/v1/pay/runs/${feb}`)).body;
    const a = emp(run, 'E01');
    expect(a.lines.find((l) => l.code === 'IN002')).toMatchObject({ amount: '1875.00' });
    expect([a.tax, a.tax_special, a.net_pay]).toEqual(['258.33', '93.75', '30741.67']);
    // B: เดือนแรกเต็มเดือน 30,000 (เบิกล่วงหน้าหมดแล้ว) ภาษี 266.25 (ส่วน ข 150)
    expect([emp(run, 'E02').regular, emp(run, 'E02').tax, emp(run, 'E02').tax_special, emp(run, 'E02').other_deductions]).toEqual(['30000.00', '266.25', '150.00', '0.00']);
    // รอบโบนัสเดือนเดียวกัน: ประกันสังคมไม่หักซ้ำ ภาษีเฉพาะส่วนเพิ่ม
    const bonus = (await call('POST', '/api/v1/pay/runs', { month: '2026-02', run_type: 'B' })).body.id;
    expect((await call('POST', `/api/v1/pay/runs/${bonus}/employees`, { employee_ids: [A] })).status).toBe(200);
    let br = (await call('GET', `/api/v1/pay/runs/${bonus}`)).body;
    const bonusItem = (await call('GET', '/api/v1/pay/items')).body.find((x: { code: string }) => x.code === 'IN008').id;
    await call('PUT', `/api/v1/pay/runs/${bonus}/employees/${br.employees[0].id}`, { lines: [{ item_id: bonusItem, amount: '60000' }] });
    br = (await call('GET', `/api/v1/pay/runs/${bonus}`)).body;
    expect([br.employees[0].gross, br.employees[0].sso_ee, br.employees[0].lines.map((l: { code: string }) => l.code).join(',')]).toEqual(['60000.00', '0.00', 'IN008,ES001']);
    expect(Number(br.employees[0].tax)).toBeGreaterThan(2900);
    expect((await call('DELETE', `/api/v1/pay/runs/${bonus}`)).status).toBe(200);   // ร่างลบได้เลย
  });

  it('reopen keeps number and voucher; pay posts Dr accrued / Cr cash; cancel needs unpay; delete only cancelled', async () => {
    const p1 = (await call('POST', `/api/v1/pay/runs/${feb}/post`)).body;
    expect(p1.doc_no).toMatch(/^PY(69|26)020001$/);
    expect((await call('POST', `/api/v1/pay/runs/${feb}/reopen`, { reason: '' })).status).toBe(400);
    expect((await call('POST', `/api/v1/pay/runs/${feb}/reopen`, { reason: 'แก้ OT' })).status).toBe(200);
    expect((await call('GET', `/api/v1/gl/journals/${p1.journal_id}`)).body.doc_status).toBe('C');
    const p2 = (await call('POST', `/api/v1/pay/runs/${feb}/post`)).body;
    expect([p2.doc_no, p2.journal_id]).toEqual([p1.doc_no, p1.journal_id]);
    expect((await call('GET', `/api/v1/gl/journals/${p1.journal_id}`)).body.doc_status).toBe('N');
    // จ่าย
    const accrued = (await call('GET', '/api/v1/gl/accounts')).body.find((x: { account_no: string }) => x.account_no === '2131-01').id;
    expect((await call('POST', `/api/v1/pay/runs/${feb}/pay`, { paid_date: '2026-02-28', account_id: accrued })).body.error.message).toMatch(/เงินสด/);
    expect((await call('POST', `/api/v1/pay/runs/${feb}/pay`, { paid_date: '2026-02-28', account_id: cash })).status).toBe(200);
    let run = (await call('GET', `/api/v1/pay/runs/${feb}`)).body;
    expect([run.status, run.pay_journal.voucher_no]).toEqual(['P', `PA${p1.doc_no.slice(2)}`]);
    expect((await call('POST', `/api/v1/pay/runs/${feb}/reopen`, { reason: 'x' })).body.error.message).toMatch(/ยกเลิกการจ่าย/);
    expect((await call('POST', `/api/v1/pay/runs/${feb}/cancel`, { reason: 'x' })).body.error.message).toMatch(/ยกเลิกการจ่าย/);
    expect((await call('DELETE', `/api/v1/pay/runs/${feb}`)).body.error.message).toMatch(/ยกเลิกรอบ/);
    expect((await call('POST', `/api/v1/pay/runs/${feb}/unpay`, { reason: 'จ่ายผิดบัญชี' })).status).toBe(200);
    expect((await call('POST', `/api/v1/pay/runs/${feb}/cancel`, { reason: 'ทำใหม่' })).status).toBe(200);
    run = (await call('GET', `/api/v1/pay/runs/${feb}`)).body;
    expect([run.status, run.journal.doc_status, run.pay_journal.doc_status]).toEqual(['C', 'C', 'C']);
    expect((await call('DELETE', `/api/v1/pay/runs/${feb}`)).status).toBe(200);
    expect((await call('GET', `/api/v1/pay/runs/${feb}`)).status).toBe(404);
    expect((await call('GET', `/api/v1/gl/journals/${p1.journal_id}`)).status).toBe(404);
    // พนักงานที่มีรอบเงินเดือนแล้วลบไม่ได้
    expect((await call('DELETE', `/api/v1/pay/employees/${A}`)).body.error.message).toMatch(/เลิกใช้/);
  });

  it('mid-year start: brought-forward figures feed the tax; missing months are warned', async () => {
    const E = (await call('POST', '/api/v1/pay/employees', { code: 'E05', first_name: 'อี', hire_date: '2025-06-01', wage_type: 'M', rate: '30000', pay_method: 'C' })).body.id;
    const oct = (await call('POST', '/api/v1/pay/runs', { month: '2026-10' })).body.id;
    let run = (await call('GET', `/api/v1/pay/runs/${oct}`)).body;
    expect(emp(run, 'E05').tax_calc.missing_months).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(run.warnings.join(' ')).toMatch(/E05/);
    expect((await call('PUT', `/api/v1/pay/employees/${E}/ytd/2026`, { through_month: 10, regular: '270000', tax: '1481.25', sso: '7875' })).body.error.message).toMatch(/เดือนที่ 10/);
    expect((await call('PUT', `/api/v1/pay/employees/${E}/ytd/2026`, { through_month: 9, regular: '270000', tax: '1481.25', sso: '7875' })).status).toBe(200);
    await call('POST', `/api/v1/pay/runs/${oct}/calculate`);
    run = (await call('GET', `/api/v1/pay/runs/${oct}`)).body;
    expect([emp(run, 'E05').tax, emp(run, 'E05').tax_calc.annual_regular_tax, emp(run, 'E05').tax_calc.missing_months]).toEqual(['164.58', '1975.00', []]);
    expect((await call('DELETE', `/api/v1/pay/runs/${oct}`)).status).toBe(200);
  });

  it('forms (ระยะ 2): payslip with YTD, PND1 month, PND1A year with brought-forward, 50 Tawi numbers kept, SSO 1-10 capped wage, reports', async () => {
    // สลิป: รอบ ม.ค. (บันทึกแล้ว)
    const sl = (await call('GET', `/api/v1/pay/runs/${jan}/slips`)).body;
    const sa = sl.slips.find((x: { code: string }) => x.code === 'E01');
    expect([sa.gross, sa.deductions_total, sa.net_pay, sa.ytd.income, sa.ytd.tax, sa.ytd.sso, sa.tax_id]).toEqual(['30000.00', '1039.58', '28960.42', '30000.00', '164.58', '875.00', `•••${pid(1).slice(-4)}`]);
    expect(sa.earnings.map((x: { name: string; amount: string }) => `${x.name}:${x.amount}`)).toEqual(['เงินเดือน/ค่าจ้าง:30000.00']);
    expect(sa.deductions.map((x: { name: string }) => x.name)).toEqual(['ภาษีหัก ณ ที่จ่าย', 'ประกันสังคม']);
    expect((await call('GET', `/api/v1/pay/runs/${jan}/slips?re=${sa.run_employee_id}`)).body.slips).toHaveLength(1);
    // ภ.ง.ด.1 ม.ค.: ทุกคนที่มีเงินได้ · taxed_only เฉพาะคนที่ถูกหัก
    const p1 = (await call('GET', '/api/v1/pay/pnd1?month=2026-01')).body;
    expect(p1.rows.map((r: { code: string; income: string; tax: string; condition: string }) => [r.code, r.income, r.tax, r.condition])).toEqual([['E01', '30000.00', '164.58', '1'], ['E02', '17500.00', '0.00', '1'], ['E03', '8000.00', '0.00', '1']]);
    expect([p1.count, p1.income, p1.tax, p1.payer.name]).toEqual([3, '55500.00', '164.58', 'บริษัท เงินเดือน จำกัด']);
    expect(p1.rows[0].tax_id).toBe(pid(1));
    expect((await call('GET', '/api/v1/pay/pnd1?month=2026-01&taxed_only=1')).body.count).toBe(1);
    // สปส.1-10: ค่าจ้างในแบบไม่เกิน 17,500
    const so = (await call('GET', '/api/v1/pay/sso?month=2026-01')).body;
    expect(so.rows.map((r: { code: string; wage_paid: string; wage: string; ee: string }) => [r.code, r.wage_paid, r.wage, r.ee])).toEqual([['E01', '30000.00', '17500.00', '875.00'], ['E02', '16000.00', '16000.00', '800.00'], ['E03', '8000.00', '8000.00', '400.00']]);
    expect([so.ee, so.er, so.total]).toEqual(['2075.00', '2075.00', '4150.00']);
    // ภ.ง.ด.1ก ปี 2569: รวมยอดยกมาของ E05 · ที่อยู่ไม่ครบแจ้งปัญหา
    const pa = (await call('GET', '/api/v1/pay/pnd1a?year=2026')).body;
    expect(pa.rows.map((r: { code: string; income: string; tax: string }) => [r.code, r.income, r.tax])).toEqual([['E01', '30000.00', '164.58'], ['E02', '17500.00', '0.00'], ['E03', '8000.00', '0.00'], ['E05', '270000.00', '1481.25']]);
    expect(pa.rows[0].problem).toMatch(/ที่อยู่/);
    // 50 ทวิ: ออกเลขที่ครั้งเดียว เล่ม 2569 เลขที่ 001… ตามรหัส · ออกซ้ำไม่ออกใหม่
    let w = (await call('GET', '/api/v1/pay/w50?year=2026')).body;
    expect(w.rows.every((r: { issued: boolean }) => !r.issued)).toBe(true);
    expect((await call('POST', '/api/v1/pay/w50/printed', { year: 2026, employee_ids: [A] })).body.error.message).toMatch(/ออกเลขที่/);
    expect((await call('POST', '/api/v1/pay/w50/issue', { year: 2026 })).body.issued).toBe(4);
    expect((await call('POST', '/api/v1/pay/w50/issue', { year: 2026 })).body.issued).toBe(0);
    w = (await call('GET', '/api/v1/pay/w50?year=2026')).body;
    const wa = w.rows.find((r: { code: string }) => r.code === 'E01');
    expect([wa.data.book_no, wa.data.run_no, wa.data.form, wa.data.lines[0].amount, wa.data.lines[0].tax, wa.data.funds.sso, wa.data.issue_date]).toEqual(['2569', '001', '1ก', '30000.00', '164.58', '875.00', '2026-12-31']);
    expect(w.rows.map((r: { data: { run_no: string } }) => r.data.run_no)).toEqual(['001', '002', '003', '004']);
    expect((await call('POST', '/api/v1/pay/w50/printed', { year: 2026, employee_ids: [A] })).status).toBe(200);
    expect((await call('GET', '/api/v1/pay/w50?year=2026')).body.rows[0].print_count).toBe(1);
    // รายงาน
    const reg = (await call('GET', '/api/v1/pay/reports/register?month=2026-01')).body;
    expect(reg.columns.map((c: { code: string }) => c.code)).toEqual(['IN001', 'IN006', 'ES001', 'ES002', 'ES005']);
    expect(reg.rows.map((r: { code: string; net: string }) => `${r.code}:${r.net}`)).toEqual(['E01:28960.42', 'E02:14700.00', 'E03:7600.00']);
    const yr = (await call('GET', '/api/v1/pay/reports/yearly?year=2026&measure=tax')).body;
    expect(yr.months[0]).toBe('164.58');
    const cost = (await call('GET', '/api/v1/pay/reports/cost?from=2026-01&to=2026-01')).body;
    expect(cost.rows.map((r: { department: string; total: string }) => `${r.department}:${r.total}`)).toEqual(['(ไม่ระบุแผนก):26700.00', 'ACC บัญชี:30875.00']);
    expect(cost.total.total).toBe('57575.00');
    // บริษัทอื่นเห็นไม่ได้
    await call('POST', '/api/v1/auth/select', { company_id: other });
    expect((await call('GET', `/api/v1/pay/runs/${jan}/slips`)).status).toBe(404);
    expect((await call('GET', '/api/v1/pay/pnd1?month=2026-01')).body.rows).toEqual([]);
    expect((await call('GET', '/api/v1/pay/w50?year=2026')).body.rows).toEqual([]);
    expect((await call('POST', '/api/v1/pay/w50/issue', { year: 2026 })).body.issued).toBe(0);
    expect((await call('POST', '/api/v1/pay/w50/printed', { year: 2026, employee_ids: [A] })).status).toBe(400);
    expect((await call('GET', '/api/v1/pay/reports/register?month=2026-01')).body.rows).toEqual([]);
    await call('POST', '/api/v1/auth/select', { company_id: co });
  });

  it('PDPA: employee is a data subject — search, full report with payroll, contact erase now, full erase only after retention', async () => {
    await call('PUT', `/api/v1/pay/employees/${A}`, { code: 'E01', title: 'นาย', first_name: 'เอ', last_name: 'ทดสอบ', department_id: dept, hire_date: '2025-01-01', pay_method: 'B', bank_account_no: '1234567890', phone: '0812345678' });
    const found = (await call('GET', '/api/v1/pdpa/subjects?q=E01')).body.filter((x: { kind: string }) => x.kind === 'EMPLOYEE');
    expect(found.map((x: { code: string }) => x.code)).toEqual(['E01']);
    const rep = (await call('GET', `/api/v1/pdpa/subjects/EMPLOYEE/${A}`)).body;
    expect([rep.master.tax_id, rep.master.phone, rep.payroll.length, rep.certificates.length, rep.retention.full_erase_allowed]).toEqual([pid(1), '0812345678', 1, 1, false]);
    expect((await call('POST', `/api/v1/pdpa/subjects/EMPLOYEE/${A}/access`, { received_on: '2026-11-03' })).status).toBe(200);
    expect((await call('POST', `/api/v1/pdpa/subjects/EMPLOYEE/${A}/erase`, { mode: 'FULL', received_on: '2026-11-03', confirm: 'E01' })).body.error.message).toMatch(/ยังปิดบัง/);
    expect((await call('POST', `/api/v1/pdpa/subjects/EMPLOYEE/${A}/erase`, { mode: 'CONTACT', received_on: '2026-11-03', confirm: 'E01' })).status).toBe(200);
    const after = (await call('GET', `/api/v1/pdpa/subjects/EMPLOYEE/${A}`)).body.master;
    expect([after.phone, after.bank_account_no, after.tax_id]).toEqual([null, null, pid(1)]);
    // บริษัทอื่นเห็นพนักงานนี้ไม่ได้
    await call('POST', '/api/v1/auth/select', { company_id: other });
    expect((await call('GET', '/api/v1/pdpa/subjects?q=E01')).body.filter((x: { kind: string }) => x.kind === 'EMPLOYEE')).toEqual([]);
    expect((await call('GET', `/api/v1/pdpa/subjects/EMPLOYEE/${A}`)).status).toBe(404);
    await call('POST', '/api/v1/auth/select', { company_id: co });
  });

  it('missing account role stops posting with a clear message; company tax table override is used', async () => {
    const mar = (await call('POST', '/api/v1/pay/runs', { month: '2026-03' })).body.id;
    await sql`UPDATE gl_default_account SET deleted_at = now() WHERE company_id = ${co} AND role = 'PAY_SSO_EXPENSE'`.execute(database.db);
    expect((await call('POST', `/api/v1/pay/runs/${mar}/post`)).body.error.message).toMatch(/เงินสมทบประกันสังคม \(ส่วนนายจ้าง\)/);
    expect((await call('GET', `/api/v1/pay/runs/${mar}`)).body.status).toBe('D');
    // เติมบัญชีจากผังตัวอย่าง: เฉพาะบทบาทที่ว่าง เลขที่+ชื่อตรงกับผังตัวอย่าง
    const fill = (await call('POST', '/api/v1/pay/default-accounts')).body;
    expect([fill.filled, fill.missing]).toEqual([[{ role: 'เงินสมทบประกันสังคม (ส่วนนายจ้าง)', account_no: '5412-14' }], []]);
    expect((await call('POST', '/api/v1/pay/default-accounts')).body.filled).toEqual([]);
    const law = (await call('GET', '/api/v1/pay/law?year=2026')).body;
    expect([law.law_year, law.rules.personal, law.sso_now.monthly_max]).toEqual([2026, '60000', '875']);
    expect((await call('PUT', '/api/v1/pay/law/tax/2026', { rules: { ...law.rules, brackets: [{ from: '0', to: '100', rate: '0' }] } })).body.error.message).toMatch(/สุดท้าย/);
    expect((await call('PUT', '/api/v1/pay/law/tax/2026', { rules: { ...law.rules, personal: '0' } })).status).toBe(200);
    await call('POST', `/api/v1/pay/runs/${mar}/calculate`);
    expect(Number(emp((await call('GET', `/api/v1/pay/runs/${mar}`)).body, 'E01').tax)).toBeGreaterThan(164.58);
    expect((await call('DELETE', '/api/v1/pay/law/tax/2026')).status).toBe(200);
    await call('POST', `/api/v1/pay/runs/${mar}/calculate`);
    expect((await call('DELETE', `/api/v1/pay/runs/${mar}`)).status).toBe(200);
  });

  it('payroll needs approval level 5 to read; API keys are refused', async () => {
    const admin = cookie;
    const tenant_id = (await call('GET', '/api/v1/tenants')).body.find((t: { code: string }) => t.code === 'DEFAULT').id;
    expect((await call('POST', '/api/v1/users', { tenant_id, username: 'payclerk', display_name: 'พนักงานบัญชี', password: 'clerk4pass', approval_level: 4, companies: [co] })).status).toBe(200);
    cookie = '';
    await call('POST', '/api/v1/auth/login', { username: 'payclerk', password: 'clerk4pass' });
    await call('POST', '/api/v1/auth/select', { company_id: co });
    expect((await call('GET', '/api/v1/pay/employees')).status).toBe(403);
    expect((await call('GET', `/api/v1/pay/runs/${jan}`)).status).toBe(403);
    expect((await call('GET', '/api/v1/gl/journals?limit=1')).status).toBe(200);   // เมนูอื่นใช้ได้ตามปกติ
    cookie = admin;
    const me = (await call('GET', '/api/v1/auth/me')).body;
    const key = (await call('POST', '/api/v1/api-keys', { name: 'ระบบอื่น', user_id: me.user.id, read_only: true })).body.key as string;
    const r = await app.inject({ method: 'GET', url: '/api/v1/pay/employees', headers: { authorization: `Bearer ${key}` } });
    expect(r.statusCode).toBe(403);
  });

  it('another company of the same customer cannot see or touch this payroll', async () => {
    await call('POST', '/api/v1/auth/select', { company_id: other });
    expect((await call('GET', '/api/v1/pay/employees')).body).toEqual([]);
    expect((await call('GET', '/api/v1/pay/runs')).body).toEqual([]);
    expect((await call('GET', `/api/v1/pay/employees/${A}`)).status).toBe(404);
    expect((await call('POST', `/api/v1/pay/employees/${A}/reveal`)).status).toBe(404);
    expect((await call('PUT', `/api/v1/pay/employees/${A}`, { code: 'E01', first_name: 'แฮก', hire_date: '2025-01-01' })).status).toBe(404);
    expect((await call('PUT', `/api/v1/pay/employees/${A}/allowances/2026`, { values: {} })).status).toBe(404);
    expect((await call('GET', `/api/v1/pay/runs/${jan}`)).status).toBe(404);
    expect((await call('POST', `/api/v1/pay/runs/${jan}/cancel`, { reason: 'x' })).status).toBe(404);
    expect((await call('DELETE', `/api/v1/pay/runs/${jan}`)).status).toBe(404);
    // รอบของบริษัทนี้ใส่พนักงานของบริษัทอื่นไม่ได้
    const mine = (await call('POST', '/api/v1/pay/runs', { month: '2026-01', run_type: 'B' })).body.id;
    expect((await call('POST', `/api/v1/pay/runs/${mine}/employees`, { employee_ids: [A] })).body.error.message).toMatch(/ไม่พบพนักงาน/);
    // พนักงานใหม่อ้างแผนกของบริษัทอื่นไม่ได้
    expect((await call('POST', '/api/v1/pay/employees', { code: 'X1', first_name: 'เอ็กซ์', hire_date: '2026-01-01', wage_type: 'M', rate: '10000', department_id: dept })).body.error.message).toMatch(/ไม่พบแผนก/);
    // รายการเงินได้ของบริษัทนี้เป็นชุดของตัวเอง (รหัสแถวไม่ซ้ำบริษัทแรก)
    const mineItems = (await call('GET', '/api/v1/pay/items')).body.map((x: { id: string }) => x.id);
    await call('POST', '/api/v1/auth/select', { company_id: co });
    const coItems = (await call('GET', '/api/v1/pay/items')).body.map((x: { id: string }) => x.id);
    expect(mineItems.some((x: string) => coItems.includes(x))).toBe(false);
  });

  it('another customer (tenant) cannot reach this payroll at all', async () => {
    const platform = cookie;
    expect((await call('POST', '/api/v1/tenants', { code: 'PAYT2', name: 'ลูกค้าอื่น', admin_username: 't2.admin', admin_name: 'ผู้ดูแลอื่น', admin_password: 'passT2pay1' })).status).toBe(200);
    cookie = '';
    await call('POST', '/api/v1/auth/login', { username: 't2.admin', password: 'passT2pay1' });
    const t2co = (await call('POST', '/api/v1/companies', { code: 'T2CO', name_th: 'บริษัทลูกค้าอื่น', fiscal_start: '2026-01-01', chart: 'th_en' })).body.id;
    expect((await call('POST', '/api/v1/auth/select', { company_id: co })).status).not.toBe(200);   // เลือกบริษัทของลูกค้าอื่นไม่ได้
    await call('POST', '/api/v1/auth/select', { company_id: t2co });
    expect((await call('GET', '/api/v1/pay/employees')).body).toEqual([]);
    expect((await call('GET', `/api/v1/pay/employees/${A}`)).status).toBe(404);
    expect((await call('GET', `/api/v1/pay/runs/${jan}`)).status).toBe(404);
    expect((await call('GET', `/api/v1/pay/runs/${jan}/posting-preview`)).status).toBe(404);
    expect((await call('GET', `/api/v1/pay/runs/${jan}/slips`)).status).toBe(404);
    expect((await call('GET', '/api/v1/pay/sso?month=2026-01')).body.rows).toEqual([]);
    expect((await call('GET', '/api/v1/pay/reports/cost?from=2026-01&to=2026-12')).body.rows).toEqual([]);
    expect((await call('POST', `/api/v1/pay/runs/${jan}/reopen`, { reason: 'x' })).status).toBe(404);
    // เติมบัญชีจากผังตัวอย่างแตะเฉพาะบริษัทของตัวเอง
    const before = (await sql<{ n: number }>`SELECT count(*)::int AS n FROM gl_default_account WHERE company_id = ${co} AND deleted_at IS NULL`.execute(database.db)).rows[0]!.n;
    await sql`UPDATE gl_default_account SET deleted_at = now() WHERE company_id = ${t2co} AND role = 'PAY_OT'`.execute(database.db);
    expect((await call('POST', '/api/v1/pay/default-accounts')).body.filled).toHaveLength(1);
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM gl_default_account WHERE company_id = ${co} AND deleted_at IS NULL`.execute(database.db)).rows[0]!.n).toBe(before);
    cookie = platform;
  });
});
