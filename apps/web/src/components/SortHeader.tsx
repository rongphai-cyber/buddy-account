import { useCallback, useMemo, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { nextSort, sortRows, type SortCol, type SortState } from '@buddy/core';
import { cx } from '../ui';

export type { SortCol, SortState, SortType } from '@buddy/core';

/**
 * เรียงรายการเอกสารตามคอลัมน์ที่คลิก (HANDOFF 195 · เจ้าของ 26/11/2569 "คลิกเรียงตาม สาขา หรือ เลขที่ วันที่ รหัส ลูกค้า ยอดเงิน ยอดค้าง หรือสถานะ")
 * คลิกหัวคอลัมน์: น้อยไปมาก ▲ → มากไปน้อย ▼ → กลับลำดับเดิมของหน้าจอ · Enter/Space ที่หัวคอลัมน์ทำเหมือนคลิก · จำการเรียงต่อหน้าจอ (เครื่องนี้)
 * เรียงทั้งชุด: ส่ง sort/dir ให้เซิร์ฟเวอร์ (ชื่อคอลัมน์ที่อนุญาตเท่านั้น — apps/server/src/list-sort.ts) เพื่อให้รายการที่ถูกตัดที่ 500 ใบเป็นชุดที่ถูก
 * แล้วเรียงซ้ำในหน้าจอด้วยกติกาตามชนิด: เงิน = Decimal · วันที่ = ISO · เลขที่ = เรียงแบบตัวเลขในข้อความ · ข้อความ/สถานะ = ภาษาไทย
 */
const storeKey = (screen: string) => `buddy.sort.${screen}`;
function load(screen: string): SortState {
  try {
    const v = JSON.parse(localStorage.getItem(storeKey(screen)) ?? 'null') as SortState;
    return v && typeof v.k === 'string' && (v.dir === 'asc' || v.dir === 'desc') ? v : null;
  } catch { return null; }
}
function save(screen: string, s: SortState) {
  try { if (s) localStorage.setItem(storeKey(screen), JSON.stringify(s)); else localStorage.removeItem(storeKey(screen)); } catch { /* เบราว์เซอร์ไม่ให้เก็บ — ใช้ได้เฉพาะครั้งนี้ */ }
}

/**
 * ใช้: const st = useListSort('ar-invoices', COLS) · ส่ง {...st.params} ไปกับ API · แสดง st.sorted(rows) · หัวคอลัมน์ {st.th('doc_no', 'เลขที่')}
 * screen = ชื่อหน้าจอที่ใช้จำการเรียง (เช่น path ของ API)
 */
export function useListSort<R>(screen: string, cols: readonly SortCol<R>[], onChange?: () => void) {
  const [s, setS] = useState<SortState>(() => load(screen));
  // คอลัมน์ที่จำไว้แต่หน้าจอนี้ไม่มีแล้ว (เช่น ซ่อนคอลัมน์สาขา) = ลำดับเดิม
  const cur = s && cols.some((c) => c.key === s.k) ? s : null;
  const click = useCallback((k: string) => {
    const n = nextSort(cur, k);
    setS(n); save(screen, n); onChange?.();
  }, [cur, screen, onChange]);
  const col = cur ? cols.find((c) => c.key === cur.k) : undefined;
  const sk = cur && col && col.server !== false ? `${cur.k}|${cur.dir}` : '';
  const params = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    if (sk) { const [k, dir] = sk.split('|'); out.sort = k!; out.dir = dir!; }
    return out;
  }, [sk]);
  const th = (k: string, label: ReactNode, o: { className?: string; style?: CSSProperties } = {}) => {
    const on = cur?.k === k;
    const key = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); click(k); } };
    return (
      <th key={k} className={cx('sortable', o.className, on && 'on')} style={o.style} title="คลิกเพื่อเรียง" tabIndex={0} role="columnheader"
        aria-sort={on ? (cur!.dir === 'asc' ? 'ascending' : 'descending') : 'none'} onClick={() => click(k)} onKeyDown={key}>
        {label}<span className="sort-ind" aria-hidden>{on ? (cur!.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
      </th>
    );
  };
  return { sort: cur, params, th, sorted: (rows: readonly R[] | undefined) => sortRows(rows ?? [], cols, cur), reset: () => { setS(null); save(screen, null); } };
}
