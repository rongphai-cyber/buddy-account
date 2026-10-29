import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { MENU, flattenMenu } from '@buddy/core';
import type { Db } from '../db.js';
import { badRequest, forbidden, notFound, parse, requireCompany, type AuthContext } from '../http.js';
import { logActivity } from '../audit.js';

/**
 * สิทธิ์ 7 ชนิดรายเมนู — คู่มือบทที่ 23 (S-SEC-01/02/03)
 * 1) สิทธิ์พื้นฐานตามระดับอนุมัติ (แก้ไม่ได้): 0–4 อ่าน/เพิ่ม/แก้ไข/พิมพ์ · 5–8 + ยกเลิก/ลบ/รับรอง และกำหนดค่าโปรแกรม · 9 ทุกอย่างรวมระบบความปลอดภัย
 * 2) ผู้ใช้ที่ "ตรวจสอบสิทธิ์ก่อนใช้งาน" ถูกจำกัดเพิ่มด้วยตารางสิทธิ์ (รายผู้ใช้ก่อน แล้วรายกลุ่ม; เมนูที่ตรงที่สุดก่อน แล้วเมนูหลัก แล้ว "ทุกระบบ")
 *    Y = ใช้ได้ · L = ใช้ได้และบันทึกเหตุการณ์ · N = ไม่ให้ใช้ · S = (ช่องพิมพ์) พิมพ์ออกจอเท่านั้น · ไม่มีแถวเลย = ไม่ให้ใช้
 * 3) ผู้ดูแลระบบ (กลุ่ม ADMIN) ใช้ได้ทุกอย่าง
 */
export const ACTIONS = ['read', 'add', 'edit', 'cancel', 'delete', 'print', 'approve'] as const;
export type Action = (typeof ACTIONS)[number];
const COL = { read: 'can_read', add: 'can_add', edit: 'can_edit', cancel: 'can_cancel', delete: 'can_delete', print: 'can_print', approve: 'can_approve' } as const;
export const ACTION_TH: Record<Action, string> = { read: 'อ่าน', add: 'เพิ่ม', edit: 'แก้ไข', cancel: 'ยกเลิก', delete: 'ลบ', print: 'พิมพ์', approve: 'รับรอง' };
export const ALL_MENU = 'ALL';

const FLAT = flattenMenu(MENU);
const PARENT = new Map(FLAT.map((m) => [m.code, m.parent ?? null]));
const LABEL = new Map(FLAT.map((m) => [m.code, m.label]));
/** เมนูกำหนดค่าโปรแกรม: ระดับ 5 ขึ้นไปจึงเพิ่ม/แก้/ลบได้ (คู่มือหน้า 359–360) */
const CONFIG = new Set(['SET.CO', 'SET.DEF', 'SET.PRD', 'SET.TBL', 'SET.DEPT', 'SET.BRANCH', 'SET.DOCNO', 'SET.LINK', 'SET.NEWCO', 'OT.LOCK', 'OT.YE', 'OT.BACKUP', 'OT.IMPORT', 'GL.BOOK', 'GL.FS']);
/** ระบบความปลอดภัยและแก้ไขแบบฟอร์ม: ระดับ 9 เท่านั้น */
const SECURITY = new Set(['SET.SEC', 'SET.TENANT', 'RP.CUSTOM', 'OT.LOG']);

export function baseAllowed(level: number, menu: string, action: Action) {
  if (level >= 9) return true;
  if (SECURITY.has(menu)) return false;
  const write = action !== 'read' && action !== 'print';
  if (CONFIG.has(menu) && write) return level >= 5;
  if (action === 'cancel' || action === 'delete' || action === 'approve') return level >= 5;
  return true;
}

type PermRow = { subject_type: string; code: string } & Record<(typeof COL)[Action], string>;
const chainOf = (menu: string) => { const out: string[] = []; let c: string | null | undefined = menu; while (c) { out.push(c); c = PARENT.get(c); } out.push(ALL_MENU); return out; };

