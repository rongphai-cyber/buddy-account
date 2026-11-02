import { describe, expect, it } from 'vitest';
import { addressProblem, payWht50, pnd1Income, pnd1Rows, ssoForm, thaiAddress, w50IssueDate } from './payroll-forms.js';
import { ssoRateOn } from './payroll.js';

const T = (regular: string, tax: string, x: Partial<{ special: string; employer_paid_tax: string; sso_ee: string; pvd_ee: string }> = {}) =>
  ({ regular, special: x.special ?? '0', employer_paid_tax: x.employer_paid_tax ?? '0', tax, sso_ee: x.sso_ee ?? '0', pvd_ee: x.pvd_ee ?? '0' });

describe('แบบฟอร์มเงินเดือน', () => {
  it('ภ.ง.ด.1: เงินได้ = ประจำ + ไม่ประจำ + ภาษีที่บริษัทออกให้ · เงื่อนไข 1/2/3 · เรียงตามรหัส · คนไม่มีเงินได้ไม่แสดง', () => {
    expect(pnd1Income({ regular: '30000', special: '1875', employer_paid_tax: '0' }).toFixed(2)).toBe('31875.00');
    const r = pnd1Rows([
      { employee_id: 'b', code: 'E02', title: null, first_name: 'บี', last_name: null, tax_id: null, bearer: 'W', pay_date: '2026-01-31', totals: T('16000', '0', { special: '1500' }) },
      { employee_id: 'a', code: 'E01', title: 'นาย', first_name: 'เอ', last_name: 'ทดสอบ', tax_id: '1101700230708', bearer: 'W', pay_date: '2026-01-31', totals: T('30000', '164.58') },
      { employee_id: 'c', code: 'E03', title: null, first_name: 'ซี', last_name: null, tax_id: '1101700230716', bearer: 'F', pay_date: '2026-01-31', totals: T('60000', '173.25', { employer_paid_tax: '173.25' }) },
      { employee_id: 'z', code: 'E09', title: null, first_name: 'ไม่มี', last_name: null, tax_id: null, bearer: 'W', pay_date: '2026-01-31', totals: T('0', '0') },
    ]);
    expect(r.rows.map((x) => [x.no, x.code, x.income, x.tax, x.condition, x.problem])).toEqual([
      [1, 'E01', '30000.00', '164.58', '1', null], [2, 'E02', '17500.00', '0.00', '1', 'ไม่มีเลขประจำตัวประชาชน'], [3, 'E03', '60173.25', '173.25', '2', null]]);
    expect([r.count, r.income, r.tax]).toEqual([3, '107673.25', '337.83']);
    expect(pnd1Rows([{ employee_id: 'b', code: 'E02', title: null, first_name: 'บี', last_name: null, tax_id: null, bearer: 'W', pay_date: '2026-01-31', totals: T('16000', '0') }], { taxedOnly: true }).count).toBe(0);
  });
  it('50 ทวิ: แบบ ภ.ง.ด.1ก บรรทัด 40(1) วันที่ออก 31 ธ.ค. หรือวันที่ออกจากงาน · เงินสมทบประกันสังคม/กองทุน', () => {
    const w = payWht50({ payer: { name: 'บริษัท' }, payee: { name: 'นายเอ' }, book_no: '2569', run_no: '001', issue_date: w50IssueDate(2026, null), totals: T('60000', '329.16', { sso_ee: '1750' }), bearer: 'O' });
    expect([w.form, w.lines[0]!.row, w.lines[0]!.amount, w.lines[0]!.tax, w.funds?.sso, w.funds?.pvd, w.condition, w.issue_date]).toEqual(['1ก', '1', '60000.00', '329.16', '1750.00', '', '3', '2026-12-31']);
    expect(w50IssueDate(2026, '2026-02-15')).toBe('2026-02-15');
    expect(w50IssueDate(2026, '2027-02-15')).toBe('2026-12-31');
  });
  it('สปส.1-10: ค่าจ้างในแบบไม่เกินเพดาน (ค่าจ้างจริงเก็บไว้ทำแฟ้มยื่น) · รวมเงินสมทบสองฝ่าย', () => {
    const f = ssoForm([
      { employee_id: 'a', code: 'E01', title: 'นาย', first_name: 'เอ', last_name: null, tax_id: '1101700230708', wage: '30000', ee: '875', er: '875' },
      { employee_id: 'b', code: 'E02', title: 'นาย', first_name: 'บี', last_name: null, tax_id: null, wage: '1000', ee: '83', er: '83' },
    ], ssoRateOn('2026-01-31'));
    expect(f.rows.map((r) => [r.wage_paid, r.wage, r.ee, r.problem])).toEqual([['30000.00', '17500.00', '875.00', null], ['1000.00', '1650.00', '83.00', 'ไม่มีเลขประจำตัวประชาชน 13 หลัก']]);
    expect([f.count, f.wage, f.ee, f.er, f.total]).toEqual([2, '19150.00', '958.00', '958.00', '1916.00']);
  });
  it('ที่อยู่ตามทะเบียนบ้าน: กรุงเทพฯ ใช้แขวง/เขต · ตรวจครบสำหรับ ภ.ง.ด.1ก', () => {
    expect(thaiAddress({ house_no: '9/9', moo: '3', road: 'ห้วยแก้ว', subdistrict: 'สุเทพ', district: 'เมืองเชียงใหม่', province: 'เชียงใหม่', postcode: '50200' })).toBe('เลขที่ 9/9 หมู่ 3 ถนนห้วยแก้ว ตำบลสุเทพ อำเภอเมืองเชียงใหม่ จังหวัดเชียงใหม่ 50200');
    expect(thaiAddress({ house_no: '1', subdistrict: 'สีลม', district: 'บางรัก', province: 'กรุงเทพมหานคร', postcode: '10500' })).toBe('เลขที่ 1 แขวงสีลม เขตบางรัก กรุงเทพมหานคร 10500');
    expect(addressProblem({ subdistrict: 'สีลม', district: 'บางรัก', province: 'กรุงเทพมหานคร', postcode: '105' })).toMatch(/ไม่ครบ/);
  });
});
