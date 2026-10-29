import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { d, fmt, STOCK_KINDS, todayIso, type StockKind } from '@buddy/core';
import { api } from '../../api';
import { useCan, useSession } from '../../session';
import { LkSelect, SearchPick, useLookups } from '../../components/LkSelect';
import { Confirm, cx, DateInput, DateText, ErrorBox, Field, KeyHints, Money, MoneyInput, navKey, PageHead, Pill, Tabs, toast, useHotkeys } from '../../ui';
import { DocActions } from '../../components/DocPrint';
import { DocJournalTab } from './TradeDocs';

/** รายการประจำวันสินค้า (คู่มือบทที่ 14 S-IC-06/08/10 + เพิ่ม/ลดต้นทุน) — สต๊อกคำนวณสดจากเอกสาร */
const MENU = 'IC.TRN';
const kindOf = (cls: string) => STOCK_KINDS.find((k) => k.cls === cls)!;
const LEAD: Record<StockKind['cls'], string> = {
  OU: 'จ่ายสินค้าออกจากคลังเพื่อใช้ภายใน (ไม่ใช่การขาย) ตัดสต๊อกด้วยต้นทุนตามวิธีของกลุ่มบัญชีสินค้า · ลงบัญชีตามประเภทเอกสาร (Dr ค่าใช้จ่าย / Cr สินค้า)',
  RL: 'ย้ายสินค้าจากคลังหนึ่งไปอีกคลัง จำนวนและต้นทุนเท่ากันทั้งสองฝั่ง ไม่ลงบัญชี',
  JU: 'ปรับยอดสินค้าเพิ่ม (จำนวนบวก) หรือลด (จำนวนลบ) เช่น ของแถม ของเสีย ผลตรวจนับ · เพิ่มใช้ทุนต่อหน่วยที่ป้อน (ว่าง = ต้นทุนเฉลี่ย)',
  CA: 'เพิ่ม (+) หรือลด (−) มูลค่าต้นทุนโดยไม่เปลี่ยนจำนวน เช่น ค่าขนส่งที่มาภายหลัง · สินค้า FIFO ต้องเลือกล็อตรับเข้าที่ปรับ',
};

