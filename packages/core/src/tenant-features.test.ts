import { describe, expect, it } from 'vitest';
import { PLATFORM_MENUS, flattenMenu } from './menu.js';
import { TENANT_MENUS, tenantFeatureStatus, tenantMenusOff } from './tenant-modules.js';

const today = '2026-11-26';
describe('menus opened per customer (HANDOFF 200)', () => {
  it('Express import and branch devices are hidden until opened; the menus exist and are not provider-only', () => {
    const codes = new Set(flattenMenu().map((m) => m.code));
    expect([...TENANT_MENUS].sort()).toEqual(['OT.IMPORT', 'SET.DEVICE']);
    for (const c of TENANT_MENUS) { expect(codes.has(c)).toBe(true); expect(PLATFORM_MENUS.has(c)).toBe(false); }
    expect(tenantMenusOff([], today).sort()).toEqual(['OT.IMPORT', 'SET.DEVICE']);
  });
  it('a provider switch opens a menu until its end date', () => {
    expect(tenantMenusOff([{ module_key: 'express_import', enabled: true, valid_to: null, seats: null }], today)).toEqual(['SET.DEVICE']);
    expect(tenantMenusOff([{ module_key: 'express_import', enabled: true, valid_to: '2026-11-25', seats: null }], today)).toContain('OT.IMPORT');
    expect(tenantMenusOff([{ module_key: 'express_import', enabled: false, valid_to: null, seats: null }], today)).toContain('OT.IMPORT');
  });
  it('branch devices open by themselves with WTS-POS or with already registered devices', () => {
    const pos = [{ module_key: 'pos', enabled: true, valid_to: null, seats: null }];
    expect(tenantMenusOff(pos, today)).toEqual(['OT.IMPORT']);
    expect(tenantFeatureStatus(pos, today).find((f) => f.key === 'devices')).toMatchObject({ enabled: false, active: true, auto: [expect.stringMatching(/WTS-POS/)] });
    expect(tenantMenusOff([{ module_key: 'pos', enabled: true, valid_to: '2026-01-01', seats: null }], today)).toContain('SET.DEVICE');   // POS หมดอายุ
    expect(tenantMenusOff([], today, { hasDevices: true })).toEqual(['OT.IMPORT']);
  });
});
