import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { useSession } from '../../session';
import { DateInput, DateText, ErrorBox, Field, Modal, PageHead, Pill, toast, useHotkeys } from '../../ui';

interface Tenant { id: string; code: string; name: string; contact_email: string | null; contact_phone: string | null; plan: string; max_companies: number | null; max_users: number | null; expires_on: string | null; status: string; company_count: number; user_count: number;
  dpa_signed_on: string | null; terminated_on: string | null; purge_after: string | null; purged_at: string | null; moved_to: string | null }
const ST: Record<string, [string, 'n' | 'd' | 'x']> = { A: ['ใช้งาน', 'n'], S: ['ระงับ', 'd'], I: ['เลิกใช้', 'x'] };

/** ลูกค้าผู้ใช้บริการ (tenant) — เฉพาะเจ้าหน้าที่ผู้ให้บริการโปรแกรม: ลูกค้าแต่ละรายมีบริษัทและผู้ใช้ของตัวเอง ข้อมูลไม่ปนกัน */
export function TenantsPage() {
  const { me } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ enabled: !!me?.user.is_platform, queryKey: ['tenants'], queryFn: () => api.get<Tenant[]>('/api/v1/tenants') });
  const [edit, setEdit] = useState<Tenant | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  useHotkeys({ Insert: () => setEdit('new') }, []);
  if (!me?.user.is_platform) return <div className="page"><div className="notebox">เฉพาะเจ้าหน้าที่ผู้ให้บริการโปรแกรม</div></div>;
  return (
    <div className="page" data-tone="setup">
      <PageHead eyebrow="เริ่มระบบ › ลูกค้าผู้ใช้บริการ" title="ลูกค้าผู้ใช้บริการ" lead="ลูกค้าแต่ละรายเห็นเฉพาะบริษัท ผู้ใช้ และข้อมูลของตัวเอง — ระงับแล้วผู้ใช้ทุกคนของลูกค้ารายนั้นออกจากระบบทันที · เลิกใช้บริการแล้ว 90 วันลบข้อมูลได้ (PDPA)"
        actions={<><button onClick={() => setImporting(true)}>⬆ รับลูกค้าที่ย้ายมา…</button><button className="primary" onClick={() => setEdit('new')}>+ เพิ่มลูกค้า <kbd>Ins</kbd></button></>} />
      <ErrorBox error={q.error} />
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th>รหัส</th><th>ชื่อลูกค้า</th><th>ผู้ติดต่อ</th><th>แพ็กเกจ</th><th className="r">บริษัท</th><th className="r">ผู้ใช้</th><th>หมดอายุ</th><th>ข้อตกลง DPA</th><th>สถานะ</th></tr></thead>
          <tbody>
            {q.data?.map((t) => (
              <tr key={t.id} className="row-open" onClick={() => setEdit(t)}>
                <td className="mono">{t.code}</td><td>{t.name}</td><td className="small">{t.contact_email} {t.contact_phone}</td><td>{t.plan}</td>
                <td className="r">{t.company_count}{t.max_companies ? ` / ${t.max_companies}` : ''}</td><td className="r">{t.user_count}{t.max_users ? ` / ${t.max_users}` : ''}</td>
                <td><DateText v={t.expires_on} /></td><td>{t.dpa_signed_on ? <DateText v={t.dpa_signed_on} /> : <span className="small muted">ยังไม่ลงนาม</span>}</td>
                <td><Pill tone={ST[t.status]?.[1]}>{t.purged_at ? 'ลบข้อมูลแล้ว' : t.moved_to ? 'ย้ายแล้ว' : ST[t.status]?.[0]}</Pill>{t.moved_to && <div className="small muted">{t.moved_to}</div>}{t.purge_after && !t.purged_at && !t.moved_to && <div className="small muted">ลบได้ตั้งแต่ <DateText v={t.purge_after} /></div>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {importing && <ImportTenant onClose={() => setImporting(false)} onDone={() => qc.invalidateQueries({ queryKey: ['tenants'] })} />}
      {edit && <TenantForm t={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); qc.invalidateQueries({ queryKey: ['tenants'] }); }} />}
    </div>
  );
}

function TenantForm({ t, onClose, onSaved }: { t: Tenant | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ code: t?.code ?? '', name: t?.name ?? '', contact_email: t?.contact_email ?? '', contact_phone: t?.contact_phone ?? '', plan: t?.plan ?? 'standard',
    max_companies: t?.max_companies?.toString() ?? '', max_users: t?.max_users?.toString() ?? '', expires_on: t?.expires_on ?? '', status: t?.status ?? 'A', dpa_signed_on: t?.dpa_signed_on ?? '', moved_to: t?.moved_to ?? '', admin_username: '', admin_name: '', admin_password: '' });
  const [err, setErr] = useState<unknown>(null);
  const [purge, setPurge] = useState(false);
  const [exporting, setExporting] = useState(false);
  const body = { ...f, contact_email: f.contact_email || null, contact_phone: f.contact_phone || null, max_companies: f.max_companies ? Number(f.max_companies) : null, max_users: f.max_users ? Number(f.max_users) : null, expires_on: f.expires_on || null, dpa_signed_on: f.dpa_signed_on || null, moved_to: f.moved_to || null };
  const save = () => (t ? api.put(`/api/v1/tenants/${t.id}`, body) : api.post('/api/v1/tenants', body)).then(() => { toast('บันทึกลูกค้าแล้ว'); onSaved(); }).catch(setErr);
  useHotkeys({ F9: save, 'Ctrl+S': save }, [f]);
  if (t?.purged_at) return (
    <Modal title={`ลูกค้า ${t.code}`} onClose={onClose} footer={<button onClick={onClose}>ปิด</button>}>
      <div className="notebox">ลบข้อมูลทั้งหมดของลูกค้ารายนี้แล้วเมื่อ <DateText v={t.purged_at.slice(0, 10)} /> (เลิกใช้บริการ <DateText v={t.terminated_on} />) — เหลือเฉพาะรหัสลูกค้าและแฟ้มบันทึกเหตุการณ์ แก้ไขหรือเปิดใช้อีกไม่ได้</div>
    </Modal>
  );
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
        <Field label="ลงนามข้อตกลงประมวลผลข้อมูล (DPA)" hint="ดูแบบข้อตกลงใน docs/06_PDPA.md"><DateInput value={f.dpa_signed_on} onChange={(v) => setF({ ...f, dpa_signed_on: v })} /></Field>
        {t && <>
          <h3 className="wide">ย้ายไปเซิร์ฟเวอร์/ฐานข้อมูลแยก (ลูกค้ารายใหญ่)</h3>
          <p className="wide small muted">1) ส่งออกแฟ้มย้ายลูกค้า 2) ที่เครื่องใหม่กด "รับลูกค้าที่ย้ายมา" 3) ตรวจผลแล้วกลับมาใส่ที่อยู่ใหม่ และเปลี่ยนสถานะเป็น "เลิกใช้" — ผู้ใช้จะถูกบอกให้ไปเข้าที่อยู่ใหม่ และลบสำเนาที่เครื่องนี้ได้ทันที</p>
          <Field label="ย้ายไปที่ (ที่อยู่ของเครื่องใหม่)" wide><input value={f.moved_to} placeholder="เช่น https://bigco.buddy.example" onChange={(e) => setF({ ...f, moved_to: e.target.value })} /></Field>
          <div className="wide"><button onClick={() => setExporting(true)}>⬇ ส่งออกเพื่อย้าย…</button></div>
        </>}
        {t && f.status === 'I' && <div className="wide notebox">
          {t.status === 'I' && t.purge_after
            ? t.moved_to ? <>ย้ายไปที่ {t.moved_to} แล้ว — ลบสำเนาที่เครื่องนี้ได้ทันที{' '}<button className="danger" onClick={() => setPurge(true)}>ลบข้อมูลทั้งหมดของลูกค้า…</button></> : <>เลิกใช้บริการเมื่อ <DateText v={t.terminated_on} /> · ลบข้อมูลได้ตั้งแต่ <DateText v={t.purge_after} /> — ระหว่างนี้ให้สำรองข้อมูลแต่ละบริษัทส่งให้ลูกค้าถ้าลูกค้าขอ
              {' '}<button className="danger" onClick={() => setPurge(true)}>ลบข้อมูลทั้งหมดของลูกค้า…</button></>
            : <>บันทึกสถานะ "เลิกใช้" แล้ว ผู้ใช้ของลูกค้าเข้าระบบไม่ได้ และระบบนับ 90 วันก่อนลบข้อมูลได้ (ให้ลูกค้าขอสำเนาข้อมูลก่อน)</>}
        </div>}
        {!t && <>
          <h3 className="wide">ผู้ดูแลระบบคนแรกของลูกค้า</h3>
          <Field label="รหัสผู้ใช้" req><input value={f.admin_username} onChange={(e) => setF({ ...f, admin_username: e.target.value })} /></Field>
          <Field label="ชื่อ" req><input value={f.admin_name} onChange={(e) => setF({ ...f, admin_name: e.target.value })} /></Field>
          <Field label="รหัสผ่านเริ่มต้น (อย่างน้อย 8 ตัว)" req wide><input type="password" autoComplete="new-password" value={f.admin_password} onChange={(e) => setF({ ...f, admin_password: e.target.value })} /></Field>
        </>}
      </div>
      {purge && t && <PurgeTenant t={t} onClose={() => setPurge(false)} onDone={onSaved} />}
      {exporting && t && <ExportTenant t={t} onClose={() => setExporting(false)} />}
    </Modal>
  );
}

