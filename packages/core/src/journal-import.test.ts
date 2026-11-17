import { describe, it, expect } from 'vitest';
import { mapJournalImport } from './journal-import.js';

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
  it('missing header / columns', () => {
    expect(mapJournalImport([['a', 'b'], ['1', '2']], 'B').errors[0]!.message).toMatch(/ไม่พบหัวตาราง/);
    expect(mapJournalImport([['สมุด', 'เลขที่กลุ่ม', 'วันที่', 'เลขที่บัญชี', 'เดบิต']], 'B').errors[0]!.message).toMatch(/ไม่มีคอลัมน์ "เครดิต"/);
  });
});
