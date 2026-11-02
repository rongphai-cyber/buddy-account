import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { d, fmt, MONTH_TH, TAX_BEARER_TH, todayIso, WAGE_TYPE_TH, type TaxBearer } from '@buddy/core';
import { api } from '../../api';
import { useCan, useSession } from '../../session';
import { AccountCell } from '../../components/AccountCell';
import { DocLink } from '../../components/DocLink';
import { Confirm, cx, DateInput, DateText, ErrorBox, Field, KeyHints, Modal, Money, MoneyInput, navKey, PageHead, Pill, Tabs, toast, toastError, useHotkeys } from '../../ui';
import { RecNav, usePayItems } from './common';
import { useEmployees } from './Employees';
import { SlipPrintButton } from './Forms';
import { ImportModal } from './Filing';
import { downloadFile } from './common';

interface RunRow { id: string; doc_no: string | null; run_type: string; period_from: string; period_to: string; pay_date: string; status: string; status_th: string; headcount: number;
  total_gross: string; total_tax: string; total_sso_ee: string; total_sso_er: string; total_net: string; note: string | null; branch_code: string | null }
interface Line { id: string; item_id: string; code: string; name_th: string; kind: string; calc: string; sign: number; qty: string | null; rate: string | null; multiplier: string | null; amount: string; source: string; note: string | null }
interface Calc { tax_year: number; start_month: number; end_month: number; remaining: number; annual_regular_income: string; annual_income: string; sso_annual: string; pvd_annual: string; annual_regular_tax: string;
  annual_tax_estimate: string; annual_net_income: string; regular_tax: string; special_tax: string; month_tax: string; other_runs_tax: string; tax_ytd: string; over_withheld: string; tax_manual: boolean; bearer: TaxBearer;
  allowances: Array<{ code: string; name_th: string; amount: string }>; missing_months?: number[] }
interface RunEmp { id: string; employee_id: string; code: string; name: string; position: string | null; department_code: string | null; wage_type: string; tax_bearer: string; work_days: string | null; work_hours: string | null;
  salary_manual: string | null; salary_manual_reason: string | null; tax_manual: string | null; regular: string; special: string; non_taxable: string; gross: string; sso_wage: string; sso_ee: string; sso_er: string;
  pvd_ee: string; pvd_er: string; tax: string; tax_special: string; employer_paid_tax: string; other_deductions: string; net_pay: string; tax_calc: Calc | null; lines: Line[] }
interface Run extends RunRow { tax_month: string; journal_id: string | null; pay_journal_id: string | null; paid_date: string | null; branch_name: string | null; total_pvd_ee: string; total_pvd_er: string; total_deductions: string;
  calculated_at: string | null; cancel_reason: string | null; journal: { voucher_no: string; doc_status: string } | null; pay_journal: { voucher_no: string; doc_status: string } | null; employees: RunEmp[]; warnings: string[] }
interface Posting { lines: Array<{ role: string; role_label: string; account_no: string | null; account_name: string | null; department_code: string | null; debit: string; credit: string }>; missing: Array<{ role: string; label: string }>; debit: string; credit: string }

const TONE: Record<string, 'n' | 'm' | 'c' | 'd' | 'x'> = { D: 'm', N: 'n', P: 'n', C: 'x' };
const monthLabel = (iso: string) => `${MONTH_TH[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(0, 4)) + 543}`;
const useRuns = (year: number) => useQuery({ queryKey: ['pay-runs', year], queryFn: () => api.get<RunRow[]>('/api/v1/pay/runs', { year }) });

