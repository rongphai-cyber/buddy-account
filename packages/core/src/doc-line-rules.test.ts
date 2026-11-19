import { describe, it, expect } from 'vitest';
import { fillRowCount, isStockItemType, missingUnitIssues, descriptionAfterPick, isBlankTextLine, isCompleteTextLine, requiredLineIssues, textLineIssues } from './doc-line-rules.js';

describe('document line rules (เจ้าของ 18/11/2569)', () => {
  it('every purchase/sale line needs a unit — the message names the line and the fix', () => {
    expect(missingUnitIssues([{ unit_id: 'u1', code: 'A' }, { unit_id: 'u2' }])).toEqual([]);
    const r = missingUnitIssues([{ unit_id: 'u1', code: 'A' }, { unit_id: null, code: 'B-01' }, { unit_id: undefined }]);
    expect(r.map((x) => [x.line, x.field])).toEqual([[2, 'unit'], [3, 'unit']]);
    expect(r[0]!.message).toBe('บรรทัดที่ 2 (B-01): ยังไม่มีหน่วยนับ — เลือกหน่วยในช่อง "หน่วย" หรือกำหนดหน่วยนับหลักที่แฟ้มสินค้า');
    expect(r[1]!.message).toMatch(/^บรรทัดที่ 3: ยังไม่มีหน่วยนับ/);
  });
  it('round 2: warehouse for stock items, quantity and unit are required — in column order', () => {
    expect(['0', '1', '2', '3', '4', '5', null].map(isStockItemType)).toEqual([true, true, true, false, false, false, false]);
    const ok = { code: 'X', item_type: '0', unit_id: 'u', qty: '2', warehouse_id: 'w' };
    expect(requiredLineIssues([ok, { ...ok, item_type: '3', warehouse_id: null }])).toEqual([]);   // บริการไม่ต้องมีคลัง
    const r = requiredLineIssues([{ ...ok, warehouse_id: null }, { ...ok, qty: '' }, { ...ok, qty: '0' }, { ...ok, qty: '1,5x' }, { code: 'Y', item_type: '0', unit_id: null, qty: null, warehouse_id: null }]);
    expect(r.map((x) => [x.line, x.field])).toEqual([[1, 'warehouse'], [2, 'qty'], [3, 'qty'], [4, 'qty'], [5, 'warehouse'], [5, 'qty'], [5, 'unit']]);
    expect(r[0]!.message).toBe('บรรทัดที่ 1 (X): สินค้าที่มีสต๊อกต้องระบุคลัง — เลือกคลังในช่อง "คลัง"');
    expect(r[1]!.message).toBe('บรรทัดที่ 2 (X): ยังไม่ได้ใส่จำนวน — ใส่จำนวนในช่อง "จำนวน"');
    expect(requiredLineIssues([{ ...ok, qty: -3 }])).toEqual([]);   // ติดลบได้ (คืนของ)
  });
  it('blank rows: about 5, fewer on short screens', () => {
    expect(fillRowCount(900)).toBe(5);
    expect(fillRowCount(768)).toBe(4);
    expect(fillRowCount(700)).toBe(2);
    expect(fillRowCount(2000)).toBe(5);
  });
  it('deposit lines (description + amount): both required on any keyed line, at least one line, amount above 0', () => {
    expect(textLineIssues([{ description: 'มัดจำ 10%', amount: '1,000.00' }, { description: '', amount: '' }])).toEqual([]);   // บรรทัดว่างข้าม
    const r = textLineIssues([{ description: 'มัดจำ', amount: '' }, { description: '', amount: '500' }, { description: 'x', amount: '-5' }, { description: '  ', amount: '0' }]);
    expect(r.map((x) => [x.line, x.field])).toEqual([[1, 'amount'], [2, 'description'], [3, 'amount']]);
    expect(r[0]!.message).toBe('บรรทัดที่ 1: จำนวนเงินต้องมากกว่า 0 — ใส่ในช่อง "จำนวนเงิน"');
    expect(r[1]!.message).toBe('บรรทัดที่ 2: ยังไม่ได้ใส่คำอธิบาย — ใส่ในช่อง "คำอธิบาย"');
    expect(textLineIssues([{ description: '', amount: '' }]).map((x) => [x.line, x.field])).toEqual([[1, 'description']]);   // ต้องมีอย่างน้อย 1 บรรทัด
    expect(textLineIssues([])[0]!.message).toMatch(/^ยังไม่มีรายการ/);
    expect([{ description: '', amount: '0.00' }, { description: ' ', amount: '' }, { description: 'a', amount: '' }].map(isBlankTextLine)).toEqual([true, true, false]);
    expect([{ description: 'a', amount: '1,000.00' }, { description: 'a', amount: '0' }, { description: '', amount: '5' }].map(isCompleteTextLine)).toEqual([true, false, false]);
  });
  it('picking a code keeps the bill wording / typed description; empty or the previous code name gets the new code name (เจ้าของ 19/11/2569)', () => {
    expect(descriptionAfterPick('', null, 'ค่าเดินทาง')).toBe('ค่าเดินทาง');                                  // ว่าง = ชื่อรหัส
    expect(descriptionAfterPick('ค่าแท็กซี่ไปลูกค้า', null, 'ค่าเดินทาง')).toBe('ค่าแท็กซี่ไปลูกค้า');       // ข้อความตามบิลจาก AI คงไว้
    expect(descriptionAfterPick('ค่าแท็กซี่ไปลูกค้า', undefined, 'ค่าเดินทาง')).toBe('ค่าแท็กซี่ไปลูกค้า');
    expect(descriptionAfterPick('ค่าโฆษณา', 'ค่าโฆษณา', 'ค่าเดินทาง')).toBe('ค่าเดินทาง');                  // ยังเป็นชื่อรหัสเดิม = เปลี่ยนตาม
    expect(descriptionAfterPick('ค่าโฆษณาเฟซบุ๊ก', 'ค่าโฆษณา', 'ค่าเดินทาง')).toBe('ค่าโฆษณาเฟซบุ๊ก');     // ผู้ใช้แก้แล้ว = คงไว้
    expect(descriptionAfterPick('   ', 'x', 'ค่าเดินทาง')).toBe('ค่าเดินทาง');
  });
});
