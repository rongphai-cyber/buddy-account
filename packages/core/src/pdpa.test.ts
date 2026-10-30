import { describe, it, expect } from 'vitest';
import { PDPA_REGISTER, PDPA_COLUMN_PATTERN, pdpaCanFullErase, pdpaPurgeAfter, pdpaRetainUntil } from './pdpa.js';

describe('PDPA (T0.17)', () => {
  it('keeps documents 5 years after the fiscal year end of the last document', () => {
    expect(pdpaRetainUntil('2569-03-15', '2569-12-31')).toBe('2574-12-31');
    expect(pdpaRetainUntil('2024-07-01', '2025-03-31')).toBe('2030-03-31');   // ปีบัญชีไม่ตรงปีปฏิทิน
    expect(pdpaRetainUntil('2024-07-01')).toBe('2029-12-31');                 // ไม่รู้ปีบัญชี
    expect(pdpaRetainUntil('2024-07-01', '2024-02-29')).toBe('2029-12-31');   // ปีบัญชีก่อนวันเอกสาร = ไม่ใช้
    expect(pdpaRetainUntil('2023-11-01', '2024-02-29')).toBe('2029-02-28');   // 29 ก.พ. ปีที่ไม่มี
    expect(pdpaRetainUntil(null)).toBeNull();
  });
  it('allows full erase only after retention', () => {
    expect(pdpaCanFullErase('2029-12-31', '2029-12-31')).toBe(false);
    expect(pdpaCanFullErase('2030-01-01', '2029-12-31')).toBe(true);
    expect(pdpaCanFullErase('2026-01-01', null)).toBe(true);
  });
  it('purges 90 days after the end of service', () => {
    expect(pdpaPurgeAfter('2026-10-30')).toBe('2027-01-28');
    expect(pdpaPurgeAfter('2026-12-01', 31)).toBe('2027-01-01');
  });
  it('register lists each column once and matches the personal-data pattern where expected', () => {
    const seen = new Set<string>();
    for (const e of PDPA_REGISTER) for (const c of e.columns) {
      const k = `${e.table}.${c}`;
      expect(seen.has(k), k).toBe(false);
      seen.add(k);
    }
    for (const c of ['phone', 'email', 'tax_id', 'address_1', 'party_address', 'payee_name', 'ip_address', 'contact_email']) expect(PDPA_COLUMN_PATTERN.test(c), c).toBe(true);
    for (const c of ['name_th', 'code', 'doc_no', 'amount']) expect(PDPA_COLUMN_PATTERN.test(c), c).toBe(false);
  });
});
