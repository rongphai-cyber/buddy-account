import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { useCan, useSession } from '../../session';
import { cx, ErrorBox, Field, Modal, PageHead, Pill, toast, toastError, useHotkeys } from '../../ui';

/**
 * T7.8 ออฟไลน์สาขา
 * DevicesPage (สำนักงานใหญ่) = เพิ่ม/ระงับเครื่องสาขา ออกรหัสตั้งเครื่อง ดูช่วงเลขที่และเอกสารที่ส่งไม่ผ่าน
 * SyncPage + SyncBadge (เครื่องสาขา) = สถานะซิงก์ เอกสารรอส่ง ส่งใหม่/ยกเลิกเอกสารที่สำนักงานใหญ่ไม่รับ
 */
type Device = { id: string; code: string; name: string; status: string; last_sync_at: string | null; branch_code: string; branch_name: string; conflicts: number; applied: number; blocks: Array<{ code: string; left: number }> };
type Branch = { id: string; code: string; name: string };
type Conflict = { id: string; reason: string; created_at: string; client_payload: { label?: string; doc_no?: string | null; message?: string } };
type Status = {
  mode: 'central' | 'branch'; device_code?: string; central_url?: string; last_sync_at?: string | null; last_ok_at?: string | null; last_error?: string | null; pending?: number;
  queue?: Array<{ id: string; status: string; label: string; doc_no: string | null; last_error: string | null; created_at: string }>; blocks?: Array<{ code: string; left: number }>;
  recent?: Array<{ id: string; label: string; doc_no: string | null; created_at: string }>; actions?: string[];
};
const REASON_TH: Record<string, string> = { PERIOD_LOCKED: 'งวดปิดแล้ว', DUPLICATE_NO: 'เลขที่ซ้ำ', PERMISSION: 'ไม่มีสิทธิ์', SYNC_REPLAY_MISMATCH: 'ข้อมูลสองเครื่องต่างกัน' };
const timeText = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '—';

