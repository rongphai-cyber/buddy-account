import type { Decimal } from 'decimal.js';
import { d, type MoneyInput } from './money.js';
import { checkTaxId } from './taxid.js';

/**
 * ใบกำกับภาษีอิเล็กทรอนิกส์ (e-Tax Invoice) ตามมาตรฐาน ETDA ขมธอ. 3-2560 รุ่น 2.0 (T7.6)
 * สร้างแฟ้ม XML (UN/CEFACT Cross Industry Invoice) — ยังไม่ลงลายมือชื่ออิเล็กทรอนิกส์ (XAdES ต้องใช้ใบรับรองของกิจการ)
 * โครงสร้าง/ลำดับ element ตาม XSD ของ ETDA (TaxInvoice_ / DebitCreditNote_CrossIndustryInvoice_2p0)
 * ยอดเงินทุกช่องไม่รวม VAT ยกเว้นยอดรวมทั้งสิ้น · ใบเพิ่ม/ลดหนี้: มูลค่าเดิม / มูลค่าที่ถูกต้อง / ผลต่าง
 */
export const ETAX_TYPES = {
  '388': { name: 'ใบกำกับภาษี', message: 'TaxInvoice' },
  T02: { name: 'ใบแจ้งหนี้/ใบกำกับภาษี', message: 'TaxInvoice' },
  T03: { name: 'ใบเสร็จรับเงิน/ใบกำกับภาษี', message: 'TaxInvoice' },
  T04: { name: 'ใบส่งของ/ใบกำกับภาษี', message: 'TaxInvoice' },
  '80': { name: 'ใบเพิ่มหนี้', message: 'DebitCreditNote' },
  '81': { name: 'ใบลดหนี้', message: 'DebitCreditNote' },
} as const;
export type EtaxTypeCode = keyof typeof ETAX_TYPES;
/** ใบกำกับภาษีขายใช้รหัสใดได้บ้าง (ใบขายเชื่อเลือกได้ · ขายสด = ใบเสร็จรับเงิน/ใบกำกับภาษี) */
export const ETAX_INVOICE_TYPES: EtaxTypeCode[] = ['T02', 'T04', '388', 'T03'];

/** รหัสเหตุผลการออกใบเพิ่ม/ลดหนี้ (RD 1225 — ภาคผนวก ข.3) */
export const ETAX_PURPOSES: Record<string, string> = {
  CDNG01: 'ลดราคาสินค้าที่ขาย (สินค้าผิดข้อกำหนดที่ตกลงกัน)', CDNG02: 'สินค้าชำรุดเสียหาย', CDNG03: 'สินค้าขาดจำนวนตามที่ตกลงซื้อขาย',
  CDNG04: 'คำนวณราคาสินค้าผิดพลาดสูงกว่าที่เป็นจริง', CDNG05: 'รับคืนสินค้า (ไม่ตรงตามคำพรรณนา)', CDNG99: 'เหตุอื่น (ระบุสาเหตุ)',
  CDNS01: 'ลดราคาค่าบริการ (บริการผิดข้อกำหนดที่ตกลงกัน)', CDNS02: 'ค่าบริการขาดจำนวน', CDNS03: 'คำนวณราคาค่าบริการผิดพลาดสูงกว่าที่เป็นจริง',
  CDNS04: 'บอกเลิกสัญญาบริการ', CDNS99: 'เหตุอื่น (ระบุสาเหตุ)',
  DBNG01: 'มีการเพิ่มราคาค่าสินค้า (สินค้าเกินกว่าจำนวนที่ตกลงกัน)', DBNG02: 'คำนวณราคาสินค้าผิดพลาดต่ำกว่าที่เป็นจริง', DBNG99: 'เหตุอื่น (ระบุสาเหตุ)',
  DBNS01: 'การเพิ่มราคาค่าบริการ (บริการเกินกว่าข้อกำหนดที่ตกลงกัน)', DBNS02: 'คำนวณราคาค่าบริการผิดพลาดต่ำกว่าที่เป็นจริง', DBNS99: 'เหตุอื่น (ระบุสาเหตุ)',
};