/** แถวสิทธิ์ของผู้ใช้และกลุ่มของผู้ใช้ในบริษัทปัจจุบัน (อ่านครั้งเดียวต่อคำขอ) */
async function loadRows(db: Db, a: AuthContext): Promise<PermRow[]> {
  if (!a.companyId) return [];
  const rows = await db.selectFrom('sys_permission as p').innerJoin('sys_menu as m', 'm.id', 'p.menu_id')
    .select(['p.subject_type', 'm.code', 'p.can_read', 'p.can_add', 'p.can_edit', 'p.can_cancel', 'p.can_delete', 'p.can_print', 'p.can_approve'])
    .where('p.company_id', '=', a.companyId).where('p.deleted_at', 'is', null)
    .where((eb) => eb.or([eb.and([eb('p.subject_type', '=', 'U'), eb('p.subject_id', '=', a.userId)]), ...(a.groupId ? [eb.and([eb('p.subject_type', '=', 'G'), eb('p.subject_id', '=', a.groupId)])] : [])]))
    .execute();
  return rows as PermRow[];
}

/** ค่าในตารางสิทธิ์ที่ใช้กับ (เมนู, การทำงาน) — null = ไม่มีแถวเลย */
function tableValue(rows: PermRow[], menu: string, action: Action): string | null {
  const chain = chainOf(menu);
  for (const st of ['U', 'G']) {
    for (const code of chain) {
      const r = rows.find((x) => x.subject_type === st && x.code === code);
      if (r) return r[COL[action]] || 'N';
    }
  }
  return null;
}

function decide(a: AuthContext, rows: PermRow[], menu: string, action: Action): { allowed: boolean; log: boolean; screenOnly: boolean } {
  if (a.isAdmin) return { allowed: true, log: false, screenOnly: false };
  if (!baseAllowed(a.approvalLevel, menu, action)) return { allowed: false, log: false, screenOnly: false };
  if (!a.checkRights) return { allowed: true, log: false, screenOnly: false };
  const v = tableValue(rows, menu, action);
  if (v === 'Y' || v === 'L') return { allowed: true, log: v === 'L', screenOnly: false };
  if (v === 'S' && action === 'print') return { allowed: true, log: false, screenOnly: true };
  return { allowed: false, log: false, screenOnly: false };
}

/** สิทธิ์ทุกเมนูของผู้ใช้ในบริษัทปัจจุบัน — หน้าจอใช้ซ่อนเมนู/ปุ่ม (ด่านจริงอยู่ที่ API) */
export async function permissionMatrix(db: Db, a: AuthContext) {
  const rows = await loadRows(db, a);
  const out: Record<string, Record<Action, boolean | 'S'>> = {};
  for (const m of FLAT) {
    out[m.code] = Object.fromEntries(ACTIONS.map((x) => { const r = decide(a, rows, m.code, x); return [x, r.allowed ? (r.screenOnly ? 'S' : true) : false]; })) as Record<Action, boolean | 'S'>;
  }
  return out;
}

/**
 * กฎของทุก API: menu = ต้องมีสิทธิ์ (เมนู, การทำงาน) · lookup = ข้อมูลอ้างอิงที่หน้าจออื่นต้องใช้ (ต้องเลือกบริษัทแล้ว)
 * self = ตรวจสิทธิ์เองในตัว API (ผู้ดูแลระบบ/บัญชีของตัวเอง) · open = ไม่ต้องเข้าระบบ
 * API ที่ไม่อยู่ในรายการนี้ถูกปฏิเสธทั้งหมด (และชุดทดสอบตรวจว่าครบ)
 */
