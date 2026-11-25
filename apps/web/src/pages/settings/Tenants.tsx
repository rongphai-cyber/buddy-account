import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { useSession } from '../../session';
import { SignupsPanel } from './Signups';
import { PlatformAiKey } from './PlatformAiKey';
import { DateInput, DateText, ErrorBox, Field, Modal, PageHead, PasswordInput, Pill, toast, toastError, useHotkeys } from '../../ui';
import { packageBody, PackageFields, packageValues } from '../../components/PackageFields';
import { useNavigate } from 'react-router-dom';
import { AI_PAYER_TH, SUSPEND_REASON_TH, TENANT_RETENTION_DAYS, tenantCountdown, tenantCountingDown, todayIso, type SuspendReason } from '@buddy/core';

interface Tenant { id: string; code: string; name: string; contact_email: string | null; contact_phone: string | null; plan: string; max_companies: number | null; max_users: number | null; expires_on: string | null; status: string; company_count: number; user_count: number;
  dpa_signed_on: string | null; terminated_on: string | null; purge_after: string | null; purged_at: string | null; moved_to: string | null; single_session?: boolean; suspend_reason?: SuspendReason | null;
  package_id?: string | null; package_name?: string | null; docs_per_month?: number | null; file_quota_mb?: number | null; ai_per_month?: number | null; over_action?: 'W' | 'S'; ai_payer?: 'C' | 'P'; ai_limit_usd?: string | null }
const ST: Record<string, [string, 'n' | 'd' | 'x']> = { A: ['ใช้งาน', 'n'], S: ['ระงับ', 'd'], I: ['เลิกใช้', 'x'] };

