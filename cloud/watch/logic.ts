/**
 * ตัวเฝ้าระบบบนคลาวด์ (wts-watch) — ตรรกะล้วน ไม่ขึ้นกับ Cloudflare (ทดสอบที่ apps/server/test/watch.test.ts)
 * worker.js เรียกทุกนาที: ตรวจ health ของทุกโปรแกรมผ่านชื่อเว็บสาธารณะ → step() ตัดสินว่าต้องแจ้งเตือนหรือไม่ → ส่งอีเมล
 *
 * - ล้มติดกัน FAIL_LIMIT ครั้ง (≈ 5 นาที) จึงแจ้ง "ล่ม" — กันแจ้งผิดตอน deploy/รีสตาร์ต container (เปิดใหม่ใช้ ~1–2 นาที)
 * - ยังล่มอยู่ = เตือนซ้ำทุก REMIND_MS (60 นาที) · กลับมาใช้ได้ = แจ้ง "กลับมาแล้ว" พร้อมเวลาที่ล่ม
 * - สรุปรายสัปดาห์ (จันทร์ 08:00) = บอกว่าตัวเฝ้ายังทำงาน + สถิติการล่ม
 * - ส่งอีเมลไม่สำเร็จ = เก็บไว้ส่งใหม่รอบถัดไป (outbox)
 */

export interface Check { key: string; name: string; url: string; }

/** ชื่อเว็บที่ไม่มีด่าน Cloudflare Access (ตอบ health ได้โดยไม่ต้องเข้าระบบ) — Buddy ?db=1 ตรวจฐานข้อมูลด้วย */
export const CHECKS: Check[] = [
  { key: 'buddy', name: 'Buddy Account', url: 'https://buddy-api.worktruesolution.net/api/v1/health?db=1' },
  { key: 'pos', name: 'WTS-POS', url: 'https://cashier.worktruesolution.net/api/health' },
  { key: 'living', name: 'WTS-Living', url: 'https://resident.worktruesolution.net/api/health' },
];

export const FAIL_LIMIT = 5;
export const REMIND_MS = 60 * 60_000;
export const TIMEOUT_MS = 25_000;
const OUTBOX_MAX = 20;

export interface Result { ok: boolean; detail: string; ms: number; }

export interface AppState {
  fails: number;
  firstFailAt?: number;
  /** แจ้ง "ล่ม" ไปแล้ว — เวลาที่เริ่มล้ม */
  downSince?: number;
  lastAlertAt?: number;
  lastDetail?: string;
  /** สถิติตั้งแต่สรุปครั้งก่อน */
  incidents: number;
  downMs: number;
}

export interface Mail { subject: string; text: string; }

export interface State {
  apps: Record<string, AppState>;
  outbox: Mail[];
  statsSince: number;
  started?: boolean;
  /** ผลตรวจรอบล่าสุด (ใช้ในสรุปรายสัปดาห์) */
  last?: Record<string, Result>;
}

export type Alert =
  | { kind: 'down'; check: Check; since: number; detail: string }
  | { kind: 'still'; check: Check; since: number; detail: string }
  | { kind: 'up'; check: Check; since: number; downMs: number };

export const emptyState = (now: number): State => ({ apps: {}, outbox: [], statsSince: now });
const emptyApp = (): AppState => ({ fails: 0, incidents: 0, downMs: 0 });

