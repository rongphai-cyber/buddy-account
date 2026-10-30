import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { computeDoc, d, dueDate, fmt, TRADE_KINDS, todayIso, wht50FormOf, type TradeKind } from '@buddy/core';
import { api } from '../../api';
import { useCan, useSession } from '../../session';
import { focusAfterTable, LkSelect, SearchPick, useLookups } from '../../components/LkSelect';
import { useDocNo } from '../../components/DocNo';
import { NumInput, Confirm, cx, DateInput, DateText, ErrorBox, Field, KeyHints, Modal, Money, MoneyInput, navKey, PageHead, Pill, Tabs, toast, useHotkeys } from '../../ui';
import { DiscountInput, LineAmountInput } from '../../components/DiscountInput';
import { DocLink } from '../../components/DocLink';
import { useDocEdit } from '../../components/DocEdit';
import { AiBillButton, type AiBillResult } from '../../components/AiBill';
import { DocActions } from '../../components/DocPrint';
import { CancelStamp } from '../../components/DocDelete';
import { DocTypeTabs, initialType, NO_TYPE_MSG, TypeNotice, useTypeTabs } from '../../components/DocTypeTabs';
import { bookStyle, typeColorIn } from '../../bookColor';
import { DocVatTab, DocWhtList, VAT_KIND_OF, VatCheckAfterSave, vatTabLabel } from '../../components/DocTaxTabs';
import { WhtTable, whtsBody, whtsFrom, type Wht } from './MoneyParts';

const kindOf = (path: string) => TRADE_KINDS.find((k) => k.path === path)!;
const partyEndpoint = (K: TradeKind) => (K.party === 'customer' ? '/api/v1/customers' : '/api/v1/suppliers');
const partyWord = (K: TradeKind) => (K.party === 'customer' ? 'ลูกค้า' : 'ผู้จำหน่าย');
const TONE = (K: TradeKind) => (K.module === 'AR' ? 'sales' : 'purchase');
/** บิลที่หักเงินมัดจำได้ (S-IV-01 ช่องหักมัดจำ, S-PU-03) */
const DEPOSIT_CLASSES = ['IV', 'HS', 'RR', 'HP'];