/** ลูกค้าผู้ใช้บริการ (tenant) — เฉพาะเจ้าหน้าที่ผู้ให้บริการโปรแกรม: ลูกค้าแต่ละรายมีบริษัทและผู้ใช้ของตัวเอง ข้อมูลไม่ปนกัน */
export function TenantsPage() {
  const { me } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ enabled: !!me?.user.is_platform, queryKey: ['tenants'], queryFn: () => api.get<Tenant[]>('/api/v1/tenants') });
  const [edit, setEdit] = useState<Tenant | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const [aiKey, setAiKey] = useState(false);
  // HANDOFF 186: กรองลูกค้าที่กำลังนับวันลบ / ครบกำหนดลบ
  const [due, setDue] = useState<'' | 'counting' | 'due'>('');
  const today = todayIso();
  const rows = (q.data ?? []).filter((t) => !due || (!t.purged_at && !t.moved_to && tenantCountingDown(t) && (due === 'counting' || t.purge_after! <= today)));
  useHotkeys({ Insert: () => setEdit('new') }, []);
  if (!me?.user.is_platform) return <div className="page"><div className="notebox">เฉพาะเจ้าหน้าที่ผู้ให้บริการโปรแกรม</div></div>;
  return (
    <div className="page" data-tone="setup">
      <PageHead eyebrow="เริ่มระบบ › ลูกค้าผู้ใช้บริการ" title="ลูกค้าผู้ใช้บริการ" lead={`ลูกค้าแต่ละรายเห็นเฉพาะบริษัท ผู้ใช้ และข้อมูลของตัวเอง — ระงับแล้วผู้ใช้ทุกคนของลูกค้ารายนั้นออกจากระบบทันที · เลิกใช้บริการ หรือระงับเพราะค้างชำระ เก็บข้อมูล ${TENANT_RETENTION_DAYS} วันแล้วลบได้ (ผู้ให้บริการกดลบเอง)`}
        actions={<><button onClick={() => setAiKey(true)}>🔑 AI ที่ WTS จ่ายให้…</button><button onClick={() => setImporting(true)}>⬆ รับลูกค้าที่ย้ายมา…</button><button className="primary" onClick={() => setEdit('new')}>+ เพิ่มลูกค้า <kbd>Ins</kbd></button></>} />
      <SignupsPanel onApproved={() => qc.invalidateQueries({ queryKey: ['tenants'] })} />
      <ErrorBox error={q.error} />
      <div className="toolbar"><label className="inline">แสดง <select value={due} onChange={(e) => setDue(e.target.value as typeof due)} aria-label="กรองตามกำหนดลบข้อมูล">
        <option value="">ลูกค้าทั้งหมด</option><option value="counting">กำลังนับวันลบข้อมูล (เลิกใช้ / ค้างชำระ)</option><option value="due">ครบกำหนดลบข้อมูลแล้ว</option></select></label></div>
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th>รหัส</th><th>ชื่อลูกค้า</th><th>ผู้ติดต่อ</th><th>แพ็กเกจ</th><th className="r">บริษัท</th><th className="r">ผู้ใช้</th><th>หมดอายุ</th><th>ข้อตกลง DPA</th><th>สถานะ</th></tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className="row-open" onClick={() => setEdit(t)}>
                <td className="mono">{t.code}</td><td>{t.name}</td><td className="small">{t.contact_email} {t.contact_phone}</td><td>{t.package_name ?? <span className="muted" title={t.plan}>ไม่มีแพ็กเกจ</span>}{t.ai_payer === 'P' && <div className="small"><Pill tone="n">AI: {AI_PAYER_TH.P}</Pill></div>}</td>
                <td className="r">{t.company_count}{t.max_companies ? ` / ${t.max_companies}` : ''}</td><td className="r">{t.user_count}{t.max_users ? ` / ${t.max_users}` : ''}</td>
                <td><DateText v={t.expires_on} /></td><td>{t.dpa_signed_on ? <DateText v={t.dpa_signed_on} /> : <span className="small muted">ยังไม่ลงนาม</span>}</td>
                <td><Pill tone={ST[t.status]?.[1]}>{t.purged_at ? 'ลบข้อมูลแล้ว' : t.moved_to ? 'ย้ายแล้ว' : `${ST[t.status]?.[0]}${t.status === 'S' && t.suspend_reason ? ` — ${SUSPEND_REASON_TH[t.suspend_reason]}` : ''}`}</Pill>{t.moved_to && <div className="small muted">{t.moved_to}</div>}{t.purge_after && !t.purged_at && !t.moved_to && <div className={t.purge_after <= today ? 'small bad' : 'small muted'}>ลบได้ตั้งแต่ <DateText v={t.purge_after} />{t.purge_after <= today ? ' (ครบกำหนดแล้ว)' : ''}</div>}</td>
              </tr>
            ))}
            {q.data && !rows.length && <tr><td colSpan={9} className="empty">{due === 'due' ? 'ไม่มีลูกค้าที่ครบกำหนดลบข้อมูล' : due ? 'ไม่มีลูกค้าที่กำลังนับวันลบข้อมูล' : 'ยังไม่มีลูกค้า'}</td></tr>}
          </tbody>
        </table>
      </div>
      {aiKey && <PlatformAiKey onClose={() => setAiKey(false)} />}
      {importing && <ImportTenant onClose={() => setImporting(false)} onDone={() => qc.invalidateQueries({ queryKey: ['tenants'] })} />}
      {edit && <TenantForm t={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); qc.invalidateQueries({ queryKey: ['tenants'] }); }} />}
    </div>
  );
}

