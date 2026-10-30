import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';
import { passwordProblem } from '@buddy/core';
import type { Config } from '../config.js';
import type { DB, Db } from '../db.js';
import { badRequest, conflict, forbidden, notFound, parse, requireAuth } from '../http.js';
import { logActivity } from '../audit.js';

/**
 * สมัครใช้งานเอง (ข้อกำหนดเจ้าของ 30/10/2569: "สมัครใช้งาน: สมัครเอง หรือผู้ดูแลกำหนดบริษัทให้")
 * BUDDY_SIGNUP = review (ค่าเริ่มต้น: ผู้ให้บริการอนุมัติก่อน) · auto (เปิดบัญชีทันที) · off (ปิดหน้าสมัคร)
 * กันสแปม: ช่องดักบอท, ไม่เกิน 5 ใบต่อ IP ต่อชั่วโมง, ใบสมัครรออนุมัติรวมไม่เกิน 500, รหัสผ่านตามนโยบาย
 * PDPA: ต้องยอมรับเงื่อนไข/ข้อตกลงข้อมูลส่วนบุคคล · รหัสผ่านที่เก็บไว้ล้างทิ้งเมื่อพิจารณาแล้ว · ใบที่ไม่อนุมัติล้างข้อมูลติดต่อเมื่อครบ 90 วัน
 */
export type SignupMode = 'off' | 'review' | 'auto';
const PER_IP_HOUR = 5, MAX_PENDING = 500, PURGE_DAYS = 90;