/** ตัดสินผลการตรวจหนึ่งรอบของโปรแกรมเดียว — คืนสถานะใหม่ + การแจ้งเตือน (ถ้ามี) */
export function step(prev: AppState | undefined, check: Check, r: Result, now: number): { next: AppState; alert?: Alert } {
  const p = prev ?? emptyApp();
  if (r.ok) {
    const next: AppState = { fails: 0, incidents: p.incidents, downMs: p.downMs };
    if (p.downSince !== undefined) {
      const downMs = now - p.downSince;
      next.downMs += downMs;
      return { next, alert: { kind: 'up', check, since: p.downSince, downMs } };
    }
    return { next };
  }
  const next: AppState = { ...p, fails: p.fails + 1, firstFailAt: p.firstFailAt ?? now, lastDetail: r.detail };
  if (p.downSince === undefined) {
    if (next.fails >= FAIL_LIMIT) {
      next.downSince = next.firstFailAt;
      next.lastAlertAt = now;
      next.incidents += 1;
      return { next, alert: { kind: 'down', check, since: next.downSince!, detail: r.detail } };
    }
    return { next };
  }
  if (now - (p.lastAlertAt ?? 0) >= REMIND_MS) {
    next.lastAlertAt = now;
    return { next, alert: { kind: 'still', check, since: p.downSince, detail: r.detail } };
  }
  return { next };
}

/** อ่านผลจากคำตอบ health — ต้องเป็น 200 และ JSON ok: true */
export async function readHealth(res: Response, ms: number): Promise<Result> {
  let body: { ok?: unknown; version?: unknown; error?: { message?: unknown } } | undefined;
  try { body = await res.json() as typeof body; } catch { body = undefined; }
  if (res.status === 200 && body?.ok === true) return { ok: true, detail: `รุ่น ${String(body.version ?? '?')} · ${ms} ms`, ms };
  const why = typeof body?.error?.message === 'string' ? ` — ${body.error.message}` : body ? '' : ' (ไม่ใช่คำตอบของโปรแกรม)';
  return { ok: false, detail: `ตอบ HTTP ${res.status}${why}`, ms };
}

export function failDetail(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === 'TimeoutError' || name === 'AbortError') return `ไม่ตอบภายใน ${TIMEOUT_MS / 1000} วินาที`;
  return `ติดต่อไม่ได้ — ${(e as Error)?.message ?? String(e)}`;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** วันเวลาไทย (พ.ศ.) เช่น 17/11/2569 09:05 */
