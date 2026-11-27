import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AI_PAYER_TH, TENANT_MODULES, type AiPayer } from '@buddy/core';
import { api } from '../../api';
import { useSession } from '../../session';
import { cx, ErrorBox, Field, Modal, Pill, toast, DateText } from '../../ui';

interface TenantLite { id: string; code: string; name: string; status: string; purged_at: string | null; moved_to: string | null; company_count: number; max_companies: number | null }
interface Preview {
  source: { id: string; code: string; name: string }; target: { id: string; code: string; name: string };
  companies: Array<{ id: string; code: string; name_th: string; docs: number; journals: number; devices: number; ai_month_usd: string }>;
  quota: { companies_after: number; max_companies: number | null; users_after: number; max_users: number | null };
  users: Array<{ id: string; username: string; display_name: string; group_code: string | null; companies: string[]; action: 'move' | 'unlink'; keeps: string[]; new_group: string | null; reason: string | null }>;
  permissions: { drop: number }; api_keys: Array<{ id: string; name: string; key_prefix: string; company: string; username: string }>;
  tenant_settings: { modules: { source: string[]; target: string[] }; ai_payer: { source: AiPayer; target: AiPayer; target_limit_usd: string | null }; single_session: { source: boolean; target: boolean }; require_mfa: { source: boolean; target: boolean } };
  target_groups: string[]; warnings: string[]; confirm_text: string;
}
interface Result { pending?: boolean; request_id?: string; expires_at?: string; source?: { code: string; name: string }; users_moved: number; links_removed: number; permissions_removed: number; standard_rights_added: number; api_keys_disabled: number; sessions_ended: number; target: { code: string; name: string }; companies: Array<{ code: string; name_th: string }> }

const modName = (k: string) => TENANT_MODULES.find((m) => m.key === k)?.label ?? k;
const yesNo = (v: boolean) => (v ? 'เปิด' : 'ปิด');

/**
 * ย้ายบริษัทไปลูกค้ารายอื่น (HANDOFF 192) — เฉพาะเจ้าหน้าที่ผู้ให้บริการ
 * เลือกบริษัท + ลูกค้าปลายทาง → ดูผลก่อนย้าย (ผู้ใช้ สิทธิ์ กุญแจ API การตั้งค่าที่ผูกกับลูกค้า) → พิมพ์รหัสบริษัทยืนยัน
 */
