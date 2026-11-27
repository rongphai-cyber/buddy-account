import { useState } from 'react';
import { StarterSelect } from '../../components/StarterFill';
import { packageBody, PackageFields, packageValues } from '../../components/PackageFields';
import { STARTER_TEMPLATES } from '@buddy/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { Confirm, DateInput, DateText, ErrorBox, Field, Modal, Pill, toast, toastError, useHotkeys } from '../../ui';

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
/** สถานะการรับสมัคร (HANDOFF 189) — จาก GET /api/v1/platform/signup-settings */
type SignupState = { env: 'off' | 'review' | 'auto'; locked: boolean; open: boolean; max_pending: number | null; closed_message: string | null; pending: number; full: boolean; mode: 'off' | 'review' | 'auto' };
type SignupSave = { open: boolean; max_pending: number | null; closed_message: string | null };

/**
 * เปิด/ปิดรับสมัครจากหน้าจอ (HANDOFF 189 เจ้าของ "ช่วงทดลอง ... ไม่ให้ลูกค้าทดลองจริงมากเกินไป") — มีผลทันที ไม่ต้อง deploy
 * ปิด = ยืนยันก่อน + ใส่ข้อความหน้าปิดรับสมัครได้ · ตั้งจำนวนใบรออนุมัติสูงสุด (ครบแล้วปิดเอง) · ปิดที่เซิร์ฟเวอร์ (BUDDY_SIGNUP=off) = เปิดจากหน้าจอไม่ได้
 */
function SignupOpenBar() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['signup-settings'], queryFn: () => api.get<SignupState>('/api/v1/platform/signup-settings') });
  const [closing, setClosing] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const save = (s: SignupState, body: Partial<SignupSave>) => api.put<SignupState>('/api/v1/platform/signup-settings', { open: s.open, max_pending: s.max_pending, closed_message: s.closed_message, ...body })
    .then((x) => { qc.setQueryData(['signup-settings'], x); qc.invalidateQueries({ queryKey: ['signups'] }); toast(x.mode === 'off' ? 'ปิดรับสมัครแล้ว — หน้าสมัครแสดงว่าปิดรับสมัคร' : 'เปิดรับสมัครแล้ว'); return x; });
  if (!q.data) return <ErrorBox error={q.error} />;
  const s = q.data;
  const [label, tone]: [string, 'm' | 'd' | 'c'] = s.locked ? ['ปิดรับสมัคร (ล็อกที่การตั้งค่าระบบ)', 'c'] : !s.open ? ['ปิดรับสมัคร', 'c'] : s.full ? ['ปิดชั่วคราว — ใบรออนุมัติครบจำนวน', 'd'] : ['เปิดรับสมัคร', 'm'];
  return (
    <div className="su-open" role="group" aria-label="การรับสมัครใช้งาน">
      <span>การรับสมัคร: <Pill tone={tone}>{label}</Pill></span>
      {s.mode !== 'off' && <span className="small muted">{s.env === 'auto' ? 'สมัครแล้วเปิดบัญชีให้ทันที' : 'ผู้ให้บริการอนุมัติก่อนเข้าใช้'}</span>}
      {s.max_pending !== null && <span className="small muted">รออนุมัติ {s.pending} / {s.max_pending} ใบ</span>}
      {s.locked ? <span className="small muted">ปิดไว้ที่การตั้งค่าเซิร์ฟเวอร์ — เปิดจากหน้าจอนี้ไม่ได้</span>
        : s.open ? <button type="button" className="danger" onClick={() => setClosing(s.closed_message ?? '')}>ปิดรับสมัคร…</button>
        : <button type="button" className="primary" onClick={() => save(s, { open: true }).catch(toastError)}>เปิดรับสมัคร</button>}
      <button type="button" className="linklike" onClick={() => setEdit(true)}>ตั้งค่าการรับสมัคร</button>
      {closing !== null && <Confirm title="ปิดรับสมัครใช้งาน" danger okText="ปิดรับสมัคร"
        text="หน้าสมัครจะแสดงว่าปิดรับสมัคร และส่งใบสมัครใหม่ไม่ได้ — ใบที่รออนุมัติอยู่ยังพิจารณาได้ตามปกติ · กดเปิดรับสมัครได้ทุกเมื่อ"
        onOk={() => save(s, { open: false, closed_message: closing.trim() || null }).then(() => setClosing(null)).catch(toastError)} onClose={() => setClosing(null)}>
        <Field label="ข้อความบนหน้าปิดรับสมัคร (ไม่บังคับ)" hint="ว่าง = ข้อความมาตรฐาน ติดต่อผู้ให้บริการเพื่อเปิดบัญชี"><textarea rows={2} maxLength={300} value={closing} placeholder="เช่น ขณะนี้ปิดรับสมัครชั่วคราว ติดต่อ 08x-xxx-xxxx" onChange={(e) => setClosing(e.target.value)} /></Field>
      </Confirm>}
      {edit && <SignupSettings s={s} onClose={() => setEdit(false)} save={(b) => save(s, b).then(() => setEdit(false))} />}
    </div>
  );
}

