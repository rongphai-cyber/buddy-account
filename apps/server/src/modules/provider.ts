import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Db } from '../db.js';
import { badRequest, forbidden, notFound, parse, requireAuth, type AuthContext } from '../http.js';
import { logActivity } from '../audit.js';
import { esc, mailDriver, MailError, queueMail } from '../mail/index.js';
import { mailSettings } from './signup-mail.js';
import { tenantReport } from './usage.js';
import { tenantFeatureStatus, tenantModuleStatus, thisMonthTh, type TenantModuleRow } from '@buddy/core';

/**
 * ศูนย์ผู้ให้บริการ (HANDOFF 204 · เจ้าของ 27/11/2569 "Admin ระบบ ก็ไม่ควรจะเห็นข้อมูลรายละเอียดของลูกค้านอกจากพวกการใช้งานโดยรวม user รายชื่อบริษัท
 * แต่ไม่ควรเห็นว่าแต่ละบริษัทลูกค้าลงบัญชีหรือรายการอะไร และต้องไม่แก้ข้อมูลบัญชีต่างๆของลูกค้าได้" · ตอบข้อ ข = ไม่มีทางเข้าเลย ยกเว้นข้อมูลตัวอย่าง)
 * ดูได้รายลูกค้า: ข้อมูลลูกค้า · บริษัท (รหัส ชื่อ) · ผู้ใช้ (ชื่อ สถานะ กลุ่ม 2FA ล็อก) · แพ็กเกจ วันหมดอายุ DPA · เมนูที่เปิด · กุญแจ API (ไม่มีรหัสกุญแจ) · การใช้งานรวม
 * ไม่มี: ยอดเงิน เนื้อหาเอกสาร ชื่อคู่ค้า — query ในไฟล์นี้อ่านเฉพาะตาราง sys_* และนับจำนวน (ไม่อ่านคอลัมน์ของเอกสาร)
 * ลิงก์ตั้งรหัสผ่านที่ผู้ให้บริการสั่ง: ส่งทางอีเมลผู้ติดต่อของลูกค้าเท่านั้น ไม่แสดงให้ผู้ให้บริการ (ข้อ d1)
 */
const sha = (t: string) => createHash('sha256').update(t).digest('hex');
export const INVITE_MAIL_HOURS = 72;
/** เปลี่ยนอีเมลผู้ติดต่อแล้วกี่วันจึงส่งลิงก์ไปอีเมลใหม่ได้ (กันเปลี่ยนเป็นอีเมลตัวเองแล้วยึดบัญชี) */
export const CONTACT_EMAIL_COOLDOWN_DAYS = 7;
/** ที่อยู่หน้าเว็บสำหรับลิงก์ในอีเมล */
export const publicBase = (req: FastifyRequest) => process.env.BUDDY_PUBLIC_URL?.replace(/\/+$/, '') || `${req.protocol}://${req.host}`;
/** ปิดบังอีเมลบนหน้าจอผู้ให้บริการ: ab***@domain */
export const maskEmail = (e: string) => { const [u = '', d = ''] = e.split('@'); return `${u.slice(0, 2)}***@${d}`; };
/** ปิดบังเบอร์โทร: 08x***xx */
export const maskPhone = (p: string) => (p.length <= 5 ? '***' : `${p.slice(0, 3)}***${p.slice(-2)}`);

/**
 * บริษัทที่มีข้อมูลธุรกิจแล้ว (HANDOFF 204 C1/C2): เอกสาร ใบสำคัญ ยอดยกมา ลูกค้า ผู้จำหน่าย สินค้า ทรัพย์สิน บัญชีเงินฝาก พนักงาน/เงินเดือน
 * ข้อมูลตั้งต้น (ผังบัญชี เลขที่เอกสาร หน่วยนับ คลัง แผนก กลุ่มบัญชี วิธีชำระ ค่าตั้ง) ไม่นับ — นับจำนวนอย่างเดียว ไม่อ่านเนื้อหา
 */
