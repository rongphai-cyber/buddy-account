import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { d, sourceSystemLabel } from '@buddy/core';
import { api } from '../../api';
import { useCan } from '../../session';
import { SearchPick } from '../../components/LkSelect';
import { AccountCell } from '../../components/AccountCell';
import { Confirm, cx, DateInput, DateText, ErrorBox, Field, KeyHints, Money, MoneyInput, navKey, PageHead, Pill, Tabs, toast, useHotkeys } from '../../ui';
import { BranchScope, useShowBranchCol } from '../../components/BranchCol';
import { DocBranch, useDocBranch } from '../../components/DocBranch';
import { useDocEdit } from '../../components/DocEdit';
import { DocLink } from '../../components/DocLink';
import { DocActions } from '../../components/DocPrint';
import { CancelStamp, SourceStamp } from '../../components/DocDelete';
import { ReasonInput } from '../../components/ReasonInput';
import { AddWrap } from '../../components/AddWrap';
import { PostingTab } from './PostingTab';

/**
 * เงินมัดจำยกมา (HANDOFF ข้อ 86 91 — Express ไม่มีหน้าจอนี้): ใบรับเงินมัดจำ AI ที่ is_opening
 * ที่มา: WTS-Living ส่งเงินประกันผู้เช่ายกมา (ดูอย่างเดียว — แก้/ยกเลิกที่ระบบต้นทาง) หรือคีย์ที่ Buddy สำหรับลูกค้าที่ไม่ได้มาจาก Living
 * ลงบัญชี Dr บัญชีพักยอดยกมา (หรือบัญชีคู่ที่เลือก) / Cr เงินมัดจำรับ (ช่อง 3 ของประเภทเอกสาร) · ไม่มี VAT · ใบเสร็จหัก / ใบคืนเงินมัดจำคืน ได้ตามปกติ
 */
const K = { api: 'ar-deposit-opening', menu: 'FI.AR.DOB', label: 'เงินมัดจำยกมา', route: '/fi/ar/deposit-opening' } as const;
type Acc = { id: string; account_no: string; name_th: string };
interface Meta { start_date: string | null; opening_account: Acc | null }
interface Row { id: string; branch_code?: string | null; doc_no: string; doc_date: string; ref_no: string | null; party_name: string; party_code: string | null; net_amount: string; doc_status: string;
  outstanding: string | null; used: string | null; source_system: string | null; source_ref: string | null; posted: boolean }

/** ป้ายที่มา: ระบบต้นทาง หรือคีย์ที่ Buddy */
const SourcePill = ({ sys }: { sys: string | null }) => (sys ? <Pill tone="c">{sourceSystemLabel(sys)}</Pill> : <Pill tone="n">คีย์ที่ Buddy</Pill>);

