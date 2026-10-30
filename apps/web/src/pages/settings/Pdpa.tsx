import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PDPA_BASIS_TH, PDPA_ERASE_TH, PDPA_SUBJECT_TH, type PdpaEntry } from '@buddy/core';
import { api } from '../../api';
import { useCan, useSession } from '../../session';
import { cx, DateInput, DateText, downloadCsv, ErrorBox, Field, KeyHints, Modal, PageHead, Pill, Tabs, toast, useHotkeys } from '../../ui';

type Kind = 'CUSTOMER' | 'SUPPLIER' | 'SALESPERSON' | 'CONTACT';
type Hit = { kind: Kind; id: string; code: string; name: string; tax_id: string | null; phone: string | null; email: string | null; status: string };
type Report = {
  kind: Kind; master: Record<string, unknown>; contacts?: Array<Record<string, unknown>>; ship_to?: Array<Record<string, unknown>>; bank_accounts?: Array<Record<string, unknown>>;
  notes?: Array<{ seq: number; text: string }>; tax?: { vat_entries: number; wht_entries: number; cheques: number }; serials?: number;
  documents: { count: number; first_date: string | null; last_date: string | null; list: Array<{ doc_no: string; doc_date: string; doc_class: string; doc_status: string }>; truncated: boolean };
  retention: { last_activity: string | null; retain_until: string | null; full_erase_allowed: boolean };
};
type Req = { id: string; request_type: string; subject_type: Kind; subject_code: string | null; received_on: string; status: string; erase_mode: string | null; reason: string | null; result: unknown; completed_on: string | null; username: string | null };

const KIND_TH: Record<Kind, string> = { CUSTOMER: 'ลูกค้า', SUPPLIER: 'ผู้จำหน่าย', SALESPERSON: 'พนักงานขาย', CONTACT: 'ผู้ติดต่อ' };
const REQ_TH: Record<string, string> = { ACCESS: 'ขอดู/ขอรับสำเนา', PORT: 'ขอโอนย้ายข้อมูล', RECTIFY: 'ขอแก้ไข', ERASE: 'ขอลบ', OBJECT: 'คัดค้าน/ระงับใช้' };
const REQ_ST: Record<string, [string, 'n' | 'd' | 'x' | 'm']> = { O: ['รอดำเนินการ', 'd'], D: ['ดำเนินการแล้ว', 'n'], R: ['ปฏิเสธ', 'x'] };
const TABLE_TH: Record<string, string> = {
  md_customer: 'ลูกค้า', md_customer_ship_to: 'สถานที่ส่งของ', md_supplier: 'ผู้จำหน่าย', md_supplier_bank: 'บัญชีธนาคารผู้จำหน่าย', md_party_contact: 'ผู้ติดต่อ',
  md_note: 'หมายเหตุแฟ้มหลัก', md_salesperson: 'พนักงานขาย', doc_header: 'หัวเอกสาร', tax_vat_entry: 'แฟ้มภาษีซื้อ/ขาย', tax_wht_entry: 'แฟ้มภาษีหัก ณ ที่จ่าย', fin_cheque: 'ทะเบียนเช็ค',
  md_serial: 'หมายเลขสินค้า/บัตรรับประกัน', sys_ai_usage: 'AI อ่านบิล', sys_user: 'ผู้ใช้งาน', sys_user_security: 'ยืนยันตัวตนสองขั้น', sys_session: 'การเข้าระบบ', sys_activity_log: 'แฟ้มบันทึกเหตุการณ์',
  sys_tenant: 'ลูกค้าผู้ใช้บริการ', sys_company: 'บริษัท',
};
const FIELD_TH: Record<string, string> = {
  code: 'รหัส', status: 'สถานะ', title: 'คำนำหน้า', name: 'ชื่อ', name_en: 'ชื่ออังกฤษ', address_1: 'ที่อยู่ 1', address_2: 'ที่อยู่ 2', address_3: 'ที่อยู่ 3', address: 'ที่อยู่', zip_code: 'รหัสไปรษณีย์',
  tax_id: 'เลขผู้เสียภาษี', tax_branch_no: 'สาขา', phone: 'โทรศัพท์', email: 'อีเมล', contact: 'ผู้ติดต่อ', remark: 'หมายเหตุ', position: 'ตำแหน่ง', social_security_no: 'เลขประกันสังคม',
  party_code: 'รหัสคู่ค้า', party_name: 'ชื่อคู่ค้า', party_type: 'ชนิดคู่ค้า',
};
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

