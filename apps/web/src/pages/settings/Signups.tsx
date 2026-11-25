import { useState } from 'react';
import { StarterSelect } from '../../components/StarterFill';
import { packageBody, PackageFields, packageValues } from '../../components/PackageFields';
import { STARTER_TEMPLATES } from '@buddy/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { DateInput, DateText, ErrorBox, Field, Modal, Pill, toast, toastError, useHotkeys } from '../../ui';

type Row = { id: string; business_name: string; contact_name: string; contact_email: string; contact_phone: string; tax_id: string | null; business_template?: string | null; username: string; status: 'P' | 'A' | 'R'; created_at: string;
  decided_at: string | null; reject_reason: string | null; client_ip: string | null; tenant_code: string | null; decided_by_name: string | null; mail?: MailRow[] };
/** อีเมลที่ส่งเรื่องใบสมัคร (HANDOFF 187) */
type MailKind = 'SIGNUP_NOTIFY' | 'SIGNUP_RECEIVED' | 'SIGNUP_APPROVED' | 'SIGNUP_REJECTED';
type MailRow = { kind: MailKind; status: 'S' | 'F' | 'K'; error: string | null; attempts: number; last_attempt_at: string; recipients: string };
const MAIL_LABEL: Record<MailKind, string> = { SIGNUP_NOTIFY: 'แจ้งผู้ให้บริการ', SIGNUP_RECEIVED: 'ได้รับใบสมัคร', SIGNUP_APPROVED: 'อนุมัติแล้ว', SIGNUP_REJECTED: 'ไม่อนุมัติ' };
const MAIL_ST: Record<MailRow['status'], [string, 'n' | 'c' | 'x']> = { S: ['ส่งแล้ว', 'n'], F: ['ส่งไม่สำเร็จ', 'c'], K: ['ไม่ได้ส่ง', 'x'] };
/** อีเมลที่ควรมีตามสถานะใบสมัคร */
const expectedMails = (r: Row): MailKind[] => ['SIGNUP_NOTIFY', ...(r.status === 'P' ? ['SIGNUP_RECEIVED'] as MailKind[] : r.status === 'A' ? ['SIGNUP_APPROVED'] as MailKind[] : ['SIGNUP_REJECTED'] as MailKind[])];
const ST: Record<string, [string, 'n' | 'd' | 'x']> = { P: ['รออนุมัติ', 'd'], A: ['อนุมัติแล้ว', 'n'], R: ['ไม่อนุมัติ', 'x'] };
const MODE_TH = { review: 'ผู้ให้บริการอนุมัติก่อน', auto: 'เปิดบัญชีทันที (อนุมัติอัตโนมัติ)', off: 'ปิดรับสมัคร' };

