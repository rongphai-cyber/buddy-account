/**
 * ย้ายข้อมูลจากโฟลเดอร์ข้อมูลบริษัทของโปรแกรม Express (.DBF FoxPro, codepage 874) เข้าฐานข้อมูล Buddy Account
 * พอร์ตจาก tools/express-import/migrate_express.py (T0.12) — ผลต้องเหมือนกันทุกตาราง ทุกแถว ทุกค่า:
 *  - UUID แบบกำหนดได้ uuid5(NS, '/'.join(parts)) โดย NS = uuid5(NAMESPACE_URL, idNamespace ?? 'express-migration/' + รหัส)
 *  - ตัวเลขทำแบบ float ของ Python: round() = ปัดครึ่งไปเลขคู่บนค่าฐานสองจริง (pyRound), sum() = Neumaier (Python 3.12)
 *    ค่าที่ส่งเข้าฐานข้อมูลเป็นข้อความทศนิยม — ฐานข้อมูลปัดตาม numeric(p,s) เหมือนกับที่ psycopg2 ส่ง repr(float)
 *  - รหัสที่อ้างถึงแต่ไม่มีในแฟ้มหลัก สร้างแถว placeholder (status='I', ชื่อ '[MISSING] …') และบันทึกในรายงานคุณภาพข้อมูล
 *  - ทั้งหมดในทรานแซกชันเดียว ปิด trigger ด้วย session_replication_role = replica (ไม่สร้าง change log/ไม่ตรวจงวด/ไม่ตรวจ FK)
 * ต่างจาก Python โดยตั้งใจ: คำสั่ง UPDATE/SELECT รวมยอดกรอง company_id ของบริษัทที่นำเข้า (Python ทำทั้งฐานข้อมูล — ผลของบริษัทนี้เท่ากัน)
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CompiledQuery, sql, type Kysely, type Transaction } from 'kysely';
import { SETTING_DEFS } from '@buddy/core';
import type { DB } from '../../db.js';
import { dbfRecords, daysInMonth, isoOf, pyFloatParse, pyStrip, PY_WS, type DbfRecord, type DbfValue } from './dbf.js';

/* ================================================================== API */
export interface DbfSource { list(): string[]; read(name: string): Buffer | null }
export interface ImportReport { company_id: string; code: string; name_th: string; counts: Record<string, { rows: number; source: string }>; quality: Record<string, string[]> }
export interface ImportOptions {
  code: string;
  tenantId: string | null;
  idNamespace?: string;
  userId?: string | null;
  onProgress?: (step: string, pct: number) => void;
}

/** อ่าน <dir>/<NAME>.DBF (ไม่สนตัวพิมพ์เล็ก/ใหญ่) */
export function folderSource(dir: string): DbfSource {
  const files = new Map<string, string>();
  if (existsSync(dir)) for (const f of readdirSync(dir)) if (/\.dbf$/i.test(f)) files.set(f.slice(0, -4).toUpperCase(), join(dir, f));
  return {
    list: () => [...files.keys()].sort(),
    read: (name) => { const p = files.get(name.toUpperCase()); return p ? readFileSync(p) : null; },
  };
}

/* ================================================================== Python semantics */
export const NAMESPACE_URL = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';
/** uuid.uuid5 (RFC 4122 v5, SHA-1) */
export function uuid5(namespace: string, name: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const h = createHash('sha1').update(ns).update(Buffer.from(name, 'utf8')).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

/** round(x, nd) ของ Python สำหรับ float: ปัดค่าฐานสองจริงแบบครึ่งไปเลขคู่ แล้วแปลงกลับเป็น float ที่ใกล้ที่สุด */
export function pyRound(x: number, nd: number): number {
  if (!Number.isFinite(x) || x === 0) return x;
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0), lo = dv.getUint32(4);
  const neg = hi >>> 31 === 1;
  const ex = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (ex === 0) e = -1074; else { mant |= 1n << 52n; e = ex - 1075; }
  if (e >= 0) return x;   // จำนวนเต็ม
  const scale = -e;       // |x| = mant * 5^scale / 10^scale
  if (scale <= nd) return x;
  const num = mant * 5n ** BigInt(scale);
  const div = 10n ** BigInt(scale - nd);
  let q = num / div;
  const r2 = (num % div) * 2n;
  if (r2 > div || (r2 === div && (q & 1n) === 1n)) q += 1n;
  const v = Number(`${q}e-${nd}`);
  return neg ? -v : v;
}

/** repr(float) ของ Python */
export function pyFloatRepr(x: number): string {
  if (Number.isNaN(x)) return 'nan';
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf';
  const sign = x < 0 || Object.is(x, -0) ? '-' : '';
  const a = Math.abs(x);
  if (a === 0) return `${sign}0.0`;
  const m = /^(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(a.toExponential())!;
  const digits = m[1]! + (m[2] ?? '');
  const decpt = Number(m[3]) + 1;
  let s: string;
  if (decpt <= -4 || decpt > 16) {
    const exp = decpt - 1;
    s = digits[0]! + (digits.length > 1 ? '.' + digits.slice(1) : '') + 'e' + (exp < 0 ? '-' : '+') + String(Math.abs(exp)).padStart(2, '0');
  } else if (decpt <= 0) s = '0.' + '0'.repeat(-decpt) + digits;
  else if (decpt >= digits.length) s = digits + '0'.repeat(decpt - digits.length) + '.0';
  else s = digits.slice(0, decpt) + '.' + digits.slice(decpt);
  return sign + s;
}

/** sum() ของ Python 3.12 กับ float (Neumaier) */
export function pySum(xs: Iterable<number>): number {
  let f = 0, c = 0;
  for (const x of xs) {
    const t = f + x;
    if (Math.abs(f) >= Math.abs(x)) c += (f - t) + x; else c += (x - t) + f;
    f = t;
  }
  if (c && Number.isFinite(c)) f += c;
  return f;
}

/** ค่า float ของ Python ที่ต้องเขียนเป็น JSON แบบ Python (เช่น 7.0 ไม่ใช่ 7) */
class PyFloat { constructor(readonly v: number) {} }
function pyJson(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (v instanceof PyFloat) return Number.isFinite(v.v) ? pyFloatRepr(v.v) : (Number.isNaN(v.v) ? 'NaN' : v.v > 0 ? 'Infinity' : '-Infinity');
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : pyFloatRepr(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(pyJson).join(', ') + ']';
  return '{' + Object.entries(v as Record<string, unknown>).map(([k, x]) => `${JSON.stringify(k)}: ${pyJson(x)}`).join(', ') + '}';
}

type V = DbfValue | undefined;
/** str() ของ Python สำหรับส่วนของ id / ข้อความในรายงาน (ตัวเลขในจุดเหล่านี้เป็น int ของ Python) */
function pyStr(v: unknown): string {
  if (v === null || v === undefined) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'number') return Number.isInteger(v) && Math.abs(v) < 1e21 ? String(v) : pyFloatRepr(v);
  return String(v);
}
/** ความจริงแบบ Python */
const T = (v: unknown): boolean => !(v === null || v === undefined || v === false || v === 0 || v === '');
const st = (v: V): DbfValue => (typeof v === 'string' ? pyStrip(v) : v ?? null);
const num = (v: V): number => (typeof v === 'number' ? v : v === true ? 1 : Number(v));
const money = (v: V): number => pyRound(T(v) ? num(v) : 0, 2);
const qty = (v: V): number => pyRound(T(v) ? num(v) : 0, 4);
const nz = <X>(v: X): X | null => (T(v) ? v : null);
const or = <A, B>(a: A, b: B): A | B => (T(a) ? a : b);
class PyValueError extends Error {}
/** int() ของ Python: float ตัดทศนิยม, ข้อความต้องเป็นเลขจำนวนเต็ม (รองรับเลขไทย) */
const THAI0 = 0x0e50;
function toAsciiDigits(s: string) { return s.replace(/[๐-๙]/g, (c) => String(c.charCodeAt(0) - THAI0)); }
function pyInt(v: V): number {
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new PyValueError('int'); return Math.trunc(v); }
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const t = toAsciiDigits(pyStrip(v));
    if (!/^[+-]?\d(?:_?\d)*$/.test(t)) throw new PyValueError(`int(${v})`);
    return parseInt(t.replace(/_/g, ''), 10);
  }
  throw new PyValueError('int(None)');
}
/** str.isdigit() (ASCII + เลขไทย) — ค่าที่ไม่ใช่ข้อความ = false */
const isDigit = (v: unknown): boolean => typeof v === 'string' && /^[0-9๐-๙]+$/.test(v);
const WS_RE = new RegExp(`[${PY_WS.replace(/[\]\\^-]/g, '\\$&')}]+`, 'g');

/* ---------- วันที่ ('YYYY-MM-DD') */
const yearOf = (d: string) => Number(d.slice(0, 4));
function addDays(d: string, n: number): string {
  const t = Date.UTC(yearOf(d), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) + n * 86400000;
  const x = new Date(t);
  return isoOf(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate());
}
function replaceYear(d: string, y: number): string {
  const m = Number(d.slice(5, 7)), dd = Number(d.slice(8, 10));
  if (y < 1 || y > 9999 || dd > daysInMonth(y, m)) throw new PyValueError('day is out of range for month');
  return isoOf(y, m, dd);
}
const maxOf = <X>(xs: X[]): X => xs.reduce((a, b) => (b > a ? b : a));

/** คีย์ประกอบ (tuple ของ Python) สำหรับ Map */
const K = (...parts: unknown[]) => JSON.stringify(parts.map((p) => (p === undefined ? null : p)));

/* ================================================================== importer */
type Row = Record<string, unknown>;
const PARAM_LIMIT = 29_000;

export async function importExpress(db: Kysely<DB>, src: DbfSource, opts: ImportOptions): Promise<ImportReport> {
  return db.transaction().execute((tx) => runImport(tx, src, opts));
}

