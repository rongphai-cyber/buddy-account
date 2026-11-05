import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fmt, MONTH_TH, todayIso } from '@buddy/core';
import { api } from '../../api';
import { useCan, useSession } from '../../session';
import { AccountCell } from '../../components/AccountCell';
import { Confirm, cx, DateInput, DateText, ErrorBox, Field, Modal, Money, MoneyInput, navKey, Pill, toast, toastError } from '../../ui';
import { downloadFile, fileToBase64 } from './common';
import { ReasonInput } from '../../components/ReasonInput';

const be = (y: number | string) => Number(y) + 543;
type Issue = { row: number; message: string };

/**
 * นำเข้าจาก Excel/CSV: ดาวน์โหลดแบบฟอร์ม → เลือกแฟ้ม → ตรวจทั้งแฟ้ม (ยังไม่บันทึก) → บันทึกทั้งแฟ้มในครั้งเดียว
 * ผิดแม้แถวเดียว = ไม่บันทึกเลย แล้วบอกแถวที่ต้องแก้
 */
export function ImportModal<R extends { row: number; code: string }>({ title, intro, templateUrl, templateName, postUrl, cols, onClose, onDone }: {
  title: string; intro: string; templateUrl: string; templateName: string; postUrl: string;
  cols: Array<[string, (r: R) => string | number | null]>; onClose: () => void; onDone: () => void;
}) {
  const [file, setFile] = useState<{ name: string; data: string } | null>(null);
  const [res, setRes] = useState<{ ok: boolean; rows?: R[]; errors: Issue[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const run = async (commit: boolean) => {
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.post<{ ok: boolean; committed: boolean; rows?: R[]; errors: Issue[]; added?: number; edited?: number; employees?: number }>(postUrl, { file_name: file.name, data: file.data, commit });
      if (r.committed) { toast(r.employees !== undefined ? `นำเข้า ${r.employees} คนแล้ว — คำนวณใหม่เรียบร้อย` : `นำเข้าแล้ว: เพิ่มใหม่ ${r.added ?? 0} · แก้ไข ${r.edited ?? 0}`); onDone(); return; }
      setRes(r);
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const pick = async (f: File | undefined) => {
    setRes(null); setErr(null);
    if (!f) { setFile(null); return; }
    if (f.size > 10 * 1024 * 1024) { setErr(new Error('แฟ้มใหญ่เกิน 10 MB — แบ่งเป็นหลายแฟ้ม')); return; }
    setFile({ name: f.name, data: await fileToBase64(f) });
  };
  useEffect(() => { if (file) void run(false); }, [file]);   // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal size="wide" title={title} onClose={onClose} footer={<><button onClick={onClose}>ปิด <kbd>Esc</kbd></button>
      <button className="primary" disabled={!res?.ok || busy} onClick={() => run(true)}>บันทึกทั้งแฟ้ม{res?.rows ? ` (${res.rows.length} แถว)` : ''}</button></>}>
      <p className="small">{intro}</p>
      <div className="toolbar">
        <button onClick={() => downloadFile(templateUrl, templateName).catch(toastError)}>⬇ ดาวน์โหลดแบบฟอร์ม Excel</button>
        <label className="file-pick">เลือกแฟ้ม (.xlsx หรือ .csv) <input type="file" accept=".xlsx,.csv,.txt" onChange={(e) => void pick(e.target.files?.[0])} /></label>
        {file && <span className="muted small">{file.name}</span>}
      </div>
      <ErrorBox error={err} />
      {busy && <p className="muted">กำลังตรวจแฟ้ม…</p>}
      {res && !res.ok && <div className="note-box warn"><b>ต้องแก้ {res.errors.length} จุดก่อนนำเข้า (ยังไม่ได้บันทึก)</b>
        <ul className="small">{res.errors.slice(0, 50).map((e, i) => <li key={i}>แถวที่ {e.row}: {e.message}</li>)}{res.errors.length > 50 && <li>… อีก {res.errors.length - 50} จุด</li>}</ul></div>}
      {res?.ok && <div className="note-box">ตรวจแล้วไม่พบข้อผิดพลาด — กด "บันทึกทั้งแฟ้ม" เพื่อนำเข้า</div>}
      {!!res?.rows?.length && <div className="table-wrap"><table className="grid">
        <thead><tr><th style={{ width: 60 }}>แถว</th><th>รหัส</th>{cols.map(([h]) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{res.rows.map((r) => <tr key={r.row}><td>{r.row}</td><td className="mono">{r.code}</td>{cols.map(([h, f]) => <td key={h}>{f(r)}</td>)}</tr>)}</tbody>
      </table></div>}
    </Modal>
  );
}

// ---------------------------------------------------------------- การยื่นแบบ/นำส่ง
interface Filing { id: string; form: string; period: string; filing_no: number; headcount: number; base_amount: string; amount: string; surcharge: string; filed_date: string; receipt_no: string | null; status: string; note: string | null; cancel_reason: string | null; journal_id: string | null; voucher_no: string | null; branch_code: string | null }
export const FORM_TH: Record<string, string> = { PND1: 'ภ.ง.ด.1', PND1A: 'ภ.ง.ด.1ก', SSO: 'ประกันสังคม (สปส.1-10)', PVD: 'กองทุนสำรองเลี้ยงชีพ' };
const periodTh = (f: { form: string; period: string }) => (f.form === 'PND1A' ? `ปี ${be(f.period.slice(0, 4))}` : `${MONTH_TH[Number(f.period.slice(5, 7)) - 1]} ${be(f.period.slice(0, 4))}`);

/** รายการยื่นแบบ/นำส่งของปี + บันทึกใหม่ · ยกเลิก (ใบสำคัญนำส่งยกเลิกตาม · ปลดล็อกเดือน) */
export function FilingsTab({ year }: { year: number }) {
  const qc = useQueryClient();
  const can = useCan('PAY.TAX');
  const q = useQuery({ queryKey: ['pay-filings', year], queryFn: () => api.get<Filing[]>('/api/v1/pay/filings', { year }) });
  const [add, setAdd] = useState(false);
  const [cancel, setCancel] = useState<Filing | null>(null);
  const [reason, setReason] = useState('');
  const reload = () => qc.invalidateQueries({ queryKey: ['pay-filings'] });
  return (
    <div>
      <div className="toolbar"><button className="primary" disabled={!can('add')} onClick={() => setAdd(true)}>+ บันทึกการยื่น/นำส่ง</button>
        <span className="hint">นำส่งภาษี/เงินสมทบ = ใบสำคัญจ่าย Dr หนี้สินค้างจ่าย / Cr เงินสด-เงินฝาก · ยื่น ภ.ง.ด.1 หรือประกันสังคมแล้ว รอบเงินเดือนของเดือนนั้นแก้/ยกเลิกไม่ได้</span></div>
      <ErrorBox error={q.error} />
      <div className="table-wrap"><table className="grid">
        <thead><tr><th>แบบ</th><th>งวด</th><th>ยื่น</th><th>สาขา</th><th className="r">ราย</th><th className="r">เงินได้/ค่าจ้าง</th><th className="r">นำส่ง</th><th className="r">เงินเพิ่ม</th><th>วันที่ยื่น</th><th>เลขที่อ้างอิง</th><th>ใบสำคัญ</th><th /></tr></thead>
        <tbody>{q.data?.map((f) => <tr key={f.id} className={cx(f.status === 'C' && 'cancelled')}>
          <td>{FORM_TH[f.form]}</td><td>{periodTh(f)}</td><td>{f.filing_no ? `เพิ่มเติม ${f.filing_no}` : 'ปกติ'}</td><td className="mono">{f.branch_code ?? 'รวม'}</td><td className="r">{f.headcount}</td>
          <td className="r"><Money v={f.base_amount} blankZero /></td><td className="r"><Money v={f.amount} /></td><td className="r"><Money v={f.surcharge} blankZero /></td><td><DateText v={f.filed_date} /></td><td>{f.receipt_no}</td><td className="mono">{f.voucher_no}</td>
          <td>{f.status === 'C' ? <Pill tone="x">ยกเลิก</Pill> : can('cancel') && <button className="link" onClick={() => setCancel(f)}>ยกเลิก</button>}</td></tr>)}
          {q.data && !q.data.length && <tr><td colSpan={12} className="empty">ยังไม่มีการยื่นแบบในปีนี้</td></tr>}</tbody>
      </table></div>
      {add && <FilingForm year={year} onClose={() => setAdd(false)} onDone={() => { setAdd(false); reload(); }} />}
      {cancel && <Confirm danger title="ยกเลิกการยื่น/นำส่ง" text={<>ยกเลิก {FORM_TH[cancel.form]} {periodTh(cancel)}? ใบสำคัญนำส่งจะเป็นสถานะยกเลิก และแก้รอบเงินเดือนของเดือนนั้นได้อีก
        <Field label="เหตุผล" req><ReasonInput value={reason} onChange={setReason} /></Field></>}
        onClose={() => { setCancel(null); setReason(''); }} onOk={() => api.post(`/api/v1/pay/filings/${cancel.id}/cancel`, { reason }).then(() => { toast('ยกเลิกการยื่นแล้ว'); setCancel(null); setReason(''); reload(); }).catch(toastError)} />}
    </div>
  );
}

function FilingForm({ year, onClose, onDone }: { year: number; onClose: () => void; onDone: () => void }) {
  const { me } = useSession();
  const [f, setF] = useState({ form: 'PND1', period: `${year}-${todayIso().slice(5, 7)}`, branch_id: '', filing_no: '0', filed_date: todayIso(), receipt_no: '', amount: '', surcharge: '', note: '' });
  const [pay, setPay] = useState<string | null>(null);
  const [sur, setSur] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const due = useQuery({ queryKey: ['pay-due', f.form, f.period, f.branch_id], queryFn: () => api.get<{ headcount: number; base: string; amount: string; drafts: number }>('/api/v1/pay/filings/due', { form: f.form, period: f.form === 'PND1A' ? f.period.slice(0, 4) : f.period, branch_id: f.branch_id }) });
  useEffect(() => { if (due.data) setF((x) => ({ ...x, amount: due.data!.amount })); }, [due.data]);
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await api.post('/api/v1/pay/filings', { form: f.form, period: f.form === 'PND1A' ? f.period.slice(0, 4) : f.period, branch_id: f.branch_id || null, filing_no: Number(f.filing_no), filed_date: f.filed_date, receipt_no: f.receipt_no || null,
        amount: f.amount || null, surcharge: f.surcharge || '0', pay_account_id: pay, surcharge_account_id: sur, note: f.note || null });
      toast('บันทึกการยื่น/นำส่งแล้ว'); onDone();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const paid = f.form !== 'PND1A';
  return (
    <Modal title="บันทึกการยื่นแบบ/นำส่ง" onClose={onClose} footer={<><button onClick={onClose}>ยกเลิก</button><button className="primary" disabled={busy} onClick={save}>บันทึก</button></>}>
      <ErrorBox error={err} />
      {!!due.data?.drafts && <div className="note-box warn">มีรอบเงินเดือนร่าง {due.data.drafts} รอบในงวดนี้ — ยอดที่ต้องนำส่งยังไม่รวมรอบร่าง</div>}
      <div className="form-grid" onKeyDown={(e) => navKey(e)}>
        <Field label="แบบ" req><select autoFocus value={f.form} onChange={(e) => setF({ ...f, form: e.target.value })}>{Object.entries(FORM_TH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        {f.form === 'PND1A' ? <Field label="ปีภาษี"><input readOnly value={be(year)} /></Field>
          : <Field label="เดือนภาษี" req><input type="month" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })} /></Field>}
        {(me?.branches.length ?? 0) > 1 && <Field label="สาขาที่ยื่น"><select value={f.branch_id} onChange={(e) => setF({ ...f, branch_id: e.target.value })}><option value="">ทุกสาขารวมกัน</option>{me!.branches.map((b) => <option key={b.id} value={b.id}>{b.code} {b.name}</option>)}</select></Field>}
        <Field label="การยื่น"><select value={f.filing_no} onChange={(e) => setF({ ...f, filing_no: e.target.value })}><option value="0">ยื่นปกติ</option>{Array.from({ length: 9 }, (_, i) => <option key={i} value={i + 1}>ยื่นเพิ่มเติมครั้งที่ {i + 1}</option>)}</select></Field>
        <Field label="วันที่ยื่น/นำส่ง" req><DateInput value={f.filed_date} onChange={(v) => setF({ ...f, filed_date: v })} /></Field>
        <Field label="เลขที่ใบเสร็จ/อ้างอิง"><input value={f.receipt_no} maxLength={60} onChange={(e) => setF({ ...f, receipt_no: e.target.value })} /></Field>
        <Field label={paid ? 'จำนวนเงินที่นำส่ง' : 'ภาษีทั้งปี (ข้อมูล)'} hint={due.data ? `ตามรอบเงินเดือนที่บันทึกแล้ว: ${due.data.headcount} ราย นำส่ง ${fmt(due.data.amount)}` : undefined}><MoneyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
        {paid && <>
          <Field label="จ่ายจากบัญชี" req hint="เงินสด/เงินฝากที่จ่ายจริง"><AccountCell value={pay} required onChange={(a) => setPay(a?.id ?? null)} /></Field>
          <Field label="เงินเพิ่ม/ค่าปรับ" hint="ถ้ายื่นช้า"><MoneyInput value={f.surcharge} onChange={(v) => setF({ ...f, surcharge: v })} /></Field>
          {!!Number(f.surcharge || 0) && <Field label="บัญชีค่าใช้จ่ายเงินเพิ่ม" req><AccountCell value={sur} onChange={(a) => setSur(a?.id ?? null)} /></Field>}
        </>}
        <Field label="หมายเหตุ" wide><input value={f.note} maxLength={200} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
