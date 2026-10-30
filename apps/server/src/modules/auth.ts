import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { sql } from 'kysely';
import { z } from 'zod';
import { permissionMatrix } from './permissions.js';
import type { Db } from '../db.js';
import { AppError, badRequest, parse, requireAuth, unauthorized, type AuthContext } from '../http.js';
import { logActivity } from '../audit.js';
import type { Config } from '../config.js';
import { loadApiKey } from './apikeys.js';
import { passwordProblem, normalizeUiTheme } from '@buddy/core';
import { adminMfaRequired, clearFails, finishSecondStep, lockedError, lockedUntil, markPasswordChanged, registerFail, secOf, startSecondStep } from './security.js';

export const SESSION_COOKIE = 'buddy_session';
const ADMIN_GROUP = 'ADMIN';
const sha = (t: string) => createHash('sha256').update(t).digest('hex');

export async function loadSession(db: Db, token: string | undefined): Promise<AuthContext | undefined> {
  if (!token) return undefined;
  const row = await db
    .selectFrom('sys_session as s')
    .innerJoin('sys_user as u', 'u.id', 's.user_id')
    .leftJoin('sys_user_group as g', 'g.id', 'u.user_group_id')
    .leftJoin('sys_tenant as t', 't.id', 'u.tenant_id')
    .leftJoin('sys_user_security as sec', (j) => j.onRef('sec.user_id', '=', 'u.id').on('sec.deleted_at', 'is', null))
    .select(['sec.totp_enabled', 's.id', 's.user_id', 's.current_company_id', 's.current_branch_id', 's.work_date', 'u.username', 'u.display_name', 'u.status', 'u.tenant_id', 'u.approval_level', 'u.check_rights', 'u.user_group_id',
      'g.code as group_code', 'g.tenant_id as group_tenant_id', 't.status as tenant_status', 't.expires_on as tenant_expires'])
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
    approvalLevel: row.approval_level, checkRights: row.check_rights, groupId: row.user_group_id,
    mfaSetupRequired: isAdmin && !row.totp_enabled && adminMfaRequired(),
  };
  // บริษัทที่ค้างใน session ต้องยังเข้าได้ (เช่น ถูกถอนสิทธิ์ หรือเป็นของ tenant อื่น)
  if (a.companyId && !(await canAccessCompany(db, a, a.companyId))) { a.companyId = null; a.branchId = null; }
  return a;
}

export function tenantActive(status: string | null | undefined, expires: string | null | undefined) {
  if (status !== 'A') return false;
  return !expires || expires >= new Date().toISOString().slice(0, 10);
}

/**
 * บริษัทที่ผู้ใช้เข้าได้ — หลักแยกข้อมูลลูกค้า:
 * - เจ้าหน้าที่ผู้ให้บริการ (ADMIN ไม่มี tenant): ทุกบริษัท
 * - ผู้ดูแลของลูกค้า (ADMIN ใน tenant): ทุกบริษัทของ tenant ตัวเองเท่านั้น
 * - ผู้ใช้ทั่วไป: เฉพาะบริษัทที่ได้รับสิทธิ์ และต้องอยู่ใน tenant ตัวเอง
 */
export async function companiesForUser(db: Db, a: Pick<AuthContext, 'userId' | 'isAdmin' | 'isPlatform' | 'tenantId'>) {
  let q = db.selectFrom('sys_company as c').select(['c.id', 'c.code', 'c.name_th', 'c.name_en', 'c.year_system', 'c.tenant_id']).where('c.deleted_at', 'is', null).where('c.status', '=', 'A');
  if (!a.isPlatform) {
    if (!a.tenantId) return [];
    q = q.where('c.tenant_id', '=', a.tenantId);
    if (!a.isAdmin) q = q.where((eb) => eb.exists(eb.selectFrom('sys_user_company as uc').select('uc.id').whereRef('uc.company_id', '=', 'c.id').where('uc.user_id', '=', a.userId).where('uc.deleted_at', 'is', null)));
  }
  return q.orderBy('c.code').execute();
}

export async function canAccessCompany(db: Db, a: Pick<AuthContext, 'userId' | 'isAdmin' | 'isPlatform' | 'tenantId'>, companyId: string) {
  return (await companiesForUser(db, a)).some((c) => c.id === companyId);
}

async function newSession(db: Db, cfg: Config, userId: string, req: FastifyRequest, workDate?: string | null) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + cfg.sessionHours * 3600_000).toISOString();
  // เลือกบริษัทล่าสุดที่ใช้ หรือบริษัทแรกที่เข้าได้
  const last = await db.selectFrom('sys_session').select(['current_company_id', 'current_branch_id']).where('user_id', '=', userId).where('current_company_id', 'is not', null).orderBy('created_at', 'desc').limit(1).executeTakeFirst();
  await db.insertInto('sys_session').values({
    user_id: userId, token_hash: sha(token), expires_at: expires, ip_address: req.ip?.slice(0, 60) ?? null,
    user_agent: (req.headers['user-agent'] ?? '').slice(0, 200), current_company_id: last?.current_company_id ?? null,
    current_branch_id: last?.current_branch_id ?? null, work_date: workDate ?? null,
  }).execute();
  return token;
}

