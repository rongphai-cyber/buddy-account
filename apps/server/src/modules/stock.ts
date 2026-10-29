import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { d } from '@buddy/core';
import type { Db } from '../db.js';
import { notFound, parse, requireCompany } from '../http.js';

/** ยอดสินค้าคงเหลือ + สต๊อกการ์ด — คำนวณสดจากบรรทัดเอกสาร (v_stock_move / v_stock_balance) */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ไม่ถูกต้อง');
const uuid = z.string().uuid();

export function stockRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/v1/stock/balances', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ q: z.string().optional(), warehouse_id: uuid.optional(), item_id: uuid.optional(), zero: z.enum(['Y', 'N']).default('N'), limit: z.coerce.number().int().min(1).max(5000).default(1000) }), req.query);
    const like = q.q?.trim() ? `%${q.q.trim()}%` : null;
    const rows = (await sql<{ qty: string; value: string }>`
      SELECT b.item_id, i.code AS item_code, i.name_th AS item_name, u.code AS unit_code, b.warehouse_id, w.code AS warehouse_code, w.name_th AS warehouse_name,
             b.qty, b.value, CASE WHEN b.qty <> 0 THEN round(b.value / b.qty, 4) END AS avg_cost, b.last_move_date
        FROM v_stock_balance b JOIN md_item i ON i.id = b.item_id JOIN md_warehouse w ON w.id = b.warehouse_id LEFT JOIN md_unit u ON u.id = i.base_unit_id
       WHERE b.company_id = ${a.companyId} ${q.warehouse_id ? sql`AND b.warehouse_id = ${q.warehouse_id}` : sql``} ${q.item_id ? sql`AND b.item_id = ${q.item_id}` : sql``}
         ${q.zero === 'N' ? sql`AND (b.qty <> 0 OR b.value <> 0)` : sql``} ${like ? sql`AND (i.code ILIKE ${like} OR i.name_th ILIKE ${like} OR i.barcode = ${q.q!.trim()})` : sql``}
       ORDER BY i.code, w.code LIMIT ${q.limit}`.execute(db)).rows;
    return { rows, total_qty: rows.reduce((s, r) => s.plus(d(r.qty)), d(0)).toString(), total_value: rows.reduce((s, r) => s.plus(d(r.value)), d(0)).toFixed(2) };
  });

  /** สต๊อกการ์ด: ยอดยกมา (ก่อนวันเริ่ม) + ความเคลื่อนไหวในช่วง พร้อมยอดคงเหลือสะสม · ไม่ระบุคลัง = รวมทุกคลัง */
  app.get('/api/v1/stock/card', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ item_id: uuid, warehouse_id: uuid.optional(), from: isoDate, to: isoDate }), req.query);
    const item = await db.selectFrom('md_item as i').leftJoin('md_unit as u', 'u.id', 'i.base_unit_id').select(['i.id', 'i.code', 'i.name_th', 'u.code as unit_code'])
      .where('i.id', '=', q.item_id).where('i.company_id', '=', a.companyId).executeTakeFirst();
    if (!item) throw notFound('สินค้า');
    const wh = q.warehouse_id ? sql`AND m.warehouse_id = ${q.warehouse_id}` : sql``;
    const open = (await sql<{ qty: string; value: string }>`SELECT coalesce(sum(m.qty), 0) AS qty, coalesce(sum(m.value), 0) AS value FROM v_stock_move m
        WHERE m.company_id = ${a.companyId} AND m.item_id = ${q.item_id} ${wh} AND m.doc_date < ${q.from}`.execute(db)).rows[0]!;
    const rows = (await sql<{ qty: string; value: string }>`SELECT m.doc_date, m.doc_class, m.doc_no, m.header_id, m.line_no, m.movement_code, w.code AS warehouse_code, h.party_name, m.qty, m.value
        FROM v_stock_move m JOIN md_warehouse w ON w.id = m.warehouse_id JOIN doc_header h ON h.id = m.header_id
       WHERE m.company_id = ${a.companyId} AND m.item_id = ${q.item_id} ${wh} AND m.doc_date BETWEEN ${q.from} AND ${q.to}
       ORDER BY m.doc_date, CASE WHEN m.qty > 0 THEN 0 ELSE 1 END, m.doc_no, m.line_no`.execute(db)).rows;
    let bq = d(open.qty), bv = d(open.value);
    const lines = rows.map((r) => { bq = bq.plus(d(r.qty)); bv = bv.plus(d(r.value)); return { ...r, balance_qty: bq.toString(), balance_value: bv.toFixed(2) }; });
    const sum = (k: 'qty' | 'value', sign: 1 | -1) => rows.filter((r) => d(r.qty).times(sign).gt(0) || (d(r.qty).isZero() && d(r.value).times(sign).gt(0))).reduce((s, r) => s.plus(d(r[k]).abs()), d(0));
    return { item, opening: { qty: d(open.qty).toString(), value: d(open.value).toFixed(2) }, lines,
      in: { qty: sum('qty', 1).toString(), value: sum('value', 1).toFixed(2) }, out: { qty: sum('qty', -1).toString(), value: sum('value', -1).toFixed(2) },
      closing: { qty: bq.toString(), value: bv.toFixed(2) } };
  });
}
