import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCan, useSession } from '../../session';
import { ErrorBox, Field, Modal, PageHead, PasswordInput, toast, useYearSystem } from '../../ui';
import { formatDate } from '@buddy/core';

type Totals = { journals: number; debit: string; credit: string };
type Verify = { company: { id: string; code: string; name: string }; created_at: string; schema: string; current_schema: string; schema_status: 'same' | 'older' | 'newer' | 'unknown' | 'too_old';
  schema_ok: boolean; schema_message: string | null; steps: string[]; same_company: boolean; encrypted: boolean; rows: number; tables: Record<string, number>; totals: Totals;
  /** ข้อมูลปัจจุบันของบริษัท (HANDOFF 200) — หน้าต่างเตือนก่อนนำข้อมูลสำรองมาใช้ */
  current?: { code: string; name: string; last_entry_at: string | null; last_doc_date: string | null; last_backup_at: string | null; last_backup_by: string | null; totals: Totals } };
type Restored = { restored: string; rows: number; seconds: number; encrypted: boolean; upgraded_from: string | null; steps: string[];
  checks: { tables: number; rows: number; journals: number; debit: string; credit: string; balanced: boolean } };
const kb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }) : '—');
const money = (s: string) => Number(s).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const BACKUP_PASSWORD_MIN = 8;

/** สำรอง: ส่งรหัสผ่านของแฟ้มใน body (ไม่อยู่ใน URL) → ดาวน์โหลดแฟ้มที่เข้ารหัสแล้ว */
async function download(url: string, password: string) {
  const res = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
  if (!res.ok) { const j = await res.json().catch(() => null); throw new Error(j?.error?.message ?? 'สำรองข้อมูลไม่สำเร็จ'); }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'backup.buddy';
  const blob = await res.blob();
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return { name, size: blob.size };
}
/** ทดสอบ/นำกลับ: รหัสผ่านของแฟ้มทางหัวคำขอ (ไม่อยู่ใน URL) · ชื่อแฟ้มไว้บันทึกเหตุการณ์ */
async function upload<T>(url: string, file: File, password: string): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/octet-stream', 'x-backup-file': encodeURIComponent(file.name) };
  if (password) headers['x-backup-password'] = encodeURIComponent(password);
  const res = await fetch(url, { method: 'POST', credentials: 'include', headers, body: file });
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new Error(j?.error?.message ?? 'อ่านแฟ้มสำรองไม่สำเร็จ');
  return j as T;
}
const pwProblem = (a: string, b: string) => (a.length < BACKUP_PASSWORD_MIN ? `รหัสผ่านอย่างน้อย ${BACKUP_PASSWORD_MIN} ตัวอักษร` : a !== b ? 'รหัสผ่านทั้งสองช่องไม่ตรงกัน' : null);

/** ตั้งรหัสผ่านของแฟ้ม 2 ครั้ง (ใช้ทั้งแฟ้มบริษัทและแฟ้มผู้ใช้) */
function NewPassword({ value, onChange, label }: { value: [string, string]; onChange: (v: [string, string]) => void; label: string }) {
  const [a, b] = value;
  const err = (a || b) ? pwProblem(a, b) : null;
  return (
    <div className="form-grid">
      <Field label={`${label} — ตั้งรหัสผ่านของแฟ้ม`} req hint={`อย่างน้อย ${BACKUP_PASSWORD_MIN} ตัวอักษร · จดเก็บไว้ ลืมแล้วเปิดแฟ้มไม่ได้ (ผู้ให้บริการกู้ให้ไม่ได้)`}>
        <PasswordInput autoComplete="new-password" value={a} onChange={(e) => onChange([e.target.value, b])} aria-label={`${label} รหัสผ่าน`} />
      </Field>
      <Field label="ป้อนรหัสผ่านอีกครั้ง" req error={err ?? undefined}>
        <PasswordInput autoComplete="new-password" value={b} onChange={(e) => onChange([a, e.target.value])} aria-label={`${label} รหัสผ่านอีกครั้ง`} />
      </Field>
    </div>
  );
}

/**
 * สำรอง / ทดสอบ / นำข้อมูลสำรองมาใช้ (คู่มือบทที่ 20 S-DM-02/03/04) + ข้อมูลผู้ใช้งาน (บทที่ 23 S-SEC-07/08)
 * แฟ้มสำรองเข้ารหัสด้วยรหัสผ่านที่ผู้ใช้ตั้ง (HANDOFF 146) · เก็บที่เครื่องผู้ใช้ (ดาวน์โหลด) — แนะนำเก็บสื่อภายนอก แยกชุดตามวันที่ ไม่เขียนทับ
 * แฟ้มจากโปรแกรมรุ่นเก่ากว่านำกลับได้ ระบบปรับให้อัตโนมัติ · ตรวจจำนวนแถว/ยอดใบสำคัญหลังนำกลับ
 */
