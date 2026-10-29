import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDate } from '@buddy/core';
import { api } from '../../api';
import { DateInput, ErrorBox, Field, KeyHints, PageHead, cx, useHotkeys, useYearSystem } from '../../ui';

type Row = { seq: string; occurred_at: string; module: string | null; action: string; doc_no: string | null; table_name: string | null; detail: unknown; username: string | null; display_name: string | null; auth_username: string | null; company_code: string | null };
type Kind = 'all' | 'audit' | 'password' | 'restore';
const KINDS: Array<[Kind, string]> = [['all', 'บันทึกการทำงานทั้งหมด'], ['audit', 'การแก้ไขปรับปรุงรายการ (Audit Trail)'], ['password', 'การใช้รหัสผ่าน (Password)'], ['restore', 'การสำรอง/ดึงข้อมูลสำรองมาใช้']];
const ACT_TH: Record<string, string> = { LOGIN: 'เข้าระบบ', LOGIN_FAIL: 'ป้อนรหัสผ่านผิด', LOGOUT: 'ออกจากระบบ', PASSWORD: 'เปลี่ยนรหัสผ่าน', RESET_PASSWORD: 'ตั้งรหัสผ่านให้ผู้ใช้', EDIT_USER: 'แก้ไขผู้ใช้',
  ADD: 'เพิ่ม', EDIT: 'แก้ไข', CANCEL: 'ยกเลิก', DELETE: 'ลบ', PRINT: 'พิมพ์', REPRINT: 'พิมพ์ซ้ำ', APPROVE: 'รับรอง', UNAPPROVE: 'ยกเลิกรับรอง', BACKUP: 'สำรองข้อมูล', RESTORE: 'นำข้อมูลสำรองมาใช้',
  BACKUP_USERS: 'สำรองข้อมูลผู้ใช้', RESTORE_USERS: 'นำข้อมูลผู้ใช้กลับ', LOCK: 'ปิดงวด', UNLOCK: 'เปิดงวด', YEAR_END: 'ประมวลผลสิ้นปี', YEAR_REOPEN: 'เปิดปีกลับ', DEPRECIATE: 'คิดค่าเสื่อม' };
const detailText = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 160);

/**
 * แฟ้มบันทึกเหตุการณ์ทำงาน (คู่มือบทที่ 23 S-SEC-04) + เรียกดูโดยป้อนเงื่อนไข (S-SEC-04a) แทนนิพจน์ FoxPro
 * รายงาน 4 แบบที่กรมสรรพากรกำหนดเป็นปุ่มเลือก · แฟ้มนี้ลบ/แก้ไม่ได้ (เก็บถาวร ไม่ต่ำกว่า 2 ปี)
 */
