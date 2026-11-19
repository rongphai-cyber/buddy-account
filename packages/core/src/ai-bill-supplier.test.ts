import { describe, expect, it } from 'vitest';
import { addressLines, nextCode, normalizeBill, supplierFromBill, type RawBill } from './ai-bill.js';

const raw = (sup: RawBill['supplier']): RawBill => ({ doc_kind: 'receipt', supplier: sup, doc_no: 'R1', doc_date: '2026-11-01', price_type: 'incl_vat', vat_rate: '7',
  lines: [{ description: 'ค่าไฟฟ้า', qty: '1', unit: null, unit_price: '1070', amount: '1070' }], subtotal: '1070', discount: null, vat_amount: '70', total: '1070', notes: [] });

describe('add a supplier from a read bill (owner 19/11/2569)', () => {
  it('prefills name, tax ID (as read — the user fixes a misread), branch (none = head office 00000), address lines, zip and phone', () => {
    const b = normalizeBill(raw({ name: 'การไฟฟ้าส่วนภูมิภาค', tax_id: '0994000165501', branch_no: null, address: '200 ถนนงามวงศ์วาน แขวงลาดยาว เขตจตุจักร กรุงเทพมหานคร 10900', phone: '1129' }));
    expect(supplierFromBill(b)).toEqual({ name: 'การไฟฟ้าส่วนภูมิภาค', tax_id: '0994000165501', tax_branch_no: '00000', phone: '1129',
      address_1: '200 ถนนงามวงศ์วาน แขวงลาดยาว เขตจตุจักร กรุงเทพมหานคร 10900', address_2: '', address_3: '', zip_code: '10900' });
    const bad = normalizeBill(raw({ name: 'ร้าน ก', tax_id: '099400016550', branch_no: '1', address: null }));
    expect([bad.supplier.tax_id, supplierFromBill(bad).tax_id, supplierFromBill(bad).tax_branch_no, bad.supplier.phone]).toEqual([null, '099400016550', '00001', null]);
  });
  it('splits a long address at spaces into at most 3 lines of 100', () => {
    const long = Array.from({ length: 40 }, (_, i) => `คำที่${i}`).join(' ');
    const a = addressLines(long);
    expect([a.address_1.length <= 100, a.address_2.length <= 100, a.address_3.length <= 100, a.address_1.endsWith(' ')]).toEqual([true, true, true, false]);
    expect(`${a.address_1} ${a.address_2} ${a.address_3}`.startsWith(long.slice(0, 200).split(' ').slice(0, -1).join(' '))).toBe(true);
    expect(addressLines(null)).toEqual({ address_1: '', address_2: '', address_3: '', zip_code: '' });
  });
  it('suggests the next code in the pattern the company uses most', () => {
    expect(nextCode(['S001', 'S002', 'S015', 'TEMP', 'X9'])).toBe('S016');
    expect(nextCode(['AP-0099', 'AP-0100', 'S1'])).toBe('AP-0101');
    expect(nextCode([], 'S001')).toBe('S001');
    expect(nextCode(['ABC'], '')).toBe('');
  });
});
