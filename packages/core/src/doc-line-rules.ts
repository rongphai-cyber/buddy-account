/**
 * กฎของบรรทัดเอกสารซื้อ/ขาย (ไม่ขึ้นกับฐานข้อมูล — ใช้ทั้งหน้าจอและ server)
 * เจ้าของ 18/11/2569: "การคีย์ชื้อหรือขาย ต้องบังคับให้ใส่หน่วยทุกครั้ง ทุกรายการต้องมีหน่วยนับ"
 *   รอบ 2: "หน่วยที่จะต้องใส่ทุกครั้งไม่ต้องใส่ * ให้โปรแกรมบังคับให้ใส่ได้ก็พอ เช่นคลัง จำนวน ก็ต้องมีให้กรอกไม่ให้ข้าม"
 * ตรวจเฉพาะการคีย์จากหน้าจอ (WTS-POS/Living/นำเข้า ใช้ค่าเริ่มต้นตามเดิม) · เอกสารเดิมยังเปิดดู/ยกเลิกได้ — ตรวจตอนบันทึก (เพิ่ม/แก้)
 */
export interface UnitLine { unit_id: string | null | undefined; code?: string | null }
export type LineField = 'warehouse' | 'qty' | 'unit';
export interface LineIssue { line: number; field: LineField; message: string }

/** สินค้าที่มีสต๊อก (ต้องระบุคลัง): 0 สินค้า · 1 สินค้าชุดธรรมดา · 2 สินค้าชุดพิเศษ — บริการ/รายได้/ค่าใช้จ่ายไม่ต้องมีคลัง */
export const isStockItemType = (t: string | null | undefined) => t === '0' || t === '1' || t === '2';

export interface RequiredLine extends UnitLine { item_type?: string | null; qty?: string | number | null; warehouse_id?: string | null }

const tag = (i: number, code?: string | null) => `บรรทัดที่ ${i + 1}${code ? ` (${code})` : ''}`;
const zeroQty = (q: string | number | null | undefined) => q === null || q === undefined || String(q).trim() === '' || Number(String(q).replace(/,/g, '')) === 0 || Number.isNaN(Number(String(q).replace(/,/g, '')));

/** ช่องที่ต้องมีของแต่ละบรรทัด ตามลำดับคอลัมน์บนจอ: คลัง (สินค้าสต๊อก) → จำนวน → หน่วย */
export function requiredLineIssues(lines: RequiredLine[]): LineIssue[] {
  const out: LineIssue[] = [];
  lines.forEach((l, i) => {
    if (isStockItemType(l.item_type) && !l.warehouse_id) out.push({ line: i + 1, field: 'warehouse', message: `${tag(i, l.code)}: สินค้าที่มีสต๊อกต้องระบุคลัง — เลือกคลังในช่อง "คลัง"` });
    if (zeroQty(l.qty)) out.push({ line: i + 1, field: 'qty', message: `${tag(i, l.code)}: ยังไม่ได้ใส่จำนวน — ใส่จำนวนในช่อง "จำนวน"` });
    if (!l.unit_id) out.push({ line: i + 1, field: 'unit', message: `${tag(i, l.code)}: ยังไม่มีหน่วยนับ — เลือกหน่วยในช่อง "หน่วย" หรือกำหนดหน่วยนับหลักที่แฟ้มสินค้า` });
  });
  return out;
}

/** เฉพาะหน่วยนับ (รอบแรก) — คงไว้ให้ผู้เรียกเดิม */
export function missingUnitIssues(lines: UnitLine[]): LineIssue[] {
  return requiredLineIssues(lines.map((l) => ({ ...l, qty: 1 })));
}

/** จำนวนบรรทัดว่างของตารางรายการ: ราว 5 บรรทัด จอเตี้ยน้อยกว่านั้น (2–5) ให้ส่วนท้ายเอกสารอยู่ในจอเดียวกัน — เพิ่มต่อได้ (เจ้าของ 18/11/2569 รอบ 2 "ควรประมาณ 1-5 รายการ") */
export function fillRowCount(viewportHeight: number): number {
  return Math.max(2, Math.min(5, Math.floor((viewportHeight - 600) / 40)));
}