export function thaiTime(ms: number): string {
  const d = new Date(ms + 7 * 3600_000);
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear() + 543} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function duration(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `${m} นาที`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} ชั่วโมง ${m % 60} นาที` : `${h} ชั่วโมง`;
}

const HELP = [
  'สิ่งที่ทำได้:',
  '1. เปิดโปรแกรมดูเองว่าใช้ได้หรือไม่ (บางครั้งกลับมาเองภายในไม่กี่นาที)',
  '2. ดูสถานะ Cloudflare: https://www.cloudflarestatus.com · Supabase: https://status.supabase.com',
  '3. ถ้าเกิน 15 นาที แจ้งผู้ช่วย (Claude) พร้อมส่งอีเมลนี้ — ผู้ช่วยดูบันทึกที่ Cloudflare › Workers & Pages › (ชื่อโปรแกรม) › Logs',
].join('\n');

const URLS: Record<string, string> = {
  buddy: 'https://app.worktruesolution.net',
  pos: 'https://pos.worktruesolution.net',
  living: 'https://living.worktruesolution.net',
};

/** รวมการแจ้งเตือนของรอบเดียวเป็นอีเมลฉบับเดียว */
export function alertMail(alerts: Alert[], now: number): Mail | undefined {
  if (!alerts.length) return undefined;
  const bad = alerts.filter((a) => a.kind !== 'up');
  const names = (list: Alert[]) => list.map((a) => a.check.name).join(', ');
  const subject = bad.length
    ? `🔴 WTS แจ้งเตือน: ${names(bad)} ${bad.every((a) => a.kind === 'still') ? 'ยังใช้ไม่ได้' : 'ใช้ไม่ได้'}`
    : `🟢 WTS: ${names(alerts)} กลับมาใช้ได้แล้ว`;
  const lines = alerts.map((a) => {
    const url = URLS[a.check.key] ? ` (${URLS[a.check.key]})` : '';
    if (a.kind === 'up') return `🟢 ${a.check.name}${url} กลับมาใช้ได้แล้ว — ใช้ไม่ได้ตั้งแต่ ${thaiTime(a.since)} รวม ${duration(a.downMs)}`;
    const head = a.kind === 'down' ? 'ใช้ไม่ได้' : 'ยังใช้ไม่ได้';
    return `🔴 ${a.check.name}${url} ${head} ตั้งแต่ ${thaiTime(a.since)} (${duration(now - a.since)})\n   สาเหตุที่ตรวจพบ: ${a.detail}`;
  });
  const text = [`ตรวจเมื่อ ${thaiTime(now)}`, '', ...lines, '', ...(bad.length ? [HELP, ''] : []),
    '— ตัวเฝ้าระบบ WTS (ตรวจทุก 1 นาที · แจ้งเมื่อใช้ไม่ได้ติดกัน 5 นาที · เตือนซ้ำทุก 1 ชั่วโมงจนกว่าจะกลับมา)'].join('\n');
  return { subject, text };
}

/** อีเมลสรุป: ตอนเริ่มเฝ้าครั้งแรก (first) และทุกสัปดาห์ — ยืนยันว่าตัวเฝ้ายังทำงานและส่งอีเมลได้ */
export function summaryMail(state: State, results: Record<string, Result>, now: number, first: boolean): Mail {
  const lines = CHECKS.map((c) => {
    const r = results[c.key];
    const a = state.apps[c.key];
    const now_ = r?.ok ? `🟢 ใช้ได้ (${r.detail})` : `🔴 ใช้ไม่ได้ (${r?.detail ?? 'ยังไม่ได้ตรวจ'})`;
    const stats = first ? '' : `\n   ตั้งแต่ ${thaiTime(state.statsSince)}: ${a?.incidents ? `ล่ม ${a.incidents} ครั้ง รวม ${duration(a.downMs)}` : 'ไม่มีการล่ม'}`;
    return `${c.name}: ${now_}${stats}`;
  });
  const subject = first ? '✅ WTS: เริ่มเฝ้าระบบแล้ว (อีเมลทดสอบ)' : '📋 WTS: สรุปสถานะระบบประจำสัปดาห์';
  const intro = first
    ? 'ตัวเฝ้าระบบเริ่มทำงานแล้ว — ถ้าได้รับอีเมลนี้ แปลว่าการแจ้งเตือนส่งถึงคุณได้'
    : 'ตัวเฝ้าระบบยังทำงานปกติ — ถ้าเช้าวันจันทร์ไม่ได้รับอีเมลนี้ ให้แจ้งผู้ช่วย (ตัวเฝ้าอาจหยุดทำงาน)';
  return { subject, text: [intro, '', `ตรวจเมื่อ ${thaiTime(now)}`, '', ...lines].join('\n') };
}

export function queue(state: State, mail: Mail | undefined): void {
  if (!mail) return;
  state.outbox.push(mail);
  if (state.outbox.length > OUTBOX_MAX) state.outbox.splice(0, state.outbox.length - OUTBOX_MAX);
}

export function resetStats(state: State, now: number): void {
  state.statsSince = now;
  for (const a of Object.values(state.apps)) { a.incidents = 0; a.downMs = 0; }
}

// ---------- อีเมลแบบ MIME (ข้อความไทย UTF-8) ----------
function b64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const word = (s: string) => `=?UTF-8?B?${b64(s)}?=`;

export function mime(from: string, fromName: string, to: string, mail: Mail, now: number, id: string): string {
  const body = b64(mail.text.replace(/\r?\n/g, '\r\n')).replace(/.{76}/g, '$&\r\n');
  return [
    `From: ${word(fromName)} <${from}>`,
    `To: <${to}>`,
    `Subject: ${word(mail.subject)}`,
    `Date: ${new Date(now).toUTCString()}`,
    `Message-ID: <${id}@${from.split('@')[1]}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ].join('\r\n');
}
