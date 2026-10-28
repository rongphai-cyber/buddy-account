import Decimal from 'decimal.js';

/** จำนวนเงินในระบบใช้ Decimal เสมอ — ห้ามใช้ number กับเงิน */
Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

export type Money = Decimal;
export type MoneyInput = Decimal | string | number | null | undefined;

export const ZERO = new Decimal(0);

export function d(v: MoneyInput): Decimal {
  if (v === null || v === undefined || v === '') return ZERO;
  if (v instanceof Decimal) return v;
  if (typeof v === 'string') return new Decimal(v.replace(/,/g, '').trim() || '0');
  return new Decimal(v);
}

/** ปัดเศษ 2 ตำแหน่งแบบปัดครึ่งขึ้น (แบบเดียวกับ Express) */
export function round2(v: MoneyInput): Decimal {
  return d(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function sum(values: Iterable<MoneyInput>): Decimal {
  let t = ZERO;
  for (const v of values) t = t.plus(d(v));
  return t;
}

/** ข้อความสำหรับส่งผ่าน API/ฐานข้อมูล เช่น "1234.50" */
export function toDb(v: MoneyInput, places = 2): string {
  return d(v).toFixed(places);
}

/** แสดงผลแบบไทย: 1,234,567.50 — ติดลบแสดงในวงเล็บถ้า paren = true */
export function fmt(v: MoneyInput, opts: { places?: number; paren?: boolean; blankZero?: boolean } = {}): string {
  const places = opts.places ?? 2;
  const x = d(v);
  if (opts.blankZero && x.isZero()) return '';
  const s = x.abs().toFixed(places);
  const [i, f] = s.split('.');
  const withComma = (i ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = f ? `${withComma}.${f}` : withComma;
  if (x.isNegative() && !x.isZero()) return opts.paren ? `(${body})` : `-${body}`;
  return body;
}

/** อ่านตัวเลขที่ผู้ใช้พิมพ์ (มีจุลภาค/วงเล็บ/เครื่องหมายลบ) คืน null ถ้าไม่ใช่ตัวเลข */
export function parseInput(text: string): Decimal | null {
  let t = text.replace(/[,\s฿]/g, '');
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  if (t === '' ) return ZERO;
  if (!/^[-+]?\d*\.?\d*$/.test(t) || t === '.' || t === '-' || t === '+') return null;
  const v = new Decimal(t);
  return neg ? v.neg() : v;
}

/** เท่ากันภายใน 0.005 (ใช้ตรวจดุล) */
export function eq2(a: MoneyInput, b: MoneyInput): boolean {
  return round2(a).equals(round2(b));
}

export { Decimal };
