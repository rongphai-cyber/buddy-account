import { useEffect, useMemo, useRef, useState, type ReactNode, type KeyboardEvent as RKE } from 'react';
import { fmt, formatDate, parseDateInput, parseInput, type YearSystem } from '@buddy/core';
import { ApiError } from './api';
import { useSession } from './session';

export const cx = (...a: Array<string | false | null | undefined>) => a.filter(Boolean).join(' ');

/* ---------------------------------------------------------------- toast */
type Toast = { id: number; text: string; tone: 'ok' | 'bad' | 'warn' };
let pushToast: ((t: Omit<Toast, 'id'>) => void) | null = null;
export function toast(text: string, tone: Toast['tone'] = 'ok') { pushToast?.({ text, tone }); }
export function toastError(e: unknown) { toast(e instanceof Error ? e.message : String(e), 'bad'); }
export function Toasts() {
  const [list, setList] = useState<Toast[]>([]);
  useEffect(() => {
    let n = 0;
    pushToast = (t) => {
      const id = ++n;
      setList((l) => [...l, { ...t, id }].slice(-3));
      setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), t.tone === 'bad' ? 7000 : 4000);
    };
    return () => { pushToast = null; };
  }, []);
  return <div className="toasts" role="status" aria-live="polite">{list.map((t) => <div key={t.id} className={'toast t-' + t.tone}>{t.text}</div>)}</div>;
}

