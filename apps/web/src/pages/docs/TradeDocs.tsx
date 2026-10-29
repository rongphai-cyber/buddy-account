import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { computeDoc, d, dueDate, fmt, TRADE_KINDS, todayIso, type TradeKind } from '@buddy/core';
import { api } from '../../api';
import { useCan, useSession } from '../../session';
import { LkSelect, SearchPick, useLookups } from '../../components/LkSelect';
import { Confirm, cx, DateInput, DateText, ErrorBox, Field, KeyHints, Money, navKey, PageHead, Pill, Tabs, toast, useHotkeys } from '../../ui';

const kindOf = (path: string) => TRADE_KINDS.find((k) => k.path === path)!;
const partyEndpoint = (K: TradeKind) => (K.party === 'customer' ? '/api/v1/customers' : '/api/v1/suppliers');
const partyWord = (K: TradeKind) => (K.party === 'customer' ? 'ลูกค้า' : 'ผู้จำหน่าย');
const TONE = (K: TradeKind) => (K.module === 'AR' ? 'sales' : 'purchase');

/* ---------------------------------------------------------------- รายการเอกสาร */
interface ListRow { id: string; doc_no: string; doc_date: string; due_date: string | null; party_name: string; party_code: string | null; net_amount: string; vat_amount: string; doc_status: string; gl_posted: string; ref_no: string | null; outstanding: string | null }
export function TradeListPage({ path }: { path: string }) {
  const K = kindOf(path);
  const nav = useNavigate();
  const can = useCan(K.menu);
  const { me } = useSession();
  const today = me?.work_date ?? todayIso();
  const [q, setQ] = useState('');
  const [from, setFrom] = useState(today.slice(0, 8) + '01');
  const [to, setTo] = useState(today);
  const [status, setStatus] = useState<'N' | 'C' | 'all'>('all');
  const list = useQuery({ queryKey: [K.path, q, from, to, status], queryFn: () => api.get<{ total: number; rows: ListRow[] }>(`/api/v1/${K.path}`, { q, from, to, status, limit: 500 }), placeholderData: (p) => p });
  useHotkeys({ Insert: can('add') ? () => nav(`${K.route}/new`) : undefined }, []);
  const total = list.data?.rows.filter((r) => r.doc_status !== 'C').reduce((s, r) => s.plus(d(r.net_amount)), d(0));
  return (
    <div className="page" data-tone={TONE(K)}>
      <PageHead eyebrow={`${K.module === 'AR' ? 'ขาย' : 'ซื้อ'} › ${K.label}`} title={K.label}
        lead={`บันทึกแล้วลงบัญชีทันที (ดูใบสำคัญได้ที่เอกสาร) · ยกเลิก = เปลี่ยนสถานะ ไม่ลบ · เอกสารที่${K.module === 'AR' ? 'รับ' : 'จ่าย'}ชำระแล้วแก้ไข/ยกเลิกไม่ได้`}
        actions={can('add') && <button className="primary" onClick={() => nav(`${K.route}/new`)}>+ เพิ่ม{K.label} <kbd>Ins</kbd></button>} />
      {TRADE_KINDS.filter((k) => k.menu === K.menu).length > 1 && <div className="seg kind-switch">{TRADE_KINDS.filter((k) => k.menu === K.menu).map((k) => <button key={k.path} className={cx(k.path === K.path && 'on')} onClick={() => nav(k.route)}>{k.label}</button>)}</div>}
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
          <thead><tr><th style={{ width: 130 }}>เลขที่</th><th style={{ width: 110 }}>วันที่</th><th style={{ width: 100 }}>รหัส</th><th>{partyWord(K)}</th>{K.refInvoice && <th style={{ width: 120 }}>อ้างใบกำกับ</th>}<th className="r" style={{ width: 120 }}>ภาษี</th><th className="r" style={{ width: 140 }}>ยอดรวมทั้งสิ้น</th>{!K.payments && <th className="r" style={{ width: 130 }}>ค้างชำระ</th>}<th style={{ width: 90 }}>สถานะ</th></tr></thead>
          <tbody>
            {list.data?.rows.map((r) => (
              <tr key={r.id} className={cx('row-open', r.doc_status === 'C' && 'cancelled')} tabIndex={0} onClick={() => nav(`${K.route}/${r.id}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`${K.route}/${r.id}`)}>
                <td className="mono">{r.doc_no}</td><td><DateText v={r.doc_date} /></td><td className="mono">{r.party_code}</td><td>{r.party_name}</td>{K.refInvoice && <td className="mono">{r.ref_no}</td>}
                <td className="r"><Money v={r.vat_amount} blankZero /></td><td className="r"><Money v={r.net_amount} /></td>{!K.payments && <td className="r"><Money v={r.outstanding} blankZero /></td>}
                <td>{r.doc_status === 'C' ? <Pill tone="x">ยกเลิก</Pill> : <Pill tone="n">ปกติ</Pill>}</td>
              </tr>
            ))}
            {list.data && !list.data.rows.length && <tr><td colSpan={9} className="empty">ไม่มีเอกสารในช่วงนี้ — กด Ins เพื่อเพิ่ม</td></tr>}
          </tbody>
          {!!list.data?.rows.length && <tfoot><tr><td colSpan={K.refInvoice ? 6 : 5} className="r">รวม (ไม่รวมที่ยกเลิก)</td><td className="r"><b><Money v={total?.toFixed(2)} /></b></td><td colSpan={2} /></tr></tfoot>}
        </table>
      </div>
      <KeyHints keys={[['Ins', `เพิ่ม${K.label}`], ['คลิก/Enter', 'เปิดเอกสาร']]} />
    </div>
  );
}

/** แท็บ "ใบสำคัญที่ลงบัญชี" ของเอกสาร พร้อมที่มาของบัญชีแต่ละบรรทัด (3 ชั้นของบทที่ 10) */
export function DocJournalTab({ id }: { id: string }) {
  const journal = useQuery({ queryKey: ['doc-journal', id], queryFn: () => api.get<{ journals: Array<{ id: string; voucher_no: string; book_code: string; book_name: string; doc_status: string; lines: Array<{ line_no: number; account_no: string; account_name: string; debit: string; credit: string; posting_role: string; resolved_from: string }> }> }>(`/api/v1/docs/${id}/journal`) });
  return (
    <div><ErrorBox error={journal.error} />{journal.data?.journals.map((j) => <div key={j.id} className="box">
      <p><b className="mono">{j.voucher_no}</b> สมุด {j.book_code} {j.book_name} {j.doc_status === 'C' && <Pill tone="x">ยกเลิก</Pill>}</p>
      <table className="grid"><thead><tr><th style={{ width: 110 }}>เลขที่บัญชี</th><th>ชื่อบัญชี</th><th className="r">เดบิต</th><th className="r">เครดิต</th><th style={{ width: 150 }}>ที่มาของบัญชี</th></tr></thead>
        <tbody>{j.lines.map((l) => <tr key={l.line_no}><td className="mono">{l.account_no}</td><td>{l.account_name}</td><td className="r"><Money v={l.debit} blankZero /></td><td className="r"><Money v={l.credit} blankZero /></td>
          <td className="small muted">{({ '1': 'ประเภทเอกสาร', '2': 'แฟ้มหลัก', '3': 'บัญชีเพื่อลงรายวัน', S: 'บัญชีพัก ⚠' } as Record<string, string>)[l.resolved_from] ?? ''}</td></tr>)}</tbody></table></div>)}
      {journal.data && !journal.data.journals.length && <p className="muted">ยังไม่มีใบสำคัญ (ไม่เชื่อมต่อระบบบัญชี หรือเอกสารชนิดนี้ไม่ลงบัญชี)</p>}</div>
  );
}

/* ---------------------------------------------------------------- หน้าเอกสาร */
interface ItemHit { id: string; code: string; name_th: string; item_type: string; vat_code: string | null; base_unit_id: string | null; sales_unit_id: string | null; sales_factor: string | null; purchase_unit_id: string | null; purchase_factor: string | null; price_1: string | null; price_2: string | null; price_3: string | null; price_4: string | null; price_5: string | null; std_cost: string | null }
interface Line { key: number; item_id: string; item_code: string; description: string; warehouse_id: string | null; qty: string; unit_id: string | null; factor: string; unit_price: string; discount_text: string; is_free: boolean; return_to_stock: boolean; vat_exempt: boolean }
interface Pay { key: number; payment_method_id: string; amount: string; reference_no: string }
interface Head { doc_type_id: string; doc_date: string; party: { id: string; code: string; name?: string | null } | null; bill_to: { id: string; code: string; name?: string | null } | null; party_tax_branch_no: string; your_ref: string; ref: { id: string; code: string } | null;
  department_id: string; salesperson_id: string; sales_area_code: string; ship_via_code: string; credit_days: string; price_type: '0' | '1' | '2'; vat_rate: string; vat_basis: '1' | '2'; discount_text: string; remark: string; price_level: string }
let seq = 0;
const num = (v: unknown) => (v === null || v === undefined || v === '' ? '' : d(v as string).toString());

export function TradeFormPage({ path }: { path: string }) {
  const K = kindOf(path);
  const { id: routeId } = useParams();
  const id = routeId && routeId !== 'new' ? routeId : null;
  const nav = useNavigate();
  const qc = useQueryClient();
  const can = useCan(K.menu);
  const { me } = useSession();
  const lk = useLookups('40,41,UNIT,WH');
  const defs = useQuery({ queryKey: ['trade-defaults', K.cls], queryFn: () => api.get<{ types: Array<{ id: string; code: string; name_th: string; next_no: string; price_type: string | null; vat_rate: string | null; vat_basis: string | null }>; vat_rate: number; price_type: string }>(`/api/v1/trade-defaults/${K.cls}`) });
  const depts = useQuery({ queryKey: ['departments'], queryFn: () => api.get<Array<{ id: string; code: string; name_th: string; status: string }>>('/api/v1/departments') });
  const slms = useQuery({ enabled: K.module === 'AR', queryKey: ['salespersons'], queryFn: () => api.get<Array<{ id: string; code: string; name: string; status: string }>>('/api/v1/salespersons') });
  const methods = useQuery({ enabled: !!K.payments, queryKey: ['payment-methods', K.module === 'AR' ? 'R' : 'P'], queryFn: () => api.get<Array<{ id: string; code: string; name_th: string; status: string }>>(`/api/v1/payment-methods/${K.module === 'AR' ? 'R' : 'P'}`) });
  const cur = useQuery({ enabled: !!id, queryKey: [K.path, 'one', id], queryFn: () => api.get<Record<string, unknown> & { lines: Array<Record<string, unknown>>; payments: Array<Record<string, unknown>>; settlements: Array<{ id: string; doc_no: string; doc_date: string; amount: string; doc_status: string }>; editable: boolean; doc_no: string; doc_status: string; outstanding: string | null }>(`/api/v1/${K.path}/${id}`), staleTime: 0 });
  const [h, setH] = useState<Head | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [pays, setPays] = useState<Pay[]>([]);
  const [tab, setTab] = useState('lines');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [askCancel, setAskCancel] = useState(false);
  const [reason, setReason] = useState('');
  const [dirty, setDirty] = useState(false);
  const date0 = me?.work_date ?? todayIso();
  if (!h && !id && defs.data) {
    const t = defs.data.types[0];
    setH({ doc_type_id: t?.id ?? '', doc_date: date0, party: null, bill_to: null, party_tax_branch_no: '', your_ref: '', ref: null, department_id: '', salesperson_id: '', sales_area_code: '', ship_via_code: '', credit_days: '',
      price_type: ((t?.price_type || defs.data.price_type || '2') as Head['price_type']), vat_rate: num(t?.vat_rate ?? defs.data.vat_rate), vat_basis: (t?.vat_basis === '2' ? '2' : '1'), discount_text: '', remark: '', price_level: '1' });
  }
  if (!h && id && cur.data) {
    const c = cur.data as Record<string, string | null>;
    setH({ doc_type_id: c.doc_type_id!, doc_date: String(c.doc_date).slice(0, 10), party: { id: (c.customer_id ?? c.supplier_id)!, code: c.party_code ?? '', name: c.party_name }, bill_to: c.bill_to_customer_id ? { id: c.bill_to_customer_id, code: '' } : null,
      party_tax_branch_no: c.party_tax_branch_no ?? '', your_ref: c.your_ref ?? '', ref: c.ref_no ? { id: '', code: c.ref_no } : null, department_id: c.department_id ?? '', salesperson_id: c.salesperson_id ?? '', sales_area_code: c.sales_area_code ?? '', ship_via_code: c.ship_via_code ?? '',
      credit_days: c.credit_days === null ? '' : String(c.credit_days), price_type: (c.price_type ?? '2') as Head['price_type'], vat_rate: num(c.vat_rate), vat_basis: (c.vat_basis === '2' ? '2' : '1'), discount_text: c.discount_text ?? '', remark: c.remark ?? '', price_level: '1' });
    setLines(cur.data.lines.map((l) => ({ key: ++seq, item_id: String(l.item_id), item_code: String(l.item_code ?? ''), description: String(l.description ?? ''), warehouse_id: (l.warehouse_id as string) ?? null, qty: num(l.qty), unit_id: (l.unit_id as string) ?? null, factor: num(l.factor) || '1',
      unit_price: num(l.unit_price), discount_text: String(l.discount_text ?? ''), is_free: !!l.is_free, return_to_stock: !!l.return_to_stock, vat_exempt: l.vat_code === '0' })));
    setPays(cur.data.payments.map((p) => ({ key: ++seq, payment_method_id: String(p.payment_method_id), amount: num(p.amount), reference_no: String(p.reference_no ?? '') })));
  }
  const readOnly = !!id && (!cur.data?.editable || !can('edit'));
  const set = (p: Partial<Head>) => { setH((x) => ({ ...x!, ...p })); setDirty(true); };
  const setLine = (k: number, p: Partial<Line>) => { setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...p } : l))); setDirty(true); };
  const calc = useMemo(() => h && computeDoc({ price_type: h.price_type, vat_rate: h.vat_rate || 0, discount_text: h.discount_text, lines: lines.filter((l) => l.item_id).map((l) => ({ qty: l.qty || 0, unit_price: l.is_free ? 0 : l.unit_price || 0, discount_text: l.discount_text, vat_exempt: l.vat_exempt })) }), [h, lines]);
  const payTotal = pays.reduce((s, p) => s.plus(d(p.amount || 0)), d(0));

  const pickParty = async (p: { id: string; code: string; name: string } | null) => {
    if (!p) return set({ party: null });
    const x = await api.get<Record<string, string | null>>(`${partyEndpoint(K)}/${p.id}`);
    set({ party: p, credit_days: x.credit_days === null || x.credit_days === undefined ? '' : String(x.credit_days), discount_text: x.discount_text ?? '', party_tax_branch_no: x.tax_branch_no ?? '',
      ...(K.party === 'customer' ? { salesperson_id: x.salesperson_id ?? '', sales_area_code: x.sales_area_code ?? '', ship_via_code: x.ship_via_code ?? '', price_level: x.price_level && x.price_level !== '0' ? x.price_level : '1' }
        : { ship_via_code: x.ship_via_code ?? '', ...(x.price_type ? { price_type: x.price_type as Head['price_type'] } : {}), ...(x.vat_rate ? { vat_rate: num(x.vat_rate) } : {}) }) });
  };
  const pickItem = (k: number, it: ItemHit | null) => {
    if (!it) return setLine(k, { item_id: '', item_code: '' });
    const ar = K.module === 'AR';
    const price = ar ? (it[`price_${h?.price_level || '1'}` as 'price_1'] ?? it.price_1) : it.std_cost;
    const unit = ar ? (it.sales_unit_id ?? it.base_unit_id) : (it.purchase_unit_id ?? it.base_unit_id);
    const factor = ar ? (it.sales_unit_id ? it.sales_factor : '1') : (it.purchase_unit_id ? it.purchase_factor : '1');
    setLine(k, { item_id: it.id, item_code: it.code, description: it.name_th, unit_id: unit, factor: num(factor) || '1', unit_price: num(price), vat_exempt: it.vat_code === '0', qty: lines.find((l) => l.key === k)?.qty || '1' });
  };
  const addLine = () => { setLines((ls) => [...ls, { key: ++seq, item_id: '', item_code: '', description: '', warehouse_id: ls.at(-1)?.warehouse_id ?? null, qty: '', unit_id: null, factor: '1', unit_price: '', discount_text: '', is_free: false, return_to_stock: K.cls === 'CN' || K.cls === 'DN', vat_exempt: false }]); };
  if (h && !lines.length && !id) addLine();

  const save = async (andNew = false) => {
    if (!h || busy || readOnly || !can(id ? 'edit' : 'add')) return;
    setErr(null); setBusy(true);
    const body = { doc_type_id: h.doc_type_id, doc_date: h.doc_date, party_id: h.party?.id, bill_to_customer_id: h.bill_to?.id ?? null, party_tax_branch_no: h.party_tax_branch_no || null, your_ref: h.your_ref || null,
      ref_header_id: h.ref?.id || null, ref_no: h.ref?.code || null, department_id: h.department_id || null, salesperson_id: h.salesperson_id || null, sales_area_code: h.sales_area_code || null, ship_via_code: h.ship_via_code || null,
      credit_days: h.credit_days === '' ? null : Number(h.credit_days), price_type: h.price_type, vat_rate: h.vat_rate || '0', vat_basis: h.vat_basis, discount_text: h.discount_text || null, remark: h.remark || null,
      lines: lines.filter((l) => l.item_id).map((l) => ({ item_id: l.item_id, description: l.description || null, warehouse_id: l.warehouse_id, qty: l.qty || '0', unit_id: l.unit_id, factor: l.factor || '1', unit_price: l.unit_price || '0', discount_text: l.discount_text || null, is_free: l.is_free, return_to_stock: l.return_to_stock })),
      payments: pays.filter((p) => p.payment_method_id && d(p.amount || 0).gt(0)).map((p) => ({ payment_method_id: p.payment_method_id, amount: p.amount, reference_no: p.reference_no || null })) };
    try {
      const r = id ? await api.put<{ id: string; doc_no: string }>(`/api/v1/${K.path}/${id}`, body) : await api.post<{ id: string; doc_no: string }>(`/api/v1/${K.path}`, body);
      toast(`บันทึก${K.label} ${r.doc_no} แล้ว — ลงบัญชีแล้ว`);
      setDirty(false);
      qc.invalidateQueries({ queryKey: [K.path] }); qc.invalidateQueries({ queryKey: ['doc-journal', r.id] });
      if (andNew) { setH(null); setLines([]); setPays([]); nav(`${K.route}/new`, { replace: true }); }
      else if (!id) nav(`${K.route}/${r.id}`, { replace: true });
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const cancelDoc = async () => {
    try { await api.post(`/api/v1/${K.path}/${id}/cancel`, { reason }); toast('ยกเลิกเอกสารแล้ว'); setAskCancel(false); qc.invalidateQueries({ queryKey: [K.path] }); nav(K.route); }
    catch (e) { setAskCancel(false); setErr(e); }
  };
  useHotkeys({ F9: () => save(), 'Ctrl+S': () => save(), 'Ctrl+Enter': () => save(true), 'Alt+C': id && can('cancel') && cur.data?.doc_status !== 'C' ? () => setAskCancel(true) : undefined,
    Escape: () => { if (!dirty || window.confirm('มีการแก้ไขที่ยังไม่บันทึก — ออกโดยไม่บันทึก?')) nav(K.route); }, 'Ctrl+Insert': readOnly ? undefined : addLine }, []);
  const dtCode = defs.data?.types.find((t) => t.id === h?.doc_type_id);
  const cancelled = cur.data?.doc_status === 'C';
  const docNo = id ? cur.data?.doc_no : dtCode ? `${dtCode.code}**NEW**` : '';
  return (
    <div className="page" data-tone={TONE(K)}>
      <div className="doc-title"><p className="eyebrow">{K.module === 'AR' ? 'ขาย' : 'ซื้อ'} › {K.label}</p><h1>{docNo}</h1>
        <span className="doc-state">{cancelled ? <Pill tone="x">ยกเลิก</Pill> : id ? <Pill tone="n">ลงบัญชีแล้ว</Pill> : <Pill tone="m">ใหม่ — ยังไม่บันทึก</Pill>}{dirty && <Pill tone="c">มีการแก้ไขที่ยังไม่บันทึก</Pill>}{readOnly && !cancelled && id && <Pill tone="d">ชำระแล้ว — แก้ไขไม่ได้</Pill>}</span></div>
      <div className="toolbar">
        <button onClick={() => { if (!dirty || window.confirm('ทิ้งการแก้ไข?')) { setH(null); setLines([]); setPays([]); nav(`${K.route}/new`); } }}>+ ใหม่</button>
        <button className="primary" disabled={busy || readOnly} onClick={() => save()}>บันทึก <kbd>F9</kbd></button>
        <button disabled={busy || readOnly} onClick={() => save(true)}>บันทึก+ใหม่</button>
        <button disabled={!id || cancelled || !can('cancel')} onClick={() => setAskCancel(true)}>ยกเลิกเอกสาร</button>
        <button onClick={() => nav(K.route)}>รายการ <kbd>Esc</kbd></button>
      </div>
      <ErrorBox error={err ?? cur.error} />
      {h && <div onKeyDown={navKey}>
        <div className="head-grid trade-head">
          <div className="col">
            <Field label={`รหัส${partyWord(K)}`} req><SearchPick<{ id: string; code: string; name: string; tax_id?: string | null }> endpoint={partyEndpoint(K)} value={h.party} disabled={readOnly} autoFocus={!id} label={(r: { name: string }) => r.name} describe={(r: { tax_id?: string | null }) => r.tax_id ?? ''}
              onPick={(r: { id: string; code: string; name: string } | null) => pickParty(r)} /></Field>
            {K.party === 'customer' && <Field label="Bill to" hint="ชื่อบนใบกำกับ ถ้าเรียกเก็บในนามอื่น"><SearchPick endpoint="/api/v1/customers" value={h.bill_to} disabled={readOnly} label={(r: { name: string }) => r.name} onPick={(r: { id: string; code: string; name: string } | null) => set({ bill_to: r })} /></Field>}
            <Field label="สาขา#"><input className="mono" value={h.party_tax_branch_no} maxLength={5} disabled={readOnly} onChange={(e) => set({ party_tax_branch_no: e.target.value })} /></Field>
            <Field label="อ้างอิง"><input value={h.your_ref} maxLength={30} disabled={readOnly} onChange={(e) => set({ your_ref: e.target.value })} /></Field>
            {K.refInvoice && <Field label="เลขที่ใบกำกับที่อ้างถึง" req><SearchPick<{ id: string; doc_no: string; party_name: string; net_amount: string }> endpoint={`/api/v1/${K.module === 'AR' ? 'sales-invoices' : 'purchase-invoices'}`} params={h.party ? { party_id: h.party.id, status: 'N' } : undefined} value={h.ref} disabled={readOnly || !h.party}
              codeOf={(r: { doc_no: string }) => r.doc_no} label={(r: { party_name: string; net_amount: string }) => `${r.party_name} ${fmt(r.net_amount)}`} onPick={(r: { id: string; doc_no: string } | null) => set({ ref: r ? { id: r.id, code: r.doc_no } : null })} placeholder={h.party ? 'พิมพ์เลขที่ใบกำกับ' : `เลือก${partyWord(K)}ก่อน`} /></Field>}
          </div>
          <div className="col">
            <Field label="ประเภทเอกสาร"><select value={h.doc_type_id} disabled={!!id} onChange={(e) => set({ doc_type_id: e.target.value })}>{defs.data?.types.map((t) => <option key={t.id} value={t.id}>{t.code} {t.name_th}</option>)}</select></Field>
            <Field label="วันที่" req><DateInput value={h.doc_date} disabled={readOnly} onChange={(v) => set({ doc_date: v })} /></Field>
            {!K.payments && <Field label="เครดิต (วัน) / ครบกำหนด"><div className="pair"><input type="number" min={0} value={h.credit_days} disabled={readOnly} onChange={(e) => set({ credit_days: e.target.value })} aria-label="เครดิต" /><span className="muted small" style={{ alignSelf: 'center' }}><DateText v={dueDate(h.doc_date, Number(h.credit_days || 0))} /></span></div></Field>}
            <Field label="แผนก"><select value={h.department_id} disabled={readOnly} onChange={(e) => set({ department_id: e.target.value })}><option value="">—</option>{depts.data?.filter((x) => x.status === 'A' || x.id === h.department_id).map((x) => <option key={x.id} value={x.id}>{x.code} {x.name_th}</option>)}</select></Field>
            {K.module === 'AR' && <Field label="พนักงานขาย"><select value={h.salesperson_id} disabled={readOnly} onChange={(e) => set({ salesperson_id: e.target.value })}><option value="">—</option>{slms.data?.filter((x) => x.status === 'A' || x.id === h.salesperson_id).map((x) => <option key={x.id} value={x.id}>{x.code} {x.name}</option>)}</select></Field>}
            {K.module === 'AR' && <Field label="เขตการขาย"><LkSelect rows={lk.data?.['40']} value={h.sales_area_code} disabled={readOnly} onChange={(v) => set({ sales_area_code: v })} /></Field>}
            <Field label="ขนส่งโดย"><LkSelect rows={lk.data?.['41']} value={h.ship_via_code} disabled={readOnly} onChange={(v) => set({ ship_via_code: v })} /></Field>
            <Field label="ประเภทราคา"><select value={h.price_type} disabled={readOnly} onChange={(e) => set({ price_type: e.target.value as Head['price_type'] })}><option value="0">0 ยกเว้นภาษี</option><option value="1">1 รวมภาษีแล้ว</option><option value="2">2 แยก VAT</option></select></Field>
            {K.module === 'AR' && <Field label="ภาระภาษีขาย" hint="บริการ/ผ่อนชำระ เลือกเกณฑ์เงินสดได้"><select value={h.vat_basis} disabled={readOnly} onChange={(e) => set({ vat_basis: e.target.value as '1' | '2' })}><option value="1">เกณฑ์สิทธิ</option><option value="2">เกณฑ์เงินสด</option></select></Field>}
          </div>
        </div>
        <Tabs active={tab} onChange={setTab} tabs={[{ key: 'lines', label: 'รายการสินค้า', badge: lines.filter((l) => l.item_id).length || undefined }, ...(K.payments ? [{ key: 'pay', label: `${K.module === 'AR' ? 'รับ' : 'จ่าย'}ชำระด้วยวิธีอื่น`, badge: pays.length || undefined }] : []),
          ...(id && !K.payments ? [{ key: 'settle', label: `รายการ${K.module === 'AR' ? 'รับ' : 'จ่าย'}ชำระ`, badge: cur.data?.settlements.length || undefined }] : []), ...(id ? [{ key: 'gl', label: 'ใบสำคัญที่ลงบัญชี' }] : [])]} />
        {tab === 'lines' && <div className="table-wrap lines">
          <table className="grid">
            <thead><tr><th style={{ width: 36 }}>#</th><th style={{ width: 210 }}>รหัส</th><th>รายละเอียด</th><th style={{ width: 90 }}>คลัง</th><th className="r" style={{ width: 90 }}>จำนวน</th><th style={{ width: 80 }}>หน่วย</th><th className="r" style={{ width: 110 }}>ราคา/หน่วย</th><th style={{ width: 90 }}>ส่วนลด</th><th style={{ width: 36 }} title="ของแถม">F</th>{(K.cls === 'CN' || K.cls === 'DN') && <th style={{ width: 36 }} title={K.cls === 'CN' ? 'รับคืนสินค้า' : 'ส่งคืนสินค้า'}>R</th>}<th className="r" style={{ width: 120 }}>จำนวนเงิน</th><th style={{ width: 36 }} /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.key}>
                  <td className="muted">{i + 1}</td>
                  <td><SearchPick endpoint="/api/v1/item-search" params={{ module: K.module }} value={l.item_id ? { id: l.item_id, code: l.item_code } : null} disabled={readOnly} label={(r: ItemHit) => r.name_th} onPick={(r: ItemHit | null) => pickItem(l.key, r)} aria-label={`รหัสสินค้า ${i + 1}`} /></td>
                  <td><input value={l.description} maxLength={200} disabled={readOnly} onChange={(e) => setLine(l.key, { description: e.target.value })} aria-label="รายละเอียด" /></td>
                  <td><LkSelect byId rows={lk.data?.WH} value={l.warehouse_id} disabled={readOnly} onChange={(v) => setLine(l.key, { warehouse_id: v || null })} aria-label="คลัง" /></td>
                  <td><input className="r" inputMode="decimal" value={l.qty} disabled={readOnly} onChange={(e) => setLine(l.key, { qty: e.target.value.replace(/[^\d.-]/g, '') })} aria-label="จำนวน" /></td>
                  <td><LkSelect byId rows={lk.data?.UNIT} value={l.unit_id} disabled={readOnly} onChange={(v) => setLine(l.key, { unit_id: v || null })} aria-label="หน่วย" /></td>
                  <td><input className="r" inputMode="decimal" value={l.unit_price} disabled={readOnly || l.is_free} onChange={(e) => setLine(l.key, { unit_price: e.target.value.replace(/[^\d.]/g, '') })} aria-label="ราคาต่อหน่วย" /></td>
                  <td><input value={l.discount_text} maxLength={20} disabled={readOnly} placeholder="10% 5+2%" onChange={(e) => setLine(l.key, { discount_text: e.target.value })} aria-label="ส่วนลด" /></td>
                  <td className="c"><input type="checkbox" checked={l.is_free} disabled={readOnly} onChange={(e) => setLine(l.key, { is_free: e.target.checked })} aria-label="ของแถม" /></td>
                  {(K.cls === 'CN' || K.cls === 'DN') && <td className="c"><input type="checkbox" checked={l.return_to_stock} disabled={readOnly} onChange={(e) => setLine(l.key, { return_to_stock: e.target.checked })} aria-label="คืนสินค้า" /></td>}
                  <td className="r num">{calc?.lines[lines.filter((x) => x.item_id).indexOf(l)] ? fmt(calc.lines[lines.filter((x) => x.item_id).indexOf(l)]!.line_amount) : ''}</td>
                  <td>{!readOnly && <button type="button" className="icon-btn" tabIndex={-1} title="ลบบรรทัด" onClick={() => { setLines((ls) => ls.filter((x) => x.key !== l.key)); setDirty(true); }}>✕</button>}</td>
                </tr>
              ))}
            </tbody>
            {!readOnly && <tfoot><tr><td colSpan={12}><button type="button" onClick={addLine}>+ เพิ่มบรรทัด <kbd>Ctrl+Ins</kbd></button> <span className="hint">ราคาตาม{K.module === 'AR' ? 'ตารางราคาของลูกค้า' : 'ราคาทุนมาตรฐาน'} — แก้ได้ · ของแถมติ๊ก F</span></td></tr></tfoot>}
          </table>
        </div>}
        {tab === 'pay' && <div className="table-wrap lines">
          <table className="grid">
            <thead><tr><th>วิธีชำระ</th><th className="r" style={{ width: 150 }}>จำนวนเงิน</th><th style={{ width: 200 }}>เลขที่อ้างอิง/เช็ค</th><th style={{ width: 36 }} /></tr></thead>
            <tbody>
              {pays.map((p) => (
                <tr key={p.key}>
                  <td><select value={p.payment_method_id} disabled={readOnly} onChange={(e) => { setPays((ps) => ps.map((x) => (x.key === p.key ? { ...x, payment_method_id: e.target.value } : x))); setDirty(true); }} aria-label="วิธีชำระ"><option value="">— เลือก —</option>{methods.data?.filter((m) => m.status === 'A' || m.id === p.payment_method_id).map((m) => <option key={m.id} value={m.id}>{m.code} {m.name_th}</option>)}</select></td>
                  <td><input className="r" inputMode="decimal" value={p.amount} disabled={readOnly} onChange={(e) => { setPays((ps) => ps.map((x) => (x.key === p.key ? { ...x, amount: e.target.value.replace(/[^\d.]/g, '') } : x))); setDirty(true); }} aria-label="จำนวนเงิน" /></td>
                  <td><input value={p.reference_no} maxLength={30} disabled={readOnly} onChange={(e) => { setPays((ps) => ps.map((x) => (x.key === p.key ? { ...x, reference_no: e.target.value } : x))); setDirty(true); }} aria-label="เลขที่อ้างอิง" /></td>
                  <td>{!readOnly && <button type="button" className="icon-btn" tabIndex={-1} onClick={() => setPays((ps) => ps.filter((x) => x.key !== p.key))}>✕</button>}</td>
                </tr>
              ))}
              {!pays.length && <tr><td colSpan={4} className="empty">{K.module === 'AR' ? 'รับ' : 'จ่าย'}เป็นเงินสดทั้งหมด</td></tr>}
            </tbody>
            <tfoot><tr><td>{!readOnly && <button type="button" onClick={() => setPays((ps) => [...ps, { key: ++seq, payment_method_id: '', amount: calc ? d(calc.net_amount).minus(payTotal).toFixed(2) : '', reference_no: '' }])}>+ เพิ่มวิธีชำระ</button>} เงินสด <b><Money v={calc ? d(calc.net_amount).minus(payTotal).toFixed(2) : '0'} /></b></td><td className="r"><b><Money v={payTotal.toFixed(2)} /></b></td><td colSpan={2} /></tr></tfoot>
          </table>
        </div>}
        {tab === 'settle' && cur.data && <table className="grid"><thead><tr><th>เลขที่</th><th>วันที่</th><th className="r">จำนวนเงิน</th><th>สถานะ</th></tr></thead>
          <tbody>{cur.data.settlements.map((s) => <tr key={s.id}><td className="mono">{s.doc_no}</td><td><DateText v={s.doc_date} /></td><td className="r"><Money v={s.amount} /></td><td>{s.doc_status === 'C' ? 'ยกเลิก' : ''}</td></tr>)}
            {!cur.data.settlements.length && <tr><td colSpan={4} className="empty">ยังไม่มีการชำระ · ค้างชำระ <Money v={cur.data.outstanding} /></td></tr>}</tbody></table>}
        {tab === 'gl' && id && <DocJournalTab id={id} />}
        <div className="trade-foot">
          <Field label="หมายเหตุ"><textarea rows={2} value={h.remark} maxLength={2000} disabled={readOnly} onChange={(e) => set({ remark: e.target.value })} /></Field>
          {calc && <table className="totals-table"><tbody>
            <tr><td>จำนวนเงิน</td><td className="r"><Money v={calc.amount} /></td></tr>
            <tr><td>หักส่วนลด <input value={h.discount_text} maxLength={20} disabled={readOnly} onChange={(e) => set({ discount_text: e.target.value })} placeholder="10% หรือ 500" aria-label="ส่วนลดท้ายบิล" style={{ width: 110 }} /></td><td className="r"><Money v={calc.discount_amount} /></td></tr>
            {d(calc.zero_rate_amount).gt(0) && h.price_type !== '0' && <tr><td>แยกยอดเงิน 0.00 %=</td><td className="r"><Money v={calc.zero_rate_amount} /></td></tr>}
            <tr><td>ภาษีมูลค่าเพิ่ม <input className="r" inputMode="decimal" value={h.vat_rate} disabled={readOnly || h.price_type === '0'} onChange={(e) => set({ vat_rate: e.target.value.replace(/[^\d.]/g, '') })} aria-label="อัตราภาษี" style={{ width: 60 }} /> %</td><td className="r"><Money v={calc.vat_amount} /></td></tr>
            <tr className="grand"><td>จำนวนเงินรวมทั้งสิ้น</td><td className="r"><Money v={calc.net_amount} /></td></tr>
            {calc.errors.length > 0 && <tr><td colSpan={2} className="bad small">{calc.errors[0]}</td></tr>}
          </tbody></table>}
        </div>
      </div>}
      <KeyHints keys={[['Enter', 'ช่องถัดไป'], ['F4', 'ค้นหารหัส'], ['Ctrl+Ins', 'เพิ่มบรรทัด'], ['F9', 'บันทึก'], ['Ctrl+Enter', 'บันทึก+ใหม่'], ['Alt+C', 'ยกเลิกเอกสาร'], ['Esc', 'กลับรายการ']]} />
      {askCancel && <Confirm danger title="ยกเลิกเอกสาร" text={<>ยกเลิก <b>{cur.data?.doc_no}</b>? เอกสารและใบสำคัญจะเป็นสถานะยกเลิก (ไม่ลบ)</>} okText="ยกเลิกเอกสาร" onClose={() => setAskCancel(false)} onOk={cancelDoc}>
        <Field label="เหตุผลที่ยกเลิก" req><input autoFocus value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></Field>
      </Confirm>}
    </div>
  );
}
