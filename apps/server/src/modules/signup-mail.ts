import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Db } from '../db.js';
import type { Config } from '../config.js';
import { badRequest, forbidden, notFound, parse, requireAuth } from '../http.js';
import { logActivity } from '../audit.js';
import { mailDriver, MailError, queueMail } from '../mail/index.js';
import { renderSignupMail, SIGNUP_MAIL_KINDS, SIGNUP_MAIL_LABEL, type SignupMailData, type SignupMailKind } from '../mail/templates.js';

/**
 * อีเมลเรื่องใบสมัคร (HANDOFF 187): แจ้งผู้ให้บริการเมื่อมีใบสมัคร · แจ้งผู้สมัคร ได้รับ/อนุมัติ/ไม่อนุมัติ
 * ส่งหลัง commit (queueMail) ไม่บล็อก ไม่ย้อน · ผลการส่งเก็บใน sys_mail_log ต่อใบสมัคร+ชนิด · ส่งไม่สำเร็จบันทึก sys_activity_log (ไม่มีความลับ) · ผู้ให้บริการกดส่งอีกครั้งได้
 * กันใช้หน้าสมัครส่งสแปม: ผู้รับฝั่งผู้สมัคร = อีเมลในใบสมัครเท่านั้น (ใบละ 1 อีเมล) · จำกัดต่ออีเมลต่อวัน · ซ้อนกับจำกัดต่อ IP + Turnstile ของหน้าสมัคร
 */
export const MAIL_FROM_DEFAULT = 'noreply@worktruesolution.net';
const PER_ADDRESS_DAY = 3;
type Settings = { notify: string[]; reply_to: string | null; from: string };

export async function mailSettings(db: Db): Promise<Settings> {
  const rows = await db.selectFrom('sys_platform_setting').select(['key', 'value']).where('key', 'in', ['mail.signup_notify', 'mail.reply_to', 'mail.from']).where('deleted_at', 'is', null).execute();
  const v = (k: string) => rows.find((r) => r.key === k)?.value as unknown;
  const notify = v('mail.signup_notify');
  return { notify: Array.isArray(notify) ? notify.filter((x): x is string => typeof x === 'string') : [], reply_to: (v('mail.reply_to') as string | null) ?? null, from: (v('mail.from') as string) || process.env.BUDDY_MAIL_FROM || MAIL_FROM_DEFAULT };
}
export async function setSetting(db: Db, key: string, value: unknown, by: string) {
  const cur = await db.selectFrom('sys_platform_setting').select('id').where('key', '=', key).where('deleted_at', 'is', null).executeTakeFirst();
  const json = JSON.stringify(value) as never;
  if (cur) await db.updateTable('sys_platform_setting').set({ value: json, updated_by: by }).where('id', '=', cur.id).execute();
  else await db.insertInto('sys_platform_setting').values({ key, value: json, created_by: by }).execute();
}

/** ข้อมูลใบสมัคร (+ ลูกค้าเมื่ออนุมัติแล้ว) สำหรับสร้างอีเมล */
async function signupData(db: Db, signupId: string, base: string): Promise<(SignupMailData & { tenant_id: string | null; status: string }) | null> {
  const r = (await sql<SignupMailData & { tenant_id: string | null; status: string }>`SELECT s.business_name, s.contact_name, s.contact_email, s.contact_phone, s.tax_id, s.username, s.created_at::text AS created_at,
      s.reject_reason, s.status, s.tenant_id, t.expires_on::text AS expires_on, t.code AS tenant_code
    FROM sys_signup s LEFT JOIN sys_tenant t ON t.id = s.tenant_id WHERE s.id = ${signupId} AND s.deleted_at IS NULL`.execute(db)).rows[0];
  return r ? { ...r, base } : null;
}

/**
 * ส่งอีเมลหนึ่งฉบับของใบสมัคร แล้วบันทึกผล — ไม่ throw (ผลอยู่ใน sys_mail_log) · actor = ผู้ให้บริการที่กดส่งอีกครั้ง (ข้ามการจำกัดต่ออีเมล)
 */
