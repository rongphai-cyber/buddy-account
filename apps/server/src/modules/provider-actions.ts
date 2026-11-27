import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sql, type RawBuilder } from 'kysely';
import { z } from 'zod';
import type { Db } from '../db.js';
import { forbidden, parse, requireAuth } from '../http.js';
import { sortedList, sortShape } from '../list-sort.js';
import { TENANT_MODULES } from '@buddy/core';

const DEFAULT_ON = new Set<string>(TENANT_MODULES.filter((m) => m.default_on).map((m) => m.key));

/**
 * สิ่งที่เจ้าหน้าที่ผู้ให้บริการทำกับบัญชีลูกค้า (HANDOFF 207 · ต่อจาก 204 P3) — อ่านจาก sys_activity_log อย่างเดียว (ไม่มีตารางใหม่ ไม่แก้ log)
 *  - ผู้ให้บริการ: GET /api/v1/provider/actions — ทุกลูกค้า กรองลูกค้า/เจ้าหน้าที่/ช่วงวันที่/เหตุการณ์ แบ่งหน้า
 *  - ลูกค้า (ผู้ดูแลระบบของกิจการ): GET /api/v1/provider-actions/mine — เฉพาะบัญชีของตัวเอง ตรวจได้ว่าไม่มีใครเปิดบัญชี
 *    เห็นชื่อที่แสดงของเจ้าหน้าที่เท่านั้น (ไม่มีรหัสผู้ใช้ IP รายละเอียดภายใน หรือข้อมูลของลูกค้ารายอื่น)
 * เจ้าหน้าที่ = ผู้ใช้ที่ไม่สังกัดลูกค้า (sys_user.tenant_id ว่าง) + คำสั่งผู้ดูแลเซิร์ฟเวอร์ (CLI · ไม่มีผู้ใช้)
 * ลูกค้าของแถว = ตารางที่เกี่ยวข้อง (ลูกค้า ผู้ใช้ กลุ่ม กุญแจ API บริษัท คำขอย้าย ใบสมัคร) ไม่ใช่บริษัทที่เจ้าหน้าที่เลือกค้างไว้
 *   ไม่เกี่ยวกับตารางเหล่านั้น = ลูกค้าเจ้าของบริษัทของแถว (เช่น งานในบริษัทข้อมูลตัวอย่าง) · แพ็กเกจ/ค่าตั้งผู้ให้บริการ = ทั้งระบบ (ไม่มีลูกค้า)
 * บริษัทของแถว = เฉพาะบริษัทของลูกค้าที่เกี่ยวข้อง (บริษัทข้อมูลตัวอย่างที่เจ้าหน้าที่เลือกค้างไว้ขณะทำกับลูกค้าจริง ไม่แสดง)
 * แถวซ้ำของเหตุการณ์เดียว (บันทึกทั้งแบบไม่มีบริษัทและรายบริษัท เช่น เลิกข้อมูลตัวอย่าง คำขอย้าย) แสดงครั้งเดียว
 */
export const PERSONAL_ACTIONS = ['LOGIN', 'LOGOUT', 'LOGIN_FAIL', 'LOGIN_LOCKED', 'SESSION_REPLACED', 'PASSWORD', 'SETUP', 'SET_THEME',
  'MFA_ENABLE', 'MFA_DISABLE', 'MFA_RECOVERY_NEW', 'MFA_RECOVERY_USED', 'INVITE_ACCEPT'] as const;
const UUID_RE = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

/** ลูกค้าที่แถว log นี้เกี่ยวข้อง (null = ทั้งระบบ) */
export const subjectTenant = sql<string | null>`CASE
    WHEN l.table_name = 'sys_tenant' THEN l.row_id
    WHEN l.table_name = 'sys_user' THEN (SELECT x.tenant_id FROM sys_user x WHERE x.id = l.row_id)
    WHEN l.table_name = 'sys_user_group' THEN (SELECT x.tenant_id FROM sys_user_group x WHERE x.id = l.row_id)
    WHEN l.table_name = 'sys_api_key' THEN (SELECT coalesce(kc.tenant_id, ku.tenant_id) FROM sys_api_key k LEFT JOIN sys_company kc ON kc.id = k.company_id LEFT JOIN sys_user ku ON ku.id = k.user_id WHERE k.id = l.row_id)
    WHEN l.table_name = 'sys_company' THEN (SELECT x.tenant_id FROM sys_company x WHERE x.id = l.row_id)
    WHEN l.table_name = 'sys_company_move_request' THEN (SELECT x.source_tenant_id FROM sys_company_move_request x WHERE x.id = l.row_id)
    WHEN l.table_name = 'sys_signup' THEN (SELECT x.tenant_id FROM sys_signup x WHERE x.id = l.row_id)
    WHEN l.table_name IN ('sys_package', 'sys_platform_setting') THEN NULL
    WHEN l.user_id IS NULL AND l.detail->>'user_id' ~ ${UUID_RE} THEN (SELECT x.tenant_id FROM sys_user x WHERE x.id = (l.detail->>'user_id')::uuid)
    ELSE (SELECT x.tenant_id FROM sys_company x WHERE x.id = l.company_id)
  END`;