/** สร้างลูกค้าผู้ใช้บริการ + กลุ่ม ADMIN + ผู้ดูแลคนแรก (ใช้ทั้งเจ้าหน้าที่สร้างเองและอนุมัติใบสมัคร) */
export async function createTenantWithAdmin(tx: Kysely<DB>, actor: string | null, t: {
  code: string; name: string; contact_email?: string | null; contact_phone?: string | null; plan?: string; max_companies?: number | null; max_users?: number | null;
  expires_on?: string | null; status?: string; dpa_signed_on?: string | null; admin_username: string; admin_name: string; password_hash: string;
}) {
  const row = await tx.insertInto('sys_tenant').values({ code: t.code, name: t.name, contact_email: t.contact_email ?? null, contact_phone: t.contact_phone ?? null, plan: t.plan ?? 'standard',
    max_companies: t.max_companies ?? null, max_users: t.max_users ?? null, expires_on: t.expires_on ?? null, status: t.status ?? 'A', dpa_signed_on: t.dpa_signed_on ?? null, created_by: actor }).returning('id').executeTakeFirstOrThrow();
  const g = await tx.insertInto('sys_user_group').values({ tenant_id: row.id, code: 'ADMIN', name: 'ผู้ดูแลระบบของลูกค้า', created_by: actor }).returning('id').executeTakeFirstOrThrow();
  await tx.insertInto('sys_user').values({ tenant_id: row.id, username: t.admin_username, display_name: t.admin_name, password_hash: t.password_hash, user_group_id: g.id, approval_level: 9, created_by: actor }).execute();
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

async function approve(db: Kysely<DB>, id: string, actor: string | null, o: { code?: string; plan?: string; max_companies?: number | null; max_users?: number | null; expires_on?: string | null } = {}) {
  const s = await db.selectFrom('sys_signup').selectAll().where('id', '=', id).where('deleted_at', 'is', null).forUpdate().executeTakeFirst();
  if (!s) throw notFound('ใบสมัคร');
  if (s.status !== 'P' || !s.password_hash) throw badRequest('ใบสมัครนี้พิจารณาไปแล้ว');
  if (await db.selectFrom('sys_user').select('id').where('username', '=', s.username).executeTakeFirst()) throw conflict(`รหัสผู้ใช้ ${s.username} มีผู้ใช้แล้ว — ไม่อนุมัติใบนี้และแจ้งผู้สมัครให้สมัครใหม่ด้วยรหัสอื่น`);
  const code = o.code ?? await newTenantCode(db, s.username);
  if (o.code && await db.selectFrom('sys_tenant').select('id').where('code', '=', o.code).executeTakeFirst()) throw conflict(`รหัสลูกค้า ${o.code} มีอยู่แล้ว`);
  const t = await createTenantWithAdmin(db, actor, { code, name: s.business_name, contact_email: s.contact_email, contact_phone: s.contact_phone, plan: o.plan, max_companies: o.max_companies,
    max_users: o.max_users, expires_on: o.expires_on, dpa_signed_on: String(new Date(s.accepted_terms_at as unknown as string).toISOString()).slice(0, 10), admin_username: s.username, admin_name: s.contact_name, password_hash: s.password_hash });
  await db.updateTable('sys_signup').set({ status: 'A', tenant_id: t.id, password_hash: null, decided_by: actor, decided_at: sql`now()` as never, updated_by: actor }).where('id', '=', id).execute();
  await logActivity(db, { companyId: null, userId: actor }, { module: 'SYS', action: 'NEW_TENANT', docNo: code, table: 'sys_tenant', rowId: t.id, detail: { code, signup: id, auto: !actor } });
  return { tenant_id: t.id, code };
}

export function signupRoutes(app: FastifyInstance, db: Db, cfg: Config) {
  const mode = (): SignupMode => cfg.signup;
  const requirePlatform = (req: Parameters<typeof requireAuth>[0]) => { const a = requireAuth(req); if (!a.isPlatform) throw forbidden('เฉพาะเจ้าหน้าที่ผู้ให้บริการโปรแกรม'); return a; };

  app.get('/api/v1/signup/config', async () => ({ mode: mode() }));

  app.post('/api/v1/signup', async (req) => {
    if (mode() === 'off') throw notFound('หน้าสมัครใช้งาน (ปิดรับสมัคร — ติดต่อผู้ให้บริการ)');
    const b = parse(z.object({
      business_name: z.string().trim().min(1, 'ป้อนชื่อกิจการ/ร้าน').max(120), contact_name: z.string().trim().min(1, 'ป้อนชื่อผู้ติดต่อ').max(120),
      contact_email: z.string().trim().max(120).email('อีเมลไม่ถูกต้อง'), contact_phone: z.string().trim().max(60).regex(/^[0-9+\-\s()]{9,}$/, 'ป้อนเบอร์โทรศัพท์ที่ติดต่อได้ เช่น 081-234-5678'),
      username: z.string().trim().min(3, 'รหัสผู้ใช้อย่างน้อย 3 ตัว').max(30).regex(/^[A-Za-z0-9_.@-]+$/, 'รหัสผู้ใช้ใช้ได้เฉพาะตัวอักษรอังกฤษ ตัวเลข _ . @ -'),
      password: z.string().max(200).refine((p) => !passwordProblem(p), (p) => ({ message: passwordProblem(p) ?? '' })),
      accept_terms: z.literal(true, { errorMap: () => ({ message: 'อ่านและยอมรับเงื่อนไขการใช้บริการและการคุ้มครองข้อมูลส่วนบุคคลก่อน' }) }),
      /** ช่องดักบอท (ซ่อนจากผู้ใช้จริง) */
      website: z.string().max(200).optional(),
    }), req.body);
    if (b.website) throw badRequest('ส่งใบสมัครไม่สำเร็จ');
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
    const r = await db.insertInto('sys_signup').values({ business_name: b.business_name, contact_name: b.contact_name, contact_email: b.contact_email, contact_phone: b.contact_phone,
      username: user, password_hash: await bcrypt.hash(b.password, 10), accepted_terms_at: sql`now()` as never, client_ip: ip, status: 'P' }).returning('id').executeTakeFirstOrThrow();
    await logActivity(db, { companyId: null, userId: null }, { module: 'SYS', action: 'SIGNUP', docNo: user, table: 'sys_signup', rowId: r.id });
    if (mode() === 'auto') {
      await db.transaction().execute((tx) => approve(tx, r.id, null));
      return { status: 'A', username: user, message: 'เปิดบัญชีแล้ว — เข้าระบบด้วยรหัสผู้ใช้และรหัสผ่านที่ตั้งไว้ แล้วสร้างบริษัทแรกได้เลย' };
    }
    return { status: 'P', username: user, message: 'ได้รับใบสมัครแล้ว — ผู้ให้บริการจะตรวจสอบและติดต่อกลับทางอีเมล/โทรศัพท์ เมื่ออนุมัติแล้วเข้าระบบด้วยรหัสผู้ใช้และรหัสผ่านที่ตั้งไว้' };
  });

  /* ---- เจ้าหน้าที่ผู้ให้บริการ: พิจารณาใบสมัคร */
  app.get('/api/v1/signups', async (req) => {
    requirePlatform(req);
    const q = parse(z.object({ status: z.enum(['P', 'A', 'R', 'all']).default('P') }), req.query);
    // PDPA: ใบที่ไม่อนุมัติเกิน 90 วัน ล้างข้อมูลติดต่อ (คงแถวไว้เป็นสถิติ)
    await sql`UPDATE sys_signup SET business_name = '-', contact_name = '-', contact_email = '-', contact_phone = '-', client_ip = NULL, password_hash = NULL
               WHERE status = 'R' AND decided_at < now() - make_interval(days => ${PURGE_DAYS}) AND contact_email <> '-'`.execute(db);
    let s = db.selectFrom('sys_signup as s').leftJoin('sys_tenant as t', 't.id', 's.tenant_id').leftJoin('sys_user as u', 'u.id', 's.decided_by')
      .select(['s.id', 's.business_name', 's.contact_name', 's.contact_email', 's.contact_phone', 's.username', 's.status', 's.created_at', 's.accepted_terms_at', 's.decided_at', 's.reject_reason', 's.client_ip',
        't.code as tenant_code', 'u.username as decided_by_name'])
      .where('s.deleted_at', 'is', null);
    if (q.status !== 'all') s = s.where('s.status', '=', q.status);
    return { mode: mode(), rows: await s.orderBy('s.created_at', 'desc').limit(500).execute() };
  });
  app.post('/api/v1/signups/:id/approve', async (req) => {
    const a = requirePlatform(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const o = parse(z.object({
      code: z.string().trim().max(20).regex(/^[A-Za-z0-9_-]+$/, 'รหัสลูกค้าใช้ A-Z 0-9 _ -').optional().or(z.literal('').transform(() => undefined)),
      plan: z.string().trim().max(20).optional(), max_companies: z.coerce.number().int().min(1).nullable().optional(), max_users: z.coerce.number().int().min(1).nullable().optional(),
      expires_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    }), req.body ?? {});
    return db.transaction().execute((tx) => approve(tx, id, a.userId, o));
  });
  app.post('/api/v1/signups/:id/reject', async (req) => {
    const a = requirePlatform(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const { reason } = parse(z.object({ reason: z.string().trim().min(1, 'ป้อนเหตุผลที่ไม่อนุมัติ').max(200) }), req.body);
    const r = await db.updateTable('sys_signup').set({ status: 'R', reject_reason: reason, password_hash: null, decided_by: a.userId, decided_at: sql`now()` as never, updated_by: a.userId })
      .where('id', '=', id).where('status', '=', 'P').where('deleted_at', 'is', null).executeTakeFirst();
    if (!Number(r.numUpdatedRows)) throw badRequest('ไม่พบใบสมัครที่รออนุมัติ');
    await logActivity(db, a, { module: 'SYS', action: 'SIGNUP_REJECT', table: 'sys_signup', rowId: id, detail: { reason } });
    return { ok: true };
  });
}
