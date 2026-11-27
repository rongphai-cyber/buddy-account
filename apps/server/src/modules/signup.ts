import type { FastifyInstance, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';
import { checkTaxId, isStarterKey, passwordProblem, type StarterKey } from '@buddy/core';
import type { Config } from '../config.js';
import type { Database, DB } from '../db.js';
import { applyPostingTemplate, createStandardCompany } from '../company-template.js';
import { ensureStandardGroups } from '../standard-groups.js';
import { badRequest, conflict, forbidden, notFound, parse, requireAuth } from '../http.js';
import { logActivity } from '../audit.js';
import { rateLimit, requireHuman } from '../botguard.js';
import { packagePlan, TENANT_PACKAGE_FIELDS } from './usage.js';
import { mailSettings, mailStatusOf, queueSignupMail, setSetting } from './signup-mail.js';

/**
 * สมัครใช้งานเอง (ข้อกำหนดเจ้าของ 30/10/2569: "สมัครใช้งาน: สมัครเอง หรือผู้ดูแลกำหนดบริษัทให้")
 * BUDDY_SIGNUP = review (ค่าเริ่มต้น: ผู้ให้บริการอนุมัติก่อน) · auto (เปิดบัญชีทันที) · off (ปิดหน้าสมัคร)
 * กันสแปม: ช่องดักบอท, ไม่เกิน 5 ใบต่อ IP ต่อชั่วโมง, ใบสมัครรออนุมัติรวมไม่เกิน 500, รหัสผ่านตามนโยบาย
 * PDPA: ต้องยอมรับเงื่อนไข/ข้อตกลงข้อมูลส่วนบุคคล · รหัสผ่านที่เก็บไว้ล้างทิ้งเมื่อพิจารณาแล้ว · ใบที่ไม่อนุมัติล้างข้อมูลติดต่อเมื่อครบ 90 วัน
 */
export type SignupMode = 'off' | 'review' | 'auto';
const PER_IP_HOUR = 5, MAX_PENDING = 500, PURGE_DAYS = 90;

/**
 * เปิด/ปิดรับสมัครจากหน้าจอ (HANDOFF 189 เจ้าของ "ช่วงทดลอง ... ไม่ให้ลูกค้าทดลองจริงมากเกินไป") — ไม่ต้อง deploy
 * เก็บใน sys_platform_setting: signup.open (true/false · ไม่มี = เปิดตาม BUDDY_SIGNUP) · signup.max_pending (รับใบรออนุมัติสูงสุด · null = ไม่จำกัด) · signup.closed_message (ข้อความหน้าปิดรับสมัคร)
 * BUDDY_SIGNUP = off → ล็อกปิด เปิดจากหน้าจอไม่ได้ · auto ตั้งได้ที่ env อย่างเดียว (หน้าจอเลือกแค่ เปิด/ปิด)
 * ใบรออนุมัติถึงจำนวนที่ตั้ง = หน้าสมัครปิดเอง (เปิดอีกครั้งเมื่อพิจารณาใบสมัครแล้วจำนวนลดลง)
 */
export type SignupState = { env: SignupMode; locked: boolean; open: boolean; max_pending: number | null; closed_message: string | null; pending: number; full: boolean; mode: SignupMode };
const SIGNUP_KEYS = ['signup.open', 'signup.max_pending', 'signup.closed_message'];
export async function signupState(db: Kysely<DB>, env: SignupMode): Promise<SignupState> {
  const rows = await db.selectFrom('sys_platform_setting').select(['key', 'value']).where('key', 'in', SIGNUP_KEYS).where('deleted_at', 'is', null).execute();
  const v = (k: string) => rows.find((r) => r.key === k)?.value as unknown;
  const max = v('signup.max_pending'), msg = v('signup.closed_message');
  const max_pending = typeof max === 'number' && max > 0 ? Math.floor(max) : null;
  const pending = (await sql<{ n: number }>`SELECT count(*)::int AS n FROM sys_signup WHERE status = 'P' AND deleted_at IS NULL`.execute(db)).rows[0]!.n;
  const locked = env === 'off', open = v('signup.open') !== false, full = max_pending !== null && pending >= max_pending;
  return { env, locked, open, max_pending, closed_message: typeof msg === 'string' && msg.trim() ? msg.trim() : null, pending, full, mode: locked || !open || full ? 'off' : env };
}
/** ข้อความเมื่อปิดรับสมัคร (API ปฏิเสธ · หน้าสมัคร) */
const closedText = (s: SignupState) => `ขณะนี้ปิดรับสมัครใช้งาน — ${s.closed_message ?? 'ติดต่อผู้ให้บริการเพื่อเปิดบัญชี'}`;

/** สร้างลูกค้าผู้ใช้บริการ + กลุ่ม ADMIN + ผู้ดูแลคนแรก (ใช้ทั้งเจ้าหน้าที่สร้างเองและอนุมัติใบสมัคร) */
export async function createTenantWithAdmin(tx: Kysely<DB>, actor: string | null, t: {
  code: string; name: string; contact_email?: string | null; contact_phone?: string | null; plan?: string; max_companies?: number | null; max_users?: number | null;
  expires_on?: string | null; status?: string; dpa_signed_on?: string | null; single_session?: boolean; admin_username: string; admin_name: string; password_hash: string | null;
  // แพ็กเกจ (HANDOFF 185) — ว่าง = ไม่มีแพ็กเกจ/ตามแพ็กเกจ
  package_id?: string | null; docs_per_month?: number | null; file_quota_mb?: number | null; ai_per_month?: number | null; over_action?: 'W' | 'S';
  // ผู้จ่ายค่า AI (HANDOFF 190) — ไม่ส่ง = ลูกค้าจ่ายเอง · เพดานไม่ส่ง = ค่าเริ่มต้นของคอลัมน์ (20 ดอลลาร์)
  ai_payer?: 'C' | 'P'; ai_limit_usd?: string | null;
}) {
  const row = await tx.insertInto('sys_tenant').values({ code: t.code, name: t.name, contact_email: t.contact_email ?? null, contact_phone: t.contact_phone ?? null, plan: t.plan ?? 'standard',
    max_companies: t.max_companies ?? null, max_users: t.max_users ?? null, expires_on: t.expires_on ?? null, status: t.status ?? 'A', dpa_signed_on: t.dpa_signed_on ?? null, single_session: t.single_session ?? false, is_demo: false, contact_email_changed_at: t.contact_email ? sql`now()` as never : null,
    package_id: t.package_id ?? null, docs_per_month: t.docs_per_month ?? null, file_quota_mb: t.file_quota_mb ?? null, ai_per_month: t.ai_per_month ?? null, over_action: t.over_action ?? 'W', ai_payer: t.ai_payer ?? 'C', ...(t.ai_limit_usd !== undefined ? { ai_limit_usd: t.ai_limit_usd } : {}), created_by: actor }).returning('id').executeTakeFirstOrThrow();
  const g = await tx.insertInto('sys_user_group').values({ tenant_id: row.id, code: 'ADMIN', name: 'ผู้ดูแลระบบของลูกค้า', created_by: actor }).returning('id').executeTakeFirstOrThrow();
  await tx.insertInto('sys_user').values({ tenant_id: row.id, username: t.admin_username, display_name: t.admin_name, password_hash: t.password_hash, user_group_id: g.id, approval_level: 9, created_by: actor }).execute();
  // กลุ่มตั้งต้น ฝ่ายขาย ฝ่ายจัดซื้อ ฝ่ายบัญชี ดูอย่างเดียว (HANDOFF 159) — สิทธิ์รายเมนูใส่ตอนสร้างบริษัท
  await ensureStandardGroups(tx, row.id, actor, { createGroups: true });
  return row;
}

/** รหัสลูกค้าจากรหัสผู้ใช้ (A-Z 0-9 _ -) ไม่ซ้ำ */
async function newTenantCode(db: Kysely<DB>, username: string) {
  const base = (username.toUpperCase().replace(/[^A-Z0-9_-]/g, '') || 'NEW').slice(0, 16);
  for (let i = 1; i < 1000; i++) {
    const code = i === 1 ? base : `${base}-${i}`;
    if (!(await db.selectFrom('sys_tenant').select('id').where('code', '=', code).executeTakeFirst())) return code;
  }
  throw conflict('ตั้งรหัสลูกค้าไม่ได้ — ป้อนรหัสลูกค้าเอง');
}

/** ปีบัญชีของบริษัทแรก (ไม่ระบุ) = 1 ม.ค. ของปีปัจจุบัน (เวลาไทย) */
const thisYearStart = () => `${new Date(Date.now() + 7 * 3600_000).getUTCFullYear()}-01-01`;

/**
 * อนุมัติใบสมัคร: ลูกค้าผู้ใช้บริการ + ผู้ดูแลคนแรก + (HANDOFF 154) บริษัทแรกจากแม่แบบมาตรฐาน ชื่อกิจการ/เลขผู้เสียภาษีตามใบสมัคร
 * — ลูกค้าเข้าระบบแล้วเริ่มคีย์เอกสารได้ทันที ไม่ต้องให้ผู้ให้บริการตั้งบริษัท · first_company=false = ไม่สร้าง (ลูกค้าสร้างเองที่ กำหนดบริษัทใหม่)
 * กฎการลงบัญชีของบริษัทใหม่ (company_id) ให้ผู้เรียกใช้ applyPostingTemplate หลัง commit
 */
async function approve(db: Kysely<DB>, id: string, actor: string | null, o: { code?: string; plan?: string; max_companies?: number | null; max_users?: number | null; expires_on?: string | null;
  package_id?: string | null; docs_per_month?: number | null; file_quota_mb?: number | null; ai_per_month?: number | null; over_action?: 'W' | 'S'; ai_payer?: 'C' | 'P'; ai_limit_usd?: string | null; first_company?: boolean; starter?: StarterKey; fiscal_start?: string } = {}) {
  const s = await db.selectFrom('sys_signup').selectAll().where('id', '=', id).where('deleted_at', 'is', null).forUpdate().executeTakeFirst();
  if (!s) throw notFound('ใบสมัคร');
  if (s.status !== 'P' || !s.password_hash) throw badRequest('ใบสมัครนี้พิจารณาไปแล้ว');
  if (await db.selectFrom('sys_user').select('id').where('username', '=', s.username).executeTakeFirst()) throw conflict(`รหัสผู้ใช้ ${s.username} มีผู้ใช้แล้ว — ไม่อนุมัติใบนี้และแจ้งผู้สมัครให้สมัครใหม่ด้วยรหัสอื่น`);
  const code = o.code ?? await newTenantCode(db, s.username);
  if (o.code && await db.selectFrom('sys_tenant').select('id').where('code', '=', o.code).executeTakeFirst()) throw conflict(`รหัสลูกค้า ${o.code} มีอยู่แล้ว`);
  const t = await createTenantWithAdmin(db, actor, { code, name: s.business_name, contact_email: s.contact_email, contact_phone: s.contact_phone, plan: o.plan, max_companies: o.max_companies,
    max_users: o.max_users, expires_on: o.expires_on, ...(await packagePlan(db, o)), docs_per_month: o.docs_per_month, file_quota_mb: o.file_quota_mb, ai_per_month: o.ai_per_month, over_action: o.over_action, ai_payer: o.ai_payer, ai_limit_usd: o.ai_limit_usd, dpa_signed_on: String(new Date(s.accepted_terms_at as unknown as string).toISOString()).slice(0, 10), admin_username: s.username, admin_name: s.contact_name, password_hash: s.password_hash });
  await db.updateTable('sys_signup').set({ status: 'A', tenant_id: t.id, password_hash: null, decided_by: actor, decided_at: sql`now()` as never, updated_by: actor }).where('id', '=', id).execute();
  await logActivity(db, { companyId: null, userId: actor }, { module: 'SYS', action: 'NEW_TENANT', docNo: code, table: 'sys_tenant', rowId: t.id, detail: { code, signup: id, auto: !actor } });
  let company: { id: string; code: string } | null = null;
  if (o.first_company !== false) {
    company = await createStandardCompany(db, { tenantId: t.id, code, name_th: s.business_name, tax_id: s.tax_id ?? null, fiscal_start: o.fiscal_start ?? thisYearStart(), actor,
      starter: o.starter ?? (isStarterKey(s.business_template) ? s.business_template : 'TRADE') });
    await ensureStandardGroups(db, t.id, actor, { createGroups: false, companyIds: [company.id] });
    await logActivity(db, { companyId: company.id, userId: actor }, { module: 'SYS', action: 'NEW_COMPANY', docNo: company.code, table: 'sys_company', rowId: company.id, detail: { code: company.code, tenant_id: t.id, signup: id, chart: 'express' } });
  }
  return { tenant_id: t.id, code, company_id: company?.id ?? null, company_code: company?.code ?? null };
}

export function signupRoutes(app: FastifyInstance, database: Database, cfg: Config) {
  const db = database.db;
  /** อนุมัติในทรานแซกชัน แล้วใส่กฎการลงบัญชีของบริษัทแรก */
  const approveAndSetup = async (id: string, actor: string | null, o: Parameters<typeof approve>[3] = {}) => {
    const r = await db.transaction().execute((tx) => approve(tx, id, actor, o));
    if (r.company_id) await applyPostingTemplate(database.execScript, r.company_id);
    return r;
  };
  const mode = (): SignupMode => cfg.signup;
  const state = () => signupState(db, mode());
  /** ที่อยู่หน้าเว็บสำหรับลิงก์ในอีเมล (BUDDY_PUBLIC_URL · ไม่ตั้ง = ที่อยู่ที่เปิดอยู่) */
  const baseOf = (req: FastifyRequest) => cfg.publicUrl ?? `${req.protocol}://${req.host}`;
  const requirePlatform = (req: Parameters<typeof requireAuth>[0]) => { const a = requireAuth(req); if (!a.isPlatform) throw forbidden('เฉพาะเจ้าหน้าที่ผู้ให้บริการโปรแกรม'); return a; };

  /** หน้าสมัคร/หน้าเข้าระบบใช้ — สถานะจริงหลังรวมค่าตั้งของผู้ให้บริการ (ไม่บอกจำนวนใบสมัคร) */
  app.get('/api/v1/signup/config', async () => { const s = await state(); return { mode: s.mode, ...(s.mode === 'off' && s.closed_message ? { message: s.closed_message } : {}) }; });

  app.post('/api/v1/signup', async (req, reply) => {
    const open = await state();
    if (open.mode === 'off') throw forbidden(closedText(open));
    // กันบอท/สแปม (HANDOFF 165): ต่อ IP + ไม่ใช่บอท (ถ้าตั้ง Turnstile) — ซ้อนกับ 5 ใบ/ชั่วโมง/IP เดิม
    rateLimit('signup-ip', req.ip, reply);
    await requireHuman(req);
    const b = parse(z.object({
      business_name: z.string().trim().min(1, 'ป้อนชื่อกิจการ/ร้าน').max(120), contact_name: z.string().trim().min(1, 'ป้อนชื่อผู้ติดต่อ').max(120),
      contact_email: z.string().trim().max(120).email('อีเมลไม่ถูกต้อง'),
      /** เลขประจำตัวผู้เสียภาษี (ไม่บังคับ — ใช้ตั้งบริษัทแรก) */
      tax_id: z.string().trim().max(20).optional().transform((v) => v || undefined),
      contact_phone: z.string().trim().max(60).regex(/^[0-9+\-\s()]{9,}$/, 'ป้อนเบอร์โทรศัพท์ที่ติดต่อได้ เช่น 081-234-5678'),
      username: z.string().trim().min(3, 'รหัสผู้ใช้อย่างน้อย 3 ตัว').max(30).regex(/^[A-Za-z0-9_.@-]+$/, 'รหัสผู้ใช้ใช้ได้เฉพาะตัวอักษรอังกฤษ ตัวเลข _ . @ -'),
      password: z.string().max(200).refine((p) => !passwordProblem(p), (p) => ({ message: passwordProblem(p) ?? '' })),
      accept_terms: z.literal(true, { errorMap: () => ({ message: 'อ่านและยอมรับเงื่อนไขการใช้บริการและการคุ้มครองข้อมูลส่วนบุคคลก่อน' }) }),
      /** ประเภทธุรกิจ (ไม่บังคับ — ข้อมูลตั้งต้นของบริษัทแรก · HANDOFF 160) */
      business_template: z.string().optional().transform((v) => (isStarterKey(v) ? v : undefined)),
      /** ช่องดักบอท (ซ่อนจากผู้ใช้จริง) */
      website: z.string().max(200).optional(),
    }), req.body);
    if (b.website) throw badRequest('ส่งใบสมัครไม่สำเร็จ');
    let taxId: string | null = null;
    if (b.tax_id) { const t = checkTaxId(b.tax_id); if (!t.ok) throw badRequest(t.error); taxId = t.normalized; }
    const ip = req.ip ?? null;
    const recent = (await sql<{ n: number }>`SELECT count(*)::int AS n FROM sys_signup WHERE client_ip = ${ip} AND created_at > now() - interval '1 hour'`.execute(db)).rows[0]!.n;
    if (recent >= PER_IP_HOUR) throw badRequest('ส่งใบสมัครจากเครื่องนี้บ่อยเกินไป — ลองใหม่ในอีก 1 ชั่วโมง');
    const pending = (await sql<{ n: number }>`SELECT count(*)::int AS n FROM sys_signup WHERE status = 'P' AND deleted_at IS NULL`.execute(db)).rows[0]!.n;
    if (pending >= MAX_PENDING) throw badRequest('รับใบสมัครเต็มชั่วคราว — ลองใหม่ภายหลัง หรือติดต่อผู้ให้บริการ');
    const user = b.username;
    if (await db.selectFrom('sys_user').select('id').where(sql`lower(username)`, '=', user.toLowerCase()).executeTakeFirst()
      || await db.selectFrom('sys_signup').select('id').where(sql`lower(username)`, '=', user.toLowerCase()).where('status', '=', 'P').where('deleted_at', 'is', null).executeTakeFirst())
      throw conflict(`รหัสผู้ใช้ ${user} มีผู้ใช้แล้ว — เลือกรหัสอื่น`);
    if (await db.selectFrom('sys_signup').select('id').where(sql`lower(contact_email)`, '=', b.contact_email.toLowerCase()).where('status', '=', 'P').where('deleted_at', 'is', null).executeTakeFirst())
      throw conflict('อีเมลนี้ส่งใบสมัครไว้แล้ว — รอผู้ให้บริการติดต่อกลับ');
    const r = await db.insertInto('sys_signup').values({ business_name: b.business_name, contact_name: b.contact_name, contact_email: b.contact_email, contact_phone: b.contact_phone, tax_id: taxId, business_template: b.business_template ?? null,
      username: user, password_hash: await bcrypt.hash(b.password, 10), accepted_terms_at: sql`now()` as never, client_ip: ip, status: 'P' }).returning('id').executeTakeFirstOrThrow();
    await logActivity(db, { companyId: null, userId: null }, { module: 'SYS', action: 'SIGNUP', docNo: user, table: 'sys_signup', rowId: r.id });
    if (open.mode === 'auto') {
      await approveAndSetup(r.id, null);
      // อีเมล (HANDOFF 187): หลัง commit · ส่งไม่สำเร็จไม่ย้อนการสมัคร
      queueSignupMail(db, ['SIGNUP_NOTIFY', 'SIGNUP_APPROVED'], r.id, baseOf(req));
      return { status: 'A', username: user, message: 'เปิดบัญชีแล้ว — เข้าระบบด้วยรหัสผู้ใช้และรหัสผ่านที่ตั้งไว้ บริษัทแรกพร้อมผังบัญชีมาตรฐานรออยู่แล้ว' };
    }
    queueSignupMail(db, ['SIGNUP_NOTIFY', 'SIGNUP_RECEIVED'], r.id, baseOf(req));
    return { status: 'P', username: user, message: 'ได้รับใบสมัครแล้ว — ผู้ให้บริการจะตรวจสอบและติดต่อกลับทางอีเมล/โทรศัพท์ เมื่ออนุมัติแล้วเข้าระบบด้วยรหัสผู้ใช้และรหัสผ่านที่ตั้งไว้' };
  });

  /* ---- เจ้าหน้าที่ผู้ให้บริการ: พิจารณาใบสมัคร */
  app.get('/api/v1/signups', async (req) => {
    requirePlatform(req);
    const q = parse(z.object({ status: z.enum(['P', 'A', 'R', 'all']).default('P') }), req.query);
    // PDPA: ใบที่ไม่อนุมัติเกิน 90 วัน ล้างข้อมูลติดต่อ (คงแถวไว้เป็นสถิติ)
    await sql`UPDATE sys_signup SET business_name = '-', contact_name = '-', contact_email = '-', contact_phone = '-', tax_id = NULL, client_ip = NULL, password_hash = NULL
               WHERE status = 'R' AND decided_at < now() - make_interval(days => ${PURGE_DAYS}) AND contact_email <> '-'`.execute(db);
    // อีเมลที่ส่งถึงผู้สมัครที่ล้างข้อมูลแล้ว: ล้างผู้รับด้วย (HANDOFF 187)
    await sql`UPDATE sys_mail_log SET recipients = '-' WHERE kind <> 'SIGNUP_NOTIFY' AND recipients <> '-' AND signup_id IN (SELECT id FROM sys_signup WHERE contact_email = '-')`.execute(db);
    let s = db.selectFrom('sys_signup as s').leftJoin('sys_tenant as t', 't.id', 's.tenant_id').leftJoin('sys_user as u', 'u.id', 's.decided_by')
      .select(['s.id', 's.business_name', 's.contact_name', 's.contact_email', 's.contact_phone', 's.tax_id', 's.business_template', 's.username', 's.status', 's.created_at', 's.accepted_terms_at', 's.decided_at', 's.reject_reason', 's.client_ip',
        't.code as tenant_code', 'u.username as decided_by_name'])
      .where('s.deleted_at', 'is', null);
    if (q.status !== 'all') s = s.where('s.status', '=', q.status);
    const rows = await s.orderBy('s.created_at', 'desc').limit(500).execute();
    const mail = await mailStatusOf(db, rows.map((x) => x.id));
    return { mode: (await state()).mode, rows: rows.map((x) => ({ ...x, mail: mail.get(x.id) ?? [] })), notify_set: (await mailSettings(db)).notify.length > 0 };
  });
  app.post('/api/v1/signups/:id/approve', async (req) => {
    const a = requirePlatform(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const o = parse(z.object({
      code: z.string().trim().max(20).regex(/^[A-Za-z0-9_-]+$/, 'รหัสลูกค้าใช้ A-Z 0-9 _ -').optional().or(z.literal('').transform(() => undefined)),
      plan: z.string().trim().max(20).optional(), max_companies: z.coerce.number().int().min(1).nullable().optional(), max_users: z.coerce.number().int().min(1).nullable().optional(),
      expires_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      first_company: z.boolean().default(true), fiscal_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันเริ่มรอบบัญชีไม่ถูกต้อง').optional(),
      starter: z.string().optional().transform((v) => (isStarterKey(v) ? v : undefined)),
      ...TENANT_PACKAGE_FIELDS,
    }), req.body ?? {});
    const r = await approveAndSetup(id, a.userId, o);
    queueSignupMail(db, ['SIGNUP_APPROVED'], id, baseOf(req));
    return r;
  });
  app.post('/api/v1/signups/:id/reject', async (req) => {
    const a = requirePlatform(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const { reason } = parse(z.object({ reason: z.string().trim().min(1, 'ป้อนเหตุผลที่ไม่อนุมัติ').max(200) }), req.body);
    const r = await db.updateTable('sys_signup').set({ status: 'R', reject_reason: reason, password_hash: null, decided_by: a.userId, decided_at: sql`now()` as never, updated_by: a.userId })
      .where('id', '=', id).where('status', '=', 'P').where('deleted_at', 'is', null).executeTakeFirst();
    if (!Number(r.numUpdatedRows)) throw badRequest('ไม่พบใบสมัครที่รออนุมัติ');
    await logActivity(db, a, { module: 'SYS', action: 'SIGNUP_REJECT', table: 'sys_signup', rowId: id, detail: { reason } });
    queueSignupMail(db, ['SIGNUP_REJECTED'], id, baseOf(req));
    return { ok: true };
  });

  /* ---- เปิด/ปิดรับสมัคร (HANDOFF 189) — เจ้าหน้าที่ผู้ให้บริการเท่านั้น */
  app.get('/api/v1/platform/signup-settings', async (req) => { requirePlatform(req); return state(); });
  app.put('/api/v1/platform/signup-settings', async (req) => {
    const a = requirePlatform(req);
    const b = parse(z.object({
      open: z.boolean(),
      max_pending: z.number().int('จำนวนใบสมัครต้องเป็นจำนวนเต็ม').min(1, 'รับใบสมัครอย่างน้อย 1 ใบ — ไม่จำกัดให้เว้นว่าง').max(MAX_PENDING, `รับใบสมัครที่รออนุมัติได้ไม่เกิน ${MAX_PENDING} ใบ`).nullable(),
      closed_message: z.string().trim().max(300, 'ข้อความหน้าปิดรับสมัครไม่เกิน 300 ตัวอักษร').nullable().optional(),
    }), req.body);
    const before = await state();
    if (b.open && before.locked) throw badRequest('ระบบปิดรับสมัครไว้ที่การตั้งค่าเซิร์ฟเวอร์ (BUDDY_SIGNUP=off) — เปิดจากหน้าจอไม่ได้ ติดต่อผู้ดูแลเซิร์ฟเวอร์');
    // ไม่ส่งข้อความมา = คงข้อความเดิม · ส่งว่าง = ล้าง
    const msg = b.closed_message === undefined ? before.closed_message : (b.closed_message?.trim() || null);
    await setSetting(db, 'signup.open', b.open, a.userId);
    await setSetting(db, 'signup.max_pending', b.max_pending, a.userId);
    await setSetting(db, 'signup.closed_message', msg, a.userId);
    const after = await state();
    const pick = (s: SignupState) => ({ open: s.open, max_pending: s.max_pending, closed_message: s.closed_message, mode: s.mode });
    await logActivity(db, a, { module: 'SYS', action: 'SIGNUP_SETTINGS', table: 'sys_platform_setting', detail: { from: pick(before), to: pick(after) } });
    return after;
  });
}