export function DevicesPage() {
  const can = useCan('SET.DEVICE');
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['devices'], queryFn: () => api.get<Device[]>('/api/v1/devices') });
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState<{ device: string; code: string } | null>(null);
  const [conf, setConf] = useState<Device | null>(null);
  const [err, setErr] = useState<unknown>(null);
  useHotkeys({ Insert: can('add') ? () => setAdding(true) : undefined }, []);
  const act = (d: Device, what: 'new-code' | 'suspend') => api.post<{ setup_code?: string }>(`/api/v1/devices/${d.id}/${what}`, {})
    .then((r) => { if (r.setup_code) setCode({ device: d.code, code: r.setup_code }); else toast(`ระงับเครื่อง ${d.code} แล้ว`); qc.invalidateQueries({ queryKey: ['devices'] }); }).catch(setErr);
  return (
    <div className="page" data-tone="settings">
      <PageHead eyebrow="เริ่มระบบ › ความปลอดภัย" title="เครื่องสาขา (ออฟไลน์)"
        lead={<>เครื่องที่สาขาออกเอกสารได้แม้อินเทอร์เน็ตดับ แล้วส่งเข้าสำนักงานใหญ่เอง — ติดตั้ง Buddy Account ที่สาขา หน้าแรกเลือก <b>เครื่องนี้เป็นเครื่องสาขา</b> แล้วใส่ที่อยู่นี้ ({window.location.origin}) กับรหัสตั้งเครื่อง</>}
        actions={can('add') && <button className="primary" onClick={() => setAdding(true)}>+ เพิ่มเครื่องสาขา <kbd>Ins</kbd></button>} />
      <ErrorBox error={err ?? q.error} />
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th style={{ width: 90 }}>รหัส</th><th>ชื่อเครื่อง</th><th>สาขา</th><th style={{ width: 150 }}>ซิงก์ล่าสุด</th><th className="r" style={{ width: 90 }}>รับแล้ว</th><th>เลขที่เหลือ</th><th style={{ width: 110 }}>ไม่ผ่าน</th><th style={{ width: 90 }}>สถานะ</th><th style={{ width: 200 }} /></tr></thead>
          <tbody>
            {q.data?.map((d) => (
              <tr key={d.id} className={cx(d.status !== 'A' && 'cancelled')}>
                <td className="mono">{d.code}</td><td>{d.name}</td><td>{d.branch_code} {d.branch_name}</td><td className="small">{timeText(d.last_sync_at)}</td>
                <td className="r">{d.applied.toLocaleString()}</td>
                <td className="small">{d.blocks.map((b) => `${b.code} ${b.left}`).join(' · ')}</td>
                <td>{d.conflicts ? <button className="link" onClick={() => setConf(d)}>{d.conflicts} เอกสาร</button> : <span className="muted">—</span>}</td>
                <td><Pill tone={d.status === 'A' ? 'n' : 'x'}>{d.status === 'A' ? 'ใช้งาน' : 'ระงับ'}</Pill></td>
                <td>{can('edit') && <button onClick={() => act(d, 'new-code')}>รหัสตั้งเครื่องใหม่</button>} {can('cancel') && d.status === 'A' && <button className="danger" onClick={() => act(d, 'suspend')}>ระงับ</button>}</td>
              </tr>
            ))}
            {q.data && !q.data.length && <tr><td colSpan={9} className="empty">ยังไม่มีเครื่องสาขา — กด Insert เพื่อเพิ่ม</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="hint">ระงับเครื่อง (เช่น เครื่องหาย): ส่ง/ดึงข้อมูลไม่ได้ทันที และเลขที่ที่จองไว้แต่ยังไม่ใช้ถูกยกเลิก · ออกรหัสใหม่: รหัสเดิมใช้ไม่ได้ ต้องตั้งเครื่องใหม่</p>
      {adding && <AddDevice onClose={() => setAdding(false)} onDone={(device, c) => { setAdding(false); setCode({ device, code: c }); qc.invalidateQueries({ queryKey: ['devices'] }); }} />}
      {code && <Modal size="confirm" title={`รหัสตั้งเครื่อง ${code.device}`} onClose={() => setCode(null)} footer={<button className="primary" onClick={() => setCode(null)}>จดแล้ว ปิด</button>}>
        <p>ใส่ที่เครื่องสาขาตอนตั้งค่าครั้งแรก — <b>แสดงครั้งเดียว</b> ถ้าหายให้ออกรหัสใหม่</p>
        <div className="mfa-secret" style={{ fontSize: 14, wordBreak: 'break-all' }}>{code.code}</div>
        <div className="mfa-links"><button type="button" onClick={() => navigator.clipboard?.writeText(code.code).then(() => toast('คัดลอกรหัสแล้ว'))}>คัดลอกรหัส</button></div>
        <p className="small muted">ที่อยู่สำนักงานใหญ่: {window.location.origin}</p>
      </Modal>}
      {conf && <ConflictList d={conf} onClose={() => setConf(null)} />}
    </div>
  );
}

