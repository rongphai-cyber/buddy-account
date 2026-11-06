/**
 * S0 คลาวด์ (docs/20): เส้นทางจริงสั้นที่สุดของ Buddy บนฐานข้อมูลที่ใช้บนคลาวด์ — สร้างบริษัท 2 แห่ง บันทึกใบสำคัญ
 * งบทดลองตรงทุกสตางค์ และ Row-Level Security: role buddy_app ของบริษัท A อ่าน/เขียนข้อมูลบริษัท B ไม่ได้
 * ปกติรันบน PGlite ในหน่วยความจำ (pnpm test) · tools/cloud/pg-check.mjs รันไฟล์นี้กับ PostgreSQL / Supabase จริง
 * (BUDDY_TEST_DATABASE_URL — ต่อตรงหรือผ่าน transaction pooler) · รันซ้ำบนฐานเดิมได้ (รหัสบริษัทไม่ซ้ำต่อรอบ)
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { rlsAvailable, runInCompanyScope, type Database } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { buildApp } from '../src/app.js';
import { openTestDatabase } from './test-db.js';

let database: Database;
let app: FastifyInstance;
let cookie = '';
const run = Date.now().toString(36).slice(-5).toUpperCase();

async function call(method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown) {
  const r = await app.inject({ method, url, payload: body as object, headers: cookie ? { cookie } : {} });
  const set = r.headers['set-cookie'];
  if (set) cookie = (Array.isArray(set) ? set[0]! : set).split(';')[0]!;
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
}
const ok = (what: string, r: { status: number; body: any }) => {
  if (r.status !== 200 && r.status !== 201) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.BUDDY_REQUIRE_ADMIN_2FA = '0';
  process.env.BUDDY_SECRET_KEY ??= Buffer.alloc(32, 7).toString('base64');
  const { cfg, database: d } = await openTestDatabase();
  database = d;
  await migrate(database, cfg.migrationsDir, () => {});
  app = await buildApp(database, cfg);
}, 180_000);
afterAll(async () => { await app?.close(); await database?.close(); });

describe('S0 cloud: Buddy company + journal + trial balance + row-level security (docs/20)', () => {
  const co: Record<'A' | 'B', string> = { A: '', B: '' };
  const journal = async (lines: Array<[string, string, string]>, date: string, description: string) => {
    const accts = ok('accounts', await call('GET', '/api/v1/gl/accounts')) as Array<{ id: string; account_no: string }>;
    const book = (ok('books', await call('GET', '/api/v1/gl/books')) as Array<{ id: string; code: string }>).find((b) => b.code === '00')!.id;
    const id = (no: string) => accts.find((a) => a.account_no === no)!.id;
    return ok('journal', await call('POST', '/api/v1/gl/journals', {
      journal_book_id: book, voucher_date: date, description,
      lines: lines.map(([no, debit, credit]) => ({ account_id: id(no), ...(debit ? { debit } : {}), ...(credit ? { credit } : {}) })),
    }));
  };
  const tb = async () => {
    const r = ok('trial balance', await call('GET', '/api/v1/reports/trial-balance?from=2026-01-01&to=2026-12-31')) as { balanced: boolean; rows: Array<{ account_no: string; closing: string }> };
    return { balanced: r.balanced, moved: r.rows.filter((x) => x.closing !== '0.00').map((x) => `${x.account_no}:${x.closing}`).sort() };
  };

  it('creates two companies and posts a journal in each', async () => {
    const setup = await call('POST', '/api/v1/setup', { username: 'admin', display_name: 'ผู้ดูแล', password: 'secret123' });
    if (setup.status !== 200) ok('login', await call('POST', '/api/v1/auth/login', { username: 'admin', password: 'secret123' }));
    for (const k of ['A', 'B'] as const) {
      co[k] = ok(`company ${k}`, await call('POST', '/api/v1/companies', { code: `S0${k}${run}`, name_th: `บริษัท ทดสอบคลาวด์ ${k} จำกัด`, fiscal_start: '2026-01-01', chart: 'express' })).id;
    }
    ok('select A', await call('POST', '/api/v1/auth/select', { company_id: co.A }));
    expect((await journal([['1111-00', '1,000,000', ''], ['3100-00', '', '1000000']], '2026-01-05', 'ทุนจดทะเบียน')).voucher_no).toMatch(/^JV6901050/);
    await journal([['1111-00', '5000.25', ''], ['4100-11', '', '5000.25']], '2026-01-06', 'ขายสด');
    ok('select B', await call('POST', '/api/v1/auth/select', { company_id: co.B }));
    await journal([['1111-00', '777.77', ''], ['3100-00', '', '777.77']], '2026-02-01', 'ทุนบริษัท B');
  });

  it('trial balance of each company is its own journals only, to the satang', async () => {
    expect(await tb()).toEqual({ balanced: true, moved: ['1111-00:777.77', '3100-00:-777.77'] });
    ok('select A', await call('POST', '/api/v1/auth/select', { company_id: co.A }));
    expect(await tb()).toEqual({ balanced: true, moved: ['1111-00:1005000.25', '3100-00:-1000000.00', '4100-11:-5000.25'] });
  });

  it('row-level security: buddy_app scoped to A sees none of B, and cannot write into B', async () => {
    expect(await rlsAvailable(database)).toBe(true);
    const bypass = (await sql<{ b: boolean }>`SELECT rolbypassrls AS b FROM pg_roles WHERE rolname = 'buddy_app'`.execute(database.raw)).rows[0]!.b;
    expect(bypass).toBe(false);
    const count = async (q: string) => Number((await sql<{ n: number }>`${sql.raw(q)}`.execute(database.db)).rows[0]!.n);
    const tenant = (await sql<{ t: string }>`SELECT tenant_id AS t FROM sys_company WHERE id = ${co.A}`.execute(database.raw)).rows[0]!.t;
    const ownerB = await count(`SELECT count(*) AS n FROM gl_journal WHERE company_id = '${co.B}'`);
    expect(ownerB).toBe(1);
    await runInCompanyScope(database, { companyId: co.A, tenantId: tenant, isPlatform: false }, async () => {
      expect((await sql<{ r: string }>`SELECT current_user AS r`.execute(database.db)).rows[0]!.r).toBe('buddy_app');
      expect(await count(`SELECT count(*) AS n FROM gl_journal WHERE company_id = '${co.B}'`)).toBe(0);
      expect(await count(`SELECT count(*) AS n FROM gl_journal_line l JOIN gl_journal j ON j.id = l.journal_id WHERE j.company_id = '${co.B}'`)).toBe(0);
      expect(await count('SELECT count(*) AS n FROM gl_journal')).toBe(2);
      expect(await count(`SELECT count(*) AS n FROM v_trial_balance WHERE company_id <> '${co.A}'`)).toBe(0);
    });
    await expect(runInCompanyScope(database, { companyId: co.A, tenantId: tenant, isPlatform: false }, () =>
      sql`INSERT INTO md_department (company_id, code, name_th) VALUES (${co.B}, ${`S0${run}`}, 'เขียนข้ามบริษัท')`.execute(database.db))).rejects.toThrow(/row-level security/);
  });
});