/** ใบสมัครใช้งานจากหน้าสมัครเอง — เจ้าหน้าที่ผู้ให้บริการอนุมัติ (สร้างลูกค้า + ผู้ดูแลคนแรก) หรือไม่อนุมัติ */
export function SignupsPanel({ onApproved }: { onApproved: () => void }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'P' | 'A' | 'R' | 'all'>('P');
  const q = useQuery({ queryKey: ['signups', status], queryFn: () => api.get<{ mode: keyof typeof MODE_TH; rows: Row[]; notify_set?: boolean }>('/api/v1/signups', { status }) });
  const [busy, setBusy] = useState<string | null>(null);
  const resend = (r: Row, kind: MailKind) => {
    setBusy(`${r.id}:${kind}`);
    api.post<{ status: 'S' | 'F' | 'K'; error: string | null }>(`/api/v1/signups/${r.id}/mail/${kind}`)
      .then((x) => { toast(x.status === 'S' ? `ส่งอีเมล "${MAIL_LABEL[kind]}" แล้ว` : `ยังส่งไม่ได้: ${x.error ?? ''}`, x.status === 'S' ? 'ok' : 'warn'); reload(); })
      .catch(toastError).finally(() => setBusy(null));
  };
  const [mailSet, setMailSet] = useState(false);
  const [approve, setApprove] = useState<Row | null>(null);
  const [reject, setReject] = useState<Row | null>(null);
  const reload = () => { qc.invalidateQueries({ queryKey: ['signups'] }); };
  return (
    <div className="card su-panel">
      <div className="su-head">
        <h2>ใบสมัครใช้งาน</h2>
        <select value={status} onChange={(e) => setStatus(e.target.value as 'P')} aria-label="สถานะใบสมัคร"><option value="P">รออนุมัติ</option><option value="A">อนุมัติแล้ว</option><option value="R">ไม่อนุมัติ</option><option value="all">ทั้งหมด</option></select>
        {q.data && <span className="muted small">หน้าสมัคร: <b>{MODE_TH[q.data.mode]}</b> (ตั้งด้วย BUDDY_SIGNUP = review / auto / off) · ลิงก์สมัคร: <span className="mono">{location.origin}/signup</span></span>}
        <button type="button" onClick={() => setMailSet(true)}>✉ ตั้งค่าอีเมลแจ้งเตือน</button>
      </div>
      {q.data && q.data.notify_set === false && <p className="notebox warn" role="status">ยังไม่ได้ตั้ง "อีเมลรับแจ้งเตือนใบสมัคร" — ผู้ให้บริการจะไม่ได้รับอีเมลเมื่อมีผู้สมัครใหม่ <button type="button" className="linklike" onClick={() => setMailSet(true)}>ตั้งค่าเลย</button></p>}
      <ErrorBox error={q.error} />
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th style={{ width: 110 }}>วันที่สมัคร</th><th>กิจการ</th><th>ผู้ติดต่อ</th><th style={{ width: 130 }}>รหัสผู้ใช้</th><th style={{ width: 110 }}>สถานะ</th><th>อีเมล</th><th style={{ width: 200 }} /></tr></thead>
          <tbody>
            {q.data?.rows.map((r) => <tr key={r.id}>
              <td><DateText v={r.created_at.slice(0, 10)} /></td><td>{r.business_name}{r.tax_id && <div className="small mono muted">{r.tax_id}</div>}</td>
              <td className="small">{r.contact_name}<br />{r.contact_email} · {r.contact_phone}</td><td className="mono">{r.username}</td>
              <td><Pill tone={ST[r.status]![1]}>{ST[r.status]![0]}</Pill>{r.tenant_code && <div className="small mono">{r.tenant_code}</div>}{r.reject_reason && <div className="small muted">{r.reject_reason}</div>}</td>
              <td className="su-mail">{expectedMails(r).map((k) => { const m = r.mail?.find((x) => x.kind === k); return (
                <div key={k} className="small" title={m ? `${m.recipients} · ส่ง ${m.attempts} ครั้ง${m.error ? ` · ${m.error}` : ''}` : 'ยังไม่ได้ส่ง'}>
                  {MAIL_LABEL[k]} {m ? <Pill tone={MAIL_ST[m.status][1]}>{MAIL_ST[m.status][0]}</Pill> : <span className="muted">—</span>}
                  {(!m || m.status !== 'S') && <button type="button" className="linklike" disabled={busy === `${r.id}:${k}`} onClick={() => resend(r, k)}>{busy === `${r.id}:${k}` ? 'กำลังส่ง…' : 'ส่งอีกครั้ง'}</button>}
                  {m && m.status !== 'S' && m.error && <div className="muted">{m.error}</div>}
                </div>); })}</td>
              <td>{r.status === 'P' && <><button className="primary" onClick={() => setApprove(r)}>อนุมัติ…</button> <button onClick={() => setReject(r)}>ไม่อนุมัติ…</button></>}</td>
            </tr>)}
            {q.data && !q.data.rows.length && <tr><td colSpan={7} className="empty">{status === 'P' ? 'ไม่มีใบสมัครที่รออนุมัติ' : 'ไม่มีใบสมัคร'}</td></tr>}
          </tbody>
        </table>
      </div>
      {approve && <ApproveForm r={approve} onClose={() => setApprove(null)} onDone={() => { setApprove(null); reload(); onApproved(); }} />}
      {reject && <RejectForm r={reject} onClose={() => setReject(null)} onDone={() => { setReject(null); reload(); }} />}
      {mailSet && <MailSettings onClose={() => { setMailSet(false); reload(); }} />}
    </div>
  );
}

