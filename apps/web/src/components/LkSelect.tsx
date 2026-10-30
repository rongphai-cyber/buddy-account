import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { ITEM_KINDS, itemKindOf } from '@buddy/core';
import { useCan } from '../session';
import { toast } from '../ui';
import type { AddKind } from './AddMaster';

const AddMaster = lazy(() => import('./AddMaster'));
/** ช่องค้นหานี้เพิ่มข้อมูลหลักชนิดไหนได้ (ดูจาก API ที่ค้น) — ลูกค้า ผู้จำหน่าย สินค้าตามชนิดในพารามิเตอร์ types */
function addKindOf(endpoint: string, params?: Record<string, string>): AddKind | null {
  if (endpoint === '/api/v1/customers') return 'customer';
  if (endpoint === '/api/v1/suppliers') return 'supplier';
  if (endpoint === '/api/v1/item-search') return itemKindOf((params?.types ?? '0').split(',')[0]!);
  return null;
}
const ADD_MENU = (k: AddKind) => (k === 'customer' ? 'SA.CUS' : k === 'supplier' ? 'PU.SUP' : ITEM_KINDS[k].menu);
/**
 * รายการให้เลือกของช่องค้นหา — ลอยเหนือทุกกรอบ (ตาราง/แท็บ/หน้าต่าง ที่ตัดส่วนเกิน) วางใต้ช่อง หรือเหนือช่องถ้าที่ด้านล่างไม่พอ
 * ตามช่องเมื่อเลื่อนหน้าจอ/ปรับขนาด (ข้อกำหนดเจ้าของ: รายการต้องแสดงขึ้นมาให้เลือก ไม่ถูกบัง)
 */
function PickPopup({ anchor, children }: { anchor: React.RefObject<HTMLDivElement>; children: React.ReactNode }) {
  const ref = useRef<HTMLUListElement>(null);
  const [pos, setPos] = useState<React.CSSProperties>({ visibility: 'hidden' });
  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.current?.getBoundingClientRect(), el = ref.current;
      if (!a || !el) return;
      const vw = window.innerWidth, vh = window.innerHeight, gap = 2;
      const width = Math.min(Math.max(a.width, 440), vw - 16);
      const left = Math.min(Math.max(8, a.left), vw - width - 8);
      const below = vh - a.bottom - 8, above = a.top - 8;
      const up = below < Math.min(el.scrollHeight, 300) && above > below;
      const maxHeight = Math.max(120, Math.min(300, up ? above : below) - gap);
      setPos(up ? { left, width, bottom: vh - a.top + gap, maxHeight } : { left, width, top: a.bottom + gap, maxHeight });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [anchor, children]);
  return createPortal(<ul ref={ref} className="pick-list floating" role="listbox" style={pos} onMouseDown={(e) => e.preventDefault()}>{children}</ul>, document.body);
}

/** บรรทัดว่างท้ายตาราง: Enter = จบการคีย์รายการ ไปช่องแรกที่อยู่ถัดจากตาราง (หมายเหตุ ส่วนลด …) */
export function focusAfterTable(input: HTMLElement) {
  const table = input.closest('table');
  if (!table) return;
  const all = [...document.querySelectorAll<HTMLElement>('input:not([disabled]):not([readonly]):not([type=checkbox]), select:not([disabled]), textarea:not([disabled])')].filter((x) => x.offsetParent);
  const next = all.find((x) => !table.contains(x) && (table.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING));
  next?.focus();
}
/** คำเรียกสิ่งที่ต้องเลือก (ข้อความเตือนช่องที่ต้องมี) */
const placeholderWord = (endpoint: string) => (/customers/.test(endpoint) ? 'ลูกค้า' : /suppliers/.test(endpoint) ? 'ผู้จำหน่าย' : /item/.test(endpoint) ? 'รหัสสินค้า/บริการ' : /invoices/.test(endpoint) ? 'เอกสารที่อ้างถึง' : 'รายการ');
const ADD_WORD = (k: AddKind) => (k === 'customer' ? 'ลูกค้า' : k === 'supplier' ? 'ผู้จำหน่าย' : ITEM_KINDS[k].label);

