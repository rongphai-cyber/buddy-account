import { sql, type RawBuilder } from 'kysely';
import { z } from 'zod';
import { badRequest } from './http.js';

/**
 * เรียงรายการเอกสารตามคอลัมน์ที่ผู้ใช้คลิก (HANDOFF 195) — เรียงทั้งชุดที่ค้นได้ก่อนตัดจำนวน (LIMIT/OFFSET) ไม่ใช่เฉพาะหน้าที่เห็น
 * รับได้เฉพาะชื่อคอลัมน์ในผลลัพธ์ที่หน้าจอนั้นอนุญาต (ไม่รับ SQL จากหน้าจอ) · เงื่อนไข company_id/สาขา อยู่ในคำสั่งเดิมทั้งหมด
 * ไม่ส่ง sort = ลำดับเดิมของหน้าจอ (คำสั่งเดิมทุกตัวอักษร)
 */
export const sortShape = {
  sort: z.string().regex(/^[a-z_]{1,40}$/, 'ชื่อคอลัมน์ที่จะเรียงไม่ถูกต้อง').optional(),
  dir: z.enum(['asc', 'desc']).default('asc'),
};
export type SortArgs = { sort?: string; dir: 'asc' | 'desc' };

/**
 * select = SELECT ... FROM ... WHERE ... (ไม่มี ORDER BY/LIMIT) · dflt = ลำดับเดิม · page = LIMIT/OFFSET
 * allowed = ชื่อคอลัมน์ในผลลัพธ์ที่เรียงได้ · tie = คอลัมน์ที่ใช้เรียงต่อเมื่อค่าเท่ากัน (มากไปน้อย ตามลำดับเดิม)
 * สถานะ (doc_status) เรียงตามข้อความ ปกติ ก่อน ยกเลิก
 */
export function sortedList(select: RawBuilder<unknown>, q: SortArgs, allowed: readonly string[], dflt: RawBuilder<unknown>, page: RawBuilder<unknown>, tie: readonly string[] = ['doc_date', 'doc_no']) {
  if (!q.sort) return sql`${select} ORDER BY ${dflt} ${page}`;
  if (!allowed.includes(q.sort)) throw badRequest(`เรียงตามคอลัมน์ "${q.sort}" ไม่ได้ — คลิกหัวคอลัมน์อื่น หรือกลับไปลำดับเดิม`);
  const col = sql.ref(`x.${q.sort}`);
  const key = q.sort === 'doc_status' ? sql`(x.doc_status = 'C')` : col;
  const dir = sql.raw(q.dir === 'desc' ? 'DESC' : 'ASC');
  const ties = tie.filter((t) => t !== q.sort).map((t) => sql`${sql.ref(`x.${t}`)} DESC`);
  return sql`SELECT * FROM (${select}) x ORDER BY ${key} ${dir} NULLS LAST, ${sql.join([...ties, sql`x.id`])} ${page}`;
}