function TenantForm({ t, onClose, onSaved }: { t: Tenant | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ code: t?.code ?? '', name: t?.name ?? '', contact_email: t?.contact_email ?? '', contact_phone: t?.contact_phone ?? '', plan: t?.plan ?? 'standard',
    expires_on: t?.expires_on ?? '', status: t?.status ?? 'A', dpa_signed_on: t?.dpa_signed_on ?? '', moved_to: t?.moved_to ?? '', single_session: t?.single_session ?? false, admin_username: '', admin_name: '', admin_password: '' });
  const [pk, setPk] = useState(() => packageValues(t));
  const [reason, setReason] = useState<SuspendReason | ''>(t?.suspend_reason ?? '');
  const { me, select } = useSession();
  const nav = useNavigate();
  const [err, setErr] = useState<unknown>(null);
  const [purge, setPurge] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [viewer, setViewer] = useState(false);
  const body = { ...f, suspend_reason: f.status === 'S' ? reason || null : null, contact_email: f.contact_email || null, contact_phone: f.contact_phone || null, expires_on: f.expires_on || null, dpa_signed_on: f.dpa_signed_on || null, moved_to: f.moved_to || null, ...packageBody(pk) };
  const save = () => {
    // ช่องบังคับ: ระงับต้องเลือกเหตุ (ค้างชำระ = นับวันลบข้อมูล)
    if (f.status === 'S' && !reason) { setErr(new Error('เลือกเหตุที่ระงับ — "ค้างชำระ" นับ ' + TENANT_RETENTION_DAYS + ' วันแล้วลบข้อมูลได้ · "อื่น ๆ" ไม่นับ')); return; }
    (t ? api.put(`/api/v1/tenants/${t.id}`, body) : api.post('/api/v1/tenants', body)).then(() => { toast('บันทึกลูกค้าแล้ว'); onSaved(); }).catch(setErr);
  };
  useHotkeys({ F9: save, 'Ctrl+S': save }, [f, pk, reason]);
  // วันลบข้อมูลหลังบันทึก (แสดงก่อนกดบันทึก)
  const plan = tenantCountdown({ status: f.status, suspend_reason: f.status === 'S' ? reason || 'OTHER' : null }, t ?? { status: 'A', terminated_on: null, purge_after: null }, todayIso());
  const companies = t ? (me?.companies ?? []).filter((c) => c.tenant_id === t.id) : [];
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
        {f.status === 'S' && <Field label="เหตุที่ระงับ" req hint={`ค้างชำระ = เก็บข้อมูล ${TENANT_RETENTION_DAYS} วันแล้วลบได้ · อื่น ๆ (เช่น ความปลอดภัย) = ไม่นับวันลบ`}>
          <select value={reason} onChange={(e) => setReason(e.target.value as SuspendReason | '')} aria-label="เหตุที่ระงับ" aria-invalid={!reason || undefined}><option value="">— เลือกเหตุ —</option><option value="UNPAID">{SUSPEND_REASON_TH.UNPAID}</option><option value="OTHER">{SUSPEND_REASON_TH.OTHER}</option></select>
        </Field>}
        {f.status !== 'A' && !(f.status === 'S' && !reason) && <div className={plan.purge_after ? 'wide notebox warn' : 'wide notebox'} role="status">{plan.purge_after
          ? <>ผู้ใช้ทุกคนของลูกค้าเข้าระบบไม่ได้ และเห็นข้อความว่า <b>ข้อมูลจะถูกลบถาวรวันที่ <DateText v={plan.purge_after} /></b> ({TENANT_RETENTION_DAYS} วัน{t && tenantCountingDown(t) ? ' — นับต่อจากเดิม ไม่ยืดเวลา' : ''}) · ลบจริงเมื่อผู้ให้บริการกด "ลบข้อมูลทั้งหมดของลูกค้า" เท่านั้น · กลับเป็น "ใช้งาน" = ยกเลิกการลบ</>
          : <>ระงับโดยไม่นับวันลบข้อมูล — ผู้ใช้ทุกคนของลูกค้าเข้าระบบไม่ได้จนกว่าจะเปลี่ยนเป็น "ใช้งาน"</>}</div>}
        <Field label="ชื่อลูกค้า" req wide><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="อีเมลผู้ติดต่อ"><input value={f.contact_email} onChange={(e) => setF({ ...f, contact_email: e.target.value })} /></Field>
        <Field label="โทรศัพท์"><input value={f.contact_phone} onChange={(e) => setF({ ...f, contact_phone: e.target.value })} /></Field>
        <Field label="หมดอายุ"><DateInput value={f.expires_on} onChange={(v) => setF({ ...f, expires_on: v })} /></Field>
        <PackageFields value={pk} onChange={setPk} />
        <Field label="เข้าระบบพร้อมกัน" hint="1 เครื่อง = ทุกผู้ใช้ของลูกค้านี้ เข้าระบบจากเครื่องใหม่แล้วเครื่องเดิมออกจากระบบ (กันใช้รหัสเดียวกันหลายคน) · มีผลตั้งแต่การเข้าระบบครั้งถัดไป">
          <select value={f.single_session ? '1' : '0'} onChange={(e) => setF({ ...f, single_session: e.target.value === '1' })}><option value="0">หลายเครื่องพร้อมกันได้</option><option value="1">1 รหัสเข้าได้ทีละ 1 เครื่อง</option></select>
        </Field>
        <Field label="ลงนามข้อตกลงประมวลผลข้อมูล (DPA)" hint="ดูแบบข้อตกลงใน docs/10_PDPA.md"><DateInput value={f.dpa_signed_on} onChange={(v) => setF({ ...f, dpa_signed_on: v })} /></Field>
        {t && <TenantModules tenantId={t.id} />}
        {t && !t.purged_at && <>
          <h3 className="wide">กลุ่มผู้ใช้ตั้งต้น</h3>
          <p className="wide small muted">ฝ่ายขาย · ฝ่ายจัดซื้อ · ฝ่ายบัญชี · ดูอย่างเดียว พร้อมสิทธิ์รายเมนูทุกบริษัทของลูกค้านี้ — ลูกค้าใหม่ได้อัตโนมัติ · ลูกค้าเดิมกดเพิ่มได้ (กดซ้ำได้ สร้างเฉพาะที่ยังไม่มี ไม่เขียนทับสิทธิ์ที่ลูกค้าแก้เอง)</p>
          <div className="wide"><button type="button" onClick={() => api.post<{ created: string[]; rows: number; companies: number }>(`/api/v1/tenants/${t.id}/standard-groups`)
            .then((r) => toast(r.created.length || r.rows ? `เพิ่มกลุ่ม ${r.created.join(' ') || '—'} · สิทธิ์รายเมนู ${r.rows} แถว (${r.companies} บริษัท)` : 'มีกลุ่มตั้งต้นและสิทธิ์ครบแล้ว — ไม่ได้เพิ่มอะไร'))
            .catch(toastError)}>เพิ่มกลุ่มตั้งต้น</button></div>
        </>}
        {t && t.status === 'A' && <>
          <h3 className="wide">ผู้ใช้ดูอย่างเดียว (ให้ลูกค้าทดลองดูข้อมูลตัวอย่าง)</h3>
          <p className="wide small muted">อ่านและดูตัวอย่างพิมพ์ทางจอได้ทุกบริษัทของลูกค้านี้ — เพิ่ม แก้ไข ยกเลิก ลบ รับรอง ไม่ได้ · เห็นเฉพาะข้อมูลของลูกค้านี้ · แนะนำหนึ่งรหัสต่อลูกค้าทดลองหนึ่งราย (ปิดเฉพาะรายได้ที่หน้า ผู้ใช้งานและสิทธิ์)</p>
          <div className="wide"><button type="button" onClick={() => setViewer(true)}>+ เพิ่มผู้ใช้ดูอย่างเดียว…</button></div>
        </>}
        {t && <>
          <h3 className="wide">ย้ายไปเซิร์ฟเวอร์/ฐานข้อมูลแยก (ลูกค้ารายใหญ่)</h3>
          <p className="wide small muted">1) ส่งออกแฟ้มย้ายลูกค้า 2) ที่เครื่องใหม่กด "รับลูกค้าที่ย้ายมา" 3) ตรวจผลแล้วกลับมาใส่ที่อยู่ใหม่ และเปลี่ยนสถานะเป็น "เลิกใช้" — ผู้ใช้จะถูกบอกให้ไปเข้าที่อยู่ใหม่ และลบสำเนาที่เครื่องนี้ได้ทันที</p>
          <Field label="ย้ายไปที่ (ที่อยู่ของเครื่องใหม่)" wide><input value={f.moved_to} placeholder="เช่น https://bigco.buddy.example" onChange={(e) => setF({ ...f, moved_to: e.target.value })} /></Field>
          <div className="wide"><button onClick={() => setExporting(true)}>⬇ ส่งออกเพื่อย้าย…</button></div>
        </>}
        {t && tenantCountingDown(t) && <div className="wide notebox">
          {t.moved_to ? <>ย้ายไปที่ {t.moved_to} แล้ว — ลบสำเนาที่เครื่องนี้ได้ทันที{' '}<button className="danger" onClick={() => setPurge(true)}>ลบข้อมูลทั้งหมดของลูกค้า…</button></>
            : <>{t.status === 'I' ? <>เลิกใช้บริการเมื่อ <DateText v={t.terminated_on} /></> : <>ระงับ — ค้างชำระ</>} · ลบข้อมูลได้ตั้งแต่ <DateText v={t.purge_after} /> — ระหว่างนี้ลูกค้าชำระเงิน (เปลี่ยนเป็น "ใช้งาน") หรือขอสำเนาข้อมูลได้ (ด้านล่าง)
              {' '}<button className="danger" onClick={() => setPurge(true)}>ลบข้อมูลทั้งหมดของลูกค้า…</button></>}
        </div>}
        {t && companies.length > 0 && <>
          <h3 className="wide">ส่งสำเนาข้อมูลให้ลูกค้า (ก่อนลบ)</h3>
          <p className="wide small muted">ลูกค้าที่ถูกระงับเข้าระบบไม่ได้ — เลือกบริษัทแล้ว "สำรองข้อมูล" (ตั้งรหัสผ่านแฟ้ม) ส่งแฟ้มและรหัสผ่านให้ลูกค้าแยกช่องทาง · แฟ้มนำกลับใช้ใน Buddy ได้ · ลูกค้าที่ยังเข้าระบบได้ สำรองเองได้ที่ อื่น ๆ › สำรองข้อมูล และส่งออกรายงานเป็น Excel</p>
          <div className="wide">{companies.map((c) => <button key={c.id} type="button" onClick={() => void select({ company_id: c.id }).then(() => nav('/tools/backup')).catch(toastError)}>สำรองข้อมูล {c.code} {c.name_th}</button>)}</div>
        </>}
        {!t && <>
          <h3 className="wide">ผู้ดูแลระบบคนแรกของลูกค้า</h3>
          <Field label="รหัสผู้ใช้" req><input value={f.admin_username} onChange={(e) => setF({ ...f, admin_username: e.target.value })} /></Field>
          <Field label="ชื่อ" req><input value={f.admin_name} onChange={(e) => setF({ ...f, admin_name: e.target.value })} /></Field>
          <Field label="รหัสผ่านเริ่มต้น (อย่างน้อย 8 ตัว)" req wide><PasswordInput autoComplete="new-password" value={f.admin_password} onChange={(e) => setF({ ...f, admin_password: e.target.value })} /></Field>
        </>}
      </div>
      {purge && t && <PurgeTenant t={t} onClose={() => setPurge(false)} onDone={onSaved} />}
      {exporting && t && <ExportTenant t={t} onClose={() => setExporting(false)} />}
      {viewer && t && <AddViewer t={t} onClose={() => setViewer(false)} />}
    </Modal>
  );
}

