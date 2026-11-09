/**
 * สิทธิ์เปิดโปรแกรมรายผู้ใช้จาก Hub (เจ้าของ 09/11/2569 "ให้ Admin กำหนดว่าเห็นโปรแกรมหรือใช้งานโปรแกรมไหนได้บ้าง" · HANDOFF ข้อ 99)
 * sys_user.app_access: null = ทุกโปรแกรมที่ลูกค้าเปิดใช้ (ผู้ใช้เดิม) · ["pos"] = เฉพาะ POS (ไม่เห็นเมนูบัญชีของ Buddy) · ผู้ดูแลระบบได้ทุกโปรแกรม
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDatabase, type Database } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

let database: Database;
let app: FastifyInstance;
let cookie = '';
type Res = { status: number; body: any };   // eslint-disable-line @typescript-eslint/no-explicit-any
async function call(method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown): Promise<Res> {
  const r = await app.inject({ method, url, payload: body as object, headers: cookie ? { cookie } : {} });
  const set = r.headers['set-cookie'];
  if (set) cookie = (Array.isArray(set) ? set[0]! : set).split(';')[0]!;
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
}
const as = async (u: string, p: string) => { cookie = ''; const r = await call('POST', '/api/v1/auth/login', { username: u, password: p }); expect(r.status, JSON.stringify(r.body)).toBe(200); };

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.BUDDY_REQUIRE_ADMIN_2FA = '0';
  process.env.BUDDY_SECRET_KEY ??= Buffer.alloc(32, 7).toString('base64');
  const cfg = { ...loadConfig({}), databaseUrl: undefined, dataDir: 'memory://' };
  database = await openDatabase(cfg);
  await migrate(database, cfg.migrationsDir, () => {});
  app = await buildApp(database, cfg);
}, 120_000);
afterAll(async () => { await app?.close(); await database?.close(); });

describe('สิทธิ์เปิดโปรแกรมรายผู้ใช้ (Hub)', () => {
  const ids: Record<string, string> = {};
  const POS = 'https://wtspos.example.test/office/', LIV = 'https://living.example.test/office/';

  it('ตั้งบริษัท · ลูกค้าเปิด POS + Living · ผู้ใช้ 4 แบบ (ทุกโปรแกรม / เฉพาะ POS / เฉพาะ Buddy / ไม่มีเลย)', async () => {
    expect((await call('POST', '/api/v1/setup', { username: 'admin', display_name: 'ผู้ดูแล', password: 'secret123' })).status).toBe(200);
    const co = await call('POST', '/api/v1/companies', { code: 'HUBA', name_th: 'บริษัท ฮับ ทดสอบ จำกัด', fiscal_start: '2026-01-01', chart: 'express' });
    ids.co = co.body.id;
    await call('POST', '/api/v1/auth/select', { company_id: ids.co });
    const hub = (await call('GET', '/api/v1/hub')).body;
    ids.tenant = (await call('GET', '/api/v1/tenants')).body.find((t: { code: string }) => t.code === hub.tenant.code).id;
    expect((await call('PUT', `/api/v1/tenants/${ids.tenant}/modules`, { modules: [{ key: 'pos', enabled: true, app_url: POS }, { key: 'living', enabled: true, app_url: LIV }] })).status).toBe(200);
    const mk = async (username: string, app_access: unknown) => {
      const r = await call('POST', '/api/v1/users', { username, display_name: username, password: 'pass12345', approval_level: 4, companies: [ids.co], tenant_id: ids.tenant, ...(app_access === undefined ? {} : { app_access }) });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      return r.body.id as string;
    };
    ids.all = await mk('u.all', undefined);
    ids.pos = await mk('u.pos', ['pos']);
    ids.buddy = await mk('u.buddy', ['buddy']);
    ids.none = await mk('u.none', []);
    // ชื่อโปรแกรมที่ไม่รู้จัก = บอกชื่อที่ใช้ได้
    const bad = await call('POST', '/api/v1/users', { username: 'u.bad', display_name: 'x', password: 'pass12345', companies: [ids.co], tenant_id: ids.tenant, app_access: ['erp'] });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/ไม่รู้จักโปรแกรม "erp".*buddy pos living/);
    const list = (await call('GET', '/api/v1/users')).body.users as Array<{ username: string; app_access: string[] | null }>;
    expect(Object.fromEntries(list.filter((u) => u.username.startsWith('u.')).map((u) => [u.username, u.app_access]))).toEqual({ 'u.all': null, 'u.pos': ['pos'], 'u.buddy': ['buddy'], 'u.none': [] });
  });

  it('ไม่ได้กำหนด = ทุกโปรแกรมของลูกค้าเหมือนเดิม (ผู้ใช้เดิมไม่เสียสิทธิ์)', async () => {
    await as('u.all', 'pass12345');
    await call('POST', '/api/v1/auth/select', { company_id: ids.co });
    const me = (await call('GET', '/api/v1/auth/me')).body.user;
    expect([me.apps, me.hub_only]).toEqual([null, false]);
    const keys = (await call('GET', '/api/v1/hub')).body.apps.map((x: { key: string }) => x.key);
    expect(keys).toEqual(['buddy', 'pos', 'hotel', 'hr', 'spa', 'living']);
    expect((await call('POST', '/api/v1/hub/launch', { module: 'pos' })).status).toBe(200);
    expect((await call('GET', '/api/v1/customers')).status).toBe(200);
  });

  it('เฉพาะ POS: เห็นไทล์ POS อย่างเดียว · เปิด POS ได้ · Living/Buddy ไม่ได้ · เมนูบัญชีและข้อมูลอ้างอิงถูกปฏิเสธ · เปลี่ยนรหัสผ่านได้', async () => {
    await as('u.pos', 'pass12345');
    await call('POST', '/api/v1/auth/select', { company_id: ids.co });
    const me = (await call('GET', '/api/v1/auth/me')).body.user;
    expect([me.apps, me.hub_only]).toEqual([['pos'], true]);
    const hub = (await call('GET', '/api/v1/hub')).body;
    expect(hub.apps.map((x: { key: string }) => x.key)).toEqual(['pos']);
    expect(hub.user.restricted).toBe(true);
    const ok = await call('POST', '/api/v1/hub/launch', { module: 'pos' });
    expect(ok.status).toBe(200);
    expect(ok.body.url.startsWith(`${POS}#buddy_sso=`)).toBe(true);
    const liv = await call('POST', '/api/v1/hub/launch', { module: 'living' });
    expect(liv.status).toBe(403);
    expect(liv.body.error.message).toMatch(/ยังไม่ให้สิทธิ์คุณเปิด WTS-Living/);
    const dash = await call('GET', '/api/v1/dashboard');
    expect(dash.status).toBe(403);
    const look = await call('GET', '/api/v1/customers');
    expect(look.status).toBe(403);
    expect(look.body.error.message).toMatch(/เฉพาะโปรแกรมอื่น/);
    // เมนูที่เห็น: หน้าเปิดโปรแกรม + รหัสผ่าน เท่านั้น
    const perms = (await call('GET', '/api/v1/auth/me')).body.perms as Record<string, { read: boolean }>;
    expect(Object.entries(perms).filter(([, v]) => v.read).map(([k]) => k).sort()).toEqual(['OT.HUB', 'OT.PASS']);
    expect((await call('POST', '/api/v1/auth/password', { old_password: 'pass12345', new_password: 'pass67890' })).status).toBe(200);
  });

  it('เฉพาะ Buddy: ไม่เห็นไทล์ POS/Living · เปิด POS ไม่ได้ · ใช้ Buddy ได้ตามเดิม', async () => {
    await as('u.buddy', 'pass12345');
    await call('POST', '/api/v1/auth/select', { company_id: ids.co });
    expect((await call('GET', '/api/v1/hub')).body.apps.map((x: { key: string }) => x.key)).toEqual(['buddy']);
    expect((await call('POST', '/api/v1/hub/launch', { module: 'pos' })).status).toBe(403);
    expect((await call('GET', '/api/v1/customers')).status).toBe(200);
    expect((await call('GET', '/api/v1/auth/me')).body.user.hub_only).toBe(false);
  });

  it('ไม่ได้รับโปรแกรมใดเลย: Hub ว่าง · เปิดอะไรไม่ได้', async () => {
    await as('u.none', 'pass12345');
    await call('POST', '/api/v1/auth/select', { company_id: ids.co });
    expect((await call('GET', '/api/v1/hub')).body.apps).toEqual([]);
    expect((await call('POST', '/api/v1/hub/launch', { module: 'pos' })).status).toBe(403);
    expect((await call('GET', '/api/v1/customers')).status).toBe(403);
  });

  it('ผู้ดูแลระบบเปิดได้ทุกโปรแกรมเสมอ · แก้สิทธิ์แล้วมีผลทันที + ลงประวัติ · หน้าจอรุ่นเก่า (ไม่ส่ง app_access) ไม่ล้างค่า', async () => {
    await as('admin', 'secret123');
    await call('POST', '/api/v1/auth/select', { company_id: ids.co });
    const users = (await call('GET', '/api/v1/users')).body.users as Array<{ id: string; username: string; display_name: string; approval_level: number; companies: string[] }>;
    const u = users.find((x) => x.username === 'u.pos')!;
    const base = { username: u.username, display_name: u.display_name, approval_level: u.approval_level, companies: u.companies };
    expect((await call('PUT', `/api/v1/users/${u.id}`, { ...base, app_access: ['pos', 'living'] })).status).toBe(200);
    expect((await call('PUT', `/api/v1/users/${u.id}`, base)).status).toBe(200);   // ไม่ส่ง = คงค่าเดิม
    const after = ((await call('GET', '/api/v1/users')).body.users as Array<{ username: string; app_access: string[] | null }>).find((x) => x.username === 'u.pos')!;
    expect(after.app_access).toEqual(['pos', 'living']);
    const log = (await call('GET', `/api/v1/activity-log?table=sys_user&row_id=${u.id}`)).body;
    const rows = (log.rows ?? log) as Array<{ action: string; detail: { app_access?: { before: unknown; after: unknown } } }>;
    expect(rows.map((r) => r.detail?.app_access).filter(Boolean)).toContainEqual({ before: ['pos'], after: ['pos', 'living'] });
    await as('u.pos', 'pass67890');
    await call('POST', '/api/v1/auth/select', { company_id: ids.co });
    expect((await call('POST', '/api/v1/hub/launch', { module: 'living' })).status).toBe(200);
    // ผู้ดูแลระบบ: ไม่จำกัดแม้ไม่ได้ติ๊ก
    await as('admin', 'secret123');
    await call('POST', '/api/v1/auth/select', { company_id: ids.co });
    expect((await call('GET', '/api/v1/hub')).body.apps.length).toBe(6);
  });

  it('ข้ามลูกค้าไม่ได้: ผู้ดูแลของลูกค้าอื่นแก้สิทธิ์โปรแกรมของผู้ใช้ลูกค้านี้ไม่ได้', async () => {
    await as('admin', 'secret123');
    expect((await call('POST', '/api/v1/tenants', { code: 'HUBB', name: 'ลูกค้า B', admin_username: 'b.admin', admin_name: 'ผู้ดูแล B', admin_password: 'passB1234' })).status).toBe(200);
    await as('b.admin', 'passB1234');
    const r = await call('PUT', `/api/v1/users/${ids.pos}`, { username: 'u.pos', display_name: 'x', approval_level: 9, companies: [], app_access: null });
    expect(r.status).toBe(404);
    expect(((await call('GET', '/api/v1/users')).body.users as Array<{ username: string }>).map((u) => u.username)).not.toContain('u.pos');
  });
});
