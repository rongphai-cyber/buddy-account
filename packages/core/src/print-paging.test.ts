import { describe, expect, it } from 'vitest';
import { blankRowCount, pageLabel, planPages, shrinkToFit } from './print-paging.js';
import { defaultLayout, normalizeLayout } from './printforms.js';

const rows = (n: number, h = 10) => Array.from({ length: n }, () => ({ h, fill: false }));

describe('print paging (HANDOFF 178)', () => {
  it('short document = one page with every row', () => {
    expect(planPages(rows(2), 200, 60)).toEqual([[0, 1]]);
  });
  it('long document splits rows; the footer stays on the last page with at least one row', () => {
    // 30 rows × 10 = 300 · 100 per page · footer 60 → pages of 10, 10, 6 + last 4 with the footer
    const p = planPages(rows(30), 100, 60);
    expect(p.length).toBe(4);
    expect(p.flat()).toEqual([...Array(30).keys()]);
    expect(p.at(-1)!.length).toBeGreaterThan(0);
    expect(p.at(-1)!.length * 10 + 60).toBeLessThanOrEqual(100);
  });
  it('a full last page moves its last row along with the footer', () => {
    expect(planPages(rows(10), 100, 30)).toEqual([[0, 1, 2, 3, 4, 5, 6, 7, 8], [9]]);
  });
  it('minimum-row fillers only go where there is room on the last page', () => {
    const g = [...rows(3), ...Array.from({ length: 10 }, () => ({ h: 10, fill: true }))];
    expect(planPages(g, 100, 40)).toEqual([[0, 1, 2, 3, 4, 5]]);
  });
  it('blank rows fill the free space between the items and the totals', () => {
    expect([blankRowCount(95, 10), blankRowCount(9, 10), blankRowCount(-5, 10), blankRowCount(100, 0), blankRowCount(99.6, 10), blankRowCount(1e6, 1, 50)]).toEqual([9, 0, 0, 0, 10, 50]);
  });
  it('page labels', () => {
    expect([pageLabel(1, 1), pageLabel(1, 2), pageLabel(2, 2, true)]).toEqual(['', 'หน้า 1/2', 'Page 2 of 2']);
  });
  it('numbers shrink instead of wrapping', () => {
    expect([shrinkToFit(80, 100), shrinkToFit(120, 100), shrinkToFit(300, 100)]).toEqual([1, 0.83, 0.7]);
  });
  it('blank-area option: default per base, kept when saved, unknown values fall back', () => {
    expect(['pro', 'grid', 'half', 'plain', 'cont'].map((b) => defaultLayout('IV', b as never).blank_area)).toEqual(['lines', 'lines', 'lines', 'none', 'none']);
    expect(normalizeLayout('IV', 'pro', { blank_area: 'zebra' }).blank_area).toBe('zebra');
    expect(normalizeLayout('IV', 'pro', { blank_area: 'x' }).blank_area).toBe('lines');
    expect(normalizeLayout('IV', 'plain', {}).blank_area).toBe('none');
  });
  it('unit price and amount columns are wide enough for 7-digit amounts by default', () => {
    const c = defaultLayout('IV', 'pro').columns.filter((x) => x.show);
    const total = c.reduce((s, x) => s + x.width, 0);
    // แผ่น A4 ใช้ได้ 186 มม. ลบช่องว่าง 4 มม. ต่อช่อง — "1,320,500.00" 10pt ≈ 22 มม.
    for (const k of ['price', 'amount']) expect((c.find((x) => x.key === k)!.width / total) * 186 - 4).toBeGreaterThanOrEqual(19);
  });
});
