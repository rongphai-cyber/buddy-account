import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { d, fmt } from '@buddy/core';
import { api } from '../api';
import { useSession } from '../session';
import { Field, Modal, useHotkeys } from '../ui';
import { SearchPick } from './LkSelect';

/**
 * เครื่องมือช่วย (คู่มือภาคผนวก S-AX): Shift+F2 เครื่องคิดเลข · Shift+F4 สอบถามยอดสินค้าคงเหลือ · Shift+F10 แสดงระบบ
 * ใช้ได้ทุกหน้าจอ — ชั้นปุ่มลัดของหน้าจอ/หน้าต่างที่เปิดอยู่ได้ก่อน
 */
export function AuxTools() {
  const [open, setOpen] = useState<'calc' | 'stock' | 'sys' | null>(null);
  useHotkeys({ 'Shift+F2': () => setOpen('calc'), 'Shift+F4': () => setOpen('stock'), 'Shift+F10': () => setOpen('sys') });
  if (open === 'calc') return <Calculator onClose={() => setOpen(null)} />;
  if (open === 'stock') return <StockInquiry onClose={() => setOpen(null)} />;
  if (open === 'sys') return <SystemInfo onClose={() => setOpen(null)} />;
  return null;
}

/** เครื่องคิดเลขแบบมีกระดาษ (S-AX-03): พิมพ์ตัวเลขแล้ว + − × ÷ Enter = · ทศนิยมปรับได้ · คำนวณด้วย Decimal ไม่คลาดทศนิยม */
function Calculator({ onClose }: { onClose: () => void }) {
  const [tape, setTape] = useState<Array<{ v: string; op: string }>>([]);
  const [acc, setAcc] = useState<string | null>(null);
  const [op, setOp] = useState<string>('');
  const [cur, setCur] = useState('');
  const [places, setPlaces] = useState(2);
  const show = (v: string) => fmt(d(v).toFixed(places), { places });
  const apply = (next: string) => {
    if (!cur && next !== '=') { setOp(next); return; }
    const x = d(cur || 0);
    let r = acc === null ? x : d(acc);
    if (acc !== null) r = op === '+' ? r.plus(x) : op === '-' ? r.minus(x) : op === '*' ? r.times(x) : op === '/' ? (x.isZero() ? r : r.div(x)) : x;
    setTape((t) => [...t, { v: cur || '0', op: next === '=' ? (op || '') : (acc === null ? '' : op) }, ...(next === '=' ? [{ v: r.toString(), op: '=' }] : [])].slice(-40));
    setAcc(next === '=' ? null : r.toString()); setOp(next === '=' ? '' : next); setCur(next === '=' ? r.toString() : '');
  };
  const key = (e: React.KeyboardEvent) => {
    const k = e.key;
    if (/^[0-9.]$/.test(k)) { e.preventDefault(); setCur((c) => (k === '.' && c.includes('.') ? c : c + k)); }
    else if (['+', '-', '*', '/'].includes(k)) { e.preventDefault(); apply(k); }
    else if (k === 'Enter' || k === '=') { e.preventDefault(); apply('='); }
    else if (k === 'Backspace') { e.preventDefault(); setCur((c) => c.slice(0, -1)); }
    else if (k === 'Delete' || k.toLowerCase() === 'c') { e.preventDefault(); setCur(''); setAcc(null); setOp(''); }
  };
  return (
    <Modal title="เครื่องคิดเลข (Shift+F2)" size="confirm" onClose={onClose} footer={<><button onClick={() => { setTape([]); setCur(''); setAcc(null); setOp(''); }}>ล้าง</button><button onClick={() => { void navigator.clipboard?.writeText(d(cur || acc || 0).toFixed(places)); }}>คัดลอกผล</button><button className="primary" onClick={onClose}>ปิด <kbd>Esc</kbd></button></>}>
      <div className="calc" tabIndex={0} autoFocus onKeyDown={key}>
        <div className="calc-tape">{tape.map((t, i) => <div key={i} className={t.op === '=' ? 'calc-res' : ''}><span>{show(t.v)}</span><b>{t.op === '*' ? '×' : t.op === '/' ? '÷' : t.op}</b></div>)}</div>
        <div className="calc-cur"><span className="muted">{acc !== null ? `${show(acc)} ${op === '*' ? '×' : op === '/' ? '÷' : op}` : ''}</span><b>{cur || '0'}</b></div>
      </div>
      <label className="small">ทศนิยม <input type="number" min={0} max={6} value={places} onChange={(e) => setPlaces(Math.max(0, Math.min(6, Number(e.target.value) || 0)))} style={{ width: 60 }} /></label>
      <p className="hint">พิมพ์ตัวเลข แล้ว + − * / · Enter = ผลลัพธ์ · Backspace ลบ · Delete ล้าง</p>
    </Modal>
  );
}