type Rule = { kind: 'menu'; menu: string; action: Action } | { kind: 'lookup' } | { kind: 'self' } | { kind: 'open' };
const M = (menu: string, action: Action): Rule => ({ kind: 'menu', menu, action });
const LOOKUP: Rule = { kind: 'lookup' }, SELF: Rule = { kind: 'self' }, OPEN: Rule = { kind: 'open' };
export const API_RULES: Record<string, Rule> = {
  'GET /api/v1/health': OPEN, 'GET /api/v1/setup/status': OPEN, 'POST /api/v1/setup': OPEN, 'POST /api/v1/auth/login': OPEN,
  'GET /api/v1/menu': SELF, 'GET /api/v1/auth/me': SELF, 'POST /api/v1/auth/logout': SELF, 'POST /api/v1/auth/password': SELF, 'POST /api/v1/auth/select': SELF,
  'GET /api/v1/users': SELF, 'POST /api/v1/users': SELF, 'PUT /api/v1/users/:id': SELF, 'POST /api/v1/user-groups': SELF,
  'GET /api/v1/tenants': SELF, 'POST /api/v1/tenants': SELF, 'PUT /api/v1/tenants/:id': SELF, 'POST /api/v1/companies': SELF,
  'GET /api/v1/activity-log': LOOKUP,
  // บริษัท สาขา แผนก รอบบัญชี
  'GET /api/v1/company': LOOKUP, 'PUT /api/v1/company': M('SET.CO', 'edit'),
  'GET /api/v1/branches': LOOKUP, 'POST /api/v1/branches': M('SET.BRANCH', 'add'), 'PUT /api/v1/branches/:id': M('SET.BRANCH', 'edit'),
  'GET /api/v1/departments': LOOKUP, 'POST /api/v1/departments': M('SET.DEPT', 'add'), 'PUT /api/v1/departments/:id': M('SET.DEPT', 'edit'), 'DELETE /api/v1/departments/:id': M('SET.DEPT', 'delete'),
  'GET /api/v1/gl/periods': LOOKUP, 'POST /api/v1/gl/periods/years': M('SET.PRD', 'add'), 'POST /api/v1/gl/periods/:id/lock': M('OT.LOCK', 'edit'),
  // บัญชี
  'GET /api/v1/gl/accounts': LOOKUP, 'POST /api/v1/gl/accounts': M('GL.ACC', 'add'), 'PUT /api/v1/gl/accounts/:id': M('GL.ACC', 'edit'),
  'POST /api/v1/gl/accounts/:id/renumber': M('GL.ACC', 'edit'), 'DELETE /api/v1/gl/accounts/:id': M('GL.ACC', 'delete'),
  'GET /api/v1/gl/default-accounts': LOOKUP,
  'GET /api/v1/gl/books': LOOKUP, 'POST /api/v1/gl/books': M('GL.BOOK', 'add'), 'PUT /api/v1/gl/books/:id': M('GL.BOOK', 'edit'),
  'GET /api/v1/gl/journals': M('GL.JNL', 'read'), 'GET /api/v1/gl/journals/:id': M('GL.JNL', 'read'), 'GET /api/v1/gl/journals-next-no': M('GL.JNL', 'read'),
  'POST /api/v1/gl/journals': M('GL.JNL', 'add'), 'PUT /api/v1/gl/journals/:id': M('GL.JNL', 'edit'), 'POST /api/v1/gl/journals/:id/cancel': M('GL.JNL', 'cancel'),
  'GET /api/v1/gl/opening': M('GL.OB', 'read'), 'PUT /api/v1/gl/opening': M('GL.OB', 'edit'),
  'GET /api/v1/gl/prior-year': M('GL.LY', 'read'), 'GET /api/v1/gl/prior-year/entry': M('GL.LY', 'read'), 'PUT /api/v1/gl/prior-year/entry': M('GL.LY', 'edit'),
  'GET /api/v1/gl/budget': M('GL.BUD', 'read'), 'GET /api/v1/gl/budget/entry': M('GL.BUD', 'read'), 'PUT /api/v1/gl/budget/entry': M('GL.BUD', 'edit'),
  'GET /api/v1/gl/templates': LOOKUP, 'GET /api/v1/gl/templates/:id': LOOKUP, 'POST /api/v1/gl/templates': M('GL.TPL', 'add'),
  'PUT /api/v1/gl/templates/:id': M('GL.TPL', 'edit'), 'DELETE /api/v1/gl/templates/:id': M('GL.TPL', 'delete'),
  // แบบงบและรายงาน
  'GET /api/v1/fs/layouts': LOOKUP, 'GET /api/v1/fs/layouts/:id': LOOKUP, 'POST /api/v1/fs/layouts': M('GL.FS', 'add'),
  'PUT /api/v1/fs/layouts/:id': M('GL.FS', 'edit'), 'POST /api/v1/fs/layouts/:id/copy': M('GL.FS', 'add'),
  'GET /api/v1/fs/run': M('RP.FS', 'read'),
  'GET /api/v1/reports/trial-balance': M('RP.TB', 'read'), 'GET /api/v1/reports/ledger': M('RP.LEDGER', 'read'),
  'GET /api/v1/reports/journal-book': M('RP.JNL', 'read'), 'GET /api/v1/reports/account-detail': M('RP.DETAIL', 'read'),
  // ระบบความปลอดภัย (S-SEC-01/02/03)
  'GET /api/v1/permissions/menus': M('SET.SEC', 'read'), 'GET /api/v1/permissions': M('SET.SEC', 'read'),
  'GET /api/v1/permissions/by-menu': M('SET.SEC', 'read'), 'PUT /api/v1/permissions': M('SET.SEC', 'edit'),
};

