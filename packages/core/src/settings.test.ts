import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SETTING_DEFS, SETTING_BY_KEY, SETTING_SECTIONS, normalizeSetting, validateSetting, voucherNoPattern } from './settings.js';

describe('settings catalogue (คู่มือบทที่ 5)', () => {
  it('covers the seven single-record screens with unique keys', () => {
    expect(SETTING_SECTIONS.map((s) => s.screen)).toEqual(['S-SET-02', 'S-SET-03', 'S-SET-05', 'S-SET-07', 'S-SET-09', 'S-SET-10', 'S-SET-11']);
    expect(new Set(SETTING_DEFS.map((d) => d.key)).size).toBe(SETTING_DEFS.length);
    // ค่าเริ่มต้นของทุกข้อต้องผ่านการตรวจของตัวเอง
    for (const d of SETTING_DEFS) expect([d.key, validateSetting(d, normalizeSetting(d, undefined))]).toEqual([d.key, null]);
  });

  it('validates values with Thai messages', () => {
    const v = (k: string, x: unknown) => validateSetting(SETTING_BY_KEY.get(k)!, x);
    expect(v('gen.vat_rate', 7)).toBeNull();
    expect(v('gen.vat_rate', 40)).toMatch(/ระหว่าง 0 ถึง 30/);
    expect(v('ic.allow_negative', 'X')).toMatch(/เลือกจากรายการ/);
    expect(v('gen.approve_level', null)).toBeNull();
    expect(v('gen.approve_level', 10)).toMatch(/0–9/);
    expect(v('ar.aging_overdue', [7, 15, 30])).toBeNull();
    expect(v('ar.aging_overdue', [15, 7, 30])).toMatch(/มากกว่าช่วงก่อนหน้า/);
    expect(v('ar.credit_tiers', [{ amount: 20000, level: 0 }, { amount: 50000, level: 5 }])).toBeNull();
    expect(v('ar.credit_tiers', [{ amount: 50000, level: 0 }, { amount: 20000, level: 5 }])).toMatch(/มากกว่าระดับ 1/);
    expect(v('ic.udf', { str1: { use: true, th: '' } })).toMatch(/ต้องมีชื่อภาษาไทย/);
    expect(v('gl.account_mask', 'abc')).toMatch(/9 X !/);
    // ค่าเดิมแบบ bool ของข้อ Y/N/A
    expect(normalizeSetting(SETTING_BY_KEY.get('ic.allow_negative')!, true)).toBe('Y');
    expect(normalizeSetting(SETTING_BY_KEY.get('tax.input_vat_prorate')!, false)).toBe('N');
  });

  it('numbers vouchers per the five styles (manual example 30/06/43)', () => {
    const at = '2000-06-30';   // 30/06/2543
    expect(voucherNoPattern('1', '', at)).toEqual({ base: '30630', width: 2 });     // 3063001
    expect(voucherNoPattern('2', '', at)).toEqual({ base: '306', width: 4 });       // 3060001
    expect(voucherNoPattern('3', 'JV', at)).toEqual({ base: 'JV4306', width: 4 });  // JV43060001
    expect(voucherNoPattern('4', 'JV', at)).toEqual({ base: 'JV430630', width: 3 });
    expect(voucherNoPattern('M', 'JV', at)).toEqual({ base: 'JV4306', width: 4 });  // ค่าเดิม M = แบบ 3
    expect(voucherNoPattern('0', 'JV', at)).toBeNull();
    expect(voucherNoPattern('4', 'JV', at, 'C')).toEqual({ base: 'JV000630', width: 3 });
  });

  it('matches the JSON copy used by the Express importer', () => {
    const json = JSON.parse(readFileSync(new URL('../../../tools/express-import/settings_catalog.json', import.meta.url), 'utf8'));
    expect(json).toEqual(SETTING_DEFS.filter((d) => d.from).map((d) => ({ key: d.key, module: d.module, from: d.from })));
  });
});
