import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sql, type RawBuilder } from 'kysely';
import { z } from 'zod';
import { ADMIN_MENUS, adminOnlyMenu, AI_BILL_TARGETS, PLATFORM_MENUS, providerOnly, tenantMenusOff, type TenantModuleRow, docMenuOf, findReport, HUB_ONLY_MENUS, hubOnly, menuOffBy, normalizeAppAccess, BANK_KINDS, BILL_KINDS, CASH_KINDS, DEPOSIT_REFUND, ITEM_KINDS, MENU, SETTLE_KINDS, STOCK_KINDS, TRADE_KINDS, flattenMenu } from '@buddy/core';
import { runInCompanyScope, type Database, type Db } from '../db.js';
import { badRequest, forbidden, notFound, parse, requireCompany, type AuthContext } from '../http.js';
import { logActivity } from '../audit.js';
import { checkApiKeyRule } from './apikeys.js';
import { checkMfaGate } from './security.js';
import { replays, syncCtx } from '../sync-context.js';
import { branchCapture, branchStateOf, checkBranchWrite } from './sync/branch.js';
import { withSource } from './source.js';
import { payrollSource } from './wts.js';
import { withVersion } from '../versions.js';
import { companiesForUser } from './auth.js';
import { companySettings } from '../company-template.js';

/**
 * สิทธิ์ 7 ชนิดรายเมนู — คู่มือบทที่ 23 (S-SEC-01/02/03)
 * 1) สิทธิ์พื้นฐานตามระดับอนุมัติ (แก้ไม่ได้): 0–4 อ่าน/เพิ่ม/แก้ไข/พิมพ์ · 5–8 + ยกเลิก/ลบ/รับรอง และกำหนดค่าโปรแกรม · 9 ทุกอย่างรวมระบบความปลอดภัย
 * 2) ตารางสิทธิ์ (กลุ่ม + ผู้ใช้) จำกัดเพิ่ม — รายช่อง (HANDOFF 197): ช่องของผู้ใช้ที่เมนูนี้ → เมนูหลักของผู้ใช้ → "ทุกระบบ" ของผู้ใช้ → ช่องของกลุ่มตามลำดับเดียวกัน
 *    (ช่องว่าง = ไม่ได้ตั้ง ใช้ค่าถัดไป) · Y = ใช้ได้ · L = ใช้ได้และบันทึกเหตุการณ์ · N = ไม่ให้ใช้ · S = (ช่องพิมพ์) พิมพ์ออกจอเท่านั้น · ไม่มีค่าเลย = ไม่ให้ใช้
 *    ช่องที่ไม่มีค่าเลย (tableMode): มีกลุ่มที่มีสิทธิ์ในบริษัทนี้ หรือตั้ง "ซ่อนเมนูที่ไม่มีสิทธิ์" = ไม่ได้รับ · ไม่มีกลุ่ม = ตามระดับอนุมัติ
 *    ระดับ 9 ที่ไม่ได้ตั้ง "ซ่อนเมนูที่ไม่มีสิทธิ์" = ทุกอย่างเหมือนเดิม · ผู้ใช้ที่ไม่มีกลุ่มและไม่มีแถวสิทธิ์ = ตามระดับอนุมัติอย่างเดียว (เหมือนเดิม)
 *    check_rights = ทำอย่างไรกับเมนูที่ไม่มีสิทธิ์: true ซ่อน · false แสดงจาง กดแล้วบอกเหตุผล (เจ้าของ 26/11/2569 ข้อ 5)
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
const SECURITY = new Set(['SET.SEC', 'SET.TENANT', 'SET.API', 'SET.AI', 'SET.PDPA', 'SET.DEVICE', 'RP.CUSTOM', 'RP.FORM', 'OT.LOG']);
/** ระบบเงินเดือน (ข้อมูลลับ): ระดับ 5 ขึ้นไปทุกการทำงานรวมการอ่าน · ตั้งค่ารายการ/อัตรา = เมนูกำหนดค่า */
export const PAYROLL = new Set(['PAY', 'PAY.RUN', 'PAY.EMP', 'PAY.ITEM', 'PAY.LAW', 'PAY.CALC', 'PAY.SET', 'PAY.TAX', 'PAY.RPT']);

/** ระดับอนุมัติขั้นต่ำของ (เมนู, การทำงาน) ตามสิทธิ์พื้นฐาน — 0 = ทุกระดับ */
export function levelNeeded(menu: string, action: Action) {
  if (SECURITY.has(menu)) return 9;
  if (PAYROLL.has(menu)) return 5;
  const write = action !== 'read' && action !== 'print';
  if (CONFIG.has(menu) && write) return 5;
  if (action === 'cancel' || action === 'delete' || action === 'approve') return 5;
  return 0;
}
export function baseAllowed(level: number, menu: string, action: Action) {
  return level >= levelNeeded(menu, action);
}

type PermRow = { subject_type: string; code: string } & Record<(typeof COL)[Action], string | null>;
const chainOf = (menu: string) => { const out: string[] = []; let c: string | null | undefined = menu; while (c) { out.push(c); c = PARENT.get(c); } out.push(ALL_MENU); return out; };

/** แถวสิทธิ์ของผู้ใช้และกลุ่มของผู้ใช้ในบริษัทปัจจุบัน (อ่านครั้งเดียวต่อคำขอ) */
async function loadRows(db: Db, a: AuthContext): Promise<PermRow[]> {
  if (!a.companyId) return [];
  const rows = await db.selectFrom('sys_permission as p').innerJoin('sys_menu as m', 'm.id', 'p.menu_id')
    .select(['p.subject_type', 'm.code', 'p.can_read', 'p.can_add', 'p.can_edit', 'p.can_cancel', 'p.can_delete', 'p.can_print', 'p.can_approve'])
    .where('p.company_id', '=', a.companyId).where('p.deleted_at', 'is', null)
    // แถวสิทธิ์ของเมนูผู้ให้บริการ (ถ้ามีค้างในฐานข้อมูล) ไม่มีผลกับใครเลย — ไม่นับว่า "กลุ่มมีแถวในบริษัทนี้" ด้วย (HANDOFF 199)
    .where('m.code', 'not in', [...PLATFORM_MENUS])
    .where((eb) => eb.or([eb.and([eb('p.subject_type', '=', 'U'), eb('p.subject_id', '=', a.userId)]), ...(a.groupId ? [eb.and([eb('p.subject_type', '=', 'G'), eb('p.subject_id', '=', a.groupId)])] : [])]))
    .execute();
  return rows as PermRow[];
}

/**
 * ค่าในตารางสิทธิ์ที่ใช้กับ (เมนู, การทำงาน) รายช่อง (HANDOFF 197) — ผู้ใช้ก่อน (เมนูนี้ → เมนูหลัก → ALL) แล้วกลุ่ม · null = ไม่มีค่าเลย
 * แถวเดิมก่อน 0082 มีค่าครบทุกช่อง → ผลเท่าเดิม (แถวของผู้ใช้ที่ใกล้ที่สุดชนะทั้งแถว)
 */
export function tableCell(rows: PermRow[], menu: string, action: Action): { v: string; subject: 'U' | 'G'; menu: string } | null {
  const chain = chainOf(menu), col = COL[action];
  for (const st of ['U', 'G'] as const) {
    for (const code of chain) {
      const v = rows.find((x) => x.subject_type === st && x.code === code)?.[col];
      if (v && v.trim()) return { v: v.trim(), subject: st, menu: code };
    }
  }
  return null;
}
const tableValue = (rows: PermRow[], menu: string, action: Action) => tableCell(rows, menu, action)?.v ?? null;
/**
 * ตารางสิทธิ์ใช้กับผู้ใช้นี้ในบริษัทนี้อย่างไร (HANDOFF 197 · 198) — ช่องที่ไม่มีค่าในตารางของผู้ใช้และกลุ่ม แปลว่าอะไร
 * - strict = ไม่ได้รับ: กลุ่มของผู้ใช้มีสิทธิ์ในบริษัทนี้ (ทุกระดับ รวมระดับ 9 — ระดับบอกอำนาจอนุมัติ กลุ่มบอกเมนู · HANDOFF 198 ข้อ 3)
 *   หรือ ไม่มีกลุ่มแต่ตั้ง "ซ่อนเมนูที่ไม่มีสิทธิ์" (ตรวจสอบสิทธิ์แบบ Express = ใช้เฉพาะที่ตั้งในตาราง — เหมือนก่อน 197)
 * - adjust = ตามระดับอนุมัติ: ไม่มีกลุ่ม (หรือกลุ่มยังไม่มีสิทธิ์ในบริษัทนี้) — ช่องที่ตั้งในตารางของผู้ใช้ปรับเฉพาะช่องนั้น
 * - off = ไม่ใช้ตาราง (ตามระดับอนุมัติล้วน):
 *   · ระดับ 9 ที่ไม่มีกลุ่ม (หรือกลุ่มไม่มีสิทธิ์ในบริษัทนี้) และไม่ได้ตั้งซ่อนเมนู
 *   · คำขอด้วยกุญแจ API ของผู้ใช้ที่ไม่ได้ตั้งซ่อนเมนู (HANDOFF 198 ข้อ 1) — โปรแกรมอื่น (WTS-POS · WTS-Living · WTS-HR) ใช้กฎเดิมก่อน 197:
 *     กลุ่มไม่มีผลกับกุญแจ ไม่งั้นการวางผู้ใช้ของกุญแจไว้ในกลุ่มทำให้อีกโปรแกรมส่งข้อมูลเข้าไม่ได้ · ตั้งซ่อนเมนู = ใช้ตาราง (เหมือนก่อน 197)
 * "ซ่อน/แสดงจาง" ของผู้ใช้ที่มีกลุ่ม = เรื่องการแสดงผลเท่านั้น (สิทธิ์เท่ากัน)
 */
export type TableMode = 'strict' | 'adjust' | 'off';
export function tableMode(a: Pick<AuthContext, 'checkRights' | 'approvalLevel' | 'apiKeyId'>, rows: Array<{ subject_type: string }>): TableMode {
  if (rows.some((r) => r.subject_type === 'G')) return a.apiKeyId && !a.checkRights ? 'off' : 'strict';
  if (a.checkRights) return 'strict';
  if (a.apiKeyId || a.approvalLevel >= 9) return 'off';
  return 'adjust';
}

/** การทำงานที่ต้องเป็นผู้ดูแล/ระดับ 9 หรือได้รับสิทธิ์โดยตรง: ดาวน์โหลดแฟ้มสำรองทั้งบริษัท · นำข้อมูลสำรองกลับ */
export const BACKUP_ADMIN_ONLY = new Set(['OT.BACKUP:add', 'OT.BACKUP:edit']);
/** แถวสิทธิ์ที่เมนูนี้โดยตรง (ไม่นับ "ทุกระบบ"/เมนูหลัก) ของผู้ใช้ก่อน แล้วของกลุ่ม */
function explicitGrant(rows: PermRow[], menu: string, action: Action) {
  const v = rows.find((x) => x.subject_type === 'U' && x.code === menu)?.[COL[action]] || rows.find((x) => x.subject_type === 'G' && x.code === menu)?.[COL[action]];
  return v === 'Y' || v === 'L';
}

/** ระบบที่บริษัทปิดไว้ (ข้อกำหนดเจ้าของ: ปิดบางระบบทั้งบริษัท) — รหัสใน MODULE_SWITCHES */
/** ระบบที่ผู้ใช้ปิดไว้ (หน้า ระบบที่ใช้งาน) */
export async function modulesOffRaw(db: Db, companyId: string | null): Promise<string[]> {
  if (!companyId) return [];
  const r = await db.selectFrom('sys_setting').select('value').where('company_id', '=', companyId).where('branch_id', 'is', null).where('key', '=', 'sys.modules_off').where('deleted_at', 'is', null).executeTakeFirst();
  return Array.isArray(r?.value) ? (r!.value as unknown[]).map(String) : [];
}
/** ระบบที่ปิดจริง = ที่ผู้ใช้ปิด + ระบบเงินเดือนเมื่อบริษัทคิดเงินเดือนที่ WTS-HR (docs/17 D7 · B0.5) */
export async function modulesOff(db: Db, companyId: string | null): Promise<string[]> {
  const off = await modulesOffRaw(db, companyId);
  if (!off.includes('PAY') && (await payrollSource(db, companyId)) === 'wts-sop') off.push('PAY');
  for (const m of await companyTenantOff(db, companyId)) off.push(`T:${m}`);
  return off;
}

const thToday = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
type TenantOffRow = { tenant_id: string | null; mods: unknown; devices: boolean };
function tenantOffOf(r: TenantOffRow | undefined): string[] {
  if (!r?.tenant_id) return [];   // บริษัท/ผู้ใช้ของผู้ให้บริการ (ไม่มีลูกค้า) = เปิดทุกเมนู
  const mods = (typeof r.mods === 'string' ? JSON.parse(r.mods) : r.mods ?? []) as TenantModuleRow[];
  return tenantMenusOff(mods, thToday(), { hasDevices: !!r.devices });
}
const tenantOffSql = (tenant: RawBuilder<unknown>) => sql`(SELECT coalesce(json_agg(json_build_object('module_key', m.module_key, 'enabled', m.enabled, 'valid_to', m.valid_to::text, 'seats', m.seats)), '[]'::json)
    FROM sys_tenant_module m WHERE m.tenant_id = ${tenant} AND m.deleted_at IS NULL) AS mods,
  EXISTS (SELECT 1 FROM sys_device d JOIN sys_company dc ON dc.id = d.company_id WHERE dc.tenant_id = ${tenant} AND dc.deleted_at IS NULL AND d.status = 'A' AND d.deleted_at IS NULL) AS devices`;
