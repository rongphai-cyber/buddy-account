import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { qrEncode, qrSvgPath } from '@buddy/core';
import { api } from '../../api';
import { useSession } from '../../session';
import { ErrorBox, Field, Modal, navKey, toast } from '../../ui';

/**
 * ยืนยันตัวตนสองขั้น (T0.16) — รหัส 6 หลักจากแอปในมือถือ (Google Authenticator / Microsoft Authenticator / แอป TOTP อื่น)
 * ผู้ดูแลระบบต้องตั้งก่อนใช้งาน · ผู้ใช้ทั่วไปเปิดเองได้
 */
interface Status { enabled: boolean; required: boolean; recovery_left: number }

/** ขั้นตอนตั้งค่า: สร้างกุญแจ → เพิ่มในแอป → ยืนยันรหัส → เก็บรหัสสำรอง */
export function TwoFactorSetup({ onDone }: { onDone: () => void }) {
  const [key, setKey] = useState<{ secret: string; otpauth: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const start = () => { setErr(null); setBusy(true); api.post<{ secret: string; otpauth: string }>('/api/v1/auth/2fa/setup').then(setKey).catch(setErr).finally(() => setBusy(false)); };
  const confirm = () => { setErr(null); setBusy(true); api.post<{ recovery_codes: string[] }>('/api/v1/auth/2fa/enable', { code }).then((r) => setCodes(r.recovery_codes)).catch(setErr).finally(() => setBusy(false)); };
  if (codes) return <RecoveryCodes codes={codes} onDone={onDone} />;
  if (!key) return (
    <div className="mfa-step">
      <ErrorBox error={err} />
      <ol className="mfa-howto">
        <li>ติดตั้งแอป <b>Google Authenticator</b> หรือ <b>Microsoft Authenticator</b> ในมือถือ (ฟรี)</li>
        <li>กดปุ่มด้านล่างเพื่อสร้างกุญแจ แล้วสแกน QR code ด้วยแอป (หรือพิมพ์กุญแจเอง)</li>
        <li>ป้อนรหัส 6 หลักที่แอปแสดงเพื่อยืนยัน</li>
      </ol>
      <button className="primary" autoFocus disabled={busy} onClick={start}>สร้างกุญแจ</button>
    </div>
  );
  return (
    <div className="mfa-step" onKeyDown={navKey}>
      <ErrorBox error={err} />
      <p>ในแอป กด <b>+</b> › <b>สแกนคิวอาร์โค้ด</b> (Scan a QR code) แล้วส่องที่ภาพนี้</p>
      <QrCode text={key.otpauth} />
      <p className="small muted">สแกนไม่ได้: เลือก <b>ป้อนคีย์การตั้งค่า</b> (Enter a setup key) ชื่อบัญชีใส่ Buddy Account แล้วพิมพ์กุญแจนี้ ชนิด <b>ตามเวลา</b></p>
      <div className="mfa-secret" aria-label="กุญแจ">{key.secret.match(/.{1,4}/g)?.map((g, i) => <span key={i}>{g}</span>)}</div>
      <div className="mfa-links">
        <button type="button" onClick={() => navigator.clipboard?.writeText(key.secret).then(() => toast('คัดลอกกุญแจแล้ว'))}>คัดลอกกุญแจ</button>
        <a href={key.otpauth} title="เปิดบนมือถือที่ติดตั้งแอปแล้ว">เปิดในแอป (บนมือถือ)</a>
      </div>
      <Field label="รหัส 6 หลักจากแอป" req><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} data-noenter onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), confirm())} /></Field>
      <button className="primary" disabled={busy || code.length !== 6} onClick={confirm}>ยืนยันและเปิดใช้</button>
    </div>
  );
}

/** QR code ของลิงก์ otpauth:// (สร้างในเครื่อง ไม่ส่งกุญแจไปบริการภายนอก) — ดำบนขาวเสมอแม้ธีมมืด เพื่อให้กล้องอ่านได้ */
function QrCode({ text }: { text: string }) {
  const qr = useMemo(() => qrSvgPath(qrEncode(text).modules), [text]);
  return (
    <div className="mfa-qr">
      <svg viewBox={qr.viewBox} role="img" aria-label="QR code สำหรับแอปยืนยันตัวตน" shapeRendering="crispEdges">
        <rect width="100%" height="100%" fill="#fff" /><path d={qr.d} fill="#000" />
      </svg>
    </div>
  );
}

/** รหัสสำรอง: แสดงครั้งเดียว ให้คัดลอก/บันทึกเป็นไฟล์ */
function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const text = `Buddy Account — รหัสสำรองยืนยันตัวตนสองขั้น\nใช้ได้รหัสละ 1 ครั้ง เมื่อไม่มีมือถือ\n\n${codes.join('\n')}\n`;
  const save = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/plain;charset=utf-8' }));
    a.download = 'buddy-รหัสสำรอง.txt'; a.click(); URL.revokeObjectURL(a.href);
  };
  return (
    <div className="mfa-step">
      <div className="notebox">เก็บรหัสสำรองนี้ไว้ในที่ปลอดภัย (พิมพ์หรือบันทึกไฟล์) — ใช้เข้าระบบแทนรหัสจากแอปเมื่อมือถือหาย รหัสละ 1 ครั้ง และ<b>จะไม่แสดงอีก</b></div>
      <div className="mfa-codes">{codes.map((c) => <code key={c}>{c}</code>)}</div>
      <div className="mfa-links">
        <button type="button" onClick={() => navigator.clipboard?.writeText(text).then(() => toast('คัดลอกรหัสสำรองแล้ว'))}>คัดลอก</button>
        <button type="button" onClick={save}>บันทึกเป็นไฟล์</button>
      </div>
      <button className="primary" onClick={onDone}>เก็บรหัสสำรองแล้ว — ไปต่อ</button>
    </div>
  );
}

