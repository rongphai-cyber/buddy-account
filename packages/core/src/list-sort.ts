import { d } from './money.js';

/**
 * เรียงแถวรายการตามคอลัมน์ (HANDOFF 195 — คลิกหัวคอลัมน์ในรายการเอกสาร) · กติกาตามชนิด:
 * money/num = Decimal (ไม่ใช่ข้อความ ไม่ใช่ทศนิยมลอย) · date = ค่า ISO · docno = ตัวเลขในข้อความเรียงตามค่า (IV2 < IV10)
 * text/label = ภาษาไทยตามพจนานุกรม (localeCompare 'th') · ค่าว่างอยู่ท้ายเสมอ · ค่าเท่ากันคงลำดับเดิม
 */
export type SortType = 'text' | 'money' | 'num' | 'date' | 'docno' | 'label';
export interface SortCol<R> {
  /** ชื่อคอลัมน์ในผลลัพธ์ของ API (ชื่อเดียวกับที่ส่งให้เซิร์ฟเวอร์) */
  key: string;
  type: SortType;
  /** ค่าที่ใช้เรียง (สถานะ = ข้อความที่แสดง) — ไม่ระบุ = row[key] */
  get?: (r: R) => unknown;
  /** false = เรียงในหน้าจอเท่านั้น (เซิร์ฟเวอร์ไม่มีคอลัมน์นี้) */
  server?: boolean;
}
export type SortState = { k: string; dir: 'asc' | 'desc' } | null;

const thText = new Intl.Collator('th', { sensitivity: 'base', numeric: true });
const natural = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const isBlank = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

export function compareBy(type: SortType, a: unknown, b: unknown): number {
  switch (type) {
    case 'money': case 'num': {
      try { return d(String(a)).cmp(d(String(b))); } catch { return natural.compare(String(a), String(b)); }
    }
    case 'date': { const x = String(a).slice(0, 10), y = String(b).slice(0, 10); return x < y ? -1 : x > y ? 1 : 0; }
    case 'docno': return natural.compare(String(a), String(b));
    default: return thText.compare(String(a), String(b));
  }
}

export function sortRows<R>(rows: readonly R[], cols: readonly SortCol<R>[], s: SortState): R[] {
  const c = s ? cols.find((x) => x.key === s.k) : undefined;
  if (!s || !c) return rows.slice();
  const get = c.get ?? ((r: R) => (r as Record<string, unknown>)[c.key]);
  const sign = s.dir === 'asc' ? 1 : -1;
  return rows.map((r, i) => ({ r, i, v: get(r) })).sort((x, y) => {
    const bx = isBlank(x.v), by = isBlank(y.v);
    if (bx || by) return bx === by ? x.i - y.i : bx ? 1 : -1;
    return sign * compareBy(c.type, x.v, y.v) || x.i - y.i;
  }).map((x) => x.r);
}

/** คลิกหัวคอลัมน์: น้อยไปมาก → มากไปน้อย → ลำดับเดิม (null) · คอลัมน์ใหม่เริ่มที่น้อยไปมาก */
export function nextSort(cur: SortState, k: string): SortState {
  if (!cur || cur.k !== k) return { k, dir: 'asc' };
  return cur.dir === 'asc' ? { k, dir: 'desc' } : null;
}