/**
 * เมนูที่ลูกค้าเจ้าของบริษัทนี้ยังไม่ได้เปิด (HANDOFF 200 · TENANT_FEATURES ใน @buddy/core) — นำข้อมูลจาก Express · เครื่องสาขา
 * บริษัทของผู้ให้บริการ = [] · เจ้าหน้าที่ผู้ให้บริการไม่ติดข้อนี้ (decide ตรวจ isPlatform)
 */
export async function companyTenantOff(db: Db, companyId: string | null | undefined): Promise<string[]> {
  if (!companyId) return [];
  return tenantOffOf((await sql<TenantOffRow>`SELECT c.tenant_id, ${tenantOffSql(sql`c.tenant_id`)} FROM sys_company c WHERE c.id = ${companyId}`.execute(db)).rows[0]);
}
/** เมนูที่ลูกค้ารายนี้ยังไม่ได้เปิด (ยังไม่เลือกบริษัท เช่น นำข้อมูลจาก Express สร้างบริษัทใหม่) */
export async function tenantOffMenus(db: Db, tenantId: string | null | undefined): Promise<string[]> {
  if (!tenantId) return [];
  return tenantOffOf((await sql<TenantOffRow>`SELECT t.id AS tenant_id, ${tenantOffSql(sql`t.id`)} FROM sys_tenant t WHERE t.id = ${tenantId}`.execute(db)).rows[0]);
}

/** เหตุที่ใช้ไม่ได้: module ระบบปิดทั้งบริษัท · platform เมนูผู้ให้บริการ · hub เปิดเฉพาะโปรแกรมอื่น · level ระดับอนุมัติไม่พอ · backup ต้องได้สิทธิ์โดยตรง · table ตารางสิทธิ์ไม่ให้ */
export type Why = 'module' | 'platform' | 'tenant' | 'hub' | 'level' | 'backup' | 'table' | 'admin';
/** เมนูที่ API ให้เฉพาะผู้ดูแลระบบ (กลุ่ม ADMIN) — ผู้ใช้อื่นเห็นจาง พร้อมเหตุผล ไม่ใช่เปิดแล้วเจอ 403 (HANDOFF 198 ตรวจทาน) */
const ADMIN_ONLY = new Set(Object.keys(ADMIN_MENUS));   // HANDOFF 201: ที่เดียวที่กำหนดอยู่ใน @buddy/core (ADMIN_MENUS)
type Decision = { allowed: boolean; log: boolean; screenOnly: boolean; why?: Why };
const NO = (why: Why): Decision => ({ allowed: false, log: false, screenOnly: false, why });
/** เมนูส่วนตัว (หน้าเปิดโปรแกรม เปลี่ยนรหัสผ่าน): ทุกคนใช้ได้ ไม่ขึ้นกับตารางสิทธิ์ */
const PERSONAL = new Set(HUB_ONLY_MENUS);

function decide(a: AuthContext, rows: PermRow[], menu: string, action: Action, off: string[] = []): Decision {
  // ระบบที่ปิดทั้งบริษัท: ไม่มีใครใช้ได้ (รวมผู้ดูแลระบบ) จนกว่าจะเปิดกลับ
  if (off.length && menuOffBy(menu, off)) return NO('module');
  // เมนูของผู้ให้บริการ: ผู้ดูแลของลูกค้า (ADMIN ใน tenant) ก็ไม่ได้ — ไม่แสดงในเมนู (HANDOFF 159.1)
  if (PLATFORM_MENUS.has(menu) && !a.isPlatform) return NO('platform');
  // เมนูที่ต้องเปิดให้รายลูกค้า (HANDOFF 200): ลูกค้ายังไม่ได้เปิด = ไม่มีใครของลูกค้าใช้ได้ (รวมผู้ดูแล) · ไม่แสดงในเมนู · off มี T:<เมนู> จาก modulesOff
  if (!a.isPlatform && off.includes(`T:${menu}`)) return NO('tenant');
  if (a.isAdmin) return { allowed: true, log: false, screenOnly: false };
  if (ADMIN_ONLY.has(menu)) return NO('admin');
  // ผู้ใช้ที่ผู้ดูแลไม่ให้เปิด Buddy (เปิดได้เฉพาะโปรแกรมอื่นจาก Hub · sys_user.app_access): เหลือหน้าเปิดโปรแกรม + รหัสผ่าน
  if (hubOnly(a.apps) && !HUB_ONLY_MENUS.includes(menu)) return NO('hub');
  if (!baseAllowed(a.approvalLevel, menu, action)) return NO('level');
  // สำรอง (ดาวน์โหลดข้อมูลทั้งบริษัท) / นำข้อมูลสำรองกลับ: ผู้ดูแลระบบหรือระดับ 9 — ระดับต่ำกว่าต้องได้รับสิทธิ์ที่เมนูนี้โดยตรง (แถวสิทธิ์ของผู้ใช้/กลุ่มที่เมนู OT.BACKUP เป็น Y/L) แม้ไม่ได้ตรวจสิทธิ์ก่อนใช้งาน (HANDOFF 146)
  if (BACKUP_ADMIN_ONLY.has(`${menu}:${action}`) && a.approvalLevel < 9 && !explicitGrant(rows, menu, action)) return NO('backup');
  // เมนูส่วนตัวใช้ได้เสมอ · ไม่ใช้ตาราง = ตามระดับอนุมัติ
  const mode = tableMode(a, rows);
  if (PERSONAL.has(menu) || mode === 'off') return { allowed: true, log: false, screenOnly: false };
  const v = tableValue(rows, menu, action);
  if (v === 'Y' || v === 'L') return { allowed: true, log: v === 'L', screenOnly: false };
  if (v === 'S' && action === 'print') return { allowed: true, log: false, screenOnly: true };
  // ไม่มีค่าในตารางเลย: ไม่มีกลุ่ม (adjust) = ตามระดับอนุมัติ · มีกลุ่ม/ซ่อนเมนู (strict) = ไม่ได้รับ
  if (!v && mode === 'adjust') return { allowed: true, log: false, screenOnly: false };
  return NO('table');
}

/** ข้อความเหตุผลที่ใช้ไม่ได้ (หน้าจอแสดงเมื่อชี้/กดเมนูที่จาง · ข้อความ 403) */
export function whyText(d: { why?: Why }, a: Pick<AuthContext, 'approvalLevel'>, menu: string, action: Action) {
  const act = ACTION_TH[action];
  switch (d.why) {
    case 'level': return `${act}ในเมนูนี้ต้องระดับอนุมัติ ${levelNeeded(menu, action)} ขึ้นไป (ระดับของคุณ ${a.approvalLevel})`;
    case 'backup': return 'สำรอง/นำข้อมูลกลับทั้งบริษัท เฉพาะผู้ดูแลระบบ ระดับอนุมัติ 9 หรือผู้ที่ได้รับสิทธิ์ที่เมนูนี้โดยตรง';
    case 'table': return `กลุ่มผู้ใช้/สิทธิ์รายเมนูของคุณไม่ได้ให้สิทธิ์${act}ในเมนูนี้`;
    case 'module': return 'ระบบนี้ปิดอยู่ในบริษัทนี้';
    case 'admin': return 'เมนูนี้เฉพาะผู้ดูแลระบบ (กลุ่ม ADMIN)';
    case 'hub': return 'คุณได้รับสิทธิ์เปิดเฉพาะโปรแกรมอื่นจากหน้าเปิดโปรแกรม';
    case 'tenant': return 'เมนูนี้ยังไม่เปิดให้กิจการของคุณ — ติดต่อผู้ให้บริการเพื่อขอเปิดใช้';
    case 'platform': return 'เมนูนี้เฉพาะเจ้าหน้าที่ผู้ให้บริการโปรแกรม — ติดต่อผู้ให้บริการ';
    default: return 'เมนูนี้ไม่เปิดให้บัญชีนี้';
  }
}

/** ผลการตรวจสิทธิ์ (เมนู, การทำงาน) ของผู้ใช้ปัจจุบัน — ใช้ใน API ที่ต้องรู้รายละเอียด เช่น สิทธิ์พิมพ์ออกจอเท่านั้น */
export async function allowedFor(db: Db, a: AuthContext, menu: string, action: Action) { return decide(a, await loadRows(db, a), menu, action, await modulesOff(db, a.companyId)); }
/** ผู้ใช้ที่เพิ่ม/แก้อะไรไม่ได้เลยในบริษัทนี้ (ผู้ใช้ดูอย่างเดียว) — API แบบ self ที่เปลี่ยนข้อมูลใช้ตรวจ (HANDOFF 157) */
export async function readOnlyUser(db: Db, a: AuthContext) {
  if (a.isAdmin) return false;
  const rows = await loadRows(db, a), off = await modulesOff(db, a.companyId);
  // เมนูส่วนตัว (เปลี่ยนรหัสผ่าน หน้าเปิดโปรแกรม) ไม่นับ — ไม่ใช่ข้อมูลของบริษัท
  return !FLAT.some((m) => !PERSONAL.has(m.code) && (decide(a, rows, m.code, 'add', off).allowed || decide(a, rows, m.code, 'edit', off).allowed));
}

/** สิทธิ์ทุกเมนูของผู้ใช้ในบริษัทปัจจุบัน — หน้าจอใช้ซ่อน/จางเมนูและปุ่ม (ด่านจริงอยู่ที่ API) */
export async function permissionMatrix(db: Db, a: AuthContext) {
  return (await permissionView(db, a)).perms;
}
/**
 * สิทธิ์ทุกเมนู + เหตุผลของเมนูที่เปิดไม่ได้ (HANDOFF 197)
 * why[เมนู] = เหตุที่อ่านไม่ได้ (หรือเพิ่มไม่ได้) เฉพาะเหตุที่ผู้ใช้ควรเห็นเมนูแบบจาง (ระดับ/ตารางสิทธิ์/สำรอง) · table = ตารางสิทธิ์มีผลกับผู้ใช้นี้ในบริษัทนี้
 */
export async function permissionView(db: Db, a: AuthContext) {
  const rows = await loadRows(db, a);
  const off = await modulesOff(db, a.companyId);
  const perms: Record<string, Record<Action, boolean | 'S'>> = {};
  const why: Record<string, string> = {};
  /**
   * เหตุที่ปุ่มใช้ไม่ได้ในเมนูที่เปิดได้ (HANDOFF 198 ข้อ 6): ตัวเลข = ระดับอนุมัติที่ต้องการ · 't' = กลุ่ม/สิทธิ์รายเมนูไม่ให้
   * เฉพาะเมนูที่อ่านได้ (ปุ่ม ยกเลิก ลบ รับรอง พิมพ์ … อยู่ในหน้านั้น) — หน้าจอแสดงเมื่อชี้ปุ่มที่จาง
   */
  const deny: Record<string, Partial<Record<Action, number | 't'>>> = {};
  for (const m of FLAT) {
    const ds = ACTIONS.map((x) => [x, decide(a, rows, m.code, x, off)] as const);
    perms[m.code] = Object.fromEntries(ds.map(([x, r]) => [x, r.allowed ? (r.screenOnly ? 'S' : true) : false])) as Record<Action, boolean | 'S'>;
    const first = ds.find(([x, r]) => x === 'read' && !r.allowed) ?? ds.find(([x, r]) => x === 'add' && !r.allowed);
    if (first && (first[1].why === 'level' || first[1].why === 'table' || first[1].why === 'backup' || (first[1].why === 'admin' && adminOnlyMenu(m.code) === 'fade'))) why[m.code] = whyText(first[1], a, m.code, first[0]);
    if (perms[m.code]!.read) for (const [x, r] of ds) {
      if (r.allowed) continue;
      if (r.why === 'level') (deny[m.code] ??= {})[x] = levelNeeded(m.code, x);
      else if (r.why === 'table') (deny[m.code] ??= {})[x] = 't';
    }
  }
  return { perms, why, deny, table: (a.isAdmin ? 'off' : tableMode(a, rows)) as TableMode };
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
  // GET /api/v1/docs/:id/print (กุญแจ API ของระบบอื่น · ข้อ 87) ไม่มี :kind = เอกสาร doc_header
  const kind = p.kind ?? b.kind ?? (req.routeOptions?.url === '/api/v1/docs/:id/print' ? 'doc' : undefined), id = p.id;
  if (kind !== 'doc') return 'GL.JNL';
  if (id && /^[0-9a-f-]{36}$/i.test(id)) {
    const h = await db.selectFrom('doc_header').select(['doc_class', 'is_opening']).where('id', '=', id).where('company_id', '=', companyId).executeTakeFirst();
    return h ? docMenuOf(h.doc_class, h.is_opening) : 'GL.JNL';
  }
  const t = b.type_id && /^[0-9a-f-]{36}$/i.test(b.type_id) ? await db.selectFrom('md_doc_type').select('doc_class').where('id', '=', b.type_id).where('company_id', '=', companyId).executeTakeFirst() : undefined;
  return t ? docMenuOf(t.doc_class) : 'GL.JNL';
} });
/** ประวัติที่อยู่ (HANDOFF 180): ที่อยู่ของสาขา = สิทธิ์เมนูสาขา · สำนักงานใหญ่ = รายละเอียดกิจการ */
const ADDR = (action: Action): Rule => ({ kind: 'menu', menu: 'SET.CO', action, pick: async (req, db, companyId) => {
  const b = (req.body ?? {}) as Record<string, unknown>, p = (req.params ?? {}) as Record<string, string>;
  let br = typeof b.branch_id === 'string' ? b.branch_id : null;
  if (p.id && /^[0-9a-f-]{36}$/i.test(p.id)) br = (await db.selectFrom('sys_address_history').select('branch_id').where('id', '=', p.id).where('company_id', '=', companyId).executeTakeFirst())?.branch_id ?? null;
  return br ? 'SET.BRANCH' : 'SET.CO';
} });
/** หมายเหตุแฟ้มหลัก: สิทธิ์ตามเมนูของแฟ้ม (สินค้า/ลูกค้า/ผู้จำหน่าย) */
const NOTE_MENU: Record<string, string> = { item: 'IC.ITEM', customer: 'SA.CUS', supplier: 'PU.SUP' };
const MNOTE = (action: Action): Rule => ({ kind: 'menu', menu: 'IC.ITEM', action, pick: async (req) => NOTE_MENU[String((req.params as { entity?: string }).entity)] ?? 'IC.ITEM' });
const LOOKUP: Rule = { kind: 'lookup' }, SELF: Rule = { kind: 'self' }, OPEN: Rule = { kind: 'open' };
/**
 * API เขียนที่ผู้ใช้ดูอย่างเดียวเรียกได้ (HANDOFF 157): บัญชีของตัวเอง/ไม่ต้องเข้าระบบ — ไม่เขียนข้อมูลของบริษัท
 * นอกจากนี้ทุก POST/PUT/PATCH/DELETE ต้องตอบ 403 ให้ผู้ใช้ที่ไม่มีสิทธิ์เพิ่ม/แก้/ยกเลิก/ลบ (ชุดทดสอบเรียกทุกเส้น)
 */