/** ตั้งค่าการรับสมัคร: เปิด/ปิด · รับใบรออนุมัติสูงสุด · ข้อความหน้าปิดรับสมัคร */
function SignupSettings({ s, onClose, save }: { s: SignupState; onClose: () => void; save: (b: SignupSave) => Promise<void> }) {
  const [f, setF] = useState({ open: s.open, max: s.max_pending === null ? '' : String(s.max_pending), msg: s.closed_message ?? '' });
  const [err, setErr] = useState<unknown>(null);
  const [ask, setAsk] = useState(false);
  const body = (): SignupSave | null => {
    const m = f.max.trim();
    if (m && !/^\d+$/.test(m)) { setErr(new Error('จำนวนใบสมัครสูงสุดต้องเป็นตัวเลข — ไม่จำกัดให้เว้นว่าง')); return null; }
    return { open: f.open, max_pending: m ? Number(m) : null, closed_message: f.msg.trim() || null };
  };
  const go = () => { setErr(null); const b = body(); if (!b) return; if (s.open && !b.open) { setAsk(true); return; } save(b).catch(setErr); };
  useHotkeys({ F9: go, 'Ctrl+S': go }, [f]);
  return (
    <Modal title="ตั้งค่าการรับสมัคร" onClose={onClose} footer={<><button onClick={onClose}>ยกเลิก</button><button className="primary" onClick={go}>บันทึก <kbd>F9</kbd></button></>}>
      <ErrorBox error={err} />
      {s.locked && <p className="notebox warn">ระบบปิดรับสมัครไว้ที่การตั้งค่าเซิร์ฟเวอร์ — เปิดจากหน้าจอนี้ไม่ได้ (ตั้งข้อความและจำนวนไว้ล่วงหน้าได้)</p>}
      <div className="form-grid">
        <Field label="การรับสมัคร" wide>
          <div className="radio-row">
            <label><input type="radio" name="su-open" checked={f.open} disabled={s.locked} onChange={() => setF({ ...f, open: true })} /> เปิดรับสมัคร (ผู้ให้บริการอนุมัติก่อน)</label>
            <label><input type="radio" name="su-open" checked={!f.open} onChange={() => setF({ ...f, open: false })} /> ปิดรับสมัคร</label>
          </div>
        </Field>
        <Field label="รับใบสมัครที่รออนุมัติได้สูงสุด (ใบ)" hint="ครบจำนวนแล้วหน้าสมัครปิดเอง จนกว่าจะพิจารณาใบที่รออยู่ · ว่าง = ไม่จำกัด"><input inputMode="numeric" value={f.max} placeholder="ไม่จำกัด" onChange={(e) => setF({ ...f, max: e.target.value })} /></Field>
        <Field label="ข้อความบนหน้าปิดรับสมัคร" wide hint="ไม่บังคับ — ว่าง = ข้อความมาตรฐาน ติดต่อผู้ให้บริการเพื่อเปิดบัญชี"><textarea rows={2} maxLength={300} value={f.msg} placeholder="เช่น ขณะนี้ปิดรับสมัครชั่วคราว ติดต่อ 08x-xxx-xxxx" onChange={(e) => setF({ ...f, msg: e.target.value })} /></Field>
      </div>
      <p className="small muted">ใบสมัครที่รออนุมัติขณะนี้ {s.pending} ใบ</p>
      {ask && <Confirm title="ปิดรับสมัครใช้งาน" danger okText="ปิดรับสมัคร" text="หน้าสมัครจะแสดงว่าปิดรับสมัคร และส่งใบสมัครใหม่ไม่ได้ — ใบที่รออนุมัติอยู่ยังพิจารณาได้ตามปกติ"
        onOk={() => { setAsk(false); const b = body(); if (b) save(b).catch(setErr); }} onClose={() => setAsk(false)} />}
    </Modal>
  );
}

