import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { d, fmt } from '@buddy/core';
import { api } from '../../api';
import { AddCheque } from '../docs/Cheques';
import { DateInput, DateText, ErrorBox, Field, Modal, navKey, Pill, toast } from '../../ui';

type Vat = { id: string; tax_invoice_no: string; tax_invoice_date: string; month: string; is_late: boolean; party_name: string | null; base_amount: string; vat_amount: string; nonclaim_vat: string; doc_status: string };
/**
 * รายละเอียดภาษีซื้อ/ภาษีขายของใบสำคัญ (คู่มือ S-GL-03) — ใบสำคัญที่มีบรรทัดบัญชีภาษีซื้อ/ภาษีขาย ป้อนรายการเข้าแฟ้มภาษีจากที่นี่
 * ยอดภาษีเริ่มต้น = ยอดบรรทัดบัญชีภาษีที่ยังไม่ได้ป้อน · ยกเลิกใบสำคัญแล้วรายการภาษียกเลิกตาม
 */
export function JvVatTab({ kind, journal, lineVat, editable }: { kind: 'P' | 'S'; journal: { id: string; voucher_no: string; date: string }; lineVat: string; editable: boolean }) {
  const q = useQuery({ queryKey: ['jv-vat', kind, journal.id], queryFn: () => api.get<{ rows: Vat[] }>(`/api/v1/vat/${kind}`, { journal_id: journal.id, status: 'all' }) });
  const [add, setAdd] = useState(false);
  const entered = (q.data?.rows ?? []).filter((r) => r.doc_status !== 'C').reduce((s, r) => s.plus(r.vat_amount).plus(r.nonclaim_vat), d(0));
  const left = d(lineVat).minus(entered);
  return (
    <div>
      <p className="hint">ยอด{kind === 'P' ? 'ภาษีซื้อ' : 'ภาษีขาย'}ในใบสำคัญ {fmt(lineVat)} · ป้อนในแฟ้มภาษีแล้ว {fmt(entered.toFixed(2))}{!left.isZero() && <b className="bad"> · ยังไม่ได้ป้อน {fmt(left.toFixed(2))}</b>}</p>
      <ErrorBox error={q.error} />
      <table className="grid" style={{ maxWidth: 900 }}>
        <thead><tr><th>เลขที่ใบกำกับ</th><th>วันที่</th><th>งวดภาษี</th><th>{kind === 'P' ? 'ผู้ขาย' : 'ผู้ซื้อ'}</th><th className="r">มูลค่า</th><th className="r">ภาษี</th><th /></tr></thead>
        <tbody>
          {q.data?.rows.map((r) => <tr key={r.id} className={r.doc_status === 'C' ? 'cancelled' : ''}><td className="mono">{r.tax_invoice_no}</td><td><DateText v={r.tax_invoice_date} /></td><td>{r.month}{r.is_late ? ' (เพิ่มเติม)' : ''}</td>
            <td>{r.party_name}</td><td className="r num">{fmt(r.base_amount)}</td><td className="r num">{fmt(d(r.vat_amount).plus(r.nonclaim_vat).toFixed(2))}</td><td>{r.doc_status === 'C' && <Pill tone="x">ยกเลิก</Pill>}</td></tr>)}
          {q.data && !q.data.rows.length && <tr><td colSpan={7} className="empty">ยังไม่มีรายการภาษีของใบสำคัญนี้</td></tr>}
        </tbody>
      </table>
      {editable && <div className="toolbar"><button className="primary" onClick={() => setAdd(true)}>+ ป้อนรายละเอียด{kind === 'P' ? 'ภาษีซื้อ' : 'ภาษีขาย'}</button></div>}
      {add && <VatEntryModal kind={kind} journal={journal} vat={left.gt(0) ? left.toFixed(2) : ''} onClose={() => setAdd(false)} />}
    </div>
  );
}

