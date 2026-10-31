import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BILL_KINDS, d, todayIso, type BillKind } from '@buddy/core';
import { api } from '../../api';
import { useCan, useSession } from '../../session';
import { SearchPick } from '../../components/LkSelect';
import { openDescribe, type OpenParty } from './SettleDocs';
import { Confirm, cx, DateInput, DateText, ErrorBox, Field, KeyHints, Money, navKey, PageHead, Pill, Tabs, toast, useHotkeys } from '../../ui';
import { useDocEdit } from '../../components/DocEdit';
import { DocLink } from '../../components/DocLink';
import { useDocNo } from '../../components/DocNo';
import { DocActions } from '../../components/DocPrint';
import { CancelStamp } from '../../components/DocDelete';
import { DocTypeTabs, initialType, NO_TYPE_MSG, TypeNotice, useTypeTabs } from '../../components/DocTypeTabs';
import { bookStyle, typeColorIn } from '../../bookColor';

const kindOf = (path: string) => BILL_KINDS.find((k) => k.path === path)!;
const partyEndpoint = (K: BillKind) => (K.party === 'customer' ? '/api/v1/customers' : '/api/v1/suppliers');
const partyWord = (K: BillKind) => (K.party === 'customer' ? 'ลูกค้า' : 'ผู้จำหน่าย');
const rp = (K: BillKind) => (K.module === 'AR' ? 'รับ' : 'จ่าย');
const CLASS_TH: Record<string, string> = { IV: 'บิลขาย', DR: 'เพิ่มหนี้', CN: 'ลดหนี้', RR: 'บิลซื้อ', CP: 'เพิ่มหนี้', DN: 'ลดหนี้' };