/** หน้าบังคับ: ผู้ดูแลระบบที่ยังไม่ตั้งยืนยันตัวตนสองขั้น ใช้งานอื่นไม่ได้จนกว่าจะตั้งเสร็จ */
export function MfaRequiredPage() {
  const { me, refresh, logout } = useSession();
  return (
    <div className="login" data-tone="home">
      <div className="login-card mfa-card">
        <div className="login-brand"><b>ตั้งค่ายืนยันตัวตนสองขั้น</b><span>บัญชี {me?.user.username} เป็นผู้ดูแลระบบ — ต้องใช้รหัสจากมือถือทุกครั้งที่เข้าระบบ เพื่อป้องกันบัญชีถูกขโมย</span></div>
        <TwoFactorSetup onDone={() => { toast('เปิดยืนยันตัวตนสองขั้นแล้ว'); refresh(); }} />
        <button type="button" className="link" onClick={logout}>ออกจากระบบ</button>
      </div>
    </div>
  );
}

/** การ์ดในหน้า บัญชีของฉัน: สถานะ · เปิด · สร้างรหัสสำรองใหม่ · ปิด */
export function TwoFactorCard() {
  const qc = useQueryClient();
  const { refresh } = useSession();
  const st = useQuery({ queryKey: ['auth-2fa'], queryFn: () => api.get<Status>('/api/v1/auth/2fa') });
  const [setup, setSetup] = useState(false);
  const [ask, setAsk] = useState<null | 'recovery' | 'disable'>(null);
  const [pw, setPw] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const reload = () => { qc.invalidateQueries({ queryKey: ['auth-2fa'] }); };
  const run = () => {
    setErr(null);
    if (ask === 'recovery') api.post<{ recovery_codes: string[] }>('/api/v1/auth/2fa/recovery', { password: pw }).then((r) => { setAsk(null); setPw(''); setCodes(r.recovery_codes); reload(); }).catch(setErr);
    else api.post<{ required: boolean }>('/api/v1/auth/2fa/disable', { password: pw }).then((r) => { setAsk(null); setPw(''); toast('ปิดยืนยันตัวตนสองขั้นแล้ว'); reload(); if (r.required) refresh(); }).catch(setErr);
  };
  const s = st.data;
  return (
    <div className="card mfa-box">
      <h3>ยืนยันตัวตนสองขั้น</h3>
      <ErrorBox error={st.error} />
      {s && !s.enabled && !setup && <>
        <p>ยังไม่เปิด — เมื่อเปิดแล้ว ตอนเข้าระบบต้องป้อนรหัส 6 หลักจากแอปในมือถือด้วย แม้รหัสผ่านรั่วก็เข้าไม่ได้{s.required && <b> (ผู้ดูแลระบบต้องเปิด)</b>}</p>
        <div className="actions"><button className="primary" onClick={() => setSetup(true)}>เปิดยืนยันตัวตนสองขั้น</button></div>
      </>}
      {s && !s.enabled && setup && <TwoFactorSetup onDone={() => { setSetup(false); toast('เปิดยืนยันตัวตนสองขั้นแล้ว'); reload(); }} />}
      {s?.enabled && <>
        <p>✅ เปิดใช้อยู่ · รหัสสำรองเหลือ <b>{s.recovery_left}</b> รหัส{s.recovery_left <= 3 && ' — ควรสร้างใหม่'}</p>
        <div className="actions">
          <button onClick={() => { setErr(null); setAsk('recovery'); }}>สร้างรหัสสำรองใหม่</button>
          <button className="danger" onClick={() => { setErr(null); setAsk('disable'); }}>ปิด (เปลี่ยนมือถือ)</button>
        </div>
      </>}
      {ask && (
        <Modal title={ask === 'recovery' ? 'สร้างรหัสสำรองใหม่' : 'ปิดยืนยันตัวตนสองขั้น'} onClose={() => setAsk(null)}
          footer={<><button onClick={() => setAsk(null)}>ยกเลิก</button><button className={ask === 'disable' ? 'danger' : 'primary'} onClick={run}>ยืนยัน</button></>}>
          <ErrorBox error={err} />
          <p>{ask === 'recovery' ? 'รหัสสำรองชุดเดิมจะใช้ไม่ได้ทันที' : s?.required ? 'ผู้ดูแลระบบต้องตั้งใหม่ทันทีหลังปิด (เช่นเมื่อเปลี่ยนมือถือ)' : 'การเข้าระบบจะใช้แค่รหัสผ่าน'}</p>
          <Field label="ยืนยันด้วยรหัสผ่านปัจจุบัน" req wide><input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} data-noenter onKeyDown={(e) => e.key === 'Enter' && run()} /></Field>
        </Modal>
      )}
      {codes && <Modal title="รหัสสำรองชุดใหม่" onClose={() => setCodes(null)}><RecoveryCodes codes={codes} onDone={() => setCodes(null)} /></Modal>}
    </div>
  );
}