export async function sendSignupMail(db: Db, kind: SignupMailKind, signupId: string, base: string, actor: string | null = null): Promise<{ status: 'S' | 'F' | 'K'; error: string | null }> {
  const d = await signupData(db, signupId, base);
  if (!d) return { status: 'K', error: 'ไม่พบใบสมัคร' };
  const st = await mailSettings(db);
  const to = kind === 'SIGNUP_NOTIFY' ? st.notify : d.contact_email && d.contact_email !== '-' ? [d.contact_email] : [];
  const mail = renderSignupMail(kind, d);
  let status: 'S' | 'F' | 'K' = 'K', error: string | null = null, code: string | null = null, messageId: string | null = null;
  if (!to.length) error = kind === 'SIGNUP_NOTIFY' ? 'ยังไม่ได้ตั้งอีเมลรับแจ้งเตือนใบสมัคร' : 'ไม่มีอีเมลผู้สมัคร (ลบตาม PDPA แล้ว)';
  else if (!actor && kind !== 'SIGNUP_NOTIFY' && (await sql<{ n: number }>`SELECT count(*)::int AS n FROM sys_mail_log WHERE lower(recipients) = ${to[0]!.toLowerCase()} AND status = 'S'
      AND kind <> 'SIGNUP_NOTIFY' AND last_attempt_at > now() - interval '1 day'`.execute(db)).rows[0]!.n >= PER_ADDRESS_DAY) {
    error = `ส่งถึงอีเมลนี้ครบ ${PER_ADDRESS_DAY} ฉบับใน 24 ชั่วโมงแล้ว (กันสแปม) — ผู้ให้บริการกดส่งอีกครั้งได้`; code = 'PER_ADDRESS_LIMIT';
  } else {
    try {
      const r = await mailDriver(base).send({ from: st.from, to, replyTo: st.reply_to, subject: mail.subject, html: mail.html, text: mail.text });
      status = r.status; messageId = r.messageId; error = r.note ?? null;
    } catch (e) {
      status = 'F'; code = e instanceof MailError ? e.code : 'ERROR';
      error = (e instanceof Error ? e.message : String(e)).slice(0, 400);
    }
  }
  const recipients = to.join(', ').slice(0, 500) || '-';
  const cur = await db.selectFrom('sys_mail_log').select(['id', 'attempts']).where('signup_id', '=', signupId).where('kind', '=', kind).where('deleted_at', 'is', null).executeTakeFirst();
  const row = { tenant_id: d.tenant_id, recipients, subject: mail.subject.slice(0, 200), status, message_id: messageId, error, last_attempt_at: new Date().toISOString() };
  if (cur) await db.updateTable('sys_mail_log').set({ ...row, attempts: cur.attempts + 1, updated_by: actor }).where('id', '=', cur.id).execute();
  else await db.insertInto('sys_mail_log').values({ ...row, signup_id: signupId, kind, attempts: 1, created_by: actor } as never).execute();
  await logActivity(db, { companyId: null, userId: actor }, { module: 'SYS', action: status === 'S' ? 'MAIL_SENT' : status === 'F' ? 'MAIL_FAILED' : 'MAIL_SKIPPED', docNo: d.username, table: 'sys_signup', rowId: signupId,
    detail: { kind, recipients: to.length, ...(code ? { code } : {}), ...(status !== 'S' && error ? { error } : {}), ...(actor ? { resend: true } : {}) } });
  return { status, error };
}
/** ส่งหลัง commit — ไม่รอ ไม่ทำให้คำขอล้ม */
export function queueSignupMail(db: Db, kinds: SignupMailKind[], signupId: string, base: string) {
  for (const k of kinds) queueMail(() => sendSignupMail(db, k, signupId, base));
}
/** สถานะอีเมลของใบสมัครหลายใบ (หน้าจอผู้ให้บริการ) */
export async function mailStatusOf(db: Db, signupIds: string[]) {
  if (!signupIds.length) return new Map<string, Array<{ kind: string; status: string; error: string | null; attempts: number; last_attempt_at: string; recipients: string }>>();
  const rows = await db.selectFrom('sys_mail_log').select(['signup_id', 'kind', 'status', 'error', 'attempts', 'last_attempt_at', 'recipients']).where('signup_id', 'in', signupIds).where('deleted_at', 'is', null).execute();
  const m = new Map<string, Array<{ kind: string; status: string; error: string | null; attempts: number; last_attempt_at: string; recipients: string }>>();
  for (const r of rows) { const a = m.get(r.signup_id!) ?? []; a.push({ kind: r.kind, status: r.status, error: r.error, attempts: r.attempts, last_attempt_at: String(r.last_attempt_at), recipients: r.recipients }); m.set(r.signup_id!, a); }
  return m;
}

