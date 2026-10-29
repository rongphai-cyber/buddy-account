import { describe, it, expect } from 'vitest';
import { aiCost, normalizeBill, suggestPrompt, textSim, type RawBill } from './ai-bill.js';

const raw: RawBill = {
  doc_kind: 'tax_invoice', supplier: { name: 'บริษัท ขายส่ง จำกัด', tax_id: '0-1055-37095-90-3', branch_no: '0', address: '1 ถนนพระราม 4 กรุงเทพฯ 10500' },
  doc_no: 'INV-001', doc_date: '2026-03-15', price_type: 'excl_vat', vat_rate: '7',
  lines: [{ description: 'กระดาษ A4', qty: '10', unit: 'รีม', unit_price: '120', amount: '1,200.00' }, { description: 'ค่าส่ง', qty: null, unit: null, unit_price: null, amount: '100' }],
  subtotal: '1300', discount: null, vat_amount: '91', total: '1391', notes: [],
};

describe('AI อ่านบิล (T7.7)', () => {
  it('cost per million tokens; fallback billed at the dearer model; unknown model priced at the maximum', () => {
    expect(aiCost({ input_tokens: 3000, output_tokens: 800 }, 'claude-opus-5-5').toString()).toBe('0.028');   // 3000×4 + 800×20 = 28,000 / 1M
    expect(aiCost({ input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000 }, 'claude-opus-5-5').toString()).toBe('9.2');
    expect(aiCost({ output_tokens: 1000 }, 'claude-opus-5-5', 'claude-opus-5').toString()).toBe('0.025');
    expect(aiCost({ output_tokens: 1000 }, 'claude-someday-9').toString()).toBe('0.05');
  });

  it('normalizes Thai bill output: tax id digits, branch 00000, amounts without commas, derived qty/price, consistent totals', () => {
    const b = normalizeBill(raw);
    expect(b.supplier).toMatchObject({ tax_id: '0105537095903', branch_no: '00000' });
    expect([b.price_type, b.vat_rate, b.total]).toEqual(['2', '7', '1391.00']);
    expect(b.lines).toEqual([
      { description: 'กระดาษ A4', qty: '10', unit: 'รีม', unit_price: '120', amount: '1200.00' },
      { description: 'ค่าส่ง', qty: '1', unit: null, unit_price: '100', amount: '100.00' },
    ]);
    expect(b.warnings).toEqual([]);
  });

  it('flags what the user must check: mismatched total, wrong VAT, Buddhist-year date, abbreviated invoice, unreadable values', () => {
    const b = normalizeBill({ ...raw, doc_kind: 'abbreviated_tax_invoice', doc_date: '2569-03-15', total: '1500', vat_amount: '50', notes: ['ตัวเลขบรรทัด 2 เลือน'],
      lines: [...raw.lines, { description: 'ไม่มีราคา', qty: '1', unit: null, unit_price: null, amount: null }] });
    const all = b.warnings.join('\n');
    for (const re of [/AI: ตัวเลขบรรทัด 2 เลือน/, /อย่างย่อ/, /ปี พ\.ศ\./, /บรรทัดที่ 3: อ่านราคาไม่ได้/, /ไม่สอดคล้องกับยอดรวมทั้งสิ้น 1500\.00/, /VAT 50\.00 ไม่เท่ากับ 7%/]) expect(all).toMatch(re);
    expect(normalizeBill({ ...raw, price_type: 'incl_vat', subtotal: '1391', vat_amount: '91', total: '1300' }).price_type).toBe('1');
  });
  it('Thai text similarity (no word spaces) and suggestion prompt carries only this company data', () => {
    expect(textSim('ค่าน้ำมันรถ', 'ค่าน้ำมันรถ')).toBe(1);
    expect(textSim('น้ำมันดีเซล 50 ลิตร', 'น้ำมันดีเซล')).toBeGreaterThan(0.7);
    expect(textSim('กระดาษ A4 80 แกรม', 'ค่าไฟฟ้า')).toBeLessThan(0.2);
    expect(textSim('', 'x')).toBe(0);
    const p = suggestPrompt({ businessType: 'trading', guidance: 'ค่าน้ำมันรถส่งของ ลงรหัส 95-5300-01', target: 'expense', supplierName: 'ปั๊ม ก', supplierKnown: true,
      lines: [{ index: 0, description: 'ดีเซล', amount: '500.00', candidates: [{ code: '95-5300-01', name: 'ค่าน้ำมัน', kind: 'expense', history: 4, sameSupplier: 3 }] }],
      expenseCodes: [{ code: '95-5300-01', name: 'ค่าน้ำมัน', kind: 'expense', account: '5300-01 ค่าน้ำมัน' }] });
    expect(p).toContain('ซื้อมาขายไป');
    expect(p).toContain('ลงรหัส 95-5300-01');
    expect(p).toContain('ใช้ได้เฉพาะรหัสค่าใช้จ่าย');
    expect(p).toContain('"history":4');
  });
});
