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
import { API_RULES, REGISTERED_ROUTES, syncMenus } from '../src/modules/permissions.js';
import { setAiClientFactory } from '../src/modules/ai.js';
import { base32Decode, stepOf, totpAt } from '../src/modules/security.js';
import { taxIdCheckDigit } from '@buddy/core';
import { createZip } from '../src/zip.js';
import { readTable } from '../src/modules/trade-import.js';
/** เลขผู้เสียภาษีที่ถูกต้องและไม่ซ้ำกัน สำหรับคู่ค้าทดสอบ (เลข + สาขาซ้ำในบริษัทเดียวกันบันทึกไม่ได้) */
const tid = (n: number) => { const b = `0105560${String(n).padStart(5, '0')}`; return b + taxIdCheckDigit(b); };


let database: Database;
let app: FastifyInstance;
let cookie = '';

async function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown) {
  const r = await app.inject({ method, url, payload: body as object, headers: cookie ? { cookie } : {} });
  const set = r.headers['set-cookie'];
  if (set) cookie = (Array.isArray(set) ? set[0]! : set).split(';')[0]!;
  // ไฟล์ข้อความ (เช่น ไฟล์ยื่นภาษี) คืนเป็นสตริง
  const parsed = (() => { if (!r.body) return null; try { return JSON.parse(r.body); } catch { return r.body; } })();
  return { status: r.statusCode, body: parsed };
}

