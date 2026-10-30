import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { d, fmt, formatDate, todayIso, type YearSystem } from '@buddy/core';
import { api } from '../../api';
import { useCan, useSession } from '../../session';
import { LkSelect, SearchPick, useLookups } from '../../components/LkSelect';
import { NumInput, Confirm, cx, DateInput, DateText, ErrorBox, Field, KeyHints, Modal, Money, PageHead, Pill, toast, useHotkeys } from '../../ui';

/** ตรวจนับสินค้า (คู่มือบทที่ 14 S-IC-15..22) — ยอดตามระบบ ณ วันนับคำนวณสดทุกครั้ง */
interface Row { id: string; warehouse_id: string; warehouse_code: string; warehouse_name: string; item_id: string; item_code: string; item_name: string; shelf: string | null; flag: '1' | '3' | '6';
  counted_qty: string | null; counted_unit_qty: string | null; unit_code: string | null; count_unit_code: string | null; count_factor: string | null; system_qty: string; system_value: string;
  diff_qty: string | null; diff_value: string | null; avg_cost: string | null; adjust_header_id: string | null; adjust_doc_no: string | null; adjusted_system_qty: string | null; adjusted_diff: string | null; adjust_value: string | null }
type Edit = { counted: string; big: string; shelf: string };
const FLAG: Record<Row['flag'], [string, 'n' | 'c' | 'm' | 'd' | 'x']> = { '1': ['ยังไม่นับ', 'm'], '3': ['นับแล้ว', 'c'], '6': ['ปรับปรุงแล้ว', 'n'] };
const PRINT = { form: 'แบบฟอร์มเพื่อตรวจนับ', review: 'รายงานสอบทานยอดตรวจนับ', diff: 'รายงานผลต่างจากการตรวจนับ' } as const;
type PrintMode = keyof typeof PRINT;

