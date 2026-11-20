import { describe, expect, it } from 'vitest';
import { PERM_COLS, permClear, permCompact, permConflicts, permDescendants, permInherited, permMaterialize, permSet, type PermRowVals, type PermRows } from './perm-tree.js';

const row = (v: string, over: Partial<PermRowVals> = {}): PermRowVals => ({ ...(Object.fromEntries(PERM_COLS.map((c) => [c, v])) as PermRowVals), ...over });

describe('permission tree: cascade + inherited values (HANDOFF 161)', () => {
  it('descendants and inheritance follow the menu tree up to ALL', () => {
    expect(permDescendants('PU')).toEqual(expect.arrayContaining(['PU.AE', 'PU.PO', 'PU.RR', 'PU.OE', 'PU.SUP', 'PU.EXP']));
    expect(permDescendants('ALL')).toEqual(expect.arrayContaining(['PU', 'PU.SUP', 'SA.IV', 'FI.AR.RE']));
    expect(permDescendants('PU.SUP')).toEqual([]);
    const rows: PermRows = { ALL: row('Y') };
    expect(permInherited(rows, 'PU.SUP')).toEqual({ from: 'ALL', row: row('Y') });
    expect(permInherited({ ...rows, PU: row('N') }, 'PU.SUP')!.from).toBe('PU');
    expect(permInherited({}, 'PU.SUP')).toBeNull();
    expect(permMaterialize({}, 'PU.SUP')).toEqual(row('N'));
  });
  it('setting PU = Y fills every PU child (inherited); changing one child cell keeps the rest of its row', () => {
    let rows: PermRows = { ALL: row('N') };
    rows = permSet(rows, 'PU', row('Y'));
    for (const c of permDescendants('PU')) expect(permInherited(rows, c)).toEqual({ from: 'PU', row: row('Y') });
    rows = permSet(rows, 'PU.SUP', { can_add: 'N' });
    expect(rows['PU.SUP']).toEqual(row('Y', { can_add: 'N' }));   // ช่องอื่นเท่าค่าที่ได้รับจาก PU
    expect(permInherited(rows, 'PU.RR')!.row.can_add).toBe('Y');
  });
  it('asks before overwriting children that differ; overwrite vs keep', () => {
    let rows: PermRows = { PU: row('Y'), 'PU.SUP': row('Y', { can_add: 'N' }), 'PU.RR': row('Y') };
    expect(permConflicts(rows, 'PU', { can_add: 'Y' })).toEqual(['PU.SUP']);
    expect(permConflicts(rows, 'PU', { can_add: 'N' }).sort()).toEqual(['PU.RR']);
    expect(permConflicts(rows, 'PU', { can_read: 'Y' })).toEqual([]);
    const over = permSet(rows, 'PU', { can_add: 'Y' }, 'overwrite');
    expect(over['PU.SUP']!.can_add).toBe('Y');
    const keep = permSet(rows, 'PU', { can_add: 'L' }, 'keep');
    expect([keep.PU!.can_add, keep['PU.SUP']!.can_add, keep['PU.RR']!.can_add]).toEqual(['L', 'N', 'Y']);
    rows = permSet(rows, 'ALL', row('N'), 'overwrite');
    expect(Object.values(rows).every((r) => PERM_COLS.every((c) => r[c] === 'N'))).toBe(true);
  });
  it('save keeps only rows that differ from what they inherit — effective rights unchanged', () => {
    const rows: PermRows = { ALL: row('Y'), PU: row('Y'), 'PU.RR': row('Y'), 'PU.SUP': row('Y', { can_add: 'N' }), SA: row('N'), 'SA.IV': row('N') };
    const c = permCompact(rows);
    expect(Object.keys(c).sort()).toEqual(['ALL', 'PU.SUP', 'SA']);
    const eff = (r: PermRows, code: string) => r[code] ?? permInherited(r, code)!.row;
    for (const code of ['PU', 'PU.RR', 'PU.SUP', 'PU.EXP', 'SA', 'SA.IV', 'SA.QT', 'GL.JNL']) expect([code, eff(c, code)]).toEqual([code, eff(rows, code)]);
    expect(permCompact({ 'PU.SUP': row('N') })).toEqual({ 'PU.SUP': row('N') });   // ไม่มีเมนูหลักที่มีแถว = เก็บไว้
    expect(permCompact({ PU: { ...row('Y'), can_print: '' } }).PU!.can_print).toBe('N');   // ว่าง = N (เหมือน API)
    expect(permClear({ PU: row('Y'), 'PU.SUP': row('N') }, 'PU')).toEqual({ 'PU.SUP': row('N') });
  });
});
