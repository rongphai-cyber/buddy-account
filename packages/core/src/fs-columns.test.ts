import { describe, expect, it } from 'vitest';
import { d } from './money.js';
import { fsColumnHead, parseFsColumnKind, runFsLayout, type FsLine } from './fs-layout.js';
import { staleOpenYears } from './work-year.js';

describe('fs column kinds (HANDOFF 176: 3-year comparatives)', () => {
  it('parses current / last year / two years ago / budget columns', () => {
    expect(parseFsColumnKind('BAL')).toEqual({ range: 'YTD', lag: 0, bud: false });
    expect(parseFsColumnKind('bal ly')).toEqual({ range: 'YTD', lag: 1, bud: false });
    expect(parseFsColumnKind('BAL LY2')).toEqual({ range: 'YTD', lag: 2, bud: false });
    expect(parseFsColumnKind('BAL  LY 2')).toEqual({ range: 'YTD', lag: 2, bud: false });
    expect(parseFsColumnKind('PTD LY2')).toEqual({ range: 'PTD', lag: 2, bud: false });
    expect(parseFsColumnKind('PTD3 LY2')).toEqual({ range: 'P3', lag: 2, bud: false });
    expect(parseFsColumnKind('PTD12 LY')).toEqual({ range: 'P12', lag: 1, bud: false });
    expect(parseFsColumnKind('PTD BUD')).toEqual({ range: 'PTD', lag: 0, bud: true });
    expect(parseFsColumnKind('PTD13')).toBeNull();
    expect(parseFsColumnKind('XYZ')).toBeNull();
  });
  it('default heads name the year', () => {
    expect(['BAL', 'BAL LY', 'BAL LY2', 'bal ly 2', 'PTD LY2', 'PTD4 LY2', 'PTD4 LY', 'PTD4'].map(fsColumnHead))
      .toEqual(['ยอดสะสม', 'ปีที่แล้ว', '2 ปีก่อน', '2 ปีก่อน', 'งวดเดียวกัน 2 ปีก่อน', 'งวดที่ 4 2 ปีก่อน', 'งวดที่ 4 ปีที่แล้ว', 'งวดที่ 4']);
  });
  it('runs a layout with three year columns and a change formula', () => {
    const lines: FsLine[] = [{ line_no: 10, data_type: 'A/C', source: '1100', sign_filter: null, print_condition: null, accumulate: null, description_th: 'เงินสด', description_en: null }];
    const vals: Record<string, string | null> = { BAL: '300', 'BAL LY': '200', 'BAL LY2': null };
    const r = runFsLayout(lines, [{ expr: 'BAL' }, { expr: 'BAL LY' }, { expr: 'BAL LY2' }, { expr: '(C1-C2)*100/C2' }], {
      accountExists: () => true,
      value: (k) => { const v = vals[k]; return v === null || v === undefined ? null : d(v); },
    });
    expect(r.rows[0]).toMatchObject({ kind: 'value', values: ['300.00', '200.00', null, '50.00'] });
  });
});

describe('open-years warning', () => {
  const y = (code: string, start: string, status: string) => ({ code, start_date: `${start}-01-01`, end_date: `${start}-12-31`, status });
  it('names the oldest open years when more than 3 are open', () => {
    expect(staleOpenYears([y('2565', '2022', 'C'), y('2566', '2023', 'O'), y('2567', '2024', 'O'), y('2568', '2025', 'O')])).toEqual([]);
    expect(staleOpenYears([y('2569', '2026', 'O'), y('2565', '2022', 'O'), y('2566', '2023', 'O'), y('2567', '2024', 'O'), y('2568', '2025', 'O')]).map((x) => x.code)).toEqual(['2565', '2566']);
    expect(staleOpenYears(null)).toEqual([]);
  });
});
