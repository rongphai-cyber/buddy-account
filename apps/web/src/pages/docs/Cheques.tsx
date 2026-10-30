import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { d, docPath, fmt, formatDate, todayIso, type YearSystem } from '@buddy/core';
import { api } from '../../api';
import { CancelStamp, CloseScreen, DocDelete } from '../../components/DocDelete';
import { useCan, useSession } from '../../session';
import { LkSelect, SearchPick, useLookups } from '../../components/LkSelect';
import { Confirm, cx, DateInput, DateText, ErrorBox, Field, KeyHints, Modal, Money, MoneyInput, navKey, PageHead, Pill, Tabs, toast, useHotkeys } from '../../ui';
import { useDocNo } from '../../components/DocNo';
import { DocLink } from '../../components/DocLink';

/** เช็ครับ/เช็คจ่าย (คู่มือบทที่ 13 S-BK-04..13) — ยอดเงินฝากเพิ่มเมื่อผ่านเช็คเท่านั้น */
type Dir = 'R' | 'P';
const ST: Record<string, [string, 'n' | 'c' | 'm' | 'd' | 'x']> = { '00': ['เช็คในมือ', 'm'], '01': ['รอเรียกเก็บ', 'c'], '02': ['เช็คคืนยื่นใหม่', 'd'], '05': ['เช็คจ่าย', 'm'], '10': ['เช็คผ่าน', 'n'], '19': ['ผ่าน (โอน)', 'n'], '20': ['เช็คคืน', 'x'], '21': ['ตัดหนี้สูญ', 'x'] };
const StatusPill = ({ s }: { s: string }) => <Pill tone={ST[s]?.[1] ?? 'm'}>{s} {ST[s]?.[0] ?? ''}</Pill>;
interface Row { id: string; direction: Dir; cheque_no: string; cheque_date: string; received_date: string | null; deposit_date: string | null; pass_date: string | null; amount: string; charge: string; remaining_amount: string; written_off_amount: string; status: string;
  bank_branch: string | null; bank_code: string | null; bank_name: string | null; account_code: string | null; account_short: string | null; party_name: string | null; party_code: string | null; source_doc_no: string | null; source_doc_class: string | null; source_header_id: string | null;
  deposit_doc_no: string | null; deposit_header_id: string | null; pass_voucher_no: string | null; remark: string | null }
interface BankAcc { id: string; code: string; name: string; status: string; account_number: string | null }
const useBanks = () => useQuery({ queryKey: ['bank-accounts'], queryFn: () => api.get<BankAcc[]>('/api/v1/bank-accounts') });
function BankSelect({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const banks = useBanks();
  return <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}><option value="">—</option>{banks.data?.filter((b) => b.status === 'A' || b.id === value).map((b) => <option key={b.id} value={b.id}>{b.code} {b.name}{b.account_number ? ` (${b.account_number})` : ''}</option>)}</select>;
}
const useCheques = (p: Record<string, string>) => useQuery({ queryKey: ['cheques', p], placeholderData: (x) => x, queryFn: () => api.get<{ rows: Row[]; by_status: Array<{ status: string; n: number; amount: string; label: string }> }>('/api/v1/cheques', p) });
const refresh = (qc: ReturnType<typeof useQueryClient>) => { qc.invalidateQueries({ queryKey: ['cheques'] }); qc.invalidateQueries({ queryKey: ['cheque'] }); qc.invalidateQueries({ queryKey: ['cheque-deposits'] }); qc.invalidateQueries({ queryKey: ['bank-book'] }); };

/** ตารางเช็คที่เลือกได้หลายใบ (ดับเบิลคลิก/Space เลือก — S-BK-06/07/08/09) */
function PickTable({ rows, sel, setSel, cols }: { rows: Row[]; sel: Set<string>; setSel: (s: Set<string>) => void; cols: 'deposit' | 'pass' | 'paid' }) {
  const toggle = (id: string) => { const n = new Set(sel); if (n.has(id)) n.delete(id); else n.add(id); setSel(n); };
  return (
    <div className="table-wrap tall">
      <table className="grid">
        <thead><tr><th style={{ width: 36 }}><input type="checkbox" aria-label="เลือกทั้งหมด" checked={!!rows.length && rows.every((r) => sel.has(r.id))} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /></th>
          <th style={{ width: 100 }}>ลงวันที่</th>{cols !== 'paid' && <th style={{ width: 160 }}>ธนาคาร</th>}<th style={{ width: 130 }}>เลขที่เช็ค</th><th>{cols === 'paid' ? 'จ่ายให้' : 'ผู้สั่งจ่าย'}</th><th className="r" style={{ width: 130 }}>จำนวนเงิน</th>
          <th style={{ width: 120 }}>{cols === 'paid' ? 'ตัดจากบัญชี' : 'นำฝากบัญชี'}</th>{cols !== 'paid' && <th style={{ width: 100 }}>วันที่นำฝาก</th>}{cols !== 'paid' && <th style={{ width: 110 }}>เช็คสาขา</th>}<th style={{ width: 130 }}>สถานะ</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={cx('row-open', sel.has(r.id) && 'selected')} tabIndex={0} onClick={() => toggle(r.id)} onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && (e.preventDefault(), toggle(r.id))}>
              <td><input type="checkbox" checked={sel.has(r.id)} readOnly aria-label={`เลือก ${r.cheque_no}`} /></td><td><DateText v={r.cheque_date} /></td>{cols !== 'paid' && <td>{r.bank_code} {r.bank_name}</td>}<td className="mono">{r.cheque_no}</td>
              <td>{r.party_name}</td><td className="r"><Money v={r.amount} /></td><td>{r.account_code} {r.account_short}</td>{cols !== 'paid' && <td><DateText v={r.deposit_date} /></td>}{cols !== 'paid' && <td>{r.bank_branch}</td>}<td><StatusPill s={r.status} /></td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={10} className="empty">ไม่มีเช็คที่รอทำรายการ</td></tr>}
        </tbody>
        {!!sel.size && <tfoot><tr><td colSpan={cols === 'paid' ? 4 : 5} className="r">ถูกเลือก {sel.size} รายการ</td><td className="r"><b><Money v={rows.filter((r) => sel.has(r.id)).reduce((s, r) => s.plus(d(r.amount)), d(0)).toFixed(2)} /></b></td><td colSpan={4} /></tr></tfoot>}
      </table>
    </div>
  );
}