/** บันทึกเงินเดือน — รายการรอบเงินเดือน */
export function RunsPage() {
  const nav = useNavigate();
  const can = useCan('PAY.RUN');
  const [year, setYear] = useState(new Date().getFullYear());
  const list = useRuns(year);
  const [add, setAdd] = useState(false);
  useHotkeys({ Insert: can('add') ? () => setAdd(true) : undefined }, []);
  const rows = list.data ?? [];
  return (
    <div className="page" data-tone="gl">
      <PageHead eyebrow="เงินเดือน" title="บันทึกเงินเดือน" lead="สร้างรอบเงินเดือนรายเดือน → ตรวจ/แก้รายคน (OT ขาดงาน โบนัส) → บันทึก = ออกเลขที่และลงบัญชีตั้งค้างจ่ายทันที → จ่ายเงินเดือน = ใบสำคัญจ่าย"
        actions={<button className="primary" disabled={!can('add')} onClick={() => setAdd(true)}>+ สร้างรอบเงินเดือน <kbd>Ins</kbd></button>} />
      <div className="toolbar">
        <label>ปีภาษี <select value={year} onChange={(e) => setYear(Number(e.target.value))}>{[-2, -1, 0, 1].map((k) => { const y = new Date().getFullYear() + k; return <option key={y} value={y}>{y + 543}</option>; })}</select></label>
        <span className="muted small">{rows.length} รอบ</span>
      </div>
      <ErrorBox error={list.error} />
      <div className="table-wrap tall">
        <table className="grid">
          <thead><tr><th style={{ width: 120 }}>เลขที่</th><th>งวด</th><th style={{ width: 90 }}>ประเภท</th><th style={{ width: 100 }}>วันที่จ่าย</th><th style={{ width: 60 }}>สาขา</th><th className="r" style={{ width: 60 }}>คน</th>
            <th className="r" style={{ width: 120 }}>รวมเงินได้</th><th className="r" style={{ width: 110 }}>ภาษี</th><th className="r" style={{ width: 110 }}>ประกันสังคม</th><th className="r" style={{ width: 120 }}>จ่ายสุทธิ</th><th style={{ width: 90 }}>สถานะ</th></tr></thead>
          <tbody>
            {rows.map((r) => <tr key={r.id} className={cx('row-open', r.status === 'C' && 'cancelled')} tabIndex={0} onClick={() => nav(`/pay/runs/${r.id}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`/pay/runs/${r.id}`)}>
              <td className="mono">{r.doc_no ?? <span className="muted">ร่าง</span>}</td><td>{monthLabel(r.period_from)}{r.note ? <span className="muted small"> · {r.note}</span> : null}</td><td>{r.run_type === 'B' ? 'เพิ่มเติม/โบนัส' : 'ปกติ'}</td>
              <td><DateText v={r.pay_date} /></td><td className="mono">{r.branch_code}</td><td className="r">{r.headcount}</td><td className="r"><Money v={r.total_gross} /></td><td className="r"><Money v={r.total_tax} /></td>
              <td className="r"><Money v={d(r.total_sso_ee).plus(r.total_sso_er).toFixed(2)} /></td><td className="r"><Money v={r.total_net} /></td><td><Pill tone={TONE[r.status]}>{r.status_th}</Pill></td></tr>)}
            {list.data && !rows.length && <tr><td colSpan={11} className="empty">ยังไม่มีรอบเงินเดือนในปีนี้ — กด Ins เพื่อสร้าง</td></tr>}
          </tbody>
        </table>
      </div>
      <KeyHints keys={[['Ins', 'สร้างรอบ'], ['คลิก/Enter', 'เปิด']]} />
      {add && <NewRunModal onClose={() => setAdd(false)} onDone={(id) => nav(`/pay/runs/${id}`)} />}
    </div>
  );
}

function NewRunModal({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const { me } = useSession();
  const today = todayIso();
  const [f, setF] = useState({ month: today.slice(0, 7), run_type: 'R', pay_date: '', branch_id: me?.branch?.id ?? '', note: '' });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setErr(null);
    try { const r = await api.post<{ id: string }>('/api/v1/pay/runs', { ...f, pay_date: f.pay_date || null, branch_id: f.branch_id || null, note: f.note || null }); toast('สร้างรอบเงินเดือนแล้ว — ตรวจตัวเลขรายคนก่อนบันทึก'); onDone(r.id); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };
  useHotkeys({ F9: save }, []);
  return (
    <Modal title="สร้างรอบเงินเดือน" size="confirm" onClose={onClose} footer={<><button onClick={onClose}>ยกเลิก <kbd>Esc</kbd></button><button className="primary" disabled={busy} onClick={save}>สร้าง <kbd>F9</kbd></button></>}>
      <ErrorBox error={err} />
      <div className="form-grid" onKeyDown={(e) => navKey(e)}>
        <Field label="เดือน" req hint="งวดวันที่ 1 ถึงสิ้นเดือน"><input type="month" autoFocus value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })} /></Field>
        <Field label="ประเภทรอบ"><select value={f.run_type} onChange={(e) => setF({ ...f, run_type: e.target.value })}><option value="R">ปกติ (เงินเดือน + รายการประจำ ทุกคน)</option><option value="B">เพิ่มเติม/โบนัส (เลือกพนักงานเอง)</option></select></Field>
        <Field label="วันที่จ่าย" hint="ว่าง = สิ้นเดือน · เดือนที่จ่าย = เดือนภาษี ภ.ง.ด.1"><DateInput value={f.pay_date} onChange={(v) => setF({ ...f, pay_date: v })} /></Field>
        {(me?.branches.length ?? 0) > 1 && <Field label="สาขา" hint="ดึงพนักงานของสาขานี้"><select value={f.branch_id} onChange={(e) => setF({ ...f, branch_id: e.target.value })}>{me!.branches.map((b) => <option key={b.id} value={b.id}>{b.code} {b.name}</option>)}</select></Field>}
        <Field label="หมายเหตุ"><input value={f.note} maxLength={200} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

/** รอบเงินเดือน: รายคน · ลงบัญชี */
export function RunPage() {
  const { id } = useParams() as { id: string };
  const nav = useNavigate();
  const qc = useQueryClient();
  const can = useCan('PAY.RUN');
  const q = useQuery({ queryKey: ['pay-run', id], queryFn: () => api.get<Run>(`/api/v1/pay/runs/${id}`), staleTime: 0 });
  const r = q.data;
  const all = useRuns(r ? Number(r.tax_month.slice(0, 4)) : new Date().getFullYear());
  const [tab, setTab] = useState('emp');
  const [open, setOpen] = useState<RunEmp | null>(null);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<'reopen' | 'unpay' | 'cancel' | 'delete' | 'post' | null>(null);
  const [reason, setReason] = useState('');
  const [pay, setPay] = useState<{ paid_date: string; account_id: string | null } | null>(null);
  const [addEmp, setAddEmp] = useState(false);
  const [editHead, setEditHead] = useState<{ pay_date: string; note: string } | null>(null);
  const [imp, setImp] = useState(false);
  const reload = () => { qc.invalidateQueries({ queryKey: ['pay-run', id] }); qc.invalidateQueries({ queryKey: ['pay-runs'] }); qc.invalidateQueries({ queryKey: ['pay-post', id] }); };
  const act = async (f: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try { await f(); toast(msg); reload(); } catch (e) { toastError(e); } finally { setBusy(false); setAsk(null); setReason(''); }
  };
  const draft = r?.status === 'D';
  const post = () => draft && can('edit') && setAsk('post');
  useHotkeys({ F9: post, 'Ctrl+S': post, 'Alt+C': () => r && r.status !== 'C' && can('cancel') && setAsk(r.status === 'D' && !r.doc_no ? 'delete' : 'cancel'), Escape: () => nav('/pay/runs') }, []);
  const tot = (k: keyof RunEmp) => (r?.employees ?? []).reduce((s, e) => s.plus(d(e[k] as string)), d(0)).toFixed(2);
  return (
    <div className="page" data-tone="gl">
      <div className="doc-title"><p className="eyebrow">เงินเดือน › บันทึกเงินเดือน</p>
        <h1><span className="mono">{r?.doc_no ?? 'ร่าง'}</span> {r && `${r.run_type === 'B' ? 'เงินได้เพิ่มเติม' : 'เงินเดือน'} ${monthLabel(r.period_from)}`}</h1>
        <span className="doc-state">{r && <Pill tone={TONE[r.status]}>{r.status_th}</Pill>}{r?.cancel_reason && <span className="muted small"> เหตุผล: {r.cancel_reason}</span>}</span></div>
      <div className="toolbar">
        <button disabled={!draft || busy || !can('edit')} onClick={() => act(() => api.post(`/api/v1/pay/runs/${id}/calculate`), 'คำนวณใหม่ทุกคนแล้ว')} title="คิดใหม่ตามทะเบียนพนักงาน ค่าลดหย่อน และรายการประจำล่าสุด">↻ คำนวณใหม่</button>
        <button className="primary" disabled={!draft || busy || !can('edit')} onClick={() => setAsk('post')}>บันทึก (ลงบัญชี) <kbd>F9</kbd></button>
        <button disabled={r?.status !== 'N' || busy || !can('edit')} onClick={() => setAsk('reopen')} title="เปิดกลับเป็นร่างเพื่อแก้ตัวเลข — ใบสำคัญเดิมยกเลิกชั่วคราว บันทึกใหม่ได้เลขเดิม">แก้ไข</button>
        <button disabled={r?.status !== 'N' || busy || !can('edit')} onClick={() => setPay({ paid_date: r?.pay_date ?? '', account_id: null })}>💵 จ่ายเงินเดือน</button>
        <button disabled={r?.status !== 'P' || busy || !can('cancel')} onClick={() => setAsk('unpay')}>ยกเลิกการจ่าย</button>
        <button disabled={!r || r.status === 'C' || r.status === 'P' || (draft && !r.doc_no) || busy || !can('cancel')} onClick={() => setAsk('cancel')}>ยกเลิก <kbd>Alt+C</kbd></button>
        <button className="danger-outline" disabled={!r || !(r.status === 'C' || (draft && !r.doc_no)) || busy || !can('delete')} onClick={() => setAsk('delete')}>ลบ</button>
        {r && r.headcount > 0 && <SlipPrintButton runId={id} />}
        {draft && <button disabled={!can('edit')} onClick={() => setImp(true)} title="ป้อน OT วันทำงาน โบนัส ฯลฯ ของทุกคนจาก Excel">⬆ นำเข้าจาก Excel</button>}
        {(r?.status === 'N' || r?.status === 'P') && <button disabled={!can('print')} onClick={() => downloadFile(`/api/v1/pay/runs/${id}/bank-file`, 'bank.csv').then(() => toast('สร้างไฟล์โอนแล้ว')).catch(toastError)} title="CSV รายชื่อ เลขบัญชี ยอดโอน — นำเข้าระบบโอนเงินของธนาคาร">ไฟล์โอนธนาคาร</button>}
        <RecNav ids={(all.data ?? []).map((x) => x.id)} cur={id} go={(to) => nav(`/pay/runs/${to}`)} />
        <button onClick={() => nav('/pay/runs')}>รายการ <kbd>Esc</kbd></button>
      </div>
      <ErrorBox error={q.error} />
      {r && <>
        <div className="form-grid">
          <Field label="งวด"><input readOnly tabIndex={-1} value={`${monthLabel(r.period_from)} (${r.run_type === 'B' ? 'เพิ่มเติม/โบนัส' : 'ปกติ'})`} /></Field>
          <Field label="วันที่จ่าย / เดือนภาษี" hint={draft ? <button className="link" onClick={() => setEditHead({ pay_date: r.pay_date, note: r.note ?? '' })}>เปลี่ยนวันที่จ่าย/หมายเหตุ</button> : undefined}><input readOnly tabIndex={-1} value={`${r.pay_date.split('-').reverse().join('/')} · ${monthLabel(r.tax_month)}`} /></Field>
          <Field label="สาขา"><input readOnly tabIndex={-1} value={r.branch_code ? `${r.branch_code} ${r.branch_name ?? ''}` : ''} /></Field>
          <Field label="ใบสำคัญ">{r.journal ? <span><DocLink id={r.journal_id} no={r.journal.voucher_no} cls="GL" />{r.journal.doc_status === 'C' && <span className="muted small"> (ยกเลิก)</span>}
            {r.pay_journal && <> · จ่าย <DocLink id={r.pay_journal_id} no={r.pay_journal.voucher_no} cls="GL" />{r.pay_journal.doc_status === 'C' && <span className="muted small"> (ยกเลิก)</span>}</>}</span> : <span className="muted">ยังไม่ลงบัญชี</span>}</Field>
        </div>
        {!!r.warnings.length && <div className="note-box warn"><ul className="small">{r.warnings.map((w) => <li key={w}>{w}</li>)}</ul></div>}
        <Tabs active={tab} onChange={setTab} tabs={[{ key: 'emp', label: 'พนักงาน', badge: r.headcount }, { key: 'gl', label: 'ลงบัญชี' }]} />
        {tab === 'emp' && <>
          {draft && <div className="toolbar"><button disabled={!can('edit')} onClick={() => setAddEmp(true)}>+ เพิ่มพนักงานในรอบ</button><span className="hint">คลิกชื่อพนักงานเพื่อป้อน OT ขาดงาน โบนัส หรือแก้รายการ</span></div>}
          <div className="table-wrap tall">
            <table className="grid">
              <thead><tr><th style={{ width: 80 }}>รหัส</th><th>ชื่อ</th><th style={{ width: 60 }}>แผนก</th><th className="r">เงินได้ประจำ</th><th className="r">ไม่ประจำ</th><th className="r">รวมเงินได้</th>
                <th className="r">ประกันสังคม</th><th className="r">กองทุนฯ</th><th className="r">ภาษี</th><th className="r">หักอื่น</th><th className="r">จ่ายสุทธิ</th><th style={{ width: 30 }} /></tr></thead>
              <tbody>{r.employees.map((e) => <tr key={e.id} className="row-open" tabIndex={0} onClick={() => setOpen(e)} onKeyDown={(k) => k.key === 'Enter' && setOpen(e)}>
                <td className="mono">{e.code}</td><td>{e.name}{e.salary_manual != null && <Pill tone="c">แก้เงินเดือน</Pill>}{e.tax_manual != null && <Pill tone="c">แก้ภาษี</Pill>}{!!e.tax_calc?.missing_months?.length && <Pill tone="d">ขาดเดือนก่อน</Pill>}</td>
                <td className="mono">{e.department_code}</td><td className="r"><Money v={e.regular} /></td><td className="r"><Money v={e.special} blankZero /></td><td className="r"><Money v={e.gross} /></td>
                <td className="r"><Money v={e.sso_ee} blankZero /></td><td className="r"><Money v={e.pvd_ee} blankZero /></td><td className="r"><Money v={d(e.tax).minus(e.employer_paid_tax).toFixed(2)} blankZero />{d(e.employer_paid_tax).gt(0) && <span className="muted small" title="บริษัทออกให้"> +{fmt(e.employer_paid_tax)}</span>}</td>
                <td className="r"><Money v={e.other_deductions} blankZero /></td><td className={cx('r', d(e.net_pay).lt(0) && 'neg')}><b><Money v={e.net_pay} /></b></td>
                <td>{draft && can('edit') && <button className="link" title="เอาออกจากรอบ" onClick={(k) => { k.stopPropagation(); if (window.confirm(`เอา ${e.code} ออกจากรอบนี้?`)) act(() => api.del(`/api/v1/pay/runs/${id}/employees/${e.id}`), 'เอาออกแล้ว'); }}>✕</button>}</td></tr>)}
                {!r.employees.length && <tr><td colSpan={12} className="empty">ยังไม่มีพนักงานในรอบนี้{draft ? ` — รอบปกติดึงพนักงานที่สังกัดสาขา ${r.branch_code ?? ''} และทำงานในงวด (ตรวจสาขาที่ทะเบียนพนักงาน) หรือกด "+ เพิ่มพนักงานในรอบ"` : ''}</td></tr>}</tbody>
              {!!r.employees.length && <tfoot><tr><td colSpan={3}>รวม {r.headcount} คน</td><td className="r"><Money v={tot('regular')} /></td><td className="r"><Money v={tot('special')} /></td><td className="r"><Money v={r.total_gross} /></td>
                <td className="r"><Money v={r.total_sso_ee} /></td><td className="r"><Money v={r.total_pvd_ee} /></td><td className="r"><Money v={d(r.total_tax).minus(tot('employer_paid_tax')).toFixed(2)} /></td><td className="r"><Money v={r.total_deductions} /></td><td className="r"><b><Money v={r.total_net} /></b></td><td /></tr>
                <tr className="muted"><td colSpan={6}>ส่วนของนายจ้าง</td><td className="r"><Money v={r.total_sso_er} /></td><td className="r"><Money v={r.total_pvd_er} /></td><td className="r"><Money v={tot('employer_paid_tax')} blankZero /></td><td colSpan={3} /></tr></tfoot>}
            </table>
          </div>
        </>}
        {tab === 'gl' && <PostingTab id={id} />}
      </>}
      <KeyHints keys={[['คลิก/Enter', 'แก้รายคน'], ['F9', 'บันทึก'], ['Alt+C', 'ยกเลิก'], ['Esc', 'รายการ']]} />
      {open && r && <EmpPayModal run={r} emp={r.employees.find((x) => x.id === open.id) ?? open} editable={draft && can('edit')} onClose={() => setOpen(null)} onSaved={reload} />}
      {imp && r && <ImportModal<{ row: number; code: string; lines: number; work_days: string | null; work_hours: string | null }> title="นำเข้ายอดประจำงวดจาก Excel"
        intro="แบบฟอร์มมีรายชื่อพนักงานในรอบนี้และคอลัมน์ตามรายการเงินได้/เงินหัก — กรอกเฉพาะช่องที่มี แถวที่กรอกจะแทนรายการที่ป้อนเองเดิมของคนนั้น แล้วโปรแกรมคำนวณใหม่"
        templateUrl={`/api/v1/pay/runs/${id}/import/template`} templateName="ยอดงวด.xlsx" postUrl={`/api/v1/pay/runs/${id}/import`}
        cols={[['รายการ', (x) => x.lines], ['วันทำงาน', (x) => x.work_days], ['ชั่วโมง', (x) => x.work_hours]]} onClose={() => setImp(false)} onDone={() => { setImp(false); reload(); }} />}
      {addEmp && r && <AddEmployees run={r} onClose={() => setAddEmp(false)} onDone={() => { setAddEmp(false); reload(); }} />}
      {ask === 'post' && <Confirm title="บันทึกรอบเงินเดือน" text={<>บันทึกและลงบัญชีตั้งค้างจ่าย {r?.headcount} คน จ่ายสุทธิ {fmt(r?.total_net)} บาท?<br /><span className="small muted">ตรวจรายการลงบัญชีได้ที่แท็บ "ลงบัญชี" ก่อนบันทึก</span></>} okText="บันทึก" onClose={() => setAsk(null)}
        onOk={() => act(() => api.post(`/api/v1/pay/runs/${id}/post`), 'บันทึกและลงบัญชีแล้ว')} />}
      {(ask === 'reopen' || ask === 'unpay' || ask === 'cancel') && <Confirm danger={ask === 'cancel'} title={ask === 'reopen' ? 'แก้ไขรอบเงินเดือน' : ask === 'unpay' ? 'ยกเลิกการจ่าย' : 'ยกเลิกรอบเงินเดือน'}
        text={<>{ask === 'reopen' ? 'เปิดกลับเป็นร่าง — ใบสำคัญเดิมเป็นสถานะยกเลิกจนกว่าจะบันทึกใหม่ (เลขที่เดิม)' : ask === 'unpay' ? 'ใบสำคัญจ่ายเงินเดือนจะถูกยกเลิก' : 'รอบนี้และใบสำคัญจะเป็นสถานะยกเลิก (ไม่ลบ)'}
          <Field label="เหตุผล" req><input autoFocus value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></Field></>}
        onClose={() => { setAsk(null); setReason(''); }} onOk={() => act(() => api.post(`/api/v1/pay/runs/${id}/${ask}`, { reason }), ask === 'reopen' ? 'เปิดกลับเป็นร่างแล้ว' : ask === 'unpay' ? 'ยกเลิกการจ่ายแล้ว' : 'ยกเลิกรอบแล้ว')} />}
      {ask === 'delete' && <Confirm danger title="ลบรอบเงินเดือน" text={r?.doc_no ? `ลบรอบ ${r.doc_no} ที่ยกเลิกแล้ว? เลขที่จะว่างให้ใช้ใหม่` : 'ลบรอบร่างนี้?'} okText="ลบ" onClose={() => setAsk(null)}
        onOk={() => api.del(`/api/v1/pay/runs/${id}`).then(() => { toast('ลบรอบเงินเดือนแล้ว'); qc.invalidateQueries({ queryKey: ['pay-runs'] }); nav('/pay/runs'); }).catch((e) => { setAsk(null); toastError(e); })} />}
      {pay && <Modal title="จ่ายเงินเดือน" size="confirm" onClose={() => setPay(null)} footer={<><button onClick={() => setPay(null)}>ยกเลิก</button>
        <button className="primary" disabled={!pay.account_id || !pay.paid_date} onClick={() => act(() => api.post(`/api/v1/pay/runs/${id}/pay`, pay), 'บันทึกการจ่ายเงินเดือนแล้ว').then(() => setPay(null))}>บันทึกการจ่าย</button></>}>
        <p className="small muted">ลงบัญชี Dr เงินเดือนค้างจ่าย / Cr บัญชีที่จ่าย ยอด {fmt(r?.total_net)} บาท</p>
        <div className="form-grid" onKeyDown={(e) => navKey(e)}>
          <Field label="วันที่จ่าย" req><DateInput autoFocus value={pay.paid_date} onChange={(v) => setPay({ ...pay, paid_date: v })} /></Field>
          <Field label="จ่ายจากบัญชี" req hint="เงินสด หรือเงินฝากธนาคาร"><AccountCell value={pay.account_id} required onChange={(a) => setPay({ ...pay, account_id: a?.id ?? null })} /></Field>
        </div>
      </Modal>}
      {editHead && <Modal title="วันที่จ่าย / หมายเหตุ" size="confirm" onClose={() => setEditHead(null)} footer={<><button onClick={() => setEditHead(null)}>ยกเลิก</button>
        <button className="primary" onClick={() => act(() => api.put(`/api/v1/pay/runs/${id}`, { pay_date: editHead.pay_date, note: editHead.note || null }), 'บันทึกแล้ว — คำนวณใหม่ทุกคน').then(() => setEditHead(null))}>บันทึก</button></>}>
        <div className="form-grid" onKeyDown={(e) => navKey(e)}>
          <Field label="วันที่จ่าย" req hint="เปลี่ยนเดือนที่จ่าย = เปลี่ยนเดือนภาษี"><DateInput autoFocus value={editHead.pay_date} onChange={(v) => setEditHead({ ...editHead, pay_date: v })} /></Field>
          <Field label="หมายเหตุ"><input value={editHead.note} maxLength={200} onChange={(e) => setEditHead({ ...editHead, note: e.target.value })} /></Field>
        </div>
      </Modal>}
    </div>
  );
}

function PostingTab({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['pay-post', id], queryFn: () => api.get<Posting>(`/api/v1/pay/runs/${id}/posting-preview`) });
  const p = q.data;
  const canLink = useCan('SET.LINK');
  const fill = async () => {
    try {
      const r = await api.post<{ filled: Array<{ role: string; account_no: string }>; missing: string[] }>('/api/v1/pay/default-accounts');
      toast(r.filled.length ? `กำหนดบัญชีแล้ว ${r.filled.length} รายการ${r.missing.length ? ` — ยังไม่พบ: ${r.missing.join(', ')}` : ''}` : 'ไม่พบบัญชีที่ตรงกับผังตัวอย่าง — กำหนดเองที่ การเชื่อมต่อบัญชี', r.missing.length ? 'warn' : 'ok');
      q.refetch();
    } catch (e) { toastError(e); }
  };
  return (
    <div>
      <ErrorBox error={q.error} />
      {p && !!p.missing.length && <div className="note-box warn">ยังไม่ได้กำหนดบัญชี: <b>{p.missing.map((m) => m.label).join(', ')}</b> — กำหนดที่ เริ่มระบบ › การเชื่อมต่อบัญชี (หมวด "เงินเดือน") ก่อนบันทึก
        {' '}<button disabled={!canLink('edit')} onClick={fill} title="ใช้บัญชีที่เลขที่และชื่อตรงกับผังบัญชีตัวอย่าง ไทย–อังกฤษ (ไม่ทับที่กำหนดไว้แล้ว)">เติมบัญชีจากผังตัวอย่าง</button></div>}
      <p className="hint">ใบสำคัญ 1 ใบต่อรอบ รวมยอดตามบัญชีและแผนก (ไม่แสดงชื่อพนักงาน) · บัญชีของแต่ละรายการกำหนดได้ที่ เงินเดือน › รายการเงินได้/เงินหัก</p>
      <table className="grid" style={{ maxWidth: 900 }}>
        <thead><tr><th style={{ width: 110 }}>เลขที่บัญชี</th><th>ชื่อบัญชี</th><th style={{ width: 70 }}>แผนก</th><th>รายการ</th><th className="r" style={{ width: 130 }}>เดบิต</th><th className="r" style={{ width: 130 }}>เครดิต</th></tr></thead>
        <tbody>{p?.lines.map((l, i) => <tr key={i} className={cx(!l.account_no && 'neg')}><td className="mono">{l.account_no ?? '—'}</td><td>{l.account_name}</td><td className="mono">{l.department_code}</td><td className="small muted">{l.role_label}</td>
          <td className="r"><Money v={l.debit} blankZero /></td><td className="r"><Money v={l.credit} blankZero /></td></tr>)}</tbody>
        {p && <tfoot><tr><td colSpan={4}>รวม</td><td className="r"><Money v={p.debit} /></td><td className="r"><Money v={p.credit} /></td></tr></tfoot>}
      </table>
    </div>
  );
}

function AddEmployees({ run, onClose, onDone }: { run: Run; onClose: () => void; onDone: () => void }) {
  const list = useEmployees('A');
  const have = new Set(run.employees.map((e) => e.employee_id));
  const rows = (list.data ?? []).filter((e) => !have.has(e.id) && e.hire_date <= run.period_to && (!e.end_date || e.end_date >= run.period_from));
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await api.post(`/api/v1/pay/runs/${run.id}/employees`, { employee_ids: [...sel] }); toast(`เพิ่ม ${sel.size} คนแล้ว`); onDone(); } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <Modal title="เพิ่มพนักงานในรอบ" onClose={onClose} footer={<><button onClick={() => setSel(new Set(rows.map((r) => r.id)))}>เลือกทั้งหมด</button><button onClick={onClose}>ยกเลิก</button>
      <button className="primary" disabled={!sel.size || busy} onClick={save}>เพิ่ม {sel.size} คน</button></>}>
      <div className="table-wrap"><table className="grid">
        <thead><tr><th style={{ width: 30 }} /><th>รหัส</th><th>ชื่อ</th><th>ตำแหน่ง</th></tr></thead>
        <tbody>{rows.map((e) => <tr key={e.id} className="row-open" onClick={() => setSel((s) => { const n = new Set(s); if (n.has(e.id)) n.delete(e.id); else n.add(e.id); return n; })}>
          <td className="c"><input type="checkbox" readOnly checked={sel.has(e.id)} aria-label={e.code} /></td><td className="mono">{e.code}</td><td>{e.name}</td><td>{e.position}</td></tr>)}
          {list.data && !rows.length && <tr><td colSpan={4} className="empty">พนักงานที่ทำงานในงวดนี้อยู่ในรอบครบแล้ว</td></tr>}</tbody>
      </table></div>
    </Modal>
  );
}

type EditLine = { item_id: string; qty: string; amount: string; note: string };
/** รายคน: ป้อน OT/ขาดงาน/โบนัส/หักอื่น · แก้เงินเดือน/ภาษีเอง (ต้องมีเหตุผล) · ภาษีคำนวณอย่างไร */
function EmpPayModal({ run, emp, editable, onClose, onSaved }: { run: Run; emp: RunEmp; editable: boolean; onClose: () => void; onSaved: () => void }) {
  const items = usePayItems();
  const usable = (items.data ?? []).filter((x) => x.calc !== 'WAGE' && x.calc !== 'SYSTEM' && x.status === 'A');
  const init = () => ({ work_days: emp.work_days ? d(emp.work_days).toString() : '', work_hours: emp.work_hours ? d(emp.work_hours).toString() : '', salary_manual: emp.salary_manual ?? '', salary_manual_reason: emp.salary_manual_reason ?? '', tax_manual: emp.tax_manual ?? '',
    lines: emp.lines.filter((l) => l.source === 'MANUAL' || l.source === 'IMPORT').map((l) => ({ item_id: l.item_id, qty: l.qty ? d(l.qty).toString() : '', amount: l.calc === 'AMOUNT' ? d(l.amount).toString() : '', note: l.note ?? '' })) as EditLine[] });
  const [f, setF] = useState(init);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('slip');
  useEffect(() => { setF(init()); }, [emp]);   // eslint-disable-line react-hooks/exhaustive-deps
  const kind = (itemId: string) => items.data?.find((x) => x.id === itemId);
  const save = async () => {
    if (!editable) return;
    setBusy(true); setErr(null);
    const body = { work_days: f.work_days || null, work_hours: f.work_hours || null, salary_manual: f.salary_manual || null, salary_manual_reason: f.salary_manual_reason || null, tax_manual: f.tax_manual || null,
      lines: f.lines.filter((l) => l.item_id).map((l) => { const it = kind(l.item_id); const qty = it && it.calc !== 'AMOUNT'; return { item_id: l.item_id, qty: qty ? l.qty || '0' : null, amount: qty ? null : l.amount || '0', note: l.note || null }; }) };
    try { await api.put(`/api/v1/pay/runs/${run.id}/employees/${emp.id}`, body); toast(`คำนวณ ${emp.code} ใหม่แล้ว`); onSaved(); setTab('slip'); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  useHotkeys({ F9: save, 'Ctrl+S': save }, []);
  const c = emp.tax_calc;
  const setLine = (i: number, p: Partial<EditLine>) => setF((x) => ({ ...x, lines: x.lines.map((l, k) => (k === i ? { ...l, ...p } : l)) }));
  const unit = (calc?: string) => (calc === 'HOURS' ? 'ชั่วโมง' : calc === 'DAYS' ? 'วัน' : calc === 'MINUTES' ? 'นาที' : '');
  return (
    <Modal size="wide" title={`${emp.code} ${emp.name} — ${WAGE_TYPE_TH[emp.wage_type as 'M']} · ${TAX_BEARER_TH[emp.tax_bearer as TaxBearer]}`} onClose={onClose}
      footer={<><SlipPrintButton runId={run.id} reId={emp.id} label="🖨 สลิปคนนี้" /><button onClick={onClose}>ปิด <kbd>Esc</kbd></button>{editable && <button className="primary" disabled={busy} onClick={save}>คำนวณใหม่และเก็บ <kbd>F9</kbd></button>}</>}>
      <ErrorBox error={err} />
      <Tabs active={tab} onChange={setTab} tabs={[{ key: 'slip', label: 'รายการ' }, { key: 'input', label: 'ป้อน/แก้ไข' }, { key: 'tax', label: 'ภาษีคำนวณอย่างไร' }]} />
      {tab === 'slip' && <div className="fa-grid">
        <table className="grid compact"><thead><tr><th>เงินได้</th><th className="r">จำนวน</th><th className="r">จำนวนเงิน</th></tr></thead>
          <tbody>{emp.lines.filter((l) => l.kind === 'E').map((l) => <tr key={l.id}><td>{l.name_th}{l.note && <div className="muted small">{l.note}</div>}</td><td className="r small">{l.qty ? `${d(l.qty).toString()} ${unit(l.calc)}` : ''}</td>
            <td className="r">{l.sign < 0 ? '−' : ''}<Money v={l.amount} /></td></tr>)}</tbody>
          <tfoot><tr><td colSpan={2}>รวมเงินได้</td><td className="r"><Money v={emp.gross} /></td></tr></tfoot></table>
        <table className="grid compact"><thead><tr><th>เงินหัก</th><th className="r">จำนวนเงิน</th></tr></thead>
          <tbody>{emp.lines.filter((l) => l.kind === 'D').map((l) => <tr key={l.id}><td>{l.name_th}{l.note && <div className="muted small">{l.note}</div>}</td><td className="r"><Money v={l.amount} /></td></tr>)}</tbody>
          <tfoot><tr><td>จ่ายสุทธิ</td><td className="r"><b><Money v={emp.net_pay} /></b></td></tr></tfoot></table>
        <div className="small">
          <p>ประกันสังคม: ลูกจ้าง {fmt(emp.sso_ee)} · นายจ้าง {fmt(emp.sso_er)} (ค่าจ้างที่คิด {fmt(emp.sso_wage)})</p>
          {d(emp.pvd_ee).gt(0) && <p>กองทุนสำรองเลี้ยงชีพ: สะสม {fmt(emp.pvd_ee)} · สมทบ {fmt(emp.pvd_er)}</p>}
          <p>ภาษี: {fmt(emp.tax)}{d(emp.employer_paid_tax).gt(0) ? ` (บริษัทออกให้ ${fmt(emp.employer_paid_tax)})` : ''} · ส่วนของเงินได้ไม่ประจำ {fmt(emp.tax_special)}</p>
        </div>
      </div>}
      {tab === 'input' && <div onKeyDown={(e) => navKey(e)}>
        <div className="form-grid">
          {emp.wage_type === 'D' && <Field label="วันทำงาน" req hint="รายวัน: ค่าจ้าง = วัน × อัตรา"><MoneyInput value={f.work_days} disabled={!editable} onChange={(v) => setF({ ...f, work_days: v })} /></Field>}
          {emp.wage_type === 'H' && <Field label="ชั่วโมงทำงาน" req><MoneyInput value={f.work_hours} disabled={!editable} onChange={(v) => setF({ ...f, work_hours: v })} /></Field>}
          {run.run_type === 'R' && <Field label="เงินเดือนป้อนเอง" hint="ว่าง = ตามประวัติค่าจ้าง"><MoneyInput value={f.salary_manual} disabled={!editable} onChange={(v) => setF({ ...f, salary_manual: v })} /></Field>}
          {f.salary_manual !== '' && <Field label="เหตุผลที่แก้เงินเดือน" req><input value={f.salary_manual_reason} maxLength={200} disabled={!editable} onChange={(e) => setF({ ...f, salary_manual_reason: e.target.value })} /></Field>}
          <Field label="ภาษีป้อนเอง" hint="ว่าง = โปรแกรมคำนวณ · ผลต่างเฉลี่ยไปเดือนที่เหลือเอง"><MoneyInput value={f.tax_manual} disabled={!editable} onChange={(v) => setF({ ...f, tax_manual: v })} /></Field>
        </div>
        <table className="grid compact">
          <thead><tr><th>รายการ</th><th className="r" style={{ width: 140 }}>จำนวน / จำนวนเงิน</th><th>หมายเหตุ</th><th style={{ width: 30 }} /></tr></thead>
          <tbody>{f.lines.map((l, i) => { const it = kind(l.item_id); const isQty = !!it && it.calc !== 'AMOUNT'; return <tr key={i}>
            <td><select value={l.item_id} disabled={!editable} onChange={(e) => setLine(i, { item_id: e.target.value })} aria-label="รายการ"><option value="">— เลือก —</option>
              {usable.map((x) => <option key={x.id} value={x.id}>{x.code} {x.name_th}{x.calc !== 'AMOUNT' ? ` (${unit(x.calc)})` : ''}{x.kind === 'D' ? ' [หัก]' : ''}</option>)}</select></td>
            <td>{isQty ? <span className="pair"><MoneyInput value={l.qty} disabled={!editable} onChange={(v) => setLine(i, { qty: v })} aria-label="จำนวน" /> {unit(it?.calc)}</span>
              : <MoneyInput value={l.amount} disabled={!editable} onChange={(v) => setLine(i, { amount: v })} aria-label="จำนวนเงิน" />}</td>
            <td><input value={l.note} maxLength={200} disabled={!editable} onChange={(e) => setLine(i, { note: e.target.value })} aria-label="หมายเหตุ" /></td>
            <td>{editable && <button className="link" onClick={() => setF((x) => ({ ...x, lines: x.lines.filter((_, k) => k !== i) }))} title="ลบบรรทัด">✕</button>}</td></tr>; })}</tbody>
        </table>
        {editable && <button onClick={() => setF((x) => ({ ...x, lines: [...x.lines, { item_id: '', qty: '', amount: '', note: '' }] }))}>+ เพิ่มรายการ (OT ขาดงาน โบนัส หักอื่น)</button>}
        <p className="hint">รายการประจำ (จากทะเบียนพนักงาน) ใส่ให้เองทุกรอบปกติ · OT/ขาดงาน/มาสาย ป้อนเป็นชั่วโมง/วัน/นาที โปรแกรมคูณอัตราค่าจ้างให้</p>
      </div>}
      {tab === 'tax' && c && <div className="small">
        <p>ปีภาษี {c.tax_year + 543} · คิดตั้งแต่เดือน {c.start_month} ถึง {c.end_month} · เหลือ {c.remaining} ครั้ง (รวมเดือนนี้)</p>
        <table className="grid compact" style={{ maxWidth: 640 }}><tbody>
          <tr><td>เงินได้ประจำทั้งปี (ประมาณ: ที่จ่ายแล้ว + เดือนนี้ × {c.remaining})</td><td className="r"><Money v={c.annual_regular_income} /></td></tr>
          <tr><td>รวมเงินได้ไม่ประจำสะสม → เงินได้ทั้งปี</td><td className="r"><Money v={c.annual_income} /></td></tr>
          {c.allowances.map((a) => <tr key={a.code} className="muted"><td>หัก {a.name_th}</td><td className="r">(<Money v={a.amount} />)</td></tr>)}
          <tr><td>เงินได้สุทธิทั้งปี</td><td className="r"><Money v={c.annual_net_income} /></td></tr>
          <tr><td>ภาษีทั้งปีของเงินได้ประจำ</td><td className="r"><Money v={c.annual_regular_tax} /></td></tr>
          <tr><td>ภาษีเดือนนี้ส่วนเงินได้ประจำ = (ภาษีทั้งปี − ที่หักแล้ว) ÷ {c.remaining}</td><td className="r"><Money v={c.regular_tax} /></td></tr>
          <tr><td>ภาษีส่วนเงินได้ไม่ประจำ (ส่วนเพิ่มเต็มจำนวน)</td><td className="r"><Money v={c.special_tax} /></td></tr>
          {d(c.other_runs_tax).gt(0) && <tr><td>หักภาษีที่รอบอื่นในเดือนนี้หักแล้ว</td><td className="r">(<Money v={c.other_runs_tax} />)</td></tr>}
          <tr><td><b>ภาษีรอบนี้</b>{c.tax_manual ? ' (ป้อนเอง)' : ''}</td><td className="r"><b><Money v={emp.tax} /></b></td></tr>
          <tr className="muted"><td>ภาษีสะสมถึงเดือนนี้ / ประมาณภาษีทั้งปี</td><td className="r"><Money v={c.tax_ytd} /> / <Money v={c.annual_tax_estimate} /></td></tr>
        </tbody></table>
        {!!c.missing_months?.length && <p className="neg">ยังไม่มีเงินเดือนเดือนที่ {c.missing_months.join(', ')} — ภาษีจะต่ำไป ป้อนยอดยกมาต้นปีที่ทะเบียนพนักงาน</p>}
      </div>}
    </Modal>
  );
}