export const VIEWER_OWN_ACCOUNT_ROUTES = [
  'POST /api/v1/setup', 'POST /api/v1/auth/login', 'POST /api/v1/auth/login/totp', 'POST /api/v1/auth/logout', 'POST /api/v1/auth/password', 'POST /api/v1/auth/select',
  'POST /api/v1/auth/2fa/setup', 'POST /api/v1/auth/2fa/enable', 'POST /api/v1/auth/2fa/recovery', 'POST /api/v1/auth/2fa/disable',
  'POST /api/v1/signup', 'POST /api/v1/invite/:token/accept',
  // เครื่องสาขา (ยืนยันด้วยรหัสเครื่อง ไม่ใช่ผู้ใช้) · ตั้งเครื่องสาขาได้เฉพาะเครื่องที่ยังไม่มีข้อมูล · ซิงก์ทันที = ส่ง/ดึงคิวเดิม ไม่สร้างข้อมูลใหม่
  'POST /api/v1/sync/bootstrap', 'POST /api/v1/sync/pull', 'POST /api/v1/sync/push', 'POST /api/v1/sync/setup-branch', 'POST /api/v1/sync/now',
  // เปิดโปรแกรมอื่นจาก Hub (ตรวจสิทธิ์เปิดโปรแกรมของผู้ใช้ในตัว API)
  'POST /api/v1/hub/launch',
  // POST ที่อ่านอย่างเดียว: ตรวจแฟ้มสำรอง (ไม่นำกลับ) · รายงาน (ส่งเงื่อนไขทาง body)
  'POST /api/v1/backup/verify', 'POST /api/v1/rpt/:code/run',
];
/** ตัวอย่างการลงบัญชีก่อนบันทึก: เรียกฟังก์ชันบันทึกจริงใน SAVEPOINT แล้วถอยกลับทั้งหมด (docs/preview.ts) — ไม่มีอะไรถูกบันทึก */
export const POSTING_PREVIEW = /\/posting-preview$/;
export const API_RULES: Record<string, Rule> = {
  'GET /api/v1/health': OPEN, 'GET /api/v1/auth/bot-check': OPEN, 'GET /api/v1/setup/status': OPEN, 'POST /api/v1/setup': OPEN, 'POST /api/v1/auth/login': OPEN, 'POST /api/v1/auth/login/totp': OPEN,
  'GET /api/v1/tenant/security': SELF, 'PUT /api/v1/tenant/security': SELF,
  'GET /api/v1/auth/2fa': SELF, 'POST /api/v1/auth/2fa/setup': SELF, 'POST /api/v1/auth/2fa/enable': SELF, 'POST /api/v1/auth/2fa/recovery': SELF, 'POST /api/v1/auth/2fa/disable': SELF,
  'POST /api/v1/users/:id/unlock': SELF, 'POST /api/v1/users/:id/reset-2fa': SELF,
  // ลิงก์เชิญ (HANDOFF 184): ผู้ดูแลสร้าง/ยกเลิก (ตรวจในตัว API) · หน้าเปิดลิงก์ไม่ต้องเข้าระบบ
  // แพ็กเกจ + การใช้งาน (HANDOFF 185): ลูกค้าเห็นของตัวเอง · แค็ตตาล็อก/ทุกลูกค้า = ผู้ให้บริการ (ตรวจในตัว API · รวมทุกบริษัทของลูกค้า จึงไม่อยู่ใต้ RLS ของบริษัท)
  // อีเมลใบสมัคร (HANDOFF 187): ผู้ให้บริการเท่านั้น (ตรวจในตัว API)
  'GET /api/v1/platform/mail-settings': SELF, 'PUT /api/v1/platform/mail-settings': SELF, 'GET /api/v1/platform/mail-preview': SELF, 'POST /api/v1/signups/:id/mail/:kind': SELF, 'GET /api/v1/platform/signup-settings': SELF, 'PUT /api/v1/platform/signup-settings': SELF,
  // HANDOFF 190: กุญแจ AI ของผู้ให้บริการ (ตรวจ isPlatform ในตัวจัดการ)
  'GET /api/v1/platform/ai-key': SELF, 'PUT /api/v1/platform/ai-key': SELF,
  'GET /api/v1/tenants/:id/features': SELF,
  'GET /api/v1/usage': M('SET.USAGE', 'read'), 'GET /api/v1/usage/alert': SELF, 'GET /api/v1/packages': SELF, 'POST /api/v1/packages': SELF, 'PUT /api/v1/packages/:id': SELF,
  'GET /api/v1/admin/usage': SELF, 'GET /api/v1/admin/usage/:tenantId': SELF,
  'POST /api/v1/users/:id/invite': SELF, 'DELETE /api/v1/users/:id/invite': SELF, 'GET /api/v1/invite/:token': OPEN, 'POST /api/v1/invite/:token/accept': OPEN,
  // T0.12 นำข้อมูลจาก Express (ผู้ดูแลระบบ — ตรวจในตัว API)
  'POST /api/v1/express-import/jobs': SELF, 'PUT /api/v1/express-import/jobs/:id/files/:name': SELF, 'POST /api/v1/express-import/jobs/:id/run': SELF,
  'GET /api/v1/express-import/jobs/:id': SELF, 'DELETE /api/v1/express-import/jobs/:id': SELF, 'GET /api/v1/express-import/files': SELF,
  'GET /api/v1/menu': SELF, 'GET /api/v1/auth/me': SELF, 'POST /api/v1/auth/logout': SELF, 'POST /api/v1/auth/password': SELF, 'POST /api/v1/auth/select': SELF,
  'GET /api/v1/ai/status': LOOKUP, 'GET /api/v1/ai/config': M('SET.AI', 'read'), 'PUT /api/v1/ai/config': M('SET.AI', 'edit'), 'GET /api/v1/ai/usage': M('SET.AI', 'read'),
  'POST /api/v1/ai/read-bill': { kind: 'menu', menu: 'PU.RR', action: 'add', pick: async (req) => AI_BILL_TARGETS.find((k) => k.path === (req.body as { target?: string } | undefined)?.target)?.menu ?? 'PU.RR' },
  'POST /api/v1/ai/central-supplier': { kind: 'menu', menu: 'PU.RR', action: 'add', pick: async (req) => AI_BILL_TARGETS.find((k) => k.party === 'supplier' && k.path === (req.body as { target?: string } | undefined)?.target)?.menu ?? 'PU.RR' },
  'GET /api/v1/payers': LOOKUP, 'GET /api/v1/docs/:id/substitute-receipt': LOOKUP,
  'POST /api/v1/ai/read-bill-text': { kind: 'menu', menu: 'PU.RR', action: 'add', pick: async (req) => AI_BILL_TARGETS.find((k) => k.path === (req.body as { target?: string } | undefined)?.target)?.menu ?? 'PU.RR' },
  'GET /api/v1/etax/docs': M('FI.VAT.ETAX', 'read'), 'GET /api/v1/etax/doc/:id': M('FI.VAT.ETAX', 'print'), 'GET /api/v1/etax/export': M('FI.VAT.ETAX', 'print'),
  'GET /api/v1/api-keys': M('SET.API', 'read'), 'POST /api/v1/api-keys': M('SET.API', 'add'), 'POST /api/v1/api-keys/:id/revoke': M('SET.API', 'cancel'), 'PUT /api/v1/api-keys/:id/scope': M('SET.API', 'edit'), 'GET /api/v1/api-docs': M('SET.API', 'read'),
  'GET /api/v1/users': SELF, 'POST /api/v1/users': SELF, 'PUT /api/v1/users/:id': SELF, 'POST /api/v1/user-groups': SELF, 'PUT /api/v1/user-groups/:id': SELF, 'DELETE /api/v1/user-groups/:id': SELF,
  // สมัครใช้งานเอง: หน้าสมัครไม่ต้องเข้าระบบ · พิจารณาใบสมัคร = เจ้าหน้าที่ผู้ให้บริการ (ตรวจในตัว API)
  // ชื่อภาษาอังกฤษของข้อมูลบริษัทนี้ (โหมด EN)
  'GET /api/v1/i18n/names': LOOKUP,
  'GET /api/v1/signup/config': OPEN, 'POST /api/v1/signup': OPEN, 'GET /api/v1/signups': SELF, 'POST /api/v1/signups/:id/approve': SELF, 'POST /api/v1/signups/:id/reject': SELF,
  'GET /api/v1/tenants': SELF, 'POST /api/v1/tenants': SELF, 'PUT /api/v1/tenants/:id': SELF, 'POST /api/v1/tenants/:id/purge': SELF, 'POST /api/v1/tenants/:id/viewers': SELF, 'POST /api/v1/tenants/:id/standard-groups': SELF, 'POST /api/v1/tenants/:id/move-companies/preview': SELF, 'POST /api/v1/tenants/:id/move-companies': SELF, 'POST /api/v1/tenants/:id/export': SELF, 'POST /api/v1/tenants/import': SELF, 'POST /api/v1/companies': SELF,
  // T7.8 ออฟไลน์สาขา: เครื่องสาขา (ผู้ดูแลบริษัท) · API ของเครื่องสาขายืนยันด้วยรหัสเครื่อง (OPEN + ตรวจในตัว) · สถานะ/ส่งใหม่ของเครื่องสาขา (SELF)
  'GET /api/v1/devices': M('SET.DEVICE', 'read'), 'POST /api/v1/devices': M('SET.DEVICE', 'add'), 'POST /api/v1/devices/:id/new-code': M('SET.DEVICE', 'edit'),
  'POST /api/v1/devices/:id/suspend': M('SET.DEVICE', 'cancel'), 'GET /api/v1/devices/:id/conflicts': M('SET.DEVICE', 'read'),
  'POST /api/v1/sync/bootstrap': OPEN, 'POST /api/v1/sync/push': OPEN, 'POST /api/v1/sync/pull': OPEN, 'POST /api/v1/sync/setup-branch': OPEN,
  'GET /api/v1/sync/status': SELF, 'POST /api/v1/sync/now': SELF, 'POST /api/v1/sync/outbox/:id/retry': SELF, 'POST /api/v1/sync/outbox/:id/discard': SELF,
  'GET /api/v1/pdpa/register': M('SET.PDPA', 'read'), 'GET /api/v1/pdpa/subjects': M('SET.PDPA', 'read'), 'GET /api/v1/pdpa/subjects/:kind/:id': M('SET.PDPA', 'read'),
  'POST /api/v1/pdpa/subjects/:kind/:id/access': M('SET.PDPA', 'print'), 'POST /api/v1/pdpa/subjects/:kind/:id/erase': M('SET.PDPA', 'delete'),
  'GET /api/v1/pdpa/requests': M('SET.PDPA', 'read'), 'POST /api/v1/pdpa/requests': M('SET.PDPA', 'add'), 'PUT /api/v1/pdpa/requests/:id': M('SET.PDPA', 'edit'),
  'GET /api/v1/activity-log': LOOKUP, 'GET /api/v1/activity-log/search': M('OT.LOG', 'read'),
  // บริษัท สาขา แผนก รอบบัญชี
  'GET /api/v1/company': LOOKUP, 'GET /api/v1/company/starter-data': M('SET.CO', 'read'), 'POST /api/v1/company/starter-data': M('SET.CO', 'edit'), 'PUT /api/v1/company': M('SET.CO', 'edit'), 'PUT /api/v1/company/ui-theme': M('SET.CO', 'edit'), 'GET /api/v1/company/modules': LOOKUP, 'PUT /api/v1/company/modules': M('SET.CO', 'edit'),
  'GET /api/v1/company/addresses': LOOKUP, 'GET /api/v1/company/address-at': LOOKUP, 'POST /api/v1/company/addresses': ADDR('edit'), 'PUT /api/v1/company/addresses/:id': ADDR('edit'), 'DELETE /api/v1/company/addresses/:id': ADDR('edit'),
  'GET /api/v1/branches': LOOKUP, 'POST /api/v1/branches': M('SET.BRANCH', 'add'), 'PUT /api/v1/branches/:id': M('SET.BRANCH', 'edit'),
  'GET /api/v1/projects/options': LOOKUP, 'GET /api/v1/projects': M('GL.JOB', 'read'), 'GET /api/v1/projects/:id': M('GL.JOB', 'read'), 'POST /api/v1/projects': M('GL.JOB', 'add'), 'PUT /api/v1/projects/:id': M('GL.JOB', 'edit'), 'DELETE /api/v1/projects/:id': M('GL.JOB', 'delete'),
  'GET /api/v1/reports/jobs': M('RP.JOB', 'read'), 'GET /api/v1/reports/jobs/:id': M('RP.JOB', 'read'),
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
  'GET /api/v1/fs/run': M('RP.FS', 'read'), 'GET /api/v1/dashboard': M('RP.DASH', 'read'),
  'GET /api/v1/reports/trial-balance': M('RP.TB', 'read'), 'GET /api/v1/reports/ledger': M('RP.LEDGER', 'read'), 'GET /api/v1/reports/ledgers': M('RP.LEDGER', 'read'),
  'GET /api/v1/reports/journal-book': M('RP.JNL', 'read'), 'GET /api/v1/reports/account-detail': M('RP.DETAIL', 'read'),
  // ค่าเริ่มต้นแต่ละระบบ (บทที่ 5)
  'GET /api/v1/settings': LOOKUP, 'PUT /api/v1/settings': M('SET.DEF', 'edit'),
  'GET /api/v1/lookups': LOOKUP,
  'GET /api/v1/customers/:id/activity': M('SA.CUS', 'read'), 'GET /api/v1/suppliers/:id/activity': M('PU.SUP', 'read'),
  'GET /api/v1/customers-labels': M('SA.CUS', 'print'), 'GET /api/v1/suppliers-labels': M('PU.SUP', 'print'),
  'GET /api/v1/customers': LOOKUP, 'GET /api/v1/customers/:id': LOOKUP, 'POST /api/v1/customers': M('SA.CUS', 'add'),
  'PUT /api/v1/customers/:id': M('SA.CUS', 'edit'), 'DELETE /api/v1/customers/:id': M('SA.CUS', 'delete'),
  'GET /api/v1/suppliers': LOOKUP, 'GET /api/v1/suppliers/next-code': LOOKUP, 'GET /api/v1/suppliers/:id': LOOKUP, 'POST /api/v1/suppliers': M('PU.SUP', 'add'), 'POST /api/v1/suppliers/:id/branches': M('PU.SUP', 'edit'),
  'PUT /api/v1/suppliers/:id': M('PU.SUP', 'edit'), 'DELETE /api/v1/suppliers/:id': M('PU.SUP', 'delete'),
  'GET /api/v1/item-account-groups': LOOKUP, 'POST /api/v1/item-account-groups': M('SET.IAG', 'add'),
  'PUT /api/v1/item-account-groups/:id': M('SET.IAG', 'edit'), 'DELETE /api/v1/item-account-groups/:id': M('SET.IAG', 'delete'),
  ...Object.fromEntries(Object.values(ITEM_KINDS).flatMap((k) => [
    [`GET /api/v1/${k.path}`, LOOKUP], [`GET /api/v1/${k.path}/:id`, LOOKUP], [`POST /api/v1/${k.path}`, M(k.menu, 'add')],
    [`PUT /api/v1/${k.path}/:id`, M(k.menu, 'edit')], [`DELETE /api/v1/${k.path}/:id`, M(k.menu, 'delete')],
    // รูปภาพสินค้า (ข้อกำหนดเจ้าของ): ดูได้ทุกคนที่เห็นรหัส · เพิ่ม/ลบ/ตั้งรูปหลัก = สิทธิ์แก้ไขเมนูนั้น
    [`GET /api/v1/${k.path}/:id/images`, LOOKUP], [`POST /api/v1/${k.path}/:id/images`, M(k.menu, 'edit')],
    [`PUT /api/v1/${k.path}/:id/images/:imageId/main`, M(k.menu, 'edit')], [`DELETE /api/v1/${k.path}/:id/images/:imageId`, M(k.menu, 'edit')],
  ])),
  'GET /api/v1/item-images/:imageId': LOOKUP,
  // นำเข้ารายการขาย/ซื้อจาก Excel: สิทธิ์เมนูนำเข้า + (ตรวจในคำขอ) สิทธิ์เพิ่มเอกสารชนิดนั้น
  'GET /api/v1/gl/journal-import/template': M('GL.JNL', 'read'), 'POST /api/v1/gl/journal-import': M('GL.JNL', 'add'),
  'GET /api/v1/trade-import/:path/template': M('OT.IMPTRADE', 'read'), 'POST /api/v1/trade-import/:path': M('OT.IMPTRADE', 'add'),
  // นำเข้าเอกสารอื่นที่ลงบัญชี (HANDOFF 171): สิทธิ์นำเข้า + สิทธิ์เพิ่มที่เมนูของเอกสารนั้น (ตรวจใน route)
  // ลบ/กู้คืนบริษัท (HANDOFF 175): ตรวจผู้ดูแลของลูกค้า/เจ้าหน้าที่ผู้ให้บริการใน route
  // HANDOFF 201: เมนู บริษัททั้งหมด / ลบบริษัท (SET.COS) — SELF เพราะทำข้ามบริษัทของลูกค้า (ไม่อยู่ในขอบเขตบริษัทเดียว/RLS) · ตัวจัดการตรวจ manager() = เฉพาะผู้ดูแลระบบ + decide(SET.COS)
  'GET /api/v1/companies/manage': SELF, 'PUT /api/v1/companies/:id/code': SELF, 'POST /api/v1/companies/:id/copy': SELF, 'POST /api/v1/companies/:id/delete': SELF, 'POST /api/v1/companies/:id/restore': SELF,
  'GET /api/v1/doc-import/:path/template': M('OT.IMPTRADE', 'read'), 'POST /api/v1/doc-import/:path': M('OT.IMPTRADE', 'add'),
  // นำเข้าข้อมูลหลัก (HANDOFF 173): สิทธิ์นำเข้า + เพิ่ม (และแก้เมื่อติ๊ก) ที่เมนูของแฟ้มนั้น (ตรวจใน route)
  'GET /api/v1/master-import/:path/template': M('OT.IMPTRADE', 'read'), 'POST /api/v1/master-import/:path': M('OT.IMPTRADE', 'add'),
  // ให้ AI จัดรูปแบบ Excel (HANDOFF 168): ใบสำคัญ = สิทธิ์เพิ่มใบสำคัญ · ขาย/ซื้อ/ค่าใช้จ่าย = นำเข้ารายการขาย/ซื้อ (ตัวจัดการตรวจสิทธิ์เพิ่มเอกสารชนิดนั้นด้วย)
  ...Object.fromEntries(['analyze', 'ai', 'save', 'suggest'].map((x) => [`POST /api/v1/import-map/${x}`, { kind: 'menu', menu: 'OT.IMPTRADE', action: 'add', pick: async (req) => ((req.body as { target?: string } | undefined)?.target === 'journal' ? 'GL.JNL' : 'OT.IMPTRADE') } as Rule])),
  'POST /api/v1/kits/:id/copy': M('IC.KIT', 'add'),
  'GET /api/v1/items/:id/prices': M('IC.PRICE', 'read'), 'PUT /api/v1/items/:id/prices': M('IC.PRICE', 'edit'),
  'GET /api/v1/items/:id/reorder': M('IC.REORDER', 'read'), 'PUT /api/v1/items/:id/reorder': M('IC.REORDER', 'edit'),
  'GET /api/v1/bank-accounts': LOOKUP, 'POST /api/v1/bank-accounts': M('FI.BK.ACC', 'add'), 'PUT /api/v1/bank-accounts/:id': M('FI.BK.ACC', 'edit'), 'DELETE /api/v1/bank-accounts/:id': M('FI.BK.ACC', 'delete'),
  'GET /api/v1/payment-methods/:direction': LOOKUP, 'PUT /api/v1/payment-methods/:direction': M('SET.PAYM', 'edit'), 'POST /api/v1/payment-methods/:direction': M('SET.PAYM', 'add'),
  'GET /api/v1/doc-types': LOOKUP, 'GET /api/v1/doc-types/:id': LOOKUP, 'POST /api/v1/doc-types': M('SET.DOCNO', 'add'),
  'PUT /api/v1/doc-types/:id': M('SET.DOCNO', 'edit'), 'DELETE /api/v1/doc-types/:id': M('SET.DOCNO', 'delete'),
  'GET /api/v1/gl/link': M('SET.LINK', 'read'), 'PUT /api/v1/gl/link': M('SET.LINK', 'edit'),
  'GET /api/v1/data-tables': LOOKUP, 'GET /api/v1/data-tables/:code': LOOKUP, 'PUT /api/v1/data-tables/:code': M('SET.TBL', 'edit'), 'POST /api/v1/data-tables/:code/rows': M('SET.TBL', 'add'),
  'GET /api/v1/tools/year-fix': M('SET.YEARFIX', 'read'), 'POST /api/v1/tools/year-fix': M('SET.YEARFIX', 'edit'),
  'GET /api/v1/docs/repost-candidates': M('SET.LINK', 'read'), 'POST /api/v1/docs/repost-batch': M('SET.LINK', 'edit'),
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
    [`GET /api/v1/${k.path}/bills`, M(k.menu, 'read')], ...(k.cls === 'RE' ? [[`GET /api/v1/${k.path}/charge-template`, M(k.menu, 'read')]] : []),
  ])),
  ...Object.fromEntries(CASH_KINDS.flatMap((k) => [
    [`GET /api/v1/${k.path}`, M(k.menu, 'read')], [`GET /api/v1/${k.path}/:id`, M(k.menu, 'read')], [`POST /api/v1/${k.path}`, M(k.menu, 'add')],
    [`PUT /api/v1/${k.path}/:id`, M(k.menu, 'edit')], [`POST /api/v1/${k.path}/:id/cancel`, M(k.menu, 'cancel')],
  ])),
  'GET /api/v1/deposits/open': LOOKUP,
  // คืนเงินมัดจำ (05/11/2569)
  [`GET /api/v1/${DEPOSIT_REFUND.path}`]: M(DEPOSIT_REFUND.menu, 'read'), [`GET /api/v1/${DEPOSIT_REFUND.path}/:id`]: M(DEPOSIT_REFUND.menu, 'read'), [`POST /api/v1/${DEPOSIT_REFUND.path}`]: M(DEPOSIT_REFUND.menu, 'add'),
  [`PUT /api/v1/${DEPOSIT_REFUND.path}/:id`]: M(DEPOSIT_REFUND.menu, 'edit'), [`POST /api/v1/${DEPOSIT_REFUND.path}/:id/cancel`]: M(DEPOSIT_REFUND.menu, 'cancel'),
  [`POST /api/v1/${DEPOSIT_REFUND.path}/posting-preview`]: M(DEPOSIT_REFUND.menu, 'read'),
  ...Object.fromEntries(BILL_KINDS.flatMap((k) => [
    [`GET /api/v1/${k.path}`, M(k.menu, 'read')], [`GET /api/v1/${k.path}/open-items`, M(k.menu, 'read')], [`GET /api/v1/${k.path}/:id`, M(k.menu, 'read')],
    [`POST /api/v1/${k.path}`, M(k.menu, 'add')], [`PUT /api/v1/${k.path}/:id`, M(k.menu, 'edit')], [`POST /api/v1/${k.path}/:id/cancel`, M(k.menu, 'cancel')],
    [`POST /api/v1/${k.path}/:id/appointment`, M(k.module === 'AR' ? 'FI.AR.BD' : 'FI.AP.BD', 'edit')],
  ])),
  'POST /api/v1/quotations/:id/convert': M('SA.SO', 'add'),
  // ลูกหนี้/เจ้าหนี้คงค้างยกมา (S-OB-03/04)
  // เงินมัดจำยกมา: เมนูของตัวเอง FI.AR.DOB (HANDOFF ข้อ 91 — เดิมใช้ FI.AR.OB)
  ...Object.fromEntries([['ar-opening', 'FI.AR.OB'], ['ap-opening', 'FI.AP.OB'], ['ar-deposit-opening', 'FI.AR.DOB']].flatMap(([p, m]) => [
    [`GET /api/v1/${p}`, M(m!, 'read')], [`GET /api/v1/${p}/:id`, M(m!, 'read')], [`POST /api/v1/${p}`, M(m!, 'add')],
    [`PUT /api/v1/${p}/:id`, M(m!, 'edit')], [`POST /api/v1/${p}/:id/cancel`, M(m!, 'cancel')], [`POST /api/v1/${p}/posting-preview`, M(m!, 'read')],
  ])),
  // เงินสดย่อย (บทที่ 15)
  // ตัวอย่างการลงบัญชีก่อนบันทึก: ไม่บันทึกอะไร (ย้อนกลับทั้งหมด) → สิทธิ์อ่านของเมนูเอกสาร
  ...Object.fromEntries([...TRADE_KINDS, ...SETTLE_KINDS, ...CASH_KINDS].map((k) => [`POST /api/v1/${k.path}/posting-preview`, M(k.menu, 'read')])),
  ...Object.fromEntries(STOCK_KINDS.map((k) => [`POST /api/v1/${k.path}/posting-preview`, M('IC.TRN', 'read')])),
  ...Object.fromEntries(BANK_KINDS.map((k) => [`POST /api/v1/${k.path}/posting-preview`, M('FI.BK.TX', 'read')])),
  'POST /api/v1/petty-payments/posting-preview': M('GL.PC', 'read'), 'POST /api/v1/petty-reimbursements/posting-preview': M('GL.PC', 'read'),
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
  'GET /api/v1/stock/lots': M('IC.TRN', 'read'), 'GET /api/v1/stock/production-costs': M('IC.TRN', 'read'),
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
  'GET /api/v1/notes/:kind/:id': DOC('read'), 'PUT /api/v1/notes/:kind/:id': DOC('edit'), 'GET /api/v1/doc-status/:kind/:id': DOC('read'), 'PUT /api/v1/doc-status/:kind/:id': DOC('edit'),
  'GET /api/v1/master-notes/:entity/:id': MNOTE('read'), 'PUT /api/v1/master-notes/:entity/:id': MNOTE('edit'),
  'GET /api/v1/docs/:id/print': DOC('print'), 'GET /api/v1/print/:kind/:id': DOC('read'), 'GET /api/v1/neighbors/:kind/:id': DOC('read'), 'GET /api/v1/locate/:kind/:id': DOC('read'), 'POST /api/v1/docs/:kind/:id/delete': DOC('delete'), 'PUT /api/v1/docs/:kind/:id/wht-cert': DOC('edit'), 'POST /api/v1/print/:kind/:id/printed': DOC('print'),
  'POST /api/v1/approve/:kind/:id': DOC('approve'), 'POST /api/v1/approve-range': DOC('approve'), 'GET /api/v1/record-info/:kind/:id': DOC('read'),
  'GET /api/v1/company-images': LOOKUP, 'PUT /api/v1/company-images/logo': M('RP.FORM', 'edit'), 'POST /api/v1/company-images/signs': M('RP.FORM', 'add'), 'DELETE /api/v1/company-images/:id': M('RP.FORM', 'delete'),
  'GET /api/v1/print-forms': LOOKUP, 'PUT /api/v1/print-forms/:scope/:slot': M('RP.FORM', 'edit'), 'DELETE /api/v1/print-forms/:scope/:slot': M('RP.FORM', 'delete'),
  'GET /api/v1/rpt-custom': LOOKUP, 'POST /api/v1/rpt-custom': M('RP.CUSTOM', 'add'), 'PUT /api/v1/rpt-custom/:id': M('RP.CUSTOM', 'edit'), 'DELETE /api/v1/rpt-custom/:id': M('RP.CUSTOM', 'delete'),
  // ทรัพย์สินถาวร (บทที่ 19) + กลุ่มบัญชีทรัพย์สิน (S-SET-12)
  'GET /api/v1/asset-account-groups': LOOKUP, 'POST /api/v1/asset-account-groups': M('SET.FAG', 'add'), 'PUT /api/v1/asset-account-groups/:id': M('SET.FAG', 'edit'), 'DELETE /api/v1/asset-account-groups/:id': M('SET.FAG', 'delete'),
  'GET /api/v1/fa/assets': M('FA.ASSET', 'read'), 'GET /api/v1/fa/assets/:id': M('FA.ASSET', 'read'), 'POST /api/v1/fa/assets': M('FA.ASSET', 'add'), 'PUT /api/v1/fa/assets/:id': M('FA.ASSET', 'edit'),
  'POST /api/v1/fa/assets/:id/recode': M('FA.ASSET', 'edit'), 'DELETE /api/v1/fa/assets/:id': M('FA.ASSET', 'delete'),
  'POST /api/v1/fa/assets/:id/sell': M('FA.ASSET', 'edit'), 'POST /api/v1/fa/assets/:id/unsell': M('FA.ASSET', 'cancel'),
  // ระบบเงินเดือน (ข้อมูลลับ — ระดับ 5 ขึ้นไป ดู PAYROLL)
  'GET /api/v1/pay/law': M('PAY.LAW', 'read'), 'PUT /api/v1/pay/law/tax/:year': M('PAY.LAW', 'edit'), 'DELETE /api/v1/pay/law/tax/:year': M('PAY.LAW', 'delete'),
  'PUT /api/v1/pay/law/sso': M('PAY.LAW', 'edit'), 'DELETE /api/v1/pay/law/sso/:date': M('PAY.LAW', 'delete'),
  'GET /api/v1/pay/items': LOOKUP, 'POST /api/v1/pay/items': M('PAY.ITEM', 'add'), 'PUT /api/v1/pay/items/:id': M('PAY.ITEM', 'edit'), 'DELETE /api/v1/pay/items/:id': M('PAY.ITEM', 'delete'),
  'GET /api/v1/pay/employees': M('PAY.EMP', 'read'), 'GET /api/v1/pay/employees/:id': M('PAY.EMP', 'read'), 'POST /api/v1/pay/employees': M('PAY.EMP', 'add'),
  'PUT /api/v1/pay/employees/:id': M('PAY.EMP', 'edit'), 'DELETE /api/v1/pay/employees/:id': M('PAY.EMP', 'delete'), 'POST /api/v1/pay/employees/:id/reveal': M('PAY.EMP', 'edit'),
  'POST /api/v1/pay/employees/:id/salary': M('PAY.EMP', 'edit'), 'DELETE /api/v1/pay/employees/:id/salary/:sid': M('PAY.EMP', 'edit'),
  'GET /api/v1/pay/employees/:id/allowances/:year': M('PAY.EMP', 'read'), 'PUT /api/v1/pay/employees/:id/allowances/:year': M('PAY.EMP', 'edit'),
  'PUT /api/v1/pay/employees/:id/ytd/:year': M('PAY.EMP', 'edit'), 'DELETE /api/v1/pay/employees/:id/ytd/:year': M('PAY.EMP', 'edit'),
  'POST /api/v1/pay/employees/:id/recurring': M('PAY.EMP', 'edit'), 'PUT /api/v1/pay/employees/:id/recurring/:rid': M('PAY.EMP', 'edit'), 'DELETE /api/v1/pay/employees/:id/recurring/:rid': M('PAY.EMP', 'edit'),
  'GET /api/v1/pay/runs': M('PAY.RUN', 'read'), 'GET /api/v1/pay/runs/:id': M('PAY.RUN', 'read'), 'POST /api/v1/pay/runs': M('PAY.RUN', 'add'), 'PUT /api/v1/pay/runs/:id': M('PAY.RUN', 'edit'),
  'POST /api/v1/pay/runs/:id/calculate': M('PAY.RUN', 'edit'), 'POST /api/v1/pay/runs/:id/employees': M('PAY.RUN', 'edit'), 'DELETE /api/v1/pay/runs/:id/employees/:reId': M('PAY.RUN', 'edit'),
  'PUT /api/v1/pay/runs/:id/employees/:reId': M('PAY.RUN', 'edit'), 'GET /api/v1/pay/runs/:id/posting-preview': M('PAY.RUN', 'read'), 'POST /api/v1/pay/runs/:id/post': M('PAY.RUN', 'edit'),
  'POST /api/v1/pay/runs/:id/reopen': M('PAY.RUN', 'edit'), 'POST /api/v1/pay/runs/:id/pay': M('PAY.RUN', 'edit'), 'POST /api/v1/pay/runs/:id/unpay': M('PAY.RUN', 'cancel'),
  'POST /api/v1/pay/runs/:id/cancel': M('PAY.RUN', 'cancel'), 'DELETE /api/v1/pay/runs/:id': M('PAY.RUN', 'delete'),
  'POST /api/v1/pay/default-accounts': M('SET.LINK', 'edit'),
  'GET /api/v1/pay/runs/:id/slips': M('PAY.RUN', 'print'), 'POST /api/v1/pay/runs/:id/slips/printed': M('PAY.RUN', 'print'),
  'GET /api/v1/pay/pnd1': M('PAY.TAX', 'read'), 'GET /api/v1/pay/pnd1a': M('PAY.TAX', 'read'), 'GET /api/v1/pay/sso': M('PAY.TAX', 'read'),
  'GET /api/v1/pay/w50': M('PAY.TAX', 'read'), 'POST /api/v1/pay/w50/issue': M('PAY.TAX', 'add'), 'POST /api/v1/pay/w50/printed': M('PAY.TAX', 'print'),
  'GET /api/v1/pay/pnd1/rdprep': M('PAY.TAX', 'print'), 'GET /api/v1/pay/pnd1a/rdprep': M('PAY.TAX', 'print'), 'GET /api/v1/pay/pnd1/efiling': M('PAY.TAX', 'print'), 'GET /api/v1/pay/pnd1a/efiling': M('PAY.TAX', 'print'),
  'GET /api/v1/pay/sso/file': M('PAY.TAX', 'print'), 'GET /api/v1/pay/runs/:id/bank-file': M('PAY.RUN', 'print'),
  'GET /api/v1/pay/employees/import/template': M('PAY.EMP', 'add'), 'POST /api/v1/pay/employees/import': M('PAY.EMP', 'add'),
  'GET /api/v1/pay/runs/:id/import/template': M('PAY.RUN', 'edit'), 'POST /api/v1/pay/runs/:id/import': M('PAY.RUN', 'edit'),
  'GET /api/v1/pay/filings': M('PAY.TAX', 'read'), 'GET /api/v1/pay/filings/due': M('PAY.TAX', 'read'), 'POST /api/v1/pay/filings': M('PAY.TAX', 'add'), 'POST /api/v1/pay/filings/:id/cancel': M('PAY.TAX', 'cancel'),
  'GET /api/v1/pay/reports/register': M('PAY.RPT', 'read'), 'GET /api/v1/pay/reports/yearly': M('PAY.RPT', 'read'), 'GET /api/v1/pay/reports/cost': M('PAY.RPT', 'read'),
  'POST /api/v1/backup/company': M('OT.BACKUP', 'add'), 'POST /api/v1/backup/verify': M('OT.BACKUP', 'read'), 'POST /api/v1/backup/restore': M('OT.BACKUP', 'edit'),
  'POST /api/v1/backup/users': M('SET.SEC', 'read'), 'POST /api/v1/backup/users/restore': M('SET.SEC', 'edit'),
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
  'PUT /api/v1/wht/:id': M('FI.WHT', 'edit'), 'POST /api/v1/wht/:id/cancel': M('FI.WHT', 'cancel'), 'POST /api/v1/wht/:id/printed': M('FI.WHT.CERT', 'print'),
  // WTS Connect ฟีดข้อมูลหลักที่เปลี่ยน (docs/17 B0.3) — ข้อมูลเดียวกับหน้าต่างค้นหา
  'GET /api/v1/changes': LOOKUP,
  // WTS Solutions (docs/17 B0.5): คิดเงินเดือนที่ไหน · ตั้งค่าสำหรับ WTS-POS
  'PUT /api/v1/company/payroll-source': M('SET.CO', 'edit'), 'POST /api/v1/company/wts-pos-setup': M('SET.CO', 'edit'),
  // ตั้งค่าสำหรับ WTS-Living (HANDOFF ข้อ 86): ผู้ดูแลระบบเท่านั้น (ตรวจเพิ่มใน wts-living.ts)
  'GET /api/v1/company/wts-living-setup': M('SET.CO', 'read'), 'POST /api/v1/company/wts-living-setup': M('SET.CO', 'edit'),
  // สิทธิ์โมดูลระดับลูกค้า (docs/17 B0.6): ลูกค้าดูของตัวเอง · เจ้าหน้าที่ผู้ให้บริการตั้งค่า (ตรวจในตัวจัดการ)
  'GET /api/v1/tenant/modules': SELF, 'GET /api/v1/tenants/:id/modules': SELF, 'PUT /api/v1/tenants/:id/modules': SELF,
  // Hub + ล็อกอินกลาง (docs/17 B6): ไทล์/ออกบัตรผ่านของผู้ใช้เอง (ตรวจสิทธิ์โมดูลในตัวจัดการ) · กุญแจสาธารณะเปิดให้ทุกคน · โปรแกรมอื่นรายงานคิวด้วยกุญแจ API ของบริษัท
  'GET /api/v1/hub': SELF, 'POST /api/v1/hub/launch': SELF, 'GET /api/v1/sso/jwks': OPEN, 'PUT /api/v1/source-status': LOOKUP,
  'GET /api/v1/salespersons': LOOKUP, 'GET /api/v1/salespersons/:id': LOOKUP, 'POST /api/v1/salespersons': M('SA.SLM', 'add'),
  'PUT /api/v1/salespersons/:id': M('SA.SLM', 'edit'), 'DELETE /api/v1/salespersons/:id': M('SA.SLM', 'delete'),
  // ระบบความปลอดภัย (S-SEC-01/02/03)
  'GET /api/v1/permissions/menus': M('SET.SEC', 'read'), 'GET /api/v1/permissions': M('SET.SEC', 'read'),
  'GET /api/v1/permissions/by-menu': M('SET.SEC', 'read'), 'GET /api/v1/permissions/level-uses': M('SET.SEC', 'read'), 'PUT /api/v1/permissions': M('SET.SEC', 'edit'),
  // คัดลอกสิทธิ์ไปบริษัทอื่นของลูกค้าเดียวกัน (HANDOFF 197): เขียนข้ามบริษัท จึงไม่อยู่ใต้ RLS ของบริษัทเดียว — ตรวจสิทธิ์แก้สิทธิ์ผู้ใช้ทั้งต้นทางและปลายทางในตัว API
  'POST /api/v1/permissions/copy/preview': SELF, 'POST /api/v1/permissions/copy': SELF,
  // กลุ่มตั้งต้นของลูกค้า (HANDOFF 197): ผู้ดูแลของลูกค้าเพิ่มเองได้ (ตรวจในตัว API)
  'POST /api/v1/user-groups/standard': SELF,
};

