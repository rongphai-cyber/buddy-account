/**
 * สร้าง QR code (ISO/IEC 18004) สำหรับลิงก์ตั้งค่ายืนยันตัวตนสองขั้น otpauth:// — เขียนเองแทนการดาวน์โหลด package
 * รองรับเฉพาะที่ใช้: โหมดไบต์ (UTF-8) ระดับแก้ข้อผิดพลาด M (กู้ได้ ~15%) รุ่น 1–10 (ข้อความไม่เกิน 213 ไบต์)
 * ขั้นตอนตามมาตรฐาน: ใส่หัวโหมด/ความยาว → เติม 0xEC 0x11 → แบ่งบล็อก + Reed–Solomon (GF(256) พหุนาม 0x11D) → สลับบล็อก
 * → วางรูปแบบคงที่ (finder/timing/alignment/format/version) → วางข้อมูลแบบซิกแซก → เลือก mask ที่คะแนนโทษต่ำสุด
 */
export type QrMatrix = boolean[][];   // [แถว][คอลัมน์] true = จุดดำ

/** รุ่น 1–10 ระดับ M: จำนวน codeword แก้ข้อผิดพลาดต่อบล็อก และจำนวนบล็อก (ตารางมาตรฐาน) */
const ECC_PER_BLOCK_M = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS_M = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
export const QR_MAX_VERSION = 10;
/** บิตระดับแก้ข้อผิดพลาดในข้อมูลรูปแบบ: L=01 M=00 Q=11 H=10 */
const ECC_FORMAT_M = 0;

/** จำนวนช่องข้อมูล (บิต) ของรุ่น = พื้นที่ทั้งหมด − รูปแบบคงที่ */
export function qrRawDataModules(ver: number): number {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) { const na = Math.floor(ver / 7) + 2; r -= (25 * na - 10) * na - 55; if (ver >= 7) r -= 36; }
  return r;
}
/** จำนวน codeword ข้อมูล (ไม่รวมแก้ข้อผิดพลาด) ระดับ M */
export const qrDataCodewords = (ver: number) => Math.floor(qrRawDataModules(ver) / 8) - ECC_PER_BLOCK_M[ver]! * BLOCKS_M[ver]!;

/* ---------------------------------------------------------------- Reed–Solomon ใน GF(2^8) */
export function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; }
  return z & 0xff;
}
/** พหุนามตัวหาร (x − α^0)(x − α^1)…(x − α^(n−1)) ไม่รวมสัมประสิทธิ์นำ */
function rsDivisor(degree: number): number[] {
  const r = new Array<number>(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) { r[j] = gfMul(r[j]!, root); if (j + 1 < r.length) r[j]! ^= r[j + 1]!; }
    root = gfMul(root, 0x02);
  }
  return r;
}
/** codeword แก้ข้อผิดพลาดของข้อมูลหนึ่งบล็อก */
export function rsRemainder(data: number[], degree: number): number[] {
  const div = rsDivisor(degree);
  const r = new Array<number>(degree).fill(0);
  for (const b of data) {
    const f = b ^ r.shift()!;
    r.push(0);
    div.forEach((c, i) => { r[i]! ^= gfMul(c, f); });
  }
  return r;
}