/** T0.17 ลบข้อมูลทั้งหมดของลูกค้าที่เลิกใช้บริการ — พิมพ์รหัสลูกค้ายืนยัน */
function PurgeTenant({ t, onClose, onDone }: { t: Tenant; onClose: () => void; onDone: () => void }) {
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const run = () => { setBusy(true); api.post<{ companies: number; users: number }>(`/api/v1/tenants/${t.id}/purge`, { confirm })
    .then((r) => { toast(`ลบข้อมูลแล้ว ${r.companies} บริษัท · ปิดบังผู้ใช้ ${r.users} คน`); onDone(); }).catch(setErr).finally(() => setBusy(false)); };
  return (
    <Modal title={`ลบข้อมูลทั้งหมดของลูกค้า ${t.code}`} onClose={onClose}
      footer={<><button onClick={onClose}>ยกเลิก</button><button className="danger" disabled={busy || confirm.trim().toUpperCase() !== t.code.toUpperCase()} onClick={run}>{busy ? 'กำลังลบ…' : 'ลบถาวร'}</button></>}>
      <ErrorBox error={err} />
      <p>ข้อมูลทุกบริษัทของลูกค้ารายนี้ ({t.company_count} บริษัท) จะถูกลบถาวร — เอกสาร ใบสำคัญ แฟ้มหลัก ภาษี และการเข้าระบบ · ชื่อผู้ใช้ {t.user_count} คนถูกปิดบัง · แฟ้มบันทึกเหตุการณ์คงไว้ตามกฎหมาย</p>
      <p className="small muted">ตรวจให้แน่ใจว่าส่งแฟ้มสำรองข้อมูลให้ลูกค้าแล้ว (ถ้าลูกค้าขอ) — ลบแล้วเรียกคืนไม่ได้</p>
      <Field label={`พิมพ์รหัสลูกค้า ${t.code} เพื่อยืนยัน`} req><input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoFocus /></Field>
    </Modal>
  );
}

