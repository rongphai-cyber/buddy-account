import { describe, it, expect } from 'vitest';
import { buildEtaxXml, checkCreditPurpose, depositRefundPurpose, ETAX_CREDIT_PURPOSES, ETAX_NOT_TAX_INVOICE, etaxDepositRefundParts, etaxPurposeText, etaxFileName, etaxPostcode, etaxReceiptParts, etaxTaxRegistration, validateEtax, type EtaxDoc, type EtaxReceiptBill } from './etax.js';
import { depositRefundVat, receiptVatSummary } from './posting.js';
import { d } from './money.js';

const seller = { name: 'บริษัท ทดสอบ จำกัด', taxId: '0105537095903', branchNo: '00000', address: '99 ถนนพระราม 4 แขวงสีลม เขตบางรัก กรุงเทพมหานคร 10500', postcode: '10500' };
const buyer = { name: 'บริษัท ลูกค้า & คู่ค้า จำกัด', code: 'C001', taxId: '0105537095903', branchNo: '00001', address: '1 ถนนสุขุมวิท กรุงเทพฯ 10110', postcode: '10110' };
// ใบกำกับภาษี VAT 7% แยกนอก: 2 รายการ ส่วนลดบรรทัด 100 · หักมัดจำ 500 → ฐาน 1,400 VAT 98 รวม 1,498
const iv: EtaxDoc = {
  typeCode: 'T02', id: 'IV6900001', issueDate: '2026-03-01', createdAt: '2026-03-01T10:20:30.000Z', seller, buyer,
  lines: [{ code: 'A1', name: 'สินค้า <A>', qty: '2', unitCode: 'EA', unitPrice: '500', net: '900' }, { code: 'S1', name: 'ค่าบริการ', qty: '1', unitPrice: '1000', net: '1000' }],
  vat: { rate: 7, basis: '1400', amount: '98' }, deposit: '500', grandTotal: '1498', dueDate: '2026-03-31', buyerOrderRef: 'PO-1', notes: ['ส่งของก่อน 10 โมง'],
};

