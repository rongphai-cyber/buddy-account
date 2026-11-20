import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STARTER_TEMPLATES, isStarterKey, starterData } from './starter-data.js';
import { LOOKUP_SEEDS } from './menu.js';
import { SETTING_BY_KEY } from './settings.js';

const chart = new Set((JSON.parse(readFileSync(new URL('../../../db/seed/chart_template_express.json', import.meta.url), 'utf8')) as { accounts: Array<{ no: string; control: boolean }> })
  .accounts.filter((a) => !a.control).map((a) => a.no));

describe('starter data by business type (HANDOFF 160)', () => {
  it('has the four templates; blank adds nothing', () => {
    expect(STARTER_TEMPLATES.map((t) => t.key)).toEqual(['TRADE', 'SERVICE', 'MFG', 'BLANK']);
    expect(starterData('BLANK')).toBeNull();
    expect([isStarterKey('MFG'), isStarterKey('X'), isStarterKey(undefined)]).toEqual([true, false, false]);
  });
  for (const t of ['TRADE', 'SERVICE', 'MFG'] as const) {
    it(`${t}: codes unique and within column limits, accounts are postable accounts of the standard chart, settings are known`, () => {
      const d = starterData(t)!;
      for (const rows of [d.units, d.warehouses, d.banks, d.departments, d.itemGroups, d.assetGroups]) {
        expect(new Set(rows.map((r) => r.code)).size).toBe(rows.length);
        for (const r of rows) { expect(r.code.length).toBeLessThanOrEqual(10); expect(r.th.length).toBeLessThanOrEqual(120); expect(r.en.length).toBeLessThanOrEqual(120); }
      }
      for (const g of d.lookups) {
        expect(new Set(g.rows.map((r) => r.code)).size).toBe(g.rows.length);
        expect(LOOKUP_SEEDS[g.type]).toBeUndefined();   // ตาราง 70–76 ใส่ให้ทุกบริษัทอยู่แล้ว
      }
      expect(new Set(d.lookups.map((g) => g.type)).size).toBe(d.lookups.length);
      expect(new Set(d.paymentMethods.map((m) => `${m.direction}${m.code}`)).size).toBe(d.paymentMethods.length);
      const accounts = [...d.itemGroups.flatMap((g) => [g.inventory, g.cogs, g.sales, g.sales_return, g.purchase, g.purchase_return]), ...d.assetGroups.flatMap((g) => [g.asset, g.expense, g.accum]), ...d.paymentMethods.map((m) => m.account)]
        .filter((x): x is string => !!x);
      expect(accounts.filter((a) => !chart.has(a))).toEqual([]);
      for (const k of Object.keys(d.settings)) expect(SETTING_BY_KEY.has(k)).toBe(true);
      expect(d.warehouses.some((w) => w.code === d.settings['ic.main_warehouse'])).toBe(true);
    });
  }
  it('owner decisions: service VAT on cash basis (D1), manufacturing main warehouse = finished goods 03 (D2)', () => {
    expect(starterData('SERVICE')!.settings['ar.service_vat_basis']).toBe('2');
    expect(starterData('MFG')!.settings['ic.main_warehouse']).toBe('03');
    expect(starterData('MFG')!.warehouses.find((w) => w.code === '03')!.th).toBe('คลังสินค้าสำเร็จรูป');
  });
});
