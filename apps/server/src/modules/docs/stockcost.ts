/**
 * การตัด/รับสต๊อกของเอกสาร + ต้นทุน (บทที่ 14 · T4.2) — ยอดคงเหลือคำนวณสดจาก v_stock_move
 * วิธีคิดต้นทุนกำหนดที่กลุ่มบัญชีสินค้า (F = FIFO, A/ว่าง = ถัวเฉลี่ย) · แยกคลังตามค่าเริ่มต้น ic.cost_by_warehouse
 */
import { sql } from 'kysely';
import { averageCost, d, fifoCost } from '@buddy/core';
import type { Db } from '../../db.js';
import { badRequest } from '../../http.js';
import { companySettings } from '../../company-template.js';
import { postDocument } from './engine.js';

export interface StockSettings { mainWarehouseId: string | null; byWarehouse: boolean; allowNegative: string; checkLevel: string; perpetual: boolean }

export async function stockSettings(db: Db, companyId: string): Promise<StockSettings> {
  const s = await companySettings(db, companyId);
  const code = typeof s['ic.main_warehouse'] === 'string' ? (s['ic.main_warehouse'] as string) : null;
  // คลังหลัก (ค่าเริ่มต้นระบบสินค้า) → ไม่ได้กำหนด ใช้คลังแรกที่ยังใช้งาน
  const wh = (code ? await db.selectFrom('md_warehouse').select('id').where('company_id', '=', companyId).where('code', '=', code).where('deleted_at', 'is', null).executeTakeFirst() : undefined)
    ?? await db.selectFrom('md_warehouse').select('id').where('company_id', '=', companyId).where('status', '=', 'A').where('deleted_at', 'is', null).orderBy('code').executeTakeFirst();
  return { mainWarehouseId: wh?.id ?? null, byWarehouse: s['ic.cost_by_warehouse'] !== false, allowNegative: String(s['ic.allow_negative'] ?? 'Y'), checkLevel: String(s['ic.negative_check_level'] ?? '0'), perpetual: s['ic.posting_method'] === 'PERPETUAL' };
}

/** ต้นทุนของจำนวนที่จ่ายออก ณ วันที่เอกสาร (นับเฉพาะความเคลื่อนไหวถึงวันนั้น — บรรทัดเดิมของเอกสารที่กำลังแก้ถูกลบก่อนแล้ว) */
export async function issueCost(db: Db, companyId: string, x: { itemId: string; warehouseId: string; byWarehouse: boolean; date: string; qty: string; method: string | null; fallbackUnit: string | null; excludeHeaderId?: string }) {
  // คิดต้นทุนใหม่ของเอกสารที่บันทึกแล้ว: ไม่นับความเคลื่อนไหวของเอกสารนั้นเอง
  const ex = x.excludeHeaderId ? sql`AND header_id <> ${x.excludeHeaderId}` : sql``;
  const wh = x.byWarehouse ? sql`AND warehouse_id = ${x.warehouseId}` : sql``;
  if (x.method === 'F') {
    // ล็อตรับเข้า + การปรับต้นทุนของล็อต (CA อ้าง source_line_id)
    const rc = (await sql<{ qty: string; value: string }>`SELECT m.qty, m.value + coalesce((SELECT sum(ca.cost_amount) FROM doc_line ca JOIN doc_header ch ON ch.id = ca.header_id
          WHERE ca.source_line_id = m.line_id AND ca.deleted_at IS NULL AND ch.doc_status <> 'C' AND ch.doc_class = 'CA' AND ch.doc_date <= ${x.date}), 0) AS value
        FROM v_stock_move m WHERE m.company_id = ${companyId} AND m.item_id = ${x.itemId} ${x.byWarehouse ? sql`AND m.warehouse_id = ${x.warehouseId}` : sql``} AND m.doc_date <= ${x.date} AND m.qty > 0 ${x.excludeHeaderId ? sql`AND m.header_id <> ${x.excludeHeaderId}` : sql``}
        ORDER BY m.doc_date, m.doc_no, m.line_no`.execute(db)).rows;
    const out = (await sql<{ q: string }>`SELECT coalesce(-sum(qty), 0) AS q FROM v_stock_move WHERE company_id = ${companyId} AND item_id = ${x.itemId} ${wh} ${ex} AND doc_date <= ${x.date} AND qty < 0`.execute(db)).rows[0]!.q;
    return fifoCost(rc, out, x.qty, x.fallbackUnit ?? 0);
  }
  const b = (await sql<{ q: string; v: string }>`SELECT coalesce(sum(qty), 0) AS q, coalesce(sum(value), 0) AS v FROM v_stock_move WHERE company_id = ${companyId} AND item_id = ${x.itemId} ${wh} ${ex} AND doc_date <= ${x.date}`.execute(db)).rows[0]!;
  return averageCost(b.q, b.v, x.qty, x.fallbackUnit ?? 0);
}

