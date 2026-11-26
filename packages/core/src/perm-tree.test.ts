import { describe, expect, it } from 'vitest';
import { PERM_COLS, permCell, permChain, permClear, permCompact, permConflicts, permDescendants, permInheritedCell, permMark, permSet, type PermRowVals, type PermRows } from './perm-tree.js';

const row = (v: string, over: PermRowVals = {}): PermRowVals => ({ ...(Object.fromEntries(PERM_COLS.map((c) => [c, v])) as PermRowVals), ...over });

describe('permission tree: cascade + inherited values (HANDOFF 161)', () => {
  it('descendants and the chain follow the menu tree up to ALL', () => {
    expect(permDescendants('PU')).toEqual(expect.arrayContaining(['PU.AE', 'PU.PO', 'PU.RR', 'PU.OE', 'PU.SUP', 'PU.EXP']));
    expect(permDescendants('ALL')).toEqual(expect.arrayContaining(['PU', 'PU.SUP', 'SA.IV', 'FI.AR.RE']));
    expect(permDescendants('PU.SUP')).toEqual([]);
    expect(permChain('FI.AR.RE')).toEqual(['FI.AR.RE', 'FI.AR', 'FI', 'ALL']);
    expect(permChain('ALL')).toEqual(['ALL']);
    const rows: PermRows = { ALL: row('Y') };
    expect(permCell(rows, 'PU.SUP', 'can_add')).toEqual({ v: 'Y', from: 'ALL', layer: 'own' });
    expect(permCell({ ...rows, PU: row('N') }, 'PU.SUP', 'can_add')!.from).toBe('PU');
    expect(permCell({}, 'PU.SUP', 'can_add')).toBeNull();
  });
  it('setting PU = Y fills every PU child; changing one child cell sets only that cell', () => {
    let rows: PermRows = { ALL: row('N') };
    rows = permSet(rows, 'PU', row('Y'));
    for (const c of permDescendants('PU')) expect(permCell(rows, c, 'can_read')).toEqual({ v: 'Y', from: 'PU', layer: 'own' });
    rows = permSet(rows, 'PU.SUP', { can_add: 'N' });
    expect(rows['PU.SUP']).toEqual({ can_add: 'N' });   // เฉพาะช่องที่เลือก — ช่องอื่นยังตามเมนูหลัก
    expect(permCell(rows, 'PU.SUP', 'can_read')!.from).toBe('PU');
    expect(permCell(rows, 'PU.RR', 'can_add')!.v).toBe('Y');
    // เลือก "ตามเมนูหลัก" = ล้างช่อง → แถวว่างหายไป
    rows = permSet(rows, 'PU.SUP', { can_add: '' });
    expect(rows['PU.SUP']).toBeUndefined();
  });
  it('asks before overwriting children that differ; overwrite clears their cells, keep leaves them', () => {
    const rows: PermRows = { PU: row('Y'), 'PU.SUP': { can_add: 'N' }, 'PU.RR': row('Y') };
    expect(permConflicts(rows, 'PU', { can_add: 'Y' })).toEqual(['PU.SUP']);
    expect(permConflicts(rows, 'PU', { can_add: 'N' }).sort()).toEqual(['PU.RR']);
    expect(permConflicts(rows, 'PU', { can_read: 'N' })).toEqual(['PU.RR']);
    expect(permConflicts({ PU: row('Y'), 'PU.SUP': { can_add: 'N' } }, 'PU', { can_read: 'Y' })).toEqual([]);
    const over = permSet(rows, 'PU', { can_add: 'L' }, 'overwrite');
    expect(over['PU.SUP']).toBeUndefined();   // ช่องเดียวที่ตั้งไว้ถูกล้าง → ได้ L จาก PU
    expect(over['PU.RR']!.can_add).toBeUndefined();
    expect(over['PU.RR']!.can_read).toBe('Y');
    expect(permCell(over, 'PU.SUP', 'can_add')).toEqual({ v: 'L', from: 'PU', layer: 'own' });
    const keep = permSet(rows, 'PU', { can_add: 'L' }, 'keep');
    expect([keep.PU!.can_add, keep['PU.SUP']!.can_add, keep['PU.RR']!.can_add]).toEqual(['L', 'N', 'Y']);
  });
  it('save keeps only cells set explicitly (even when equal to what they would inherit)', () => {
    const rows: PermRows = { ALL: row('Y'), PU: row('Y'), 'PU.SUP': { can_add: 'N', can_read: '' }, SA: {} };
    const c = permCompact(rows);
    expect(Object.keys(c).sort()).toEqual(['ALL', 'PU', 'PU.SUP']);
    expect(c['PU.SUP']).toEqual({ can_add: 'N' });
    expect(permClear({ PU: row('Y'), 'PU.SUP': row('N') }, 'PU')).toEqual({ 'PU.SUP': row('N') });
  });
});

describe('per-cell inheritance from the group (HANDOFF 197)', () => {
  const group: PermRows = { SA: row('Y', { can_delete: '', can_approve: '' }), 'FI.AR': { can_read: 'Y', can_print: 'Y' }, ALL: { can_read: 'N' } };
  it('an empty user cell inherits from the group, a set user cell overrides only that cell', () => {
    const own: PermRows = { 'SA.IV': { can_cancel: 'N' } };
    expect(permCell(own, 'SA.IV', 'can_cancel')).toEqual({ v: 'N', from: 'SA.IV', layer: 'own' });
    expect(permCell(own, 'SA.IV', 'can_add', group)).toEqual({ v: 'Y', from: 'SA', layer: 'group' });
    expect(permCell(own, 'FI.AR.RE', 'can_add', group)).toBeNull();          // กลุ่มไม่ได้ตั้งช่องเพิ่มที่ลูกหนี้ → ไม่ได้รับ
    expect(permCell(own, 'FI.AR.RE', 'can_read', group)!.from).toBe('FI.AR');
    expect(permCell(own, 'GL.JNL', 'can_read', group)).toEqual({ v: 'N', from: 'ALL', layer: 'group' });
    // ผู้ใช้ตั้งที่เมนูหลักของตัวเอง (SA) ชนะกลุ่มที่เมนูย่อย — ตารางของผู้ใช้ทั้งสายก่อน แล้วจึงกลุ่ม (เหมือน API)
    expect(permCell({ SA: { can_add: 'N' } }, 'SA.IV', 'can_add', group)).toEqual({ v: 'N', from: 'SA', layer: 'own' });
  });
  it('inherited value of a cell ignores the cell itself', () => {
    const own: PermRows = { 'SA.IV': { can_add: 'N' } };
    expect(permInheritedCell(own, 'SA.IV', 'can_add', group)).toEqual({ v: 'Y', from: 'SA', layer: 'group' });
    expect(permInheritedCell({ SA: { can_add: 'L' } }, 'SA', 'can_add')).toBeNull();
  });
  it('marks every value', () => {
    expect(['Y', 'L', 'N', 'S', '', null].map(permMark)).toEqual(['✓', '✓L', '✗', 'S', '✗', '✗']);
  });
});
