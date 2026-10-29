import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { d } from '@buddy/core';
import type { Db } from '../../db.js';
import { badRequest, notFound, parse, requireCompany, type AuthContext } from '../../http.js';
import { logActivity } from '../../audit.js';
import { cancelDocument } from './engine.js';
import { branchOf } from './payments.js';
import { recostAfter } from './stockcost.js';

/**
 * ยอดยกมาสินค้า (คู่มือบทที่ 8 S-OB-01 ล็อตยกมา FIFO / S-OB-02 ยอดยกมารายคลัง Average)
 * เอกสารหมวด OS (is_opening) ลงวันที่ก่อนวันเริ่มใช้ · 1 ใบ = 1 ล็อต (เลขที่ = เลขที่เอกสารรับเข้าเดิม หรือ "ยอดยกมา") หลายสินค้า/คลัง
 * รับเข้า movement 1 มูลค่า = มูลค่ายกมา · ไม่ลงบัญชี (ยอดบัญชีป้อนที่ บันทึกยอดยกมา; Periodic ป้อนบัญชีสินค้าคงเหลือด้วย)
 */
type Ctx = AuthContext & { companyId: string };
const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ไม่ถูกต้อง');
const num = z.union([z.number(), z.string()]).transform((v) => String(v === '' ? 0 : v)).refine((v) => !Number.isNaN(Number(v)), 'ต้องเป็นตัวเลข');
const body = z.object({
  doc_no: z.string().trim().min(1, 'ป้อนเลขที่ล็อต (ไม่ทราบล็อตให้ใส่ "ยอดยกมา")').max(30), doc_date: isoDate, remark: z.string().trim().max(200).nullable().optional().transform((v) => v || null),
  lines: z.array(z.object({ item_id: uuid, warehouse_id: uuid, qty: num, value: num, description: z.string().trim().max(200).nullable().optional() })).min(1, 'ป้อนรายการสินค้าอย่างน้อย 1 บรรทัด').max(5000),
});
export const OPEN_TYPE = 'OPEN-IC';

async function startDate(db: Db, companyId: string) {
  const y = await db.selectFrom('gl_fiscal_year').select('start_date').where('company_id', '=', companyId).where('deleted_at', 'is', null).where('status', '<>', 'C').orderBy('start_date').executeTakeFirst();
  return y ? String(y.start_date).slice(0, 10) : null;
}
/** ประเภทเอกสารยอดยกมาสินค้าของโปรแกรม (สร้างเมื่อใช้ครั้งแรก — ข้อมูลที่ย้ายจาก Express มีแล้ว) */
async function openType(db: Db, a: Ctx) {
  const t = await db.selectFrom('md_doc_type').select('id').where('company_id', '=', a.companyId).where('code', '=', OPEN_TYPE).where('deleted_at', 'is', null).executeTakeFirst();
  if (t) return t.id;
  return (await db.insertInto('md_doc_type').values({ company_id: a.companyId, code: OPEN_TYPE, doc_class: 'OS', module: 'IC', name_th: 'ยอดยกมาสินค้า', name_en: 'Opening stock', created_by: a.userId, updated_by: a.userId }).returning('id').executeTakeFirstOrThrow()).id;
}

