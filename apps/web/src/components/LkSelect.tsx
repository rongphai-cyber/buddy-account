import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { ITEM_KINDS, itemKindOf } from '@buddy/core';
import { useCan } from '../session';
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
export function SearchPick<T extends { id: string }>({ endpoint, params, value, label, onPick, placeholder = 'พิมพ์รหัสหรือชื่อเพื่อค้นหา', describe, exclude, codeOf, addNew = true, ...rest }: {
  endpoint: string; params?: Record<string, string>; value: { id: string; code: string; name?: string | null } | null; label?: (r: T) => string; codeOf?: (r: T) => string;
  onPick: (r: T | null) => void; placeholder?: string; describe?: (r: T) => string; exclude?: string[];
  /** ค้นหาไม่พบ → เพิ่มใหม่จากช่องนี้ (ข้อกำหนดเจ้าของ) — false = ปิด */
  addNew?: boolean; [k: string]: unknown;
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
          if (q === null) { if (e.key === 'F4' || e.key === 'ArrowDown') { e.preventDefault(); setBrowse(true); setQ(value?.code ?? ''); } return; }
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, rows.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); if (rows[sel]) pick(rows[sel]!); else if (canAdd && q.trim() && res.data && !res.isFetching) startAdd(q); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setQ(null); setBrowse(false); }
        }} />
      {!rest.disabled && <button type="button" className="pick-btn" tabIndex={-1} title="ค้นหา (F4)" aria-label="ค้นหา" onMouseDown={(e) => e.preventDefault()} onClick={() => (q === null ? openList() : (setQ(null), setBrowse(false)))}>🔍</button>}
      {q !== null && (q.trim() || browse) && (
        <ul className="pick-list" role="listbox">
          {rows.map((r, i) => <li key={r.id} role="option" aria-selected={i === sel} tabIndex={-1} className={i === sel ? 'on' : undefined} onMouseDown={(e) => { e.preventDefault(); pick(r); }}>
            <b className="mono">{codeOf ? codeOf(r) : (r as unknown as { code: string }).code}</b> {label ? label(r) : ''} {describe && <span className="muted small">{describe(r)}</span>}
          </li>)}
          {res.data && !rows.length && <li className="muted">ไม่พบ{canAdd ? ' — กด Enter เพื่อเพิ่มใหม่' : ''}</li>}
          {canAdd && <li className="pick-add" tabIndex={-1} onMouseDown={(e) => { e.preventDefault(); startAdd(q ?? ''); }}>＋ เพิ่ม{ADD_WORD(addKind!)}ใหม่{q?.trim() ? ` “${q.trim()}”` : ''} <kbd>Ins</kbd></li>}
        </ul>
      )}
      {adding !== null && addKind && <Suspense fallback={null}><AddMaster kind={addKind} text={adding} onClose={() => setAdding(null)} onSaved={(code) => void added(code)} /></Suspense>}
    </div>
  );
}