export interface EtaxParty {
  name: string;
  /** เลขประจำตัวผู้เสียภาษี 13 หลัก / เลขบัตรประชาชน / หนังสือเดินทาง (ว่าง = ไม่ประสงค์ระบุ) */
  taxId?: string | null;
  /** สาขา 5 หลัก (สำนักงานใหญ่ 00000) */
  branchNo?: string | null;
  address?: string | null;
  postcode?: string | null;
  countryId?: string;
  code?: string | null;
  email?: string | null;
  phone?: string | null;
}
export interface EtaxLine {
  code?: string | null;
  name: string;
  qty: MoneyInput;
  unitCode?: string | null;
  /** ราคาต่อหน่วยไม่รวม VAT */
  unitPrice: MoneyInput;
  /** ยอดบรรทัดไม่รวม VAT หลังส่วนลด */
  net: MoneyInput;
}
export interface EtaxDoc {
  typeCode: EtaxTypeCode;
  id: string;
  issueDate: string;           // YYYY-MM-DD
  createdAt?: string;          // ISO
  seller: EtaxParty;
  buyer: EtaxParty;
  lines: EtaxLine[];
  /** ส่วนที่มี VAT (ฐานไม่รวม VAT) */
  vat?: { rate: MoneyInput; basis: MoneyInput; amount: MoneyInput } | null;
  /** ฐานสินค้า/บริการยกเว้นภาษี */
  exemptBasis?: MoneyInput;
  /** หักเงินมัดจำ (ไม่รวม VAT) */
  deposit?: MoneyInput;
  grandTotal: MoneyInput;
  dueDate?: string | null;
  buyerOrderRef?: string | null;
  notes?: string[];
  purposeCode?: string | null;
  purpose?: string | null;
  /** ใบกำกับภาษีเดิม (ใบเพิ่ม/ลดหนี้) */
  ref?: { id: string; date: string; typeCode: string } | null;
  /** ใบเพิ่ม/ลดหนี้: มูลค่าตามใบกำกับเดิม และมูลค่าที่ถูกต้อง (ไม่รวม VAT) */
  originalAmount?: MoneyInput;
  correctAmount?: MoneyInput;
}

const r2 = (v: Decimal) => v.toDecimalPlaces(2);
const amt = (v: MoneyInput) => r2(d(v ?? 0)).toFixed(2);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const cut = (s: string | null | undefined, n: number) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** รหัสไปรษณีย์ 5 หลักท้ายที่อยู่ (ที่อยู่ในเอกสารเก็บเป็นข้อความเดียว) */
export function etaxPostcode(address: string | null | undefined): string | null {
  const m = /(?:^|\D)(\d{5})\s*$/.exec((address ?? '').trim());
  return m ? m[1]! : null;
}

/** เลขผู้เสียภาษีตามภาคผนวก ข.16: นิติบุคคล/ผู้ประกอบการ = 13 หลัก + สาขา 5 หลัก (TXID) · บุคคลธรรมดา NIDN · อื่น ๆ CCPT · ไม่ระบุ OTHR N/A */
export function etaxTaxRegistration(taxId: string | null | undefined, branchNo: string | null | undefined): { scheme: 'TXID' | 'NIDN' | 'CCPT' | 'OTHR'; id: string } {
  const v = (taxId ?? '').replace(/[\s-]/g, '');
  if (!v) return { scheme: 'OTHR', id: 'N/A' };
  if (/^\d{13}$/.test(v)) {
    if (branchNo || v.startsWith('0')) return { scheme: 'TXID', id: v + (branchNo || '00000').padStart(5, '0') };
    return { scheme: 'NIDN', id: v };
  }
  return { scheme: 'CCPT', id: v.slice(0, 35) };
}