/* ---------------------------------------------------------------- modal */
export function Modal({ title, onClose, children, size = 'form', footer }: { title: string; onClose: () => void; children: ReactNode; size?: 'form' | 'wide' | 'confirm'; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const f = ref.current?.querySelector<HTMLElement>('[autofocus], input:not([readonly]), select, textarea, button.primary');
    f?.focus();
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const all = document.querySelectorAll('.modal');
      if (all[all.length - 1] === ref.current) { e.preventDefault(); e.stopPropagation(); onClose(); }
    };
    window.addEventListener('keydown', esc, true);
    const popLayer = pushHotkeyLayer({});
    return () => { window.removeEventListener('keydown', esc, true); popLayer(); prev?.focus?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal m-' + size} role="dialog" aria-modal="true" aria-label={title} ref={ref} onKeyDown={navKey}>
        <div className="modal-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="ปิด" title="ปิด (Esc)">✕</button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Confirm({ title, text, okText = 'ยืนยัน', danger, onOk, onClose, children }: { title: string; text: ReactNode; okText?: string; danger?: boolean; onOk: () => void; onClose: () => void; children?: ReactNode }) {
  return (
    <Modal title={title} size="confirm" onClose={onClose} footer={<><button onClick={onClose}>ไม่ใช่</button><button className={danger ? 'danger' : 'primary'} onClick={onOk} autoFocus>{okText}</button></>}>
      <p>{text}</p>{children}
    </Modal>
  );
}

/** Enter = ช่องถัดไป, Shift+Enter = ช่องก่อนหน้า (แบบ Express) */
export function navKey(e: RKE<HTMLElement>, onEnd?: () => void) {
  if (e.key !== 'Enter' || e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
  const t = e.target as HTMLElement;
  if (!t.matches('input, select') || t.dataset.noenter != null) return;
  const box = e.currentTarget as HTMLElement;
  const els = [...box.querySelectorAll<HTMLElement>('input:not([disabled]):not([readonly]):not([type=checkbox]):not([type=radio]), select:not([disabled])')].filter((x) => x.offsetParent);
  const i = els.indexOf(t);
  if (i < 0) return;
  e.preventDefault();
  const n = els[i + (e.shiftKey ? -1 : 1)];
  if (n) { n.focus(); (n as HTMLInputElement).select?.(); }
  else if (onEnd) onEnd();   // ช่องสุดท้ายของหน้า — เช่น ถามบันทึก (useDocEdit)
  else box.dispatchEvent(new CustomEvent('navend', { bubbles: true }));
}

/**
 * ชั้นของปุ่มลัด เรียงตามลำดับที่เปิด: หน้าจอ → หน้าต่าง (Modal) → ฟอร์มในหน้าต่าง …
 * กดปุ่มแล้วหาจากชั้นบนสุดลงมา; Modal เป็น "กำแพง" ไม่ให้ปุ่มลัดทะลุไปถึงหน้าจอข้างหลัง
 * (เช่น F9 ในหน้าต่างเพิ่มบัญชี/ต้นแบบ ต้องไม่บันทึกใบสำคัญที่เปิดอยู่ข้างหลังด้วย)
 */
type HotkeyMap = Record<string, (() => void) | undefined | false>;
const hotkeyLayers: Array<{ map?: { current: HotkeyMap } }> = [];
function onHotkey(e: KeyboardEvent) {
  const k = [e.ctrlKey || e.metaKey ? 'Ctrl' : '', e.altKey ? 'Alt' : '', e.shiftKey ? 'Shift' : '', e.key.length === 1 ? e.key.toUpperCase() : e.key].filter(Boolean).join('+');
  for (let i = hotkeyLayers.length - 1; i >= 0; i--) {
    const layer = hotkeyLayers[i]!;
    if (!layer.map) return;
    const fn = layer.map.current[k];
    if (!fn) continue;
    // ปุ่มธรรมดา (ลูกศร Enter Delete) ไม่ทำงานขณะพิมพ์ในช่องข้อมูล — ใช้ได้เฉพาะ F-keys, Insert, Ctrl/Alt
    const inField = (e.target as HTMLElement)?.matches?.('input, select, textarea');
    if (inField && !/^F\d+$/.test(e.key) && e.key !== 'Insert' && !e.ctrlKey && !e.altKey && !e.metaKey) return;
    e.preventDefault(); e.stopPropagation(); fn();
    return;
  }
}
function pushHotkeyLayer(layer: (typeof hotkeyLayers)[number]) {
  if (!hotkeyLayers.length) window.addEventListener('keydown', onHotkey);
  hotkeyLayers.push(layer);
  return () => {
    hotkeyLayers.splice(hotkeyLayers.indexOf(layer), 1);
    if (!hotkeyLayers.length) window.removeEventListener('keydown', onHotkey);
  };
}

/** ปุ่มลัดของหน้าจอ: { 'F9': save, 'Ctrl+S': save, 'Alt+C': cancel } — ใช้ค่าล่าสุดของ map เสมอ (deps คงไว้เพื่อเข้ากันได้กับโค้ดเดิม) */
export function useHotkeys(map: HotkeyMap, _deps: unknown[] = []) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => pushHotkeyLayer({ map: ref }), []);
}

