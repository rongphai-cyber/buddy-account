import { describe, expect, it } from 'vitest';
import { composeAddrEn, composeAddrLines, composeAddrTh, geoAmphurs, geoByPostcode, geoFromPostcode, geoLookup, geoProvinces, geoTambons, parseAddrText } from './geo-th.js';

describe('ท้องที่และรหัสไปรษณีย์ (docs/18 ข้อ 12)', () => {
  it('official list: 77 provinces, districts and subdistricts sorted in Thai', () => {
    expect(geoProvinces()).toHaveLength(77);
    expect(geoProvinces().find((p) => p.code === '500000')).toMatchObject({ th: 'เชียงใหม่', en: 'Chiang Mai' });
    expect(geoAmphurs('500000').map((a) => a.th)).toContain('หางดง');
    expect(geoTambons('501500').map((t) => t.th)).toContain('สันผักหวาน');
    expect(geoLookup('501508')).toMatchObject({ tamb: { th: 'สันผักหวาน' }, amph: { th: 'หางดง' }, prov: { th: 'เชียงใหม่' }, zip: '50230' });
    expect(geoLookup('501500')).toBeNull(); // รหัสอำเภอ ไม่ใช่ตำบล
    expect(geoLookup('999999')).toBeNull();
  });

  it('owner example 50230: fills เชียงใหม่ · อ.หางดง and lists only that postcode\'s subdistricts (incl. สันผักหวาน)', () => {
    const r = geoFromPostcode('50230');
    expect(r.found).toBe(true);
    expect(r.prov).toBe('500000');
    expect(r.amph).toBe('501500');
    expect(r.tamb).toBe(''); // หลายตำบล ต้องให้เลือก
    expect(r.choices.length).toBeGreaterThan(1);
    expect(r.choices.every((c) => c.amph.code === '501500' && c.zip === '50230')).toBe(true);
    expect(r.choices.map((c) => c.tamb.th)).toContain('สันผักหวาน');
  });

  it('a postcode with a single subdistrict fills everything; unknown or malformed codes find nothing', () => {
    const single = geoByPostcode('10550');
    expect(single).toHaveLength(1);
    const r = geoFromPostcode('10550');
    expect(r).toMatchObject({ found: true, tamb: single[0]!.tamb.code, amph: single[0]!.amph.code, prov: single[0]!.prov.code, choices: [] });
    expect(geoFromPostcode('99999')).toMatchObject({ found: false, prov: '', amph: '', tamb: '' });
    expect(geoFromPostcode('5023')).toMatchObject({ found: false });
    expect(geoFromPostcode('')).toMatchObject({ found: false });
  });

  it('a postcode spanning several districts fills the province only', () => {
    const r = geoFromPostcode('10110'); // คลองเตย/วัฒนา
    expect(r.found).toBe(true);
    expect(r.prov).toBe('100000');
    expect(new Set(r.choices.map((c) => c.amph.code)).size).toBeGreaterThan(1);
    expect(r.amph).toBe('');
  });

  it('composes Thai (provinces vs Bangkok), Express 3-line and official English addresses', () => {
    const a = { addr_no: '99/1', addr_moo: '5', addr_village: 'สวนทอง', addr_soi: '3', addr_road: 'เชียงใหม่-ฮอด', addr_geo_code: '501508', zip_code: '50230' };
    expect(composeAddrTh(a)).toBe('99/1 หมู่ 5 หมู่บ้านสวนทอง ซอย 3 ถนนเชียงใหม่-ฮอด ตำบลสันผักหวาน อำเภอหางดง จังหวัดเชียงใหม่ 50230');
    expect(composeAddrLines(a)).toEqual(['99/1 หมู่ 5 หมู่บ้านสวนทอง ซอย 3 ถนนเชียงใหม่-ฮอด', 'ตำบลสันผักหวาน อำเภอหางดง', 'จังหวัดเชียงใหม่']);
    expect(composeAddrEn(a)).toBe('99/1 Moo 5, San Phak Wan Subdistrict, Hang Dong District, Chiang Mai 50230');
    expect(composeAddrTh({ addr_no: '1', addr_geo_code: '100101', zip_code: '10200' })).toBe('1 แขวงพระบรมมหาราชวัง เขตพระนคร กรุงเทพมหานคร 10200');
    expect(composeAddrTh({ addr_no: '1', addr_geo_code: geoByPostcode('10550')[0]!.tamb.code, zip_code: '10550' })).toMatch(/ตำบล.+ อำเภอ.+ จังหวัดสมุทรปราการ 10550$/);
  });

  it('parses an old free-text address without guessing', () => {
    const p = parseAddrText('99/1 หมู่ 5 ต.สันผักหวาน อ.หางดง จ.เชียงใหม่ 50230');
    expect(p).toMatchObject({ addr_no: '99/1', addr_moo: '5', addr_geo_code: '501508', zip_code: '50230' });
    // ชื่อตำบลผิด + รหัสไปรษณีย์หลายตำบล → ได้ถึงอำเภอ ไม่เดาตำบล
    expect(parseAddrText('1 ต.ไม่มีจริง อ.หางดง จ.เชียงใหม่ 50230')).toMatchObject({ addr_geo_code: null, prov_code: '500000', amph_code: '501500' });
    // ไม่มีชื่อเลย แต่รหัสไปรษณีย์ชี้ตำบลเดียว → ใช้รหัสไปรษณีย์ได้
    expect(parseAddrText('12 ถนนสุขุมวิท', '10550').addr_geo_code).toBe(geoByPostcode('10550')[0]!.tamb.code);
  });
});
