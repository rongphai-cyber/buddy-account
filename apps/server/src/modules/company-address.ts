import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { addDays, addressAt, addressDateTaken, rowInEffect, todayIso } from '@buddy/core';
import type { Db } from '../db.js';
import { ADDR_COLS, addrShape } from '../address.js';
import { badRequest, notFound, parse, requireCompany } from '../http.js';
import { logActivity } from '../audit.js';

/**
 * ที่อยู่ของกิจการ ณ วันที่ (HANDOFF 180) — ใช้ทุกที่ที่พิมพ์/ส่งออกที่อยู่ของบริษัทเอง (แบบฟอร์มเอกสาร ใบกำกับภาษี e-Tax แบบภาษีเงินเดือน ใบรับรองแทนใบเสร็จ)
 * แถวประวัติ (sys_address_history) ที่มีผล ณ วันที่ · สาขาที่ไม่มีประวัติ/ที่อยู่ว่าง = ของสำนักงานใหญ่ · ไม่มีประวัติเลย = ที่อยู่ในแฟ้มบริษัท/สาขา (ค่าปัจจุบัน)
 */
export type AddrCol = (typeof ADDR_COLS)[number];
export interface CompanyAddress extends Partial<Record<AddrCol, string | null>> {
  address_th: string; address_en: string; zip_code: string | null;
  /** ที่อยู่ของสาขา (ไม่ใช่สำนักงานใหญ่) — แบบฟอร์มอังกฤษใช้ที่อยู่อังกฤษของบริษัทเฉพาะเมื่อไม่ใช่ที่อยู่สาขา */
  from_branch: boolean;
  /** แถวประวัติที่ใช้ (ว่าง = ยังไม่มีประวัติ ใช้ค่าในแฟ้ม) */
  history_id: string | null; effective_from: string | null;
}
type HRow = { id: string; branch_id: string | null; effective_from: string; address_th: string | null; address_en: string | null; zip_code: string | null; remark?: string | null } & Partial<Record<AddrCol, string | null>>;

/** แถวประวัติที่อยู่ของบริษัท (สำนักงานใหญ่ + สาขาที่ระบุ · ไม่ระบุ = ทุกสาขา) */
export async function addressRows(db: Db, companyId: string, branchId?: string | null): Promise<HRow[]> {
  return (await sql<HRow>`SELECT id, branch_id, effective_from::text AS effective_from, address_th, address_en, zip_code, remark, ${sql.raw(ADDR_COLS.join(', '))}
      FROM sys_address_history WHERE company_id = ${companyId} AND deleted_at IS NULL
       ${branchId === undefined ? sql`` : sql`AND (branch_id IS NULL OR branch_id = ${branchId})`}
     ORDER BY effective_from`.execute(db)).rows;
}

const blank = (v: string | null | undefined) => !v || !v.trim();
const pick = (r: HRow | Record<string, unknown>) => Object.fromEntries(ADDR_COLS.map((k) => [k, (r as Record<string, string | null>)[k] ?? null])) as Partial<Record<AddrCol, string | null>>;

