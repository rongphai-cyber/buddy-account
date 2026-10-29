import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { d, todayIso } from '@buddy/core';
import { api } from '../../api';
import { useCan, useSession } from '../../session';
import { cx, DateInput, DateText, ErrorBox, Field, KeyHints, Money, MoneyInput, PageHead, Pill, toast, useHotkeys } from '../../ui';

/** กระทบยอดเงินฝากธนาคาร — ติ๊กรายการที่ปรากฏในใบแจ้งยอด แล้วเทียบยอดตามบัญชี (ปรับปรุง) กับยอดตามใบแจ้งยอด */
interface Line { id: string; voucher_no: string; voucher_date: string; description: string | null; debit: string; credit: string; cleared: boolean; source_doc_no: string | null; reference: string | null }
interface Recon { bank: { code: string; name: string; account_number: string | null }; from: string; book_balance: string; deposits_in_transit: string; outstanding_payments: string; adjusted_balance: string;
  statement_balance: string | null; difference: string | null; remark: string | null; lines: Line[]; statements: Array<{ statement_date: string; closing_balance: string }>; truncated: boolean }
export function BankReconPage() {
  const qc = useQueryClient();
  const can = useCan('FI.BK.REC');
  const { me } = useSession();
  const banks = useQuery({ queryKey: ['bank-accounts'], queryFn: () => api.get<Array<{ id: string; code: string; name: string; status: string; gl_account_id: string | null }>>('/api/v1/bank-accounts') });
  const [bank, setBank] = useState('');
  const [date, setDate] = useState(me?.work_date ?? todayIso());
  const [from, setFrom] = useState('');
  const [stmt, setStmt] = useState<string | null>(null);
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [err, setErr] = useState<unknown>(null);
  const cur = bank || banks.data?.find((b) => b.status === 'A' && b.gl_account_id)?.id || '';
  const r = useQuery({ enabled: !!cur, queryKey: ['bank-recon', cur, date, from], staleTime: 0, queryFn: () => api.get<Recon>('/api/v1/bank-recon', { bank_account_id: cur, statement_date: date, ...(from ? { from } : {}) }) });
  const x = r.data;
  const toggle = async (ids: string[], cleared: boolean) => {
    setErr(null);
    try { await api.post('/api/v1/bank-recon/clear', { bank_account_id: cur, statement_date: date, line_ids: ids, cleared }); qc.invalidateQueries({ queryKey: ['bank-recon'] }); } catch (e) { setErr(e); }
  };
  const saveStmt = async () => {
    if (stmt === null) return;
    setErr(null);
    try { await api.put('/api/v1/bank-recon/statement', { bank_account_id: cur, statement_date: date, closing_balance: stmt || '0' }); toast('บันทึกยอดตามใบแจ้งยอดแล้ว'); setStmt(null); qc.invalidateQueries({ queryKey: ['bank-recon'] }); } catch (e) { setErr(e); }
  };
  useHotkeys({ F9: can('edit') ? saveStmt : undefined }, [stmt]);
  const lines = (x?.lines ?? []).filter((l) => filter === 'all' || !l.cleared);
  return (
    <div className="page" data-tone="finance">
      <PageHead eyebrow="การเงิน › ธนาคาร" title="กระทบยอดเงินฝากธนาคาร" lead="ป้อนยอดตามใบแจ้งยอด (Bank statement) แล้วติ๊กรายการที่ธนาคารแสดงแล้ว — ยอดตามบัญชี − เงินฝากระหว่างทาง + รายการจ่ายที่ธนาคารยังไม่ตัด ต้องเท่ายอดตามใบแจ้งยอด (ผลต่าง 0)" />
      <div className="toolbar">
        <label>บัญชีเงินฝาก <select value={cur} onChange={(e) => setBank(e.target.value)} aria-label="บัญชีเงินฝาก">{banks.data?.filter((b) => b.status === 'A').map((b) => <option key={b.id} value={b.id}>{b.code} {b.name}</option>)}</select></label>
        <label>วันที่ใบแจ้งยอด <DateInput value={date} onChange={(v) => { setDate(v); setStmt(null); }} /></label>
        <label title="รายการก่อนวันนี้ถือว่ากระทบแล้ว (ค่าเริ่มต้น = ต้นปีบัญชี)">ตั้งแต่ <DateInput value={from || x?.from || ''} onChange={setFrom} /></label>
        <select value={filter} onChange={(e) => setFilter(e.target.value as 'open' | 'all')} aria-label="แสดง"><option value="open">เฉพาะที่ยังไม่กระทบ</option><option value="all">ทุกรายการในช่วง</option></select>
      </div>
      <ErrorBox error={err ?? r.error ?? banks.error} />
      {x && <div className="head-grid trade-head">
        <div className="col">
          <Field label="ยอดตามบัญชี ณ วันที่ใบแจ้งยอด"><b><Money v={x.book_balance} /></b></Field>
          <Field label="หัก เงินฝาก/รับที่ธนาคารยังไม่แสดง"><Money v={x.deposits_in_transit} /></Field>
          <Field label="บวก รายการจ่าย/เช็คที่ธนาคารยังไม่ตัด"><Money v={x.outstanding_payments} /></Field>
          <Field label="ยอดตามบัญชีหลังปรับปรุง"><b><Money v={x.adjusted_balance} /></b></Field>
        </div>
        <div className="col">
          <Field label="ยอดตามใบแจ้งยอด" req><MoneyInput value={stmt ?? x.statement_balance ?? ''} disabled={!can('edit')} onChange={setStmt} aria-label="ยอดตามใบแจ้งยอด" /></Field>
          {stmt !== null && stmt !== (x.statement_balance ?? '') && can('edit') && <button className="primary" onClick={saveStmt}>บันทึกยอด <kbd>F9</kbd></button>}
          <Field label="ผลต่าง">{x.difference === null ? <span className="muted">ป้อนยอดตามใบแจ้งยอด</span> : d(x.difference).isZero() ? <Pill tone="n">กระทบยอดตรงแล้ว</Pill> : <b className="bad"><Money v={x.difference} /></b>}</Field>
          {!!x.statements.length && <p className="muted small">ใบแจ้งยอดที่บันทึก: {x.statements.slice(0, 6).map((s) => <button key={s.statement_date} className="link" onClick={() => setDate(String(s.statement_date).slice(0, 10))}><DateText v={s.statement_date} /></button>).reduce<React.ReactNode[]>((a, b, i) => (i ? [...a, ' · ', b] : [b]), [])}</p>}
        </div>
      </div>}
      {x?.truncated && <p className="bad small">แสดง 5,000 รายการแรก — กำหนด "ตั้งแต่" ให้ใกล้ขึ้น</p>}
      <div className="table-wrap tall">
        <table className="grid">
          <thead><tr><th style={{ width: 40 }}><input type="checkbox" aria-label="ติ๊กทั้งหมด" disabled={!can('edit') || !lines.length} checked={!!lines.length && lines.every((l) => l.cleared)} onChange={(e) => toggle(lines.map((l) => l.id), e.target.checked)} /></th>
            <th style={{ width: 100 }}>วันที่</th><th style={{ width: 130 }}>ใบสำคัญ</th><th style={{ width: 130 }}>เอกสาร</th><th>รายการ</th><th className="r" style={{ width: 130 }}>ฝาก/เข้า</th><th className="r" style={{ width: 130 }}>ถอน/ออก</th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className={cx('row-open', l.cleared && 'selected')} tabIndex={0} onClick={() => can('edit') && toggle([l.id], !l.cleared)} onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && can('edit') && (e.preventDefault(), toggle([l.id], !l.cleared))}>
                <td><input type="checkbox" checked={l.cleared} readOnly aria-label={`กระทบ ${l.voucher_no}`} /></td><td><DateText v={l.voucher_date} /></td><td className="mono">{l.voucher_no}</td><td className="mono">{l.source_doc_no ?? l.reference}</td>
                <td>{l.description}</td><td className="r"><Money v={l.debit} blankZero /></td><td className="r"><Money v={l.credit} blankZero /></td>
              </tr>
            ))}
            {x && !lines.length && <tr><td colSpan={7} className="empty">{filter === 'open' ? 'ทุกรายการกระทบแล้ว' : 'ไม่มีรายการในช่วงนี้'}</td></tr>}
          </tbody>
        </table>
      </div>
      <KeyHints keys={[['คลิก/Space', 'ติ๊ก/ยกเลิกติ๊ก'], ['F9', 'บันทึกยอดตามใบแจ้งยอด']]} />
    </div>
  );
}
