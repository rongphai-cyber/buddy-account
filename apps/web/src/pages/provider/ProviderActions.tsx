import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { actionLabel, formatDate, TENANT_FEATURES, TENANT_MODULES } from '@buddy/core';
import { api } from '../../api';
import { useSession } from '../../session';
import { DateInput, ErrorBox, Field, KeyHints, Modal, PageHead, Pill, useHotkeys, useYearSystem } from '../../ui';
import { useListSort, type SortCol } from '../../components/SortHeader';
import { useWorkRangeState } from '../../workRange';

/**
 * สิ่งที่เจ้าหน้าที่ผู้ให้บริการทำกับบัญชีลูกค้า (HANDOFF 207 · ต่อจาก 204 P3) — อ่านอย่างเดียวจากแฟ้มบันทึกเหตุการณ์
 *  - ศูนย์ผู้ให้บริการ (/provider/actions): ทุกลูกค้า กรองลูกค้า เจ้าหน้าที่ ช่วงวันที่ เหตุการณ์ · คลิกแถว = ดูรายละเอียด
 *  - ลูกค้า (/settings/provider-actions · ผู้ดูแลระบบของกิจการ): เฉพาะบัญชีของตัวเอง — ตรวจได้ว่าเจ้าหน้าที่ทำอะไรกับบัญชีบ้าง
 */
/** ชื่อไทยของรหัสเหตุการณ์ (ที่เดียว packages/core/src/activity-actions.ts · HANDOFF 207c) — ตัวเลือกกรอง = งานระดับบัญชีลูกค้า */
const FILTER_ACTIONS = ['NEW_TENANT', 'EDIT_TENANT', 'TENANT_MODULES', 'PV_VIEW', 'TENANT_DEMO_OFF', 'INVITE_EMAIL', 'USER_UNLOCK', 'USER_RESET_2FA', 'API_KEY_CREATE', 'API_KEY_REVOKE',
  'MOVE_REQUEST', 'MOVE_COMPANY', 'NEW_COMPANY', 'BACKUP', 'RESTORE', 'STARTER_DATA', 'ADD_USER', 'EDIT_USER', 'PERMISSION', 'EXPORT_TENANT', 'IMPORT_TENANT', 'PURGE_TENANT',
  'ADD_PACKAGE', 'EDIT_PACKAGE', 'MAIL_SETTINGS', 'ALERT_LOCKED', 'ALERT_LOGIN_FAIL', 'ALERT_BURST'];
const RESULT: Record<string, [string, 'n' | 'm' | 'd' | 'x']> = { ok: ['ทำแล้ว', 'm'], sent: ['ทำแล้ว · ส่งอีเมลแล้ว', 'm'], failed: ['ทำแล้ว · ส่งอีเมลไม่สำเร็จ', 'd'], skipped: ['ทำแล้ว · ไม่ได้ส่งอีเมล', 'x'] };
const actText = actionLabel;
/** ชื่อโปรแกรม/เมนูที่เปิดให้เฉพาะราย (ตัดคำอธิบายในวงเล็บ) */
const MOD_LABEL = new Map<string, string>([...TENANT_MODULES, ...TENANT_FEATURES].map((m) => [m.key, m.label.replace(/\s*\(.*\)$/, '')]));
const modName = (k: string) => MOD_LABEL.get(k) ?? k;
const TST: Record<string, string> = { A: 'ใช้งาน', S: 'ระงับ', I: 'เลิกใช้' };
type Info = { on?: string[]; off?: string[]; until?: Array<{ key: string; to: string | null }>; status_from?: string | null; status_to?: string | null; package?: string | null;
  user?: string | null; mail?: string; key?: string | null; companies?: string | null; count?: number | null; minutes?: number | null; company?: string | null; template?: string | null } | null;
/**
 * สรุปเป็นข้อความไทยสั้น ๆ ต่อเหตุการณ์ (HANDOFF 207b) — จากค่าที่ปลอดภัยที่เซิร์ฟเวอร์ส่งมา (info) ไม่ใช่รายละเอียดดิบ
 * ลูกค้าเห็นเฉพาะสรุปนี้ · ผู้ให้บริการเห็นรายละเอียดเต็มในหน้าต่างเมื่อคลิกแถว
 */
