import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { MASTER_IMPORT_KINDS } from '@buddy/core';
import { api } from '../../api';
import { useCan, useSession } from '../../session';
import { Confirm, ErrorBox, Field, KeyHints, PageHead, Pill, toast, useHotkeys } from '../../ui';
import { download, readBase64 } from './TradeImport';

type Row = { row: number; code: string; name: string | null; action: 'add' | 'update' | 'skip'; changed: string[]; warnings: string[] };
type Result = { ok: boolean; committed: boolean; update: boolean; rows: Row[]; errors: Array<{ row: number; message: string }>; file_rows: number; added: number; updated: number; skipped: number };
const ACT: Record<Row['action'], [string, 'n' | 'm' | 'c']> = { add: ['เพิ่ม', 'n'], update: ['แก้', 'm'], skip: ['ข้าม', 'c'] };

/**
 * นำเข้าข้อมูลหลักจากแฟ้ม Excel (HANDOFF 173 — เจ้าของ 22/11/2569 "เพิ่มใหม่+แก้เมื่อติ๊ก")
 * ลูกค้า ผู้จำหน่าย สินค้า บริการ ทรัพย์สิน: รหัสใหม่ = เพิ่ม · รหัสที่มีแล้ว = ข้าม (ติ๊ก "แก้ข้อมูลรหัสเดิมด้วย" = แก้เฉพาะช่องที่ใส่)
 * ตรวจก่อน (ไม่บันทึก) แสดงทุกแถวว่า เพิ่ม/แก้/ข้าม → นำเข้า (ทั้งแฟ้มหรือไม่บันทึกเลย)
 */