export async function companyAddressAt(db: Db, companyId: string, date: string | null | undefined, branchId?: string | null): Promise<CompanyAddress> {
  const day = String(date || todayIso()).slice(0, 10);
  const rows = await addressRows(db, companyId, branchId ?? null);
  let { row, fromBranch } = addressAt(rows, day, branchId ?? null);
  // แถวของสาขาที่ไม่มีข้อความที่อยู่ = ใช้ของสำนักงานใหญ่
  if (row && fromBranch && blank(row.address_th)) ({ row, fromBranch } = addressAt(rows, day, null));
  if (row) return { address_th: row.address_th ?? '', address_en: fromBranch ? '' : row.address_en ?? '', zip_code: row.zip_code, from_branch: fromBranch, history_id: row.id, effective_from: row.effective_from, ...pick(row) };
  // ยังไม่มีประวัติ (เช่น สาขาเพิ่งเพิ่ม) = ค่าในแฟ้ม: สาขาที่มีที่อยู่ของตัวเอง ไม่งั้นของบริษัท
  const b = branchId ? (await sql<Record<string, string | null> & { is_head_office: boolean }>`SELECT address, zip_code, is_head_office, ${sql.raw(ADDR_COLS.join(', '))} FROM sys_branch WHERE id = ${branchId} AND company_id = ${companyId}`.execute(db)).rows[0] : undefined;
  if (b && !b.is_head_office && !blank(b.address)) return { address_th: b.address ?? '', address_en: '', zip_code: b.zip_code ?? null, from_branch: true, history_id: null, effective_from: null, ...pick(b) };
  const c = (await sql<Record<string, string | null>>`SELECT address_th, address_en, zip_code, ${sql.raw(ADDR_COLS.join(', '))} FROM sys_company WHERE id = ${companyId}`.execute(db)).rows[0] ?? {};
  return { address_th: c.address_th ?? '', address_en: c.address_en ?? '', zip_code: c.zip_code ?? null, from_branch: false, history_id: null, effective_from: null, ...pick(c) };
}

/* ---------------------------------------------------------------- API ประวัติที่อยู่ (HANDOFF 180) */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ไม่ถูกต้อง');
const opt = (n: number) => z.string().trim().max(n).nullable().optional();
const uuid = z.string().uuid();
const lines2 = (x?: string | null, y?: string | null) => [x, y].filter((s) => s && s.trim()).map((s) => s!.trim()).join('\n') || null;
const split2 = (t: string | null | undefined) => { const [l1, ...l2] = (t ?? '').split('\n'); return [l1 ?? '', l2.join(' ')] as const; };
export type AddressFields = { address_th: string | null; address_en: string | null; zip_code: string | null } & Partial<Record<AddrCol, string | null>>;
const ownRows = async (db: Db, companyId: string, branchId: string | null) => (await addressRows(db, companyId, branchId)).filter((r) => (r.branch_id ?? null) === branchId);

/** วันที่มีผลของแถวแรกที่สร้างอัตโนมัติ = ต้นปีบัญชีแรกของบริษัท (ไม่มีปีบัญชี = วันนี้) */
async function firstDate(db: Db, companyId: string) {
  const r = (await sql<{ d: string | null }>`SELECT min(start_date)::text AS d FROM gl_fiscal_year WHERE company_id = ${companyId} AND deleted_at IS NULL`.execute(db)).rows[0];
  return r?.d ?? todayIso();
}
/** ช่องที่อยู่ในแฟ้มบริษัท/สาขา = ที่อยู่ที่มีผลวันนี้ (หน้าจอเดิม รายงาน และระบบอื่นที่อ่านแฟ้มยังได้ค่าปัจจุบัน) */
async function syncCurrent(db: Db, companyId: string, branchId: string | null, userId: string | null) {
  const r = rowInEffect(await ownRows(db, companyId, branchId), todayIso());
  const cols = Object.fromEntries(ADDR_COLS.map((k) => [k, r ? r[k] ?? null : null]));
  if (!branchId) {
    if (!r) return;
    await db.updateTable('sys_company').set({ address_th: r.address_th, address_en: r.address_en, zip_code: r.zip_code, ...cols, updated_by: userId } as never).where('id', '=', companyId).execute();
  } else {
    await db.updateTable('sys_branch').set({ address: r?.address_th ?? null, zip_code: r?.zip_code ?? null, ...cols, updated_by: userId } as never).where('id', '=', branchId).where('company_id', '=', companyId).execute();
  }
}
/**
 * แก้ที่อยู่ที่หน้าจอเดิม (รายละเอียดกิจการ / สาขา) = แก้แถวที่มีผลวันนี้ · ยังไม่มีแถวที่มีผลวันนี้ = สร้างแถว (มีผลตั้งแต่ต้นปีบัญชีแรก)
 * สาขาที่ไม่มีที่อยู่และไม่มีประวัติ = ไม่สร้างแถว (ใช้ที่อยู่สำนักงานใหญ่)
 */