export function Field({ label, hint, error, children, wide, req }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; wide?: boolean; req?: boolean }) {
  return (
    <label className={cx('field', wide && 'wide', error && 'has-err')}>
      <span className="lbl">{label}{req && <b className="req" aria-hidden="true">*</b>}</span>
      {children}
      {error ? <span className="err-msg">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

export function useYearSystem(): YearSystem { return useSession().me?.company?.year_system ?? 'B'; }
export function DateText({ v }: { v: string | null | undefined }) { const ys = useYearSystem(); return <>{formatDate(v, ys)}</>; }
export const Money = ({ v, blankZero, paren }: { v: string | number | null | undefined; blankZero?: boolean; paren?: boolean }) => <span className="num">{v === null || v === undefined || v === '' ? '' : fmt(v, { blankZero, paren })}</span>;

/** ช่องวันที่ — พิมพ์ได้แบบ Express: 150369, 15/3/69, 15/03/2569 */
export function DateInput({ value, onChange, id, disabled, invalid, autoFocus }: { value: string | null | undefined; onChange: (iso: string) => void; id?: string; disabled?: boolean; invalid?: boolean; autoFocus?: boolean }) {
  const ys = useYearSystem();
  const { me } = useSession();
  const [txt, setTxt] = useState(formatDate(value, ys));
  useEffect(() => setTxt(formatDate(value, ys)), [value, ys]);
  const commit = () => {
    const iso = parseDateInput(txt, ys, value || me?.work_date || undefined);
    if (iso) { onChange(iso); setTxt(formatDate(iso, ys)); } else setTxt(formatDate(value, ys));
  };
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const out = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', out);
    return () => document.removeEventListener('mousedown', out);
  }, [open]);
  return (
    <span className="date-in" ref={box}>
      <input id={id} value={txt} disabled={disabled} autoFocus={autoFocus} aria-invalid={invalid || undefined} placeholder={ys === 'B' ? 'วว/ดด/ปปปป' : 'dd/mm/yyyy'} inputMode="numeric"
        onChange={(e) => setTxt(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); else if (e.key === 'F4' || (e.altKey && e.key === 'ArrowDown')) { e.preventDefault(); setOpen(true); } }} />
      <button type="button" className="cal-btn" tabIndex={-1} disabled={disabled} title="เลือกจากปฏิทิน (F4)" aria-label="เลือกจากปฏิทิน" onClick={() => setOpen((x) => !x)}>📅</button>
      <span className="cal" aria-hidden="true">{ys === 'B' ? 'พ.ศ.' : 'ค.ศ.'}</span>
      {open && <Calendar value={value || me?.work_date || null} ys={ys} onPick={(iso) => { onChange(iso); setTxt(formatDate(iso, ys)); setOpen(false); box.current?.querySelector('input')?.focus(); }} onClose={() => setOpen(false)} />}
    </span>
  );
}

const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const TH_DAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const isoOf = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
/** ปฏิทินเลือกวันที่ (ปีตามระบบปีของบริษัท) — ลูกศรเลื่อนวัน PageUp/PageDown เลื่อนเดือน Enter เลือก Esc ปิด */
function Calendar({ value, ys, onPick, onClose }: { value: string | null; ys: YearSystem; onPick: (iso: string) => void; onClose: () => void }) {
  const today = new Date();
  const todayIso = isoOf(today.getFullYear(), today.getMonth(), today.getDate());
  const [cur, setCur] = useState(() => (value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : todayIso));
  const y = Number(cur.slice(0, 4)), m = Number(cur.slice(5, 7)) - 1;
  const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
  const move = (dd: number, mm = 0) => {
    const nd = mm ? new Date(y, m + mm, Math.min(Number(cur.slice(8, 10)), new Date(y, m + mm + 1, 0).getDate())) : new Date(y, m, Number(cur.slice(8, 10)) + dd);
    setCur(isoOf(nd.getFullYear(), nd.getMonth(), nd.getDate()));
  };
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const key = (e: RKE<HTMLDivElement>) => {
    const k: Record<string, () => void> = { ArrowLeft: () => move(-1), ArrowRight: () => move(1), ArrowUp: () => move(-7), ArrowDown: () => move(7), PageUp: () => move(0, -1), PageDown: () => move(0, 1), Enter: () => onPick(cur), Escape: onClose };
    if (k[e.key]) { e.preventDefault(); e.stopPropagation(); k[e.key]!(); }
  };
  const cells: Array<number | null> = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  return (
    <div className="calendar" role="dialog" aria-label="ปฏิทิน" tabIndex={-1} ref={ref} onKeyDown={key}>
      <div className="cal-head">
        <button type="button" onClick={() => move(0, -12)} title="ปีก่อน" aria-label="ปีก่อน">«</button>
        <button type="button" onClick={() => move(0, -1)} title="เดือนก่อน (PageUp)" aria-label="เดือนก่อน">‹</button>
        <b>{TH_MONTHS[m]} {ys === 'B' ? y + 543 : y}</b>
        <button type="button" onClick={() => move(0, 1)} title="เดือนถัดไป (PageDown)" aria-label="เดือนถัดไป">›</button>
        <button type="button" onClick={() => move(0, 12)} title="ปีถัดไป" aria-label="ปีถัดไป">»</button>
      </div>
      <div className="cal-grid">
        {TH_DAYS.map((x) => <span key={x} className="cal-dow">{x}</span>)}
        {cells.map((n, i) => n === null ? <span key={'b' + i} /> : (
          <button type="button" key={n} className={cx(isoOf(y, m, n) === cur && 'on', isoOf(y, m, n) === todayIso && 'today', isoOf(y, m, n) === value?.slice(0, 10) && 'sel')} onClick={() => onPick(isoOf(y, m, n))}>{n}</button>
        ))}
      </div>
      <div className="cal-foot"><button type="button" onClick={() => onPick(todayIso)}>วันนี้</button></div>
    </div>
  );
}

