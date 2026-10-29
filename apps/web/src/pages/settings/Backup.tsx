import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCan, useSession } from '../../session';
import { ErrorBox, Field, Modal, PageHead, toast } from '../../ui';

type Verify = { company: { id: string; code: string; name: string }; created_at: string; schema: string; schema_ok: boolean; same_company: boolean; rows: number; tables: Record<string, number> };
const kb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** ดาวน์โหลดแฟ้มจาก API (คุกกี้ session) */
async function download(url: string) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) { const j = await res.json().catch(() => null); throw new Error(j?.error?.message ?? 'สำรองข้อมูลไม่สำเร็จ'); }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'backup.buddy';
  const blob = await res.blob();
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return { name, size: blob.size };
}
async function upload<T>(url: string, file: File): Promise<T> {
  const res = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/octet-stream' }, body: file });
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new Error(j?.error?.message ?? 'อ่านแฟ้มสำรองไม่สำเร็จ');
  return j as T;
}

/**
 * สำรอง / ทดสอบ / นำข้อมูลสำรองมาใช้ (คู่มือบทที่ 20 S-DM-02/03/04) + ข้อมูลผู้ใช้งาน (บทที่ 23 S-SEC-07/08)
 * แฟ้มสำรองเก็บที่เครื่องผู้ใช้ (ดาวน์โหลด) — แนะนำเก็บสื่อภายนอก แยกชุดตามวันที่ ไม่เขียนทับ
 */