/** ยอดรวมของเอกสาร (ตรวจกับยอดในเอกสาร) */
export function etaxTotals(doc: EtaxDoc) {
  const lineTotal = doc.lines.reduce((s, l) => s.plus(d(l.net)), d(0));
  const deposit = d(doc.deposit ?? 0);
  const vatBasis = d(doc.vat?.basis ?? 0), exempt = d(doc.exemptBasis ?? 0);
  const taxBasis = vatBasis.plus(exempt);
  const tax = d(doc.vat?.amount ?? 0);
  return { lineTotal, deposit, taxBasis, tax, grand: d(doc.grandTotal) };
}

/** ตรวจก่อนสร้างแฟ้ม — ข้อความบอกวิธีแก้ */
export function validateEtax(doc: EtaxDoc): string[] {
  const e: string[] = [];
  const isNote = ETAX_TYPES[doc.typeCode].message === 'DebitCreditNote';
  if (!doc.id.trim() || doc.id.length > 35) e.push('เลขที่เอกสารต้องมี 1–35 ตัวอักษร');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(doc.issueDate)) e.push('วันที่เอกสารไม่ถูกต้อง');
  const sTax = checkTaxId(doc.seller.taxId);
  if (!sTax.ok) e.push(`เลขประจำตัวผู้เสียภาษีของกิจการ: ${sTax.error} — แก้ที่ เริ่มระบบ › รายละเอียดกิจการ`);
  if (!cut(doc.seller.name, 256)) e.push('ไม่มีชื่อกิจการ — แก้ที่ เริ่มระบบ › รายละเอียดกิจการ');
  if (!cut(doc.seller.address, 256) || !doc.seller.postcode) e.push('ที่อยู่กิจการต้องมีรหัสไปรษณีย์ 5 หลักท้ายที่อยู่ — แก้ที่ เริ่มระบบ › รายละเอียดกิจการ');
  if (!cut(doc.buyer.name, 256)) e.push('ไม่มีชื่อผู้ซื้อ — ใบกำกับภาษีเต็มรูปต้องระบุชื่อผู้ซื้อ');
  if (!cut(doc.buyer.address, 256) || !doc.buyer.postcode) e.push('ที่อยู่ผู้ซื้อต้องมีรหัสไปรษณีย์ 5 หลักท้ายที่อยู่ — แก้ที่รายละเอียดลูกค้า แล้วเปิดเอกสารบันทึกใหม่ (หรือแก้ที่อยู่ในเอกสาร)');
  if (doc.buyer.taxId) {
    const v = doc.buyer.taxId.replace(/[\s-]/g, '');
    if (/^\d+$/.test(v)) { const c = checkTaxId(v); if (!c.ok) e.push(`เลขประจำตัวผู้เสียภาษีผู้ซื้อ: ${c.error}`); }
  }
  if (doc.buyer.branchNo && !/^\d{5}$/.test(doc.buyer.branchNo)) e.push('สาขาของผู้ซื้อต้องเป็นตัวเลข 5 หลัก (สำนักงานใหญ่ 00000)');
  if (!doc.lines.length) e.push('ไม่มีรายการสินค้า/บริการ');
  doc.lines.forEach((l, i) => { if (!cut(l.name, 256)) e.push(`บรรทัดที่ ${i + 1}: ไม่มีชื่อสินค้า/บริการ`); });
  const t = etaxTotals(doc);
  if (isNote) {
    if (!doc.ref?.id || !doc.ref.date) e.push('ใบเพิ่ม/ลดหนี้ต้องอ้างเลขที่และวันที่ใบกำกับภาษีเดิม — แก้ที่เอกสาร (ช่อง "อ้างถึงใบกำกับ")');
    if (!doc.purposeCode || !ETAX_PURPOSES[doc.purposeCode]) e.push('ไม่ได้ระบุเหตุผลการออกใบเพิ่ม/ลดหนี้');
    else if (doc.purposeCode.endsWith('99') && !cut(doc.purpose, 256)) e.push('เหตุอื่นต้องระบุสาเหตุ — ใส่ในหมายเหตุของเอกสาร');
    if (doc.originalAmount === undefined || doc.correctAmount === undefined) e.push('ไม่พบมูลค่าตามใบกำกับภาษีเดิม — ตรวจเลขที่ใบกำกับเดิมว่ามีในโปรแกรม');
  } else {
    // ยอดบรรทัด − มัดจำ = ฐานภาษี (ปัดเศษได้ไม่เกิน 0.01 ต่อบรรทัด)
    if (t.lineTotal.minus(t.deposit).minus(t.taxBasis).abs().gt(0.01 * Math.max(1, doc.lines.length))) e.push(`ยอดรายการ ${amt(t.lineTotal)} หักมัดจำ ${amt(t.deposit)} ไม่เท่ากับฐานภาษี ${amt(t.taxBasis)}`);
  }
  if (t.taxBasis.plus(t.tax).minus(t.grand).abs().gt(0.005)) e.push(`ฐานภาษี ${amt(t.taxBasis)} + VAT ${amt(t.tax)} ไม่เท่ากับยอดรวม ${amt(t.grand)}`);
  return e;
}