function AddDevice({ onClose, onDone }: { onClose: () => void; onDone: (device: string, code: string) => void }) {
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api.get<Branch[]>('/api/v1/branches') });
  const [f, setF] = useState({ code: '', name: '', branch_id: '' });
  const [err, setErr] = useState<unknown>(null);
  const save = () => api.post<{ setup_code: string }>('/api/v1/devices', { ...f, branch_id: f.branch_id || branches.data?.[0]?.id }).then((r) => onDone(f.code.toUpperCase(), r.setup_code)).catch(setErr);
  useHotkeys({ F9: save, 'Ctrl+S': save }, [f, branches.data]);
  return (
    <Modal title="เพิ่มเครื่องสาขา" onClose={onClose} footer={<><button onClick={onClose}>ยกเลิก</button><button className="primary" onClick={save}>บันทึก <kbd>F9</kbd></button></>}>
      <ErrorBox error={err} />
      <div className="form-grid">
        <Field label="รหัสเครื่อง" hint="เช่น POS1 BR2 (ใช้ในรายงาน)" req><input autoFocus maxLength={10} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
        <Field label="สาขา" req><select value={f.branch_id || branches.data?.[0]?.id || ''} onChange={(e) => setF({ ...f, branch_id: e.target.value })}>{branches.data?.map((b) => <option key={b.id} value={b.id}>{b.code} {b.name}</option>)}</select></Field>
        <Field label="ชื่อเครื่อง" req wide><input maxLength={120} value={f.name} placeholder="เช่น เครื่องหน้าร้านสาขาเชียงใหม่" onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function ConflictList({ d, onClose }: { d: Device; onClose: () => void }) {
  const q = useQuery({ queryKey: ['device-conflicts', d.id], queryFn: () => api.get<Conflict[]>(`/api/v1/devices/${d.id}/conflicts`) });
  return (
    <Modal size="wide" title={`เอกสารจากเครื่อง ${d.code} ที่บันทึกไม่ผ่าน`} onClose={onClose} footer={<button onClick={onClose}>ปิด</button>}>
      <ErrorBox error={q.error} />
      <p className="small muted">แก้สาเหตุที่สำนักงานใหญ่ (เช่น เปิดงวด) แล้วให้สาขากด "ส่งใหม่" — หรือผู้ดูแลที่สาขายกเลิกเอกสารนั้น</p>
      <table className="grid" style={{ width: '100%' }}><thead><tr><th style={{ width: 150 }}>เวลา</th><th>เอกสาร</th><th style={{ width: 150 }}>สาเหตุ</th><th>ข้อความ</th></tr></thead>
        <tbody>{q.data?.map((c) => <tr key={c.id}><td className="small">{timeText(c.created_at)}</td><td>{c.client_payload.label} <span className="mono">{c.client_payload.doc_no}</span></td>
          <td>{REASON_TH[c.reason] ?? c.reason}</td><td className="small">{c.client_payload.message}</td></tr>)}</tbody></table>
    </Modal>
  );
}

/** แถบด้านบน (เครื่องสาขาเท่านั้น): ซิงก์ล่าสุด + เอกสารรอส่ง — คลิกไปหน้าซิงก์ */
export function SyncBadge() {
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['sync-status'], queryFn: () => api.get<Status>('/api/v1/sync/status'), refetchInterval: 30_000 });
  const s = q.data;
  if (!s || s.mode !== 'branch') return null;
  const bad = !!s.queue?.some((x) => x.status === 'CONFLICT');
  const off = !!s.last_error && !bad;
  return (
    <button className={cx('period', 'sync-badge', bad && 'bad', off && 'off')} onClick={() => nav('/sync')} title={s.last_error ?? 'ซิงก์กับสำนักงานใหญ่แล้ว'}>
      {bad ? '⚠ ส่งไม่ผ่าน' : off ? '⚡ ออฟไลน์' : '✓ ออนไลน์'} · {s.device_code}{s.pending ? ` · รอส่ง ${s.pending}` : ''}
    </button>
  );
}

