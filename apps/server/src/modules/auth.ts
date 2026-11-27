import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { sql } from 'kysely';
import { z } from 'zod';
import { companyTenantOff, permissionView, tenantOffMenus } from './permissions.js';
import type { Db } from '../db.js';
import { AppError, badRequest, forbidden, parse, PROVIDER_LOCKED, requireAuth, unauthorized, type AuthContext } from '../http.js';
import { logActivity } from '../audit.js';
import { rateLimit, requireHuman, turnstileSiteKey } from '../botguard.js';
import type { Config } from '../config.js';
import { loadApiKey } from './apikeys.js';
import { hubOnly, normalizeAppAccess, passwordProblem, normalizeUiTheme, tenantBlockedMessage } from '@buddy/core';
import { mfaForAll, clearFails, finishSecondStep, lockedError, lockedUntil, markPasswordChanged, registerFail, secOf, startSecondStep } from './security.js';

export const SESSION_COOKIE = 'buddy_session';
const ADMIN_GROUP = 'ADMIN';
const sha = (t: string) => createHash('sha256').update(t).digest('hex');

export async function loadSession(db: Db, token: string | undefined): Promise<AuthContext | undefined> {
  if (!token) return undefined;
  const row = await db
    .selectFrom('sys_session as s')
    .innerJoin('sys_user as u', 'u.id', 's.user_id')
    .leftJoin('sys_user_group as g', (j) => j.onRef('g.id', '=', 'u.user_group_id').on('g.deleted_at', 'is', null))
    .leftJoin('sys_tenant as t', 't.id', 'u.tenant_id')
    .leftJoin('sys_user_security as sec', (j) => j.onRef('sec.user_id', '=', 'u.id').on('sec.deleted_at', 'is', null))
    .select(['sec.totp_enabled', 's.id', 's.user_id', 's.current_company_id', 's.current_branch_id', 's.work_date', 'u.username', 'u.display_name', 'u.status', 'u.tenant_id', 'u.approval_level', 'u.check_rights', 'u.user_group_id', 'u.app_access',
      'g.code as group_code', 'g.tenant_id as group_tenant_id', 't.status as tenant_status', 't.expires_on as tenant_expires', 't.require_mfa as tenant_require_mfa'])
    .where('s.token_hash', '=', sha(token))
    .where('s.ended_at', 'is', null)
    .where('s.expires_at', '>', sql<string>`now()`)
    .where('s.deleted_at', 'is', null)
    .executeTakeFirst();
  if (!row || row.status !== 'A') return undefined;
  if (row.tenant_id && !tenantActive(row.tenant_status, row.tenant_expires)) return undefined;
  // กลุ่ม ADMIN นับเฉพาะกลุ่มของ tenant เดียวกับผู้ใช้ (กันการผูกกลุ่มข้าม tenant)
  const isAdmin = row.group_code === ADMIN_GROUP && (row.group_tenant_id ?? null) === (row.tenant_id ?? null);
  const a: AuthContext = {
    sessionId: row.id, userId: row.user_id, username: row.username, displayName: row.display_name,
    tenantId: row.tenant_id, isAdmin, isPlatform: isAdmin && !row.tenant_id,
    companyId: row.current_company_id, branchId: row.current_branch_id, workDate: row.work_date,
    approvalLevel: row.approval_level, checkRights: row.check_rights, groupId: row.user_group_id, apps: normalizeAppAccess(row.app_access),
    // ยังไม่ตั้ง 2FA: ทุกผู้ใช้ (HANDOFF 184 · ชุดทดสอบปิดได้) · ผู้ใช้ของลูกค้าที่ตั้งบังคับทุกผู้ใช้ — อ่านทุกคำขอ session เดิมจึงถูกบังคับตั้งแต่คำขอถัดไป
    tenantRequireMfa: !!row.tenant_id && !!row.tenant_require_mfa,
    mfaSetupRequired: !row.totp_enabled && (mfaForAll() || (!!row.tenant_id && !!row.tenant_require_mfa)),
  };
  // บริษัทที่ค้างใน session ต้องยังเข้าได้ (เช่น ถูกถอนสิทธิ์ หรือเป็นของ tenant อื่น)
  if (a.companyId && !(await canAccessCompany(db, a, a.companyId))) { a.providerLocked = a.isPlatform; a.companyId = null; a.branchId = null; }
  return a;
}

