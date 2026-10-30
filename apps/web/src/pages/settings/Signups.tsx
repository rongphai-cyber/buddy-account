import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { DateInput, DateText, ErrorBox, Field, Modal, Pill, toast } from '../../ui';

type Row = { id: string; business_name: string; contact_name: string; contact_email: string; contact_phone: string; username: string; status: 'P' | 'A' | 'R'; created_at: string;
  decided_at: string | null; reject_reason: string | null; client_ip: string | null; tenant_code: string | null; decided_by_name: string | null };
const ST: Record<string, [string, 'n' | 'd' | 'x']> = { P: ['รออนุมัติ', 'd'], A: ['อนุมัติแล้ว', 'n'], R: ['ไม่อนุมัติ', 'x'] };
const MODE_TH = { review: 'ผู้ให้บริการอนุมัติก่อน', auto: 'เปิดบัญชีทันที (อนุมัติอัตโนมัติ)', off: 'ปิดรับสมัคร' };

/** ใบสมัครใช้งานจากหน้าสมัครเอง — เจ้าหน้าที่ผู้ให้บริการอนุมัติ (สร้างลูกค้า + ผู้ดูแลคนแรก) หรือไม่อนุมัติ */
export function SignupsPanel({ onApproved }: { onApproved: () => void }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'P' | 'A' | 'R' | 'all'>('P');
  const q = useQuery({ queryKey: ['signups', status], queryFn: () => api.get<{ mode: keyof typeof MODE_TH; rows: Row[] }>('/api/v1/signups', { status }) });
  const [approve, setApprove] = useState<Row | null>(null);
  const [reject, setReject] = useState<Row | null>(null);
  const reload = () => { qc.invalidateQueries({ queryKey: ['signups'] }); };
  return (
    <div className="card su-panel">
      <div className="su-head">
        <h2>ใบสมัครใช้งาน</h2>
        <select value={status} onChange={(e) => setStatus(e.target.value as 'P')} aria-label="สถานะใบสมัคร"><option value="P">รออนุมัติ</option><option value="A">อนุมัติแล้ว</option><option value="R">ไม่อนุมัติ</option><option value="all">ทั้งหมด</option></select>
        {q.data && <span className="muted small">หน้าสมัคร: <b>{MODE_TH[q.data.mode]}</b> (ตั้งด้วย BUDDY_SIGNUP = review / auto / off) · ลิงก์สมัคร: <span className="mono">{location.origin}/signup</span></span>}
      </div>
      <ErrorBox error={q.error} />
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th style={{ width: 110 }}>วันที่สมัคร</th><th>กิจการ</th><th>ผู้ติดต่อ</th><th style={{ width: 130 }}>รหัสผู้ใช้</th><th style={{ width: 110 }}>สถานะ</th><th style={{ width: 200 }} /></tr></thead>
          <tbody>
            {q.data?.rows.map((r) => <tr key={r.id}>
              <td><DateText v={r.created_at.slice(0, 10)} /></td><td>{r.business_name}</td>
              <td className="small">{r.contact_name}<br />{r.contact_email} · {r.contact_phone}</td><td className="mono">{r.username}</td>
              <td><Pill tone={ST[r.status]![1]}>{ST[r.status]![0]}</Pill>{r.tenant_code && <div className="small mono">{r.tenant_code}</div>}{r.reject_reason && <div className="small muted">{r.reject_reason}</div>}</td>
              <td>{r.status === 'P' && <><button className="primary" onClick={() => setApprove(r)}>อนุมัติ…</button> <button onClick={() => setReject(r)}>ไม่อนุมัติ…</button></>}</td>
            </tr>)}
            {q.data && !q.data.rows.length && <tr><td colSpan={6} className="empty">{status === 'P' ? 'ไม่มีใบสมัครที่รออนุมัติ' : 'ไม่มีใบสมัคร'}</td></tr>}
          </tbody>
        </table>
      </div>
      {approve && <ApproveForm r={approve} onClose={() => setApprove(null)} onDone={() => { setApprove(null); reload(); onApproved(); }} />}
      {reject && <RejectForm r={reject} onClose={() => setReject(null)} onDone={() => { setReject(null); reload(); }} />}
    </div>
  );
}

function ApproveForm({ r, onClose, onDone }: { r: Row; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ code: '', plan: 'standard', max_companies: '', max_users: '', expires_on: '' });
  const [err, setErr] = useState<unknown>(null);
  const go = async () => {
    setErr(null);
    try {
      const x = await api.post<{ code: string }>(`/api/v1/signups/${r.id}/approve`, { code: f.code || undefined, plan: f.plan, max_companies: f.max_companies ? Number(f.max_companies) : null, max_users: f.max_users ? Number(f.max_users) : null, expires_on: f.expires_on || null });
      toast(`อนุมัติแล้ว — สร้างลูกค้า ${x.code} · แจ้งผู้สมัครให้เข้าระบบด้วยรหัส ${r.username}`); onDone();
    } catch (e) { setErr(e); }
  };
  return (
    <Modal title={`อนุมัติใบสมัคร: ${r.business_name}`} onClose={onClose} footer={<><button onClick={onClose}>ยกเลิก</button><button className="primary" onClick={go}>อนุมัติและเปิดบัญชี</button></>}>
      <ErrorBox error={err} />
      <p className="hint">สร้างลูกค้าผู้ใช้บริการ + ผู้ดูแลคนแรก <b className="mono">{r.username}</b> (รหัสผ่านที่ผู้สมัครตั้งไว้) — ผู้สมัครสร้างบริษัทแรกเองหลังเข้าระบบ</p>
      <div className="form-grid">
        <Field label="รหัสลูกค้า" hint="ว่าง = ตั้งจากรหัสผู้ใช้"><input className="mono" maxLength={20} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
        <Field label="แพ็กเกจ"><input maxLength={20} value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })} /></Field>
        <Field label="บริษัทสูงสุด" hint="ว่าง = ไม่จำกัด"><input inputMode="numeric" value={f.max_companies} onChange={(e) => setF({ ...f, max_companies: e.target.value.replace(/\D/g, '') })} /></Field>
        <Field label="ผู้ใช้สูงสุด" hint="ว่าง = ไม่จำกัด"><input inputMode="numeric" value={f.max_users} onChange={(e) => setF({ ...f, max_users: e.target.value.replace(/\D/g, '') })} /></Field>
        <Field label="หมดอายุ" hint="ว่าง = ไม่หมดอายุ (เช่น ทดลองใช้ 30 วัน)"><DateInput value={f.expires_on} onChange={(v) => setF({ ...f, expires_on: v ?? '' })} /></Field>
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