/** ช่องจำนวนเงิน — แสดงจุลภาคเมื่อไม่ได้แก้ไข, ค่าเป็นข้อความทศนิยม */
export function MoneyInput({ value, onChange, disabled, invalid, className, ...rest }: { value: string | null | undefined; onChange: (v: string) => void; disabled?: boolean; invalid?: boolean; className?: string; [k: string]: unknown }) {
  const [focus, setFocus] = useState(false);
  const [draft, setDraft] = useState('');
  const shown = focus ? draft : value ? fmt(value, { blankZero: true }) : '';
  return (
    <input {...rest} className={cx('num', className)} inputMode="decimal" value={shown} disabled={disabled} aria-invalid={invalid || undefined}
      onFocus={(e) => { setFocus(true); setDraft(value && parseFloat(value) !== 0 ? value : ''); setTimeout(() => e.target.select(), 0); }}
      onBlur={() => { setFocus(false); const v = parseInput(draft); onChange(v === null ? (value ?? '') : v.isZero() ? '' : v.toFixed(2)); }}
      onChange={(e) => {
        // ส่งค่าทันทีที่พิมพ์ (ไม่รอออกจากช่อง) — กด F9 ขณะอยู่ในช่องแล้วบันทึกค่าที่เพิ่งพิมพ์
        setDraft(e.target.value);
        const v = e.target.value.trim() ? parseInput(e.target.value) : null;
        if (!e.target.value.trim()) onChange(''); else if (v !== null) onChange(v.isZero() ? '' : v.toFixed(2));
      }} />
  );
}

