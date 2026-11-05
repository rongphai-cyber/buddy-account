import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Db } from '../db.js';
import { parse, requireCompany } from '../http.js';

/**
 * WTS Connect v1 (docs/17 ข้อ 3.3 · B0.3): ฟีดข้อมูลหลักที่เปลี่ยน ให้ WTS-POS / WTS-Living / WTS-SOP เก็บสำเนาอ่านอย่างเดียว (`ref_*`)
 * ต่อยอดจาก sync_change_log (trigger บันทึกทุกการเพิ่ม/แก้/ลบ) · ตอบเฉพาะช่องที่โปรแกรมอื่นต้องใช้
 *   GET /api/v1/changes?types=item,customer&since=<cursor>
 *   - ไม่ส่ง since (หรือ 0) = ข้อมูลทั้งหมดของชนิดที่ขอ (ครั้งแรก) + next_cursor ล่าสุด
 *   - since = ค่า next_cursor ครั้งก่อน → เฉพาะแถวที่เปลี่ยนหลังจากนั้น (ครั้งละไม่เกิน limit รายการใน log · more = ยังมีต่อ)
 *   - op: upsert (data = ค่าปัจจุบัน · status I = เลิกใช้) / delete (ถูกลบ — ให้ลบสำเนา)
 */
export const CHANGE_TYPES = {
  item: { table: 'md_item', cols: ['code', 'item_type', 'barcode', 'name_th', 'name_en', 'category_code', 'base_unit_id', 'sales_unit_id', 'sales_factor', 'purchase_unit_id', 'purchase_factor', 'price_1', 'price_2', 'price_3', 'price_4', 'price_5', 'vat_code', 'default_supplier_id', 'std_cost', 'status'] },
  customer: { table: 'md_customer', cols: ['code', 'customer_type', 'title', 'name', 'name_en', 'address_1', 'address_2', 'address_3', 'zip_code', 'addr_no', 'addr_moo', 'addr_village', 'addr_building', 'addr_room', 'addr_floor', 'addr_soi', 'addr_road', 'addr_geo_code', 'phone', 'email', 'tax_id', 'tax_branch_no', 'credit_days', 'credit_limit', 'price_level', 'price_type', 'on_hold', 'status'] },
  supplier: { table: 'md_supplier', cols: ['code', 'supplier_type', 'title', 'name', 'name_en', 'address_1', 'address_2', 'address_3', 'zip_code', 'addr_no', 'addr_moo', 'addr_village', 'addr_building', 'addr_room', 'addr_floor', 'addr_soi', 'addr_road', 'addr_geo_code', 'phone', 'email', 'tax_id', 'tax_branch_no', 'credit_days', 'price_type', 'vat_rate', 'on_hold', 'status'] },
  branch: { table: 'sys_branch', cols: ['code', 'name', 'tax_branch_no', 'address', 'zip_code', 'addr_no', 'addr_moo', 'addr_village', 'addr_building', 'addr_room', 'addr_floor', 'addr_soi', 'addr_road', 'addr_geo_code', 'is_head_office', 'default_warehouse_id', 'status'] },
  warehouse: { table: 'md_warehouse', cols: ['code', 'name_th', 'name_en', 'branch_id', 'status'] },
  payment_method: { table: 'md_payment_method', cols: ['direction', 'code', 'seq', 'name_th', 'name_en', 'kind', 'gl_account_id', 'bank_account_id', 'creates_cheque', 'status'] },
  bank_account: { table: 'md_bank_account', cols: ['code', 'name', 'branch', 'short_name', 'account_number', 'account_kind', 'gl_account_id', 'currency', 'status'] },
  doc_type: { table: 'md_doc_type', cols: ['code', 'doc_class', 'module', 'name_th', 'name_en', 'price_type', 'vat_rate', 'is_tax_invoice', 'department_id', 'warehouse_id', 'status'] },
  unit: { table: 'md_unit', cols: ['code', 'name_th', 'name_en', 'status'] },
  account: { table: 'gl_account', cols: ['account_no', 'name_th', 'name_en', 'parent_id', 'level', 'account_group', 'is_control', 'normal_side', 'use_department', 'use_project', 'status'] },
  department: { table: 'md_department', cols: ['code', 'name_th', 'name_en', 'status'] },
} as const;
type ChangeType = keyof typeof CHANGE_TYPES;
const TYPE_OF = new Map(Object.entries(CHANGE_TYPES).map(([k, v]) => [v.table as string, k as ChangeType]));

type Change = { type: ChangeType; id: string; op: 'upsert' | 'delete'; data: Record<string, unknown> | null };

