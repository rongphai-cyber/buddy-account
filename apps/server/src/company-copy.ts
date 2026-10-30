import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { Db } from './db.js';

/**
 * คัดลอกข้อมูลจากบริษัทต้นแบบ (คู่มือบทที่ 4 S-CO-04/05/06) — ค่าตั้งระบบทั้งหมด และเลือกได้ว่าจะรวมแฟ้มหลักหรือไม่
 * ทุกแถวได้ id ใหม่ · คอลัมน์ที่อ้างตารางที่คัดลอกมาถูกแปลงเป็น id ใหม่ · อ้างตารางที่ไม่ได้คัดลอก (เช่น สาขา ปีบัญชี) = ว่าง
 * ไม่คัดลอกรายการประจำวัน ยอดยกมา งบประมาณ สิทธิ์ผู้ใช้ — กฎการลงบัญชีมาจากแม่แบบมาตรฐาน (applyPostingTemplate)
 */
export const COPY_SETUP = ['gl_account', 'gl_default_account', 'gl_journal_book', 'gl_template', 'gl_template_line', 'md_lookup', 'md_unit', 'md_warehouse', 'md_department', 'md_bank', 'md_project',
  'md_item_account_group', 'md_asset_account_group', 'md_bank_account', 'md_doc_type', 'md_doc_type_account', 'md_payment_method', 'sys_setting', 'sys_print_form', 'sys_report_custom', 'gl_fs_report', 'gl_fs_line'];
export const COPY_MASTERS = ['md_salesperson', 'md_customer', 'md_customer_ship_to', 'md_supplier', 'md_party_contact', 'md_supplier_bank', 'md_item', 'md_item_bom', 'md_item_price_break', 'md_item_reorder', 'md_item_image', 'md_note'];

export async function copyCompanyData(tx: Db, fromId: string, toId: string, userId: string, withMasters: boolean) {
  const has = new Set((await sql<{ t: string }>`SELECT table_name AS t FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'company_id'`.execute(tx)).rows.map((r) => r.t));
  const tables = [...COPY_SETUP, ...(withMasters ? COPY_MASTERS : [])].filter((t) => has.has(t));
  const fks = (await sql<{ tbl: string; col: string; ref: string }>`SELECT kcu.table_name AS tbl, kcu.column_name AS col, ccu.table_name AS ref
      FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
      JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
     WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`.execute(tx)).rows;
  const notNull = new Set((await sql<{ k: string }>`SELECT table_name || '.' || column_name AS k FROM information_schema.columns WHERE table_schema = 'public' AND is_nullable = 'NO'`.execute(tx)).rows.map((r) => r.k));
  const data = new Map<string, Array<Record<string, unknown>>>();
  const map = new Map<string, string>();
  for (const t of tables) {
    const rows = (await sql<{ j: Record<string, unknown> }>`SELECT to_jsonb(x) AS j FROM ${sql.table(t)} x WHERE x.company_id = ${fromId} AND x.deleted_at IS NULL`.execute(tx)).rows.map((r) => (typeof r.j === 'string' ? JSON.parse(r.j) : r.j));
    // ค่าตั้งเฉพาะสาขาของบริษัทต้นแบบไม่คัดลอก (บริษัทใหม่มีสาขาของตัวเอง)
    const keep = t === 'sys_setting' ? rows.filter((r) => !r.branch_id) : rows;
    for (const r of keep) map.set(String(r.id), randomUUID());
    data.set(t, keep);
  }
  const counts: Record<string, number> = {};
  for (const t of tables) {
    const refs = fks.filter((f) => f.tbl === t && !['company_id', 'created_by', 'updated_by', 'origin_device_id'].includes(f.col));
    const out: Array<Record<string, unknown>> = [];
    for (const r of data.get(t)!) {
      const n: Record<string, unknown> = { ...r, id: map.get(String(r.id)), company_id: toId, created_by: userId, updated_by: userId, origin_device_id: null, row_version: 1 };
      let skip = false;
      for (const f of refs) {
        const v = r[f.col];
        if (v === null || v === undefined) continue;
        const nv = map.get(String(v));
        if (nv) n[f.col] = nv;
        else if (notNull.has(`${t}.${f.col}`)) { skip = true; break; }
        else n[f.col] = null;
      }
      // หมายเหตุแฟ้มหลักอ้างสินค้า/ลูกค้า/ผู้จำหน่ายด้วย entity_id (ไม่มี FK)
      if (t === 'md_note') { const nv = map.get(String(r.entity_id)); if (!nv) skip = true; else n.entity_id = nv; }
      if (!skip) out.push(n);
    }
    for (let i = 0; i < out.length; i += 1000) await sql`INSERT INTO ${sql.table(t)} SELECT * FROM json_populate_recordset(NULL::${sql.table(t)}, ${JSON.stringify(out.slice(i, i + 1000))}::json)`.execute(tx);
    counts[t] = out.length;
  }
  return counts;
}
