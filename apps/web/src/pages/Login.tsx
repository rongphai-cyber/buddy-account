import { useState } from 'react';
import { api, ApiError } from '../api';
import { useSession } from '../session';
import { PASSWORD_RULE } from '@buddy/core';
import { ErrorBox, Field, navKey } from '../ui';
import { useNavigate } from 'react-router-dom';
import { useSignupMode } from './Signup';

export function LoginPage() {
  const { refresh } = useSession();
  const signup = useSignupMode();
  const nav = useNavigate();
  const [f, setF] = useState({ username: '', password: '' });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [ticket, setTicket] = useState<string | null>(null); // เปิดยืนยันตัวตนสองขั้น → ขั้นที่ 2
  const [code, setCode] = useState('');
  const go = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.post<{ need_totp?: boolean; ticket?: string }>('/api/v1/auth/login', { ...f, work_date: new Date().toISOString().slice(0, 10) });
      if (r.need_totp && r.ticket) { setTicket(r.ticket); setCode(''); return; }
      await refresh();
    }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const go2 = async () => {
    setBusy(true); setErr(null);
    try { await api.post('/api/v1/auth/login/totp', { ticket, code }); await refresh(); }
    catch (e) { setErr(e); if (e instanceof ApiError && (e.code === 'MFA_EXPIRED' || e.status === 423)) setTicket(null); }
    finally { setBusy(false); }
  };
  if (ticket) return (
    <div className="login" data-tone="home">
      <form className="login-card" onSubmit={(e) => { e.preventDefault(); go2(); }}>
        <div className="login-brand"><b>ยืนยันตัวตนขั้นที่ 2</b><span>ป้อนรหัส 6 หลักจากแอปในมือถือ ({f.username})</span></div>
        <ErrorBox error={err} />
        <Field label="รหัสจากแอป หรือรหัสสำรอง" req><input autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={11} value={code} onChange={(e) => setCode(e.target.value)} /></Field>
        <button className="primary" type="submit" disabled={busy || !code.trim()}>{busy ? 'กำลังตรวจ…' : 'ยืนยัน'}</button>
        <button type="button" className="link" onClick={() => { setTicket(null); setErr(null); }}>กลับไปหน้าเข้าระบบ</button>
        <p className="hint">มือถือหาย: ใช้รหัสสำรองที่เก็บไว้ (เช่น abcde-12345) หรือให้ผู้ดูแลระบบล้างยืนยันตัวตนสองขั้นให้</p>
      </form>
    </div>
  );
  return (
    <div className="login" data-tone="home">
      <form className="login-card" onKeyDown={navKey} onSubmit={(e) => { e.preventDefault(); go(); }}>
        <div className="login-brand"><b>Buddy Account</b><span>โปรแกรมบัญชีสำหรับกิจการไทย</span></div>
        <ErrorBox error={err} />
        <Field label="รหัสผู้ใช้" req><input autoFocus autoComplete="username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></Field>
        <Field label="รหัสผ่าน" req><input type="password" autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} data-noenter onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), go())} /></Field>
        <button className="primary" type="submit" disabled={busy}>{busy ? 'กำลังเข้าระบบ…' : 'เข้าสู่ระบบ'}</button>
        <p className="hint">Enter ไปช่องถัดไป · ลืมรหัสผ่านให้ผู้ดูแลระบบตั้งรหัสใหม่ให้</p>
        {signup && signup !== 'off' && <button type="button" className="link" onClick={() => nav('/signup')}>ยังไม่มีบัญชี? สมัครใช้งาน</button>}
      </form>
    </div>
  );
}

export function SetupPage() {
  const { refresh } = useSession();
  const [f, setF] = useState({ username: 'admin', display_name: '', password: '', confirm: '' });
  const [err, setErr] = useState<unknown>(null);
  const [mode, setMode] = useState<'admin' | 'branch'>('admin');
  const go = async () => {
    setErr(null);
    if (f.password !== f.confirm) { setErr(new Error('ยืนยันรหัสผ่านไม่ตรงกัน')); return; }
    try { await api.post('/api/v1/setup', { username: f.username, display_name: f.display_name, password: f.password }); await refresh(); }
    catch (e) { setErr(e); }
  };
  if (mode === 'branch') return <BranchSetup onBack={() => setMode('admin')} />;
  return (
    <div className="login" data-tone="home">
      <form className="login-card" onKeyDown={navKey} onSubmit={(e) => { e.preventDefault(); go(); }}>
        <div className="login-brand"><b>ตั้งค่าครั้งแรก</b><span>สร้างผู้ดูแลระบบของ Buddy Account</span></div>
        <ErrorBox error={err} />
        <Field label="รหัสผู้ใช้" req><input autoFocus value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></Field>
        <Field label="ชื่อผู้ใช้" req><input value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} /></Field>
        <Field label="รหัสผ่าน" hint={PASSWORD_RULE} req><input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        <Field label="ยืนยันรหัสผ่าน" req><input type="password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></Field>
        <button className="primary" type="submit">สร้างผู้ดูแลระบบ</button>
        <button type="button" className="link" onClick={() => setMode('branch')}>เครื่องนี้เป็นเครื่องสาขา (เชื่อมกับสำนักงานใหญ่) →</button>
      </form>
    </div>
  );
}

/** T7.8 ตั้งเครื่องสาขา: ใส่ที่อยู่สำนักงานใหญ่ + รหัสตั้งเครื่องที่ผู้ดูแลสร้างที่ เริ่มระบบ › เครื่องสาขา (ออฟไลน์) */
function BranchSetup({ onBack }: { onBack: () => void }) {
  const { refresh } = useSession();
  const [f, setF] = useState({ central_url: 'https://', setup_code: '' });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setErr(null); setBusy(true);
    try { await api.post('/api/v1/sync/setup-branch', f); await refresh(); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <div className="login" data-tone="home">
      <form className="login-card" onKeyDown={navKey} onSubmit={(e) => { e.preventDefault(); go(); }}>
        <div className="login-brand"><b>ตั้งเป็นเครื่องสาขา</b><span>ทำงานต่อได้แม้อินเทอร์เน็ตดับ แล้วส่งเอกสารเข้าสำนักงานใหญ่เอง</span></div>
        <ErrorBox error={err} />
        <Field label="ที่อยู่สำนักงานใหญ่" hint="ที่อยู่เว็บที่ใช้เปิด Buddy Account ของสำนักงานใหญ่" req><input autoFocus value={f.central_url} onChange={(e) => setF({ ...f, central_url: e.target.value })} /></Field>
        <Field label="รหัสตั้งเครื่อง" hint="ผู้ดูแลสร้างที่สำนักงานใหญ่: เริ่มระบบ › เครื่องสาขา (ออฟไลน์)" req><input value={f.setup_code} onChange={(e) => setF({ ...f, setup_code: e.target.value.trim() })} /></Field>
        <button className="primary" type="submit" disabled={busy}>{busy ? 'กำลังดึงข้อมูลจากสำนักงานใหญ่…' : 'เชื่อมต่อและดึงข้อมูล'}</button>
        <p className="small muted">หลังตั้งเสร็จ เข้าระบบด้วยรหัสผู้ใช้และรหัสผ่านเดียวกับที่สำนักงานใหญ่</p>
        <button type="button" className="link" onClick={onBack}>← กลับไปตั้งเป็นเครื่องหลัก</button>
      </form>
    </div>
  );
}