/**
 * ข้อมูลส่วนบุคคล PDPA (T0.17) — เจ้าของข้อมูล: ค้นหา ดู ส่งออกสำเนา ลบข้อมูลติดต่อ ปิดบังเมื่อพ้นระยะเก็บเอกสาร 5 ปี
 * ทะเบียนคำขอ (ม.39 รวมคำขอที่ปฏิเสธ) · ทะเบียนข้อมูลส่วนบุคคลที่โปรแกรมเก็บ (วัตถุประสงค์ ฐานกฎหมาย ระยะเก็บ)
 */
export function PdpaPage() {
  const can = useCan('SET.PDPA');
  const { me } = useSession();
  const [tab, setTab] = useState('subjects');
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState<Hit | null>(null);
  const [newReq, setNewReq] = useState<{ kind: Kind; id: string | null; code: string | null; type?: string } | null>(null);
  const hits = useQuery({ enabled: term.length >= 2, queryKey: ['pdpa-subjects', term], queryFn: () => api.get<Hit[]>(`/api/v1/pdpa/subjects?q=${encodeURIComponent(term)}`) });
  const reqs = useQuery({ queryKey: ['pdpa-requests'], queryFn: () => api.get<Req[]>('/api/v1/pdpa/requests') });
  useHotkeys({ Insert: tab === 'requests' && can('add') ? () => setNewReq({ kind: 'CUSTOMER', id: null, code: null }) : undefined }, [tab]);
  const pending = reqs.data?.filter((r) => r.status === 'O').length;
  return (
    <div className="page" data-tone="settings">
      <PageHead eyebrow="เริ่มระบบ › ความปลอดภัย" title="ข้อมูลส่วนบุคคล (PDPA)"
        lead={<>ข้อมูลบุคคลของ <b>{me?.company?.name_th}</b> — รับคำขอของเจ้าของข้อมูล (ขอดู ขอสำเนา ขอลบ) ภายใน 30 วัน · เอกสารบัญชี/ภาษีต้องเก็บ 5 ปี จึงลบได้เฉพาะข้อมูลติดต่อก่อนครบกำหนด</>}
        actions={tab === 'requests' && can('add') && <button className="primary" onClick={() => setNewReq({ kind: 'CUSTOMER', id: null, code: null })}>+ บันทึกคำขอ <kbd>Ins</kbd></button>} />
      <Tabs active={tab} onChange={setTab} tabs={[{ key: 'subjects', label: 'เจ้าของข้อมูล' }, { key: 'requests', label: 'ทะเบียนคำขอ', badge: pending || undefined }, { key: 'register', label: 'ทะเบียนข้อมูลส่วนบุคคล' }]} />
      {tab === 'subjects' && <>
        <div className="toolbar">
          <input style={{ width: 360 }} placeholder="รหัส ชื่อ เลขผู้เสียภาษี โทรศัพท์ หรืออีเมล แล้วกด Enter" value={q} autoFocus
            onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') setTerm(q.trim()); }} />
          <button onClick={() => setTerm(q.trim())}>🔍 ค้นหา</button>
        </div>
        <ErrorBox error={hits.error} />
        {term.length >= 2 && <div className="table-wrap">
          <table className="grid">
            <thead><tr><th style={{ width: 110 }}>ชนิด</th><th style={{ width: 120 }}>รหัส</th><th>ชื่อ</th><th style={{ width: 140 }}>เลขผู้เสียภาษี</th><th style={{ width: 140 }}>โทรศัพท์</th><th>อีเมล</th></tr></thead>
            <tbody>
              {hits.data?.map((h) => (
                <tr key={h.kind + h.id} className={cx('row-open', h.status === 'I' && 'cancelled')} onClick={() => setOpen(h)}>
                  <td>{KIND_TH[h.kind]}</td><td className="mono">{h.code}</td><td>{h.name}</td><td className="mono">{h.tax_id}</td><td>{h.phone}</td><td>{h.email}</td>
                </tr>
              ))}
              {hits.data && !hits.data.length && <tr><td colSpan={6} className="empty">ไม่พบ "{term}"</td></tr>}
            </tbody>
          </table>
        </div>}
        <KeyHints keys={[['Enter', 'ค้นหา'], ['คลิกแถว', 'ดูข้อมูลที่เก็บไว้ / ส่งออก / ลบ']]} />
      </>}
      {tab === 'requests' && <RequestList rows={reqs.data} error={reqs.error} canEdit={can('edit')} />}
      {tab === 'register' && <RegisterTab />}
      {open && <SubjectModal hit={open} onClose={() => setOpen(null)} onRequest={(type) => setNewReq({ kind: open.kind, id: open.id, code: open.code, type })} />}
      {newReq && <RequestForm preset={newReq} onClose={() => setNewReq(null)} />}
    </div>
  );
}