/** เพิ่มผู้ใช้ดูอย่างเดียวให้ลูกค้ารายนี้ (HANDOFF 154 — ลูกค้าทดลองดูข้อมูลตัวอย่างทั้งปีโดยแก้ไม่ได้) */
function AddViewer({ t, onClose }: { t: Tenant; onClose: () => void }) {
  const [f, setF] = useState({ username: '', display_name: '', password: '' });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setErr(null); setBusy(true);
    try {
      const r = await api.post<{ username: string; companies: number }>(`/api/v1/tenants/${t.id}/viewers`, f);
      toast(`เพิ่มผู้ใช้ดูอย่างเดียว ${r.username} แล้ว (${r.companies} บริษัท) — ส่งรหัสผู้ใช้และรหัสผ่านให้ลูกค้าทดลอง`); onClose();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <Modal title={`ผู้ใช้ดูอย่างเดียว — ลูกค้า ${t.code}`} onClose={onClose}
      footer={<><button onClick={onClose}>ยกเลิก</button><button className="primary" disabled={busy || !f.username || !f.display_name || !f.password} onClick={run}>{busy ? 'กำลังเพิ่ม…' : 'เพิ่มผู้ใช้'}</button></>}>
      <ErrorBox error={err} />
      <p className="hint">ผู้ใช้นี้อยู่ในลูกค้า <b>{t.name}</b> เปิดดูได้ทุกเมนูและดูตัวอย่างพิมพ์ทางจอ แต่บันทึก แก้ไข ยกเลิก ลบ ไม่ได้ — ปุ่มบันทึกจะกดไม่ได้</p>
      <div className="form-grid">
        <Field label="รหัสผู้ใช้" req hint="เช่น demo.shopa (ตัวอักษรอังกฤษ ตัวเลข _ . -)"><input autoFocus maxLength={30} value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.trim() })} /></Field>
        <Field label="ชื่อที่แสดง" req><input maxLength={120} placeholder="เช่น ลูกค้าทดลอง ร้านเอ" value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} /></Field>
        <Field label="รหัสผ่านเริ่มต้น" req wide hint="อย่างน้อย 8 ตัว มีตัวอักษรและตัวเลข — ส่งให้ลูกค้าทางช่องทางส่วนตัว"><PasswordInput autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
      </div>
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
        <Field label="รหัสผ่านของแฟ้ม (อย่างน้อย 12 ตัว)" req wide><PasswordInput autoComplete="new-password" value={p1} onChange={(e) => setP1(e.target.value)} autoFocus /></Field>
        <Field label="ยืนยันรหัสผ่าน" req wide error={p2 && p1 !== p2 ? 'รหัสผ่านไม่ตรงกัน' : undefined}><PasswordInput autoComplete="new-password" value={p2} onChange={(e) => setP2(e.target.value)} /></Field>
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
          <Field label="รหัสผ่านของแฟ้ม" req wide><PasswordInput autoComplete="off" value={pass} onChange={(e) => setPass(e.target.value)} /></Field>
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

