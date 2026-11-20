import { describe, expect, it } from 'vitest';
import { ACTION_MENUS, PLATFORM_MENUS, flattenMenu, menuForPath, readOnlyExempt } from './menu.js';

describe('read-only viewer menus (HANDOFF 157)', () => {
  it('maps a screen address to its menu (longest route wins, sub-pages included)', () => {
    expect(menuForPath('/sa/invoices')).toBe('SA.IV');
    expect(menuForPath('/sa/invoices/new')).toBe('SA.IV');
    expect(menuForPath('/sa/invoices/1b2c')).toBe('SA.IV');
    expect(menuForPath('/settings/data-tables')).toBe('SET.TBL');
    expect(menuForPath('/companies/new')).toBe('SET.NEWCO');
    expect(menuForPath('/gl/journals/import')).toBe('OT.IMPJNL');
    expect(menuForPath('/gl/journals/9')).toBe('GL.JNL');
    expect(menuForPath('/settings/periods')).toBe('SET.PRD');   // รอบบัญชี (ปิดงวดใช้หน้าเดียวกัน)
    expect(menuForPath('/reports/center')).toBe('RP.CENTER');
    expect(menuForPath('/')).toBeNull();
    expect(menuForPath('/settings/permissions')).toBeNull();
  });
  it('action-only menus exist in the menu; reports and own account are never read-only mode', () => {
    const codes = new Set(flattenMenu().map((m) => m.code));
    for (const c of ACTION_MENUS) expect(codes.has(c)).toBe(true);
    for (const c of PLATFORM_MENUS) expect(codes.has(c)).toBe(true);
    expect(readOnlyExempt('RP.TB')).toBe(true);
    expect(readOnlyExempt('OT.PASS')).toBe(true);
    expect(readOnlyExempt('SET.TBL')).toBe(false);
    expect(readOnlyExempt('SA.IV')).toBe(false);
  });
});
