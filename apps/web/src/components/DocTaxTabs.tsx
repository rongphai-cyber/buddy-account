import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { d, docPath, fmt } from '@buddy/core';
import { DocLink } from './DocLink';
import { api } from '../api';
import { VatEditor, type VatRow } from '../pages/tax/VatRegister';
import { DateText, ErrorBox, Pill } from '../ui';

/**
 * แท็บภาษีของเอกสาร (คู่มือ S-PU-03 / S-IV: รายการภาษีซื้อ <Ctrl+F7> · รายการภาษีหัก ณ ที่จ่าย <Ctrl+F10>)
 * รายการในแฟ้มภาษีเกิดจากเอกสารอัตโนมัติเมื่อบันทึก — ที่นี่ตรวจ/แก้เลขที่และวันที่ใบกำกับ งวดที่ยื่น ขอคืนไม่ได้ ได้ทันทีโดยไม่ต้องไปที่แฟ้มภาษี
 */
export const VAT_KIND_OF: Record<string, 'P' | 'S'> = {
  IV: 'S', HS: 'S', DR: 'S', CN: 'S', AI: 'S', OI: 'S', RE: 'S', RR: 'P', HP: 'P', CP: 'P', DN: 'P', AE: 'P', OE: 'P', PS: 'P',
};
/** บิลที่ตัดชำระได้ — ภาษีเกณฑ์เงินสด/หัก ณ ที่จ่าย เกิดที่ใบเสร็จ/ใบจ่ายที่ตัดบิลนี้ */
const BILLS = ['IV', 'DR', 'CN', 'RR', 'CP', 'DN'];
const vatWord = (k: 'P' | 'S') => (k === 'P' ? 'ภาษีซื้อ' : 'ภาษีขาย');
export const vatTabLabel = (cls: string) => `รายการ${vatWord(VAT_KIND_OF[cls] ?? 'P')}`;

const useDocVat = (kind: 'P' | 'S', headerId: string, bill: boolean) =>
  useQuery({ queryKey: ['doc-vat', kind, headerId, bill], queryFn: () => api.get<{ rows: VatRow[] }>(`/api/v1/vat/${kind}`, { [bill ? 'invoice_id' : 'header_id']: headerId, status: 'all' }) });

