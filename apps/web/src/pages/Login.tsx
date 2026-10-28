import { useState } from 'react';
import { api } from '../api';
import { useSession } from '../session';
import { ErrorBox, Field, navKey } from '../ui';

export function LoginPage() {
  const { refresh } = useSession();
  const [f, setF] = useState({ username: '', password: '' });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setErr(null);
    try { await api.post('/api/v1/auth/login', { ...f, work_date: new Date().toISOString().slice(0, 10) }); await refresh(); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <div className="login" data-tone="home">
      <form className="login-card" onKeyDown={navKey} onSubmit={(e) => { e.preventDefault(); go(); }}>
        <div className="login-brand"><b>Buddy Account</b><span>โปรแกรมบัญชีสำหรับกิจการไทย</span></div>
        <ErrorBox error={err} />
        <Field label="รหัสผู้ใช้" req><input autoFocus autoComplete="username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></Field>
        <Field label="รหัสผ่าน" req><input type="password" autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} data-noenter onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), go())} /></Field>
        <button className="primary" type="submit" disabled={busy}>{busy ? 'กำลังเข้าระบบ…' : 'เข้าสู่ระบบ'}</button>
        <p className="hint">Enter ไปช่องถัดไป · ลืมรหัสผ่านให้ผู้ดูแลระบบตั้งรหัสใหม่ให้</p>
      </form>
    </div>
  );
}

export function SetupPage() {
  const { refresh } = useSession();
  const [f, setF] = useState({ username: 'admin', display_name: '', password: '', confirm: '' });
  const [err, setErr] = useState<unknown>(null);
  const go = async () => {
    setErr(null);
    if (f.password !== f.confirm) { setErr(new Error('ยืนยันรหัสผ่านไม่ตรงกัน')); return; }
    try { await api.post('/api/v1/setup', { username: f.username, display_name: f.display_name, password: f.password }); await refresh(); }
    catch (e) { setErr(e); }
  };
  return (
    <div className="login" data-tone="home">
      <form className="login-card" onKeyDown={navKey} onSubmit={(e) => { e.preventDefault(); go(); }}>
        <div className="login-brand"><b>ตั้งค่าครั้งแรก</b><span>สร้างผู้ดูแลระบบของ Buddy Account</span></div>
        <ErrorBox error={err} />
        <Field label="รหัสผู้ใช้" req><input autoFocus value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></Field>
        <Field label="ชื่อผู้ใช้" req><input value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} /></Field>
        <Field label="รหัสผ่าน (อย่างน้อย 8 ตัวอักษร)" req><input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        <Field label="ยืนยันรหัสผ่าน" req><input type="password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></Field>
        <button className="primary" type="submit">สร้างผู้ดูแลระบบ</button>
      </form>
    </div>
  );
}
