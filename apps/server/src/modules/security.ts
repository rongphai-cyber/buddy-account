import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Db } from '../db.js';
import { AppError, badRequest, forbidden, notFound, parse, requireAuth, type AuthContext } from '../http.js';
import { logActivity } from '../audit.js';
import { decryptSecret, encryptSecret } from '../secret.js';

/**
 * ความปลอดภัยการเข้าระบบ (T0.16) — เจ้าของเลือก: ยืนยันตัวตนสองขั้นบังคับเฉพาะผู้ดูแลระบบ · ใส่รหัสผิด 5 ครั้งล็อก 15 นาที · ไม่บังคับเปลี่ยนรหัสตามรอบ
 * TOTP ตาม RFC 6238 (SHA-1, 6 หลัก, 30 วินาที — ใช้กับ Google/Microsoft Authenticator ได้) · กุญแจเข้ารหัสด้วยกุญแจหลักของเครื่องแม่ข่าย
 * BUDDY_REQUIRE_ADMIN_2FA=0 ปิดการบังคับ (ใช้กับเครื่องทดสอบอัตโนมัติเท่านั้น)
 */
export const MAX_FAILS = 5;
export const LOCK_MINUTES = 15;
const ISSUER = 'Buddy Account';
export const adminMfaRequired = () => process.env.BUDDY_REQUIRE_ADMIN_2FA !== '0';

