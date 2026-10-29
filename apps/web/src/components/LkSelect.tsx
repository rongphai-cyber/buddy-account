import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

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
export function SearchPick<T extends { id: string }>({ endpoint, params, value, label, onPick, placeholder = 'พิมพ์รหัสหรือชื่อเพื่อค้นหา', describe, exclude, codeOf, ...rest }: {
  endpoint: string; params?: Record<string, string>; value: { id: string; code: string; name?: string | null } | null; label?: (r: T) => string; codeOf?: (r: T) => string;
  onPick: (r: T | null) => void; placeholder?: string; describe?: (r: T) => string; exclude?: string[]; [k: string]: unknown;
}) {
  const [q, setQ] = useState<string | null>(null);
  const [sel, setSel] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const res = useQuery({ enabled: !!q?.trim(), queryKey: ['pick', endpoint, params, q], queryFn: () => api.get<{ rows: T[] }>(endpoint, { ...params, q: q ?? '', limit: 15 }), placeholderData: (p) => p });
  const rows = (res.data?.rows ?? []).filter((r) => !exclude?.includes(r.id));
  useEffect(() => setSel(0), [q]);
  const pick = (r: T | null) => { onPick(r); setQ(null); };
  const shown = q ?? (value ? `${value.code}${value.name ? ' ' + value.name : ''}` : '');
  return (
    <div className="pick" ref={box} onBlur={(e) => { if (!box.current?.contains(e.relatedTarget as Node)) setQ(null); }}>
      <input value={shown} placeholder={placeholder} data-noenter={q !== null ? '' : undefined} {...rest}
        onChange={(e) => { setQ(e.target.value); if (!e.target.value) onPick(null); }}
        onKeyDown={(e) => {
          if (q === null) { if (e.key === 'F4' || e.key === 'ArrowDown') { e.preventDefault(); setQ(value?.code ?? ''); } return; }
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, rows.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); if (rows[sel]) pick(rows[sel]!); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setQ(null); }
        }} />
      {q !== null && q.trim() && (
        <ul className="pick-list" role="listbox">
          {rows.map((r, i) => <li key={r.id} role="option" aria-selected={i === sel} tabIndex={-1} className={i === sel ? 'on' : undefined} onMouseDown={(e) => { e.preventDefault(); pick(r); }}>
            <b className="mono">{codeOf ? codeOf(r) : (r as unknown as { code: string }).code}</b> {label ? label(r) : ''} {describe && <span className="muted small">{describe(r)}</span>}
          </li>)}
          {res.data && !rows.length && <li className="muted">ไม่พบ</li>}
        </ul>
      )}
    </div>
  );
}