export const BUSINESS_TABLES = ['doc_header', 'gl_journal', 'md_customer', 'md_supplier', 'md_item', 'fa_asset', 'md_bank_account', 'pay_employee', 'pay_run'] as const;
export async function companiesWithData(db: Db, companyIds: string[]): Promise<Array<{ id: string; code: string; rows: number }>> {
  if (!companyIds.length) return [];
  const parts = BUSINESS_TABLES.map((t) => sql`SELECT company_id, count(*)::int AS n FROM ${sql.table(t)} WHERE company_id = ANY(${companyIds}::uuid[]) AND deleted_at IS NULL GROUP BY company_id`);
  parts.push(sql`SELECT company_id, count(*)::int AS n FROM gl_balance WHERE company_id = ANY(${companyIds}::uuid[]) AND deleted_at IS NULL AND opening <> 0 GROUP BY company_id`);
  const rows = (await sql<{ id: string; code: string; rows: number }>`SELECT c.id, c.code, sum(x.n)::int AS rows FROM (${sql.join(parts, sql` UNION ALL `)}) x
      JOIN sys_company c ON c.id = x.company_id GROUP BY c.id, c.code HAVING sum(x.n) > 0 ORDER BY c.code`.execute(db)).rows;
  return rows;
}

type MailOut = { status: 'S' | 'K' | 'F'; note: string | null };
/** ส่งอีเมลหนึ่งฉบับถึงลูกค้า (ไม่ throw) */
export async function mailCustomer(db: Db, base: string, to: string, subject: string, lines: string[]): Promise<MailOut> {
  const st = await mailSettings(db);
  const text = lines.join('\n');
  const html = `<div style="font-family:sans-serif;line-height:1.6">${lines.map((l) => (l ? `<p>${/^https?:\/\//.test(l) ? `<a href="${esc(l)}">${esc(l)}</a>` : esc(l)}</p>` : '')).join('')}</div>`;
  try {
    const r = await mailDriver(base).send({ from: st.from, to: [to], replyTo: st.reply_to, subject, html, text });
    return { status: r.status, note: r.note ?? null };
  } catch (e) {
    return { status: 'F', note: e instanceof MailError ? `${e.code}: ${e.message}` : (e as Error).message };
  }
}
/** แจ้งลูกค้า (อีเมลผู้ติดต่อ) หลัง commit — ไม่มีอีเมล = ไม่ส่ง */
export function noticeCustomer(db: Db, base: string, tenantId: string, subject: string, lines: string[], to?: string | null) {
  queueMail(async () => {
    const t = await db.selectFrom('sys_tenant').select(['contact_email', 'name']).where('id', '=', tenantId).executeTakeFirst();
    const addr = to ?? t?.contact_email;
    if (t && addr) await mailCustomer(db, base, addr, subject, [`เรียน ${t.name}`, '', ...lines, '', 'Buddy Account — WTS Solutions']);
  });
}

/**
 * ลิงก์ตั้งรหัสผ่านของผู้ใช้ลูกค้าจริงที่ผู้ให้บริการสั่ง (ข้อ d1): ส่งไปอีเมลผู้ติดต่อของลูกค้าเท่านั้น — ผู้ให้บริการไม่เห็นลิงก์
 * ปฏิเสธ: ลูกค้าไม่มีอีเมล · เพิ่งเปลี่ยนอีเมลไม่ถึง 7 วัน · ผู้ใช้เปิด 2FA อยู่ (ล้าง 2FA ก่อน)
 */
export async function emailInvite(db: Db, base: string, a: Pick<AuthContext, 'userId' | 'companyId'>, u: { id: string; username: string; display_name: string; tenant_id: string }, opts: { bootstrap?: boolean } = {}) {
  const t = await db.selectFrom('sys_tenant').select(['code', 'name', 'contact_email', 'contact_email_changed_at']).where('id', '=', u.tenant_id).executeTakeFirst();
  if (!t) throw notFound('ลูกค้าผู้ใช้บริการ');
  if (!t.contact_email) throw badRequest(`ลูกค้า ${t.code} ยังไม่มีอีเมลผู้ติดต่อ — ลิงก์ตั้งรหัสผ่านส่งไปที่อีเมลของลูกค้าเท่านั้น (ผู้ให้บริการไม่เห็นลิงก์) · ใส่อีเมลของลูกค้าที่หน้า แก้ไขลูกค้า แล้วรอ ${CONTACT_EMAIL_COOLDOWN_DAYS} วัน หรือให้ผู้ดูแลของลูกค้าสร้างลิงก์เอง`);
  const changed = t.contact_email_changed_at ? new Date(String(t.contact_email_changed_at)).getTime() : 0;
  // bootstrap = ลิงก์ของผู้ดูแลคนแรกตอนสร้างลูกค้าใหม่ (อีเมลที่เพิ่งใส่ตอนสร้าง — ยังไม่มีข้อมูล)
  if (!opts.bootstrap && changed && Date.now() - changed < CONTACT_EMAIL_COOLDOWN_DAYS * 86400_000) {
    throw badRequest(`อีเมลผู้ติดต่อของลูกค้า ${t.code} เพิ่งเปลี่ยน — ส่งลิงก์ตั้งรหัสผ่านไปอีเมลใหม่ได้หลังเปลี่ยนครบ ${CONTACT_EMAIL_COOLDOWN_DAYS} วัน (กันการยึดบัญชีลูกค้า) · ให้ผู้ดูแลของลูกค้าสร้างลิงก์เองได้ทันที`);
  }
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + INVITE_MAIL_HOURS * 3600_000).toISOString();
  await db.transaction().execute(async (tx) => {
    await tx.updateTable('sys_user_invite').set({ revoked_at: sql`now()` as never, updated_by: a.userId })
      .where('user_id', '=', u.id).where('used_at', 'is', null).where('revoked_at', 'is', null).where('deleted_at', 'is', null).execute();
    await tx.insertInto('sys_user_invite').values({ user_id: u.id, tenant_id: u.tenant_id, token_hash: sha(token), expires_at: expires, created_by: a.userId }).execute();
  });
  const out = await mailCustomer(db, base, t.contact_email, `ลิงก์ตั้งรหัสผ่าน Buddy Account — ${u.username}`, [
    `เรียน ${t.name}`, '',
    `ผู้ให้บริการ Buddy Account ส่งลิงก์ตั้งรหัสผ่านของผู้ใช้ ${u.username} (${u.display_name}) ตามที่กิจการของท่านขอ`,
    `เปิดลิงก์นี้แล้วตั้งรหัสผ่านเอง (ใช้ได้ครั้งเดียว ภายใน ${INVITE_MAIL_HOURS} ชั่วโมง):`, `${base}/invite/${token}`, '',
    'ผู้ให้บริการไม่เห็นลิงก์และรหัสผ่านนี้ — ถ้าท่านไม่ได้ขอ ไม่ต้องเปิดลิงก์ และแจ้งผู้ให้บริการ', '', 'Buddy Account — WTS Solutions']);
  await logActivity(db, { companyId: null, userId: a.userId }, { module: 'SET.SEC', action: 'INVITE_EMAIL', docNo: u.username, table: 'sys_user', rowId: u.id,
    detail: { tenant: t.code, to: maskEmail(t.contact_email), expires_at: expires, mail: out.status, note: out.note } });
  return { emailed_to: maskEmail(t.contact_email), mail_status: out.status, mail_note: out.note, expires_at: expires, hours: INVITE_MAIL_HOURS, username: u.username };
}

