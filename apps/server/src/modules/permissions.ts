import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { docMenuOf, findReport, BANK_KINDS, BILL_KINDS, CASH_KINDS, ITEM_KINDS, MENU, SETTLE_KINDS, STOCK_KINDS, TRADE_KINDS, flattenMenu } from '@buddy/core';
import { runInCompanyScope, type Database, type Db } from '../db.js';
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
const CONFIG = new Set(['SET.CO', 'SET.DEF', 'SET.IAG', 'SET.FAG', 'SET.PAYM', 'SET.PRD', 'SET.TBL', 'SET.DEPT', 'SET.BRANCH', 'SET.DOCNO', 'SET.LINK', 'SET.NEWCO', 'OT.LOCK', 'OT.YE', 'OT.BACKUP', 'OT.IMPORT', 'GL.BOOK', 'GL.FS']);
/** ระบบความปลอดภัยและแก้ไขแบบฟอร์ม: ระดับ 9 เท่านั้น */
const SECURITY = new Set(['SET.SEC', 'SET.TENANT', 'RP.CUSTOM', 'RP.FORM', 'OT.LOG']);

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

/** ผลการตรวจสิทธิ์ (เมนู, การทำงาน) ของผู้ใช้ปัจจุบัน — ใช้ใน API ที่ต้องรู้รายละเอียด เช่น สิทธิ์พิมพ์ออกจอเท่านั้น */
export async function allowedFor(db: Db, a: AuthContext, menu: string, action: Action) { return decide(a, await loadRows(db, a), menu, action); }

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
/** pick: เลือกเมนูจากคำขอ (เช่น เช็ครับ/เช็คจ่ายใช้ API เดียวกันแต่สิทธิ์คนละเมนู) */
type Rule = { kind: 'menu'; menu: string; action: Action; pick?: (req: FastifyRequest, db: Db, companyId: string) => Promise<string> } | { kind: 'lookup' } | { kind: 'self' } | { kind: 'open' };
const M = (menu: string, action: Action): Rule => ({ kind: 'menu', menu, action });
/** เช็ค: ทิศทางจาก query/body หรือจากเช็คที่อ้างถึง → เมนูเช็ครับ/เช็คจ่าย */
const CHQ = (rMenu: string, pMenu: string, action: Action): Rule => ({ kind: 'menu', menu: rMenu, action, pick: async (req, db, companyId) => {
  const q = (req.query ?? {}) as Record<string, unknown>, b = (req.body ?? {}) as Record<string, unknown>, p = (req.params ?? {}) as Record<string, unknown>;
  let dir = (q.direction ?? b.direction) as string | undefined;
  const id = (p.id as string | undefined) ?? (Array.isArray(b.cheque_ids) ? (b.cheque_ids[0] as string) : undefined);
  if (!dir && id && /^[0-9a-f-]{36}$/i.test(id)) dir = (await db.selectFrom('fin_cheque').select('direction').where('id', '=', id).where('company_id', '=', companyId).executeTakeFirst())?.direction;
  return dir === 'P' ? pMenu : rMenu;
} });
/** เอกสารใด ๆ (doc_header/gl_journal ตาม :kind) → เมนูของหมวดเอกสารนั้น */
const DOC = (action: Action): Rule => ({ kind: 'menu', menu: 'GL.JNL', action, pick: async (req, db, companyId) => {
  const p = (req.params ?? {}) as Record<string, string>, b = (req.body ?? {}) as Record<string, string>;
  const kind = p.kind ?? b.kind, id = p.id;
  if (kind !== 'doc') return 'GL.JNL';
  if (id && /^[0-9a-f-]{36}$/i.test(id)) {
    const h = await db.selectFrom('doc_header').select(['doc_class', 'is_opening']).where('id', '=', id).where('company_id', '=', companyId).executeTakeFirst();
    return h ? docMenuOf(h.doc_class, h.is_opening) : 'GL.JNL';
  }
  const t = b.type_id && /^[0-9a-f-]{36}$/i.test(b.type_id) ? await db.selectFrom('md_doc_type').select('doc_class').where('id', '=', b.type_id).where('company_id', '=', companyId).executeTakeFirst() : undefined;
  return t ? docMenuOf(t.doc_class) : 'GL.JNL';
} });
/** หมายเหตุแฟ้มหลัก: สิทธิ์ตามเมนูของแฟ้ม (สินค้า/ลูกค้า/ผู้จำหน่าย) */
const NOTE_MENU: Record<string, string> = { item: 'IC.ITEM', customer: 'SA.CUS', supplier: 'PU.SUP' };
const MNOTE = (action: Action): Rule => ({ kind: 'menu', menu: 'IC.ITEM', action, pick: async (req) => NOTE_MENU[String((req.params as { entity?: string }).entity)] ?? 'IC.ITEM' });
const LOOKUP: Rule = { kind: 'lookup' }, SELF: Rule = { kind: 'self' }, OPEN: Rule = { kind: 'open' };
export const API_RULES: Record<string, Rule> = {
  'GET /api/v1/health': OPEN, 'GET /api/v1/setup/status': OPEN, 'POST /api/v1/setup': OPEN, 'POST /api/v1/auth/login': OPEN,
  'GET /api/v1/menu': SELF, 'GET /api/v1/auth/me': SELF, 'POST /api/v1/auth/logout': SELF, 'POST /api/v1/auth/password': SELF, 'POST /api/v1/auth/select': SELF,
  'GET /api/v1/users': SELF, 'POST /api/v1/users': SELF, 'PUT /api/v1/users/:id': SELF, 'POST /api/v1/user-groups': SELF,
  'GET /api/v1/tenants': SELF, 'POST /api/v1/tenants': SELF, 'PUT /api/v1/tenants/:id': SELF, 'POST /api/v1/companies': SELF,
  'GET /api/v1/activity-log': LOOKUP, 'GET /api/v1/activity-log/search': M('OT.LOG', 'read'),
  // บริษัท สาขา แผนก รอบบัญชี
  'GET /api/v1/company': LOOKUP, 'PUT /api/v1/company': M('SET.CO', 'edit'),
  'GET /api/v1/branches': LOOKUP, 'POST /api/v1/branches': M('SET.BRANCH', 'add'), 'PUT /api/v1/branches/:id': M('SET.BRANCH', 'edit'),
  'GET /api/v1/departments': LOOKUP, 'POST /api/v1/departments': M('SET.DEPT', 'add'), 'PUT /api/v1/departments/:id': M('SET.DEPT', 'edit'), 'DELETE /api/v1/departments/:id': M('SET.DEPT', 'delete'),
  'GET /api/v1/gl/periods': LOOKUP, 'POST /api/v1/gl/periods/years': M('SET.PRD', 'add'), 'POST /api/v1/gl/periods/:id/lock': M('OT.LOCK', 'edit'),
  // บัญชี
  'GET /api/v1/gl/accounts': LOOKUP, 'POST /api/v1/gl/accounts': M('GL.ACC', 'add'), 'PUT /api/v1/gl/accounts/:id': M('GL.ACC', 'edit'),
  'POST /api/v1/gl/accounts/:id/renumber': M('GL.ACC', 'edit'), 'DELETE /api/v1/gl/accounts/:id': M('GL.ACC', 'delete'),
  'GET /api/v1/gl/default-accounts': LOOKUP,
  'GET /api/v1/gl/chart-templates': LOOKUP, 'GET /api/v1/gl/chart-templates/:key': M('GL.ACC', 'read'), 'POST /api/v1/gl/chart-templates/:key/apply': M('GL.ACC', 'add'),
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
  // ค่าเริ่มต้นแต่ละระบบ (บทที่ 5)
  'GET /api/v1/settings': LOOKUP, 'PUT /api/v1/settings': M('SET.DEF', 'edit'),
  'GET /api/v1/lookups': LOOKUP,
  'GET /api/v1/customers/:id/activity': M('SA.CUS', 'read'), 'GET /api/v1/suppliers/:id/activity': M('PU.SUP', 'read'),
  'GET /api/v1/customers': LOOKUP, 'GET /api/v1/customers/:id': LOOKUP, 'POST /api/v1/customers': M('SA.CUS', 'add'),
  'PUT /api/v1/customers/:id': M('SA.CUS', 'edit'), 'DELETE /api/v1/customers/:id': M('SA.CUS', 'delete'),
  'GET /api/v1/suppliers': LOOKUP, 'GET /api/v1/suppliers/:id': LOOKUP, 'POST /api/v1/suppliers': M('PU.SUP', 'add'),
  'PUT /api/v1/suppliers/:id': M('PU.SUP', 'edit'), 'DELETE /api/v1/suppliers/:id': M('PU.SUP', 'delete'),
  'GET /api/v1/item-account-groups': LOOKUP, 'POST /api/v1/item-account-groups': M('SET.IAG', 'add'),
  'PUT /api/v1/item-account-groups/:id': M('SET.IAG', 'edit'), 'DELETE /api/v1/item-account-groups/:id': M('SET.IAG', 'delete'),
  ...Object.fromEntries(Object.values(ITEM_KINDS).flatMap((k) => [
    [`GET /api/v1/${k.path}`, LOOKUP], [`GET /api/v1/${k.path}/:id`, LOOKUP], [`POST /api/v1/${k.path}`, M(k.menu, 'add')],
    [`PUT /api/v1/${k.path}/:id`, M(k.menu, 'edit')], [`DELETE /api/v1/${k.path}/:id`, M(k.menu, 'delete')],
  ])),
  'POST /api/v1/kits/:id/copy': M('IC.KIT', 'add'),
  'GET /api/v1/items/:id/prices': M('IC.PRICE', 'read'), 'PUT /api/v1/items/:id/prices': M('IC.PRICE', 'edit'),
  'GET /api/v1/items/:id/reorder': M('IC.REORDER', 'read'), 'PUT /api/v1/items/:id/reorder': M('IC.REORDER', 'edit'),
  'GET /api/v1/bank-accounts': LOOKUP, 'POST /api/v1/bank-accounts': M('FI.BK.ACC', 'add'), 'PUT /api/v1/bank-accounts/:id': M('FI.BK.ACC', 'edit'), 'DELETE /api/v1/bank-accounts/:id': M('FI.BK.ACC', 'delete'),
  'GET /api/v1/payment-methods/:direction': LOOKUP, 'PUT /api/v1/payment-methods/:direction': M('SET.PAYM', 'edit'),
  'GET /api/v1/doc-types': LOOKUP, 'GET /api/v1/doc-types/:id': LOOKUP, 'POST /api/v1/doc-types': M('SET.DOCNO', 'add'),
  'PUT /api/v1/doc-types/:id': M('SET.DOCNO', 'edit'), 'DELETE /api/v1/doc-types/:id': M('SET.DOCNO', 'delete'),
  'GET /api/v1/gl/link': M('SET.LINK', 'read'), 'PUT /api/v1/gl/link': M('SET.LINK', 'edit'),
  'GET /api/v1/data-tables': LOOKUP, 'GET /api/v1/data-tables/:code': LOOKUP, 'PUT /api/v1/data-tables/:code': M('SET.TBL', 'edit'),
  'GET /api/v1/docs/:id/journal': LOOKUP, 'GET /api/v1/docs/:id/posting-preview': LOOKUP, 'POST /api/v1/docs/:id/repost': M('SET.LINK', 'edit'),
  ...Object.fromEntries(TRADE_KINDS.flatMap((k) => [
    [`GET /api/v1/${k.path}`, M(k.menu, 'read')], [`GET /api/v1/${k.path}/:id`, M(k.menu, 'read')], [`POST /api/v1/${k.path}`, M(k.menu, 'add')],
    [`PUT /api/v1/${k.path}/:id`, M(k.menu, 'edit')], [`POST /api/v1/${k.path}/:id/cancel`, M(k.menu, 'cancel')],
  ])),
  'GET /api/v1/trade-defaults/:cls': LOOKUP, 'GET /api/v1/item-search': LOOKUP,
  'GET /api/v1/orders/open': LOOKUP,
  ...Object.fromEntries(TRADE_KINDS.filter((k) => k.order && k.cls !== 'QT').map((k) => [`POST /api/v1/${k.path}/:id/lines/:lineId/cancel`, M(k.menu, 'cancel')])),
  ...Object.fromEntries(SETTLE_KINDS.flatMap((k) => [
    [`GET /api/v1/${k.path}`, M(k.menu, 'read')], [`GET /api/v1/${k.path}/open-items`, M(k.menu, 'read')], [`GET /api/v1/${k.path}/:id`, M(k.menu, 'read')],
    [`POST /api/v1/${k.path}`, M(k.menu, 'add')], [`PUT /api/v1/${k.path}/:id`, M(k.menu, 'edit')], [`POST /api/v1/${k.path}/:id/cancel`, M(k.menu, 'cancel')],
    [`GET /api/v1/${k.path}/bills`, M(k.menu, 'read')],
  ])),
  ...Object.fromEntries(CASH_KINDS.flatMap((k) => [
    [`GET /api/v1/${k.path}`, M(k.menu, 'read')], [`GET /api/v1/${k.path}/:id`, M(k.menu, 'read')], [`POST /api/v1/${k.path}`, M(k.menu, 'add')],
    [`PUT /api/v1/${k.path}/:id`, M(k.menu, 'edit')], [`POST /api/v1/${k.path}/:id/cancel`, M(k.menu, 'cancel')],
  ])),
  'GET /api/v1/deposits/open': LOOKUP,
  ...Object.fromEntries(BILL_KINDS.flatMap((k) => [
    [`GET /api/v1/${k.path}`, M(k.menu, 'read')], [`GET /api/v1/${k.path}/open-items`, M(k.menu, 'read')], [`GET /api/v1/${k.path}/:id`, M(k.menu, 'read')],
    [`POST /api/v1/${k.path}`, M(k.menu, 'add')], [`PUT /api/v1/${k.path}/:id`, M(k.menu, 'edit')], [`POST /api/v1/${k.path}/:id/cancel`, M(k.menu, 'cancel')],
    [`POST /api/v1/${k.path}/:id/appointment`, M(k.module === 'AR' ? 'FI.AR.BD' : k.menu, 'edit')],
  ])),
  'POST /api/v1/quotations/:id/convert': M('SA.SO', 'add'),
  // ลูกหนี้/เจ้าหนี้คงค้างยกมา (S-OB-03/04)
  ...Object.fromEntries([['ar-opening', 'FI.AR.OB'], ['ap-opening', 'FI.AP.OB']].flatMap(([p, m]) => [
    [`GET /api/v1/${p}`, M(m!, 'read')], [`GET /api/v1/${p}/:id`, M(m!, 'read')], [`POST /api/v1/${p}`, M(m!, 'add')],
    [`PUT /api/v1/${p}/:id`, M(m!, 'edit')], [`POST /api/v1/${p}/:id/cancel`, M(m!, 'cancel')],
  ])),
  // เงินสดย่อย (บทที่ 15)
  ...Object.fromEntries(['petty-payments', 'petty-reimbursements'].flatMap((p) => [
    [`GET /api/v1/${p}`, M('GL.PC', 'read')], [`GET /api/v1/${p}/:id`, M('GL.PC', 'read')], [`POST /api/v1/${p}`, M('GL.PC', 'add')],
    [`PUT /api/v1/${p}/:id`, M('GL.PC', 'edit')], [`POST /api/v1/${p}/:id/cancel`, M('GL.PC', 'cancel')],
  ])),
  'GET /api/v1/gl/vat-closing': M('GL.JNL', 'add'),
  'GET /api/v1/stock/balances': M('IC.STOCK', 'read'), 'GET /api/v1/stock/card': M('IC.STOCK', 'read'),
  ...Object.fromEntries(STOCK_KINDS.flatMap((k) => [
    [`GET /api/v1/${k.path}`, M('IC.TRN', 'read')], [`GET /api/v1/${k.path}/:id`, M('IC.TRN', 'read')], [`POST /api/v1/${k.path}`, M('IC.TRN', 'add')],
    [`PUT /api/v1/${k.path}/:id`, M('IC.TRN', 'edit')], [`POST /api/v1/${k.path}/:id/cancel`, M('IC.TRN', 'cancel')],
  ])),
  'GET /api/v1/stock/lots': M('IC.TRN', 'read'),
  'GET /api/v1/stock-counts/dates': M('IC.COUNT', 'read'), 'GET /api/v1/stock-counts': M('IC.COUNT', 'read'), 'POST /api/v1/stock-counts/prepare': M('IC.COUNT', 'add'),
  'POST /api/v1/stock-counts/rows': M('IC.COUNT', 'add'), 'PUT /api/v1/stock-counts/entries': M('IC.COUNT', 'edit'), 'DELETE /api/v1/stock-counts/:id': M('IC.COUNT', 'delete'),
  'POST /api/v1/stock-counts/adjust': M('IC.COUNT', 'approve'), 'POST /api/v1/stock-counts/reopen': M('IC.COUNT', 'cancel'),
  'GET /api/v1/stock-opening': M('IC.OB', 'read'), 'GET /api/v1/stock-opening/:id': M('IC.OB', 'read'), 'POST /api/v1/stock-opening': M('IC.OB', 'add'),
  'PUT /api/v1/stock-opening/:id': M('IC.OB', 'edit'), 'POST /api/v1/stock-opening/:id/cancel': M('IC.OB', 'cancel'),
  ...Object.fromEntries(BANK_KINDS.flatMap((k) => [
    [`GET /api/v1/${k.path}`, M('FI.BK.TX', 'read')], [`GET /api/v1/${k.path}/:id`, M('FI.BK.TX', 'read')], [`POST /api/v1/${k.path}`, M('FI.BK.TX', 'add')],
    [`PUT /api/v1/${k.path}/:id`, M('FI.BK.TX', 'edit')], [`POST /api/v1/${k.path}/:id/cancel`, M('FI.BK.TX', 'cancel')],
  ])),
  'GET /api/v1/bank-book': M('FI.BK.BOOK', 'read'),
  // ศูนย์รายงาน: สิทธิ์อ่านตามเมนูของกลุ่มรายงาน (RP.SA RP.PU RP.IC RP.CHQ RP.GL RP.TAX)
  'GET /api/v1/rpt/available': LOOKUP,
  'POST /api/v1/rpt/:code/run': { kind: 'menu', menu: 'RP.CENTER', action: 'read', pick: async (req) => findReport(String((req.params as { code?: string }).code ?? ''))?.menu ?? 'RP.CENTER' },
  // พิมพ์/รับรองเอกสาร รายละเอียดแฟ้มข้อมูล แบบฟอร์ม รายงานของผู้ใช้ (บทที่ 25 · S-UI-08..12)
  'GET /api/v1/notes/:kind/:id': DOC('read'), 'PUT /api/v1/notes/:kind/:id': DOC('edit'),
  'GET /api/v1/master-notes/:entity/:id': MNOTE('read'), 'PUT /api/v1/master-notes/:entity/:id': MNOTE('edit'),
  'GET /api/v1/print/:kind/:id': DOC('read'), 'POST /api/v1/print/:kind/:id/printed': DOC('print'),
  'POST /api/v1/approve/:kind/:id': DOC('approve'), 'POST /api/v1/approve-range': DOC('approve'), 'GET /api/v1/record-info/:kind/:id': DOC('read'),
  'GET /api/v1/print-forms': LOOKUP, 'PUT /api/v1/print-forms/:scope/:slot': M('RP.FORM', 'edit'), 'DELETE /api/v1/print-forms/:scope/:slot': M('RP.FORM', 'delete'),
  'GET /api/v1/rpt-custom': LOOKUP, 'POST /api/v1/rpt-custom': M('RP.CUSTOM', 'add'), 'PUT /api/v1/rpt-custom/:id': M('RP.CUSTOM', 'edit'), 'DELETE /api/v1/rpt-custom/:id': M('RP.CUSTOM', 'delete'),
  // ทรัพย์สินถาวร (บทที่ 19) + กลุ่มบัญชีทรัพย์สิน (S-SET-12)
  'GET /api/v1/asset-account-groups': LOOKUP, 'POST /api/v1/asset-account-groups': M('SET.FAG', 'add'), 'PUT /api/v1/asset-account-groups/:id': M('SET.FAG', 'edit'), 'DELETE /api/v1/asset-account-groups/:id': M('SET.FAG', 'delete'),
  'GET /api/v1/fa/assets': M('FA.ASSET', 'read'), 'GET /api/v1/fa/assets/:id': M('FA.ASSET', 'read'), 'POST /api/v1/fa/assets': M('FA.ASSET', 'add'), 'PUT /api/v1/fa/assets/:id': M('FA.ASSET', 'edit'),
  'POST /api/v1/fa/assets/:id/recode': M('FA.ASSET', 'edit'), 'DELETE /api/v1/fa/assets/:id': M('FA.ASSET', 'delete'),
  'POST /api/v1/fa/assets/:id/sell': M('FA.ASSET', 'edit'), 'POST /api/v1/fa/assets/:id/unsell': M('FA.ASSET', 'cancel'),
  'GET /api/v1/backup/company': M('OT.BACKUP', 'add'), 'POST /api/v1/backup/verify': M('OT.BACKUP', 'read'), 'POST /api/v1/backup/restore': M('OT.BACKUP', 'edit'),
  'GET /api/v1/backup/users': M('SET.SEC', 'read'), 'POST /api/v1/backup/users/restore': M('SET.SEC', 'edit'),
  'GET /api/v1/gl/year-end': M('OT.YE', 'read'), 'POST /api/v1/gl/year-end/inventory-jv': M('OT.YE', 'add'), 'POST /api/v1/gl/year-end/close': M('OT.YE', 'edit'), 'POST /api/v1/gl/year-end/reopen': M('OT.YE', 'cancel'),
  'POST /api/v1/fa/depreciate': M('FA.DEPR', 'add'), 'GET /api/v1/fa/depreciation-periods': M('FA.DEPR', 'read'),
  'GET /api/v1/bank-recon': M('FI.BK.REC', 'read'), 'PUT /api/v1/bank-recon/statement': M('FI.BK.REC', 'edit'), 'POST /api/v1/bank-recon/clear': M('FI.BK.REC', 'edit'),
  'GET /api/v1/gl/inventory-accounts': M('GL.INV', 'read'), 'GET /api/v1/gl/inventory': M('GL.INV', 'read'), 'PUT /api/v1/gl/inventory': M('GL.INV', 'edit'), 'POST /api/v1/gl/inventory/compute': M('GL.INV', 'edit'),
  // ทะเบียนเช็ค: สิทธิ์ตามทิศทาง เช็ครับ (FI.BK.CR/CL) · เช็คจ่าย (FI.BK.CP/PC)
  'GET /api/v1/cheques': CHQ('FI.BK.CR', 'FI.BK.CP', 'read'), 'GET /api/v1/cheques/:id': CHQ('FI.BK.CR', 'FI.BK.CP', 'read'), 'POST /api/v1/cheques': CHQ('FI.BK.CR', 'FI.BK.CP', 'add'),
  'PUT /api/v1/cheques/:id': CHQ('FI.BK.CR', 'FI.BK.CP', 'edit'), 'DELETE /api/v1/cheques/:id': CHQ('FI.BK.CR', 'FI.BK.CP', 'delete'),
  'POST /api/v1/cheques/deposit': M('FI.BK.DQ', 'add'), 'POST /api/v1/cheques/undeposit': M('FI.BK.DQ', 'cancel'),
  'POST /api/v1/cheques/pass': CHQ('FI.BK.CL', 'FI.BK.PC', 'add'), 'POST /api/v1/cheques/:id/unpass': CHQ('FI.BK.CL', 'FI.BK.PC', 'cancel'), 'POST /api/v1/cheques/:id/return': M('FI.BK.CR', 'edit'),
  'POST /api/v1/cheques/:id/write-off': M('FI.BK.CR', 'approve'), 'POST /api/v1/cheques/:id/write-off/cancel': M('FI.BK.CR', 'cancel'),
  'GET /api/v1/cheque-deposits': M('FI.BK.DQ', 'read'), 'GET /api/v1/cheque-deposits/:id': M('FI.BK.DQ', 'read'), 'POST /api/v1/cheque-deposits': M('FI.BK.DQ', 'add'),
  'PUT /api/v1/cheque-deposits/:id': M('FI.BK.DQ', 'edit'), 'POST /api/v1/cheque-deposits/:id/cancel': M('FI.BK.DQ', 'cancel'),
  'POST /api/v1/cheque-deposits/:id/pass': M('FI.BK.CL', 'add'), 'POST /api/v1/cheque-deposits/:id/unpass': M('FI.BK.CL', 'cancel'),
  'GET /api/v1/serials': M('IC.SERIAL', 'read'), 'GET /api/v1/serials/:id': M('IC.SERIAL', 'read'), 'POST /api/v1/serials': M('IC.SERIAL', 'add'),
  'PUT /api/v1/serials/:id': M('IC.SERIAL', 'edit'), 'DELETE /api/v1/serials/:id': M('IC.SERIAL', 'delete'), 'POST /api/v1/serials/:id/printed': M('IC.SERIAL', 'print'),
  // แฟ้มภาษีซื้อ/ขาย (บทที่ 16)
  ...Object.fromEntries([['P', 'FI.VAT.IN'], ['S', 'FI.VAT.OUT']].flatMap(([k, m]) => [
    [`GET /api/v1/vat/${k}`, M(m!, 'read')], [`POST /api/v1/vat/${k}`, M(m!, 'add')], [`PUT /api/v1/vat/${k}/:id`, M(m!, 'edit')], [`POST /api/v1/vat/${k}/:id/cancel`, M(m!, 'cancel')],
  ])),
  'GET /api/v1/wht/efile': M('FI.WHT', 'print'),
  'GET /api/v1/wht': M('FI.WHT', 'read'), 'GET /api/v1/wht/:id': M('FI.WHT', 'read'), 'POST /api/v1/wht': M('FI.WHT', 'add'),
  'PUT /api/v1/wht/:id': M('FI.WHT', 'edit'), 'POST /api/v1/wht/:id/cancel': M('FI.WHT', 'cancel'), 'POST /api/v1/wht/:id/printed': M('FI.WHT.CERT', 'read'),
  'GET /api/v1/salespersons': LOOKUP, 'GET /api/v1/salespersons/:id': LOOKUP, 'POST /api/v1/salespersons': M('SA.SLM', 'add'),
  'PUT /api/v1/salespersons/:id': M('SA.SLM', 'edit'), 'DELETE /api/v1/salespersons/:id': M('SA.SLM', 'delete'),
  // ระบบความปลอดภัย (S-SEC-01/02/03)
  'GET /api/v1/permissions/menus': M('SET.SEC', 'read'), 'GET /api/v1/permissions': M('SET.SEC', 'read'),
  'GET /api/v1/permissions/by-menu': M('SET.SEC', 'read'), 'PUT /api/v1/permissions': M('SET.SEC', 'edit'),
};

