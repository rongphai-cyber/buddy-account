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
import { API_RULES, POSTING_PREVIEW, REGISTERED_ROUTES, VIEWER_OWN_ACCOUNT_ROUTES, syncMenus } from '../src/modules/permissions.js';
import { setAiClientFactory } from '../src/modules/ai.js';
import { base32Decode, stepOf, totpAt } from '../src/modules/security.js';
import { d, PLATFORM_MENUS, taxIdCheckDigit } from '@buddy/core';
import { createZip } from '../src/zip.js';
import { readSheets, readTable } from '../src/modules/trade-import.js';
import { buildXlsx } from '../src/xlsx.js';
import { readZip } from '../src/zip.js';
import { verifySsoToken } from '../src/sso.js';
/** เลขผู้เสียภาษีที่ถูกต้องและไม่ซ้ำกัน สำหรับคู่ค้าทดสอบ (เลข + สาขาซ้ำในบริษัทเดียวกันบันทึกไม่ได้) */
const tid = (n: number) => { const b = `0105560${String(n).padStart(5, '0')}`; return b + taxIdCheckDigit(b); };


let database: Database;
let app: FastifyInstance;
/** ค่าตั้งของแอปทดสอบ (ชุดสมัครใช้งานสลับโหมดได้ระหว่างทดสอบ) */
let appCfg: ReturnType<typeof loadConfig>;
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
  process.env.BUDDY_CHANGES_HOLDBACK_MS = '0';   // ฟีดข้อมูลหลัก (B0.3) ไม่ต้องรอ
  process.env.BUDDY_SECRET_KEY ??= Buffer.alloc(32, 7).toString('base64');   // ไม่แตะแฟ้มกุญแจจริงใน .data
  const cfg = { ...loadConfig({}), databaseUrl: undefined, dataDir: 'memory://' };
  appCfg = cfg;
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
    const again = await call('POST', '/api/v1/setup', { username: 'x', display_name: 'x', password: 'secret123' });
    expect([again.status, again.body.error.code]).toEqual([409, 'ALREADY_SETUP']);   // หน้าจอพาไปหน้าเข้าระบบ (กดซ้ำ/สองแท็บ)
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
    // ปีที่สร้างเพื่อยอดเปรียบเทียบ = ปิดแล้ว → วันเริ่มใช้โปรแกรมไม่เลื่อนไปปีก่อน (ยอดยกมาสินค้ายังลงวันก่อนวันเริ่มใช้ได้)
    expect((await sql<{ status: string }>`SELECT status FROM gl_fiscal_year WHERE id = ${s.prior.id}`.execute(database.db)).rows[0]!.status).toBe('C');
    expect((await call('GET', '/api/v1/stock-opening')).body.start_date).toBe('2026-01-01');
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
    expect((await call('GET', '/api/v1/fs/run?kind=BS&end=2026-12-31')).body.balance_diff).toEqual(['0.00', '0.00']);
    // แก้ไขแทนชุดเดิม และเก็บค่าก่อนแก้ใน log
    expect((await put(cash, { debit: '1000' })).status).toBe(200);
    // เงินสดหายไป 500 แต่รายได้ยังอยู่ → งบปีที่แล้วไม่ดุล (หน้าจอเตือนให้แก้ที่ยอดปีที่แล้ว)
    expect((await call('GET', '/api/v1/fs/run?kind=BS&end=2026-12-31')).body.balance_diff).toEqual(['0.00', '-500.00']);
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
    // ตามเมนู: กลุ่มที่ได้สิทธิ์จากเมนูหลัก (RP) แสดงด้วย พร้อมบอกว่ามาจากเมนูไหน (HANDOFF 161)
    const inh = (await call('GET', '/api/v1/permissions/by-menu?menu_code=RP.LEDGER')).body as Array<{ code: string; menu_code: string; can_read: string }>;
    expect(inh.map((r) => [r.code, r.menu_code, r.can_read])).toEqual([['ACC', 'RP', 'Y']]);
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
    // บัญชีแยกประเภทหลายบัญชี (เจ้าของ 17/11/2569): บัญชีของบริษัทอื่น = ไม่พบ · ทุกบัญชี = เฉพาะของบริษัทที่เลือก
    expect((await call('GET', `/api/v1/reports/ledgers?account_id=${cash}&from=2026-01-01&to=2026-12-31`)).status).toBe(404);
    expect((await call('GET', '/api/v1/reports/ledgers?from=2026-01-01&to=2026-12-31&zero=1')).body.sections).toEqual([]);
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
    expect((await call('POST', '/api/v1/suppliers', { code: 'SX2', name: 'ซ้ำ', tax_id: T, tax_branch_no: '00000' })).body.error.message).toMatch(/เป็นของผู้จำหน่าย SX1/);
    // บริษัทอื่นใช้เลขเดียวกันได้ ไม่เตือนข้ามบริษัท
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    const ox = await call('POST', '/api/v1/customers', { ...tx, code: 'TX1' });
    expect(ox.status).toBe(200); expect(ox.body.warnings).toEqual([]);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    // ลบได้เมื่อยังไม่มีเอกสาร
    expect((await call('DELETE', `/api/v1/suppliers/${s1.body.id}`)).status).toBe(200);
    expect((await call('GET', `/api/v1/suppliers/${s1.body.id}`)).status).toBe(404);
  });

  it('address parts: postcode/subdistrict codes on customers, ship-to, suppliers, salespersons, company and branches (docs/18 ข้อ 12)', async () => {
    const parts = { addr_no: '99/1', addr_moo: '5', addr_village: 'สวนทอง', addr_soi: '3', addr_road: 'เชียงใหม่-ฮอด', addr_geo_code: '501508', zip_code: '50230' };
    const lines = { address_1: '99/1 หมู่ 5 หมู่บ้านสวนทอง ซอย 3 ถนนเชียงใหม่-ฮอด', address_2: 'ตำบลสันผักหวาน อำเภอหางดง', address_3: 'จังหวัดเชียงใหม่' };
    const cus = { code: 'CADDR', name: 'ร้าน ที่อยู่ ทดสอบ', tax_id: '0105537095903', tax_branch_no: '1', ...parts, ...lines, ship_tos: [{ code: 'S1', ...parts, addr_no: '7', address_1: '7 หมู่ 5', address_2: lines.address_2, address_3: lines.address_3 }] };
    // รหัสตำบลต้องเป็นตำบลจริง (รหัสอำเภอ/ไม่มีจริง = ไม่รับ พร้อมบอกวิธีแก้)
    for (const bad of ['501500', '999999', 'ABC']) {
      const r = await call('POST', '/api/v1/customers', { ...cus, addr_geo_code: bad });
      expect(r.status).toBe(400); expect(r.body.error.message).toMatch(/ตำบล\/แขวงไม่ถูกต้อง/);
    }
    expect((await call('POST', '/api/v1/customers', { ...cus, ship_tos: [{ ...cus.ship_tos[0], addr_geo_code: '501500' }] })).status).toBe(400);
    const c = await call('POST', '/api/v1/customers', cus);
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    const cd = (await call('GET', `/api/v1/customers/${c.body.id}`)).body;
    expect(cd).toMatchObject({ ...parts, ...lines, addr_building: null, addr_room: null });
    expect(cd.ship_tos[0]).toMatchObject({ code: 'S1', addr_no: '7', addr_geo_code: '501508', zip_code: '50230' });
    // ล้างช่องแยกได้ (ข้อความที่อยู่เดิมยังอยู่)
    expect((await call('PUT', `/api/v1/customers/${c.body.id}`, { ...cus, addr_geo_code: '', addr_no: '', ship_tos: [] })).status).toBe(200);
    expect((await call('GET', `/api/v1/customers/${c.body.id}`)).body).toMatchObject({ addr_geo_code: null, addr_no: null, address_1: lines.address_1 });
    // ผู้จำหน่าย / พนักงานขาย
    const s = await call('POST', '/api/v1/suppliers', { code: 'SADDR', name: 'ผู้จำหน่าย ที่อยู่', tax_id: '0105537095920', tax_branch_no: '2', ...parts, ...lines });
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    expect((await call('GET', `/api/v1/suppliers/${s.body.id}`)).body).toMatchObject(parts);
    const sp = await call('POST', '/api/v1/salespersons', { code: 'SADDR', name: 'พนักงาน ที่อยู่', address: '99/1 หมู่ 5 ตำบลสันผักหวาน อำเภอหางดง จังหวัดเชียงใหม่ 50230', ...parts });
    expect(sp.status, JSON.stringify(sp.body)).toBe(200);
    expect((await call('GET', `/api/v1/salespersons/${sp.body.id}`)).body).toMatchObject({ addr_geo_code: '501508', zip_code: '50230' });
    expect((await call('POST', '/api/v1/salespersons', { code: 'SBAD', name: 'x', addr_geo_code: '999999' })).status).toBe(400);
    // ข้ามบริษัทไม่ได้: บริษัทอื่นไม่เห็น/แก้ลูกค้ารายนี้
    const mine = (await call('GET', '/api/v1/auth/me')).body.company?.id as string;
    const otherCo = (await call('POST', '/api/v1/companies', { code: 'ADDRX', name_th: 'บริษัทอื่น ที่อยู่', fiscal_start: '2026-01-01', chart: 'th_en' })).body.id as string;
    await call('POST', '/api/v1/auth/select', { company_id: otherCo });
    expect((await call('GET', `/api/v1/customers/${c.body.id}`)).status).toBe(404);
    expect((await call('PUT', `/api/v1/customers/${c.body.id}`, cus)).status).toBe(404);
    // กิจการ (ทดสอบในบริษัทอื่น — ไม่แตะเลขผู้เสียภาษีของบริษัทหลักที่ชุดทดสอบถัดไปใช้) · รหัสไปรษณีย์ 5 หลัก
    const co = (await call('GET', '/api/v1/company')).body;
    const coBody = { ...co, tax_id: '0105537095903', vat_rate: Number(co.vat_rate), tax_branch_no: '0', ...parts, address_th_1: lines.address_1, address_th_2: 'ตำบลสันผักหวาน อำเภอหางดง จังหวัดเชียงใหม่ 50230' };
    expect((await call('PUT', '/api/v1/company', { ...coBody, zip_code: '5023' })).status).toBe(400);
    expect((await call('PUT', '/api/v1/company', { ...coBody, addr_geo_code: '501500' })).status).toBe(400);
    { const r = await call('PUT', '/api/v1/company', coBody); expect(r.status, JSON.stringify(r.body)).toBe(200); }
    expect((await call('GET', '/api/v1/company')).body).toMatchObject({ ...parts, address_th_1: lines.address_1 });
    const br = await call('POST', '/api/v1/branches', { code: 'BADDR', name: 'สาขาหางดง', tax_branch_no: '00077', address: 'x', ...parts });
    expect(br.status, JSON.stringify(br.body)).toBe(200);
    expect((await call('GET', '/api/v1/branches')).body.find((b: { id: string }) => b.id === br.body.id)).toMatchObject(parts);
    expect((await call('PUT', `/api/v1/branches/${br.body.id}`, { code: 'BADDR', name: 'สาขาหางดง', tax_branch_no: '00077', addr_geo_code: '501500' })).status).toBe(400);
    await call('POST', '/api/v1/auth/select', { company_id: mine });
    // ลบเพื่อไม่กระทบชุดทดสอบถัดไป
    expect((await call('DELETE', `/api/v1/customers/${c.body.id}`)).status).toBe(200);
    expect((await call('DELETE', `/api/v1/suppliers/${s.body.id}`)).status).toBe(200);
  });

  it('master data added from the field (docs/18 ข้อ 12): new lookup tables seeded, quick add with next code, duplicates refused, other company isolated', async () => {
    // บริษัทใหม่ได้รายการตั้งต้นของตาราง 70–76
    const otherCo = (await call('POST', '/api/v1/companies', { code: 'LKNEW', name_th: 'บริษัท ตารางข้อมูลใหม่', fiscal_start: '2026-01-01', chart: 'th_en' })).body.id as string;
    const mine = (await call('GET', '/api/v1/auth/me')).body.company?.id as string;
    await call('POST', '/api/v1/auth/select', { company_id: otherCo });
    const seeded = (await call('GET', '/api/v1/lookups?types=70,71,72,73,74,75,76')).body;
    expect(seeded['70'].map((r: { name: string }) => r.name)).toEqual(expect.arrayContaining(['บริษัท', 'ห้างหุ้นส่วนจำกัด', 'นาย']));
    expect(seeded['75'].map((r: { name: string }) => r.name)).toContain('คีย์ข้อมูลผิด');
    for (const t of ['71', '72', '73', '74', '76']) expect(seeded[t].length).toBeGreaterThan(0);
    // เพิ่มเร็วจากช่อง: ไม่ใส่รหัส = รหัสถัดไป · ชื่อซ้ำ/รหัสซ้ำ = ไม่รับ · ตารางไม่มีจริง = 404 · หน่วยนับต้องมีอัตรา
    const n70 = seeded['70'].length as number;
    const add = await call('POST', '/api/v1/data-tables/70/rows', { name_th: 'ว่าที่ร้อยตรี', name_en: 'Acting Sub Lt.' });
    expect(add.status, JSON.stringify(add.body)).toBe(201);
    expect(add.body).toMatchObject({ code: String(n70 + 1).padStart(2, '0'), name: 'ว่าที่ร้อยตรี' });
    expect((await call('POST', '/api/v1/data-tables/70/rows', { name_th: 'ว่าที่ร้อยตรี' })).body.error.message).toMatch(/มี "ว่าที่ร้อยตรี" อยู่แล้ว/);
    { const dup = await call('POST', '/api/v1/data-tables/70/rows', { code: '01', name_th: 'อื่น ๆ' }); expect(dup.status).toBe(409); expect(dup.body.error).toMatchObject({ code: 'DUPLICATE_CODE' }); expect(dup.body.error.message).toMatch(/รหัส 01 มีอยู่แล้ว/); }
    // คลังสินค้า (ใช้จาก WTS-POS ผ่านกุญแจ API ได้ — ไม่แทนทั้งตาราง) · ระบุสาขาได้ · สาขาบริษัทอื่น/ตารางอื่น = ไม่รับ
    const hq = (await call('GET', '/api/v1/branches')).body.find((b: { is_head_office: boolean }) => b.is_head_office).id as string;
    const wh = await call('POST', '/api/v1/data-tables/21/rows', { code: 'WPOS', name_th: 'คลังหน้าร้าน', branch_id: hq });
    expect(wh.status, JSON.stringify(wh.body)).toBe(201);
    expect((await call('GET', '/api/v1/lookups?types=WH')).body.WH.find((w: { id: string }) => w.id === wh.body.id)).toMatchObject({ code: 'WPOS' });
    expect((await call('POST', '/api/v1/data-tables/21/rows', { code: 'WPOS', name_th: 'คลังซ้ำ' })).status).toBe(409);
    expect((await call('POST', '/api/v1/data-tables/70/rows', { name_th: 'ผิดตาราง', branch_id: hq })).status).toBe(400);
    expect((await call('POST', '/api/v1/data-tables/21/rows', { code: 'WX', name_th: 'สาขาปลอม', branch_id: '00000000-0000-4000-8000-000000000000' })).status).toBe(400);
    expect((await call('POST', '/api/v1/data-tables/99/rows', { name_th: 'x' })).status).toBe(404);
    expect((await call('POST', '/api/v1/data-tables/20/rows', { code: 'PK', name_th: 'แพ็ก', rate: 0 })).status).toBe(400);
    const unit = await call('POST', '/api/v1/data-tables/20/rows', { code: 'PK6', name_th: 'แพ็ก 6', rate: '6' });
    expect(unit.status, JSON.stringify(unit.body)).toBe(201);
    expect((await call('GET', '/api/v1/lookups?types=UNIT')).body.UNIT.find((u: { id: string }) => u.id === unit.body.id)).toMatchObject({ code: 'PK6' });
    expect((await call('GET', '/api/v1/data-tables/70')).body.find((r: { code: string }) => r.code === add.body.code)).toMatchObject({ name_th: 'ว่าที่ร้อยตรี', name_en: 'Acting Sub Lt.', status: 'A' });
    // บริษัทอื่นไม่เห็นรายการที่เพิ่ม
    await call('POST', '/api/v1/auth/select', { company_id: mine });
    expect((await call('GET', '/api/v1/lookups?types=70')).body['70'].map((r: { name: string }) => r.name)).not.toContain('ว่าที่ร้อยตรี');
    // บริษัทหลักของชุดทดสอบก็มีรายการตั้งต้น (บริษัทที่มีอยู่ก่อนได้จาก migration 0053)
    expect((await call('GET', '/api/v1/lookups?types=75')).body['75'].length).toBeGreaterThan(0);
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
    expect(Number(roles)).toBe(54);   // 39 + ระบบเงินเดือน 15
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
    expect(list.length).toBe(35);                                           // ประเภทเอกสารมาตรฐานของบริษัทใหม่ (รวม RD คืนเงินมัดจำ 05/11/2569)
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
    // คำอธิบายบรรทัด (เจ้าของ 17/11/2569): คำอธิบายหัวทุกบรรทัด + ป้ายบรรทัดประกอบ · ใบที่ลงไว้ก่อน (บรรทัดว่าง) แสดงรูปแบบเดียวกันตอนอ่าน
    const jv = (await call('GET', `/api/v1/gl/journals/${j.journals[0].id}`)).body as { description: string; lines: Array<{ posting_role: string; account_id: string; description: string | null }> };
    expect(jv.description).toBeTruthy();
    expect(jv.lines.map((l) => l.description)).toEqual([jv.description, jv.description, `${jv.description} · ภาษีขาย`]);
    await sql`UPDATE gl_journal_line SET description = NULL WHERE journal_id = ${j.journals[0].id}`.execute(database.db);
    expect((await call('GET', `/api/v1/gl/journals/${j.journals[0].id}`)).body.lines.map((l: { description: string | null }) => l.description)).toEqual([jv.description, jv.description, `${jv.description} · ภาษีขาย`]);
    const led = (await call('GET', `/api/v1/reports/ledger?account_id=${jv.lines[2]!.account_id}&from=2026-05-01&to=2026-05-31`)).body as { rows: Array<{ voucher_no: string; description: string | null }> };
    expect(led.rows.find((r) => r.voucher_no === 'IV0000002')?.description).toBe(`${jv.description} · ภาษีขาย`);
    // หลายบัญชี (ทุกบัญชี / ช่วงเลขที่บัญชี) ยอดเท่ากับแยกประเภทรายบัญชีและงบทดลอง
    type Sec = { account: { id: string; account_no: string }; opening: string; debit: string; credit: string; closing: string; rows: Array<{ voucher_no: string; description: string | null }> };
    const all = (await call('GET', '/api/v1/reports/ledgers?from=2026-05-01&to=2026-05-31')).body as { sections: Sec[]; debit: string; credit: string };
    const tbm = (await call('GET', '/api/v1/reports/trial-balance?from=2026-05-01&to=2026-05-31')).body as { rows: Array<{ id: string; closing: string; debit: string; credit: string }>; totals: { debit: string; credit: string } };
    expect([all.debit, all.credit]).toEqual([tbm.totals.debit, tbm.totals.credit]);
    for (const sct of all.sections) {
      const tr = tbm.rows.find((r) => r.id === sct.account.id)!;
      expect([sct.closing, sct.debit, sct.credit]).toEqual([tr.closing, tr.debit, tr.credit]);
      const one = (await call('GET', `/api/v1/reports/ledger?account_id=${sct.account.id}&from=2026-05-01&to=2026-05-31`)).body as { closing: string; rows: unknown[] };
      expect([one.closing, one.rows.length]).toEqual([sct.closing, sct.rows.length]);
    }
    const vatNo = all.sections.find((x) => x.account.id === jv.lines[2]!.account_id)!.account.account_no;
    const ranged = (await call('GET', `/api/v1/reports/ledgers?from=2026-05-01&to=2026-05-31&account_from=${encodeURIComponent(vatNo)}&account_to=${encodeURIComponent(vatNo)}`)).body as { sections: Sec[] };
    expect(ranged.sections.map((x) => x.account.account_no)).toEqual([vatNo]);
    expect(ranged.sections[0]!.rows.find((r) => r.voucher_no === 'IV0000002')?.description).toBe(`${jv.description} · ภาษีขาย`);
    const tbr = (await call('GET', `/api/v1/reports/trial-balance?from=2026-05-01&to=2026-05-31&account_from=${encodeURIComponent(vatNo)}&account_to=${encodeURIComponent(vatNo)}`)).body as { rows: Array<{ account_no: string }> };
    expect(tbr.rows.map((r) => r.account_no)).toEqual([vatNo]);
    // แผนก "ไม่ระบุ" (เจ้าของ 17/11/2569 ข้อ ข): ยอดแต่ละแผนก + ไม่ระบุแผนก = ทุกแผนก (งบทดลองและแยกประเภท)
    const dps = (await call('GET', '/api/v1/departments')).body as Array<{ id: string }>;
    const tbDebit = async (dept?: string) => ((await call('GET', `/api/v1/reports/trial-balance?from=2026-01-01&to=2026-12-31${dept ? `&department_id=${dept}` : ''}`)).body as { totals: { debit: string } }).totals.debit;
    const parts = await Promise.all([...dps.map((x) => tbDebit(x.id)), tbDebit('none')]);
    expect(parts.reduce((t, v) => t + Number(v), 0).toFixed(2)).toBe(Number(await tbDebit()).toFixed(2));
    const ledNone = (await call('GET', '/api/v1/reports/ledgers?from=2026-01-01&to=2026-12-31&department_id=none')).body as { debit: string };
    expect(ledNone.debit).toBe(parts.at(-1));
    expect((await call('GET', '/api/v1/reports/ledgers?from=2026-01-01&to=2026-12-31&department_id=abc')).status).toBe(400);
    const tb =(await call('GET', '/api/v1/reports/trial-balance?from=2026-01-01&to=2026-12-31')).body;
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
    // ทุกบรรทัดซื้อ/ขายต้องมีหน่วยนับ (เจ้าของ 18/11/2569): ไม่ส่งหน่วย + สินค้าไม่มีหน่วยนับหลัก = ไม่รับ บอกบรรทัดและวิธีแก้
    const bu = (await sql<{ u: string | null }>`SELECT base_unit_id AS u FROM md_item WHERE id = ${cpu}`.execute(database.db)).rows[0]!.u;
    await sql`UPDATE md_item SET base_unit_id = NULL WHERE id = ${cpu}`.execute(database.db);
    expect((await call('POST', '/api/v1/sales-invoices', iv)).body.error.message).toMatch(/^บรรทัดที่ 1 \(.+\): ยังไม่มีหน่วยนับ — เลือกหน่วยในช่อง "หน่วย"/);
    expect((await call('POST', '/api/v1/sales-invoices/posting-preview', iv)).body.error.message).toMatch(/ยังไม่มีหน่วยนับ/);
    await sql`UPDATE md_item SET base_unit_id = ${bu} WHERE id = ${cpu}`.execute(database.db);
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
    // กฎเหล็ก (ข้อกำหนดเจ้าของ): ใบลดหนี้ยังอ้างใบกำกับนี้อยู่ → ยกเลิก/ลบไม่ได้ ต้องจัดการใบลดหนี้ก่อน
    expect((await call('POST', `/api/v1/sales-invoices/${r.body.id}/cancel`, { reason: 'ป้อนผิด' })).body.error.message).toMatch(new RegExp(`ใบลด/เพิ่มหนี้.*${c1.body.doc_no}.*ก่อน`));
    expect((await call('POST', `/api/v1/ar-credit-notes/${c1.body.id}/cancel`, { reason: 'ป้อนผิด' })).status).toBe(200);
    expect((await call('POST', `/api/v1/sales-invoices/${r.body.id}/cancel`, { reason: 'ป้อนผิด' })).status).toBe(200);
    expect((await call('GET', `/api/v1/sales-invoices/${r.body.id}`)).body).toMatchObject({ doc_status: 'C', editable: false });
    expect((await call('PUT', `/api/v1/sales-invoices/${r.body.id}`, iv)).body.error.message).toMatch(/ยกเลิกแล้ว/);
    expect((await call('GET', `/api/v1/customers/${cus}`)).body.balance).toBe('0.00');
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
    // รับชำระก่อนวันที่บิลไม่ได้ (ข้อกำหนดเจ้าของ 31/10/2569) — บิลลงวันที่ 01/07 · วันเดียวกันได้
    expect(await err({ doc_date: '2026-06-30', payment_date: '2026-06-30' })).toMatch(/รับชำระก่อนวันที่บิลไม่ได้/);
    expect(await err({ payment_date: '2026-06-30' })).toMatch(/หลังวันที่รับเงิน\/วันที่เอกสาร \(30\/06\/2569\)/);
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
    // เช็คของเอกสาร (แท็บเช็ครับในใบสำคัญที่มาจากเอกสาร) · บริษัทอื่นไม่เห็น
    expect((await call('GET', `/api/v1/cheques?direction=R&instrument=all&header_id=${r.body.id}`)).body.rows.map((c: { cheque_no: string }) => c.cheque_no)).toEqual(['CQ1001']);
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('GET', `/api/v1/cheques?direction=R&instrument=all&header_id=${r.body.id}`)).body.rows).toEqual([]);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
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
    // หน้าจอ (เจ้าของ 18/11/2569): คำอธิบายว่าง/ช่องว่าง หรือจำนวนเงินติดลบ ไม่ผ่าน — ข้อความบอกบรรทัดและช่อง · บรรทัดว่างทั้งบรรทัดข้าม
    expect((await call('POST', '/api/v1/ar-deposits', { ...ai, lines: [{ description: '   ', amount: 1000 }] })).body.error.message).toMatch(/^บรรทัดที่ 1: .*คำอธิบาย/);
    expect((await call('POST', '/api/v1/ar-deposits/posting-preview', { ...ai, lines: [{ description: 'มัดจำ', amount: 1500 }, { description: 'คืน', amount: -500 }] })).body.error.message).toBe('บรรทัดที่ 2: จำนวนเงินต้องมากกว่า 0 — ใส่ในช่อง "จำนวนเงิน"');
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

  it('petty cash (T3.8 · ข้อกำหนดเจ้าของ 31/10/2569): DP posts Dr expense / Cr petty cash, VR posts Dr petty cash / Cr bank, old unposted DP posted at VR, reimbursed DP locked, cancel reopens, isolation', async () => {
    const typeOf = async (cls: string) => (await call('GET', `/api/v1/trade-defaults/${cls}`)).body.types[0].id as string;
    const accs = (await call('GET', '/api/v1/gl/accounts')).body as Array<{ id: string; is_control: boolean }>;
    const leaf = accs.filter((x) => !x.is_control);
    const exp = leaf[8]!.id, petty = leaf[9]!.id, control = accs.find((x) => x.is_control)!.id;
    const dpType = await typeOf('DP');
    expect((await call('POST', '/api/v1/petty-payments', { doc_type_id: dpType, doc_date: '2026-11-01', lines: [{ account_id: control, amount: 10 }] })).body.error.message).toMatch(/บัญชีคุม/);
    // ตั้งวงเงิน 5,000 + จ่ายค่าใช้จ่าย 500 — ลงบัญชีตอนจ่าย Dr ค่าใช้จ่าย / Cr เงินสดย่อย
    const dp1 = (await call('POST', '/api/v1/petty-payments', { doc_type_id: dpType, doc_date: '2026-11-01', remark: 'ตั้งวงเงินสดย่อย', lines: [{ account_id: petty, amount: 5000 }] })).body;
    const dp2 = (await call('POST', '/api/v1/petty-payments', { doc_type_id: dpType, doc_date: '2026-11-03', remark: 'ค่าเดินทาง', lines: [{ account_id: exp, description: 'ค่าแท็กซี่', amount: 300 }, { account_id: exp, description: 'ค่าทางด่วน', amount: 200 }] })).body;
    expect(dp2).toMatchObject({ doc_no: expect.stringMatching(/^DP\d{7}$/), net_amount: '500.00' });
    const jl = async (id: string) => ((await call('GET', `/api/v1/docs/${id}/journal`)).body.journals[0]?.lines ?? []).map((l: { posting_role: string; debit: string; credit: string }) => `${l.posting_role}:${l.debit}:${l.credit}`).sort();
    // บรรทัดที่รายละเอียดต่างกันแยกบรรทัดบัญชี คำอธิบาย = รายละเอียดของบรรทัดเอกสาร (เจ้าของ 17/11/2569 — สมุดรายวัน/แยกประเภทข้อความเดียวกัน)
    expect(await jl(dp2.id)).toEqual(['EXPENSE:200.00:0.00', 'EXPENSE:300.00:0.00', 'PETTY_CASH:0.00:500.00']);
    const dp2j = (await call('GET', `/api/v1/gl/journals/${(await call('GET', `/api/v1/docs/${dp2.id}/journal`)).body.journals[0].id}`)).body as { description: string; lines: Array<{ posting_role: string; description: string }> };
    expect(dp2j.lines.map((l) => `${l.posting_role}:${l.description}`)).toEqual(['EXPENSE:ค่าแท็กซี่', 'EXPENSE:ค่าทางด่วน', `PETTY_CASH:${dp2j.description}`]);
    // ลงบัญชีใหม่ทั้งชุด (HANDOFF 126 เจ้าของ "ลงบัญชีใหม่"): ใบที่ลงก่อนแก้ (ไม่มีคำอธิบายบรรทัด) → อยู่ในรายการ → ลงใหม่ ยอดรวมเท่าเดิม คำอธิบายกลับมา
    const jid2 = (await call('GET', `/api/v1/docs/${dp2.id}/journal`)).body.journals[0].id as string;
    await sql`UPDATE gl_journal_line SET description = NULL WHERE journal_id = ${jid2}`.execute(database.db);
    const cand = (await call('GET', '/api/v1/docs/repost-candidates')).body as { count: number; rows: Array<{ id: string; doc_no: string }> };
    expect(cand.rows.map((r) => r.doc_no)).toContain(dp2.doc_no);
    // บริษัทอื่นลงใหม่เอกสารของบริษัทนี้ไม่ได้ (ไม่อยู่ในรายการของบริษัทที่เลือก)
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('POST', '/api/v1/docs/repost-batch', { ids: [dp2.id] })).body).toMatchObject({ reposted: 0 });
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    const rb = (await call('POST', '/api/v1/docs/repost-batch', { ids: cand.rows.map((r) => r.id) })).body as { reposted: number; done: string[]; same_totals: boolean; before: unknown; after: unknown };
    expect(rb.done).toContain(dp2.doc_no);
    expect(rb.same_totals).toBe(true);
    expect(rb.before).toEqual(rb.after);
    expect((await call('GET', `/api/v1/gl/journals/${jid2}`)).body.lines.map((l: { description: string }) => l.description).slice(0, 2)).toEqual(['ค่าแท็กซี่', 'ค่าทางด่วน']);
    expect(((await call('GET', '/api/v1/docs/repost-candidates')).body as { rows: Array<{ doc_no: string }> }).rows.map((r) => r.doc_no)).not.toContain(dp2.doc_no);
    // ใบจ่ายเดิมที่ยังไม่ลงบัญชี (ก่อนเปลี่ยนวิธี/ย้ายจาก Express) — ลงบัญชีให้ตอนบันทึกใบเบิก
    await sql`UPDATE gl_journal SET deleted_at = now() WHERE source_header_id = ${dp1.id}`.execute(database.db);
    await sql`UPDATE doc_header SET journal_id = NULL, gl_posted = 'N' WHERE id = ${dp1.id}`.execute(database.db);
    expect(await jl(dp1.id)).toEqual([]);
    const open = async () => ((await call('GET', '/api/v1/petty-payments?open=true')).body.rows as Array<{ doc_no: string }>).map((r) => r.doc_no).sort();
    expect(await open()).toEqual([dp1.doc_no, dp2.doc_no].sort());
    // เบิกชดเชย: โอนจากบัญชีธนาคาร 5,500 → Dr เงินสดย่อย 5,500 / Cr ธนาคาร 5,500
    const tn = (await call('GET', '/api/v1/payment-methods/P')).body[0];
    const vr = { doc_type_id: await typeOf('VR'), doc_date: '2026-11-05', remark: 'เบิกชดเชย 1–3/11', dp_ids: [dp1.id, dp2.id], payments: [{ payment_method_id: tn.id, amount: 5500 }] };
    expect((await call('POST', '/api/v1/petty-reimbursements', { ...vr, dp_ids: [] })).body.error.message).toMatch(/อย่างน้อย 1 ใบ/);
    expect((await call('POST', '/api/v1/petty-reimbursements', { ...vr, cash_amount: 1 })).body.error.message).toMatch(/ไม่เท่ากับยอดจ่ายจริง/);
    const v1 = await call('POST', '/api/v1/petty-reimbursements', vr);
    expect(v1.body).toMatchObject({ doc_no: expect.stringMatching(/^VR\d{7}$/), net_amount: '5500.00', cash_amount: '0.00' });
    const j = (await call('GET', `/api/v1/docs/${v1.body.id}/journal`)).body.journals[0];
    expect(j).toMatchObject({ voucher_no: v1.body.doc_no, total_debit: '5500.00' });
    expect(j.lines.map((l: { posting_role: string; debit: string; credit: string }) => `${l.posting_role}:${l.debit}:${l.credit}`).sort()).toEqual(['PAYMENT:0.00:5500.00', 'PETTY_CASH:5500.00:0.00']);
    expect(await jl(dp1.id)).toEqual(['EXPENSE:5000.00:0.00', 'PETTY_CASH:0.00:5000.00']);
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
    expect((await call('POST', '/api/v1/ar-opening', { ...ob, doc_date: '2026-01-05' })).body.error.message).toMatch(/ก่อนวันเริ่มใช้/);
    const o1 = await call('POST', '/api/v1/ar-opening', ob);
    expect(o1.body).toMatchObject({ doc_no: 'IV68/0001', net_amount: '1070.00' });
    expect((await call('POST', '/api/v1/ar-opening', ob)).body.error.message).toMatch(/มีอยู่แล้ว/);
    // ปัดเศษไม่ตรงบิล: อัตรา 0% แล้วป้อนภาษีเอง
    const o2 = await call('POST', '/api/v1/ar-opening', { ...ob, doc_no: 'IV68/0002', vat_rate: 0, vat_amount: 69.99 });
    expect(o2.body).toMatchObject({ net_amount: '1069.99' });
    // พนักงานขาย/แผนกในลูกหนี้ยกมา (คู่กับบิลขาย — ข้อกำหนดเจ้าของ 01/11/2569) · ต้องเป็นของบริษัทนี้
    const s01 = (await call('GET', '/api/v1/salespersons')).body.find((x: { code: string }) => x.code === 'S01').id;
    const o3 = (await call('POST', '/api/v1/ar-opening', { ...ob, doc_no: 'IV68/0003', amount: 100, salesperson_id: s01 })).body;
    expect((await call('GET', `/api/v1/ar-opening/${o3.id}`)).body.salesperson_id).toBe(s01);
    expect((await call('POST', '/api/v1/ar-opening', { ...ob, doc_no: 'IV68/0004', salesperson_id: '00000000-0000-4000-8000-000000000001' })).body.error.message).toMatch(/^ไม่พบพนักงานขายนี้/);
    expect((await call('POST', '/api/v1/ar-opening', { ...ob, doc_no: 'IV68/0004', department_id: '00000000-0000-4000-8000-000000000001' })).body.error.message).toMatch(/^ไม่พบแผนกนี้/);
    expect((await call('POST', `/api/v1/ar-opening/${o3.id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
    expect((await call('GET', `/api/v1/docs/${o1.body.id}/journal`)).body.journals).toEqual([]);
    expect((await call('GET', '/api/v1/ar-opening')).body).toMatchObject({ total: '2139.99', start_date: '2026-01-01' });
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

  it('document number typed by the user (ข้อกำหนดเจ้าของ): kept, unique per company, blank = automatic', async () => {
    const typeOf = async (cls: string) => (await call('GET', `/api/v1/trade-defaults/${cls}`)).body.types[0] as { id: string; code: string; next_no: string };
    const cus = (await call('GET', '/api/v1/customers?q=C200')).body.rows[0].id;
    const cpu = (await call('GET', '/api/v1/items?q=01-INTL')).body.rows[0].id;
    const iv = await typeOf('IV');
    const base = { doc_type_id: iv.id, doc_date: '2027-08-06', party_id: cus, price_type: '2', vat_rate: 7, lines: [{ item_id: cpu, qty: 1, unit_price: 100 }] };
    const own = (await call('POST', '/api/v1/sales-invoices', { ...base, doc_no: 'IV-MAN/001' })).body;
    expect(own.doc_no).toBe('IV-MAN/001');
    expect((await call('GET', `/api/v1/docs/${own.id}/journal`)).body.journals[0].voucher_no).toBe('IV-MAN/001');
    // ซ้ำกับเอกสารอื่น (ประเภทใดก็ได้) → แจ้งให้เปลี่ยนหรือเว้นว่าง
    const dup = await call('POST', '/api/v1/sales-invoices', { ...base, doc_no: 'IV-MAN/001' });
    expect([dup.status, dup.body.error.message]).toEqual([400, expect.stringMatching(/IV-MAN\/001 มีอยู่แล้ว.*เว้นว่าง/)]);
    expect((await call('POST', '/api/v1/sales-invoices', { ...base, doc_no: 'IV 001' })).body.error.message).toMatch(/ไม่มีช่องว่าง/);
    // ต้องขึ้นต้นด้วยตัวนำหน้าของประเภทเอกสาร (ลบตัวนำหน้าไม่ได้) · คีย์แค่ตัวนำหน้า = เลขอัตโนมัติ
    const noPre = await call('POST', '/api/v1/sales-invoices', { ...base, doc_no: '56456644544' });
    expect([noPre.status, noPre.body.error.message]).toEqual([400, expect.stringContaining(`ต้องขึ้นต้นด้วย ${iv.code}`)]);
    // ว่าง = เลขอัตโนมัติตามประเภทเอกสาร
    const auto = (await call('POST', '/api/v1/sales-invoices', { ...base, doc_no: '' })).body;
    expect(auto.doc_no.startsWith(iv.code)).toBe(true);
    const re = await typeOf('RE');
    const rcpt = (await call('POST', '/api/v1/ar-receipts', { doc_type_id: re.id, doc_no: 'RE-MAN/001', doc_date: '2027-08-07', party_id: cus, settlements: [{ invoice_header_id: own.id, amount: 107 }] })).body;
    expect(rcpt.doc_no).toBe('RE-MAN/001');
    // ลิงก์เลขที่อ้างอิง (ข้อกำหนดเจ้าของ): เปิดเอกสารจากรหัสได้ชนิด/ยกมา · แท็บรายการชำระบอกชนิดเอกสาร · บริษัทอื่นเปิดไม่ได้
    expect((await call('GET', `/api/v1/locate/doc/${rcpt.id}`)).body).toMatchObject({ doc_no: 'RE-MAN/001', doc_class: 'RE', is_opening: false });
    expect((await call('GET', `/api/v1/sales-invoices/${own.id}`)).body.settlements[0]).toMatchObject({ id: rcpt.id, doc_no: 'RE-MAN/001', doc_class: 'RE' });
    expect((await call('GET', `/api/v1/locate/doc/${cus}`)).status).toBe(404);
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('GET', `/api/v1/locate/doc/${own.id}`)).status).toBe(404);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    for (const [path, x] of [['ar-receipts', rcpt.id], ['sales-invoices', own.id], ['sales-invoices', auto.id]])
      expect((await call('POST', `/api/v1/${path}/${x}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
  });

  it('delete button (ข้อกำหนดเจ้าของ): cancel first, then gone everywhere, number freed, history kept, rights + other companies', async () => {
    const typeOf = async (cls: string) => (await call('GET', `/api/v1/trade-defaults/${cls}`)).body.types[0] as { id: string; code: string };
    const cus = (await call('GET', '/api/v1/customers?q=C200')).body.rows[0].id;
    const cpu = (await call('GET', '/api/v1/items?q=01-INTL')).body.rows[0].id;
    const iv = await typeOf('IV');
    const no = `${iv.code}-DEL/001`;
    const base = { doc_type_id: iv.id, doc_date: '2027-08-08', party_id: cus, price_type: '2', vat_rate: 7, lines: [{ item_id: cpu, qty: 1, unit_price: 100 }] };
    const doc = (await call('POST', '/api/v1/sales-invoices', { ...base, doc_no: no })).body;
    const jid = (await call('GET', `/api/v1/docs/${doc.id}/journal`)).body.journals[0].id;
    // ยังไม่ยกเลิก → ลบไม่ได้ · ต้องมีเหตุผล
    expect((await call('POST', `/api/v1/docs/doc/${doc.id}/delete`, { reason: 'คีย์ผิด' })).body.error.message).toMatch(/ยกเลิกเอกสาร.*ก่อน/);
    expect((await call('POST', `/api/v1/sales-invoices/${doc.id}/cancel`, { reason: 'คีย์ผิด' })).status).toBe(200);
    expect((await call('POST', `/api/v1/docs/doc/${doc.id}/delete`, { reason: '' })).status).toBe(400);
    // บริษัทอื่นลบไม่ได้
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('POST', `/api/v1/docs/doc/${doc.id}/delete`, { reason: 'x' })).status).toBe(404);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    expect((await call('POST', `/api/v1/docs/doc/${doc.id}/delete`, { reason: 'คีย์ผิด ลบทิ้ง' })).body).toMatchObject({ ok: true, doc_no: no });
    // หายจากหน้าจอ/รายการ/ใบสำคัญ · เลขที่ว่าง ใช้ใหม่ได้ · ประวัติยังอยู่
    expect((await call('GET', `/api/v1/sales-invoices/${doc.id}`)).status).toBe(404);
    expect((await call('GET', `/api/v1/sales-invoices?q=${encodeURIComponent(no)}&status=all`)).body.rows).toHaveLength(0);
    expect((await call('GET', `/api/v1/gl/journals/${jid}`)).status).toBe(404);
    const again = (await call('POST', '/api/v1/sales-invoices', { ...base, doc_no: no })).body;
    expect(again.doc_no).toBe(no);
    const log = (await call('GET', `/api/v1/activity-log?table=doc_header&row_id=${doc.id}`)).body;
    expect(log.map((x: { action: string }) => x.action)).toEqual(expect.arrayContaining(['CANCEL', 'DELETE']));
    // เอกสารที่ยังมีเอกสารอื่นอ้างถึง ลบไม่ได้ (ใบเสร็จตัดใบนี้อยู่ → ยกเลิกใบนี้ไม่ได้ตั้งแต่แรก)
    expect((await call('POST', `/api/v1/sales-invoices/${again.id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
    expect((await call('POST', `/api/v1/docs/doc/${again.id}/delete`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
    // ใบสำคัญป้อนเอง: ยกเลิกแล้วลบได้ · ใบสำคัญจากเอกสารลบที่ต้นทาง
    const jv = (await call('POST', '/api/v1/gl/journals', { journal_book_id: bookId, voucher_date: '2027-08-08', lines: [{ account_id: cash, debit: '5' }, { account_id: capital, credit: '5' }] })).body;
    expect((await call('POST', `/api/v1/docs/journal/${jv.id}/delete`, { reason: 'x' })).body.error.message).toMatch(/ยกเลิกใบสำคัญ.*ก่อน/);
    expect((await call('POST', `/api/v1/gl/journals/${jv.id}/cancel`, { reason: 'x' })).status).toBe(200);
    expect((await call('POST', `/api/v1/docs/journal/${jv.id}/delete`, { reason: 'คีย์ซ้ำ' })).status).toBe(200);
    expect((await call('GET', `/api/v1/gl/journals/${jv.id}`)).status).toBe(404);
  });

  it('per-line VAT type (ข้อกำหนดเจ้าของ): 0 = exempt overrides the item, base shown, blank branch = head office, branch list', async () => {
    const t = (await call('GET', '/api/v1/trade-defaults/IV')).body.types[0] as { id: string };
    const cus = (await call('GET', '/api/v1/customers?q=C200')).body.rows[0].id;
    const cpu = (await call('GET', '/api/v1/items?q=01-INTL')).body.rows[0].id;
    const base = { doc_type_id: t.id, doc_date: '2027-08-09', party_id: cus, price_type: '2', vat_rate: 7, party_tax_branch_no: '' };
    const iv = (await call('POST', '/api/v1/sales-invoices', { ...base, lines: [{ item_id: cpu, qty: 1, unit_price: 1000 }, { item_id: cpu, qty: 1, unit_price: 500, vat_code: '0' }] })).body;
    const doc = (await call('GET', `/api/v1/sales-invoices/${iv.id}`)).body;
    // VAT คิดเฉพาะบรรทัดแรก 1,000 × 7% · บรรทัดที่ 2 ยกเว้น (หน้าเอกสารมาก่อนแฟ้มสินค้า)
    expect([doc.taxable_amount, doc.exempt_amount, doc.zero_rate_amount, doc.vat_amount, doc.net_amount]).toEqual(['1000.00', '500.00', '0.00', '70.00', '1570.00']);
    expect(doc.lines.map((l: { vat_code: string }) => l.vat_code)).toEqual(['1', '0']);
    expect(doc.party_tax_branch_no).toBe('00000');
    expect((await call('GET', `/api/v1/customers/${cus}`)).body.tax_branches).toContain('00000');
    expect((await call('POST', `/api/v1/sales-invoices/${iv.id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
    // รหัส 2 = อัตรา 0% แยกจาก 0 = ยกเว้น → แฟ้มภาษีขาย + ภ.พ.30 ข้อ 2 (อัตรา 0) / ข้อ 3 (ยกเว้น)
    const iv3 = (await call('POST', '/api/v1/sales-invoices', { ...base, doc_date: '2027-11-10', lines: [{ item_id: cpu, qty: 1, unit_price: 1000, vat_code: '1' }, { item_id: cpu, qty: 1, unit_price: 600, vat_code: '0' }, { item_id: cpu, qty: 1, unit_price: 400, vat_code: '2' }] })).body;
    const d3 = (await call('GET', `/api/v1/sales-invoices/${iv3.id}`)).body;
    expect([d3.taxable_amount, d3.exempt_amount, d3.zero_rate_amount, d3.vat_amount, d3.net_amount]).toEqual(['1000.00', '600.00', '400.00', '70.00', '2070.00']);
    expect(d3.lines.map((l: { vat_code: string }) => l.vat_code)).toEqual(['1', '0', '2']);
    const run = async (c: string, params: Record<string, unknown>) => (await call('POST', `/api/v1/rpt/${c}/run`, { params })).body;
    const pp = Object.fromEntries((await run('6.4', { period: '2027-11' })).rows.filter((r: { c: { no?: string } }) => r.c.no).map((r: { c: { no: string; amount: string } }) => [r.c.no, r.c.amount]));
    expect([pp['1'], pp['2'], pp['3'], pp['4'], pp['5']]).toEqual(['2000.00', '400.00', '600.00', '1000.00', '70.00']);
    // รายงานภาษีขายแยก 3 ประเภท: 7% / 0% / ยกเว้น (บิลยกเว้นทั้งใบก็เข้ารายงาน)
    const ex = (await call('POST', '/api/v1/sales-invoices', { ...base, doc_date: '2027-11-11', lines: [{ item_id: cpu, qty: 1, unit_price: 300, vat_code: '0' }] })).body;
    const tot = (await run('6.3', { period: '2027-11' })).rows.at(-1).c;
    expect([tot.base, tot.vat, tot.zero, tot.exempt]).toEqual(['1000.00', '70.00', '400.00', '900.00']);
    const pp2 = Object.fromEntries((await run('6.4', { period: '2027-11' })).rows.filter((r: { c: { no?: string } }) => r.c.no).map((r: { c: { no: string; amount: string } }) => [r.c.no, r.c.amount]));
    expect([pp2['1'], pp2['3']]).toEqual(['2300.00', '900.00']);
    expect((await call('POST', `/api/v1/sales-invoices/${ex.id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
    expect((await call('POST', `/api/v1/sales-invoices/${iv3.id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
  });

  it('iron rule (ข้อกำหนดเจ้าของ): a document used by another active document cannot be cancelled or deleted; other expense needs supplier code or name', async () => {
    const typeOf = async (cls: string) => (await call('GET', `/api/v1/trade-defaults/${cls}`)).body.types[0].id as string;
    const cus = (await call('GET', '/api/v1/customers?q=C200')).body.rows[0].id;
    const cpu = (await call('GET', '/api/v1/items?q=01-INTL')).body.rows[0].id;
    const line = [{ item_id: cpu, qty: 1, unit_price: 100 }];
    // ใบเสนอราคาที่แปลงเป็นใบสั่งขายแล้ว
    const qt = (await call('POST', '/api/v1/quotations', { doc_type_id: await typeOf('QT'), doc_date: '2027-08-12', party_id: cus, price_type: '2', vat_rate: 7, lines: line })).body;
    const so = (await call('POST', `/api/v1/quotations/${qt.id}/convert`, { doc_date: '2027-08-12' })).body;
    expect((await call('POST', `/api/v1/quotations/${qt.id}/cancel`, { reason: 'x' })).body.error.message).toMatch(new RegExp(`ยกเลิก ${qt.doc_no} ไม่ได้.*${so.doc_no}.*ก่อน`));
    expect((await call('POST', `/api/v1/docs/doc/${qt.id}/delete`, { reason: 'x' })).body.error.message).toMatch(/ยกเลิกเอกสาร.*ก่อน/);
    // ใบกำกับที่อยู่ในใบวางบิล
    const iv = (await call('POST', '/api/v1/sales-invoices', { doc_type_id: await typeOf('IV'), doc_date: '2027-08-12', party_id: cus, price_type: '2', vat_rate: 7, lines: line })).body;
    const bs = (await call('POST', '/api/v1/ar-bills', { doc_type_id: await typeOf('BS'), doc_date: '2027-08-13', party_id: cus, items: [{ invoice_header_id: iv.id }] })).body;
    expect((await call('POST', `/api/v1/sales-invoices/${iv.id}/cancel`, { reason: 'x' })).body.error.message).toMatch(new RegExp(`ใบวางบิล ${bs.doc_no}`));
    // จัดการเอกสารที่อ้างถึงก่อน แล้วจึงยกเลิกได้
    expect((await call('POST', `/api/v1/ar-bills/${bs.id}/cancel`, { reason: 'x' })).status).toBe(200);
    expect((await call('POST', `/api/v1/sales-invoices/${iv.id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
    expect((await call('POST', `/api/v1/sales-orders/${so.id}/cancel`, { reason: 'x' })).status).toBe(200);
    expect((await call('POST', `/api/v1/quotations/${qt.id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
    // ค่าใช้จ่ายอื่น: ไม่มีทั้งรหัสและชื่อผู้จำหน่าย → บันทึกไม่ได้
    const exp = (await call('GET', '/api/v1/other-expenses?q=95-5300-01')).body.rows[0].id;
    expect((await call('POST', '/api/v1/other-expense-docs', { doc_type_id: await typeOf('OE'), doc_date: '2027-08-12', price_type: '0', vat_rate: 0, lines: [{ item_id: exp, amount: 50 }] })).body.error.message).toMatch(/รหัสผู้จำหน่าย หรือคีย์ชื่อ/);
  });

  it('platform receipts (ข้อกำหนดเจ้าของ 31/10/2569): GP/commission deducted by Grab (input VAT + our WHT) and Agoda (ภ.พ.36 → input VAT next month), edit keeps tax entries, isolation', async () => {
    const typeOf = async (cls: string) => (await call('GET', `/api/v1/trade-defaults/${cls}`)).body.types[0].id as string;
    const cus = (await call('GET', '/api/v1/customers?q=C200')).body.rows[0].id;
    const cpu = (await call('GET', '/api/v1/items?q=01-INTL')).body.rows[0].id;
    const accNo = async (no: string) => ((await call('GET', '/api/v1/gl/accounts')).body as Array<{ id: string; account_no: string }>).find((x) => x.account_no === no)!.id;
    expect((await call('PUT', '/api/v1/gl/link', { link_gl: true, defaults: [{ role: 'PP36_PAYABLE', account_id: await accNo('2136-03') }, { role: 'INPUT_VAT_PP36', account_id: await accNo('1154-02') }, { role: 'WHT_RECOVERABLE', account_id: await accNo('1130-05') }] })).status).toBe(200);
    const unit = (await sql<{ u: string }>`SELECT base_unit_id AS u FROM md_item WHERE id = ${cpu}`.execute(database.db)).rows[0]!.u;
    const fee = (await sql<{ id: string }>`INSERT INTO md_item (company_id, code, name_th, item_type, base_unit_id) VALUES (${companyId}, 'EX-GP', 'ค่า GP แพลตฟอร์ม', '5', ${unit}) RETURNING id`.execute(database.db)).rows[0]!.id;
    const grab = (await call('POST', '/api/v1/suppliers', { code: 'S-GRAB', name: 'บริษัท แกร็บ ทดสอบ จำกัด', tax_id: tid(31) })).body.id;
    // ผู้ให้บริการต่างประเทศไม่มีเลขผู้เสียภาษีไทย (บริษัทนี้บังคับเลข — ใส่ตรงในฐานข้อมูล)
    const agoda = (await sql<{ id: string }>`INSERT INTO md_supplier (company_id, code, name) VALUES (${companyId}, 'S-AGODA', 'Agoda Company Pte. Ltd.') RETURNING id`.execute(database.db)).rows[0]!.id;
    const iv = async (price: number) => (await call('POST', '/api/v1/sales-invoices', { doc_type_id: await typeOf('IV'), doc_date: '2027-03-05', party_id: cus, price_type: '2', vat_rate: 7, lines: [{ item_id: cpu, qty: 1, unit_price: price }] })).body;
    const iv1 = await iv(1000), iv2 = await iv(2000);   // 1,070 / 2,140
    // ค้นหาคู่ค้าในหน้ารับ/จ่ายชำระ (open=1): เฉพาะรายที่มีบิลค้าง พร้อมจำนวนบิล (ข้อกำหนดเจ้าของ 31/10/2569)
    const oc = (await call('GET', '/api/v1/customers?q=C200&open=1')).body.rows;
    expect([oc.length, oc[0]?.open_count >= 2]).toEqual([1, true]);
    expect((await call('POST', '/api/v1/customers', { code: 'C-NOBILL', name: 'ลูกค้าไม่มีบิล', tax_id: tid(32) })).status).toBe(200);
    expect((await call('GET', '/api/v1/customers?q=C-NOBILL&open=1')).body.rows).toEqual([]);
    expect((await call('GET', '/api/v1/customers?q=C-NOBILL')).body.rows[0]).toMatchObject({ code: 'C-NOBILL', open_count: 0 });
    expect((await call('GET', '/api/v1/suppliers?q=S-GRAB&open=1')).body.rows).toEqual([]);
    // Grab: ขาย 1,070 · GP 300 + VAT 21 = 321 → รับ 749 · เราหัก ณ ที่จ่าย 3% = 9 (ภ.ง.ด.53)
    const gp = { supplier_id: grab, item_id: fee, description: 'ค่า GP มี.ค.', amount: 300, vat_type: '1', vat_amount: 21, tax_invoice_no: 'GRAB-INV-1', tax_invoice_date: '2027-03-10', wht_form: 'S53', wht_income_type: 'ค่าบริการ', wht_rate: 3, wht_amount: 9 };
    const re1 = { doc_type_id: await typeOf('RE'), doc_date: '2027-03-12', party_id: cus, settlements: [{ invoice_header_id: iv1.id, amount: 1070 }], charges: [gp] };
    const err = async (b: object) => (await call('POST', '/api/v1/ar-receipts', { ...re1, ...b })).body.error.message as string;
    expect(await err({ charges: [{ ...gp, tax_invoice_no: '' }] })).toMatch(/เลขที่ใบกำกับภาษีของผู้ให้บริการ/);
    expect(await err({ charges: [{ ...gp, wht_income_type: '' }] })).toMatch(/ประเภทเงินได้/);
    expect(await err({ charges: [{ ...gp, amount: 0 }] })).toMatch(/มากกว่า 0/);
    expect(await err({ cash_amount: 1070 })).toMatch(/รายการที่แพลตฟอร์มหัก/);
    // ข้ามบริษัท: ผู้ให้บริการของบริษัทอื่นใช้ไม่ได้
    const foreign = (await sql<{ id: string }>`INSERT INTO md_supplier (company_id, code, name) VALUES (${otherCompanyId}, 'S-OTHER', 'ผู้ให้บริการบริษัทอื่น') RETURNING id`.execute(database.db)).rows[0]!.id;
    expect(await err({ charges: [{ ...gp, supplier_id: foreign }] })).toMatch(/ไม่พบผู้ให้บริการ/);
    const r1 = (await call('POST', '/api/v1/ar-receipts', re1)).body;
    expect(r1).toMatchObject({ cash_amount: '749.00' });
    const lines = async (id: string) => ((await call('GET', `/api/v1/docs/${id}/journal`)).body.journals[0].lines as Array<{ posting_role: string; debit: string; credit: string }>).map((l) => `${l.posting_role}:${l.debit}:${l.credit}`).sort();
    expect(await lines(r1.id)).toEqual(['AR:0.00:1070.00', 'CASH:749.00:0.00', 'INPUT_VAT:21.00:0.00', 'PLATFORM_FEE:300.00:0.00', 'WHT_PAYABLE:0.00:9.00', 'WHT_RECOVERABLE:9.00:0.00']);
    const vp = async (id: string, k = 'P') => ((await call('GET', `/api/v1/vat/${k}?header_id=${id}&status=all`)).body.rows as Array<{ tax_invoice_no: string; base_amount: string; vat_amount: string; party_name: string; doc_status: string; id: string }>);
    expect((await vp(r1.id)).map((v) => `${v.tax_invoice_no}:${v.base_amount}:${v.vat_amount}:${v.party_name}`)).toEqual(['GRAB-INV-1:300.00:21.00:บริษัท แกร็บ ทดสอบ จำกัด']);
    const wht = (await call('GET', '/api/v1/wht?form=S53&month=2027-03')).body.rows.filter((w: { doc_no: string }) => w.doc_no === r1.doc_no);
    expect(wht).toHaveLength(1);
    expect(wht[0]).toMatchObject({ payee_name: 'บริษัท แกร็บ ทดสอบ จำกัด', tax_amount: '9.00', paid_amount: '300.00' });
    const det = (await call('GET', `/api/v1/ar-receipts/${r1.id}`)).body;
    expect([det.charges.length, det.wht.length, det.charge_wht.length, det.charges[0].supplier_code, det.charges[0].vat_type]).toEqual([1, 0, 1, 'S-GRAB', '1']);
    // แก้ใบเสร็จ (ยอดเดิม): รายการภาษีซื้อเดิมคงไว้ (เช่นที่แก้งวดในแฟ้มภาษี) · ภาษีหัก ณ ที่จ่ายไม่ซ้ำ
    const vid = (await vp(r1.id))[0]!.id;
    expect((await call('PUT', `/api/v1/ar-receipts/${r1.id}`, { ...re1, remark: 'แก้' })).status).toBe(200);
    expect((await vp(r1.id)).map((v) => v.id)).toEqual([vid]);
    expect((await call('GET', '/api/v1/wht?form=S53&month=2027-03')).body.rows.filter((w: { doc_no: string }) => w.doc_no === r1.doc_no)).toHaveLength(1);
    // ใบใหม่ของลูกค้ารายนี้: ดึงรายการหักแบบครั้งก่อน (ไม่รวมยอดเงิน)
    const tpl = (await call('GET', `/api/v1/ar-receipts/charge-template?party_id=${cus}`)).body.rows;
    expect(tpl.map((c: { supplier_code: string; item_code: string; amount: string; wht_rate: string }) => `${c.supplier_code}:${c.item_code}:${c.amount}:${Number(c.wht_rate)}`)).toEqual(['S-GRAB:EX-GP:0:3']);
    // Agoda (ต่างประเทศ): คอมมิชชั่น 300 ไม่เก็บ VAT → รับ 1,840 · เรานำส่ง ภ.พ.36 21 → ภาษีซื้อเดือน เม.ย.
    const r2 = (await call('POST', '/api/v1/ar-receipts', { ...re1, settlements: [{ invoice_header_id: iv2.id, amount: 2140 }],
      charges: [{ supplier_id: agoda, item_id: fee, amount: 300, vat_type: '3', vat_amount: 21, tax_invoice_no: 'AG-STMT-03' }] })).body;
    expect(r2).toMatchObject({ cash_amount: '1840.00' });
    expect(await lines(r2.id)).toEqual(['AR:0.00:2140.00', 'CASH:1840.00:0.00', 'INPUT_VAT_PP36:21.00:0.00', 'PLATFORM_FEE:300.00:0.00', 'PP36_PAYABLE:0.00:21.00']);
    expect(await vp(r2.id)).toEqual([]);
    const run = async (c: string, params: Record<string, unknown>) => (await call('POST', `/api/v1/rpt/${c}/run`, { params })).body;
    expect((await run('6.7', { period: '2027-03' })).rows.find((x: { t?: string }) => x.t === 'total').c).toMatchObject({ base: '300.00', vat: '21.00' });
    const s1 = (await run('6.1', { period: '2027-04' })).rows.find((x: { c: { item?: string } }) => /ภ\.พ\.36/.test(x.c.item ?? ''));
    expect(s1.c).toMatchObject({ vat: '21.00', n: 1 });
    expect((await run('6.2', { period: '2027-04' })).rows.at(-1).c.vat).toBe('21.00');
    const vc = (await call('GET', '/api/v1/gl/vat-closing?month=2027-04')).body;
    expect(vc.pp36_vat).toBe('21.00');
    expect(vc.lines.find((l: { description: string }) => /ภ\.พ\.36/.test(l.description))).toMatchObject({ credit: '21.00' });
    // ข้ามบริษัท: แม่แบบเห็นเฉพาะบริษัทตัวเอง
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('GET', `/api/v1/ar-receipts/charge-template?party_id=${cus}`)).body.rows).toEqual([]);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    // ตั้งรายการหักที่ประเภทเอกสาร (ข้อกำหนดเจ้าของ): ค่า GP / ค่าการตลาด / ค่าโฆษณา แยกบัญชี + ผู้ให้บริการ → ใบใหม่ดึงมาให้ ป้อนเฉพาะยอด
    const charges = [{ name: 'ค่า GP/คอมมิชชั่น', account_id: await accNo('5200-02'), vat_type: '1', wht_income_type: 'ค่าบริการ', wht_rate: 3 },
      { name: 'ค่าการตลาด', account_id: await accNo('5360-05'), vat_type: '1', wht_income_type: 'ค่าบริการ', wht_rate: 3 }, { name: 'ค่าโฆษณา', account_id: await accNo('5200-05'), vat_type: '1', wht_income_type: 'ค่าโฆษณา', wht_rate: 2 }];
    const dtBody = { code: 'RG', doc_class: 'RE', name_th: 'รับชำระ Grab', next_no: '1', charge_supplier_id: grab, charges };
    expect((await call('POST', '/api/v1/doc-types', { ...dtBody, charges: [{ ...charges[0], account_id: null }] })).body.error.message).toMatch(/เลือกบัญชีของรายการหัก/);
    const rg = (await call('POST', '/api/v1/doc-types', dtBody)).body.id;
    const dt = (await call('GET', `/api/v1/doc-types/${rg}`)).body;
    expect([dt.charge_supplier.code, dt.charges.map((c: { name: string; account_no: string }) => `${c.name}:${c.account_no}`)]).toEqual(['S-GRAB', ['ค่า GP/คอมมิชชั่น:5200-02', 'ค่าการตลาด:5360-05', 'ค่าโฆษณา:5200-05']]);
    const t2 = (await call('GET', `/api/v1/ar-receipts/charge-template?party_id=${cus}&type_id=${rg}`)).body;
    expect([t2.source, t2.rows.length, t2.rows[0].supplier_code, t2.rows[2].wht_income_type, Number(t2.rows[2].wht_rate)]).toEqual(['doc_type', 3, 'S-GRAB', 'ค่าโฆษณา', 2]);
    const iv3 = await iv(1000);   // 1,070 · GP 200+14 · การตลาด 50+3.50 · โฆษณา 100+7 = 374.50 → รับ 695.50 · หัก ณ ที่จ่าย 6+1.50+2 = 9.50
    const mk = (i: number, amount: number, vat: number, wht: number) => ({ supplier_id: grab, item_id: null, account_id: t2.rows[i].account_id, description: t2.rows[i].description, amount, vat_type: '1', vat_amount: vat,
      tax_invoice_no: 'GRAB-INV-2', wht_form: 'S53', wht_income_type: t2.rows[i].wht_income_type, wht_rate: t2.rows[i].wht_rate, wht_amount: wht });
    const errC = async (cs: object[]) => (await call('POST', '/api/v1/ar-receipts', { ...re1, doc_type_id: rg, settlements: [{ invoice_header_id: iv3.id, amount: 1070 }], charges: cs })).body.error.message as string;
    expect(await errC([{ ...mk(0, 10, 0.7, 0), account_id: null }])).toMatch(/เลือกรายการหัก/);
    const otherAcc = (await sql<{ id: string }>`SELECT id FROM gl_account WHERE company_id = ${otherCompanyId} LIMIT 1`.execute(database.db)).rows[0]!.id;
    expect(await errC([{ ...mk(0, 10, 0.7, 0), account_id: otherAcc }])).toMatch(/ไม่พบบัญชีของรายการหัก/);
    const r3 = (await call('POST', '/api/v1/ar-receipts', { ...re1, doc_type_id: rg, settlements: [{ invoice_header_id: iv3.id, amount: 1070 }], charges: [mk(0, 200, 14, 6), mk(1, 50, 3.5, 1.5), mk(2, 100, 7, 2)] })).body;
    expect(r3).toMatchObject({ cash_amount: '695.50' });
    const jl = ((await call('GET', `/api/v1/docs/${r3.id}/journal`)).body.journals[0].lines as Array<{ account_no: string; debit: string; posting_role: string }>).filter((l) => l.posting_role === 'PLATFORM_FEE').map((l) => `${l.account_no}:${l.debit}`).sort();
    expect(jl).toEqual(['5200-02:200.00', '5200-05:100.00', '5360-05:50.00']);
    // ภาษีหัก ณ ที่จ่าย: ค่าบริการ 3% รวมใบเดียว (250 → 7.50) · ค่าโฆษณา 2% อีกใบ
    expect((await call('GET', '/api/v1/wht?form=S53&month=2027-03')).body.rows.filter((w: { doc_no: string }) => w.doc_no === r3.doc_no).map((w: { paid_amount: string; tax_amount: string }) => `${w.paid_amount}:${w.tax_amount}`).sort()).toEqual(['100.00:2.00', '250.00:7.50']);
    expect((await call('GET', `/api/v1/ar-receipts/${r3.id}`)).body.charges.map((c: { account_no: string; item_id: string | null }) => `${c.account_no}:${c.item_id}`)).toEqual(['5200-02:null', '5360-05:null', '5200-05:null']);
    // ข้ามบริษัท: บัญชีของบริษัทอื่นใช้ไม่ได้ (ประเภทเอกสาร/ใบเสร็จ) · ประเภทเอกสารของบริษัทอื่นไม่คืนแม่แบบ
    expect((await call('PUT', `/api/v1/doc-types/${rg}`, { ...dtBody, charges: [{ ...charges[0], account_id: otherAcc }] })).status).toBe(400);
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('GET', `/api/v1/ar-receipts/charge-template?type_id=${rg}`)).body.rows).toEqual([]);
    expect((await call('GET', `/api/v1/doc-types/${rg}`)).status).toBe(404);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    expect((await call('POST', `/api/v1/ar-receipts/${r3.id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
    expect((await call('POST', `/api/v1/sales-invoices/${iv3.id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
    // พิมพ์ใบเสร็จ (ข้อกำหนดเจ้าของ): บิลภาษีเกณฑ์สิทธิ = "ใบเสร็จรับเงิน" · มีรายการสินค้าของบิลให้แบบฟอร์มเลือกแสดง · ต้นแบบที่ 5 แสดงรายการสินค้า
    const p1 = (await call('GET', `/api/v1/print/doc/${r1.id}`)).body;
    expect([p1.data.title, p1.data.receipt_tax, p1.data.detail.map((x: { kind: string; code: string }) => `${x.kind}:${x.code}`)]).toEqual(['ใบเสร็จรับเงิน', false, [`bill:${iv1.doc_no}`, 'item:01-INTL-CL-600']]);
    expect(p1.forms.find((f: { slot: number }) => f.slot === 5).layout.settle_detail).toBe('items');
    // บิลภาษีเกณฑ์เงินสด (ค่าบริการ) → "ใบเสร็จรับเงิน/ใบกำกับภาษี" แยกมูลค่าและภาษีที่ถึงกำหนด
    const ivS = (await call('POST', '/api/v1/sales-invoices', { doc_type_id: await typeOf('IV'), doc_date: '2027-03-05', party_id: cus, price_type: '2', vat_rate: 7, vat_basis: '2', lines: [{ item_id: cpu, qty: 1, unit_price: 1000 }] })).body;
    const rS = (await call('POST', '/api/v1/ar-receipts', { doc_type_id: await typeOf('RE'), doc_date: '2027-03-20', party_id: cus, settlements: [{ invoice_header_id: ivS.id, amount: 1070 }] })).body;
    const pS = (await call('GET', `/api/v1/print/doc/${rS.id}`)).body.data;
    expect([pS.title, pS.title_en, pS.receipt_tax]).toEqual(['ใบเสร็จรับเงิน/ใบกำกับภาษี', 'RECEIPT / TAX INVOICE', true]);
    expect(pS.totals.filter((t: { label: string }) => /มูลค่าสินค้า|ภาษีมูลค่าเพิ่ม/.test(t.label)).map((t: { label: string; value: string }) => `${t.label}:${t.value}`)).toEqual(['มูลค่าสินค้า/บริการ:1000.00', 'ภาษีมูลค่าเพิ่ม 7%:70.00']);
    expect((await call('GET', `/api/v1/print/doc/${(await call('GET', '/api/v1/ap-payments?limit=1')).body.rows[0].id}`)).body.data.title).toBe('ใบสำคัญจ่าย');
    expect((await call('POST', `/api/v1/ar-receipts/${rS.id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
    expect((await call('POST', `/api/v1/sales-invoices/${ivS.id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
    // ยกเลิก: ภาษีซื้อ/ภ.พ.36/ภาษีหัก ณ ที่จ่ายเป็นยกเลิก
    for (const id of [r1.id, r2.id]) expect((await call('POST', `/api/v1/ar-receipts/${id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
    expect((await vp(r1.id)).map((v) => v.doc_status)).toEqual(['C']);
    expect((await run('6.7', { period: '2027-03' })).rows.find((x: { t?: string }) => x.t === 'total').c.vat).toBe('0.00');
    expect((await call('GET', '/api/v1/wht?form=S53&month=2027-03')).body.rows.filter((w: { doc_no: string; doc_status: string }) => w.doc_no === r1.doc_no && w.doc_status !== 'C')).toHaveLength(0);
    for (const x of [iv1, iv2]) expect((await call('POST', `/api/v1/sales-invoices/${x.id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
  });

  it('AR/AP parity (ข้อกำหนดเจ้าของ 01/11/2569): supplier email, WHT rate check both sides, PO credit days from supplier, supplier credit-limit warning, search supplier bill no., purchase history by item, AP appointment, type filters', async () => {
    const typeOf = async (cls: string) => (await call('GET', `/api/v1/trade-defaults/${cls}`)).body.types[0].id as string;
    const cpu = (await call('GET', '/api/v1/items?q=01-INTL')).body.rows[0].id;
    // อีเมลผู้จำหน่าย (คู่กับลูกค้า) · อัตราหัก ณ ที่จ่ายตรวจ 0–100 ทั้งสองฝั่ง
    const sup = (await call('POST', '/api/v1/suppliers', { code: 'S-PAR', name: 'ผู้จำหน่ายเทียบลูกค้า', tax_id: tid(41), email: 'ap@example.com', credit_days: 45, credit_limit: 1000 })).body.id;
    expect((await call('GET', `/api/v1/suppliers/${sup}`)).body).toMatchObject({ email: 'ap@example.com' });
    expect((await call('POST', '/api/v1/customers', { code: 'C-PAR', name: 'ลูกค้าอัตราผิด', tax_id: tid(42), wht_rate: 150 })).status).toBe(400);
    // ใบสั่งซื้อไม่ระบุเครดิต → ใช้เครดิตของผู้จำหน่าย (เหมือนใบสั่งขายใช้ของลูกค้า)
    const po = (await call('POST', '/api/v1/purchase-orders', { doc_type_id: await typeOf('PO'), doc_date: '2027-05-02', party_id: sup, price_type: '2', vat_rate: 7, lines: [{ item_id: cpu, qty: 1, unit_price: 100 }] })).body;
    expect((await call('GET', `/api/v1/purchase-orders/${po.id}`)).body.credit_days).toBe(45);
    // ซื้อเชื่อเกินวงเงินผู้จำหน่าย → เตือน (ไม่บล็อก) · ค้นหาเลขที่บิลผู้จำหน่ายในรายการ
    const rr = (await call('POST', '/api/v1/purchase-invoices', { doc_type_id: await typeOf('RR'), doc_date: '2027-05-03', party_id: sup, price_type: '2', vat_rate: 7, ref_no: 'SUPBILL-777', lines: [{ item_id: cpu, qty: 1, unit_price: 2000 }] })).body;
    expect(rr.warnings.join(' ')).toMatch(/ซื้อเกินวงเงิน/);
    expect((await call('GET', '/api/v1/purchase-invoices?q=SUPBILL-777')).body.rows.map((r: { doc_no: string; ref_no: string }) => `${r.doc_no}:${r.ref_no}`)).toEqual([`${rr.doc_no}:SUPBILL-777`]);
    // รายงาน: ประวัติการซื้อแยกตามสินค้า · เจ้าหนี้คงค้างกรองประเภทผู้จำหน่ายได้
    const run = async (c: string, params: Record<string, unknown>) => (await call('POST', `/api/v1/rpt/${c}/run`, { params })).body;
    expect((await run('8.1.2', { date_from: '2027-05-01', date_to: '2027-05-31', supplier_from: 'S-PAR', supplier_to: 'S-PAR' })).rows.some((r: { t?: string; c: { date?: string } }) => r.t === 'group' && /01-INTL/.test(r.c.date ?? ''))).toBe(true);
    expect((await run('2.A.1', { as_of: '2027-05-31', supplier_from: 'S-PAR', supplier_to: 'S-PAR', stype_from: 'ZZ', stype_to: 'ZZ' })).rows.filter((r: { t?: string }) => !r.t).length).toBe(0);
    // วันนัดจ่ายชำระ (เหมือนวันนัดรับชำระ)
    const br = (await call('POST', '/api/v1/ap-bills', { doc_type_id: await typeOf('BR'), doc_date: '2027-05-04', party_id: sup, items: [{ invoice_header_id: rr.id }] })).body;
    expect((await call('POST', `/api/v1/ap-bills/${br.id}/appointment`, { date: '2027-06-15' })).status).toBe(200);
    expect(String((await call('GET', `/api/v1/ap-bills/${br.id}`)).body.appointment_date).slice(0, 10)).toBe('2027-06-15');
    for (const [u, x] of [['ap-bills', br.id], ['purchase-invoices', rr.id], ['purchase-orders', po.id]]) expect((await call('POST', `/api/v1/${u}/${x}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
  });

  it('on hold (ข้อกำหนดเจ้าของ 01/11/2569): ระงับการขาย blocks IV/SO for low levels and warns QT, ระงับจ่าย blocks PS/AE and warns RR, approver override logged, old docs still editable, setting blank = warn only, other tenant cannot see', async () => {
    const admin = cookie;
    const typeOf = async (cls: string) => (await call('GET', `/api/v1/trade-defaults/${cls}`)).body.types[0].id as string;
    const cpu = (await call('GET', '/api/v1/items?q=01-INTL')).body.rows[0].id;
    const login = async (u: string, pw: string) => { cookie = ''; expect((await call('POST', '/api/v1/auth/login', { username: u, password: pw })).status).toBe(200); };
    const cusHead = { code: 'C-HOLD', name: 'ลูกค้าถูกระงับ', tax_id: tid(43) }, supHead = { code: 'S-HOLD', name: 'ผู้จำหน่ายถูกระงับ', tax_id: tid(44) };
    const cus = (await call('POST', '/api/v1/customers', cusHead)).body.id, sup = (await call('POST', '/api/v1/suppliers', supHead)).body.id;
    const lines = [{ item_id: cpu, qty: 1, unit_price: 9000 }];
    const ivB = { doc_type_id: await typeOf('IV'), doc_date: '2027-05-10', party_id: cus, price_type: '2', vat_rate: 7, lines };
    const rrB = { doc_type_id: await typeOf('RR'), doc_date: '2027-05-10', party_id: sup, price_type: '2', vat_rate: 7, lines };
    const iv0 = (await call('POST', '/api/v1/sales-invoices', ivB)).body, rr0 = (await call('POST', '/api/v1/purchase-invoices', rrB)).body;
    expect(iv0.warnings).toEqual([]);
    // ระงับ + เหตุผล → เห็นในรายการ (ป้ายแดงในหน้าจอ)
    expect((await call('PUT', `/api/v1/customers/${cus}`, { ...cusHead, on_hold: true, on_hold_reason: 'ค้างชำระเกิน 90 วัน' })).status).toBe(200);
    expect((await call('PUT', `/api/v1/suppliers/${sup}`, { ...supHead, on_hold: true, on_hold_reason: 'รอใบกำกับภาษีที่ถูกต้อง' })).status).toBe(200);
    expect((await call('GET', '/api/v1/customers?q=C-HOLD')).body.rows[0]).toMatchObject({ on_hold: true, on_hold_reason: 'ค้างชำระเกิน 90 วัน' });
    expect((await call('GET', '/api/v1/suppliers?q=S-HOLD')).body.rows[0]).toMatchObject({ on_hold: true, on_hold_reason: 'รอใบกำกับภาษีที่ถูกต้อง' });
    const psB = { doc_type_id: await typeOf('PS'), doc_date: '2027-05-11', party_id: sup, settlements: [{ invoice_header_id: rr0.id, amount: 9630 }] };
    const aeB = { doc_type_id: await typeOf('AE'), doc_date: '2027-05-11', party_id: sup, price_type: '2', vat_rate: 7, lines: [{ description: 'มัดจำค่าสินค้า', amount: 100 }] };

    // พนักงานระดับ 0: ขายเชื่อ/สั่งขาย จ่ายชำระ/จ่ายมัดจำ ไม่ได้ · ใบเสนอราคา/ซื้อเชื่อ เตือน · แก้บิลเดิมได้
    await login('clerk0', 'clerk0pass');
    const e1 = await call('POST', '/api/v1/sales-invoices', ivB);
    expect([e1.status, e1.body.error.message]).toEqual([400, 'ลูกค้า C-HOLD ถูกระงับการขาย (เหตุผล: ค้างชำระเกิน 90 วัน) — ต้องให้ผู้มีระดับอนุมัติ 9 ขึ้นไปบันทึก หรือยกเลิกการระงับที่แฟ้มลูกค้า']);
    expect((await call('POST', '/api/v1/sales-orders', { ...ivB, doc_type_id: await typeOf('SO') })).body.error.message).toMatch(/ถูกระงับการขาย/);
    const qt = (await call('POST', '/api/v1/quotations', { ...ivB, doc_type_id: await typeOf('QT') })).body;
    expect(qt.warnings).toEqual(['ลูกค้า C-HOLD ถูกระงับการขาย (เหตุผล: ค้างชำระเกิน 90 วัน)']);
    expect((await call('PUT', `/api/v1/sales-invoices/${iv0.id}`, { ...ivB, remark: 'แก้หลังระงับ' })).status).toBe(200);
    expect((await call('POST', '/api/v1/ap-payments', psB)).body.error.message).toMatch(/^ผู้จำหน่าย S-HOLD ถูกระงับจ่าย \(เหตุผล: รอใบกำกับภาษีที่ถูกต้อง\)/);
    expect((await call('POST', '/api/v1/ap-deposits', aeB)).body.error.message).toMatch(/ถูกระงับจ่าย/);
    const rr1 = (await call('POST', '/api/v1/purchase-invoices', rrB)).body;
    expect(rr1.warnings.join(' ')).toMatch(/S-HOLD ถูกระงับจ่าย/);

    // ผู้มีระดับอนุมัติบันทึกได้ — เตือน + บันทึกประวัติ HOLD_OVERRIDE
    cookie = admin;
    const iv1 = (await call('POST', '/api/v1/sales-invoices', ivB)).body;
    expect(iv1.warnings.join(' ')).toMatch(/ถูกระงับการขาย .*บันทึกโดยผู้มีสิทธิ์อนุมัติ/);
    const p1 = (await call('POST', '/api/v1/ap-payments', psB)).body;
    expect(p1.warnings.join(' ')).toMatch(/ถูกระงับจ่าย/);
    const logs = await sql<{ doc_no: string }>`SELECT doc_no FROM sys_activity_log WHERE action = 'HOLD_OVERRIDE' AND doc_no IN (${iv1.doc_no}, ${p1.doc_no})`.execute(database.db);
    expect(logs.rows.map((r) => r.doc_no).sort()).toEqual([iv1.doc_no, p1.doc_no].sort());

    // ค่าเริ่มต้นระบบขาย: ระดับว่าง = เตือนอย่างเดียว
    expect((await call('PUT', '/api/v1/settings', { values: { 'ar.hold_level': null } })).status).toBe(200);
    await login('clerk0', 'clerk0pass');
    const iv2 = (await call('POST', '/api/v1/sales-invoices', ivB)).body;
    expect(iv2.warnings.join(' ')).toMatch(/ถูกระงับการขาย/);
    cookie = admin;
    expect((await call('PUT', '/api/v1/settings', { values: { 'ar.hold_level': 9 } })).status).toBe(200);

    // บริษัทอื่น: มองไม่เห็นแฟ้ม/ใช้ลูกค้าที่ถูกระงับของบริษัทนี้ไม่ได้
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('GET', `/api/v1/customers/${cus}`)).status).toBe(404);
    expect((await call('GET', '/api/v1/customers?q=C-HOLD')).body.total).toBe(0);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    for (const [u, x] of [['ap-payments', p1.id], ['sales-invoices', iv2.id], ['sales-invoices', iv1.id], ['purchase-invoices', rr1.id], ['quotations', qt.id], ['sales-invoices', iv0.id], ['purchase-invoices', rr0.id]]) expect((await call('POST', `/api/v1/${u}/${x}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
  });

  it('WHT received register 6.8 (ข้อกำหนดเจ้าของ 01/11/2569): cash sale / receipt with WHT listed, 50 ทวิ no. saved later without reposting, filters, guards, other company isolated', async () => {
    const typeOf = async (cls: string) => (await call('GET', `/api/v1/trade-defaults/${cls}`)).body.types[0].id as string;
    const cpu = (await call('GET', '/api/v1/items?q=01-INTL')).body.rows[0].id;
    const cus = (await call('POST', '/api/v1/customers', { code: 'C-WHTR', name: 'ลูกค้าหักภาษีเรา', tax_id: tid(45), price_type: '1' })).body.id;
    expect((await call('GET', `/api/v1/customers/${cus}`)).body.price_type).toBe('1');   // ประเภทราคาเริ่มต้นของลูกค้า (คู่กับผู้จำหน่าย)
    expect((await call('POST', '/api/v1/customers', { code: 'C-WHTX', name: 'x', price_type: '9' })).status).toBe(400);
    const lines = [{ item_id: cpu, qty: 1, unit_price: 10000 }];
    const hs = (await call('POST', '/api/v1/cash-sales', { doc_type_id: await typeOf('HS'), doc_date: '2027-06-05', party_id: cus, price_type: '2', vat_rate: 7, lines, wht_amount: 300 })).body;
    const iv = (await call('POST', '/api/v1/sales-invoices', { doc_type_id: await typeOf('IV'), doc_date: '2027-06-06', party_id: cus, price_type: '2', vat_rate: 7, lines })).body;
    const re = (await call('POST', '/api/v1/ar-receipts', { doc_type_id: await typeOf('RE'), doc_date: '2027-06-20', party_id: cus, settlements: [{ invoice_header_id: iv.id, amount: 10700 }], wht_amount: 300 })).body;
    expect([hs.error, re.error]).toEqual([undefined, undefined]);
    const run = async (params: Record<string, unknown>) => (await call('POST', '/api/v1/rpt/6.8/run', { params: { date_from: '2027-06-01', date_to: '2027-06-30', customer_from: 'C-WHTR', customer_to: 'C-WHTR', ...params } })).body;
    let r = await run({});
    const docs = (x: typeof r) => x.rows.filter((y: { t?: string }) => !y.t).map((y: { c: { doc: string; wht: string; cert: string } }) => `${y.c.doc}:${y.c.wht}:${y.c.cert}`);
    expect(docs(r)).toEqual([`${hs.doc_no}:300.00:ยังไม่ได้รับ`, `${re.doc_no}:300.00:ยังไม่ได้รับ`]);
    expect(r.rows.find((y: { t?: string }) => y.t === 'total').c).toMatchObject({ name: 'รวม 2 รายการ · ยังไม่ได้รับ 50 ทวิ 2 รายการ', wht: '600.00' });
    expect(r.rows[0].link).toBe(`/sa/cash-sales/${hs.id}`);
    // ได้รับ 50 ทวิ ภายหลัง: บันทึกเลขที่ได้โดยไม่แก้เอกสาร/ไม่ลงบัญชีใหม่
    const jBefore = (await call('GET', `/api/v1/docs/${re.id}/journal`)).body.journals.map((j: { id: string }) => j.id);
    expect((await call('PUT', `/api/v1/docs/doc/${re.id}/wht-cert`, { cert_no: 'BK1/0042', cert_date: '2027-06-25' })).status).toBe(200);
    expect((await call('GET', `/api/v1/ar-receipts/${re.id}`)).body).toMatchObject({ wht_cert_no: 'BK1/0042' });
    expect((await call('GET', `/api/v1/docs/${re.id}/journal`)).body.journals.map((j: { id: string }) => j.id)).toEqual(jBefore);
    expect(docs(await run({ cert: 'received' }))).toEqual([`${re.doc_no}:300.00:BK1/0042`]);
    expect(docs(await run({ cert: 'missing' }))).toEqual([`${hs.doc_no}:300.00:ยังไม่ได้รับ`]);
    const log = await sql<{ n: number }>`SELECT count(*)::int AS n FROM sys_activity_log WHERE action = 'WHT_CERT' AND doc_no = ${re.doc_no}`.execute(database.db);
    expect(log.rows[0]!.n).toBe(1);
    // เอกสารที่ไม่มีภาษีถูกหัก / วันที่ไม่มีเลขที่ → ไม่ได้
    expect((await call('PUT', `/api/v1/docs/doc/${iv.id}/wht-cert`, { cert_no: 'X1' })).body.error.message).toMatch(/ไม่มีภาษีถูกหัก/);
    expect((await call('PUT', `/api/v1/docs/doc/${hs.id}/wht-cert`, { cert_date: '2027-06-25' })).status).toBe(400);
    // บริษัทอื่นมองไม่เห็น/แก้ไม่ได้
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('PUT', `/api/v1/docs/doc/${re.id}/wht-cert`, { cert_no: 'HACK' })).status).not.toBe(200);
    expect((await call('POST', '/api/v1/rpt/6.8/run', { params: {} })).body.rows.some((y: { c: { doc?: string } }) => y.c.doc === re.doc_no)).toBe(false);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    expect((await call('GET', `/api/v1/ar-receipts/${re.id}`)).body.wht_cert_no).toBe('BK1/0042');
    // ยกเลิกแล้วหายจากทะเบียน
    for (const [u, x] of [['ar-receipts', re.id], ['sales-invoices', iv.id], ['cash-sales', hs.id]]) expect((await call('POST', `/api/v1/${u}/${x}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
    expect(docs(await run({}))).toEqual([]);
  });

  it('posting preview before save (ข้อกำหนดเจ้าของ 01/11/2569): same journal as the real save, nothing persisted, edit preview, validation errors, other company', async () => {
    const typeOf = async (cls: string) => (await call('GET', `/api/v1/trade-defaults/${cls}`)).body.types[0].id as string;
    const cpu = (await call('GET', '/api/v1/items?q=01-INTL')).body.rows[0].id;
    const cus = (await call('POST', '/api/v1/customers', { code: 'C-PREV', name: 'ลูกค้าตัวอย่างลงบัญชี', tax_id: tid(47) })).body.id;
    const ivB = { doc_type_id: await typeOf('IV'), doc_date: '2027-07-05', party_id: cus, price_type: '2', vat_rate: 7, lines: [{ item_id: cpu, qty: 1, unit_price: 9000 }] };
    const shape = (js: Array<{ lines: Array<{ posting_role: string; debit: string; credit: string }> }>) => js.flatMap((j) => j.lines.map((l) => `${l.posting_role}:${l.debit}:${l.credit}`)).sort();
    const before = (await call('GET', '/api/v1/sales-invoices?q=')).body.total;
    const logs0 = (await sql<{ n: number }>`SELECT count(*)::int AS n FROM sys_activity_log`.execute(database.db)).rows[0]!.n;
    const pv = await call('POST', '/api/v1/sales-invoices/posting-preview', ivB);
    expect(pv.status).toBe(200);
    expect(shape(pv.body.journals)).toEqual(expect.arrayContaining(['AR:9630.00:0.00', 'OUTPUT_VAT:0.00:630.00']));
    // ไม่มีอะไรถูกบันทึก: เอกสาร log เลขที่
    expect((await call('GET', '/api/v1/sales-invoices?q=')).body.total).toBe(before);
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM sys_activity_log`.execute(database.db)).rows[0]!.n).toBe(logs0);
    const iv = (await call('POST', '/api/v1/sales-invoices', ivB)).body;
    const real = (await call('GET', `/api/v1/docs/${iv.id}/journal`)).body.journals;
    expect(shape(real)).toEqual(shape(pv.body.journals));
    expect(real[0].voucher_no).toBe(pv.body.journals[0].voucher_no);   // เลขที่ใบสำคัญไม่ถูกใช้ไปตอนดูตัวอย่าง
    // แก้ไข: ดูตัวอย่างยอดใหม่ ใบจริงยังเท่าเดิม
    const ed = await call('POST', `/api/v1/sales-invoices/posting-preview?id=${iv.id}`, { ...ivB, lines: [{ item_id: cpu, qty: 2, unit_price: 9000 }] });
    expect(shape(ed.body.journals)).toEqual(expect.arrayContaining(['AR:19260.00:0.00']));
    expect(shape((await call('GET', `/api/v1/docs/${iv.id}/journal`)).body.journals)).toEqual(shape(real));
    // ข้อผิดพลาดเหมือนตอนบันทึก · รับชำระหนี้ก็ดูได้
    expect((await call('POST', '/api/v1/sales-invoices/posting-preview', { ...ivB, lines: [] })).status).toBe(400);
    const re = await call('POST', '/api/v1/ar-receipts/posting-preview', { doc_type_id: await typeOf('RE'), doc_date: '2027-07-20', party_id: cus, settlements: [{ invoice_header_id: iv.id, amount: 9630 }] });
    expect(shape(re.body.journals)).toEqual(expect.arrayContaining(['AR:0.00:9630.00']));
    expect((await call('GET', `/api/v1/sales-invoices/${iv.id}`)).body.editable).toBe(true);   // ยังไม่ถูกตัดชำระจริง
    // บริษัทอื่นใช้ลูกค้า/เอกสารของบริษัทนี้ไม่ได้
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('POST', `/api/v1/sales-invoices/posting-preview?id=${iv.id}`, ivB)).status).toBe(400);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    expect((await call('POST', `/api/v1/sales-invoices/${iv.id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
  });

  it('doc-type accounts for sales/purchase (ข้อกำหนดเจ้าของ 01/11/2569): IV Dr. ลูกหนี้ + Cr. ขาย from the doc type, receipt clears the customer account (Express), RR purchase slot when item group has none', async () => {
    const typeOf = async (cls: string) => (await call('GET', `/api/v1/trade-defaults/${cls}`)).body.types[0].id as string;
    const cpu = (await call('GET', '/api/v1/items?q=01-INTL')).body.rows[0].id;
    const accs = (await call('GET', '/api/v1/gl/accounts')).body as Array<{ id: string; account_no: string; is_control: boolean; level: number }>;
    const leaf = (no: string) => accs.find((x) => x.account_no === no)?.id ?? accs.find((x) => !x.is_control && x.account_no.startsWith(no.slice(0, 2)))!.id;
    const ivT = (await call('GET', `/api/v1/doc-types/${await typeOf('IV')}`)).body;
    const arDoc = leaf('1130-02'), salesDoc = leaf('4100-02');
    const t = await call('POST', '/api/v1/doc-types', { code: 'IVS', doc_class: 'IV', name_th: 'ขายเชื่อ-ช่องบัญชีเอกสาร', next_no: 1, journal_book_id: ivT.journal_book_id, accounts: [{ slot: 1, account_id: arDoc }, { slot: 5, account_id: salesDoc }] });
    expect(t.status).toBe(200);
    expect((await call('GET', `/api/v1/doc-types/${t.body.id}`)).body.accounts.map((x: { slot: number; role: string }) => `${x.slot}:${x.role}`)).toEqual(['1:AR', '5:SALES']);
    const cus = (await call('POST', '/api/v1/customers', { code: 'C-SLOT', name: 'ลูกค้าช่องบัญชีเอกสาร', tax_id: tid(48) })).body.id;
    const iv = (await call('POST', '/api/v1/sales-invoices', { doc_type_id: t.body.id, doc_date: '2027-07-08', party_id: cus, price_type: '2', vat_rate: 7, lines: [{ item_id: cpu, qty: 1, unit_price: 9000 }] })).body;
    const lines = async (id: string) => (await call('GET', `/api/v1/docs/${id}/journal`)).body.journals[0].lines as Array<{ account_no: string; posting_role: string; resolved_from: string; debit: string; credit: string }>;
    const ivL = await lines(iv.id);
    const accNo = (id: string) => accs.find((x) => x.id === id)!.account_no;
    expect(ivL.find((l) => l.posting_role === 'AR')).toMatchObject({ account_no: accNo(arDoc), resolved_from: '1', debit: '9630.00' });
    expect(ivL.find((l) => l.posting_role === 'SALES')).toMatchObject({ account_no: accNo(salesDoc), resolved_from: '1', credit: '9000.00' });
    // ใบเสร็จลดลูกหนี้ตามบัญชีของลูกค้า/มาตรฐาน (แบบ Express — ใบจ่ายชำระใช้บัญชีของผู้จำหน่ายเช่นกัน)
    const re = (await call('POST', '/api/v1/ar-receipts', { doc_type_id: await typeOf('RE'), doc_date: '2027-07-09', party_id: cus, settlements: [{ invoice_header_id: iv.id, amount: 9630 }] })).body;
    expect((await lines(re.id)).find((l) => l.posting_role === 'AR')!.resolved_from).not.toBe('1');
    for (const [u, x] of [['ar-receipts', re.id], ['sales-invoices', iv.id]]) expect((await call('POST', `/api/v1/${u}/${x}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
  });

  it('branch on every document (ข้อกำหนดเจ้าของ 01/11/2569): chosen branch flows to journal/VAT, edit keeps branch, manual JV never blank, foreign branch rejected, VAT/doc reports per selected branch', async () => {
    const typeOf = async (cls: string) => (await call('GET', `/api/v1/trade-defaults/${cls}`)).body.types[0].id as string;
    const cpu = (await call('GET', '/api/v1/items?q=01-INTL')).body.rows[0].id;
    const hq = (await call('GET', '/api/v1/branches')).body.find((b: { is_head_office: boolean }) => b.is_head_office).id as string;
    const b2 = (await call('POST', '/api/v1/branches', { code: 'BR2', name: 'สาขาเชียงใหม่', tax_branch_no: '00002' })).body.id as string;
    const cus = (await call('POST', '/api/v1/customers', { code: 'C-BR', name: 'ลูกค้าสาขา', tax_id: tid(49) })).body.id;
    const ivB = { doc_type_id: await typeOf('IV'), doc_date: '2027-07-12', party_id: cus, price_type: '2', vat_rate: 7, lines: [{ item_id: cpu, qty: 1, unit_price: 9000 }] };
    const branchOfRows = async (id: string) => (await sql<{ h: string; j: string | null; v: string | null }>`SELECT h.branch_id AS h, (SELECT j.branch_id FROM gl_journal j WHERE j.source_header_id = h.id AND j.doc_status <> 'C' AND j.deleted_at IS NULL LIMIT 1) AS j,
      (SELECT v.branch_id FROM tax_vat_entry v WHERE v.header_id = h.id AND v.deleted_at IS NULL LIMIT 1) AS v FROM doc_header h WHERE h.id = ${id}`.execute(database.db)).rows[0]!;
    // "ทุกสาขา" + เลือกสาขาในเอกสาร → เอกสาร ใบสำคัญ และแฟ้มภาษีขาย อยู่สาขานั้น
    const iv = (await call('POST', '/api/v1/sales-invoices', { ...ivB, branch_id: b2 })).body;
    expect(await branchOfRows(iv.id)).toEqual({ h: b2, j: b2, v: b2 });
    expect((await call('GET', `/api/v1/sales-invoices/${iv.id}`)).body.branch_id).toBe(b2);
    // แก้ไขโดยไม่ส่งสาขา = คงสาขาเดิม · ย้ายไปสำนักงานใหญ่ได้
    expect((await call('PUT', `/api/v1/sales-invoices/${iv.id}`, { ...ivB, remark: 'แก้' })).status).toBe(200);
    expect((await branchOfRows(iv.id)).h).toBe(b2);
    expect((await call('PUT', `/api/v1/sales-invoices/${iv.id}`, { ...ivB, branch_id: hq })).status).toBe(200);
    expect(await branchOfRows(iv.id)).toEqual({ h: hq, j: hq, v: hq });
    expect((await call('PUT', `/api/v1/sales-invoices/${iv.id}`, { ...ivB, branch_id: b2 })).status).toBe(200);
    // ไม่ระบุสาขา (ทุกสาขา) = สำนักงานใหญ่ · สาขาที่ไม่มี/ของบริษัทอื่น บันทึกไม่ได้
    const iv2 = (await call('POST', '/api/v1/sales-invoices', ivB)).body;
    expect((await branchOfRows(iv2.id)).h).toBe(hq);
    expect((await call('POST', '/api/v1/sales-invoices', { ...ivB, branch_id: '00000000-0000-4000-8000-000000000009' })).body.error.message).toMatch(/ไม่พบสาขานี้/);
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    const otherBr = (await call('GET', '/api/v1/branches')).body[0].id as string;
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    expect((await call('POST', '/api/v1/sales-invoices', { ...ivB, branch_id: otherBr })).status).toBe(400);
    // ใบสำคัญที่ป้อนเอง: ไม่ว่างอีก (สำนักงานใหญ่) · เลือกสาขาได้
    const jv = { journal_book_id: bookId, voucher_date: '2027-07-12', lines: [{ account_id: expense, debit: '10' }, { account_id: cash, credit: '10' }] };
    const j1 = (await call('POST', '/api/v1/gl/journals', jv)).body, j2 = (await call('POST', '/api/v1/gl/journals', { ...jv, branch_id: b2 })).body;
    const jb = async (id: string) => (await sql<{ b: string | null }>`SELECT branch_id AS b FROM gl_journal WHERE id = ${id}`.execute(database.db)).rows[0]!.b;
    expect([await jb(j1.id), await jb(j2.id)]).toEqual([hq, b2]);
    // รายงานแยกตามสาขาที่เลือกที่แถบบน: ภาษีขาย + ทะเบียนขายเชื่อ · หัวรายงานบอกสาขา
    const docsIn = async (code: string, params: Record<string, unknown>) => { const r = (await call('POST', `/api/v1/rpt/${code}/run`, { params })).body; return { subtitle: r.subtitle as string, docs: r.rows.map((x: { c: { doc?: string; no?: string } }) => x.c.doc ?? x.c.no) as string[] }; };
    await call('POST', '/api/v1/auth/select', { company_id: companyId, branch_id: b2 });
    let r = await docsIn('6.3', { period: '2027-07' });
    expect(r.docs).toContain(iv.doc_no); expect(r.docs).not.toContain(iv2.doc_no); expect(r.subtitle).toMatch(/สาขา BR2 สาขาเชียงใหม่/);
    await call('POST', '/api/v1/auth/select', { company_id: companyId, branch_id: hq });
    r = await docsIn('6.3', { period: '2027-07' });
    expect(r.docs).toContain(iv2.doc_no); expect(r.docs).not.toContain(iv.doc_no);
    // รายการเอกสาร + ลูกหนี้คงค้าง + วิเคราะห์การขาย ตามสาขาที่เลือก (ข้อกำหนดเจ้าของ 01/11/2569 รอบ 2)
    const listNos = async () => (await call('GET', '/api/v1/sales-invoices?q=&limit=500')).body.rows.map((x: { doc_no: string; branch_code?: string }) => `${x.doc_no}:${x.branch_code}`) as string[];
    const rpt = async (code: string, params: Record<string, unknown>) => JSON.stringify((await call('POST', `/api/v1/rpt/${code}/run`, { params: { customer_from: 'C-BR', customer_to: 'C-BR', ...params } })).body);
    expect(await listNos()).toContain(`${iv2.doc_no}:00000`); expect((await listNos()).some((x) => x.startsWith(iv.doc_no))).toBe(false);
    expect(await rpt('1.A.2', { as_of: '2027-07-31' })).toContain(iv2.doc_no); expect(await rpt('1.A.2', { as_of: '2027-07-31' })).not.toContain(iv.doc_no);
    await call('POST', '/api/v1/auth/select', { company_id: companyId, branch_id: b2 });
    expect(await listNos()).toEqual(expect.arrayContaining([`${iv.doc_no}:BR2`])); expect((await listNos()).some((x) => x.startsWith(iv2.doc_no))).toBe(false);
    const ar = await rpt('1.A.2', { as_of: '2027-07-31' }); expect(ar).toContain(iv.doc_no); expect(ar).not.toContain(iv2.doc_no); expect(ar).toMatch(/สาขา BR2/);
    const an = await rpt('7.1.1', { date_from: '2027-07-01', date_to: '2027-07-31' }); expect(an).toContain(iv.doc_no); expect(an).not.toContain(iv2.doc_no);
    expect(await rpt('1.F', {})).toMatch(/ยังไม่แยกตามสาขา/);   // ทะเบียนลูกค้าไม่ใช่ยอดของสาขา — หัวรายงานบอกชัด
    await call('POST', '/api/v1/auth/select', { company_id: companyId, branch_id: null });
    expect(await listNos()).toEqual(expect.arrayContaining([`${iv.doc_no}:BR2`, `${iv2.doc_no}:00000`]));
    r = await docsIn('6.3', { period: '2027-07' });
    expect(r.docs).toEqual(expect.arrayContaining([iv.doc_no, iv2.doc_no])); expect(r.subtitle).toMatch(/ทุกสาขา/);
    for (const x of [iv.id, iv2.id]) expect((await call('POST', `/api/v1/sales-invoices/${x}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
    for (const x of [j1.id, j2.id]) expect((await call('POST', `/api/v1/gl/journals/${x}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
    // ยอดยกมาบัญชีแยกสาขา: งบทดลองรายสาขารวมยอดยกมาของสาขานั้น · ว่าง = สำนักงานใหญ่ · สำนักงานใหญ่ + สาขา = ทั้งบริษัท · สาขาไม่ดุลในตัวได้คำเตือน
    const before = (await call('GET', '/api/v1/gl/opening')).body;
    const restore = before.rows.map((r: { account_id: string; department_id: string | null; branch_id: string | null; opening: string }) => ({ account_id: r.account_id, department_id: r.department_id, branch_id: r.branch_id, debit: Number(r.opening) > 0 ? r.opening : '0', credit: Number(r.opening) < 0 ? String(-Number(r.opening)) : '0' }));
    const op = await call('PUT', '/api/v1/gl/opening', { period_start: '2026-01-01', rows: [...restore,
      { account_id: cash, branch_id: null, debit: '1000', credit: '0' }, { account_id: capital, branch_id: hq, debit: '0', credit: '1200' },
      { account_id: cash, branch_id: b2, debit: '700', credit: '0' }, { account_id: capital, branch_id: b2, debit: '0', credit: '500' }] });
    expect(op.status).toBe(200);
    expect(op.body.warnings).toHaveLength(2);
    expect(op.body.warnings.join(' ')).toMatch(/BR2 สาขาเชียงใหม่ ไม่ดุล \(ต่าง 200\.00\)/);
    expect((await call('GET', '/api/v1/gl/opening')).body.rows.some((r: { branch_id: string | null; opening: string }) => r.branch_id === b2 && r.opening === '700.00')).toBe(true);
    const tbCash = async (branch?: string) => d((await call('GET', `/api/v1/reports/trial-balance?from=2026-01-01&to=2026-01-31${branch ? `&branch_id=${branch}` : ''}`)).body.rows.find((x: { id: string }) => x.id === cash)?.opening ?? 0);
    const [all, atHq, atB2] = [await tbCash(), await tbCash(hq), await tbCash(b2)];
    expect(atB2.toFixed(2)).toBe('700.00');
    expect(atHq.plus(atB2).toFixed(2)).toBe(all.toFixed(2));
    expect((await call('PUT', '/api/v1/gl/opening', { period_start: '2026-01-01', rows: [{ account_id: cash, branch_id: otherBr, debit: '1', credit: '0' }, { account_id: capital, debit: '0', credit: '1' }] })).status).toBe(400);
    expect((await call('PUT', '/api/v1/gl/opening', { period_start: '2026-01-01', rows: restore })).status).toBe(200);
  });

  it('line notes vs document notes (ข้อกำหนดเจ้าของ): keyed with the line, survive edits, print under the line only when ticked; document notes print in the notes box', async () => {
    const typeOf = async (cls: string) => (await call('GET', `/api/v1/trade-defaults/${cls}`)).body.types[0].id as string;
    const cus = (await call('GET', '/api/v1/customers?q=C200')).body.rows[0].id;
    const cpu = (await call('GET', '/api/v1/items?q=01-INTL')).body.rows[0].id;
    const body = { doc_type_id: await typeOf('IV'), doc_date: '2027-08-14', party_id: cus, price_type: '2', vat_rate: 7,
      lines: [{ item_id: cpu, qty: 1, unit_price: 100, line_note: 'ประกัน 1 ปี\nS/N 12345', line_note_print: true }, { item_id: cpu, qty: 2, unit_price: 50, line_note: 'ภายในเท่านั้น', line_note_print: false }] };
    const iv = (await call('POST', '/api/v1/sales-invoices', body)).body;
    const get = async () => (await call('GET', `/api/v1/sales-invoices/${iv.id}`)).body.lines.map((l: { line_note: string | null; line_note_print: boolean }) => [l.line_note, l.line_note_print]);
    expect(await get()).toEqual([['ประกัน 1 ปี\nS/N 12345', true], ['ภายในเท่านั้น', false]]);
    // แก้เอกสาร (บรรทัดถูกสร้างใหม่) หมายเหตุรายการยังอยู่
    expect((await call('PUT', `/api/v1/sales-invoices/${iv.id}`, { ...body, remark: 'แก้ไข' })).status).toBe(200);
    expect(await get()).toEqual([['ประกัน 1 ปี\nS/N 12345', true], ['ภายในเท่านั้น', false]]);
    // หมายเหตุเอกสาร (ทั้งเอกสาร) แยกต่างหาก
    expect((await call('PUT', `/api/v1/notes/doc/${iv.id}`, { doc: ['ส่งของภายใน 7 วัน'] })).status).toBe(200);
    const pr = (await call('GET', `/api/v1/print/doc/${iv.id}`)).body.data;
    expect(pr.lines.map((l: { note?: string }) => l.note ?? null)).toEqual(['ประกัน 1 ปี\nS/N 12345', null]);   // พิมพ์เฉพาะที่ติ๊ก
    expect(pr.notes).toEqual(['ส่งของภายใน 7 วัน']);
    // ใบสำคัญ: หมายเหตุรายการต่อบรรทัดบัญชี
    const jv = (await call('POST', '/api/v1/gl/journals', { journal_book_id: bookId, voucher_date: '2027-08-14', lines: [{ account_id: cash, debit: '5', line_note: 'เงินทอนค้าง', line_note_print: true }, { account_id: capital, credit: '5' }] })).body;
    expect((await call('GET', `/api/v1/gl/journals/${jv.id}`)).body.lines[0]).toMatchObject({ line_note: 'เงินทอนค้าง', line_note_print: true });
    expect((await call('GET', `/api/v1/print/journal/${jv.id}`)).body.data.lines[0].note).toBe('เงินทอนค้าง');
    for (const [u, x] of [['/api/v1/sales-invoices', iv.id], ['/api/v1/gl/journals', jv.id]]) expect((await call('POST', `${u}/${x}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
  });

  it('executive dashboard (RP.DASH): sales/AR/cash/aging from live documents, filters, isolation', async () => {
    const typeOf = async (cls: string) => (await call('GET', `/api/v1/trade-defaults/${cls}`)).body.types[0].id as string;
    const cus = (await call('GET', '/api/v1/customers?q=C200')).body.rows[0].id;
    const cpu = (await call('GET', '/api/v1/items?q=01-INTL')).body.rows[0].id;
    const dash = async (extra = '') => (await call('GET', `/api/v1/dashboard?from=2027-08-01&to=2027-08-31${extra}`)).body;
    const sum = (xs: (string | null)[]) => xs.reduce((t, x) => t + Number(x ?? 0), 0);
    const b0 = await dash();
    expect(b0.trend).toHaveLength(1);
    expect([b0.prev.from, b0.prev.to, b0.ly.from, b0.ly.to]).toEqual(['2027-07-01', '2027-07-31', '2026-08-01', '2026-08-31']);
    // ขายเชื่อ 2 × 500 (ก่อน VAT 1,000 · รวม VAT 1,070)
    const iv = (await call('POST', '/api/v1/sales-invoices', { doc_type_id: await typeOf('IV'), doc_date: '2027-08-05', party_id: cus, price_type: '2', vat_rate: 7, lines: [{ item_id: cpu, qty: 2, unit_price: 500 }] })).body;
    const b1 = await dash();
    expect(Number(b1.kpis.current.sales) - Number(b0.kpis.current.sales)).toBeCloseTo(1000, 2);
    expect(Number(b1.kpis.current.ar) - Number(b0.kpis.current.ar)).toBeCloseTo(1070, 2);
    expect(Number(b1.trend[0].sales)).toBeCloseTo(Number(b1.kpis.current.sales), 2);
    expect(sum(b1.aging.ar)).toBeCloseTo(Number(b1.kpis.current.ar), 2);
    expect(b1.top_items.find((x: { id: string }) => x.id === cpu)).toBeTruthy();
    expect(b1.top_customers.find((x: { id: string }) => x.id === cus)).toBeTruthy();
    // ยอดซื้อ + ผู้จำหน่าย 10 อันดับ (คู่กับยอดขาย — ข้อกำหนดเจ้าของ 01/11/2569): ซื้อเชื่อ 300 หักส่งคืน 100
    const sup = (await call('POST', '/api/v1/suppliers', { code: 'S-DASH', name: 'ผู้จำหน่ายแดชบอร์ด', tax_id: tid(46) })).body.id;
    const rr = (await call('POST', '/api/v1/purchase-invoices', { doc_type_id: await typeOf('RR'), doc_date: '2027-08-06', party_id: sup, price_type: '2', vat_rate: 7, lines: [{ item_id: cpu, qty: 3, unit_price: 100 }] })).body;
    const dn = (await call('POST', '/api/v1/ap-credit-notes', { doc_type_id: await typeOf('DN'), doc_date: '2027-08-07', party_id: sup, ref_header_id: rr.id, price_type: '2', vat_rate: 7, lines: [{ item_id: cpu, qty: 1, unit_price: 100, return_to_stock: true }] })).body;
    expect(dn.error).toBeUndefined();
    // ภาษีซื้อของใบลดหนี้: วันที่ = วันที่ใบลดหนี้ (07/08) ไม่ใช่วันที่บิลซื้อที่อ้าง (06/08) — WTS-POS B4.5
    expect((await call('GET', `/api/v1/vat/P?header_id=${dn.id}`)).body.rows[0]).toMatchObject({ doc_no: dn.doc_no, tax_invoice_no: dn.doc_no, tax_invoice_date: '2027-08-07', month: '2027-08' });
    const bp = await dash();
    expect(Number(bp.kpis.current.purchases) - Number(b1.kpis.current.purchases)).toBeCloseTo(200, 2);
    expect(bp.top_suppliers.find((x: { id: string }) => x.id === sup)).toMatchObject({ code: 'S-DASH', amount: '200.00' });
    expect(bp.kpis.current.sales).toBe(b1.kpis.current.sales);
    for (const [u, x] of [['ap-credit-notes', dn.id], ['purchase-invoices', rr.id]]) expect((await call('POST', `/api/v1/${u}/${x}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
    expect(Number(b1.kpis.current.revenue) - Number(b0.kpis.current.revenue ?? 0)).toBeCloseTo(1000, 2);
    // รายวัน: 31 ช่อง ยอดรวมเท่ากัน · กรองหมวดสินค้า
    const daily = await dash('&grain=day');
    expect(daily.trend).toHaveLength(31);
    expect(sum(daily.trend.map((t: { sales: string }) => t.sales))).toBeCloseTo(Number(b1.kpis.current.sales), 2);
    expect(Number(daily.trend[4].sales)).toBeGreaterThanOrEqual(1000);
    expect((await dash('&category=ZZZ')).kpis.current.sales).toBe('0.00');
    expect(Number((await dash('&category=01')).kpis.current.sales)).toBeGreaterThanOrEqual(1000);
    // รับชำระ → ลูกหนี้กลับเท่าเดิม เงินสดรับเพิ่ม
    const re = (await call('POST', '/api/v1/ar-receipts', { doc_type_id: await typeOf('RE'), doc_date: '2027-08-20', party_id: cus, settlements: [{ invoice_header_id: iv.id, amount: 1070 }] })).body;
    const b2 = await dash();
    expect(b2.kpis.current.ar).toBe(b0.kpis.current.ar);
    expect(Number(b2.kpis.current.cash_in) - Number(b0.kpis.current.cash_in)).toBeCloseTo(1070, 2);
    expect((await call('GET', '/api/v1/dashboard?from=2027-08-31&to=2027-08-01')).status).toBe(400);
    // บริษัทอื่นไม่เห็นข้อมูลนี้
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    const other = await dash();
    expect([other.kpis.current.sales, other.kpis.current.purchases, other.top_items, other.top_customers, other.top_suppliers, sum(other.aging.ar)]).toEqual(['0.00', '0.00', [], [], [], 0]);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    expect((await call('POST', `/api/v1/ar-receipts/${re.id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
    expect((await call('POST', `/api/v1/sales-invoices/${iv.id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
    expect((await dash()).kpis.current.sales).toBe(b0.kpis.current.sales);
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
    // รับคืน 1 (ติ๊ก R) ที่ต้นทุนเฉลี่ย · ส่งคืนผู้จำหน่าย 2 ที่ราคาคืน (ตรงกับที่ลดสินค้าในบัญชี) · ไม่ติ๊ก R ไม่กระทบสต๊อก
    const cn = (await call('POST', '/api/v1/ar-credit-notes', { doc_type_id: await typeOf('CN'), doc_date: '2026-04-06', party_id: cus, ref_header_id: i1.id, price_type: '2', vat_rate: 7, lines: [{ item_id: it, qty: 1, unit_price: 200, return_to_stock: true }] })).body;
    const cn2 = (await call('POST', '/api/v1/ar-credit-notes', { doc_type_id: await typeOf('CN'), doc_date: '2026-04-06', party_id: cus, ref_header_id: i1.id, price_type: '2', vat_rate: 7, lines: [{ item_id: it, qty: 1, unit_price: 10 }] })).body;
    expect(await bal()).toBe('17/1768.00');
    const dn = (await call('POST', '/api/v1/ap-credit-notes', { doc_type_id: await typeOf('DN'), doc_date: '2026-04-07', party_id: sup, ref_header_id: r1.id, price_type: '2', vat_rate: 7, lines: [{ item_id: it, qty: 2, unit_price: 100, return_to_stock: true }] })).body;
    expect(await bal()).toBe('15/1568.00');
    // แก้บิลขายเป็น 5 → คิดใหม่ทั้งบรรทัด · ยกเลิก → สต๊อกกลับ
    expect((await call('PUT', `/api/v1/sales-invoices/${i1.id}`, { ...iv, lines: [{ item_id: it, qty: 5, unit_price: 200 }] })).status).toBe(200);
    expect(await bal()).toBe('14/1464.00');
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
    // รายงาน 3.8 เช็คจ่ายยกเลิก/ยกเลิกการผ่าน (คู่กับเช็ครับคืน): เช็คจ่ายที่ยกเลิกการผ่านแสดงพร้อมเหตุผล · เช็ครับไม่ปน
    const r38 = (await call('POST', '/api/v1/rpt/3.8/run', { params: {} })).body.rows.filter((x: { t?: string }) => !x.t).map((x: { c: { no: string; kind: string; reason: string } }) => `${x.c.no}:${x.c.kind}:${x.c.reason}`);
    expect(r38).toContain('CP-T47-1:ยกเลิกการผ่าน:ยกเลิกการผ่าน: ล้างข้อมูลทดสอบ');
    expect(r38.some((x: string) => x.startsWith('QR-T47'))).toBe(false);
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
    // ยอดรวม (HANDOFF 152): ไม่มีส่วนลด "รวมเงิน" ซ้ำกับบรรทัดอื่น = ไม่พิมพ์ · มูลค่าสินค้า/บริการ = ไม่รวม VAT เสมอ · มีส่วนลด = เหมือนเดิม
    const tot = (x: { data: { totals: Array<{ label: string; value: string }> } }) => x.data.totals.map((t) => `${t.label}=${t.value}`);
    expect(tot(p)).toEqual(['มูลค่าสินค้า/บริการ=300.00', 'ภาษีมูลค่าเพิ่ม 7%=21.00', 'จำนวนเงินรวมทั้งสิ้น=321.00']);
    const sumCase = async (extra: Record<string, unknown>) => {
      const x = (await call('POST', '/api/v1/sales-invoices', { doc_type_id: ivType, doc_date: '2027-06-05', party_id: cus, vat_rate: 7, warehouse_id: w1, lines: [{ item_id: item, qty: 1, unit_price: 107 }], ...extra })).body as { id: string };
      const t = tot((await call('GET', `/api/v1/print/doc/${x.id}`)).body);
      expect((await call('POST', `/api/v1/sales-invoices/${x.id}/cancel`, { reason: 'ทดสอบยอดรวมที่พิมพ์' })).status).toBe(200);
      return t;
    };
    expect(await sumCase({ price_type: '1' })).toEqual(['มูลค่าสินค้า/บริการ=100.00', 'ภาษีมูลค่าเพิ่ม 7%=7.00', 'จำนวนเงินรวมทั้งสิ้น=107.00']);
    expect(await sumCase({ price_type: '0' })).toEqual(['จำนวนเงินรวมทั้งสิ้น=107.00']);
    expect(await sumCase({ price_type: '2', discount_text: '7' })).toEqual(['รวมเงิน=107.00', 'ส่วนลด 7=7.00', 'หลังหักส่วนลด=100.00', 'มูลค่าสินค้า/บริการ=100.00', 'ภาษีมูลค่าเพิ่ม 7%=7.00', 'จำนวนเงินรวมทั้งสิ้น=107.00']);
    expect(await sumCase({ price_type: '1', discount_text: '7' })).toEqual(['รวมเงิน=107.00', 'ส่วนลด 7=7.00', 'หลังหักส่วนลด=100.00', 'มูลค่าสินค้า/บริการ=93.46', 'ภาษีมูลค่าเพิ่ม 7%=6.54', 'จำนวนเงินรวมทั้งสิ้น=100.00']);
    expect(p.forms.map((f: { slot: number; base: string }) => `${f.slot}:${f.base}`)).toEqual(['1:pro', '2:plain', '3:half', '4:cont', '6:grid']);
    // ชื่อเอกสารมาตรฐาน (04/11/2569): ขายเชื่อมี VAT = ใบแจ้งหนี้/ใบกำกับภาษี (เว้นแต่ประเภทเอกสารตั้งชื่อเอง)
    const dts = (await call('GET', '/api/v1/doc-types')).body;
    const ivName = ((Array.isArray(dts) ? dts : dts.rows) as Array<{ id: string; name_th: string }>).find((t) => t.id === ivType)!.name_th;
    if (['ขายเงินเชื่อ', ''].includes(ivName)) expect([p.data.title, p.data.title_en]).toEqual(['ใบแจ้งหนี้/ใบกำกับภาษี', 'INVOICE / TAX INVOICE']);
    else expect(p.data.title).toBe(ivName);
    // แบบฟอร์มของบริษัท: ทับหมายเลข 1 + เพิ่มหมายเลข 7 (คอลัมน์ที่ไม่รู้จักถูกตัด)
    expect((await call('PUT', '/api/v1/print-forms/IV/1', { name: 'ใบกำกับภาษี/ใบส่งของ', base: 'plain', layout: { title: 'ใบกำกับภาษี', columns: [{ key: 'name' }, { key: 'amount', label: 'Amount' }, { key: 'bogus' }] } })).status).toBe(200);
    expect((await call('PUT', '/api/v1/print-forms/IV/7', { name: 'ใบส่งของครึ่งหน้า', base: 'half', layout: {} })).status).toBe(200);
    const p2 = (await call('GET', `/api/v1/print/doc/${iv.id}`)).body;
    expect(p2.forms.map((f: { slot: number; custom: boolean }) => `${f.slot}${f.custom ? '*' : ''}`)).toEqual(['1*', '2', '3', '4', '6', '7*']);
    expect(p2.forms[0].layout.title).toBe('ใบกำกับภาษี');
    expect(p2.forms[0].layout.columns.filter((c: { show: boolean }) => c.show).map((c: { key: string; label: string }) => `${c.key}:${c.label}`)).toEqual(['name:รายละเอียด', 'amount:Amount']);
    // พิมพ์ออกเครื่องพิมพ์นับครั้ง
    const first = (await call('POST', `/api/v1/print/doc/${iv.id}/printed`, { slot: 1 })).body;
    expect([first.print_count, first.copy]).toEqual([1, 'ต้นฉบับ']);
    expect((await call('GET', `/api/v1/print/doc/${iv.id}`)).body.forms[0].layout.reprint_copy).toBe(true);
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
    const again = (await call('POST', `/api/v1/print/doc/${iv.id}/printed`, { slot: 7 })).body;
    expect([again.print_count, again.copy]).toEqual([2, 'สำเนา']);
    const plog = (await sql<{ action: string; detail: { copy: string; count: number } }>`SELECT action, detail FROM sys_activity_log WHERE row_id = ${iv.id} AND action IN ('PRINT', 'REPRINT') ORDER BY seq`.execute(database.db)).rows;
    expect(plog.map((l) => `${l.action}:${l.detail.count}:${l.detail.copy}`)).toEqual(['PRINT:1:ต้นฉบับ', 'REPRINT:2:สำเนา']);
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
  it('backup / verify / restore per company and users (T6.4 · HANDOFF 146): encrypted files, wrong password, old-version restore, totals check, admin-only, cross-company/tenant blocked', async () => {
    const admin = cookie;
    const { gunzipSync, gzipSync } = await import('node:zlib');
    const { createHash } = await import('node:crypto');
    const { readFile } = await import('node:fs/promises');
    const { unsealBackup, sealBackup } = await import('../src/modules/backup.js');
    const PW = 'สำรองX-2569';
    const raw = async (method: 'GET' | 'POST', url: string, payload?: Buffer | object, extra: Record<string, string> = {}) => {
      const isBuf = Buffer.isBuffer(payload);
      const r = await app.inject({ method, url, payload: payload as never, headers: { ...(cookie ? { cookie } : {}), ...(isBuf ? { 'content-type': 'application/octet-stream' } : payload ? { 'content-type': 'application/json' } : {}), ...extra } });
      return { status: r.statusCode, buf: r.rawPayload, json: (() => { try { return JSON.parse(r.body); } catch { return null; } })(), disp: String(r.headers['content-disposition'] ?? '') };
    };
    const withPw = (pw: string, file = 'ทดสอบ.buddy') => ({ 'x-backup-password': encodeURIComponent(pw), 'x-backup-file': encodeURIComponent(file) });
    /** สร้างแฟ้มสำรองใหม่จากข้อความที่แก้แล้ว (หัวแฟ้มนับแถว/sha256 ใหม่) — จำลองแฟ้มจากโปรแกรมรุ่นเก่า */
    const rebuild = (text: string, edit: (h: Record<string, unknown>, rows: Array<[string, Record<string, unknown>]>) => Array<[string, Record<string, unknown>]>) => {
      const nl = text.indexOf('\n');
      const h = JSON.parse(text.slice(0, nl));
      const rows = text.slice(nl + 1).split('\n').filter(Boolean).map((l) => { const i = l.indexOf('\t'); return [l.slice(0, i), JSON.parse(l.slice(i + 1))] as [string, Record<string, unknown>]; });
      const out = edit(h, rows);
      const body = out.map(([t, r]) => `${t}\t${JSON.stringify(r)}`).join('\n') + '\n';
      const tables: Record<string, number> = {};
      for (const [t] of out) tables[t] = (tables[t] ?? 0) + 1;
      return gzipSync(Buffer.from(JSON.stringify({ ...h, tables, sha256: createHash('sha256').update(body).digest('hex') }) + '\n' + body));
    };
    const login = async (u: string, p: string) => { cookie = ''; expect((await call('POST', '/api/v1/auth/login', { username: u, password: p })).status).toBe(200); };
    expect((await raw('POST', '/api/v1/backup/users', { password: PW })).json.error.message).toMatch(/ผู้ดูแลของลูกค้า/);
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
    // สำรอง (ต้องตั้งรหัสผ่าน ≥ 8) → แฟ้มเข้ารหัส → ทดสอบ (ไม่มีรหัส / รหัสผิด / ถูก)
    expect((await raw('POST', '/api/v1/backup/company', { password: 'short' })).json.error.message).toMatch(/อย่างน้อย 8/);
    expect((await raw('GET', '/api/v1/backup/company')).status).not.toBe(200);   // ดาวน์โหลดแบบเดิม (ไม่เข้ารหัส) ไม่มีแล้ว
    const b = await raw('POST', '/api/v1/backup/company', { password: PW });
    expect([b.status, /\d{8}-X1\.buddy/.test(b.disp), b.buf.subarray(0, 12).toString()]).toEqual([200, true, 'BUDDYBACKUP2']);
    expect(b.buf.includes(Buffer.from('ฝ่ายขาย'))).toBe(false);
    expect((await raw('POST', '/api/v1/backup/verify', b.buf)).json.error.message).toMatch(/เข้ารหัสไว้ — ป้อนรหัสผ่าน/);
    expect((await raw('POST', '/api/v1/backup/verify', b.buf, withPw('wrong-password'))).json.error.message).toMatch(/รหัสผ่านของแฟ้มสำรองไม่ถูกต้อง/);
    const v = (await raw('POST', '/api/v1/backup/verify', b.buf, withPw(PW))).json;
    expect([v.same_company, v.schema_ok, v.schema_status, v.encrypted, v.company.code, v.rows > 100, v.totals.journals, v.totals.debit]).toEqual([true, true, 'same', true, 'X1', true, 1, '10.25']);
    const broken = Buffer.from(b.buf); broken[broken.length - 5] = broken[broken.length - 5]! ^ 0xff;
    expect((await raw('POST', '/api/v1/backup/verify', broken, withPw(PW))).json.error.message).toMatch(/เสียหาย \(รหัสผ่านถูกต้อง/);
    expect((await raw('POST', '/api/v1/backup/verify', Buffer.from('not a backup'))).json.error.message).toMatch(/เสียหาย/);
    const text = gunzipSync(unsealBackup(b.buf, PW)).toString('utf-8');
    expect(JSON.parse(text.slice(0, text.indexOf('\n')))).toMatchObject({ version: 2, totals: { journals: 1, debit: '10.25', credit: '10.25' } });
    // แฟ้มรุ่นก่อน (gzip ไม่เข้ารหัส): ยังตรวจ/นำกลับได้ พร้อมคำเตือน · แก้เนื้อแฟ้ม = ไม่สมบูรณ์
    const legacy = gzipSync(Buffer.from(text));
    expect((await raw('POST', '/api/v1/backup/verify', legacy)).json).toMatchObject({ encrypted: false, schema_ok: true });
    expect((await raw('POST', '/api/v1/backup/verify', gzipSync(Buffer.from(text.replace('ฝ่ายขาย', 'ฝ่ายขโมย'))))).json.error.message).toMatch(/ไม่สมบูรณ์/);
    // เปลี่ยนข้อมูลหลังสำรอง แล้วนำข้อมูลสำรองกลับ (ตรวจจำนวนแถว + ยอดใบสำคัญในทรานแซกชัน)
    expect((await call('PUT', `/api/v1/departments/${dept}`, { code: 'D1', name_th: 'ฝ่ายขายใหม่' })).status).toBe(200);
    expect((await call('POST', '/api/v1/departments', { code: 'D2', name_th: 'ฝ่ายบัญชี' })).status).toBe(200);
    expect((await jv('99')).status).toBe(200);
    expect((await raw('POST', '/api/v1/backup/restore', b.buf, withPw(PW))).json.error.message).toMatch(/ป้อน YES/);
    const r = await raw('POST', '/api/v1/backup/restore?confirm=YES', b.buf, withPw(PW, '20261119-X1.buddy'));
    expect([r.status, r.json.restored, r.json.upgraded_from, r.json.checks.journals, r.json.checks.debit, r.json.checks.balanced]).toEqual([200, 'X1', null, 1, '10.25', true]);
    const depts = (await call('GET', '/api/v1/departments')).body as Array<{ code: string; name_th: string }>;
    expect(depts.map((x) => `${x.code}:${x.name_th}`).filter((x) => x.startsWith('D'))).toEqual(['D1:ฝ่ายขาย']);
    expect(await tb()).toEqual(before);
    // บันทึกเหตุการณ์: ผู้ใช้ + ชื่อแฟ้ม ไม่มีรหัสผ่าน
    const logs = (await sql<{ action: string; detail: string }>`SELECT action, detail::text AS detail FROM sys_activity_log WHERE company_id = ${x1} AND action IN ('BACKUP', 'RESTORE') ORDER BY seq`.execute(database.db)).rows;
    expect(logs.map((l) => l.action)).toEqual(['BACKUP', 'RESTORE']);
    expect(logs[1]!.detail).toContain('20261119-X1.buddy');
    expect(logs.some((l) => l.detail.includes(PW) || l.detail.includes(encodeURIComponent(PW)))).toBe(false);

    // ── แฟ้มจากโปรแกรมรุ่นเก่า (โครงสร้าง 0052): ไม่มีตาราง md_supplier_branch · ไม่มีช่อง receipt_substitute/payer_employee_id/line_note_print · ไม่มีประเภท RD และตาราง 70–76
    const old = rebuild(text, (h, rows) => {
      h.schema = '0052_address_parts.sql'; h.version = 1; delete h.totals;
      return rows.filter(([t, x]) => t !== 'md_supplier_branch' && !(t === 'md_doc_type' && x.code === 'RD') && !(t === 'md_lookup' && Number(x.type_code) >= 70) && !(t === 'gl_posting_rule' && x.doc_class === 'RD'))
        .map(([t, x]) => { if (t === 'doc_header') { delete x.receipt_substitute; delete x.payer_employee_id; } if (t === 'gl_journal_line') delete x.line_note_print; return [t, x]; });
    });
    const rules = async () => (await sql<{ n: number }>`SELECT count(*)::int AS n FROM gl_posting_rule WHERE company_id = ${x1}`.execute(database.db)).rows[0]!.n;
    const rulesBefore = await rules();
    const ov = (await raw('POST', '/api/v1/backup/verify', old)).json;
    expect([ov.schema_status, ov.schema_ok, ov.schema_message, ov.steps.length >= 3]).toEqual(['older', true, 'รุ่นเก่ากว่า — นำกลับได้ ระบบจะปรับให้อัตโนมัติ', true]);
    expect((await jv('5')).status).toBe(200);
    const ro = await raw('POST', '/api/v1/backup/restore?confirm=YES', old);
    expect([ro.status, ro.json.upgraded_from, ro.json.checks?.journals, ro.json.checks?.balanced], JSON.stringify(ro.json)).toEqual([200, '0052_address_parts.sql', 1, true]);
    expect(ro.json.steps).toEqual(expect.arrayContaining(['ประเภทเอกสาร คืนเงินมัดจำ (RD)', 'ตารางข้อมูลตั้งต้น (คำนำหน้าชื่อ ตำแหน่ง …)']));
    expect(await tb()).toEqual(before);
    const after = (await sql<{ rd: number; lk: number; lnp: number }>`SELECT (SELECT count(*)::int FROM md_doc_type WHERE company_id = ${x1} AND code = 'RD' AND deleted_at IS NULL) AS rd,
        (SELECT count(*)::int FROM md_lookup WHERE company_id = ${x1} AND type_code = '70') AS lk,
        (SELECT count(*)::int FROM gl_journal_line WHERE company_id = ${x1} AND line_note_print IS NULL) AS lnp`.execute(database.db)).rows[0]!;
    expect(after).toEqual({ rd: 1, lk: 11, lnp: 0 });
    expect([rulesBefore > 0, await rules()]).toEqual([true, rulesBefore]);   // กฎการลงบัญชีที่แฟ้มเก่าไม่มี (RD) เติมจากแม่แบบหลัง commit   // ขั้นปรับข้อมูลทำแล้ว · ช่องใหม่ได้ค่าเริ่มต้น ไม่ใช่ NULL
    // รุ่นใหม่กว่า = อัปเดตโปรแกรมก่อน · ช่องที่ระบบไม่มีแล้ว = นำกลับไม่ได้ · รุ่นที่ระบบไม่รู้จัก = ปฏิเสธ
    const newer = rebuild(text, (h, rows) => { h.schema = '0999_future.sql'; return rows; });
    expect((await raw('POST', '/api/v1/backup/verify', newer)).json).toMatchObject({ schema_status: 'newer', schema_ok: false });
    expect((await raw('POST', '/api/v1/backup/restore?confirm=YES', newer)).json.error.message).toMatch(/อัปเดตโปรแกรมก่อน/);
    const gone = rebuild(text, (h, rows) => rows.map(([t, x]) => [t, t === 'md_department' ? { ...x, old_column_x: 1 } : x]));
    expect((await raw('POST', '/api/v1/backup/restore?confirm=YES', gone)).json.error.message).toMatch(/md_department: old_column_x/);
    const wrongTotals = rebuild(text, (h, rows) => { h.totals = { journals: 1, debit: '10.24', credit: '10.25' }; return rows; });
    expect((await raw('POST', '/api/v1/backup/verify', wrongTotals)).json.error.message).toMatch(/ยอดใบสำคัญในแฟ้มไม่ตรง/);
    expect((await raw('POST', '/api/v1/backup/verify', sealBackup(newer, PW), withPw(PW))).json.schema_status).toBe('newer');

    // ── ข้อมูลผู้ใช้: สำรอง (เข้ารหัส) → เปลี่ยนชื่อ → นำกลับ · แฟ้มผู้ใช้รุ่นเก่า (0059) นำกลับได้
    const u = (await call('POST', '/api/v1/users', { username: 'bx.user1', display_name: 'พนักงาน เอ็กซ์', password: 'userX1234', companies: [x1] })).body.id;
    expect((await raw('POST', '/api/v1/backup/users', { password: 'short' })).json.error.message).toMatch(/อย่างน้อย 8/);
    const ub = await raw('POST', '/api/v1/backup/users', { password: PW });
    expect([ub.status, ub.buf.subarray(0, 12).toString(), ub.buf.includes(Buffer.from('bx.user1'))]).toEqual([200, 'BUDDYBACKUP2', false]);
    expect((await call('PUT', `/api/v1/users/${u}`, { username: 'bx.user1', display_name: 'ชื่อเปลี่ยนแล้ว', companies: [x1] })).status).toBe(200);
    expect((await raw('POST', '/api/v1/backup/users/restore?confirm=YES', ub.buf, withPw('wrong-password'))).json.error.message).toMatch(/ไม่ถูกต้อง/);
    expect((await raw('POST', '/api/v1/backup/users/restore?confirm=YES', ub.buf, withPw(PW))).status).toBe(200);
    expect((await call('GET', '/api/v1/users')).body.users.find((x: { id: string }) => x.id === u).display_name).toBe('พนักงาน เอ็กซ์');
    expect((await raw('POST', '/api/v1/backup/users/restore?confirm=YES', b.buf, withPw(PW))).json.error.message).toMatch(/ไม่ใช่แฟ้มสำรองข้อมูลผู้ใช้/);
    const utext = gunzipSync(unsealBackup(ub.buf, PW)).toString('utf-8');
    const uold = rebuild(utext, (h, rows) => { h.schema = '0059_rd_etax_purpose.sql'; return rows.map(([t, x]) => { if (t === 'sys_user') delete x.app_access; return [t, x]; }); });
    const ur = await raw('POST', '/api/v1/backup/users/restore?confirm=YES', uold);
    expect([ur.status, ur.json.upgraded_from], JSON.stringify(ur.json)).toEqual([200, '0059_rd_etax_purpose.sql']);

    // ── สิทธิ์: ระดับ 5 (ไม่ใช่ผู้ดูแล) ดาวน์โหลด/นำกลับไม่ได้ จนกว่าผู้ดูแลให้สิทธิ์ที่เมนูโดยตรง · migration 0068 คงสิทธิ์ของผู้ใช้เดิม
    const lv5 = (await call('POST', '/api/v1/users', { username: 'bx.acct5', display_name: 'หัวหน้าบัญชี', password: 'acct51234', companies: [x1], approval_level: 5 })).body.id;
    expect(lv5).toBeTruthy();
    await login('bx.acct5', 'acct51234');
    await call('POST', '/api/v1/auth/select', { company_id: x1 });
    expect((await raw('POST', '/api/v1/backup/company', { password: PW })).status).toBe(403);
    expect((await raw('POST', '/api/v1/backup/restore?confirm=YES', b.buf, withPw(PW))).status).toBe(403);
    expect((await raw('POST', '/api/v1/backup/verify', b.buf, withPw(PW))).status).toBe(200);   // ทดสอบแฟ้มยังทำได้ (ไม่เปิดข้อมูล ไม่เปลี่ยนข้อมูล)
    const m0068 = await readFile(new URL('../../../db/migrations/0068_backup_rights_explicit.sql', import.meta.url), 'utf8');
    await database.execScript(m0068);   // ผู้ใช้ที่มีอยู่ก่อนอัปเกรด → ได้แถวสิทธิ์ที่เมนูโดยตรง ใช้ได้เหมือนเดิม
    expect((await raw('POST', '/api/v1/backup/company', { password: PW })).status).toBe(200);
    await database.execScript(m0068);   // รันซ้ำได้ ไม่สร้างซ้ำ
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM sys_permission p JOIN sys_menu m ON m.id = p.menu_id WHERE p.subject_id = ${lv5} AND m.code = 'OT.BACKUP' AND p.deleted_at IS NULL`.execute(database.db)).rows[0]!.n).toBe(1);

    // ── ลูกค้ารายอื่น: นำแฟ้มของ X มาใช้ไม่ได้ (แม้รู้รหัสผ่าน) · แก้หัวแฟ้มเป็นบริษัทตัวเองก็ทับข้อมูลของ X ไม่ได้
    await login('by.admin', 'passY1234');
    const y1 = (await call('POST', '/api/v1/companies', { code: 'Y1', name_th: 'บริษัท วาย จำกัด', fiscal_start: '2026-01-01', chart: 'express' })).body.id;
    await call('POST', '/api/v1/auth/select', { company_id: y1 });
    expect((await raw('POST', '/api/v1/backup/restore?confirm=YES', b.buf, withPw(PW))).json.error.message).toMatch(/เป็นของบริษัท X1/);
    const nl = text.indexOf('\n'), head = JSON.parse(text.slice(0, nl));
    const forged = gzipSync(Buffer.from(JSON.stringify({ ...head, company: { ...head.company, id: y1 } }) + '\n' + text.slice(nl + 1)));
    expect((await raw('POST', '/api/v1/backup/restore?confirm=YES', forged)).status).not.toBe(200);
    expect((await raw('POST', '/api/v1/backup/users/restore?confirm=YES', ub.buf, withPw(PW))).json.error.message).toMatch(/ลูกค้ารายอื่น/);
    await login('bx.admin', 'passX1234');
    await call('POST', '/api/v1/auth/select', { company_id: x1 });
    expect((await call('GET', '/api/v1/departments')).body.some((x: { code: string }) => x.code === 'D1')).toBe(true);
    expect(await tb()).toEqual(before);
    cookie = admin;
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
  });
  it('restore steps list covers every data-changing migration since backups exist (HANDOFF 146)', async () => {
    const { readdir, readFile } = await import('node:fs/promises');
    const { COMPANY_STEPS, USER_STEPS } = await import('../src/modules/backup.js');
    const dir = new URL('../../../db/migrations/', import.meta.url);
    const covered = new Set([...COMPANY_STEPS, ...USER_STEPS].map((s) => s.n));
    // ตรวจแล้วว่าไม่ต้องทำซ้ำตอนนำกลับ: แก้เฉพาะตารางกลาง (ไม่อยู่ในแฟ้มสำรอง)
    const GLOBAL = new Set(['sys_menu', 'md_lookup_type', 'sys_setting_def', 'sys_doc_class', 'sys_schema_migration', 'sync_change_log']);   // sync_change_log = ในฟังก์ชันทริกเกอร์ 0032 (คิวซิงก์ไม่อยู่ในแฟ้มสำรอง)
    const missing: string[] = [];
    for (const f of (await readdir(dir)).filter((x) => /^\d{4}_.*\.sql$/.test(x)).sort()) {
      const n = Number(f.slice(0, 4));
      if (n < 23) continue;
      const body = (await readFile(new URL(f, dir), 'utf8')).split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
      const touched = [...body.matchAll(/^\s*(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+([a-z_][a-z0-9_]*)/gim)].map((m) => m[1]!.toLowerCase()).filter((t) => !GLOBAL.has(t));
      if (touched.length && !covered.has(n)) missing.push(`${f}: ${[...new Set(touched)].join(', ')}`);
    }
    expect(missing).toEqual([]);
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
    expect([p.notes, p.lines[0].note]).toEqual([['ส่งของก่อน 10 โมง', 'โทรก่อนส่ง'], 'สีแดง']);   // หมายเหตุรายการพิมพ์เป็นบรรทัดใต้รายการ
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
    expect((await keyCall(rw.key, 'POST', '/api/v1/backup/company')).status).toBe(403);
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
  it('WTS Connect source ref (docs/17 B0.1): idempotent create, version edit/stale, period closed, screen lock + level-9 cancel, delete frees ref, isolation', async () => {
    const adminId = (await call('GET', '/api/v1/auth/me')).body.user.id;
    const key = (await call('POST', '/api/v1/api-keys', { name: 'WTS-HR', user_id: adminId })).body.key as string;
    const boss5 = ((await call('GET', '/api/v1/users')).body.users as Array<{ id: string; username: string }>).find((u) => u.username === 'boss5')!.id;
    const key5 = (await call('POST', '/api/v1/api-keys', { name: 'ระบบอื่น ระดับ 5', user_id: boss5 })).body.key as string;
    const send = async (method: 'POST' | 'PUT', url: string, body: unknown, src: Record<string, string>, k = key) => {
      const r = await app.inject({ method, url, payload: body as object, headers: { authorization: `Bearer ${k}`, ...Object.fromEntries(Object.entries(src).map(([n, v]) => [`x-source-${n}`, v])) } });
      return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
    };
    const book = (await call('GET', '/api/v1/gl/books')).body[0].id;
    const jv = (amt: string) => ({ journal_book_id: book, voucher_date: '2027-12-02', description: 'เงินเดือน ธ.ค.', lines: [{ account_id: expense, debit: amt }, { account_id: cash, credit: amt }] });
    const ref = { system: 'wts-sop', ref: 'sop:DEMO:2027-12' };
    // ครั้งแรกสร้าง 201 · ส่งซ้ำรุ่นเดิมได้เอกสารเดิม 200
    const a1 = await send('POST', '/api/v1/gl/journals', jv('1000.00'), { ...ref, version: '1' });
    expect([a1.status, a1.body.source_ref, a1.body.source_version]).toEqual([201, ref.ref, 1]);
    const a2 = await send('POST', '/api/v1/gl/journals', jv('1000.00'), { ...ref, version: '1' });
    expect([a2.status, a2.body.id, a2.body.duplicate, a2.body.voucher_no]).toEqual([200, a1.body.id, true, a1.body.voucher_no]);
    const n = async (r: string) => (await sql<{ n: number }>`SELECT count(*)::int AS n FROM gl_journal WHERE company_id = ${companyId} AND source_ref = ${r} AND deleted_at IS NULL`.execute(database.db)).rows[0]!.n;
    expect(await n(ref.ref)).toBe(1);
    // รุ่นสูงกว่า = แก้ใบเดิม (ยอดใหม่) · รุ่นต่ำกว่า = ปฏิเสธ
    const a3 = await send('POST', '/api/v1/gl/journals', jv('1500.00'), { ...ref, version: '2' });
    expect([a3.status, a3.body.id, a3.body.updated, a3.body.source_version]).toEqual([200, a1.body.id, true, 2]);
    const got = (await call('GET', `/api/v1/gl/journals/${a1.body.id}`)).body;
    expect([got.total_debit, got.source_system, got.source_ref, got.source_version]).toEqual(['1500.00', 'wts-sop', ref.ref, 2]);
    expect((await send('POST', '/api/v1/gl/journals', jv('900.00'), { ...ref, version: '1' })).body.error.code).toBe('STALE_VERSION');
    expect(await n(ref.ref)).toBe(1);
    // งวดปิดแล้ว → 409 PERIOD_CLOSED (ให้ส่งใบปรับปรุง)
    await sql`UPDATE gl_period SET is_locked = true WHERE company_id = ${companyId} AND start_date <= '2027-12-02' AND end_date >= '2027-12-02'`.execute(database.db);
    const pc = await send('POST', '/api/v1/gl/journals', jv('1600.00'), { ...ref, version: '3' });
    expect([pc.status, pc.body.error.code]).toEqual([409, 'PERIOD_CLOSED']);
    await sql`UPDATE gl_period SET is_locked = false WHERE company_id = ${companyId} AND start_date <= '2027-12-02' AND end_date >= '2027-12-02'`.execute(database.db);
    // ส่งหัว X-Source ผิดรูปแบบ / ไม่ใช้กุญแจ → 400
    expect((await send('POST', '/api/v1/gl/journals', jv('1.00'), { system: 'WTS POS', ref: 'x' })).body.error.code).toBe('BAD_SOURCE');
    expect((await send('POST', '/api/v1/gl/journals', jv('1.00'), { system: 'wts-pos', ref: 'r'.repeat(101) })).body.error.code).toBe('BAD_SOURCE');
    expect((await app.inject({ method: 'POST', url: '/api/v1/gl/journals', payload: jv('1.00'), headers: { cookie, 'x-source-system': 'wts-pos', 'x-source-ref': 'x' } })).statusCode).toBe(400);
    // เอกสาร (ขายสด HS) ก็ใช้ได้ · เลขอ้างอิงเดียวกันแต่ระบบต่างกัน = คนละเอกสาร
    const typeOf = async (cls: string) => (await call('GET', `/api/v1/trade-defaults/${cls}`)).body.types[0].id as string;
    const cpu = (await call('GET', '/api/v1/items?q=01-INTL')).body.rows[0].id;
    const cus = (await call('POST', '/api/v1/customers', { code: 'C-SRC', name: 'ลูกค้าหน้าร้าน', tax_id: tid(951) })).body.id;
    const hsBody = { doc_type_id: await typeOf('HS'), doc_date: '2027-12-02', party_id: cus, price_type: '1', vat_rate: 7, lines: [{ item_id: cpu, qty: 1, unit_price: 1070 }] };
    const pos = { system: 'wts-pos', ref: 'pos:BK01:2027-12-02:HS' };
    const h1 = await send('POST', '/api/v1/cash-sales', hsBody, pos);
    expect([h1.status, h1.body.net_amount, h1.body.source_version]).toEqual([201, '1070.00', 1]);
    expect((await send('POST', '/api/v1/cash-sales', hsBody, pos)).body).toMatchObject({ id: h1.body.id, doc_no: h1.body.doc_no, duplicate: true });
    const liv = await send('POST', '/api/v1/cash-sales', hsBody, { system: 'wts-living', ref: pos.ref });
    expect([liv.status, liv.body.id === h1.body.id]).toEqual([201, false]);
    const h2 = await send('POST', '/api/v1/cash-sales', { ...hsBody, lines: [{ item_id: cpu, qty: 2, unit_price: 1070 }] }, { ...pos, version: '2' });
    expect([h2.status, h2.body.id, h2.body.net_amount]).toEqual([200, h1.body.id, '2140.00']);
    expect((await call('GET', `/api/v1/cash-sales/${h1.body.id}`)).body).toMatchObject({ net_amount: '2140.00', source_system: 'wts-pos', source_version: 2 });
    // หน้าจอ Buddy แก้/ยกเลิกเอกสารจากระบบอื่นไม่ได้ (ระดับอนุมัติต่ำกว่า 9) · ระบบต้นทางยกเลิกได้
    expect((await call('PUT', `/api/v1/cash-sales/${h1.body.id}`, hsBody)).body.error.code).toBe('SOURCE_LOCKED');
    const saved = cookie; cookie = '';
    await call('POST', '/api/v1/auth/login', { username: 'boss5', password: 'boss5pass' });
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    const lk = await call('POST', `/api/v1/gl/journals/${a1.body.id}/cancel`, { reason: 'หน้าจอ' });
    expect([lk.status, lk.body.error.code]).toEqual([403, 'SOURCE_LOCKED']);
    expect(lk.body.error.message).toMatch(/WTS-HR/);
    cookie = saved;
    expect((await send('POST', `/api/v1/cash-sales/${h1.body.id}/cancel`, { reason: 'ยกเลิกที่หน้าร้าน' }, { system: 'wts-living', ref: 'x' }, key5)).body.error.code).toBe('SOURCE_LOCKED');
    expect((await send('POST', `/api/v1/cash-sales/${h1.body.id}/cancel`, { reason: 'ยกเลิกที่หน้าร้าน' }, pos)).status).toBe(200);
    expect((await send('POST', '/api/v1/cash-sales', hsBody, { ...pos, version: '3' })).body.error.code).toBe('SOURCE_CANCELLED');
    // ผู้ดูแลระดับ 9 ยกเลิก/ลบได้ (บันทึก log) · ลบแล้วเลขอ้างอิงว่าง ส่งใหม่ได้
    expect((await call('POST', `/api/v1/gl/journals/${a1.body.id}/cancel`, { reason: 'ผู้ดูแลยกเลิก' })).status).toBe(200);
    expect((await call('POST', `/api/v1/docs/journal/${a1.body.id}/delete`, { reason: 'ส่งใหม่' })).status).toBe(200);
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM sys_activity_log WHERE company_id = ${companyId} AND action = 'SOURCE_OVERRIDE' AND row_id = ${a1.body.id}`.execute(database.db)).rows[0]!.n).toBe(2);
    const a4 = await send('POST', '/api/v1/gl/journals', jv('1500.00'), { ...ref, version: '3' });
    expect([a4.status, a4.body.id === a1.body.id]).toEqual([201, false]);
    // API ที่ไม่ได้สร้างเอกสาร → ไม่รับ X-Source
    expect((await send('POST', '/api/v1/customers', { code: 'C-SRC2', name: 'x', tax_id: tid(952) }, { system: 'wts-pos', ref: 'cus:1' })).body.error.code).toBe('BAD_SOURCE');
    expect((await call('GET', '/api/v1/customers?q=C-SRC2')).body.total).toBe(0);
    // ข้ามบริษัท: เลขอ้างอิงเดียวกันในบริษัทอื่นเป็นคนละเอกสาร · บริษัทอื่นไม่เห็น/แตะเอกสารนี้ไม่ได้
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    const okey = (await call('POST', '/api/v1/api-keys', { name: 'WTS-HR B', user_id: adminId })).body.key as string;
    const obook = (await call('GET', '/api/v1/gl/books')).body[0].id;
    const oacc = (await call('GET', '/api/v1/gl/accounts')).body.filter((x: { is_control: boolean; has_children: boolean; use_department: boolean; use_project: boolean; status: string }) => !x.is_control && !x.has_children && !x.use_department && !x.use_project && x.status === 'A').slice(0, 2).map((x: { id: string }) => x.id);
    const b1 = await send('POST', '/api/v1/gl/journals', { journal_book_id: obook, voucher_date: '2026-12-02', description: 'บริษัทอื่น', lines: [{ account_id: oacc[0], debit: '5.00' }, { account_id: oacc[1], credit: '5.00' }] }, { ...ref, version: '3' }, okey);
    expect([b1.status, b1.body.error?.message]).toEqual([201, undefined]);
    expect(b1.body.id).not.toBe(a4.body.id);
    expect((await call('PUT', `/api/v1/gl/journals/${a4.body.id}`, jv('1.00'))).status).toBe(404);
    expect((await send('POST', `/api/v1/cash-sales/${h1.body.id}/cancel`, { reason: 'x' }, pos, okey)).status).toBe(404);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    expect(await n(ref.ref)).toBe(1);
    // B0.2 ยอดต้นทาง: ตรงทุกสตางค์จึงบันทึก · ต่าง 0.01 → 422 ไม่บันทึกอะไรเลย (รวมแก้รุ่นใหม่)
    const vat = { system: 'wts-pos', ref: 'pos:BK01:2027-12-02:HS-VAT' };
    const v1 = await send('POST', '/api/v1/cash-sales', { ...hsBody, source_totals: { net_amount: '1070.00', taxable_amount: '1000.00', vat_amount: '70.00', wht_amount: '0' } }, vat);
    expect([v1.status, v1.body.net_amount, v1.body.error?.message]).toEqual([201, '1070.00', undefined]);
    const mm = await send('POST', '/api/v1/cash-sales', { ...hsBody, lines: [{ item_id: cpu, qty: 3, unit_price: 1000 }], source_totals: { net_amount: '3000.00', vat_amount: '196.27' } }, { ...vat, ref: `${vat.ref}-2` });
    expect([mm.status, mm.body.error.code]).toEqual([422, 'AMOUNT_MISMATCH']);
    expect(mm.body.error.message).toMatch(/ภาษีมูลค่าเพิ่ม ต้นทาง 196\.27 · Buddy 196\.26 \(ต่าง -0\.01\)/);
    expect(mm.body.error.issues[0].field).toBe('source_totals.vat_amount');
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM doc_header WHERE company_id = ${companyId} AND source_ref = ${`${vat.ref}-2`}`.execute(database.db)).rows[0]!.n).toBe(0);
    const mv = await send('POST', '/api/v1/cash-sales', { ...hsBody, lines: [{ item_id: cpu, qty: 2, unit_price: 1070 }], source_totals: { net_amount: '2140.01' } }, { ...vat, version: '2' });
    expect([mv.status, mv.body.error.code]).toEqual([422, 'AMOUNT_MISMATCH']);
    expect((await call('GET', `/api/v1/cash-sales/${v1.body.id}`)).body).toMatchObject({ net_amount: '1070.00', source_version: 1 });   // รุ่นเดิมคงอยู่
    expect((await send('POST', '/api/v1/cash-sales', { ...hsBody, source_totals: { vat: '70' } }, { ...vat, ref: `${vat.ref}-3` })).body.error.code).toBe('BAD_SOURCE');
    expect((await send('POST', '/api/v1/cash-sales', { ...hsBody, source_totals: { total: '1070.00' } }, { ...vat, ref: `${vat.ref}-4` })).body.error.message).toMatch(/ใช้กับใบสำคัญเท่านั้น/);
    expect((await send('POST', '/api/v1/gl/journals', { ...jv('10.00'), source_totals: { net_amount: '10.00' } }, { ...ref, ref: 'sop:x' })).body.error.code).toBe('BAD_SOURCE');
    const jt = await send('POST', '/api/v1/gl/journals', { ...jv('10.00'), source_totals: { total: '10.00' } }, { ...ref, ref: 'sop:t' });
    expect(jt.status).toBe(201);
    expect((await send('POST', `/api/v1/cash-sales/${v1.body.id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' }, vat)).status).toBe(200);
    expect((await send('POST', `/api/v1/gl/journals/${jt.body.id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' }, ref)).status).toBe(200);
    // ล้างข้อมูลทดสอบ (ระบบต้นทางยกเลิกเอง)
    expect((await send('POST', `/api/v1/cash-sales/${liv.body.id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' }, { system: 'wts-living', ref: pos.ref })).status).toBe(200);
    expect((await send('POST', `/api/v1/gl/journals/${a4.body.id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' }, ref)).status).toBe(200);
  });
  it('POS abbreviated tax invoices in daily cash sale (docs/17 B0.4) + VAT-inclusive base excludes VAT in the VAT file', async () => {
    const typeOf = async (cls: string) => (await call('GET', `/api/v1/trade-defaults/${cls}`)).body.types[0].id as string;
    const cpu = (await call('GET', '/api/v1/items?q=01-INTL')).body.rows[0].id;
    const cus = (await call('POST', '/api/v1/customers', { code: 'C-POSDAY', name: 'ลูกค้าหน้าร้าน (รวมรายวัน)', tax_id: tid(956) })).body.id;
    // ตัวอย่างข้อ 7.1: รวม VAT 30,000.00 → ก่อน VAT 28,037.38 · ภาษีขาย 1,962.62 · 2 เครื่อง
    const hs = { doc_type_id: await typeOf('HS'), doc_date: '2027-12-15', party_id: cus, price_type: '1', vat_rate: 7, lines: [{ item_id: cpu, qty: 1, unit_price: 30000 }] };
    const abbr = [
      { pos_device_code: 'BK01-1', inv_from: 'A0001', inv_to: 'A0120', inv_count: 120, base_amount: '18691.59', vat_amount: '1308.41' },
      { pos_device_code: 'BK01-2', inv_from: 'B0001', inv_to: 'B0064', inv_count: 64, base_amount: '9345.79', vat_amount: '654.21' },
    ];
    const r = await call('POST', '/api/v1/cash-sales', { ...hs, abbr_invoices: abbr });
    expect([r.status, r.body.net_amount, r.body.error?.message]).toEqual([200, '30000.00', undefined]);
    expect((await call('GET', `/api/v1/cash-sales/${r.body.id}`)).body.abbr_invoices.map((x: { pos_device_code: string; inv_count: number }) => `${x.pos_device_code}:${x.inv_count}`)).toEqual(['BK01-1:120', 'BK01-2:64']);
    // แฟ้มภาษีขาย: 1 รายการต่อเครื่อง มูลค่าไม่รวม VAT
    const ent = async (id: string) => (await sql<{ tax_invoice_no: string; party_name: string; base_amount: string; vat_amount: string }>`SELECT tax_invoice_no, party_name, base_amount, vat_amount FROM tax_vat_entry
        WHERE header_id = ${id} AND deleted_at IS NULL ORDER BY tax_invoice_no`.execute(database.db)).rows;
    expect((await ent(r.body.id)).map((x) => `${x.tax_invoice_no}|${x.party_name}|${x.base_amount}|${x.vat_amount}`)).toEqual([
      'A0001-A0120|ใบกำกับภาษีอย่างย่อ เลขที่ A0001–A0120|18691.59|1308.41', 'B0001-B0064|ใบกำกับภาษีอย่างย่อ เลขที่ B0001–B0064|9345.79|654.21']);
    // รายงานภาษีขาย (6.3): 2 บรรทัด รวมตรงตัวอย่าง
    const rep = (await call('POST', '/api/v1/rpt/6.3/run', { params: { period: '2027-12' } })).body.rows.filter((x: { c: { doc?: string } }) => x.c.doc === r.body.doc_no);
    expect(rep.map((x: { c: { name: string; base: string; vat: string } }) => `${x.c.name}|${String(x.c.base).replace(/,/g, '')}|${String(x.c.vat).replace(/,/g, '')}`)).toEqual([
      'ใบกำกับภาษีอย่างย่อ เลขที่ A0001–A0120|18691.59|1308.41', 'ใบกำกับภาษีอย่างย่อ เลขที่ B0001–B0064|9345.79|654.21']);
    // ยอดรวมเครื่องไม่เท่าเอกสาร (ต่าง 0.01) → ไม่บันทึก · เครื่องซ้ำ · ใช้กับเอกสารอื่นไม่ได้
    const off = await call('POST', '/api/v1/cash-sales', { ...hs, abbr_invoices: [abbr[0], { ...abbr[1], vat_amount: '654.22' }] });
    expect([off.status, off.body.error.message]).toEqual([400, expect.stringMatching(/ภาษีมูลค่าเพิ่ม รวมเครื่อง 1962\.63 · เอกสาร 1962\.62/)]);
    expect((await call('POST', '/api/v1/cash-sales', { ...hs, abbr_invoices: [abbr[0], { ...abbr[1], pos_device_code: 'BK01-1' }] })).body.error.message).toMatch(/BK01-1 ซ้ำ/);
    expect((await call('POST', '/api/v1/sales-invoices', { ...hs, doc_type_id: await typeOf('IV'), abbr_invoices: abbr })).body.error.message).toMatch(/เฉพาะขายเงินสด/);
    // แก้เอกสารเป็นไม่มีใบอย่างย่อ → แฟ้มภาษีกลับเป็น 1 รายการ (มูลค่าไม่รวม VAT)
    expect((await call('PUT', `/api/v1/cash-sales/${r.body.id}`, hs)).status).toBe(200);
    expect((await ent(r.body.id)).map((x) => `${x.base_amount}|${x.vat_amount}`)).toEqual(['28037.38|1962.62']);
    // ราคาแยก VAT ไม่เปลี่ยน: มูลค่า = ก่อน VAT
    const ex = await call('POST', '/api/v1/cash-sales', { ...hs, price_type: '2', lines: [{ item_id: cpu, qty: 1, unit_price: 1000 }] });
    expect((await ent(ex.body.id)).map((x) => `${x.base_amount}|${x.vat_amount}`)).toEqual(['1000.00|70.00']);
    for (const id of [r.body.id, ex.body.id]) expect((await call('POST', `/api/v1/cash-sales/${id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
  });
  it('payroll_source + WTS-POS setup (docs/17 B0.5): wts-sop closes payroll menus, setup idempotent, account checks, other company untouched', async () => {
    expect((await call('GET', '/api/v1/company/modules')).body.payroll_source).toBe('buddy');
    expect((await call('GET', '/api/v1/pay/runs')).status).toBe(200);
    expect((await call('PUT', '/api/v1/company/payroll-source', { source: 'excel' })).status).toBe(400);
    expect((await call('PUT', '/api/v1/company/payroll-source', { source: 'wts-sop' })).body.source).toBe('wts-sop');
    const blocked = await call('GET', '/api/v1/pay/runs');
    expect([blocked.status, blocked.body.error.message]).toEqual([403, expect.stringMatching(/คิดเงินเดือนที่ WTS-HR/)]);
    const mods = (await call('GET', '/api/v1/company/modules')).body;
    expect([mods.payroll_source, mods.off.includes('PAY')]).toEqual(['wts-sop', false]);   // สวิตช์ระบบที่ใช้งานไม่ถูกแตะ
    // ใบสำคัญเงินเดือนจาก SOP ยังส่งเข้าได้ (สมุดรายวัน ไม่ใช่เมนูเงินเดือน)
    const book = (await call('GET', '/api/v1/gl/books')).body[0].id;
    const jv = await call('POST', '/api/v1/gl/journals', { journal_book_id: book, voucher_date: '2027-12-03', description: 'เงินเดือนจาก SOP', lines: [{ account_id: expense, debit: '10.00' }, { account_id: cash, credit: '10.00' }] });
    expect(jv.status).toBe(200);
    expect((await call('POST', `/api/v1/gl/journals/${jv.body.id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
    // บริษัทอื่นไม่ถูกปิด
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('GET', '/api/v1/company/modules')).body.payroll_source).toBe('buddy');
    expect((await call('GET', '/api/v1/pay/runs')).status).toBe(200);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    expect((await call('PUT', '/api/v1/company/payroll-source', { source: 'buddy' })).status).toBe(200);
    expect((await call('GET', '/api/v1/pay/runs')).status).toBe(200);
    // ตั้งค่าสำหรับ WTS-POS: ครั้งแรกสร้าง · กดซ้ำข้ามที่มีแล้ว
    const accs = (await call('GET', '/api/v1/gl/accounts')).body as Array<{ id: string; account_no: string; is_control: boolean; has_children: boolean }>;
    const ctl = accs.find((x) => x.is_control)!;
    expect((await call('POST', '/api/v1/company/wts-pos-setup', { accounts: { waste: ctl.id } })).body.error.message).toMatch(/บัญชีคุม/);
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    const otherAcc = ((await call('GET', '/api/v1/gl/accounts')).body as Array<{ id: string }>)[0]!.id;
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    expect((await call('POST', '/api/v1/company/wts-pos-setup', { accounts: { waste: otherAcc } })).status).toBe(400);
    const s1 = await call('POST', '/api/v1/company/wts-pos-setup', { accounts: { waste: expense, production_issue: expense, production_receipt: expense } });
    expect(s1.status).toBe(200);
    expect(s1.body.created.doc_types).toEqual(['OUR', 'OUW', 'OUS', 'OUQ', 'OUP', 'JUP']);
    expect(s1.body.created.items).toEqual(['POS-FOOD', 'POS-BEV', 'POS-SVC']);
    expect(s1.body.created.customers).toHaveLength(5);
    expect(s1.body.created.warehouses.every((c: string) => c.startsWith('TR'))).toBe(true);
    const ouw = (await sql<{ doc_class: string; account_id: string | null }>`SELECT t.doc_class, a.account_id FROM md_doc_type t LEFT JOIN md_doc_type_account a ON a.doc_type_id = t.id AND a.slot = 1 AND a.deleted_at IS NULL
        WHERE t.company_id = ${companyId} AND t.code = 'OUW' AND t.deleted_at IS NULL`.execute(database.db)).rows[0]!;
    expect(ouw).toEqual({ doc_class: 'OU', account_id: expense });
    // ครัวกลาง (B3.3): OUP หมวด OU · JUP หมวด JU — บัญชีงานระหว่างทำ OUP ช่อง 1 Dr · JUP ช่อง 2 Cr (ปรับปรุงเพิ่ม)
    const ck = (await sql<{ code: string; doc_class: string; slot: number | null; role: string | null }>`SELECT t.code, t.doc_class, a.slot, a.role FROM md_doc_type t LEFT JOIN md_doc_type_account a ON a.doc_type_id = t.id AND a.deleted_at IS NULL
        WHERE t.company_id = ${companyId} AND t.code IN ('OUP', 'JUP') AND t.deleted_at IS NULL ORDER BY t.code`.execute(database.db)).rows;
    expect(ck).toEqual([{ code: 'JUP', doc_class: 'JU', slot: 2, role: 'ADJ_CREDIT' }, { code: 'OUP', doc_class: 'OU', slot: 1, role: 'ISSUE_DEBIT' }]);
    const s2 = (await call('POST', '/api/v1/company/wts-pos-setup', {})).body;
    expect([s2.created.doc_types, s2.created.items, s2.created.customers, s2.created.warehouses]).toEqual([[], [], [], []]);
    expect(s2.existing.doc_types).toEqual(['OUR', 'OUW', 'OUS', 'OUQ', 'OUP', 'JUP']);
    expect((await call('GET', '/api/v1/customers?q=PF-GRAB')).body.rows).toHaveLength(1);
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('GET', '/api/v1/customers?q=PF-GRAB')).body.rows).toHaveLength(0);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
  });
  it('tenant module rights (docs/17 B0.6): defaults, platform sets, customer sees own only, API key, other customers isolated, expiry', async () => {
    type Mod = { key: string; active: boolean; enabled: boolean; seats: number | null; expired: boolean };
    const by = (ms: Mod[]) => Object.fromEntries(ms.map((m) => [m.key, m]));
    const plat = (await call('GET', '/api/v1/tenant/modules')).body;
    expect([plat.tenant, (plat.modules as Mod[]).every((m) => m.active)]).toEqual([null, true]);   // เจ้าหน้าที่ผู้ให้บริการเห็นทุกโมดูล
    const tid0 = (await call('GET', '/api/v1/tenants')).body.find((t: { code: string }) => t.code === 'DEFAULT').id as string;
    expect(Object.values(by((await call('GET', `/api/v1/tenants/${tid0}/modules`)).body)).filter((m) => m.active).map((m) => m.key)).toEqual(['buddy']);
    expect((await call('PUT', `/api/v1/tenants/${tid0}/modules`, { modules: [{ key: 'erp', enabled: true }] })).status).toBe(400);
    const set = await call('PUT', `/api/v1/tenants/${tid0}/modules`, { modules: [{ key: 'pos', enabled: true, valid_to: '2099-12-31', seats: 3, remark: 'สัญญา POS-001' }, { key: 'hr', enabled: true, valid_to: '2020-01-01' }] });
    expect(set.status).toBe(200);
    expect([by(set.body).pos!.active, by(set.body).pos!.seats, by(set.body).hr!.active, by(set.body).hr!.expired, by(set.body).buddy!.active]).toEqual([true, 3, false, true, true]);
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM sys_activity_log WHERE action = 'TENANT_MODULES' AND row_id = ${tid0}`.execute(database.db)).rows[0]!.n).toBe(1);
    // ผู้ใช้ของลูกค้าเห็นของตัวเอง (และกุญแจ API ของผู้ใช้นั้น)
    const admin = cookie;
    cookie = ''; await call('POST', '/api/v1/auth/login', { username: 'boss5', password: 'boss5pass' });
    const mine = (await call('GET', '/api/v1/tenant/modules')).body;
    expect([mine.tenant.code, by(mine.modules).pos!.active, by(mine.modules).hr!.active]).toEqual(['DEFAULT', true, false]);
    expect((await call('GET', `/api/v1/tenants/${tid0}/modules`)).status).toBe(403);
    cookie = admin;
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    const boss5 = ((await call('GET', '/api/v1/users')).body.users as Array<{ id: string; username: string }>).find((u) => u.username === 'boss5')!.id;
    const k5 = (await call('POST', '/api/v1/api-keys', { name: 'WTS-POS license', user_id: boss5, read_only: true })).body.key as string;
    const viaKey = await keyCall(k5, 'GET', '/api/v1/tenant/modules');
    expect([viaKey.status, by(viaKey.body.modules).pos!.active]).toEqual([200, true]);
    // ลูกค้ารายอื่นไม่เห็น/แก้ไม่ได้
    cookie = ''; await call('POST', '/api/v1/auth/login', { username: 'bx.admin', password: 'passX1234' });
    const other = (await call('GET', '/api/v1/tenant/modules')).body;
    expect([other.tenant.code, by(other.modules).pos!.active]).toEqual(['BKUPX', false]);
    expect((await call('PUT', `/api/v1/tenants/${tid0}/modules`, { modules: [{ key: 'pos', enabled: false }] })).status).toBe(403);
    cookie = admin;
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    // ปิดกลับ (ค่าเริ่มต้น)
    expect(by((await call('PUT', `/api/v1/tenants/${tid0}/modules`, { modules: [{ key: 'pos', enabled: false }, { key: 'hr', enabled: false }] })).body).pos!.active).toBe(false);
  });
  it('Hub + single sign-on (docs/17 B6.1/B6.2): JWKS open, tiles follow tenant modules, token signed/short/audience-bound, status reports per company, other customers isolated', async () => {
    type App = { key: string; status: string; reason: string | null; url: string | null; launch: string; metric: { label: string; value: string } | null; sync: { state: string; pending: number; failed: number; text: string } | null };
    const tiles = (b: { apps: App[] }) => Object.fromEntries(b.apps.map((x) => [x.key, x]));
    // กุญแจสาธารณะ: ไม่ต้องเข้าระบบ
    const anon = await app.inject({ method: 'GET', url: '/.well-known/jwks.json' });
    const set = JSON.parse(anon.body);
    expect([anon.statusCode, set.keys[0].kty, set.keys[0].crv, set.keys[0].alg]).toEqual([200, 'OKP', 'Ed25519', 'EdDSA']);
    expect(JSON.parse((await app.inject({ method: 'GET', url: '/api/v1/sso/jwks' })).body)).toEqual(set);
    expect(JSON.stringify(set)).not.toMatch(/"d"/);   // ไม่มีส่วนลับ
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    const me = (await call('GET', '/api/v1/auth/me')).body;
    const tid0 = (await call('GET', '/api/v1/tenants')).body.find((t: { code: string }) => t.code === 'DEFAULT').id as string;
    // ค่าเริ่มต้น: Buddy เปิด · POS/Living ยังไม่เปิด · Hotel/Spa กำลังพัฒนา
    let hub = (await call('GET', '/api/v1/hub')).body;
    expect(hub.apps.map((x: App) => x.key)).toEqual(['buddy', 'pos', 'hotel', 'hr', 'spa', 'living']);
    let t = tiles(hub);
    expect([t.buddy!.status, t.pos!.status, t.hotel!.status, t.living!.status, hub.sync]).toEqual(['active', 'locked', 'soon', 'locked', null]);
    expect(t.buddy!.metric!.label).toMatch(/ยอดขายเดือนนี้/);
    expect(t.buddy!.metric!.value).toMatch(/^-?\d+\.\d{2}$/);
    const locked = await call('POST', '/api/v1/hub/launch', { module: 'pos' });
    expect([locked.status, locked.body.error.message]).toEqual([403, expect.stringMatching(/ยังไม่ได้เปิดใช้ WTS-POS/)]);
    // เปิด POS แต่ยังไม่ตั้งที่อยู่ → บอกวิธีแก้ · ที่อยู่ผิดรูปแบบไม่รับ
    expect((await call('PUT', `/api/v1/tenants/${tid0}/modules`, { modules: [{ key: 'pos', enabled: true, app_url: 'javascript:alert(1)' }] })).status).toBe(400);
    expect((await call('PUT', `/api/v1/tenants/${tid0}/modules`, { modules: [{ key: 'pos', enabled: true }, { key: 'hr', enabled: true, app_url: 'https://sop.example.test/' }] })).status).toBe(200);
    const noUrl = await call('POST', '/api/v1/hub/launch', { module: 'pos' });
    expect([noUrl.status, noUrl.body.error.code, noUrl.body.error.message]).toEqual([409, 'APP_URL_MISSING', expect.stringMatching(/ยังไม่ได้ตั้งที่อยู่/)]);
    const put = await call('PUT', `/api/v1/tenants/${tid0}/modules`, { modules: [{ key: 'pos', enabled: true, app_url: 'https://pos.example.test/office/' }] });
    expect(put.body.find((m: { key: string }) => m.key === 'pos').app_url).toBe('https://pos.example.test/office/');
    // ไม่ส่ง app_url = คงค่าเดิม
    await call('PUT', `/api/v1/tenants/${tid0}/modules`, { modules: [{ key: 'pos', enabled: true, remark: 'สัญญา POS-002' }] });
    hub = (await call('GET', '/api/v1/hub')).body; t = tiles(hub);
    expect([t.pos!.status, t.pos!.reason, t.pos!.url, t.hr!.url, t.hr!.launch]).toEqual(['active', null, null, 'https://sop.example.test/', 'link']);
    // ออกบัตรผ่าน: ที่อยู่ + #buddy_sso= · ลงนามถูก · audience ของ POS · อายุ 2 นาที · log
    const go = await call('POST', '/api/v1/hub/launch', { module: 'pos' });
    expect([go.status, go.body.expires_in]).toEqual([200, 120]);
    expect(go.body.url).toMatch(/^https:\/\/pos\.example\.test\/office\/#buddy_sso=[\w-]+\.[\w-]+\.[\w-]+$/);
    const token = (go.body.url as string).split('#buddy_sso=')[1]!;
    const c = verifySsoToken(token, set, 'wts-pos');
    expect([c.sub, c.preferred_username, c.buddy.company.id, c.buddy.company.code, c.buddy.tenant?.code, c.buddy.admin, c.exp - c.iat]).toEqual([me.user.id, me.user.username, companyId, me.company.code, 'DEFAULT', true, 120]);
    expect(() => verifySsoToken(token, set, 'wts-living')).toThrow(/โปรแกรมอื่น/);
    expect(() => verifySsoToken(token, set, 'wts-pos', Date.now() + 5 * 60_000)).toThrow(/หมดอายุ/);
    const [h, pl, sig] = token.split('.') as [string, string, string];
    const forged = Buffer.from(JSON.stringify({ ...c, buddy: { ...c.buddy, company: { ...c.buddy.company, id: otherCompanyId } } })).toString('base64url');
    expect(() => verifySsoToken(`${h}.${forged}.${sig}`, set, 'wts-pos')).toThrow(/ลายเซ็น/);
    expect(() => verifySsoToken(`${h}.${pl}.${sig}`, { keys: [{ ...set.keys[0], x: Buffer.alloc(32, 1).toString('base64url') }] }, 'wts-pos')).toThrow(/ลายเซ็น/);
    expect(verifySsoToken((await call('POST', '/api/v1/hub/launch', { module: 'pos' })).body.url.split('#buddy_sso=')[1], set, 'wts-pos').jti).not.toBe(c.jti);
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM sys_activity_log WHERE action = 'HUB_LAUNCH' AND company_id = ${companyId}`.execute(database.db)).rows[0]!.n).toBe(2);
    expect((await call('POST', '/api/v1/hub/launch', { module: 'hr' })).body.error.message).toMatch(/ยังไม่รับบัตรผ่าน/);
    expect((await call('POST', '/api/v1/hub/launch', { module: 'living' })).status).toBe(403);   // Living รับบัตรผ่านแล้ว (B5) แต่ลูกค้านี้ยังไม่เปิดใช้
    expect((await call('POST', '/api/v1/hub/launch', { module: 'hotel' })).status).toBe(400);
    // WTS-Living (B5): เปิดใช้ + ที่อยู่ → บัตรผ่าน audience wts-living ใช้กับ POS ไม่ได้
    await call('PUT', `/api/v1/tenants/${tid0}/modules`, { modules: [{ key: 'living', enabled: true, app_url: 'https://living.example.test/office/' }] });
    const lv = await call('POST', '/api/v1/hub/launch', { module: 'living' });
    expect(lv.body.url).toMatch(/^https:\/\/living\.example\.test\/office\/#buddy_sso=/);
    const lvc = verifySsoToken((lv.body.url as string).split('#buddy_sso=')[1]!, set, 'wts-living');
    expect([lvc.aud, lvc.sub]).toEqual(['wts-living', me.user.id]);
    expect(() => verifySsoToken((lv.body.url as string).split('#buddy_sso=')[1]!, set, 'wts-pos')).toThrow(/โปรแกรมอื่น/);
    expect((await call('POST', '/api/v1/hub/launch', { module: 'erp' })).status).toBe(400);
    // โปรแกรมรายงานคิวส่งเอกสารด้วยกุญแจ API ของบริษัท (หน้าจอส่งไม่ได้ · กุญแจอ่านอย่างเดียวส่งไม่ได้)
    const report = { system: 'wts-pos', pending: 3, failed: 0, last_sent_at: '2026-11-05T14:02:00+07:00', metric: { label: 'ยอดขายวันนี้', value: '12345.00' } };
    expect((await call('PUT', '/api/v1/source-status', report)).status).toBe(403);
    const rk = (await call('POST', '/api/v1/api-keys', { name: 'WTS-POS status ro', user_id: me.user.id, read_only: true })).body.key as string;
    expect((await keyCall(rk, 'PUT', '/api/v1/source-status', report)).status).toBe(403);
    const wk = (await call('POST', '/api/v1/api-keys', { name: 'WTS-POS status', user_id: me.user.id })).body.key as string;
    expect((await keyCall(wk, 'PUT', '/api/v1/source-status', { ...report, system: 'WTS POS' })).status).toBe(400);
    expect((await keyCall(wk, 'PUT', '/api/v1/source-status', { ...report, pending: -1 })).status).toBe(400);
    expect((await keyCall(wk, 'PUT', '/api/v1/source-status', report)).body).toEqual({ ok: true, state: 'syncing' });
    expect((await keyCall(wk, 'GET', '/api/v1/hub')).status).toBe(403);
    expect((await keyCall(wk, 'POST', '/api/v1/hub/launch', { module: 'pos' })).status).toBe(403);
    t = tiles((hub = (await call('GET', '/api/v1/hub')).body));
    expect([t.pos!.sync!.state, t.pos!.sync!.pending, t.pos!.metric, hub.sync.state, hub.sync.pending]).toEqual(['syncing', 3, { label: 'ยอดขายวันนี้', value: '12345.00', at: expect.anything() }, 'syncing', 3]);
    expect(t.pos!.sync!.text).toMatch(/รอส่งเข้าบัญชี 3 รายการ/);
    // รายงานซ้ำ = เขียนทับแถวเดิม · ส่งไม่ผ่าน = error
    await keyCall(wk, 'PUT', '/api/v1/source-status', { system: 'wts-pos', pending: 0, failed: 2, message: 'Buddy ไม่รับ HS 05/11 — AMOUNT_MISMATCH' });
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM sys_source_status WHERE company_id = ${companyId}`.execute(database.db)).rows[0]!.n).toBe(1);
    t = tiles((hub = (await call('GET', '/api/v1/hub')).body));
    expect([t.pos!.sync!.state, t.pos!.metric, hub.sync.state, hub.sync.failed]).toEqual(['error', null, 'error', 2]);
    // ไม่ได้รับรายงานเกิน 15 นาที = offline
    await sql`UPDATE sys_source_status SET failed = 0, reported_at = now() - interval '20 minutes' WHERE company_id = ${companyId}`.execute(database.db);
    expect(tiles((await call('GET', '/api/v1/hub')).body).pos!.sync!.state).toBe('offline');
    // บริษัทอื่นในลูกค้าเดียวกัน: ไม่เห็นสถานะของบริษัทนี้
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect(tiles((await call('GET', '/api/v1/hub')).body).pos!.sync).toBeNull();
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    // ผู้ใช้ของลูกค้า (ไม่ใช่ผู้ให้บริการ): ได้บัตรผ่านของตัวเอง
    const admin = cookie;
    cookie = ''; await call('POST', '/api/v1/auth/login', { username: 'boss5', password: 'boss5pass' });
    const me5 = (await call('GET', '/api/v1/auth/me')).body;
    const c5 = verifySsoToken((await call('POST', '/api/v1/hub/launch', { module: 'pos' })).body.url.split('#buddy_sso=')[1], set, 'wts-pos');
    expect([c5.sub, c5.buddy.platform, c5.buddy.company.id, c5.buddy.tenant?.code]).toEqual([me5.user.id, false, me5.company.id, 'DEFAULT']);
    // ลูกค้ารายอื่น: POS ไม่ได้เปิด · ไม่เห็นสถานะ/ที่อยู่ของลูกค้านี้
    cookie = ''; await call('POST', '/api/v1/auth/login', { username: 'bx.admin', password: 'passX1234' });
    const hx = (await call('GET', '/api/v1/hub')).body;
    expect([hx.tenant.code, tiles(hx).pos!.status, tiles(hx).pos!.sync, tiles(hx).hr!.url, hx.sync]).toEqual(['BKUPX', 'locked', null, null, null]);
    expect((await call('POST', '/api/v1/hub/launch', { module: 'pos' })).status).toBe(403);
    cookie = admin;
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    // คืนค่าเดิม
    await sql`DELETE FROM sys_source_status WHERE company_id = ${companyId}`.execute(database.db);
    await call('PUT', `/api/v1/tenants/${tid0}/modules`, { modules: [{ key: 'pos', enabled: false, app_url: null }, { key: 'hr', enabled: false, app_url: null }, { key: 'living', enabled: false, app_url: null }] });
  });
  it('WTS Connect master-data feed (docs/17 B0.3): full load + cursor, upsert/inactive/delete, only requested types, read-only key, bad params, isolation', async () => {
    const adminId = (await call('GET', '/api/v1/auth/me')).body.user.id;
    const key = (await call('POST', '/api/v1/api-keys', { name: 'WTS-POS feed', user_id: adminId, read_only: true })).body.key as string;
    const feed = async (qs: string, k = key) => keyCall(k, 'GET', `/api/v1/changes?${qs}`);
    type Ch = { type: string; id: string; op: string; data: Record<string, unknown> | null };
    // ครั้งแรก: ข้อมูลทั้งหมด (เฉพาะช่องที่ใช้)
    const full = await feed('types=customer,unit,account');
    expect([full.status, full.body.full, full.body.more]).toEqual([200, true, false]);
    const fc = full.body.changes as Ch[];
    expect(fc.some((c) => c.type === 'customer' && c.data!.code === 'C-SRC')).toBe(true);
    expect(fc.some((c) => c.type === 'unit') && fc.some((c) => c.type === 'account' && typeof c.data!.account_no === 'string')).toBe(true);
    expect(Object.keys(fc.find((c) => c.type === 'customer')!.data!)).not.toContain('company_id');
    expect(Object.keys(fc.find((c) => c.type === 'customer')!.data!)).not.toContain('remark');
    const cur0 = full.body.next_cursor as string;
    expect(cur0).toMatch(/^\d+$/);
    // ไม่มีอะไรเปลี่ยน → ว่าง cursor ไม่ถอย
    const none = await feed(`types=customer&since=${cur0}`);
    expect([none.body.changes, BigInt(none.body.next_cursor) >= BigInt(cur0)]).toEqual([[], true]);
    // เพิ่ม → แก้ (เลิกใช้) → ลบ: ได้ค่าล่าสุดครั้งเดียวต่อแถว
    const c = (await call('POST', '/api/v1/customers', { code: 'C-FEED', name: 'ลูกค้าฟีด', tax_id: tid(953) })).body.id as string;
    const f1 = await feed(`types=customer,item&since=${cur0}`);
    expect((f1.body.changes as Ch[]).map((x) => [x.type, x.id, x.op, x.data?.code, x.data?.status])).toEqual([['customer', c, 'upsert', 'C-FEED', 'A']]);
    expect((await call('PUT', `/api/v1/customers/${c}`, { code: 'C-FEED', name: 'ลูกค้าฟีด (เลิก)', tax_id: tid(953), status: 'I' })).status).toBe(200);
    const f2 = await feed(`types=customer&since=${f1.body.next_cursor}`);
    expect((f2.body.changes as Ch[]).map((x) => [x.op, x.data?.name, x.data?.status])).toEqual([['upsert', 'ลูกค้าฟีด (เลิก)', 'I']]);
    expect((await call('DELETE', `/api/v1/customers/${c}`)).status).toBe(200);
    const f3 = await feed(`types=customer&since=${f2.body.next_cursor}`);
    expect((f3.body.changes as Ch[]).map((x) => [x.id, x.op, x.data])).toEqual([[c, 'delete', null]]);
    // ทั้ง 3 ครั้งรวมกันจาก cursor แรก = แถวเดียว (ลบ)
    expect((await feed(`types=customer&since=${cur0}`)).body.changes).toHaveLength(1);
    // ชนิดอื่นที่ไม่ได้ขอไม่มา · หน้าละ limit
    expect((await feed(`types=unit&since=${cur0}`)).body.changes).toEqual([]);
    for (const [i, n] of ['C-FEED2', 'C-FEED3'].entries()) expect((await call('POST', '/api/v1/customers', { code: n, name: n, tax_id: tid(954 + i) })).status).toBe(200);
    const p1 = await feed(`types=customer&since=${f3.body.next_cursor}&limit=1`);
    expect([p1.body.changes.length, p1.body.more]).toEqual([1, true]);
    const p2 = await feed(`types=customer&since=${p1.body.next_cursor}&limit=1`);
    expect(p2.body.changes[0].data.code).toBe('C-FEED3');
    // สินค้า: ผู้จำหน่ายหลัก + ราคาทุนมาตรฐาน (WTS-POS แผนซื้อครัวกลาง B3.3)
    const sup = (await call('POST', '/api/v1/suppliers', { code: 'S-FEED', name: 'ผู้จำหน่ายฟีด', tax_id: tid(956) })).body.id as string;
    const it = await call('POST', '/api/v1/items', { code: '02-FEED-000001', name_th: 'สินค้าฟีด', base_unit_id: (await call('GET', '/api/v1/lookups?types=UNIT')).body.UNIT[0].id, std_cost: '12.3456', default_supplier_id: sup });
    expect([it.status, it.body?.error?.message]).toEqual([200, undefined]);
    const fi = ((await feed(`types=item&since=${p2.body.next_cursor}`)).body.changes as Ch[]).find((x) => x.id === it.body.id)!;
    expect([fi.data!.default_supplier_id, Number(fi.data!.std_cost)]).toEqual([sup, 12.3456]);
    // พารามิเตอร์ผิด
    expect((await feed('types=customer,dog')).body.error.message).toMatch(/ไม่รู้จักชนิด dog/);
    expect((await feed('since=1')).status).toBe(400);
    expect((await feed('types=item&since=abc')).status).toBe(400);
    // บริษัทอื่นไม่เห็นข้อมูลบริษัทนี้
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    const okey = (await call('POST', '/api/v1/api-keys', { name: 'feed B', user_id: adminId, read_only: true })).body.key as string;
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    const of = (await feed('types=customer', okey)).body.changes as Ch[];
    expect(of.some((x) => x.data!.code === 'C-FEED2' || x.data!.code === 'C-SRC')).toBe(false);
    expect((await feed(`types=customer&since=${cur0}`, okey)).body.changes.some((x: Ch) => x.id === c)).toBe(false);
  });
  it('WTS-POS payment channels (B2.24): feed bank_account + payment_method account, add one receipt method by key, rights, duplicate, isolation', async () => {
    const adminId = (await call('GET', '/api/v1/auth/me')).body.user.id;
    const leaf = ((await call('GET', '/api/v1/gl/accounts')).body as Array<{ id: string; is_control: boolean }>).filter((x) => !x.is_control);
    const bank = (await call('POST', '/api/v1/bank-accounts', { code: 'POSQR', name: 'ออมทรัพย์รับ QR', account_number: '999-1-23456', account_kind: 'S', gl_account_id: leaf[1]!.id })).body.id as string;
    const key = (await call('POST', '/api/v1/api-keys', { name: 'WTS-POS channels', user_id: adminId })).body.key as string;
    type Ch = { type: string; id: string; data: Record<string, unknown> };
    const full = (await keyCall(key, 'GET', '/api/v1/changes?types=bank_account,payment_method')).body.changes as Ch[];
    expect(full.find((x) => x.id === bank)?.data).toMatchObject({ code: 'POSQR', account_number: '999-1-23456', gl_account_id: leaf[1]!.id });
    expect(full.filter((x) => x.type === 'payment_method').every((x) => 'gl_account_id' in x.data)).toBe(true);
    // เพิ่มทีละรายการ: e-Wallet = OTHER + บัญชีพัก · QR = TRANSFER + บัญชีเงินฝาก · รายการเดิมไม่หาย
    const before = (await call('GET', '/api/v1/payment-methods/R')).body.length as number;
    const w = await keyCall(key, 'POST', '/api/v1/payment-methods/R', { code: 'lp', name_th: 'LINE Pay', kind: 'OTHER', gl_account_id: leaf[2]!.id });
    expect([w.status, w.body.code]).toEqual([201, 'LP']);
    const q = await keyCall(key, 'POST', '/api/v1/payment-methods/R', { code: 'Q2', name_th: 'QR พร้อมเพย์ สาขา 2', kind: 'TRANSFER', bank_account_id: bank });
    expect(q.status).toBe(201);
    expect((await call('GET', '/api/v1/payment-methods/R')).body).toHaveLength(before + 2);
    // ซ้ำ / ไม่มีบัญชี / โอนไม่มีธนาคาร / บัญชีคุม
    expect([(await keyCall(key, 'POST', '/api/v1/payment-methods/R', { code: 'LP', name_th: 'ซ้ำ', kind: 'OTHER', gl_account_id: leaf[2]!.id })).status]).toEqual([409]);
    expect((await keyCall(key, 'POST', '/api/v1/payment-methods/R', { code: 'X1', name_th: 'ไม่มีบัญชี', kind: 'OTHER' })).body.error.message).toMatch(/ป้อนเลขที่บัญชี/);
    expect((await keyCall(key, 'POST', '/api/v1/payment-methods/R', { code: 'X2', name_th: 'โอน', kind: 'TRANSFER', gl_account_id: leaf[2]!.id })).body.error.message).toMatch(/ต้องเลือกธนาคาร/);
    // ฟีดเห็นวิธีใหม่พร้อมบัญชี · log บันทึก
    const f2 = (await keyCall(key, 'GET', '/api/v1/changes?types=payment_method')).body.changes as Ch[];
    expect(f2.find((x) => x.id === w.body.id)?.data).toMatchObject({ direction: 'R', code: 'LP', kind: 'OTHER', gl_account_id: leaf[2]!.id });
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM sys_activity_log WHERE table_name = 'md_payment_method' AND row_id = ${w.body.id}`.execute(database.db)).rows[0]!.n).toBe(1);
    // กุญแจอ่านอย่างเดียวเพิ่มไม่ได้ · ผู้ใช้ไม่มีสิทธิ์ SET.PAYM ไม่ได้
    const ro = (await call('POST', '/api/v1/api-keys', { name: 'ro', user_id: adminId, read_only: true })).body.key as string;
    expect((await keyCall(ro, 'POST', '/api/v1/payment-methods/R', { code: 'X3', name_th: 'x', kind: 'OTHER', gl_account_id: leaf[2]!.id })).status).toBe(403);
    // บริษัทอื่น: บัญชีของบริษัทนี้ใช้ไม่ได้ และไม่เห็นวิธีชำระของบริษัทนี้
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    const okey = (await call('POST', '/api/v1/api-keys', { name: 'ch B', user_id: adminId })).body.key as string;
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    expect((await keyCall(okey, 'POST', '/api/v1/payment-methods/R', { code: 'X4', name_th: 'ข้ามบริษัท', kind: 'TRANSFER', bank_account_id: bank })).status).toBe(400);
    expect((await keyCall(okey, 'POST', '/api/v1/payment-methods/R', { code: 'X5', name_th: 'ข้ามบริษัท', kind: 'OTHER', gl_account_id: leaf[2]!.id })).status).toBe(400);
    const of = (await keyCall(okey, 'GET', '/api/v1/changes?types=payment_method,bank_account')).body.changes as Ch[];
    expect(of.some((x) => x.id === w.body.id || x.id === bank)).toBe(false);
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
      if (String(params.system).includes('เลือกรหัส')) return { model: params.model, stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 200 }, parsed_output: suggestOut };
      return next();
    } } } }) as never);
    const img = Buffer.from('fake-image-bytes').toString('base64');
    const read = (target: string, body: object = {}) => call('POST', '/api/v1/ai/read-bill', { target, file_name: 'bill.jpg', media_type: 'image/jpeg', data: img, ...body });
    expect((await call('GET', '/api/v1/ai/status')).body).toMatchObject({ has_key: false, available: false });
    expect((await read('purchase-invoices')).body.error.message).toMatch(/ยังไม่ได้ตั้งค่า AI/);
    expect((await call('PUT', '/api/v1/ai/config', { api_key: 'not-a-key', monthly_limit_usd: 20 })).body.error.message).toMatch(/sk-ant-/);
    const key = 'sk-ant-api03-TESTKEY_' + 'x'.repeat(30) + 'ab12';
    expect((await call('PUT', '/api/v1/ai/config', { api_key: key, monthly_limit_usd: 20 })).body).toMatchObject({ has_key: true, key_hint: '…ab12', monthly_limit_usd: 20, model: 'claude-haiku-5-5' });   // HANDOFF 166: ไม่เคยเลือก = Haiku 5.5
    const enc = (await sql<{ value_enc: string }>`SELECT value_enc FROM sys_secret WHERE company_id = ${companyId} AND deleted_at IS NULL`.execute(database.db)).rows[0]!.value_enc;
    expect(enc.includes('TESTKEY')).toBe(false);
    expect(JSON.stringify((await call('GET', '/api/v1/ai/config')).body).includes('TESTKEY')).toBe(false);

    const unit = (await call('GET', '/api/v1/lookups?types=UNIT')).body.UNIT[0].id;
    const item = (await call('POST', '/api/v1/items', { code: '02-TEST-000095', name_th: 'กระดาษ A4 ทดสอบ AI', base_unit_id: unit, std_cost: '1' })).body.id;
    const sup = (await call('POST', '/api/v1/suppliers', { code: 'S-AI1', name: 'บริษัท ขายส่ง จำกัด', tax_id: '0105537095903', tax_branch_no: '0' })).body.id;
    expect([item, sup].every(Boolean)).toBe(true);
    expect((await call('PUT', '/api/v1/ai/config', { monthly_limit_usd: 20, business_type: 'trading', guidance: 'ค่าขนส่งสินค้าเข้า ลงรหัสค่าขนส่ง', model: 'claude-opus-5-5' })).body.model).toBe('claude-opus-5-5');
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
    expect(r.body.read_by).toBe('claude_image');
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
    // อ่านบิลแบบผสม (เจ้าของ 18/11/2569): ข้อความจาก Typhoon-OCR ในเครื่องผู้ใช้ → Claude จัดร่างจากข้อความ (ไม่มีรูป) → ตรวจผู้จำหน่าย/แนะนำรหัสเหมือนเดิม · บันทึกที่มาในการใช้
    const ocr = 'ใบกำกับภาษี บริษัท ขายส่ง จำกัด\nเลขประจำตัวผู้เสียภาษี 0105537095903\nกระดาษ A4 ทดสอบ AI | 10 | 120.00 | 1,200.00\nรวมทั้งสิ้น 1,391.00';
    const readText = (target: string, body: object = {}) => call('POST', '/api/v1/ai/read-bill-text', { target, file_name: 'bill.jpg', file_size: 123456, text: ocr, pages: 1, ocr_ms: 5200, ...body });
    const t1 = await readText('purchase-invoices');
    expect(t1.status).toBe(200);
    expect(t1.body).toMatchObject({ read_by: 'local_ocr', supplier: { code: 'S-AI1' }, supplier_check: { status: 'match' }, bill: { doc_no: 'INV-9001', total: '1391.00' } });
    expect(t1.body.lines[0].suggestion).toMatchObject({ item: { code: '02-TEST-000095' } });
    const tq = sent.at(-2)!;
    expect([tq.apiKey, tq.model, tq.output_config.format.type, tq.messages[0].content.length, tq.messages[0].content[0].type]).toEqual([key, 'claude-opus-5-5', 'json_schema', 1, 'text']);
    expect(tq.messages[0].content[0].text).toContain(`<ocr>\n${ocr}\n</ocr>`);
    expect(String(tq.system)).toContain('เอกสารซื้อ');
    expect(JSON.stringify(tq.messages)).not.toMatch(/"type":"(image|document)"/);
    const tu = (await call('GET', '/api/v1/ai/usage')).body as Array<{ status: string; message: string | null; file_name: string }>;
    expect(tu.some((u) => u.status === 'OK' && u.message === 'อ่านภาพในเครื่องด้วย Typhoon-OCR 1 หน้า 5.2 วินาที → Claude จัดร่างจากข้อความ')).toBe(true);
    expect((await readText('purchase-invoices', { text: 'สั้น' })).body.error.message).toMatch(/สั้นเกินไป/);
    expect((await readText('no-such-doc')).status).toBe(400);   // ชนิดเอกสารที่ไม่มี
    // ผิดพลาด/ปฏิเสธ → บันทึกการใช้ ไม่เติมร่าง
    next = () => { throw new Error('ECONNRESET'); };
    expect((await read('purchase-invoices')).body.error.message).toMatch(/เชื่อมต่อ Anthropic ไม่ได้/);
    next = () => ({ model: 'claude-opus-5-5', stop_reason: 'refusal', usage: { input_tokens: 100, output_tokens: 0 }, parsed_output: null });
    expect((await read('purchase-invoices')).status).toBe(422);
    expect((await call('GET', '/api/v1/ai/usage')).body.map((u: { status: string }) => u.status).slice(0, 2)).toEqual(['REFUSED', 'ERROR']);
    // HANDOFF 166: รุ่นของบริษัทใช้ทั้งอ่านบิลและแนะนำรหัส — Haiku ไม่ส่ง betas/fallbacks (ไม่มีรุ่นสำรอง) · Sonnet/Opus ส่ง · effort ระบุชัด · ไม่ส่ง thinking · ค่าใช้จ่ายตามรุ่น
    for (const [m, fb, cost] of [['claude-haiku-5-5', false, '0.0009'], ['claude-sonnet-5-5', true, '0.0180'], ['claude-opus-5-5', true, '0.0360']] as const) {
      expect((await call('PUT', '/api/v1/ai/config', { monthly_limit_usd: null, model: m })).body.model).toBe(m);
      next = () => ({ model: m, stop_reason: 'end_turn', usage: { input_tokens: 3000, output_tokens: 800 }, parsed_output: raw });
      const rm = await read('purchase-invoices');
      expect([rm.status, rm.body.usage.model, rm.body.usage.cost_usd]).toEqual([200, m, cost]);
      const [bq, sq2] = sent.slice(-2) as [Record<string, any>, Record<string, any>];
      for (const x of [bq, sq2]) expect([x.model, 'betas' in x, 'fallbacks' in x, 'thinking' in x, x.output_config.format.type]).toEqual([m, fb, fb, false, 'json_schema']);
      if (fb) expect([bq.betas, bq.fallbacks]).toEqual([['server-side-fallback-2026-07-01'], 'default']);
      expect([bq.output_config.effort, sq2.output_config.effort]).toEqual(['medium', 'low']);
    }
    // Haiku ปฏิเสธ = ไม่มีรุ่นสำรอง → แจ้งเหมือนเดิม
    await call('PUT', '/api/v1/ai/config', { monthly_limit_usd: null, model: 'claude-haiku-5-5' });
    next = () => ({ model: 'claude-haiku-5-5', stop_reason: 'refusal', usage: { input_tokens: 100, output_tokens: 0 }, parsed_output: null });
    expect((await read('purchase-invoices')).body.error).toMatchObject({ code: 'AI_UNREADABLE', message: 'AI ปฏิเสธการอ่านแฟ้มนี้ — ป้อนเอง' });
    expect((await call('PUT', '/api/v1/ai/config', { monthly_limit_usd: null, model: 'claude-opus-4-1' })).body.error.message).toMatch(/เลือกรุ่น AI/);
    await call('PUT', '/api/v1/ai/config', { monthly_limit_usd: null, model: 'claude-opus-5-5' });
    next = () => ({ model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { input_tokens: 3000, output_tokens: 800 }, parsed_output: raw });
    expect((await call('PUT', '/api/v1/ai/config', { monthly_limit_usd: null, business_type: 'bogus' })).status).toBe(400);
    expect((await read('no-such-doc')).status).toBe(400);
    // HANDOFF 171: อ่านบิลด้วย AI ทุกหน้าจอที่คีย์เอกสาร — ฝั่งขาย: ลูกค้า = ผู้ซื้อในเอกสาร (ใบสั่งซื้อของลูกค้า บิลเขียนมือ) · พรอมต์ฝั่งขาย · แนะนำรหัสจากสินค้าที่ขาย
    const ctax = tid(1711);
    const cust = (await call('POST', '/api/v1/customers', { code: 'C-AI171', name: 'ห้างลูกค้า เอไอ จำกัด', tax_id: ctax, tax_branch_no: '0' })).body.id;
    expect(cust).toBeTruthy();
    const custPo = { ...raw, supplier: { name: '', tax_id: '', branch_no: '', address: '' }, buyer: { name: 'ห้างลูกค้า เอไอ จำกัด', tax_id: ctax, branch_no: '00000' }, doc_no: 'CPO-171' };
    next = () => ({ model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { input_tokens: 3000, output_tokens: 800 }, parsed_output: custPo });
    suggestOut = { lines: [{ index: 0, code: '02-TEST-000095', confidence: 'high', reason: 'ชื่อตรงกับรหัสสินค้า' }, { index: 1, code: null, confidence: 'low', reason: 'ไม่มีรหัส' }] };
    for (const target of ['sales-orders', 'sales-invoices', 'quotations', 'cash-sales']) {
      const rs = await read(target);
      expect([target, rs.status, rs.body.side, rs.body.supplier?.code, rs.body.supplier_check?.status]).toEqual([target, 200, 'sale', 'C-AI171', 'match']);
      expect(rs.body.lines[0].suggestion).toMatchObject({ item: { code: '02-TEST-000095' } });
      const [bq, sq] = sent.slice(-2) as [Record<string, any>, Record<string, any>];
      expect(String(bq.system)).toContain('เอกสารฝั่งขาย');
      expect(JSON.stringify(bq.messages)).toContain('อ่านเอกสารขายนี้ตามโครงข้อมูล');
      expect(sq.messages[0].content).toContain('ลูกค้า: ห้างลูกค้า เอไอ จำกัด (มีในแฟ้มลูกค้า)');
    }
    // ลูกค้าใหม่ (ไม่พบตามเลข/ชื่อ) — แจ้งให้เลือก/เพิ่มในเอกสาร · ไม่ใช้ผู้จำหน่าย
    next = () => ({ model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { input_tokens: 3000, output_tokens: 800 }, parsed_output: { ...custPo, buyer: { name: 'ร้านใหม่ไม่เคยมี', tax_id: tid(1712), branch_no: '' } } });
    const rn = await read('sales-orders');
    expect([rn.body.supplier, rn.body.supplier_check.status]).toEqual([null, 'new']);
    expect(rn.body.supplier_check.message).toMatch(/^ลูกค้าใหม่/);
    // มัดจำ (บรรทัดเป็นคำอธิบาย + จำนวนเงิน): ไม่เรียก AI แนะนำรหัส · มัดจำรับ = ลูกค้า · มัดจำจ่าย = ผู้จำหน่าย
    next = () => ({ model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { input_tokens: 3000, output_tokens: 800 }, parsed_output: custPo });
    const n0 = sent.length;
    const ra = await read('ar-deposits');
    expect([ra.status, ra.body.side, ra.body.supplier?.code, sent.length - n0, ra.body.lines.every((l: { suggestion: unknown }) => l.suggestion === null)]).toEqual([200, 'sale', 'C-AI171', 1, true]);
    next = () => ({ model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { input_tokens: 3000, output_tokens: 800 }, parsed_output: raw });
    const re2 = await read('ap-deposits');
    expect([re2.status, re2.body.side, re2.body.supplier?.code]).toEqual([200, 'purchase', 'S-AI1']);
    // ใบสั่งซื้อ/ใบลดหนี้ผู้จำหน่าย = ฝั่งซื้อเหมือนซื้อเงินเชื่อ
    for (const target of ['purchase-orders', 'ap-credit-notes']) expect((await read(target)).body).toMatchObject({ side: 'purchase', supplier: { code: 'S-AI1' } });
    await sql`DELETE FROM md_customer WHERE id = ${cust}`.execute(database.db);
    // สิทธิ์: พนักงานระดับ 0 ตั้งค่า/ดูการใช้ไม่ได้ แต่เห็นสถานะ · กุญแจ API ของระบบอื่นใช้หน้าตั้งค่าไม่ได้
    const admin = cookie;
    cookie = ''; await call('POST', '/api/v1/auth/login', { username: 'clerk0', password: 'clerk0pass' });
    expect((await call('GET', '/api/v1/ai/config')).status).toBe(403);
    expect((await call('GET', '/api/v1/ai/status')).body.has_key).toBe(true);
    cookie = admin;
    // บริษัทอื่น: ไม่มีกุญแจ ไม่เห็นการใช้ · อ่านจากข้อความก็ไม่ใช้กุญแจของบริษัทนี้
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await readText('purchase-invoices')).body.error.message).toMatch(/ยังไม่ได้ตั้งค่า AI/);
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
  it('documents refuse department/salesperson/warehouse/unit/ship-to/bank/payment method/journal book ids of another company (กติกาข้อ 7)', async () => {
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    // ข้อมูลหลักของบริษัทอื่น — FK ผ่านแต่ต้องไม่ถูกบันทึกลงเอกสารของบริษัทนี้
    const ins = async (q: { execute: (db: typeof database.db) => Promise<{ rows: Array<{ id: string }> }> }) => (await q.execute(database.db)).rows[0]!.id;
    const o = otherCompanyId;
    const fDep = await ins(sql<{ id: string }>`INSERT INTO md_department (company_id, code, name_th) VALUES (${o}, 'XDEP', 'แผนกบริษัทอื่น') RETURNING id`);
    const fSlm = await ins(sql<{ id: string }>`INSERT INTO md_salesperson (company_id, code, name) VALUES (${o}, 'XSLM', 'พนักงานบริษัทอื่น') RETURNING id`);
    const fWh = await ins(sql<{ id: string }>`INSERT INTO md_warehouse (company_id, code, name_th) VALUES (${o}, 'XWH', 'คลังบริษัทอื่น') RETURNING id`);
    const fUnit = await ins(sql<{ id: string }>`INSERT INTO md_unit (company_id, code, name_th) VALUES (${o}, 'XU', 'หน่วยบริษัทอื่น') RETURNING id`);
    const fShip = await ins(sql<{ id: string }>`INSERT INTO md_customer_ship_to (company_id, code) VALUES (${o}, 'XS') RETURNING id`);
    const fBank = await ins(sql<{ id: string }>`INSERT INTO md_bank (company_id, code, name_th) VALUES (${o}, 'XBK', 'ธนาคารบริษัทอื่น') RETURNING id`);
    const fPm = await ins(sql<{ id: string }>`INSERT INTO md_payment_method (company_id, direction, code, name_th) VALUES (${o}, 'R', 'XP', 'วิธีรับบริษัทอื่น') RETURNING id`);
    const fBook = await ins(sql<{ id: string }>`INSERT INTO gl_journal_book (company_id, code, prefix, name_th) VALUES (${o}, 'XB', 'XB', 'สมุดบริษัทอื่น') RETURNING id`);
    const fJv = await ins(sql<{ id: string }>`INSERT INTO gl_journal (company_id, journal_book_id, voucher_no, voucher_date, period_id)
      SELECT ${o}, ${fBook}, 'XB-0001', p.start_date, p.id FROM gl_period p WHERE p.company_id = ${o} ORDER BY p.start_date LIMIT 1 RETURNING id`);
    const typeOf = async (cls: string) => (await call('GET', `/api/v1/trade-defaults/${cls}`)).body.types[0].id as string;
    const cus = (await call('GET', '/api/v1/customers?q=C200')).body.rows[0].id;
    const cpu = (await call('GET', '/api/v1/items?q=01-INTL')).body.rows[0].id;
    const pmR = (await sql<{ id: string }>`SELECT id FROM md_payment_method WHERE company_id = ${companyId} AND direction = 'R' AND deleted_at IS NULL ORDER BY code LIMIT 1`.execute(database.db)).rows[0]!.id;
    const bank = (await call('GET', '/api/v1/bank-accounts')).body.find((b: { gl_account_id: string | null }) => b.gl_account_id).id;
    const fake = '00000000-0000-4000-8000-0000000000aa';
    const refused = async (method: 'POST' | 'PUT', path: string, body: object, field: string) => {
      const r = await call(method, path, body);
      expect(r.status, `${path} ${field}`).toBe(400);
      expect(r.body.error.message, `${path} ${field}`).toMatch(/ไม่พบ.+ในบริษัทนี้ — เลือก/);
      expect(r.body.error.issues?.[0]?.field, `${path} ${field}`).toBe(field);
    };
    const before = (await sql<{ n: number }>`SELECT count(*)::int AS n FROM doc_header WHERE company_id = ${companyId}`.execute(database.db)).rows[0]!.n;
    // ขาย/ซื้อ: หัวเอกสาร + บรรทัด + วิธีชำระ
    const iv = { doc_type_id: await typeOf('IV'), doc_date: '2027-08-20', party_id: cus, price_type: '2', vat_rate: 7, lines: [{ item_id: cpu, qty: 1, unit_price: 100 }] };
    for (const [k, v] of [['department_id', fDep], ['salesperson_id', fSlm], ['warehouse_id', fWh], ['ship_to_id', fShip]] as const) await refused('POST', '/api/v1/sales-invoices', { ...iv, [k]: v }, k);
    for (const [k, v] of [['warehouse_id', fWh], ['unit_id', fUnit], ['department_id', fDep]] as const) await refused('POST', '/api/v1/sales-invoices', { ...iv, lines: [{ ...iv.lines[0], [k]: v }] }, k);
    await refused('POST', '/api/v1/cash-sales', { ...iv, doc_type_id: await typeOf('HS'), payments: [{ payment_method_id: fPm, amount: 50 }] }, 'payment_method_id');
    // มัดจำ/รายได้อื่น (หัว + บรรทัด + ธนาคารของเช็ค)
    const ai = { doc_type_id: await typeOf('AI'), doc_date: '2027-08-20', party_id: cus, price_type: '2', vat_rate: 7, lines: [{ description: 'มัดจำ', amount: 100 }] };
    await refused('POST', '/api/v1/ar-deposits', { ...ai, department_id: fDep }, 'department_id');
    await refused('POST', '/api/v1/ar-deposits', { ...ai, salesperson_id: fSlm }, 'salesperson_id');
    await refused('POST', '/api/v1/ar-deposits', { ...ai, lines: [{ ...ai.lines[0], department_id: fDep }] }, 'department_id');
    await refused('POST', '/api/v1/ar-deposits', { ...ai, payments: [{ payment_method_id: pmR, amount: 100, reference_no: 'X1', bank_id: fBank }] }, 'bank_id');
    // รับชำระ · ใบวางบิล · ธนาคาร · คลัง · เงินสดย่อย
    const re = { doc_type_id: await typeOf('RE'), doc_date: '2027-08-20', party_id: cus, settlements: [{ invoice_header_id: fake, amount: 1 }] };
    await refused('POST', '/api/v1/ar-receipts', { ...re, department_id: fDep }, 'department_id');
    await refused('POST', '/api/v1/ar-receipts', { ...re, salesperson_id: fSlm }, 'salesperson_id');
    await refused('POST', '/api/v1/ar-bills', { doc_type_id: await typeOf('BS'), doc_date: '2027-08-20', party_id: cus, items: [{ invoice_header_id: fake }], salesperson_id: fSlm }, 'salesperson_id');
    await refused('POST', '/api/v1/bank-deposits', { doc_type_id: await typeOf('BD'), doc_date: '2027-08-20', bank_account_id: bank, amount: 10, department_id: fDep }, 'department_id');
    const ou = { doc_type_id: await typeOf('OU'), doc_date: '2027-08-20', lines: [{ item_id: cpu, qty: 1 }] };
    await refused('POST', '/api/v1/stock-issues', { ...ou, department_id: fDep }, 'department_id');
    await refused('POST', '/api/v1/stock-issues', { ...ou, lines: [{ ...ou.lines[0], unit_id: fUnit }] }, 'unit_id');
    await refused('POST', '/api/v1/petty-payments', { doc_type_id: await typeOf('DP'), doc_date: '2027-08-20', lines: [{ account_id: expense, amount: 10, department_id: fDep }] }, 'department_id');
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM doc_header WHERE company_id = ${companyId}`.execute(database.db)).rows[0]!.n).toBe(before);
    // ใบสำคัญ: แก้ไขเป็นสมุดของบริษัทอื่นไม่ได้ · ยอดยกมาแผนกบริษัทอื่นไม่ได้
    const jv = (await call('POST', '/api/v1/gl/journals', { journal_book_id: bookId, voucher_date: '2027-08-20', lines: [{ account_id: expense, debit: '1' }, { account_id: cash, credit: '1' }] })).body;
    await refused('PUT', `/api/v1/gl/journals/${jv.id}`, { journal_book_id: fBook, voucher_date: '2027-08-20', lines: [{ account_id: expense, debit: '1' }, { account_id: cash, credit: '1' }] }, 'journal_book_id');
    expect((await call('GET', `/api/v1/gl/journals/${jv.id}`)).body.journal_book_id).toBe(bookId);
    expect((await call('POST', `/api/v1/gl/journals/${jv.id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
    await refused('PUT', '/api/v1/gl/opening', { period_start: '2026-01-01', rows: [{ account_id: cash, debit: '1', credit: '0', department_id: fDep }, { account_id: capital, debit: '0', credit: '1' }] }, 'department_id');
    // เช็ค · ใบนำฝากเช็ค · แฟ้มภาษีซื้อ/ขาย · ภาษีหัก ณ ที่จ่าย
    await refused('POST', '/api/v1/cheques', { direction: 'R', cheque_no: 'X-CHQ-1', cheque_date: '2027-08-20', customer_id: cus, amount: 10, department_id: fDep }, 'department_id');
    await refused('PUT', `/api/v1/cheques/${fake}`, { cheque_no: 'X-CHQ-1', bank_id: fBank }, 'bank_id');
    await refused('POST', '/api/v1/cheque-deposits', { cheque_ids: [fake], bank_account_id: bank, doc_date: '2027-08-20', department_id: fDep }, 'department_id');
    await refused('POST', '/api/v1/vat/S', { tax_invoice_no: 'X-VAT-1', tax_invoice_date: '2027-08-20', month: '2027-08', party_name: 'ลูกค้า', base_amount: 100, vat_amount: 7, department_id: fDep }, 'department_id');
    await refused('POST', '/api/v1/wht', { form_type: 'S03', certificate_date: '2027-08-20', payee_name: 'นายช่าง', income_type: 'ค่าจ้าง', paid_amount: 100, rate: 3, tax_amount: 3, journal_id: fJv }, 'journal_id');
    // รหัสของบริษัทนี้เองยังใช้ได้ตามปกติ
    const dep = (await sql<{ id: string }>`SELECT id FROM md_department WHERE company_id = ${companyId} AND deleted_at IS NULL LIMIT 1`.execute(database.db)).rows[0]?.id;
    if (dep) {
      const ok = await call('POST', '/api/v1/sales-invoices', { ...iv, department_id: dep });
      expect(ok.body.error?.message ?? 'ok').toBe('ok');
      expect((await call('POST', `/api/v1/sales-invoices/${ok.body.id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
    }
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
    // T3.3 ยกเลิกใบลดหนี้ก่อนใบกำกับ (กฎเหล็กการยกเลิก) → สินค้าที่รับคืน 6,000 ยกเลิกตาม
    expect(vals).toEqual(['999000.25', '999000.25']);
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
  it('customer setting "require two-factor for all users" (HANDOFF 146): off by default, admin only, existing sessions follow, provider staff and other customers unaffected', async () => {
    expect((await login('b.admin', 'passB1234')).body).toEqual({ ok: true });
    const bAdmin = cookie;
    const coB = (await call('GET', '/api/v1/auth/me')).body.companies[0].id;
    expect((await call('GET', '/api/v1/tenant/security')).body).toMatchObject({ require_mfa: false });
    expect((await call('POST', '/api/v1/users', { username: 'b.staff', display_name: 'พนักงาน บี', password: 'staffB1234', companies: [coB] })).status).toBe(200);
    expect((await login('b.staff', 'staffB1234')).body).toEqual({ ok: true });
    const staff = cookie;
    expect((await call('GET', '/api/v1/auth/me')).body.user.mfa_setup_required).toBe(false);
    expect((await call('PUT', '/api/v1/tenant/security', { require_mfa: true })).status).toBe(403);   // ผู้ใช้ทั่วไปตั้งไม่ได้
    cookie = admin;
    expect((await call('GET', '/api/v1/tenant/security')).status).toBe(403);   // เจ้าหน้าที่ผู้ให้บริการไม่มีค่าของลูกค้า
    cookie = bAdmin;
    const on = await call('PUT', '/api/v1/tenant/security', { require_mfa: true });
    expect([on.status, on.body.require_mfa, on.body.without_mfa >= 2]).toEqual([200, true, true]);
    // session ที่เปิดอยู่ถูกบังคับตั้งแต่คำขอถัดไป · หน้าตั้งค่ายังใช้ได้
    cookie = staff;
    expect((await call('GET', '/api/v1/auth/me')).body.user.mfa_setup_required).toBe(true);
    const blocked = await call('GET', '/api/v1/departments');
    expect([blocked.status, blocked.body.error.code]).toEqual([403, 'MFA_SETUP_REQUIRED']);
    expect(blocked.body.error.message).toMatch(/กิจการของคุณกำหนดให้ทุกผู้ใช้/);
    expect((await call('GET', '/api/v1/auth/2fa')).body.required).toBe(true);
    const key = base32Decode((await call('POST', '/api/v1/auth/2fa/setup')).body.secret);
    expect((await call('POST', '/api/v1/auth/2fa/enable', { code: totpAt(key, stepOf()) })).status).toBe(200);
    expect((await call('GET', '/api/v1/auth/me')).body.user.mfa_setup_required).toBe(false);
    expect((await call('GET', '/api/v1/departments')).body.error?.code).not.toBe('MFA_SETUP_REQUIRED');
    // ลูกค้ารายอื่น + เจ้าหน้าที่ผู้ให้บริการ ไม่ถูกบังคับ
    expect((await login('sec.lock', 'lockMe123')).body).toEqual({ ok: true });
    expect((await call('GET', '/api/v1/auth/me')).body.user.mfa_setup_required).toBe(false);
    cookie = admin;
    expect((await call('GET', '/api/v1/auth/me')).body.user.mfa_setup_required).toBe(false);
    expect((await call('GET', '/api/v1/users')).status).toBe(200);
    // ผู้ดูแลของลูกค้าที่ยังไม่ตั้ง ก็ต้องตั้งก่อน (ปิดค่ากลับได้หลังตั้ง)
    cookie = bAdmin;
    expect((await call('PUT', '/api/v1/tenant/security', { require_mfa: false })).body.error.code).toBe('MFA_SETUP_REQUIRED');
    const acts = (await database.db.selectFrom('sys_activity_log').select('action').where('action', 'in', ['TENANT_MFA_ON', 'TENANT_MFA_OFF']).execute()).map((x) => x.action);
    expect(acts).toEqual(['TENANT_MFA_ON']);
    await database.db.updateTable('sys_tenant').set({ require_mfa: false }).execute();   // คืนค่าให้ชุดทดสอบถัดไป
    expect((await call('GET', '/api/v1/auth/me')).body.user.mfa_setup_required).toBe(false);
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
  it('non-VAT company and bills without a seller name (เจ้าของ 19/11/2569): VAT becomes expense; central supplier + payer employee + substitute receipt (บ.ก.111), no input VAT, no WHT; other customers separate', async () => {
    cookie = '';
    await call('POST', '/api/v1/auth/login', { username: 'admin', password: 'secret123' });
    const co = (await call('GET', '/api/v1/auth/me')).body.companies.find((c: { code: string }) => c.code === 'DEMO').id;
    await call('POST', '/api/v1/auth/select', { company_id: co });
    const acc = (await call('GET', '/api/v1/gl/accounts')).body as Array<{ id: string; account_no: string; is_control: boolean }>;
    const expR = await call('POST', '/api/v1/other-expenses', { code: '95-NVAT-01', name_th: 'ค่าใช้จ่ายทดสอบไม่จด VAT', accounts: { expense: acc.find((x) => !x.is_control && x.account_no.startsWith('5'))!.id } });
    expect(expR.status, JSON.stringify(expR.body)).toBe(200);
    const oeT = (await call('GET', '/api/v1/trade-defaults/OE')).body.types[0].id;
    const vatRows = async (hid: string) => (await sql<{ n: number }>`SELECT count(*)::int AS n FROM tax_vat_entry WHERE header_id = ${hid} AND deleted_at IS NULL`.execute(database.db)).rows[0]!.n;
    const oe = (b: object) => call('POST', '/api/v1/other-expense-docs', { doc_type_id: oeT, doc_date: '2027-12-07', price_type: '2', vat_rate: 7, lines: [{ item_id: expR.body.id, description: 'ค่าน้ำมัน', amount: 1070 }], ...b });
    // ไม่จด VAT: ประเภทราคาเป็น 0 เสมอ ยอดทั้งหมดเป็นค่าใช้จ่าย ไม่มีภาษีซื้อ
    expect((await call('GET', '/api/v1/trade-defaults/OE')).body).toMatchObject({ vat_registered: true });
    await sql`INSERT INTO sys_setting (company_id, module, key, value) VALUES (${co}, 'GEN', 'gen.vat_registered', 'false'::jsonb)`.execute(database.db);
    expect((await call('GET', '/api/v1/trade-defaults/OE')).body.vat_registered).toBe(false);
    const nv = (await oe({ party_name: 'ร้านทดสอบไม่จด VAT' })).body;
    expect(nv.id, JSON.stringify(nv)).toBeTruthy();
    const nh = (await sql<{ price_type: string; vat_amount: string; net_amount: string; receipt_substitute: boolean }>`SELECT price_type, vat_amount::text, net_amount::text, receipt_substitute FROM doc_header WHERE id = ${nv.id}`.execute(database.db)).rows[0]!;
    expect([nh.price_type, nh.vat_amount, nh.net_amount, nh.receipt_substitute, await vatRows(nv.id)]).toEqual(['0', '0.00', '1070.00', false, 0]);
    await sql`DELETE FROM sys_setting WHERE company_id = ${co} AND key = 'gen.vat_registered'`.execute(database.db);
    // เจ้าหนี้กลาง: สร้างครั้งแรกแล้วจำไว้ (เรียกซ้ำได้รหัสเดิม)
    const c1 = (await call('POST', '/api/v1/ai/central-supplier', { target: 'other-expense-docs' })).body;
    expect(c1).toMatchObject({ code: 'NONAME', status: 'A' });
    expect((await call('POST', '/api/v1/ai/central-supplier', { target: 'other-expense-docs' })).body.id).toBe(c1.id);
    expect((await call('GET', '/api/v1/trade-defaults/OE')).body.central_supplier_id).toBe(c1.id);
    // ผู้จ่ายเงิน = พนักงาน
    const emp = (await sql<{ id: string }>`INSERT INTO pay_employee (company_id, code, title, first_name, last_name, position, hire_date) VALUES (${co}, 'EPAY1', 'นาย', 'สมชาย', 'จ่ายจริง', 'พนักงานจัดซื้อ', '2027-01-01') RETURNING id`.execute(database.db)).rows[0]!.id;
    expect((await call('GET', '/api/v1/payers?q=สมชาย')).body.rows).toEqual([{ id: emp, code: 'EPAY1', name: 'นาย สมชาย จ่ายจริง', position: 'พนักงานจัดซื้อ' }]);
    expect((await oe({ party_id: c1.id })).body.error.message).toMatch(/เลือกผู้จ่ายเงิน \(พนักงาน\)/);
    expect((await oe({ party_id: c1.id, payer_employee_id: emp, wht: [{ form_type: 'S53', income_type: 'ค่าบริการ', rate: 3, paid_amount: 1000, tax_amount: 30 }] })).body.error.message).toMatch(/ไม่หักภาษี ณ ที่จ่าย/);
    const sr = (await oe({ party_id: c1.id, payer_employee_id: emp })).body;
    expect(sr.id, JSON.stringify(sr)).toBeTruthy();
    const sh = (await sql<{ price_type: string; vat_amount: string; net_amount: string; receipt_substitute: boolean; payer_employee_id: string }>`SELECT price_type, vat_amount::text, net_amount::text, receipt_substitute, payer_employee_id FROM doc_header WHERE id = ${sr.id}`.execute(database.db)).rows[0]!;
    expect([sh.price_type, sh.vat_amount, sh.net_amount, sh.receipt_substitute, sh.payer_employee_id, await vatRows(sr.id)]).toEqual(['0', '0.00', '1070.00', true, emp, 0]);
    expect((await call('GET', `/api/v1/other-expense-docs/${sr.id}`)).body.payer).toMatchObject({ id: emp, code: 'EPAY1', name: 'นาย สมชาย จ่ายจริง' });
    const rcp = (await call('GET', `/api/v1/docs/${sr.id}/substitute-receipt`)).body;
    expect(rcp).toMatchObject({ doc_no: sr.doc_no, total: '1070.00', total_text: 'หนึ่งพันเจ็ดสิบบาทถ้วน', payer: { name: 'นาย สมชาย จ่ายจริง', position: 'พนักงานจัดซื้อ' }, lines: [{ description: 'ค่าน้ำมัน', amount: '1070.00' }] });
    expect((await call('GET', `/api/v1/docs/${nv.id}/substitute-receipt`)).status).toBe(400);   // ไม่ใช่บิลเจ้าหนี้กลาง
    // รายละเอียดในใบรับรอง = ข้อความตามบิล/ที่พิมพ์ · บรรทัดที่ไม่มีคำอธิบาย = ชื่อรหัส (เจ้าของ 19/11/2569 "ใช้ข้อความตามบิล")
    const sr2 = (await oe({ party_id: c1.id, payer_employee_id: emp, lines: [{ item_id: expR.body.id, description: 'ค่าแท็กซี่ไปลูกค้า', amount: 120 }, { item_id: expR.body.id, description: '', amount: 30 }] })).body;
    expect(sr2.id, JSON.stringify(sr2)).toBeTruthy();
    expect((await call('GET', `/api/v1/docs/${sr2.id}/substitute-receipt`)).body.lines.map((l: { description: string }) => l.description)).toEqual(['ค่าแท็กซี่ไปลูกค้า', 'ค่าใช้จ่ายทดสอบไม่จด VAT']);
    expect((await call('GET', `/api/v1/other-expense-docs/${sr2.id}`)).body.lines[0]).toMatchObject({ description: 'ค่าแท็กซี่ไปลูกค้า', item_name: 'ค่าใช้จ่ายทดสอบไม่จด VAT' });
    expect((await call('POST', `/api/v1/other-expense-docs/${sr2.id}/cancel`, { reason: 'ทดสอบ' })).status).toBe(200);
    // ลูกค้าอื่น: ไม่เห็นใบรับรอง/พนักงานของบริษัทนี้ ใช้พนักงานของบริษัทนี้เป็นผู้จ่ายไม่ได้ · เจ้าหนี้กลางของตัวเองแยกกัน
    cookie = '';
    expect((await call('POST', '/api/v1/auth/login', { username: 'b.admin', password: 'passB1234' })).status).toBe(200);
    const bCo = (await call('GET', '/api/v1/auth/me')).body.companies[0].id;
    await call('POST', '/api/v1/auth/select', { company_id: bCo });
    expect((await call('GET', `/api/v1/docs/${sr.id}/substitute-receipt`)).status).toBe(404);
    expect((await call('GET', '/api/v1/payers?q=สมชาย')).body.rows).toEqual([]);
    const bc = (await call('POST', '/api/v1/ai/central-supplier', { target: 'other-expense-docs' })).body;
    expect(bc.id && bc.id !== c1.id).toBe(true);
    const bT = (await call('GET', '/api/v1/trade-defaults/OE')).body.types[0]?.id;
    if (bT) expect((await call('POST', '/api/v1/other-expense-docs', { doc_type_id: bT, doc_date: '2027-12-07', party_id: bc.id, payer_employee_id: emp, price_type: '0', vat_rate: 7, lines: [{ description: 'x', amount: 10 }] })).body.error.message).toMatch(/ผู้จ่ายเงิน|รหัสค่าใช้จ่าย/);
    cookie = '';
    await call('POST', '/api/v1/auth/login', { username: 'admin', password: 'secret123' });
    await call('POST', '/api/v1/auth/select', { company_id: co });
    for (const x of [nv, sr]) expect((await call('POST', `/api/v1/other-expense-docs/${x.id}/cancel`, { reason: 'ทดสอบ' })).status).toBe(200);
  });
  it('add a supplier from an AI-read bill (เจ้าของ 19/11/2569): tax ID is the key — no second supplier for the same tax ID (any branch, even inactive), other branch = branch of the same supplier used on purchase docs/VAT, bad tax ID refused, next code, activity log, other customers separate', async () => {
    cookie = '';
    await call('POST', '/api/v1/auth/login', { username: 'admin', password: 'secret123' });
    const co = (await call('GET', '/api/v1/auth/me')).body.companies.find((c: { code: string }) => c.code === 'DEMO').id;
    await call('POST', '/api/v1/auth/select', { company_id: co });
    const pea = { name: 'การไฟฟ้าส่วนภูมิภาค', tax_id: '0994000165501', tax_branch_no: '00000', address_1: '200 ถนนงามวงศ์วาน กรุงเทพมหานคร 10900', zip_code: '10900', phone: '1129', from_bill: true };
    const next = (await call('GET', '/api/v1/suppliers/next-code')).body.code as string;
    expect(next).toMatch(/\d$/);
    const s1 = await call('POST', '/api/v1/suppliers', { ...pea, code: next });
    expect(s1.status).toBe(200);
    expect((await call('GET', '/api/v1/suppliers/next-code')).body.code).not.toBe(next);
    const log = (await sql<{ detail: { from?: string; tax_id?: string } }>`SELECT detail FROM sys_activity_log WHERE table_name = 'md_supplier' AND row_id = ${s1.body.id} AND action = 'ADD'`.execute(database.db)).rows[0];
    expect(log?.detail).toMatchObject({ from: 'AI_BILL', tax_id: '0994000165501' });
    // เลข+สาขาเดียวกัน (ชื่อต่างกันก็ตาม) = ไม่เพิ่มซ้ำ — ทั้งจากบิลและหน้าผู้จำหน่ายปกติ
    expect((await call('POST', '/api/v1/suppliers', { ...pea, code: 'PEA-DUP', name: 'กฟภ.' })).body.error.message).toMatch(/0994000165501 เป็นของผู้จำหน่าย .+ แล้ว — ถ้าเป็นสาขาอื่นของรายเดียวกัน ให้เพิ่มสาขาที่แท็บ สาขา/);
    expect((await call('POST', '/api/v1/suppliers', { ...pea, code: 'PEA-DUP', from_bill: undefined })).status).toBe(409);
    // เลิกใช้แล้ว: จากบิลไม่ให้เพิ่ม (ให้เปิดใช้รหัสเดิม) · หน้าปกติยังเตือนตามกติกาเดิม (30/10/2569)
    const cur = (await call('GET', `/api/v1/suppliers/${s1.body.id}`)).body;
    expect((await call('PUT', `/api/v1/suppliers/${s1.body.id}`, { ...pea, code: next, from_bill: undefined, status: 'I', banks: [], contacts: [], ap_account_id: cur.ap_account_id })).status).toBe(200);
    expect((await call('POST', '/api/v1/suppliers', { ...pea, code: 'PEA-DUP' })).body.error.message).toMatch(/เลิกใช้อยู่.+เปิดใช้รหัสเดิม/);
    await call('PUT', `/api/v1/suppliers/${s1.body.id}`, { ...pea, code: next, from_bill: undefined, status: 'A', banks: [], contacts: [], ap_account_id: cur.ap_account_id });
    // คนละสาขา: ไม่สร้างเจ้าหนี้ซ้ำ — เพิ่มสาขาให้รายเดิม (แท็บสาขา หรือจากหน้าต่างอ่านบิล)
    expect((await call('POST', '/api/v1/suppliers', { ...pea, code: 'PEA-B1', tax_branch_no: '1' })).status).toBe(409);
    const br = { branch_no: '00012', name: 'สาขา 00012', address_1: '12 ถนนสาขาสิบสอง', zip_code: '50000', phone: null };
    expect((await call('POST', `/api/v1/suppliers/${s1.body.id}/branches`, br)).status).toBe(200);
    expect((await call('POST', `/api/v1/suppliers/${s1.body.id}/branches`, br)).status).toBe(409);
    expect((await call('POST', `/api/v1/suppliers/${s1.body.id}/branches`, { ...br, branch_no: '00000' })).status).toBe(409);
    const det = (await call('GET', `/api/v1/suppliers/${s1.body.id}`)).body;
    expect([det.branches.map((x: { branch_no: string }) => x.branch_no), det.tax_branches.includes('00012')]).toEqual([['00012'], true]);
    // แท็บสาขาในแฟ้ม: ห้ามซ้ำกับสาขาตามแฟ้ม/ซ้ำกันเอง
    expect((await call('PUT', `/api/v1/suppliers/${s1.body.id}`, { ...pea, code: next, from_bill: undefined, banks: [], contacts: [], branches: [br, br], ap_account_id: cur.ap_account_id })).body.error.message).toMatch(/ซ้ำ/);
    // เอกสารค่าใช้จ่ายจากสาขา 00012 → ที่อยู่สาขา + ภาษีซื้อสาขา 00012
    const acc = (await call('GET', '/api/v1/gl/accounts')).body as Array<{ id: string; account_no: string; is_control: boolean }>;
    const expAcc = acc.find((x) => !x.is_control && x.account_no.startsWith('5'))!.id;
    const expR = await call('POST', '/api/v1/other-expenses', { code: '95-PEA1-01', name_th: 'ค่าไฟฟ้าทดสอบ', accounts: { expense: expAcc } });
    expect(expR.status, JSON.stringify(expR.body)).toBe(200);
    const exp = expR.body.id;
    const oeT = (await call('GET', '/api/v1/trade-defaults/OE')).body.types[0].id;
    const oe = (await call('POST', '/api/v1/other-expense-docs', { doc_type_id: oeT, doc_date: '2027-12-05', party_id: s1.body.id, party_tax_branch_no: '00012', ref_no: 'E-1', ref_date: '2027-12-05', price_type: '2', vat_rate: 7, lines: [{ item_id: exp, description: 'ค่าไฟฟ้า', amount: 1000 }] })).body;
    expect(oe.id, JSON.stringify(oe)).toBeTruthy();
    const oh = (await sql<{ party_address: string; party_tax_branch_no: string }>`SELECT party_address, party_tax_branch_no FROM doc_header WHERE id = ${oe.id}`.execute(database.db)).rows[0]!;
    expect([oh.party_tax_branch_no, oh.party_address]).toEqual(['00012', '12 ถนนสาขาสิบสอง 50000']);
    expect((await sql<{ b: string }>`SELECT party_tax_branch_no AS b FROM tax_vat_entry WHERE header_id = ${oe.id} AND deleted_at IS NULL`.execute(database.db)).rows.map((r) => r.b)).toEqual(['00012']);
    expect((await call('POST', `/api/v1/other-expense-docs/${oe.id}/cancel`, { reason: 'ทดสอบ' })).status).toBe(200);
    // เลขอ่านผิด (12 หลัก / หลักตรวจสอบผิด) = บันทึกไม่ได้ ให้แก้
    expect((await call('POST', '/api/v1/suppliers', { ...pea, code: 'PEA-X', tax_id: '099400016550' })).status).toBe(400);
    expect((await call('POST', '/api/v1/suppliers', { ...pea, code: 'PEA-X', tax_id: '0994000165502' })).status).toBe(400);
    // ลูกค้าอื่น: ไม่เห็นผู้จำหน่ายของบริษัทนี้ เพิ่มเลขเดียวกันในบริษัทของตัวเองได้ (ตรวจซ้ำเฉพาะในบริษัท) · รหัสถัดไปคิดจากบริษัทตัวเอง
    cookie = '';
    expect((await call('POST', '/api/v1/auth/login', { username: 'b.admin', password: 'passB1234' })).status).toBe(200);
    const bCo = (await call('GET', '/api/v1/auth/me')).body.companies[0].id;
    await call('POST', '/api/v1/auth/select', { company_id: bCo });
    expect((await call('GET', '/api/v1/suppliers?q=0994000165501&status=all')).body.rows).toEqual([]);
    expect((await call('GET', `/api/v1/suppliers/${s1.body.id}`)).status).toBe(404);
    const bNext = (await call('GET', '/api/v1/suppliers/next-code')).body.code;
    expect((await call('POST', '/api/v1/suppliers', { ...pea, code: bNext, company_id: co })).status).toBe(200);
    expect((await call('POST', `/api/v1/suppliers/${s1.body.id}/branches`, { ...br, branch_no: '00013' })).status).toBe(404);   // เพิ่มสาขาให้ผู้จำหน่ายของลูกค้าอื่นไม่ได้
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM md_supplier WHERE company_id = ${co} AND tax_id = '0994000165501' AND deleted_at IS NULL`.execute(database.db)).rows[0]!.n).toBe(1);
    cookie = '';
    await call('POST', '/api/v1/auth/login', { username: 'admin', password: 'secret123' });
    await call('POST', '/api/v1/auth/select', { company_id: co });
  });
  it('AI bill from local OCR text (hybrid): another customer (tenant) cannot use this company\'s key or see its usage, company_id in the body is ignored', async () => {
    process.env.BUDDY_SECRET_KEY = Buffer.alloc(32, 7).toString('base64');
    let calls = 0, buyerTax: string | null = null;
    setAiClientFactory(() => ({ beta: { messages: { parse: async (params: Record<string, any>) => { calls++; return String(params.system).includes('เลือกรหัส')
      ? { model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 }, parsed_output: { lines: [] } }
      : { model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 50 }, parsed_output: { doc_kind: 'receipt', supplier: { name: 'ร้านทดสอบ', tax_id: null, branch_no: null, address: null }, buyer: { name: 'บริษัท', tax_id: buyerTax }, doc_no: 'R-1', doc_date: '2027-01-02', price_type: 'no_vat', vat_rate: null, lines: [{ description: 'น้ำดื่ม', qty: '1', unit: null, unit_price: '20', amount: '20' }], subtotal: '20', discount: null, vat_amount: null, total: '20', notes: [] } }; } } } }) as never);
    cookie = '';
    await call('POST', '/api/v1/auth/login', { username: 'admin', password: 'secret123' });
    const co = (await call('GET', '/api/v1/auth/me')).body.companies.find((c: { code: string }) => c.code === 'DEMO').id;
    await call('POST', '/api/v1/auth/select', { company_id: co });
    expect((await call('PUT', '/api/v1/ai/config', { api_key: 'sk-ant-api03-TENANTA_' + 'y'.repeat(30) + 'zz99', monthly_limit_usd: 20 })).body.has_key).toBe(true);
    const body = { target: 'purchase-invoices', file_name: 'r.jpg', file_size: 1000, text: 'ใบเสร็จรับเงิน ร้านทดสอบ น้ำดื่ม 1 ขวด 20.00 รวม 20.00' };
    const t0 = (await call('POST', '/api/v1/ai/read-bill-text', body)).body;
    expect([t0.read_by, t0.buyer_check.status]).toEqual(['local_ocr', 'none']);   // บิลไม่มีเลขผู้ซื้อ
    // ผู้ซื้อ = บริษัทนี้ (เจ้าของ 19/11/2569): อ่านเพี้ยน 1 หลัก = ใช้เลขบริษัท · เลขของผู้อื่น = เตือน
    const coTax = (await sql<{ t: string | null }>`SELECT tax_id AS t FROM sys_company WHERE id = ${co}`.execute(database.db)).rows[0]!.t;
    await sql`UPDATE sys_company SET tax_id = '0105537095903' WHERE id = ${co}`.execute(database.db);
    buyerTax = '010553709590';
    const t1 = (await call('POST', '/api/v1/ai/read-bill-text', body)).body;
    expect([t1.buyer_check.status, t1.buyer_check.company_tax_id, t1.bill.warnings.some((w: string) => /ในนามผู้อื่น/.test(w))]).toEqual(['misread', '0105537095903', false]);
    buyerTax = '0994000165501';
    const t2 = (await call('POST', '/api/v1/ai/read-bill-text', body)).body;
    expect([t2.buyer_check.status, t2.bill.warnings[0]]).toEqual(['other', expect.stringMatching(/^บิลนี้ออกในนามผู้อื่น/)]);
    await sql`UPDATE sys_company SET tax_id = ${coTax} WHERE id = ${co}`.execute(database.db);
    const mine = calls;
    cookie = '';
    expect((await call('POST', '/api/v1/auth/login', { username: 'b.admin', password: 'passB1234' })).status).toBe(200);
    const bCo = (await call('GET', '/api/v1/auth/me')).body.companies[0].id;
    await call('POST', '/api/v1/auth/select', { company_id: bCo });
    expect((await call('POST', '/api/v1/ai/read-bill-text', { ...body, company_id: co })).body.error.message).toMatch(/ยังไม่ได้ตั้งค่า AI/);
    expect(calls).toBe(mine);   // ไม่ได้เรียก Claude ด้วยกุญแจของลูกค้าอื่น
    expect((await call('GET', '/api/v1/ai/usage')).body).toEqual([]);
    expect((await call('GET', '/api/v1/ai/config')).body).toMatchObject({ has_key: false, month_count: 0 });
    cookie = '';
    await call('POST', '/api/v1/auth/login', { username: 'admin', password: 'secret123' });
    await call('POST', '/api/v1/auth/select', { company_id: co });
    expect((await call('PUT', '/api/v1/ai/config', { api_key: null, monthly_limit_usd: 20 })).body.has_key).toBe(false);
  });
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
    expect(tr[0]!.slice(0, 7)).toEqual(['เลขที่อ้างอิง', 'เลขที่เอกสาร', 'วันที่ *', 'รหัสลูกค้า', 'ชื่อลูกค้า', 'Bill to (สาขาลูกค้า)', 'สถานที่ส่งของ']);
    expect(tr).toHaveLength(4);
    expect((await app.inject({ method: 'GET', url: '/api/v1/trade-import/sales-orders/template', headers: { cookie } })).statusCode).toBe(200);   // HANDOFF 171: ใบสั่งขายนำเข้าได้แล้ว
    expect((await app.inject({ method: 'GET', url: '/api/v1/trade-import/no-such-kind/template', headers: { cookie } })).statusCode).toBe(404);

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

  it('HANDOFF 167: missing suppliers/items added in the same transaction (check = nothing saved), rights, OE with WHT, other tenant gets its own masters', async () => {
    cookie = '';
    expect((await call('POST', '/api/v1/auth/login', { username: 'admin', password: 'secret123' })).status).toBe(200);
    const co = (await call('GET', '/api/v1/auth/me')).body.companies.find((c: { code: string }) => c.code === 'DEMO').id;
    await call('POST', '/api/v1/auth/select', { company_id: co });
    expect((await call('POST', '/api/v1/suppliers', { code: 'IMP-S1', name: 'ผู้ขายเดิม', tax_id: tid(960) })).status).toBe(200);
    const item = (await call('GET', '/api/v1/items?status=A')).body.rows.find((r: { unit_code: string | null }) => r.unit_code) as { code: string };
    expect(item?.code).toBeTruthy();
    const rrType = (await call('GET', '/api/v1/trade-defaults/RR')).body.types[0].id;
    const next = (await call('GET', '/api/v1/suppliers/next-code')).body.code as string;
    const q = async <T,>(s: ReturnType<typeof sql>) => (await s.execute(database.db)).rows as T[];
    const count = async (s: ReturnType<typeof sql>) => (await q<{ n: number }>(s))[0]!.n;

    // แบบฟอร์ม: คอลัมน์รหัสตามด้วยชื่อ · คอลัมน์ข้อมูลหลักใหม่อยู่ท้าย · แผ่นคำอธิบายบอกวิธีเพิ่มรายใหม่
    const t = await app.inject({ method: 'GET', url: '/api/v1/trade-import/purchase-invoices/template', headers: { cookie } });
    const tr = readTable('import-RR.xlsx', t.rawPayload);
    expect(tr[0]!.slice(0, 7)).toEqual(['เลขที่อ้างอิง', 'เลขที่เอกสาร', 'วันที่ *', 'รหัสผู้จำหน่าย', 'ชื่อผู้จำหน่าย', 'สาขาผู้ขาย', 'เลขที่ใบกำกับผู้จำหน่าย']);
    expect(tr[0]!.slice(-4)).toEqual(['เลขผู้เสียภาษี', 'ที่อยู่', 'โทรศัพท์', 'ชนิดสินค้า']);

    const H = ['เลขที่อ้างอิง', 'วันที่', 'รหัสผู้จำหน่าย', 'ชื่อผู้จำหน่าย', 'เลขผู้เสียภาษี', 'สาขา', 'ที่อยู่', 'รหัสสินค้า', 'ชื่อสินค้า', 'ชนิดสินค้า', 'จำนวน', 'หน่วย', 'ราคาต่อหน่วย'];
    const file = csv([H,
      ['IMPN-1', '15/07/2569', '', 'ผู้ขายใหม่จาก Excel', tid(961), '', '9 ถนนทดสอบ', item.code, '', '', '2', '', '100'],
      ['IMPN-1', '15/07/2569', '', '', tid(961), '0', '', '', 'ของใหม่นำเข้า', 'สินค้า', '3', 'กล่องX', '50'],
      ['IMPN-2', '16/07/2569', 'IMP-S9', 'ผู้ขายรหัสเอง', tid(962), '', '', '99-IMPS-SV0001', 'ค่าบริการนำเข้า', 'บริการ', '1', '', '1000'],
      ['IMPN-3', '16/07/2569', 'IMP-S1', '', '', '', '', '', 'ของใหม่นำเข้า', '', '1', 'กล่องX', '50']]);
    const url = '/api/v1/trade-import/purchase-invoices';
    const base = { file_name: 'ซื้อ.csv', doc_type_id: rrType, price_type: '2', vat_rate: 7, data: file };
    const nothing = async () => [
      await count(sql`SELECT count(*)::int AS n FROM md_supplier WHERE tax_id = ${tid(961)} OR code = 'IMP-S9'`),
      await count(sql`SELECT count(*)::int AS n FROM md_item WHERE code = '99-IMPS-SV0001' OR name_th = 'ของใหม่นำเข้า'`),
      await count(sql`SELECT count(*)::int AS n FROM md_unit WHERE code = 'กล่องX'`),
      await count(sql`SELECT count(*)::int AS n FROM doc_header WHERE your_ref LIKE 'IMPN-%'`)];

    // ไม่ติ๊ก (ค่าเดิมของ API) = รหัสที่ไม่พบเป็นข้อผิดพลาดเหมือนเดิม
    const off = await call('POST', url, base);
    expect(off.body.ok).toBe(false);
    expect(off.body.errors.map((e: { message: string }) => e.message).join('|')).toMatch(/ไม่พบผู้จำหน่ายเลขผู้เสียภาษี .*ติ๊ก "เพิ่มข้อมูลหลักที่ยังไม่มีให้อัตโนมัติ".*\|.*ไม่พบสินค้าชื่อ "ของใหม่นำเข้า".*\|.*ไม่พบรหัสผู้จำหน่าย IMP-S9.*\|.*ไม่พบรหัสสินค้า 99-IMPS-SV0001/);
    // ติ๊ก + ตรวจ: บอกรายการที่จะเพิ่ม ลองบันทึกจริงแล้วถอยกลับ — ไม่มีอะไรค้างในฐานข้อมูล
    const pv = await call('POST', url, { ...base, create_masters: true });
    expect(pv.body.errors).toEqual([]);
    expect(pv.body).toMatchObject({ ok: true, committed: false, create_masters: true, total_net: '1498.00' });
    expect(pv.body.new_masters).toEqual({
      parties: [{ code: next, name: 'ผู้ขายใหม่จาก Excel', tax_id: tid(961), tax_branch_no: '00000', row: 2 }, { code: 'IMP-S9', name: 'ผู้ขายรหัสเอง', tax_id: tid(962), tax_branch_no: '00000', row: 4 }],
      items: [expect.objectContaining({ name: 'ของใหม่นำเข้า', kind: '0', unit: 'กล่องX', row: 3 }), { code: '99-IMPS-SV0001', name: 'ค่าบริการนำเข้า', kind: '3', unit: null, row: 4 }], units: ['กล่องX'] });
    expect(pv.body.docs.map((x: { ref: string; party_code: string; party_new: boolean; new_items: number; net_amount: string; doc_no: string | null }) => [x.ref, x.party_code, x.party_new, x.new_items, x.net_amount, x.doc_no]))
      .toEqual([['IMPN-1', next, true, 1, '374.50', null], ['IMPN-2', 'IMP-S9', true, 1, '1070.00', null], ['IMPN-3', 'IMP-S1', false, 1, '53.50', null]]);
    expect(await nothing()).toEqual([0, 0, 0, 0]);

    // ผู้ใช้ที่มีสิทธิ์นำเข้า/ซื้อ แต่ไม่มีสิทธิ์เพิ่มผู้จำหน่าย/สินค้า → บอกสิทธิ์ที่ขาด ไม่บันทึก
    const admin = cookie;
    const uid = (await call('POST', '/api/v1/users', { username: 'imp.buyer', display_name: 'พนักงานซื้อ', password: 'buyerImp123', companies: [co], check_rights: true })).body.id;
    const R = (menu_code: string, v: Partial<Record<string, string>>) => ({ menu_code, can_read: '', can_add: '', can_edit: '', can_cancel: '', can_delete: '', can_print: '', can_approve: '', ...v });
    expect((await call('PUT', '/api/v1/permissions', { subject_type: 'U', subject_id: uid, rows: [R('OT.IMPTRADE', { can_read: 'Y', can_add: 'Y' }), R('PU.RR', { can_read: 'Y', can_add: 'Y' }), R('PU.SUP', { can_read: 'Y' }), R('IC.ITEM', { can_read: 'Y' })] })).status).toBe(200);
    cookie = '';
    expect((await call('POST', '/api/v1/auth/login', { username: 'imp.buyer', password: 'buyerImp123' })).status).toBe(200);
    await call('POST', '/api/v1/auth/select', { company_id: co });
    const nr = await call('POST', url, { ...base, create_masters: true, commit: true });
    expect(nr.status).toBe(400);
    expect(nr.body.error.message).toMatch(/มีข้อผิดพลาด 4 รายการ/);
    expect(nr.body.error.issues.map((f: { message: string }) => f.message).join('|')).toMatch(/ไม่มีสิทธิ์เพิ่มผู้จำหน่าย \(เมนู รายละเอียดผู้จำหน่าย\).*\|.*ไม่มีสิทธิ์เพิ่มสินค้า \(เมนู รายละเอียดสินค้า\).*\|.*ไม่มีสิทธิ์เพิ่มสินค้าบริการ/);
    // ตรวจ (ไม่บันทึก) ก็เห็นสิทธิ์ที่ขาดรายแถว
    expect((await call('POST', url, { ...base, create_masters: true })).body.errors.map((e: { row: number }) => e.row)).toEqual([2, 3, 4, 4]);
    expect(await nothing()).toEqual([0, 0, 0, 0]);
    cookie = admin;

    // บันทึก: ข้อมูลหลัก + เอกสารในทรานแซกชันเดียว · ลงบัญชีปกติ · ประวัติทุกราย
    const ok = await call('POST', url, { ...base, create_masters: true, commit: true });
    expect(ok.body.error?.message ?? 'ok').toBe('ok');
    expect(ok.body).toMatchObject({ ok: true, committed: true, total_net: '1498.00' });
    const sup = (await q<{ id: string; code: string; name: string; tax_branch_no: string; address_1: string; status: string; company_id: string }>(sql`SELECT id, code, name, tax_branch_no, address_1, status, company_id FROM md_supplier WHERE tax_id = ${tid(961)} AND deleted_at IS NULL`))[0]!;
    expect(sup).toMatchObject({ code: next, name: 'ผู้ขายใหม่จาก Excel', tax_branch_no: '00000', address_1: '9 ถนนทดสอบ', status: 'A', company_id: co });
    const items = await q<{ id: string; code: string; item_type: string; unit: string | null; rate: string | null; company_id: string }>(sql`SELECT i.id, i.code, i.item_type, u.code AS unit, u.rate::text AS rate, i.company_id FROM md_item i LEFT JOIN md_unit u ON u.id = i.base_unit_id
        WHERE (i.code = '99-IMPS-SV0001' OR i.name_th = 'ของใหม่นำเข้า') AND i.deleted_at IS NULL ORDER BY i.item_type`);
    expect(items.map((i) => [i.item_type, i.unit, i.company_id])).toEqual([['0', 'กล่องX', co], ['3', null, co]]);
    expect(Number(items[0]!.rate)).toBe(1);
    const docs = await q<{ your_ref: string; supplier_id: string; gl_posted: string; net_amount: string }>(sql`SELECT your_ref, supplier_id, gl_posted, net_amount FROM doc_header WHERE company_id = ${co} AND your_ref LIKE 'IMPN-%' ORDER BY your_ref`);
    expect(docs.map((x) => [x.your_ref, x.gl_posted, x.net_amount])).toEqual([['IMPN-1', 'Y', '374.50'], ['IMPN-2', 'Y', '1070.00'], ['IMPN-3', 'Y', '53.50']]);
    expect(docs[0]!.supplier_id).toBe(sup.id);
    const lineItems = await q<{ item_id: string }>(sql`SELECT l.item_id FROM doc_line l JOIN doc_header h ON h.id = l.header_id WHERE h.your_ref IN ('IMPN-1', 'IMPN-3') AND l.deleted_at IS NULL ORDER BY h.your_ref, l.line_no`);
    expect(lineItems.map((l) => l.item_id).slice(1)).toEqual([items[0]!.id, items[0]!.id]);   // สินค้าใหม่ตัวเดียว ใช้ทั้งสองเอกสาร
    const logs = await q<{ table_name: string; doc_no: string }>(sql`SELECT table_name, doc_no FROM sys_activity_log WHERE company_id = ${co} AND action = 'ADD' AND detail->>'from' = 'IMPORT' AND detail->>'file' = 'ซื้อ.csv' ORDER BY seq`);
    expect(logs.map((l) => `${l.table_name}:${l.doc_no}`)).toEqual([`md_supplier:${next}`, 'md_supplier:IMP-S9', 'md_unit:กล่องX', `md_item:${items[0]!.code}`, 'md_item:99-IMPS-SV0001']);
    const imp = (await q<{ detail: { new_parties: string[]; new_items: string[]; new_units: string[] } }>(sql`SELECT detail FROM sys_activity_log WHERE company_id = ${co} AND action = 'IMPORT' AND detail->>'file' = 'ซื้อ.csv'`))[0]!;
    expect(imp.detail).toMatchObject({ new_parties: [next, 'IMP-S9'], new_items: [items[0]!.code, '99-IMPS-SV0001'], new_units: ['กล่องX'] });
    // นำเข้าแฟ้มเดิมอีกครั้ง: หาเจอจากเลขผู้เสียภาษี/ชื่อ/รหัส (ไม่เพิ่มซ้ำ) และกันเอกสารซ้ำ
    const again = await call('POST', url, { ...base, create_masters: true });
    expect(again.body.new_masters).toEqual({ parties: [], items: [], units: [] });
    expect(again.body.errors.map((e: { message: string }) => e.message)).toEqual([expect.stringMatching(/IMPN-1 เคยนำเข้าแล้ว/), expect.stringMatching(/IMPN-2 เคยนำเข้าแล้ว/), expect.stringMatching(/IMPN-3 เคยนำเข้าแล้ว/)]);

    // บันทึกค่าใช้จ่ายอื่น ๆ (OE): ภาษีหัก ณ ที่จ่ายต่อเอกสาร (ฐาน = ยอดก่อน VAT) · ชื่ออย่างเดียว = ไม่เพิ่มผู้จำหน่าย · รหัสค่าใช้จ่ายไม่เพิ่มให้
    const exp = (await call('GET', '/api/v1/other-expenses?status=A')).body.rows[0].code as string;
    const oeType = (await call('GET', '/api/v1/trade-defaults/OE')).body.types[0].id;
    const ot = readTable('import-OE.xlsx', (await app.inject({ method: 'GET', url: '/api/v1/trade-import/other-expense-docs/template', headers: { cookie } })).rawPayload);
    expect(ot[0]!).toEqual(expect.arrayContaining(['เลขที่อ้างอิง', 'เลขที่เอกสาร', 'วันที่ *', 'รหัสผู้จำหน่าย', 'ชื่อผู้จำหน่าย', 'รหัสค่าใช้จ่าย *', 'รายละเอียด', 'จำนวนเงิน *', 'อัตราหัก ณ ที่จ่าย', 'ภาษีหัก ณ ที่จ่าย', 'ประเภทเงินได้', 'แบบ ภ.ง.ด.', 'วิธีชำระ']));
    const EH = ['เลขที่อ้างอิง', 'วันที่', 'รหัสผู้จำหน่าย', 'ชื่อผู้จำหน่าย', 'รหัสค่าใช้จ่าย', 'รายละเอียด', 'จำนวนเงิน', 'อัตราหัก ณ ที่จ่าย', 'ภาษีหัก ณ ที่จ่าย', 'ประเภทเงินได้'];
    const oeRows = [EH,
      ['IMPE-1', '15/07/2569', 'IMP-S1', '', exp, 'ค่าขนส่ง ก.ค.', '1000', '1', '', ''],
      ['IMPE-1', '15/07/2569', 'IMP-S1', '', exp, '', '500', '', '', ''],
      ['IMPE-2', '16/07/2569', '', 'แท็กซี่หน้าบริษัท', exp, '', '120', '', '', '']];
    const oeUrl = '/api/v1/trade-import/other-expense-docs';
    const oeBase = { file_name: 'ค่าใช้จ่าย.csv', doc_type_id: oeType, price_type: '2', vat_rate: 7, create_masters: true };
    const oeBad = await call('POST', oeUrl, { ...oeBase, data: csv([...oeRows, ['IMPE-3', '16/07/2569', 'IMP-S1', '', 'NOEXP-1', '', '100', '', '', '']]) });
    expect(oeBad.body.errors).toEqual([{ row: 5, message: 'ไม่พบรหัสค่าใช้จ่าย NOEXP-1 — เพิ่มที่ ซื้อ › รายละเอียดค่าใช้จ่ายอื่น ๆ ก่อน (ระบบไม่เพิ่มให้ เพราะต้องกำหนดบัญชีค่าใช้จ่าย)' }]);
    expect(oeBad.body.new_masters).toEqual({ parties: [], items: [], units: [] });
    expect(oeBad.body.docs.map((x: { ref: string; party_code: string; party_name: string; amount: string; vat_amount: string; wht_amount: string; net_amount: string }) => [x.ref, x.party_code, x.party_name, x.amount, x.vat_amount, x.wht_amount, x.net_amount]))
      .toEqual([['IMPE-1', 'IMP-S1', 'ผู้ขายเดิม', '1500.00', '105.00', '15.00', '1605.00'], ['IMPE-2', '', 'แท็กซี่หน้าบริษัท', '120.00', '8.40', '0.00', '128.40']]);
    const oe = await call('POST', oeUrl, { ...oeBase, data: csv(oeRows), commit: true });
    expect(oe.body.error?.message ?? 'ok').toBe('ok');
    const oh = await q<{ id: string; your_ref: string; supplier_id: string | null; party_name: string; wht_amount: string; cash_amount: string; gl_posted: string }>(sql`SELECT id, your_ref, supplier_id, party_name, wht_amount, cash_amount, gl_posted FROM doc_header
        WHERE company_id = ${co} AND doc_class = 'OE' AND your_ref LIKE 'IMPE-%' ORDER BY your_ref`);
    expect(oh.map((x) => [x.your_ref, !!x.supplier_id, x.party_name, x.wht_amount, x.cash_amount, x.gl_posted])).toEqual([['IMPE-1', true, 'ผู้ขายเดิม', '15.00', '1590.00', 'Y'], ['IMPE-2', false, 'แท็กซี่หน้าบริษัท', '0.00', '128.40', 'Y']]);
    const w = await q<{ form_type: string; income_type: string; rate: string; paid_amount: string; tax_amount: string; payee_name: string }>(sql`SELECT form_type, income_type, rate::text AS rate, paid_amount, tax_amount, payee_name FROM tax_wht_entry WHERE header_id = ${oh[0]!.id} AND deleted_at IS NULL`);
    expect(w.map((x) => [x.form_type, x.income_type, Number(x.rate), x.paid_amount, x.tax_amount, x.payee_name])).toEqual([['S53', 'ค่าขนส่ง', 1, '1500.00', '15.00', 'ผู้ขายเดิม']]);
    expect(await count(sql`SELECT count(*)::int AS n FROM md_supplier WHERE name = 'แท็กซี่หน้าบริษัท'`)).toBe(0);

    // ลูกค้าอื่น (คนละ tenant): รหัสเดียวกับของ DEMO ไม่ถูกใช้ข้ามบริษัท — เพิ่มใหม่ในบริษัทของตัวเองเท่านั้น
    cookie = '';
    expect((await call('POST', '/api/v1/auth/login', { username: 'b.admin', password: 'passB1234' })).status).toBe(200);
    const bCo = (await call('GET', '/api/v1/auth/me')).body.companies[0].id as string;
    expect(bCo).not.toBe(co);
    await call('POST', '/api/v1/auth/select', { company_id: bCo });
    const bRr = (await call('GET', '/api/v1/trade-defaults/RR')).body.types[0]?.id as string;
    expect(bRr).toBeTruthy();
    const bFile = csv([['เลขที่อ้างอิง', 'วันที่', 'รหัสผู้จำหน่าย', 'ชื่อผู้จำหน่าย', 'เลขผู้เสียภาษี', 'รหัสสินค้า', 'ชื่อสินค้า', 'ชนิดสินค้า', 'จำนวน', 'ราคาต่อหน่วย'],
      ['IMPB-1', '15/07/2569', 'IMP-S1', 'ผู้ขายของบริษัท B', tid(960), '99-IMPS-SV0001', 'บริการของ B', 'บริการ', '1', '100']]);
    // company_id ที่แอบส่งมาในคำขอไม่มีผล (ใช้บริษัทจาก session)
    const bp = await call('POST', url, { file_name: 'b.csv', data: bFile, doc_type_id: bRr, price_type: '2', vat_rate: 7, create_masters: true, company_id: co });
    expect(bp.body.errors).toEqual([]);
    expect(bp.body.new_masters.parties).toEqual([expect.objectContaining({ code: 'IMP-S1', name: 'ผู้ขายของบริษัท B' })]);
    expect(bp.body.new_masters.items).toEqual([expect.objectContaining({ code: '99-IMPS-SV0001', name: 'บริการของ B' })]);
    // ใช้ประเภทเอกสารของ DEMO ไม่ได้
    expect((await call('POST', url, { file_name: 'b.csv', data: bFile, doc_type_id: rrType, create_masters: true, commit: true })).body.error.message).toMatch(/เลือกประเภทเอกสาร/);
    const bc = await call('POST', url, { file_name: 'b.csv', data: bFile, doc_type_id: bRr, price_type: '2', vat_rate: 7, create_masters: true, commit: true, company_id: co });
    expect(bc.body.error?.message ?? 'ok').toBe('ok');
    expect(await q<{ company_id: string; name: string }>(sql`SELECT company_id, name FROM md_supplier WHERE code = 'IMP-S1' AND deleted_at IS NULL ORDER BY name`)).toEqual([{ company_id: bCo, name: 'ผู้ขายของบริษัท B' }, { company_id: co, name: 'ผู้ขายเดิม' }]);
    expect(await q<{ company_id: string; name_th: string }>(sql`SELECT company_id, name_th FROM md_item WHERE code = '99-IMPS-SV0001' AND deleted_at IS NULL ORDER BY name_th`)).toEqual([{ company_id: co, name_th: 'ค่าบริการนำเข้า' }, { company_id: bCo, name_th: 'บริการของ B' }]);
    expect(await count(sql`SELECT count(*)::int AS n FROM sys_activity_log WHERE company_id = ${co} AND detail->>'file' = 'b.csv'`)).toBe(0);
  });

  it('HANDOFF 168: AI maps a messy Excel (mocked — header + sample only), mapping applied to every row, remembered per company/kind/header, code suggestions, AI usage logged, no leak to another tenant', async () => {
    process.env.BUDDY_SECRET_KEY = Buffer.alloc(32, 7).toString('base64');
    const prompts: string[] = [];
    let calls = 0, expCode = '';
    const MAP = { header_row: 2, columns: [{ target: 'ref', source: 0, constant: '' }, { target: 'date', source: 1, constant: '' }, { target: 'party_name', source: 2, constant: '' }, { target: 'description', source: 3, constant: '' },
      { target: 'code', source: 4, constant: '' }, { target: 'amount', source: 5, constant: '' }, { target: 'bogus', source: 1, constant: '' }], date_order: 'dmy', year: 'be', decimal: 'dot', group: 'continue', skip_words: ['รวม'], notes: 'ตรวจปี พ.ศ.' };
    setAiClientFactory(() => ({ beta: { messages: { parse: async (params: Record<string, any>) => {
      calls++; prompts.push(JSON.stringify(params.messages));
      expect(params.model).toBe('claude-haiku-5-5');
      expect(JSON.stringify(params.output_config.format)).not.toMatch(/anyOf|"null"/);
      return String(params.system).includes('จับคู่คอลัมน์')
        ? { model: 'claude-haiku-5-5', stop_reason: 'end_turn', usage: { input_tokens: 3000, output_tokens: 400 }, parsed_output: MAP }
        : { model: 'claude-haiku-5-5', stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 100 }, parsed_output: { lines: [{ index: 0, code: expCode, confidence: 'medium', reason: 'ค่าเดินทาง' }, { index: 5, code: 'NOT-IN-LIST', confidence: 'high', reason: 'x' }] } };
    } } } }) as never);
    cookie = '';
    await call('POST', '/api/v1/auth/login', { username: 'admin', password: 'secret123' });
    const co = (await call('GET', '/api/v1/auth/me')).body.companies.find((c: { code: string }) => c.code === 'DEMO').id;
    await call('POST', '/api/v1/auth/select', { company_id: co });
    expCode = (await call('GET', '/api/v1/other-expenses?status=A')).body.rows[0].code;
    const oeType = (await call('GET', '/api/v1/trade-defaults/OE')).body.types[0].id;
    const fillers = Array.from({ length: 30 }, (_, i) => [`F-${i + 1}`, '17/07/2569', 'แท็กซี่', `ค่าแท็กซี่ FILLER-${i + 1}`, expCode, '10']);
    const messy = csv([['รายงานค่าใช้จ่าย ก.ค. 2569'], [''], ['เลขที่', 'ว/ด/ป', 'จ่ายให้', 'รายการ', 'รหัส', 'ยอดเงิน'],
      ['M-1', '15 ก.ค. 2569', 'ผู้ขายเดิม', 'ค่าขนส่ง', expCode, '"1,000.00"'], ['', '', '', 'ค่าทางด่วน', expCode, '50.00'],
      ['M-2', '16/07/69', 'แท็กซี่หน้าบริษัท', 'ค่าแท็กซี่ไปธนาคาร', '', '120'], ['', '', '', 'รวมทั้งสิ้น', '', '"1,170.00"'], ...fillers]);
    const file = { target: 'other-expense-docs', file_name: 'ค่าใช้จ่าย-OCR.csv', data: messy };
    const aiRows = async (purpose: string) => (await sql<{ n: number }>`SELECT count(*)::int AS n FROM sys_ai_usage WHERE company_id = ${co} AND purpose = ${purpose} AND status = 'OK'`.execute(database.db)).rows[0]!.n;

    // ยังไม่เปิด AI: ตรวจรูปแบบได้ (ไม่ตรงแบบฟอร์ม ไม่มีการจับคู่ที่บันทึก) แต่เรียก AI ไม่ได้
    const a0 = (await call('POST', '/api/v1/import-map/analyze', file)).body;
    expect(a0).toMatchObject({ target: 'expense', matches: false, saved: null, ai: { available: false, has_key: false }, total_rows: 37, width: 6 });
    expect(a0.preview).toHaveLength(37);
    expect((await call('POST', '/api/v1/import-map/ai', file)).body.error.message).toMatch(/ยังไม่ได้ตั้งค่า AI/);
    expect(calls).toBe(0);
    // แฟ้มตามแบบฟอร์มอยู่แล้ว = ตรง
    expect((await call('POST', '/api/v1/import-map/analyze', { ...file, data: csv([['เลขที่อ้างอิง', 'วันที่', 'รหัสค่าใช้จ่าย', 'จำนวนเงิน'], ['A', '1/7/2569', expCode, '1']]) })).body.matches).toBe(true);

    expect((await call('PUT', '/api/v1/ai/config', { api_key: 'sk-ant-api03-MAP168_' + 'q'.repeat(30) + 'aa11', monthly_limit_usd: 20, model: 'claude-haiku-5-5' })).body.has_key).toBe(true);
    expect((await call('POST', '/api/v1/import-map/analyze', file)).body.ai).toMatchObject({ available: true, model: 'claude-haiku-5-5' });
    const mapBefore = await aiRows('MAP');
    const ai = await call('POST', '/api/v1/import-map/ai', file);
    expect(ai.status).toBe(200);
    expect(calls).toBe(1);
    // ส่งเฉพาะต้นแฟ้ม (25 แถว) — แถวท้ายแฟ้มไม่ถูกส่ง
    expect(prompts[0]).toMatch(/ค่าขนส่ง/); expect(prompts[0]).toMatch(/FILLER-18/); expect(prompts[0]).not.toMatch(/FILLER-19|FILLER-30/);
    expect(ai.body.mapping.columns.map((c: { target: string }) => c.target)).toEqual(['ref', 'date', 'party_name', 'description', 'code', 'amount']);   // ช่องที่ไม่รู้จักถูกตัด
    expect(ai.body.usage).toMatchObject({ model: 'claude-haiku-5-5', cost_usd: '0.0005' });
    expect(await aiRows('MAP')).toBe(mapBefore + 1);
    const mapping = ai.body.mapping;

    // ตรวจด้วยการจับคู่: ทุกแถว (ไม่ใช่แค่ตัวอย่าง) · แถวต่อเนื่องรวมเข้าเอกสารด้านบน · แถวรวมไม่นำเข้า · แถวไม่มีรหัส = ให้แนะนำรหัส
    const url = '/api/v1/trade-import/other-expense-docs';
    const base = { file_name: file.file_name, data: messy, doc_type_id: oeType, price_type: '2', vat_rate: 7, create_masters: true };
    const c1 = (await call('POST', url, { ...base, mapping })).body;
    expect(c1.mapped).toBe(true);
    expect(c1.skipped_rows).toEqual([7]);
    expect(c1.need_codes).toEqual([{ row: 6, text: 'ค่าแท็กซี่ไปธนาคาร', amount: '120' }]);
    expect(c1.errors.map((e: { row: number }) => e.row)).toEqual([6]);
    expect(c1.docs).toHaveLength(31);
    expect(c1.docs[0]).toMatchObject({ ref: 'M-1', row: 4, date: '2026-07-15', party_code: 'IMP-S1', lines: 2, amount: '1050.00' });
    // แนะนำรหัส: ประวัติ/ชื่อรหัสก่อน (ไม่เรียก AI) · กด AI = เรียกครั้งเดียวเฉพาะแถวที่เหลือ · รหัสนอกรายการไม่รับ
    const sBody = { target: 'other-expense-docs', file_name: file.file_name, items: c1.need_codes };
    const s0 = (await call('POST', '/api/v1/import-map/suggest', sBody)).body;
    expect(calls).toBe(1);
    expect(s0.kind).toBe('expense');
    const sugBefore = await aiRows('SUGGEST');
    const s1 = (await call('POST', '/api/v1/import-map/suggest', { ...sBody, use_ai: true })).body;
    expect(s0.rows[0].suggestion).toBeNull();   // ไม่มีประวัติ/ชื่อรหัสที่ตรง → เหลือให้ AI
    {
      expect(calls).toBe(2);
      expect(s1.rows[0].suggestion).toMatchObject({ code: expCode, source: 'ai', confidence: 'medium' });
      expect(await aiRows('SUGGEST')).toBe(sugBefore + 1);
    }
    // ยอมรับรหัส → ตรวจผ่าน
    const c2 = (await call('POST', url, { ...base, mapping, codes: { 6: expCode } })).body;
    expect(c2.errors).toEqual([]); expect(c2.need_codes).toEqual([]);
    expect(c2.total_net).toBe('1572.90');   // 1,050 + 120 + 30 × 10 = 1,470 + VAT 7%
    // ยืนยันการจับคู่ → จำไว้ (บริษัทนี้ · ค่าใช้จ่ายอื่น · ลายมือหัวตาราง)
    const sv = await call('POST', '/api/v1/import-map/save', { target: 'other-expense-docs', header: ['เลขที่', 'ว/ด/ป', 'จ่ายให้', 'รายการ', 'รหัส', 'ยอดเงิน'], mapping, company_id: 'x' });
    expect(sv.status).toBe(200);
    const keys = (await sql<{ key: string; company_id: string }>`SELECT key, company_id FROM sys_setting WHERE key LIKE 'imp.map.%' AND deleted_at IS NULL`.execute(database.db)).rows;
    expect(keys).toEqual([{ key: `imp.map.OE.${sv.body.signature}`, company_id: co }]);
    // แฟ้มรูปแบบเดิมครั้งต่อไป (หัวรายงานต่างกัน หัวตารางอยู่แถวแรก) → ใช้การจับคู่ที่บันทึก ไม่เรียก AI
    const again = csv([['เลขที่', 'ว/ด/ป', 'จ่ายให้', 'รายการ', 'รหัส ', 'ยอดเงิน'], ['M-9', '18/07/2569', 'ผู้ขายเดิม', 'ค่าน้ำมัน', '', '300']]);
    const a2 = (await call('POST', '/api/v1/import-map/analyze', { ...file, data: again })).body;
    expect(a2.matches).toBe(false);
    expect(a2.saved).toMatchObject({ signature: sv.body.signature, mapping: { header_row: 0, group: 'continue', year: 'be' } });
    expect(calls).toBe(2);
    // นำเข้าจริง (แฟ้มแรก + รหัสที่ยอมรับ): ลงบัญชีด้วย saveCash เดิม
    const cm = await call('POST', url, { ...base, mapping, codes: { 6: expCode }, commit: true });
    expect(cm.body.error?.message ?? 'ok').toBe('ok');
    const oh = (await sql<{ your_ref: string; net_amount: string; party_name: string; gl_posted: string }>`SELECT your_ref, net_amount, party_name, gl_posted FROM doc_header WHERE company_id = ${co} AND doc_class = 'OE' AND your_ref IN ('M-1', 'M-2') AND doc_status <> 'C' ORDER BY your_ref`.execute(database.db)).rows;
    expect(oh).toEqual([{ your_ref: 'M-1', net_amount: '1123.50', party_name: 'ผู้ขายเดิม', gl_posted: 'Y' }, { your_ref: 'M-2', net_amount: '128.40', party_name: 'แท็กซี่หน้าบริษัท', gl_posted: 'Y' }]);
    expect((await sql<{ d: { mapped: boolean; codes: number } }>`SELECT detail AS d FROM sys_activity_log WHERE company_id = ${co} AND action = 'IMPORT' AND detail->>'file' = ${file.file_name}`.execute(database.db)).rows[0]!.d).toMatchObject({ mapped: true, codes: 1 });

    // ใบสำคัญจากโปรแกรมอื่น: ไม่มีหัวตาราง · สมุดเป็นค่าคงที่ · แถวว่างเลขที่ = รายการต่อ
    const B = (await call('GET', '/api/v1/gl/books')).body.find((b: { code: string }) => b.code === '00') as { code: string; prefix: string | null };
    const jFile = csv([['15/07/2569', 'ADJ-168', 'ค่าเช่า ก.ค.', '5380-06', '"1,000.00"', ''], ['', '', '', '1111-00', '', '"1,000.00"']]);
    expect((await call('POST', '/api/v1/import-map/analyze', { target: 'journal', file_name: 'gl.csv', data: jFile })).body).toMatchObject({ target: 'journal', matches: false, saved: null });
    const jm = { header_row: -1, columns: [{ target: 'book', source: -1, constant: B.prefix?.trim() || B.code }, { target: 'date', source: 0, constant: '' }, { target: 'ref', source: 1, constant: '' }, { target: 'description', source: 2, constant: '' },
      { target: 'account', source: 3, constant: '' }, { target: 'debit', source: 4, constant: '' }, { target: 'credit', source: 5, constant: '' }], date_order: 'dmy', year: 'be', decimal: 'dot', group: 'continue', skip_words: [], notes: '' };
    const jr = (await call('POST', '/api/v1/gl/journal-import', { file_name: 'gl.csv', data: jFile, mapping: jm })).body;
    expect(jr).toMatchObject({ ok: true, mapped: true, row_shift: 1, import_count: 1, total_debit: '1000.00', total_credit: '1000.00' });
    expect((await call('POST', '/api/v1/import-map/save', { target: 'journal', header: [], mapping: jm })).body.error.message).toMatch(/ไม่มีหัวตาราง/);

    // ผู้ใช้ไม่มีสิทธิ์นำเข้า
    cookie = '';
    expect((await call('POST', '/api/v1/auth/login', { username: 'imp.clerk', password: 'clerkImp123' })).status).toBe(200);
    await call('POST', '/api/v1/auth/select', { company_id: co });
    expect((await call('POST', '/api/v1/import-map/analyze', file)).status).toBe(403);
    expect((await call('POST', '/api/v1/import-map/analyze', { ...file, target: 'journal' })).status).toBe(403);
    // ลูกค้าอื่น (tenant B): ไม่เห็นการจับคู่ของ DEMO · ใช้กุญแจ AI ของ DEMO ไม่ได้ · บันทึกการจับคู่เป็นของบริษัทตัวเอง · แนะนำรหัสจากข้อมูลของตัวเอง
    cookie = '';
    expect((await call('POST', '/api/v1/auth/login', { username: 'b.admin', password: 'passB1234' })).status).toBe(200);
    const bCo = (await call('GET', '/api/v1/auth/me')).body.companies[0].id as string;
    await call('POST', '/api/v1/auth/select', { company_id: bCo });
    const n0 = calls;
    const b1 = (await call('POST', '/api/v1/import-map/analyze', { ...file, data: again, company_id: co })).body;
    expect(b1.saved).toBeNull();
    expect(b1.ai).toMatchObject({ available: false, has_key: false });
    expect((await call('POST', '/api/v1/import-map/ai', { ...file, company_id: co })).body.error.message).toMatch(/ยังไม่ได้ตั้งค่า AI/);
    expect(calls).toBe(n0);
    const bs = await call('POST', '/api/v1/import-map/save', { target: 'other-expense-docs', header: ['เลขที่', 'ว/ด/ป', 'จ่ายให้', 'รายการ', 'รหัส', 'ยอดเงิน'], mapping: { ...mapping, notes: 'B' } });
    expect(bs.body.signature).toBe(sv.body.signature);
    const all = (await sql<{ company_id: string; notes: string }>`SELECT company_id, value->'mapping'->>'notes' AS notes FROM sys_setting WHERE key = ${`imp.map.OE.${sv.body.signature}`} AND deleted_at IS NULL ORDER BY notes`.execute(database.db)).rows;
    expect(all).toEqual([{ company_id: bCo, notes: 'B' }, { company_id: co, notes: 'ตรวจปี พ.ศ.' }]);
    const bSug = (await call('POST', '/api/v1/import-map/suggest', { target: 'other-expense-docs', items: [{ row: 2, text: 'ค่าแท็กซี่ไปธนาคาร', amount: '120' }], use_ai: true })).body;
    // ไม่มีแถวเหลือให้ AI = ไม่เรียก · มีแถวเหลือ = ต้องเปิด AI ของบริษัทตัวเองก่อน (กุญแจของ DEMO ใช้ไม่ได้)
    if (bSug.error) expect(bSug.error.message).toMatch(/ยังไม่ได้ตั้งค่า AI/);
    expect(calls).toBe(n0);
    const bLocal = (await call('POST', '/api/v1/import-map/suggest', { target: 'other-expense-docs', items: [{ row: 2, text: 'ค่าแท็กซี่ไปธนาคาร', amount: '120' }] })).body;
    const bCodes = new Set((await sql<{ code: string }>`SELECT code FROM md_item WHERE company_id = ${bCo}`.execute(database.db)).rows.map((r) => r.code));
    for (const x of bLocal.rows[0].alternatives) expect(bCodes.has(x.code)).toBe(true);
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM sys_ai_usage WHERE company_id = ${bCo}`.execute(database.db)).rows[0]!.n).toBe(0);
    cookie = '';
    await call('POST', '/api/v1/auth/login', { username: 'admin', password: 'secret123' });
    await call('POST', '/api/v1/auth/select', { company_id: co });
    expect((await call('PUT', '/api/v1/ai/config', { api_key: null, monthly_limit_usd: 20 })).body.has_key).toBe(false);
  });

  it('HANDOFF 169: per-kind templates mirror the screen; cash-sale/purchase payments (split sheet, one method, checks) posted like the screen; old credit-days column = warning', async () => {
    cookie = '';
    await call('POST', '/api/v1/auth/login', { username: 'admin', password: 'secret123' });
    const co = (await call('GET', '/api/v1/auth/me')).body.companies.find((c: { code: string }) => c.code === 'DEMO').id;
    await call('POST', '/api/v1/auth/select', { company_id: co });
    const tpl = async (path: string) => readSheets(`import-${path}.xlsx`, (await app.inject({ method: 'GET', url: `/api/v1/trade-import/${path}/template`, headers: { cookie } })).rawPayload);
    // แบบฟอร์มตามหน้าจอ: ขายสด = วิธีชำระ + แผ่นรับชำระ ไม่มีเครดิต · ขายเชื่อ = มีเครดิต ไม่มีวิธีชำระ
    const hs = await tpl('cash-sales');
    expect(hs.map((s) => s.name)).toEqual(['นำเข้า', 'รับชำระ', 'คำอธิบาย']);
    expect(hs[0]!.rows[0]).not.toContain('เครดิต (วัน)');
    expect(hs[0]!.rows[0]).toEqual(expect.arrayContaining(['เลขที่อ้างอิง', 'เลขที่เอกสาร', 'วันที่ *', 'Bill to (สาขาลูกค้า)', 'สถานที่ส่งของ', 'พนักงานขาย', 'วิธีชำระ', 'เลขที่อ้างอิง/เช็ค', 'ภาษีถูกหัก ณ ที่จ่าย', 'จำนวน *', 'ของแถม (F)', 'ประเภท VAT']));
    expect(hs[1]!.rows[0]![0]).toMatch(/^วิธีเดียว: ใช้คอลัมน์ "วิธีชำระ" ในแผ่นนำเข้า · หลายวิธี .* ใส่ทั้งสองที่ = ผิด/);   // กติกาบนสุดของแผ่น (HANDOFF 170)
    expect(hs[1]!.rows[1]).toEqual(['เลขที่อ้างอิง *', 'วิธีชำระ *', 'จำนวนเงิน *', 'เลขที่อ้างอิง/เช็ค']);
    const need = (sheet: string[][], th: string) => sheet.find((r) => r[0] === th)?.[1];
    expect([need(hs[2]!.rows, 'จำนวน'), need(hs[2]!.rows, 'วิธีชำระ'), need(hs[2]!.rows, 'รหัสสินค้า'), need(hs[2]!.rows, 'คลัง')])
      .toEqual(['ต้องมี', 'ไม่บังคับ (ค่าเริ่มต้น = เงินสดทั้งจำนวน)', 'ต้องมีถ้าไม่ใส่ชื่อสินค้า', 'ไม่บังคับ (ค่าเริ่มต้น = ตามประเภทเอกสาร/คลังหลัก)']);
    const iv = await tpl('sales-invoices');
    expect(iv.map((s) => s.name)).toEqual(['นำเข้า', 'คำอธิบาย']);
    expect(iv[0]!.rows[0]).toContain('เครดิต (วัน)');
    expect(iv[0]!.rows[0]).not.toContain('วิธีชำระ');
    const oe = await tpl('other-expense-docs');
    expect(oe.map((s) => s.name)).toEqual(['นำเข้า', 'จ่ายชำระ', 'คำอธิบาย']);
    expect(oe[1]!.rows[1]).toContain('วันที่เช็ค');

    // วิธีรับ/จ่ายชำระของบริษัท: เงินสด · เงินโอน (ผูกบัญชีเงินฝาก) · โอนที่ยังไม่ผูกบัญชี · เช็ค
    const accs = (await call('GET', '/api/v1/gl/accounts')).body as Array<{ id: string; account_no: string; is_control: boolean }>;
    const cashAcc = accs.find((x) => x.account_no === '1111-00')!;
    const bank = (await sql<{ id: string; gl: string }>`SELECT id, gl_account_id AS gl FROM md_bank_account WHERE company_id = ${co} AND deleted_at IS NULL AND gl_account_id IS NOT NULL ORDER BY code LIMIT 1`.execute(database.db)).rows[0]!;
    const bankAcc = accs.find((x) => x.id === bank.gl)!;
    expect(bankAcc).toBeTruthy();
    const pm = async (dir: 'R' | 'P', b: Record<string, unknown>) => { const r = await call('POST', `/api/v1/payment-methods/${dir}`, b); expect(r.status, JSON.stringify(r.body)).toBeLessThan(300); };
    await pm('R', { code: 'Q7', name_th: 'เงินสดนำเข้า', kind: 'CASH', gl_account_id: cashAcc.id });
    await pm('R', { code: 'Q8', name_th: 'เงินโอนนำเข้า', kind: 'TRANSFER', bank_account_id: bank.id });
    // วิธีที่ยังไม่ผูกบัญชี (ข้อมูลย้ายจากระบบเดิม — หน้าตั้งค่าไม่ให้บันทึกแบบนี้)
    await sql`INSERT INTO md_payment_method (company_id, direction, code, name_th, kind) VALUES (${co}, 'R', 'Q9', 'โอนยังไม่ผูกบัญชี', 'TRANSFER')`.execute(database.db);
    await pm('R', { code: 'Q5', name_th: 'เช็คนำเข้า', kind: 'CHEQUE', creates_cheque: true, bank_account_id: bank.id });
    await pm('P', { code: 'Q6', name_th: 'โอนจ่ายนำเข้า', kind: 'TRANSFER', bank_account_id: bank.id });
    const item = (await call('GET', '/api/v1/items?status=A')).body.rows.find((r: { unit_code: string | null }) => r.unit_code) as { id: string; code: string };
    const hsType = (await call('GET', '/api/v1/trade-defaults/HS')).body.types[0].id;
    const url = '/api/v1/trade-import/cash-sales';
    const xl = (main: string[][], pay?: string[][]) => buildXlsx([{ name: 'นำเข้า', rows: main }, ...(pay ? [{ name: 'รับชำระ', rows: pay }] : [])]).toString('base64');
    const H = ['เลขที่อ้างอิง', 'วันที่', 'รหัสลูกค้า', 'รหัสสินค้า', 'จำนวน', 'ราคาต่อหน่วย', 'วิธีชำระ', 'เลขที่อ้างอิง/เช็ค', 'เครดิต (วัน)'];
    const P = ['เลขที่อ้างอิง', 'วิธีชำระ', 'จำนวนเงิน', 'เลขที่อ้างอิง/เช็ค'];
    const base = { file_name: 'ขายสด.xlsx', doc_type_id: hsType, price_type: '2', vat_rate: 7 };
    // แบ่ง 2 วิธี (เงินสด + เงินโอน) — รวม = 1,070 · คอลัมน์เครดิตของแฟ้มเดิม = เตือน ไม่ผิด
    const main = [H, ['HSX-1', '15/07/2569', 'IMP-C1', item.code, '10', '100', '', '', '30']];
    const ok = (await call('POST', url, { ...base, data: xl(main, [P, ['HSX-1', 'Q7', '470', ''], ['HSX-1', 'เงินโอนนำเข้า', '600', 'TR-1']]) })).body;
    expect(ok.errors).toEqual([]);
    expect(ok.file_warnings).toEqual(['คอลัมน์ "เครดิต (วัน)" ไม่มีในหน้าจอขายเงินสด — ไม่นำเข้าค่าในคอลัมน์นี้ (รับ/จ่ายเงินวันเดียวกัน ไม่มีเครดิต)']);
    expect(ok.docs[0]).toMatchObject({ ref: 'HSX-1', net_amount: '1070.00', payments: 1, other_amount: '600.00', cash_amount: '470.00' });
    // ยอดรวมไม่เท่า · วิธีที่ยังไม่ผูกบัญชี · เช็คไม่มีเลขที่ · วิธีชำระที่ไม่มี · ทั้งสองแผ่น
    const errs = async (m: string[][], p?: string[][]) => (await call('POST', url, { ...base, data: xl(m, p) })).body.errors.map((e: { message: string }) => e.message).join(' | ');
    // HANDOFF 172 (เจ้าของ 21/11/2569 "sheet รับชำระใส่แค่วิธีการโอนเงินเท่านั้นก็พอส่วนผลต่างให้ถือว่าเป็นเงินสด"):
    // รวม = ยอด → ตามแผ่น (ไม่มีส่วนที่เหลือ) · รวมน้อยกว่า → ส่วนที่เหลือ = เงินสด · รวมเกิน = ผิด ไม่บันทึก
    expect(ok.docs[0].cash_remainder).toBeNull();
    const lt = (await call('POST', url, { ...base, data: xl(main, [P, ['HSX-1', 'Q8', '500', 'TR-1']]) })).body;
    expect(lt.errors).toEqual([]);
    expect(lt.docs[0]).toMatchObject({ net_amount: '1070.00', payments: 1, other_amount: '500.00', cash_amount: '570.00', cash_remainder: '570.00', pay_source: 'sheet' });
    expect(lt.docs[0].cash_name).toBeTruthy();
    expect(await errs(main, [P, ['HSX-1', 'Q8', '1100', 'TR-1']])).toMatch(/ยอดรับชำระรวม 1100\.00 เกินยอดที่ต้องรับ 1070\.00 \(รวมทั้งสิ้น − ภาษีหัก ณ ที่จ่าย\) — รับเกินไม่ได้ แก้แผ่น "รับชำระ"/);
    expect(await errs([H, ['HSX-1', '15/07/2569', 'IMP-C1', item.code, '10', '100', 'Q9', '', '']])).toMatch(/วิธีรับชำระ Q9 โอนยังไม่ผูกบัญชี ยังไม่ได้ผูกบัญชีเงินฝาก\/บัญชีแยกประเภท — กำหนดที่ เริ่มระบบ › วิธีรับ\/จ่ายชำระหนี้ ก่อน/);
    expect(await errs([H, ['HSX-1', '15/07/2569', 'IMP-C1', item.code, '10', '100', 'Q5', '', '']])).toMatch(/วิธีรับชำระ Q5 เช็คนำเข้า ต้องมีเลขที่เช็ค\/เลขที่อ้างอิง — ใส่ในคอลัมน์ "เลขที่อ้างอิง\/เช็ค"/);
    expect(await errs([H, ['HSX-1', '15/07/2569', 'IMP-C1', item.code, '10', '100', 'ZZ', '', '']])).toMatch(/ไม่พบวิธีรับชำระ "ZZ"/);
    expect(await errs([H, ['HSX-1', '15/07/2569', 'IMP-C1', item.code, '10', '100', 'Q8', '', '']], [P, ['HSX-1', 'Q8', '1070', '']])).toMatch(/ใส่วิธีชำระทั้งในแผ่นนำเข้าและแผ่น "รับชำระ"/);
    expect(await errs(main, [P, ['NOPE', 'Q8', '1', '']])).toMatch(/ไม่มีเลขที่อ้างอิง NOPE ในแผ่นนำเข้า/);
    // ช่องที่ต้องมี: บอกคอลัมน์ แถว และวิธีแก้
    const miss = (await call('POST', url, { ...base, data: xl([H, ['HSX-1', '15/07/2569', 'IMP-C1', item.code, '', '100', '', '', '']]) })).body.errors;
    expect(miss).toEqual([{ row: 2, message: 'ไม่มีจำนวน (คอลัมน์ "จำนวน" ต้องมี)' }]);

    // บันทึก: บรรทัดวิธีชำระเหมือนแท็บ "รับชำระด้วยวิธีอื่น" · เงินสดคงเหลือ · ไม่มีเครดิต · ลงบัญชีเหมือนบันทึกที่หน้าจอ
    const cm = await call('POST', url, { ...base, data: xl(main, [P, ['HSX-1', 'Q7', '470', ''], ['HSX-1', 'Q8', '600', 'TR-1']]), commit: true });
    expect(cm.body.error?.message ?? 'ok').toBe('ok');
    const hid = (await sql<{ id: string; cash_amount: string; cheque_amount: string; credit_days: number | null }>`SELECT id, cash_amount, cheque_amount, credit_days FROM doc_header WHERE company_id = ${co} AND your_ref = 'HSX-1' AND doc_class = 'HS' AND doc_status <> 'C'`.execute(database.db)).rows[0]!;
    expect([hid.cash_amount, hid.cheque_amount, hid.credit_days ?? 0]).toEqual(['470.00', '600.00', 0]);
    const tab = await call('GET', `/api/v1/cash-sales/${hid.id}`);
    expect(tab.body.payments.map((p: { method_code: string; amount: string; reference_no: string | null }) => [p.method_code, p.amount, p.reference_no])).toEqual([['Q8', '600.00', 'TR-1']]);
    const q8 = (await sql<{ id: string }>`SELECT id FROM md_payment_method WHERE company_id = ${co} AND direction = 'R' AND code = 'Q8' AND deleted_at IS NULL`.execute(database.db)).rows[0]!.id;
    const screen = await call('POST', '/api/v1/cash-sales', { doc_type_id: hsType, doc_date: '2026-07-15', party_id: (await call('GET', '/api/v1/customers?q=IMP-C1')).body.rows[0].id, your_ref: 'HSX-SCREEN', price_type: '2', vat_rate: 7,
      lines: [{ item_id: item.id, qty: 10, unit_price: 100 }], payments: [{ payment_method_id: q8, amount: '600', reference_no: 'TR-1' }] });
    expect(screen.status).toBe(200);
    const gl = async (ref: string) => (await sql<{ a: string; dr: string; cr: string }>`SELECT g.account_no AS a, sum(l.debit)::text AS dr, sum(l.credit)::text AS cr FROM gl_journal_line l JOIN gl_journal j ON j.id = l.journal_id
        JOIN doc_header h ON h.id = j.source_header_id JOIN gl_account g ON g.id = l.account_id WHERE h.company_id = ${co} AND h.your_ref = ${ref} AND j.doc_status = 'N' AND l.deleted_at IS NULL GROUP BY g.account_no ORDER BY g.account_no`.execute(database.db)).rows;
    const imported = await gl('HSX-1');
    expect(imported).toEqual(await gl('HSX-SCREEN'));
    expect(imported.find((x) => x.a === bankAcc.account_no)?.dr).toBe('600.00');   // เงินโอน → บัญชีของบัญชีเงินฝากที่ผูกกับวิธีชำระ (เงินสดคงเหลือ → บัญชีเงินสดตามประเภทเอกสาร)

    // ซื้อเงินสด: วิธีเดียวในแผ่นหลัก + หัก ณ ที่จ่าย 3% → ยอดโอน = รวม − ภาษีหัก
    const hpType = (await call('GET', '/api/v1/trade-defaults/HP')).body.types[0].id;
    const hp = csv([['เลขที่อ้างอิง', 'วันที่', 'รหัสผู้จำหน่าย', 'รหัสสินค้า', 'จำนวน', 'ราคาต่อหน่วย', 'วิธีชำระ', 'เลขที่อ้างอิง/เช็ค', 'อัตราหัก ณ ที่จ่าย'],
      ['HPX-1', '15/07/2569', 'IMP-S1', item.code, '10', '100', 'Q6', 'PAY-1', '3']]);
    const hc = await call('POST', '/api/v1/trade-import/cash-purchases', { file_name: 'ซื้อสด.csv', data: hp, doc_type_id: hpType, price_type: '2', vat_rate: 7, commit: true });
    expect(hc.body.error?.message ?? 'ok').toBe('ok');
    // HANDOFF 172 + หัก ณ ที่จ่าย: ยอดที่ต้องจ่าย = 1,070 − 30 = 1,040 · แผ่นจ่ายชำระโอน 1,000 → เงินสด 40 · โอน 1,050 = เกิน
    await pm('P', { code: 'Q4', name_th: 'เงินสดจ่ายนำเข้า', kind: 'CASH', gl_account_id: cashAcc.id });
    const HW = ['เลขที่อ้างอิง', 'วันที่', 'รหัสผู้จำหน่าย', 'รหัสสินค้า', 'จำนวน', 'ราคาต่อหน่วย', 'อัตราหัก ณ ที่จ่าย'];
    const hpx = (amt: string) => buildXlsx([{ name: 'นำเข้า', rows: [HW, ['HPX-2', '15/07/2569', 'IMP-S1', item.code, '10', '100', '3']] }, { name: 'จ่ายชำระ', rows: [P, ['HPX-2', 'Q6', amt, 'PAY-2']] }]).toString('base64');
    const hw = (await call('POST', '/api/v1/trade-import/cash-purchases', { file_name: 'ซื้อสด.xlsx', data: hpx('1000'), doc_type_id: hpType, price_type: '2', vat_rate: 7 })).body;
    expect(hw.errors).toEqual([]);
    expect(hw.docs[0]).toMatchObject({ net_amount: '1070.00', wht_amount: '30.00', other_amount: '1000.00', cash_amount: '40.00', cash_remainder: '40.00' });
    const hwx = (await call('POST', '/api/v1/trade-import/cash-purchases', { file_name: 'ซื้อสด.xlsx', data: hpx('1050'), doc_type_id: hpType, price_type: '2', vat_rate: 7, commit: true }));
    expect([hwx.status, hwx.body.error.message]).toEqual([400, expect.stringMatching(/ยอดจ่ายชำระรวม 1050\.00 เกินยอดที่ต้องจ่าย 1040\.00/)]);
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM doc_header WHERE company_id = ${co} AND your_ref = 'HPX-2' AND deleted_at IS NULL`.execute(database.db)).rows[0]!.n).toBe(0);
    const hph = (await sql<{ id: string; cash_amount: string; cheque_amount: string; wht_amount: string }>`SELECT id, cash_amount, cheque_amount, wht_amount FROM doc_header WHERE company_id = ${co} AND your_ref = 'HPX-1' AND doc_class = 'HP' AND doc_status <> 'C'`.execute(database.db)).rows[0]!;
    expect([hph.wht_amount, hph.cheque_amount, hph.cash_amount]).toEqual(['30.00', '1040.00', '0.00']);   // 1,070 − 30
    expect((await sql<{ rate: string; tax_amount: string }>`SELECT rate::text AS rate, tax_amount FROM tax_wht_entry WHERE header_id = ${hph.id} AND deleted_at IS NULL`.execute(database.db)).rows.map((r) => [Number(r.rate), r.tax_amount])).toEqual([[3, '30.00']]);
    // ขายสดแฟ้มเดิม (CSV แบบฟอร์มรุ่นก่อน มีคอลัมน์เครดิต) ยังนำเข้าได้: เตือน ไม่ใช้ค่าเครดิต · เงินสดทั้งหมด
    const old = csv([['เลขที่อ้างอิง', 'วันที่', 'รหัสลูกค้า', 'รหัสสินค้า', 'จำนวน', 'หน่วย', 'ราคาต่อหน่วย', 'ส่วนลด', 'เครดิต (วัน)'], ['HSX-OLD', '16/07/2569', 'IMP-C1', item.code, '1', '', '50', '', '15']]);
    const oc = (await call('POST', url, { ...base, file_name: 'old.csv', data: old, commit: true })).body;
    expect(oc.error?.message ?? 'ok').toBe('ok');
    expect(oc.file_warnings).toHaveLength(1);
    expect((await sql<{ c: number | null; cash: string }>`SELECT credit_days AS c, cash_amount AS cash FROM doc_header WHERE company_id = ${co} AND your_ref = 'HSX-OLD' AND doc_status <> 'C'`.execute(database.db)).rows[0]).toMatchObject({ cash: '53.50' });
  });
  it('HANDOFF 170: own document numbers (file order, never reused by automatic numbering), VAT type from a VAT-amount column, totals cross-check, payment source; the receipt-export fixture end to end', async () => {
    cookie = '';
    await call('POST', '/api/v1/auth/login', { username: 'admin', password: 'secret123' });
    const co = (await call('GET', '/api/v1/auth/me')).body.companies.find((c: { code: string }) => c.code === 'DEMO').id;
    await call('POST', '/api/v1/auth/select', { company_id: co });
    const types = (await call('GET', '/api/v1/trade-defaults/HS')).body.types as Array<{ id: string; code: string }>;
    const hsType = types[0]!.id, P = types[0]!.code;
    const url = '/api/v1/trade-import/cash-sales';
    const base = { file_name: 'ขายสด.xlsx', doc_type_id: hsType, price_type: '2', vat_rate: 7, create_masters: true };
    const xl = (main: string[][], pay?: string[][]) => buildXlsx([{ name: 'นำเข้า', rows: main }, ...(pay ? [{ name: 'รับชำระ', rows: pay }] : [])]).toString('base64');
    const item = (await call('GET', '/api/v1/items?status=A')).body.rows.find((r: { unit_code: string | null }) => r.unit_code) as { id: string; code: string };
    const nextNo = async () => Number((await sql<{ n: string }>`SELECT next_no::text AS n FROM md_doc_type WHERE id = ${hsType}`.execute(database.db)).rows[0]!.n);
    const fmtNo = (n: number) => `${P}${String(n).padStart(7, '0')}`;

    // ก. เลขที่เอกสารเอง = เลขอัตโนมัติถัดไป (ฉบับอัตโนมัติอยู่ก่อนในแฟ้ม) → ไม่ชน: ฉบับที่กำหนดเลขบันทึกก่อน เลขอัตโนมัติข้ามไป
    const n0 = await nextNo();
    const H = ['เลขที่อ้างอิง', 'เลขที่เอกสาร', 'วันที่', 'รหัสลูกค้า', 'รหัสสินค้า', 'จำนวน', 'ราคาต่อหน่วย', 'วิธีชำระ'];
    const own = [H, ['DN-A', '', '15/07/2569', 'IMP-C1', item.code, '1', '100', ''], ['DN-B', fmtNo(n0), '15/07/2569', 'IMP-C1', item.code, '1', '200', ''], ['DN-C', `${P}-IMP-7`, '15/07/2569', 'IMP-C1', item.code, '1', '300', '']];
    const ck = (await call('POST', url, { ...base, data: xl(own) })).body;
    expect(ck.errors).toEqual([]);
    expect(ck.docs.map((x: { ref: string; doc_no: string | null; doc_no_source: string; pay_source: string }) => [x.ref, x.doc_no, x.doc_no_source, x.pay_source]))
      .toEqual([['DN-A', null, 'auto', 'cash'], ['DN-B', fmtNo(n0), 'file', 'cash'], ['DN-C', `${P}-IMP-7`, 'file', 'cash']]);
    const cm = (await call('POST', url, { ...base, data: xl(own), commit: true })).body;
    expect(cm.error?.message ?? 'ok').toBe('ok');
    expect(cm.docs.map((x: { ref: string; doc_no: string }) => [x.ref, x.doc_no])).toEqual([['DN-A', fmtNo(n0 + 1)], ['DN-B', fmtNo(n0)], ['DN-C', `${P}-IMP-7`]]);
    // หน้าจอบันทึกต่อ: ได้เลขถัดไป ไม่ชนเลขในแฟ้ม
    const sc = await call('POST', '/api/v1/cash-sales', { doc_type_id: hsType, doc_date: '2026-07-15', party_id: (await call('GET', '/api/v1/customers?q=IMP-C1')).body.rows[0].id, price_type: '2', vat_rate: 7, lines: [{ item_id: item.id, qty: 1, unit_price: 10 }] });
    expect(sc.status).toBe(200);
    expect(sc.body.doc_no).toBe(fmtNo(n0 + 2));
    // ซ้ำของเดิม · ซ้ำในแฟ้ม · ไม่ขึ้นต้นด้วยตัวนำหน้า (มีเลขที่อ้างอิงแยก = ผิด) · ใบยกเลิกยังจองเลข
    const errs = async (m: string[][]) => (await call('POST', url, { ...base, data: xl(m) })).body.errors.map((e: { row: number; message: string }) => `${e.row}: ${e.message}`);
    expect(await errs([H, ['DN-D', fmtNo(n0), '15/07/2569', 'IMP-C1', item.code, '1', '1', ''], ['DN-E', 'XX-1', '15/07/2569', 'IMP-C1', item.code, '1', '1', ''], ['DN-F', `${P}-IMP-8`, '15/07/2569', 'IMP-C1', item.code, '1', '1', ''], ['DN-G', `${P}-IMP-8`, '15/07/2569', 'IMP-C1', item.code, '1', '1', '']]))
      .toEqual([`2: เลขที่เอกสาร ${fmtNo(n0)} มีอยู่แล้ว (ลงวันที่ 15/07/2569) — เปลี่ยนเลขที่ หรือเว้นว่างให้ระบบออกเลข`,
        `3: เลขที่เอกสาร XX-1 ต้องขึ้นต้นด้วย ${P} ตามประเภทเอกสารที่เลือก (เช่น ${P}-1) — แก้ในคอลัมน์ "เลขที่เอกสาร" หรือเว้นว่างให้ระบบออกเลข`,
        `5: เลขที่เอกสาร ${P}-IMP-8 ซ้ำกับเลขที่อ้างอิง DN-F (แถว 4) — หนึ่งเลขที่ใช้ได้เอกสารเดียว`]);
    const cid = (await sql<{ id: string }>`SELECT id FROM doc_header WHERE company_id = ${co} AND doc_no = ${`${P}-IMP-7`} AND deleted_at IS NULL`.execute(database.db)).rows[0]!.id;
    expect((await call('POST', `/api/v1/cash-sales/${cid}/cancel`, { reason: 'ทดสอบ' })).status).toBe(200);
    expect((await errs([H, ['DN-H', `${P}-IMP-7`, '15/07/2569', 'IMP-C1', item.code, '1', '1', '']]))[0]).toMatch(/มีอยู่แล้ว .*ยกเลิกแล้ว — ลบเอกสารนั้นก่อนจึงใช้เลขนี้ได้/);

    // ข. แฟ้มส่งออกใบเสร็จจากโปรแกรมอื่น (รูปแบบเดียวกับแฟ้มจริงของเจ้าของ — ข้อมูลสมมุติ): ตรงแบบฟอร์มพอให้อ่านได้เลย
    // ลูกค้าในแฟ้มมีแต่ชื่อ: บริษัทนี้ (ข้อทดสอบก่อนหน้า) ตั้งไม่ให้เลขผู้เสียภาษีว่าง — เปิดให้ว่างได้ระหว่างข้อนี้ · รหัสสินค้าตามรูปแบบรหัสของบริษัท 99-!!!!-!!!!!!
    expect((await call('PUT', '/api/v1/settings', { values: { 'gen.allow_blank_party_tax_id': true } })).status).toBe(200);
    const R = [['ใบเสร็จรับเงิน', 'สถานะ', 'วันที่', 'ชื่อลูกค้า', 'ชื่อโปรเจกต์', 'รหัสสินค้า', 'สินค้า', 'รายละเอียด', 'จำนวน', 'ราคาต่อหน่วย (ไม่รวมภาษี)', 'ส่วนลด (ไม่รวมภาษี)', 'ราคารวม (ไม่รวมภาษี)', 'ภาษี VAT', 'ราคาสุทธิ'],
      ['RE-261001001', 'รับเงินแล้ว', '46296', 'ลูกค้าสมมุติ หนึ่ง', 'คอร์สตัวอย่าง', '10-CRSE-000001', 'ค่าคอร์สเรียน', 'รุ่นที่ 1', '1', '5854.2056074766', '0', '5854.2056074766', '409.79439252336', '6264'],
      ['RE-261001001', 'รับเงินแล้ว', '46296', 'ลูกค้าสมมุติ หนึ่ง', 'คอร์สตัวอย่าง', '10-MEMB-000001', 'ค่าสมาชิก', 'รายปี', '1', '350', '0', '350', '', '350'],
      ['RE-261001002', 'รับเงินแล้ว', '46297', 'ลูกค้าสมมุติ สอง', 'คอร์สตัวอย่าง', '10-CRSE-000001', 'ค่าคอร์สเรียน', 'รุ่นที่ 1', '2', '5854.2056074766', '0', '11708.4112149532', '819.588785046724', '12528'],
      ['RE-261001003', 'รับเงินแล้ว', '46297', 'ลูกค้าสมมุติ หนึ่ง', '', '10-MEMB-000001', 'ค่าสมาชิก', '', '1', '350', '0', '350', '', '350']];
    const an = (await call('POST', '/api/v1/import-map/analyze', { target: 'cash-sales', file_name: 'receipts.xlsx', data: xl(R) })).body;
    expect(an.matches).toBe(true);
    // การจับคู่แบบ AI (คำตอบจำลอง — ไม่เรียก AI จริง) ให้ผลเดียวกับอ่านตรง
    const aiMap = { header_row: 0, date_order: 'dmy', year: 'auto', decimal: 'dot', group: 'column', skip_words: [], notes: '',
      columns: [['doc_no', 0], ['date', 2], ['party_name', 3], ['item', 5], ['item_name', 6], ['description', 7], ['qty', 8], ['price', 9], ['vat_amount', 12], ['net_total', 13]].map(([t, i]) => ({ target: t, source: i, constant: '' })) };
    const fb = { ...base, file_name: 'receipts.xlsx', data: xl(R) };
    const direct = (await call('POST', url, fb)).body, mapped = (await call('POST', url, { ...fb, mapping: aiMap })).body;
    for (const r of [direct, mapped]) {
      expect(r.errors).toEqual([]);
      expect(r.file_warnings).toEqual([`เลขที่เอกสารในแฟ้ม 3 ฉบับ (เช่น RE-261001001) ไม่ขึ้นต้นด้วย ${P} ตามประเภทเอกสาร — เก็บเป็นเลขที่อ้างอิง (ค้นหาด้วยเลขเดิมได้) และออกเลขที่เอกสารอัตโนมัติ · ต้องการใช้เลขเอง: ใส่เลขที่ขึ้นต้นด้วย ${P}`]);
      expect(r.docs.map((x: Record<string, unknown>) => [x.ref, x.doc_no_source, x.party_new, x.lines, x.vat_lines, x.amount, x.vat_amount, x.net_amount, x.file_vat, x.file_net, x.check, x.warnings, x.pay_source])).toEqual([
        ['RE-261001001', 'auto', true, 2, { 0: 1, 1: 1, 2: 0 }, '6204.21', '409.79', '6614.00', '409.79', '6614.00', 'ok', [], 'cash'],
        ['RE-261001002', 'auto', true, 1, { 0: 0, 1: 1, 2: 0 }, '11708.41', '819.59', '12528.00', '819.59', '12528.00', 'ok', [], 'cash'],
        ['RE-261001003', 'auto', true, 1, { 0: 1, 1: 0, 2: 0 }, '350.00', '0.00', '350.00', '0.00', '350.00', 'ok', [], 'cash'],
      ]);
      expect(r.new_masters.parties.map((p: { name: string }) => p.name)).toEqual(['ลูกค้าสมมุติ หนึ่ง', 'ลูกค้าสมมุติ สอง']);
      expect(r.new_masters.items.map((i: { code: string; name: string }) => `${i.code} ${i.name}`)).toEqual(['10-CRSE-000001 ค่าคอร์สเรียน', '10-MEMB-000001 ค่าสมาชิก']);
    }
    // ทุกใบ: รวมทั้งสิ้น = ราคาสุทธิในแฟ้มรวมกัน (6,264 + 350 · 12,528 · 350)
    expect(direct.total_net).toBe('19492.00');
    // ประเภทราคาผิด (รวม VAT) → เตือน พร้อมบอกประเภทราคาที่ทำให้ตรง (ไม่ผิด บันทึกได้)
    const wrong = (await call('POST', url, { ...fb, price_type: '1' })).body;
    expect(wrong.ok).toBe(true);
    expect(wrong.docs[0].check).toBe('diff');
    expect(wrong.docs[0].warnings).toEqual(['ภาษี VAT ตามแฟ้ม 409.79 · โปรแกรมคำนวณ 382.99 (ต่าง 26.80)', 'ราคาสุทธิตามแฟ้ม 6,614.00 · โปรแกรมคำนวณรวมทั้งสิ้น 6,204.21 (ต่าง 409.79)',
      'ถ้าเลือก "ประเภทราคาในแฟ้ม" เป็น 2 แยกภาษี (ราคาก่อน VAT) ยอดจะตรงกับแฟ้ม — เปลี่ยนแล้วตรวจแฟ้มอีกครั้ง']);
    // บันทึก: ลูกค้าใหม่จากชื่อ · บรรทัดยกเว้น VAT เป็น 0 (ไม่ใช่ VAT ตามค่าเริ่มต้นของสินค้าใหม่) · ยอดเท่าแฟ้ม · เลขที่ใบเสร็จเดิมเป็นเลขที่อ้างอิง
    const done = (await call('POST', url, { ...fb, commit: true })).body;
    expect(done.error?.message ?? 'ok').toBe('ok');
    const saved = (await sql<{ ref: string; doc_no: string; net: string; vat: string; codes: string }>`SELECT h.your_ref AS ref, h.doc_no, h.net_amount AS net, h.vat_amount AS vat,
        string_agg(i.code || ':' || l.vat_code || ':' || l.unit_price::text || ':' || l.line_amount::text, ' ' ORDER BY l.line_no) AS codes
        FROM doc_header h JOIN doc_line l ON l.header_id = h.id AND l.deleted_at IS NULL JOIN md_item i ON i.id = l.item_id
        WHERE h.company_id = ${co} AND h.your_ref LIKE 'RE-26100100%' AND h.doc_status <> 'C' GROUP BY h.your_ref, h.doc_no, h.net_amount, h.vat_amount ORDER BY h.your_ref`.execute(database.db)).rows;
    expect(saved.map((x) => [x.ref, x.net, x.vat, x.codes])).toEqual([
      ['RE-261001001', '6614.00', '409.79', '10-CRSE-000001:1:5854.2056:5854.21 10-MEMB-000001:0:350.0000:350.00'],
      ['RE-261001002', '12528.00', '819.59', '10-CRSE-000001:1:5854.2056:11708.41'],
      ['RE-261001003', '350.00', '0.00', '10-MEMB-000001:0:350.0000:350.00'],
    ]);
    expect(saved.every((x) => x.doc_no.startsWith(P))).toBe(true);
    // นำเข้าซ้ำ = แจ้งว่าเคยนำเข้าแล้ว
    expect((await call('POST', url, fb)).body.errors[0].message).toMatch(/เลขที่อ้างอิง RE-261001001 เคยนำเข้าแล้วเป็น/);

    // ค. ที่มาของการรับชำระ: วิธีเดียว (แผ่นนำเข้า) · แผ่นรับชำระ · ไม่ใส่ = เงินสดทั้งหมด · แผ่นที่มีบรรทัดกติกาด้านบนยังอ่านได้
    const tpl = readSheets('import-HS.xlsx', (await app.inject({ method: 'GET', url: '/api/v1/trade-import/cash-sales/template', headers: { cookie } })).rawPayload);
    expect(tpl[0]!.rows[3]![1]).toBe(`${P}-EX-001`);                                    // ตัวอย่างแถว 4 = เลขที่เอกสารเอง
    expect(tpl[2]!.rows.some((r) => r[0] === 'ภาษี VAT')).toBe(true);                   // คอลัมน์ตรวจยอดอธิบายในแผ่นคำอธิบาย
    expect(tpl[0]!.rows[0]).not.toContain('ภาษี VAT');
    const pm = (await sql<{ code: string }>`SELECT code FROM md_payment_method WHERE company_id = ${co} AND direction = 'R' AND code = 'Q8' AND deleted_at IS NULL`.execute(database.db)).rows[0];
    expect(pm?.code).toBe('Q8');   // จากข้อ HANDOFF 169
    const PH = ['เลขที่อ้างอิง', 'วันที่', 'รหัสลูกค้า', 'รหัสสินค้า', 'จำนวน', 'ราคาต่อหน่วย', 'วิธีชำระ', 'เลขที่อ้างอิง/เช็ค'];
    const src = (await call('POST', url, { ...base, data: xl([PH, ['PS-1', '15/07/2569', 'IMP-C1', item.code, '1', '100', 'Q8', 'T1'], ['PS-2', '15/07/2569', 'IMP-C1', item.code, '1', '100', '', ''], ['PS-3', '15/07/2569', 'IMP-C1', item.code, '1', '100', '', '']],
      [[tpl[1]!.rows[0]![0]!], ['เลขที่อ้างอิง', 'วิธีชำระ', 'จำนวนเงิน', 'เลขที่อ้างอิง/เช็ค'], ['PS-2', 'Q8', '7', 'T2'], ['PS-2', 'Q7', '100', '']]) })).body;
    expect(src.errors).toEqual([]);
    expect(src.docs.map((x: { ref: string; pay_source: string; other_amount: string }) => [x.ref, x.pay_source, x.other_amount])).toEqual([['PS-1', 'main', '107.00'], ['PS-2', 'sheet', '7.00'], ['PS-3', 'cash', '0.00']]);

    // ช. (G) แถวต่อมาของบิลเดียวกันเว้นวันที่/ลูกค้าได้ · (H) สินค้าใหม่ไม่มีรหัส (บริการ + สินค้า) ภายใต้รูปแบบรหัส 99-!!!!-!!!!!! ได้รหัสเสมอ — แฟ้มแบบตัวอย่าง 4 ของเจ้าของ
    const G = ['เลขที่อ้างอิง *', 'วันที่ *', 'รหัสลูกค้า', 'ชื่อลูกค้า', 'รหัสสินค้า', 'ชื่อสินค้า', 'ชนิดสินค้า', 'หน่วย', 'จำนวน *', 'ราคาต่อหน่วย', 'ประเภท VAT'];
    const unitCode = (await sql<{ code: string }>`SELECT u.code FROM md_unit u WHERE u.company_id = ${co} AND u.deleted_at IS NULL ORDER BY u.code LIMIT 1`.execute(database.db)).rows[0]!.code;
    const g = (await call('POST', url, { ...base, data: xl([G,
      ['ทดลอง-HS-101', '20/11/2569', 'IMP-C1', '', item.code, '', '', '', '1', '100', '1'],
      ['ทดลอง-HS-101', '', '', '', '', 'หนังสือทดลองนำเข้า', 'สินค้า', unitCode, '2', '50', '1'],
      ['ทดลอง-HS-101', '', '', '', '', 'ค่าอบรม (ยกเว้น VAT)', 'บริการ', '', '1', '500', '0'],
      ['ทดลอง-HS-101', '', '', '', '', 'ค่าอบรม (ยกเว้น VAT)', 'บริการ', '', '1', '300', '0']]) })).body;
    expect(g.errors).toEqual([]);
    expect(g.docs.map((x: { ref: string; lines: number; party_code: string }) => [x.ref, x.lines, x.party_code])).toEqual([['ทดลอง-HS-101', 4, 'IMP-C1']]);
    const newItems = g.new_masters.items as Array<{ code: string; name: string; kind: string }>;
    expect(newItems.map((i) => [i.name, i.kind])).toEqual([['หนังสือทดลองนำเข้า', '0'], ['ค่าอบรม (ยกเว้น VAT)', '3']]);
    for (const i of newItems) expect(i.code, i.code).toMatch(/^\d\d-[A-Z0-9]{4}-[A-Z0-9]{1,6}$/);   // ตรงรูปแบบ 99-!!!!-!!!!!!
    expect(newItems[1]!.code).toMatch(/^99-SERV-\d{6}$|^\d\d-[A-Z0-9]{4}-/);
    expect((await call('PUT', '/api/v1/settings', { values: { 'gen.allow_blank_party_tax_id': false } })).status).toBe(200);
  });
  it('HANDOFF 171: Excel import for quotations / sales orders / purchase orders — template per screen, delivery date, check saves nothing, commit all-or-nothing, not posted, activity log', async () => {
    cookie = '';
    await call('POST', '/api/v1/auth/login', { username: 'admin', password: 'secret123' });
    const co = (await call('GET', '/api/v1/auth/me')).body.companies.find((c: { code: string }) => c.code === 'DEMO').id;
    await call('POST', '/api/v1/auth/select', { company_id: co });
    const tpl = async (path: string) => readSheets(`import-${path}.xlsx`, (await app.inject({ method: 'GET', url: `/api/v1/trade-import/${path}/template`, headers: { cookie } })).rawPayload);
    // แบบฟอร์มตามหน้าจอ: ใบสั่งขาย = วันที่ส่งของ · ใบสั่งซื้อ = วันที่รับของ · ใบเสนอราคาไม่มี · ไม่มีวิธีชำระ/แผ่นรับชำระ/หัก ณ ที่จ่าย
    const so = await tpl('sales-orders'), po = await tpl('purchase-orders'), qt = await tpl('quotations');
    expect([so.map((x) => x.name), po.map((x) => x.name), qt.map((x) => x.name)]).toEqual([['นำเข้า', 'คำอธิบาย'], ['นำเข้า', 'คำอธิบาย'], ['นำเข้า', 'คำอธิบาย']]);
    expect([so[0]!.rows[0]!.includes('วันที่ส่งของ'), po[0]!.rows[0]!.includes('วันที่รับของ'), qt[0]!.rows[0]!.some((h) => /วันที่ส่ง|วันที่รับ/.test(h))]).toEqual([true, true, false]);
    for (const t of [so, po, qt]) expect(t[0]!.rows[0]!.some((h) => /วิธีชำระ|หัก ณ ที่จ่าย/.test(h))).toBe(false);
    expect(so[0]!.rows[0]).toEqual(expect.arrayContaining(['วันที่ *', 'รหัสลูกค้า', 'รหัสสินค้า', 'จำนวน *']));
    expect(JSON.stringify(so[1]!.rows)).toContain('ใบสั่งขายไม่ลงบัญชี ไม่ตัดสต๊อก');
    const types = (await call('GET', '/api/v1/trade-defaults/SO')).body.types as Array<{ id: string }>;
    const url = '/api/v1/trade-import/sales-orders';
    const item = (await call('GET', '/api/v1/items?status=A')).body.rows.find((r: { unit_code: string | null; item_type?: string }) => r.unit_code) as { code: string };
    const H = ['เลขที่อ้างอิง *', 'วันที่ *', 'รหัสลูกค้า', 'วันที่ส่งของ', 'รหัสสินค้า', 'จำนวน *', 'ราคาต่อหน่วย'];
    const file = buildXlsx([{ name: 'นำเข้า', rows: [H, ['CPO-9001', '18/11/2569', 'IMP-C1', '30/11/2569', item.code, '5', '100'], ['CPO-9001', '', '', '', item.code, '2', '50'], ['CPO-9002', '19/11/2569', 'IMP-C1', '', item.code, '1', '10']] }]).toString('base64');
    const base = { file_name: 'ใบสั่งซื้อลูกค้า.xlsx', data: file, doc_type_id: types[0]!.id, price_type: '2', vat_rate: 7 };
    const count = async () => Number((await sql<{ n: string }>`SELECT count(*)::text AS n FROM doc_header WHERE company_id = ${co} AND doc_class = 'SO' AND your_ref LIKE 'CPO-90%' AND deleted_at IS NULL`.execute(database.db)).rows[0]!.n);
    // ตรวจ: ไม่บันทึก · บิลแรก 2 บรรทัด (แถวต่อมาเว้นหัวเอกสาร)
    const ck = (await call('POST', url, base)).body;
    expect(ck.errors).toEqual([]);
    expect(ck.docs.map((x: { ref: string; lines: number; amount: string }) => [x.ref, x.lines, x.amount])).toEqual([['CPO-9001', 2, '600.00'], ['CPO-9002', 1, '10.00']]);
    expect(await count()).toBe(0);
    // วันที่ส่งของผิด = ผิดทั้งแฟ้ม ไม่บันทึกฉบับใดเลย
    const badFile = buildXlsx([{ name: 'นำเข้า', rows: [H, ['CPO-9001', '18/11/2569', 'IMP-C1', '31/02/2569', item.code, '5', '100'], ['CPO-9002', '19/11/2569', 'IMP-C1', '', item.code, '1', '10']] }]).toString('base64');
    expect((await call('POST', url, { ...base, data: badFile, commit: true })).status).toBe(400);
    const bad = (await call('POST', url, { ...base, data: badFile })).body;
    expect(bad.errors.map((e: { message: string }) => e.message).join(' ')).toMatch(/วันที่ส่งของ "31\/02\/2569" ไม่ถูกต้อง/);
    expect(await count()).toBe(0);
    // บันทึก: saveTrade เดียวกับหน้าจอ — วันที่ส่งของตามแฟ้ม (ว่าง = วันที่เอกสาร) · ไม่ลงบัญชี · บันทึก sys_activity_log
    const cm = (await call('POST', url, { ...base, commit: true })).body;
    expect([cm.errors, cm.committed, cm.docs.length]).toEqual([[], true, 2]);
    const rows = (await sql<{ your_ref: string; delivery_date: string; gl: number; module: string }>`SELECT h.your_ref, h.delivery_date::text AS delivery_date, h.module,
        (SELECT count(*)::int FROM gl_journal j WHERE j.source_header_id = h.id AND j.deleted_at IS NULL) AS gl
      FROM doc_header h WHERE h.company_id = ${co} AND h.doc_class = 'SO' AND h.your_ref LIKE 'CPO-90%' AND h.deleted_at IS NULL ORDER BY h.your_ref`.execute(database.db)).rows;
    expect(rows).toEqual([{ your_ref: 'CPO-9001', delivery_date: '2026-11-30', module: 'SO', gl: 0 }, { your_ref: 'CPO-9002', delivery_date: '2026-11-19', module: 'SO', gl: 0 }]);
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM sys_activity_log WHERE company_id = ${co} AND action = 'IMPORT' AND occurred_at > now() - interval '5 minutes' AND detail->>'file' = 'ใบสั่งซื้อลูกค้า.xlsx'`.execute(database.db)).rows[0]!.n).toBeGreaterThan(0);
    // นำเข้าซ้ำ = เลขที่อ้างอิงเคยนำเข้าแล้ว
    expect((await call('POST', url, base)).body.errors[0].message).toMatch(/เคยนำเข้าแล้ว/);
    // บริษัทอื่นนำเข้าด้วยประเภทเอกสารของบริษัทนี้ไม่ได้ (company_id จาก session)
    const other = (await call('GET', '/api/v1/auth/me')).body.companies.find((c: { id: string }) => c.id !== co);
    if (other) {
      await call('POST', '/api/v1/auth/select', { company_id: other.id });
      expect((await call('POST', url, base)).status).toBe(400);
      await call('POST', '/api/v1/auth/select', { company_id: co });
    }
    const ids = (await sql<{ id: string }>`SELECT id FROM doc_header WHERE company_id = ${co} AND doc_class = 'SO' AND your_ref LIKE 'CPO-90%' AND deleted_at IS NULL`.execute(database.db)).rows;
    for (const x of ids) expect((await call('POST', `/api/v1/sales-orders/${x.id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);

    // มัดจำรับ (AI) · มัดจำจ่าย (AE) · รายได้อื่น (OI): แบบฟอร์มตามหน้าจอ · บรรทัดข้อความ · บันทึกด้วย saveCash เดียวกับหน้าจอ (ลงบัญชี)
    const ai = await tpl('ar-deposits'), ae = await tpl('ap-deposits'), oi = await tpl('other-income-docs');
    expect([ai.map((x) => x.name), ae.map((x) => x.name), oi.map((x) => x.name)]).toEqual([['นำเข้า', 'รับชำระ', 'คำอธิบาย'], ['นำเข้า', 'จ่ายชำระ', 'คำอธิบาย'], ['นำเข้า', 'รับชำระ', 'คำอธิบาย']]);
    expect(ai[0]!.rows[0]).toEqual(expect.arrayContaining(['รหัสลูกค้า', 'รายละเอียด *', 'จำนวนเงิน *']));
    expect(ai[0]!.rows[0]!.some((h) => /รหัสค่าใช้จ่าย|ใบกำกับผู้จำหน่าย/.test(h))).toBe(false);
    expect(ae[0]!.rows[0]).toEqual(expect.arrayContaining(['รหัสผู้จำหน่าย', 'อัตราหัก ณ ที่จ่าย', 'รายละเอียด *']));
    expect(oi[0]!.rows[0]).toEqual(expect.arrayContaining(['รหัสรายได้ *', 'รหัสลูกค้า']));
    const aiType = ((await call('GET', '/api/v1/trade-defaults/AI')).body.types as Array<{ id: string }>)[0]!.id;
    const DH = ['เลขที่อ้างอิง *', 'วันที่ *', 'รหัสลูกค้า', 'รายละเอียด *', 'จำนวนเงิน *'];
    const dep = buildXlsx([{ name: 'นำเข้า', rows: [DH, ['DEP-9001', '20/11/2569', 'IMP-C1', 'มัดจำค่าสินค้าตามใบสั่งซื้อ', '1000'], ['DEP-9001', '', '', 'มัดจำค่าติดตั้ง', '500'], ['DEP-9002', '20/11/2569', '', 'ไม่มีลูกค้า', '100']] }]).toString('base64');
    const dbase = { file_name: 'มัดจำ.xlsx', data: dep, doc_type_id: aiType, price_type: '0', vat_rate: 0 };
    const dk = (await call('POST', '/api/v1/trade-import/ar-deposits', dbase)).body;
    // มัดจำต้องมีลูกค้า (หน้าจอบังคับ)
    expect(dk.errors.map((e: { row: number; message: string }) => e.row)).toEqual([4]);
    const dep2 = buildXlsx([{ name: 'นำเข้า', rows: [DH, ['DEP-9001', '20/11/2569', 'IMP-C1', 'มัดจำค่าสินค้าตามใบสั่งซื้อ', '1000'], ['DEP-9001', '', '', 'มัดจำค่าติดตั้ง', '500']] }]).toString('base64');
    const dc = (await call('POST', '/api/v1/trade-import/ar-deposits', { ...dbase, data: dep2 })).body;
    expect([dc.errors, dc.docs.map((x: { ref: string; lines: number; net_amount: string; pay_source: string }) => [x.ref, x.lines, x.net_amount, x.pay_source])]).toEqual([[], [['DEP-9001', 2, '1500.00', 'cash']]]);
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM doc_header WHERE company_id = ${co} AND doc_class = 'AI' AND your_ref = 'DEP-9001' AND deleted_at IS NULL`.execute(database.db)).rows[0]!.n).toBe(0);
    const dm = (await call('POST', '/api/v1/trade-import/ar-deposits', { ...dbase, data: dep2, commit: true })).body;
    expect([dm.errors, dm.committed]).toEqual([[], true]);
    const dh = (await sql<{ id: string; net_amount: string; posted: number; lines: string }>`SELECT h.id, h.net_amount::text AS net_amount,
        (SELECT count(*)::int FROM gl_journal j WHERE j.source_header_id = h.id AND j.deleted_at IS NULL AND j.doc_status <> 'C') AS posted,
        (SELECT string_agg(l.description, ' / ' ORDER BY l.line_no) FROM doc_line l WHERE l.header_id = h.id AND l.deleted_at IS NULL) AS lines
      FROM doc_header h WHERE h.company_id = ${co} AND h.doc_class = 'AI' AND h.your_ref = 'DEP-9001' AND h.deleted_at IS NULL`.execute(database.db)).rows;
    expect(dh.map((x) => [x.net_amount, x.posted, x.lines])).toEqual([['1500.00', 1, 'มัดจำค่าสินค้าตามใบสั่งซื้อ / มัดจำค่าติดตั้ง']]);
    expect((await call('POST', `/api/v1/ar-deposits/${dh[0]!.id}/cancel`, { reason: 'ล้างข้อมูลทดสอบ' })).status).toBe(200);
    // รายได้อื่น: รหัสที่ไม่ใช่รหัสรายได้ = ผิด บอกเมนูที่ต้องเพิ่ม
    const oiType = ((await call('GET', '/api/v1/trade-defaults/OI')).body.types as Array<{ id: string }>)[0]!.id;
    const oiFile = buildXlsx([{ name: 'นำเข้า', rows: [['เลขที่อ้างอิง *', 'วันที่ *', 'ชื่อลูกค้า', 'รหัสรายได้ *', 'จำนวนเงิน *'], ['OI-9001', '20/11/2569', 'ผู้เช่าทดสอบ', item.code, '300']] }]).toString('base64');
    const oe = (await call('POST', '/api/v1/trade-import/other-income-docs', { file_name: 'รายได้.xlsx', data: oiFile, doc_type_id: oiType, price_type: '0', vat_rate: 0 })).body;
    expect(oe.errors[0].message).toMatch(new RegExp(`${item.code} ไม่ใช่รหัสรายได้อื่น — ใช้รหัสจาก ขาย › รายละเอียดรายได้อื่น ๆ`));
  });
  it('journal import (เจ้าของ 17/11/2569): template, check without saving, all-or-nothing commit via createJournal, line description default, duplicate ref, rights, other tenants', async () => {
    cookie = '';
    expect((await call('POST', '/api/v1/auth/login', { username: 'admin', password: 'secret123' })).status).toBe(200);
    const co = (await call('GET', '/api/v1/auth/me')).body.companies.find((c: { code: string }) => c.code === 'DEMO').id;
    await call('POST', '/api/v1/auth/select', { company_id: co });
    const accs = (await call('GET', '/api/v1/gl/accounts')).body as Array<{ id: string; account_no: string; is_control: boolean }>;
    const exp = accs.find((a) => a.account_no === '5380-06')!.account_no, cashNo = accs.find((a) => a.account_no === '1111-00')!.account_no;
    const bk = (await call('GET', '/api/v1/gl/books')).body.find((b: { code: string }) => b.code === '00') as { id: string; code: string; prefix: string };
    const B = bk.prefix?.trim() || bk.code;
    const url = '/api/v1/gl/journal-import';
    const H = ['สมุด', 'เลขที่กลุ่ม', 'วันที่', 'อ้างอิง', 'คำอธิบาย', 'เลขที่บัญชี', 'คำอธิบายรายการ', 'แผนก', 'Job', 'เดบิต', 'เครดิต'];
    const ours = async () => (await sql<{ n: number }>`SELECT count(*)::int AS n FROM gl_journal WHERE company_id = ${co} AND reference LIKE 'IMPJ-%' AND doc_status <> 'C'`.execute(database.db)).rows[0]!.n;
    // แฟ้มตัวอย่าง .xlsx อ่านกลับได้ หัวตรงตามที่นำเข้า
    const t = await app.inject({ method: 'GET', url: '/api/v1/gl/journal-import/template', headers: { cookie } });
    expect(t.statusCode).toBe(200); expect(t.headers['content-type']).toMatch(/spreadsheetml/);
    const tplRows = readTable('import-journal.xlsx', t.rawPayload);
    // ช่องต้องใส่มี * (เจ้าของ 18/11/2569) — ตัวอ่านไม่สนใจ *
    expect(tplRows[0]!.slice(0, 12)).toEqual(['สมุด *', 'เลขที่กลุ่ม *', 'เลขที่ใบสำคัญ', 'วันที่ *', 'อ้างอิง', 'คำอธิบาย', 'เลขที่บัญชี *', 'คำอธิบายรายการ', 'แผนก', 'Job', 'เดบิต *', 'เครดิต *']);
    const tplXml = (readZip(t.rawPayload).get('xl/styles.xml') ?? Buffer.from('')).toString('utf8');
    expect(tplXml).toMatch(/formatCode="#,##0.00"/);   // ช่องเงินเป็นตัวเลข #,##0.00
    const helpXml = (readZip(t.rawPayload).get('xl/worksheets/sheet2.xml') ?? Buffer.from('')).toString('utf8');
    expect(helpXml).toMatch(/ต้องใส่ \/ ว่างได้/); expect(helpXml).toMatch(/รูปแบบช่องใน Excel/); expect(helpXml).toMatch(/ใส่เมื่อมีภาษี/);
    expect(tplRows[0]!.slice(12)).toEqual(['ภาษี', 'เลขที่ใบกำกับ', 'วันที่ใบกำกับ', 'งวดภาษี', 'ชื่อคู่ค้า', 'เลขผู้เสียภาษี', 'สาขาคู่ค้า', 'ฐานภาษี', 'อัตราภาษี', 'ประเภทเงินได้']);
    expect(tplRows.some((r) => r[12] === 'ภาษีซื้อ' && r[18] === '00000')).toBe(true);   // สาขาเก็บเป็นข้อความ (ไม่หายเลข 0)
    expect(tplRows.filter((r) => /0000001$/.test(r[2] ?? '')).length).toBeGreaterThan(0);   // ตัวอย่างกำหนดเลขที่ใบสำคัญเอง 1 กลุ่ม
    // แบบฟอร์มตัวอย่างตรวจผ่านทั้งแฟ้ม (ลบแถวหัวคอลัมน์ไม่ได้ ใช้ทั้งแผ่น)
    const tplChk = (await call('POST', url, { file_name: 'import-journal.xlsx', data: t.rawPayload.toString('base64') })).body;
    expect(tplChk.errors).toEqual([]);
    expect(tplChk.vouchers.filter((v: { voucher_no: string | null }) => v.voucher_no).length).toBe(1);
    const good = csv([H,
      [B, '1', '20/07/2569', 'IMPJ-1', 'นำเข้าทดสอบ', exp, 'ค่าใช้จ่ายนำเข้า', '', '', '"1,150.50"', ''],
      [B, '1', '20/07/2569', '', '', cashNo, '', '', '', '', '1150.50'],
      [B, '2', '21/07/2569', 'IMPJ-2', 'ใบที่สอง', exp, '', '', '', '20', ''],
      [B, '2', '21/07/2569', '', '', cashNo, '', '', '', '', '20']]);
    // ตรวจ: ไม่บันทึก
    const chk = (await call('POST', url, { file_name: 'สมุด.csv', data: good })).body;
    expect(chk).toMatchObject({ ok: true, committed: false, total_debit: '1170.50', total_credit: '1170.50', total_diff: '0.00', import_count: 2, dup_count: 0 });
    expect(chk.vouchers.map((v: { status: string; debit: string; credit: string; diff: string }) => [v.status, v.debit, v.credit, v.diff])).toEqual([['ok', '1150.50', '1150.50', '0.00'], ['ok', '20.00', '20.00', '0.00']]);
    expect(chk.vouchers.map((v: { voucher_no: string | null }) => v.voucher_no)).toEqual([null, null]);
    expect(await ours()).toBe(0);
    // ผิด: ไม่ดุล + ไม่พบบัญชี → บันทึกไม่ได้ทั้งแฟ้ม
    const bad = csv([H, [B, '1', '20/07/2569', 'IMPJ-9', 'x', exp, '', '', '', '10', ''], [B, '1', '20/07/2569', '', '', '9999-99', '', '', '', '', '9'], ['ZZ', '2', '20/07/2569', '', '', exp, '', '', '', '1', ''], ['ZZ', '2', '20/07/2569', '', '', cashNo, '', '', '', '', '1']]);
    const be = (await call('POST', url, { file_name: 'x.csv', data: bad })).body.errors.map((e: { message: string }) => e.message).join(' | ');
    expect(be).toMatch(/ยอดไม่ดุล/); expect(be).toMatch(/ไม่พบสมุดรายวัน "ZZ"/);
    const bchk = (await call('POST', url, { file_name: 'x.csv', data: bad })).body;
    expect([bchk.total_debit, bchk.total_credit, bchk.total_diff, bchk.import_count]).toEqual(['11.00', '10.00', '1.00', 0]);   // เดบิต/เครดิต/ผลต่างทั้งแฟ้ม
    expect(bchk.vouchers.map((v: { status: string; diff: string }) => [v.status, v.diff])).toEqual([['error', '1.00'], ['error', '0.00']]);
    expect((await call('POST', url, { file_name: 'x.csv', data: bad, commit: true })).status).toBe(400);
    expect(await ours()).toBe(0);
    // บันทึก: ออกเลขที่ใบสำคัญให้ · คำอธิบายรายการว่าง = คำอธิบายของใบ · บันทึกประวัติ
    const done = (await call('POST', url, { file_name: 'สมุด.csv', data: good, commit: true })).body;
    expect(done.ok).toBe(true);
    expect(done.vouchers.every((v: { voucher_no: string }) => !!v.voucher_no)).toBe(true);
    expect(await ours()).toBe(2);
    const j1 = (await call('GET', `/api/v1/gl/journals?q=IMPJ-1&from=2026-07-01&to=2026-07-31`)).body.rows[0];
    const jv = (await call('GET', `/api/v1/gl/journals/${j1.id}`)).body as { description: string; reference: string; journal_book_id: string; lines: Array<{ description: string; debit: string; credit: string }> };
    expect([jv.reference, jv.journal_book_id, jv.description]).toEqual(['IMPJ-1', bk.id, 'นำเข้าทดสอบ']);
    expect(jv.lines.map((l) => [l.description, l.debit, l.credit])).toEqual([['ค่าใช้จ่ายนำเข้า', '1150.50', '0.00'], ['นำเข้าทดสอบ', '0.00', '1150.50']]);
    const log = (await call('GET', '/api/v1/activity-log')).body as Array<{ action: string; module: string }>;
    expect(log.some((x) => x.action === 'IMPORT' && x.module === 'GL')).toBe(true);
    // นำเข้าซ้ำ (เจ้าของ 18/11/2569): อ้างอิงเดิมในสมุดเดิม = ใบซ้ำ ไม่นำเข้าเอง — เปรียบเทียบ + เลือก ทับ/สร้างใหม่/ไม่นำเข้า (ค่าเริ่มต้น ไม่นำเข้า)
    type Dup = { key: string; status: string; action: string; voucher_no: string | null; match: { by: string; voucher_no: string; can_overwrite: boolean; why_not: string | null; diffs: string[]; current: { lines: unknown[] } } };
    const again = (await call('POST', url, { file_name: 'สมุด.csv', data: good })).body as { ok: boolean; import_count: number; dup_count: number; vouchers: Dup[] };
    expect([again.ok, again.import_count, again.dup_count]).toEqual([true, 0, 2]);
    expect(again.vouchers.map((v) => [v.status, v.action, v.match.by, v.match.can_overwrite, v.match.diffs])).toEqual([['dup', 'skip', 'ref', true, []], ['dup', 'skip', 'ref', true, []]]);   // เหมือนกันทุกช่อง
    expect(again.vouchers[0]!.match.current.lines).toHaveLength(2);
    const skipAll = (await call('POST', url, { file_name: 'สมุด.csv', data: good, commit: true })).body as { import_count: number; vouchers: Dup[] };
    expect([skipAll.import_count, ...skipAll.vouchers.map((v) => v.status)]).toEqual([0, 'skipped', 'skipped']);
    expect(await ours()).toBe(2);
    // แก้ยอดในแฟ้ม → ต่างกัน · ทับเอกสารเดิม = แก้ใบเดิม (เลขที่เดิม · log EDIT) · สร้างเป็นเอกสารใหม่ = ใบใหม่เลขใหม่
    const changed = csv([H,
      [B, '1', '20/07/2569', 'IMPJ-1', 'นำเข้าทดสอบ (แก้)', exp, 'ค่าใช้จ่ายนำเข้า', '', '', '1200', ''],
      [B, '1', '20/07/2569', '', '', cashNo, '', '', '', '', '1200'],
      [B, '2', '21/07/2569', 'IMPJ-2', 'ใบที่สอง', exp, '', '', '', '20', ''],
      [B, '2', '21/07/2569', '', '', cashNo, '', '', '', '', '20']]);
    const k1 = again.vouchers[0]!.key, k2 = again.vouchers[1]!.key;
    const cmp = (await call('POST', url, { file_name: 'สมุด.csv', data: changed, actions: { [k1]: 'overwrite', [k2]: 'new' } })).body as { ok: boolean; import_count: number; vouchers: Dup[] };
    expect(cmp.vouchers[0]!.match.diffs).toEqual(['คำอธิบาย', 'ยอดเงิน', 'บรรทัด 1', 'บรรทัด 2']);
    expect([cmp.ok, cmp.import_count, cmp.vouchers[0]!.voucher_no, cmp.vouchers[1]!.voucher_no]).toEqual([true, 2, j1.voucher_no, null]);
    expect((await call('POST', url, { file_name: 'สมุด.csv', data: changed, actions: { [k1]: 'bogus' } })).status).toBe(400);   // เลือกได้ 3 แบบเท่านั้น
    const over = (await call('POST', url, { file_name: 'สมุด.csv', data: changed, commit: true, actions: { [k1]: 'overwrite', [k2]: 'new' } })).body as { vouchers: Dup[] };
    expect(over.vouchers.map((v) => v.status)).toEqual(['overwritten', 'created']);
    expect(over.vouchers[0]!.voucher_no).toBe(j1.voucher_no);
    const jv2 = (await call('GET', `/api/v1/gl/journals/${j1.id}`)).body as { description: string; total_debit: string };
    expect([jv2.description, jv2.total_debit]).toEqual(['นำเข้าทดสอบ (แก้)', '1200.00']);
    expect(((await call('GET', '/api/v1/activity-log')).body as Array<{ action: string; doc_no: string }>).some((x) => x.action === 'EDIT' && x.doc_no === j1.voucher_no)).toBe(true);
    expect(await ours()).toBe(3);   // IMPJ-1 (ทับ) · IMPJ-2 สองใบ (เดิม + สร้างใหม่)
    // ภาษี (เจ้าของเลือก ก 18/11/2569): แถวบัญชีภาษี → แฟ้มภาษีซื้อ / ภ.ง.ด.53 ผูกใบสำคัญ
    const roleNo = async (r: string) => (await sql<{ n: string }>`SELECT g.account_no AS n FROM gl_default_account x JOIN gl_account g ON g.id = x.account_id WHERE x.company_id = ${co} AND x.role = ${r} AND x.deleted_at IS NULL`.execute(database.db)).rows[0]?.n ?? exp;
    const [ivat, whtp] = [await roleNo('INPUT_VAT'), await roleNo('WHT_PAYABLE')];
    const HT = [...H, 'ภาษี', 'เลขที่ใบกำกับ', 'วันที่ใบกำกับ', 'ชื่อคู่ค้า', 'เลขผู้เสียภาษี', 'สาขาคู่ค้า', 'ฐานภาษี', 'อัตราภาษี'];
    const taxFile = csv([HT,
      [B, 'T', '22/07/2569', 'IMPJ-3', 'ซื้อวัสดุ หักภาษี', exp, '', '', '', '1000', '', '', '', '', '', '', '', '', ''],
      [B, 'T', '22/07/2569', '', '', ivat, '', '', '', '70', '', 'ภาษีซื้อ', 'IMPJ-IV1', '21/07/2569', 'บริษัท ผู้ขาย จำกัด', '0105550123451', 'สำนักงานใหญ่', '', ''],
      [B, 'T', '22/07/2569', '', '', whtp, '', '', '', '', '30', 'ภงด53', '', '', 'บริษัท ผู้ขาย จำกัด', '0105550123451', '', '1000', '3'],
      [B, 'T', '22/07/2569', '', '', cashNo, '', '', '', '', '1040', '', '', '', '', '', '', '', '']]);
    const badTax = csv([HT, [B, 'X', '22/07/2569', 'IMPJ-4', 'x', ivat, '', '', '', '', '7', 'ภาษีซื้อ', 'IV', '', '', '', '', '', ''], [B, 'X', '22/07/2569', '', '', cashNo, '', '', '', '7', '', '', '', '', '', '', '', '', '']]);
    expect((await call('POST', url, { file_name: 't.csv', data: badTax })).body.errors[0].message).toMatch(/ภาษีซื้อต้องอยู่ด้านเดบิต/);
    const tchk = (await call('POST', url, { file_name: 't.csv', data: taxFile })).body;
    expect(tchk).toMatchObject({ ok: true, committed: false });
    expect(tchk.vouchers[0].taxes).toBe(2);
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM tax_vat_entry WHERE company_id = ${co} AND tax_invoice_no = 'IMPJ-IV1'`.execute(database.db)).rows[0]!.n).toBe(0);   // ตรวจ = ไม่บันทึกภาษี
    const tdone = (await call('POST', url, { file_name: 't.csv', data: taxFile, commit: true })).body;
    expect(tdone.ok).toBe(true);
    const tj = (await call('GET', `/api/v1/gl/journals?q=IMPJ-3&from=2026-07-01&to=2026-07-31`)).body.rows[0] as { id: string };
    const vat = (await call('GET', `/api/v1/vat/P?journal_id=${tj.id}`)).body.rows as Array<Record<string, unknown>>;
    expect(vat.map((v) => [v.tax_invoice_no, String(v.tax_invoice_date).slice(0, 10), v.month, v.party_name, v.party_tax_id, v.party_tax_branch_no, v.base_amount, v.vat_amount]))
      .toEqual([['IMPJ-IV1', '2026-07-21', '2026-07', 'บริษัท ผู้ขาย จำกัด', '0105550123451', '00000', '1000.00', '70.00']]);
    const wht = (await call('GET', `/api/v1/wht?journal_id=${tj.id}`)).body.rows as Array<Record<string, unknown>>;
    expect(wht.map((w) => [w.form_type, w.payee_name, w.income_type, w.paid_amount, w.rate, w.tax_amount])).toEqual([['S53', 'บริษัท ผู้ขาย จำกัด', 'ค่าบริการ', '1000.00', '3.0000', '30.00']]);
    // ทับใบที่มีภาษี: แฟ้มมีคอลัมน์ภาษี → รายการภาษีเดิมยกเลิก (C) แล้วเพิ่มตามแฟ้ม
    const taxFile2 = csv([HT,
      [B, 'T', '22/07/2569', 'IMPJ-3', 'ซื้อวัสดุ หักภาษี', exp, '', '', '', '1000', '', '', '', '', '', '', '', '', ''],
      [B, 'T', '22/07/2569', '', '', ivat, '', '', '', '70', '', 'ภาษีซื้อ', 'IMPJ-IV2', '21/07/2569', 'บริษัท ผู้ขาย จำกัด', '0105550123451', 'สำนักงานใหญ่', '', ''],
      [B, 'T', '22/07/2569', '', '', whtp, '', '', '', '', '30', 'ภงด53', '', '', 'บริษัท ผู้ขาย จำกัด', '0105550123451', '', '1000', '3'],
      [B, 'T', '22/07/2569', '', '', cashNo, '', '', '', '', '1040', '', '', '', '', '', '', '', '']]);
    const tk = ((await call('POST', url, { file_name: 't.csv', data: taxFile2 })).body.vouchers as Dup[])[0]!;
    expect([tk.status, tk.match.diffs]).toEqual(['dup', ['ภาษี']]);
    expect((await call('POST', url, { file_name: 't.csv', data: taxFile2, commit: true, actions: { [tk.key]: 'overwrite' } })).body.vouchers[0].status).toBe('overwritten');
    expect((await sql<{ no: string; s: string }>`SELECT tax_invoice_no AS no, doc_status AS s FROM tax_vat_entry WHERE company_id = ${co} AND journal_id = ${tj.id} ORDER BY tax_invoice_no`.execute(database.db)).rows.map((r) => [r.no, r.s]))
      .toEqual([['IMPJ-IV1', 'C'], ['IMPJ-IV2', 'N']]);
    expect((await sql<{ s: string }>`SELECT string_agg(doc_status, '' ORDER BY doc_status) AS s FROM tax_wht_entry WHERE journal_id = ${tj.id}`.execute(database.db)).rows[0]!.s).toBe('CN');
    // เลขที่ใบสำคัญกำหนดเอง (เจ้าของ 18/11/2569): ขึ้นต้นตามสมุด · ห้ามซ้ำ · ใบยกเลิกจองเลข ลบแล้วคืนเลข · เลขอัตโนมัติไม่ชนเลขที่นำเข้า
    const HV = [...H.slice(0, 2), 'เลขที่ใบสำคัญ', ...H.slice(2)];
    const V = (g: string, no: string, ref: string, acc: string, dr: string, cr: string) => [B, g, no, '23/07/2569', ref, ref ? 'เลขที่กำหนดเอง' : '', acc, '', '', '', dr, cr];
    const pair = (g: string, no: string, ref: string) => [V(g, no, ref, exp, '10', ''), V(g, '', '', cashNo, '', '10')];
    const auto1 = (await call('POST', url, { file_name: 'v.csv', data: csv([HV, ...pair('A', '', 'IMPJ-5')]), commit: true })).body;
    const n1 = auto1.vouchers[0].voucher_no as string;   // เลขอัตโนมัติของวันที่ 23/07/2569
    const bump = (s: string) => s.replace(/(\d+)$/, (m) => String(Number(m) + 1).padStart(m.length, '0'));
    const vmsg = async (rows: string[][]) => ((await call('POST', url, { file_name: 'v.csv', data: csv([HV, ...rows]) })).body.errors as Array<{ message: string }>).map((e) => e.message).join(' | ');
    expect(await vmsg(pair('W', 'ZZ0001', 'IMPJ-6'))).toMatch(new RegExp(`ZZ0001 ต้องขึ้นต้นด้วย ${B.toUpperCase()}`));
    expect(await vmsg(pair('W', B.toUpperCase(), 'IMPJ-6'))).toMatch(/ต้องขึ้นต้นด้วย/);   // ตัวนำหน้าอย่างเดียว ไม่มีเลข
    const vchk = async (rows: string[][], actions?: Record<string, string>) => (await call('POST', url, { file_name: 'v.csv', data: csv([HV, ...rows]), actions })).body as { ok: boolean; errors: Array<{ message: string }>; vouchers: Dup[] };
    const taken = (await vchk(pair('W', n1, 'IMPJ-6'))).vouchers[0]!;   // เลขที่มีอยู่แล้ว = ใบซ้ำ (ตามเลขที่) ไม่ใช่ข้อผิดพลาด
    expect([taken.status, taken.match.by, taken.match.voucher_no, taken.match.can_overwrite]).toEqual(['dup', 'voucher_no', n1, true]);
    expect((await vchk(pair('W', n1, 'IMPJ-6'), { [taken.key]: 'new' })).vouchers[0]!.voucher_no).toBe(null);   // สร้างใหม่ = ระบบออกเลขใหม่
    expect(await vmsg([...pair('W', `${B}X1`, 'IMPJ-6'), ...pair('Y', `${B}X1`, 'IMPJ-7')])).toMatch(/ซ้ำกับ .* ในแฟ้มเดียวกัน/);
    expect(await vmsg([V('W', `${B}X1`, 'IMPJ-6', exp, '10', ''), V('W', `${B}X2`, '', cashNo, '', '10')])).toMatch(/ไม่ตรงกับแถว 2/);
    // เลขที่ใส่เองตรงกับเลขที่ระบบจะออกถัดไป + กลุ่มที่ให้ระบบออกเลข (อยู่ก่อนในแฟ้ม) → ใบที่กำหนดเลขบันทึกก่อน เลขอัตโนมัติต่อจากนั้น ไม่ชน
    const n2 = bump(n1);
    const mix = csv([HV, ...pair('B', '', 'IMPJ-6'), ...pair('M', n2.toLowerCase(), 'IMPJ-7')]);
    const mchk = (await call('POST', url, { file_name: 'v.csv', data: mix })).body;
    expect(mchk.errors).toEqual([]);
    expect(mchk.vouchers.map((v: { group: string; voucher_no: string | null }) => [v.group, v.voucher_no])).toEqual([['B', null], ['M', n2]]);   // ตรวจ: แสดงเลขที่กำหนดเอง เรียงตามแถว
    const mdone = (await call('POST', url, { file_name: 'v.csv', data: mix, commit: true })).body;
    expect(mdone.vouchers.map((v: { group: string; voucher_no: string }) => [v.group, v.voucher_no])).toEqual([['B', bump(n2)], ['M', n2]]);
    // ใบที่ยกเลิกแล้วยังจองเลข — ลบแล้วใช้เลขเดิมได้
    const a1 = (await call('GET', `/api/v1/gl/journals?q=IMPJ-5&from=2026-07-01&to=2026-07-31`)).body.rows[0] as { id: string };
    await call('POST', `/api/v1/gl/journals/${a1.id}/cancel`, { reason: 'ทดสอบเลขที่' });
    const cx = (await vchk(pair('R', n1, 'IMPJ-8'))).vouchers[0]!;
    expect([cx.status, cx.match.can_overwrite]).toEqual(['dup', false]);
    expect(cx.match.why_not).toMatch(/ยกเลิกแล้ว — ลบใบนั้น/);
    expect((await vchk(pair('R', n1, 'IMPJ-8'), { [cx.key]: 'overwrite' })).errors[0]!.message).toMatch(/ทับเอกสารเดิมไม่ได้ — .*ยกเลิกแล้ว/);   // ระบบตรวจซ้ำ ไม่เชื่อหน้าจอ
    expect((await call('POST', `/api/v1/docs/journal/${a1.id}/delete`, { reason: 'ทดสอบเลขที่' })).status).toBe(200);
    const reuse = (await call('POST', url, { file_name: 'v.csv', data: csv([HV, ...pair('R', n1, 'IMPJ-8')]), commit: true })).body;
    expect(reuse.vouchers[0].voucher_no).toBe(n1);
    // ผู้ใช้ที่ไม่มีสิทธิ์เพิ่มใบสำคัญ นำเข้าไม่ได้
    cookie = '';
    expect((await call('POST', '/api/v1/auth/login', { username: 'imp.clerk', password: 'clerkImp123' })).status).toBe(200);
    await call('POST', '/api/v1/auth/select', { company_id: co });
    expect((await call('POST', url, { file_name: 'x.csv', data: good })).status).toBe(403);
    // ลูกค้าอื่น: แฟ้มเดียวกันตรวจกับผังบัญชี/สมุดของบริษัทตัวเอง — อ้างอิง IMPJ-1 ของบริษัทนี้ไม่นับเป็นนำเข้าซ้ำ (ค้นเฉพาะบริษัทที่เลือก) · ไม่เห็นใบสำคัญของบริษัทนี้ · ไม่บันทึกอะไรในบริษัทนี้
    cookie = '';
    expect((await call('POST', '/api/v1/auth/login', { username: 'b.admin', password: 'passB1234' })).status).toBe(200);
    await call('POST', '/api/v1/auth/select', { company_id: (await call('GET', '/api/v1/auth/me')).body.companies[0].id });
    const other = (await call('POST', url, { file_name: 'x.csv', data: changed, actions: { [k1]: 'overwrite' } })).body as { vouchers: Array<{ match: unknown; status: string }> };
    expect(other.vouchers.every((v) => v.match === null && v.status !== 'dup')).toBe(true);   // ไม่เห็นใบของบริษัทอื่นเป็นใบซ้ำ · การเลือก "ทับ" ไม่มีผล
    await call('POST', url, { file_name: 'x.csv', data: changed, commit: true, actions: { [k1]: 'overwrite', [k2]: 'overwrite' } });
    expect((await sql<{ d: string }>`SELECT description AS d FROM gl_journal WHERE id = ${j1.id}`.execute(database.db)).rows[0]!.d).toBe('นำเข้าทดสอบ (แก้)');   // ใบของบริษัทนี้ไม่ถูกแก้
    expect((await call('GET', `/api/v1/gl/journals/${j1.id}`)).status).toBe(404);
    expect(await ours()).toBe(7);   // IMPJ-1 (ทับ), IMPJ-2 ×2, IMPJ-3 (มีภาษี), IMPJ-6/7 (เลขกำหนดเอง), IMPJ-8 (ใช้เลขที่ลบแล้ว) — ลูกค้าอื่นไม่ได้เพิ่ม
    // ไม่ให้กระทบยอดของทดสอบข้ออื่น
    cookie = '';
    expect((await call('POST', '/api/v1/auth/login', { username: 'admin', password: 'secret123' })).status).toBe(200);
    await call('POST', '/api/v1/auth/select', { company_id: co });
    for (const r of (await call('GET', `/api/v1/gl/journals?q=IMPJ-&from=2026-07-01&to=2026-07-31`)).body.rows as Array<{ id: string }>) await call('POST', `/api/v1/gl/journals/${r.id}/cancel`, { reason: 'ทดสอบนำเข้า' });
    expect(await ours()).toBe(0);
    // ยกเลิกใบสำคัญ = ยกเลิกรายการภาษีที่นำเข้าด้วย
    expect((await sql<{ s: string }>`SELECT string_agg(doc_status, '') AS s FROM tax_vat_entry WHERE company_id = ${co} AND tax_invoice_no = 'IMPJ-IV1'`.execute(database.db)).rows[0]!.s).toBe('C');
    expect((await sql<{ s: string }>`SELECT string_agg(doc_status, '') AS s FROM tax_wht_entry WHERE journal_id = ${tj.id}`.execute(database.db)).rows[0]!.s).toBe('CC');
  });
  it('Bill to = a branch of the same customer (เจ้าของ 18/11/2569 รอบ 2): customer branches + ship-to per branch, tax invoice uses the branch, quantity required on keyed lines, other companies', async () => {
    cookie = '';
    expect((await call('POST', '/api/v1/auth/login', { username: 'admin', password: 'secret123' })).status).toBe(200);
    const co = (await call('GET', '/api/v1/auth/me')).body.companies.find((c: { code: string }) => c.code === 'DEMO').id;
    await call('POST', '/api/v1/auth/select', { company_id: co });
    const item = (await sql<{ id: string }>`SELECT id FROM md_item WHERE company_id = ${co} AND item_type = '0' AND base_unit_id IS NOT NULL AND deleted_at IS NULL AND status = 'A' ORDER BY code LIMIT 1`.execute(database.db)).rows[0]!.id;
    const cus = { code: 'CBR1', name: 'ลูกค้ามีสาขา จำกัด', tax_id: tid(77), address_1: '9 ถนนสีลม', zip_code: '10500',
      branches: [{ branch_no: '00001', name: 'สาขาเชียงใหม่', address_1: '1 ถนนช้างคลาน', zip_code: '50100' }],
      ship_tos: [{ code: 'S1', address_1: 'คลังเชียงใหม่', branch_no: '00001' }, { code: 'S0', address_1: 'คลังกรุงเทพ', branch_no: '00000' }, { code: 'SA', address_1: 'ใช้ได้ทุกสาขา' }] };
    expect((await call('POST', '/api/v1/customers', { ...cus, branches: [{ branch_no: '00000', name: 'ซ้ำ' }] })).body.error.message).toMatch(/คือที่อยู่ในแฟ้มลูกค้านี้อยู่แล้ว/);
    expect((await call('POST', '/api/v1/customers', { ...cus, ship_tos: [{ code: 'S9', branch_no: '00009' }] })).body.error.message).toMatch(/ไม่มีสาขา 00009/);
    const cid = (await call('POST', '/api/v1/customers', cus)).body.id as string;
    const det = (await call('GET', `/api/v1/customers/${cid}`)).body as { branches: Array<{ branch_no: string; name: string }>; ship_tos: Array<{ id: string; code: string; branch_no: string | null }> };
    expect(det.branches.map((b) => [b.branch_no, b.name])).toEqual([['00001', 'สาขาเชียงใหม่']]);
    const st = Object.fromEntries(det.ship_tos.map((s) => [s.code, s]));
    expect([st.S1!.branch_no, st.S0!.branch_no, st.SA!.branch_no]).toEqual(['00001', '00000', null]);
    const ivType = (await call('GET', '/api/v1/trade-defaults/IV')).body.types[0].id as string;
    const iv = { doc_type_id: ivType, doc_date: '2026-07-24', party_id: cid, party_tax_branch_no: '00001', ship_to_id: st.S1!.id, price_type: '2', vat_rate: 7, lines: [{ item_id: item, qty: 1, unit_price: 100 }] };
    // ทุกบรรทัดที่คีย์ต้องมีจำนวน
    expect((await call('POST', '/api/v1/sales-invoices', { ...iv, lines: [{ item_id: item, qty: 0, unit_price: 100 }] })).body.error.message).toMatch(/^บรรทัดที่ 1 \(.+\): ยังไม่ได้ใส่จำนวน/);
    // สถานที่ส่งของของสาขาอื่น ไม่รับ · ของทุกสาขา รับ
    expect((await call('POST', '/api/v1/sales-invoices/posting-preview', { ...iv, ship_to_id: st.S0!.id })).body.error.message).toMatch(/เป็นของสาขา 00000 ไม่ใช่สาขาที่ออกบิล \(00001\)/);
    expect((await call('POST', '/api/v1/sales-invoices/posting-preview', { ...iv, ship_to_id: st.SA!.id })).status).toBe(200);
    const r = await call('POST', '/api/v1/sales-invoices', iv);
    expect(r.body.error?.message ?? 'ok').toBe('ok');
    const doc = (await call('GET', `/api/v1/sales-invoices/${r.body.id}`)).body as Record<string, string | null>;
    // ใบกำกับ: ชื่อลูกค้า + ที่อยู่/เลขที่สาขาที่ออกบิล · ลูกหนี้ยังเป็นรหัสลูกค้าเดิม
    expect([doc.customer_id, doc.party_name, doc.party_address, doc.party_tax_branch_no, doc.ship_to_id, doc.bill_to_customer_id]).toEqual([cid, 'ลูกค้ามีสาขา จำกัด', '1 ถนนช้างคลาน 50100', '00001', st.S1!.id, null]);
    const vat = (await call('GET', `/api/v1/vat/S?header_id=${r.body.id}`)).body.rows as Array<{ party_name: string; party_tax_branch_no: string }>;
    expect(vat.map((v) => [v.party_name, v.party_tax_branch_no])).toEqual([['ลูกค้ามีสาขา จำกัด', '00001']]);
    // สำนักงานใหญ่ = ที่อยู่ในแฟ้มลูกค้า
    const hq = await call('POST', '/api/v1/sales-invoices/posting-preview', { ...iv, party_tax_branch_no: '00000', ship_to_id: st.S0!.id });
    expect(hq.status).toBe(200);
    // บริษัทอื่น: ไม่เห็นลูกค้า/สาขา/สถานที่ส่งของบริษัทนี้ และออกบิลถึงลูกค้ารายนี้ไม่ได้
    cookie = '';
    expect((await call('POST', '/api/v1/auth/login', { username: 'b.admin', password: 'passB1234' })).status).toBe(200);
    await call('POST', '/api/v1/auth/select', { company_id: (await call('GET', '/api/v1/auth/me')).body.companies[0].id });
    expect((await call('GET', `/api/v1/customers/${cid}`)).status).toBe(404);
    const bType = (await call('GET', '/api/v1/trade-defaults/IV')).body.types[0]?.id;
    expect((await call('POST', '/api/v1/sales-invoices/posting-preview', { ...iv, doc_type_id: bType })).status).toBe(400);
    cookie = '';
    expect((await call('POST', '/api/v1/auth/login', { username: 'admin', password: 'secret123' })).status).toBe(200);
    await call('POST', '/api/v1/auth/select', { company_id: co });
    expect((await call('POST', `/api/v1/sales-invoices/${r.body.id}/cancel`, { reason: 'ทดสอบ Bill to สาขา' })).status).toBe(200);
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

describe('สมัครใช้งานเอง (ข้อกำหนดเจ้าของ 30/10/2569)', () => {
  const form = (n: string, extra: object = {}) => ({ business_name: `ร้านทดสอบ ${n}`, contact_name: `คุณ ${n}`, contact_email: `${n}@example.com`, contact_phone: '081-234-5678', username: n, password: 'Signup-Pass99', accept_terms: true, ...extra });
  it('review mode: validation + anti-spam, staff approve/reject, login only after approval, PDPA wipe, auto/off modes', async () => {
    cookie = '';
    expect((await call('GET', '/api/v1/signup/config')).body).toEqual({ mode: 'review' });
    expect((await call('POST', '/api/v1/signup', form('su.one', { accept_terms: false }))).body.error.message).toMatch(/ยอมรับเงื่อนไข/);
    expect((await call('POST', '/api/v1/signup', form('su.one', { password: '123' }))).status).toBe(400);
    expect((await call('POST', '/api/v1/signup', form('su.one', { contact_phone: '12' }))).body.error.message).toMatch(/เบอร์โทรศัพท์/);
    expect((await call('POST', '/api/v1/signup', form('su.one', { website: 'http://spam' }))).status).toBe(400);   // ช่องดักบอท
    expect((await call('POST', '/api/v1/signup', form('admin'))).body.error.message).toMatch(/มีผู้ใช้แล้ว/);
    expect((await call('POST', '/api/v1/signup', form('su.one', { tax_id: '0105560000001' }))).body.error.message).toMatch(/เลขประจำตัวผู้เสียภาษี/);
    const s1 = await call('POST', '/api/v1/signup', form('su.one', { tax_id: tid(901) }));
    expect(s1.status).toBe(200); expect(s1.body).toMatchObject({ status: 'P', username: 'su.one' });
    expect((await call('POST', '/api/v1/signup', form('SU.ONE', { contact_email: 'x1@example.com' }))).status).toBe(409);   // รหัสซ้ำกับใบที่รออนุมัติ
    expect((await call('POST', '/api/v1/signup', form('su.other', { contact_email: 'su.one@example.com' }))).body.error.message).toMatch(/อีเมลนี้ส่งใบสมัครไว้แล้ว/);
    expect((await call('POST', '/api/v1/auth/login', { username: 'su.one', password: 'Signup-Pass99' })).status).toBe(401);   // ยังไม่อนุมัติ
    expect((await call('POST', '/api/v1/signup', form('su.two'))).status).toBe(200);
    // ผู้ใช้ของลูกค้า (ไม่ใช่เจ้าหน้าที่ผู้ให้บริการ) ดู/อนุมัติไม่ได้
    expect((await call('POST', '/api/v1/auth/login', { username: 'b.admin', password: 'passB1234' })).status).toBe(200);
    expect((await call('GET', '/api/v1/signups')).status).toBe(403);
    cookie = '';
    expect((await call('POST', '/api/v1/auth/login', { username: 'admin', password: 'secret123' })).status).toBe(200);
    const list = (await call('GET', '/api/v1/signups')).body;
    expect(list.mode).toBe('review');
    const one = list.rows.find((r: { username: string }) => r.username === 'su.one'), two = list.rows.find((r: { username: string }) => r.username === 'su.two');
    expect(one).toMatchObject({ business_name: 'ร้านทดสอบ su.one', status: 'P' }); expect(one.password_hash).toBeUndefined();
    const ap = await call('POST', `/api/v1/signups/${one.id}/approve`, { max_companies: 2 });
    expect(ap.status).toBe(200); expect(ap.body.code).toBe('SUONE');
    expect((await call('POST', `/api/v1/signups/${one.id}/approve`, {})).body.error.message).toMatch(/พิจารณาไปแล้ว/);
    const t = (await sql<{ name: string; max_companies: number; dpa_signed_on: string | null; contact_email: string }>`SELECT name, max_companies, dpa_signed_on::text, contact_email FROM sys_tenant WHERE id = ${ap.body.tenant_id}`.execute(database.db)).rows[0]!;
    expect(t).toMatchObject({ name: 'ร้านทดสอบ su.one', max_companies: 2, contact_email: 'su.one@example.com' }); expect(t.dpa_signed_on).toBeTruthy();
    expect((await sql<{ h: string | null }>`SELECT password_hash AS h FROM sys_signup WHERE id = ${one.id}`.execute(database.db)).rows[0]!.h).toBeNull();
    expect((await call('POST', `/api/v1/signups/${two.id}/reject`, { reason: '' })).status).toBe(400);
    expect((await call('POST', `/api/v1/signups/${two.id}/reject`, { reason: 'ข้อมูลติดต่อไม่ครบ' })).status).toBe(200);
    expect((await call('POST', `/api/v1/signups/${two.id}/approve`, {})).status).toBe(400);
    // ผู้สมัครที่อนุมัติแล้วเข้าระบบได้ด้วยรหัสผ่านที่ตั้งเอง เป็นผู้ดูแลของลูกค้าตัวเอง
    // HANDOFF 154: บริษัทแรกพร้อมใช้ (ชื่อกิจการ + เลขผู้เสียภาษีตามใบสมัคร · ผังบัญชีมาตรฐาน ประเภทเอกสาร ปีบัญชี กฎการลงบัญชี)
    expect(ap.body.company_code).toBe('SUONE');
    cookie = '';
    expect((await call('POST', '/api/v1/auth/login', { username: 'su.one', password: 'Signup-Pass99' })).status).toBe(200);
    const me = (await call('GET', '/api/v1/auth/me')).body;
    expect(me.user).toMatchObject({ is_admin: true, is_platform: false, tenant_id: ap.body.tenant_id });
    expect(me.companies.map((c: { code: string; name_th: string }) => `${c.code}:${c.name_th}`)).toEqual(['SUONE:ร้านทดสอบ su.one']);
    expect((await call('GET', '/api/v1/tenants')).status).toBe(403);
    expect((await call('POST', '/api/v1/auth/select', { company_id: ap.body.company_id })).status).toBe(200);
    expect((await call('GET', '/api/v1/company')).body).toMatchObject({ code: 'SUONE', tax_id: tid(901) });
    expect(((await call('GET', '/api/v1/gl/accounts')).body as unknown[]).length).toBeGreaterThan(100);
    expect((await call('GET', '/api/v1/trade-defaults/IV')).body.types.length).toBeGreaterThan(0);
    expect((await call('GET', '/api/v1/gl/periods')).status).toBe(200);
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM gl_posting_rule WHERE company_id = ${ap.body.company_id} AND deleted_at IS NULL`.execute(database.db)).rows[0]!.n).toBeGreaterThan(10);
    // ลูกค้ารายใหม่เห็น/เลือกบริษัทของลูกค้ารายอื่นไม่ได้ (CLAUDE.md 7.1)
    const otherCo = (await sql<{ id: string }>`SELECT c.id FROM sys_company c JOIN sys_tenant t ON t.id = c.tenant_id WHERE t.id <> ${ap.body.tenant_id} AND c.deleted_at IS NULL LIMIT 1`.execute(database.db)).rows[0]!.id;
    expect((await call('POST', '/api/v1/auth/select', { company_id: otherCo })).body.error?.message).toMatch(/ไม่มีสิทธิ์เข้าบริษัทนี้/);
    expect((await call('GET', '/api/v1/auth/me')).body.company.id).toBe(ap.body.company_id);
    expect((await call('POST', '/api/v1/auth/login', { username: 'su.two', password: 'Signup-Pass99' })).status).toBe(401);
    // ไม่เกิน 5 ใบต่อ IP ต่อชั่วโมง
    cookie = '';
    for (const n of ['su.c', 'su.d', 'su.e']) expect((await call('POST', '/api/v1/signup', form(n))).status).toBe(200);
    expect((await call('POST', '/api/v1/signup', form('su.f'))).body.error.message).toMatch(/บ่อยเกินไป/);
    await sql`UPDATE sys_signup SET created_at = now() - interval '2 hours'`.execute(database.db);
    // อนุมัติอัตโนมัติ → เข้าระบบได้ทันที · ปิดรับสมัคร → หน้าสมัครใช้ไม่ได้
    appCfg.signup = 'auto';
    expect((await call('POST', '/api/v1/signup', form('su.auto'))).body).toMatchObject({ status: 'A' });
    expect((await call('POST', '/api/v1/auth/login', { username: 'su.auto', password: 'Signup-Pass99' })).status).toBe(200);
    expect((await call('GET', '/api/v1/auth/me')).body.companies.map((c: { code: string }) => c.code)).toEqual(['SUAUTO']);
    cookie = '';
    appCfg.signup = 'off';
    expect((await call('GET', '/api/v1/signup/config')).body).toEqual({ mode: 'off' });
    expect((await call('POST', '/api/v1/signup', form('su.off'))).status).toBe(404);
    appCfg.signup = 'review';
    // PDPA: ใบที่ไม่อนุมัติครบ 90 วัน ล้างข้อมูลติดต่อ
    await sql`UPDATE sys_signup SET decided_at = now() - interval '100 days' WHERE id = ${two.id}`.execute(database.db);
    expect((await call('POST', '/api/v1/auth/login', { username: 'admin', password: 'secret123' })).status).toBe(200);
    expect((await call('GET', '/api/v1/signups?status=R')).body.rows.find((r: { id: string }) => r.id === two.id)).toMatchObject({ contact_email: '-', contact_name: '-', client_ip: null, reject_reason: 'ข้อมูลติดต่อไม่ครบ' });
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM sys_activity_log WHERE action IN ('SIGNUP', 'SIGNUP_REJECT')`.execute(database.db)).rows[0]!.n).toBe(7);
  });

  it('read-only viewer of another tenant\'s sample data (HANDOFF 154): staff only, reads and prints to screen, cannot write, sees only that tenant', async () => {
    cookie = '';
    expect((await call('POST', '/api/v1/auth/login', { username: 'admin', password: 'secret123' })).status).toBe(200);
    const tenants = (await call('GET', '/api/v1/tenants')).body as Array<{ id: string; code: string }>;
    const suone = tenants.find((t) => t.code === 'SUONE')!;
    const demo = (await sql<{ id: string; tenant_id: string }>`SELECT c.id, c.tenant_id FROM sys_company c WHERE c.tenant_id <> ${suone.id} AND c.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM doc_header h WHERE h.company_id = c.id AND h.doc_class = 'IV' AND h.deleted_at IS NULL) ORDER BY c.created_at LIMIT 1`.execute(database.db)).rows[0]!;
    const body = { username: 'demo.view1', display_name: 'ลูกค้าทดลอง ดูตัวอย่าง', password: 'View-Only-99' };
    expect((await call('POST', `/api/v1/tenants/${demo.tenant_id}/viewers`, { ...body, password: '123' })).status).toBe(400);
    const v = await call('POST', `/api/v1/tenants/${demo.tenant_id}/viewers`, body);
    expect([v.status, v.body.error?.message]).toEqual([200, undefined]);
    expect((await call('POST', `/api/v1/tenants/${demo.tenant_id}/viewers`, body)).body.error.message).toMatch(/มีผู้ใช้แล้ว/);
    const iv = (await sql<{ id: string }>`SELECT id FROM doc_header WHERE company_id = ${demo.id} AND doc_class = 'IV' AND deleted_at IS NULL LIMIT 1`.execute(database.db)).rows[0]!.id;
    const suCo = (await sql<{ id: string }>`SELECT id FROM sys_company WHERE tenant_id = ${suone.id} LIMIT 1`.execute(database.db)).rows[0]!.id;
    // ผู้ดูแลของลูกค้า (ไม่ใช่เจ้าหน้าที่) เพิ่มผู้ใช้ดูอย่างเดียวให้ลูกค้ารายอื่นไม่ได้
    cookie = '';
    expect((await call('POST', '/api/v1/auth/login', { username: 'su.one', password: 'Signup-Pass99' })).status).toBe(200);
    expect((await call('POST', `/api/v1/tenants/${demo.tenant_id}/viewers`, { ...body, username: 'demo.view2' })).status).toBe(403);
    expect((await call('POST', '/api/v1/auth/select', { company_id: demo.id })).body.error?.message).toMatch(/ไม่มีสิทธิ์เข้าบริษัทนี้/);
    // ผู้ใช้ดูอย่างเดียว: อ่าน/ดูตัวอย่างพิมพ์ได้ · เพิ่ม/แก้/ยกเลิกไม่ได้ · เห็นเฉพาะบริษัทของลูกค้านั้น
    cookie = '';
    expect((await call('POST', '/api/v1/auth/login', { username: 'demo.view1', password: 'View-Only-99' })).status).toBe(200);
    expect((await call('POST', '/api/v1/auth/select', { company_id: demo.id })).status).toBe(200);
    const me = (await call('GET', '/api/v1/auth/me')).body;
    expect(me.user).toMatchObject({ is_admin: false, is_platform: false, tenant_id: demo.tenant_id, check_rights: true });
    expect(me.companies.every((c: { tenant_id?: string; id: string }) => c.id !== suCo)).toBe(true);
    expect(me.perms['SA.IV']).toMatchObject({ read: true, add: false, edit: false, cancel: false, delete: false, approve: false, print: 'S' });
    expect((await call('GET', '/api/v1/sales-invoices?limit=5')).status).toBe(200);
    expect((await call('GET', `/api/v1/sales-invoices/${iv}`)).status).toBe(200);
    expect((await call('GET', `/api/v1/print/doc/${iv}`)).status).toBe(200);
    const doc = (await call('GET', `/api/v1/sales-invoices/${iv}`)).body;
    expect((await call('PUT', `/api/v1/sales-invoices/${iv}`, { ...doc, remark: 'แก้ไม่ได้' })).status).toBe(403);
    expect((await call('POST', `/api/v1/sales-invoices/${iv}/cancel`, { reason: 'ลองยกเลิก' })).status).toBe(403);
    expect((await call('POST', '/api/v1/customers', { code: 'VIEWX', name: 'ห้ามเพิ่ม' })).status).toBe(403);
    expect((await call('PUT', '/api/v1/company/ui-theme', { theme: 'blue' })).status).toBe(403);
    expect((await call('POST', `/api/v1/print/doc/${iv}/printed`, { slot: 1 })).status).toBe(403);
    expect((await call('POST', '/api/v1/auth/select', { company_id: suCo })).body.error?.message).toMatch(/ไม่มีสิทธิ์เข้าบริษัทนี้/);
    expect((await call('GET', '/api/v1/tenants')).status).toBe(403);
    expect((await call('GET', '/api/v1/users')).status).toBe(403);
    cookie = '';
  });

  it('cli create-admin (tools/cloud/reset-admin.ps1) refuses a customer user, resets provider staff, creates a new admin (HANDOFF 155)', async () => {
    const { createOrResetAdmin } = await import('../src/admin-cli.js');
    const row = async (u: string) => (await sql<{ tenant_id: string | null; user_group_id: string | null; password_hash: string; status: string }>`SELECT tenant_id, user_group_id, password_hash, status FROM sys_user WHERE lower(username) = ${u} AND deleted_at IS NULL`.execute(database.db)).rows[0];
    // ผู้ใช้ของลูกค้า (ไม่สนตัวพิมพ์) = ปฏิเสธ ไม่เปลี่ยนอะไรเลย
    const before = await row('b.admin');
    expect(before!.tenant_id).toBeTruthy();
    await expect(createOrResetAdmin(database.db, 'B.Admin', 'ผู้ดูแล', 'New-Pass-155')).rejects.toThrow(/เป็นผู้ใช้ของลูกค้า/);
    expect(await row('b.admin')).toEqual(before);
    cookie = '';
    expect((await call('POST', '/api/v1/auth/login', { username: 'b.admin', password: 'passB1234' })).status).toBe(200);
    expect((await call('GET', '/api/v1/auth/me')).body.user.is_platform).toBe(false);
    // รหัสใหม่ = ผู้ดูแลระบบของผู้ให้บริการ · ผู้ดูแลเดิม = ตั้งรหัสใหม่ (ยังเป็นเจ้าหน้าที่ผู้ให้บริการ)
    await expect(createOrResetAdmin(database.db, 'ops.155', 'ผู้ดูแล 155', 'short')).rejects.toThrow();
    expect(await createOrResetAdmin(database.db, 'ops.155', 'ผู้ดูแล 155', 'Ops-Pass-155')).toBe('created');
    cookie = '';
    expect((await call('POST', '/api/v1/auth/login', { username: 'ops.155', password: 'Ops-Pass-155' })).status).toBe(200);
    expect((await call('GET', '/api/v1/auth/me')).body.user).toMatchObject({ is_platform: true, is_admin: true, tenant_id: null });
    expect(await createOrResetAdmin(database.db, 'OPS.155', 'ผู้ดูแล 155', 'Ops-Pass-156')).toBe('reset');
    cookie = '';
    expect((await call('POST', '/api/v1/auth/login', { username: 'ops.155', password: 'Ops-Pass-155' })).status).toBe(401);
    expect((await call('POST', '/api/v1/auth/login', { username: 'ops.155', password: 'Ops-Pass-156' })).status).toBe(200);
    expect((await row('ops.155'))!.tenant_id).toBeNull();
    cookie = '';
  });

  it('read-only viewer: EVERY registered write route (POST/PUT/PATCH/DELETE) is refused with 403 — a new route without a proper rule fails here (HANDOFF 157)', async () => {
    cookie = '';
    expect((await call('POST', '/api/v1/auth/login', { username: 'demo.view1', password: 'View-Only-99' })).status).toBe(200);
    const co = (await call('GET', '/api/v1/auth/me')).body.companies[0].id;
    expect((await call('POST', '/api/v1/auth/select', { company_id: co })).status).toBe(200);
    const viewer = cookie;
    // บัญชีของตัวเอง (ไม่ใช่ข้อมูลบริษัท): ออก/เลือกบริษัท/เปลี่ยนรหัสผ่าน/ยืนยันตัวตนสองขั้น — ไม่ได้เขียนข้อมูลบัญชี · ไม่ต้องเข้าระบบ: เข้าระบบ/ตั้งค่าครั้งแรก/สมัคร
    const OWN_ACCOUNT = new Set(VIEWER_OWN_ACCOUNT_ROUTES);
    const zero = '00000000-0000-4000-8000-000000000000';
    const leaks: string[] = [];
    for (const r of [...REGISTERED_ROUTES].sort()) {
      const [method, url] = r.split(' ') as ['POST' | 'PUT' | 'DELETE' | 'PATCH', string];
      if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) || OWN_ACCOUNT.has(r) || POSTING_PREVIEW.test(url)) continue;
      const path = url.replace(/:kind\b/g, 'doc').replace(/:entity\b/g, 'item').replace(/:[A-Za-z_]+/g, zero);
      cookie = viewer;
      const res = await app.inject({ method, url: path, payload: {}, headers: { cookie: viewer } });
      if (res.statusCode !== 403) leaks.push(`${r} → ${res.statusCode} ${res.body.slice(0, 120)}`);
    }
    expect(leaks).toEqual([]);
    // ยังอ่านได้ และยังเป็นผู้ใช้เดิม (ไม่มีคำขอใดเปลี่ยนสิทธิ์/ออกจากระบบ)
    cookie = viewer;
    expect((await call('GET', '/api/v1/auth/me')).body.user).toMatchObject({ username: 'demo.view1', is_admin: false });
    cookie = '';
  });

  it('standard user groups for customers + a user must get a company (HANDOFF 159): new tenant/company/signup get SALE PURCH ACC VIEW with rights, provider button is idempotent, no cross-tenant', async () => {
    const login = async (u: string, pw: string) => { cookie = ''; const r = await call('POST', '/api/v1/auth/login', { username: u, password: pw }); expect([u, r.status]).toEqual([u, 200]); return cookie; };
    const STD = ['ACC', 'PURCH', 'SALE', 'VIEW'];
    const platform = await login('admin', 'secret123');
    for (const [code, u, pw] of [['GRP-A', 'grp.a', 'passGrpA1'], ['GRP-B', 'grp.b', 'passGrpB1']]) expect((await call('POST', '/api/v1/tenants', { code, name: `ลูกค้า ${code}`, admin_username: u, admin_name: `ผู้ดูแล ${code}`, admin_password: pw })).status).toBe(200);
    const tenants = (await call('GET', '/api/v1/tenants')).body as Array<{ id: string; code: string; name: string; status: string }>;
    const A = tenants.find((t) => t.code === 'GRP-A')!, B = tenants.find((t) => t.code === 'GRP-B')!;
    // ลูกค้าใหม่ได้กลุ่มตั้งต้นทันที · บริษัทแรกและบริษัทที่สองได้สิทธิ์ของกลุ่มเหล่านั้น
    const adminA = await login('grp.a', 'passGrpA1');
    const co1 = (await call('POST', '/api/v1/companies', { code: 'GRPA1', name_th: 'บริษัท เอหนึ่ง จำกัด', fiscal_start: '2026-01-01', chart: 'express' })).body.id as string;
    const co2 = (await call('POST', '/api/v1/companies', { code: 'GRPA2', name_th: 'บริษัท เอสอง จำกัด', fiscal_start: '2026-01-01', chart: 'express' })).body.id as string;
    // เมนูของผู้ให้บริการ: ผู้ดูแลของลูกค้าไม่เห็น (สิทธิ์ทุกชนิด = ไม่ได้) · เจ้าหน้าที่ผู้ให้บริการเห็น (HANDOFF 159.1)
    await call('POST', '/api/v1/auth/select', { company_id: co1 });
    const tenantPerms = (await call('GET', '/api/v1/auth/me')).body.perms as Record<string, Record<string, unknown>>;
    for (const m of PLATFORM_MENUS) expect([m, Object.values(tenantPerms[m]!).some((v) => v !== false)]).toEqual([m, false]);
    expect([tenantPerms['SET.NEWCO']!.add, tenantPerms['SET.DEVICE']!.read, tenantPerms['OT.IMPORT']!.add]).toEqual([true, true, true]);
    let ul = (await call('GET', '/api/v1/users')).body as { users: Array<{ id: string; username: string; rights_in: string[] }>; groups: Array<{ id: string; code: string; rights_in: string[] }> };
    expect(ul.groups.map((g) => g.code).sort()).toEqual(['ADMIN', ...STD].sort());
    for (const c of STD) expect(ul.groups.find((g) => g.code === c)!.rights_in.sort()).toEqual([co1, co2].sort());
    const G = Object.fromEntries(ul.groups.map((g) => [g.code, g.id]));
    // ผู้ใช้ที่ไม่ใช่ ADMIN ต้องเลือกบริษัท · กลุ่ม ADMIN ไม่ต้อง
    const base = { display_name: 'พนักงาน', password: 'Staff-Pass-159', approval_level: 0, check_rights: true, status: 'A' };
    const none = await call('POST', '/api/v1/users', { ...base, username: 'grp.nocomp', user_group_id: G.SALE, companies: [] });
    expect([none.status, none.body.error.message, none.body.error.issues[0].field]).toEqual([400, expect.stringMatching(/ยังไม่ได้เลือกบริษัทที่เข้าได้/), 'companies']);
    expect((await call('POST', '/api/v1/users', { ...base, username: 'grp.nogroup', companies: [] })).status).toBe(400);
    expect((await call('POST', '/api/v1/users', { ...base, username: 'grp.admin2', user_group_id: G.ADMIN, companies: [] })).status).toBe(200);
    const sale = await call('POST', '/api/v1/users', { ...base, username: 'grp.sale', user_group_id: G.SALE, companies: [co1] });
    expect(sale.status).toBe(200);
    // แก้ผู้ใช้ให้ไม่มีบริษัท = ไม่ได้เหมือนกัน
    expect((await call('PUT', `/api/v1/users/${sale.body.id}`, { ...base, password: undefined, username: 'grp.sale', user_group_id: G.SALE, companies: [] })).body.error.message).toMatch(/ยังไม่ได้เลือกบริษัท/);
    // พนักงานกลุ่มฝ่ายขายใช้ได้ทันที: ขายได้ บัญชี/เงินเดือน/ตั้งค่าไม่ได้
    await login('grp.sale', 'Staff-Pass-159');
    await call('POST', '/api/v1/auth/select', { company_id: co1 });
    const perms = (await call('GET', '/api/v1/auth/me')).body.perms;
    expect([perms['SA.IV'].add, perms['FI.AR.RE'].add, perms['IC.STOCK'].read, perms['IC.ITEM'].add, perms['GL.JNL'].read, perms['SET.CO'].edit]).toEqual([true, true, true, false, false, false]);
    expect((await call('GET', '/api/v1/sales-invoices?limit=1')).status).toBe(200);
    expect((await call('GET', '/api/v1/gl/journals')).status).toBe(403);
    // ข้ามลูกค้าไม่ได้ (กติกา 7.1): ผู้ดูแลลูกค้า B ไม่เห็นกลุ่มของ A ใช้กลุ่ม/บริษัทของ A ไม่ได้ กดปุ่มของผู้ให้บริการไม่ได้
    await login('grp.b', 'passGrpB1');
    const coB = (await call('POST', '/api/v1/companies', { code: 'GRPB1', name_th: 'บริษัท บีหนึ่ง จำกัด', fiscal_start: '2026-01-01', chart: 'express' })).body.id as string;
    const ulB = (await call('GET', '/api/v1/users')).body as typeof ul;
    expect(ulB.groups.map((g) => g.code).sort()).toEqual(['ADMIN', ...STD].sort());
    expect(ulB.groups.some((g) => g.id === G.SALE)).toBe(false);
    expect(ulB.groups.every((g) => g.rights_in.every((c) => c === coB))).toBe(true);
    expect((await call('POST', '/api/v1/users', { ...base, username: 'grp.cross1', user_group_id: G.SALE, companies: [coB] })).body.error.message).toMatch(/กลุ่มผู้ใช้ต้องเป็นของลูกค้ารายเดียวกับผู้ใช้/);
    expect((await call('POST', '/api/v1/users', { ...base, username: 'grp.cross2', user_group_id: ulB.groups.find((g) => g.code === 'SALE')!.id, companies: [co1] })).status).toBe(400);
    expect((await call('POST', `/api/v1/tenants/${A.id}/standard-groups`)).status).toBe(403);
    // ปุ่มผู้ให้บริการ: ลูกค้าเดิมที่ยังไม่มีกลุ่มตั้งต้น → สร้างครบ · กดซ้ำ = ไม่เพิ่มอะไร · สิทธิ์ที่ลูกค้าแก้เองไม่ถูกเขียนทับ
    await sql`UPDATE sys_user_group SET deleted_at = now() WHERE tenant_id = ${B.id} AND code IN ('SALE', 'PURCH', 'ACC', 'VIEW')`.execute(database.db);
    cookie = platform;
    expect((await call('GET', '/api/v1/auth/me')).body.perms['SET.TENANT'].read).toBe(true);
    const r1 = await call('POST', `/api/v1/tenants/${B.id}/standard-groups`);
    expect([r1.status, r1.body.created.sort(), r1.body.companies]).toEqual([200, [...STD].sort(), 1]);
    expect(r1.body.rows).toBeGreaterThan(10);
    const accB = (await sql<{ id: string }>`SELECT id FROM sys_user_group WHERE tenant_id = ${B.id} AND code = 'ACC' AND deleted_at IS NULL`.execute(database.db)).rows[0]!.id;
    await sql`UPDATE sys_permission SET can_add = 'N' WHERE subject_id = ${accB} AND deleted_at IS NULL`.execute(database.db);
    const r2 = await call('POST', `/api/v1/tenants/${B.id}/standard-groups`);
    expect([r2.status, r2.body.created, r2.body.rows]).toEqual([200, [], 0]);
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM sys_permission WHERE subject_id = ${accB} AND deleted_at IS NULL AND can_add = 'Y'`.execute(database.db)).rows[0]!.n).toBe(0);
    // ลูกค้าที่สมัครเองและได้รับอนุมัติ (ชุดทดสอบสมัครใช้งานด้านบน — สร้างบริษัทแรก SUAUTO ให้): กลุ่มตั้งต้นมีสิทธิ์ในบริษัทนั้น
    const su = (await sql<{ code: string }>`SELECT DISTINCT g.code FROM sys_permission p JOIN sys_user_group g ON g.id = p.subject_id AND g.deleted_at IS NULL
        JOIN sys_company c ON c.id = p.company_id AND c.tenant_id = g.tenant_id WHERE p.deleted_at IS NULL AND c.code = 'SUAUTO' ORDER BY 1`.execute(database.db)).rows.map((x) => x.code);
    expect(su).toEqual([...STD].sort());
    void adminA;
    cookie = '';
  });

  it('starter data by business type (HANDOFF 160): each template passes normal validation, an invoice saves right away, fill button is idempotent and keeps edits, signup choice, no cross-tenant', async () => {
    const login = async (u: string, pw: string) => { cookie = ''; const r = await call('POST', '/api/v1/auth/login', { username: u, password: pw }); expect([u, r.status]).toEqual([u, 200]); return cookie; };
    await login('admin', 'secret123');
    for (const [code, u, pw] of [['ST-A', 'st.a', 'passStA1'], ['ST-B', 'st.b', 'passStB1']]) expect((await call('POST', '/api/v1/tenants', { code, name: `ลูกค้า ${code}`, admin_username: u, admin_name: `ผู้ดูแล ${code}`, admin_password: pw })).status).toBe(200);
    await login('st.a', 'passStA1');
    const co: Record<string, string> = {};
    for (const t of ['TRADE', 'SERVICE', 'MFG', 'BLANK']) {
      const r = await call('POST', '/api/v1/companies', { code: `ST${t}`, name_th: `บริษัท ${t} จำกัด`, fiscal_start: '2026-01-01', chart: 'express', starter: t });
      expect([t, r.status, r.body.error?.message]).toEqual([t, 200, undefined]);
      co[t] = r.body.id;
    }
    const count = async (id: string) => {
      const n = async (q: string) => (await sql<{ n: number }>`SELECT count(*)::int AS n FROM ${sql.table(q)} WHERE company_id = ${id} AND deleted_at IS NULL`.execute(database.db)).rows[0]!.n;
      return { unit: await n('md_unit'), wh: await n('md_warehouse'), bank: await n('md_bank'), dept: await n('md_department'), ig: await n('md_item_account_group'), ag: await n('md_asset_account_group'), pm: await n('md_payment_method') };
    };
    expect(await count(co.TRADE!)).toEqual({ unit: 14, wh: 1, bank: 12, dept: 4, ig: 1, ag: 5, pm: 4 });
    expect(await count(co.SERVICE!)).toEqual({ unit: 8, wh: 1, bank: 12, dept: 4, ig: 2, ag: 5, pm: 4 });
    expect(await count(co.MFG!)).toEqual({ unit: 18, wh: 3, bank: 12, dept: 6, ig: 4, ag: 6, pm: 4 });
    expect(await count(co.BLANK!)).toEqual({ unit: 0, wh: 0, bank: 0, dept: 0, ig: 0, ag: 0, pm: 0 });
    // ค่าเริ่มต้น: คลังหลัก · บริการ = ภาษีขายบริการเกณฑ์เงินสด (D1) · ผลิต = คลังหลัก 03 สินค้าสำเร็จรูป (D2)
    const setting = async (c: string, k: string) => { await call('POST', '/api/v1/auth/select', { company_id: c }); return (await call('GET', '/api/v1/settings')).body.values[k]; };
    expect([await setting(co.TRADE!, 'ic.main_warehouse'), await setting(co.SERVICE!, 'ar.service_vat_basis'), await setting(co.MFG!, 'ic.main_warehouse')]).toEqual(['01', '2', '03']);
    // ผ่านการตรวจตามปกติ: บันทึกตารางข้อมูล/วิธีรับจ่าย/กลุ่มบัญชีกลับทั้งชุด ได้
    for (const t of ['TRADE', 'SERVICE', 'MFG']) {
      await call('POST', '/api/v1/auth/select', { company_id: co[t] });
      for (const tbl of ['01', '20', '21', '22', '41', '45', '46', '51']) {
        const rows = (await call('GET', `/api/v1/data-tables/${tbl}`)).body as Array<Record<string, unknown>>;
        const put = await call('PUT', `/api/v1/data-tables/${tbl}`, { rows: rows.map(({ used: _u, ...r }) => r) });
        expect([t, tbl, put.status, put.body?.error?.message]).toEqual([t, tbl, 200, undefined]);
      }
      for (const dir of ['R', 'P']) {
        const pms = (await call('GET', `/api/v1/payment-methods/${dir}`)).body as Array<Record<string, unknown>>;
        const put = await call('PUT', `/api/v1/payment-methods/${dir}`, { rows: pms.map(({ used: _u, ...r }) => r) });
        expect([t, dir, put.status, put.body?.error?.message]).toEqual([t, dir, 200, undefined]);
      }
      const igs = (await call('GET', '/api/v1/item-account-groups')).body as Array<{ code: string; sales_account_id: string | null; cogs_account_id: string | null }>;
      expect(igs.length).toBeGreaterThan(0);
      expect(igs.every((g) => g.sales_account_id)).toBe(true);
    }
    // บริษัทใหม่แบบซื้อมาขายไป: สินค้า (หน่วยนับตั้งต้น) → ซื้อเข้าคลังหลัก → ขายเงินเชื่อ ไม่ต้องตั้งอะไรเพิ่ม
    await call('POST', '/api/v1/auth/select', { company_id: co.TRADE });
    const pcs = ((await call('GET', '/api/v1/data-tables/20')).body as Array<{ id: string; code: string }>).find((u) => u.code === 'PCS')!.id;
    const gd = ((await call('GET', '/api/v1/item-account-groups')).body as Array<{ id: string; code: string }>).find((g) => g.code === 'GD')!.id;
    const item = await call('POST', '/api/v1/items', { code: '01-STAR-000001', name_th: 'สินค้าทดลอง', base_unit_id: pcs, account_group_id: gd, std_cost: '50' });
    expect([item.status, item.body.error?.message]).toEqual([200, undefined]);
    const cus = (await call('POST', '/api/v1/customers', { code: 'C1', name: 'ลูกค้าทดลอง', tax_id: tid(160) })).body.id;
    const sup = (await call('POST', '/api/v1/suppliers', { code: 'S1', name: 'ผู้จำหน่ายทดลอง', tax_id: tid(161) })).body.id;
    const typeOf = async (c: string) => (await call('GET', `/api/v1/trade-defaults/${c}`)).body.types[0].id as string;
    const rr = await call('POST', '/api/v1/purchase-invoices', { doc_type_id: await typeOf('RR'), doc_date: '2026-02-01', party_id: sup, price_type: '2', vat_rate: 7, lines: [{ item_id: item.body.id, qty: 10, unit_price: 50 }] });
    expect([rr.status, rr.body.error?.message]).toEqual([200, undefined]);
    const iv = await call('POST', '/api/v1/sales-invoices', { doc_type_id: await typeOf('IV'), doc_date: '2026-02-02', party_id: cus, price_type: '2', vat_rate: 7, lines: [{ item_id: item.body.id, qty: 2, unit_price: 100 }] });
    expect([iv.status, iv.body.error?.message, iv.body.net_amount]).toEqual([200, undefined, '214.00']);
    const line = (await call('GET', `/api/v1/sales-invoices/${iv.body.id}`)).body.lines[0];
    expect([line.unit_id, line.warehouse_id]).toEqual([pcs, ((await call('GET', '/api/v1/data-tables/21')).body as Array<{ id: string }>)[0]!.id]);
    // รับชำระด้วยวิธีตั้งต้น (เงินสด CH)
    const ch = ((await call('GET', '/api/v1/payment-methods/R')).body as Array<{ id: string; code: string }>).find((m) => m.code === 'CH')!.id;
    const re = await call('POST', '/api/v1/ar-receipts', { doc_type_id: await typeOf('RE'), doc_date: '2026-02-03', party_id: cus, settlements: [{ invoice_header_id: iv.body.id, amount: '214.00' }], payments: [{ payment_method_id: ch, amount: '214.00' }] });
    expect([re.status, re.body.error?.message]).toEqual([200, undefined]);
    // บริษัทเดิม (ว่าง): ดูก่อน → เติม → เติมซ้ำ = 0 · ที่ลูกค้าแก้เองไม่ถูกทับ · ที่ลบไปแล้ว (ยังไม่ใช้) เติมกลับได้
    await call('POST', '/api/v1/auth/select', { company_id: co.BLANK });
    const pv = (await call('GET', '/api/v1/company/starter-data?template=SERVICE')).body;
    expect(pv.preview.added).toBeGreaterThan(50);
    expect(pv.preview.tables.find((t: { key: string }) => t.key === 'units').add).toContain('HR ชั่วโมง');
    expect((await count(co.BLANK!)).unit).toBe(0);   // ดูก่อน = ไม่บันทึก
    const f1 = await call('POST', '/api/v1/company/starter-data', { template: 'SERVICE' });
    expect([f1.status, f1.body.added]).toEqual([200, pv.preview.added]);
    await sql`UPDATE md_unit SET name_th = 'ชม. (แก้เอง)' WHERE company_id = ${co.BLANK} AND code = 'HR'`.execute(database.db);
    const f2 = await call('POST', '/api/v1/company/starter-data', { template: 'SERVICE' });
    expect(f2.body.added).toBe(0);
    expect((await sql<{ name_th: string }>`SELECT name_th FROM md_unit WHERE company_id = ${co.BLANK} AND code = 'HR'`.execute(database.db)).rows[0]!.name_th).toBe('ชม. (แก้เอง)');
    expect((await call('GET', '/api/v1/company/starter-data')).body).toMatchObject({ last: 'SERVICE' });
    expect((await call('POST', '/api/v1/company/starter-data', { template: 'NOPE' })).status).toBe(400);
    // ข้ามลูกค้าไม่ได้ (กติกา 7.1): เติมได้เฉพาะบริษัทที่เลือกอยู่ใน session — ลูกค้า B เลือกบริษัทของ A ไม่ได้ ข้อมูลของ A ไม่เปลี่ยน
    const before = await count(co.BLANK!);
    await login('st.b', 'passStB1');
    expect((await call('POST', '/api/v1/auth/select', { company_id: co.BLANK })).body.error?.message).toMatch(/ไม่มีสิทธิ์เข้าบริษัทนี้/);
    const coB = (await call('POST', '/api/v1/companies', { code: 'STB1', name_th: 'บริษัท บี จำกัด', fiscal_start: '2026-01-01', chart: 'express' })).body.id;
    await call('POST', '/api/v1/auth/select', { company_id: coB });
    expect((await call('POST', '/api/v1/company/starter-data', { template: 'MFG' })).body.added).toBeGreaterThan(50);
    expect(await count(co.BLANK!)).toEqual(before);
    // สมัครใช้งานเลือกประเภทธุรกิจ → อนุมัติ (ผู้ให้บริการเปลี่ยนได้)
    cookie = '';
    appCfg.signup = 'review';
    const sg = await call('POST', '/api/v1/signup', { business_name: 'ร้านผลิตทดลอง', contact_name: 'คุณผลิต', contact_email: 'st.mfg@example.com', contact_phone: '081-234-5678', username: 'st.mfg', password: 'Signup-Pass99', accept_terms: true, business_template: 'MFG' });
    expect(sg.status).toBe(200);
    expect((await sql<{ t: string }>`SELECT business_template AS t FROM sys_signup WHERE username = 'st.mfg'`.execute(database.db)).rows[0]!.t).toBe('MFG');
    await login('admin', 'secret123');
    const sid = (await sql<{ id: string }>`SELECT id FROM sys_signup WHERE username = 'st.mfg'`.execute(database.db)).rows[0]!.id;
    const ap = await call('POST', `/api/v1/signups/${sid}/approve`, {});
    expect([ap.status, ap.body.error?.message]).toEqual([200, undefined]);
    expect((await count(ap.body.company_id)).wh).toBe(3);
    cookie = '';
  });

  it('two people editing the same record (HANDOFF 163): A saves, B gets 409 with A\'s name, B reloads and saves; no version = old behaviour; printing is not an edit', async () => {
    const req = async (ck: string, method: 'GET' | 'PUT' | 'POST', url: string, body?: unknown, ver?: string) => {
      const r = await app.inject({ method, url, payload: body as object, headers: { cookie: ck, ...(ver ? { 'x-if-version': ver } : {}) } });
      return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null, ver: r.headers['x-row-version'] as string | undefined };
    };
    const login = async (u: string, pw: string) => { cookie = ''; const r = await call('POST', '/api/v1/auth/login', { username: u, password: pw }); expect([u, r.status]).toEqual([u, 200]); return cookie; };
    const A = await login('st.a', 'passStA1');
    const coId = (await sql<{ id: string }>`SELECT id FROM sys_company WHERE code = 'STTRADE'`.execute(database.db)).rows[0]!.id;
    await req(A, 'POST', '/api/v1/auth/select', { company_id: coId });
    const adminGroup = ((await req(A, 'GET', '/api/v1/users')).body.groups as Array<{ id: string; code: string }>).find((g) => g.code === 'ADMIN')!.id;
    expect((await req(A, 'POST', '/api/v1/users', { username: 'st.a2', display_name: 'ผู้ดูแลคนที่สอง', password: 'passStA2x', user_group_id: adminGroup, approval_level: 9, companies: [] })).status).toBe(200);
    const B = await login('st.a2', 'passStA2x');
    await req(B, 'POST', '/api/v1/auth/select', { company_id: coId });
    const aName = (await req(A, 'GET', '/api/v1/auth/me')).body.user.display_name as string;
    const typeOf = async (c: string) => (await req(A, 'GET', `/api/v1/trade-defaults/${c}`)).body.types[0].id as string;
    const pcs = ((await req(A, 'GET', '/api/v1/data-tables/20')).body as Array<{ id: string; code: string }>).find((u) => u.code === 'PCS')!.id;
    const item = (await req(A, 'GET', '/api/v1/items?q=01-STAR-000001')).body.rows[0] as { id: string };
    const cus = ((await req(A, 'GET', '/api/v1/customers?q=C1')).body.rows as Array<{ id: string; code: string }>).find((c) => c.code === 'C1')!.id;
    const ivBody = (remark: string) => ({ doc_type_id: ivType, doc_date: '2026-02-05', party_id: cus, price_type: '2', vat_rate: 7, remark, lines: [{ item_id: item.id, qty: 1, unit_price: 100 }] });
    const ivType = await typeOf('IV');
    const iv = (await req(A, 'POST', '/api/v1/sales-invoices', ivBody('v1'))).body.id as string;
    const iv2 = (await req(A, 'POST', '/api/v1/sales-invoices', ivBody('for receipt'))).body.id as string;
    const reBody = (remark: string) => ({ doc_type_id: reType, doc_date: '2026-02-06', party_id: cus, remark, settlements: [{ invoice_header_id: iv2, amount: '107.00' }] });
    const reType = await typeOf('RE');
    const re = (await req(A, 'POST', '/api/v1/ar-receipts', reBody('r1'))).body.id as string;
    const chart = (await req(A, 'GET', '/api/v1/gl/accounts')).body as Array<{ id: string; account_no: string }>;
    const cash = chart.find((x) => x.account_no === '1111-00')!.id;
    const book = (await req(A, 'GET', '/api/v1/gl/books')).body[0].id as string;
    const jvBody = (d: string) => ({ journal_book_id: book, voucher_date: '2026-02-07', description: d, lines: [{ account_id: cash, debit: '10' }, { account_id: cash, credit: '10' }] });
    const jv = (await req(A, 'POST', '/api/v1/gl/journals', jvBody('j1'))).body.id as string;
    const cases: Array<[string, string, (n: string) => unknown]> = [
      ['IV', `/api/v1/sales-invoices/${iv}`, (n) => ivBody(n)],
      ['RE', `/api/v1/ar-receipts/${re}`, (n) => reBody(n)],
      ['JV', `/api/v1/gl/journals/${jv}`, (n) => jvBody(n)],
      ['customer', `/api/v1/customers/${cus}`, (n) => ({ code: 'C1', name: `ลูกค้าทดลอง ${n}`, tax_id: tid(160) })],
      ['item', `/api/v1/items/${item.id}`, (n) => ({ code: '01-STAR-000001', name_th: `สินค้าทดลอง ${n}`, base_unit_id: pcs, std_cost: '50' })],
    ];
    for (const [name, url, body] of cases) {
      const ga = await req(A, 'GET', url), gb = await req(B, 'GET', url);
      expect([name, typeof ga.ver, ga.ver === gb.ver]).toEqual([name, 'string', true]);
      const pa = await req(A, 'PUT', url, body('A'), ga.ver);
      expect([name, pa.status, pa.body?.error?.message]).toEqual([name, 200, undefined]);
      expect([name, pa.ver !== ga.ver]).toEqual([name, true]);
      const pb = await req(B, 'PUT', url, body('B'), gb.ver);
      expect([name, pb.status, pb.body.error.code]).toEqual([name, 409, 'VERSION_CONFLICT']);
      expect(pb.body.error.message).toContain(aName);
      expect(pb.body.error.message).toMatch(/หลังจากคุณเปิด — เปิดใหม่เพื่อดูฉบับล่าสุด แล้วแก้อีกครั้ง \(การแก้ไขของคุณยังไม่ถูกบันทึก\)/);
      expect(pb.body.error.message).toMatch(/\d{1,2}\/\d{1,2}\/25\d\d \d\d:\d\d/);   // วันเวลา พ.ศ.
      const gb2 = await req(B, 'GET', url);
      const pb2 = await req(B, 'PUT', url, body('B2'), gb2.ver);
      expect([name, pb2.status, pb2.body?.error?.message]).toEqual([name, 200, undefined]);
      // ไม่ส่งรุ่น (ระบบอื่น/เครื่องสาขา) = บันทึกได้เหมือนเดิม
      expect([name, (await req(A, 'PUT', url, body('API'))).status]).toEqual([name, 200]);
    }
    // ตารางหลายแถว: ตารางข้อมูลหน่วยนับ — ทั้งตารางเป็นรุ่นเดียว
    const t = '/api/v1/data-tables/20';
    const ta = await req(A, 'GET', t), tb = await req(B, 'GET', t);
    const rows = (x: { body: Array<Record<string, unknown>> }, nm: string) => x.body.map(({ used: _u, ...r }) => (r.code === 'PCS' ? { ...r, name_th: nm } : r));
    expect((await req(A, 'PUT', t, { rows: rows(ta, 'ชิ้น (A)') }, ta.ver)).status).toBe(200);
    const tbx = await req(B, 'PUT', t, { rows: rows(tb, 'ชิ้น (B)') }, tb.ver);
    expect([tbx.status, tbx.body.error.code]).toEqual([409, 'VERSION_CONFLICT']);
    expect(tbx.body.error.message).toMatch(/^ตารางนี้ถูกแก้ไขโดย/);
    const tb2 = await req(B, 'GET', t);
    expect((await req(B, 'PUT', t, { rows: rows(tb2, 'ชิ้น') }, tb2.ver)).status).toBe(200);
    // พิมพ์เอกสาร (นับครั้งที่พิมพ์) ไม่ใช่การแก้ไข — รุ่นไม่เปลี่ยน
    const g1 = await req(A, 'GET', `/api/v1/sales-invoices/${iv}`);
    expect((await req(B, 'POST', `/api/v1/print/doc/${iv}/printed`, { slot: 1 })).status).toBe(200);
    expect((await req(A, 'GET', `/api/v1/sales-invoices/${iv}`)).ver).toBe(g1.ver);
    expect((await req(A, 'PUT', `/api/v1/sales-invoices/${iv}`, ivBody('after print'), g1.ver)).status).toBe(200);
    cookie = '';
  });

  it('1 รหัสเข้าได้ทีละ 1 เครื่อง: the second login ends the first session with SESSION_REPLACED; per-user option; no cross-tenant change (HANDOFF 156)', async () => {
    const login = async (u: string, pw: string) => { cookie = ''; expect((await call('POST', '/api/v1/auth/login', { username: u, password: pw })).status).toBe(200); return cookie; };
    const as = async (c: string, url: string) => { cookie = c; return call('GET', url); };
    await login('admin', 'secret123');
    // ลูกค้าใหม่ 2 ราย (CUSTA/CUSTB ถูกระงับ/ย้ายในชุดก่อนหน้า)
    for (const [code, u, pw] of [['ONE-A', 'one.a', 'passOneA1'], ['ONE-B', 'one.b', 'passOneB1']]) expect((await call('POST', '/api/v1/tenants', { code, name: `ลูกค้า ${code}`, admin_username: u, admin_name: `ผู้ดูแล ${code}`, admin_password: pw })).status).toBe(200);
    const tenants = (await call('GET', '/api/v1/tenants')).body as Array<{ id: string; code: string; name: string; status: string; single_session: boolean }>;
    const A = tenants.find((t) => t.code === 'ONE-A')!, B = tenants.find((t) => t.code === 'ONE-B')!;
    expect(A.single_session).toBe(false); expect(B.single_session).toBe(false);   // ค่าเริ่มต้น ปิด
    // ปิดอยู่ = เข้าได้หลายเครื่องเหมือนเดิม
    const b1 = await login('one.b', 'passOneB1'), b2 = await login('one.b', 'passOneB1');
    expect((await as(b1, '/api/v1/auth/me')).status).toBe(200); expect((await as(b2, '/api/v1/auth/me')).status).toBe(200);
    // ผู้ให้บริการเปิดให้ลูกค้า A (ส่งเฉพาะช่องที่มี — ไม่ส่ง single_session = คงค่าเดิม)
    await login('admin', 'secret123');
    expect((await call('PUT', `/api/v1/tenants/${A.id}`, { code: A.code, name: A.name, status: A.status })).status).toBe(200);
    expect((await call('GET', '/api/v1/tenants')).body.find((t: { id: string }) => t.id === A.id).single_session).toBe(false);
    expect((await call('PUT', `/api/v1/tenants/${A.id}`, { code: A.code, name: A.name, status: A.status, single_session: true })).status).toBe(200);
    const a1 = await login('one.a', 'passOneA1');
    expect((await as(a1, '/api/v1/auth/me')).status).toBe(200);
    const a2 = await login('one.a', 'passOneA1');
    const kicked = await as(a1, '/api/v1/auth/me');
    expect(kicked.status).toBe(401);
    expect(kicked.body.error.code).toBe('SESSION_REPLACED');
    expect(kicked.body.error.message).toMatch(/เข้าระบบจากเครื่องอื่นแล้ว/);
    expect((await as(a2, '/api/v1/auth/me')).status).toBe(200);
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM sys_activity_log WHERE action = 'SESSION_REPLACED'`.execute(database.db)).rows[0]!.n).toBeGreaterThan(0);
    // ออกจากระบบเอง = ข้อความเดิม (ไม่ใช่ "เครื่องอื่น")
    cookie = a2; await call('POST', '/api/v1/auth/logout');
    expect((await as(a2, '/api/v1/auth/me')).body.error.code).toBe('UNAUTHORIZED');
    // ลูกค้า B ไม่ได้รับผล: ทั้งสองเครื่องเดิมยังใช้ได้
    expect((await as(b1, '/api/v1/auth/me')).status).toBe(200); expect((await as(b2, '/api/v1/auth/me')).status).toBe(200);
    // ข้ามลูกค้าไม่ได้ (กติกา 7.1): ผู้ดูแลของลูกค้า B แก้ค่าของลูกค้า A / ผู้ใช้ของลูกค้า A ไม่ได้
    cookie = b1;
    expect((await call('PUT', `/api/v1/tenants/${A.id}`, { code: A.code, name: A.name, status: A.status, single_session: false })).status).toBe(403);
    const aUser = (await sql<{ id: string }>`SELECT id FROM sys_user WHERE username = 'one.a'`.execute(database.db)).rows[0]!.id;
    expect((await call('PUT', `/api/v1/users/${aUser}`, { username: 'one.a', display_name: 'x', single_session: false })).status).toBe(404);
    expect((await call('GET', '/api/v1/tenant/security')).body.single_session).toBe(false);
    expect((await sql<{ single_session: boolean }>`SELECT single_session FROM sys_tenant WHERE id = ${A.id}`.execute(database.db)).rows[0]!.single_session).toBe(true);
    // รายผู้ใช้: ผู้ดูแลของลูกค้า B เปิดเฉพาะตัวเอง (ลูกค้า B ยังปิด) → เข้าเครื่องใหม่ เครื่องเดิมออก
    const me = (await call('GET', '/api/v1/users')).body.users.find((u: { username: string }) => u.username === 'one.b');
    expect(me.single_session).toBe(false);
    expect((await call('PUT', `/api/v1/users/${me.id}`, { username: me.username, display_name: me.display_name, user_group_id: me.user_group_id, approval_level: me.approval_level, check_rights: me.check_rights, status: me.status, companies: me.companies, single_session: true })).status).toBe(200);
    const b3 = await login('one.b', 'passOneB1');
    expect((await as(b1, '/api/v1/auth/me')).body.error?.code).toBe('SESSION_REPLACED');
    expect((await as(b2, '/api/v1/auth/me')).body.error?.code).toBe('SESSION_REPLACED');
    expect((await as(b3, '/api/v1/auth/me')).status).toBe(200);
    // คืนค่าเดิม (ชุดทดสอบอื่นเข้าระบบหลายครั้ง)
    expect((await call('PUT', `/api/v1/users/${me.id}`, { username: me.username, display_name: me.display_name, user_group_id: me.user_group_id, approval_level: me.approval_level, check_rights: me.check_rights, status: me.status, companies: me.companies, single_session: false })).status).toBe(200);
    await login('admin', 'secret123');
    expect((await call('PUT', `/api/v1/tenants/${A.id}`, { code: A.code, name: A.name, status: A.status, single_session: false })).status).toBe(200);
    cookie = '';
  });
});

describe('ชื่อภาษาอังกฤษของข้อมูล (โหมด EN)', () => {
  it('returns Thai → English names of this company only, skips missing/odd names, gzip when asked', async () => {
    cookie = '';
    expect((await call('POST', '/api/v1/auth/login', { username: 'admin', password: 'secret123' })).status).toBe(200);
    const co = (await call('GET', '/api/v1/auth/me')).body.companies.find((c: { code: string }) => c.code === 'DEMO').id;
    await call('POST', '/api/v1/auth/select', { company_id: co });
    await sql`INSERT INTO md_item (company_id, code, name_th, name_en, item_type) VALUES (${co}, 'EN-1', 'แก้วน้ำใส', 'Clear Water Glass', '0'),
      (${co}, 'EN-2', 'ไม่มีชื่ออังกฤษ', NULL, '0'), (${co}, 'EN-3', 'ชื่อแปลก {0}', 'Odd {0}', '0'), (${co}, 'EN-4', 'ชื่อไทยซ้ำ', 'ยังเป็นไทย', '0')`.execute(database.db);
    const r = await call('GET', '/api/v1/i18n/names');
    expect(r.status).toBe(200);
    const n = r.body.names as Record<string, string>;
    expect(n['แก้วน้ำใส']).toBe('Clear Water Glass');
    expect('ไม่มีชื่ออังกฤษ' in n).toBe(false); expect('ชื่อแปลก {0}' in n).toBe(false); expect('ชื่อไทยซ้ำ' in n).toBe(false);
    expect(Object.values(n).some((v) => /[\u0E00-\u0E7F]/.test(v))).toBe(false);
    const z = await app.inject({ method: 'GET', url: '/api/v1/i18n/names', headers: { cookie, 'accept-encoding': 'gzip' } });
    expect(z.headers['content-encoding']).toBe('gzip');
    const { gunzipSync } = await import('node:zlib');
    expect(JSON.parse(gunzipSync(z.rawPayload).toString()).names['แก้วน้ำใส']).toBe('Clear Water Glass');
    // ลูกค้าอื่นไม่เห็นชื่อของบริษัทนี้
    cookie = '';
    expect((await call('POST', '/api/v1/auth/login', { username: 'b.admin', password: 'passB1234' })).status).toBe(200);
    await call('POST', '/api/v1/auth/select', { company_id: (await call('GET', '/api/v1/auth/me')).body.companies[0].id });
    expect('แก้วน้ำใส' in (await call('GET', '/api/v1/i18n/names')).body.names).toBe(false);
  });
});
