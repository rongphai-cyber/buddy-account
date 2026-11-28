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
import { setSec } from '../src/modules/security.js';

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
    // N3: อีเมลผู้ติดต่อที่ผู้ให้บริการพิมพ์ตอนสร้างลูกค้า = "เพิ่งตั้ง" — ลิงก์จากผู้ให้บริการได้หลัง 7 วัน (ยกเว้นลิงก์ผู้ดูแลคนแรกตอนสร้าง)
    expect((await call('POST', `/api/v1/provider/users/${ids.clerk}/email-invite`)).body.error.message).toMatch(/เพิ่งเปลี่ยน/);
    await sql`UPDATE sys_tenant SET contact_email_changed_at = now() - interval '8 days' WHERE id = ${ids.tenant}`.execute(database.db);
    memoryMail.outbox = [];
    const inv = await call('POST', `/api/v1/provider/users/${ids.clerk}/email-invite`);
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
    expect((await call('POST', `/api/v1/provider/users/${ids.clerk}/reset-2fa`)).status).toBe(200);   // HANDOFF 206: ศูนย์ผู้ให้บริการ
    await flushMail();
    expect(memoryMail.outbox.map((m) => m.subject).join('|')).toMatch(/ล้างการยืนยันตัวตนสองขั้นของ c1\.clerk/);
    // C3: ผู้ให้บริการเปลี่ยนอีเมล/โทรผู้ติดต่อของลูกค้าจริงไม่ได้ (ค่าที่เห็นเป็นแบบปิดบัง — ส่งคืนเดิม = ไม่เปลี่ยน)
    const t = (await call('GET', '/api/v1/tenants')).body.find((x: { id: string }) => x.id === ids.tenant);
    expect(t.contact_email).toBe('ow***@cust1.example');   // M2: ปิดบัง
    const hijack = await call('PUT', `/api/v1/tenants/${ids.tenant}`, { ...t, contact_email: 'attacker@provider.example', package_id: undefined });
    expect(hijack.status).toBe(403);
    expect(hijack.body.error.message).toMatch(/ผู้ให้บริการเปลี่ยนไม่ได้/);
    expect((await call('PUT', `/api/v1/tenants/${ids.tenant}`, { ...t, package_id: undefined })).status).toBe(200);   // ค่าแบบปิดบังเดิม = ไม่เปลี่ยน
    expect((await sql<{ e: string }>`SELECT contact_email AS e FROM sys_tenant WHERE id = ${ids.tenant}`.execute(database.db)).rows[0]!.e).toBe('owner@cust1.example');
    // ผู้ให้บริการใช้ทางของลูกค้าไม่ได้ (HANDOFF 208: ทางนี้ = ลูกค้าเจ้าของบริษัทที่เลือกอยู่ เฉพาะข้อมูลตัวอย่าง — ยังไม่เลือกบริษัท/ลูกค้าจริง = 403)
    await sql`UPDATE sys_session SET current_company_id = NULL WHERE ended_at IS NULL AND user_id = (SELECT id FROM sys_user WHERE username = 'admin')`.execute(database.db);
    expect((await call('PUT', '/api/v1/tenant/contact', { contact_email: 'attacker@provider.example' })).status).toBe(403);
    // ผู้ดูแลของลูกค้าเปลี่ยนเอง → แจ้งอีเมลเดิมและใหม่ · ลิงก์จากผู้ให้บริการไปอีเมลใหม่ได้หลัง 7 วัน
    cookie = custAdmin;
    memoryMail.outbox = [];
    expect((await call('PUT', '/api/v1/tenant/contact', { contact_email: 'finance@cust1.example' })).status).toBe(200);
    await flushMail();
    expect(memoryMail.outbox.map((m) => m.to.join()).sort()).toEqual(['finance@cust1.example', 'owner@cust1.example']);
    cookie = provider;
    const blocked = await call('POST', `/api/v1/provider/users/${ids.clerk}/email-invite`);
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.message).toMatch(/เพิ่งเปลี่ยน/);
    await sql`UPDATE sys_tenant SET contact_email_changed_at = now() - interval '8 days' WHERE id = ${ids.tenant}`.execute(database.db);
    memoryMail.outbox = [];
    expect((await call('POST', `/api/v1/provider/users/${ids.clerk}/email-invite`)).body).toMatchObject({ emailed_to: 'fi***@cust1.example' });
    expect(memoryMail.outbox.at(-1)!.to).toEqual(['finance@cust1.example']);
    // ลูกค้าไม่มีอีเมล = ปฏิเสธ (ไม่ส่งที่อื่น)
    await sql`UPDATE sys_tenant SET contact_email = NULL WHERE id = ${ids.tenant}`.execute(database.db);
    expect((await call('POST', `/api/v1/provider/users/${ids.clerk}/email-invite`)).body.error.message).toMatch(/ยังไม่มีอีเมลผู้ติดต่อ/);
    await sql`UPDATE sys_tenant SET contact_email = 'owner@cust1.example', contact_email_changed_at = now() - interval '8 days' WHERE id = ${ids.tenant}`.execute(database.db);
  });

  it('HANDOFF 206/208: users page — provider (sample company selected) lists only that customer (no provider staff); a real customer\'s users/groups cannot be read, edited, invited, unlocked or reset there (403 PROVIDER_LOCKED / 404) — only via the provider console · customer admin unchanged', async () => {
    cookie = provider;
    const dClerk = await call('POST', '/api/v1/users', { username: 'demo.clerk', display_name: 'พนักงานทดลอง', password: 'demoClerk123', companies: [ids.demoCo] });
    expect(dClerk.status, dClerk.raw).toBe(200);
    const cGroup = (await sql<{ id: string }>`SELECT id FROM sys_user_group WHERE tenant_id = ${ids.tenant} AND code = 'ADMIN' AND deleted_at IS NULL`.execute(database.db)).rows[0]!.id;
    // ยังไม่เลือกบริษัท = เฉพาะเจ้าหน้าที่ผู้ให้บริการ
    await sql`UPDATE sys_session SET current_company_id = NULL WHERE ended_at IS NULL AND user_id = (SELECT id FROM sys_user WHERE username = 'admin')`.execute(database.db);
    const none = (await call('GET', '/api/v1/users')).body;
    expect(none.users.map((u: { username: string }) => u.username)).toEqual(['admin']);
    expect(none.groups.every((g: { tenant_id: string | null }) => g.tenant_id === null)).toBe(true);
    // เลือกบริษัทข้อมูลตัวอย่าง = ผู้ใช้/กลุ่มของลูกค้าตัวอย่างนั้น + เจ้าหน้าที่ — ไม่มีของลูกค้าจริง
    expect((await call('POST', '/api/v1/auth/select', { company_id: ids.demoCo })).status).toBe(200);
    const list = await call('GET', '/api/v1/users');
    expect(list.status).toBe(200);
    expect(list.body.users.map((u: { username: string }) => u.username).sort()).toEqual(['demo.clerk']);   // HANDOFF 208: ไม่ปนเจ้าหน้าที่
    expect(list.body.groups.some((g: { tenant_id: string | null }) => g.tenant_id === ids.tenant)).toBe(false);
    expect(list.raw).not.toMatch(/c1\.(admin|clerk)|CUST1/);
    expect((await call('GET', '/api/v1/users?for=company')).raw).not.toMatch(/c1\.(admin|clerk)/);
    // อ่าน/แก้/เชิญ/ปลดล็อก/ล้าง 2FA ผู้ใช้หรือกลุ่มของลูกค้าจริงจากหน้านี้ไม่ได้
    const locked = [
      ['PUT', `/api/v1/users/${ids.clerk}`, { username: 'c1.clerk', display_name: 'x', companies: [ids.co] }],
      ['PUT', `/api/v1/user-groups/${cGroup}`, { name: 'x' }], ['DELETE', `/api/v1/user-groups/${cGroup}`],
      ['POST', `/api/v1/users/${ids.clerk}/invite`], ['DELETE', `/api/v1/users/${ids.clerk}/invite`],
      ['POST', `/api/v1/users/${ids.clerk}/unlock`], ['POST', `/api/v1/users/${ids.clerk}/reset-2fa`],
    ] as Array<[string, string, unknown?]>;
    for (const [m, url, b] of locked) {
      const r = await call(m as 'POST', url, b);
      expect([m, url, r.status, r.body?.error?.code]).toEqual([m, url, 403, 'PROVIDER_LOCKED']);
    }
    for (const [type, id] of [['U', ids.clerk], ['G', cGroup]]) {
      const r = await call('GET', `/api/v1/permissions?subject_type=${type}&subject_id=${id}`);
      expect(r.status).toBe(404);
      expect(r.raw).not.toMatch(/c1\.clerk|ADMIN/);
      expect((await call('PUT', '/api/v1/permissions', { subject_type: type, subject_id: id, rows: [] })).status).toBe(404);
    }
    const key = await call('POST', '/api/v1/api-keys', { name: 'x', user_id: ids.clerk });
    expect(key.status).toBe(404);
    // ผู้ใช้ของลูกค้าตัวอย่าง = ทำได้ตามปกติ
    expect((await call('POST', `/api/v1/users/${dClerk.body.id}/unlock`)).status).toBe(200);
    // ศูนย์ผู้ให้บริการ: ปลดล็อกผู้ใช้ของลูกค้าจริงได้ (ช่วยเหลือ — ไม่เห็นข้อมูล)
    expect((await call('POST', `/api/v1/provider/users/${ids.clerk}/unlock`)).status).toBe(200);
    // ผู้ดูแลของลูกค้า: เห็นผู้ใช้ของตัวเองเหมือนเดิม · ไม่เห็นเจ้าหน้าที่/ลูกค้าอื่น · ทางของผู้ให้บริการใช้ไม่ได้
    cookie = custAdmin;
    const mine = (await call('GET', '/api/v1/users')).body;
    expect(mine.users.map((u: { username: string }) => u.username).sort()).toEqual(['c1.admin', 'c1.clerk']);
    expect(mine.groups.every((g: { tenant_id: string }) => g.tenant_id === ids.tenant)).toBe(true);
    expect((await call('POST', `/api/v1/users/${ids.clerk}/unlock`)).status).toBe(200);
    expect((await call('POST', `/api/v1/provider/users/${ids.clerk}/unlock`)).status).toBe(403);
    expect((await call('POST', `/api/v1/users/${dClerk.body.id}/unlock`)).status).toBe(404);
  });

  it('HANDOFF 208: provider on a sample company gets the customer-admin users page (only that customer, security + contact boxes); real customer refused (read and write); staff managed at the provider centre', async () => {
    cookie = provider;
    expect((await call('POST', '/api/v1/auth/select', { company_id: ids.demoCo })).status).toBe(200);
    const demoT = (await sql<{ t: string }>`SELECT tenant_id AS t FROM sys_company WHERE id = ${ids.demoCo}`.execute(database.db)).rows[0]!.t;
    // ข) รายการผู้ใช้/กลุ่ม = ลูกค้าตัวอย่างนี้เท่านั้น (เหมือนผู้ดูแลของลูกค้า) — ไม่มีเจ้าหน้าที่ · จำนวนกลุ่มตรงกับรายการ
    const page = (await call('GET', '/api/v1/users')).body;
    expect(page.users.length).toBeGreaterThan(0);
    expect(page.users.every((u: { tenant_id: string | null }) => u.tenant_id === demoT)).toBe(true);
    expect(page.users.map((u: { username: string }) => u.username)).not.toContain('admin');
    expect(page.groups.every((g: { tenant_id: string | null }) => g.tenant_id === demoT)).toBe(true);
    // เจ้าหน้าที่: ศูนย์ผู้ให้บริการ › เจ้าหน้าที่ผู้ให้บริการ (?for=staff) · กุญแจ API เลือกเจ้าหน้าที่ ADMIN ได้ (?for=with_staff)
    const staff = (await call('GET', '/api/v1/users?for=staff')).body;
    expect(staff.users.map((u: { username: string }) => u.username)).toContain('admin');
    expect([...staff.users, ...staff.groups].every((x: { tenant_id: string | null }) => x.tenant_id === null)).toBe(true);
    expect((await call('GET', '/api/v1/users?for=with_staff')).body.users.map((u: { username: string }) => u.username)).toEqual(expect.arrayContaining(['admin', 'demo.clerk']));
    const staffAdmin = staff.groups.find((g: { code: string }) => g.code === 'ADMIN').id;
    const s2 = await call('POST', '/api/v1/users', { username: 'staff.two', display_name: 'เจ้าหน้าที่ 2', password: 'staffTwo1234', user_group_id: staffAdmin, tenant_id: null, companies: [] });
    expect(s2.status, s2.raw).toBe(200);
    expect((await sql<{ t: string | null }>`SELECT tenant_id AS t FROM sys_user WHERE id = ${s2.body.id}`.execute(database.db)).rows[0]!.t).toBeNull();
    expect((await call('PUT', `/api/v1/users/${s2.body.id}`, { username: 'staff.two', display_name: 'เจ้าหน้าที่ สอง', user_group_id: staffAdmin, companies: [], status: 'I' })).status).toBe(200);
    expect((await call('POST', `/api/v1/users/${s2.body.id}/unlock`)).status).toBe(200);
    expect((await call('GET', '/api/v1/users')).raw).not.toMatch(/staff\.two/);
    // ก) กล่อง ความปลอดภัยการเข้าระบบ + อีเมลผู้ติดต่อของกิจการ — ของลูกค้าตัวอย่างนี้
    const sec = await call('GET', '/api/v1/tenant/security');
    expect(sec.status, sec.raw).toBe(200);
    expect(sec.body.users).toBe(page.users.filter((u: { status: string }) => u.status === 'A').length);
    expect((await call('PUT', '/api/v1/tenant/security', { require_mfa: true })).body.require_mfa).toBe(true);
    expect((await sql<{ m: boolean }>`SELECT require_mfa AS m FROM sys_tenant WHERE id = ${demoT}`.execute(database.db)).rows[0]!.m).toBe(true);
    expect((await call('PUT', '/api/v1/tenant/security', { require_mfa: false })).status).toBe(200);
    const contact = await call('GET', '/api/v1/tenant/contact');
    expect(contact.status, contact.raw).toBe(200);
    expect(contact.body.code).toBe('DEFAULT');
    // เปลี่ยนอีเมลต้องใช้รหัสยืนยันตัวตนสองขั้นของเจ้าหน้าที่ (เหมือนผู้ดูแลของลูกค้า)
    const me = (await call('GET', '/api/v1/auth/me')).body.user.id;
    await setSec(database.db, me, { totp_enabled: true, totp_secret_enc: 'x' });
    const noCode = await call('PUT', '/api/v1/tenant/contact', { contact_email: 'demo@sample.example' });
    expect([noCode.status, noCode.body.error.code]).toEqual([400, 'MFA_REQUIRED']);
    await setSec(database.db, me, { totp_enabled: false, totp_secret_enc: null });
    expect((await call('PUT', '/api/v1/tenant/contact', { contact_email: 'demo@sample.example' })).body).toMatchObject({ ok: true, changed: true });
    expect((await call('GET', '/api/v1/tenant/contact')).body.contact_email).toBe('demo@sample.example');
    // ลูกค้าจริง: อ่าน/เขียนไม่ได้ (session ที่ค้างบริษัทลูกค้า · ยังไม่เลือกบริษัท) — ค่าในฐานข้อมูลไม่เปลี่ยน
    const before = (await sql<{ e: string; m: boolean }>`SELECT contact_email AS e, require_mfa AS m FROM sys_tenant WHERE id = ${ids.tenant}`.execute(database.db)).rows[0]!;
    for (const company of [ids.co, null]) {
      await sql`UPDATE sys_session SET current_company_id = ${company} WHERE ended_at IS NULL AND user_id = ${me}`.execute(database.db);
      for (const [m, url, b] of [['GET', '/api/v1/tenant/security'], ['PUT', '/api/v1/tenant/security', { require_mfa: true }], ['GET', '/api/v1/tenant/contact'], ['PUT', '/api/v1/tenant/contact', { contact_email: 'attacker@provider.example' }]] as Array<[string, string, unknown?]>) {
        const r = await call(m as 'GET', url, b);
        expect([String(company), m, url, r.status]).toEqual([String(company), m, url, 403]);
        expect(r.raw).not.toMatch(/cust1\.example|CUST1/);
      }
    }
    expect((await sql<{ e: string; m: boolean }>`SELECT contact_email AS e, require_mfa AS m FROM sys_tenant WHERE id = ${ids.tenant}`.execute(database.db)).rows[0]).toEqual(before);
    // ผู้ดูแลของลูกค้า: รายการเจ้าหน้าที่ไม่ได้ · กล่องของตัวเองเหมือนเดิม
    cookie = custAdmin;
    expect((await call('GET', '/api/v1/users?for=staff')).status).toBe(403);
    expect((await call('GET', '/api/v1/users?for=with_staff')).raw).not.toMatch(/"admin"|staff\.two|demo\.clerk/);
    expect((await call('GET', '/api/v1/tenant/contact')).body.code).toBe('CUST1');
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

  it('demo flag (N1): never switched ON for an existing tenant (403, even empty); only created as a provider sample (shown with the banner flag) or by migration; OFF works, is logged in the customer\'s own log and emailed; signup can never be demo', async () => {
    cookie = provider;
    // ลูกค้าจริงที่มีข้อมูล และลูกค้าว่างที่เพิ่งสร้าง — เปิดเป็นข้อมูลตัวอย่างไม่ได้ทั้งคู่
    expect((await call('PUT', `/api/v1/provider/customers/${ids.tenant}/demo`, { is_demo: true })).status).toBe(403);
    const t2 = await call('POST', '/api/v1/tenants', { code: 'CUST2', name: 'ลูกค้าว่าง 2', contact_email: 'owner@cust2.example', admin_username: 'c2.admin', admin_name: 'ผู้ดูแล C2' });
    expect(t2.status, t2.raw).toBe(200);
    ids.tenant2 = t2.body.id;
    const on = await call('PUT', `/api/v1/provider/customers/${ids.tenant2}/demo`, { is_demo: true });
    expect(on.status).toBe(403);
    expect(on.body.error.message).toMatch(/ตั้งลูกค้าที่มีอยู่แล้ว \(CUST2\) เป็นข้อมูลตัวอย่างไม่ได้/);
    expect((await sql<{ d: boolean }>`SELECT is_demo AS d FROM sys_tenant WHERE id = ${ids.tenant2}`.execute(database.db)).rows[0]!.d).toBe(false);
    // สร้างเป็นลูกค้าตัวอย่างของผู้ให้บริการได้ → บริษัทในนั้นมีเครื่องหมายข้อมูลตัวอย่าง (ป้ายทุกหน้า)
    const s3 = await call('POST', '/api/v1/tenants', { is_demo: true, code: 'SAMPLE3', name: 'ตัวอย่าง 3', contact_email: 'sample3@provider.example', admin_username: 's3.admin', admin_name: 'ผู้ดูแลตัวอย่าง', admin_password: 'sampleS3pass' });
    expect(s3.status, s3.raw).toBe(200);
    const s3co = await call('POST', '/api/v1/companies', { code: 'S3CO', name_th: 'บริษัทตัวอย่างสาม', fiscal_start: '2026-01-01', chart: 'express', tenant_id: s3.body.id });
    expect(s3co.status, s3co.raw).toBe(200);
    const me = (await call('GET', '/api/v1/auth/me')).body;
    expect(me.companies.find((c: { code: string }) => c.code === 'S3CO')).toMatchObject({ tenant_demo: true });
    const sAdmin = await as('s3.admin', 'sampleS3pass');
    expect((await call('GET', '/api/v1/auth/me')).body.companies[0]).toMatchObject({ code: 'S3CO', tenant_demo: true });   // ผู้ใช้ในลูกค้าตัวอย่างเห็นป้าย
    expect(sAdmin).toBeTruthy();
    // เลิกเป็นข้อมูลตัวอย่างได้ → ผู้ให้บริการเข้าไม่ได้อีก · บันทึกในแฟ้มของบริษัท + อีเมล · ตั้งกลับไม่ได้
    cookie = provider;
    memoryMail.outbox = [];
    expect((await call('PUT', `/api/v1/provider/customers/${s3.body.id}/demo`, { is_demo: false })).status).toBe(200);
    expect((await call('POST', '/api/v1/auth/select', { company_id: s3co.body.id })).status).toBe(403);
    expect((await call('PUT', `/api/v1/provider/customers/${s3.body.id}/demo`, { is_demo: true })).status).toBe(403);
    const acts = (await sql<{ action: string; company_id: string | null }>`SELECT action, company_id::text AS company_id FROM sys_activity_log WHERE row_id = ${s3.body.id} AND action LIKE 'TENANT_DEMO_%' ORDER BY seq`.execute(database.db)).rows;
    expect(acts.map((x) => x.action)).toEqual(['TENANT_DEMO_OFF', 'TENANT_DEMO_OFF']);   // ระบบ + แฟ้มของบริษัท S3CO
    expect(acts.some((x) => x.company_id === s3co.body.id)).toBe(true);
    await flushMail();
    expect(memoryMail.outbox.filter((m) => m.to.includes('sample3@provider.example')).map((m) => m.subject).join('|')).toMatch(/เลิกเป็นข้อมูลตัวอย่าง/);
    // ทางสร้างลูกค้าจริง (อนุมัติใบสมัคร ใช้ createTenantWithAdmin) ไม่มีทางเป็นข้อมูลตัวอย่าง + จดเวลาอีเมลผู้ติดต่อ
    const { createTenantWithAdmin } = await import('../src/modules/signup.js');
    const viaSignup = await database.db.transaction().execute((tx) => createTenantWithAdmin(tx, null, { code: 'SIGNUP4', name: 'สมัครเอง 4', contact_email: 'own@signup4.example', admin_username: 'sg4.admin', admin_name: 'ผู้สมัคร', password_hash: null }));
    expect((await sql<{ d: boolean; c: string | null }>`SELECT is_demo AS d, contact_email_changed_at::text AS c FROM sys_tenant WHERE id = ${viaSignup.id}`.execute(database.db)).rows[0]).toMatchObject({ d: false, c: expect.any(String) });
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

  it('company move (C2): never into a demo tenant; out of demo only if empty; real → real only after the SOURCE customer ADMIN confirms in their own session', async () => {
    cookie = provider;
    const into = await call('POST', `/api/v1/tenants/${ids.tenant}/move-companies`, { target_tenant_id: (await call('GET', '/api/v1/provider/customers')).body.rows.find((x: { code: string }) => x.code === 'DEFAULT').id, company_ids: [ids.co], confirm: 'C1CO' });
    expect(into.status).toBe(403);
    expect(into.body.error.message).toMatch(/เข้าลูกค้าข้อมูลตัวอย่าง/);
    // ออกจากข้อมูลตัวอย่าง: บริษัทที่มีข้อมูล (DEMOCO มีแผนก D1) — ย้ายไม่ได้
    const demoT = (await sql<{ id: string }>`SELECT tenant_id::text AS id FROM sys_company WHERE id = ${ids.demoCo}`.execute(database.db)).rows[0]!.id;
    await sql`INSERT INTO md_customer (company_id, code, name) VALUES (${ids.demoCo}, 'DX', 'ลูกค้าทดลอง')`.execute(database.db);
    const outBusy = await call('POST', `/api/v1/tenants/${demoT}/move-companies`, { target_tenant_id: ids.tenant2, company_ids: [ids.demoCo], confirm: 'DEMOCO' });
    expect(outBusy.status).toBe(403);
    expect(outBusy.body.error.message).toMatch(/มีข้อมูลแล้ว/);
    // N3: ลูกค้าปลายทางที่เพิ่งสร้าง (อีเมลผู้ติดต่อที่ผู้ให้บริการพิมพ์) ย้ายเข้าไม่ได้ 7 วัน
    const fresh = await call('POST', `/api/v1/tenants/${ids.tenant}/move-companies`, { target_tenant_id: ids.tenant2, company_ids: [ids.co], confirm: 'C1CO' });
    expect(fresh.status).toBe(403);
    expect(fresh.body.error.message).toMatch(/เพิ่งสร้างไม่ถึง 7 วัน/);
    await sql`UPDATE sys_tenant SET created_at = now() - interval '8 days' WHERE id = ${ids.tenant2}`.execute(database.db);
    expect((await call('POST', `/api/v1/tenants/${ids.tenant}/move-companies`, { target_tenant_id: ids.tenant2, company_ids: [ids.co], confirm: 'C1CO' })).body.error.message).toMatch(/อีเมลผู้ติดต่อของลูกค้าปลายทาง CUST2 เพิ่งตั้ง/);
    await sql`UPDATE sys_tenant SET contact_email_changed_at = now() - interval '8 days' WHERE id = ${ids.tenant2}`.execute(database.db);
    // ลูกค้าจริง → ลูกค้าจริง: คำขอ (ยังไม่ย้าย) · ผู้ให้บริการยืนยันเองไม่ได้ · ผู้ดูแลลูกค้าเดิมปฏิเสธ = ไม่ย้าย
    memoryMail.outbox = [];
    const rq = await call('POST', `/api/v1/tenants/${ids.tenant}/move-companies`, { target_tenant_id: ids.tenant2, company_ids: [ids.co], confirm: 'C1CO' });
    expect(rq.status, rq.raw).toBe(200);
    expect(rq.body).toMatchObject({ pending: true });
    await flushMail();
    expect(memoryMail.outbox.map((m) => `${m.to.join()}:${m.subject}`).join('|')).toMatch(/owner@cust1\.example:คำขอย้ายบริษัท C1CO/);
    const reqMail = memoryMail.outbox.find((m) => m.subject.includes('คำขอย้ายบริษัท'))!.text;
    expect(reqMail).toMatch(/ผู้ดูแลระบบ: c2\.admin/);
    expect(reqMail).toMatch(/ow\*\*\*@cust2\.example/);
    expect(reqMail).toMatch(/ผู้ดูแลของลูกค้า CUST2 จะเห็นข้อมูลทั้งหมด/);
    expect((await call('POST', `/api/v1/company-move-requests/${rq.body.request_id}/confirm`, { confirm: 'C1CO' })).status).toBe(403);
    expect((await call('POST', `/api/v1/tenants/${ids.tenant}/move-companies`, { target_tenant_id: ids.tenant2, company_ids: [ids.co], confirm: 'C1CO' })).body.error.message).toMatch(/รอยืนยันอยู่แล้ว/);
    expect((await sql<{ t: string }>`SELECT tenant_id::text AS t FROM sys_company WHERE id = ${ids.co}`.execute(database.db)).rows[0]!.t).toBe(ids.tenant);
    cookie = custAdmin;
    const pend = (await call('GET', '/api/v1/company-move-requests')).body;
    expect(pend.map((x: { company_codes: string; target_code: string }) => `${x.company_codes}>${x.target_code}`)).toEqual(['C1CO>CUST2']);
    expect(pend[0].target).toMatchObject({ code: 'CUST2', admins: ['c2.admin'], contact_email: 'ow***@cust2.example' });
    expect(pend[0].blocked).toBeNull();
    expect((await call('POST', `/api/v1/company-move-requests/${rq.body.request_id}/reject`)).status).toBe(200);
    expect((await call('GET', '/api/v1/company-move-requests')).body).toEqual([]);
    expect((await sql<{ t: string }>`SELECT tenant_id::text AS t FROM sys_company WHERE id = ${ids.co}`.execute(database.db)).rows[0]!.t).toBe(ids.tenant);
    // ลูกค้าอื่นเห็น/ยืนยันคำขอนี้ไม่ได้ · คำขอใหม่ → ยืนยัน = ย้าย
    cookie = provider;
    const rq2 = await call('POST', `/api/v1/tenants/${ids.tenant}/move-companies`, { target_tenant_id: ids.tenant2, company_ids: [ids.co], confirm: 'C1CO' });
    expect(rq2.body.pending).toBe(true);
    cookie = custAdmin;
    // N4: ปลายทางกลายเป็นข้อมูลตัวอย่างหลังส่งคำขอ = ยืนยันไม่ได้ ไม่ย้าย
    await sql`UPDATE sys_tenant SET is_demo = true WHERE id = ${ids.tenant2}`.execute(database.db);
    expect((await call('POST', `/api/v1/company-move-requests/${rq2.body.request_id}/confirm`, { confirm: 'c1co' })).status).toBe(403);
    expect((await sql<{ t: string }>`SELECT tenant_id::text AS t FROM sys_company WHERE id = ${ids.co}`.execute(database.db)).rows[0]!.t).toBe(ids.tenant);
    await sql`UPDATE sys_tenant SET is_demo = false WHERE id = ${ids.tenant2}`.execute(database.db);
    const done = await call('POST', `/api/v1/company-move-requests/${rq2.body.request_id}/confirm`, { confirm: 'c1co' });
    expect(done.status, done.raw).toBe(200);
    expect((await sql<{ t: string }>`SELECT tenant_id::text AS t FROM sys_company WHERE id = ${ids.co}`.execute(database.db)).rows[0]!.t).toBe(ids.tenant2);
    // คืนสภาพ (ลูกค้า 2 ยืนยันย้ายกลับ) — ไม่ให้ชุดทดสอบถัดไปเปลี่ยน
    await sql`UPDATE sys_company SET tenant_id = ${ids.tenant} WHERE id = ${ids.co}`.execute(database.db);
  });

  it('app addresses (C4): only WTS hosts — saving another host is refused, an old row pointing elsewhere cannot be launched and its tile is locked', async () => {
    cookie = provider;
    const bad = await call('PUT', `/api/v1/tenants/${ids.tenant}/modules`, { modules: [{ key: 'pos', enabled: true, app_url: 'https://evil.example.com/office/' }] });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/ไม่อยู่ในรายชื่อเครื่องของ WTS/);
    expect((await call('PUT', `/api/v1/tenants/${ids.tenant}/modules`, { modules: [{ key: 'pos', enabled: true, app_url: 'http://pos.worktruesolution.net/office/' }] })).status).toBe(400);   // ต้อง https
    expect((await call('PUT', `/api/v1/tenants/${ids.tenant}/modules`, { modules: [{ key: 'pos', enabled: true, app_url: 'https://pos.worktruesolution.net/office/' }] })).status).toBe(200);
    // แถวเดิมที่ชี้ไปเครื่องอื่น
    await sql`UPDATE sys_tenant_module SET app_url = 'https://evil.example.com/office/' WHERE tenant_id = ${ids.tenant} AND module_key = 'pos'`.execute(database.db);
    cookie = custAdmin;
    await call('POST', '/api/v1/auth/select', { company_id: ids.co });
    const launch = await call('POST', '/api/v1/hub/launch', { module: 'pos' });
    expect(launch.status).toBe(409);
    expect(launch.body.error.code).toBe('APP_URL_NOT_ALLOWED');
    expect(launch.raw).not.toContain('buddy_sso');
    const tile = (await call('GET', '/api/v1/hub')).body.apps.find((x: { key: string }) => x.key === 'pos');
    expect(tile).toMatchObject({ status: 'locked', url: null });
    expect(tile.reason).toMatch(/ไม่อยู่ในรายชื่อเครื่องของ WTS/);
    await sql`UPDATE sys_tenant_module SET app_url = NULL WHERE tenant_id = ${ids.tenant} AND module_key = 'pos'`.execute(database.db);
  });

  it('Express import jobs (M1): the provider cannot see, run or cancel a real customer\'s job', async () => {
    cookie = provider;
    expect((await call('PUT', `/api/v1/tenants/${ids.tenant}/modules`, { modules: [{ key: 'express_import', enabled: true }] })).status).toBe(200);
    cookie = custAdmin;
    const job = await call('POST', '/api/v1/express-import/jobs', { code: 'C1EXP' });
    expect(job.status, job.raw).toBe(200);
    cookie = provider;
    expect((await call('GET', `/api/v1/express-import/jobs/${job.body.id}`)).status).toBe(403);
    expect((await call('POST', `/api/v1/express-import/jobs/${job.body.id}/run`, {})).status).toBe(403);
    expect((await call('DELETE', `/api/v1/express-import/jobs/${job.body.id}`)).status).toBe(403);
    cookie = custAdmin;
    expect((await call('GET', `/api/v1/express-import/jobs/${job.body.id}`)).status).toBe(200);
    expect((await call('DELETE', `/api/v1/express-import/jobs/${job.body.id}`)).status).toBe(200);
  });
});
