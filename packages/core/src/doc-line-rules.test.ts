import { describe, it, expect } from 'vitest';
import { fillRowCount, isStockItemType, missingUnitIssues, requiredLineIssues } from './doc-line-rules.js';

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
});
