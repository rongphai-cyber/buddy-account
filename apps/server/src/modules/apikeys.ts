import type { FastifyInstance } from 'fastify';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { sql } from 'kysely';
import { z } from 'zod';
import { flattenMenu, MENU } from '@buddy/core';
import type { Db } from '../db.js';
import { AppError, badRequest, forbidden, notFound, parse, requireCompany, type AuthContext } from '../http.js';
import { logActivity } from '../audit.js';
import { canAccessCompany, tenantActive } from './auth.js';
import { API_RULES } from './permissions.js';

/**
 * กุญแจ API ให้ระบบอื่นเชื่อมต่อ (T7.5)
 * - กุญแจ = "bk_<ส่วนต้น 12 ตัว>_<ส่วนลับ>" ส่งใน header  Authorization: Bearer <กุญแจ>
 * - ผูกกับบริษัทเดียว + ผู้ใช้หนึ่งคน → ใช้สิทธิ์ตามผู้ใช้นั้น (ตารางสิทธิ์/ระดับอนุมัติเดิม) · เลือกบริษัทอื่นไม่ได้
 * - เก็บเฉพาะ SHA-256 ของส่วนลับ แสดงกุญแจเต็มครั้งเดียวตอนสร้าง · ยกเลิก = สถานะ I (ไม่ลบ)
 * - ห้ามใช้กับระบบความปลอดภัย/สำรองข้อมูล/สร้างบริษัท/จัดการกุญแจ · อ่านอย่างเดียว = GET เท่านั้น · จำกัด 600 คำขอ/นาที/กุญแจ
 */
export const API_KEY_MENU = 'SET.API';
/** เมนูที่กุญแจ API ใช้ไม่ได้แม้ผู้ใช้จะมีสิทธิ์ */
export const API_KEY_BLOCKED = new Set(['SET.SEC', 'SET.TENANT', 'RP.CUSTOM', 'RP.FORM', 'OT.LOG', 'OT.BACKUP', 'SET.NEWCO', 'SET.AI', 'SET.PDPA', API_KEY_MENU]);
/** API ชนิด "ของผู้ใช้เอง" ที่กุญแจเรียกได้ */
export const API_KEY_SELF_OK = new Set(['GET /api/v1/auth/me', 'GET /api/v1/menu']);
const PER_MINUTE = 600;

const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const KEY_RE = /^bk_([0-9a-f]{12})_([A-Za-z0-9_-]{20,100})$/;

const hits = new Map<string, { minute: number; n: number }>();
function rateLimit(keyId: string) {
  const minute = Math.floor(Date.now() / 60_000);
  const h = hits.get(keyId);
  if (!h || h.minute !== minute) { hits.set(keyId, { minute, n: 1 }); return; }
  if (++h.n > PER_MINUTE) throw new AppError(429, 'RATE_LIMIT', `เรียก API เกิน ${PER_MINUTE} ครั้งต่อนาที — รอสักครู่แล้วลองใหม่ หรือรวมคำขอให้น้อยลง`);
}