export function BackupPage() {
  const qc = useQueryClient();
  const { me } = useSession();
  const can = useCan('OT.BACKUP');
  const canSec = useCan('SET.SEC');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [last, setLast] = useState<string | null>(null);
  const [pw, setPw] = useState<[string, string]>(['', '']);
  const [file, setFile] = useState<File | null>(null);
  const [filePw, setFilePw] = useState('');
  const [info, setInfo] = useState<Verify | null>(null);
  const [ask, setAsk] = useState<{ kind: 'company' | 'users'; text: string; saved?: boolean } | null>(null);
  const [done, setDone] = useState<Restored | null>(null);
  const [upw, setUpw] = useState<[string, string]>(['', '']);
  const [ufile, setUfile] = useState<File | null>(null);
  const [ufilePw, setUfilePw] = useState('');
  const run = async (label: string, fn: () => Promise<void>) => { setErr(null); setBusy(label); try { await fn(); } catch (e) { setErr(e); } finally { setBusy(''); } };
  const restore = () => ask && run('restore', async () => {
    if (ask.kind === 'company') {
      if (!file) return;
      const r = await upload<Restored>(`/api/v1/backup/restore?confirm=${encodeURIComponent(ask.text)}`, file, filePw);
      setDone(r); setAsk(null);
      toast(`นำข้อมูลสำรองของ ${r.restored} กลับแล้ว ${r.rows.toLocaleString()} แถว (${r.seconds} วินาที)`);
    } else {
      if (!ufile) return;
      const r = await upload<{ restored: Record<string, number>; upgraded_from: string | null }>(`/api/v1/backup/users/restore?confirm=${encodeURIComponent(ask.text)}`, ufile, ufilePw);
      toast(`นำข้อมูลผู้ใช้กลับแล้ว (${Object.values(r.restored).reduce((s, n) => s + n, 0)} รายการ)${r.upgraded_from ? ' · ปรับจากรุ่นเก่าให้แล้ว' : ''}`);
      qc.invalidateQueries(); setAsk(null);
    }
  });
  const pwErr = pwProblem(pw[0], pw[1]);
  const upwErr = pwProblem(upw[0], upw[1]);
  return (
    <div className="page" data-tone="setup">
      <PageHead eyebrow="อื่น ๆ › จัดการแฟ้มข้อมูล" title="สำรองข้อมูล / นำข้อมูลสำรองมาใช้" lead={`บริษัท ${me?.company?.code ?? ''} ${me?.company?.name_th ?? ''} — แฟ้มสำรองเข้ารหัสด้วยรหัสผ่านที่ตั้ง ตรวจความสมบูรณ์ได้ · นำกลับได้เฉพาะบริษัทเดียวกันกับที่สำรอง ไม่กระทบบริษัทอื่น · แฟ้มจากโปรแกรมรุ่นเก่ากว่าก็นำกลับได้`} />
      <ErrorBox error={err} />
      <fieldset className="box" id="backup-now"><legend>1. สำรองข้อมูล</legend>
        <p className="small muted">ดาวน์โหลดแฟ้ม <span className="mono">ปปปปดดวว-รหัสบริษัท.buddy</span> ข้อมูลทั้งหมดของบริษัทนี้ (เอกสาร ใบสำคัญ แฟ้มหลัก ค่าเริ่มต้น) เข้ารหัสด้วยรหัสผ่านที่ตั้ง — สำรองทุกวันหลังเลิกงาน เก็บไว้หลายชุด</p>
        {!can('add') && <p className="small bad">สำรองข้อมูลทั้งบริษัทได้เฉพาะผู้ดูแลระบบ หรือผู้ที่ผู้ดูแลให้สิทธิ์ "เพิ่ม" ที่เมนูนี้</p>}
        {can('add') && <NewPassword label="แฟ้มสำรองบริษัท" value={pw} onChange={setPw} />}
        <button className="primary" disabled={!can('add') || !!busy || !!pwErr} onClick={() => run('backup', async () => { const r = await download('/api/v1/backup/company', pw[0]); setLast(`${r.name} (${kb(r.size)})`); setPw(['', '']); toast(`สำรองข้อมูลแล้ว ${r.name} (เข้ารหัสแล้ว)`); })}>{busy === 'backup' ? 'กำลังสำรองข้อมูล…' : 'เริ่มสำรอง'}</button>
        {last && <span className="small"> ✔ {last} — เข้ารหัสแล้ว</span>}
      </fieldset>
      <fieldset className="box"><legend>2. ทดสอบข้อมูลสำรอง / 3. นำข้อมูลสำรองมาใช้</legend>
        <div className="form-grid">
          <Field label="แฟ้มข้อมูลสำรอง" req><input type="file" accept=".buddy,application/gzip,application/octet-stream" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setInfo(null); setDone(null); }} aria-label="แฟ้มข้อมูลสำรอง" /></Field>
          <Field label="รหัสผ่านของแฟ้ม" hint="รหัสที่ตั้งไว้ตอนสำรอง (แฟ้มรุ่นก่อนที่ไม่เข้ารหัสเว้นว่างได้)"><PasswordInput autoComplete="off" value={filePw} onChange={(e) => setFilePw(e.target.value)} aria-label="รหัสผ่านของแฟ้ม" /></Field>
        </div>
        <div className="toolbar">
          <button disabled={!file || !can('read') || !!busy} onClick={() => run('verify', async () => setInfo(await upload<Verify>('/api/v1/backup/verify', file!, filePw)))}>{busy === 'verify' ? 'กำลังตรวจ…' : 'ทดสอบข้อมูลสำรอง'}</button>
          {/* HANDOFF 200: ทดสอบแฟ้มก่อนเสมอ — หน้าต่างเตือนแสดงบริษัท/วันที่ของแฟ้มเทียบกับข้อมูลปัจจุบัน */}
          <button className="danger" disabled={!file || !can('edit') || !!busy || (info !== null && (!info.same_company || !info.schema_ok))}
            onClick={() => run('verify', async () => { const v = info ?? await upload<Verify>('/api/v1/backup/verify', file!, filePw); setInfo(v); if (v.same_company && v.schema_ok) setAsk({ kind: 'company', text: '' }); })}>นำข้อมูลสำรองมาใช้…</button>
        </div>
        {info && <div className="note-box">
          <p>✔ แฟ้มสมบูรณ์ — บริษัท <b>{info.company.code} {info.company.name}</b> · สำรองเมื่อ {new Date(info.created_at).toLocaleString('th-TH')} · {info.rows.toLocaleString()} แถว {Object.keys(info.tables).length} ตาราง</p>
          <p>ใบสำคัญ {info.totals.journals.toLocaleString()} ใบ · เดบิต {money(info.totals.debit)} · เครดิต {money(info.totals.credit)}</p>
          {info.encrypted ? <p className="ok">🔒 แฟ้มเข้ารหัสแล้ว</p> : <p className="warn-text">⚠ แฟ้มรุ่นก่อนที่ไม่ได้เข้ารหัส — นำกลับได้ แต่ใครได้แฟ้มไปก็เปิดอ่านได้ ควรสำรองใหม่ (เข้ารหัส) แล้วลบแฟ้มนี้</p>}
          {!info.same_company && <p className="bad">✕ แฟ้มนี้เป็นของบริษัทอื่น — เลือกบริษัท {info.company.code} ก่อนนำข้อมูลกลับ</p>}
          {info.schema_status === 'older' && info.schema_ok && <p className="warn-text">⚠ {info.schema_message}{info.steps.length ? ` (ปรับ: ${info.steps.join(' · ')})` : ''}</p>}
          {!info.schema_ok && <p className="bad">✕ {info.schema_message}</p>}
        </div>}
        {done && <div className="note-box">
          <p className="ok">✔ นำข้อมูลสำรองของ {done.restored} กลับแล้ว — ตรวจครบ {done.checks.tables} ตาราง {done.checks.rows.toLocaleString()} แถว ตรงกับแฟ้ม</p>
          <p>ใบสำคัญ {done.checks.journals.toLocaleString()} ใบ · เดบิต {money(done.checks.debit)} · เครดิต {money(done.checks.credit)} {done.checks.balanced ? '· เดบิต = เครดิต ✔' : '· ⚠ เดบิตไม่เท่าเครดิต (ตามแฟ้มสำรอง)'}</p>
          {done.upgraded_from && <p className="small">ปรับข้อมูลจากรุ่น {done.upgraded_from} ให้แล้ว{done.steps.length ? `: ${done.steps.join(' · ')}` : ''}</p>}
          <button className="primary" autoFocus onClick={() => { qc.clear(); window.location.reload(); }}>ตกลง — โหลดหน้าจอใหม่</button>
        </div>}
      </fieldset>
      {canSec('read') && <fieldset className="box"><legend>ข้อมูลผู้ใช้งาน (ระบบความปลอดภัย)</legend>
        <p className="small muted">ผู้ใช้ กลุ่มผู้ใช้ รหัสผ่าน การผูกบริษัท และตารางสิทธิ์ของลูกค้ารายนี้ (S-SEC-07/08) เข้ารหัสด้วยรหัสผ่านที่ตั้ง — นำกลับแล้วรหัสผ่านที่เปลี่ยนหลังวันสำรองจะกลับเป็นแบบเดิม</p>
        <NewPassword label="แฟ้มสำรองผู้ใช้" value={upw} onChange={setUpw} />
        <div className="toolbar">
          <button disabled={!!busy || !!upwErr} onClick={() => run('ubackup', async () => { const r = await download('/api/v1/backup/users', upw[0]); setUpw(['', '']); toast(`สำรองข้อมูลผู้ใช้แล้ว ${r.name} (เข้ารหัสแล้ว)`); })}>สำรองข้อมูลผู้ใช้งาน</button>
        </div>
        <div className="form-grid">
          <Field label="แฟ้มสำรองผู้ใช้งาน"><input type="file" accept=".buddy,application/gzip,application/octet-stream" onChange={(e) => setUfile(e.target.files?.[0] ?? null)} aria-label="แฟ้มสำรองผู้ใช้งาน" /></Field>
          <Field label="รหัสผ่านของแฟ้มผู้ใช้"><PasswordInput autoComplete="off" value={ufilePw} onChange={(e) => setUfilePw(e.target.value)} aria-label="รหัสผ่านของแฟ้มผู้ใช้" /></Field>
        </div>
        <div className="toolbar">
          <button className="danger" disabled={!ufile || !canSec('edit') || !!busy} onClick={() => setAsk({ kind: 'users', text: '' })}>นำข้อมูลผู้ใช้ที่สำรองไว้กลับ…</button>
        </div>
      </fieldset>}
      {ask?.kind === 'company' && info && <RestoreWarning info={info} text={ask.text} saved={!!ask.saved} lastFile={last} busy={busy === 'restore'}
        onText={(text) => setAsk({ ...ask, text })} onSaved={(saved) => setAsk({ ...ask, saved })} onClose={() => setAsk(null)} onRestore={restore}
        onBackupFirst={() => { setAsk(null); document.getElementById('backup-now')?.scrollIntoView({ block: 'center' }); (document.querySelector('#backup-now input') as HTMLInputElement | null)?.focus(); }} />}
      {ask?.kind === 'users' && <Modal title="นำข้อมูลผู้ใช้กลับ" size="confirm" onClose={() => setAsk(null)}
        footer={<><button onClick={() => setAsk(null)}>ยกเลิก</button><button className="danger" disabled={ask.text.trim().toUpperCase() !== 'YES' || !!busy} onClick={restore}>{busy === 'restore' ? 'กำลังคลายข้อมูล…' : 'คลายข้อมูล'}</button></>}>
        <p><b>*** คำเตือน ***</b> ผู้ใช้ กลุ่ม รหัสผ่าน และสิทธิ์จะกลับเป็นตามแฟ้มสำรอง</p>
        <Field label="ป้อน YES เพื่อยืนยัน" req><input autoFocus value={ask.text} onChange={(e) => setAsk({ ...ask, text: e.target.value })} /></Field>
      </Modal>}
    </div>
  );
}