/* ---------------------------------------------------------------- รายการเอกสาร */
interface ListRow { id: string; doc_no: string; doc_date: string; due_date: string | null; delivery_date: string | null; party_name: string; party_code: string | null; net_amount: string; vat_amount: string; doc_status: string; gl_posted: string; ref_no: string | null; outstanding: string | null }
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
  const tt = useTypeTabs(K.cls);
  const list = useQuery({ queryKey: [K.path, q, from, to, status, tt.tab], queryFn: () => api.get<{ total: number; rows: ListRow[] }>(`/api/v1/${K.path}`, { type_id: tt.tab || undefined, q, from, to, status, limit: 500 }), placeholderData: (p) => p });
  useHotkeys({ Insert: can('add') ? () => nav(tt.newUrl(`${K.route}/new`)) : undefined }, [tt.tab, ]);
  const total = list.data?.rows.filter((r) => r.doc_status !== 'C').reduce((s, r) => s.plus(d(r.net_amount)), d(0));
  return (
    <div className="page" data-tone={TONE(K)}>
      <PageHead eyebrow={`${K.module === 'AR' ? 'ขาย' : 'ซื้อ'} › ${K.label}`} title={K.label}
        lead={`บันทึกแล้วลงบัญชีทันที (ดูใบสำคัญได้ที่เอกสาร) · ยกเลิก = เปลี่ยนสถานะ ไม่ลบ · เอกสารที่${K.module === 'AR' ? 'รับ' : 'จ่าย'}ชำระแล้วแก้ไข/ยกเลิกไม่ได้`}
        actions={can('add') && <button className={cx('primary', tt.color && 'book-btn')} style={bookStyle(tt.color)} onClick={() => nav(tt.newUrl(`${K.route}/new`))}>+ เพิ่ม{K.label} {tt.cur ? `${tt.cur.code} ` : ''}<kbd>Ins</kbd></button>} />
      {TRADE_KINDS.filter((k) => k.menu === K.menu).length > 1 && <div className="seg kind-switch">{TRADE_KINDS.filter((k) => k.menu === K.menu).map((k) => <button key={k.path} className={cx(k.path === K.path && 'on')} onClick={() => nav(k.route)}>{k.label}</button>)}</div>}
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
          <thead><tr><th style={{ width: 130 }}>เลขที่</th><th style={{ width: 110 }}>วันที่</th><th style={{ width: 100 }}>รหัส</th><th>{partyWord(K)}</th>{K.refInvoice && <th style={{ width: 120 }}>อ้างใบกำกับ</th>}<th className="r" style={{ width: 120 }}>ภาษี</th><th className="r" style={{ width: 140 }}>ยอดรวมทั้งสิ้น</th>{K.order ? <th style={{ width: 120 }}>{K.cls === 'QT' ? 'ยืนราคาถึง' : 'กำหนดส่ง'}</th> : !K.payments && <th className="r" style={{ width: 130 }}>ค้างชำระ</th>}<th style={{ width: 90 }}>สถานะ</th></tr></thead>
          <tbody>
            {list.data?.rows.map((r) => (
              <tr key={r.id} className={cx('row-open', r.doc_status === 'C' && 'cancelled')} tabIndex={0} onClick={() => nav(`${K.route}/${r.id}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`${K.route}/${r.id}`)}>
                <td className="mono">{r.doc_no}</td><td><DateText v={r.doc_date} /></td><td className="mono">{r.party_code}</td><td>{r.party_name}</td>{K.refInvoice && <td className="mono">{r.ref_no}</td>}
                <td className="r"><Money v={r.vat_amount} blankZero /></td><td className="r"><Money v={r.net_amount} /></td>{K.order ? <td><DateText v={K.cls === 'QT' ? r.due_date : r.delivery_date} /></td> : !K.payments && <td className="r"><Money v={r.outstanding} blankZero /></td>}
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
      <p><b><DocLink id={j.id} no={j.voucher_no} cls="GL" /></b> สมุด {j.book_code} {j.book_name} {j.doc_status === 'C' && <Pill tone="x">ยกเลิก</Pill>}</p>
      <table className="grid"><thead><tr><th style={{ width: 110 }}>เลขที่บัญชี</th><th>ชื่อบัญชี</th><th className="r">เดบิต</th><th className="r">เครดิต</th><th style={{ width: 150 }}>ที่มาของบัญชี</th></tr></thead>
        <tbody>{j.lines.map((l) => <tr key={l.line_no}><td className="mono">{l.account_no}</td><td>{l.account_name}</td><td className="r"><Money v={l.debit} blankZero /></td><td className="r"><Money v={l.credit} blankZero /></td>
          <td className="small muted">{({ '1': 'ประเภทเอกสาร', '2': 'แฟ้มหลัก', '3': 'บัญชีเพื่อลงรายวัน', S: 'บัญชีพัก ⚠' } as Record<string, string>)[l.resolved_from] ?? ''}</td></tr>)}</tbody></table></div>)}
      {journal.data && !journal.data.journals.length && <p className="muted">ยังไม่มีใบสำคัญ (ไม่เชื่อมต่อระบบบัญชี หรือเอกสารชนิดนี้ไม่ลงบัญชี)</p>}</div>
  );
}

/** S-IV-02/03/04 · S-PU-03a: เลือกรายการค้างส่ง/ค้างรับจากใบสั่ง แล้วป้อนจำนวนที่ส่งครั้งนี้ */
interface OpenLine { header_id: string; doc_no: string; doc_date: string; price_type: string; line_id: string; line_no: number; item_id: string | null; item_code: string | null; description: string | null;
  warehouse_id: string | null; unit_id: string | null; factor: string; unit_price: string; discount_text: string | null; is_free: boolean; delivery_date: string | null; ordered_qty: string; remaining_qty: string }
type RefLine = { id: string; item_id: string; item_code: string | null; description: string | null; warehouse_id: string | null; qty: string; unit_id: string | null; factor: string; unit_price: string; discount_text: string | null; is_free: boolean; vat_code: string | null; line_kind?: string };
/** เลือกรายการจากใบกำกับเดิม (S-PU-04b / S-PU-05a · ใบเพิ่มหนี้/ลดหนี้): นำสินค้า จำนวน ราคา จากใบกำกับที่อ้างถึงมาแก้ไขต่อ */
function RefInvoicePicker({ K, refId, onPick, onClose }: { K: TradeKind; refId: string; onPick: (rows: Array<RefLine & { pick_qty: string; pick_price: string }>) => void; onClose: () => void }) {
  const path = K.module === 'AR' ? 'sales-invoices' : 'purchase-invoices';
  const q = useQuery({ queryKey: [path, 'one', refId, 'pick'], queryFn: () => api.get<{ doc_no: string; lines: RefLine[] }>(`/api/v1/${path}/${refId}`) });
  const [sel, setSel] = useState<Record<string, { qty: string; price: string }>>({});
  const rows = (q.data?.lines ?? []).filter((l) => l.item_id);
  const chosen = rows.filter((r) => sel[r.id] && d(sel[r.id]!.qty || 0).gt(0));
  const word = K.cls === 'CN' || K.cls === 'DN' ? 'ลดหนี้/คืน' : 'เพิ่มหนี้';
  return (
    <Modal title={`เลือกรายการจากใบกำกับเดิม ${q.data?.doc_no ?? ''}`} size="wide" onClose={onClose}
      footer={<><button onClick={onClose}>ยกเลิก</button><button className="primary" disabled={!chosen.length} onClick={() => onPick(chosen.map((r) => ({ ...r, pick_qty: sel[r.id]!.qty, pick_price: sel[r.id]!.price })))}>นำ {chosen.length} รายการเข้าเอกสาร</button></>}>
      <ErrorBox error={q.error} />
      <p className="hint">ติ๊กรายการที่จะ{word} แก้จำนวน/ราคาได้ — {K.cls === 'CN' || K.cls === 'DN' ? 'ลดราคา: ใส่จำนวนตามเดิมและราคาส่วนที่ลด · คืนสินค้า: ใส่จำนวนที่คืน' : 'ใส่จำนวนและราคาส่วนที่เพิ่ม'}</p>
      <table className="grid">
        <thead><tr><th style={{ width: 36 }} /><th style={{ width: 130 }}>รหัส</th><th>รายละเอียด</th><th className="r" style={{ width: 90 }}>จำนวนเดิม</th><th className="r" style={{ width: 110 }}>ราคาเดิม</th><th className="r" style={{ width: 100 }}>จำนวน</th><th className="r" style={{ width: 120 }}>ราคา/หน่วย</th></tr></thead>
        <tbody>
          {rows.map((r) => { const on = !!sel[r.id]; return (
            <tr key={r.id} className={cx(on && 'picked')}>
              <td className="c"><input type="checkbox" checked={on} onChange={(e) => setSel((m) => { const n = { ...m }; if (e.target.checked) n[r.id] = { qty: d(r.qty).toString(), price: d(r.unit_price).toString() }; else delete n[r.id]; return n; })} aria-label={`เลือก ${r.item_code}`} /></td>
              <td className="mono">{r.item_code}</td><td>{r.description}{r.is_free && <span className="muted small"> (ของแถม)</span>}</td><td className="r">{d(r.qty).toString()}</td><td className="r num">{fmt(r.unit_price)}</td>
              <td>{on && <NumInput value={sel[r.id]!.qty} onChange={(v) => setSel((m) => ({ ...m, [r.id]: { ...m[r.id]!, qty: v } }))} aria-label="จำนวน" />}</td>
              <td>{on && <NumInput places={2} value={sel[r.id]!.price} onChange={(v) => setSel((m) => ({ ...m, [r.id]: { ...m[r.id]!, price: v } }))} aria-label="ราคา" />}</td>
            </tr>); })}
          {q.data && !rows.length && <tr><td colSpan={7} className="empty">ใบกำกับนี้ไม่มีรายการสินค้า</td></tr>}
        </tbody>
      </table>
    </Modal>
  );
}

function OrderPicker({ K, partyId, invoiceId, priceType, taken, onPick, onClose }: { K: TradeKind; partyId: string; invoiceId: string | null; priceType: string; taken: string[]; onPick: (rows: Array<OpenLine & { qty: string }>) => void; onClose: () => void }) {
  const open = useQuery({ queryKey: ['orders-open', K.orderRef, partyId, invoiceId], queryFn: () => api.get<{ rows: OpenLine[] }>('/api/v1/orders/open', { cls: K.orderRef!, party_id: partyId, ...(invoiceId ? { invoice_id: invoiceId } : {}) }), staleTime: 0 });
  const [qty, setQty] = useState<Record<string, string>>({});
  const rows = (open.data?.rows ?? []).filter((r) => !taken.includes(r.line_id));
  const word = K.orderRef === 'SO' ? 'ใบสั่งขาย' : 'ใบสั่งซื้อ';
  const chosen = rows.filter((r) => qty[r.line_id] !== undefined && d(qty[r.line_id] || 0).gt(0));
  return (
    <Modal title={`อ้าง${word} — เลือกรายการค้าง${K.orderRef === 'SO' ? 'ส่ง' : 'รับ'}`} size="wide" onClose={onClose}
      footer={<><button onClick={onClose}>ยกเลิก</button><button className="primary" disabled={!chosen.length} onClick={() => onPick(chosen.map((r) => ({ ...r, qty: qty[r.line_id]! })))}>นำ {chosen.length} รายการเข้าบิล <kbd>F5</kbd></button></>}>
      <ErrorBox error={open.error} />
      <table className="grid">
        <thead><tr><th style={{ width: 36 }} /><th style={{ width: 130 }}>{word}</th><th style={{ width: 110 }}>วันที่</th><th style={{ width: 120 }}>รหัส</th><th>รายละเอียด</th><th style={{ width: 110 }}>กำหนดส่ง</th><th className="r" style={{ width: 90 }}>สั่ง</th><th className="r" style={{ width: 90 }}>ค้าง</th><th className="r" style={{ width: 110 }}>ส่งครั้งนี้</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const on = qty[r.line_id] !== undefined;
            const bad = r.price_type !== priceType;
            return (
              <tr key={r.line_id} className={cx(on && 'picked')}>
                <td className="c"><input type="checkbox" checked={on} disabled={bad} title={bad ? 'ประเภทราคาของใบสั่งไม่ตรงกับบิล' : undefined} onChange={(e) => setQty((m) => { const n = { ...m }; if (e.target.checked) n[r.line_id] = d(r.remaining_qty).toString(); else delete n[r.line_id]; return n; })} aria-label={`เลือก ${r.doc_no} บรรทัด ${r.line_no}`} /></td>
                <td className="mono">{r.doc_no}</td><td><DateText v={r.doc_date} /></td><td className="mono">{r.item_code}</td><td>{r.description}{bad && <span className="bad small"> ประเภทราคาไม่ตรง</span>}</td><td><DateText v={r.delivery_date} /></td>
                <td className="r">{d(r.ordered_qty).toString()}</td><td className="r">{d(r.remaining_qty).toString()}</td>
                <td>{on && <NumInput value={qty[r.line_id]} onChange={(v) => setQty((m) => ({ ...m, [r.line_id]: v }))} aria-label={`จำนวนส่ง ${r.doc_no} ${r.line_no}`} />}</td>
              </tr>
            );
          })}
          {open.data && !rows.length && <tr><td colSpan={9} className="empty">ไม่มี{word}ค้าง{K.orderRef === 'SO' ? 'ส่ง' : 'รับ'}ของรายนี้</td></tr>}
        </tbody>
      </table>
    </Modal>
  );
}

/* ---------------------------------------------------------------- หน้าเอกสาร */
interface ItemHit { id: string; code: string; name_th: string; item_type: string; vat_code: string | null; base_unit_id: string | null; sales_unit_id: string | null; sales_factor: string | null; purchase_unit_id: string | null; purchase_factor: string | null; price_1: string | null; price_2: string | null; price_3: string | null; price_4: string | null; price_5: string | null; std_cost: string | null }
interface Line { key: number; item_id: string; item_code: string; description: string; warehouse_id: string | null; qty: string; unit_id: string | null; factor: string; unit_price: string; discount_text: string; is_free: boolean; return_to_stock: boolean; vat_exempt: boolean;
  /** บรรทัดใบสั่งที่อ้าง (บิล) */ source_line_id?: string | null; source_no?: string | null; source_header_id?: string | null;
  /** ใบสั่ง: รหัสบรรทัด + ยอดค้าง (ดูอย่างเดียว) */ line_id?: string; remaining?: string | null; delivered?: string | null; cancelled?: string | null }
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
  const defs = useQuery({ queryKey: ['trade-defaults', K.cls], queryFn: () => api.get<{ types: Array<{ id: string; code: string; name_th: string; next_no: string; price_type: string | null; vat_rate: string | null; vat_basis: string | null; warehouse_id?: string | null }>; main_warehouse_id?: string | null; vat_rate: number; price_type: string ; service_vat_basis?: string }>(`/api/v1/trade-defaults/${K.cls}`) });
  const depts = useQuery({ queryKey: ['departments'], queryFn: () => api.get<Array<{ id: string; code: string; name_th: string; status: string }>>('/api/v1/departments') });
  const slms = useQuery({ enabled: K.module === 'AR', queryKey: ['salespersons'], queryFn: () => api.get<Array<{ id: string; code: string; name: string; status: string }>>('/api/v1/salespersons') });
  const methods = useQuery({ enabled: !!K.payments, queryKey: ['payment-methods', K.module === 'AR' ? 'R' : 'P'], queryFn: () => api.get<Array<{ id: string; code: string; name_th: string; status: string }>>(`/api/v1/payment-methods/${K.module === 'AR' ? 'R' : 'P'}`) });
  const cur = useQuery({ enabled: !!id, queryKey: [K.path, 'one', id], queryFn: () => api.get<Record<string, unknown> & { lines: Array<Record<string, unknown>>; payments: Array<Record<string, unknown>>; settlements: Array<{ id: string; doc_no: string; doc_date: string; doc_class: string; amount: string; doc_status: string }>; deposits: Array<{ header_id: string; doc_no: string; amount: string }>; deliveries: Array<{ id: string; doc_class: string; doc_no: string; doc_date: string; order_line_no: number; item_code: string | null; qty: string }>;
    cancels: Array<{ id: string; line_no: number; cancelled_qty: string; cancel_reason_code: string | null; cancel_date: string | null }>; converted: Array<{ id: string; doc_no: string; doc_date: string }>; editable: boolean; doc_no: string; doc_status: string; outstanding: string | null }>(`/api/v1/${K.path}/${id}`), staleTime: 0 });
  const [h, setH] = useState<Head | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [pays, setPays] = useState<Pay[]>([]);
  const [delivery, setDelivery] = useState('');
  /** บิลซื้อ: วันที่ใบกำกับภาษีของผู้จำหน่าย (เข้าแฟ้มภาษีซื้อ) */
  const [refDate, setRefDate] = useState('');
  const supInv = K.module === 'AP' && !K.refInvoice && !K.order;
  const [pickOrder, setPickOrder] = useState(false);
  const [pickRef, setPickRef] = useState(false);
  const [cancelLine, setCancelLine] = useState<Line | null>(null);
  const [askConvert, setAskConvert] = useState(false);
  const canSO = useCan('SA.SO');
  /** หักเงินมัดจำ: ใบมัดจำ → ยอดที่หัก */
  const [deps, setDeps] = useState<Record<string, string>>({});
  const [tab, setTab] = useState('lines');
  /** ซื้อเงินสด: ภาษีหัก ณ ที่จ่าย (รายละเอียด) · ขายเงินสด: ยอดที่ลูกค้าหักไว้ · หลังบันทึก: เปิดรายการภาษีซื้อให้ตรวจ */
  const [whts, setWhts] = useState<Wht[]>([]);
  const [whtAmt, setWhtAmt] = useState('');
  const [whtDef, setWhtDef] = useState<{ form: 'S03' | 'S53'; rate: string }>({ form: 'S53', rate: '3' });
  const [vatCheck, setVatCheck] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [askCancel, setAskCancel] = useState(false);
  // ถามภาระภาษีเมื่อรายการแรกเป็นสินค้าบริการ (S-SL-01 / S-PU-C1) · ถามของแถมเมื่อไม่ป้อนราคา (S-PU-C3)
  const [askBasis, setAskBasis] = useState(false);
  const [askFree, setAskFree] = useState<{ key: number; andNew: boolean } | null>(null);
  const [notFree, setNotFree] = useState<Set<number>>(new Set());
  const [reason, setReason] = useState('');
  const [dirty, setDirty] = useState(false);
  const date0 = me?.work_date ?? todayIso();
  if (!h && !id && defs.data) {
    const t = initialType(defs.data.types);
    setH({ doc_type_id: t?.id ?? '', doc_date: date0, party: null, bill_to: null, party_tax_branch_no: '', your_ref: '', ref: null, department_id: '', salesperson_id: '', sales_area_code: '', ship_via_code: '', credit_days: '',
      price_type: ((t?.price_type || defs.data.price_type || '2') as Head['price_type']), vat_rate: num(t?.vat_rate ?? defs.data.vat_rate), vat_basis: (t?.vat_basis === '2' ? '2' : '1'), discount_text: '', remark: '', price_level: '1' });
  }
  if (!h && id && cur.data) {
    const c = cur.data as Record<string, string | null>;
    setH({ doc_type_id: c.doc_type_id!, doc_date: String(c.doc_date).slice(0, 10), party: { id: (c.customer_id ?? c.supplier_id)!, code: c.party_code ?? '', name: c.party_name }, bill_to: c.bill_to_customer_id ? { id: c.bill_to_customer_id, code: '' } : null,
      party_tax_branch_no: c.party_tax_branch_no ?? '', your_ref: c.your_ref ?? '', ref: c.ref_no ? { id: c.ref_header_id ?? '', code: c.ref_no } : null, department_id: c.department_id ?? '', salesperson_id: c.salesperson_id ?? '', sales_area_code: c.sales_area_code ?? '', ship_via_code: c.ship_via_code ?? '',
      credit_days: c.credit_days === null ? '' : String(c.credit_days), price_type: (c.price_type ?? '2') as Head['price_type'], vat_rate: num(c.vat_rate), vat_basis: (c.vat_basis === '2' ? '2' : '1'), discount_text: c.discount_text ?? '', remark: c.remark ?? '', price_level: '1' });
    setWhts(whtsFrom((cur.data as { wht?: Parameters<typeof whtsFrom>[0] }).wht ?? [])); setWhtAmt(d(c.wht_amount ?? 0).isZero() ? '' : num(c.wht_amount));
    setLines(cur.data.lines.map((l) => ({ key: ++seq, item_id: String(l.item_id), item_code: String(l.item_code ?? ''), description: String(l.description ?? ''), warehouse_id: (l.warehouse_id as string) ?? null, qty: num(l.qty), unit_id: (l.unit_id as string) ?? null, factor: num(l.factor) || '1',
      unit_price: num(l.unit_price), discount_text: String(l.discount_text ?? ''), is_free: !!l.is_free, return_to_stock: !!l.return_to_stock, vat_exempt: l.vat_code === '0',
      source_line_id: (l.source_line_id as string) ?? null, source_no: (l.source as { doc_no?: string } | null)?.doc_no ?? null, source_header_id: (l.source as { header_id?: string } | null)?.header_id ?? null, line_id: l.id as string,
      remaining: (l.remaining_qty as string) ?? null, delivered: (l.delivered_qty as string) ?? null, cancelled: (l.cancelled_qty as string) ?? null })));
    setDelivery(c.delivery_date ? String(c.delivery_date).slice(0, 10) : '');
    setRefDate(c.ref_date ? String(c.ref_date).slice(0, 10) : '');
    setPays(cur.data.payments.map((p) => ({ key: ++seq, payment_method_id: String(p.payment_method_id), amount: num(p.amount), reference_no: String(p.reference_no ?? '') })));
    setDeps(Object.fromEntries(cur.data.deposits.map((x) => [x.header_id, num(x.amount)])));
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
  const set = (p: Partial<Head>) => { setH((x) => ({ ...x!, ...p })); setDirty(true); };
  const setLine = (k: number, p: Partial<Line>) => { setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...p } : l))); setDirty(true); };
  const canDeposit = DEPOSIT_CLASSES.includes(K.cls);
  const depTotal = Object.values(deps).reduce((s, v) => s.plus(d(v || 0)), d(0));
  const depOpen = useQuery({ enabled: canDeposit && !!h?.party, queryKey: ['deposits-open', K.module, h?.party?.id, id], queryFn: () => api.get<{ rows: Array<{ header_id: string; doc_no: string; doc_date: string; price_type: string; amount: string; outstanding: string }> }>('/api/v1/deposits/open', { module: K.module, party_id: h!.party!.id, ...(id ? { invoice_id: id } : {}) }), staleTime: 0 });
  // ข้อกำหนดเจ้าของ (30/10/2569): คู่ค้ามีเงินมัดจำคงเหลือ → ถามว่าจะหักในบิลนี้หรือไม่ (ถามครั้งเดียวต่อคู่ค้า ในเอกสารใหม่)
  const [depAsk, setDepAsk] = useState(false);
  const [depAsked, setDepAsked] = useState<string | null>(null);
  useEffect(() => {
    const pid = h?.party?.id;
    if (!pid || id || readOnly || depAsked === pid || !depOpen.data?.rows.length || Object.keys(deps).length) return;
    setDepAsked(pid); setDepAsk(true);
  }, [depOpen.data, h?.party?.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const calc0 = useMemo(() => h && computeDoc({ price_type: h.price_type, vat_rate: h.vat_rate || 0, discount_text: h.discount_text, deposit_amount: depTotal.toFixed(2), lines: lines.filter((l) => l.item_id).map((l) => ({ qty: l.qty || 0, unit_price: l.is_free ? 0 : l.unit_price || 0, discount_text: l.discount_text, vat_exempt: l.vat_exempt })) }), [h, lines, depTotal]);
  const calc = calc0 && noLines ? storedCalc(calc0) : calc0;
  const payTotal = pays.reduce((s, p) => s.plus(d(p.amount || 0)), d(0));
  const whtTotal = K.cls === 'HP' ? whts.reduce((s, w) => s.plus(d(w.tax_amount || 0)), d(0)) : K.cls === 'HS' ? d(whtAmt || 0) : d(0);
  const cashLeft = calc ? d(calc.net_amount).minus(payTotal).minus(whtTotal) : d(0);

  const pickParty = async (p: { id: string; code: string; name: string } | null) => {
    setDeps({});
    if (!p) return set({ party: null });
    const x = await api.get<Record<string, string | null>>(`${partyEndpoint(K)}/${p.id}`);
    if (K.cls === 'HP') setWhtDef({ form: wht50FormOf(x.wht_form, x.tax_id) === '3' ? 'S03' : 'S53', rate: x.wht_rate && !d(x.wht_rate).isZero() ? d(x.wht_rate).toString() : '3' });
    set({ party: p, credit_days: x.credit_days === null || x.credit_days === undefined ? '' : String(x.credit_days), discount_text: x.discount_text ?? '', party_tax_branch_no: x.tax_branch_no ?? '',
      ...(K.party === 'customer' ? { salesperson_id: x.salesperson_id ?? '', sales_area_code: x.sales_area_code ?? '', ship_via_code: x.ship_via_code ?? '', price_level: x.price_level && x.price_level !== '0' ? x.price_level : '1' }
        : { ship_via_code: x.ship_via_code ?? '', ...(x.price_type ? { price_type: x.price_type as Head['price_type'] } : {}), ...(x.vat_rate ? { vat_rate: num(x.vat_rate) } : {}) }) });
  };
  const pickItem = (k: number, it: ItemHit | null) => {
    if (!it) return setLine(k, { item_id: '', item_code: '' });
    const first = !lines.some((l) => l.item_id && l.key !== k);
    if (first && it.item_type === '3' && !K.order && h?.price_type !== '0') {
      const pref = defs.data?.service_vat_basis ?? '3';
      if (pref === '1' || pref === '2') set({ vat_basis: pref }); else setAskBasis(true);
    }
    const ar = K.module === 'AR';
    const price = ar ? (it[`price_${h?.price_level || '1'}` as 'price_1'] ?? it.price_1) : it.std_cost;
    const unit = ar ? (it.sales_unit_id ?? it.base_unit_id) : (it.purchase_unit_id ?? it.base_unit_id);
    const factor = ar ? (it.sales_unit_id ? it.sales_factor : '1') : (it.purchase_unit_id ? it.purchase_factor : '1');
    const was = lines.find((l) => l.key === k);
    const fromBill = !!was && !was.item_id && !!was.unit_price;   // บรรทัดที่ AI เติมจากบิล — คงราคาตามบิล
    const stockItem = it.item_type === '0' || it.item_type === '1' || it.item_type === '2';
    const wh = was?.warehouse_id ?? (stockItem ? (defs.data?.types.find((t) => t.id === h?.doc_type_id)?.warehouse_id ?? defs.data?.main_warehouse_id ?? null) : null);
    setLine(k, { item_id: it.id, item_code: it.code, description: it.name_th, warehouse_id: wh, unit_id: unit, factor: num(factor) || '1', unit_price: fromBill ? was.unit_price : num(price), vat_exempt: it.vat_code === '0', qty: was?.qty || '1' });
  };
  /** เติมร่างจากบิลที่ AI อ่าน (T7.7) — ยังไม่บันทึก ผู้ใช้ตรวจ/เลือกรหัสที่ยังไม่พบ แล้วบันทึกเอง */
  const applyBill = async (r: AiBillResult) => {
    if (r.supplier) await pickParty({ id: r.supplier.id, code: r.supplier.code, name: r.supplier.name });
    set({ price_type: r.bill.price_type, vat_rate: r.bill.vat_rate, ...(r.bill.doc_no ? { ref: { id: '', code: r.bill.doc_no } } : {}) });
    if (r.bill.doc_date) setRefDate(r.bill.doc_date);
    setLines((ls) => [...ls.filter((l) => l.item_id), ...r.lines.map((l) => {
      const gross = d(l.qty || 0).times(d(l.unit_price || 0)).toDecimalPlaces(2), disc = l.amount ? gross.minus(d(l.amount)) : d(0);
      return { key: ++seq, item_id: l.item?.id ?? '', item_code: l.item?.code ?? '', description: l.description, warehouse_id: ls.at(-1)?.warehouse_id ?? null, qty: l.qty, unit_id: l.item?.base_unit_id ?? null,
        factor: '1', unit_price: l.unit_price, discount_text: disc.gt(0.005) ? disc.toFixed(2) : '', is_free: false, return_to_stock: false, vat_exempt: false };
    })]);
    const missing = r.lines.filter((l) => !l.item).length;
    toast(`เติมจากบิลแล้ว${r.supplier ? '' : ' — ไม่พบผู้จำหน่ายตามเลขผู้เสียภาษี เลือก/เพิ่มผู้จำหน่ายเอง'}${missing ? ` · เลือกรหัสสินค้าอีก ${missing} บรรทัด` : ''} · ตรวจยอดกับบิลก่อนบันทึก`);
  };
  const addLine = () => { setLines((ls) => [...ls, { key: ++seq, item_id: '', item_code: '', description: '', warehouse_id: ls.at(-1)?.warehouse_id ?? null, qty: '', unit_id: null, factor: '1', unit_price: '', discount_text: '', is_free: false, return_to_stock: K.cls === 'CN' || K.cls === 'DN', vat_exempt: false }]); };
  if (h && !lines.length && !id) addLine();

  /** เลือกประเภทจากแถบ (ใบใหม่) — ค่าเริ่มต้นตามประเภทนั้น */
  const pickType = (v: string) => { const t = defs.data?.types.find((x) => x.id === v); set({ doc_type_id: v, ...(t?.price_type ? { price_type: t.price_type as Head['price_type'] } : {}), ...(t?.vat_rate != null ? { vat_rate: num(t.vat_rate) } : {}), ...(t?.vat_basis ? { vat_basis: (t.vat_basis === '2' ? '2' : '1') as Head['vat_basis'] } : {}) }); };
  const tColor = typeColorIn(defs.data?.types, h?.doc_type_id);
  const tCur = defs.data?.types.find((x) => x.id === h?.doc_type_id);
  const save = async (andNew = false, ok: Set<number> = notFree) => {
    if (h && !h.doc_type_id) { setErr(new Error(NO_TYPE_MSG)); return; }
    if (!h || busy || readOnly || !can(id ? 'edit' : 'add')) return;
    const zero = lines.find((l) => l.item_id && !l.is_free && !ok.has(l.key) && d(l.unit_price || 0).isZero() && K.cls !== 'QT');
    if (zero) { setAskFree({ key: zero.key, andNew }); return; }
    setErr(null); setBusy(true);
    const body = { doc_type_id: h.doc_type_id, doc_no: dn.value, doc_date: h.doc_date, party_id: h.party?.id, bill_to_customer_id: h.bill_to?.id ?? null, party_tax_branch_no: h.party_tax_branch_no || null, your_ref: h.your_ref || null,
      ref_header_id: h.ref?.id || null, ref_no: h.ref?.code || null, ref_date: supInv ? refDate || null : null, department_id: h.department_id || null, salesperson_id: h.salesperson_id || null, sales_area_code: h.sales_area_code || null, ship_via_code: h.ship_via_code || null,
      credit_days: h.credit_days === '' ? null : Number(h.credit_days), price_type: h.price_type, vat_rate: h.vat_rate || '0', vat_basis: h.vat_basis, discount_text: h.discount_text || null, remark: h.remark || null,
      lines: lines.filter((l) => l.item_id).map((l) => ({ item_id: l.item_id, description: l.description || null, warehouse_id: l.warehouse_id, qty: l.qty || '0', unit_id: l.unit_id, factor: l.factor || '1', unit_price: l.unit_price || '0', discount_text: l.discount_text || null, is_free: l.is_free, return_to_stock: l.return_to_stock, source_line_id: l.source_line_id ?? null })),
      delivery_date: K.order && K.cls !== 'QT' ? delivery || null : null,
      payments: pays.filter((p) => p.payment_method_id && d(p.amount || 0).gt(0)).map((p) => ({ payment_method_id: p.payment_method_id, amount: p.amount, reference_no: p.reference_no || null })),
      deposits: Object.entries(deps).filter(([, v]) => d(v || 0).gt(0)).map(([header_id, amount]) => ({ header_id, amount })),
      wht: K.cls === 'HP' ? whtsBody(whts) : [], wht_amount: K.cls === 'HS' ? whtAmt || '0' : '0' };
    try {
      const r = id ? await api.put<{ id: string; doc_no: string; journal_id?: string | null; warnings?: string[] }>(`/api/v1/${K.path}/${id}`, body) : await api.post<{ id: string; doc_no: string; journal_id?: string | null; warnings?: string[] }>(`/api/v1/${K.path}`, body);
      toast(r.journal_id ? `บันทึก${K.label} ${r.doc_no} แล้ว — ลงบัญชีแล้ว` : `บันทึก${K.label} ${r.doc_no} แล้ว (ไม่ลงบัญชี)`);
      // ขายต่ำกว่าทุน (ค่าเริ่มต้นระบบขาย ข้อ 5): บันทึกแล้ว แจ้งเตือนให้ตรวจราคา
      for (const w of r.warnings ?? []) toast(`คำเตือน ${r.doc_no}: ${w}`, 'warn');
      setDirty(false); if (id) ed.lock();
      qc.invalidateQueries({ queryKey: [K.path] }); qc.invalidateQueries({ queryKey: ['doc-journal', r.id] }); qc.invalidateQueries({ queryKey: ['doc-vat'] });
      // มีภาษีซื้อ: เปิดรายการในแฟ้มภาษีซื้อให้ตรวจเลขที่/วันที่ใบกำกับทันที (แบบ Express)
      if (VAT_KIND_OF[K.cls] === 'P' && !K.order && calc && !d(calc.vat_amount).isZero() && h.vat_basis !== '2') setVatCheck(r.id);
      if (andNew) { setH(null); setLines([]); setPays([]); setDeps({}); setWhts([]); setWhtAmt(''); nav(`${K.route}/new`, { replace: true }); }
      else {
        // แสดงเอกสารตามที่บันทึกจริง (ค่าที่ระบบเติมให้ เช่น คลังหลัก) — โหลดใหม่จาก server
        if (id) await qc.refetchQueries({ queryKey: [K.path, 'one', id] });
        setH(null); setLines([]);
        if (!id) nav(`${K.route}/${r.id}`, { replace: true });
      }
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const cancelDoc = async () => {
    try { await api.post(`/api/v1/${K.path}/${id}/cancel`, { reason }); toast('ยกเลิกเอกสารแล้ว'); setAskCancel(false); qc.invalidateQueries({ queryKey: [K.path] }); nav(K.route); }
    catch (e) { setAskCancel(false); setErr(e); }
  };
  useHotkeys({ F9: () => save(), 'Ctrl+S': () => save(), 'Ctrl+Enter': () => save(true), 'Ctrl+F7': id && !K.order && VAT_KIND_OF[K.cls] ? () => setTab('vat') : undefined,
    'Ctrl+F10': K.cls === 'HP' ? () => setTab('wht') : id && (K.cls === 'RR' || K.cls === 'CP') ? () => setTab('whtb') : undefined, 'Alt+C': id && can('cancel') && cur.data?.doc_status !== 'C' ? () => setAskCancel(true) : undefined,
    Escape: () => { if (!dirty || window.confirm('มีการแก้ไขที่ยังไม่บันทึก — ออกโดยไม่บันทึก?')) nav(K.route); }, 'Ctrl+Insert': readOnly ? undefined : addLine, F6: K.orderRef && !readOnly ? () => setPickOrder(true) : K.refInvoice && !readOnly && h?.ref?.id ? () => setPickRef(true) : undefined }, []);
  const dtCode = defs.data?.types.find((t) => t.id === h?.doc_type_id);
  const srcOrders = useMemo(() => [...new Map(lines.filter((l) => l.source_header_id && l.source_no).map((l) => [l.source_header_id!, { id: l.source_header_id!, no: l.source_no! }])).values()], [lines]);
  const dn = useDocNo(dtCode, id ? cur.data?.doc_no : undefined, { disabled: readOnly, resetKey: h ? 'on' : 'off' });
  const cancelled = cur.data?.doc_status === 'C';
  const docNo = id ? cur.data?.doc_no : dn.value ?? (dtCode ? `${dtCode.code}**NEW**` : '');
  return (
    <div className={cx('page', tColor && 'book-colored', cancelled && 'doc-cancelled')} data-tone={TONE(K)} style={bookStyle(tColor)}>
      <div className="doc-title"><p className="eyebrow">{K.module === 'AR' ? 'ขาย' : 'ซื้อ'} › {K.label}</p><h1>{docNo}</h1><CancelStamp show={cancelled} reason={(cur.data as { cancel_reason?: string | null } | undefined)?.cancel_reason} />{tCur && <span className="book-pill" title="ประเภทเอกสาร">{!id ? 'กำลังบันทึก: ' : ''}{tCur.code} {tCur.name_th}</span>}
        <span className="doc-state">{cancelled ? <Pill tone="x">ยกเลิก</Pill> : id ? <Pill tone="n">{K.order ? 'บันทึกแล้ว (ไม่ลงบัญชี)' : 'ลงบัญชีแล้ว'}</Pill> : <Pill tone="m">ใหม่ — ยังไม่บันทึก</Pill>}{dirty && <Pill tone="c">มีการแก้ไขที่ยังไม่บันทึก</Pill>}{ed.locked && !roBase && !cancelled && <Pill tone="n">ดูอย่างเดียว — กด แก้ไข (Alt+E)</Pill>}{roBase && !cancelled && id && <Pill tone="d">{cur.data?.is_opening ? 'ยอดยกมา — แก้ที่เมนูคงค้าง-ยกมา' : K.order ? `${K.module === 'AR' ? 'ส่งของ' : 'รับของ'}แล้ว — แก้ไขไม่ได้` : 'ชำระแล้ว — แก้ไขไม่ได้'}</Pill>}</span></div>
      <div className="toolbar">
        <button onClick={() => { if (!dirty || window.confirm('ทิ้งการแก้ไข?')) { setH(null); setLines([]); setPays([]); setDeps({}); nav(`${K.route}/new`); } }}>+ ใหม่</button>
        <button className="primary" disabled={busy || readOnly} onClick={() => save()}>บันทึก <kbd>F9</kbd></button>
        {ed.editButton}
        <button disabled={busy || readOnly} onClick={() => save(true)}>บันทึก+ใหม่</button>
        <button disabled={!id || cancelled || !can('cancel')} onClick={() => setAskCancel(true)}>ยกเลิกเอกสาร</button>
        {K.cls === 'QT' && id && !cancelled && <button disabled={!canSO('add')} onClick={() => setAskConvert(true)}>แปลงเป็นใบสั่งขาย</button>}
        <DocActions kind="doc" id={id} dirty={dirty} menu={K.menu} typeId={h?.doc_type_id} del={{ cancelled, cancelUrl: `/api/v1/${K.path}/${id}/cancel`, listPath: K.route }} />
        {supInv && !readOnly && h && <AiBillButton target={K.path} onApply={applyBill} />}
        <button onClick={() => nav(K.route)}>รายการ <kbd>Esc</kbd></button>
      </div>
      <DocTypeTabs types={defs.data?.types} value={h?.doc_type_id ?? ''} locked={!!id} onChange={pickType} />
      <TypeNotice show={!id && !!h && !h.doc_type_id} />
      {ed.dialog}
      <ErrorBox error={err ?? cur.error} />
      {K.cls === 'QT' && !!cur.data?.converted.length && <p className="hint">แปลงเป็นใบสั่งขายแล้ว: {cur.data.converted.map((x) => <span key={x.id}><DocLink id={x.id} no={x.doc_no} cls="SO" /> </span>)}</p>}
      {h && <div onKeyDown={(e) => navKey(e, ed.end)}>
        <div className="head-grid trade-head">
          <div className="col">
            <Field label={`รหัส${partyWord(K)}`} req><SearchPick<{ id: string; code: string; name: string; tax_id?: string | null }> endpoint={partyEndpoint(K)} value={h.party} required disabled={readOnly} autoFocus={!id} label={(r: { name: string }) => r.name} describe={(r: { tax_id?: string | null }) => r.tax_id ?? ''}
              onPick={(r: { id: string; code: string; name: string } | null) => pickParty(r)} /></Field>
            {K.party === 'customer' && <Field label="Bill to" hint="ชื่อบนใบกำกับ ถ้าเรียกเก็บในนามอื่น"><SearchPick endpoint="/api/v1/customers" value={h.bill_to} disabled={readOnly} label={(r: { name: string }) => r.name} onPick={(r: { id: string; code: string; name: string } | null) => set({ bill_to: r })} /></Field>}
            <Field label="สาขา#"><input className="mono" value={h.party_tax_branch_no} maxLength={5} disabled={readOnly} onChange={(e) => set({ party_tax_branch_no: e.target.value })} /></Field>
            <Field label="อ้างอิง" hint={srcOrders.length ? <>{K.orderRef === 'SO' ? 'ใบสั่งขายที่อ้าง:' : 'ใบสั่งซื้อที่อ้าง:'} {srcOrders.map((o) => <span key={o.id}><DocLink id={o.id} no={o.no} cls={K.orderRef} keep={dirty} /> </span>)}</> : undefined}><input value={h.your_ref} maxLength={30} disabled={readOnly} onChange={(e) => set({ your_ref: e.target.value })} /></Field>
            {supInv && <Field label="เลขที่ใบกำกับ/บิลผู้จำหน่าย / ลงวันที่" hint="เข้าแฟ้มภาษีซื้อ — ว่าง = ใช้เลขที่/วันที่เอกสาร"><div className="pair" style={{ gridTemplateColumns: 'minmax(0, 1fr) 150px' }}><input value={h.ref?.code ?? ''} maxLength={30} disabled={readOnly} onChange={(e) => set({ ref: e.target.value ? { id: '', code: e.target.value } : null })} aria-label="เลขที่ใบกำกับผู้จำหน่าย" /><DateInput value={refDate} disabled={readOnly} onChange={(v) => { setRefDate(v); setDirty(true); }} /></div></Field>}
            {K.refInvoice && <Field label="เลขที่ใบกำกับที่อ้างถึง" req hint={h.ref?.id ? <>เปิดใบกำกับ <DocLink id={h.ref.id} no={h.ref.code} keep={dirty} /></> : undefined}><SearchPick<{ id: string; doc_no: string; party_name: string; net_amount: string }> required endpoint={`/api/v1/${K.module === 'AR' ? 'sales-invoices' : 'purchase-invoices'}`} params={h.party ? { party_id: h.party.id, status: 'N' } : undefined} value={h.ref} disabled={readOnly || !h.party}
              codeOf={(r: { doc_no: string }) => r.doc_no} label={(r: { party_name: string; net_amount: string }) => `${r.party_name} ${fmt(r.net_amount)}`} onPick={(r: { id: string; doc_no: string } | null) => set({ ref: r ? { id: r.id, code: r.doc_no } : null })} placeholder={h.party ? 'พิมพ์เลขที่ใบกำกับ' : `เลือก${partyWord(K)}ก่อน`} /></Field>}
          </div>
          <div className="col">
            
            {dn.field}
            <Field label="วันที่" req><DateInput value={h.doc_date} disabled={readOnly} onChange={(v) => set({ doc_date: v })} /></Field>
            {K.order && K.cls !== 'QT' && <Field label={K.cls === 'SO' ? 'ส่งของวันที่' : 'รับของวันที่'}><DateInput value={delivery || h.doc_date} disabled={readOnly} onChange={(v) => { setDelivery(v); setDirty(true); }} /></Field>}
            {!K.payments && <Field label={K.cls === 'QT' ? 'กำหนดยืนราคา (วัน) / ครบกำหนด' : 'เครดิต (วัน) / ครบกำหนด'} hint={K.cls === 'QT' ? '0 = ไม่กำหนด ใช้อ้างซ้ำเป็นแม่แบบได้' : undefined}><div className="pair"><input type="number" min={0} value={h.credit_days} disabled={readOnly} onChange={(e) => set({ credit_days: e.target.value })} aria-label="เครดิต" /><span className="muted small" style={{ alignSelf: 'center' }}><DateText v={dueDate(h.doc_date, Number(h.credit_days || 0))} /></span></div></Field>}
            <Field label="แผนก"><select value={h.department_id} disabled={readOnly} onChange={(e) => set({ department_id: e.target.value })}><option value="">—</option>{depts.data?.filter((x) => x.status === 'A' || x.id === h.department_id).map((x) => <option key={x.id} value={x.id}>{x.code} {x.name_th}</option>)}</select></Field>
            {K.module === 'AR' && <Field label="พนักงานขาย"><select value={h.salesperson_id} disabled={readOnly} onChange={(e) => set({ salesperson_id: e.target.value })}><option value="">—</option>{slms.data?.filter((x) => x.status === 'A' || x.id === h.salesperson_id).map((x) => <option key={x.id} value={x.id}>{x.code} {x.name}</option>)}</select></Field>}
            {K.module === 'AR' && <Field label="เขตการขาย"><LkSelect rows={lk.data?.['40']} value={h.sales_area_code} disabled={readOnly} onChange={(v) => set({ sales_area_code: v })} /></Field>}
            <Field label="ขนส่งโดย"><LkSelect rows={lk.data?.['41']} value={h.ship_via_code} disabled={readOnly} onChange={(v) => set({ ship_via_code: v })} /></Field>
            <Field label="ประเภทราคา"><select value={h.price_type} disabled={readOnly} onChange={(e) => set({ price_type: e.target.value as Head['price_type'] })}><option value="0">0 ยกเว้นภาษี</option><option value="1">1 รวมภาษีแล้ว</option><option value="2">2 แยก VAT</option></select></Field>
            {K.module === 'AP' && !K.order && <Field label="ภาระภาษีซื้อ" hint="บริการ: เกณฑ์เงินสด = ภาษีซื้อเกิดเมื่อจ่ายเงิน"><select value={h.vat_basis} disabled={readOnly} onChange={(e) => set({ vat_basis: e.target.value as '1' | '2' })}><option value="1">เกณฑ์สิทธิ</option><option value="2">เกณฑ์เงินสด</option></select></Field>}
            {K.module === 'AR' && !K.order && <Field label="ภาระภาษีขาย" hint="บริการ/ผ่อนชำระ เลือกเกณฑ์เงินสดได้"><select value={h.vat_basis} disabled={readOnly} onChange={(e) => set({ vat_basis: e.target.value as '1' | '2' })}><option value="1">เกณฑ์สิทธิ</option><option value="2">เกณฑ์เงินสด</option></select></Field>}
          </div>
        </div>
        <Tabs active={tab} onChange={setTab} tabs={[{ key: 'lines', label: 'รายการสินค้า', badge: lines.filter((l) => l.item_id).length || undefined }, ...(K.payments ? [{ key: 'pay', label: `${K.module === 'AR' ? 'รับ' : 'จ่าย'}ชำระด้วยวิธีอื่น`, badge: pays.length || undefined }] : []),
          ...(canDeposit ? [{ key: 'deposit', label: 'หักเงินมัดจำ', badge: Object.keys(deps).length || undefined }] : []),
          ...(K.order && K.cls !== 'QT' && id ? [{ key: 'delivered', label: K.module === 'AR' ? 'ส่งแล้ว / ยกเลิกยอด' : 'รับแล้ว / ยกเลิกยอด', badge: cur.data?.deliveries.length || undefined }] : []),
          ...(id && !K.payments && !K.order ? [{ key: 'settle', label: `รายการ${K.module === 'AR' ? 'รับ' : 'จ่าย'}ชำระ`, badge: cur.data?.settlements.length || undefined }] : []),
          ...(K.cls === 'HP' ? [{ key: 'wht', label: 'ภาษีหัก ณ ที่จ่าย', badge: whts.length || undefined }] : []), ...(id && !K.order && VAT_KIND_OF[K.cls] ? [{ key: 'vat', label: vatTabLabel(K.cls) }] : []),
          ...(id && (K.cls === 'RR' || K.cls === 'CP') ? [{ key: 'whtb', label: 'รายการภาษีหัก ณ ที่จ่าย' }] : []), ...(id && !K.order ? [{ key: 'gl', label: 'ใบสำคัญที่ลงบัญชี' }] : [])]} />
        {tab === 'lines' && noLines && <div className="notebox">เอกสารนี้ย้ายมาจาก Express โดยไม่มีรายการสินค้า (Express เก็บเฉพาะยอดเงิน) — แสดงยอดตามเอกสาร · แก้ไขไม่ได้ ยกเลิกหรือดูการลงบัญชีได้ตามปกติ</div>}
        {tab === 'lines' && <div className="table-wrap lines">
          <table className="grid">
            <thead><tr><th style={{ width: 36 }}>#</th><th style={{ width: 210 }}>รหัส</th><th>รายละเอียด</th><th style={{ width: 90 }}>คลัง</th><th className="r" style={{ width: 90 }}>จำนวน</th><th style={{ width: 80 }}>หน่วย</th><th className="r" style={{ width: 110 }}>ราคา/หน่วย</th><th style={{ width: 90 }}>ส่วนลด</th><th style={{ width: 36 }} title="ของแถม">F</th>{(K.cls === 'CN' || K.cls === 'DN') && <th style={{ width: 36 }} title={K.cls === 'CN' ? 'รับคืนสินค้า' : 'ส่งคืนสินค้า'}>R</th>}<th className="r" style={{ width: 120 }}>จำนวนเงิน</th>{K.order && K.cls !== 'QT' && id && <th className="r" style={{ width: 90 }}>ค้าง{K.module === 'AR' ? 'ส่ง' : 'รับ'}</th>}<th style={{ width: 36 }} /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.key}>
                  <td className="muted">{i + 1}</td>
                  <td><SearchPick endpoint="/api/v1/item-search" params={{ module: K.module }} value={l.item_id ? { id: l.item_id, code: l.item_code } : null} disabled={readOnly} label={(r: ItemHit) => r.name_th} onPick={(r: ItemHit | null) => pickItem(l.key, r)}
                    required={!lines.some((x) => x.item_id && x.key !== l.key)} onEmptyEnter={focusAfterTable} aria-label={`รหัสสินค้า ${i + 1}`} /></td>
                  <td><input value={l.description} maxLength={200} disabled={readOnly} onChange={(e) => setLine(l.key, { description: e.target.value })} aria-label="รายละเอียด" />{l.source_no && <span className="small muted">อ้าง <DocLink id={l.source_header_id} no={l.source_no} cls={K.orderRef} keep={dirty} /></span>}</td>
                  <td><LkSelect byId rows={lk.data?.WH} value={l.warehouse_id} disabled={readOnly} onChange={(v) => setLine(l.key, { warehouse_id: v || null })} aria-label="คลัง" /></td>
                  <td><NumInput neg value={l.qty} disabled={readOnly} onChange={(v) => setLine(l.key, { qty: v })} aria-label="จำนวน" /></td>
                  <td><LkSelect byId rows={lk.data?.UNIT} value={l.unit_id} disabled={readOnly} onChange={(v) => setLine(l.key, { unit_id: v || null })} aria-label="หน่วย" /></td>
                  <td><NumInput places={2} value={l.unit_price} disabled={readOnly || l.is_free} onChange={(v) => setLine(l.key, { unit_price: v })} aria-label="ราคาต่อหน่วย" /></td>
                  <td><DiscountInput value={l.discount_text} disabled={readOnly} label="ส่วนลด" base={d(l.qty || 0).times(d(l.unit_price || 0)).toFixed(2)} onChange={(v) => setLine(l.key, { discount_text: v })} /></td>
                  <td className="c"><input type="checkbox" checked={l.is_free} disabled={readOnly} onChange={(e) => setLine(l.key, { is_free: e.target.checked })} aria-label="ของแถม" /></td>
                  {(K.cls === 'CN' || K.cls === 'DN') && <td className="c"><input type="checkbox" checked={l.return_to_stock} disabled={readOnly} onChange={(e) => setLine(l.key, { return_to_stock: e.target.checked })} aria-label="คืนสินค้า" /></td>}
                  <td><LineAmountInput amount={calc?.lines[lines.filter((x) => x.item_id).indexOf(l)]?.line_amount} qty={l.qty} price={l.unit_price} disabled={readOnly || l.is_free || !l.item_id}
                    onApply={(p) => setLine(l.key, p)} /></td>
                  {K.order && K.cls !== 'QT' && id && <td className="r num">{l.remaining != null && d(l.remaining).toString()}{l.remaining != null && d(l.remaining).gt(0) && can('cancel') && !cancelled && <button type="button" className="icon-btn" title="ยกเลิกยอดค้าง" onClick={() => setCancelLine(l)}>⊘</button>}</td>}
                  <td>{!readOnly && <button type="button" className="icon-btn" tabIndex={-1} title="ลบบรรทัด" onClick={() => { setLines((ls) => ls.filter((x) => x.key !== l.key)); setDirty(true); }}>✕</button>}</td>
                </tr>
              ))}
            </tbody>
            {!readOnly && <tfoot><tr><td colSpan={13}><button type="button" onClick={addLine}>+ เพิ่มบรรทัด <kbd>Ctrl+Ins</kbd></button>{K.orderRef && <> <button type="button" disabled={!h.party} onClick={() => setPickOrder(true)}>อ้าง{K.orderRef === 'SO' ? 'ใบสั่งขาย' : 'ใบสั่งซื้อ'} <kbd>F6</kbd></button></>}{K.refInvoice && <> <button type="button" disabled={!h.ref?.id} title={h.ref?.id ? '' : 'เลือกเลขที่ใบกำกับที่อ้างถึงก่อน'} onClick={() => setPickRef(true)}>เลือกรายการจากใบกำกับเดิม <kbd>F6</kbd></button></>} <span className="hint">ราคาตาม{K.module === 'AR' ? 'ตารางราคาของลูกค้า' : 'ราคาทุนมาตรฐาน'} — แก้ได้ · ของแถมติ๊ก F</span></td></tr></tfoot>}
          </table>
        </div>}
        {tab === 'pay' && <div className="table-wrap lines">
          <table className="grid">
            <thead><tr><th>วิธีชำระ</th><th className="r" style={{ width: 150 }}>จำนวนเงิน</th><th style={{ width: 200 }}>เลขที่อ้างอิง/เช็ค</th><th style={{ width: 36 }} /></tr></thead>
            <tbody>
              {pays.map((p) => (
                <tr key={p.key}>
                  <td><select value={p.payment_method_id} disabled={readOnly} onChange={(e) => { setPays((ps) => ps.map((x) => (x.key === p.key ? { ...x, payment_method_id: e.target.value } : x))); setDirty(true); }} aria-label="วิธีชำระ"><option value="">— เลือก —</option>{methods.data?.filter((m) => m.status === 'A' || m.id === p.payment_method_id).map((m) => <option key={m.id} value={m.id}>{m.code} {m.name_th}</option>)}</select></td>
                  <td><NumInput places={2} value={p.amount} disabled={readOnly} onChange={(v) => { setPays((ps) => ps.map((x) => (x.key === p.key ? { ...x, amount: v } : x))); setDirty(true); }} aria-label="จำนวนเงิน" /></td>
                  <td><input value={p.reference_no} maxLength={30} disabled={readOnly} onChange={(e) => { setPays((ps) => ps.map((x) => (x.key === p.key ? { ...x, reference_no: e.target.value } : x))); setDirty(true); }} aria-label="เลขที่อ้างอิง" /></td>
                  <td>{!readOnly && <button type="button" className="icon-btn" tabIndex={-1} onClick={() => setPays((ps) => ps.filter((x) => x.key !== p.key))}>✕</button>}</td>
                </tr>
              ))}
              {!pays.length && <tr><td colSpan={4} className="empty">{K.module === 'AR' ? 'รับ' : 'จ่าย'}เป็นเงินสดทั้งหมด</td></tr>}
            </tbody>
            <tfoot><tr><td>{!readOnly && <button type="button" onClick={() => setPays((ps) => [...ps, { key: ++seq, payment_method_id: '', amount: cashLeft.gt(0) ? cashLeft.toFixed(2) : '', reference_no: '' }])}>+ เพิ่มวิธีชำระ</button>} เงินสด <b><Money v={cashLeft.toFixed(2)} /></b></td><td className="r"><b><Money v={payTotal.toFixed(2)} /></b></td><td colSpan={2} /></tr></tfoot>
          </table>
        </div>}
        {tab === 'settle' && cur.data && <table className="grid"><thead><tr><th>เลขที่</th><th>วันที่</th><th className="r">จำนวนเงิน</th><th>สถานะ</th></tr></thead>
          <tbody>{cur.data.settlements.map((s) => <tr key={s.id}><td><DocLink id={s.id} no={s.doc_no} cls={s.doc_class} /></td><td><DateText v={s.doc_date} /></td><td className="r"><Money v={s.amount} /></td><td>{s.doc_status === 'C' ? 'ยกเลิก' : ''}</td></tr>)}
            {!cur.data.settlements.length && <tr><td colSpan={4} className="empty">ยังไม่มีการชำระ · ค้างชำระ <Money v={cur.data.outstanding} /></td></tr>}</tbody></table>}
        {tab === 'delivered' && cur.data && <div>
          <table className="grid"><thead><tr><th>เอกสาร</th><th>วันที่</th><th>บรรทัดใบสั่ง</th><th>รหัส</th><th className="r">จำนวน</th></tr></thead>
            <tbody>{cur.data.deliveries.map((x, i) => <tr key={i}><td><DocLink id={x.id} no={x.doc_no} cls={x.doc_class} /></td><td><DateText v={x.doc_date} /></td><td>{x.order_line_no}</td><td className="mono">{x.item_code}</td><td className="r">{d(x.qty).toString()}</td></tr>)}
              {!cur.data.deliveries.length && <tr><td colSpan={5} className="empty">ยังไม่มีบิลที่อ้างใบสั่งนี้</td></tr>}</tbody></table>
          {cur.data.cancels.length > 0 && <table className="grid"><thead><tr><th>บรรทัด</th><th className="r">ยกเลิกยอด</th><th>เหตุผล</th><th>วันที่ยกเลิก</th></tr></thead>
            <tbody>{cur.data.cancels.map((x) => <tr key={x.id}><td>{x.line_no}</td><td className="r">{d(x.cancelled_qty).toString()}</td><td>{x.cancel_reason_code}</td><td><DateText v={x.cancel_date} /></td></tr>)}</tbody></table>}
        </div>}
        {tab === 'deposit' && canDeposit && <div className="table-wrap lines">
          {!h.party ? <p className="empty">เลือก{partyWord(K)}ก่อน</p> : <table className="grid">
            <thead><tr><th style={{ width: 36 }} /><th style={{ width: 140 }}>ใบมัดจำ</th><th style={{ width: 110 }}>วันที่</th><th style={{ width: 120 }}>ประเภทราคา</th><th className="r" style={{ width: 130 }}>ยอดมัดจำ</th><th className="r" style={{ width: 130 }}>คงเหลือ</th><th className="r" style={{ width: 150 }}>หักในบิลนี้</th></tr></thead>
            <tbody>
              {depOpen.data?.rows.map((o) => {
                const on = deps[o.header_id] !== undefined;
                const bad = o.price_type !== h.price_type;
                return (
                  <tr key={o.header_id} className={cx(on && 'picked')}>
                    <td className="c"><input type="checkbox" checked={on} disabled={readOnly || (bad && !on)} onChange={(e) => { setDeps((m) => { const n = { ...m }; if (e.target.checked) n[o.header_id] = num(o.outstanding); else delete n[o.header_id]; return n; }); setDirty(true); }} aria-label={`หักมัดจำ ${o.doc_no}`} /></td>
                    <td><DocLink id={o.header_id} no={o.doc_no} cls={K.module === 'AR' ? 'AI' : 'AE'} keep={dirty} /></td><td><DateText v={o.doc_date} /></td><td>{o.price_type}{bad && <span className="bad small"> ไม่ตรงกับบิล</span>}</td>
                    <td className="r"><Money v={o.amount} /></td><td className="r"><Money v={o.outstanding} /></td>
                    <td>{on && <MoneyInput value={deps[o.header_id]} disabled={readOnly} onChange={(v) => { setDeps((m) => ({ ...m, [o.header_id]: v })); setDirty(true); }} aria-label={`ยอดหักมัดจำ ${o.doc_no}`} />}</td>
                  </tr>
                );
              })}
              {depOpen.data && !depOpen.data.rows.length && <tr><td colSpan={7} className="empty">ไม่มีเงินมัดจำคงเหลือของ{partyWord(K)}รายนี้</td></tr>}
            </tbody>
            <tfoot><tr><td colSpan={6} className="r">หักเงินมัดจำรวม (ตามประเภทราคาของบิล)</td><td className="r"><b><Money v={depTotal.toFixed(2)} /></b></td></tr></tfoot>
          </table>}
        </div>}
        {tab === 'wht' && K.cls === 'HP' && <WhtTable whts={whts} setWhts={setWhts} readOnly={readOnly} base={calc ? d(calc.net_amount).minus(calc.vat_amount).toFixed(2) : ''} defaults={whtDef} canAdd={!!h.party} dirty={dirty} onDirty={() => setDirty(true)} />}
        {tab === 'whtb' && id && <DocWhtList headerId={id} />}
        {tab === 'vat' && id && <DocVatTab headerId={id} cls={K.cls} vatBasis={h.vat_basis} />}
        {tab === 'gl' && id && <DocJournalTab id={id} />}
        <div className="trade-foot">
          <Field label="หมายเหตุ"><textarea id="doc-remark" rows={2} value={h.remark} maxLength={2000} disabled={readOnly} onChange={(e) => set({ remark: e.target.value })} /></Field>
          {calc && <table className="totals-table"><tbody>
            <tr><td>จำนวนเงิน</td><td className="r"><Money v={calc.amount} /></td></tr>
            <tr><td>หักส่วนลด <DiscountInput value={h.discount_text} disabled={readOnly} onChange={(v) => set({ discount_text: v })} placeholder="5+ หรือ 500" label="ส่วนลดท้ายบิล" base={calc?.amount} style={{ width: 110 }} /></td><td className="r"><Money v={calc.discount_amount} /></td></tr>
            {d(calc.deposit_amount).gt(0) && <tr><td><a href="#deposit" onClick={(e) => { e.preventDefault(); setTab('deposit'); }}>หักเงินมัดจำ</a></td><td className="r"><Money v={calc.deposit_amount} /></td></tr>}
            {d(calc.zero_rate_amount).gt(0) && h.price_type !== '0' && <tr><td>แยกยอดเงิน 0.00 %=</td><td className="r"><Money v={calc.zero_rate_amount} /></td></tr>}
            <tr><td>ภาษีมูลค่าเพิ่ม <input className="r" inputMode="decimal" value={h.vat_rate} disabled={readOnly || h.price_type === '0'} onChange={(e) => set({ vat_rate: e.target.value.replace(/[^\d.]/g, '') })} aria-label="อัตราภาษี" style={{ width: 60 }} /> %</td><td className="r"><Money v={calc.vat_amount} /></td></tr>
            <tr className="grand"><td>จำนวนเงินรวมทั้งสิ้น</td><td className="r"><Money v={calc.net_amount} /></td></tr>
            {K.cls === 'HP' && <tr><td><a href="#wht" onClick={(e) => { e.preventDefault(); setTab('wht'); }}>หักภาษี ณ ที่จ่าย</a></td><td className="r"><Money v={whtTotal.toFixed(2)} blankZero /></td></tr>}
            {K.cls === 'HS' && <tr><td>ภาษีถูกหัก ณ ที่จ่าย</td><td className="r"><MoneyInput value={whtAmt} disabled={readOnly} onChange={(v) => { setWhtAmt(v); setDirty(true); }} aria-label="ภาษีถูกหัก ณ ที่จ่าย" style={{ width: 130 }} /></td></tr>}
            {K.payments && !whtTotal.isZero() && <tr><td>ยอด{K.module === 'AR' ? 'รับ' : 'จ่าย'}จริง</td><td className="r"><b><Money v={d(calc.net_amount).minus(whtTotal).toFixed(2)} /></b></td></tr>}
            {calc.errors.length > 0 && <tr><td colSpan={2} className="bad small">{calc.errors[0]}</td></tr>}
          </tbody></table>}
        </div>
      </div>}
      {vatCheck && <VatCheckAfterSave headerId={vatCheck} cls={K.cls} onDone={() => setVatCheck(null)} />}
      <KeyHints keys={[['Enter', 'ช่องถัดไป (ช่องสุดท้าย = ถามบันทึก)'], ['Alt+E', 'แก้ไขเอกสารที่บันทึกแล้ว'], ['F4', 'ค้นหารหัส'], ['Ctrl+Ins', 'เพิ่มบรรทัด'], ['F9', 'บันทึก'], ['Ctrl+Enter', 'บันทึก+ใหม่'], ['Alt+C', 'ยกเลิกเอกสาร'], ['Esc', 'กลับรายการ']]} />
      {depAsk && depOpen.data && <Confirm title="มีเงินมัดจำคงเหลือ" okText="หักเงินมัดจำ" onClose={() => setDepAsk(false)} onOk={() => { setDepAsk(false); setTab('deposit'); }}
        text={<>{partyWord(K)}รายนี้มีเงินมัดจำคงเหลือ {depOpen.data.rows.length} ใบ รวม <Money v={depOpen.data.rows.reduce((t, o) => t.plus(d(o.outstanding)), d(0)).toFixed(2)} /> — ต้องการหักในบิลนี้หรือไม่?
          <span className="small muted" style={{ display: 'block', marginTop: 6 }}>หักได้บางส่วนหรือเต็มจำนวน (ไม่เกินยอดคงเหลือ) · ใบมัดจำต้องมีประเภทราคา/ภาษีเหมือนบิลนี้</span></>} />}
      {pickOrder && h?.party && <OrderPicker K={K} partyId={h.party.id} invoiceId={id} priceType={h.price_type} taken={lines.map((l) => l.source_line_id).filter((x): x is string => !!x)} onClose={() => setPickOrder(false)}
        onPick={(rows) => { setLines((ls) => [...ls.filter((l) => l.item_id), ...rows.map((r) => ({ key: ++seq, item_id: r.item_id ?? '', item_code: r.item_code ?? '', description: r.description ?? '', warehouse_id: r.warehouse_id, qty: r.qty, unit_id: r.unit_id, factor: num(r.factor) || '1',
          unit_price: num(r.unit_price), discount_text: r.discount_text ?? '', is_free: r.is_free, return_to_stock: false, vat_exempt: false, source_line_id: r.line_id, source_no: r.doc_no }))]); setDirty(true); setPickOrder(false); setTab('lines'); }} />}
      {pickRef && h?.ref?.id && <RefInvoicePicker K={K} refId={h.ref.id} onClose={() => setPickRef(false)}
        onPick={(rows) => { setLines((ls) => [...ls.filter((l) => l.item_id), ...rows.map((r) => ({ key: ++seq, item_id: r.item_id, item_code: r.item_code ?? '', description: r.description ?? '', warehouse_id: r.warehouse_id, qty: r.pick_qty, unit_id: r.unit_id, factor: num(r.factor) || '1',
          unit_price: r.pick_price, discount_text: '', is_free: false, return_to_stock: K.cls === 'CN' || K.cls === 'DN', vat_exempt: r.vat_code === '0' }))]); setDirty(true); setPickRef(false); setTab('lines'); }} />}
      {cancelLine && <CancelLineModal K={K} headerId={id!} line={cancelLine} onClose={() => setCancelLine(null)} onDone={async () => { setCancelLine(null); await qc.refetchQueries({ queryKey: [K.path, 'one', id] }); setH(null); qc.invalidateQueries({ queryKey: [K.path] }); }} />}
      {askConvert && <Confirm title="แปลงเป็นใบสั่งขาย" text={<>สร้างใบสั่งขายจาก <b>{cur.data?.doc_no}</b> (คัดลอกลูกค้า รายการสินค้า ราคา ส่วนลด) ลงวันที่ทำงาน</>} okText="สร้างใบสั่งขาย" onClose={() => setAskConvert(false)}
        onOk={async () => { try { const r = await api.post<{ id: string; doc_no: string }>(`/api/v1/quotations/${id}/convert`, { doc_date: me?.work_date ?? todayIso() }); toast(`สร้างใบสั่งขาย ${r.doc_no} แล้ว`); setAskConvert(false); nav(`/sa/orders/${r.id}`); } catch (e) { setAskConvert(false); setErr(e); } }} />}
      {askBasis && h && <Modal title={K.module === 'AR' ? 'ภาระภาษีขาย' : 'ภาระภาษีซื้อ'} size="confirm" onClose={() => setAskBasis(false)}
        footer={<><button className="primary" autoFocus onClick={() => { set({ vat_basis: '1' }); setAskBasis(false); }}>เกณฑ์สิทธิ</button><button onClick={() => { set({ vat_basis: '2' }); setAskBasis(false); }}>เกณฑ์เงินสด</button></>}>
        <p>ภาษี{K.module === 'AR' ? 'ขาย' : 'ซื้อ'}ของสินค้าบริการในที่นี้เป็นแบบ</p>
        <p className="small muted">เกณฑ์สิทธิ = ภาษีเกิด ณ วันที่ใบกำกับ · เกณฑ์เงินสด = ภาษีเกิดเมื่อ{K.module === 'AR' ? 'รับ' : 'จ่าย'}ชำระ (แก้ภายหลังได้ที่ช่อง "ภาระภาษี")</p>
      </Modal>}
      {askFree && (() => { const l = lines.find((x) => x.key === askFree.key); return <Modal title="ไม่ได้ป้อนราคา" size="confirm" onClose={() => setAskFree(null)}
        footer={<><button onClick={() => setAskFree(null)}>ป้อนใหม่</button><button className="primary" autoFocus onClick={() => { const k = askFree.key; setAskFree(null); setLines((ls) => ls.map((x) => (x.key === k ? { ...x, is_free: true } : x))); setDirty(true); toast(`ทำเครื่องหมายของแถม ${l?.item_code ?? ''} แล้ว — กดบันทึกอีกครั้ง`); }}>ของแถม</button>
          <button onClick={() => { const ok = new Set(notFree).add(askFree.key); setNotFree(ok); const n = askFree.andNew; setAskFree(null); void save(n, ok); }}>ไม่ใช่</button></>}>
        <p>รายการ <b className="mono">{l?.item_code}</b> {l?.description} ไม่ได้ป้อนราคา — เป็นรายการ{K.module === 'AR' ? 'แถมให้ลูกค้า' : 'ที่ผู้จำหน่ายแถมให้'}ใช่หรือไม่?</p>
      </Modal>; })()}
      {askCancel && <Confirm danger title="ยกเลิกเอกสาร" text={<>ยกเลิก <b>{cur.data?.doc_no}</b>? เอกสารและใบสำคัญจะเป็นสถานะยกเลิก (ไม่ลบ)</>} okText="ยกเลิกเอกสาร" onClose={() => setAskCancel(false)} onOk={cancelDoc}>
        <Field label="เหตุผลที่ยกเลิก" req><input autoFocus value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></Field>
      </Confirm>}
    </div>
  );
}

/** ยกเลิกยอดค้างส่ง/ค้างรับรายบรรทัด พร้อมวันที่และเหตุผล (คู่มือหน้า 207) */
function CancelLineModal({ K, headerId, line, onClose, onDone }: { K: TradeKind; headerId: string; line: Line; onClose: () => void; onDone: () => void }) {
  const { me } = useSession();
  const table = K.module === 'AR' ? '42' : '43';   // เหตุผลการยกเลิกยอดสั่งขาย / สั่งซื้อ
  const lk = useLookups(table);
  const [qty, setQty] = useState(line.remaining ? d(line.remaining).toString() : '');
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(me?.work_date ?? todayIso());
  const [err, setErr] = useState<unknown>(null);
  const ok = async () => {
    try { await api.post(`/api/v1/${K.path}/${headerId}/lines/${line.line_id}/cancel`, { qty, reason_code: reason || null, date }); toast('ยกเลิกยอดค้างแล้ว'); onDone(); } catch (e) { setErr(e); }
  };
  return (
    <Modal title={`ยกเลิกยอดค้าง — ${line.item_code}`} size="confirm" onClose={onClose} footer={<><button onClick={onClose}>ไม่ใช่</button><button className="danger" onClick={ok}>ยกเลิกยอด</button></>}>
      <ErrorBox error={err} />
      <p>ค้าง{K.module === 'AR' ? 'ส่ง' : 'รับ'} {line.remaining ? d(line.remaining).toString() : 0} — ยกเลิกบางส่วนหรือทั้งหมดได้ ประวัติยังอยู่ในเอกสาร</p>
      <div className="form-grid">
        <Field label="จำนวนที่ยกเลิก" req><NumInput autoFocus value={qty} onChange={setQty} /></Field>
        <Field label="วันที่ยกเลิก" req><DateInput value={date} onChange={setDate} /></Field>
        <Field label="เหตุผล" wide><LkSelect rows={lk.data?.[table]} value={reason} onChange={setReason} /></Field>
      </div>
    </Modal>
  );
}