/** ตรวจกุญแจจาก header Authorization → บริบทผู้ใช้แบบ session (ไม่ผ่านก็ตอบ 401 พร้อมเหตุผล) */
export async function loadApiKey(db: Db, header: string, ip: string | undefined): Promise<AuthContext> {
  const m = KEY_RE.exec(header.replace(/^Bearer\s+/i, '').trim());
  const bad = (msg: string) => new AppError(401, 'API_KEY_INVALID', msg);
  if (!m) throw bad('กุญแจ API ไม่ถูกรูปแบบ — ใช้ Authorization: Bearer bk_…');
  const row = await db.selectFrom('sys_api_key as k')
    .innerJoin('sys_user as u', 'u.id', 'k.user_id').innerJoin('sys_company as c', 'c.id', 'k.company_id')
    .leftJoin('sys_user_group as g', 'g.id', 'u.user_group_id').leftJoin('sys_tenant as t', 't.id', 'u.tenant_id')
    .select(['k.id', 'k.key_hash', 'k.company_id', 'k.read_only', 'k.expires_on', 'k.status', 'k.last_used_at', 'c.status as company_status', 'c.tenant_id as company_tenant_id',
      'u.id as user_id', 'u.username', 'u.display_name', 'u.status as user_status', 'u.tenant_id', 'u.approval_level', 'u.check_rights', 'u.user_group_id',
      'g.code as group_code', 'g.tenant_id as group_tenant_id', 't.status as tenant_status', 't.expires_on as tenant_expires'])
    .where('k.key_prefix', '=', m[1]!).where('k.deleted_at', 'is', null).where('c.deleted_at', 'is', null).where('u.deleted_at', 'is', null)
    .executeTakeFirst();
  const a = Buffer.from(row?.key_hash ?? '0'.repeat(64), 'hex'), b = Buffer.from(sha(m[2]!), 'hex');
  if (!row || a.length !== b.length || !timingSafeEqual(a, b)) throw bad('ไม่พบกุญแจ API นี้ — ตรวจว่าคัดลอกครบ หรือขอกุญแจใหม่จากผู้ดูแลระบบ');
  if (row.status !== 'A') throw bad('กุญแจ API นี้ถูกยกเลิกแล้ว — ขอกุญแจใหม่จากผู้ดูแลระบบ');
  if (row.expires_on && String(row.expires_on).slice(0, 10) < new Date().toISOString().slice(0, 10)) throw bad('กุญแจ API หมดอายุแล้ว — ขอกุญแจใหม่จากผู้ดูแลระบบ');
  if (row.user_status !== 'A' || row.company_status !== 'A') throw bad('ผู้ใช้หรือบริษัทของกุญแจนี้ถูกระงับ');
  if (row.tenant_id && !tenantActive(row.tenant_status, row.tenant_expires)) throw bad('บัญชีผู้ใช้บริการถูกระงับหรือหมดอายุ');
  const isAdmin = row.group_code === 'ADMIN' && (row.group_tenant_id ?? null) === (row.tenant_id ?? null);
  const ctx: AuthContext = {
    sessionId: '', apiKeyId: row.id, apiKeyReadOnly: row.read_only, userId: row.user_id, username: row.username, displayName: row.display_name,
    // กุญแจผูกบริษัทเดียว: ไม่ใช้สิทธิ์ข้าม tenant ของผู้ให้บริการ
    tenantId: row.company_tenant_id ?? row.tenant_id, isAdmin, isPlatform: false,
    companyId: row.company_id, branchId: null, workDate: null, approvalLevel: row.approval_level, checkRights: row.check_rights, groupId: row.user_group_id,
  };
  // ผู้ใช้ต้องยังเข้าบริษัทนี้ได้ (ถูกถอนสิทธิ์แล้วกุญแจใช้ไม่ได้ทันที)
  if (!(await canAccessCompany(db, { userId: row.user_id, isAdmin, isPlatform: isAdmin && !row.tenant_id, tenantId: row.tenant_id }, row.company_id))) throw bad('ผู้ใช้ของกุญแจนี้ไม่มีสิทธิ์เข้าบริษัทนี้แล้ว');
  rateLimit(row.id);
  if (!row.last_used_at || Date.now() - new Date(row.last_used_at).getTime() > 60_000)
    await db.updateTable('sys_api_key').set({ last_used_at: sql`now()`, last_used_ip: ip?.slice(0, 60) ?? null }).where('id', '=', row.id).execute();
  return ctx;
}

/** ข้อจำกัดของคำขอที่มาด้วยกุญแจ API (เรียกจากตัวตรวจสิทธิ์ก่อนตรวจตารางสิทธิ์) */
export function checkApiKeyRule(a: AuthContext, method: string, route: string, kind: string, menu: string | null) {
  if (!a.apiKeyId) return;
  if (a.apiKeyReadOnly && method !== 'GET') throw forbidden('กุญแจ API นี้อ่านอย่างเดียว — ขอกุญแจที่บันทึกได้จากผู้ดูแลระบบ');
  if (kind === 'self' && !API_KEY_SELF_OK.has(`${method} ${route}`)) throw forbidden('กุญแจ API ใช้จัดการผู้ใช้ บริษัท หรือการเข้าระบบไม่ได้ — ทำผ่านหน้าจอโปรแกรม');
  if (menu && API_KEY_BLOCKED.has(menu)) throw forbidden('กุญแจ API ใช้กับระบบความปลอดภัย สำรองข้อมูล หรือการสร้างบริษัทไม่ได้ — ทำผ่านหน้าจอโปรแกรม');
}

const LABEL = new Map(flattenMenu(MENU).map((m) => [m.code, m.label]));

