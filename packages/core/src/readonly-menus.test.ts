import { describe, expect, it } from 'vitest';
import { ACTION_MENUS, ADMIN_MENUS, PLATFORM_MENUS, adminOnlyMenu, flattenMenu, menuForPath, providerOnly, readOnlyExempt } from './menu.js';

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
  it('provider-only menus (HANDOFF 199 → 204): the provider console group, found from their screen address; API keys moved to a per-customer switch', () => {
    expect([...PLATFORM_MENUS].sort()).toEqual(['PV', 'PV.ACT', 'PV.CUS', 'SET.PKG', 'SET.TENANT', 'SET.USAGE']);
    expect(['/provider', '/settings/usage', '/admin/tenants', '/admin/packages', '/provider/actions'].map((p) => providerOnly(menuForPath(p) ?? ''))).toEqual([true, true, true, true, true]);
    // ทุกเมนูผู้ให้บริการอยู่ในกลุ่ม ศูนย์ผู้ให้บริการ (PV)
    expect(flattenMenu().filter((m) => PLATFORM_MENUS.has(m.code) && m.code !== 'PV').every((m) => m.parent === 'PV')).toBe(true);
    expect(['SET.API', 'SET.SEC', 'SET.NEWCO', 'SET.YEARFIX', 'SET.DEVICE', 'OT.BACKUP', 'SA.IV'].some(providerOnly)).toBe(false);
  });
  it('admin-only menus (HANDOFF 201): company list/delete is its own menu, hidden from staff; year-fix stays faded', () => {
    const codes = new Set(flattenMenu().map((m) => m.code));
    for (const c of Object.keys(ADMIN_MENUS)) { expect(codes.has(c)).toBe(true); expect(PLATFORM_MENUS.has(c)).toBe(false); }
    expect(menuForPath('/settings/companies')).toBe('SET.COS');
    expect(menuForPath('/settings/company')).toBe('SET.CO');
    expect([adminOnlyMenu('SET.COS'), adminOnlyMenu('SET.YEARFIX'), adminOnlyMenu('SET.CO')]).toEqual(['hide', 'fade', null]);
    // HANDOFF 207: customer view of provider actions = admin only, not a provider menu
    expect([menuForPath('/settings/provider-actions'), adminOnlyMenu('SET.PVLOG'), providerOnly('SET.PVLOG')]).toEqual(['SET.PVLOG', 'hide', false]);
  });
});
