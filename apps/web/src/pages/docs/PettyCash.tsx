import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { d, fmt, settlementTotals, todayIso } from '@buddy/core';
import { api } from '../../api';
import { useCan, useSession } from '../../session';
import { AccountCell, useAccounts } from '../../components/AccountCell';
import { Confirm, cx, DateInput, DateText, ErrorBox, Field, KeyHints, Money, MoneyInput, navKey, PageHead, Pill, Tabs, toast, useHotkeys } from '../../ui';
import { LineNoteButton, LineNotePreview, useLineNoteHotkey } from '../../components/Notes';
import { useDocEdit } from '../../components/DocEdit';
import { DocLink } from '../../components/DocLink';
import { useDocNo } from '../../components/DocNo';
import { DocActions } from '../../components/DocPrint';
import { CancelStamp } from '../../components/DocDelete';
import { DocWhtTab, JvVatTab } from '../gl/JvLinks';
import { DocJournalTab } from './TradeDocs';
import { nextKey, PaymentsTable, paysBody, paysFrom, type Pay } from './MoneyParts';
import { DocTypeTabs, initialType, NO_TYPE_MSG, TypeNotice, useTypeTabs } from '../../components/DocTypeTabs';
import { bookStyle, typeColorIn } from '../../bookColor';

/**
 * เงินสดย่อย (คู่มือบทที่ 15 S-GL-11/12/13): DP บันทึกการจ่าย (ยังไม่ลงบัญชี) → VR เบิกชดเชย (รวม DP แล้วลงบัญชี)
 * ตั้งวงเงิน = DP ที่บรรทัดเป็นบัญชีเงินสดย่อย แล้วเบิกด้วย VR
 */
const BASE = '/fi/petty-cash';
const KINDS = { dp: { api: 'petty-payments', label: 'บันทึกการจ่ายเงินสดย่อย', short: 'จ่าย (DP)', cls: 'DP' }, vr: { api: 'petty-reimbursements', label: 'เบิกชดเชยเงินสดย่อย', short: 'เบิกชดเชย (VR)', cls: 'VR' } } as const;
type Kind = keyof typeof KINDS;