export function Tabs({ tabs, active, onChange }: { tabs: Array<{ key: string; label: string; badge?: number | string; color?: string }>; active: string; onChange: (k: string) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={active === t.key} className={cx('tab', active === t.key && 'on', t.color && 'colored')} onClick={() => onChange(t.key)}
          style={t.color ? ({ ['--tab-c' as string]: t.color } as React.CSSProperties) : undefined}>
          {t.label}{t.badge ? <span className="badge">{t.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Pill({ tone, children }: { tone?: 'n' | 'm' | 'c' | 'd' | 'x'; children: ReactNode }) { return <span className={cx('pill', tone && 'st-' + tone)}>{children}</span>; }

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as ApiError;
  const issues = e.issues?.filter((i) => i.message !== e.message) ?? [];
  return (
    <div className="errbox" role="alert">
      <b>{e.message ?? String(error)}</b>
      {issues.length > 0 && <ul>{issues.slice(0, 12).map((i, k) => <li key={k}>{i.message}</li>)}</ul>}
    </div>
  );
}

export function PageHead({ eyebrow, title, lead, actions }: { eyebrow?: string; title: string; lead?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{lead && <p className="lead">{lead}</p>}</div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function KeyHints({ keys }: { keys: Array<[string, string]> }) {
  return <div className="keyhints" aria-label="ปุ่มลัด">{keys.map(([k, t]) => <span key={k}><kbd>{k}</kbd> {t}</span>)}</div>;
}

export function Empty({ title, text, action }: { title: string; text?: ReactNode; action?: ReactNode }) {
  return <div className="empty-state"><b>{title}</b>{text && <p>{text}</p>}{action}</div>;
}

/* ---------------------------------------------------------------- หน้าต่างค้นหา (Lookup) — คู่มือบทที่ 3 S-UI-04 */
export interface LookupCol<T> { key: keyof T & string; label: string; w?: number | string; num?: boolean; render?: (r: T) => ReactNode }
export function Lookup<T extends object>({ title, rows, cols, onPick, onClose, initial = '', onAdd, filter }: {
  title: string; rows: T[]; cols: LookupCol<T>[]; onPick: (r: T) => void; onClose: () => void; initial?: string; onAdd?: (text: string) => void; filter?: (r: T) => boolean;
}) {
  const [q, setQ] = useState(initial);
  const [sel, setSel] = useState(0);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const base = filter ? rows.filter(filter) : rows;
    const r = !s ? base : base.filter((x) => cols.some((c) => String((x as Record<string, unknown>)[c.key] ?? '').toLowerCase().includes(s)));
    // รหัสที่ขึ้นต้นตรงกันขึ้นก่อน
    if (s) r.sort((a, b) => Number(!String((b as Record<string, unknown>)[cols[0]!.key] ?? '').toLowerCase().startsWith(s)) - Number(!String((a as Record<string, unknown>)[cols[0]!.key] ?? '').toLowerCase().startsWith(s)));
    return r.slice(0, 300);
  }, [q, rows, cols, filter]);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => setSel(0), [q]);
  useEffect(() => { body.current?.querySelector('tr.sel')?.scrollIntoView({ block: 'nearest' }); }, [sel]);
  return (
    <Modal title={title} onClose={onClose} size="wide">
      <div className="lk-bar">
        <input autoFocus className="search" placeholder="พิมพ์รหัสหรือชื่อเพื่อค้นหา" value={q} data-noenter onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, list.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); if (list[sel]) onPick(list[sel]!); }
            else if (e.key === 'Insert' && onAdd) { e.preventDefault(); onAdd(q); }
          }} />
        {onAdd && <button className="primary" onClick={() => onAdd(q)} title="เพิ่มใหม่ (Insert)">+ เพิ่มใหม่ <kbd>Ins</kbd></button>}
      </div>
      <div className="table-wrap lk-table" ref={body}>
        <table className="grid">
          <thead><tr>{cols.map((c) => <th key={c.key} style={{ width: c.w }} className={c.num ? 'r' : ''}>{c.label}</th>)}</tr></thead>
          <tbody>
            {list.map((r, i) => (
              <tr key={i} className={cx('row-open', i === sel && 'sel')} onMouseEnter={() => setSel(i)} onClick={() => onPick(r)}>
                {cols.map((c) => <td key={c.key} className={c.num ? 'r num' : ''}>{c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? '')}</td>)}
              </tr>
            ))}
            {!list.length && <tr><td colSpan={cols.length} className="empty">ไม่พบ "{q}"{onAdd ? <> — กด <kbd>Ins</kbd> เพื่อเพิ่มใหม่จากหน้าต่างนี้</> : null}</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="hint">↑ ↓ เลือก · Enter ใช้รายการนี้ {onAdd ? '· Insert เพิ่มใหม่ ' : ''}· Esc ปิด</p>
    </Modal>
  );
}

/* ---------------------------------------------------------------- ส่งออก CSV (เปิดด้วย Excel ได้ ภาษาไทยไม่เพี้ยน) */
export function downloadCsv(name: string, header: string[], rows: Array<Array<string | number | null | undefined>>) {
  const esc = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const text = '﻿' + [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = name.endsWith('.csv') ? name : name + '.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const GROUP_TH: Record<string, string> = { '1': 'สินทรัพย์', '2': 'หนี้สิน', '3': 'ทุน', '4': 'รายได้', '5': 'ค่าใช้จ่าย' };