/** ข้อมูลรูปแบบ 15 บิต (ระดับ + mask) พร้อม BCH และ XOR 0x5412 */
export function qrFormatBits(eccBits: number, mask: number): number {
  const data = (eccBits << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}
/** ข้อมูลรุ่น 18 บิต (รุ่น 7 ขึ้นไป) */
export function qrVersionBits(ver: number): number {
  let rem = ver;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (ver << 12) | rem;
}
export function qrAlignmentPositions(ver: number): number[] {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
  const out = [6];
  for (let pos = ver * 4 + 17 - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
  return out;
}
const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0;
export const QR_MASKS: Array<(x: number, y: number) => boolean> = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** codeword ทั้งหมดตามลำดับที่วางลงภาพ (ข้อมูลสลับบล็อก ตามด้วยแก้ข้อผิดพลาดสลับบล็อก) */
export function qrCodewords(text: string, ver?: number): { version: number; codewords: number[] } {
  const bytes = [...new TextEncoder().encode(text)];
  const bitsFor = (v: number) => 4 + (v < 10 ? 8 : 16) + bytes.length * 8;
  const version = ver ?? Array.from({ length: QR_MAX_VERSION }, (_, i) => i + 1).find((v) => bitsFor(v) <= qrDataCodewords(v) * 8);
  if (!version || bitsFor(version) > qrDataCodewords(version) * 8) throw new Error(`ข้อความยาวเกินไปสำหรับ QR code (${bytes.length} ไบต์)`);
  const cap = qrDataCodewords(version) * 8;
  const bits: number[] = [];
  const push = (v: number, n: number) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, cap - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) push(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  const nb = BLOCKS_M[version]!, ecl = ECC_PER_BLOCK_M[version]!;
  const raw = Math.floor(qrRawDataModules(version) / 8);
  const nShort = nb - (raw % nb), shortLen = Math.floor(raw / nb);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const d = data.slice(k, k += shortLen - ecl + (i < nShort ? 0 : 1));
    blocks.push([...d, ...rsRemainder(d, ecl)]);
  }
  const out: number[] = [];
  // บล็อกสั้นมีข้อมูลน้อยกว่า 1 ตัว: ข้ามตำแหน่งนั้นตอนสลับ
  for (let i = 0; i < shortLen + 1; i++) blocks.forEach((b, j) => {
    if (i !== shortLen - ecl || j >= nShort) { const v = j < nShort && i > shortLen - ecl ? b[i - 1] : b[i]; if (v !== undefined) out.push(v); }
  });
  return { version, codewords: out };
}

/** ช่องที่เป็นรูปแบบคงที่ (ไม่ใช่ข้อมูล) ของรุ่น — ใช้ร่วมกับตัวอ่านในชุดทดสอบ */
export function qrFunctionMap(ver: number) {
  const size = ver * 4 + 17;
  const m: QrMatrix = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fn: QrMatrix = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, dark: boolean) => { m[y]![x] = dark; fn[y]![x] = true; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]] as const)
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x >= 0 && x < size && y >= 0 && y < size) { const d = Math.max(Math.abs(dx), Math.abs(dy)); set(x, y, d !== 2 && d !== 4); }
    }
  const al = qrAlignmentPositions(ver);
  al.forEach((ax, i) => al.forEach((ay, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  const drawFormat = (bitsV: number) => {
    for (let i = 0; i <= 5; i++) set(8, i, bit(bitsV, i));
    set(8, 7, bit(bitsV, 6)); set(8, 8, bit(bitsV, 7)); set(7, 8, bit(bitsV, 8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(bitsV, i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(bitsV, i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(bitsV, i));
    set(8, size - 8, true);   // จุดดำคงที่
  };
  drawFormat(0);
  if (ver >= 7) {
    const vb = qrVersionBits(ver);
    for (let i = 0; i < 18; i++) { const a = size - 11 + (i % 3), b = Math.floor(i / 3); set(a, b, bit(vb, i)); set(b, a, bit(vb, i)); }
  }
  return { size, modules: m, isFunction: fn, drawFormat };
}

/** ลำดับช่องข้อมูลแบบซิกแซก (คอลัมน์คู่จากขวา ขึ้น/ลงสลับ ข้ามคอลัมน์ 6) */
export function qrDataOrder(size: number, isFunction: QrMatrix): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
      if (!isFunction[y]![x]) out.push([x, y]);
    }
  }
  return out;
}

function penalty(m: QrMatrix): number {
  const n = m.length;
  let p = 0;
  const lines = [...m, ...m.map((_, x) => m.map((row) => row[x]!))];
  for (const line of lines) {
    for (let i = 0, run = 1; i < n; i++) {
      if (i + 1 < n && line[i + 1] === line[i]) run++;
      else { if (run >= 5) p += 3 + run - 5; run = 1; }
    }
    const s = line.map((v) => (v ? '1' : '0')).join('');
    for (const pat of ['00001011101', '10111010000']) for (let k = s.indexOf(pat); k >= 0; k = s.indexOf(pat, k + 1)) p += 40;
  }
  for (let y = 0; y + 1 < n; y++) for (let x = 0; x + 1 < n; x++) { const c = m[y]![x]; if (c === m[y]![x + 1] && c === m[y + 1]![x] && c === m[y + 1]![x + 1]) p += 3; }
  const dark = m.reduce((s, r) => s + r.filter(Boolean).length, 0);
  p += Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n)) * 10;
  return p;
}

/** สร้าง QR code ของข้อความ — mask ระบุเองได้ (ทดสอบ) ไม่ระบุ = เลือกที่คะแนนโทษต่ำสุด */
export function qrEncode(text: string, opt: { mask?: number } = {}): { version: number; mask: number; size: number; modules: QrMatrix } {
  const { version, codewords } = qrCodewords(text);
  const best = { mask: -1, score: Infinity, modules: [] as QrMatrix };
  for (let mask = 0; mask < 8; mask++) {
    if (opt.mask !== undefined && mask !== opt.mask) continue;
    const { size, modules, isFunction, drawFormat } = qrFunctionMap(version);
    qrDataOrder(size, isFunction).forEach(([x, y], i) => {
      const v = i < codewords.length * 8 ? bit(codewords[i >>> 3]!, 7 - (i & 7)) : false;
      modules[y]![x] = v !== QR_MASKS[mask]!(x, y);
    });
    drawFormat(qrFormatBits(ECC_FORMAT_M, mask));
    const score = opt.mask !== undefined ? 0 : penalty(modules);
    if (score < best.score) Object.assign(best, { mask, score, modules });
  }
  return { version, mask: best.mask, size: best.modules.length, modules: best.modules };
}

/** QR เป็น SVG path (ขอบว่าง 4 ช่องตามมาตรฐาน) — ใช้แสดงบนหน้าจอโดยไม่ต้องโหลดภาพ */
export function qrSvgPath(m: QrMatrix, border = 4): { viewBox: string; d: string } {
  const parts: string[] = [];
  m.forEach((row, y) => row.forEach((dark, x) => { if (dark) parts.push(`M${x + border},${y + border}h1v1h-1z`); }));
  return { viewBox: `0 0 ${m.length + border * 2} ${m.length + border * 2}`, d: parts.join('') };
}