const query = z.object({
  types: z.string().trim().min(1, `ระบุ types เช่น item,customer — ใช้ได้: ${Object.keys(CHANGE_TYPES).join(',')}`)
    .transform((v, ctx) => {
      const list = [...new Set(v.split(',').map((x) => x.trim()).filter(Boolean))];
      const bad = list.filter((x) => !(x in CHANGE_TYPES));
      if (bad.length) ctx.addIssue({ code: 'custom', message: `ไม่รู้จักชนิด ${bad.join(',')} — ใช้ได้: ${Object.keys(CHANGE_TYPES).join(',')}` });
      return list as ChangeType[];
    }),
  since: z.string().regex(/^\d{1,18}$/, 'since ต้องเป็นค่า next_cursor ที่ได้ครั้งก่อน (ตัวเลข)').optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(1000),
});

/** ค่าปัจจุบันของแถว (ที่ยังไม่ถูกลบ) ตามช่องที่ฟีดส่ง — ids ว่าง = ทั้งหมดของบริษัท */
async function current(db: Db, companyId: string, type: ChangeType, ids: string[] | null) {
  const t = CHANGE_TYPES[type];
  if (ids && !ids.length) return [];
  const cols = sql.join(['id', ...t.cols].map((c) => sql.ref(`x.${c}`)));
  const filter = ids ? sql`AND x.id IN (${sql.join(ids.map((x) => sql`${x}::uuid`))})` : sql``;
  const r = await sql<Record<string, unknown>>`SELECT ${cols} FROM ${sql.table(t.table)} x WHERE x.company_id = ${companyId} AND x.deleted_at IS NULL ${filter} ORDER BY x.id`.execute(db);
  return r.rows;
}

/**
 * อ่าน log เฉพาะรายการที่เก่ากว่า HOLDBACK มิลลิวินาที: รายการของทรานแซกชันที่ยังไม่ commit อาจได้ seq น้อยกว่ารายการที่ commit แล้ว
 * ถ้า cursor เลยไปก่อนจะไม่ได้รับ — รอสักครู่ให้บันทึกเสร็จ (ทดสอบตั้ง 0) · ถ้าสงสัยว่าขาด ให้ดึงใหม่ทั้งหมด (ไม่ส่ง since)
 */
const HOLDBACK_MS = () => Number(process.env.BUDDY_CHANGES_HOLDBACK_MS ?? 3000);

export function changeRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/v1/changes', async (req) => {
    const a = requireCompany(req);
    const q = parse(query, req.query);
    const settled = sql`changed_at <= now() - make_interval(secs => ${HOLDBACK_MS() / 1000}::double precision)`;
    const max = async () => (await sql<{ s: string | null }>`SELECT max(seq)::text AS s FROM sync_change_log WHERE company_id = ${a.companyId} AND ${settled}`.execute(db)).rows[0]?.s ?? '0';
    const since = q.since && q.since !== '0' ? q.since : null;
    const changes: Change[] = [];
    if (!since) {
      // ครั้งแรก: ข้อมูลทั้งหมด · cursor ณ ก่อนอ่าน (แถวที่เปลี่ยนระหว่างนี้จะมาอีกครั้งในรอบถัดไป — ไม่หาย)
      const cursor = await max();
      for (const type of q.types) for (const row of await current(db, a.companyId, type, null)) changes.push({ type, id: String(row.id), op: 'upsert', data: row });
      return { changes, next_cursor: cursor, more: false, full: true };
    }
    const tables = q.types.map((t) => CHANGE_TYPES[t].table);
    const upto = await max();
    const log = (await sql<{ seq: string; table_name: string; row_id: string }>`SELECT seq::text AS seq, table_name, row_id FROM sync_change_log
        WHERE company_id = ${a.companyId} AND seq > ${since}::bigint AND seq <= ${upto}::bigint AND table_name IN (${sql.join(tables)}) ORDER BY seq LIMIT ${q.limit}`.execute(db)).rows;
    // แถวเดียวกันเปลี่ยนหลายครั้ง → ส่งครั้งเดียวด้วยค่าล่าสุด
    const byType = new Map<ChangeType, Set<string>>();
    for (const l of log) {
      const type = TYPE_OF.get(l.table_name)!;
      if (!byType.has(type)) byType.set(type, new Set());
      byType.get(type)!.add(l.row_id);
    }
    for (const [type, idSet] of byType) {
      const ids = [...idSet];
      const found = new Map((await current(db, a.companyId, type, ids)).map((r) => [String(r.id), r]));
      for (const id of ids) {
        const row = found.get(id);
        changes.push(row ? { type, id, op: 'upsert', data: row } : { type, id, op: 'delete', data: null });
      }
    }
    const more = log.length === q.limit;
    // ไม่มีอะไรเปลี่ยนในชนิดที่ขอ → เลื่อน cursor ไปท้ายสุด (ไม่ต้องไล่ log ของตารางอื่นซ้ำ)
    const next = more ? log.at(-1)!.seq : BigInt(upto) > BigInt(since) ? upto : since;
    return { changes, next_cursor: next, more, full: false };
  });
}
