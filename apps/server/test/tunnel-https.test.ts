/**
 * เปิดหน้าจอ Buddy ผ่านอินเทอร์เน็ต (Cloudflare Tunnel buddyapp.worktruesolution.net · tools/tunnel/README.md · HANDOFF ข้อ 98)
 * cloudflared บนเครื่องนี้ส่งคำขอเข้ามาจาก 127.0.0.1 พร้อม X-Forwarded-Proto: https และ X-Forwarded-For: IP จริงของผู้ใช้
 *  - คุกกี้เข้าระบบเป็น Secure (ส่งเฉพาะ https) · ประวัติเข้าระบบ/session เก็บ IP จริง
 *  - เปิดในเครื่อง (http://localhost:4100 ไม่มี header) = เหมือนเดิม: คุกกี้ไม่ Secure
 *  - คำขอจากเครื่องอื่นในวงแลน (ไม่ใช่ 127.0.0.1) ส่ง header ปลอมมา = ไม่เชื่อ
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { openDatabase, type Database } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

let database: Database;
let app: FastifyInstance;

const login = (headers: Record<string, string>, remoteAddress = '127.0.0.1') =>
  app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'admin', password: 'secret123' }, headers, remoteAddress });
const cookieOf = (r: { headers: Record<string, unknown> }) => { const s = r.headers['set-cookie']; return String(Array.isArray(s) ? s[0] : s ?? ''); };
const lastIp = async () => (await sql<{ ip: string | null }>`SELECT detail->>'ip' AS ip FROM sys_activity_log WHERE action = 'LOGIN' ORDER BY seq DESC LIMIT 1`.execute(database.db)).rows[0]?.ip;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.BUDDY_REQUIRE_ADMIN_2FA = '0';
  process.env.BUDDY_SECRET_KEY ??= Buffer.alloc(32, 7).toString('base64');
  const cfg = { ...loadConfig({}), databaseUrl: undefined, dataDir: 'memory://' };
  database = await openDatabase(cfg);
  await migrate(database, cfg.migrationsDir, () => {});
  app = await buildApp(database, cfg);
  const r = await app.inject({ method: 'POST', url: '/api/v1/setup', payload: { username: 'admin', display_name: 'ผู้ดูแล', password: 'secret123' } });
  expect(r.statusCode).toBe(200);
}, 120_000);
afterAll(async () => { await app?.close(); await database?.close(); });

describe('หน้าจอ Buddy ผ่าน Cloudflare Tunnel (https)', () => {
  it('ผ่าน tunnel (127.0.0.1 + X-Forwarded-Proto https): คุกกี้ Secure · ประวัติเก็บ IP จริงของผู้ใช้', async () => {
    const r = await login({ 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.7', host: 'buddyapp.worktruesolution.net' });
    expect(r.statusCode).toBe(200);
    expect(cookieOf(r)).toMatch(/;\s*Secure/i);
    expect(cookieOf(r)).toMatch(/HttpOnly/i);
    expect(await lastIp()).toBe('203.0.113.7');
  });

  it('เปิดในเครื่อง (http ไม่มี header): คุกกี้ไม่ Secure เหมือนเดิม — เข้าระบบที่ http://localhost:4100 ได้', async () => {
    const r = await login({});
    expect(r.statusCode).toBe(200);
    expect(cookieOf(r)).not.toMatch(/Secure/i);
    expect(await lastIp()).toBe('127.0.0.1');
  });

  it('เครื่องอื่นในวงแลนส่ง X-Forwarded-* ปลอมมา = ไม่เชื่อ (IP ของเครื่องนั้น · คุกกี้ไม่ Secure)', async () => {
    const r = await login({ 'x-forwarded-proto': 'https', 'x-forwarded-for': '198.51.100.9' }, '192.168.1.50');
    expect(r.statusCode).toBe(200);
    expect(cookieOf(r)).not.toMatch(/Secure/i);
    expect(await lastIp()).toBe('192.168.1.50');
  });
});
