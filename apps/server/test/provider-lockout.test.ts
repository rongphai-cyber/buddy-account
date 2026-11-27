/**
 * HANDOFF 204 (เจ้าของ 27/11/2569 "ข้อ ข ... ไม่มีใครดูข้อมูลของลูกค้าได้ ... Admin จะทำได้กรณีข้อมูลตัวอย่างเพื่อให้ลูกค้าทดลองใช้ Demo แค่นั้น")
 * เจ้าหน้าที่ผู้ให้บริการ: อ่าน/เขียนข้อมูลบัญชีของลูกค้าจริงไม่ได้ทุกทาง (server ตรวจ ไม่ใช่แค่ซ่อนหน้าจอ) · ลูกค้าข้อมูลตัวอย่าง (is_demo) ใช้ได้
 * ศูนย์ผู้ให้บริการเห็นเฉพาะภาพรวม (บริษัท ผู้ใช้ แพ็กเกจ การใช้งาน) · ลิงก์ตั้งรหัสผ่านของลูกค้าจริงส่งทางอีเมลของลูกค้าเท่านั้น
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { openDatabase, type Database } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { flushMail, memoryMail, setMailDriver } from '../src/mail/index.js';

let database: Database;
let app: FastifyInstance;
let cookie = '';
type Res = { status: number; body: any; raw: string };   // eslint-disable-line @typescript-eslint/no-explicit-any
async function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown): Promise<Res> {
  const r = await app.inject({ method, url, payload: body as object, headers: cookie ? { cookie } : {} });
  const set = r.headers['set-cookie'];
  if (set) cookie = (Array.isArray(set) ? set[0]! : set).split(';')[0]!;
  return { status: r.statusCode, body: r.body && r.headers['content-type']?.toString().includes('json') ? JSON.parse(r.body) : null, raw: r.body };
}
const as = async (u: string, p: string) => { cookie = ''; const r = await call('POST', '/api/v1/auth/login', { username: u, password: p }); expect(r.status, JSON.stringify(r.body)).toBe(200); return cookie; };
const linkIn = (text: string) => /\/invite\/([A-Za-z0-9_-]{20,100})/.exec(text)?.[1];

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.BUDDY_REQUIRE_ADMIN_2FA = '0';
  process.env.BUDDY_SECRET_KEY ??= Buffer.alloc(32, 7).toString('base64');
  const cfg = { ...loadConfig({}), databaseUrl: undefined, dataDir: 'memory://' };
  database = await openDatabase(cfg);
  await migrate(database, cfg.migrationsDir, () => {});
  app = await buildApp(database, cfg);
  setMailDriver(memoryMail.driver);
}, 120_000);
afterAll(async () => { setMailDriver(null); await app?.close(); await database?.close(); });

describe('HANDOFF 204: ผู้ให้บริการไม่เห็น/ไม่แก้ข้อมูลบัญชีของลูกค้า', () => {
  const ids: Record<string, string> = {};
  let provider = '', custAdmin = '';
  const SECRET_PARTY = 'ลูกค้าลับเฉพาะ ABC จำกัด', SECRET_AMOUNT = '12345.67';

  it('setup: provider + demo DEFAULT (fresh install) · real customer CUST1 gets its first ADMIN only by emailed link · customer keys its own data', async () => {
    expect((await call('POST', '/api/v1/setup', { username: 'admin', display_name: 'ผู้ดูแลผู้ให้บริการ', password: 'secret123' })).status).toBe(200);
    provider = cookie;
    // เซิร์ฟเวอร์ใหม่: DEFAULT = ข้อมูลทดลอง → ผู้ให้บริการสร้าง/ใช้บริษัททดลองได้
    const demo = await call('POST', '/api/v1/companies', { code: 'DEMOCO', name_th: 'บริษัททดลอง', fiscal_start: '2026-01-01', chart: 'express' });
    expect(demo.status, demo.raw).toBe(200);
    ids.demoCo = demo.body.id;
    // ลูกค้าจริง: ตั้งรหัสผ่านให้ไม่ได้ · ต้องมีอีเมล · ลิงก์ส่งทางอีเมล ไม่อยู่ในคำตอบ
    const base = { code: 'CUST1', name: 'ลูกค้าจริง 1', admin_username: 'c1.admin', admin_name: 'ผู้ดูแล C1' };
    expect((await call('POST', '/api/v1/tenants', { ...base, contact_email: 'owner@cust1.example', admin_password: 'passC1234' })).body.error.message).toMatch(/ตั้งรหัสผ่านให้ผู้ดูแลของลูกค้าไม่ได้/);
    expect((await call('POST', '/api/v1/tenants', base)).body.error.message).toMatch(/ป้อนอีเมลผู้ติดต่อ/);
    memoryMail.outbox = [];
    const t = await call('POST', '/api/v1/tenants', { ...base, contact_email: 'owner@cust1.example' });
    expect(t.status, t.raw).toBe(200);
    ids.tenant = t.body.id;
    expect(t.raw).not.toMatch(/\/invite\//);
    expect(t.body.invite).toMatchObject({ emailed_to: 'ow***@cust1.example', mail_status: 'S' });
    const mail = memoryMail.outbox.at(-1)!;
    expect(mail.to).toEqual(['owner@cust1.example']);
    const token = linkIn(mail.text)!;
    expect(token).toBeTruthy();
    cookie = '';
    expect((await call('POST', `/api/v1/invite/${token}/accept`, { password: 'passC1234' })).status).toBe(200);
    custAdmin = await as('c1.admin', 'passC1234');
    // ลูกค้าสร้างบริษัทและข้อมูลของตัวเอง
    const co = await call('POST', '/api/v1/companies', { code: 'C1CO', name_th: 'บริษัท ลูกค้าหนึ่ง จำกัด', fiscal_start: '2026-01-01', chart: 'express' });
    expect(co.status, co.raw).toBe(200);
    ids.co = co.body.id;
    await call('POST', '/api/v1/auth/select', { company_id: ids.co });
    expect((await call('PUT', '/api/v1/settings', { values: { 'gen.allow_blank_party_tax_id': true } })).status).toBe(200);
    const party = await call('POST', '/api/v1/customers', { code: 'S1', name: SECRET_PARTY });
    expect(party.status, party.raw).toBe(200);
    const book = (await call('GET', '/api/v1/gl/books')).body[0].id;
    const acc = (await call('GET', '/api/v1/gl/accounts')).body.filter((x: { is_control: boolean }) => !x.is_control);
    const jv = await call('POST', '/api/v1/gl/journals', { journal_book_id: book, voucher_date: '2026-03-01', lines: [{ account_id: acc[0].id, debit: SECRET_AMOUNT }, { account_id: acc[1].id, credit: SECRET_AMOUNT }] });
    expect(jv.status, jv.raw).toBe(200);
    ids.custUser = (await call('GET', '/api/v1/auth/me')).body.user.id;
    // ผู้ใช้ทั่วไปของลูกค้า (ผู้ดูแลของลูกค้าสร้างเอง)
    const u = await call('POST', '/api/v1/users', { username: 'c1.clerk', display_name: 'พนักงาน C1', password: 'clerkC1234', companies: [ids.co] });
    expect(u.status, u.raw).toBe(200);
    ids.clerk = u.body.id;
  });

  it('provider never sees or selects a real customer company — switcher lists demo only, select = 403, stale session = 403 on every data API (read and write)', async () => {
    cookie = provider;
    const me = (await call('GET', '/api/v1/auth/me')).body;
    expect(me.companies.map((c: { code: string }) => c.code)).toEqual(['DEMOCO']);
    expect(me.companies[0]).toMatchObject({ tenant_code: 'DEFAULT' });
    const sel = await call('POST', '/api/v1/auth/select', { company_id: ids.co });
    expect(sel.status).toBe(403);
    expect(sel.body.error.message).toMatch(/ผู้ให้บริการเปิดข้อมูลบัญชีของลูกค้าไม่ได้/);
    // session ที่ค้างบริษัทลูกค้า (เช่น เลือกไว้ก่อนอัปเดต) — ถูกตัดทุกคำขอ
    await sql`UPDATE sys_session SET current_company_id = ${ids.co} WHERE ended_at IS NULL AND user_id = (SELECT id FROM sys_user WHERE username = 'admin')`.execute(database.db);
    const urls: Array<[string, string, unknown?]> = [
      ['GET', '/api/v1/customers'], ['GET', '/api/v1/gl/accounts'], ['GET', '/api/v1/gl/journals'], ['GET', '/api/v1/sales-invoices'], ['GET', '/api/v1/items'],
      ['GET', '/api/v1/settings'], ['GET', '/api/v1/company'], ['GET', '/api/v1/permissions/by-menu?menu_code=ALL'],
      ['POST', '/api/v1/customers', { code: 'X1', name: 'แอบเพิ่ม' }], ['POST', '/api/v1/gl/journals', {}], ['POST', '/api/v1/backup/company', {}], ['PUT', '/api/v1/settings', { values: {} }],
    ];
    for (const [m, url, b] of urls) {
      const r = await call(m as 'GET', url, b);
      expect([url, r.status]).toEqual([url, 403]);
      expect(r.raw).not.toContain(SECRET_PARTY);
      expect(r.raw).not.toContain(SECRET_AMOUNT);
    }
    // /auth/me ไม่ค้างบริษัทลูกค้า
    expect((await call('GET', '/api/v1/auth/me')).body.company?.code ?? null).not.toBe('C1CO');
  });

  it('provider is refused on every explicit-id route into a real customer (copy, rename, delete, restore, new company, users, groups, viewer, export, Express import) — logged-in customer admin unaffected', async () => {
    cookie = provider;
    const r = async (m: string, url: string, b?: unknown) => ({ url: `${m} ${url}`, ...(await call(m as 'POST', url, b)) });
    const refused = [
      await r('POST', `/api/v1/companies/${ids.co}/copy`, { code: 'STEAL', name_th: 'x', mode: 'full' }),
      await r('PUT', `/api/v1/companies/${ids.co}/code`, { code: 'C1X' }),
      await r('POST', `/api/v1/companies/${ids.co}/delete`, { confirm_code: 'C1CO' }),
      await r('POST', `/api/v1/companies/${ids.co}/restore`),
      await r('POST', '/api/v1/companies', { code: 'C1NEW', name_th: 'x', fiscal_start: '2026-01-01', chart: 'express', tenant_id: ids.tenant }),
      await r('POST', '/api/v1/companies', { code: 'C1CP', name_th: 'x', chart: 'copy', copy_from_company_id: ids.co, copy_scope: 'full', tenant_id: ids.tenant }),
      await r('POST', '/api/v1/users', { username: 'spy', display_name: 'x', password: 'spyPass123', companies: [ids.co], tenant_id: ids.tenant }),
      await r('PUT', `/api/v1/users/${ids.clerk}`, { username: 'c1.clerk', display_name: 'พนักงาน C1', password: 'takeOver123', companies: [ids.co] }),
      await r('POST', '/api/v1/user-groups', { code: 'SPY', name: 'x', tenant_id: ids.tenant }),
      await r('POST', `/api/v1/tenants/${ids.tenant}/viewers`, { username: 'peek', display_name: 'x', password: 'peekPass123' }),
      await r('POST', `/api/v1/tenants/${ids.tenant}/export`, { passphrase: 'provider-pass-123' }),
      await r('POST', '/api/v1/express-import/jobs', { code: 'EXPX', tenant_id: ids.tenant }),
    ];
    expect(refused.map((x) => [x.url, x.status])).toEqual(refused.map((x) => [x.url, 403]));
    for (const x of refused) expect(x.body.error.message).toMatch(/ผู้ให้บริการเปิดข้อมูลบัญชีของลูกค้าไม่ได้|ส่งออกแฟ้มย้ายได้/);
    // บริษัทลูกค้าไม่อยู่ในรายการบริษัททั้งหมดของผู้ให้บริการ
    expect((await call('GET', '/api/v1/companies/manage')).body.rows.map((x: { code: string }) => x.code)).toEqual(['DEMOCO']);
    // แฟ้มบันทึกเหตุการณ์: ไม่เห็นเหตุการณ์ในบริษัทของลูกค้า
    const log = (await call('GET', '/api/v1/activity-log?limit=500')).body as Array<{ doc_no: string | null; detail: unknown }>;
    expect(JSON.stringify(log)).not.toContain(SECRET_PARTY);
    expect((await call('GET', '/api/v1/activity-log/search?limit=5000')).raw).not.toContain('C1CO');
    // ลูกค้าเองทำได้ปกติ: ส่งออกแฟ้มย้ายของตัวเอง
    cookie = custAdmin;
    const ex = await app.inject({ method: 'POST', url: `/api/v1/tenants/${ids.tenant}/export`, payload: { passphrase: 'customer-pass-123' }, headers: { cookie } });
    expect(ex.statusCode).toBe(200);
    expect((await call('GET', '/api/v1/customers')).body.rows?.length ?? (await call('GET', '/api/v1/customers')).body.length).toBeGreaterThan(0);
  });

  it('password help only by email to the customer: invite link never shown to the provider, 2FA reset notifies the customer, 7-day cool-down after a contact-email change', async () => {
    cookie = provider;
    memoryMail.outbox = [];
    const inv = await call('POST', `/api/v1/users/${ids.clerk}/invite`);
    expect(inv.status, inv.raw).toBe(200);
    expect(inv.raw).not.toMatch(/\/invite\//);
    expect(inv.body).toMatchObject({ emailed_to: 'ow***@cust1.example', username: 'c1.clerk' });
    expect(linkIn(memoryMail.outbox.at(-1)!.text)).toBeTruthy();
    expect(memoryMail.outbox.at(-1)!.to).toEqual(['owner@cust1.example']);
    const viaConsole = await call('POST', `/api/v1/provider/users/${ids.clerk}/email-invite`);
    expect(viaConsole.status, viaConsole.raw).toBe(200);
    expect(viaConsole.raw).not.toMatch(/\/invite\//);
    // ล้าง 2FA ได้ (บัญชี) + แจ้งลูกค้า
    memoryMail.outbox = [];
    expect((await call('POST', `/api/v1/users/${ids.clerk}/reset-2fa`)).status).toBe(200);
    await flushMail();
    expect(memoryMail.outbox.map((m) => m.subject).join('|')).toMatch(/ล้างการยืนยันตัวตนสองขั้นของ c1\.clerk/);
    // เปลี่ยนอีเมลลูกค้าเป็นของตัวเอง → แจ้งอีเมลเดิม · ส่งลิงก์ไปอีเมลใหม่ไม่ได้ 7 วัน
    const t = (await call('GET', '/api/v1/tenants')).body.find((x: { id: string }) => x.id === ids.tenant);
    memoryMail.outbox = [];
    expect((await call('PUT', `/api/v1/tenants/${ids.tenant}`, { ...t, contact_email: 'attacker@provider.example', package_id: undefined })).status).toBe(200);
    await flushMail();
    expect(memoryMail.outbox.map((m) => m.to.join()).join('|')).toContain('owner@cust1.example');
    const blocked = await call('POST', `/api/v1/users/${ids.clerk}/invite`);
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.message).toMatch(/เพิ่งเปลี่ยน/);
    expect(memoryMail.outbox.some((m) => m.to.includes('attacker@provider.example') && /\/invite\//.test(m.text))).toBe(false);
  });

  it('provider console: grouped customers with metadata only (companies code/name, users, package, usage, switches, API keys) — no amounts, no party names', async () => {
    cookie = provider;
    const list = await call('GET', '/api/v1/provider/customers');
    expect(list.status).toBe(200);
    const c1 = list.body.rows.find((x: { code: string }) => x.code === 'CUST1');
    expect(c1).toMatchObject({ is_demo: false, company_count: 1, companies: [{ code: 'C1CO', name: 'บริษัท ลูกค้าหนึ่ง จำกัด' }] });
    expect(list.body.rows.find((x: { code: string }) => x.code === 'DEFAULT')).toMatchObject({ is_demo: true });
    const d = await call('GET', `/api/v1/provider/customers/${ids.tenant}`);
    expect(d.status, d.raw).toBe(200);
    expect(d.body.users.map((u: { username: string }) => u.username).sort()).toEqual(['c1.admin', 'c1.clerk']);
    expect(d.body.users.find((u: { username: string }) => u.username === 'c1.admin')).toMatchObject({ group_code: 'ADMIN', totp_enabled: false });
    expect(d.body.features.map((f: { key: string }) => f.key)).toContain('api_keys');
    expect(d.body.usage.usage.docs).toBeGreaterThan(0);   // นับจำนวนได้
    for (const raw of [list.raw, d.raw]) {
      expect(raw).not.toContain(SECRET_PARTY);
      expect(raw).not.toContain(SECRET_AMOUNT);
      expect(raw).not.toContain('owner@cust1.example');   // อีเมลแสดงแบบปิดบัง
    }
    // ลูกค้าเรียกศูนย์ผู้ให้บริการไม่ได้
    cookie = custAdmin;
    expect((await call('GET', '/api/v1/provider/customers')).status).toBe(403);
    expect((await call('GET', `/api/v1/provider/customers/${ids.tenant}`)).status).toBe(403);
    expect((await call('PUT', `/api/v1/provider/customers/${ids.tenant}/demo`, { is_demo: true, confirm: 'CUST1' })).status).toBe(403);
  });

  it('demo flag: provider only, typed-code confirm, logged — on = provider may open that customer, off = locked again; DEMO is flagged by the migration', async () => {
    cookie = provider;
    expect((await call('PUT', `/api/v1/provider/customers/${ids.tenant}/demo`, { is_demo: true })).body.error.message).toMatch(/พิมพ์รหัสลูกค้า CUST1/);
    expect((await call('PUT', `/api/v1/provider/customers/${ids.tenant}/demo`, { is_demo: true, confirm: 'cust1' })).status).toBe(200);
    expect((await call('POST', '/api/v1/auth/select', { company_id: ids.co })).status).toBe(200);
    expect((await call('GET', '/api/v1/customers')).status).toBe(200);
    expect((await call('PUT', `/api/v1/provider/customers/${ids.tenant}/demo`, { is_demo: false })).status).toBe(200);
    expect((await call('GET', '/api/v1/customers')).status).toBe(403);
    const acts = (await sql<{ action: string }>`SELECT action FROM sys_activity_log WHERE row_id = ${ids.tenant} AND action LIKE 'TENANT_DEMO_%' ORDER BY seq`.execute(database.db)).rows.map((x) => x.action);
    expect(acts).toEqual(['TENANT_DEMO_ON', 'TENANT_DEMO_OFF']);
    // 0085: DEMO = ข้อมูลตัวอย่าง (ชุดทดสอบไม่มี DEMO — ตรวจว่ากติกาในแฟ้มตั้งเฉพาะ DEMO)
    const { readFile } = await import('node:fs/promises');
    const m = await readFile(new URL('../../../db/migrations/0085_provider_lockout.sql', import.meta.url), 'utf8');
    expect(m).toMatch(/UPDATE sys_tenant SET is_demo = true WHERE code = 'DEMO'/);
    // provider ใช้บริษัททดลองได้ตามปกติ
    expect((await call('POST', '/api/v1/auth/select', { company_id: ids.demoCo })).status).toBe(200);
    expect((await call('GET', '/api/v1/customers')).status).toBe(200);
    expect((await call('POST', '/api/v1/departments', { code: 'D1', name_th: 'แผนกทดลอง' })).status).toBe(200);
  });

  it('API keys (ข้อ d4): customer ADMIN creates keys once the provider switches "api_keys" on; provider never gets the key of a real customer', async () => {
    cookie = custAdmin;
    await call('POST', '/api/v1/auth/select', { company_id: ids.co });
    expect((await call('POST', '/api/v1/api-keys', { name: 'POS', user_id: ids.custUser })).status).toBe(403);
    cookie = provider;
    expect((await call('PUT', `/api/v1/tenants/${ids.tenant}/modules`, { modules: [{ key: 'api_keys', enabled: true }] })).status).toBe(200);
    cookie = custAdmin;
    const k = await call('POST', '/api/v1/api-keys', { name: 'POS', user_id: ids.custUser });
    expect(k.status, k.raw).toBe(200);
    expect(k.body.key).toMatch(/^bak_|./);
    cookie = provider;
    const d = (await call('GET', `/api/v1/provider/customers/${ids.tenant}`)).raw;
    expect(d).toContain('"name":"POS"');
    expect(d).not.toContain(k.body.key);
  });
});
