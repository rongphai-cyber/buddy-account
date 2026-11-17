import { describe, it, expect } from 'vitest';
import { postedLineDesc } from './posting-desc.js';
import { buildPosting, type PostingResolver } from './posting.js';

describe('posted line description (เจ้าของ 17/11/2569)', () => {
  const H = 'บันทึกค่าใช้จ่ายอื่น ๆ ครีเอทีฟ แอด เอเจนซี่ จำกัด';
  it('main lines = header description only, side lines get a label', () => {
    expect(postedLineDesc(H, { role: 'EXPENSE', debit: '14900' })).toBe(H);
    expect(postedLineDesc(H, { role: 'CASH', debit: '0' })).toBe(H);
    expect(postedLineDesc(H, { role: 'INPUT_VAT', debit: '1043' })).toBe(`${H} · ภาษีซื้อ`);
    expect(postedLineDesc(H, { role: 'OUTPUT_VAT', debit: '0' })).toBe(`${H} · ภาษีขาย`);
  });
  it('WHT label by side: credit = withheld by us, debit = withheld from us', () => {
    expect(postedLineDesc(H, { role: 'WHT', debit: '0' })).toBe(`${H} · ภาษีหัก ณ ที่จ่าย`);
    expect(postedLineDesc('รับชำระหนี้ ลูกค้า ก', { role: 'WHT', debit: '30' })).toBe('รับชำระหนี้ ลูกค้า ก · ภาษีถูกหัก ณ ที่จ่าย');
  });
  it('cheque lines show the cheque number', () => {
    expect(postedLineDesc('จ่ายชำระหนี้ พริ้นท์เทค ซัพพลาย จำกัด', { role: 'PAYMENT', debit: '0' }, 'BBL0005631')).toBe('จ่ายชำระหนี้ พริ้นท์เทค ซัพพลาย จำกัด · เช็คจ่าย BBL0005631');
    expect(postedLineDesc('รับชำระหนี้', { role: 'PAYMENT', debit: '100' }, 'KB001')).toBe('รับชำระหนี้ · เช็ครับ KB001');
  });
  it('no header → label alone or null; long header keeps the label within 200 chars', () => {
    expect(postedLineDesc(null, { role: 'INPUT_VAT', debit: '1' })).toBe('ภาษีซื้อ');
    expect(postedLineDesc('', { role: 'AR', debit: '1' })).toBeNull();
    const long = postedLineDesc('ก'.repeat(250), { role: 'INPUT_VAT', debit: '1' })!;
    expect(long.length).toBeLessThanOrEqual(200);
    expect(long.endsWith(' · ภาษีซื้อ')).toBe(true);
  });
  it('posting engine keeps the cheque id on cheque payment lines', () => {
    const r: PostingResolver = { slot: () => null, customer: () => null, supplier: () => 'ap', item: () => ({ type: '0', group: {} }), paymentMethod: () => null, cheque: (id) => (id ? 'chq-paid' : null), def: (k) => (k === 'AP' ? 'ap' : k === 'CASH' ? 'cash' : 'susp'), perpetual: false };
    const p = buildPosting({ id: 'h', doc_class: 'PS', doc_type_id: null, customer_id: null, supplier_id: 's1', net_amount: '500', vat_amount: '0', deposit_amount: '0', vat_basis: null },
      [], [{ method_id: null, amount: '500', cheque_id: 'chq-1' }], [{ amount: '500', vat: '0', party_id: 's1', rectype: '1' }], r);
    expect(p.find((l) => l.role === 'PAYMENT')?.cheque_id).toBe('chq-1');
  });
});
