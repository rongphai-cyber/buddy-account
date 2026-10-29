/**
 * ทดสอบ API ทั้งเส้นด้วยฐานข้อมูล PGlite ในหน่วยความจำ (แบบเดียวกับโหมดติดตั้งในเครื่อง)
 * ครอบคลุม: ตั้งผู้ดูแลระบบ, สร้างบริษัท, ผังบัญชี, ใบสำคัญ, ปิดงวด, งบทดลอง, งบการเงิน, แยกข้อมูลระหว่างบริษัท
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDatabase, rlsAvailable, runInCompanyScope, type Database } from '../src/db.js';
import { sql } from 'kysely';
import { migrate } from '../src/migrate.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { API_RULES, REGISTERED_ROUTES } from '../src/modules/permissions.js';

let database: Database;
let app: FastifyInstance;
let cookie = '';

async function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown) {
  const r = await app.inject({ method, url, payload: body as object, headers: cookie ? { cookie } : {} });
  const set = r.headers['set-cookie'];
  if (set) cookie = (Array.isArray(set) ? set[0]! : set).split(';')[0]!;
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
}

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  const cfg = { ...loadConfig({}), databaseUrl: undefined, dataDir: 'memory://' };
  database = await openDatabase(cfg);
  await migrate(database, cfg.migrationsDir, () => {});
  app = await buildApp(database, cfg);
}, 120_000);
afterAll(async () => { await app?.close(); await database?.close(); });

describe('Buddy Account API (PGlite)', () => {
  let companyId = '', otherCompanyId = '', bookId = '', cash = '', capital = '', expense = '', revenue = '';

  it('needs setup, creates first admin, refuses second setup', async () => {
    expect((await call('GET', '/api/v1/setup/status')).body.needsSetup).toBe(true);
    expect((await call('GET', '/api/v1/auth/me')).status).toBe(401);
    const r = await call('POST', '/api/v1/setup', { username: 'admin', display_name: 'ผู้ดูแล', password: 'secret123' });
    expect(r.status).toBe(200);
    expect((await call('POST', '/api/v1/setup', { username: 'x', display_name: 'x', password: 'secret123' })).status).toBe(409);
  });

  it('rejects wrong password with Thai message', async () => {
    const saved = cookie; cookie = '';
    const r = await call('POST', '/api/v1/auth/login', { username: 'admin', password: 'nope' });
    expect(r.status).toBe(401);
    expect(r.body.error.message).toMatch(/รหัสผ่านไม่ถูกต้อง/);
    cookie = saved;
  });

  it('creates a company with the Express standard chart and 12 periods', async () => {
    const r = await call('POST', '/api/v1/companies', { code: 'DEMO', name_th: 'บริษัท ทดสอบ จำกัด', fiscal_start: '2026-01-01', chart: 'express' });
    expect(r.status).toBe(200);
    companyId = r.body.id;
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    const me = (await call('GET', '/api/v1/auth/me')).body;
    expect(me.company.code).toBe('DEMO');
    const years = (await call('GET', '/api/v1/gl/periods')).body;
    expect(years).toHaveLength(1);
    expect(years[0].periods).toHaveLength(12);
    const accts = (await call('GET', '/api/v1/gl/accounts')).body as Array<{ id: string; account_no: string; is_control: boolean }>;
    expect(accts.length).toBe(292);
    cash = accts.find((a) => a.account_no === '1111-00')!.id;
    capital = accts.find((a) => a.account_no === '3100-00')!.id;
    expense = accts.find((a) => a.account_no === '5380-06')!.id;
    revenue = accts.find((a) => a.account_no === '4100-11')!.id;
    bookId = (await call('GET', '/api/v1/gl/books')).body.find((b: { code: string }) => b.code === '00').id;
  });

  it('validates account rules (mask, control parent, duplicates)', async () => {
    expect((await call('POST', '/api/v1/gl/accounts', { account_no: '12345', name_th: 'x', level: 1, account_group: '1', is_control: false })).body.error.message).toMatch(/รูปแบบ 9999-99/);
    expect((await call('POST', '/api/v1/gl/accounts', { account_no: '1111-00', name_th: 'x', level: 1, account_group: '1', is_control: false })).status).toBe(409);
    const parent = (await call('GET', '/api/v1/gl/accounts')).body.find((a: { account_no: string }) => a.account_no === '1110-00');
    const ok = await call('POST', '/api/v1/gl/accounts', { account_no: '1111-99', name_th: 'เงินสดทดสอบ', parent_id: parent.id, level: parent.level + 1, account_group: '1', is_control: false });
    expect(ok.status).toBe(200);
  });

  it('rejects an unbalanced journal and a control account', async () => {
    const r = await call('POST', '/api/v1/gl/journals', { journal_book_id: bookId, voucher_date: '2026-01-05', lines: [{ account_id: cash, debit: '100' }, { account_id: capital, credit: '90' }] });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/ไม่เท่ากับเครดิต/);
    const ctl = (await call('GET', '/api/v1/gl/accounts')).body.find((a: { account_no: string }) => a.account_no === '1000-00');
    const r2 = await call('POST', '/api/v1/gl/journals', { journal_book_id: bookId, voucher_date: '2026-01-05', lines: [{ account_id: ctl.id, debit: '100' }, { account_id: capital, credit: '100' }] });
    expect(r2.body.error.message).toMatch(/บัญชีคุม/);
  });

  it('records journals with Express-style voucher numbers', async () => {
    const a = await call('POST', '/api/v1/gl/journals', { journal_book_id: bookId, voucher_date: '2026-01-05', description: 'ทุนจดทะเบียน', lines: [{ account_id: cash, debit: '1,000,000' }, { account_id: capital, credit: '1000000' }] });
    expect(a.body.error?.message ?? 'ok').toBe('ok');
    expect(a.body.voucher_no).toBe('JV690105001');
    const b = await call('POST', '/api/v1/gl/journals', { journal_book_id: bookId, voucher_date: '2026-01-05', lines: [{ account_id: cash, debit: '5000.25' }, { account_id: revenue, credit: '5000.25' }] });
    expect(b.body.voucher_no).toBe('JV690105002');
    await call('POST', '/api/v1/gl/journals', { journal_book_id: bookId, voucher_date: '2026-02-10', lines: [{ account_id: expense, debit: '1200' }, { account_id: cash, credit: '1200' }] });
  });

  it('trial balance balances and reflects movements', async () => {
    const tb = (await call('GET', '/api/v1/reports/trial-balance?from=2026-01-01&to=2026-12-31')).body;
    expect(tb.balanced).toBe(true);
    expect(tb.totals.debit).toBe('1006200.25');
    const cashRow = tb.rows.find((r: { account_no: string }) => r.account_no === '1111-00');
    expect(cashRow.closing).toBe('1003800.25');
    const feb = (await call('GET', '/api/v1/reports/trial-balance?from=2026-02-01&to=2026-02-28')).body;
    expect(feb.rows.find((r: { account_no: string }) => r.account_no === '1111-00').opening).toBe('1005000.25');
  });

  it('closes prior-year profit into retained earnings automatically', async () => {
    expect((await call('POST', '/api/v1/gl/periods/years', { start_date: '2027-01-01' })).status).toBe(200);
    const tb = (await call('GET', '/api/v1/reports/trial-balance?from=2027-01-01&to=2027-01-31')).body;
    expect(tb.balanced).toBe(true);
    const re = tb.rows.find((r: { account_no: string }) => r.account_no.startsWith('3200'));
    expect(re.opening).toBe('-3800.25'); // กำไร 5,000.25 − 1,200 = 3,800.25 (ด้านเครดิต)
    expect(tb.rows.find((r: { account_no: string }) => r.account_no === '4100-11')).toBeUndefined();
  });

  it('chart balance sheet balances', async () => {
    const bs = (await call('GET', '/api/v1/fs/run?kind=BS&end=2026-12-31')).body;
    const totals = bs.rows.filter((r: { kind: string; isTotal: boolean }) => r.kind === 'value' && r.isTotal);
    const assets = totals.find((r: { text: string }) => r.text === 'รวมสินทรัพย์').values[0];
    const le = totals.find((r: { text: string }) => r.text === 'รวมหนี้สินและส่วนของผู้ถือหุ้น').values[0];
    expect(assets).toBe(le);
    expect(assets).toBe('1003800.25');
  });

  it('locked period blocks posting (Message# 1021)', async () => {
    const years = (await call('GET', '/api/v1/gl/periods')).body;
    const jan = years[0].periods[0];
    expect((await call('POST', `/api/v1/gl/periods/${jan.id}/lock`, { locked: true })).body.changed).toBe(1);
    const r = await call('POST', '/api/v1/gl/journals', { journal_book_id: bookId, voucher_date: '2026-01-20', lines: [{ account_id: cash, debit: '1' }, { account_id: capital, credit: '1' }] });
    expect(r.body.error.message).toMatch(/1021/);
    await call('POST', `/api/v1/gl/periods/${jan.id}/lock`, { locked: false });
  });

  it('cancel keeps the voucher but removes it from balances', async () => {
    const list = (await call('GET', '/api/v1/gl/journals?from=2026-02-01&to=2026-02-28')).body.rows;
    const r = await call('POST', `/api/v1/gl/journals/${list[0].id}/cancel`, { reason: 'ทดสอบ' });
    expect(r.status).toBe(200);
    const tb = (await call('GET', '/api/v1/reports/trial-balance?from=2026-01-01&to=2026-12-31')).body;
    expect(tb.totals.debit).toBe('1005000.25');
    const log = (await call('GET', `/api/v1/activity-log?table=gl_journal&row_id=${list[0].id}`)).body;
    expect(log.map((x: { action: string }) => x.action)).toContain('CANCEL');
  });

  it('prior-year balances (ยอดปีที่แล้ว S-GL-16) feed comparisons only, never the current year', async () => {
    const years = (await call('GET', '/api/v1/gl/periods')).body as Array<{ id: string; start_date: string }>;
    const fy = years.find((y) => y.start_date === '2026-01-01')!.id;
    const tb26 = (await call('GET', '/api/v1/reports/trial-balance?from=2026-01-01&to=2026-12-31')).body.totals;
    const bs26 = (await call('GET', '/api/v1/fs/run?kind=BS&end=2026-12-31')).body.rows.filter((r: { kind: string }) => r.kind === 'value').map((r: { values: string[] }) => r.values[0]);
    let s = (await call('GET', `/api/v1/gl/prior-year?fiscal_year_id=${fy}`)).body;
    expect([s.prior.code, s.prior.id, s.voucher_count]).toEqual(['2568', null, 0]);
    const put = (account_id: string, opening: object, periods: object[] = []) => call('PUT', '/api/v1/gl/prior-year/entry', { fiscal_year_id: fy, account_id, opening, periods });
    const control = (await call('GET', '/api/v1/gl/accounts')).body.find((x: { account_no: string }) => x.account_no === '1110-00').id;
    expect((await put(control, { debit: '1' })).body.error.message).toMatch(/บัญชีคุม/);
    expect((await put(revenue, { debit: '5' })).body.error.message).toMatch(/ไม่มียอดยกมา/);
    expect((await put(cash, { debit: '-1' })).body.error.message).toMatch(/ติดลบ/);
    // ปีที่แล้ว: ยกมา เงินสด 1,000 / ทุน 1,000 · งวด 3 ขายเงินสด 500
    expect((await put(cash, { debit: '1000' }, [{ period_no: 3, debit: '500' }])).status).toBe(200);
    expect((await put(capital, { credit: '1000' })).status).toBe(200);
    expect((await put(revenue, {}, [{ period_no: 3, credit: '500' }])).status).toBe(200);
    s = (await call('GET', `/api/v1/gl/prior-year?fiscal_year_id=${fy}`)).body;
    expect(s.prior.id).toBeTruthy();
    expect([s.rows.length, s.closing_debit, s.closing_credit]).toEqual([3, '1500.00', '1500.00']);
    const e = (await call('GET', `/api/v1/gl/prior-year/entry?fiscal_year_id=${fy}&account_id=${cash}`)).body;
    expect([e.read_only, e.opening.debit, e.periods[2].debit, e.periods[2].start_date]).toEqual([false, '1000.00', '500.00', '2025-03-01']);
    // งบทดลองปีที่แล้วมาจากยอดที่ป้อน · งวดปีที่แล้วถูกปิด ลงใบสำคัญไม่ได้
    const tb25 = (await call('GET', '/api/v1/reports/trial-balance?from=2025-01-01&to=2025-12-31')).body;
    expect([tb25.totals.closing_debit, tb25.totals.closing_credit, tb25.balanced]).toEqual(['1500.00', '1500.00', true]);
    expect((await call('POST', '/api/v1/gl/journals', { journal_book_id: bookId, voucher_date: '2025-06-01', lines: [{ account_id: cash, debit: '1' }, { account_id: capital, credit: '1' }] })).body.error.code).toBe('PERIOD_LOCKED');
    // ปีปัจจุบันไม่เปลี่ยน แต่คอลัมน์ปีที่แล้วของงบมีค่า
    expect((await call('GET', '/api/v1/reports/trial-balance?from=2026-01-01&to=2026-12-31')).body.totals).toEqual(tb26);
    const bs = (await call('GET', '/api/v1/fs/run?kind=BS&end=2026-12-31')).body.rows.filter((r: { kind: string }) => r.kind === 'value');
    expect(bs.map((r: { values: string[] }) => r.values[0])).toEqual(bs26);
    expect(bs.find((r: { text: string }) => r.text === 'รวมสินทรัพย์').values[1]).toBe('1500.00');
    // แก้ไขแทนชุดเดิม และเก็บค่าก่อนแก้ใน log
    expect((await put(cash, { debit: '1000' })).status).toBe(200);
    expect((await call('GET', `/api/v1/gl/prior-year/entry?fiscal_year_id=${fy}&account_id=${cash}`)).body.periods[2].debit).toBe('0.00');
    const log = (await call('GET', `/api/v1/activity-log?table=gl_prior_year_balance&row_id=${cash}`)).body;
    expect(log.filter((x: { action: string }) => x.action === 'PRIOR_YEAR')).toHaveLength(2);
    // ปีที่แล้วที่มีใบสำคัญในระบบ: แสดงยอดจากใบสำคัญ ป้อนเองไม่ได้
    if (!(await call('GET', '/api/v1/gl/periods')).body.some((y: { start_date: string }) => y.start_date === '2027-01-01'))
      expect((await call('POST', '/api/v1/gl/periods/years', { start_date: '2027-01-01' })).status).toBe(200);
    const fy27 = (await call('GET', '/api/v1/gl/periods')).body.find((y: { start_date: string }) => y.start_date === '2027-01-01').id;
    expect((await call('PUT', '/api/v1/gl/prior-year/entry', { fiscal_year_id: fy27, account_id: cash, opening: {}, periods: [{ period_no: 1, debit: '1' }] })).body.error.message).toMatch(/มีใบสำคัญในระบบแล้ว/);
    const live = (await call('GET', `/api/v1/gl/prior-year/entry?fiscal_year_id=${fy27}&account_id=${cash}`)).body;
    expect(live.read_only).toBe(true);
    expect(live.periods.some((p: { debit: string }) => p.debit !== '0.00')).toBe(true);
  });

  it('budgets per period (งบประมาณ S-GL-17) with actual/last-year comparison and BUD columns', async () => {
    const fy = (await call('GET', '/api/v1/gl/periods')).body.find((y: { start_date: string }) => y.start_date === '2026-01-01').id;
    const put = (account_id: string, amounts: Record<number, string>) => call('PUT', '/api/v1/gl/budget/entry', { fiscal_year_id: fy, account_id, periods: Object.entries(amounts).map(([k, v]) => ({ period_no: Number(k), amount: v })) });
    const control = (await call('GET', '/api/v1/gl/accounts')).body.find((x: { account_no: string }) => x.account_no === '5380-00');
    expect((await put(control.id, { 1: '1' })).body.error.message).toMatch(/บัญชีคุม/);
    expect((await put(expense, Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, '100'])))).body.total).toBe('1200.00');
    expect((await put(revenue, { 1: '1000' })).status).toBe(200);
    const sum = (await call('GET', `/api/v1/gl/budget?fiscal_year_id=${fy}`)).body;
    expect(sum.rows.map((r: { account_no: string; total: string }) => [r.account_no, r.total])).toEqual([['4100-11', '1000.00'], ['5380-06', '1200.00']]);
    // ยอดจริงรายงวดรวมกัน = ยอดในงบทดลอง (ด้านปกติ) · ปีที่แล้วมาจากยอดที่ป้อนใน S-GL-16 (รายได้งวด 3 = 500)
    const ent = (await call('GET', `/api/v1/gl/budget/entry?fiscal_year_id=${fy}&account_id=${expense}`)).body;
    expect(ent.periods).toHaveLength(12);
    expect(ent.periods[0].budget).toBe('100.00');
    const tb = (await call('GET', '/api/v1/reports/trial-balance?from=2026-01-01&to=2026-12-31')).body.rows.find((r: { account_no: string }) => r.account_no === '5380-06');
    expect(ent.periods.reduce((t: number, p: { actual: string }) => t + Number(p.actual), 0).toFixed(2)).toBe(tb ? (Number(tb.debit) - Number(tb.credit)).toFixed(2) : '0.00');
    const jv = await call('POST', '/api/v1/gl/journals', { journal_book_id: bookId, voucher_date: '2026-02-10', lines: [{ account_id: expense, debit: '250' }, { account_id: cash, credit: '250' }] });
    const ent2 = (await call('GET', `/api/v1/gl/budget/entry?fiscal_year_id=${fy}&account_id=${expense}`)).body;
    expect((Number(ent2.periods[1].actual) - Number(ent.periods[1].actual)).toFixed(2)).toBe('250.00');
    await call('POST', `/api/v1/gl/journals/${jv.body.id}/cancel`, { reason: 'ทดสอบงบประมาณ' });   // ไม่ให้กระทบยอดของทดสอบข้อถัดไป
    const rev = (await call('GET', `/api/v1/gl/budget/entry?fiscal_year_id=${fy}&account_id=${revenue}`)).body;
    expect([rev.periods[0].budget, rev.periods[2].last_year]).toEqual(['1000.00', '500.00']);
    // คอลัมน์งบประมาณในแบบงบ: BUD สะสมต้นปีถึงสิ้นงวด, PTD BUD เฉพาะงวด
    const lay = await call('POST', '/api/v1/fs/layouts', {
      code: 'BUDT', name: 'เทียบงบประมาณ', header_lines: ['\\NAME'], line_set_code: 'BUDT',
      columns: [{ expr: 'BUD' }, { expr: 'PTD BUD' }, { expr: 'BAL' }],
      lines: [
        { line_no: 10, data_type: 'A/C', source: '5380-06', accumulate: {}, description_th: 'ค่าใช้จ่าย' },
        { line_no: 20, data_type: 'A/C', source: '4100-11', accumulate: {}, description_th: 'รายได้' },
        { line_no: 30, data_type: 'A/C', source: '5000-00', accumulate: {}, description_th: 'หมวดค่าใช้จ่าย (บัญชีคุม)' },
      ],
    });
    expect(lay.status).toBe(200);
    const run = (await call('GET', `/api/v1/fs/run?layout_id=${lay.body.id}&end=2026-03-31`)).body;
    const vals = run.rows.filter((r: { kind: string }) => r.kind === 'value').map((r: { values: string[] }) => r.values.slice(0, 2));
    expect(vals).toEqual([['300.00', '100.00'], ['1000.00', '0.00'], ['300.00', '100.00']]);
    expect(run.columns[0].head1).toBe('งบประมาณสะสม');
    // แก้ไขแทนชุดเดิม และเก็บค่าก่อนแก้ใน log
    expect((await put(expense, { 1: '50' })).body.total).toBe('50.00');
    const log = (await call('GET', `/api/v1/activity-log?table=gl_budget&row_id=${expense}`)).body;
    expect(log.filter((x: { action: string }) => x.action === 'BUDGET')).toHaveLength(2);
  });

  it('account detail report (รายละเอียดประกอบ R-GL-01) lists sub-accounts and ties to the balance sheet', async () => {
    const assets = (await call('GET', '/api/v1/gl/accounts')).body.find((x: { account_no: string }) => x.account_no === '1000-00');
    const r = (await call('GET', `/api/v1/reports/account-detail?account_id=${assets.id}&as_of=2026-12-31`)).body;
    expect(r.rows[0].account_no).toBe('1000-00');
    expect(r.rows.every((x: { account_no: string }) => x.account_no >= '1000-00' && x.account_no < '2000-00')).toBe(true);
    expect(r.leaf_count).toBe(r.rows.filter((x: { is_control: boolean }) => !x.is_control).length);
    const bs = (await call('GET', '/api/v1/fs/run?kind=BS&end=2026-12-31')).body.rows.find((x: { text: string }) => x.text === 'รวมสินทรัพย์');
    expect(r.total_closing).toBe(bs.values[0]);
    // ยอดของบัญชีคุม = ผลรวมบัญชีย่อยระดับถัดไป
    const leafSum = r.rows.filter((x: { is_control: boolean }) => !x.is_control).reduce((t: number, x: { closing: string }) => t + Number(x.closing), 0);
    expect(leafSum.toFixed(2)).toBe(r.total_closing);
    // ซ่อนบัญชีที่เป็นศูนย์ / ยอดเคลื่อนไหวเฉพาะงวด
    const nz = (await call('GET', `/api/v1/reports/account-detail?account_id=${assets.id}&as_of=2026-12-31&zero=0`)).body;
    expect(nz.rows.length).toBeLessThan(r.rows.length);
    expect(nz.total_closing).toBe(r.total_closing);
    const ptd = (await call('GET', `/api/v1/reports/account-detail?account_id=${assets.id}&as_of=2026-12-31&movement=ptd`)).body;
    expect([ptd.from, ptd.total_closing]).toEqual(['2026-12-01', r.total_closing]);
    expect((await call('GET', `/api/v1/reports/account-detail?account_id=${assets.id}&as_of=2001-01-01`)).body.error.message).toMatch(/Message# 71/);
  });

  it('layout columns: department per column/line, wildcard, PTDn months, hidden, % of sales (T1.16)', async () => {
    const s1 = (await call('POST', '/api/v1/departments', { code: 'SALE1', name_th: 'ขายหน้าร้าน' })).body.id;
    const s2 = (await call('POST', '/api/v1/departments', { code: 'SALE2', name_th: 'ขายออนไลน์' })).body.id;
    const jv = async (lines: object[]) => (await call('POST', '/api/v1/gl/journals', { journal_book_id: bookId, voucher_date: '2026-03-15', lines })).body.id;
    const j1 = await jv([{ account_id: cash, debit: '1000' }, { account_id: revenue, department_id: s1, credit: '600' }, { account_id: revenue, department_id: s2, credit: '400' }]);
    const j2 = await jv([{ account_id: expense, department_id: s1, debit: '100' }, { account_id: expense, department_id: s2, debit: '50' }, { account_id: cash, credit: '150' }]);
    const lay = await call('POST', '/api/v1/fs/layouts', {
      code: 'DEPT12', name: 'กำไรขาดทุนแยกแผนก', header_lines: ['\\NAME'], line_set_code: 'DEPT12',
      columns: [
        { expr: 'BAL', percent: true },
        { expr: 'BAL', department_code: 'SALE1' },
        { expr: 'BAL', department_code: 'SALE*' },
        { expr: 'PTD3' },
        { expr: 'BAL', department_code: 'SALE2', hidden: true },
        { expr: 'C2+C5', head1: 'SALE1+SALE2' },
        { expr: 'PTD12' },
      ],
      lines: [
        { line_no: 10, data_type: 'A/C', source: '4100-11', accumulate: {}, description_th: 'รายได้จากการขาย' },
        { line_no: 20, data_type: 'A/C', source: '5380-06', accumulate: {}, description_th: 'ค่าใช้จ่าย' },
        { line_no: 30, data_type: 'A/C', source: '4100-11', accumulate: {}, description_th: 'รายได้ขายออนไลน์', department_id: s2 },
      ],
    });
    expect(lay.status).toBe(200);
    const saved = (await call('GET', `/api/v1/fs/layouts/${lay.body.id}`)).body;
    expect(saved.lines.find((l: { line_no: number }) => l.line_no === 30).department_id).toBe(s2);
    expect([saved.columns[0].percent, saved.columns[4].hidden, saved.columns[1].department_code]).toEqual([true, true, 'SALE1']);
    const run = (await call('GET', `/api/v1/fs/run?layout_id=${lay.body.id}&end=2026-12-31`)).body;
    // คอลัมน์ที่ซ่อนไม่พิมพ์ แต่ใช้ในสูตรได้ · % ต่อท้ายคอลัมน์ที่ตั้งไว้
    expect(run.columns.map((c: { head1: string }) => c.head1)).toEqual(['ยอดสะสม', '%', 'ยอดสะสม', 'ยอดสะสม', 'งวดที่ 3', 'SALE1+SALE2', 'งวดที่ 12']);
    expect(run.columns[2].head2).toBe('แผนก SALE1');
    const [rev, exp, online] = run.rows.filter((r: { kind: string }) => r.kind === 'value').map((r: { values: (string | null)[] }) => r.values);
    expect([rev[2], rev[3], rev[5]]).toEqual(['600.00', '1000.00', '1000.00']);
    expect([exp[2], exp[3], exp[5]]).toEqual(['100.00', '150.00', '150.00']);
    expect(rev[1]).toBe('100.00');
    expect(exp[1]).toBe((Number(exp[0]) * 100 / Number(rev[0])).toFixed(2));
    expect(Number(rev[4])).toBeGreaterThanOrEqual(1000);   // งวดที่ 3 (มี.ค.) รวมรายการที่ลงวันที่ 15/03
    expect([online[0], online[2], online[3]]).toEqual(['400.00', '400.00', '400.00']);   // แผนกของบรรทัดแทนแผนกของคอลัมน์
    expect((await call('POST', '/api/v1/fs/layouts', { code: 'BADDEP', name: 'x', header_lines: [], line_set_code: 'BADDEP', columns: [{ expr: 'BAL' }], lines: [{ line_no: 1, data_type: 'A/C', source: '1111-00', department_id: '00000000-0000-4000-8000-000000000000' }] })).body.error.message).toMatch(/ไม่พบแผนก/);
    expect((await call('POST', '/api/v1/fs/layouts', { code: 'HIDDEN', name: 'x', header_lines: [], line_set_code: 'HIDDEN', columns: [{ expr: 'BAL', hidden: true }] })).body.error.message).toMatch(/อย่างน้อย 1 คอลัมน์ที่พิมพ์/);
    for (const id of [j1, j2]) await call('POST', `/api/v1/gl/journals/${id}/cancel`, { reason: 'ทดสอบแบบงบแยกแผนก' });   // ไม่ให้กระทบยอดของทดสอบข้อถัดไป
  });

  it('every API route has a permission rule (สิทธิ์ T0.10 ครบทุกเส้น)', () => {
    const missing = [...REGISTERED_ROUTES].filter((r) => !API_RULES[r]);
    expect(missing).toEqual([]);
    expect(REGISTERED_ROUTES.size).toBeGreaterThan(60);
  });

  it('enforces approval-level base rights and the 7-right menu table (สิทธิ์ 7 ชนิด S-SEC-01/02/03)', async () => {
    const admin = cookie;
    const as = async (u: string, p: string) => { cookie = ''; expect((await call('POST', '/api/v1/auth/login', { username: u, password: p })).status).toBe(200); return (await call('GET', '/api/v1/auth/me')).body; };
    const tenant_id = (await call('GET', '/api/v1/tenants')).body.find((t: { code: string }) => t.code === 'DEFAULT').id;   // บริษัททดสอบอยู่ในลูกค้าเริ่มต้น
    const grp = (await call('POST', '/api/v1/user-groups', { code: 'ACC', name: 'แผนกบัญชี', tenant_id })).body.id;
    expect((await call('POST', '/api/v1/users', { tenant_id, username: 'clerk0', display_name: 'พนักงาน ระดับ 0', password: 'clerk0pass', approval_level: 0, companies: [companyId] })).status).toBe(200);
    expect((await call('POST', '/api/v1/users', { tenant_id, username: 'boss5', display_name: 'หัวหน้า ระดับ 5', password: 'boss5pass', approval_level: 5, companies: [companyId] })).status).toBe(200);
    const ctl = (await call('POST', '/api/v1/users', { tenant_id, username: 'ctl5', display_name: 'ตรวจสิทธิ์', password: 'ctl5pass', approval_level: 5, check_rights: true, user_group_id: grp, companies: [companyId] })).body.id;
    // ผู้ให้บริการเพิ่มผู้ใช้/กลุ่มโดยไม่ระบุลูกค้า = ใช้ลูกค้าเจ้าของบริษัทที่ให้สิทธิ์ (หรือบริษัทที่เลือกอยู่)
    const inferred = await call('POST', '/api/v1/users', { username: 'noTenant', display_name: 'ไม่ระบุลูกค้า', password: 'noTenant1', companies: [companyId] });
    expect(inferred.status).toBe(200);
    const g2 = (await call('POST', '/api/v1/user-groups', { code: 'ACC2', name: 'กลุ่มที่ไม่ระบุลูกค้า' })).body.id;
    const listed = (await call('GET', '/api/v1/users')).body;
    expect(listed.users.find((u: { username: string }) => u.username === 'noTenant').tenant_id).toBe(tenant_id);
    expect(listed.groups.find((g: { id: string }) => g.id === g2).tenant_id).toBe(tenant_id);
    const jvBody = { journal_book_id: bookId, voucher_date: '2026-04-01', lines: [{ account_id: expense, debit: '10' }, { account_id: cash, credit: '10' }] };

    // ระดับ 0–4: อ่าน/เพิ่ม/แก้ไข/พิมพ์ได้ ยกเลิก/ลบ/กำหนดค่าโปรแกรม/ระบบความปลอดภัยไม่ได้
    let me = await as('clerk0', 'clerk0pass');
    expect([me.perms['GL.JNL'].add, me.perms['GL.JNL'].cancel, me.perms['SET.SEC'].read]).toEqual([true, false, false]);
    expect((await call('GET', '/api/v1/gl/journals')).status).toBe(200);
    const jv0 = (await call('POST', '/api/v1/gl/journals', jvBody)).body.id;
    expect(jv0).toBeTruthy();
    const c0 = await call('POST', `/api/v1/gl/journals/${jv0}/cancel`, { reason: 'ทดสอบ' });
    expect(c0.status).toBe(403); expect(c0.body.error.message).toMatch(/ไม่มีสิทธิ์ยกเลิก/);
    expect((await call('POST', '/api/v1/departments', { code: 'X0', name_th: 'x' })).status).toBe(403);
    expect((await call('GET', '/api/v1/reports/trial-balance?from=2026-01-01&to=2026-12-31')).status).toBe(200);
    expect((await call('GET', '/api/v1/permissions/menus')).status).toBe(403);

    // ระดับ 5–8: ยกเลิกเอกสาร/กำหนดค่าโปรแกรมได้ แต่ระบบความปลอดภัยไม่ได้
    me = await as('boss5', 'boss5pass');
    expect((await call('POST', `/api/v1/gl/journals/${jv0}/cancel`, { reason: 'หัวหน้ายกเลิก' })).status).toBe(200);
    expect((await call('POST', '/api/v1/departments', { code: 'B5', name_th: 'แผนกของหัวหน้า' })).status).toBe(200);
    expect((await call('GET', '/api/v1/permissions/menus')).status).toBe(403);

    // ตรวจสอบสิทธิ์ก่อนใช้งาน: ยังไม่มีตารางสิทธิ์ = ใช้ไม่ได้
    me = await as('ctl5', 'ctl5pass');
    expect(me.perms['GL.JNL'].read).toBe(false);
    expect((await call('GET', '/api/v1/gl/journals')).status).toBe(403);
    // ผู้ดูแลกำหนดสิทธิ์: กลุ่ม = สมุดรายวัน อ่าน Y เพิ่ม L แก้ไข N พิมพ์ S, รายงานทั้งหมดอ่านได้ · ผู้ใช้ = งบทดลองอ่านไม่ได้ (ทับสิทธิ์กลุ่ม)
    cookie = admin;
    const R = (menu_code: string, v: Partial<Record<string, string>>) => ({ menu_code, can_read: '', can_add: '', can_edit: '', can_cancel: '', can_delete: '', can_print: '', can_approve: '', ...v });
    expect((await call('PUT', '/api/v1/permissions', { subject_type: 'G', subject_id: grp, rows: [R('GL.JNL', { can_read: 'Y', can_add: 'L', can_edit: 'N', can_cancel: 'Y', can_print: 'S' }), R('RP', { can_read: 'Y' })] })).status).toBe(200);
    expect((await call('PUT', '/api/v1/permissions', { subject_type: 'U', subject_id: ctl, rows: [R('RP.TB', { can_read: 'N' })] })).status).toBe(200);
    expect((await call('PUT', '/api/v1/permissions', { subject_type: 'U', subject_id: ctl, rows: [R('RP.TB', { can_read: 'S' })] })).body.error.message).toMatch(/S ใช้ได้เฉพาะช่องพิมพ์/);
    const eff = (await call('GET', `/api/v1/permissions?subject_type=U&subject_id=${ctl}`)).body;
    expect([eff.effective['GL.JNL'].read, eff.effective['GL.JNL'].edit, eff.effective['GL.JNL'].print, eff.effective['RP.TB'].read, eff.effective['RP.LEDGER'].read]).toEqual([true, false, 'S', false, true]);
    const byMenu = (await call('GET', '/api/v1/permissions/by-menu?menu_code=GL.JNL')).body;
    expect(byMenu.map((r: { code: string; can_add: string }) => [r.code, r.can_add])).toEqual([['ACC', 'L']]);
    me = await as('ctl5', 'ctl5pass');
    expect((await call('GET', '/api/v1/gl/journals')).status).toBe(200);
    const jv1 = (await call('POST', '/api/v1/gl/journals', jvBody)).body.id;
    expect((await call('PUT', `/api/v1/gl/journals/${jv1}`, jvBody)).status).toBe(403);
    expect((await call('GET', '/api/v1/reports/ledger?account_id=' + cash + '&from=2026-01-01&to=2026-12-31')).status).toBe(200);
    expect((await call('GET', '/api/v1/reports/trial-balance?from=2026-01-01&to=2026-12-31')).status).toBe(403);
    expect((await call('POST', `/api/v1/gl/journals/${jv1}/cancel`, { reason: 'ทดสอบสิทธิ์' })).status).toBe(200);   // ไม่ให้กระทบยอดของทดสอบข้อถัดไป
    // ค่า L = บันทึกเหตุการณ์การใช้งาน
    cookie = admin;
    const log = (await call('GET', '/api/v1/activity-log')).body as Array<{ action: string; username: string | null }>;
    expect(log.some((x) => x.action === 'USE_ADD' && x.username === 'ctl5')).toBe(true);
  });

  it('company defaults per system (ค่าเริ่มต้นแต่ละระบบ บทที่ 5) and voucher numbering styles', async () => {
    let g = (await call('GET', '/api/v1/settings')).body;
    expect([g.values['gen.vat_rate'], g.values['ic.allow_negative'], g.values['ar.aging_overdue'], g.values['gl.voucher_numbering']]).toEqual([7, 'Y', [7, 15, 30], '4']);
    // ตรวจค่าก่อนบันทึก
    let r = await call('PUT', '/api/v1/settings', { values: { 'gen.vat_rate': 50, 'ar.aging_overdue': [30, 15, 7] } });
    expect(r.status).toBe(400); expect(r.body.error.issues).toHaveLength(2); expect(r.body.error.message).toMatch(/ระหว่าง 0 ถึง 30/);
    expect((await call('PUT', '/api/v1/settings', { values: { 'no.such': 1 } })).body.error.message).toMatch(/ไม่รู้จัก/);
    r = await call('PUT', '/api/v1/settings', { values: { 'ic.allow_negative': 'A', 'ic.negative_approve_level': 5, 'ar.credit_tiers': [{ amount: 20000, level: 0 }, { amount: 50000, level: 5 }], 'gen.year_system': 'C' } });
    expect(r.body.changed.sort()).toEqual(['ar.credit_tiers', 'gen.year_system', 'ic.allow_negative', 'ic.negative_approve_level']);
    g = (await call('GET', '/api/v1/settings')).body;
    expect([g.values['ic.allow_negative'], g.values['ar.credit_tiers'][1].level]).toEqual(['A', 5]);
    expect(g.customized).toEqual(expect.arrayContaining(['ic.allow_negative', 'gen.year_system']));
    expect((await call('GET', '/api/v1/auth/me')).body.company.year_system).toBe('C');   // ระบบปีเก็บที่บริษัทด้วย
    expect((await call('PUT', '/api/v1/settings', { values: { 'gen.year_system': 'B' } })).body.changed).toEqual(['gen.year_system']);
    const log = (await call('GET', '/api/v1/activity-log')).body as Array<{ action: string; detail: { changed?: Record<string, unknown> } | null }>;
    expect(log.find((x) => x.action === 'SETTINGS' && x.detail?.changed?.['ic.allow_negative'])?.detail?.changed?.['ic.allow_negative']).toEqual(['Y', 'A']);
    // ลำดับเลขที่ใบสำคัญ แบบ 3 = YYMMxxxx · แบบ 0 = ป้อนเลขเอง
    await call('PUT', '/api/v1/settings', { values: { 'gl.voucher_numbering': '3' } });
    expect((await call('GET', `/api/v1/gl/journals-next-no?book_id=${bookId}&date=2026-05-10`)).body.voucher_no).toBe('JV69050001');
    await call('PUT', '/api/v1/settings', { values: { 'gl.voucher_numbering': '0' } });
    expect((await call('GET', `/api/v1/gl/journals-next-no?book_id=${bookId}&date=2026-05-10`)).body.voucher_no).toBe('');
    const jv = { journal_book_id: bookId, voucher_date: '2026-05-10', lines: [{ account_id: expense, debit: '1' }, { account_id: cash, credit: '1' }] };
    expect((await call('POST', '/api/v1/gl/journals', jv)).body.error.message).toMatch(/ป้อนเลขที่ใบสำคัญ/);
    const manual = await call('POST', '/api/v1/gl/journals', { ...jv, voucher_no: 'MAN-0001' });
    expect(manual.body.voucher_no).toBe('MAN-0001');
    await call('POST', `/api/v1/gl/journals/${manual.body.id}/cancel`, { reason: 'ทดสอบเลขที่ป้อนเอง' });   // ไม่ให้กระทบยอดของทดสอบข้อถัดไป
    await call('PUT', '/api/v1/settings', { values: { 'gl.voucher_numbering': '4' } });
    // พนักงานระดับ 0–4 แก้ค่าเริ่มต้นไม่ได้ (กำหนดค่าโปรแกรม) แต่อ่านได้
    const admin = cookie; cookie = '';
    await call('POST', '/api/v1/auth/login', { username: 'clerk0', password: 'clerk0pass' }); await call('GET', '/api/v1/auth/me');
    expect((await call('GET', '/api/v1/settings')).status).toBe(200);
    expect((await call('PUT', '/api/v1/settings', { values: { 'gen.vat_rate': 7 } })).status).toBe(403);
    cookie = admin;
  });

  it('keeps companies separate', async () => {
    const mine = (await call('GET', '/api/v1/gl/journals')).body.rows[0];
    otherCompanyId = (await call('POST', '/api/v1/companies', { code: 'OTHER', name_th: 'อีกบริษัท', fiscal_start: '2026-01-01', chart: 'none' })).body.id;
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('GET', '/api/v1/gl/accounts')).body).toHaveLength(0);
    // ใช้บัญชีของบริษัทอื่นในใบสำคัญไม่ได้
    const book2 = (await call('GET', '/api/v1/gl/books')).body[0].id;
    const r = await call('POST', '/api/v1/gl/journals', { journal_book_id: book2, voucher_date: '2026-03-01', lines: [{ account_id: cash, debit: '1' }, { account_id: capital, credit: '1' }] });
    expect(r.body.error.message).toMatch(/ไม่พบบัญชี/);
    expect((await call('GET', '/api/v1/gl/journals')).body.total).toBe(0);
    // คัดลอกรายการจากใบสำคัญอื่น (S-GL-06): ค้นหรือเปิดใบสำคัญของบริษัทอื่นไม่ได้ แม้รู้เลขที่/รหัส
    expect((await call('GET', `/api/v1/gl/journals?q=${mine.voucher_no}`)).body.total).toBe(0);
    expect((await call('GET', `/api/v1/gl/journals/${mine.id}`)).status).toBe(404);
    // ยอดปีที่แล้วของบริษัทอื่น: เปิดปีบัญชี/บัญชีของบริษัทอื่นไม่ได้
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    const fyMine = (await call('GET', '/api/v1/gl/periods')).body[0].id;
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('GET', `/api/v1/gl/prior-year?fiscal_year_id=${fyMine}`)).status).toBe(404);
    const ofy = (await call('GET', '/api/v1/gl/periods')).body[0].id;
    expect((await call('GET', `/api/v1/gl/prior-year/entry?fiscal_year_id=${ofy}&account_id=${cash}`)).status).toBe(404);
    expect((await call('PUT', '/api/v1/gl/prior-year/entry', { fiscal_year_id: ofy, account_id: cash, opening: { debit: '1' }, periods: [] })).body.error.message).toMatch(/ไม่พบบัญชี/);
    // รายละเอียดประกอบของบริษัทอื่น (R-GL-01)
    expect((await call('GET', `/api/v1/reports/account-detail?account_id=${cash}&as_of=2026-12-31`)).status).toBe(404);
    // งบประมาณของบริษัทอื่น (S-GL-17)
    expect((await call('GET', `/api/v1/gl/budget?fiscal_year_id=${fyMine}`)).status).toBe(404);
    expect((await call('GET', `/api/v1/gl/budget/entry?fiscal_year_id=${ofy}&account_id=${expense}`)).status).toBe(404);
    expect((await call('PUT', '/api/v1/gl/budget/entry', { fiscal_year_id: ofy, account_id: expense, periods: [{ period_no: 1, amount: '1' }] })).body.error.message).toMatch(/ไม่พบบัญชี/);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    expect((await call('GET', `/api/v1/gl/journals/${mine.id}`)).body.lines.length).toBeGreaterThan(0);
  });

  it('manages journal templates (ต้นแบบวิธีการบันทึก S-GL-01) and isolates them per company', async () => {
    const control = (await call('GET', '/api/v1/gl/accounts')).body.find((a: { account_no: string }) => a.account_no === '1110-00').id;
    // ตรวจข้อมูล: บัญชีคุม, ไม่มีบรรทัด, เงินติดลบ
    let r = await call('POST', '/api/v1/gl/templates', { code: 'BAD', name: 'x', lines: [{ account_id: control, side: 'D' }] });
    expect(r.status).toBe(400); expect(r.body.error.message).toMatch(/บัญชีคุม/);
    expect((await call('POST', '/api/v1/gl/templates', { code: 'BAD', name: 'x', lines: [] })).status).toBe(400);
    expect((await call('POST', '/api/v1/gl/templates', { code: 'BAD', name: 'x', lines: [{ account_id: cash, side: 'D', amount: '-1' }] })).body.error.message).toMatch(/ติดลบ/);
    // สร้าง: จำนวนเงินว่างได้ (ป้อนตอนใช้) หรือกำหนดไว้ก่อน
    r = await call('POST', '/api/v1/gl/templates', { code: 'EXPENSE', name: 'ต้นแบบ บันทึกค่าใช้จ่ายประจำเดือน', lines: [
      { account_id: expense, side: 'D', description: 'ค่าน้ำประจำเดือน' }, { account_id: cash, side: 'C', description: 'จ่ายค่าใช้จ่ายประจำเดือน', amount: '' }] });
    expect(r.status).toBe(200);
    const tplId = r.body.id;
    expect((await call('POST', '/api/v1/gl/templates', { code: 'EXPENSE', name: 'ซ้ำ', lines: [{ account_id: cash, side: 'D' }] })).status).toBe(409);
    let t = (await call('GET', `/api/v1/gl/templates/${tplId}`)).body;
    expect(t.lines.map((l: { account_no: string; side: string; amount: string | null }) => [l.account_no, l.side, l.amount])).toEqual([['5380-06', 'D', null], ['1111-00', 'C', null]]);
    // แก้ไข: แทนบรรทัดทั้งชุด เก็บค่าก่อนแก้ใน log
    expect((await call('PUT', `/api/v1/gl/templates/${tplId}`, { code: 'EXPENSE', name: 'ต้นแบบ ค่าใช้จ่าย', name_en: 'Monthly expense', lines: [
      { account_id: expense, side: 'D', amount: '1500.50' }, { account_id: revenue, side: 'D', amount: '0' }, { account_id: cash, side: 'C', amount: '1500.50' }] })).status).toBe(200);
    t = (await call('GET', `/api/v1/gl/templates/${tplId}`)).body;
    expect(t.name_en).toBe('Monthly expense');
    expect(t.lines.map((l: { line_no: number; amount: string | null }) => [l.line_no, l.amount === null ? null : Number(l.amount)])).toEqual([[1, 1500.5], [2, null], [3, 1500.5]]);
    const list = (await call('GET', '/api/v1/gl/templates')).body;
    expect(list).toHaveLength(1); expect(Number(list[0].line_count)).toBe(3);
    const log = (await call('GET', `/api/v1/activity-log?table=gl_template&row_id=${tplId}`)).body;
    expect(log.map((x: { action: string }) => x.action)).toEqual(expect.arrayContaining(['ADD', 'EDIT']));
    // ผูกต้นแบบกับสมุดรายวัน (S-GL-09) → ลบต้นแบบไม่ได้จนกว่าจะเอาออก
    const book = (await call('GET', '/api/v1/gl/books')).body.find((b: { code: string }) => b.code === '00');
    expect((await call('PUT', `/api/v1/gl/books/${book.id}`, { code: book.code, prefix: book.prefix, name_th: book.name_th, template_id: tplId })).status).toBe(200);
    expect((await call('GET', '/api/v1/gl/books')).body.find((b: { code: string }) => b.code === '00').template_code).toBe('EXPENSE');
    expect((await call('DELETE', `/api/v1/gl/templates/${tplId}`)).body.error.message).toMatch(/สมุดรายวัน 00/);

    // บริษัทอื่นมองไม่เห็น แก้/ลบ/ผูกกับสมุดไม่ได้ และใช้บัญชีของบริษัทนี้ในต้นแบบไม่ได้
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('GET', '/api/v1/gl/templates')).body).toHaveLength(0);
    expect((await call('GET', `/api/v1/gl/templates/${tplId}`)).status).toBe(404);
    expect((await call('PUT', `/api/v1/gl/templates/${tplId}`, { code: 'X', name: 'x', lines: [{ account_id: cash, side: 'D' }] })).status).toBe(404);
    expect((await call('DELETE', `/api/v1/gl/templates/${tplId}`)).status).toBe(404);
    expect((await call('POST', '/api/v1/gl/templates', { code: 'X', name: 'x', lines: [{ account_id: cash, side: 'D' }] })).body.error.message).toMatch(/ไม่พบบัญชี/);
    const ob = (await call('GET', '/api/v1/gl/books')).body[0];
    expect((await call('PUT', `/api/v1/gl/books/${ob.id}`, { code: ob.code, prefix: ob.prefix, name_th: ob.name_th, template_id: tplId })).status).toBe(400);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });

    expect((await call('PUT', `/api/v1/gl/books/${book.id}`, { code: book.code, prefix: book.prefix, name_th: book.name_th, template_id: null })).status).toBe(200);
    expect((await call('DELETE', `/api/v1/gl/templates/${tplId}`)).status).toBe(200);
    expect((await call('GET', '/api/v1/gl/templates')).body).toHaveLength(0);
    expect((await call('GET', `/api/v1/gl/templates/${tplId}`)).status).toBe(404);
  });

  it('customers, suppliers and salespersons (บทที่ 7 S-AR-01 / S-AP-01 / S-SO-01) with company isolation', async () => {
    const accs = (await call('GET', '/api/v1/gl/accounts')).body as Array<{ id: string; account_no: string; is_control: boolean }>;
    const control = accs.find((x) => x.account_no === '1110-00')!.id;
    const lk = (await call('GET', '/api/v1/lookups?types=40,45,BANK')).body;
    expect(Object.keys(lk).sort()).toEqual(['40', '45', 'BANK']);
    // พนักงานขาย + เป้าการขาย 24 งวด
    const slm = await call('POST', '/api/v1/salespersons', { code: 'S01', name: 'สมชาย ขายเก่ง', commission_rate: 2.5 });
    expect(slm.status).toBe(200);
    const slmDetail = (await call('GET', `/api/v1/salespersons/${slm.body.id}`)).body;
    expect(slmDetail.targets.length).toBeGreaterThanOrEqual(12);
    expect(slmDetail.targets.length).toBeLessThanOrEqual(24);
    const tgt = slmDetail.targets.slice(0, 2).map((t: { period_id: string }, i: number) => ({ period_id: t.period_id, amount: i === 0 ? '100000.50' : 0 }));
    expect((await call('PUT', `/api/v1/salespersons/${slm.body.id}`, { code: 'S01', name: 'สมชาย ขายเก่ง', commission_rate: 2.5, targets: tgt })).status).toBe(200);
    expect((await call('GET', `/api/v1/salespersons/${slm.body.id}`)).body.targets[0].amount).toBe('100000.50');
    expect((await call('POST', '/api/v1/salespersons', { code: 'S01', name: 'ซ้ำ' })).status).toBe(409);
    // ลูกค้า: เลขผู้เสียภาษีบังคับป้อน (ค่าเริ่มต้น 5.3 ไม่ติ๊ก) และต้องถูกหลักตรวจสอบ
    const cust = { code: 'C001', name: 'บริษัท ลูกค้า จำกัด', tax_id: '0105537095903', tax_branch_no: '0', credit_days: 30, credit_limit: '50000', salesperson_id: slm.body.id,
      ship_tos: [{ code: 'WH1', address_1: 'คลังสินค้า 1' }], default_ship_to: 'WH1', contacts: [{ name: 'คุณจัดซื้อ', position: 'จัดซื้อ', is_primary: true }, { name: 'คุณบัญชี', email: 'ac@example.com' }] };
    expect((await call('POST', '/api/v1/customers', { ...cust, tax_id: '' })).body.error.message).toMatch(/ป้อนเลขประจำตัวผู้เสียภาษี/);
    expect((await call('POST', '/api/v1/customers', { ...cust, tax_id: '0105537095904' })).status).toBe(400);
    expect((await call('POST', '/api/v1/customers', { ...cust, ar_account_id: control })).body.error.message).toMatch(/บัญชีคุม/);
    expect((await call('POST', '/api/v1/customers', { ...cust, default_ship_to: 'XX' })).status).toBe(400);
    const c1 = await call('POST', '/api/v1/customers', cust);
    expect(c1.status).toBe(200);
    expect((await call('POST', '/api/v1/customers', cust)).status).toBe(409);
    const cd = (await call('GET', `/api/v1/customers/${c1.body.id}`)).body;
    expect(cd).toMatchObject({ code: 'C001', tax_branch_no: '00000', credit_limit: '50000.00', balance: '0.00', default_ship_to: 'WH1' });
    expect(cd.ship_tos).toHaveLength(1);
    expect(cd.contacts.map((x: { name: string }) => x.name)).toEqual(['คุณจัดซื้อ', 'คุณบัญชี']);
    expect((await call('PUT', `/api/v1/customers/${c1.body.id}`, { ...cust, name: 'บริษัท ลูกค้าใหม่ จำกัด', contacts: [{ name: 'คนเดียว' }], ship_tos: [], default_ship_to: null, status: 'I' })).status).toBe(200);
    const cd2 = (await call('GET', `/api/v1/customers/${c1.body.id}`)).body;
    expect(cd2.contacts).toHaveLength(1); expect(cd2.ship_tos).toHaveLength(0); expect(cd2.inactive_date).toBeTruthy();
    expect((await call('GET', `/api/v1/customers?q=${encodeURIComponent('ลูกค้าใหม่')}`)).body.total).toBe(0);              // เลิกใช้ไม่แสดงตามค่าเริ่มต้น
    expect((await call('GET', `/api/v1/customers?q=${encodeURIComponent('ลูกค้าใหม่')}&status=all`)).body.rows[0].salesperson_code).toBe('S01');
    // พนักงานขายที่มีลูกค้าแล้วลบไม่ได้
    expect((await call('DELETE', `/api/v1/salespersons/${slm.body.id}`)).body.error.message).toMatch(/เลิกใช้แทน/);
    // ผู้จำหน่าย + บัญชีธนาคาร
    const sup = { code: 'V001', name: 'ร้านผู้จำหน่าย', tax_id: '0105537095903', wht_form: '53', wht_rate: 3, banks: [{ bank_code: 'KBANK', account_no: '123-4-56789-0', is_default: true }], contacts: [{ name: 'คุณขาย' }] };
    expect((await call('POST', '/api/v1/suppliers', { ...sup, wht_rate: 150 })).status).toBe(400);
    expect((await call('POST', '/api/v1/suppliers', { ...sup, banks: [sup.banks[0], sup.banks[0]] })).body.error.message).toMatch(/บัญชีเดียว/);
    const s1 = await call('POST', '/api/v1/suppliers', sup);
    expect(s1.status).toBe(200);
    expect((await call('GET', `/api/v1/suppliers/${s1.body.id}`)).body).toMatchObject({ code: 'V001', banks: [{ account_no: '123-4-56789-0', is_default: true }], contacts: [{ name: 'คุณขาย' }] });
    expect((await call('GET', '/api/v1/suppliers?q=V00')).body.rows.map((r: { code: string }) => r.code)).toEqual(['V001']);
    // บริษัทอื่นมองไม่เห็น/แก้/ลบไม่ได้ แม้รู้รหัส
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('GET', '/api/v1/customers?status=all')).body.total).toBe(0);
    expect((await call('GET', `/api/v1/customers/${c1.body.id}`)).status).toBe(404);
    expect((await call('PUT', `/api/v1/customers/${c1.body.id}`, cust)).status).toBe(400);           // พนักงานขายของบริษัทอื่นอ้างอิงไม่ได้
    expect((await call('PUT', `/api/v1/customers/${c1.body.id}`, { ...cust, salesperson_id: null })).status).toBe(404);
    expect((await call('DELETE', `/api/v1/customers/${c1.body.id}`)).status).toBe(404);
    expect((await call('GET', `/api/v1/suppliers/${s1.body.id}`)).status).toBe(404);
    expect((await call('PUT', `/api/v1/suppliers/${s1.body.id}`, sup)).status).toBe(404);
    expect((await call('DELETE', `/api/v1/suppliers/${s1.body.id}`)).status).toBe(404);
    expect((await call('GET', `/api/v1/salespersons/${slm.body.id}`)).status).toBe(404);
    expect((await call('PUT', `/api/v1/salespersons/${slm.body.id}`, { code: 'S01', name: 'x' })).status).toBe(404);
    expect((await call('GET', '/api/v1/salespersons')).body).toHaveLength(0);
    // ตั้งค่า 5.3 ยอมให้ว่างได้ → เพิ่มลูกค้าไม่มีเลขผู้เสียภาษีได้ (เฉพาะบริษัทนี้)
    expect((await call('PUT', '/api/v1/settings', { values: { 'gen.allow_blank_party_tax_id': true } })).status).toBe(200);
    expect((await call('POST', '/api/v1/customers', { code: 'C001', name: 'ลูกค้าเงินสด' })).status).toBe(200);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    expect((await call('POST', '/api/v1/customers', { code: 'C002', name: 'ลูกค้าเงินสด' })).status).toBe(400);
    // รายเดิมที่ไม่มีเลข (ย้ายมาจาก Express) ยังแก้ไขได้ แต่รายที่มีเลขแล้วลบเลขออกไม่ได้
    const legacy = (await sql<{ id: string }>`INSERT INTO md_customer (company_id, code, name) VALUES (${companyId}, 'OLD1', 'ลูกค้าต่างประเทศเดิม') RETURNING id`.execute(database.db)).rows[0]!.id;
    expect((await call('PUT', `/api/v1/customers/${legacy}`, { code: 'OLD1', name: 'ลูกค้าต่างประเทศเดิม', phone: '+61 2 1234' })).status).toBe(200);
    expect((await call('PUT', `/api/v1/customers/${c1.body.id}`, { ...cust, tax_id: '' })).body.error.message).toMatch(/ยอมให้เลขผู้เสียภาษีว่างได้/);
    // ลบได้เมื่อยังไม่มีเอกสาร
    expect((await call('DELETE', `/api/v1/suppliers/${s1.body.id}`)).status).toBe(200);
    expect((await call('GET', `/api/v1/suppliers/${s1.body.id}`)).status).toBe(404);
  });

  it('item master: account groups, items, kits, services, other income/expense, prices, reorder (บทที่ 7 / S-SET-04)', async () => {
    const accs = (await call('GET', '/api/v1/gl/accounts')).body as Array<{ id: string; account_no: string; is_control: boolean }>;
    const leaf = accs.filter((x) => !x.is_control);
    const acc = (no: string) => accs.find((x) => x.account_no === no)?.id ?? leaf[0]!.id;
    const control = accs.find((x) => x.is_control)!.id;
    // หน่วยนับ/คลัง ยังไม่มีหน้าจอ (T1.17) — ใส่ตรงเข้าฐานข้อมูล
    const ins = async (t: string, code: string, name: string) => (await sql<{ id: string }>`INSERT INTO ${sql.table(t)} (company_id, code, name_th) VALUES (${companyId}, ${code}, ${name}) RETURNING id`.execute(database.db)).rows[0]!.id;
    const pcs = await ins('md_unit', 'PCS', 'ชิ้น'), box = await ins('md_unit', 'BOX', 'กล่อง');
    const wh1 = await ins('md_warehouse', '01', 'สนญ.'), wh2 = await ins('md_warehouse', '02', 'คลังสาขา');
    expect(Object.keys((await call('GET', '/api/v1/lookups?types=UNIT,WH,IAG,22')).body).sort()).toEqual(['22', 'IAG', 'UNIT', 'WH']);
    // กลุ่มบัญชีสินค้า (S-SET-04)
    const grpBody = { code: 'st01', name_th: 'สินค้าสำเร็จรูป FIFO', cost_method: 'F', inventory_account_id: leaf[0]!.id, cogs_account_id: leaf[1]!.id };
    expect((await call('POST', '/api/v1/item-account-groups', { ...grpBody, cogs_account_id: null })).status).toBe(400);
    expect((await call('POST', '/api/v1/item-account-groups', { ...grpBody, sales_account_id: control })).body.error.message).toMatch(/บัญชีคุม/);
    expect((await call('POST', '/api/v1/item-account-groups', { ...grpBody, code: 'TOOLONG' })).status).toBe(400);
    const grp = (await call('POST', '/api/v1/item-account-groups', grpBody)).body.id;
    expect((await call('POST', '/api/v1/item-account-groups', grpBody)).status).toBe(409);
    expect((await call('GET', '/api/v1/item-account-groups')).body.map((g: { code: string }) => g.code)).toEqual(['ST01']);
    // สินค้า (S-IC-01) — รหัสตามรูปแบบ เริ่มระบบ 1.3.1
    await call('PUT', '/api/v1/settings', { values: { 'ic.item_code_mask': '99-!!!!-!!!!!!' } });
    const item = { code: '01-intl-cl-600', name_th: 'ซีพียู อินเทล', base_unit_id: pcs, sales_unit_id: box, sales_factor: 10, account_group_id: grp, price_1: '7500', std_cost: '6000', vat_code: '1', allow_negative: 'N', udf_date_1: '2027-01-31' };
    expect((await call('POST', '/api/v1/items', { ...item, code: 'AB-INTL' })).body.error.message).toMatch(/รูปแบบ 99-!!!!-!!!!!!/);
    expect((await call('POST', '/api/v1/items', { ...item, base_unit_id: null })).body.error.message).toMatch(/หน่วยนับ/);
    expect((await call('POST', '/api/v1/items', { ...item, sales_factor: 0 })).status).toBe(400);
    const cpu = await call('POST', '/api/v1/items', item);
    expect(cpu.status).toBe(200);
    const cpuD = (await call('GET', `/api/v1/items/${cpu.body.id}`)).body;
    expect(cpuD).toMatchObject({ code: '01-INTL-CL-600', item_type: '0', account_group: { code: 'ST01' }, totals: { qty: '0' } });
    expect((await call('POST', '/api/v1/items', { ...item, name_th: 'ซ้ำ' })).status).toBe(409);
    const ram = (await call('POST', '/api/v1/items', { ...item, code: '03-KING-8GB', name_th: 'แรม', price_1: '900', std_cost: '700', udf_date_1: null })).body.id;
    expect((await call('GET', '/api/v1/items?q=INTL')).body.rows.map((r: { code: string }) => r.code)).toEqual(['01-INTL-CL-600']);
    // สินค้าชุด (S-IC-03/04) — ชุดธรรมดา 1 / ชุดพิเศษ 2, ส่วนประกอบต้องมีอยู่แล้ว
    const kit = { code: '80-PMTH-CL600', name_th: 'ชุดคอมพิวเตอร์', item_type: '1', base_unit_id: pcs, item_level: '11', price_1: '27500', bom: [{ component_item_id: cpu.body.id, qty: 1 }, { component_item_id: ram, qty: '2', sell_price: '900' }] };
    expect((await call('POST', '/api/v1/kits', { ...kit, bom: [] })).body.error.message).toMatch(/อย่างน้อย 1/);
    const k1 = await call('POST', '/api/v1/kits', kit);
    expect(k1.status).toBe(200);
    expect((await call('PUT', `/api/v1/kits/${k1.body.id}`, { ...kit, bom: [{ component_item_id: k1.body.id, qty: 1 }] })).body.error.message).toMatch(/ตัวสินค้าชุดเอง/);
    const k2 = (await call('POST', '/api/v1/kits', { ...kit, code: '81-SETB-BIG', item_type: '2', item_level: '12', bom: [{ component_item_id: k1.body.id, qty: 1 }] })).body.id;
    expect((await call('PUT', `/api/v1/kits/${k1.body.id}`, { ...kit, bom: [{ component_item_id: k2, qty: 1 }] })).body.error.message).toMatch(/วนกลับ/);
    expect((await call('POST', '/api/v1/kits', { ...kit, code: '82-SAME-LVL', bom: [{ component_item_id: k1.body.id, qty: 1 }] })).body.error.message).toMatch(/ระดับสินค้าต่างกัน/);
    const kd = (await call('GET', `/api/v1/kits/${k1.body.id}`)).body;
    expect(kd.bom.map((b: { component_code: string; qty: string }) => [b.component_code, Number(b.qty)])).toEqual([['01-INTL-CL-600', 1], ['03-KING-8GB', 2]]);
    const copy = await call('POST', `/api/v1/kits/${k1.body.id}/copy`, { code: '80-PMTH-COPY' });
    expect(copy.status).toBe(200);
    expect((await call('GET', `/api/v1/kits/${copy.body.id}`)).body.bom).toHaveLength(2);
    expect((await call('GET', `/api/v1/items/${k1.body.id}`)).status).toBe(404);          // ชุดไม่อยู่ในหน้าสินค้า
    expect((await call('DELETE', `/api/v1/items/${ram}`)).body.error.message).toMatch(/สินค้าประกอบ/);
    // สินค้าบริการ (S-IC-05): บัญชีเก็บในกลุ่มเฉพาะสินค้า ไม่แสดงในรายการกลุ่ม
    const rev = acc('4100-01'), cost = leaf[2]!.id, wage = leaf[3]!.id;
    const srv = { code: '93-4100-XX', name_th: 'ค่าติดตั้ง', base_unit_id: pcs, price_1: '500', accounts: { revenue: rev } };
    expect((await call('POST', '/api/v1/services', { ...srv, accounts: {} })).body.error.message).toMatch(/บัญชีรายได้/);
    expect((await call('POST', '/api/v1/services', { ...srv, std_cost: '100' })).body.error.message).toMatch(/ต้นทุนบริการ/);
    const s1 = await call('POST', '/api/v1/services', { ...srv, std_cost: '100', accounts: { revenue: rev, cost_dr: cost, cost_cr: wage } });
    expect(s1.status).toBe(200);
    expect((await call('GET', `/api/v1/services/${s1.body.id}`)).body.accounts).toMatchObject({ revenue: rev, revenue_return: null, cost_dr: cost, cost_cr: wage });
    expect((await call('PUT', `/api/v1/services/${s1.body.id}`, { ...srv, accounts: { revenue: rev, revenue_return: leaf[4]!.id } })).status).toBe(200);
    expect((await call('GET', `/api/v1/services/${s1.body.id}`)).body.accounts).toMatchObject({ revenue_return: leaf[4]!.id, cost_dr: null });
    expect((await call('GET', '/api/v1/item-account-groups')).body).toHaveLength(1);
    // รายได้อื่น (S-SO-02) / ค่าใช้จ่ายอื่น (S-AP-02)
    expect((await call('POST', '/api/v1/other-incomes', { code: '94-4100-02', name_th: 'ค่าบริการซ่อม', accounts: { revenue: rev } })).status).toBe(200);
    expect((await call('POST', '/api/v1/other-expenses', { code: '95-5200-02', name_th: 'ค่าโฆษณา' })).body.error.message).toMatch(/บัญชีค่าใช้จ่าย/);
    const ex = await call('POST', '/api/v1/other-expenses', { code: '95-5200-02', name_th: 'ค่าโฆษณา', price_1: '1500', accounts: { expense: leaf[5]!.id } });
    expect((await call('GET', `/api/v1/other-expenses/${ex.body.id}`)).body.accounts.expense).toBe(leaf[5]!.id);
    expect((await call('POST', '/api/v1/other-incomes', { code: '95-5200-02', name_th: 'ซ้ำกับค่าใช้จ่าย', accounts: { revenue: rev } })).body.error.message).toMatch(/ค่าใช้จ่ายอื่น/);
    // ตารางราคาขาย (S-IC-06): ราคาหลัก + ราคาเสริมตามปริมาณ/ช่วงเวลา
    const prices = { sales_unit_id: pcs, sales_factor: 1, price_1: '7500', price_2: '7900', breaks: [{ unit_id: pcs, min_qty: 10, price_1: '7000', start_date: '2026-06-08', end_date: '2026-06-16' }, { unit_id: pcs, min_qty: 15, is_percent: true, price_1: '2' }] };
    expect((await call('PUT', `/api/v1/items/${cpu.body.id}/prices`, { ...prices, breaks: [{ min_qty: 5, start_date: '2026-06-16', end_date: '2026-06-08' }] })).body.error.message).toMatch(/วันสิ้นสุดก่อนวันเริ่ม/);
    expect((await call('PUT', `/api/v1/items/${cpu.body.id}/prices`, prices)).status).toBe(200);
    const pr = (await call('GET', `/api/v1/items/${cpu.body.id}/prices`)).body;
    expect(pr.price_2).toMatch(/^7900/); expect(pr.breaks).toHaveLength(2);
    // จุดสั่งซื้อ (S-IC-07) แยกคลัง/ช่วงเวลา
    const ro = { rows: [{ warehouse_id: wh1, start_mmdd: '0101', min_qty: 20, max_qty: 100, order_qty: 50 }, { warehouse_id: wh1, start_mmdd: '1201', min_qty: 50 }, { warehouse_id: wh2, start_mmdd: '0101', min_qty: 5 }] };
    expect((await call('PUT', `/api/v1/items/${cpu.body.id}/reorder`, { rows: [{ ...ro.rows[0], start_mmdd: '1301' }] })).status).toBe(400);
    expect((await call('PUT', `/api/v1/items/${cpu.body.id}/reorder`, { rows: [ro.rows[0], ro.rows[0]] })).body.error.message).toMatch(/ซ้ำ/);
    expect((await call('PUT', `/api/v1/items/${cpu.body.id}/reorder`, { rows: [{ ...ro.rows[0], max_qty: 10 }] })).body.error.message).toMatch(/จำนวนสูงสุด/);
    expect((await call('PUT', `/api/v1/items/${cpu.body.id}/reorder`, ro)).status).toBe(200);
    expect((await call('GET', `/api/v1/items/${cpu.body.id}/reorder`)).body.rows).toHaveLength(3);
    // ลบได้เมื่อไม่มีเอกสาร/สต๊อก — ลบกลุ่มที่ยังใช้อยู่ไม่ได้
    expect((await call('DELETE', `/api/v1/item-account-groups/${grp}`)).body.error.message).toMatch(/ใช้อยู่กับสินค้า/);
    expect((await call('DELETE', `/api/v1/other-expenses/${ex.body.id}`)).status).toBe(200);
    // บริษัทอื่น/ลูกค้ารายอื่นมองไม่เห็น แก้ไม่ได้
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('GET', '/api/v1/items?status=all')).body.total).toBe(0);
    expect((await call('GET', `/api/v1/items/${cpu.body.id}`)).status).toBe(404);
    expect((await call('PUT', `/api/v1/items/${cpu.body.id}`, { ...item, base_unit_id: null })).status).toBe(404);
    expect((await call('GET', `/api/v1/items/${cpu.body.id}/prices`)).status).toBe(404);
    expect((await call('PUT', `/api/v1/items/${cpu.body.id}/reorder`, { rows: [] })).status).toBe(404);
    expect((await call('POST', `/api/v1/kits/${k1.body.id}/copy`, { code: 'X1' })).status).toBe(404);
    expect((await call('PUT', `/api/v1/item-account-groups/${grp}`, grpBody)).status).toBe(400);   // บัญชีของบริษัทอื่นอ้างอิงไม่ได้
    expect((await call('DELETE', `/api/v1/item-account-groups/${grp}`)).status).toBe(404);
    expect((await call('GET', '/api/v1/item-account-groups')).body).toHaveLength(0);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
  });

  it('sample Thai–English chart: new company template, add accounts, fill English names', async () => {
    expect((await call('GET', '/api/v1/gl/chart-templates')).body.map((t: { key: string }) => t.key)).toEqual(['express', 'th_en']);
    // บริษัทใหม่จากผังตัวอย่าง: บัญชีครบ + บทบาทบัญชีลงรายวันอัตโนมัติครบ
    const th = (await call('POST', '/api/v1/companies', { code: 'THEN', name_th: 'ผังไทยอังกฤษ', fiscal_start: '2026-01-01', chart: 'th_en' })).body.id;
    await call('POST', '/api/v1/auth/select', { company_id: th });
    const accs = (await call('GET', '/api/v1/gl/accounts')).body as Array<{ account_no: string; name_en: string | null; is_control: boolean; level: number }>;
    expect(accs.length).toBeGreaterThan(250);
    expect(accs.find((x) => x.account_no === '1111-01')).toMatchObject({ name_en: 'Cash', is_control: false });
    const roles = (await sql<{ n: number }>`SELECT count(*) AS n FROM gl_default_account WHERE company_id = ${th}`.execute(database.db)).rows[0]!.n;
    expect(Number(roles)).toBe(36);
    // บริษัทที่ไม่มีผัง: เพิ่มบัญชีจากผังตัวอย่าง (บัญชีคุมเพิ่มให้เอง)
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    const before = (await call('GET', '/api/v1/gl/accounts')).body.length;
    const cmp = (await call('GET', '/api/v1/gl/chart-templates/th_en')).body;
    expect(cmp.accounts.find((x: { no: string }) => x.no === '4400-01').exists).toBe(false);
    const r = await call('POST', '/api/v1/gl/chart-templates/th_en/apply', { add: ['4400-01', '4400-02'] });
    expect(r.body.added).toEqual(['4000-00', '4400-00', '4400-01', '4400-02']);
    const after = (await call('GET', '/api/v1/gl/accounts')).body as Array<{ account_no: string; parent_id: string | null; id: string; level: number }>;
    expect(after.length).toBe(before + 4);
    const p = after.find((x) => x.account_no === '4400-00')!;
    expect(after.find((x) => x.account_no === '4400-01')).toMatchObject({ parent_id: p.id, level: p.level + 1 });
    expect((await call('POST', '/api/v1/gl/chart-templates/th_en/apply', { add: ['4400-01'] })).body.added).toEqual([]);   // มีแล้วไม่เพิ่มซ้ำ
    expect((await call('POST', '/api/v1/gl/chart-templates/th_en/apply', { add: ['0000-00'] })).status).toBe(400);
    // เติมชื่ออังกฤษตามชื่อไทยที่ตรงกัน (ไม่ทับชื่อเดิม)
    await sql`UPDATE gl_account SET name_en = NULL WHERE company_id = ${otherCompanyId} AND account_no = '4400-02'`.execute(database.db);
    await sql`INSERT INTO gl_account (company_id, account_no, name_th, name_en, level, account_group, is_control, normal_side) VALUES (${otherCompanyId}, '4400-09', 'ค่าแปลเอกสาร', 'My own name', 3, '4', false, 'C')`.execute(database.db);
    expect((await call('GET', '/api/v1/gl/chart-templates/th_en')).body.english_fillable).toBe(1);
    expect((await call('POST', '/api/v1/gl/chart-templates/th_en/apply', { fill_english: true })).body.filled).toBe(1);
    const en = (await call('GET', '/api/v1/gl/accounts')).body as Array<{ account_no: string; name_en: string | null }>;
    expect(en.find((x) => x.account_no === '4400-02')!.name_en).toBe('Language Teaching Revenue');
    expect(en.find((x) => x.account_no === '4400-09')!.name_en).toBe('My own name');
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
  });

  it('bank accounts (S-CQ-01) and receipt/payment methods (S-SET-06/08)', async () => {
    const accs = (await call('GET', '/api/v1/gl/accounts')).body as Array<{ id: string; account_no: string; is_control: boolean }>;
    const leaf = accs.filter((x) => !x.is_control), control = accs.find((x) => x.is_control)!.id;
    const bank = (await sql<{ id: string }>`INSERT INTO md_bank (company_id, code, name_th) VALUES (${companyId}, 'BBL', 'ธนาคารกรุงเทพ') RETURNING id`.execute(database.db)).rows[0]!.id;
    expect((await call('GET', '/api/v1/lookups?types=BANK')).body.BANK[0]).toMatchObject({ id: bank, code: 'BBL' });
    const c1 = { code: 'c1', name: 'กระแสรายวัน ธ.กรุงเทพ 111222', bank_id: bank, account_number: '123-0-111222', account_kind: 'C', gl_account_id: leaf[0]!.id, opening_balance: '1000.5', opening_date: '2026-01-01' };
    expect((await call('POST', '/api/v1/bank-accounts', { ...c1, gl_account_id: control })).body.error.message).toMatch(/บัญชีคุม/);
    expect((await call('POST', '/api/v1/bank-accounts', { ...c1, gl_account_id: null })).status).toBe(400);
    const b1 = (await call('POST', '/api/v1/bank-accounts', c1)).body.id;
    expect((await call('POST', '/api/v1/bank-accounts', c1)).status).toBe(409);
    expect((await call('GET', '/api/v1/bank-accounts')).body[0]).toMatchObject({ code: 'C1', bank_code: 'BBL', opening_balance: '1000.50' });
    // วิธีรับชำระ: เช็ค (ต้องผ่านเช็ค) · เงินโอน (ต้องเลือกธนาคาร) · เงินสด (เลขที่บัญชี)
    const rows = [
      { seq: '01', code: 'qr', name_th: 'เช็ครับ', name_en: 'Cheque', kind: 'CHEQUE', creates_cheque: true, gl_account_id: leaf[1]!.id },
      { seq: '02', code: 'CH', name_th: 'รับเงินสด', kind: 'CASH', gl_account_id: leaf[2]!.id },
      { seq: '03', code: 'TR', name_th: 'เงินโอนเข้าบัญชี', kind: 'TRANSFER', bank_account_id: b1 },
    ];
    expect((await call('PUT', '/api/v1/payment-methods/R', { rows: [{ ...rows[2], bank_account_id: null }] })).body.error.message).toMatch(/ธนาคาร/);
    expect((await call('PUT', '/api/v1/payment-methods/R', { rows: [{ ...rows[1], gl_account_id: null }] })).body.error.message).toMatch(/เลขที่บัญชี/);
    expect((await call('PUT', '/api/v1/payment-methods/R', { rows: [rows[1], rows[1]] })).body.error.message).toMatch(/ซ้ำ/);
    expect((await call('PUT', '/api/v1/payment-methods/R', { rows })).status).toBe(200);
    let got = (await call('GET', '/api/v1/payment-methods/R')).body;
    expect(got.map((r: { code: string }) => r.code)).toEqual(['QR', 'CH', 'TR']);
    expect((await call('GET', '/api/v1/payment-methods/P')).body).toHaveLength(0);           // รับ/จ่ายแยกกัน
    // สลับรหัสกันในการบันทึกครั้งเดียวได้ + ลบบรรทัดที่ยังไม่ใช้
    const swap = got.filter((r: { code: string }) => r.code !== 'TR').map((r: { id: string; code: string }) => ({ ...r, code: r.code === 'QR' ? 'CH' : 'QR', used: undefined, account_no: undefined, bank_code: undefined }));
    expect((await call('PUT', '/api/v1/payment-methods/R', { rows: swap })).status).toBe(200);
    got = (await call('GET', '/api/v1/payment-methods/R')).body;
    expect(got.map((r: { code: string; name_th: string }) => `${r.code}:${r.name_th}`).sort()).toEqual(['CH:เช็ครับ', 'QR:รับเงินสด']);
    // บัญชีเงินฝากที่ผูกกับวิธีชำระลบไม่ได้ (TR ถูกลบไปแล้ว — ผูกใหม่)
    await call('PUT', '/api/v1/payment-methods/P', { rows: [{ seq: '01', code: 'TN', name_th: 'เงินโอนถอนจาก C1', kind: 'TRANSFER', bank_account_id: b1 }] });
    expect((await call('DELETE', `/api/v1/bank-accounts/${b1}`)).body.error.message).toMatch(/เลิกใช้แทน/);
    // บริษัทอื่นมองไม่เห็น/แก้ไม่ได้
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('GET', '/api/v1/bank-accounts')).body).toHaveLength(0);
    expect((await call('GET', '/api/v1/payment-methods/R')).body).toHaveLength(0);
    expect((await call('PUT', `/api/v1/bank-accounts/${b1}`, { ...c1, gl_account_id: (await call('GET', '/api/v1/gl/accounts')).body.find((x: { is_control: boolean }) => !x.is_control).id })).status).toBe(404);
    expect((await call('DELETE', `/api/v1/bank-accounts/${b1}`)).status).toBe(404);
    expect((await call('PUT', '/api/v1/payment-methods/R', { rows: [{ ...got[0], used: undefined, account_no: undefined, bank_code: undefined }] })).status).toBe(400);   // บัญชีของบริษัทอื่น
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
  });

  it('document types & numbering (S-DN-01/02) and GL link (S-GL-01/02)', async () => {
    const list = (await call('GET', '/api/v1/doc-types')).body as Array<{ id: string; code: string; doc_class: string; book_code: string | null; next_no: string }>;
    expect(list.length).toBe(34);                                           // ประเภทเอกสารมาตรฐานของบริษัทใหม่
    expect(list.find((t) => t.code === 'IV')).toMatchObject({ doc_class: 'IV', book_code: '03' });
    expect(list.find((t) => t.code === 'SR')!.doc_class).toBe('CN');        // หมวดกับ prefix ต่างกันได้
    const accs = (await call('GET', '/api/v1/gl/accounts')).body as Array<{ id: string; account_no: string; is_control: boolean }>;
    const leaf = accs.filter((x) => !x.is_control), control = accs.find((x) => x.is_control)!.id;
    const books = (await call('GET', '/api/v1/gl/books')).body as Array<{ id: string; code: string }>;
    const ie = { code: 'ie', doc_class: 'IV', name_th: 'ขายเงินเชื่อ-ต่างประเทศ', name_en: 'Export Sales', next_no: '0000101', journal_book_id: books.find((b) => b.code === '03')!.id, approve_level: 5, vat_rate: 0 };
    expect((await call('POST', '/api/v1/doc-types', { ...ie, code: 'I/' })).body.error.message).toMatch(/คั่น/);
    expect((await call('POST', '/api/v1/doc-types', { ...ie, next_no: '12345678' })).body.error.message).toMatch(/7 หลัก/);
    expect((await call('POST', '/api/v1/doc-types', { ...ie, doc_class: 'ZZ' })).status).toBe(400);
    expect((await call('POST', '/api/v1/doc-types', { ...ie, code: 'IV' })).status).toBe(409);
    expect((await call('POST', '/api/v1/doc-types', { ...ie, approve_level: 12 })).status).toBe(400);
    const r = await call('POST', '/api/v1/doc-types', ie);
    expect(r.status).toBe(200);
    expect((await call('PUT', `/api/v1/doc-types/${r.body.id}`, { ...ie, accounts: [{ slot: 1, account_id: control }] })).body.error.message).toMatch(/บัญชีคุม/);
    expect((await call('PUT', `/api/v1/doc-types/${r.body.id}`, { ...ie, accounts: [{ slot: 1, account_id: leaf[0]!.id }, { slot: 1, account_id: leaf[1]!.id }] })).body.error.message).toMatch(/ซ้ำ/);
    expect((await call('PUT', `/api/v1/doc-types/${r.body.id}`, { ...ie, accounts: [{ slot: 1, account_id: leaf[0]!.id }, { slot: 3, account_id: leaf[1]!.id }] })).status).toBe(200);
    const det = (await call('GET', `/api/v1/doc-types/${r.body.id}`)).body;
    expect(det).toMatchObject({ code: 'IE', next_no: expect.anything(), approve_level: 5, doc_count: 0 });
    expect(Number(det.next_no)).toBe(101);
    expect(det.accounts.map((x: { slot: number }) => x.slot)).toEqual([1, 3]);
    expect((await call('PUT', `/api/v1/doc-types/${r.body.id}`, { ...ie, accounts: [] })).status).toBe(200);
    expect((await call('GET', `/api/v1/doc-types/${r.body.id}`)).body.accounts).toHaveLength(0);
    // การเชื่อมต่อบัญชี: บัญชีเพื่อลงรายวันที่ผังของบริษัทกำหนด (34 บทบาท) + สมุดรายวันของรายการ
    const link = (await call('GET', '/api/v1/gl/link')).body;
    expect(link.link_gl).toBe(true);
    expect(link.defaults.length).toBe(34);
    expect((await call('PUT', '/api/v1/gl/link', { link_gl: true, defaults: [{ role: 'SUSPENSE', account_id: null }] })).body.error.message).toMatch(/บัญชีพัก/);
    expect((await call('PUT', '/api/v1/gl/link', { link_gl: true, defaults: [{ role: 'CASH', account_id: control }] })).body.error.message).toMatch(/บัญชีคุม/);
    expect((await call('PUT', '/api/v1/gl/link', { link_gl: true, routes: [{ txn_kind: 'NOPE', journal_book_id: null }] })).status).toBe(400);
    const b01 = books.find((b) => b.code === '01')!.id;
    expect((await call('PUT', '/api/v1/gl/link', { link_gl: false, routes: [{ txn_kind: 'DEPRECIATION', journal_book_id: b01 }], defaults: [{ role: 'CASH', account_id: leaf[2]!.id }] })).status).toBe(200);
    const link2 = (await call('GET', '/api/v1/gl/link')).body;
    expect(link2.link_gl).toBe(false);
    expect(link2.routes.find((x: { txn_kind: string }) => x.txn_kind === 'DEPRECIATION').journal_book_id).toBe(b01);
    expect(link2.defaults.find((x: { role: string }) => x.role === 'CASH').account_id).toBe(leaf[2]!.id);
    expect((await call('PUT', '/api/v1/gl/link', { link_gl: true, routes: [{ txn_kind: 'DEPRECIATION', journal_book_id: null }] })).status).toBe(200);
    expect((await call('GET', '/api/v1/gl/link')).body.routes.some((x: { txn_kind: string }) => x.txn_kind === 'DEPRECIATION')).toBe(false);
    // บริษัทอื่นมองไม่เห็น/แก้ไม่ได้
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('GET', `/api/v1/doc-types/${r.body.id}`)).status).toBe(404);
    expect((await call('PUT', `/api/v1/doc-types/${r.body.id}`, ie)).status).toBe(404);
    expect((await call('DELETE', `/api/v1/doc-types/${r.body.id}`)).status).toBe(404);
    expect((await call('PUT', '/api/v1/gl/link', { link_gl: true, defaults: [{ role: 'CASH', account_id: leaf[2]!.id }] })).status).toBe(400);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    expect((await call('DELETE', `/api/v1/doc-types/${r.body.id}`)).status).toBe(200);
  });

  it('data tables (S-TBL-00/01): units with rate, lookups, used codes protected', async () => {
    const list = (await call('GET', '/api/v1/data-tables')).body as Array<{ code: string; count: number; rate: boolean }>;
    expect(list.find((t) => t.code === '20')).toMatchObject({ rate: true });
    expect(list.find((t) => t.code === '20')!.count).toBeGreaterThanOrEqual(2);   // PCS BOX จากทดสอบแฟ้มสินค้า
    let units = (await call('GET', '/api/v1/data-tables/20')).body as Array<{ id: string; code: string; name_th: string; used: number; rate: string | null }>;
    const pcs = units.find((u) => u.code === 'PCS')!, box = units.find((u) => u.code === 'BOX')!;
    expect(pcs.used).toBeGreaterThan(0);
    const keep = units.map(({ used: _u, ...u }) => u);
    // เพิ่มหน่วยโหล อัตรา 12 · แก้ชื่อหน่วยที่ใช้แล้วได้
    expect((await call('PUT', '/api/v1/data-tables/20', { rows: [...keep.map((u) => (u.id === pcs.id ? { ...u, name_th: 'ชิ้น (แก้ชื่อ)' } : u)), { code: 'DZ', name_th: 'โหล', name_en: 'Dozens', short_th: 'หล', rate: 12 }] })).status).toBe(200);
    units = (await call('GET', '/api/v1/data-tables/20')).body;
    expect(units.find((u) => u.code === 'DZ')).toMatchObject({ name_th: 'โหล' });
    expect(Number(units.find((u) => u.code === 'DZ')!.rate)).toBe(12);
    expect(units.find((u) => u.code === 'PCS')!.name_th).toBe('ชิ้น (แก้ชื่อ)');
    expect((await call('GET', '/api/v1/lookups?types=UNIT')).body.UNIT.map((u: { code: string }) => u.code)).toContain('DZ');
    // รหัสที่ใช้แล้ว ห้ามแก้รหัส/ห้ามลบ (คู่มือหน้า 90)
    const now = units.map(({ used: _u, ...u }) => u);
    expect((await call('PUT', '/api/v1/data-tables/20', { rows: now.map((u) => (u.id === pcs.id ? { ...u, code: 'PC' } : u)) })).body.error.message).toMatch(/แก้รหัสไม่ได้/);
    expect((await call('PUT', '/api/v1/data-tables/20', { rows: now.filter((u) => u.id !== pcs.id) })).body.error.message).toMatch(/ลบไม่ได้/);
    expect((await call('PUT', '/api/v1/data-tables/20', { rows: [...now, { code: 'DZ', name_th: 'ซ้ำ' }] })).body.error.message).toMatch(/ซ้ำ/);
    // ตารางในแฟ้ม md_lookup: หมวดสินค้า — อ้างอิงด้วยรหัส
    expect((await call('PUT', '/api/v1/data-tables/22', { rows: [{ code: '01', name_th: 'ซีพียู', name_en: 'CPU' }, { code: '02', name_th: 'เมนบอร์ด' }] })).status).toBe(200);
    const cats = (await call('GET', '/api/v1/data-tables/22')).body as Array<{ id: string; code: string; used: number }>;
    await sql`UPDATE md_item SET category_code = '01' WHERE company_id = ${companyId} AND code = '01-INTL-CL-600'`.execute(database.db);
    const cats2 = (await call('GET', '/api/v1/data-tables/22')).body as Array<{ id: string; code: string; name_th: string; used: number }>;
    expect(cats2.find((c) => c.code === '01')!.used).toBe(1);
    expect((await call('PUT', '/api/v1/data-tables/22', { rows: cats2.filter((c) => c.code !== '01').map(({ used: _u, ...c }) => c) })).body.error.message).toMatch(/01.*ลบไม่ได้/);
    expect((await call('PUT', '/api/v1/data-tables/22', { rows: cats2.filter((c) => c.code !== '02').map(({ used: _u, ...c }) => c) })).status).toBe(200);   // 02 ยังไม่ใช้ ลบได้
    expect((await call('GET', '/api/v1/lookups?types=22')).body['22'].map((c: { code: string }) => c.code)).toEqual(['01']);
    expect((await call('GET', '/api/v1/data-tables/99')).status).toBe(404);
    // บริษัทอื่น: ไม่เห็น และแก้แถวของบริษัทนี้ไม่ได้
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('GET', '/api/v1/data-tables/20')).body.some((u: { code: string }) => u.code === 'DZ')).toBe(false);
    expect((await call('PUT', '/api/v1/data-tables/20', { rows: [{ id: box.id, code: 'BOX', name_th: 'แฮก' }] })).status).toBe(404);
    expect((await call('PUT', '/api/v1/data-tables/22', { rows: [{ id: cats[0]!.id, code: '01', name_th: 'แฮก' }] })).status).toBe(404);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    expect((await call('GET', '/api/v1/data-tables/22')).body[0].name_th).toBe('ซีพียู');
  });

  it('document engine (T3.2): numbering, post = GL voucher in one go, repost, cancel', async () => {
    const { issueDocNo, postDocument, cancelDocument } = await import('../src/modules/docs/engine.js');
    const iv = (await call('GET', '/api/v1/doc-types')).body.find((t: { code: string }) => t.code === 'IV');
    const no1 = await issueDocNo(database.db, companyId, iv.id), no2 = await issueDocNo(database.db, companyId, iv.id);
    expect([no1, no2]).toEqual(['IV0000001', 'IV0000002']);
    const branch = (await sql<{ id: string }>`SELECT id FROM sys_branch WHERE company_id = ${companyId} AND is_head_office`.execute(database.db)).rows[0]!.id;
    const cus = (await call('GET', '/api/v1/customers?status=all&q=C001')).body.rows[0].id;
    const item = (await call('GET', '/api/v1/items?q=01-INTL')).body.rows[0].id;
    const h = (await sql<{ id: string }>`INSERT INTO doc_header (company_id, branch_id, doc_type_id, doc_class, module, doc_no, doc_date, customer_id, amount, vat_rate, vat_amount, net_amount, vat_basis)
      VALUES (${companyId}, ${branch}, ${iv.id}, 'IV', 'AR', ${no2}, '2026-05-10', ${cus}, 1000, 7, 70, 1070, '1') RETURNING id`.execute(database.db)).rows[0]!.id;
    await sql`INSERT INTO doc_line (company_id, header_id, line_no, line_kind, item_id, qty, unit_price, line_amount, net_amount) VALUES (${companyId}, ${h}, 1, 'I', ${item}, 1, 1000, 1000, 1000)`.execute(database.db);
    const pv = (await call('GET', `/api/v1/docs/${h}/posting-preview`)).body as Array<{ role: string; debit: string; credit: string; layer: string }>;
    expect(pv.map((l) => [l.role, l.debit, l.credit])).toEqual([['AR', '1070.00', '0.00'], ['SALES', '0.00', '1000.00'], ['OUTPUT_VAT', '0.00', '70.00']]);
    const admin = (await sql<{ id: string }>`SELECT id FROM sys_user WHERE username = 'admin'`.execute(database.db)).rows[0]!.id;
    await database.db.transaction().execute((tx) => postDocument(tx, { companyId, userId: admin }, h));
    const j = (await call('GET', `/api/v1/docs/${h}/journal`)).body;
    expect(j.doc.gl_posted).toBe('Y');
    expect(j.journals).toHaveLength(1);
    expect(j.journals[0]).toMatchObject({ voucher_no: 'IV0000002', book_code: '03', doc_status: 'N', total_debit: '1070.00' });
    expect(j.journals[0].lines.map((l: { posting_role: string; resolved_from: string }) => `${l.posting_role}:${l.resolved_from}`)).toEqual(['AR:3', 'SALES:3', 'OUTPUT_VAT:3']);
    const tb = (await call('GET', '/api/v1/reports/trial-balance?from=2026-01-01&to=2026-12-31')).body;
    expect(tb.balanced).toBe(true);
    // ลงบัญชีใหม่ หลังกำหนดบัญชีลูกหนี้ที่ตัวลูกค้า: ใบสำคัญเดิมใช้บัญชีจากแฟ้มหลัก (ชั้น 2)
    const ar = (await call('GET', '/api/v1/gl/accounts')).body.find((x: { is_control: boolean; account_no: string }) => !x.is_control && x.account_no.startsWith('113')).id;
    await sql`UPDATE md_customer SET ar_account_id = ${ar} WHERE id = ${cus}`.execute(database.db);
    expect((await call('POST', `/api/v1/docs/${h}/repost`)).status).toBe(200);
    const j2 = (await call('GET', `/api/v1/docs/${h}/journal`)).body;
    expect(j2.journals.map((x: { doc_status: string; voucher_no: string }) => `${x.voucher_no}:${x.doc_status}`)).toEqual(['IV0000002:N']);   // ใบเดิม เลขเดิม บรรทัดใหม่
    expect(j2.journals[0].lines[0]).toMatchObject({ posting_role: 'AR', resolved_from: '2' });
    expect(j2.journals[0].lines).toHaveLength(3);
    // ยกเลิกเอกสาร: สถานะ C + ใบสำคัญ C (ไม่ลบ)
    await cancelDocument(database.db, { companyId, userId: admin }, h, 'ทดสอบยกเลิก');
    const j3 = (await call('GET', `/api/v1/docs/${h}/journal`)).body;
    expect(j3.doc).toMatchObject({ doc_status: 'C', gl_posted: 'N' });
    expect(j3.journals.every((x: { doc_status: string }) => x.doc_status === 'C')).toBe(true);
    await expect(cancelDocument(database.db, { companyId, userId: admin }, h, 'ซ้ำ')).rejects.toThrow(/ถูกยกเลิกแล้ว/);
    // บริษัทอื่นมองไม่เห็นเอกสาร/ใบสำคัญ
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('GET', `/api/v1/docs/${h}/journal`)).status).toBe(404);
    expect((await call('POST', `/api/v1/docs/${h}/repost`)).status).toBe(404);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
  });

  it('sales documents (T3.3): credit sale posts to GL, edit reposts, cash sale with payments, credit note, cancel, isolation', async () => {
    const defs = (await call('GET', '/api/v1/trade-defaults/IV')).body;
    const ivType = defs.types.find((t: { code: string }) => t.code === 'IV').id;
    const cus = (await call('POST', '/api/v1/customers', { code: 'C100', name: 'ลูกค้าเอกสารขาย', tax_id: '0105537095903', credit_days: 30 })).body.id;
    const cpu = (await call('GET', '/api/v1/items?q=01-INTL')).body.rows[0].id;
    const svc = (await call('GET', '/api/v1/other-expenses?status=all')).body.rows[0]?.id;
    const iv = { doc_type_id: ivType, doc_date: '2026-06-15', party_id: cus, price_type: '2', vat_rate: 7, discount_text: '10%', lines: [{ item_id: cpu, qty: 2, unit_price: 7500 }] };
    expect((await call('POST', '/api/v1/sales-invoices', { ...iv, lines: [] })).body.error.message).toMatch(/อย่างน้อย 1 บรรทัด/);
    expect((await call('POST', '/api/v1/sales-invoices', { ...iv, discount_text: 'xx' })).body.error.message).toMatch(/ส่วนลด/);
    if (svc) expect((await call('POST', '/api/v1/sales-invoices', { ...iv, lines: [{ item_id: svc, qty: 1, unit_price: 1 }] })).body.error.message).toMatch(/ค่าใช้จ่าย/);
    const r = await call('POST', '/api/v1/sales-invoices', iv);
    expect(r.body.error?.message ?? 'ok').toBe('ok');
    expect(r.body).toMatchObject({ doc_no: 'IV0000003', net_amount: '14445.00' });   // 15,000 − 10% = 13,500 + VAT 945
    const det = (await call('GET', `/api/v1/sales-invoices/${r.body.id}`)).body;
    expect(det).toMatchObject({ doc_no: 'IV0000003', amount: '15000.00', discount_amount: '1500.00', vat_amount: '945.00', due_date: expect.anything(), outstanding: '14445.00', editable: true, party_name: 'ลูกค้าเอกสารขาย' });
    expect(String(det.due_date).slice(0, 10)).toBe('2026-07-15');                    // เครดิต 30 วันจากลูกค้า
    const j = (await call('GET', `/api/v1/docs/${r.body.id}/journal`)).body.journals;
    expect(j).toHaveLength(1);
    // Perpetual (ค่าเริ่มต้น): ต้นทุนขาย 2 × ราคาทุนมาตรฐาน 6,000 (ยังไม่มีสต๊อก)
    expect(j[0].lines.map((l: { posting_role: string; debit: string; credit: string }) => `${l.posting_role}:${l.debit}:${l.credit}`)).toEqual(['AR:14445.00:0.00', 'SALES:0.00:13500.00', 'OUTPUT_VAT:0.00:945.00', 'COGS:12000.00:0.00', 'INVENTORY:0.00:12000.00']);
    expect((await call('GET', '/api/v1/sales-invoices?q=IV0000003')).body.rows[0]).toMatchObject({ party_code: 'C100', outstanding: '14445.00' });
    // แก้ไข: ลงใบสำคัญเดิมใหม่ เลขที่เดิม
    expect((await call('PUT', `/api/v1/sales-invoices/${r.body.id}`, { ...iv, discount_text: null, lines: [{ item_id: cpu, qty: 1, unit_price: 7500 }] })).body).toMatchObject({ doc_no: 'IV0000003', net_amount: '8025.00' });
    const j2 = (await call('GET', `/api/v1/docs/${r.body.id}/journal`)).body.journals;
    expect(j2.map((x: { voucher_no: string; total_debit: string }) => `${x.voucher_no}:${x.total_debit}`)).toEqual(['IV0000003:14025.00']);   // 8,025 + ต้นทุนขาย 6,000 (Perpetual)
    expect((await call('GET', '/api/v1/reports/trial-balance?from=2026-01-01&to=2026-12-31')).body.balanced).toBe(true);
    // ขายเงินสด: รับด้วยวิธีอื่นบางส่วน ที่เหลือเป็นเงินสด
    const hsType = (await call('GET', '/api/v1/trade-defaults/HS')).body.types[0].id;
    const pm = (await call('GET', '/api/v1/payment-methods/R')).body[0];
    const hs = await call('POST', '/api/v1/cash-sales', { doc_type_id: hsType, doc_date: '2026-06-16', party_id: cus, price_type: '1', vat_rate: 7, lines: [{ item_id: cpu, qty: 1, unit_price: 1070 }], payments: [{ payment_method_id: pm.id, amount: 500 }] });
    expect(hs.status).toBe(200);
    expect((await call('GET', `/api/v1/cash-sales/${hs.body.id}`)).body).toMatchObject({ net_amount: '1070.00', vat_amount: '70.00', cash_amount: '570.00', cheque_amount: '500.00' });
    expect((await call('GET', `/api/v1/docs/${hs.body.id}/journal`)).body.journals[0].lines.map((l: { posting_role: string; debit: string; credit: string }) => `${l.posting_role}:${l.debit}:${l.credit}`))
      .toEqual(['CASH:570.00:0.00', 'PAYMENT:500.00:0.00', 'SALES:0.00:1000.00', 'OUTPUT_VAT:0.00:70.00', 'COGS:6000.00:0.00', 'INVENTORY:0.00:6000.00']);   // วิธีรับชำระอื่นลงบัญชีของวิธีนั้น · ต้นทุนขาย (Perpetual)
    expect((await call('POST', '/api/v1/sales-invoices', { ...iv, payments: [{ payment_method_id: pm.id, amount: 1 }] })).body.error.message).toMatch(/ไม่มีการรับ\/จ่ายเงิน/);
    // ใบลดหนี้อ้างใบกำกับ: ต้องระบุใบเดิม
    const cnType = (await call('GET', '/api/v1/trade-defaults/CN')).body.types[0].id;
    const cn = { doc_type_id: cnType, doc_date: '2026-06-20', party_id: cus, price_type: '2', vat_rate: 7, lines: [{ item_id: cpu, qty: 1, unit_price: 1000, return_to_stock: true }] };
    expect((await call('POST', '/api/v1/ar-credit-notes', cn)).body.error.message).toMatch(/อ้างถึง/);
    const c1 = await call('POST', '/api/v1/ar-credit-notes', { ...cn, ref_header_id: r.body.id });
    expect(c1.status).toBe(200);
    expect((await call('GET', `/api/v1/ar-credit-notes/${c1.body.id}`)).body).toMatchObject({ ref_no: 'IV0000003', net_amount: '1070.00' });
    expect((await call('GET', `/api/v1/docs/${c1.body.id}/journal`)).body.journals[0].lines.map((l: { posting_role: string; credit: string }) => l.posting_role)).toEqual(['AR', 'SALES_RETURN', 'OUTPUT_VAT', 'INVENTORY', 'COGS']);   // รับคืนเข้าสต๊อก (Perpetual)
    // ลูกค้าเลิกใช้ เปิดบิลใหม่ไม่ได้
    const old = (await call('GET', '/api/v1/customers?status=I')).body.rows[0].id;
    expect((await call('POST', '/api/v1/sales-invoices', { ...iv, party_id: old })).body.error.message).toMatch(/เลิกใช้/);
    // บริษัทอื่น: มองไม่เห็นเอกสาร ใช้ลูกค้าของบริษัทนี้ไม่ได้
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('GET', `/api/v1/sales-invoices/${r.body.id}`)).status).toBe(404);
    expect((await call('GET', '/api/v1/sales-invoices')).body.total).toBe(0);
    expect((await call('POST', `/api/v1/sales-invoices/${r.body.id}/cancel`, { reason: 'x' })).status).toBe(404);
    const otherIv = (await call('GET', '/api/v1/trade-defaults/IV')).body.types[0].id;
    expect((await call('POST', '/api/v1/sales-invoices', { ...iv, doc_type_id: otherIv })).status).toBe(400);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    // ยกเลิก: ต้องมีเหตุผล · สถานะ C · ใบสำคัญ C · หายจากลูกหนี้คงค้าง
    expect((await call('POST', `/api/v1/sales-invoices/${r.body.id}/cancel`, { reason: '' })).status).toBe(400);
    expect((await call('POST', `/api/v1/sales-invoices/${r.body.id}/cancel`, { reason: 'ป้อนผิด' })).status).toBe(200);
    expect((await call('GET', `/api/v1/sales-invoices/${r.body.id}`)).body).toMatchObject({ doc_status: 'C', editable: false });
    expect((await call('PUT', `/api/v1/sales-invoices/${r.body.id}`, iv)).body.error.message).toMatch(/ยกเลิกแล้ว/);
    expect((await call('GET', `/api/v1/customers/${cus}`)).body.balance).toBe('-1070.00');   // เหลือใบลดหนี้
  });

  it('receipts/payments (T3.5): settle bills + credit note, WHT/discount/interest, cheques, edit, cancel, WHT register, isolation', async () => {
    type Row = { doc_class: string; doc_no: string; outstanding: string; header_id: string };
    const typeOf = async (cls: string) => (await call('GET', `/api/v1/trade-defaults/${cls}`)).body.types[0].id as string;
    const ivType = (await call('GET', '/api/v1/trade-defaults/IV')).body.types.find((t: { code: string }) => t.code === 'IV').id;
    const cus = (await call('POST', '/api/v1/customers', { code: 'C200', name: 'ลูกค้ารับชำระ', tax_id: '0105537095903', credit_days: 30 })).body.id;
    const cpu = (await call('GET', '/api/v1/items?q=01-INTL')).body.rows[0].id;
    const mk = async (path: string, type: string, price: number, extra: object = {}) =>
      (await call('POST', path, { doc_type_id: type, doc_date: '2026-07-01', party_id: cus, price_type: '2', vat_rate: 7, lines: [{ item_id: cpu, qty: 1, unit_price: price }], ...extra })).body;
    const iv1 = await mk('/api/v1/sales-invoices', ivType, 10000);   // 10,700
    const iv2 = await mk('/api/v1/sales-invoices', ivType, 5000);    // 5,350
    const cn = await mk('/api/v1/ar-credit-notes', await typeOf('CN'), 1000, { ref_header_id: iv1.id });   // 1,070
    const open = async () => ((await call('GET', `/api/v1/ar-receipts/open-items?party_id=${cus}`)).body.rows as Row[]).map((o) => `${o.doc_no}:${o.outstanding}`).sort();
    expect(await open()).toEqual([`${cn.doc_no}:1070.00`, `${iv1.doc_no}:10700.00`, `${iv2.doc_no}:5350.00`].sort());
    const chq = (await call('GET', '/api/v1/payment-methods/R')).body.find((m: { creates_cheque: boolean }) => m.creates_cheque);
    const tn = (await call('GET', '/api/v1/payment-methods/P')).body[0];
    // บิล 10,700 − ลดหนี้ 1,070 + บิลบางส่วน 2,000 = 11,630 · +ดอกเบี้ย 100 −ส่วนลด 60 −ถูกหัก 270 = 11,400 → เช็ค 9,000 + เงินสด 2,400
    const re = { doc_type_id: await typeOf('RE'), doc_date: '2026-07-20', payment_date: '2026-07-21', party_id: cus, wht_amount: 270, cash_discount_amount: 60, interest_amount: 100,
      settlements: [{ invoice_header_id: iv1.id, amount: 10700 }, { invoice_header_id: cn.id, amount: 1070 }, { invoice_header_id: iv2.id, amount: 2000 }],
      payments: [{ payment_method_id: chq.id, amount: 9000, reference_no: 'CQ1001', cheque_date: '2026-07-25' }] };
    const err = async (b: object) => (await call('POST', '/api/v1/ar-receipts', { ...re, ...b })).body.error.message as string;
    expect(await err({ settlements: [{ invoice_header_id: iv2.id, amount: 6000 }] })).toMatch(/มากกว่ายอดคงค้าง/);
    expect(await err({ settlements: [] })).toMatch(/อย่างน้อย 1 ใบ/);
    expect(await err({ cash_amount: 100 })).toMatch(/Message# 4025/);
    expect(await err({ payments: [{ payment_method_id: chq.id, amount: 9000 }] })).toMatch(/เลขที่เช็ค/);
    expect(await err({ payments: [{ payment_method_id: tn.id, amount: 9000 }] })).toMatch(/ไม่พบวิธีรับชำระ/);
    expect(await err({ payments: [{ payment_method_id: chq.id, amount: 20000, reference_no: 'X' }] })).toMatch(/มากกว่ายอดที่ต้องรับ/);
    expect(await err({ wht: [{ form_type: 'S53', income_type: 'ค่าบริการ', rate: 3, paid_amount: 9000, tax_amount: 270 }] })).toMatch(/ใบเสร็จรับเงินป้อนเพียง/);
    const c100 = (await call('GET', '/api/v1/customers?q=C100')).body.rows[0].id;
    expect(await err({ party_id: c100 })).toMatch(/ไม่พบบิลค้างของC100/);
    const r = await call('POST', '/api/v1/ar-receipts', re);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ doc_no: expect.stringMatching(/^RE\d{7}$/), net_amount: '11630.00', cash_amount: '2400.00' });
    const det = (await call('GET', `/api/v1/ar-receipts/${r.body.id}`)).body;
    expect(det).toMatchObject({ wht_amount: '270.00', cash_discount_amount: '60.00', interest_amount: '100.00', cheque_amount: '9000.00', editable: true, party_code: 'C200' });
    expect(String(det.payment_date).slice(0, 10)).toBe('2026-07-21');
    expect(det.payments[0]).toMatchObject({ reference_no: 'CQ1001', cheque_status: '00' });
    const j = (await call('GET', `/api/v1/docs/${r.body.id}/journal`)).body.journals;
    expect(j).toHaveLength(1);
    expect(j[0]).toMatchObject({ voucher_no: r.body.doc_no, total_debit: '12800.00' });
    expect([...new Set(j[0].lines.map((l: { posting_role: string }) => l.posting_role))].sort()).toEqual(['AR', 'CASH', 'CASH_DISCOUNT', 'INTEREST', 'PAYMENT', 'WHT']);
    expect(await open()).toEqual([`${iv2.doc_no}:3350.00`]);
    expect((await call('GET', `/api/v1/customers/${cus}`)).body.balance).toBe('3350.00');
    expect((await call('GET', '/api/v1/ar-receipts?q=C200')).body.rows[0]).toMatchObject({ doc_no: r.body.doc_no, bills: 3 });
    // บิลที่รับชำระแล้ว แก้/ยกเลิกไม่ได้ · เช็คเลขซ้ำไม่ได้
    expect((await call('POST', `/api/v1/sales-invoices/${iv1.id}/cancel`, { reason: 'x' })).body.error.message).toMatch(/รับ\/จ่ายชำระแล้ว/);
    expect((await call('GET', `/api/v1/sales-invoices/${iv1.id}`)).body.editable).toBe(false);
    expect(await err({ settlements: [{ invoice_header_id: iv2.id, amount: 1000 }], wht_amount: 0, cash_discount_amount: 0, interest_amount: 0, payments: [{ payment_method_id: chq.id, amount: 1000, reference_no: 'CQ1001' }] })).toMatch(/มีในทะเบียนเช็ค/);
    // แก้ไข: ตัดบิลที่ 2 เต็มจำนวน (ยอดที่ใบนี้ตัดไว้เดิมนับกลับเป็นค้าง) · ใบสำคัญเดิม
    expect((await call('PUT', `/api/v1/ar-receipts/${r.body.id}`, { ...re, settlements: [re.settlements[0], re.settlements[1], { invoice_header_id: iv2.id, amount: 5350 }] })).body).toMatchObject({ doc_no: r.body.doc_no, cash_amount: '5750.00' });
    expect((await call('GET', `/api/v1/docs/${r.body.id}/journal`)).body.journals.map((x: { voucher_no: string; total_debit: string }) => `${x.voucher_no}:${x.total_debit}`)).toEqual([`${r.body.doc_no}:16150.00`]);
    expect(await open()).toEqual([]);
    const cheques = async () => (await sql<{ cheque_no: string; amount: string; status: string }>`SELECT cheque_no, amount, status FROM fin_cheque WHERE source_header_id = ${r.body.id} AND deleted_at IS NULL`.execute(database.db)).rows;
    expect(await cheques()).toEqual([{ cheque_no: 'CQ1001', amount: '9000.00', status: '00' }]);
    expect((await call('GET', '/api/v1/reports/trial-balance?from=2026-01-01&to=2026-12-31')).body.balanced).toBe(true);
    // ยกเลิก: เช็คที่นำฝากแล้วยกเลิกไม่ได้ · ยกเลิกแล้วบิลกลับเป็นค้าง เช็คออกจากทะเบียน
    await sql`UPDATE fin_cheque SET status = '10' WHERE source_header_id = ${r.body.id}`.execute(database.db);
    expect((await call('POST', `/api/v1/ar-receipts/${r.body.id}/cancel`, { reason: 'ผิด' })).body.error.message).toMatch(/นำฝาก\/ผ่านแล้ว/);
    await sql`UPDATE fin_cheque SET status = '00' WHERE source_header_id = ${r.body.id}`.execute(database.db);
    expect((await call('POST', `/api/v1/ar-receipts/${r.body.id}/cancel`, { reason: '' })).status).toBe(400);
    expect((await call('POST', `/api/v1/ar-receipts/${r.body.id}/cancel`, { reason: 'รับเงินผิดราย' })).status).toBe(200);
    expect(await open()).toEqual([`${cn.doc_no}:1070.00`, `${iv1.doc_no}:10700.00`, `${iv2.doc_no}:5350.00`].sort());
    expect(await cheques()).toEqual([]);
    expect((await call('GET', `/api/v1/sales-invoices/${iv1.id}`)).body.editable).toBe(true);
    expect((await call('PUT', `/api/v1/ar-receipts/${r.body.id}`, re)).body.error.message).toMatch(/ยกเลิกแล้ว/);

    // จ่ายชำระ: ภาษีหัก ณ ที่จ่าย 3% ของค่าบริการ 1,500 → แฟ้ม ภ.ง.ด.53 · ยอดชำระ 1,605 = เงินสด 1,560 + ภาษี 45 (คู่มือรูปที่ 29)
    const sup = (await call('POST', '/api/v1/suppliers', { code: 'S200', name: 'ผู้รับจ้างทดสอบ', tax_id: '0105537095903' })).body.id;
    const rr = (await call('POST', '/api/v1/purchase-invoices', { doc_type_id: await typeOf('RR'), doc_date: '2026-07-02', party_id: sup, price_type: '2', vat_rate: 7, lines: [{ item_id: cpu, qty: 1, unit_price: 1500 }] })).body;
    const ps = { doc_type_id: await typeOf('PS'), doc_date: '2026-07-31', party_id: sup, settlements: [{ invoice_header_id: rr.id, amount: 1605 }],
      wht: [{ form_type: 'S53', income_type: 'ค่าบริการ', rate: 3, paid_amount: 1500, tax_amount: 45 }] };
    expect((await call('POST', '/api/v1/ap-payments', { ...ps, wht: [ps.wht[0], ps.wht[0], ps.wht[0]] })).status).toBe(400);
    const p1 = await call('POST', '/api/v1/ap-payments', ps);
    expect(p1.body.error?.message ?? 'ok').toBe('ok');
    expect(p1.body).toMatchObject({ net_amount: '1605.00', cash_amount: '1560.00' });
    const pd = (await call('GET', `/api/v1/ap-payments/${p1.body.id}`)).body;
    expect(pd).toMatchObject({ wht_amount: '45.00' });
    expect(pd.wht[0]).toMatchObject({ form_type: 'S53', certificate_no: p1.body.doc_no, tax_amount: '45.00' });
    expect((await call('GET', `/api/v1/docs/${p1.body.id}/journal`)).body.journals[0].lines.map((l: { posting_role: string; debit: string; credit: string }) => `${l.posting_role}:${l.debit}:${l.credit}`))
      .toEqual(['AP:1605.00:0.00', 'WHT:0.00:45.00', 'CASH:0.00:1560.00']);
    // แฟ้มภาษีหัก ณ ที่จ่าย: ดู แก้เลขที่หนังสือรับรอง (ยอดเงินแก้ที่เอกสารต้นทาง) เพิ่มเอง ยกเลิก
    const reg = (await call('GET', '/api/v1/wht?form=S53&month=2026-07')).body;
    expect(reg).toMatchObject({ total_tax: '45.00' });
    expect(reg.rows[0]).toMatchObject({ doc_no: p1.body.doc_no, payee_name: 'ผู้รับจ้างทดสอบ', tax_month: '2026-07' });
    const wid = reg.rows[0].id;
    const w = (await call('GET', `/api/v1/wht/${wid}`)).body;
    expect(w.lines).toHaveLength(1);
    const wput = { form_type: 'S53', certificate_no: 'B1/0001', certificate_date: '2026-07-31', supplier_id: sup, payee_name: w.payee_name, payee_tax_id: w.payee_tax_id, income_type: 'ค่าบริการ', paid_amount: 1500, rate: 3, tax_amount: 45 };
    expect((await call('PUT', `/api/v1/wht/${wid}`, wput)).status).toBe(200);
    expect((await call('PUT', `/api/v1/wht/${wid}`, { ...wput, tax_amount: 40 })).body.error.message).toMatch(/เอกสารต้นทาง/);
    expect((await call('POST', `/api/v1/wht/${wid}/cancel`, {})).body.error.message).toMatch(/เอกสารต้นทาง/);
    const manual = (await call('POST', '/api/v1/wht', { ...wput, form_type: 'S03', certificate_no: 'M-1', payee_name: 'นายช่าง ทดสอบ', payee_tax_id: '1234567890123', supplier_id: null })).body.id;
    expect((await call('GET', '/api/v1/wht?form=S03&month=2026-07')).body.rows.map((x: { certificate_no: string }) => x.certificate_no)).toEqual(['M-1']);
    expect((await call('POST', `/api/v1/wht/${manual}/printed`, {})).status).toBe(200);
    expect((await call('POST', `/api/v1/wht/${manual}/cancel`, {})).status).toBe(200);
    expect((await call('GET', '/api/v1/wht?form=S03&month=2026-07')).body.rows).toHaveLength(0);
    // บริษัทอื่น: มองไม่เห็นใบเสร็จ บิลค้าง แฟ้มภาษี
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('GET', `/api/v1/ar-receipts/${r.body.id}`)).status).toBe(404);
    expect((await call('GET', '/api/v1/ap-payments')).body.total).toBe(0);
    expect((await call('GET', `/api/v1/ar-receipts/open-items?party_id=${cus}`)).status).toBe(404);
    expect((await call('GET', `/api/v1/wht/${wid}`)).status).toBe(404);
    expect((await call('GET', '/api/v1/wht')).body.rows).toHaveLength(0);
    expect((await call('PUT', `/api/v1/wht/${wid}`, wput)).status).toBe(400);   // ผู้จำหน่ายของบริษัทอื่น
    expect((await call('POST', `/api/v1/ap-payments/${p1.body.id}/cancel`, { reason: 'x' })).status).toBe(404);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    // ยกเลิกใบสำคัญจ่าย → รายการภาษีหัก ณ ที่จ่ายยกเลิกด้วย
    expect((await call('POST', `/api/v1/ap-payments/${p1.body.id}/cancel`, { reason: 'จ่ายซ้ำ' })).status).toBe(200);
    expect((await call('GET', '/api/v1/wht?form=S53&month=2026-07&status=C')).body.rows[0]).toMatchObject({ id: wid, doc_status: 'C' });
    // ใบเสร็จ/ใบจ่ายยกเลิกแล้ว → บิลยกเลิกได้ (คืนสมุดบัญชีให้ทดสอบถัดไป)
    for (const [path, id] of [['purchase-invoices', rr.id], ['ar-credit-notes', cn.id], ['sales-invoices', iv1.id], ['sales-invoices', iv2.id]])
      expect((await call('POST', `/api/v1/${path}/${id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
  });

  it('deposits + other income/expense (T3.6): AI → deduct in invoice, OE with WHT and no supplier, cancel rules, isolation', async () => {
    const typeOf = async (cls: string) => (await call('GET', `/api/v1/trade-defaults/${cls}`)).body.types[0].id as string;
    const ivType = (await call('GET', '/api/v1/trade-defaults/IV')).body.types.find((t: { code: string }) => t.code === 'IV').id;
    const cus = (await call('GET', '/api/v1/customers?q=C200')).body.rows[0].id;
    const cpu = (await call('GET', '/api/v1/items?q=01-INTL')).body.rows[0].id;
    const roles = async (id: string) => (await call('GET', `/api/v1/docs/${id}/journal`)).body.journals[0].lines.map((l: { posting_role: string; debit: string; credit: string }) => `${l.posting_role}:${l.debit}:${l.credit}`);
    // รับเงินมัดจำ 10% (ราคาแยก VAT): Dr เงินสด 1,070 / Cr มัดจำรับ 1,000 + ภาษีขาย 70
    const ai = { doc_type_id: await typeOf('AI'), doc_date: '2026-08-01', party_id: cus, price_type: '2', vat_rate: 7, credit_days: 15, lines: [{ description: 'รับมัดจำ 10% คอมพิวเตอร์', amount: 1000 }] };
    expect((await call('POST', '/api/v1/ar-deposits', { ...ai, party_id: null })).body.error.message).toMatch(/เลือกลูกค้า/);
    expect((await call('POST', '/api/v1/ar-deposits', { ...ai, lines: [{ item_id: cpu, amount: 1000 }] })).body.error.message).toMatch(/คำอธิบายและจำนวนเงินเท่านั้น/);
    expect((await call('POST', '/api/v1/ar-deposits', { ...ai, cash_amount: 10 })).body.error.message).toMatch(/ไม่เท่ากับยอดชำระจริง/);
    const a1 = await call('POST', '/api/v1/ar-deposits', ai);
    expect(a1.body).toMatchObject({ doc_no: expect.stringMatching(/^AI\d{7}$/), net_amount: '1070.00', cash_amount: '1070.00' });
    expect(await roles(a1.body.id)).toEqual(['CASH:1070.00:0.00', 'DEPOSIT_RECEIVED:0.00:1000.00', 'OUTPUT_VAT:0.00:70.00']);
    expect((await call('GET', `/api/v1/ar-deposits/${a1.body.id}`)).body).toMatchObject({ remaining: '1000.00', used_by: [] });
    expect(String((await call('GET', `/api/v1/ar-deposits/${a1.body.id}`)).body.due_date).slice(0, 10)).toBe('2026-08-16');
    const open = async () => (await call('GET', `/api/v1/deposits/open?module=AR&party_id=${cus}`)).body.rows.map((r: { doc_no: string; outstanding: string }) => `${r.doc_no}:${r.outstanding}`);
    expect(await open()).toEqual([`${a1.body.doc_no}:1000.00`]);
    // บิลขายหักมัดจำ: 5,000 − 1,000 = 4,000 + VAT 280 = 4,280 · Dr ลูกหนี้ 4,280 + มัดจำรับ 1,000 / Cr ขาย 5,000 + VAT 280
    const iv = { doc_type_id: ivType, doc_date: '2026-08-10', party_id: cus, price_type: '2', vat_rate: 7, lines: [{ item_id: cpu, qty: 1, unit_price: 5000 }], deposits: [{ header_id: a1.body.id, amount: 1000 }] };
    expect((await call('POST', '/api/v1/sales-invoices', { ...iv, price_type: '1' })).body.error.message).toMatch(/ประเภทราคา/);
    expect((await call('POST', '/api/v1/sales-invoices', { ...iv, deposits: [{ header_id: a1.body.id, amount: 1500 }] })).body.error.message).toMatch(/ไม่เกินยอดคงเหลือ/);
    expect((await call('POST', '/api/v1/ar-debit-notes', { ...iv, doc_type_id: await typeOf('DR'), ref_no: 'X' })).body.error.message).toMatch(/หักเงินมัดจำไม่ได้/);
    const i1 = await call('POST', '/api/v1/sales-invoices', iv);
    expect(i1.body).toMatchObject({ net_amount: '4280.00' });
    expect((await call('GET', `/api/v1/sales-invoices/${i1.body.id}`)).body).toMatchObject({ deposit_amount: '1000.00', vat_amount: '280.00', deposits: [{ doc_no: a1.body.doc_no, amount: '1000.00' }] });
    expect(await roles(i1.body.id)).toEqual(['AR:4280.00:0.00', 'SALES:0.00:5000.00', 'OUTPUT_VAT:0.00:280.00', 'DEPOSIT_RECEIVED:1000.00:0.00', 'COGS:6000.00:0.00', 'INVENTORY:0.00:6000.00']);
    expect(await open()).toEqual([]);
    expect((await call('GET', `/api/v1/ar-deposits/${a1.body.id}`)).body).toMatchObject({ remaining: '0.00', used_by: [{ doc_no: i1.body.doc_no, amount: '1000.00' }] });
    // มัดจำที่หักแล้ว: ยกเลิกไม่ได้ ลดยอดต่ำกว่าที่หักไม่ได้ · แก้บิลโดยหักยอดเดิมได้ (นับยอดที่บิลนี้หักไว้กลับ)
    expect((await call('POST', `/api/v1/ar-deposits/${a1.body.id}/cancel`, { reason: 'x' })).body.error.message).toMatch(/หักในบิลแล้ว/);
    expect((await call('PUT', `/api/v1/ar-deposits/${a1.body.id}`, { ...ai, lines: [{ description: 'ลด', amount: 500 }] })).body.error.message).toMatch(/ไม่น้อยกว่านี้/);
    expect((await call('PUT', `/api/v1/sales-invoices/${i1.body.id}`, iv)).body).toMatchObject({ net_amount: '4280.00' });
    expect((await call('POST', `/api/v1/sales-invoices/${i1.body.id}/cancel`, { reason: 'ทดสอบ' })).status).toBe(200);
    expect(await open()).toEqual([`${a1.body.doc_no}:1000.00`]);
    expect((await call('POST', `/api/v1/ar-deposits/${a1.body.id}/cancel`, { reason: 'ลูกค้ายกเลิกสั่งซื้อ' })).status).toBe(200);
    expect(await open()).toEqual([]);

    // ค่าใช้จ่ายอื่น ไม่ระบุผู้จำหน่าย + ภาษีหัก ณ ที่จ่าย 3% → แฟ้ม ภ.ง.ด.3 · Dr ค่าใช้จ่าย 1,000 + ภาษีซื้อ 70 / Cr ภาษีหัก 30 + เงินสด 1,040
    const accs = (await call('GET', '/api/v1/gl/accounts')).body as Array<{ id: string; is_control: boolean }>;
    const leaf = accs.filter((x) => !x.is_control);
    const exp = (await call('POST', '/api/v1/other-expenses', { code: '95-5300-01', name_th: 'ค่าจ้างซ่อมแซม', accounts: { expense: leaf[6]!.id } })).body.id;
    const inc = (await call('POST', '/api/v1/other-incomes', { code: '94-4200-01', name_th: 'ค่าบริการรับ', accounts: { revenue: leaf[7]!.id } })).body.id;
    const oe = { doc_type_id: await typeOf('OE'), doc_date: '2026-08-05', party_name: 'นายช่าง ใจดี', price_type: '2', vat_rate: 7, ref_no: 'INV-77', lines: [{ item_id: exp, amount: 1000 }],
      wht: [{ form_type: 'S03', income_type: 'ค่าจ้างทำของ', rate: 3, paid_amount: 1000, tax_amount: 30 }] };
    expect((await call('POST', '/api/v1/other-expense-docs', { ...oe, lines: [{ item_id: inc, amount: 1000 }] })).body.error.message).toMatch(/ไม่ใช่รหัสค่าใช้จ่ายอื่น/);
    expect((await call('POST', '/api/v1/other-expense-docs', { ...oe, lines: [{ description: 'ไม่มีรหัส', amount: 1000 }] })).body.error.message).toMatch(/เลือกรหัสค่าใช้จ่าย/);
    const o1 = await call('POST', '/api/v1/other-expense-docs', oe);
    expect(o1.body).toMatchObject({ doc_no: expect.stringMatching(/^OE\d{7}$/), net_amount: '1070.00', cash_amount: '1040.00' });
    expect(await roles(o1.body.id)).toEqual(['EXPENSE:1000.00:0.00', 'INPUT_VAT:70.00:0.00', 'WHT:0.00:30.00', 'CASH:0.00:1040.00']);
    const od = (await call('GET', `/api/v1/other-expense-docs/${o1.body.id}`)).body;
    expect(od).toMatchObject({ party_name: 'นายช่าง ใจดี', supplier_id: null, ref_no: 'INV-77', wht_amount: '30.00', lines: [{ item_id: exp, amount: '1000.00' }] });
    expect(od.wht[0]).toMatchObject({ form_type: 'S03', tax_amount: '30.00', certificate_no: o1.body.doc_no });
    expect((await call('GET', '/api/v1/wht?form=S03&month=2026-08')).body.rows[0]).toMatchObject({ payee_name: 'นายช่าง ใจดี', doc_no: o1.body.doc_no });
    // รายได้อื่น ลูกค้าหักภาษีไว้ 1%: Dr ภาษีจ่ายล่วงหน้า 20 + เงินสด 1,980 / Cr รายได้ 2,000 (ยกเว้น VAT)
    const oi = await call('POST', '/api/v1/other-income-docs', { doc_type_id: await typeOf('OI'), doc_date: '2026-08-06', party_id: cus, price_type: '0', vat_rate: 0, wht_amount: 20, lines: [{ item_id: inc, amount: 2000 }] });
    expect(oi.body).toMatchObject({ net_amount: '2000.00', cash_amount: '1980.00' });
    expect(await roles(oi.body.id)).toEqual(['WHT:20.00:0.00', 'CASH:1980.00:0.00', 'OTHER_INCOME:0.00:2000.00']);
    expect((await call('GET', '/api/v1/reports/trial-balance?from=2026-01-01&to=2026-12-31')).body.balanced).toBe(true);
    // บริษัทอื่นมองไม่เห็น
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('GET', `/api/v1/other-expense-docs/${o1.body.id}`)).status).toBe(404);
    expect((await call('GET', '/api/v1/ar-deposits')).body.total).toBe(0);
    expect((await call('GET', `/api/v1/deposits/open?module=AR&party_id=${cus}`)).body.rows).toEqual([]);
    expect((await call('POST', `/api/v1/other-income-docs/${oi.body.id}/cancel`, { reason: 'x' })).status).toBe(404);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    // ยกเลิก → ภาษีหัก ณ ที่จ่ายยกเลิกด้วย (คืนสมุดบัญชีให้ทดสอบถัดไป)
    for (const [path, id] of [['other-expense-docs', o1.body.id], ['other-income-docs', oi.body.id]])
      expect((await call('POST', `/api/v1/${path}/${id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
    expect((await call('GET', '/api/v1/wht?form=S03&month=2026-08')).body.rows).toHaveLength(0);
  });

  it('orders (T3.7): quotation/SO/PO no posting, invoice references order lines, remaining qty live, line cancel, isolation', async () => {
    const typeOf = async (cls: string) => (await call('GET', `/api/v1/trade-defaults/${cls}`)).body.types[0].id as string;
    const ivType = (await call('GET', '/api/v1/trade-defaults/IV')).body.types.find((t: { code: string }) => t.code === 'IV').id;
    const cus = (await call('GET', '/api/v1/customers?q=C200')).body.rows[0].id;
    const sup = (await call('GET', '/api/v1/suppliers?q=S200')).body.rows[0].id;
    const cpu = (await call('GET', '/api/v1/items?q=01-INTL')).body.rows[0].id;
    // ใบเสนอราคา: กำหนดยืนราคา 30 วัน ไม่ลงบัญชี
    const qt = await call('POST', '/api/v1/quotations', { doc_type_id: await typeOf('QT'), doc_date: '2026-09-01', party_id: cus, price_type: '2', vat_rate: 7, credit_days: 30, lines: [{ item_id: cpu, qty: 10, unit_price: 100 }] });
    expect(qt.body).toMatchObject({ doc_no: expect.stringMatching(/^QT\d{7}$/), journal_id: null, net_amount: '1070.00' });
    expect(String((await call('GET', `/api/v1/quotations/${qt.body.id}`)).body.due_date).slice(0, 10)).toBe('2026-10-01');
    // ใบสั่งขาย 10 ชิ้น → บิลขายอ้าง 4 ชิ้น → ค้าง 6
    const so = await call('POST', '/api/v1/sales-orders', { doc_type_id: await typeOf('SO'), doc_date: '2026-09-02', delivery_date: '2026-09-10', party_id: cus, price_type: '2', vat_rate: 7, lines: [{ item_id: cpu, qty: 10, unit_price: 100 }] });
    expect(so.body).toMatchObject({ journal_id: null });
    expect((await call('GET', `/api/v1/docs/${so.body.id}/journal`)).body.journals).toEqual([]);
    const soLine = (await call('GET', `/api/v1/sales-orders/${so.body.id}`)).body.lines[0];
    expect(soLine).toMatchObject({ ordered_qty: '10.0000', remaining_qty: '10.0000' });
    expect(String(soLine.delivery_date).slice(0, 10)).toBe('2026-09-10');
    const open = async () => ((await call('GET', `/api/v1/orders/open?cls=SO&party_id=${cus}`)).body.rows as Array<{ doc_no: string; remaining_qty: string }>).map((r) => `${r.doc_no}:${Number(r.remaining_qty)}`);
    expect(await open()).toEqual([`${so.body.doc_no}:10`]);
    const iv = { doc_type_id: ivType, doc_date: '2026-09-05', party_id: cus, price_type: '2', vat_rate: 7, lines: [{ item_id: cpu, qty: 4, unit_price: 100, source_line_id: soLine.id }] };
    expect((await call('POST', '/api/v1/sales-invoices', { ...iv, lines: [{ ...iv.lines[0], qty: 11 }] })).body.error.message).toMatch(/มากกว่ายอดค้างส่ง/);
    expect((await call('POST', '/api/v1/ar-debit-notes', { ...iv, doc_type_id: await typeOf('DR'), ref_no: 'X' })).body.error.message).toMatch(/อ้างใบสั่งไม่ได้/);
    const i1 = await call('POST', '/api/v1/sales-invoices', iv);
    expect(i1.status).toBe(200);
    expect(await open()).toEqual([`${so.body.doc_no}:6`]);
    const sod = (await call('GET', `/api/v1/sales-orders/${so.body.id}`)).body;
    expect(sod).toMatchObject({ editable: false, deliveries: [{ doc_no: i1.body.doc_no, qty: '4.0000' }] });
    expect(sod.lines[0]).toMatchObject({ delivered_qty: '4.0000', remaining_qty: '6.0000' });
    expect((await call('GET', `/api/v1/sales-invoices/${i1.body.id}`)).body.lines[0].source).toMatchObject({ doc_no: so.body.doc_no });
    expect((await call('PUT', `/api/v1/sales-orders/${so.body.id}`, { doc_type_id: await typeOf('SO'), doc_date: '2026-09-02', party_id: cus, price_type: '2', vat_rate: 7, lines: [{ item_id: cpu, qty: 1, unit_price: 1 }] })).body.error.message).toMatch(/ส่งของแล้ว/);
    expect((await call('POST', `/api/v1/sales-orders/${so.body.id}/cancel`, { reason: 'x' })).body.error.message).toMatch(/ยกเลิกยอดค้างรายบรรทัด/);
    // ยกเลิกยอดค้างรายบรรทัด 2 ชิ้น → ค้าง 4 · บิลแก้เป็น 8 ได้ (4 เดิม + ค้าง 4) → ส่งครบ
    expect((await call('POST', `/api/v1/sales-orders/${so.body.id}/lines/${soLine.id}/cancel`, { qty: 7, reason_code: '01', date: '2026-09-06' })).body.error.message).toMatch(/ไม่เกินยอดค้าง/);
    expect((await call('POST', `/api/v1/sales-orders/${so.body.id}/lines/${soLine.id}/cancel`, { qty: 2, reason_code: '01', date: '2026-09-06' })).status).toBe(200);
    expect(await open()).toEqual([`${so.body.doc_no}:4`]);
    expect((await call('PUT', `/api/v1/sales-invoices/${i1.body.id}`, { ...iv, lines: [{ ...iv.lines[0], qty: 8 }] })).status).toBe(200);
    expect(await open()).toEqual([]);
    expect((await call('POST', `/api/v1/sales-invoices/${i1.body.id}/cancel`, { reason: 'ทดสอบ' })).status).toBe(200);
    expect(await open()).toEqual([`${so.body.doc_no}:8`]);
    // ใบสั่งซื้อ → ซื้อเชื่ออ้างครบ
    const po = await call('POST', '/api/v1/purchase-orders', { doc_type_id: await typeOf('PO'), doc_date: '2026-09-03', party_id: sup, price_type: '2', vat_rate: 7, lines: [{ item_id: cpu, qty: 5, unit_price: 80 }] });
    const poLine = (await call('GET', `/api/v1/purchase-orders/${po.body.id}`)).body.lines[0];
    const rr = await call('POST', '/api/v1/purchase-invoices', { doc_type_id: await typeOf('RR'), doc_date: '2026-09-04', party_id: sup, price_type: '2', vat_rate: 7, lines: [{ item_id: cpu, qty: 5, unit_price: 80, source_line_id: poLine.id }] });
    expect(rr.status).toBe(200);
    expect((await call('GET', `/api/v1/orders/open?cls=PO&party_id=${sup}`)).body.rows).toEqual([]);
    expect((await call('POST', '/api/v1/sales-invoices', { ...iv, lines: [{ ...iv.lines[0], source_line_id: poLine.id }] })).body.error.message).toMatch(/ไม่พบรายการค้างส่ง/);
    // บริษัทอื่นมองไม่เห็น
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('GET', `/api/v1/orders/open?cls=SO&party_id=${cus}`)).body.rows).toEqual([]);
    expect((await call('GET', `/api/v1/sales-orders/${so.body.id}`)).status).toBe(404);
    expect((await call('POST', `/api/v1/sales-orders/${so.body.id}/lines/${soLine.id}/cancel`, { qty: 1, date: '2026-09-06' })).status).toBe(404);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    // ล้างข้อมูลทดสอบ (คืนสมุดบัญชีให้ทดสอบถัดไป)
    for (const [path, id] of [['purchase-invoices', rr.body.id], ['purchase-orders', po.body.id], ['sales-orders', so.body.id], ['quotations', qt.body.id]])
      expect((await call('POST', `/api/v1/${path}/${id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
  });

  it('billing notes + quotation → order (T3.7): BS groups open bills, one bill per invoice, appointment date, bill no in receipts, convert QT', async () => {
    const typeOf = async (cls: string) => (await call('GET', `/api/v1/trade-defaults/${cls}`)).body.types[0].id as string;
    const ivType = (await call('GET', '/api/v1/trade-defaults/IV')).body.types.find((t: { code: string }) => t.code === 'IV').id;
    const cus = (await call('GET', '/api/v1/customers?q=C200')).body.rows[0].id;
    const cpu = (await call('GET', '/api/v1/items?q=01-INTL')).body.rows[0].id;
    const mk = async (price: number) => (await call('POST', '/api/v1/sales-invoices', { doc_type_id: ivType, doc_date: '2026-10-01', party_id: cus, price_type: '2', vat_rate: 7, lines: [{ item_id: cpu, qty: 1, unit_price: price }] })).body;
    const i1 = await mk(1000), i2 = await mk(2000);
    const open = async (bill?: string) => ((await call('GET', `/api/v1/ar-bills/open-items?party_id=${cus}${bill ? `&bill_id=${bill}` : ''}`)).body.rows as Array<{ doc_no: string }>).map((r) => r.doc_no).sort();
    expect(await open()).toEqual([i1.doc_no, i2.doc_no].sort());
    const bs = { doc_type_id: await typeOf('BS'), doc_date: '2026-10-05', visit_date: '2026-10-06', party_id: cus, items: [{ invoice_header_id: i1.id }, { invoice_header_id: i2.id }] };
    expect((await call('POST', '/api/v1/ar-bills', { ...bs, items: [] })).body.error.message).toMatch(/อย่างน้อย 1 ใบ/);
    const b1 = await call('POST', '/api/v1/ar-bills', bs);
    expect(b1.body).toMatchObject({ doc_no: expect.stringMatching(/^BI\d{7}$/), net_amount: '3210.00' });
    expect((await call('GET', `/api/v1/docs/${b1.body.id}/journal`)).body.journals).toEqual([]);
    expect(await open()).toEqual([]);
    expect(await open(b1.body.id)).toEqual([i1.doc_no, i2.doc_no].sort());     // แก้ใบเดิม: บิลของใบนี้เลือกได้
    expect((await call('POST', '/api/v1/ar-bills', bs)).body.error.message).toMatch(/อยู่ในใบวางบิลอื่นแล้ว/);
    expect((await call('POST', `/api/v1/ar-bills/${b1.body.id}/appointment`, { date: '2026-10-30' })).status).toBe(200);
    expect((await call('GET', '/api/v1/ar-bills?order=appointment')).body.rows[0]).toMatchObject({ doc_no: b1.body.doc_no, bills: 2 });
    const det = (await call('GET', `/api/v1/ar-bills/${b1.body.id}`)).body;
    expect(String(det.appointment_date).slice(0, 10)).toBe('2026-10-30');
    expect(String(det.visit_date).slice(0, 10)).toBe('2026-10-06');
    expect(det.items.map((x: { amount: string }) => x.amount)).toEqual(['1070.00', '2140.00']);
    // ใบเสร็จแสดงเลขที่ใบวางบิล
    expect((await call('GET', `/api/v1/ar-receipts/open-items?party_id=${cus}`)).body.rows.find((r: { doc_no: string }) => r.doc_no === i1.doc_no).bill_no).toBe(b1.body.doc_no);
    // แก้: เหลือบิลเดียว · ยกเลิก → บิลกลับมาวางได้
    expect((await call('PUT', `/api/v1/ar-bills/${b1.body.id}`, { ...bs, items: [{ invoice_header_id: i1.id }] })).body).toMatchObject({ net_amount: '1070.00' });
    expect(await open()).toEqual([i2.doc_no]);
    expect((await call('POST', `/api/v1/ar-bills/${b1.body.id}/cancel`, { reason: 'วางบิลใหม่' })).status).toBe(200);
    expect(await open()).toEqual([i1.doc_no, i2.doc_no].sort());
    expect((await call('POST', `/api/v1/ar-bills/${b1.body.id}/appointment`, { date: '2026-11-01' })).body.error.message).toMatch(/ยกเลิกแล้ว/);
    // แปลงใบเสนอราคาเป็นใบสั่งขาย
    const qt = (await call('POST', '/api/v1/quotations', { doc_type_id: await typeOf('QT'), doc_date: '2026-10-02', party_id: cus, price_type: '2', vat_rate: 7, discount_text: '5%', lines: [{ item_id: cpu, qty: 3, unit_price: 500 }] })).body;
    const so = await call('POST', `/api/v1/quotations/${qt.id}/convert`, { doc_date: '2026-10-03' });
    expect(so.body).toMatchObject({ doc_no: expect.stringMatching(/^SO\d{7}$/), net_amount: qt.net_amount });
    expect((await call('GET', `/api/v1/quotations/${qt.id}`)).body.converted).toEqual([expect.objectContaining({ doc_no: so.body.doc_no })]);
    expect((await call('GET', `/api/v1/sales-orders/${so.body.id}`)).body.lines[0]).toMatchObject({ remaining_qty: '3.0000' });
    // บริษัทอื่น
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('GET', `/api/v1/ar-bills/${b1.body.id}`)).status).toBe(404);
    expect((await call('POST', `/api/v1/quotations/${qt.id}/convert`, { doc_date: '2026-10-03' })).status).toBe(404);
    expect((await call('GET', `/api/v1/ar-bills/open-items?party_id=${cus}`)).status).toBe(404);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    for (const [path, id] of [['sales-orders', so.body.id], ['quotations', qt.id], ['sales-invoices', i1.id], ['sales-invoices', i2.id]])
      expect((await call('POST', `/api/v1/${path}/${id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
  });

  it('petty cash (T3.8): DP not posted, VR reimburses selected DPs and posts, reimbursed DP locked, cancel reopens, isolation', async () => {
    const typeOf = async (cls: string) => (await call('GET', `/api/v1/trade-defaults/${cls}`)).body.types[0].id as string;
    const accs = (await call('GET', '/api/v1/gl/accounts')).body as Array<{ id: string; is_control: boolean }>;
    const leaf = accs.filter((x) => !x.is_control);
    const exp = leaf[8]!.id, petty = leaf[9]!.id, control = accs.find((x) => x.is_control)!.id;
    const dpType = await typeOf('DP');
    expect((await call('POST', '/api/v1/petty-payments', { doc_type_id: dpType, doc_date: '2026-11-01', lines: [{ account_id: control, amount: 10 }] })).body.error.message).toMatch(/บัญชีคุม/);
    // ตั้งวงเงิน 5,000 + จ่ายค่าใช้จ่าย 500 (ยังไม่ลงบัญชี)
    const dp1 = (await call('POST', '/api/v1/petty-payments', { doc_type_id: dpType, doc_date: '2026-11-01', remark: 'ตั้งวงเงินสดย่อย', lines: [{ account_id: petty, amount: 5000 }] })).body;
    const dp2 = (await call('POST', '/api/v1/petty-payments', { doc_type_id: dpType, doc_date: '2026-11-03', remark: 'ค่าเดินทาง', lines: [{ account_id: exp, description: 'ค่าแท็กซี่', amount: 300 }, { account_id: exp, description: 'ค่าทางด่วน', amount: 200 }] })).body;
    expect(dp2).toMatchObject({ doc_no: expect.stringMatching(/^DP\d{7}$/), net_amount: '500.00' });
    expect((await call('GET', `/api/v1/docs/${dp2.id}/journal`)).body.journals).toEqual([]);
    const open = async () => ((await call('GET', '/api/v1/petty-payments?open=true')).body.rows as Array<{ doc_no: string }>).map((r) => r.doc_no).sort();
    expect(await open()).toEqual([dp1.doc_no, dp2.doc_no].sort());
    // เบิกชดเชย: โอนจากบัญชีธนาคาร 5,500 → Dr เงินสดย่อย 5,000 + ค่าใช้จ่าย 500 / Cr ธนาคาร 5,500
    const tn = (await call('GET', '/api/v1/payment-methods/P')).body[0];
    const vr = { doc_type_id: await typeOf('VR'), doc_date: '2026-11-05', remark: 'เบิกชดเชย 1–3/11', dp_ids: [dp1.id, dp2.id], payments: [{ payment_method_id: tn.id, amount: 5500 }] };
    expect((await call('POST', '/api/v1/petty-reimbursements', { ...vr, dp_ids: [] })).body.error.message).toMatch(/อย่างน้อย 1 ใบ/);
    expect((await call('POST', '/api/v1/petty-reimbursements', { ...vr, cash_amount: 1 })).body.error.message).toMatch(/ไม่เท่ากับยอดจ่ายจริง/);
    const v1 = await call('POST', '/api/v1/petty-reimbursements', vr);
    expect(v1.body).toMatchObject({ doc_no: expect.stringMatching(/^VR\d{7}$/), net_amount: '5500.00', cash_amount: '0.00' });
    const j = (await call('GET', `/api/v1/docs/${v1.body.id}/journal`)).body.journals[0];
    expect(j).toMatchObject({ voucher_no: v1.body.doc_no, total_debit: '5500.00' });
    expect(j.lines.map((l: { posting_role: string; debit: string; credit: string }) => `${l.posting_role}:${l.debit}:${l.credit}`).sort()).toEqual(['EXPENSE:500.00:0.00', 'EXPENSE:5000.00:0.00', 'PAYMENT:0.00:5500.00']);
    expect((await call('GET', `/api/v1/petty-reimbursements/${v1.body.id}`)).body).toMatchObject({ dps: [expect.anything(), expect.anything()], lines: [expect.anything(), expect.anything()] });
    expect(await open()).toEqual([]);
    expect((await call('GET', `/api/v1/petty-payments/${dp2.id}`)).body).toMatchObject({ vr_no: v1.body.doc_no, editable: false });
    expect((await call('PUT', `/api/v1/petty-payments/${dp2.id}`, { doc_type_id: dpType, doc_date: '2026-11-03', lines: [{ account_id: exp, amount: 1 }] })).body.error.message).toMatch(/เบิกชดเชยแล้วใน/);
    expect((await call('POST', `/api/v1/petty-payments/${dp2.id}/cancel`, { reason: 'x' })).body.error.message).toMatch(/เบิกชดเชยแล้วใน/);
    expect((await call('POST', '/api/v1/petty-reimbursements', { ...vr, dp_ids: [dp2.id] })).body.error.message).toMatch(/เบิกชดเชยแล้วใน/);
    // แก้ใบเบิกเดิม: เหลือ DP2 จ่ายเงินสด · ใบสำคัญเดิม
    expect((await call('PUT', `/api/v1/petty-reimbursements/${v1.body.id}`, { ...vr, dp_ids: [dp2.id], payments: [] })).body).toMatchObject({ net_amount: '500.00', cash_amount: '500.00' });
    expect(await open()).toEqual([dp1.doc_no]);
    expect((await call('GET', '/api/v1/reports/trial-balance?from=2026-01-01&to=2026-12-31')).body.balanced).toBe(true);
    // บริษัทอื่น
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('GET', '/api/v1/petty-payments')).body.rows).toEqual([]);
    expect((await call('GET', `/api/v1/petty-reimbursements/${v1.body.id}`)).status).toBe(404);
    expect((await call('POST', `/api/v1/petty-reimbursements/${v1.body.id}/cancel`, { reason: 'x' })).status).toBe(404);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    // ยกเลิกใบเบิก → ใบจ่ายกลับมาเบิกได้ แล้วยกเลิกได้
    expect((await call('POST', `/api/v1/petty-reimbursements/${v1.body.id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
    expect(await open()).toEqual([dp1.doc_no, dp2.doc_no].sort());
    for (const id of [dp1.id, dp2.id]) expect((await call('POST', `/api/v1/petty-payments/${id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
  });

  it('VAT registers (T3.9): documents write entries, credit notes negative, cash-basis at receipt, edit/reclassify, manual, cancel, isolation', async () => {
    const typeOf = async (cls: string) => (await call('GET', `/api/v1/trade-defaults/${cls}`)).body.types[0].id as string;
    const ivType = (await call('GET', '/api/v1/trade-defaults/IV')).body.types.find((t: { code: string }) => t.code === 'IV').id;
    const cus = (await call('GET', '/api/v1/customers?q=C200')).body.rows[0].id;
    const sup = (await call('GET', '/api/v1/suppliers?q=S200')).body.rows[0].id;
    const cpu = (await call('GET', '/api/v1/items?q=01-INTL')).body.rows[0].id;
    const reg = async (k: 'P' | 'S', extra = '') => (await call('GET', `/api/v1/vat/${k}?month=2026-12${extra}`)).body;
    const iv = (await call('POST', '/api/v1/sales-invoices', { doc_type_id: ivType, doc_date: '2026-12-01', party_id: cus, price_type: '2', vat_rate: 7, lines: [{ item_id: cpu, qty: 1, unit_price: 1000 }] })).body;
    const cn = (await call('POST', '/api/v1/ar-credit-notes', { doc_type_id: await typeOf('CN'), doc_date: '2026-12-03', party_id: cus, ref_header_id: iv.id, price_type: '2', vat_rate: 7, lines: [{ item_id: cpu, qty: 1, unit_price: 200 }] })).body;
    let s = await reg('S');
    expect(s.rows.find((r: { doc_no: string }) => r.doc_no === iv.doc_no)).toMatchObject({ tax_invoice_no: iv.doc_no, base_amount: '1000.00', vat_amount: '70.00', description: expect.stringMatching(/^ขายเชื่อให้/), month: '2026-12' });
    expect(s.rows.find((r: { doc_no: string }) => r.doc_no === cn.doc_no)).toMatchObject({ base_amount: '200.00', vat_amount: '14.00', sign: -1 });
    expect(s.totals).toMatchObject({ base: '800.00', vat: '56.00' });
    // ภาษีเกณฑ์เงินสด: บิลไม่เข้าแฟ้ม เกิดตอนรับชำระ
    const iv2 = (await call('POST', '/api/v1/sales-invoices', { doc_type_id: ivType, doc_date: '2026-12-05', party_id: cus, price_type: '2', vat_rate: 7, vat_basis: '2', lines: [{ item_id: cpu, qty: 1, unit_price: 2000 }] })).body;
    expect((await reg('S')).rows.some((r: { doc_no: string }) => r.doc_no === iv2.doc_no)).toBe(false);
    const re = (await call('POST', '/api/v1/ar-receipts', { doc_type_id: await typeOf('RE'), doc_date: '2026-12-10', party_id: cus, settlements: [{ invoice_header_id: iv2.id, amount: 2140 }] })).body;
    expect((await reg('S')).rows.find((r: { doc_no: string }) => r.doc_no === re.doc_no)).toMatchObject({ base_amount: '2000.00', vat_amount: '140.00', description: expect.stringMatching(/^รับชำระหนี้จาก/) });
    // ภาษีซื้อ: เลขที่/วันที่ใบกำกับของผู้จำหน่าย · ย้ายเป็นขอคืนไม่ได้ + ยื่นเพิ่มเติม
    const rr = { doc_type_id: await typeOf('RR'), doc_date: '2026-12-02', party_id: sup, ref_no: 'INV-S1', ref_date: '2026-11-28', price_type: '2', vat_rate: 7, lines: [{ item_id: cpu, qty: 1, unit_price: 500 }] };
    const r1 = (await call('POST', '/api/v1/purchase-invoices', rr)).body;
    const p1 = (await reg('P')).rows.find((r: { doc_no: string }) => r.doc_no === r1.doc_no);
    expect(p1).toMatchObject({ tax_invoice_no: 'INV-S1', base_amount: '500.00', vat_amount: '35.00', description: expect.stringMatching(/^ซื้อเชื่อจาก/) });
    expect(String(p1.tax_invoice_date).slice(0, 10)).toBe('2026-11-28');
    const edit = { tax_invoice_no: 'INV-S1', tax_invoice_date: '2026-11-28', month: '2026-12', is_late: true, base_amount: 0, vat_amount: 0, nonclaim_base: 500, nonclaim_vat: 35, remark: 'ใบกำกับไม่สมบูรณ์' };
    expect((await call('PUT', `/api/v1/vat/P/${p1.id}`, { ...edit, nonclaim_vat: 30 })).body.error.message).toMatch(/ย้ายยอด/);
    expect((await call('PUT', `/api/v1/vat/S/${p1.id}`, edit)).status).toBe(404);   // คนละแฟ้ม
    expect((await call('PUT', `/api/v1/vat/P/${p1.id}`, edit)).status).toBe(200);
    expect((await reg('P', '&late=Y')).totals).toMatchObject({ vat: '0.00', nonclaim_vat: '35.00' });
    // บันทึกเอกสารซ้ำโดยยอดเท่าเดิม → รายการที่แก้คงอยู่ · ยอดเปลี่ยน → สร้างใหม่ แต่คงเลขที่/งวด/ยื่นเพิ่มเติม
    expect((await call('PUT', `/api/v1/purchase-invoices/${r1.id}`, rr)).status).toBe(200);
    expect((await reg('P')).rows.find((r: { doc_no: string }) => r.doc_no === r1.doc_no)).toMatchObject({ nonclaim_vat: '35.00', is_modified: true, remark: 'ใบกำกับไม่สมบูรณ์' });
    expect((await call('PUT', `/api/v1/purchase-invoices/${r1.id}`, { ...rr, lines: [{ item_id: cpu, qty: 2, unit_price: 500 }] })).status).toBe(200);
    expect((await reg('P')).rows.find((r: { doc_no: string }) => r.doc_no === r1.doc_no)).toMatchObject({ base_amount: '1000.00', vat_amount: '70.00', nonclaim_vat: '0.00', is_late: true, tax_invoice_no: 'INV-S1' });
    // เพิ่มรายการเอง · ยกเลิกได้เฉพาะที่เพิ่มเอง · ยกเลิกเอกสาร → รายการยกเลิก
    const m = await call('POST', '/api/v1/vat/S', { tax_invoice_no: 'MAN-01', tax_invoice_date: '2026-12-20', month: '2026-12', party_name: 'ลูกค้าทั่วไป', base_amount: 100, vat_amount: 7 });
    expect(m.status).toBe(200);
    expect((await call('POST', `/api/v1/vat/S/${p1.id}/cancel`, {})).status).toBe(404);
    const ivEntry = (await reg('S')).rows.find((r: { doc_no: string }) => r.doc_no === iv.doc_no);
    expect((await call('POST', `/api/v1/vat/S/${ivEntry.id}/cancel`, {})).body.error.message).toMatch(/เอกสารต้นทาง/);
    expect((await call('POST', `/api/v1/vat/S/${m.body.id}/cancel`, {})).status).toBe(200);
    // บริษัทอื่น
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('GET', '/api/v1/vat/S')).body.rows).toEqual([]);
    expect((await call('PUT', `/api/v1/vat/P/${p1.id}`, edit)).status).toBe(404);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    // ล้างข้อมูลทดสอบ
    for (const [path, id] of [['ar-receipts', re.id], ['ar-credit-notes', cn.id], ['sales-invoices', iv.id], ['sales-invoices', iv2.id], ['purchase-invoices', r1.id]])
      expect((await call('POST', `/api/v1/${path}/${id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
    s = await reg('S');
    expect(s.totals).toMatchObject({ base: '0.00', vat: '0.00' });
    expect((await reg('S', '&status=C')).rows.length).toBeGreaterThanOrEqual(3);
  });

  it('vat closing (T1.15): month-end proposal clears output/input VAT balances, balanced', async () => {
    const r = (await call('GET', '/api/v1/gl/vat-closing?month=2026-12')).body;
    expect(r).toMatchObject({ date: '2026-12-31', description: 'ปรับปรุงภาษีมูลค่าเพิ่มประจำเดือน 12/2026' });
    const sum = (k: 'debit' | 'credit') => r.lines.reduce((s: number, l: Record<string, string>) => s + Number(l[k]), 0);
    expect(Math.abs(sum('debit') - sum('credit'))).toBeLessThan(0.005);
    expect(Number(r.output_vat) - Number(r.input_vat)).toBeCloseTo(Number(r.net), 2);
    expect((await call('GET', '/api/v1/gl/vat-closing?month=2026-13')).status).toBe(400);
  });

  it('opening AR/AP (T3.10): bills before go-live, no GL/VAT, settled by receipt (cash-basis VAT at receipt), locked in trade screens, isolation', async () => {
    const typeOf = async (cls: string) => (await call('GET', `/api/v1/trade-defaults/${cls}`)).body.types[0].id as string;
    const cus = (await call('GET', '/api/v1/customers?q=C200')).body.rows[0].id;
    const sup = (await call('GET', '/api/v1/suppliers?q=S200')).body.rows[0].id;
    const ob = { party_id: cus, doc_no: 'IV68/0001', doc_date: '2024-12-15', price_type: '2', amount: 1000, vat_rate: 7 };
    expect((await call('POST', '/api/v1/ar-opening', { ...ob, doc_date: '2025-01-05' })).body.error.message).toMatch(/ก่อนวันเริ่มใช้/);
    const o1 = await call('POST', '/api/v1/ar-opening', ob);
    expect(o1.body).toMatchObject({ doc_no: 'IV68/0001', net_amount: '1070.00' });
    expect((await call('POST', '/api/v1/ar-opening', ob)).body.error.message).toMatch(/มีอยู่แล้ว/);
    // ปัดเศษไม่ตรงบิล: อัตรา 0% แล้วป้อนภาษีเอง
    const o2 = await call('POST', '/api/v1/ar-opening', { ...ob, doc_no: 'IV68/0002', vat_rate: 0, vat_amount: 69.99 });
    expect(o2.body).toMatchObject({ net_amount: '1069.99' });
    expect((await call('GET', `/api/v1/docs/${o1.body.id}/journal`)).body.journals).toEqual([]);
    expect((await call('GET', '/api/v1/ar-opening')).body).toMatchObject({ total: '2139.99', start_date: '2025-01-01' });
    // ปรากฏเป็นบิลค้าง · รับชำระในระบบ → ภาษีเกณฑ์เงินสดเกิดที่ใบเสร็จ
    const open = (await call('GET', `/api/v1/ar-receipts/open-items?party_id=${cus}`)).body.rows.map((r: { doc_no: string }) => r.doc_no);
    expect(open).toEqual(expect.arrayContaining(['IV68/0001', 'IV68/0002']));
    const re = (await call('POST', '/api/v1/ar-receipts', { doc_type_id: await typeOf('RE'), doc_date: '2026-02-01', party_id: cus, settlements: [{ invoice_header_id: o1.body.id, amount: 1070 }] })).body;
    expect((await call('GET', '/api/v1/vat/S?month=2026-02')).body.rows.find((r: { doc_no: string }) => r.doc_no === re.doc_no)).toMatchObject({ base_amount: '1000.00', vat_amount: '70.00' });
    expect((await call('PUT', `/api/v1/ar-opening/${o1.body.id}`, ob)).body.error.message).toMatch(/รับ\/จ่ายชำระแล้ว/);
    // หน้าบิลขายปกติ: ดู/อ้างได้ แต่แก้ไม่ได้
    expect((await call('GET', `/api/v1/sales-invoices/${o2.body.id}`)).body).toMatchObject({ is_opening: true, editable: false });
    expect((await call('PUT', `/api/v1/sales-invoices/${o2.body.id}`, { doc_type_id: await typeOf('IV'), doc_date: '2026-03-01', party_id: cus, price_type: '2', vat_rate: 7, lines: [{ item_id: (await call('GET', '/api/v1/items?q=01-INTL')).body.rows[0].id, qty: 1, unit_price: 1 }] })).body.error.message).toMatch(/ยอดยกมา/);
    // เจ้าหนี้ยกมา
    const p1 = await call('POST', '/api/v1/ap-opening', { party_id: sup, doc_no: 'RR68/0001', doc_date: '2024-12-20', ref_no: 'BILL-9', vat_date: '2024-12-20', price_type: '1', amount: 535, vat_rate: 7 });
    expect(p1.body).toMatchObject({ net_amount: '535.00' });
    expect((await call('GET', `/api/v1/ap-opening/${p1.body.id}`)).body).toMatchObject({ ref_no: 'BILL-9', vat_basis: '1', outstanding: '535.00', editable: true });
    // บริษัทอื่น
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('GET', '/api/v1/ar-opening')).body.rows).toEqual([]);
    expect((await call('GET', `/api/v1/ap-opening/${p1.body.id}`)).status).toBe(404);
    expect((await call('POST', '/api/v1/ar-opening', ob)).status).toBe(400);   // ลูกค้าของบริษัทอื่น
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    // ยกเลิก (ไม่มีงวด — ไม่ตรวจงวด) · ใบเสร็จก่อน
    expect((await call('POST', `/api/v1/ar-receipts/${re.id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
    for (const [path, id] of [['ar-opening', o1.body.id], ['ar-opening', o2.body.id], ['ap-opening', p1.body.id]])
      expect((await call('POST', `/api/v1/${path}/${id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
    expect((await call('GET', '/api/v1/ar-opening')).body.total).toBe('0.00');
  });

  it('party activity (T3.11): per-period totals incl. VAT from live documents, cheques not yet passed, isolation', async () => {
    const ivType = (await call('GET', '/api/v1/trade-defaults/IV')).body.types.find((t: { code: string }) => t.code === 'IV').id;
    const cus = (await call('GET', '/api/v1/customers?q=C200')).body.rows[0].id;
    const cpu = (await call('GET', '/api/v1/items?q=01-INTL')).body.rows[0].id;
    const iv = (await call('POST', '/api/v1/sales-invoices', { doc_type_id: ivType, doc_date: '2026-03-10', party_id: cus, price_type: '2', vat_rate: 7, lines: [{ item_id: cpu, qty: 1, unit_price: 1000 }] })).body;
    const act = (await call('GET', `/api/v1/customers/${cus}/activity`)).body;
    expect(act.periods).toHaveLength(12);
    expect(act.periods.find((p: { period_no: number }) => p.period_no === 3)).toMatchObject({ credit: '1070.00', cash: '0', settled: '0' });
    expect(act).toMatchObject({ opening_total: '0', cheques: [], cheque_total: '0.00' });
    expect((await call('POST', `/api/v1/sales-invoices/${iv.id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
    expect((await call('GET', `/api/v1/customers/${cus}/activity`)).body.periods.find((p: { period_no: number }) => p.period_no === 3).credit).toBe('0');
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('GET', `/api/v1/customers/${cus}/activity`)).status).toBe(404);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
  });

  it('stock balances (T4.1): live from document lines, stock card running balance, isolation', async () => {
    const unit = (await call('GET', '/api/v1/lookups?types=UNIT')).body.UNIT[0].id;
    const cpu = (await call('POST', '/api/v1/items', { code: '02-TEST-000041', name_th: 'สินค้าทดสอบสต๊อก', base_unit_id: unit })).body.id;
    const wh = (await call('GET', '/api/v1/lookups?types=WH')).body.WH[0].id;
    const ju = (await sql<{ id: string }>`SELECT id FROM md_doc_type WHERE company_id = ${companyId} AND doc_class = 'JU' LIMIT 1`.execute(database.db)).rows[0];
    // รับเข้า 10 @100 แล้วจ่าย 4 (บรรทัดเอกสารสินค้าโดยตรง — เอกสารสินค้าเต็มรูปแบบมาใน T4.3)
    const h = (await sql<{ id: string }>`INSERT INTO doc_header (company_id, branch_id, doc_type_id, doc_class, module, doc_no, doc_date)
      VALUES (${companyId}, (SELECT id FROM sys_branch WHERE company_id = ${companyId} LIMIT 1), ${ju?.id ?? (await sql<{ id: string }>`SELECT id FROM md_doc_type WHERE company_id = ${companyId} LIMIT 1`.execute(database.db)).rows[0]!.id}, 'JU', 'IC', 'T41-001', '2026-05-01') RETURNING id`.execute(database.db)).rows[0]!.id;
    await sql`INSERT INTO doc_line (company_id, header_id, line_no, item_id, warehouse_id, qty, base_qty, stock_effect, movement_code, cost_amount) VALUES
      (${companyId}, ${h}, 1, ${cpu}, ${wh}, 10, 10, 1, '1', 1000), (${companyId}, ${h}, 2, ${cpu}, ${wh}, 4, 4, -1, '6', 400)`.execute(database.db);
    const bal = (await call('GET', `/api/v1/stock/balances?item_id=${cpu}`)).body;
    expect(bal.rows.find((r: { warehouse_id: string }) => r.warehouse_id === wh)).toMatchObject({ qty: '6.0000', value: '600.00', avg_cost: '100.0000' });
    const card = (await call('GET', `/api/v1/stock/card?item_id=${cpu}&warehouse_id=${wh}&from=2026-05-01&to=2026-05-31`)).body;
    expect(card.lines.map((l: { balance_qty: string }) => l.balance_qty)).toEqual(['10', '6']);
    expect(card).toMatchObject({ opening: { qty: '0' }, closing: { qty: '6', value: '600.00' }, in: { qty: '10' }, out: { qty: '4' } });
    expect((await call('GET', `/api/v1/stock/card?item_id=${cpu}&from=2026-06-01&to=2026-06-30`)).body.opening).toMatchObject({ qty: '6', value: '600.00' });
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('GET', '/api/v1/stock/balances')).body.rows).toEqual([]);
    expect((await call('GET', `/api/v1/stock/card?item_id=${cpu}&from=2026-01-01&to=2026-12-31`)).status).toBe(404);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    await sql`UPDATE doc_header SET doc_status = 'C' WHERE id = ${h}`.execute(database.db);
  });

  it('stock from sales/purchases (T4.2): receipts at net cost, issues at average or FIFO, returns, edit/cancel recompute, negative check', async () => {
    const typeOf = async (cls: string) => (await call('GET', `/api/v1/trade-defaults/${cls}`)).body.types[0].id as string;
    const ivType = (await call('GET', '/api/v1/trade-defaults/IV')).body.types.find((t: { code: string }) => t.code === 'IV').id;
    const unit = (await call('GET', '/api/v1/lookups?types=UNIT')).body.UNIT[0].id;
    const cus = (await call('GET', '/api/v1/customers?q=C200')).body.rows[0].id;
    const sup = (await call('GET', '/api/v1/suppliers?q=S200')).body.rows[0].id;
    const it = (await call('POST', '/api/v1/items', { code: '02-TEST-000042', name_th: 'สินค้าคิดต้นทุน', base_unit_id: unit, std_cost: '50' })).body.id;
    const bal = async () => { const r = (await call('GET', `/api/v1/stock/balances?item_id=${it}`)).body.rows[0]; return r ? `${Number(r.qty)}/${r.value}` : '0/0'; };
    const rrType = await typeOf('RR');
    const r1 = (await call('POST', '/api/v1/purchase-invoices', { doc_type_id: rrType, doc_date: '2026-04-01', party_id: sup, price_type: '2', vat_rate: 7, lines: [{ item_id: it, qty: 10, unit_price: 100 }] })).body;
    const r2 = (await call('POST', '/api/v1/purchase-invoices', { doc_type_id: rrType, doc_date: '2026-04-02', party_id: sup, price_type: '2', vat_rate: 7, discount_text: '10%', lines: [{ item_id: it, qty: 10, unit_price: 120 }] })).body;
    expect(await bal()).toBe('20/2080.00');                       // 1,000 + (1,200 − 10%) — มูลค่าก่อน VAT หลังส่วนลด
    // ขาย 4 ถัวเฉลี่ย 104 → 416
    const iv = { doc_type_id: ivType, doc_date: '2026-04-05', party_id: cus, price_type: '2', vat_rate: 7, lines: [{ item_id: it, qty: 4, unit_price: 200 }] };
    const i1 = (await call('POST', '/api/v1/sales-invoices', iv)).body;
    expect((await call('GET', `/api/v1/sales-invoices/${i1.id}`)).body.lines[0]).toMatchObject({ qty: '4.0000' });
    expect(await bal()).toBe('16/1664.00');
    const card = (await call('GET', `/api/v1/stock/card?item_id=${it}&from=2026-04-01&to=2026-04-30`)).body;
    expect(card.lines.map((l: { doc_no: string; value: string }) => l.value)).toEqual(['1000.00', '1080.00', '-416.00']);
    // รับคืน 1 (ติ๊ก R) ที่ต้นทุนเฉลี่ย · ส่งคืนผู้จำหน่าย 2 · ไม่ติ๊ก R ไม่กระทบสต๊อก
    const cn = (await call('POST', '/api/v1/ar-credit-notes', { doc_type_id: await typeOf('CN'), doc_date: '2026-04-06', party_id: cus, ref_header_id: i1.id, price_type: '2', vat_rate: 7, lines: [{ item_id: it, qty: 1, unit_price: 200, return_to_stock: true }] })).body;
    const cn2 = (await call('POST', '/api/v1/ar-credit-notes', { doc_type_id: await typeOf('CN'), doc_date: '2026-04-06', party_id: cus, ref_header_id: i1.id, price_type: '2', vat_rate: 7, lines: [{ item_id: it, qty: 1, unit_price: 10 }] })).body;
    expect(await bal()).toBe('17/1768.00');
    const dn = (await call('POST', '/api/v1/ap-credit-notes', { doc_type_id: await typeOf('DN'), doc_date: '2026-04-07', party_id: sup, ref_header_id: r1.id, price_type: '2', vat_rate: 7, lines: [{ item_id: it, qty: 2, unit_price: 100, return_to_stock: true }] })).body;
    expect(await bal()).toBe('15/1560.00');
    // แก้บิลขายเป็น 5 → คิดใหม่ทั้งบรรทัด · ยกเลิก → สต๊อกกลับ
    expect((await call('PUT', `/api/v1/sales-invoices/${i1.id}`, { ...iv, lines: [{ item_id: it, qty: 5, unit_price: 200 }] })).status).toBe(200);
    expect(await bal()).toBe('14/1456.00');
    // FIFO (กลุ่มบัญชีสินค้า F): จ่าย 3 จากล็อตแรก @100
    const grp = (await sql<{ id: string }>`INSERT INTO md_item_account_group (company_id, code, name_th, cost_method) VALUES (${companyId}, 'FIFO', 'กลุ่ม FIFO', 'F') RETURNING id`.execute(database.db)).rows[0]!.id;
    await sql`UPDATE md_item SET account_group_id = ${grp} WHERE id = ${it}`.execute(database.db);
    const i2 = (await call('POST', '/api/v1/sales-invoices', { ...iv, doc_date: '2026-04-08', lines: [{ item_id: it, qty: 3, unit_price: 200 }] })).body;
    expect((await call('GET', `/api/v1/stock/card?item_id=${it}&from=2026-04-08&to=2026-04-08`)).body.lines[0].value).toBe('-300.00');
    // ไม่ยอมให้ติดลบ + ตรวจยอด ณ ปัจจุบัน
    await call('PUT', '/api/v1/settings', { values: { 'ic.allow_negative': 'N', 'ic.negative_check_level': '1' } });
    expect((await call('POST', '/api/v1/sales-invoices', { ...iv, lines: [{ item_id: it, qty: 100, unit_price: 1 }] })).body.error.message).toMatch(/ไม่พอจ่าย/);
    await call('PUT', '/api/v1/settings', { values: { 'ic.allow_negative': 'Y', 'ic.negative_check_level': '0' } });
    for (const [path, id] of [['sales-invoices', i2.id], ['ap-credit-notes', dn.id], ['ar-credit-notes', cn.id], ['ar-credit-notes', cn2.id], ['sales-invoices', i1.id], ['purchase-invoices', r2.id], ['purchase-invoices', r1.id]])
      expect((await call('POST', `/api/v1/${path}/${id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
    expect(await bal()).toBe('0/0');
  });

  it('stock documents (T4.3): internal issue, transfer, adjustment, cost adjustment — balances, journals, validation, isolation', async () => {
    const typeOf = async (cls: string) => (await call('GET', `/api/v1/trade-defaults/${cls}`)).body.types[0].id as string;
    const unit = (await call('GET', '/api/v1/lookups?types=UNIT')).body.UNIT[0].id;
    const [w1, w2] = (await call('GET', '/api/v1/lookups?types=WH')).body.WH.map((w: { id: string }) => w.id);
    const it = (await call('POST', '/api/v1/items', { code: '02-TEST-000043', name_th: 'สินค้าเอกสารคลัง', base_unit_id: unit, std_cost: '10' })).body.id;
    const bal = async () => (await call('GET', `/api/v1/stock/balances?item_id=${it}`)).body.rows.map((r: { warehouse_id: string; qty: string; value: string }) => `${r.warehouse_id === w1 ? 1 : 2}:${Number(r.qty)}/${r.value}`).sort().join(' ');
    const roles = async (id: string) => (await call('GET', `/api/v1/docs/${id}/journal`)).body.journals[0]?.lines.map((l: { posting_role: string; debit: string; credit: string }) => `${l.posting_role}:${Number(l.debit) || -Number(l.credit)}`).sort();
    // ปรับเพิ่ม 10 @12 → 120 (Perpetual: Dr สินค้า / Cr รายได้อื่น)
    const ju = (await call('POST', '/api/v1/stock-adjustments', { doc_type_id: await typeOf('JU'), doc_date: '2026-05-01', lines: [{ item_id: it, warehouse_id: w1, qty: 10, unit_cost: 12 }] })).body;
    expect(ju.doc_no).toBeTruthy();
    expect(await bal()).toBe('1:10/120.00');
    expect(await roles(ju.id)).toEqual(['INVENTORY:120', 'STOCK_ADJ:-120']);
    // จ่ายใช้ภายใน 3 ถัวเฉลี่ย 12 → 36
    const ouBody = { doc_type_id: await typeOf('OU'), doc_date: '2026-05-02', remark: 'เบิกใช้สำนักงาน', lines: [{ item_id: it, warehouse_id: w1, qty: 3 }] };
    const ou = (await call('POST', '/api/v1/stock-issues', ouBody)).body;
    expect(ou.net_amount).toBe('36.00');
    expect(await roles(ou.id)).toEqual(['INVENTORY:-36', 'ISSUE:36']);
    expect(await bal()).toBe('1:7/84.00');
    // แก้เป็น 4 → คิดใหม่
    expect((await call('PUT', `/api/v1/stock-issues/${ou.id}`, { ...ouBody, lines: [{ item_id: it, warehouse_id: w1, qty: 4 }] })).status).toBe(200);
    expect(await bal()).toBe('1:6/72.00');
    // โอนย้าย 2 จากคลัง 1 → 2 (ต้นทุนเดียวกัน ไม่ลงบัญชี) · หน้ารายละเอียดแสดงบรรทัดเดียว
    const rlBody = { doc_type_id: await typeOf('RL'), doc_date: '2026-05-03', warehouse_id: w1, to_warehouse_id: w2, lines: [{ item_id: it, qty: 2 }] };
    const rl = (await call('POST', '/api/v1/stock-transfers', rlBody)).body;
    expect(await bal()).toBe('1:4/48.00 2:2/24.00');
    expect(rl.journal_id).toBeFalsy();
    const rlDoc = (await call('GET', `/api/v1/stock-transfers/${rl.id}`)).body;
    expect(rlDoc.lines).toHaveLength(1);
    expect(rlDoc.to_warehouse_id).toBe(w2);
    expect((await call('POST', '/api/v1/stock-transfers', { ...rlBody, to_warehouse_id: w1 })).body.error.message).toMatch(/ต้องต่างกัน/);
    // ปรับลด 1 ที่คลัง 2 → −12 (Dr ค่าใช้จ่ายอื่น / Cr สินค้า)
    const ju2 = (await call('POST', '/api/v1/stock-adjustments', { doc_type_id: await typeOf('JU'), doc_date: '2026-05-04', lines: [{ item_id: it, warehouse_id: w2, qty: -1 }] })).body;
    expect(await bal()).toBe('1:4/48.00 2:1/12.00');
    expect(await roles(ju2.id)).toEqual(['INVENTORY:-12', 'STOCK_ADJ:12']);
    // เพิ่มต้นทุน 6 (จำนวนไม่เปลี่ยน) → จ่ายครั้งต่อไปใช้ทุนใหม่ 54/4
    const ca = (await call('POST', '/api/v1/cost-adjustments', { doc_type_id: await typeOf('CA'), doc_date: '2026-05-05', lines: [{ item_id: it, warehouse_id: w1, amount: 6 }] })).body;
    expect(await bal()).toBe('1:4/54.00 2:1/12.00');
    expect(await roles(ca.id)).toEqual(['COST_ADJ:-6', 'INVENTORY:6']);
    // FIFO ต้องเลือกล็อต · สินค้าบริการตัดสต๊อกไม่ได้ · จำนวนศูนย์
    const grp = (await sql<{ id: string }>`INSERT INTO md_item_account_group (company_id, code, name_th, cost_method) VALUES (${companyId}, 'FIFO43', 'กลุ่ม FIFO', 'F') RETURNING id`.execute(database.db)).rows[0]!.id;
    await sql`UPDATE md_item SET account_group_id = ${grp} WHERE id = ${it}`.execute(database.db);
    expect((await call('POST', '/api/v1/cost-adjustments', { doc_type_id: await typeOf('CA'), doc_date: '2026-05-05', lines: [{ item_id: it, warehouse_id: w1, amount: 6 }] })).body.error.message).toMatch(/เลือกล็อต/);
    const lot = (await call('GET', `/api/v1/stock/lots?item_id=${it}&warehouse_id=${w1}`)).body.rows[0];
    expect(lot.doc_no).toBe(ju.doc_no);
    const svc = (await sql<{ id: string }>`INSERT INTO md_item (company_id, code, name_th, item_type, base_unit_id) VALUES (${companyId}, 'SV-TEST-44', 'บริการ', '3', ${unit}) RETURNING id`.execute(database.db)).rows[0]!.id;
    expect((await call('POST', '/api/v1/stock-issues', { ...ouBody, lines: [{ item_id: svc, qty: 1 }] })).body.error.message).toMatch(/ไม่ใช่สินค้าที่มีสต๊อก/);
    expect((await call('POST', '/api/v1/stock-issues', { ...ouBody, lines: [{ item_id: it, qty: 0 }] })).body.error.message).toMatch(/ป้อนจำนวน/);
    // รายการ + ข้ามบริษัทไม่ได้
    expect((await call('GET', '/api/v1/stock-issues?q=เบิกใช้สำนักงาน')).body.rows.map((r: { id: string }) => r.id)).toEqual([ou.id]);
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('GET', '/api/v1/stock-issues')).body.rows).toHaveLength(0);
    expect((await call('GET', `/api/v1/stock-transfers/${rl.id}`)).status).toBe(404);
    expect((await call('POST', `/api/v1/stock-issues/${ou.id}/cancel`, { reason: 'x' })).status).toBe(404);
    expect((await call('GET', `/api/v1/stock/lots?item_id=${it}`)).body.rows).toHaveLength(0);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    // ยกเลิก → สต๊อกกลับ (ใบสำคัญยกเลิกด้วย)
    for (const [path, id] of [['cost-adjustments', ca.id], ['stock-adjustments', ju2.id], ['stock-transfers', rl.id], ['stock-issues', ou.id], ['stock-adjustments', ju.id]])
      expect((await call('POST', `/api/v1/${path}/${id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
    expect(await bal()).toBe('');
    expect((await call('PUT', `/api/v1/stock-issues/${ou.id}`, ouBody)).body.error.message).toMatch(/ยกเลิกแล้ว/);
    // ใบปรับยอดตอนย้ายข้อมูลแก้/ยกเลิกไม่ได้
    await sql`UPDATE doc_header SET doc_no = 'MIG-ADJ-T43' WHERE id = ${ju2.id}`.execute(database.db);
    await sql`UPDATE doc_header SET doc_status = 'N' WHERE id = ${ju2.id}`.execute(database.db);
    expect((await call('GET', `/api/v1/stock-adjustments/${ju2.id}`)).body.editable).toBe(false);
    expect((await call('POST', `/api/v1/stock-adjustments/${ju2.id}/cancel`, { reason: 'x' })).body.error.message).toMatch(/ย้ายข้อมูล/);
    await sql`UPDATE doc_header SET doc_status = 'C' WHERE id = ${ju2.id}`.execute(database.db);
  });

  it('row-level security confines company data even when a query forgets the company filter (T0.14)', async () => {
    expect(await rlsAvailable(database)).toBe(true);
    // ทุกตารางที่มี company_id เปิด RLS แล้ว (ตารางใหม่ใน migration ถัดไปต้องเปิดด้วย)
    const noRls = await sql<{ t: string }>`SELECT c.table_name AS t FROM information_schema.columns c
        JOIN information_schema.tables x ON x.table_schema = c.table_schema AND x.table_name = c.table_name AND x.table_type = 'BASE TABLE'
        JOIN pg_class k ON k.relname = c.table_name AND k.relkind = 'r'
       WHERE c.table_schema = 'public' AND c.column_name = 'company_id' AND NOT k.relrowsecurity ORDER BY 1`.execute(database.db);
    expect(noRls.rows.map((r) => r.t)).toEqual([]);
    // view ต้องทำงานด้วยสิทธิ์ผู้เรียก ไม่งั้นข้าม RLS
    const definerViews = await sql<{ v: string }>`SELECT c.relname AS v FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'v' AND NOT coalesce(c.reloptions::text[] @> ARRAY['security_invoker=true'], false) ORDER BY 1`.execute(database.db);
    expect(definerViews.rows.map((r) => r.v)).toEqual([]);
    const tenant = (await sql<{ t: string }>`SELECT tenant_id AS t FROM sys_company WHERE id = ${companyId}`.execute(database.db)).rows[0]!.t;
    const count = async (q: string) => Number((await sql<{ n: number }>`${sql.raw(q)}`.execute(database.db)).rows[0]!.n);
    // ข้อมูลของบริษัทอื่นที่ต้องมองไม่เห็น (สร้างในฐานะเจ้าของฐานข้อมูล)
    await sql`INSERT INTO md_department (company_id, code, name_th) VALUES (${otherCompanyId}, 'OTHER1', 'แผนกของบริษัทอื่น')`.execute(database.db);
    await sql`INSERT INTO gl_account (company_id, account_no, name_th, level, account_group, is_control, normal_side) VALUES (${otherCompanyId}, '9999-99', 'บัญชีของบริษัทอื่น', 1, '1', false, 'D')`.execute(database.db);
    const all = await count('SELECT count(*) AS n FROM gl_account');
    const mine = await count(`SELECT count(*) AS n FROM gl_account WHERE company_id = '${companyId}'`);
    expect(all).toBeGreaterThan(mine);
    await runInCompanyScope(database, { companyId, tenantId: tenant, isPlatform: false }, async () => {
      // query ที่ "ลืม" กรองบริษัท ยังเห็นเฉพาะบริษัทของคำขอ
      expect(await count('SELECT count(*) AS n FROM gl_account')).toBe(mine);
      expect(await count(`SELECT count(*) AS n FROM gl_account WHERE company_id = '${otherCompanyId}'`)).toBe(0);
      expect(await count(`SELECT count(*) AS n FROM gl_journal WHERE company_id <> '${companyId}'`)).toBe(0);
      expect(await count("SELECT count(*) AS n FROM md_department WHERE code = 'OTHER1'")).toBe(0);
      expect(await count(`SELECT count(*) AS n FROM v_trial_balance WHERE company_id <> '${companyId}'`)).toBe(0);
      // บริษัท/ลูกค้า: เห็นเฉพาะของลูกค้าเดียวกัน
      expect(await count(`SELECT count(*) AS n FROM sys_company WHERE tenant_id IS DISTINCT FROM '${tenant}'`)).toBe(0);
      expect(await count('SELECT count(*) AS n FROM sys_tenant')).toBe(1);
    });
    // เขียนข้อมูลให้บริษัทอื่นไม่ได้ (นโยบาย WITH CHECK)
    await expect(runInCompanyScope(database, { companyId, tenantId: tenant, isPlatform: false }, () =>
      sql`INSERT INTO md_department (company_id, code, name_th) VALUES (${otherCompanyId}, 'RLS', 'ทดสอบ RLS')`.execute(database.db))).rejects.toThrow(/row-level security/);
    // แก้ข้อมูลบริษัทอื่นด้วยคำสั่งที่ไม่กรองบริษัท = ไม่โดนแถวใดเลย
    await runInCompanyScope(database, { companyId, tenantId: tenant, isPlatform: false }, async () => {
      const r = await sql`UPDATE md_department SET name_th = 'ถูกแก้' WHERE code = 'OTHER1'`.execute(database.db);
      expect(Number(r.numAffectedRows ?? 0)).toBe(0);
    });
    expect((await sql<{ n: string }>`SELECT name_th AS n FROM md_department WHERE code = 'OTHER1'`.execute(database.db)).rows[0]!.n).toBe('แผนกของบริษัทอื่น');
  });

  it('runs an Express-style layout with variables', async () => {
    const accts = (await call('GET', '/api/v1/gl/accounts')).body;
    const r = await call('POST', '/api/v1/fs/layouts', {
      code: 'T1', name: 'ทดสอบ', header_lines: ['\\NAME', 'งบทดสอบ'], columns: [{ expr: 'BAL' }], line_set_code: 'T1',
      lines: [
        { line_no: 10, data_type: 'A/C', source: '1111-00', accumulate: { A: '+' }, description_th: 'เงินสด' },
        { line_no: 20, data_type: 'A/C', source: '1000-00', accumulate: {}, print_condition: 'N', description_th: 'ซ่อน' },
        { line_no: 30, data_type: 'VAR', source: 'A', accumulate: { A: '0' }, description_th: 'รวม' },
      ],
    });
    expect(r.status).toBe(200);
    const run = (await call('GET', `/api/v1/fs/run?layout_id=${r.body.id}&end=2026-12-31`)).body;
    expect(run.headers[0]).toBe('บริษัท ทดสอบ จำกัด');
    const vals = run.rows.filter((x: { kind: string }) => x.kind === 'value').map((x: { values: string[] }) => x.values[0]);
    expect(vals).toEqual(['1005000.25', '1005000.25']);
    expect(accts.length).toBeGreaterThan(0);
  });

  it('separates customer tenants completely (หลายลูกค้า ข้อมูลไม่ปนกัน)', async () => {
    const platform = cookie;
    // เจ้าหน้าที่ผู้ให้บริการสร้างลูกค้า 2 ราย
    const ta = await call('POST', '/api/v1/tenants', { code: 'CUSTA', name: 'ลูกค้า A', admin_username: 'a.admin', admin_name: 'ผู้ดูแล A', admin_password: 'passA1234', max_companies: 2 });
    const tb = await call('POST', '/api/v1/tenants', { code: 'CUSTB', name: 'ลูกค้า B', admin_username: 'b.admin', admin_name: 'ผู้ดูแล B', admin_password: 'passB1234' });
    expect(ta.status).toBe(200); expect(tb.status).toBe(200);
    const login = async (u: string, p: string) => { cookie = ''; const r = await call('POST', '/api/v1/auth/login', { username: u, password: p }); return r; };

    const bGroup = (await call('GET', '/api/v1/users')).body.groups.find((g: { tenant_id: string | null }) => g.tenant_id === tb.body.id).id;
    // ลูกค้า A สร้างบริษัทของตัวเอง
    expect((await login('a.admin', 'passA1234')).status).toBe(200);
    expect((await call('GET', '/api/v1/auth/me')).body.companies).toHaveLength(0);   // ไม่เห็นบริษัทของผู้ให้บริการ/ลูกค้าอื่น
    const ca = (await call('POST', '/api/v1/companies', { code: 'A-CO1', name_th: 'บริษัท เอ จำกัด', fiscal_start: '2026-01-01', chart: 'express' })).body.id;
    await call('POST', '/api/v1/auth/select', { company_id: ca });
    const aBook = (await call('GET', '/api/v1/gl/books')).body[0].id;
    const aAcc = (await call('GET', '/api/v1/gl/accounts')).body.filter((x: { is_control: boolean }) => !x.is_control);
    const aJv = await call('POST', '/api/v1/gl/journals', { journal_book_id: aBook, voucher_date: '2026-03-01', lines: [{ account_id: aAcc[0].id, debit: '10' }, { account_id: aAcc[1].id, credit: '10' }] });
    expect(aJv.status).toBe(200);
    const aTpl = (await call('POST', '/api/v1/gl/templates', { code: 'A-TPL', name: 'ต้นแบบของ A', lines: [{ account_id: aAcc[0].id, side: 'D' }, { account_id: aAcc[1].id, side: 'C' }] })).body.id;
    expect(aTpl).toBeTruthy();
    const aFy = (await call('GET', '/api/v1/gl/periods')).body[0].id;
    const aCus = (await call('POST', '/api/v1/customers', { code: 'A-C1', name: 'ลูกค้าของ A', tax_id: '0105537095903' })).body.id;
    expect(aCus).toBeTruthy();
    expect((await call('PUT', '/api/v1/settings', { values: { 'gen.vat_rate': 10 } })).status).toBe(200);
    expect((await call('PUT', '/api/v1/gl/prior-year/entry', { fiscal_year_id: aFy, account_id: aAcc[0].id, opening: {}, periods: [{ period_no: 1, debit: '7' }] })).status).toBe(200);
    // สิทธิ์รายเมนู (T0.10): กำหนด/ดูสิทธิ์ของกลุ่มลูกค้า B ไม่ได้
    expect((await call('GET', `/api/v1/permissions?subject_type=G&subject_id=${bGroup}`)).status).toBe(404);
    expect((await call('PUT', '/api/v1/permissions', { subject_type: 'G', subject_id: bGroup, rows: [] })).status).toBe(404);
    // คัดลอกผังบัญชีจากบริษัทของลูกค้าอื่นไม่ได้
    expect((await call('POST', '/api/v1/companies', { code: 'A-CO2', name_th: 'x', fiscal_start: '2026-01-01', chart: 'copy', copy_from_company_id: companyId })).status).toBe(403);
    expect((await call('GET', '/api/v1/tenants')).status).toBe(403);
    const aUsers = (await call('GET', '/api/v1/users')).body.users.map((u: { username: string }) => u.username);
    expect(aUsers).toEqual(['a.admin']);
    // ให้สิทธิ์ผู้ใช้ของตัวเองเข้าบริษัทลูกค้าอื่นไม่ได้
    expect((await call('POST', '/api/v1/users', { username: 'a.clerk', display_name: 'พนักงาน A', password: 'clerk1234', companies: [companyId] })).status).toBe(400);
    expect((await call('POST', '/api/v1/users', { username: 'a.clerk', display_name: 'พนักงาน A', password: 'clerk1234', companies: [ca] })).status).toBe(200);

    // ลูกค้า B มองไม่เห็นและเข้าบริษัทของ A ไม่ได้
    expect((await login('b.admin', 'passB1234')).status).toBe(200);
    expect((await call('GET', '/api/v1/auth/me')).body.companies).toHaveLength(0);
    expect((await call('POST', '/api/v1/auth/select', { company_id: ca })).status).toBe(400);
    expect((await call('GET', '/api/v1/gl/accounts')).status).toBe(400);            // ยังไม่มีบริษัท = ไม่มีข้อมูล
    expect((await call('GET', '/api/v1/users')).body.users.map((u: { username: string }) => u.username)).toEqual(['b.admin']);
    const aClerk = await call('GET', '/api/v1/activity-log');
    expect(JSON.stringify(aClerk.body)).not.toContain('A-CO1');
    // ต้นแบบวิธีการบันทึกของลูกค้า A — ลูกค้า B เปิด/แก้/ลบไม่ได้ แม้รู้รหัส
    const cb = (await call('POST', '/api/v1/companies', { code: 'B-CO1', name_th: 'บริษัท บี จำกัด', fiscal_start: '2026-01-01', chart: 'express' })).body.id;
    await call('POST', '/api/v1/auth/select', { company_id: cb });
    expect((await call('GET', '/api/v1/gl/templates')).body).toHaveLength(0);
    expect((await call('GET', `/api/v1/gl/templates/${aTpl}`)).status).toBe(404);
    expect((await call('PUT', `/api/v1/gl/templates/${aTpl}`, { code: 'HACK', name: 'x', lines: [{ account_id: aAcc[0].id, side: 'D' }] })).status).toBe(404);
    expect((await call('DELETE', `/api/v1/gl/templates/${aTpl}`)).status).toBe(404);
    // ลูกค้า/ผู้จำหน่ายของลูกค้า A — ลูกค้า B ค้น/เปิด/แก้/ลบไม่ได้ (S-AR-01)
    expect((await call('GET', '/api/v1/customers?q=A-C1&status=all')).body.total).toBe(0);
    expect((await call('GET', `/api/v1/customers/${aCus}`)).status).toBe(404);
    expect((await call('PUT', `/api/v1/customers/${aCus}`, { code: 'HACK', name: 'x', tax_id: '0105537095903' })).status).toBe(404);
    expect((await call('DELETE', `/api/v1/customers/${aCus}`)).status).toBe(404);
    // ค่าเริ่มต้นของลูกค้า A ไม่ปนกับของลูกค้า B
    expect((await call('GET', '/api/v1/settings')).body.values['gen.vat_rate']).toBe(7);
    // ยอดปีที่แล้วของลูกค้า A — ลูกค้า B อ่าน/เขียนไม่ได้ (S-GL-16)
    expect((await call('GET', `/api/v1/gl/prior-year?fiscal_year_id=${aFy}`)).status).toBe(404);
    const bFy = (await call('GET', '/api/v1/gl/periods')).body[0].id;
    expect((await call('GET', `/api/v1/gl/prior-year/entry?fiscal_year_id=${bFy}&account_id=${aAcc[0].id}`)).status).toBe(404);
    expect((await call('PUT', '/api/v1/gl/prior-year/entry', { fiscal_year_id: bFy, account_id: aAcc[0].id, opening: {}, periods: [{ period_no: 1, debit: '1' }] })).body.error.message).toMatch(/ไม่พบบัญชี/);
    // รายละเอียดประกอบของลูกค้า A — ลูกค้า B เปิดไม่ได้ (R-GL-01)
    expect((await call('GET', `/api/v1/reports/account-detail?account_id=${aAcc[0].id}&as_of=2026-12-31`)).status).toBe(404);
    // งบประมาณของลูกค้า A — ลูกค้า B อ่าน/เขียนไม่ได้ (S-GL-17)
    expect((await call('GET', `/api/v1/gl/budget?fiscal_year_id=${aFy}`)).status).toBe(404);
    expect((await call('GET', `/api/v1/gl/budget/entry?fiscal_year_id=${bFy}&account_id=${aAcc[0].id}`)).status).toBe(404);
    expect((await call('PUT', '/api/v1/gl/budget/entry', { fiscal_year_id: bFy, account_id: aAcc[0].id, periods: [{ period_no: 1, amount: '1' }] })).body.error.message).toMatch(/ไม่พบบัญชี/);
    // ใบสำคัญของลูกค้า A — ลูกค้า B ค้นหรือเปิดเพื่อคัดลอกรายการไม่ได้ (S-GL-06)
    expect((await call('GET', `/api/v1/gl/journals?q=${aJv.body.voucher_no}`)).body.total).toBe(0);
    expect((await call('GET', `/api/v1/gl/journals/${aJv.body.id}`)).status).toBe(404);

    // พนักงานของ A เห็นเฉพาะบริษัทที่ได้รับสิทธิ์
    expect((await login('a.clerk', 'clerk1234')).status).toBe(200);
    expect((await call('GET', '/api/v1/auth/me')).body.companies.map((c: { code: string }) => c.code)).toEqual(['A-CO1']);
    expect((await call('GET', '/api/v1/users')).status).toBe(403);

    // ระงับลูกค้า A → เข้าระบบไม่ได้ และ session เดิมหมดทันที
    cookie = platform;
    await call('PUT', `/api/v1/tenants/${ta.body.id}`, { code: 'CUSTA', name: 'ลูกค้า A', status: 'S' });
    expect((await login('a.admin', 'passA1234')).status).toBe(403);
    // ผู้ให้บริการยังเห็นทุกบริษัท
    cookie = platform;
    const all = (await call('GET', '/api/v1/auth/me')).body.companies.map((c: { code: string }) => c.code);
    expect(all).toEqual(expect.arrayContaining(['A-CO1', 'DEMO', 'OTHER']));
  });
});
