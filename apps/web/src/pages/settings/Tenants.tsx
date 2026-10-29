import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { useSession } from '../../session';
import { DateInput, DateText, ErrorBox, Field, Modal, PageHead, Pill, toast, useHotkeys } from '../../ui';

interface Tenant { id: string; code: string; name: string; contact_email: string | null; contact_phone: string | null; plan: string; max_companies: number | null; max_users: number | null; expires_on: string | null; status: string; company_count: number; user_count: number }
const ST: Record<string, [string, 'n' | 'd' | 'x']> = { A: ['ใช้งาน', 'n'], S: ['ระงับ', 'd'], I: ['เลิกใช้', 'x'] };

/** ลูกค้าผู้ใช้บริการ (tenant) — เฉพาะเจ้าหน้าที่ผู้ให้บริการโปรแกรม: ลูกค้าแต่ละรายมีบริษัทและผู้ใช้ของตัวเอง ข้อมูลไม่ปนกัน */
export function TenantsPage() {
  const { me } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ enabled: !!me?.user.is_platform, queryKey: ['tenants'], queryFn: () => api.get<Tenant[]>('/api/v1/tenants') });
  const [edit, setEdit] = useState<Tenant | 'new' | null>(null);
  useHotkeys({ Insert: () => setEdit('new') }, []);
  if (!me?.user.is_platform) return <div className="page"><div className="notebox">เฉพาะเจ้าหน้าที่ผู้ให้บริการโปรแกรม</div></div>;
  return (
    <div className="page" data-tone="setup">
      <PageHead eyebrow="เริ่มระบบ › ลูกค้าผู้ใช้บริการ" title="ลูกค้าผู้ใช้บริการ" lead="ลูกค้าแต่ละรายเห็นเฉพาะบริษัท ผู้ใช้ และข้อมูลของตัวเอง — ระงับแล้วผู้ใช้ทุกคนของลูกค้ารายนั้นออกจากระบบทันที"
        actions={<button className="primary" onClick={() => setEdit('new')}>+ เพิ่มลูกค้า <kbd>Ins</kbd></button>} />
      <ErrorBox error={q.error} />
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th>รหัส</th><th>ชื่อลูกค้า</th><th>ผู้ติดต่อ</th><th>แพ็กเกจ</th><th className="r">บริษัท</th><th className="r">ผู้ใช้</th><th>หมดอายุ</th><th>สถานะ</th></tr></thead>
          <tbody>
            {q.data?.map((t) => (
              <tr key={t.id} className="row-open" onClick={() => setEdit(t)}>
                <td className="mono">{t.code}</td><td>{t.name}</td><td className="small">{t.contact_email} {t.contact_phone}</td><td>{t.plan}</td>
                <td className="r">{t.company_count}{t.max_companies ? ` / ${t.max_companies}` : ''}</td><td className="r">{t.user_count}{t.max_users ? ` / ${t.max_users}` : ''}</td>
                <td><DateText v={t.expires_on} /></td><td><Pill tone={ST[t.status]?.[1]}>{ST[t.status]?.[0]}</Pill></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <TenantForm t={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); qc.invalidateQueries({ queryKey: ['tenants'] }); }} />}
    </div>
  );
}

function TenantForm({ t, onClose, onSaved }: { t: Tenant | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ code: t?.code ?? '', name: t?.name ?? '', contact_email: t?.contact_email ?? '', contact_phone: t?.contact_phone ?? '', plan: t?.plan ?? 'standard',
    max_companies: t?.max_companies?.toString() ?? '', max_users: t?.max_users?.toString() ?? '', expires_on: t?.expires_on ?? '', status: t?.status ?? 'A', admin_username: '', admin_name: '', admin_password: '' });
  const [err, setErr] = useState<unknown>(null);
  const body = { ...f, contact_email: f.contact_email || null, contact_phone: f.contact_phone || null, max_companies: f.max_companies ? Number(f.max_companies) : null, max_users: f.max_users ? Number(f.max_users) : null, expires_on: f.expires_on || null };
  const save = () => (t ? api.put(`/api/v1/tenants/${t.id}`, body) : api.post('/api/v1/tenants', body)).then(() => { toast('บันทึกลูกค้าแล้ว'); onSaved(); }).catch(setErr);
  useHotkeys({ F9: save, 'Ctrl+S': save }, [f]);
  return (
    <Modal title={t ? `แก้ไขลูกค้า ${t.code}` : 'เพิ่มลูกค้าผู้ใช้บริการ'} onClose={onClose} footer={<><button onClick={onClose}>ยกเลิก</button><button className="primary" onClick={save}>บันทึก <kbd>F9</kbd></button></>}>
      <ErrorBox error={err} />
      <div className="form-grid">
        <Field label="รหัสลูกค้า" req><input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} readOnly={!!t} /></Field>
        <Field label="สถานะ"><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="A">ใช้งาน</option><option value="S">ระงับ</option><option value="I">เลิกใช้</option></select></Field>
        <Field label="ชื่อลูกค้า" req wide><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="อีเมลผู้ติดต่อ"><input value={f.contact_email} onChange={(e) => setF({ ...f, contact_email: e.target.value })} /></Field>
        <Field label="โทรศัพท์"><input value={f.contact_phone} onChange={(e) => setF({ ...f, contact_phone: e.target.value })} /></Field>
        <Field label="แพ็กเกจ"><input value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })} /></Field>
        <Field label="หมดอายุ"><DateInput value={f.expires_on} onChange={(v) => setF({ ...f, expires_on: v })} /></Field>
        <Field label="จำนวนบริษัทสูงสุด" hint="ว่าง = ไม่จำกัด"><input className="num" value={f.max_companies} onChange={(e) => setF({ ...f, max_companies: e.target.value.replace(/\D/g, '') })} /></Field>
        <Field label="จำนวนผู้ใช้สูงสุด" hint="ว่าง = ไม่จำกัด"><input className="num" value={f.max_users} onChange={(e) => setF({ ...f, max_users: e.target.value.replace(/\D/g, '') })} /></Field>
        {!t && <>
          <h3 className="wide">ผู้ดูแลระบบคนแรกของลูกค้า</h3>
          <Field label="รหัสผู้ใช้" req><input value={f.admin_username} onChange={(e) => setF({ ...f, admin_username: e.target.value })} /></Field>
          <Field label="ชื่อ" req><input value={f.admin_name} onChange={(e) => setF({ ...f, admin_name: e.target.value })} /></Field>
          <Field label="รหัสผ่านเริ่มต้น (อย่างน้อย 8 ตัว)" req wide><input type="password" autoComplete="new-password" value={f.admin_password} onChange={(e) => setF({ ...f, admin_password: e.target.value })} /></Field>
        </>}
      </div>
    </Modal>
  );
}