async function save(db: Db, a: Ctx, id: string | null, b: z.infer<typeof body>) {
  const start = await startDate(db, a.companyId);
  if (start && b.doc_date >= start) throw badRequest(`วันที่ล็อตต้องก่อนวันเริ่มใช้โปรแกรม (${start}) — ยอดยกมาคือสินค้าที่มี ณ วันเริ่มใช้`);
  const items = await db.selectFrom('md_item').select(['id', 'code', 'name_th', 'item_type', 'base_unit_id']).where('company_id', '=', a.companyId).where('id', 'in', [...new Set(b.lines.map((l) => l.item_id))]).where('deleted_at', 'is', null).execute();
  const byId = new Map(items.map((i) => [i.id, i]));
  const whIds = [...new Set(b.lines.map((l) => l.warehouse_id))];
  const whs = await db.selectFrom('md_warehouse').select('id').where('company_id', '=', a.companyId).where('id', 'in', whIds).where('deleted_at', 'is', null).execute();
  if (whs.length !== whIds.length) throw badRequest('ไม่พบคลังสินค้าที่เลือก');
  const seen = new Set<string>();
  b.lines.forEach((l, i) => {
    const it = byId.get(l.item_id);
    if (!it) throw badRequest(`บรรทัดที่ ${i + 1}: ไม่พบรหัสสินค้า`);
    if (it.item_type !== '0') throw badRequest(`บรรทัดที่ ${i + 1}: ${it.code} ไม่ใช่สินค้าที่มีสต๊อก`);
    if (d(l.qty).lte(0)) throw badRequest(`บรรทัดที่ ${i + 1}: จำนวนยกมาต้องมากกว่า 0 (หน่วยนับย่อย)`);
    if (d(l.value).lt(0)) throw badRequest(`บรรทัดที่ ${i + 1}: มูลค่ายกมาต้องไม่ติดลบ`);
    const k = `${l.item_id}|${l.warehouse_id}`;
    if (seen.has(k)) throw badRequest(`บรรทัดที่ ${i + 1}: ${it.code} คลังนี้ซ้ำในล็อตเดียวกัน — รวมเป็นบรรทัดเดียว`);
    seen.add(k);
  });
  return db.transaction().execute(async (tx) => {
    const dt = await openType(tx, a);
    const dup = await tx.selectFrom('doc_header').select('id').where('company_id', '=', a.companyId).where('doc_type_id', '=', dt).where('doc_no', '=', b.doc_no).where('doc_date', '=', b.doc_date).where('doc_status', '<>', 'C').where('deleted_at', 'is', null).executeTakeFirst();
    if (dup && dup.id !== id) throw badRequest(`ล็อต ${b.doc_no} วันที่นี้มีอยู่แล้ว — เพิ่มรายการในใบเดิม`);
    const total = b.lines.reduce((s, l) => s.plus(d(l.value)), d(0)).toFixed(2);
    const header = { doc_type_id: dt, doc_class: 'OS', module: 'IC', doc_no: b.doc_no, doc_date: b.doc_date, is_opening: true, remark: b.remark, amount: total, net_amount: total, gl_posted: 'N', updated_by: a.userId };
    let hid = id;
    if (id) {
      const cur = await tx.selectFrom('doc_header').select(['doc_status', 'doc_class', 'is_opening']).where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
      if (!cur || cur.doc_class !== 'OS' || !cur.is_opening) throw notFound('ยอดยกมาสินค้า');
      if (cur.doc_status === 'C') throw badRequest('รายการนี้ถูกยกเลิกแล้ว แก้ไขไม่ได้');
      await tx.updateTable('doc_header').set(header).where('id', '=', id).execute();
      await tx.updateTable('doc_line').set({ deleted_at: sql`now()` as never }).where('header_id', '=', id).where('deleted_at', 'is', null).execute();
    } else {
      hid = (await tx.insertInto('doc_header').values({ ...header, company_id: a.companyId, branch_id: await branchOf(tx, a), doc_status: 'N', created_by: a.userId }).returning('id').executeTakeFirstOrThrow()).id;
    }
    await tx.insertInto('doc_line').values(b.lines.map((l, i) => {
      const it = byId.get(l.item_id)!;
      const q = d(l.qty), v = d(l.value);
      return { company_id: a.companyId, header_id: hid!, line_no: i + 1, line_kind: 'I', item_id: it.id, description: l.description || it.name_th, warehouse_id: l.warehouse_id, unit_id: it.base_unit_id, factor: '1',
        qty: q.toString(), base_qty: q.toString(), stock_effect: 1, movement_code: '1', cost_amount: v.toFixed(2), cost_unit: v.div(q).toDecimalPlaces(4).toString(), line_amount: v.toFixed(2), net_amount: v.toFixed(2), created_by: a.userId };
    })).execute();
    await recostAfter(tx, a, hid!);
    await logActivity(tx, a, { module: 'IC', action: id ? 'EDIT' : 'ADD', docNo: b.doc_no, table: 'doc_header', rowId: hid });
    return { id: hid, doc_no: b.doc_no, net_amount: total };
  });
}

