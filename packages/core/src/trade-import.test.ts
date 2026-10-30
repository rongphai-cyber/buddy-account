import { describe, expect, it } from 'vitest';
import { importDate, importNumber, mapImport, parseCsv, xlsxSharedStrings, xlsxSheetRows } from './trade-import.js';

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
    expect(r.docs[0]!.lines[0]).toEqual({ row: 3, item: 'A-1', description: null, qty: '2', unit: null, price: '1500', discount: '10%', warehouse: null });
    expect(r.errors).toEqual([
      { row: 7, message: 'จำนวน "x" ไม่ใช่ตัวเลข' },
      { row: 8, message: 'เลขที่อ้างอิง INV1: วันที่ไม่ตรงกับแถว 3' },
      { row: 9, message: 'วันที่ "" ไม่ถูกต้อง — ใช้ วว/ดด/ปปปป' },
      { row: 9, message: 'ไม่มีรหัสสินค้า' },
    ]);
  });

  it('reports a missing header or required column clearly', () => {
    expect(mapImport([['a', 'b'], ['1', '2']], 'B').errors[0]!.message).toMatch(/ไม่พบหัวตาราง/);
    expect(mapImport([['เลขที่อ้างอิง', 'วันที่', 'รหัสลูกค้า', 'รหัสสินค้า']], 'B').errors[0]!.message).toBe('ไม่มีคอลัมน์ "จำนวน", "ราคาต่อหน่วย" — ใช้ชื่อหัวคอลัมน์ตามแบบฟอร์มตัวอย่าง');
    expect(mapImport([['เลขที่อ้างอิง', 'วันที่', 'รหัสลูกค้า', 'รหัสสินค้า', 'จำนวน', 'ราคาต่อหน่วย']], 'B').errors[0]!.message).toBe('ไม่มีรายการใต้หัวตาราง');
  });
});
