import { describe, it, expect } from 'vitest';
import { fillRowCount, missingUnitIssues } from './doc-line-rules.js';

describe('document line rules (เจ้าของ 18/11/2569)', () => {
  it('every purchase/sale line needs a unit — the message names the line and the fix', () => {
    expect(missingUnitIssues([{ unit_id: 'u1', code: 'A' }, { unit_id: 'u2' }])).toEqual([]);
    const r = missingUnitIssues([{ unit_id: 'u1', code: 'A' }, { unit_id: null, code: 'B-01' }, { unit_id: undefined }]);
    expect(r.map((x) => x.line)).toEqual([2, 3]);
    expect(r[0]!.message).toBe('บรรทัดที่ 2 (B-01): ยังไม่มีหน่วยนับ — เลือกหน่วยในช่อง "หน่วย" หรือกำหนดหน่วยนับหลักที่แฟ้มสินค้า');
    expect(r[1]!.message).toMatch(/^บรรทัดที่ 3: ยังไม่มีหน่วยนับ/);
  });
  it('blank rows fill the screen: 5 to 10', () => {
    expect(fillRowCount(600)).toBe(5);
    expect(fillRowCount(900)).toBe(10);
    expect(fillRowCount(800)).toBe(8);
    expect(fillRowCount(2000)).toBe(10);
  });
});
