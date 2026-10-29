/**
 * ตัวอ่านแฟ้ม FoxPro .DBF ของโปรแกรม Express (codepage 874) จาก Buffer — พอร์ตจาก dbf() ใน tools/express-import/migrate_express.py
 * ผลต้องเหมือนตัวนำเข้า Python ทุกค่า:
 *  - C/M: ถอดรหัส cp874 (ไบต์ที่ไม่มีในตาราง = U+FFFD เหมือน 'replace'), แทน \xa0 ด้วยช่องว่าง, ตัดช่องว่างท้าย (ชุดอักขระช่องว่างของ Python) ว่าง = null
 *  - N/F: ตัวเลข (float) ถ้าแปลงไม่ได้ = null · D: 'YYYY-MM-DD' (ไม่มีเขตเวลา) ถ้าวันที่ผิด = null · L: T/Y = true
 *  - I: int32 · B: double · Y: int64 / 10000 · ชนิดอื่น = null
 *  - ข้ามระเบียนที่ถูกลบ ('*') และหยุดเมื่อระเบียนไม่ครบ
 */

export type DbfValue = string | number | boolean | null;
export type DbfRecord = Record<string, DbfValue>;
export interface DbfField { name: string; type: string; offset: number; length: number }

/* ------------------------------------------------------------------ cp874 (เหมือน Python codec 'cp874') */
const CP874: string[] = (() => {
  const td = new TextDecoder('windows-874');
  const t: string[] = [];
  for (let i = 0; i < 256; i++) t.push(i < 0x80 ? String.fromCharCode(i) : td.decode(Uint8Array.of(i)));
  // ไบต์ที่ Python cp874 ไม่รู้จัก (WHATWG ให้เป็น C1 control / Private Use) → U+FFFD
  const undef = [[0x81, 0x84], [0x86, 0x90], [0x98, 0x9f], [0xdb, 0xde], [0xfc, 0xff]];
  for (const [a, b] of undef) for (let i = a!; i <= b!; i++) t[i] = '�';
  return t;
})();

export function decodeCp874(buf: Uint8Array, start = 0, end = buf.length): string {
  let ascii = true;
  for (let i = start; i < end; i++) if (buf[i]! >= 0x80) { ascii = false; break; }
  if (ascii) return Buffer.from(buf.buffer, buf.byteOffset + start, end - start).toString('latin1');
  let s = '';
  for (let i = start; i < end; i++) s += CP874[buf[i]!];
  return s;
}

/* ------------------------------------------------------------------ ช่องว่างแบบ Python (str.strip / str.isspace / re \s) */
export const PY_WS = '\t\n\v\f\r \x1c\x1d\x1e\x1f\x85\xa0                　';
const isWs = (ch: string) => PY_WS.includes(ch);
export function pyRstrip(s: string): string {
  let e = s.length;
  while (e > 0 && isWs(s[e - 1]!)) e--;
  return e === s.length ? s : s.slice(0, e);
}
export function pyStrip(s: string): string {
  let b = 0;
  while (b < s.length && isWs(s[b]!)) b++;
  return pyRstrip(s.slice(b));
}

/* ------------------------------------------------------------------ แปลงตัวเลข/วันที่แบบ Python */
const FLOAT_RE = /^[+-]?(?:(?:\d(?:_?\d)*)?\.?\d(?:_?\d)*|\d(?:_?\d)*\.)(?:[eE][+-]?\d(?:_?\d)*)?$/;
/** float(s) ของ Python (s ตัดช่องว่างแล้ว) — แปลงไม่ได้ = null */
export function pyFloatParse(s: string): number | null {
  const t = pyStrip(s);
  if (FLOAT_RE.test(t)) return Number(t.replace(/_/g, ''));
  const m = /^([+-]?)(inf|infinity|nan)$/i.exec(t);
  if (m) return m[2]!.toLowerCase() === 'nan' ? NaN : (m[1] === '-' ? -Infinity : Infinity);
  return null;
}
const INT_RE = /^\s*[+-]?\d(?:_?\d)*\s*$/;
function pyIntOrNull(s: string): number | null { return INT_RE.test(s) ? parseInt(s.replace(/_/g, ''), 10) : null; }
function isLeap(y: number) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
export function daysInMonth(y: number, m: number) { return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!; }
export function isoOf(y: number, m: number, d: number) { return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
/** datetime.date(int(s[:4]), int(s[4:6]), int(s[6:8])) — ผิด = null */
function pyDate(s: string): string | null {
  const y = pyIntOrNull(s.slice(0, 4)), m = pyIntOrNull(s.slice(4, 6)), d = pyIntOrNull(s.slice(6, 8));
  if (y === null || m === null || d === null) return null;
  if (y < 1 || y > 9999 || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return isoOf(y, m, d);
}

/** raw.decode('ascii', 'replace') */
function asciiReplace(buf: Buffer, a: number, e: number): string {
  const s = buf.toString('latin1', a, e);
  return /[-ÿ]/.test(s) ? s.replace(/[-ÿ]/g, '�') : s;
}

/* ------------------------------------------------------------------ ตัวอ่าน */
export interface DbfFile { fields: DbfField[]; count: number; records(): Generator<DbfRecord> }

export function openDbf(buf: Buffer): DbfFile {
  if (buf.length < 32) return { fields: [], count: 0, *records() { /* empty */ } };
  const n = buf.readUInt32LE(4), hl = buf.readUInt16LE(8), rl = buf.readUInt16LE(10);
  const fields: DbfField[] = [];
  let p = 32, off = 1;
  while (p < buf.length) {
    const b = buf.subarray(p, Math.min(p + 32, buf.length));
    if (!b.length || b[0] === 0x0d) break;
    const raw = b.subarray(0, 11);
    const z = raw.indexOf(0);
    const name = raw.subarray(0, z < 0 ? raw.length : z).toString('ascii');
    const ln = b[16] ?? 0;
    fields.push({ name, type: String.fromCharCode(b[11] ?? 0), offset: off, length: ln });
    off += ln; p += 32;
  }
  return {
    fields, count: n,
    *records() {
      for (let i = 0; i < n; i++) {
        const s = hl + i * rl;
        if (s + rl > buf.length) break;
        if (buf[s] === 0x2a) continue;   // '*' = ระเบียนที่ถูกลบ
        const o: DbfRecord = {};
        for (const f of fields) {
          const a = s + f.offset, e = a + f.length;
          let v: DbfValue;
          switch (f.type) {
            case 'C': case 'M': v = pyRstrip(decodeCp874(buf, a, e).replace(/\xa0/g, ' ')) || null; break;
            case 'N': case 'F': {
              const t = pyStrip(asciiReplace(buf, a, e));
              v = t ? pyFloatParse(t) : null;
              break;
            }
            case 'D': {
              const t = pyStrip(asciiReplace(buf, a, e));
              v = t ? pyDate(t) : null;
              break;
            }
            case 'L': { const t = buf.toString('latin1', a, e); v = t === 'T' || t === 'Y'; break; }
            case 'I': v = buf.readInt32LE(a); break;
            case 'B': v = buf.readDoubleLE(a); break;
            case 'Y': v = Number(buf.readBigInt64LE(a)) / 10000; break;
            default: v = null;
          }
          o[f.name] = v;
        }
        yield o;
      }
    },
  };
}

/** อ่านทุกระเบียนของ Buffer (null = ไม่มีแฟ้ม → ไม่มีระเบียน) */
export function* dbfRecords(buf: Buffer | null): Generator<DbfRecord> {
  if (!buf) return;
  yield* openDbf(buf).records();
}
