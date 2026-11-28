/**
 * HANDOFF 208 ข้อ C (เจ้าของ 28/11/2569 "ทั้งสอง กลุ่มสิทธิผู้ใช้ไม่เหมือนกัน ขอเพิ่มการตั้งต้นให้ด้วยได้หรือไม่ทุกบริษัทลูกค้า")
 * C1 ลูกค้าใหม่ได้กลุ่มตั้งต้นครบ (รวม DEFAULT ตอนตั้งเครื่องใหม่) · C2 บริษัทใหม่ได้สิทธิ์ของกลุ่มตั้งต้น
 * C3 migration 0087: ลูกค้าเดิมได้เฉพาะกลุ่มที่ขาด + สิทธิ์ของกลุ่มที่เพิ่ม — กลุ่มที่ตั้งเอง/แก้แล้ว/ลบแล้วไม่แตะ · รันซ้ำไม่เพิ่ม · ลูกค้าเห็นรายการของตัวเองเท่านั้น
 */
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { openDatabase, type Database } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { STANDARD_GROUPS } from '../src/standard-groups.js';

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
const as = async (u: string, p: string) => { cookie = ''; const r = await call('POST', '/api/v1/auth/login', { username: u, password: p }); expect(r.status, r.raw).toBe(200); return cookie; };
const q = async <T>(s: ReturnType<typeof sql<T>>) => (await s.execute(database.db)).rows;
const STD = STANDARD_GROUPS.map((g) => g.code).sort();

/** กลุ่มของลูกค้า: รหัส → { id, name, deleted } */
const groupsOf = async (tenantId: string) => q(sql<{ id: string; code: string; name: string; deleted: boolean }>`SELECT id, code, name, deleted_at IS NOT NULL AS deleted FROM sys_user_group WHERE tenant_id = ${tenantId} ORDER BY code, created_at`);
/** แถวสิทธิ์ของกลุ่มในบริษัท เป็นข้อความเทียบได้ (เมนู + ช่องสิทธิ์) */
const rightsOf = async (groupId: string, companyId: string) => (await q(sql<{ k: string }>`SELECT m.code || ':' || concat_ws(',', coalesce(p.can_read, '-'), coalesce(p.can_add, '-'), coalesce(p.can_edit, '-'), coalesce(p.can_cancel, '-'),
    coalesce(p.can_delete, '-'), coalesce(p.can_print, '-'), coalesce(p.can_approve, '-')) AS k
    FROM sys_permission p JOIN sys_menu m ON m.id = p.menu_id WHERE p.subject_type = 'G' AND p.subject_id = ${groupId} AND p.company_id = ${companyId} AND p.deleted_at IS NULL ORDER BY 1`)).map((r) => r.k);
/** ทุกแถวสิทธิ์ของกลุ่มในลูกค้า (รวม id) — เทียบว่าไม่ถูกแตะ */
const snapshot = async (tenantId: string) => q(sql<{ s: string }>`SELECT g.id || '|' || g.code || '|' || g.name || '|' || coalesce(g.deleted_at::text, '') || '|' || g.row_version || '|' || coalesce(string_agg(p.id || ':' || coalesce(p.can_read, '') || coalesce(p.can_add, '') || coalesce(p.can_print, '') || p.row_version, ',' ORDER BY p.id), '') AS s
    FROM sys_user_group g LEFT JOIN sys_permission p ON p.subject_type = 'G' AND p.subject_id = g.id WHERE g.tenant_id IS NOT DISTINCT FROM ${tenantId} GROUP BY g.id ORDER BY g.id`);

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

