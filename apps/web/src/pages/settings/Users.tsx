import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { useSession } from '../../session';
import { HUB_APPS, PASSWORD_RULE, TENANT_MODULES, type TenantModuleKey } from '@buddy/core';
import { Confirm, cx, ErrorBox, Field, Modal, PageHead, Pill, toast, useHotkeys } from '../../ui';
import { MasterBar, useRowSelect } from '../../components/MasterBar';

interface User { id: string; username: string; display_name: string; status: string; approval_level: number; check_rights: boolean; last_login_at: string | null; user_group_id: string | null; group_code: string | null; group_name: string | null; companies: string[]; mfa_enabled?: boolean; locked_until?: string | null; app_access?: TenantModuleKey[] | null }
interface Group { id: string; code: string; name: string }

/** กลุ่มผู้ใช้ + แฟ้มผู้ใช้งานระบบ — คู่มือบทที่ 23 S-SEC-01/02 · สิทธิ์ 7 ชนิดรายเมนูที่หน้า /settings/permissions */
export function UsersPage() {
  const { me } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ enabled: !!me?.user.is_admin, queryKey: ['users'], queryFn: () => api.get<{ users: User[]; groups: Group[] }>('/api/v1/users') });
  const nav = useNavigate();
  const [edit, setEdit] = useState<User | 'new' | null>(null);
  const [addGroup, setAddGroup] = useState(false);
  const rs = useRowSelect(q.data?.users);
  if (!me?.user.is_admin) return <div className="page"><div className="notebox">เฉพาะผู้ดูแลระบบ</div></div>;
  return (
    <div className="page" data-tone="setup">
      <PageHead eyebrow="เริ่มระบบ › ผู้ใช้งานและสิทธิ์" title="ผู้ใช้งานระบบ" lead="ผู้ใช้ในกลุ่ม ADMIN เข้าได้ทุกบริษัทและทุกเมนู · ผู้ใช้อื่นเข้าได้เฉพาะบริษัทที่กำหนด ตามระดับอนุมัติ (0–4 พนักงาน · 5–8 หัวหน้าแผนก · 9 ผู้จัดการระบบ) และจำกัดเพิ่มด้วยสิทธิ์รายเมนูถ้าเปิดตรวจสอบสิทธิ์"
        actions={<><button onClick={() => nav('/settings/permissions')}>สิทธิ์รายเมนู</button><button onClick={() => setAddGroup(true)}>+ เพิ่มกลุ่ม</button></>} />
      <ErrorBox error={q.error} />
      <MasterBar rs={rs} word="ผู้ใช้" label={(u) => `${u.username} ${u.display_name}`} onAdd={() => setEdit('new')} onEdit={(u) => setEdit(u)} />
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th>รหัสผู้ใช้</th><th>ชื่อ</th><th>กลุ่ม</th><th className="c">ระดับอนุมัติ</th><th>ตรวจสอบสิทธิ์</th><th>บริษัทที่เข้าได้</th><th>โปรแกรมที่เปิดได้</th><th>เข้าระบบล่าสุด</th><th>ยืนยันสองขั้น</th><th>สถานะ</th></tr></thead>
          <tbody>
            {q.data?.users.map((u, i) => (
              <tr key={u.id} className={cx('row-open', u.status === 'I' && 'void', rs.cls(i))} onClick={() => { rs.setSel(i); setEdit(u); }} onMouseEnter={rs.hover(i)}>
                <td className="mono">{u.username}</td><td>{u.display_name}</td><td>{u.group_code ? <Pill tone={u.group_code === 'ADMIN' ? 'n' : 'x'}>{u.group_name}</Pill> : ''}</td><td className="c">{u.approval_level}</td><td>{u.group_code === 'ADMIN' ? '' : u.check_rights ? <button className="linklike" onClick={(e) => { e.stopPropagation(); nav(`/settings/permissions?s=U:${u.id}`); }}>ตามตารางสิทธิ์</button> : <span className="muted">ตามระดับ</span>}</td>
                <td className="small">{u.group_code === 'ADMIN' ? 'ทุกบริษัท' : u.companies.map((c) => me.companies.find((x) => x.id === c)?.code ?? '?').join(', ')}</td>
                <td className="small">{appsText(u)}</td>
                <td className="small">{u.last_login_at ? new Date(u.last_login_at).toLocaleString('th-TH') : '—'}</td>
                <td>{u.mfa_enabled ? <Pill tone="n">เปิด</Pill> : u.group_code === 'ADMIN' ? <Pill tone="d">ยังไม่ตั้ง</Pill> : <span className="muted">—</span>}</td>
                <td>{u.status === 'A' ? 'ใช้งาน' : 'ระงับ'}{u.locked_until && <> <Pill tone="c">ล็อกถึง {new Date(u.locked_until).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</Pill></>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {addGroup && <GroupForm onClose={() => setAddGroup(false)} onSaved={() => { setAddGroup(false); qc.invalidateQueries({ queryKey: ['users'] }); }} />}
      {edit && q.data && <UserForm u={edit === 'new' ? null : edit} groups={q.data.groups} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); qc.invalidateQueries({ queryKey: ['users'] }); }} />}
    </div>
  );
}

function UserForm({ u, groups, onClose, onSaved }: { u: User | null; groups: Group[]; onClose: () => void; onSaved: () => void }) {
  const { me } = useSession();
  const [f, setF] = useState({ username: u?.username ?? '', display_name: u?.display_name ?? '', password: '', user_group_id: u?.user_group_id ?? '', approval_level: u?.approval_level ?? 0, check_rights: u?.check_rights ?? false, status: u?.status ?? 'A', companies: u?.companies ?? [] as string[],
    app_access: (u?.app_access ?? null) as TenantModuleKey[] | null });
  const [err, setErr] = useState<unknown>(null);
  const [sec, setSec] = useState<null | 'unlock' | 'reset-2fa'>(null);
  const runSec = () => { const k = sec; setSec(null); api.post(`/api/v1/users/${u!.id}/${k}`).then(() => { toast(k === 'unlock' ? 'ปลดล็อกแล้ว' : 'ล้างยืนยันตัวตนสองขั้นแล้ว — ผู้ใช้ต้องเข้าระบบใหม่'); onSaved(); }).catch(setErr); };
  const save = () => (u ? api.put(`/api/v1/users/${u.id}`, { ...f, password: f.password || undefined, user_group_id: f.user_group_id || null }) : api.post('/api/v1/users', { ...f, user_group_id: f.user_group_id || null })).then(() => { toast('บันทึกผู้ใช้แล้ว'); onSaved(); }).catch(setErr);
  useHotkeys({ F9: save, 'Ctrl+S': save }, [f]);
  return (
    <Modal title={u ? `แก้ไขผู้ใช้ ${u.username}` : 'เพิ่มผู้ใช้'} onClose={onClose} footer={<><button onClick={onClose}>ยกเลิก</button><button className="primary" onClick={save}>บันทึก <kbd>F9</kbd></button></>}>
      <ErrorBox error={err} />
      <div className="form-grid">
        <Field label="รหัสผู้ใช้" req><input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></Field>
        <Field label="ชื่อผู้ใช้" req><input value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} /></Field>
        <Field label={u ? 'ตั้งรหัสผ่านใหม่ (ว่าง = ไม่เปลี่ยน)' : 'รหัสผ่านเริ่มต้น'} hint={PASSWORD_RULE} req={!u}><input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" /></Field>
        <Field label="กลุ่มผู้ใช้"><select value={f.user_group_id} onChange={(e) => setF({ ...f, user_group_id: e.target.value })}><option value="">— ไม่มีกลุ่ม —</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.code} · {g.name}</option>)}</select></Field>
        <Field label="ระดับอนุมัติ" hint="0–4 อ่าน/เพิ่ม/แก้ไข/พิมพ์ · 5–8 + ยกเลิก/ลบ/กำหนดค่าโปรแกรม · 9 ทุกอย่างรวมระบบความปลอดภัย">
          <select value={f.approval_level} onChange={(e) => setF({ ...f, approval_level: Number(e.target.value) })}>{Array.from({ length: 10 }, (_, i) => <option key={i} value={i}>{i} · {i <= 4 ? 'พนักงาน' : i <= 8 ? 'หัวหน้าแผนก' : 'ผู้จัดการระบบ'}</option>)}</select>
        </Field>
        <Field label="ตรวจสอบสิทธิ์" hint="ตรวจก่อนใช้งาน = ใช้ได้เฉพาะเมนูที่กำหนดในสิทธิ์รายเมนู (ของผู้ใช้หรือกลุ่ม)">
          <select value={f.check_rights ? '1' : '0'} onChange={(e) => setF({ ...f, check_rights: e.target.value === '1' })}><option value="0">ไม่ตรวจสอบสิทธิ์ (ตามระดับอนุมัติ)</option><option value="1">ตรวจสอบสิทธิ์ก่อนใช้งาน</option></select>
        </Field>
        <Field label="สถานะ"><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="A">ใช้งาน</option><option value="I">ระงับ</option></select></Field>
        <fieldset className="wide"><span className="lbl">บริษัทที่เข้าได้</span>
          {me?.companies.map((c) => <label key={c.id} className="inline chk"><input type="checkbox" checked={f.companies.includes(c.id)} onChange={(e) => setF({ ...f, companies: e.target.checked ? [...f.companies, c.id] : f.companies.filter((x) => x !== c.id) })} /> {c.code} {c.name_th}</label>)}
        </fieldset>
        <AppAccessField value={f.app_access} onChange={(v) => setF({ ...f, app_access: v })} admin={groups.find((g) => g.id === f.user_group_id)?.code === 'ADMIN'} />
        {u && (u.locked_until || (u.mfa_enabled && u.id !== me?.user.id)) && (
          <fieldset className="wide"><span className="lbl">ความปลอดภัยการเข้าระบบ</span>
            {u.locked_until && <button type="button" onClick={() => setSec('unlock')}>ปลดล็อก (ใส่รหัสผิดเกิน 5 ครั้ง)</button>}{' '}
            {u.mfa_enabled && u.id !== me?.user.id && <button type="button" className="danger" onClick={() => setSec('reset-2fa')}>ล้างยืนยันตัวตนสองขั้น (มือถือหาย)</button>}
          </fieldset>
        )}
      </div>
      {sec && <Confirm title={sec === 'unlock' ? 'ปลดล็อกผู้ใช้' : 'ล้างยืนยันตัวตนสองขั้น'} danger={sec === 'reset-2fa'} onClose={() => setSec(null)} onOk={runSec}
        text={sec === 'unlock' ? `ให้ ${u?.username} เข้าระบบได้ทันที` : `${u?.username} จะถูกออกจากระบบ และเข้าด้วยรหัสผ่านอย่างเดียว (ผู้ดูแลระบบต้องตั้งใหม่ทันที) — ตรวจว่าเป็นเจ้าของบัญชีจริงก่อน`} />}
    </Modal>
  );
}

