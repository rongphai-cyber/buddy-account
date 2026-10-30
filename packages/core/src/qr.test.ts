import { describe, it, expect } from 'vitest';
import { qrAlignmentPositions, qrCodewords, qrDataCodewords, qrDataOrder, qrEncode, qrFormatBits, qrFunctionMap, qrRawDataModules, qrVersionBits, rsRemainder, QR_MASKS, type QrMatrix } from './qr.js';

/** ตัวอ่าน QR สำหรับทดสอบ: อ่านข้อมูลรูปแบบ → ถอด mask → อ่านซิกแซก → แยกบล็อก → ตรวจ Reed–Solomon → แปลงโหมดไบต์ */
function readQr(m: QrMatrix, version: number) {
  const size = m.length;
  let fmt = 0;
  for (let i = 14; i >= 9; i--) fmt = (fmt << 1) | (m[8]![14 - i] ? 1 : 0);
  fmt = (fmt << 1) | (m[8]![7] ? 1 : 0);   // บิต 8 (x=7, y=8)
  fmt = (fmt << 1) | (m[8]![8] ? 1 : 0);   // บิต 7
  fmt = (fmt << 1) | (m[7]![8] ? 1 : 0);   // บิต 6 (x=8, y=7)
  for (let i = 5; i >= 0; i--) fmt = (fmt << 1) | (m[i]![8] ? 1 : 0);
  const mask = [...Array(8).keys()].find((k) => qrFormatBits(0, k) === fmt);
  if (mask === undefined) throw new Error('อ่านข้อมูลรูปแบบไม่ได้');
  // สำเนาที่ 2 ต้องตรงกัน
  let fmt2 = 0;
  for (let i = 14; i >= 8; i--) fmt2 = (fmt2 << 1) | (m[size - 15 + i]![8] ? 1 : 0);
  for (let i = 7; i >= 0; i--) fmt2 = (fmt2 << 1) | (m[8]![size - 1 - i] ? 1 : 0);
  if (fmt2 !== fmt) throw new Error('ข้อมูลรูปแบบสองชุดไม่ตรงกัน');
  if (!m[size - 8]![8]) throw new Error('ไม่มีจุดดำคงที่');
  const { isFunction } = qrFunctionMap(version);
  const bits = qrDataOrder(size, isFunction).map(([x, y]) => m[y]![x] !== QR_MASKS[mask]!(x, y));
  const raw = Math.floor(qrRawDataModules(version) / 8);
  const cw: number[] = [];
  for (let i = 0; i < raw * 8; i += 8) cw.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | (b ? 1 : 0), 0));
  // จำนวนบล็อก/ECC จากความต่างของ codeword ทั้งหมดกับข้อมูล
  const blocksM = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5][version]!;
  const ecl = (raw - qrDataCodewords(version)) / blocksM;
  const nShort = blocksM - (raw % blocksM), shortData = Math.floor(raw / blocksM) - ecl;
  const lens = [...Array(blocksM).keys()].map((j) => shortData + (j < nShort ? 0 : 1));
  const data: number[][] = lens.map(() => []), ecc: number[][] = lens.map(() => []);
  let k = 0;
  for (let i = 0; i < shortData + 1; i++) lens.forEach((n, j) => { if (i < n) data[j]!.push(cw[k++]!); });
  for (let i = 0; i < ecl; i++) lens.forEach((_, j) => ecc[j]!.push(cw[k++]!));
  data.forEach((d, j) => { if (JSON.stringify(rsRemainder(d, ecl)) !== JSON.stringify(ecc[j])) throw new Error(`บล็อก ${j} Reed–Solomon ไม่ตรง`); });
  const all = data.flat();
  const bs = all.flatMap((b) => [7, 6, 5, 4, 3, 2, 1, 0].map((i) => (b >>> i) & 1));
  const take = (n: number) => bs.splice(0, n).reduce((a, b) => (a << 1) | b, 0);
  if (take(4) !== 0b0100) throw new Error('ไม่ใช่โหมดไบต์');
  const len = take(version < 10 ? 8 : 16);
  return { mask, text: new TextDecoder().decode(new Uint8Array([...Array(len)].map(() => take(8)))) };
}

describe('QR code (2FA setup)', () => {
  it('Reed–Solomon matches the published "HELLO WORLD" 1-Q example', () => {
    expect(rsRemainder([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236], 13)).toEqual([168, 72, 22, 82, 217, 54, 156, 0, 46, 15, 180, 122, 16]);
  });
  it('format and version information match the standard tables', () => {
    expect(qrFormatBits(1, 0).toString(2).padStart(15, '0')).toBe('111011111000100');   // L mask 0
    expect(qrFormatBits(0, 0).toString(2).padStart(15, '0')).toBe('101010000010010');   // M mask 0
    expect(qrFormatBits(3, 0).toString(2).padStart(15, '0')).toBe('011010101011111');   // Q mask 0
    expect(qrFormatBits(2, 0).toString(2).padStart(15, '0')).toBe('001011010001001');   // H mask 0
    expect(qrVersionBits(7).toString(2).padStart(18, '0')).toBe('000111110010010100');
  });
  it('capacity and alignment tables for versions 1–10 (level M)', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => Math.floor(qrRawDataModules(v) / 8))).toEqual([26, 44, 70, 100, 134, 172, 196, 242, 292, 346]);
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(qrDataCodewords)).toEqual([16, 28, 44, 64, 86, 108, 124, 154, 182, 216]);
    expect(qrAlignmentPositions(2)).toEqual([6, 18]);
    expect(qrAlignmentPositions(7)).toEqual([6, 22, 38]);
    expect(qrAlignmentPositions(10)).toEqual([6, 28, 50]);
  });
  it('encodes and reads back every mask and version 1–10, including a real otpauth link', () => {
    const otp = 'otpauth://totp/Buddy%20Account%3Aadmin?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Buddy%20Account&algorithm=SHA1&digits=6&period=30';
    for (const text of ['a', 'Buddy Account', otp, 'ทดสอบภาษาไทย', 'x'.repeat(150), 'y'.repeat(213)]) {
      const auto = qrEncode(text);
      expect(auto.size).toBe(auto.version * 4 + 17);
      expect(readQr(auto.modules, auto.version)).toEqual({ mask: auto.mask, text });
      for (let mask = 0; mask < 8; mask++) expect(readQr(qrEncode(text, { mask }).modules, auto.version).text).toBe(text);
    }
    expect(qrCodewords(otp).version).toBe(8);   // 126 ไบต์ → รุ่น 8 (49×49)
    expect(() => qrEncode('z'.repeat(214))).toThrow(/ยาวเกินไป/);
  });
  it('finder patterns sit in three corners', () => {
    const { modules: m, size } = qrEncode('Buddy Account');
    for (const [x, y] of [[0, 0], [size - 7, 0], [0, size - 7]] as const) {
      expect(m[y]![x]).toBe(true); expect(m[y + 1]![x + 1]).toBe(false); expect(m[y + 3]![x + 3]).toBe(true);
    }
  });
});
