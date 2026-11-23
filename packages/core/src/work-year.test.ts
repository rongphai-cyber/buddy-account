import { describe, expect, it } from 'vitest';
import { fiscalYearLabel, fiscalYearOf, workDateForYear, workRange } from './work-year.js';

const Y = [
  { id: 'a', code: '2568', start_date: '2025-01-01', end_date: '2025-12-31', status: 'O' },
  { id: 'b', code: '2569', start_date: '2026-01-01', end_date: '2026-12-31', status: 'O' },
];
describe('HANDOFF 174: working fiscal year', () => {
  it('list/report ranges default to the fiscal year that contains the working date', () => {
    expect(workRange('2025-12-31', Y)).toEqual({ from: '2025-01-01', to: '2025-12-31' });   // เจ้าของ: วันทำการ 31/12/2025 → ทั้งปี 2025
    expect(workRange('2026-11-23', Y)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    // ปีบัญชีไม่ตรงปีปฏิทิน (เม.ย.–มี.ค.)
    const apr = [{ code: '2569', start_date: '2025-04-01', end_date: '2026-03-31' }];
    expect(workRange('2026-02-10', apr)).toEqual({ from: '2025-04-01', to: '2026-03-31' });
    // ยังไม่เปิดปีบัญชีที่ครอบวันทำการ = ปีปฏิทิน
    expect(workRange('2027-05-05', Y)).toEqual({ from: '2027-01-01', to: '2027-12-31' });
    expect(workRange('2027-05-05', null)).toEqual({ from: '2027-01-01', to: '2027-12-31' });
    expect(fiscalYearOf('2026-01-01', Y)?.id).toBe('b');
  });
  it('picking a year sets the working date: today in the current year, year end for a past year, year start for a future year', () => {
    expect(workDateForYear(Y[0]!, '2026-11-23')).toBe('2025-12-31');
    expect(workDateForYear(Y[1]!, '2026-11-23')).toBe('2026-11-23');
    expect(workDateForYear({ start_date: '2027-01-01', end_date: '2027-12-31' }, '2026-11-23')).toBe('2027-01-01');
  });
  it('label follows the company fiscal-year code, else the year of the end date in the company year system', () => {
    expect(fiscalYearLabel(Y[0]!)).toBe('2568');
    expect(fiscalYearLabel({ start_date: '2025-01-01', end_date: '2025-12-31' }, 'B')).toBe('2568');
    expect(fiscalYearLabel({ start_date: '2025-01-01', end_date: '2025-12-31' }, 'C')).toBe('2025');
  });
});