/** API ที่ลงทะเบียนแล้วทั้งหมด (ชุดทดสอบใช้ตรวจว่าทุกเส้นมีกฎสิทธิ์) */
export const REGISTERED_ROUTES = new Set<string>();

/**
 * ตรวจสิทธิ์ทุกคำขอ API ตามกฎด้านบน (หลังตรวจการเข้าระบบ) — ต้องเรียกก่อนลงทะเบียน API
 * rls = true: API ข้อมูลบริษัท (menu/lookup) ทำงานทั้งคำขอในขอบเขต Row-Level Security ของบริษัทที่เลือก (T0.14)
 */
export function attachPermissions(app: FastifyInstance, database: Database, rls: boolean) {
  const db = database.db;
  /** ตัวจัดการเดิมของ API ข้อมูลบริษัท — ส่งซ้ำรุ่นสูงกว่า (source.ts) เรียก PUT …/:id ในทรานแซกชันเดียวกัน */
  const handlers = new Map<string, { handler: (req: FastifyRequest, reply: import('fastify').FastifyReply) => unknown; self: unknown }>();
  app.addHook('onRoute', (r) => {
    if (!r.url.startsWith('/api/')) return;
    const methods = [r.method].flat().filter((m) => m !== 'HEAD');
    for (const m of methods) REGISTERED_ROUTES.add(`${m} ${r.url}`);
    const rule = API_RULES[`${methods[0]} ${r.url}`];
    if (!rule || (rule.kind !== 'menu' && rule.kind !== 'lookup')) return;
    // ไม่มี RLS: คำขอข้อมูลบริษัทยังทำในทรานแซกชันเดียว (ออฟไลน์สาขาต้องจดรหัสแถว/คิวรอส่งพร้อมเอกสาร) แต่ไม่สลับ role
    const handler = r.handler;
    const routeKey = `${methods[0]} ${r.url}`;
    handlers.set(routeKey, { handler: handler as never, self: app });
    r.handler = function (this: FastifyInstance, req, reply) {
      const a = req.auth;
      if (!a?.companyId) return handler.call(this, req, reply);
      // WTS Connect (docs/17 B0.1): เอกสารจากระบบอื่น ส่งซ้ำไม่ลงซ้ำ + แก้ที่หน้าจอไม่ได้
      const run = () => runInCompanyScope(database, { companyId: a.companyId!, tenantId: a.tenantId, isPlatform: a.isPlatform, rls },
        async () => withSource(database, req, reply, routeKey, () => withVersion(db, r.url, req, reply, a.companyId!, () => handler.call(this, req, reply)), handlers, authorize));
      // ออฟไลน์สาขา (T7.8): สำนักงานใหญ่รับเอกสารจากสาขา (replay) / เครื่องสาขาจดเอกสารลงคิว (capture)
      const rk = req.headers['x-buddy-replay'];
      const replay = typeof rk === 'string' ? replays.get(rk) : undefined;
      const branch = branchStateOf(database);
      // งานที่ต้องทำหลังทรานแซกชันของคำขอ commit แล้ว (ใช้การเชื่อมต่ออื่น เช่น execScript) — ตั้งด้วย afterCommit(req, fn) · คำขอล้ม = ไม่ทำ
      const finish = async (p: unknown) => { const out = await p; const after = (req as { afterCommit?: () => Promise<void> }).afterCommit; if (after) await after(); return out; };
      if (!branch && !replay) return finish(run());
      const capture = branch ? branchCapture(database, req, routeKey) ?? undefined : undefined;
      return finish(syncCtx.run({ ...syncCtx.getStore(), ...(replay ? { replay } : {}), ...(branch ? { branch } : {}), capture }, run));
    };
  });
  app.addHook('preHandler', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    const url = req.routeOptions?.url;
    if (!url) return;   // ไม่พบ API — ตัวจัดการ 404 ตอบเอง
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    await authorize(req, method, url);
  });
  /** ตรวจสิทธิ์ของ API หนึ่งเส้น (preHandler · และ PUT ที่ส่งซ้ำรุ่นสูงกว่าเรียกแทน POST) */
  async function authorize(req: FastifyRequest, method: string, url: string) {
    const rule = API_RULES[`${method} ${url}`];
    if (!rule) throw forbidden('API นี้ยังไม่ได้กำหนดสิทธิ์ — แจ้งผู้พัฒนาโปรแกรม');
    checkMfaGate(req, method, url);
    checkBranchWrite(database, method, url);
    if (rule.kind === 'open') return;
    if (rule.kind === 'self') { if (req.auth) checkApiKeyRule(req.auth, method, url, 'self', null); return; }
    const a = requireCompany(req);
    if (rule.kind === 'lookup') {
      if (hubOnly(a.apps, a.isAdmin)) throw forbidden('คุณได้รับสิทธิ์เปิดเฉพาะโปรแกรมอื่นจากหน้าเปิดโปรแกรม (ไม่รวม Buddy Account) — ขอสิทธิ์จากผู้ดูแลระบบของบริษัท (อื่น ๆ › ผู้ใช้งานและสิทธิ์)');
      checkApiKeyRule(a, method, url, 'lookup', null); return;
    }
    const menu = rule.pick ? await rule.pick(req, db, a.companyId) : rule.menu;
    checkApiKeyRule(a, method, url, 'menu', menu);
    const off = await modulesOff(db, a.companyId);
    const offBy = menuOffBy(menu, off);
    if (offBy?.key === 'PAY' && (await payrollSource(db, a.companyId)) === 'wts-sop') throw forbidden('บริษัทนี้คิดเงินเดือนที่ WTS-HR — ใบสำคัญเงินเดือนส่งเข้ามาจาก WTS-HR · เปลี่ยนได้ที่ เริ่มระบบ › รายละเอียดกิจการ › ระบบที่ใช้งาน');
    if (offBy) throw forbidden(`${offBy.label}ปิดอยู่ในบริษัทนี้ — ผู้มีสิทธิ์เปิดได้ที่ เริ่มระบบ › รายละเอียดกิจการ › ระบบที่ใช้งาน`);
    const r = decide(a, await loadRows(db, a), menu, rule.action, off);
    // พิมพ์ออกจอเท่านั้น (S): ดูตัวอย่างได้ แต่คำขอที่บันทึกการพิมพ์ (นับครั้งที่พิมพ์ · POST …/printed) ไม่ได้ — HANDOFF 157
    if (r.allowed && r.screenOnly && method !== 'GET') throw forbidden('สิทธิ์ของคุณพิมพ์ได้เฉพาะแสดงทางจอภาพ — ติดต่อผู้ดูแลระบบเพื่อขอสิทธิ์พิมพ์ออกเครื่องพิมพ์');
    if (!r.allowed) {
      throw forbidden(`ไม่มีสิทธิ์${ACTION_TH[rule.action]}ในเมนู "${LABEL.get(menu) ?? menu}" (${whyText(r, a, menu, rule.action)}) — ติดต่อผู้ดูแลระบบเพื่อขอสิทธิ์ (เมนู อื่น ๆ › ผู้ใช้งานและสิทธิ์)`);
    }
    if (r.log) await logActivity(db, a, { module: menu, action: `USE_${rule.action.toUpperCase()}`, detail: { method, url: req.url.split('?')[0] } });
  }
}