export function tenantActive(status: string | null | undefined, expires: string | null | undefined) {
  if (status !== 'A') return false;
  return !expires || expires >= new Date().toISOString().slice(0, 10);
}

/** ข้อความเมื่อเจ้าหน้าที่ผู้ให้บริการเรียกข้อมูลของลูกค้าที่ไม่ใช่ข้อมูลตัวอย่าง (HANDOFF 204) */
export { PROVIDER_LOCKED };
/** ลูกค้านี้เป็นข้อมูลตัวอย่าง (ผู้ให้บริการเข้าได้) — ไม่มีลูกค้า = ไม่ใช่ */
export async function tenantIsDemo(db: Db, tenantId: string | null | undefined) {
  if (!tenantId) return false;
  return !!(await db.selectFrom('sys_tenant').select('is_demo').where('id', '=', tenantId).where('deleted_at', 'is', null).executeTakeFirst())?.is_demo;
}
/** ผู้ให้บริการทำกับลูกค้า/บริษัท/ผู้ใช้ของลูกค้านี้ได้ไหม (ลูกค้าเอง = ได้เสมอ) — ไม่ได้ = 403 */
export async function requireDemoForProvider(db: Db, a: Pick<AuthContext, 'isPlatform'>, tenantId: string | null | undefined) {
  if (a.isPlatform && !(await tenantIsDemo(db, tenantId))) throw new AppError(403, 'PROVIDER_LOCKED', PROVIDER_LOCKED);
}

/**
 * บริษัทที่ผู้ใช้เข้าได้ — หลักแยกข้อมูลลูกค้า:
 * - เจ้าหน้าที่ผู้ให้บริการ (ADMIN ไม่มี tenant): เฉพาะบริษัทของลูกค้าข้อมูลตัวอย่าง (is_demo — HANDOFF 204 เจ้าของ 27/11/2569
 *   "Admin จะทำได้กรณีข้อมูลตัวอย่างเพื่อให้ลูกค้าทดลองใช้ Demo แค่นั้น") — ลูกค้าจริงดูได้เฉพาะภาพรวมที่ศูนย์ผู้ให้บริการ
 * - ผู้ดูแลของลูกค้า (ADMIN ใน tenant): ทุกบริษัทของ tenant ตัวเองเท่านั้น
 * - ผู้ใช้ทั่วไป: เฉพาะบริษัทที่ได้รับสิทธิ์ และต้องอยู่ใน tenant ตัวเอง
 */
export async function companiesForUser(db: Db, a: Pick<AuthContext, 'userId' | 'isAdmin' | 'isPlatform' | 'tenantId'>) {
  let q = db.selectFrom('sys_company as c').leftJoin('sys_tenant as t', 't.id', 'c.tenant_id')
    .select(['c.id', 'c.code', 'c.name_th', 'c.name_en', 'c.year_system', 'c.tenant_id', 't.code as tenant_code', 't.name as tenant_name', 't.is_demo as tenant_demo'])
    .where('c.deleted_at', 'is', null).where('c.status', '=', 'A');
  if (a.isPlatform) q = q.where('t.is_demo', '=', true).where('t.deleted_at', 'is', null);
  else {
    if (!a.tenantId) return [];
    q = q.where('c.tenant_id', '=', a.tenantId);
    if (!a.isAdmin) q = q.where((eb) => eb.exists(eb.selectFrom('sys_user_company as uc').select('uc.id').whereRef('uc.company_id', '=', 'c.id').where('uc.user_id', '=', a.userId).where('uc.deleted_at', 'is', null)));
  }
  return q.orderBy('t.code').orderBy('c.code').execute();
}

export async function canAccessCompany(db: Db, a: Pick<AuthContext, 'userId' | 'isAdmin' | 'isPlatform' | 'tenantId'>, companyId: string) {
  return (await companiesForUser(db, a)).some((c) => c.id === companyId);
}

