import { describe, expect, it } from 'vitest';
import { LIVING_ACCOUNTS, LIVING_DOC_TYPES, LIVING_ITEMS, nextChildAccountNo } from './living-setup.js';
import { fitsMask } from './items.js';

describe('ตั้งค่าสำหรับ WTS-Living: เลขบัญชีย่อยถัดไป', () => {
  it('follows the siblings: last non-zero digit of the highest sibling', () => {
    expect(nextChildAccountNo('4300-00', ['4300-01', '4300-06', '4300-03'], new Set())).toBe('4300-07');
    expect(nextChildAccountNo('4200-00', ['4200-10', '4200-20', '4200-50'], new Set())).toBe('4200-60');
    expect(nextChildAccountNo('3000-00', ['3100-00', '3200-00', '3300-00'], new Set())).toBe('3400-00');
    expect(nextChildAccountNo('2135-00', ['2135-01', '2135-02', '2135-03'], new Set())).toBe('2135-04');
  });
  it('skips numbers already used anywhere in the chart, and the first child is …1', () => {
    expect(nextChildAccountNo('3000-00', ['3100-00', '3200-00', '3300-00'], new Set(['3400-00']))).toBe('3500-00');
    expect(nextChildAccountNo('2133-00', [], new Set())).toBe('2133-01');
    expect(nextChildAccountNo('2133-00', [], new Set(['2133-01', '2133-02']))).toBe('2133-03');
  });
  it('never leaves the control account: full = null', () => {
    expect(nextChildAccountNo('4300-00', ['4300-99'], new Set())).toBeNull();
    expect(nextChildAccountNo('3000-00', ['3900-00'], new Set())).toBeNull();
    // บัญชีพี่น้องที่ไม่อยู่ใต้บัญชีคุมนี้ (เลขยาวไม่เท่า/ขึ้นต้นต่าง) ไม่นับ
    expect(nextChildAccountNo('4300-00', ['43000-01', '5300-09'], new Set())).toBe('4300-01');
  });
  it('agreed codes fit the standard masks and every Living charge kind has one income code', () => {
    for (const it of LIVING_ITEMS) expect(fitsMask('99-!!!!-!!!!!!', it.code).ok, it.code).toBe(true);
    const kinds = LIVING_ITEMS.flatMap((x) => x.charges).sort();
    expect(kinds).toEqual(['advance', 'common', 'damage', 'elec', 'fixed', 'fund', 'furniture', 'onetime', 'penalty', 'rent', 'water']);
    expect(LIVING_DOC_TYPES.map((t) => `${t.code}:${t.cls}`)).toEqual(['IVL:IV', 'REL:RE', 'AIL:AI', 'RDL:RD', 'ADL:AI']);
    expect(new Set(LIVING_ITEMS.map((x) => x.account)).size).toBeLessThanOrEqual(LIVING_ACCOUNTS.length);
  });
});