function summaryOf(action: string, i: Info, fmt: (iso: string) => string, companyCode?: string | null): string {
  const co = i?.company ?? companyCode ?? null;
  if (action === 'PV_VIEW') return 'ดูภาพรวมการใช้งาน (ไม่เห็นข้อมูลบัญชี)';
  if (action === 'TENANT_DEMO_ON') return 'ตั้งเป็นข้อมูลตัวอย่าง (เจ้าหน้าที่เปิดข้อมูลได้)';
  if (action === 'TENANT_DEMO_OFF') return 'เลิกเป็นข้อมูลตัวอย่าง (เจ้าหน้าที่เปิดข้อมูลไม่ได้แล้ว)';
  if (action === 'NEW_COMPANY' || action === 'COPY_COMPANY') return co ? `เพิ่มบริษัท ${co}` : '';
  if (!i) return '';
  switch (action) {
    case 'TENANT_MODULES': {
      const p: string[] = [];
      if (i.on?.length) p.push(`เปิด: ${i.on.map(modName).join(', ')}`);
      if (i.off?.length) p.push(`ปิด: ${i.off.map(modName).join(', ')}`);
      for (const u of i.until ?? []) p.push(u.to ? `${modName(u.key)} ใช้ได้ถึง ${fmt(u.to)}` : `${modName(u.key)} ไม่กำหนดวันสิ้นสุด`);
      return p.join(' · ') || 'บันทึกโดยไม่เปลี่ยนการเปิด/ปิด';
    }
    case 'EDIT_TENANT': {
      const p: string[] = [];
      if (i.status_to) p.push(`สถานะ ${TST[i.status_from ?? ''] ?? i.status_from ?? '-'} → ${TST[i.status_to] ?? i.status_to}`);
      if (i.package !== undefined) p.push(i.package ? `แพ็กเกจ ${i.package}` : 'ไม่มีแพ็กเกจ');
      return p.join(' · ') || 'แก้ข้อมูลลูกค้า';
    }
    case 'INVITE_EMAIL': return `ส่งลิงก์ตั้งรหัสผ่านของ ${i.user ?? '-'} ไปที่อีเมลผู้ติดต่อ`;
    case 'USER_UNLOCK': case 'USER_RESET_2FA': case 'USER_RESET_PASSWORD': case 'INVITE_CREATE': case 'INVITE_REVOKE': return `ผู้ใช้ ${i.user ?? '-'}`;
    case 'API_KEY_CREATE': case 'API_KEY_REVOKE': case 'API_KEY_SCOPE': return `กุญแจ ${i.key ?? '-'}`;
    case 'MOVE_REQUEST': case 'MOVE_REJECT': case 'EXPORT_TENANT': case 'IMPORT_TENANT': return i.companies ? `บริษัท ${i.companies}` : '';
    case 'ALERT_LOCKED': case 'ALERT_LOGIN_FAIL': case 'ALERT_BURST': return `${i.count ?? '-'} ครั้งใน ${i.minutes ?? '-'} นาที`;
    case 'MOVE_COMPANY': return co ? `ย้ายบริษัท ${co} เข้าบัญชีลูกค้านี้` : 'ย้ายบริษัทเข้าบัญชีลูกค้านี้';
    case 'BACKUP': return co ? `สำรองข้อมูลบริษัท ${co}` : '';
    case 'RESTORE': return co ? `นำข้อมูลสำรองมาใช้กับบริษัท ${co}` : '';
    case 'DELETE_COMPANY': return co ? `ลบบริษัท ${co}` : '';
    case 'RESTORE_COMPANY': return co ? `กู้บริษัท ${co}` : '';
    case 'STARTER_DATA': return co ? `ใส่ข้อมูลตั้งต้นให้บริษัท ${co}` : 'ใส่ข้อมูลตั้งต้นของบริษัท';
    default: return '';
  }
}

type Base = { id: string; occurred_at: string; action: string; doc_no: string | null; company_code: string | null; staff_name: string | null; info: Info; detail?: unknown; result: keyof typeof RESULT };
type PvRow = Base & { tenant_id: string | null; tenant_code: string | null; tenant_name: string | null; is_demo: boolean | null; staff_username: string | null; module: string | null };
type PvResp = { rows: PvRow[]; total: number; page: number; page_size: number; tenants: Array<{ id: string; code: string; name: string; is_demo: boolean }>; staff: Array<{ id: string; username: string; display_name: string }> };
type MineResp = { rows: Base[]; total: number; page: number; page_size: number };

