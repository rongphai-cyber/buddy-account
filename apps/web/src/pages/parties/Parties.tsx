import { useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { d, fmt } from '@buddy/core';
import { api, type FiscalYear } from '../../api';
import { useCan } from '../../session';
import { AccountCell } from '../../components/AccountCell';
import { LkSelect, useLookups } from '../../components/LkSelect';
import { MasterNotesDialog } from '../../components/Notes';
import { Confirm, cx, DateText, ErrorBox, Field, KeyHints, Modal, Money, MoneyInput, navKey, PageHead, Pill, Tabs, toast, toastError, useHotkeys } from '../../ui';

/* ---------------------------------------------------------------- ส่วนร่วม */
type Form = Record<string, string | boolean | null>;
const val = (f: Form, k: string) => (f[k] ?? '') as string;
/** ช่องข้อความทั่วไปของฟอร์ม */
function useText(f: Form | null, set: (p: Form) => void) {
  return (k: string, max: number, extra: Record<string, unknown> = {}) => ({ value: f ? val(f, k) : '', maxLength: max, onChange: (e: { target: { value: string } }) => set({ [k]: e.target.value }), ...extra });
}
const statusPill = (s: string) => (s === 'A' ? <Pill tone="n">ใช้งาน</Pill> : <Pill tone="x">เลิกใช้</Pill>);

interface ListRow { id: string; code: string; title: string | null; name: string; tax_id: string | null; tax_branch_no: string | null; phone: string | null; contact: string | null; credit_days: number | null; credit_limit: string | null; status: string; balance: string; salesperson_code?: string | null; on_hold?: boolean; wht_form?: string | null }

/** หน้ารายการลูกค้า/ผู้จำหน่าย: ค้นหาตามรหัส ชื่อ เลขผู้เสียภาษี โทรศัพท์ ผู้ติดต่อ (S-MF-01) คลิกแถวเพื่อแก้ไข */
function PartyList({ kind, eyebrow, title, lead, menu, Form: FormC }: { kind: 'customers' | 'suppliers'; eyebrow: string; title: string; lead: ReactNode; menu: string; Form: (p: { id: string | null; onClose: () => void; onSaved: () => void }) => ReactNode }) {
  const qc = useQueryClient();
  const can = useCan(menu);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'A' | 'I' | 'all'>('A');
  const [limit, setLimit] = useState(200);
  const [edit, setEdit] = useState<string | 'new' | null>(null);
  const [labels, setLabels] = useState(false);
  const list = useQuery({ queryKey: [kind, q, status, limit], queryFn: () => api.get<{ total: number; rows: ListRow[] }>(`/api/v1/${kind}`, { q, status, limit }), placeholderData: (p) => p });
  useHotkeys({ Insert: can('add') ? () => setEdit('new') : undefined }, []);
  const who = kind === 'customers' ? 'ลูกค้า' : 'ผู้จำหน่าย';
  const total = list.data?.rows.reduce((s, r) => s.plus(d(r.balance)), d(0));
  return (
    <div className="page" data-tone={kind === 'customers' ? 'sales' : 'purchase'}>
      <PageHead eyebrow={eyebrow} title={title} lead={lead}
        actions={<>{can('print') && <button onClick={() => setLabels(true)} title="พิมพ์จ่าหน้าซอง/สติ๊กเกอร์ ตามรายการที่ค้นหา">🖨 จ่าหน้าซอง/สติ๊กเกอร์</button>}{can('add') && <button className="primary" onClick={() => setEdit('new')}>+ เพิ่ม{who} <kbd>Ins</kbd></button>}</>} />
      {labels && <LabelPrint kind={kind} q={q} status={status} onClose={() => setLabels(false)} />}
      <div className="toolbar">
        <input type="search" autoFocus placeholder={`ค้นหารหัส ชื่อ เลขผู้เสียภาษี โทรศัพท์ ผู้ติดต่อ`} value={q} onChange={(e) => { setQ(e.target.value); setLimit(200); }} style={{ minWidth: 320 }} aria-label={`ค้นหา${who}`} />
        <select value={status} onChange={(e) => setStatus(e.target.value as 'A')} aria-label="สถานะ">
          <option value="A">เฉพาะที่ใช้งาน</option><option value="I">เฉพาะที่เลิกใช้</option><option value="all">ทั้งหมด</option>
        </select>
        <span className="muted small">{list.data ? `${list.data.rows.length.toLocaleString()} จาก ${list.data.total.toLocaleString()} ราย` : ''}</span>
      </div>
      <ErrorBox error={list.error} />
      <div className="table-wrap">
        <table className="grid">
          <thead><tr>
            <th style={{ width: 110 }}>รหัส</th><th>ชื่อ{who}</th><th style={{ width: 150 }}>เลขผู้เสียภาษี</th><th style={{ width: 150 }}>โทรศัพท์</th><th style={{ width: 140 }}>ผู้ติดต่อ</th>
            {kind === 'customers' ? <th style={{ width: 90 }}>พนักงานขาย</th> : <th style={{ width: 70 }}>ภ.ง.ด.</th>}
            <th className="r" style={{ width: 70 }}>เครดิต</th><th className="r" style={{ width: 120 }}>วงเงิน</th><th className="r" style={{ width: 130 }}>ยอดคงค้าง</th><th style={{ width: 80 }}>สถานะ</th>
          </tr></thead>
          <tbody>
            {list.data?.rows.map((r) => (
              <tr key={r.id} className="row-open" tabIndex={0} onClick={() => setEdit(r.id)} onKeyDown={(e) => e.key === 'Enter' && setEdit(r.id)}>
                <td className="mono">{r.code}</td><td>{r.title ? `${r.title} ` : ''}{r.name}</td>
                <td className="mono small">{r.tax_id}{r.tax_branch_no && r.tax_id ? <span className="muted"> /{r.tax_branch_no}</span> : null}</td>
                <td className="small">{r.phone}</td><td className="small">{r.contact}</td>
                <td className="mono">{kind === 'customers' ? r.salesperson_code : r.wht_form}</td>
                <td className="r">{r.credit_days || ''}</td><td className="r"><Money v={r.credit_limit} blankZero /></td><td className="r"><Money v={r.balance} blankZero /></td>
                <td>{statusPill(r.status)}{r.on_hold && <> <Pill tone="c">ระงับจ่าย</Pill></>}</td>
              </tr>
            ))}
            {list.data && !list.data.rows.length && <tr><td colSpan={10} className="empty">{q ? `ไม่พบ${who}ที่ตรงกับ "${q}"` : `ยังไม่มี${who} — กด Ins เพื่อเพิ่ม`}</td></tr>}
          </tbody>
          {!!list.data?.rows.length && <tfoot><tr><td colSpan={8} className="r">รวมยอดคงค้าง (ที่แสดง)</td><td className="r"><b><Money v={total?.toFixed(2)} /></b></td><td /></tr></tfoot>}
        </table>
      </div>
      {list.data && list.data.total > list.data.rows.length && <p><button onClick={() => setLimit((l) => l + 500)}>แสดงเพิ่มอีก 500 ราย</button></p>}
      <KeyHints keys={[['Ins', `เพิ่ม${who}`], ['คลิก/Enter', 'แก้ไข'], ['F9', 'บันทึก'], ['Esc', 'ปิด']]} />
      {edit && <FormC id={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); qc.invalidateQueries({ queryKey: [kind] }); }} />}
    </div>
  );
}