export function ActivityLogPage() {
  const ys = useYearSystem();
  const [kind, setKind] = useState<Kind>('all');
  const [f, setF] = useState({ from: '', to: '', time_from: '', time_to: '', user: '', action: '', module: '', doc_no: '', q: '' });
  const [applied, setApplied] = useState(f);
  const list = useQuery({ queryKey: ['activity-log', kind, applied], queryFn: () => api.get<{ rows: Row[]; truncated: boolean }>('/api/v1/activity-log/search', { kind, ...applied }) });
  const pick = (k: Kind) => { setKind(k); setApplied(f); };
  const print = () => { const st = document.createElement('style'); st.textContent = '@page { size: A4 landscape; margin: 10mm; }'; document.head.appendChild(st); window.print(); setTimeout(() => st.remove(), 500); };
  const csv = () => {
    const head = ['วันที่', 'เวลา', 'เหตุการณ์', 'ผู้ใช้', 'ผู้อนุมัติ', 'บริษัท', 'ระบบ', 'เอกสาร', 'รายละเอียด'];
    const lines = (list.data?.rows ?? []).map((r) => { const t = new Date(r.occurred_at); return [formatDate(t.toLocaleDateString('sv-SE'), ys), t.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }), ACT_TH[r.action] ?? r.action, r.username ?? '', r.auth_username ?? '', r.company_code ?? '', r.module ?? '', r.doc_no ?? '', detailText(r.detail)]; });
    const txt = [head, ...lines].map((l) => l.map((x) => (/[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x)).join(',')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + txt], { type: 'text/csv;charset=utf-8' })); a.download = `log_${kind}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  // Express ใช้ Alt+P/2/3/4 เลือกรายงาน — ใน Buddy Alt+ตัวเลขเป็นปุ่มลัดเมนูหลัก จึงใช้ปุ่มเลือกแทน
  useHotkeys({ F5: () => setApplied(f), 'Ctrl+P': print });
  const rows = list.data?.rows ?? [];
  return (
    <div className="page" data-tone="setup">
      <div className="no-print"><PageHead eyebrow="อื่น ๆ › ระบบความปลอดภัย" title="แฟ้มบันทึกเหตุการณ์ทำงาน" lead="บันทึกอัตโนมัติ: เข้า/ออกระบบ ป้อนรหัสผ่านผิด เปลี่ยนรหัสผ่าน เพิ่ม/แก้ไข/ยกเลิกเอกสาร พิมพ์ รับรอง สำรอง/นำข้อมูลกลับ — แฟ้มนี้ลบหรือแก้ไขไม่ได้" /></div>
      <div className="toolbar no-print">{KINDS.map(([k, label]) => <button key={k} className={cx(kind === k && 'primary')} onClick={() => pick(k)}>{label}</button>)}</div>
      <fieldset className="box no-print"><legend>เรียกดูข้อมูลโดยป้อนเงื่อนไข</legend>
        <div className="form-grid">
          <Field label="วันที่ จาก"><DateInput value={f.from} onChange={(v) => setF({ ...f, from: v })} /></Field>
          <Field label="ถึง"><DateInput value={f.to} onChange={(v) => setF({ ...f, to: v })} /></Field>
          <Field label="เวลา จาก / ถึง"><div className="pair"><input type="time" value={f.time_from} onChange={(e) => setF({ ...f, time_from: e.target.value })} aria-label="เวลาเริ่ม" /><input type="time" value={f.time_to} onChange={(e) => setF({ ...f, time_to: e.target.value })} aria-label="เวลาสิ้นสุด" /></div></Field>
          <Field label="ผู้ใช้"><input value={f.user} onChange={(e) => setF({ ...f, user: e.target.value })} placeholder="รหัสผู้ใช้" /></Field>
          <Field label="เหตุการณ์ (รหัส)"><select value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })}><option value="">ทั้งหมด</option>{Object.entries(ACT_TH).map(([k, v]) => <option key={k} value={k}>{k} {v}</option>)}</select></Field>
          <Field label="ระบบ"><input value={f.module} maxLength={10} onChange={(e) => setF({ ...f, module: e.target.value })} placeholder="เช่น GL AR FA SYS" /></Field>
          <Field label="เลขที่เอกสาร (ขึ้นต้นด้วย)"><input className="mono" value={f.doc_no} onChange={(e) => setF({ ...f, doc_no: e.target.value.toUpperCase() })} /></Field>
          <Field label="คำในรายละเอียด"><input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></Field>
        </div>
        <div className="toolbar"><button className="primary" onClick={() => setApplied(f)}>เรียกดู <kbd>F5</kbd></button><button onClick={() => { const z = { from: '', to: '', time_from: '', time_to: '', user: '', action: '', module: '', doc_no: '', q: '' }; setF(z); setApplied(z); }}>ล้างเงื่อนไข</button>
          <button onClick={print}>🖨 พิมพ์ <kbd>Ctrl+P</kbd></button><button onClick={csv} disabled={!rows.length}>CSV</button></div>
      </fieldset>
      <ErrorBox error={list.error} />
      <h3 className="small">{KINDS.find((k) => k[0] === kind)?.[1]} — {rows.length.toLocaleString()} รายการ{list.data?.truncated ? ' (แสดง 1,000 รายการล่าสุด — ใส่เงื่อนไขให้แคบลง)' : ''}</h3>
      <div className="table-wrap tall">
        <table className="grid report">
          <thead><tr><th style={{ width: 90 }}>วันที่</th><th style={{ width: 60 }}>เวลา</th><th style={{ width: 150 }}>เหตุการณ์</th><th style={{ width: 110 }}>ผู้ใช้</th><th style={{ width: 90 }}>ผู้อนุมัติ</th><th style={{ width: 80 }}>บริษัท</th><th style={{ width: 60 }}>ระบบ</th><th style={{ width: 130 }}>เอกสาร</th><th>รายละเอียด</th></tr></thead>
          <tbody>
            {rows.map((r) => { const t = new Date(r.occurred_at); return <tr key={r.seq} className={cx(r.action === 'LOGIN_FAIL' && 'cancelled')}>
              <td>{formatDate(t.toLocaleDateString('sv-SE'), ys)}</td><td>{t.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</td><td>{ACT_TH[r.action] ?? r.action}</td>
              <td title={r.display_name ?? ''}>{r.username}</td><td>{r.auth_username}</td><td className="mono">{r.company_code}</td><td>{r.module}</td><td className="mono">{r.doc_no}</td><td className="small muted">{detailText(r.detail)}</td></tr>; })}
            {list.data && !rows.length && <tr><td colSpan={9} className="empty">ไม่มีเหตุการณ์ตามเงื่อนไข</td></tr>}
          </tbody>
        </table>
      </div>
      <KeyHints keys={[['F5', 'เรียกดู'], ['Ctrl+P', 'พิมพ์']]} />
    </div>
  );
}
