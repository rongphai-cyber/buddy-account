import { describe, expect, it } from 'vitest';
import { compareBy, nextSort, sortRows, type SortCol } from './list-sort.js';

type R = { no: string; date: string | null; amt: string | null; name: string; st: string };
const rows: R[] = [
  { no: 'IV6901010', date: '2026-01-15', amt: '1000.00', name: 'ไก่ทอง', st: 'N' },
  { no: 'IV6901002', date: '2026-02-01', amt: '9.50', name: 'เอกชัย', st: 'N' },
  { no: 'IV690103', date: null, amt: null, name: 'กมล', st: 'C' },
  { no: 'IV6901001', date: '2026-01-01', amt: '100.00', name: 'ขวัญใจ', st: 'N' },
  { no: 'IV6901004', date: '2026-01-01', amt: '20.00', name: 'แก้วตา', st: 'N' },
];
const cols: SortCol<R>[] = [
  { key: 'no', type: 'docno' }, { key: 'date', type: 'date' }, { key: 'amt', type: 'money' }, { key: 'name', type: 'text' },
  { key: 'st', type: 'label', get: (r) => (r.st === 'C' ? 'ยกเลิก' : 'ปกติ') },
];
const by = (k: string, dir: 'asc' | 'desc', f: (r: R) => unknown = (r) => r.no) => sortRows(rows, cols, { k, dir }).map(f);

describe('list sort (HANDOFF 195)', () => {
  it('money compares as Decimal, not text or float; blanks last both ways', () => {
    expect(by('amt', 'asc', (r) => r.amt)).toEqual(['9.50', '20.00', '100.00', '1000.00', null]);
    expect(by('amt', 'desc', (r) => r.amt)).toEqual(['1000.00', '100.00', '20.00', '9.50', null]);
    expect(compareBy('money', '0.10', '0.1')).toBe(0);
    expect(compareBy('money', '-5', '3')).toBe(-1);
    expect(compareBy('money', '12345678901234567.01', '12345678901234567.02')).toBe(-1);
  });
  it('dates by ISO value, equal values keep the original order', () => {
    expect(by('date', 'asc')).toEqual(['IV6901001', 'IV6901004', 'IV6901010', 'IV6901002', 'IV690103']);
    expect(compareBy('date', '2026-01-01T00:00:00.000Z', '2026-01-01')).toBe(0);
  });
  it('document numbers in natural order', () => {
    expect(compareBy('docno', 'IV2', 'IV10')).toBeLessThan(0);
    expect(by('no', 'asc')).toEqual(['IV690103', 'IV6901001', 'IV6901002', 'IV6901004', 'IV6901010']);
  });
  it('Thai text in dictionary order (leading vowels ignored like the Royal Institute dictionary)', () => {
    expect(by('name', 'asc', (r) => r.name)).toEqual(['กมล', 'แก้วตา', 'ขวัญใจ', 'ไก่ทอง', 'เอกชัย'].sort((a, b) => a.localeCompare(b, 'th')));
    expect(compareBy('text', 'แก้วตา', 'ขวัญใจ')).toBeLessThan(0);
  });
  it('status by the label shown', () => {
    expect(by('st', 'asc', (r) => r.st).at(-1)).toBe('C');
    expect(by('st', 'desc', (r) => r.st)[0]).toBe('C');
  });
  it('header click cycles asc → desc → default; unknown column = default order', () => {
    expect(nextSort(null, 'amt')).toEqual({ k: 'amt', dir: 'asc' });
    expect(nextSort({ k: 'amt', dir: 'asc' }, 'amt')).toEqual({ k: 'amt', dir: 'desc' });
    expect(nextSort({ k: 'amt', dir: 'desc' }, 'amt')).toBeNull();
    expect(nextSort({ k: 'amt', dir: 'desc' }, 'no')).toEqual({ k: 'no', dir: 'asc' });
    expect(sortRows(rows, cols, { k: 'nope', dir: 'asc' })).toEqual(rows);
    expect(sortRows(rows, cols, null)).toEqual(rows);
  });
});
