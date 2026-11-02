/**
 * เขียนแฟ้ม Excel 97-2003 (.xls / BIFF8) แผ่นงานเดียว — ใช้กับแฟ้มยื่นประกันสังคม (e-Service รับ .xls)
 * เขียนเองไม่ใช้ไลบรารี: Compound File (CFB v3 ภาคละ 512 ไบต์) + Workbook stream
 * ข้อความเก็บใน shared string table (SST — ระบบประกันสังคมอ่านข้อความ inline เป็นช่องว่าง) · ตัวเลขเป็น NUMBER พร้อมรูปแบบ
 */
export type XlsCell = string | { n: number; fmt?: 'id13' | '0.00' } | null;

const u16 = (v: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
const u32 = (v: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; };
const rec = (type: number, data: Buffer) => Buffer.concat([u16(type), u16(data.length), data]);
/** XLUnicodeString แบบ UTF-16 (cch 16 บิต) */
const xlStr = (s: string) => Buffer.concat([u16(s.length), Buffer.from([1]), Buffer.from(s, 'utf16le')]);

function globalsRecords(sheetName: string, strings: string[], sheetOffset: number) {
  const bof = rec(0x0809, Buffer.concat([u16(0x0600), u16(0x0005), u16(0x0dbb), u16(0x07cc), u32(0), u32(6)]));
  const codepage = rec(0x0042, u16(1200));
  const window1 = rec(0x003d, Buffer.concat([u16(0), u16(0), u16(0x4000), u16(0x2000), u16(0x0038), u16(0), u16(0), u16(1), u16(0x0258)]));
  const fontName = 'Tahoma';
  const font = rec(0x0031, Buffer.concat([u16(200), u16(0), u16(0x7fff), u16(400), u16(0), Buffer.from([0, 0, 0, 0]), Buffer.from([fontName.length, 1]), Buffer.from(fontName, 'utf16le')]));
  const fonts = Buffer.concat([font, font, font, font, font]);   // ตำแหน่ง 4 ถูกข้ามตามมาตรฐาน — ใส่ 5 ตัว
  const fmt = rec(0x041e, Buffer.concat([u16(164), xlStr('0000000000000')]));
  // XF: 0–14 แบบ style · 15 ทั่วไป · 16 เลข 13 หลัก · 17 0.00
  const xf = (ifmt: number, style: boolean) => rec(0x00e0, Buffer.concat([u16(0), u16(ifmt), u16(style ? 0xfff5 : 0x0001), Buffer.from([0x20, 0, 0, style ? 0xf4 : 0xf8]), u32(0), u32(0), u16(0x20c0)]));
  const xfs = Buffer.concat([...Array.from({ length: 15 }, () => xf(0, true)), xf(0, false), xf(164, false), xf(2, false)]);
  const style = rec(0x0293, Buffer.concat([u16(0x8000), Buffer.from([0, 0xff])]));
  const sheet = rec(0x0085, Buffer.concat([u32(sheetOffset), Buffer.from([0, 0]), Buffer.from([sheetName.length, 1]), Buffer.from(sheetName, 'utf16le')]));
  // SST: แบ่งเป็น CONTINUE ที่ขอบข้อความ (ไม่ตัดกลางข้อความ) ให้แต่ละระเบียนไม่เกิน 8224 ไบต์
  const parts: Buffer[] = [];
  let cur: Buffer[] = [u32(strings.length), u32(strings.length)], size = 8;
  for (const s of strings) {
    const b = xlStr(s);
    if (size + b.length > 8224) { parts.push(Buffer.concat(cur)); cur = []; size = 0; }
    cur.push(b); size += b.length;
  }
  parts.push(Buffer.concat(cur));
  const sst = Buffer.concat(parts.map((p, i) => rec(i === 0 ? 0x00fc : 0x003c, p)));
  const eof = rec(0x000a, Buffer.alloc(0));
  return Buffer.concat([bof, codepage, window1, fonts, fmt, xfs, style, sheet, sst, eof]);
}

function sheetRecords(rows: XlsCell[][], sst: Map<string, number>, widths: number[]) {
  const ncols = Math.max(1, ...rows.map((r) => r.length));
  const out: Buffer[] = [rec(0x0809, Buffer.concat([u16(0x0600), u16(0x0010), u16(0x0dbb), u16(0x07cc), u32(0), u32(6)]))];
  widths.forEach((w, i) => out.push(rec(0x007d, Buffer.concat([u16(i), u16(i), u16(Math.round(w * 256)), u16(15), u16(0), u16(0)]))));
  out.push(rec(0x0200, Buffer.concat([u32(0), u32(rows.length), u16(0), u16(ncols), u16(0)])));
  rows.forEach((r, ri) => r.forEach((c, ci) => {
    if (c === null || c === '') return;
    if (typeof c === 'string') out.push(rec(0x00fd, Buffer.concat([u16(ri), u16(ci), u16(15), u32(sst.get(c)!)])));
    else { const v = Buffer.alloc(8); v.writeDoubleLE(c.n); out.push(rec(0x0203, Buffer.concat([u16(ri), u16(ci), u16(c.fmt === 'id13' ? 16 : c.fmt === '0.00' ? 17 : 15), v]))); }
  }));
  out.push(rec(0x023e, Buffer.concat([u16(0x06b6), u16(0), u16(0), u16(64), u16(0), u16(0), u16(0), u32(0)])));
  out.push(rec(0x000a, Buffer.alloc(0)));
  return Buffer.concat(out);
}

/** Compound File v3: [Workbook ทีละ 512][ไดเรกทอรี 1 ภาค][FAT] — ไม่ใช้ mini stream (เติม Workbook ให้ ≥ 4096 ไบต์) */
function cfb(workbook: Buffer) {
  const SEC = 512, END = 0xfffffffe, FREE = 0xffffffff, FATSECT = 0xfffffffd, NOSTREAM = 0xffffffff;
  const data = workbook.length < 4096 ? Buffer.concat([workbook, Buffer.alloc(4096 - workbook.length)]) : workbook;
  const n = Math.ceil(data.length / SEC);
  let f = 1;
  while (n + 1 + f > f * 128) f++;
  if (f > 109) throw new Error('แฟ้มใหญ่เกินไป');
  const dirSec = n, fatStart = n + 1;
  const fat: number[] = [];
  for (let i = 0; i < n; i++) fat.push(i === n - 1 ? END : i + 1);
  fat.push(END);
  for (let i = 0; i < f; i++) fat.push(FATSECT);
  while (fat.length < f * 128) fat.push(FREE);
  const header = Buffer.alloc(SEC);
  Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(header, 0);
  header.writeUInt16LE(0x3e, 24); header.writeUInt16LE(3, 26); header.writeUInt16LE(0xfffe, 28); header.writeUInt16LE(9, 30); header.writeUInt16LE(6, 32);
  header.writeUInt32LE(f, 44); header.writeUInt32LE(dirSec, 48); header.writeUInt32LE(4096, 56);
  header.writeUInt32LE(END, 60); header.writeUInt32LE(0, 64); header.writeUInt32LE(END, 68); header.writeUInt32LE(0, 72);
  for (let i = 0; i < 109; i++) header.writeUInt32LE(i < f ? fatStart + i : FREE, 76 + i * 4);
  const entry = (name: string, type: number, child: number, start: number, size: number) => {
    const e = Buffer.alloc(128);
    if (name) { Buffer.from(name + '\0', 'utf16le').copy(e, 0); e.writeUInt16LE((name.length + 1) * 2, 64); }
    e[66] = type; e[67] = 1;
    e.writeUInt32LE(NOSTREAM, 68); e.writeUInt32LE(NOSTREAM, 72); e.writeUInt32LE(child, 76);
    e.writeUInt32LE(start, 116); e.writeUInt32LE(size, 120);
    return e;
  };
  const dir = Buffer.concat([entry('Root Entry', 5, 1, END, 0), entry('Workbook', 2, NOSTREAM, 0, data.length), entry('', 0, NOSTREAM, 0, 0), entry('', 0, NOSTREAM, 0, 0)]);
  const fatBuf = Buffer.alloc(f * SEC);
  fat.forEach((v, i) => fatBuf.writeUInt32LE(v >>> 0, i * 4));
  const body = Buffer.concat([data, Buffer.alloc(n * SEC - data.length)]);
  return Buffer.concat([header, body, dir, fatBuf]);
}

/** แผ่นงานเดียว → แฟ้ม .xls */
export function buildXls(sheetName: string, rows: XlsCell[][], widths: number[] = []): Buffer {
  const strings = [...new Set(rows.flat().filter((c): c is string => typeof c === 'string' && c !== ''))];
  const sst = new Map(strings.map((s, i) => [s, i]));
  const sheet = sheetRecords(rows, sst, widths);
  const globalsLen = globalsRecords(sheetName, strings, 0).length;
  const wb = Buffer.concat([globalsRecords(sheetName, strings, globalsLen), sheet]);
  return cfb(wb);
}
