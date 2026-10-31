import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { d, fmt, SETTLE_KINDS, settlementTotals, todayIso, wht50FormOf, type SettleKind } from '@buddy/core';
import { api } from '../../api';
import { useCan, useSession } from '../../session';
import { SearchPick } from '../../components/LkSelect';
import { Confirm, cx, DateInput, DateText, ErrorBox, Field, KeyHints, Money, MoneyInput, navKey, PageHead, Pill, Tabs, toast, useHotkeys } from '../../ui';
import { useDocEdit } from '../../components/DocEdit';
import { useDocNo } from '../../components/DocNo';
import { DocActions } from '../../components/DocPrint';
import { CancelStamp } from '../../components/DocDelete';
import { DocJournalTab } from './TradeDocs';
import { DocLink } from '../../components/DocLink';
import { LineNoteButton, LineNotePreview, useLineNoteHotkey } from '../../components/Notes';
import { chargesBody, chargesFrom, ChargesTable, chargeTotal, emptyChargeHead, supplierChargeDefaults, PaymentsTable, paysBody, paysFrom, WhtTable, whtsBody, whtsFrom, type ChargeHead, type ChargeLine, type ChargeRow, type Pay, type Wht } from './MoneyParts';
import { DocTypeTabs, initialType, NO_TYPE_MSG, TypeNotice, useTypeTabs } from '../../components/DocTypeTabs';
import { bookStyle, typeColorIn } from '../../bookColor';
import { DocVatTab, VatCheckAfterSave, vatTabLabel } from '../../components/DocTaxTabs';

const kindOf = (path: string) => SETTLE_KINDS.find((k) => k.path === path)!;
const partyEndpoint = (K: SettleKind) => (K.party === 'customer' ? '/api/v1/customers' : '/api/v1/suppliers');
const partyWord = (K: SettleKind) => (K.party === 'customer' ? 'ลูกค้า' : 'ผู้จำหน่าย');
const rp = (K: SettleKind) => (K.direction === 'R' ? 'รับ' : 'จ่าย');
const CLASS_TH: Record<string, string> = { IV: 'บิลขาย', DR: 'เพิ่มหนี้', CN: 'ลดหนี้', RR: 'บิลซื้อ', CP: 'เพิ่มหนี้', DN: 'ลดหนี้' };

