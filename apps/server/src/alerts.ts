import type { Db } from './db.js';
import { logActivity } from './audit.js';
import { mailDriver, MailError, queueMail, esc } from './mail/index.js';
import { mailSettings } from './modules/signup-mail.js';

/**
 * แจ้งเตือนการใช้งานผิดปกติของเจ้าหน้าที่ผู้ให้บริการ (HANDOFF 207 · ต่อจาก 204 P3 · เจ้าของ 27/11/2569 "เริ่มต่อได้")
 *  - LOCKED     บัญชีผู้ให้บริการโดน 403 PROVIDER_LOCKED (พยายามเปิดข้อมูลของลูกค้าจริง) ซ้ำ ๆ
 *  - LOGIN_FAIL บัญชีผู้ให้บริการใส่รหัสผ่าน/รหัส 2FA ผิดซ้ำ ๆ (บัญชีถูกล็อกแล้วยังลองต่อก็นับ)
 *  - BURST      บัญชีผู้ให้บริการทำรายการที่ศูนย์ผู้ให้บริการถี่ผิดปกติ (เปลี่ยนแปลงข้อมูลลูกค้า หรือเปิดดูรายละเอียดลูกค้า)
 * ครบเกณฑ์ = บันทึก sys_activity_log (ALERT_*) + อีเมลถึงผู้ให้บริการ (ค่าตั้ง mail.alert_notify · ว่าง = ผู้รับแจ้งเตือนใบสมัคร) — ไม่ส่งถึงลูกค้า
 * เกณฑ์ตั้งได้ (ค่าเริ่มต้นในวงเล็บ): BUDDY_ALERT_LOCKED (5/10 = 5 ครั้งใน 10 นาที) · BUDDY_ALERT_LOGIN_FAIL (5/15) · BUDDY_ALERT_BURST (30/10)
 *   BUDDY_ALERT_COOLDOWN_MIN (60 — แจ้งเรื่องเดียวกันของบัญชีเดียวกันซ้ำได้หลังกี่นาที) · BUDDY_ALERT_MAIL_PER_HOUR (10 — อีเมลแจ้งเตือนรวมทั้งระบบต่อชั่วโมง)
 * นับในหน่วยความจำของเครื่อง (เริ่มโปรแกรมใหม่ = เริ่มนับใหม่) — ประวัติถาวรอยู่ใน sys_activity_log
 */
export type AlertKind = 'LOCKED' | 'LOGIN_FAIL' | 'BURST';
type Rule = { count: number; minutes: number };
const DEFAULTS: Record<AlertKind, Rule> = { LOCKED: { count: 5, minutes: 10 }, LOGIN_FAIL: { count: 5, minutes: 15 }, BURST: { count: 30, minutes: 10 } };
const ENV: Record<AlertKind, string> = { LOCKED: 'BUDDY_ALERT_LOCKED', LOGIN_FAIL: 'BUDDY_ALERT_LOGIN_FAIL', BURST: 'BUDDY_ALERT_BURST' };
const rule = (v: string | undefined, d: Rule): Rule => {
  const m = /^\s*(\d{1,5})\s*\/\s*(\d{1,4})\s*$/.exec(v ?? '');
  return m && Number(m[1]) > 0 && Number(m[2]) > 0 ? { count: Number(m[1]), minutes: Number(m[2]) } : d;
};
const posInt = (v: string | undefined, d: number) => (v && /^\d{1,6}$/.test(v.trim()) && Number(v) > 0 ? Number(v) : d);
export function alertConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    rules: Object.fromEntries((Object.keys(DEFAULTS) as AlertKind[]).map((k) => [k, rule(env[ENV[k]], DEFAULTS[k])])) as Record<AlertKind, Rule>,
    cooldownMinutes: posInt(env.BUDDY_ALERT_COOLDOWN_MIN, 60),
    mailPerHour: posInt(env.BUDDY_ALERT_MAIL_PER_HOUR, 10),
  };
}

export const ALERT_LABEL: Record<AlertKind, string> = {
  LOCKED: 'พยายามเปิดข้อมูลของลูกค้าจริงซ้ำ ๆ (ถูกปฏิเสธ PROVIDER_LOCKED)',
  LOGIN_FAIL: 'ใส่รหัสผ่าน/รหัสยืนยันตัวตนผิดซ้ำ ๆ',
  BURST: 'ทำรายการที่ศูนย์ผู้ให้บริการถี่ผิดปกติ',
};

const hits = new Map<string, number[]>();
const samples = new Map<string, string[]>();
const lastAlert = new Map<string, number>();
let mailTimes: number[] = [];
/** ชุดทดสอบ: ล้างตัวนับ */
export function resetAlerts() { hits.clear(); samples.clear(); lastAlert.clear(); mailTimes = []; }

/** ที่อยู่ที่บันทึก/ส่งในอีเมล: ตัด query (อาจมีคำค้น) เหลือแค่ path */
const cleanPath = (method: string, url: string) => `${method} ${url.split('?')[0]!.slice(0, 120)}`;

