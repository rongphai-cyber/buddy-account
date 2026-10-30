import { useEffect, useState } from 'react';
import { PASSWORD_RULE } from '@buddy/core';
import { api } from '../api';
import { ErrorBox, Field, navKey } from '../ui';

/** หน้าสมัครใช้งานเปิดหรือไม่ (ผู้ให้บริการตั้ง BUDDY_SIGNUP) */
export function useSignupMode() {
  const [mode, setMode] = useState<'off' | 'review' | 'auto' | null>(null);
  useEffect(() => { api.get<{ mode: 'off' | 'review' | 'auto' }>('/api/v1/signup/config').then((r) => setMode(r.mode)).catch(() => setMode('off')); }, []);
  return mode;
}

/**
 * สมัครใช้งานเอง (ข้อกำหนดเจ้าของ 30/10/2569) — ไม่ต้องเข้าระบบ · ได้บัญชีผู้ดูแลของกิจการตัวเอง แล้วสร้างบริษัทแรกเอง
 * โหมดตรวจก่อน: ผู้ให้บริการอนุมัติแล้วจึงเข้าระบบได้ · โหมดอัตโนมัติ: เข้าระบบได้ทันที
 */
export function SignupPage({ onBack }: { onBack: () => void }) {
  const mode = useSignupMode();
  const [f, setF] = useState({ business_name: '', contact_name: '', contact_email: '', contact_phone: '', username: '', password: '', password2: '', website: '' });
  const [accept, setAccept] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ status: string; username: string; message: string } | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const go = async () => {
    setErr(null);
    if (f.password !== f.password2) { setErr(new Error('ยืนยันรหัสผ่านไม่ตรงกัน — พิมพ์รหัสผ่านให้เหมือนกันทั้งสองช่อง')); return; }
    if (!accept) { setErr(new Error('อ่านและติ๊กยอมรับเงื่อนไขการใช้บริการและการคุ้มครองข้อมูลส่วนบุคคลก่อน')); return; }
    setBusy(true);
    try { const { password2: _p, ...body } = f; setDone(await api.post('/api/v1/signup', { ...body, accept_terms: true })); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  if (mode === 'off') return (
    <div className="login" data-tone="home"><div className="login-card">
      <div className="login-brand"><b>สมัครใช้งาน</b><span>ขณะนี้ปิดรับสมัครทางหน้าเว็บ — ติดต่อผู้ให้บริการเพื่อเปิดบัญชี</span></div>
      <button type="button" className="link" onClick={onBack}>กลับไปหน้าเข้าระบบ</button>
    </div></div>
  );
  if (done) return (
    <div className="login" data-tone="home"><div className="login-card">
      <div className="login-brand"><b>{done.status === 'A' ? '✓ เปิดบัญชีแล้ว' : '✓ ส่งใบสมัครแล้ว'}</b><span>{done.message}</span></div>
      <p>รหัสผู้ใช้ของคุณ: <b className="mono">{done.username}</b></p>
      <button type="button" className="primary" onClick={onBack}>ไปหน้าเข้าระบบ</button>
    </div></div>
  );
  return (
    <div className="login signup" data-tone="home">
      <form className="login-card" onKeyDown={navKey} onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <div className="login-brand"><b>สมัครใช้งาน Buddy Account</b>
          <span>{mode === 'auto' ? 'กรอกแล้วเข้าระบบได้ทันที แล้วสร้างบริษัทแรกของคุณ' : 'ผู้ให้บริการตรวจใบสมัครแล้วติดต่อกลับ เมื่ออนุมัติแล้วเข้าระบบด้วยรหัสที่ตั้งไว้'}</span></div>
        <ErrorBox error={err} />
        <Field label="ชื่อกิจการ / ร้าน" req><input autoFocus maxLength={120} value={f.business_name} onChange={set('business_name')} /></Field>
        <Field label="ชื่อผู้ติดต่อ" req><input maxLength={120} autoComplete="name" value={f.contact_name} onChange={set('contact_name')} /></Field>
        <div className="form-grid">
          <Field label="อีเมล" req><input type="email" maxLength={120} autoComplete="email" value={f.contact_email} onChange={set('contact_email')} /></Field>
          <Field label="โทรศัพท์" req><input type="tel" maxLength={60} autoComplete="tel" placeholder="081-234-5678" value={f.contact_phone} onChange={set('contact_phone')} /></Field>
        </div>
        <Field label="รหัสผู้ใช้ (ใช้เข้าระบบ)" req hint="ตัวอักษรอังกฤษ ตัวเลข _ . @ - อย่างน้อย 3 ตัว"><input maxLength={30} autoComplete="username" value={f.username} onChange={set('username')} /></Field>
        <div className="form-grid">
          <Field label="รหัสผ่าน" req hint={PASSWORD_RULE}><input type="password" autoComplete="new-password" value={f.password} onChange={set('password')} /></Field>
          <Field label="ยืนยันรหัสผ่าน" req><input type="password" autoComplete="new-password" value={f.password2} onChange={set('password2')} /></Field>
        </div>
        {/* ช่องดักบอท — คนไม่เห็น */}
        <input className="hp-field" tabIndex={-1} autoComplete="off" aria-hidden="true" value={f.website} onChange={set('website')} name="website" />
        <details className="terms">
          <summary>เงื่อนไขการใช้บริการและการคุ้มครองข้อมูลส่วนบุคคล</summary>
          <ul>
            <li>ข้อมูลบัญชีและเอกสารของกิจการเป็นของผู้ใช้บริการ ผู้ให้บริการเก็บรักษาและประมวลผลตามที่จำเป็นต่อการให้บริการเท่านั้น (ผู้ประมวลผลข้อมูลส่วนบุคคลตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562)</li>
            <li>ข้อมูลในใบสมัคร (ชื่อ อีเมล โทรศัพท์ IP) ใช้เพื่อพิจารณาเปิดบัญชีและติดต่อกลับ · ถ้าไม่อนุมัติ ลบข้อมูลติดต่อเมื่อครบ 90 วัน</li>
            <li>ผู้ใช้บริการรับผิดชอบความถูกต้องของข้อมูลที่บันทึก และเก็บรักษารหัสผ่านของตนเอง · ผู้ดูแลระบบอาจต้องเปิดยืนยันตัวตนสองขั้น</li>
            <li>เมื่อเลิกใช้บริการ ขอส่งออกข้อมูลได้ภายใน 90 วัน จากนั้นข้อมูลจะถูกลบ</li>
          </ul>
        </details>
        <label className="inline chk"><input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} /> ฉันอ่านและยอมรับเงื่อนไขการใช้บริการและการคุ้มครองข้อมูลส่วนบุคคล</label>
        <button className="primary" type="submit" disabled={busy || !mode}>{busy ? 'กำลังส่ง…' : mode === 'auto' ? 'สมัครและเปิดบัญชี' : 'ส่งใบสมัคร'}</button>
        <button type="button" className="link" onClick={onBack}>มีบัญชีแล้ว — กลับไปหน้าเข้าระบบ</button>
      </form>
    </div>
  );
}