export function CountsPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const can = useCan('IC.COUNT');
  const { me } = useSession();
  const lk = useLookups('WH');
  const dates = useQuery({ queryKey: ['stock-counts', 'dates'], queryFn: () => api.get<{ rows: Array<{ count_date: string; total: number; counted: number; adjusted: number }> }>('/api/v1/stock-counts/dates') });
  const [date, setDate] = useState<string | null>(null);
  const cur = date ?? (dates.data?.rows[0] ? String(dates.data.rows[0].count_date).slice(0, 10) : null);
  const [wh, setWh] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState<'code' | 'shelf'>('code');
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [prep, setPrep] = useState(false);
  const [adj, setAdj] = useState(false);
  const [add, setAdd] = useState(false);
  const [reopen, setReopen] = useState<{ id: string; doc_no: string } | null>(null);
  const [printMode, setPrintMode] = useState<PrintMode | null>(null);
  const list = useQuery({ enabled: !!cur, queryKey: ['stock-counts', cur, wh, q, status, sort], placeholderData: (p) => p,
    queryFn: () => api.get<{ rows: Row[]; diff_value: string; counted: number }>('/api/v1/stock-counts', { count_date: cur!, ...(wh ? { warehouse_id: wh } : {}), q, status, sort }) });
  const rows = list.data?.rows ?? [];
  const dirty = Object.keys(edits).length;
  const refresh = () => { qc.invalidateQueries({ queryKey: ['stock-counts'] }); qc.invalidateQueries({ queryKey: ['stock'] }); };
  const editOf = (r: Row): Edit => edits[r.id] ?? { counted: r.counted_qty === null ? '' : d(r.counted_qty).toString(), big: '', shelf: r.shelf ?? '' };
  const setEdit = (r: Row, p: Partial<Edit>) => setEdits((e) => {
    const next = { ...editOf(r), ...p };
    // หน่วยใหญ่ × ตัวคูณ + หน่วยย่อย = ยอดนับในหน่วยหลัก
    return { ...e, [r.id]: next };
  });
  const countedOf = (r: Row, e: Edit) => {
    if (e.counted === '' && e.big === '') return null;
    return d(e.big || 0).times(d(r.count_factor || 1)).plus(d(e.counted || 0)).toString();
  };
  const save = async () => {
    if (!dirty || busy) return;
    setErr(null); setBusy(true);
    try {
      const body = rows.filter((r) => edits[r.id]).map((r) => { const e = edits[r.id]!; return { id: r.id, counted_qty: countedOf(r, e), counted_unit_qty: e.big || null, shelf: e.shelf || null }; });
      const res = await api.put<{ updated: number }>('/api/v1/stock-counts/entries', { rows: body });
      toast(`บันทึกยอดนับ ${res.updated} รายการแล้ว`); setEdits({}); refresh();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const print = (m: PrintMode) => { setPrintMode(m); setTimeout(() => { window.print(); setPrintMode(null); }, 100); };
  useHotkeys({ F9: can('edit') ? save : undefined, 'Ctrl+S': can('edit') ? save : undefined, Insert: can('add') && cur ? () => setAdd(true) : undefined,
    Escape: () => { if (!dirty || window.confirm('มียอดนับที่ยังไม่บันทึก — ออกโดยไม่บันทึก?')) nav('/ic/stock'); } }, []);
  const wrows = lk.data?.WH;
  return (
    <div className="page" data-tone="inventory">
      <PageHead eyebrow="สินค้า" title="รายการตรวจนับสินค้า"
        lead="1 สร้างข้อมูลตรวจนับ → 2 พิมพ์แบบฟอร์ม → 3 ป้อนยอดนับ (ว่าง = ยังไม่นับ/คงยอดเดิม, นับไม่พบป้อน 0) → 4–5 รายงานสอบทาน/ผลต่าง → 6 ปรับปรุงยอด (สร้างใบปรับปรุง ณ วันนับ ให้ยอดเท่ายอดนับ) · ระหว่างนับห้ามบันทึกรายการเคลื่อนไหวของคลังที่นับ"
        actions={<>{can('add') && <button onClick={() => setPrep(true)}>1 สร้างข้อมูลตรวจนับ</button>}
          {can('approve') && <button disabled={!cur || dirty > 0} onClick={() => setAdj(true)}>6 ปรับปรุงยอดตามที่ตรวจนับ</button>}</>} />
      <div className="toolbar">
        <label>วันที่ตรวจนับ <select value={cur ?? ''} onChange={(e) => { setDate(e.target.value); setEdits({}); }} aria-label="วันที่ตรวจนับ">
          {!dates.data?.rows.length && <option value="">— ยังไม่มีข้อมูล —</option>}
          {dates.data?.rows.map((x) => { const v = String(x.count_date).slice(0, 10); return <option key={v} value={v}>{formatDate(v, me?.company?.year_system ?? 'B')} ({x.counted + x.adjusted}/{x.total} นับแล้ว{x.adjusted ? ` · ปรับปรุง ${x.adjusted}` : ''})</option>; })}
        </select></label>
        <label>คลัง <LkSelect byId rows={wrows} value={wh} onChange={(v) => setWh(v || null)} aria-label="คลัง" /></label>
        <input type="search" placeholder="ค้นหารหัส ชื่อ หรือชั้นเก็บ" value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหา" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="สถานะ"><option value="all">ทุกสถานะ</option><option value="1">ยังไม่นับ</option><option value="3">นับแล้ว (ยังไม่ปรับปรุง)</option><option value="6">ปรับปรุงแล้ว</option><option value="diff">เฉพาะที่มีผลต่าง</option></select>
        <select value={sort} onChange={(e) => setSort(e.target.value as 'code' | 'shelf')} aria-label="เรียง"><option value="code">เรียงตามรหัสสินค้า</option><option value="shelf">เรียงตามชั้นเก็บ + รหัส</option></select>
        {can('add') && cur && <button onClick={() => setAdd(true)}>+ เพิ่มสินค้า <kbd>Ins</kbd></button>}
        {can('edit') && <button className="primary" disabled={!dirty || busy} onClick={save}>3 บันทึกยอดนับ{dirty ? ` (${dirty})` : ''} <kbd>F9</kbd></button>}
        <select value="" onChange={(e) => e.target.value && print(e.target.value as PrintMode)} disabled={!rows.length} aria-label="พิมพ์"><option value="">🖨 พิมพ์…</option>{Object.entries(PRINT).map(([k, v], i) => <option key={k} value={k}>{[2, 4, 5][i]} {v}</option>)}</select>
      </div>
      <ErrorBox error={err ?? list.error ?? dates.error} />
      {!cur && dates.data && <p className="empty">ยังไม่มีข้อมูลตรวจนับ — กด “1 สร้างข้อมูลตรวจนับ” เพื่อเริ่ม</p>}
      {cur && <div className="table-wrap tall">
        <table className="grid">
          <thead><tr><th style={{ width: 70 }}>คลัง</th><th style={{ width: 160 }}>รหัสสินค้า</th><th>ชื่อสินค้า</th><th style={{ width: 90 }}>ชั้นเก็บ</th><th className="r" style={{ width: 110 }}>ยอดตามระบบ</th>
            <th className="r" style={{ width: 100 }}>หน่วยใหญ่</th><th className="r" style={{ width: 120 }}>ยอดนับ (หน่วยย่อย)</th><th style={{ width: 60 }}>หน่วย</th><th className="r" style={{ width: 100 }}>ผลต่าง</th><th className="r" style={{ width: 120 }}>มูลค่าผลต่าง</th><th style={{ width: 150 }}>สถานะ</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const e = editOf(r), locked = r.flag === '6' || !can('edit');
              const c = edits[r.id] ? countedOf(r, e) : r.counted_qty;
              const diff = c === null ? null : d(c).minus(d(r.system_qty));
              return (
                <tr key={r.id} className={cx(edits[r.id] && 'changed')}>
                  <td className="mono">{r.warehouse_code}</td><td className="mono">{r.item_code}</td><td>{r.item_name}</td>
                  <td><input value={e.shelf} maxLength={10} disabled={locked} onChange={(x) => setEdit(r, { shelf: x.target.value })} aria-label="ชั้นเก็บ" /></td>
                  <td className="r">{fmt(r.system_qty, { places: 2 })}</td>
                  <td>{r.count_unit_code && d(r.count_factor || 1).gt(1) ? <NumInput value={e.big} disabled={locked} title={`1 ${r.count_unit_code} = ${fmt(r.count_factor!, { places: 2 })} ${r.unit_code ?? ''}`} onChange={(v) => setEdit(r, { big: v })} aria-label="หน่วยใหญ่" /> : null}</td>
                  <td><NumInput value={e.counted} disabled={locked} placeholder="ยังไม่นับ" onChange={(v) => setEdit(r, { counted: v })} aria-label={`ยอดนับ ${r.item_code}`} /></td>
                  <td>{r.unit_code}</td>
                  <td className={cx('r', diff && diff.lt(0) && 'bad')}>{diff ? fmt(diff.toString(), { places: 2 }) : ''}</td>
                  <td className="r">{r.flag === '6' && r.adjust_value !== null ? <Money v={r.adjust_value} /> : diff && r.avg_cost ? <Money v={diff.times(d(r.avg_cost)).toFixed(2)} /> : ''}</td>
                  <td>{r.flag === '6' ? <><Pill tone="n">ปรับปรุงแล้ว</Pill> {r.adjust_header_id && <button className="link" onClick={() => setReopen({ id: r.adjust_header_id!, doc_no: r.adjust_doc_no! })} title="ยกเลิกใบปรับปรุงเพื่อแก้ยอดนับ (Ctrl+R ของ Express)">{r.adjust_doc_no}</button>}
                    {r.adjust_header_id && d(r.system_qty).minus(d(r.counted_qty ?? 0)).abs().gt(0) && <span className="bad small" title="มีรายการย้อนหลังหลังปรับปรุง ยอด ณ วันนับไม่เท่ายอดนับแล้ว — ยกเลิกใบปรับปรุงแล้วปรับปรุงใหม่"> ⚠ ยอดเปลี่ยน</span>}</>
                    : <Pill tone={FLAG[r.flag][1]}>{FLAG[r.flag][0]}</Pill>}</td>
                </tr>
              );
            })}
            {list.data && !rows.length && <tr><td colSpan={11} className="empty">ไม่มีรายการตามเงื่อนไขนี้</td></tr>}
          </tbody>
          {!!rows.length && <tfoot><tr><td colSpan={9} className="r">{rows.length.toLocaleString()} รายการ · นับแล้ว {list.data?.counted.toLocaleString()} · มูลค่าผลต่างโดยประมาณ (ต้นทุนเฉลี่ย ณ วันนับ)</td><td className="r"><b><Money v={list.data?.diff_value ?? '0'} /></b></td><td /></tr></tfoot>}
        </table>
      </div>}
      <KeyHints keys={[['F9', 'บันทึกยอดนับ'], ['Ins', 'เพิ่มสินค้าในรายการนับ'], ['Esc', 'กลับ']]} />
      {prep && <PrepareModal onClose={() => setPrep(false)} onDone={(dt) => { setPrep(false); setDate(dt); setEdits({}); refresh(); }} />}
      {adj && cur && <AdjustModal date={cur} onClose={() => setAdj(false)} onDone={() => { setAdj(false); refresh(); }} />}
      {add && cur && <AddModal date={cur} onClose={() => setAdd(false)} onDone={() => { setAdd(false); refresh(); }} />}
      {reopen && <ReopenConfirm doc={reopen} onClose={() => setReopen(null)} onDone={() => { setReopen(null); refresh(); }} />}
      {printMode && cur && createPortal(<CountPrint mode={printMode} date={cur} rows={rows} company={me?.company?.name_th ?? ''} yearSystem={me?.company?.year_system ?? 'B'} />, document.body)}
    </div>
  );
}

