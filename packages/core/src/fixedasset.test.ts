import { describe, expect, it } from 'vitest';
import { faAnnual, faEndDate, faRate, faValidate, faYearSchedule, type FaAssetInput } from './fixedasset.js';

const A = (p: Partial<FaAssetInput>): FaAssetInput => ({ method: '1', is_depreciable: true, cost: '0', salvage_value: '1', rate: '20', start_date: '2000-01-01', depr_monthly: true, ...p });
const sum = (xs: string[]) => xs.reduce((s, v) => s + Number(v) * 100, 0) / 100;

describe('ค่าเสื่อมราคา (สูตร Express ตรวจกับ FAMAS ของข้อมูลจริง 576/576)', () => {
  it('ยอดลด: (ทุน − สะสมต้นปี) × อัตรา คิดรายวัน เศษลงงวดสุดท้าย', () => {
    const a = A({ method: '2', cost: '67900', start_date: '1997-09-26' });   // O-40-0001
    expect(faYearSchedule(a, 2009, '62374.13')).toEqual(['93.86', '84.78', '93.86', '90.84', '93.86', '90.84', '93.86', '93.86', '90.84', '93.86', '90.84', '93.87']);
    expect(faYearSchedule(a, 2010, '63479.30').slice(0, 2)).toEqual(['75.09', '67.82']);
  });
  it('เส้นตรง: (ทุน − ซาก) × อัตรา ÷ 365 × วัน · เริ่มกลางเดือนคิดตามวัน', () => {
    expect(faYearSchedule(A({ cost: '650000', start_date: '2008-11-26' }), 2009, '12786.87')[0]).toBe('11041.08');   // V-51-0001
    const e = faYearSchedule(A({ cost: '2383.18', start_date: '2010-02-08' }), 2010, 0);   // E-53-0001
    expect(e.slice(0, 3)).toEqual(['0.00', '27.41', '40.46']);
    expect(faYearSchedule(A({ cost: '2383.18', start_date: '2010-02-08' }), 2009, 0).every((v) => v === '0.00')).toBe(true);
  });
  it('ปีสุดท้าย: หยุดเมื่อเหลือเท่าราคาซาก เศษไม่ถึง 1 วันรวมในงวดนั้น', () => {
    const y = faYearSchedule(A({ cost: '14000', start_date: '2005-09-01' }), 2010, '12135.02');   // E-48-0006
    expect(y.slice(6, 10)).toEqual(['237.79', '237.80', '0.00', '0.00']);
    expect(sum(y)).toBe(1863.98);
  });
  it('ค่าเสื่อมที่คำนวณเอง: ลงงวดเริ่มใช้ครั้งเดียว และหักออกจากฐานเส้นตรง', () => {
    const a = A({ cost: '18682.24', rate: '33.33', start_date: '2009-05-26', manual_depr: '7472.89' });   // O-52-0005
    const y = faYearSchedule(a, 2009, 0);
    expect(y.slice(3, 6)).toEqual(['0.00', '7534.30', '307.05']);
    expect(sum(y)).toBe(9724.57);
    expect(faAnnual(a).toFixed(2)).toBe('3735.74');
    expect(faYearSchedule(a, 2010, '9724.57')[0]).toBe('317.28');
    // ระบุวันที่คำนวณเองถึง: ลงงวดนั้นแล้วคิดต่อจากวันถัดไป
    const b = faYearSchedule(A({ cost: '36501', start_date: '2008-01-01', manual_depr: '1000', manual_depr_to: '2009-03-31' }), 2009, '7300');
    expect([b[0], b[1], b[2]]).toEqual(['0.00', '0.00', '1000.00']);
    expect(Number(b[3])).toBeGreaterThan(0);
  });
  it('ขายแล้วหยุดที่วันขาย · คิดรายปีลงงวดสุดท้าย · ไม่คิดค่าเสื่อม', () => {
    const s = faYearSchedule(A({ cost: '36501', start_date: '2009-01-01', sold_date: '2009-06-15' }), 2009, 0);
    expect([s[5], s[6]]).toEqual(['300.00', '0.00']);
    const y = faYearSchedule(A({ cost: '36501', start_date: '2009-01-01', depr_monthly: false }), 2009, 0);
    expect([y[0], y[11]]).toEqual(['0.00', '7300.00']);
    expect(faYearSchedule(A({ cost: '1000', is_depreciable: false }), 2009, 0).every((v) => v === '0.00')).toBe(true);
  });
  it('อัตรา/วันครบอายุ/ตรวจข้อมูล', () => {
    expect(faRate({ rate: null, useful_life_years: 5 }).toString()).toBe('20');
    expect(faEndDate('2008-02-29', 5)).toBe('2013-02-28');
    expect(faValidate({ ...A({ cost: '1000', salvage_value: '0' }), purchase_date: '2000-01-01' })).toMatch(/อย่างน้อย 1 บาท/);
    expect(faValidate({ ...A({ cost: '1000', start_date: '1999-01-01' }), purchase_date: '2000-01-01' })).toMatch(/ไม่ก่อนวันที่ซื้อ/);
    expect(faValidate({ ...A({ cost: '1000', rate: '0' }), purchase_date: '2000-01-01' })).toMatch(/อายุการใช้งาน/);
    expect(faValidate({ ...A({ cost: '1000' }), purchase_date: '2000-01-01' })).toBeNull();
  });
});
