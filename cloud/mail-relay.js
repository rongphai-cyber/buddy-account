// ส่งอีเมลผ่าน Cloudflare Email Service (HANDOFF 187) — โปรแกรมใน container เรียก binding ของ Worker ตรงไม่ได้
// จึงส่งคำขอมาที่ POST /__wts/mail ของ Worker เอง แล้ว Worker เรียก env.EMAIL.send() (binding send_email ใน wrangler.jsonc)
// ยืนยันคำขอ: x-wts-mail-sig = hex(HMAC-SHA256(BUDDY_SECRET_KEY, `${x-wts-mail-ts}.${body}`)) · เวลา ±5 นาที — ค่าเดียวกับที่ Worker ส่งเข้า container อยู่แล้ว
// ไม่มี import ของ cloudflare: ชุดทดสอบของ server เรียกไฟล์นี้ได้ (apps/server/test/signup-mail.test.ts)

export const MAIL_PATH = '/__wts/mail';
const MAX_SKEW_MS = 5 * 60_000;
const MAX_RECIPIENTS = 10;

const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const fail = (status, code, message) => reply(status, { error: { code, message } });

async function hmacHex(key, msg) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
/** เทียบแบบเวลาคงที่ */
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}
const isEmail = (s) => typeof s === 'string' && s.length <= 254 && /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(s);

/** env: EMAIL (binding send_email) · BUDDY_SECRET_KEY · MAIL_FROM_DOMAIN (ไม่ตั้ง = worktruesolution.net) */
export async function mailRelay(request, env, now = Date.now()) {
  if (request.method !== 'POST') return fail(405, 'METHOD', 'ใช้ POST');
  if (!env.BUDDY_SECRET_KEY) return fail(503, 'NO_KEY', 'Worker ยังไม่มี BUDDY_SECRET_KEY');
  const ts = request.headers.get('x-wts-mail-ts') ?? '';
  const sig = request.headers.get('x-wts-mail-sig') ?? '';
  const body = await request.text();
  if (!/^\d{10,16}$/.test(ts) || Math.abs(now - Number(ts)) > MAX_SKEW_MS) return fail(401, 'MAIL_AUTH', 'คำขอส่งอีเมลหมดเวลาหรือไม่ถูกต้อง');
  if (!same(await hmacHex(env.BUDDY_SECRET_KEY, `${ts}.${body}`), sig)) return fail(401, 'MAIL_AUTH', 'ลายเซ็นคำขอส่งอีเมลไม่ถูกต้อง');
  if (!env.EMAIL) return fail(503, 'NO_EMAIL_BINDING', 'ยังไม่ได้ผูก send_email (EMAIL) ใน wrangler.jsonc หรือยังไม่ได้ deploy');
  let m;
  try { m = JSON.parse(body); } catch { return fail(400, 'BAD_JSON', 'เนื้อคำขอไม่ใช่ JSON'); }
  const domain = (env.MAIL_FROM_DOMAIN || 'worktruesolution.net').toLowerCase();
  const to = Array.isArray(m?.to) ? m.to : [];
  if (!to.length || to.length > MAX_RECIPIENTS || !to.every(isEmail)) return fail(400, 'BAD_RECIPIENTS', `ผู้รับ 1–${MAX_RECIPIENTS} อีเมลที่ถูกต้อง`);
  if (!isEmail(m.from) || !m.from.toLowerCase().endsWith(`@${domain}`)) return fail(400, 'BAD_FROM', `ผู้ส่งต้องเป็นอีเมลของ ${domain}`);
  if (typeof m.subject !== 'string' || !m.subject || m.subject.length > 998) return fail(400, 'BAD_SUBJECT', 'หัวเรื่องไม่ถูกต้อง');
  if (m.replyTo != null && !isEmail(m.replyTo)) return fail(400, 'BAD_REPLY_TO', 'Reply-To ไม่ถูกต้อง');
  try {
    const r = await env.EMAIL.send({ from: m.from, to, subject: m.subject, ...(m.html ? { html: String(m.html) } : {}), ...(m.text ? { text: String(m.text) } : {}), ...(m.replyTo ? { replyTo: m.replyTo } : {}) });
    return reply(200, { messageId: r?.messageId ?? null });
  } catch (e) {
    // รหัสของ Cloudflare เช่น E_SENDER_DOMAIN_NOT_AVAILABLE E_RATE_LIMIT_EXCEEDED — ไม่มีความลับ
    return fail(502, e?.code || 'SEND_FAILED', String(e?.message ?? e).slice(0, 300));
  }
}
