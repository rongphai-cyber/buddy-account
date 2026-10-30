import type { FastifyInstance } from 'fastify';
import { gzipSync } from 'node:zlib';
import { sql } from 'kysely';
import type { Db } from '../db.js';
import { requireCompany } from '../http.js';

/**
 * ชื่อภาษาอังกฤษของข้อมูล (สลับ 2 ภาษา — งานต่อจากข้อกำหนดเจ้าของข้อ 9)
 * โหมด EN: หน้าจอแสดงชื่ออังกฤษที่กรอกไว้แทนชื่อไทย (เฉพาะข้อความที่แสดง ช่องกรอกยังเป็นชื่อไทยเดิม — แก้ไข/บันทึกไม่กระทบข้อมูล)
 * คืน { ชื่อไทย: ชื่ออังกฤษ } ของบริษัทที่เลือก · ชื่อไทยซ้ำกันใช้ตัวแรกตามลำดับตาราง · ส่งแบบ gzip (รายการสินค้าอาจหลายหมื่น)
 */
const SOURCES: Array<[table: string, th: string, en: string]> = [
  ['gl_account', 'name_th', 'name_en'], ['gl_journal_book', 'name_th', 'name_en'], ['md_doc_type', 'name_th', 'name_en'], ['md_payment_method', 'name_th', 'name_en'],
  ['md_lookup', 'name_th', 'name_en'], ['md_lookup', 'short_th', 'short_en'], ['md_unit', 'name_th', 'name_en'], ['md_unit', 'short_th', 'short_en'],
  ['md_warehouse', 'name_th', 'name_en'], ['md_warehouse', 'short_th', 'short_en'], ['md_department', 'name_th', 'name_en'], ['md_department', 'short_name_th', 'short_name_en'],
  ['md_bank', 'name_th', 'name_en'], ['md_bank', 'short_th', 'short_en'], ['md_project', 'name_th', 'name_en'], ['md_item_account_group', 'name_th', 'name_en'],
  ['md_asset_account_group', 'name_th', 'name_en'], ['gl_template', 'name', 'name_en'], ['fa_asset', 'name_th', 'name_en'],
  ['md_customer', 'name', 'name_en'], ['md_supplier', 'name', 'name_en'], ['md_item', 'name_th', 'name_en'],
];
const TH = /[฀-๿]/;

export async function dataNames(db: Db, companyId: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const co = await db.selectFrom('sys_company').select(['name_th', 'name_en']).where('id', '=', companyId).executeTakeFirst();
  if (co?.name_en && TH.test(co.name_th)) out[co.name_th.trim()] = co.name_en.trim();
  for (const [t, th, en] of SOURCES) {
    const rows = (await sql<{ th: string; en: string }>`SELECT DISTINCT ${sql.ref(th)} AS th, ${sql.ref(en)} AS en FROM ${sql.table(t)}
        WHERE company_id = ${companyId} AND deleted_at IS NULL AND coalesce(${sql.ref(en)}, '') <> '' AND ${sql.ref(th)} IS NOT NULL`.execute(db)).rows;
    for (const r of rows) {
      const k = r.th.replace(/\s+/g, ' ').trim(), v = r.en.trim();
      // เฉพาะชื่อไทยที่มีชื่ออังกฤษจริง (ไม่มีอักษรไทยในชื่ออังกฤษ) · ไม่รับ { } ที่จะกลายเป็นช่องแทน
      if (!k || !v || k === v || !TH.test(k) || TH.test(v) || /[{}|]/.test(k) || k in out) continue;
      out[k] = v;
    }
  }
  return out;
}

export function i18nNameRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/v1/i18n/names', async (req, reply) => {
    const a = requireCompany(req);
    const body = JSON.stringify({ names: await dataNames(db, a.companyId) });
    reply.header('content-type', 'application/json; charset=utf-8').header('cache-control', 'private, no-store');
    if (/\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) { reply.header('content-encoding', 'gzip'); return gzipSync(body); }
    return body;
  });
}
