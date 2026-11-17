import { describe, it, expect } from 'vitest';
import { crc32, inflateRawSync } from 'node:zlib';
import { buildXlsxBytes, reportNumber, zipStored } from './xlsx-write.js';
import { xlsxSheetRows } from './trade-import.js';

/** อ่าน zip แบบง่าย (ใช้ central directory) — ตรวจว่าแฟ้มที่สร้างเปิดได้ */
function unzip(b: Uint8Array) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let e = b.length - 22;
  while (v.getUint32(e, true) !== 0x06054b50) e--;
  const n = v.getUint16(e + 10, true);
  let p = v.getUint32(e + 16, true);
  const out = new Map<string, string>();
  const dec = new TextDecoder();
  for (let i = 0; i < n; i++) {
    expect(v.getUint32(p, true)).toBe(0x02014b50);
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true), nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), lo = v.getUint32(p + 42, true);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nl));
    const start = lo + 30 + v.getUint16(lo + 26, true) + v.getUint16(lo + 28, true);
    const raw = b.subarray(start, start + size);
    out.set(name, dec.decode(method === 8 ? inflateRawSync(raw) : raw));
    p += 46 + nl + xl + cl;
  }
  return out;
}

describe('xlsx export (เจ้าของ 17/11/2569 — ทุกรายงานส่งออก Excel)', () => {
  it('report numbers: thousands, parentheses = negative, text stays text', () => {
    expect(reportNumber('1,234.50')).toBe(1234.5);
    expect(reportNumber('(1,234.50)')).toBe(-1234.5);
    expect(reportNumber('-12')).toBe(-12);
    expect(reportNumber('0.00')).toBe(0);
    expect(reportNumber('1111-01')).toBeNull();
    expect(reportNumber('17/11/2569')).toBeNull();
    expect(reportNumber('(1,234.50')).toBeNull();
    expect(reportNumber('PV691117001')).toBeNull();
  });
  it('builds a valid workbook: Thai text, real numbers, bold, merged cells', () => {
    const bytes = buildXlsxBytes([{ name: 'บัญชีแยกประเภท', freeze: 1, rows: [
      [{ v: 'เลขที่บัญชี', bold: true }, { v: 'คำอธิบาย', bold: true }, { v: 'เดบิต', bold: true }],
      ['5430-04', 'ค่าไปรษณีย์ส่งเอกสาร & อื่น <ๆ>', 65],
      [{ v: 'รวม', bold: true, span: 2 }, { v: 1115.5, bold: true }],
    ] }]);
    const z = unzip(bytes);
    expect([...z.keys()]).toEqual(expect.arrayContaining(['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/styles.xml']));
    expect(z.get('xl/workbook.xml')).toContain('name="บัญชีแยกประเภท"');
    const sheet = z.get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain('<c r="C2" s="2"><v>65</v></c>');   // ตัวเลขจริง
    expect(sheet).toContain('<mergeCell ref="A3:B3"/>');
    expect(sheet).toContain('<pane ySplit="1"');
    expect(xlsxSheetRows(sheet, [])).toEqual([['เลขที่บัญชี', 'คำอธิบาย', 'เดบิต'], ['5430-04', 'ค่าไปรษณีย์ส่งเอกสาร & อื่น <ๆ>', '65'], ['รวม', '', '1115.5']]);
  });
  it('zip CRC matches the data (Excel rejects bad CRCs)', () => {
    const b = zipStored([{ name: 'a.txt', data: 'สวัสดี' }]);
    const v = new DataView(b.buffer);
    expect(v.getUint32(14, true)).toBe(crc32(new TextEncoder().encode('สวัสดี')));   // ตรวจกับ crc32 ของ Node
  });
});