export function stockOpeningRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/v1/stock-opening', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ q: z.string().optional(), limit: z.coerce.number().int().min(1).max(2000).default(500) }), req.query);
    const like = q.q?.trim() ? `%${q.q.trim()}%` : null;
    // ค้นด้วยรหัส/ชื่อสินค้าได้ด้วย (ใบยกมาจากการย้ายข้อมูลมีหลายพันบรรทัด)
    const rows = (await sql`SELECT h.id, h.doc_no, h.doc_date, h.remark, h.net_amount, h.doc_status,
          (SELECT count(*) FROM doc_line l WHERE l.header_id = h.id AND l.deleted_at IS NULL)::int AS lines,
          (SELECT coalesce(sum(l.base_qty), 0) FROM doc_line l WHERE l.header_id = h.id AND l.deleted_at IS NULL) AS qty
        FROM doc_header h WHERE h.company_id = ${a.companyId} AND h.doc_class = 'OS' AND h.is_opening AND h.deleted_at IS NULL
          ${like ? sql`AND (h.doc_no ILIKE ${like} OR h.remark ILIKE ${like} OR EXISTS (SELECT 1 FROM doc_line l JOIN md_item i ON i.id = l.item_id WHERE l.header_id = h.id AND l.deleted_at IS NULL AND (i.code ILIKE ${like} OR i.name_th ILIKE ${like})))` : sql``}
        ORDER BY h.doc_date, h.doc_no LIMIT ${q.limit}`.execute(db)).rows;
    const tot = (await sql<{ v: string }>`SELECT coalesce(sum(h.net_amount), 0) AS v FROM doc_header h WHERE h.company_id = ${a.companyId} AND h.doc_class = 'OS' AND h.is_opening AND h.doc_status <> 'C' AND h.deleted_at IS NULL`.execute(db)).rows[0]!.v;
    return { rows, total: tot, start_date: await startDate(db, a.companyId) };
  });
  app.get('/api/v1/stock-opening/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const h = await db.selectFrom('doc_header').select(['id', 'doc_no', 'doc_date', 'remark', 'net_amount', 'doc_status']).where('id', '=', id).where('company_id', '=', a.companyId).where('doc_class', '=', 'OS').where('is_opening', '=', true).where('deleted_at', 'is', null).executeTakeFirst();
    if (!h) throw notFound('ยอดยกมาสินค้า');
    const lines = await db.selectFrom('doc_line as l').leftJoin('md_item as i', 'i.id', 'l.item_id').leftJoin('md_unit as u', 'u.id', 'i.base_unit_id')
      .select(['l.id', 'l.line_no', 'l.item_id', 'i.code as item_code', 'i.name_th as item_name', 'l.description', 'l.warehouse_id', 'l.base_qty as qty', 'l.cost_amount as value', 'l.cost_unit', 'u.code as unit_code'])
      .where('l.header_id', '=', id).where('l.deleted_at', 'is', null).orderBy('l.line_no').execute();
    return { ...h, lines, editable: h.doc_status !== 'C', start_date: await startDate(db, a.companyId) };
  });
  app.post('/api/v1/stock-opening', async (req) => save(db, requireCompany(req), null, parse(body, req.body)));
  app.put('/api/v1/stock-opening/:id', async (req) => save(db, requireCompany(req), parse(z.object({ id: uuid }), req.params).id, parse(body, req.body)));
  app.post('/api/v1/stock-opening/:id/cancel', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const { reason } = parse(z.object({ reason: z.string().trim().min(1, 'ป้อนเหตุผลที่ยกเลิก').max(200) }), req.body);
    const h = await db.selectFrom('doc_header').select('id').where('id', '=', id).where('company_id', '=', a.companyId).where('doc_class', '=', 'OS').where('is_opening', '=', true).where('deleted_at', 'is', null).executeTakeFirst();
    if (!h) throw notFound('ยอดยกมาสินค้า');
    return cancelDocument(db, a, id, reason);
  });
}