describe('HANDOFF 208 C: standard user groups for every customer', () => {
  const ids: Record<string, string> = {};
  let provider = '';

  it('C1: first-time setup (DEFAULT) and a new customer get all standard groups; C2: every new company gets their rights rows', async () => {
    expect((await call('POST', '/api/v1/setup', { username: 'admin', display_name: 'ผู้ดูแลผู้ให้บริการ', password: 'secret123' })).status).toBe(200);
    provider = cookie;
    ids.def = (await q(sql<{ id: string }>`SELECT id FROM sys_tenant WHERE code = 'DEFAULT'`))[0]!.id;
    expect((await groupsOf(ids.def)).map((g) => g.code).sort()).toEqual(STD);
    // ลูกค้าใหม่ (ข้อมูลตัวอย่าง — ตั้งรหัสผ่านผู้ดูแลได้ในชุดทดสอบ): ADMIN + กลุ่มตั้งต้นครบ
    for (const code of ['T1', 'T2']) {
      const r = await call('POST', '/api/v1/tenants', { is_demo: true, code, name: `ลูกค้า ${code}`, admin_username: `${code.toLowerCase()}.admin`, admin_name: `ผู้ดูแล ${code}`, admin_password: `pass${code}12345` });
      expect(r.status, r.raw).toBe(200);
      ids[code] = r.body.id;
      expect((await groupsOf(r.body.id)).map((g) => g.code).sort()).toEqual(['ADMIN', ...STD].sort());
    }
    // ลูกค้าจริง (ผู้ดูแลตั้งรหัสผ่านเองจากอีเมล): กลุ่มตั้งต้นครบเหมือนกัน
    const real = await call('POST', '/api/v1/tenants', { code: 'R3', name: 'ลูกค้าจริง R3', contact_email: 'owner@r3.example', admin_username: 'r3.admin', admin_name: 'ผู้ดูแล R3' });
    expect(real.status, real.raw).toBe(200);
    ids.R3 = real.body.id;
    expect((await groupsOf(ids.R3!)).map((g) => g.code).sort()).toEqual(['ADMIN', ...STD].sort());
    // บริษัทใหม่ทุกบริษัทของลูกค้า: กลุ่มตั้งต้นได้สิทธิ์ตาม STANDARD_GROUPS
    const menus = new Set((await q(sql<{ code: string }>`SELECT code FROM sys_menu WHERE deleted_at IS NULL`)).map((m) => m.code));
    for (const code of ['T1', 'T2']) {
      await as(`${code.toLowerCase()}.admin`, `pass${code}12345`);
      for (const n of [1, 2]) {
        const c = await call('POST', '/api/v1/companies', { code: `${code}C${n}`, name_th: `บริษัท ${code} ${n} จำกัด`, fiscal_start: '2026-01-01', chart: 'express' });
        expect(c.status, c.raw).toBe(200);
        ids[`${code}C${n}`] = c.body.id;
        for (const g of await groupsOf(ids[code]!)) {
          if (g.code === 'ADMIN') continue;
          const want = STANDARD_GROUPS.find((x) => x.code === g.code)!.rows.filter((r) => menus.has(r.menu));
          expect([g.code, (await rightsOf(g.id, c.body.id)).length]).toEqual([g.code, want.length]);
        }
      }
    }
  });

  it('C3: migration 0087 adds only missing groups (+ their rights in every company), keeps customised / deleted / provider groups as they are, logs once per customer, is idempotent and stays per customer', async () => {
    // ลูกค้าเดิมก่อนมีกลุ่มตั้งต้น: T2 เหลือ ADMIN + SALE ที่ตั้งเอง (ชื่อและสิทธิ์ของตัวเอง) + EXC ที่ตั้งเอง + HR ที่ลบไปแล้ว · R3 ไม่มีกลุ่มตั้งต้นเลย
    const t2 = await groupsOf(ids.T2!);
    const drop = t2.filter((g) => !['ADMIN', 'SALE', 'HR'].includes(g.code)).map((g) => g.id);
    const r3drop = (await groupsOf(ids.R3!)).filter((g) => g.code !== 'ADMIN').map((g) => g.id);
    await sql`DELETE FROM sys_permission WHERE subject_id = ANY(${[...drop, ...r3drop]}::uuid[])`.execute(database.db);
    await sql`DELETE FROM sys_user_group WHERE id = ANY(${[...drop, ...r3drop]}::uuid[])`.execute(database.db);
    const sale = t2.find((g) => g.code === 'SALE')!.id, hr = t2.find((g) => g.code === 'HR')!.id;
    await sql`UPDATE sys_user_group SET name = 'ขายของเราเอง' WHERE id = ${sale}`.execute(database.db);
    await sql`DELETE FROM sys_permission WHERE subject_id = ${sale} AND company_id = ${ids.T2C2}`.execute(database.db);   // ตั้งให้เข้าได้เฉพาะบริษัทแรก
    await sql`UPDATE sys_permission SET can_add = NULL, can_edit = NULL WHERE subject_id = ${sale}`.execute(database.db);   // แก้สิทธิ์เอง
    await sql`UPDATE sys_user_group SET deleted_at = now() WHERE id = ${hr}`.execute(database.db);   // ลูกค้าลบเอง
    await sql`UPDATE sys_permission SET deleted_at = now() WHERE subject_id = ${hr}`.execute(database.db);
    cookie = provider;
    const exc = await sql<{ id: string }>`INSERT INTO sys_user_group (tenant_id, code, name) VALUES (${ids.T2}, 'EXC', 'ผู้บริหาร') RETURNING id`.execute(database.db);
    expect(exc.rows.length).toBe(1);
    const before = { T1: await snapshot(ids.T1!), T2: await snapshot(ids.T2!), DEF: await snapshot(ids.def!), staff: await snapshot(null as unknown as string) };
    const logs0 = Number((await q(sql<{ n: number }>`SELECT count(*)::int AS n FROM sys_activity_log`))[0]!.n);

    const m0087 = await readFile(new URL('../../../db/migrations/0087_standard_groups_every_tenant.sql', import.meta.url), 'utf8');
    await database.execScript(m0087);

    // T1 DEFAULT ผู้ให้บริการ: ครบอยู่แล้ว — ไม่เปลี่ยนเลย
    expect(await snapshot(ids.T1!)).toEqual(before.T1);
    expect(await snapshot(ids.def!)).toEqual(before.DEF);
    expect(await snapshot(null as unknown as string)).toEqual(before.staff);
    // T2: เพิ่ม ACC FIN GA PURCH VIEW · SALE (ตั้งเอง) EXC ADMIN ไม่แตะ · HR ที่ลบแล้วไม่สร้างคืน
    const after = await groupsOf(ids.T2!);
    expect(after.filter((g) => !g.deleted).map((g) => g.code).sort()).toEqual(['ACC', 'ADMIN', 'EXC', 'FIN', 'GA', 'PURCH', 'SALE', 'VIEW']);
    expect(after.filter((g) => g.code === 'HR').map((g) => g.deleted)).toEqual([true]);
    const keptT2 = (await snapshot(ids.T2!)).filter((r) => before.T2.some((b) => b.s.split('|')[0] === r.s.split('|')[0]));
    expect(keptT2).toEqual(before.T2);   // กลุ่ม/สิทธิ์เดิมทุกแถวเหมือนเดิม (ชื่อ สิทธิ์ row_version)
    // สิทธิ์ของกลุ่มที่เพิ่ม = แบบเดียวกับลูกค้าใหม่ (T1) ทุกบริษัทของ T2
    for (const code of ['ACC', 'FIN', 'GA', 'PURCH', 'VIEW']) {
      const g2 = after.find((g) => g.code === code)!.id, g1 = (await groupsOf(ids.T1!)).find((g) => g.code === code)!.id;
      const want = await rightsOf(g1, ids.T1C1!);
      expect(want.length).toBeGreaterThan(0);
      for (const co of [ids.T2C1!, ids.T2C2!]) expect([code, await rightsOf(g2, co)]).toEqual([code, want]);
    }
    // R3 (ลูกค้าจริง ยังไม่มีบริษัท): กลุ่มตั้งต้นครบ ยังไม่มีแถวสิทธิ์
    expect((await groupsOf(ids.R3!)).map((g) => g.code).sort()).toEqual(['ADMIN', ...STD].sort());
    // แฟ้มบันทึกเหตุการณ์: 1 แถวต่อลูกค้าที่ได้กลุ่มเพิ่ม
    const logs = await q(sql<{ doc_no: string; row_id: string; detail: { created: string[]; rows: number; via: string; companies: number } }>`SELECT doc_no, row_id, detail FROM sys_activity_log WHERE action = 'STD_GROUPS_ADDED' ORDER BY doc_no`);
    const perGroup = (c: string) => STANDARD_GROUPS.find((g) => g.code === c)!.rows.length;
    expect(logs.map((l) => [l.doc_no, l.detail.created, l.detail.rows, l.detail.companies, l.detail.via])).toEqual([
      ['R3', STD, 0, 0, 'migration'],
      ['T2', ['ACC', 'FIN', 'GA', 'PURCH', 'VIEW'], 2 * ['ACC', 'FIN', 'GA', 'PURCH', 'VIEW'].reduce((s, c) => s + perGroup(c), 0), 2, 'migration'],
    ]);
    // รันซ้ำ: ไม่เพิ่มอะไร
    const again = { T2: await snapshot(ids.T2!), R3: await snapshot(ids.R3!), logs: Number((await q(sql<{ n: number }>`SELECT count(*)::int AS n FROM sys_activity_log`))[0]!.n) };
    expect(again.logs).toBe(logs0 + 2);
    await database.execScript(m0087);
    expect({ T2: await snapshot(ids.T2!), R3: await snapshot(ids.R3!), logs: Number((await q(sql<{ n: number }>`SELECT count(*)::int AS n FROM sys_activity_log`))[0]!.n) }).toEqual(again);

    // ลูกค้าเห็นรายการของตัวเองที่ สิ่งที่ผู้ให้บริการทำกับบัญชีของท่าน (ข้ามลูกค้าไม่ได้ · ข้อ 7.1)
    await as('t2.admin', 'passT212345');
    const mine2 = (await call('GET', '/api/v1/provider-actions/mine')).body;
    const row = mine2.rows.find((r: { action: string }) => r.action === 'STD_GROUPS_ADDED');
    expect(row).toMatchObject({ doc_no: 'T2', staff_name: 'ปรับปรุงโปรแกรม', info: { groups: 'ACC FIN GA PURCH VIEW', via: 'migration' } });
    expect(JSON.stringify(mine2)).not.toMatch(/"R3"|"T1"/);
    await as('t1.admin', 'passT112345');
    expect((await call('GET', '/api/v1/provider-actions/mine')).body.rows.some((r: { action: string }) => r.action === 'STD_GROUPS_ADDED')).toBe(false);
    // ผู้ให้บริการเห็นทั้ง 2 ลูกค้าในรายการงานระดับบัญชี
    cookie = provider;
    const pv = (await call('GET', '/api/v1/provider/actions?action=STD_GROUPS_ADDED')).body;
    expect(pv.rows.map((r: { tenant_code: string }) => r.tenant_code).sort()).toEqual(['R3', 'T2']);
    // นำแฟ้มสำรองผู้ใช้รุ่นก่อน 0087 กลับ (USER_STEPS n 87): เพิ่มที่ขาดเฉพาะลูกค้ารายนั้น
    const { USER_STEPS } = await import('../src/modules/backup.js');
    const r3g = (await groupsOf(ids.R3!)).filter((g) => g.code !== 'ADMIN').map((g) => g.id);
    await sql`DELETE FROM sys_user_group WHERE id = ANY(${r3g}::uuid[])`.execute(database.db);
    const t1Before = await snapshot(ids.T1!), t2Before = await snapshot(ids.T2!);
    await database.db.transaction().execute((tx) => USER_STEPS.find((x) => x.n === 87)!.run(tx, ids.R3!));
    expect((await groupsOf(ids.R3!)).map((g) => g.code).sort()).toEqual(['ADMIN', ...STD].sort());
    expect([await snapshot(ids.T1!), await snapshot(ids.T2!)]).toEqual([t1Before, t2Before]);
    // ปุ่ม "+ กลุ่มตั้งต้น" (C4) ยังสร้างคืนกลุ่มที่ลูกค้าลบได้
    await as('t2.admin', 'passT212345');
    await call('POST', '/api/v1/auth/select', { company_id: ids.T2C1 });
    expect((await call('POST', '/api/v1/user-groups/standard')).body.created).toEqual(['HR']);
  });
});