function SubjectModal({ hit, onClose, onRequest }: { hit: Hit; onClose: () => void; onRequest: (type: string) => void }) {
  const can = useCan('SET.PDPA');
  const qc = useQueryClient();
  const url = `/api/v1/pdpa/subjects/${hit.kind}/${hit.id}`;
  const r = useQuery({ queryKey: ['pdpa-subject', hit.kind, hit.id], queryFn: () => api.get<Report>(url) });
  const [erase, setErase] = useState<'CONTACT' | 'FULL' | null>(null);
  const [receivedOn, setReceivedOn] = useState(today());
  const [err, setErr] = useState<unknown>(null);
  const exportCopy = () => api.post<{ report: Report }>(`${url}/access`, { received_on: receivedOn }).then((x) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(x.report, null, 2)], { type: 'application/json' }));
    a.download = `ข้อมูลส่วนบุคคล-${hit.code || hit.kind}-${today()}.json`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('ส่งออกสำเนาและบันทึกคำขอแล้ว'); qc.invalidateQueries({ queryKey: ['pdpa-requests'] });
  }).catch(setErr);
  const d = r.data;
  const ret = d?.retention;
  return (
    <Modal size="wide" title={`${KIND_TH[hit.kind]} ${hit.code} ${hit.name}`} onClose={onClose}
      footer={<>
        <button onClick={onClose}>ปิด <kbd>Esc</kbd></button>
        {can('add') && <button onClick={() => onRequest('RECTIFY')}>บันทึกคำขออื่น…</button>}
        {can('print') && <button onClick={exportCopy}>⬇ ส่งออกสำเนา (JSON)</button>}
        {can('delete') && hit.kind !== 'CONTACT' && <button onClick={() => setErase('CONTACT')}>ลบข้อมูลติดต่อ…</button>}
        {can('delete') && <button className="danger" disabled={!ret?.full_erase_allowed} title={ret?.full_erase_allowed ? '' : `ต้องเก็บเอกสารถึง ${ret?.retain_until ?? ''}`} onClick={() => setErase('FULL')}>{hit.kind === 'CONTACT' ? 'ลบผู้ติดต่อ…' : 'ปิดบังทั้งหมด…'}</button>}
      </>}>
      <ErrorBox error={err ?? r.error} />
      {d && <>
        <div className={cx('notebox', !ret?.full_erase_allowed && 'warn')}>
          {d.kind === 'CONTACT' ? 'ผู้ติดต่อไม่อยู่ในเอกสารภาษี — ลบได้ทันทีเมื่อเจ้าของข้อมูลขอ'
            : ret?.retain_until
              ? ret.full_erase_allowed
                ? <>เอกสารล่าสุด <DateText v={ret.last_activity} /> พ้นระยะเก็บแล้ว (<DateText v={ret.retain_until} />) — ปิดบังชื่อ ที่อยู่ เลขผู้เสียภาษีได้ทั้งหมด</>
                : <>เอกสารล่าสุด <DateText v={ret.last_activity} /> — กฎหมายบัญชี/ภาษีให้เก็บถึง <b><DateText v={ret.retain_until} /></b> · ระหว่างนี้ลบได้เฉพาะข้อมูลติดต่อ ถ้าเจ้าของข้อมูลขอลบทั้งหมดให้บันทึกเป็น "ปฏิเสธ" พร้อมเหตุผลนี้</>
              : 'ยังไม่มีเอกสารอ้างถึง — ปิดบังทั้งหมดได้ทันที'}
        </div>
        <div className="form-grid"><Field label="วันที่ได้รับคำขอ (ใช้ตอนส่งออกสำเนา/ลบ)"><DateInput value={receivedOn} onChange={setReceivedOn} /></Field></div>
        <h3>ข้อมูลในแฟ้มหลัก</h3>
        <table className="grid kv" style={{ width: '100%' }}><tbody>
          {Object.entries(d.master).filter(([k]) => k !== 'id').map(([k, v]) => <tr key={k}><th style={{ width: 180 }}>{FIELD_TH[k] ?? k}</th>
            <td>{v === null || v === '' ? <span className="muted">—</span> : k === 'status' ? (v === 'I' ? 'เลิกใช้' : 'ใช้งาน') : k === 'party_type' ? (v === 'C' ? 'ลูกค้า' : 'ผู้จำหน่าย') : String(v)}</td></tr>)}
        </tbody></table>
        {!!d.contacts?.length && <><h3>ผู้ติดต่อ</h3><SimpleTable rows={d.contacts} cols={['name', 'position', 'phone', 'email']} /></>}
        {!!d.ship_to?.length && <><h3>สถานที่ส่งของ</h3><SimpleTable rows={d.ship_to} cols={['code', 'address_1', 'address_2', 'zip_code', 'phone', 'contact']} /></>}
        {!!d.bank_accounts?.length && <><h3>บัญชีธนาคาร</h3><SimpleTable rows={d.bank_accounts} cols={['bank_code', 'branch', 'account_no', 'account_name']} /></>}
        {!!d.notes?.length && <><h3>หมายเหตุ</h3>{d.notes.map((n) => <div key={n.seq}>{n.text}</div>)}</>}
        {d.kind !== 'CONTACT' && <>
          <h3>เอกสารที่อ้างถึง {d.documents.count.toLocaleString()} ใบ {d.documents.first_date && <span className="small muted">(<DateText v={d.documents.first_date} /> – <DateText v={d.documents.last_date} />)</span>}</h3>
          {d.tax && <p className="small">แฟ้มภาษีซื้อ/ขาย {d.tax.vat_entries} รายการ · ภาษีหัก ณ ที่จ่าย {d.tax.wht_entries} รายการ · เช็ค {d.tax.cheques} ใบ{d.serials ? ` · บัตรรับประกัน ${d.serials} ใบ` : ''}</p>}
          {!!d.documents.list.length && <div className="table-wrap" style={{ maxHeight: 220 }}><table className="grid"><thead><tr><th>เลขที่</th><th>วันที่</th><th>ชนิด</th><th>สถานะ</th></tr></thead>
            <tbody>{d.documents.list.slice(0, 100).map((x) => <tr key={x.doc_no + x.doc_date} className={cx(x.doc_status === 'C' && 'cancelled')}><td className="mono">{x.doc_no}</td><td><DateText v={x.doc_date} /></td><td>{x.doc_class}</td><td>{x.doc_status}</td></tr>)}</tbody></table></div>}
          {d.documents.count > 100 && <p className="small muted">แสดง 100 ใบล่าสุด — แฟ้มที่ส่งออกมีสูงสุด 500 ใบ</p>}
        </>}
      </>}
      {erase && d && <EraseDialog hit={hit} mode={erase} receivedOn={receivedOn} onClose={() => setErase(null)}
        onDone={() => { setErase(null); qc.invalidateQueries({ queryKey: ['pdpa-subject'] }); qc.invalidateQueries({ queryKey: ['pdpa-subjects'] }); qc.invalidateQueries({ queryKey: ['pdpa-requests'] }); onClose(); }} />}
    </Modal>
  );
}