export function DepositOpeningListPage() {
  const nav = useNavigate();
  const can = useCan(K.menu);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'N' | 'C' | 'all'>('all');
  const list = useQuery({ queryKey: [K.api, q, status], queryFn: () => api.get<{ rows: Row[]; total: string } & Meta>(`/api/v1/${K.api}`, { q, status }), placeholderData: (p) => p });
  useHotkeys({ Insert: can('add') ? () => nav(`${K.route}/new`) : undefined }, []);
  const showBr = useShowBranchCol();
  const live = list.data?.rows.filter((r) => r.doc_status !== 'C') ?? [];
  const sum = (k: 'net_amount' | 'used' | 'outstanding') => live.reduce((s, r) => s.plus(d(r[k] ?? 0)), d(0)).toFixed(2);
  const open = (id: string) => nav(`${K.route}/${id}`);
  return (
    <div className="page" data-tone="finance">
      <PageHead eyebrow="การเงิน › ลูกหนี้" title={`บันทึก${K.label}`}
        lead={<><span>เงินมัดจำ/เงินประกันของลูกค้าที่ค้างอยู่ ณ วันเริ่มใช้</span>{list.data?.start_date && <> <DateText v={list.data.start_date} /></>} <span>— ที่ WTS-Living ส่งมา หรือคีย์ที่นี่สำหรับลูกค้าอื่น · ลงบัญชี Dr บัญชีพักยอดยกมา / Cr เงินมัดจำรับ ไม่มี VAT · ใบเสร็จหักมัดจำ / ใบคืนเงินมัดจำ ใช้ได้ตามปกติ</span></>}
        actions={can('add') && <button className="primary" onClick={() => nav(`${K.route}/new`)}>+ เพิ่ม{K.label} <kbd>Ins</kbd></button>} />
      <div className="toolbar">
        <input type="search" autoFocus placeholder="ค้นหาเลขที่ ลูกค้า หรือเลขอ้างอิง" value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหา" />
        <button type="button" title="ค้นหา" aria-label="ค้นหา" onClick={() => void list.refetch()}>🔍</button>
        <select value={status} onChange={(e) => setStatus(e.target.value as 'N')} aria-label="สถานะ"><option value="all">ทุกสถานะ</option><option value="N">ปกติ</option><option value="C">ยกเลิก</option></select>
        <span className="muted small">{list.data ? `${list.data.rows.length.toLocaleString()} ใบ` : ''}</span>
      </div>
      <ErrorBox error={list.error} />
      <BranchScope /><div className="table-wrap dob-list">
        <table className="grid">
          <thead><tr>{showBr && <th style={{ width: 70 }}>สาขา</th>}<th style={{ width: 100 }}>รหัส</th><th>ลูกค้า</th><th style={{ width: 130 }}>เลขที่</th><th style={{ width: 110 }}>วันที่</th>
            <th className="r" style={{ width: 130 }}>จำนวนเงิน</th><th className="r" style={{ width: 120 }}>ใช้แล้ว</th><th className="r" style={{ width: 130 }}>คงเหลือ</th><th style={{ width: 120 }}>ที่มา</th><th style={{ width: 100 }}>สถานะ</th></tr></thead>
          <tbody>
            {list.data?.rows.map((r) => (
              <tr key={r.id} className={cx('row-open', r.doc_status === 'C' && 'cancelled')} tabIndex={0} onClick={() => open(r.id)} onKeyDown={(e) => e.key === 'Enter' && open(r.id)}>
                {showBr && <td data-label="สาขา" className="mono small">{r.branch_code}</td>}<td data-label="รหัส" className="mono">{r.party_code}</td><td data-label="ลูกค้า">{r.party_name}</td><td data-label="เลขที่" className="mono">{r.doc_no}</td><td data-label="วันที่"><DateText v={r.doc_date} /></td>
                <td data-label="จำนวนเงิน" className="r"><Money v={r.net_amount} /></td><td data-label="ใช้แล้ว" className="r"><Money v={r.used} blankZero /></td><td data-label="คงเหลือ" className="r"><Money v={r.outstanding} blankZero /></td>
                <td data-label="ที่มา" title={r.source_ref ?? undefined}><SourcePill sys={r.source_system} /></td>
                <td data-label="สถานะ">{r.doc_status === 'C' ? <Pill tone="x">ยกเลิก</Pill> : d(r.outstanding ?? 0).isZero() ? <Pill tone="n">ใช้หมดแล้ว</Pill> : !r.posted ? <Pill tone="d">ไม่ลงบัญชี</Pill> : <Pill tone="m">คงเหลือ</Pill>}</td>
              </tr>
            ))}
            {list.data && !list.data.rows.length && <tr><td colSpan={9 + (showBr ? 1 : 0)} className="empty">ยังไม่มีเงินมัดจำยกมา — กด Ins เพื่อเพิ่ม</td></tr>}
          </tbody>
          {!!live.length && <tfoot><tr><td colSpan={4 + (showBr ? 1 : 0)} className="r">รวม (ไม่รวมที่ยกเลิก)</td><td data-label="จำนวนเงิน" className="r"><b><Money v={sum('net_amount')} /></b></td><td data-label="ใช้แล้ว" className="r"><b><Money v={sum('used')} /></b></td><td data-label="คงเหลือ" className="r"><b><Money v={sum('outstanding')} /></b></td><td colSpan={2} /></tr></tfoot>}
        </table>
      </div>
      <KeyHints keys={[['Ins', 'เพิ่มรายการ'], ['คลิก/Enter', 'เปิดรายการ']]} />
    </div>
  );
}

type Link = { id: string; doc_class: string; doc_no: string; doc_date: string; amount: string; doc_status: string };
type Cur = Record<string, string | null> & { editable: boolean; posted: boolean; links: Link[]; used: string | null; outstanding: string | null; offset_account: { account_no: string; name_th: string } | null; source_system: string | null; doc_status: string; cancel_reason: string | null };
type Head = { party: { id: string; code: string; name?: string | null } | null; doc_no: string; doc_date: string; doc_type_id: string; ref_no: string; amount: string; remark: string; department_id: string; post_gl: boolean; offset_account_id: string | null };

