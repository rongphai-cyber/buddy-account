import { describe, expect, it } from 'vitest';
import { ASSET_DEPR_KEYS, mapMasterImport, MASTER_IMPORT_KINDS, masterImportKindOf } from './master-import.js';

describe('HANDOFF 173: master-data Excel import', () => {
  it('covers customers, suppliers, items, services and fixed assets — every screen field, required-on-add marked', () => {
    expect(MASTER_IMPORT_KINDS.map((k) => k.path)).toEqual(['customers', 'suppliers', 'items', 'services', 'fa-assets']);
    const req = (p: string) => masterImportKindOf(p)!.columns.filter((c) => c.need === 'req').map((c) => c.key);
    expect([req('customers'), req('items'), req('services'), req('fa-assets')]).toEqual([['name'], ['name_th', 'base_unit_id'], ['name_th', 'accounts.revenue'], ['name_th', 'account_group_id', 'purchase_date', 'cost', 'start_date']]);
    expect(ASSET_DEPR_KEYS).toEqual(expect.arrayContaining(['cost', 'start_date', 'method', 'useful_life_years']));
  });
  it('reads only filled cells (blank = keep), converts formats, flags bad values and duplicate codes in the file', () => {
    const K = masterImportKindOf('customers')!;
    const H = ['รหัสลูกค้า', 'ชื่อลูกค้า', 'เครดิต (วัน)', 'ระงับการขาย', 'ระดับราคา', 'วงเงินเครดิต'];
    const r = mapMasterImport([H, ['C1', 'ก', '30', 'ใช่', '2', '1,000'], ['C2', '', '', '', '', ''], ['c1', 'ซ้ำ', '', '', '', ''], ['C3', 'x', '1.5', 'บางที', '9', 'abc']], 'B', K);
    expect(r.rows.map((x) => [x.row, x.code, x.values])).toEqual([[2, 'C1', { name: 'ก', credit_days: 30, on_hold: true, price_level: '2', credit_limit: '1000' }], [3, 'C2', {}]]);
    expect(r.errors.map((e) => [e.row, e.message])).toEqual([
      [4, 'รหัส c1 ซ้ำกับแถว 2 ในแฟ้ม — หนึ่งรหัสใส่แถวเดียว'],
      [5, 'ระงับการขาย "บางที" ใช้ ใช่ / ไม่ใช่ (Y/N)'], [5, 'เครดิต (วัน) "1.5" ต้องเป็นจำนวนเต็ม'], [5, 'ระดับราคา "9" ใช้ 1–5 (ราคาขายที่ใช้) · 0 = ไม่ระบุ'], [5, 'วงเงินเครดิต "abc" ไม่ใช่ตัวเลข'],
    ]);
    const A = masterImportKindOf('fa-assets')!;
    const a = mapMasterImport([['รหัสทรัพย์สิน', 'ชื่อทรัพย์สิน', 'วันที่ซื้อ', 'วิธีคิดค่าเสื่อม'], ['F1', 'คอม', '15/03/2569', 'ลดยอด']], 'B', A);
    expect(a.rows[0]!.values).toEqual({ name_th: 'คอม', purchase_date: '2026-03-15', method: '2' });
  });
});