/** kind = ชนิดภาษีที่ต้องการ (ว่าง = ตามหมวดเอกสาร) · exact = เฉพาะรายการของเอกสารนี้ (ไม่รวมใบเสร็จ/ใบจ่ายที่ตัดบิล) */
export function DocVatTab({ headerId, cls, vatBasis, kind: kindIn, exact }: { headerId: string; cls: string; vatBasis?: string | null; kind?: 'P' | 'S'; exact?: boolean }) {
  const kind = kindIn ?? VAT_KIND_OF[cls] ?? 'P';
  const bill = !exact && BILLS.includes(cls);
  const q = useDocVat(kind, headerId, bill);
  const qc = useQueryClient();
  const nav = useNavigate();
  const [edit, setEdit] = useState<VatRow | null>(null);
  const rows = q.data?.rows ?? [];
  const live = rows.filter((r) => r.doc_status !== 'C');
  const sum = (k: 'base_amount' | 'vat_amount' | 'nonclaim_vat') => live.reduce((s, r) => s.plus(d(r[k])), d(0)).toFixed(2);
  return (
    <div>
      <p className="hint">
        {vatWord(kind)}ของเอกสารนี้ในแฟ้ม{vatWord(kind)} — คลิกแถวเพื่อตรวจ/แก้ เลขที่ วันที่ใบกำกับ งวดที่ยื่น{kind === 'P' ? ' ภาษีที่ขอคืนไม่ได้' : ''} (ยอดเงินแก้ที่เอกสาร)
        {vatBasis === '2' && <b> · ภาษีเกณฑ์เงินสด: รายการเกิดเมื่อ{kind === 'P' ? 'จ่าย' : 'รับ'}ชำระ</b>}
      </p>
      <ErrorBox error={q.error} />
      <div className="table-wrap lines">
        <table className="grid">
          <thead><tr><th>จากเอกสาร</th><th>เลขที่ใบกำกับ</th><th>วันที่ใบกำกับ</th><th>ยื่นงวด</th><th>{kind === 'P' ? 'ผู้ขาย' : 'ผู้ซื้อ'}</th><th>เลขผู้เสียภาษี / สาขา</th>
            <th className="r">มูลค่า</th><th className="r">ภาษี</th>{kind === 'P' && <th className="r">ขอคืนไม่ได้</th>}<th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.doc_status === 'C' ? 'cancelled' : 'row-open'} tabIndex={0} onClick={() => setEdit(r)} onKeyDown={(e) => e.key === 'Enter' && setEdit(r)}>
                <td>{r.header_id !== headerId ? <><DocLink id={r.header_id} no={r.doc_no} cls={r.doc_class} /><span className="muted small"> ({r.doc_class})</span></> : <span className="mono">{r.doc_no}</span>}</td>
                <td className="mono">{r.tax_invoice_no}</td><td><DateText v={r.tax_invoice_date} /></td><td>{r.month}{r.is_late ? ' (เพิ่มเติม)' : ''}</td>
                <td>{r.party_name}</td><td className="mono small">{r.party_tax_id}{r.party_tax_branch_no ? ` / ${r.party_tax_branch_no}` : ''}</td>
                <td className="r num">{fmt(r.base_amount)}</td><td className="r num">{fmt(r.vat_amount)}</td>{kind === 'P' && <td className="r num">{d(r.nonclaim_vat).isZero() ? '' : fmt(r.nonclaim_vat)}</td>}
                <td>{r.doc_status === 'C' ? <Pill tone="x">ยกเลิก</Pill> : r.is_modified ? <Pill tone="m">แก้ในแฟ้มภาษี</Pill> : null}</td>
              </tr>
            ))}
            {q.data && !rows.length && <tr><td colSpan={kind === 'P' ? 10 : 9} className="empty">{vatBasis === '2' ? `ยังไม่มีรายการ — เกิดเมื่อ${kind === 'P' ? 'จ่าย' : 'รับ'}ชำระ` : `เอกสารนี้ไม่มี${vatWord(kind)}`}</td></tr>}
          </tbody>
          {live.length > 1 && <tfoot><tr><td colSpan={6}>รวม</td><td className="r"><b>{fmt(sum('base_amount'))}</b></td><td className="r"><b>{fmt(sum('vat_amount'))}</b></td>{kind === 'P' && <td className="r">{fmt(sum('nonclaim_vat'))}</td>}<td /></tr></tfoot>}
        </table>
      </div>
      {edit && <VatEditor kind={kind} row={edit} defaultMonth={edit.month}
        onOpenDoc={edit.header_id !== headerId ? (r) => { const to = r.header_id && docPath(r.doc_class, r.header_id); if (to) nav(to); } : undefined}
        onClose={() => setEdit(null)} onSaved={() => { setEdit(null); qc.invalidateQueries({ queryKey: ['doc-vat'] }); qc.invalidateQueries({ queryKey: ['vat', kind] }); }} />}
    </div>
  );
}

/**
 * บันทึกเอกสารที่มีภาษีซื้อแล้ว เปิดรายการในแฟ้มภาษีซื้อให้ตรวจทันที (แบบ Express) — เลขที่/วันที่ใบกำกับของผู้ขาย และงวดที่ยื่น
 * ปิดหน้าต่างได้เลยถ้าถูกต้อง
 */
export function VatCheckAfterSave({ headerId, cls, onDone }: { headerId: string; cls: string; onDone: () => void }) {
  const kind = VAT_KIND_OF[cls] ?? 'P';
  const q = useDocVat(kind, headerId, false);
  const qc = useQueryClient();
  const [i, setI] = useState(0);
  const rows = (q.data?.rows ?? []).filter((r) => r.doc_status !== 'C' && !(d(r.vat_amount).isZero() && d(r.nonclaim_vat).isZero()));
  if (q.isLoading) return null;
  const row = rows[i];
  if (!row) { queueMicrotask(onDone); return null; }
  const next = () => { if (i + 1 < rows.length) setI(i + 1); else onDone(); };
  return <VatEditor key={row.id} kind={kind} row={row} defaultMonth={row.month} intro={`ตรวจรายการ${vatWord(kind)}ของเอกสารที่บันทึก — แก้เลขที่/วันที่ใบกำกับภาษีให้ตรงกับใบกำกับของผู้ขาย และงวดที่ยื่น ถูกต้องแล้วกดปิด`}
    onClose={next} onSaved={() => { qc.invalidateQueries({ queryKey: ['doc-vat'] }); qc.invalidateQueries({ queryKey: ['vat', kind] }); next(); }} />;
}

