import { describe, it, expect } from 'vitest';
import { buildPosting, netByAccount, postingBalanced, settlementTotals, type PostingResolver } from './posting.js';

const DEF: Record<string, string> = { AR: 'ar', AP: 'ap', CASH: 'cash', CREDIT_SALES: 'sales', CASH_SALES: 'cashsales', OUTPUT_VAT: 'ovat', OUTPUT_VAT_PENDING: 'ovatp', INPUT_VAT: 'ivat',
  DEPOSIT_RECEIVED: 'depr', PURCHASES: 'pur', CHEQUE_PAID: 'chqp', CHEQUE_RECEIVED: 'chqr', SUSPENSE: 'susp', SALES_RETURN: 'sret', OTHER_EXPENSE: 'oexp',
  PREPAID_TAX: 'wht-r', WHT_PAYABLE: 'wht-p', SALES_DISCOUNT: 'sdisc', PURCHASE_DISCOUNT: 'pdisc', INTEREST_INCOME: 'int-i', INTEREST_EXPENSE: 'int-e' };
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
  it('receipt settles invoice + credit note with WHT, discount and interest (คู่มือหน้า 229)', () => {
    // บิล 10,700 − ใบลดหนี้ 1,070 = 9,630 · ถูกหัก 3% 270 · ส่วนลด 60 · ดอกเบี้ย 100 → รับจริง 9,400 (โอน 9,000 + เงินสด 400)
    const p = buildPosting({ id: 'h', doc_class: 'RE', doc_type_id: null, customer_id: 'c1', supplier_id: null, net_amount: '9400', vat_amount: '0', deposit_amount: '0', vat_basis: null,
      wht_amount: '270', cash_discount_amount: '60', interest_amount: '100' },
      [], [{ method_id: 'TR', amount: '9000', cheque_id: null }], [{ amount: '10700', vat: '0', party_id: 'c1', rectype: '3' }, { amount: '1070', vat: '0', party_id: 'c1', rectype: '5' }], { ...r, paymentMethod: (id) => (id === 'TR' ? 'bank' : null) });
    expect(postingBalanced(p)).toBe(true);
    expect(net(p)).toEqual({ 'ar-c1': '-9630.00', 'wht-r': '270.00', sdisc: '60.00', 'int-i': '-100.00', cash: '400.00', bank: '9000.00' });
    const q = buildPosting({ id: 'h', doc_class: 'PS', doc_type_id: null, customer_id: null, supplier_id: 's1', net_amount: '1560', vat_amount: '0', deposit_amount: '0', vat_basis: null, wht_amount: '45' },
      [], [], [{ amount: '1605', vat: '0', party_id: 's1', rectype: '3' }], r);
    expect(net(q)).toEqual({ ap: '1605.00', 'wht-p': '-45.00', cash: '-1560.00' });
  });
  it('other expense with WHT: Dr expense + VAT, Cr WHT payable, rest cash (S-PU-08)', () => {
    const p = buildPosting({ id: 'h', doc_class: 'OE', doc_type_id: null, customer_id: null, supplier_id: null, net_amount: '1070', vat_amount: '70', deposit_amount: '0', vat_basis: '1', wht_amount: '30' },
      [{ item_id: 'svc', net_amount: '1000' }], [], [], r);
    expect(postingBalanced(p)).toBe(true);
    expect(net(p)).toEqual({ 'exp-svc': '1000.00', ivat: '70.00', 'wht-p': '-30.00', cash: '-1040.00' });
  });
  it('perpetual: sale posts Dr COGS / Cr inventory at line cost; return reverses (T4.2)', () => {
    const rp = { ...r, perpetual: true, item: () => ({ type: '0', group: { sales: 'sales-g', cogs: 'cogs-g', inv: 'inv-g' } }) };
    const p = buildPosting({ id: 'h', doc_class: 'IV', doc_type_id: null, customer_id: 'c1', supplier_id: null, net_amount: '1070', vat_amount: '70', deposit_amount: '0', vat_basis: '1' },
      [{ item_id: 'x', net_amount: '1000', cost_amount: '600', stock_effect: -1 }], [], [], rp);
    expect(net(p)).toEqual({ 'ar-c1': '1070.00', 'sales-g': '-1000.00', ovat: '-70.00', 'cogs-g': '600.00', 'inv-g': '-600.00' });
    const c = buildPosting({ id: 'h', doc_class: 'CN', doc_type_id: null, customer_id: 'c1', supplier_id: null, net_amount: '107', vat_amount: '7', deposit_amount: '0', vat_basis: '1' },
      [{ item_id: 'x', net_amount: '100', cost_amount: '60', stock_effect: 1 }], [], [], { ...rp, item: () => ({ type: '0', group: { sret: 'sret-g', cogs: 'cogs-g', inv: 'inv-g' } }) });
    expect(net(c)).toEqual({ 'ar-c1': '-107.00', 'sret-g': '100.00', ovat: '7.00', 'inv-g': '60.00', 'cogs-g': '-60.00' });
    expect(postingBalanced(p) && postingBalanced(c)).toBe(true);
  });
  it('settlement totals: due must equal paid; blank cash takes the rest', () => {
    expect(settlementTotals({ settlements: ['10700', '-1070'], wht: '270', discount: '60', interest: '100', payments: ['9000'] })).toMatchObject({ billed: '9630.00', due: '9400.00', cash: '400.00', ok: true });
    expect(settlementTotals({ settlements: ['1605'], wht: '45', payments: ['1000'], cash: '500' })).toMatchObject({ diff: '60.00', ok: false });
    expect(settlementTotals({ settlements: ['100'], payments: ['150'] }).ok).toBe(false);   // เงินสดติดลบ
  });
  it('foreign AP/AR settlement with exchange gain/loss (บทที่ 26 S-AP-13)', () => {
    // คู่มือหน้า 446: เจ้าหนี้ 50,000 จ่ายเช็ค 48,000 → กำไร 2,000 · เดิม Express ใช้ช่องภาษีหัก ณ ที่จ่ายแทน
    const fxr = { ...r, def: (k: string) => (k === 'FX_GAIN_LOSS' ? 'fx' : DEF[k] ?? null), paymentMethod: (id: string) => (id === 'QP' ? 'chq-paid' : null) };
    expect(settlementTotals({ settlements: ['50000'], fx: '2000', direction: 'P', payments: ['48000'] })).toMatchObject({ due: '48000.00', cash: '0.00', ok: true });
    const g = buildPosting({ id: 'h', doc_class: 'PS', doc_type_id: null, customer_id: null, supplier_id: 's1', net_amount: '50000', vat_amount: '0', deposit_amount: '0', vat_basis: null, fx_amount: '2000' },
      [], [{ method_id: 'QP', amount: '48000', cheque_id: null }], [{ amount: '50000', vat: '0', party_id: 's1', rectype: '3' }], fxr);
    expect(postingBalanced(g)).toBe(true);
    expect(net(g)).toEqual({ ap: '50000.00', 'chq-paid': '-48000.00', fx: '-2000.00' });
    // ขาดทุน: จ่าย 51,000 สำหรับหนี้ 50,000
    const l = buildPosting({ id: 'h', doc_class: 'PS', doc_type_id: null, customer_id: null, supplier_id: 's1', net_amount: '50000', vat_amount: '0', deposit_amount: '0', vat_basis: null, fx_amount: '-1000' },
      [], [], [{ amount: '50000', vat: '0', party_id: 's1', rectype: '3' }], fxr);
    expect(net(l)).toEqual({ ap: '50000.00', fx: '1000.00', cash: '-51000.00' });
    // ลูกหนี้ต่างประเทศ: หนี้ 10,000 รับจริง 10,300 → กำไร 300
    expect(settlementTotals({ settlements: ['10000'], fx: '300', direction: 'R', payments: [] })).toMatchObject({ due: '10300.00', cash: '10300.00', ok: true });
    const e = buildPosting({ id: 'h', doc_class: 'RE', doc_type_id: null, customer_id: 'c1', supplier_id: null, net_amount: '10000', vat_amount: '0', deposit_amount: '0', vat_basis: null, fx_amount: '300' },
      [], [], [{ amount: '10000', vat: '0', party_id: 'c1', rectype: '3' }], fxr);
    expect(net(e)).toEqual({ 'ar-c1': '-10000.00', fx: '-300.00', cash: '10300.00' });
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
