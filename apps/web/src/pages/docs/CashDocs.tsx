import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CASH_KINDS, computeDoc, d, dueDate, fmt, settlementTotals, todayIso, wht50FormOf, type CashKind } from '@buddy/core';
import { api } from '../../api';
import { useCan, useSession } from '../../session';
import { focusAfterTable, SearchPick } from '../../components/LkSelect';
import { Confirm, cx, DateInput, DateText, ErrorBox, Field, KeyHints, Money, MoneyInput, navKey, PageHead, Pill, Tabs, toast, useHotkeys } from '../../ui';
import { useDocEdit } from '../../components/DocEdit';
import { DocLink } from '../../components/DocLink';
import { useDocNo } from '../../components/DocNo';
import { AiBillButton, type AiBillResult } from '../../components/AiBill';
import { DocActions } from '../../components/DocPrint';
import { DocJournalTab } from './TradeDocs';
import { nextKey, PaymentsTable, paysBody, paysFrom, WhtTable, whtsBody, whtsFrom, type Pay, type Wht } from './MoneyParts';
import { DocTypeTabs, initialType, NO_TYPE_MSG, TypeNotice, useTypeTabs } from '../../components/DocTypeTabs';
import { bookStyle, typeColorIn } from '../../bookColor';
import { DocVatTab, VatCheckAfterSave, vatTabLabel } from '../../components/DocTaxTabs';

const kindOf = (path: string) => CASH_KINDS.find((k) => k.path === path)!;
const partyEndpoint = (K: CashKind) => (K.party === 'customer' ? '/api/v1/customers' : '/api/v1/suppliers');
const partyWord = (K: CashKind) => (K.party === 'customer' ? 'ลูกค้า' : 'ผู้จำหน่าย');
const rp = (K: CashKind) => (K.direction === 'R' ? 'รับ' : 'จ่าย');
const TONE = (K: CashKind) => (K.module === 'AR' ? 'sales' : 'purchase');
const num = (v: unknown) => (v === null || v === undefined || v === '' ? '' : d(v as string).toString());

