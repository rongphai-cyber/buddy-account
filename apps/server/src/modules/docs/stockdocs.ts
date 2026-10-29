import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { d, STOCK_KINDS, type StockKind } from '@buddy/core';
import type { Db } from '../../db.js';
import { badRequest, notFound, parse, requireCompany, type AuthContext } from '../../http.js';
import { logActivity } from '../../audit.js';
import { periodFor } from '../gl/journals.js';
import { cancelDocument, issueDocNo, postDocument, unpostDocument } from './engine.js';
import { branchOf } from './payments.js';
import { checkNegative, issueCost, stockSettings } from './stockcost.js';

/**
 * รายการประจำวันสินค้า (คู่มือบทที่ 14) — ยอดสต๊อกคำนวณสดจากบรรทัด (v_stock_move)
 * OU จ่ายใช้ภายใน: movement 6 (−) ต้นทุนตามวิธีของกลุ่มบัญชี · วัตถุประสงค์/บัญชีตามประเภทเอกสาร
 * RL โอนย้าย: เก็บเป็นคู่บรรทัด ออก (4, คลังต้นทาง) + เข้า (3, คลังปลายทาง) ต้นทุนเดียวกัน
 * JU ปรับปรุง: movement 8 ตามเครื่องหมาย (เพิ่ม = จำนวน × ทุนต่อหน่วย · ลด = ต้นทุนตามวิธีของกลุ่ม)
 * CA ปรับต้นทุน: movement 5 จำนวน 0 มูลค่า ± — FIFO ต้องอ้างล็อตรับเข้า (source_line_id)
 */
type Ctx = AuthContext & { companyId: string };
const uuid = z.string().uuid();
const optId = uuid.nullable().optional().transform((v) => v ?? null);
const str = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));
const num = z.union([z.number(), z.string()]).transform((v) => String(v === '' ? 0 : v)).refine((v) => !Number.isNaN(Number(v)), 'ต้องเป็นตัวเลข');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ไม่ถูกต้อง');
const body = z.object({
  doc_type_id: uuid, doc_date: isoDate, department_id: optId, remark: str(2000), your_ref: str(60),
  warehouse_id: optId, to_warehouse_id: optId,
  lines: z.array(z.object({
    item_id: uuid, description: str(200), warehouse_id: optId, qty: num.default('0'), unit_id: optId, factor: num.optional(),
    /** JU เพิ่ม: ทุนต่อหน่วย (ว่าง = ต้นทุนเฉลี่ย/ราคาทุนมาตรฐาน) */ unit_cost: num.nullable().optional(),
    /** CA: มูลค่าที่เพิ่ม(+)/ลด(−) */ amount: num.nullable().optional(), source_line_id: optId,
  })).min(1, 'ป้อนรายการสินค้าอย่างน้อย 1 บรรทัด').max(500),
});
export type StockDocBody = z.infer<typeof body>;
type Body = StockDocBody;
/** ใบปรับยอดตอนย้ายข้อมูล (ทำให้สต๊อกเท่า STLOC ของ Express) — แก้/ยกเลิกไม่ได้ */
const isMigAdj = (docNo: string) => docNo.startsWith('MIG-');
/** ใบปรับปรุงที่สร้างจากการตรวจนับ — แก้ที่หน้ารายการตรวจนับ (ยกเลิกแล้วผลนับกลับเป็น "บันทึกยอดนับแล้ว") */
export const countLinked = async (db: Db, headerId: string) => !!(await sql`SELECT 1 FROM inv_stock_count c JOIN doc_line l ON l.id = c.adjust_line_id WHERE l.header_id = ${headerId} AND c.deleted_at IS NULL LIMIT 1`.execute(db)).rows.length;
const COUNT_MSG = 'เอกสารนี้สร้างจากการตรวจนับ แก้ไขไม่ได้ — ยกเลิกเอกสาร (ผลนับกลับเป็น "บันทึกยอดนับแล้ว") แล้วแก้ยอดนับและปรับปรุงใหม่ที่หน้ารายการตรวจนับ';
const MIG_MSG = 'เอกสารนี้สร้างตอนย้ายข้อมูลจาก Express เพื่อให้ยอดสต๊อกตรง แก้ไข/ยกเลิกไม่ได้ — ปรับยอดด้วยเอกสารปรับปรุงใบใหม่';

