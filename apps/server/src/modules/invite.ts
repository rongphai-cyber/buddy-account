import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { sql } from 'kysely';
import { z } from 'zod';
import { passwordProblem } from '@buddy/core';
import type { Db } from '../db.js';
import type { Config } from '../config.js';
import { AppError, badRequest, forbidden, notFound, parse, requireAuth, type AuthContext } from '../http.js';
import { logActivity } from '../audit.js';
import { rateLimit, requireHuman } from '../botguard.js';
import { newSession, SESSION_COOKIE, sessionCookieOptions, tenantActive, tenantIsDemo } from './auth.js';
import { emailInvite } from './provider.js';
import { secOf, setSec } from './security.js';

/**
 * ลิงก์เชิญผู้ใช้ (HANDOFF 184 · เจ้าของ 24/11/2569 "ไม่อยากจะต้องมาใส่อีเมล์ให้ Cloudflare ทุกอีเมล์" → เชิญด้วยลิงก์ส่งทาง LINE)
 * ผู้ดูแลระบบของลูกค้าสร้างลิงก์ให้ผู้ใช้ในลูกค้าของตัวเอง (ผู้ให้บริการได้ทุกราย) → คัดลอก/QR ส่งทาง LINE · ไม่มีบริการอีเมล
 * ลิงก์ใช้ได้ครั้งเดียว หมดอายุ 72 ชั่วโมง ยกเลิก/ออกใหม่ได้ (ออกใหม่ = ลิงก์เดิมใช้ไม่ได้) · เก็บเฉพาะ SHA-256 ของ token
 * ผู้ใช้เปิดลิงก์ → เห็นรหัสผู้ใช้และชื่อบริษัท → ตั้งรหัสผ่านเอง (กฎเดียวกับทุกที่) → เข้าระบบทันที → หน้าตั้งค่ายืนยันตัวตนสองขั้น (บังคับทุกผู้ใช้)
 * ผู้ดูแลไม่เห็นรหัสผ่าน · หน้าเปิดลิงก์: จำกัดครั้งต่อ IP + Turnstile ตอนตั้งรหัสผ่าน · ทุกขั้นบันทึก sys_activity_log
 */
export const INVITE_HOURS = 72;
const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const tokenParam = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{20,100}$/, 'ลิงก์เชิญไม่ถูกต้อง') });
const INVALID = 'ลิงก์เชิญไม่ถูกต้องหรือถูกยกเลิกแล้ว — ขอลิงก์ใหม่จากผู้ดูแลระบบของกิจการ';
/** ที่อยู่หน้าเว็บสำหรับลิงก์: ค่าจากการตั้งค่า (BUDDY_PUBLIC_URL · คลาวด์ = https://app.worktruesolution.net) ไม่ตั้ง = ที่อยู่ที่ผู้ดูแลเปิดอยู่ */
const originOf = (req: FastifyRequest, cfg: Config) => cfg.publicUrl ?? `${req.protocol}://${req.host}`;

type InviteRow = { id: string; user_id: string; expires_at: string; used_at: string | null; revoked_at: string | null; username: string; display_name: string; status: string; tenant_id: string | null; tenant_name: string | null; tenant_status: string | null; tenant_expires: string | null; moved_to: string | null; group_code: string | null };
async function inviteOf(db: Db, token: string): Promise<InviteRow | undefined> {
  return (await sql<InviteRow>`SELECT i.id, i.user_id, i.expires_at::text AS expires_at, i.used_at::text AS used_at, i.revoked_at::text AS revoked_at, u.username, u.display_name, u.status, u.tenant_id,
      t.name AS tenant_name, t.status AS tenant_status, t.expires_on::text AS tenant_expires, t.moved_to, g.code AS group_code
    FROM sys_user_invite i JOIN sys_user u ON u.id = i.user_id AND u.deleted_at IS NULL LEFT JOIN sys_tenant t ON t.id = u.tenant_id LEFT JOIN sys_user_group g ON g.id = u.user_group_id AND g.deleted_at IS NULL
    WHERE i.token_hash = ${sha(token)} AND i.deleted_at IS NULL`.execute(db)).rows[0];
}
/** ลิงก์ยังใช้ได้ไหม — ไม่ได้ = ข้อความบอกเหตุและทางแก้ (410) */
function checkUsable(i: InviteRow | undefined): asserts i is InviteRow {
  if (!i || i.revoked_at) throw new AppError(410, 'INVITE_INVALID', INVALID);
  if (i.used_at) throw new AppError(410, 'INVITE_USED', 'ลิงก์นี้ใช้ตั้งรหัสผ่านไปแล้ว (ใช้ได้ครั้งเดียว) — เข้าระบบด้วยรหัสผู้ใช้และรหัสผ่านที่ตั้งไว้ หรือขอลิงก์ใหม่จากผู้ดูแลระบบของกิจการ');
  if (new Date(i.expires_at).getTime() <= Date.now()) throw new AppError(410, 'INVITE_EXPIRED', `ลิงก์เชิญหมดอายุแล้ว (ใช้ได้ ${INVITE_HOURS} ชั่วโมง) — ขอลิงก์ใหม่จากผู้ดูแลระบบของกิจการ`);
  if (i.status !== 'A') throw new AppError(410, 'INVITE_INVALID', 'ผู้ใช้นี้ถูกระงับ — ติดต่อผู้ดูแลระบบของกิจการ');
  if (i.tenant_id && i.moved_to) throw new AppError(410, 'INVITE_INVALID', `บัญชีของกิจการย้ายไปใช้ที่ ${i.moved_to} แล้ว — ขอลิงก์ใหม่จากผู้ดูแลระบบของกิจการ`);
  if (i.tenant_id && !tenantActive(i.tenant_status, i.tenant_expires)) throw new AppError(410, 'INVITE_INVALID', 'บัญชีผู้ใช้บริการของกิจการถูกระงับหรือหมดอายุ — ติดต่อผู้ให้บริการ');
}
/** บริษัทที่ผู้ใช้เข้าได้ (แสดงในหน้าเปิดลิงก์) */
async function companiesOf(db: Db, i: InviteRow) {
  const rows = i.group_code === 'ADMIN' && i.tenant_id
    ? await db.selectFrom('sys_company').select(['code', 'name_th']).where('tenant_id', '=', i.tenant_id).where('deleted_at', 'is', null).where('status', '=', 'A').orderBy('code').execute()
    : await db.selectFrom('sys_user_company as uc').innerJoin('sys_company as c', 'c.id', 'uc.company_id').select(['c.code', 'c.name_th'])
      .where('uc.user_id', '=', i.user_id).where('uc.deleted_at', 'is', null).where('c.deleted_at', 'is', null).orderBy('c.code').execute();
  return rows.map((r) => r.name_th);
}