/** ผู้ติดต่อหลายคน (ข้อเสนอเพิ่มจาก Express ที่มีช่องเดียว) */
interface Contact { name: string; position: string | null; phone: string | null; email: string | null; is_primary: boolean }
function ContactsGrid({ rows, onChange }: { rows: Contact[]; onChange: (r: Contact[]) => void }) {
  const set = (i: number, p: Partial<Contact>) => onChange(rows.map((r, k) => (k === i ? { ...r, ...p } : p.is_primary ? { ...r, is_primary: false } : r)));
  return (
    <div className="table-wrap lines">
      <table className="grid">
        <thead><tr><th style={{ width: 36 }}>#</th><th>ชื่อผู้ติดต่อ</th><th style={{ width: 160 }}>ตำแหน่ง/หน้าที่</th><th style={{ width: 160 }}>โทรศัพท์</th><th style={{ width: 200 }}>อีเมล</th><th style={{ width: 70 }}>หลัก</th><th style={{ width: 40 }} /></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="muted">{i + 1}</td>
              <td><input value={r.name} maxLength={120} onChange={(e) => set(i, { name: e.target.value })} aria-label="ชื่อผู้ติดต่อ" /></td>
              <td><input value={r.position ?? ''} maxLength={60} onChange={(e) => set(i, { position: e.target.value })} placeholder="เช่น จัดซื้อ บัญชี" /></td>
              <td><input value={r.phone ?? ''} maxLength={60} onChange={(e) => set(i, { phone: e.target.value })} /></td>
              <td><input type="email" value={r.email ?? ''} maxLength={120} onChange={(e) => set(i, { email: e.target.value })} /></td>
              <td className="c"><input type="checkbox" checked={r.is_primary} onChange={(e) => set(i, { is_primary: e.target.checked })} aria-label="ผู้ติดต่อหลัก" /></td>
              <td><button type="button" className="icon-btn" tabIndex={-1} title="ลบบรรทัด" onClick={() => onChange(rows.filter((_, k) => k !== i))}>✕</button></td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={7} className="empty">ยังไม่มีผู้ติดต่อ</td></tr>}
        </tbody>
        <tfoot><tr><td colSpan={7}><button type="button" onClick={() => onChange([...rows, { name: '', position: null, phone: null, email: null, is_primary: !rows.length }])}>+ เพิ่มผู้ติดต่อ</button> <span className="hint">ผู้ติดต่อหลักแสดงในเอกสาร · ช่อง "ชื่อผู้ติดต่อ" ในแท็บรายละเอียดยังใช้ได้ตามเดิม</span></td></tr></tfoot>
      </table>
    </div>
  );
}

interface Bill { header_id: string; doc_class: string; doc_no: string; doc_date: string; due_date: string | null; amount: string; outstanding: string }
function BillsGrid({ rows }: { rows: Bill[] }) {
  const sum = rows.reduce((s, r) => s.plus(d(r.outstanding)), d(0));
  return (
    <div className="table-wrap">
      <table className="grid">
        <thead><tr><th style={{ width: 110 }}>วันครบกำหนด</th><th style={{ width: 70 }}>ชนิด</th><th>เลขที่เอกสาร</th><th style={{ width: 110 }}>วันที่</th><th className="r" style={{ width: 140 }}>จำนวนเงิน</th><th className="r" style={{ width: 140 }}>ยอดคงเหลือ</th></tr></thead>
        <tbody>
          {rows.map((r) => <tr key={r.header_id}><td><DateText v={r.due_date} /></td><td className="mono">{r.doc_class}</td><td className="mono">{r.doc_no}</td><td><DateText v={r.doc_date} /></td><td className="r"><Money v={r.amount} /></td><td className="r"><Money v={r.outstanding} /></td></tr>)}
          {!rows.length && <tr><td colSpan={6} className="empty">ไม่มีบิลค้างชำระ</td></tr>}
        </tbody>
        {!!rows.length && <tfoot><tr><td colSpan={5} className="r">รวม</td><td className="r"><b><Money v={sum.toFixed(2)} /></b></td></tr></tfoot>}
      </table>
    </div>
  );
}

const WHT_COND: Array<[string, string]> = [['1', '1 หักภาษี ณ ที่จ่าย'], ['2', '2 ออกภาษีให้ตลอดไป'], ['3', '3 ออกภาษีให้ครั้งเดียว']];
const HEAD_KEYS = ['code', 'title', 'name', 'name_en', 'address_1', 'address_2', 'address_3', 'zip_code', 'phone', 'contact', 'remark', 'status', 'tax_id', 'tax_branch_no', 'ship_via_code', 'credit_days', 'payment_terms', 'discount_text', 'credit_limit', 'wht_form', 'wht_rate', 'wht_condition'];
const RATE_KEYS = new Set(['vat_rate', 'wht_rate', 'commission_rate']);
const toForm = (r: Record<string, unknown>, keys: string[]): Form => Object.fromEntries(keys.map((k) => {
  const v = r[k];
  if (v === null || v === undefined) return [k, ''];
  if (typeof v === 'boolean') return [k, v];
  return [k, RATE_KEYS.has(k) ? d(v as string).toString() : String(v)];   // อัตรา 7.0000 → 7
}));

/** โครงหน้าต่างแก้ไขลูกค้า/ผู้จำหน่าย/พนักงานขาย: บันทึก F9, ลบเมื่อยังไม่มีเอกสาร */
function MasterModal({ title, menu, isNew, busy, ready, err, onClose, onSave, onDelete, children, delText, notes }: { title: string; menu: string; isNew: boolean; busy: boolean; ready: boolean; err: unknown; onClose: () => void; onSave: () => void; onDelete: () => Promise<void>; children: ReactNode; delText: string; notes?: { entity: 'customer' | 'supplier'; id: string | null; code: string } }) {
  const can = useCan(menu);
  const [ask, setAsk] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const allowed = can(isNew ? 'add' : 'edit');
  useHotkeys({ F9: allowed ? onSave : undefined, 'Ctrl+S': allowed ? onSave : undefined, 'Alt+R': notes?.id ? () => setShowNotes(true) : undefined }, []);
  return (
    <Modal title={title} size="wide" onClose={onClose}
      footer={<>{notes?.id && <button onClick={() => setShowNotes(true)} title="หมายเหตุเพิ่มเติม (Alt+R)">📝 หมายเหตุ</button>}{!isNew && can('delete') && <button className="danger" onClick={() => setAsk(true)}>ลบ</button>}<button onClick={onClose}>ยกเลิก <kbd>Esc</kbd></button>
        <button className="primary" disabled={!ready || busy || !allowed} title={allowed ? undefined : 'ไม่มีสิทธิ์'} onClick={onSave}>บันทึก <kbd>F9</kbd></button></>}>
      <ErrorBox error={err} />
      {ready && <div onKeyDown={navKey}>{children}</div>}
      {showNotes && notes?.id && <MasterNotesDialog entity={notes.entity} id={notes.id} title={notes.code} canEdit={can('edit')} onClose={() => setShowNotes(false)} />}
      {ask && <Confirm danger title="ลบข้อมูล" text={delText} okText="ลบ" onClose={() => setAsk(false)} onOk={() => onDelete().then(() => setAsk(false)).catch((e) => { setAsk(false); toastError(e); })} />}
    </Modal>
  );
}

/* ---------------------------------------------------------------- ลูกค้า S-AR-01 */
interface ShipTo { code: string; address_1: string | null; address_2: string | null; address_3: string | null; zip_code: string | null; phone: string | null; contact: string | null }
interface CustomerDetail extends Record<string, unknown> { id: string; code: string; ar_account_id: string | null; salesperson_id: string | null; ship_tos: ShipTo[]; contacts: Contact[]; outstanding_bills: Bill[]; balance: string; last_invoice_date: string | null }
const CUS_KEYS = [...HEAD_KEYS, 'email', 'customer_type', 'sales_area_code', 'price_level', 'wht_category', 'default_ship_to'];

export function CustomersPage() {
  return <PartyList kind="customers" menu="SA.CUS" eyebrow="ขาย › รายละเอียดลูกค้า" title="รายละเอียดลูกค้า" Form={CustomerForm}
    lead="ทะเบียนลูกค้า: ที่อยู่ เลขผู้เสียภาษี บัญชีลูกหนี้ เครดิต วงเงิน พนักงานขาย และสถานที่ส่งสินค้า — ค่าเหล่านี้ขึ้นอัตโนมัติตอนเปิดเอกสารขาย (แก้ในเอกสารได้)" />;
}