export function MasterImportPage() {
  const can = useCan('OT.IMPTRADE');
  const { me } = useSession();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const kinds = MASTER_IMPORT_KINDS.filter((k) => me?.perms?.[k.menu]?.add !== false);
  const from = kinds.find((k) => k.path === sp.get('kind'));
  const [path, setPath] = useState(from?.path ?? kinds[0]?.path ?? 'customers');
  const K = MASTER_IMPORT_KINDS.find((k) => k.path === path) ?? MASTER_IMPORT_KINDS[0]!;
  const canEdit = me?.perms?.[K.menu]?.edit !== false;
  const [update, setUpdate] = useState(false);
  const [file, setFile] = useState<{ name: string; data: string } | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(false);
  const reset = () => { setRes(null); setErr(null); };
  const run = async (commit: boolean, f = file, upd = update) => {
    if (!f || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.post<Result>(`/api/v1/master-import/${K.path}`, { file_name: f.name, data: f.data, update: upd, commit });
      setRes(r);
      if (commit) { toast(`นำเข้า${K.label}แล้ว — เพิ่ม ${r.added} · แก้ ${r.updated} · ข้าม ${r.skipped}`); qc.invalidateQueries(); }
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const pick = async (f: File | undefined) => {
    if (!f) return;
    reset();
    try { const v = { name: f.name, data: await readBase64(f) }; setFile(v); await run(false, v); } catch (e) { setErr(e); }
  };
  const ready = !!res && !res.committed && res.ok && res.added + res.updated > 0;
  const back = from ? () => nav(from.route) : undefined;
  useHotkeys({ F9: can('add') && ready ? () => setAsk(true) : undefined, Escape: back && !ask ? back : undefined }, [ready, ask, back]);
  const warnCount = res?.rows.filter((x) => x.warnings.length).length ?? 0;

  return (
    <div className="page">
      <PageHead eyebrow="อื่น ๆ › นำเข้าข้อมูล" title="นำเข้าข้อมูลหลักจากแฟ้ม Excel"
        lead={<>หนึ่งแถวในแฟ้ม = {K.label}หนึ่งรหัส · รหัสที่ยังไม่มี = <b>เพิ่มใหม่</b> (ว่าง = ออกรหัสให้) · รหัสที่มีแล้ว = <b>ข้าม</b> หรือ<b>แก้</b>เมื่อติ๊กด้านล่าง (แก้เฉพาะช่องที่ใส่ — ช่องว่างคงค่าเดิม ไม่เปลี่ยนรหัส) · เลือกแฟ้มแล้วระบบ<b>ตรวจก่อน</b> (ยังไม่บันทึก) · กดนำเข้าแล้วบันทึกทุกแถวพร้อมกัน — ถ้าผิดแถวเดียวจะไม่บันทึกเลย</>}
        actions={<>{can('add') && <button className="primary" disabled={!ready || busy} onClick={() => setAsk(true)}>นำเข้า {ready ? `${res!.added + res!.updated} รายการ` : ''} <kbd>F9</kbd></button>}
          {back && <button onClick={back} title={`กลับไปหน้า${from!.label}`}>{from!.label} <kbd>Esc</kbd></button>}</>} />
      <div className="card ti-steps">
        <div className="form-grid">
          <Field label="1. แฟ้มข้อมูลหลัก" req>
            <select value={path} onChange={(e) => { setPath(e.target.value); setFile(null); reset(); }}>{kinds.map((k) => <option key={k.path} value={k.path}>{k.label}</option>)}</select>
          </Field>
        </div>
        <label className="check ti-masters" title={canEdit ? undefined : `ไม่มีสิทธิ์แก้${K.label}`}>
          <input type="checkbox" checked={update} disabled={!canEdit} onChange={(e) => { setUpdate(e.target.checked); if (file && !res?.committed) void run(false, file, e.target.checked); else reset(); }} />
          แก้ข้อมูลรหัสเดิมด้วย <span className="muted small">(ไม่ติ๊ก = รหัสที่มีแล้วข้ามไป · ติ๊ก = แก้เฉพาะช่องที่ใส่ในแฟ้ม ช่องว่างคงค่าเดิม · แท็บย่อย เช่น สาขา ผู้ติดต่อ คงเดิม){K.path === 'fa-assets' ? ' · ทรัพย์สินที่คิดค่าเสื่อมลงบัญชีแล้วแก้ช่องที่ใช้คิดค่าเสื่อมไม่ได้' : ''}</span>
        </label>
        <p className="hint small">แบบฟอร์มมีทุกช่องของหน้าจอ{K.label} · หัวคอลัมน์สีชมพู มี * = ต้องมีเมื่อเพิ่มใหม่ · สีเหลือง = ต้องมีตามเงื่อนไข · อื่น ๆ เว้นว่างได้ (ดูแผ่น "คำอธิบาย") · แฟ้มแก้ข้อมูลใส่เฉพาะรหัส ชื่อ และช่องที่จะแก้ได้</p>
        <div className="ti-actions">
          <button type="button" onClick={() => download(`/api/v1/master-import/${K.path}/template`, `import-${K.path}.xlsx`).then((n) => toast(`ดาวน์โหลด ${n} แล้ว`)).catch(setErr)}>⬇ 2. แบบฟอร์มตัวอย่าง {K.label} (.xlsx)</button>
          {can('add') && <label className="btn primary-soft">⬆ 3. เลือกแฟ้มที่กรอกแล้ว (.xlsx / .csv)…<input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} /></label>}
          {file && <span className="muted small">แฟ้ม: <b>{file.name}</b></span>}
          {file && !res?.committed && <button type="button" disabled={busy} onClick={() => run(false)}>↻ ตรวจแฟ้มอีกครั้ง</button>}
          {busy && <span className="muted">กำลังตรวจ…</span>}
        </div>
      </div>
      <ErrorBox error={err} />
      {res && <>
        <div className="ti-summary">
          {res.committed ? <Pill tone="n">✓ นำเข้าแล้ว</Pill> : res.ok ? <Pill tone="n">พร้อมนำเข้า</Pill> : <Pill tone="x">ต้องแก้ {res.errors.length} รายการ</Pill>}
          <span>เพิ่ม <b>{res.added}</b> · แก้ <b>{res.updated}</b> · ข้าม <b>{res.skipped}</b></span>
          {!res.committed && !res.ok && <span className="muted small">แก้ในแฟ้มแล้วเลือกแฟ้มใหม่ (ไม่มีอะไรถูกบันทึก)</span>}
          {res.skipped > 0 && !res.update && <span className="muted small">ข้าม = รหัสที่มีแล้ว — ติ๊ก "แก้ข้อมูลรหัสเดิมด้วย" เพื่อแก้</span>}
          {warnCount > 0 && <span className="warn-text small">มีคำเตือน {warnCount} รายการ (บันทึกได้)</span>}
        </div>
        {res.errors.length > 0 && <div className="table-wrap ti-errors">
          <table className="grid">
            <thead><tr><th style={{ width: 70 }}>แถวที่</th><th>ต้องแก้</th></tr></thead>
            <tbody>{res.errors.map((e, i) => <tr key={i}><td className="r num">{e.row}</td><td>{e.message}</td></tr>)}</tbody>
          </table>
        </div>}
        {res.rows.length > 0 && <div className="table-wrap">
          <table className="grid">
            <thead><tr><th style={{ width: 60 }}>แถว</th><th style={{ width: 90 }}>ผล</th><th style={{ width: 160 }}>รหัส</th><th>ชื่อ</th><th>ช่องที่แก้</th></tr></thead>
            <tbody>{res.rows.map((x) => <tr key={`${x.row}-${x.code}`}>
              <td className="r num muted">{x.row}</td><td><Pill tone={ACT[x.action][1]}>{ACT[x.action][0]}</Pill></td><td className="mono">{x.code}</td>
              <td>{x.name}{x.warnings.map((w, i) => <div key={i} className="warn-text small">⚠ {w}</div>)}</td>
              <td className="small">{x.action === 'update' ? x.changed.join(', ') : x.action === 'skip' ? <span className="muted">รหัสมีแล้ว</span> : ''}</td>
            </tr>)}</tbody>
          </table>
        </div>}
      </>}
      <KeyHints keys={[['F9', 'นำเข้า (เมื่อตรวจผ่าน)'], ...(back ? [['Esc', `กลับไปหน้า${from!.label}`] as [string, string]] : [])]} />
      {ask && res && <Confirm title={`นำเข้า${K.label}`} okText={`นำเข้า ${res.added + res.updated} รายการ`}
        text={<>เพิ่ม{K.label}ใหม่ <b>{res.added}</b> รหัส · แก้รหัสเดิม <b>{res.updated}</b> รหัส · ข้าม {res.skipped} รหัส — บันทึกทุกรายการพร้อมกัน</>}
        onOk={() => { setAsk(false); void run(true); }} onClose={() => setAsk(false)} />}
    </div>
  );
}
