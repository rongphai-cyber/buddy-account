/**
 * T7.8 ออฟไลน์สาขา — สำนักงานใหญ่และเครื่องสาขาเป็นฐานข้อมูล PGlite คนละชุดในโปรแกรมเดียว
 * "อินเทอร์เน็ต" = ตัวส่งคำขอที่เปิด/ปิดได้ (setSyncTransport → app.inject ของสำนักงานใหญ่)
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { openDatabase, type Database } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { setSyncTransport, syncNow } from '../src/modules/sync/branch.js';

type Call = (method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown) => Promise<{ status: number; body: any }>;   // eslint-disable-line @typescript-eslint/no-explicit-any
function client(app: () => FastifyInstance): Call & { logout: () => void } {
  let cookie = '';
  const f = (async (method, url, body) => {
    const r = await app().inject({ method, url, payload: body as object, headers: cookie ? { cookie } : {} });
    const set = r.headers['set-cookie'];
    if (set) cookie = (Array.isArray(set) ? set[0]! : set).split(';')[0]!;
    return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
  }) as Call & { logout: () => void };
  f.logout = () => { cookie = ''; };
  return f;
}

let hq: Database, br: Database, hqApp: FastifyInstance, brApp: FastifyInstance;
let online = true;
const H = client(() => hqApp), B = client(() => brApp);

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.BUDDY_REQUIRE_ADMIN_2FA = '0';
  process.env.BUDDY_SYNC_SECONDS = '0';   // ไม่ซิงก์เอง — ชุดทดสอบเรียก syncNow
  process.env.BUDDY_SECRET_KEY ??= Buffer.alloc(32, 7).toString('base64');
  const cfg = { ...loadConfig({}), databaseUrl: undefined, dataDir: 'memory://' };
  hq = await openDatabase(cfg); await migrate(hq, cfg.migrationsDir, () => {}); hqApp = await buildApp(hq, cfg);
  br = await openDatabase(cfg); await migrate(br, cfg.migrationsDir, () => {}); brApp = await buildApp(br, cfg);
  setSyncTransport(async (path, body, token) => {
    if (!online) throw new Error('fetch failed');
    const r = await hqApp.inject({ method: 'POST', url: path, payload: body as object, headers: { 'x-buddy-device': token } });
    return { status: r.statusCode, headers: r.headers as Record<string, string>, body: r.rawPayload };
  });
}, 180_000);
afterAll(async () => { setSyncTransport(null); await brApp?.close(); await hqApp?.close(); await br?.close(); await hq?.close(); });

describe('ออฟไลน์สาขา (T7.8)', () => {
  let co = '', cus = '', item = '', hsType = '', ivType = '', setupCode = '', device = '', clerk = '';
  const hs = (date: string, price = 1070) => ({ doc_type_id: hsType, doc_date: date, party_id: cus, price_type: '1', vat_rate: 7, lines: [{ item_id: item, qty: 1, unit_price: price }], payments: [] });
  const status = async () => (await B('GET', '/api/v1/sync/status')).body;

  it('head office registers a branch device; the branch installs from it with the same users', async () => {
    expect((await H('POST', '/api/v1/setup', { username: 'ops', display_name: 'ผู้ให้บริการ', password: 'opsPass123' })).status).toBe(200);
    expect((await H('POST', '/api/v1/tenants', { code: 'SHOP', name: 'ร้านค้า', admin_username: 'shop.admin', admin_name: 'ผู้ดูแลร้าน', admin_password: 'shopPass123' })).status).toBe(200);
    H.logout(); expect((await H('POST', '/api/v1/auth/login', { username: 'shop.admin', password: 'shopPass123' })).status).toBe(200);
    co = (await H('POST', '/api/v1/companies', { code: 'SHOP', name_th: 'บริษัท ร้านค้า จำกัด', fiscal_start: '2026-01-01', chart: 'express' })).body.id;
    await H('POST', '/api/v1/auth/select', { company_id: co });
    const ins = async (t: string, code: string, name: string) => (await sql<{ id: string }>`INSERT INTO ${sql.table(t)} (company_id, code, name_th) VALUES (${co}, ${code}, ${name}) RETURNING id`.execute(hq.db)).rows[0]!.id;
    const pcs = await ins('md_unit', 'PCS', 'ชิ้น'); await ins('md_warehouse', '01', 'คลังหลัก');
    const leaf = (await H('GET', '/api/v1/gl/accounts')).body.filter((x: { is_control: boolean }) => !x.is_control);
    const grp = (await H('POST', '/api/v1/item-account-groups', { code: 'G1', name_th: 'สินค้า', cost_method: 'A', inventory_account_id: leaf[0].id, cogs_account_id: leaf[1].id })).body.id;
    const it1 = await H('POST', '/api/v1/items', { code: '01-AAAA-000001', name_th: 'สินค้า A', base_unit_id: pcs, account_group_id: grp, price_1: '1000', std_cost: '600', vat_code: '1', allow_negative: 'Y' });
    expect(it1.status, JSON.stringify(it1.body)).toBe(200);
    item = it1.body.id;
    cus = (await H('POST', '/api/v1/customers', { code: 'C1', name: 'ลูกค้าเงินสด', tax_id: '0105537095903' })).body.id;
    hsType = (await H('GET', '/api/v1/trade-defaults/HS')).body.types[0].id;
    ivType = (await H('GET', '/api/v1/trade-defaults/IV')).body.types.find((t: { code: string }) => t.code === 'IV').id;

    expect((await H('POST', '/api/v1/users', { username: 'shop.clerk', display_name: 'พนักงานหน้าร้าน', password: 'clerkPass1', companies: [co] })).status).toBe(200);
    clerk = (await H('GET', '/api/v1/users')).body.users.find((u: { username: string }) => u.username === 'shop.clerk').id;
    const branch = (await sql<{ id: string }>`SELECT id FROM sys_branch WHERE company_id = ${co}`.execute(hq.db)).rows[0]!.id;
    const dv = await H('POST', '/api/v1/devices', { code: 'POS1', name: 'เครื่องหน้าร้าน', branch_id: branch });
    expect(dv.status, JSON.stringify(dv.body)).toBe(200);
    setupCode = dv.body.setup_code; device = dv.body.id;
    expect((await H('POST', '/api/v1/devices', { code: 'POS1', name: 'ซ้ำ', branch_id: branch })).status).toBe(400);

    // เครื่องสาขา: รหัสผิดตั้งไม่ได้ · รหัสถูก = ได้สำเนาบริษัท ผู้ใช้ และช่วงเลขที่
    expect((await B('POST', '/api/v1/sync/setup-branch', { central_url: 'http://hq.test', setup_code: 'bd_POS1_wrongcodewrongcode' })).body.error.message).toMatch(/รหัสเครื่องสาขาไม่ถูกต้อง/);
    const st = await B('POST', '/api/v1/sync/setup-branch', { central_url: 'http://hq.test', setup_code: setupCode });
    expect(st.status, JSON.stringify(st.body)).toBe(200);
    expect(st.body).toMatchObject({ company: 'SHOP', device: 'POS1', ok: true });
    expect((await B('POST', '/api/v1/sync/setup-branch', { central_url: 'http://hq.test', setup_code: setupCode })).body.error.message).toMatch(/ยังไม่มีข้อมูล/);
    expect((await B('POST', '/api/v1/auth/login', { username: 'shop.admin', password: 'shopPass123' })).status).toBe(200);
    expect((await B('GET', '/api/v1/auth/me')).body.companies.map((c: { code: string }) => c.code)).toEqual(['SHOP']);
    await B('POST', '/api/v1/auth/select', { company_id: co });
    const s = await status();
    expect(s).toMatchObject({ mode: 'branch', device_code: 'POS1', pending: 0 });
    expect(s.blocks.find((b: { code: string }) => b.code === 'HS').left).toBe(200);
    expect((await H('GET', '/api/v1/sync/status')).body).toEqual({ mode: 'central' });
  });

  it('works offline: documents numbered from the reserved range, queued with the document; other work refused', async () => {
    online = false;
    const a = await B('POST', '/api/v1/cash-sales', hs('2026-06-16'));
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect(a.body.doc_no).toBe('HS0000001');
    const nc = await B('POST', '/api/v1/customers', { code: 'C-BR1', name: 'ลูกค้าใหม่ที่สาขา', tax_id: '0105537095903' });
    expect(nc.status).toBe(200);
    const iv = await B('POST', '/api/v1/sales-invoices', { doc_type_id: ivType, doc_date: '2026-06-17', party_id: nc.body.id, price_type: '2', vat_rate: 7, lines: [{ item_id: item, qty: 2, unit_price: 500 }] });
    expect(iv.status, JSON.stringify(iv.body)).toBe(200);
    expect(iv.body.doc_no).toBe('IV0000001');
    const ro = await B('PUT', '/api/v1/settings', { values: { 'gen.vat_rate': 10 } });
    expect(ro.status).toBe(403); expect(ro.body.error.code).toBe('BRANCH_READ_ONLY');
    expect((await B('POST', '/api/v1/suppliers', { code: 'S1', name: 'x', tax_id: '0105537095903' })).status).toBe(403);
    // บันทึกไม่ผ่าน (ข้อผิดพลาด) = ไม่มีรายการในคิว
    expect((await B('POST', '/api/v1/cash-sales', { ...hs('2026-06-16'), lines: [] })).status).toBe(400);
    await syncNow(br);
    const s = await status();
    expect(s.pending).toBe(3);
    expect(s.last_error).toMatch(/ติดต่อสำนักงานใหญ่ไม่ได้/);
    expect(s.queue.map((q: { label: string; doc_no: string | null }) => `${q.label}:${q.doc_no ?? ''}`)).toEqual(['ขายเงินสด:HS0000001', 'เพิ่มลูกค้า:', 'ขายเงินเชื่อ:IV0000001']);
    // สำนักงานใหญ่ออกเลขต่อหลังช่วงที่จองให้สาขา
    expect((await H('POST', '/api/v1/cash-sales', hs('2026-06-16', 535))).body.doc_no).toBe('HS0000201');
  });

  it('back online: head office records the same documents (same ids, numbers, user) and the branch receives head office changes', async () => {
    online = true;
    await syncNow(br);
    const s = await status();
    expect(s.last_error, s.last_error).toBeNull();
    expect(s.pending).toBe(0);
    const brHs = (await sql<{ id: string }>`SELECT id FROM doc_header WHERE doc_no = 'HS0000001'`.execute(br.db)).rows[0]!.id;
    const hqHs = (await sql<{ id: string; created_by: string; doc_status: string }>`SELECT h.id, u.username AS created_by, h.doc_status FROM doc_header h JOIN sys_user u ON u.id = h.created_by WHERE h.doc_no = 'HS0000001'`.execute(hq.db)).rows[0]!;
    expect(hqHs).toEqual({ id: brHs, created_by: 'shop.admin', doc_status: 'N' });
    const j = (await H('GET', `/api/v1/docs/${brHs}/journal`)).body.journals[0];
    expect(j.voucher_no).toBe('HS0000001');
    const sum = (k: 'debit' | 'credit') => j.lines.reduce((t: number, l: Record<string, string>) => t + Number(l[k]), 0);
    expect(sum('debit')).toBeCloseTo(sum('credit'), 2); expect(sum('debit')).toBeGreaterThan(0);
    const custHq = (await sql<{ id: string }>`SELECT id FROM md_customer WHERE code = 'C-BR1'`.execute(hq.db)).rows[0]!.id;
    expect((await sql<{ id: string }>`SELECT id FROM md_customer WHERE code = 'C-BR1'`.execute(br.db)).rows[0]!.id).toBe(custHq);
    expect((await H('GET', '/api/v1/sales-invoices?q=IV0000001')).body.rows[0]).toMatchObject({ party_code: 'C-BR1', net_amount: '1070.00' });
    // สาขาได้เอกสารที่สำนักงานใหญ่ออก + ใบสำคัญที่สำนักงานใหญ่ลงบัญชี
    expect((await B('GET', '/api/v1/cash-sales?q=HS0000201')).body.rows).toHaveLength(1);
    expect((await B('GET', '/api/v1/reports/trial-balance?from=2026-01-01&to=2026-12-31')).body.totals).toEqual((await H('GET', '/api/v1/reports/trial-balance?from=2026-01-01&to=2026-12-31')).body.totals);
    expect((await H('GET', '/api/v1/devices')).body[0]).toMatchObject({ code: 'POS1', applied: 3, conflicts: 0 });
    // ส่งซ้ำ (เน็ตหลุดหลังสำนักงานใหญ่รับแล้ว) = ไม่บันทึกซ้ำ
    await sql`UPDATE sync_outbox SET status = 'PENDING'`.execute(br.db);
    await syncNow(br);
    expect((await status()).pending).toBe(0);
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM doc_header WHERE doc_no LIKE 'HS%'`.execute(hq.db)).rows[0]!.n).toBe(2);
  });

  it('a document head office refuses (closed period) stops the queue until retried or discarded', async () => {
    const june = (await H('GET', '/api/v1/gl/periods')).body[0].periods[5];
    expect((await H('POST', `/api/v1/gl/periods/${june.id}/lock`, { locked: true })).status).toBe(200);
    await syncNow(br);   // สาขาได้รู้ว่างวดปิด → บันทึกในงวดนั้นไม่ได้
    expect((await B('POST', '/api/v1/cash-sales', hs('2026-06-20'))).status).toBe(400);
    online = false;   // สาขายังไม่รู้ว่าปิดงวด (ออฟไลน์อยู่ตอนสำนักงานใหญ่ปิด)
    await sql`UPDATE gl_period SET is_locked = false WHERE id = ${june.id}`.execute(br.db);
    const x = await B('POST', '/api/v1/cash-sales', hs('2026-06-21'));
    const y = await B('POST', '/api/v1/cash-sales', hs('2026-07-02'));
    expect([x.body.doc_no, y.body.doc_no]).toEqual(['HS0000002', 'HS0000003']);
    online = true;
    await syncNow(br);
    let s = await status();
    expect(s.queue.map((q: { status: string; doc_no: string }) => `${q.doc_no}:${q.status}`)).toEqual(['HS0000002:CONFLICT', 'HS0000003:PENDING']);
    expect(s.queue[0].last_error).toMatch(/งวด|locked/i);
    expect((await H('GET', `/api/v1/devices/${device}/conflicts`)).body[0].reason).toBe('PERIOD_LOCKED');
    // แก้ที่สำนักงานใหญ่ (เปิดงวด) แล้วส่งใหม่
    expect((await H('POST', `/api/v1/gl/periods/${june.id}/lock`, { locked: false })).status).toBe(200);
    const q0 = s.queue[0].id;
    expect((await B('POST', `/api/v1/sync/outbox/${q0}/retry`)).status).toBe(200);
    s = await status();
    expect(s.pending).toBe(0); expect(s.queue).toHaveLength(0);
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM doc_header WHERE doc_no IN ('HS0000002', 'HS0000003')`.execute(hq.db)).rows[0]!.n).toBe(2);
    // ยกเลิกเอกสารที่ไม่ผ่านที่สาขา (เฉพาะผู้ดูแล) — แถวที่เอกสารสร้างหายจากเครื่องสาขา
    expect((await H('POST', `/api/v1/gl/periods/${june.id}/lock`, { locked: true })).status).toBe(200);
    online = false;
    await sql`UPDATE gl_period SET is_locked = false WHERE id = ${june.id}`.execute(br.db);
    const z = await B('POST', '/api/v1/cash-sales', hs('2026-06-22'));
    online = true; await syncNow(br);
    s = await status();
    expect(s.queue[0]).toMatchObject({ doc_no: z.body.doc_no, status: 'CONFLICT' });
    B.logout(); expect((await B('POST', '/api/v1/auth/login', { username: 'shop.clerk', password: 'clerkPass1' })).status).toBe(200);
    expect((await B('POST', `/api/v1/sync/outbox/${s.queue[0].id}/discard`)).status).toBe(403);
    B.logout(); await B('POST', '/api/v1/auth/login', { username: 'shop.admin', password: 'shopPass123' }); await B('POST', '/api/v1/auth/select', { company_id: co });
    expect((await B('POST', `/api/v1/sync/outbox/${s.queue[0].id}/discard`)).status).toBe(200);
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM doc_header WHERE id = ${z.body.id}`.execute(br.db)).rows[0]!.n).toBe(0);
    expect((await status()).queue).toHaveLength(0);
  });

  it('user changes at head office reach the branch; suspended device and other companies are refused', async () => {
    expect((await H('PUT', `/api/v1/users/${clerk}`, { username: 'shop.clerk', display_name: 'พนักงานหน้าร้าน', password: 'newClerk123', companies: [co] })).status).toBe(200);
    await syncNow(br);
    B.logout();
    expect((await B('POST', '/api/v1/auth/login', { username: 'shop.clerk', password: 'clerkPass1' })).status).toBe(401);
    expect((await B('POST', '/api/v1/auth/login', { username: 'shop.clerk', password: 'newClerk123' })).status).toBe(200);
    // ใบสำคัญที่แก้ที่สำนักงานใหญ่ (ลบบรรทัดเดิมจริง) → เครื่องสาขายอดเท่ากัน
    await H('POST', '/api/v1/auth/select', { company_id: co });
    const book = (await H('GET', '/api/v1/gl/books')).body[0].id;
    const acc = (await H('GET', '/api/v1/gl/accounts')).body.filter((x: { is_control: boolean }) => !x.is_control);
    const jv = (await H('POST', '/api/v1/gl/journals', { journal_book_id: book, voucher_date: '2026-08-01', lines: [{ account_id: acc[2].id, debit: '300' }, { account_id: acc[3].id, credit: '300' }] })).body;
    await syncNow(br);
    expect((await H('PUT', `/api/v1/gl/journals/${jv.id}`, { journal_book_id: book, voucher_date: '2026-08-01', lines: [{ account_id: acc[2].id, debit: '450' }, { account_id: acc[4].id, credit: '450' }] })).status).toBe(200);
    await syncNow(br);
    await B('POST', '/api/v1/auth/select', { company_id: co });
    const tb = async (c: Call) => (await c('GET', '/api/v1/reports/trial-balance?from=2026-01-01&to=2026-12-31')).body.totals;
    expect(await tb(B)).toEqual(await tb(H));
    // ดึงได้เฉพาะข้อมูลบริษัทของเครื่อง
    const pull = await hqApp.inject({ method: 'POST', url: '/api/v1/sync/pull', payload: { since: 0 }, headers: { 'x-buddy-device': setupCode } });
    const rowsOut = JSON.parse(pull.body).rows as Array<{ t: string; j: { company_id?: string; id: string } }>;
    expect(rowsOut.length).toBeGreaterThan(0);
    expect(rowsOut.every((r) => r.t === 'sys_company' ? r.j.id === co : r.j.company_id === co)).toBe(true);
    expect((await hqApp.inject({ method: 'POST', url: '/api/v1/sync/pull', payload: { since: 0 }, headers: { 'x-buddy-device': 'bd_x_nope' } })).statusCode).toBe(401);
    // ระงับเครื่อง
    expect((await H('POST', `/api/v1/devices/${device}/suspend`)).status).toBe(200);
    await syncNow(br);
    B.logout(); await B('POST', '/api/v1/auth/login', { username: 'shop.admin', password: 'shopPass123' });
    expect((await status()).last_error).toMatch(/ถูกระงับ/);
  });
});