function SimpleTable({ rows, cols }: { rows: Array<Record<string, unknown>>; cols: string[] }) {
  return <table className="grid" style={{ width: '100%' }}><thead><tr>{cols.map((c) => <th key={c}>{FIELD_TH[c] ?? c}</th>)}</tr></thead>
    <tbody>{rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c}>{r[c] == null ? '' : String(r[c])}</td>)}</tr>)}</tbody></table>;
}

function EraseDialog({ hit, mode, receivedOn, onClose, onDone }: { hit: Hit; mode: 'CONTACT' | 'FULL'; receivedOn: string; onClose: () => void; onDone: () => void }) {
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const run = () => api.post<{ rows: Record<string, number> }>(`/api/v1/pdpa/subjects/${hit.kind}/${hit.id}/erase`, { mode, received_on: receivedOn, confirm })
    .then((r) => { toast(`ลบแล้ว ${Object.values(r.rows).reduce((s, n) => s + n, 0)} แถว และบันทึกในทะเบียนคำขอแล้ว`); onDone(); }).catch(setErr);
  const full = mode === 'FULL';
  return (
    <Modal size="confirm" title={full ? (hit.kind === 'CONTACT' ? 'ลบผู้ติดต่อ' : 'ปิดบังข้อมูลทั้งหมด') : 'ลบข้อมูลติดต่อ'} onClose={onClose}
      footer={<><button onClick={onClose}>ยกเลิก</button><button className="danger" disabled={confirm.trim().toUpperCase() !== hit.code.toUpperCase()} onClick={run}>ลบถาวร</button></>}>
      <ErrorBox error={err} />
      {full
        ? <p>{hit.kind === 'CONTACT' ? 'ลบชื่อ ตำแหน่ง โทรศัพท์ อีเมลของผู้ติดต่อนี้' : 'ลบข้อมูลติดต่อ และเปลี่ยนชื่อเป็น "ลบตาม PDPA" ลบที่อยู่ เลขผู้เสียภาษี ทั้งในแฟ้มหลักและเอกสาร/แฟ้มภาษีทุกใบที่อ้างถึง · ยอดเงินไม่เปลี่ยน · สถานะเป็นเลิกใช้'}</p>
        : <p>ลบโทรศัพท์ อีเมล ผู้ติดต่อ หมายเหตุ{hit.kind === 'SUPPLIER' ? ' บัญชีธนาคาร' : ''}{hit.kind === 'SALESPERSON' ? ' ที่อยู่ เลขผู้เสียภาษี เลขประกันสังคม' : ''} — คงชื่อ ที่อยู่ และเลขผู้เสียภาษีไว้เพราะกฎหมายบัญชี/ภาษีให้เก็บเอกสาร</p>}
      <p className="small muted">ลบแล้วเรียกคืนไม่ได้ (ข้อมูลในแฟ้มสำรองเก่ายังมีอยู่ — นำกลับแล้วต้องลบซ้ำ)</p>
      <Field label={`พิมพ์รหัส ${hit.code} เพื่อยืนยัน`} req><input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoFocus /></Field>
    </Modal>
  );
}