/** ใบสมัครใช้งานจากหน้าสมัครเอง — เจ้าหน้าที่ผู้ให้บริการอนุมัติ (สร้างลูกค้า + ผู้ดูแลคนแรก) หรือไม่อนุมัติ */
export function SignupsPanel({ onApproved }: { onApproved: () => void }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'P' | 'A' | 'R' | 'all'>('P');
  const q = useQuery({ queryKey: ['signups', status], queryFn: () => api.get<{ mode: 'off' | 'review' | 'auto'; rows: Row[]; notify_set?: boolean }>('/api/v1/signups', { status }) });
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
        <span className="muted small">ลิงก์หน้าสมัคร: <span className="mono">{location.origin}/signup</span></span>
        <button type="button" onClick={() => setMailSet(true)}>✉ ตั้งค่าอีเมลแจ้งเตือน</button>
      </div>
      <SignupOpenBar />
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

type MailSettingsData = { notify: string[]; alert_notify: string[]; reply_to: string | null; from: string; driver: string; sending: boolean; note: string };
/** ค่าตั้งอีเมลของผู้ให้บริการ (HANDOFF 187): ผู้รับแจ้งเตือนใบสมัคร · Reply-To · ผู้ส่ง · ดูตัวอย่างอีเมล */
function MailSettings({ onClose }: { onClose: () => void }) {
  const q = useQuery({ queryKey: ['mail-settings'], queryFn: () => api.get<MailSettingsData>('/api/v1/platform/mail-settings') });
  const [f, setF] = useState<{ notify: string; alert_notify: string; reply_to: string; from: string } | null>(null);
  const v = f ?? (q.data ? { notify: q.data.notify.join(', '), alert_notify: (q.data.alert_notify ?? []).join(', '), reply_to: q.data.reply_to ?? '', from: q.data.from } : null);
  const [err, setErr] = useState<unknown>(null);
  const [preview, setPreview] = useState<MailKind | null>(null);
  const pv = useQuery({ enabled: !!preview, queryKey: ['mail-preview', preview], queryFn: () => api.get<{ subject: string; html: string; label: string }>('/api/v1/platform/mail-preview', { kind: preview! }) });
  const save = () => { if (!v) return; setErr(null); api.put('/api/v1/platform/mail-settings', { notify: v.notify.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean), alert_notify: v.alert_notify.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean), reply_to: v.reply_to.trim() || null, from: v.from.trim() })
    .then(() => { toast('บันทึกค่าตั้งอีเมลแล้ว'); onClose(); }).catch(setErr); };
  useHotkeys({ F9: save, 'Ctrl+S': save }, [v]);
  return (
    <Modal title="ตั้งค่าอีเมลแจ้งเตือน" size="wide" onClose={onClose} footer={<><button onClick={onClose}>ยกเลิก</button><button className="primary" onClick={save} disabled={!v}>บันทึก <kbd>F9</kbd></button></>}>
      <ErrorBox error={err ?? q.error} />
      {q.data && <p className={q.data.sending ? 'notebox ok-box' : 'notebox warn'}>ตัวส่งอีเมล: <b>{q.data.note}</b></p>}
      {v && <div className="form-grid">
        <Field label="อีเมลรับแจ้งเตือนใบสมัคร" wide hint="ผู้ให้บริการที่จะได้รับอีเมลเมื่อมีผู้สมัครใหม่ — หลายอีเมลคั่นด้วยจุลภาค · ว่าง = ไม่ส่ง"><input value={v.notify} placeholder="เช่น owner@example.com, staff@example.com" onChange={(e) => setF({ ...v, notify: e.target.value })} /></Field>
        {/* HANDOFF 207: ผู้รับแจ้งเตือนการใช้งานผิดปกติของเจ้าหน้าที่ผู้ให้บริการ */}
        <Field label="อีเมลรับแจ้งเตือนการใช้งานผิดปกติ" wide hint="เมื่อบัญชีเจ้าหน้าที่ผู้ให้บริการพยายามเปิดข้อมูลของลูกค้าจริงซ้ำ ๆ ใส่รหัสผิดซ้ำ ๆ หรือทำรายการที่ศูนย์ผู้ให้บริการถี่ผิดปกติ — หลายอีเมลคั่นด้วยจุลภาค · ว่าง = ใช้อีเมลรับแจ้งเตือนใบสมัคร · ไม่ส่งถึงลูกค้า"><input value={v.alert_notify} placeholder="เช่น owner@example.com" onChange={(e) => setF({ ...v, alert_notify: e.target.value })} /></Field>
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
