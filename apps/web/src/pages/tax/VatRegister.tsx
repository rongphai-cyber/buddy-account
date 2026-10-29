import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { d, fmt, formatDate, todayIso } from '@buddy/core';
import { api } from '../../api';
import { useCan, useSession } from '../../session';
import { Confirm, cx, DateInput, DateText, ErrorBox, Field, KeyHints, Modal, Money, MoneyInput, navKey, PageHead, Pill, toast, useHotkeys, useYearSystem } from '../../ui';

const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
/** เอกสารต้นทางที่เปิดได้จากแฟ้ม */
export const DOC_ROUTE: Record<string, string> = {
  IV: '/sa/invoices', HS: '/sa/cash-sales', DR: '/fi/ar/debit-notes', CN: '/fi/ar/credit-notes', AI: '/sa/deposits', OI: '/sa/other-income', RE: '/fi/ar/receipts',
  RR: '/pu/invoices', HP: '/pu/cash-purchases', CP: '/fi/ap/debit-notes', DN: '/fi/ap/credit-notes', AE: '/pu/deposits', OE: '/pu/other-expense', PS: '/fi/ap/payments',
};
export interface Row { id: string; tax_invoice_no: string | null; tax_invoice_date: string; doc_no: string; doc_date: string; month: string; is_late: boolean; description: string | null; party_name: string | null; party_tax_id: string | null; party_tax_branch_no: string | null;
  base_amount: string; vat_amount: string; zero_rate_amount: string; nonclaim_base: string; nonclaim_vat: string; is_manual: boolean; is_modified: boolean; doc_status: string; remark: string | null; header_id: string | null; doc_class: string | null; sign: number }
interface Totals { base: string; vat: string; zero: string; nonclaim_base: string; nonclaim_vat: string }
const signed = (r: Row, v: string) => d(v).times(r.sign).toFixed(2);

