/**
 * HANDOFF 207 (ต่อจาก 204 P3 · เจ้าของ 27/11/2569 "เริ่มต่อได้")
 *  1. ศูนย์ผู้ให้บริการ: สิ่งที่เจ้าหน้าที่ทำกับบัญชีลูกค้า (อ่านจาก sys_activity_log) — กรองลูกค้า/เจ้าหน้าที่/วันที่ แบ่งหน้า แถวซ้ำแสดงครั้งเดียว
 *  2. ลูกค้า (ADMIN): เห็นเฉพาะบัญชีตัวเอง ชื่อที่แสดงของเจ้าหน้าที่เท่านั้น — ข้ามลูกค้าไม่ได้ (ข้อ 7.1)
 *  3. แจ้งเตือนการใช้งานผิดปกติ: PROVIDER_LOCKED ซ้ำ · ใส่รหัสผิดซ้ำ · ทำรายการถี่ → log + อีเมลผู้ให้บริการ (จำกัดความถี่) · ไม่ส่งถึงลูกค้า
 *  4. แฟ้มย้ายลูกค้า: ทุกแถวต้องเป็นของลูกค้าในหัวแฟ้ม · ที่อยู่โปรแกรม (app_url) เฉพาะเครื่องของ WTS ไม่มีทางหลอก (//host \ userinfo #)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { openDatabase, type Database } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { flushMail, memoryMail, setMailDriver } from '../src/mail/index.js';
import { alertConfig, resetAlerts } from '../src/alerts.js';
import { appUrlProblem } from '../src/modules/hub.js';
import { exportTenant, importTenant, seal, unseal } from '../src/modules/tenant-move.js';
import { readBackup, writeBackup, type Header } from '../src/modules/backup.js';

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
const logRows = async (action: string) => (await sql<{ user_id: string | null; detail: any }>`SELECT user_id, detail FROM sys_activity_log WHERE action = ${action} ORDER BY seq`.execute(database.db)).rows;   // eslint-disable-line @typescript-eslint/no-explicit-any

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

describe('HANDOFF 207: สิ่งที่เจ้าหน้าที่ทำกับบัญชีลูกค้า · แจ้งเตือน · แฟ้มย้าย · app_url', () => {
  const ids: Record<string, string> = {};
  let provider = '', c1Admin = '', c2Admin = '';
  const newCustomer = async (code: string, n: string) => {
    cookie = provider;
    memoryMail.outbox = [];
    const t = await call('POST', '/api/v1/tenants', { code, name: `ลูกค้า ${code}`, admin_username: `${n}.admin`, admin_name: `ผู้ดูแล ${code}`, contact_email: `owner@${n}.example` });
    expect(t.status, t.raw).toBe(200);
    await flushMail();
    const token = linkIn(memoryMail.outbox.at(-1)!.text)!;
    cookie = '';
    expect((await call('POST', `/api/v1/invite/${token}/accept`, { password: `pass${code}9` })).status).toBe(200);
    const ck = await as(`${n}.admin`, `pass${code}9`);
    const co = await call('POST', '/api/v1/companies', { code: `${code}CO`, name_th: `บริษัท ${code}`, fiscal_start: '2026-01-01', chart: 'express' });
    expect(co.status, co.raw).toBe(200);
    return { tenant: t.body.id as string, cookie: ck, co: co.body.id as string };
  };

  it('setup: provider + demo company · two real customers CUST1/CUST2 · provider acts on both (view, modules, unlock, invite email)', async () => {
    resetAlerts();
    expect((await call('POST', '/api/v1/setup', { username: 'admin', display_name: 'ผู้ดูแลผู้ให้บริการ', password: 'secret123' })).status).toBe(200);
    provider = cookie;
    const demo = await call('POST', '/api/v1/companies', { code: 'DEMOCO', name_th: 'บริษัททดลอง', fiscal_start: '2026-01-01', chart: 'express' });
    expect(demo.status, demo.raw).toBe(200);
    ids.demoCo = demo.body.id;
    const c1 = await newCustomer('CUST1', 'c1'); ids.t1 = c1.tenant; ids.co1 = c1.co; c1Admin = c1.cookie;
    const c2 = await newCustomer('CUST2', 'c2'); ids.t2 = c2.tenant; ids.co2 = c2.co; c2Admin = c2.cookie;
    cookie = c1Admin;
    await call('POST', '/api/v1/auth/select', { company_id: ids.co1 });
    const u = await call('POST', '/api/v1/users', { username: 'c1.clerk', display_name: 'พนักงาน C1', password: 'clerkC1234', companies: [ids.co1] });
    expect(u.status, u.raw).toBe(200);
    ids.clerk = u.body.id;
    // ผู้ให้บริการทำกับลูกค้า (ระหว่างเลือกบริษัทข้อมูลตัวอย่างค้างไว้ — แถวต้องเป็นของลูกค้าที่ทำ ไม่ใช่ DEMO)
    cookie = provider;
    expect((await call('POST', '/api/v1/auth/select', { company_id: ids.demoCo })).status).toBe(200);
    expect((await call('GET', `/api/v1/provider/customers/${ids.t1}`)).status).toBe(200);
    expect((await call('GET', `/api/v1/provider/customers/${ids.t1}`)).status).toBe(200);   // ซ้ำใน 30 นาที = บันทึกครั้งเดียว
    expect((await call('GET', `/api/v1/provider/customers/${ids.t2}`)).status).toBe(200);
    expect((await call('POST', `/api/v1/provider/users/${ids.clerk}/unlock`)).status).toBe(200);
    expect((await call('PUT', `/api/v1/tenants/${ids.t1}/modules`, { modules: [{ key: 'pos', enabled: true }] })).status).toBe(200);
    await sql`UPDATE sys_tenant SET contact_email_changed_at = NULL WHERE id = ${ids.t1}`.execute(database.db);
    memoryMail.outbox = [];
    const inv = await call('POST', `/api/v1/provider/users/${ids.clerk}/email-invite`);
    expect(inv.status, inv.raw).toBe(200);
    await flushMail();
    expect((await call('POST', '/api/v1/packages', { code: 'PK207', name_th: 'แพ็กเกจทดสอบ 207', price_month: '100.00' })).status).toBeLessThan(500);
  });

  it('provider list: who/when/which customer/what/result · filter by customer, staff, system-wide · paging · customer admin cannot use it', async () => {
    cookie = provider;
    const all = await call('GET', '/api/v1/provider/actions');
    expect(all.status, all.raw).toBe(200);
    const rows = all.body.rows as Array<{ action: string; tenant_code: string | null; company_code: string | null; staff_username: string; staff_name: string; result: string }>;
    expect(rows.filter((r) => r.action === 'PV_VIEW').map((r) => r.tenant_code).sort()).toEqual(['CUST1', 'CUST2']);
    const unlock = rows.find((r) => r.action === 'USER_UNLOCK')!;
    expect(unlock).toMatchObject({ tenant_code: 'CUST1', company_code: null, staff_username: 'admin', staff_name: 'ผู้ดูแลผู้ให้บริการ', result: 'ok' });
    expect(rows.find((r) => r.action === 'TENANT_MODULES')).toMatchObject({ tenant_code: 'CUST1' });
    // ลิงก์ผู้ดูแลคนแรกตอนสร้างลูกค้า (CUST1 CUST2) + ลิงก์ของ c1.clerk
    expect(rows.filter((r) => r.action === 'INVITE_EMAIL').map((r) => `${r.tenant_code}:${r.result}`).sort()).toEqual(['CUST1:sent', 'CUST1:sent', 'CUST2:sent']);
    // เหตุการณ์ส่วนตัวของเจ้าหน้าที่ (เข้าระบบ) ไม่อยู่ในรายการ · งานของผู้ดูแลลูกค้าเองไม่อยู่
    expect(rows.some((r) => r.action === 'LOGIN')).toBe(false);
    expect(rows.some((r) => r.staff_username === 'c1.admin')).toBe(false);
    expect(all.body.tenants.map((t: { code: string }) => t.code)).toEqual(expect.arrayContaining(['CUST1', 'CUST2']));
    expect(all.body.staff.map((s: { username: string }) => s.username)).toEqual(['admin']);
    const only1 = (await call('GET', `/api/v1/provider/actions?tenant=${ids.t1}`)).body.rows as typeof rows;
    expect(only1.length).toBeGreaterThan(0);
    expect(only1.every((r) => r.tenant_code === 'CUST1')).toBe(true);
    const sys = (await call('GET', '/api/v1/provider/actions?tenant=none')).body.rows as typeof rows;
    expect(sys.every((r) => r.tenant_code === null)).toBe(true);
    const staffId = (await sql<{ id: string }>`SELECT id FROM sys_user WHERE username = 'admin'`.execute(database.db)).rows[0]!.id;
    expect((await call('GET', `/api/v1/provider/actions?staff=${staffId}`)).body.total).toBe(all.body.total);
    expect((await call('GET', '/api/v1/provider/actions?from=2000-01-01&to=2000-12-31')).body.total).toBe(0);
    // แถวซ้ำของเหตุการณ์เดียว (บันทึกทั้งไม่มีบริษัทและรายบริษัท) = แถวเดียว
    await sql`INSERT INTO sys_activity_log (company_id, user_id, module, action, doc_no, table_name, row_id, occurred_at)
      SELECT x.cid, ${staffId}, 'SYS', 'TENANT_DEMO_OFF', 'CUST2', 'sys_tenant', ${ids.t2}, '2026-11-27T05:00:00Z' FROM (VALUES (NULL::uuid), (${ids.co2}::uuid)) x(cid)`.execute(database.db);
    const dd = (await call('GET', `/api/v1/provider/actions?tenant=${ids.t2}&action=TENANT_DEMO_OFF`)).body;
    expect(dd.total).toBe(1);
    // แบ่งหน้า 50 แถว
    await sql`INSERT INTO sys_activity_log (user_id, module, action, doc_no, table_name, row_id, occurred_at)
      SELECT ${staffId}, 'SYS', 'PV_VIEW', 'CUST2', 'sys_tenant', ${ids.t2}, now() - (g || ' minutes')::interval FROM generate_series(1, 60) g`.execute(database.db);
    const p1 = (await call('GET', `/api/v1/provider/actions?tenant=${ids.t2}&action=PV_VIEW`)).body;
    expect([p1.rows.length, p1.total, p1.page_size]).toEqual([50, 61, 50]);
    const p2 = (await call('GET', `/api/v1/provider/actions?tenant=${ids.t2}&action=PV_VIEW&page=2`)).body;
    expect(p2.rows.length).toBe(11);
    expect((await call('GET', '/api/v1/provider/actions?sort=tenant_code&dir=asc')).status).toBe(200);
    expect((await call('GET', '/api/v1/provider/actions?sort=detail')).status).toBe(400);
    // ลูกค้าใช้ทางของผู้ให้บริการไม่ได้
    cookie = c1Admin;
    expect((await call('GET', '/api/v1/provider/actions')).status).toBe(403);
    expect((await call('GET', `/api/v1/provider/actions?tenant=${ids.t2}`)).status).toBe(403);
  });

  it('customer admin sees only own tenant rows, staff display name only — no other customer, no username/IP · clerk/provider/API key refused', async () => {
    cookie = c1Admin;
    const mine = await call('GET', '/api/v1/provider-actions/mine');
    expect(mine.status, mine.raw).toBe(200);
    const acts = mine.body.rows.map((r: { action: string }) => r.action);
    expect(acts).toEqual(expect.arrayContaining(['PV_VIEW', 'USER_UNLOCK', 'TENANT_MODULES', 'INVITE_EMAIL']));
    expect(mine.body.rows.every((r: { staff_name: string }) => r.staff_name === 'ผู้ดูแลผู้ให้บริการ')).toBe(true);
    // DEMOCO = บริษัทข้อมูลตัวอย่างที่ผู้ให้บริการเลือกค้างไว้ตอนทำกับ CUST1 — ไม่แสดงให้ลูกค้า
    expect(mine.raw).not.toMatch(/CUST2|c2\.|"admin"|staff_username|tenant_id|user_id|"ip"|DEMOCO|DEFAULT/);
    expect(Object.keys(mine.body.rows[0]).sort()).toEqual(['action', 'company_code', 'detail', 'doc_no', 'id', 'occurred_at', 'result', 'staff_name']);
    // ส่ง tenant ของคนอื่นมา = ไม่สนใจ (กรองจาก session)
    expect((await call('GET', `/api/v1/provider-actions/mine?tenant=${ids.t2}`)).raw).not.toMatch(/CUST2/);
    cookie = c2Admin;
    const m2 = await call('GET', '/api/v1/provider-actions/mine');
    expect(m2.raw).not.toMatch(/CUST1|c1\.|USER_UNLOCK|TENANT_MODULES/);
    expect(m2.body.rows.some((r: { action: string }) => r.action === 'PV_VIEW')).toBe(true);
    await as('c1.clerk', 'clerkC1234');
    expect((await call('GET', '/api/v1/provider-actions/mine')).status).toBe(403);
    cookie = provider;
    expect((await call('GET', '/api/v1/provider-actions/mine')).status).toBe(403);
  });

  it('alerts: provider PROVIDER_LOCKED ×5 in 10 min → ALERT_LOCKED log + one email to the configured provider address (cooldown) · customer not emailed', async () => {
    resetAlerts();
    cookie = provider;
    const ms = await call('PUT', '/api/v1/platform/mail-settings', { notify: ['signup@wts.example'], alert_notify: ['alerts@wts.example'], reply_to: null });
    expect(ms.status, ms.raw).toBe(200);
    expect(ms.body.alert_notify).toEqual(['alerts@wts.example']);
    memoryMail.outbox = [];
    for (let i = 0; i < 4; i++) expect((await call('POST', '/api/v1/auth/select', { company_id: ids.co1 })).body.error.code).toBe('PROVIDER_LOCKED');
    await flushMail();
    expect(await logRows('ALERT_LOCKED')).toHaveLength(0);
    expect((await call('POST', '/api/v1/auth/select', { company_id: ids.co1 })).status).toBe(403);
    await flushMail();
    const rows = await logRows('ALERT_LOCKED');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.detail).toMatchObject({ kind: 'LOCKED', count: 5, minutes: 10, threshold: 5, mail: 'S', recipients: 1 });
    expect(rows[0]!.detail.samples[0]).toBe('POST /api/v1/auth/select');
    const mail = memoryMail.outbox.filter((m) => m.subject.includes('แจ้งเตือน Buddy'));
    expect(mail).toHaveLength(1);
    expect(mail[0]!.to).toEqual(['alerts@wts.example']);
    expect(mail[0]!.text).toMatch(/admin/);
    expect(memoryMail.outbox.some((m) => m.to.some((t) => t.includes('cust1.example') || t.includes('c1.example')))).toBe(false);
    // ช่วงพัก: ครบอีกรอบก็ไม่แจ้งซ้ำ
    for (let i = 0; i < 6; i++) await call('POST', '/api/v1/auth/select', { company_id: ids.co1 });
    await flushMail();
    expect(await logRows('ALERT_LOCKED')).toHaveLength(1);
    // ผู้ให้บริการเห็นการแจ้งเตือนในรายการ (ทั้งระบบ)
    const sys = (await call('GET', '/api/v1/provider/actions?tenant=none&action=ALERT_LOCKED')).body.rows;
    expect(sys).toHaveLength(1);
    expect(sys[0]).toMatchObject({ tenant_code: null, result: 'sent' });
    // ลูกค้าไม่เห็นการแจ้งเตือนภายใน
    cookie = c1Admin;
    expect((await call('GET', '/api/v1/provider-actions/mine')).raw).not.toMatch(/ALERT_/);
  });

  it('alerts: provider account wrong password ×5 → ALERT_LOGIN_FAIL · customer user failing does not alert · thresholds and mail cap from env', async () => {
    resetAlerts();
    // เจ้าหน้าที่อีกคน (ไม่สังกัดลูกค้า)
    await sql`INSERT INTO sys_user (username, display_name, password_hash, user_group_id, status)
      SELECT 'pv.staff2', 'เจ้าหน้าที่ 2', password_hash, user_group_id, 'A' FROM sys_user WHERE username = 'admin'`.execute(database.db);
    memoryMail.outbox = [];
    cookie = '';
    for (let i = 0; i < 5; i++) await call('POST', '/api/v1/auth/login', { username: 'c1.clerk', password: 'wrong-pass' });
    for (let i = 0; i < 5; i++) await call('POST', '/api/v1/auth/login', { username: 'pv.staff2', password: 'wrong-pass' });
    await flushMail();
    const rows = await logRows('ALERT_LOGIN_FAIL');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.detail).toMatchObject({ kind: 'LOGIN_FAIL', count: 5, mail: 'S' });
    const staff2 = (await sql<{ id: string }>`SELECT id FROM sys_user WHERE username = 'pv.staff2'`.execute(database.db)).rows[0]!.id;
    expect(rows[0]!.user_id).toBe(staff2);
    expect(memoryMail.outbox.filter((m) => m.subject.includes('pv.staff2'))).toHaveLength(1);
    // ค่าตั้งเกณฑ์
    expect(alertConfig({}).rules).toEqual({ LOCKED: { count: 5, minutes: 10 }, LOGIN_FAIL: { count: 5, minutes: 15 }, BURST: { count: 30, minutes: 10 } });
    expect(alertConfig({ BUDDY_ALERT_BURST: '3/1', BUDDY_ALERT_LOCKED: 'x', BUDDY_ALERT_COOLDOWN_MIN: '5', BUDDY_ALERT_MAIL_PER_HOUR: '0' })).toMatchObject({ rules: { BURST: { count: 3, minutes: 1 }, LOCKED: { count: 5, minutes: 10 } }, cooldownMinutes: 5, mailPerHour: 10 });
  });

  it('alerts: burst of provider-console actions → ALERT_BURST · global mail cap per hour (log still written)', async () => {
    resetAlerts();
    process.env.BUDDY_ALERT_BURST = '3/10';
    process.env.BUDDY_ALERT_MAIL_PER_HOUR = '1';
    try {
      memoryMail.outbox = [];
      cookie = provider;
      // GET รายการ/หน้าแรกไม่นับ · เปิดรายละเอียดลูกค้า + เปลี่ยนแปลงที่ศูนย์ผู้ให้บริการนับ
      for (let i = 0; i < 5; i++) await call('GET', '/api/v1/provider/customers');
      await flushMail();
      expect(await logRows('ALERT_BURST')).toHaveLength(0);
      await call('GET', `/api/v1/provider/customers/${ids.t1}`);
      await call('GET', `/api/v1/provider/customers/${ids.t2}`);
      await call('PUT', `/api/v1/tenants/${ids.t1}/modules`, { modules: [{ key: 'pos', enabled: false }] });
      await flushMail();
      const rows = await logRows('ALERT_BURST');
      expect(rows).toHaveLength(1);
      expect(rows[0]!.detail).toMatchObject({ kind: 'BURST', count: 3, mail: 'S' });
      // อีกบัญชีครบเกณฑ์ภายในชั่วโมงเดียวกัน: เกินจำนวนอีเมลต่อชั่วโมง → บันทึก แต่ไม่ส่ง
      cookie = '';
      for (let i = 0; i < 5; i++) await call('POST', '/api/v1/auth/login', { username: 'admin', password: 'wrong-pass' });
      await flushMail();
      const lf = await logRows('ALERT_LOGIN_FAIL');
      expect(lf.at(-1)!.detail).toMatchObject({ mail: 'RATE_LIMIT', recipients: 0 });
      expect(memoryMail.outbox.filter((m) => m.subject.includes('แจ้งเตือน Buddy'))).toHaveLength(1);
    } finally {
      delete process.env.BUDDY_ALERT_BURST;
      delete process.env.BUDDY_ALERT_MAIL_PER_HOUR;
      await sql`UPDATE sys_user_security SET locked_until = NULL, failed_logins = 0 WHERE user_id = (SELECT id FROM sys_user WHERE username = 'admin')`.execute(database.db);
    }
  });

  it('tenant-move import: every row bound to the file\'s tenant — extra tenant, provider group, other user\'s 2FA, foreign log/company/group refs rejected', async () => {
    // ลูกค้าข้อมูลตัวอย่างที่มีกลุ่มและผู้ใช้ (ผู้ให้บริการนำเข้าได้เฉพาะแฟ้มข้อมูลตัวอย่าง)
    cookie = provider;
    const dt = await call('POST', '/api/v1/tenants', { code: 'DEMO2', name: 'ตัวอย่าง 2', admin_username: 'd2.admin', admin_name: 'ผู้ดูแลตัวอย่าง', admin_password: 'demoPass207', is_demo: true });
    expect(dt.status, dt.raw).toBe(200);
    const demoTenant = dt.body.id as string;
    const pass = 'move-pass-207-xyz';
    const { file } = await exportTenant(database.db, demoTenant, pass);
    const { header, rows } = readBackup(unseal(file, pass), 'buddy-tenant');
    const rebuild = (mut: (m: Map<string, Record<string, unknown>[]>) => void) => {
      const m = new Map([...rows].map(([t, rs]) => [t, rs.map((r) => JSON.parse(r) as Record<string, unknown>)]));
      mut(m);
      const lines = [...m].flatMap(([t, rs]) => rs.map((r) => `${t}\t${JSON.stringify(r)}`));
      const { sha256: _s, ...h } = header as Header;
      return seal(writeBackup({ ...h, tables: Object.fromEntries([...m].map(([t, rs]) => [t, rs.length])) }, lines), pass);
    };
    const err = async (buf: Buffer) => { try { await importTenant(database.db, buf, pass, null, { demoOnly: true }); return 'imported'; } catch (e) { return (e as Error).message; } };
    // แฟ้มปกติ = ผ่านการผูก แล้วติดข้อมูลซ้ำ (เครื่องเดียวกัน)
    expect(await err(rebuild(() => {}))).toMatch(/มีข้อมูลซ้ำกับแฟ้มแล้ว/);
    const platformGroup = (await sql<{ id: string }>`SELECT user_group_id AS id FROM sys_user WHERE username = 'admin'`.execute(database.db)).rows[0]!.id;
    const adminId = (await sql<{ id: string }>`SELECT id FROM sys_user WHERE username = 'admin'`.execute(database.db)).rows[0]!.id;
    const cases: Array<[string, (m: Map<string, Record<string, unknown>[]>) => void, RegExp]> = [
      ['second tenant row', (m) => m.get('sys_tenant')!.push({ ...m.get('sys_tenant')![0]!, id: '11111111-1111-4111-8111-111111111111', code: 'EVIL' }), /ลูกค้าไม่ตรงกับหัวแฟ้ม/],
      ['provider group', (m) => m.get('sys_user_group')!.push({ ...m.get('sys_user_group')![0]!, id: '22222222-2222-4222-8222-222222222222', tenant_id: null }), /กลุ่มผู้ใช้ของลูกค้ารายอื่นหรือของผู้ให้บริการ/],
      ['user in platform group', (m) => { m.get('sys_user')![0]!.user_group_id = platformGroup; }, /กลุ่มผู้ใช้นอกแฟ้ม/],
      ['2FA of provider admin', (m) => m.set('sys_user_security', [...(m.get('sys_user_security') ?? []), { id: '33333333-3333-4333-8333-333333333333', user_id: adminId, totp_enabled: true, _totp_plain: 'JBSWY3DPEHPK3PXP' }]), /2FA\) ของผู้ใช้ที่ไม่อยู่ในแฟ้ม/],
      ['log row of CUST1 company', (m) => m.set('sys_activity_log', [...(m.get('sys_activity_log') ?? []), { company_id: ids.co1, user_id: null, module: 'GL', action: 'DELETE', occurred_at: new Date().toISOString() }]), /แฟ้มบันทึกเหตุการณ์ของบริษัทหรือผู้ใช้นอกแฟ้ม/],
      ['system log row of a stranger', (m) => m.set('sys_activity_log', [...(m.get('sys_activity_log') ?? []), { company_id: null, user_id: adminId, module: 'SYS', action: 'LOGIN', occurred_at: new Date().toISOString() }]), /แฟ้มบันทึกเหตุการณ์ของบริษัทหรือผู้ใช้นอกแฟ้ม/],
      ['permission bound to platform group', (m) => { const p = m.get('sys_permission'); if (p?.length) p[0]!.group_id = platformGroup; else m.set('sys_user', m.get('sys_user')!.map((u, i) => (i ? u : { ...u, user_group_id: platformGroup }))); }, /กลุ่มผู้ใช้นอกแฟ้ม/],
    ];
    for (const [name, mut, re] of cases) expect([name, await err(rebuild(mut))]).toEqual([name, expect.stringMatching(re)]);
  });

  it('app_url allowlist: only https *.worktruesolution.net + BUDDY_APP_HOSTS — no //host, backslash, userinfo, fragment, look-alike or scheme tricks', async () => {
    const ok = ['https://pos.worktruesolution.net/office/', 'https://worktruesolution.net/', 'https://a.b.worktruesolution.net:8443/x?y=1', 'HTTPS://POS.WORKTRUESOLUTION.NET/'];
    for (const u of ok) expect([u, appUrlProblem(u)]).toEqual([u, null]);
    const bad = [
      '//evil.com/', '/\\evil.com', 'https:evil.com', 'https:/\\evil.com', 'https://evil.com\\@pos.worktruesolution.net/', 'https://evil.com\\.worktruesolution.net/',
      'https://pos.worktruesolution.net@evil.com/', 'https://evil.com@pos.worktruesolution.net/', 'https://user:pw@pos.worktruesolution.net/',
      'https://pos.worktruesolution.net.evil.com/', 'https://evilworktruesolution.net/', 'https://pos.worktruesolution.net./', 'https://pos.worktruesolutiοn.net/',
      'http://pos.worktruesolution.net/', 'javascript:alert(1)//pos.worktruesolution.net', 'data:text/html,x', 'https://pos.worktruesolution.net/#x', 'https://%65vil.com/',
      'https://pos.worktruesolution.net%2F@evil.com/', 'https://127.0.0.1/', 'http://localhost:4300/',
    ];
    for (const u of bad) expect([u, appUrlProblem(u)]).toEqual([u, expect.any(String)]);
    process.env.BUDDY_APP_HOSTS = 'pos.example.com, *.wts.example, localhost';
    try {
      expect(appUrlProblem('https://pos.example.com/')).toBeNull();
      expect(appUrlProblem('https://a.wts.example/')).toBeNull();
      expect(appUrlProblem('http://localhost:4300/office/')).toBeNull();
      expect(appUrlProblem('https://pos.example.com.evil.com/')).not.toBeNull();
      expect(appUrlProblem('https://xpos.example.com/')).not.toBeNull();
      expect(appUrlProblem('http://pos.example.com/')).not.toBeNull();
    } finally { delete process.env.BUDDY_APP_HOSTS; }
    // ผ่าน API: ผู้ให้บริการบันทึกที่อยู่หลอกไม่ได้
    cookie = provider;
    for (const u of ['https://evil.com@pos.worktruesolution.net/', 'https://pos.worktruesolution.net@evil.com/', 'https://evil.com\\@pos.worktruesolution.net/']) {
      const r = await call('PUT', `/api/v1/tenants/${ids.t1}/modules`, { modules: [{ key: 'pos', enabled: true, app_url: u }] });
      expect([u, r.status]).toEqual([u, 400]);
    }
    expect((await call('PUT', `/api/v1/tenants/${ids.t1}/modules`, { modules: [{ key: 'pos', enabled: true, app_url: 'https://pos.worktruesolution.net/office/' }] })).status).toBe(200);
  });
});
