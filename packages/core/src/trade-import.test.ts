import { describe, expect, it } from 'vitest';
import { importBranch, importColumnsFor, importDate, importDocNoError, importPrice, importReadColumns, importFlag, importHeaderText, importItemKind, importKindOf, importNeedLabel, importNumber, importPartyKey, importVatBasis, importVatCode, importWhtForm, mapExpenseImport, mapImport, mapPaymentImport, parseCsv, xlsxSharedStrings, xlsxSheetRows } from './trade-import.js';
import { TRADE_KINDS } from './doc-calc.js';

describe('นำเข้ารายการขาย/ซื้อจากแฟ้ม Excel', () => {
  it('reads dates: Excel serial, ISO, 4-digit year decides BE/CE, short year follows company', () => {
    expect(importDate('45945', 'B')).toBe('2025-10-15');
    expect(importDate('45945.75', 'B')).toBe('2025-10-15');
    expect(importDate('244637', 'C')).toBe('2026-10-15');                // Excel ไทย: 15/10/2569 กลายเป็นปี ค.ศ. 2569
    expect(importDate('2026-10-15', 'B')).toBe('2026-10-15');
    expect(importDate('15/10/2569', 'C')).toBe('2026-10-15');
    expect(importDate('15/10/2026', 'B')).toBe('2026-10-15');
    expect(importDate('15/10/69', 'B')).toBe('2026-10-15');
    expect(importDate('31/02/2569', 'B')).toBeNull();
    expect(importDate('abc', 'B')).toBeNull();
    expect(importDate('123', 'B')).toBeNull();
  });

  it('reads numbers: thousands, baht sign, brackets negative, float noise', () => {
    expect(importNumber('1,234.50')).toBe('1234.50');
    expect(importNumber(' ฿ 99 ')).toBe('99');
    expect(importNumber('(100)')).toBe('-100');
    expect(importNumber('.5')).toBe('0.5');
    expect(importNumber('0.30000000000000004')).toBe('0.3');
    expect(importNumber('1e3')).toBe('1000');
    expect(importNumber('12a')).toBeNull();
    expect(importNumber('')).toBeNull();
  });

  it('parses CSV with quotes, embedded comma/newline, BOM, semicolon', () => {
    expect(parseCsv('﻿a,b,c\r\n1,"x, y","he said ""hi"""\n2,"line\nbreak",')).toEqual([['a', 'b', 'c'], ['1', 'x, y', 'he said "hi"'], ['2', 'line\nbreak', '']]);
    expect(parseCsv('a;b;c\n1;2;3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });

  it('parses xlsx sheet XML: shared/inline/rich strings, gaps, entities, row numbers', () => {
    const shared = xlsxSharedStrings('<sst><si><t>เลขที่อ้างอิง</t></si><si><r><t>วัน</t></r><r><rPr/><t xml:space="preserve">ที่</t></r></si><si><t>A&amp;B</t></si><si/></sst>');
    expect(shared).toEqual(['เลขที่อ้างอิง', 'วันที่', 'A&B', '']);
    const rows = xlsxSheetRows(`<worksheet><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>
      <row r="3"><c r="A3" t="inlineStr"><is><t>X&lt;1</t></is></c><c r="B3"><v>45945</v></c><c r="D3" t="str"><v>f</v></c><c r="E3" t="b"><v>1</v></c><c r="F3" s="2"/></row>
    </sheetData></worksheet>`, shared);
    expect(rows).toEqual([['เลขที่อ้างอิง', '', 'วันที่'], [], ['X<1', '45945', '', 'f', 'TRUE', '']]);
  });

  it('maps rows to documents: header names/aliases in any order, grouping, consistency + row errors', () => {
    const rows = [
      ['รายการขายจากหน้าร้าน'],
      ['รหัสสินค้า', 'Qty', 'เลขที่', 'วันที่', 'รหัสลูกค้า', 'ราคา', 'ส่วนลด', 'หมายเหตุ'],
      ['A-1', '2', 'INV1', '15/10/2569', 'C001', '1,500', '10%', 'หน้าร้าน'],
      ['A-2', '1', 'INV1', '15/10/2569', 'c001', '50', '', ''],
      [],
      ['A-1', '3', 'INV2', '45945', 'C002', '100', '', ''],
      ['A-1', 'x', 'INV3', '16/10/2569', 'C001', '10', '', ''],
      ['A-1', '1', 'INV1', '16/10/2569', 'C001', '10', '', ''],
      ['', '1', 'INV4', '', 'C001', '10', '', ''],
    ];
    const r = mapImport(rows, 'B');
    expect(r.docs.map((x) => [x.ref, x.row, x.date, x.party, x.lines.length, x.remark])).toEqual([['INV1', 3, '2026-10-15', 'C001', 2, 'หน้าร้าน'], ['INV2', 6, '2025-10-15', 'C002', 1, null]]);
    expect(r.docs[0]!.lines[0]).toEqual({ row: 3, item: 'A-1', item_name: null, item_kind: null, description: null, qty: '2', unit: null, price: '1500', discount: '10%', warehouse: null, free: null, job: null, vat_code: null, ret: null, vat_amount: null, net_total: null });
    expect(r.errors).toEqual([
      { row: 7, message: 'จำนวน "x" ไม่ใช่ตัวเลข' },
      { row: 8, message: 'เลขที่อ้างอิง INV1: วันที่ไม่ตรงกับแถว 3' },
      { row: 9, message: 'วันที่ "" ไม่ถูกต้อง — ใช้ วว/ดด/ปปปป' },
      { row: 9, message: 'ไม่มีรหัสสินค้า (สินค้าใหม่: ใส่ชื่อสินค้า)' },
    ]);
  });

  it('reports a missing header or required column clearly', () => {
    expect(mapImport([['a', 'b'], ['1', '2']], 'B').errors[0]!.message).toMatch(/ไม่พบหัวตาราง/);
    expect(mapImport([['เลขที่อ้างอิง', 'วันที่', 'รหัสลูกค้า', 'รหัสสินค้า']], 'B').errors[0]!.message).toBe('ไม่มีคอลัมน์ "จำนวน" — ใช้ชื่อหัวคอลัมน์ตามแบบฟอร์มตัวอย่าง');
    expect(mapImport([['เลขที่อ้างอิง', 'วันที่', 'รหัสลูกค้า', 'รหัสสินค้า', 'จำนวน', 'ราคาต่อหน่วย']], 'B').errors[0]!.message).toBe('ไม่มีรายการใต้หัวตาราง');
  });

  it('HANDOFF 167: new-master columns — code may be blank when a name/tax id is given; old files unchanged', () => {
    const head = ['เลขที่อ้างอิง', 'วันที่', 'รหัสลูกค้า', 'ชื่อลูกค้า', 'เลขผู้เสียภาษี', 'สาขา', 'ที่อยู่', 'โทรศัพท์', 'รหัสสินค้า', 'ชื่อสินค้า', 'ชนิดสินค้า', 'จำนวน', 'หน่วย', 'ราคาต่อหน่วย'];
    const r = mapImport([head,
      ['N1', '15/10/2569', '', 'ร้านใหม่', '0105537095903', 'สำนักงานใหญ่', '1 ถนนสุขุมวิท', '02-111-2222', '', 'กาแฟคั่ว', 'สินค้า', '2', 'ถุง', '150'],
      ['N1', '15/10/2569', '', '', '0-1055-37095-90-3', '0', '', '', 'SV-9', 'ค่าติดตั้ง', 'บริการ', '1', '', '500'],
      ['N2', '16/10/2569', 'C900', 'ลูกค้าใหม่ รหัสเอง', '', '1', '', '', 'A-1', '', '', '1', '', '10'],
      ['N3', '16/10/2569', '', 'ร้านใหม่', '1234567890123', '', '', '', '', '', 'ของ', '1', '', '10'],
      ['N4', '16/10/2569', '', '', '', 'x', '', '', 'A-1', '', '', '1', '', '10'],
      ['N1', '15/10/2569', 'C001', '', '', '', '', '', 'A-1', '', '', '1', '', '10'],
    ], 'B');
    expect(r.docs.map((x) => [x.ref, x.party, x.party_name, x.party_tax_id, x.party_branch, x.party_address, x.party_phone, x.lines.length])).toEqual([
      ['N1', '', 'ร้านใหม่', '0105537095903', '00000', '1 ถนนสุขุมวิท', '02-111-2222', 2],
      ['N2', 'C900', 'ลูกค้าใหม่ รหัสเอง', null, '00001', null, null, 1],
    ]);
    expect(r.docs[0]!.lines.map((l) => [l.item, l.item_name, l.item_kind, l.unit, l.description])).toEqual([['', 'กาแฟคั่ว', '0', 'ถุง', 'กาแฟคั่ว'], ['SV-9', 'ค่าติดตั้ง', '3', null, 'ค่าติดตั้ง']]);
    expect(r.errors).toEqual([
      { row: 5, message: 'เลขผู้เสียภาษี "1234567890123" เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง (หลักตรวจสอบไม่ตรง)' },
      { row: 5, message: 'ไม่มีรหัสสินค้า (สินค้าใหม่: ใส่ชื่อสินค้า)' },
      { row: 5, message: 'ชนิดสินค้า "ของ" ใช้ "สินค้า" หรือ "บริการ"' },
      { row: 6, message: 'สาขา "x" ต้องเป็นเลขที่สาขา 5 หลัก (สำนักงานใหญ่ = 00000)' },
      { row: 7, message: 'เลขที่อ้างอิง N1: รหัสคู่ค้าไม่ตรงกับแถว 2' },
    ]);
    // an old file whose description header is "ชื่อสินค้า" still fills the description
    const old = mapImport([['เลขที่อ้างอิง', 'วันที่', 'รหัสลูกค้า', 'รหัสสินค้า', 'ชื่อสินค้า', 'จำนวน', 'ราคาต่อหน่วย'], ['X1', '15/10/2569', 'C001', 'A-1', 'ของพิเศษ', '1', '5']], 'B');
    expect(old.errors).toEqual([]);
    expect(old.docs[0]!.lines[0]).toMatchObject({ item: 'A-1', item_name: 'ของพิเศษ', description: 'ของพิเศษ' });
    // header needs a code OR a name column
    expect(mapImport([['เลขที่อ้างอิง', 'วันที่', 'ชื่อผู้จำหน่าย', 'ชื่อสินค้า', 'จำนวน', 'ราคาต่อหน่วย'], ['X', '1/1/2569', 'ร้าน', 'ของ', '1', '1']], 'B').errors).toEqual([]);
    expect(mapImport([['เลขที่อ้างอิง', 'วันที่', 'ชื่อสินค้า', 'จำนวน', 'ราคาต่อหน่วย']], 'B').errors[0]!.message).toBe('ไม่มีคอลัมน์ "รหัสคู่ค้า" — ใช้ชื่อหัวคอลัมน์ตามแบบฟอร์มตัวอย่าง');
  });

  it('HANDOFF 167: cell helpers — branch, item kind, WHT form, party key', () => {
    expect(['', 'สำนักงานใหญ่', '0', '1', 'สาขาที่ 00012', '123456', 'ก'].map(importBranch)).toEqual([null, null, '00000', '00001', '00012', undefined, undefined]);
    expect(['', 'สินค้า', 'บริการ', 'Service', 'x'].map(importItemKind)).toEqual([null, '0', '3', '3', undefined]);
    expect(['', '3', '53', 'ภ.ง.ด.53', 'ภงด 3', 'S03', 'PND53', '1'].map(importWhtForm)).toEqual([null, 'S03', 'S53', 'S53', 'S03', 'S03', 'S53', undefined]);
    expect(importPartyKey({ party: 'c1', party_name: 'x', party_tax_id: '1', party_branch: null })).toBe('C:C1');
    expect(importPartyKey({ party: '', party_name: 'x', party_tax_id: '0105537095903', party_branch: null })).toBe('T:0105537095903/00000');
    expect(importPartyKey({ party: '', party_name: ' ร้าน A ', party_tax_id: null, party_branch: null })).toBe('N:ร้าน a');
  });

  it('HANDOFF 167: other expenses (OE) — expense code + amount per row, WHT per document', () => {
    const head = ['เลขที่อ้างอิง', 'วันที่', 'รหัสผู้จำหน่าย', 'ชื่อผู้จำหน่าย', 'รหัสค่าใช้จ่าย', 'รายละเอียด', 'จำนวนเงิน', 'อัตราหัก ณ ที่จ่าย', 'ภาษีหัก ณ ที่จ่าย', 'ประเภทเงินได้', 'แบบ ภ.ง.ด.'];
    const r = mapExpenseImport([head,
      ['E1', '15/10/2569', 'S001', '', 'E-01', 'ค่าขนส่ง', '1,000', '1%', '', 'ค่าขนส่ง', '53'],
      ['E1', '15/10/2569', 's001', '', 'E-02', '', '250', '', '', '', ''],
      ['E2', '16/10/2569', '', 'แท็กซี่', 'E-03', '', '120', '', '', '', ''],
      ['E3', '16/10/2569', 'S002', '', 'E-01', '', '0', '', '', '', ''],
      ['E4', '16/10/2569', '', '', '', '', 'abc', '150', '', '', '7'],
      ['E1', '15/10/2569', 'S001', '', 'E-01', '', '5', '3', '', '', ''],
    ], 'B');
    expect(r.docs.map((x) => [x.ref, x.party, x.party_name, x.wht, x.lines.map((l) => [l.code, l.description, l.amount])])).toEqual([
      ['E1', 'S001', null, { rate: '1', amount: null, income: 'ค่าขนส่ง', form: 'S53' }, [['E-01', 'ค่าขนส่ง', '1000'], ['E-02', null, '250']]],
      ['E2', '', 'แท็กซี่', null, [['E-03', null, '120']]],
    ]);
    expect(r.errors).toEqual([
      { row: 5, message: 'จำนวนเงินเป็น 0' },
      { row: 6, message: 'ไม่มีรหัสหรือชื่อผู้จำหน่าย' },
      { row: 6, message: 'ไม่มีรหัสค่าใช้จ่าย' },
      { row: 6, message: 'จำนวนเงิน "abc" ไม่ใช่ตัวเลข' },
      { row: 6, message: 'อัตราหัก ณ ที่จ่าย "150" ต้องเป็นร้อยละ 0–100' },
      { row: 6, message: 'แบบ ภ.ง.ด. "7" ใช้ 3 หรือ 53' },
      { row: 7, message: 'เลขที่อ้างอิง E1: ภาษีหัก ณ ที่จ่ายไม่ตรงกับแถว 2 — ใส่แถวเดียวของเอกสาร' },
    ]);
    expect(mapExpenseImport([['เลขที่อ้างอิง', 'วันที่', 'รหัสผู้จำหน่าย']], 'B').errors[0]!.message).toBe('ไม่มีคอลัมน์ "รหัสค่าใช้จ่าย", "จำนวนเงิน" — ใช้ชื่อหัวคอลัมน์ตามแบบฟอร์มตัวอย่าง');
  });

  it('HANDOFF 169: each kind\'s template = the fields its screen has (no credit days on cash sales, no payments on credit sales)', () => {
    const K = (cls: string) => TRADE_KINDS.find((k) => k.cls === cls)!;
    const keys = (cls: string) => importColumnsFor(K(cls)).map((c) => c.key);
    const th = (cls: string, key: string) => importColumnsFor(K(cls)).find((c) => c.key === key)?.th;
    expect(keys('HS')).not.toContain('credit_days');
    expect(keys('HS')).toEqual(expect.arrayContaining(['pay_method', 'pay_ref', 'wht_amount', 'party_branch', 'ship_to', 'salesperson', 'sales_area', 'ship_via', 'department', 'project', 'vat_basis', 'bill_discount', 'free', 'line_job', 'vat_code']));
    expect(th('HS', 'wht_amount')).toBe('ภาษีถูกหัก ณ ที่จ่าย');
    expect(th('HS', 'party_branch')).toBe('Bill to (สาขาลูกค้า)');
    expect(keys('IV')).toContain('credit_days');
    expect(keys('IV')).not.toEqual(expect.arrayContaining(['pay_method']));
    expect(keys('IV')).not.toContain('wht_amount');
    expect(keys('HP')).toEqual(expect.arrayContaining(['pay_method', 'wht_amount', 'wht_rate', 'wht_income', 'wht_form', 'ref_no', 'ref_date']));
    expect(keys('HP')).not.toContain('salesperson');
    expect([th('RR', 'ref_no'), th('RR', 'party_branch'), th('HP', 'wht_amount')]).toEqual(['เลขที่ใบกำกับผู้จำหน่าย', 'สาขาผู้ขาย', 'ภาษีหัก ณ ที่จ่าย']);
    expect(keys('CN')).toEqual(expect.arrayContaining(['ref_invoice', 'return', 'credit_days']));
    expect(keys('CN')).not.toContain('ref_no');
    expect(keys('RR')).not.toContain('return');
    expect(importKindOf('cash-sales')?.cls).toBe('HS');
    expect(importKindOf('other-expense-docs')).toMatchObject({ cls: 'OE', cash: true });
    expect(importKindOf('quotations')).toBeNull();
    // one wording for "required"
    const col = (cls: string, key: string) => importColumnsFor(K(cls)).find((c) => c.key === key)!;
    expect([importNeedLabel(col('HS', 'qty')), importNeedLabel(col('HS', 'item')), importNeedLabel(col('HS', 'pay_method')), importNeedLabel(col('HS', 'party_tax_id')), importNeedLabel(col('CN', 'ref_invoice'))])
      .toEqual(['ต้องมี', 'ต้องมีถ้าไม่ใส่ชื่อสินค้า', 'ไม่บังคับ (ค่าเริ่มต้น = เงินสดทั้งจำนวน)', 'ไม่บังคับ (ใช้เมื่อเพิ่มรายใหม่)', 'ต้องมี']);
    expect([importHeaderText(col('HS', 'qty')), importHeaderText(col('HS', 'price'))]).toEqual(['จำนวน *', 'ราคาต่อหน่วย']);
  });

  it('HANDOFF 169: reads every screen field (header with * markers), old files still fine', () => {
    const head = ['เลขที่อ้างอิง *', 'วันที่ *', 'รหัสลูกค้า', 'Bill to (สาขาลูกค้า)', 'สถานที่ส่งของ', 'อ้างอิงเอกสาร', 'แผนก', 'Job/โครงการ', 'พนักงานขาย', 'เขตการขาย', 'ขนส่งโดย', 'ภาษีขาย', 'ส่วนลดท้ายบิล',
      'วิธีชำระ', 'เลขที่อ้างอิง/เช็ค', 'ภาษีถูกหัก ณ ที่จ่าย', 'รหัสสินค้า', 'จำนวน *', 'ราคาต่อหน่วย', 'ของแถม (F)', 'Job รายบรรทัด', 'ประเภท VAT', 'เครดิต (วัน)'];
    const r = mapImport([head,
      ['HS-1', '15/10/2569', 'C001', '1', 'SH1', 'PO-77', 'D1', 'J1', 'SL1', 'BKK', 'TRK', 'เกณฑ์เงินสด', '5%', 'TR', 'T-001', '30', 'A-1', '2', '100', '', 'J2', '0', '30'],
      ['HS-1', '15/10/2569', 'C001', '', '', '', '', '', '', '', '', '', '', '', '', '', 'A-2', '1', '', 'ใช่', '', '', ''],
      ['HS-2', '15/10/2569', 'C001', '', '', '', '', '', '', '', '', 'ไม่รู้', '', '', '', '', 'A-1', '', '1', 'อาจจะ', '', '9', ''],
    ], 'B');
    expect(r.errors.map((e) => [e.row, e.message])).toEqual([
      [4, 'ไม่มีจำนวน (คอลัมน์ "จำนวน" ต้องมี)'], [4, 'ภาระภาษี "ไม่รู้" ใช้ "เกณฑ์สิทธิ" หรือ "เกณฑ์เงินสด"'], [4, 'ของแถม "อาจจะ" ใช้ ใช่/ไม่ใช่ (Y/N)'], [4, 'ประเภท VAT "9" ใช้ 1 = มี VAT · 0 = ยกเว้น · 2 = อัตรา 0%'],
    ]);
    expect(r.cols).toEqual(expect.arrayContaining(['credit_days', 'pay_method', 'wht_amount']));
    expect(r.docs[0]).toMatchObject({ ref: 'HS-1', party_branch: '00001', ship_to: 'SH1', ref_no: 'PO-77', department: 'D1', project: 'J1', salesperson: 'SL1', sales_area: 'BKK', ship_via: 'TRK', vat_basis: '2', bill_discount: '5%',
      pay_method: 'TR', pay_ref: 'T-001', credit_days: 30, wht: { rate: null, amount: '30', income: null, form: null } });
    expect(r.docs[0]!.lines.map((l) => [l.item, l.price, l.free, l.job, l.vat_code])).toEqual([['A-1', '100', null, 'J2', '0'], ['A-2', '0', true, null, null]]);
  });

  it('HANDOFF 169: cell helpers + payment sheet (several methods per document)', () => {
    expect(['', 'ใช่', 'Y', '1', 'ไม่ใช่', 'n', 'x', 'บางที'].map(importFlag)).toEqual([null, true, true, true, false, false, true, undefined]);
    expect(['', 'เกณฑ์สิทธิ', 'เกณฑ์ เงินสด', '2', 'x'].map(importVatBasis)).toEqual([null, '1', '2', '2', undefined]);
    expect(['', 'มี VAT', '0', 'ยกเว้น', '0%', '2', 'x'].map(importVatCode)).toEqual([null, '1', '0', '0', '2', '2', undefined]);
    const r = mapPaymentImport([['เลขที่อ้างอิง *', 'วิธีชำระ *', 'จำนวนเงิน *', 'เลขที่อ้างอิง/เช็ค', 'วันที่เช็ค'],
      ['HS-1', 'เงินสด', '1,000', '', ''], ['HS-1', 'TR', '605.50', 'T-9', ''], ['HS-2', '', '0', '', '32/1/2569'], ['', '', '', '', '']], 'B');
    expect(r.pays).toEqual([{ row: 2, ref: 'HS-1', method: 'เงินสด', amount: '1000', pay_ref: null, cheque_date: null }, { row: 3, ref: 'HS-1', method: 'TR', amount: '605.50', pay_ref: 'T-9', cheque_date: null }]);
    expect(r.errors.map((e) => e.message)).toEqual(['แผ่นรับ/จ่ายชำระ: ไม่มีวิธีชำระ', 'แผ่นรับ/จ่ายชำระ: จำนวนเงิน "0" ต้องเป็นตัวเลขมากกว่า 0', 'แผ่นรับ/จ่ายชำระ: วันที่เช็ค "32/1/2569" ไม่ถูกต้อง — ใช้ วว/ดด/ปปปป']);
    expect(mapPaymentImport([[''], []], 'B')).toEqual({ pays: [], errors: [] });
  });

  it('HANDOFF 170: own document number — optional column, groups by it when there is no reference, one number per document, no duplicates in the file', () => {
    const K = (cls: string) => TRADE_KINDS.find((k) => k.cls === cls)!;
    const col = (cls: string, key: string) => importColumnsFor(K(cls)).find((c) => c.key === key)!;
    expect([importNeedLabel(col('HS', 'doc_no')), importNeedLabel(col('HS', 'ref'))]).toEqual(['ไม่บังคับ (ค่าเริ่มต้น = ออกเลขอัตโนมัติ)', 'ต้องมีถ้าไม่ใส่เลขที่เอกสาร']);
    // reference + own number: grouped by reference, number kept
    const a = mapImport([['เลขที่อ้างอิง', 'เลขที่เอกสาร', 'วันที่', 'รหัสลูกค้า', 'รหัสสินค้า', 'จำนวน'],
      ['A1', 'HS6910-01', '1/10/2569', 'C1', 'X', '1'], ['A1', '', '1/10/2569', 'C1', 'Y', '1'], ['A2', '', '1/10/2569', 'C1', 'X', '1'],
      ['A3', 'HS6910-01', '1/10/2569', 'C1', 'X', '1'], ['A4', 'HS 01', '1/10/2569', 'C1', 'X', '1'], ['A1', 'HS6910-02', '1/10/2569', 'C1', 'Z', '1']], 'B');
    expect(a.docs.map((x) => [x.ref, x.doc_no, x.lines.length])).toEqual([['A1', 'HS6910-01', 2], ['A2', null, 1]]);
    expect(a.errors.map((e) => [e.row, e.message])).toEqual([
      [5, 'เลขที่เอกสาร HS6910-01 ซ้ำกับเลขที่อ้างอิง A1 (แถว 2) — หนึ่งเลขที่ใช้ได้เอกสารเดียว'],
      [6, 'เลขที่เอกสาร "HS 01" ใช้ได้เฉพาะตัวอักษร ตัวเลข และ / - . _ (ไม่มีช่องว่าง)'],
      [7, 'เลขที่อ้างอิง A1: เลขที่เอกสาร HS6910-02 ไม่ตรงกับแถว 2 (HS6910-01) — หนึ่งเอกสารใช้เลขที่เดียว'],
    ]);
    // no reference column: the number groups the rows and is also the reference
    const b = mapImport([['ใบเสร็จรับเงิน', 'วันที่', 'ชื่อลูกค้า', 'รหัสสินค้า', 'จำนวน'], ['RE-1', '1/10/2569', 'ก', 'X', '1'], ['RE-1', '1/10/2569', 'ก', 'Y', '1'], ['RE-2', '2/10/2569', 'ข', 'X', '1'], ['', '2/10/2569', 'ข', 'X', '1']], 'B');
    expect(b.docs.map((x) => [x.ref, x.doc_no, x.lines.length])).toEqual([['RE-1', 'RE-1', 2], ['RE-2', 'RE-2', 1]]);
    expect(b.errors.map((e) => e.message)).toEqual(['ไม่มีเลขที่อ้างอิง (คอลัมน์ "เลขที่อ้างอิง" หรือ "เลขที่เอกสาร" ต้องมีทุกแถว — แถวที่เลขเดียวกันรวมเป็นเอกสารเดียว)']);
    // "เลขที่ใบกำกับ": sales = own document number · purchases = supplier invoice number
    const head = ['เลขที่ใบกำกับ', 'วันที่', 'รหัสคู่ค้า', 'รหัสสินค้า', 'จำนวน'], row = ['INV-9', '1/10/2569', 'C1', 'X', '1'];
    expect(mapImport([head, row], 'B', K('HS')).docs[0]).toMatchObject({ ref: 'INV-9', doc_no: 'INV-9' });
    expect(mapImport([head, row], 'B', K('RR')).errors[0]?.message).toMatch(/ไม่มีคอลัมน์ "เลขที่อ้างอิง"/);
    expect(mapImport([['เลขที่อ้างอิง', ...head], ['R1', ...row]], 'B', K('RR')).docs[0]).toMatchObject({ ref: 'R1', doc_no: null, ref_no: 'INV-9' });
    expect(importReadColumns(K('IV')).find((c) => c.key === 'doc_no')!.aliases).toContain('เลขที่ใบกำกับ');
    expect([importDocNoError(''), importDocNoError('HS-1/2.3_4'), importDocNoError('x'.repeat(31))]).toEqual([null, null, `เลขที่เอกสาร "${'x'.repeat(31)}" ยาวเกิน 30 ตัว`]);
    // OE: same column
    const e = mapExpenseImport([['เลขที่เอกสาร', 'วันที่', 'ชื่อผู้จำหน่าย', 'รหัสค่าใช้จ่าย', 'จำนวนเงิน'], ['OE6910-1', '1/10/2569', 'ร้าน', 'E1', '100'], ['OE6910-1', '1/10/2569', 'ร้าน', 'E2', '50']], 'B');
    expect(e.docs.map((x) => [x.ref, x.doc_no, x.lines.length])).toEqual([['OE6910-1', 'OE6910-1', 2]]);
  });

  it('HANDOFF 170: VAT type per line from a VAT-amount column; long-decimal prices kept to 4 places like the screen; zero discount = none', () => {
    const r = mapImport([['เลขที่อ้างอิง', 'วันที่', 'รหัสลูกค้า', 'รหัสสินค้า', 'จำนวน', 'ราคาต่อหน่วย (ไม่รวมภาษี)', 'ส่วนลด (ไม่รวมภาษี)', 'ภาษี VAT', 'ราคาสุทธิ', 'ประเภท VAT'],
      ['B1', '1/10/2569', 'C1', 'CRS', '1', '5854.2056074766', '0', '409.79439252336', '6264', ''],
      ['B1', '1/10/2569', 'C1', 'MEM', '1', '350', '0.00', '', '350', ''],
      ['B1', '1/10/2569', 'C1', 'Z', '1', '100', '5', '0', '95', '2'],
      ['B2', '1/10/2569', 'C1', 'Z', '1', '100', '', 'abc', '', '']], 'B');
    expect(r.docs[0]!.lines.map((l) => [l.price, l.discount, l.vat_code, l.vat_amount, l.net_total])).toEqual([
      ['5854.2056', null, '1', '409.794393', '6264'], ['350', null, '0', '0', '350'], ['100', '5', '2', '0', '95']]);
    expect(r.errors.map((e) => [e.row, e.message])).toEqual([[5, 'ภาษี VAT "abc" ไม่ใช่ตัวเลข (คอลัมน์ "ภาษี VAT" — เว้นว่างได้ถ้าไม่มีภาษี)']]);
    // without a VAT-amount column the item's own VAT type still applies (null)
    expect(mapImport([['เลขที่อ้างอิง', 'วันที่', 'รหัสลูกค้า', 'รหัสสินค้า', 'จำนวน'], ['B1', '1/10/2569', 'C1', 'X', '1']], 'B').docs[0]!.lines[0]!.vat_code).toBeNull();
    expect(['5854.2056074766', '1.23455', '(2.000049)', '12', '1,234.5', 'x'].map(importPrice)).toEqual(['5854.2056', '1.2346', '-2', '12', '1234.5', null]);
    // "สินค้า" (name) and "รหัสสินค้า" (code) in either order
    const two = (h: string[], v: string[]) => mapImport([['เลขที่อ้างอิง', 'วันที่', 'รหัสลูกค้า', 'จำนวน', ...h], ['B1', '1/10/2569', 'C1', '1', ...v]], 'B').docs[0]!.lines[0]!;
    expect([two(['รหัสสินค้า', 'สินค้า'], ['X1', 'ชื่อ X']), two(['สินค้า', 'รหัสสินค้า'], ['ชื่อ X', 'X1'])].map((l) => [l.item, l.item_name])).toEqual([['X1', 'ชื่อ X'], ['X1', 'ชื่อ X']]);
    // check columns are readable but not part of the screen-shaped template sheet
    expect(importColumnsFor(TRADE_KINDS[0]!).filter((c) => c.check).map((c) => c.key)).toEqual(['vat_amount', 'net_total']);
  });

  it('HANDOFF 170 G: later rows of a document may leave head fields blank (date, customer, …) — they follow the first row; a different value is an error naming the column and row', () => {
    const K = TRADE_KINDS.find((k) => k.cls === 'HS')!;
    // the reported case: HS template, 4 rows of ทดลอง-HS-101, only the first has date + customer
    const H = ['เลขที่อ้างอิง *', 'วันที่ *', 'รหัสลูกค้า', 'ชื่อลูกค้า', 'แผนก', 'หมายเหตุ', 'รหัสสินค้า', 'จำนวน *', 'ราคาต่อหน่วย'];
    const r = mapImport([H,
      ['ทดลอง-HS-101', '20/11/2569', 'C001', '', 'D1', 'หน้าร้าน', 'A-1', '1', '100'],
      ['ทดลอง-HS-101', '', '', '', '', '', 'A-2', '2', '50'],
      ['ทดลอง-HS-101', '', '', '', '', '', 'A-3', '1', '10'],
      ['ทดลอง-HS-101', '', '', '', '', '', 'A-4', '3', '5']], 'B', K);
    expect(r.errors).toEqual([]);
    expect(r.docs.map((x) => [x.ref, x.date, x.party, x.department, x.remark, x.lines.length])).toEqual([['ทดลอง-HS-101', '2026-11-20', 'C001', 'D1', 'หน้าร้าน', 4]]);
    // a different non-blank head value = error with the column and row (the date/customer rules stay as they were)
    const bad = mapImport([H,
      ['B1', '20/11/2569', 'C001', '', 'D1', 'หน้าร้าน', 'A-1', '1', '100'],
      ['B1', '', '', '', 'D2', '', 'A-2', '1', '1'],
      ['B1', '21/11/2569', '', '', '', '', 'A-3', '1', '1'],
      ['B1', '', 'C002', '', '', '', 'A-4', '1', '1'],
      ['B1', '20/11/2569', 'C001', '', 'D1', 'หน้าร้าน', 'A-5', '1', '1']], 'B', K);
    expect(bad.errors.map((e) => [e.row, e.message])).toEqual([
      [3, 'เลขที่อ้างอิง B1: คอลัมน์ "แผนก" = "D2" ไม่ตรงกับแถว 2 ("D1") — ช่องหัวเอกสารใส่แถวแรกพอ แถวต่อมาเว้นว่างหรือใส่ค่าเดิม'],
      [4, 'เลขที่อ้างอิง B1: วันที่ไม่ตรงกับแถว 2'],
      [5, 'เลขที่อ้างอิง B1: รหัสคู่ค้าไม่ตรงกับแถว 2'],
    ]);
    expect(bad.docs[0]!.lines.map((l) => l.item)).toEqual(['A-1', 'A-5']);
    // a new customer by name: later rows blank → the same new customer
    expect(mapImport([['เลขที่อ้างอิง', 'วันที่', 'ชื่อลูกค้า', 'รหัสสินค้า', 'จำนวน'], ['N1', '1/10/2569', 'ร้านใหม่', 'X', '1'], ['N1', '', '', 'Y', '1']], 'B', K).docs[0]).toMatchObject({ party: '', party_name: 'ร้านใหม่' });
    // grouping by document number (no reference column) follows the same rule
    const dn = mapImport([['เลขที่เอกสาร', 'วันที่', 'รหัสลูกค้า', 'รหัสสินค้า', 'จำนวน'], ['HS-9', '1/10/2569', 'C1', 'X', '1'], ['HS-9', '', '', 'Y', '1'], ['', '', '', 'Z', '1']], 'B', K);
    expect(dn.docs.map((x) => [x.ref, x.doc_no, x.date, x.party, x.lines.length])).toEqual([['HS-9', 'HS-9', '2026-10-01', 'C1', 2]]);
    expect(dn.errors.map((e) => e.row)).toEqual([4]);   // no number at all = no document to follow
    // first row blank = still an error on that row
    expect(mapImport([H, ['B2', '', 'C001', '', '', '', 'A-1', '1', '1']], 'B', K).errors[0]).toEqual({ row: 2, message: 'วันที่ "" ไม่ถูกต้อง — ใช้ วว/ดด/ปปปป' });
    // OE: the same
    const e = mapExpenseImport([['เลขที่อ้างอิง', 'วันที่', 'รหัสผู้จำหน่าย', 'รหัสค่าใช้จ่าย', 'จำนวนเงิน', 'หมายเหตุ'], ['E1', '1/10/2569', 'S1', 'X', '100', 'ก'], ['E1', '', '', 'Y', '50', ''], ['E1', '', '', 'Z', '5', 'ข']], 'B');
    expect(e.docs.map((x) => [x.date, x.party, x.lines.length])).toEqual([['2026-10-01', 'S1', 2]]);
    expect(e.errors.map((x) => [x.row, x.message])).toEqual([[4, 'เลขที่อ้างอิง E1: คอลัมน์ "หมายเหตุ" = "ข" ไม่ตรงกับแถว 2 ("ก") — ช่องหัวเอกสารใส่แถวแรกพอ แถวต่อมาเว้นว่างหรือใส่ค่าเดิม']]);
  });
});
