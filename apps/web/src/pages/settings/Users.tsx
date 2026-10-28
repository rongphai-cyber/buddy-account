import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { useSession } from '../../session';
import { cx, ErrorBox, Field, Modal, PageHead, Pill, toast, useHotkeys } from '../../ui';

interface User { id: string; username: string; display_name: string; status: string; approval_level: number; last_login_at: string | null; user_group_id: string | null; group_code: string | null; group_name: string | null; companies: string[] }
interface Group { id: string; code: string; name: string }

/** กลุ่มผู้ใช้ + แฟ้มผู้ใช้งานระบบ — คู่มือบทที่ 23 S-SEC-01/02 (สิทธิ์รายเมนูละเอียดอยู่ในเฟส P6) */
export function UsersPage() {
  const { me } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ enabled: !!me?.user.is_admin, queryKey: ['users'], queryFn: () => api.get<{ users: User[]; groups: Group[] }>('/api/v1/users') });
  const [edit, setEdit] = useState<User | 'new' | null>(null);
  useHotkeys({ Insert: () => setEdit('new') }, []);
  if (!me?.user.is_admin) return <div className="page"><div className="notebox">เฉพาะผู้ดูแลระบบ</div></div>;
  return (
    <div className="page" data-tone="setup">
      <PageHead eyebrow="เริ่มระบบ › ผู้ใช้งานและสิทธิ์" title="ผู้ใช้งานระบบ" lead="ผู้ใช้ในกลุ่ม ADMIN เข้าได้ทุกบริษัทและทุกเมนู · ผู้ใช้อื่นเข้าได้เฉพาะบริษัทที่กำหนด" actions={<button className="primary" onClick={() => setEdit('new')}>+ เพิ่มผู้ใช้ <kbd>Ins</kbd></button>} />
      <ErrorBox error={q.error} />
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th>รหัสผู้ใช้</th><th>ชื่อ</th><th>กลุ่ม</th><th className="c">ระดับอนุมัติ</th><th>บริษัทที่เข้าได้</th><th>เข้าระบบล่าสุด</th><th>สถานะ</th></tr></thead>
          <tbody>
            {q.data?.users.map((u) => (
              <tr key={u.id} className={cx('row-open', u.status === 'I' && 'void')} onClick={() => setEdit(u)}>
                <td className="mono">{u.username}</td><td>{u.display_name}</td><td>{u.group_code ? <Pill tone={u.group_code === 'ADMIN' ? 'n' : 'x'}>{u.group_name}</Pill> : ''}</td><td className="c">{u.approval_level}</td>
                <td className="small">{u.group_code === 'ADMIN' ? 'ทุกบริษัท' : u.companies.map((c) => me.companies.find((x) => x.id === c)?.code ?? '?').join(', ')}</td>
                <td className="small">{u.last_login_at ? new Date(u.last_login_at).toLocaleString('th-TH') : '—'}</td><td>{u.status === 'A' ? 'ใช้งาน' : 'ระงับ'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && q.data && <UserForm u={edit === 'new' ? null : edit} groups={q.data.groups} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); qc.invalidateQueries({ queryKey: ['users'] }); }} />}
    </div>
  );
}

function UserForm({ u, groups, onClose, onSaved }: { u: User | null; groups: Group[]; onClose: () => void; onSaved: () => void }) {
  const { me } = useSession();
  const [f, setF] = useState({ username: u?.username ?? '', display_name: u?.display_name ?? '', password: '', user_group_id: u?.user_group_id ?? '', approval_level: u?.approval_level ?? 0, status: u?.status ?? 'A', companies: u?.companies ?? [] as string[] });
  const [err, setErr] = useState<unknown>(null);
  const save = () => (u ? api.put(`/api/v1/users/${u.id}`, { ...f, password: f.password || undefined, user_group_id: f.user_group_id || null }) : api.post('/api/v1/users', { ...f, user_group_id: f.user_group_id || null })).then(() => { toast('บันทึกผู้ใช้แล้ว'); onSaved(); }).catch(setErr);
  useHotkeys({ F9: save, 'Ctrl+S': save }, [f]);
  return (
    <Modal title={u ? `แก้ไขผู้ใช้ ${u.username}` : 'เพิ่มผู้ใช้'} onClose={onClose} footer={<><button onClick={onClose}>ยกเลิก</button><button className="primary" onClick={save}>บันทึก <kbd>F9</kbd></button></>}>
      <ErrorBox error={err} />
      <div className="form-grid">
        <Field label="รหัสผู้ใช้" req><input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></Field>
        <Field label="ชื่อผู้ใช้" req><input value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} /></Field>
        <Field label={u ? 'ตั้งรหัสผ่านใหม่ (ว่าง = ไม่เปลี่ยน)' : 'รหัสผ่านเริ่มต้น'} req={!u}><input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" /></Field>
        <Field label="กลุ่มผู้ใช้"><select value={f.user_group_id} onChange={(e) => setF({ ...f, user_group_id: e.target.value })}><option value="">— ไม่มีกลุ่ม —</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.code} · {g.name}</option>)}</select></Field>
        <Field label="ระดับอนุมัติ 0–9"><input type="number" min={0} max={9} value={f.approval_level} onChange={(e) => setF({ ...f, approval_level: Number(e.target.value) })} /></Field>
        <Field label="สถานะ"><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="A">ใช้งาน</option><option value="I">ระงับ</option></select></Field>
        <fieldset className="wide"><span className="lbl">บริษัทที่เข้าได้</span>
          {me?.companies.map((c) => <label key={c.id} className="inline chk"><input type="checkbox" checked={f.companies.includes(c.id)} onChange={(e) => setF({ ...f, companies: e.target.checked ? [...f.companies, c.id] : f.companies.filter((x) => x !== c.id) })} /> {c.code} {c.name_th}</label>)}
        </fieldset>
      </div>
    </Modal>
  );
}