function CountPrint({ mode, date, rows, company, yearSystem }: { mode: PrintMode; date: string; rows: Row[]; company: string; yearSystem: YearSystem }) {
  const show = mode === 'review' ? rows.filter((r) => r.counted_qty !== null) : mode === 'diff' ? rows.filter((r) => r.counted_qty !== null && !d(r.diff_qty ?? 0).isZero()) : rows;
  const groups = [...new Set(show.map((r) => r.warehouse_code))];
  return (
    <div className="vat-print">
      <h2>{PRINT[mode]}</h2>
      <p style={{ textAlign: 'center' }}>{company} · วันที่ตรวจนับ {formatDate(date, yearSystem)}</p>
      {groups.map((g) => { const gr = show.filter((r) => r.warehouse_code === g); return (
        <div key={g}>
          <p><b>คลัง {g} {gr[0]?.warehouse_name}</b></p>
          <table><thead><tr><th>รหัสสินค้า</th><th>ชื่อสินค้า</th><th>ชั้นเก็บ</th>{mode === 'form' && <><th>หน่วยใหญ่</th><th>หน่วยย่อย</th><th>หน่วย</th></>}
            {mode === 'review' && <><th>ยอดนับหน่วยใหญ่</th><th>ยอดนับหน่วยย่อย</th><th>หน่วย</th></>}{mode === 'diff' && <><th>ยอดตามระบบ</th><th>ยอดนับ</th><th>ผลต่าง</th><th>มูลค่าผลต่าง</th></>}</tr></thead>
          <tbody>{gr.map((r) => <tr key={r.id}><td>{r.item_code}</td><td>{r.item_name}</td><td>{r.shelf}</td>
            {mode === 'form' && <><td style={{ width: 90 }} /><td style={{ width: 90 }} /><td>{r.unit_code}</td></>}
            {mode === 'review' && <><td className="r">{r.counted_unit_qty ? fmt(r.counted_unit_qty, { places: 2 }) : ''}</td><td className="r">{fmt(r.counted_qty!, { places: 2 })}</td><td>{r.unit_code}</td></>}
            {mode === 'diff' && <><td className="r">{fmt(r.system_qty, { places: 2 })}</td><td className="r">{fmt(r.counted_qty!, { places: 2 })}</td><td className="r">{fmt(r.diff_qty!, { places: 2 })}</td><td className="r">{r.diff_value ? fmt(r.diff_value) : ''}</td></>}</tr>)}</tbody></table>
          <p>รวม {gr.length.toLocaleString()} สินค้า</p>
        </div>); })}
      {mode === 'form' && <p style={{ marginTop: 24 }}>ผู้ตรวจนับ ............................................ ผู้ตรวจสอบ ............................................</p>}
    </div>
  );
}

