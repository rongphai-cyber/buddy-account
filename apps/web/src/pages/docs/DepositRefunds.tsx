import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { d, DEPOSIT_REFUND as K, fmt, settlementTotals, todayIso } from '@buddy/core';
import { api } from '../../api';
import { useCan, useSession } from '../../session';
import { SearchPick } from '../../components/LkSelect';
import { Confirm, cx, DateInput, DateText, ErrorBox, Field, KeyHints, Money, MoneyInput, navKey, PageHead, Pill, Tabs, toast, useHotkeys } from '../../ui';
import { BranchScope, useShowBranchCol } from '../../components/BranchCol';
import { DocBranch, useDocBranch } from '../../components/DocBranch';
import { useDocEdit } from '../../components/DocEdit';
import { useDocNo } from '../../components/DocNo';
import { DocActions } from '../../components/DocPrint';
import { CancelStamp, SourceStamp } from '../../components/DocDelete';
import { PostingTab } from './PostingTab';
import { nextKey, PayChoiceDialog, PaymentsTable, paysBody, paysFrom, type Pay, type PayChoice } from './MoneyParts';
import { DocTypeTabs, initialType, NO_TYPE_MSG, TypeNotice, useTypeTabs } from '../../components/DocTypeTabs';
import { bookStyle, typeColorIn } from '../../bookColor';
import { ReasonInput } from '../../components/ReasonInput';
import { AddWrap } from '../../components/AddWrap';
import { DepositPickTable, depositsBody, depositsFrom, refundTotals, savedRefundVat, useOpenDeposits, type DepositPicks } from './DepositPick';

/**
 * คืนเงินมัดจำ (RD — Buddy เพิ่ม 05/11/2569 · Express ไม่มีเอกสารนี้): คืนยอดคงเหลือของใบรับเงินมัดจำให้ลูกค้า
 * เช่น เงินประกันห้องพักตอนย้ายออก หลังหักค่าเช่า/ค่าเสียหายด้วยใบเสร็จแล้ว · ลงบัญชี Dr เงินมัดจำรับ / Cr เงินสด-ธนาคาร
 * มัดจำที่มี VAT (06/11/2569): ใบคืนเงินมัดจำ = ใบลดหนี้ — Dr มัดจำรับ (ก่อน VAT) + Dr ภาษีขาย / Cr เงินที่จ่าย · ต้องป้อนเหตุผล (ช่องหมายเหตุ)
 */

