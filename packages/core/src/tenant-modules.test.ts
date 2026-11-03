import { describe, it, expect } from 'vitest';
import { isTenantModuleKey, tenantModuleStatus } from './tenant-modules.js';

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
});
