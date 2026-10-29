/**
 * การตัด/รับสต๊อกของเอกสาร + ต้นทุน (บทที่ 14 · T4.2) — ยอดคงเหลือคำนวณสดจาก v_stock_move
 * วิธีคิดต้นทุนกำหนดที่กลุ่มบัญชีสินค้า (F = FIFO, A/ว่าง = ถัวเฉลี่ย) · แยกคลังตามค่าเริ่มต้น ic.cost_by_warehouse
 */
import { sql } from 'kysely';
import { averageCost, d, fifoCost } from '@buddy/core';
import type { Db } from '../../db.js';
import { badRequest } from '../../http.js';
import { companySettings } from '../../company-template.js';

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
export async function issueCost(db: Db, companyId: string, x: { itemId: string; warehouseId: string; byWarehouse: boolean; date: string; qty: string; method: string | null; fallbackUnit: string | null }) {
  const wh = x.byWarehouse ? sql`AND warehouse_id = ${x.warehouseId}` : sql``;
  if (x.method === 'F') {
    const rc = (await sql<{ qty: string; value: string }>`SELECT qty, value FROM v_stock_move WHERE company_id = ${companyId} AND item_id = ${x.itemId} ${wh} AND doc_date <= ${x.date} AND qty > 0
        ORDER BY doc_date, doc_no, line_no`.execute(db)).rows;
    const out = (await sql<{ q: string }>`SELECT coalesce(-sum(qty), 0) AS q FROM v_stock_move WHERE company_id = ${companyId} AND item_id = ${x.itemId} ${wh} AND doc_date <= ${x.date} AND qty < 0`.execute(db)).rows[0]!.q;
    return fifoCost(rc, out, x.qty, x.fallbackUnit ?? 0);
  }
  const b = (await sql<{ q: string; v: string }>`SELECT coalesce(sum(qty), 0) AS q, coalesce(sum(value), 0) AS v FROM v_stock_move WHERE company_id = ${companyId} AND item_id = ${x.itemId} ${wh} AND doc_date <= ${x.date}`.execute(db)).rows[0]!;
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
