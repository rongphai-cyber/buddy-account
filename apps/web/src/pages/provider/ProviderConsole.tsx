import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { useSession } from '../../session';
import { cx, DateText, ErrorBox, Field, Modal, PageHead, Pill, Tabs, toast, toastError, useHotkeys } from '../../ui';
import { TenantFeatures, TenantModules } from '../settings/Tenants';
import { QUOTA_LABEL } from '@buddy/core';

/**
 * ศูนย์ผู้ให้บริการ (HANDOFF 204 · เจ้าของ 27/11/2569 "ควรจัดเป็นหมวดหมู่ตามลูกค้าแต่ละราย และเข้าไปดูรายละเอียดบริษัทย่อยๆของลูกค้าได้อีกที")
 * ลูกค้าหนึ่งแถว (บริษัทของลูกค้าอยู่ใต้ชื่อลูกค้า) → รายละเอียดลูกค้า: ภาพรวม บริษัท ผู้ใช้ เมนูที่เปิด กุญแจ API การใช้งาน
 * ไม่มีข้อมูลบัญชีของลูกค้า (ยอดเงิน เอกสาร คู่ค้า) — server ส่งเฉพาะข้อมูลภาพรวม · ใช้ได้โดยไม่ต้องเลือกบริษัท
 */
type CustomerRow = { id: string; code: string; name: string; status: string; suspend_reason: string | null; is_demo: boolean; expires_on: string | null; dpa_signed_on: string | null; require_mfa: boolean;
  moved_to: string | null; purged_at: string | null; contact_email: string | null; package_name: string | null; plan: string; company_count: number; user_count: number; last_login_at: string | null;
  companies: Array<{ id: string; code: string; name: string }> };
const ST: Record<string, [string, 'n' | 'd' | 'x']> = { A: ['ใช้งาน', 'n'], S: ['ระงับ', 'd'], I: ['เลิกใช้', 'x'] };
const statusOf = (t: { status: string; purged_at: string | null; moved_to: string | null }) => (t.purged_at ? ['ลบข้อมูลแล้ว', 'x'] : t.moved_to ? ['ย้ายแล้ว', 'x'] : ST[t.status] ?? [t.status, 'x']) as [string, 'n' | 'd' | 'x'];
const LOCK_NOTE = 'ศูนย์ผู้ให้บริการเห็นเฉพาะภาพรวมของลูกค้า (บริษัท ผู้ใช้ แพ็กเกจ การใช้งาน) — ไม่เห็นและแก้ข้อมูลบัญชีของลูกค้าไม่ได้ ยกเว้นลูกค้าข้อมูลตัวอย่าง (เจ้าของ 27/11/2569)';