export function MoveCompanies({ source, onClose, onDone }: { source: { id: string; code: string; name: string }; onClose: () => void; onDone: () => void }) {
  const { me } = useSession();
  const qc = useQueryClient();
  const tenants = useQuery({ queryKey: ['tenants'], queryFn: () => api.get<TenantLite[]>('/api/v1/tenants') });
  const companies = (me?.companies ?? []).filter((c) => c.tenant_id === source.id);
  const [ids, setIds] = useState<string[]>([]);
  const [target, setTarget] = useState('');
  const [pv, setPv] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [totp, setTotp] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Result | null>(null);
  const usable = (t: TenantLite) => t.status === 'A' && !t.purged_at && !t.moved_to;
  // ดูผลก่อนย้ายทุกครั้งที่เปลี่ยนบริษัท/ลูกค้าปลายทาง
  useEffect(() => {
    setPv(null); setConfirm(''); setErr(null);
    if (!ids.length || !target) return;
    let live = true;
    setLoading(true);
    api.post<Preview>(`/api/v1/tenants/${source.id}/move-companies/preview`, { target_tenant_id: target, company_ids: ids })
      .then((p) => { if (live) setPv(p); }).catch((e) => { if (live) setErr(e); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [ids.join(','), target, source.id]);
  const keysText = (pv?.api_keys ?? []).map((k) => [k.name, `${k.key_prefix}…`, k.company, k.username].join(' · ')).join(' / ');
  const stdGroups = (pv?.target_groups ?? []).filter((g) => g !== 'ADMIN').join(' ');
  const typedOk = !!pv && confirm.split(/[\s,]+/).filter(Boolean).map((x) => x.toUpperCase()).sort().join(' ') === pv.companies.map((c) => c.code.toUpperCase()).sort().join(' ');
  const run = async () => {
    if (!pv) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.post<Result>(`/api/v1/tenants/${source.id}/move-companies`, { target_tenant_id: target, company_ids: ids, confirm, totp_code: totp || null });
      setDone(r); toast(r.pending ? `ส่งคำขอย้าย ${r.companies.map((c) => c.code).join(', ')} แล้ว — รอผู้ดูแลระบบของลูกค้า ${source.code} ยืนยัน` : `ย้าย ${r.companies.map((c) => c.code).join(', ')} ไปลูกค้า ${r.target.code} แล้ว`);
      qc.invalidateQueries({ queryKey: ['tenants'] }); qc.invalidateQueries({ queryKey: ['me'] }); qc.invalidateQueries({ queryKey: ['users'] });
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };

  // HANDOFF 204 C2: ลูกค้าจริง → ลูกค้าจริง = คำขอ รอผู้ดูแลของลูกค้าเดิมยืนยันในบัญชีของตัวเอง
  if (done?.pending) return (
    <Modal title="ส่งคำขอย้ายบริษัทแล้ว" onClose={onDone} footer={<button className="primary" autoFocus onClick={onDone}>ปิด</button>}>
      <div className="notebox move-result" role="status">
        <p>คำขอย้าย <b>{done.companies.map((c) => `${c.code} ${c.name_th}`).join(' · ')}</b> ไปลูกค้า <b>{done.target.code} {done.target.name}</b> ส่งแล้ว — <b>ยังไม่ย้าย</b></p>
        <p className="small">บริษัทจะย้ายเมื่อผู้ดูแลระบบ (ADMIN) ของลูกค้า {source.code} ยืนยันในบัญชีของตัวเองที่ เริ่มระบบ › บริษัททั้งหมด / ลบบริษัท (แจ้งทางอีเมลผู้ติดต่อแล้ว) · หมดอายุ <DateText v={done.expires_at?.slice(0, 10) ?? null} /> · ข้อมูลของลูกค้าจริงย้ายได้เมื่อลูกค้ายินยอมเท่านั้น</p>
      </div>
    </Modal>
  );
  if (done) return (
    <Modal title="ย้ายบริษัทเรียบร้อย" onClose={onDone} footer={<button className="primary" autoFocus onClick={onDone}>ปิด</button>}>
      <div className="notebox ok move-result" role="status">
        <p>✅ ย้าย <b>{done.companies.map((c) => `${c.code} ${c.name_th}`).join(' · ')}</b> ไปเป็นบริษัทของลูกค้า <b>{done.target.code} {done.target.name}</b> แล้ว — ข้อมูลบัญชีทั้งหมดอยู่ครบ</p>
        <ul className="small">
          <li>ผู้ใช้ที่ย้ายไปด้วย {done.users_moved} คน · ผู้ใช้ลูกค้าเดิมที่เลิกเข้าบริษัทเหล่านี้ {done.links_removed} รายการ</li>
          <li>สิทธิ์รายเมนูของลูกค้าเดิมที่เลิกใช้ {done.permissions_removed} แถว · เติมสิทธิ์กลุ่มตั้งต้นของลูกค้าใหม่ {done.standard_rights_added} แถว</li>
          <li>กุญแจ API ที่ปิด {done.api_keys_disabled} · ออกจากระบบ {done.sessions_ended} รายการ (ผู้ใช้เข้าใหม่แล้วเห็นตามลูกค้าใหม่)</li>
        </ul>
        <p className="small">ผู้ดูแลระบบของ {done.target.code} เห็นบริษัทเหล่านี้ทันทีที่เปิดหน้าใหม่ · บันทึกไว้ในแฟ้มบันทึกการใช้งานของแต่ละบริษัท</p>
      </div>
    </Modal>
  );

  return (
    <Modal title={`ย้ายบริษัทของลูกค้า ${source.code} ไปลูกค้ารายอื่น`} size="wide" onClose={onClose}
      footer={<><button onClick={onClose}>ยกเลิก</button><button className="danger" disabled={!pv || !typedOk || busy} onClick={run}>{busy ? 'กำลังย้าย…' : 'ย้ายบริษัท'}</button></>}>
      <ErrorBox error={err} />
      <p className="small muted">ข้อมูลบัญชีทั้งหมด (เอกสาร ใบสำคัญ แฟ้มหลัก ภาษี ไฟล์แนบ ประวัติ AI) ผูกกับบริษัท — ย้ายตามบริษัทไปทั้งหมด ไม่ลบ ไม่คัดลอก · เปลี่ยนเฉพาะ "เป็นของลูกค้ารายไหน" และผู้ใช้/สิทธิ์ที่ผูกกับลูกค้า</p>
      <div className="form-grid">
        <fieldset className="wide"><span className="lbl">บริษัทที่จะย้าย<b className="req" aria-hidden="true">*</b></span>
          {companies.map((c) => <label key={c.id} className="inline chk"><input type="checkbox" checked={ids.includes(c.id)} onChange={(e) => setIds(e.target.checked ? [...ids, c.id] : ids.filter((x) => x !== c.id))} /> {c.code} {c.name_th}</label>)}
          {!companies.length && <p className="small muted">ลูกค้านี้ไม่มีบริษัทที่ใช้งานอยู่</p>}
        </fieldset>
        <Field label="ย้ายไปเป็นของลูกค้า" req wide>
          <select aria-label="ลูกค้าปลายทาง" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">— เลือกลูกค้าปลายทาง —</option>
            {(tenants.data ?? []).filter((t) => t.id !== source.id).map((t) => <option key={t.id} value={t.id} disabled={!usable(t)}>{t.code} · {t.name} (บริษัท {t.company_count}{t.max_companies ? `/${t.max_companies}` : ''}){usable(t) ? '' : ' — ใช้งานไม่ได้'}</option>)}
          </select>
        </Field>
      </div>
      {loading && <p className="muted">กำลังตรวจผลการย้าย…</p>}
      {pv && <div className="move-preview">
        <h3>ผลก่อนย้าย: {pv.source.code} → {pv.target.code} {pv.target.name}</h3>
        {pv.warnings.length > 0 && <div className="notebox warn" role="alert"><b>ตรวจก่อนย้าย</b><ul className="small">{pv.warnings.map((w) => <li key={w}>{w}</li>)}</ul></div>}
        <div className="table-wrap"><table className="grid">
          <thead><tr><th>บริษัท</th><th className="r">เอกสาร</th><th className="r">ใบสำคัญ</th><th className="r">เครื่องสาขา</th><th className="r">AI เดือนนี้ ($)</th></tr></thead>
          <tbody>{pv.companies.map((c) => <tr key={c.id}><td><b className="mono">{c.code}</b> {c.name_th}</td><td className="r">{c.docs}</td><td className="r">{c.journals}</td><td className="r">{c.devices}</td><td className="r">{c.ai_month_usd}</td></tr>)}</tbody>
        </table></div>
        <p className="small">หลังย้าย ลูกค้า {pv.target.code} มีบริษัท <b className={cx(pv.quota.max_companies != null && pv.quota.companies_after > pv.quota.max_companies && 'bad')}>{pv.quota.companies_after}{pv.quota.max_companies != null ? ` / ${pv.quota.max_companies}` : ''}</b> · ผู้ใช้ <b className={cx(pv.quota.max_users != null && pv.quota.users_after > pv.quota.max_users && 'bad')}>{pv.quota.users_after}{pv.quota.max_users != null ? ` / ${pv.quota.max_users}` : ''}</b></p>
        <h4>ผู้ใช้ของลูกค้าเดิมที่เข้าบริษัทเหล่านี้</h4>
        {pv.users.length ? <div className="table-wrap"><table className="grid">
          <thead><tr><th>รหัสผู้ใช้</th><th>ชื่อ</th><th>บริษัทที่ย้าย</th><th>ผล</th></tr></thead>
          <tbody>{pv.users.map((u) => <tr key={u.id}><td className="mono">{u.username}</td><td>{u.display_name}</td><td className="small">{u.companies.join(', ')}</td>
            <td>{u.action === 'move' ? <><Pill tone="n">ย้ายไป {pv.target.code}</Pill> <span className="small">{u.new_group ? `กลุ่ม ${u.new_group} ของลูกค้าใหม่` : u.group_code ? `ล้างกลุ่ม ${u.group_code} — กำหนดกลุ่ม/สิทธิ์ใหม่ที่ลูกค้าปลายทาง` : 'ไม่มีกลุ่ม'}</span></>
              : <><Pill tone="d">คงอยู่ {pv.source.code}</Pill> <span className="small">เลิกเข้าบริษัทที่ย้าย ({u.reason})</span></>}</td></tr>)}</tbody>
        </table></div> : <p className="small muted">ไม่มีผู้ใช้ทั่วไปที่ผูกกับบริษัทเหล่านี้ (ผู้ดูแลระบบของลูกค้าเดิมเห็นทุกบริษัทของลูกค้าตัวเอง — หลังย้ายจะไม่เห็นบริษัทเหล่านี้)</p>}
        <ul className="small move-list">
          <li>สิทธิ์รายเมนูของกลุ่ม/ผู้ใช้ลูกค้าเดิมในบริษัทเหล่านี้ <b>{pv.permissions.drop}</b> แถว → เลิกใช้ · เติมสิทธิ์ของกลุ่มตั้งต้นของ {pv.target.code} ({stdGroups || 'ไม่มีกลุ่มตั้งต้น'})</li>
          <li>กุญแจ API ที่จะปิด: {keysText || 'ไม่มี'}</li>
          <li>โปรแกรมที่เปิดได้ (Hub): ลูกค้าเดิม {pv.tenant_settings.modules.source.map(modName).join(', ') || '—'} → ลูกค้าใหม่ {pv.tenant_settings.modules.target.map(modName).join(', ') || '—'}</li>
          <li>ผู้จ่ายค่า AI: {AI_PAYER_TH[pv.tenant_settings.ai_payer.source]} → {AI_PAYER_TH[pv.tenant_settings.ai_payer.target]}{pv.tenant_settings.ai_payer.target === 'P' ? ` (เพดาน ${pv.tenant_settings.ai_payer.target_limit_usd ?? 'ไม่จำกัด'} ดอลลาร์ รวมทุกบริษัทของลูกค้าใหม่)` : ''} · ประวัติการใช้ AI ย้ายตามบริษัท</li>
          <li>เข้าระบบทีละ 1 เครื่อง: {yesNo(pv.tenant_settings.single_session.source)} → {yesNo(pv.tenant_settings.single_session.target)} · บังคับยืนยันตัวตนสองขั้น: {yesNo(pv.tenant_settings.require_mfa.source)} → {yesNo(pv.tenant_settings.require_mfa.target)} (ใช้ของลูกค้าใหม่)</li>
          <li>เครื่องสาขา การตั้งค่า แบบฟอร์มพิมพ์ รายงานที่บันทึกไว้ กุญแจ AI ของบริษัท — ผูกกับบริษัท ย้ายตามไปไม่เปลี่ยน · ยอดการใช้งานเดือนนี้นับรวมที่ลูกค้าใหม่</li>
        </ul>
        <div className="form-grid">
          <Field label={`พิมพ์รหัสบริษัทเพื่อยืนยัน: ${pv.confirm_text}`} req wide hint="ถ้าย้ายหลายบริษัท พิมพ์ทุกรหัส คั่นด้วยช่องว่าง (ลำดับใดก็ได้)">
            <input aria-label="พิมพ์รหัสบริษัทเพื่อยืนยัน" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={(!!confirm && !typedOk) || undefined} />
          </Field>
          <Field label="รหัสยืนยันตัวตน 6 หลัก" hint="เฉพาะบัญชีที่เปิดยืนยันสองขั้น (จากแอปยืนยันตัวตน)"><input value={totp} inputMode="numeric" maxLength={11} onChange={(e) => setTotp(e.target.value)} aria-label="รหัสยืนยันตัวตน" /></Field>
        </div>
      </div>}
    </Modal>
  );
}
