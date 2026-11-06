/**
 * ที่เก็บไฟล์ R2 ผ่าน API ของ Buddy (docs/20 ข้อ 9) — R2 จำลองด้วย fetch ในหน่วยความจำ (ไม่มีเครือข่ายจริง)
 * โลโก้/ลายเซ็น/รูปสินค้าใหม่ขึ้นที่เก็บ (key ขึ้นต้นด้วยรหัสบริษัท) · รูปเดิมในฐานข้อมูลยังอ่านได้ · บริษัทอื่นอ่าน/ลบไม่ได้
 * · รูปเต็มส่งต่อไปที่อยู่แบบเซ็นอายุสั้น · คำสั่งย้ายรูปเดิม (files-migrate) ทดลองก่อนเสมอ
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { openDatabase, type Database } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { r2FileStore, type FetchLike } from '../src/storage/files.js';
import { migrateFiles } from '../src/storage/migrate-files.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const objects = new Map<string, { body: Buffer; type: string }>();
const fakeR2: FetchLike = async (url, init) => {
  const path = decodeURIComponent(new URL(url).pathname);
  const res = (status: number, body: Buffer = Buffer.alloc(0), type?: string) => ({
    status, headers: { get: (n: string) => (n === 'content-type' ? type ?? null : null) },
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length) as ArrayBuffer, text: async () => '',
  });
  if (init.method === 'PUT') { objects.set(path, { body: init.body!, type: init.headers['content-type']! }); return res(200); }
  if (init.method === 'GET') { const o = objects.get(path); return o ? res(200, o.body, o.type) : res(404); }
  if (init.method === 'DELETE') { objects.delete(path); return res(204); }
  return res(405);
};
const store = r2FileStore({ accountId: '0123456789abcdef0123456789abcdef', bucket: 'buddy-test', accessKeyId: 'K', secretAccessKey: 'S' }, fakeR2);
const keysOf = (companyId: string) => [...objects.keys()].filter((k) => k.startsWith(`/buddy-test/${companyId}/`));

let database: Database;
let app: FastifyInstance;
let cookie = '';
async function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown) {
  const r = await app.inject({ method, url, payload: body as object, headers: cookie ? { cookie } : {} });
  const set = r.headers['set-cookie'];
  if (set) cookie = (Array.isArray(set) ? set[0]! : set).split(';')[0]!;
  return { status: r.statusCode, headers: r.headers, body: r.body && String(r.headers['content-type']).includes('json') ? JSON.parse(r.body) : r.rawPayload };
}

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.BUDDY_REQUIRE_ADMIN_2FA = '0';
  process.env.BUDDY_SECRET_KEY ??= Buffer.alloc(32, 7).toString('base64');
  const cfg = { ...loadConfig({}), databaseUrl: undefined, dataDir: 'memory://' };
  database = await openDatabase(cfg);
  await migrate(database, cfg.migrationsDir, () => {});
  app = await buildApp(database, cfg, { files: store });
}, 120_000);
afterAll(async () => { await app?.close(); await database?.close(); });

describe('file storage on R2 through the Buddy API (docs/20 §9)', () => {
  const co: Record<'A' | 'B', string> = { A: '', B: '' };
  let legacyImage = '';
  let newImage = '';
  it('a new logo and signature go to R2 under the company prefix; the row keeps only the key', async () => {
    expect((await call('POST', '/api/v1/setup', { username: 'admin', display_name: 'ผู้ดูแล', password: 'secret123' })).status).toBe(200);
    for (const k of ['A', 'B'] as const) co[k] = (await call('POST', '/api/v1/companies', { code: `R2${k}`, name_th: `บริษัท ${k}`, fiscal_start: '2026-01-01', chart: 'express' })).body.id;
    await call('POST', '/api/v1/auth/select', { company_id: co.A });
    // รูปเดิมในฐานข้อมูล (ก่อนเปิด R2) ต้องยังใช้ได้
    await sql`INSERT INTO sys_company_image (company_id, kind, name, mime, data, bytes) VALUES (${co.A}, 'SIGN', 'ผู้รับเงิน (เดิม)', 'image/png', ${PNG.split(',')[1]!}, 70)`.execute(database.raw);
    expect((await call('PUT', '/api/v1/company-images/logo', { data: PNG })).status).toBe(200);
    expect((await call('POST', '/api/v1/company-images/signs', { name: 'กรรมการผู้จัดการ', data: PNG })).status).toBe(200);
    expect(keysOf(co.A).map((k) => k.split('/')[3])).toEqual(['logo', 'sign']);
    const rows = (await sql<{ kind: string; data: string; storage_key: string | null }>`SELECT kind, data, storage_key FROM sys_company_image WHERE company_id = ${co.A} ORDER BY kind, name`.execute(database.raw)).rows;
    expect(rows.map((r) => [r.kind, r.data === '' ? 'empty' : 'inline', r.storage_key?.startsWith(`${co.A}/`) ?? null])).toEqual([['LOGO', 'empty', true], ['SIGN', 'empty', true], ['SIGN', 'inline', null]]);
    // อ่านกลับเป็น data URL เหมือนเดิม (ทั้งรูปใน R2 และรูปเดิมในฐานข้อมูล)
    const list = (await call('GET', '/api/v1/company-images')).body as Array<{ kind: string; data: string; storage_key?: string }>;
    expect(list.map((x) => [x.kind, x.data === PNG, 'storage_key' in x])).toEqual([['LOGO', true, false], ['SIGN', true, false], ['SIGN', true, false]]);
    // แทนโลโก้ = ไฟล์เดิมใน R2 ถูกลบ
    expect((await call('PUT', '/api/v1/company-images/logo', { data: PNG })).status).toBe(200);
    expect(keysOf(co.A)).toHaveLength(2);
  });

  it('item image: the full image redirects to a short-lived signed URL; another company gets 404', async () => {
    const item = (await sql<{ id: string }>`INSERT INTO md_item (company_id, code, name_th, item_type) VALUES (${co.A}, 'R2-ITEM', 'สินค้ามีรูป', '0') RETURNING id`.execute(database.raw)).rows[0]!.id;
    legacyImage = (await sql<{ id: string }>`INSERT INTO md_item_image (company_id, item_id, line_no, is_main, mime, data, thumb, bytes) VALUES (${co.A}, ${item}, 1, true, 'image/png', ${PNG.split(',')[1]!}, ${PNG}, 70) RETURNING id`.execute(database.raw)).rows[0]!.id;
    const add = await call('POST', `/api/v1/items/${item}/images`, { data: PNG, thumb: PNG });
    expect([add.status, add.body?.error?.message]).toEqual([200, undefined]);
    newImage = add.body.id;
    const full = await call('GET', `/api/v1/item-images/${newImage}`);
    expect(full.status).toBe(302);
    expect(String(full.headers.location)).toMatch(new RegExp(`^https://0123456789abcdef0123456789abcdef\\.r2\\.cloudflarestorage\\.com/buddy-test/${co.A}/item-image/[0-9a-f-]{36}\\.png\\?X-Amz-Algorithm=AWS4-HMAC-SHA256&.*X-Amz-Expires=300&`));
    expect((await call('GET', `/api/v1/item-images/${newImage}?size=thumb`)).status).toBe(200);
    const old = await call('GET', `/api/v1/item-images/${legacyImage}`);
    expect([old.status, old.headers['content-type']]).toEqual([200, 'image/png']);
    // บริษัทอื่น: อ่านรูป / ลบรูปของบริษัท A ไม่ได้
    await call('POST', '/api/v1/auth/select', { company_id: co.B });
    expect((await call('GET', `/api/v1/item-images/${newImage}`)).status).toBe(404);
    expect((await call('GET', `/api/v1/item-images/${legacyImage}`)).status).toBe(404);
    expect((await call('DELETE', `/api/v1/items/${item}/images/${newImage}`)).status).toBe(404);
    expect((await call('GET', '/api/v1/company-images')).body).toEqual([]);
    // key ของบริษัท A ที่ไปอยู่ในแถวของบริษัท B ก็อ่านไม่ได้ (ตรวจ key กับบริษัทของ session)
    const aKey = (await sql<{ k: string }>`SELECT storage_key AS k FROM md_item_image WHERE id = ${newImage}`.execute(database.raw)).rows[0]!.k;
    await sql`INSERT INTO sys_company_image (company_id, kind, name, mime, data, storage_key, bytes) VALUES (${co.B}, 'LOGO', 'LOGO', 'image/png', '', ${aKey}, 70)`.execute(database.raw);
    expect((await call('GET', '/api/v1/company-images')).status).toBe(404);
    await sql`DELETE FROM sys_company_image WHERE company_id = ${co.B}`.execute(database.raw);
    await call('POST', '/api/v1/auth/select', { company_id: co.A });
    expect((await call('DELETE', `/api/v1/items/${item}/images/${newImage}`)).status).toBe(200);
    expect(keysOf(co.A).filter((k) => k.includes('/item-image/'))).toHaveLength(0);
  });

  it('files-migrate: dry run by default, then moves the old inline images to R2 and they still read the same', async () => {
    const dry = await migrateFiles(database, store, { apply: false, log: () => {} });
    expect(dry.map((x) => [x.table, x.rows])).toEqual([['sys_company_image', 1], ['md_item_image', 1]]);
    expect(keysOf(co.A)).toHaveLength(2);
    const done = await migrateFiles(database, store, { apply: true, log: () => {} });
    expect(done.map((x) => [x.table, x.moved])).toEqual([['sys_company_image', 1], ['md_item_image', 1]]);
    expect(keysOf(co.A)).toHaveLength(4);
    expect((await migrateFiles(database, store, { apply: false, log: () => {} })).map((x) => x.rows)).toEqual([0, 0]);
    const list = (await call('GET', '/api/v1/company-images')).body as Array<{ data: string }>;
    expect(list.every((x) => x.data === PNG)).toBe(true);
    expect((await call('GET', `/api/v1/item-images/${legacyImage}`)).status).toBe(302);
  });
});
