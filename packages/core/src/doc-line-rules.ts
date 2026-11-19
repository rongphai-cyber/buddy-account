/**
 * กฎของบรรทัดเอกสารซื้อ/ขาย (ไม่ขึ้นกับฐานข้อมูล — ใช้ทั้งหน้าจอและ server)
 * เจ้าของ 18/11/2569: "การคีย์ชื้อหรือขาย ต้องบังคับให้ใส่หน่วยทุกครั้ง ทุกรายการต้องมีหน่วยนับ"
 *   รอบ 2: "หน่วยที่จะต้องใส่ทุกครั้งไม่ต้องใส่ * ให้โปรแกรมบังคับให้ใส่ได้ก็พอ เช่นคลัง จำนวน ก็ต้องมีให้กรอกไม่ให้ข้าม"
 * ตรวจเฉพาะการคีย์จากหน้าจอ (WTS-POS/Living/นำเข้า ใช้ค่าเริ่มต้นตามเดิม) · เอกสารเดิมยังเปิดดู/ยกเลิกได้ — ตรวจตอนบันทึก (เพิ่ม/แก้)
 */
export interface UnitLine { unit_id: string | null | undefined; code?: string | null }
export type LineField = 'warehouse' | 'qty' | 'unit' | 'description' | 'amount';
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

/**
 * บรรทัดแบบคำอธิบาย + จำนวนเงิน (รับ/จ่ายเงินมัดจำ — เจ้าของ 18/11/2569 "ตอนคีย์รายการคำอธิบาย ไม่ควรให้ปล่อยว่างได้ต้องคีย์ และจำนวนเงินก็ต้องคีย์")
 * บรรทัดที่มีอะไรอย่างหนึ่ง ต้องมีทั้งคำอธิบายและจำนวนเงินมากกว่า 0 · บรรทัดว่างทั้งบรรทัดข้าม · ต้องมีอย่างน้อย 1 บรรทัด
 */
export interface TextAmountLine { description?: string | null; amount?: string | number | null }
const amountOf = (v: string | number | null | undefined) => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : NaN; };
/** บรรทัดว่างทั้งบรรทัด (ไม่มีคำอธิบาย และจำนวนเงินว่าง/0) — ไม่บันทึก */
export const isBlankTextLine = (l: TextAmountLine) => !(l.description ?? '').trim() && (!String(l.amount ?? '').trim() || amountOf(l.amount) === 0);
/** บรรทัดครบ: มีคำอธิบาย และจำนวนเงินมากกว่า 0 */
export const isCompleteTextLine = (l: TextAmountLine) => !!(l.description ?? '').trim() && amountOf(l.amount) > 0;
export function textLineIssues(lines: TextAmountLine[]): LineIssue[] {
  const out: LineIssue[] = [];
  let any = false;
  lines.forEach((l, i) => {
    const text = (l.description ?? '').trim(), raw = String(l.amount ?? '').trim();
    if (isBlankTextLine(l)) return;   // บรรทัดว่าง
    any = true;
    if (!text) out.push({ line: i + 1, field: 'description', message: `บรรทัดที่ ${i + 1}: ยังไม่ได้ใส่คำอธิบาย — ใส่ในช่อง "คำอธิบาย"` });
    if (!(amountOf(raw) > 0)) out.push({ line: i + 1, field: 'amount', message: `บรรทัดที่ ${i + 1}: จำนวนเงินต้องมากกว่า 0 — ใส่ในช่อง "จำนวนเงิน"` });
  });
  if (!any) out.push({ line: 1, field: 'description', message: 'ยังไม่มีรายการ — ใส่คำอธิบายและจำนวนเงินอย่างน้อย 1 บรรทัด' });
  return out;
}

/**
 * คำอธิบายบรรทัดเมื่อเลือกรหัส (สินค้า/ค่าใช้จ่าย/รายได้) — เจ้าของ 19/11/2569 "ใช้ข้อความตามบิล":
 * ว่าง หรือยังเป็นชื่อของรหัสที่เลือกไว้ก่อน = ใช้ชื่อรหัสใหม่ (คีย์เองสะดวกเหมือนเดิม) · ผู้ใช้พิมพ์เอง/ข้อความตามบิล (AI) = คงไว้
 * prevName ไม่ทราบ (undefined) = ถือว่าข้อความที่มีเป็นของผู้ใช้
 */
export function descriptionAfterPick(current: string | null | undefined, prevName: string | null | undefined, nextName: string): string {
  const cur = (current ?? '').trim();
  if (!cur) return nextName;
  if (prevName != null && cur === prevName.trim()) return nextName;
  return current!;
}