export function inviteRoutes(app: FastifyInstance, db: Db, cfg: Config) {
  /** ผู้ดูแลระบบ: ผู้ใช้ในลูกค้าเดียวกัน (ผู้ให้บริการทำได้ทุกราย) — ลูกค้าอื่น = ไม่พบ (ข้อ 7.1) */
  const target = async (a: AuthContext, id: string) => {
    if (!a.isAdmin) throw forbidden('เฉพาะผู้ดูแลระบบสร้าง/ยกเลิกลิงก์เชิญได้');
    const u = await db.selectFrom('sys_user').select(['id', 'username', 'display_name', 'tenant_id', 'status']).where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
    if (!u || (!a.isPlatform && u.tenant_id !== a.tenantId)) throw notFound('ผู้ใช้');
    return u;
  };
  const revokeAll = (tx: Db, userId: string, by: string) => tx.updateTable('sys_user_invite').set({ revoked_at: sql`now()` as never, updated_by: by })
    .where('user_id', '=', userId).where('used_at', 'is', null).where('revoked_at', 'is', null).where('deleted_at', 'is', null).executeTakeFirst();

  /** สร้างลิงก์ (ออกใหม่ = ลิงก์เดิมที่ยังไม่ใช้ถูกยกเลิก) — token แสดงครั้งเดียวในลิงก์ ไม่เก็บ */
  app.post('/api/v1/users/:id/invite', async (req) => {
    const a = requireAuth(req);
    const u = await target(a, parse(z.object({ id: z.string().uuid() }), req.params).id);
    if (u.id === a.userId) throw badRequest('สร้างลิงก์เชิญให้ตัวเองไม่ได้ — เปลี่ยนรหัสผ่านที่ บัญชีของฉัน');
    if (u.status !== 'A') throw badRequest(`ผู้ใช้ ${u.username} ถูกระงับอยู่ — เปลี่ยนสถานะเป็น "ใช้งาน" ก่อนสร้างลิงก์เชิญ`);
    // HANDOFF 204 ข้อ d1: ผู้ใช้ของลูกค้าจริงที่ผู้ให้บริการสั่ง = ส่งลิงก์ไปอีเมลผู้ติดต่อของลูกค้า ไม่แสดงลิงก์ให้ผู้ให้บริการ
    const viaEmail = a.isPlatform && !!u.tenant_id && !(await tenantIsDemo(db, u.tenant_id));
    if ((await secOf(db, u.id))?.totp_enabled) throw badRequest(`${u.username} เปิดยืนยันตัวตนสองขั้นแล้ว — ลิงก์เชิญใช้กับผู้ใช้ที่ยังไม่ได้ตั้ง · ถ้าลืมรหัสผ่าน ให้ตั้งรหัสผ่านใหม่ที่หน้าแก้ไขผู้ใช้ · ถ้ามือถือหาย ให้ "ล้างยืนยันตัวตนสองขั้น" ก่อน แล้วสร้างลิงก์ใหม่`);
    if (viaEmail) return emailInvite(db, originOf(req, cfg), a, { ...u, tenant_id: u.tenant_id! });
    const token = randomBytes(32).toString('base64url');
    const expires = new Date(Date.now() + INVITE_HOURS * 3600_000).toISOString();
    const reissued = await db.transaction().execute(async (tx) => {
      const r = await revokeAll(tx, u.id, a.userId);
      await tx.insertInto('sys_user_invite').values({ user_id: u.id, tenant_id: u.tenant_id, token_hash: sha(token), expires_at: expires, created_by: a.userId }).execute();
      const n = Number(r.numUpdatedRows);
      await logActivity(tx, a, { module: 'SET.SEC', action: 'INVITE_CREATE', docNo: u.username, table: 'sys_user', rowId: u.id, detail: { expires_at: expires, hours: INVITE_HOURS, revoked_previous: n } });
      return n;
    });
    return { url: `${originOf(req, cfg)}/invite/${token}`, expires_at: expires, hours: INVITE_HOURS, username: u.username, display_name: u.display_name, reissued: reissued > 0 };
  });
  app.delete('/api/v1/users/:id/invite', async (req) => {
    const a = requireAuth(req);
    const u = await target(a, parse(z.object({ id: z.string().uuid() }), req.params).id);
    const r = await revokeAll(db, u.id, a.userId);
    const n = Number(r.numUpdatedRows);
    if (n) await logActivity(db, a, { module: 'SET.SEC', action: 'INVITE_REVOKE', docNo: u.username, table: 'sys_user', rowId: u.id, detail: { revoked: n } });
    return { revoked: n };
  });

  /** หน้าเปิดลิงก์ (ไม่ต้องเข้าระบบ): รหัสผู้ใช้ ชื่อ กิจการ บริษัท วันหมดอายุ */
  app.get('/api/v1/invite/:token', async (req, reply) => {
    rateLimit('invite-ip', req.ip, reply);
    const { token } = parse(tokenParam, req.params);
    const i = await inviteOf(db, token);
    checkUsable(i);
    return { username: i.username, display_name: i.display_name, tenant_name: i.tenant_name, companies: await companiesOf(db, i), expires_at: i.expires_at, hours: INVITE_HOURS };
  });

  /** ตั้งรหัสผ่านจากลิงก์ → ใช้ลิงก์แล้ว (ครั้งเดียว) → เข้าระบบ (ขั้นต่อไป: ตั้งยืนยันตัวตนสองขั้น) */
  app.post('/api/v1/invite/:token/accept', async (req, reply) => {
    rateLimit('invite-ip', req.ip, reply);
    const { token } = parse(tokenParam, req.params);
    const b = parse(z.object({ password: z.string().max(200).refine((p) => !passwordProblem(p), (p) => ({ message: passwordProblem(p) ?? '' })), turnstile: z.string().optional() }), req.body);
    await requireHuman(req);
    const i = await inviteOf(db, token);
    checkUsable(i);
    // ผู้ใช้ที่เปิดยืนยันสองขั้นแล้ว: ลิงก์ตั้งรหัสผ่านจะข้ามขั้นที่ 2 ได้ — ไม่ยอม
    if ((await secOf(db, i.user_id))?.totp_enabled) throw new AppError(410, 'INVITE_INVALID', 'บัญชีนี้เปิดยืนยันตัวตนสองขั้นแล้ว — ลิงก์เชิญใช้ไม่ได้ ติดต่อผู้ดูแลระบบของกิจการ');
    const sessionToken = await db.transaction().execute(async (tx) => {
      // ใช้ได้ครั้งเดียว: เปลี่ยนสถานะแบบมีเงื่อนไข — คำขอพร้อมกันอีกคำขอได้ 0 แถว
      const used = await tx.updateTable('sys_user_invite').set({ used_at: sql`now()` as never, updated_by: i.user_id })
        .where('id', '=', i.id).where('used_at', 'is', null).where('revoked_at', 'is', null).where('expires_at', '>', sql<string>`now()`).executeTakeFirst();
      if (!Number(used.numUpdatedRows)) throw new AppError(410, 'INVITE_USED', 'ลิงก์นี้ใช้ไปแล้วหรือหมดอายุ — ขอลิงก์ใหม่จากผู้ดูแลระบบของกิจการ');
      await tx.updateTable('sys_user').set({ password_hash: await bcrypt.hash(b.password, 10), last_login_at: sql`now()` as never, updated_by: i.user_id }).where('id', '=', i.user_id).execute();
      await setSec(tx, i.user_id, { password_changed_at: new Date().toISOString(), failed_logins: 0, locked_until: null });
      await tx.updateTable('sys_session').set({ ended_at: sql`now()` as never }).where('user_id', '=', i.user_id).where('ended_at', 'is', null).execute();
      await logActivity(tx, { companyId: null, userId: i.user_id }, { module: 'SYS', action: 'INVITE_ACCEPT', docNo: i.username, table: 'sys_user', rowId: i.user_id, detail: { ip: req.ip } });
      const t = await newSession(tx, cfg, i.user_id, req);
      await logActivity(tx, { companyId: null, userId: i.user_id }, { module: 'SYS', action: 'LOGIN', detail: { ip: req.ip, via: 'invite' } });
      return t;
    });
    reply.setCookie(SESSION_COOKIE, sessionToken, sessionCookieOptions(cfg, req));
    return { ok: true, username: i.username };
  });
}
