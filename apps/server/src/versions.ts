import { sql } from 'kysely';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { DATA_TABLES, TRADE_KINDS, SETTLE_KINDS, CASH_KINDS, BANK_KINDS, STOCK_KINDS, BILL_KINDS, DEPOSIT_REFUND } from '@buddy/core';
import type { Db } from './db.js';
import { AppError } from './http.js';

/**
 * แก้พร้อมกันสองคน (HANDOFF 163 · ข้อ d รายงาน 156 ส่วน A · เจ้าของ "ทำงานที่ยังไม่ได้ทำ"): ล็อกแบบมองโลกในแง่ดีด้วย row_version
 * - GET รายการเดียว/ตาราง: ส่งรุ่นปัจจุบันใน header x-row-version
 * - PUT ที่ส่ง x-if-version มาด้วย: ล็อกแถว (FOR UPDATE) แล้วเทียบ — คนอื่นบันทึกไปก่อน = 409 VERSION_CONFLICT บอกชื่อและเวลา (การแก้ไขยังไม่ถูกบันทึก)
 *   ไม่ส่ง x-if-version (กุญแจ API ระบบอื่น · เครื่องสาขา · หน้าจอรุ่นเก่า) = บันทึกได้เหมือนเดิม
 * - บันทึกสำเร็จ = เพิ่มรุ่นของแถวเสมอ (แก้เฉพาะรายการในเอกสารก็นับ) แล้วส่งรุ่นใหม่กลับ — หน้าจอบันทึกซ้ำได้โดยไม่ต้องเปิดใหม่
 * ตารางหลายแถว (ตารางข้อมูล วิธีรับ/จ่าย ค่าเริ่มต้น สิทธิ์รายเมนู) = รุ่นของทั้งตาราง (แถวใดเปลี่ยน/เพิ่ม/ลบ = รุ่นเปลี่ยน)
 */