export function providerRoutes(app: FastifyInstance, db: Db) {
  const platform = (req: FastifyRequest) => { const a = requireAuth(req); if (!a.isPlatform || a.apiKeyId) throw forbidden('เฉพาะเจ้าหน้าที่ผู้ให้บริการโปรแกรม'); return a; };

  /** ลูกค้าทั้งหมด (หนึ่งแถว = หนึ่งลูกค้า) — ข้อมูลภาพรวมเท่านั้น */
  app.get('/api/v1/provider/customers', async (req) => {
    platform(req);
    const rows = (await sql<Record<string, unknown>>`
      SELECT t.id, t.code, t.name, t.status, t.suspend_reason, t.is_demo, t.expires_on::text AS expires_on, t.dpa_signed_on::text AS dpa_signed_on, t.require_mfa, t.moved_to, t.purged_at::text AS purged_at,
             t.contact_email, (SELECT p.name_th FROM sys_package p WHERE p.id = t.package_id) AS package_name, t.plan,
             (SELECT count(*)::int FROM sys_company c WHERE c.tenant_id = t.id AND c.deleted_at IS NULL) AS company_count,
             (SELECT count(*)::int FROM sys_user u WHERE u.tenant_id = t.id AND u.deleted_at IS NULL) AS user_count,
             (SELECT max(u.last_login_at)::text FROM sys_user u WHERE u.tenant_id = t.id AND u.deleted_at IS NULL) AS last_login_at,
             (SELECT json_agg(json_build_object('id', c.id, 'code', c.code, 'name', c.name_th) ORDER BY c.code) FROM sys_company c WHERE c.tenant_id = t.id AND c.deleted_at IS NULL) AS companies
        FROM sys_tenant t WHERE t.deleted_at IS NULL ORDER BY t.is_demo DESC, t.code`.execute(db)).rows;
    return { rows: rows.map((r) => ({ ...r, contact_email: r.contact_email ? maskEmail(String(r.contact_email)) : null, companies: r.companies ?? [] })) };
  });

  /** รายละเอียดลูกค้าหนึ่งราย — บริษัท ผู้ใช้ แพ็กเกจ เมนูที่เปิด กุญแจ API การใช้งาน (ไม่มีข้อมูลบัญชี) */
  app.get('/api/v1/provider/customers/:id', async (req) => {
    platform(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const t = await db.selectFrom('sys_tenant').select(['id', 'code', 'name', 'status', 'suspend_reason', 'is_demo', 'plan', 'contact_email', 'contact_phone', 'expires_on', 'dpa_signed_on', 'terminated_on', 'purge_after',
      'purged_at', 'moved_to', 'require_mfa', 'single_session', 'max_companies', 'max_users', 'created_at', 'contact_email_changed_at'])
      .select(sql<string | null>`(SELECT p.name_th FROM sys_package p WHERE p.id = sys_tenant.package_id)`.as('package_name'))
      .where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
    if (!t) throw notFound('ลูกค้าผู้ใช้บริการ');
    const companies = await db.selectFrom('sys_company').select(['id', 'code', 'name_th', 'status', 'created_at', 'deleted_at']).where('tenant_id', '=', id).orderBy('code').execute();
    const users = (await sql<Record<string, unknown>>`
      SELECT u.id, u.username, u.display_name, u.status, u.last_login_at::text AS last_login_at, g.code AS group_code, g.name AS group_name,
             coalesce(s.totp_enabled, false) AS totp_enabled, s.locked_until::text AS locked_until, coalesce(s.failed_logins, 0) AS failed_logins,
             (SELECT count(*)::int FROM sys_user_company uc JOIN sys_company c ON c.id = uc.company_id AND c.deleted_at IS NULL WHERE uc.user_id = u.id AND uc.deleted_at IS NULL) AS company_count,
             EXISTS (SELECT 1 FROM sys_user_invite i WHERE i.user_id = u.id AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.deleted_at IS NULL AND i.expires_at > now()) AS invite_open
        FROM sys_user u LEFT JOIN sys_user_group g ON g.id = u.user_group_id AND g.deleted_at IS NULL LEFT JOIN sys_user_security s ON s.user_id = u.id AND s.deleted_at IS NULL
       WHERE u.tenant_id = ${id} AND u.deleted_at IS NULL ORDER BY coalesce(g.code = 'ADMIN', false) DESC, u.username`.execute(db)).rows;
    const keys = (await sql<Record<string, unknown>>`
      SELECT k.id, k.name, k.key_prefix, k.status, k.read_only, k.created_at::text AS created_at, k.last_used_at::text AS last_used_at, k.expires_on::text AS expires_on, k.source_system, u.username, c.code AS company_code
        FROM sys_api_key k JOIN sys_user u ON u.id = k.user_id LEFT JOIN sys_company c ON c.id = k.company_id
       WHERE k.deleted_at IS NULL AND (u.tenant_id = ${id} OR c.tenant_id = ${id}) ORDER BY k.created_at DESC`.execute(db)).rows;
    const mods = await db.selectFrom('sys_tenant_module').select(['module_key', 'enabled', 'valid_to', 'seats', 'remark']).where('tenant_id', '=', id).where('deleted_at', 'is', null).execute() as TenantModuleRow[];
    const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
    const hasDevices = !!(await sql<{ n: number }>`SELECT count(*)::int AS n FROM sys_device d JOIN sys_company c ON c.id = d.company_id WHERE c.tenant_id = ${id} AND d.deleted_at IS NULL AND d.status = 'A'`.execute(db)).rows[0]?.n;
    return {
      tenant: { ...t, contact_email: t.contact_email ? maskEmail(t.contact_email) : null, contact_phone: t.contact_phone ? maskPhone(t.contact_phone) : null },
      companies, users, api_keys: keys,
      modules: tenantModuleStatus(mods, today), features: tenantFeatureStatus(mods, today, { hasDevices }),
      // การใช้งานเดือนนี้ (จำนวนเอกสาร พื้นที่ไฟล์ AI) — ตัวเลขรวม ไม่มีเนื้อหาเอกสาร
      usage: await tenantReport(db, id, thisMonthTh(), true),
    };
  });

  /** ติ๊ก/เลิกติ๊ก ลูกค้าข้อมูลตัวอย่าง (ข้อ R2): ผู้ให้บริการเท่านั้น · บันทึกเหตุการณ์ */
  app.put('/api/v1/provider/customers/:id/demo', async (req) => {
    const a = platform(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const b = parse(z.object({ is_demo: z.boolean() }), req.body);
    const t = await db.selectFrom('sys_tenant').select(['code', 'is_demo']).where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
    if (!t) throw notFound('ลูกค้าผู้ใช้บริการ');
    // HANDOFF 204 N1: เปิด "ข้อมูลตัวอย่าง" ให้ลูกค้าที่มีอยู่แล้วไม่ได้เลย (ลูกค้าว่างวันนี้อาจใส่ข้อมูลจริงพรุ่งนี้ — เป็นทางเข้าถาวร)
    // ข้อมูลตัวอย่างเกิดได้ 2 ทางเท่านั้น: สร้างลูกค้าตัวอย่างของผู้ให้บริการ (POST /tenants is_demo) หรือ migration ที่เจ้าของอนุมัติ (แบบ DEMO) · เลิกได้เสมอ
    if (b.is_demo && !t.is_demo) throw forbidden(`ตั้งลูกค้าที่มีอยู่แล้ว (${t.code}) เป็นข้อมูลตัวอย่างไม่ได้ — ข้อมูลตัวอย่างสร้างได้ตอนเพิ่มลูกค้าตัวอย่างใหม่ หรือด้วย migration ที่เจ้าของอนุมัติเท่านั้น (HANDOFF 204)`);
    if (t.is_demo !== b.is_demo) {
      await db.updateTable('sys_tenant').set({ is_demo: b.is_demo, updated_by: a.userId }).where('id', '=', id).execute();
      const detail = { tenant: t.code, from: t.is_demo, to: b.is_demo };
      const action = b.is_demo ? 'TENANT_DEMO_ON' : 'TENANT_DEMO_OFF';
      await logActivity(db, { companyId: null, userId: a.userId }, { module: 'SYS', action, docNo: t.code, table: 'sys_tenant', rowId: id, detail });
      // ลูกค้าเห็นในแฟ้มบันทึกเหตุการณ์ของบริษัทตัวเอง + อีเมลแจ้ง
      for (const c of await db.selectFrom('sys_company').select('id').where('tenant_id', '=', id).where('deleted_at', 'is', null).execute())
        await logActivity(db, { companyId: c.id, userId: a.userId }, { module: 'SYS', action, docNo: t.code, table: 'sys_tenant', rowId: id, detail });
      noticeCustomer(db, publicBase(req), id, b.is_demo ? `แจ้ง: บัญชี ${t.code} ถูกตั้งเป็นข้อมูลตัวอย่าง` : `แจ้ง: บัญชี ${t.code} เลิกเป็นข้อมูลตัวอย่าง`, [
        b.is_demo ? `ผู้ให้บริการ Buddy Account ตั้งบัญชี ${t.code} เป็นข้อมูลตัวอย่าง/ทดลอง เมื่อ ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })} — เจ้าหน้าที่ผู้ให้บริการเปิดข้อมูลในบัญชีนี้ได้ (ใช้กับบัญชีทดลองที่ยังไม่มีข้อมูลเท่านั้น)`
          : `ผู้ให้บริการ Buddy Account เลิกตั้งบัญชี ${t.code} เป็นข้อมูลตัวอย่าง เมื่อ ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })} — เจ้าหน้าที่ผู้ให้บริการเปิดข้อมูลในบัญชีนี้ไม่ได้แล้ว`,
        'ถ้าท่านไม่ได้ขอ โปรดแจ้งผู้ให้บริการทันที']);
    }
    return { id, is_demo: b.is_demo };
  });

  /** ส่งลิงก์ตั้งรหัสผ่านทางอีเมลของลูกค้า (ข้อ d1) — ลูกค้าข้อมูลตัวอย่างใช้ลิงก์เชิญปกติได้ */
  app.post('/api/v1/provider/users/:id/email-invite', async (req) => {
    const a = platform(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const u = await db.selectFrom('sys_user').select(['id', 'username', 'display_name', 'tenant_id', 'status']).where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
    if (!u || !u.tenant_id) throw notFound('ผู้ใช้ของลูกค้า');
    if (u.status !== 'A') throw badRequest(`ผู้ใช้ ${u.username} ถูกระงับอยู่ — ให้ผู้ดูแลของลูกค้าเปิดใช้ก่อน`);
    const sec = await db.selectFrom('sys_user_security').select('totp_enabled').where('user_id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
    if (sec?.totp_enabled) throw badRequest(`${u.username} เปิดยืนยันตัวตนสองขั้นอยู่ — กด "ล้าง 2FA" ก่อน แล้วส่งลิงก์`);
    return emailInvite(db, publicBase(req), a, { ...u, tenant_id: u.tenant_id });
  });
}