export function CustomerForm({ id, onClose, onSaved }: { id: string | null; onClose: () => void; onSaved: () => void }) {
  const qc = useQueryClient();
  const lk = useLookups('40,41,45,55');
  const slms = useQuery({ queryKey: ['salespersons'], queryFn: () => api.get<Array<{ id: string; code: string; name: string; status: string }>>('/api/v1/salespersons') });
  const cur = useQuery({ enabled: !!id, queryKey: ['customer', id], queryFn: () => api.get<CustomerDetail>(`/api/v1/customers/${id}`), staleTime: 0 });
  const [f, setF] = useState<Form | null>(id ? null : { ...toForm({}, CUS_KEYS), status: 'A', tax_branch_no: '00000', price_level: '1', wht_condition: '1' });
  const [acc, setAcc] = useState<{ ar: string | null; slm: string | null }>({ ar: null, slm: null });
  const [ships, setShips] = useState<ShipTo[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [tab, setTab] = useState('main');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (id && cur.data && !f) {
    setF(toForm(cur.data, CUS_KEYS)); setAcc({ ar: cur.data.ar_account_id, slm: cur.data.salesperson_id });
    setShips(cur.data.ship_tos); setContacts(cur.data.contacts);
  }
  const set = (p: Form) => setF((x) => ({ ...x!, ...p }));
  const t = useText(f, set);
  const save = async () => {
    if (!f || busy) return;
    setErr(null); setBusy(true);
    const body = { ...f, ar_account_id: acc.ar, salesperson_id: acc.slm, ship_tos: ships.filter((s) => s.code.trim()), contacts: contacts.filter((c) => c.name.trim()) };
    try {
      if (id) await api.put(`/api/v1/customers/${id}`, body); else await api.post('/api/v1/customers', body);
      toast(`บันทึกลูกค้า ${f.code} แล้ว`);
      qc.invalidateQueries({ queryKey: ['customer', id] });
      onSaved();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const remove = () => api.del(`/api/v1/customers/${id}`).then(() => { toast('ลบลูกค้าแล้ว'); onSaved(); });
  const setShip = (i: number, p: Partial<ShipTo>) => setShips((s) => s.map((x, k) => (k === i ? { ...x, ...p } : x)));
  return (
    <MasterModal notes={{ entity: 'customer', id, code: val(f ?? {}, 'code') }} title={id ? `แก้ไขลูกค้า ${val(f ?? {}, 'code')}` : 'เพิ่มลูกค้า'} menu="SA.CUS" isNew={!id} busy={busy} ready={!!f} err={err ?? cur.error} onClose={onClose} onSave={save} onDelete={remove}
      delText={`ลบลูกค้า ${val(f ?? {}, 'code')}? ลบได้เฉพาะลูกค้าที่ยังไม่มีเอกสาร — ถ้ามีเอกสารแล้วให้เปลี่ยนสถานะเป็นเลิกใช้`}>
      {f && <>
        <div className="form-grid party-head">
          <Field label="รหัสลูกค้า" req hint="สื่อประเภทหรือเขต เช่น ก-001, BKK-01"><input autoFocus className="mono" {...t('code', 20)} onChange={(e) => set({ code: e.target.value.toUpperCase() })} /></Field>
          <Field label="คำนำหน้าชื่อ"><input {...t('title', 30)} placeholder="บริษัท / หจก. / ร้าน" list="party-titles" /></Field>
          <Field label="ชื่อลูกค้า" req><input {...t('name', 120)} /></Field>
          <Field label="สถานะ"><select value={val(f, 'status')} onChange={(e) => set({ status: e.target.value })}><option value="A">ใช้งาน (Active)</option><option value="I">เลิกใช้ (Inactive)</option></select></Field>
        </div>
        <Tabs active={tab} onChange={setTab} tabs={[{ key: 'main', label: 'รายละเอียด' }, { key: 'contacts', label: 'ผู้ติดต่อ', badge: contacts.length || undefined }, { key: 'bills', label: 'บิลที่ค้างชำระ', badge: cur.data?.outstanding_bills.length || undefined }, ...(id ? [{ key: 'periods', label: 'ยอดรายงวด' }, { key: 'cheques', label: 'เช็คที่ยังไม่ผ่านบัญชี' }] : []), { key: 'ship', label: 'สถานที่ส่งสินค้า', badge: ships.length || undefined }]} />
        {tab === 'main' && <div className="form-grid party-grid">
          <Field label="ที่อยู่" wide><input {...t('address_1', 100)} placeholder="บรรทัด 1" /></Field>
          <Field label="" wide><input {...t('address_2', 100)} placeholder="บรรทัด 2" aria-label="ที่อยู่ บรรทัด 2" /></Field>
          <Field label="" wide><input {...t('address_3', 100)} placeholder="บรรทัด 3" aria-label="ที่อยู่ บรรทัด 3" /></Field>
          <Field label="รหัสไปรษณีย์"><input {...t('zip_code', 10)} /></Field>
          <Field label="โทรศัพท์"><input {...t('phone', 60)} placeholder="รวมแฟกซ์ได้" /></Field>
          <Field label="ชื่อผู้ติดต่อ"><input {...t('contact', 60)} /></Field>
          <Field label="อีเมล"><input type="email" {...t('email', 120)} /></Field>
          <Field label="ชื่อภาษาอังกฤษ"><input {...t('name_en', 120)} /></Field>
          <Field label="เลขประจำตัวผู้เสียภาษี" hint="13 หลัก — ตรวจหลักสุดท้ายให้"><input className="mono" {...t('tax_id', 20)} inputMode="numeric" /></Field>
          <Field label="สาขา#" hint="00000 = สำนักงานใหญ่"><input className="mono" {...t('tax_branch_no', 5)} inputMode="numeric" /></Field>
          <Field label="ประเภทลูกค้า"><LkSelect rows={lk.data?.['45']} value={val(f, 'customer_type')} onChange={(v) => set({ customer_type: v })} /></Field>
          <Field label="เลขที่บัญชีลูกหนี้" hint="เช่น 1130-01 ลูกหนี้การค้า · F4 ค้นหา"><AccountCell value={acc.ar} onChange={(a) => setAcc((x) => ({ ...x, ar: a?.id ?? null }))} /></Field>
          <Field label="พนักงานขาย">
            <select value={acc.slm ?? ''} onChange={(e) => setAcc((x) => ({ ...x, slm: e.target.value || null }))}>
              <option value="">—</option>
              {slms.data?.filter((s) => s.status === 'A' || s.id === acc.slm).map((s) => <option key={s.id} value={s.id}>{s.code} {s.name}</option>)}
            </select>
          </Field>
          <Field label="เขตการขาย"><LkSelect rows={lk.data?.['40']} value={val(f, 'sales_area_code')} onChange={(v) => set({ sales_area_code: v })} /></Field>
          <Field label="ขนส่งโดย"><LkSelect rows={lk.data?.['41']} value={val(f, 'ship_via_code')} onChange={(v) => set({ ship_via_code: v })} /></Field>
          <Field label="เครดิต (วัน)" hint="ใช้คำนวณวันครบกำหนดในบิลขาย"><input type="number" min={0} max={999} {...t('credit_days', 3)} /></Field>
          <Field label="เงื่อนไขการชำระ" hint="เช่น 2/10, n/30 (แสดงในฟอร์ม ไม่คำนวณ)"><input {...t('payment_terms', 60)} /></Field>
          <Field label="ตารางราคา">
            <select value={val(f, 'price_level')} onChange={(e) => set({ price_level: e.target.value })}>
              <option value="">—</option>{['1', '2', '3', '4', '5'].map((n) => <option key={n} value={n}>ราคาขายที่ {n}</option>)}{val(f, 'price_level') === '0' && <option value="0">0 (จาก Express)</option>}
            </select>
          </Field>
          <Field label="ส่วนลด" hint="เช่น 10%, 5+2%, 1500"><input {...t('discount_text', 20)} /></Field>
          <Field label="วงเงินอนุมัติ" hint="ขายเกินวงเงิน → เตือนตอนเปิดบิล"><MoneyInput value={val(f, 'credit_limit')} onChange={(v) => set({ credit_limit: v })} /></Field>
          <Field label="แบบภาษีที่ลูกค้าหักเรา"><input className="mono" {...t('wht_form', 4)} /></Field>
          <Field label="อัตราภาษีหัก ณ ที่จ่าย (%)"><input type="number" min={0} max={100} step="0.01" {...t('wht_rate', 6)} /></Field>
          <Field label="หมวดภาษีหัก ณ ที่จ่าย"><LkSelect rows={lk.data?.['55']} value={val(f, 'wht_category')} onChange={(v) => set({ wht_category: v })} /></Field>
          <Field label="เงื่อนไขการหักภาษี"><select value={val(f, 'wht_condition')} onChange={(e) => set({ wht_condition: e.target.value })}><option value="">—</option>{WHT_COND.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="หมายเหตุ" wide hint="เช่น วางบิลทุกวันที่ 15 และ 30 ของเดือน"><textarea rows={2} value={val(f, 'remark')} maxLength={2000} onChange={(e) => set({ remark: e.target.value })} /></Field>
          {id && cur.data && <div className="field wide party-stats">
            <span>วันที่บิลล่าสุด <b>{cur.data.last_invoice_date ? <DateText v={cur.data.last_invoice_date} /> : '—'}</b></span>
            <span>ยอดคงค้าง <b><Money v={cur.data.balance} /></b></span>
            {d(f.credit_limit as string).gt(0) && d(cur.data.balance).gt(d(f.credit_limit as string)) && <Pill tone="c">เกินวงเงิน</Pill>}
            <span className="muted small">ตารางสะสมยอดรายงวด/เช็คที่ยังไม่ผ่านบัญชี/เช็คคืน แสดงเมื่อมีระบบขายและการเงิน</span>
          </div>}
        </div>}
        {tab === 'contacts' && <ContactsGrid rows={contacts} onChange={setContacts} />}
        {tab === 'bills' && (id ? <BillsGrid rows={cur.data?.outstanding_bills ?? []} /> : <p className="muted">บันทึกลูกค้าก่อน</p>)}
        {(tab === 'periods' || tab === 'cheques') && id && <PartyActivity mod="AR" id={id} view={tab} />}
        {tab === 'ship' && <>
          <div className="form-grid">
            <Field label="สถานที่ส่งของประจำ" hint="ขึ้นอัตโนมัติในใบกำกับภาษี/ใบส่งของ">
              <select value={val(f, 'default_ship_to')} onChange={(e) => set({ default_ship_to: e.target.value })}>
                <option value="">— ที่อยู่ตามรายละเอียด —</option>{ships.filter((s) => s.code.trim()).map((s) => <option key={s.code} value={s.code}>{s.code} {s.address_1}</option>)}
              </select>
            </Field>
          </div>
          <div className="table-wrap lines">
            <table className="grid">
              <thead><tr><th style={{ width: 90 }}>รหัส</th><th>ที่อยู่ บรรทัด 1</th><th>บรรทัด 2</th><th>บรรทัด 3</th><th style={{ width: 90 }}>ไปรษณีย์</th><th style={{ width: 130 }}>โทร.</th><th style={{ width: 130 }}>ผู้ติดต่อ</th><th style={{ width: 40 }} /></tr></thead>
              <tbody>
                {ships.map((s, i) => (
                  <tr key={i}>
                    <td><input className="mono" value={s.code} maxLength={10} onChange={(e) => setShip(i, { code: e.target.value.toUpperCase() })} aria-label="รหัสสถานที่ส่ง" /></td>
                    <td><input value={s.address_1 ?? ''} maxLength={100} onChange={(e) => setShip(i, { address_1: e.target.value })} /></td>
                    <td><input value={s.address_2 ?? ''} maxLength={100} onChange={(e) => setShip(i, { address_2: e.target.value })} /></td>
                    <td><input value={s.address_3 ?? ''} maxLength={100} onChange={(e) => setShip(i, { address_3: e.target.value })} /></td>
                    <td><input value={s.zip_code ?? ''} maxLength={10} onChange={(e) => setShip(i, { zip_code: e.target.value })} /></td>
                    <td><input value={s.phone ?? ''} maxLength={60} onChange={(e) => setShip(i, { phone: e.target.value })} /></td>
                    <td><input value={s.contact ?? ''} maxLength={60} onChange={(e) => setShip(i, { contact: e.target.value })} /></td>
                    <td><button type="button" className="icon-btn" tabIndex={-1} title="ลบบรรทัด" onClick={() => setShips((x) => x.filter((_, k) => k !== i))}>✕</button></td>
                  </tr>
                ))}
                {!ships.length && <tr><td colSpan={8} className="empty">ยังไม่มีสถานที่ส่งสินค้า</td></tr>}
              </tbody>
              <tfoot><tr><td colSpan={8}><button type="button" onClick={() => setShips((x) => [...x, { code: '', address_1: null, address_2: null, address_3: null, zip_code: null, phone: null, contact: null }])}>+ เพิ่มสถานที่ส่ง</button> <span className="hint">รหัสเช่น สบ01 · เลือกนำไปแสดงในใบกำกับภาษีได้</span></td></tr></tfoot>
            </table>
          </div>
        </>}
        <datalist id="party-titles"><option value="บริษัท" /><option value="บริษัท ... จำกัด (มหาชน)" /><option value="ห้างหุ้นส่วนจำกัด" /><option value="ร้าน" /><option value="คุณ" /></datalist>
      </>}
    </MasterModal>
  );
}

/* ---------------------------------------------------------------- ผู้จำหน่าย S-AP-01 */
interface BankRow { bank_code: string; branch: string | null; account_no: string; account_name: string | null; is_default: boolean }
interface SupplierDetail extends Record<string, unknown> { id: string; ap_account_id: string | null; on_hold: boolean; banks: BankRow[]; contacts: Contact[]; outstanding_bills: Bill[]; balance: string; last_bill_date: string | null }
const SUP_KEYS = [...HEAD_KEYS, 'supplier_type', 'price_type', 'vat_rate', 'wht_income_desc'];

export function SuppliersPage() {
  return <PartyList kind="suppliers" menu="PU.SUP" eyebrow="ซื้อ › รายละเอียดผู้จำหน่าย" title="รายละเอียดผู้จำหน่าย" Form={SupplierForm}
    lead="ทะเบียนผู้จำหน่าย: บัญชีเจ้าหนี้ เครดิต ประเภทราคา ภาษีหัก ณ ที่จ่าย และบัญชีธนาคารสำหรับโอนจ่าย — ค่าเหล่านี้ขึ้นอัตโนมัติตอนเปิดเอกสารซื้อ" />;
}

export function SupplierForm({ id, onClose, onSaved }: { id: string | null; onClose: () => void; onSaved: () => void }) {
  const qc = useQueryClient();
  const lk = useLookups('41,46,55,BANK');
  const cur = useQuery({ enabled: !!id, queryKey: ['supplier', id], queryFn: () => api.get<SupplierDetail>(`/api/v1/suppliers/${id}`), staleTime: 0 });
  const [f, setF] = useState<Form | null>(id ? null : { ...toForm({}, SUP_KEYS), status: 'A', tax_branch_no: '00000', price_type: '2', vat_rate: '7', wht_condition: '1', on_hold: false });
  const [ap, setAp] = useState<string | null>(null);
  const [banks, setBanks] = useState<BankRow[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [tab, setTab] = useState('main');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (id && cur.data && !f) {
    setF({ ...toForm(cur.data, SUP_KEYS), on_hold: cur.data.on_hold }); setAp(cur.data.ap_account_id); setBanks(cur.data.banks); setContacts(cur.data.contacts);
  }
  const set = (p: Form) => setF((x) => ({ ...x!, ...p }));
  const t = useText(f, set);
  const save = async () => {
    if (!f || busy) return;
    setErr(null); setBusy(true);
    const body = { ...f, ap_account_id: ap, banks: banks.filter((b) => b.bank_code || b.account_no), contacts: contacts.filter((c) => c.name.trim()) };
    try {
      if (id) await api.put(`/api/v1/suppliers/${id}`, body); else await api.post('/api/v1/suppliers', body);
      toast(`บันทึกผู้จำหน่าย ${f.code} แล้ว`);
      qc.invalidateQueries({ queryKey: ['supplier', id] });
      onSaved();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const remove = () => api.del(`/api/v1/suppliers/${id}`).then(() => { toast('ลบผู้จำหน่ายแล้ว'); onSaved(); });
  const setBank = (i: number, p: Partial<BankRow>) => setBanks((s) => s.map((x, k) => (k === i ? { ...x, ...p } : p.is_default ? { ...x, is_default: false } : x)));
  return (
    <MasterModal notes={{ entity: 'supplier', id, code: val(f ?? {}, 'code') }} title={id ? `แก้ไขผู้จำหน่าย ${val(f ?? {}, 'code')}` : 'เพิ่มผู้จำหน่าย'} menu="PU.SUP" isNew={!id} busy={busy} ready={!!f} err={err ?? cur.error} onClose={onClose} onSave={save} onDelete={remove}
      delText={`ลบผู้จำหน่าย ${val(f ?? {}, 'code')}? ลบได้เฉพาะผู้จำหน่ายที่ยังไม่มีเอกสาร — ถ้ามีเอกสารแล้วให้เปลี่ยนสถานะเป็นเลิกใช้`}>
      {f && <>
        <div className="form-grid party-head">
          <Field label="รหัสผู้จำหน่าย" req hint="สื่อประเภท เช่น ประจำ/ชั่วคราว/ต่างประเทศ"><input autoFocus className="mono" {...t('code', 20)} onChange={(e) => set({ code: e.target.value.toUpperCase() })} /></Field>
          <Field label="คำนำหน้าชื่อ"><input {...t('title', 30)} placeholder="บริษัท / หจก. / ร้าน" list="sup-titles" /></Field>
          <Field label="ชื่อผู้จำหน่าย" req><input {...t('name', 120)} /></Field>
          <Field label="สถานะ"><select value={val(f, 'status')} onChange={(e) => set({ status: e.target.value })}><option value="A">ใช้งาน (Active)</option><option value="I">เลิกใช้ (Inactive)</option></select></Field>
        </div>
        <Tabs active={tab} onChange={setTab} tabs={[{ key: 'main', label: 'รายละเอียด' }, { key: 'contacts', label: 'ผู้ติดต่อ', badge: contacts.length || undefined }, { key: 'banks', label: 'บัญชีธนาคาร', badge: banks.length || undefined }, { key: 'bills', label: 'บิลที่ค้างชำระ', badge: cur.data?.outstanding_bills.length || undefined }, ...(id ? [{ key: 'periods', label: 'ยอดรายงวด' }, { key: 'cheques', label: 'เช็คจ่ายที่ยังไม่ผ่านบัญชี' }] : [])]} />
        {tab === 'main' && <div className="form-grid party-grid">
          <Field label="ที่อยู่" wide><input {...t('address_1', 100)} placeholder="บรรทัด 1" /></Field>
          <Field label="" wide><input {...t('address_2', 100)} placeholder="บรรทัด 2" aria-label="ที่อยู่ บรรทัด 2" /></Field>
          <Field label="" wide><input {...t('address_3', 100)} placeholder="บรรทัด 3" aria-label="ที่อยู่ บรรทัด 3" /></Field>
          <Field label="รหัสไปรษณีย์"><input {...t('zip_code', 10)} /></Field>
          <Field label="โทรศัพท์"><input {...t('phone', 60)} /></Field>
          <Field label="ชื่อผู้ติดต่อ" hint="ผู้ติดต่อในการซื้อ"><input {...t('contact', 60)} /></Field>
          <Field label="ชื่อภาษาอังกฤษ"><input {...t('name_en', 120)} /></Field>
          <Field label="เลขประจำตัวผู้เสียภาษี" hint="ใช้ออกหนังสือรับรองหัก ณ ที่จ่าย"><input className="mono" {...t('tax_id', 20)} inputMode="numeric" /></Field>
          <Field label="สาขา#" hint="00000 = สำนักงานใหญ่"><input className="mono" {...t('tax_branch_no', 5)} inputMode="numeric" /></Field>
          <Field label="ประเภทผู้จำหน่าย"><LkSelect rows={lk.data?.['46']} value={val(f, 'supplier_type')} onChange={(v) => set({ supplier_type: v })} /></Field>
          <Field label="เลขที่บัญชีเจ้าหนี้" hint="เช่น 2120-01 เจ้าหนี้การค้า · F4 ค้นหา"><AccountCell value={ap} onChange={(a) => setAp(a?.id ?? null)} /></Field>
          <Field label="ประเภทราคา"><select value={val(f, 'price_type')} onChange={(e) => set({ price_type: e.target.value })}><option value="">—</option><option value="0">0 ยกเว้นภาษี</option><option value="1">1 ราคารวมภาษีแล้ว</option><option value="2">2 ราคายังไม่รวมภาษี (แยก VAT)</option></select></Field>
          <Field label="ภาษีมูลค่าเพิ่ม (%)"><input type="number" min={0} max={30} step="0.01" {...t('vat_rate', 6)} /></Field>
          <Field label="ขนส่งโดย"><LkSelect rows={lk.data?.['41']} value={val(f, 'ship_via_code')} onChange={(v) => set({ ship_via_code: v })} /></Field>
          <Field label="เครดิต (วัน)"><input type="number" min={0} max={999} {...t('credit_days', 3)} /></Field>
          <Field label="เงื่อนไขการชำระเงิน" hint="เช่น 2/10, n/30"><input {...t('payment_terms', 60)} /></Field>
          <Field label="ส่วนลด" hint="ส่วนลดการค้าที่ได้รับ"><input {...t('discount_text', 20)} /></Field>
          <Field label="วงเงินอนุมัติ" hint="ซื้อเกินวงเงิน → เตือนขณะซื้อ"><MoneyInput value={val(f, 'credit_limit')} onChange={(v) => set({ credit_limit: v })} /></Field>
          <Field label="หมวดภาษีหัก ณ ที่จ่าย (แบบ ภ.ง.ด.)"><LkSelect rows={lk.data?.['55']} value={val(f, 'wht_form')} onChange={(v) => set({ wht_form: v })} /></Field>
          <Field label="ประเภทเงินได้ที่จ่าย" hint="เช่น ค่าจ้างทำของ ค่าโฆษณา"><input {...t('wht_income_desc', 60)} list="wht-income" /></Field>
          <Field label="อัตราภาษีที่หัก (%)"><input type="number" min={0} max={100} step="0.01" {...t('wht_rate', 6)} /></Field>
          <Field label="เงื่อนไขการหักภาษี"><select value={val(f, 'wht_condition')} onChange={(e) => set({ wht_condition: e.target.value })}><option value="">—</option>{WHT_COND.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="ระงับการจ่าย"><label className="check"><input type="checkbox" checked={f.on_hold === true} onChange={(e) => set({ on_hold: e.target.checked })} /> ระงับการจ่ายเงินผู้จำหน่ายรายนี้</label></Field>
          <Field label="หมายเหตุ" wide><textarea rows={2} value={val(f, 'remark')} maxLength={2000} onChange={(e) => set({ remark: e.target.value })} /></Field>
          {id && cur.data && <div className="field wide party-stats">
            <span>วันที่ซื้อล่าสุด <b>{cur.data.last_bill_date ? <DateText v={cur.data.last_bill_date} /> : '—'}</b></span>
            <span>ยอดคงค้าง <b><Money v={cur.data.balance} /></b></span>
            <span className="muted small">ตารางสะสมยอดรายงวด/เช็คจ่ายที่ยังไม่ผ่านบัญชี แสดงเมื่อมีระบบซื้อและการเงิน</span>
          </div>}
        </div>}
        {tab === 'contacts' && <ContactsGrid rows={contacts} onChange={setContacts} />}
        {tab === 'banks' && <div className="table-wrap lines">
          <table className="grid">
            <thead><tr><th style={{ width: 220 }}>ธนาคาร</th><th style={{ width: 160 }}>สาขา</th><th style={{ width: 170 }}>เลขที่บัญชี</th><th>ชื่อบัญชี</th><th style={{ width: 80 }}>ใช้ประจำ</th><th style={{ width: 40 }} /></tr></thead>
            <tbody>
              {banks.map((b, i) => (
                <tr key={i}>
                  <td><LkSelect rows={lk.data?.BANK} value={b.bank_code} onChange={(v) => setBank(i, { bank_code: v })} blank="— เลือกธนาคาร —" /></td>
                  <td><input value={b.branch ?? ''} maxLength={60} onChange={(e) => setBank(i, { branch: e.target.value })} /></td>
                  <td><input className="mono" value={b.account_no} maxLength={20} onChange={(e) => setBank(i, { account_no: e.target.value })} aria-label="เลขที่บัญชี" /></td>
                  <td><input value={b.account_name ?? ''} maxLength={120} onChange={(e) => setBank(i, { account_name: e.target.value })} /></td>
                  <td className="c"><input type="checkbox" checked={b.is_default} onChange={(e) => setBank(i, { is_default: e.target.checked })} aria-label="บัญชีที่ใช้โอนเป็นประจำ" /></td>
                  <td><button type="button" className="icon-btn" tabIndex={-1} title="ลบบรรทัด" onClick={() => setBanks((x) => x.filter((_, k) => k !== i))}>✕</button></td>
                </tr>
              ))}
              {!banks.length && <tr><td colSpan={6} className="empty">ยังไม่มีบัญชีธนาคารของผู้จำหน่าย</td></tr>}
            </tbody>
            <tfoot><tr><td colSpan={6}><button type="button" onClick={() => setBanks((x) => [...x, { bank_code: '', branch: null, account_no: '', account_name: val(f, 'name') || null, is_default: !x.length }])}>+ เพิ่มบัญชีธนาคาร</button> <span className="hint">ใช้ตอนโอนจ่ายชำระหนี้ · รายชื่อธนาคารจากตารางธนาคาร</span></td></tr></tfoot>
          </table>
        </div>}
        {tab === 'bills' && (id ? <BillsGrid rows={cur.data?.outstanding_bills ?? []} /> : <p className="muted">บันทึกผู้จำหน่ายก่อน</p>)}
        {(tab === 'periods' || tab === 'cheques') && id && <PartyActivity mod="AP" id={id} view={tab} />}
        <datalist id="sup-titles"><option value="บริษัท" /><option value="ห้างหุ้นส่วนจำกัด" /><option value="ร้าน" /><option value="คุณ" /></datalist>
        <datalist id="wht-income"><option value="ค่าจ้างทำของ" /><option value="ค่าบริการ" /><option value="ค่าโฆษณา" /><option value="ค่าขนส่ง" /><option value="ค่าเช่า" /><option value="ค่านายหน้า" /><option value="ค่าวิชาชีพอิสระ" /></datalist>
      </>}
    </MasterModal>
  );
}

/* ---------------------------------------------------------------- พนักงานขาย S-SO-01 */
interface SlmRow { id: string; code: string; name: string; position: string | null; salesperson_type: string | null; sales_area_code: string | null; commission_rate: string | null; phone: string | null; status: string; customer_count: number }
interface SlmDetail extends Record<string, unknown> { id: string; fiscal_year: { id: string; code: string } | null; targets: Array<{ seq: number; period_id: string; start_date: string; end_date: string; amount: string }> }
const SLM_KEYS = ['code', 'name', 'position', 'salesperson_type', 'sales_area_code', 'commission_rate', 'address', 'zip_code', 'phone', 'tax_id', 'social_security_no', 'status'];

export function SalespersonsPage() {
  const qc = useQueryClient();
  const can = useCan('SA.SLM');
  const [edit, setEdit] = useState<string | 'new' | null>(null);
  const list = useQuery({ queryKey: ['salespersons'], queryFn: () => api.get<SlmRow[]>('/api/v1/salespersons') });
  useHotkeys({ Insert: can('add') ? () => setEdit('new') : undefined }, []);
  return (
    <div className="page" data-tone="sales">
      <PageHead eyebrow="ขาย › รายละเอียดพนักงานขาย" title="รายละเอียดพนักงานขาย"
        lead="พนักงานขาย อัตราค่าคอมมิชชั่น และเป้าการขาย 24 งวด — ใช้สรุปยอดขายรายพนักงานและเปรียบเทียบกับเป้า"
        actions={can('add') && <button className="primary" onClick={() => setEdit('new')}>+ เพิ่มพนักงานขาย <kbd>Ins</kbd></button>} />
      <ErrorBox error={list.error} />
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th style={{ width: 110 }}>รหัส</th><th>ชื่อพนักงานขาย</th><th>ตำแหน่ง</th><th style={{ width: 80 }}>ประเภท</th><th style={{ width: 90 }}>เขตการขาย</th><th className="r" style={{ width: 90 }}>ค่าคอมฯ %</th><th style={{ width: 140 }}>โทร.</th><th className="r" style={{ width: 80 }}>ลูกค้า</th><th style={{ width: 80 }}>สถานะ</th></tr></thead>
          <tbody>
            {list.data?.map((r) => (
              <tr key={r.id} className="row-open" tabIndex={0} onClick={() => setEdit(r.id)} onKeyDown={(e) => e.key === 'Enter' && setEdit(r.id)}>
                <td className="mono">{r.code}</td><td>{r.name}</td><td className="small">{r.position}</td><td className="mono">{r.salesperson_type}</td><td className="mono">{r.sales_area_code}</td>
                <td className="r">{r.commission_rate && Number(r.commission_rate) ? fmt(r.commission_rate) : ''}</td><td className="small">{r.phone}</td><td className="r">{Number(r.customer_count) || ''}</td><td>{statusPill(r.status)}</td>
              </tr>
            ))}
            {list.data && !list.data.length && <tr><td colSpan={9} className="empty">ยังไม่มีพนักงานขาย — กด Ins เพื่อเพิ่ม</td></tr>}
          </tbody>
        </table>
      </div>
      <KeyHints keys={[['Ins', 'เพิ่มพนักงานขาย'], ['คลิก/Enter', 'แก้ไข'], ['F9', 'บันทึก'], ['Esc', 'ปิด']]} />
      {edit && <SalespersonForm id={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); qc.invalidateQueries({ queryKey: ['salespersons'] }); }} />}
    </div>
  );
}

export function SalespersonForm({ id, onClose, onSaved }: { id: string | null; onClose: () => void; onSaved: () => void }) {
  const qc = useQueryClient();
  const lk = useLookups('40,47');
  const years = useQuery({ queryKey: ['periods'], queryFn: () => api.get<FiscalYear[]>('/api/v1/gl/periods') });
  const [fy, setFy] = useState<string | null>(null);
  const cur = useQuery({ enabled: !!id, queryKey: ['salesperson', id, fy], queryFn: () => api.get<SlmDetail>(`/api/v1/salespersons/${id}`, { fiscal_year_id: fy }), staleTime: 0 });
  const [f, setF] = useState<Form | null>(id ? null : { ...toForm({}, SLM_KEYS), status: 'A' });
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [loadedFy, setLoadedFy] = useState<string | null | undefined>(undefined);
  const [tab, setTab] = useState('main');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (id && cur.data && !f) setF(toForm(cur.data, SLM_KEYS));
  // เป้าการขายโหลดใหม่เมื่อเปลี่ยนปี
  const curFy = cur.data?.fiscal_year?.id ?? null;
  if (id && cur.data && loadedFy !== curFy) { setLoadedFy(curFy); setTargets(Object.fromEntries(cur.data.targets.map((x) => [x.period_id, d(x.amount).isZero() ? '' : x.amount]))); }
  // ผู้ใช้ใหม่: งวดของปีที่เลือก (หรือปีล่าสุดที่มีวันทำการ) จากหน้าจอรอบบัญชี
  const { periods, startFy } = useMemo(() => {
    if (id) return { periods: cur.data?.targets ?? [], startFy: null };
    const ys = [...(years.data ?? [])].sort((a, b) => a.start_date.localeCompare(b.start_date));
    const today = new Date().toISOString().slice(0, 10);
    const start = ys.find((y) => y.id === fy) ?? ys.find((y) => y.start_date <= today && y.end_date >= today) ?? ys.at(-1);
    if (!start) return { periods: [], startFy: null };
    return { startFy: start.id, periods: ys.filter((y) => y.start_date >= start.start_date).flatMap((y) => y.periods).slice(0, 24).map((p, i) => ({ seq: i + 1, period_id: p.id, start_date: p.start_date, end_date: p.end_date, amount: '0' })) };
  }, [id, cur.data, years.data, fy]);
  const set = (p: Form) => setF((x) => ({ ...x!, ...p }));
  const t = useText(f, set);
  const total = periods.reduce((s, p) => s.plus(d(targets[p.period_id] ?? '')), d(0));
  const fyId = fy ?? (id ? curFy : startFy);
  const save = async () => {
    if (!f || busy) return;
    setErr(null); setBusy(true);
    const body = { ...f, ...(fyId ? { fiscal_year_id: fyId } : {}), targets: periods.map((p) => ({ period_id: p.period_id, amount: targets[p.period_id] || null })) };
    try {
      if (id) await api.put(`/api/v1/salespersons/${id}`, body); else await api.post('/api/v1/salespersons', body);
      toast(`บันทึกพนักงานขาย ${f.code} แล้ว`);
      qc.invalidateQueries({ queryKey: ['salesperson', id] });
      onSaved();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const remove = () => api.del(`/api/v1/salespersons/${id}`).then(() => { toast('ลบพนักงานขายแล้ว'); onSaved(); });
  const half = (from: number) => periods.slice(from, from + 12);
  const monthLabel = (iso: string) => { const [y, m] = iso.split('-'); return `${m}/${Number(y) + 543}`; };
  return (
    <MasterModal title={id ? `แก้ไขพนักงานขาย ${val(f ?? {}, 'code')}` : 'เพิ่มพนักงานขาย'} menu="SA.SLM" isNew={!id} busy={busy} ready={!!f} err={err ?? cur.error} onClose={onClose} onSave={save} onDelete={remove}
      delText={`ลบพนักงานขาย ${val(f ?? {}, 'code')}? ลบได้เฉพาะที่ยังไม่มีลูกค้าหรือเอกสาร — ถ้ามีแล้วให้เปลี่ยนสถานะเป็นเลิกใช้`}>
      {f && <>
        <div className="form-grid party-head">
          <Field label="รหัสพนักงานขาย" req hint="ตัวเลข ตัวอักษร หรือชื่อย่อ"><input autoFocus className="mono" {...t('code', 20)} onChange={(e) => set({ code: e.target.value.toUpperCase() })} /></Field>
          <Field label="ชื่อพนักงานขาย" req><input {...t('name', 120)} /></Field>
          <Field label="สถานะ"><select value={val(f, 'status')} onChange={(e) => set({ status: e.target.value })}><option value="A">ใช้งาน</option><option value="I">เลิกใช้</option></select></Field>
        </div>
        <Tabs active={tab} onChange={setTab} tabs={[{ key: 'main', label: 'รายละเอียดทั่วไป' }, { key: 'target', label: 'กำหนดเป้าการขาย' }]} />
        {tab === 'main' && <div className="form-grid party-grid">
          <Field label="ตำแหน่ง"><input {...t('position', 60)} /></Field>
          <Field label="ประเภท"><LkSelect rows={lk.data?.['47']} value={val(f, 'salesperson_type')} onChange={(v) => set({ salesperson_type: v })} /></Field>
          <Field label="เขตการขาย" hint="ว่างได้ถ้าดูแลหลายเขต"><LkSelect rows={lk.data?.['40']} value={val(f, 'sales_area_code')} onChange={(v) => set({ sales_area_code: v })} /></Field>
          <Field label="อัตราค่าคอมฯ (%)"><input type="number" min={0} max={100} step="0.01" {...t('commission_rate', 6)} /></Field>
          <Field label="ที่อยู่" wide><textarea rows={3} value={val(f, 'address')} maxLength={500} onChange={(e) => set({ address: e.target.value })} /></Field>
          <Field label="รหัสไปรษณีย์"><input {...t('zip_code', 10)} /></Field>
          <Field label="โทร."><input {...t('phone', 60)} /></Field>
          <Field label="เลขประจำตัวผู้เสียภาษี"><input className="mono" {...t('tax_id', 20)} inputMode="numeric" /></Field>
          <Field label="เลขที่บัตรประกันสังคม"><input className="mono" {...t('social_security_no', 20)} /></Field>
        </div>}
        {tab === 'target' && <>
          <div className="toolbar">
            <label>ปีบัญชีเริ่มต้น <select value={fyId ?? ''} onChange={(e) => setFy(e.target.value || null)} aria-label="ปีบัญชี">
              {years.data?.map((y) => <option key={y.id} value={y.id}>{y.code}</option>)}
            </select></label>
            <span className="hint">24 งวดนับจากต้นปีที่เลือก (ปีนี้ + ปีหน้า) · เปรียบเทียบกับยอดขายจริงที่รายงานยอดขายตามพนักงานขาย</span>
          </div>
          {!periods.length && <p className="muted">ยังไม่มีงวดบัญชี — กำหนดที่ ตั้งค่า › รอบระยะเวลาบัญชี</p>}
          {!!periods.length && <div className="target-grid">
            {[0, 12].map((from) => !!half(from).length && (
              <table key={from} className="grid">
                <thead><tr><th style={{ width: 60 }}>งวด</th><th style={{ width: 90 }}>เดือน</th><th className="r">เป้าการขาย</th></tr></thead>
                <tbody>{half(from).map((p) => <tr key={p.period_id}><td className="muted">{p.seq}</td><td className="mono">{monthLabel(p.start_date)}</td><td><MoneyInput value={targets[p.period_id] ?? ''} onChange={(v) => setTargets((x) => ({ ...x, [p.period_id]: v }))} aria-label={`เป้างวด ${p.seq}`} /></td></tr>)}</tbody>
                <tfoot><tr><td colSpan={2}>รวม</td><td className="r"><b><Money v={half(from).reduce((s, p) => s.plus(d(targets[p.period_id] ?? '')), d(0)).toFixed(2)} /></b></td></tr></tfoot>
              </table>
            ))}
            <p className={cx('target-total')}>รวม 24 งวด <b><Money v={total.toFixed(2)} /></b></p>
          </div>}
        </>}
      </>}
    </MasterModal>
  );
}

/** ตารางสะสมยอดเงินรายงวด (ยอดรวม VAT) + ยอดต้นปี + เช็คที่ยังไม่ผ่านบัญชี — คำนวณสดจากเอกสาร */
function PartyActivity({ mod, id, view }: { mod: 'AR' | 'AP'; id: string; view: 'periods' | 'cheques' }) {
  const [fy, setFy] = useState<string | undefined>(undefined);
  const q = useQuery({ queryKey: ['party-activity', mod, id, fy], queryFn: () => api.get<{ fiscal_years: Array<{ id: string; code: string }>; fiscal_year_id: string | null; opening_total: string; opening_outstanding: string;
    periods: Array<{ period_no: number; start_date: string; end_date: string; cash: string; credit: string; debit_note: string; credit_note: string; settled: string }>;
    cheques: Array<{ id: string; cheque_date: string; cheque_no: string; bank_code: string | null; bank_name: string | null; amount: string; remaining_amount: string; status: string; instrument: string }>; cheque_total: string }>(
    `/api/v1/${mod === 'AR' ? 'customers' : 'suppliers'}/${id}/activity`, fy ? { fiscal_year_id: fy } : {}) });
  const ar = mod === 'AR';
  const sum = (k: 'cash' | 'credit' | 'debit_note' | 'credit_note' | 'settled') => (q.data?.periods ?? []).reduce((t, p) => t.plus(d(p[k])), d(0)).toFixed(2);
  if (view === 'cheques') return (
    <div className="table-wrap"><ErrorBox error={q.error} />
      <table className="grid"><thead><tr><th style={{ width: 110 }}>วันที่</th><th style={{ width: 140 }}>เลขที่เช็ค</th><th>ธนาคาร</th><th className="r" style={{ width: 140 }}>จำนวนเงิน</th><th className="r" style={{ width: 140 }}>ยอดคงเหลือ</th><th style={{ width: 90 }}>ชนิด</th></tr></thead>
        <tbody>{q.data?.cheques.map((c) => <tr key={c.id}><td><DateText v={c.cheque_date} /></td><td className="mono">{c.cheque_no}</td><td>{c.bank_code} {c.bank_name}</td><td className="r"><Money v={c.amount} /></td><td className="r"><Money v={c.remaining_amount} blankZero /></td><td>{c.instrument === 'CHEQUE' ? 'เช็ค' : c.instrument === 'TRANSFER' ? 'โอน' : c.instrument}</td></tr>)}
          {q.data && !q.data.cheques.length && <tr><td colSpan={6} className="empty">ไม่มีเช็ค{ar ? 'รับ' : 'จ่าย'}ที่ยังไม่ผ่านบัญชี</td></tr>}</tbody>
        {!!q.data?.cheques.length && <tfoot><tr><td colSpan={3} className="r">รวม{ar ? 'เช็ครับล่วงหน้า' : 'เช็คจ่ายล่วงหน้า'}</td><td className="r"><b><Money v={q.data.cheque_total} /></b></td><td colSpan={2} /></tr></tfoot>}
      </table>
      <p className="hint">ประวัติเช็คคืน/ผ่านเช็คมาพร้อมระบบเช็คและธนาคาร (P4)</p>
    </div>
  );
  return (
    <div className="table-wrap"><ErrorBox error={q.error} />
      <div className="toolbar">
        <label>ปีบัญชี <select value={fy ?? q.data?.fiscal_year_id ?? ''} onChange={(e) => setFy(e.target.value)} aria-label="ปีบัญชี">{q.data?.fiscal_years.map((y) => <option key={y.id} value={y.id}>{y.code}</option>)}</select></label>
        <span className="muted small">ยอดต้นปี (ยกมา) <b><Money v={q.data?.opening_total} /></b> · ยังค้าง <Money v={q.data?.opening_outstanding} /> · ยอดรวม VAT ใช้ออกรายงานสถานะ{ar ? 'ลูกหนี้' : 'เจ้าหนี้'}</span>
      </div>
      <table className="grid">
        <thead><tr><th style={{ width: 60 }}>งวด</th><th style={{ width: 200 }}>ช่วงวันที่</th><th className="r">{ar ? 'ขายสด' : 'ซื้อสด'}</th><th className="r">{ar ? 'ขายเชื่อ' : 'ซื้อเชื่อ'}</th><th className="r">เพิ่มหนี้</th><th className="r">ลดหนี้</th><th className="r">{ar ? 'รับชำระหนี้' : 'จ่ายชำระหนี้'}</th></tr></thead>
        <tbody>{q.data?.periods.map((p) => <tr key={p.period_no}><td>{p.period_no}</td><td className="small"><DateText v={p.start_date} /> – <DateText v={p.end_date} /></td>
          <td className="r"><Money v={p.cash} blankZero /></td><td className="r"><Money v={p.credit} blankZero /></td><td className="r"><Money v={p.debit_note} blankZero /></td><td className="r"><Money v={p.credit_note} blankZero /></td><td className="r"><Money v={p.settled} blankZero /></td></tr>)}</tbody>
        {!!q.data?.periods.length && <tfoot><tr><td colSpan={2} className="r">รวมทั้งปี</td><td className="r"><b><Money v={sum('cash')} blankZero /></b></td><td className="r"><b><Money v={sum('credit')} blankZero /></b></td><td className="r"><b><Money v={sum('debit_note')} blankZero /></b></td><td className="r"><b><Money v={sum('credit_note')} blankZero /></b></td><td className="r"><b><Money v={sum('settled')} blankZero /></b></td></tr></tfoot>}
      </table>
    </div>
  );
}

type Label = { id: string; code: string; title: string | null; name: string; address_1: string | null; address_2: string | null; address_3: string | null; zip_code: string | null; phone: string | null; contact: string | null };
/** พิมพ์รายชื่อลงซองจดหมาย/สติ๊กเกอร์ (คู่มือ S-MF-03) ลูกค้า/ผู้จำหน่ายตามคำค้นของหน้ารายการ */
function LabelPrint({ kind, q, status, onClose }: { kind: 'customers' | 'suppliers'; q: string; status: string; onClose: () => void }) {
  const rows = useQuery({ queryKey: [kind, 'labels', q, status], queryFn: () => api.get<Label[]>(`/api/v1/${kind}-labels`, { q, status }) });
  const [layout, setLayout] = useState<'envelope' | 'sticker'>('sticker');
  const [attn, setAttn] = useState(true);
  const [printing, setPrinting] = useState(false);
  const one = (r: Label) => <div className="lbl">
    {layout === 'envelope' && <div className="lbl-to">กรุณาส่ง</div>}
    <b>{[r.title, r.name].filter(Boolean).join(' ')}</b>
    {attn && r.contact && <div>เรียน คุณ{r.contact}</div>}
    {[r.address_1, r.address_2, r.address_3].filter(Boolean).map((x, i) => <div key={i}>{x}</div>)}
    {r.zip_code && <div className="lbl-zip">{r.zip_code}</div>}
  </div>;
  const sheet = <div className={`labels l-${layout}`}>{(rows.data ?? []).map((r) => <div key={r.id} className="lbl-cell">{one(r)}</div>)}</div>;
  return (
    <Modal title="พิมพ์จ่าหน้าซอง/สติ๊กเกอร์" size="wide" onClose={onClose} footer={<><button onClick={onClose}>ปิด</button><button className="primary" disabled={!rows.data?.length} onClick={() => { setPrinting(true); setTimeout(() => { window.print(); setPrinting(false); }, 80); }}>🖨 พิมพ์ {rows.data?.length ?? 0} รายการ</button></>}>
      <div className="toolbar">
        <label>แบบ <select value={layout} onChange={(e) => setLayout(e.target.value as 'sticker')}><option value="sticker">สติ๊กเกอร์ A4 (3 × 8 ดวง)</option><option value="envelope">ซองจดหมาย DL (220 × 110 มม.)</option></select></label>
        <label className="check"><input type="checkbox" checked={attn} onChange={(e) => setAttn(e.target.checked)} /> พิมพ์ชื่อผู้ติดต่อ</label>
        <span className="muted small">ตามคำค้น "{q || 'ทั้งหมด'}" · {rows.data?.length ?? 0} รายการ (สูงสุด 2,000)</span>
      </div>
      <div className="labels-preview">{sheet}</div>
      {printing && createPortal(<div className="label-print">{sheet}</div>, document.body)}
    </Modal>
  );
}