interface ListRow { id: string; doc_no: string; doc_date: string; visit_date: string | null; appointment_date: string | null; party_name: string; party_code: string | null; net_amount: string; doc_status: string; bills: number }
/** รายการใบวางบิล/ใบรับวางบิล · appointments = หน้าบันทึกวันนัดรับชำระ (S-BI-02) เรียงตามวันนัด แก้วันนัดได้ในแถว */
export function BillListPage({ path, appointments }: { path: string; appointments?: boolean }) {
  const K = kindOf(path);
  const nav = useNavigate();
  const qc = useQueryClient();
  const can = useCan(K.menu);
  const canAppoint = useCan(K.module === 'AR' ? 'FI.AR.BD' : K.menu)('edit');
  const { me } = useSession();
  const today = me?.work_date ?? todayIso();
  const [q, setQ] = useState('');
  const [from, setFrom] = useState(appointments ? today.slice(0, 5) + '01-01' : today.slice(0, 8) + '01');
  const [to, setTo] = useState(today);
  const [err, setErr] = useState<unknown>(null);
  const tt = useTypeTabs(K.cls);
  const list = useQuery({ queryKey: [K.path, q, from, to, appointments, tt.tab], queryFn: () => api.get<{ total: number; rows: ListRow[] }>(`/api/v1/${K.path}`, { type_id: tt.tab || undefined, q, from, to, status: appointments ? 'N' : 'all', order: appointments ? 'appointment' : 'date', limit: 500 }), placeholderData: (p) => p });
  useHotkeys({ Insert: can('add') && !appointments ? () => nav(tt.newUrl(`${K.route}/new`)) : undefined }, [tt.tab, ]);
  const appoint = async (r: ListRow, date: string) => {
    setErr(null);
    try { await api.post(`/api/v1/${K.path}/${r.id}/appointment`, { date: date || null }); toast(`บันทึกวันนัด${rp(K)}เงินของ ${r.doc_no} แล้ว`); qc.invalidateQueries({ queryKey: [K.path] }); } catch (e) { setErr(e); }
  };
  const total = list.data?.rows.filter((r) => r.doc_status !== 'C').reduce((s, r) => s.plus(d(r.net_amount)), d(0));
  return (
    <div className="page" data-tone="finance">
      <PageHead eyebrow={`การเงิน › ${K.module === 'AR' ? 'ลูกหนี้' : 'เจ้าหนี้'}`} title={appointments ? `บันทึกวันนัด${rp(K)}ชำระเงิน` : K.label}
        lead={appointments ? `ใบวางบิลเรียงตามวันนัด${rp(K)}เงิน — แก้วันนัดในแถวได้ทันที (ไม่ทราบให้เว้นว่าง)` : `รวมบิลค้างของ${partyWord(K)}เพื่อนัด${rp(K)}เงิน · ไม่ลงบัญชี · บิลหนึ่งใบอยู่ได้ในใบวางบิลเดียว (ยกเลิกแล้ววางใหม่ได้)`}
        actions={can('add') && !appointments && <button className={cx('primary', tt.color && 'book-btn')} style={bookStyle(tt.color)} onClick={() => nav(tt.newUrl(`${K.route}/new`))}>+ {K.label} {tt.cur ? `${tt.cur.code} ` : ''}<kbd>Ins</kbd></button>} />
      {tt.tabs()}
      <div className="toolbar">
        <input type="search" autoFocus placeholder={`ค้นหาเลขที่ หรือ${partyWord(K)}`} value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหาเอกสาร" />
        <label>ตั้งแต่ <DateInput value={from} onChange={setFrom} /></label>
        <label>ถึง <DateInput value={to} onChange={setTo} /></label>
        <span className="muted small">{list.data ? `${list.data.rows.length.toLocaleString()} จาก ${list.data.total.toLocaleString()} ใบ` : ''}</span>
      </div>
      <ErrorBox error={err ?? list.error} />
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th style={{ width: 130 }}>เลขที่</th><th style={{ width: 110 }}>วันที่</th><th style={{ width: 100 }}>รหัส</th><th>{partyWord(K)}</th><th className="r" style={{ width: 60 }}>บิล</th><th className="r" style={{ width: 140 }}>จำนวนเงินรวม</th><th style={{ width: appointments ? 170 : 120 }}>วันนัด{rp(K)}เงิน</th>{!appointments && <th style={{ width: 80 }}>สถานะ</th>}</tr></thead>
          <tbody>
            {list.data?.rows.map((r) => (
              <tr key={r.id} className={cx('row-open', r.doc_status === 'C' && 'cancelled')} tabIndex={0} onClick={(e) => { if (!(e.target as HTMLElement).closest('.date-in')) nav(`${K.route}/${r.id}`); }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLElement).tagName === 'TR' && nav(`${K.route}/${r.id}`)}>
                <td className="mono">{r.doc_no}</td><td><DateText v={r.doc_date} /></td><td className="mono">{r.party_code}</td><td>{r.party_name}</td><td className="r">{r.bills}</td><td className="r"><Money v={r.net_amount} /></td>
                <td>{appointments ? <DateInput value={r.appointment_date ? String(r.appointment_date).slice(0, 10) : ''} disabled={!canAppoint} onChange={(v) => { if (v !== (r.appointment_date ? String(r.appointment_date).slice(0, 10) : '')) appoint(r, v); }} /> : <DateText v={r.appointment_date} />}</td>
                {!appointments && <td>{r.doc_status === 'C' ? <Pill tone="x">ยกเลิก</Pill> : <Pill tone="n">ปกติ</Pill>}</td>}
              </tr>
            ))}
            {list.data && !list.data.rows.length && <tr><td colSpan={8} className="empty">ไม่มีใบวางบิลในช่วงนี้</td></tr>}
          </tbody>
          {!!list.data?.rows.length && <tfoot><tr><td colSpan={5} className="r">รวม (ไม่รวมที่ยกเลิก)</td><td className="r"><b><Money v={total?.toFixed(2)} /></b></td><td colSpan={2} /></tr></tfoot>}
        </table>
      </div>
      <KeyHints keys={appointments ? [['คลิกวันที่', 'แก้วันนัด'], ['คลิกแถว', 'เปิดใบวางบิล']] : [['Ins', `เพิ่ม${K.label}`], ['คลิก/Enter', 'เปิดเอกสาร']]} />
    </div>
  );
}