/** สร้างแฟ้ม XML (UTF-8) — เรียก validateEtax ก่อน */
export function buildEtaxXml(doc: EtaxDoc): string {
  const T = ETAX_TYPES[doc.typeCode];
  const isNote = T.message === 'DebitCreditNote';
  const t = etaxTotals(doc);
  const X: string[] = [];
  let depth = 0;
  const open = (tag: string, attrs = '') => { X.push(`${'  '.repeat(depth)}<${tag}${attrs}>`); depth++; };
  const close = (tag: string) => { depth--; X.push(`${'  '.repeat(depth)}</${tag}>`); };
  const leaf = (tag: string, v: string | null | undefined, attrs = '') => { if (v !== null && v !== undefined && v !== '') X.push(`${'  '.repeat(depth)}<${tag}${attrs}>${esc(v)}</${tag}>`); };
  const money = (tag: string, v: MoneyInput) => leaf(tag, amt(v), ' currencyID="THB"');
  const dt = (date: string) => `${date}T00:00:00`;
  const party = (tag: string, p: EtaxParty) => {
    open(tag);
    leaf('ram:ID', cut(p.code, 35) || null);
    leaf('ram:Name', cut(p.name, 256));
    const reg = etaxTaxRegistration(p.taxId, p.branchNo);
    open('ram:SpecifiedTaxRegistration'); leaf('ram:ID', reg.id, ` schemeID="${reg.scheme}"`); close('ram:SpecifiedTaxRegistration');
    if (p.email || p.phone) {
      open('ram:DefinedTradeContact');
      if (p.email) { open('ram:EmailURIUniversalCommunication'); leaf('ram:URIID', cut(p.email, 256)); close('ram:EmailURIUniversalCommunication'); }
      if (p.phone) { open('ram:TelephoneUniversalCommunication'); leaf('ram:CompleteNumber', cut(p.phone, 35)); close('ram:TelephoneUniversalCommunication'); }
      close('ram:DefinedTradeContact');
    }
    // ที่อยู่แบบไม่มีโครงสร้าง (บรรทัด 1–2) + รหัสไปรษณีย์ + ประเทศ (ข้อ 8.7)
    const addr = cut(p.address, 512);
    open('ram:PostalTradeAddress');
    leaf('ram:PostcodeCode', p.postcode ?? null);
    leaf('ram:LineOne', addr.slice(0, 256));
    leaf('ram:LineTwo', addr.slice(256, 512) || null);
    leaf('ram:CountryID', p.countryId ?? 'TH', ' schemeID="3166-1 alpha-2"');
    close('ram:PostalTradeAddress');
    close(tag);
  };

  X.push('<?xml version="1.0" encoding="UTF-8"?>');
  open(`rsm:${T.message}_CrossIndustryInvoice`, ` xmlns:ram="urn:etda:uncefact:data:standard:${T.message}_ReusableAggregateBusinessInformationEntity:2" xmlns:rsm="urn:etda:uncefact:data:standard:${T.message}_CrossIndustryInvoice:2"`);
  open('rsm:ExchangedDocumentContext');
  open('ram:GuidelineSpecifiedDocumentContextParameter'); leaf('ram:ID', 'ER3-2560', ' schemeAgencyID="ETDA" schemeVersionID="v2.0"'); close('ram:GuidelineSpecifiedDocumentContextParameter');
  close('rsm:ExchangedDocumentContext');

  open('rsm:ExchangedDocument');
  leaf('ram:ID', doc.id);
  leaf('ram:Name', T.name);
  leaf('ram:TypeCode', doc.typeCode);
  leaf('ram:IssueDateTime', dt(doc.issueDate));
  if (doc.purposeCode) { leaf('ram:Purpose', cut(doc.purpose, 256) || ETAX_PURPOSES[doc.purposeCode] || null); leaf('ram:PurposeCode', doc.purposeCode); }
  leaf('ram:CreationDateTime', (doc.createdAt ?? dt(doc.issueDate)).replace(/Z$/, '').slice(0, 23));
  for (const n of (doc.notes ?? []).filter(Boolean).slice(0, 20)) { open('ram:IncludedNote'); leaf('ram:Subject', cut(n, 500)); close('ram:IncludedNote'); }
  close('rsm:ExchangedDocument');

  open('rsm:SupplyChainTradeTransaction');
  open('ram:ApplicableHeaderTradeAgreement');
  party('ram:SellerTradeParty', doc.seller);
  party('ram:BuyerTradeParty', doc.buyer);
  if (doc.buyerOrderRef) { open('ram:BuyerOrderReferencedDocument'); leaf('ram:IssuerAssignedID', cut(doc.buyerOrderRef, 35)); leaf('ram:ReferenceTypeCode', 'ON'); close('ram:BuyerOrderReferencedDocument'); }
  if (doc.ref) {
    open('ram:AdditionalReferencedDocument');
    leaf('ram:IssuerAssignedID', cut(doc.ref.id, 35)); leaf('ram:IssueDateTime', dt(doc.ref.date)); leaf('ram:ReferenceTypeCode', doc.ref.typeCode);
    close('ram:AdditionalReferencedDocument');
  }
  close('ram:ApplicableHeaderTradeAgreement');
  X.push(`${'  '.repeat(depth)}<ram:ApplicableHeaderTradeDelivery/>`);

  open('ram:ApplicableHeaderTradeSettlement');
  leaf('ram:InvoiceCurrencyCode', 'THB', ' listID="ISO 4217 3A"');
  const tax = (type: string, rate: MoneyInput, basis: MoneyInput, amount: MoneyInput) => {
    open('ram:ApplicableTradeTax'); leaf('ram:TypeCode', type); leaf('ram:CalculatedRate', d(rate ?? 0).toString()); money('ram:BasisAmount', basis); money('ram:CalculatedAmount', amount); close('ram:ApplicableTradeTax');
  };
  if (doc.vat && (!d(doc.vat.basis).isZero() || d(doc.exemptBasis ?? 0).isZero())) tax('VAT', doc.vat.rate, doc.vat.basis, doc.vat.amount);
  if (!d(doc.exemptBasis ?? 0).isZero() || !doc.vat) tax('FRE', 0, doc.exemptBasis ?? 0, 0);
  if (!t.deposit.isZero()) {
    open('ram:SpecifiedTradeAllowanceCharge'); leaf('ram:ChargeIndicator', 'false'); money('ram:ActualAmount', t.deposit); leaf('ram:Reason', 'หักเงินมัดจำ'); close('ram:SpecifiedTradeAllowanceCharge');
  }
  if (doc.dueDate) { open('ram:SpecifiedTradePaymentTerms'); leaf('ram:DueDateDateTime', dt(doc.dueDate)); close('ram:SpecifiedTradePaymentTerms'); }
  open('ram:SpecifiedTradeSettlementHeaderMonetarySummation');
  if (isNote) {
    money('ram:OriginalInformationAmount', doc.originalAmount ?? 0);
    money('ram:LineTotalAmount', doc.correctAmount ?? 0);
    money('ram:DifferenceInformationAmount', t.taxBasis);
  } else {
    money('ram:LineTotalAmount', t.lineTotal);
    if (!t.deposit.isZero()) money('ram:AllowanceTotalAmount', t.deposit);
  }
  money('ram:TaxBasisTotalAmount', t.taxBasis);
  money('ram:TaxTotalAmount', t.tax);
  money('ram:GrandTotalAmount', t.grand);
  close('ram:SpecifiedTradeSettlementHeaderMonetarySummation');
  close('ram:ApplicableHeaderTradeSettlement');

  doc.lines.forEach((l, i) => {
    open('ram:IncludedSupplyChainTradeLineItem');
    open('ram:AssociatedDocumentLineDocument'); leaf('ram:LineID', String(i + 1)); close('ram:AssociatedDocumentLineDocument');
    open('ram:SpecifiedTradeProduct'); leaf('ram:ID', cut(l.code, 35) || null); leaf('ram:Name', cut(l.name, 256)); close('ram:SpecifiedTradeProduct');
    const price = d(l.unitPrice ?? 0), qty = d(l.qty ?? 0), net = d(l.net);
    open('ram:SpecifiedLineTradeAgreement');
    open('ram:GrossPriceProductTradePrice'); leaf('ram:ChargeAmount', price.toDecimalPlaces(4).toFixed(Math.max(2, price.decimalPlaces() > 2 ? 4 : 2)), ' currencyID="THB"'); close('ram:GrossPriceProductTradePrice');
    close('ram:SpecifiedLineTradeAgreement');
    open('ram:SpecifiedLineTradeDelivery'); leaf('ram:BilledQuantity', (qty.isZero() ? d(1) : qty).toString(), ` unitCode="${esc(cut(l.unitCode, 16) || 'EA')}"`); close('ram:SpecifiedLineTradeDelivery');
    open('ram:SpecifiedLineTradeSettlement');
    const disc = r2(qty.times(price)).minus(net);
    if (disc.gt(0.005)) { open('ram:SpecifiedTradeAllowanceCharge'); leaf('ram:ChargeIndicator', 'false'); money('ram:ActualAmount', disc); leaf('ram:TypeCode', '95'); close('ram:SpecifiedTradeAllowanceCharge'); }
    open('ram:SpecifiedTradeSettlementLineMonetarySummation'); money('ram:NetLineTotalAmount', net); close('ram:SpecifiedTradeSettlementLineMonetarySummation');
    close('ram:SpecifiedLineTradeSettlement');
    close('ram:IncludedSupplyChainTradeLineItem');
  });
  close('rsm:SupplyChainTradeTransaction');
  close(`rsm:${T.message}_CrossIndustryInvoice`);
  return X.join('\n') + '\n';
}

/** ชื่อแฟ้มตามเลขที่เอกสาร (ตัวอักษรที่ใช้ในชื่อแฟ้มไม่ได้ → _) */
export const etaxFileName = (doc: Pick<EtaxDoc, 'id' | 'typeCode'>) => `${doc.typeCode}_${doc.id.replace(/[^A-Za-z0-9ก-๙._-]/g, '_')}.xml`;
