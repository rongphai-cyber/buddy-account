import { describe, expect, it } from 'vitest';
import { flattenMenu, inheritMenuRows, MENU_INHERITS, menuOffBy, MODULE_SWITCHES, offMenus } from './menu.js';

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

describe('menu split keeps rights (HANDOFF ข้อ 91)', () => {
  it('copies FI.AR.OB rows to FI.AR.DOB only when the set has no FI.AR.DOB row', () => {
    expect(MENU_INHERITS['FI.AR.DOB']).toBe('FI.AR.OB');
    let n = 0;
    const id = () => `new${++n}`;
    const old = [{ id: 'a', _menu_code: 'FI.AR.OB', subject_id: 'g1', can_add: 'Y' }, { id: 'b', _menu_code: 'FI.AR.OB', subject_id: 'g2', can_add: 'N' }, { id: 'c', _menu_code: 'SA.IV', subject_id: 'g1', can_add: 'Y' }];
    expect(inheritMenuRows(old, id).slice(3)).toEqual([{ id: 'new1', _menu_code: 'FI.AR.DOB', subject_id: 'g1', can_add: 'Y' }, { id: 'new2', _menu_code: 'FI.AR.DOB', subject_id: 'g2', can_add: 'N' }]);
    const already = [...old, { id: 'd', _menu_code: 'FI.AR.DOB', subject_id: 'g1', can_add: 'N' }];
    expect(inheritMenuRows(already, id)).toEqual(already);
  });
});
