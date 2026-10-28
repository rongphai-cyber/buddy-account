import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Db } from '../db.js';
import { AppError, badRequest, parse, requireAuth, unauthorized, type AuthContext } from '../http.js';
import { logActivity } from '../audit.js';
import type { Config } from '../config.js';

export const SESSION_COOKIE = 'buddy_session';
const ADMIN_GROUP = 'ADMIN';
const sha = (t: string) => createHash('sha256').update(t).digest('hex');

export async function loadSession(db: Db, token: string | undefined): Promise<AuthContext | undefined> {
  if (!token) return undefined;
  const row = await db
    .selectFrom('sys_session as s')
    .innerJoin('sys_user as u', 'u.id', 's.user_id')
    .leftJoin('sys_user_group as g', 'g.id', 'u.user_group_id')
    .select(['s.id', 's.user_id', 's.current_company_id', 's.current_branch_id', 's.work_date', 'u.username', 'u.display_name', 'u.status', 'g.code as group_code'])
    .where('s.token_hash', '=', sha(token))
    .where('s.ended_at', 'is', null)
    .where('s.expires_at', '>', sql<string>`now()`)
    .where('s.deleted_at', 'is', null)
    .executeTakeFirst();
  if (!row || row.status !== 'A') return undefined;
  return {
    sessionId: row.id, userId: row.user_id, username: row.username, displayName: row.display_name,
    isAdmin: row.group_code === ADMIN_GROUP, companyId: row.current_company_id, branchId: row.current_branch_id, workDate: row.work_date,
  };
}

/** บริษัทที่ผู้ใช้เข้าได้ (ผู้ดูแลระบบเข้าได้ทุกบริษัท) */
export async function companiesForUser(db: Db, a: Pick<AuthContext, 'userId' | 'isAdmin'>) {
  let q = db.selectFrom('sys_company as c').select(['c.id', 'c.code', 'c.name_th', 'c.name_en', 'c.year_system']).where('c.deleted_at', 'is', null).where('c.status', '=', 'A');
  if (!a.isAdmin) {
    q = q.where((eb) => eb.exists(eb.selectFrom('sys_user_company as uc').select('uc.id').whereRef('uc.company_id', '=', 'c.id').where('uc.user_id', '=', a.userId).where('uc.deleted_at', 'is', null)));
  }
  return q.orderBy('c.code').execute();
}

export async function canAccessCompany(db: Db, a: Pick<AuthContext, 'userId' | 'isAdmin'>, companyId: string) {
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
      password: z.string().min(8, 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร').max(200),
    }), req.body);
    const token = await db.transaction().execute(async (tx) => {
      const n = await tx.selectFrom('sys_user').select(sql<number>`count(*)`.as('n')).executeTakeFirstOrThrow();
      if (Number(n.n) > 0) throw new AppError(409, 'ALREADY_SETUP', 'ตั้งค่าผู้ดูแลระบบไปแล้ว');
      let grp = await tx.selectFrom('sys_user_group').select('id').where('code', '=', ADMIN_GROUP).executeTakeFirst();
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
    const u = await db.selectFrom('sys_user').select(['id', 'password_hash', 'status']).where(sql`lower(username)`, '=', body.username.toLowerCase()).where('deleted_at', 'is', null).executeTakeFirst();
    const ok = u && u.status === 'A' && u.password_hash && (await bcrypt.compare(body.password, u.password_hash));
    if (!u || !ok) {
      await logActivity(db, { companyId: null, userId: u?.id ?? null }, { module: 'SYS', action: 'LOGIN_FAIL', detail: { username: body.username, ip: req.ip } });
      throw new AppError(401, 'LOGIN_FAILED', 'รหัสผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    }
    const token = await newSession(db, cfg, u.id, req, body.work_date);
    await db.updateTable('sys_user').set({ last_login_at: sql`now()` }).where('id', '=', u.id).execute();
    await logActivity(db, { companyId: null, userId: u.id }, { module: 'SYS', action: 'LOGIN', detail: { ip: req.ip } });
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
    const companies = await companiesForUser(db, a);
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
      user: { id: a.userId, username: a.username, display_name: a.displayName, is_admin: a.isAdmin },
      company, branch, branches, companies, work_date: a.workDate,
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
    const body = parse(z.object({ old_password: z.string().min(1, 'ป้อนรหัสผ่านเดิม'), new_password: z.string().min(8, 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร') }), req.body);
    const u = await db.selectFrom('sys_user').select('password_hash').where('id', '=', a.userId).executeTakeFirstOrThrow();
    if (!u.password_hash || !(await bcrypt.compare(body.old_password, u.password_hash))) throw badRequest('รหัสผ่านเดิมไม่ถูกต้อง');
    await db.updateTable('sys_user').set({ password_hash: await bcrypt.hash(body.new_password, 10), updated_by: a.userId }).where('id', '=', a.userId).execute();
    await logActivity(db, { companyId: a.companyId, userId: a.userId }, { module: 'SYS', action: 'PASSWORD' });
    return { ok: true };
  });
}

export function attachAuth(app: FastifyInstance, db: Db) {
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    const token = req.cookies?.[SESSION_COOKIE];
    req.auth = await loadSession(db, token);
    const open = ['/api/v1/setup', '/api/v1/setup/status', '/api/v1/auth/login', '/api/v1/health'];
    if (!req.auth && !open.some((p) => req.url.split('?')[0] === p)) throw unauthorized();
  });
}