/** S-BK-04 ทะเบียนเช็ครับ / S-BK-13 ทะเบียนเช็คจ่าย */
export function ChequeRegisterPage({ direction }: { direction: Dir }) {
  const can = useCan(direction === 'R' ? 'FI.BK.CR' : 'FI.BK.CP');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [inst, setInst] = useState<'CHEQUE' | 'TRANSFER'>('CHEQUE');
  const [open, setOpen] = useState<string | null>(null);
  const [add, setAdd] = useState(false);
  const list = useCheques({ direction, q, instrument: inst, ...(status ? { status } : {}) });
  useHotkeys({ Insert: can('add') && !open ? () => setAdd(true) : undefined }, []);
  const title = direction === 'R' ? 'ทะเบียนเช็ครับ' : 'ทะเบียนเช็คจ่าย';
  return (
    <div className="page" data-tone="finance">
      <PageHead eyebrow="ธนาคาร" title={title} lead={direction === 'R' ? 'เช็คที่รับชำระ: ในมือ → นำฝาก (รอเรียกเก็บ) → ผ่าน (เงินฝากเพิ่ม) · คลิกเพื่อดูรายละเอียด บันทึกเช็คคืน ตัดยอดคงเหลือเป็นรายได้' : 'เช็คที่สั่งจ่าย: เช็คจ่าย → ผ่าน (เงินฝากลด) · คลิกเพื่อดูรายละเอียดและพิมพ์เช็ค'}
        actions={can('add') && <button onClick={() => setAdd(true)}>+ เพิ่มเช็ค (ยกมา) <kbd>Ins</kbd></button>} />
      <Tabs active={inst} onChange={(k) => setInst(k as 'CHEQUE' | 'TRANSFER')} tabs={[{ key: 'CHEQUE', label: 'เช็ค' }, { key: 'TRANSFER', label: 'เงินโอน/บัตร' }]} />
      <div className="toolbar">
        <input type="search" autoFocus placeholder="ค้นหาเลขที่เช็ค ชื่อ/รหัสลูกค้าหรือผู้จำหน่าย เลขที่เอกสาร" value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหา" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="สถานะ"><option value="">ทุกสถานะ</option>{list.data?.by_status.map((s) => <option key={s.status} value={s.status}>{s.status} {s.label} ({s.n.toLocaleString()} ใบ · {fmt(s.amount)})</option>)}</select>
      </div>
      <ErrorBox error={list.error} />
      <div className="table-wrap tall">
        <table className="grid">
          <thead><tr><th style={{ width: 100 }}>วันที่เช็ค</th><th style={{ width: 140 }}>เลขที่เช็ค</th>{direction === 'R' && <th style={{ width: 150 }}>ธนาคาร</th>}<th>{direction === 'R' ? 'ลูกค้า/ผู้สั่งจ่าย' : 'จ่ายให้'}</th><th className="r" style={{ width: 130 }}>จำนวนเงิน</th>
            <th style={{ width: 110 }}>บัญชีเงินฝาก</th><th style={{ width: 130 }}>เอกสาร</th><th style={{ width: 100 }}>วันที่ผ่าน</th><th style={{ width: 140 }}>สถานะ</th></tr></thead>
          <tbody>
            {list.data?.rows.map((r) => (
              <tr key={r.id} className="row-open" tabIndex={0} onClick={() => setOpen(r.id)} onKeyDown={(e) => e.key === 'Enter' && setOpen(r.id)}>
                <td><DateText v={r.cheque_date} /></td><td className="mono">{r.cheque_no}</td>{direction === 'R' && <td>{r.bank_code} {r.bank_name}</td>}<td>{r.party_code ? `${r.party_code} ` : ''}{r.party_name}</td>
                <td className="r"><Money v={r.amount} /></td><td>{r.account_code}</td><td>{r.source_doc_no ? <DocLink id={r.source_header_id} no={r.source_doc_no} cls={r.source_doc_class} /> : <DocLink id={r.deposit_header_id} no={r.deposit_doc_no} cls="BQ" />}</td><td><DateText v={r.pass_date} /></td><td><StatusPill s={r.status} /></td>
              </tr>
            ))}
            {list.data && !list.data.rows.length && <tr><td colSpan={9} className="empty">ไม่มีเช็คตามเงื่อนไขนี้</td></tr>}
          </tbody>
        </table>
      </div>
      <KeyHints keys={[['Ins', 'เพิ่มเช็คยกมา'], ['คลิก/Enter', 'รายละเอียด']]} />
      {open && <ChequeDetail id={open} onClose={() => setOpen(null)} />}
      {add && <AddCheque direction={direction} onClose={() => setAdd(false)} />}
    </div>
  );
}