type Filter = { tenant?: string | 'none'; staff?: string; from?: string; to?: string; action?: string; accountOnly?: boolean };
/** แถวของเจ้าหน้าที่ (ตัดเหตุการณ์ส่วนตัว เช่น เข้าระบบ) + ลูกค้าที่เกี่ยวข้อง + ตัดแถวซ้ำ — SELECT ที่ยังไม่เรียง */
function actionsSelect(f: Filter): RawBuilder<unknown> {
  const w: RawBuilder<unknown>[] = [
    sql`(l.user_id IN (SELECT s.id FROM sys_user s WHERE s.tenant_id IS NULL) OR (l.user_id IS NULL AND l.detail->>'via' = 'cli'))`,
    sql`l.action NOT IN (${sql.join(PERSONAL_ACTIONS.map((a) => sql`${a}`))})`,
  ];
  if (f.staff) w.push(sql`l.user_id = ${f.staff}::uuid`);
  if (f.from) w.push(sql`(l.occurred_at AT TIME ZONE 'Asia/Bangkok')::date >= ${f.from}::date`);
  if (f.to) w.push(sql`(l.occurred_at AT TIME ZONE 'Asia/Bangkok')::date <= ${f.to}::date`);
  if (f.action) w.push(sql`l.action = ${f.action}`);
  else if (f.accountOnly) w.push(sql`l.action IN (${sql.join(ACCOUNT_ACTIONS.map((x) => sql`${x}`))})`);
  const tw = f.tenant === 'none' ? sql`WHERE b.tenant_id IS NULL` : f.tenant ? sql`WHERE b.tenant_id = ${f.tenant}::uuid` : sql``;
  const key = sql`coalesce(b.user_id::text, ''), b.action, coalesce(b.row_id::text, ''), coalesce(b.doc_no, ''), date_trunc('second', b.occurred_at), coalesce(b.tenant_id::text, '')`;
  return sql`SELECT d.seq::text AS id, d.occurred_at, d.user_id, d.module, d.action, d.doc_no, d.table_name, d.detail, d.tenant_id,
        u.username AS staff_username, u.display_name AS staff_name, t.code AS tenant_code, t.name AS tenant_name, t.is_demo, c.code AS company_code
      FROM (SELECT DISTINCT ON (${key}) b.* FROM (
              SELECT l.seq, l.occurred_at, l.user_id, l.company_id, l.module, l.action, l.doc_no, l.table_name, l.row_id, l.detail, ${subjectTenant} AS tenant_id
                FROM sys_activity_log l WHERE ${sql.join(w, sql` AND `)}) b ${tw}
            ORDER BY ${key}, (b.company_id IS NULL) DESC, b.seq) d
      LEFT JOIN sys_user u ON u.id = d.user_id LEFT JOIN sys_tenant t ON t.id = d.tenant_id LEFT JOIN sys_company c ON c.id = d.company_id AND c.tenant_id IS NOT DISTINCT FROM d.tenant_id`;
}

type Row = { id: string; occurred_at: string; user_id: string | null; module: string | null; action: string; doc_no: string | null; table_name: string | null; detail: unknown;
  tenant_id: string | null; staff_username: string | null; staff_name: string | null; tenant_code: string | null; tenant_name: string | null; is_demo: boolean | null; company_code: string | null; total: number };

/** ผลของเหตุการณ์: ok = ทำแล้ว (แฟ้มบันทึกเฉพาะที่สำเร็จ) · sent/failed/skipped = อีเมลที่ส่งไปพร้อมกัน */
export function resultOf(detail: unknown): 'ok' | 'sent' | 'failed' | 'skipped' {
  const m = detail && typeof detail === 'object' ? (detail as { mail?: unknown }).mail : undefined;
  if (typeof m !== 'string') return 'ok';
  return m === 'S' ? 'sent' : m.startsWith('F') ? 'failed' : 'skipped';
}
/**
 * งานระดับบัญชีลูกค้า (HANDOFF 207b · ค่าเริ่มต้นของรายการผู้ให้บริการ): งานที่ศูนย์ผู้ให้บริการ + เปิดดูภาพรวม + การแจ้งเตือน
 * ไม่รวมงานเอกสาร/ข้อมูลหลักที่เจ้าหน้าที่คีย์ในบริษัทข้อมูลตัวอย่าง (ติ๊ก "รวมงานในบริษัทตัวอย่าง" เพื่อดู)
 */