/** API ที่ลงทะเบียนแล้วทั้งหมด (ชุดทดสอบใช้ตรวจว่าทุกเส้นมีกฎสิทธิ์) */
export const REGISTERED_ROUTES = new Set<string>();

/** ตรวจสิทธิ์ทุกคำขอ API ตามกฎด้านบน (หลังตรวจการเข้าระบบ) — ต้องเรียกก่อนลงทะเบียน API */
export function attachPermissions(app: FastifyInstance, db: Db) {
  app.addHook('onRoute', (r) => {
    if (!r.url.startsWith('/api/')) return;
    for (const m of [r.method].flat()) if (m !== 'HEAD') REGISTERED_ROUTES.add(`${m} ${r.url}`);
  });
  app.addHook('preHandler', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    const url = req.routeOptions?.url;
    if (!url) return;   // ไม่พบ API — ตัวจัดการ 404 ตอบเอง
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    const rule = API_RULES[`${method} ${url}`];
    if (!rule) throw forbidden('API นี้ยังไม่ได้กำหนดสิทธิ์ — แจ้งผู้พัฒนาโปรแกรม');
    if (rule.kind === 'open' || rule.kind === 'self') return;
    const a = requireCompany(req);
    if (rule.kind === 'lookup') return;
    const r = decide(a, await loadRows(db, a), rule.menu, rule.action);
    if (!r.allowed) {
      throw forbidden(`ไม่มีสิทธิ์${ACTION_TH[rule.action]}ในเมนู "${LABEL.get(rule.menu) ?? rule.menu}" — ติดต่อผู้ดูแลระบบเพื่อขอสิทธิ์ (เมนู อื่น ๆ › ผู้ใช้งานและสิทธิ์)`);
    }
    if (r.log) await logActivity(db, a, { module: rule.menu, action: `USE_${rule.action.toUpperCase()}`, detail: { method, url: req.url.split('?')[0] } });
  });
}

/** รายการเมนูในตาราง sys_menu ให้ตรงกับเมนูของโปรแกรม (รวม "ทุกระบบ") — เรียกตอนเปิด server */
export async function syncMenus(db: Db) {
  const want = [{ code: ALL_MENU, name_th: 'ทุกระบบงาน', parent: null as string | null, sort: 0 }, ...FLAT.map((m, i) => ({ code: m.code, name_th: m.label, parent: m.parent ?? null, sort: i + 1 }))];
  const have = new Map((await db.selectFrom('sys_menu').select(['id', 'code', 'name_th', 'sort_order']).where('deleted_at', 'is', null).execute()).map((r) => [r.code, r]));
  for (const w of want) {
    const h = have.get(w.code);
    if (!h) have.set(w.code, { ...(await db.insertInto('sys_menu').values({ code: w.code, name_th: w.name_th, sort_order: w.sort }).returning(['id', 'code', 'name_th', 'sort_order']).executeTakeFirstOrThrow()) });
    else if (h.name_th !== w.name_th || h.sort_order !== w.sort) await db.updateTable('sys_menu').set({ name_th: w.name_th, sort_order: w.sort }).where('id', '=', h.id).execute();
  }
  for (const w of want) if (w.parent) await db.updateTable('sys_menu').set({ parent_id: have.get(w.parent)!.id }).where('id', '=', have.get(w.code)!.id).where(sql<boolean>`parent_id IS DISTINCT FROM ${have.get(w.parent)!.id}::uuid`).execute();
}