interface Open { header_id: string; doc_class: string; doc_no: string; doc_date: string; due_date: string | null; ref_no: string | null; amount: string; settled: string; outstanding: string }
interface Head { doc_type_id: string; doc_date: string; visit_date: string; appointment_date: string; party: { id: string; code: string; name?: string | null } | null; payment_terms: string; remark: string }
export function BillFormPage({ path }: { path: string }) {
  const K = kindOf(path);
  const { id: routeId } = useParams();
  const id = routeId && routeId !== 'new' ? routeId : null;
  const nav = useNavigate();
  const qc = useQueryClient();
  const can = useCan(K.menu);
  const { me } = useSession();
  const defs = useQuery({ queryKey: ['trade-defaults', K.cls], queryFn: () => api.get<{ types: Array<{ id: string; code: string; name_th: string }> }>(`/api/v1/trade-defaults/${K.cls}`) });
  const cur = useQuery({ enabled: !!id, queryKey: [K.path, 'one', id], queryFn: () => api.get<Record<string, string | null> & { doc_no: string; doc_status: string; editable: boolean; items: Array<{ invoice_header_id: string }> }>(`/api/v1/${K.path}/${id}`), staleTime: 0 });
  const [h, setH] = useState<Head | null>(null);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [askCancel, setAskCancel] = useState(false);
  const [reason, setReason] = useState('');
  const open = useQuery({ enabled: !!h?.party, queryKey: [K.path, 'open', h?.party?.id, id], queryFn: () => api.get<{ rows: Open[] }>(`/api/v1/${K.path}/open-items`, { party_id: h!.party!.id, ...(id ? { bill_id: id } : {}) }), staleTime: 0 });
  const date0 = me?.work_date ?? todayIso();
  if (!h && !id && defs.data) setH({ doc_type_id: initialType(defs.data.types)?.id ?? '', doc_date: date0, visit_date: date0, appointment_date: '', party: null, payment_terms: '', remark: '' });
  if (!h && id && cur.data) {
    const c = cur.data;
    setH({ doc_type_id: c.doc_type_id!, doc_date: String(c.doc_date).slice(0, 10), visit_date: c.visit_date ? String(c.visit_date).slice(0, 10) : '', appointment_date: c.appointment_date ? String(c.appointment_date).slice(0, 10) : '',
      party: { id: (c.customer_id ?? c.supplier_id)!, code: c.party_code ?? '', name: c.party_name }, payment_terms: c.payment_terms ?? '', remark: c.remark ?? '' });
    setPick(new Set(cur.data.items.map((x) => x.invoice_header_id)));
  }
  const roBase = !!id && (!cur.data?.editable || !can('edit'));
  const ed = useDocEdit({ id: id ?? undefined, allowed: !!id && !roBase, dirty, onSave: () => void save(), onDiscard: () => { setH(null); setDirty(false); }, noNew: true });
  const ro = roBase || ed.locked;
  const set = (p: Partial<Head>) => { setH((x) => ({ ...x!, ...p })); setDirty(true); };
  const rows = open.data?.rows ?? [];
  // เลือกคู่ค้าที่ไม่มีบิลให้วาง → เตือนทันทีและไม่ให้ทำต่อ (ข้อกำหนดเจ้าของ 31/10/2569)
  useEffect(() => {
    if (id || !h?.party || !open.data || open.data.rows.length || open.isFetching) return;
    toast(`${h.party.code} ${h.party.name ?? ''} ไม่มีบิลค้างให้วางบิล — เลือก${partyWord(K)}รายอื่น`, 'warn');
    setH((x) => (x ? { ...x, party: null } : x));
  }, [open.data, open.isFetching, h?.party?.id, id]);
  const chosen = rows.filter((o) => pick.has(o.header_id));
  const total = chosen.reduce((s, o) => s.plus(d(o.outstanding)), d(0));
  const pickParty = async (p: { id: string; code: string; name: string } | null) => {
    setPick(new Set());
    if (!p) return set({ party: null });
    const x = await api.get<Record<string, string | null>>(`${partyEndpoint(K)}/${p.id}`);
    set({ party: p, payment_terms: x.payment_terms ?? '' });
  };
  const toggle = (idv: string, on: boolean) => { setPick((s0) => { const s = new Set(s0); if (on) s.add(idv); else s.delete(idv); return s; }); setDirty(true); };
  /** เลือกประเภทจากแถบ (ใบใหม่) — ค่าเริ่มต้นตามประเภทนั้น */
  const pickType = (v: string) => { const t = defs.data?.types.find((x) => x.id === v); set({ doc_type_id: v }); };
  const tColor = typeColorIn(defs.data?.types, h?.doc_type_id);
  const tCur = defs.data?.types.find((x) => x.id === h?.doc_type_id);
  const dn = useDocNo(tCur, id ? cur.data?.doc_no : undefined, { disabled: ro, resetKey: h ? 'on' : 'off' });
  const save = async () => {
    if (h && !h.doc_type_id) { setErr(new Error(NO_TYPE_MSG)); return; }
    if (!h || busy || ro || !can(id ? 'edit' : 'add')) return;
    setErr(null); setBusy(true);
    const body = { doc_type_id: h.doc_type_id, doc_no: dn.value, doc_date: h.doc_date, visit_date: h.visit_date || null, appointment_date: h.appointment_date || null, party_id: h.party?.id, payment_terms: h.payment_terms || null, remark: h.remark || null,
      items: chosen.map((o) => ({ invoice_header_id: o.header_id })) };
    try {
      const r = id ? await api.put<{ id: string; doc_no: string }>(`/api/v1/${K.path}/${id}`, body) : await api.post<{ id: string; doc_no: string }>(`/api/v1/${K.path}`, body);
      toast(`บันทึก${K.label} ${r.doc_no} แล้ว`); setDirty(false); if (id) ed.lock();
      qc.invalidateQueries({ queryKey: [K.path] });
      if (!id) nav(`${K.route}/${r.id}`, { replace: true });
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const cancelDoc = async () => {
    try { await api.post(`/api/v1/${K.path}/${id}/cancel`, { reason }); toast('ยกเลิกเอกสารแล้ว'); setAskCancel(false); qc.invalidateQueries({ queryKey: [K.path] }); nav(K.route); }
    catch (e) { setAskCancel(false); setErr(e); }
  };
  useHotkeys({ F9: save, 'Ctrl+S': save, 'Alt+C': id && can('cancel') && cur.data?.doc_status !== 'C' ? () => setAskCancel(true) : undefined,
    Escape: () => { if (!dirty || window.confirm('มีการแก้ไขที่ยังไม่บันทึก — ออกโดยไม่บันทึก?')) nav(K.route); } }, []);
  const cancelled = cur.data?.doc_status === 'C';
  const dtCode = defs.data?.types.find((x) => x.id === h?.doc_type_id);
  return (
    <div className={cx('page', tColor && 'book-colored', cancelled && 'doc-cancelled')} data-tone="finance" style={bookStyle(tColor)}>
      <div className="doc-title"><p className="eyebrow">การเงิน › {K.label}</p><h1>{id ? cur.data?.doc_no : dn.value ?? (dtCode ? `${dtCode.code}**NEW**` : '')}</h1><CancelStamp show={cancelled} reason={(cur.data as { cancel_reason?: string | null } | undefined)?.cancel_reason} />{tCur && <span className="book-pill" title="ประเภทเอกสาร">{!id ? 'กำลังบันทึก: ' : ''}{tCur.code} {tCur.name_th}</span>}
        <span className="doc-state">{cancelled ? <Pill tone="x">ยกเลิก</Pill> : id ? <Pill tone="n">บันทึกแล้ว (ไม่ลงบัญชี)</Pill> : <Pill tone="m">ใหม่ — ยังไม่บันทึก</Pill>}{dirty && <Pill tone="c">มีการแก้ไขที่ยังไม่บันทึก</Pill>}{ed.locked && !roBase && <Pill tone="n">ดูอย่างเดียว — กด แก้ไข (Alt+E)</Pill>}</span></div>
      <div className="toolbar">
        <button onClick={() => { if (!dirty || window.confirm('ทิ้งการแก้ไข?')) { setH(null); setPick(new Set()); nav(`${K.route}/new`); } }}>+ ใหม่</button>
        <button className="primary" disabled={busy || ro} onClick={save}>บันทึก <kbd>F9</kbd></button>
        {ed.editButton}
        <button disabled={!id || cancelled || !can('cancel')} onClick={() => setAskCancel(true)}>ยกเลิกเอกสาร</button>
        <DocActions kind="doc" id={id} dirty={dirty} menu={K.menu} del={{ cancelled, cancelUrl: `/api/v1/${K.path}/${id}/cancel`, listPath: K.route }} />
        <button onClick={() => nav(K.route)}>รายการ <kbd>Esc</kbd></button>
      </div>
      <DocTypeTabs types={defs.data?.types} value={h?.doc_type_id ?? ''} locked={!!id} onChange={pickType} />
      <TypeNotice show={!id && !!h && !h.doc_type_id} />
      {ed.dialog}
      <ErrorBox error={err ?? cur.error ?? open.error} />
      {h && <div onKeyDown={(e) => navKey(e, ed.end)}>
        <div className="head-grid trade-head">
          <div className="col">
            <Field label={`รหัส${partyWord(K)}`} req><SearchPick<OpenParty> endpoint={partyEndpoint(K)} params={{ open: '1' }} addNew={false} value={h.party} required disabled={ro || !!id} autoFocus={!id} label={(r: { name: string }) => r.name} describe={openDescribe} onPick={(r: { id: string; code: string; name: string } | null) => pickParty(r)} /></Field>
            <Field label="เงื่อนไขการชำระเงิน"><input value={h.payment_terms} maxLength={60} disabled={ro} onChange={(e) => set({ payment_terms: e.target.value })} /></Field>
            <Field label="หมายเหตุ"><input value={h.remark} maxLength={200} disabled={ro} onChange={(e) => set({ remark: e.target.value })} /></Field>
          </div>
          <div className="col">
            
            {dn.field}
            
            <Field label="วันที่" req><DateInput value={h.doc_date} disabled={ro} onChange={(v) => set({ doc_date: v })} /></Field>
            {K.module === 'AR' && <Field label="วันที่ไปวางบิล"><DateInput value={h.visit_date} disabled={ro} onChange={(v) => set({ visit_date: v })} /></Field>}
            <Field label={`วันที่นัด${rp(K)}เงิน`} hint="ไม่ทราบให้เว้นว่าง ป้อนภายหลังได้"><DateInput value={h.appointment_date} disabled={ro} onChange={(v) => set({ appointment_date: v })} /></Field>
          </div>
        </div>
        <Tabs active="items" onChange={() => undefined} tabs={[{ key: 'items', label: `รายการที่${K.module === 'AR' ? '' : 'รับ'}วางบิล`, badge: chosen.length || undefined }]} />
        <div className="table-wrap lines">
          {!h.party ? <p className="empty">เลือก{partyWord(K)}ก่อน แล้วติ๊กบิลค้างที่จะวางบิล</p> : <table className="grid">
            <thead><tr><th style={{ width: 36 }}><input type="checkbox" checked={rows.length > 0 && chosen.length === rows.length} disabled={ro || !rows.length} onChange={(e) => { setPick(new Set(e.target.checked ? rows.map((o) => o.header_id) : [])); setDirty(true); }} aria-label="เลือกทั้งหมด" /></th>
              <th style={{ width: 140 }}>{K.module === 'AR' ? 'ใบกำกับ#' : 'ใบรับสินค้า#'}</th><th style={{ width: 80 }}>ชนิด</th><th style={{ width: 110 }}>วันที่</th><th style={{ width: 110 }}>ครบกำหนด</th>{K.module === 'AP' && <th>บิลเลขที่</th>}
              <th className="r" style={{ width: 130 }}>จำนวนเงิน</th><th className="r" style={{ width: 120 }}>ชำระแล้ว</th><th className="r" style={{ width: 130 }}>ค้างชำระ</th></tr></thead>
            <tbody>
              {rows.map((o) => {
                const on = pick.has(o.header_id);
                return (
                  <tr key={o.header_id} className={cx('row-open', on && 'picked')} onClick={(e) => { if (!ro && !(e.target as HTMLElement).matches('input')) toggle(o.header_id, !on); }}>
                    <td className="c"><input type="checkbox" checked={on} disabled={ro} onChange={(e) => toggle(o.header_id, e.target.checked)} aria-label={`เลือก ${o.doc_no}`} /></td>
                    <td><DocLink id={o.header_id} no={o.doc_no} keep={dirty} /></td><td>{CLASS_TH[o.doc_class]}</td><td><DateText v={o.doc_date} /></td><td><DateText v={o.due_date} /></td>{K.module === 'AP' && <td className="mono">{o.ref_no}</td>}
                    <td className="r"><Money v={o.amount} /></td><td className="r"><Money v={o.settled} blankZero /></td><td className="r"><Money v={o.outstanding} /></td>
                  </tr>
                );
              })}
              {open.data && !rows.length && <tr><td colSpan={9} className="empty">ไม่มีบิลค้างที่ยังไม่ได้วางบิลของ{partyWord(K)}รายนี้</td></tr>}
            </tbody>
            {chosen.length > 0 && <tfoot><tr><td colSpan={K.module === 'AP' ? 8 : 7} className="r">เลือก {chosen.length} ใบ — จำนวนเงินรวมทั้งสิ้น</td><td className="r"><b><Money v={total.toFixed(2)} /></b></td></tr></tfoot>}
          </table>}
        </div>
      </div>}
      <KeyHints keys={[['Enter', 'ช่องถัดไป (ช่องสุดท้าย = ถามบันทึก)'], ['Alt+E', 'แก้ไขเอกสารที่บันทึกแล้ว'], ['F4', 'ค้นหารหัส'], ['F9', 'บันทึก'], ['Alt+C', 'ยกเลิกเอกสาร'], ['Esc', 'กลับรายการ']]} />
      {askCancel && <Confirm danger title="ยกเลิกเอกสาร" text={<>ยกเลิก <b>{cur.data?.doc_no}</b>? (เปลี่ยนสถานะ ไม่ลบ) บิลในใบนี้จะกลับมาวางบิลใหม่ได้</>} okText="ยกเลิกเอกสาร" onClose={() => setAskCancel(false)} onOk={cancelDoc}>
        <Field label="เหตุผลที่ยกเลิก" req><input autoFocus value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></Field>
      </Confirm>}
    </div>
  );
}
