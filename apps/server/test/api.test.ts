/**
 * ทดสอบ API ทั้งเส้นด้วยฐานข้อมูล PGlite ในหน่วยความจำ (แบบเดียวกับโหมดติดตั้งในเครื่อง)
 * ครอบคลุม: ตั้งผู้ดูแลระบบ, สร้างบริษัท, ผังบัญชี, ใบสำคัญ, ปิดงวด, งบทดลอง, งบการเงิน, แยกข้อมูลระหว่างบริษัท
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDatabase, type Database } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

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

  it('keeps companies separate', async () => {
    otherCompanyId = (await call('POST', '/api/v1/companies', { code: 'OTHER', name_th: 'อีกบริษัท', fiscal_start: '2026-01-01', chart: 'none' })).body.id;
    await call('POST', '/api/v1/auth/select', { company_id: otherCompanyId });
    expect((await call('GET', '/api/v1/gl/accounts')).body).toHaveLength(0);
    // ใช้บัญชีของบริษัทอื่นในใบสำคัญไม่ได้
    const book2 = (await call('GET', '/api/v1/gl/books')).body[0].id;
    const r = await call('POST', '/api/v1/gl/journals', { journal_book_id: book2, voucher_date: '2026-03-01', lines: [{ account_id: cash, debit: '1' }, { account_id: capital, credit: '1' }] });
    expect(r.body.error.message).toMatch(/ไม่พบบัญชี/);
    expect((await call('GET', '/api/v1/gl/journals')).body.total).toBe(0);
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
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
});