export function DepositOpeningFormPage() {
  const { id: routeId } = useParams();
  const id = routeId && routeId !== 'new' ? routeId : null;
  const nav = useNavigate();
  const qc = useQueryClient();
  const can = useCan(K.menu);
  const cur = useQuery({ enabled: !!id, queryKey: [K.api, 'one', id], queryFn: () => api.get<Cur>(`/api/v1/${K.api}/${id}`), staleTime: 0 });
  const meta = useQuery({ queryKey: [K.api, 'meta'], queryFn: () => api.get<Meta>(`/api/v1/${K.api}`, { limit: 1 }) });
  const types = useQuery({ queryKey: ['trade-defaults', 'AI'], queryFn: () => api.get<{ types: Array<{ id: string; code: string; name_th: string }> }>('/api/v1/trade-defaults/AI') });
  const depts = useQuery({ queryKey: ['departments'], queryFn: () => api.get<Array<{ id: string; code: string; name_th: string; status: string }>>('/api/v1/departments') });
  const br = useDocBranch(id, cur.data?.branch_id);
  const [h, setH] = useState<Head | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState('links');
  const [askCancel, setAskCancel] = useState(false);
  const [reason, setReason] = useState('');
  if (!h && !id && meta.data && types.data) {
    // ค่าเริ่มต้น: วันก่อนวันเริ่มใช้ · ประเภทเอกสารแรก · ลงบัญชีกับบัญชีพักยอดยกมา
    const before = meta.data.start_date ? new Date(new Date(meta.data.start_date).getTime() - 86400000).toISOString().slice(0, 10) : '';
    setH({ party: null, doc_no: '', doc_date: before, doc_type_id: types.data.types[0]?.id ?? '', ref_no: '', amount: '', remark: '', department_id: '', post_gl: true, offset_account_id: null });
  }
  if (!h && id && cur.data) {
    const c = cur.data;
    setH({ party: { id: c.customer_id!, code: c.party_code ?? '', name: c.party_name }, doc_no: c.doc_no ?? '', doc_date: String(c.doc_date).slice(0, 10), doc_type_id: c.doc_type_id ?? '', ref_no: c.ref_no ?? '',
      amount: d(c.net_amount ?? 0).toString(), remark: c.remark ?? '', department_id: c.department_id ?? '', post_gl: c.posted, offset_account_id: c.opening_offset_account_id ?? null });
  }
  const fromSource = !!cur.data?.source_system;
  const cancelled = cur.data?.doc_status === 'C';
  const roBase = !!id && (!cur.data?.editable || !can('edit'));
  const ed = useDocEdit({ id: id ?? undefined, allowed: !!id && !roBase, dirty, onSave: (n) => void save(!!n), onDiscard: () => { setH(null); setDirty(false); } });
  const ro = roBase || ed.locked;
  const set = (p: Partial<Head>) => { setH((x) => ({ ...x!, ...p })); setDirty(true); };
  const bodyOf = () => h && ({ branch_id: br.body, party_id: h.party?.id, doc_no: h.doc_no, doc_date: h.doc_date, ref_no: h.ref_no || null, price_type: '0', amount: h.amount || '0', vat_rate: '0',
    remark: h.remark || null, department_id: h.department_id || null, doc_type_id: h.doc_type_id || null, post_gl: h.post_gl, offset_account_id: h.post_gl ? h.offset_account_id : null });
  const save = async (andNew = false) => {
    if (!h || busy || ro) return;
    if (!h.party) { setErr(new Error('เลือกลูกค้า (ช่องรหัสลูกค้า กด F4 หรือ 🔍 ค้นหา)')); return; }
    if (!h.doc_no.trim()) { setErr(new Error('ป้อนเลขที่เอกสาร (แนะนำใส่ปีนำหน้า เช่น AI68/0001)')); return; }
    if (!d(h.amount || 0).gt(0)) { setErr(new Error('ป้อนจำนวนเงินมัดจำคงเหลือยกมา (มากกว่า 0)')); return; }
    setErr(null); setBusy(true);
    try {
      const body = bodyOf()!;
      const r = id ? await api.put<{ id: string; doc_no: string; journal_id: string | null }>(`/api/v1/${K.api}/${id}`, body) : await api.post<{ id: string; doc_no: string; journal_id: string | null }>(`/api/v1/${K.api}`, body);
      toast(r.journal_id ? `บันทึก ${r.doc_no} แล้ว — ลงบัญชีแล้ว` : `บันทึก ${r.doc_no} แล้ว (ไม่ลงบัญชี)`); setDirty(false); if (id) ed.lock();
      qc.invalidateQueries({ queryKey: [K.api] }); qc.invalidateQueries({ queryKey: ['deposits-open'] }); qc.invalidateQueries({ queryKey: ['doc-journal', r.id] });
      if (andNew) { setH((x) => ({ ...x!, party: null, doc_no: '', ref_no: '', amount: '', remark: '' })); nav(`${K.route}/new`, { replace: true }); }
      else if (!id) { nav(`${K.route}/${r.id}`, { replace: true }); setH(null); }
      else { await qc.refetchQueries({ queryKey: [K.api, 'one', id] }); setH(null); }
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const cancelDoc = async () => {
    try { await api.post(`/api/v1/${K.api}/${id}/cancel`, { reason }); toast('ยกเลิกรายการแล้ว — ใบสำคัญถูกยกเลิก'); setAskCancel(false); qc.invalidateQueries({ queryKey: [K.api] }); nav(K.route); }
    catch (e) { setAskCancel(false); setErr(e); }
  };
  const usedNow = (cur.data?.links ?? []).filter((x) => x.doc_status !== 'C');
  const canCancel = !!id && !cancelled && can('cancel') && !usedNow.length;
  useHotkeys({ F9: () => save(), 'Ctrl+S': () => save(), 'Ctrl+Enter': () => save(true), 'Alt+C': canCancel ? () => setAskCancel(true) : undefined,
    Escape: () => { if (!dirty || window.confirm('มีการแก้ไขที่ยังไม่บันทึก — ออกโดยไม่บันทึก?')) nav(K.route); } }, []);
  const startHint = meta.data?.start_date ? <>วันเริ่มใช้ <DateText v={meta.data.start_date} /> · </> : null;
  const defAcc = meta.data?.opening_account;
  return (
    <div className={cx('page', cancelled && 'doc-cancelled')} data-tone="sales">
      <div className="doc-title"><p className="eyebrow">การเงิน › ลูกหนี้ › {K.label}</p><h1>{id ? cur.data?.doc_no : 'รายการใหม่'}</h1><CancelStamp show={cancelled} reason={cur.data?.cancel_reason} /><SourceStamp doc={cur.data as Parameters<typeof SourceStamp>[0]['doc']} />
        <span className="doc-state"><DocBranch value={br.value} onChange={(v) => { br.set(v); setDirty(true); }} disabled={ro} /> {cancelled ? <Pill tone="x">ยกเลิก</Pill> : id ? (cur.data?.posted ? <Pill tone="n">ยอดยกมา — ลงบัญชีแล้ว</Pill> : <Pill tone="d">ยอดยกมา (ไม่ลงบัญชี)</Pill>) : <Pill tone="m">ใหม่ — ยังไม่บันทึก</Pill>}
          {dirty && <Pill tone="c">มีการแก้ไขที่ยังไม่บันทึก</Pill>}{ed.locked && !roBase && !cancelled && <Pill tone="n">ดูอย่างเดียว — กด แก้ไข (Alt+E)</Pill>}
          {roBase && !cancelled && id && cur.data && !fromSource && !!usedNow.length && <Pill tone="d">มีเอกสารใช้มัดจำนี้แล้ว — แก้ไข/ยกเลิกไม่ได้</Pill>}</span></div>
      <div className="toolbar">
        <button onClick={() => { if (!dirty || window.confirm('ทิ้งการแก้ไข?')) { setH(null); setDirty(false); nav(`${K.route}/new`); } }}>+ ใหม่</button>
        <button className="primary" disabled={busy || ro} onClick={() => save()}>บันทึก <kbd>F9</kbd></button>
        {ed.editButton}
        <button disabled={busy || ro} onClick={() => save(true)}>บันทึก+ใหม่ <kbd>Ctrl+Enter</kbd></button>
        <button disabled={!canCancel} title={usedNow.length ? `มี ${usedNow[0]!.doc_no} ใช้มัดจำนี้อยู่ — ยกเลิก ${usedNow[0]!.doc_no} ก่อน` : undefined} onClick={() => setAskCancel(true)}>ยกเลิกรายการ <kbd>Alt+C</kbd></button>
        <DocActions kind="doc" id={id} dirty={dirty} menu={K.menu} del={{ cancelled, cancelUrl: `/api/v1/${K.api}/${id}/cancel`, listPath: K.route }} />
        <button onClick={() => nav(K.route)}>รายการ <kbd>Esc</kbd></button>
      </div>
      {fromSource && <p className="notebox">ใบนี้มาจาก <b>{sourceSystemLabel(cur.data!.source_system!)}</b> (ระบบต้นทางของเงินประกัน/มัดจำ) จึงดูได้อย่างเดียว — แก้ไขหรือยกเลิกที่ {sourceSystemLabel(cur.data!.source_system!)} แล้วระบบส่งรุ่นใหม่มาเอง เพื่อให้ทะเบียนเงินประกันของสองระบบตรงกัน · ผู้ใช้ระดับอนุมัติ 9 ยกเลิก/ลบที่นี่ได้โดยระบุเหตุผล (บันทึกในบันทึกการทำงาน)</p>}
      {ed.dialog}
      <ErrorBox error={err ?? cur.error} />
      {h && <div onKeyDown={(e) => navKey(e, ed.end)}>
        <div className="head-grid trade-head">
          <div className="col">
            <Field label="รหัสลูกค้า" req><SearchPick<{ id: string; code: string; name: string }> endpoint="/api/v1/customers" value={h.party} required disabled={ro} autoFocus={!id} label={(r: { name: string }) => r.name} onPick={(r: { id: string; code: string; name: string } | null) => set({ party: r })} /></Field>
            <Field label="อ้างอิง" hint="เช่น เลขที่สัญญา/ใบมัดจำในระบบเดิม"><input value={h.ref_no} maxLength={30} disabled={ro} onChange={(e) => set({ ref_no: e.target.value })} /></Field>
            <Field label="หมายเหตุ"><input value={h.remark} maxLength={200} disabled={ro} onChange={(e) => set({ remark: e.target.value })} /></Field>
            <Field label="แผนก"><AddWrap kind="dept"><select value={h.department_id} disabled={ro} onChange={(e) => set({ department_id: e.target.value })}><option value="">—</option>{depts.data?.filter((x) => x.status === 'A' || x.id === h.department_id).map((x) => <option key={x.id} value={x.id}>{x.code} {x.name_th}</option>)}</select></AddWrap></Field>
          </div>
          <div className="col">
            <Field label="เลขที่เอกสาร" req hint="ป้อนเอง ห้ามซ้ำเลขปีปัจจุบัน — แนะนำใส่ปีนำหน้า เช่น AI68/0001"><input className="mono" value={h.doc_no} maxLength={30} disabled={ro} onChange={(e) => set({ doc_no: e.target.value })} /></Field>
            <Field label="วันที่" req hint={<>{startHint}ก่อนวันเริ่มใช้ = ยอดยกมาของงบทดลอง · ตั้งแต่วันเริ่มใช้ = ลงในงวดที่ยังไม่ปิด (เริ่มใช้ระบบเดิมทีหลัง)</>}><DateInput value={h.doc_date} disabled={ro} onChange={(v) => set({ doc_date: v })} /></Field>
            <Field label="ประเภทเอกสาร" req hint="บัญชีเงินมัดจำรับ = ช่อง 3 ของประเภทเอกสาร (ว่าง = บัญชีเพื่อลงรายวัน)"><select value={h.doc_type_id} disabled={ro || !!id} onChange={(e) => set({ doc_type_id: e.target.value })}>
              {types.data?.types.map((t) => <option key={t.id} value={t.id}>{t.code} {t.name_th}</option>)}</select></Field>
            <Field label="จำนวนเงินมัดจำคงเหลือยกมา" req hint="ไม่มี VAT (ภาษีของมัดจำยื่นไปแล้วในระบบเดิม)"><MoneyInput value={h.amount} disabled={ro} onChange={(v) => set({ amount: v })} aria-label="จำนวนเงิน" /></Field>
          </div>
        </div>
        <div className="head-grid">
          <div className="col">
            <Field label="ลงบัญชี" hint="ติ๊ก = Dr บัญชีคู่ / Cr เงินมัดจำรับ ทันที · ไม่ติ๊ก = เข้าทะเบียนอย่างเดียว เมื่อยอดเงินมัดจำรับคีย์ไว้แล้วที่ บันทึกยอดยกมา (กันยอดซ้ำ)">
              <label className="check"><input type="checkbox" checked={h.post_gl} disabled={ro} onChange={(e) => set({ post_gl: e.target.checked })} /> ลงบัญชียอดยกมา</label></Field>
            {h.post_gl && <Field label="บัญชีคู่ (Dr)" hint={defAcc ? `ว่าง = บัญชีพักยอดยกมา ${defAcc.account_no} ${defAcc.name_th} · ต้องเป็นบัญชีงบดุล (หมวด 1–3)` : 'ยังไม่ได้กำหนดบัญชีพักยอดยกมา — เลือกบัญชีงบดุล หรือกำหนดบทบาท "บัญชีพักยอดยกมา" ที่ เริ่มระบบ › การเชื่อมต่อบัญชี'}>
              <AccountCell value={h.offset_account_id} disabled={ro} onChange={(a) => set({ offset_account_id: a?.id ?? null })} aria-label="บัญชีคู่" /></Field>}
          </div>
          {id && cur.data && <div className="col"><table className="totals-table"><tbody>
            <tr><td>จำนวนเงิน</td><td className="r"><Money v={cur.data.net_amount} /></td></tr>
            <tr><td>ใช้แล้ว (ใบเสร็จหัก/ใบคืนเงิน)</td><td className="r"><Money v={cur.data.used} /></td></tr>
            <tr className="grand"><td>คงเหลือ</td><td className="r"><Money v={cancelled ? '0' : cur.data.outstanding} /></td></tr>
          </tbody></table></div>}
        </div>
        <Tabs active={tab} onChange={setTab} tabs={[{ key: 'links', label: 'เอกสารที่ใช้มัดจำนี้', badge: usedNow.length || undefined }, { key: 'gl', label: id && ro ? 'ใบสำคัญที่ลงบัญชี' : 'ตัวอย่างการลงบัญชี' }]} />
        {tab === 'links' && (!id ? <p className="muted">บันทึกแล้วจะเห็นใบเสร็จที่หักมัดจำ / ใบคืนเงินมัดจำที่ใช้ใบนี้</p>
          : cur.data?.links.length ? <div className="table-wrap"><table className="grid"><thead><tr><th style={{ width: 140 }}>เลขที่</th><th>เอกสาร</th><th style={{ width: 110 }}>วันที่</th><th className="r" style={{ width: 130 }}>ยอดที่ใช้</th><th style={{ width: 90 }}>สถานะ</th></tr></thead>
            <tbody>{cur.data.links.map((l) => <tr key={l.id} className={cx(l.doc_status === 'C' && 'cancelled')}><td><DocLink id={l.id} no={l.doc_no} cls={l.doc_class} keep={dirty} /></td><td>{l.doc_class === 'RE' ? 'ใบเสร็จรับเงิน (หักมัดจำ)' : l.doc_class === 'RD' ? 'คืนเงินมัดจำ' : l.doc_class}</td><td><DateText v={l.doc_date} /></td><td className="r"><Money v={l.amount} /></td>
              <td>{l.doc_status === 'C' ? <Pill tone="x">ยกเลิก</Pill> : <Pill tone="n">ใช้อยู่</Pill>}</td></tr>)}</tbody></table></div>
          : <p className="muted">ยังไม่มีเอกสารใช้มัดจำนี้ — หักได้ที่ รับชำระหนี้ (แท็บหักเงินมัดจำ) หรือคืนที่ ขาย › คืนเงินมัดจำ</p>)}
        {tab === 'gl' && <PostingTab id={id} path={K.api} editing={!ro} bodyOf={bodyOf} />}
      </div>}
      <KeyHints keys={[['Enter', 'ช่องถัดไป (ช่องสุดท้าย = ถามบันทึก)'], ['Alt+E', 'แก้ไข'], ['F4', 'ค้นหารหัส'], ['F9', 'บันทึก'], ['Ctrl+Enter', 'บันทึก+ใหม่'], ['Alt+C', 'ยกเลิก'], ['Alt+D', 'ลบ (ที่ยกเลิกแล้ว)'], ['Esc', 'กลับรายการ']]} />
      {askCancel && <Confirm danger title="ยกเลิกรายการ" text={<>ยกเลิก <b>{cur.data?.doc_no}</b>? (เปลี่ยนสถานะ ไม่ลบ · ใบสำคัญยอดยกมาถูกยกเลิก)</>} okText="ยกเลิกรายการ" onClose={() => setAskCancel(false)} onOk={cancelDoc}>
        <Field label="เหตุผลที่ยกเลิก" req><ReasonInput value={reason} onChange={setReason} /></Field>
      </Confirm>}
    </div>
  );
}
