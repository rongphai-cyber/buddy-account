import { useState } from 'react';
import { api } from '../../api';
import { ErrorBox, Field, navKey, PageHead, toast } from '../../ui';

/** เปลี่ยนรหัสผ่าน — คู่มือบทที่ 23 S-SEC-05 */
export function PasswordPage() {
  const [f, setF] = useState({ old_password: '', new_password: '', confirm: '' });
  const [err, setErr] = useState<unknown>(null);
  const go = () => {
    if (f.new_password !== f.confirm) { setErr(new Error('ยืนยันรหัสผ่านใหม่ไม่ตรงกัน')); return; }
    api.post('/api/v1/auth/password', { old_password: f.old_password, new_password: f.new_password }).then(() => { toast('เปลี่ยนรหัสผ่านแล้ว'); setF({ old_password: '', new_password: '', confirm: '' }); setErr(null); }).catch(setErr);
  };
  return (
    <div className="page narrow" data-tone="home">
      <PageHead eyebrow="อื่น ๆ › เปลี่ยนรหัสผ่าน" title="เปลี่ยนรหัสผ่าน" />
      <ErrorBox error={err} />
      <div className="card form-grid" onKeyDown={navKey}>
        <Field label="รหัสผ่านเดิม" req wide><input type="password" autoFocus value={f.old_password} onChange={(e) => setF({ ...f, old_password: e.target.value })} /></Field>
        <Field label="รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)" req wide><input type="password" value={f.new_password} onChange={(e) => setF({ ...f, new_password: e.target.value })} /></Field>
        <Field label="ยืนยันรหัสผ่านใหม่" req wide><input type="password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} data-noenter onKeyDown={(e) => e.key === 'Enter' && go()} /></Field>
      </div>
      <div className="actions"><button className="primary" onClick={go}>เปลี่ยนรหัสผ่าน</button></div>
    </div>
  );
}
