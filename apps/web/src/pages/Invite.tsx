import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PASSWORD_RULE } from '@buddy/core';
import { api } from '../api';
import { useSession } from '../session';
import { useTurnstile } from '../components/Turnstile';
import { ErrorBox, Field, navKey, PasswordInput } from '../ui';
import { markLanding } from './Hub';

type Invite = { username: string; display_name: string; tenant_name: string | null; companies: string[]; expires_at: string; hours: number };
const when = (iso: string) => new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' });

/**
 * หน้าเปิดลิงก์เชิญ (HANDOFF 184 · ไม่ต้องเข้าระบบ): ตั้งรหัสผ่านเอง → เข้าระบบ → ตั้งยืนยันตัวตนสองขั้น (บังคับทุกผู้ใช้) → ใช้งาน
 * ผู้ดูแลไม่เห็นรหัสผ่าน · ลิงก์ใช้ได้ครั้งเดียว · มีช่องตรวจว่าไม่ใช่บอทเมื่อผู้ให้บริการตั้ง Turnstile
 */
export function InvitePage({ token }: { token: string }) {
  const { me, refresh } = useSession();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['invite', token], queryFn: () => api.get<Invite>(`/api/v1/invite/${token}`), retry: false, staleTime: Infinity });
  const [f, setF] = useState({ password: '', confirm: '' });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const bot = useTurnstile();
  const go = async () => {
    if (busy) return;
    setErr(null);
    if (f.password !== f.confirm) { setErr(new Error('ยืนยันรหัสผ่านไม่ตรงกัน — พิมพ์รหัสผ่านเดียวกันทั้งสองช่อง')); return; }
    if (bot.required && !bot.token) { setErr(new Error('รอช่องตรวจสอบว่าไม่ใช่บอท (Cloudflare) ขึ้นเครื่องหมายถูกก่อน แล้วกดอีกครั้ง')); return; }
    setBusy(true);
    try {
      await api.post(`/api/v1/invite/${token}/accept`, { password: f.password, ...(bot.token ? { turnstile: bot.token } : {}) });
      markLanding();
      nav('/', { replace: true });
      await refresh();
    } catch (e) { setErr(e); bot.reset(); } finally { setBusy(false); }
  };
  const i = q.data;
  return (
    <div className="login" data-tone="home">
      <form className="login-card" onKeyDown={navKey} onSubmit={(e) => { e.preventDefault(); go(); }}>
        <div className="login-brand"><img className="login-logo" src="/brand/buddy-logo-80.png" srcSet="/brand/buddy-logo-160.png 2x" alt="Buddy Account" width={152} height={80} /><span>ตั้งรหัสผ่านเพื่อเริ่มใช้งาน</span></div>
        <ol className="invite-steps" aria-label="ขั้นตอน">
          <li className="on">1 ตั้งรหัสผ่าน</li><li>2 ยืนยันตัวตนสองขั้น (แอปในมือถือ)</li><li>3 เริ่มใช้งาน</li>
        </ol>
        {q.isLoading && <p>กำลังตรวจลิงก์…</p>}
        <ErrorBox error={q.error} />
        {q.error ? <button type="button" className="link" onClick={() => nav('/', { replace: true })}>ไปหน้าเข้าระบบ</button> : null}
        {i && <>
          {me && me.user.username !== i.username && <p className="notebox">เครื่องนี้เข้าระบบอยู่ในชื่อ <b>{me.user.username}</b> — ตั้งรหัสผ่านแล้วจะเข้าระบบเป็น <b>{i.username}</b> แทน</p>}
          <dl className="invite-who">
            <dt>รหัสผู้ใช้</dt><dd className="mono" data-no-i18n>{i.username}</dd>
            <dt>ชื่อ</dt><dd data-no-i18n>{i.display_name}</dd>
            {i.tenant_name && <><dt>กิจการ</dt><dd data-no-i18n>{i.tenant_name}</dd></>}
            {i.companies.length > 0 && <><dt>บริษัท</dt><dd data-no-i18n>{i.companies.join(' · ')}</dd></>}
          </dl>
          <ErrorBox error={err} />
          <Field label="รหัสผ่าน" hint={PASSWORD_RULE} req><PasswordInput autoFocus capsHint autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
          <Field label="ยืนยันรหัสผ่าน" req><PasswordInput autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} data-noenter onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), go())} /></Field>
          {bot.el}
          <button className="primary" type="submit" disabled={busy || !f.password || !f.confirm}>{busy ? 'กำลังบันทึก…' : 'ตั้งรหัสผ่านและเข้าระบบ'}</button>
          <p className="hint">ลิงก์นี้ใช้ได้ครั้งเดียว ถึง {when(i.expires_at)} · ผู้ดูแลระบบไม่เห็นรหัสผ่านของคุณ · ขั้นถัดไปเตรียมมือถือที่ติดตั้ง Google Authenticator หรือ Microsoft Authenticator</p>
        </>}
      </form>
    </div>
  );
}