describe('e-Tax Invoice ETDA ขมธอ. 3-2560 (T7.6)', () => {
  it('tax registration scheme: juristic + branch = TXID 18 digits, person = NIDN, foreign = CCPT, none = OTHR N/A', () => {
    expect(etaxTaxRegistration('0105537095903', null)).toEqual({ scheme: 'TXID', id: '010553709590300000' });
    expect(etaxTaxRegistration('0105537095903', '12')).toEqual({ scheme: 'TXID', id: '010553709590300012' });
    expect(etaxTaxRegistration('1104599001271', null)).toEqual({ scheme: 'NIDN', id: '1104599001271' });
    expect(etaxTaxRegistration('AA1234567', null)).toEqual({ scheme: 'CCPT', id: 'AA1234567' });
    expect(etaxTaxRegistration('', null)).toEqual({ scheme: 'OTHR', id: 'N/A' });
    expect([etaxPostcode('… กรุงเทพฯ 10110'), etaxPostcode('ไม่มีรหัส'), etaxPostcode('เลขที่ 123456')]).toEqual(['10110', null, null]);
  });

  it('builds TaxInvoice XML in XSD element order with escaped text and totals excl. VAT', () => {
    expect(validateEtax(iv)).toEqual([]);
    const x = buildEtaxXml(iv);
    expect(x.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<rsm:TaxInvoice_CrossIndustryInvoice xmlns:ram="urn:etda:uncefact:data:standard:TaxInvoice_ReusableAggregateBusinessInformationEntity:2"')).toBe(true);
    const order = ['ExchangedDocumentContext', '>ER3-2560<', '<ram:ID>IV6900001', '<ram:Name>ใบแจ้งหนี้/ใบกำกับภาษี', '<ram:TypeCode>T02', '<ram:IssueDateTime>2026-03-01T00:00:00', '<ram:CreationDateTime>2026-03-01T10:20:30.000',
      '<ram:Subject>ส่งของก่อน 10 โมง', 'SellerTradeParty', 'schemeID="TXID">010553709590300000', '<ram:PostcodeCode>10500', 'BuyerTradeParty', '<ram:ID>C001', 'บริษัท ลูกค้า &amp; คู่ค้า จำกัด',
      'schemeID="TXID">010553709590300001', 'BuyerOrderReferencedDocument', 'ApplicableHeaderTradeDelivery/>', 'InvoiceCurrencyCode', '<ram:TypeCode>VAT', '<ram:CalculatedRate>7', 'BasisAmount currencyID="THB">1400.00',
      'CalculatedAmount currencyID="THB">98.00', '<ram:Reason>หักเงินมัดจำ', '<ram:DueDateDateTime>2026-03-31', 'LineTotalAmount currencyID="THB">1900.00', 'AllowanceTotalAmount currencyID="THB">500.00',
      'TaxBasisTotalAmount currencyID="THB">1400.00', 'TaxTotalAmount currencyID="THB">98.00', 'GrandTotalAmount currencyID="THB">1498.00',
      '<ram:LineID>1', 'สินค้า &lt;A&gt;', 'ChargeAmount currencyID="THB">500.00', 'unitCode="EA">2<', 'ActualAmount currencyID="THB">100.00', 'NetLineTotalAmount currencyID="THB">900.00', '<ram:LineID>2', 'NetLineTotalAmount currencyID="THB">1000.00'];
    let at = 0;
    for (const s of order) { const i = x.indexOf(s, at); expect(i, s).toBeGreaterThanOrEqual(0); at = i; }
    expect(x).not.toContain('FRE');
    expect(etaxFileName(iv)).toBe('T02_IV6900001.xml');
  });

  it('exempt and mixed bases emit FRE tax; buyer without tax id = OTHR N/A', () => {
    const ex: EtaxDoc = { ...iv, typeCode: 'T03', id: 'HS1', buyer: { ...buyer, taxId: null, branchNo: null }, vat: null, exemptBasis: '1900', deposit: '0', grandTotal: '1900', buyerOrderRef: null };
    expect(validateEtax(ex)).toEqual([]);
    const x = buildEtaxXml(ex);
    expect(x).toContain('<ram:TypeCode>FRE</ram:TypeCode>');
    expect(x).not.toContain('<ram:TypeCode>VAT</ram:TypeCode>');
    expect(x).toContain('schemeID="OTHR">N/A');
    const mix = buildEtaxXml({ ...iv, vat: { rate: 7, basis: '1000', amount: '70' }, exemptBasis: '400', grandTotal: '1470' });
    expect([mix.includes('>VAT<'), mix.includes('>FRE<')]).toEqual([true, true]);
  });

  it('credit note: DebitCreditNote message, purpose, original invoice reference, original/correct/difference', () => {
    const cn: EtaxDoc = { ...iv, typeCode: '81', id: 'CN6900001', deposit: '0', lines: [{ name: 'รับคืนสินค้า', qty: '1', unitPrice: '300', net: '300' }], vat: { rate: 7, basis: '300', amount: '21' }, grandTotal: '321',
      purposeCode: 'CDNG05', purpose: null, ref: { id: 'IV6900001', date: '2026-03-01', typeCode: 'T02' }, originalAmount: '1400', correctAmount: '1100', dueDate: null };
    expect(validateEtax(cn)).toEqual([]);
    const x = buildEtaxXml(cn);
    const order = ['<rsm:DebitCreditNote_CrossIndustryInvoice', 'DebitCreditNote_ReusableAggregateBusinessInformationEntity:2', '<ram:Name>ใบลดหนี้', '<ram:TypeCode>81', '<ram:Purpose>รับคืนสินค้า', '<ram:PurposeCode>CDNG05',
      'AdditionalReferencedDocument', '<ram:IssuerAssignedID>IV6900001', '<ram:ReferenceTypeCode>T02', 'OriginalInformationAmount currencyID="THB">1400.00', 'LineTotalAmount currencyID="THB">1100.00',
      'DifferenceInformationAmount currencyID="THB">300.00', 'TaxBasisTotalAmount currencyID="THB">300.00', 'GrandTotalAmount currencyID="THB">321.00'];
    let at = 0;
    for (const s of order) { const i = x.indexOf(s, at); expect(i, s).toBeGreaterThanOrEqual(0); at = i; }
    expect(validateEtax({ ...cn, ref: null })).toEqual(expect.arrayContaining([expect.stringMatching(/อ้างเลขที่และวันที่ใบกำกับภาษีเดิม/)]));
    expect(validateEtax({ ...cn, purposeCode: 'CDNG99' })).toEqual(expect.arrayContaining([expect.stringMatching(/ระบุสาเหตุ/)]));
  });

  it('validation tells how to fix: seller tax id/address, buyer address, totals', () => {
    const errs = validateEtax({ ...iv, seller: { ...seller, taxId: '123', postcode: null }, buyer: { ...buyer, address: '', postcode: null }, grandTotal: '1500' });
    expect(errs.some((e) => /ผู้เสียภาษีของกิจการ.*รายละเอียดกิจการ/.test(e))).toBe(true);
    expect(errs.some((e) => /ที่อยู่กิจการต้องมีรหัสไปรษณีย์/.test(e))).toBe(true);
    expect(errs.some((e) => /ที่อยู่ผู้ซื้อ/.test(e))).toBe(true);
    expect(errs.some((e) => /ไม่เท่ากับยอดรวม 1500.00/.test(e))).toBe(true);
  });
});

const inOrder = (x: string, parts: string[]) => { let at = 0; for (const s of parts) { const i = x.indexOf(s, at); expect(i, s).toBeGreaterThanOrEqual(0); at = i; } };

describe('e-Tax RE / AI / RD (HANDOFF ข้อ 89)', () => {
  // RE ภาพ B87 (HANDOFF ข้อ 87): บิลภาษีเกณฑ์เงินสด ค่าเช่า 4,500 (ยกเว้น) + ค่าน้ำ 180 + ค่าไฟ 640 (VAT 7% = 57.40) = 5,377.40 · บิลค่าปรับ 107.55 (ไม่มี VAT)
  //  → มูลค่าที่มี VAT 820.00 · VAT 57.40 · ไม่มี VAT 4,500 + 107.55 = 4,607.55 · รวม 5,484.95
  const util: EtaxReceiptBill = { doc_no: 'IV6905001', label: 'ขายเงินเชื่อ', price_type: '2', vat_rate: '7', amount: '5377.40', vat: '57.40', inv_net: '5377.40', inv_exempt: '4500.00', inv_zero: '0',
    lines: [{ code: 'RENT', name: 'ค่าเช่าห้อง', qty: '1', unitPrice: '4500', net: '4500.00', vat_code: '0' }, { code: 'WATER', name: 'ค่าน้ำ', qty: '18', unitCode: 'UNIT', unitPrice: '10', net: '180.00', vat_code: '1' },
      { code: 'ELEC', name: 'ค่าไฟ', qty: '80', unitPrice: '8', net: '640.00', vat_code: '1' }] };
  const late: EtaxReceiptBill = { doc_no: 'IV6905002', label: 'ขายเงินเชื่อ', price_type: '0', vat_rate: '0', amount: '107.55', vat: '0', inv_net: '107.55', inv_exempt: '107.55', inv_zero: '0',
    lines: [{ code: 'LATE', name: 'ค่าปรับชำระล่าช้า', qty: '1', unitPrice: '107.55', net: '107.55', vat_code: '0' }] };
  const reDoc = (p: ReturnType<typeof etaxReceiptParts>): EtaxDoc => ({ typeCode: 'T03', id: 'RE6905001', issueDate: '2026-05-20', seller, buyer, lines: p.lines, vat: p.vat, exemptBasis: p.exemptBasis, deposit: p.deposit, grandTotal: p.grandTotal });

  it('RE (cash-basis VAT): T03 lines = settled invoice lines excl. VAT; totals = RE print / VAT row 820.00 · 57.40 · 4,607.55 · 5,484.95', () => {
    const p = etaxReceiptParts([util, late]);
    expect([p.vat, p.exemptBasis, p.grandTotal, p.errors]).toEqual([{ rate: '7', basis: '820.00', amount: '57.40' }, '4607.55', '5484.95', []]);
    // ใบพิมพ์ RE ใช้ receiptVatSummary ตัวเดียวกัน
    const sum = receiptVatSummary([util, late]);
    expect([sum.base.toFixed(2), sum.vat.toFixed(2), sum.nonVat.toFixed(2), sum.paid.toFixed(2)]).toEqual(['820.00', '57.40', '4607.55', '5484.95']);
    expect(p.lines.map((l) => `${l.name}:${String(l.qty)}:${String(l.unitPrice)}:${String(l.net)}`)).toEqual(['ค่าเช่าห้อง:1:4500:4500.00', 'ค่าน้ำ:18:10:180.00', 'ค่าไฟ:80:8:640.00', 'ค่าปรับชำระล่าช้า:1:107.55:107.55']);
    const doc = reDoc(p);
    expect(validateEtax(doc)).toEqual([]);
    const x = buildEtaxXml(doc);
    inOrder(x, ['<ram:Name>ใบเสร็จรับเงิน/ใบกำกับภาษี', '<ram:TypeCode>T03', '<ram:TypeCode>VAT', 'BasisAmount currencyID="THB">820.00', 'CalculatedAmount currencyID="THB">57.40',
      '<ram:TypeCode>FRE', 'BasisAmount currencyID="THB">4607.55', 'LineTotalAmount currencyID="THB">5427.55', 'TaxBasisTotalAmount currencyID="THB">5427.55', 'TaxTotalAmount currencyID="THB">57.40',
      'GrandTotalAmount currencyID="THB">5484.95', 'ค่าเช่าห้อง', 'NetLineTotalAmount currencyID="THB">4500.00', 'ค่าน้ำ', 'unitCode="UNIT">18<', 'ค่าปรับชำระล่าช้า', 'NetLineTotalAmount currencyID="THB">107.55']);
    expect(x).not.toContain('AllowanceTotalAmount');
  });

  it('RE partial payment: exempt share by invoice proportion, lines = amount paid; price incl. VAT converts unit price of VAT lines only', () => {
    // ชำระครึ่งบิล 2,688.70 (VAT 28.70): ยกเว้น 4,500 × 2,688.70 / 5,377.40 = 2,250.00 · มูลค่าที่มี VAT 2,688.70 − 28.70 − 2,250 = 410.00
    const p = etaxReceiptParts([{ ...util, amount: '2688.70', vat: '28.70' }]);
    expect([p.vat.basis, p.vat.amount, p.exemptBasis, p.grandTotal]).toEqual(['410.00', '28.70', '2250.00', '2688.70']);
    expect(p.lines.map((l) => `${l.name}:${String(l.qty)}:${String(l.net)}`)).toEqual(['ค่าเช่าห้อง (ชำระบางส่วนของ IV6905001):1:2250.00', 'ค่าน้ำ (ชำระบางส่วนของ IV6905001):1:90.00', 'ค่าไฟ (ชำระบางส่วนของ IV6905001):1:320.00']);
    expect(validateEtax(reDoc(p))).toEqual([]);
    // ราคารวม VAT: บรรทัดมี VAT 107 → ราคาต่อหน่วย 100 · บรรทัดยกเว้นคงเดิม
    const incl = etaxReceiptParts([{ doc_no: 'IV2', price_type: '1', vat_rate: '7', amount: '157', vat: '7', inv_net: '157', inv_exempt: '50', lines: [{ name: 'บริการ', qty: '1', unitPrice: '107', net: '100.00', vat_code: '1' }, { name: 'ค่าเช่า', qty: '1', unitPrice: '50', net: '50.00', vat_code: '0' }] }]);
    expect(incl.lines.map((l) => [d(l.unitPrice).toFixed(2), String(l.net)])).toEqual([['100.00', '100.00'], ['50.00', '50.00']]);
    expect([incl.vat.basis, incl.exemptBasis, incl.grandTotal]).toEqual(['100.00', '50.00', '157.00']);
  });

  it('RE without VAT due is not a tax invoice; several VAT rates must be split', () => {
    expect(etaxReceiptParts([late]).errors).toEqual([ETAX_NOT_TAX_INVOICE.RE]);
    expect(etaxReceiptParts([util, { ...util, doc_no: 'IV9', vat_rate: '10', amount: '5402.00', vat: '82.00' }]).errors[0]).toMatch(/อัตราภาษีต่างกัน \(7%, 10%\).*แยกรับชำระ/);
  });

  it('AI deposit with VAT: T03 with the deposit description, 10,000 + 700 = 10,700', () => {
    const ai: EtaxDoc = { typeCode: 'T03', id: 'AI6906001', issueDate: '2026-06-15', seller, buyer, lines: [{ name: 'มัดจำค่าตกแต่งร้าน', qty: '1', unitPrice: '10000', net: '10000.00' }],
      vat: { rate: '7', basis: '10000.00', amount: '700.00' }, exemptBasis: '0.00', deposit: '0.00', grandTotal: '10700.00' };
    expect(validateEtax(ai)).toEqual([]);
    const x = buildEtaxXml(ai);
    inOrder(x, ['<ram:ID>AI6906001', '<ram:TypeCode>T03', 'BasisAmount currencyID="THB">10000.00', 'CalculatedAmount currencyID="THB">700.00', 'GrandTotalAmount currencyID="THB">10700.00', 'มัดจำค่าตกแต่งร้าน', 'NetLineTotalAmount currencyID="THB">10000.00']);
    expect(x).not.toContain('FRE');
    expect(etaxFileName(ai)).toBe('T03_AI6906001.xml');
  });

  const rdDoc = (p: ReturnType<typeof etaxDepositRefundParts>, id: string, remark: string): EtaxDoc => ({ typeCode: '81', id, issueDate: '2026-07-20', seller, buyer, lines: p.lines, refs: p.refs, vat: p.vat,
    exemptBasis: p.exemptBasis, deposit: p.deposit, grandTotal: p.grandTotal, originalAmount: p.originalAmount, correctAmount: p.correctAmount, purposeCode: p.purposeCode, purpose: remark });
  const aiA = { doc_no: 'AI6906001', doc_date: '2026-06-15', dep_net: '10700.00', dep_vat: '700.00', price_type: '2' };

  it('RD refund 4,000 of AI 10,000 + 700 → credit note 81: ref AI (T03), original 10,000 / correct 6,000 / difference 4,000, VAT 280, CDNS04 + RD remark', () => {
    const p = etaxDepositRefundParts({ deposits: [{ ...aiA, amount: '4000.00', vat: '280.00' }], prior: [], vatRate: '7.0000' });
    expect([p.originalAmount, p.correctAmount, p.vat, p.grandTotal, p.purposeCode, p.refs, p.errors]).toEqual(['10000.00', '6000.00', { rate: '7', basis: '4000.00', amount: '280.00' }, '4280.00', 'CDNS04',
      [{ id: 'AI6906001', date: '2026-06-15', typeCode: 'T03' }], []]);
    expect(p.lines.map((l) => `${l.name}:${String(l.net)}`)).toEqual(['คืนเงินมัดจำตามใบกำกับภาษี AI6906001 ลงวันที่ 15/06/2569:4000.00']);
    const doc = rdDoc(p, 'RD6907001', 'ยกเลิกสัญญาตกแต่งร้าน คืนเงินมัดจำ');
    expect(validateEtax(doc)).toEqual([]);
    inOrder(buildEtaxXml(doc), ['<rsm:DebitCreditNote_CrossIndustryInvoice', '<ram:Name>ใบลดหนี้', '<ram:TypeCode>81', '<ram:Purpose>ยกเลิกสัญญาตกแต่งร้าน คืนเงินมัดจำ', '<ram:PurposeCode>CDNS04',
      'AdditionalReferencedDocument', '<ram:IssuerAssignedID>AI6906001', '<ram:IssueDateTime>2026-06-15T00:00:00', '<ram:ReferenceTypeCode>T03', 'BasisAmount currencyID="THB">4000.00', 'CalculatedAmount currencyID="THB">280.00',
      'OriginalInformationAmount currencyID="THB">10000.00', 'LineTotalAmount currencyID="THB">6000.00', 'DifferenceInformationAmount currencyID="THB">4000.00', 'TaxBasisTotalAmount currencyID="THB">4000.00',
      'TaxTotalAmount currencyID="THB">280.00', 'GrandTotalAmount currencyID="THB">4280.00']);
    expect(etaxDepositRefundParts({ deposits: [{ ...aiA, price_type: '0', dep_vat: '0', amount: '500', vat: '0' }], prior: [], vatRate: 0 }).errors).toEqual([ETAX_NOT_TAX_INVOICE.RD]);
  });

  it('(c) exact remainder: AI incl. VAT 1,000 (VAT 65.42) · RD 333 before · RD 667 → VAT 43.63, difference 623.37, correct 0.00', () => {
    const v = depositRefundVat({ amount: '667', price_type: '1', vat_rate: 7, deposit_vat: '65.42', outstanding: '667', other_rd_vat: '21.79' });
    expect([v.vat.toFixed(2), v.exact]).toEqual(['43.63', true]);
    const p = etaxDepositRefundParts({ deposits: [{ doc_no: 'AI6906003', doc_date: '2026-06-15', dep_net: '1000.00', dep_vat: '65.42', price_type: '1', amount: '667.00', vat: v.vat.toFixed(2) }],
      prior: [{ amount: '333.00', vat: '21.79', price_type: '1' }], vatRate: 7 });
    expect([p.originalAmount, p.correctAmount, p.vat.basis, p.vat.amount, p.grandTotal]).toEqual(['934.58', '0.00', '623.37', '43.63', '667.00']);
    expect(validateEtax(rdDoc(p, 'RD6907006', 'ยกเลิกสัญญา'))).toEqual([]);
  });

  it('RD refunding several AIs references every original tax invoice', () => {
    const p = etaxDepositRefundParts({ deposits: [{ ...aiA, amount: '1000', vat: '70' }, { ...aiA, doc_no: 'AI6906002', doc_date: '2026-06-20', amount: '500', vat: '35' }], prior: [], vatRate: 7 });
    expect([p.originalAmount, p.correctAmount, p.vat.basis, p.vat.amount, p.grandTotal]).toEqual(['20000.00', '18500.00', '1500.00', '105.00', '1605.00']);
    const x = buildEtaxXml(rdDoc(p, 'RD6907009', 'ยกเลิกสัญญา'));
    expect(x.match(/<ram:AdditionalReferencedDocument>/g)?.length).toBe(2);
    inOrder(x, ['<ram:IssuerAssignedID>AI6906001', '<ram:ReferenceTypeCode>T03', '<ram:IssuerAssignedID>AI6906002', '<ram:IssueDateTime>2026-06-20T00:00:00', '<ram:ReferenceTypeCode>T03']);
    expect(validateEtax({ ...rdDoc(p, 'RD6907009', 'x'), refs: [{ id: '', date: '', typeCode: 'T03' }] })).toEqual(expect.arrayContaining([expect.stringMatching(/อ้างเลขที่และวันที่ใบกำกับภาษีเดิม/)]));
  });

  it('RD purpose code chosen by the user (HANDOFF 90): ETDA CDN list, stored code in XML, old RD (empty) → CDNS04, 99 needs reason, invalid refused', () => {
    expect(ETAX_CREDIT_PURPOSES.map((x) => x.code)).toEqual(['CDNG01', 'CDNG02', 'CDNG03', 'CDNG04', 'CDNG05', 'CDNG99', 'CDNS01', 'CDNS02', 'CDNS03', 'CDNS04', 'CDNS99']);
    expect(ETAX_CREDIT_PURPOSES.find((x) => x.code === 'CDNG99')).toEqual({ code: 'CDNG99', name: 'เหตุอื่น (ระบุสาเหตุ)', group: 'สินค้า' });
    expect(etaxPurposeText('CDNS04')).toBe('CDNS04 บอกเลิกสัญญาบริการ');
    expect([depositRefundPurpose(null), depositRefundPurpose(''), depositRefundPurpose('CDNG02'), depositRefundPurpose('DBNG01'), depositRefundPurpose('XX')]).toEqual(['CDNS04', 'CDNS04', 'CDNG02', 'CDNS04', 'CDNS04']);
    const p = etaxDepositRefundParts({ deposits: [{ ...aiA, amount: '4000.00', vat: '280.00' }], prior: [], vatRate: 7, purposeCode: 'CDNG99' });
    expect(p.purposeCode).toBe('CDNG99');
    inOrder(buildEtaxXml(rdDoc(p, 'RD6907010', 'ยกเลิกสั่งซื้อสินค้า คืนมัดจำ')), ['<ram:Purpose>ยกเลิกสั่งซื้อสินค้า คืนมัดจำ', '<ram:PurposeCode>CDNG99']);
    expect(validateEtax(rdDoc(p, 'RD6907010', ''))).toEqual(expect.arrayContaining([expect.stringMatching(/เหตุอื่นต้องระบุสาเหตุ/)]));
    expect(checkCreditPurpose(null, null)).toBeNull();
    expect(checkCreditPurpose('CDNS04', '')).toBeNull();
    expect(checkCreditPurpose('CDNG99', 'ยกเลิกสั่งซื้อ')).toBeNull();
    expect(checkCreditPurpose('CDNS99', ' ')).toMatch(/ต้องระบุสาเหตุ/);
    expect(checkCreditPurpose('DBNG01', 'x')).toMatch(/ไม่อยู่ในรายการมาตรฐาน ETDA/);
    expect(checkCreditPurpose('CDNX01', 'x')).toMatch(/ไม่อยู่ในรายการมาตรฐาน ETDA/);
  });
});