export function SyncPage() {
  const { me } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['sync-status'], queryFn: () => api.get<Status>('/api/v1/sync/status'), refetchInterval: 10_000 });
  const [busy, setBusy] = useState(false);
  const reload = () => qc.invalidateQueries({ queryKey: ['sync-status'] });
  const now = () => { setBusy(true); api.post('/api/v1/sync/now', {}).then(() => { reload(); toast('ซิงก์แล้ว'); }).catch(toastError).finally(() => setBusy(false)); };
  const act = (id: string, what: 'retry' | 'discard') => api.post(`/api/v1/sync/outbox/${id}/${what}`, {}).then(() => { reload(); toast(what === 'retry' ? 'ส่งใหม่แล้ว' : 'ยกเลิกเอกสารนี้ที่เครื่องสาขาแล้ว'); }).catch(toastError);
  const s = q.data;
  if (s && s.mode !== 'branch') return <div className="page"><div className="notebox">เครื่องนี้เป็นเครื่องหลัก (สำนักงานใหญ่) — ดูเครื่องสาขาที่ เริ่มระบบ › เครื่องสาขา (ออฟไลน์)</div></div>;
  return (
    <div className="page" data-tone="settings">
      <PageHead eyebrow="เครื่องสาขา" title={`ซิงก์กับสำนักงานใหญ่ · ${s?.device_code ?? ''}`}
        lead={<>เครื่องนี้บันทึกได้: {s?.actions?.join(' · ')} — งานอื่นทำที่สำนักงานใหญ่ <a href={s?.central_url} target="_blank" rel="noreferrer">{s?.central_url}</a></>}
        actions={<button className="primary" disabled={busy} onClick={now}>{busy ? 'กำลังซิงก์…' : '⟳ ซิงก์ตอนนี้'}</button>} />
      <ErrorBox error={q.error} />
      {s && <>
        <div className={cx('notebox', !s.last_error && 'ok')}>
          {s.last_error ? <>ซิงก์ครั้งล่าสุดไม่สำเร็จ: {s.last_error}</> : <>ซิงก์สำเร็จล่าสุด {timeText(s.last_ok_at)}</>} · ลองล่าสุด {timeText(s.last_sync_at)} · เอกสารรอส่ง {s.pending ?? 0}
        </div>
        <h3>เอกสารรอส่ง</h3>
        <table className="grid" style={{ width: '100%' }}><thead><tr><th style={{ width: 150 }}>บันทึกเมื่อ</th><th>เอกสาร</th><th style={{ width: 120 }}>สถานะ</th><th>ข้อความจากสำนักงานใหญ่</th><th style={{ width: 230 }} /></tr></thead>
          <tbody>
            {s.queue?.map((x) => <tr key={x.id}><td className="small">{timeText(x.created_at)}</td><td>{x.label} <span className="mono">{x.doc_no}</span></td>
              <td><Pill tone={x.status === 'CONFLICT' ? 'x' : 'd'}>{x.status === 'CONFLICT' ? 'ไม่ผ่าน' : 'รอส่ง'}</Pill></td><td className="small">{x.last_error}</td>
              <td>{x.status === 'CONFLICT' && <><button onClick={() => act(x.id, 'retry')}>ส่งใหม่</button> {me?.user.is_admin && <button className="danger" onClick={() => act(x.id, 'discard')}>ยกเลิกเอกสารนี้</button>}</>}</td></tr>)}
            {!s.queue?.length && <tr><td colSpan={5} className="empty">ไม่มีเอกสารรอส่ง</td></tr>}
          </tbody></table>
        <p className="hint">เอกสารที่สำนักงานใหญ่ไม่รับ: เอกสารถัดไปจะรอจนกว่าจะแก้ — แก้สาเหตุที่สำนักงานใหญ่ (เช่น เปิดงวด) แล้วกด "ส่งใหม่" หรือผู้ดูแลกด "ยกเลิกเอกสารนี้" (ลบที่เครื่องสาขา เลขที่นั้นไม่ถูกใช้)</p>
        <h3>เลขที่เอกสารที่จองไว้คงเหลือ</h3>
        <p>{s.blocks?.map((b) => <span key={b.code} className="pill" style={{ marginRight: 6 }}>{b.code} {b.left}</span>)}</p>
        <h3>ส่งเข้าสำนักงานใหญ่แล้วล่าสุด</h3>
        <table className="grid" style={{ width: '100%' }}><tbody>{s.recent?.map((x) => <tr key={String(x.id)}><td className="small" style={{ width: 150 }}>{timeText(x.created_at)}</td><td>{x.label} <span className="mono">{x.doc_no}</span></td></tr>)}</tbody></table>
      </>}
      <p className="small muted">ไม่มีอินเทอร์เน็ตก็บันทึกต่อได้ตามปกติ ระบบส่งเอกสารเองทุก 30 วินาทีเมื่อเชื่อมต่อได้</p>
    </div>
  );
}
