import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { d, fmt } from '@buddy/core';
import { api } from '../../api';
import { useCan } from '../../session';
import { focusAfterTable, LkSelect, SearchPick, useLookups } from '../../components/LkSelect';
import { Confirm, cx, DateInput, DateText, ErrorBox, Field, KeyHints, Money, MoneyInput, navKey, PageHead, Pill, toast, useHotkeys } from '../../ui';
import { useDocEdit } from '../../components/DocEdit';

/** ยอดยกมาสินค้า (คู่มือ S-OB-01 ล็อตยกมา FIFO / S-OB-02 ยอดยกมารายคลัง Average) — 1 ใบ = 1 ล็อต ไม่ลงบัญชี */
const ROUTE = '/ic/opening';
const MENU = 'IC.OB';
interface Row { id: string; doc_no: string; doc_date: string; remark: string | null; net_amount: string; doc_status: string; lines: number; qty: string }
export function StockOpeningListPage() {
  const nav = useNavigate();
  const can = useCan(MENU);
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: ['stock-opening', q], queryFn: () => api.get<{ rows: Row[]; total: string; start_date: string | null }>('/api/v1/stock-opening', { q }), placeholderData: (p) => p });
  useHotkeys({ Insert: can('add') ? () => nav(`${ROUTE}/new`) : undefined }, []);
  return (
    <div className="page" data-tone="inventory">
      <PageHead eyebrow="สินค้า" title="ยอดยกมาสินค้า"
        lead={<>สินค้าที่มี ณ วันเริ่มใช้โปรแกรม{list.data?.start_date ? <> (<DateText v={list.data.start_date} />)</> : ''} — 1 ใบต่อ 1 ล็อต (FIFO: ใช้เลขที่และวันที่ของเอกสารรับเข้าเดิม · ไม่ทราบล็อต/ถัวเฉลี่ย: เลขที่ “ยอดยกมา” ใบเดียว) ·
          ไม่ลงบัญชี — ยอดบัญชีป้อนที่ บันทึกยอดยกมา (Periodic: ป้อนบัญชีสินค้าคงเหลือด้วย)</>}
        actions={can('add') && <button className="primary" onClick={() => nav(`${ROUTE}/new`)}>+ เพิ่มล็อต <kbd>Ins</kbd></button>} />
      <div className="toolbar"><input type="search" autoFocus placeholder="ค้นหาเลขที่ล็อต หมายเหตุ หรือรหัส/ชื่อสินค้า" value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหา" /></div>
      <ErrorBox error={list.error} />
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th style={{ width: 160 }}>เลขที่ล็อต</th><th style={{ width: 110 }}>วันที่</th><th>หมายเหตุ</th><th className="r" style={{ width: 90 }}>รายการ</th><th className="r" style={{ width: 130 }}>จำนวนรวม</th><th className="r" style={{ width: 150 }}>มูลค่ายกมา</th><th style={{ width: 90 }}>สถานะ</th></tr></thead>
          <tbody>
            {list.data?.rows.map((r) => (
              <tr key={r.id} className={cx('row-open', r.doc_status === 'C' && 'cancelled')} tabIndex={0} onClick={() => nav(`${ROUTE}/${r.id}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`${ROUTE}/${r.id}`)}>
                <td className="mono">{r.doc_no}</td><td><DateText v={r.doc_date} /></td><td>{r.remark}</td><td className="r">{r.lines.toLocaleString()}</td><td className="r">{fmt(r.qty, { places: 2 })}</td>
                <td className="r"><Money v={r.net_amount} /></td><td>{r.doc_status === 'C' ? <Pill tone="x">ยกเลิก</Pill> : <Pill tone="n">ยอดยกมา</Pill>}</td>
              </tr>
            ))}
            {list.data && !list.data.rows.length && <tr><td colSpan={7} className="empty">ยังไม่มียอดยกมาสินค้า — กด Ins เพื่อเพิ่ม</td></tr>}
          </tbody>
          {!!list.data?.rows.length && <tfoot><tr><td colSpan={5} className="r">มูลค่ายกมารวม (ไม่รวมที่ยกเลิก)</td><td className="r"><b><Money v={list.data.total} /></b></td><td /></tr></tfoot>}
        </table>
      </div>
      <KeyHints keys={[['Ins', 'เพิ่มล็อต'], ['คลิก/Enter', 'เปิดรายการ']]} />
    </div>
  );
}

interface Line { key: number; item_id: string | null; item_code: string; item_name: string; unit_code: string | null; warehouse_id: string | null; qty: string; value: string }
let seq = 0;
const blank = (wh: string | null = null): Line => ({ key: ++seq, item_id: null, item_code: '', item_name: '', unit_code: null, warehouse_id: wh, qty: '', value: '' });

export function StockOpeningFormPage() {
  const { id: routeId } = useParams();
  const id = routeId && routeId !== 'new' ? routeId : null;
  const nav = useNavigate();
  const qc = useQueryClient();
  const can = useCan(MENU);
  const lk = useLookups('WH');
  const meta = useQuery({ enabled: !id, queryKey: ['stock-opening', 'meta'], queryFn: () => api.get<{ start_date: string | null }>('/api/v1/stock-opening', { limit: 1 }) });
  const cur = useQuery({ enabled: !!id, queryKey: ['stock-opening', 'one', id], staleTime: 0, queryFn: () => api.get<{ doc_no: string; doc_date: string; remark: string | null; doc_status: string; editable: boolean;
    lines: Array<{ item_id: string; item_code: string; item_name: string; unit_code: string | null; warehouse_id: string; qty: string; value: string }> }>(`/api/v1/stock-opening/${id}`) });
  const [h, setH] = useState<{ doc_no: string; doc_date: string; remark: string } | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [askCancel, setAskCancel] = useState(false);
  const [reason, setReason] = useState('');
  if (!h && !id && meta.data) {
    const before = meta.data.start_date ? new Date(new Date(meta.data.start_date).getTime() - 86400000).toISOString().slice(0, 10) : '';
    setH({ doc_no: 'ยอดยกมา', doc_date: before, remark: '' }); setLines([blank(lk.data?.WH?.[0]?.id ?? null)]);
  }
  if (!h && id && cur.data) {
    const c = cur.data;
    setH({ doc_no: c.doc_no, doc_date: String(c.doc_date).slice(0, 10), remark: c.remark ?? '' });
    setLines([...c.lines.map((l) => ({ key: ++seq, item_id: l.item_id, item_code: l.item_code, item_name: l.item_name, unit_code: l.unit_code, warehouse_id: l.warehouse_id, qty: d(l.qty).toString(), value: d(l.value).toFixed(2) })),
      ...(c.editable && can('edit') && c.lines.length < 300 ? [blank(c.lines[c.lines.length - 1]?.warehouse_id ?? null)] : [])]);
  }
  const roBase = !!id && (!cur.data?.editable || !can('edit'));
  const ed = useDocEdit({ id: id ?? undefined, allowed: !!id && !roBase, dirty, onSave: (n) => void save(!!n), onDiscard: () => { setH(null); setDirty(false); } });
  const ro = roBase || ed.locked;
  const cancelled = cur.data?.doc_status === 'C';
  const set = (p: Partial<NonNullable<typeof h>>) => { setH((x) => ({ ...x!, ...p })); setDirty(true); };
  const setLine = (key: number, p: Partial<Line>) => { setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l))); setDirty(true); };
  const pickItem = (key: number, r: { id: string; code: string; name_th: string; base_unit_code?: string | null } | null) => {
    setLines((ls) => {
      const next = ls.map((l) => (l.key === key ? { ...l, item_id: r?.id ?? null, item_code: r?.code ?? '', item_name: r?.name_th ?? '', unit_code: r?.base_unit_code ?? null } : l));
      return next[next.length - 1]!.item_id ? [...next, blank(next[next.length - 1]!.warehouse_id)] : next;
    });
    setDirty(true);
  };
  const used = lines.filter((l) => l.item_id);
  const totQ = used.reduce((s, l) => s.plus(d(l.qty || 0)), d(0)), totV = used.reduce((s, l) => s.plus(d(l.value || 0)), d(0));
  const save = async (andNew = false) => {
    if (!h || busy || ro) return;
    setErr(null); setBusy(true);
    const body = { doc_no: h.doc_no, doc_date: h.doc_date, remark: h.remark || null, lines: used.map((l) => ({ item_id: l.item_id, warehouse_id: l.warehouse_id, qty: l.qty || '0', value: l.value || '0' })) };
    try {
      const r = id ? await api.put<{ id: string; doc_no: string }>(`/api/v1/stock-opening/${id}`, body) : await api.post<{ id: string; doc_no: string }>('/api/v1/stock-opening', body);
      toast(`บันทึกล็อต ${r.doc_no} แล้ว`); setDirty(false); if (id) ed.lock(); await qc.invalidateQueries({ queryKey: ['stock-opening'] }); qc.invalidateQueries({ queryKey: ['stock'] });
      if (andNew) { setH(null); setLines([]); nav(`${ROUTE}/new`, { replace: true }); }
      else if (!id) { setH(null); setLines([]); nav(`${ROUTE}/${r.id}`, { replace: true }); }
      else { await qc.refetchQueries({ queryKey: ['stock-opening', 'one', id] }); setH(null); }
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const cancelDoc = async () => {
    try { await api.post(`/api/v1/stock-opening/${id}/cancel`, { reason }); toast('ยกเลิกล็อตยกมาแล้ว'); setAskCancel(false); qc.invalidateQueries({ queryKey: ['stock-opening'] }); qc.invalidateQueries({ queryKey: ['stock'] }); nav(ROUTE); }
    catch (e) { setAskCancel(false); setErr(e); }
  };
  useHotkeys({ F9: () => save(), 'Ctrl+S': () => save(), 'Ctrl+Enter': () => save(true), 'Alt+C': id && can('cancel') && !cancelled ? () => setAskCancel(true) : undefined,
    Escape: () => { if (!dirty || window.confirm('มีการแก้ไขที่ยังไม่บันทึก — ออกโดยไม่บันทึก?')) nav(ROUTE); } }, []);
  return (
    <div className="page" data-tone="inventory">
      <div className="doc-title"><p className="eyebrow">สินค้า › ยอดยกมาสินค้า</p><h1>{id ? cur.data?.doc_no : 'ล็อตใหม่'}</h1>
        <span className="doc-state">{cancelled ? <Pill tone="x">ยกเลิก</Pill> : id ? <Pill tone="n">ยอดยกมา (ไม่ลงบัญชี)</Pill> : <Pill tone="m">ใหม่ — ยังไม่บันทึก</Pill>}{dirty && <Pill tone="c">มีการแก้ไขที่ยังไม่บันทึก</Pill>}{ed.locked && !roBase && <Pill tone="n">ดูอย่างเดียว — กด แก้ไข (Alt+E)</Pill>}</span></div>
      <div className="toolbar">
        <button className="primary" disabled={busy || ro} onClick={() => save()}>บันทึก <kbd>F9</kbd></button>
        {ed.editButton}
        <button disabled={busy || ro} onClick={() => save(true)}>บันทึก+ใหม่ <kbd>Ctrl+Enter</kbd></button>
        <button disabled={!id || cancelled || !can('cancel')} onClick={() => setAskCancel(true)}>ยกเลิกล็อต <kbd>Alt+C</kbd></button>
        <button onClick={() => nav(ROUTE)}>รายการ <kbd>Esc</kbd></button>
      </div>
      {ed.dialog}
      <ErrorBox error={err ?? cur.error} />
      {h && <div onKeyDown={(e) => navKey(e, ed.end)}>
        <div className="head-grid trade-head">
          <div className="col">
            <Field label="เลขที่เอกสาร (ล็อต)" req hint="FIFO: เลขที่เอกสารรับเข้าเดิม เช่น RR0000002 · ไม่ทราบล็อต ใส่ “ยอดยกมา”"><input className="mono" value={h.doc_no} maxLength={30} disabled={ro} autoFocus={!id} onChange={(e) => set({ doc_no: e.target.value })} /></Field>
            <Field label="หมายเหตุ"><input value={h.remark} maxLength={200} disabled={ro} onChange={(e) => set({ remark: e.target.value })} /></Field>
          </div>
          <div className="col">
            <Field label="วันที่ของล็อต" req hint="ต้องก่อนวันเริ่มใช้โปรแกรม · FIFO ตัดล็อตเก่าก่อนตามวันที่"><DateInput value={h.doc_date} disabled={ro} onChange={(v) => set({ doc_date: v })} /></Field>
          </div>
        </div>
        <div className="table-wrap">
          <table className="grid lines">
            <thead><tr><th style={{ width: 40 }}>#</th><th style={{ width: 200 }}>รหัสสินค้า</th><th>ชื่อสินค้า</th><th style={{ width: 130 }}>คลัง</th><th className="r" style={{ width: 130 }}>จำนวนยกมา</th><th style={{ width: 70 }}>หน่วย</th><th className="r" style={{ width: 150 }}>มูลค่ายกมา</th><th className="r" style={{ width: 110 }}>ทุน/หน่วย</th><th style={{ width: 40 }} /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.key}>
                  <td className="muted">{i + 1}</td>
                  <td><SearchPick endpoint="/api/v1/item-search" params={{ module: 'AP', types: '0' }} value={l.item_id ? { id: l.item_id, code: l.item_code } : null} required={!lines.some((x) => x.item_id && x.key !== l.key)} onEmptyEnter={focusAfterTable} disabled={ro} label={(r: { name_th: string }) => r.name_th}
                    onPick={(r: { id: string; code: string; name_th: string; base_unit_code?: string | null } | null) => pickItem(l.key, r)} aria-label={`รหัสสินค้า ${i + 1}`} /></td>
                  <td>{l.item_name}</td>
                  <td><LkSelect byId rows={lk.data?.WH} value={l.warehouse_id} disabled={ro} onChange={(v) => setLine(l.key, { warehouse_id: v || null })} aria-label="คลัง" /></td>
                  <td><input className="r" inputMode="decimal" value={l.qty} disabled={ro} title="คิดเป็นหน่วยนับย่อย" onChange={(e) => setLine(l.key, { qty: e.target.value.replace(/[^\d.]/g, '') })} aria-label="จำนวนยกมา" /></td>
                  <td>{l.unit_code}</td>
                  <td><MoneyInput value={l.value} disabled={ro} onChange={(v) => setLine(l.key, { value: v })} aria-label="มูลค่ายกมา" /></td>
                  <td className="r muted">{l.qty && d(l.qty).gt(0) && l.value ? fmt(d(l.value).div(d(l.qty)).toFixed(4), { places: 4 }) : ''}</td>
                  <td>{!ro && l.item_id && <button className="icon" title="ลบบรรทัด" onClick={() => { setLines((ls) => ls.filter((x) => x.key !== l.key)); setDirty(true); }}>✕</button>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={4} className="r">รวม {used.length.toLocaleString()} รายการ</td><td className="r"><b>{fmt(totQ.toString(), { places: 2 })}</b></td><td /><td className="r"><b><Money v={totV.toFixed(2)} /></b></td><td colSpan={2} /></tr></tfoot>
          </table>
        </div>
      </div>}
      <KeyHints keys={[['Enter', 'ช่องถัดไป (ช่องสุดท้าย = ถามบันทึก)'], ['Alt+E', 'แก้ไขเอกสารที่บันทึกแล้ว'], ['F4', 'ค้นหาสินค้า'], ['F9', 'บันทึก'], ['Ctrl+Enter', 'บันทึก+ใหม่'], ['Alt+C', 'ยกเลิก'], ['Esc', 'กลับรายการ']]} />
      {askCancel && <Confirm danger title="ยกเลิกล็อตยกมา" text={<>ยกเลิก <b>{cur.data?.doc_no}</b>? ยอดสต๊อกยกมาของล็อตนี้จะหายไป (เปลี่ยนสถานะ ไม่ลบ)</>} okText="ยกเลิกล็อต" onClose={() => setAskCancel(false)} onOk={cancelDoc}>
        <Field label="เหตุผลที่ยกเลิก" req><input autoFocus value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></Field>
      </Confirm>}
    </div>
  );
}
