import { describe, it, expect } from 'vitest';
import { buildEtaxXml, etaxFileName, etaxPostcode, etaxTaxRegistration, validateEtax, type EtaxDoc } from './etax.js';

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
