import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { d, STOCK_KINDS } from '@buddy/core';
import type { Db } from '../../db.js';
import { badRequest, notFound, parse, requireCompany, type AuthContext } from '../../http.js';
import { logActivity } from '../../audit.js';
import { cancelStockDoc, countLinked, writeStockDoc } from './stockdocs.js';

/**
 * ตรวจนับสินค้า (คู่มือบทที่ 14 S-IC-15..22) — inv_stock_count เก็บผลนับต่อ คลัง+สินค้า+วันที่นับ
 * flag 1 = เตรียมนับ (ยังไม่นับ = คงยอดเดิม) · 3 = บันทึกยอดนับแล้ว · 6 = ปรับปรุงแล้ว (มีใบปรับปรุง JU/TK)
 * ยอดตามระบบ ณ วันนับคำนวณสดจาก v_stock_move ทุกครั้ง (ไม่เก็บยอดสะสม) — system_qty/diff_qty บันทึกเฉพาะตอนปรับปรุงเพื่อเป็นหลักฐาน
 */
type Ctx = AuthContext & { companyId: string };
const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ไม่ถูกต้อง');
const code = z.string().trim().max(30).optional().transform((v) => v || null);
const JU = STOCK_KINDS.find((k) => k.cls === 'JU')!;

/** ยอดคงเหลือ ณ วันที่ (รวมวันนั้น) ของคู่ คลัง+สินค้า */
const balanceAt = (date: string) => sql`(SELECT coalesce(sum(m.qty), 0) FROM v_stock_move m WHERE m.company_id = c.company_id AND m.item_id = c.item_id AND m.warehouse_id = c.warehouse_id AND m.doc_date <= ${date})`;

async function whScope(db: Db, companyId: string, from: string | null, to: string | null) {
  const rows = await db.selectFrom('md_warehouse').select(['id', 'code']).where('company_id', '=', companyId).where('deleted_at', 'is', null)
    .$if(!!from, (q) => q.where('code', '>=', from!)).$if(!!to, (q) => q.where('code', '<=', to!)).execute();
  if (!rows.length) throw badRequest('ไม่พบคลังสินค้าในช่วงที่เลือก');
  return rows.map((r) => r.id);
}

