import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from './http.js';

/**
 * กันบอทและการเดารหัสผ่าน (HANDOFF 165) — เตรียมพร้อมก่อนเอาด่าน Cloudflare Access ออก (docs/21 ข้อ ช)
 * 1) Cloudflare Turnstile ที่หน้าเข้าระบบ/สมัครใช้งาน — ตั้ง TURNSTILE_SITE_KEY + TURNSTILE_SECRET (ไม่ตั้ง = ไม่แสดง ไม่ตรวจ เหมือนเดิม)
 * 2) จำกัดจำนวนครั้งต่อ IP และต่อรหัสผู้ใช้ (ในหน่วยความจำ — คลาวด์ container เดียว · เครื่องสำนักงานโปรแกรมเดียว) ซ้อนกับล็อกบัญชี 5 ครั้ง/15 นาทีเดิม
 * IP จริง: req.ip (Fastify trustProxy — คลาวด์: Worker เขียน X-Forwarded-For จาก CF-Connecting-IP ทุกครั้ง · เครื่องสำนักงาน: เชื่อเฉพาะ cloudflared ในเครื่อง)
 */

/* ------------------------------------------------------------------ Turnstile */
export const turnstileSiteKey = () => process.env.TURNSTILE_SITE_KEY?.trim() || null;
const secret = () => process.env.TURNSTILE_SECRET?.trim() || null;
type Verifier = (token: string, ip: string | undefined, secret: string) => Promise<boolean>;
const cloudflareVerify: Verifier = async (token, ip, sec) => {
  const body = new URLSearchParams({ secret: sec, response: token, ...(ip ? { remoteip: ip } : {}) });
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body, signal: AbortSignal.timeout(8000) });
  const j = (await r.json()) as { success?: boolean };
  return !!j.success;
};
let verifier: Verifier = cloudflareVerify;
/** ทดสอบ: แทนการเรียก Cloudflare (ไม่ออกอินเทอร์เน็ตในชุดทดสอบ) */
export function setTurnstileVerifier(v: Verifier | null) { verifier = v ?? cloudflareVerify; }

/** ตรวจเครื่องหมาย "ไม่ใช่บอท" ที่หน้าจอส่งมา (body.turnstile) — ไม่ตั้งกุญแจ = ข้าม */
export async function requireHuman(req: FastifyRequest) {
  const sec = secret();
  if (!sec || !turnstileSiteKey()) return;
  const token = (req.body as { turnstile?: unknown } | undefined)?.turnstile;
  if (typeof token !== 'string' || !token || token.length > 4096) throw new AppError(400, 'BOT_CHECK', 'ยืนยันว่าไม่ใช่บอทก่อน — รอช่องตรวจสอบ (Cloudflare) ขึ้นเครื่องหมายถูก แล้วกดอีกครั้ง');
  let ok = false;
  try { ok = await verifier(token, req.ip, sec); } catch { throw new AppError(503, 'BOT_CHECK_DOWN', 'ตรวจสอบว่าไม่ใช่บอทไม่สำเร็จ (ติดต่อ Cloudflare ไม่ได้) — ลองใหม่อีกครั้งในอีกสักครู่'); }
  if (!ok) throw new AppError(400, 'BOT_CHECK', 'ตรวจสอบว่าไม่ใช่บอทไม่ผ่าน หรือหมดเวลา — โหลดหน้านี้ใหม่ แล้วลองอีกครั้ง');
}

/* ------------------------------------------------------------------ Rate limit */
export type LimitName = 'login-ip' | 'login-user' | 'totp-ip' | 'signup-ip' | 'password-user';
/** จำนวนครั้งที่ยอม ต่อช่วงเวลา (นาที) — เกินแล้วรอจนครั้งแรกในช่วงพ้นไป */
export const LIMITS: Record<LimitName, { max: number; minutes: number; what: string }> = {
  'login-ip': { max: 30, minutes: 10, what: 'เข้าระบบจากเครื่องนี้' },
  'login-user': { max: 10, minutes: 10, what: 'เข้าระบบด้วยรหัสผู้ใช้นี้' },
  'totp-ip': { max: 20, minutes: 10, what: 'ใส่รหัสยืนยันตัวตนสองขั้นจากเครื่องนี้' },
  'signup-ip': { max: 10, minutes: 60, what: 'ส่งใบสมัครจากเครื่องนี้' },
  'password-user': { max: 10, minutes: 10, what: 'เปลี่ยนรหัสผ่าน' },
};
const hits = new Map<string, number[]>();
/** ปิดในชุดทดสอบเดิม (เข้าระบบซ้ำจาก IP เดียวหลายร้อยครั้ง) — ชุดทดสอบของข้อนี้เปิดด้วย BUDDY_RATE_LIMIT=on */
const enabled = () => process.env.BUDDY_RATE_LIMIT === 'on' || (process.env.BUDDY_RATE_LIMIT !== 'off' && process.env.NODE_ENV !== 'test');
export function resetRateLimits() { hits.clear(); }

/** นับครั้งนี้ — เกินกำหนด = 429 บอกว่าลองใหม่ได้เมื่อไร (ข้อความไทย + Retry-After) */
export function rateLimit(name: LimitName, key: string | null | undefined, reply?: FastifyReply) {
  if (!enabled() || !key) return;
  const L = LIMITS[name];
  const now = Date.now(), win = L.minutes * 60_000, k = `${name}|${key.toLowerCase()}`;
  const arr = (hits.get(k) ?? []).filter((t) => now - t < win);
  if (arr.length >= L.max) {
    const waitMin = Math.max(1, Math.ceil((arr[0]! + win - now) / 60_000));
    reply?.header('retry-after', String(waitMin * 60));
    hits.set(k, arr);
    throw new AppError(429, 'RATE_LIMITED', `${L.what}บ่อยเกินไป — ลองใหม่ในอีก ${waitMin} นาที (กันการเดารหัสผ่าน)`);
  }
  arr.push(now);
  hits.set(k, arr);
  if (hits.size > 50_000) for (const [kk, v] of hits) if (!v.some((t) => now - t < 3_600_000)) hits.delete(kk);   // ล้างของเก่า
}