function RequestList({ rows, error, canEdit }: { rows: Req[] | undefined; error: unknown; canEdit: boolean }) {
  const [close, setClose] = useState<Req | null>(null);
  return <>
    <ErrorBox error={error} />
    <div className="table-wrap">
      <table className="grid">
        <thead><tr><th style={{ width: 110 }}>วันที่รับ</th><th style={{ width: 150 }}>คำขอ</th><th style={{ width: 110 }}>เจ้าของข้อมูล</th><th style={{ width: 120 }}>รหัส</th><th style={{ width: 120 }}>ผล</th><th>รายละเอียด / เหตุผล</th><th style={{ width: 110 }}>เสร็จ</th><th style={{ width: 100 }}>ผู้บันทึก</th></tr></thead>
        <tbody>
          {rows?.map((r) => (
            <tr key={r.id} className={cx(r.status === 'O' && canEdit && 'row-open')} onClick={() => r.status === 'O' && canEdit && setClose(r)}>
              <td><DateText v={r.received_on} /></td><td>{REQ_TH[r.request_type] ?? r.request_type}{r.erase_mode && <span className="small muted"> · {r.erase_mode === 'FULL' ? 'ปิดบังทั้งหมด' : 'ข้อมูลติดต่อ'}</span>}</td>
              <td>{KIND_TH[r.subject_type]}</td><td className="mono">{r.subject_code}</td>
              <td><Pill tone={REQ_ST[r.status]?.[1]}>{REQ_ST[r.status]?.[0]}</Pill></td>
              <td className="small">{r.reason}{r.result && r.erase_mode ? <span className="muted"> {Object.entries(r.result as Record<string, number>).filter(([, n]) => n).map(([t, n]) => `${TABLE_TH[t] ?? t} ${n}`).join(' · ')}</span> : null}</td>
              <td><DateText v={r.completed_on} /></td><td className="small">{r.username}</td>
            </tr>
          ))}
          {rows && !rows.length && <tr><td colSpan={8} className="empty">ยังไม่มีคำขอ</td></tr>}
        </tbody>
      </table>
    </div>
    <p className="hint">คลิกคำขอที่รอดำเนินการเพื่อปิดคำขอ · กฎหมายให้ตอบเจ้าของข้อมูลภายใน 30 วันนับจากวันที่ได้รับคำขอ</p>
    {close && <CloseRequest r={close} onClose={() => setClose(null)} />}
  </>;
}

