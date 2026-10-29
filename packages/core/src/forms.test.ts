import { describe, it, expect } from 'vitest';
import { bahtText } from './baht.js';
import { wht50Layout, wht50FormOf, wht50Date, type Wht50Data } from './forms/wht50.js';

describe('bahtText (จำนวนเงินตัวอักษร)', () => {
  it('reads like BAHTTEXT', () => {
    expect(bahtText('100000')).toBe('หนึ่งแสนบาทถ้วน');
    expect(bahtText('0')).toBe('ศูนย์บาทถ้วน');
    expect(bahtText('1')).toBe('หนึ่งบาทถ้วน');
    expect(bahtText('11')).toBe('สิบเอ็ดบาทถ้วน');
    expect(bahtText('21.01')).toBe('ยี่สิบเอ็ดบาทหนึ่งสตางค์');
    expect(bahtText('101')).toBe('หนึ่งร้อยเอ็ดบาทถ้วน');
    expect(bahtText('0.5')).toBe('ห้าสิบสตางค์');
    expect(bahtText('1000001')).toBe('หนึ่งล้านเอ็ดบาทถ้วน');
    expect(bahtText('21000000')).toBe('ยี่สิบเอ็ดล้านบาทถ้วน');
    expect(bahtText('1234567.89')).toBe('หนึ่งล้านสองแสนสามหมื่นสี่พันห้าร้อยหกสิบเจ็ดบาทแปดสิบเก้าสตางค์');
    expect(bahtText('-3.25')).toBe('ลบสามบาทยี่สิบห้าสตางค์');
    expect(bahtText('1000000000000')).toBe('หนึ่งล้านล้านบาทถ้วน');
  });
});

describe('50 ทวิ layout', () => {
  // ตัวอย่างจากไฟล์ต้นฉบับ docs/50ทวิ.pdf
  const data: Wht50Data = {
    payer: { name: 'บริษัท ทีเอสซี เชียงใหม่ จำกัด', address: '9/1 ซอย 3 ถนนอารักษ์ ตำบลศรีภูมิ อำเภอเมืองเชียงใหม่ จังหวัดเชียงใหม่', tax_id: '0505566004992' },
    payee: { name: 'นายคนึง โยธาใหญ่', address: '9/1 ซอย 3 ถนนอารักษ์', tax_id: '3-5099-00750-79-9' },
    form: '3', condition: '1', issue_date: '2023-03-15',
    lines: [{ row: '5', date: '2023-03-15', amount: '1500000', tax: '75000' }, { row: '5', date: '2023-03-10', amount: '500000', tax: '25000' }],
  };
  const r = wht50Layout(data);
  const get = (k: string) => r.items.find((i) => i.key === k);
  it('totals, words and Buddhist dates', () => {
    expect(r.total_amount).toBe('2000000.00');
    expect(r.total_tax).toBe('100000.00');
    expect(r.total_words).toBe('หนึ่งแสนบาทถ้วน');
    expect(get('date.5')?.text).toBe('15/03/2566');
    expect(get('pay.5.baht')?.text).toBe('2,000,000');
    expect(get('pay.5.satang')?.text).toBe('00');
    expect(get('tax.total.baht')?.text).toBe('100,000');
    expect(get('issue_m')?.text).toBe('มีนาคม');
    expect(get('issue_y')?.text).toBe('2566');
    expect(wht50Date('2026-10-29')).toBe('29/10/2569');
  });
  it('puts tax-id digits into the 13 boxes (1-4-5-2-1) and ticks the right boxes', () => {
    const digits = r.items.filter((i) => i.key.startsWith('payee_id.')).map((i) => i.text).join('');
    expect(digits).toBe('3509900750799');
    const d0 = get('payee_id.0')!, d1 = get('payee_id.1')!;
    expect(d1.x - d0.x).toBeCloseTo(((557.6 - 375.3) / 17) * 2, 1);   // ข้ามช่องขีดคั่นกลุ่ม
    expect(get('form')).toMatchObject({ text: '✓', x: 471.3 });          // (4) ภ.ง.ด.3
    expect(get('condition')).toMatchObject({ x: 82.5 });                  // (1) หัก ณ ที่จ่าย
    expect(get('payer_name')?.text).toBe('บริษัท ทีเอสซี เชียงใหม่ จำกัด');
    expect(wht50Layout({ ...data, payer: { ...data.payer, branch_no: '00000' } }).items.find((i) => i.key === 'payer_name')?.text).toMatch(/\(สำนักงานใหญ่\)$/);
    expect(r.items.every((i) => i.x >= 0 && i.y >= 0 && i.x + i.w <= 595 && i.y + i.h <= 842)).toBe(true);
  });
  it('chooses PND form from supplier code or tax id', () => {
    expect(wht50FormOf('S53')).toBe('53');
    expect(wht50FormOf('S03')).toBe('3');
    expect(wht50FormOf(null, '3509900750799')).toBe('3');
    expect(wht50FormOf(null, '0505566004992')).toBe('53');
  });
});
