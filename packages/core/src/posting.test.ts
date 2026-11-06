import { describe, it, expect } from 'vitest';
import { d } from './money.js';
import { buildPosting, depositRefundVat, netByAccount, openingPosting, postingBalanced, settlementTotals, settlementVatParts, type PostingResolver } from './posting.js';

const DEF: Record<string, string> = { AR: 'ar', AP: 'ap', CASH: 'cash', CREDIT_SALES: 'sales', CASH_SALES: 'cashsales', OUTPUT_VAT: 'ovat', OUTPUT_VAT_PENDING: 'ovatp', INPUT_VAT: 'ivat',
  DEPOSIT_RECEIVED: 'depr', PURCHASES: 'pur', CHEQUE_PAID: 'chqp', CHEQUE_RECEIVED: 'chqr', SUSPENSE: 'susp', SALES_RETURN: 'sret', OTHER_EXPENSE: 'oexp',
  PREPAID_TAX: 'wht-r', WHT_PAYABLE: 'wht-p', SALES_DISCOUNT: 'sdisc', PURCHASE_DISCOUNT: 'pdisc', INTEREST_INCOME: 'int-i', INTEREST_EXPENSE: 'int-e' };
const r: PostingResolver = {
  slot: () => null, customer: (id) => (id === 'c1' ? 'ar-c1' : null), supplier: () => null,
  item: (id) => (id === 'svc' ? { type: '5', group: { inv: 'exp-svc' } } : { type: '0', group: { sales: 'sales-g' } }),
  paymentMethod: (id) => (id === 'QP' ? 'chq-paid' : null), cheque: () => null, def: (k) => DEF[k] ?? null, perpetual: false,
};
const net = (l: ReturnType<typeof buildPosting>) => Object.fromEntries([...netByAccount(l)].map(([k, v]) => [k, v.toFixed(2)]));
/** ยอดบัญชีหลังเอกสารสองใบ + ยอดตั้งต้น (เช่น ใบมัดจำ Cr) */
const d0 = (a: ReturnType<typeof buildPosting>, b: ReturnType<typeof buildPosting>, acct: string, start: string) =>
  [a, b].reduce((s, l) => s.plus(netByAccount(l).get(acct) ?? d(0)), d(start)).toFixed(2);

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
  it('late fee / interest account per document type (HANDOFF ข้อ 91): RE ช่อง 7 · PS ช่อง 7 · ว่าง = บัญชีเพื่อลงรายวัน', () => {
    // บิล 1,000 + ค่าปรับชำระล่าช้า 107.55 → รับเงินสด 1,107.55 · Cr บัญชีของช่อง 7 = 107.55
    const H = { id: 'h', doc_class: 'RE', doc_type_id: 'RE-L', customer_id: 'c1', supplier_id: null, net_amount: '1107.55', vat_amount: '0', deposit_amount: '0', vat_basis: null, interest_amount: '107.55' };
    const S = [{ amount: '1000', vat: '0', party_id: 'c1', rectype: '3' }];
    const slotted: PostingResolver = { ...r, slot: (dt, cls, role) => (dt === 'RE-L' && cls === 'RE' && role === 'INTEREST_INCOME' ? 'late-fee' : dt === 'PS-L' && cls === 'PS' && role === 'INTEREST_EXPENSE' ? 'late-exp' : null) };
    const a = buildPosting(H, [], [], S, slotted);
    expect(postingBalanced(a)).toBe(true);
    expect(net(a)).toEqual({ 'ar-c1': '-1000.00', 'late-fee': '-107.55', cash: '1107.55' });
    expect(a.find((l) => l.role === 'INTEREST')).toMatchObject({ account_id: 'late-fee', layer: '1' });
    // ช่องว่าง (ประเภทเอกสารอื่น) = บัญชีดอกเบี้ยรับมาตรฐานเหมือนเดิม
    const b = buildPosting({ ...H, doc_type_id: 'RE-X' }, [], [], S, slotted);
    expect(net(b)).toEqual({ 'ar-c1': '-1000.00', 'int-i': '-107.55', cash: '1107.55' });
    expect(b.find((l) => l.role === 'INTEREST')).toMatchObject({ account_id: 'int-i', layer: '3' });
    // จ่ายชำระ: เจ้าหนี้ 2,000 + ค่าปรับจ่ายล่าช้า 45.25 → จ่าย 2,045.25 · Dr บัญชีของช่อง 7
    const P = { id: 'h', doc_class: 'PS', doc_type_id: 'PS-L', customer_id: null, supplier_id: 's1', net_amount: '2045.25', vat_amount: '0', deposit_amount: '0', vat_basis: null, interest_amount: '45.25' };
    expect(net(buildPosting(P, [], [], [{ amount: '2000', vat: '0', party_id: 's1', rectype: '3' }], slotted))).toEqual({ ap: '2000.00', 'late-exp': '45.25', cash: '-2045.25' });
    expect(net(buildPosting({ ...P, doc_type_id: null }, [], [], [{ amount: '2000', vat: '0', party_id: 's1', rectype: '3' }], slotted))).toEqual({ ap: '2000.00', 'int-e': '45.25', cash: '-2045.25' });
  });
  it('platform receipt (ข้อกำหนดเจ้าของ 31/10/2569): GP + VAT ในประเทศ หัก ณ ที่จ่าย 3% · ค่าคอมมิชชั่นต่างประเทศ ภ.พ.36', () => {
    // ขาย 1,000 ผ่าน Grab: GP 300 + VAT 21 = 321 → โอน 679 · เราหัก 3% ของ 300 = 9 (Grab หักเต็มแล้ว → รอเรียกคืน)
    const R = { ...r, paymentMethod: (id: string | null) => (id === 'TR' ? 'bank' : null), def: (k: string) => ({ ...DEF, INPUT_VAT_PP36: 'ivat36', PP36_PAYABLE: 'pp36', WHT_RECOVERABLE: 'wht-rc' } as Record<string, string>)[k] ?? null };
    const g = buildPosting({ id: 'h', doc_class: 'RE', doc_type_id: null, customer_id: 'c1', supplier_id: null, net_amount: '1000', vat_amount: '0', deposit_amount: '0', vat_basis: null },
      [], [{ method_id: 'TR', amount: '679', cheque_id: null }], [{ amount: '1000', vat: '0', party_id: 'c1', rectype: '3' }], R,
      [{ item_id: 'svc', amount: '300', vat_type: '1', vat_amount: '21', wht_amount: '9', wht_condition: '1' }]);
    expect(postingBalanced(g)).toBe(true);
    expect(net(g)).toEqual({ 'ar-c1': '-1000.00', 'exp-svc': '300.00', ivat: '21.00', 'wht-p': '-9.00', 'wht-rc': '9.00', bank: '679.00' });
    // Agoda 2,589.40 หักคอมมิชชั่น 388.41 (ต่างประเทศ ไม่เก็บ VAT) → โอน 2,200.99 · เรานำส่ง ภ.พ.36 27.19
    const a = buildPosting({ id: 'h', doc_class: 'RE', doc_type_id: null, customer_id: 'c1', supplier_id: null, net_amount: '2589.40', vat_amount: '0', deposit_amount: '0', vat_basis: null },
      [], [{ method_id: 'TR', amount: '2200.99', cheque_id: null }], [{ amount: '2589.40', vat: '0', party_id: 'c1', rectype: '3' }], R,
      [{ item_id: 'svc', amount: '388.41', vat_type: '3', vat_amount: '27.19', wht_amount: '0', wht_condition: '1' }]);
    expect(postingBalanced(a)).toBe(true);
    expect(net(a)).toEqual({ 'ar-c1': '-2589.40', 'exp-svc': '388.41', ivat36: '27.19', pp36: '-27.19', bank: '2200.99' });
    expect(settlementTotals({ settlements: ['2589.40'], charges: '388.41', direction: 'R', payments: ['2200.99'] })).toMatchObject({ due: '2200.99', ok: true });
    // ออกภาษีให้ (เงื่อนไข 3): ภาษีหัก ณ ที่จ่ายเป็นค่าใช้จ่าย
    const o = buildPosting({ id: 'h', doc_class: 'RE', doc_type_id: null, customer_id: 'c1', supplier_id: null, net_amount: '1000', vat_amount: '0', deposit_amount: '0', vat_basis: null },
      [], [], [{ amount: '1000', vat: '0', party_id: 'c1', rectype: '3' }], R, [{ item_id: 'svc', amount: '100', vat_type: '0', vat_amount: '0', wht_amount: '3', wht_condition: '3' }]);
    expect(net(o)).toEqual({ 'ar-c1': '-1000.00', 'exp-svc': '103.00', 'wht-p': '-3.00', cash: '900.00' });
    // รายการหักที่ตั้งที่ประเภทเอกสาร: บัญชีของรายการมาก่อนรหัสค่าใช้จ่าย (ค่าการตลาด ค่าโฆษณา แยกบัญชี)
    const m = buildPosting({ id: 'h', doc_class: 'RE', doc_type_id: null, customer_id: 'c1', supplier_id: null, net_amount: '1000', vat_amount: '0', deposit_amount: '0', vat_basis: null },
      [], [], [{ amount: '1000', vat: '0', party_id: 'c1', rectype: '3' }], R, [{ item_id: null, account_id: 'mkt', amount: '50', vat_type: '1', vat_amount: '3.50', wht_amount: '0', wht_condition: '1' }, { item_id: null, account_id: 'ads', amount: '100', vat_type: '1', vat_amount: '7', wht_amount: '2', wht_condition: '1' }]);
    expect(net(m)).toEqual({ 'ar-c1': '-1000.00', mkt: '50.00', ads: '100.00', ivat: '10.50', 'wht-p': '-2.00', 'wht-rc': '2.00', cash: '839.50' });
  });
  it('petty cash (ข้อกำหนดเจ้าของ 31/10/2569): DP Dr ค่าใช้จ่าย / Cr เงินสดย่อย · VR Dr เงินสดย่อย / Cr เงินสด-โอน', () => {
    const P = { ...r, paymentMethod: (id: string | null) => (id === 'TR' ? 'bank' : null), def: (k: string) => ({ ...DEF, PETTY_CASH: 'petty' } as Record<string, string>)[k] ?? null };
    const dp = buildPosting({ id: 'h', doc_class: 'DP', doc_type_id: null, customer_id: null, supplier_id: null, net_amount: '689', vat_amount: '0', deposit_amount: '0', vat_basis: null },
      [{ item_id: null, account_id: 'post', net_amount: '230' }, { item_id: null, account_id: 'taxi', net_amount: '310' }, { item_id: null, account_id: 'supp', net_amount: '149' }], [], [], P);
    expect(postingBalanced(dp)).toBe(true);
    expect(net(dp)).toEqual({ post: '230.00', taxi: '310.00', supp: '149.00', petty: '-689.00' });
    const vr = buildPosting({ id: 'h', doc_class: 'VR', doc_type_id: null, customer_id: null, supplier_id: null, net_amount: '3154', vat_amount: '0', deposit_amount: '0', vat_basis: null },
      [{ item_id: null, account_id: 'post', net_amount: '811' }], [{ method_id: 'TR', amount: '3000', cheque_id: null }], [], P);
    expect(net(vr)).toEqual({ petty: '3154.00', bank: '-3000.00', cash: '-154.00' });
  });
  it('cash purchase / cash sale with WHT: WHT replaces that part of cash', () => {
    const hp = buildPosting({ id: 'h', doc_class: 'HP', doc_type_id: null, customer_id: null, supplier_id: 's1', net_amount: '1070', vat_amount: '70', deposit_amount: '0', vat_basis: '1', wht_amount: '30' },
      [{ item_id: 'svc', net_amount: '1000' }], [], [], r);
    expect(postingBalanced(hp)).toBe(true);
    expect(net(hp)).toMatchObject({ ivat: '70.00', 'wht-p': '-30.00', cash: '-1040.00' });
    const hs = buildPosting({ id: 'h', doc_class: 'HS', doc_type_id: null, customer_id: 'c1', supplier_id: null, net_amount: '1070', vat_amount: '70', deposit_amount: '0', vat_basis: '1', wht_amount: '30' },
      [{ item_id: 'svc', net_amount: '1000' }], [], [], r);
    expect(postingBalanced(hs)).toBe(true);
    expect(net(hs)).toMatchObject({ 'wht-r': '30.00', cash: '1040.00' });
    // ไม่มีภาษีหัก ณ ที่จ่าย: เหมือนเดิม
    expect(net(buildPosting({ id: 'h', doc_class: 'HP', doc_type_id: null, customer_id: null, supplier_id: 's1', net_amount: '1070', vat_amount: '70', deposit_amount: '0', vat_basis: '1' },
      [{ item_id: 'svc', net_amount: '1000' }], [], [], r))).toMatchObject({ cash: '-1070.00' });
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

describe('ช่องบัญชีของประเภทเอกสารขาย/ซื้อ (ข้อกำหนดเจ้าของ 01/11/2569)', () => {
  // ประเภทเอกสาร T: IV ช่อง 1 ลูกหนี้ ช่อง 5 ขาย · RR ช่อง 1 ซื้อ ช่อง 3 เจ้าหนี้ · CN ช่อง 5 รับคืน
  const SLOTS: Record<string, Record<string, string>> = { IV: { AR: 'ar-doc', SALES: 'sales-doc' }, CN: { SALES_RETURN: 'sret-doc' }, RR: { PURCHASE: 'sub-con', AP: 'ap-doc' } };
  const R: PostingResolver = { ...r, slot: (dt, cls, role) => (dt === 'T' ? SLOTS[cls]?.[role] ?? null : null),
    item: (id) => (id === 'grp' ? { type: '0', group: { pur: 'pur-g', sales: 'sales-g' } } : id === 'exp' ? { type: '5', group: {} } : { type: '0', group: {} }) };
  const H = (doc_class: string, extra = {}) => ({ id: 'h', doc_class, doc_type_id: 'T', customer_id: 'c1', supplier_id: 's1', net_amount: '1070', vat_amount: '70', deposit_amount: '0', vat_basis: '1', ...extra });
  it('ขายเชื่อ: Dr. ลูกหนี้ และ Cr. ขาย ตามประเภทเอกสาร (ก่อนบัญชีของลูกค้า/กลุ่มสินค้า)', () => {
    const p = buildPosting(H('IV'), [{ item_id: 'grp', net_amount: '1000' }], [], [], R);
    expect(net(p)).toEqual({ 'ar-doc': '1070.00', 'sales-doc': '-1000.00', ovat: '-70.00' });
    const q = buildPosting(H('IV', { doc_type_id: null }), [{ item_id: 'grp', net_amount: '1000' }], [], [], R);
    expect(net(q)).toEqual({ 'ar-c1': '1070.00', 'sales-g': '-1000.00', ovat: '-70.00' });   // ว่าง = ลูกค้า/กลุ่มสินค้า
    expect(net(buildPosting(H('CN'), [{ item_id: 'x', net_amount: '1000' }], [], [], R))).toEqual({ 'ar-c1': '-1070.00', 'sret-doc': '1000.00', ovat: '70.00' });
  });
  it('ซื้อเชื่อ: ช่องซื้อใช้เมื่อกลุ่มบัญชีสินค้าไม่ได้กำหนด (แบบข้อมูล Express) · Perpetual ลงบัญชีสินค้า', () => {
    const p = buildPosting(H('RR'), [{ item_id: 'x', net_amount: '400' }, { item_id: 'exp', net_amount: '300' }, { item_id: 'grp', net_amount: '300' }], [], [], { ...R, def: (k) => ({ ...DEF, INPUT_VAT: 'ivat' } as Record<string, string>)[k] ?? null });
    expect(net(p)).toEqual({ 'sub-con': '700.00', 'pur-g': '300.00', ivat: '70.00', 'ap-doc': '-1070.00' });
    const perp = buildPosting(H('RR'), [{ item_id: 'x', net_amount: '1000' }], [], [], { ...R, perpetual: true, def: (k) => ({ ...DEF, INVENTORY: 'inv' } as Record<string, string>)[k] ?? null });
    expect(net(perp)).toEqual({ inv: '1000.00', ivat: '70.00', 'ap-doc': '-1070.00' });
  });
});

describe('มัดจำรับในใบเสร็จและใบคืนเงินมัดจำ (WTS-Living ย้ายออก — 05/11/2569)', () => {
  // มัดจำ AI 9,600 (ไม่มี VAT) · บิลค่าเช่า 3,500 (ยกเว้น) + น้ำ/ไฟ 978.65 + VAT 68.51 = 4,547.16 (ภาษีเกณฑ์เงินสด)
  // ประเภทเอกสารมัดจำ DEP ผูกบัญชีมัดจำรับช่อง 3 = 'depr-doc' · ใบมัดจำไม่ผูก = บัญชีเพื่อลงรายวัน DEPOSIT_RECEIVED ('depr')
  const R: PostingResolver = { ...r, slot: (dt, cls, role) => (dt === 'DEP' && cls === 'AI' && role === 'DEPOSIT_RECEIVED' ? 'depr-doc' : null), paymentMethod: (id) => (id === 'TB' ? 'bank' : null) };
  it('ใบเสร็จหักมัดจำเต็มยอด: Dr มัดจำรับ / Cr ลูกหนี้ · ภาษีรอเรียกเก็บ → ภาษีขาย · ไม่มีเงินสด', () => {
    const p = buildPosting({ id: 'h', doc_class: 'RE', doc_type_id: null, customer_id: 'c1', supplier_id: null, net_amount: '4547.16', vat_amount: '68.51', deposit_amount: '4547.16', vat_basis: null },
      [], [], [{ amount: '4547.16', vat: '68.51', party_id: 'c1', rectype: '3' }], R, [], [{ amount: '4547.16', doc_type_id: null }]);
    expect(postingBalanced(p)).toBe(true);
    expect(net(p)).toEqual({ 'ar-c1': '-4547.16', depr: '4547.16', ovatp: '68.51', ovat: '-68.51' });
  });
  it('ใบเสร็จหักมัดจำบางส่วน + โอน: มัดจำ 2 ใบลงบัญชีของแต่ละใบ ส่วนที่เหลือเป็นเงินโอน/เงินสด', () => {
    // บิล 1,000: หักมัดจำ DEP 300 + มัดจำไม่ผูกบัญชี 200 · โอน 400 · เงินสด 100
    const p = buildPosting({ id: 'h', doc_class: 'RE', doc_type_id: null, customer_id: 'c1', supplier_id: null, net_amount: '1000', vat_amount: '0', deposit_amount: '500', vat_basis: null },
      [], [{ method_id: 'TB', amount: '400', cheque_id: null }], [{ amount: '1000', vat: '0', party_id: 'c1', rectype: '3' }], R, [], [{ amount: '300', doc_type_id: 'DEP' }, { amount: '200', doc_type_id: null }]);
    expect(postingBalanced(p)).toBe(true);
    expect(net(p)).toEqual({ 'ar-c1': '-1000.00', 'depr-doc': '300.00', depr: '200.00', bank: '400.00', cash: '100.00' });
  });
  it('คืนเงินมัดจำ 4,752.84 โดยโอน: Dr มัดจำรับ / Cr ธนาคาร · คืนเป็นเงินสดเมื่อไม่ระบุวิธีจ่าย', () => {
    // 9,600 − 4,547.16 (ค่าเช่า/น้ำไฟ) − 300 (ค่าเสียหาย) = 4,752.84
    const p = buildPosting({ id: 'h', doc_class: 'RD', doc_type_id: null, customer_id: 'c1', supplier_id: null, net_amount: '4752.84', vat_amount: '0', deposit_amount: '4752.84', vat_basis: null },
      [], [{ method_id: 'TB', amount: '4752.84', cheque_id: null }], [], R, [], [{ amount: '4752.84', doc_type_id: 'DEP' }]);
    expect(postingBalanced(p)).toBe(true);
    expect(net(p)).toEqual({ 'depr-doc': '4752.84', bank: '-4752.84' });
    const c = buildPosting({ id: 'h', doc_class: 'RD', doc_type_id: null, customer_id: 'c1', supplier_id: null, net_amount: '500', vat_amount: '0', deposit_amount: '500', vat_basis: null }, [], [], [], R, [], [{ amount: '500', doc_type_id: null }]);
    expect(net(c)).toEqual({ depr: '500.00', cash: '-500.00' });
  });
  describe('คืนเงินมัดจำที่มี VAT = ใบลดหนี้ (06/11/2569)', () => {
    const f = (v: ReturnType<typeof depositRefundVat>) => [v.base.toFixed(2), v.vat.toFixed(2), v.paid.toFixed(2), v.exact];
    const rd = (deps: Array<{ amount: string; vat: string; price_type: string }>, pays: Array<{ method_id: string; amount: string; cheque_id: null }> = []) =>
      buildPosting({ id: 'h', doc_class: 'RD', doc_type_id: null, customer_id: 'c1', supplier_id: null, net_amount: '0', vat_amount: '0', deposit_amount: '0', vat_basis: '1' },
        [], pays, [], { ...r, paymentMethod: (id) => (id === 'TB' ? 'bank' : null) }, [], deps.map((x) => ({ ...x, doc_type_id: null })));
    it('(a) แยก VAT 10,000 + 7% = 10,700: คืน 4,000 → VAT 280 จ่าย 4,280 · คืน 6,000 ปิดยอด → VAT 420 จ่าย 6,420', () => {
      const one = depositRefundVat({ amount: '4000', price_type: '2', vat_rate: 7, deposit_vat: '700', outstanding: '10000', other_rd_vat: '0' });
      expect(f(one)).toEqual(['4000.00', '280.00', '4280.00', false]);
      const two = depositRefundVat({ amount: '6000', price_type: '2', vat_rate: 7, deposit_vat: '700', outstanding: '6000', other_rd_vat: '280' });
      expect(f(two)).toEqual(['6000.00', '420.00', '6420.00', true]);
      const p1 = rd([{ amount: '4000', vat: '280', price_type: '2' }], [{ method_id: 'TB', amount: '4280', cheque_id: null }]), p2 = rd([{ amount: '6000', vat: '420', price_type: '2' }]);
      expect([postingBalanced(p1), net(p1)]).toEqual([true, { depr: '4000.00', ovat: '280.00', bank: '-4280.00' }]);
      expect([postingBalanced(p2), net(p2)]).toEqual([true, { depr: '6000.00', ovat: '420.00', cash: '-6420.00' }]);
      // AI: Cr มัดจำรับ 10,000 + Cr ภาษีขาย 700 → หลังคืนสองใบเหลือ 0 ทั้งคู่
      expect([d0(p1, p2, 'depr', '-10000'), d0(p1, p2, 'ovat', '-700')]).toEqual(['0.00', '0.00']);
    });
    it('(b) รวม VAT 10,700 (VAT 700): คืน 5,000 → 4,672.90 + 327.10 · คืน 5,700 → 5,327.10 + 372.90', () => {
      expect(f(depositRefundVat({ amount: '5000', price_type: '1', vat_rate: 7, deposit_vat: '700', outstanding: '10700' }))).toEqual(['4672.90', '327.10', '5000.00', false]);
      expect(f(depositRefundVat({ amount: '5700', price_type: '1', vat_rate: 7, deposit_vat: '700', outstanding: '5700', other_rd_vat: '327.10' }))).toEqual(['5327.10', '372.90', '5700.00', true]);
      const p1 = rd([{ amount: '5000', vat: '327.10', price_type: '1' }]), p2 = rd([{ amount: '5700', vat: '372.90', price_type: '1' }]);
      expect(net(p1)).toEqual({ depr: '4672.90', ovat: '327.10', cash: '-5000.00' });
      expect([d0(p1, p2, 'depr', '-10000'), d0(p1, p2, 'ovat', '-700')]).toEqual(['0.00', '0.00']);
    });
    it('(c) รวม VAT 1,000 (VAT 65.42): คืน 333 → 311.21 + 21.79 · คืน 667 ปิดยอด → VAT 43.63 (ไม่ใช่ 43.64) บัญชีเหลือ 0.00', () => {
      expect(f(depositRefundVat({ amount: '333', price_type: '1', vat_rate: 7, deposit_vat: '65.42', outstanding: '1000' }))).toEqual(['311.21', '21.79', '333.00', false]);
      const last = depositRefundVat({ amount: '667', price_type: '1', vat_rate: 7, deposit_vat: '65.42', outstanding: '667', other_rd_vat: '21.79' });
      expect(f(last)).toEqual(['623.37', '43.63', '667.00', true]);
      // ไม่มีกฎปิดยอด (ยังมีเอกสารอื่นใช้มัดจำ) → ปัดตามสูตร 623.36 + 43.64 จะเหลือ 0.01
      expect(f(depositRefundVat({ amount: '667', price_type: '1', vat_rate: 7, deposit_vat: '65.42', outstanding: '667', other_rd_vat: '21.79', other_use: true }))).toEqual(['623.36', '43.64', '667.00', false]);
      const p1 = rd([{ amount: '333', vat: '21.79', price_type: '1' }]), p2 = rd([{ amount: '667', vat: '43.63', price_type: '1' }]);
      expect([d0(p1, p2, 'depr', '-934.58'), d0(p1, p2, 'ovat', '-65.42')]).toEqual(['0.00', '0.00']);
    });
    it('มัดจำไม่มี VAT: ไม่แยกภาษี ลงบัญชีเหมือนเดิม', () => {
      expect(f(depositRefundVat({ amount: '500', price_type: '0', vat_rate: 0, deposit_vat: '0', outstanding: '500' }))).toEqual(['500.00', '0.00', '500.00', false]);
      expect(net(rd([{ amount: '500', vat: '0', price_type: '0' }]))).toEqual({ depr: '500.00', cash: '-500.00' });
    });
  });
  it('ยอดใบเสร็จนับมัดจำที่หักเป็นเงินที่รับแล้ว', () => {
    expect(settlementTotals({ settlements: ['4547.16'], direction: 'R', payments: [], deposits: '4547.16' })).toMatchObject({ due: '4547.16', deposit: '4547.16', cash: '0.00', paid: '4547.16', ok: true });
    expect(settlementTotals({ settlements: ['1000'], direction: 'R', payments: ['400'], deposits: '500' })).toMatchObject({ cash: '100.00', ok: true });
    expect(settlementTotals({ settlements: ['1000'], direction: 'R', payments: ['600'], deposits: '500' }).ok).toBe(false);   // มัดจำ + โอนเกินยอด → เงินสดติดลบ
  });
});

describe('ยอดยกมาที่ลงบัญชี (WTS-Living ลูกหนี้/เงินประกันยกมา)', () => {
  const slotR: PostingResolver = { ...r, slot: (dt, cls, role) => (dt === 'ivl' && role === 'AR' ? 'ar-living' : dt === 'ail' && role === 'DEPOSIT_RECEIVED' ? 'dep-tenant' : null) };
  it('receivable brought forward 1,180.00 (no VAT): Dr AR of the doc type / Cr the opening account — no income, no VAT', () => {
    const p = openingPosting({ doc_class: 'IV', doc_type_id: 'ivl', customer_id: 'c1', net_amount: '1180', vat_amount: '0', vat_basis: '2' }, 'ob', slotR);
    expect(postingBalanced(p)).toBe(true);
    expect(net(p)).toEqual({ 'ar-living': '1180.00', ob: '-1180.00' });
  });
  it('VAT not yet due is not posted again (it is in the opening balances already) — due at the receipt as usual', () => {
    const p = openingPosting({ doc_class: 'IV', doc_type_id: null, customer_id: 'c1', net_amount: '1070', vat_amount: '70', vat_basis: '2' }, 'ob', r);
    expect(net(p)).toEqual({ 'ar-c1': '1070.00', ob: '-1070.00' });
    expect(net(openingPosting({ doc_class: 'IV', doc_type_id: null, customer_id: null, net_amount: '1070', vat_amount: '70', vat_basis: '1' }, 'ob', r))).toEqual({ ar: '1070.00', ob: '-1070.00' });
  });
  it('deposit brought forward 8,400.00: Dr the opening account / Cr the deposit account of the AI type', () => {
    expect(net(openingPosting({ doc_class: 'AI', doc_type_id: 'ail', customer_id: 'c1', net_amount: '8400', vat_amount: '0', vat_basis: null }, 'ob', slotR))).toEqual({ ob: '8400.00', 'dep-tenant': '-8400.00' });
    expect(net(openingPosting({ doc_class: 'AI', doc_type_id: null, customer_id: 'c1', net_amount: '8400', vat_amount: '0', vat_basis: null }, 'ob', r))).toEqual({ ob: '8400.00', depr: '-8400.00' });
  });
});

describe('ใบเสร็จตัดบิลภาษีเกณฑ์เงินสด: มูลค่าที่มี VAT / ยกเว้น (HANDOFF ข้อ 87)', () => {
  const str = (p: ReturnType<typeof settlementVatParts>) => [p.base, p.vat, p.zero, p.exempt, p.other].map((x) => x.toFixed(2));
  it('full payment: ค่าเช่า 3,500 ยกเว้น + น้ำไฟ 978.65 + VAT 68.51 = 4,547.16 → ฐาน 978.65 ยกเว้น 3,500', () => {
    expect(str(settlementVatParts({ amount: '4547.16', vat: '68.51', inv_net: '4547.16', inv_exempt: '3500', inv_zero: '0' }))).toEqual(['978.65', '68.51', '0.00', '3500.00', '0.00']);
  });
  it('partial payment shares the exempt part pro rata; the rest is the VAT base', () => {
    // ชำระ 2,000 ของ 4,547.16 · VAT ถึงกำหนด 30.13 · ยกเว้น 3,500 × 2,000 / 4,547.16 = 1,539.42 · ฐาน 2,000 − 30.13 − 1,539.42 = 430.45
    expect(str(settlementVatParts({ amount: '2000', vat: '30.13', inv_net: '4547.16', inv_exempt: '3500' }))).toEqual(['430.45', '30.13', '0.00', '1539.42', '0.00']);
  });
  it('a bill with no VAT due (late fee) is all "other"', () => {
    expect(str(settlementVatParts({ amount: '107.55', vat: '0', inv_net: '107.55', inv_exempt: '107.55' }))).toEqual(['0.00', '0.00', '0.00', '0.00', '107.55']);
  });
});