export async function saveCurrentAddress(db: Db, a: { companyId: string; userId: string | null }, branchId: string | null, f: AddressFields) {
  const rows = await ownRows(db, a.companyId, branchId);
  const today = todayIso();
  const cur = rows.filter((r) => r.effective_from <= today).at(-1);
  const vals = { address_th: f.address_th, address_en: branchId ? null : f.address_en, zip_code: f.zip_code, ...Object.fromEntries(ADDR_COLS.map((k) => [k, f[k] ?? null])) };
  if (cur) {
    await db.updateTable('sys_address_history').set({ ...vals, updated_by: a.userId } as never).where('id', '=', cur.id).where('company_id', '=', a.companyId).execute();
    await logActivity(db, a, { module: 'SYS', action: 'EDIT', table: 'sys_address_history', rowId: cur.id, detail: { from: 'current', effective_from: cur.effective_from } });
    return;
  }
  if (branchId && blank(f.address_th)) return;
  const first = await firstDate(db, a.companyId);
  const earliest = rows[0]?.effective_from;
  const r = await db.insertInto('sys_address_history').values({ company_id: a.companyId, branch_id: branchId, effective_from: earliest && earliest <= first ? addDays(earliest, -1) : first, ...vals, created_by: a.userId } as never).returning('id').executeTakeFirstOrThrow();
  await logActivity(db, a, { module: 'SYS', action: 'ADD', table: 'sys_address_history', rowId: r.id, detail: { from: 'current' } });
}