export function ProviderCustomersPage() {
  const { me } = useSession();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const list = useQuery({ enabled: !!me?.user.is_platform, queryKey: ['provider-customers'], queryFn: () => api.get<{ rows: CustomerRow[] }>('/api/v1/provider/customers') });
  if (!me?.user.is_platform) return <div className="page"><div className="notebox">เฉพาะเจ้าหน้าที่ผู้ให้บริการโปรแกรม</div></div>;
  const k = q.trim().toLowerCase();
  const rows = (list.data?.rows ?? []).filter((t) => !k || `${t.code} ${t.name} ${t.companies.map((c) => `${c.code} ${c.name}`).join(' ')}`.toLowerCase().includes(k));
  const demo = rows.filter((t) => t.is_demo), real = rows.filter((t) => !t.is_demo);
  const table = (rs: CustomerRow[], empty: string) => (
    <div className="table-wrap">
      <table className="grid provider-grid">
        <thead><tr><th>ลูกค้า</th><th>บริษัทของลูกค้า</th><th>แพ็กเกจ</th><th className="r">ผู้ใช้</th><th>เข้าระบบล่าสุด</th><th>หมดอายุ</th><th>สถานะ</th></tr></thead>
        <tbody>
          {rs.map((t) => {
            const [st, tone] = statusOf(t);
            return (
              <tr key={t.id} className="row-open" onClick={() => nav(`/provider/customers/${t.id}`)} title="คลิกเพื่อดูรายละเอียดลูกค้า">
                <td><b className="mono">{t.code}</b> <span>{t.name}</span>{t.is_demo && <> <Pill tone="d">ข้อมูลตัวอย่าง</Pill></>}</td>
                <td className="small">{t.companies.length ? t.companies.map((c) => <div key={c.id}><span className="mono">{c.code}</span> {c.name}</div>) : <span className="muted">ยังไม่มีบริษัท</span>}</td>
                <td>{t.package_name ?? <span className="muted" title={t.plan}>ไม่มีแพ็กเกจ</span>}</td>
                <td className="r">{t.user_count}</td>
                <td>{t.last_login_at ? <DateText v={t.last_login_at.slice(0, 10)} /> : <span className="muted">—</span>}</td>
                <td>{t.expires_on ? <DateText v={t.expires_on} /> : <span className="muted">ไม่กำหนด</span>}</td>
                <td><Pill tone={tone}>{st}</Pill></td>
              </tr>
            );
          })}
          {list.data && !rs.length && <tr><td colSpan={7} className="empty">{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  );
  return (
    <div className="page" data-tone="setup">
      <PageHead eyebrow="ศูนย์ผู้ให้บริการ" title="ลูกค้าทั้งหมด" lead={LOCK_NOTE}
        actions={<button onClick={() => nav('/admin/tenants')}>ใบสมัคร / เพิ่ม-แก้ไขลูกค้า</button>} />
      <ErrorBox error={list.error} />
      <div className="filters"><input className="search" placeholder="ค้นหารหัส/ชื่อลูกค้า หรือบริษัท" value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหาลูกค้า" />
        <span className="summary"><b>{real.length}</b> ลูกค้า · <b>{demo.length}</b> ข้อมูลตัวอย่าง</span></div>
      <h2 className="section-title">ลูกค้า</h2>
      {table(real, k ? 'ไม่พบลูกค้าที่ค้นหา' : 'ยังไม่มีลูกค้า')}
      <h2 className="section-title">ข้อมูลตัวอย่าง (เจ้าหน้าที่เปิดข้อมูลได้)</h2>
      {table(demo, 'ไม่มีลูกค้าข้อมูลตัวอย่าง')}
    </div>
  );
}

type Detail = {
  tenant: { id: string; code: string; name: string; status: string; suspend_reason: string | null; is_demo: boolean; plan: string; package_name: string | null; contact_email: string | null; contact_phone: string | null;
    expires_on: string | null; dpa_signed_on: string | null; terminated_on: string | null; purge_after: string | null; purged_at: string | null; moved_to: string | null; require_mfa: boolean; single_session: boolean;
    max_companies: number | null; max_users: number | null; created_at: string };
  companies: Array<{ id: string; code: string; name_th: string; status: string; created_at: string; deleted_at: string | null }>;
  users: Array<{ id: string; username: string; display_name: string; status: string; last_login_at: string | null; group_code: string | null; group_name: string | null; totp_enabled: boolean;
    locked_until: string | null; failed_logins: number; company_count: number; invite_open: boolean }>;
  api_keys: Array<{ id: string; name: string; key_prefix: string; status: string; read_only: boolean; created_at: string; last_used_at: string | null; expires_on: string | null; source_system: string | null; username: string; company_code: string | null }>;
  usage: { month: string; rows: Array<{ key: keyof typeof QUOTA_LABEL; used: number | string; limit: number | string | null; pct: number | null; level: string }>; usage: { docs: number; users: number; companies: number; file_bytes: number; ai: number }; companies: Array<{ id: string; code: string; docs: number; vouchers: number }> } | null;
};

export function ProviderCustomerPage() {
  const { id = '' } = useParams();
  const { me } = useSession();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState('overview');
  const [demoAsk, setDemoAsk] = useState(false);
  const q = useQuery({ enabled: !!me?.user.is_platform && !!id, queryKey: ['provider-customer', id], queryFn: () => api.get<Detail>(`/api/v1/provider/customers/${id}`) });
  const reload = () => { void qc.invalidateQueries({ queryKey: ['provider-customer', id] }); void qc.invalidateQueries({ queryKey: ['provider-customers'] }); };
  useHotkeys({ Escape: () => nav('/provider') }, []);
  if (!me?.user.is_platform) return <div className="page"><div className="notebox">เฉพาะเจ้าหน้าที่ผู้ให้บริการโปรแกรม</div></div>;
  const d = q.data, t = d?.tenant;
  const act = (p: Promise<unknown>, ok: string) => p.then(() => { toast(ok); reload(); }).catch(toastError);
  const sendLink = (u: Detail['users'][number]) => api.post<{ emailed_to: string; mail_status: string }>(`/api/v1/provider/users/${u.id}/email-invite`)
    .then((r) => { toast(`ส่งลิงก์ตั้งรหัสผ่านของ ${u.username} ไปที่ ${r.emailed_to}${r.mail_status === 'S' ? '' : ' (เครื่องนี้ไม่ได้ส่งอีเมลจริง)'} — ผู้ให้บริการไม่เห็นลิงก์`); reload(); }).catch(toastError);
  return (
    <div className="page" data-tone="setup">
      <PageHead eyebrow="ศูนย์ผู้ให้บริการ › ลูกค้าทั้งหมด" title={t ? `${t.code} · ${t.name}` : 'ลูกค้า'} lead={LOCK_NOTE}
        actions={<><button onClick={() => nav('/provider')}>← ลูกค้าทั้งหมด <kbd>Esc</kbd></button><button onClick={() => nav('/admin/tenants')}>แก้ไขลูกค้า / แพ็กเกจ…</button></>} />
      <ErrorBox error={q.error} />
      {d && t && <>
        <Tabs active={tab} onChange={setTab} tabs={[{ key: 'overview', label: 'ภาพรวม' }, { key: 'companies', label: 'บริษัท', badge: d.companies.filter((c) => !c.deleted_at).length },
          { key: 'users', label: 'ผู้ใช้', badge: d.users.length }, { key: 'menus', label: 'เมนูที่เปิด' }, { key: 'keys', label: 'กุญแจ API', badge: d.api_keys.length }, { key: 'usage', label: 'การใช้งาน' }]} />
        {tab === 'overview' && <div className="form-grid provider-overview">
          <Field label="สถานะ"><Pill tone={statusOf(t)[1]}>{statusOf(t)[0]}</Pill></Field>
          <Field label="แพ็กเกจ">{t.package_name ?? <span className="muted">ไม่มีแพ็กเกจ ({t.plan})</span>}</Field>
          <Field label="หมดอายุ">{t.expires_on ? <DateText v={t.expires_on} /> : <span className="muted">ไม่กำหนด</span>}</Field>
          <Field label="ลงนาม DPA">{t.dpa_signed_on ? <DateText v={t.dpa_signed_on} /> : <span className="muted">ยังไม่ลงนาม</span>}</Field>
          <Field label="อีเมลผู้ติดต่อ" hint="แสดงแบบปิดบัง — ลิงก์ตั้งรหัสผ่านส่งไปอีเมลนี้">{t.contact_email ?? <span className="bad">ยังไม่มี</span>}</Field>
          <Field label="ยืนยันตัวตนสองขั้นทุกผู้ใช้">{t.require_mfa ? 'บังคับ' : 'ไม่บังคับ'}{t.single_session ? ' · 1 เครื่อง' : ''}</Field>
          <Field label="ข้อมูลตัวอย่าง" wide hint="ติ๊ก = เจ้าหน้าที่ผู้ให้บริการเปิดข้อมูลบัญชีของลูกค้านี้ได้ — ใช้กับข้อมูลทดลองเท่านั้น (บันทึกเหตุการณ์ทุกครั้ง)">
            <span>{t.is_demo ? <Pill tone="d">ข้อมูลตัวอย่าง — เจ้าหน้าที่เปิดข้อมูลได้</Pill> : <Pill tone="n">ลูกค้าจริง — ข้อมูลเป็นความลับ</Pill>}{' '}
              <button type="button" onClick={() => (t.is_demo ? act(api.put(`/api/v1/provider/customers/${t.id}/demo`, { is_demo: false }), 'เลิกเป็นข้อมูลตัวอย่างแล้ว') : setDemoAsk(true))}>
                {t.is_demo ? 'เลิกเป็นข้อมูลตัวอย่าง' : 'ตั้งเป็นข้อมูลตัวอย่าง…'}</button></span>
          </Field>
        </div>}
        {tab === 'companies' && <div className="table-wrap"><table className="grid">
          <thead><tr><th>รหัสบริษัท</th><th>ชื่อบริษัท</th><th className="r">เอกสาร (เดือนนี้)</th><th>สร้างเมื่อ</th><th>สถานะ</th></tr></thead>
          <tbody>{d.companies.map((c) => <tr key={c.id} className={cx(c.deleted_at && 'void')}><td className="mono">{c.code}</td><td>{c.name_th}</td>
            <td className="r">{d.usage?.companies.find((x) => x.id === c.id)?.docs ?? 0}</td><td><DateText v={c.created_at.slice(0, 10)} /></td>
            <td>{c.deleted_at ? <Pill tone="x">ลบแล้ว</Pill> : <Pill tone="n">ใช้งาน</Pill>}</td></tr>)}
            {!d.companies.length && <tr><td colSpan={5} className="empty">ยังไม่มีบริษัท</td></tr>}</tbody>
        </table>{!t.is_demo && <p className="small muted">เปิดบริษัทของลูกค้าจริงไม่ได้ — ลูกค้าต้องการให้ช่วย: ให้ผู้ดูแลของลูกค้าสร้างผู้ใช้ให้ในกิจการของลูกค้าเอง</p>}</div>}
        {tab === 'users' && <div className="table-wrap"><table className="grid">
          <thead><tr><th>รหัสผู้ใช้</th><th>ชื่อ</th><th>กลุ่ม</th><th className="r">บริษัท</th><th>2FA</th><th>เข้าระบบล่าสุด</th><th>สถานะ</th><th>ช่วยเหลือ (ไม่เห็นรหัสผ่าน)</th></tr></thead>
          <tbody>{d.users.map((u) => {
            const locked = !!u.locked_until && new Date(u.locked_until).getTime() > Date.now();
            return <tr key={u.id}><td className="mono">{u.username}</td><td>{u.display_name}</td><td>{u.group_code ?? <span className="muted">—</span>}</td><td className="r">{u.group_code === 'ADMIN' ? 'ทั้งหมด' : u.company_count}</td>
              <td>{u.totp_enabled ? <Pill tone="n">เปิด</Pill> : <Pill tone="d">ยังไม่ตั้ง</Pill>}</td>
              <td>{u.last_login_at ? <DateText v={u.last_login_at.slice(0, 10)} /> : <span className="muted">—</span>}</td>
              <td>{u.status !== 'A' ? <Pill tone="x">ระงับ</Pill> : locked ? <Pill tone="d">ล็อก ({u.failed_logins} ครั้ง)</Pill> : <Pill tone="n">ใช้งาน</Pill>}{u.invite_open && <> <Pill tone="c">รอตั้งรหัส</Pill></>}</td>
              <td className="row-actions">
                {locked && <button type="button" onClick={() => act(api.post(`/api/v1/users/${u.id}/unlock`), `ปลดล็อก ${u.username} แล้ว`)}>ปลดล็อก</button>}
                {u.totp_enabled && <button type="button" onClick={() => window.confirm(`ล้างยืนยันตัวตนสองขั้นของ ${u.username}? ระบบแจ้งลูกค้าทางอีเมลผู้ติดต่อ`) && act(api.post(`/api/v1/users/${u.id}/reset-2fa`), `ล้าง 2FA ของ ${u.username} แล้ว · แจ้งลูกค้าทางอีเมลแล้ว`)}>ล้าง 2FA</button>}
                {!u.totp_enabled && u.status === 'A' && <button type="button" onClick={() => void sendLink(u)} title="ลิงก์ส่งไปอีเมลผู้ติดต่อของลูกค้าเท่านั้น — ผู้ให้บริการไม่เห็นลิงก์">ส่งลิงก์ตั้งรหัสผ่านทางอีเมล</button>}
              </td></tr>;
          })}</tbody>
        </table></div>}
        {tab === 'menus' && <div className="form-grid"><TenantModules tenantId={t.id} /><TenantFeatures tenantId={t.id} /></div>}
        {tab === 'keys' && <div className="table-wrap"><table className="grid">
          <thead><tr><th>ชื่อกุญแจ</th><th>รหัสขึ้นต้น</th><th>ผู้ใช้</th><th>บริษัท</th><th>ระบบ</th><th>ใช้ล่าสุด</th><th>สถานะ</th></tr></thead>
          <tbody>{d.api_keys.map((k) => <tr key={k.id}><td>{k.name}{k.read_only && <> <Pill tone="c">อ่านอย่างเดียว</Pill></>}</td><td className="mono">{k.key_prefix}…</td><td className="mono">{k.username}</td><td className="mono">{k.company_code ?? '—'}</td>
            <td>{k.source_system ?? '—'}</td><td>{k.last_used_at ? <DateText v={k.last_used_at.slice(0, 10)} /> : <span className="muted">ยังไม่ใช้</span>}</td><td><Pill tone={k.status === 'A' ? 'n' : 'x'}>{k.status === 'A' ? 'ใช้งาน' : 'ยกเลิก'}</Pill></td></tr>)}
            {!d.api_keys.length && <tr><td colSpan={7} className="empty">ยังไม่มีกุญแจ API — เปิดเมนู "กุญแจ API" ให้ลูกค้าที่แท็บ เมนูที่เปิด แล้วผู้ดูแลของลูกค้าสร้างเอง</td></tr>}</tbody>
        </table></div>}
        {tab === 'usage' && d.usage && <div className="table-wrap"><table className="grid">
          <thead><tr><th>รายการ (เดือน {d.usage.month})</th><th className="r">ใช้ไป</th><th className="r">ขีดจำกัด</th><th className="r">%</th></tr></thead>
          <tbody>{d.usage.rows.map((r) => <tr key={r.key}><td>{QUOTA_LABEL[r.key] ?? r.key}{r.key === 'files' ? ' (MB)' : ''}</td><td className="r">{String(r.used)}</td><td className="r">{r.limit == null ? 'ไม่จำกัด' : String(r.limit)}</td><td className="r">{r.pct == null ? '—' : `${r.pct}%`}</td></tr>)}</tbody>
        </table><p className="small muted">นับจำนวนเท่านั้น (เอกสาร ใบสำคัญ ไฟล์ AI) — ไม่มีเนื้อหาเอกสารหรือยอดเงิน</p></div>}
      </>}
      {demoAsk && t && <DemoConfirm code={t.code} onClose={() => setDemoAsk(false)} onOk={(confirm) => api.put(`/api/v1/provider/customers/${t.id}/demo`, { is_demo: true, confirm })
        .then(() => { setDemoAsk(false); toast(`ตั้ง ${t.code} เป็นข้อมูลตัวอย่างแล้ว`); reload(); }).catch(toastError)} />}
    </div>
  );
}

function DemoConfirm({ code, onClose, onOk }: { code: string; onClose: () => void; onOk: (confirm: string) => void }) {
  const [v, setV] = useState('');
  return (
    <Modal title="ตั้งเป็นลูกค้าข้อมูลตัวอย่าง" size="confirm" onClose={onClose} footer={<><button onClick={onClose}>ยกเลิก</button><button className="danger" disabled={v.trim().toUpperCase() !== code.toUpperCase()} onClick={() => onOk(v.trim())}>ยืนยัน</button></>}>
      <div className="notebox warn">เจ้าหน้าที่ผู้ให้บริการจะเปิดข้อมูลบัญชีทั้งหมดของลูกค้านี้ได้ — ใช้กับข้อมูลทดลอง/ตัวอย่างเท่านั้น ห้ามใช้กับลูกค้าจริง</div>
      <Field label={`พิมพ์รหัสลูกค้า ${code} เพื่อยืนยัน`}><input autoFocus value={v} onChange={(e) => setV(e.target.value)} /></Field>
    </Modal>
  );
}