/* ---------------------------------------------------------------- รายการเอกสาร */
interface ListRow { id: string; doc_no: string; doc_date: string; due_date: string | null; party_name: string | null; party_code: string | null; ref_no: string | null; amount: string; vat_amount: string; net_amount: string; wht_amount: string; doc_status: string; remaining: string | null }
export function CashListPage({ path }: { path: string }) {
  const K = kindOf(path);
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
  useHotkeys({ Insert: can('add') ? () => nav(tt.newUrl(`${K.route}/new`)) : undefined }, [tt.tab, ]);
  const total = list.data?.rows.filter((r) => r.doc_status !== 'C').reduce((s, r) => s.plus(d(r.net_amount)), d(0));
  return (
    <div className="page" data-tone={TONE(K)}>
      <PageHead eyebrow={`${K.module === 'AR' ? 'ขาย' : 'ซื้อ'} › ${K.label}`} title={K.label}
        lead={K.deposit ? `${rp(K)}เงินมัดจำล่วงหน้า แล้วนำไปหักในบิล${K.module === 'AR' ? 'ขาย' : 'ซื้อ'} (ประเภทราคาต้องเหมือนกัน) · บันทึกแล้วลงบัญชีทันที · ใบที่หักในบิลแล้วยกเลิกไม่ได้`
          : `${K.module === 'AR' ? 'รายได้' : 'ค่าใช้จ่าย'}ที่ไม่ใช่การ${K.module === 'AR' ? 'ขาย' : 'ซื้อ'}สินค้า ${rp(K)}เงินทันที ไม่ตั้ง${K.module === 'AR' ? 'ลูกหนี้' : 'เจ้าหนี้'} · ไม่ระบุ${partyWord(K)}ได้ · บันทึกแล้วลงบัญชีทันที`}
        actions={can('add') && <button className={cx('primary', tt.color && 'book-btn')} style={bookStyle(tt.color)} onClick={() => nav(tt.newUrl(`${K.route}/new`))}>+ {K.label} {tt.cur ? `${tt.cur.code} ` : ''}<kbd>Ins</kbd></button>} />
      {tt.tabs()}
      <div className="toolbar">
        <input type="search" autoFocus placeholder={`ค้นหาเลขที่ ${partyWord(K)} หรืออ้างอิง`} value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหาเอกสาร" />
        <label>ตั้งแต่ <DateInput value={from} onChange={setFrom} /></label>
        <label>ถึง <DateInput value={to} onChange={setTo} /></label>
        <select value={status} onChange={(e) => setStatus(e.target.value as 'N')} aria-label="สถานะ"><option value="all">ทุกสถานะ</option><option value="N">ปกติ</option><option value="C">ยกเลิก</option></select>
        <span className="muted small">{list.data ? `${list.data.rows.length.toLocaleString()} จาก ${list.data.total.toLocaleString()} ใบ` : ''}</span>
      </div>
      <ErrorBox error={list.error} />
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th style={{ width: 130 }}>เลขที่</th><th style={{ width: 110 }}>วันที่</th><th style={{ width: 100 }}>รหัส</th><th>{partyWord(K)}</th>{K.module === 'AP' && <th style={{ width: 120 }}>เลขที่บิล</th>}
            <th className="r" style={{ width: 120 }}>ภาษี</th><th className="r" style={{ width: 140 }}>ยอดรวมทั้งสิ้น</th>{K.deposit ? <th className="r" style={{ width: 130 }}>มัดจำคงเหลือ</th> : <th className="r" style={{ width: 120 }}>ภาษีหัก ณ ที่จ่าย</th>}<th style={{ width: 80 }}>สถานะ</th></tr></thead>
          <tbody>
            {list.data?.rows.map((r) => (
              <tr key={r.id} className={cx('row-open', r.doc_status === 'C' && 'cancelled')} tabIndex={0} onClick={() => nav(`${K.route}/${r.id}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`${K.route}/${r.id}`)}>
                <td className="mono">{r.doc_no}</td><td><DateText v={r.doc_date} /></td><td className="mono">{r.party_code}</td><td>{r.party_name}</td>{K.module === 'AP' && <td className="mono">{r.ref_no}</td>}
                <td className="r"><Money v={r.vat_amount} blankZero /></td><td className="r"><Money v={r.net_amount} /></td>
                {K.deposit ? <td className="r"><Money v={r.remaining} blankZero /></td> : <td className="r"><Money v={r.wht_amount} blankZero /></td>}
                <td>{r.doc_status === 'C' ? <Pill tone="x">ยกเลิก</Pill> : <Pill tone="n">ปกติ</Pill>}</td>
              </tr>
            ))}
            {list.data && !list.data.rows.length && <tr><td colSpan={9} className="empty">ไม่มีเอกสารในช่วงนี้ — กด Ins เพื่อเพิ่ม</td></tr>}
          </tbody>
          {!!list.data?.rows.length && <tfoot><tr><td colSpan={K.module === 'AP' ? 6 : 5} className="r">รวม (ไม่รวมที่ยกเลิก)</td><td className="r"><b><Money v={total?.toFixed(2)} /></b></td><td colSpan={2} /></tr></tfoot>}
        </table>
      </div>
      <KeyHints keys={[['Ins', `เพิ่ม${K.label}`], ['คลิก/Enter', 'เปิดเอกสาร']]} />
    </div>
  );
}

/* ---------------------------------------------------------------- หน้าเอกสาร */
interface Line { key: number; item_id: string; item_code: string; description: string; amount: string }
interface Head { doc_type_id: string; doc_date: string; party: { id: string; code: string; name?: string | null } | null; party_name: string; your_ref: string; ref_no: string; ref_date: string;
  department_id: string; salesperson_id: string; credit_days: string; price_type: '0' | '1' | '2'; vat_rate: string; remark: string; wht: string; cash: string; whtForm: 'S03' | 'S53'; whtRate: string }
interface Detail extends Record<string, unknown> { doc_no: string; doc_status: string; editable: boolean; remaining: string | null;
  lines: Array<{ item_id: string | null; item_code: string | null; description: string | null; amount: string }>; used_by: Array<{ id: string; doc_no: string; doc_date: string; doc_class: string; amount: string }>;
  payments: Parameters<typeof paysFrom>[0]; wht: Parameters<typeof whtsFrom>[0] }

export function CashFormPage({ path }: { path: string }) {
  const K = kindOf(path);
  const { id: routeId } = useParams();
  const id = routeId && routeId !== 'new' ? routeId : null;
  const nav = useNavigate();
  const qc = useQueryClient();
  const can = useCan(K.menu);
  const { me } = useSession();
  const defs = useQuery({ queryKey: ['trade-defaults', K.cls], queryFn: () => api.get<{ types: Array<{ id: string; code: string; name_th: string; price_type: string | null; vat_rate: string | null }>; vat_rate: number; price_type: string }>(`/api/v1/trade-defaults/${K.cls}`) });
  const depts = useQuery({ queryKey: ['departments'], queryFn: () => api.get<Array<{ id: string; code: string; name_th: string; status: string }>>('/api/v1/departments') });
  const slms = useQuery({ enabled: K.module === 'AR', queryKey: ['salespersons'], queryFn: () => api.get<Array<{ id: string; code: string; name: string; status: string }>>('/api/v1/salespersons') });
  const cur = useQuery({ enabled: !!id, queryKey: [K.path, 'one', id], queryFn: () => api.get<Detail>(`/api/v1/${K.path}/${id}`), staleTime: 0 });
  const [h, setH] = useState<Head | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [pays, setPays] = useState<Pay[]>([]);
  const [whts, setWhts] = useState<Wht[]>([]);
  const [tab, setTab] = useState('lines');
  const [vatCheck, setVatCheck] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [askCancel, setAskCancel] = useState(false);
  const [reason, setReason] = useState('');
  const [dirty, setDirty] = useState(false);
  const date0 = me?.work_date ?? todayIso();
  const blankLine = (): Line => ({ key: nextKey(), item_id: '', item_code: '', description: '', amount: '' });
  if (!h && !id && defs.data) {
    const t = initialType(defs.data.types);
    setH({ doc_type_id: t?.id ?? '', doc_date: date0, party: null, party_name: '', your_ref: '', ref_no: '', ref_date: '', department_id: '', salesperson_id: '', credit_days: '',
      price_type: (t?.price_type || defs.data.price_type || '2') as Head['price_type'], vat_rate: num(t?.vat_rate ?? defs.data.vat_rate), remark: '', wht: '', cash: '', whtForm: 'S53', whtRate: '3' });
    setLines([blankLine()]);
  }
  if (!h && id && cur.data) {
    const c = cur.data as Record<string, string | null>;
    const pid = c.customer_id ?? c.supplier_id;
    setH({ doc_type_id: c.doc_type_id!, doc_date: String(c.doc_date).slice(0, 10), party: pid ? { id: pid, code: c.party_code ?? '', name: c.party_name } : null, party_name: pid ? '' : c.party_name ?? '',
      your_ref: c.your_ref ?? '', ref_no: c.ref_no ?? '', ref_date: c.ref_date ? String(c.ref_date).slice(0, 10) : '', department_id: c.department_id ?? '', salesperson_id: c.salesperson_id ?? '',
      credit_days: c.credit_days === null || c.credit_days === undefined ? '' : String(c.credit_days), price_type: (c.price_type ?? '2') as Head['price_type'], vat_rate: num(c.vat_rate), remark: c.remark ?? '',
      wht: K.whtEntries ? '' : num(c.wht_amount), cash: num(c.cash_amount), whtForm: 'S53', whtRate: '3' });
    setLines(cur.data.lines.map((l) => ({ key: nextKey(), item_id: l.item_id ?? '', item_code: l.item_code ?? '', description: l.description ?? '', amount: num(l.amount) })));
    setPays(paysFrom(cur.data.payments));
    setWhts(whtsFrom(cur.data.wht));
  }
  /** เอกสารที่ย้ายมาจาก Express โดยไม่มีบรรทัดรายการ (Express เก็บแต่ยอด) — แสดงยอดตามเอกสาร และแก้ไขไม่ได้ */
  const noLines = !!id && !!cur.data && cur.data.lines.length === 0 && !d(String((cur.data as Record<string, unknown>).net_amount ?? 0)).isZero();
  const storedCalc = <T extends object>(c: T): T => {
    const s = cur.data as Record<string, string | null>;
    const v = (k: string) => d(s[k] ?? 0).toFixed(2);
    return { ...c, amount: v('amount'), discount_amount: v('discount_amount'), amount_after_discount: v('amount_after_discount'), deposit_amount: v('deposit_amount'), zero_rate_amount: v('zero_rate_amount'),
      taxable_amount: v('taxable_amount'), vat_amount: v('vat_amount'), net_amount: v('net_amount'), errors: [] };
  };
  const roBase = !!id && (!cur.data?.editable || !can('edit') || noLines);
  const ed = useDocEdit({ id: id ?? undefined, allowed: !!id && !roBase, dirty, onSave: (n) => void save(!!n), onDiscard: () => { setH(null); setDirty(false); } });
  const readOnly = roBase || ed.locked;
  const ro = readOnly;
  const set = (p: Partial<Head>) => { setH((x) => ({ ...x!, ...p })); setDirty(true); };
  const setLine = (k: number, p: Partial<Line>) => { setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...p } : l))); setDirty(true); };
  const used = lines.filter((l) => (K.lines === 'code' ? l.item_id : l.description || l.amount));

  const calc0 = h && computeDoc({ price_type: h.price_type, vat_rate: h.vat_rate || 0, lines: used.map((l) => ({ qty: 1, unit_price: l.amount || 0 })) });
  const calc = calc0 && noLines ? storedCalc(calc0) : calc0;
  const whtAmount = K.whtEntries ? whts.reduce((s, w) => s.plus(d(w.tax_amount || 0)), d(0)).toFixed(2) : h?.wht || '0';
  const t = settlementTotals({ settlements: [calc?.net_amount ?? '0'], wht: whtAmount, payments: pays.filter((p) => p.payment_method_id).map((p) => p.amount || 0), cash: h?.cash ? h.cash : null });
  const base = calc ? d(calc.net_amount).minus(d(calc.vat_amount)).toFixed(2) : '0';

  const pickParty = async (p: { id: string; code: string; name: string } | null) => {
    if (!p) return set({ party: null });
    const x = await api.get<Record<string, string | null>>(`${partyEndpoint(K)}/${p.id}`);
    set({ party: p, party_name: '', ...(K.module === 'AR' ? { salesperson_id: x.salesperson_id ?? '' } : {}), ...(K.deposit && x.credit_days ? { credit_days: String(x.credit_days) } : {}),
      whtForm: wht50FormOf(x.wht_form, x.tax_id) === '3' ? 'S03' : 'S53', whtRate: x.wht_rate && !d(x.wht_rate).isZero() ? d(x.wht_rate).toString() : '3' });
  };
  /** เติมร่างจากบิลที่ AI อ่าน (T7.7): ไม่พบผู้จำหน่าย = ใส่เป็นชื่อ · รายการไม่พบรหัสค่าใช้จ่าย = เลือกเอง */
  const applyBill = async (r: AiBillResult) => {
    if (r.supplier) await pickParty({ id: r.supplier.id, code: r.supplier.code, name: r.supplier.name });
    else if (r.bill.supplier.name) set({ party: null, party_name: r.bill.supplier.name.slice(0, 200) });
    set({ price_type: r.bill.price_type, vat_rate: r.bill.vat_rate, ref_no: r.bill.doc_no, ref_date: r.bill.doc_date ?? '' });
    setLines((ls) => [...ls.filter((l) => l.item_id), ...r.lines.map((l) => ({ ...blankLine(), item_id: l.item?.id ?? '', item_code: l.item?.code ?? '', description: l.description, amount: l.amount }))]);
    const missing = r.lines.filter((l) => !l.item).length;
    toast(`เติมจากบิลแล้ว${missing ? ` — เลือกรหัสค่าใช้จ่ายอีก ${missing} บรรทัด` : ''} · ตรวจยอดกับบิลก่อนบันทึก`);
  };
  /** เลือกประเภทจากแถบ (ใบใหม่) — ค่าเริ่มต้นตามประเภทนั้น */
  const pickType = (v: string) => { const t = defs.data?.types.find((x) => x.id === v); set({ doc_type_id: v, ...(t?.price_type ? { price_type: t.price_type as Head['price_type'] } : {}), ...(t?.vat_rate != null ? { vat_rate: num(t.vat_rate) } : {}) }); };
  const tColor = typeColorIn(defs.data?.types, h?.doc_type_id);
  const tCur = defs.data?.types.find((x) => x.id === h?.doc_type_id);
  const dn = useDocNo(tCur, id ? cur.data?.doc_no : undefined, { disabled: ro, resetKey: h ? 'on' : 'off' });
  const save = async (andNew = false) => {
    if (h && !h.doc_type_id) { setErr(new Error(NO_TYPE_MSG)); return; }
    if (!h || busy || ro || !can(id ? 'edit' : 'add')) return;
    setErr(null); setBusy(true);
    const body = { doc_type_id: h.doc_type_id, doc_no: dn.value, doc_date: h.doc_date, party_id: h.party?.id ?? null, party_name: h.party ? null : h.party_name || null, your_ref: h.your_ref || null,
      ref_no: h.ref_no || null, ref_date: h.ref_date || null, department_id: h.department_id || null, salesperson_id: h.salesperson_id || null, credit_days: h.credit_days === '' ? null : Number(h.credit_days),
      price_type: h.price_type, vat_rate: h.vat_rate || '0', remark: h.remark || null, wht_amount: K.whtEntries ? '0' : h.wht || '0', cash_amount: h.cash === '' ? null : h.cash,
      lines: used.map((l) => ({ item_id: K.lines === 'code' ? l.item_id || null : null, description: l.description || null, amount: l.amount || '0' })),
      payments: paysBody(pays), wht: K.whtEntries ? whtsBody(whts) : [] };
    try {
      const r = id ? await api.put<{ id: string; doc_no: string }>(`/api/v1/${K.path}/${id}`, body) : await api.post<{ id: string; doc_no: string }>(`/api/v1/${K.path}`, body);
      toast(`บันทึก${K.label} ${r.doc_no} แล้ว — ลงบัญชีแล้ว`);
      setDirty(false); if (id) ed.lock();
      qc.invalidateQueries({ queryKey: [K.path] }); qc.invalidateQueries({ queryKey: ['doc-journal', r.id] }); qc.invalidateQueries({ queryKey: ['doc-vat'] });
      if (K.module === 'AP' && calc && !d(calc.vat_amount).isZero()) setVatCheck(r.id);   // มีภาษีซื้อ: ตรวจรายการในแฟ้มภาษีซื้อทันที
      if (andNew) { setH(null); setLines([]); setPays([]); setWhts([]); nav(`${K.route}/new`, { replace: true }); }
      else if (!id) { nav(`${K.route}/${r.id}`, { replace: true }); setH(null); }
      else { await qc.refetchQueries({ queryKey: [K.path, 'one', id] }); setH(null); }
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const cancelDoc = async () => {
    try { await api.post(`/api/v1/${K.path}/${id}/cancel`, { reason }); toast('ยกเลิกเอกสารแล้ว'); setAskCancel(false); qc.invalidateQueries({ queryKey: [K.path] }); nav(K.route); }
    catch (e) { setAskCancel(false); setErr(e); }
  };
  const addLine = () => { setLines((ls) => [...ls, blankLine()]); };
  useHotkeys({ F9: () => save(), 'Ctrl+S': () => save(), 'Ctrl+Enter': () => save(true), F7: () => setTab('pay'), 'Ctrl+F7': id ? () => setTab('vat') : undefined, 'Ctrl+F10': K.whtEntries ? () => setTab('wht') : undefined, 'Ctrl+Insert': ro ? undefined : addLine,
    'Alt+C': id && can('cancel') && cur.data?.doc_status !== 'C' ? () => setAskCancel(true) : undefined,
    Escape: () => { if (!dirty || window.confirm('มีการแก้ไขที่ยังไม่บันทึก — ออกโดยไม่บันทึก?')) nav(K.route); } }, []);
  const dtCode = defs.data?.types.find((x) => x.id === h?.doc_type_id);
  const cancelled = cur.data?.doc_status === 'C';
  const docNo = id ? cur.data?.doc_no : dn.value ?? (dtCode ? `${dtCode.code}**NEW**` : '');
  return (
    <div className={cx('page', tColor && 'book-colored')} data-tone={TONE(K)} style={bookStyle(tColor)}>
      <div className="doc-title"><p className="eyebrow">{K.module === 'AR' ? 'ขาย' : 'ซื้อ'} › {K.label}</p><h1>{docNo}</h1>{tCur && <span className="book-pill" title="ประเภทเอกสาร">{!id ? 'กำลังบันทึก: ' : ''}{tCur.code} {tCur.name_th}</span>}
        <span className="doc-state">{cancelled ? <Pill tone="x">ยกเลิก</Pill> : id ? <Pill tone="n">ลงบัญชีแล้ว</Pill> : <Pill tone="m">ใหม่ — ยังไม่บันทึก</Pill>}{dirty && <Pill tone="c">มีการแก้ไขที่ยังไม่บันทึก</Pill>}{ed.locked && !roBase && <Pill tone="n">ดูอย่างเดียว — กด แก้ไข (Alt+E)</Pill>}
          {K.deposit && id && cur.data?.remaining != null && <Pill tone={d(cur.data.remaining).isZero() ? 'd' : 'm'}>มัดจำคงเหลือ {fmt(cur.data.remaining)}</Pill>}</span></div>
      <div className="toolbar">
        <button onClick={() => { if (!dirty || window.confirm('ทิ้งการแก้ไข?')) { setH(null); setLines([]); setPays([]); setWhts([]); nav(`${K.route}/new`); } }}>+ ใหม่</button>
        <button className="primary" disabled={busy || ro} onClick={() => save()}>บันทึก <kbd>F9</kbd></button>
        {ed.editButton}
        <button disabled={busy || ro} onClick={() => save(true)}>บันทึก+ใหม่</button>
        <button disabled={!id || cancelled || !can('cancel')} onClick={() => setAskCancel(true)}>ยกเลิกเอกสาร</button>
        <DocActions kind="doc" id={id} dirty={dirty} menu={K.menu} />
        {K.cls === 'OE' && !ro && h && <AiBillButton target={K.path} onApply={applyBill} />}
        <button onClick={() => nav(K.route)}>รายการ <kbd>Esc</kbd></button>
      </div>
      <DocTypeTabs types={defs.data?.types} value={h?.doc_type_id ?? ''} locked={!!id} onChange={pickType} />
      <TypeNotice show={!id && !!h && !h.doc_type_id} />
      {ed.dialog}
      <ErrorBox error={err ?? cur.error} />
      {h && <div onKeyDown={(e) => navKey(e, ed.end)}>
        <div className="head-grid trade-head">
          <div className="col">
            <Field label={`รหัส${partyWord(K)}`} req={K.partyRequired} hint={K.partyRequired ? undefined : `${K.module === 'AR' ? 'รายได้' : 'ค่าใช้จ่าย'}เล็กน้อยไม่ต้องระบุ — ป้อนชื่อด้านล่างได้`}>
              <SearchPick<{ id: string; code: string; name: string; tax_id?: string | null }> endpoint={partyEndpoint(K)} value={h.party} disabled={ro} autoFocus={!id} label={(r: { name: string }) => r.name} describe={(r: { tax_id?: string | null }) => r.tax_id ?? ''}
                onPick={(r: { id: string; code: string; name: string } | null) => pickParty(r)} /></Field>
            {!h.party && !K.partyRequired && <Field label="ชื่อ (ไม่มีรหัส)"><input value={h.party_name} maxLength={200} disabled={ro} onChange={(e) => set({ party_name: e.target.value })} /></Field>}
            {K.module === 'AP' && <Field label="เลขที่บิล / ลงวันที่" hint="ใบกำกับภาษีที่ได้รับจากผู้จำหน่าย"><div className="pair"><input value={h.ref_no} maxLength={30} disabled={ro} onChange={(e) => set({ ref_no: e.target.value })} aria-label="เลขที่บิล" /><DateInput value={h.ref_date} disabled={ro} onChange={(v) => set({ ref_date: v })} /></div></Field>}
            <Field label={K.deposit ? 'หมายเหตุสั้น' : 'คำอธิบาย/อ้างอิง'}><input value={h.your_ref} maxLength={60} disabled={ro} onChange={(e) => set({ your_ref: e.target.value })} /></Field>
            {K.module === 'AR' && <Field label="พนักงานขาย"><select value={h.salesperson_id} disabled={ro} onChange={(e) => set({ salesperson_id: e.target.value })}><option value="">—</option>{slms.data?.filter((x) => x.status === 'A' || x.id === h.salesperson_id).map((x) => <option key={x.id} value={x.id}>{x.code} {x.name}</option>)}</select></Field>}
          </div>
          <div className="col">
            
            {dn.field}
            
            <Field label="วันที่" req><DateInput value={h.doc_date} disabled={ro} onChange={(v) => set({ doc_date: v })} /></Field>
            {K.deposit && <Field label="ครบกำหนด (วัน)" hint="ใช้ติดตามว่าตัดสินใจซื้อ/ส่งของเกินกำหนดหรือไม่"><div className="pair"><input type="number" min={0} value={h.credit_days} disabled={ro} onChange={(e) => set({ credit_days: e.target.value })} aria-label="ครบกำหนด (วัน)" /><span className="muted small" style={{ alignSelf: 'center' }}><DateText v={dueDate(h.doc_date, Number(h.credit_days || 0))} /></span></div></Field>}
            <Field label="แผนก"><select value={h.department_id} disabled={ro} onChange={(e) => set({ department_id: e.target.value })}><option value="">—</option>{depts.data?.filter((x) => x.status === 'A' || x.id === h.department_id).map((x) => <option key={x.id} value={x.id}>{x.code} {x.name_th}</option>)}</select></Field>
            <Field label="ประเภทราคา" hint={K.deposit ? 'ต้องตรงกับบิลที่จะนำมัดจำไปหัก' : undefined}><select value={h.price_type} disabled={ro} onChange={(e) => set({ price_type: e.target.value as Head['price_type'] })}><option value="0">0 ยกเว้นภาษี</option><option value="1">1 รวมภาษีแล้ว</option><option value="2">2 แยก VAT</option></select></Field>
          </div>
        </div>
        <Tabs active={tab} onChange={setTab} tabs={[{ key: 'lines', label: K.deposit ? 'รายการมัดจำ' : `รายการ${K.module === 'AR' ? 'รายได้' : 'ค่าใช้จ่าย'}`, badge: used.length || undefined },
          { key: 'pay', label: 'ชำระโดยอื่น ๆ (เช็ค/โอน)', badge: pays.length || undefined }, ...(K.whtEntries ? [{ key: 'wht', label: 'ภาษีหัก ณ ที่จ่าย', badge: whts.length || undefined }] : []),
          ...(K.deposit && id ? [{ key: 'used', label: 'หักในบิลแล้ว', badge: cur.data?.used_by.length || undefined }] : []), ...(id ? [{ key: 'vat', label: vatTabLabel(K.cls) }, { key: 'gl', label: 'ใบสำคัญที่ลงบัญชี' }] : [])]} />
        {tab === 'lines' && noLines && <div className="notebox">เอกสารนี้ย้ายมาจาก Express โดยไม่มีรายการ (Express เก็บเฉพาะยอดเงิน) — แสดงยอดตามเอกสาร · แก้ไขไม่ได้ ยกเลิกหรือดูการลงบัญชีได้ตามปกติ</div>}
        {tab === 'lines' && <div className="table-wrap lines">
          <table className="grid">
            <thead><tr><th style={{ width: 36 }}>#</th>{K.lines === 'code' && <th style={{ width: 220 }}>รหัส{K.module === 'AR' ? 'รายได้' : 'ค่าใช้จ่าย'}</th>}<th>{K.lines === 'code' ? 'รายละเอียด' : 'คำอธิบาย'}</th><th className="r" style={{ width: 160 }}>จำนวนเงิน</th><th style={{ width: 36 }} /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.key}>
                  <td className="muted">{i + 1}</td>
                  {K.lines === 'code' && <td><SearchPick endpoint="/api/v1/item-search" params={{ module: K.module, types: K.cls === 'OI' ? '4' : '5,2' }} value={l.item_id ? { id: l.item_id, code: l.item_code } : null} required={!lines.some((x) => x.item_id && x.key !== l.key)} onEmptyEnter={focusAfterTable} disabled={ro}
                    label={(r: { name_th: string }) => r.name_th} onPick={(r: { id: string; code: string; name_th: string; price_1: string | null; std_cost: string | null } | null) => setLine(l.key, r ? { item_id: r.id, item_code: r.code, description: r.name_th, amount: l.amount || num(K.module === 'AR' ? r.price_1 : r.std_cost) } : { item_id: '', item_code: '' })} aria-label={`รหัส ${i + 1}`} /></td>}
                  <td><input value={l.description} maxLength={200} disabled={ro} placeholder={K.deposit ? 'เช่น รับเงินมัดจำล่วงหน้า 10% สำหรับคอมพิวเตอร์ 1 ชุด' : ''} onChange={(e) => setLine(l.key, { description: e.target.value })} aria-label="คำอธิบาย" /></td>
                  <td><MoneyInput value={l.amount} disabled={ro} onChange={(v) => setLine(l.key, { amount: v })} aria-label="จำนวนเงิน" /></td>
                  <td>{!ro && <button type="button" className="icon-btn" tabIndex={-1} title="ลบบรรทัด" onClick={() => { setLines((ls) => ls.filter((x) => x.key !== l.key)); setDirty(true); }}>✕</button>}</td>
                </tr>
              ))}
            </tbody>
            {!ro && <tfoot><tr><td colSpan={5}><button type="button" onClick={addLine}>+ เพิ่มบรรทัด <kbd>Ctrl+Ins</kbd></button></td></tr></tfoot>}
          </table>
        </div>}
        {tab === 'pay' && <PaymentsTable pays={pays} setPays={setPays} direction={K.direction} partyId={h.party?.id ?? null} readOnly={ro} payDate={h.doc_date} rest={!h.cash ? t.cash : ''} onDirty={() => setDirty(true)} />}
        {tab === 'wht' && K.whtEntries && <WhtTable whts={whts} setWhts={setWhts} readOnly={ro} base={base} defaults={{ form: h.party ? h.whtForm : 'S03', rate: h.whtRate }} canAdd={used.length > 0} dirty={dirty} onDirty={() => setDirty(true)} />}
        {tab === 'used' && cur.data && <table className="grid"><thead><tr><th>บิล</th><th>วันที่</th><th className="r">ยอดที่หัก</th></tr></thead>
          <tbody>{cur.data.used_by.map((u) => <tr key={u.id}><td><DocLink id={u.id} no={u.doc_no} cls={u.doc_class} /></td><td><DateText v={u.doc_date} /></td><td className="r"><Money v={u.amount} /></td></tr>)}
            {!cur.data.used_by.length && <tr><td colSpan={3} className="empty">ยังไม่ได้หักในบิล — คงเหลือ <Money v={cur.data.remaining} /></td></tr>}</tbody></table>}
        {tab === 'vat' && id && <DocVatTab headerId={id} cls={K.cls} />}
        {tab === 'gl' && id && <DocJournalTab id={id} />}
        <div className="trade-foot">
          <Field label="หมายเหตุ"><textarea rows={2} value={h.remark} maxLength={2000} disabled={ro} onChange={(e) => set({ remark: e.target.value })} /></Field>
          {calc && <table className="totals-table"><tbody>
            <tr><td>จำนวนเงิน</td><td className="r"><Money v={calc.amount} /></td></tr>
            <tr><td>ภาษีมูลค่าเพิ่ม <input className="r" inputMode="decimal" value={h.vat_rate} disabled={ro || h.price_type === '0'} onChange={(e) => set({ vat_rate: e.target.value.replace(/[^\d.]/g, '') })} aria-label="อัตราภาษี" style={{ width: 60 }} /> %</td><td className="r"><Money v={calc.vat_amount} /></td></tr>
            <tr className="grand"><td>จำนวนเงินรวมทั้งสิ้น</td><td className="r"><Money v={calc.net_amount} /></td></tr>
            <tr><td>หัก {K.whtEntries ? <a href="#wht" onClick={(e) => { e.preventDefault(); setTab('wht'); }}>ภาษีหัก ณ ที่จ่าย</a> : 'ภาษีถูกหัก ณ ที่จ่าย'}</td>
              <td>{K.whtEntries ? <span className="r num" style={{ display: 'block' }}>{fmt(whtAmount)}</span> : <MoneyInput value={h.wht} disabled={ro} onChange={(v) => set({ wht: v })} aria-label="ภาษีถูกหัก ณ ที่จ่าย" />}</td></tr>
            <tr><td>ชำระโดยอื่น ๆ (เช็ค/โอน)</td><td className="r"><Money v={t.other} /></td></tr>
            <tr><td>{rp(K)}เป็นเงินสด</td><td><MoneyInput value={h.cash} disabled={ro} placeholder={fmt(t.cash)} onChange={(v) => set({ cash: v })} aria-label="เงินสด" /></td></tr>
            {calc.errors.length > 0 && <tr><td colSpan={2} className="bad small">{calc.errors[0]}</td></tr>}
            {!t.ok && used.length > 0 && <tr><td colSpan={2} className="bad small">{d(t.cash).lt(0) ? `ชำระโดยวิธีอื่นมากกว่ายอดที่ต้อง${rp(K)}` : `จำนวนเงินรวมทั้งสิ้นต้องเท่ากับยอด${rp(K)}จริง ต่าง ${fmt(t.diff)} — ล้างช่องเงินสดให้คำนวณเอง`}</td></tr>}
          </tbody></table>}
        </div>
      </div>}
      {vatCheck && <VatCheckAfterSave headerId={vatCheck} cls={K.cls} onDone={() => setVatCheck(null)} />}
      <KeyHints keys={[['Enter', 'ช่องถัดไป (ช่องสุดท้าย = ถามบันทึก)'], ['Alt+E', 'แก้ไขเอกสารที่บันทึกแล้ว'], ['F4', 'ค้นหารหัส'], ['Ctrl+Ins', 'เพิ่มบรรทัด'], ['F7', 'ชำระโดยอื่น'], ['F9', 'บันทึก'], ['Ctrl+Enter', 'บันทึก+ใหม่'], ['Alt+C', 'ยกเลิกเอกสาร'], ['Esc', 'กลับรายการ']]} />
      {askCancel && <Confirm danger title="ยกเลิกเอกสาร" text={<>ยกเลิก <b>{cur.data?.doc_no}</b>? เอกสารและใบสำคัญจะเป็นสถานะยกเลิก (ไม่ลบ) · เช็คออกจากทะเบียน{K.whtEntries ? ' · ภาษีหัก ณ ที่จ่ายยกเลิก' : ''}</>} okText="ยกเลิกเอกสาร" onClose={() => setAskCancel(false)} onOk={cancelDoc}>
        <Field label="เหตุผลที่ยกเลิก" req><input autoFocus value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></Field>
      </Confirm>}
    </div>
  );
}
