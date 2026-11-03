import { describe, it, expect } from 'vitest';
import { compareSourceTotals, parseSourceTotals } from './source-totals.js';

describe('WTS Connect: เทียบยอดต้นทาง (docs/17 B0.2)', () => {
  it('parses money strings, rejects unknown fields and floats beyond 2 places', () => {
    expect(parseSourceTotals(undefined)).toBeNull();
    expect(parseSourceTotals({ net_amount: '30000.00', vat_amount: '1962.62' })).toEqual({ totals: { net_amount: '30000.00', vat_amount: '1962.62' }, errors: [] });
    expect(parseSourceTotals({ total: 100 })!.totals).toEqual({ total: '100' });
    expect(parseSourceTotals({ vat: '1' })!.errors[0]).toMatch(/ไม่รู้จัก/);
    expect(parseSourceTotals({ vat_amount: '1962.625' })!.errors[0]).toMatch(/2 ตำแหน่ง/);
    expect(parseSourceTotals({ vat_amount: '1,962.62' })!.errors).toHaveLength(1);
    expect(parseSourceTotals({})!.errors[0]).toMatch(/ว่าง/);
    expect(parseSourceTotals([1])!.errors[0]).toMatch(/ออบเจ็กต์/);
  });
  it('matches to the satang — a 0.01 difference is reported, never rounded away', () => {
    // ตัวอย่างข้อ 7.1: 30,000 รวม VAT → ก่อน VAT 28,037.38 · ภาษีขาย 1,962.62
    const buddy = { net_amount: '30000.00', taxable_amount: '28037.38', vat_amount: '1962.62' };
    expect(compareSourceTotals({ net_amount: '30000', vat_amount: '1962.62', taxable_amount: '28037.38' }, buddy)).toEqual([]);
    expect(compareSourceTotals({ vat_amount: '1962.63' }, buddy)).toEqual([{ field: 'vat_amount', label: 'ภาษีมูลค่าเพิ่ม', source: '1962.63', buddy: '1962.62', diff: '-0.01' }]);
    expect(compareSourceTotals({ wht_amount: '0.00' }, { wht_amount: null })).toEqual([]);
    expect(compareSourceTotals({ total: '1234.50' }, { total: '1234.51' })[0]!.diff).toBe('0.01');
  });
});