/** หน้าจอกำหนดสิทธิ์ — ตามกลุ่ม (S-SEC-01) ตามผู้ใช้ (S-SEC-02) และตามเมนู (S-SEC-03) ของบริษัทปัจจุบัน */
export function permissionRoutes(app: FastifyInstance, db: Db) {
  const val = z.enum(['', 'Y', 'L', 'N', 'S']);
  /** ผู้ใช้/กลุ่มต้องเป็นของลูกค้า (tenant) เดียวกับผู้ดูแล — ผู้ให้บริการเห็นทุกราย */
  async function subjectOf(a: AuthContext, type: 'U' | 'G', id: string) {
    const q = type === 'U'
      ? db.selectFrom('sys_user').select(['id', 'username as code', 'display_name as name', 'tenant_id', 'approval_level', 'check_rights', 'user_group_id']).where('id', '=', id).where('deleted_at', 'is', null)
      : db.selectFrom('sys_user_group').select(['id', 'code', 'name', 'tenant_id', sql<number>`9`.as('approval_level'), sql<boolean>`true`.as('check_rights'), sql<string | null>`NULL::uuid`.as('user_group_id')]).where('id', '=', id).where('deleted_at', 'is', null);
    const s = await q.executeTakeFirst();
    if (!s || (!a.isPlatform && (s.tenant_id ?? null) !== (a.tenantId ?? null))) throw notFound(type === 'U' ? 'ผู้ใช้' : 'กลุ่มผู้ใช้');
    return s;
  }
  const menuIds = async () => new Map((await db.selectFrom('sys_menu').select(['id', 'code']).where('deleted_at', 'is', null).execute()).map((r) => [r.code, r.id]));

  app.get('/api/v1/permissions/menus', async (req) => {
    requireCompany(req);
    const depth = (c: string) => { let n = 0, p = PARENT.get(c); while (p) { n++; p = PARENT.get(p); } return n; };
    return [{ code: ALL_MENU, label: 'ทุกระบบงาน', depth: 0, group: true }, ...FLAT.map((m) => ({ code: m.code, label: m.label, depth: depth(m.code) + 1, group: !!m.children?.length }))];
  });

  app.get('/api/v1/permissions', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ subject_type: z.enum(['U', 'G']), subject_id: z.string().uuid() }), req.query);
    const s = await subjectOf(a, q.subject_type, q.subject_id);
    const rows = await db.selectFrom('sys_permission as p').innerJoin('sys_menu as m', 'm.id', 'p.menu_id')
      .select(['m.code', 'p.can_read', 'p.can_add', 'p.can_edit', 'p.can_cancel', 'p.can_delete', 'p.can_print', 'p.can_approve'])
      .where('p.company_id', '=', a.companyId).where('p.subject_type', '=', q.subject_type).where('p.subject_id', '=', q.subject_id).where('p.deleted_at', 'is', null).execute();
    let effective: Awaited<ReturnType<typeof permissionMatrix>> | null = null;
    if (q.subject_type === 'U') {
      const g = s.user_group_id ? await db.selectFrom('sys_user_group').select('code').where('id', '=', s.user_group_id).executeTakeFirst() : null;
      const as: AuthContext = { ...a, userId: s.id, approvalLevel: s.approval_level, checkRights: s.check_rights, groupId: s.user_group_id, isAdmin: g?.code === 'ADMIN', isPlatform: false };
      effective = await permissionMatrix(db, as);
    }
    return { subject: { type: q.subject_type, id: s.id, code: s.code, name: s.name, approval_level: q.subject_type === 'U' ? s.approval_level : null, check_rights: q.subject_type === 'U' ? s.check_rights : null },
      rows: Object.fromEntries(rows.map((r) => [r.code, r])), effective };
  });

  app.get('/api/v1/permissions/by-menu', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ menu_code: z.string().min(1).max(30) }), req.query);
    const rows = await sql<{ subject_type: string; subject_id: string; code: string | null; name: string | null } & Record<string, string>>`
      SELECT p.subject_type, p.subject_id, COALESCE(u.username, g.code) AS code, COALESCE(u.display_name, g.name) AS name,
             p.can_read, p.can_add, p.can_edit, p.can_cancel, p.can_delete, p.can_print, p.can_approve
        FROM sys_permission p JOIN sys_menu m ON m.id = p.menu_id
        LEFT JOIN sys_user u ON p.subject_type = 'U' AND u.id = p.subject_id
        LEFT JOIN sys_user_group g ON p.subject_type = 'G' AND g.id = p.subject_id
       WHERE p.company_id = ${a.companyId} AND p.deleted_at IS NULL AND m.code = ${q.menu_code}
         AND (${a.isPlatform} OR COALESCE(u.tenant_id, g.tenant_id) IS NOT DISTINCT FROM ${a.tenantId ?? null}::uuid)
       ORDER BY p.subject_type DESC, 3`.execute(db);
    return rows.rows;
  });

  app.put('/api/v1/permissions', async (req) => {
    const a = requireCompany(req);
    const b = parse(z.object({
      subject_type: z.enum(['U', 'G']), subject_id: z.string().uuid(),
      rows: z.array(z.object({ menu_code: z.string().min(1).max(30), can_read: val, can_add: val, can_edit: val, can_cancel: val, can_delete: val, can_print: val, can_approve: val })).max(500),
    }), req.body);
    const s = await subjectOf(a, b.subject_type, b.subject_id);
    const ids = await menuIds();
    for (const r of b.rows) {
      if (!ids.has(r.menu_code)) throw badRequest(`ไม่พบเมนู ${r.menu_code}`);
      const bad = ACTIONS.find((x) => x !== 'print' && r[COL[x]] === 'S');
      if (bad) throw badRequest(`ค่า S ใช้ได้เฉพาะช่องพิมพ์ (เมนู ${r.menu_code} ช่อง${ACTION_TH[bad]})`);
    }
    return db.transaction().execute(async (tx) => {
      const before = await tx.selectFrom('sys_permission as p').innerJoin('sys_menu as m', 'm.id', 'p.menu_id').select(['m.code', 'p.can_read', 'p.can_add', 'p.can_edit', 'p.can_cancel', 'p.can_delete', 'p.can_print', 'p.can_approve'])
        .where('p.company_id', '=', a.companyId).where('p.subject_type', '=', b.subject_type).where('p.subject_id', '=', b.subject_id).where('p.deleted_at', 'is', null).execute();
      await tx.updateTable('sys_permission').set({ deleted_at: sql`now()` as never, updated_by: a.userId }).where('company_id', '=', a.companyId).where('subject_type', '=', b.subject_type).where('subject_id', '=', b.subject_id).where('deleted_at', 'is', null).execute();
      const rows = b.rows.filter((r) => ACTIONS.some((x) => r[COL[x]]))
        .map((r) => ({ company_id: a.companyId, subject_type: b.subject_type, subject_id: b.subject_id, menu_id: ids.get(r.menu_code)!, created_by: a.userId,
          ...Object.fromEntries(ACTIONS.map((x) => [COL[x], r[COL[x]] || 'N'])) as Record<(typeof COL)[Action], string> }));
      if (rows.length) await tx.insertInto('sys_permission').values(rows).execute();
      await logActivity(tx, a, { module: 'SEC', action: 'PERMISSION', docNo: s.code, table: 'sys_permission', rowId: b.subject_id, detail: { subject_type: b.subject_type, before, rows: rows.length } });
      return { rows: rows.length };
    });
  });
}