export async function newSession(db: Db, cfg: Config, userId: string, req: FastifyRequest, workDate?: string | null) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + cfg.sessionHours * 3600_000).toISOString();
  // เลือกบริษัทล่าสุดที่ใช้ หรือบริษัทแรกที่เข้าได้
  const last = await db.selectFrom('sys_session').select(['current_company_id', 'current_branch_id']).where('user_id', '=', userId).where('current_company_id', 'is not', null).orderBy('created_at', 'desc').limit(1).executeTakeFirst();
  const s = await db.insertInto('sys_session').values({
    user_id: userId, token_hash: sha(token), expires_at: expires, ip_address: req.ip?.slice(0, 60) ?? null,
    user_agent: (req.headers['user-agent'] ?? '').slice(0, 200), current_company_id: last?.current_company_id ?? null,
    current_branch_id: last?.current_branch_id ?? null, work_date: workDate ?? null,
  }).returning('id').executeTakeFirstOrThrow();
  // 1 รหัสเข้าได้ทีละ 1 เครื่อง (HANDOFF 156): ลูกค้าเปิดทุกผู้ใช้ หรือผู้ใช้นี้เปิดเอง → เครื่องอื่นที่เปิดค้างอยู่ออกจากระบบ (REPLACED = บอกเหตุที่เครื่องเดิม)
  if (await singleSession(db, userId)) {
    const ended = await db.updateTable('sys_session').set({ ended_at: sql`now()` as never, end_reason: SESSION_REPLACED })
      .where('user_id', '=', userId).where('id', '<>', s.id).where('ended_at', 'is', null).where('deleted_at', 'is', null).returning('id').execute();
    if (ended.length) await logActivity(db, { companyId: null, userId }, { module: 'SYS', action: 'SESSION_REPLACED', detail: { ended: ended.length, ip: req.ip } });
  }
  return token;
}

export const SESSION_REPLACED = 'REPLACED';
/** ผู้ใช้นี้ถูกจำกัด 1 เครื่อง: ค่าของลูกค้า (ผู้ให้บริการตั้ง) หรือค่าของผู้ใช้ — ผู้ใช้เข้มกว่าได้ ผ่อนค่าของลูกค้าไม่ได้ */
async function singleSession(db: Db, userId: string) {
  const r = await db.selectFrom('sys_user as u').leftJoin('sys_tenant as t', 't.id', 'u.tenant_id').select(['u.single_session as own', 't.single_session as tenant']).where('u.id', '=', userId).executeTakeFirst();
  return !!r && (r.own || !!r.tenant);
}
/** cookie ของ session ที่ถูกแทนด้วยการเข้าระบบจากเครื่องอื่น → ข้อความชัดเจนแทน "กรุณาเข้าสู่ระบบ" */
async function replacedError(db: Db, token: string) {
  const r = await db.selectFrom('sys_session').select('id').where('token_hash', '=', sha(token)).where('end_reason', '=', SESSION_REPLACED).where('deleted_at', 'is', null).executeTakeFirst();
  return r ? new AppError(401, 'SESSION_REPLACED', 'รหัสผู้ใช้นี้เข้าระบบจากเครื่องอื่นแล้ว (ตั้งไว้ 1 รหัสเข้าได้ทีละ 1 เครื่อง) — ถ้าเป็นคุณ เข้าระบบใหม่ที่เครื่องนี้ได้ เครื่องอื่นจะออกจากระบบแทน · ถ้าไม่ใช่คุณ เปลี่ยนรหัสผ่านทันที') : null;
}

export const sessionCookieOptions = (cfg: Config, req: FastifyRequest) => ({ path: '/', httpOnly: true, sameSite: 'lax' as const, secure: cfg.cookieSecure || req.protocol === 'https', maxAge: cfg.sessionHours * 3600 });