export function BackupPage() {
  const qc = useQueryClient();
  const { me } = useSession();
  const can = useCan('OT.BACKUP');
  const canSec = useCan('SET.SEC');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [last, setLast] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [info, setInfo] = useState<Verify | null>(null);
  const [ask, setAsk] = useState<{ kind: 'company' | 'users'; text: string } | null>(null);
  const [ufile, setUfile] = useState<File | null>(null);
  const run = async (label: string, fn: () => Promise<void>) => { setErr(null); setBusy(label); try { await fn(); } catch (e) { setErr(e); } finally { setBusy(''); } };
  const restore = () => ask && run('restore', async () => {
    const f = ask.kind === 'company' ? file : ufile;
    if (!f) return;
    if (ask.kind === 'company') {
      const r = await upload<{ restored: string; rows: number; seconds: number }>(`/api/v1/backup/restore?confirm=${encodeURIComponent(ask.text)}`, f);
      toast(`นำข้อมูลสำรองของ ${r.restored} กลับแล้ว ${r.rows.toLocaleString()} แถว (${r.seconds} วินาที)`);
      qc.clear(); setTimeout(() => window.location.reload(), 800);
    } else {
      const r = await upload<{ restored: Record<string, number> }>(`/api/v1/backup/users/restore?confirm=${encodeURIComponent(ask.text)}`, f);
      toast(`นำข้อมูลผู้ใช้กลับแล้ว (${Object.values(r.restored).reduce((s, n) => s + n, 0)} รายการ)`);
      qc.invalidateQueries();
    }
    setAsk(null);
  });
  return (
    <div className="page" data-tone="setup">
      <PageHead eyebrow="อื่น ๆ › จัดการแฟ้มข้อมูล" title="สำรองข้อมูล / นำข้อมูลสำรองมาใช้" lead={`บริษัท ${me?.company?.code ?? ''} ${me?.company?.name_th ?? ''} — แฟ้มสำรองบีบอัดและตรวจความสมบูรณ์ได้ · นำกลับได้เฉพาะบริษัทเดียวกันกับที่สำรอง ไม่กระทบบริษัทอื่น`} />
      <ErrorBox error={err} />
      <fieldset className="box"><legend>1. สำรองข้อมูล</legend>
        <p className="small muted">ดาวน์โหลดแฟ้ม <span className="mono">ปปปปดดวว-รหัสบริษัท.buddy</span> ข้อมูลทั้งหมดของบริษัทนี้ (เอกสาร ใบสำคัญ แฟ้มหลัก ค่าเริ่มต้น) — สำรองทุกวันหลังเลิกงาน เก็บไว้หลายชุด</p>
        <button className="primary" disabled={!can('add') || !!busy} onClick={() => run('backup', async () => { const r = await download('/api/v1/backup/company'); setLast(`${r.name} (${kb(r.size)})`); toast(`สำรองข้อมูลแล้ว ${r.name}`); })}>{busy === 'backup' ? 'กำลังสำรองข้อมูล…' : 'เริ่มสำรอง'}</button>
        {last && <span className="small"> ✔ {last}</span>}
      </fieldset>
      <fieldset className="box"><legend>2. ทดสอบข้อมูลสำรอง / 3. นำข้อมูลสำรองมาใช้</legend>
        <Field label="แฟ้มข้อมูลสำรอง"><input type="file" accept=".buddy,application/gzip" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setInfo(null); }} /></Field>
        <div className="toolbar">
          <button disabled={!file || !can('read') || !!busy} onClick={() => run('verify', async () => setInfo(await upload<Verify>('/api/v1/backup/verify', file!)))}>{busy === 'verify' ? 'กำลังตรวจ…' : 'ทดสอบข้อมูลสำรอง'}</button>
          <button className="danger" disabled={!file || !can('edit') || !!busy || (info !== null && (!info.same_company || !info.schema_ok))} onClick={() => setAsk({ kind: 'company', text: '' })}>นำข้อมูลสำรองมาใช้…</button>
        </div>
        {info && <div className="note-box">
          <p>✔ แฟ้มสมบูรณ์ — บริษัท <b>{info.company.code} {info.company.name}</b> · สำรองเมื่อ {new Date(info.created_at).toLocaleString('th-TH')} · {info.rows.toLocaleString()} แถว {Object.keys(info.tables).length} ตาราง</p>
          {!info.same_company && <p className="bad">แฟ้มนี้เป็นของบริษัทอื่น — เลือกบริษัท {info.company.code} ก่อนนำข้อมูลกลับ</p>}
          {!info.schema_ok && <p className="bad">แฟ้มนี้มาจากโปรแกรมรุ่นโครงสร้างข้อมูลอื่น ({info.schema}) — นำกลับไม่ได้</p>}
        </div>}
      </fieldset>
      {canSec('read') && <fieldset className="box"><legend>ข้อมูลผู้ใช้งาน (ระบบความปลอดภัย)</legend>
        <p className="small muted">ผู้ใช้ กลุ่มผู้ใช้ รหัสผ่าน การผูกบริษัท และตารางสิทธิ์ของลูกค้ารายนี้ (S-SEC-07/08) — นำกลับแล้วรหัสผ่านที่เปลี่ยนหลังวันสำรองจะกลับเป็นแบบเดิม</p>
        <div className="toolbar">
          <button disabled={!!busy} onClick={() => run('ubackup', async () => { const r = await download('/api/v1/backup/users'); toast(`สำรองข้อมูลผู้ใช้แล้ว ${r.name}`); })}>สำรองข้อมูลผู้ใช้งาน</button>
          <input type="file" accept=".buddy,application/gzip" onChange={(e) => setUfile(e.target.files?.[0] ?? null)} aria-label="แฟ้มสำรองผู้ใช้งาน" />
          <button className="danger" disabled={!ufile || !canSec('edit') || !!busy} onClick={() => setAsk({ kind: 'users', text: '' })}>นำข้อมูลผู้ใช้ที่สำรองไว้กลับ…</button>
        </div>
      </fieldset>}
      {ask && <Modal title={ask.kind === 'company' ? 'นำข้อมูลสำรองมาใช้' : 'นำข้อมูลผู้ใช้กลับ'} size="confirm" onClose={() => setAsk(null)}
        footer={<><button onClick={() => setAsk(null)}>ยกเลิก</button><button className="danger" disabled={ask.text.trim().toUpperCase() !== 'YES' || !!busy} onClick={restore}>{busy === 'restore' ? 'กำลังคลายข้อมูล…' : 'คลายข้อมูล'}</button></>}>
        <p><b>*** คำเตือน ***</b> {ask.kind === 'company' ? `ข้อมูลปัจจุบันทั้งหมดของบริษัท ${me?.company?.code} จะถูกแทนที่ด้วยข้อมูลในแฟ้มสำรอง — รายการที่ทำหลังวันสำรองจะหายไป ควรสำรองข้อมูลปัจจุบันเก็บไว้ก่อน` : 'ผู้ใช้ กลุ่ม รหัสผ่าน และสิทธิ์จะกลับเป็นตามแฟ้มสำรอง'}</p>
        <Field label="ป้อน YES เพื่อยืนยัน" req><input autoFocus value={ask.text} onChange={(e) => setAsk({ ...ask, text: e.target.value })} /></Field>
      </Modal>}
    </div>
  );
}