export function companyAddressRoutes(app: FastifyInstance, db: Db) {
  /** สาขาในบริษัทนี้ (ไม่ใช่ = 404) · สาขาสำนักงานใหญ่ = ที่อยู่ของบริษัท (null) */
  const ownerOf = async (companyId: string, branchId: string | null | undefined) => {
    if (!branchId) return null;
    const b = await db.selectFrom('sys_branch').select(['id', 'is_head_office']).where('id', '=', branchId).where('company_id', '=', companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!b) throw notFound('สาขา');
    return b.is_head_office ? null : b.id;
  };
  const view = (r: HRow, same: HRow[], today: string) => {
    const next = same.find((x) => x.effective_from > r.effective_from);
    const [th1, th2] = split2(r.address_th), [en1, en2] = split2(r.address_en);
    return { id: r.id, branch_id: r.branch_id, effective_from: r.effective_from, effective_to: next ? addDays(next.effective_from, -1) : null,
      address_th_1: th1, address_th_2: th2, address_en_1: en1, address_en_2: en2, zip_code: r.zip_code, ...pick(r), remark: r.remark ?? null,
      in_effect: rowInEffect(same, today)?.id === r.id, future: r.effective_from > today };
  };

  app.get('/api/v1/company/addresses', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ branch_id: uuid.optional() }), req.query);
    const owner = await ownerOf(a.companyId, q.branch_id);
    const same = await ownRows(db, a.companyId, owner);
    const today = todayIso();
    return { branch_id: owner, today, rows: same.map((r) => view(r, same, today)).reverse() };
  });

  app.get('/api/v1/company/address-at', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ date: isoDate.optional(), branch_id: uuid.optional() }), req.query);
    const at = await companyAddressAt(db, a.companyId, q.date, await ownerOf(a.companyId, q.branch_id));
    const [th1, th2] = split2(at.address_th), [en1, en2] = split2(at.address_en);
    return { ...at, address_th_1: th1, address_th_2: th2, address_en_1: en1, address_en_2: en2 };
  });

  const body = z.object({
    branch_id: uuid.nullable().optional(), effective_from: isoDate,
    address_th_1: opt(120), address_th_2: opt(120), address_en_1: opt(120), address_en_2: opt(120),
    zip_code: z.string().trim().regex(/^(\d{5})?$/, 'รหัสไปรษณีย์ 5 หลัก').nullable().optional().transform((v) => v || null), ...addrShape, remark: opt(200),
  });
  type Body = z.infer<typeof body>;
  const valsOf = (b: Body, branch: string | null) => ({ address_th: lines2(b.address_th_1, b.address_th_2), address_en: branch ? null : lines2(b.address_en_1, b.address_en_2), zip_code: b.zip_code ?? null,
    ...Object.fromEntries(ADDR_COLS.map((k) => [k, b[k] ?? null])), remark: b.remark?.trim() || null });
  const taken = async (companyId: string, branch: string | null, date: string, except?: string) => {
    if (addressDateTaken(await ownRows(db, companyId, branch), branch, date, except)) throw badRequest(`มีที่อยู่ที่มีผลวันที่ ${date} อยู่แล้ว — แก้รายการนั้นแทน หรือเลือกวันที่อื่น`, [{ field: 'effective_from', message: 'วันที่ซ้ำ' }]);
  };
  const needText = (b: Body) => { if (!lines2(b.address_th_1, b.address_th_2)) throw badRequest('ป้อนที่อยู่ภาษาไทย (บรรทัด 1)', [{ field: 'address_th_1', message: 'ป้อนที่อยู่' }]); };

  app.post('/api/v1/company/addresses', async (req) => {
    const a = requireCompany(req);
    const b = parse(body, req.body);
    needText(b);
    const owner = await ownerOf(a.companyId, b.branch_id);
    await taken(a.companyId, owner, b.effective_from);
    return db.transaction().execute(async (tx) => {
      const r = await tx.insertInto('sys_address_history').values({ company_id: a.companyId, branch_id: owner, effective_from: b.effective_from, ...valsOf(b, owner), created_by: a.userId } as never).returning('id').executeTakeFirstOrThrow();
      await syncCurrent(tx, a.companyId, owner, a.userId);
      await logActivity(tx, a, { module: 'SYS', action: 'ADD', table: 'sys_address_history', rowId: r.id, detail: { branch_id: owner, effective_from: b.effective_from } });
      return { id: r.id };
    });
  });

  app.put('/api/v1/company/addresses/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(body, req.body);
    needText(b);
    const cur = (await ownRowsById(a.companyId, id));
    const owner = cur.branch_id ?? null;
    await taken(a.companyId, owner, b.effective_from, id);
    return db.transaction().execute(async (tx) => {
      await tx.updateTable('sys_address_history').set({ effective_from: b.effective_from, ...valsOf(b, owner), updated_by: a.userId } as never).where('id', '=', id).where('company_id', '=', a.companyId).execute();
      await syncCurrent(tx, a.companyId, owner, a.userId);
      await logActivity(tx, a, { module: 'SYS', action: 'EDIT', table: 'sys_address_history', rowId: id, detail: { before: { effective_from: cur.effective_from, address_th: cur.address_th, address_en: cur.address_en }, after: { effective_from: b.effective_from } } });
      return { id };
    });
  });

  app.delete('/api/v1/company/addresses/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const cur = await ownRowsById(a.companyId, id);
    const owner = cur.branch_id ?? null;
    if (!owner && (await ownRows(db, a.companyId, null)).length <= 1) throw badRequest('ต้องมีที่อยู่ของบริษัทอย่างน้อย 1 รายการ — แก้รายการนี้แทนการลบ');
    return db.transaction().execute(async (tx) => {
      await tx.updateTable('sys_address_history').set({ deleted_at: sql`now()` as never, updated_by: a.userId }).where('id', '=', id).where('company_id', '=', a.companyId).execute();
      await syncCurrent(tx, a.companyId, owner, a.userId);
      await logActivity(tx, a, { module: 'SYS', action: 'DELETE', table: 'sys_address_history', rowId: id, detail: { branch_id: owner, effective_from: cur.effective_from, address_th: cur.address_th } });
      return { ok: true };
    });
  });

  async function ownRowsById(companyId: string, id: string) {
    const r = (await addressRows(db, companyId)).find((x) => x.id === id);
    if (!r) throw notFound('ประวัติที่อยู่');
    return r;
  }
}