export type LkRow = { id?: string; code: string; name: string };
export type Lk = Record<string, LkRow[]>;
/** ตารางอ้างอิง: เลขตาราง (40 เขตการขาย, 22 หมวดสินค้า …) หรือ BANK / UNIT / WH / IAG */
export function useLookups(types: string) {
  return useQuery({ queryKey: ['lookups', types], queryFn: () => api.get<Lk>('/api/v1/lookups', { types }), staleTime: 60_000 });
}
/** ช่องเลือกจากตารางข้อมูล (คู่มือบทที่ 6) — byId = ค่าเป็น id (หน่วยนับ คลัง กลุ่มบัญชี) · ค่าเดิมที่ไม่อยู่ในตารางยังแสดงอยู่ */
export function LkSelect({ rows, value, onChange, blank = '—', byId, missing = '(ไม่พบในตาราง)', ...rest }: { rows?: LkRow[]; value: string | null | undefined; onChange: (v: string) => void; blank?: string; byId?: boolean; missing?: string; [k: string]: unknown }) {
  const v = value ?? '';
  const key = (r: LkRow) => (byId ? r.id! : r.code);
  return (
    <select value={v} onChange={(e) => onChange(e.target.value)} {...rest}>
      <option value="">{blank}</option>
      {v && rows && !rows.some((r) => key(r) === v) && <option value={v}>{byId ? missing : v}</option>}
      {rows?.map((r) => <option key={key(r)} value={key(r)}>{r.code} {r.name}</option>)}
    </select>
  );
}