/** บันทึกเอกสารคลัง (ใน transaction ของผู้เรียก) — allowZero: ใบปรับปรุงจากการตรวจนับสร้างบรรทัดแม้ผลต่างเป็น 0 */
export async function writeStockDoc(db: Db, a: Ctx, K: StockKind, id: string | null, b: Body, opt: { allowZero?: boolean; fromCount?: boolean } = {}) {
  const dt = await db.selectFrom('md_doc_type').select(['id', 'doc_class', 'department_id', 'warehouse_id', 'status']).where('id', '=', b.doc_type_id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
  if (!dt || dt.doc_class !== K.cls) throw badRequest(`เลือกประเภทเอกสารของ${K.label}`);
  if (!id && dt.status !== 'A') throw badRequest('ประเภทเอกสารนี้เลิกใช้แล้ว');
  const items = await db.selectFrom('md_item as i').leftJoin('md_item_account_group as g', 'g.id', 'i.account_group_id').select(['i.id', 'i.code', 'i.name_th', 'i.item_type', 'i.base_unit_id', 'i.std_cost', 'g.cost_method'])
    .where('i.company_id', '=', a.companyId).where('i.id', 'in', [...new Set(b.lines.map((l) => l.item_id))]).where('i.deleted_at', 'is', null).execute();
  const byId = new Map(items.map((i) => [i.id, i]));
  const whIds = [...new Set([b.warehouse_id, b.to_warehouse_id, ...b.lines.map((l) => l.warehouse_id)].filter((x): x is string => !!x))];
  const whs = whIds.length ? await db.selectFrom('md_warehouse').select(['id', 'code']).where('company_id', '=', a.companyId).where('id', 'in', whIds).where('deleted_at', 'is', null).execute() : [];
  if (whs.length !== whIds.length) throw badRequest('ไม่พบคลังสินค้าที่เลือก');
  if (K.cls === 'RL') {
    if (!b.warehouse_id || !b.to_warehouse_id) throw badRequest('เลือกคลังต้นทางและคลังปลายทาง');
    if (b.warehouse_id === b.to_warehouse_id) throw badRequest('คลังต้นทางและปลายทางต้องต่างกัน');
  }
  b.lines.forEach((l, i) => {
    const it = byId.get(l.item_id);
    if (!it) throw badRequest(`บรรทัดที่ ${i + 1}: ไม่พบรหัสสินค้า`);
    if (it.item_type !== '0') throw badRequest(`บรรทัดที่ ${i + 1}: ${it.code} ไม่ใช่สินค้าที่มีสต๊อก (บริการ/สินค้าชุด/รายได้/ค่าใช้จ่าย)`);
    if (K.cls === 'CA') { if (!l.amount || d(l.amount).isZero()) throw badRequest(`บรรทัดที่ ${i + 1}: ป้อนจำนวนเงินที่เพิ่ม/ลดต้นทุน`); }
    else if (d(l.qty).isZero() && !opt.allowZero) throw badRequest(`บรรทัดที่ ${i + 1}: ป้อนจำนวน`);
    else if (K.cls !== 'JU' && d(l.qty).lt(0)) throw badRequest(`บรรทัดที่ ${i + 1}: จำนวนต้องมากกว่า 0`);
    if (K.cls === 'CA' && it.cost_method === 'F' && !l.source_line_id) throw badRequest(`บรรทัดที่ ${i + 1}: ${it.code} คิดต้นทุน FIFO — เลือกล็อต (เอกสารรับเข้า) ที่จะปรับ`);
  });
  const header = { doc_type_id: dt.id, doc_class: K.cls, module: 'IC', doc_date: b.doc_date, department_id: b.department_id ?? dt.department_id, remark: b.remark, your_ref: b.your_ref,
    warehouse_id: b.warehouse_id ?? dt.warehouse_id, to_warehouse_id: K.cls === 'RL' ? b.to_warehouse_id : null, price_type: '0', updated_by: a.userId };
  {
    const tx = db;
    await periodFor(tx, a.companyId, b.doc_date);
    let hid = id, docNo: string;
    if (id) {
      const cur = await tx.selectFrom('doc_header').select(['doc_no', 'doc_status', 'doc_class', 'doc_date']).where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
      if (!cur || cur.doc_class !== K.cls) throw notFound(K.label);
      if (cur.doc_status === 'C') throw badRequest('เอกสารนี้ถูกยกเลิกแล้ว แก้ไขไม่ได้');
      if (isMigAdj(cur.doc_no)) throw badRequest(MIG_MSG);
      if (!opt.fromCount && await countLinked(tx, id)) throw badRequest(COUNT_MSG);
      await periodFor(tx, a.companyId, String(cur.doc_date).slice(0, 10));
      docNo = cur.doc_no;
      await tx.updateTable('doc_header').set(header).where('id', '=', id).execute();
      await tx.updateTable('doc_line').set({ deleted_at: sql`now()` as never }).where('header_id', '=', id).where('deleted_at', 'is', null).execute();
    } else {
      docNo = await issueDocNo(tx, a.companyId, dt.id);
      hid = (await tx.insertInto('doc_header').values({ ...header, company_id: a.companyId, branch_id: await branchOf(tx, a), doc_no: docNo, doc_status: 'N', created_by: a.userId }).returning('id').executeTakeFirstOrThrow()).id;
    }
    const st = await stockSettings(tx, a.companyId);
    const rows: Array<Record<string, unknown>> = [];
    const issues = new Map<string, { itemId: string; warehouseId: string; qty: ReturnType<typeof d>; code: string }>();
    let n = 0;
    const out = (itemId: string, wh: string, bq: ReturnType<typeof d>, code: string) => { const k = `${itemId}|${wh}`; const x = issues.get(k); issues.set(k, { itemId, warehouseId: wh, qty: (x?.qty ?? d(0)).plus(bq), code }); };
    for (const [i, l] of b.lines.entries()) {
      const it = byId.get(l.item_id)!;
      const wh = (K.cls === 'RL' ? b.warehouse_id : l.warehouse_id ?? header.warehouse_id) ?? st.mainWarehouseId;
      if (!wh) throw badRequest(`บรรทัดที่ ${i + 1}: เลือกคลังสินค้า`);
      const factor = d(l.factor ?? 1);
      const bq = d(l.qty).times(factor);
      const baseLine = { company_id: a.companyId, header_id: hid!, line_kind: 'I', item_id: it.id, description: l.description ?? it.name_th, department_id: header.department_id,
        unit_id: l.unit_id ?? it.base_unit_id, factor: factor.toString(), created_by: a.userId };
      const cost = async (q: ReturnType<typeof d>) => issueCost(tx, a.companyId, { itemId: it.id, warehouseId: wh, byWarehouse: st.byWarehouse, date: b.doc_date, qty: q.abs().toString(), method: it.cost_method, fallbackUnit: it.std_cost });
      if (K.cls === 'OU') {
        const c = await cost(bq);
        rows.push({ ...baseLine, line_no: ++n, warehouse_id: wh, qty: l.qty, base_qty: bq.toString(), stock_effect: -1, movement_code: '6', cost_amount: c, cost_unit: d(c).div(bq).toDecimalPlaces(4).toString(), line_amount: c, net_amount: c });
        out(it.id, wh, bq, it.code);
      } else if (K.cls === 'RL') {
        const c = await cost(bq);
        const unit = d(c).div(bq).toDecimalPlaces(4).toString();
        rows.push({ ...baseLine, line_no: ++n, warehouse_id: wh, qty: l.qty, base_qty: bq.toString(), stock_effect: -1, movement_code: '4', cost_amount: c, cost_unit: unit });
        rows.push({ ...baseLine, line_no: ++n, warehouse_id: b.to_warehouse_id, qty: l.qty, base_qty: bq.toString(), stock_effect: 1, movement_code: '3', cost_amount: c, cost_unit: unit });
        out(it.id, wh, bq, it.code);
      } else if (K.cls === 'JU') {
        // เพิ่ม: จำนวน × ทุนต่อหน่วยที่ป้อน (ว่าง = ต้นทุนเฉลี่ยปัจจุบัน) · ลด: ต้นทุนตามวิธีของกลุ่ม — movement 8 มูลค่าตามเครื่องหมาย
        const v = bq.gt(0) ? (l.unit_cost != null && l.unit_cost !== '' ? bq.times(d(l.unit_cost)).toDecimalPlaces(2) : d(await issueCost(tx, a.companyId, { itemId: it.id, warehouseId: wh, byWarehouse: st.byWarehouse, date: b.doc_date, qty: bq.toString(), method: 'A', fallbackUnit: it.std_cost })))
          : d(await cost(bq)).neg();
        rows.push({ ...baseLine, line_no: ++n, warehouse_id: wh, qty: l.qty, base_qty: bq.abs().toString(), stock_effect: bq.gt(0) ? 1 : -1, movement_code: '8', cost_amount: v.toFixed(2), cost_unit: bq.isZero() ? '0' : v.abs().div(bq.abs()).toDecimalPlaces(4).toString(), line_amount: v.abs().toFixed(2), net_amount: v.abs().toFixed(2) });
        if (bq.lt(0)) out(it.id, wh, bq.abs(), it.code);
      } else {
        if (l.source_line_id) {
          const lot = await tx.selectFrom('doc_line as x').innerJoin('doc_header as h', 'h.id', 'x.header_id').select(['x.id']).where('x.id', '=', l.source_line_id).where('x.item_id', '=', it.id)
            .where('h.company_id', '=', a.companyId).where('h.doc_status', '<>', 'C').where('x.stock_effect', '=', 1).where('x.deleted_at', 'is', null).executeTakeFirst();
          if (!lot) throw badRequest(`บรรทัดที่ ${i + 1}: ไม่พบล็อตรับเข้าของ ${it.code}`);
        }
        rows.push({ ...baseLine, line_no: ++n, warehouse_id: wh, qty: '0', base_qty: '0', stock_effect: 1, movement_code: '5', cost_amount: d(l.amount!).toFixed(2), cost_unit: '0', line_amount: d(l.amount!).toFixed(2), net_amount: d(l.amount!).toFixed(2), source_line_id: l.source_line_id });
      }
    }
    await checkNegative(tx, a.companyId, st, issues);
    await tx.insertInto('doc_line').values(rows as never).execute();
    const total = rows.filter((r) => K.cls !== 'RL' || r.stock_effect === -1).reduce((s, r) => s.plus(d((r.cost_amount as string) ?? 0).abs()), d(0)).toFixed(2);
    await tx.updateTable('doc_header').set({ amount: total, net_amount: total }).where('id', '=', hid!).execute();
    const curJ = id ? await tx.selectFrom('gl_journal').select('id').where('source_header_id', '=', id).where('doc_status', '=', 'N').where('deleted_at', 'is', null).executeTakeFirst() : undefined;
    const posted = await postDocument(tx, a, hid!, curJ?.id);
    if (!posted.journal_id && curJ) await unpostDocument(tx, a, hid!);
    await logActivity(tx, a, { module: 'IC', action: id ? 'EDIT' : 'ADD', docNo, table: 'doc_header', rowId: hid });
    return { id: hid!, doc_no: docNo, journal_id: posted.journal_id, net_amount: total };
  }
}
const save = (db: Db, a: Ctx, K: StockKind, id: string | null, b: Body) => db.transaction().execute((tx) => writeStockDoc(tx, a, K, id, b));

/** ยกเลิกเอกสารคลัง — ใบที่มาจากการตรวจนับ: ผลนับกลับเป็นสถานะ 3 (บันทึกยอดนับแล้ว) ให้แก้และปรับปรุงใหม่ได้ */
export async function cancelStockDoc(db: Db, a: Ctx, id: string, reason: string) {
  const r = await cancelDocument(db, a, id, reason);
  await sql`UPDATE inv_stock_count SET flag = '3', adjust_line_id = NULL, system_qty = NULL, diff_qty = NULL, updated_by = ${a.userId}, updated_at = now()
     WHERE company_id = ${a.companyId} AND adjust_line_id IN (SELECT id FROM doc_line WHERE header_id = ${id})`.execute(db);
  return r;
}

export function stockDocRoutes(app: FastifyInstance, db: Db) {
  for (const K of STOCK_KINDS) {
    const base = `/api/v1/${K.path}`;
    app.get(base, async (req) => {
      const a = requireCompany(req);
      const q = parse(z.object({ q: z.string().optional(), from: isoDate.optional(), to: isoDate.optional(), status: z.enum(['N', 'C', 'all']).default('all'), limit: z.coerce.number().int().min(1).max(1000).default(300) }), req.query);
      const like = q.q?.trim() ? `%${q.q.trim()}%` : null;
      const rows = (await sql`SELECT h.id, h.doc_no, h.doc_date, h.remark, h.net_amount, h.doc_status, w.code AS warehouse_code, tw.code AS to_warehouse_code,
          (SELECT count(*) FROM doc_line l WHERE l.header_id = h.id AND l.deleted_at IS NULL AND (h.doc_class <> 'RL' OR l.stock_effect = -1))::int AS lines
          FROM doc_header h LEFT JOIN md_warehouse w ON w.id = h.warehouse_id LEFT JOIN md_warehouse tw ON tw.id = h.to_warehouse_id
         WHERE h.company_id = ${a.companyId} AND h.doc_class = ${K.cls} AND h.deleted_at IS NULL ${q.from ? sql`AND h.doc_date >= ${q.from}` : sql``} ${q.to ? sql`AND h.doc_date <= ${q.to}` : sql``}
           ${q.status !== 'all' ? sql`AND h.doc_status = ${q.status}` : sql``} ${like ? sql`AND (h.doc_no ILIKE ${like} OR h.remark ILIKE ${like})` : sql``}
         ORDER BY h.doc_date DESC, h.doc_no DESC LIMIT ${q.limit}`.execute(db)).rows;
      return { rows };
    });
    app.get(`${base}/:id`, async (req) => {
      const a = requireCompany(req);
      const { id } = parse(z.object({ id: uuid }), req.params);
      const h = await db.selectFrom('doc_header').selectAll().where('id', '=', id).where('company_id', '=', a.companyId).where('doc_class', '=', K.cls).where('deleted_at', 'is', null).executeTakeFirst();
      if (!h) throw notFound(K.label);
      // โอนย้าย: แสดงเฉพาะบรรทัดออก (คู่บรรทัดเข้าเป็นรายการเดียวกัน)
      const lines = await db.selectFrom('doc_line as l').leftJoin('md_item as i', 'i.id', 'l.item_id').leftJoin('md_unit as u', 'u.id', 'l.unit_id')
        .select(['l.id', 'l.line_no', 'l.item_id', 'i.code as item_code', 'l.description', 'l.warehouse_id', 'l.qty', 'l.unit_id', 'u.code as unit_code', 'l.factor', 'l.cost_unit', 'l.cost_amount', 'l.stock_effect', 'l.source_line_id'])
        .where('l.header_id', '=', id).where('l.deleted_at', 'is', null).$if(K.cls === 'RL', (qb) => qb.where('l.stock_effect', '=', -1)).orderBy('l.line_no').execute();
      return { ...h, lines, editable: h.doc_status !== 'C' && !isMigAdj(h.doc_no) && !(await countLinked(db, id)), from_count: await countLinked(db, id) };
    });
    app.post(base, async (req) => save(db, requireCompany(req), K, null, parse(body, req.body)));
    app.put(`${base}/:id`, async (req) => save(db, requireCompany(req), K, parse(z.object({ id: uuid }), req.params).id, parse(body, req.body)));
    app.post(`${base}/:id/cancel`, async (req) => {
      const a = requireCompany(req);
      const { id } = parse(z.object({ id: uuid }), req.params);
      const { reason } = parse(z.object({ reason: z.string().trim().min(1, 'ป้อนเหตุผลที่ยกเลิก').max(200) }), req.body);
      const h = await db.selectFrom('doc_header').select(['id', 'doc_no']).where('id', '=', id).where('company_id', '=', a.companyId).where('doc_class', '=', K.cls).where('deleted_at', 'is', null).executeTakeFirst();
      if (!h) throw notFound(K.label);
      if (isMigAdj(h.doc_no)) throw badRequest(MIG_MSG);
      return cancelStockDoc(db, a, id, reason);
    });
  }
  /** CA FIFO: ล็อตรับเข้าของสินค้า (บรรทัดที่รับเข้า) ให้เลือกปรับต้นทุน */
  app.get('/api/v1/stock/lots', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ item_id: uuid, warehouse_id: uuid.optional() }), req.query);
    const rows = (await sql`SELECT m.line_id, m.doc_no, m.doc_date, m.line_no, w.code AS warehouse_code, m.qty, m.value FROM v_stock_move m JOIN md_warehouse w ON w.id = m.warehouse_id
        WHERE m.company_id = ${a.companyId} AND m.item_id = ${q.item_id} AND m.qty > 0 ${q.warehouse_id ? sql`AND m.warehouse_id = ${q.warehouse_id}` : sql``}
        ORDER BY m.doc_date DESC, m.doc_no DESC LIMIT 100`.execute(db)).rows;
    return { rows };
  });
}