export function authRoutes(app: FastifyInstance, db: Db, cfg: Config) {
  const cookieOpts = { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: cfg.cookieSecure, maxAge: cfg.sessionHours * 3600 };

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
      if (Number(n.n) > 0) throw new AppError(409, 'ALREADY_SETUP', 'ตั้งค่าผู้ดูแลระบบไปแล้ว');
      // ผู้ใช้คนแรก = ผู้ดูแลระบบของผู้ให้บริการ (ไม่สังกัด tenant)
      let grp = await tx.selectFrom('sys_user_group').select('id').where('code', '=', ADMIN_GROUP).where('tenant_id', 'is', null).executeTakeFirst();
      if (!grp) grp = await tx.insertInto('sys_user_group').values({ code: ADMIN_GROUP, name: 'ผู้ดูแลระบบ' }).returning('id').executeTakeFirstOrThrow();
      const u = await tx.insertInto('sys_user').values({
        username: body.username, display_name: body.display_name, password_hash: await bcrypt.hash(body.password, 10),
        user_group_id: grp.id, approval_level: 9,
      }).returning('id').executeTakeFirstOrThrow();
      await logActivity(tx, { companyId: null, userId: u.id }, { module: 'SYS', action: 'SETUP', table: 'sys_user', rowId: u.id });
      return newSession(tx, cfg, u.id, req);
    });
    reply.setCookie(SESSION_COOKIE, token, cookieOpts);
    return { ok: true };
  });

  app.post('/api/v1/auth/login', async (req, reply) => {
    const body = parse(z.object({ username: z.string().trim().min(1, 'ป้อนรหัสผู้ใช้'), password: z.string().min(1, 'ป้อนรหัสผ่าน'), work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), req.body);
    const u = await db.selectFrom('sys_user as u').leftJoin('sys_tenant as t', 't.id', 'u.tenant_id')
      .select(['u.id', 'u.password_hash', 'u.status', 'u.tenant_id', 't.status as tenant_status', 't.expires_on', 't.moved_to']).where(sql`lower(u.username)`, '=', body.username.toLowerCase()).where('u.deleted_at', 'is', null).executeTakeFirst();
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
    if (u.tenant_id && !tenantActive(u.tenant_status, u.expires_on)) throw new AppError(403, 'TENANT_SUSPENDED', 'บัญชีผู้ใช้บริการนี้ถูกระงับหรือหมดอายุ กรุณาติดต่อผู้ให้บริการ');
    // เปิดยืนยันตัวตนสองขั้น: ยังไม่ออก session — ต้องใส่รหัสจากแอปก่อน (ภายใน 5 นาที)
    if (sec?.totp_enabled) return { need_totp: true, ticket: startSecondStep(u.id, body.work_date) };
    const token = await newSession(db, cfg, u.id, req, body.work_date);
    await db.updateTable('sys_user').set({ last_login_at: sql`now()` }).where('id', '=', u.id).execute();
    await logActivity(db, { companyId: null, userId: u.id }, { module: 'SYS', action: 'LOGIN', detail: { ip: req.ip } });
    reply.setCookie(SESSION_COOKIE, token, cookieOpts);
    return { ok: true };
  });

  /** ขั้นที่ 2: รหัส 6 หลักจากแอป หรือรหัสสำรอง */
  app.post('/api/v1/auth/login/totp', async (req, reply) => {
    const b = parse(z.object({ ticket: z.string().min(10).max(100), code: z.string().trim().min(1, 'ป้อนรหัสจากแอป').max(20) }), req.body);
    const r = await finishSecondStep(db, b.ticket, b.code, req.ip);
    const token = await newSession(db, cfg, r.userId, req, r.workDate);
    await db.updateTable('sys_user').set({ last_login_at: sql`now()` }).where('id', '=', r.userId).execute();
    await logActivity(db, { companyId: null, userId: r.userId }, { module: 'SYS', action: 'LOGIN', detail: { ip: req.ip, mfa: r.via } });
    reply.setCookie(SESSION_COOKIE, token, cookieOpts);
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
    return {
      user: { id: a.userId, username: a.username, display_name: a.displayName, is_admin: a.isAdmin, is_platform: a.isPlatform, tenant_id: a.tenantId, approval_level: a.approvalLevel, check_rights: a.checkRights, mfa_setup_required: !!a.mfaSetupRequired },
      company, branch, branches, companies, work_date: a.workDate,
      // ธีมของบริษัทนี้ (ข้อกำหนดเจ้าของ) — หน้าจอใส่สีและแบบอักษรทันทีที่เลือกบริษัท
      ui_theme: normalizeUiTheme(company ? (await db.selectFrom('sys_setting').select('value').where('company_id', '=', company.id).where('branch_id', 'is', null).where('key', '=', 'ui.theme').where('deleted_at', 'is', null).executeTakeFirst())?.value : null),
      // สิทธิ์รายเมนูของบริษัทนี้ — หน้าจอใช้ซ่อนเมนู/ปุ่ม (ด่านจริงอยู่ที่ API)
      perms: company ? await permissionMatrix(db, { ...a, companyId: company.id }) : {},
    };
  });

  app.post('/api/v1/auth/select', async (req) => {
    const a = requireAuth(req);
    const body = parse(z.object({ company_id: z.string().uuid().optional(), branch_id: z.string().uuid().nullable().optional(), work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() }), req.body);
    const patch: Record<string, unknown> = {};
    const companyId = body.company_id ?? a.companyId;
    if (body.company_id && body.company_id !== a.companyId) {
      if (!(await canAccessCompany(db, a, body.company_id))) throw badRequest('ไม่มีสิทธิ์เข้าบริษัทนี้');
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

  app.post('/api/v1/auth/password', async (req) => {
    const a = requireAuth(req);
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
    const open = ['/api/v1/setup', '/api/v1/setup/status', '/api/v1/auth/login', '/api/v1/auth/login/totp', '/api/v1/health',
      '/api/v1/sync/setup-branch', '/api/v1/sync/bootstrap', '/api/v1/sync/push', '/api/v1/sync/pull'];
    if (!req.auth && !open.some((p) => req.url.split('?')[0] === p)) throw unauthorized();
  });
}