function CloseRequest({ r, onClose }: { r: Req; onClose: () => void }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'D' | 'R'>('D');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const save = () => api.put(`/api/v1/pdpa/requests/${r.id}`, { status, reason: reason || null }).then(() => { toast('ปิดคำขอแล้ว'); qc.invalidateQueries({ queryKey: ['pdpa-requests'] }); onClose(); }).catch(setErr);
  useHotkeys({ F9: save, 'Ctrl+S': save }, [status, reason]);
  return (
    <Modal size="confirm" title={`ปิดคำขอ ${REQ_TH[r.request_type]} ${r.subject_code ?? ''}`} onClose={onClose} footer={<><button onClick={onClose}>ยกเลิก</button><button className="primary" onClick={save}>บันทึก <kbd>F9</kbd></button></>}>
      <ErrorBox error={err} />
      <div className="form-grid">
        <Field label="ผล" req><select value={status} onChange={(e) => setStatus(e.target.value as 'D' | 'R')}><option value="D">ดำเนินการแล้ว</option><option value="R">ปฏิเสธ</option></select></Field>
        <Field label="เหตุผล / รายละเอียด" req={status === 'R'} wide><input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function RequestForm({ preset, onClose }: { preset: { kind: Kind; id: string | null; code: string | null; type?: string }; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ request_type: preset.type ?? 'RECTIFY', subject_type: preset.kind, received_on: today(), status: 'D', reason: '' });
  const [err, setErr] = useState<unknown>(null);
  const save = () => api.post('/api/v1/pdpa/requests', { ...f, subject_id: preset.id, reason: f.reason || null })
    .then(() => { toast('บันทึกคำขอแล้ว'); qc.invalidateQueries({ queryKey: ['pdpa-requests'] }); onClose(); }).catch(setErr);
  useHotkeys({ F9: save, 'Ctrl+S': save }, [f]);
  return (
    <Modal title={preset.code ? `บันทึกคำขอของ ${KIND_TH[preset.kind]} ${preset.code}` : 'บันทึกคำขอของเจ้าของข้อมูล'} onClose={onClose}
      footer={<><button onClick={onClose}>ยกเลิก</button><button className="primary" onClick={save}>บันทึก <kbd>F9</kbd></button></>}>
      <ErrorBox error={err} />
      <p className="small muted">ขอดู/ขอสำเนา และขอลบ ให้ทำจากแถบ "เจ้าของข้อมูล" (ระบบบันทึกคำขอให้เอง) · ขอแก้ไข: แก้ที่หน้าลูกค้า/ผู้จำหน่ายแล้วบันทึกไว้ที่นี่ · ปฏิเสธต้องมีเหตุผล</p>
      <div className="form-grid">
        <Field label="คำขอ" req><select value={f.request_type} onChange={(e) => setF({ ...f, request_type: e.target.value })}>{Object.entries(REQ_TH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="เจ้าของข้อมูล" req><select value={f.subject_type} disabled={!!preset.id} onChange={(e) => setF({ ...f, subject_type: e.target.value as Kind })}>{Object.entries(KIND_TH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="วันที่ได้รับคำขอ" req><DateInput value={f.received_on} onChange={(v) => setF({ ...f, received_on: v })} /></Field>
        <Field label="ผล" req><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="O">รอดำเนินการ</option><option value="D">ดำเนินการแล้ว</option><option value="R">ปฏิเสธ</option></select></Field>
        <Field label="เหตุผล / รายละเอียด" req={f.status === 'R'} wide><input value={f.reason} maxLength={200} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function RegisterTab() {
  const reg = useQuery({ queryKey: ['pdpa-register'], queryFn: () => api.get<Array<PdpaEntry & { count: number | null }>>('/api/v1/pdpa/register') });
  const csv = () => downloadCsv('ทะเบียนข้อมูลส่วนบุคคล', ['ตาราง', 'ช่องข้อมูล', 'เจ้าของข้อมูล', 'ประเภทข้อมูล', 'วัตถุประสงค์', 'ฐานทางกฎหมาย', 'ระยะเก็บ', 'การลบ', 'ส่งต่อภายนอก', 'จำนวนแถวในบริษัทนี้'],
    (reg.data ?? []).map((e) => [TABLE_TH[e.table] ?? e.table, e.columns.join(' '), PDPA_SUBJECT_TH[e.subject], e.category, e.purpose, PDPA_BASIS_TH[e.basis], e.retention, PDPA_ERASE_TH[e.erase], e.transfer ?? '', e.count ?? '']));
  return <>
    <div className="toolbar"><span className="small muted">บันทึกรายการประมวลผลข้อมูลส่วนบุคคล (ม.39) ที่โปรแกรมเก็บ — ส่งให้เจ้าหน้าที่คุ้มครองข้อมูล/ผู้ตรวจได้</span><span style={{ flex: 1 }} /><button onClick={csv}>⬇ Excel (CSV)</button></div>
    <ErrorBox error={reg.error} />
    <div className="table-wrap">
      <table className="grid">
        <thead><tr><th style={{ width: 150 }}>ข้อมูลที่</th><th>ประเภทข้อมูล</th><th style={{ width: 120 }}>เจ้าของข้อมูล</th><th>วัตถุประสงค์</th><th style={{ width: 170 }}>ฐานทางกฎหมาย</th><th style={{ width: 170 }}>ระยะเก็บ / การลบ</th><th className="r" style={{ width: 90 }}>มีข้อมูล</th></tr></thead>
        <tbody>
          {reg.data?.map((e, i) => (
            <tr key={i}>
              <td>{TABLE_TH[e.table] ?? e.table}<div className="small muted mono">{e.table}</div></td>
              <td>{e.category}<div className="small muted mono">{e.columns.join(', ')}</div>{e.transfer && <div className="small">ส่งต่อ: {e.transfer}</div>}</td>
              <td>{PDPA_SUBJECT_TH[e.subject]}</td><td className="small">{e.purpose}</td><td className="small">{PDPA_BASIS_TH[e.basis]}</td>
              <td className="small">{e.retention}<div className="muted">{PDPA_ERASE_TH[e.erase]}</div></td>
              <td className="r">{e.count === null ? <span className="small muted">ทั้งระบบ</span> : e.count.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </>;
}
