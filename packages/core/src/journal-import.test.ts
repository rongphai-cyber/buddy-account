import { describe, it, expect } from 'vitest';
import { importTaxId } from './trade-import.js';
import { cleanImportCell, compareJournalSides, JOURNAL_IMPORT_COLUMNS, journalImportKey, journalImportSide, mapJournalImport, type JournalCompareSide } from './journal-import.js';

const H = ['สมุด', 'เลขที่กลุ่ม', 'วันที่', 'อ้างอิง', 'คำอธิบาย', 'เลขที่บัญชี', 'คำอธิบายรายการ', 'แผนก', 'Job', 'เดบิต', 'เครดิต'];

describe('journal import (เจ้าของ 17/11/2569)', () => {
  it('groups rows by book + group into balanced vouchers', () => {
    const r = mapJournalImport([H,
      ['PV', '1', '15/11/2569', 'INV-1', 'จ่ายค่าไฟ', '5430-01', 'ค่าไฟสำนักงาน', '03', '', '1,500.00', ''],
      ['PV', '1', '15/11/2569', '', '', '1111-01', '', '', '', '', '1500'],
      ['JV', '1', '2026-11-30', 'ADJ', 'ปรับปรุง', '5411-01', '', '', 'J01', '800', ''],
      ['JV', '1', '2026-11-30', '', '', '2131-01', '', '', '', '', '800'],
      ['', '', '', '', '', '', '', '', '', '', ''],
    ], 'B');
    expect(r.errors).toEqual([]);
    expect(r.vouchers.map((v) => [v.book, v.group, v.date, v.ref, v.description, v.lines.length, v.debit, v.credit])).toEqual([
      ['PV', '1', '2026-11-15', 'INV-1', 'จ่ายค่าไฟ', 2, '1500.00', '1500.00'],
      ['JV', '1', '2026-11-30', 'ADJ', 'ปรับปรุง', 2, '800.00', '800.00'],
    ]);
    expect(r.vouchers[0]!.lines[0]).toMatchObject({ account: '5430-01', description: 'ค่าไฟสำนักงาน', department: '03', debit: '1500.00', credit: '0.00' });
    expect(r.vouchers[1]!.lines[0]!.job).toBe('J01');
  });
  it('columns in any order, aliases, Excel date serial', () => {
    const r = mapJournalImport([['Dr', 'Cr', 'บัญชี', 'วันที่', 'กลุ่ม', 'สมุดรายวัน'], ['100', '', '5430-01', '46341', 'A', 'JV'], ['', '100', '1111-01', '46341', 'A', 'JV']], 'B');
    expect(r.errors).toEqual([]);
    expect(r.vouchers[0]).toMatchObject({ book: 'JV', group: 'A', debit: '100.00' });
    expect(r.vouchers[0]!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('reports row errors: unbalanced, one line, both sides, negative, bad date, conflicting header', () => {
    const r = mapJournalImport([H,
      ['PV', '1', '15/11/2569', '', '', '5430-01', '', '', '', '100', ''],
      ['PV', '1', '15/11/2569', '', '', '1111-01', '', '', '', '', '90'],
      ['PV', '2', '15/11/2569', '', '', '5430-01', '', '', '', '100', ''],
      ['PV', '3', '15/11/2569', '', '', '5430-01', '', '', '', '100', '100'],
      ['PV', '4', '15/11/2569', '', '', '5430-01', '', '', '', '-5', ''],
      ['PV', '5', '31/02/2569', '', '', '5430-01', '', '', '', '5', ''],
      ['PV', '6', '15/11/2569', 'A', '', '5430-01', '', '', '', '5', ''],
      ['PV', '6', '16/11/2569', 'A', '', '1111-01', '', '', '', '', '5'],
      ['PV', '7', '15/11/2569', '', '', '', '', '', '', '5', ''],
      ['PV', '8', '15/11/2569', '', '', '5430-01', '', '', '', '1.555', ''],
    ], 'B');
    const msg = r.errors.map((e) => `${e.row}:${e.message}`).join('\n');
    expect(msg).toMatch(/2:PV กลุ่ม 1: ยอดไม่ดุล เดบิต 100.00 เครดิต 90.00/);
    expect(msg).toMatch(/4:PV กลุ่ม 2: ใบสำคัญต้องมีอย่างน้อย 2 บรรทัด/);
    expect(msg).toMatch(/5:ใส่เดบิตหรือเครดิตอย่างใดอย่างหนึ่ง/);
    expect(msg).toMatch(/6:เดบิต\/เครดิตต้องไม่ติดลบ/);
    expect(msg).toMatch(/7:วันที่ "31\/02\/2569" ไม่ถูกต้อง/);
    expect(msg).toMatch(/9:PV กลุ่ม 6: วันที่ไม่ตรงกับแถว 8/);
    expect(msg).toMatch(/10:ไม่มีเลขที่บัญชี/);
    expect(msg).toMatch(/11:จำนวนเงินทศนิยมได้ไม่เกิน 2 ตำแหน่ง/);
  });
  it('tax columns (เจ้าของเลือก ก 18/11/2569): VAT and WHT details on the tax account row, defaults, side and field checks', () => {
    const T = [...H, 'ภาษี', 'เลขที่ใบกำกับ', 'วันที่ใบกำกับ', 'งวดภาษี', 'ชื่อคู่ค้า', 'เลขผู้เสียภาษี', 'สาขาคู่ค้า', 'ฐานภาษี', 'อัตราภาษี', 'ประเภทเงินได้'];
    const L = (g: string, acc: string, dr: string, cr: string, ...tax: string[]) => ['PV', g, '15/11/2569', '', '', acc, '', '', '', dr, cr, ...tax, ...Array(10 - tax.length).fill('')];
    const ok = mapJournalImport([T,
      L('1', '5430-01', '1000', ''), L('1', '1154-00', '70', '', 'ภาษีซื้อ', 'IV-01', '10/11/2569', '', 'บริษัท ก จำกัด', '0105550123451', 'สำนักงานใหญ่'), L('1', '1111-01', '', '1070'),
      L('2', '5430-02', '2000', ''), L('2', '2135-00', '', '60', 'ภ.ง.ด.53', '', '', '', 'บริษัท ข จำกัด', '', '1', '2000'), L('2', '1111-01', '', '1940'),
      L('3', '1111-01', '535', ''), L('3', '2137-00', '', '35', 'ขาย', 'S-9', '', '12/2569'), L('3', '4100-01', '', '500'),
    ], 'B');
    expect(ok.errors).toEqual([]);
    const tax = ok.vouchers.flatMap((v) => v.lines.map((l) => l.tax).filter(Boolean));
    expect(tax).toEqual([
      { kind: 'P', no: 'IV-01', date: '2026-11-10', month: null, party: 'บริษัท ก จำกัด', party_tax_id: '0105550123451', party_branch: '00000', base: '1000.00', rate: null, income_type: null, amount: '70.00' },
      { kind: 'S53', no: null, date: null, month: null, party: 'บริษัท ข จำกัด', party_tax_id: null, party_branch: '00001', base: '2000.00', rate: '3.00', income_type: 'ค่าบริการ', amount: '60.00' },
      { kind: 'S', no: 'S-9', date: null, month: '2026-12', party: null, party_tax_id: null, party_branch: null, base: '500.00', rate: null, income_type: null, amount: '35.00' },
    ]);
    const bad = mapJournalImport([T,
      L('1', '1154-00', '', '70', 'ภาษีซื้อ', 'IV-1'),               // ภาษีซื้อด้านเครดิต
      L('2', '1154-00', '70', '', 'ภาษีซื้อ'),                       // ไม่มีเลขที่ใบกำกับ
      L('3', '2135-00', '', '30', 'ภงด3', '', '', '', 'นาย ก'),       // ไม่มีจำนวนเงินที่จ่าย
      L('4', '2135-00', '', '30', 'ภงด3', '', '', '', '', '', '', '1000'), // ไม่มีชื่อผู้ถูกหัก
      L('5', '1154-00', '70', '', 'ภาษีซื้อ', 'IV-5', '', '', '', '0105550123450'), // เลขผู้เสียภาษีผิด
      L('6', '1154-00', '70', '', 'VAT?', 'IV-6'),                     // ไม่รู้จักประเภท
      L('7', '5430-01', '70', '', '', 'IV-7'),                        // มีรายละเอียดแต่ไม่ระบุภาษี
      L('8', '1154-00', '70', '', 'ภาษีซื้อ', 'IV-8', '', '13/2569'),  // งวดผิด
    ], 'B');
    const msg = bad.errors.map((e) => `${e.row}:${e.message}`).join('\n');
    expect(msg).not.toMatch(/ยอดไม่ดุล|อย่างน้อย 2 บรรทัด/);   // ใบที่มีแถวผิด ไม่แจ้งไม่ดุลซ้ำ
    expect(bad.vouchers.every((v) => v.invalid)).toBe(true);
    expect(msg).toMatch(/2:ภาษีซื้อต้องอยู่ด้านเดบิต/);
    expect(msg).toMatch(/3:ไม่มีเลขที่ใบกำกับภาษี/);
    expect(msg).toMatch(/4:ไม่มีจำนวนเงินที่จ่าย/);
    expect(msg).toMatch(/5:ไม่มีชื่อผู้ถูกหักภาษี/);
    expect(msg).toMatch(/6:เลขผู้เสียภาษี 0105550123450: .*หลักตรวจสอบไม่ตรง/);
    expect(msg).toMatch(/7:ภาษี "VAT\?" ไม่รู้จัก/);
    expect(msg).toMatch(/8:มี"เลขที่ใบกำกับ" แต่ไม่ได้ระบุคอลัมน์ "ภาษี"/);
    expect(msg).toMatch(/9:งวดภาษี "13\/2569" ไม่ถูกต้อง/);
  });
  it('voucher number column (เจ้าของ 18/11/2569): optional, upper case, groups without group no, same on every row, unique in the file', () => {
    const V = ['สมุด', 'เลขที่กลุ่ม', 'เลขที่ใบสำคัญ', 'วันที่', 'เลขที่บัญชี', 'เดบิต', 'เครดิต'];
    const ok = mapJournalImport([V,
      ['PV', '1', 'pv6911001', '15/11/2569', '5430-01', '100', ''], ['PV', '1', '', '15/11/2569', '1111-01', '', '100'],
      ['PV', '', 'PV6911002', '15/11/2569', '5430-01', '50', ''], ['PV', '', 'PV6911002', '15/11/2569', '1111-01', '', '50'],
      ['JV', '2', '', '15/11/2569', '5430-01', '5', ''], ['JV', '2', '', '15/11/2569', '1111-01', '', '5'],
    ], 'B');
    expect(ok.errors).toEqual([]);
    expect(ok.vouchers.map((v) => [v.book, v.group, v.voucher_no, v.lines.length])).toEqual([['PV', '1', 'PV6911001', 2], ['PV', 'PV6911002', 'PV6911002', 2], ['JV', '2', null, 2]]);
    const bad = mapJournalImport([V,
      ['PV', '1', 'PV1', '15/11/2569', '5430-01', '100', ''], ['PV', '1', 'PV2', '15/11/2569', '1111-01', '', '100'],
      ['PV', '3', 'PV9', '15/11/2569', '5430-01', '5', ''], ['PV', '3', '', '15/11/2569', '1111-01', '', '5'],
      ['JV', '4', 'PV9', '15/11/2569', '5430-01', '5', ''], ['JV', '4', '', '15/11/2569', '1111-01', '', '5'],
      ['PV', '5', 'PV 5', '15/11/2569', '5430-01', '5', ''],
      ['PV', '6', 'PV'.padEnd(31, '1'), '15/11/2569', '5430-01', '5', ''],
    ], 'B');
    const msg = bad.errors.map((e) => `${e.row}:${e.message}`).join('\n');
    expect(msg).toMatch(/3:PV กลุ่ม 1: เลขที่ใบสำคัญ PV2 ไม่ตรงกับแถว 2 \(PV1\)/);
    expect(msg).toMatch(/6:JV กลุ่ม 4: เลขที่ใบสำคัญ PV9 ซ้ำกับ PV กลุ่ม 3 \(แถว 4\) ในแฟ้มเดียวกัน/);
    expect(msg).toMatch(/8:เลขที่ใบสำคัญ "PV 5" มีช่องว่าง/);
    expect(msg).toMatch(/9:เลขที่ใบสำคัญ "PV1+" ยาวเกิน 30 ตัว/);
    expect(msg).not.toMatch(/ยอดไม่ดุล/);
    expect(bad.vouchers.find((v) => v.group === '3')!.invalid).toBeFalsy();   // ใบแรกที่ใช้เลขนั้นยังนำเข้าได้
  });
  it('Excel/OCR variants (เจ้าของ 18/11/2569): header *, Thai digits, dash zero, baht, hidden spaces, tax id that lost leading zero', () => {
    const T = ['สมุด *', 'เลขที่กลุ่ม *', 'วันที่ *', 'เลขที่บัญชี *', 'เดบิต *', 'เครดิต *', 'ภาษี', 'เลขที่ใบกำกับ', 'เลขผู้เสียภาษี', 'สาขาคู่ค้า'];
    const r = mapJournalImport([T,
      ['PV', '๑', '๑๕/๑๑/๒๕๖๙', '5430-01', '๑,๐๐๐.๐๐', '-', '', '', '', ''],
      ['PV', '1', '15/11/2569', '1154-00', '70 บาท', '–', 'ภาษีซื้อ', 'IV​-1', '105550123451', '0'],
      ['PV', '1 ', '15/11/2569', '1111-01', '', '1,070', '', '', '', ''],
    ], 'B');
    expect(r.errors).toEqual([]);
    expect(r.hasTax).toBe(true);
    expect(r.vouchers.map((v) => [v.group, v.date, v.debit, v.credit])).toEqual([['1', '2026-11-15', '1070.00', '1070.00']]);
    expect(r.vouchers[0]!.lines[1]!.tax).toMatchObject({ no: 'IV-1', party_tax_id: '0105550123451', party_branch: '00000' });
    expect(importTaxId('1.05550123451E+11')).toBe('0105550123451');
    expect(importTaxId('105550123450')).toBe('105550123450');   // เติม 0 แล้วหลักตรวจสอบไม่ตรง → คืนค่าเดิมให้ตัวตรวจแจ้ง
    expect(cleanImportCell(' ﻿๐๙ ')).toBe('09');
    expect(JOURNAL_IMPORT_COLUMNS.filter((c) => c.need === 'required').map((c) => c.key)).toEqual(['book', 'date', 'account']);
    expect(JOURNAL_IMPORT_COLUMNS.find((c) => c.key === 'debit')!.format).toBe('number');
  });
  it('compares a file voucher with the existing one (เจ้าของ 18/11/2569 เปรียบเทียบใบซ้ำ)', () => {
    const v = mapJournalImport([['สมุด', 'เลขที่กลุ่ม', 'วันที่', 'อ้างอิง', 'คำอธิบาย', 'เลขที่บัญชี', 'เดบิต', 'เครดิต'],
      ['PV', '1', '15/11/2569', 'R1', 'ค่าไฟ', '5430-01', '100', ''], ['PV', '1', '15/11/2569', '', '', '1111-01', '', '100']], 'B').vouchers[0]!;
    const file = journalImportSide(v);
    expect(file.lines[1]!.description).toBe('ค่าไฟ');   // คำอธิบายรายการว่าง = คำอธิบายของใบ (เหมือนตอนบันทึก)
    const cur: JournalCompareSide = { ...file, voucher_no: 'PV691115001', lines: file.lines.map((l) => ({ ...l })), taxes: [] };
    expect(compareJournalSides(file, cur, true)).toEqual([]);
    cur.date = '2026-11-16'; cur.ref = 'r1'; cur.lines[1]!.credit = '90.00'; cur.lines.push({ account: '2131-01', description: '', department: '', job: '', debit: '0.00', credit: '10.00' });
    cur.taxes = [{ kind: 'P', no: 'IV1', date: '2026-11-15', base: '100.00', amount: '7.00' }];
    expect(compareJournalSides(file, cur, true)).toEqual(['วันที่', 'จำนวนบรรทัด 2/3', 'บรรทัด 2', 'ภาษี']);   // อ้างอิงไม่สนตัวพิมพ์เล็ก/ใหญ่
    expect(compareJournalSides(file, cur, false)).not.toContain('ภาษี');   // แฟ้มไม่มีคอลัมน์ภาษี = ไม่เทียบภาษี
    expect(journalImportKey(v)).toBe('PV|1');
  });
  it('missing header / columns', () => {
    expect(mapJournalImport([['a', 'b'], ['1', '2']], 'B').errors[0]!.message).toMatch(/ไม่พบหัวตาราง/);
    expect(mapJournalImport([['สมุด', 'เลขที่กลุ่ม', 'วันที่', 'เลขที่บัญชี', 'เดบิต']], 'B').errors[0]!.message).toMatch(/ไม่มีคอลัมน์ "เครดิต"/);
  });
});