/** แฟ้มภาษีซื้อ (P) / ภาษีขาย (S) — คู่มือบทที่ 16 S-TX-01..08 */
export function VatRegisterPage({ kind }: { kind: 'P' | 'S' }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const can = useCan(kind === 'P' ? 'FI.VAT.IN' : 'FI.VAT.OUT');
  const ys = useYearSystem();
  const { me } = useSession();
  const today = me?.work_date ?? todayIso();
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [month, setMonth] = useState(Number(today.slice(5, 7)));
  const [late, setLate] = useState<'all' | 'N' | 'Y'>('all');
  const [status, setStatus] = useState<'N' | 'C' | 'all'>('N');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Row | 'new' | null>(null);
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  const list = useQuery({ queryKey: ['vat', kind, ym, late, status, q], queryFn: () => api.get<{ rows: Row[]; totals: Totals }>(`/api/v1/vat/${kind}`, { month: ym, late, status, q }), placeholderData: (p) => p });
  const company = useQuery({ queryKey: ['company'], queryFn: () => api.get<Record<string, string | null>>('/api/v1/company') });
  const title = kind === 'P' ? 'แฟ้มภาษีซื้อ' : 'แฟ้มภาษีขาย';
  const print = () => window.print();
  useHotkeys({ Insert: can('add') && !edit ? () => setEdit('new') : undefined, 'Ctrl+P': print }, []);
  const years = Array.from({ length: 7 }, (_, i) => Number(today.slice(0, 4)) - 5 + i);
  const rows = list.data?.rows ?? [];
  const live = rows.filter((r) => r.doc_status !== 'C');
  const t = list.data?.totals;
  const period = `${MONTHS[month - 1]} ${ys === 'B' ? year + 543 : year}`;
  return (
    <div className="page" data-tone="tax">
      <PageHead eyebrow="ภาษี › ภาษีมูลค่าเพิ่ม" title={title}
        lead={`รายการเกิดจากเอกสารอัตโนมัติ (ภาษีเกณฑ์เงินสดเกิดตอน${kind === 'P' ? 'จ่าย' : 'รับ'}ชำระ) — ตรวจ แก้เลขที่/วันที่ใบกำกับ งวดที่ยื่น ยื่นเพิ่มเติม${kind === 'P' ? ' ย้ายเป็นภาษีขอคืนไม่ได้' : ''} · ใบลดหนี้แสดงเป็นยอดลบ`}
        actions={<>{can('add') && <button onClick={() => setEdit('new')}>+ เพิ่มรายการ <kbd>Ins</kbd></button>}<button className="primary" onClick={print}>🖨 พิมพ์รายงาน{kind === 'P' ? 'ภาษีซื้อ' : 'ภาษีขาย'} <kbd>Ctrl+P</kbd></button></>} />
      <div className="toolbar">
        <label>ยื่นรวมในงวด <select value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label="เดือน">{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="ปี">{years.map((y) => <option key={y} value={y}>{ys === 'B' ? y + 543 : y}</option>)}</select>
        <select value={late} onChange={(e) => setLate(e.target.value as 'all')} aria-label="ยื่นเพิ่มเติม"><option value="all">ทั้งหมด</option><option value="N">ยื่นปกติ</option><option value="Y">ยื่นเพิ่มเติม</option></select>
        <select value={status} onChange={(e) => setStatus(e.target.value as 'N')} aria-label="สถานะ"><option value="N">ปกติ</option><option value="C">ยกเลิก</option><option value="all">ทุกสถานะ</option></select>
        <input type="search" placeholder="ค้นหาเลขที่ ชื่อ เลขผู้เสียภาษี" value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหา" />
      </div>
      <ErrorBox error={list.error} />
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th style={{ width: 70 }}>งวด</th><th style={{ width: 105 }}>วันที่ใบกำกับ</th><th style={{ width: 130 }}>เลขที่ใบกำกับ</th><th style={{ width: 120 }}>เอกสารภายใน</th><th>รายการ</th><th style={{ width: 130 }}>เลขผู้เสียภาษี</th>
            <th className="r" style={{ width: 120 }}>มูลค่า</th><th className="r" style={{ width: 100 }}>ภาษี</th>{kind === 'P' && <th className="r" style={{ width: 100 }}>ขอคืนไม่ได้</th>}<th className="r" style={{ width: 110 }}>อัตรา 0%</th><th style={{ width: 90 }}>สถานะ</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={cx('row-open', r.doc_status === 'C' && 'cancelled')} tabIndex={0} onClick={() => setEdit(r)} onKeyDown={(e) => e.key === 'Enter' && setEdit(r)}>
                <td className="mono">{r.month.slice(5)}/{ys === 'B' ? Number(r.month.slice(0, 4)) + 543 : r.month.slice(0, 4)}</td><td><DateText v={r.tax_invoice_date} /></td><td className="mono">{r.tax_invoice_no}</td><td className="mono">{r.doc_no}</td>
                <td>{r.description ?? r.party_name}</td><td className="mono">{r.party_tax_id}</td>
                <td className="r"><Money v={signed(r, r.base_amount)} /></td><td className="r"><Money v={signed(r, r.vat_amount)} /></td>{kind === 'P' && <td className="r"><Money v={signed(r, r.nonclaim_vat)} blankZero /></td>}<td className="r"><Money v={signed(r, r.zero_rate_amount)} blankZero /></td>
                <td>{r.doc_status === 'C' ? <Pill tone="x">ยกเลิก</Pill> : r.is_late ? <Pill tone="c">ยื่นเพิ่มเติม</Pill> : r.is_manual ? <Pill tone="m">เพิ่มเอง</Pill> : r.is_modified ? <Pill tone="d">แก้ไขแล้ว</Pill> : <Pill tone="n">ปกติ</Pill>}</td>
              </tr>
            ))}
            {list.data && !rows.length && <tr><td colSpan={11} className="empty">ไม่มีรายการในงวดนี้</td></tr>}
          </tbody>
          {t && !!rows.length && <tfoot><tr><td colSpan={6} className="r">รวม {live.length} รายการ (ไม่รวมที่ยกเลิก)</td><td className="r"><b><Money v={t.base} /></b></td><td className="r"><b><Money v={t.vat} /></b></td>{kind === 'P' && <td className="r"><b><Money v={t.nonclaim_vat} blankZero /></b></td>}<td className="r"><b><Money v={t.zero} blankZero /></b></td><td /></tr></tfoot>}
        </table>
      </div>
      <KeyHints keys={[['Ins', 'เพิ่มรายการ'], ['คลิก/Enter', 'แก้ไขรายการ'], ['Ctrl+P', 'พิมพ์รายงาน']]} />
      {edit && <VatEditor kind={kind} row={edit === 'new' ? null : edit} defaultMonth={ym} onOpenDoc={(r) => { const to = r.doc_class && DOC_ROUTE[r.doc_class]; if (to && r.header_id) nav(`${to}/${r.header_id}`); }}
        onClose={() => setEdit(null)} onSaved={() => { setEdit(null); qc.invalidateQueries({ queryKey: ['vat', kind] }); }} />}
      {createPortal(<div className="vat-print">
        <h2>รายงาน{kind === 'P' ? 'ภาษีซื้อ' : 'ภาษีขาย'}</h2>
        <p>เดือนภาษี {period}{late === 'Y' ? ' (ยื่นเพิ่มเติม)' : ''}</p>
        <p>ชื่อผู้ประกอบการ {company.data?.name_th} · เลขประจำตัวผู้เสียภาษีอากร {company.data?.tax_id} · {company.data?.tax_branch_no === '00000' || !company.data?.tax_branch_no ? 'สำนักงานใหญ่' : `สาขาที่ ${company.data.tax_branch_no}`}</p>
        <table>
          <thead><tr><th>ลำดับ</th><th>วัน เดือน ปี</th><th>เลขที่ใบกำกับภาษี</th><th>ชื่อ{kind === 'P' ? 'ผู้ขายสินค้า/ผู้ให้บริการ' : 'ผู้ซื้อสินค้า/ผู้รับบริการ'}</th><th>เลขประจำตัวผู้เสียภาษีอากร</th><th>สถานประกอบการ</th><th>มูลค่าสินค้าหรือบริการ</th><th>จำนวนเงินภาษีมูลค่าเพิ่ม</th></tr></thead>
          <tbody>{live.map((r, i) => <tr key={r.id}><td>{i + 1}</td><td>{formatDate(r.tax_invoice_date, ys)}</td><td>{r.tax_invoice_no}</td><td>{r.party_name ?? r.description}</td><td>{r.party_tax_id}</td>
            <td>{!r.party_tax_branch_no || r.party_tax_branch_no === '00000' ? 'สำนักงานใหญ่' : r.party_tax_branch_no}</td><td className="r">{fmt(signed(r, r.base_amount))}</td><td className="r">{fmt(signed(r, r.vat_amount))}</td></tr>)}</tbody>
          <tfoot><tr><td colSpan={6} className="r">รวม</td><td className="r">{fmt(t?.base ?? '0')}</td><td className="r">{fmt(t?.vat ?? '0')}</td></tr></tfoot>
        </table>
      </div>, document.body)}
    </div>
  );
}