function useDay() { const ys = useYearSystem(); return (iso: string) => formatDate(iso.slice(0, 10), ys); }
function useWhen() {
  const ys = useYearSystem();
  return (iso: string) => { const t = new Date(iso); return `${formatDate(t.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }), ys)} ${t.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })}`; };
}
function csvDownload(name: string, head: string[], lines: string[][]) {
  const txt = [head, ...lines].map((l) => l.map((x) => (/[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x)).join(',')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + txt], { type: 'text/csv;charset=utf-8' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function Pager({ page, total, size, onPage }: { page: number; total: number; size: number; onPage: (p: number) => void }) {
  const last = Math.max(1, Math.ceil(total / size));
  return (
    <div className="toolbar pager">
      <button onClick={() => onPage(1)} disabled={page <= 1} title="หน้าแรก">⏮</button>
      <button onClick={() => onPage(page - 1)} disabled={page <= 1} title="หน้าก่อน (PageUp)">◀ ก่อนหน้า</button>
      <span className="summary">หน้า <b>{page.toLocaleString()}</b> / {last.toLocaleString()} · ทั้งหมด <b>{total.toLocaleString()}</b> รายการ</span>
      <button onClick={() => onPage(page + 1)} disabled={page >= last} title="หน้าถัดไป (PageDown)">ถัดไป ▶</button>
      <button onClick={() => onPage(last)} disabled={page >= last} title="หน้าสุดท้าย">⏭</button>
    </div>
  );
}
function DetailModal({ row, onClose, extra }: { row: Base; onClose: () => void; extra?: ReactNode }) {
  const when = useWhen(), day = useDay();
  const [label, tone] = RESULT[row.result] ?? RESULT.ok!;
  const sum = summaryOf(row.action, row.info, day, row.company_code);
  return (
    <Modal title={actText(row.action)} onClose={onClose} footer={<button className="primary" onClick={onClose} autoFocus>ปิด <kbd>Esc</kbd></button>}>
      <dl className="kv">
        <dt>วันเวลา</dt><dd>{when(row.occurred_at)}</dd>
        {extra}
        <dt>เจ้าหน้าที่</dt><dd>{row.staff_name ?? '—'}</dd>
        <dt>รายการ</dt><dd className="mono">{row.doc_no ?? '—'}</dd>
        <dt>บริษัท</dt><dd className="mono">{row.company_code ?? '—'}</dd>
        <dt>ผล</dt><dd><Pill tone={tone}>{label}</Pill></dd>
        <dt>สรุป</dt><dd>{sum || '—'}</dd>
        {row.detail !== undefined && <><dt>รายละเอียดเต็ม (เฉพาะผู้ให้บริการ)</dt><dd><pre className="small" style={{ whiteSpace: 'pre-wrap', margin: 0, maxHeight: 320, overflow: 'auto' }}>{row.detail ? JSON.stringify(row.detail, null, 2) : '—'}</pre></dd></>}
      </dl>
    </Modal>
  );
}

const PV_COLS: readonly SortCol<PvRow>[] = [
  { key: 'occurred_at', type: 'date' }, { key: 'tenant_code', type: 'text' }, { key: 'company_code', type: 'text' }, { key: 'staff_name', type: 'text' }, { key: 'action', type: 'text', get: (r) => actText(r.action) },
];
const EMPTY = { tenant: '', staff: '', action: '', demo_work: '0' };

export function ProviderActionsPage() {
  const { me } = useSession();
  const nav = useNavigate();
  const when = useWhen(), day = useDay();
  const range = useWorkRangeState();
  const [f, setF] = useState(EMPTY);
  const [applied, setApplied] = useState({ ...EMPTY, from: range.from, to: range.to });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<PvRow | null>(null);
  const st = useListSort<PvRow>('provider-actions', PV_COLS, () => setPage(1));
  const list = useQuery({ enabled: !!me?.user.is_platform, queryKey: ['provider-actions', applied, page, st.params], queryFn: () => api.get<PvResp>('/api/v1/provider/actions', { ...applied, page: String(page), ...st.params }) });
  const apply = () => { setApplied({ ...f, from: range.from, to: range.to }); setPage(1); };
  const last = Math.max(1, Math.ceil((list.data?.total ?? 0) / (list.data?.page_size ?? 50)));
  useHotkeys({ F5: apply, PageDown: () => setPage((p) => Math.min(last, p + 1)), PageUp: () => setPage((p) => Math.max(1, p - 1)) });
  if (!me?.user.is_platform) return <div className="page"><div className="notebox">เฉพาะเจ้าหน้าที่ผู้ให้บริการโปรแกรม</div></div>;
  const rows = st.sorted(list.data?.rows);
  const tenants = list.data?.tenants ?? [];
  const csv = () => csvDownload('provider-actions.csv', ['วันเวลา', 'ลูกค้า', 'บริษัท', 'เจ้าหน้าที่', 'เหตุการณ์', 'รายการ', 'ผล', 'รายละเอียด'],
    rows.map((r) => [when(r.occurred_at), r.tenant_code ?? 'ทั้งระบบ', r.company_code ?? '', r.staff_username ?? 'ผู้ดูแลเซิร์ฟเวอร์', actText(r.action), r.doc_no ?? '', RESULT[r.result]?.[0] ?? '', summaryOf(r.action, r.info, day, r.company_code)]));
  return (
    <div className="page" data-tone="setup">
      <PageHead eyebrow="ศูนย์ผู้ให้บริการ" title="สิ่งที่เจ้าหน้าที่ทำกับบัญชีลูกค้า"
        lead="ทุกครั้งที่เจ้าหน้าที่ผู้ให้บริการทำกับบัญชีของลูกค้า (เปิด/ระงับ แพ็กเกจ เมนูที่เปิด ข้อมูลตัวอย่าง อีเมลแจ้งลูกค้า ลิงก์ตั้งรหัสผ่าน ปลดล็อก ล้าง 2FA กุญแจ API ย้ายบริษัท เพิ่ม/แก้ไขลูกค้า เปิดดูภาพรวม) และการแจ้งเตือนการใช้งานผิดปกติ — อ่านอย่างเดียว แก้หรือลบไม่ได้ · ลูกค้าเห็นรายการของบัญชีตัวเองที่ เริ่มระบบ › สิ่งที่ผู้ให้บริการทำกับบัญชีของท่าน" />
      <fieldset className="box no-print"><legend>เงื่อนไข</legend>
        <div className="form-grid">
          <Field label="ลูกค้า"><select value={f.tenant} onChange={(e) => setF({ ...f, tenant: e.target.value })}>
            <option value="">ทุกลูกค้า + ทั้งระบบ</option><option value="none">ทั้งระบบ (แพ็กเกจ ค่าตั้ง การแจ้งเตือน)</option>
            <optgroup label="ลูกค้า">{tenants.filter((t) => !t.is_demo).map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}</optgroup>
            <optgroup label="ข้อมูลตัวอย่าง">{tenants.filter((t) => t.is_demo).map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}</optgroup>
          </select></Field>
          <Field label="เจ้าหน้าที่"><select value={f.staff} onChange={(e) => setF({ ...f, staff: e.target.value })}><option value="">ทุกคน</option>
            {(list.data?.staff ?? []).map((s) => <option key={s.id} value={s.id}>{s.username} · {s.display_name}</option>)}</select></Field>
          <Field label="วันที่ จาก"><DateInput value={range.from} onChange={range.setFrom} /></Field>
          <Field label="ถึง"><DateInput value={range.to} onChange={range.setTo} /></Field>
          <Field label="เหตุการณ์"><select value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })}><option value="">ทั้งหมด</option>
            {FILTER_ACTIONS.map((k) => <option key={k} value={k}>{actionLabel(k)}</option>)}</select></Field>
          <Field label="งานในบริษัทตัวอย่าง" hint="ค่าเริ่มต้นแสดงเฉพาะงานระดับบัญชีลูกค้า — ติ๊กเพื่อรวมเอกสาร/ข้อมูลที่เจ้าหน้าที่คีย์ในบริษัทข้อมูลตัวอย่าง"><label className="check"><input type="checkbox" checked={f.demo_work === '1'} onChange={(e) => { const v = { ...f, demo_work: e.target.checked ? '1' : '0' }; setF(v); setApplied({ ...v, from: range.from, to: range.to }); setPage(1); }} /> รวมงานในบริษัทตัวอย่าง</label></Field>
        </div>
        <div className="toolbar"><button className="primary" onClick={apply}>เรียกดู <kbd>F5</kbd></button>
          <button onClick={() => { setF(EMPTY); range.setFrom(range.work.from); range.setTo(range.work.to); setApplied({ ...EMPTY, from: range.work.from, to: range.work.to }); setPage(1); }}>ล้างเงื่อนไข</button>
          <button onClick={csv} disabled={!rows.length}>CSV (หน้านี้)</button></div>
      </fieldset>
      <ErrorBox error={list.error} />
      <div className="table-wrap tall">
        <table className="grid report">
          <thead><tr>{st.th('occurred_at', 'วันเวลา', { style: { width: 130 } })}{st.th('tenant_code', 'ลูกค้า')}{st.th('company_code', 'บริษัท', { style: { width: 80 } })}{st.th('staff_name', 'เจ้าหน้าที่')}{st.th('action', 'เหตุการณ์')}<th>รายการ</th><th>ผล</th><th>สรุป</th></tr></thead>
          <tbody>
            {rows.map((r) => { const [label, tone] = RESULT[r.result] ?? RESULT.ok!; return (
              <tr key={r.id} className="row-open" onClick={() => setOpen(r)} title="คลิกเพื่อดูรายละเอียด">
                <td>{when(r.occurred_at)}</td>
                <td>{r.tenant_code ? <><b className="mono">{r.tenant_code}</b> <span className="small">{r.tenant_name}</span>{r.is_demo && <> <Pill tone="d">ข้อมูลตัวอย่าง</Pill></>}</> : <span className="muted">ทั้งระบบ</span>}</td>
                <td className="mono">{r.company_code}</td>
                <td title={r.staff_username ?? ''}>{r.staff_name ?? <span className="muted">ผู้ดูแลเซิร์ฟเวอร์</span>}</td>
                <td>{actText(r.action)}</td><td className="mono">{r.doc_no}</td><td><Pill tone={tone}>{label}</Pill></td>
                <td className="small muted" style={{ maxWidth: 360 }}>{summaryOf(r.action, r.info, day, r.company_code)}</td>
              </tr>); })}
            {list.data && !rows.length && <tr><td colSpan={8} className="empty">ไม่มีรายการตามเงื่อนไข</td></tr>}
          </tbody>
        </table>
      </div>
      {list.data && <Pager page={page} total={list.data.total} size={list.data.page_size} onPage={setPage} />}
      <KeyHints keys={[['F5', 'เรียกดู'], ['PageUp/PageDown', 'หน้าก่อน/ถัดไป'], ['Esc', 'ปิดรายละเอียด']]} />
      {open && <DetailModal row={open} onClose={() => setOpen(null)} extra={<>
        <dt>ลูกค้า</dt><dd>{open.tenant_code ? <>{open.tenant_code} · {open.tenant_name} {open.tenant_id && <button className="link" onClick={() => nav(`/provider/customers/${open.tenant_id}`)}>เปิดภาพรวมลูกค้า</button>}</> : <span>ทั้งระบบ</span>}</dd></>} />}
    </div>
  );
}

