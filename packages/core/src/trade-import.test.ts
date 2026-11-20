import { describe, expect, it } from 'vitest';
import { importBranch, importDate, importItemKind, importNumber, importPartyKey, importWhtForm, mapExpenseImport, mapImport, parseCsv, xlsxSharedStrings, xlsxSheetRows } from './trade-import.js';

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
    expect(r.docs[0]!.lines[0]).toEqual({ row: 3, item: 'A-1', item_name: null, item_kind: null, description: null, qty: '2', unit: null, price: '1500', discount: '10%', warehouse: null });
    expect(r.errors).toEqual([
      { row: 7, message: 'จำนวน "x" ไม่ใช่ตัวเลข' },
      { row: 8, message: 'เลขที่อ้างอิง INV1: วันที่ไม่ตรงกับแถว 3' },
      { row: 9, message: 'วันที่ "" ไม่ถูกต้อง — ใช้ วว/ดด/ปปปป' },
      { row: 9, message: 'ไม่มีรหัสสินค้า (สินค้าใหม่: ใส่ชื่อสินค้า)' },
    ]);
  });

  it('reports a missing header or required column clearly', () => {
    expect(mapImport([['a', 'b'], ['1', '2']], 'B').errors[0]!.message).toMatch(/ไม่พบหัวตาราง/);
    expect(mapImport([['เลขที่อ้างอิง', 'วันที่', 'รหัสลูกค้า', 'รหัสสินค้า']], 'B').errors[0]!.message).toBe('ไม่มีคอลัมน์ "จำนวน", "ราคาต่อหน่วย" — ใช้ชื่อหัวคอลัมน์ตามแบบฟอร์มตัวอย่าง');
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
});
