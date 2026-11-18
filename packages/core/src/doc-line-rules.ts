/**
 * กฎของบรรทัดเอกสารซื้อ/ขาย (ไม่ขึ้นกับฐานข้อมูล — ใช้ทั้งหน้าจอและ server)
 * เจ้าของ 18/11/2569: "การคีย์ชื้อหรือขาย ต้องบังคับให้ใส่หน่วยทุกครั้ง ทุกรายการต้องมีหน่วยนับ"
 * เอกสารเดิมที่ไม่มีหน่วยยังเปิดดู/ยกเลิกได้ — ตรวจตอนบันทึก (เพิ่ม/แก้) เท่านั้น
 */
export interface UnitLine { unit_id: string | null | undefined; code?: string | null }
export interface LineIssue { line: number; message: string }

export function missingUnitIssues(lines: UnitLine[]): LineIssue[] {
  const out: LineIssue[] = [];
  lines.forEach((l, i) => {
    if (l.unit_id) return;
    out.push({ line: i + 1, message: `บรรทัดที่ ${i + 1}${l.code ? ` (${l.code})` : ''}: ยังไม่มีหน่วยนับ — เลือกหน่วยในช่อง "หน่วย" หรือกำหนดหน่วยนับหลักที่แฟ้มสินค้า` });
  });
  return out;
}

/** จำนวนบรรทัดว่างของตารางรายการให้พอดีจอ: 5–10 บรรทัดตามความสูงจอ (ส่วนหัว/ท้ายเอกสารใช้ราว 470px · บรรทัดละราว 40px) */
export function fillRowCount(viewportHeight: number): number {
  return Math.max(5, Math.min(10, Math.floor((viewportHeight - 470) / 40)));
}