export function authRoutes(app: FastifyInstance, db: Db, cfg: Config) {
  // คุกกี้ Secure เมื่อตั้ง BUDDY_COOKIE_SECURE หรือคำขอมาทาง https (Cloudflare Tunnel buddyapp — req.protocol จาก X-Forwarded-Proto ของ cloudflared บนเครื่องนี้ · app.ts trustProxy)
  const cookieOpts = (req: FastifyRequest) => sessionCookieOptions(cfg, req);

  app.get('/api/v1/setup/status', async () => {
    const n = await db.selectFrom('sys_user').select(sql<number>`count(*)`.as('n')).where('deleted_at', 'is', null).executeTakeFirstOrThrow();
    return { needsSetup: Number(n.n) === 0 };
  });

  /** ตั้งผู้ดูแลระบบคนแรก (ทำได้ครั้งเดียวตอนยังไม่มีผู้ใช้) */
  app.post('/api/v1/setup', async (req, reply) => {
    const body = parse(z.object({
      username: z.string().trim().min(1, 'ป้อนรหัสผู้ใช้').max(30).regex(/^[A-Za-z0-9_.-]+$/, 'รหัสผู้ใช้ใช้ได้เฉพาะตัวอักษรอังกฤษ ตัวเลข _ . -'),
      display_name: z.string().trim().min(1, 'ป้อนชื่อผู้ใช้').max(120),
      password: z.string().max(200).refine((p) => !passwordProblem(p), (p) => ({ message: passwordProblem(p) ?? '' })),
    }), req.body);
    const token = await db.transaction().execute(async (tx) => {
      const n = await tx.selectFrom('sys_user').select(sql<number>`count(*)`.as('n')).executeTakeFirstOrThrow();
      if (Number(n.n) > 0) throw new AppError(409, 'ALREADY_SETUP', 'ตั้งค่าผู้ดูแลระบบไปแล้ว — เข้าระบบด้วยรหัสผู้ใช้และรหัสผ่านที่ตั้งไว้');
      // ผู้ใช้คนแรก = ผู้ดูแลระบบของผู้ให้บริการ (ไม่สังกัด tenant)
      let grp = await tx.selectFrom('sys_user_group').select('id').where('code', '=', ADMIN_GROUP).where('tenant_id', 'is', null).executeTakeFirst();
      if (!grp) grp = await tx.insertInto('sys_user_group').values({ code: ADMIN_GROUP, name: 'ผู้ดูแลระบบ' }).returning('id').executeTakeFirstOrThrow();
      // เซิร์ฟเวอร์ใหม่ (HANDOFF 204): ลูกค้าเริ่มต้น DEFAULT = ข้อมูลทดลองของผู้ติดตั้ง (ผู้ดูแลคนแรกสร้างบริษัททดลองได้)
      // ลูกค้าจริงสร้างที่ ศูนย์ผู้ให้บริการ / ใบสมัคร — ผู้ดูแลของลูกค้าตั้งรหัสผ่านเองจากลิงก์ทางอีเมล · ยกเลิกติ๊กได้ที่ศูนย์ผู้ให้บริการ
      if (!(await tx.selectFrom('sys_tenant').select('id').where('code', '=', 'DEFAULT').where('deleted_at', 'is', null).executeTakeFirst()))
        await tx.insertInto('sys_tenant').values({ code: 'DEFAULT', name: 'ลูกค้าเริ่มต้น (ข้อมูลทดลอง)', is_demo: true }).execute();
      const u = await tx.insertInto('sys_user').values({
        username: body.username, display_name: body.display_name, password_hash: await bcrypt.hash(body.password, 10),
        user_group_id: grp.id, approval_level: 9,
      }).returning('id').executeTakeFirstOrThrow();
      await logActivity(tx, { companyId: null, userId: u.id }, { module: 'SYS', action: 'SETUP', table: 'sys_user', rowId: u.id });
      return newSession(tx, cfg, u.id, req);
    }).catch((e: unknown) => {
      // ส่งพร้อมกัน 2 คำขอ (กดซ้ำ) — คำขอแรกสร้างแล้ว คำขอที่สองชนข้อมูลซ้ำ = ตั้งค่าไปแล้ว ไม่ใช่ความผิดพลาด
      if ((e as { code?: string })?.code === '23505') throw new AppError(409, 'ALREADY_SETUP', 'ตั้งค่าผู้ดูแลระบบไปแล้ว — เข้าระบบด้วยรหัสผู้ใช้และรหัสผ่านที่ตั้งไว้');
      throw e;
    });
    reply.setCookie(SESSION_COOKIE, token, cookieOpts(req));
    return { ok: true };
  });

  /** หน้าเข้าระบบ/สมัครใช้งาน: ช่องตรวจว่าไม่ใช่บอท (Cloudflare Turnstile) — ว่าง = ไม่แสดง (HANDOFF 165) */
  app.get('/api/v1/auth/bot-check', async () => ({ site_key: turnstileSiteKey() }));

  app.post('/api/v1/auth/login', async (req, reply) => {
    const body = parse(z.object({ username: z.string().trim().min(1, 'ป้อนรหัสผู้ใช้'), password: z.string().min(1, 'ป้อนรหัสผ่าน'), work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), req.body);
    // กันเดารหัสผ่าน (HANDOFF 165): ต่อ IP และต่อรหัสผู้ใช้ ก่อนตรวจรหัสผ่าน · ไม่ใช่บอท (ถ้าตั้ง Turnstile)
    rateLimit('login-ip', req.ip, reply);
    rateLimit('login-user', body.username, reply);
    await requireHuman(req);
    const u = await db.selectFrom('sys_user as u').leftJoin('sys_tenant as t', 't.id', 'u.tenant_id')
      .select(['u.id', 'u.password_hash', 'u.status', 'u.tenant_id', 't.status as tenant_status', 't.expires_on', 't.moved_to', 't.suspend_reason', 't.purge_after']).where(sql`lower(u.username)`, '=', body.username.toLowerCase()).where('u.deleted_at', 'is', null).executeTakeFirst();
    const sec = u ? await secOf(db, u.id) : undefined;
    const until = lockedUntil(sec);
    if (u && until) {
      await logActivity(db, { companyId: null, userId: u.id }, { module: 'SYS', action: 'LOGIN_FAIL', detail: { username: body.username, ip: req.ip, locked: true } });
      throw lockedError(until);
    }
    const ok = u && u.status === 'A' && u.password_hash && (await bcrypt.compare(body.password, u.password_hash));
    if (!u || !ok) {
      await logActivity(db, { companyId: null, userId: u?.id ?? null }, { module: 'SYS', action: 'LOGIN_FAIL', detail: { username: body.username, ip: req.ip } });
      const locked = u ? await registerFail(db, u.id, req.ip) : null;
      if (locked) throw lockedError(locked);
      throw new AppError(401, 'LOGIN_FAILED', 'รหัสผู้ใช้หรือรหัสผ่านไม่ถูกต้อง (ใส่ผิด 5 ครั้งติดกัน บัญชีจะถูกล็อก 15 นาที)');
    }
    // เปิด 2FA: ล้างตัวนับเมื่อผ่านขั้นที่ 2 เท่านั้น (กันเดารหัสจากแอปโดยใส่รหัสผ่านถูกสลับไปเรื่อย ๆ)
    if (!sec?.totp_enabled) await clearFails(db, u.id);
    if (u.tenant_id && u.moved_to) throw new AppError(403, 'TENANT_MOVED', `บัญชีของท่านย้ายไปใช้ที่ ${u.moved_to} แล้ว — เข้าระบบที่ที่อยู่ใหม่ด้วยรหัสผู้ใช้และรหัสผ่านเดิม`);
    // ระงับ/เลิกใช้/หมดอายุ: บอกวันลบข้อมูลถาวร (HANDOFF 186) และให้ติดต่อผู้ให้บริการเพื่อชำระเงินหรือขอสำเนาข้อมูล
    if (u.tenant_id && !tenantActive(u.tenant_status, u.expires_on)) throw new AppError(403, 'TENANT_SUSPENDED', tenantBlockedMessage({ status: u.tenant_status === 'A' ? null : u.tenant_status, suspend_reason: u.suspend_reason, purge_after: u.purge_after }));
    // เปิดยืนยันตัวตนสองขั้น: ยังไม่ออก session — ต้องใส่รหัสจากแอปก่อน (ภายใน 5 นาที)
    if (sec?.totp_enabled) return { need_totp: true, ticket: startSecondStep(u.id, body.work_date) };
    const token = await newSession(db, cfg, u.id, req, body.work_date);
    await db.updateTable('sys_user').set({ last_login_at: sql`now()` }).where('id', '=', u.id).execute();
    await logActivity(db, { companyId: null, userId: u.id }, { module: 'SYS', action: 'LOGIN', detail: { ip: req.ip } });
    reply.setCookie(SESSION_COOKIE, token, cookieOpts(req));
    return { ok: true };
  });

  /** ขั้นที่ 2: รหัส 6 หลักจากแอป หรือรหัสสำรอง */
  app.post('/api/v1/auth/login/totp', async (req, reply) => {
    const b = parse(z.object({ ticket: z.string().min(10).max(100), code: z.string().trim().min(1, 'ป้อนรหัสจากแอป').max(20) }), req.body);
    rateLimit('totp-ip', req.ip, reply);
    const r = await finishSecondStep(db, b.ticket, b.code, req.ip);
    const token = await newSession(db, cfg, r.userId, req, r.workDate);
    await db.updateTable('sys_user').set({ last_login_at: sql`now()` }).where('id', '=', r.userId).execute();
    await logActivity(db, { companyId: null, userId: r.userId }, { module: 'SYS', action: 'LOGIN', detail: { ip: req.ip, mfa: r.via } });
    reply.setCookie(SESSION_COOKIE, token, cookieOpts(req));
    return { ok: true };
  });

  app.post('/api/v1/auth/logout', async (req, reply) => {
    if (req.auth) {
      await db.updateTable('sys_session').set({ ended_at: sql`now()` }).where('id', '=', req.auth.sessionId).execute();
      await logActivity(db, { companyId: req.auth.companyId, userId: req.auth.userId }, { module: 'SYS', action: 'LOGOUT' });
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/v1/auth/me', async (req) => {
    const a = requireAuth(req);
    // กุญแจ API ผูกบริษัทเดียว
    const companies = (await companiesForUser(db, a)).filter((c) => !a.apiKeyId || c.id === a.companyId);
    let company = companies.find((c) => c.id === a.companyId) ?? null;
    let branchId = a.branchId;
    if (!company && companies.length) {
      company = companies[0]!;
      branchId = null;
      await db.updateTable('sys_session').set({ current_company_id: company.id, current_branch_id: null }).where('id', '=', a.sessionId).execute();
    }
    const branches = company ? await db.selectFrom('sys_branch').select(['id', 'code', 'name', 'tax_branch_no', 'is_head_office']).where('company_id', '=', company.id).where('deleted_at', 'is', null).orderBy('code').execute() : [];
    const branch = branches.find((b) => b.id === branchId) ?? null;
    const view = company ? await permissionView(db, { ...a, companyId: company.id }) : null;
    // HANDOFF 200: เมนูที่ลูกค้ายังไม่ได้เปิด (หน้าจอแสดง "ยังไม่เปิดให้กิจการของคุณ" เมื่อเปิดที่อยู่ตรง) · ผู้ให้บริการ = []
    const tenantOff = a.isPlatform ? [] : company ? await companyTenantOff(db, company.id) : await tenantOffMenus(db, a.tenantId);
    return {
      user: { id: a.userId, username: a.username, display_name: a.displayName, is_admin: a.isAdmin, is_platform: a.isPlatform, tenant_id: a.tenantId, approval_level: a.approvalLevel, check_rights: a.checkRights, mfa_setup_required: !!a.mfaSetupRequired,
        // โปรแกรมที่เปิดได้ (null = ทุกโปรแกรมของลูกค้า) · hub_only = ไม่มีสิทธิ์ Buddy → หน้าจอพาไปหน้าเปิดโปรแกรม
        apps: a.apps ?? null, hub_only: hubOnly(a.apps, a.isAdmin) },
      company, branch, branches, companies, work_date: a.workDate,
      // ปีบัญชีของบริษัท (HANDOFF 174): หน้าจอใช้เลือกปีที่ทำงาน และช่วงวันที่ค่าเริ่มต้น = ปีบัญชีของวันทำการ
      fiscal_years: company ? (await sql<{ id: string; code: string; start_date: string; end_date: string; status: string }>`SELECT id, code, to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date, status
          FROM gl_fiscal_year WHERE company_id = ${company.id} AND deleted_at IS NULL ORDER BY start_date`.execute(db)).rows : [],
      // ธีมของบริษัทนี้ (ข้อกำหนดเจ้าของ) — หน้าจอใส่สีและแบบอักษรทันทีที่เลือกบริษัท
      ui_theme: normalizeUiTheme(company ? (await db.selectFrom('sys_setting').select('value').where('company_id', '=', company.id).where('branch_id', 'is', null).where('key', '=', 'ui.theme').where('deleted_at', 'is', null).executeTakeFirst())?.value : null),
      // สิทธิ์รายเมนูของบริษัทนี้ — หน้าจอใช้ซ่อนเมนู/ปุ่ม (ด่านจริงอยู่ที่ API)
      perms: view?.perms ?? {},
      // HANDOFF 197 (เจ้าของ ข้อ 5): เมนูที่ไม่มีสิทธิ์ — hide = ซ่อน (ตั้ง "ซ่อนเมนูที่ไม่มีสิทธิ์") · disable = แสดงจาง กดแล้วบอกเหตุผล (perm_why)
      menu_mode: a.checkRights || a.isAdmin ? 'hide' : 'disable', perm_why: view?.why ?? {}, perm_deny: view?.deny ?? {}, rights_table: view?.table ?? 'off', tenant_off: tenantOff,
    };
  });

  app.post('/api/v1/auth/select', async (req) => {
    const a = requireAuth(req);
    const body = parse(z.object({ company_id: z.string().uuid().optional(), branch_id: z.string().uuid().nullable().optional(), work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() }), req.body);
    const patch: Record<string, unknown> = {};
    const companyId = body.company_id ?? a.companyId;
    if (body.company_id && body.company_id !== a.companyId) {
      if (!(await canAccessCompany(db, a, body.company_id))) {
        if (a.isPlatform) throw forbidden(PROVIDER_LOCKED);
        throw badRequest('ไม่มีสิทธิ์เข้าบริษัทนี้');
      }
      patch.current_company_id = body.company_id;
      patch.current_branch_id = null;
    }
    if (body.branch_id !== undefined) {
      if (body.branch_id) {
        const b = await db.selectFrom('sys_branch').select('id').where('id', '=', body.branch_id).where('company_id', '=', companyId!).executeTakeFirst();
        if (!b) throw badRequest('ไม่พบสาขานี้ในบริษัทที่เลือก');
      }
      patch.current_branch_id = body.branch_id;
    }
    if (body.work_date !== undefined) patch.work_date = body.work_date;
    if (Object.keys(patch).length) await db.updateTable('sys_session').set(patch).where('id', '=', a.sessionId).execute();
    return { ok: true };
  });

  app.post('/api/v1/auth/password', async (req, reply) => {
    const a = requireAuth(req);
    rateLimit('password-user', a.userId, reply);
    const body = parse(z.object({ old_password: z.string().min(1, 'ป้อนรหัสผ่านเดิม'), new_password: z.string().max(200).refine((p) => !passwordProblem(p), (p) => ({ message: passwordProblem(p) ?? '' })) }), req.body);
    const u = await db.selectFrom('sys_user').select('password_hash').where('id', '=', a.userId).executeTakeFirstOrThrow();
    if (!u.password_hash || !(await bcrypt.compare(body.old_password, u.password_hash))) throw badRequest('รหัสผ่านเดิมไม่ถูกต้อง');
    if (await bcrypt.compare(body.new_password, u.password_hash)) throw badRequest('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม');
    if (body.new_password.toLowerCase() === a.username.toLowerCase()) throw badRequest('รหัสผ่านต้องไม่เหมือนรหัสผู้ใช้');
    await db.updateTable('sys_user').set({ password_hash: await bcrypt.hash(body.new_password, 10), updated_by: a.userId }).where('id', '=', a.userId).execute();
    await markPasswordChanged(db, a.userId);
    await logActivity(db, { companyId: a.companyId, userId: a.userId }, { module: 'SYS', action: 'PASSWORD' });
    return { ok: true };
  });
}

export function attachAuth(app: FastifyInstance, db: Db) {
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    // ระบบอื่นส่งกุญแจ API ใน header (T7.5) — มี header แล้วใช้กุญแจเสมอ ไม่ดู cookie
    const authz = req.headers.authorization;
    if (authz && /^Bearer\s+bk_/i.test(authz)) { req.auth = await loadApiKey(db, authz, req.ip); return; }
    const token = req.cookies?.[SESSION_COOKIE];
    req.auth = await loadSession(db, token);
    // เครื่องสาขา (T7.8) ยืนยันด้วยรหัสเครื่องใน header x-buddy-device แทนการเข้าระบบ
    const open = ['/api/v1/setup', '/api/v1/setup/status', '/api/v1/auth/bot-check', '/api/v1/auth/login', '/api/v1/auth/login/totp', '/api/v1/health', '/api/v1/signup', '/api/v1/signup/config',
      '/api/v1/sync/setup-branch', '/api/v1/sync/bootstrap', '/api/v1/sync/push', '/api/v1/sync/pull', '/api/v1/sso/jwks'];
    const path = req.url.split('?')[0]!;
    // ลิงก์เชิญ (HANDOFF 184): เปิด/ตั้งรหัสผ่านได้โดยไม่ต้องเข้าระบบ — token ในลิงก์คือการยืนยัน
    const invite = /^\/api\/v1\/invite\/[A-Za-z0-9_-]+(\/accept)?$/.test(path);
    if (!req.auth && !invite && !open.some((p) => path === p)) throw (token ? await replacedError(db, token) : null) ?? unauthorized();
  });
}