type MailSettingsData = { notify: string[]; reply_to: string | null; from: string; driver: string; sending: boolean; note: string };
/** ค่าตั้งอีเมลของผู้ให้บริการ (HANDOFF 187): ผู้รับแจ้งเตือนใบสมัคร · Reply-To · ผู้ส่ง · ดูตัวอย่างอีเมล */
function MailSettings({ onClose }: { onClose: () => void }) {
  const q = useQuery({ queryKey: ['mail-settings'], queryFn: () => api.get<MailSettingsData>('/api/v1/platform/mail-settings') });
  const [f, setF] = useState<{ notify: string; reply_to: string; from: string } | null>(null);
  const v = f ?? (q.data ? { notify: q.data.notify.join(', '), reply_to: q.data.reply_to ?? '', from: q.data.from } : null);
  const [err, setErr] = useState<unknown>(null);
  const [preview, setPreview] = useState<MailKind | null>(null);
  const pv = useQuery({ enabled: !!preview, queryKey: ['mail-preview', preview], queryFn: () => api.get<{ subject: string; html: string; label: string }>('/api/v1/platform/mail-preview', { kind: preview! }) });
  const save = () => { if (!v) return; setErr(null); api.put('/api/v1/platform/mail-settings', { notify: v.notify.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean), reply_to: v.reply_to.trim() || null, from: v.from.trim() })
    .then(() => { toast('บันทึกค่าตั้งอีเมลแล้ว'); onClose(); }).catch(setErr); };
  useHotkeys({ F9: save, 'Ctrl+S': save }, [v]);
  return (
    <Modal title="ตั้งค่าอีเมลแจ้งเตือน" size="wide" onClose={onClose} footer={<><button onClick={onClose}>ยกเลิก</button><button className="primary" onClick={save} disabled={!v}>บันทึก <kbd>F9</kbd></button></>}>
      <ErrorBox error={err ?? q.error} />
      {q.data && <p className={q.data.sending ? 'notebox ok-box' : 'notebox warn'}>ตัวส่งอีเมล: <b>{q.data.note}</b></p>}
      {v && <div className="form-grid">
        <Field label="อีเมลรับแจ้งเตือนใบสมัคร" wide hint="ผู้ให้บริการที่จะได้รับอีเมลเมื่อมีผู้สมัครใหม่ — หลายอีเมลคั่นด้วยจุลภาค · ว่าง = ไม่ส่ง"><input value={v.notify} placeholder="เช่น owner@example.com, staff@example.com" onChange={(e) => setF({ ...v, notify: e.target.value })} /></Field>
        <Field label="ตอบกลับที่ (Reply-To)" hint="ผู้สมัครกดตอบกลับแล้วถึงอีเมลนี้ · ว่าง = ไม่ตั้ง"><input value={v.reply_to} onChange={(e) => setF({ ...v, reply_to: e.target.value })} /></Field>
        <Field label="ผู้ส่ง (From)" hint="ต้องเป็นอีเมลของโดเมนที่ตั้งส่งอีเมลไว้ (…@worktruesolution.net)"><input value={v.from} onChange={(e) => setF({ ...v, from: e.target.value })} /></Field>
      </div>}
      <h3>ตัวอย่างอีเมล (ข้อมูลสมมุติ)</h3>
      <div className="toolbar">{(Object.keys(MAIL_LABEL) as MailKind[]).map((k) => <button key={k} type="button" className={preview === k ? 'primary' : ''} onClick={() => setPreview(k)}>{MAIL_LABEL[k]}</button>)}</div>
      {pv.data && <div className="mail-preview"><div className="small"><b>หัวเรื่อง:</b> {pv.data.subject}</div><iframe title="ตัวอย่างอีเมล" sandbox="" srcDoc={pv.data.html} /></div>}
    </Modal>
  );
}