/** เพิ่มเช็คในทะเบียน: เช็คยกมา (S-OB-05) หรือป้อนจากสมุดรายวัน (S-GL-04 — journal = ใบสำคัญที่มีบรรทัดเช็คจ่าย/เช็ครับล่วงหน้า) */
export function AddCheque({ direction, onClose, journal }: { direction: Dir; onClose: () => void; journal?: { id: string; voucher_no: string; date: string; amount: string } }) {
  const qc = useQueryClient();
  const lk = useLookups('BANK');
  const { me } = useSession();
  const [f, setF] = useState({ cheque_no: '', cheque_date: journal?.date ?? me?.work_date ?? todayIso(), bank_id: '', bank_branch: '', party: null as { id: string; code: string; name?: string | null } | null, payee_name: '', amount: journal?.amount ?? '', received_date: '', bank_account_id: '', remark: journal ? `ใบสำคัญ ${journal.voucher_no}` : '' });
  const [err, setErr] = useState<unknown>(null);
  const ok = async () => {
    setErr(null);
    try {
      await api.post('/api/v1/cheques', { direction, cheque_no: f.cheque_no, cheque_date: f.cheque_date, bank_id: f.bank_id || null, bank_branch: f.bank_branch || null, customer_id: direction === 'R' ? f.party?.id ?? null : null, supplier_id: direction === 'P' ? f.party?.id ?? null : null,
        payee_name: f.payee_name || null, amount: f.amount || '0', received_date: f.received_date || null, bank_account_id: f.bank_account_id || null, remark: f.remark || null, source_journal_id: journal?.id ?? null });
      toast(`เพิ่มเช็ค ${f.cheque_no} แล้ว`); refresh(qc); qc.invalidateQueries({ queryKey: ['jv-cheques'] }); onClose();
    } catch (e) { setErr(e); }
  };
  return (
    <Modal title={journal ? `รายละเอียด${direction === 'R' ? 'เช็ครับ' : 'เช็คจ่าย'} — ใบสำคัญ ${journal.voucher_no}` : `เพิ่ม${direction === 'R' ? 'เช็ครับ' : 'เช็คจ่าย'}ในทะเบียน (เช็คยกมา)`} onClose={onClose} footer={<><button className="primary" onClick={ok}>บันทึก</button><button onClick={onClose}>ยกเลิก <kbd>Esc</kbd></button></>}>
      <ErrorBox error={err} />
      {journal ? <p className="hint">บันทึกเช็คเข้าทะเบียนเช็ค (ใบสำคัญลงบัญชีแล้ว) — นำฝาก/ผ่านเช็คต่อที่ทะเบียนเช็ค · ยกเลิกใบสำคัญแล้วเช็คที่ยังไม่นำฝากถูกยกเลิกตาม</p> : <p className="hint">สำหรับเช็คที่ค้าง ณ วันเริ่มใช้โปรแกรม — ไม่ลงบัญชี (ยอดบัญชีเช็ครับ/จ่ายล่วงหน้าป้อนที่ บันทึกยอดยกมา) · เช็คที่รับ/จ่ายตามปกติให้บันทึกในใบเสร็จ/ใบจ่าย</p>}
      <div className="form-grid" onKeyDown={navKey}>
        <Field label="เลขที่เช็ค" req><input className="mono" value={f.cheque_no} maxLength={30} autoFocus onChange={(e) => setF({ ...f, cheque_no: e.target.value })} /></Field>
        <Field label="วันที่เช็ค" req><DateInput value={f.cheque_date} onChange={(v) => setF({ ...f, cheque_date: v })} /></Field>
        {direction === 'R' ? <>
          <Field label="เช็คธนาคาร"><LkSelect byId rows={lk.data?.BANK} value={f.bank_id} onChange={(v) => setF({ ...f, bank_id: v })} aria-label="เช็คธนาคาร" /></Field>
          <Field label="เช็คสาขา"><input value={f.bank_branch} maxLength={60} onChange={(e) => setF({ ...f, bank_branch: e.target.value })} /></Field>
          <Field label="รหัสลูกค้า"><SearchPick<{ id: string; code: string; name: string }> endpoint="/api/v1/customers" value={f.party} label={(r: { name: string }) => r.name} onPick={(r: { id: string; code: string; name: string } | null) => setF({ ...f, party: r ? { id: r.id, code: r.code, name: r.name } : null })} /></Field>
          <Field label="วันที่รับเช็ค"><DateInput value={f.received_date} onChange={(v) => setF({ ...f, received_date: v })} /></Field>
        </> : <>
          <Field label="สั่งจ่ายจากบัญชี" req><BankSelect value={f.bank_account_id} onChange={(v) => setF({ ...f, bank_account_id: v })} label="สั่งจ่ายจากบัญชี" /></Field>
          <Field label="รหัสผู้จำหน่าย"><SearchPick<{ id: string; code: string; name: string }> endpoint="/api/v1/suppliers" value={f.party} label={(r: { name: string }) => r.name} onPick={(r: { id: string; code: string; name: string } | null) => setF({ ...f, party: r ? { id: r.id, code: r.code, name: r.name } : null })} /></Field>
        </>}
        <Field label={direction === 'R' ? 'ผู้สั่งจ่าย' : 'จ่ายให้ (ชื่อบนเช็ค)'}><input value={f.payee_name} maxLength={120} onChange={(e) => setF({ ...f, payee_name: e.target.value })} /></Field>
        <Field label="จำนวนเงิน" req><MoneyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} aria-label="จำนวนเงิน" /></Field>
        <Field label="หมายเหตุ"><input value={f.remark} maxLength={200} onChange={(e) => setF({ ...f, remark: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function ChequeDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { me } = useSession();
  const c = useQuery({ queryKey: ['cheque', id], staleTime: 0, queryFn: () => api.get<Record<string, string | null> & { amount: string; status: string; direction: Dir; editable: boolean; status_label: string;
    docs: Array<{ id: string; doc_no: string; doc_date: string; doc_class: string; net_amount: string; amount: string; doc_status: string }>; events: Array<{ event_date: string; from_status: string | null; to_status: string; reason: string | null }> }>(`/api/v1/cheques/${id}`) });
  const can = useCan(c.data?.direction === 'P' ? 'FI.BK.CP' : 'FI.BK.CR');
  const canPass = useCan(c.data?.direction === 'P' ? 'FI.BK.PC' : 'FI.BK.CL');
  const [err, setErr] = useState<unknown>(null);
  const [act, setAct] = useState<null | 'return' | 'writeoff' | 'unpass' | 'edit' | 'delete'>(null);
  const [f, setF] = useState({ date: me?.work_date ?? todayIso(), reason: '', cheque_no: '' });
  const [print, setPrint] = useState(false);
  const x = c.data;
  const run = async (fn: () => Promise<unknown>, msg: string) => { setErr(null); try { const r = await fn() as { message?: string }; toast(r?.message ?? msg); setAct(null); refresh(qc); } catch (e) { setErr(e); setAct(null); } };
  const left = x ? d(x.remaining_amount ?? 0).minus(d(x.written_off_amount ?? 0)) : d(0);
  useHotkeys({ 'Alt+E': x?.editable && can('edit') ? () => { setF({ ...f, cheque_no: x.cheque_no ?? '' }); setAct('edit'); } : undefined }, [x?.editable]);
  const ys: YearSystem = me?.company?.year_system ?? 'B';
  const doPrint = () => { setPrint(true); setTimeout(() => { window.print(); setPrint(false); }, 100); };
  return (
    <Modal title={x ? `${x.direction === 'R' ? 'เช็ครับ' : 'เช็คจ่าย'} ${x.cheque_no}` : 'เช็ค'} size="wide" onClose={onClose} footer={<>
      {x?.editable && can('edit') && <button onClick={() => { setF({ ...f, cheque_no: x.cheque_no ?? '' }); setAct('edit'); }}>แก้เลขที่เช็ค <kbd>Alt+E</kbd></button>}
      {x?.direction === 'R' && ['01', '10'].includes(x.status) && !x.deposit_header_id && can('edit') && <button onClick={() => setAct('return')}>บันทึกประวัติเป็นเช็คคืน</button>}
      {x?.direction === 'R' && left.gt(0) && !x.writeoff_journal_id && can('approve') && <button onClick={() => setAct('writeoff')}>ตัดยอดคงเหลือเป็นรายได้</button>}
      {x?.status === '10' && x.pass_journal_id && !x.deposit_header_id && canPass('cancel') && <button onClick={() => setAct('unpass')}>ยกเลิกการผ่าน</button>}
      {x && !x.source_header_id && ['00', '05'].includes(x.status) && can('delete') && <button onClick={() => setAct('delete')}>ลบ</button>}
      {x?.direction === 'P' && <button onClick={doPrint}>🖨 พิมพ์เช็ค <kbd>Alt+P</kbd></button>}
      <button onClick={onClose}>ปิด <kbd>Esc</kbd></button></>}>
      <ErrorBox error={err ?? c.error} />
      {x && <>
        <div className="form-grid">
          <Field label="วันที่เช็ค"><DateText v={x.cheque_date} /></Field><Field label="เลขที่เช็ค"><b className="mono">{x.cheque_no}</b></Field>
          {x.direction === 'R' && <><Field label="เช็คธนาคาร">{x.bank_code ? `${x.bank_code} ${x.bank_name ?? ''}` : '—'}{x.bank_branch ? ` สาขา ${x.bank_branch}` : ''}</Field><Field label="วันที่รับเช็ค"><DateText v={x.received_date} /></Field></>}
          <Field label={x.direction === 'R' ? 'ลูกค้า' : 'ผู้จำหน่าย'}>{x.customer_code ?? x.supplier_code} {x.customer_name ?? x.supplier_name}</Field><Field label={x.direction === 'R' ? 'ผู้สั่งจ่าย' : 'จ่ายให้'}>{x.payee_name}</Field>
          <Field label="จำนวนเงิน"><b><Money v={x.amount} /></b></Field><Field label="หมายเหตุ">{x.remark}</Field>
        </div>
        <div className="box" style={{ marginTop: 10 }}>
          <div className="form-grid">
            <Field label="สถานะเช็ค"><StatusPill s={x.status} /></Field><Field label="วันที่นำฝาก"><DateText v={x.deposit_date} /></Field><Field label="เข้าบัญชี / ตัดจากบัญชี">{x.account_code} {x.account_name}</Field>
            <Field label="วันที่ผ่านเช็ค"><DateText v={x.pass_date} /></Field><Field label="เลขที่ใบนำฝาก"><DocLink id={x.deposit_header_id} no={x.deposit_doc_no} cls="BQ" /></Field>
            <Field label="ค่าธรรมเนียม"><Money v={x.charge ?? '0'} /></Field><Field label="เลขที่ใบสำคัญ (ผ่าน)"><DocLink id={x.pass_journal_id} no={x.pass_voucher_no} cls="GL" /></Field>
            {x.direction === 'R' && <><Field label="ยอดคงเหลือจากชำระใบเสร็จ"><Money v={x.remaining_amount ?? '0'} /></Field><Field label="ยอดที่ตัดเป็นรายได้"><Money v={x.written_off_amount ?? '0'} />{x.writeoff_voucher_no ? <> (<DocLink id={x.writeoff_journal_id} no={x.writeoff_voucher_no} cls="GL" />)</> : ''}</Field></>}
          </div>
        </div>
        <Tabs active="docs" onChange={() => undefined} tabs={[{ key: 'docs', label: 'รายการเอกสารที่เกี่ยวข้อง', badge: x.docs.length || undefined }]} />
        <table className="grid"><thead><tr><th>เอกสาร</th><th>วันที่</th><th className="r">ยอดเอกสาร</th><th className="r">ชำระด้วยเช็คนี้</th></tr></thead>
          <tbody>{x.docs.map((r) => <tr key={r.id} className={cx('row-open', r.doc_status === 'C' && 'cancelled')} onClick={() => { const to = docPath(r.doc_class, r.id); if (to) nav(to); }}><td><DocLink id={r.id} no={r.doc_no} cls={r.doc_class} /></td><td><DateText v={r.doc_date} /></td><td className="r"><Money v={r.net_amount} /></td><td className="r"><Money v={r.amount} /></td></tr>)}
            {!x.docs.length && <tr><td colSpan={4} className="empty">ไม่มีเอกสารที่อ้างถึง (เช็คยกมา/ย้ายข้อมูล)</td></tr>}</tbody></table>
        <p className="hint" style={{ marginTop: 10 }}>ประวัติสถานะ</p>
        <table className="grid"><tbody>{x.events.map((e, i) => <tr key={i}><td style={{ width: 110 }}><DateText v={e.event_date} /></td><td style={{ width: 260 }}>{e.from_status ? `${e.from_status} → ` : ''}<StatusPill s={e.to_status} /></td><td>{e.reason}</td></tr>)}
          {!x.events.length && <tr><td className="empty">ไม่มีประวัติ (ข้อมูลที่ย้ายจาก Express เก็บเฉพาะสถานะล่าสุด)</td></tr>}</tbody></table>
      </>}
      {act === 'return' && <Confirm danger title="บันทึกประวัติเช็คใบนี้เป็นเช็คคืน" text="กรุณาเลือกตกลง เพื่อยืนยันให้บันทึกประวัติเป็นเช็คคืนไว้ (ถ้าผ่านแล้ว ใบสำคัญผ่านเช็คจะถูกยกเลิก)" okText="ตกลง" onClose={() => setAct(null)}
        onOk={() => run(() => api.post(`/api/v1/cheques/${id}/return`, { return_date: f.date, reason: f.reason }), 'บันทึกเช็คคืนแล้ว')}>
        <Field label="วันที่คืน" req><DateInput value={f.date} onChange={(v) => setF({ ...f, date: v })} /></Field>
        <Field label="เหตุผล" req><input autoFocus value={f.reason} maxLength={200} placeholder="เช่น โปรดติดต่อผู้สั่งจ่าย" onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      </Confirm>}
      {act === 'writeoff' && <Confirm title="ตัดยอดคงเหลือเป็นรายได้" text={<>กรุณาเลือกตกลง เพื่อยืนยันให้ตัดยอดคงเหลือ <b><Money v={left.toFixed(2)} /></b> เป็นรายได้อื่น (Dr บัญชีเช็ครับ / Cr รายได้อื่น)</>} okText="ตกลง" onClose={() => setAct(null)}
        onOk={() => run(() => api.post(`/api/v1/cheques/${id}/write-off`, { date: f.date }), 'ตัดยอดคงเหลือเป็นรายได้แล้ว')}>
        <Field label="วันที่" req><DateInput value={f.date} onChange={(v) => setF({ ...f, date: v })} /></Field>
      </Confirm>}
      {act === 'unpass' && <Confirm danger title="ยกเลิกการผ่านเช็ค" text="ใบสำคัญผ่านเช็คจะถูกยกเลิก และเช็คกลับเป็นสถานะก่อนผ่าน" okText="ยกเลิกการผ่าน" onClose={() => setAct(null)} onOk={() => run(() => api.post(`/api/v1/cheques/${id}/unpass`, { reason: f.reason }), 'ยกเลิกการผ่านแล้ว')}>
        <Field label="เหตุผล" req><input autoFocus value={f.reason} maxLength={200} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      </Confirm>}
      {act === 'edit' && <Confirm title="แก้เลขที่เช็ค" text="เช่น ลูกค้าเปลี่ยนเป็นเช็คใบใหม่หลังเช็คคืน" okText="บันทึก" onClose={() => setAct(null)} onOk={() => run(() => api.put(`/api/v1/cheques/${id}`, { cheque_no: f.cheque_no }), 'แก้เลขที่เช็คแล้ว')}>
        <Field label="เลขที่เช็ค" req><input className="mono" autoFocus value={f.cheque_no} maxLength={30} onChange={(e) => setF({ ...f, cheque_no: e.target.value })} /></Field>
      </Confirm>}
      {act === 'delete' && <Confirm danger title="ลบเช็ค" text={`ลบเช็ค ${x?.cheque_no} ออกจากทะเบียน?`} okText="ลบ" onClose={() => setAct(null)} onOk={() => run(async () => { await api.del(`/api/v1/cheques/${id}`); onClose(); }, 'ลบเช็คแล้ว')} />}
      {print && x && createPortal(<div className="vat-print"><h2>เช็ค</h2><table><tbody>
        <tr><th>วันที่</th><td>{formatDate(x.cheque_date, ys)}</td></tr><tr><th>จ่าย</th><td>{x.payee_name ?? x.supplier_name}</td></tr><tr><th>จำนวนเงิน</th><td>{fmt(x.amount)}</td></tr><tr><th>เลขที่เช็ค</th><td>{x.cheque_no}</td></tr>
      </tbody></table></div>, document.body)}
    </Modal>
  );
}

/** S-BK-07 นำฝากเช็คเป็นใบๆ · S-BK-08 บันทึกเช็คผ่าน · S-BK-09 ผ่านเช็คจ่าย */
export function ChequeActionPage({ mode }: { mode: 'deposit' | 'pass' | 'pass-paid' }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { me } = useSession();
  const can = useCan(mode === 'deposit' ? 'FI.BK.DQ' : mode === 'pass' ? 'FI.BK.CL' : 'FI.BK.PC');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [dlg, setDlg] = useState(false);
  const [f, setF] = useState({ bank: '', date: me?.work_date ?? todayIso(), charge: '' });
  const [err, setErr] = useState<unknown>(null);
  const list = useCheques({ direction: mode === 'pass-paid' ? 'P' : 'R', status: mode === 'deposit' ? '00,02' : mode === 'pass' ? '00,01,02' : '00,02,05', loose: 'Y', q });
  const rows = list.data?.rows ?? [];
  const chosen = rows.filter((r) => sel.has(r.id));
  const needBank = mode === 'deposit' || (mode === 'pass' && chosen.some((r) => r.status !== '01'));
  const go = async () => {
    setErr(null);
    try {
      if (mode === 'deposit') await api.post('/api/v1/cheques/deposit', { cheque_ids: [...sel], bank_account_id: f.bank, deposit_date: f.date, charge: f.charge || '0' });
      else await api.post('/api/v1/cheques/pass', { cheque_ids: [...sel], pass_date: f.date, bank_account_id: f.bank || null, charge: f.charge || '0' });
      toast(`${mode === 'deposit' ? 'นำฝาก' : 'ผ่าน'}เช็ค ${sel.size} ใบแล้ว`); setSel(new Set()); setDlg(false); refresh(qc);
    } catch (e) { setErr(e); }
  };
  useHotkeys({ F5: sel.size && can('add') ? () => setDlg(true) : undefined }, [sel.size]);
  const title = mode === 'deposit' ? 'บันทึกเช็คนำฝาก' : mode === 'pass' ? 'บันทึกเช็คผ่าน' : 'ผ่านเช็คจ่าย';
  return (
    <div className="page" data-tone="finance">
      <PageHead eyebrow="ธนาคาร" title={title} lead={mode === 'deposit' ? 'นำฝากเช็คเป็นใบๆ (ไม่ใช้ใบนำฝาก): เลือกเช็คแล้วกด ทำงาน F5 ป้อนธนาคาร วันที่นำฝาก ค่าธรรมเนียม · ยังไม่เพิ่มยอดเงินฝากจนกว่าจะผ่านเช็ค'
        : mode === 'pass' ? 'เช็ครับที่นำฝากเป็นใบๆ: ป้อนวันที่ผ่านตามใบแจ้งยอดธนาคาร (ยังไม่นำฝาก = ป้อนธนาคารที่นำฝากด้วย · ลูกค้าจ่ายเงินสดแทนเช็คคืน = เลือกบัญชีเงินฝากที่ผูกบัญชีเงินสด) · ลงบัญชี Dr เงินฝาก / Cr เช็ครับ'
          : 'เช็คจ่ายที่ธนาคารตัดบัญชีแล้ว: ป้อนวันที่ผ่านตามใบแจ้งยอด · ลงบัญชี Dr เช็คจ่าย / Cr เงินฝาก'}
        actions={<>{mode === 'deposit' && <button onClick={() => nav('/fi/cheques/slips')}>ใช้ใบนำฝาก (BQ)</button>}{can('add') && <button className="primary" disabled={!sel.size} onClick={() => setDlg(true)}>ทำงาน <kbd>F5</kbd></button>}</>} />
      <div className="toolbar"><input type="search" autoFocus placeholder="ค้นหาเลขที่เช็ค หรือชื่อ" value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหา" /><span className="muted small">คลิก/Space เพื่อเลือก · เช็คในใบนำฝากผ่านที่ใบนำฝาก</span></div>
      <ErrorBox error={err ?? list.error} />
      <PickTable rows={rows} sel={sel} setSel={setSel} cols={mode === 'pass-paid' ? 'paid' : mode === 'deposit' ? 'deposit' : 'pass'} />
      <KeyHints keys={[['คลิก/Space', 'เลือกเช็ค'], ['F5', 'ทำงาน']]} />
      {dlg && <Modal title={mode === 'deposit' ? 'ป้อนรายละเอียดการนำฝาก' : 'ป้อนวันที่ผ่าน'} onClose={() => setDlg(false)} footer={<><button className="primary" onClick={go}>ตกลง</button><button onClick={() => setDlg(false)}>ยกเลิก <kbd>Esc</kbd></button></>}>
        <ErrorBox error={err} />
        <p className="hint">{sel.size} ใบ รวม <Money v={chosen.reduce((s, r) => s.plus(d(r.amount)), d(0)).toFixed(2)} /></p>
        <div className="form-grid" onKeyDown={navKey}>
          {needBank && <Field label="ธนาคารที่นำฝาก" req><BankSelect value={f.bank} onChange={(v) => setF({ ...f, bank: v })} label="ธนาคารที่นำฝาก" /></Field>}
          <Field label={mode === 'deposit' ? 'วันที่นำฝาก' : 'วันที่ผ่าน'} req><DateInput value={f.date} onChange={(v) => setF({ ...f, date: v })} /></Field>
          {needBank && <Field label="ค่าธรรมเนียม (ต่อใบ)" hint="เช่น เช็คต่างจังหวัด"><MoneyInput value={f.charge} onChange={(v) => setF({ ...f, charge: v })} aria-label="ค่าธรรมเนียม" /></Field>}
        </div>
      </Modal>}
    </div>
  );
}

/** S-BK-05/06 ใบนำฝากเช็ค BQ — ผ่านเช็คได้ทั้งใบเท่านั้น */
export function ChequeSlipListPage() {
  const nav = useNavigate();
  const can = useCan('FI.BK.DQ');
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: ['cheque-deposits', q], placeholderData: (p) => p, queryFn: () => api.get<{ rows: Array<{ id: string; doc_no: string; doc_date: string; remark: string | null; amount: string; net_amount: string; doc_status: string; account_code: string; account_name: string; voucher_no: string | null; cheques: number; pass_date: string | null; discount: boolean }> }>('/api/v1/cheque-deposits', { q }) });
  useHotkeys({ Insert: can('add') ? () => nav('/fi/cheques/slips/new') : undefined }, []);
  return (
    <div className="page" data-tone="finance">
      <PageHead eyebrow="ธนาคาร" title="ใบนำฝากเช็ค" lead="นำฝากเช็คหลายใบพร้อมกัน ป้อนธนาคารและวันที่ครั้งเดียว พิมพ์ใบนำฝากได้ · ผ่านเช็คทั้งใบเมื่อธนาคารเรียกเก็บได้ (ลงบัญชี)"
        actions={<><button onClick={() => nav('/fi/cheques/deposit')}>นำฝากเป็นใบๆ</button>{can('add') && <button className="primary" onClick={() => nav('/fi/cheques/slips/new')}>+ ใบนำฝากใหม่ <kbd>Ins</kbd></button>}</>} />
      <div className="toolbar"><input type="search" autoFocus placeholder="ค้นหาเลขที่ หรือหมายเหตุ" value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหา" /></div>
      <ErrorBox error={list.error} />
      <div className="table-wrap"><table className="grid">
        <thead><tr><th style={{ width: 140 }}>เลขที่</th><th style={{ width: 110 }}>วันที่นำฝาก</th><th style={{ width: 200 }}>เข้าบัญชี</th><th>หมายเหตุ</th><th className="r" style={{ width: 80 }}>เช็ค</th><th className="r" style={{ width: 140 }}>ยอดรวม</th><th style={{ width: 110 }}>วันที่ผ่าน</th><th style={{ width: 110 }}>สถานะ</th></tr></thead>
        <tbody>
          {list.data?.rows.map((r) => <tr key={r.id} className={cx('row-open', r.doc_status === 'C' && 'cancelled')} tabIndex={0} onClick={() => nav(`/fi/cheques/slips/${r.id}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`/fi/cheques/slips/${r.id}`)}>
            <td className="mono">{r.doc_no}{r.discount && <> <Pill tone="d">ขายลด</Pill></>}</td><td><DateText v={r.doc_date} /></td><td>{r.account_code} {r.account_name}</td><td>{r.remark}</td><td className="r">{r.cheques}</td><td className="r"><Money v={r.amount} /></td><td><DateText v={r.voucher_no ? r.pass_date : null} /></td>
            <td>{r.doc_status === 'C' ? <Pill tone="x">ยกเลิก</Pill> : r.voucher_no ? <Pill tone="n">เช็คผ่าน</Pill> : <Pill tone="c">รอเรียกเก็บ</Pill>}</td></tr>)}
          {list.data && !list.data.rows.length && <tr><td colSpan={8} className="empty">ยังไม่มีใบนำฝาก — กด Ins เพื่อเพิ่ม</td></tr>}
        </tbody></table></div>
      <KeyHints keys={[['Ins', 'ใบนำฝากใหม่'], ['คลิก/Enter', 'เปิด']]} />
    </div>
  );
}

export function ChequeSlipFormPage() {
  const { id: routeId } = useParams();
  const id = routeId && routeId !== 'new' ? routeId : null;
  const nav = useNavigate();
  const qc = useQueryClient();
  const can = useCan('FI.BK.DQ');
  const canPass = useCan('FI.BK.CL');
  const { me } = useSession();
  const cur = useQuery({ enabled: !!id, queryKey: ['cheque-deposits', 'one', id], staleTime: 0, queryFn: () => api.get<Record<string, string | null> & { editable: boolean; passed: boolean; cheques: Array<{ id: string; cheque_no: string; cheque_date: string; bank_code: string | null; bank_name: string | null; bank_branch: string | null; amount: string; status: string; pass_date: string | null }> }>(`/api/v1/cheque-deposits/${id}`) });
  const open = useCheques({ direction: 'R', status: '00,02', loose: 'Y' });
  const [h, setH] = useState<{ bank: string; date: string; remark: string; charge: string; vat: string; wht: string; discount: boolean; ref_no: string; ref_date: string } | null>(id ? null : { bank: '', date: me?.work_date ?? todayIso(), remark: '', charge: '', vat: '', wht: '', discount: false, ref_no: '', ref_date: '' });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [picking, setPicking] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [act, setAct] = useState<null | 'pass' | 'unpass' | 'cancel'>(null);
  const [f, setF] = useState({ date: me?.work_date ?? todayIso(), reason: '' });
  const [print, setPrint] = useState(false);
  if (!h && cur.data) {
    const c = cur.data;
    setH({ bank: c.bank_account_id ?? '', date: String(c.doc_date).slice(0, 10), remark: c.remark ?? '', charge: d(c.charge ?? 0).isZero() ? '' : d(c.charge!).toFixed(2), vat: d(c.vat_amount ?? 0).isZero() ? '' : d(c.vat_amount!).toFixed(2), wht: d(c.wht_amount ?? 0).isZero() ? '' : d(c.wht_amount!).toFixed(2), discount: !!(c as unknown as { discount: boolean }).discount, ref_no: c.ref_no ?? '', ref_date: c.ref_date ? String(c.ref_date).slice(0, 10) : '' });
    setSel(new Set(c.cheques.map((x) => x.id)));
  }
  const ro = !!id && (!cur.data?.editable || !can('edit'));
  const bq = useQuery({ queryKey: ['trade-defaults', 'BQ'], queryFn: () => api.get<{ types: Array<{ id: string; code: string; next_no: string }> }>('/api/v1/trade-defaults/BQ') });
  const dn = useDocNo(bq.data?.types[0], id ? cur.data?.doc_no : undefined, { disabled: ro, resetKey: h ? 'on' : 'off' });
  const pool: Row[] = [...(cur.data?.cheques ?? []).map((x) => ({ ...x, direction: 'R', status: x.status } as unknown as Row)), ...(open.data?.rows ?? [])];
  const chosen = pool.filter((r, i) => sel.has(r.id) && pool.findIndex((p) => p.id === r.id) === i);
  const total = chosen.reduce((s, r) => s.plus(d(r.amount)), d(0));
  const net = h ? total.minus(d(h.charge || 0)).minus(d(h.vat || 0)).minus(d(h.wht || 0)) : d(0);
  const save = async () => {
    if (!h || ro) return;
    setErr(null);
    try {
      const body = { doc_no: dn.value, cheque_ids: [...sel], bank_account_id: h.bank, doc_date: h.date, remark: h.remark || null, charge: h.charge || '0', vat: h.vat || '0', wht: h.wht || '0', discount: h.discount, ref_no: h.ref_no || null, ref_date: h.ref_date || null };
      const r = id ? await api.put<{ id: string; doc_no: string }>(`/api/v1/cheque-deposits/${id}`, body) : await api.post<{ id: string; doc_no: string }>('/api/v1/cheque-deposits', body);
      toast(`บันทึกใบนำฝาก ${r.doc_no} แล้ว`); refresh(qc);
      if (!id) { setH(null); nav(`/fi/cheques/slips/${r.id}`, { replace: true }); } else { await qc.refetchQueries({ queryKey: ['cheque-deposits', 'one', id] }); setH(null); }
    } catch (e) { setErr(e); }
  };
  const run = async (fn: () => Promise<unknown>, msg: string, back = false) => { setErr(null); try { await fn(); toast(msg); setAct(null); refresh(qc); if (back) nav('/fi/cheques/slips'); else { await qc.refetchQueries({ queryKey: ['cheque-deposits', 'one', id] }); setH(null); } } catch (e) { setErr(e); setAct(null); } };
  useHotkeys({ F9: save, 'Ctrl+S': save, F8: !ro ? () => setPicking(true) : undefined, Escape: () => nav('/fi/cheques/slips') }, []);
  const c = cur.data;
  const ys: YearSystem = me?.company?.year_system ?? 'B';
  return (
    <div className={cx('page', c?.doc_status === 'C' && 'doc-cancelled')} data-tone="finance">
      <div className="doc-title"><p className="eyebrow">ธนาคาร › ใบนำฝากเช็ค</p><h1>{id ? c?.doc_no : 'ใบนำฝากใหม่'}</h1><CancelStamp show={c?.doc_status === 'C'} reason={c?.cancel_reason} />
        <span className="doc-state">{c?.doc_status === 'C' ? <Pill tone="x">ยกเลิก</Pill> : c?.passed ? <Pill tone="n">10 เช็คผ่าน{c.pass_voucher_no ? <> · <DocLink id={c.journal_id} no={c.pass_voucher_no} cls="GL" /></> : ''}</Pill> : <Pill tone="c">01 รอเรียกเก็บ</Pill>}</span></div>
      <div className="toolbar">
        <button className="primary" disabled={ro} onClick={save}>บันทึก <kbd>F9</kbd></button>
        {id && !c?.passed && c?.doc_status !== 'C' && canPass('add') && <button onClick={() => setAct('pass')}>บันทึกเช็คผ่าน (ทั้งใบนำฝาก)</button>}
        {id && c?.passed && canPass('cancel') && <button onClick={() => setAct('unpass')}>ยกเลิกการผ่าน</button>}
        {id && <button onClick={() => { setPrint(true); setTimeout(() => { window.print(); setPrint(false); }, 100); }}>🖨 พิมพ์ใบนำฝาก</button>}
        <button disabled={!id || c?.doc_status === 'C' || !!c?.passed || !can('cancel')} onClick={() => setAct('cancel')}>ยกเลิกใบนำฝาก</button>
        <DocDelete kind="doc" id={id} docNo={c?.doc_no} cancelled={c?.doc_status === 'C'} cancelUrl={`/api/v1/cheque-deposits/${id}/cancel`} listPath="/fi/cheques/slips" canDelete={can('delete')} canCancel={can('cancel') && !c?.passed} />
        <CloseScreen />
        <button onClick={() => nav('/fi/cheques/slips')}>รายการ <kbd>Esc</kbd></button>
      </div>
      <ErrorBox error={err ?? cur.error} />
      {h && <div onKeyDown={navKey}>
        <div className="head-grid trade-head">
          <div className="col">
            <Field label="เข้าบัญชี" req>{ro ? <span>{c?.account_code} {c?.account_name}</span> : <BankSelect value={h.bank} onChange={(v) => setH({ ...h, bank: v })} label="เข้าบัญชี" />}</Field>
            <Field label="หมายเหตุ"><input value={h.remark} maxLength={200} disabled={ro} onChange={(e) => setH({ ...h, remark: e.target.value })} /></Field>
          </div>
          <div className="col">
            <Field label="ชนิด"><select value={h.discount ? 'S' : 'D'} disabled={!!id} onChange={(e) => setH({ ...h, discount: e.target.value === 'S' })} aria-label="ชนิดใบนำฝาก"><option value="D">ใบนำฝากเช็ค (DEQ)</option><option value="S">ใบขายลดเช็ค (SQR) — ผ่านทันที</option></select></Field>
            {dn.field}
            <Field label={h.discount ? 'วันที่ขายลด' : 'วันที่นำฝาก'} req><DateInput value={h.date} disabled={ro} onChange={(v) => setH({ ...h, date: v })} /></Field>
            {h.discount && <><Field label="ใบกำกับภาษีซื้อ#"><input value={h.ref_no} maxLength={30} disabled={ro} onChange={(e) => setH({ ...h, ref_no: e.target.value })} /></Field>
              <Field label="ลวท."><DateInput value={h.ref_date} disabled={ro} onChange={(v) => setH({ ...h, ref_date: v })} /></Field></>}
          </div>
        </div>
        <Tabs active="chq" onChange={() => undefined} tabs={[{ key: 'chq', label: 'รายการที่นำฝาก <F8>', badge: chosen.length || undefined }]} />
        <div className="table-wrap"><table className="grid">
          <thead><tr><th style={{ width: 140 }}>เลขที่เช็ค</th><th style={{ width: 100 }}>วันที่</th><th>ธนาคาร</th><th style={{ width: 120 }}>สาขา</th><th className="r" style={{ width: 140 }}>จำนวนเงิน</th><th style={{ width: 40 }} /></tr></thead>
          <tbody>{chosen.map((r) => <tr key={r.id}><td className="mono">{r.cheque_no}</td><td><DateText v={r.cheque_date} /></td><td>{r.bank_code} {r.bank_name}</td><td>{r.bank_branch}</td><td className="r"><Money v={r.amount} /></td>
            <td>{!ro && <button className="icon" title="นำออก" onClick={() => { const n = new Set(sel); n.delete(r.id); setSel(n); }}>✕</button>}</td></tr>)}
            {!chosen.length && <tr><td colSpan={6} className="empty">กด F8 เพื่อเลือกเช็คที่นำฝาก</td></tr>}</tbody></table></div>
        {!ro && <button style={{ marginTop: 8 }} onClick={() => setPicking(true)}>+ เลือกเช็ค <kbd>F8</kbd></button>}
        <table className="totals-table" style={{ marginLeft: 'auto', marginTop: 10 }}><tbody>
          <tr><td>ยอดรวม</td><td className="r"><Money v={total.toFixed(2)} /></td></tr>
          <tr><td>{h.discount ? 'หัก ค่าขายลด (ดอกเบี้ย)' : 'หัก ค่าธรรมเนียม'}</td><td><MoneyInput value={h.charge} disabled={ro} onChange={(v) => setH({ ...h, charge: v })} aria-label="ค่าธรรมเนียม" /></td></tr>
          <tr><td>ภาษีมูลค่าเพิ่ม (ของค่าธรรมเนียม)</td><td><MoneyInput value={h.vat} disabled={ro} onChange={(v) => setH({ ...h, vat: v })} aria-label="ภาษีมูลค่าเพิ่ม" /></td></tr>
          <tr><td>หักภาษี ณ ที่จ่ายไว้</td><td><MoneyInput value={h.wht} disabled={ro} onChange={(v) => setH({ ...h, wht: v })} aria-label="ภาษีหัก ณ ที่จ่าย" /></td></tr>
          <tr className="grand"><td>เงินเข้าบัญชีสุทธิ</td><td className="r"><Money v={net.toFixed(2)} /></td></tr>
        </tbody></table>
      </div>}
      <KeyHints keys={[['F8', 'เลือกเช็ค'], ['F9', 'บันทึก'], ['Esc', 'กลับรายการ']]} />
      {picking && <Modal title="เลือกเช็คเข้าใบนำฝาก" size="wide" onClose={() => setPicking(false)} footer={<><button className="primary" onClick={() => setPicking(false)}>ทำงาน <kbd>F5</kbd></button></>}>
        <PickTable rows={open.data?.rows ?? []} sel={sel} setSel={setSel} cols="deposit" />
      </Modal>}
      {act === 'pass' && <Confirm title="บันทึกเช็คผ่านทั้งใบนำฝาก" text={<>เช็คทุกใบในใบนำฝากเปลี่ยนเป็น เช็คผ่าน และลงบัญชี Dr เงินฝาก <Money v={c?.net_amount ?? '0'} /> / Cr เช็ครับ</>} okText="ตกลง" onClose={() => setAct(null)}
        onOk={() => run(() => api.post(`/api/v1/cheque-deposits/${id}/pass`, { pass_date: f.date }), 'บันทึกเช็คผ่านแล้ว')}>
        <Field label="วันที่ผ่าน" req hint="ตามใบแจ้งยอดธนาคาร"><DateInput value={f.date} onChange={(v) => setF({ ...f, date: v })} /></Field>
      </Confirm>}
      {act === 'unpass' && <Confirm danger title="ยกเลิกการผ่าน" text="ใบสำคัญผ่านเช็คจะถูกยกเลิก เช็คกลับเป็นรอเรียกเก็บ" okText="ยกเลิกการผ่าน" onClose={() => setAct(null)} onOk={() => run(() => api.post(`/api/v1/cheque-deposits/${id}/unpass`, { reason: f.reason }), 'ยกเลิกการผ่านแล้ว')}>
        <Field label="เหตุผล" req><input autoFocus value={f.reason} maxLength={200} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      </Confirm>}
      {act === 'cancel' && <Confirm danger title="ยกเลิกใบนำฝาก" text="เช็คทุกใบกลับเป็นเช็คในมือ (เปลี่ยนสถานะ ไม่ลบ)" okText="ยกเลิกใบนำฝาก" onClose={() => setAct(null)} onOk={() => run(() => api.post(`/api/v1/cheque-deposits/${id}/cancel`, { reason: f.reason }), 'ยกเลิกใบนำฝากแล้ว', true)}>
        <Field label="เหตุผลที่ยกเลิก" req><input autoFocus value={f.reason} maxLength={200} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      </Confirm>}
      {print && c && createPortal(<div className="vat-print"><h2>ใบนำฝากเช็ค {c.doc_no}</h2><p style={{ textAlign: 'center' }}>{me?.company?.name_th} · วันที่นำฝาก {formatDate(String(c.doc_date).slice(0, 10), ys)}</p>
        <table><thead><tr><th>#</th><th>เลขที่เช็ค</th><th>ลงวันที่</th><th>ธนาคาร</th><th>สาขา</th><th>จำนวนเงิน</th></tr></thead>
          <tbody>{c.cheques.map((x, i) => <tr key={x.id}><td>{i + 1}</td><td>{x.cheque_no}</td><td>{formatDate(String(x.cheque_date).slice(0, 10), ys)}</td><td>{x.bank_name}</td><td>{x.bank_branch}</td><td className="r">{fmt(x.amount)}</td></tr>)}
            <tr><td colSpan={5} className="r">รวม</td><td className="r">{fmt(c.amount ?? '0')}</td></tr></tbody></table></div>, document.body)}
    </div>
  );
}