export const ACCOUNT_ACTIONS = ['NEW_TENANT', 'EDIT_TENANT', 'PURGE_TENANT', 'TENANT_MODULES', 'TENANT_STANDARD_GROUPS', 'TENANT_DEMO_ON', 'TENANT_DEMO_OFF', 'PV_VIEW',
  'EXPORT_TENANT', 'IMPORT_TENANT', 'MOVE_REQUEST', 'MOVE_REJECT', 'INVITE_EMAIL', 'INVITE_CREATE', 'INVITE_REVOKE', 'USER_UNLOCK', 'USER_RESET_2FA', 'USER_RESET_PASSWORD',
  'API_KEY_CREATE', 'API_KEY_REVOKE', 'API_KEY_SCOPE', 'SIGNUP_REJECT', 'MAIL_SENT', 'MAIL_FAILED', 'MAIL_SKIPPED', 'ADD_PACKAGE', 'EDIT_PACKAGE', 'MAIL_SETTINGS',
  'SIGNUP_SETTINGS', 'AI_PLATFORM_KEY_SET', 'AI_PLATFORM_KEY_REMOVE', 'ALERT_LOCKED', 'ALERT_LOGIN_FAIL', 'ALERT_BURST'] as const;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : null);
/** เปิด/ปิด/วันหมดอายุของโปรแกรม-เมนูที่เปลี่ยน (ไม่มีหมายเหตุภายใน ที่อยู่โปรแกรม จำนวนที่นั่ง) */
function moduleChanges(d: Obj) {
  const before = Array.isArray(d.before) ? (d.before as Obj[]) : [], after = Array.isArray(d.after) ? (d.after as Obj[]) : [];
  const on: string[] = [], off: string[] = [], until: Array<{ key: string; to: string | null }> = [];
  for (const m of after) {
    const key = str(m.key ?? m.module_key);
    if (!key) continue;
    const prev = before.find((b) => (b.module_key ?? b.key) === key);
    const wasOn = prev ? prev.enabled === true : DEFAULT_ON.has(key);
    if (m.enabled === true && !wasOn) on.push(key);
    if (m.enabled === false && wasOn) off.push(key);
    const to = str(m.valid_to), was = prev ? str(prev.valid_to) : null;
    if (m.enabled === true && wasOn && (to ?? null) !== (was ?? null)) until.push({ key, to });
  }
  return { on, off, until };
}
/**
 * สรุปของแต่ละเหตุการณ์ (HANDOFF 207b) — ค่าที่ลูกค้าเห็นได้อยู่แล้วเท่านั้น หน้าจอแปลงเป็นข้อความไทย
 * ไม่ส่งรายละเอียดดิบให้ลูกค้า (หมายเหตุภายใน remark ที่อยู่โปรแกรม จำนวนที่นั่ง ค่าก่อน/หลังทั้งแถว IP ลูกค้ารายอื่น)
 */