type TMod = { key: string; label: string; enabled: boolean; valid_to: string | null; seats: number | null; remark: string | null; app_url: string | null; active: boolean; expired: boolean };
/** โปรแกรมที่ลูกค้าใช้ได้ (docs/17 B0.6) — Hub แสดงไทล์ตามนี้ · โปรแกรมอื่นตรวจสิทธิ์ที่ GET /api/v1/tenant/modules */
function TenantModules({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['tenant-modules', tenantId], queryFn: () => api.get<TMod[]>(`/api/v1/tenants/${tenantId}/modules`) });
  const [rows, setRows] = useState<TMod[]>([]);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => { if (q.data) setRows(q.data); }, [q.data]);
  const set = (k: string, p: Partial<TMod>) => setRows((xs) => xs.map((x) => (x.key === k ? { ...x, ...p } : x)));
  const save = async () => {
    setErr(null);
    try {
      await api.put(`/api/v1/tenants/${tenantId}/modules`, { modules: rows.map((x) => ({ key: x.key, enabled: x.enabled, valid_to: x.valid_to || null, seats: x.seats || null, remark: x.remark || null, ...(x.key === 'buddy' ? {} : { app_url: x.app_url?.trim() || null }) })) });
      toast('บันทึกโปรแกรมที่ลูกค้าใช้ได้แล้ว');
      await qc.invalidateQueries({ queryKey: ['tenant-modules', tenantId] });
    } catch (e) { setErr(e); }
  };
  return (
    <div className="wide">
      <h3>โปรแกรมที่ลูกค้าใช้ได้ (WTS Solutions)</h3>
      <ErrorBox error={err ?? q.error} />
      <table className="grid tenant-mods">
        <thead><tr><th>โปรแกรม</th><th className="c">เปิดใช้</th><th>ใช้ได้ถึง</th><th className="r">จำนวนผู้ใช้/เครื่อง</th><th>หมายเหตุ</th><th>ที่อยู่โปรแกรม (Hub เปิดที่นี่)</th><th>สถานะ</th></tr></thead>
        <tbody>{rows.map((x) => <tr key={x.key}>
          <td>{x.label}</td>
          <td className="c"><input type="checkbox" checked={x.enabled} onChange={(e) => set(x.key, { enabled: e.target.checked })} aria-label={`เปิดใช้ ${x.label}`} /></td>
          <td><DateInput value={x.valid_to ?? ''} onChange={(v) => set(x.key, { valid_to: v || null })} /></td>
          <td><input className="num" value={x.seats ?? ''} placeholder="ไม่จำกัด" onChange={(e) => set(x.key, { seats: e.target.value.replace(/\D/g, '') ? Number(e.target.value.replace(/\D/g, '')) : null })} aria-label="จำนวนผู้ใช้/เครื่อง" /></td>
          <td><input value={x.remark ?? ''} maxLength={200} onChange={(e) => set(x.key, { remark: e.target.value })} aria-label="หมายเหตุ" /></td>
          <td>{x.key === 'buddy' ? <span className="muted small">โปรแกรมนี้</span> : <input value={x.app_url ?? ''} maxLength={200} placeholder="https://wtspos.example.com/office/" onChange={(e) => set(x.key, { app_url: e.target.value })} aria-label={`ที่อยู่โปรแกรม ${x.label}`} />}</td>
          <td>{x.active ? <Pill tone="n">ใช้ได้</Pill> : x.expired ? <Pill tone="d">หมดอายุ</Pill> : <Pill tone="x">ปิด</Pill>}</td>
        </tr>)}</tbody>
      </table>
      <div className="theme-acts"><button type="button" onClick={save} disabled={!q.data}>บันทึกโปรแกรมที่ใช้ได้</button></div>
    </div>
  );
}