/**
 * นับเหตุการณ์หนึ่งครั้ง — ครบเกณฑ์ (และพ้นช่วงพัก) = บันทึก + อีเมล (ทำหลังตอบคำขอ ไม่ทำให้คำขอล้ม)
 * คืน true เมื่อครั้งนี้ทำให้เกิดการแจ้งเตือน
 */
export function noteAlert(db: Db, kind: AlertKind, who: { userId: string; username: string }, info: { method?: string; url?: string; ip?: string; base?: string } = {}): boolean {
  const cfg = alertConfig();
  const r = cfg.rules[kind];
  const key = `${kind}:${who.userId}`, now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => t > now - r.minutes * 60_000);
  arr.push(now);
  hits.set(key, arr);
  if (info.method && info.url) samples.set(key, [...(samples.get(key) ?? []), cleanPath(info.method, info.url)].slice(-5));
  if (arr.length < r.count) return false;
  const last = lastAlert.get(key);
  if (last !== undefined && now - last < cfg.cooldownMinutes * 60_000) return false;
  lastAlert.set(key, now);
  const detail = { kind, count: arr.length, minutes: r.minutes, threshold: r.count, samples: samples.get(key) ?? [], ip: info.ip ?? null };
  queueMail(async () => {
    let mail: string, recipients = 0;
    mailTimes = mailTimes.filter((t) => t > Date.now() - 3600_000);
    const st = await mailSettings(db);
    const to = st.alert_notify.length ? st.alert_notify : st.notify;
    if (!to.length) mail = 'NO_RECIPIENT';
    else if (mailTimes.length >= cfg.mailPerHour) mail = 'RATE_LIMIT';
    else {
      mailTimes.push(Date.now());
      recipients = to.length;
      const at = new Date(now).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
      const lines = [
        `บัญชีเจ้าหน้าที่ผู้ให้บริการ ${who.username}: ${ALERT_LABEL[kind]}`,
        `${arr.length} ครั้งใน ${r.minutes} นาที (เกณฑ์ ${r.count} ครั้ง) · เวลา ${at}${info.ip ? ` · IP ${info.ip}` : ''}`,
        ...(detail.samples.length ? ['ตัวอย่างคำขอล่าสุด:', ...detail.samples] : []),
        '',
        'ถ้าไม่ใช่การทำงานปกติ: เปลี่ยนรหัสผ่าน/ล้าง 2FA ของบัญชีนี้ และดูรายการที่ ศูนย์ผู้ให้บริการ › สิ่งที่เจ้าหน้าที่ทำกับบัญชีลูกค้า',
        `แจ้งเรื่องเดียวกันของบัญชีนี้อีกได้หลัง ${cfg.cooldownMinutes} นาที — Buddy Account`,
      ];
      try {
        const res = await mailDriver(info.base).send({ from: st.from, to, replyTo: st.reply_to, subject: `แจ้งเตือน Buddy: การใช้งานผิดปกติของเจ้าหน้าที่ ${who.username}`,
          text: lines.join('\n'), html: `<div style="font-family:sans-serif;line-height:1.6">${lines.map((l) => (l ? `<p>${esc(l)}</p>` : '')).join('')}</div>` });
        mail = res.status;
      } catch (e) { mail = e instanceof MailError ? `F:${e.code}` : 'F'; }
    }
    await logActivity(db, { companyId: null, userId: who.userId }, { module: 'SYS', action: `ALERT_${kind}`, docNo: who.username, table: 'sys_user', rowId: who.userId, detail: { ...detail, mail, recipients } });
  });
  return true;
}

/** รหัสผิด (รหัสผ่าน/2FA/บัญชีล็อกอยู่) — นับเฉพาะบัญชีของเจ้าหน้าที่ผู้ให้บริการ (ไม่สังกัดลูกค้า) */
export async function noteLoginFail(db: Db, userId: string, ip: string | undefined) {
  const u = await db.selectFrom('sys_user').select(['username', 'tenant_id']).where('id', '=', userId).executeTakeFirst();
  if (u && !u.tenant_id) noteAlert(db, 'LOGIN_FAIL', { userId, username: u.username }, { ip });
}

/** คำขอที่นับเป็น "รายการที่ศูนย์ผู้ให้บริการ": เปลี่ยนแปลงข้อมูลลูกค้า/ใบสมัคร/แพ็กเกจ/ค่าตั้งผู้ให้บริการ + เปิดดูรายละเอียดลูกค้า */
const CONSOLE = /^\/api\/v1\/(provider\/|tenants(\/|$)|signups(\/|$)|packages(\/|$)|platform\/|company-move-requests(\/|$))/;
export function isConsoleAction(method: string, url: string) {
  const path = url.split('?')[0]!;
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return /^\/api\/v1\/provider\/customers\/[0-9a-f-]{36}$/i.test(path);
  return CONSOLE.test(path);
}