export type VatRow = Row;
/** แก้รายการในแฟ้มภาษี — ใช้ในแฟ้มภาษีและแท็บภาษีของเอกสาร (intro = ข้อความนำ, ไม่มี onOpenDoc = ไม่แสดงปุ่มเปิดเอกสาร) */
export function VatEditor({ kind, row, defaultMonth, onOpenDoc, onClose, onSaved, intro }: { kind: 'P' | 'S'; row: Row | null; defaultMonth: string; onOpenDoc?: (r: Row) => void; onClose: () => void; onSaved: () => void; intro?: string }) {
  const can = useCan(kind === 'P' ? 'FI.VAT.IN' : 'FI.VAT.OUT');
  const ys = useYearSystem();
  const { me } = useSession();
  const date0 = me?.work_date ?? todayIso();
  const n = (v: string | undefined) => (v ? d(v).toString() : '');
  const [e, setE] = useState({ tax_invoice_no: row?.tax_invoice_no ?? '', tax_invoice_date: row ? String(row.tax_invoice_date).slice(0, 10) : date0, month: row?.month ?? defaultMonth, is_late: row?.is_late ?? false,
    description: row?.description ?? '', party_name: row?.party_name ?? '', party_tax_id: row?.party_tax_id ?? '', party_tax_branch_no: row?.party_tax_branch_no ?? '', doc_no: row?.doc_no ?? '',
    base_amount: n(row?.base_amount), vat_amount: n(row?.vat_amount), nonclaim_base: n(row?.nonclaim_base), nonclaim_vat: n(row?.nonclaim_vat), zero_rate_amount: n(row?.zero_rate_amount), remark: row?.remark ?? '' });
  const [err, setErr] = useState<unknown>(null);
  const [askCancel, setAskCancel] = useState(false);
  const fromDoc = !!row && !row.is_manual;
  const ro = (row?.doc_status === 'C') || !can(row ? 'edit' : 'add');
  const set = (p: Partial<typeof e>) => setE((x) => ({ ...x, ...p }));
  // ย้ายทั้งหมดเป็นขอคืนไม่ได้ (คู่มือหน้า 295)
  const moveNonclaim = () => set({ nonclaim_base: d(e.base_amount || 0).plus(d(e.nonclaim_base || 0)).toString(), nonclaim_vat: d(e.vat_amount || 0).plus(d(e.nonclaim_vat || 0)).toString(), base_amount: '0', vat_amount: '0' });
  const save = async () => {
    if (ro) return;
    setErr(null);
    const body = { ...e, base_amount: e.base_amount || '0', vat_amount: e.vat_amount || '0', nonclaim_base: e.nonclaim_base || '0', nonclaim_vat: e.nonclaim_vat || '0', zero_rate_amount: e.zero_rate_amount || '0',
      description: e.description || null, party_name: e.party_name || null, party_tax_id: e.party_tax_id || null, party_tax_branch_no: e.party_tax_branch_no || null, remark: e.remark || null, doc_no: e.doc_no || null };
    try { if (row) await api.put(`/api/v1/vat/${kind}/${row.id}`, body); else await api.post(`/api/v1/vat/${kind}`, body); toast('บันทึกรายการภาษีแล้ว'); onSaved(); } catch (x) { setErr(x); }
  };
  const cancel = async () => { try { await api.post(`/api/v1/vat/${kind}/${row!.id}/cancel`, {}); toast('ยกเลิกรายการแล้ว'); onSaved(); } catch (x) { setAskCancel(false); setErr(x); } };
  useHotkeys({ F9: save, 'Ctrl+S': save }, []);
  const years = Array.from({ length: 7 }, (_, i) => Number(date0.slice(0, 4)) - 5 + i);
  return (
    <Modal title={row ? `รายการภาษี${kind === 'P' ? 'ซื้อ' : 'ขาย'} ${row.tax_invoice_no ?? row.doc_no}` : `เพิ่มรายการภาษี${kind === 'P' ? 'ซื้อ' : 'ขาย'}`} size="wide" onClose={onClose}
      footer={<>
        {fromDoc && row?.doc_class && onOpenDoc && <button onClick={() => onOpenDoc(row)}>เปิดเอกสาร {row.doc_no}</button>}
        {row?.is_manual && row.doc_status !== 'C' && can('cancel') && <button className="danger" onClick={() => setAskCancel(true)}>ยกเลิกรายการ</button>}
        <button onClick={onClose}>ปิด <kbd>Esc</kbd></button>
        {!ro && <button className="primary" onClick={save}>บันทึก <kbd>F9</kbd></button>}
      </>}>
      {intro && <div className="notebox">{intro}</div>}
      <ErrorBox error={err} />
      {fromDoc && <p className="hint">มาจากเอกสาร <b className="mono">{row!.doc_no}</b> — ยอดรวมแก้ที่เอกสารต้นทาง ที่นี่แก้เลขที่/วันที่ใบกำกับ งวดที่ยื่น ยื่นเพิ่มเติม{kind === 'P' ? ' และย้ายยอดเป็นภาษีขอคืนไม่ได้' : ''} · บันทึกเอกสารซ้ำแล้วค่าที่แก้ยังอยู่</p>}
      <div className="form-grid" onKeyDown={navKey}>
        <Field label="เลขที่ใบกำกับภาษี" req><input value={e.tax_invoice_no} maxLength={30} disabled={ro} onChange={(x) => set({ tax_invoice_no: x.target.value })} /></Field>
        <Field label="วันที่ใบกำกับภาษี" req><DateInput value={e.tax_invoice_date} disabled={ro} onChange={(v) => set({ tax_invoice_date: v })} /></Field>
        <Field label="ยื่นภาษีรวมในงวดที่" req hint="ได้รับใบกำกับล่าช้า/ลืมยื่น ระบุงวดอื่นได้"><div className="pair" style={{ gridTemplateColumns: '1fr 90px' }}>
          <select value={Number(e.month.slice(5))} disabled={ro} onChange={(x) => set({ month: `${e.month.slice(0, 4)}-${String(x.target.value).padStart(2, '0')}` })} aria-label="เดือนที่ยื่น">{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
          <select value={Number(e.month.slice(0, 4))} disabled={ro} onChange={(x) => set({ month: `${x.target.value}-${e.month.slice(5)}` })} aria-label="ปีที่ยื่น">{years.map((y) => <option key={y} value={y}>{ys === 'B' ? y + 543 : y}</option>)}</select></div></Field>
        <Field label="ยื่นเพิ่มเติม"><label className="check"><input type="checkbox" checked={e.is_late} disabled={ro} onChange={(x) => set({ is_late: x.target.checked })} /> พิมพ์แยกเป็นรายงานยื่นเพิ่มเติม</label></Field>
        {!fromDoc && <Field label="เลขที่เอกสารภายใน"><input value={e.doc_no} maxLength={30} disabled={ro} onChange={(x) => set({ doc_no: x.target.value })} /></Field>}
        <Field label="รายการ" wide><input value={e.description} maxLength={200} disabled={ro} onChange={(x) => set({ description: x.target.value })} /></Field>
        <Field label={kind === 'P' ? 'ชื่อผู้ขาย/ผู้ให้บริการ' : 'ชื่อผู้ซื้อ/ผู้รับบริการ'} wide><input value={e.party_name} maxLength={200} disabled={ro} onChange={(x) => set({ party_name: x.target.value })} /></Field>
        <Field label="เลขประจำตัวผู้เสียภาษี"><input className="mono" value={e.party_tax_id} maxLength={13} disabled={ro} onChange={(x) => set({ party_tax_id: x.target.value.replace(/\D/g, '') })} /></Field>
        <Field label="สาขา#" hint="00000 = สำนักงานใหญ่"><input className="mono" value={e.party_tax_branch_no} maxLength={5} disabled={ro} onChange={(x) => set({ party_tax_branch_no: x.target.value })} /></Field>
        <Field label={kind === 'P' ? 'มูลค่า (ขอคืนได้)' : 'มูลค่าสินค้า/บริการ'}><MoneyInput value={e.base_amount} disabled={ro} onChange={(v) => set({ base_amount: v })} /></Field>
        <Field label={kind === 'P' ? 'ภาษี (ขอคืนได้)' : 'จำนวนภาษี'}><MoneyInput value={e.vat_amount} disabled={ro} onChange={(v) => set({ vat_amount: v })} /></Field>
        {kind === 'P' && <Field label="มูลค่า (ขอคืนไม่ได้)"><MoneyInput value={e.nonclaim_base} disabled={ro} onChange={(v) => set({ nonclaim_base: v })} /></Field>}
        {kind === 'P' && <Field label="ภาษี (ขอคืนไม่ได้)" hint={!ro ? <button type="button" className="link" onClick={moveNonclaim}>ย้ายทั้งหมดเป็นขอคืนไม่ได้</button> : undefined}><MoneyInput value={e.nonclaim_vat} disabled={ro} onChange={(v) => set({ nonclaim_vat: v })} /></Field>}
        <Field label="มูลค่าอัตราศูนย์"><MoneyInput value={e.zero_rate_amount} disabled={ro || fromDoc} onChange={(v) => set({ zero_rate_amount: v })} /></Field>
        <Field label="หมายเหตุ" wide><input value={e.remark} maxLength={200} disabled={ro} onChange={(x) => set({ remark: x.target.value })} /></Field>
      </div>
      {askCancel && <Confirm danger title="ยกเลิกรายการ" text="ยกเลิกรายการภาษีที่เพิ่มเองนี้? (เปลี่ยนสถานะ ไม่ลบ)" okText="ยกเลิกรายการ" onClose={() => setAskCancel(false)} onOk={cancel} />}
    </Modal>
  );
}