/* ---------------------------------------------------------------- รายการ */
interface ListRow { id: string; doc_no: string; doc_date: string; party_name: string | null; party_code: string | null; your_ref: string | null; net_amount: string; cash_amount: string; cheque_amount: string; doc_status: string; deposit_nos: string | null; branch_code?: string | null }
export function DepositRefundListPage() {
  const nav = useNavigate();
  const can = useCan(K.menu);
  const { me } = useSession();
  const today = me?.work_date ?? todayIso();
  const [q, setQ] = useState('');
  const [from, setFrom] = useState(today.slice(0, 8) + '01');
  const [to, setTo] = useState(today);
  const [status, setStatus] = useState<'N' | 'C' | 'all'>('all');
  const tt = useTypeTabs(K.cls);
  const list = useQuery({ queryKey: [K.path, q, from, to, status, tt.tab], queryFn: () => api.get<{ total: number; rows: ListRow[] }>(`/api/v1/${K.path}`, { type_id: tt.tab || undefined, q, from, to, status, limit: 500 }), placeholderData: (p) => p });
  useHotkeys({ Insert: can('add') ? () => nav(tt.newUrl(`${K.route}/new`)) : undefined }, [tt.tab]);
  const total = list.data?.rows.filter((r) => r.doc_status !== 'C').reduce((s, r) => s.plus(d(r.net_amount)), d(0));
  const showBr = useShowBranchCol();
  return (
    <div className="page" data-tone="sales">
      <PageHead eyebrow={`ขาย › ${K.label}`} title={K.label}
        lead="คืนยอดคงเหลือของใบรับเงินมัดจำให้ลูกค้า (เช่น เงินประกันตอนย้ายออก) จ่ายเงินสด/โอน/เช็ค · มัดจำที่มี VAT ออกเป็นใบลดหนี้ · ยอดมัดจำคงเหลือลดลงทันที · ยกเลิกแล้วยอดมัดจำกลับคืน · บันทึกแล้วลงบัญชีทันที"
        actions={can('add') && <button className={cx('primary', tt.color && 'book-btn')} style={bookStyle(tt.color)} onClick={() => nav(tt.newUrl(`${K.route}/new`))}>+ {K.label} {tt.cur ? `${tt.cur.code} ` : ''}<kbd>Ins</kbd></button>} />
      {tt.tabs()}
      <div className="toolbar">
        <input type="search" autoFocus placeholder="ค้นหาเลขที่ ลูกค้า อ้างอิง หรือเลขที่ใบมัดจำ" value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหาเอกสาร" />
        <label>ตั้งแต่ <DateInput value={from} onChange={setFrom} /></label>
        <label>ถึง <DateInput value={to} onChange={setTo} /></label>
        <select value={status} onChange={(e) => setStatus(e.target.value as 'N')} aria-label="สถานะ"><option value="all">ทุกสถานะ</option><option value="N">ปกติ</option><option value="C">ยกเลิก</option></select>
        <span className="muted small">{list.data ? `${list.data.rows.length.toLocaleString()} จาก ${list.data.total.toLocaleString()} ใบ` : ''}</span>
      </div>
      <ErrorBox error={list.error} />
      <BranchScope /><div className="table-wrap">
        <table className="grid">
          <thead><tr>{showBr && <th style={{ width: 70 }}>สาขา</th>}<th style={{ width: 130 }}>เลขที่</th><th style={{ width: 110 }}>วันที่</th><th style={{ width: 100 }}>รหัส</th><th>ลูกค้า</th><th style={{ width: 160 }}>ใบมัดจำ</th>
            <th className="r" style={{ width: 140 }}>ยอดคืน</th><th style={{ width: 80 }}>สถานะ</th></tr></thead>
          <tbody>
            {list.data?.rows.map((r) => (
              <tr key={r.id} className={cx('row-open', r.doc_status === 'C' && 'cancelled')} tabIndex={0} onClick={() => nav(`${K.route}/${r.id}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`${K.route}/${r.id}`)}>
                {showBr && <td className="mono small">{r.branch_code}</td>}<td className="mono">{r.doc_no}</td><td><DateText v={r.doc_date} /></td><td className="mono">{r.party_code}</td><td>{r.party_name}</td><td className="mono small">{r.deposit_nos}</td>
                <td className="r"><Money v={r.net_amount} /></td><td>{r.doc_status === 'C' ? <Pill tone="x">ยกเลิก</Pill> : <Pill tone="n">ปกติ</Pill>}</td>
              </tr>
            ))}
            {list.data && !list.data.rows.length && <tr><td colSpan={7 + (showBr ? 1 : 0)} className="empty">ไม่มีเอกสารในช่วงนี้ — กด Ins เพื่อเพิ่ม</td></tr>}
          </tbody>
          {!!list.data?.rows.length && <tfoot><tr><td colSpan={5 + (showBr ? 1 : 0)} className="r">รวม (ไม่รวมที่ยกเลิก)</td><td className="r"><b><Money v={total?.toFixed(2)} /></b></td><td /></tr></tfoot>}
        </table>
      </div>
      <KeyHints keys={[['Ins', `เพิ่ม${K.label}`], ['คลิก/Enter', 'เปิดเอกสาร']]} />
    </div>
  );
}

/* ---------------------------------------------------------------- หน้าเอกสาร */
interface Head { doc_type_id: string; doc_date: string; party: { id: string; code: string; name?: string | null } | null; department_id: string; salesperson_id: string; your_ref: string; remark: string; cash: string }
interface Detail extends Record<string, unknown> { doc_no: string; doc_status: string; editable: boolean; branch_id: string; deposits: Array<{ header_id: string; doc_no: string; amount: string; vat_amount?: string | null }>; payments: Parameters<typeof paysFrom>[0] }

export function DepositRefundFormPage() {
  const { id: routeId } = useParams();
  const [sp] = useSearchParams();
  const id = routeId && routeId !== 'new' ? routeId : null;
  const fromAi = !id ? sp.get('ai') : null;
  const nav = useNavigate();
  const qc = useQueryClient();
  const can = useCan(K.menu);
  const { me } = useSession();
  const defs = useQuery({ queryKey: ['trade-defaults', K.cls], queryFn: () => api.get<{ types: Array<{ id: string; code: string; name_th: string; next_no?: string | null }> }>(`/api/v1/trade-defaults/${K.cls}`) });
  const depts = useQuery({ queryKey: ['departments'], queryFn: () => api.get<Array<{ id: string; code: string; name_th: string; status: string }>>('/api/v1/departments') });
  const slms = useQuery({ queryKey: ['salespersons'], queryFn: () => api.get<Array<{ id: string; code: string; name: string; status: string }>>('/api/v1/salespersons') });
  const cur = useQuery({ enabled: !!id, queryKey: [K.path, 'one', id], queryFn: () => api.get<Detail>(`/api/v1/${K.path}/${id}`), staleTime: 0 });
  const br = useDocBranch(id, cur.data?.branch_id);
  const [h, setH] = useState<Head | null>(null);
  const [deps, setDeps] = useState<DepositPicks>({});
  const [pays, setPays] = useState<Pay[]>([]);
  const [tab, setTab] = useState('deposits');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [askCancel, setAskCancel] = useState(false);
  const [reason, setReason] = useState('');
  const [dirty, setDirty] = useState(false);
  const date0 = me?.work_date ?? todayIso();
  if (!h && !id && defs.data) setH({ doc_type_id: initialType(defs.data.types)?.id ?? '', doc_date: date0, party: null, department_id: '', salesperson_id: '', your_ref: '', remark: '', cash: '' });
  if (!h && id && cur.data) {
    const c = cur.data as Record<string, string | null>;
    setH({ doc_type_id: c.doc_type_id!, doc_date: String(c.doc_date).slice(0, 10), party: c.customer_id ? { id: c.customer_id, code: c.party_code ?? '', name: c.party_name } : null, department_id: c.department_id ?? '', salesperson_id: c.salesperson_id ?? '',
      your_ref: c.your_ref ?? '', remark: c.remark ?? '', cash: '' });
    setDeps(depositsFrom(cur.data.deposits));
    setPays(paysFrom(cur.data.payments));
  }
  // เปิดจากหน้ารับเงินมัดจำ (ปุ่ม "คืนเงินมัดจำ"): เลือกลูกค้าและใบมัดจำนั้นด้วยยอดคงเหลือให้
  const [prefilled, setPrefilled] = useState(false);
  useEffect(() => {
    if (!fromAi || prefilled || !h || h.party) return;
    setPrefilled(true);
    api.get<Record<string, string | null>>(`/api/v1/ar-deposits/${fromAi}`).then((a) => {
      if (!a.customer_id) return;
      setH((x) => (x ? { ...x, party: { id: a.customer_id!, code: a.party_code ?? '', name: a.party_name } } : x));
      if (a.remaining && d(a.remaining).gt(0)) setDeps({ [fromAi]: d(a.remaining).toString() });
      setDirty(true);
    }, setErr);
  }, [fromAi, prefilled, h]);
  const roBase = !!id && (!cur.data?.editable || !can('edit'));
  const ed = useDocEdit({ id: id ?? undefined, allowed: !!id && !roBase, dirty, onSave: (n) => void save(!!n), onDiscard: () => { setH(null); setDirty(false); } });
  const ro = roBase || ed.locked;
  const set = (p: Partial<Head>) => { setH((x) => ({ ...x!, ...p })); setDirty(true); };
  // ยอดที่จ่ายจริง = ยอดคืน (+ VAT เมื่อมัดจำแยก VAT) · มี VAT = ใบลดหนี้
  const open = useOpenDeposits(h?.party?.id, id);
  const rt = refundTotals(open.data?.rows, deps, dirty ? {} : savedRefundVat(cur.data?.deposits));
  const total = rt.paid.toFixed(2);
  const t = settlementTotals({ settlements: [total], payments: pays.filter((p) => p.payment_method_id).map((p) => p.amount || 0), cash: h?.cash ? h.cash : null });
  const tColor = typeColorIn(defs.data?.types, h?.doc_type_id);
  const tCur = defs.data?.types.find((x) => x.id === h?.doc_type_id);
  const dn = useDocNo(tCur, id ? cur.data?.doc_no : undefined, { disabled: ro, resetKey: h ? 'on' : 'off' });
  const pickParty = (p: { id: string; code: string; name: string } | null) => { setDeps({}); set({ party: p }); if (p) setTab('deposits'); };
  const bodyOf = () => h && ({ branch_id: br.body, doc_type_id: h.doc_type_id, doc_no: dn.value, doc_date: h.doc_date, party_id: h.party?.id, department_id: h.department_id || null, salesperson_id: h.salesperson_id || null,
    your_ref: h.your_ref || null, remark: h.remark || null, deposits: depositsBody(deps), cash_amount: h.cash === '' ? null : h.cash, payments: paysBody(pays) });
  const reset = () => { setH(null); setDeps({}); setPays([]); setPayOk(''); };
  // ก่อนบันทึก: ถามวิธีจ่ายเงิน (ใบใหม่ที่ยังไม่ได้เลือก หรือยอดวิธีอื่นยังไม่ครบ — docs/18 ข้อ 2) · ตกลงแล้วจำไว้จนกว่ายอดจะเปลี่ยน
  const [payAsk, setPayAsk] = useState<{ next: 'save' | 'confirm'; andNew: boolean } | null>(null);
  const [payOk, setPayOk] = useState('');
  const [pendingSave, setPendingSave] = useState<{ andNew: boolean } | null>(null);
  const needsPay = () => {
    if (!h || ro || !Object.keys(deps).length || h.cash !== '') return false;
    const due = d(t.due), other = d(t.other);
    if (!due.gt(0) || payOk === `${t.due}|${t.other}`) return false;
    return other.isZero() ? !id : other.lt(due);
  };
  const choosePay = (c: PayChoice) => {
    const ask = payAsk!;
    setPayAsk(null);
    const line = (methodId: string, amount: string): Pay => ({ key: nextKey(), payment_method_id: methodId, amount, reference_no: '', cheque_date: h!.doc_date, bank_id: null, bank_branch: '' });
    if (c.kind === 'split' || (c.kind === 'method' && c.method.creates_cheque)) {
      if (c.kind === 'method') setPays([line(c.method.id, t.due)]);
      else if (!pays.some((p) => !p.payment_method_id)) setPays((ps) => [...ps, line('', d(t.cash).gt(0) ? t.cash : '')]);
      setDirty(true); setTab('pay');
      toast(c.kind === 'split' ? 'ป้อนวิธีจ่ายเงินและยอดในแท็บจ่ายโดยอื่น ๆ แล้วกด F9' : 'ป้อนเลขที่เช็ค/ลงวันที่/ธนาคาร แล้วกด F9');
      return;
    }
    if (c.kind === 'method') { setPays([line(c.method.id, t.due)]); setDirty(true); setPayOk(`${t.due}|${t.due}`); }
    else setPayOk(`${t.due}|${t.other}`);
    if (ask.next === 'confirm') ed.end(); else setPendingSave({ andNew: ask.andNew });
  };
  useEffect(() => { if (pendingSave) { const n = pendingSave.andNew; setPendingSave(null); void save(n, true); } });
  const save = async (andNew = false, payChosen = false) => {
    if (h && !h.doc_type_id) { setErr(new Error(NO_TYPE_MSG)); return; }
    if (!h || busy || ro || !can(id ? 'edit' : 'add')) return;
    if (!h.party) { setErr(new Error('เลือกลูกค้า (ช่องรหัสลูกค้า กด F4 ค้นหา)')); return; }
    if (!Object.keys(deps).length) { setErr(new Error('เลือกใบมัดจำที่จะคืนอย่างน้อย 1 ใบ (แท็บมัดจำที่คืน)')); setTab('deposits'); return; }
    if (rt.hasVat && !h.remark.trim()) { setErr(new Error('คืนมัดจำที่มีภาษีมูลค่าเพิ่ม = ใบลดหนี้ ต้องระบุเหตุผล — ป้อนเหตุผลในช่อง "เหตุผลที่ลดหนี้" เช่น ยกเลิกสัญญา คืนเงินมัดจำ')); return; }
    if (!payChosen && needsPay()) { setPayAsk({ next: 'save', andNew }); return; }
    setErr(null); setBusy(true);
    try {
      const body = bodyOf()!;
      const r = id ? await api.put<{ id: string; doc_no: string; journal_id?: string | null }>(`/api/v1/${K.path}/${id}`, body) : await api.post<{ id: string; doc_no: string; journal_id?: string | null }>(`/api/v1/${K.path}`, body);
      toast(r.journal_id ? `บันทึก${K.label} ${r.doc_no} แล้ว — ลงบัญชีแล้ว` : `บันทึก${K.label} ${r.doc_no} แล้ว (ไม่ลงบัญชี)`);
      setDirty(false); setPayOk(''); if (id) ed.lock();
      qc.invalidateQueries({ queryKey: [K.path] }); qc.invalidateQueries({ queryKey: ['deposits-open'] }); qc.invalidateQueries({ queryKey: ['ar-deposits'] }); qc.invalidateQueries({ queryKey: ['doc-journal', r.id] });
      if (andNew) { reset(); nav(`${K.route}/new`, { replace: true }); }
      else if (!id) { nav(`${K.route}/${r.id}`, { replace: true }); setH(null); }
      else { await qc.refetchQueries({ queryKey: [K.path, 'one', id] }); setH(null); }
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const cancelDoc = async () => {
    try { await api.post(`/api/v1/${K.path}/${id}/cancel`, { reason }); toast('ยกเลิกเอกสารแล้ว — ยอดมัดจำกลับเป็นคงเหลือ'); setAskCancel(false); qc.invalidateQueries({ queryKey: [K.path] }); qc.invalidateQueries({ queryKey: ['deposits-open'] }); nav(K.route); }
    catch (e) { setAskCancel(false); setErr(e); }
  };
  const cancelled = cur.data?.doc_status === 'C';
  useHotkeys({ F9: () => save(), 'Ctrl+S': () => save(), 'Ctrl+Enter': () => save(true), F6: () => setTab('deposits'), F7: () => setTab('pay'),
    'Alt+C': id && can('cancel') && !cancelled ? () => setAskCancel(true) : undefined,
    Escape: () => { if (!dirty || window.confirm('มีการแก้ไขที่ยังไม่บันทึก — ออกโดยไม่บันทึก?')) nav(K.route); } }, []);
  const docNo = id ? cur.data?.doc_no : dn.value ?? (tCur ? `${tCur.code}**NEW**` : '');
  return (
    <div className={cx('page', tColor && 'book-colored', cancelled && 'doc-cancelled')} data-tone="sales" style={bookStyle(tColor)}>
      <div className="doc-title"><p className="eyebrow">ขาย › {K.label}</p><h1>{docNo}</h1><CancelStamp show={cancelled} reason={(cur.data as { cancel_reason?: string | null } | undefined)?.cancel_reason} /><SourceStamp doc={cur.data as Parameters<typeof SourceStamp>[0]['doc']} />{tCur && <span className="book-pill" title="ประเภทเอกสาร">{!id ? 'กำลังบันทึก: ' : ''}{tCur.code} {tCur.name_th}</span>}
        <span className="doc-state"><DocBranch value={br.value} onChange={(v) => { br.set(v); setDirty(true); }} disabled={ro} /> {cancelled ? <Pill tone="x">ยกเลิก</Pill> : id ? <Pill tone="n">ลงบัญชีแล้ว</Pill> : <Pill tone="m">ใหม่ — ยังไม่บันทึก</Pill>}{dirty && <Pill tone="c">มีการแก้ไขที่ยังไม่บันทึก</Pill>}{ed.locked && !roBase && <Pill tone="n">ดูอย่างเดียว — กด แก้ไข (Alt+E)</Pill>}
          {rt.hasVat && <Pill tone="m">ใบลดหนี้ (มัดจำมี VAT)</Pill>}{h?.party && Object.keys(deps).length > 0 && !t.ok && !ro && <Pill tone="d">ยอดเงินไม่เรียบร้อย</Pill>}</span></div>
      <div className="toolbar">
        <button onClick={() => { if (!dirty || window.confirm('ทิ้งการแก้ไข?')) { reset(); nav(`${K.route}/new`); } }}>+ ใหม่</button>
        <button className="primary" disabled={busy || ro} onClick={() => save()}>บันทึก <kbd>F9</kbd></button>
        {ed.editButton}
        <button disabled={busy || ro} onClick={() => save(true)}>บันทึก+ใหม่</button>
        <button disabled={!id || cancelled || !can('cancel')} onClick={() => setAskCancel(true)}>ยกเลิกเอกสาร</button>
        <DocActions kind="doc" id={id} dirty={dirty} menu={K.menu} del={{ cancelled, cancelUrl: `/api/v1/${K.path}/${id}/cancel`, listPath: K.route }} />
        <button onClick={() => nav(K.route)}>รายการ <kbd>Esc</kbd></button>
      </div>
      <DocTypeTabs types={defs.data?.types} value={h?.doc_type_id ?? ''} locked={!!id} onChange={(v) => set({ doc_type_id: v })} />
      <TypeNotice show={!id && !!h && !h.doc_type_id} />
      {ed.dialog}
      <ErrorBox error={err ?? cur.error} />
      {payAsk && h && <PayChoiceDialog direction="P" due={t.due} other={t.other} onChoose={choosePay} onClose={() => setPayAsk(null)} />}
      {h && <div onKeyDown={(e) => navKey(e, () => (needsPay() ? setPayAsk({ next: 'confirm', andNew: false }) : ed.end()))}>
        <div className="head-grid trade-head">
          <div className="col">
            <Field label="รหัสลูกค้า" req hint="เลือกลูกค้าที่มีเงินมัดจำคงเหลือ"><SearchPick<{ id: string; code: string; name: string; tax_id?: string | null }> endpoint="/api/v1/customers" value={h.party} required disabled={ro || !!id} autoFocus={!id}
              label={(r: { name: string }) => r.name} describe={(r: { tax_id?: string | null }) => r.tax_id ?? ''} onPick={(r: { id: string; code: string; name: string } | null) => pickParty(r)} /></Field>
            <Field label="อ้างอิง/หมายเหตุสั้น" hint="เช่น ย้ายออกห้อง 101 วันที่ 31/07/2569"><input value={h.your_ref} maxLength={60} disabled={ro} onChange={(e) => set({ your_ref: e.target.value })} /></Field>
            <Field label="พนักงาน"><AddWrap kind="slm"><select value={h.salesperson_id} disabled={ro} onChange={(e) => set({ salesperson_id: e.target.value })}><option value="">—</option>{slms.data?.filter((x) => x.status === 'A' || x.id === h.salesperson_id).map((x) => <option key={x.id} value={x.id}>{x.code} {x.name}</option>)}</select></AddWrap></Field>
          </div>
          <div className="col">
            {dn.field}
            <Field label="วันที่คืนเงิน" req><DateInput value={h.doc_date} disabled={ro} onChange={(v) => set({ doc_date: v })} /></Field>
            <Field label="แผนก"><AddWrap kind="dept"><select value={h.department_id} disabled={ro} onChange={(e) => set({ department_id: e.target.value })}><option value="">—</option>{depts.data?.filter((x) => x.status === 'A' || x.id === h.department_id).map((x) => <option key={x.id} value={x.id}>{x.code} {x.name_th}</option>)}</select></AddWrap></Field>
          </div>
        </div>
        <Tabs active={tab} onChange={setTab} tabs={[{ key: 'deposits', label: 'มัดจำที่คืน', badge: Object.keys(deps).length || undefined }, { key: 'pay', label: 'จ่ายโดยอื่น ๆ (โอน/เช็ค)', badge: pays.length || undefined },
          { key: 'gl', label: id && ro ? 'ใบสำคัญที่ลงบัญชี' : 'ตัวอย่างการลงบัญชี' }]} />
        {tab === 'deposits' && <>
          <p className="hint">ติ๊กใบรับเงินมัดจำที่จะคืน (ค่าเริ่มต้น = ยอดคงเหลือ แก้ยอดได้ไม่เกินคงเหลือ) · ค่าเช่า/ค่าเสียหายที่หักจากมัดจำ ให้ทำที่ใบเสร็จรับเงิน แท็บหักเงินมัดจำ ก่อนคืนส่วนที่เหลือ · มัดจำที่มี VAT คืนได้ = ใบลดหนี้ ลดภาษีขาย (ต้องป้อนเหตุผล) · มัดจำมี/ไม่มี VAT หรือประเภทราคาต่างกัน แยกเป็นใบคืนเงินมัดจำคนละใบ</p>
          <DepositPickTable partyId={h.party?.id} ownId={id} picks={deps} setPicks={setDeps} readOnly={ro} verb="คืน" keep={dirty} onDirty={() => setDirty(true)} saved={dirty ? undefined : savedRefundVat(cur.data?.deposits)} />
        </>}
        {tab === 'pay' && <PaymentsTable pays={pays} setPays={setPays} direction="P" partyId={null} readOnly={ro} payDate={h.doc_date} rest={!h.cash ? t.cash : ''} onDirty={() => setDirty(true)} />}
        {tab === 'gl' && <PostingTab id={id} path={K.path} editing={!ro} bodyOf={bodyOf} />}
        <div className="trade-foot">
          <Field label={rt.hasVat ? 'เหตุผลที่ลดหนี้' : 'หมายเหตุ'} req={rt.hasVat} hint={rt.hasVat ? 'พิมพ์ในใบลดหนี้ เช่น ยกเลิกสัญญา คืนเงินมัดจำ' : undefined}>
            <textarea rows={2} value={h.remark} maxLength={2000} disabled={ro} required={rt.hasVat} aria-invalid={rt.hasVat && !h.remark.trim() ? true : undefined} onChange={(e) => set({ remark: e.target.value })} /></Field>
          <table className="totals-table"><tbody>
            {rt.hasVat && <><tr><td>มูลค่าก่อน VAT ที่ลด</td><td className="r"><Money v={rt.base.toFixed(2)} /></td></tr><tr><td>ภาษีขายที่ลด</td><td className="r"><Money v={rt.vat.toFixed(2)} /></td></tr></>}
            <tr className="grand"><td>{rt.hasVat ? 'ยอดคืนเงิน (รวม VAT)' : 'ยอดคืนเงินมัดจำ'}</td><td className="r"><Money v={total} /></td></tr>
            <tr><td><a href="#pay" onClick={(e) => { e.preventDefault(); setTab('pay'); }}>จ่ายโดยอื่น ๆ (โอน/เช็ค)</a></td><td className="r"><Money v={t.other} /></td></tr>
            <tr><td>จ่ายเป็นเงินสด</td><td><MoneyInput value={h.cash} disabled={ro} placeholder={fmt(t.cash)} onChange={(v) => set({ cash: v })} aria-label="เงินสด" /></td></tr>
            {!t.ok && d(total).gt(0) && <tr><td colSpan={2} className="bad small">{d(t.cash).lt(0) ? 'จ่ายโดยวิธีอื่นมากกว่ายอดคืน — ลดยอดในแท็บจ่ายโดยอื่น ๆ' : `ยอดคืนต้องเท่ากับยอดจ่ายจริง ต่าง ${fmt(t.diff)} — ล้างช่องเงินสดให้คำนวณเอง`}</td></tr>}
          </tbody></table>
        </div>
      </div>}
      <KeyHints keys={[['Enter', 'ช่องถัดไป'], ['Alt+E', 'แก้ไขเอกสารที่บันทึกแล้ว'], ['F4', 'ค้นหาลูกค้า'], ['F6', 'มัดจำที่คืน'], ['F7', 'จ่ายโดยอื่น'], ['F9', 'บันทึก'], ['Ctrl+Enter', 'บันทึก+ใหม่'], ['Alt+C', 'ยกเลิกเอกสาร'], ['Esc', 'กลับรายการ']]} />
      {askCancel && <Confirm danger title="ยกเลิกเอกสาร" text={<>ยกเลิก <b>{cur.data?.doc_no}</b>? เอกสารและใบสำคัญจะเป็นสถานะยกเลิก (ไม่ลบ) · ยอดมัดจำกลับเป็นคงเหลือ · เช็คจ่ายออกจากทะเบียน</>} okText="ยกเลิกเอกสาร" onClose={() => setAskCancel(false)} onOk={cancelDoc}>
        <Field label="เหตุผลที่ยกเลิก" req><ReasonInput value={reason} onChange={setReason} /></Field>
      </Confirm>}
    </div>
  );
}
