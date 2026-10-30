import { describe, it, expect } from 'vitest';
import { averageCost, computeDoc, discountAmount, dueDate, fifoCost, normalizeDiscount } from './doc-calc.js';

describe('document totals (บทที่ 11–12)', () => {
  it('parses Express discounts', () => {
    expect(discountAmount('1500', 10000)!.toFixed(2)).toBe('1500.00');
    expect(discountAmount('10%', 10000)!.toFixed(2)).toBe('1000.00');
    expect(discountAmount('5+2%', 10000)!.toFixed(2)).toBe('690.00');      // 10000 → 9500 → 9310
    expect(normalizeDiscount('10+')).toBe('10%');
    expect(discountAmount('abc', 100)).toBeNull();
    // ข้อกำหนดเจ้าของ: + ท้ายตัวเลข = % · คั่นด้วย , = ลดต่อกัน · + นำหน้า = ผิด
    expect(discountAmount('5+', 1000)!.toFixed(2)).toBe('50.00');
    expect(discountAmount('5+2+', 10000)!.toFixed(2)).toBe('690.00');
    expect(discountAmount('5+,200', 10000)!.toFixed(2)).toBe('700.00');     // 10000 → 9500 → 9300
    expect(discountAmount('5,000', 10000)?.toFixed(2)).toBe('5000.00');     // คั่นหลักพัน = จำนวนเดียว
    expect(discountAmount('12,500.50', 20000)?.toFixed(2)).toBe('12500.50');
    expect(normalizeDiscount('1,000')).toBe('1000');
    expect(discountAmount('200,5%', 10000)!.toFixed(2)).toBe('690.00');     // 10000 → 9800 → 9310
    expect(discountAmount(' 5 + , 200 ', 10000)!.toFixed(2)).toBe('700.00');
    expect(normalizeDiscount('5+,200')).toBe('5%,200');
    for (const bad of ['+5', '5+2', '5,,2', ',5', '5%%', '-5', '5+,'] ) expect(discountAmount(bad, 1000)).toBeNull();
  });
  it('VAT-exclusive (price type 2) matches Express RR0001525', () => {
    const r = computeDoc({ price_type: '2', vat_rate: 7, discount_text: '1.50', lines: [{ qty: 1, unit_price: '15335.50' }] });
    expect(r).toMatchObject({ amount: '15335.50', amount_after_discount: '15334.00', taxable_amount: '15334.00', vat_amount: '1073.38', net_amount: '16407.38' });
    expect(r.lines[0]!.net_amount).toBe('15334.00');
  });
  it('VAT-inclusive (price type 1) matches Express TI6908GGS004 — line net is ex-VAT', () => {
    const r = computeDoc({ price_type: '1', vat_rate: 7, discount_text: '0.13', lines: [{ qty: 2, unit_price: '10000' }, { qty: 1, unit_price: '10838.38' }] });
    expect(r).toMatchObject({ amount: '30838.38', amount_after_discount: '30838.25', vat_amount: '2017.46', net_amount: '30838.25' });
    expect(r.lines.reduce((s, l) => s + Number(l.net_amount), 0).toFixed(2)).toBe('28820.79');
  });
  it('deposit is deducted before VAT; lines + VAT − net = deposit (posting engine rule)', () => {
    const r = computeDoc({ price_type: '2', vat_rate: 7, deposit_amount: 1000, lines: [{ qty: 10, unit_price: 500, discount_text: '10%' }] });
    expect(r).toMatchObject({ amount: '4500.00', taxable_amount: '3500.00', vat_amount: '245.00', net_amount: '3745.00' });
    const sumLines = r.lines.reduce((s, l) => s + Number(l.net_amount), 0);
    expect((sumLines + 245 - 3745).toFixed(2)).toBe('1000.00');
  });
  it('exempt items and exempt price type; errors in Thai', () => {
    const r = computeDoc({ price_type: '2', vat_rate: 7, lines: [{ qty: 1, unit_price: 1000 }, { qty: 1, unit_price: 500, vat_exempt: true }] });
    expect(r).toMatchObject({ zero_rate_amount: '500.00', taxable_amount: '1000.00', vat_amount: '70.00', net_amount: '1570.00' });
    expect(computeDoc({ price_type: '0', vat_rate: 7, lines: [{ qty: 3, unit_price: 100 }] })).toMatchObject({ vat_amount: '0.00', net_amount: '300.00' });
    expect(computeDoc({ price_type: '2', vat_rate: 7, discount_text: 'x', lines: [{ qty: 1, unit_price: 1 }] }).errors[0]).toMatch(/ส่วนลดท้ายบิล/);
    expect(dueDate('2026-10-29', 30)).toBe('2026-11-28');
  });
});

describe('stock cost (T4.2)', () => {
  it('average: balance value / qty, fallback when nothing on hand', () => {
    expect(averageCost(10, 1000, 4)).toBe('400.00');
    expect(averageCost(0, 0, 2, 55)).toBe('110.00');
  });
  it('fifo: consumes oldest receipts after what was issued before; shortfall at last unit cost', () => {
    const rc = [{ qty: 10, value: 1000 }, { qty: 10, value: 1200 }];
    expect(fifoCost(rc, 0, 4)).toBe('400.00');
    expect(fifoCost(rc, 8, 4)).toBe('440.00');      // 2 @100 + 2 @120
    expect(fifoCost(rc, 18, 5)).toBe('600.00');     // 2 @120 + ขาด 3 @120
  });
});