type WhtRow = { id: string; form_type: string; certificate_no: string | null; certificate_date: string; tax_month: string; payee_name: string; income_type: string; paid_amount: string; rate: string; tax_amount: string; doc_status: string; header_id: string | null; doc_no: string | null; doc_class: string | null; print_count: number };
/** ภาษีหัก ณ ที่จ่ายที่เกี่ยวกับบิล (หักตอนจ่ายชำระบิลนี้) — ตรวจ และพิมพ์หนังสือรับรอง 50 ทวิ */
/** by = header: ภาษีหัก ณ ที่จ่ายที่เกิดจากเอกสารนี้เอง (ใบสำคัญที่มาจากเอกสาร) */
export function DocWhtList({ headerId, by = 'invoice' }: { headerId: string; by?: 'invoice' | 'header' }) {
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['doc-wht-bill', headerId, by], queryFn: () => api.get<{ rows: WhtRow[] }>('/api/v1/wht', { [by === 'header' ? 'header_id' : 'invoice_id']: headerId, status: 'all' }) });
  const rows = q.data?.rows ?? [];
  return (
    <div>
      <p className="hint">{by === 'header' ? 'ภาษีหัก ณ ที่จ่ายของเอกสารต้นทาง — เข้าแฟ้ม ภ.ง.ด.3/53 · แก้เลขที่/วันที่หนังสือรับรองได้ที่แฟ้มภาษีหัก ณ ที่จ่าย · พิมพ์ 50 ทวิ ได้จากที่นี่' : 'ภาษีหัก ณ ที่จ่ายของบิลนี้ หักตอนจ่ายชำระ (ใบสำคัญจ่าย) — เข้าแฟ้ม ภ.ง.ด.3/53 · พิมพ์หนังสือรับรอง 50 ทวิ ได้จากที่นี่'}</p>
      <ErrorBox error={q.error} />
      <div className="table-wrap lines">
        <table className="grid">
          <thead><tr><th>จากเอกสาร</th><th>แบบ</th><th>เลขที่หนังสือรับรอง</th><th>วันที่</th><th>ผู้ถูกหัก</th><th>ประเภทเงินได้</th><th className="r">จ่าย</th><th className="r">อัตรา</th><th className="r">ภาษี</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.doc_status === 'C' ? 'cancelled' : undefined}>
                <td>{r.header_id !== headerId ? <DocLink id={r.header_id} no={r.doc_no} cls={r.doc_class} /> : <span className="mono">{r.doc_no}</span>}</td>
                <td>{r.form_type === 'S03' ? 'ภ.ง.ด.3' : 'ภ.ง.ด.53'}</td><td className="mono">{r.certificate_no}</td><td><DateText v={r.certificate_date} /></td><td>{r.payee_name}</td><td>{r.income_type}</td>
                <td className="r num">{fmt(r.paid_amount)}</td><td className="r">{d(r.rate).toString()}%</td><td className="r num">{fmt(r.tax_amount)}</td>
                <td>{r.doc_status === 'C' ? <Pill tone="x">ยกเลิก</Pill> : <button type="button" onClick={() => nav(`/tax/wht50?entry=${r.id}`)}>🖨 50 ทวิ{r.print_count ? ` (${r.print_count})` : ''}</button>}</td>
              </tr>
            ))}
            {q.data && !rows.length && <tr><td colSpan={10} className="empty">{by === 'header' ? 'เอกสารต้นทางไม่มีภาษีหัก ณ ที่จ่าย' : 'ยังไม่มีภาษีหัก ณ ที่จ่าย — ป้อนตอนจ่ายชำระบิลนี้ (เมนู จ่ายชำระหนี้)'}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