export function apiKeyRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/v1/api-keys', async (req) => {
    const a = requireCompany(req);
    return (await sql<Record<string, unknown>>`SELECT k.id, k.name, k.key_prefix, k.read_only, k.expires_on, k.status, k.last_used_at, k.last_used_ip, k.created_at,
        u.username, u.display_name, cu.display_name AS created_by_name
        FROM sys_api_key k JOIN sys_user u ON u.id = k.user_id LEFT JOIN sys_user cu ON cu.id = k.created_by
       WHERE k.company_id = ${a.companyId} AND k.deleted_at IS NULL ORDER BY k.status, k.created_at DESC`.execute(db)).rows;
  });

  app.post('/api/v1/api-keys', async (req) => {
    const a = requireCompany(req);
    const b = parse(z.object({
      name: z.string().trim().min(1, 'ป้อนชื่อกุญแจ เช่น ระบบหน้าร้าน').max(120),
      user_id: z.string().uuid('เลือกผู้ใช้ที่กุญแจจะทำงานในนาม'),
      read_only: z.boolean().default(false),
      expires_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันหมดอายุไม่ถูกต้อง').nullable().optional(),
    }), req.body);
    if (b.expires_on && b.expires_on < new Date().toISOString().slice(0, 10)) throw badRequest('วันหมดอายุต้องไม่ก่อนวันนี้');
    // ผู้ใช้ต้องอยู่ลูกค้า (tenant) เดียวกับบริษัทและเข้าบริษัทนี้ได้
    const u = await db.selectFrom('sys_user as u').leftJoin('sys_user_group as g', 'g.id', 'u.user_group_id')
      .select(['u.id', 'u.username', 'u.status', 'u.tenant_id', 'g.code as group_code', 'g.tenant_id as group_tenant_id']).where('u.id', '=', b.user_id).where('u.deleted_at', 'is', null).executeTakeFirst();
    const co = await db.selectFrom('sys_company').select(['tenant_id']).where('id', '=', a.companyId).executeTakeFirstOrThrow();
    if (!u || (!a.isPlatform && (u.tenant_id ?? null) !== (a.tenantId ?? null))) throw notFound('ผู้ใช้');
    if (u.status !== 'A') throw badRequest('ผู้ใช้นี้ถูกระงับ — เลือกผู้ใช้ที่ใช้งานอยู่');
    const uAdmin = u.group_code === 'ADMIN' && (u.group_tenant_id ?? null) === (u.tenant_id ?? null);
    if ((u.tenant_id ?? null) !== (co.tenant_id ?? null) && !(uAdmin && !u.tenant_id)) throw badRequest('ผู้ใช้นี้อยู่ต่างลูกค้ากับบริษัท');
    if (!(await canAccessCompany(db, { userId: u.id, isAdmin: uAdmin, isPlatform: uAdmin && !u.tenant_id, tenantId: u.tenant_id }, a.companyId)))
      throw badRequest(`ผู้ใช้ ${u.username} ยังไม่มีสิทธิ์เข้าบริษัทนี้ — ให้สิทธิ์ที่ ตั้งค่า › ผู้ใช้งานและสิทธิ์ ก่อน`);
    const prefix = randomBytes(6).toString('hex'), secret = randomBytes(24).toString('base64url');
    const r = await db.transaction().execute(async (tx) => {
      const row = await tx.insertInto('sys_api_key').values({ company_id: a.companyId, user_id: u.id, name: b.name, key_prefix: prefix, key_hash: sha(secret),
        read_only: b.read_only, expires_on: b.expires_on ?? null, created_by: a.userId, updated_by: a.userId }).returning('id').executeTakeFirstOrThrow();
      await logActivity(tx, a, { module: API_KEY_MENU, action: 'API_KEY_CREATE', docNo: `bk_${prefix}`, table: 'sys_api_key', rowId: row.id, detail: { name: b.name, user: u.username, read_only: b.read_only, expires_on: b.expires_on ?? null } });
      return row;
    });
    return { id: r.id, key: `bk_${prefix}_${secret}`, key_prefix: prefix };
  });

  app.post('/api/v1/api-keys/:id/revoke', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const k = await db.selectFrom('sys_api_key').select(['key_prefix', 'status', 'name']).where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!k) throw notFound('กุญแจ API');
    if (k.status !== 'A') throw badRequest('กุญแจนี้ถูกยกเลิกไปแล้ว');
    await db.transaction().execute(async (tx) => {
      await tx.updateTable('sys_api_key').set({ status: 'I', updated_by: a.userId }).where('id', '=', id).execute();
      await logActivity(tx, a, { module: API_KEY_MENU, action: 'API_KEY_REVOKE', docNo: `bk_${k.key_prefix}`, table: 'sys_api_key', rowId: id, detail: { name: k.name } });
    });
    return { ok: true };
  });

  /** รายการ API ที่กุญแจเรียกได้ (สร้างจากตารางกฎสิทธิ์ — ตรงกับโปรแกรมเสมอ) */
  app.get('/api/v1/api-docs', async () => {
    const rows: Array<{ method: string; path: string; kind: string; menu: string | null; menu_label: string | null; action: string | null }> = [];
    for (const [k, rule] of Object.entries(API_RULES)) {
      const [method, path] = k.split(' ') as [string, string];
      if (rule.kind === 'open') continue;
      if (rule.kind === 'self' && !API_KEY_SELF_OK.has(k)) continue;
      const menu = rule.kind === 'menu' ? rule.menu : null;
      if (menu && API_KEY_BLOCKED.has(menu)) continue;
      rows.push({ method, path, kind: rule.kind, menu, menu_label: menu ? LABEL.get(menu) ?? menu : null, action: rule.kind === 'menu' ? rule.action : null });
    }
    rows.sort((x, y) => x.path.localeCompare(y.path) || x.method.localeCompare(y.method));
    return { rate_limit_per_minute: PER_MINUTE, rows };
  });
}