function ApproveForm({ r, onClose, onDone }: { r: Row; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ code: '', expires_on: '', first_company: true, fiscal_start: `${new Date().getFullYear()}-01-01`, starter: r.business_template || 'TRADE' });
  const [pk, setPk] = useState(() => packageValues(null));
  const [err, setErr] = useState<unknown>(null);
  const go = async () => {
    setErr(null);
    try {
      const x = await api.post<{ code: string; company_code: string | null }>(`/api/v1/signups/${r.id}/approve`, { code: f.code || undefined, ...packageBody(pk), expires_on: f.expires_on || null,
        first_company: f.first_company, fiscal_start: f.first_company ? f.fiscal_start || undefined : undefined, starter: f.first_company ? f.starter : undefined });
      toast(`อนุมัติแล้ว — สร้างลูกค้า ${x.code}${x.company_code ? ` และบริษัท ${x.company_code}` : ''} · แจ้งผู้สมัครให้เข้าระบบด้วยรหัส ${r.username}`); onDone();
    } catch (e) { setErr(e); }
  };
  return (
    <Modal title={`อนุมัติใบสมัคร: ${r.business_name}`} onClose={onClose} footer={<><button onClick={onClose}>ยกเลิก</button><button className="primary" onClick={go}>อนุมัติและเปิดบัญชี</button></>}>
      <ErrorBox error={err} />
      <p className="hint">สร้างลูกค้าผู้ใช้บริการ + ผู้ดูแลคนแรก <b className="mono">{r.username}</b> (รหัสผ่านที่ผู้สมัครตั้งไว้) + บริษัทแรกชื่อ <b>{r.business_name}</b>{r.tax_id && <> เลขผู้เสียภาษี <span className="mono">{r.tax_id}</span></>} พร้อมผังบัญชีมาตรฐาน ประเภทเอกสาร และรอบบัญชี — ผู้สมัครเข้าระบบแล้วเริ่มคีย์เอกสารได้ทันที</p>
      <div className="form-grid">
        <Field label="รหัสลูกค้า" hint="ว่าง = ตั้งจากรหัสผู้ใช้"><input className="mono" maxLength={20} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
        <PackageFields value={pk} onChange={setPk} />
        <Field label="หมดอายุ" hint="ว่าง = ไม่หมดอายุ (เช่น ทดลองใช้ 30 วัน)"><DateInput value={f.expires_on} onChange={(v) => setF({ ...f, expires_on: v ?? '' })} /></Field>
        <Field label="บริษัทแรก" wide><label className="inline chk"><input type="checkbox" checked={f.first_company} onChange={(e) => setF({ ...f, first_company: e.target.checked })} /> สร้างบริษัทแรกให้อัตโนมัติ (ผังบัญชีมาตรฐาน)</label></Field>
        {f.first_company && <Field label="รอบบัญชีเริ่ม" hint="ปกติ 1 ม.ค. ของปีนี้ · ปีถัดไปเพิ่มได้ที่ รอบบัญชี"><DateInput value={f.fiscal_start} onChange={(v) => setF({ ...f, fiscal_start: v ?? '' })} /></Field>}
        {f.first_company && <Field label="ประเภทธุรกิจ (ข้อมูลตั้งต้น)" hint={`ผู้สมัครเลือก: ${r.business_template ? STARTER_TEMPLATES.find((t) => t.key === r.business_template)?.th ?? r.business_template : '— (ใช้ ซื้อมาขายไป)'}`}><StarterSelect value={f.starter} onChange={(v) => setF({ ...f, starter: v })} /></Field>}
      </div>
    </Modal>
  );
}

function RejectForm({ r, onClose, onDone }: { r: Row; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const go = async () => { setErr(null); try { await api.post(`/api/v1/signups/${r.id}/reject`, { reason }); toast('บันทึกไม่อนุมัติแล้ว'); onDone(); } catch (e) { setErr(e); } };
  return (
    <Modal title={`ไม่อนุมัติ: ${r.business_name}`} onClose={onClose} footer={<><button onClick={onClose}>ยกเลิก</button><button className="danger" onClick={go}>ไม่อนุมัติ</button></>}>
      <ErrorBox error={err} />
      <Field label="เหตุผล" req hint="แจ้งผู้สมัครทางอีเมล/โทรศัพท์เอง · ข้อมูลติดต่อถูกล้างเมื่อครบ 90 วัน"><input autoFocus maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </Modal>
  );
}