/** เรียกด้วยกุญแจ API (ไม่มี cookie) */
async function keyCall(key: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown) {
  const r = await app.inject({ method, url, payload: body as object, headers: { authorization: `Bearer ${key}` } });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
}

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.BUDDY_REQUIRE_ADMIN_2FA = '0';   // ทดสอบบังคับ 2FA แยกในชุด T0.16
  process.env.BUDDY_SECRET_KEY ??= Buffer.alloc(32, 7).toString('base64');   // ไม่แตะแฟ้มกุญแจจริงใน .data
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
    // เลขผู้เสียภาษีซ้ำ (ข้อกำหนดเจ้าของ): เลข + สาขาเดียวกันในรายที่ยังใช้อยู่ = ห้าม · กรณีอื่นเตือน
    expect(s1.body.warnings.join()).toMatch(/เป็นลูกค้าด้วย: C001/);
    const T = tid(900), tx = { code: 'TX1', name: 'บริษัท ภาษี จำกัด', tax_id: T, tax_branch_no: '0' };
    const tx1 = await call('POST', '/api/v1/customers', tx);
    expect(tx1.status).toBe(200); expect(tx1.body.warnings).toEqual([]);
    const same = await call('POST', '/api/v1/customers', { ...tx, code: 'TX2', tax_branch_no: '00000' });
    expect(same.status).toBe(409); expect(same.body.error.message).toMatch(/สาขา 00000 ใช้กับลูกค้า TX1/);
    expect((await call('POST', '/api/v1/customers', { ...tx, code: 'TX2', tax_branch_no: '' })).status).toBe(409);          // ว่าง = สำนักงานใหญ่
    const br = await call('POST', '/api/v1/customers', { ...tx, code: 'TX2', tax_branch_no: '2' });
    expect(br.status).toBe(200); expect(br.body.warnings.join()).toMatch(/TX1 \(สาขา 00000\)/);
    expect((await call('PUT', `/api/v1/customers/${br.body.id}`, { ...tx, code: 'TX2', tax_branch_no: '0' })).status).toBe(409);   // เปลี่ยนสาขาไปชนรายอื่นไม่ได้
    expect((await call('PUT', `/api/v1/customers/${br.body.id}`, { ...tx, code: 'TX2', tax_branch_no: '2', phone: '02-111' })).body.warnings).toEqual([]);
    // รายที่เลิกใช้แล้ว → เตือน ไม่ห้าม
    expect((await call('PUT', `/api/v1/customers/${tx1.body.id}`, { ...tx, status: 'I' })).status).toBe(200);
    const tx3 = await call('POST', '/api/v1/customers', { ...tx, code: 'TX3' });
    expect(tx3.status).toBe(200); expect(tx3.body.warnings.join()).toMatch(/เลิกใช้แล้ว: TX1/);
    // ข้อมูลเดิมที่ซ้ำอยู่แล้ว (ย้ายจาก Express) ยังแก้ช่องอื่นได้
    const dupOld = (await sql<{ id: string }>`INSERT INTO md_customer (company_id, code, name, tax_id, tax_branch_no) VALUES (${companyId}, 'TX-OLD', 'รายเดิมซ้ำ', ${T}, '00000') RETURNING id`.execute(database.db)).rows[0]!.id;
    expect((await call('PUT', `/api/v1/customers/${dupOld}`, { code: 'TX-OLD', name: 'รายเดิมซ้ำ', tax_id: T, tax_branch_no: '0', phone: '02-222' })).status).toBe(200);
    // ผู้จำหน่ายใช้กฎเดียวกัน (ตรวจแยกจากลูกค้า แต่เตือนเมื่อเลขเดียวกันเป็นลูกค้าด้วย)
    const sx = await call('POST', '/api/v1/suppliers', { code: 'SX1', name: 'บริษัท ภาษี จำกัด', tax_id: T });
    expect(sx.status).toBe(200); expect(sx.body.warnings.join()).toMatch(/เป็นลูกค้าด้วย: TX-OLD, TX1, TX2, TX3/);
    expect((await call('POST', '/api/v1/suppliers', { code: 'SX2', name: 'ซ้ำ', tax_id: T, tax_branch_no: '00000' })).body.error.message).toMatch(/ใช้กับผู้จำหน่าย SX1/);
    // บริษัทอื่นใช้เลขเดียวกันได้ ไม่เตือนข้ามบริษัท
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    const ox = await call('POST', '/api/v1/customers', { ...tx, code: 'TX1' });
    expect(ox.status).toBe(200); expect(ox.body.warnings).toEqual([]);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
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
    const cus = (await call('POST', '/api/v1/customers', { code: 'C100', name: 'ลูกค้าเอกสารขาย', tax_id: tid(1), credit_days: 30 })).body.id;
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
    const cus = (await call('POST', '/api/v1/customers', { code: 'C200', name: 'ลูกค้ารับชำระ', tax_id: tid(2), credit_days: 30 })).body.id;
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
    const sup = (await call('POST', '/api/v1/suppliers', { code: 'S200', name: 'ผู้รับจ้างทดสอบ', tax_id: tid(3) })).body.id;
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
    // แท็บภาษีของบิล: ภาษีหัก ณ ที่จ่ายที่หักตอนจ่ายชำระบิลนี้ + ภาษีซื้อของบิล
    expect((await call('GET', `/api/v1/wht?invoice_id=${rr.id}&status=all`)).body.rows.map((x: { doc_no: string }) => x.doc_no)).toEqual([p1.body.doc_no]);
    expect((await call('GET', `/api/v1/vat/P?invoice_id=${rr.id}&status=all`)).body.rows.map((x: { doc_no: string; vat_amount: string }) => `${x.doc_no}:${x.vat_amount}`)).toEqual([`${rr.doc_no}:105.00`]);
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
    expect((await call('GET', `/api/v1/wht?invoice_id=${rr.id}&status=all`)).body.rows).toHaveLength(0);
    expect((await call('GET', `/api/v1/vat/P?invoice_id=${rr.id}&status=all`)).body.rows).toHaveLength(0);
    expect((await call('PUT', `/api/v1/wht/${wid}`, wput)).status).toBe(400);   // ผู้จำหน่ายของบริษัทอื่น
    expect((await call('POST', `/api/v1/ap-payments/${p1.body.id}/cancel`, { reason: 'x' })).status).toBe(404);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    // ยกเลิกใบสำคัญจ่าย → รายการภาษีหัก ณ ที่จ่ายยกเลิกด้วย
    expect((await call('POST', `/api/v1/ap-payments/${p1.body.id}/cancel`, { reason: 'จ่ายซ้ำ' })).status).toBe(200);
    expect((await call('GET', '/api/v1/wht?form=S53&month=2026-07&status=C')).body.rows[0]).toMatchObject({ id: wid, doc_status: 'C' });
    // ซื้อเงินสดหักภาษี ณ ที่จ่าย 3% (คำขอเจ้าของ 30/10/2569): จ่ายเงินสด 1,605 − 45 · เข้าแฟ้ม ภ.ง.ด.53 · Cr ภาษีหัก ณ ที่จ่ายค้างจ่าย
    const hpBody = { doc_type_id: await typeOf('HP'), doc_date: '2026-07-05', party_id: sup, price_type: '2', vat_rate: 7, lines: [{ item_id: cpu, qty: 1, unit_price: 1500 }],
      wht: [{ form_type: 'S53', income_type: 'ค่าบริการ', rate: 3, paid_amount: 1500, tax_amount: 45 }] };
    expect((await call('POST', '/api/v1/cash-purchases', { ...hpBody, wht: [], wht_amount: 45 })).body.error.message).toMatch(/รายละเอียดภาษีหัก/);
    expect((await call('POST', '/api/v1/purchase-invoices', { ...hpBody, doc_type_id: await typeOf('RR') })).body.error.message).toMatch(/ตอนรับ\/จ่ายชำระ/);
    expect((await call('POST', '/api/v1/cash-purchases', { ...hpBody, wht: [{ ...hpBody.wht[0], tax_amount: 2000, paid_amount: 2000 }] })).body.error.message).toMatch(/มากกว่ายอดเงินรวมทั้งสิ้น/);
    const hp = await call('POST', '/api/v1/cash-purchases', hpBody);
    expect(hp.body.error?.message ?? 'ok').toBe('ok');
    const hpd = (await call('GET', `/api/v1/cash-purchases/${hp.body.id}`)).body;
    expect(hpd).toMatchObject({ net_amount: '1605.00', wht_amount: '45.00', cash_amount: '1560.00' });
    expect(hpd.wht[0]).toMatchObject({ form_type: 'S53', certificate_no: hp.body.doc_no, tax_amount: '45.00' });
    const roles = async (hid: string) => ((await call('GET', `/api/v1/docs/${hid}/journal`)).body.journals[0].lines as Array<{ posting_role: string; debit: string; credit: string }>).map((l) => `${l.posting_role}:${l.debit}:${l.credit}`).sort();
    expect(await roles(hp.body.id)).toEqual(expect.arrayContaining(['WHT:0.00:45.00', 'CASH:0.00:1560.00', 'INPUT_VAT:105.00:0.00']));
    expect((await call('GET', `/api/v1/wht?header_id=${hp.body.id}`)).body.rows).toHaveLength(1);
    expect((await call('GET', `/api/v1/vat/P?header_id=${hp.body.id}`)).body.rows[0]).toMatchObject({ doc_no: hp.body.doc_no, vat_amount: '105.00' });
    // แก้ไข: ไม่หักแล้ว → รายการเดิมหายจากแฟ้ม เงินสดเต็มจำนวน
    expect((await call('PUT', `/api/v1/cash-purchases/${hp.body.id}`, { ...hpBody, wht: [] })).status).toBe(200);
    expect((await call('GET', `/api/v1/wht?header_id=${hp.body.id}&status=all`)).body.rows).toHaveLength(0);
    expect((await call('GET', `/api/v1/cash-purchases/${hp.body.id}`)).body).toMatchObject({ wht_amount: '0.00', cash_amount: '1605.00' });
    expect((await call('PUT', `/api/v1/cash-purchases/${hp.body.id}`, hpBody)).status).toBe(200);
    expect((await call('GET', `/api/v1/wht?header_id=${hp.body.id}`)).body.rows).toHaveLength(1);
    expect((await call('GET', '/api/v1/reports/trial-balance?from=2026-01-01&to=2026-12-31')).body.balanced).toBe(true);
    // บริษัทอื่นไม่เห็น · ยกเลิก → รายการภาษีหัก ณ ที่จ่ายยกเลิกด้วย
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('GET', `/api/v1/wht?header_id=${hp.body.id}&status=all`)).body.rows).toHaveLength(0);
    expect((await call('GET', `/api/v1/vat/P?header_id=${hp.body.id}&status=all`)).body.rows).toHaveLength(0);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    expect((await call('POST', `/api/v1/cash-purchases/${hp.body.id}/cancel`, { reason: 'ทดสอบ' })).status).toBe(200);
    expect((await call('GET', `/api/v1/wht?header_id=${hp.body.id}&status=all`)).body.rows[0]).toMatchObject({ doc_status: 'C' });
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
    // อ้างใบวางบิลในใบเสร็จ (T7.1): ใบวางบิลของลูกค้าพร้อมใบกำกับในใบ
    const bl = (await call('GET', `/api/v1/ar-receipts/bills?party_id=${cus}`)).body.rows.find((x: { id: string }) => x.id === b1.body.id);
    expect([bl.doc_no, [...bl.invoice_ids].sort()]).toEqual([b1.body.doc_no, [i1.id, i2.id].sort()]);
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
  it('stock count (T4.4): prepare, enter counts, live system qty and difference, adjust to a JU/TK document, reopen, isolation', async () => {
    const typeOf = async (cls: string) => (await call('GET', `/api/v1/trade-defaults/${cls}`)).body.types[0].id as string;
    const unit = (await call('GET', '/api/v1/lookups?types=UNIT')).body.UNIT[0].id;
    const [w1, w2] = (await call('GET', '/api/v1/lookups?types=WH')).body.WH.map((w: { id: string }) => w.id);
    const code = '02-TEST-000045';
    const it = (await call('POST', '/api/v1/items', { code, name_th: 'สินค้าตรวจนับ', base_unit_id: unit, std_cost: '10' })).body.id;
    const bal = async () => (await call('GET', `/api/v1/stock/balances?item_id=${it}`)).body.rows.map((r: { warehouse_id: string; qty: string; value: string }) => `${r.warehouse_id === w1 ? 1 : 2}:${Number(r.qty)}/${r.value}`).sort().join(' ');
    const ju = (await call('POST', '/api/v1/stock-adjustments', { doc_type_id: await typeOf('JU'), doc_date: '2026-06-01', lines: [{ item_id: it, warehouse_id: w1, qty: 10, unit_cost: 10 }] })).body;
    const D = '2026-06-30';
    const list = async (extra = '') => (await call('GET', `/api/v1/stock-counts?count_date=${D}&q=${code}${extra}`)).body;
    // สร้างข้อมูลตรวจนับ: เฉพาะคู่ที่เคยเคลื่อนไหว · สร้างซ้ำไม่ซ้ำแถว
    const prep = (await call('POST', '/api/v1/stock-counts/prepare', { count_date: D, replace: true, item_from: code, item_to: code })).body;
    expect(prep.added).toBe(1);
    expect((await call('POST', '/api/v1/stock-counts/prepare', { count_date: D, replace: false, item_from: code, item_to: code })).body.added).toBe(0);
    let rows = (await list()).rows;
    expect(rows.map((r: { warehouse_id: string; flag: string; system_qty: string; counted_qty: string | null }) => [r.warehouse_id === w1, r.flag, Number(r.system_qty), r.counted_qty])).toEqual([[true, '1', 10, null]]);
    // เพิ่มสินค้าที่พบในคลัง 2 · ห้ามยอดติดลบ · บันทึกยอดนับ
    const extra = (await call('POST', '/api/v1/stock-counts/rows', { count_date: D, warehouse_id: w2, item_id: it })).body.id;
    expect((await call('POST', '/api/v1/stock-counts/rows', { count_date: D, warehouse_id: w2, item_id: it })).body.error.message).toMatch(/อยู่ในรายการนับ/);
    expect((await call('PUT', '/api/v1/stock-counts/entries', { rows: [{ id: rows[0].id, counted_qty: -1 }] })).body.error.message).toMatch(/ไม่ติดลบ/);
    expect((await call('PUT', '/api/v1/stock-counts/entries', { rows: [{ id: rows[0].id, counted_qty: '7', shelf: 'A-01' }, { id: extra, counted_qty: 2 }] })).body.updated).toBe(2);
    const counted = await list('&status=diff');
    expect(counted.rows.map((r: { flag: string; diff_qty: string; diff_value: string | null; shelf: string | null }) => [r.flag, Number(r.diff_qty), r.diff_value, r.shelf])).toEqual([['3', -3, '-30.00', 'A-01'], ['3', 2, '20.00', null]]);
    // ปรับปรุงยอด → ใบ JU ณ วันนับ · ยอดเท่ายอดนับ · สถานะ 6
    const adj = (await call('POST', '/api/v1/stock-counts/adjust', { count_date: D, item_from: code, item_to: code })).body;
    expect(adj.lines).toBe(2);
    expect(await bal()).toBe('1:7/70.00 2:2/20.00');
    rows = (await list()).rows;
    expect(rows.map((r: { flag: string; adjust_doc_no: string; adjusted_diff: string }) => [r.flag, r.adjust_doc_no, Number(r.adjusted_diff)])).toEqual([['6', adj.doc_no, -3], ['6', adj.doc_no, 2]]);
    expect((await call('PUT', '/api/v1/stock-counts/entries', { rows: [{ id: extra, counted_qty: 3 }] })).body.error.message).toMatch(/ปรับปรุงยอดแล้ว/);
    expect((await call('GET', `/api/v1/stock-adjustments/${adj.id}`)).body).toMatchObject({ editable: false, from_count: true });
    expect((await call('PUT', `/api/v1/stock-adjustments/${adj.id}`, { doc_type_id: await typeOf('JU'), doc_date: D, lines: [{ item_id: it, warehouse_id: w1, qty: 1 }] })).body.error.message).toMatch(/สร้างจากการตรวจนับ/);
    expect((await call('POST', '/api/v1/stock-counts/adjust', { count_date: D, item_from: code, item_to: code })).body.error.message).toMatch(/ไม่มีรายการที่บันทึกยอดนับแล้ว/);
    // ข้ามบริษัทไม่ได้
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('GET', `/api/v1/stock-counts?count_date=${D}`)).body.rows).toHaveLength(0);
    expect((await call('PUT', '/api/v1/stock-counts/entries', { rows: [{ id: extra, counted_qty: 1 }] })).status).toBe(404);
    expect((await call('POST', '/api/v1/stock-counts/reopen', { header_id: adj.id, reason: 'x' })).status).toBe(404);
    expect((await call('DELETE', `/api/v1/stock-counts/${extra}`)).status).toBe(404);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    // ยกเลิกการปรับปรุง → สถานะ 3 แก้ยอดนับได้ · ผลต่าง 0 ก็สร้างบรรทัด
    expect((await call('POST', '/api/v1/stock-counts/reopen', { header_id: adj.id, reason: 'นับใหม่' })).status).toBe(200);
    expect(await bal()).toBe('1:10/100.00');
    expect((await list()).rows.map((r: { flag: string }) => r.flag)).toEqual(['3', '3']);
    await call('PUT', '/api/v1/stock-counts/entries', { rows: [{ id: rows[0].id, counted_qty: 10 }, { id: extra, counted_qty: null }] });
    const adj2 = (await call('POST', '/api/v1/stock-counts/adjust', { count_date: D, item_from: code, item_to: code })).body;
    expect(adj2.lines).toBe(1);
    expect((await call('GET', `/api/v1/stock-adjustments/${adj2.id}`)).body.lines.map((l: { qty: string }) => Number(l.qty))).toEqual([0]);
    expect((await call('DELETE', `/api/v1/stock-counts/${extra}`)).status).toBe(200);
    // ยกเลิกจากหน้าปรับปรุงก็คืนสถานะ 3
    expect((await call('POST', `/api/v1/stock-adjustments/${adj2.id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
    expect((await list()).rows.map((r: { flag: string }) => r.flag)).toEqual(['3']);
    expect((await call('POST', `/api/v1/stock-adjustments/${ju.id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
    expect(await bal()).toBe('');
  });
  it('opening stock + serial register (T4.5): lots before go-live feed FIFO/average, no journal, serial CRUD with service history, isolation', async () => {
    const unit = (await call('GET', '/api/v1/lookups?types=UNIT')).body.UNIT[0].id;
    const [w1, w2] = (await call('GET', '/api/v1/lookups?types=WH')).body.WH.map((w: { id: string }) => w.id);
    const it = (await call('POST', '/api/v1/items', { code: '02-TEST-000046', name_th: 'สินค้ายกมา', base_unit_id: unit, std_cost: '1' })).body.id;
    const bal = async () => (await call('GET', `/api/v1/stock/balances?item_id=${it}`)).body.rows.map((r: { warehouse_id: string; qty: string; value: string }) => `${r.warehouse_id === w1 ? 1 : 2}:${Number(r.qty)}/${r.value}`).sort().join(' ');
    // ต้องก่อนวันเริ่มใช้ · จำนวน > 0 · ห้ามคลังซ้ำในล็อต
    const start = (await call('GET', '/api/v1/stock-opening')).body.start_date as string;
    expect((await call('POST', '/api/v1/stock-opening', { doc_no: 'ยอดยกมา', doc_date: start, lines: [{ item_id: it, warehouse_id: w1, qty: 1, value: 1 }] })).body.error.message).toMatch(/ก่อนวันเริ่มใช้/);
    expect((await call('POST', '/api/v1/stock-opening', { doc_no: 'ยอดยกมา', doc_date: '2024-12-31', lines: [{ item_id: it, warehouse_id: w1, qty: 0, value: 1 }] })).body.error.message).toMatch(/มากกว่า 0/);
    expect((await call('POST', '/api/v1/stock-opening', { doc_no: 'ยอดยกมา', doc_date: '2024-12-31', lines: [{ item_id: it, warehouse_id: w1, qty: 1, value: 1 }, { item_id: it, warehouse_id: w1, qty: 1, value: 1 }] })).body.error.message).toMatch(/ซ้ำ/);
    // ล็อตเก่า 10 @30 (คลัง 1) + 5 @20 (คลัง 2) · ล็อตใหม่ 10 @40 (คลัง 1)
    const o1 = (await call('POST', '/api/v1/stock-opening', { doc_no: 'RR6712/001', doc_date: '2024-11-30', remark: 'ล็อตเก่า', lines: [{ item_id: it, warehouse_id: w1, qty: 10, value: 300 }, { item_id: it, warehouse_id: w2, qty: 5, value: 100 }] })).body;
    const o2 = (await call('POST', '/api/v1/stock-opening', { doc_no: 'RR6712/009', doc_date: '2024-12-20', lines: [{ item_id: it, warehouse_id: w1, qty: 10, value: 400 }] })).body;
    expect(o1.net_amount).toBe('400.00');
    expect(await bal()).toBe('1:20/700.00 2:5/100.00');
    expect((await call('GET', `/api/v1/docs/${o1.id}/journal`)).body.journals).toHaveLength(0);
    expect((await call('POST', '/api/v1/stock-opening', { doc_no: 'RR6712/009', doc_date: '2024-12-20', lines: [{ item_id: it, warehouse_id: w1, qty: 1, value: 1 }] })).body.error.message).toMatch(/มีอยู่แล้ว/);
    // ไม่ปนกับเอกสารคลังอื่น · ค้นด้วยรหัสสินค้าได้
    expect((await call('GET', '/api/v1/stock-adjustments?q=RR6712')).body.rows).toHaveLength(0);
    expect((await call('GET', '/api/v1/stock-opening?q=02-TEST-000046')).body.rows.map((r: { doc_no: string }) => r.doc_no)).toEqual(['RR6712/001', 'RR6712/009']);
    // FIFO: จ่าย 12 = 10 @30 + 2 @40 = 380
    const grp = (await sql<{ id: string }>`INSERT INTO md_item_account_group (company_id, code, name_th, cost_method) VALUES (${companyId}, 'FIFO46', 'กลุ่ม FIFO', 'F') RETURNING id`.execute(database.db)).rows[0]!.id;
    await sql`UPDATE md_item SET account_group_id = ${grp} WHERE id = ${it}`.execute(database.db);
    const ou = (await call('POST', '/api/v1/stock-issues', { doc_type_id: (await call('GET', '/api/v1/trade-defaults/OU')).body.types[0].id, doc_date: '2026-07-01', lines: [{ item_id: it, warehouse_id: w1, qty: 12 }] })).body;
    expect(ou.net_amount).toBe('380.00');
    // แก้ล็อต · ยกเลิก
    const det = (await call('GET', `/api/v1/stock-opening/${o2.id}`)).body;
    expect(det.lines.map((l: { qty: string; value: string; cost_unit: string }) => [Number(l.qty), l.value, Number(l.cost_unit)])).toEqual([[10, '400.00', 40]]);
    expect((await call('PUT', `/api/v1/stock-opening/${o2.id}`, { doc_no: 'RR6712/009', doc_date: '2024-12-20', lines: [{ item_id: it, warehouse_id: w1, qty: 8, value: 320 }] })).status).toBe(200);
    expect(await bal()).toBe('1:6/240.00 2:5/100.00');
    // ทะเบียนหมายเลขสินค้า
    const cus = (await call('GET', '/api/v1/customers?q=C200')).body.rows[0].id;
    const sn = (await call('POST', '/api/v1/serials', { serial_no: 'S/N222000111', machine_no: 'PIII-600', ref_code: 'CDROM ASUS 48X', item_id: it, description: 'ซีดีรอม', sale_date: '2026-07-01', warranty_end: '2027-06-30', customer_id: cus,
      services: [{ service_date: '2026-08-01', service_by: 'ช่างเอ', detail: 'เปลี่ยนสายแพ' }] })).body.id;
    expect((await call('POST', '/api/v1/serials', { serial_no: 'S/N222000111' })).body.error.message).toMatch(/มีในทะเบียนแล้ว/);
    expect((await call('POST', '/api/v1/serials', { serial_no: 'S/N9', sale_date: '2026-07-01', warranty_end: '2026-06-30' })).body.error.message).toMatch(/หมดประกัน/);
    const one = (await call('GET', `/api/v1/serials/${sn}`)).body;
    expect(one).toMatchObject({ serial_no: 'S/N222000111', item_code: '02-TEST-000046', ref_code: 'CDROM ASUS 48X', print_count: 0 });
    expect(one.services.map((s: { detail: string }) => s.detail)).toEqual(['เปลี่ยนสายแพ']);
    const keep = { serial_no: one.serial_no, machine_no: one.machine_no, ref_code: one.ref_code, item_id: one.item_id, description: one.description, sale_date: '2026-07-01', warranty_end: '2027-06-30', customer_id: cus };
    expect((await call('PUT', `/api/v1/serials/${sn}`, { ...keep, services: [{ service_date: '2026-08-01', service_by: 'ช่างเอ', detail: 'เปลี่ยนสายแพ' }, { service_date: '2026-09-01', service_by: 'ช่างบี', detail: 'ล้างหัวอ่าน' }] })).status).toBe(200);
    expect((await call('GET', '/api/v1/serials?q=ASUS&with_services=Y')).body.rows[0].services).toHaveLength(2);
    expect((await call('POST', `/api/v1/serials/${sn}/printed`)).body.print_count).toBe(1);
    // ข้ามบริษัทไม่ได้
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('GET', '/api/v1/stock-opening')).body.rows).toHaveLength(0);
    expect((await call('GET', `/api/v1/stock-opening/${o1.id}`)).status).toBe(404);
    expect((await call('POST', `/api/v1/stock-opening/${o1.id}/cancel`, { reason: 'x' })).status).toBe(404);
    expect((await call('GET', '/api/v1/serials')).body.rows).toHaveLength(0);
    expect((await call('PUT', `/api/v1/serials/${sn}`, { serial_no: 'X' })).status).toBe(404);
    expect((await call('POST', '/api/v1/serials', { serial_no: 'S/N222000111', item_id: it })).body.error.message).toMatch(/ไม่พบสินค้า/);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    expect((await call('DELETE', `/api/v1/serials/${sn}`)).status).toBe(200);
    for (const [path, id] of [['stock-issues', ou.id], ['stock-opening', o2.id], ['stock-opening', o1.id]])
      expect((await call('POST', `/api/v1/${path}/${id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
    expect(await bal()).toBe('');
  });
  it('bank movements (T4.6): deposit, withdraw, transfer with fee, interest with WHT, bank charge — journals, bank book, edit/cancel, isolation', async () => {
    const typeOf = async (cls: string) => (await call('GET', `/api/v1/trade-defaults/${cls}`)).body.types[0].id as string;
    const gl = async (no: string) => (await sql<{ id: string }>`INSERT INTO gl_account (company_id, account_no, name_th, level, account_group, is_control, normal_side) VALUES (${companyId}, ${no}, ${'เงินฝากทดสอบ ' + no}, 3, '1', false, 'D') RETURNING id`.execute(database.db)).rows[0]!.id;
    const t1 = (await call('POST', '/api/v1/bank-accounts', { code: 'T1', name: 'กระแสรายวันทดสอบ', account_kind: 'C', gl_account_id: await gl('1112-91') })).body.id;
    const t2 = (await call('POST', '/api/v1/bank-accounts', { code: 'T2', name: 'ออมทรัพย์ทดสอบ', account_kind: 'S', gl_account_id: await gl('1112-92') })).body.id;
    const roles = async (id: string) => (await call('GET', `/api/v1/docs/${id}/journal`)).body.journals[0]?.lines.map((l: { posting_role: string; debit: string; credit: string }) => `${l.posting_role}:${Number(l.debit) || -Number(l.credit)}`).sort();
    const book = async (b: string) => (await call('GET', `/api/v1/bank-book?bank_account_id=${b}&from=2026-08-01&to=2026-08-31`)).body;
    const post = async (path: string, cls: string, x: Record<string, unknown>) => (await call('POST', `/api/v1/${path}`, { doc_type_id: await typeOf(cls), doc_date: '2026-08-05', ...x })).body;
    const bd = await post('bank-deposits', 'BD', { bank_account_id: t1, amount: 1000, remark: 'นำเงินสดฝาก' });
    expect(bd.doc_no).toBeTruthy();
    expect(await roles(bd.id)).toEqual(['BANK:1000', 'CASH:-1000']);
    const bt = await post('bank-transfers', 'BT', { bank_account_id: t1, to_bank_account_id: t2, amount: 300, fee: 15 });
    expect(bt.net_amount).toBe('315.00');
    expect(await roles(bt.id)).toEqual(['BANK:-315', 'BANK:300', 'BANK_CHARGE:15']);
    expect((await call('GET', `/api/v1/bank-transfers/${bt.id}`)).body).toMatchObject({ fee: '15.00', to_bank_account_id: t2 });
    const bu = await post('bank-incomes', 'BU', { bank_account_id: t1, amount: 100, wht: 1 });
    expect(await roles(bu.id)).toEqual(['BANK:99', 'BANK_INCOME:-100', 'WHT:1']);
    const bv = await post('bank-expenses', 'BV', { bank_account_id: t2, amount: 20 });
    expect(await roles(bv.id)).toEqual(['BANK:-20', 'BANK_EXPENSE:20']);
    const bw = await post('bank-withdrawals', 'BW', { bank_account_id: t1, amount: 50 });
    expect(await roles(bw.id)).toEqual(['BANK:-50', 'CASH:50']);
    // ตรวจข้อมูล
    expect((await post('bank-transfers', 'BT', { bank_account_id: t1, to_bank_account_id: t1, amount: 1 })).error.message).toMatch(/ต้องต่างกัน/);
    expect((await post('bank-transfers', 'BT', { bank_account_id: t1, amount: 1 })).error.message).toMatch(/โอนเข้า/);
    expect((await post('bank-deposits', 'BD', { bank_account_id: t1, amount: 0 })).error.message).toMatch(/มากกว่า 0/);
    expect((await post('bank-incomes', 'BU', { bank_account_id: t1, amount: 10, wht: 10 })).error.message).toMatch(/น้อยกว่าดอกเบี้ย/);
    expect((await call('POST', '/api/v1/bank-deposits', { doc_type_id: await typeOf('BW'), doc_date: '2026-08-05', bank_account_id: t1, amount: 1 })).body.error.message).toMatch(/เลือกประเภทเอกสาร/);
    // สมุดเงินฝาก = ใบสำคัญของบัญชีเงินฝาก (คำนวณสด)
    let b1 = await book(t1);
    expect([b1.rows.length, b1.closing]).toEqual([4, '734.00']);
    expect(b1.rows.map((r: { source_doc_no: string }) => r.source_doc_no).sort()).toEqual([bd.doc_no, bt.doc_no, bu.doc_no, bw.doc_no].sort());
    expect((await book(t2)).closing).toBe('280.00');
    expect((await call('GET', `/api/v1/bank-transfers?bank_account_id=${t2}`)).body.rows.map((r: { id: string }) => r.id)).toEqual([bt.id]);
    // แก้ → ใบสำคัญเดิมแก้ตาม
    expect((await call('PUT', `/api/v1/bank-deposits/${bd.id}`, { doc_type_id: await typeOf('BD'), doc_date: '2026-08-05', bank_account_id: t1, amount: 1200 })).status).toBe(200);
    b1 = await book(t1);
    expect([b1.rows.length, b1.closing]).toEqual([4, '934.00']);
    // ข้ามบริษัทไม่ได้
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('GET', '/api/v1/bank-deposits')).body.rows).toHaveLength(0);
    expect((await call('GET', `/api/v1/bank-transfers/${bt.id}`)).status).toBe(404);
    expect((await call('POST', `/api/v1/bank-withdrawals/${bw.id}/cancel`, { reason: 'x' })).status).toBe(404);
    expect((await call('GET', `/api/v1/bank-book?bank_account_id=${t1}&from=2026-08-01&to=2026-08-31`)).status).toBe(404);
    expect((await call('POST', '/api/v1/bank-deposits', { doc_type_id: bd.id, doc_date: '2026-08-05', bank_account_id: t1, amount: 1 })).body.error.message).toMatch(/เลือกประเภทเอกสาร/);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    for (const [path, id] of [['bank-deposits', bd.id], ['bank-transfers', bt.id], ['bank-incomes', bu.id], ['bank-expenses', bv.id], ['bank-withdrawals', bw.id]])
      expect((await call('POST', `/api/v1/${path}/${id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
    expect([(await book(t1)).closing, (await book(t2)).closing]).toEqual(['0.00', '0.00']);
    expect((await call('PUT', `/api/v1/bank-deposits/${bd.id}`, { doc_type_id: await typeOf('BD'), doc_date: '2026-08-05', bank_account_id: t1, amount: 1 })).body.error.message).toMatch(/ยกเลิกแล้ว/);
  });
  it('cheques (T4.7): register, deposit, pass/unpass, return, deposit slip passed as a whole, write-off remaining, paid cheques, isolation', async () => {
    const t1 = (await call('GET', '/api/v1/bank-accounts')).body.find((b: { code: string }) => b.code === 'T1').id;
    const cus = (await call('GET', '/api/v1/customers?q=C200')).body.rows[0].id;
    const book = async () => (await call('GET', `/api/v1/bank-book?bank_account_id=${t1}&from=2026-09-01&to=2026-09-30`)).body.closing as string;
    const one = async (id: string) => (await call('GET', `/api/v1/cheques/${id}`)).body;
    const add = async (no: string, amount: number, direction = 'R') => (await call('POST', '/api/v1/cheques', { direction, cheque_no: no, cheque_date: '2026-09-01', customer_id: direction === 'R' ? cus : null, payee_name: direction === 'P' ? 'ผู้รับเงินทดสอบ' : null, bank_account_id: direction === 'P' ? t1 : null, amount })).body.id as string;
    const c1 = await add('QR-T47-1', 1000), c2 = await add('QR-T47-2', 500), c3 = await add('QR-T47-3', 300);
    expect((await call('POST', '/api/v1/cheques', { direction: 'R', cheque_no: 'QR-T47-1', cheque_date: '2026-09-01', customer_id: cus, amount: 1 })).body.error.message).toMatch(/มีในทะเบียนแล้ว/);
    expect((await call('POST', '/api/v1/cheques', { direction: 'P', cheque_no: 'CP-X', cheque_date: '2026-09-01', amount: 1 })).body.error.message).toMatch(/บัญชีเงินฝาก/);
    const list = (await call('GET', '/api/v1/cheques?direction=R&status=00&q=QR-T47')).body;
    expect(list.rows.map((r: { cheque_no: string }) => r.cheque_no).sort()).toEqual(['QR-T47-1', 'QR-T47-2', 'QR-T47-3']);
    // นำฝากเป็นใบๆ (ค่าธรรมเนียม 10) → ผ่าน: เงินฝากเพิ่ม 990
    expect((await call('POST', '/api/v1/cheques/deposit', { cheque_ids: [c1], bank_account_id: t1, deposit_date: '2026-09-05', charge: 10 })).status).toBe(200);
    expect((await one(c1)).status).toBe('01');
    expect(await book()).toBe('0.00');                                                  // นำฝากยังไม่เพิ่มยอดเงินฝาก
    const p1 = (await call('POST', '/api/v1/cheques/pass', { cheque_ids: [c1], pass_date: '2026-09-10' })).body;
    expect(p1.passed).toHaveLength(1);
    expect(await book()).toBe('990.00');
    expect((await one(c1))).toMatchObject({ status: '10', pass_voucher_no: p1.passed[0].voucher_no, editable: false });
    expect((await call('PUT', `/api/v1/cheques/${c1}`, { cheque_no: 'QR-T47-9' })).body.error.message).toMatch(/แก้ไขไม่ได้/);
    // ยกเลิกผ่าน → คืน → เช็คคืนยื่นใหม่ (ประวัติ 20) → ผ่านใหม่เข้าบัญชีโดยตรง
    expect((await call('POST', `/api/v1/cheques/${c1}/unpass`, { reason: 'ผ่านผิดวัน' })).body.status).toBe('01');
    expect(await book()).toBe('0.00');
    expect((await call('POST', `/api/v1/cheques/${c1}/return`, { return_date: '2026-09-11', reason: 'โปรดติดต่อผู้สั่งจ่าย' })).body.status).toBe('02');
    const r1 = await one(c1);
    expect(r1.events.map((e: { to_status: string }) => e.to_status)).toEqual(['00', '01', '10', '01', '20', '02']);
    expect((await call('POST', '/api/v1/cheques/pass', { cheque_ids: [c1], pass_date: '2026-09-15' })).body.error.message).toMatch(/ยังไม่ได้นำฝาก/);
    expect((await call('POST', '/api/v1/cheques/pass', { cheque_ids: [c1], pass_date: '2026-09-15', bank_account_id: t1 })).status).toBe(200);
    expect(await book()).toBe('1000.00');
    // ใบนำฝาก BQ: 2 ใบ ค่าธรรมเนียม 5 → ผ่านทั้งใบ (เช็คในใบผ่านทีละใบไม่ได้)
    const bq = (await call('POST', '/api/v1/cheque-deposits', { cheque_ids: [c2, c3], bank_account_id: t1, doc_date: '2026-09-20', charge: 5 })).body;
    expect(bq.net_amount).toBe('795.00');
    expect((await call('POST', '/api/v1/cheque-deposits', { cheque_ids: [c2], bank_account_id: t1, doc_date: '2026-09-20' })).body.error.message).toMatch(/ใบนำฝากอื่น|ไม่ใช่เช็ครับในมือ/);
    expect((await call('POST', '/api/v1/cheques/pass', { cheque_ids: [c2], pass_date: '2026-09-21' })).body.error.message).toMatch(/ทั้งใบนำฝาก/);
    expect((await call('GET', `/api/v1/cheque-deposits/${bq.id}`)).body).toMatchObject({ cheques: [{ cheque_no: 'QR-T47-2' }, { cheque_no: 'QR-T47-3' }], charge: '5.00', editable: true });
    expect((await call('POST', `/api/v1/cheque-deposits/${bq.id}/pass`, { pass_date: '2026-09-19' })).body.error.message).toMatch(/ไม่ก่อนวันที่นำฝาก/);
    expect((await call('POST', `/api/v1/cheque-deposits/${bq.id}/pass`, { pass_date: '2026-09-22' })).status).toBe(200);
    expect(await book()).toBe('1795.00');
    expect((await one(c3)).status).toBe('10');
    expect((await call('POST', `/api/v1/cheque-deposits/${bq.id}/cancel`, { reason: 'x' })).body.error.message).toMatch(/ยกเลิกการผ่านก่อน/);
    expect((await call('POST', `/api/v1/cheque-deposits/${bq.id}/unpass`, { reason: 'ทดสอบ' })).status).toBe(200);
    expect(await book()).toBe('1000.00');
    expect((await call('POST', `/api/v1/cheque-deposits/${bq.id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
    expect([(await one(c2)).status, (await one(c3)).status]).toEqual(['00', '00']);
    // ยอดคงเหลือในเช็ค → รายได้อื่น
    expect((await call('POST', `/api/v1/cheques/${c3}/write-off`, { date: '2026-09-25' })).body.error.message).toMatch(/ไม่มียอดคงเหลือ/);
    await sql`UPDATE fin_cheque SET remaining_amount = 50 WHERE id = ${c3}`.execute(database.db);
    expect((await call('POST', `/api/v1/cheques/${c3}/write-off`, { date: '2026-09-25' })).body.amount).toBe('50.00');
    expect((await call('POST', `/api/v1/cheques/${c3}/write-off`, { date: '2026-09-25' })).body.error.message).toMatch(/ไม่มียอดคงเหลือ|ตัดยอดคงเหลือเป็นรายได้แล้ว/);
    expect((await one(c3)).writeoff_voucher_no).toBeTruthy();
    expect((await call('POST', `/api/v1/cheques/${c3}/write-off/cancel`, { reason: 'ทดสอบ' })).status).toBe(200);
    expect((await one(c3)).written_off_amount).toBe('0.00');
    // เช็คจ่าย: 05 → ผ่าน (เงินฝากลด) · แก้เลขเช็คที่ยังไม่ผ่านได้
    const cp = await add('CP-T47-1', 600, 'P');
    expect((await one(cp)).status).toBe('05');
    expect((await call('GET', '/api/v1/cheques?direction=P&status=05&q=CP-T47')).body.rows).toHaveLength(1);
    expect((await call('POST', '/api/v1/cheques/pass', { cheque_ids: [cp], pass_date: '2026-09-28' })).status).toBe(200);
    expect(await book()).toBe('400.00');
    expect((await call('PUT', `/api/v1/cheques/${c2}`, { cheque_no: 'QR-T47-2B' })).status).toBe(200);
    // ข้ามบริษัทไม่ได้
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('GET', '/api/v1/cheques?direction=R&q=QR-T47')).body.rows).toHaveLength(0);
    expect((await call('GET', `/api/v1/cheques/${c1}`)).status).toBe(404);
    expect((await call('POST', '/api/v1/cheques/pass', { cheque_ids: [c2], pass_date: '2026-09-28', bank_account_id: t1 })).status).toBe(404);
    expect((await call('GET', `/api/v1/cheque-deposits/${bq.id}`)).status).toBe(404);
    expect((await call('POST', `/api/v1/cheques/${c3}/write-off`, { date: '2026-09-25' })).status).toBe(404);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    // ล้างข้อมูลทดสอบ
    for (const id of [c1, cp]) expect((await call('POST', `/api/v1/cheques/${id}/unpass`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
    expect((await call('POST', '/api/v1/cheques/undeposit', { cheque_ids: [c1] })).status).toBe(200);
    for (const id of [c1, c2, c3, cp]) expect((await call('DELETE', `/api/v1/cheques/${id}`)).status).toBe(200);
    expect(await book()).toBe('0.00');
  });
  it('bank reconciliation + periodic inventory account (T4.8): cleared lines vs statement, period-end stock from inventory system, isolation', async () => {
    const typeOf = async (cls: string) => (await call('GET', `/api/v1/trade-defaults/${cls}`)).body.types[0].id as string;
    const banks = (await call('GET', '/api/v1/bank-accounts')).body as Array<{ id: string; code: string }>;
    const t1 = banks.find((b) => b.code === 'T1')!.id, t2 = banks.find((b) => b.code === 'T2')!.id;
    const bd = (await call('POST', '/api/v1/bank-deposits', { doc_type_id: await typeOf('BD'), doc_date: '2026-10-05', bank_account_id: t1, amount: 1000 })).body;
    const bw = (await call('POST', '/api/v1/bank-withdrawals', { doc_type_id: await typeOf('BW'), doc_date: '2026-10-06', bank_account_id: t1, amount: 200 })).body;
    const bv = (await call('POST', '/api/v1/bank-expenses', { doc_type_id: await typeOf('BV'), doc_date: '2026-10-07', bank_account_id: t2, amount: 30 })).body;
    const recon = async () => (await call('GET', `/api/v1/bank-recon?bank_account_id=${t1}&statement_date=2026-10-31&from=2026-10-01`)).body;
    let r = await recon();
    expect([r.book_balance, r.deposits_in_transit, r.outstanding_payments, r.adjusted_balance, r.statement_balance]).toEqual(['800.00', '1000.00', '200.00', '0.00', null]);
    expect(r.lines).toHaveLength(2);
    // ธนาคารแสดงเฉพาะเงินฝาก 1,000 → ติ๊กรายการนั้น → ผลต่าง 0
    expect((await call('PUT', '/api/v1/bank-recon/statement', { bank_account_id: t1, statement_date: '2026-10-31', closing_balance: '1000' })).status).toBe(200);
    const dep = r.lines.find((l: { debit: string }) => Number(l.debit) > 0).id;
    expect((await call('POST', '/api/v1/bank-recon/clear', { bank_account_id: t1, statement_date: '2026-10-31', line_ids: [dep], cleared: true })).body.updated).toBe(1);
    r = await recon();
    expect([r.deposits_in_transit, r.outstanding_payments, r.adjusted_balance, r.statement_balance, r.difference]).toEqual(['0.00', '200.00', '1000.00', '1000.00', '0.00']);
    expect(r.lines.find((l: { id: string }) => l.id === dep).cleared).toBe(true);
    // บรรทัดของบัญชีอื่นติ๊กไม่ได้
    const other = (await call('GET', `/api/v1/bank-recon?bank_account_id=${t2}&statement_date=2026-10-31&from=2026-10-01`)).body.lines[0].id;
    expect((await call('POST', '/api/v1/bank-recon/clear', { bank_account_id: t1, statement_date: '2026-10-31', line_ids: [other], cleared: true })).body.error.message).toMatch(/ไม่ใช่ของบัญชีเงินฝากนี้/);
    // บัญชีสินค้าคงเหลือ Periodic: ยอดจากระบบสินค้า ณ สิ้นงวด → คำนวณ (F5) / ป้อนเอง
    const unit = (await call('GET', '/api/v1/lookups?types=UNIT')).body.UNIT[0].id;
    const it = (await call('POST', '/api/v1/items', { code: '02-TEST-000048', name_th: 'สินค้าบัญชีคงเหลือ', base_unit_id: unit, std_cost: '10' })).body.id;
    const ju = (await call('POST', '/api/v1/stock-adjustments', { doc_type_id: await typeOf('JU'), doc_date: '2026-10-01', lines: [{ item_id: it, qty: 10, unit_cost: 10 }] })).body;
    const invAcc = (await sql<{ id: string }>`SELECT account_id AS id FROM gl_default_account WHERE company_id = ${companyId} AND role = 'INVENTORY' AND deleted_at IS NULL`.execute(database.db)).rows[0]!.id;
    expect((await call('GET', '/api/v1/gl/inventory-accounts')).body.rows.map((x: { id: string }) => x.id)).toContain(invAcc);
    let inv = (await call('GET', `/api/v1/gl/inventory?account_id=${invAcc}`)).body;
    expect(inv.rows).toHaveLength(13);
    const p10 = inv.rows.find((x: { period_no: number }) => x.period_no === 10), p9 = inv.rows.find((x: { period_no: number }) => x.period_no === 9);
    expect(Number(p10.system) - Number(p9.system)).toBe(100);
    expect(p10.entered).toBeNull();
    expect((await call('POST', '/api/v1/gl/inventory/compute', { account_id: invAcc, fiscal_year_id: inv.fiscal_year.id, period: -1 })).body.saved).toBe(13);
    inv = (await call('GET', `/api/v1/gl/inventory?account_id=${invAcc}`)).body;
    expect(inv.rows.find((x: { period_no: number }) => x.period_no === 10)).toMatchObject({ entered: p10.system, source: 'S' });
    expect((await call('PUT', '/api/v1/gl/inventory', { account_id: invAcc, fiscal_year_id: inv.fiscal_year.id, rows: [{ period_no: 12, amount: '-1' }] })).body.error.message).toMatch(/ไม่ติดลบ/);
    expect((await call('PUT', '/api/v1/gl/inventory', { account_id: invAcc, fiscal_year_id: inv.fiscal_year.id, rows: [{ period_no: 12, amount: '555', source: 'M' }] })).body.saved).toBe(1);
    inv = (await call('GET', `/api/v1/gl/inventory?account_id=${invAcc}`)).body;
    expect(inv.rows.filter((x: { entered: string | null }) => x.entered !== null).map((x: { period_no: number; entered: string }) => [x.period_no, x.entered])).toEqual([[12, '555.00']]);
    // ข้ามบริษัทไม่ได้
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('GET', `/api/v1/bank-recon?bank_account_id=${t1}&statement_date=2026-10-31`)).status).toBe(404);
    expect((await call('POST', '/api/v1/bank-recon/clear', { bank_account_id: t1, statement_date: '2026-10-31', line_ids: [dep], cleared: false })).status).toBe(404);
    expect((await call('GET', `/api/v1/gl/inventory?account_id=${invAcc}`)).status).toBe(404);
    expect((await call('PUT', '/api/v1/gl/inventory', { account_id: invAcc, fiscal_year_id: inv.fiscal_year.id, rows: [] })).body.error.message).toMatch(/ไม่พบ/);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    expect((await call('PUT', '/api/v1/gl/inventory', { account_id: invAcc, fiscal_year_id: inv.fiscal_year.id, rows: [] })).body.saved).toBe(0);
    for (const [path, id] of [['bank-deposits', bd.id], ['bank-withdrawals', bw.id], ['bank-expenses', bv.id], ['stock-adjustments', ju.id]])
      expect((await call('POST', `/api/v1/${path}/${id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
  });
  it('kits issue component stock + sell-below-cost warning (P4 leftovers): sale/purchase of a kit moves components, cost allocation, COGS', async () => {
    const typeOf = async (cls: string) => (await call('GET', `/api/v1/trade-defaults/${cls}`)).body.types[0].id as string;
    const unit = (await call('GET', '/api/v1/lookups?types=UNIT')).body.UNIT[0].id;
    const [w1] = (await call('GET', '/api/v1/lookups?types=WH')).body.WH.map((w: { id: string }) => w.id);
    const cus = (await call('GET', '/api/v1/customers?q=C200')).body.rows[0].id;
    const sup = (await call('GET', '/api/v1/suppliers?q=S200')).body.rows[0].id;
    const a = (await call('POST', '/api/v1/items', { code: '02-TEST-000049', name_th: 'ส่วนประกอบ A', base_unit_id: unit, std_cost: '10' })).body.id;
    const b = (await call('POST', '/api/v1/items', { code: '02-TEST-000050', name_th: 'ส่วนประกอบ B', base_unit_id: unit, std_cost: '20' })).body.id;
    const kitRes = await call('POST', '/api/v1/kits', { code: '80-TEST-000049', name_th: 'ชุดทดสอบ', item_type: '1', base_unit_id: unit, item_level: '11', bom: [{ component_item_id: a, qty: 1 }, { component_item_id: b, qty: 2 }] });
    expect(kitRes.status).toBe(200);
    const kit = kitRes.body.id;
    const bal = async (it: string) => { const r = (await call('GET', `/api/v1/stock/balances?item_id=${it}`)).body.rows[0]; return r ? `${Number(r.qty)}/${r.value}` : '0/0'; };
    const ju = (await call('POST', '/api/v1/stock-adjustments', { doc_type_id: await typeOf('JU'), doc_date: '2026-11-01', lines: [{ item_id: a, warehouse_id: w1, qty: 10, unit_cost: 10 }, { item_id: b, warehouse_id: w1, qty: 10, unit_cost: 20 }] })).body;
    // ขายชุด 2 ชุด ราคา 40 (ทุน 2 × (10 + 2×20) = 100) → ตัด A 2 B 4 + เตือนขายต่ำกว่าทุน
    const iv = (await call('POST', '/api/v1/sales-invoices', { doc_type_id: (await call('GET', '/api/v1/trade-defaults/IV')).body.types.find((t: { code: string }) => t.code === 'IV').id, doc_date: '2026-11-02', party_id: cus, price_type: '2', vat_rate: 7,
      warehouse_id: w1, lines: [{ item_id: kit, qty: 2, unit_price: 40 }] })).body;
    expect(iv.error?.message ?? iv.warnings).toEqual([expect.stringMatching(/80-TEST-000049 ขายต่ำกว่าทุน .*100\.00/)]);
    expect([await bal(a), await bal(b), await bal(kit)]).toEqual(['8/80.00', '6/120.00', '0/0']);
    expect((await call('GET', `/api/v1/sales-invoices/${iv.id}`)).body.lines).toHaveLength(1);           // บรรทัดส่วนประกอบไม่แสดงในเอกสาร
    const roles = (await call('GET', `/api/v1/docs/${iv.id}/journal`)).body.journals[0].lines.map((l: { posting_role: string; debit: string; credit: string }) => `${l.posting_role}:${Number(l.debit) || -Number(l.credit)}`);
    expect(roles).toEqual(expect.arrayContaining(['COGS:100', 'INVENTORY:-100']));
    // ซื้อชุด 1 ชุด 60 → เฉลี่ยตามราคาทุนมาตรฐาน A 12 / B 48
    const rr = (await call('POST', '/api/v1/purchase-invoices', { doc_type_id: await typeOf('RR'), doc_date: '2026-11-03', party_id: sup, price_type: '2', vat_rate: 7, warehouse_id: w1, lines: [{ item_id: kit, qty: 1, unit_price: 60 }] })).body;
    expect([await bal(a), await bal(b)]).toEqual(['9/92.00', '8/168.00']);
    // ขายสินค้าธรรมดาเกินทุนไม่เตือน
    const iv2 = (await call('POST', '/api/v1/sales-invoices', { doc_type_id: (await call('GET', '/api/v1/trade-defaults/IV')).body.types.find((t: { code: string }) => t.code === 'IV').id, doc_date: '2026-11-04', party_id: cus, price_type: '2', vat_rate: 7,
      lines: [{ item_id: a, warehouse_id: w1, qty: 1, unit_price: 50 }] })).body;
    expect(iv2.warnings).toEqual([]);
    for (const [path, id] of [['sales-invoices', iv2.id], ['purchase-invoices', rr.id], ['sales-invoices', iv.id], ['stock-adjustments', ju.id]])
      expect((await call('POST', `/api/v1/${path}/${id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
    expect([await bal(a), await bal(b)]).toEqual(['0/0', '0/0']);
  });
  it('pass paid cheques immediately (fn.auto_pass_cheque_paid): paying by cheque passes it on the cheque date, cancel reverses the pass', async () => {
    const typeOf = async (cls: string) => (await call('GET', `/api/v1/trade-defaults/${cls}`)).body.types[0].id as string;
    const t1 = (await call('GET', '/api/v1/bank-accounts')).body.find((b: { code: string }) => b.code === 'T1').id;
    const leaf = ((await call('GET', '/api/v1/gl/accounts')).body as Array<{ id: string; is_control: boolean }>).filter((x) => !x.is_control);
    const cur = (await call('GET', '/api/v1/payment-methods/P')).body as Array<Record<string, unknown>>;
    const keep = cur.map((r) => ({ seq: r.seq, code: r.code, name_th: r.name_th, kind: r.kind, creates_cheque: r.creates_cheque, gl_account_id: r.gl_account_id, bank_account_id: r.bank_account_id }));
    const pm = await call('PUT', '/api/v1/payment-methods/P', { rows: [...keep, { seq: '09', code: 'QX', name_th: 'เช็คจ่าย T1', kind: 'CHEQUE', creates_cheque: true, gl_account_id: leaf[3]!.id, bank_account_id: t1 }] });
    expect(pm.body.error?.message ?? pm.status).toBe(200);
    const qx = ((await call('GET', '/api/v1/payment-methods/P')).body as Array<{ id: string; code: string }>).find((m) => m.code === 'QX')!.id;
    const exp = (await call('GET', '/api/v1/other-expenses?q=95-5300-01')).body.rows[0].id;
    const book = async () => (await call('GET', `/api/v1/bank-book?bank_account_id=${t1}&from=2026-11-01&to=2026-11-30`)).body.closing as string;
    const oe = (cheque: string) => ({ doc_type_id: '', doc_date: '2026-11-10', party_name: 'ร้านทดสอบ', price_type: '0', vat_rate: 0, lines: [{ item_id: exp, amount: 300 }],
      payments: [{ payment_method_id: qx, amount: 300, reference_no: cheque, cheque_date: '2026-11-12' }] });
    const post = async (no: string) => (await call('POST', '/api/v1/other-expense-docs', { ...oe(no), doc_type_id: await typeOf('OE') })).body;
    // ปิดค่า: เช็คจ่ายสถานะ 05 ยังไม่ตัดบัญชีเงินฝาก
    await call('PUT', '/api/v1/settings', { values: { 'fn.auto_pass_cheque_paid': false } });
    const o1 = await post('QX-AUTO-1');
    const chq = async (no: string) => (await call('GET', `/api/v1/cheques?direction=P&q=${no}`)).body.rows[0];
    expect((await chq('QX-AUTO-1')).status).toBe('05');
    expect(await book()).toBe('0.00');
    // เปิดค่า: ผ่านทันทีตามวันที่เช็ค
    await call('PUT', '/api/v1/settings', { values: { 'fn.auto_pass_cheque_paid': true } });
    const o2 = await post('QX-AUTO-2');
    expect(o2.error).toBeUndefined();
    expect(await chq('QX-AUTO-2')).toMatchObject({ status: '10', pass_date: expect.stringContaining('2026-11-1') });
    expect(await book()).toBe('-300.00');
    // ยกเลิกเอกสาร → ยกเลิกการผ่านให้เอง
    expect((await call('POST', `/api/v1/other-expense-docs/${o2.id}/cancel`, { reason: 'ทดสอบ' })).status).toBe(200);
    expect(await book()).toBe('0.00');
    await call('PUT', '/api/v1/settings', { values: { 'fn.auto_pass_cheque_paid': false } });
    expect((await call('POST', `/api/v1/other-expense-docs/${o1.id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
  });

  it('discounted cheque slip SQR: passes immediately on the discount date, fee to interest expense, unpass/cancel', async () => {
    const t1 = (await call('GET', '/api/v1/bank-accounts')).body.find((b: { code: string }) => b.code === 'T1').id;
    const cus = (await call('GET', '/api/v1/customers?q=C200')).body.rows[0].id;
    const ids = [];
    for (const [no, amt] of [['SQ-T-1', 1000], ['SQ-T-2', 2000]] as const) ids.push((await call('POST', '/api/v1/cheques', { direction: 'R', cheque_no: no, cheque_date: '2026-12-31', customer_id: cus, amount: amt })).body.id as string);
    const book = async () => (await call('GET', `/api/v1/bank-book?bank_account_id=${t1}&from=2026-11-01&to=2026-11-30`)).body.closing as string;
    const sq = (await call('POST', '/api/v1/cheque-deposits', { cheque_ids: ids, bank_account_id: t1, doc_date: '2026-11-15', charge: 50, vat: 3.5, discount: true, ref_no: 'TAX-001', ref_date: '2026-11-15' })).body;
    expect(sq).toMatchObject({ net_amount: '2946.50', voucher_no: expect.any(String) });
    expect(await book()).toBe('2946.50');
    const det = (await call('GET', `/api/v1/cheque-deposits/${sq.id}`)).body;
    expect(det).toMatchObject({ discount: true, ref_no: 'TAX-001', passed: true, cheques: [{ status: '10' }, { status: '10' }] });
    const j = (await call('GET', `/api/v1/docs/${sq.id}/journal`)).body.journals[0];
    const intExp = (await sql<{ no: string }>`SELECT g.account_no AS no FROM gl_default_account x JOIN gl_account g ON g.id = x.account_id WHERE x.company_id = ${companyId} AND x.role = 'INTEREST_EXPENSE' AND x.deleted_at IS NULL`.execute(database.db)).rows[0]?.no;
    if (intExp) expect(j.lines.find((l: { account_no: string }) => l.account_no === intExp)?.debit).toBe('50.00');
    expect((await call('GET', '/api/v1/cheque-deposits?q=' + sq.doc_no)).body.rows[0].discount).toBe(true);
    expect((await call('POST', `/api/v1/cheque-deposits/${sq.id}/unpass`, { reason: 'ทดสอบ' })).status).toBe(200);
    expect(await book()).toBe('0.00');
    expect((await call('POST', `/api/v1/cheque-deposits/${sq.id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
    for (const id of ids) expect((await call('DELETE', `/api/v1/cheques/${id}`)).status).toBe(200);
  });
  it('cheque larger than the debt leaves a remaining balance that a later receipt can use (S-BK-04)', async () => {
    const typeOf = async (cls: string) => (await call('GET', `/api/v1/trade-defaults/${cls}`)).body.types[0].id as string;
    const ivType = (await call('GET', '/api/v1/trade-defaults/IV')).body.types.find((t: { code: string }) => t.code === 'IV').id;
    const cus = (await call('GET', '/api/v1/customers?q=C200')).body.rows[0].id;
    const svc = (await sql<{ id: string }>`SELECT id FROM md_item WHERE company_id = ${companyId} AND code = 'SV-TEST-44'`.execute(database.db)).rows[0]!.id;
    const iv = async (price: number) => (await call('POST', '/api/v1/sales-invoices', { doc_type_id: ivType, doc_date: '2026-12-01', party_id: cus, price_type: '0', vat_rate: 0, lines: [{ item_id: svc, qty: 1, unit_price: price }] })).body;
    const iv1 = await iv(900), iv2 = await iv(400);
    const chq = (await call('GET', '/api/v1/payment-methods/R')).body.find((m: { creates_cheque: boolean }) => m.creates_cheque);
    const remaining = async () => (await call('GET', `/api/v1/cheques?direction=R&q=QR-REM-1`)).body.rows[0].remaining_amount as string;
    expect((await call('POST', '/api/v1/ar-receipts', { doc_type_id: await typeOf('RE'), doc_date: '2026-12-05', party_id: cus, settlements: [{ invoice_header_id: iv1.id, amount: 900 }],
      payments: [{ payment_method_id: chq.id, amount: 900, cheque_amount: 800, reference_no: 'QR-REM-X', cheque_date: '2026-12-05' }] })).body.error.message).toMatch(/ไม่น้อยกว่ายอดที่ใช้ชำระ/);
    // เช็ค 1,000 ชำระบิล 900 → เหลือในเช็ค 100
    const r1 = (await call('POST', '/api/v1/ar-receipts', { doc_type_id: await typeOf('RE'), doc_date: '2026-12-05', party_id: cus, settlements: [{ invoice_header_id: iv1.id, amount: 900 }],
      payments: [{ payment_method_id: chq.id, amount: 900, cheque_amount: 1000, reference_no: 'QR-REM-1', cheque_date: '2026-12-05' }] })).body;
    expect(r1.error).toBeUndefined();
    expect(await remaining()).toBe('100.00');
    const c = (await call('GET', '/api/v1/cheques?direction=R&q=QR-REM-1')).body.rows[0];
    expect(c.amount).toBe('1000.00');
    expect((await call('GET', `/api/v1/cheques?direction=R&remaining=Y&party_id=${cus}`)).body.rows.map((x: { id: string }) => x.id)).toContain(c.id);
    // ใบเสร็จถัดไป: ใช้ยอดคงเหลือ 100 + เงินสด 300 (ใช้เกินยอดไม่ได้)
    const re2 = { doc_type_id: await typeOf('RE'), doc_date: '2026-12-06', party_id: cus, settlements: [{ invoice_header_id: iv2.id, amount: 400 }], payments: [{ payment_method_id: chq.id, amount: 100, cheque_id: c.id }] };
    expect((await call('POST', '/api/v1/ar-receipts', { ...re2, payments: [{ payment_method_id: chq.id, amount: 150, cheque_id: c.id }] })).body.error.message).toMatch(/เหลือยอดใช้ได้ 100\.00/);
    const r2 = (await call('POST', '/api/v1/ar-receipts', re2)).body;
    expect(r2.error).toBeUndefined();
    expect(await remaining()).toBe('0.00');
    expect((await call('GET', `/api/v1/cheques/${c.id}`)).body.docs.map((x: { doc_no: string }) => x.doc_no).sort()).toEqual([r1.doc_no, r2.doc_no].sort());
    const det = (await call('GET', `/api/v1/ar-receipts/${r2.id}`)).body;
    expect(det.payments[0]).toMatchObject({ cheque_id: c.id, own_cheque: false });
    // ยกเลิกใบเสร็จแรกไม่ได้ขณะยอดคงเหลือถูกใช้อยู่ · ยกเลิกใบที่สอง → ยอดคงเหลือกลับมา
    expect((await call('POST', `/api/v1/ar-receipts/${r1.id}/cancel`, { reason: 'x' })).body.error.message).toMatch(/ถูกใช้ใน/);
    expect((await call('POST', `/api/v1/ar-receipts/${r2.id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
    expect(await remaining()).toBe('100.00');
    expect((await call('POST', `/api/v1/ar-receipts/${r1.id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
    for (const x of [iv1, iv2]) expect((await call('POST', `/api/v1/sales-invoices/${x.id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
  });
  it('back-dated documents re-cost later issues automatically (average), journals follow, cancel restores', async () => {
    const typeOf = async (cls: string) => (await call('GET', `/api/v1/trade-defaults/${cls}`)).body.types[0].id as string;
    const ivType = (await call('GET', '/api/v1/trade-defaults/IV')).body.types.find((t: { code: string }) => t.code === 'IV').id;
    const unit = (await call('GET', '/api/v1/lookups?types=UNIT')).body.UNIT[0].id;
    const [w1] = (await call('GET', '/api/v1/lookups?types=WH')).body.WH.map((w: { id: string }) => w.id);
    const cus = (await call('GET', '/api/v1/customers?q=C200')).body.rows[0].id;
    const sup = (await call('GET', '/api/v1/suppliers?q=S200')).body.rows[0].id;
    const it = (await call('POST', '/api/v1/items', { code: '02-TEST-000051', name_th: 'สินค้าคิดทุนย้อนหลัง', base_unit_id: unit, std_cost: '1' })).body.id;
    const rr = (date: string, price: number) => call('POST', '/api/v1/purchase-invoices', { doc_type_id: '', doc_date: date, party_id: sup, price_type: '0', vat_rate: 0, warehouse_id: w1, lines: [{ item_id: it, qty: 10, unit_price: price }] });
    const r1 = (await call('POST', '/api/v1/purchase-invoices', { doc_type_id: await typeOf('RR'), doc_date: '2026-03-01', party_id: sup, price_type: '0', vat_rate: 0, warehouse_id: w1, lines: [{ item_id: it, qty: 10, unit_price: 100 }] })).body;
    void rr;
    const iv = (await call('POST', '/api/v1/sales-invoices', { doc_type_id: ivType, doc_date: '2026-03-10', party_id: cus, price_type: '0', vat_rate: 0, warehouse_id: w1, lines: [{ item_id: it, qty: 5, unit_price: 300 }] })).body;
    const ou = (await call('POST', '/api/v1/stock-issues', { doc_type_id: await typeOf('OU'), doc_date: '2026-03-12', lines: [{ item_id: it, warehouse_id: w1, qty: 2 }] })).body;
    const cost = async () => (await call('GET', `/api/v1/stock/card?item_id=${it}&from=2026-03-01&to=2026-03-31`)).body.lines.map((l: { doc_no: string; value: string }) => l.value);
    const cogs = async () => (await call('GET', `/api/v1/docs/${iv.id}/journal`)).body.journals[0].lines.filter((l: { posting_role: string }) => l.posting_role === 'COGS').map((l: { debit: string }) => l.debit);
    expect(await cost()).toEqual(['1000.00', '-500.00', '-200.00']);
    expect(await cogs()).toEqual(['500.00']);
    // ซื้อย้อนหลัง 5/3 10 @200 → ถัวเฉลี่ย ณ 10/3 = 150 · เบิก 12/3 = (3000 − 750) / 15 = 150
    const r2 = (await call('POST', '/api/v1/purchase-invoices', { doc_type_id: await typeOf('RR'), doc_date: '2026-03-05', party_id: sup, price_type: '0', vat_rate: 0, warehouse_id: w1, lines: [{ item_id: it, qty: 10, unit_price: 200 }] })).body;
    expect(await cost()).toEqual(['1000.00', '2000.00', '-750.00', '-300.00']);
    expect(await cogs()).toEqual(['750.00']);
    expect((await call('GET', `/api/v1/stock-issues/${ou.id}`)).body.net_amount).toBe('300.00');
    // ยกเลิกใบซื้อย้อนหลัง → กลับเป็นต้นทุนเดิม
    expect((await call('POST', `/api/v1/purchase-invoices/${r2.id}/cancel`, { reason: 'ทดสอบ' })).status).toBe(200);
    expect(await cost()).toEqual(['1000.00', '-500.00', '-200.00']);
    expect(await cogs()).toEqual(['500.00']);
    for (const [path, id] of [['stock-issues', ou.id], ['sales-invoices', iv.id], ['purchase-invoices', r1.id]])
      expect((await call('POST', `/api/v1/${path}/${id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
  });
  it('report center (T5.1): document registers by no/party/due, totals, cancelled option, isolation', async () => {
    const ivType = (await call('GET', '/api/v1/trade-defaults/IV')).body.types.find((t: { code: string }) => t.code === 'IV').id;
    const cus = (await call('GET', '/api/v1/customers?q=C200')).body.rows[0].id;
    const svc = (await sql<{ id: string }>`SELECT id FROM md_item WHERE company_id = ${companyId} AND code = 'SV-TEST-44'`.execute(database.db)).rows[0]!.id;
    const mk = async (date: string, price: number) => (await call('POST', '/api/v1/sales-invoices', { doc_type_id: ivType, doc_date: date, party_id: cus, price_type: '2', vat_rate: 7, credit_days: 30, lines: [{ item_id: svc, qty: 1, unit_price: price }] })).body;
    const a1 = await mk('2027-01-05', 1000), a2 = await mk('2027-01-06', 2000), a3 = await mk('2027-01-07', 500);
    expect((await call('POST', `/api/v1/sales-invoices/${a3.id}/cancel`, { reason: 'ทดสอบรายงาน' })).status).toBe(200);
    const run = async (code: string, params: Record<string, unknown>) => (await call('POST', `/api/v1/rpt/${code}/run`, { params })).body;
    expect((await call('GET', '/api/v1/rpt/available')).body.codes).toEqual(expect.arrayContaining(['1.4.1', '1.4.3', '1.4.7', '2.4.1', '1.9.1']));
    // 141 เรียงตามเลขที่: 2 ใบ (ใบยกเลิกไม่นับ) · รวม 3,210 · รายละเอียดบรรทัดสินค้า
    const r = await run('1.4.1', { date_from: '2027-01-01', date_to: '2027-01-31', detail: true });
    expect(r).toMatchObject({ code: '1.4.1', title: expect.stringContaining('ขายเงินเชื่อ'), landscape: true });
    const docs = r.rows.filter((x: { t?: string }) => !x.t).map((x: { c: { no: string } }) => x.c.no);
    expect(docs).toEqual([a1.doc_no, a2.doc_no]);
    expect(r.rows.at(-1)).toMatchObject({ t: 'total', c: { amount: '3000.00', vat: '210.00', net: '3210.00' } });
    expect(r.rows.filter((x: { t?: string }) => x.t === 'detail')).toHaveLength(2);
    expect(r.rows.find((x: { c: { no: string } }) => x.c.no === a1.doc_no).link).toBe(`/sa/invoices/${a1.id}`);
    // รวมเอกสารยกเลิก: แสดงแต่ไม่รวมยอด · ช่วงเลขที่
    const rc = await run('1.4.1', { date_from: '2027-01-01', date_to: '2027-01-31', cancelled: true });
    expect(rc.rows.filter((x: { muted?: boolean }) => x.muted).map((x: { c: { no: string } }) => x.c.no)).toEqual([a3.doc_no]);
    expect(rc.rows.at(-1).c.net).toBe('3210.00');
    expect((await run('1.4.1', { date_from: '2027-01-01', date_to: '2027-01-31', doc_no_from: a2.doc_no, doc_no_to: a2.doc_no })).rows.at(-1).c.net).toBe('2140.00');
    // 143 แยกตามลูกค้า: หัวกลุ่ม + รวมกลุ่ม
    const g = await run('1.4.3', { date_from: '2027-01-01', date_to: '2027-01-31' });
    expect(g.rows.map((x: { t?: string }) => x.t ?? 'row')).toEqual(['group', 'row', 'row', 'sub', 'total']);
    // 147 ถึงกำหนดเก็บเงิน: ตามวันครบกำหนด + ยอดค้าง
    const due = await run('1.4.7', { date_from: '2027-02-01', date_to: '2027-02-28' });
    expect(due.rows.at(-1).c.out).toBe('3210.00');
    expect((await run('1.4.7', { date_from: '2027-01-01', date_to: '2027-01-31' })).rows.filter((x: { t?: string }) => !x.t)).toHaveLength(0);
    // ขอบเขตผิด · รายงานที่ไม่มี
    expect((await call('POST', '/api/v1/rpt/1.4.1/run', { params: { date_from: '2027-13-01' } })).body.error.message).toMatch(/วันที่/);
    expect((await call('POST', '/api/v1/rpt/9.9.9/run', { params: {} })).status).toBe(404);
    // ข้ามบริษัทไม่ได้
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await run('1.4.1', { date_from: '2027-01-01', date_to: '2027-01-31' })).rows.filter((x: { t?: string }) => !x.t)).toHaveLength(0);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    for (const x of [a1, a2]) expect((await call('POST', `/api/v1/sales-invoices/${x.id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
  });
  it('AR/AP party reports (T5.2/T5.3): outstanding as of a date, aging, status, movement, credit limit, isolation', async () => {
    const typeOf = async (cls: string) => (await call('GET', `/api/v1/trade-defaults/${cls}`)).body.types[0].id as string;
    const ivType = (await call('GET', '/api/v1/trade-defaults/IV')).body.types.find((t: { code: string }) => t.code === 'IV').id;
    const cus = (await call('POST', '/api/v1/customers', { code: 'C520', name: 'ลูกค้ารายงาน', tax_id: tid(4), credit_days: 30, credit_limit: '1000' })).body.id;
    const svc = (await sql<{ id: string }>`SELECT id FROM md_item WHERE company_id = ${companyId} AND code = 'SV-TEST-44'`.execute(database.db)).rows[0]!.id;
    const iv = async (date: string, price: number) => (await call('POST', '/api/v1/sales-invoices', { doc_type_id: ivType, doc_date: date, party_id: cus, price_type: '0', vat_rate: 0, lines: [{ item_id: svc, qty: 1, unit_price: price }] })).body;
    const i1 = await iv('2027-02-01', 1000), i2 = await iv('2027-03-10', 500);
    const re = (await call('POST', '/api/v1/ar-receipts', { doc_type_id: await typeOf('RE'), doc_date: '2027-03-15', party_id: cus, settlements: [{ invoice_header_id: i1.id, amount: 600 }] })).body;
    const run = async (code: string, params: Record<string, unknown>) => (await call('POST', `/api/v1/rpt/${code}/run`, { params: { customer_from: 'C520', customer_to: 'C520', ...params } })).body;
    const out = async (asOf: string) => (await run('1.A.1', { as_of: asOf })).rows.at(-1).c.out;
    // ณ 28/2: 1,000 · ณ 31/3: 1,000 − 600 + 500 = 900 (รับชำระก่อนวันนั้นเท่านั้น)
    expect([await out('2027-02-28'), await out('2027-03-14'), await out('2027-03-31')]).toEqual(['1000.00', '1500.00', '900.00']);
    const det = await run('1.A.2', { as_of: '2027-03-31' });
    expect(det.rows.filter((r: { t?: string }) => !r.t).map((r: { c: { no: string; out: string } }) => `${r.c.no}:${r.c.out}`)).toEqual([`${i1.doc_no}:400.00`, `${i2.doc_no}:500.00`]);
    // อายุหนี้ ณ 30/4: i1 ครบ 3/3 → 58 วัน (31–60) · i2 ครบ 9/4 → 21 วัน (1–30)
    const ag = (await run('1.C.1', { as_of: '2027-04-30' })).rows.at(-1).c;
    expect([ag.b1, ag.b2, ag.out]).toEqual(['500.00', '400.00', '900.00']);
    // เกินวงเงิน 1,000: ณ 14/3 ค้าง 1,500 → เกิน 500
    expect((await run('1.E', { as_of: '2027-03-14' })).rows[0].c).toMatchObject({ code: 'C520', over: '500.00' });
    // สถานะ มี.ค.: ยกมา 1,000 ขาย 500 รับ 600 คงเหลือ 900 · เคลื่อนไหวตรงกัน
    expect((await run('1.B', { period: '2027-03' })).rows.at(-1).c).toMatchObject({ open: '1000.00', sales: '500.00', paid: '600.00', close: '900.00' });
    expect((await run('1.D', { date_from: '2027-03-01', date_to: '2027-03-31' })).rows.at(-1).c).toMatchObject({ debit: '500.00', credit: '600.00', bal: '900.00' });
    expect((await call('POST', '/api/v1/rpt/1.B/run', { params: { period: '2027-13' } })).body.error.message).toMatch(/งวด/);
    // ข้ามบริษัทไม่ได้
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await run('1.A.1', { as_of: '2027-03-31' })).rows.at(-1).c.out).toBe('0.00');
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    expect((await call('POST', `/api/v1/ar-receipts/${re.id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
    for (const x of [i1, i2]) expect((await call('POST', `/api/v1/sales-invoices/${x.id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
  });
  it('cheque + inventory reports (T5.4): balances as of, movement card, cheques in hand, isolation', async () => {
    const typeOf = async (cls: string) => (await call('GET', `/api/v1/trade-defaults/${cls}`)).body.types[0].id as string;
    const unit = (await call('GET', '/api/v1/lookups?types=UNIT')).body.UNIT[0].id;
    const [w1] = (await call('GET', '/api/v1/lookups?types=WH')).body.WH.map((w: { id: string }) => w.id);
    const cus = (await call('GET', '/api/v1/customers?q=C520')).body.rows[0].id;
    const code = '02-TEST-000054';
    const it = (await call('POST', '/api/v1/items', { code, name_th: 'สินค้ารายงาน', base_unit_id: unit, std_cost: '1' })).body.id;
    const ju = (await call('POST', '/api/v1/stock-adjustments', { doc_type_id: await typeOf('JU'), doc_date: '2027-04-01', lines: [{ item_id: it, warehouse_id: w1, qty: 10, unit_cost: 5 }] })).body;
    const ou = (await call('POST', '/api/v1/stock-issues', { doc_type_id: await typeOf('OU'), doc_date: '2027-04-10', lines: [{ item_id: it, warehouse_id: w1, qty: 4 }] })).body;
    const chq = (await call('POST', '/api/v1/cheques', { direction: 'R', cheque_no: 'QR-RPT-54', cheque_date: '2027-04-05', customer_id: cus, amount: 777 })).body.id;
    const run = async (c: string, params: Record<string, unknown>) => (await call('POST', `/api/v1/rpt/${c}/run`, { params: { item_from: code, item_to: code, ...params } })).body;
    expect((await run('4.2.7', { as_of: '2027-04-05' })).rows[0].c).toMatchObject({ code, qty: '10.0000', value: '50.00' });
    expect((await run('4.2.1', { as_of: '2027-04-30' })).rows.at(-1).c).toMatchObject({ qty: '6', value: '30.00' });
    const card = await run('4.1.1', { date_from: '2027-04-05', date_to: '2027-04-30' });
    expect(card.rows.map((r: { t?: string; c: { bal?: string } }) => `${r.t ?? 'row'}:${r.c.bal ?? ''}`)).toEqual(['group:', 'row:10', 'row:6', 'sub:6', 'total:']);
    expect((await run('4.4', { date_from: '2027-04-01', date_to: '2027-04-30', detail: true })).rows.filter((r: { t?: string }) => !r.t).map((r: { c: { no: string } }) => r.c.no)).toEqual(expect.arrayContaining([ju.doc_no, ou.doc_no]));
    const inHand = await run('3.1', { as_of: '2027-04-30', customer_from: 'C520', customer_to: 'C520' });
    expect(inHand.rows.at(-1).c).toMatchObject({ amount: '777.00' });
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await run('4.2.1', { as_of: '2027-04-30' })).rows).toHaveLength(1);
    expect((await run('3.1', { as_of: '2027-04-30' })).rows.at(-1).c.amount).toBe('0.00');
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    expect((await call('DELETE', `/api/v1/cheques/${chq}`)).status).toBe(200);
    for (const [path, id] of [['stock-issues', ou.id], ['stock-adjustments', ju.id]]) expect((await call('POST', `/api/v1/${path}/${id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
  });
  it('GL reports (T5.5): chart, movement summary = trial balance, worksheet balances, data checks, isolation', async () => {
    const run = async (c: string, params: Record<string, unknown>) => (await call('POST', `/api/v1/rpt/${c}/run`, { params })).body;
    const tb = (await call('GET', '/api/v1/reports/trial-balance?from=2026-01-01&to=2026-12-31')).body;
    const mv = await run('5.3', { date_from: '2026-01-01', date_to: '2026-12-31' });
    expect(mv.rows.at(-1).c.debit).toBe(tb.totals.debit);
    const ws = await run('5.8', { date_to: '2026-12-31' });
    const tot = ws.rows.at(-1).c;
    expect([tot.pld === tot.plc, tot.bsd === tot.bsc]).toEqual([true, true]);
    expect(ws.rows.find((r: { t?: string; c: { name: string } }) => r.t === 'sub' && r.c.name === 'รวม').c.tbd).toBe(tb.totals.closing_debit);
    expect((await run('5.1', {})).rows.length).toBeGreaterThan(5);
    expect((await run('5.A.2', { date_from: '2026-01-01', date_to: '2026-12-31' })).rows.at(-1).c.desc).toBe('ทุกใบสำคัญดุล');
    expect((await run('5.A.3', {})).rows.length).toBeGreaterThan(1);
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await run('5.3', { date_from: '2026-01-01', date_to: '2026-12-31' })).rows.at(-1).c.debit).not.toBe(tb.totals.debit);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
  });
  it('sales/purchase analysis (T5.6): history by customer/item, summary with cost and gross profit, returns negative', async () => {
    const typeOf = async (cls: string) => (await call('GET', `/api/v1/trade-defaults/${cls}`)).body.types[0].id as string;
    const ivType = (await call('GET', '/api/v1/trade-defaults/IV')).body.types.find((t: { code: string }) => t.code === 'IV').id;
    const unit = (await call('GET', '/api/v1/lookups?types=UNIT')).body.UNIT[0].id;
    const [w1] = (await call('GET', '/api/v1/lookups?types=WH')).body.WH.map((w: { id: string }) => w.id);
    const cus = (await call('GET', '/api/v1/customers?q=C520')).body.rows[0].id;
    const sup = (await call('GET', '/api/v1/suppliers?q=S200')).body.rows[0].id;
    const code = '02-TEST-000056';
    const it = (await call('POST', '/api/v1/items', { code, name_th: 'สินค้าวิเคราะห์', base_unit_id: unit, std_cost: '1' })).body.id;
    const rr = (await call('POST', '/api/v1/purchase-invoices', { doc_type_id: await typeOf('RR'), doc_date: '2027-05-01', party_id: sup, price_type: '0', vat_rate: 0, warehouse_id: w1, lines: [{ item_id: it, qty: 10, unit_price: 40 }] })).body;
    const iv = (await call('POST', '/api/v1/sales-invoices', { doc_type_id: ivType, doc_date: '2027-05-02', party_id: cus, price_type: '2', vat_rate: 7, warehouse_id: w1, lines: [{ item_id: it, qty: 4, unit_price: 100 }] })).body;
    const cn = (await call('POST', '/api/v1/ar-credit-notes', { doc_type_id: await typeOf('CN'), doc_date: '2027-05-03', party_id: cus, ref_header_id: iv.id, price_type: '2', vat_rate: 7, lines: [{ item_id: it, qty: 1, unit_price: 100, return_to_stock: true }] })).body;
    const run = async (c: string, params: Record<string, unknown>) => (await call('POST', `/api/v1/rpt/${c}/run`, { params: { date_from: '2027-05-01', date_to: '2027-05-31', item_from: code, item_to: code, ...params } })).body;
    // ขาย 400 − คืน 100 = 300 · ต้นทุน 4×40 − 1×40 = 120 · กำไร 180 (60%)
    expect((await run('7.6', { by: 'item' })).rows[0].c).toMatchObject({ code, qty: '3', net: '300.00', cost: '120.00', gp: '180.00', pct: '60.00' });
    const h = await run('7.1.1', {});
    expect(h.rows.filter((r: { t?: string }) => !r.t).map((r: { c: { net: string } }) => r.c.net)).toEqual(['400.00', '-100.00']);
    expect((await run('8.2', { by: 'supplier' })).rows.at(-1).c.net).toBe('400.00');
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await run('7.6', {})).rows.at(-1).c.net).toBe('0.00');
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    for (const [path, id] of [['ar-credit-notes', cn.id], ['sales-invoices', iv.id], ['purchase-invoices', rr.id]]) expect((await call('POST', `/api/v1/${path}/${id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
  });
  it('tax reports (T5.7): VAT report variants, PP30 with carry forward, PND attachments, e-filing file, isolation', async () => {
    const vat = async (kind: 'P' | 'S', no: string, month: string, base: number, v: number, extra: object = {}) => (await call('POST', `/api/v1/vat/${kind}`, { tax_invoice_no: no, tax_invoice_date: `${month}-10`, month, party_name: 'คู่ค้าภาษี', party_tax_id: '0105537095903', base_amount: base, vat_amount: v, ...extra })).body.id as string;
    const ids = [await vat('S', 'TX-S1', '2027-06', 1000, 70), await vat('P', 'TX-P1', '2027-06', 3000, 210), await vat('P', 'TX-P2', '2027-06', 500, 0, { nonclaim_base: 500, nonclaim_vat: 35 }),
      await vat('S', 'TX-S2', '2027-07', 5000, 350), await vat('S', 'TX-Z', '2027-07', 0, 0, { zero_rate_amount: 800 })];
    const run = async (c: string, params: Record<string, unknown>) => (await call('POST', `/api/v1/rpt/${c}/run`, { params })).body;
    // 6.2 แยกขอคืนได้/ไม่ได้
    const p = await run('6.2', { period: '2027-06', variant: 'claim' });
    expect(p.rows.filter((r: { t?: string }) => r.t === 'sub').map((r: { c: { vat: string; nvat: string } }) => `${r.c.vat}/${r.c.nvat}`)).toEqual(['210.00/0.00', '0.00/35.00']);
    expect((await run('6.3', { period: '2027-07', variant: 'zero' })).rows.at(-1).c.zero).toBe('800.00');
    expect((await run('6.2', { period: '2027-06', variant: 'nil' })).rows.some((r: { t?: string }) => r.t === 'note')).toBe(true);
    // ภ.พ.30 มิ.ย.: ขาย 70 − ซื้อ 210 → ชำระเกิน 140 · ก.ค.: 350 − 0 − ยกมา 140 = ต้องชำระ 210
    const pp = async (m: string) => Object.fromEntries((await run('6.4', { period: m })).rows.filter((r: { c: { no?: string } }) => r.c.no).map((r: { c: { no: string; amount: string } }) => [r.c.no, r.c.amount]));
    const jun = await pp('2027-06');
    expect([jun['5'], jun['7'], jun['9'], jun['12']]).toEqual(['70.00', '210.00', '140.00', '140.00']);
    const jul = await pp('2027-07');
    expect([jul['1'], jul['2'], jul['4'], jul['10'], jul['11']]).toEqual(['5800.00', '800.00', '5000.00', '140.00', '210.00']);
    // ภ.ง.ด.53 ใบแนบ + ไฟล์ยื่น
    const w = (await call('POST', '/api/v1/wht', { form_type: 'S53', certificate_no: 'W53-1', certificate_date: '2027-06-20', payee_name: 'บริษัท ผู้รับเงิน จำกัด', payee_tax_id: '0105537095903', income_type: 'ค่าบริการ', paid_amount: 2000, rate: 3, tax_amount: 60 })).body.id;
    const att = await run('6.6', { period: '2027-06' });
    expect(att.rows.find((r: { t?: string }) => r.t === 'total').c).toMatchObject({ paid: '2000.00', wht: '60.00' });
    const f = await call('GET', '/api/v1/wht/efile?form=S53&month=2027-06');
    expect(f.status).toBe(200);
    expect(String(f.body)).toMatch(/^1\|0105537095903\|00000\|บริษัท\|ผู้รับเงิน จำกัด\|\|20062570\|ค่าบริการ\|3\.00\|2000\.00\|60\.00\|1/);
    expect((await call('GET', '/api/v1/wht/efile?form=S03&month=2027-06')).body.error.message).toMatch(/ไม่มีรายการ/);
    // ข้ามบริษัทไม่ได้
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await run('6.1', { period: '2027-06' })).rows.at(-1).c.vat).toBe('0.00');
    expect((await call('GET', '/api/v1/wht/efile?form=S53&month=2027-06')).body.error.message).toMatch(/ไม่มีรายการ/);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    expect((await call('POST', `/api/v1/wht/${w}/cancel`, {})).status).toBe(200);
    for (const id of ids) await sql`UPDATE tax_vat_entry SET doc_status = 'C' WHERE id = ${id}`.execute(database.db);
  });

  it('document printing & approval (T5.8): print data, forms 1–9, approve/reprint rules, range approval, record info, custom reports, isolation', async () => {
    const admin = cookie;
    const as = async (u: string, p: string) => { cookie = ''; expect((await call('POST', '/api/v1/auth/login', { username: u, password: p })).status).toBe(200); };
    const ivType = (await call('GET', '/api/v1/trade-defaults/IV')).body.types.find((t: { code: string }) => t.code === 'IV').id;
    const unit = (await call('GET', '/api/v1/lookups?types=UNIT')).body.UNIT[0].id;
    const [w1] = (await call('GET', '/api/v1/lookups?types=WH')).body.WH.map((w: { id: string }) => w.id);
    const cus = (await call('GET', '/api/v1/customers?q=C520')).body.rows[0].id;
    const code = '02-TEST-000058';
    const item = (await call('POST', '/api/v1/items', { code, name_th: 'สินค้าทดสอบพิมพ์', base_unit_id: unit, std_cost: '1' })).body.id;
    const sell = async (date: string) => (await call('POST', '/api/v1/sales-invoices', { doc_type_id: ivType, doc_date: date, party_id: cus, price_type: '2', vat_rate: 7, warehouse_id: w1, lines: [{ item_id: item, qty: 2, unit_price: 150 }] })).body as { id: string; doc_no: string };
    const iv = await sell('2027-06-05');
    // ข้อมูลพิมพ์: บรรทัด ยอดรวม จำนวนเงินตัวอักษร · เมนูพิมพ์มีต้นแบบ 1–4
    const p = (await call('GET', `/api/v1/print/doc/${iv.id}`)).body;
    expect(p.data.lines[0]).toMatchObject({ code, qty: '2', price: '150.00', amount: '300.00' });
    expect(p.data.totals.at(-1)).toEqual({ label: 'จำนวนเงินรวมทั้งสิ้น', value: '321.00' });
    expect(p.data.amount_text).toBe('สามร้อยยี่สิบเอ็ดบาทถ้วน');
    expect(p.forms.map((f: { slot: number }) => f.slot)).toEqual([1, 2, 3, 4]);
    // แบบฟอร์มของบริษัท: ทับหมายเลข 1 + เพิ่มหมายเลข 7 (คอลัมน์ที่ไม่รู้จักถูกตัด)
    expect((await call('PUT', '/api/v1/print-forms/IV/1', { name: 'ใบกำกับภาษี/ใบส่งของ', base: 'plain', layout: { title: 'ใบกำกับภาษี', columns: [{ key: 'name' }, { key: 'amount', label: 'Amount' }, { key: 'bogus' }] } })).status).toBe(200);
    expect((await call('PUT', '/api/v1/print-forms/IV/7', { name: 'ใบส่งของครึ่งหน้า', base: 'half', layout: {} })).status).toBe(200);
    const p2 = (await call('GET', `/api/v1/print/doc/${iv.id}`)).body;
    expect(p2.forms.map((f: { slot: number; custom: boolean }) => `${f.slot}${f.custom ? '*' : ''}`)).toEqual(['1*', '2', '3', '4', '7*']);
    expect(p2.forms[0].layout.title).toBe('ใบกำกับภาษี');
    expect(p2.forms[0].layout.columns.filter((c: { show: boolean }) => c.show).map((c: { key: string; label: string }) => `${c.key}:${c.label}`)).toEqual(['name:รายละเอียด', 'amount:Amount']);
    // พิมพ์ออกเครื่องพิมพ์นับครั้ง
    expect((await call('POST', `/api/v1/print/doc/${iv.id}/printed`, { slot: 1 })).body.print_count).toBe(1);
    // กำหนดที่ประเภทเอกสาร: รับรองระดับ 6 · รับรองก่อนพิมพ์ · พิมพ์ซ้ำระดับ 7
    await sql`UPDATE md_doc_type SET approve_level = 6, approve_method = '2', reprint_level = 7 WHERE id = ${ivType}`.execute(database.db);
    const blocked = await call('POST', `/api/v1/print/doc/${iv.id}/printed`, {});
    expect(blocked.status).toBe(409); expect(blocked.body.error.message).toMatch(/ต้องรับรองก่อนพิมพ์/);
    await as('boss5', 'boss5pass');
    expect((await call('PUT', '/api/v1/print-forms/IV/2', { name: 'x', base: 'grid', layout: {} })).status).toBe(403);
    expect((await call('POST', '/api/v1/rpt-custom', { code: 'B5', base_code: '7.6', name: 'x' })).status).toBe(403);
    const low = await call('POST', `/api/v1/approve/doc/${iv.id}`, {});
    expect(low.status).toBe(409); expect(low.body.error.message).toMatch(/ตั้งแต่ 6/);
    cookie = admin;
    expect((await call('POST', `/api/v1/approve/doc/${iv.id}`, {})).body.approved).toBe(true);
    expect((await call('POST', `/api/v1/approve/doc/${iv.id}`, {})).body.error.message).toMatch(/รับรองแล้ว/);
    await as('boss5', 'boss5pass');
    const re = await call('POST', `/api/v1/print/doc/${iv.id}/printed`, {});
    expect(re.status).toBe(409); expect(re.body.error.message).toMatch(/พิมพ์ซ้ำต้องใช้ผู้มีระดับอนุมัติตั้งแต่ 7/);
    await as('clerk0', 'clerk0pass');
    expect((await call('POST', `/api/v1/approve/doc/${iv.id}`, { undo: true })).status).toBe(403);
    cookie = admin;
    expect((await call('POST', `/api/v1/print/doc/${iv.id}/printed`, { slot: 7 })).body.print_count).toBe(2);
    expect((await call('POST', `/api/v1/approve/doc/${iv.id}`, { undo: true })).body.approved).toBe(false);
    // รับรองเป็นช่วงเลขที่/วันที่
    const iv2 = await sell('2027-06-06');
    const rg = (await call('POST', '/api/v1/approve-range', { kind: 'doc', type_id: ivType, from_no: iv.doc_no, to_no: iv2.doc_no, from_date: '2027-06-01', to_date: '2027-06-30' })).body;
    expect([rg.approved, rg.not_approved]).toEqual([2, 0]);
    // รายละเอียดแฟ้มข้อมูล
    const info = (await call('GET', `/api/v1/record-info/doc/${iv.id}`)).body;
    expect([info.print_count, info.approved_by.startsWith('admin'), info.rule.reprintLevel, info.line_count]).toEqual([2, true, 7, 1]);
    expect(info.log.map((l: { action: string }) => l.action)).toEqual(expect.arrayContaining(['APPROVE', 'UNAPPROVE', 'PRINT', 'REPRINT']));
    // ใบสำคัญที่เกิดจากเอกสาร: พิมพ์ได้ · สมุดไม่ได้กำหนดให้รับรอง
    const jid = (await call('GET', `/api/v1/docs/${iv.id}/journal`)).body.journals[0].id;
    const pj = (await call('GET', `/api/v1/print/journal/${jid}`)).body.data;
    expect(pj.lines.length).toBeGreaterThanOrEqual(2);
    expect(pj.totals[0].value).toBe(pj.totals[0].value2);
    expect((await call('POST', `/api/v1/approve/journal/${jid}`, {})).body.error.message).toMatch(/ไม่ต้องรับรอง/);
    // รายงานที่สร้างเอง
    const cr = await call('POST', '/api/v1/rpt-custom', { code: 'u01', base_code: '7.6', name: 'กำไรขั้นต้นสินค้าทดสอบ', params: { by: 'item', item_from: code }, hidden_cols: ['pct'] });
    expect(cr.status).toBe(200);
    expect((await call('GET', '/api/v1/rpt-custom')).body.find((r: { code: string }) => r.code === 'U01')).toMatchObject({ base_code: '7.6', params: { by: 'item' }, hidden_cols: ['pct'] });
    expect((await call('POST', '/api/v1/rpt-custom', { code: 'U01', base_code: '7.6', name: 'ซ้ำ' })).body.error.message).toMatch(/มีอยู่แล้ว/);
    expect((await call('POST', '/api/v1/rpt-custom', { code: 'U02', base_code: '99.9', name: 'ไม่มีต้นฉบับ' })).body.error.message).toMatch(/ไม่พบรายงานต้นฉบับ/);
    // ข้ามบริษัทไม่ได้
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('GET', `/api/v1/print/doc/${iv.id}`)).status).toBe(404);
    expect((await call('POST', `/api/v1/approve/doc/${iv.id}`, {})).status).toBe(404);
    expect((await call('GET', `/api/v1/record-info/doc/${iv.id}`)).status).toBe(404);
    expect((await call('GET', '/api/v1/print-forms?scope=IV')).body.custom).toEqual([]);
    expect((await call('GET', '/api/v1/rpt-custom')).body).toEqual([]);
    expect((await call('DELETE', '/api/v1/print-forms/IV/7')).status).toBe(404);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    // ล้างข้อมูลทดสอบ
    await sql`UPDATE md_doc_type SET approve_level = 0, approve_method = NULL, reprint_level = NULL WHERE id = ${ivType}`.execute(database.db);
    for (const s of [1, 7]) expect((await call('DELETE', `/api/v1/print-forms/IV/${s}`)).status).toBe(200);
    expect((await call('GET', `/api/v1/print/doc/${iv.id}`)).body.forms.every((f: { custom: boolean }) => !f.custom)).toBe(true);
    expect((await call('DELETE', `/api/v1/rpt-custom/${cr.body.id}`)).status).toBe(200);
    for (const x of [iv, iv2]) expect((await call('POST', `/api/v1/sales-invoices/${x.id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
  });
  it('fixed assets (T6.1): account groups, asset register, live depreciation schedule with posted periods, recode, delete guard, isolation', async () => {
    const g = await call('POST', '/api/v1/asset-account-groups', { code: 'veh0', name_th: 'ยานพาหนะ', depr_expense_account_id: expense, accum_depr_account_id: cash });
    expect(g.status).toBe(200);
    expect((await call('POST', '/api/v1/asset-account-groups', { code: 'VEH0', name_th: 'ซ้ำ', depr_expense_account_id: expense, accum_depr_account_id: cash })).status).toBe(409);
    expect((await call('POST', '/api/v1/asset-account-groups', { code: 'NOACC', name_th: 'ไม่มีบัญชี' })).body.error.message).toMatch(/บัญชีค่าเสื่อมราคา/);
    const body = { code: 'car-01', name_th: 'รถกระบะ', account_group_id: g.body.id, purchase_date: '2026-01-01', start_date: '2026-01-01', cost: '36501', salvage_value: '1', method: '1', useful_life_years: 5 };
    expect((await call('POST', '/api/v1/fa/assets', { ...body, salvage_value: '0' })).body.error.message).toMatch(/อย่างน้อย 1 บาท/);
    expect((await call('POST', '/api/v1/fa/assets', { ...body, start_date: '2025-12-31' })).body.error.message).toMatch(/ไม่ก่อนวันที่ซื้อ/);
    expect((await call('POST', '/api/v1/fa/assets', { ...body, accum_depr_bf: '100' })).body.error.message).toMatch(/วันที่ของค่าเสื่อมสะสมยกมา/);
    const id = (await call('POST', '/api/v1/fa/assets', body)).body.id;
    expect((await call('POST', '/api/v1/fa/assets', body)).status).toBe(409);
    // เส้นตรง 36,500 × 20% = 7,300 ต่อปี = 20 บาทต่อวัน · อัตราคำนวณจากอายุ 5 ปี
    let x = (await call('GET', `/api/v1/fa/assets/${id}`)).body;
    expect([x.code, Number(x.rate), x.end_date, x.annual]).toEqual(['CAR-01', 20, '2031-01-01', '7300.00']);
    const y26 = x.schedule.find((y: { start: string }) => y.start === '2026-01-01');
    expect([y26.months[0].amount, y26.months[1].amount, y26.total, y26.months[0].posted]).toEqual(['620.00', '560.00', '7300.00', false]);
    // งวดที่ลงบัญชีแล้วใช้ยอดจริง และยอดสะสมต้นปีถัดไปต่อจากยอดจริง
    const p1 = y26.months[0].period_id;
    await sql`INSERT INTO fa_depreciation (company_id, asset_id, period_id, amount) VALUES (${companyId}, ${id}, ${p1}, 600)`.execute(database.db);
    x = (await call('GET', `/api/v1/fa/assets/${id}`)).body;
    const a26 = x.schedule.find((y: { start: string }) => y.start === '2026-01-01');
    expect([a26.months[0].amount, a26.months[0].posted, a26.total, x.accumulated, x.book_value]).toEqual(['600.00', true, '7280.00', '600.00', '35901.00']);
    const a27 = x.schedule.find((y: { start: string }) => y.start === '2027-01-01');
    if (a27) expect(a27.acc_before).toBe('7280.00');
    // ยอดลด + ยอดยกมา: (36,501 − 5,000) × 20% = 6,300.20
    expect((await call('PUT', `/api/v1/fa/assets/${id}`, { ...body, code: 'CAR-01', method: '2', accum_depr_bf: '5000', accum_bf_date: '2026-01-01' })).status).toBe(200);
    expect((await call('GET', `/api/v1/fa/assets/${id}`)).body.annual).toBe('6300.20');
    expect((await call('PUT', `/api/v1/fa/assets/${id}`, { ...body, code: 'CAR-02' })).body.error.message).toMatch(/เปลี่ยนรหัสทรัพย์สิน/);
    // เปลี่ยนรหัส · ลบไม่ได้เมื่อลงค่าเสื่อมแล้ว · ลบกลุ่มที่ใช้อยู่ไม่ได้
    expect((await call('POST', `/api/v1/fa/assets/${id}/recode`, { code: 'car-99' })).body.code).toBe('CAR-99');
    expect((await call('GET', '/api/v1/fa/assets?q=CAR-99&status=all')).body.map((r: { code: string; book_value: string }) => `${r.code}:${r.book_value}`)).toEqual(['CAR-99:30901.00']);
    expect((await call('DELETE', `/api/v1/fa/assets/${id}`)).body.error.message).toMatch(/ลงค่าเสื่อมแล้ว/);
    expect((await call('DELETE', `/api/v1/asset-account-groups/${g.body.id}`)).body.error.message).toMatch(/ใช้อยู่กับทรัพย์สิน/);
    // ข้ามบริษัทไม่ได้
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('GET', `/api/v1/fa/assets/${id}`)).status).toBe(404);
    expect((await call('GET', '/api/v1/fa/assets?q=CAR&status=all')).body).toEqual([]);
    expect((await call('POST', '/api/v1/fa/assets', { ...body, account_group_id: g.body.id })).body.error.message).toMatch(/ไม่พบกลุ่มบัญชี/);
    expect((await call('POST', `/api/v1/fa/assets/${id}/recode`, { code: 'X' })).status).toBe(404);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    await sql`DELETE FROM fa_depreciation WHERE asset_id = ${id}`.execute(database.db);
    expect((await call('DELETE', `/api/v1/fa/assets/${id}`)).status).toBe(200);
    expect((await call('DELETE', `/api/v1/asset-account-groups/${g.body.id}`)).status).toBe(200);
  });
  it('depreciation posting (T6.2): period journals FA…, unchanged = no new voucher, sale stops depreciation and reposts, unsell, post-only, report 5.B, isolation', async () => {
    const g = (await call('POST', '/api/v1/asset-account-groups', { code: 'DEP0', name_th: 'อุปกรณ์', depr_expense_account_id: expense, accum_depr_account_id: cash })).body.id;
    const mk = async (code: string, cost: string) => (await call('POST', '/api/v1/fa/assets', { code, name_th: code, account_group_id: g, purchase_date: '2026-01-01', start_date: '2026-01-01', cost, salvage_value: '1', method: '1', rate: '20' })).body.id as string;
    const a1 = await mk('DEP-A', '36501'), a2 = await mk('DEP-B', '18251');   // 20 / 10 บาทต่อวัน
    const per = (await call('GET', '/api/v1/fa/depreciation-periods')).body.filter((p: { start_date: string }) => String(p.start_date).startsWith('2026-0'));
    const jan = per.find((p: { period_no: number }) => p.period_no === 1).id, feb = per.find((p: { period_no: number }) => p.period_no === 2).id;
    const r1 = (await call('POST', '/api/v1/fa/depreciate', { period_ids: [jan, feb] })).body.periods;
    expect(r1.map((x: { voucher_no: string; total: string }) => `${x.voucher_no}:${x.total}`)).toEqual(['FA69010001:930.00', 'FA69020001:840.00']);
    const jid = (await sql<{ id: string }>`SELECT id FROM gl_journal WHERE company_id = ${companyId} AND voucher_no = 'FA69010001'`.execute(database.db)).rows[0]!.id;
    const j = (await call('GET', `/api/v1/gl/journals/${jid}`)).body;
    expect([j.editable, j.lines.map((l: { debit: string; credit: string }) => `${l.debit}/${l.credit}`)]).toEqual([false, ['930.00/0.00', '0.00/930.00']]);
    // คิดซ้ำ ยอดเท่าเดิม = ไม่ออกใบใหม่
    expect((await call('POST', '/api/v1/fa/depreciate', { period_ids: [jan] })).body.periods[0].changed).toBe(false);
    // ขาย DEP-A วันที่ 15 ม.ค. → ม.ค. คิดใหม่ (A 300 + B 310) ยกเลิกใบเดิม · ก.พ. เหลือเฉพาะ B
    const s = (await call('POST', `/api/v1/fa/assets/${a1}/sell`, { sold_date: '2026-01-15', sold_amount: '30000' })).body;
    expect(s.reposted.map((x: { voucher_no: string; total: string }) => `${x.voucher_no}:${x.total}`)).toEqual(['FA69010002:610.00', 'FA69020002:280.00']);
    expect((await call('GET', `/api/v1/gl/journals/${jid}`)).body.doc_status).toBe('C');
    const x1 = (await call('GET', `/api/v1/fa/assets/${a1}`)).body;
    expect([x1.status, x1.accumulated, x1.book_value, x1.gain_loss]).toEqual(['S', '300.00', '36201.00', '-6201.00']);
    expect((await call('POST', `/api/v1/fa/assets/${a1}/sell`, { sold_date: '2025-12-31', sold_amount: '1' })).body.error.message).toMatch(/ไม่ก่อนวันที่เริ่มใช้/);
    // ยกเลิกการขาย → กลับไปคิดเต็มเดือน
    expect((await call('POST', `/api/v1/fa/assets/${a1}/unsell`, {})).body.reposted.map((x: { total: string }) => x.total)).toEqual(['930.00', '840.00']);
    // ลงบัญชีใหม่ (ไม่คำนวณ): ค่าเสื่อมที่ไม่มีใบสำคัญ
    await sql`UPDATE fa_depreciation SET journal_id = NULL WHERE period_id = ${feb} AND deleted_at IS NULL`.execute(database.db);
    const rp = (await call('POST', '/api/v1/fa/depreciate', { period_ids: [feb], mode: 'post' })).body.periods[0];
    expect([rp.changed, rp.total]).toEqual([true, '840.00']);
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM gl_journal WHERE company_id = ${companyId} AND source_module = 'FA' AND period_id = ${feb} AND doc_status = 'N'`.execute(database.db)).rows[0]!.n).toBe(1);
    // รายงาน 5.B
    const rep = (await call('POST', '/api/v1/rpt/5.B/run', { params: { date_from: '2026-01-01', date_to: '2026-02-28' } })).body;
    expect(rep.rows.find((r: { c: { code?: string } }) => r.c.code === 'DEP-A').c).toMatchObject({ cost: '36501.00', before: '0.00', dep: '1180.00', end: '1180.00', nbv: '35321.00' });
    // งวดปิดแล้ว · ข้ามบริษัทไม่ได้
    await sql`UPDATE gl_period SET is_locked = true WHERE id = ${feb}`.execute(database.db);
    expect((await call('POST', '/api/v1/fa/depreciate', { period_ids: [feb] })).body.error.message).toMatch(/ปิดแล้ว/);
    await sql`UPDATE gl_period SET is_locked = false WHERE id = ${feb}`.execute(database.db);
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('POST', '/api/v1/fa/depreciate', { period_ids: [jan] })).body.error.message).toMatch(/ไม่พบงวด/);
    expect((await call('POST', `/api/v1/fa/assets/${a1}/sell`, { sold_date: '2026-01-15', sold_amount: '1' })).status).toBe(404);
    expect((await call('POST', '/api/v1/rpt/5.B/run', { params: {} })).body.rows.at(-1).c.cost).toBe('0.00');
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    // ล้างข้อมูลทดสอบ: ยกเลิกใบสำคัญค่าเสื่อม
    await sql`UPDATE gl_journal SET doc_status = 'C' WHERE company_id = ${companyId} AND source_module = 'FA' AND voucher_no LIKE 'FA69%'`.execute(database.db);
    await sql`DELETE FROM fa_depreciation WHERE asset_id IN (${a1}, ${a2})`.execute(database.db);
    for (const id of [a1, a2]) expect((await call('DELETE', `/api/v1/fa/assets/${id}`)).status).toBe(200);
    expect((await call('DELETE', `/api/v1/asset-account-groups/${g}`)).status).toBe(200);
  });
  it('year-end (T6.3): checklist, close in order with YES, periods locked, next year, reopen latest first, periodic inventory JV guard, isolation', async () => {
    const st = async (fy?: string) => (await call('GET', `/api/v1/gl/year-end${fy ? `?fiscal_year_id=${fy}` : ''}`)).body;
    const s0 = await st();
    const byCode = (c: string) => s0.years.find((y: { code: string }) => y.code === c);
    const y69 = byCode('2569');
    const earlier = s0.years.filter((y: { end: string; status: string }) => y.end < y69.start && y.status === 'O');
    const s69 = await st(y69.id);
    expect(s69.checks.find((c: { key: string }) => c.key === 'tb').ok).toBe(true);
    if (earlier.length) {
      expect(s69.checks.find((c: { key: string }) => c.key === 'earlier').ok).toBe(false);
      expect((await call('POST', '/api/v1/gl/year-end/close', { fiscal_year_id: y69.id, confirm: 'YES' })).body.error.message).toMatch(/ปิดตามลำดับปี/);
      for (const e of earlier) expect((await call('POST', '/api/v1/gl/year-end/close', { fiscal_year_id: e.id, confirm: 'yes' })).status).toBe(200);
    }
    expect((await call('POST', '/api/v1/gl/year-end/close', { fiscal_year_id: y69.id, confirm: 'no' })).body.error.message).toMatch(/ป้อน YES/);
    const c = await call('POST', '/api/v1/gl/year-end/close', { fiscal_year_id: y69.id, confirm: 'YES' });
    expect([c.status, c.body.closed]).toEqual([200, '2569']);
    const after = await st(y69.id);
    expect([after.fiscal_year.status, after.unlocked_periods, after.next_year.code, !!after.next_year.id]).toEqual(['C', 0, '2570', true]);
    // ปีที่ปิดแล้วลงใบสำคัญไม่ได้
    const jv = await call('POST', '/api/v1/gl/journals', { journal_book_id: bookId, voucher_date: '2026-06-30', lines: [{ account_id: expense, debit: '5' }, { account_id: cash, credit: '5' }] });
    expect(jv.body.error.message).toMatch(/งวดที่ปิดแล้ว/);
    expect((await call('POST', '/api/v1/gl/year-end/close', { fiscal_year_id: y69.id, confirm: 'YES' })).body.error.message).toMatch(/ปิดแล้ว/);
    // เปิดกลับย้อนจากปีล่าสุด
    if (earlier.length) expect((await call('POST', '/api/v1/gl/year-end/reopen', { fiscal_year_id: earlier[0].id })).body.error.message).toMatch(/ต้องเปิดปี 2569 ก่อน/);
    expect((await call('POST', '/api/v1/gl/year-end/reopen', { fiscal_year_id: y69.id })).status).toBe(200);
    for (const e of [...earlier].reverse()) expect((await call('POST', '/api/v1/gl/year-end/reopen', { fiscal_year_id: e.id })).status).toBe(200);
    expect((await st(y69.id)).unlocked_periods).toBeGreaterThanOrEqual(12);
    // ใบสำคัญปิดสินค้า: Perpetual ไม่ต้อง · Periodic ต้องยืนยันยอดปลายปีก่อน
    expect((await call('POST', '/api/v1/gl/year-end/inventory-jv', { fiscal_year_id: y69.id })).body.error.message).toMatch(/Perpetual/);
    await sql`INSERT INTO sys_setting (company_id, module, key, value) VALUES (${companyId}, 'IC', 'ic.posting_method', '"PERIODIC"')`.execute(database.db);
    const sp = await st(y69.id);
    expect([sp.periodic, sp.checks.some((x: { key: string }) => x.key === 'inv')]).toEqual([true, true]);
    if (sp.inventory.length) expect((await call('POST', '/api/v1/gl/year-end/inventory-jv', { fiscal_year_id: y69.id })).body.error.message).toMatch(/ยืนยันยอดสินค้าคงเหลือปลายปี/);
    await sql`DELETE FROM sys_setting WHERE company_id = ${companyId} AND key = 'ic.posting_method'`.execute(database.db);
    // ข้ามบริษัทไม่ได้
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('POST', '/api/v1/gl/year-end/close', { fiscal_year_id: y69.id, confirm: 'YES' })).status).toBe(404);
    expect((await call('POST', '/api/v1/gl/year-end/reopen', { fiscal_year_id: y69.id })).status).toBe(404);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
  });
  it('backup / verify / restore per company and users (T6.4): replace only this company, tamper checks, cross-company/tenant blocked', async () => {
    const admin = cookie;
    const { gunzipSync, gzipSync } = await import('node:zlib');
    const raw = async (method: 'GET' | 'POST', url: string, payload?: Buffer) => {
      const r = await app.inject({ method, url, payload, headers: { ...(cookie ? { cookie } : {}), ...(payload ? { 'content-type': 'application/octet-stream' } : {}) } });
      return { status: r.statusCode, buf: r.rawPayload, json: (() => { try { return JSON.parse(r.body); } catch { return null; } })(), disp: String(r.headers['content-disposition'] ?? '') };
    };
    const login = async (u: string, p: string) => { cookie = ''; expect((await call('POST', '/api/v1/auth/login', { username: u, password: p })).status).toBe(200); };
    expect((await call('GET', '/api/v1/backup/users')).body.error.message).toMatch(/ผู้ดูแลของลูกค้า/);
    expect((await call('POST', '/api/v1/tenants', { code: 'BKUPX', name: 'ลูกค้าสำรอง X', admin_username: 'bx.admin', admin_name: 'ผู้ดูแล X', admin_password: 'passX1234' })).status).toBe(200);
    expect((await call('POST', '/api/v1/tenants', { code: 'BKUPY', name: 'ลูกค้าสำรอง Y', admin_username: 'by.admin', admin_name: 'ผู้ดูแล Y', admin_password: 'passY1234' })).status).toBe(200);
    await login('bx.admin', 'passX1234');
    const x1 = (await call('POST', '/api/v1/companies', { code: 'X1', name_th: 'บริษัท เอ็กซ์ จำกัด', fiscal_start: '2026-01-01', chart: 'express' })).body.id;
    await call('POST', '/api/v1/auth/select', { company_id: x1 });
    const dept = (await call('POST', '/api/v1/departments', { code: 'D1', name_th: 'ฝ่ายขาย' })).body.id;
    const book = (await call('GET', '/api/v1/gl/books')).body[0].id;
    const acc = (await call('GET', '/api/v1/gl/accounts')).body.filter((x: { is_control: boolean }) => !x.is_control);
    const jv = (n: string) => call('POST', '/api/v1/gl/journals', { journal_book_id: book, voucher_date: '2026-03-01', lines: [{ account_id: acc[0].id, debit: n }, { account_id: acc[1].id, credit: n }] });
    expect((await jv('10.25')).status).toBe(200);
    const tb = async () => (await call('GET', '/api/v1/reports/trial-balance?from=2026-01-01&to=2026-12-31')).body.totals;
    const before = await tb();
    // สำรอง → ทดสอบ
    const b = await raw('GET', '/api/v1/backup/company');
    expect([b.status, /\d{8}-X1\.buddy/.test(b.disp)]).toEqual([200, true]);
    const v = (await raw('POST', '/api/v1/backup/verify', b.buf)).json;
    expect([v.same_company, v.schema_ok, v.company.code, v.rows > 100]).toEqual([true, true, 'X1', true]);
    expect((await raw('POST', '/api/v1/backup/verify', Buffer.from('not a backup'))).json.error.message).toMatch(/เสียหาย/);
    const text = gunzipSync(b.buf).toString('utf-8');
    expect((await raw('POST', '/api/v1/backup/verify', gzipSync(Buffer.from(text.replace('ฝ่ายขาย', 'ฝ่ายขโมย'))))).json.error.message).toMatch(/ไม่สมบูรณ์/);
    // เปลี่ยนข้อมูลหลังสำรอง แล้วนำข้อมูลสำรองกลับ
    expect((await call('PUT', `/api/v1/departments/${dept}`, { code: 'D1', name_th: 'ฝ่ายขายใหม่' })).status).toBe(200);
    expect((await call('POST', '/api/v1/departments', { code: 'D2', name_th: 'ฝ่ายบัญชี' })).status).toBe(200);
    expect((await jv('99')).status).toBe(200);
    expect((await raw('POST', '/api/v1/backup/restore', b.buf)).json.error.message).toMatch(/ป้อน YES/);
    const r = await raw('POST', '/api/v1/backup/restore?confirm=YES', b.buf);
    expect([r.status, r.json.restored]).toEqual([200, 'X1']);
    const depts = (await call('GET', '/api/v1/departments')).body as Array<{ code: string; name_th: string }>;
    expect(depts.map((x) => `${x.code}:${x.name_th}`).filter((x) => x.startsWith('D'))).toEqual(['D1:ฝ่ายขาย']);
    expect(await tb()).toEqual(before);
    // ข้อมูลผู้ใช้: สำรอง → เปลี่ยนชื่อ → นำกลับ
    const u = (await call('POST', '/api/v1/users', { username: 'bx.user1', display_name: 'พนักงาน เอ็กซ์', password: 'userX1234', companies: [x1] })).body.id;
    const ub = await raw('GET', '/api/v1/backup/users');
    expect(ub.status).toBe(200);
    expect((await call('PUT', `/api/v1/users/${u}`, { username: 'bx.user1', display_name: 'ชื่อเปลี่ยนแล้ว', companies: [x1] })).status).toBe(200);
    expect((await raw('POST', '/api/v1/backup/users/restore?confirm=YES', ub.buf)).status).toBe(200);
    expect((await call('GET', '/api/v1/users')).body.users.find((x: { id: string }) => x.id === u).display_name).toBe('พนักงาน เอ็กซ์');
    expect((await raw('POST', '/api/v1/backup/users/restore?confirm=YES', b.buf)).json.error.message).toMatch(/ไม่ใช่แฟ้มสำรองข้อมูลผู้ใช้/);
    // ลูกค้ารายอื่น: นำแฟ้มของ X มาใช้ไม่ได้ · แก้หัวแฟ้มเป็นบริษัทตัวเองก็ทับข้อมูลของ X ไม่ได้
    await login('by.admin', 'passY1234');
    const y1 = (await call('POST', '/api/v1/companies', { code: 'Y1', name_th: 'บริษัท วาย จำกัด', fiscal_start: '2026-01-01', chart: 'express' })).body.id;
    await call('POST', '/api/v1/auth/select', { company_id: y1 });
    expect((await raw('POST', '/api/v1/backup/restore?confirm=YES', b.buf)).json.error.message).toMatch(/เป็นของบริษัท X1/);
    const nl = text.indexOf('\n'), head = JSON.parse(text.slice(0, nl));
    const forged = gzipSync(Buffer.from(JSON.stringify({ ...head, company: { ...head.company, id: y1 } }) + '\n' + text.slice(nl + 1)));
    expect((await raw('POST', '/api/v1/backup/restore?confirm=YES', forged)).status).not.toBe(200);
    expect((await raw('POST', '/api/v1/backup/users/restore?confirm=YES', ub.buf)).json.error.message).toMatch(/ลูกค้ารายอื่น/);
    await login('bx.admin', 'passX1234');
    await call('POST', '/api/v1/auth/select', { company_id: x1 });
    expect((await call('GET', '/api/v1/departments')).body.some((x: { code: string }) => x.code === 'D1')).toBe(true);
    expect(await tb()).toEqual(before);
    cookie = admin;
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
  });
  it('stock data check report 4.6 (T6.5): negative balance and value without quantity flagged, isolation', async () => {
    const unit = (await call('GET', '/api/v1/lookups?types=UNIT')).body.UNIT[0].id;
    const [w1] = (await call('GET', '/api/v1/lookups?types=WH')).body.WH.map((w: { id: string }) => w.id);
    const code = '02-TEST-000065';
    const item = (await call('POST', '/api/v1/items', { code, name_th: 'สินค้าตรวจยอด', base_unit_id: unit, std_cost: '5' })).body.id;
    const iss = (await call('POST', '/api/v1/stock-issues', { doc_type_id: (await call('GET', '/api/v1/trade-defaults/OU')).body.types[0].id, doc_date: '2027-08-01', warehouse_id: w1, lines: [{ item_id: item, qty: 3, warehouse_id: w1 }] })).body;
    const run = async () => (await call('POST', '/api/v1/rpt/4.6/run', { params: { as_of: '2027-12-31', item_from: code, item_to: code, snapshot: true } })).body;
    const r = await run();
    expect(r.rows[0].c).toMatchObject({ code, qty: '-3', issue: expect.stringMatching(/จำนวนติดลบ/) });
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await run()).rows.at(-1).c.name).toBe('ไม่พบรายการผิดปกติ');
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    if (iss.id) expect((await call('POST', `/api/v1/stock-issues/${iss.id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
  });
  it('activity log viewer (T6.6): kinds, filters, password reset event, tenant isolation', async () => {
    const admin = cookie;
    cookie = ''; expect((await call('POST', '/api/v1/auth/login', { username: 'admin', password: 'wrong-pass' })).status).toBe(401);
    cookie = admin;
    const pw = (await call('GET', '/api/v1/activity-log/search?kind=password')).body.rows;
    expect(pw.some((r: { action: string }) => r.action === 'LOGIN_FAIL')).toBe(true);
    expect(pw.every((r: { action: string }) => ['LOGIN', 'LOGIN_FAIL', 'LOGOUT', 'PASSWORD', 'RESET_PASSWORD', 'EDIT_USER'].includes(r.action))).toBe(true);
    const audit = (await call('GET', '/api/v1/activity-log/search?kind=audit&limit=200')).body.rows;
    expect(audit.length).toBeGreaterThan(0);
    expect(audit.some((r: { action: string }) => r.action === 'LOGIN' || r.action.startsWith('USE_'))).toBe(false);
    const today = new Date().toLocaleDateString('sv-SE');
    expect((await call('GET', `/api/v1/activity-log/search?from=${today}&to=${today}&action=LOGIN_FAIL`)).body.rows.length).toBeGreaterThan(0);
    expect((await call('GET', '/api/v1/activity-log/search?from=2000-01-01&to=2000-01-02')).body.rows).toEqual([]);
    // ตั้งรหัสผ่านให้ผู้ใช้ (S-SEC-06) บันทึกเหตุการณ์แยก
    const u = (await call('GET', '/api/v1/users')).body.users.find((x: { username: string }) => x.username === 'clerk0');
    expect((await call('PUT', `/api/v1/users/${u.id}`, { username: 'clerk0', display_name: u.display_name, password: 'clerk0pass', approval_level: 0, companies: [companyId] })).status).toBe(200);
    expect((await call('GET', '/api/v1/activity-log/search?kind=password&action=RESET_PASSWORD')).body.rows[0].doc_no).toBe('clerk0');
    // ผู้ใช้ระดับต่ำดูแฟ้มบันทึกเหตุการณ์ไม่ได้ · ลูกค้ารายอื่นไม่เห็นเหตุการณ์ของบริษัทนี้
    cookie = ''; expect((await call('POST', '/api/v1/auth/login', { username: 'boss5', password: 'boss5pass' })).status).toBe(200);
    expect((await call('GET', '/api/v1/activity-log/search')).status).toBe(403);
    cookie = ''; expect((await call('POST', '/api/v1/auth/login', { username: 'bx.admin', password: 'passX1234' })).status).toBe(200);
    const xs = (await call('GET', '/api/v1/activity-log/search?limit=5000')).body.rows;
    expect(xs.some((r: { company_code: string | null }) => r.company_code === 'DEMO')).toBe(false);
    expect(xs.some((r: { username: string | null }) => r.username === 'clerk0')).toBe(false);
    cookie = admin;
  });
  it('notes Alt+R (T7.1): document + line notes printed, master notes, cancelled doc locked, isolation', async () => {
    const ivType = (await call('GET', '/api/v1/trade-defaults/IV')).body.types.find((t: { code: string }) => t.code === 'IV').id;
    const unit = (await call('GET', '/api/v1/lookups?types=UNIT')).body.UNIT[0].id;
    const [w1] = (await call('GET', '/api/v1/lookups?types=WH')).body.WH.map((w: { id: string }) => w.id);
    const cus = (await call('GET', '/api/v1/customers?q=C520')).body.rows[0].id;
    const item = (await call('POST', '/api/v1/items', { code: '02-TEST-000071', name_th: 'สินค้าหมายเหตุ', base_unit_id: unit, std_cost: '1' })).body.id;
    const iv = (await call('POST', '/api/v1/sales-invoices', { doc_type_id: ivType, doc_date: '2027-09-01', party_id: cus, price_type: '0', vat_rate: 0, warehouse_id: w1, lines: [{ item_id: item, qty: 1, unit_price: 50 }] })).body;
    const n0 = (await call('GET', `/api/v1/notes/doc/${iv.id}`)).body;
    expect([n0.editable, n0.doc, n0.lines.length]).toEqual([true, [], 1]);
    const lid = n0.lines[0].line_id;
    expect((await call('PUT', `/api/v1/notes/doc/${iv.id}`, { doc: ['ส่งของก่อน 10 โมง', ' ', 'โทรก่อนส่ง'], lines: { [lid]: ['สีแดง'] } })).status).toBe(200);
    const n1 = (await call('GET', `/api/v1/notes/doc/${iv.id}`)).body;
    expect([n1.doc, n1.lines[0].notes]).toEqual([['ส่งของก่อน 10 โมง', 'โทรก่อนส่ง'], ['สีแดง']]);
    const p = (await call('GET', `/api/v1/print/doc/${iv.id}`)).body.data;
    expect([p.notes, p.lines[0].name.endsWith('\nสีแดง')]).toEqual([['ส่งของก่อน 10 โมง', 'โทรก่อนส่ง'], true]);
    expect((await call('PUT', `/api/v1/notes/doc/${iv.id}`, { doc: [], lines: { [cus]: ['x'] } })).body.error.message).toMatch(/ไม่อยู่ในเอกสารนี้/);
    // แฟ้มหลัก: สินค้า 10 บรรทัด ลูกค้า 5 บรรทัด
    expect((await call('PUT', `/api/v1/master-notes/item/${item}`, { notes: ['เก็บในที่แห้ง'] })).status).toBe(200);
    expect((await call('GET', `/api/v1/master-notes/item/${item}`)).body).toEqual({ max: 10, notes: ['เก็บในที่แห้ง'] });
    expect((await call('PUT', `/api/v1/master-notes/customer/${cus}`, { notes: ['1', '2', '3', '4', '5', '6'] })).status).toBe(400);
    // ข้ามบริษัทไม่ได้
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('GET', `/api/v1/notes/doc/${iv.id}`)).status).toBe(404);
    expect((await call('PUT', `/api/v1/master-notes/item/${item}`, { notes: ['x'] })).status).toBe(404);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    expect((await call('POST', `/api/v1/sales-invoices/${iv.id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
    expect((await call('PUT', `/api/v1/notes/doc/${iv.id}`, { doc: ['x'] })).body.error.message).toMatch(/ยกเลิกแล้ว/);
  });
  it('credit limit + credit-note original value (T7.1): over limit blocked below approval level, warned for admin, CN prints original/correct/difference', async () => {
    const admin = cookie;
    const ivType = (await call('GET', '/api/v1/trade-defaults/IV')).body.types.find((t: { code: string }) => t.code === 'IV').id;
    const cnType = (await call('GET', '/api/v1/trade-defaults/CN')).body.types[0].id;
    const unit = (await call('GET', '/api/v1/lookups?types=UNIT')).body.UNIT[0].id;
    const [w1] = (await call('GET', '/api/v1/lookups?types=WH')).body.WH.map((w: { id: string }) => w.id);
    const cus = (await call('GET', '/api/v1/customers?q=C520')).body.rows[0].id;
    const item = (await call('POST', '/api/v1/items', { code: '02-TEST-000072', name_th: 'สินค้าวงเงิน', base_unit_id: unit, std_cost: '1' })).body.id;
    await sql`UPDATE md_customer SET credit_limit = 1 WHERE id = ${cus}`.execute(database.db);
    const body = { doc_type_id: ivType, doc_date: '2027-09-10', party_id: cus, price_type: '2', vat_rate: 7, warehouse_id: w1, lines: [{ item_id: item, qty: 2, unit_price: 500 }] };
    cookie = ''; expect((await call('POST', '/api/v1/auth/login', { username: 'clerk0', password: 'clerk0pass' })).status).toBe(200);
    expect((await call('POST', '/api/v1/sales-invoices', body)).body.error.message).toMatch(/เกินวงเงิน.*ระดับอนุมัติ 9/);
    cookie = admin;
    const iv = (await call('POST', '/api/v1/sales-invoices', body)).body;
    expect(iv.warnings.some((w: string) => /เกินวงเงิน/.test(w))).toBe(true);
    await sql`UPDATE md_customer SET credit_limit = NULL WHERE id = ${cus}`.execute(database.db);
    // ใบลดหนี้อ้างใบกำกับ: มูลค่าเดิม 1,000 ลด 300 → ที่ถูกต้อง 700
    const cn = (await call('POST', '/api/v1/ar-credit-notes', { doc_type_id: cnType, doc_date: '2027-09-11', party_id: cus, ref_header_id: iv.id, price_type: '2', vat_rate: 7, lines: [{ item_id: item, qty: 1, unit_price: 300 }] })).body;
    const pd = (await call('GET', `/api/v1/print/doc/${cn.id}`)).body.data;
    expect(pd.totals.slice(0, 3)).toEqual([{ label: 'มูลค่าสินค้าตามใบกำกับเดิม', value: '1000.00' }, { label: 'มูลค่าที่ถูกต้อง', value: '700.00' }, { label: 'ผลต่าง', value: '300.00' }]);
    expect(pd.fields.ref_invoice).toContain(iv.doc_no);
    expect(pd.totals.at(-1).value).toBe('321.00');
    for (const [path, x] of [['ar-credit-notes', cn], ['sales-invoices', iv]] as const) expect((await call('POST', `/api/v1/${path}/${x.id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
  });
  it('JV VAT + cheque detail (T7.1 S-GL-03/04): entries linked to the voucher, cancel cascades, cross-company blocked', async () => {
    const roles = (await call('GET', '/api/v1/gl/default-accounts')).body as Array<{ role: string; account_id: string }>;
    const vatAcc = roles.find((r) => r.role === 'INPUT_VAT')!.account_id, chqAcc = roles.find((r) => r.role === 'CHEQUE_PAID')!.account_id;
    const bank = (await call('GET', '/api/v1/bank-accounts')).body[0].id;
    const jv = (await call('POST', '/api/v1/gl/journals', { journal_book_id: bookId, voucher_date: '2027-10-05', lines: [{ account_id: expense, debit: '1000' }, { account_id: vatAcc, debit: '70' }, { account_id: chqAcc, credit: '1070' }] })).body;
    const v = await call('POST', '/api/v1/vat/P', { journal_id: jv.id, tax_invoice_no: 'JV-TAX-1', tax_invoice_date: '2027-10-05', month: '2027-10', party_name: 'ผู้ขายทดสอบ', base_amount: '1000', vat_amount: '70' });
    expect(v.status).toBe(200);
    const listed = (await call('GET', `/api/v1/vat/P?journal_id=${jv.id}&status=all`)).body.rows;
    expect(listed.map((r: { tax_invoice_no: string; doc_no: string }) => `${r.tax_invoice_no}:${r.doc_no}`)).toEqual([`JV-TAX-1:${jv.voucher_no}`]);
    const c = await call('POST', '/api/v1/cheques', { direction: 'P', cheque_no: 'JV-CHQ-1', cheque_date: '2027-10-20', bank_account_id: bank, payee_name: 'ผู้ขายทดสอบ', amount: '1070', source_journal_id: jv.id });
    expect(c.status).toBe(200);
    expect((await call('GET', `/api/v1/cheques?direction=P&journal_id=${jv.id}`)).body.rows.map((r: { cheque_no: string }) => r.cheque_no)).toEqual(['JV-CHQ-1']);
    // ข้ามบริษัท: อ้างใบสำคัญของบริษัทอื่นไม่ได้
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('POST', '/api/v1/vat/P', { journal_id: jv.id, tax_invoice_no: 'X', tax_invoice_date: '2027-10-05', month: '2027-10', base_amount: '1', vat_amount: '0' })).body.error.message).toMatch(/ไม่พบใบสำคัญ|ไม่พบงวด/);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    // ยกเลิกใบสำคัญ → ภาษียกเลิก เช็คออกจากทะเบียน
    expect((await call('POST', `/api/v1/gl/journals/${jv.id}/cancel`, { reason: 'ทดสอบ' })).status).toBe(200);
    expect((await call('GET', `/api/v1/vat/P?journal_id=${jv.id}&status=all`)).body.rows[0].doc_status).toBe('C');
    expect((await call('GET', `/api/v1/cheques?direction=P&journal_id=${jv.id}`)).body.rows).toEqual([]);
    expect((await call('POST', '/api/v1/vat/P', { journal_id: jv.id, tax_invoice_no: 'JV-TAX-2', tax_invoice_date: '2027-10-05', month: '2027-10', base_amount: '1', vat_amount: '0' })).body.error.message).toMatch(/ยกเลิกแล้ว/);
  });
  it('copy company setup + masters (T7.1 S-CO-04/05/06): new ids, references remapped, no transactions, posting works', async () => {
    const srcAcc = (await call('GET', '/api/v1/gl/accounts')).body.length;
    const srcTypes = ((await call('GET', '/api/v1/doc-types')).body as Array<{ code: string }>).map((t) => t.code).sort();
    const srcCus = (await call('GET', '/api/v1/customers?q=C520')).body.rows[0];
    const r = await call('POST', '/api/v1/companies', { code: 'COPY1', name_th: 'บริษัทคัดลอก จำกัด', fiscal_start: '2027-01-01', chart: 'copy', copy_from_company_id: companyId, copy_scope: 'all' });
    expect(r.status).toBe(200);
    await call('POST', '/api/v1/auth/select', { company_id: r.body.id });
    expect((await call('GET', '/api/v1/gl/accounts')).body.length).toBe(srcAcc);
    expect(((await call('GET', '/api/v1/doc-types')).body as Array<{ code: string }>).map((t) => t.code).sort()).toEqual(srcTypes);
    const cus = (await call('GET', '/api/v1/customers?q=C520')).body.rows[0];
    expect([cus.code, cus.id === srcCus.id]).toEqual([srcCus.code, false]);
    expect((await call('GET', '/api/v1/gl/journals')).body.rows ?? (await call('GET', '/api/v1/gl/journals')).body).toHaveLength(0);
    const book = (await call('GET', '/api/v1/gl/books')).body[0].id;
    const acc = (await call('GET', '/api/v1/gl/accounts')).body.filter((x: { is_control: boolean }) => !x.is_control);
    expect((await call('POST', '/api/v1/gl/journals', { journal_book_id: book, voucher_date: '2027-02-01', lines: [{ account_id: acc[0].id, debit: '5' }, { account_id: acc[1].id, credit: '5' }] })).status).toBe(200);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
  });
  it('petty cash VAT + WHT tabs (T7.1 S-GL-11): entries linked to DP, only DP allowed, cancel cascades', async () => {
    const dpType = (await call('GET', '/api/v1/petty-payments/defaults')).body?.types?.[0]?.id ?? (await sql<{ id: string }>`SELECT id FROM md_doc_type WHERE company_id = ${companyId} AND doc_class = 'DP' LIMIT 1`.execute(database.db)).rows[0]!.id;
    const dp = (await call('POST', '/api/v1/petty-payments', { doc_type_id: dpType, doc_date: '2027-10-10', remark: 'ค่าบริการ', lines: [{ account_id: expense, amount: 1070 }] })).body;
    expect(dp.id).toBeTruthy();
    expect((await call('POST', '/api/v1/vat/P', { header_id: dp.id, tax_invoice_no: 'DP-TAX-1', tax_invoice_date: '2027-10-10', month: '2027-10', base_amount: '1000', vat_amount: '70' })).status).toBe(200);
    expect((await call('POST', '/api/v1/wht', { header_id: dp.id, form_type: 'S53', certificate_date: '2027-10-10', payee_name: 'บริษัท บริการ จำกัด', income_type: 'ค่าบริการ', paid_amount: 1000, rate: 3, tax_amount: 30 })).status).toBe(200);
    expect((await call('GET', `/api/v1/vat/P?header_id=${dp.id}`)).body.rows.map((r: { doc_no: string }) => r.doc_no)).toEqual([dp.doc_no]);
    expect((await call('GET', `/api/v1/wht?header_id=${dp.id}`)).body.rows).toHaveLength(1);
    const iv = (await sql<{ id: string }>`SELECT id FROM doc_header WHERE company_id = ${companyId} AND doc_class NOT IN ('DP') AND doc_status <> 'C' AND deleted_at IS NULL LIMIT 1`.execute(database.db)).rows[0]!.id;
    expect((await call('POST', '/api/v1/vat/P', { header_id: iv, tax_invoice_no: 'X', tax_invoice_date: '2027-10-10', month: '2027-10', base_amount: '1', vat_amount: '0' })).body.error.message).toMatch(/เฉพาะใบจ่ายเงินสดย่อย/);
    expect((await call('POST', `/api/v1/petty-payments/${dp.id}/cancel`, { reason: 'ทดสอบ' })).status).toBe(200);
    expect((await call('GET', `/api/v1/vat/P?header_id=${dp.id}&status=all`)).body.rows[0].doc_status).toBe('C');
    expect((await call('GET', `/api/v1/wht?header_id=${dp.id}&status=all`)).body.rows[0].doc_status).toBe('C');
  });
  it('document status code (T7.1 S-QT-01 table 44): set from lookup, invalid code rejected, only QT/DP/VR', async () => {
    await sql`INSERT INTO md_lookup (company_id, type_code, code, name_th) VALUES (${companyId}, '44', 'WIN', 'ได้งาน')`.execute(database.db);
    const qtType = (await call('GET', '/api/v1/trade-defaults/QT')).body.types[0].id;
    const unit = (await call('GET', '/api/v1/lookups?types=UNIT')).body.UNIT[0].id;
    const cus = (await call('GET', '/api/v1/customers?q=C520')).body.rows[0].id;
    const item = (await call('POST', '/api/v1/items', { code: '02-TEST-000073', name_th: 'สินค้าเสนอราคา', base_unit_id: unit, std_cost: '1' })).body.id;
    const qt = (await call('POST', '/api/v1/quotations', { doc_type_id: qtType, doc_date: '2027-10-01', party_id: cus, price_type: '0', vat_rate: 0, lines: [{ item_id: item, qty: 1, unit_price: 10 }] })).body;
    expect((await call('GET', `/api/v1/doc-status/doc/${qt.id}`)).body).toMatchObject({ table: '44', status_code: null, options: [{ code: 'WIN', name_th: 'ได้งาน' }] });
    expect((await call('PUT', `/api/v1/doc-status/doc/${qt.id}`, { status_code: 'NOPE' })).body.error.message).toMatch(/ไม่พบสถานะ NOPE/);
    expect((await call('PUT', `/api/v1/doc-status/doc/${qt.id}`, { status_code: 'WIN' })).body.status_code).toBe('WIN');
    expect((await call('GET', `/api/v1/doc-status/doc/${qt.id}`)).body.status_code).toBe('WIN');
    expect((await call('POST', `/api/v1/quotations/${qt.id}/cancel`, { reason: 'ทดสอบ' })).status).toBe(200);
  });
  it('manufacturing + import (T7.2/T7.3 บทที่ 26): production cost sources, FX gain/loss on foreign AP payment, isolation', async () => {
    const typeOf = async (cls: string) => (await call('GET', `/api/v1/trade-defaults/${cls}`)).body.types[0].id as string;
    const unit = (await call('GET', '/api/v1/lookups?types=UNIT')).body.UNIT[0].id;
    const [w1] = (await call('GET', '/api/v1/lookups?types=WH')).body.WH.map((w: { id: string }) => w.id);
    const raw = (await call('POST', '/api/v1/items', { code: '02-TEST-000081', name_th: 'วัตถุดิบ A', base_unit_id: unit, std_cost: '1' })).body.id;
    const fg = (await call('POST', '/api/v1/items', { code: '02-TEST-000082', name_th: 'สินค้าสำเร็จรูป A', base_unit_id: unit, std_cost: '1' })).body.id;
    // ซื้อวัตถุดิบ (ปรับเพิ่ม) → เบิกไปผลิต 6 × 10 = 60 · ค่าแรง 940 (OE ไม่รวม VAT)
    const adj = (await call('POST', '/api/v1/stock-adjustments', { doc_type_id: await typeOf('JU'), doc_date: '2027-11-01', lines: [{ item_id: raw, warehouse_id: w1, qty: 10, unit_cost: 10 }] })).body;
    const pd = (await call('POST', '/api/v1/stock-issues', { doc_type_id: await typeOf('OU'), doc_date: '2027-11-02', remark: 'เบิกวัตถุดิบ Job 1', lines: [{ item_id: raw, warehouse_id: w1, qty: 6 }] })).body;
    const lab = (await call('POST', '/api/v1/other-expenses', { code: '95-7100-81', name_th: 'ค่าแรงผลิต', accounts: { expense: expense } })).body.id;
    const oe = (await call('POST', '/api/v1/other-expense-docs', { doc_type_id: await typeOf('OE'), doc_date: '2027-11-03', party_name: 'ค่าแรง', price_type: '2', vat_rate: 7, lines: [{ item_id: lab, amount: 940 }] })).body;
    expect([adj.id, pd.id, oe.id].every(Boolean)).toBe(true);
    const pc = (await call('GET', '/api/v1/stock/production-costs?from=2027-11-01&to=2027-11-30')).body;
    expect(pc.issues.map((x: { doc_no: string; amount: string }) => `${x.doc_no}:${x.amount}`)).toEqual([`${pd.doc_no}:60.00`]);
    expect(pc.expenses.map((x: { doc_no: string; amount: string }) => `${x.doc_no}:${x.amount}`)).toEqual([`${oe.doc_no}:940.00`]);
    // รับสินค้าสำเร็จรูป 4 หน่วย ทุน (60 + 940) ÷ 4 = 250 → Dr สินค้า / Cr บัญชีปรับปรุง
    const pi = (await call('POST', '/api/v1/stock-adjustments', { doc_type_id: await typeOf('JU'), doc_date: '2027-11-30', lines: [{ item_id: fg, warehouse_id: w1, qty: 4, unit_cost: 250 }] })).body;
    expect((await call('GET', `/api/v1/stock-adjustments/${pi.id}`)).body.lines[0]).toMatchObject({ cost_amount: '1000.00' });
    expect((await call('GET', `/api/v1/stock-adjustments?type_id=${await typeOf('JU')}&q=${pi.doc_no}`)).body.rows.map((r: { doc_no: string }) => r.doc_no)).toEqual([pi.doc_no]);

    // เจ้าหนี้ต่างประเทศ 50,000 จ่ายโอน 48,000 → กำไรจากอัตราแลกเปลี่ยน 2,000 (คู่มือหน้า 446)
    const fxRow = (await call('GET', '/api/v1/gl/accounts')).body.filter((x: { is_control: boolean }) => !x.is_control)[8] as { id: string; account_no: string };
    const fxAcc = fxRow.id;
    await sql`INSERT INTO gl_default_account (company_id, role, account_id) VALUES (${companyId}, 'FX_GAIN_LOSS', ${fxAcc})`.execute(database.db);
    const sup = (await call('POST', '/api/v1/suppliers', { code: 'S781', name: 'Foreign Supplier Ltd.', tax_id: tid(5) })).body.id;
    const rr = (await call('POST', '/api/v1/purchase-invoices', { doc_type_id: await typeOf('RR'), doc_date: '2027-11-05', party_id: sup, price_type: '0', vat_rate: 0, warehouse_id: w1, lines: [{ item_id: raw, qty: 100, unit_price: 500 }] })).body;
    const tn = (await call('GET', '/api/v1/payment-methods/P')).body.find((m: { creates_cheque: boolean }) => !m.creates_cheque);
    const ps = { doc_type_id: await typeOf('PS'), doc_date: '2027-11-20', party_id: sup, settlements: [{ invoice_header_id: rr.id, amount: 50000 }], payments: [{ payment_method_id: tn.id, amount: 48000 }], cash_amount: 0 };
    expect((await call('POST', '/api/v1/ap-payments', ps)).body.error.message).toMatch(/Message# 4066.*อัตราแลกเปลี่ยน/);
    const p = await call('POST', '/api/v1/ap-payments', { ...ps, fx_amount: 2000 });
    expect(p.body).toMatchObject({ net_amount: '50000.00', cash_amount: '0.00' });
    expect((await call('GET', `/api/v1/ap-payments/${p.body.id}`)).body.fx_amount).toBe('2000.00');
    const jl = (await call('GET', `/api/v1/docs/${p.body.id}/journal`)).body.journals[0].lines as Array<{ posting_role: string; account_no: string; debit: string; credit: string }>;
    expect(jl.map((l) => `${l.posting_role}:${l.debit}:${l.credit}`)).toEqual(['AP:50000.00:0.00', 'FX:0.00:2000.00', 'PAYMENT:0.00:48000.00']);
    expect(jl.find((l) => l.posting_role === 'FX')!.account_no).toBe(fxRow.account_no);
    expect((await call('GET', `/api/v1/print/doc/${p.body.id}`)).body.data.totals.some((t: { label: string; value: string }) => t.label === 'กำไรจากอัตราแลกเปลี่ยน' && t.value === '2000.00')).toBe(true);
    // ข้ามบริษัทไม่เห็นต้นทุนการผลิตของบริษัทนี้
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('GET', '/api/v1/stock/production-costs?from=2027-11-01&to=2027-11-30')).body).toEqual({ issues: [], expenses: [] });
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    for (const [path, x] of [['ap-payments', p.body], ['purchase-invoices', rr], ['stock-adjustments', pi], ['other-expense-docs', oe], ['stock-issues', pd], ['stock-adjustments', adj]] as const)
      expect((await call('POST', `/api/v1/${path}/${x.id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
  });
  it('API keys (T7.5): bearer auth as the bound user + company, read-only, blocked menus, revoke/expiry, docs, isolation', async () => {
    const users = (await call('GET', '/api/v1/users')).body.users as Array<{ id: string; username: string }>;
    const clerk = users.find((u) => u.username === 'clerk0')!.id;
    const adminId = (await call('GET', '/api/v1/auth/me')).body.user.id;
    expect((await call('POST', '/api/v1/api-keys', { name: '', user_id: clerk })).status).toBe(400);
    expect((await call('POST', '/api/v1/api-keys', { name: 'x', user_id: '00000000-0000-4000-8000-000000000000' })).status).toBe(404);
    const ro = await call('POST', '/api/v1/api-keys', { name: 'ระบบหน้าร้าน (อ่าน)', user_id: clerk, read_only: true });
    expect(ro.status).toBe(200);
    expect(ro.body.key).toMatch(/^bk_[0-9a-f]{12}_[A-Za-z0-9_-]{20,}$/);
    const rw = (await call('POST', '/api/v1/api-keys', { name: 'เชื่อมต่อบัญชี', user_id: adminId })).body;
    // เก็บเฉพาะ hash
    const stored = (await sql<{ key_hash: string }>`SELECT key_hash FROM sys_api_key WHERE id = ${ro.body.id}`.execute(database.db)).rows[0]!.key_hash;
    expect(ro.body.key.includes(stored)).toBe(false);
    expect((await call('GET', '/api/v1/api-keys')).body.map((k: { name: string; key_prefix: string }) => k.key_prefix)).toEqual(expect.arrayContaining([ro.body.key_prefix, rw.key_prefix]));

    // ใช้กุญแจ: ผู้ใช้ + บริษัทตามที่ผูกไว้
    const me = await keyCall(ro.body.key, 'GET', '/api/v1/auth/me');
    expect([me.status, me.body.user.username, me.body.company?.id]).toEqual([200, 'clerk0', companyId]);
    expect((await keyCall(ro.body.key, 'GET', '/api/v1/customers?q=C520')).body.rows).toHaveLength(1);
    const book = (await keyCall(ro.body.key, 'GET', '/api/v1/gl/books')).body[0].id;
    const jvBody = { journal_book_id: book, voucher_date: '2027-12-01', description: 'จากระบบอื่น', lines: [{ account_id: expense, debit: '100.00' }, { account_id: expense, credit: '100.00' }] };
    expect((await keyCall(ro.body.key, 'POST', '/api/v1/gl/journals', jvBody)).body.error.message).toMatch(/อ่านอย่างเดียว/);
    // กุญแจบันทึกได้: ลงบัญชี + log ในนามผู้ใช้ของกุญแจ
    const jv = await keyCall(rw.key, 'POST', '/api/v1/gl/journals', jvBody);
    expect(jv.status).toBe(200);
    const log = (await sql<{ user_id: string }>`SELECT user_id FROM sys_activity_log WHERE company_id = ${companyId} AND row_id = ${jv.body.id} ORDER BY seq LIMIT 1`.execute(database.db)).rows[0];
    expect(log?.user_id).toBe(adminId);
    expect((await keyCall(rw.key, 'POST', `/api/v1/gl/journals/${jv.body.id}/cancel`, { reason: 'ทดสอบกุญแจ' })).status).toBe(200);
    // ห้าม: จัดการผู้ใช้/เลือกบริษัท/กุญแจ/สำรองข้อมูล แม้เป็นผู้ดูแล
    expect((await keyCall(rw.key, 'GET', '/api/v1/users')).status).toBe(403);
    expect((await keyCall(rw.key, 'POST', '/api/v1/auth/select', { company_id: otherCompanyId })).status).toBe(403);
    expect((await keyCall(rw.key, 'GET', '/api/v1/api-keys')).status).toBe(403);
    expect((await keyCall(rw.key, 'POST', '/api/v1/api-keys', { name: 'x', user_id: adminId })).status).toBe(403);
    expect((await keyCall(rw.key, 'GET', '/api/v1/backup/company')).status).toBe(403);
    // ข้อมูลบริษัทอื่นไม่เห็น
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    const otherCus = (await call('POST', '/api/v1/customers', { code: 'K-OTHER', name: 'ลูกค้าบริษัทอื่น', tax_id: tid(6) })).body.id;
    expect((await call('POST', `/api/v1/api-keys/${ro.body.id}/revoke`, {})).status).toBe(404);   // กุญแจของบริษัทอื่น
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    expect((await keyCall(rw.key, 'GET', '/api/v1/customers?q=K-OTHER')).body.rows).toHaveLength(0);
    expect((await keyCall(rw.key, 'GET', `/api/v1/customers/${otherCus}`)).status).toBe(404);
    // กุญแจผิด/ยกเลิก/หมดอายุ → 401 พร้อมเหตุผล
    expect((await keyCall('bk_nothex', 'GET', '/api/v1/auth/me')).body.error.message).toMatch(/ไม่ถูกรูปแบบ/);
    expect((await keyCall(`${ro.body.key.slice(0, 16)}${'A'.repeat(32)}`, 'GET', '/api/v1/auth/me')).body.error.message).toMatch(/ไม่พบกุญแจ/);
    expect((await call('POST', `/api/v1/api-keys/${ro.body.id}/revoke`, {})).status).toBe(200);
    expect((await keyCall(ro.body.key, 'GET', '/api/v1/auth/me')).body.error.message).toMatch(/ถูกยกเลิก/);
    await sql`UPDATE sys_api_key SET expires_on = '2020-01-01' WHERE id = ${rw.id}`.execute(database.db);
    expect((await keyCall(rw.key, 'GET', '/api/v1/auth/me')).body.error.message).toMatch(/หมดอายุ/);
    expect((await call('POST', '/api/v1/api-keys', { name: 'x', user_id: clerk, expires_on: '2020-01-01' })).body.error.message).toMatch(/ไม่ก่อนวันนี้/);
    // ผู้ใช้ถูกถอนสิทธิ์บริษัท → กุญแจใช้ไม่ได้ทันที
    const k3 = (await call('POST', '/api/v1/api-keys', { name: 'k3', user_id: clerk })).body.key;
    await sql`UPDATE sys_user_company SET deleted_at = now() WHERE user_id = ${clerk} AND company_id = ${companyId}`.execute(database.db);
    expect((await keyCall(k3, 'GET', '/api/v1/auth/me')).body.error.message).toMatch(/ไม่มีสิทธิ์เข้าบริษัทนี้/);
    await sql`UPDATE sys_user_company SET deleted_at = NULL WHERE user_id = ${clerk} AND company_id = ${companyId}`.execute(database.db);
    // บันทึกเหตุการณ์ + รายการ API (ไม่มีเส้นที่กุญแจใช้ไม่ได้)
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM sys_activity_log WHERE company_id = ${companyId} AND action IN ('API_KEY_CREATE', 'API_KEY_REVOKE')`.execute(database.db)).rows[0]!.n).toBeGreaterThanOrEqual(4);
    const docs = (await call('GET', '/api/v1/api-docs')).body.rows.map((r: { method: string; path: string }) => `${r.method} ${r.path}`);
    expect(docs).toEqual(expect.arrayContaining(['GET /api/v1/customers', 'POST /api/v1/gl/journals', 'GET /api/v1/auth/me']));
    expect(docs.some((d: string) => /\/users|\/api-keys|\/backup|auth\/select/.test(d))).toBe(false);
  });
  it('e-Tax Invoice XML (T7.6 ETDA ขมธอ. 3-2560): check list, single XML, zip, credit note vs original excl. VAT, cancelled skipped, isolation', async () => {
    const typeOf = async (cls: string) => (await call('GET', `/api/v1/trade-defaults/${cls}`)).body.types[0].id as string;
    const ivType = (await call('GET', '/api/v1/trade-defaults/IV')).body.types.find((t: { code: string }) => t.code === 'IV').id;
    const unit = (await call('GET', '/api/v1/lookups?types=UNIT')).body.UNIT[0].id;
    const [w1] = (await call('GET', '/api/v1/lookups?types=WH')).body.WH.map((w: { id: string }) => w.id);
    const item = (await call('POST', '/api/v1/items', { code: '02-TEST-000091', name_th: 'สินค้า e-Tax', base_unit_id: unit, std_cost: '1' })).body.id;
    const cus = (await call('POST', '/api/v1/customers', { code: 'ETX1', name: 'บริษัท ผู้ซื้อ จำกัด', tax_id: '0105537095903', tax_branch_no: '1', address_1: '1 ถนนสุขุมวิท', address_2: 'กรุงเทพฯ', zip_code: '10110' })).body.id;
    const saved = (await sql<{ tax_id: string | null; address_th: string | null }>`SELECT tax_id, address_th FROM sys_company WHERE id = ${companyId}`.execute(database.db)).rows[0]!;
    await sql`UPDATE sys_company SET tax_id = '0105537095903', address_th = NULL WHERE id = ${companyId}`.execute(database.db);
    // ราคารวม VAT 7%: 2 × 535 = 1,070 → ฐาน 1,000 VAT 70
    const iv = (await call('POST', '/api/v1/sales-invoices', { doc_type_id: ivType, doc_date: '2027-12-05', party_id: cus, price_type: '1', vat_rate: 7, warehouse_id: w1, your_ref: 'PO-77', lines: [{ item_id: item, qty: 2, unit_price: 535 }] })).body;
    const cn = (await call('POST', '/api/v1/ar-credit-notes', { doc_type_id: await typeOf('CN'), doc_date: '2027-12-06', party_id: cus, ref_header_id: iv.id, price_type: '1', vat_rate: 7, remark: 'ลดราคาตามข้อตกลง', lines: [{ item_id: item, qty: 1, unit_price: 107 }] })).body;
    const list = async () => (await call('GET', '/api/v1/etax/docs?from=2027-12-01&to=2027-12-31')).body.rows as Array<{ id: string; doc_no: string; type_code: string; purpose_code: string | null; errors: string[] }>;
    let rows = await list();
    expect(rows.map((r) => `${r.doc_no}:${r.type_code}`)).toEqual([`${iv.doc_no}:T02`, `${cn.doc_no}:81`]);
    expect(rows[0]!.errors.some((e) => /ที่อยู่กิจการ/.test(e))).toBe(true);
    expect((await call('GET', `/api/v1/etax/doc/${iv.id}`)).body.error.message).toMatch(/ที่อยู่กิจการ/);
    await sql`UPDATE sys_company SET address_th = '99 ถนนพระราม 4 เขตบางรัก กรุงเทพมหานคร 10500' WHERE id = ${companyId}`.execute(database.db);
    rows = await list();
    expect(rows.map((r) => r.errors)).toEqual([[], []]);
    expect(rows[1]!.purpose_code).toBe('CDNG99');
    const x = (await call('GET', `/api/v1/etax/doc/${iv.id}?iv_type=T04`)).body as string;
    for (const part of ['<rsm:TaxInvoice_CrossIndustryInvoice', '<ram:TypeCode>T04</ram:TypeCode>', `<ram:ID>${iv.doc_no}</ram:ID>`, 'schemeID="TXID">010553709590300001', '<ram:PostcodeCode>10110',
      'BasisAmount currencyID="THB">1000.00', 'CalculatedAmount currencyID="THB">70.00', 'GrandTotalAmount currencyID="THB">1070.00', 'ChargeAmount currencyID="THB">500.00', 'NetLineTotalAmount currencyID="THB">1000.00', '<ram:IssuerAssignedID>PO-77'])
      expect(x, part).toContain(part);
    const c = (await call('GET', `/api/v1/etax/doc/${cn.id}`)).body as string;
    for (const part of ['<rsm:DebitCreditNote_CrossIndustryInvoice', '<ram:PurposeCode>CDNG99', '<ram:Purpose>ลดราคาตามข้อตกลง', `<ram:IssuerAssignedID>${iv.doc_no}`, '<ram:ReferenceTypeCode>T02',
      'OriginalInformationAmount currencyID="THB">1000.00', 'LineTotalAmount currencyID="THB">900.00', 'DifferenceInformationAmount currencyID="THB">100.00', 'TaxTotalAmount currencyID="THB">7.00', 'GrandTotalAmount currencyID="THB">107.00'])
      expect(c, part).toContain(part);
    // พิมพ์ใบลดหนี้: มูลค่าไม่รวม VAT แม้ราคารวม VAT
    expect((await call('GET', `/api/v1/print/doc/${cn.id}`)).body.data.totals.slice(0, 3).map((t: { value: string }) => t.value)).toEqual(['1000.00', '900.00', '100.00']);
    // zip: แฟ้มละฉบับ + สรุป.csv
    const z = await app.inject({ method: 'GET', url: '/api/v1/etax/export?from=2027-12-01&to=2027-12-31', headers: { cookie } });
    expect([z.statusCode, z.headers['content-type'], z.rawPayload.readUInt32LE(0)]).toEqual([200, 'application/zip', 0x04034b50]);
    const names = z.rawPayload.toString('utf8');
    expect([names.includes(`T02_${iv.doc_no}.xml`), names.includes(`81_${cn.doc_no}.xml`), names.includes('สรุป.csv')]).toEqual([true, true, true]);
    // ยกเลิกแล้วไม่ส่งออก · บริษัทอื่นเปิดไม่ได้
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('GET', `/api/v1/etax/doc/${iv.id}`)).status).toBe(404);
    expect((await call('GET', '/api/v1/etax/docs?from=2027-12-01&to=2027-12-31')).body.rows).toEqual([]);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    for (const [path, d] of [['ar-credit-notes', cn], ['sales-invoices', iv]] as const) expect((await call('POST', `/api/v1/${path}/${d.id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
    expect(await list()).toEqual([]);
    expect((await call('GET', '/api/v1/etax/export?from=2027-12-01&to=2027-12-31')).body.error.message).toMatch(/ไม่มีเอกสารขาย/);
    await sql`UPDATE sys_company SET tax_id = ${saved.tax_id}, address_th = ${saved.address_th} WHERE id = ${companyId}`.execute(database.db);
  });
  it('AI bill reading (T7.7): encrypted key, Claude request shape, supplier/item matching, cost cap, errors, permissions, isolation (fake client — no real API)', async () => {
    process.env.BUDDY_SECRET_KEY = Buffer.alloc(32, 7).toString('base64');
    const raw = { doc_kind: 'tax_invoice', supplier: { name: 'บริษัท ขายส่ง จำกัด', tax_id: '0105537095903', branch_no: '00000', address: '1 ถนนพระราม 4 กรุงเทพฯ 10500' },
      doc_no: 'INV-9001', doc_date: '2027-12-15', price_type: 'excl_vat', vat_rate: '7',
      lines: [{ description: 'กระดาษ A4 ทดสอบ AI', qty: '10', unit: 'รีม', unit_price: '120', amount: '1200' }, { description: 'ค่าขนส่งทดสอบ AI', qty: '1', unit: null, unit_price: '100', amount: '100' }],
      subtotal: '1300', discount: null, vat_amount: '91', total: '1391', notes: [] };
    const sent: Array<Record<string, any>> = [];
    let next: () => unknown = () => ({ model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { input_tokens: 3000, output_tokens: 800 }, parsed_output: raw });
    // การเรียกครั้งที่ 2 (แนะนำรหัส): ค่าเริ่มต้นแนะนำกระดาษ A4 และไม่มีรหัสค่าขนส่ง
    let suggestOut: unknown = { lines: [{ index: 0, code: '02-TEST-000095', confidence: 'high', reason: 'ชื่อตรงกับรหัสสินค้า' }, { index: 1, code: null, confidence: 'low', reason: 'ไม่มีรหัสค่าขนส่ง' }] };
    setAiClientFactory((apiKey) => ({ beta: { messages: { parse: async (params: Record<string, any>) => {
      sent.push({ ...params, apiKey });
      if (String(params.system).includes('เลือกรหัส')) return { model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 200 }, parsed_output: suggestOut };
      return next();
    } } } }) as never);
    const img = Buffer.from('fake-image-bytes').toString('base64');
    const read = (target: string, body: object = {}) => call('POST', '/api/v1/ai/read-bill', { target, file_name: 'bill.jpg', media_type: 'image/jpeg', data: img, ...body });
    expect((await call('GET', '/api/v1/ai/status')).body).toMatchObject({ has_key: false, available: false });
    expect((await read('purchase-invoices')).body.error.message).toMatch(/ยังไม่ได้ตั้งค่า AI/);
    expect((await call('PUT', '/api/v1/ai/config', { api_key: 'not-a-key', monthly_limit_usd: 20 })).body.error.message).toMatch(/sk-ant-/);
    const key = 'sk-ant-api03-TESTKEY_' + 'x'.repeat(30) + 'ab12';
    expect((await call('PUT', '/api/v1/ai/config', { api_key: key, monthly_limit_usd: 20 })).body).toMatchObject({ has_key: true, key_hint: '…ab12', monthly_limit_usd: 20 });
    const enc = (await sql<{ value_enc: string }>`SELECT value_enc FROM sys_secret WHERE company_id = ${companyId} AND deleted_at IS NULL`.execute(database.db)).rows[0]!.value_enc;
    expect(enc.includes('TESTKEY')).toBe(false);
    expect(JSON.stringify((await call('GET', '/api/v1/ai/config')).body).includes('TESTKEY')).toBe(false);

    const unit = (await call('GET', '/api/v1/lookups?types=UNIT')).body.UNIT[0].id;
    const item = (await call('POST', '/api/v1/items', { code: '02-TEST-000095', name_th: 'กระดาษ A4 ทดสอบ AI', base_unit_id: unit, std_cost: '1' })).body.id;
    const sup = (await call('POST', '/api/v1/suppliers', { code: 'S-AI1', name: 'บริษัท ขายส่ง จำกัด', tax_id: '0105537095903', tax_branch_no: '0' })).body.id;
    expect([item, sup].every(Boolean)).toBe(true);
    await call('PUT', '/api/v1/ai/config', { monthly_limit_usd: 20, business_type: 'trading', guidance: 'ค่าขนส่งสินค้าเข้า ลงรหัสค่าขนส่ง' });
    const r = await read('purchase-invoices');
    expect(r.status).toBe(200);
    expect(r.body.supplier_check).toMatchObject({ status: 'match' });
    expect(r.body.supplier_check.message).toMatch(/S-AI1/);
    expect(r.body.lines[0].suggestion).toMatchObject({ source: 'ai', confidence: 'high', item: { code: '02-TEST-000095' } });
    expect(r.body.lines[1]).toMatchObject({ suggestion: null, note: 'ไม่มีรหัสที่เหมาะ: ไม่มีรหัสค่าขนส่ง' });
    const sq = sent.at(-1)!;   // คำขอแนะนำรหัส: ข้อมูลบริษัทนี้ + ไม่มีรูป (ข้อความล้วน)
    expect([sq.output_config.effort, typeof sq.messages[0].content]).toEqual(['low', 'string']);
    for (const part of ['ซื้อมาขายไป', 'ค่าขนส่งสินค้าเข้า ลงรหัสค่าขนส่ง', '02-TEST-000095', 'S-AI1'.length ? 'บริษัท ขายส่ง จำกัด' : '']) expect(sq.messages[0].content).toContain(part);
    expect(r.body.supplier).toMatchObject({ id: sup, code: 'S-AI1' });
    expect(r.body.lines.map((l: { item: { id: string } | null }) => l.item?.id ?? null)).toEqual([item, null]);
    expect(r.body.bill).toMatchObject({ price_type: '2', vat_rate: '7', doc_no: 'INV-9001', doc_date: '2027-12-15', total: '1391.00', warnings: [] });
    expect(r.body.usage).toMatchObject({ cost_usd: '0.0360', monthly_limit_usd: 20 });   // อ่านบิล 0.028 + แนะนำรหัส 0.008
    // คำขอที่ส่งให้ Claude: รุ่น/fallback/โครงข้อมูล/รูปแบบแฟ้ม และกุญแจของบริษัท
    const q = sent.at(-2)!;
    expect([q.apiKey, q.model, q.fallbacks, q.betas[0], q.output_config.effort, q.output_config.format.type]).toEqual([key, 'claude-opus-5-5', 'default', 'server-side-fallback-2026-07-01', 'medium', 'json_schema']);
    expect(q.messages[0].content[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img } });
    // ประวัติ: บันทึกค่าใช้จ่ายที่ยืนยันแล้ว → ครั้งต่อไปแนะนำรหัสเดิม (แม้ AI ไม่เลือก) · รหัสที่ AI ตอบแต่ไม่มีจริงถูกตัดทิ้ง
    const freight = (await call('POST', '/api/v1/other-expenses', { code: '95-7300-91', name_th: 'ค่าขนส่งรายเดือน', accounts: { expense } })).body.id;
    const oeType = (await call('GET', '/api/v1/trade-defaults/OE')).body.types[0].id;
    const oe = (await call('POST', '/api/v1/other-expense-docs', { doc_type_id: oeType, doc_date: '2027-12-01', party_id: sup, price_type: '2', vat_rate: 7, lines: [{ item_id: freight, description: 'ค่าขนส่งทดสอบ AI', amount: 100 }] })).body;
    expect(oe.id).toBeTruthy();
    suggestOut = { lines: [{ index: 0, code: 'NOPE-404', confidence: 'high', reason: 'เดา' }, { index: 1, code: null, confidence: 'low', reason: '' }] };
    const r2 = await read('other-expense-docs', { media_type: 'application/pdf', file_name: 'bill.pdf' });
    expect(sent.at(-2)!.messages[0].content[0].type).toBe('document');
    expect(r2.body.lines[0].suggestion).toBeNull();   // กระดาษ A4 เป็นสินค้า ไม่ใช่รหัสค่าใช้จ่าย และรหัส NOPE-404 ไม่มีจริง
    expect(r2.body.lines[1].suggestion).toMatchObject({ source: 'history', item: { id: freight, code: '95-7300-91' } });
    expect(r2.body.lines[1].suggestion.reason).toMatch(/เคยลงรหัสนี้ 1 ครั้ง \(กับผู้จำหน่ายนี้ 1 ครั้ง\)/);
    // บิลซ้ำ: เลขที่บิลเดียวกันของผู้จำหน่ายนี้ถูกบันทึกแล้ว
    await call('PUT', `/api/v1/other-expense-docs/${oe.id}`, { doc_type_id: oeType, doc_date: '2027-12-01', party_id: sup, ref_no: 'INV-9001', ref_date: '2027-12-15', price_type: '2', vat_rate: 7, lines: [{ item_id: freight, description: 'ค่าขนส่งทดสอบ AI', amount: 100 }] });
    expect((await read('purchase-invoices')).body.duplicate).toMatchObject({ doc_no: oe.doc_no });
    expect((await call('POST', `/api/v1/other-expense-docs/${oe.id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
    // ชื่อคล้ายแต่เลขผู้เสียภาษีในบิลไม่ตรงกับแฟ้ม
    next = () => ({ model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { input_tokens: 3000, output_tokens: 800 }, parsed_output: { ...raw, supplier: { ...raw.supplier, tax_id: '0105537095911' } } });
    const r3 = await read('purchase-invoices');
    expect([r3.body.supplier, r3.body.supplier_check.status, r3.body.supplier_check.candidate?.code]).toEqual([null, 'tax_mismatch', 'S-AI1']);
    next = () => ({ model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { input_tokens: 3000, output_tokens: 800 }, parsed_output: raw });
    // บันทึกค่าใช้จ่าย → เพดาน (นับเฉพาะการอ่านบิล · ค่าใช้จ่ายรวมทั้ง 2 ขั้น)
    expect((await call('GET', '/api/v1/ai/config')).body).toMatchObject({ month_cost_usd: '0.1440', month_count: 4, business_type: 'trading' });
    await call('PUT', '/api/v1/ai/config', { monthly_limit_usd: 0.14 });
    expect((await call('GET', '/api/v1/ai/status')).body.available).toBe(false);
    expect((await read('purchase-invoices')).body.error.message).toMatch(/ครบเพดาน 0.14/);
    await call('PUT', '/api/v1/ai/config', { monthly_limit_usd: null });
    expect((await call('GET', '/api/v1/ai/config')).body).toMatchObject({ has_key: true, monthly_limit_usd: null, available: true });
    // ผิดพลาด/ปฏิเสธ → บันทึกการใช้ ไม่เติมร่าง
    next = () => { throw new Error('ECONNRESET'); };
    expect((await read('purchase-invoices')).body.error.message).toMatch(/เชื่อมต่อ Anthropic ไม่ได้/);
    next = () => ({ model: 'claude-opus-5-5', stop_reason: 'refusal', usage: { input_tokens: 100, output_tokens: 0 }, parsed_output: null });
    expect((await read('purchase-invoices')).status).toBe(422);
    expect((await call('GET', '/api/v1/ai/usage')).body.map((u: { status: string }) => u.status).slice(0, 2)).toEqual(['REFUSED', 'ERROR']);
    expect((await call('PUT', '/api/v1/ai/config', { monthly_limit_usd: null, business_type: 'bogus' })).status).toBe(400);
    expect((await read('sales-invoices')).status).toBe(400);   // อ่านบิลได้เฉพาะเอกสารซื้อ
    // สิทธิ์: พนักงานระดับ 0 ตั้งค่า/ดูการใช้ไม่ได้ แต่เห็นสถานะ · กุญแจ API ของระบบอื่นใช้หน้าตั้งค่าไม่ได้
    const admin = cookie;
    cookie = ''; await call('POST', '/api/v1/auth/login', { username: 'clerk0', password: 'clerk0pass' });
    expect((await call('GET', '/api/v1/ai/config')).status).toBe(403);
    expect((await call('GET', '/api/v1/ai/status')).body.has_key).toBe(true);
    cookie = admin;
    // บริษัทอื่น: ไม่มีกุญแจ ไม่เห็นการใช้
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('GET', '/api/v1/ai/config')).body).toMatchObject({ has_key: false, month_count: 0 });
    expect((await call('GET', '/api/v1/ai/usage')).body).toEqual([]);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    expect((await call('PUT', '/api/v1/ai/config', { api_key: null, monthly_limit_usd: 20 })).body.has_key).toBe(false);
  });
  it('menu move: ธนาคาร and ภาษี become top-level menus; rights set on การเงิน carry over (nobody gains access)', async () => {
    const id = async (code: string) => (await sql<{ id: string; parent_id: string | null }>`SELECT id, parent_id FROM sys_menu WHERE code = ${code} AND deleted_at IS NULL`.execute(database.db)).rows[0];
    const fi = (await id('FI'))!.id;
    expect([(await id('FI.BK'))!.parent_id, (await id('FI.VAT'))!.parent_id === (await id('TX'))!.id]).toEqual([null, true]);
    // จำลองโครงเดิม: ธนาคาร/ภาษีอยู่ใต้ การเงิน และยังไม่มีเมนู ภาษี
    await sql`UPDATE sys_menu SET parent_id = ${fi} WHERE code IN ('FI.BK', 'FI.VAT', 'FI.WHT')`.execute(database.db);
    await sql`UPDATE sys_menu SET deleted_at = now(), code = code || '-old' WHERE code IN ('TX', 'TX.WHT')`.execute(database.db);
    const tenant_id = (await call('GET', '/api/v1/tenants')).body.find((t: { code: string }) => t.code === 'DEFAULT').id;
    const grp = (await call('POST', '/api/v1/user-groups', { code: 'NOFIN', name: 'ห้ามการเงิน', tenant_id })).body.id;
    await sql`INSERT INTO sys_permission (company_id, subject_type, subject_id, menu_id, can_read, can_add, can_edit, can_cancel, can_delete, can_print, can_approve)
      VALUES (${companyId}, 'G', ${grp}, ${fi}, 'N', 'N', 'N', 'N', 'N', 'N', 'N')`.execute(database.db);
    await syncMenus(database.db);
    const tx = (await id('TX'))!;
    expect([(await id('FI.BK'))!.parent_id, tx.parent_id, (await id('FI.VAT'))!.parent_id, (await id('FI.WHT'))!.parent_id === (await id('TX.WHT'))!.id]).toEqual([null, null, tx.id, true]);
    const rows = (await sql<{ code: string; can_read: string }>`SELECT m.code, p.can_read FROM sys_permission p JOIN sys_menu m ON m.id = p.menu_id
      WHERE p.subject_id = ${grp} AND p.deleted_at IS NULL ORDER BY m.code`.execute(database.db)).rows;
    expect(rows.map((r) => `${r.code}:${r.can_read}`)).toEqual(expect.arrayContaining(['FI:N', 'FI.BK:N', 'TX:N']));
    // ซิงก์ซ้ำไม่คัดลอกอีก
    await syncMenus(database.db);
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM sys_permission WHERE subject_id = ${grp} AND deleted_at IS NULL`.execute(database.db)).rows[0]!.n).toBe(rows.length);
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
    const aCus = (await call('POST', '/api/v1/customers', { code: 'A-C1', name: 'ลูกค้าของ A', tax_id: tid(7) })).body.id;
    expect(aCus).toBeTruthy();
    // กุญแจ API (T7.5): ลูกค้า A ผูกผู้ใช้ของลูกค้าอื่นไม่ได้ · กุญแจของ A เห็นเฉพาะข้อมูลของ A
    const otherUser = (await sql<{ id: string }>`SELECT id FROM sys_user WHERE username = 'clerk0'`.execute(database.db)).rows[0]!.id;
    expect((await call('POST', '/api/v1/api-keys', { name: 'ข้ามลูกค้า', user_id: otherUser })).status).toBe(404);
    const aKey = (await call('POST', '/api/v1/api-keys', { name: 'ระบบของ A', user_id: (await call('GET', '/api/v1/auth/me')).body.user.id, read_only: true })).body.key as string;
    expect((await keyCall(aKey, 'GET', `/api/v1/customers/${aCus}`)).status).toBe(200);
    expect((await keyCall(aKey, 'GET', '/api/v1/customers?q=C520')).body.rows).toHaveLength(0);
    expect((await keyCall(aKey, 'GET', '/api/v1/auth/me')).body.companies.map((c: { code: string }) => c.code)).toEqual(['A-CO1']);
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

describe('ความปลอดภัยการเข้าระบบ (T0.16)', () => {
  const login = async (u: string, p: string) => { cookie = ''; return call('POST', '/api/v1/auth/login', { username: u, password: p }); };
  let admin = '', demo = '', lockId = '';
  const secRow = (id: string) => database.db.selectFrom('sys_user_security').selectAll().where('user_id', '=', id).executeTakeFirst();

  it('TOTP matches RFC 6238 test vectors', () => {
    const k = Buffer.from('12345678901234567890');
    expect(totpAt(k, stepOf(59_000), 8)).toBe('94287082');
    expect(totpAt(k, stepOf(1_111_111_109_000), 8)).toBe('07081804');
    expect(totpAt(k, stepOf(59_000))).toBe('287082');
  });

  it('enforces the password policy', async () => {
    expect((await login('admin', 'secret123')).status).toBe(200);
    admin = cookie;
    demo = (await call('GET', '/api/v1/auth/me')).body.companies.find((c: { code: string }) => c.code === 'DEMO').id;
    const weak = await call('POST', '/api/v1/users', { username: 'sec.weak', display_name: 'อ่อน', password: 'abcdefgh', companies: [demo] });
    expect(weak.status).toBe(400); expect(JSON.stringify(weak.body)).toMatch(/ตัวอักษรและตัวเลข/);
    expect((await call('POST', '/api/v1/users', { username: 'sec.weak', display_name: 'อ่อน', password: 'ab1', companies: [demo] })).status).toBe(400);
    expect((await call('POST', '/api/v1/auth/password', { old_password: 'secret123', new_password: '12345678' })).status).toBe(400);
    expect((await call('POST', '/api/v1/auth/password', { old_password: 'secret123', new_password: 'secret123' })).body.error.message).toMatch(/ไม่ซ้ำกับรหัสเดิม/);
    const r = await call('POST', '/api/v1/users', { username: 'sec.lock', display_name: 'ทดสอบล็อก', password: 'lockMe123', companies: [demo] });
    expect(r.status).toBe(200); lockId = r.body.id;
    expect((await secRow(lockId))?.password_changed_at).toBeTruthy();
  });

  it('locks the account for 15 minutes after 5 wrong passwords; admin or time unlocks', async () => {
    for (let i = 0; i < 4; i++) expect((await login('sec.lock', 'wrongPass1')).status).toBe(401);
    const r5 = await login('sec.lock', 'wrongPass1');
    expect(r5.status).toBe(423); expect(r5.body.error.code).toBe('ACCOUNT_LOCKED'); expect(r5.body.error.message).toMatch(/ผู้ดูแลระบบปลดล็อก/);
    expect((await login('sec.lock', 'lockMe123')).status).toBe(423);   // รหัสถูกก็เข้าไม่ได้ระหว่างล็อก
    const until = new Date((await secRow(lockId))!.locked_until!).getTime();
    expect(until - Date.now()).toBeGreaterThan(14 * 60_000); expect(until - Date.now()).toBeLessThanOrEqual(15 * 60_000);
    expect((await database.db.selectFrom('sys_activity_log').select('action').where('action', '=', 'LOGIN_LOCKED').where('user_id', '=', lockId).execute()).length).toBe(1);
    cookie = admin;
    expect((await call('GET', '/api/v1/users')).body.users.find((u: { id: string }) => u.id === lockId).locked_until).toBeTruthy();
    expect((await call('POST', `/api/v1/users/${lockId}/unlock`)).status).toBe(200);
    expect((await call('GET', '/api/v1/users')).body.users.find((u: { id: string }) => u.id === lockId).locked_until).toBeNull();
    expect((await login('sec.lock', 'lockMe123')).status).toBe(200);
    // ผิด 4 แล้วถูก = เริ่มนับใหม่
    for (let i = 0; i < 4; i++) await login('sec.lock', 'wrongPass1');
    expect((await login('sec.lock', 'lockMe123')).status).toBe(200);
    expect((await login('sec.lock', 'wrongPass1')).status).toBe(401);
    // ล็อกครบเวลาแล้วเข้าได้เอง
    for (let i = 0; i < 4; i++) await login('sec.lock', 'wrongPass1');
    expect((await login('sec.lock', 'lockMe123')).status).toBe(423);
    await database.db.updateTable('sys_user_security').set({ locked_until: new Date(Date.now() - 60_000).toISOString() }).where('user_id', '=', lockId).execute();
    expect((await login('sec.lock', 'lockMe123')).status).toBe(200);
    // ผู้ใช้ทั่วไปปลดล็อกคนอื่นไม่ได้
    expect((await call('POST', `/api/v1/users/${lockId}/unlock`)).status).toBe(403);
  });

  it('two-factor login: enroll, second step, replay rejected, recovery codes used once', async () => {
    expect((await login('sec.lock', 'lockMe123')).status).toBe(200);
    expect((await call('GET', '/api/v1/auth/2fa')).body).toEqual({ enabled: false, required: false, recovery_left: 0 });
    const s = (await call('POST', '/api/v1/auth/2fa/setup')).body;
    expect(s.otpauth).toMatch(/^otpauth:\/\/totp\/Buddy/); expect(s.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect((await secRow(lockId))?.totp_secret_enc).not.toContain(s.secret);   // เก็บแบบเข้ารหัส
    const key = base32Decode(s.secret);
    const now = stepOf();
    expect((await call('POST', '/api/v1/auth/2fa/enable', { code: 'abc' })).status).toBe(400);
    const en = await call('POST', '/api/v1/auth/2fa/enable', { code: totpAt(key, now) });
    expect(en.status).toBe(200); expect(en.body.recovery_codes).toHaveLength(10);
    expect((await call('POST', '/api/v1/auth/2fa/setup')).status).toBe(400);   // เปิดอยู่แล้ว
    // รหัสผ่านถูก → ยังไม่ได้ session ต้องผ่านขั้นที่ 2
    const r = await login('sec.lock', 'lockMe123');
    expect(r.body).toEqual({ need_totp: true, ticket: expect.any(String) }); expect(cookie).toBe('');
    expect((await call('GET', '/api/v1/auth/me')).status).toBe(401);
    expect((await call('POST', '/api/v1/auth/login/totp', { ticket: r.body.ticket, code: totpAt(key, now) })).status).toBe(401);   // รหัสเดิมใช้ซ้ำไม่ได้
    expect((await call('POST', '/api/v1/auth/login/totp', { ticket: 'x'.repeat(20), code: totpAt(key, now + 1) })).body.error.code).toBe('MFA_EXPIRED');
    expect((await call('POST', '/api/v1/auth/login/totp', { ticket: r.body.ticket, code: totpAt(key, now + 1) })).status).toBe(200);
    expect((await call('GET', '/api/v1/auth/me')).body.user.username).toBe('sec.lock');
    expect((await call('POST', '/api/v1/auth/login/totp', { ticket: r.body.ticket, code: totpAt(key, now + 1) })).status).toBe(401);   // ตั๋วใช้ได้ครั้งเดียว
    // รหัสสำรอง: ใช้ได้ครั้งเดียว (ไม่สนตัวพิมพ์/ขีด)
    const rc = en.body.recovery_codes[0] as string;
    const t2 = (await login('sec.lock', 'lockMe123')).body.ticket;
    expect((await call('POST', '/api/v1/auth/login/totp', { ticket: t2, code: rc.toUpperCase().replace('-', ' ') })).status).toBe(200);
    expect((await call('GET', '/api/v1/auth/2fa')).body).toMatchObject({ enabled: true, recovery_left: 9 });
    const t3 = (await login('sec.lock', 'lockMe123')).body.ticket;
    expect((await call('POST', '/api/v1/auth/login/totp', { ticket: t3, code: rc })).status).toBe(401);
    // รหัสผ่านถูกไม่ล้างตัวนับ — ผิดขั้นที่ 2 สะสมจนล็อก
    for (let i = 0; i < 3; i++) await call('POST', '/api/v1/auth/login/totp', { ticket: t3, code: '000001' });
    const t4 = (await login('sec.lock', 'lockMe123')).body.ticket;
    expect((await call('POST', '/api/v1/auth/login/totp', { ticket: t4, code: '000002' })).status).toBe(423);
    await database.db.updateTable('sys_user_security').set({ locked_until: null }).where('user_id', '=', lockId).execute();
    // สร้างรหัสสำรองใหม่ / ปิด ต้องยืนยันรหัสผ่าน
    const t5 = (await login('sec.lock', 'lockMe123')).body.ticket;
    expect((await call('POST', '/api/v1/auth/login/totp', { ticket: t5, code: en.body.recovery_codes[1] })).status).toBe(200);
    expect((await call('POST', '/api/v1/auth/2fa/recovery', { password: 'nope1234' })).status).toBe(400);
    const nr = await call('POST', '/api/v1/auth/2fa/recovery', { password: 'lockMe123' });
    expect(nr.body.recovery_codes).toHaveLength(10); expect(nr.body.recovery_codes).not.toContain(en.body.recovery_codes[2]);
    expect((await call('POST', '/api/v1/auth/2fa/disable', { password: 'lockMe123' })).status).toBe(200);
    expect((await login('sec.lock', 'lockMe123')).body).toEqual({ ok: true });
    const acts = (await database.db.selectFrom('sys_activity_log').select('action').where('user_id', '=', lockId).execute()).map((x) => x.action);
    expect(acts).toEqual(expect.arrayContaining(['MFA_ENABLE', 'MFA_RECOVERY_USED', 'MFA_RECOVERY_NEW', 'MFA_DISABLE']));
  });

  it('admins must set up two-factor before using anything else; admins reset only their own tenant', async () => {
    process.env.BUDDY_REQUIRE_ADMIN_2FA = '1';
    try {
      expect((await login('b.admin', 'passB1234')).status).toBe(200);
      expect((await call('GET', '/api/v1/auth/me')).body.user.mfa_setup_required).toBe(true);
      const blocked = await call('GET', '/api/v1/users');
      expect(blocked.status).toBe(403); expect(blocked.body.error.code).toBe('MFA_SETUP_REQUIRED');
      expect((await call('GET', '/api/v1/auth/2fa')).body.required).toBe(true);
      const key = base32Decode((await call('POST', '/api/v1/auth/2fa/setup')).body.secret);
      expect((await call('POST', '/api/v1/auth/2fa/enable', { code: totpAt(key, stepOf()) })).status).toBe(200);
      expect((await call('GET', '/api/v1/auth/me')).body.user.mfa_setup_required).toBe(false);
      expect((await call('GET', '/api/v1/users')).status).toBe(200);
      // ผู้ดูแลของลูกค้า B แตะผู้ใช้ของผู้ให้บริการไม่ได้
      expect((await call('POST', `/api/v1/users/${lockId}/unlock`)).status).toBe(404);
      expect((await call('POST', `/api/v1/users/${lockId}/reset-2fa`)).status).toBe(404);
      const bId = (await call('GET', '/api/v1/auth/me')).body.user.id;
      expect((await call('POST', `/api/v1/users/${bId}/reset-2fa`)).status).toBe(400);   // ล้างของตัวเองไม่ได้
      const bCookie = cookie;
      cookie = admin;
      // ผู้ดูแลของผู้ให้บริการเองก็ต้องตั้งก่อน
      expect((await call('POST', `/api/v1/users/${bId}/reset-2fa`)).body.error.code).toBe('MFA_SETUP_REQUIRED');
      // ผู้ให้บริการล้าง 2FA ให้ (มือถือหาย) → session เดิมหมด
      process.env.BUDDY_REQUIRE_ADMIN_2FA = '0';
      expect((await call('POST', `/api/v1/users/${bId}/reset-2fa`)).status).toBe(200);
      cookie = bCookie; expect((await call('GET', '/api/v1/auth/me')).status).toBe(401);
      expect((await login('b.admin', 'passB1234')).body).toEqual({ ok: true });
    } finally { process.env.BUDDY_REQUIRE_ADMIN_2FA = '0'; }
  });
});

describe('นำข้อมูลจาก Express ผ่านหน้าจอ (T0.12) — สิทธิ์และการตรวจ', () => {
  const login = async (u: string, p: string) => { cookie = ''; return call('POST', '/api/v1/auth/login', { username: u, password: p }); };
  const put = async (url: string, body: Buffer) => { const r = await app.inject({ method: 'PUT', url, payload: body, headers: { cookie, 'content-type': 'application/octet-stream' } }); return { status: r.statusCode, body: JSON.parse(r.body) }; };
  it('only admins, only their own tenant, only known .DBF files, required files before run', async () => {
    expect((await login('sec.lock', 'lockMe123')).status).toBe(200);
    expect((await call('POST', '/api/v1/express-import/jobs', { code: 'IMPX' })).status).toBe(403);
    expect((await login('admin', 'secret123')).status).toBe(200);
    expect((await call('POST', '/api/v1/express-import/jobs', { code: 'DEMO' })).body.error.message).toMatch(/มีอยู่แล้ว/);
    expect((await call('POST', '/api/v1/express-import/jobs', { code: 'bad code!' })).status).toBe(400);
    const j = (await call('POST', '/api/v1/express-import/jobs', { code: 'IMPX' })).body;
    expect(j).toMatchObject({ status: 'upload', missing: ['ISINFO', 'ISPRD', 'GLACC', 'ISRUN'] });
    expect((await put(`/api/v1/express-import/jobs/${j.id}/files/EVIL`, Buffer.alloc(64))).body.error.message).toMatch(/ไม่ใช่แฟ้มที่ใช้นำเข้า/);
    expect((await put(`/api/v1/express-import/jobs/${j.id}/files/..%2F..%2Fx`, Buffer.alloc(64))).status).toBe(400);
    expect((await put(`/api/v1/express-import/jobs/${j.id}/files/ISINFO`, Buffer.alloc(8))).status).toBe(400);
    expect((await put(`/api/v1/express-import/jobs/${j.id}/files/isinfo`, Buffer.alloc(64))).body.files).toEqual({ ISINFO: 64 });
    expect((await call('POST', `/api/v1/express-import/jobs/${j.id}/run`)).body.error.message).toMatch(/ISPRD\.DBF, GLACC\.DBF, ISRUN\.DBF/);
    // ผู้ดูแลของลูกค้าอื่นมองไม่เห็นงานนี้
    const admin = cookie;
    expect((await login('b.admin', 'passB1234')).status).toBe(200);
    expect((await call('GET', `/api/v1/express-import/jobs/${j.id}`)).status).toBe(404);
    expect((await put(`/api/v1/express-import/jobs/${j.id}/files/ISPRD`, Buffer.alloc(64))).status).toBe(404);
    expect((await call('DELETE', `/api/v1/express-import/jobs/${j.id}`)).status).toBe(404);
    cookie = admin;
    expect((await call('DELETE', `/api/v1/express-import/jobs/${j.id}`)).status).toBe(200);
    expect((await call('GET', `/api/v1/express-import/jobs/${j.id}`)).status).toBe(404);
  });
});

describe('ข้อมูลส่วนบุคคล PDPA (T0.17)', () => {
  const login = async (u: string, p: string) => { cookie = ''; return call('POST', '/api/v1/auth/login', { username: u, password: p }); };
  const TAX = '0105537095903';
  let tenantId = '', coId = '', cusOld = '', cusNew = '', contactId = '', sup = '';

  it('every personal-data column in the database is in the register (or explicitly not personal)', async () => {
    const { PDPA_REGISTER, PDPA_COLUMN_PATTERN, PDPA_NOT_PERSONAL } = await import('@buddy/core');
    const cols = (await sql<{ t: string; c: string }>`SELECT c.table_name AS t, c.column_name AS c FROM information_schema.columns c JOIN information_schema.tables x ON x.table_name = c.table_name AND x.table_schema = c.table_schema
        WHERE c.table_schema = 'public' AND x.table_type = 'BASE TABLE'`.execute(database.db)).rows;
    const all = new Set(cols.map((r) => `${r.t}.${r.c}`));
    const listed = new Set(PDPA_REGISTER.flatMap((e) => e.columns.map((c) => `${e.table}.${c}`)));
    for (const k of listed) expect(all.has(k), `ทะเบียนอ้างช่องที่ไม่มี: ${k}`).toBe(true);
    const missing = cols.filter((r) => PDPA_COLUMN_PATTERN.test(r.c)).map((r) => `${r.t}.${r.c}`).filter((k) => !listed.has(k) && !(k in PDPA_NOT_PERSONAL));
    expect(missing, 'ช่องข้อมูลบุคคลที่ยังไม่อยู่ในทะเบียน PDPA_REGISTER').toEqual([]);
  });

  it('register, subject search/report, contact erase anytime, full erase only after 5-year retention, request register', async () => {
    expect((await login('admin', 'secret123')).status).toBe(200);
    const t = await call('POST', '/api/v1/tenants', { code: 'CUSTP', name: 'ลูกค้า P', admin_username: 'p.admin', admin_name: 'ผู้ดูแล P', admin_password: 'passP1234', dpa_signed_on: '2026-01-15' });
    expect(t.status).toBe(200); tenantId = t.body.id;
    expect((await call('GET', '/api/v1/tenants')).body.find((x: { code: string }) => x.code === 'CUSTP').dpa_signed_on).toBe('2026-01-15');
    expect((await login('p.admin', 'passP1234')).status).toBe(200);
    coId = (await call('POST', '/api/v1/companies', { code: 'P-CO1', name_th: 'บริษัท พี จำกัด', fiscal_start: '2026-01-01', chart: 'express' })).body.id;
    await call('POST', '/api/v1/auth/select', { company_id: coId });
    const mk = async (code: string, name: string, extra: object = {}) => (await call('POST', '/api/v1/customers', { code, name, tax_id: TAX, address_1: '99 ถนนสุขุมวิท', ...extra })).body.id as string;
    cusOld = await mk('P-OLD', 'นายเก่า ใจดี', { tax_id: tid(10), phone: '081-111-1111', email: 'old@example.com' });
    cusNew = await mk('P-NEW', 'นางใหม่ ใจงาม', { phone: '089-999-9999', email: 'new@example.com', contact: 'คุณแม่บ้าน',
      ship_tos: [{ code: 'H1', address_1: 'บ้านเลขที่ 1', phone: '02-000-0000', contact: 'ยาม' }], contacts: [{ name: 'สมศรี ฝ่ายบัญชี', phone: '086-555-5555', email: 'somsri@example.com', is_primary: true }] });
    expect(cusOld && cusNew).toBeTruthy();
    sup = (await call('POST', '/api/v1/suppliers', { code: 'P-S1', name: 'นายส่งของ', tax_id: TAX, phone: '087-777-7777' })).body.id;
    // เอกสารยกมา: เก่า (พ้น 5 ปี) และใหม่ (ยังต้องเก็บ)
    const ob = { doc_no: 'IV58/0001', doc_date: '2015-06-30', price_type: '2', amount: 1000, vat_rate: 7 };
    expect((await call('POST', '/api/v1/ar-opening', { ...ob, party_id: cusOld })).status).toBe(200);
    expect((await call('POST', '/api/v1/ar-opening', { ...ob, party_id: cusNew, doc_no: 'IV68/0009', doc_date: '2025-12-20' })).status).toBe(200);

    const regR = await call('GET', '/api/v1/pdpa/register');
    expect(regR.status, JSON.stringify(regR.body)).toBe(200);
    const reg = regR.body as Array<{ table: string; erase: string; count: number | null }>;
    expect(reg.find((e) => e.table === 'md_customer' && e.erase === 'CONTACT')!.count).toBe(2);
    expect(reg.find((e) => e.table === 'sys_activity_log')!.erase).toBe('KEEP');
    expect(reg.find((e) => e.table === 'sys_user')!.count).toBeNull();   // ไม่ใช่ข้อมูลรายบริษัท

    expect((await call('GET', '/api/v1/pdpa/subjects?q=x')).status).toBe(400);
    const found = (await call('GET', '/api/v1/pdpa/subjects?q=086-555')).body as Array<{ kind: string; id: string; code: string }>;
    expect(found).toEqual([expect.objectContaining({ kind: 'CONTACT', code: 'P-NEW' })]);
    contactId = found[0]!.id;
    expect((await call('GET', `/api/v1/pdpa/subjects?q=${encodeURIComponent('ใจ')}`)).body.map((r: { code: string }) => r.code).sort()).toEqual(['P-NEW', 'P-OLD']);

    const repR = await call('GET', `/api/v1/pdpa/subjects/CUSTOMER/${cusNew}`);
    expect(repR.status, JSON.stringify(repR.body)).toBe(200);
    const rep = repR.body;
    expect(rep.master).toMatchObject({ code: 'P-NEW', phone: '089-999-9999', email: 'new@example.com', tax_id: TAX });
    expect(rep.contacts).toHaveLength(1); expect(rep.ship_to).toHaveLength(1);
    expect(rep.documents).toMatchObject({ count: 1, last_date: '2025-12-20' });
    expect(rep.retention).toEqual({ last_activity: '2025-12-20', retain_until: '2030-12-31', full_erase_allowed: false });
    const acc = await call('POST', `/api/v1/pdpa/subjects/CUSTOMER/${cusNew}/access`, { received_on: '2026-10-01' });
    expect(acc.status).toBe(200); expect(acc.body.report.master.code).toBe('P-NEW');

    // ยังต้องเก็บเอกสาร → ปิดบังทั้งหมดไม่ได้ · ข้อมูลติดต่อลบได้ (ยืนยันด้วยรหัส)
    const full = await call('POST', `/api/v1/pdpa/subjects/CUSTOMER/${cusNew}/erase`, { mode: 'FULL', received_on: '2026-10-02', confirm: 'P-NEW' });
    expect(full.status).toBe(400); expect(full.body.error.message).toMatch(/เก็บเอกสารถึง 31\/12\/2573/);
    expect((await call('POST', `/api/v1/pdpa/subjects/CUSTOMER/${cusNew}/erase`, { mode: 'CONTACT', received_on: '2026-10-02', confirm: 'P-XXX' })).body.error.message).toMatch(/ป้อนรหัส P-NEW/);
    const ec = await call('POST', `/api/v1/pdpa/subjects/CUSTOMER/${cusNew}/erase`, { mode: 'CONTACT', received_on: '2026-10-02', confirm: 'p-new' });
    expect(ec.status).toBe(200);
    const after = (await call('GET', `/api/v1/customers/${cusNew}`)).body;
    expect(after).toMatchObject({ name: 'นางใหม่ ใจงาม', tax_id: TAX, address_1: '99 ถนนสุขุมวิท', phone: null, email: null, contact: null });
    expect(after.contacts).toHaveLength(0);
    expect(after.ship_tos[0]).toMatchObject({ address_1: 'บ้านเลขที่ 1', phone: null, contact: null });
    const raw = (await sql<{ j: string }>`SELECT json_agg(x)::text AS j FROM md_party_contact x WHERE party_id = ${cusNew}`.execute(database.db)).rows[0]!.j;
    expect(raw).not.toContain('086-555'); expect(raw).not.toContain('somsri');
    expect((await call('GET', '/api/v1/pdpa/subjects?q=086-555')).body).toHaveLength(0);

    // พ้นระยะเก็บแล้ว → ปิดบังชื่อ ที่อยู่ เลขผู้เสียภาษี ทั้งแฟ้มหลักและเอกสาร
    expect((await call('GET', `/api/v1/pdpa/subjects/CUSTOMER/${cusOld}`)).body.retention).toMatchObject({ retain_until: '2020-12-31', full_erase_allowed: true });
    const ef = await call('POST', `/api/v1/pdpa/subjects/CUSTOMER/${cusOld}/erase`, { mode: 'FULL', received_on: '2026-10-03', confirm: 'P-OLD' });
    expect(ef.status).toBe(200); expect(ef.body.rows.doc_header).toBe(1);
    const old = (await call('GET', `/api/v1/customers/${cusOld}`)).body;
    expect(old).toMatchObject({ code: 'P-OLD', name: 'ลบตาม PDPA', tax_id: null, address_1: null, phone: null, email: null, status: 'I' });
    const doc = (await sql<{ party_name: string; party_tax_id: string | null; party_address: string | null; net_amount: string }>`SELECT party_name, party_tax_id, party_address, net_amount FROM doc_header WHERE customer_id = ${cusOld}`.execute(database.db)).rows[0]!;
    expect(doc).toEqual({ party_name: 'ลบตาม PDPA', party_tax_id: null, party_address: null, net_amount: '1070.00' });   // ยอดเงินไม่เปลี่ยน
    // ผู้จำหน่ายที่ไม่มีเอกสาร = ปิดบังได้ทันที
    expect((await call('POST', `/api/v1/pdpa/subjects/SUPPLIER/${sup}/erase`, { mode: 'FULL', received_on: '2026-10-03', confirm: 'P-S1' })).status).toBe(200);
    expect((await call('GET', `/api/v1/suppliers/${sup}`)).body).toMatchObject({ name: 'ลบตาม PDPA', phone: null, tax_id: null });

    // ทะเบียนคำขอ: ปฏิเสธต้องมีเหตุผล · log ไม่เก็บค่าที่ลบ
    expect((await call('POST', '/api/v1/pdpa/requests', { request_type: 'ERASE', subject_type: 'CUSTOMER', subject_id: cusNew, received_on: '2026-10-02', status: 'R' })).body.error.message).toMatch(/ต้องระบุเหตุผล/);
    expect((await call('POST', '/api/v1/pdpa/requests', { request_type: 'ERASE', subject_type: 'CUSTOMER', subject_id: cusNew, received_on: '2026-10-02', status: 'R', reason: 'ต้องเก็บเอกสารภาษีถึง 31/12/2573' })).status).toBe(200);
    const open = (await call('POST', '/api/v1/pdpa/requests', { request_type: 'OBJECT', subject_type: 'CUSTOMER', subject_id: cusNew, received_on: '2026-10-04', status: 'O' })).body.id;
    expect((await call('PUT', `/api/v1/pdpa/requests/${open}`, { status: 'D' })).status).toBe(200);
    expect((await call('PUT', `/api/v1/pdpa/requests/${open}`, { status: 'D' })).status).toBe(400);
    const reqs = (await call('GET', '/api/v1/pdpa/requests')).body as Array<{ request_type: string; status: string; subject_code: string; erase_mode: string | null }>;
    expect(reqs.map((r) => `${r.request_type}/${r.status}/${r.subject_code}/${r.erase_mode ?? ''}`).sort()).toEqual(['ACCESS/D/P-NEW/', 'ERASE/D/P-NEW/CONTACT', 'ERASE/D/P-OLD/FULL', 'ERASE/D/P-S1/FULL', 'ERASE/R/P-NEW/', 'OBJECT/D/P-NEW/']);
    const logs = (await sql<{ j: string }>`SELECT json_agg(detail)::text AS j FROM sys_activity_log WHERE company_id = ${coId} AND action LIKE 'PDPA%'`.execute(database.db)).rows[0]!.j;
    expect(logs).not.toContain('089-999'); expect(logs).not.toContain('นายเก่า');

    // ผู้ใช้ระดับต่ำกว่า 9 ใช้ไม่ได้ · ข้ามลูกค้าไม่ได้
    expect((await call('POST', '/api/v1/users', { username: 'p.clerk', display_name: 'พนักงาน P', password: 'clerk1234', approval_level: 8, companies: [coId] })).status).toBe(200);
    expect((await login('p.clerk', 'clerk1234')).status).toBe(200);
    await call('POST', '/api/v1/auth/select', { company_id: coId });
    expect((await call('GET', '/api/v1/pdpa/register')).status).toBe(403);
    expect((await login('b.admin', 'passB1234')).status).toBe(200);
    const bCo = (await call('GET', '/api/v1/auth/me')).body.companies[0].id;
    await call('POST', '/api/v1/auth/select', { company_id: bCo });
    expect((await call('GET', `/api/v1/pdpa/subjects/CUSTOMER/${cusNew}`)).status).toBe(404);
    expect((await call('POST', `/api/v1/pdpa/subjects/CUSTOMER/${cusNew}/erase`, { mode: 'CONTACT', received_on: '2026-10-02', confirm: 'P-NEW' })).status).toBe(404);
    expect((await call('POST', `/api/v1/pdpa/subjects/CONTACT/${contactId}/access`, { received_on: '2026-10-02' })).status).toBe(404);
    expect((await call('GET', '/api/v1/pdpa/subjects?q=P-NEW')).body).toHaveLength(0);
    expect((await call('GET', '/api/v1/pdpa/requests')).body).toHaveLength(0);
    expect((await call('POST', `/api/v1/tenants/${tenantId}/purge`, { confirm: 'CUSTP' })).status).toBe(403);
  });

  it('end of service: status I starts 90 days, then the platform purges every company of the tenant (logs kept)', async () => {
    expect((await login('admin', 'secret123')).status).toBe(200);
    const otherCustomers = (await sql<{ n: number }>`SELECT count(*)::int AS n FROM md_customer WHERE company_id <> ${coId}`.execute(database.db)).rows[0]!.n;
    expect((await call('POST', `/api/v1/tenants/${tenantId}/purge`, { confirm: 'CUSTP' })).body.error.message).toMatch(/เลิกใช้/);
    expect((await call('PUT', `/api/v1/tenants/${tenantId}`, { code: 'CUSTP', name: 'ลูกค้า P', status: 'I' })).status).toBe(200);
    const t = (await call('GET', '/api/v1/tenants')).body.find((x: { code: string }) => x.code === 'CUSTP');
    expect(t.terminated_on).toBeTruthy(); expect(t.purge_after > t.terminated_on).toBe(true);
    expect((await call('POST', `/api/v1/tenants/${tenantId}/purge`, { confirm: 'CUSTP' })).body.error.message).toMatch(/ลบได้ตั้งแต่วันที่/);
    expect((await login('p.admin', 'passP1234')).status).toBe(403);   // เลิกใช้แล้วเข้าระบบไม่ได้
    expect((await login('admin', 'secret123')).status).toBe(200);
    await sql`UPDATE sys_tenant SET purge_after = current_date - 1 WHERE id = ${tenantId}`.execute(database.db);   // จำลองครบ 90 วัน
    expect((await call('POST', `/api/v1/tenants/${tenantId}/purge`, { confirm: 'WRONG' })).body.error.message).toMatch(/พิมพ์รหัสลูกค้า CUSTP/);
    const logsBefore = (await sql<{ n: number }>`SELECT count(*)::int AS n FROM sys_activity_log WHERE company_id = ${coId}`.execute(database.db)).rows[0]!.n;
    const p = await call('POST', `/api/v1/tenants/${tenantId}/purge`, { confirm: 'custp' });
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ companies: 1, users: 2 });
    expect(p.body.rows.md_customer).toBe(2); expect(p.body.rows.doc_header).toBe(2);
    for (const tbl of ['md_customer', 'md_supplier', 'doc_header', 'gl_account', 'gl_journal', 'sys_pdpa_request', 'md_party_contact'])
      expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM ${sql.id(tbl)} WHERE company_id = ${coId}`.execute(database.db)).rows[0]!.n, tbl).toBe(0);
    const co = (await sql<{ name_th: string; tax_id: string | null; deleted: boolean }>`SELECT name_th, tax_id, deleted_at IS NOT NULL AS deleted FROM sys_company WHERE id = ${coId}`.execute(database.db)).rows[0]!;
    expect(co).toEqual({ name_th: 'ลบตาม PDPA (P-CO1)', tax_id: null, deleted: true });
    const us = (await sql<{ username: string; display_name: string; password_hash: string | null }>`SELECT username, display_name, password_hash FROM sys_user WHERE tenant_id = ${tenantId}`.execute(database.db)).rows;
    expect(us).toHaveLength(2);
    for (const u of us) { expect(u.username).toMatch(/^purged_/); expect(u.display_name).toBe('ลบตาม PDPA'); expect(u.password_hash).toBeNull(); }
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM sys_activity_log WHERE company_id = ${coId}`.execute(database.db)).rows[0]!.n).toBeGreaterThanOrEqual(logsBefore);
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM md_customer WHERE company_id <> ${coId}`.execute(database.db)).rows[0]!.n).toBe(otherCustomers);   // ลูกค้ารายอื่นไม่กระทบ
    const tt = (await call('GET', '/api/v1/tenants')).body.find((x: { code: string }) => x.code === 'CUSTP');
    expect(tt).toMatchObject({ name: 'CUSTP', contact_email: null, status: 'I' }); expect(tt.purged_at).toBeTruthy();
    expect((await call('PUT', `/api/v1/tenants/${tenantId}`, { code: 'CUSTP', name: 'x', status: 'A' })).body.error.message).toMatch(/ลบข้อมูลของลูกค้ารายนี้ไปแล้ว/);
    expect((await call('POST', `/api/v1/tenants/${tenantId}/purge`, { confirm: 'CUSTP' })).body.error.message).toMatch(/ไปแล้ว/);
    expect((await login('p.admin', 'passP1234')).status).toBe(401);
    expect((await login('admin', 'secret123')).status).toBe(200);
    expect((await call('GET', '/api/v1/auth/me')).body.companies.map((c: { code: string }) => c.code)).not.toContain('P-CO1');
  });
});

describe('ย้ายลูกค้าไปเซิร์ฟเวอร์/ฐานข้อมูลแยก (T0.18)', () => {
  const login = async (u: string, p: string) => { cookie = ''; return call('POST', '/api/v1/auth/login', { username: u, password: p }); };
  const PASS = 'move-secret-2569';
  let db2: Database; let app2: FastifyInstance; let cookie2 = '';
  async function call2(method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown, headers: Record<string, string> = {}, raw?: Buffer) {
    const r = await app2.inject({ method, url, payload: raw ?? (body as object), headers: { ...(cookie2 ? { cookie: cookie2 } : {}), ...headers } });
    const set = r.headers['set-cookie'];
    if (set) cookie2 = (Array.isArray(set) ? set[0]! : set).split(';')[0]!;
    return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
  }
  beforeAll(async () => {
    const cfg = { ...loadConfig({}), databaseUrl: undefined, dataDir: 'memory://' };
    db2 = await openDatabase(cfg);
    await migrate(db2, cfg.migrationsDir, () => {});
    app2 = await buildApp(db2, cfg);
  }, 120_000);
  afterAll(async () => { await app2?.close(); await db2?.close(); });

  it('exports a whole tenant to an encrypted file, imports it on another database, users/2FA/rights/balances intact, source closed', async () => {
    // ต้นทาง: ลูกค้า M มีบริษัท ใบสำคัญ (งวดปิดแล้ว) ลูกค้า สิทธิ์รายเมนู ผู้ใช้เปิด 2FA และข้อมูลที่เจ้าหน้าที่ผู้ให้บริการเคยบันทึก
    expect((await login('admin', 'secret123')).status).toBe(200);
    const t = (await call('POST', '/api/v1/tenants', { code: 'CUSTM', name: 'ลูกค้ารายใหญ่ M', admin_username: 'm.admin', admin_name: 'ผู้ดูแล M', admin_password: 'passM1234' })).body.id as string;
    expect((await login('m.admin', 'passM1234')).status).toBe(200);
    const co = (await call('POST', '/api/v1/companies', { code: 'M-CO1', name_th: 'บริษัท เอ็ม จำกัด', fiscal_start: '2026-01-01', chart: 'express' })).body.id as string;
    await call('POST', '/api/v1/auth/select', { company_id: co });
    const book = (await call('GET', '/api/v1/gl/books')).body[0].id;
    const acc = (await call('GET', '/api/v1/gl/accounts')).body.filter((x: { is_control: boolean }) => !x.is_control);
    for (const [d, amt] of [['2026-01-10', '1500.25'], ['2026-02-03', '700.00']] as const)
      expect((await call('POST', '/api/v1/gl/journals', { journal_book_id: book, voucher_date: d, lines: [{ account_id: acc[0].id, debit: amt }, { account_id: acc[1].id, credit: amt }] })).status).toBe(200);
    const jan = (await call('GET', '/api/v1/gl/periods')).body[0].periods[0];
    expect((await call('POST', `/api/v1/gl/periods/${jan.id}/lock`, { locked: true })).status).toBe(200);
    expect((await call('POST', '/api/v1/customers', { code: 'M-C1', name: 'ลูกค้าของ M', tax_id: tid(8) })).status).toBe(200);
    expect((await call('POST', '/api/v1/users', { username: 'm.clerk', display_name: 'พนักงาน M', password: 'clerkM123', companies: [co], check_rights: true })).status).toBe(200);
    const clerk = (await call('GET', '/api/v1/users')).body.users.find((u: { username: string }) => u.username === 'm.clerk').id;
    const R = (menu_code: string, v: Partial<Record<string, string>>) => ({ menu_code, can_read: '', can_add: '', can_edit: '', can_cancel: '', can_delete: '', can_print: '', can_approve: '', ...v });
    expect((await call('PUT', '/api/v1/permissions', { subject_type: 'U', subject_id: clerk, rows: [R('GL.JNL', { can_read: 'Y' })] })).status).toBe(200);
    const key = base32Decode((await call('POST', '/api/v1/auth/2fa/setup')).body.secret);
    const step = stepOf();
    expect((await call('POST', '/api/v1/auth/2fa/enable', { code: totpAt(key, step) })).status).toBe(200);
    const tbSrc = (await call('GET', '/api/v1/reports/trial-balance?from=2026-01-01&to=2026-12-31')).body.totals;
    expect((await login('admin', 'secret123')).status).toBe(200);
    await call('POST', '/api/v1/auth/select', { company_id: co });
    expect((await call('POST', '/api/v1/customers', { code: 'M-C2', name: 'บันทึกโดยผู้ให้บริการ', tax_id: tid(9) })).status).toBe(200);

    // ส่งออก: เฉพาะผู้ให้บริการ · รหัสผ่านแฟ้มสั้นไม่ได้
    expect((await call('POST', `/api/v1/tenants/${t}/export`, { passphrase: 'short' })).status).toBe(400);
    const ex = await app.inject({ method: 'POST', url: `/api/v1/tenants/${t}/export`, payload: { passphrase: PASS }, headers: { cookie } });
    expect(ex.statusCode).toBe(200);
    expect(ex.headers['content-disposition']).toMatch(/CUSTM\.buddy-tenant/);
    const file = ex.rawPayload;
    expect(file.subarray(0, 12).toString()).toBe('BUDDYTENANT1');
    expect(file.includes(Buffer.from('ลูกค้าของ M'))).toBe(false);   // เข้ารหัสทั้งแฟ้ม
    const tenantAdmin = await login('b.admin', 'passB1234');
    expect(tenantAdmin.status).toBe(200);
    expect((await call('POST', `/api/v1/tenants/${t}/export`, { passphrase: PASS })).status).toBe(403);

    // ปลายทาง: เครื่องใหม่ ฐานข้อมูลใหม่
    expect((await call2('POST', '/api/v1/setup', { username: 'ops', display_name: 'ผู้ให้บริการเครื่องใหม่', password: 'opsNew1234' })).status).toBe(200);
    const up = (pass: string) => call2('POST', '/api/v1/tenants/import', undefined, { 'content-type': 'application/octet-stream', 'x-buddy-passphrase': encodeURIComponent(pass) }, file);
    expect((await up('wrong-passphrase-x')).body.error.message).toMatch(/รหัสผ่านของแฟ้มไม่ถูกต้อง/);
    const im = await up(PASS);
    expect(im.status, JSON.stringify(im.body)).toBe(200);
    expect(im.body.ok).toBe(true);
    expect(im.body.checks[0]).toMatchObject({ code: 'M-CO1', ok: true, target: { journals: 2 } });
    expect(im.body.users_cleared).toBeGreaterThan(0);   // ข้อมูลที่เจ้าหน้าที่ผู้ให้บริการเดิมบันทึก → ผู้บันทึกว่าง
    expect(im.body.counts.sys_user).toBe(2);
    expect((await up(PASS)).status).toBe(409);           // นำเข้าซ้ำไม่ได้

    // ผู้ใช้ของลูกค้าเข้าเครื่องใหม่ด้วยรหัสผ่านเดิม + 2FA เดิม · ข้อมูลและยอดเท่าเดิม · งวดที่ปิดยังปิด
    cookie2 = '';
    const l1 = await call2('POST', '/api/v1/auth/login', { username: 'm.admin', password: 'passM1234' });
    expect(l1.body.need_totp).toBe(true);
    expect((await call2('POST', '/api/v1/auth/login/totp', { ticket: l1.body.ticket, code: totpAt(key, step + 1) })).status).toBe(200);
    const me2 = (await call2('GET', '/api/v1/auth/me')).body;
    expect(me2.companies.map((c: { code: string }) => c.code)).toEqual(['M-CO1']);
    await call2('POST', '/api/v1/auth/select', { company_id: co });
    expect((await call2('GET', '/api/v1/reports/trial-balance?from=2026-01-01&to=2026-12-31')).body.totals).toEqual(tbSrc);
    expect((await call2('GET', '/api/v1/customers?q=M-C')).body.rows.map((r: { code: string }) => r.code).sort()).toEqual(['M-C1', 'M-C2']);
    expect((await call2('GET', '/api/v1/gl/periods')).body[0].periods[0].is_locked).toBe(true);
    cookie2 = '';
    expect((await call2('POST', '/api/v1/auth/login', { username: 'm.clerk', password: 'clerkM123' })).status).toBe(200);
    await call2('POST', '/api/v1/auth/select', { company_id: co });
    const perms = (await call2('GET', '/api/v1/auth/me')).body.perms;
    expect(perms['GL.JNL'].read).toBe(true); expect(perms['GL.JNL'].add).toBe(false);   // สิทธิ์รายเมนูตามเดิม (จับคู่ด้วยรหัสเมนู)
    const logs = (await sql<{ n: number }>`SELECT count(*)::int AS n FROM sys_activity_log WHERE company_id = ${co}`.execute(db2.db)).rows[0]!.n;
    expect(logs).toBeGreaterThan(3);

    // ต้นทาง: บันทึกที่อยู่ใหม่ → ผู้ใช้เข้าที่เดิมไม่ได้และรู้ที่อยู่ใหม่ · ลบสำเนาเดิมได้ทันที
    expect((await login('admin', 'secret123')).status).toBe(200);
    expect((await call('PUT', `/api/v1/tenants/${t}`, { code: 'CUSTM', name: 'ลูกค้ารายใหญ่ M', status: 'A', moved_to: 'https://m.buddy.example' })).body.error.message).toMatch(/เลิกใช้/);
    expect((await call('PUT', `/api/v1/tenants/${t}`, { code: 'CUSTM', name: 'ลูกค้ารายใหญ่ M', status: 'I', moved_to: 'https://m.buddy.example' })).status).toBe(200);
    const moved = await login('m.clerk', 'clerkM123');
    expect(moved.status).toBe(403); expect(moved.body.error.message).toMatch(/https:\/\/m\.buddy\.example/);
    expect((await login('admin', 'secret123')).status).toBe(200);
    expect((await call('POST', `/api/v1/tenants/${t}/purge`, { confirm: 'CUSTM' })).status).toBe(200);
  });
});

describe('สมุดรายวัน: ภาษีซื้อ/ขาย/หัก ณ ที่จ่ายบันทึกพร้อมใบสำคัญใหม่ (ข้อกำหนดเจ้าของ 30/10/2569)', () => {
  it('new voucher saves its VAT and WHT details in the same transaction; a bad detail saves nothing; cancel cancels them', async () => {
    cookie = '';
    expect((await call('POST', '/api/v1/auth/login', { username: 'admin', password: 'secret123' })).status).toBe(200);
    const co = (await call('GET', '/api/v1/auth/me')).body.companies.find((c: { code: string }) => c.code === 'DEMO').id;
    await call('POST', '/api/v1/auth/select', { company_id: co });
    const book = (await call('GET', '/api/v1/gl/books')).body[0].id;
    const acc = (await call('GET', '/api/v1/gl/accounts')).body.filter((x: { is_control: boolean; use_department: boolean }) => !x.is_control && !x.use_department);
    const vat = { kind: 'P', tax_invoice_no: 'TX-JV-01', tax_invoice_date: '2026-07-10', month: '2026-07', is_late: false, party_name: 'ผู้ขายทดสอบ', party_tax_id: '0105537095903', base_amount: '1000', vat_amount: '70' };
    const wht = { form_type: 'S53', certificate_date: '2026-07-10', payee_name: 'ผู้ขายทดสอบ', income_type: 'ค่าบริการ', paid_amount: '1000', rate: '3', tax_amount: '30' };
    const body = { journal_book_id: book, voucher_date: '2026-07-10', description: 'JV-TAX-TEST', lines: [{ account_id: acc[0].id, debit: '1000' }, { account_id: acc[1].id, debit: '70' }, { account_id: acc[2].id, credit: '1040' }, { account_id: acc[3].id, credit: '30' }], vat: [vat], wht: [wht] };
    const count = async () => (await sql<{ n: number }>`SELECT count(*)::int AS n FROM gl_journal WHERE description = 'JV-TAX-TEST'`.execute(database.db)).rows[0]!.n;
    const bad = await call('POST', '/api/v1/gl/journals', { ...body, wht: [{ ...wht, payee_name: '' }] });
    expect(bad.status).toBe(400);
    expect(await count()).toBe(0);   // รายละเอียดภาษีไม่ผ่าน = ไม่มีใบสำคัญ
    const r = await call('POST', '/api/v1/gl/journals', body);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const v = (await call('GET', `/api/v1/vat/P?journal_id=${r.body.id}&status=all`)).body.rows;
    expect(v).toHaveLength(1); expect(v[0]).toMatchObject({ tax_invoice_no: 'TX-JV-01', doc_no: r.body.voucher_no, vat_amount: '70.00' });
    const w = (await call('GET', `/api/v1/wht?journal_id=${r.body.id}`)).body.rows;
    expect(w).toHaveLength(1); expect(w[0]).toMatchObject({ payee_name: 'ผู้ขายทดสอบ', tax_amount: '30.00' });
    // ใบสำคัญที่บันทึกแล้ว: ป้อนเพิ่มจากแท็บได้ (journal_id)
    expect((await call('POST', '/api/v1/wht', { ...wht, certificate_no: 'C2', journal_id: r.body.id })).status).toBe(200);
    expect((await call('GET', `/api/v1/wht?journal_id=${r.body.id}`)).body.rows).toHaveLength(2);
    expect((await call('POST', `/api/v1/gl/journals/${r.body.id}/cancel`, { reason: 'ทดสอบ' })).status).toBe(200);
    expect((await call('GET', `/api/v1/vat/P?journal_id=${r.body.id}&status=all`)).body.rows[0].doc_status).toBe('C');
    expect((await sql<{ s: string }>`SELECT string_agg(DISTINCT doc_status, ',') AS s FROM tax_wht_entry WHERE journal_id = ${r.body.id}`.execute(database.db)).rows[0]!.s).toBe('C');
  });
});

describe('โลโก้และลายเซ็นในแบบฟอร์มพิมพ์ (ข้อกำหนดเจ้าของ 30/10/2569)', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  it('logo and named signatures: upload, used in print data, validation, deletion wipes the image, other tenants cannot see them', async () => {
    cookie = '';
    expect((await call('POST', '/api/v1/auth/login', { username: 'admin', password: 'secret123' })).status).toBe(200);
    const co = (await call('GET', '/api/v1/auth/me')).body.companies.find((c: { code: string }) => c.code === 'DEMO').id;
    await call('POST', '/api/v1/auth/select', { company_id: co });
    expect((await call('PUT', '/api/v1/company-images/logo', { data: 'data:image/gif;base64,R0lGODlh' })).status).toBe(400);
    expect((await call('PUT', '/api/v1/company-images/logo', { data: 'data:image/png;base64,' + Buffer.from('not a png').toString('base64') })).body.error.message).toMatch(/ไม่ใช่รูป/);
    expect((await call('PUT', '/api/v1/company-images/logo', { data: 'data:image/png;base64,' + Buffer.alloc(400 * 1024).toString('base64') })).status).toBe(400);
    expect((await call('PUT', '/api/v1/company-images/logo', { data: PNG })).status).toBe(200);
    expect((await call('PUT', '/api/v1/company-images/logo', { data: PNG })).status).toBe(200);   // แทนรูปเดิม
    const s1 = await call('POST', '/api/v1/company-images/signs', { name: 'กรรมการผู้จัดการ', data: PNG });
    expect(s1.status).toBe(200);
    expect((await call('POST', '/api/v1/company-images/signs', { name: 'กรรมการผู้จัดการ', data: PNG })).body.error.message).toMatch(/มีลายเซ็นชื่อ/);
    const list = (await call('GET', '/api/v1/company-images')).body as Array<{ kind: string; name: string; data: string }>;
    expect(list.map((x) => `${x.kind}:${x.name}`)).toEqual(['LOGO:LOGO', 'SIGN:กรรมการผู้จัดการ']);
    const jid = (await sql<{ id: string }>`SELECT id FROM gl_journal WHERE company_id = ${co} AND deleted_at IS NULL LIMIT 1`.execute(database.db)).rows[0]!.id;
    const pr = (await call('GET', `/api/v1/print/journal/${jid}`)).body;
    expect(pr.images.logo).toBe(PNG);
    expect(pr.images.signs[s1.body.id].name).toBe('กรรมการผู้จัดการ');
    expect(pr.forms[0].layout).toMatchObject({ logo: 'left', logo_mm: 18, signature_images: [] });
    // แบบฟอร์มเลือกรูปลายเซ็นให้ช่องลงชื่อ (รหัสที่ไม่ใช่ uuid ถูกตัดทิ้ง)
    expect((await call('PUT', '/api/v1/print-forms/GL/1', { name: 'ใบสำคัญมีลายเซ็น', base: 'grid', status: 'A', layout: { logo: 'center', logo_mm: 99, signatures: ['ผู้จัดทำ', 'ผู้อนุมัติ'], signature_images: ['bad', s1.body.id] } })).status).toBe(200);
    const f1 = (await call('GET', `/api/v1/print/journal/${jid}`)).body.forms.find((f: { slot: number }) => f.slot === 1);
    expect(f1.layout).toMatchObject({ logo: 'center', logo_mm: 40, signature_images: [null, s1.body.id] });
    await call('DELETE', '/api/v1/print-forms/GL/1');
    // ลูกค้าอื่นมองไม่เห็น/ลบไม่ได้
    cookie = '';
    expect((await call('POST', '/api/v1/auth/login', { username: 'b.admin', password: 'passB1234' })).status).toBe(200);
    const bCo = (await call('GET', '/api/v1/auth/me')).body.companies[0].id;
    await call('POST', '/api/v1/auth/select', { company_id: bCo });
    expect((await call('GET', '/api/v1/company-images')).body).toEqual([]);
    expect((await call('DELETE', `/api/v1/company-images/${s1.body.id}`)).status).toBe(404);
    // ลบแล้วรูปถูกล้าง (ลายเซ็นเป็นข้อมูลส่วนบุคคล)
    cookie = '';
    await call('POST', '/api/v1/auth/login', { username: 'admin', password: 'secret123' });
    await call('POST', '/api/v1/auth/select', { company_id: co });
    expect((await call('DELETE', `/api/v1/company-images/${s1.body.id}`)).status).toBe(200);
    expect((await sql<{ data: string }>`SELECT data FROM sys_company_image WHERE id = ${s1.body.id}`.execute(database.db)).rows[0]!.data).toBe('');
    expect((await call('GET', '/api/v1/company-images')).body.map((x: { kind: string }) => x.kind)).toEqual(['LOGO']);
  });
});

describe('รูปภาพสินค้า (ข้อกำหนดเจ้าของ 30/10/2569)', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  it('upload up to 8, first is main, set main, delete wipes + promotes, image file, list/search show main, rights, other tenants', async () => {
    cookie = '';
    expect((await call('POST', '/api/v1/auth/login', { username: 'admin', password: 'secret123' })).status).toBe(200);
    const co = (await call('GET', '/api/v1/auth/me')).body.companies.find((c: { code: string }) => c.code === 'DEMO').id;
    await call('POST', '/api/v1/auth/select', { company_id: co });
    const mk = async (code: string, type: string) => (await sql<{ id: string }>`INSERT INTO md_item (company_id, code, name_th, item_type) VALUES (${co}, ${code}, ${'สินค้ามีรูป ' + code}, ${type}) RETURNING id`.execute(database.db)).rows[0]!.id;
    const item = await mk('PIC-1', '0'), srv = await mk('PIC-SRV', '3');
    const url = `/api/v1/items/${item}/images`;
    expect((await call('GET', url)).body).toEqual([]);
    expect((await call('POST', url, { data: 'data:image/png;base64,' + Buffer.from('not a png').toString('base64'), thumb: PNG })).body.error.message).toMatch(/ไม่ใช่รูป/);
    expect((await call('POST', url, { data: PNG, thumb: 'data:image/gif;base64,R0lGODlh' })).status).toBe(400);
    expect((await call('POST', `/api/v1/items/${srv}/images`, { data: PNG, thumb: PNG })).status).toBe(404);          // รหัสบริการต้องใช้เส้นทางของบริการ
    expect((await call('POST', `/api/v1/services/${srv}/images`, { data: PNG, thumb: PNG })).status).toBe(200);
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) { const r = await call('POST', url, { data: PNG, thumb: PNG, name: `รูป${i + 1}.png` }); expect(r.status).toBe(200); ids.push(r.body.id); }
    expect((await call('POST', url, { data: PNG, thumb: PNG })).body.error.message).toMatch(/ครบ 8 รูป/);
    let list = (await call('GET', url)).body as Array<{ id: string; is_main: boolean; line_no: number }>;
    expect(list.filter((x) => x.is_main).map((x) => x.id)).toEqual([ids[0]]);
    expect((await call('PUT', `${url}/${ids[2]}/main`)).status).toBe(200);
    list = (await call('GET', url)).body;
    expect(list[0]).toMatchObject({ id: ids[2], is_main: true }); expect(list.filter((x) => x.is_main)).toHaveLength(1);
    // แฟ้มรูปสำหรับ <img> (ย่อ/เต็ม)
    const f = await app.inject({ method: 'GET', url: `/api/v1/item-images/${ids[2]}?size=thumb`, headers: { cookie } });
    expect(f.statusCode).toBe(200); expect(f.headers['content-type']).toBe('image/png'); expect(f.rawPayload.subarray(1, 4).toString()).toBe('PNG');
    // รายการสินค้าและหน้าค้นหาบอกรูปหลัก
    expect((await call('GET', '/api/v1/items?q=PIC-1')).body.rows[0].image_id).toBe(ids[2]);
    expect((await call('GET', '/api/v1/item-search?module=AR&q=PIC-1')).body.rows[0].image_id).toBe(ids[2]);
    // ลบรูปหลัก → ล้างรูป และรูปลำดับแรกที่เหลือเป็นรูปหลัก
    expect((await call('DELETE', `${url}/${ids[2]}`)).status).toBe(200);
    expect((await sql<{ data: string; thumb: string }>`SELECT data, thumb FROM md_item_image WHERE id = ${ids[2]}`.execute(database.db)).rows[0]).toEqual({ data: '', thumb: '' });
    list = (await call('GET', url)).body;
    expect(list).toHaveLength(7); expect(list[0]).toMatchObject({ id: ids[0], is_main: true });
    expect((await app.inject({ method: 'GET', url: `/api/v1/item-images/${ids[2]}`, headers: { cookie } })).statusCode).toBe(404);
    expect((await call('POST', url, { data: PNG, thumb: PNG })).status).toBe(200);                                     // ลบแล้วเพิ่มได้อีก
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM sys_activity_log WHERE table_name = 'md_item_image'`.execute(database.db)).rows[0]!.n).toBeGreaterThanOrEqual(12);
    // ผู้ใช้ที่ไม่มีสิทธิ์แก้สินค้า ดูรูปได้ แต่เพิ่ม/ลบไม่ได้
    expect((await call('POST', '/api/v1/users', { username: 'pic.clerk', display_name: 'พนักงานดูสินค้า', password: 'clerkPic123', companies: [co], check_rights: true })).status).toBe(200);
    cookie = '';
    expect((await call('POST', '/api/v1/auth/login', { username: 'pic.clerk', password: 'clerkPic123' })).status).toBe(200);
    await call('POST', '/api/v1/auth/select', { company_id: co });
    expect((await call('GET', url)).body).toHaveLength(8);
    expect((await call('POST', url, { data: PNG, thumb: PNG })).status).toBe(403);
    expect((await call('DELETE', `${url}/${ids[0]}`)).status).toBe(403);
    // ลูกค้าอื่นมองไม่เห็น/แก้ไม่ได้ แม้รู้รหัส
    cookie = '';
    expect((await call('POST', '/api/v1/auth/login', { username: 'b.admin', password: 'passB1234' })).status).toBe(200);
    await call('POST', '/api/v1/auth/select', { company_id: (await call('GET', '/api/v1/auth/me')).body.companies[0].id });
    expect((await call('GET', url)).status).toBe(404);
    expect((await call('POST', url, { data: PNG, thumb: PNG })).status).toBe(404);
    expect((await call('PUT', `${url}/${ids[0]}/main`)).status).toBe(404);
    expect((await call('DELETE', `${url}/${ids[0]}`)).status).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/v1/item-images/${ids[0]}`, headers: { cookie } })).statusCode).toBe(404);
  });
});

describe('นำเข้ารายการขาย/ซื้อจากแฟ้ม Excel (ข้อกำหนดเจ้าของ 30/10/2569)', () => {
  /** สมุดงาน .xlsx อย่างง่าย (ข้อความใช้ sharedStrings แบบที่ Excel บันทึก) */
  const xlsx = (rows: string[][]) => {
    const ss: string[] = [];
    const cell = (v: string, r: number, c: number) => {
      const ref = String.fromCharCode(65 + c) + (r + 1);
      if (/^-?\d+(\.\d+)?$/.test(v)) return `<c r="${ref}"><v>${v}</v></c>`;
      ss.push(v); return `<c r="${ref}" t="s"><v>${ss.length - 1}</v></c>`;
    };
    const sheet = `<worksheet><sheetData>${rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => cell(v, i, j)).join('')}</row>`).join('')}</sheetData></worksheet>`;
    return createZip([
      { name: 'xl/workbook.xml', data: '<workbook><sheets><sheet name="ขาย" sheetId="1" r:id="rId7"/></sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: '<Relationships><Relationship Id="rId7" Type="worksheet" Target="worksheets/data.xml"/></Relationships>' },
      { name: 'xl/worksheets/data.xml', data: sheet },
      { name: 'xl/sharedStrings.xml', data: `<sst>${ss.map((x) => `<si><t>${x}</t></si>`).join('')}</sst>` },
    ]).toString('base64');
  };
  const csv = (rows: string[][]) => Buffer.from('\uFEFF' + rows.map((r) => r.join(',')).join('\r\n'), 'utf8').toString('base64');
  const HEAD = ['เลขที่อ้างอิง', 'วันที่', 'รหัสลูกค้า', 'รหัสสินค้า', 'จำนวน', 'หน่วย', 'ราคาต่อหน่วย', 'ส่วนลด', 'หมายเหตุ'];

  it('template, preview (no save), all-or-nothing commit through normal posting, duplicate guard, rights, other tenants', async () => {
    cookie = '';
    expect((await call('POST', '/api/v1/auth/login', { username: 'admin', password: 'secret123' })).status).toBe(200);
    const co = (await call('GET', '/api/v1/auth/me')).body.companies.find((c: { code: string }) => c.code === 'DEMO').id;
    await call('POST', '/api/v1/auth/select', { company_id: co });
    const cus = await call('POST', '/api/v1/customers', { code: 'IMP-C1', name: 'ลูกค้านำเข้า', tax_id: tid(950), credit_days: 15 });
    expect(cus.status).toBe(200);
    const item = (await call('GET', '/api/v1/services?status=all')).body.rows[0] ?? (await call('GET', '/api/v1/items?q=01-INTL')).body.rows[0];
    expect(item?.code).toBeTruthy();
    const ivType = (await call('GET', '/api/v1/trade-defaults/IV')).body.types[0].id;
    const nextNo = async () => (await sql<{ n: string }>`SELECT next_no::text AS n FROM md_doc_type WHERE id = ${ivType}`.execute(database.db)).rows[0]!.n;
    const ours = async () => (await sql<{ n: number }>`SELECT count(*)::int AS n FROM doc_header WHERE company_id = ${co} AND your_ref LIKE 'XL-%' AND doc_status <> 'C'`.execute(database.db)).rows[0]!.n;

    // แบบฟอร์มตัวอย่าง: .xlsx ที่อ่านกลับได้ หัวตรงตามที่นำเข้า (ลูกค้า/สินค้าตัวอย่างจากข้อมูลจริง)
    const t = await app.inject({ method: 'GET', url: '/api/v1/trade-import/sales-invoices/template', headers: { cookie } });
    expect(t.statusCode).toBe(200); expect(t.headers['content-type']).toMatch(/spreadsheetml/);
    const tr = readTable('import-IV.xlsx', t.rawPayload);
    expect(tr[0]!.slice(0, 7)).toEqual(['เลขที่อ้างอิง', 'วันที่', 'รหัสลูกค้า', 'รหัสสินค้า', 'รายละเอียด', 'จำนวน', 'หน่วย']);
    expect(tr).toHaveLength(3);
    expect((await app.inject({ method: 'GET', url: '/api/v1/trade-import/sales-orders/template', headers: { cookie } })).statusCode).toBe(404);   // ใบสั่งขายไม่ใช่รายการขาย

    const url = '/api/v1/trade-import/sales-invoices';
    const base = { file_name: 'ขาย.csv', doc_type_id: ivType, price_type: '2', vat_rate: 7 };
    const bad = csv([HEAD,
      ['XL-1', '15/07/2569', 'IMP-C1', item.code, '2', '', '"1,000"', '10%', 'จากหน้าร้าน'],
      ['XL-1', '15/07/2569', 'imp-c1', item.code.toLowerCase(), '1', '', '500', '', ''],
      ['XL-2', '16/07/2569', 'IMP-C1', item.code, '1', 'ZZZ', '200', '', ''],
      ['XL-3', '16/07/2569', 'NOPE', item.code, '1', '', '200', '', ''],
      ['XL-4', '31/02/2569', 'IMP-C1', item.code, '1', '', '200', '', '']]);
    const before = await nextNo();
    const pv = await call('POST', url, { ...base, data: bad });
    expect(pv.status).toBe(200);
    expect(pv.body.ok).toBe(false); expect(pv.body.committed).toBe(false);
    expect(pv.body.docs).toEqual([expect.objectContaining({ ref: 'XL-1', row: 2, date: '2026-07-15', party_code: 'IMP-C1', lines: 2, amount: '2300.00', vat_amount: '161.00', net_amount: '2461.00', doc_no: null })]);
    expect(pv.body.errors.map((e: { row: number }) => e.row)).toEqual([4, 5, 6]);
    expect(pv.body.errors.map((e: { message: string }) => e.message).join('|')).toMatch(/^หน่วย ZZZ ไม่ใช่หน่วยของสินค้า .*\|ไม่พบรหัสลูกค้า NOPE .*\|วันที่ "31\/02\/2569" ไม่ถูกต้อง/);
    expect(await ours()).toBe(0); expect(await nextNo()).toBe(before);                                    // ตรวจอย่างเดียว ไม่บันทึก ไม่ใช้เลขที่
    const cm = await call('POST', url, { ...base, data: bad, commit: true });
    expect(cm.status).toBe(400); expect(cm.body.error.message).toMatch(/มีข้อผิดพลาด 3 รายการ/);
    expect(await ours()).toBe(0);

    // แฟ้ม .xlsx ที่แก้แล้ว → บันทึกจริงผ่านการลงบัญชีปกติ
    const good = xlsx([['ยอดขายเดือนกรกฎาคม'], HEAD,
      ['XL-1', '15/07/2569', 'IMP-C1', item.code, '2', '', '1000', '10%', 'จากหน้าร้าน'],
      ['XL-1', '15/07/2569', 'IMP-C1', item.code, '1', '', '500', '', ''],
      ['XL-2', '46219', 'IMP-C1', item.code, '1', '', '200', '', '']]);
    const ok = await call('POST', url, { ...base, file_name: 'ขาย.xlsx', data: good, commit: true });
    expect(ok.body.error?.message ?? 'ok').toBe('ok');
    expect(ok.body).toMatchObject({ ok: true, committed: true, total_net: '2675.00' });
    expect(ok.body.docs.map((x: { ref: string; date: string; doc_no: string }) => `${x.ref}:${x.date}:${!!x.doc_no}`)).toEqual(['XL-1:2026-07-15:true', 'XL-2:2026-07-16:true']);
    const h = (await sql<{ id: string; doc_no: string; your_ref: string; remark: string | null; credit_days: number; net_amount: string; gl_posted: string }>`SELECT id, doc_no, your_ref, remark, credit_days, net_amount, gl_posted FROM doc_header
        WHERE company_id = ${co} AND your_ref LIKE 'XL-%' ORDER BY your_ref`.execute(database.db)).rows;
    expect(h.map((x) => [x.doc_no, x.your_ref, x.remark, x.credit_days, x.net_amount, x.gl_posted])).toEqual([
      [ok.body.docs[0].doc_no, 'XL-1', 'จากหน้าร้าน', 15, '2461.00', 'Y'], [ok.body.docs[1].doc_no, 'XL-2', null, 15, '214.00', 'Y']]);
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM gl_journal WHERE source_header_id = ${h[0]!.id} AND doc_status = 'N'`.execute(database.db)).rows[0]!.n).toBe(1);
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM sys_activity_log WHERE company_id = ${co} AND action = 'IMPORT'`.execute(database.db)).rows[0]!.n).toBe(1);
    // นำเข้าซ้ำ → แจ้งเลขที่เดิม ไม่บันทึกซ้ำ
    const again = await call('POST', url, { ...base, data: good });
    expect(again.body.errors.map((e: { message: string }) => e.message)).toEqual([`เลขที่อ้างอิง XL-1 เคยนำเข้าแล้วเป็น ${h[0]!.doc_no} — ลบแถวนี้ออก หรือยกเลิก ${h[0]!.doc_no} ก่อน`, expect.stringContaining('XL-2 เคยนำเข้าแล้ว')]);
    // แฟ้มที่อ่านไม่ได้
    expect((await call('POST', url, { ...base, file_name: 'old.xls', data: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2]).toString('base64') })).body.error.message).toMatch(/\.xls แบบเก่า/);
    expect((await call('POST', url, { ...base, data: csv([['a', 'b'], ['1', '2']]) })).body.errors[0].message).toMatch(/ไม่พบหัวตาราง/);
    // ประเภทเอกสารต้องเป็นของชนิดนี้
    const hsType = (await call('GET', '/api/v1/trade-defaults/HS')).body.types[0].id;
    expect((await call('POST', url, { ...base, doc_type_id: hsType, data: good })).body.error.message).toMatch(/เลือกประเภทเอกสารของขายเงินเชื่อ/);

    // ผู้ใช้ที่ไม่มีสิทธิ์ (ตรวจสอบสิทธิ์ก่อนใช้งาน ไม่มีแถวสิทธิ์) นำเข้าไม่ได้
    expect((await call('POST', '/api/v1/users', { username: 'imp.clerk', display_name: 'พนักงานนำเข้า', password: 'clerkImp123', companies: [co], check_rights: true })).status).toBe(200);
    cookie = '';
    expect((await call('POST', '/api/v1/auth/login', { username: 'imp.clerk', password: 'clerkImp123' })).status).toBe(200);
    await call('POST', '/api/v1/auth/select', { company_id: co });
    expect((await call('POST', url, { ...base, data: bad })).status).toBe(403);
    // ลูกค้าอื่น: ใช้ประเภทเอกสาร/ลูกค้าของบริษัทนี้ไม่ได้
    cookie = '';
    expect((await call('POST', '/api/v1/auth/login', { username: 'b.admin', password: 'passB1234' })).status).toBe(200);
    await call('POST', '/api/v1/auth/select', { company_id: (await call('GET', '/api/v1/auth/me')).body.companies[0].id });
    expect((await call('POST', url, { ...base, data: bad })).body.error.message).toMatch(/เลือกประเภทเอกสาร/);
  });
});

describe('ธีมของแต่ละบริษัท (ข้อกำหนดเจ้าของ 30/10/2569)', () => {
  it('theme + font per company: default, validated choices only, shown in /auth/me, rights, other companies unaffected', async () => {
    cookie = '';
    expect((await call('POST', '/api/v1/auth/login', { username: 'admin', password: 'secret123' })).status).toBe(200);
    const co = (await call('GET', '/api/v1/auth/me')).body.companies.find((c: { code: string }) => c.code === 'DEMO').id;
    await call('POST', '/api/v1/auth/select', { company_id: co });
    expect((await call('GET', '/api/v1/auth/me')).body.ui_theme).toEqual({ theme: 'lavender', font: 'plex' });
    expect((await call('PUT', '/api/v1/company/ui-theme', { theme: 'neon', font: 'plex' })).body.error.message).toMatch(/เลือกธีม/);
    expect((await call('PUT', '/api/v1/company/ui-theme', { theme: 'mint', font: 'sarabun' })).status).toBe(200);
    expect((await call('GET', '/api/v1/auth/me')).body.ui_theme).toEqual({ theme: 'mint', font: 'sarabun' });
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM sys_activity_log WHERE company_id = ${co} AND action = 'SET_THEME'`.execute(database.db)).rows[0]!.n).toBe(1);
    // บริษัทอื่นของลูกค้าเดียวกันยังเป็นค่าเริ่มต้น
    const other = (await call('GET', '/api/v1/auth/me')).body.companies.find((c: { id: string }) => c.id !== co);
    if (other) {
      await call('POST', '/api/v1/auth/select', { company_id: other.id });
      expect((await call('GET', '/api/v1/auth/me')).body.ui_theme).toEqual({ theme: 'lavender', font: 'plex' });
    }
    // ผู้ใช้ไม่มีสิทธิ์แก้รายละเอียดกิจการ เปลี่ยนไม่ได้ แต่เห็นธีมของบริษัท
    cookie = '';
    expect((await call('POST', '/api/v1/auth/login', { username: 'imp.clerk', password: 'clerkImp123' })).status).toBe(200);
    await call('POST', '/api/v1/auth/select', { company_id: co });
    expect((await call('GET', '/api/v1/auth/me')).body.ui_theme).toEqual({ theme: 'mint', font: 'sarabun' });
    expect((await call('PUT', '/api/v1/company/ui-theme', { theme: 'rose', font: 'plex' })).status).toBe(403);
    // ลูกค้าอื่น: เปลี่ยนได้เฉพาะบริษัทตัวเอง
    cookie = '';
    expect((await call('POST', '/api/v1/auth/login', { username: 'b.admin', password: 'passB1234' })).status).toBe(200);
    await call('POST', '/api/v1/auth/select', { company_id: (await call('GET', '/api/v1/auth/me')).body.companies[0].id });
    expect((await call('GET', '/api/v1/auth/me')).body.ui_theme).toEqual({ theme: 'lavender', font: 'plex' });
    expect((await call('PUT', '/api/v1/company/ui-theme', { theme: 'peach', font: 'system' })).status).toBe(200);
    expect((await sql<{ v: unknown }>`SELECT value AS v FROM sys_setting WHERE company_id = ${co} AND key = 'ui.theme'`.execute(database.db)).rows[0]!.v).toEqual({ theme: 'mint', font: 'sarabun' });
  });
});

describe('ปิดบางระบบทั้งบริษัท (ข้อกำหนดเจ้าของ 30/10/2569)', () => {
  it('switched-off modules: hidden in perms for everyone incl. admin, APIs refused with a clear message, data kept, other companies unaffected', async () => {
    cookie = '';
    expect((await call('POST', '/api/v1/auth/login', { username: 'admin', password: 'secret123' })).status).toBe(200);
    const co = (await call('GET', '/api/v1/auth/me')).body.companies.find((c: { code: string }) => c.code === 'DEMO').id;
    await call('POST', '/api/v1/auth/select', { company_id: co });
    const g = await call('GET', '/api/v1/company/modules');
    expect(g.body.off).toEqual([]); expect(g.body.modules.map((m: { key: string }) => m.key)).toContain('BANK');
    expect((await call('PUT', '/api/v1/company/modules', { off: ['BANK', 'NOPE'] })).body.error.message).toMatch(/ไม่รู้จักระบบ NOPE/);
    const poBefore = (await call('GET', '/api/v1/purchase-orders')).body;
    expect((await call('PUT', '/api/v1/company/modules', { off: ['ORDER', 'BANK'] })).body).toEqual({ off: ['ORDER', 'BANK'] });
    const me = (await call('GET', '/api/v1/auth/me')).body;
    expect(me.perms['FI.BK.CR'].read).toBe(false); expect(me.perms['PU.PO'].add).toBe(false); expect(me.perms['SA.QT'].read).toBe(false);
    expect(me.perms['SA.IV'].read).toBe(true); expect(me.perms['SET.CO'].edit).toBe(true);
    const r = await call('GET', '/api/v1/purchase-orders');
    expect(r.status).toBe(403); expect(r.body.error.message).toBe('ใบเสนอราคา / ใบสั่งขาย / ใบสั่งซื้อปิดอยู่ในบริษัทนี้ — ผู้มีสิทธิ์เปิดได้ที่ เริ่มระบบ › รายละเอียดกิจการ › ระบบที่ใช้งาน');
    expect((await call('GET', '/api/v1/cheque-deposits')).status).toBe(403);
    expect((await call('GET', '/api/v1/sales-invoices')).status).toBe(200);
    expect((await call('GET', '/api/v1/bank-accounts')).status).toBe(200);           // ข้อมูลอ้างอิงที่ระบบอื่นใช้ยังเรียกได้
    // ปิดระบบซื้อ → นำเข้าบิลซื้อจาก Excel ก็ไม่ได้ (ตรวจสิทธิ์เพิ่มเอกสารซ้ำในคำขอ)
    expect((await call('PUT', '/api/v1/company/modules', { off: ['PU'] })).status).toBe(200);
    const rrType = (await call('GET', '/api/v1/trade-defaults/RR')).body.types[0].id;
    expect((await call('POST', '/api/v1/trade-import/purchase-invoices', { file_name: 'x.csv', data: 'YQ==', doc_type_id: rrType })).status).toBe(403);
    // ลูกค้าอื่นไม่ถูกกระทบ และตั้งค่าของบริษัทนี้ไม่ได้
    cookie = '';
    expect((await call('POST', '/api/v1/auth/login', { username: 'b.admin', password: 'passB1234' })).status).toBe(200);
    await call('POST', '/api/v1/auth/select', { company_id: (await call('GET', '/api/v1/auth/me')).body.companies[0].id });
    expect((await call('GET', '/api/v1/company/modules')).body.off).toEqual([]);
    expect((await call('GET', '/api/v1/purchase-invoices')).status).toBe(200);
    // ผู้ไม่มีสิทธิ์แก้รายละเอียดกิจการ เปิด/ปิดระบบไม่ได้
    cookie = '';
    expect((await call('POST', '/api/v1/auth/login', { username: 'imp.clerk', password: 'clerkImp123' })).status).toBe(200);
    await call('POST', '/api/v1/auth/select', { company_id: co });
    expect((await call('PUT', '/api/v1/company/modules', { off: [] })).status).toBe(403);
    // เปิดกลับ → ข้อมูลเดิมยังอยู่ครบ
    cookie = '';
    await call('POST', '/api/v1/auth/login', { username: 'admin', password: 'secret123' });
    await call('POST', '/api/v1/auth/select', { company_id: co });
    expect((await call('PUT', '/api/v1/company/modules', { off: [] })).status).toBe(200);
    expect((await call('GET', '/api/v1/purchase-orders')).body).toEqual(poBefore);
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM sys_activity_log WHERE company_id = ${co} AND action = 'SET_MODULES'`.execute(database.db)).rows[0]!.n).toBe(3);
  });
});