/* ───────── TOTP ───────── */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf: Buffer): string {
  let bits = 0, val = 0, out = '';
  for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, val = 0; const out: number[] = [];
  for (const ch of clean) { val = (val << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
/** รหัส TOTP ของช่วงเวลา step (RFC 4226 dynamic truncation) */
export function totpAt(secret: Buffer, step: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', secret).update(msg).digest();
  const o = h[h.length - 1]! & 15;
  const n = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 10 ** digits).padStart(digits, '0');
}
export const stepOf = (ms = Date.now()) => Math.floor(ms / 30_000);
/** ตรวจรหัส (ยอมเวลาเครื่องคลาดได้ ±1 ช่วง) — คืนช่วงที่ตรง หรือ null · ช่วงที่ใช้ไปแล้วใช้ซ้ำไม่ได้ */
export function verifyTotp(secret: Buffer, code: string, lastStep: number | null, now = Date.now()): number | null {
  const c = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  for (const d of [0, -1, 1]) {
    const s = stepOf(now) + d;
    if (lastStep !== null && s <= lastStep) continue;
    const want = Buffer.from(totpAt(secret, s)), got = Buffer.from(c);
    if (timingSafeEqual(want, got)) return s;
  }
  return null;
}
const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const normRecovery = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
function newRecoveryCodes() {
  const codes = Array.from({ length: 10 }, () => { const h = randomBytes(5).toString('hex'); return `${h.slice(0, 5)}-${h.slice(5)}`; });
  return { codes, hashes: codes.map((c) => sha(normRecovery(c))) };
}

/* ───────── ข้อมูลความปลอดภัยของผู้ใช้ ───────── */
type Sec = { id: string; totp_secret_enc: string | null; totp_enabled: boolean; totp_last_step: string | null; totp_recovery: unknown; failed_logins: number; locked_until: string | null };
export async function secOf(db: Db, userId: string): Promise<Sec | undefined> {
  return db.selectFrom('sys_user_security').select(['id', 'totp_secret_enc', 'totp_enabled', 'totp_last_step', 'totp_recovery', 'failed_logins', 'locked_until'])
    .where('user_id', '=', userId).where('deleted_at', 'is', null).executeTakeFirst() as Promise<Sec | undefined>;
}
export async function setSec(db: Db, userId: string, patch: Record<string, unknown>) {
  const cur = await secOf(db, userId);
  if (cur) await db.updateTable('sys_user_security').set(patch as never).where('id', '=', cur.id).execute();
  else await db.insertInto('sys_user_security').values({ user_id: userId, ...patch } as never).execute();
}
export const lockedUntil = (s: Sec | undefined) => (s?.locked_until && new Date(s.locked_until).getTime() > Date.now() ? new Date(s.locked_until) : null);
const hhmm = (d: Date) => d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
export function lockedError(until: Date) {
  return new AppError(423, 'ACCOUNT_LOCKED', `บัญชีถูกล็อกชั่วคราวเพราะใส่รหัสผิด ${MAX_FAILS} ครั้ง — ลองใหม่หลัง ${hhmm(until)} น. หรือให้ผู้ดูแลระบบปลดล็อก`);
}
/** นับครั้งที่ผิด · ครบ 5 ครั้งล็อก 15 นาที (คืนเวลาที่ล็อก) */
export async function registerFail(db: Db, userId: string, ip: string | undefined): Promise<Date | null> {
  const cur = await secOf(db, userId);
  const n = (cur?.failed_logins ?? 0) + 1;
  if (n >= MAX_FAILS) {
    const until = new Date(Date.now() + LOCK_MINUTES * 60_000);
    await setSec(db, userId, { failed_logins: 0, locked_until: until.toISOString() });
    await logActivity(db, { companyId: null, userId }, { module: 'SYS', action: 'LOGIN_LOCKED', detail: { ip, minutes: LOCK_MINUTES } });
    return until;
  }
  await setSec(db, userId, { failed_logins: n });
  return null;
}
export async function clearFails(db: Db, userId: string) {
  const cur = await secOf(db, userId);
  if (cur && (cur.failed_logins || cur.locked_until)) await setSec(db, userId, { failed_logins: 0, locked_until: null });
}
export async function markPasswordChanged(db: Db, userId: string) { await setSec(db, userId, { password_changed_at: new Date().toISOString() }); }

/* ───────── เข้าระบบขั้นที่ 2 ───────── */
const pending = new Map<string, { userId: string; exp: number; workDate?: string; tries: number }>();
export function startSecondStep(userId: string, workDate?: string) {
  for (const [k, v] of pending) if (v.exp < Date.now()) pending.delete(k);
  const ticket = randomBytes(24).toString('base64url');
  pending.set(ticket, { userId, exp: Date.now() + 5 * 60_000, workDate, tries: 0 });
  return ticket;
}
/** ตรวจรหัสจากแอป (หรือรหัสสำรอง) ของการเข้าระบบที่รอขั้นที่ 2 — สำเร็จคืน userId */
export async function finishSecondStep(db: Db, ticket: string, code: string, ip: string | undefined): Promise<{ userId: string; workDate?: string; via: 'totp' | 'recovery' }> {
  const p = pending.get(ticket);
  if (!p || p.exp < Date.now()) { pending.delete(ticket); throw new AppError(401, 'MFA_EXPIRED', 'หมดเวลายืนยันตัวตน — เข้าสู่ระบบใหม่อีกครั้ง'); }
  const sec = await secOf(db, p.userId);
  const until = lockedUntil(sec);
  if (until) { pending.delete(ticket); throw lockedError(until); }
  if (!sec?.totp_enabled || !sec.totp_secret_enc) { pending.delete(ticket); throw new AppError(401, 'MFA_EXPIRED', 'เข้าสู่ระบบใหม่อีกครั้ง'); }
  const secret = decryptSecret(sec.totp_secret_enc);
  const step = secret ? verifyTotp(base32Decode(secret), code, sec.totp_last_step === null ? null : Number(sec.totp_last_step)) : null;
  if (step !== null) {
    await setSec(db, p.userId, { totp_last_step: String(step), failed_logins: 0, locked_until: null });
    pending.delete(ticket);
    return { userId: p.userId, workDate: p.workDate, via: 'totp' };
  }
  const hashes = Array.isArray(sec.totp_recovery) ? (sec.totp_recovery as string[]) : [];
  const h = sha(normRecovery(code));
  if (normRecovery(code).length === 10 && hashes.includes(h)) {
    await setSec(db, p.userId, { totp_recovery: JSON.stringify(hashes.filter((x) => x !== h)), failed_logins: 0, locked_until: null });
    pending.delete(ticket);
    await logActivity(db, { companyId: null, userId: p.userId }, { module: 'SYS', action: 'MFA_RECOVERY_USED', detail: { left: hashes.length - 1 } });
    return { userId: p.userId, workDate: p.workDate, via: 'recovery' };
  }
  p.tries++;
  const locked = await registerFail(db, p.userId, ip);
  if (locked) { pending.delete(ticket); throw lockedError(locked); }
  if (p.tries >= MAX_FAILS) pending.delete(ticket);
  throw new AppError(401, 'MFA_INVALID', 'รหัสยืนยันไม่ถูกต้อง — ใช้รหัส 6 หลักล่าสุดจากแอป (ตรวจเวลาในมือถือให้ตรง) หรือรหัสสำรอง');
}

/** ผู้ดูแลระบบที่ยังไม่ตั้งยืนยันตัวตนสองขั้น ใช้ได้เฉพาะ API เหล่านี้ */
export const MFA_SETUP_ALLOWED = new Set(['GET /api/v1/auth/me', 'POST /api/v1/auth/logout', 'GET /api/v1/auth/2fa', 'POST /api/v1/auth/2fa/setup', 'POST /api/v1/auth/2fa/enable', 'GET /api/v1/menu', 'POST /api/v1/auth/password']);
export function checkMfaGate(req: FastifyRequest, method: string, url: string) {
  if (req.auth?.mfaSetupRequired && !MFA_SETUP_ALLOWED.has(`${method} ${url}`))
    throw new AppError(403, 'MFA_SETUP_REQUIRED', 'ผู้ดูแลระบบต้องตั้งค่ายืนยันตัวตนสองขั้นก่อนใช้งาน — ทำตามขั้นตอนบนหน้าจอ');
}

async function checkPassword(db: Db, userId: string, password: string) {
  const u = await db.selectFrom('sys_user').select('password_hash').where('id', '=', userId).executeTakeFirstOrThrow();
  if (!u.password_hash || !(await bcrypt.compare(password, u.password_hash))) throw badRequest('รหัสผ่านไม่ถูกต้อง');
}

export function securityRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/v1/auth/2fa', async (req) => {
    const a = requireAuth(req);
    const s = await secOf(db, a.userId);
    return { enabled: !!s?.totp_enabled, required: a.isAdmin && adminMfaRequired(), recovery_left: Array.isArray(s?.totp_recovery) ? (s!.totp_recovery as string[]).length : 0 };
  });
  /** เริ่มตั้งค่า: สร้างกุญแจใหม่ (ยังไม่เปิดจนกว่าจะยืนยันรหัสจากแอป) */
  app.post('/api/v1/auth/2fa/setup', async (req) => {
    const a = requireAuth(req);
    const s = await secOf(db, a.userId);
    if (s?.totp_enabled) throw badRequest('เปิดยืนยันตัวตนสองขั้นอยู่แล้ว — ถ้าเปลี่ยนมือถือ ให้ปิดก่อนแล้วตั้งใหม่');
    const secret = base32Encode(randomBytes(20));
    await setSec(db, a.userId, { totp_secret_enc: encryptSecret(secret), totp_enabled: false, totp_last_step: null });
    const label = encodeURIComponent(`${ISSUER}:${a.username}`);
    return { secret, otpauth: `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=6&period=30` };
  });
  /** ยืนยันรหัสจากแอป → เปิดใช้ + รหัสสำรอง 10 ชุด (แสดงครั้งเดียว) */
  app.post('/api/v1/auth/2fa/enable', async (req) => {
    const a = requireAuth(req);
    const { code } = parse(z.object({ code: z.string().trim().min(1, 'ป้อนรหัส 6 หลักจากแอป') }), req.body);
    const s = await secOf(db, a.userId);
    const secret = s?.totp_secret_enc ? decryptSecret(s.totp_secret_enc) : null;
    if (!s || !secret || s.totp_enabled) throw badRequest('เริ่มตั้งค่าใหม่อีกครั้ง');
    const step = verifyTotp(base32Decode(secret), code, null);
    if (step === null) throw badRequest('รหัสไม่ถูกต้อง — ตรวจว่าเพิ่มกุญแจในแอปถูกต้อง และเวลาในมือถือตรงกับเวลาจริง');
    const r = newRecoveryCodes();
    await setSec(db, a.userId, { totp_enabled: true, totp_enabled_at: new Date().toISOString(), totp_last_step: String(step), totp_recovery: JSON.stringify(r.hashes) });
    await logActivity(db, a, { module: 'SYS', action: 'MFA_ENABLE' });
    return { recovery_codes: r.codes };
  });
  app.post('/api/v1/auth/2fa/recovery', async (req) => {
    const a = requireAuth(req);
    const { password } = parse(z.object({ password: z.string().min(1, 'ป้อนรหัสผ่าน') }), req.body);
    await checkPassword(db, a.userId, password);
    const s = await secOf(db, a.userId);
    if (!s?.totp_enabled) throw badRequest('ยังไม่ได้เปิดยืนยันตัวตนสองขั้น');
    const r = newRecoveryCodes();
    await setSec(db, a.userId, { totp_recovery: JSON.stringify(r.hashes) });
    await logActivity(db, a, { module: 'SYS', action: 'MFA_RECOVERY_NEW' });
    return { recovery_codes: r.codes };
  });
  app.post('/api/v1/auth/2fa/disable', async (req) => {
    const a = requireAuth(req);
    const { password } = parse(z.object({ password: z.string().min(1, 'ป้อนรหัสผ่าน') }), req.body);
    await checkPassword(db, a.userId, password);
    await setSec(db, a.userId, { totp_secret_enc: null, totp_enabled: false, totp_enabled_at: null, totp_last_step: null, totp_recovery: null });
    await logActivity(db, a, { module: 'SYS', action: 'MFA_DISABLE' });
    return { ok: true, required: a.isAdmin && adminMfaRequired() };
  });

  /** ผู้ดูแล: ปลดล็อก / ล้างยืนยันตัวตนสองขั้นของผู้ใช้ในลูกค้าเดียวกัน (ผู้ให้บริการทำได้ทุกราย) */
  const target = async (a: AuthContext, id: string) => {
    if (!a.isAdmin) throw forbidden('เฉพาะผู้ดูแลระบบ');
    const u = await db.selectFrom('sys_user').select(['id', 'username', 'tenant_id']).where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
    if (!u || (!a.isPlatform && u.tenant_id !== a.tenantId)) throw notFound('ผู้ใช้');
    return u;
  };
  app.post('/api/v1/users/:id/unlock', async (req) => {
    const a = requireAuth(req);
    const u = await target(a, parse(z.object({ id: z.string().uuid() }), req.params).id);
    await setSec(db, u.id, { failed_logins: 0, locked_until: null });
    await logActivity(db, a, { module: 'SET.SEC', action: 'USER_UNLOCK', docNo: u.username, table: 'sys_user', rowId: u.id });
    return { ok: true };
  });
  app.post('/api/v1/users/:id/reset-2fa', async (req) => {
    const a = requireAuth(req);
    const u = await target(a, parse(z.object({ id: z.string().uuid() }), req.params).id);
    if (u.id === a.userId) throw badRequest('ล้างของตัวเองไม่ได้ — ใช้ บัญชีของฉัน › ยืนยันตัวตนสองขั้น');
    await setSec(db, u.id, { totp_secret_enc: null, totp_enabled: false, totp_enabled_at: null, totp_last_step: null, totp_recovery: null });
    await sql`UPDATE sys_session SET ended_at = now() WHERE user_id = ${u.id} AND ended_at IS NULL`.execute(db);
    await logActivity(db, a, { module: 'SET.SEC', action: 'USER_RESET_2FA', docNo: u.username, table: 'sys_user', rowId: u.id });
    return { ok: true };
  });
}