type Res = { kind: 'row'; table: string; word: string; noCompany?: boolean } | { kind: 'sheet'; word: string; rows: (req: FastifyRequest, companyId: string) => ReturnType<typeof sql> | null };
const DOC = (p: string) => [`/api/v1/${p}/:id`, { kind: 'row', table: 'doc_header', word: 'เอกสารนี้' }] as const;
const MASTER = (url: string, table: string) => [url, { kind: 'row', table, word: 'ข้อมูลนี้' }] as const;
const docPaths = [...TRADE_KINDS, ...SETTLE_KINDS, ...CASH_KINDS, ...BANK_KINDS, ...STOCK_KINDS, ...BILL_KINDS, DEPOSIT_REFUND].map((k) => k.path);
const p = (req: FastifyRequest) => (req.params ?? {}) as Record<string, string>;
const q = (req: FastifyRequest) => ({ ...((req.query ?? {}) as Record<string, string>), ...((req.method === 'PUT' && req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, string>) });

export const VERSIONED: Record<string, Res> = Object.fromEntries([
  ...[...new Set([...docPaths, 'ap-opening', 'ar-opening', 'ar-deposit-opening', 'ar-deposits', 'ap-deposits', 'petty-payments', 'petty-reimbursements', 'stock-opening', 'cheque-deposits'])].map(DOC),
  ['/api/v1/gl/journals/:id', { kind: 'row', table: 'gl_journal', word: 'ใบสำคัญนี้' }],
  MASTER('/api/v1/customers/:id', 'md_customer'), MASTER('/api/v1/suppliers/:id', 'md_supplier'), MASTER('/api/v1/salespersons/:id', 'md_salesperson'),
  ...['items', 'services', 'kits', 'other-expenses', 'other-incomes'].map((x) => MASTER(`/api/v1/${x}/:id`, 'md_item')),
  MASTER('/api/v1/fa/assets/:id', 'fa_asset'), MASTER('/api/v1/doc-types/:id', 'md_doc_type'), MASTER('/api/v1/pay/employees/:id', 'pay_employee'),
  MASTER('/api/v1/cheques/:id', 'fin_cheque'), MASTER('/api/v1/wht/:id', 'tax_wht_entry'),
  ['/api/v1/company', { kind: 'row', table: 'sys_company', word: 'รายละเอียดกิจการ', noCompany: true }],
  ['/api/v1/data-tables/:code', { kind: 'sheet', word: 'ตารางนี้', rows: (req, co) => {
    const t = DATA_TABLES.find((x) => x.code === p(req).code);
    if (!t) return null;
    return t.table === 'md_lookup' ? sql`SELECT id, row_version, updated_at, updated_by FROM md_lookup WHERE company_id = ${co} AND type_code = ${t.code} AND deleted_at IS NULL`
      : sql`SELECT id, row_version, updated_at, updated_by FROM ${sql.table(t.table)} WHERE company_id = ${co} AND deleted_at IS NULL`;
  } }],
  ['/api/v1/payment-methods/:direction', { kind: 'sheet', word: 'ตารางนี้', rows: (req, co) => sql`SELECT id, row_version, updated_at, updated_by FROM md_payment_method WHERE company_id = ${co} AND direction = ${p(req).direction ?? ''} AND deleted_at IS NULL` }],
  ['/api/v1/settings', { kind: 'sheet', word: 'ค่าเริ่มต้นนี้', rows: (_req, co) => sql`SELECT id, row_version, updated_at, updated_by FROM sys_setting WHERE company_id = ${co} AND branch_id IS NULL AND deleted_at IS NULL` }],
  ['/api/v1/permissions', { kind: 'sheet', word: 'ตารางสิทธิ์นี้', rows: (req, co) => {
    const x = q(req);
    if (!/^[UG]$/.test(x.subject_type ?? '') || !/^[0-9a-f-]{36}$/i.test(x.subject_id ?? '')) return null;
    return sql`SELECT id, row_version, updated_at, updated_by FROM sys_permission WHERE company_id = ${co} AND subject_type = ${x.subject_type} AND subject_id = ${x.subject_id}::uuid AND deleted_at IS NULL`;
  } }],
] as Array<readonly [string, Res]>);

type Tok = { v: string; at: Date | string | null; by: string | null };
async function tokenOf(db: Db, res: Res, req: FastifyRequest, companyId: string, lock: boolean): Promise<Tok | null> {
  if (res.kind === 'row') {
    const id = res.noCompany ? companyId : p(req).id;
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    const where = res.noCompany ? sql`t.id = ${id}` : sql`t.id = ${id} AND t.company_id = ${companyId}`;
    const r = (await sql<Tok>`SELECT t.row_version::text AS v, t.updated_at AS at, (SELECT coalesce(u.display_name, u.username) FROM sys_user u WHERE u.id = t.updated_by) AS by
      FROM ${sql.table(res.table)} t WHERE ${where} ${lock ? sql`FOR UPDATE OF t` : sql``}`.execute(db)).rows[0];
    return r ?? null;
  }
  const rows = res.rows(req, companyId);
  if (!rows) return null;
  // ตารางหลายแถว: บันทึกทีละคน (advisory lock ของทรานแซกชัน) แล้วเทียบลายนิ้วมือของทั้งตาราง
  if (lock) await sql`SELECT pg_advisory_xact_lock(hashtext(${`${req.routeOptions?.url}|${companyId}|${JSON.stringify(p(req))}|${q(req).subject_id ?? ''}`}))`.execute(db);
  const r = (await sql<Tok>`SELECT md5(coalesce(string_agg(s.id::text || ':' || s.row_version, ',' ORDER BY s.id), '')) AS v, max(s.updated_at) AS at,
      (SELECT coalesce(u.display_name, u.username) FROM sys_user u WHERE u.id = (array_agg(s.updated_by ORDER BY s.updated_at DESC))[1]) AS by FROM (${rows}) s`.execute(db)).rows[0];
  return r ?? null;
}

/** วันเวลาแบบ พ.ศ. เวลาไทย — 20/11/2569 14:05 */
function thaiTime(at: Date | string | null) {
  if (!at) return '';
  const t = new Date(new Date(at).getTime() + 7 * 3600_000);
  const z = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCDate()}/${t.getUTCMonth() + 1}/${t.getUTCFullYear() + 543} ${z(t.getUTCHours())}:${z(t.getUTCMinutes())}`;
}

/** ห่อตัวจัดการ API ข้อมูลบริษัท (ในทรานแซกชันของคำขอ — permissions.ts) */
export async function withVersion(db: Db, url: string, req: FastifyRequest, reply: FastifyReply, companyId: string, fn: () => unknown) {
  const res = VERSIONED[url];
  if (!res || (req.method !== 'GET' && req.method !== 'PUT')) return fn();
  if (req.method === 'GET') {
    const out = await fn();
    if (reply.statusCode < 300) { const t = await tokenOf(db, res, req, companyId, false); if (t) reply.header('x-row-version', t.v); }
    return out;
  }
  const want = req.headers['x-if-version'];
  if (typeof want === 'string' && want) {
    const cur = await tokenOf(db, res, req, companyId, true);
    if (cur && cur.v !== want) {
      throw new AppError(409, 'VERSION_CONFLICT', `${res.word}ถูกแก้ไขโดย ${cur.by ?? 'ผู้ใช้อื่น'} เมื่อ ${thaiTime(cur.at)} หลังจากคุณเปิด — เปิดใหม่เพื่อดูฉบับล่าสุด แล้วแก้อีกครั้ง (การแก้ไขของคุณยังไม่ถูกบันทึก)`);
    }
  } else await tokenOf(db, res, req, companyId, true);   // ไม่เทียบ (ระบบอื่น/เครื่องสาขา) แต่ยังบันทึกทีละคน
  const out = await fn();
  if (reply.statusCode < 300) {
    // บันทึกแล้ว = รุ่นใหม่เสมอ (เช่น แก้เฉพาะรายการสินค้า หัวเอกสารไม่เปลี่ยน)
    if (res.kind === 'row') {
      const id = res.noCompany ? companyId : p(req).id;
      if (id && /^[0-9a-f-]{36}$/i.test(id)) await sql`UPDATE ${sql.table(res.table)} SET row_version = row_version + 1 WHERE id = ${id}`.execute(db);
    }
    const t = await tokenOf(db, res, req, companyId, false);
    if (t) reply.header('x-row-version', t.v);
  }
  return out;
}
