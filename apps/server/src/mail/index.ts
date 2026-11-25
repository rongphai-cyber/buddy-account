import { createHmac } from 'node:crypto';

/**
 * ส่งอีเมล (HANDOFF 187 · เจ้าของ 25/11/2569 "ระบบไม่ส่งอะไรตอบกลับลูกค้าทางอีเมล์")
 * ตัวส่ง (BUDDY_MAIL):
 *  - cloudflare = Cloudflare Email Service ผ่าน Worker (cloud/worker.js /__wts/mail เรียก binding send_email) — container เรียก binding ตรงไม่ได้
 *    ยืนยันคำขอด้วย HMAC-SHA256 ของ BUDDY_SECRET_KEY (Worker มีค่าเดียวกันอยู่แล้ว — ไม่ต้องสร้างความลับใหม่ ไม่ใช้ API token)
 *  - log (ค่าเริ่มต้น · เครื่องสำนักงาน) = ไม่ส่ง บันทึกอย่างเดียว ไม่ทำให้คำขอล้ม
 *  - memory (ชุดทดสอบ) = เก็บในหน่วยความจำให้ตรวจ
 * ส่งหลัง commit เสมอ (queueMail) — ส่งไม่สำเร็จไม่ย้อนการสมัคร/อนุมัติ · ผู้ให้บริการกดส่งอีกครั้งได้
 */
export interface MailMessage { from: string; to: string[]; replyTo?: string | null; subject: string; html: string; text: string }
export type MailResult = { status: 'S' | 'K'; messageId: string | null; note?: string };
export interface MailDriver { name: 'cloudflare' | 'log' | 'memory'; send(m: MailMessage): Promise<MailResult> }
export class MailError extends Error { constructor(public code: string, message: string) { super(message); } }

/** ชุดทดสอบ: กล่องขาออก + จำลองส่งไม่สำเร็จ */
export const memoryMail = {
  outbox: [] as MailMessage[],
  failNext: null as string | null,
  driver: {
    name: 'memory' as const,
    async send(m: MailMessage): Promise<MailResult> {
      if (memoryMail.failNext) { const code = memoryMail.failNext; memoryMail.failNext = null; throw new MailError(code, `จำลองส่งไม่สำเร็จ (${code})`); }
      memoryMail.outbox.push(m);
      return { status: 'S', messageId: `mem-${memoryMail.outbox.length}` };
    },
  },
};

const logDriver: MailDriver = {
  name: 'log',
  async send(m) {
    console.log(`[mail:log] ไม่ได้ส่ง (BUDDY_MAIL ไม่ใช่ cloudflare) → ${m.to.length} ผู้รับ · ${m.subject}`);
    return { status: 'K', messageId: null, note: 'ปิดการส่งอีเมลที่เครื่องนี้ (บันทึกอย่างเดียว)' };
  },
};

/** ลายเซ็นคำขอถึง Worker: hex(HMAC-SHA256(BUDDY_SECRET_KEY, `${ts}.${body}`)) — Worker ตรวจเวลา ±5 นาที */
export const relaySignature = (key: string, ts: string, body: string) => createHmac('sha256', key).update(`${ts}.${body}`).digest('hex');
const cloudflareDriver = (relayUrl: string): MailDriver => ({
  name: 'cloudflare',
  async send(m) {
    const key = process.env.BUDDY_SECRET_KEY;
    if (!key) throw new MailError('NO_KEY', 'ไม่มี BUDDY_SECRET_KEY — ส่งผ่าน Worker ไม่ได้');
    const body = JSON.stringify(m);
    const ts = String(Date.now());
    let r: Response;
    try {
      r = await fetch(relayUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'x-wts-mail-ts': ts, 'x-wts-mail-sig': relaySignature(key, ts, body) }, body, signal: AbortSignal.timeout(15000) });
    } catch (e) { throw new MailError('RELAY_UNREACHABLE', `ติดต่อตัวส่งอีเมล (Worker) ไม่ได้: ${(e as Error).message}`); }
    const j = (await r.json().catch(() => null)) as { messageId?: string; error?: { code?: string; message?: string } } | null;
    if (!r.ok || !j?.messageId) throw new MailError(j?.error?.code ?? `HTTP_${r.status}`, j?.error?.message ?? `ส่งไม่สำเร็จ (${r.status})`);
    return { status: 'S', messageId: j.messageId };
  },
});

let override: MailDriver | null = null;
/** ชุดทดสอบเปลี่ยนตัวส่งได้ (null = ตาม BUDDY_MAIL) */
export function setMailDriver(d: MailDriver | null) { override = d; }
export function mailDriver(publicUrl?: string): MailDriver {
  if (override) return override;
  if (process.env.BUDDY_MAIL === 'cloudflare') {
    const url = process.env.BUDDY_MAIL_RELAY_URL || (publicUrl ? `${publicUrl.replace(/\/+$/, '')}/__wts/mail` : '');
    if (url) return cloudflareDriver(url);
  }
  return logDriver;
}

/* ---- คิวหลัง commit: ไม่บล็อกคำขอ ไม่ทำให้คำขอล้ม ---- */
const pending = new Set<Promise<unknown>>();
export function queueMail(task: () => Promise<unknown>) {
  const p = Promise.resolve().then(task).catch((e) => console.error('[mail] งานส่งอีเมลผิดพลาด:', (e as Error)?.message ?? e)).finally(() => pending.delete(p));
  pending.add(p);
}
/** รอให้อีเมลในคิวส่งเสร็จ (ชุดทดสอบ) */
export async function flushMail() { while (pending.size) await Promise.all([...pending]); }

/** ใส่ค่าใน HTML อย่างปลอดภัย */
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