const MINE_COLS: readonly SortCol<Base>[] = [{ key: 'occurred_at', type: 'date' }, { key: 'company_code', type: 'text' }, { key: 'staff_name', type: 'text' }, { key: 'action', type: 'text', get: (r) => actText(r.action) }];

export function MyProviderActionsPage() {
  const { me } = useSession();
  const when = useWhen(), day = useDay();
  const range = useWorkRangeState();
  const [applied, setApplied] = useState({ from: range.from, to: range.to });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Base | null>(null);
  const st = useListSort<Base>('my-provider-actions', MINE_COLS, () => setPage(1));
  const ok = !!me && !me.user.is_platform && !!me.user.is_admin;
  const list = useQuery({ enabled: ok, queryKey: ['my-provider-actions', applied, page, st.params], queryFn: () => api.get<MineResp>('/api/v1/provider-actions/mine', { ...applied, page: String(page), ...st.params }) });
  const apply = () => { setApplied({ from: range.from, to: range.to }); setPage(1); };
  const last = Math.max(1, Math.ceil((list.data?.total ?? 0) / (list.data?.page_size ?? 50)));
  useHotkeys({ F5: apply, PageDown: () => setPage((p) => Math.min(last, p + 1)), PageUp: () => setPage((p) => Math.max(1, p - 1)) });
  if (me?.user.is_platform) return <div className="page"><div className="notebox">เจ้าหน้าที่ผู้ให้บริการดูได้ที่ ศูนย์ผู้ให้บริการ › สิ่งที่เจ้าหน้าที่ทำกับบัญชีลูกค้า</div></div>;
  if (!ok) return <div className="page"><div className="notebox">เฉพาะผู้ดูแลระบบ (กลุ่ม ADMIN) ของกิจการ</div></div>;
  const rows = st.sorted(list.data?.rows);
  const csv = () => csvDownload('provider-actions.csv', ['วันเวลา', 'เจ้าหน้าที่', 'เหตุการณ์', 'รายการ', 'บริษัท', 'ผล', 'รายละเอียด'],
    rows.map((r) => [when(r.occurred_at), r.staff_name ?? '', actText(r.action), r.doc_no ?? '', r.company_code ?? '', RESULT[r.result]?.[0] ?? '', summaryOf(r.action, r.info, day, r.company_code)]));
  return (
    <div className="page" data-tone="setup">
      <PageHead eyebrow="เริ่มระบบ" title="สิ่งที่ผู้ให้บริการทำกับบัญชีของท่าน"
        lead="ทุกครั้งที่เจ้าหน้าที่ผู้ให้บริการ Buddy Account ทำกับบัญชีของกิจการ (เช่น เปิด/ปิดโปรแกรม แพ็กเกจ วันหมดอายุ ปลดล็อกผู้ใช้ ล้าง 2FA ส่งลิงก์ตั้งรหัสผ่าน เปิดดูภาพรวมการใช้งาน) — เจ้าหน้าที่เปิดดูหรือแก้ข้อมูลบัญชี เอกสาร และรายงานของกิจการไม่ได้ · ถ้าพบรายการที่ท่านไม่ได้ขอ โปรดแจ้งผู้ให้บริการทันที" />
      <fieldset className="box no-print"><legend>เงื่อนไข</legend>
        <div className="form-grid">
          <Field label="วันที่ จาก"><DateInput value={range.from} onChange={range.setFrom} /></Field>
          <Field label="ถึง"><DateInput value={range.to} onChange={range.setTo} /></Field>
        </div>
        <div className="toolbar"><button className="primary" onClick={apply}>เรียกดู <kbd>F5</kbd></button><button onClick={csv} disabled={!rows.length}>CSV (หน้านี้)</button></div>
      </fieldset>
      <ErrorBox error={list.error} />
      <div className="table-wrap tall">
        <table className="grid report">
          <thead><tr>{st.th('occurred_at', 'วันเวลา', { style: { width: 130 } })}{st.th('staff_name', 'เจ้าหน้าที่')}{st.th('action', 'เหตุการณ์')}<th>รายการ</th>{st.th('company_code', 'บริษัท', { style: { width: 80 } })}<th>ผล</th><th>สรุป</th></tr></thead>
          <tbody>
            {rows.map((r) => { const [label, tone] = RESULT[r.result] ?? RESULT.ok!; return (
              <tr key={r.id} className="row-open" onClick={() => setOpen(r)} title="คลิกเพื่อดูรายละเอียด">
                <td>{when(r.occurred_at)}</td><td>{r.staff_name}</td><td>{actText(r.action)}</td><td className="mono">{r.doc_no}</td><td className="mono">{r.company_code}</td>
                <td><Pill tone={tone}>{label}</Pill></td><td className="small muted" style={{ maxWidth: 360 }}>{summaryOf(r.action, r.info, day, r.company_code)}</td>
              </tr>); })}
            {list.data && !rows.length && <tr><td colSpan={7} className="empty">ยังไม่มีรายการที่ผู้ให้บริการทำกับบัญชีของท่านในช่วงนี้</td></tr>}
          </tbody>
        </table>
      </div>
      {list.data && <Pager page={page} total={list.data.total} size={list.data.page_size} onPage={setPage} />}
      <KeyHints keys={[['F5', 'เรียกดู'], ['PageUp/PageDown', 'หน้าก่อน/ถัดไป'], ['Esc', 'ปิดรายละเอียด']]} />
      {open && <DetailModal row={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
