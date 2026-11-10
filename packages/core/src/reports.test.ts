import { describe, expect, it } from 'vitest';
import { REPORT_ALIASES, findReport } from './reports.js';

describe('report catalog', () => {
  it('finds a leaf report by code; a group code is not a report', () => {
    expect(findReport('8.1.1')?.menu).toBe('RP.PU');
    expect(findReport('7.1')).toBeNull();
    expect(findReport('9.9.9')).toBeNull();
  });

  it('old code 8.1 (became the group "ประวัติการซื้อ") still opens as 8.1.1 — saved links and user reports keep working', () => {
    expect(REPORT_ALIASES['8.1']).toBe('8.1.1');
    expect(findReport('8.1')).toBe(findReport('8.1.1'));
  });
});