/** ช่องค้นหาแล้วเลือก (สินค้า ผู้จำหน่าย) — พิมพ์รหัส/ชื่อ เลือกจากรายการ · F4 / ลูกศรลง เปิดรายการ */
export function SearchPick<T extends { id: string }>({ endpoint, params, value, label, onPick, placeholder = 'พิมพ์รหัสหรือชื่อเพื่อค้นหา', describe, exclude, codeOf, addNew = true, required, onEmptyEnter, ...rest }: {
  endpoint: string; params?: Record<string, string>; value: { id: string; code: string; name?: string | null } | null; label?: (r: T) => string; codeOf?: (r: T) => string;
  onPick: (r: T | null) => void; placeholder?: string; describe?: (r: T) => string; exclude?: string[];
  /** ค้นหาไม่พบ → เพิ่มใหม่จากช่องนี้ (ข้อกำหนดเจ้าของ) — false = ปิด */
  addNew?: boolean;
  /** ช่องที่ต้องมี: Enter ตอนว่างไม่ข้ามไปช่องถัดไป แต่เปิดรายการให้เลือก (ค้นไม่พบ → เพิ่มใหม่) */
  required?: boolean;
  /** Enter ตอนว่าง (ไม่บังคับ) — เช่น บรรทัดว่างท้ายตาราง = จบรายการ ไปช่องถัดจากตาราง */
  onEmptyEnter?: (input: HTMLInputElement) => void;
  [k: string]: unknown;
}) {
  const [q, setQ] = useState<string | null>(null);
  const [sel, setSel] = useState(0);
  /** เปิดรายการจากปุ่ม 🔍 / F4 โดยยังไม่พิมพ์ — แสดงรายการแรก ๆ ให้เลือก */
  const [browse, setBrowse] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const res = useQuery({ enabled: !!q?.trim() || (browse && q !== null), queryKey: ['pick', endpoint, params, q], queryFn: () => api.get<{ rows: T[] }>(endpoint, { ...params, q: q ?? '', limit: 15 }), placeholderData: (p) => p });
  const rows = (res.data?.rows ?? []).filter((r) => !exclude?.includes(r.id));
  useEffect(() => setSel(0), [q]);
  const pick = (r: T | null) => { onPick(r); setQ(null); setBrowse(false); };
  // เพิ่มใหม่จากช่องค้นหา: Insert หรือ Enter ตอนค้นหาไม่พบ → ฟอร์มข้อมูลหลัก (สิทธิ์เพิ่มของเมนูนั้น) → บันทึกแล้วเลือกให้
  const addKind = addKindOf(endpoint, params);
  const canAdd = useCan(addKind ? ADD_MENU(addKind) : 'ALL')('add') && !!addKind && addNew && !rest.disabled;
  const [adding, setAdding] = useState<string | null>(null);
  const startAdd = (text: string) => { setQ(null); setBrowse(false); setAdding(text); };
  const added = async (code: string) => {
    setAdding(null);
    const r = await api.get<{ rows: T[] }>(endpoint, { ...params, q: code, limit: 15 });
    const hit = r.rows.find((x) => (codeOf ? codeOf(x) : (x as unknown as { code: string }).code)?.toUpperCase() === code.toUpperCase()) ?? r.rows[0];
    if (hit) pick(hit);
  };
  const openList = () => { setBrowse(true); setQ(''); box.current?.querySelector('input')?.focus(); };
  const shown = q ?? (value ? `${value.code}${value.name ? ' ' + value.name : ''}` : '');
  return (
    <div className="pick" ref={box} onBlur={(e) => { if (!box.current?.contains(e.relatedTarget as Node)) { setQ(null); setBrowse(false); } }}>
      <input value={shown} placeholder={placeholder} data-noenter={q !== null ? '' : undefined} {...rest}
        onChange={(e) => { setQ(e.target.value); if (!e.target.value) onPick(null); }}
        onKeyDown={(e) => {
          if (e.key === 'Insert' && canAdd) { e.preventDefault(); e.stopPropagation(); startAdd(q ?? ''); return; }
          if (q === null) {
            if (e.key === 'F4' || e.key === 'ArrowDown') { e.preventDefault(); setBrowse(true); setQ(value?.code ?? ''); }
            else if (e.key === 'Enter' && !value && !rest.disabled && (required || onEmptyEnter)) {
              e.preventDefault(); e.stopPropagation();
              if (required) { setBrowse(true); setQ(''); toast(`ต้องเลือก${placeholderWord(endpoint)}ก่อน — พิมพ์รหัส/ชื่อเพื่อค้นหา แล้ว Enter เลือก${canAdd ? ' (ไม่พบ กด Insert เพิ่มใหม่)' : ''}`, 'warn'); }
              else onEmptyEnter!(e.currentTarget);
            }
            return;
          }
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, rows.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); if (rows[sel]) pick(rows[sel]!); else if (canAdd && q.trim() && res.data && !res.isFetching) startAdd(q); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setQ(null); setBrowse(false); }
        }} />
      {!rest.disabled && <button type="button" className="pick-btn" tabIndex={-1} title="ค้นหา (F4)" aria-label="ค้นหา" onMouseDown={(e) => e.preventDefault()} onClick={() => (q === null ? openList() : (setQ(null), setBrowse(false)))}>🔍</button>}
      {q !== null && (q.trim() || browse) && (
        <PickPopup anchor={box}>
          {rows.map((r, i) => <li key={r.id} role="option" aria-selected={i === sel} tabIndex={-1} className={i === sel ? 'on' : undefined} onMouseDown={(e) => { e.preventDefault(); pick(r); }}>
            {(r as { image_id?: string | null }).image_id && <img className="pick-thumb" src={`/api/v1/item-images/${(r as { image_id?: string }).image_id}?size=thumb`} alt="" loading="lazy" />}
            <b className="mono">{codeOf ? codeOf(r) : (r as unknown as { code: string }).code}</b> {label ? label(r) : ''} {describe && <span className="muted small">{describe(r)}</span>}
          </li>)}
          {res.data && !rows.length && <li className="muted">ไม่พบ{canAdd ? ' — กด Enter เพื่อเพิ่มใหม่' : ''}</li>}
          {canAdd && <li className="pick-add" tabIndex={-1} onMouseDown={(e) => { e.preventDefault(); startAdd(q ?? ''); }}>＋ เพิ่ม{ADD_WORD(addKind!)}ใหม่{q?.trim() ? ` “${q.trim()}”` : ''} <kbd>Ins</kbd></li>}
        </PickPopup>
      )}
      {adding !== null && addKind && <Suspense fallback={null}><AddMaster kind={addKind} text={adding} onClose={() => setAdding(null)} onSaved={(code) => void added(code)} /></Suspense>}
    </div>
  );
}