/**
 * หน้าต่างเตือนก่อนนำข้อมูลสำรองมาใช้ (HANDOFF 200 · เจ้าของ 26/11/2569 "ต้องมีการเตือนการนำเข้าไว้")
 * แฟ้มสำรอง ↔ ข้อมูลปัจจุบัน (บริษัท วันที่ ใบสำคัญ) · รายการหลังวันสำรองจะหาย · แนะนำสำรองข้อมูลปัจจุบันก่อน · ยืนยันด้วยรหัสบริษัท
 */
function RestoreWarning({ info, text, saved, lastFile, busy, onText, onSaved, onClose, onRestore, onBackupFirst }: {
  info: Verify; text: string; saved: boolean; lastFile: string | null; busy: boolean; onText: (t: string) => void; onSaved: (v: boolean) => void; onClose: () => void; onRestore: () => void; onBackupFirst: () => void }) {
  const cur = info.current;
  const ys = useYearSystem();
  const code = cur?.code ?? info.company.code;
  const newer = !!cur?.last_entry_at && new Date(cur.last_entry_at).getTime() > new Date(info.created_at).getTime();
  const ok = text.trim().toUpperCase() === code.toUpperCase() && saved && !busy;
  return (
    <Modal title="นำข้อมูลสำรองมาใช้ — เขียนทับข้อมูลปัจจุบัน" onClose={onClose}
      footer={<><button autoFocus onClick={onClose}>ยกเลิก (ไม่เปลี่ยนข้อมูล)</button><button className="danger" disabled={!ok} onClick={onRestore}>{busy ? 'กำลังคลายข้อมูล…' : `แทนที่ข้อมูลของ ${code}`}</button></>}>
      <div className="errbox restore-warn" role="alert">
        <b>*** คำเตือน ***</b> ข้อมูลปัจจุบันทั้งหมดของบริษัท <b data-no-i18n>{code} {cur?.name ?? ''}</b> จะถูก<b>แทนที่</b>ด้วยข้อมูลในแฟ้มสำรอง — ย้อนกลับไม่ได้ นอกจากนำแฟ้มสำรองที่ทำไว้ก่อนหน้านี้มาใช้อีกครั้ง
      </div>
      <table className="grid restore-compare">
        <thead><tr><th></th><th>แฟ้มสำรอง (ข้อมูลที่จะได้)</th><th>ข้อมูลปัจจุบัน (จะถูกแทนที่)</th></tr></thead>
        <tbody>
          <tr><th>บริษัท</th><td data-no-i18n>{info.company.code} {info.company.name}</td><td data-no-i18n>{code} {cur?.name ?? ''}</td></tr>
          <tr><th>ข้อมูล ณ</th><td>สำรองเมื่อ {when(info.created_at)}</td><td>บันทึกล่าสุด {when(cur?.last_entry_at)}{cur?.last_doc_date ? ` · เอกสารวันที่ล่าสุด ${formatDate(cur.last_doc_date.slice(0, 10), ys)}` : ''}</td></tr>
          <tr><th>ใบสำคัญ</th><td className="num">{info.totals.journals.toLocaleString()} ใบ · เดบิต {money(info.totals.debit)}</td><td className="num">{cur ? `${cur.totals.journals.toLocaleString()} ใบ · เดบิต ${money(cur.totals.debit)}` : '—'}</td></tr>
        </tbody>
      </table>
      {newer && <p className="bad">⚠ มีรายการที่บันทึกหลังวันสำรอง (ล่าสุด {when(cur?.last_entry_at)}) — รายการเหล่านั้นจะหายไปทั้งหมด</p>}
      <div className="note-box">
        <p><b>สำรองข้อมูลปัจจุบันก่อน (แนะนำ)</b> — ถ้านำกลับผิดแฟ้ม จะได้ใช้แฟ้มนี้กู้คืน</p>
        <p className="small">{lastFile ? `✔ สำรองในหน้านี้แล้ว: ${lastFile}` : cur?.last_backup_at ? `สำรองครั้งล่าสุด ${when(cur.last_backup_at)}${cur.last_backup_by ? ` โดย ${cur.last_backup_by}` : ''}${newer && new Date(cur.last_backup_at).getTime() < new Date(cur.last_entry_at!).getTime() ? ' — เก่ากว่ารายการล่าสุด' : ''}` : 'ยังไม่เคยสำรองข้อมูลของบริษัทนี้'}</p>
        {!lastFile && <button type="button" onClick={onBackupFirst}>ไปสำรองข้อมูลปัจจุบันก่อน</button>}
        <label className="inline"><input type="checkbox" checked={saved} onChange={(e) => onSaved(e.target.checked)} /> สำรองข้อมูลปัจจุบันไว้แล้ว หรือไม่ต้องการเก็บข้อมูลปัจจุบัน</label>
      </div>
      <Field label={`ป้อนรหัสบริษัท ${code} เพื่อยืนยัน`} req hint="ระบบตรวจจำนวนแถวและยอดใบสำคัญให้ — ไม่ตรงกับแฟ้ม = ยกเลิกทั้งหมด ข้อมูลเดิมไม่หาย">
        <input value={text} onChange={(e) => onText(e.target.value)} aria-label="รหัสบริษัทเพื่อยืนยัน" autoComplete="off" />
      </Field>
    </Modal>
  );
}