function PrepareModal({ onClose, onDone }: { onClose: () => void; onDone: (date: string) => void }) {
  const { me } = useSession();
  const lk = useLookups('WH');
  const [f, setF] = useState({ count_date: me?.work_date ?? todayIso(), replace: true, warehouse_from: '', warehouse_to: '', item_from: '', item_to: '', counted_before: '', moved_after: '' });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const ok = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.post<{ added: number; removed: number }>('/api/v1/stock-counts/prepare', { ...f, counted_before: f.counted_before || null, moved_after: f.moved_after || null });
      toast(`สร้างข้อมูลตรวจนับ ${r.added.toLocaleString()} รายการ${r.removed ? ` (ลบข้อมูลนับเดิมที่ยังไม่ปรับปรุง ${r.removed.toLocaleString()})` : ''}`); onDone(f.count_date);
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const whs = lk.data?.WH;
  return (
    <Modal title="สร้างข้อมูลเพื่อการตรวจนับ" onClose={onClose} footer={<><button className="primary" disabled={busy} onClick={ok}>ตกลง</button><button onClick={onClose}>ยกเลิก <kbd>Esc</kbd></button></>}>
      <ErrorBox error={err} />
      <div className="form-grid">
        <Field label="วันที่ที่จะตรวจนับ" req hint="วันที่หยุดเดินรายการเพื่อนับจริง (นับหลายวันใช้วันสุดท้าย)"><DateInput value={f.count_date} onChange={(v) => setF({ ...f, count_date: v })} /></Field>
        <Field label="ลบข้อมูลนับเดิมก่อนสร้าง" hint="ลบเฉพาะที่ยังไม่ปรับปรุง ไม่กระทบยอดคงเหลือจริง"><label className="check"><input type="checkbox" checked={f.replace} onChange={(e) => setF({ ...f, replace: e.target.checked })} /> ลบ</label></Field>
        <Field label="คลังสินค้า จาก"><LkSelect rows={whs} value={f.warehouse_from} onChange={(v) => setF({ ...f, warehouse_from: v })} aria-label="คลังจาก" /></Field>
        <Field label="ถึง"><LkSelect rows={whs} value={f.warehouse_to} onChange={(v) => setF({ ...f, warehouse_to: v })} aria-label="คลังถึง" /></Field>
        <Field label="รหัสสินค้า จาก" hint="ว่าง = ทั้งหมด"><input className="mono" value={f.item_from} maxLength={30} onChange={(e) => setF({ ...f, item_from: e.target.value })} /></Field>
        <Field label="ถึง"><input className="mono" value={f.item_to} maxLength={30} onChange={(e) => setF({ ...f, item_to: e.target.value })} /></Field>
        <Field label="เฉพาะที่ตรวจนับครั้งสุดท้ายก่อนวันที่" hint="ข้ามสินค้าที่นับไปแล้วตั้งแต่วันนี้"><DateInput value={f.counted_before} onChange={(v) => setF({ ...f, counted_before: v })} /></Field>
        <Field label="เฉพาะที่เคลื่อนไหวหลังวันที่"><DateInput value={f.moved_after} onChange={(v) => setF({ ...f, moved_after: v })} /></Field>
      </div>
    </Modal>
  );
}