type Bal = { item_id: string; item_code: string; item_name: string; unit_code: string | null; warehouse_code: string; warehouse_name: string; qty: string; value: string; avg_cost: string | null };
/** สอบถามยอดสินค้าคงเหลือ (S-AX-05): ยอดทุกคลังของสินค้า — คำนวณสดจากเอกสาร */
function StockInquiry({ onClose }: { onClose: () => void }) {
  const [item, setItem] = useState<{ id: string; code: string } | null>(null);
  const q = useQuery({ enabled: !!item, queryKey: ['aux-stock', item?.id], queryFn: () => api.get<{ rows: Bal[] }>('/api/v1/stock/balances', { item_id: item!.id, zero: 'Y' }), staleTime: 0 });
  const rows = q.data?.rows ?? [];
  const tot = rows.reduce((s, r) => s.plus(r.qty), d(0));
  return (
    <Modal title="สอบถามยอดสินค้าคงเหลือ (Shift+F4)" onClose={onClose} footer={<button className="primary" onClick={onClose}>ปิด <kbd>Esc</kbd></button>}>
      <Field label="รหัสสินค้า"><SearchPick<{ id: string; code: string; name_th: string }> endpoint="/api/v1/item-search" params={{ module: 'AR' }} value={item} autoFocus label={(r: { name_th: string }) => r.name_th} onPick={(r: { id: string; code: string } | null) => setItem(r)} /></Field>
      {item && <table className="grid" style={{ marginTop: 8 }}>
        <thead><tr><th>คลัง</th><th className="r">คงเหลือ</th><th>หน่วย</th><th className="r">ต้นทุนเฉลี่ย</th><th className="r">มูลค่า</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.warehouse_code}><td>{r.warehouse_code} {r.warehouse_name}</td><td className="r num">{d(r.qty).toString()}</td><td>{r.unit_code}</td><td className="r num">{r.avg_cost ? fmt(r.avg_cost, { places: 4 }) : ''}</td><td className="r num">{fmt(r.value)}</td></tr>)}
          {q.data && !rows.length && <tr><td colSpan={5} className="empty">ไม่มีความเคลื่อนไหว</td></tr>}</tbody>
        {rows.length > 1 && <tfoot><tr><td>รวมทุกคลัง</td><td className="r">{tot.toString()}</td><td colSpan={3} /></tr></tfoot>}
      </table>}
    </Modal>
  );
}

/** แสดงระบบ (S-AX-09): กิจการ ฐานข้อมูล รุ่นโปรแกรม ผู้ใช้ เครื่องที่ใช้ */
function SystemInfo({ onClose }: { onClose: () => void }) {
  const { me } = useSession();
  const h = useQuery({ queryKey: ['health'], queryFn: () => api.get<{ ok: boolean; mode: string; version: string }>('/api/v1/health') });
  const rows: Array<[string, string]> = [
    ['ชื่อกิจการ', `${me?.company?.name_th ?? '—'}${me?.company?.name_en ? ` / ${me.company.name_en}` : ''}`], ['รหัสบริษัท', me?.company?.code ?? '—'], ['สาขา', me?.branch ? `${me.branch.code} ${me.branch.name}` : '—'],
    ['ที่เก็บข้อมูล', h.data ? (h.data.mode === 'pglite' ? 'ฐานข้อมูลในเครื่อง (PGlite)' : 'PostgreSQL เซิร์ฟเวอร์') : '…'], ['รุ่นโปรแกรม', `Buddy Account ${h.data?.version ?? ''}`],
    ['ผู้ใช้', `${me?.user.username ?? ''} ${me?.user.display_name ?? ''} (ระดับอนุมัติ ${me?.user.approval_level ?? 0})`], ['วันทำการ', me?.work_date ?? '—'], ['ระบบปี', me?.company?.year_system === 'C' ? 'ค.ศ.' : 'พ.ศ.'],
    ['เบราว์เซอร์', navigator.userAgent], ['หน้าจอ', `${window.screen.width}×${window.screen.height}`], ['ภาษา/เขตเวลา', `${navigator.language} · ${Intl.DateTimeFormat().resolvedOptions().timeZone}`],
  ];
  return (
    <Modal title="แสดงระบบ (Shift+F10)" onClose={onClose} footer={<button className="primary" onClick={onClose}>ปิด <kbd>Esc</kbd></button>}>
      <table className="grid info-table"><tbody>{rows.map(([k, v]) => <tr key={k}><th>{k}</th><td className={k === 'เบราว์เซอร์' ? 'small' : ''}>{v}</td></tr>)}</tbody></table>
    </Modal>
  );
}