/* ---------------------------------------------------------------- รายการใบเสร็จ/ใบสำคัญจ่าย */
interface ListRow { id: string; doc_no: string; doc_date: string; payment_date: string | null; party_name: string; party_code: string | null; net_amount: string; wht_amount: string; cash_amount: string; cheque_amount: string; doc_status: string; bills: number }
export function SettleListPage({ path }: { path: string }) {
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
  const sum = (k: 'net_amount' | 'wht_amount') => list.data?.rows.filter((r) => r.doc_status !== 'C').reduce((s, r) => s.plus(d(r[k])), d(0)).toFixed(2);
  return (
    <div className="page" data-tone="finance">
      <PageHead eyebrow={`การเงิน › ${K.module === 'AR' ? 'ลูกหนี้' : 'เจ้าหนี้'}`} title={K.label}
        lead={`ตัดบิลค้างได้หลายใบในใบเดียว (ใบลดหนี้นำมาหักได้) · ${rp(K)}เป็นเงินสด เช็ค เงินโอน ผสมกันได้ · บันทึกแล้วลงบัญชีทันที · ยกเลิกแล้วบิลกลับเป็นค้าง`}
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
          <thead><tr><th style={{ width: 130 }}>เลขที่</th><th style={{ width: 110 }}>วันที่</th><th style={{ width: 110 }}>วันที่{rp(K)}เงิน</th><th style={{ width: 100 }}>รหัส</th><th>{partyWord(K)}</th><th className="r" style={{ width: 60 }}>บิล</th>
            <th className="r" style={{ width: 140 }}>ยอดตามใบกำกับ</th><th className="r" style={{ width: 110 }}>ภาษีหัก ณ ที่จ่าย</th><th className="r" style={{ width: 120 }}>เงินสด</th><th className="r" style={{ width: 130 }}>เช็ค/อื่น ๆ</th><th style={{ width: 80 }}>สถานะ</th></tr></thead>
          <tbody>
            {list.data?.rows.map((r) => (
              <tr key={r.id} className={cx('row-open', r.doc_status === 'C' && 'cancelled')} tabIndex={0} onClick={() => nav(`${K.route}/${r.id}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`${K.route}/${r.id}`)}>
                <td className="mono">{r.doc_no}</td><td><DateText v={r.doc_date} /></td><td><DateText v={r.payment_date} /></td><td className="mono">{r.party_code}</td><td>{r.party_name}</td><td className="r">{r.bills}</td>
                <td className="r"><Money v={r.net_amount} /></td><td className="r"><Money v={r.wht_amount} blankZero /></td><td className="r"><Money v={r.cash_amount} blankZero /></td><td className="r"><Money v={r.cheque_amount} blankZero /></td>
                <td>{r.doc_status === 'C' ? <Pill tone="x">ยกเลิก</Pill> : <Pill tone="n">ปกติ</Pill>}</td>
              </tr>
            ))}
            {list.data && !list.data.rows.length && <tr><td colSpan={11} className="empty">ไม่มีเอกสารในช่วงนี้ — กด Ins เพื่อเพิ่ม</td></tr>}
          </tbody>
          {!!list.data?.rows.length && <tfoot><tr><td colSpan={6} className="r">รวม (ไม่รวมที่ยกเลิก)</td><td className="r"><b><Money v={sum('net_amount')} /></b></td><td className="r"><b><Money v={sum('wht_amount')} blankZero /></b></td><td colSpan={3} /></tr></tfoot>}
        </table>
      </div>
      <KeyHints keys={[['Ins', `เพิ่ม${K.label}`], ['คลิก/Enter', 'เปิดเอกสาร']]} />
    </div>
  );
}

/* ---------------------------------------------------------------- หน้าเอกสาร */
interface Open { header_id: string; doc_class: string; doc_no: string; doc_date: string; due_date: string | null; amount: string; outstanding: string; own: string; vat_basis: string | null; net_amount: string; vat_amount: string; ref_no: string | null; bill_no: string | null; bill_id: string | null; is_opening: boolean }
interface Head { doc_type_id: string; doc_date: string; payment_date: string; party: { id: string; code: string; name?: string | null } | null; department_id: string; salesperson_id: string; your_ref: string; remark: string;
  interest: string; discount: string; wht: string; fx: string; cash: string; whtForm: 'S03' | 'S53'; whtRate: string }
interface Detail extends Record<string, unknown> { doc_no: string; doc_status: string; editable: boolean; settlements: Array<{ invoice_header_id: string; amount: string; line_note?: string | null; line_note_print?: boolean }>;
  payments: Array<{ payment_method_id: string; amount: string; reference_no: string | null; cheque_date: string | null; bank_id: string | null; bank_branch: string | null }>;
  wht: Array<{ id: string; form_type: 'S03' | 'S53'; income_type: string; rate: string; paid_amount: string; tax_amount: string; certificate_no: string | null; certificate_date: string; doc_status: string }>;
  /** ใบเสร็จ: รายการที่แพลตฟอร์มหัก + ภาษีหัก ณ ที่จ่ายที่เราหักจากรายการนั้น */
  charges?: ChargeRow[]; charge_wht?: Array<{ id: string; tax_amount: string; doc_status: string }> }
const num = (v: unknown) => (v === null || v === undefined || v === '' ? '' : d(v as string).toString());

export function SettleFormPage({ path }: { path: string }) {
  const K = kindOf(path);
  const { id: routeId } = useParams();
  const id = routeId && routeId !== 'new' ? routeId : null;
  const nav = useNavigate();
  const qc = useQueryClient();
  const can = useCan(K.menu);
  const { me } = useSession();
  const defs = useQuery({ queryKey: ['trade-defaults', K.cls], queryFn: () => api.get<{ types: Array<{ id: string; code: string; name_th: string }> }>(`/api/v1/trade-defaults/${K.cls}`) });
  const depts = useQuery({ queryKey: ['departments'], queryFn: () => api.get<Array<{ id: string; code: string; name_th: string; status: string }>>('/api/v1/departments') });
  const slms = useQuery({ enabled: K.module === 'AR', queryKey: ['salespersons'], queryFn: () => api.get<Array<{ id: string; code: string; name: string; status: string }>>('/api/v1/salespersons') });
  const cur = useQuery({ enabled: !!id, queryKey: [K.path, 'one', id], queryFn: () => api.get<Detail>(`/api/v1/${K.path}/${id}`), staleTime: 0 });
  const [h, setH] = useState<Head | null>(null);
  /** บิลที่เลือก: header_id → ยอดชำระ */
  const [pick, setPick] = useState<Record<string, string>>({});
  const [billRef, setBillRef] = useState('');
  const [pays, setPays] = useState<Pay[]>([]);
  const [whts, setWhts] = useState<Wht[]>([]);
  /** หักโดยแพลตฟอร์ม (ใบเสร็จ — ข้อกำหนดเจ้าของ 31/10/2569) */
  const [chHead, setChHead] = useState<ChargeHead>(emptyChargeHead);
  const [charges, setCharges] = useState<ChargeLine[]>([]);
  const isRe = K.cls === 'RE';
  const [tab, setTab] = useState('bills');
  /** หมายเหตุรายการต่อบิลที่ตัด (ข้อกำหนดเจ้าของ) */
  const [notes, setNotes] = useState<Record<string, { line_note: string; line_note_print: boolean }>>({});
  useLineNoteHotkey();
  const [vatCheck, setVatCheck] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [askCancel, setAskCancel] = useState(false);
  const [reason, setReason] = useState('');
  const [dirty, setDirty] = useState(false);
  const bills = useQuery({ enabled: !!h?.party, queryKey: [K.path, 'bills', h?.party?.id], queryFn: () => api.get<{ rows: Array<{ id: string; doc_no: string; invoice_ids: string[]; total: string }> }>(`/api/v1/${K.path}/bills`, { party_id: h!.party!.id }) });
  const open = useQuery({ enabled: !!h?.party, queryKey: [K.path, 'open', h?.party?.id, id], queryFn: () => api.get<{ rows: Open[] }>(`/api/v1/${K.path}/open-items`, { party_id: h!.party!.id, ...(id ? { receipt_id: id } : {}) }), staleTime: 0 });
  const date0 = me?.work_date ?? todayIso();
  if (!h && !id && defs.data) setH({ doc_type_id: initialType(defs.data.types)?.id ?? '', doc_date: date0, payment_date: date0, party: null, department_id: '', salesperson_id: '', your_ref: '', remark: '', interest: '', discount: '', wht: '', fx: '', cash: '', whtForm: 'S53', whtRate: '3' });
  if (!h && id && cur.data) {
    const c = cur.data as Record<string, string | null>;
    setH({ doc_type_id: c.doc_type_id!, doc_date: String(c.doc_date).slice(0, 10), payment_date: String(c.payment_date ?? c.doc_date).slice(0, 10), party: { id: (c.customer_id ?? c.supplier_id)!, code: c.party_code ?? '', name: c.party_name },
      department_id: c.department_id ?? '', salesperson_id: c.salesperson_id ?? '', your_ref: c.your_ref ?? '', remark: c.remark ?? '', interest: num(c.interest_amount), discount: num(c.cash_discount_amount), wht: num(c.wht_amount), fx: num(c.fx_amount), cash: num(c.cash_amount), whtForm: 'S53', whtRate: '3' });
    setPick(Object.fromEntries(cur.data.settlements.map((s) => [s.invoice_header_id, num(s.amount)])));
    setNotes(Object.fromEntries(cur.data.settlements.filter((s) => s.line_note).map((s) => [s.invoice_header_id, { line_note: s.line_note ?? '', line_note_print: !!s.line_note_print }])));
    setPays(paysFrom(cur.data.payments));
    setWhts(whtsFrom(cur.data.wht));
    const ch = chargesFrom(cur.data.charges ?? []); setChHead(ch.head); setCharges(ch.lines);
  }
  const roBase = !!id && (!cur.data?.editable || !can('edit'));
  const ed = useDocEdit({ id: id ?? undefined, allowed: !!id && !roBase, dirty, onSave: (n) => void save(!!n), onDiscard: () => { setH(null); setDirty(false); } });
  const readOnly = roBase || ed.locked;
  const set = (p: Partial<Head>) => { setH((x) => ({ ...x!, ...p })); setDirty(true); };
  const rows = open.data?.rows ?? [];
  const chosen = rows.filter((o) => pick[o.header_id] !== undefined);
  const whtTotal = whts.reduce((s, w) => s.plus(d(w.tax_amount || 0)), d(0));
  const whtAmount = K.cls === 'PS' && whts.length ? whtTotal.toFixed(2) : h?.wht || '0';
  const feeTotal = isRe ? chargeTotal(charges) : '0';
  const t = useMemo(() => settlementTotals({ settlements: chosen.map((o) => d(pick[o.header_id] || 0).times(o.doc_class === K.neg ? -1 : 1).toFixed(2)), interest: h?.interest || 0, discount: h?.discount || 0, wht: whtAmount, fx: h?.fx || 0, charges: feeTotal, direction: K.direction,
    payments: pays.filter((p) => p.payment_method_id).map((p) => p.amount || 0), cash: h?.cash === '' || h?.cash === undefined ? null : h.cash }), [chosen, pick, h, pays, whtAmount, feeTotal, K.neg]);
  /** ยอดก่อน VAT ของบิลที่เลือก — ค่าเริ่มต้นของ "จำนวนเงินที่จ่าย" ในภาษีหัก ณ ที่จ่าย */
  const baseOfChosen = chosen.reduce((s, o) => { const n = d(o.net_amount); const p = d(pick[o.header_id] || 0).times(o.doc_class === K.neg ? -1 : 1); return s.plus(n.isZero() ? p : p.times(n.minus(d(o.vat_amount))).div(n)); }, d(0)).toDecimalPlaces(2).toFixed(2);

  const pickParty = async (p: { id: string; code: string; name: string } | null) => {
    setPick({}); setNotes({}); setWhts([]); setChHead(emptyChargeHead()); setCharges([]);
    if (!p) return set({ party: null });
    const x = await api.get<Record<string, string | null>>(`${partyEndpoint(K)}/${p.id}`);
    if (isRe) await loadChargeTemplate(p.id, h?.doc_type_id);
    set({ party: p, ...(K.module === 'AR' ? { salesperson_id: x.salesperson_id ?? '' } : {}),
      whtForm: wht50FormOf(x.wht_form, x.tax_id) === '3' ? 'S03' : 'S53', whtRate: x.wht_rate && !d(x.wht_rate).isZero() ? d(x.wht_rate).toString() : '3' });
  };
  /**
   * ค่าเริ่มต้นรายการที่แพลตฟอร์มหัก (ใบใหม่): รายการที่ตั้งที่ประเภทเอกสาร (ค่า GP ค่าการตลาด ค่าโฆษณา … + บัญชี + ผู้ให้บริการ)
   * หรือแบบใบเสร็จครั้งก่อนของลูกค้ารายนี้ — ป้อนเฉพาะยอดตามรายงานการโอน
   */
  const loadChargeTemplate = async (partyId: string | null | undefined, typeId: string | null | undefined) => {
    if (!isRe || id || (!partyId && !typeId)) return;
    const tpl = await api.get<{ source: 'doc_type' | 'last' | null; rows: ChargeRow[] }>(`/api/v1/${K.path}/charge-template`, { ...(partyId ? { party_id: partyId } : {}), ...(typeId ? { type_id: typeId } : {}) });
    if (!tpl.rows.length) return;
    const ch = chargesFrom(tpl.rows, false);
    if (tpl.source === 'doc_type' && ch.head.supplier) ch.head.wht_form = (await supplierChargeDefaults(ch.head.supplier.id)).wht_form;
    setChHead(ch.head); setCharges(ch.lines);
    toast(tpl.source === 'doc_type' ? `ดึงรายการหักที่ตั้งไว้ที่ประเภทเอกสาร ${ch.lines.length} รายการ — ป้อนยอดตามรายงานการโอนที่แท็บ "หักโดยแพลตฟอร์ม" (F8)`
      : `ดึงรายการหักของ ${ch.head.supplier?.name ?? ''} แบบครั้งก่อนแล้ว — ป้อนยอดตามรายงานการโอนที่แท็บ "หักโดยแพลตฟอร์ม" (F8)`, 'warn');
  };
  const toggle = (o: Open, on: boolean) => { setPick((m) => { const n = { ...m }; if (on) n[o.header_id] = num(o.outstanding); else delete n[o.header_id]; return n; }); setDirty(true); };
  const allOn = rows.length > 0 && rows.every((o) => pick[o.header_id] !== undefined);

  /** เลือกประเภทจากแถบ (ใบใหม่) — ค่าเริ่มต้นตามประเภทนั้น */
  const pickType = (v: string) => {
    set({ doc_type_id: v });
    // เปลี่ยนประเภท (เช่น รับชำระ Grab → Shopee) ก่อนป้อนยอดรายการหัก: ดึงรายการหักของประเภทใหม่
    if (isRe && !id && !charges.some((c) => c.amount)) { setChHead(emptyChargeHead()); setCharges([]); void loadChargeTemplate(h?.party?.id, v); }
  };
  const tColor = typeColorIn(defs.data?.types, h?.doc_type_id);
  const tCur = defs.data?.types.find((x) => x.id === h?.doc_type_id);
  const save = async (andNew = false) => {
    if (h && !h.doc_type_id) { setErr(new Error(NO_TYPE_MSG)); return; }
    if (!h || busy || readOnly || !can(id ? 'edit' : 'add')) return;
    setErr(null); setBusy(true);
    const body = { doc_type_id: h.doc_type_id, doc_no: dn.value, doc_date: h.doc_date, payment_date: h.payment_date || null, party_id: h.party?.id, department_id: h.department_id || null, salesperson_id: h.salesperson_id || null,
      your_ref: h.your_ref || null, remark: h.remark || null, interest_amount: h.interest || '0', cash_discount_amount: h.discount || '0', fx_amount: h.fx || '0', wht_amount: K.cls === 'PS' && whts.length ? '0' : h.wht || '0', cash_amount: h.cash === '' ? null : h.cash,
      settlements: chosen.map((o) => ({ invoice_header_id: o.header_id, amount: pick[o.header_id] || '0', line_note: notes[o.header_id]?.line_note || null, line_note_print: !!notes[o.header_id]?.line_note_print })),
      payments: paysBody(pays), wht: K.cls === 'PS' ? whtsBody(whts) : [], charges: isRe ? chargesBody(chHead, charges) : [] };
    try {
      const r = id ? await api.put<{ id: string; doc_no: string; journal_id?: string | null }>(`/api/v1/${K.path}/${id}`, body) : await api.post<{ id: string; doc_no: string; journal_id?: string | null }>(`/api/v1/${K.path}`, body);
      toast(r.journal_id ? `บันทึก${K.label} ${r.doc_no} แล้ว — ลงบัญชีแล้ว` : `บันทึก${K.label} ${r.doc_no} แล้ว (ไม่ลงบัญชี)`);
      setDirty(false); if (id) ed.lock();
      qc.invalidateQueries({ queryKey: [K.path] }); qc.invalidateQueries({ queryKey: ['doc-journal', r.id] }); qc.invalidateQueries({ queryKey: ['doc-vat'] });
      if (K.cls === 'PS') setVatCheck(r.id);   // ภาษีซื้อเกณฑ์เงินสด (ค่าบริการ) เกิดตอนจ่าย: ตรวจรายการในแฟ้มภาษีซื้อ (ไม่มีรายการ = ปิดเอง)
      if (andNew) { setH(null); setPick({}); setNotes({}); setPays([]); setWhts([]); setChHead(emptyChargeHead()); setCharges([]); nav(`${K.route}/new`, { replace: true }); }
      // โหลดจากเซิร์ฟเวอร์ใหม่ (ได้รหัสรายการภาษีหัก ณ ที่จ่ายสำหรับพิมพ์ 50 ทวิ)
      else if (!id) { nav(`${K.route}/${r.id}`, { replace: true }); setH(null); }
      else { await qc.refetchQueries({ queryKey: [K.path, 'one', id] }); setH(null); }
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const cancelDoc = async () => {
    try { await api.post(`/api/v1/${K.path}/${id}/cancel`, { reason }); toast('ยกเลิกเอกสารแล้ว — บิลกลับเป็นค้างชำระ'); setAskCancel(false); qc.invalidateQueries({ queryKey: [K.path] }); nav(K.route); }
    catch (e) { setAskCancel(false); setErr(e); }
  };
  useHotkeys({ F9: () => save(), 'Ctrl+S': () => save(), 'Ctrl+Enter': () => save(true), F5: () => setTab('bills'), F7: () => setTab('pay'), F8: isRe ? () => setTab('fee') : undefined, 'Ctrl+F7': id ? () => setTab('vat') : undefined, 'Ctrl+F10': K.cls === 'PS' ? () => setTab('wht') : undefined,
    'Alt+C': id && can('cancel') && cur.data?.doc_status !== 'C' ? () => setAskCancel(true) : undefined,
    Escape: () => { if (!dirty || window.confirm('มีการแก้ไขที่ยังไม่บันทึก — ออกโดยไม่บันทึก?')) nav(K.route); } }, []);
  const dn = useDocNo(tCur, id ? cur.data?.doc_no : undefined, { disabled: readOnly, resetKey: h ? 'on' : 'off' });
  const dtCode = defs.data?.types.find((x) => x.id === h?.doc_type_id);
  const cancelled = cur.data?.doc_status === 'C';
  const docNo = id ? cur.data?.doc_no : dn.value ?? (dtCode ? `${dtCode.code}**NEW**` : '');
  const ro = readOnly;
  return (
    <div className={cx('page', tColor && 'book-colored', cancelled && 'doc-cancelled')} data-tone="finance" style={bookStyle(tColor)}>
      <div className="doc-title"><p className="eyebrow">การเงิน › {K.label}</p><h1>{docNo}</h1><CancelStamp show={cancelled} reason={(cur.data as { cancel_reason?: string | null } | undefined)?.cancel_reason} />{tCur && <span className="book-pill" title="ประเภทเอกสาร">{!id ? 'กำลังบันทึก: ' : ''}{tCur.code} {tCur.name_th}</span>}
        <span className="doc-state">{cancelled ? <Pill tone="x">ยกเลิก</Pill> : id ? <Pill tone="n">ลงบัญชีแล้ว</Pill> : <Pill tone="m">ใหม่ — ยังไม่บันทึก</Pill>}{dirty && <Pill tone="c">มีการแก้ไขที่ยังไม่บันทึก</Pill>}{ed.locked && !roBase && <Pill tone="n">ดูอย่างเดียว — กด แก้ไข (Alt+E)</Pill>}
          {h?.party && chosen.length > 0 && !t.ok && !ro && <Pill tone="d">ยอดเงินไม่เรียบร้อย</Pill>}</span></div>
      <div className="toolbar">
        <button onClick={() => { if (!dirty || window.confirm('ทิ้งการแก้ไข?')) { setH(null); setPick({}); setNotes({}); setPays([]); setWhts([]); setChHead(emptyChargeHead()); setCharges([]); nav(`${K.route}/new`); } }}>+ ใหม่</button>
        <button className="primary" disabled={busy || ro} onClick={() => save()}>บันทึก <kbd>F9</kbd></button>
        {ed.editButton}
        <button disabled={busy || ro} onClick={() => save(true)}>บันทึก+ใหม่</button>
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
            <Field label={`รหัส${partyWord(K)}`} req><SearchPick<{ id: string; code: string; name: string; tax_id?: string | null }> endpoint={partyEndpoint(K)} value={h.party} required disabled={ro || !!id} autoFocus={!id} label={(r: { name: string }) => r.name} describe={(r: { tax_id?: string | null }) => r.tax_id ?? ''}
              onPick={(r: { id: string; code: string; name: string } | null) => pickParty(r)} /></Field>
            {!ro && <Field label={K.module === 'AR' ? 'อ้างใบวางบิล' : 'อ้างใบรับวางบิล'} hint="เลือกแล้วติ๊กบิลทุกใบในใบวางบิลให้ (ยอดค้างเต็ม) — แก้ยอดได้"><select value={billRef} disabled={!h.party} onChange={(e) => {
              const b = bills.data?.rows.find((x) => x.id === e.target.value); setBillRef(e.target.value);
              if (!b) return;
              const sel = rows.filter((o) => b.invoice_ids.includes(o.header_id));
              setPick((m) => ({ ...m, ...Object.fromEntries(sel.map((o) => [o.header_id, num(o.outstanding)])) }));
              if (!h.your_ref) set({ your_ref: b.doc_no });
              setDirty(true); setTab('bills');
              toast(sel.length ? `เลือกบิลตาม ${b.doc_no} ${sel.length} ใบ` : `บิลใน ${b.doc_no} ชำระครบแล้ว`, sel.length ? 'ok' : 'warn');
            }}><option value="">—</option>{bills.data?.rows.map((b) => <option key={b.id} value={b.id}>{b.doc_no} · {b.invoice_ids.length} ใบ · {fmt(b.total)}</option>)}</select></Field>}
            <Field label="อ้างอิง/หมายเหตุสั้น"><input value={h.your_ref} maxLength={60} disabled={ro} onChange={(e) => set({ your_ref: e.target.value })} /></Field>
            {K.module === 'AR' && <Field label="พนักงานเก็บเงิน"><select value={h.salesperson_id} disabled={ro} onChange={(e) => set({ salesperson_id: e.target.value })}><option value="">—</option>{slms.data?.filter((x) => x.status === 'A' || x.id === h.salesperson_id).map((x) => <option key={x.id} value={x.id}>{x.code} {x.name}</option>)}</select></Field>}
          </div>
          <div className="col">
            
            {dn.field}
            
            <Field label={K.cls === 'RE' ? 'วันที่ใบเสร็จ' : 'วันที่ทำเอกสาร'} req><DateInput value={h.doc_date} disabled={ro} onChange={(v) => set({ doc_date: v, ...(h.payment_date === h.doc_date ? { payment_date: v } : {}) })} /></Field>
            <Field label={`วันที่${rp(K)}เงิน`} hint="วันรับ/จ่ายเงินจริง ไม่ต้องตรงวันที่เอกสาร"><DateInput value={h.payment_date} disabled={ro} onChange={(v) => set({ payment_date: v })} /></Field>
            <Field label="แผนก"><select value={h.department_id} disabled={ro} onChange={(e) => set({ department_id: e.target.value })}><option value="">—</option>{depts.data?.filter((x) => x.status === 'A' || x.id === h.department_id).map((x) => <option key={x.id} value={x.id}>{x.code} {x.name_th}</option>)}</select></Field>
          </div>
        </div>
        <Tabs active={tab} onChange={setTab} tabs={[{ key: 'bills', label: `รายการบิลที่${rp(K)}ชำระ`, badge: chosen.length || undefined }, { key: 'pay', label: 'ชำระโดยอื่น ๆ (เช็ค/โอน)', badge: pays.length || undefined },
          ...(K.cls === 'PS' ? [{ key: 'wht', label: 'ภาษีหัก ณ ที่จ่าย', badge: whts.length || undefined }] : []), ...(isRe ? [{ key: 'fee', label: 'หักโดยแพลตฟอร์ม (GP/ค่าธรรมเนียม)', badge: charges.length || undefined }] : []), ...(id ? [{ key: 'vat', label: vatTabLabel(K.cls) }, { key: 'gl', label: 'ใบสำคัญที่ลงบัญชี' }] : [])]} />
        {tab === 'bills' && <div className="table-wrap lines">
          {!h.party ? <p className="empty">เลือก{partyWord(K)}ก่อน แล้วติ๊กบิลที่จะ{rp(K)}ชำระ</p> : <table className="grid">
            <thead><tr><th style={{ width: 36 }}><input type="checkbox" checked={allOn} disabled={ro || !rows.length} onChange={(e) => { setPick(e.target.checked ? Object.fromEntries(rows.map((o) => [o.header_id, num(o.outstanding)])) : {}); setDirty(true); }} aria-label="เลือกทั้งหมด" /></th>
              <th style={{ width: 140 }}>เลขที่</th><th style={{ width: 80 }}>ชนิด</th><th style={{ width: 110 }}>วันที่</th><th style={{ width: 110 }}>ครบกำหนด</th><th style={{ width: 120 }}>{K.module === 'AR' ? 'ใบวางบิล#' : 'ใบรับวางบิล#'}</th>{K.module === 'AP' && <th>เลขที่บิลผู้จำหน่าย</th>}
              <th className="r" style={{ width: 130 }}>จำนวนเงิน</th><th className="r" style={{ width: 130 }}>ยอดคงค้าง</th><th className="r" style={{ width: 150 }}>ยอดชำระ</th></tr></thead>
            <tbody>
              {rows.map((o) => {
                const on = pick[o.header_id] !== undefined;
                return (
                  <tr key={o.header_id} className={cx('row-open', on && 'picked')} onClick={(e) => { if (!ro && !(e.target as HTMLElement).matches('input')) toggle(o, !on); }}>
                    <td className="c"><input type="checkbox" checked={on} disabled={ro} onChange={(e) => toggle(o, e.target.checked)} aria-label={`เลือก ${o.doc_no}`} /></td>
                    <td><DocLink id={o.header_id} no={o.doc_no} cls={o.doc_class} opening={o.is_opening} keep={dirty} />{on && <LineNoteButton note={notes[o.header_id]?.line_note} print={notes[o.header_id]?.line_note_print} disabled={ro} label={o.doc_no} onChange={(v) => { setNotes((m) => ({ ...m, [o.header_id]: v })); setDirty(true); }} />}
                      {on && <LineNotePreview note={notes[o.header_id]?.line_note} print={notes[o.header_id]?.line_note_print} />}</td><td>{o.doc_class === K.neg ? <Pill tone="c">{CLASS_TH[o.doc_class]}</Pill> : CLASS_TH[o.doc_class]}{o.vat_basis === '2' && <span className="muted small"> ภาษีเกณฑ์เงินสด</span>}</td>
                    <td><DateText v={o.doc_date} /></td><td><DateText v={o.due_date} /></td><td><DocLink id={o.bill_id} no={o.bill_no} cls={K.module === 'AR' ? 'BS' : 'BR'} keep={dirty} /></td>{K.module === 'AP' && <td className="mono">{o.ref_no}</td>}
                    <td className="r"><Money v={o.doc_class === K.neg ? d(o.amount).neg().toFixed(2) : o.amount} /></td><td className="r"><Money v={o.doc_class === K.neg ? d(o.outstanding).neg().toFixed(2) : o.outstanding} /></td>
                    <td>{on && <MoneyInput value={pick[o.header_id]} disabled={ro} onChange={(v) => { setPick((m) => ({ ...m, [o.header_id]: v })); setDirty(true); }} aria-label={`ยอดชำระ ${o.doc_no}`} />}</td>
                  </tr>
                );
              })}
              {open.data && !rows.length && <tr><td colSpan={10} className="empty">ไม่มีบิลค้างชำระของ{partyWord(K)}รายนี้</td></tr>}
            </tbody>
            {chosen.length > 0 && <tfoot><tr><td colSpan={K.module === 'AP' ? 9 : 8} className="r">เลือก {chosen.length} ใบ — ยอดชำระตามใบกำกับ (ใบลดหนี้หักออก)</td><td className="r"><b><Money v={t.billed} /></b></td></tr></tfoot>}
          </table>}
        </div>}
        {tab === 'pay' && <PaymentsTable pays={pays} setPays={setPays} direction={K.direction} partyId={h.party?.id ?? null} readOnly={ro} payDate={h.payment_date} rest={!h.cash ? t.cash : ''} onDirty={() => setDirty(true)} />}
        {tab === 'wht' && K.cls === 'PS' && <WhtTable whts={whts} setWhts={setWhts} readOnly={ro} base={baseOfChosen} defaults={{ form: h.whtForm, rate: h.whtRate }} canAdd={chosen.length > 0} dirty={dirty} onDirty={() => setDirty(true)} />}
        {tab === 'fee' && isRe && <ChargesTable head={chHead} setHead={setChHead} lines={charges} setLines={setCharges} readOnly={ro} onDirty={() => setDirty(true)} />}
        {tab === 'vat' && id && <DocVatTab headerId={id} cls={K.cls} vatBasis="2" />}
        {tab === 'vat' && id && isRe && charges.some((c) => c.vat_type === '1') && <><h3 className="section-title">ภาษีซื้อจากรายการที่แพลตฟอร์มหัก</h3><DocVatTab headerId={id} cls="OE" /></>}
        {tab === 'gl' && id && <DocJournalTab id={id} />}
        <div className="trade-foot">
          <Field label="หมายเหตุ"><textarea rows={2} value={h.remark} maxLength={2000} disabled={ro} onChange={(e) => set({ remark: e.target.value })} /></Field>
          <table className="totals-table"><tbody>
            <tr><td>ยอดชำระตามใบกำกับ</td><td className="r"><Money v={t.billed} /></td></tr>
            <tr><td>{K.direction === 'R' ? 'ดอกเบี้ยรับ (รับเกิน)' : 'ดอกเบี้ยจ่าย (จ่ายล่าช้า)'}</td><td><MoneyInput value={h.interest} disabled={ro} onChange={(v) => set({ interest: v })} aria-label="ดอกเบี้ย" /></td></tr>
            <tr><td>{K.direction === 'R' ? 'หัก ส่วนลดเงินสด' : 'หัก ส่วนลดเงินสดรับ'}</td><td><MoneyInput value={h.discount} disabled={ro} onChange={(v) => set({ discount: v })} aria-label="ส่วนลดเงินสด" /></td></tr>
            <tr><td>หัก {K.direction === 'R' ? 'ภาษีถูกหัก ณ ที่จ่าย' : <a href="#wht" onClick={(e) => { e.preventDefault(); setTab('wht'); }}>ภาษีหัก ณ ที่จ่าย</a>}</td>
              <td>{K.cls === 'PS' && whts.length ? <span className="r num" style={{ display: 'block' }}>{fmt(whtTotal.toFixed(2))}</span> : <MoneyInput value={h.wht} disabled={ro} onChange={(v) => set({ wht: v })} aria-label="ภาษีหัก ณ ที่จ่าย" />}</td></tr>
            {isRe && (charges.length > 0 || !ro) && <tr><td>หัก <a href="#fee" onClick={(e) => { e.preventDefault(); setTab('fee'); }}>รายการที่แพลตฟอร์มหัก (GP/ค่าธรรมเนียม)</a></td><td className="r num">{fmt(feeTotal)}</td></tr>}
            <tr><td title="กำไรป้อนยอดบวก ขาดทุนป้อนยอดติดลบ — ลงบัญชีกำไร(ขาดทุน)จากอัตราแลกเปลี่ยน (เริ่มระบบ › บัญชีเพื่อลงรายวัน)">กำไร(ขาดทุน)อัตราแลกเปลี่ยน</td><td><MoneyInput value={h.fx} disabled={ro} onChange={(v) => set({ fx: v })} aria-label="ผลต่างอัตราแลกเปลี่ยน" /></td></tr>
            <tr className="grand"><td>ยอดที่ต้อง{rp(K)}</td><td className="r"><Money v={t.due} /></td></tr>
            <tr><td>ชำระโดยอื่น ๆ (เช็ค/โอน)</td><td className="r"><Money v={t.other} /></td></tr>
            <tr><td>เงินสด</td><td><MoneyInput value={h.cash} disabled={ro} placeholder={fmt(t.cash)} onChange={(v) => set({ cash: v })} aria-label="เงินสด" /></td></tr>
            <tr><td>ยอดชำระจริง</td><td className="r"><b><Money v={t.paid} /></b></td></tr>
            {!t.ok && chosen.length > 0 && <tr><td colSpan={2} className="bad small">{d(t.cash).lt(0) ? `ชำระโดยวิธีอื่นมากกว่ายอดที่ต้อง${rp(K)} ${fmt(d(t.cash).neg().toFixed(2))}` : `ยอดชำระตามใบกำกับไม่เท่ากับยอดชำระจริง ต่าง ${fmt(t.diff)} — ล้างช่องเงินสดให้คำนวณเอง หรือปรับส่วนลด/ดอกเบี้ย`}</td></tr>}
          </tbody></table>
        </div>
      </div>}
      {vatCheck && <VatCheckAfterSave headerId={vatCheck} cls={K.cls} onDone={() => setVatCheck(null)} />}
      <KeyHints keys={[['Enter', 'ช่องถัดไป (ช่องสุดท้าย = ถามบันทึก)'], ['Alt+E', 'แก้ไขเอกสารที่บันทึกแล้ว'], ['F4', 'ค้นหารหัส'], ['F5', 'บิลค้าง'], ['F7', 'ชำระโดยอื่น'], ...(isRe ? [['F8', 'หักโดยแพลตฟอร์ม'] as [string, string]] : []), ['F9', 'บันทึก'], ['Ctrl+Enter', 'บันทึก+ใหม่'], ['Alt+C', 'ยกเลิกเอกสาร'], ['Esc', 'กลับรายการ']]} />
      {askCancel && <Confirm danger title="ยกเลิกเอกสาร" text={<>ยกเลิก <b>{cur.data?.doc_no}</b>? เอกสารและใบสำคัญจะเป็นสถานะยกเลิก (ไม่ลบ) · บิลที่ตัดกลับเป็นค้างชำระ · เช็คออกจากทะเบียน{K.cls === 'PS' ? ' · ภาษีหัก ณ ที่จ่ายยกเลิก' : ''}</>} okText="ยกเลิกเอกสาร" onClose={() => setAskCancel(false)} onOk={cancelDoc}>
        <Field label="เหตุผลที่ยกเลิก" req><input autoFocus value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></Field>
      </Confirm>}
    </div>
  );
}