export function actionInfo(action: string, detail: unknown, docNo: string | null): Obj | null {
  const d = isObj(detail) ? detail : {};
  switch (action) {
    case 'TENANT_MODULES': return moduleChanges(d);
    case 'EDIT_TENANT': return {
      ...(d.from !== undefined && d.from !== d.status ? { status_from: str(d.from), status_to: str(d.status) } : {}),
      ...(d.package !== undefined ? { package: str(d.package) } : {}),
    };
    case 'TENANT_DEMO_ON': case 'TENANT_DEMO_OFF': return {};
    case 'USER_UNLOCK': case 'USER_RESET_2FA': case 'USER_RESET_PASSWORD': case 'INVITE_CREATE': case 'INVITE_REVOKE':
      return { user: docNo ?? str(d.username) };
    case 'INVITE_EMAIL': return { user: docNo, mail: resultOf(detail) };
    case 'API_KEY_CREATE': case 'API_KEY_REVOKE': case 'API_KEY_SCOPE': return { key: str(d.name) ?? docNo };
    case 'MOVE_REQUEST': case 'MOVE_REJECT': return { companies: str(d.companies) ?? docNo };
    case 'EXPORT_TENANT': case 'IMPORT_TENANT': return { companies: Array.isArray(d.companies) ? d.companies.map(String).join(' ') : null };
    case 'ALERT_LOCKED': case 'ALERT_LOGIN_FAIL': case 'ALERT_BURST': return { count: d.count ?? null, minutes: d.minutes ?? null };
    default: return null;
  }
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ต้องเป็น ปปปป-ดด-วว').optional();
const PAGE = 50;
const SORTS = ['occurred_at', 'tenant_code', 'staff_name', 'action', 'company_code'] as const;

export function providerActionRoutes(app: FastifyInstance, db: Db) {
  const platform = (req: FastifyRequest) => { const a = requireAuth(req); if (!a.isPlatform || a.apiKeyId) throw forbidden('เฉพาะเจ้าหน้าที่ผู้ให้บริการโปรแกรม'); return a; };
  const list = async (f: Filter, q: { page: number; sort?: string; dir: 'asc' | 'desc' }) => {
    const page = sql`LIMIT ${PAGE} OFFSET ${(q.page - 1) * PAGE}`;
    const withTotal = sql`SELECT x.*, count(*) OVER ()::int AS total FROM (${actionsSelect(f)}) x`;
    const rows = (await sortedList(withTotal, q, SORTS, sql`id::bigint DESC`, page, ['occurred_at']).execute(db)).rows as Row[];
    return { rows, total: rows[0]?.total ?? 0, page: q.page, page_size: PAGE };
  };

  /** ผู้ให้บริการ: ทุกลูกค้า · tenant=none = ทั้งระบบ (แพ็กเกจ ค่าตั้ง การแจ้งเตือน) */
  app.get('/api/v1/provider/actions', async (req) => {
    platform(req);
    const q = parse(z.object({ tenant: z.union([z.string().uuid(), z.literal('none')]).optional().or(z.literal('').transform(() => undefined)),
      staff: z.string().uuid().optional().or(z.literal('').transform(() => undefined)), from: day.or(z.literal('').transform(() => undefined)), to: day.or(z.literal('').transform(() => undefined)),
      action: z.string().trim().regex(/^[A-Z0-9_]{1,20}$/).optional().or(z.literal('').transform(() => undefined)), page: z.coerce.number().int().min(1).max(10_000).default(1),
      // HANDOFF 207b: 1 = รวมงานเอกสาร/ข้อมูลหลักในบริษัทข้อมูลตัวอย่าง (ค่าเริ่มต้น = เฉพาะงานระดับบัญชีลูกค้า)
      demo_work: z.enum(['0', '1']).default('0'), ...sortShape }), req.query);
    const r = await list({ ...q, accountOnly: q.demo_work !== '1' }, q);
    const tenants = await db.selectFrom('sys_tenant').select(['id', 'code', 'name', 'is_demo']).where('deleted_at', 'is', null).orderBy('is_demo', 'desc').orderBy('code').execute();
    const staff = await db.selectFrom('sys_user').select(['id', 'username', 'display_name']).where('tenant_id', 'is', null).where('deleted_at', 'is', null).orderBy('username').execute();
    return { ...r, rows: r.rows.map(({ total: _t, ...x }) => ({ ...x, info: actionInfo(x.action, x.detail, x.doc_no), result: resultOf(x.detail) })), tenants, staff };
  });

  /** ลูกค้า (ผู้ดูแลระบบของกิจการ): สิ่งที่ผู้ให้บริการทำกับบัญชีของท่าน — เฉพาะบัญชีของตัวเอง อ่านอย่างเดียว */
  app.get('/api/v1/provider-actions/mine', async (req) => {
    const a = requireAuth(req);
    if (a.apiKeyId) throw forbidden('ดูได้จากหน้าจอเท่านั้น (ไม่ใช่กุญแจ API)');
    if (a.isPlatform) throw forbidden('เจ้าหน้าที่ผู้ให้บริการดูได้ที่ ศูนย์ผู้ให้บริการ › สิ่งที่เจ้าหน้าที่ทำกับบัญชีลูกค้า');
    if (!a.isAdmin || !a.tenantId) throw forbidden('เฉพาะผู้ดูแลระบบ (กลุ่ม ADMIN) ของกิจการ');
    const q = parse(z.object({ from: day.or(z.literal('').transform(() => undefined)), to: day.or(z.literal('').transform(() => undefined)), page: z.coerce.number().int().min(1).max(10_000).default(1), ...sortShape }), req.query);
    const r = await list({ tenant: a.tenantId, from: q.from, to: q.to }, q);
    return { ...r, rows: r.rows.map((x) => ({ id: x.id, occurred_at: x.occurred_at, action: x.action, doc_no: x.doc_no, company_code: x.company_code,
      staff_name: x.staff_name ?? (x.user_id ? null : 'ผู้ดูแลเซิร์ฟเวอร์'), info: actionInfo(x.action, x.detail, x.doc_no), result: resultOf(x.detail) })) };
  });
}
