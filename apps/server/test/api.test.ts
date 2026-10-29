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

  it('row-level security confines company data even when a query forgets the company filter (T0.14)', async () => {
    expect(await rlsAvailable(database)).toBe(true);
    // ทุกตารางที่มี company_id เปิด RLS แล้ว (ตารางใหม่ใน migration ถัดไปต้องเปิดด้วย)
    const noRls = await sql<{ t: string }>`SELECT c.table_name AS t FROM information_schema.columns c
        JOIN information_schema.tables x ON x.table_schema = c.table_schema AND x.table_name = c.table_name AND x.table_type = 'BASE TABLE'
        JOIN pg_class k ON k.relname = c.table_name AND k.relkind = 'r'
       WHERE c.table_schema = 'public' AND c.column_name = 'company_id' AND NOT k.relrowsecurity ORDER BY 1`.execute(database.db);
    expect(noRls.rows.map((r) => r.t)).toEqual([]);
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