export function stockCountRoutes(app: FastifyInstance, db: Db) {
  /** วันที่ตรวจนับที่มีข้อมูล + จำนวนตามสถานะ */
  app.get('/api/v1/stock-counts/dates', async (req) => {
    const a = requireCompany(req);
    const rows = (await sql`SELECT count_date, count(*)::int AS total, count(*) FILTER (WHERE flag = '3')::int AS counted, count(*) FILTER (WHERE flag = '6')::int AS adjusted
        FROM inv_stock_count WHERE company_id = ${a.companyId} AND deleted_at IS NULL GROUP BY count_date ORDER BY count_date DESC LIMIT 200`.execute(db)).rows;
    return { rows };
  });

  /** S-IC-15 สร้างข้อมูลเพื่อการตรวจนับ: คู่ คลัง+สินค้า ที่เคยเคลื่อนไหวถึงวันนับ ตามช่วงคลัง/รหัสสินค้า */
  app.post('/api/v1/stock-counts/prepare', async (req) => {
    const a = requireCompany(req);
    const b = parse(z.object({ count_date: isoDate, replace: z.boolean().default(true), warehouse_from: code, warehouse_to: code, item_from: code, item_to: code,
      counted_before: isoDate.nullable().optional(), moved_after: isoDate.nullable().optional() }), req.body);
    const whs = await whScope(db, a.companyId, b.warehouse_from, b.warehouse_to);
    return db.transaction().execute(async (tx) => {
      let removed = 0;
      if (b.replace) {
        // ลบข้อมูลนับครั้งก่อนที่ยังไม่ปรับปรุง (ไม่กระทบยอดคงเหลือจริง) — ที่ปรับปรุงแล้วเก็บเป็นประวัติ
        removed = Number((await sql`UPDATE inv_stock_count SET deleted_at = now(), updated_by = ${a.userId} WHERE company_id = ${a.companyId} AND deleted_at IS NULL AND flag <> '6'
            AND warehouse_id IN (${sql.join(whs)})`.execute(tx)).numAffectedRows ?? 0);
      }
      const r = await sql`INSERT INTO inv_stock_count (company_id, warehouse_id, item_id, count_date, shelf, flag, created_by, updated_by)
        SELECT ${a.companyId}, p.warehouse_id, p.item_id, ${b.count_date}, sb.shelf, '1', ${a.userId}, ${a.userId}
          FROM (SELECT DISTINCT m.warehouse_id, m.item_id FROM v_stock_move m WHERE m.company_id = ${a.companyId} AND m.doc_date <= ${b.count_date} AND m.warehouse_id IN (${sql.join(whs)})) p
          JOIN md_item i ON i.id = p.item_id AND i.item_type = '0' AND i.deleted_at IS NULL
          LEFT JOIN inv_stock_balance sb ON sb.company_id = ${a.companyId} AND sb.item_id = p.item_id AND sb.warehouse_id = p.warehouse_id
         WHERE TRUE ${b.item_from ? sql`AND i.code >= ${b.item_from}` : sql``} ${b.item_to ? sql`AND i.code <= ${b.item_to}` : sql``}
           ${b.moved_after ? sql`AND EXISTS (SELECT 1 FROM v_stock_move x WHERE x.company_id = ${a.companyId} AND x.item_id = p.item_id AND x.warehouse_id = p.warehouse_id AND x.doc_date > ${b.moved_after})` : sql``}
           ${b.counted_before ? sql`AND NOT EXISTS (SELECT 1 FROM inv_stock_count y WHERE y.company_id = ${a.companyId} AND y.item_id = p.item_id AND y.warehouse_id = p.warehouse_id AND y.flag = '6' AND y.deleted_at IS NULL AND y.count_date >= ${b.counted_before})` : sql``}
           AND NOT EXISTS (SELECT 1 FROM inv_stock_count e WHERE e.company_id = ${a.companyId} AND e.item_id = p.item_id AND e.warehouse_id = p.warehouse_id AND e.count_date = ${b.count_date} AND e.deleted_at IS NULL)`.execute(tx);
      const added = Number(r.numAffectedRows ?? 0);
      await logActivity(tx, a, { module: 'IC', action: 'ADD', docNo: `COUNT ${b.count_date}`, table: 'inv_stock_count', rowId: null });
      return { added, removed };
    });
  });

  /** เพิ่มสินค้าที่ไม่มีในรายการนับ (เช่น ของที่พบในคลังแต่ไม่เคยมีความเคลื่อนไหว) */
  app.post('/api/v1/stock-counts/rows', async (req) => {
    const a = requireCompany(req);
    const b = parse(z.object({ count_date: isoDate, warehouse_id: uuid, item_id: uuid }), req.body);
    const wh = await db.selectFrom('md_warehouse').select('id').where('id', '=', b.warehouse_id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    const it = await db.selectFrom('md_item').select(['id', 'item_type']).where('id', '=', b.item_id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!wh || !it) throw notFound('คลังหรือสินค้า');
    if (it.item_type !== '0') throw badRequest('ตรวจนับได้เฉพาะสินค้าที่มีสต๊อก');
    const dup = await db.selectFrom('inv_stock_count').select('id').where('company_id', '=', a.companyId).where('warehouse_id', '=', b.warehouse_id).where('item_id', '=', b.item_id).where('count_date', '=', b.count_date).where('deleted_at', 'is', null).executeTakeFirst();
    if (dup) throw badRequest('สินค้านี้อยู่ในรายการนับของคลังและวันที่นี้แล้ว');
    const r = await db.insertInto('inv_stock_count').values({ company_id: a.companyId, warehouse_id: b.warehouse_id, item_id: b.item_id, count_date: b.count_date, flag: '1', created_by: a.userId, updated_by: a.userId }).returning('id').executeTakeFirstOrThrow();
    return { id: r.id };
  });

  /** S-IC-17/18/19 รายการนับ + ยอดตามระบบ ณ วันนับ (สด) + ผลต่าง */
  app.get('/api/v1/stock-counts', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ count_date: isoDate, warehouse_id: uuid.optional(), q: z.string().optional(), status: z.enum(['all', '1', '3', '6', 'diff']).default('all'), sort: z.enum(['code', 'shelf']).default('code'), limit: z.coerce.number().int().min(1).max(20000).default(5000) }), req.query);
    const like = q.q?.trim() ? `%${q.q.trim()}%` : null;
    const rows = (await sql`SELECT * FROM (SELECT c.id, c.warehouse_id, w.code AS warehouse_code, w.name_th AS warehouse_name, c.item_id, i.code AS item_code, i.name_th AS item_name, c.shelf, c.flag, c.counted_qty, c.counted_unit_qty,
          bu.code AS unit_code, cu.code AS count_unit_code, i.count_factor, i.std_cost, coalesce(b.qty, 0) AS system_qty, coalesce(b.value, 0) AS system_value,
          c.system_qty AS adjusted_system_qty, c.diff_qty AS adjusted_diff, h.id AS adjust_header_id, h.doc_no AS adjust_doc_no, l.cost_amount AS adjust_value
        FROM inv_stock_count c JOIN md_warehouse w ON w.id = c.warehouse_id JOIN md_item i ON i.id = c.item_id
        LEFT JOIN md_unit bu ON bu.id = i.base_unit_id LEFT JOIN md_unit cu ON cu.id = i.count_unit_id
        LEFT JOIN doc_line l ON l.id = c.adjust_line_id LEFT JOIN doc_header h ON h.id = l.header_id
        LEFT JOIN (SELECT m.item_id, m.warehouse_id, sum(m.qty) AS qty, sum(m.value) AS value FROM v_stock_move m WHERE m.company_id = ${a.companyId} AND m.doc_date <= ${q.count_date}
                    ${q.warehouse_id ? sql`AND m.warehouse_id = ${q.warehouse_id}` : sql``} GROUP BY 1, 2) b ON b.item_id = c.item_id AND b.warehouse_id = c.warehouse_id
       WHERE c.company_id = ${a.companyId} AND c.deleted_at IS NULL AND c.count_date = ${q.count_date} ${q.warehouse_id ? sql`AND c.warehouse_id = ${q.warehouse_id}` : sql``}
         ${like ? sql`AND (i.code ILIKE ${like} OR i.name_th ILIKE ${like} OR c.shelf ILIKE ${like})` : sql``} ${q.status !== 'all' && q.status !== 'diff' ? sql`AND c.flag = ${q.status}` : sql``}) x
       ${q.status === 'diff' ? sql`WHERE x.counted_qty IS NOT NULL AND x.counted_qty <> x.system_qty` : sql``}
       ORDER BY x.warehouse_code, ${q.sort === 'shelf' ? sql`x.shelf NULLS LAST, ` : sql``}x.item_code LIMIT ${q.limit}`.execute(db)).rows as Array<Record<string, string | null>>;
    let diffValue = d(0);
    const out: Array<Record<string, string | null>> = rows.map((r) => {
      const sys = d(r.system_qty ?? 0), sv = d(r.system_value ?? 0);
      const diff = r.counted_qty === null ? null : d(r.counted_qty).minus(sys);
      const unit = sys.gt(0) ? sv.div(sys) : r.std_cost !== null ? d(r.std_cost) : null;
      // มูลค่าผลต่างโดยประมาณ (ต้นทุนเฉลี่ย ณ วันนับ, ไม่มียอด = ราคาทุนมาตรฐาน) — มูลค่าจริงตามวิธีต้นทุนจะได้ตอนปรับปรุง
      const dv = diff && unit ? diff.times(unit).toDecimalPlaces(2) : d(0);
      if (diff) diffValue = diffValue.plus(dv);
      return { ...r, diff_qty: diff?.toString() ?? null, diff_value: diff ? dv.toFixed(2) : null, avg_cost: unit?.toDecimalPlaces(4).toString() ?? null };
    });
    return { rows: out, diff_value: diffValue.toFixed(2), counted: out.filter((r) => r.flag !== '1').length };
  });

  /** S-IC-17 บันทึกยอดนับ (ว่าง = ยังไม่นับ/คงยอดเดิม, นับไม่พบป้อน 0, ห้ามติดลบ) */
  app.put('/api/v1/stock-counts/entries', async (req) => {
    const a = requireCompany(req);
    const { rows } = parse(z.object({ rows: z.array(z.object({ id: uuid, counted_qty: z.union([z.string(), z.number()]).nullable().transform((v) => (v === null || v === '' ? null : String(v))),
      counted_unit_qty: z.union([z.string(), z.number()]).nullable().optional().transform((v) => (v === null || v === undefined || v === '' ? null : String(v))), shelf: z.string().trim().max(10).nullable().optional() })).min(1).max(20000) }), req.body);
    for (const r of rows) {
      if (r.counted_qty !== null && (Number.isNaN(Number(r.counted_qty)) || d(r.counted_qty).lt(0))) throw badRequest('ยอดนับต้องไม่ติดลบ — นับไม่พบให้ป้อน 0, ยังไม่นับให้เว้นว่าง');
    }
    return db.transaction().execute(async (tx) => {
      const cur = await tx.selectFrom('inv_stock_count').select(['id', 'flag']).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).where('id', 'in', rows.map((r) => r.id)).execute();
      const byId = new Map(cur.map((c) => [c.id, c]));
      let n = 0;
      for (const r of rows) {
        const c = byId.get(r.id);
        if (!c) throw notFound('รายการตรวจนับ');
        if (c.flag === '6') throw badRequest('บางรายการปรับปรุงยอดแล้ว — ยกเลิกใบปรับปรุงก่อน (ผลนับจะกลับเป็น บันทึกยอดนับแล้ว) แล้วจึงแก้ยอดนับ');
        await tx.updateTable('inv_stock_count').set({ counted_qty: r.counted_qty, counted_unit_qty: r.counted_unit_qty ?? null, flag: r.counted_qty === null ? '1' : '3', ...(r.shelf !== undefined ? { shelf: r.shelf || null } : {}), updated_by: a.userId, updated_at: sql`now()` as never })
          .where('id', '=', r.id).execute();
        n++;
      }
      await logActivity(tx, a, { module: 'IC', action: 'EDIT', docNo: 'COUNT', table: 'inv_stock_count', rowId: null });
      return { updated: n };
    });
  });

  app.delete('/api/v1/stock-counts/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const c = await db.selectFrom('inv_stock_count').select(['id', 'flag']).where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!c) throw notFound('รายการตรวจนับ');
    if (c.flag === '6') throw badRequest('รายการนี้ปรับปรุงยอดแล้ว ลบไม่ได้');
    await db.updateTable('inv_stock_count').set({ deleted_at: sql`now()` as never, updated_by: a.userId }).where('id', '=', id).execute();
    return { ok: true };
  });

  /** S-IC-20/21 ปรับปรุงยอดตามที่ตรวจนับ: สร้างใบปรับปรุง (JU — ประเภท TK ถ้ามี) ณ วันนับ ให้ยอด = ยอดนับ (สร้างบรรทัดแม้ผลต่าง 0) */
  app.post('/api/v1/stock-counts/adjust', async (req) => {
    const a = requireCompany(req);
    const b = parse(z.object({ count_date: isoDate, warehouse_from: code, warehouse_to: code, item_from: code, item_to: code, doc_type_id: uuid.optional(), remark: z.string().trim().max(200).optional() }), req.body);
    const whs = await whScope(db, a.companyId, b.warehouse_from, b.warehouse_to);
    const types = await db.selectFrom('md_doc_type').select(['id', 'code']).where('company_id', '=', a.companyId).where('doc_class', '=', 'JU').where('status', '=', 'A').where('deleted_at', 'is', null).orderBy('code').execute();
    const dt = b.doc_type_id ? types.find((t) => t.id === b.doc_type_id) : types.find((t) => t.code === 'TK') ?? types[0];
    if (!dt) throw badRequest('ยังไม่มีประเภทเอกสารหมวดปรับปรุงสินค้า (JU) — เพิ่มที่ ตั้งค่า › ประเภทเอกสาร');
    return db.transaction().execute(async (tx) => {
      const rows = (await sql<{ id: string; item_id: string; warehouse_id: string; counted_qty: string; system_qty: string }>`SELECT c.id, c.item_id, c.warehouse_id, c.counted_qty, ${balanceAt(b.count_date)} AS system_qty
          FROM inv_stock_count c JOIN md_item i ON i.id = c.item_id JOIN md_warehouse w ON w.id = c.warehouse_id
         WHERE c.company_id = ${a.companyId} AND c.deleted_at IS NULL AND c.count_date = ${b.count_date} AND c.flag = '3' AND c.warehouse_id IN (${sql.join(whs)})
           ${b.item_from ? sql`AND i.code >= ${b.item_from}` : sql``} ${b.item_to ? sql`AND i.code <= ${b.item_to}` : sql``}
         ORDER BY w.code, i.code FOR UPDATE OF c`.execute(tx)).rows;
      if (!rows.length) throw badRequest('ไม่มีรายการที่บันทึกยอดนับแล้ว (สถานะ 3) ในช่วงที่เลือก — บันทึกยอดนับก่อน');
      const lines = rows.map((r) => ({ item_id: r.item_id, warehouse_id: r.warehouse_id, qty: d(r.counted_qty).minus(d(r.system_qty)).toString(), description: null, unit_id: null, factor: '1', unit_cost: null, amount: null, source_line_id: null, line_note: null, line_note_print: false }));
      const doc = await writeStockDoc(tx, a, JU, null, { doc_type_id: dt.id, doc_no: null, doc_date: b.count_date, department_id: null, remark: b.remark || `ปรับปรุงจากการตรวจนับ ${b.count_date}`, your_ref: null, warehouse_id: null, to_warehouse_id: null, lines }, { allowZero: true, fromCount: true });
      const ids = await tx.selectFrom('doc_line').select(['id', 'line_no']).where('header_id', '=', doc.id).where('deleted_at', 'is', null).orderBy('line_no').execute();
      for (const [i, r] of rows.entries()) {
        await tx.updateTable('inv_stock_count').set({ flag: '6', adjust_line_id: ids[i]!.id, system_qty: r.system_qty, diff_qty: lines[i]!.qty, updated_by: a.userId, updated_at: sql`now()` as never }).where('id', '=', r.id).execute();
      }
      return { ...doc, lines: rows.length };
    });
  });

  /** ยกเลิกการปรับปรุง (Ctrl+R ของ Express — ผู้ใช้ระดับ 5+): ยกเลิกใบปรับปรุง ผลนับกลับเป็นสถานะ 3 */
  app.post('/api/v1/stock-counts/reopen', async (req) => {
    const a = requireCompany(req);
    const b = parse(z.object({ header_id: uuid, reason: z.string().trim().min(1, 'ป้อนเหตุผลที่ยกเลิก').max(200) }), req.body);
    const h = await db.selectFrom('doc_header').select(['id', 'doc_status']).where('id', '=', b.header_id).where('company_id', '=', a.companyId).where('doc_class', '=', 'JU').where('deleted_at', 'is', null).executeTakeFirst();
    if (!h || !(await countLinked(db, h.id))) throw notFound('ใบปรับปรุงจากการตรวจนับ');
    return cancelStockDoc(db, a, h.id, b.reason);
  });
}
