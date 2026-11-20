/**
 * กันบอท + จำกัดจำนวนครั้ง (HANDOFF 165) — Turnstile (ทดแทนการเรียก Cloudflare) และอัตราต่อ IP/รหัสผู้ใช้ · IP ปลอมใน X-Forwarded-For ไม่ช่วยหลบ
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDatabase, type Database } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { LIMITS, resetRateLimits, setTurnstileVerifier } from '../src/botguard.js';

let database: Database;
let app: FastifyInstance;
const hit = async (url: string, body: unknown, ip = '203.0.113.7', headers: Record<string, string> = {}) => {
  const r = await app.inject({ method: 'POST', url, payload: body as object, remoteAddress: ip, headers });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null, retry: r.headers['retry-after'], cookie: (r.headers['set-cookie'] as string | string[] | undefined) };
};

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.BUDDY_REQUIRE_ADMIN_2FA = '0';
  process.env.BUDDY_SECRET_KEY ??= Buffer.alloc(32, 7).toString('base64');
  const cfg = { ...loadConfig({}), databaseUrl: undefined, dataDir: 'memory://', signup: 'review' as const };
  database = await openDatabase(cfg);
  await migrate(database, cfg.migrationsDir, () => {});
  app = await buildApp(database, cfg);
  expect((await hit('/api/v1/setup', { username: 'admin', display_name: 'ผู้ดูแล', password: 'secret123' }, '127.0.0.1')).status).toBe(200);
}, 120_000);
afterAll(async () => { delete process.env.BUDDY_RATE_LIMIT; delete process.env.TURNSTILE_SITE_KEY; delete process.env.TURNSTILE_SECRET; setTurnstileVerifier(null); await app?.close(); await database?.close(); });
beforeEach(() => { resetRateLimits(); process.env.BUDDY_RATE_LIMIT = 'on'; delete process.env.TURNSTILE_SITE_KEY; delete process.env.TURNSTILE_SECRET; });

describe('bot protection + rate limits (HANDOFF 165)', () => {
  it('login: per username, then 429 with a Thai "try again in N minutes" and Retry-After; other usernames still work', async () => {
    const L = LIMITS['login-user'];
    for (let i = 0; i < L.max; i++) expect((await hit('/api/v1/auth/login', { username: 'ghost', password: 'nope' })).status).toBe(401);
    const r = await hit('/api/v1/auth/login', { username: 'GHOST', password: 'nope' });   // ไม่สนตัวพิมพ์
    expect([r.status, r.body.error.code]).toEqual([429, 'RATE_LIMITED']);
    expect(r.body.error.message).toMatch(/บ่อยเกินไป — ลองใหม่ในอีก \d+ นาที/);
    expect(Number(r.retry)).toBeGreaterThan(0);
    expect((await hit('/api/v1/auth/login', { username: 'admin', password: 'secret123' })).status).toBe(200);
  });
  it('login: per IP across usernames; a spoofed X-Forwarded-For does not help (proxy not trusted); another IP is fine', async () => {
    const L = LIMITS['login-ip'];
    for (let i = 0; i < L.max; i++) await hit('/api/v1/auth/login', { username: `u${i}`, password: 'x' }, '198.51.100.9', { 'x-forwarded-for': `10.9.${i}.1` });
    const r = await hit('/api/v1/auth/login', { username: 'admin', password: 'secret123' }, '198.51.100.9', { 'x-forwarded-for': '10.200.0.1' });
    expect([r.status, r.body.error.code]).toEqual([429, 'RATE_LIMITED']);
    expect((await hit('/api/v1/auth/login', { username: 'admin', password: 'secret123' }, '198.51.100.10')).status).toBe(200);
  });
  it('2FA step, signup and change password are limited too; off when BUDDY_RATE_LIMIT=off', async () => {
    for (let i = 0; i < LIMITS['totp-ip'].max; i++) await hit('/api/v1/auth/login/totp', { ticket: 'x'.repeat(20), code: '000000' });
    expect((await hit('/api/v1/auth/login/totp', { ticket: 'x'.repeat(20), code: '000000' })).status).toBe(429);
    const form = (n: number) => ({ business_name: `ร้าน ${n}`, contact_name: 'คุณทดสอบ', contact_email: `bot${n}@example.com`, contact_phone: '081-234-5678', username: `bot.${n}`, password: 'Signup-Pass99', accept_terms: true });
    let last = 0;
    for (let i = 0; i <= LIMITS['signup-ip'].max; i++) last = (await hit('/api/v1/signup', form(i), '192.0.2.44')).status;
    expect(last).toBe(429);
    const login = await hit('/api/v1/auth/login', { username: 'admin', password: 'secret123' }, '192.0.2.50');
    const cookie = String([login.cookie].flat()[0]).split(';')[0]!;
    for (let i = 0; i < LIMITS['password-user'].max; i++) await hit('/api/v1/auth/password', { old_password: 'wrong', new_password: 'NewPass-165x' }, '192.0.2.50', { cookie });
    expect((await hit('/api/v1/auth/password', { old_password: 'wrong', new_password: 'NewPass-165x' }, '192.0.2.50', { cookie })).status).toBe(429);
    process.env.BUDDY_RATE_LIMIT = 'off';
    expect((await hit('/api/v1/auth/password', { old_password: 'wrong', new_password: 'NewPass-165x' }, '192.0.2.50', { cookie })).status).toBe(400);
  });
  it('Turnstile: hidden and skipped without keys; with keys login/signup need a valid token; Cloudflare down = 503', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/bot-check' })).json()).toEqual({ site_key: null });
    process.env.TURNSTILE_SITE_KEY = '0x4AAAAAAAtest'; process.env.TURNSTILE_SECRET = 'test-secret';
    setTurnstileVerifier(async (token, ip, sec) => { if (token === 'down') throw new Error('offline'); return token === 'good' && sec === 'test-secret' && !!ip; });
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/bot-check' })).json()).toEqual({ site_key: '0x4AAAAAAAtest' });
    const none = await hit('/api/v1/auth/login', { username: 'admin', password: 'secret123' });
    expect([none.status, none.body.error.code]).toEqual([400, 'BOT_CHECK']);
    expect((await hit('/api/v1/auth/login', { username: 'admin', password: 'secret123', turnstile: 'bad' })).body.error.message).toMatch(/ไม่ผ่าน/);
    expect((await hit('/api/v1/auth/login', { username: 'admin', password: 'secret123', turnstile: 'down' })).status).toBe(503);
    expect((await hit('/api/v1/auth/login', { username: 'admin', password: 'secret123', turnstile: 'good' })).status).toBe(200);
    const s = { business_name: 'ร้านบอท', contact_name: 'คุณบอท', contact_email: 'bot@example.com', contact_phone: '081-234-5678', username: 'bot.x', password: 'Signup-Pass99', accept_terms: true };
    expect((await hit('/api/v1/signup', s, '192.0.2.77')).body.error.code).toBe('BOT_CHECK');
    expect((await hit('/api/v1/signup', { ...s, turnstile: 'good' }, '192.0.2.77')).status).toBe(200);
    setTurnstileVerifier(null);
  });
});