/** รายการเมนูในตาราง sys_menu ให้ตรงกับเมนูของโปรแกรม (รวม "ทุกระบบ") — เรียกตอนเปิด server */
export async function syncMenus(db: Db) {
  const want = [{ code: ALL_MENU, name_th: 'ทุกระบบงาน', parent: null as string | null, sort: 0 }, ...FLAT.map((m, i) => ({ code: m.code, name_th: m.label, parent: m.parent ?? null, sort: i + 1 }))];
  const have = new Map((await db.selectFrom('sys_menu').select(['id', 'code', 'name_th', 'sort_order', 'parent_id']).where('deleted_at', 'is', null).execute()).map((r) => [r.code, r]));
  const created = new Set<string>();
  for (const w of want) {
    const h = have.get(w.code);
    if (!h) { have.set(w.code, { ...(await db.insertInto('sys_menu').values({ code: w.code, name_th: w.name_th, sort_order: w.sort }).returning(['id', 'code', 'name_th', 'sort_order', 'parent_id']).executeTakeFirstOrThrow()) }); created.add(w.code); }
    else if (h.name_th !== w.name_th || h.sort_order !== w.sort) await db.updateTable('sys_menu').set({ name_th: w.name_th, sort_order: w.sort }).where('id', '=', h.id).execute();
  }
  for (const w of want) {
    const h = have.get(w.code)!;
    const parentId = w.parent ? have.get(w.parent)!.id : null;
    if ((h.parent_id ?? null) === parentId) continue;
    // ย้ายเมนูออกจากกลุ่มเดิม (เช่น ธนาคาร/ภาษี ออกจาก การเงิน): สิทธิ์ที่ตั้งไว้ที่กลุ่มเดิมคัดลอกไปที่กลุ่มใหม่ หรือที่เมนูนั้นเองเมื่อกลายเป็นเมนูหลัก
    const target = !created.has(w.code) && h.parent_id ? (w.parent ? (created.has(w.parent) ? parentId : null) : h.id) : null;
    if (target) await sql`INSERT INTO sys_permission (company_id, subject_type, subject_id, menu_id, can_read, can_add, can_edit, can_cancel, can_delete, can_print, can_approve)
        SELECT p.company_id, p.subject_type, p.subject_id, ${target}, p.can_read, p.can_add, p.can_edit, p.can_cancel, p.can_delete, p.can_print, p.can_approve FROM sys_permission p
         WHERE p.menu_id = ${h.parent_id} AND p.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM sys_permission q WHERE q.company_id = p.company_id AND q.subject_type = p.subject_type
           AND q.subject_id = p.subject_id AND q.menu_id = ${target} AND q.deleted_at IS NULL)`.execute(db);
    await db.updateTable('sys_menu').set({ parent_id: parentId }).where('id', '=', h.id).execute();
    h.parent_id = parentId;
  }
}