/** เพิ่มกลุ่มผู้ใช้ (S-SEC-01) — กำหนดสิทธิ์ของกลุ่มที่หน้าสิทธิ์รายเมนู */
function GroupForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ code: '', name: '' });
  const [err, setErr] = useState<unknown>(null);
  const save = () => api.post('/api/v1/user-groups', f).then(() => { toast('เพิ่มกลุ่มแล้ว'); onSaved(); }).catch(setErr);
  useHotkeys({ F9: save, 'Ctrl+S': save }, [f]);
  return (
    <Modal title="เพิ่มกลุ่มผู้ใช้" onClose={onClose} footer={<><button onClick={onClose}>ยกเลิก</button><button className="primary" onClick={save}>บันทึก <kbd>F9</kbd></button></>}>
      <ErrorBox error={err} />
      <div className="form-grid">
        <Field label="รหัสกลุ่ม" req hint="ภาษาอังกฤษ/ตัวเลข เช่น ACC FIN"><input autoFocus value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
        <Field label="ชื่อกลุ่ม" req><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="เช่น แผนกบัญชี" /></Field>
      </div>
    </Modal>
  );
}

/** ชื่อสั้นของโปรแกรม (Hub) */
const appName = (k: TenantModuleKey) => HUB_APPS[k].name;
/** คอลัมน์ "โปรแกรมที่เปิดได้" ในรายการผู้ใช้ */
function appsText(u: User) {
  if (u.group_code === 'ADMIN' || u.app_access == null) return <span className="muted">ทุกโปรแกรม</span>;
  if (!u.app_access.length) return <Pill tone="d">ยังไม่ให้เปิด</Pill>;
  return u.app_access.map(appName).join(', ');
}

