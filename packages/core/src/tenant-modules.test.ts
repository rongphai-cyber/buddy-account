import { describe, it, expect } from 'vitest';
import { hubOnly, isTenantModuleKey, normalizeAppAccess, sourceSystemLabel, tenantModuleStatus, userCanOpen } from './tenant-modules.js';

describe('สิทธิ์โมดูลระดับลูกค้า (docs/17 B0.6)', () => {
  it('defaults: buddy on, others off', () => {
    const s = tenantModuleStatus([], '2026-11-03');
    expect(s.map((x) => `${x.key}:${x.active}`)).toEqual(['buddy:true', 'pos:false', 'living:false', 'hr:false', 'hotel:false', 'spa:false']);
  });
  it('rows override defaults; valid_to is inclusive; disabled buddy is off', () => {
    const rows = [{ module_key: 'pos', enabled: true, valid_to: '2026-11-03', seats: 3 }, { module_key: 'buddy', enabled: false, valid_to: null, seats: null }, { module_key: 'hr', enabled: true, valid_to: '2026-11-02', seats: null }];
    const s = Object.fromEntries(tenantModuleStatus(rows, '2026-11-03').map((x) => [x.key, x]));
    expect([s.pos!.active, s.pos!.seats, s.buddy!.active, s.hr!.active, s.hr!.expired]).toEqual([true, 3, false, false, true]);
    expect(tenantModuleStatus(rows, '2026-11-04').find((x) => x.key === 'pos')!.active).toBe(false);
  });
  it('knows the module keys', () => {
    expect([isTenantModuleKey('pos'), isTenantModuleKey('erp')]).toEqual([true, false]);
  });
  it('user app access (09/11/2569): null = all of the tenant; list = only those; admin always; no buddy = hub only', () => {
    expect(normalizeAppAccess(null)).toBeNull();
    expect(normalizeAppAccess(undefined)).toBeNull();
    expect(normalizeAppAccess({})).toBeNull();
    expect(normalizeAppAccess(['living', 'pos', 'bogus', 'pos'])).toEqual(['pos', 'living']);
    expect(normalizeAppAccess('["hr","buddy"]')).toEqual(['buddy', 'hr']);
    expect(normalizeAppAccess('not json')).toBeNull();
    expect(normalizeAppAccess([])).toEqual([]);
    expect([userCanOpen(null, 'pos'), userCanOpen(['buddy'], 'pos'), userCanOpen(['buddy'], 'pos', true), userCanOpen([], 'buddy')]).toEqual([true, false, true, false]);
    expect([hubOnly(null), hubOnly(['pos']), hubOnly(['pos'], true), hubOnly(['buddy', 'pos'])]).toEqual([false, true, false, false]);
    expect([sourceSystemLabel('wts-sop'), sourceSystemLabel('WTS-SOP'), sourceSystemLabel('wts-pos'), sourceSystemLabel('wts-living')]).toEqual(['WTS-HR', 'WTS-HR', 'WTS-POS', 'WTS-LIVING']);
  });
});