const SAMPLE = (base: string): SignupMailData => ({ business_name: 'ร้านตัวอย่าง (ทดลอง)', contact_name: 'สมชาย ตัวอย่าง', contact_email: 'applicant@example.com', contact_phone: '081-234-5678', tax_id: '0105560000001',
  username: 'shop.owner', created_at: new Date().toISOString(), reject_reason: 'ข้อมูลกิจการไม่ครบ กรุณาสมัครใหม่พร้อมเลขผู้เสียภาษี', expires_on: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10), tenant_code: 'SHOP', base });

export function signupMailRoutes(app: FastifyInstance, db: Db, cfg: Config) {
  const platform = (req: FastifyRequest) => { const a = requireAuth(req); if (!a.isPlatform) throw forbidden('เฉพาะเจ้าหน้าที่ผู้ให้บริการโปรแกรม'); return a; };
  const baseOf = (req: FastifyRequest) => cfg.publicUrl ?? `${req.protocol}://${req.host}`;
  const driverInfo = (req: FastifyRequest) => {
    const d = mailDriver(baseOf(req));
    return { driver: d.name, sending: d.name !== 'log', note: d.name === 'cloudflare' ? 'ส่งผ่าน Cloudflare Email Service (Worker)' : d.name === 'memory' ? 'ชุดทดสอบ (เก็บในหน่วยความจำ)' : 'ปิดการส่งอีเมลที่เครื่องนี้ — บันทึกอย่างเดียว (คลาวด์ตั้ง BUDDY_MAIL=cloudflare)' };
  };
  app.get('/api/v1/platform/mail-settings', async (req) => { platform(req); return { ...(await mailSettings(db)), ...driverInfo(req) }; });
  app.put('/api/v1/platform/mail-settings', async (req) => {
    const a = platform(req);
    const email = z.string().trim().toLowerCase().email('อีเมลไม่ถูกต้อง').max(120);
    const b = parse(z.object({
      notify: z.array(email).max(10, 'ผู้รับแจ้งเตือนไม่เกิน 10 อีเมล'),
      reply_to: email.nullable().optional().or(z.literal('').transform(() => null)),
      from: email.refine((v) => v.endsWith('@worktruesolution.net') || !!process.env.BUDDY_MAIL_FROM_DOMAIN && v.endsWith(`@${process.env.BUDDY_MAIL_FROM_DOMAIN}`), 'ผู้ส่งต้องเป็นอีเมลของโดเมนที่ตั้งส่งอีเมลไว้ (…@worktruesolution.net)').optional(),
    }), req.body);
    await setSetting(db, 'mail.signup_notify', [...new Set(b.notify)], a.userId);
    await setSetting(db, 'mail.reply_to', b.reply_to ?? null, a.userId);
    if (b.from) await setSetting(db, 'mail.from', b.from, a.userId);
    await logActivity(db, a, { module: 'SYS', action: 'MAIL_SETTINGS', table: 'sys_platform_setting', detail: { notify: b.notify.length, reply_to: !!b.reply_to, from: b.from ?? null } });
    return { ...(await mailSettings(db)), ...driverInfo(req) };
  });
  /** ตัวอย่างอีเมล (ข้อมูลสมมุติ) — ผู้ให้บริการดูก่อนใช้จริง */
  app.get('/api/v1/platform/mail-preview', async (req) => {
    platform(req);
    const { kind } = parse(z.object({ kind: z.enum(SIGNUP_MAIL_KINDS as [SignupMailKind, ...SignupMailKind[]]) }), req.query);
    return { kind, label: SIGNUP_MAIL_LABEL[kind], ...renderSignupMail(kind, SAMPLE(baseOf(req))) };
  });
  /** ส่งอีกครั้ง (ผู้ให้บริการ) — ส่งทันทีแล้วตอบผล */
  app.post('/api/v1/signups/:id/mail/:kind', async (req) => {
    const a = platform(req);
    const { id, kind } = parse(z.object({ id: z.string().uuid(), kind: z.enum(SIGNUP_MAIL_KINDS as [SignupMailKind, ...SignupMailKind[]]) }), req.params);
    const s = await db.selectFrom('sys_signup').select(['status']).where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
    if (!s) throw notFound('ใบสมัคร');
    if ((kind === 'SIGNUP_APPROVED' && s.status !== 'A') || (kind === 'SIGNUP_REJECTED' && s.status !== 'R')) throw badRequest(`ใบสมัครนี้สถานะไม่ตรงกับอีเมล "${SIGNUP_MAIL_LABEL[kind]}"`);
    return sendSignupMail(db, kind, id, baseOf(req), a.userId);
  });
}
