import { describe, expect, it } from 'vitest';
import { flattenMenu, menuOffBy, MODULE_SWITCHES, offMenus } from './menu.js';

describe('ปิดบางระบบทั้งบริษัท', () => {
  it('switches refer to real menus and never to accounting/setup or item masters', () => {
    const codes = new Set(flattenMenu().map((m) => m.code));
    expect(new Set(MODULE_SWITCHES.map((m) => m.key)).size).toBe(MODULE_SWITCHES.length);
    for (const m of MODULE_SWITCHES) for (const x of m.menus) expect([m.key, x, codes.has(x)]).toEqual([m.key, x, true]);
    const all = MODULE_SWITCHES.map((m) => m.key);
    for (const keep of ['GL', 'GL.JNL', 'GL.ACC', 'RP.TB', 'RP.FS', 'SET.CO', 'SET.SEC', 'IC.ITEM', 'IC.SRV', 'OT.LOG', 'FI.VAT.IN', 'FI.WHT']) expect([keep, menuOffBy(keep, all)]).toEqual([keep, null]);
  });

  it('resolves a menu through its group; unknown keys are ignored', () => {
    expect(menuOffBy('FI.AP.PS', ['PU'])?.key).toBe('PU');
    expect(menuOffBy('PU.RR', ['PU'])?.key).toBe('PU');
    expect(menuOffBy('SA.IV', ['PU'])).toBeNull();
    expect(menuOffBy('FI.BK.CR', ['BANK'])?.label).toBe('ระบบธนาคารและเช็ค');
    expect(menuOffBy('SA.QT', ['ORDER'])?.key).toBe('ORDER');
    expect(menuOffBy('SA.IV', ['ORDER'])).toBeNull();
    expect(menuOffBy('IC.STOCK', ['STOCK'])?.key).toBe('STOCK');
    expect(menuOffBy('IC.ITEM', ['STOCK'])).toBeNull();
    expect(menuOffBy('PU.RR', ['NOPE', 7])).toBeNull();
    expect(menuOffBy('PU.RR', null)).toBeNull();
    expect([...offMenus(['FA', 'X'])]).toEqual(['FA.ASSET', 'FA.DEPR']);
  });
});