/** หน้าจอกำหนดสิทธิ์ — ตามกลุ่ม (S-SEC-01) ตามผู้ใช้ (S-SEC-02) และตามเมนู (S-SEC-03) ของบริษัทปัจจุบัน */
export function permissionRoutes(app: FastifyInstance, db: Db) {
  const val = z.enum(['', 'Y', 'L', 'N', 'S']);
  /** ลูกค้า (tenant) เจ้าของบริษัทที่เลือกอยู่ — null = บริษัทของผู้ให้บริการ */
  const companyTenant = async (companyId: string) => (await db.selectFrom('sys_company').select('tenant_id').where('id', '=', companyId).executeTakeFirst())?.tenant_id ?? null;
  /**
   * ผู้ใช้/กลุ่มต้องเป็นของลูกค้า (tenant) เดียวกับผู้ดูแล และเดียวกับเจ้าของบริษัทที่เลือกอยู่
   * HANDOFF 191: ผู้ให้บริการก็กำหนดสิทธิ์ในบริษัทนี้ให้ผู้ใช้/กลุ่มของลูกค้ารายอื่นไม่ได้ (ไม่ให้มีแถวสิทธิ์ข้ามลูกค้า)
   */
  async function subjectOf(a: AuthContext & { companyId: string }, type: 'U' | 'G', id: string) {
    const q = type === 'U'
      ? db.selectFrom('sys_user').select(['id', 'username as code', 'display_name as name', 'tenant_id', 'approval_level', 'check_rights', 'user_group_id', 'app_access']).where('id', '=', id).where('deleted_at', 'is', null)
      : db.selectFrom('sys_user_group').select(['id', 'code', 'name', 'tenant_id', sql<number>`9`.as('approval_level'), sql<boolean>`true`.as('check_rights'), sql<string | null>`NULL::uuid`.as('user_group_id'), sql<unknown>`NULL::jsonb`.as('app_access')]).where('id', '=', id).where('deleted_at', 'is', null);
    const s = await q.executeTakeFirst();
    if (!s || (!a.isPlatform && (s.tenant_id ?? null) !== (a.tenantId ?? null))) throw notFound(type === 'U' ? 'ผู้ใช้' : 'กลุ่มผู้ใช้');
    if ((s.tenant_id ?? null) !== (await companyTenant(a.companyId))) {
      throw badRequest(`${type === 'U' ? 'ผู้ใช้' : 'กลุ่มผู้ใช้'} ${s.code} เป็นของลูกค้ารายอื่น ไม่ใช่เจ้าของบริษัทที่เลือกอยู่ — เลือกบริษัทของลูกค้ารายนั้นก่อน แล้วจึงกำหนดสิทธิ์รายเมนู`);
    }
    return s;
  }
  const menuIds = async () => new Map((await db.selectFrom('sys_menu').select(['id', 'code']).where('deleted_at', 'is', null).execute()).map((r) => [r.code, r.id]));

  const CELLS = ['p.can_read', 'p.can_add', 'p.can_edit', 'p.can_cancel', 'p.can_delete', 'p.can_print', 'p.can_approve'] as const;
  type Cells = Record<(typeof COL)[Action], string>;
  /** แถวสิทธิ์ของผู้ใช้/กลุ่มหนึ่งในบริษัทหนึ่ง → { เมนู: ช่อง } · ช่องว่าง (NULL) = '' (ตามเมนูหลัก/กลุ่ม) */
  /** เมนูที่ไม่อยู่ในตารางสิทธิ์ของบริษัทนี้: ของผู้ให้บริการ (HANDOFF 199) + ที่ลูกค้าเจ้าของบริษัทยังไม่ได้เปิด (HANDOFF 200) */
  const hiddenIn = async (companyId: string) => new Set([...PLATFORM_MENUS, ...(await companyTenantOff(db, companyId))]);
  /** แถวในตาราง: + เมนูเฉพาะผู้ดูแลระบบ (HANDOFF 201 — แสดงเป็นแถวคงที่ ตั้งไม่ได้ · แถวเดิมไม่แสดง ไม่แตะ) */
  const rowHiddenIn = async (companyId: string) => new Set([...(await hiddenIn(companyId)), ...Object.keys(ADMIN_MENUS)]);
  async function rowsOf(companyId: string, type: string, id: string, hidden?: Set<string>): Promise<Record<string, Cells>> {
    const hide = hidden ?? (await rowHiddenIn(companyId));
    const rows = await db.selectFrom('sys_permission as p').innerJoin('sys_menu as m', 'm.id', 'p.menu_id').select(['m.code', ...CELLS])
      .where('p.company_id', '=', companyId).where('p.subject_type', '=', type).where('p.subject_id', '=', id).where('p.deleted_at', 'is', null).execute();
    return Object.fromEntries(rows.filter((r) => !hide.has(r.code)).map((r) => [r.code, Object.fromEntries(ACTIONS.map((x) => [COL[x], (r[COL[x]] ?? '').trim()])) as Cells]));
  }

  app.get('/api/v1/permissions/menus', async (req) => {
    const a = requireCompany(req);
    const hide = await hiddenIn(a.companyId);
    const depth = (c: string) => { let n = 0, p = PARENT.get(c); while (p) { n++; p = PARENT.get(p); } return n; };
    // เมนูของผู้ให้บริการไม่อยู่ในตารางสิทธิ์ (HANDOFF 199) — ลูกค้าใช้ไม่ได้ทุกกรณี · ผู้ให้บริการ = ADMIN ได้ทุกอย่างอยู่แล้ว
    return [{ code: ALL_MENU, label: 'ทุกระบบงาน', depth: 0, group: true }, ...FLAT.filter((m) => !hide.has(m.code)).map((m) => ({ code: m.code, label: m.label, depth: depth(m.code) + 1, group: !!m.children?.length, ...(adminOnlyMenu(m.code) ? { admin_only: true } : {}) }))];
  });

  /**
   * ตารางสิทธิ์ของกลุ่ม/ผู้ใช้ในบริษัทที่เลือก (HANDOFF 197): rows = ช่องที่ตั้งเอง ('' = ตามเมนูหลัก/กลุ่ม)
   * ผู้ใช้: group = ช่องของกลุ่ม (ค่าตั้งต้นของผู้ใช้) · effective = สิทธิ์ที่ได้จริง · table_applies = ตารางมีผลกับผู้ใช้นี้ · need = ระดับอนุมัติที่ต้องมี (เฉพาะช่องที่ระดับของผู้ใช้ไม่พอ)
   */
  app.get('/api/v1/permissions', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ subject_type: z.enum(['U', 'G']), subject_id: z.string().uuid() }), req.query);
    const s = await subjectOf(a, q.subject_type, q.subject_id);
    const hide = await hiddenIn(a.companyId);
    const rows = await rowsOf(a.companyId, q.subject_type, q.subject_id, await rowHiddenIn(a.companyId));
    let effective: Awaited<ReturnType<typeof permissionMatrix>> | null = null, table: TableMode | null = null;
    let group: { id: string; code: string; name: string; admin: boolean; rows: Record<string, Cells> } | null = null;
    const need: Record<string, Partial<Record<Action, number>>> = {};
    if (q.subject_type === 'U') {
      const g = s.user_group_id ? await db.selectFrom('sys_user_group').select(['id', 'code', 'name']).where('id', '=', s.user_group_id).where('deleted_at', 'is', null).executeTakeFirst() : null;
      if (g) group = { ...g, admin: g.code === 'ADMIN', rows: await rowsOf(a.companyId, 'G', g.id, await rowHiddenIn(a.companyId)) };
      const as: AuthContext = { ...a, apiKeyId: undefined, apiKeyReadOnly: undefined, userId: s.id, approvalLevel: s.approval_level, checkRights: s.check_rights, groupId: s.user_group_id, isAdmin: g?.code === 'ADMIN', isPlatform: false, apps: normalizeAppAccess(s.app_access) };
      const v = await permissionView(db, as);
      effective = Object.fromEntries(Object.entries(v.perms).filter(([c]) => !hide.has(c))); table = v.table;
      if (!as.isAdmin) for (const m of FLAT) if (!hide.has(m.code) && !adminOnlyMenu(m.code)) for (const x of ACTIONS) { const n = levelNeeded(m.code, x); if (n > s.approval_level) (need[m.code] ??= {})[x] = n; }
    }
    return { subject: { type: q.subject_type, id: s.id, code: s.code, name: s.name, approval_level: q.subject_type === 'U' ? s.approval_level : null, check_rights: q.subject_type === 'U' ? s.check_rights : null },
      company: { id: a.companyId, ...(await db.selectFrom('sys_company').select(['code', 'name_th']).where('id', '=', a.companyId).executeTakeFirst()) },
      rows, group, effective, table_applies: table, need };
  });

  /** ตามเมนู (S-SEC-03): ทุกกลุ่ม/ผู้ใช้ที่ได้ค่าที่เมนูนี้ รายช่อง — from = เมนูที่ให้ค่านั้น (ตัวเอง/เมนูหลัก/ทุกระบบงาน) */
  /**
   * ระดับอนุมัติที่บริษัทนี้ใช้จริง (HANDOFF 198 เจ้าของ ข้อ 2 "ระดับอนุมัติ … ใช้งานอย่างไร") — แสดงใต้ช่องระดับอนุมัติในหน้าแก้ไขผู้ใช้
   * อ่านอย่างเดียว เฉพาะบริษัทที่เลือกอยู่ (session) · ประเภทเอกสาร/สมุดรายวัน: รับรอง · พิมพ์ซ้ำ · ค่าเริ่มต้นระบบขาย/ซื้อ: เกินวงเงิน · ระงับ
   */
  app.get('/api/v1/permissions/level-uses', async (req) => {
    const a = requireCompany(req);
    const pick = <T extends { approve_level: number | null; reprint_level: number | null }>(r: T[]) => r.filter((x) => (x.approve_level ?? 0) > 0 || (x.reprint_level ?? 0) > 0);
    const docs = await db.selectFrom('md_doc_type').select(['code', 'name_th as name', 'approve_level', 'reprint_level'])
      .where('company_id', '=', a.companyId).where('deleted_at', 'is', null).where('status', '=', 'A').orderBy('code').execute();
    const books = await db.selectFrom('gl_journal_book').select(['code', 'prefix', 'name_th as name', 'approve_level', 'reprint_level'])
      .where('company_id', '=', a.companyId).where('deleted_at', 'is', null).orderBy('code').execute();
    const cs = await companySettings(db, a.companyId);
    const lv = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
    return {
      docs: pick(docs), books: pick(books),
      over_credit_level: cs['ar.allow_over_credit'] === true ? null : lv(cs['ar.over_credit_level'] ?? 9),
      ar_hold_level: lv(cs['ar.hold_level']), ap_hold_level: lv(cs['ap.hold_level']),
    };
  });

  /**
   * ใครใช้เมนูนี้ได้ (S-SEC-03 · HANDOFF 200 ส่วนที่ 2 · เจ้าของ "เมนูตามกลุ่ม และ ตามเมนู นี้ต่างกันอย่างไร … สับสน"):
   * ทุกกลุ่มและทุกผู้ใช้ของลูกค้าเจ้าของบริษัทนี้ (ผู้ให้บริการก็เช่นกัน · HANDOFF 191) — ผลที่ได้จริงรายช่องจาก decide() ตัวเดียวกับตอนใช้งานจริง
   * อ่านแถวสิทธิ์ของทั้งบริษัทครั้งเดียว แล้วคิดในหน่วยความจำ (ไม่ query ต่อคน)
   * src: admin = กลุ่ม ADMIN · user/group = ตารางสิทธิ์ (at = เมนูที่ตั้ง: เมนูนี้/เมนูหลัก/ALL) · level = ตามระดับอนุมัติ · none = ไม่ได้กำหนด (ใช้ไม่ได้) · block = ปิดด้วยเหตุอื่น (why)
   */
  app.get('/api/v1/permissions/by-menu', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ menu_code: z.string().min(1).max(30) }), req.query);
    if (providerOnly(q.menu_code)) throw badRequest(`เมนู ${q.menu_code} เป็นของเจ้าหน้าที่ผู้ให้บริการ — ไม่อยู่ในตารางสิทธิ์`);
    if ((await companyTenantOff(db, a.companyId)).includes(q.menu_code)) throw badRequest(`เมนู ${q.menu_code} ยังไม่เปิดให้ลูกค้าเจ้าของบริษัทนี้ — ไม่อยู่ในตารางสิทธิ์ (ผู้ให้บริการเปิดได้ที่ ลูกค้าผู้ใช้บริการ)`);
    const menu = q.menu_code;
    if (menu !== ALL_MENU && !LABEL.has(menu)) throw badRequest(`ไม่พบเมนู ${menu}`);
    const ct = await companyTenant(a.companyId);
    if (!a.isPlatform && (ct ?? null) !== (a.tenantId ?? null)) throw notFound('บริษัท');
    const groups = await db.selectFrom('sys_user_group').select(['id', 'code', 'name']).where('deleted_at', 'is', null)
      .where(sql<boolean>`tenant_id IS NOT DISTINCT FROM ${ct}::uuid`).orderBy('code').execute();
    const admins = new Set(groups.filter((g) => g.code === 'ADMIN').map((g) => g.id));
    // ผู้ใช้ที่เข้าบริษัทนี้ได้: ผูกบริษัทนี้ หรืออยู่กลุ่ม ADMIN ของลูกค้า (เข้าได้ทุกบริษัทของลูกค้า)
    const users = (await sql<{ id: string; username: string; display_name: string; status: string; approval_level: number; check_rights: boolean; user_group_id: string | null; app_access: unknown }>`
      SELECT u.id, u.username, u.display_name, u.status, u.approval_level, u.check_rights, u.user_group_id, u.app_access FROM sys_user u
       WHERE u.deleted_at IS NULL AND u.tenant_id IS NOT DISTINCT FROM ${ct}::uuid
         AND (EXISTS (SELECT 1 FROM sys_user_company uc WHERE uc.user_id = u.id AND uc.company_id = ${a.companyId} AND uc.deleted_at IS NULL)
              OR u.user_group_id = ANY(${[...admins]}::uuid[]))
       ORDER BY u.username`.execute(db)).rows;
    // แถวสิทธิ์ทั้งบริษัท (เหมือน loadRows: ไม่นับเมนูผู้ให้บริการ)
    const all = await db.selectFrom('sys_permission as p').innerJoin('sys_menu as m', 'm.id', 'p.menu_id')
      .select(['p.subject_type', 'p.subject_id', 'm.code', 'p.can_read', 'p.can_add', 'p.can_edit', 'p.can_cancel', 'p.can_delete', 'p.can_print', 'p.can_approve'])
      .where('p.company_id', '=', a.companyId).where('p.deleted_at', 'is', null).where('m.code', 'not in', [...PLATFORM_MENUS]).execute();
    const bySubject = new Map<string, PermRow[]>();
    for (const r of all) { const k = `${r.subject_type}:${r.subject_id}`; (bySubject.get(k) ?? bySubject.set(k, []).get(k)!).push(r as unknown as PermRow); }
    const off = await modulesOff(db, a.companyId);
    type Cell = { v: 'Y' | 'L' | 'S' | 'N'; src: 'admin' | 'user' | 'group' | 'level' | 'none' | 'block'; at?: string; need?: number; why?: string };
    const cellsOf = (ctx: AuthContext, rows: PermRow[], isGroup: boolean) => Object.fromEntries(ACTIONS.map((x) => {
      const r = decide(ctx, rows, menu, x, off);
      const v: Cell['v'] = r.allowed ? (r.screenOnly ? 'S' : r.log ? 'L' : 'Y') : 'N';
      if (ctx.isAdmin && r.allowed) return [x, { v, src: 'admin' } as Cell];
      const tc = tableCell(rows, menu, x), mode = tableMode(ctx, rows);
      const need = levelNeeded(menu, x);
      let c: Cell;
      if (r.allowed) c = tc && mode !== 'off' ? { v, src: tc.subject === 'U' ? 'user' : 'group', at: tc.menu } : { v, src: 'level' };
      else if (r.why === 'table') c = tc ? { v, src: tc.subject === 'U' ? 'user' : 'group', at: tc.menu } : { v, src: 'none' };
      else c = { v, src: 'block', why: whyText(r, ctx, menu, x) };
      // กลุ่ม: สมาชิกยังต้องมีระดับอนุมัติพอ (ยกเลิก ลบ รับรอง กำหนดค่า เงินเดือน ความปลอดภัย)
      if (isGroup && r.allowed && need > 0) c.need = need;
      return [x, c];
    })) as Record<Action, Cell>;
    const base = { ...a, apiKeyId: undefined, apiKeyReadOnly: undefined, isPlatform: false } as AuthContext;
    const members = new Map<string, number>();
    for (const u of users) if (u.user_group_id) members.set(u.user_group_id, (members.get(u.user_group_id) ?? 0) + 1);
    return {
      menu,
      groups: groups.map((g) => {
        const rows = bySubject.get(`G:${g.id}`) ?? [];
        // กลุ่ม = ค่าตั้งต้นของสมาชิก: คิดเหมือนสมาชิกระดับ 9 ที่ใช้ตาราง (ระดับไม่จำกัด → ช่อง need บอกระดับที่สมาชิกต้องมี)
        const ctx: AuthContext = { ...base, userId: g.id, groupId: g.id, approvalLevel: 9, checkRights: true, isAdmin: g.code === 'ADMIN', apps: undefined };
        return { id: g.id, code: g.code, name: g.name, admin: g.code === 'ADMIN', members: members.get(g.id) ?? 0, has_rows: rows.length > 0, cells: cellsOf(ctx, rows, true) };
      }),
      users: users.map((u) => {
        const g = groups.find((x) => x.id === u.user_group_id) ?? null;
        const rows = [...(bySubject.get(`U:${u.id}`) ?? []), ...(g ? bySubject.get(`G:${g.id}`) ?? [] : [])];
        const ctx: AuthContext = { ...base, userId: u.id, groupId: g?.id ?? null, approvalLevel: u.approval_level, checkRights: u.check_rights, isAdmin: !!g && admins.has(g.id), apps: normalizeAppAccess(u.app_access) };
        return { id: u.id, code: u.username, name: u.display_name, status: u.status, group_code: g?.code ?? null, approval_level: u.approval_level, check_rights: u.check_rights,
          admin: ctx.isAdmin, table: ctx.isAdmin ? 'off' : tableMode(ctx, rows), cells: cellsOf(ctx, rows, false) };
      }),
    };
  });

  app.put('/api/v1/permissions', async (req) => {
    const a = requireCompany(req);
    const b = parse(z.object({
      subject_type: z.enum(['U', 'G']), subject_id: z.string().uuid(),
      rows: z.array(z.object({ menu_code: z.string().min(1).max(30), can_read: val, can_add: val, can_edit: val, can_cancel: val, can_delete: val, can_print: val, can_approve: val })).max(500),
    }), req.body);
    const s = await subjectOf(a, b.subject_type, b.subject_id);
    const ids = await menuIds();
    const tOff = await companyTenantOff(db, a.companyId);
    for (const r of b.rows) {
      if (adminOnlyMenu(r.menu_code)) throw badRequest(`เมนู ${r.menu_code} เฉพาะผู้ดูแลระบบ (กลุ่ม ADMIN) — กำหนดสิทธิ์ให้กลุ่ม/ผู้ใช้อื่นไม่ได้`);
      if (tOff.includes(r.menu_code)) throw badRequest(`เมนู ${r.menu_code} ยังไม่เปิดให้ลูกค้าเจ้าของบริษัทนี้ — กำหนดสิทธิ์ไม่ได้จนกว่าผู้ให้บริการจะเปิดให้`);
      if (!ids.has(r.menu_code)) throw badRequest(`ไม่พบเมนู ${r.menu_code}`);
      if (providerOnly(r.menu_code)) throw badRequest(`เมนู ${r.menu_code} เป็นของเจ้าหน้าที่ผู้ให้บริการ — กำหนดสิทธิ์ไม่ได้ (ลูกค้าใช้ไม่ได้ทุกกรณี)`);
      const bad = ACTIONS.find((x) => x !== 'print' && r[COL[x]] === 'S');
      if (bad) throw badRequest(`ค่า S ใช้ได้เฉพาะช่องพิมพ์ (เมนู ${r.menu_code} ช่อง${ACTION_TH[bad]})`);
    }
    return db.transaction().execute(async (tx) => {
      const before = await tx.selectFrom('sys_permission as p').innerJoin('sys_menu as m', 'm.id', 'p.menu_id').select(['m.code', ...CELLS])
        .where('p.company_id', '=', a.companyId).where('p.subject_type', '=', b.subject_type).where('p.subject_id', '=', b.subject_id).where('p.deleted_at', 'is', null).execute();
      // แถวเดิมของเมนูผู้ให้บริการ (ถ้ามี) ไม่แตะ — ไม่มีผลและไม่แสดงอยู่แล้ว (HANDOFF 199)
      // HANDOFF 200: แถวของเมนูที่ลูกค้ายังไม่ได้เปิดก็ไม่แตะ — เปิดให้ภายหลังแล้วกลับมาเหมือนเดิม
      const keep = [...PLATFORM_MENUS, ...tOff, ...Object.keys(ADMIN_MENUS)].map((c) => ids.get(c)).filter((x): x is string => !!x);
      await tx.updateTable('sys_permission').set({ deleted_at: sql`now()` as never, updated_by: a.userId }).where('company_id', '=', a.companyId).where('subject_type', '=', b.subject_type).where('subject_id', '=', b.subject_id).where('deleted_at', 'is', null)
        .$if(keep.length > 0, (q) => q.where('menu_id', 'not in', keep)).execute();
      // ช่องว่าง = ไม่ได้ตั้ง (NULL — ได้ค่าจากเมนูหลัก/กลุ่ม) · แถวที่ว่างทุกช่องไม่เก็บ (HANDOFF 197)
      const rows = b.rows.filter((r) => ACTIONS.some((x) => r[COL[x]]))
        .map((r) => ({ company_id: a.companyId, subject_type: b.subject_type, subject_id: b.subject_id, menu_id: ids.get(r.menu_code)!, created_by: a.userId,
          ...Object.fromEntries(ACTIONS.map((x) => [COL[x], r[COL[x]] || null])) as Record<(typeof COL)[Action], string | null> }));
      if (rows.length) await tx.insertInto('sys_permission').values(rows).execute();
      await logActivity(tx, a, { module: 'SEC', action: 'PERMISSION', docNo: s.code, table: 'sys_permission', rowId: b.subject_id, detail: { subject_type: b.subject_type, before, rows: rows.length } });
      return { rows: rows.length };
    });
  });

  /**
   * คัดลอกสิทธิ์ของบริษัทนี้ไปบริษัทอื่นของลูกค้าเดียวกัน (HANDOFF 197 · เจ้าของ ข้อ 3 "แต่ละบริษัทเริ่มต้นเหมือนสิทธิที่ตั้งให้ แต่สามารถแก้ไขเพิ่มแต่ละสิทธิ แยกบริษัทได้")
   * scope subject = เฉพาะกลุ่ม/ผู้ใช้ที่เลือก · all = ทุกกลุ่มและผู้ใช้ของลูกค้า (บริษัทปลายทางได้ตารางสิทธิ์เหมือนบริษัทนี้ทุกช่อง)
   * ปลายทาง = บริษัทที่ผู้ใช้เข้าได้ ของลูกค้าเจ้าของบริษัทนี้เท่านั้น + ต้องมีสิทธิ์แก้สิทธิ์ผู้ใช้ (SET.SEC แก้ไข) ทั้งบริษัทนี้และปลายทาง
   */
  const copyBody = z.object({ scope: z.enum(['subject', 'all']), subject_type: z.enum(['U', 'G']).optional(), subject_id: z.string().uuid().optional(), company_ids: z.array(z.string().uuid()).min(1, 'เลือกบริษัทปลายทางอย่างน้อย 1 บริษัท').max(200) });
  async function canEditSecurity(a: AuthContext, companyId: string) {
    const as = { ...a, companyId };
    return decide(as, await loadRows(db, as), 'SET.SEC', 'edit', await modulesOff(db, companyId)).allowed;
  }
  async function copyPlan(req: FastifyRequest) {
    const a = requireCompany(req);
    // ตรวจสิทธิ์ก่อนอ่านคำขอ (ผู้ใช้ดูอย่างเดียวต้องได้ 403 — HANDOFF 157)
    if (!(await canEditSecurity(a, a.companyId))) throw forbidden('ไม่มีสิทธิ์แก้ไขในเมนู "ผู้ใช้งานและสิทธิ์" — ติดต่อผู้ดูแลระบบ');
    const b = parse(copyBody, req.body);
    const ct = await companyTenant(a.companyId);
    let subject: { type: 'U' | 'G'; id: string; code: string } | null = null;
    if (b.scope === 'subject') {
      if (!b.subject_type || !b.subject_id) throw badRequest('เลือกกลุ่มหรือผู้ใช้ที่จะคัดลอกสิทธิ์');
      const s = await subjectOf(a, b.subject_type, b.subject_id);
      subject = { type: b.subject_type, id: s.id, code: s.code };
    }
    const mine = (await companiesForUser(db, a)).filter((c) => (c.tenant_id ?? null) === ct);
    const want = [...new Set(b.company_ids)];
    if (want.includes(a.companyId)) throw badRequest('บริษัทปลายทางต้องไม่ใช่บริษัทที่เลือกอยู่ (ต้นทาง)');
    const targets = want.map((id) => mine.find((c) => c.id === id));
    // บริษัทของลูกค้ารายอื่น / บริษัทที่ผู้ใช้เข้าไม่ได้ = ไม่พบ (ไม่บอกว่ามีอยู่)
    if (targets.some((t) => !t)) throw notFound('บริษัทปลายทาง');
    for (const t of targets) if (!(await canEditSecurity(a, t!.id))) throw forbidden(`ไม่มีสิทธิ์แก้สิทธิ์ผู้ใช้ในบริษัท ${t!.code} — ติดต่อผู้ดูแลระบบ`);
    // ผู้ใช้/กลุ่มของลูกค้าเจ้าของบริษัทนี้ (ไม่รวมกลุ่ม ADMIN ซึ่งได้ทุกอย่างอยู่แล้ว)
    const subjectsSql = (companyId: string) => sql<{ subject_type: string; subject_id: string; code: string; menu_code: string } & Record<string, string | null>>`
      SELECT p.subject_type, p.subject_id, COALESCE(u.username, g.code) AS code, m.code AS menu_code, p.can_read, p.can_add, p.can_edit, p.can_cancel, p.can_delete, p.can_print, p.can_approve
        FROM sys_permission p JOIN sys_menu m ON m.id = p.menu_id AND m.deleted_at IS NULL
        LEFT JOIN sys_user u ON p.subject_type = 'U' AND u.id = p.subject_id AND u.deleted_at IS NULL
        LEFT JOIN sys_user_group g ON p.subject_type = 'G' AND g.id = p.subject_id AND g.deleted_at IS NULL
       WHERE p.company_id = ${companyId} AND p.deleted_at IS NULL AND (u.id IS NOT NULL OR g.id IS NOT NULL)
         AND COALESCE(u.tenant_id, g.tenant_id) IS NOT DISTINCT FROM ${ct}::uuid
         AND (${subject ? subject.type : null}::text IS NULL OR (p.subject_type = ${subject?.type ?? null} AND p.subject_id = ${subject?.id ?? null}::uuid))`.execute(db).then((r) => r.rows);
    const key = (r: { subject_type: string; subject_id: string }) => `${r.subject_type}:${r.subject_id}`;
    const cellsOf = (r: Record<string, string | null>) => ACTIONS.map((x) => (r[COL[x]] ?? '').trim()).join('|');
    const source = await subjectsSql(a.companyId);
    const plan = [];
    for (const t of targets) {
      const cur = await subjectsSql(t!.id);
      const subs = new Map<string, { type: string; id: string; code: string }>();
      for (const r of [...source, ...cur]) subs.set(key(r), { type: r.subject_type, id: r.subject_id, code: r.code });
      if (subject) subs.set(`${subject.type}:${subject.id}`, { type: subject.type, id: subject.id, code: subject.code });
      const list = [...subs.entries()].map(([k, s]) => {
        const src = new Map(source.filter((r) => key(r) === k).map((r) => [r.menu_code, cellsOf(r)]));
        const now = new Map(cur.filter((r) => key(r) === k).map((r) => [r.menu_code, cellsOf(r)]));
        const changed = [...new Set([...src.keys(), ...now.keys()])].filter((m) => src.get(m) !== now.get(m)).length;
        return { subject_type: s.type, subject_id: s.id, code: s.code, before: now.size, after: src.size, changed };
      }).sort((x, y) => (x.subject_type === y.subject_type ? x.code.localeCompare(y.code) : x.subject_type < y.subject_type ? -1 : 1));
      plan.push({ company_id: t!.id, code: t!.code, name: t!.name_th, subjects: list, changed: list.reduce((n, s) => n + s.changed, 0) });
    }
    return { a, b, subject, source, plan };
  }
  app.post('/api/v1/permissions/copy/preview', async (req) => {
    const p = await copyPlan(req);
    return { scope: p.b.scope, subject: p.subject, source_rows: p.source.length, companies: p.plan };
  });
  app.post('/api/v1/permissions/copy', async (req) => {
    const p = await copyPlan(req);
    const ids = await menuIds();
    const from = await db.selectFrom('sys_company').select('code').where('id', '=', p.a.companyId).executeTakeFirst();
    return db.transaction().execute(async (tx) => {
      let rows = 0;
      for (const t of p.plan) {
        for (const s of t.subjects) {
          await tx.updateTable('sys_permission').set({ deleted_at: sql`now()` as never, updated_by: p.a.userId })
            .where('company_id', '=', t.company_id).where('subject_type', '=', s.subject_type).where('subject_id', '=', s.subject_id).where('deleted_at', 'is', null).execute();
          const vals = p.source.filter((r) => r.subject_type === s.subject_type && r.subject_id === s.subject_id && ids.has(r.menu_code)).map((r) => ({
            company_id: t.company_id, subject_type: r.subject_type, subject_id: r.subject_id, menu_id: ids.get(r.menu_code)!, created_by: p.a.userId,
            ...Object.fromEntries(ACTIONS.map((x) => [COL[x], (r[COL[x]] ?? '').trim() || null])) as Record<(typeof COL)[Action], string | null> }));
          if (vals.length) { await tx.insertInto('sys_permission').values(vals).execute(); rows += vals.length; }
        }
        await logActivity(tx, { companyId: t.company_id, userId: p.a.userId }, { module: 'SEC', action: 'PERMISSION_COPY', docNo: from?.code ?? null, table: 'sys_permission',
          detail: { from_company: p.a.companyId, from_code: from?.code, scope: p.b.scope, subject: p.subject, subjects: t.subjects.map((s) => `${s.subject_type}:${s.code}`), changed: t.changed } });
      }
      await logActivity(tx, p.a, { module: 'SEC', action: 'PERMISSION_COPY', table: 'sys_permission', detail: { to: p.plan.map((t) => t.code), scope: p.b.scope, subject: p.subject, rows } });
      return { companies: p.plan.length, rows };
    });
  });
}
