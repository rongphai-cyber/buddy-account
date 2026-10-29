import { describe, it, expect } from 'vitest';
import { buildPosting, netByAccount, postingBalanced, type PostingResolver } from './posting.js';

const DEF: Record<string, string> = { AR: 'ar', AP: 'ap', CASH: 'cash', CREDIT_SALES: 'sales', CASH_SALES: 'cashsales', OUTPUT_VAT: 'ovat', OUTPUT_VAT_PENDING: 'ovatp', INPUT_VAT: 'ivat',
  DEPOSIT_RECEIVED: 'depr', PURCHASES: 'pur', CHEQUE_PAID: 'chqp', CHEQUE_RECEIVED: 'chqr', SUSPENSE: 'susp', SALES_RETURN: 'sret', OTHER_EXPENSE: 'oexp' };
const r: PostingResolver = {
  slot: () => null, customer: (id) => (id === 'c1' ? 'ar-c1' : null), supplier: () => null,
  item: (id) => (id === 'svc' ? { type: '5', group: { inv: 'exp-svc' } } : { type: '0', group: { sales: 'sales-g' } }),
  paymentMethod: (id) => (id === 'QP' ? 'chq-paid' : null), cheque: () => null, def: (k) => DEF[k] ?? null, perpetual: false,
};
const net = (l: ReturnType<typeof buildPosting>) => Object.fromEntries([...netByAccount(l)].map(([k, v]) => [k, v.toFixed(2)]));

describe('posting engine (บทที่ 10)', () => {
  it('credit sale: Dr customer AR, Cr item group sales + VAT, deposit deducted', () => {
    const p = buildPosting({ id: 'h', doc_class: 'IV', doc_type_id: null, customer_id: 'c1', supplier_id: null, net_amount: '1000', vat_amount: '70', deposit_amount: '70', vat_basis: '1' },
      [{ item_id: 'x', net_amount: '1000' }], [], [], r);
    expect(postingBalanced(p)).toBe(true);
    expect(net(p)).toEqual({ 'ar-c1': '1000.00', 'sales-g': '-1000.00', ovat: '-70.00', depr: '70.00' });
  });
  it('receipt with cash-basis VAT moves pending → output VAT; rest is cash', () => {
    const p = buildPosting({ id: 'h', doc_class: 'RE', doc_type_id: null, customer_id: null, supplier_id: null, net_amount: '535', vat_amount: '0', deposit_amount: '0', vat_basis: null },
      [], [], [{ amount: '535', vat: '35', party_id: 'c2', rectype: '3' }], r);
    expect(postingBalanced(p)).toBe(true);
    expect(net(p)).toEqual({ ar: '-535.00', ovatp: '35.00', ovat: '-35.00', cash: '535.00' });
  });
  it('cash purchase of an expense code paid partly by cheque; missing accounts go to suspense', () => {
    const p = buildPosting({ id: 'h', doc_class: 'HP', doc_type_id: null, customer_id: null, supplier_id: null, net_amount: '1070', vat_amount: '70', deposit_amount: '0', vat_basis: '1' },
      [{ item_id: 'svc', net_amount: '1000' }], [{ method_id: 'QP', amount: '1000', cheque_id: null }], [], r);
    expect(net(p)).toEqual({ 'exp-svc': '1000.00', ivat: '70.00', cash: '-70.00', 'chq-paid': '-1000.00' });
    const s = buildPosting({ id: 'h', doc_class: 'HP', doc_type_id: null, customer_id: null, supplier_id: null, net_amount: '10', vat_amount: '0', deposit_amount: '0', vat_basis: '1' },
      [{ item_id: 'x', net_amount: '10' }], [{ method_id: 'ZZ', amount: '10', cheque_id: null }], [], { ...r, def: (k) => (k === 'PURCHASES' || k === 'CHEQUE_PAID' ? null : DEF[k] ?? null) });
    expect(s.every((l) => l.account_id === 'susp' && l.layer === 'S')).toBe(true);
  });
});