function AdjustModal({ date, onClose, onDone }: { date: string; onClose: () => void; onDone: () => void }) {
  const lk = useLookups('WH');
  const nav = useNavigate();
  const defs = useQuery({ queryKey: ['trade-defaults', 'JU'], queryFn: () => api.get<{ types: Array<{ id: string; code: string; name_th: string }> }>('/api/v1/trade-defaults/JU') });
  const [f, setF] = useState({ warehouse_from: '', warehouse_to: '', item_from: '', item_to: '', doc_type_id: '', remark: '' });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const types = defs.data?.types ?? [];
  const dt = f.doc_type_id || (types.find((t) => t.code === 'TK') ?? types[0])?.id || '';
  const ok = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.post<{ id: string; doc_no: string; lines: number }>('/api/v1/stock-counts/adjust', { ...f, count_date: date, doc_type_id: dt || undefined, remark: f.remark || undefined });
      toast(`สร้างใบปรับปรุง ${r.doc_no} (${r.lines.toLocaleString()} รายการ) แล้ว`); onDone();
      if (window.confirm(`เปิดใบปรับปรุง ${r.doc_no}?`)) nav(`/ic/adjustments/${r.id}`);
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <Modal title="ปรับปรุงยอดสินค้าตามที่ตรวจนับ" onClose={onClose} footer={<><button className="primary" disabled={busy} onClick={ok}>ตกลง</button><button onClick={onClose}>ยกเลิก <kbd>Esc</kbd></button></>}>
      <ErrorBox error={err} />
      <p className="hint">สร้างใบปรับปรุงลงวันที่ <DateText v={date} /> สำหรับรายการที่ “นับแล้ว” ให้ยอด ณ วันนับเท่ายอดนับ (สร้างบรรทัดแม้ผลต่างเป็น 0) · ควรพิมพ์รายงานผลต่างตรวจสอบก่อน</p>
      <div className="form-grid">
        <Field label="ประเภทเอกสาร"><select value={dt} onChange={(e) => setF({ ...f, doc_type_id: e.target.value })}>{types.map((t) => <option key={t.id} value={t.id}>{t.code} {t.name_th}</option>)}</select></Field>
        <Field label="หมายเหตุ"><input value={f.remark} maxLength={200} placeholder={`ปรับปรุงจากการตรวจนับ ${date}`} onChange={(e) => setF({ ...f, remark: e.target.value })} /></Field>
        <Field label="คลังสินค้า จาก"><LkSelect rows={lk.data?.WH} value={f.warehouse_from} onChange={(v) => setF({ ...f, warehouse_from: v })} aria-label="คลังจาก" /></Field>
        <Field label="ถึง"><LkSelect rows={lk.data?.WH} value={f.warehouse_to} onChange={(v) => setF({ ...f, warehouse_to: v })} aria-label="คลังถึง" /></Field>
        <Field label="รหัสสินค้า จาก" hint="ว่าง = ทั้งหมด"><input className="mono" value={f.item_from} maxLength={30} onChange={(e) => setF({ ...f, item_from: e.target.value })} /></Field>
        <Field label="ถึง"><input className="mono" value={f.item_to} maxLength={30} onChange={(e) => setF({ ...f, item_to: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function AddModal({ date, onClose, onDone }: { date: string; onClose: () => void; onDone: () => void }) {
  const lk = useLookups('WH');
  const [wh, setWh] = useState<string | null>(null);
  const [item, setItem] = useState<{ id: string; code: string; name?: string | null } | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const ok = async () => {
    setErr(null);
    try { await api.post('/api/v1/stock-counts/rows', { count_date: date, warehouse_id: wh, item_id: item?.id }); toast('เพิ่มสินค้าในรายการนับแล้ว'); onDone(); } catch (e) { setErr(e); }
  };
  return (
    <Modal title="เพิ่มสินค้าในรายการนับ" onClose={onClose} footer={<><button className="primary" disabled={!wh || !item} onClick={ok}>เพิ่ม</button><button onClick={onClose}>ยกเลิก <kbd>Esc</kbd></button></>}>
      <ErrorBox error={err} />
      <p className="hint">สำหรับสินค้าที่พบในคลังแต่ไม่อยู่ในรายการ (เช่น ไม่เคยมีความเคลื่อนไหวในคลังนี้)</p>
      <div className="form-grid">
        <Field label="คลัง" req><LkSelect byId rows={lk.data?.WH} value={wh} onChange={(v) => setWh(v || null)} aria-label="คลัง" /></Field>
        <Field label="รหัสสินค้า" req><SearchPick<{ id: string; code: string; name_th: string }> endpoint="/api/v1/item-search" params={{ module: 'AP', types: '0' }} required value={item} autoFocus label={(r: { name_th: string }) => r.name_th}
          onPick={(r: { id: string; code: string; name_th: string } | null) => setItem(r ? { id: r.id, code: r.code, name: r.name_th } : null)} /></Field>
      </div>
    </Modal>
  );
}

function ReopenConfirm({ doc, onClose, onDone }: { doc: { id: string; doc_no: string }; onClose: () => void; onDone: () => void }) {
  const can = useCan('IC.COUNT');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const ok = async () => {
    try { await api.post('/api/v1/stock-counts/reopen', { header_id: doc.id, reason }); toast(`ยกเลิก ${doc.doc_no} แล้ว — แก้ยอดนับแล้วปรับปรุงใหม่ได้`); onDone(); } catch (e) { setErr(e); }
  };
  if (!can('cancel')) return <Confirm title="ยกเลิกการปรับปรุง" text="ต้องมีสิทธิ์ยกเลิก (ผู้ใช้ระดับ 5 ขึ้นไป)" okText="ปิด" onClose={onClose} onOk={onClose} />;
  return (
    <Confirm danger title="ยกเลิกการปรับปรุงจากการตรวจนับ" text={<>ยกเลิกใบปรับปรุง <b>{doc.doc_no}</b>? ยอดสต๊อกกลับเป็นก่อนปรับปรุง และผลนับทุกรายการในใบนี้กลับเป็น “นับแล้ว” ให้แก้ไขได้</>} okText="ยกเลิกใบปรับปรุง" onClose={onClose} onOk={ok}>
      <ErrorBox error={err} />
      <Field label="เหตุผลที่ยกเลิก" req><input autoFocus value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></Field>
    </Confirm>
  );
}