function VatEntryModal({ kind, journal, vat, onClose }: { kind: 'P' | 'S'; journal: { id: string; voucher_no: string; date: string }; vat: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ tax_invoice_no: '', tax_invoice_date: journal.date, month: journal.date.slice(0, 7), is_late: false, party_name: '', party_tax_id: '', party_tax_branch_no: '', description: '',
    base_amount: vat ? d(vat).div('0.07').toDecimalPlaces(2).toFixed(2) : '', vat_amount: vat, nonclaim_base: '0', nonclaim_vat: '0', zero_rate_amount: '0', remark: '' });
  const [err, setErr] = useState<unknown>(null);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const ok = async () => {
    setErr(null);
    try {
      await api.post(`/api/v1/vat/${kind}`, { ...f, journal_id: journal.id, party_name: f.party_name || null, party_tax_id: f.party_tax_id || null, party_tax_branch_no: f.party_tax_branch_no || null, description: f.description || null, remark: f.remark || null });
      toast('บันทึกรายการภาษีแล้ว'); qc.invalidateQueries({ queryKey: ['jv-vat', kind, journal.id] }); onClose();
    } catch (e) { setErr(e); }
  };
  const money = (k: keyof typeof f) => <input className="r" inputMode="decimal" value={String(f[k])} onChange={(e) => set({ [k]: e.target.value.replace(/[^\d.]/g, '') } as Partial<typeof f>)} />;
  return (
    <Modal title={`ป้อนรายละเอียดรายการ${kind === 'P' ? 'ภาษีซื้อ' : 'ภาษีขาย'} — ${journal.voucher_no}`} onClose={onClose} footer={<><button onClick={onClose}>ยกเลิก <kbd>Esc</kbd></button><button className="primary" onClick={ok}>ตกลง</button></>}>
      <ErrorBox error={err} />
      <div className="form-grid" onKeyDown={navKey}>
        <Field label="เลขที่ใบกำกับภาษี" req><input className="mono" autoFocus value={f.tax_invoice_no} maxLength={30} onChange={(e) => set({ tax_invoice_no: e.target.value })} /></Field>
        <Field label="วันที่ใบกำกับภาษี" req><DateInput value={f.tax_invoice_date} onChange={(v) => set({ tax_invoice_date: v, month: v.slice(0, 7) })} /></Field>
        <Field label="ยื่นภาษีรวมในงวด" hint="ได้รับใบกำกับล่าช้า เลือกงวดถัดไปได้"><input type="month" value={f.month} onChange={(e) => set({ month: e.target.value })} /></Field>
        <Field label="ยื่นเพิ่มเติม"><label className="check"><input type="checkbox" checked={f.is_late} onChange={(e) => set({ is_late: e.target.checked })} /> พิมพ์แยกเป็นรายงานเพิ่มเติม</label></Field>
        <Field label={kind === 'P' ? 'ชื่อผู้ขาย/ผู้ให้บริการ' : 'ชื่อผู้ซื้อ'} wide><input value={f.party_name} maxLength={200} onChange={(e) => set({ party_name: e.target.value })} /></Field>
        <Field label="เลขประจำตัวผู้เสียภาษี / สาขา"><div className="pair"><input className="mono" value={f.party_tax_id} maxLength={13} onChange={(e) => set({ party_tax_id: e.target.value.replace(/\D/g, '') })} aria-label="เลขประจำตัวผู้เสียภาษี" />
          <input className="mono" value={f.party_tax_branch_no} maxLength={5} placeholder="00000" onChange={(e) => set({ party_tax_branch_no: e.target.value.replace(/\D/g, '') })} aria-label="สาขา" /></div></Field>
        <Field label={kind === 'P' ? 'มูลค่า / ภาษีซื้อที่ขอคืนได้' : 'มูลค่า / ภาษีขาย'}><div className="pair">{money('base_amount')}{money('vat_amount')}</div></Field>
        {kind === 'P' && <Field label="มูลค่า / ภาษีซื้อที่ขอคืนไม่ได้"><div className="pair">{money('nonclaim_base')}{money('nonclaim_vat')}</div></Field>}
        <Field label="มูลค่าอัตราศูนย์">{money('zero_rate_amount')}</Field>
        <Field label="หมายเหตุ" wide><input value={f.remark} maxLength={200} onChange={(e) => set({ remark: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

type Chq = { id: string; cheque_no: string; cheque_date: string; amount: string; status: string; party_name: string | null; bank_code: string | null; account_code: string | null };
/** รายละเอียดเช็คจ่าย/เช็ครับของใบสำคัญ (คู่มือ S-GL-04) — เช็คเข้าทะเบียนเช็คผูกกับใบสำคัญนี้ */
export function JvChequeTab({ direction, journal, lineAmount, editable }: { direction: 'P' | 'R'; journal: { id: string; voucher_no: string; date: string }; lineAmount: string; editable: boolean }) {
  const q = useQuery({ queryKey: ['jv-cheques', direction, journal.id], queryFn: () => api.get<{ rows: Chq[] }>('/api/v1/cheques', { direction, journal_id: journal.id, instrument: 'all' }) });
  const [add, setAdd] = useState(false);
  const entered = (q.data?.rows ?? []).reduce((s, r) => s.plus(r.amount), d(0));
  const left = d(lineAmount).minus(entered);
  return (
    <div>
      <p className="hint">ยอด{direction === 'P' ? 'เช็คจ่าย' : 'เช็ครับ'}ล่วงหน้าในใบสำคัญ {fmt(lineAmount)} · เข้าทะเบียนเช็คแล้ว {fmt(entered.toFixed(2))}{!left.isZero() && <b className="bad"> · ยังไม่ได้ป้อน {fmt(left.toFixed(2))}</b>}</p>
      <ErrorBox error={q.error} />
      <table className="grid" style={{ maxWidth: 900 }}>
        <thead><tr><th>เลขที่เช็ค</th><th>ลงวันที่</th><th>{direction === 'P' ? 'บัญชีสั่งจ่าย' : 'ธนาคาร'}</th><th>{direction === 'P' ? 'จ่ายให้' : 'ผู้สั่งจ่าย'}</th><th className="r">จำนวนเงิน</th><th>สถานะ</th></tr></thead>
        <tbody>
          {q.data?.rows.map((r) => <tr key={r.id}><td className="mono">{r.cheque_no}</td><td><DateText v={r.cheque_date} /></td><td>{direction === 'P' ? r.account_code : r.bank_code}</td><td>{r.party_name}</td><td className="r num">{fmt(r.amount)}</td><td>{r.status}</td></tr>)}
          {q.data && !q.data.rows.length && <tr><td colSpan={6} className="empty">ยังไม่มีเช็คของใบสำคัญนี้</td></tr>}
        </tbody>
      </table>
      {editable && <div className="toolbar"><button className="primary" onClick={() => setAdd(true)}>+ ป้อนรายละเอียด{direction === 'P' ? 'เช็คจ่าย' : 'เช็ครับ'}</button></div>}
      {add && <AddCheque direction={direction} journal={{ ...journal, amount: left.gt(0) ? left.toFixed(2) : '' }} onClose={() => setAdd(false)} />}
    </div>
  );
}