/** API ที่ลงทะเบียนแล้วทั้งหมด (ชุดทดสอบใช้ตรวจว่าทุกเส้นมีกฎสิทธิ์) */
export const REGISTERED_ROUTES = new Set<string>();

/**
 * ตรวจสิทธิ์ทุกคำขอ API ตามกฎด้านบน (หลังตรวจการเข้าระบบ) — ต้องเรียกก่อนลงทะเบียน API
 * rls = true: API ข้อมูลบริษัท (menu/lookup) ทำงานทั้งคำขอในขอบเขต Row-Level Security ของบริษัทที่เลือก (T0.14)
 */
export function attachPermissions(app: FastifyInstance, database: Database, rls: boolean) {
  const db = database.db;
  app.addHook('onRoute', (r) => {
    if (!r.url.startsWith('/api/')) return;
    const methods = [r.method].flat().filter((m) => m !== 'HEAD');
    for (const m of methods) REGISTERED_ROUTES.add(`${m} ${r.url}`);
    if (!rls) return;
    const rule = API_RULES[`${methods[0]} ${r.url}`];
    if (!rule || (rule.kind !== 'menu' && rule.kind !== 'lookup')) return;
    const handler = r.handler;
    r.handler = function (this: FastifyInstance, req, reply) {
      const a = req.auth;
      if (!a?.companyId) return handler.call(this, req, reply);
      return runInCompanyScope(database, { companyId: a.companyId, tenantId: a.tenantId, isPlatform: a.isPlatform }, async () => handler.call(this, req, reply));
    };
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
    const menu = rule.pick ? await rule.pick(req, db, a.companyId) : rule.menu;
    const r = decide(a, await loadRows(db, a), menu, rule.action);
    if (!r.allowed) {
      throw forbidden(`ไม่มีสิทธิ์${ACTION_TH[rule.action]}ในเมนู "${LABEL.get(menu) ?? menu}" — ติดต่อผู้ดูแลระบบเพื่อขอสิทธิ์ (เมนู อื่น ๆ › ผู้ใช้งานและสิทธิ์)`);
    }
    if (r.log) await logActivity(db, a, { module: menu, action: `USE_${rule.action.toUpperCase()}`, detail: { method, url: req.url.split('?')[0] } });
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