const WAIT_VR = 'รอเบิกชดเชย (ยังไม่ลงบัญชี)';
interface Row { id: string; doc_no: string; doc_date: string; remark: string | null; net_amount: string; doc_status: string; vr_no?: string | null; vr_id?: string | null; lines?: number; dps?: number; cash_amount?: string; cheque_amount?: string }
export function PettyListPage({ kind }: { kind: Kind }) {
  const K = KINDS[kind];
  const nav = useNavigate();
  const can = useCan('GL.PC');
  const { me } = useSession();
  const today = me?.work_date ?? todayIso();
  const [q, setQ] = useState('');
  const [from, setFrom] = useState(today.slice(0, 5) + '01-01');
  const [to, setTo] = useState(today);
  const [open, setOpen] = useState(false);
  const tt = useTypeTabs(K.cls);
  const list = useQuery({ queryKey: [K.api, q, from, to, open, tt.tab], queryFn: () => api.get<{ rows: Row[] }>(`/api/v1/${K.api}`, { type_id: tt.tab || undefined, q, from, to, ...(open ? { open: 'true' } : {}) }), placeholderData: (p) => p });
  useHotkeys({ Insert: can('add') ? () => nav(tt.newUrl(`${BASE}/${kind}/new`)) : undefined }, [tt.tab, ]);
  const total = list.data?.rows.filter((r) => r.doc_status !== 'C').reduce((s, r) => s.plus(d(r.net_amount)), d(0));
  return (
    <div className="page" data-tone="gl">
      <PageHead eyebrow="การเงิน › เงินสดย่อย" title={K.label}
        lead={kind === 'dp' ? 'บันทึกค่าใช้จ่ายที่จ่ายจากเงินสดย่อย (ยังไม่ลงบัญชี) · ตั้งวงเงิน = บรรทัดเป็นบัญชีเงินสดย่อย · ลงบัญชีเมื่อเบิกชดเชย' : 'รวมใบจ่ายที่ยังไม่เบิก แล้วจ่ายชดเชยด้วยเงินสด/เช็ค/โอน — ลงบัญชีทันที (Dr ค่าใช้จ่าย / Cr เงินสด-ธนาคาร)'}
        actions={can('add') && <button className={cx('primary', tt.color && 'book-btn')} style={bookStyle(tt.color)} onClick={() => nav(tt.newUrl(`${BASE}/${kind}/new`))}>+ {K.label} {tt.cur ? `${tt.cur.code} ` : ''}<kbd>Ins</kbd></button>} />
      <div className="seg kind-switch">{(Object.keys(KINDS) as Kind[]).map((k) => <button key={k} className={cx(k === kind && 'on')} onClick={() => nav(k === 'dp' ? BASE : `${BASE}/vr`)}>{KINDS[k].short}</button>)}</div>
      {tt.tabs()}
      <div className="toolbar">
        <input type="search" autoFocus placeholder="ค้นหาเลขที่ หรือคำอธิบาย" value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหาเอกสาร" />
        <label>ตั้งแต่ <DateInput value={from} onChange={setFrom} /></label>
        <label>ถึง <DateInput value={to} onChange={setTo} /></label>
        {kind === 'dp' && <label className="check"><input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} /> เฉพาะที่ยังไม่เบิกชดเชย</label>}
      </div>
      <ErrorBox error={list.error} />
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th style={{ width: 130 }}>เลขที่</th><th style={{ width: 110 }}>วันที่</th><th>คำอธิบาย</th>{kind === 'dp' ? <><th className="r" style={{ width: 70 }}>รายการ</th><th style={{ width: 130 }}>เบิกชดเชยใน</th></> : <><th className="r" style={{ width: 70 }}>ใบจ่าย</th><th className="r" style={{ width: 120 }}>เงินสด</th><th className="r" style={{ width: 130 }}>เช็ค/โอน</th></>}<th className="r" style={{ width: 140 }}>จำนวนเงิน</th><th style={{ width: 80 }}>สถานะ</th></tr></thead>
          <tbody>
            {list.data?.rows.map((r) => (
              <tr key={r.id} className={cx('row-open', r.doc_status === 'C' && 'cancelled')} tabIndex={0} onClick={() => nav(`${BASE}/${kind}/${r.id}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`${BASE}/${kind}/${r.id}`)}>
                <td className="mono">{r.doc_no}</td><td><DateText v={r.doc_date} /></td><td>{r.remark}</td>
                {kind === 'dp' ? <><td className="r">{r.lines}</td><td><DocLink id={r.vr_id} no={r.vr_no} cls="VR" /></td></> : <><td className="r">{r.dps}</td><td className="r"><Money v={r.cash_amount} blankZero /></td><td className="r"><Money v={r.cheque_amount} blankZero /></td></>}
                <td className="r"><Money v={r.net_amount} /></td><td>{r.doc_status === 'C' ? <Pill tone="x">ยกเลิก</Pill> : kind === 'dp' && !r.vr_no ? <Pill tone="m">รอเบิก</Pill> : <Pill tone="n">ปกติ</Pill>}</td>
              </tr>
            ))}
            {list.data && !list.data.rows.length && <tr><td colSpan={7} className="empty">ไม่มีเอกสารในช่วงนี้ — กด Ins เพื่อเพิ่ม</td></tr>}
          </tbody>
          {!!list.data?.rows.length && <tfoot><tr><td colSpan={kind === 'dp' ? 5 : 6} className="r">รวม (ไม่รวมที่ยกเลิก)</td><td className="r"><b><Money v={total?.toFixed(2)} /></b></td><td /></tr></tfoot>}
        </table>
      </div>
      <KeyHints keys={[['Ins', `เพิ่ม${K.label}`], ['คลิก/Enter', 'เปิดเอกสาร']]} />
    </div>
  );
}

interface Line { key: number; account_id: string | null; department_id: string; description: string; amount: string; line_note?: string; line_note_print?: boolean }
export function PettyFormPage({ kind }: { kind: Kind }) {
  const K = KINDS[kind];
  const { id: routeId } = useParams();
  const id = routeId && routeId !== 'new' ? routeId : null;
  const nav = useNavigate();
  const qc = useQueryClient();
  const can = useCan('GL.PC');
  const { me } = useSession();
  const accts = useAccounts();
  const defs = useQuery({ queryKey: ['trade-defaults', K.cls], queryFn: () => api.get<{ types: Array<{ id: string; code: string; name_th: string }> }>(`/api/v1/trade-defaults/${K.cls}`) });
  const depts = useQuery({ queryKey: ['departments'], queryFn: () => api.get<Array<{ id: string; code: string; name_th: string; status: string }>>('/api/v1/departments') });
  const cur = useQuery({ enabled: !!id, queryKey: [K.api, 'one', id], queryFn: () => api.get<Record<string, string | null> & { doc_no: string; doc_status: string; editable: boolean; vr_no?: string | null; vr_id?: string | null;
    lines: Array<{ account_id: string; account_no: string; account_name: string; department_id: string | null; description: string | null; amount: string; line_note?: string | null; line_note_print?: boolean }>; dps?: Array<{ id: string }>; payments?: Parameters<typeof paysFrom>[0] }>(`/api/v1/${K.api}/${id}`), staleTime: 0 });
  const [h, setH] = useState<{ doc_type_id: string; doc_date: string; remark: string; cash: string } | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [pays, setPays] = useState<Pay[]>([]);
  const [tab, setTab] = useState('lines');
  useLineNoteHotkey();
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [askCancel, setAskCancel] = useState(false);
  const [reason, setReason] = useState('');
  const date0 = me?.work_date ?? todayIso();
  const openDps = useQuery({ enabled: kind === 'vr', queryKey: ['petty-payments', 'open', id], queryFn: () => api.get<{ rows: Row[] }>('/api/v1/petty-payments', { open: 'true', limit: 1000, ...(id ? { vr_id: id } : {}) }), staleTime: 0 });
  const blank = (): Line => ({ key: nextKey(), account_id: null, department_id: '', description: '', amount: '' });
  if (!h && !id && defs.data) { setH({ doc_type_id: initialType(defs.data.types)?.id ?? '', doc_date: date0, remark: '', cash: '' }); if (kind === 'dp') setLines([blank()]); }
  if (!h && id && cur.data) {
    const c = cur.data;
    setH({ doc_type_id: c.doc_type_id!, doc_date: String(c.doc_date).slice(0, 10), remark: c.remark ?? '', cash: kind === 'vr' ? d(c.cash_amount ?? 0).toString() : '' });
    setLines(c.lines.map((l) => ({ key: nextKey(), account_id: l.account_id, department_id: l.department_id ?? '', description: l.description ?? '', line_note: String(l.line_note ?? ''), line_note_print: !!l.line_note_print, amount: d(l.amount).toString() })));
    if (kind === 'vr') { setPick(new Set((c.dps ?? []).map((x) => x.id))); setPays(paysFrom(c.payments ?? [])); }
  }
  const roBase = !!id && (!cur.data?.editable || !can('edit'));
  const ed = useDocEdit({ id: id ?? undefined, allowed: !!id && !roBase, dirty, onSave: () => void save(), onDiscard: () => { setH(null); setDirty(false); }, noNew: true });
  const ro = roBase || ed.locked;
  const set = (p: Partial<NonNullable<typeof h>>) => { setH((x) => ({ ...x!, ...p })); setDirty(true); };
  const setLine = (k: number, p: Partial<Line>) => { setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...p } : l))); setDirty(true); };
  const dpRows = openDps.data?.rows ?? [];
  const chosen = dpRows.filter((r) => pick.has(r.id));
  const vrTotal = chosen.reduce((s, r) => s.plus(d(r.net_amount)), d(0));
  const dpTotal = lines.reduce((s, l) => s.plus(d(l.amount || 0)), d(0));
  const t = settlementTotals({ settlements: [vrTotal.toFixed(2)], payments: pays.filter((p) => p.payment_method_id).map((p) => p.amount || 0), cash: h?.cash ? h.cash : null });
  /** เลือกประเภทจากแถบ (ใบใหม่) — ค่าเริ่มต้นตามประเภทนั้น */
  const pickType = (v: string) => { const t = defs.data?.types.find((x) => x.id === v); set({ doc_type_id: v }); };
  const tColor = typeColorIn(defs.data?.types, h?.doc_type_id);
  const tCur = defs.data?.types.find((x) => x.id === h?.doc_type_id);
  const dn = useDocNo(tCur, id ? cur.data?.doc_no : undefined, { disabled: ro, resetKey: h ? 'on' : 'off' });
  const save = async () => {
    if (h && !h.doc_type_id) { setErr(new Error(NO_TYPE_MSG)); return; }
    if (!h || busy || ro || !can(id ? 'edit' : 'add')) return;
    setErr(null); setBusy(true);
    const body = kind === 'dp'
      ? { doc_type_id: h.doc_type_id, doc_no: dn.value, doc_date: h.doc_date, remark: h.remark || null, lines: lines.filter((l) => l.account_id || l.amount).map((l) => ({ account_id: l.account_id, department_id: l.department_id || null, description: l.description || null, amount: l.amount || '0', line_note: l.line_note || null, line_note_print: !!l.line_note_print })) }
      : { doc_type_id: h.doc_type_id, doc_no: dn.value, doc_date: h.doc_date, remark: h.remark || null, dp_ids: chosen.map((r) => r.id), cash_amount: h.cash === '' ? null : h.cash, payments: paysBody(pays) };
    try {
      const r = id ? await api.put<{ id: string; doc_no: string; journal_id?: string | null }>(`/api/v1/${K.api}/${id}`, body) : await api.post<{ id: string; doc_no: string; journal_id?: string | null }>(`/api/v1/${K.api}`, body);
      toast(r.journal_id ? `บันทึก ${r.doc_no} แล้ว — ลงบัญชีแล้ว` : `บันทึก ${r.doc_no} แล้ว (ไม่ลงบัญชี)`); setDirty(false); if (id) ed.lock();
      qc.invalidateQueries({ queryKey: [K.api] }); qc.invalidateQueries({ queryKey: ['petty-payments'] }); qc.invalidateQueries({ queryKey: ['doc-journal', r.id] });
      if (!id) { nav(`${BASE}/${kind}/${r.id}`, { replace: true }); setH(null); } else { await qc.refetchQueries({ queryKey: [K.api, 'one', id] }); setH(null); }
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const cancelDoc = async () => {
    try { await api.post(`/api/v1/${K.api}/${id}/cancel`, { reason }); toast('ยกเลิกเอกสารแล้ว'); setAskCancel(false); qc.invalidateQueries({ queryKey: [K.api] }); nav(kind === 'dp' ? BASE : `${BASE}/vr`); }
    catch (e) { setAskCancel(false); setErr(e); }
  };
  useHotkeys({ F9: save, 'Ctrl+S': save, 'Ctrl+Insert': ro || kind === 'vr' ? undefined : () => setLines((ls) => [...ls, blank()]),
    'Alt+C': id && can('cancel') && cur.data?.doc_status !== 'C' ? () => setAskCancel(true) : undefined,
    Escape: () => { if (!dirty || window.confirm('มีการแก้ไขที่ยังไม่บันทึก — ออกโดยไม่บันทึก?')) nav(kind === 'dp' ? BASE : `${BASE}/vr`); } }, []);
  const cancelled = cur.data?.doc_status === 'C';
  const dtCode = defs.data?.types.find((x) => x.id === h?.doc_type_id);
  const acctName = (aid: string | null) => accts.data?.find((a) => a.id === aid)?.name_th ?? '';
  return (
    <div className={cx('page', tColor && 'book-colored', cancelled && 'doc-cancelled')} data-tone="gl" style={bookStyle(tColor)}>
      <div className="doc-title"><p className="eyebrow">การเงิน › เงินสดย่อย › {K.label}</p><h1>{id ? cur.data?.doc_no : dn.value ?? (dtCode ? `${dtCode.code}**NEW**` : '')}</h1><CancelStamp show={cancelled} reason={(cur.data as { cancel_reason?: string | null } | undefined)?.cancel_reason} />{tCur && <span className="book-pill" title="ประเภทเอกสาร">{!id ? 'กำลังบันทึก: ' : ''}{tCur.code} {tCur.name_th}</span>}
        <span className="doc-state">{cancelled ? <Pill tone="x">ยกเลิก</Pill> : id ? <Pill tone="n">{kind === 'vr' ? 'ลงบัญชีแล้ว' : cur.data?.vr_no ? <>เบิกชดเชยแล้วใน <DocLink id={cur.data.vr_id} no={cur.data.vr_no} cls="VR" /></> : WAIT_VR}</Pill> : <Pill tone="m">ใหม่ — ยังไม่บันทึก</Pill>}{dirty && <Pill tone="c">มีการแก้ไขที่ยังไม่บันทึก</Pill>}{ed.locked && !roBase && <Pill tone="n">ดูอย่างเดียว — กด แก้ไข (Alt+E)</Pill>}</span></div>
      <div className="toolbar">
        <button onClick={() => { if (!dirty || window.confirm('ทิ้งการแก้ไข?')) { setH(null); setLines([]); setPick(new Set()); setPays([]); nav(`${BASE}/${kind}/new`); } }}>+ ใหม่</button>
        <button className="primary" disabled={busy || ro} onClick={save}>บันทึก <kbd>F9</kbd></button>
        {ed.editButton}
        <button disabled={!id || cancelled || !can('cancel')} onClick={() => setAskCancel(true)}>ยกเลิกเอกสาร</button>
        <DocActions kind="doc" id={id} dirty={dirty} menu={'GL.PC'} del={{ cancelled, cancelUrl: `/api/v1/${K.api}/${id}/cancel`, listPath: kind === 'dp' ? BASE : `${BASE}/vr` }} />
        <button onClick={() => nav(kind === 'dp' ? BASE : `${BASE}/vr`)}>รายการ <kbd>Esc</kbd></button>
      </div>
      <DocTypeTabs types={defs.data?.types} value={h?.doc_type_id ?? ''} locked={!!id} onChange={pickType} />
      <TypeNotice show={!id && !!h && !h.doc_type_id} />
      {ed.dialog}
      <ErrorBox error={err ?? cur.error ?? openDps.error} />
      {h && <div onKeyDown={(e) => navKey(e, ed.end)}>
        <div className="head-grid trade-head">
          <div className="col"><Field label="คำอธิบาย/หมายเหตุ" wide><input value={h.remark} maxLength={200} disabled={ro} autoFocus={!id} onChange={(e) => set({ remark: e.target.value })} placeholder={kind === 'vr' ? 'เช่น เบิกชดเชยเงินสดย่อย 1–15/11' : 'เช่น ค่าเดินทางพนักงานขาย'} /></Field></div>
          <div className="col">
            
            {dn.field}
            
            <Field label="วันที่" req><DateInput value={h.doc_date} disabled={ro} onChange={(v) => set({ doc_date: v })} /></Field>
          </div>
        </div>
        {kind === 'dp' ? <>
          <Tabs active={tab} onChange={setTab} tabs={[{ key: 'lines', label: 'รายการที่จ่าย', badge: lines.filter((l) => l.account_id).length || undefined },
            ...(id ? [{ key: 'vat', label: 'รายการภาษีซื้อ' }, { key: 'wht', label: 'รายการภาษีหัก ณ ที่จ่าย' }, { key: 'gl', label: 'ใบสำคัญที่ลงบัญชี' }] : [])]} />
          {tab === 'gl' && id && <DocJournalTab id={id} />}
          {tab === 'vat' && id && <JvVatTab doc kind="P" journal={{ id, voucher_no: cur.data?.doc_no ?? '', date: h.doc_date }} lineVat="0" editable={!ro && cur.data?.doc_status !== 'C'} />}
          {tab === 'wht' && id && <DocWhtTab doc={{ id, doc_no: cur.data?.doc_no ?? '', date: h.doc_date }} editable={!ro && cur.data?.doc_status !== 'C'} />}
          {tab === 'lines' && <div className="table-wrap lines">
            <table className="grid">
              <thead><tr><th style={{ width: 36 }}>#</th><th style={{ width: 170 }}>เลขที่บัญชี</th><th style={{ width: 220 }}>ชื่อบัญชี</th><th style={{ width: 150 }}>แผนก</th><th>รายละเอียด</th><th className="r" style={{ width: 150 }}>จำนวนเงิน</th><th style={{ width: 36 }} /></tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.key}>
                    <td className="muted">{i + 1}</td>
                    <td><AccountCell value={l.account_id} disabled={ro} required={!!l.amount || !lines.some((x) => x.account_id && x.key !== l.key)} onChange={(a) => setLine(l.key, { account_id: a?.id ?? null })} aria-label={`เลขที่บัญชี ${i + 1}`} /></td>
                    <td className="small">{acctName(l.account_id)}</td>
                    <td><select value={l.department_id} disabled={ro} onChange={(e) => setLine(l.key, { department_id: e.target.value })} aria-label="แผนก"><option value="">—</option>{depts.data?.filter((x) => x.status === 'A' || x.id === l.department_id).map((x) => <option key={x.id} value={x.id}>{x.code} {x.name_th}</option>)}</select></td>
                    <td><div className="desc-cell"><input value={l.description} maxLength={200} disabled={ro} onChange={(e) => setLine(l.key, { description: e.target.value })} aria-label="รายละเอียด" /><LineNoteButton note={l.line_note} print={l.line_note_print} disabled={ro} label={l.description} onChange={(v) => setLine(l.key, v)} /></div><LineNotePreview note={l.line_note} print={l.line_note_print} /></td>
                    <td><MoneyInput value={l.amount} disabled={ro} onChange={(v) => setLine(l.key, { amount: v })} aria-label="จำนวนเงิน" /></td>
                    <td>{!ro && <button type="button" className="icon-btn" tabIndex={-1} title="ลบบรรทัด" onClick={() => { setLines((ls) => ls.filter((x) => x.key !== l.key)); setDirty(true); }}>✕</button>}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={5}>{!ro && <button type="button" onClick={() => setLines((ls) => [...ls, blank()])}>+ เพิ่มบรรทัด <kbd>Ctrl+Ins</kbd></button>} <span className="hint">ตั้งวงเงิน: ใช้บัญชีเงินสดย่อย · จ่ายค่าใช้จ่าย: ใช้บัญชีค่าใช้จ่าย · บันทึกแล้วลงบัญชีทันที Dr บัญชีตามรายการ / Cr เงินสดย่อย</span></td><td className="r"><b><Money v={dpTotal.toFixed(2)} /></b></td><td /></tr></tfoot>
            </table>
          </div>}
        </> : <>
          <Tabs active={tab} onChange={setTab} tabs={[{ key: 'lines', label: 'ใบจ่ายที่เบิกชดเชย', badge: chosen.length || undefined }, { key: 'pay', label: 'เบิกชดเชยโดย (เช็ค/โอน)', badge: pays.length || undefined }, ...(id ? [{ key: 'gl', label: 'ใบสำคัญที่ลงบัญชี' }] : [])]} />
          {tab === 'lines' && <div className="table-wrap lines">
            <table className="grid">
              <thead><tr><th style={{ width: 36 }}><input type="checkbox" checked={dpRows.length > 0 && chosen.length === dpRows.length} disabled={ro || !dpRows.length} onChange={(e) => { setPick(new Set(e.target.checked ? dpRows.map((r) => r.id) : [])); setDirty(true); }} aria-label="เลือกทั้งหมด" /></th>
                <th style={{ width: 130 }}>ใบจ่าย</th><th style={{ width: 110 }}>วันที่</th><th>คำอธิบาย</th><th className="r" style={{ width: 70 }}>รายการ</th><th className="r" style={{ width: 140 }}>จำนวนเงิน</th></tr></thead>
              <tbody>
                {dpRows.map((r) => {
                  const on = pick.has(r.id);
                  return (
                    <tr key={r.id} className={cx('row-open', on && 'picked')} onClick={(e) => { if (ro || (e.target as HTMLElement).matches('input')) return; setPick((s0) => { const s = new Set(s0); if (on) s.delete(r.id); else s.add(r.id); return s; }); setDirty(true); }}>
                      <td className="c"><input type="checkbox" checked={on} disabled={ro} onChange={(e) => { setPick((s0) => { const s = new Set(s0); if (e.target.checked) s.add(r.id); else s.delete(r.id); return s; }); setDirty(true); }} aria-label={`เลือก ${r.doc_no}`} /></td>
                      <td><DocLink id={r.id} no={r.doc_no} cls="DP" keep={dirty} /></td><td><DateText v={r.doc_date} /></td><td>{r.remark}</td><td className="r">{r.lines}</td><td className="r"><Money v={r.net_amount} /></td>
                    </tr>
                  );
                })}
                {openDps.data && !dpRows.length && <tr><td colSpan={6} className="empty">ไม่มีใบจ่ายเงินสดย่อยที่รอเบิกชดเชย</td></tr>}
              </tbody>
              {chosen.length > 0 && <tfoot><tr><td colSpan={5} className="r">ยอดเงินที่เบิกชดเชย ({chosen.length} ใบ)</td><td className="r"><b><Money v={vrTotal.toFixed(2)} /></b></td></tr></tfoot>}
            </table>
            {id && !!cur.data?.lines.length && <><p className="hint">สรุปค่าใช้จ่ายของใบจ่ายที่เบิก (รวมตามบัญชี/แผนก — ลงบัญชีแล้วตอนบันทึกใบจ่าย) · ใบเบิกนี้ลงบัญชี Dr เงินสดย่อย / Cr เงินสด-ธนาคาร</p><table className="grid"><thead><tr><th>เลขที่บัญชี</th><th>ชื่อบัญชี</th><th>รายละเอียด</th><th className="r">จำนวนเงิน</th></tr></thead>
              <tbody>{cur.data.lines.map((l, i) => <tr key={i}><td className="mono">{l.account_no}</td><td>{l.account_name}</td><td>{l.description}</td><td className="r"><Money v={l.amount} /></td></tr>)}</tbody></table></>}
          </div>}
          {tab === 'pay' && <PaymentsTable pays={pays} setPays={setPays} direction="P" readOnly={ro} payDate={h.doc_date} rest={!h.cash ? t.cash : ''} onDirty={() => setDirty(true)} />}
          {tab === 'gl' && id && <DocJournalTab id={id} />}
          <div className="trade-foot"><span />
            <table className="totals-table"><tbody>
              <tr className="grand"><td>ยอดเงินที่เบิกชดเชย</td><td className="r"><Money v={vrTotal.toFixed(2)} /></td></tr>
              <tr><td>เช็ค/โอน</td><td className="r"><Money v={t.other} /></td></tr>
              <tr><td>จ่ายเป็นเงินสด</td><td><MoneyInput value={h.cash} disabled={ro} placeholder={fmt(t.cash)} onChange={(v) => set({ cash: v })} aria-label="เงินสด" /></td></tr>
              {!t.ok && chosen.length > 0 && <tr><td colSpan={2} className="bad small">ยอดเบิกชดเชยไม่เท่ากับยอดจ่ายจริง ต่าง {fmt(t.diff)} — ล้างช่องเงินสดให้คำนวณเอง</td></tr>}
            </tbody></table>
          </div>
        </>}
      </div>}
      <KeyHints keys={[['Enter', 'ช่องถัดไป (ช่องสุดท้าย = ถามบันทึก)'], ['Alt+E', 'แก้ไขเอกสารที่บันทึกแล้ว'], ['F4', 'ค้นหาบัญชี'], ['F9', 'บันทึก'], ['Alt+C', 'ยกเลิกเอกสาร'], ['Esc', 'กลับรายการ']]} />
      {askCancel && <Confirm danger title="ยกเลิกเอกสาร" text={<>ยกเลิก <b>{cur.data?.doc_no}</b>? (เปลี่ยนสถานะ ไม่ลบ){kind === 'vr' ? ' ใบจ่ายที่เบิกจะกลับมาเบิกใหม่ได้ · เช็คออกจากทะเบียน' : ''}</>} okText="ยกเลิกเอกสาร" onClose={() => setAskCancel(false)} onOk={cancelDoc}>
        <Field label="เหตุผลที่ยกเลิก" req><input autoFocus value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></Field>
      </Confirm>}
    </div>
  );
}