/**
 * โปรแกรมที่ผู้ใช้เปิดได้จากหน้าเปิดโปรแกรม (Hub · เจ้าของ 09/11/2569) — ผู้ใช้เดิม = ทุกโปรแกรมที่ลูกค้าเปิดใช้
 * ไม่ติ๊ก Buddy Account = ผู้ใช้เห็นเฉพาะหน้าเปิดโปรแกรม (เช่น พนักงานหน้าร้าน) ไม่เห็นเมนูบัญชี
 */
function AppAccessField({ value, onChange, admin }: { value: TenantModuleKey[] | null; onChange: (v: TenantModuleKey[] | null) => void; admin: boolean }) {
  const mods = useQuery({ queryKey: ['tenant-modules'], queryFn: () => api.get<{ modules: Array<{ key: TenantModuleKey; active: boolean }> }>('/api/v1/tenant/modules') });
  const activeOf = (k: TenantModuleKey) => mods.data?.modules.find((m) => m.key === k)?.active ?? true;
  if (admin) return <fieldset className="wide"><span className="lbl">โปรแกรมที่เปิดได้</span><span className="muted">ผู้ดูแลระบบ (กลุ่ม ADMIN) เปิดได้ทุกโปรแกรมเสมอ</span></fieldset>;
  const pick = value ?? [];
  return (
    <fieldset className="wide" data-testid="app-access"><span className="lbl">โปรแกรมที่เปิดได้ (หน้าเปิดโปรแกรม ▦ WTS)</span>
      <label className="inline chk"><input type="radio" name="app-access-mode" checked={value === null} onChange={() => onChange(null)} /> ทุกโปรแกรมที่บริษัทเปิดใช้</label>
      <label className="inline chk"><input type="radio" name="app-access-mode" checked={value !== null} onChange={() => onChange(value ?? ['buddy'])} /> เฉพาะที่เลือก</label>
      {value !== null && <div className="app-access-list">
        {TENANT_MODULES.map((m) => (
          <label key={m.key} className="inline chk">
            <input type="checkbox" checked={pick.includes(m.key)} onChange={(e) => onChange(TENANT_MODULES.map((x) => x.key).filter((k) => (k === m.key ? e.target.checked : pick.includes(k))))} />
            {' '}{appName(m.key)}{!activeOf(m.key) && <span className="muted small"> (บริษัทยังไม่เปิดใช้)</span>}
          </label>
        ))}
        <p className="hint">ไม่ติ๊ก Buddy Account = ผู้ใช้เห็นเฉพาะหน้าเปิดโปรแกรม ไม่เห็นเมนูบัญชี (เช่น พนักงานหน้าร้าน) · ไม่ติ๊กเลย = เข้าระบบได้แต่ยังเปิดโปรแกรมใดไม่ได้</p>
      </div>}
    </fieldset>
  );
}