/** ตรวจสินค้าติดลบ (ค่าเริ่มต้นระบบสินค้า ข้อ 9): ยอดคงเหลือปัจจุบัน − ที่จะจ่าย ต้องไม่ติดลบ เมื่อไม่ยอมให้ติดลบ */
export async function checkNegative(db: Db, companyId: string, st: StockSettings, issues: Map<string, { itemId: string; warehouseId: string; qty: ReturnType<typeof d>; code: string; whCode?: string }>) {
  // ยอมติดลบ หรือระดับการตรวจ 0 (ไม่ตรวจ — ข้อ 11) ไม่ต้องตรวจ
  if (st.allowNegative === 'Y' || st.checkLevel === '0') return;
  for (const x of issues.values()) {
    const b = (await sql<{ q: string }>`SELECT coalesce(sum(qty), 0) AS q FROM v_stock_move WHERE company_id = ${companyId} AND item_id = ${x.itemId} AND warehouse_id = ${x.warehouseId}`.execute(db)).rows[0]!.q;
    if (d(b).minus(x.qty).lt(0)) throw badRequest(`สินค้า ${x.code} คงเหลือ ${d(b).toString()} ไม่พอจ่าย ${x.qty.toString()} — ค่าเริ่มต้นระบบสินค้าไม่ยอมให้ยอดติดลบ (ข้อ 9)`);
  }
}

/**
 * คิดต้นทุนใหม่ของรายการจ่ายที่ตามมา เมื่อบันทึก/แก้/ยกเลิกเอกสารย้อนหลัง (บทที่ 14) — อัตโนมัติในทรานแซกชันเดียวกัน ไม่มีเมนู "คำนวณใหม่"
 * ไล่ตามวันที่: ขาย/รับคืน/เบิก/โอนออก(+โอนเข้าคู่กัน)/ปรับลด/ส่วนประกอบชุด ของสินค้าที่เกี่ยวข้อง ตั้งแต่วันที่ของเอกสาร · ต้นทุนเปลี่ยน = ลงบัญชีใหม่ (Perpetual)
 */