/** T0.18 ส่งออกลูกค้าทั้งรายเป็นแฟ้มย้าย (เข้ารหัสด้วยรหัสผ่านที่ตั้งที่นี่ — ส่งรหัสผ่านให้ผู้ติดตั้งเครื่องใหม่แยกจากแฟ้ม) */
function ExportTenant({ t, onClose }: { t: Tenant; onClose: () => void }) {
  const [p1, setP1] = useState(''); const [p2, setP2] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/v1/tenants/${t.id}/export`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passphrase: p1 }) });
      if (!res.ok) { const j = await res.json().catch(() => null); throw new Error(j?.error?.message ?? `ส่งออกไม่สำเร็จ (${res.status})`); }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `${t.code}.buddy-tenant`;
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast(`ส่งออกแล้ว ${name} (${(blob.size / 1048576).toFixed(1)} MB)`); onClose();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const ok = p1.length >= 12 && p1 === p2;
  return (
    <Modal size="confirm" title={`ส่งออกลูกค้า ${t.code} เพื่อย้าย`} onClose={onClose}
      footer={<><button onClick={onClose}>ยกเลิก</button><button className="primary" disabled={!ok || busy} onClick={run}>{busy ? 'กำลังส่งออก…' : '⬇ ส่งออก'}</button></>}>
      <ErrorBox error={err} />
      <p>แฟ้มมีข้อมูลทุกบริษัท ผู้ใช้ (รหัสผ่านและ 2FA เดิม) และแฟ้มบันทึกเหตุการณ์ของลูกค้ารายนี้ เข้ารหัสด้วยรหัสผ่านด้านล่าง — ส่งรหัสผ่านแยกจากแฟ้ม</p>
      <p className="small muted">ลูกค้ายังใช้งานที่นี่ต่อได้ ถ้ามีการบันทึกหลังส่งออก ให้ส่งออกใหม่ก่อนย้ายจริง (แนะนำทำนอกเวลาทำงาน)</p>
      <div className="form-grid">
        <Field label="รหัสผ่านของแฟ้ม (อย่างน้อย 12 ตัว)" req wide><input type="password" autoComplete="new-password" value={p1} onChange={(e) => setP1(e.target.value)} autoFocus /></Field>
        <Field label="ยืนยันรหัสผ่าน" req wide error={p2 && p1 !== p2 ? 'รหัสผ่านไม่ตรงกัน' : undefined}><input type="password" autoComplete="new-password" value={p2} onChange={(e) => setP2(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

type ImportResult = { tenant: { code: string; name: string }; counts: Record<string, number>; users_cleared: number; ok: boolean; seconds: number;
  checks: Array<{ code: string; name: string; ok: boolean; source: { journals: number; debit: string }; target: { journals: number; debit: string } }> };
/** T0.18 รับลูกค้าที่ย้ายมาจากเครื่องอื่น (แฟ้ม .buddy-tenant) แล้วตรวจยอดใบสำคัญรายบริษัท */
function ImportTenant({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [pass, setPass] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ImportResult | null>(null);
  const run = async () => {
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/v1/tenants/import', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/octet-stream', 'x-buddy-passphrase': encodeURIComponent(pass) }, body: file });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error?.message ?? `นำเข้าไม่สำเร็จ (${r.status})`);
      setRes(j); onDone();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const baht = (v: string) => Number(v).toLocaleString('th-TH', { minimumFractionDigits: 2 });
  return (
    <Modal title="รับลูกค้าที่ย้ายมาจากเครื่องอื่น" onClose={onClose}
      footer={res ? <button className="primary" onClick={onClose}>ปิด</button> : <><button onClick={onClose}>ยกเลิก</button><button className="primary" disabled={!file || pass.length < 12 || busy} onClick={run}>{busy ? 'กำลังนำเข้า…' : '⬆ นำเข้า'}</button></>}>
      <ErrorBox error={err} />
      {!res ? <>
        <p>เลือกแฟ้ม .buddy-tenant ที่ส่งออกจากเครื่องเดิม — เครื่องนี้ต้องเป็นโปรแกรมรุ่นเดียวกัน และต้องยังไม่มีลูกค้า/บริษัท/ผู้ใช้รหัสเดียวกัน</p>
        <div className="form-grid">
          <Field label="แฟ้มย้ายลูกค้า" req wide><input type="file" accept=".buddy-tenant" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
          <Field label="รหัสผ่านของแฟ้ม" req wide><input type="password" autoComplete="off" value={pass} onChange={(e) => setPass(e.target.value)} /></Field>
        </div>
        {busy && <p className="small muted">ลูกค้าขนาดใหญ่ใช้เวลาหลายนาที (ข้อมูลตัวอย่าง DEMO ประมาณ 40 วินาที) — อย่าปิดหน้านี้</p>}
      </> : <>
        <div className="notebox">{res.ok ? '✅' : '⚠️'} รับลูกค้า {res.tenant.code} {res.tenant.name} แล้ว · {Object.values(res.counts).reduce((a, n) => a + n, 0).toLocaleString()} แถว · {res.seconds} วินาที
          {res.users_cleared ? ` · ช่องผู้บันทึกที่เป็นเจ้าหน้าที่เครื่องเดิม ${res.users_cleared.toLocaleString()} ช่องเป็นว่าง` : ''}</div>
        <table className="grid" style={{ width: '100%' }}><thead><tr><th>บริษัท</th><th className="r">ใบสำคัญ เดิม / ใหม่</th><th className="r">เดบิตรวม เดิม / ใหม่</th><th>ผล</th></tr></thead>
          <tbody>{res.checks.map((c) => <tr key={c.code}><td>{c.code} {c.name}</td><td className="r">{c.source.journals.toLocaleString()} / {c.target.journals.toLocaleString()}</td>
            <td className="r">{baht(c.source.debit)} / {baht(c.target.debit)}</td><td>{c.ok ? '✅ ตรง' : '❌ ไม่ตรง'}</td></tr>)}</tbody></table>
        <p className="small">ผู้ใช้ของลูกค้าเข้าเครื่องนี้ได้ด้วยรหัสผู้ใช้ รหัสผ่าน และ 2FA เดิม — กลับไปที่เครื่องเดิมแล้วใส่ "ย้ายไปที่" และเปลี่ยนสถานะเป็นเลิกใช้</p>
      </>}
    </Modal>
  );
}