async function runImport(tx: Transaction<DB>, src: DbfSource, opts: ImportOptions): Promise<ImportReport> {
  const CO = opts.code;
  const progress = (step: string, pct: number) => opts.onProgress?.(step, pct);
  const NS = uuid5(NAMESPACE_URL, opts.idNamespace ?? 'express-migration/' + CO);
  const U = (...parts: unknown[]) => uuid5(NS, parts.map(pyStr).join('/'));
  const QUALITY = new Map<string, string[]>();
  const Q = (k: string, ...vals: unknown[]) => { let l = QUALITY.get(k); if (!l) QUALITY.set(k, (l = [])); for (const v of vals) l.push(pyStr(v)); };
  const bufCache = new Map<string, Buffer | null>();
  const dbf = (name: string): Generator<DbfRecord> => {
    if (!bufCache.has(name)) bufCache.set(name, src.read(name));
    return dbfRecords(bufCache.get(name)!);
  };
  const first = (name: string): DbfRecord | null => { for (const r of dbf(name)) return r; return null; };

  progress('เตรียมฐานข้อมูล', 0);
  // ปิด trigger ระหว่างย้ายข้อมูล (ต้องเป็น superuser — PostgreSQL และ PGlite ทำได้)
  await sql`SET LOCAL session_replication_role = replica`.execute(tx);
  const COMPANY = U('company');
  const userId = opts.userId ?? null;
  const withCreatedBy = new Set<string>();
  if (userId) {
    const r = await sql<{ table_name: string }>`SELECT table_name FROM information_schema.columns WHERE column_name = 'created_by' AND table_schema = current_schema()`.execute(tx);
    for (const x of r.rows) withCreatedBy.add(x.table_name);
  }

  const param = (v: unknown): unknown => {
    if (v === undefined || v === null) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : Number.isNaN(v) ? 'NaN' : v > 0 ? 'Infinity' : '-Infinity';
    return v;
  };
  async function insert(table: string, rows: Row[]): Promise<number> {
    if (!rows.length) return 0;
    const cols = Object.keys(rows[0]!);   // เหมือน Python: คอลัมน์ตามแถวแรก แถวอื่นที่ไม่มีคอลัมน์ = NULL
    const addUser = userId !== null && withCreatedBy.has(table) && !cols.includes('created_by');
    const allCols = addUser ? [...cols, 'created_by'] : cols;
    const per = Math.max(1, Math.floor(PARAM_LIMIT / allCols.length));
    const head = `INSERT INTO ${table} (${allCols.join(',')}) VALUES `;
    for (let i = 0; i < rows.length; i += per) {
      const chunk = rows.slice(i, i + per);
      const params: unknown[] = [];
      const tuples: string[] = [];
      for (const r of chunk) {
        const ph: string[] = [];
        for (const c of cols) { params.push(param(r[c])); ph.push(`$${params.length}`); }
        if (addUser) { params.push(userId); ph.push(`$${params.length}`); }
        tuples.push(`(${ph.join(',')})`);
      }
      await tx.executeQuery(CompiledQuery.raw(head + tuples.join(',') + ' ON CONFLICT DO NOTHING', params));
    }
    return rows.length;
  }
  const base = (kw: Row): Row => ({ company_id: COMPANY, ...kw });
  const counts = new Map<string, { rows: number; source: string }>();
  const done = (tbl: string, n: number, source = '') => counts.set(tbl, { rows: (counts.get(tbl)?.rows ?? 0) + n, source });

  /* ------------------------------------------------------------------ company / periods */
  progress('ข้อมูลบริษัทและงวดบัญชี', 2);
  const info: DbfRecord = first('ISINFO') ?? {};
  let TENANT = opts.tenantId;
  if (!TENANT) {
    const TENANT_CODE = process.env.BUDDY_TENANT ?? 'DEFAULT';
    const t = await sql<{ id: string }>`SELECT id FROM sys_tenant WHERE code = ${TENANT_CODE} AND deleted_at IS NULL`.execute(tx);
    if (t.rows[0]) TENANT = t.rows[0].id;
    else TENANT = (await sql<{ id: string }>`INSERT INTO sys_tenant (code, name) VALUES (${TENANT_CODE}, ${TENANT_CODE === 'DEFAULT' ? 'ลูกค้าเริ่มต้น' : TENANT_CODE}) RETURNING id`.execute(tx)).rows[0]!.id;
  }
  const nameTh = (info.THINAM as string | null | undefined) || CO;
  await insert('sys_company', [{ id: COMPANY, tenant_id: TENANT, code: CO.slice(0, 20), name_th: nameTh, name_en: info.ENGNAM,
    address_th: [info.ADDR01, info.ADDR02].filter(T).join(' '), phone: info.TELNUM,
    tax_id: String(or(info.TAXID, '')).slice(0, 13) || null, trade_reg_no: info.TRDREG, year_system: info.YEARTHAI === '1' ? 'B' : 'C' }]);
  const BRANCH = U('branch', 'HO');
  await insert('sys_branch', [base({ id: BRANCH, code: 'HO', name: 'สำนักงานใหญ่', tax_branch_no: '00000', is_head_office: true })]);
  done('sys_company', 1, 'ISINFO'); done('sys_branch', 1, '(สร้างใหม่)');

  const prd = first('ISPRD');
  const PERIODS: Array<[string, string, string]> = [];   // (start, end, id)
  if (prd) {
    for (const suffix of ['', 'NY']) {
      const b1 = prd[`BEG1${suffix}`] as string | null, e12 = prd[`END12${suffix}`];
      if (!T(b1)) continue;
      const fy = U('fy', yearOf(b1!));
      await insert('gl_fiscal_year', [base({ id: fy, code: String(yearOf(b1!) + 543), start_date: b1, end_date: e12 })]); done('gl_fiscal_year', 1, 'ISPRD');
      const rows: Row[] = [];
      for (let i = 1; i <= 12; i++) {
        const b = prd[`BEG${i}${suffix}`] as string, e = prd[`END${i}${suffix}`] as string;
        const pid = U('period', b); PERIODS.push([b, e, pid]);
        rows.push(base({ id: pid, fiscal_year_id: fy, period_no: i, start_date: b, end_date: e, is_locked: prd[`LOCK${i}${suffix}`] === 'Y' }));
      }
      done('gl_period', await insert('gl_period', rows), 'ISPRD');
    }
  }
  async function periodOf(d: V, create = true): Promise<string | null> {
    if (d === null || d === undefined) return null;
    const ds = d as string;
    for (const [b, e, pid] of PERIODS) if (b <= ds && ds <= e) return pid;
    if (!create) return null;
    // วันที่อยู่นอกรอบบัญชี 24 งวดของ Express (ข้อมูลปีเก่า) → สร้างปี/งวดให้
    const y = yearOf(ds), fy = U('fy', y);
    await insert('gl_fiscal_year', [{ id: fy, company_id: COMPANY, code: String(y + 543), start_date: isoOf(y, 1, 1), end_date: isoOf(y, 12, 31), status: 'C' }]);
    for (let m = 1; m <= 12; m++) {
      const b = isoOf(y, m, 1), e = isoOf(y, m, daysInMonth(y, m));
      const pid = U('period', b);
      await insert('gl_period', [{ id: pid, company_id: COMPANY, fiscal_year_id: fy, period_no: m, start_date: b, end_date: e, is_locked: true }]);
      PERIODS.push([b, e, pid]);
    }
    Q('periods_created_for_old_years', y);
    return periodOf(d, false);
  }

  /* ------------------------------------------------------------------ lookups (ISTAB) */
  progress('ตารางรหัสทั่วไป', 4);
  const TYPES: Record<string, string> = {
    '01': 'ธนาคาร', '02': 'สถานะเช็ค', '10': 'สมุดรายวัน', '20': 'หน่วยนับ', '21': 'คลังสินค้า', '22': 'หมวดสินค้า', '23': 'ระดับสินค้า',
    '40': 'เขตการขาย', '41': 'ขนส่งโดย', '42': 'เหตุผลยกเลิก (ขาย)', '43': 'เหตุผลยกเลิก (ซื้อ)', '44': 'สถานะใบเสนอราคา', '45': 'ประเภทลูกค้า',
    '46': 'ประเภทผู้จำหน่าย', '47': 'ประเภทพนักงานขาย', '50': 'แผนก', '51': 'คำนำหน้าชื่อ', '52': 'หมวดทรัพย์สิน', '53': 'สถานะเงินสดย่อย', '55': 'แบบภาษีหัก ณ ที่จ่าย', '60': 'ฤดูกาล/Collection',
  };
  await insert('md_lookup_type', Object.entries(TYPES).map(([k, v]) => ({ id: U('lt', k), code: k, name_th: v })));
  type Cache = Map<DbfValue, string>;
  const UNIT: Cache = new Map(), WH: Cache = new Map(), DEPT: Cache = new Map(), BANK: Cache = new Map();
  const lkRows: Row[] = [], seen = new Set<string>();
  for (const r of dbf('ISTAB')) {
    const tt = st(r.TABTYP) as string | null;
    let code = st(r.TYPCOD) as string | null;
    if (!T(tt) || !T(code)) continue;
    const name = (r.TYPDES || r.SHORTNAM || code) as string;
    const short = { short_th: st(r.SHORTNAM), short_en: st(r.SHORTNAM2) };
    if (tt === '20') { UNIT.set(code, U('unit', code)); await insert('md_unit', [base({ id: UNIT.get(code), code, name_th: name.slice(0, 60), name_en: String(or(r.TYPDES2, '')).slice(0, 60) || null, rate: r.FLD02, ...short })]); }
    else if (tt === '21') { WH.set(code, U('wh', code)); await insert('md_warehouse', [base({ id: WH.get(code), code, name_th: name, name_en: r.TYPDES2, branch_id: BRANCH, ...short })]); }
    else if (tt === '50') { DEPT.set(code, U('dept', code)); await insert('md_department', [base({ id: DEPT.get(code), code, name_th: name, name_en: r.TYPDES2, short_name_th: st(r.SHORTNAM), short_name_en: st(r.SHORTNAM2) })]); }
    else if (tt === '01') { BANK.set(code, U('bank', code)); await insert('md_bank', [base({ id: BANK.get(code), code, name_th: name, name_en: r.TYPDES2, ...short })]); }
    if (tt === '01' || tt === '20' || tt === '21' || tt === '50') continue;
    if (seen.has(K(tt, code))) {
      let n = 2;
      while (seen.has(K(tt, `${code}-${n}`))) n++;
      Q('istab_duplicate_code_renamed', `${tt}/${code}->${code}-${n}`); code = `${code}-${n}`;
    }
    seen.add(K(tt, code));
    lkRows.push(base({ id: U('lk', tt, code), type_code: tt, code, short_th: r.SHORTNAM, short_en: r.SHORTNAM2, name_th: name, name_en: r.TYPDES2, rate: r.FLD02 }));
  }
  done('md_lookup', await insert('md_lookup', lkRows), 'ISTAB');
  done('md_unit', UNIT.size, 'ISTAB 20'); done('md_warehouse', WH.size, 'ISTAB 21'); done('md_department', DEPT.size, 'ISTAB 50'); done('md_bank', BANK.size, 'ISTAB 01');

  const NAME_TH_TABLES = new Set(['md_unit', 'md_warehouse', 'md_department', 'md_item_account_group', 'md_item', 'md_asset_account_group', 'md_bank']);
  /** หา id ของรหัสในแฟ้มหลัก ถ้าไม่มีให้สร้าง placeholder */
  async function ref(cache: Cache, table: string, codeIn: V, kind: string, extra: Row = {}): Promise<string | null> {
    const code = st(codeIn);
    if (!T(code)) return null;
    if (cache.has(code)) return cache.get(code)!;
    const i = U(kind, code); cache.set(code, i);
    const cs = pyStr(code);
    const row = base({ id: i, code: cs.slice(0, 30) }); Object.assign(row, extra);
    if (NAME_TH_TABLES.has(table)) { if (!('name_th' in row)) row.name_th = `[MISSING] ${cs}`; }
    else row.name = `[MISSING] ${cs}`;
    if (table !== 'md_unit') row.status = 'I';
    await insert(table, [row]); Q(`missing_${table}`, code);
    return i;
  }

  /* ------------------------------------------------------------------ chart of accounts */
  progress('ผังบัญชี', 6);
  const ACC: Cache = new Map();
  const accs = [...dbf('GLACC')];
  for (const r of accs) ACC.set(st(r.ACCNUM), U('acc', st(r.ACCNUM)));
  {
    const rows: Row[] = [];
    for (const r of accs) {
      const a = st(r.ACCNUM);
      const g = r.GROUP;
      rows.push(base({ id: ACC.get(a), account_no: a, name_th: r.ACCNAM || a, name_en: r.ACCNAM2, parent_id: ACC.get(st(r.PARENT)) ?? null,
        level: pyInt(or(r.LEVEL, 1)), account_group: typeof g === 'string' && g !== '' && '12345'.includes(g) ? g : '5',
        is_control: r.ACCTYP === '1', normal_side: r.NATURE === '1' ? 'C' : 'D', use_department: r.USEDEP === 'Y',
        use_project: r.USEJOB === 'Y', status: or(r.STATUS, 'A') === 'A' ? 'A' : 'I' }));
    }
    done('gl_account', await insert('gl_account', rows), 'GLACC');
  }
  async function acc(codeIn: V): Promise<string | null> {
    const code = st(codeIn);
    if (!T(code)) return null;
    if (!ACC.has(code)) {
      ACC.set(code, U('acc', code)); Q('missing_gl_account', code);
      await insert('gl_account', [base({ id: ACC.get(code), account_no: code, name_th: `[MISSING] ${pyStr(code)}`, account_group: '5', normal_side: 'D', status: 'I' })]);
    }
    return ACC.get(code)!;
  }

  /* ------------------------------------------------------------------ doc types / journals / payment methods (ISRUN) */
  progress('ประเภทเอกสารและสมุดรายวัน', 8);
  const JB: Cache = new Map(), DT = new Map<string, string>(), PM = new Map<string, string>(), DTCLASS = new Map<string, string>();
  const run = [...dbf('ISRUN')];
  for (const r of run) {
    if (st(r.DOCTYP) === 'GL') {
      const c = st(r.DOCCOD); JB.set(c, U('jb', c));
      await insert('gl_journal_book', [base({ id: JB.get(c), code: c, prefix: st(r.PREFIX), name_th: r.POSDES, name_en: r.POSDES2 })]);
    }
  }
  done('gl_journal_book', JB.size, "ISRUN DOCTYP='GL'");

  // ต้นแบบวิธีการบันทึก (GLTPL / GLTPLIT — คู่มือบทที่ 15 S-GL-01)
  const TPL: Cache = new Map();
  for (const r of dbf('GLTPL')) {
    const c = st(r.TPLCOD);
    if (!T(c) || TPL.has(c)) continue;
    TPL.set(c, U('tpl', c));
    await insert('gl_template', [base({ id: TPL.get(c), code: c, name: r.DESCRP || c, name_en: r.DESCRP2 ?? null })]);
  }
  done('gl_template', TPL.size, 'GLTPL');
  {
    const tplRows: Row[] = [], tplNo = new Map<DbfValue, number>();
    for (const r of dbf('GLTPLIT')) {   // ลำดับบรรทัด = ลำดับในแฟ้ม (GLTPLIT ไม่มีเลขบรรทัด)
      const c = st(r.TPLCOD);
      if (!TPL.has(c)) { Q('template_line_without_header', c); continue; }
      const n = (tplNo.get(c) ?? 0) + 1; tplNo.set(c, n);
      // ต้นแบบตัวอย่างของ Express อ้างเลขบัญชีจากผังอื่นได้ — ไม่สร้างบัญชี placeholder แต่เว้นบัญชีว่างให้ผู้ใช้เลือกตอนใช้
      const a = st(r.ACCNUM);
      if (T(a) && !ACC.has(a)) Q('template_account_missing', `${pyStr(c)}:${pyStr(a)}`);
      tplRows.push(base({ id: U('tplit', c, n), template_id: TPL.get(c), line_no: n, account_id: T(a) ? ACC.get(a) ?? null : null,
        department_id: T(st(r.DEPCOD)) ? (DEPT.get(st(r.DEPCOD)) || await ref(DEPT, 'md_department', r.DEPCOD, 'dept')) : null,
        description: r.DESCRP, side: r.JNLTYP === '1' ? 'C' : 'D', amount: money(r.AMOUNT) || null }));
    }
    done('gl_template_line', await insert('gl_template_line', tplRows), 'GLTPLIT');
  }
  const MODULE: Record<string, string> = {
    OB: 'IC', QT: 'SO', SO: 'SO', AI: 'AR', IV: 'AR', HS: 'AR', DR: 'AR', CN: 'AR', OI: 'AR', BS: 'AR', RE: 'AR',
    PO: 'PO', AE: 'AP', RR: 'AP', HP: 'AP', CP: 'AP', DN: 'AP', OE: 'AP', BR: 'AP', PS: 'AP',
    OU: 'IC', RL: 'IC', JU: 'IC', CA: 'IC', BD: 'BK', BW: 'BK', BT: 'BK', BU: 'BK', BV: 'BK', BQ: 'BK', QP: 'BK', DP: 'PC', VR: 'PC',
  };
  const moduleOf = (c: string) => (Object.prototype.hasOwnProperty.call(MODULE, c) ? MODULE[c]! : 'GL');
  // คำอธิบายในสมุดรายวันของ Express เป็นนิพจน์ xBase → แม่แบบ {party.title} {party.name} (renderJournalDesc ใน packages/core)
  const JNL_FIELD: Record<string, string> = {
    'ARMAS->PRENAM': '{party.title}', 'ARMAS->CUSNAM': '{party.name}', 'APMAS->PRENAM': '{party.title}', 'APMAS->SUPNAM': '{party.name}',
    'BKMAS->SHORTNAM': '{bank.short_name}', 'BKMAS->BNKNAM': '{bank.name}', 'BKTRN->REMARK': '{doc.remark}', 'STCRD->STKDES': '{line.item_name}',
  };
  const stripChars = (s: string, chars: string) => { let a = 0, b = s.length; while (a < b && chars.includes(s[a]!)) a++; while (b > a && chars.includes(s[b - 1]!)) b--; return s.slice(a, b); };
  function jnlTpl(e: V): string | null {
    if (typeof e !== 'string' || !pyStrip(e)) return null;
    const out: string[] = [];
    for (let t of e.split(/(?:\+|-(?!>))(?=(?:[^']*'[^']*')*[^']*$)/)) {
      t = pyStrip(stripChars(pyStrip(t), '()'));
      if (!t) continue;
      if (t.length >= 2 && t[0] === "'" && t[t.length - 1] === "'") { out.push(t.slice(1, -1)); continue; }
      const f = JNL_FIELD[t.toUpperCase()];
      if (!f) { Q('journal_desc_kept_express', pyStrip(e)); return pyStrip(e); }
      out.push(f);
    }
    return pyStrip(out.join('').replace(WS_RE, ' ')) || null;
  }
  const dtRows: Row[] = [], dtaRows: Row[] = [], pmRows: Row[] = [];
  for (const r of run) {
    const typ = st(r.DOCTYP) as string | null, pre = st(r.PREFIX) as string | null;
    if (!T(typ) || !T(pre) || typ === 'GL') continue;
    const accts = Array.from({ length: 12 }, (_, i) => st(r[`ACCNUM${String(i + 1).padStart(2, '0')}`]));
    if (typ === 'ZR' || typ === 'ZP') {
      const d = typ === 'ZR' ? 'R' : 'P';
      if (PM.has(K(d, pre))) { Q('payment_method_duplicate', `${typ}/${pre}`); continue; }
      PM.set(K(d, pre), U('pm', d, pre));
      const nm = (r.POSDES || pre) as string;
      const kind = nm.includes('เช็ค') ? 'CHEQUE' : nm.includes('เงินสด') && !nm.includes('ย่อย') ? 'CASH' : nm.includes('โอน') ? 'TRANSFER'
        : nm.includes('หัก ณ') || nm.includes('หัก\xa0ณ') ? 'WHT' : nm.includes('มัดจำ') ? 'DEPOSIT' : 'OTHER';
      pmRows.push(base({ id: PM.get(K(d, pre)), direction: d, code: pre, seq: st(r.DOCCOD), name_th: nm, name_en: r.POSDES2, kind,
        gl_account_id: await acc(accts[0]), creates_cheque: kind === 'CHEQUE' || kind === 'TRANSFER', bank_account_id: st(r.SHORTNAM) }));   // รหัสบัญชีเงินฝาก แปลงเป็น id หลังนำเข้า BKMAS
      continue;
    }
    if (DT.has(pre!)) { Q('doc_type_duplicate_prefix', pre); continue; }
    DT.set(pre!, U('dt', pre)); DTCLASS.set(pre!, typ!);
    const docnum = st(r.DOCNUM);
    dtRows.push(base({ id: DT.get(pre!), code: pre, doc_class: typ, module: moduleOf(typ!), name_th: r.POSDES || pre, name_en: r.POSDES2,
      short_name: st(r.SHORTNAM), next_no: isDigit(docnum) && pyInt(docnum) > 0 ? pyInt(docnum) : 1,
      journal_book_id: JB.get(st(r.JNLTYP)) ?? null, journal_desc_template: jnlTpl(r.JNLEXP),
      warehouse_id: WH.get(st(r.LOCCOD)) ?? null, price_type: ['0', '1', '2'].includes(r.FLGVAT as string) ? r.FLGVAT : null, vat_rate: r.VATRAT,
      vat_basis: ['1', '2', '3'].includes(r.SRV_VATTYP as string) ? r.SRV_VATTYP : null,
      approve_method: r.APPROV_MET, approve_level: isDigit(or(r.APPROV_LEV, '')) ? pyInt(r.APPROV_LEV) : null,
      reprint_level: isDigit(or(r.REPRN_LEV, '')) ? pyInt(r.REPRN_LEV) : null,
      is_tax_invoice: ['IV', 'HS', 'DR', 'CN', 'AI', 'RE'].includes(typ!) }));
    for (let i = 1; i <= 12; i++) {
      const a = accts[i - 1];
      if (T(a)) dtaRows.push(base({ id: U('dta', pre, i), doc_type_id: DT.get(pre!), slot: i, account_id: await acc(a) }));
    }
  }
  done('md_doc_type', await insert('md_doc_type', dtRows), 'ISRUN'); done('md_doc_type_account', await insert('md_doc_type_account', dtaRows), 'ISRUN.ACCNUMxx');
  async function docType(docnum: DbfValue, fallbackClass: string): Promise<[string, string]> {
    const pre = String(or(docnum, '')).slice(0, 2);
    if (DT.has(pre)) return [DT.get(pre)!, DTCLASS.get(pre)!];
    DT.set(pre, U('dt', pre)); DTCLASS.set(pre, fallbackClass); Q('doc_type_created_for_prefix', pre);
    await insert('md_doc_type', [base({ id: DT.get(pre), code: pre || '??', doc_class: fallbackClass, module: moduleOf(fallbackClass), name_th: `[MISSING] ${pre}`, status: 'I' })]);
    return [DT.get(pre)!, fallbackClass];
  }

  /* ------------------------------------------------------------------ default accounts / journal routes (ISINFO) */
  const ROLES = ['CASH', 'PETTY_CASH_UNUSED', 'AR', 'CHEQUE_RECEIVED', 'INVENTORY', 'PREPAID_TAX', 'INPUT_VAT', 'AP', 'CHEQUE_PAID', 'WHT_PAYABLE', 'OUTPUT_VAT',
    'CASH_SALES', 'CREDIT_SALES', 'SALES_RETURN', 'SALES_DISCOUNT', 'INTEREST_INCOME', 'BANK_INCOME', 'COGS', 'PURCHASES', 'PURCHASE_RETURN',
    'PURCHASE_DISCOUNT', 'INTEREST_EXPENSE', 'BANK_CHARGE', 'RETAINED_EARNINGS', 'SUSPENSE', 'BAD_DEBT', 'OTHER_INCOME', 'OUTPUT_VAT_PENDING',
    'INPUT_VAT_PENDING', 'OTHER_EXPENSE', 'DEPOSIT_PAID', 'DEPOSIT_RECEIVED', 'PETTY_CASH', 'INPUT_VAT_NONCLAIM', 'INPUT_VAT_UNCLAIMABLE'];
  {
    const rows: Row[] = [];
    for (let i = 0; i < ROLES.length; i++) {
      const a = st(info[`ACCNUM${String(i).padStart(2, '0')}`]);
      if (T(a)) rows.push(base({ id: U('gda', ROLES[i]), role: ROLES[i], account_id: await acc(a) }));
    }
    done('gl_default_account', await insert('gl_default_account', rows), 'ISINFO.ACCNUM00–34');
  }
  const JR: Record<string, string> = {
    CSHPURJNL: 'CASH_PURCHASE', CREPURJNL: 'CREDIT_PURCHASE', PURRETJNL: 'PURCHASE_RETURN', OTHEXPJNL: 'OTHER_EXPENSE', APRCPJNL: 'AP_PAYMENT',
    PASPCQJNL: 'PASS_CHEQUE_PAID', CSHSALJNL: 'CASH_SALE', CRESALJNL: 'CREDIT_SALE', SALRETJNL: 'SALES_RETURN', OTHINCJNL: 'OTHER_INCOME',
    ARRCPJNL: 'AR_RECEIPT', PASRCQJNL: 'PASS_CHEQUE_RCV', INTISSJNL: 'INTERNAL_ISSUE', TAKADJJNL: 'STOCK_COUNT_ADJ', COSADJJNL: 'COST_ADJ',
    BADDBTJNL: 'BAD_DEBT', BNKMOVJNL: 'BANK_MOVEMENT', INCCHQJNL: 'CHEQUE_EXCESS_INCOME', EXPCHQJNL: 'CHEQUE_EXCESS_EXPENSE',
    ARADVJNL: 'AR_DEPOSIT', APADVJNL: 'AP_DEPOSIT', FADPRJNL: 'DEPRECIATION', ARDNJNL: 'AR_DEBIT_NOTE', APCNJNL: 'AP_CREDIT_NOTE',
  };
  done('gl_journal_route', await insert('gl_journal_route', Object.entries(JR).filter(([k]) => JB.has(st(info[k]))).map(([k, v]) => base({ id: U('jr', k), txn_kind: v, journal_book_id: JB.get(st(info[k])) }))), 'ISINFO.*JNL');

  /* ------------------------------------------------------------------ account groups (ISACC) */
  const IAG: Cache = new Map(), AAG: Cache = new Map();
  for (const r of dbf('ISACC')) {
    const c = st(r.ACCCOD);
    if (r.ACCTYP === 'S') {
      IAG.set(c, U('iag', c));
      await insert('md_item_account_group', [base({ id: IAG.get(c), code: c, name_th: r.ACCDES || c, name_en: r.ACCDES2,
        cost_method: r.METHOD === 'F' || r.METHOD === 'A' ? r.METHOD : null, item_specific: r.METHOD === '-',
        inventory_account_id: await acc(r.ACCNUM01), cogs_account_id: await acc(r.ACCNUM02), sales_account_id: await acc(r.ACCNUM03),
        sales_return_account_id: await acc(r.ACCNUM04), purchase_account_id: await acc(r.ACCNUM05), purchase_return_account_id: await acc(r.ACCNUM06) })]);
    } else {
      AAG.set(c, U('aag', c));
      await insert('md_asset_account_group', [base({ id: AAG.get(c), code: c, name_th: r.ACCDES || c, name_en: r.ACCDES2,
        asset_account_id: await acc(r.ACCNUM01), depr_expense_account_id: await acc(r.ACCNUM02), accum_depr_account_id: await acc(r.ACCNUM03) })]);
    }
  }
  done('md_item_account_group', IAG.size, "ISACC 'S'"); done('md_asset_account_group', AAG.size, "ISACC 'F'");

  /* ------------------------------------------------------------------ parties */
  progress('พนักงานขาย ลูกค้า ผู้จำหน่าย', 10);
  const SLM: Cache = new Map(), CUS: Cache = new Map(), SUP: Cache = new Map(), ITEM: Cache = new Map(), BKA: Cache = new Map();
  {
    const rows: Row[] = [], targets: Row[] = [];
    for (const r of dbf('OESLM')) {
      const c = st(r.SLMCOD); SLM.set(c, U('slm', c));
      rows.push(base({ id: SLM.get(c), code: c, name: r.SLMNAM || c, position: r.POSITN, salesperson_type: st(r.SLMTYP), sales_area_code: st(r.AREACOD),
        commission_rate: r.COMRATE, address: [r.ADDR01, r.ADDR02, r.ADDR03].filter(T).join('\n') || null, zip_code: st(r.ZIPCOD),
        phone: r.TELNUM, tax_id: String(or(r.TAXID, '')).slice(0, 13) || null, social_security_no: r.SOCIALID,
        status: r.STATUS === 'I' ? 'I' : 'A' }));
      // เป้าการขาย 24 งวด: TAR1–12 ปีปัจจุบัน, TAR1NY–12NY ปีหน้า (คู่มือบทที่ 7 S-SO-01)
      if (prd) {
        for (let i = 1; i <= 12; i++) {
          for (const [col, sfx] of [[`TAR${i}`, ''], [`TAR${i}NY`, 'NY']] as const) {
            const amt = money(r[col]); const start = prd[`BEG${i}${sfx}`];
            const pid = T(amt) && T(start) ? await periodOf(start, false) : null;
            if (T(pid)) targets.push(base({ id: U('slmtar', c, pid), salesperson_id: SLM.get(c), period_id: pid, target_amount: amt }));
          }
        }
      }
    }
    done('md_salesperson', await insert('md_salesperson', rows), 'OESLM');
    done('md_sales_target', await insert('md_sales_target', targets), 'OESLM.TAR1–TAR12NY');
  }
  const sup = async (c: V) => SUP.get(st(c)) || ref(SUP, 'md_supplier', c, 'sup');
  const cus = async (c: V) => CUS.get(st(c)) || ref(CUS, 'md_customer', c, 'cus');
  const slm = async (c: V) => SLM.get(st(c)) || ref(SLM, 'md_salesperson', c, 'slm');
  const unit = async (c: V) => UNIT.get(st(c)) || ref(UNIT, 'md_unit', c, 'unit');
  const wh = async (c: V) => WH.get(st(c)) || ref(WH, 'md_warehouse', c, 'wh');
  const dept = async (c: V) => DEPT.get(st(c)) || ref(DEPT, 'md_department', c, 'dept');
  {
    const rows: Row[] = [];
    for (const r of dbf('ARMAS')) {
      const c = st(r.CUSCOD); CUS.set(c, U('cus', c));
      rows.push(base({ id: CUS.get(c), code: c, customer_type: st(r.CUSTYP), title: r.PRENAM, name: r.CUSNAM || c, name_en: r.CUSNAM2,
        address_1: r.ADDR01, address_2: r.ADDR02, address_3: r.ADDR03, zip_code: st(r.ZIPCOD), phone: r.TELNUM, contact: r.CONTACT,
        tax_id: String(or(st(r.TAXID), '')).slice(0, 13) || null, salesperson_id: SLM.get(st(r.SLMCOD)) || await ref(SLM, 'md_salesperson', r.SLMCOD, 'slm'),
        sales_area_code: st(r.AREACOD), ship_via_code: st(r.DLVBY), credit_days: T(r.PAYTRM) ? pyInt(r.PAYTRM) : null,
        payment_terms: r.PAYCOND, price_level: r.TABPR, discount_text: st(r.DISC), credit_limit: nz(r.CRLINE),
        ar_account_id: await acc(r.ACCNUM), wht_form: st(r.TAXTYP), wht_rate: r.TAXRAT, remark: r.REMARK,
        wht_category: st(r.TAXGRP), wht_condition: st(r.TAXCOND), default_ship_to: st(r.SHIPTO), track_sales: st(r.TRACKSAL),
        status: r.STATUS === 'I' ? 'I' : 'A', inactive_date: r.INACTDAT }));
    }
    done('md_customer', await insert('md_customer', rows), 'ARMAS');
  }
  {
    const rows: Row[] = [];
    for (const r of dbf('ARSHIP')) {
      const cc = st(r.CUSCOD);
      const cid = cc === '@@@@@@@@@@' ? null : (CUS.get(cc) || await ref(CUS, 'md_customer', cc, 'cus'));
      const sid = U('ship', cc, st(r.SHIPTO));
      rows.push(base({ id: sid, customer_id: cid, code: st(r.SHIPTO), address_1: r.ADDR01, address_2: r.ADDR02, address_3: r.ADDR03,
        zip_code: st(r.ZIPCOD), phone: r.TELNUM, contact: r.CONTACT }));
    }
    done('md_customer_ship_to', await insert('md_customer_ship_to', rows), 'ARSHIP');
  }
  {
    const rows: Row[] = [];
    for (const r of dbf('APMAS')) {
      const c = st(r.SUPCOD); SUP.set(c, U('sup', c));
      rows.push(base({ id: SUP.get(c), code: c, supplier_type: st(r.SUPTYP), title: r.PRENAM, name: r.SUPNAM || c, name_en: r.SUPNAM2,
        address_1: r.ADDR01, address_2: r.ADDR02, address_3: r.ADDR03, zip_code: st(r.ZIPCOD), phone: r.TELNUM, contact: r.CONTACT,
        tax_id: String(or(st(r.TAXID), '')).slice(0, 13) || null, price_type: ['0', '1', '2'].includes(r.FLGVAT as string) ? r.FLGVAT : null, vat_rate: r.VATRAT,
        ship_via_code: st(r.DLVBY), credit_days: T(r.PAYTRM) ? pyInt(r.PAYTRM) : null, payment_terms: r.PAYCOND,
        discount_text: st(r.DISC), credit_limit: nz(r.CRLINE), ap_account_id: await acc(r.ACCNUM), wht_form: st(r.TAXTYP),
        wht_income_desc: r.TAXDES, wht_rate: r.TAXRAT, wht_condition: st(r.TAXCOND), on_hold: r.ONHOLD === 'Y',
        remark: r.REMARK, status: r.STATUS === 'I' ? 'I' : 'A', inactive_date: r.INACTDAT }));
    }
    done('md_supplier', await insert('md_supplier', rows), 'APMAS');
  }
  {
    const rows: Row[] = [];
    for (const r of dbf('BKMAS')) {
      const c = st(r.BNKACC); BKA.set(c, U('bka', c));
      const k = String(c ?? '').slice(0, 1);
      rows.push(base({ id: BKA.get(c), code: c, name: r.BNKNAM || c, branch: r.BRANCH, short_name: r.SHORTNAM, account_number: st(r.BNKNUM),
        account_kind: 'CSF'.includes(k) ? k : null, gl_account_id: await acc(r.ACCNUM), opening_balance: r.BALFWD, opening_date: r.BALDAT }));
    }
    done('md_bank_account', await insert('md_bank_account', rows), 'BKMAS');
  }
  // วิธีรับ/จ่ายชำระ: ช่อง "ธนาคาร" (ISRUN.SHORTNAM) อ้างบัญชีเงินฝาก — นำเข้าหลัง BKMAS
  for (const r of pmRows) {
    const b = r.bank_account_id as DbfValue;
    r.bank_account_id = T(b) ? BKA.get(b) ?? null : null;
    if (T(b) && !T(r.bank_account_id)) Q('payment_method_bank_missing', `${r.direction}/${r.code}:${pyStr(b)}`);
  }
  done('md_payment_method', await insert('md_payment_method', pmRows), "ISRUN DOCTYP='ZR'/'ZP'");

  /* ------------------------------------------------------------------ items */
  progress('สินค้า', 15);
  const items = [...dbf('STMAS')];
  {
    const c = new Map<DbfValue, number>();
    for (const r of items) c.set(st(r.STKCOD), (c.get(st(r.STKCOD)) ?? 0) + 1);
    QUALITY.set('stmas_duplicate_code_skipped', [...QUALITY.get('stmas_duplicate_code_skipped') ?? [], ...[...c].filter(([, v]) => v > 1).map(([k]) => pyStr(k))]);
  }
  for (const r of items) ITEM.set(st(r.STKCOD), U('item', st(r.STKCOD)));
  const ITYPE = new Map<DbfValue, DbfValue>();
  for (const r of items) ITYPE.set(st(r.STKCOD), r.STKTYP ?? null);
  const item = async (c: V) => (T(st(c)) ? ITEM.get(st(c)) || ref(ITEM, 'md_item', c, 'item', { name_th: `[MISSING] ${pyStr(st(c))}`, item_type: '0' }) : null);
  {
    const rows: Row[] = [];
    for (const r of items) {
      const c = st(r.STKCOD);
      rows.push(base({ id: ITEM.get(c), code: c, item_type: ['0', '1', '2', '3', '4', '5'].includes(r.STKTYP as string) ? r.STKTYP : '0', barcode: st(r.BARCOD),
        name_th: r.STKDES || c, name_en: r.STKDES2, item_level: st(r.STKLEV), category_code: st(r.STKGRP),
        account_group_id: IAG.get(st(r.ACCCOD)) || (T(st(r.ACCCOD)) ? await ref(IAG, 'md_item_account_group', r.ACCCOD, 'iag') : null),
        base_unit_id: await unit(r.QUCOD), count_unit_id: await unit(r.CQUCOD), count_factor: nz(r.CFACTOR),
        purchase_unit_id: await unit(r.PQUCOD), purchase_factor: or(r.PFACTOR, 1), sales_unit_id: await unit(r.SQUCOD), sales_factor: or(r.SFACTOR, 1),
        std_cost: nz(r.STNPR), price_1: nz(r.SELLPR1), price_2: nz(r.SELLPR2), price_3: nz(r.SELLPR3), price_4: nz(r.SELLPR4), price_5: nz(r.SELLPR5),
        vat_code: st(r.VATCOD), allow_negative: st(r.NEGALLOW), default_supplier_id: T(st(r.SUPCOD)) ? await sup(r.SUPCOD) : null,
        packing: r.PACKING, udf_1: st(r.STR1), udf_2: st(r.STR2), udf_3: st(r.STR3), udf_4: String(or(r.STR4, '')).slice(0, 30) || null,
        udf_date_1: r.DAT1, udf_date_2: r.DAT2, udf_num_1: nz(r.NUM1), remark: r.REMARK, status: r.STATUS === 'I' ? 'I' : 'A', inactive_date: r.INACTDAT }));
    }
    done('md_item', await insert('md_item', rows), 'STMAS');
  }
  {
    const rows: Row[] = [];
    for (const r of dbf('STBOM')) {
      rows.push(base({ id: U('bom', st(r.PSTKCOD), st(r.SEQNUM)), parent_item_id: await item(r.PSTKCOD), line_no: pyInt(or(st(r.SEQNUM), 0)),
        component_item_id: await item(r.STKCOD), qty: or(r.BOMQTY, 0), std_cost: r.STNPR, sell_price: r.SELLPR, warehouse_id: T(st(r.LOCCOD)) ? await wh(r.LOCCOD) : null }));
    }
    done('md_item_bom', await insert('md_item_bom', rows), 'STBOM');
  }

  /* ------------------------------------------------------------------ document headers */
  progress('หัวเอกสาร', 22);
  const HDR = new Map<string, string>();   // K(module, docnum) -> id
  async function hdrRow(docnum: DbfValue, typFallback: string, module: string, d: V, forceClass: string | null, kw: Row): Promise<Row> {
    const [dtid, dclass0] = await docType(docnum, typFallback);
    let dclass = dclass0;
    if (T(forceClass) && forceClass !== dclass) { Q('doc_class_from_rectype_differs_from_prefix', `${pyStr(docnum)}:${dclass}->${forceClass}`); dclass = forceClass!; }
    const hid = U('doc', module, docnum); HDR.set(K(module, docnum), hid); if (!HDR.has(K('*', docnum))) HDR.set(K('*', docnum), hid);
    const row = base({ id: hid, branch_id: BRANCH, doc_type_id: dtid, doc_class: dclass, module, doc_no: docnum, doc_date: or(d, '1900-01-01'), period_id: await periodOf(d) });
    Object.assign(row, kw); return row;
  }
  const status = (v: V) => (v === 'N' || v === 'M' || v === 'C' ? v : 'N');
  const has = (o: Record<string, string>, k: V) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
  const RECTYP_AR: Record<string, string> = { '0': 'AI', '1': 'HS', '3': 'IV', '4': 'DR', '5': 'CN', '7': 'OI', '9': 'RE' };
  const RECTYP_AP: Record<string, string> = { '0': 'AE', '1': 'HP', '3': 'RR', '4': 'CP', '5': 'DN', '7': 'OE', '9': 'PS' };
  const LINKS: Array<[string, DbfValue, string, V, string]> = [], BILLS: Array<[string, DbfValue, string, V]> = [];
  async function trnRows(table: string, module: string, rmap: Record<string, string>, party: 'C' | 'S'): Promise<Row[]> {
    const out: Row[] = [];
    for (const r of dbf(table)) {
      const dn = st(r.DOCNUM);
      const p: Row = party === 'C' ? { customer_id: await cus(r.CUSCOD) } : { supplier_id: await sup(r.SUPCOD) };
      const fc = has(rmap, r.RECTYP) ? rmap[r.RECTYP as string]! : null;
      const kw: Row = { express_rectype: r.RECTYP, ...p,
        salesperson_id: T(st(r.SLMCOD)) ? await slm(r.SLMCOD) : null, department_id: T(st(r.DEPCOD)) ? await dept(r.DEPCOD) : null,
        sales_area_code: st(r.AREACOD), ship_via_code: st(r.DLVBY), your_ref: r.YOUREF ?? null, ref_no: st(r.REFNUM),
        credit_days: T(r.PAYTRM) ? pyInt(r.PAYTRM) : null, due_date: r.DUEDAT ?? null,
        price_type: ['0', '1', '2'].includes(r.FLGVAT as string) ? r.FLGVAT : '0',
        amount: money(r.AMOUNT), discount_text: st(r.DISC), discount_amount: money(r.DISCAMT), amount_after_discount: money(r.AFTDISC),
        deposit_amount: money(r.ADVAMT), zero_rate_amount: money(r.AMTRAT0), taxable_amount: money(r.TOTAL),
        vat_rate: r.VATRAT ?? null, vat_amount: money(r.VATAMT), net_amount: money(r.NETAMT), wht_amount: money(r.TAX),
        cash_amount: money(or(r.CSHRCV, r.CSHPAY)), cheque_amount: money(or(r.CHQRCV, r.CHQPAY)),
        interest_amount: money(or(r.INTRCV, r.INTPAY)), settled_amount: money(party === 'C' ? r.RCVAMT : r.PAYAMT),
        outstanding_amount: money(r.REMAMT), commission_amount: money(r.COMAMT),
        vat_basis: ['1', '2', '3'].includes(r.SRV_VATTYP as string) ? r.SRV_VATTYP : null, vat_date: r.VATDAT ?? null,
        vat_period_id: T(r.VATPRD) ? await periodOf(r.VATPRD) : null, vat_late: r.VATLATE === 'Y',
        doc_status: status(r.DOCSTAT), is_settled: r.CMPLAPP === 'Y', settled_date: r.CMPLDAT ?? null,
        gl_posted: r.POSTGL === 'Y' ? 'Y' : 'N', print_count: T(r.PRNCNT) ? pyInt(or(r.PRNCNT, 0)) : 0 };
      out.push(await hdrRow(dn, fc ?? 'IV', module, r.DOCDAT, fc, kw));
      if (T(r.SONUM) && T(st(r.SONUM))) LINKS.push([st(r.SONUM) as string, dn, 'FULFIL', null, module]);
      if (T(r.PONUM) && T(st(r.PONUM)) && st(r.PONUM) !== 'PO...') LINKS.push([st(r.PONUM) as string, dn, 'FULFIL', null, module]);
      const adv = st(r.ADVNUM);
      if (typeof adv === 'string' && adv.length > 3 && !adv.endsWith('...')) LINKS.push([adv, dn, 'DEPOSIT', r.ADVAMT ?? null, module]);
      const bil = st(r.BILNUM);
      if (T(bil) && bil !== '~') BILLS.push([bil as string, dn, module, r.NETAMT ?? null]);
    }
    return out;
  }
  done('doc_header', await insert('doc_header', await trnRows('ARTRN', 'AR', RECTYP_AR, 'C')), 'ARTRN');
  done('doc_header', await insert('doc_header', await trnRows('APTRN', 'AP', RECTYP_AP, 'S')), 'APTRN');
  {
    const rows: Row[] = [];
    for (const r of dbf('OESO')) {
      const dn = st(r.SONUM);
      const kw: Row = { express_rectype: r.SORECTYP, customer_id: await cus(r.CUSCOD),
        salesperson_id: T(st(r.SLMCOD)) ? await slm(r.SLMCOD) : null, department_id: T(st(r.DEPCOD)) ? await dept(r.DEPCOD) : null,
        sales_area_code: st(r.AREACOD), ship_via_code: st(r.DLVBY), your_ref: r.YOUREF, credit_days: T(r.PAYTRM) ? pyInt(r.PAYTRM) : null,
        delivery_date: r.DLVDAT, delivery_date_per_line: r.DLVDAT_IT === 'Y', price_type: ['0', '1', '2'].includes(r.FLGVAT as string) ? r.FLGVAT : '0',
        amount: money(r.AMOUNT), taxable_amount: money(r.TOTAL), vat_rate: r.VATRAT, vat_amount: money(r.VATAMT), net_amount: money(r.NETAMT),
        doc_status: status(r.DOCSTAT), settled_date: r.CMPLDAT, is_settled: r.DOCSTAT === 'M' };
      rows.push(await hdrRow(dn, r.SORECTYP === '5' ? 'QT' : 'SO', 'SO', r.SODAT, null, kw));
    }
    done('doc_header', await insert('doc_header', rows), 'OESO');
  }
  {
    const rows: Row[] = [];
    for (const r of dbf('POPR')) {
      const dn = st(r.PONUM);
      const kw: Row = { express_rectype: r.PORECTYP, supplier_id: await sup(r.SUPCOD),
        department_id: T(st(r.DEPCOD)) ? await dept(r.DEPCOD) : null, your_ref: r.YOUREF, credit_days: T(r.PAYTRM) ? pyInt(r.PAYTRM) : null,
        delivery_date: r.RCVDAT, delivery_date_per_line: r.RCVDAT_IT === 'Y', price_type: ['0', '1', '2'].includes(r.FLGVAT as string) ? r.FLGVAT : '0',
        amount: money(r.AMOUNT), discount_text: st(r.DISC), discount_amount: money(r.DISCAMT), taxable_amount: money(r.TOTAL),
        vat_rate: r.VATRAT, vat_amount: money(r.VATAMT), net_amount: money(r.NETAMT), doc_status: status(r.DOCSTAT), settled_date: r.CMPLDAT,
        is_settled: r.DOCSTAT === 'M', print_count: pyInt(or(r.PRNCNT, 0)) };
      rows.push(await hdrRow(dn, 'PO', 'PO', r.PODAT, null, kw));
    }
    done('doc_header', await insert('doc_header', rows), 'POPR');
  }
  const STTRN_CLASS: Record<string, string> = { '4': 'RL', '5': 'CA', '6': 'OU', '8': 'JU', ':': 'JU' };
  {
    const rows: Row[] = [];
    for (const r of dbf('STTRN')) {
      const dn = st(r.DOCNUM);
      const kw: Row = { express_rectype: r.POSOPR, warehouse_id: await wh(r.LOCCOD),
        to_warehouse_id: r.POSOPR === '4' && T(st(r.PEOPLE)) ? await wh(r.PEOPLE) : null, department_id: T(st(r.DEPCOD)) ? await dept(r.DEPCOD) : null,
        remark: r.REMARK, ref_no: st(r.REFNUM), ref_date: r.REFDAT, net_amount: money(r.TRNVAL), doc_status: status(r.DOCSTAT),
        gl_posted: r.POSTGL === 'Y' ? 'Y' : 'N', print_count: T(r.PRNCNT) ? pyInt(or(r.PRNCNT, 0)) : 0 };
      rows.push(await hdrRow(dn, has(STTRN_CLASS, r.POSOPR) ? STTRN_CLASS[r.POSOPR as string]! : 'JU', 'IC', r.DOCDAT, null, kw));
    }
    done('doc_header', await insert('doc_header', rows), 'STTRN');
  }
  for (const [table, module, party] of [['ARBIL', 'AR', 'C'], ['APBIL', 'AP', 'S']] as const) {
    const rows: Row[] = [];
    for (const r of dbf(table)) {
      const dn = st(r.BILNUM);
      const p: Row = party === 'C' ? { customer_id: await cus(r.CUSCOD) } : { supplier_id: await sup(r.SUPCOD) };
      rows.push(await hdrRow(dn, party === 'C' ? 'BS' : 'BR', module, r.BILDAT, null, { ...p, appointment_date: r.APPDAT, payment_terms: r.PAYCOND,
        remark: r.REMARK, net_amount: money(r.NETAMT), doc_status: status(r.DOCSTAT), print_count: T(r.PRNCNT) ? pyInt(or(r.PRNCNT, 0)) : 0 }));
    }
    done('doc_header', await insert('doc_header', rows), table);
  }
  {
    const rows: Row[] = [];
    for (const r of dbf('GLPTT')) {
      const dn = st(r.DOCNUM);
      rows.push(await hdrRow(dn, r.RECTYP === '0' ? 'VR' : 'DP', 'PC', r.DOCDAT, null, { express_rectype: r.RECTYP, remark: r.REMARK,
        net_amount: money(r.AMOUNT), cheque_amount: money(r.CHQAMT), ref_no: st(r.REFNUM), doc_status: status(r.DOCSTAT) }));
    }
    done('doc_header', await insert('doc_header', rows), 'GLPTT');
  }
  const H = (docnum: V, module?: string): string | null => {
    const d = st(docnum);
    if (!T(d)) return null;
    if (module && HDR.has(K(module, d))) return HDR.get(K(module, d))!;
    return HDR.get(K('*', d)) ?? null;
  };

  // links & bills
  {
    const rows: Row[] = [];
    for (const [frm, to, typ, amt, module] of LINKS) {
      const f = H(frm), t = H(to, module);
      if (T(f) && T(t)) rows.push(base({ id: U('link', frm, to, typ), from_header_id: f, to_header_id: t, link_type: typ, amount: T(amt) ? money(amt) : null }));
      else Q('doc_link_target_missing', `${frm}->${pyStr(to)}`);
    }
    done('doc_link', await insert('doc_link', rows), 'ARTRN.SONUM/ADVNUM, APTRN.PONUM/ADVNUM');
  }
  {
    const rows: Row[] = [];
    for (const [bil, dn, module, amt] of BILLS) {
      const b = H(bil, module), i = H(dn, module);
      if (T(b) && T(i)) rows.push(base({ id: U('bill', bil, dn), bill_header_id: b, invoice_header_id: i, amount: money(amt) }));
      else Q('bill_missing', bil);
    }
    done('doc_bill_item', await insert('doc_bill_item', rows), 'ARTRN/APTRN.BILNUM');
  }

  /* ------------------------------------------------------------------ synthetic headers (Express เก็บบางเอกสารเฉพาะบรรทัด เช่น ใบปรับปรุงจากการตรวจนับ TK) */
  progress('เอกสารที่มีแต่บรรทัดรายการ', 30);
  const SYN = new Map<string, [V, string, DbfValue]>();
  const OPEN_DATE = PERIODS.length ? addDays(PERIODS[0]![0], -1) : '2000-01-01';
  const stcrdDoc = (r: DbfRecord): string => {
    const dn = st(r.DOCNUM);
    if (T(dn)) return dn as string;
    return 'OB-' + String(yearOf(or(r.DOCDAT, OPEN_DATE) as string));   // ยอดยกมาสินค้ารายล็อต (Express ไม่มีเลขที่เอกสาร)
  };
  const POS_CLASS: Record<string, string> = { '0': 'RR', '1': 'JU', '2': 'CN', '3': 'RL', '4': 'RL', '5': 'CA', '6': 'OU', '7': 'DN', '8': 'JU', '9': 'IV', ':': 'JU', '=': 'DR', '>': 'OE' };
  for (const r of dbf('STCRD')) {
    const dn = stcrdDoc(r);
    if (T(dn) && !T(H(dn)) && !SYN.has(dn)) {
      const po = or(st(r.POSOPR), '') as string;
      const cls = dn.startsWith('OB-') ? 'OB' : has(POS_CLASS, po) ? POS_CLASS[po]! : 'JU';
      SYN.set(dn, [or(r.DOCDAT, cls === 'OB' ? OPEN_DATE : null), cls, st(r.LOCCOD)]);
    }
  }
  for (const r of dbf('GLPTTIT')) {
    const dn = st(r.DOCNUM);
    if (T(dn) && !T(H(dn)) && !SYN.has(dn as string)) SYN.set(dn as string, [null, 'DP', null]);
  }
  {
    const rows: Row[] = [];
    for (const [dn, [d, cls, loc]] of SYN) {
      // เอกสารที่มีเฉพาะในบัตรสต๊อก (ไม่อยู่ใน ARTRN/APTRN) ไม่ใช่ลูกหนี้/เจ้าหนี้ → ระบบสินค้า
      const module = cls === 'DP' ? 'PC' : 'IC';
      if (cls === 'OB') {
        // ยอดยกมาสินค้า = หมวด OS (is_opening) ประเภทเอกสารของโปรแกรมเอง
        if (!DT.has('OPEN-IC')) {
          DT.set('OPEN-IC', U('dt', 'OPEN-IC')); DTCLASS.set('OPEN-IC', 'OS');
          await insert('md_doc_type', [base({ id: DT.get('OPEN-IC'), code: 'OPEN-IC', doc_class: 'OS', module: 'IC', name_th: 'ยอดยกมาสินค้า', name_en: 'Opening stock' })]);
        }
        const row = await hdrRow(dn, 'OS', module, d, 'OS', { warehouse_id: null, is_opening: true, remark: '[ยอดยกมาสินค้ารายล็อต]' });
        row.doc_type_id = DT.get('OPEN-IC');
        rows.push(row);
      } else {
        rows.push(await hdrRow(dn, cls, module, d, null, { warehouse_id: WH.get(loc) ?? null, is_opening: false, remark: '[สร้างจากบรรทัดรายการ — Express ไม่มีหัวเอกสาร]' }));
      }
      Q('header_synthesized_from_lines', dn);
    }
    done('doc_header', await insert('doc_header', rows), 'สร้างจาก STCRD/GLPTTIT ที่ไม่มีหัวเอกสาร');
  }

  /* ------------------------------------------------------------------ lines (STCRD + SO/PO items + petty cash) */
  progress('บรรทัดรายการสินค้า (STCRD)', 35);
  // ผลต่อสต๊อกตาม POSOPR — 3 = โอนเข้าคลัง, 4 = โอนออก, 8 = ปรับปรุงตามเครื่องหมายจำนวน, : = ปรับจากตรวจนับ
  const EFFECT: Record<string, number> = { '0': 1, '1': 1, '2': 1, '3': 1, '4': -1, '5': 0, '6': -1, '7': -1, '8': 0, '9': -1, ':': 1, '=': 0, '>': 0, '': 0 };
  const NONSTOCK_TYPES = ['2', '4', '5'];   // บริการ / รายได้อื่น / ค่าใช้จ่ายอื่น ไม่กระทบสต๊อก
  const LINE = new Map<string, [string, DbfValue, string]>();   // K(dn, seq, posopr) -> [dn, seq, lid]
  const seqcount = new Map<string, number>();
  const bump = (hid: string) => { const n = (seqcount.get(hid) ?? 0) + 1; seqcount.set(hid, n); return n; };
  {
    let rows: Row[] = [];
    for (const r of dbf('STCRD')) {
      const dn = stcrdDoc(r);
      const hid = H(dn);
      if (!hid) { Q('stcrd_header_missing', dn); continue; }
      const ln = bump(hid);
      const lid = U('line', dn, st(r.SEQNUM), st(r.POSOPR), ln);
      LINE.set(K(dn, st(r.SEQNUM), st(r.POSOPR)), [dn, st(r.SEQNUM), lid]);
      const mv = or(st(r.POSOPR), '') as string;
      const q = or(r.TRNQTY, 0);
      let eff = has(EFFECT as unknown as Record<string, string>, mv) ? EFFECT[mv]! : 0;
      if (mv === '8') eff = num(or(r.XTRNQTY, 0)) >= 0 ? 1 : -1;
      if (NONSTOCK_TYPES.includes(ITYPE.get(st(r.STKCOD)) as string)) eff = 0;
      if (dn.startsWith('OB-')) eff = 1;
      const party = st(r.PEOPLE);
      rows.push(base({ id: lid, header_id: hid, line_no: ln, line_kind: 'I', item_id: T(st(r.STKCOD)) ? await item(r.STKCOD) : null,
        description: r.STKDES, warehouse_id: T(st(r.LOCCOD)) ? await wh(r.LOCCOD) : null, department_id: T(st(r.DEPCOD)) ? await dept(r.DEPCOD) : null,
        qty: qty(q), unit_id: T(st(r.TQUCOD)) ? await unit(r.TQUCOD) : null, factor: or(r.TFACTOR, 1), base_qty: qty(Math.abs(num(or(r.XTRNQTY, 0)))),
        unit_price: qty(r.UNITPR), discount_text: st(r.DISC), discount_amount: money(r.DISCAMT), line_amount: money(r.TRNVAL),
        net_amount: money(r.NETVAL), vat_code: st(r.VATCOD), is_free: r.FREE === 'Y', return_to_stock: T(st(r.RETSTK)) ? r.RETSTK === 'Y' : null,
        stock_effect: eff, movement_code: mv || null, cost_unit: qty(r.XUNITPR), cost_amount: money(r.XTRNVAL), sales_value: money(r.XSALVAL),
        party_customer_id: CUS.get(party) ?? null, party_supplier_id: SUP.get(party) ?? null, salesperson_id: T(st(r.SLMCOD)) ? await slm(r.SLMCOD) : null,
        gl_debit_account_id: T(st(r.ACCNUMDR)) ? await acc(r.ACCNUMDR) : null, gl_credit_account_id: T(st(r.ACCNUMCR)) ? await acc(r.ACCNUMCR) : null,
        reimburse_flag: st(r.REIMBURSE) }));
      if (rows.length >= 20000) { done('doc_line', await insert('doc_line', rows), 'STCRD'); rows = []; }
    }
    done('doc_line', await insert('doc_line', rows), 'STCRD');
  }

  /* ------------------------------------------------------------------ ผลการตรวจนับ (STTAK → inv_stock_count, คู่มือบทที่ 14 S-IC-15..22) */
  progress('ผลการตรวจนับสินค้า', 50);
  const LINE_BY = new Map<string, string>();
  for (const [dn, seq, lid] of LINE.values()) LINE_BY.set(K(dn, seq), lid);
  {
    const TAK = new Map<string, Row>();
    for (const r of dbf('STTAK')) {
      if (!(T(st(r.STKCOD)) && T(st(r.LOCCOD)) && T(r.TAKDAT))) continue;
      const flag = or(st(r.TAKFLG), '1');
      const counted = flag === '1' ? null : qty(r.PHYBAL);
      const lid = flag === '6' && T(st(r.DOCNUM)) ? LINE_BY.get(K(st(r.DOCNUM), st(r.SEQNUM))) ?? null : null;
      // ปรับปรุงแล้วแต่ไม่มีบรรทัดใน STCRD (ผลต่าง 0 ไม่สร้างรายการ) — คงสถานะ 6 ไว้ ไม่ให้ปรับซ้ำ
      if (flag === '6' && !T(lid)) Q('sttak_adjusted_without_line', `${pyStr(st(r.DOCNUM))}/${pyStr(st(r.SEQNUM))}`);
      const kparts = [pyStr(st(r.LOCCOD)), pyStr(st(r.STKCOD)), pyStr(r.TAKDAT)];
      const k = K(...kparts);
      if (TAK.has(k)) Q('sttak_duplicate', kparts.join('/'));
      TAK.set(k, base({ id: U('tak', ...kparts), warehouse_id: await wh(r.LOCCOD), item_id: await item(r.STKCOD), count_date: r.TAKDAT, shelf: st(r.AREA) || null,
        counted_qty: counted, counted_unit_qty: num(or(r.CQUQTY, 0)) >= 0 && flag !== '1' ? qty(r.CQUQTY) : null,
        system_qty: flag === '6' ? qty(num(or(r.PHYBAL, 0)) - num(or(r.DIFQTY, 0))) : null, diff_qty: flag === '6' ? qty(r.DIFQTY) : null, flag, adjust_line_id: lid }));
    }
    done('inv_stock_count', await insert('inv_stock_count', [...TAK.values()]), 'STTAK');
  }
  for (const [table, numf] of [['OESOIT', 'SONUM'], ['POPRIT', 'PONUM']] as const) {
    progress(table === 'OESOIT' ? 'บรรทัดใบสั่งขาย' : 'บรรทัดใบสั่งซื้อ', table === 'OESOIT' ? 55 : 58);
    const rows: Row[] = [];
    for (const r of dbf(table)) {
      const dn = st(r[numf]); const hid = H(dn);
      if (!hid) { Q(`${table}_header_missing`, dn); continue; }
      const n = bump(hid);
      rows.push(base({ id: U('line', table, dn, st(r.SEQNUM)), header_id: hid, line_no: n, item_id: await item(r.STKCOD), description: r.STKDES,
        warehouse_id: T(st(r.LOCCOD)) ? await wh(r.LOCCOD) : null, department_id: T(st(r.DEPCOD)) ? await dept(r.DEPCOD) : null,
        qty: qty(r.ORDQTY), ordered_qty: qty(r.ORDQTY), remaining_qty: qty(r.REMQTY), cancelled_qty: qty(r.CANCELQTY),
        cancel_reason_code: st(r.CANCELTYP), cancel_date: r.CANCELDAT, unit_id: await unit(r.TQUCOD), factor: or(r.TFACTOR, 1),
        base_qty: qty(num(or(r.ORDQTY, 0)) * num(or(r.TFACTOR, 1))), unit_price: qty(r.UNITPR), discount_text: st(r.DISC),
        discount_amount: money(r.DISCAMT), line_amount: money(r.TRNVAL), net_amount: money(r.TRNVAL), is_free: r.FREE === 'Y',
        delivery_date: or(r.DLVDAT ?? null, r.RCVDAT ?? null), stock_effect: 0 }));
    }
    done('doc_line', await insert('doc_line', rows), table);
  }
  {
    const rows: Row[] = [];
    for (const r of dbf('GLPTTIT')) {
      const dn = st(r.DOCNUM); const hid = H(dn);
      if (!hid) { Q('GLPTTIT_header_missing', dn); continue; }
      const n = bump(hid);
      rows.push(base({ id: U('line', 'PTT', dn, n), header_id: hid, line_no: n, line_kind: 'G', account_id: await acc(r.ACCNUM),
        description: r.DESCRP, department_id: T(st(r.DEPCOD)) ? await dept(r.DEPCOD) : null, line_amount: money(r.AMOUNT), net_amount: money(r.AMOUNT) }));
    }
    done('doc_line', await insert('doc_line', rows), 'GLPTTIT');
  }

  // notes
  progress('หมายเหตุเอกสาร', 60);
  {
    const rows: Row[] = [], nseq = new Map<string, number>(), MDNOTES: Row[] = [];
    const inc = (k: string) => { const n = (nseq.get(k) ?? 0) + 1; nseq.set(k, n); return n; };
    for (const r of dbf('ARTRNRM')) {
      const dn = st(r.DOCNUM); const hid = H(dn);
      if (!hid) {
        const owner: [string | null, string | null] = ITEM.has(dn) ? ['ITEM', ITEM.get(dn)!] : SUP.has(dn) ? ['SUPPLIER', SUP.get(dn)!] : CUS.has(dn) ? ['CUSTOMER', CUS.get(dn)!] : [null, null];
        if (T(owner[0])) {
          const n = inc(K('o', ...owner));
          MDNOTES.push(base({ id: U('mdnote', owner[0], dn, n), entity_type: owner[0], entity_id: owner[1], seq: n, text: String(or(r.REMARK, '-')).slice(0, 200) }));
        } else Q('ARTRNRM_owner_missing', dn);
        continue;
      }
      const s = String(or(r.SEQNUM, ''));
      const n = inc(K('h', hid, s));
      const digits = toAsciiDigits(s.replace(/[^0-9๐-๙]/g, ''));
      rows.push(base({ id: U('note', dn, s, n), header_id: hid, line_id: null, seq: n + (s.startsWith('@') ? 0 : 100 * (digits ? parseInt(digits, 10) : 0)),
        text: String(or(r.REMARK, '')).slice(0, 200) || '-' }));
    }
    done('doc_note', await insert('doc_note', rows), 'ARTRNRM');
    done('md_note', await insert('md_note', MDNOTES), 'ARTRNRM (รหัสสินค้า/ผู้จำหน่าย)');
  }

  // settlement / payments
  progress('การตัดชำระและการรับ/จ่ายเงิน', 63);
  const PENDING_SET: Array<[string, DbfRecord]> = [];
  for (const [table, module, amtf] of [['ARRCPIT', 'AR', 'RCVAMT'], ['APRCPIT', 'AP', 'PAYAMT']] as const) {
    const rows: Row[] = [];
    for (const r of dbf(table)) {
      const p = H(r.RCPNUM, module), i = H(r.DOCNUM, module);
      if (!T(p) && T(i)) { PENDING_SET.push([table, r]); continue; }
      if (!(T(p) && T(i))) { Q(`${table}_missing_doc`, `${pyStr(st(r.RCPNUM))}->${pyStr(st(r.DOCNUM))}`); continue; }
      rows.push(base({ id: U('set', table, st(r.RCPNUM), st(r.DOCNUM)), payment_header_id: p, payment_journal_id: null, invoice_header_id: i, express_rectype: r.RECTYP,
        amount: money(r[amtf]), vat_amount: money(r.VATAMT) }));
    }
    done('doc_settlement', await insert('doc_settlement', rows), table);
  }

  // cheques (BKTRN)
  const CHQ: Cache = new Map();
  {
    const rows: Row[] = [];
    const occ = new Map<string, number>();
    for (const r of dbf('BKTRN')) {
      const t = or(st(r.BKTRNTYP), '') as string;
      const direction = ['QR', 'bR', 'BU', 'BD', 'Bx'].includes(t) ? 'R' : 'P';
      const inst = t === 'QR' || t === 'QP' ? 'CHEQUE' : 'TRANSFER';
      const no = st(r.CHQNUM);
      // แถวซ้ำทุกช่องใน BKTRN ต้องได้ id ต่างกัน ไม่งั้นถูกตัดทิ้ง — ทะเบียนเช็คต้องเท่า Express
      const ok = K(t, no, r.CHQDAT); const o = (occ.get(ok) ?? 0) + 1; occ.set(ok, o);
      const cid = o === 1 ? U('chq', t, no, r.CHQDAT) : U('chq', t, no, r.CHQDAT, o);
      if (o > 1) Q('bktrn_duplicate_row', no);
      CHQ.set(no, cid);
      const party = st(r.CUSCOD);
      rows.push(base({ id: cid, branch_id: BRANCH, direction, instrument: inst, cheque_no: or(no, '-'),
        cheque_date: or(r.CHQDAT, r.TRNDAT), bank_id: BANK.get(st(r.BNKCOD)) ?? null, bank_branch: r.BRANCH, bank_account_id: BKA.get(st(r.BNKACC)) ?? null,
        customer_id: CUS.get(party) ?? null, supplier_id: SUP.get(party) ?? null, payee_name: r.NAME, department_id: T(st(r.DEPCOD)) ? await dept(r.DEPCOD) : null,
        received_date: r.GETDAT, deposit_date: r.PAYINDAT, pass_date: r.TRNDAT, amount: money(r.AMOUNT), charge: money(r.CHARGE),
        net_amount: money(r.NETAMT), remaining_amount: money(r.REMAMT), written_off_amount: money(r.REMCUT), status: or(st(r.CHQSTAT), '00'), is_settled: r.CMPLAPP === 'Y',
        source_header_id: H(r.VOUCHER), remark: r.REMARK }));
    }
    const seenChq = new Set<string>(); const dedup: Row[] = [];
    for (const x of rows) {
      const k = K(x.direction, x.cheque_no);
      if (seenChq.has(k)) { const old = x.cheque_no; x.cheque_no = pyStr(x.cheque_no) + '#' + (x.id as string).slice(0, 4); Q('cheque_no_duplicate', old); }
      seenChq.add(K(x.direction, x.cheque_no)); dedup.push(x);
    }
    done('fin_cheque', await insert('fin_cheque', dedup), 'BKTRN');
  }
  for (const [table, module, amtf] of [['ARRCPCQ', 'AR', 'RCVAMT'], ['APRCPCQ', 'AP', 'PAYAMT']] as const) {
    const rows: Row[] = [], ln = new Map<string, number>();
    const d = module === 'AR' ? 'R' : 'P';
    for (const r of dbf(table)) {
      const hid = H(r.RCPNUM, module) || H(r.RCPNUM);
      if (!hid) { Q(`${table}_missing_doc`, st(r.RCPNUM)); continue; }
      const chq = String(or(st(r.CHQNUM), ''));
      const pm = PM.get(K(d, chq.slice(0, 2))) || PM.get(K(d === 'P' ? 'R' : 'P', chq.slice(0, 2)));
      if (!pm) { Q(`${table}_unknown_method`, chq.slice(0, 2)); continue; }
      const n = (ln.get(hid) ?? 0) + 1; ln.set(hid, n);
      rows.push(base({ id: U('pay', table, st(r.RCPNUM), chq, n), header_id: hid, line_no: n, payment_method_id: pm,
        reference_no: chq.slice(2) || null, amount: money(r[amtf]), cheque_id: CHQ.get(chq) ?? null }));
    }
    done('doc_payment', await insert('doc_payment', rows), table);
  }

  /* ------------------------------------------------------------------ GL */
  progress('ใบสำคัญ (GLJNL)', 68);
  const JRN = new Map<DbfValue, string>();
  const FA_JNL = new Map<string | null, string>();   // งวด → ใบสำคัญคิดค่าเสื่อม (FAyymmnnnn) ที่ระบบทรัพย์สินของ Express สร้าง
  {
    const rows: Row[] = [];
    for (const r of dbf('GLJNL')) {
      const v = st(r.VOUCHER); const jb = JB.get(st(r.JNLTYP)) || JB.get('00') || null;
      const jid = U('jnl', st(r.JNLTYP), v); JRN.set(v, jid);
      const isFa = /^FA\p{Nd}{8}$/u.test(String(or(v, ''))) && r.DOCSTAT !== 'C';
      if (isFa) { const p = await periodOf(r.VOUDAT); if (!FA_JNL.has(p)) FA_JNL.set(p, jid); }
      rows.push(base({ id: jid, branch_id: BRANCH, journal_book_id: jb, voucher_no: v, voucher_date: r.VOUDAT, period_id: await periodOf(r.VOUDAT),
        description: r.DESCRP, reference: st(r.REFNUM), source_module: isFa ? 'FA' : st(r.SRCJNL), source_header_id: H(v),
        status: r.TRNSTAT === 'P' ? 'P' : 'U', doc_status: r.DOCSTAT === 'C' ? 'C' : 'N',
        print_count: T(r.PRNCNT) ? pyInt(or(r.PRNCNT, 0)) : 0 }));
    }
    done('gl_journal', await insert('gl_journal', rows), 'GLJNL');
  }
  progress('รายการใบสำคัญ (GLJNLIT)', 72);
  {
    let rows: Row[] = [];
    const lns = new Map<string, number>();
    for (const r of dbf('GLJNLIT')) {
      const v = st(r.VOUCHER); const jid = JRN.get(v);
      if (!jid) { Q('GLJNLIT_journal_missing', v); continue; }
      const n = (lns.get(jid) ?? 0) + 1; lns.set(jid, n);
      const amt = money(r.AMOUNT);
      let dr: number = r.TRNTYP === '0' ? amt : 0, cr: number = r.TRNTYP === '1' ? amt : 0;
      if (amt < 0) [dr, cr] = r.TRNTYP === '0' ? [0, -amt] : [-amt, 0];
      rows.push(base({ id: U('jl', v, n), journal_id: jid, line_no: n, account_id: await acc(r.ACCNUM),
        department_id: T(st(r.DEPCOD)) ? await dept(r.DEPCOD) : null, description: r.DESCRP, debit: dr, credit: cr,
        changed_from_account_id: T(st(r.CHGACCFROM)) ? await acc(r.CHGACCFROM) : null, resolved_from: 'M' }));
      if (rows.length >= 20000) { done('gl_journal_line', await insert('gl_journal_line', rows), 'GLJNLIT'); rows = []; }
    }
    done('gl_journal_line', await insert('gl_journal_line', rows), 'GLJNLIT');
  }
  await sql`UPDATE gl_journal j SET total_debit = s.d, total_credit = s.c
    FROM (SELECT journal_id, sum(debit) d, sum(credit) c FROM gl_journal_line WHERE company_id = ${COMPANY} GROUP BY 1) s
    WHERE s.journal_id = j.id AND j.company_id = ${COMPANY}`.execute(tx);
  await sql`UPDATE doc_header h SET journal_id = j.id FROM gl_journal j
    WHERE j.source_header_id = h.id AND j.company_id = ${COMPANY} AND h.company_id = ${COMPANY}`.execute(tx);

  // settlements whose payment side is a GL voucher (JV) — needs journals loaded first
  {
    const rows: Row[] = [];
    for (const [table, r] of PENDING_SET) {
      const module = table === 'ARRCPIT' ? 'AR' : 'AP', amtf = module === 'AR' ? 'RCVAMT' : 'PAYAMT';
      const pj = JRN.get(st(r.RCPNUM)); const i = H(r.DOCNUM, module);
      if (!pj) { Q(`${table}_missing_doc`, `${pyStr(st(r.RCPNUM))}->${pyStr(st(r.DOCNUM))}`); continue; }
      rows.push(base({ id: U('set', table, st(r.RCPNUM), st(r.DOCNUM)), payment_header_id: null, payment_journal_id: pj, invoice_header_id: i,
        express_rectype: r.RECTYP, amount: money(r[amtf]), vat_amount: money(r.VATAMT) }));
    }
    done('doc_settlement', await insert('doc_settlement', rows), 'ARRCPIT/APRCPIT (ตัดด้วยใบสำคัญ GL)');
  }

  /* ------------------------------------------------------------------ AR/AP: ปรับให้ยอดคงค้างตรงกับ Express ณ วันย้ายระบบ */
  // บางใบ Express ตั้ง RCVAMT/PAYAMT = ชำระครบ แต่ไม่มีรายการตัดชำระ → สร้างเอกสารปรับปรุงการย้ายข้อมูล 1 ใบต่อระบบ
  progress('ปรับยอดลูกหนี้/เจ้าหนี้คงค้าง', 78);
  const lastDayOfData = () => {
    const lim = prd && T(prd.END12NY) ? yearOf(prd.END12NY as string) : 9999;
    return maxOf(PERIODS.filter((p) => yearOf(p[0]) <= lim).map((p) => p[1]));
  };
  for (const [module, table, amtf] of [['AR', 'ARTRN', 'RCVAMT'], ['AP', 'APTRN', 'PAYAMT']] as const) {
    const settled = new Map<string | null, number>();
    for (const x of (await sql<{ k: string | null; v: string | null }>`SELECT invoice_header_id k, sum(amount)::text v FROM doc_settlement WHERE company_id = ${COMPANY} GROUP BY 1`.execute(tx)).rows) settled.set(x.k, Number(x.v));
    const used = new Map<string, number>();
    for (const x of (await sql<{ k: string; v: string | null }>`SELECT l.from_header_id k, sum(l.amount)::text v FROM doc_link l JOIN doc_header t ON t.id = l.to_header_id
        WHERE l.link_type = 'DEPOSIT' AND t.doc_status <> 'C' AND l.company_id = ${COMPANY} GROUP BY 1`.execute(tx)).rows) used.set(x.k, x.v === null ? 0 : Number(x.v));
    const adj: Array<[string, number, DbfValue]> = [], dep: Array<[string, number, DbfValue]> = [];
    for (const r of dbf(table)) {
      if (r.DOCSTAT === 'C') continue;
      const hid = H(r.DOCNUM, module);
      if (!hid) continue;
      if (r.RECTYP === '3' || r.RECTYP === '4' || r.RECTYP === '5') {
        // บิล/เพิ่มหนี้: ที่ตัดแล้ว = RCVAMT/PAYAMT · ใบลดหนี้: ที่นำไปหักแล้ว = NETAMT − REMAMT (ยอดตัดเก็บเป็นบวก)
        const target = r.RECTYP !== '5' ? num(or(r[amtf], 0)) : num(or(r.NETAMT, 0)) - num(or(r.REMAMT, 0));
        const diff = pyRound(target - (settled.get(hid) ?? 0), 2);
        if (Math.abs(diff) >= 0.01) adj.push([hid, diff, st(r.DOCNUM)]);
      } else if (r.RECTYP === '0') {
        // มัดจำ: คงเหลือ (v_deposit_outstanding = AMOUNT − ที่หักแล้ว) ให้เท่า REMAMT ของ Express
        const diff = pyRound(num(or(r.AMOUNT, 0)) - (used.get(hid) ?? 0) - num(or(r.REMAMT, 0)), 2);
        if (Math.abs(diff) >= 0.01) dep.push([hid, diff, st(r.DOCNUM)]);
      }
    }
    if (adj.length || dep.length) {
      const mdn = `MIG-ADJ-${module}`;
      const lastDay = lastDayOfData();
      const hrow = await hdrRow(mdn, module === 'AR' ? 'RE' : 'PS', module, lastDay, null, {
        remark: '[ย้ายข้อมูล] ปรับยอดตัดชำระ/มัดจำคงเหลือให้ตรงกับ Express (ชำระนอกใบเสร็จ/ใบสำคัญจ่าย)', net_amount: money(pySum(adj.map((a) => a[1]))) });
      await insert('doc_header', [hrow]); done('doc_header', 1, 'ปรับปรุงการย้ายข้อมูล');
      if (adj.length) {
        done('doc_settlement', await insert('doc_settlement', adj.map(([h, a, d]) => base({ id: U('setadj', module, d), payment_header_id: hrow.id, invoice_header_id: h, amount: a, vat_amount: 0 }))), `${table}.${amtf} (ปรับปรุง)`);
        Q(`${module}_settlement_adjusted`, ...adj.map(([, a, d]) => `${pyStr(d)}:${pyFloatRepr(a)}`));
      }
      if (dep.length) {
        done('doc_link', await insert('doc_link', dep.map(([h, a, d]) => base({ id: U('depadj', module, d), from_header_id: h, to_header_id: hrow.id, link_type: 'DEPOSIT', amount: a }))), `${table}.REMAMT มัดจำ (ปรับปรุง)`);
        Q(`${module}_deposit_adjusted`, ...dep.map(([, a, d]) => `${pyStr(d)}:${pyFloatRepr(a)}`));
      }
    }
  }

  /* ------------------------------------------------------------------ GL ยอดยกมาต้นปีแรก จาก GLBAL (ยอดปีก่อน = BEGLY + ΣDEBITnLY − ΣCREDITnLY + ปิดบัญชี) */
  progress('ยอดยกมาบัญชีแยกประเภท', 82);
  const plist = (await sql<{ s: string; id: string }>`SELECT start_date::text s, id FROM gl_period WHERE company_id = ${COMPANY} ORDER BY start_date`.execute(tx)).rows;
  const fyFirst = prd ? plist.find((p) => p.s === prd.BEG1)?.id ?? null : null;
  if (fyFirst) {
    const rows: Row[] = [];
    let tot = 0;
    for (const r of dbf('GLBAL')) {
      const a = st(r.ACCNUM);
      const months: number[] = [];
      for (let m = 1; m <= 12; m++) months.push(num(or(r[`DEBIT${m}LY`], 0)) - num(or(r[`CREDIT${m}LY`], 0)));
      const bal = num(or(r.BEGLY, 0)) + pySum(months) + num(or(r.DEBITCLS, 0)) - num(or(r.CREDITCLS, 0));
      if (Math.abs(bal) < 0.005) continue;
      tot += bal;
      rows.push(base({ id: U('glopen', a, st(r.DEPCOD)), account_id: await acc(a), department_id: T(st(r.DEPCOD)) ? await dept(r.DEPCOD) : null,
        period_id: fyFirst, opening: pyRound(bal, 2), debit: 0, credit: 0 }));
    }
    done('gl_balance', await insert('gl_balance', rows), 'GLBAL (ยอดยกมาต้นปีแรก)');
    QUALITY.set('gl_opening_net_should_be_zero', [...QUALITY.get('gl_opening_net_should_be_zero') ?? [], pyFloatRepr(pyRound(tot, 2))]);
  }

  /* ------------------------------------------------------------------ งบประมาณ (GLBUD — คู่มือบทที่ 15 S-GL-17) */
  {
    const rows: Row[] = [];
    if (prd) {
      for (const r of dbf('GLBUD')) {
        const a = st(r.ACCNUM);
        if (!T(a)) continue;
        for (let i = 1; i <= 12; i++) {
          const beg = prd[`BEG${i}`] as string | null;
          const cols: Array<[string, V]> = [[`AMT${i}`, prd[`BEG${i}`]], [`AMT${i}NY`, prd[`BEG${i}NY`]], [`AMT${i}LY`, T(beg) ? replaceYear(beg!, yearOf(beg!) - 1) : null]];
          for (const [col, start] of cols) {
            const amt = money(r[col]);
            const pid = T(start) && T(amt) ? await periodOf(start, false) : null;
            if (!T(pid)) continue;
            rows.push(base({ id: U('glbud', a, st(r.DEPCOD), pid), account_id: await acc(a), department_id: T(st(r.DEPCOD)) ? await dept(r.DEPCOD) : null, period_id: pid, amount: amt }));
          }
        }
      }
    }
    done('gl_budget', await insert('gl_budget', rows), 'GLBUD');
  }

  /* ------------------------------------------------------------------ tax */
  progress('ภาษีมูลค่าเพิ่ม / ภาษีหัก ณ ที่จ่าย', 85);
  {
    const rows: Row[] = [];
    for (const r of dbf('ISVAT')) {
      const vp = (await periodOf(r.VATPRD)) || (await periodOf(r.VATDAT)) || (await periodOf(r.DOCDAT));
      rows.push(base({ id: U('vat', r.VATREC, st(r.DOCNUM), st(r.REFNUM), r.VATDAT, rows.length), vat_kind: or(r.VATREC, 'P'), header_id: H(r.DOCNUM),
        journal_id: JRN.get(st(r.DOCNUM)) ?? null, branch_id: BRANCH, doc_no: or(st(r.DOCNUM), '-'), doc_date: or(r.DOCDAT, r.VATDAT),
        tax_invoice_no: st(r.REFNUM), tax_invoice_date: or(r.VATDAT, r.DOCDAT), vat_period_id: vp, is_late: r.LATE === 'Y',
        department_id: T(st(r.DEPCOD)) ? await dept(r.DEPCOD) : null, description: r.DESCRP, base_amount: money(r.AMT01),
        vat_amount: money(r.VAT01), zero_rate_amount: money(r.AMTRAT0), nonclaim_base: money(r.AMT02), nonclaim_vat: money(r.VAT02),
        is_manual: r.SELF_ADDED === 'Y', is_modified: r.HAD_MODIFY === 'Y', doc_status: r.DOCSTAT === 'C' ? 'C' : 'N', remark: r.REMARK }));
    }
    done('tax_vat_entry', await insert('tax_vat_entry', rows), 'ISVAT');
  }
  {
    const rows: Row[] = [];
    for (const r of dbf('ISTAX')) {
      const p = st(r.PEOPLE);
      rows.push(base({ id: U('wht', st(r.TAXTYP), st(r.TAXNUM), st(r.REFNUM), rows.length), form_type: or(st(r.TAXTYP), 'S03'), header_id: H(r.REFNUM),
        branch_id: BRANCH, certificate_no: st(r.TAXNUM), certificate_date: r.TAXDAT, tax_period_id: (await periodOf(r.TAXPRD)) || (await periodOf(r.TAXDAT)),
        is_late: r.LATE === 'Y', supplier_id: SUP.get(p) ?? null, customer_id: CUS.get(p) ?? null, payee_name: r.NAME || p || '-', payee_address: r.ADDR,
        payee_tax_id: String(or(st(r.TAXID), '')).slice(0, 13) || null, income_type: r.TAXDES, paid_amount: money(r.AMOUNT), rate: or(r.TAXRAT, 0),
        tax_amount: money(r.TAXAMT), condition: st(r.TAXCOND), social_security_amount: r.SOCIALAMT, provident_fund_amount: r.POVDNT,
        print_count: T(r.PRNCNT) ? pyInt(or(r.PRNCNT, 0)) : 0 }));
      if (T(p) && !SUP.has(p) && !CUS.has(p)) Q('wht_party_missing', p);
    }
    done('tax_wht_entry', await insert('tax_wht_entry', rows), 'ISTAX');
  }

  /* ------------------------------------------------------------------ fixed assets */
  progress('ทรัพย์สิน', 88);
  {
    const rows: Row[] = [], dep: Row[] = [];
    const suffixes = [...Array.from({ length: 12 }, (_, m) => String(m + 1)), ...Array.from({ length: 12 }, (_, m) => `${m + 1}NY`)];
    for (const r of dbf('FAMAS')) {
      const c = st(r.FASCOD); const aid = U('fa', c);
      rows.push(base({ id: aid, code: c, name_th: r.FASDES || c, name_en: r.FASDES2, category_code: st(r.FASGRP),
        account_group_id: AAG.get(st(r.ACCCOD)) || await ref(AAG, 'md_asset_account_group', r.ACCCOD, 'aag'),
        is_depreciable: r.FASTYP !== 'N', serial_no: st(r.SERIAL), department_id: T(st(r.DEPCOD)) ? await dept(r.DEPCOD) : null,
        branch_id: BRANCH, purchase_date: r.PURDAT, cost: money(r.COSVAL), salvage_value: money(r.SALVAG),
        method: ['0', '1', '2'].includes(r.METHOD as string) ? r.METHOD : '1', start_date: or(r.STRDAT, r.PURDAT),
        useful_life_years: T(r.LIFE) ? pyInt(r.LIFE) : null, rate: r.RATE, end_date: r.ENDDAT, depr_monthly: r.DPRMONLY !== 'N',
        accum_depr_bf: money(r.ACCMBF), accum_bf_date: PERIODS.length ? PERIODS[0]![0] : null,   // ACCMBF = ค่าเสื่อมสะสมก่อนปีปัจจุบันของ Express
        manual_depr: money(r.DPRAMT), manual_depr_to: r.LASCAL,
        sold_date: r.SALDAT, sold_amount: r.SALAMT, status: T(r.SALDAT) ? 'S' : 'A' }));
      suffixes.forEach((suffix, i) => {
        const a = r[`DEPR${suffix}`];
        if (T(a)) {
          const pid = i < PERIODS.length ? PERIODS[i]![2] : null;
          if (T(pid)) dep.push(base({ id: U('dep', c, pid), asset_id: aid, period_id: pid, amount: money(a), journal_id: FA_JNL.get(pid) ?? null }));
        }
      });
    }
    done('fa_asset', await insert('fa_asset', rows), 'FAMAS'); done('fa_depreciation', await insert('fa_depreciation', dep), 'FAMAS.DEPRn');
  }

  /* ------------------------------------------------------------------ stock balance snapshot */
  progress('ยอดคงเหลือสินค้า (STLOC)', 91);
  {
    // STLOC ของ Express มีแถวซ้ำ (สินค้า×คลังเดียวกันหลายแถว) และรายงานของ Express รวมทุกแถว → รวมยอดก่อน
    const stloc = new Map<string, DbfRecord>();
    for (const r of dbf('STLOC')) {
      if (!T(st(r.STKCOD))) { Q('stloc_blank_item', '1'); continue; }
      const kp = [st(r.STKCOD), st(r.LOCCOD)];
      const k = K(...kp);
      const prev = stloc.get(k);
      if (prev) {
        Q('stloc_duplicate', kp.map(pyStr).join('/'));
        const x: DbfRecord = { ...prev }; stloc.set(k, x);
        for (const f of ['LOCBAL', 'LOCVAL', 'LOCREO', 'LOCRES']) x[f] = num(or(x[f], 0)) + num(or(r[f], 0));
        for (const f of ['LPURDAT', 'LSELDAT', 'LMOVDAT', 'TAKDAT']) { const vs = [x[f], r[f]].filter(T) as string[]; x[f] = vs.length ? maxOf(vs) : null; }
        x.UNITPR = or(x.UNITPR, r.UNITPR) as DbfValue; x.AREA = or(st(x.AREA), r.AREA) as DbfValue;
      } else stloc.set(k, r);
    }
    let rows: Row[] = [];
    for (const r of stloc.values()) {
      rows.push(base({ id: U('sb', st(r.STKCOD), st(r.LOCCOD)), item_id: await item(r.STKCOD), warehouse_id: await wh(r.LOCCOD),
        qty_on_hand: qty(r.LOCBAL), value_on_hand: money(r.LOCVAL), avg_cost: nz(r.UNITPR), qty_on_order: qty(r.LOCREO),
        qty_reserved: qty(r.LOCRES), last_purchase_date: r.LPURDAT, last_sale_date: r.LSELDAT, last_move_date: r.LMOVDAT,
        last_count_date: r.TAKDAT, shelf: st(r.AREA) }));
      if (rows.length >= 20000) { done('inv_stock_balance', await insert('inv_stock_balance', rows), 'STLOC'); rows = []; }
    }
    done('inv_stock_balance', await insert('inv_stock_balance', rows), 'STLOC');
  }

  // ปรับยอดสต๊อกให้ตรงยอดคงเหลือของ Express (STLOC.LOCBAL/LOCVAL) ณ วันย้ายระบบ — ยอดในระบบใหม่คำนวณสดจากบรรทัดเอกสาร
  progress('ปรับยอดสต๊อกให้ตรง Express', 94);
  {
    const res = await sql<{ i: string; w: string; dq: string; dv: string }>`
WITH live AS (SELECT l.item_id, l.warehouse_id, sum(l.base_qty * l.stock_effect) q,
                     sum(CASE WHEN l.movement_code = '8' THEN coalesce(l.cost_amount, 0) ELSE coalesce(l.cost_amount, 0) * l.stock_effect END) v
                FROM doc_line l JOIN doc_header h ON h.id = l.header_id
               WHERE h.company_id = ${COMPANY} AND h.doc_status <> 'C' AND l.stock_effect <> 0 AND l.item_id IS NOT NULL AND l.warehouse_id IS NOT NULL GROUP BY 1, 2),
     b AS (SELECT item_id, warehouse_id, qty_on_hand q, value_on_hand v FROM inv_stock_balance WHERE company_id = ${COMPANY} AND item_id IS NOT NULL AND warehouse_id IS NOT NULL)
SELECT coalesce(b.item_id, live.item_id) i, coalesce(b.warehouse_id, live.warehouse_id) w, (coalesce(b.q, 0) - coalesce(live.q, 0))::text dq, (coalesce(b.v, 0) - coalesce(live.v, 0))::text dv
  FROM b FULL JOIN live ON live.item_id = b.item_id AND live.warehouse_id = b.warehouse_id`.execute(tx);
    const stk = res.rows.map((x) => [x.i, x.w, Number(x.dq), Number(x.dv)] as const).filter(([, , dq, dv]) => Math.abs(dq) >= 0.0001 || Math.abs(dv) >= 0.005);
    if (stk.length) {
      const hrow = await hdrRow('MIG-ADJ-IC', 'JU', 'IC', lastDayOfData(), 'JU', { remark: '[ย้ายข้อมูล] ปรับยอดสต๊อกให้ตรงยอดคงเหลือของ Express (STLOC)' });
      await insert('doc_header', [hrow]); done('doc_header', 1, 'ปรับปรุงสต๊อกการย้ายข้อมูล');
      done('doc_line', await insert('doc_line', stk.map(([i, w, dq, dv], n) => base({ id: U('stkadj', i, w), header_id: hrow.id, line_no: n + 1, line_kind: 'I', item_id: i, warehouse_id: w,
        description: '[ย้ายข้อมูล] ปรับยอดตาม STLOC', qty: pyRound(dq, 4), factor: 1, base_qty: pyRound(Math.abs(dq), 4), stock_effect: dq >= 0 ? 1 : -1, movement_code: '8', cost_unit: 0, cost_amount: pyRound(dv, 2) }))), 'STLOC (ปรับปรุง)');
      Q('stock_adjusted_to_stloc', stk.length);
    }
  }

  /* ------------------------------------------------------------------ ค่าเริ่มต้นจาก ISINFO → sys_setting (คู่มือบทที่ 5) */
  progress('ค่าเริ่มต้นระบบ', 96);
  {
    const YN = (v: unknown) => { const s = T(v) ? v : ''; return typeof s === 'string' ? ['Y', 'T', '1'].includes(pyStrip(s).toUpperCase()) : s === true; };
    const UDF_FIELDS = [['dat1', 'ST_DAT1'], ['dat2', 'ST_DAT2'], ['num1', 'ST_NUM1'], ['str1', 'ST_STR1'], ['str2', 'ST_STR2'], ['str3', 'ST_STR3'], ['str4', 'ST_STR4']] as const;
    const pyStrV = (x: DbfValue) => (typeof x === 'number' ? pyFloatRepr(x) : pyStr(x));   // ค่าจาก DBF ที่เป็นตัวเลข = float ของ Python
    const settingFromIsinfo = (spec: string): unknown => {
      const cut = spec.lastIndexOf(':'); const fields = spec.slice(0, cut), kind = spec.slice(cut + 1);
      if (kind === 'list') {
        const vals = fields.split(',').map((f) => info[f] ?? null);
        return vals.every(T) ? vals.map((v) => pyInt(v)) : null;
      }
      if (kind === 'udf') {
        const out: Record<string, unknown> = {};
        for (const [k, f] of UDF_FIELDS) {
          const th = st(info[f]); const use = YN(info[f + 'USE']);
          if (T(th) || use) out[k] = { use, th: or(th, ''), en: or(st(info[f + 'ENG']), '') };
        }
        return out;
      }
      if (kind === 'tiers') {
        const rows: unknown[] = [];
        for (const c of 'ABCDE') {
          const a = info[`CRLINE_${c}`]; const lv = or(st(info[`CRLINE_${c}_L`]), '');
          if (T(a)) rows.push({ amount: new PyFloat(pyRound(num(a), 2)), level: isDigit(lv) ? pyInt(lv) : 0 });
        }
        return rows;
      }
      if (kind === 'petty') {
        const rows: unknown[] = [];
        for (let i = 1; i <= 5; i++) {
          const th = st(info[`PT_STR${i}`]);
          if (T(th)) rows.push({ th, en: or(st(info[`PT_STR${i}ENG`]), ''), account: or(st(info[`PETTY${i}`]), null) });
        }
        return rows;
      }
      let v: DbfValue = info[fields] ?? null;
      if (typeof v === 'string') v = st(v);
      if (v === null || v === '') return null;
      const x = v;
      switch (kind) {
        case 'yn': return YN(x);
        case 'num': { if (typeof x === 'number') return new PyFloat(x); if (typeof x === 'boolean') return new PyFloat(x ? 1 : 0); const f = pyFloatParse(x); if (f === null) throw new PyValueError('float'); return new PyFloat(f); }
        case 'int': return pyInt(x);
        case 'str': return pyStrV(x);
        case 'level': return isDigit(pyStrip(pyStrV(x))) ? pyInt(x) : null;
        case 'yearthai': return x === '1' ? 'B' : 'C';
        case 'perpetual': return YN(x) ? 'PERPETUAL' : 'PERIODIC';
        case 'prefer': return ({ '1': 'CODE', '2': 'NAME' } as Record<string, string>)[pyStrV(x)] ?? null;   // สันนิษฐาน 1 = ตามรหัส
        case 'ynstr': return YN(x) ? 'true' : 'false';
        default: throw new Error(`ไม่รู้จักชนิดค่าเริ่มต้น ${kind}`);
      }
    };
    const rows: Row[] = [];
    for (const c of SETTING_DEFS.filter((d) => d.from)) {
      let val: unknown;
      try { val = settingFromIsinfo(c.from!); } catch (e) { if (e instanceof PyValueError) { Q('setting_unreadable', c.key); continue; } throw e; }
      if (val === null || val === undefined) continue;
      rows.push(base({ id: U('set', c.key), branch_id: null, module: c.module, key: c.key, value: pyJson(val) }));
    }
    done('sys_setting', await insert('sys_setting', rows), 'ISINFO');
  }

  /* ------------------------------------------------------------------ แบบงบการเงิน (GLREP = หัวงบ/คอลัมน์, GLREPIT = บรรทัด) */
  progress('แบบงบการเงิน', 98);
  {
    const rows: Row[] = [];
    for (const r of dbf('GLREP')) {
      const code = st(r.REPCOD) as string | null;
      if (!T(code)) continue;
      const cols: unknown[] = [];
      for (let n = 1; n <= 18; n++) {
        const expr = st(r[`FLD${n}`]);
        if (!T(expr)) continue;
        cols.push({ expr, head1: or(st(r[`C${n}_HD1`]), ''), head2: or(st(r[`C${n}_HD2`]), ''),
          department: or(st(r[`DEP${n}`]), null), percent: or(st(r[`PCENT${n}`]), null), print: or(st(r[`PRINT${n}`]), null) });
      }
      const heads = [1, 2, 3, 4].map((n) => or(st(r[`HEAD_${n}`]), ''));
      rows.push(base({ id: U('fsr', code), code: code!.slice(0, 10), name: or(st(r.REPNAM), code), header_lines: pyJson(heads),
        columns: pyJson(cols), line_set_code: String(or(st(r.LINCOD), code)).slice(0, 10), number_format: st(r.PICT_1) }));
    }
    done('gl_fs_report', await insert('gl_fs_report', rows), 'GLREP');
  }
  {
    const rows: Row[] = [];
    for (const r of dbf('GLREPIT')) {
      const ls = st(r.REPCOD) as string | null;
      if (!T(ls)) continue;
      let ln: number;
      try { ln = pyInt(pyStr(r.LINNUM)); } catch (e) { if (e instanceof PyValueError) continue; throw e; }
      const accOps: Record<string, unknown> = {};
      for (const x of 'ABCDE') { const v = or(st(r['VAR_' + x]), ''); if (T(v)) accOps[x] = v; }
      rows.push(base({ id: U('fsl', ls, ln), line_set_code: ls!.slice(0, 10), line_no: ln, data_type: String(or(st(r.DATTYP), 'TXT')).slice(0, 4), source: st(r.SRCDAT),
        sign_filter: or(st(r.FILTER), null), description_th: st(r.DESCRP), description_en: st(r.DESCRP2),
        print_condition: or(st(r.PRNCON), null), accumulate: pyJson(accOps),
        department_id: T(st(r.DEPCOD)) ? await dept(r.DEPCOD) : null }));
    }
    done('gl_fs_line', await insert('gl_fs_line', rows), 'GLREPIT');
  }

  progress('เสร็จ', 100);
  return {
    company_id: COMPANY, code: CO, name_th: String(nameTh),
    counts: Object.fromEntries(counts),
    quality: Object.fromEntries(QUALITY),
  };
}

/** รายงานแบบเดียวกับที่ migrate_express.py พิมพ์ (summary JSON) */
export function pythonSummary(rep: ImportReport) {
  const pySorted = (xs: string[]) => [...new Set(xs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    company: rep.code,
    counts: Object.fromEntries(Object.entries(rep.counts).map(([k, v]) => [k, v.rows])),
    sources: Object.fromEntries(Object.entries(rep.counts).map(([k, v]) => [k, v.source])),
    quality: Object.fromEntries(Object.entries(rep.quality).map(([k, v]) => [k, { count: v.length, examples: pySorted(v).slice(0, 15) }])),
  };
}

/* ================================================================== validate (พอร์ตจาก validate_migration.py) */
/** กระทบยอดหลังย้ายข้อมูล: ฐานข้อมูลใหม่ vs แฟ้ม Express ต้นทาง (กรองเฉพาะบริษัทที่ระบุ — Python ตรวจทั้งฐานข้อมูล) */
export async function validateExpress(db: Kysely<DB>, src: DbfSource, companyId: string): Promise<unknown> {
  const it = (t: string) => dbfRecords(src.read(t));
  const s = (v: V) => (typeof v === 'string' ? pyStrip(v) : '');
  const q = async <X>(text: ReturnType<typeof sql<X>>) => (await text.execute(db)).rows;
  const C = companyId;
  const R: Record<string, unknown> = {};
  // 1 GL balanced
  R.journals_total = Number((await q(sql<{ n: string }>`select count(*)::text n from gl_journal where company_id = ${C}`))[0]!.n);
  R.journals_unbalanced = Number((await q(sql<{ n: string }>`select count(*)::text n from gl_journal where company_id = ${C} and total_debit<>total_credit and doc_status='N'`))[0]!.n);
  R.unbalanced_examples = (await q(sql<{ v: string; d: string; c: string }>`select voucher_no v, total_debit::text d, total_credit::text c from gl_journal where company_id = ${C} and total_debit<>total_credit and doc_status='N' order by abs(total_debit-total_credit) desc limit 5`)).map((x) => [x.v, x.d, x.c]);
  const tb = (await q(sql<{ d: string | null; c: string | null }>`select sum(debit)::text d, sum(credit)::text c from gl_journal_line l join gl_journal j on j.id=l.journal_id where j.company_id = ${C} and j.doc_status='N'`))[0]!;
  R.trial_balance_debit_credit = [Number(tb.d), Number(tb.c)];
  // 2 GL opening (from GLBAL) + journals must stay balanced
  const ob = (await q(sql<{ s: string; n: string }>`select coalesce(sum(opening),0)::text s, count(*)::text n from gl_balance where company_id = ${C}`))[0]!;
  R.gl_opening_rows = Number(ob.n); R.gl_opening_net = Number(ob.s);
  R.gl_closing_balanced = (await q(sql<{ x: string | null }>`select round(sum(x),2)::text x from (select sum(opening) x from gl_balance where company_id = ${C} union all
     select sum(l.debit-l.credit) from gl_journal_line l join gl_journal j on j.id=l.journal_id where j.company_id = ${C} and j.doc_status='N') t`))[0]!.x;
  // 3 stock: STLOC.LOCBAL vs sum(base_qty*effect) per item/wh
  const loc = new Map<string, number>(), locKey = new Map<string, [string, string]>();
  for (const r of it('STLOC')) if (s(r.STKCOD)) { const k = K(s(r.STKCOD), s(r.LOCCOD)); loc.set(k, num(or(r.LOCBAL, 0))); locKey.set(k, [s(r.STKCOD), s(r.LOCCOD)]); }
  const led = new Map<string, number>();
  for (const x of await q(sql<{ i: string; w: string; q: string }>`select i.code i, w.code w, sum(l.base_qty*l.stock_effect)::text q from doc_line l join doc_header h on h.id=l.header_id join md_item i on i.id=l.item_id join md_warehouse w on w.id=l.warehouse_id where h.company_id = ${C} and l.stock_effect<>0 group by 1,2`)) {
    const k = K(x.i, x.w); led.set(k, Number(x.q)); locKey.set(k, [x.i, x.w]);
  }
  const typ = new Map<string, DbfValue>();
  for (const r of it('STMAS')) typ.set(s(r.STKCOD), r.STKTYP ?? null);
  const keys = new Set<string>();
  for (const [k, v] of loc) if (Math.abs(v) > 1e-6 && !['2', '4', '5'].includes(typ.get(locKey.get(k)![0]) as string)) keys.add(k);
  for (const [k, v] of led) if (Math.abs(v) > 1e-6) keys.add(k);
  const diffOf = (k: string) => Math.abs((loc.get(k) ?? 0) - (led.get(k) ?? 0));
  R.stock_pairs_compared = keys.size;
  R.stock_pairs_match = [...keys].filter((k) => diffOf(k) < 0.001).length;
  R.stock_diff_examples = [...keys].filter((k) => diffOf(k) >= 0.001)
    .map((k) => [pyRound(loc.get(k) ?? 0, 4), pyRound(led.get(k) ?? 0, 4), locKey.get(k)] as [number, number, unknown])
    .sort((a, b) => Math.abs(b[0] - b[1]) - Math.abs(a[0] - a[1])).slice(0, 6);
  // 4 AR outstanding vs ARTRN.REMAMT for IV (not cancelled)
  const ex = new Map<string, [number, number, number]>();
  for (const r of it('ARTRN')) if (r.RECTYP === '3' && r.DOCSTAT !== 'C') ex.set(s(r.DOCNUM), [num(or(r.NETAMT, 0)), num(or(r.RCVAMT, 0)), num(or(r.REMAMT, 0))]);
  const mine = new Map<string, [number, number, number]>();
  for (const x of await q(sql<{ d: string; a: string; s: string; o: string }>`select doc_no d, amount::text a, settled::text s, outstanding::text o from v_ar_outstanding where company_id = ${C} and doc_class='IV'`)) mine.set(x.d, [Number(x.a), Number(x.s), Number(x.o)]);
  R.ar_docs = ex.size; R.ar_settled_match_before_adj = 'see migrate';
  R.ar_settled_match = [...ex].filter(([d, [, rc]]) => mine.has(d) && Math.abs(mine.get(d)![1] - rc) < 0.01).length;
  R.ar_outstanding_total_express_REMAMT = pyRound(pySum([...ex.values()].map((v) => v[2])), 2);
  R.ar_outstanding_total_express_NET_minus_RCV = pyRound(pySum([...ex.values()].map((v) => v[0] - v[1])), 2);
  R.ar_outstanding_total_new = pyRound(pySum([...mine.values()].map((v) => v[2])), 2);
  const exap = new Map<string, [number, number]>();
  for (const r of it('APTRN')) if (r.RECTYP === '3' && r.DOCSTAT !== 'C') exap.set(s(r.DOCNUM), [num(or(r.NETAMT, 0)), num(or(r.PAYAMT, 0))]);
  R.ap_outstanding_total_express = pyRound(pySum([...exap.values()].map(([a, b]) => a - b)), 2);
  R.ap_outstanding_total_new = Number((await q(sql<{ v: string }>`select coalesce(sum(outstanding),0)::text v from v_ap_outstanding where company_id = ${C} and doc_class='RR'`))[0]!.v);
  // 5 row parity
  const cnt = async (t: ReturnType<typeof sql<{ n: string }>>) => Number((await q(t))[0]!.n);
  const par: Record<string, [string, () => Promise<number>]> = {
    STCRD: ['doc_line', () => cnt(sql`select count(*)::text n from doc_line l join doc_header h on h.id=l.header_id where h.company_id = ${C} and l.line_kind='I' and l.ordered_qty is null`)],
    GLJNLIT: ['gl_journal_line', () => cnt(sql`select count(*)::text n from gl_journal_line where company_id = ${C}`)],
    ISVAT: ['tax_vat_entry', () => cnt(sql`select count(*)::text n from tax_vat_entry where company_id = ${C}`)],
    STMAS: ['md_item', () => cnt(sql`select count(*)::text n from md_item where company_id = ${C} and name_th not like '[MISSING]%'`)],
    ARTRN: ['doc_header', () => cnt(sql`select count(*)::text n from doc_header where company_id = ${C} and module='AR' and doc_class<>'BS'`)],
    APTRN: ['doc_header', () => cnt(sql`select count(*)::text n from doc_header where company_id = ${C} and module='AP' and doc_class<>'BR' and remark is distinct from '[สร้างจากบรรทัดรายการ — Express ไม่มีหัวเอกสาร]'`)],
  };
  const rp: Record<string, [number, number]> = {};
  for (const [k, [, f]] of Object.entries(par)) { let n = 0; for (const _ of it(k)) n++; rp[k] = [n, await f()]; }
  R.row_parity = rp;
  return R;
}