export async function recostAfter(tx: Db, a: { companyId: string; userId: string; branchId?: string | null }, headerId: string) {
  const h = await tx.selectFrom('doc_header').select(['doc_date']).where('id', '=', headerId).executeTakeFirst();
  if (!h) return 0;
  const items = (await sql<{ item_id: string }>`SELECT DISTINCT item_id FROM doc_line WHERE header_id = ${headerId} AND item_id IS NOT NULL AND stock_effect <> 0`.execute(tx)).rows.map((r) => r.item_id);
  if (!items.length) return 0;
  const date = String(h.doc_date).slice(0, 10);
  const lines = (await sql<{ id: string; header_id: string; doc_class: string; doc_date: string; line_no: number; item_id: string; warehouse_id: string; base_qty: string; stock_effect: number; movement_code: string; cost_amount: string | null; cost_method: string | null; std_cost: string | null }>`
      SELECT l.id, l.header_id, h.doc_class, h.doc_date, l.line_no, l.item_id, l.warehouse_id, l.base_qty, l.stock_effect, l.movement_code, l.cost_amount, g.cost_method, i.std_cost
        FROM doc_line l JOIN doc_header h ON h.id = l.header_id JOIN md_item i ON i.id = l.item_id LEFT JOIN md_item_account_group g ON g.id = i.account_group_id
       WHERE h.company_id = ${a.companyId} AND h.doc_status <> 'C' AND h.deleted_at IS NULL AND l.deleted_at IS NULL AND NOT h.is_opening AND h.id <> ${headerId}
         AND h.doc_date >= ${date} AND l.item_id IN (${sql.join(items)}) AND l.warehouse_id IS NOT NULL
         AND ((l.stock_effect = -1 AND l.movement_code IN ('9', '6', '4', '8')) OR (l.stock_effect = 1 AND l.movement_code = '2'))
       ORDER BY h.doc_date, h.doc_no, l.line_no LIMIT 20000`.execute(tx)).rows;
  if (!lines.length) return 0;
  const st = await stockSettings(tx, a.companyId);
  const touched = new Set<string>();
  for (const l of lines) {
    const q = d(l.base_qty);
    if (q.isZero()) continue;
    const c = d(await issueCost(tx, a.companyId, { itemId: l.item_id, warehouseId: l.warehouse_id, byWarehouse: st.byWarehouse, date: String(l.doc_date).slice(0, 10), qty: q.toString(),
      method: l.stock_effect > 0 ? 'A' : l.cost_method, fallbackUnit: l.std_cost, excludeHeaderId: l.header_id }));
    const signed = l.movement_code === '8' ? c.neg() : c;   // ปรับลด (8) เก็บมูลค่าติดลบ
    if (d(l.cost_amount ?? 0).minus(signed).abs().lt('0.005')) continue;
    const unit = c.div(q).toDecimalPlaces(4).toString();
    await tx.updateTable('doc_line').set({ cost_amount: signed.toFixed(2), cost_unit: unit, ...(['OU', 'JU'].includes(l.doc_class) ? { line_amount: c.toFixed(2), net_amount: c.toFixed(2) } : {}) }).where('id', '=', l.id).execute();
    // โอนย้าย: บรรทัดรับเข้าคู่กัน (ถัดไป) ต้นทุนเดียวกัน
    if (l.movement_code === '4') await tx.updateTable('doc_line').set({ cost_amount: c.toFixed(2), cost_unit: unit }).where('header_id', '=', l.header_id).where('line_no', '=', l.line_no + 1).where('movement_code', '=', '3').where('deleted_at', 'is', null).execute();
    touched.add(l.header_id);
  }
  for (const id of touched) {
    const x = await tx.selectFrom('doc_header').select(['doc_class']).where('id', '=', id).executeTakeFirstOrThrow();
    if (['OU', 'RL', 'JU'].includes(x.doc_class)) {
      const t = (await sql<{ v: string }>`SELECT coalesce(sum(abs(cost_amount)), 0) AS v FROM doc_line WHERE header_id = ${id} AND deleted_at IS NULL AND (${x.doc_class} <> 'RL' OR stock_effect = -1)`.execute(tx)).rows[0]!.v;
      await tx.updateTable('doc_header').set({ amount: d(t).toFixed(2), net_amount: d(t).toFixed(2) }).where('id', '=', id).execute();
    }
    const j = await tx.selectFrom('gl_journal').select('id').where('source_header_id', '=', id).where('doc_status', '=', 'N').where('deleted_at', 'is', null).executeTakeFirst();
    if (j || st.perpetual) await postDocument(tx, a, id, j?.id);
  }
  return touched.size;
}