interface Row { id: string; doc_no: string; doc_date: string; remark: string | null; net_amount: string; doc_status: string; warehouse_code: string | null; to_warehouse_code: string | null; lines: number }
export function StockDocListPage({ cls }: { cls: StockKind['cls'] }) {
  const K = kindOf(cls);
  const nav = useNavigate();
  const can = useCan(MENU);
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: [K.path, q], queryFn: () => api.get<{ rows: Row[] }>(`/api/v1/${K.path}`, { q }), placeholderData: (p) => p });
  useHotkeys({ Insert: can('add') ? () => nav(`${K.route}/new`) : undefined }, [K.route]);
  return (
    <div className="page" data-tone="inventory">
      <PageHead eyebrow="สินค้า › รายการประจำวันสินค้า" title={K.label} lead={LEAD[cls]}
        actions={can('add') && <button className="primary" onClick={() => nav(`${K.route}/new`)}>+ เพิ่มเอกสาร <kbd>Ins</kbd></button>} />
      <Tabs active={cls} onChange={(c) => nav(kindOf(c).route)} tabs={STOCK_KINDS.map((k) => ({ key: k.cls, label: k.label }))} />
      <div className="toolbar"><input type="search" autoFocus placeholder="ค้นหาเลขที่ หรือหมายเหตุ" value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหา" /></div>
      <ErrorBox error={list.error} />
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th style={{ width: 140 }}>เลขที่</th><th style={{ width: 110 }}>วันที่</th>{cls === 'RL' && <th style={{ width: 150 }}>จากคลัง → คลัง</th>}<th>หมายเหตุ</th><th className="r" style={{ width: 80 }}>รายการ</th><th className="r" style={{ width: 140 }}>มูลค่าต้นทุน</th><th style={{ width: 90 }}>สถานะ</th></tr></thead>
          <tbody>
            {list.data?.rows.map((r) => (
              <tr key={r.id} className={cx('row-open', r.doc_status === 'C' && 'cancelled')} tabIndex={0} onClick={() => nav(`${K.route}/${r.id}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`${K.route}/${r.id}`)}>
                <td className="mono">{r.doc_no}</td><td><DateText v={r.doc_date} /></td>{cls === 'RL' && <td className="mono">{r.warehouse_code} → {r.to_warehouse_code}</td>}<td>{r.remark}</td>
                <td className="r">{r.lines}</td><td className="r"><Money v={r.net_amount} /></td><td>{r.doc_status === 'C' ? <Pill tone="x">ยกเลิก</Pill> : <Pill tone="n">ปกติ</Pill>}</td>
              </tr>
            ))}
            {list.data && !list.data.rows.length && <tr><td colSpan={7} className="empty">ยังไม่มีเอกสาร — กด Ins เพื่อเพิ่ม</td></tr>}
          </tbody>
        </table>
      </div>
      <KeyHints keys={[['Ins', 'เพิ่มเอกสาร'], ['คลิก/Enter', 'เปิดเอกสาร']]} />
    </div>
  );
}

interface ItemHit { id: string; code: string; name_th: string; base_unit_id: string | null; std_cost: string | null; cost_method?: string | null }
interface Line { key: number; item_id: string | null; item_code: string; description: string; warehouse_id: string | null; qty: string; unit_id: string | null; factor: string; unit_cost: string; amount: string; source_line_id: string | null; cost_amount: string | null; cost_unit: string | null }
interface Head { doc_type_id: string; doc_date: string; department_id: string; remark: string; your_ref: string; warehouse_id: string | null; to_warehouse_id: string | null }
let seq = 0;
const blank = (): Line => ({ key: ++seq, item_id: null, item_code: '', description: '', warehouse_id: null, qty: '', unit_id: null, factor: '1', unit_cost: '', amount: '', source_line_id: null, cost_amount: null, cost_unit: null });

/** ล็อตรับเข้าของสินค้า (FIFO) สำหรับปรับต้นทุน */
function LotSelect({ itemId, warehouseId, value, disabled, onChange }: { itemId: string; warehouseId: string | null; value: string | null; disabled?: boolean; onChange: (v: string | null) => void }) {
  const lots = useQuery({ queryKey: ['stock-lots', itemId, warehouseId], queryFn: () => api.get<{ rows: Array<{ line_id: string; doc_no: string; doc_date: string; qty: string; value: string; warehouse_code: string }> }>('/api/v1/stock/lots', { item_id: itemId, ...(warehouseId ? { warehouse_id: warehouseId } : {}) }) });
  return (
    <select value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value || null)} aria-label="ล็อตรับเข้า">
      <option value="">— ไม่อ้างล็อต (ถัวเฉลี่ย) —</option>
      {lots.data?.rows.map((l) => <option key={l.line_id} value={l.line_id}>{l.doc_no} {String(l.doc_date).slice(0, 10)} {l.warehouse_code} รับ {fmt(l.qty, { places: 2 })} มูลค่า {fmt(l.value)}</option>)}
    </select>
  );
}

export function StockDocFormPage({ cls }: { cls: StockKind['cls'] }) {
  const K = kindOf(cls);
  const { id: routeId } = useParams();
  const id = routeId && routeId !== 'new' ? routeId : null;
  const nav = useNavigate();
  const qc = useQueryClient();
  const can = useCan(MENU);
  const { me } = useSession();
  const lk = useLookups('UNIT,WH');
  const defs = useQuery({ queryKey: ['trade-defaults', cls], queryFn: () => api.get<{ types: Array<{ id: string; code: string; name_th: string; warehouse_id: string | null; department_id: string | null }> }>(`/api/v1/trade-defaults/${cls}`) });
  const depts = useQuery({ queryKey: ['departments'], queryFn: () => api.get<Array<{ id: string; code: string; name_th: string; status: string }>>('/api/v1/departments') });
  const cur = useQuery({ enabled: !!id, queryKey: [K.path, 'one', id], staleTime: 0, queryFn: () => api.get<Record<string, string | null> & { editable: boolean; from_count?: boolean; lines: Array<Record<string, string | number | null>> }>(`/api/v1/${K.path}/${id}`) });
  const [h, setH] = useState<Head | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [tab, setTab] = useState('lines');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [askCancel, setAskCancel] = useState(false);
  const [reason, setReason] = useState('');
  if (!h && !id && defs.data) {
    const t = defs.data.types[0];
    setH({ doc_type_id: t?.id ?? '', doc_date: me?.work_date ?? todayIso(), department_id: t?.department_id ?? '', remark: '', your_ref: '', warehouse_id: t?.warehouse_id ?? null, to_warehouse_id: null });
    setLines([blank()]);
  }
  if (!h && id && cur.data) {
    const c = cur.data;
    setH({ doc_type_id: c.doc_type_id!, doc_date: String(c.doc_date).slice(0, 10), department_id: c.department_id ?? '', remark: c.remark ?? '', your_ref: c.your_ref ?? '', warehouse_id: c.warehouse_id ?? null, to_warehouse_id: c.to_warehouse_id ?? null });
    setLines(c.lines.map((l): Line => {
      const eff = Number(l.stock_effect), qty = d(String(l.qty ?? 0)).times(cls === 'JU' ? eff : 1);
      return { key: ++seq, item_id: String(l.item_id), item_code: String(l.item_code ?? ''), description: String(l.description ?? ''), warehouse_id: (l.warehouse_id as string) ?? null, qty: qty.toString(), unit_id: (l.unit_id as string) ?? null, factor: d(String(l.factor ?? 1)).toString(),
        unit_cost: cls === 'JU' && eff > 0 ? d(String(l.cost_unit ?? 0)).toString() : '', amount: cls === 'CA' ? d(String(l.cost_amount ?? 0)).toString() : '', source_line_id: (l.source_line_id as string) ?? null, cost_amount: (l.cost_amount as string) ?? null, cost_unit: (l.cost_unit as string) ?? null };
    }).concat(c.editable && can('edit') ? [blank()] : []));
  }
  const ro = !!id && (!cur.data?.editable || !can('edit'));
  const cancelled = cur.data?.doc_status === 'C';
  const set = (p: Partial<Head>) => { setH((x) => ({ ...x!, ...p })); setDirty(true); };
  const setLine = (key: number, p: Partial<Line>) => { setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p, cost_amount: null, cost_unit: null } : l))); setDirty(true); };
  const pickItem = (key: number, r: ItemHit | null) => {
    if (!r) return setLine(key, { item_id: null, item_code: '', description: '' });
    setLines((ls) => {
      const next = ls.map((l) => (l.key === key ? { ...l, item_id: r.id, item_code: r.code, description: r.name_th, unit_id: r.base_unit_id, factor: '1', cost_amount: null, cost_unit: null } : l));
      return next[next.length - 1]!.item_id ? [...next, blank()] : next;
    });
    setDirty(true);
  };
  const used = lines.filter((l) => l.item_id);
  const total = used.reduce((s, l) => s.plus(d(l.cost_amount ?? 0).abs()), d(0));
  const save = async (andNew = false) => {
    if (!h || busy || ro) return;
    setErr(null); setBusy(true);
    const body = { doc_type_id: h.doc_type_id, doc_date: h.doc_date, department_id: h.department_id || null, remark: h.remark || null, your_ref: h.your_ref || null, warehouse_id: h.warehouse_id, to_warehouse_id: cls === 'RL' ? h.to_warehouse_id : null,
      lines: used.map((l) => ({ item_id: l.item_id, description: l.description || null, warehouse_id: cls === 'RL' ? null : l.warehouse_id, qty: l.qty || '0', unit_id: l.unit_id, factor: l.factor || '1',
        unit_cost: cls === 'JU' && l.unit_cost !== '' ? l.unit_cost : null, amount: cls === 'CA' ? l.amount || '0' : null, source_line_id: cls === 'CA' ? l.source_line_id : null })) };
    try {
      const r = id ? await api.put<{ id: string; doc_no: string }>(`/api/v1/${K.path}/${id}`, body) : await api.post<{ id: string; doc_no: string }>(`/api/v1/${K.path}`, body);
      toast(`บันทึก ${r.doc_no} แล้ว`); setDirty(false);
      await qc.invalidateQueries({ queryKey: [K.path] }); qc.invalidateQueries({ queryKey: ['stock'] }); qc.invalidateQueries({ queryKey: ['doc-journal'] });
      if (andNew) { setH(null); setLines([]); nav(`${K.route}/new`, { replace: true }); }
      // โหลดเอกสารที่บันทึกใหม่ (ต้นทุนที่คำนวณได้)
      else if (!id) { setH(null); setLines([]); nav(`${K.route}/${r.id}`, { replace: true }); }
      else { await qc.refetchQueries({ queryKey: [K.path, 'one', id] }); setH(null); }
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const cancelDoc = async () => {
    try { await api.post(`/api/v1/${K.path}/${id}/cancel`, { reason }); toast('ยกเลิกเอกสารแล้ว'); setAskCancel(false); qc.invalidateQueries({ queryKey: [K.path] }); qc.invalidateQueries({ queryKey: ['stock'] }); nav(K.route); }
    catch (e) { setAskCancel(false); setErr(e); }
  };
  useHotkeys({ F9: () => save(), 'Ctrl+S': () => save(), 'Ctrl+Enter': () => save(true), 'Alt+C': id && can('cancel') && !cancelled && (cur.data?.editable || cur.data?.from_count) ? () => setAskCancel(true) : undefined,
    Escape: () => { if (!dirty || window.confirm('มีการแก้ไขที่ยังไม่บันทึก — ออกโดยไม่บันทึก?')) nav(K.route); } }, []);
  const whRows = lk.data?.WH;
  return (
    <div className="page" data-tone="inventory">
      <div className="doc-title"><p className="eyebrow">สินค้า › {K.label}</p><h1>{id ? cur.data?.doc_no : 'เอกสารใหม่'}</h1>
        <span className="doc-state">{cancelled ? <Pill tone="x">ยกเลิก</Pill> : id ? <Pill tone="n">บันทึกแล้ว</Pill> : <Pill tone="m">ใหม่ — ยังไม่บันทึก</Pill>}{dirty && <Pill tone="c">มีการแก้ไขที่ยังไม่บันทึก</Pill>}{!cancelled && cur.data?.doc_no?.startsWith('MIG-') && <Pill tone="d">ปรับยอดตอนย้ายข้อมูล — แก้ไข/ยกเลิกไม่ได้</Pill>}{!cancelled && cur.data?.from_count && <Pill tone="d">สร้างจากการตรวจนับ — แก้ที่หน้ารายการตรวจนับ</Pill>}</span></div>
      <div className="toolbar">
        <button className="primary" disabled={busy || ro} onClick={() => save()}>บันทึก <kbd>F9</kbd></button>
        <button disabled={busy || ro} onClick={() => save(true)}>บันทึก+ใหม่ <kbd>Ctrl+Enter</kbd></button>
        <button disabled={!id || cancelled || !(cur.data?.editable || cur.data?.from_count) || !can('cancel')} onClick={() => setAskCancel(true)}>ยกเลิกเอกสาร <kbd>Alt+C</kbd></button>
        <DocActions kind="doc" id={id} menu={MENU} />
        <button onClick={() => nav(K.route)}>รายการ <kbd>Esc</kbd></button>
      </div>
      <ErrorBox error={err ?? cur.error ?? defs.error} />
      {defs.data && !defs.data.types.length && <p className="bad">ยังไม่มีประเภทเอกสารของ{K.label} — เพิ่มที่ ตั้งค่า › ประเภทเอกสาร</p>}
      {h && <div onKeyDown={navKey}>
        <div className="head-grid trade-head">
          <div className="col">
            {cls === 'RL' ? <>
              <Field label="จากคลัง" req><LkSelect byId rows={whRows} value={h.warehouse_id} disabled={ro} autoFocus={!id} onChange={(v) => set({ warehouse_id: v || null })} aria-label="จากคลัง" /></Field>
              <Field label="ไปคลัง" req><LkSelect byId rows={whRows} value={h.to_warehouse_id} disabled={ro} onChange={(v) => set({ to_warehouse_id: v || null })} aria-label="ไปคลัง" /></Field>
            </> : <Field label="คลังเริ่มต้น" hint="ใช้กับบรรทัดที่ไม่ได้เลือกคลัง (ว่าง = คลังหลักที่ค่าเริ่มต้นระบบสินค้า)"><LkSelect byId rows={whRows} value={h.warehouse_id} disabled={ro} onChange={(v) => set({ warehouse_id: v || null })} aria-label="คลังเริ่มต้น" /></Field>}
            <Field label="หมายเหตุ"><input value={h.remark} maxLength={200} disabled={ro} onChange={(e) => set({ remark: e.target.value })} /></Field>
          </div>
          <div className="col">
            <Field label="ประเภทเอกสาร"><select value={h.doc_type_id} disabled={!!id} onChange={(e) => set({ doc_type_id: e.target.value })}>{defs.data?.types.map((t) => <option key={t.id} value={t.id}>{t.code} {t.name_th}</option>)}</select></Field>
            <Field label="วันที่" req><DateInput value={h.doc_date} disabled={ro} onChange={(v) => set({ doc_date: v })} /></Field>
            <Field label="แผนก"><select value={h.department_id} disabled={ro} onChange={(e) => set({ department_id: e.target.value })}><option value="">—</option>{depts.data?.filter((x) => x.status === 'A' || x.id === h.department_id).map((x) => <option key={x.id} value={x.id}>{x.code} {x.name_th}</option>)}</select></Field>
            <Field label="เลขที่อ้างอิง"><input value={h.your_ref} maxLength={60} disabled={ro} onChange={(e) => set({ your_ref: e.target.value })} /></Field>
          </div>
        </div>
        <Tabs active={tab} onChange={setTab} tabs={[{ key: 'lines', label: 'รายการสินค้า', badge: used.length || undefined }, ...(id && cls !== 'RL' ? [{ key: 'gl', label: 'ใบสำคัญที่ลงบัญชี' }] : [])]} />
        {tab === 'gl' && id ? <DocJournalTab id={id} /> : <div className="table-wrap">
          <table className="grid lines">
            <thead><tr><th style={{ width: 40 }}>#</th><th style={{ width: 200 }}>รหัสสินค้า</th><th>รายละเอียด</th>{cls !== 'RL' && <th style={{ width: 110 }}>คลัง</th>}
              {cls === 'CA' ? <><th style={{ width: 280 }}>ล็อตรับเข้า (FIFO)</th><th className="r" style={{ width: 150 }}>เพิ่ม(+)/ลด(−) ต้นทุน</th></>
                : <><th className="r" style={{ width: 120 }}>{cls === 'JU' ? 'จำนวน (+/−)' : 'จำนวน'}</th><th style={{ width: 100 }}>หน่วย</th><th className="r" style={{ width: 80 }} title="ตัวคูณเป็นหน่วยย่อย (S-IC-05)">ตัวคูณ</th><th className="r" style={{ width: 120 }}>{cls === 'JU' ? 'ทุน/หน่วย (เพิ่ม)' : 'ทุน/หน่วย'}</th><th className="r" style={{ width: 130 }}>มูลค่าต้นทุน</th></>}
              <th style={{ width: 40 }} /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.key}>
                  <td className="muted">{i + 1}</td>
                  <td><SearchPick endpoint="/api/v1/item-search" params={{ module: 'AP', types: '0' }} value={l.item_id ? { id: l.item_id, code: l.item_code } : null} disabled={ro} label={(r: ItemHit) => r.name_th} onPick={(r: ItemHit | null) => pickItem(l.key, r)} aria-label={`รหัสสินค้า ${i + 1}`} /></td>
                  <td><input value={l.description} maxLength={200} disabled={ro} onChange={(e) => setLine(l.key, { description: e.target.value })} aria-label="รายละเอียด" /></td>
                  {cls !== 'RL' && <td><LkSelect byId rows={whRows} value={l.warehouse_id} disabled={ro} onChange={(v) => setLine(l.key, { warehouse_id: v || null })} aria-label="คลัง" /></td>}
                  {cls === 'CA' ? <>
                    <td>{l.item_id && <LotSelect itemId={l.item_id} warehouseId={l.warehouse_id ?? h.warehouse_id} value={l.source_line_id} disabled={ro} onChange={(v) => setLine(l.key, { source_line_id: v })} />}</td>
                    <td><MoneyInput value={l.amount} disabled={ro} onChange={(v) => setLine(l.key, { amount: v })} aria-label="จำนวนเงิน" /></td>
                  </> : <>
                    <td><input className="r" inputMode="decimal" value={l.qty} disabled={ro} onChange={(e) => setLine(l.key, { qty: e.target.value.replace(cls === 'JU' ? /[^\d.-]/g : /[^\d.]/g, '') })} aria-label="จำนวน" /></td>
                    <td><LkSelect byId rows={lk.data?.UNIT} value={l.unit_id} disabled={ro} onChange={(v) => setLine(l.key, { unit_id: v || null })} aria-label="หน่วย" /></td>
                    <td><input className="r" inputMode="decimal" value={l.factor} disabled={ro} onChange={(e) => setLine(l.key, { factor: e.target.value.replace(/[^\d.]/g, '') })} aria-label="ตัวคูณ" /></td>
                    {cls === 'JU' && d(l.qty || 0).gt(0) ? <td><input className="r" inputMode="decimal" value={l.unit_cost} disabled={ro} placeholder="เฉลี่ย" onChange={(e) => setLine(l.key, { unit_cost: e.target.value.replace(/[^\d.]/g, '') })} aria-label="ทุนต่อหน่วย" /></td>
                      : <td className="r muted">{l.cost_unit !== null ? fmt(l.cost_unit, { places: 4 }) : ''}</td>}
                    <td className="r muted">{l.cost_amount !== null ? <Money v={l.cost_amount} /> : l.item_id ? <span className="small">คำนวณเมื่อบันทึก</span> : ''}</td>
                  </>}
                  <td>{!ro && l.item_id && <button className="icon" title="ลบบรรทัด" onClick={() => { setLines((ls) => ls.filter((x) => x.key !== l.key)); setDirty(true); }}>✕</button>}</td>
                </tr>
              ))}
            </tbody>
            {cls !== 'CA' && id && <tfoot><tr><td colSpan={cls === 'RL' ? 7 : 8} className="r">รวมมูลค่าต้นทุน</td><td className="r"><b><Money v={total.toFixed(2)} /></b></td><td /></tr></tfoot>}
          </table>
        </div>}
      </div>}
      <KeyHints keys={[['Enter', 'ช่องถัดไป'], ['F4', 'ค้นหาสินค้า'], ['F9', 'บันทึก'], ['Ctrl+Enter', 'บันทึก+ใหม่'], ['Alt+C', 'ยกเลิก'], ['Esc', 'กลับรายการ']]} />
      {askCancel && <Confirm danger title="ยกเลิกเอกสาร" text={<>ยกเลิก <b>{cur.data?.doc_no}</b>? สต๊อกและใบสำคัญจะกลับคืน (เปลี่ยนสถานะ ไม่ลบ)</>} okText="ยกเลิกเอกสาร" onClose={() => setAskCancel(false)} onOk={cancelDoc}>
        <Field label="เหตุผลที่ยกเลิก" req><input autoFocus value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></Field>
      </Confirm>}
    </div>
  );
}
