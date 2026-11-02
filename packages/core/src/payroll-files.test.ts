import { describe, expect, it } from 'vitest';
import { bankCsv, efilingName, efilingProblems, efilingText, rdPrepName, rdPrepText, rdProblems, ssoFileName, ssoFileProblems, tis620, validThaiId, type RdPerson } from './payroll-files.js';
import { mapEmployeeImport, mapRunImport } from './payroll-import.js';

const A: RdPerson = { no: 1, tax_id: '1101700230708', title: null, first_name: 'เอ', last_name: 'ทดสอบ', pay_date: '2026-01-31', income: '30000', tax: '164.58', condition: '1',
  addr: { house_no: '9/9', subdistrict: 'สุเทพ', district: 'เมืองเชียงใหม่', province: 'เชียงใหม่', postcode: '50200' } };

describe('แฟ้มยื่นภาษี (ตัวอย่างเดียวกับชุดทดสอบ WTS-ERP)', () => {
  it('RD Prep ภ.ง.ด.1 / 1ก: คั่นด้วย | CRLF ทุกบรรทัด วันที่ พ.ศ.', () => {
    expect(rdPrepText([A], false)).toBe('1|1101700230708|-|เอ|ทดสอบ|31/01/2569|30000.00|164.58|401N|0.00|1\r\n');
    expect(rdPrepText([{ ...A, income: '60000', tax: '329.16' }], true, 2026)).toBe('1|1101700230708|-|เอ|ทดสอบ|31/12/2569|60000.00|329.16|401N|0.00|1|สุเทพ|เมืองเชียงใหม่|เชียงใหม่|50200|9/9|||||\r\n');
    expect(rdPrepName('0105559041270', '000000', 2026, 1)).toBe('PND1_0105559041270_000000_2569_01_00_RDPrep.txt');
    expect(rdPrepName('0105559041270', '000000', 2026, null)).toBe('PND1A_0105559041270_000000_2569_00_00_RDPrep.txt');
  });
  it('ตรวจก่อนสร้างแฟ้ม: เลข 13 หลัก นามสกุล อักขระต้องห้าม ที่อยู่ (1ก)', () => {
    expect(validThaiId('1101700230708')).toBe(true);
    expect(rdProblems([A], true)).toEqual([]);
    expect(rdProblems([{ ...A, tax_id: '1101700230709', last_name: null, first_name: 'เอ/บี', addr: {} }], true)).toHaveLength(4);
  });
  it('e-Filing FORMAT กลาง v2.0: H 22 ช่อง · D 26 ช่อง · ไม่มีขึ้นบรรทัดท้ายแฟ้ม · ที่อยู่ที่มีอักขระต้องห้ามเว้นว่าง', () => {
    const h = { company_tax_id: '0105559041270', branch6: '000000', branch_name: 'สำนักงานใหญ่', form: 'PND1' as const, year: 2026, month: 1, filing_no: 0, internet: true, efiling_user: 'buddy01' };
    const t = efilingText(h, [A]);
    const [H, D] = t.split('\r\n');
    expect(t.endsWith('\r\n')).toBe(false);
    expect(H!.split('|')).toHaveLength(22);
    expect(H).toBe('H|0000|0105559041270|000000|1|PND1|0105559041270|000000|สำนักงานใหญ่|0|01|2569||00|1|30000.00|164.58|0.00|164.58|164.58|buddy01|2');
    expect(D!.split('|')).toHaveLength(26);
    expect(D).toBe('D|1|000000|1101700230708|0000000000|-|เอ|ทดสอบ|31012569|0.00|30000.00|164.58|1|1|||||||||สุเทพ|เมืองเชียงใหม่|เชียงใหม่|50200');
    expect(efilingName(h)).toBe('PND1_0105559041270_000000_2569_01_00_00.txt');
    expect(efilingProblems({ ...h, efiling_user: '' })).toEqual([expect.stringMatching(/e-Filing/)]);
  });
  it('TIS-620: ตัวอักษรไทย 1 ไบต์', () => {
    expect([...tis620('ก|A๙')]).toEqual([0xa1, 0x7c, 0x41, 0xf9]);
  });
  it('ไฟล์โอนธนาคาร: เฉพาะยอดสุทธิมากกว่า 0 · ไม่มีเลขบัญชีแจ้งปัญหา', () => {
    const r = bankCsv([{ code: 'E01', name: 'นายเอ', bank_code: 'KBANK', bank_name: 'กสิกรไทย', account_no: '1234567890', account_name: null, net: '28960.42' },
      { code: 'E02', name: 'บี', bank_code: null, bank_name: null, account_no: null, account_name: null, net: '100' }, { code: 'E03', name: 'ซี', bank_code: null, bank_name: null, account_no: '1', account_name: null, net: '0' }]);
    expect(r.text).toBe('﻿รหัสพนักงาน,ชื่อ,ธนาคาร,ชื่อธนาคาร,เลขบัญชี,ชื่อบัญชี,จำนวนเงิน\r\n"E01","นายเอ","KBANK","กสิกรไทย","1234567890","นายเอ",28960.42\r\n"E02","บี","","","","บี",100.00\r\n');
    expect([r.count, r.total, r.problems.length]).toEqual([2, '29060.42', 1]);
  });
  it('แฟ้มประกันสังคม: เลขที่บัญชีนายจ้าง 10 หลัก · คำนำหน้า · ชื่อแฟ้ม', () => {
    expect(ssoFileProblems('123', [{ tax_id: '1101700230708', title: null, first_name: 'เอ', last_name: 'ท', wage_paid: '30000', ee: '875' }])).toHaveLength(2);
    expect(ssoFileName('1234567890', 2026, 1)).toBe('1234567890_012569.xls');
  });
});

