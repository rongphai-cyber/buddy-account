import { describe, it, expect } from 'vitest';
import { PDPA_REGISTER, PDPA_COLUMN_PATTERN, pdpaCanFullErase, pdpaPurgeAfter, pdpaRetainUntil, RETENTION_TERMS, RETENTION_TERMS_EN, TENANT_RETENTION_DAYS, tenantBlockedMessage, tenantCountdown, tenantCountingDown } from './pdpa.js';

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
  it('purges 30 days after the end of service or non-payment suspension (HANDOFF 186, one constant)', () => {
    expect(TENANT_RETENTION_DAYS).toBe(30);
    expect(pdpaPurgeAfter('2026-11-25')).toBe('2026-12-25');
    expect(pdpaPurgeAfter('2026-12-01', 31)).toBe('2027-01-01');
    expect(RETENTION_TERMS.join(' ')).toContain(`${TENANT_RETENTION_DAYS} วัน`);
    expect(RETENTION_TERMS.join(' ')).toMatch(/กู้คืนไม่ได้.*5 ปี/);
    // ฉบับอังกฤษครบทุกเงื่อนไข (HANDOFF 188)
    expect(RETENTION_TERMS_EN).toHaveLength(RETENTION_TERMS.length);
    expect(RETENTION_TERMS_EN.join(' ')).toContain(`${TENANT_RETENTION_DAYS} days`);
    expect(RETENTION_TERMS_EN.join(' ')).toMatch(/suspended.*permanently deleted.*cannot be recovered.*Accounting Act B\.E\. 2543.*5 years/);
  });
  it('countdown: unpaid suspension and termination start 30 days, active or other suspension cancel, no extension', () => {
    const A = { status: 'A', terminated_on: null, purge_after: null };
    const today = '2026-11-25';
    // ระงับ — ค้างชำระ: เริ่มนับ
    expect(tenantCountdown({ status: 'S', suspend_reason: 'UNPAID' }, A, today)).toEqual({ terminated_on: null, purge_after: '2026-12-25' });
    // ระงับเหตุอื่น: ไม่นับ
    expect(tenantCountdown({ status: 'S', suspend_reason: 'OTHER' }, A, today)).toEqual({ terminated_on: null, purge_after: null });
    expect(tenantCountdown({ status: 'S' }, A, today)).toEqual({ terminated_on: null, purge_after: null });
    // เลิกใช้: เริ่มนับ
    expect(tenantCountdown({ status: 'I' }, A, today)).toEqual({ terminated_on: today, purge_after: '2026-12-25' });
    // ค้างชำระอยู่แล้ว → บันทึกซ้ำ / เปลี่ยนเป็นเลิกใช้ = วันเดิม (ไม่ยืด)
    const unpaid = { status: 'S', suspend_reason: 'UNPAID', terminated_on: null, purge_after: '2026-12-10' };
    expect(tenantCountdown({ status: 'S', suspend_reason: 'UNPAID' }, unpaid, today).purge_after).toBe('2026-12-10');
    expect(tenantCountdown({ status: 'I' }, unpaid, today)).toEqual({ terminated_on: today, purge_after: '2026-12-10' });
    // เลิกใช้อยู่แล้ว: คงวันเลิกใช้/วันลบเดิม
    const ended = { status: 'I', terminated_on: '2026-11-01', purge_after: '2026-12-01' };
    expect(tenantCountdown({ status: 'I' }, ended, today)).toEqual({ terminated_on: '2026-11-01', purge_after: '2026-12-01' });
    // ชำระแล้ว / กลับมาใช้ = ยกเลิก · ระงับเหตุอื่นหลังค้างชำระ = ยกเลิกการนับ
    expect(tenantCountdown({ status: 'A' }, unpaid, today)).toEqual({ terminated_on: null, purge_after: null });
    expect(tenantCountdown({ status: 'S', suspend_reason: 'OTHER' }, unpaid, today)).toEqual({ terminated_on: null, purge_after: null });
    expect([tenantCountingDown(unpaid), tenantCountingDown(ended), tenantCountingDown({ ...unpaid, suspend_reason: 'OTHER' })]).toEqual([true, true, false]);
  });
  it('blocked sign-in message tells the deletion date and what to do', () => {
    expect(tenantBlockedMessage({ status: 'S', suspend_reason: 'UNPAID', purge_after: '2026-12-25' })).toBe('บัญชีผู้ใช้บริการนี้ถูกระงับ (ค้างชำระค่าบริการ) — ข้อมูลจะถูกลบถาวรวันที่ 25/12/2569 · ติดต่อผู้ให้บริการเพื่อชำระเงิน หรือขอสำเนาข้อมูลก่อนวันนั้น');
    expect(tenantBlockedMessage({ status: 'I', purge_after: '2026-12-25' })).toMatch(/^บัญชีผู้ใช้บริการนี้เลิกใช้บริการแล้ว — ข้อมูลจะถูกลบถาวรวันที่ 25\/12\/2569/);
    expect(tenantBlockedMessage({ status: 'S', suspend_reason: 'OTHER', purge_after: null })).toBe('บัญชีผู้ใช้บริการนี้ถูกระงับ — กรุณาติดต่อผู้ให้บริการ');
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