describe('นำเข้าจาก Excel', () => {
  it('ทะเบียนพนักงาน: หัวตารางตามชื่อ · แปลงวันที่/ตัวเลือก · แจ้งแถวที่ผิด · รหัสซ้ำ', () => {
    const r = mapEmployeeImport([
      ['แบบนำเข้าพนักงาน'],
      ['รหัสพนักงาน', 'ชื่อ', 'นามสกุล', 'วันเริ่มงาน', 'อัตราค่าจ้าง', 'วิธีคิดค่าจ้าง', 'ประกันสังคม', 'เลขบัตรประชาชน', 'ผู้รับภาระภาษี'],
      ['e001', 'สมชาย', 'ใจดี', '01/01/2569', '25,000', 'รายเดือน', 'ใช่', '1-1017-00230-70-8', 'หัก ณ ที่จ่าย'],
      ['E002', 'สมหญิง', '', '2026-02-01', '450', 'รายวัน', 'ไม่', '', 'ออกให้ตลอดไป'],
      ['E003', 'ผิด', '', '31/02/2569', 'abc', 'รายปี', 'อาจจะ', '', ''],
      ['E001', 'ซ้ำ'],
      [],
    ], 'B');
    expect(r.rows.map((x) => [x.code, x.values.hire_date, x.values.rate, x.values.wage_type, x.values.sso_insured, x.values.tax_id ?? null, x.values.tax_bearer])).toEqual([
      ['E001', '2026-01-01', '25000', 'M', true, '1101700230708', 'W'], ['E002', '2026-02-01', '450', 'D', false, null, 'F'], ['E003', undefined, undefined, undefined, undefined, null, undefined]]);
    expect(r.errors.map((e) => e.row)).toEqual([5, 5, 5, 5, 6]);
    expect(mapEmployeeImport([['ชื่อ', 'ที่อยู่']], 'B').errors[0]!.message).toMatch(/รหัสพนักงาน/);
  });
  it('ยอดประจำงวด: คอลัมน์รายการจับด้วยรหัส · จำนวน/จำนวนเงินตามวิธีคิด · ศูนย์ข้าม · คอลัมน์ไม่รู้จักแจ้ง', () => {
    const items = [{ code: 'IN002', calc: 'HOURS' }, { code: 'IN008', calc: 'AMOUNT' }];
    const r = mapRunImport([['รหัสพนักงาน', 'ชื่อ', 'วันทำงาน', 'IN002 ค่าล่วงเวลา (ชั่วโมง)', 'IN008 โบนัส', 'XX9 อื่น'], ['A', 'เอ', '', '4', '5,000', ''], ['C', 'ซี', '22', '0', '', '']], items);
    expect(r.rows).toEqual([{ row: 2, code: 'A', work_days: null, work_hours: null, lines: [{ item_code: 'IN002', qty: '4', amount: null }, { item_code: 'IN008', qty: null, amount: '5000' }] },
      { row: 3, code: 'C', work_days: '22', work_hours: null, lines: [] }]);
    expect(r.errors.map((e) => e.message)).toEqual([expect.stringMatching(/XX9/)]);
  });
});
