import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { ErrorBox, Modal, toast, useHotkeys } from '../ui';

/** แก้รายการบรรทัดข้อความ (เพิ่ม/ลบบรรทัด) — ใช้ทั้งหมายเหตุเอกสารและแฟ้มหลัก */
function LinesEditor({ value, onChange, max, disabled }: { value: string[]; onChange: (v: string[]) => void; max: number; disabled?: boolean }) {
  const rows = value.length ? value : [''];
  return (
    <div className="note-lines">
      {rows.map((t, i) => <div key={i} className="note-line"><span className="muted small">{i + 1}</span>
        <input value={t} maxLength={200} disabled={disabled} autoFocus={i === 0} aria-label={`หมายเหตุบรรทัดที่ ${i + 1}`}
          onChange={(e) => onChange(rows.map((x, k) => (k === i ? e.target.value : x)))}
          onKeyDown={(e) => { if (e.key === 'Enter' && i === rows.length - 1 && rows.length < max && t.trim()) { e.preventDefault(); onChange([...rows, '']); } }} />
        {!disabled && <button type="button" className="icon-btn" title="ลบบรรทัด" tabIndex={-1} onClick={() => onChange(rows.filter((_, k) => k !== i))}>✕</button>}</div>)}
      {!disabled && rows.length < max && <button type="button" className="linklike" onClick={() => onChange([...rows, ''])}>+ เพิ่มบรรทัด</button>}
      <span className="muted small"> สูงสุด {max} บรรทัด</span>
    </div>
  );
}

type DocNotes = { doc_no: string; editable: boolean; doc: string[] };
/**
 * หมายเหตุเอกสาร (ทั้งเอกสาร · Alt+R) — พิมพ์ในกล่องหมายเหตุด้านล่างของเอกสาร (ข้อกำหนดเจ้าของ 30/10/2569)
 * หมายเหตุรายการแยกไปคีย์ที่บรรทัดรายการ (ปุ่ม 📝 / Alt+M) — ดู LineNoteButton
 */
export function DocNotesDialog({ id, onClose, canEdit }: { id: string; onClose: () => void; canEdit: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['doc-notes', id], queryFn: () => api.get<DocNotes>(`/api/v1/notes/doc/${id}`), staleTime: 0 });
  const [doc, setDoc] = useState<string[]>([]);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => { if (q.data) setDoc(q.data.doc); }, [q.data]);
  const editable = canEdit && !!q.data?.editable;
  const save = async () => {
    if (!editable) return;
    try { await api.put(`/api/v1/notes/doc/${id}`, { doc }); toast('บันทึกหมายเหตุเอกสารแล้ว'); qc.invalidateQueries({ queryKey: ['doc-notes', id] }); qc.invalidateQueries({ queryKey: ['print'] }); onClose(); }
    catch (e) { setErr(e); }
  };
  useHotkeys({ F9: save, 'Ctrl+S': save });
  return (
    <Modal title={`หมายเหตุเอกสาร ${q.data?.doc_no ?? ''}`} onClose={onClose} footer={<><button onClick={onClose}>ยกเลิก <kbd>Esc</kbd></button><button className="primary" disabled={!editable} onClick={save}>ตกลง <kbd>F9</kbd></button></>}>
      <ErrorBox error={err ?? q.error} />
      {q.data && <>
        <p className="hint">หมายเหตุของทั้งเอกสาร — พิมพ์ในกล่องหมายเหตุด้านล่างของเอกสาร · หมายเหตุของแต่ละรายการ คีย์ที่ปุ่ม 📝 ในบรรทัดรายการ (Alt+M)</p>
        <LinesEditor value={doc} onChange={setDoc} max={20} disabled={!editable} />
        {!q.data.editable && <p className="hint">เอกสารถูกยกเลิกแล้ว — ดูได้อย่างเดียว</p>}
      </>}
    </Modal>
  );
}

/**
 * หมายเหตุรายการ (ข้อกำหนดเจ้าของ 30/10/2569): คีย์ตอนคีย์รายการ หลายบรรทัด + ติ๊ก "พิมพ์" = แสดงเป็นบรรทัดใต้รายการในเอกสารที่พิมพ์
 * ปุ่ม 📝 ในบรรทัด (มีหมายเหตุแล้วปุ่มเป็นสี) · Alt+M ขณะอยู่ในบรรทัด = เปิดหมายเหตุของบรรทัดนั้น (useLineNoteHotkey)
 */
export function LineNoteButton({ note, print, disabled, label, onChange }: { note: string | null | undefined; print: boolean | null | undefined; disabled?: boolean; label?: string; onChange: (v: { line_note: string; line_note_print: boolean }) => void }) {
  const [open, setOpen] = useState(false);
  const has = !!note?.trim();
  // span กันคลิก (รวมคลิกในหน้าต่าง ซึ่ง React ส่งต่อผ่าน portal) ไม่ให้ไปติ๊ก/เปิดแถวของตาราง
  return <span className="line-note" onClick={(e) => e.stopPropagation()}>
    <button type="button" className={'icon-btn line-note-btn' + (has ? ' has-note' : '')} data-line-note tabIndex={-1} onClick={() => setOpen(true)}
      title={has ? `หมายเหตุรายการ${print ? ' (พิมพ์ใต้รายการ)' : ' (ไม่พิมพ์)'}: ${note}` : 'เพิ่มหมายเหตุรายการ (Alt+M)'} aria-label={`หมายเหตุรายการ${label ? ` ${label}` : ''}`}>📝</button>
    {open && <LineNoteDialog note={note ?? ''} print={has ? !!print : true} disabled={disabled} label={label} onClose={() => setOpen(false)} onOk={(v) => { onChange(v); setOpen(false); }} />}
  </span>;
}
/** หน้าต่างหมายเหตุรายการ — ปุ่มลัดลงทะเบียนที่นี่ (เหนือ Modal) ให้ F9 ทำงานในหน้าต่าง */
function LineNoteDialog({ note, print, disabled, label, onClose, onOk }: { note: string; print: boolean; disabled?: boolean; label?: string; onClose: () => void; onOk: (v: { line_note: string; line_note_print: boolean }) => void }) {
  const [txt, setTxt] = useState(note);
  const [pr, setPr] = useState(print);
  const ok = () => { if (!disabled) onOk({ line_note: txt.trim(), line_note_print: !!txt.trim() && pr }); };
  useHotkeys({ F9: ok, 'Ctrl+S': ok });
  return (
    <Modal title={`หมายเหตุรายการ${label ? ` — ${label}` : ''}`} onClose={onClose}
      footer={<><button onClick={onClose}>ยกเลิก <kbd>Esc</kbd></button><button className="primary" disabled={disabled} onClick={ok}>ตกลง <kbd>F9</kbd></button></>}>
      <textarea value={txt} rows={5} maxLength={2000} autoFocus disabled={disabled} aria-label="ข้อความหมายเหตุรายการ" placeholder="อธิบายรายการเพิ่มเติม (กด Enter ขึ้นบรรทัดใหม่ได้)" onChange={(e) => setTxt(e.target.value)} style={{ width: '100%' }} />
      <label className="check" style={{ marginTop: 8 }}><input type="checkbox" checked={pr} disabled={disabled} onChange={(e) => setPr(e.target.checked)} /> พิมพ์หมายเหตุนี้ในเอกสาร (แสดงเป็นบรรทัดใต้รายการนี้)</label>
    </Modal>
  );
}

/** ข้อความหมายเหตุรายการใต้ช่องรายละเอียดในหน้าจอ (ให้เห็นว่ามีหมายเหตุ และจะพิมพ์หรือไม่) */
export function LineNotePreview({ note, print }: { note: string | null | undefined; print: boolean | null | undefined }) {
  if (!note?.trim()) return null;
  return <div className="line-note-preview" title={print ? 'พิมพ์ใต้รายการ' : 'ไม่พิมพ์'}>{print ? '🖨 ' : ''}{note}</div>;
}

/** Alt+M ขณะเคอร์เซอร์อยู่ในบรรทัดรายการ → เปิดหมายเหตุรายการของบรรทัดนั้น (เรียกครั้งเดียวต่อหน้าจอ) */
export function useLineNoteHotkey() {
  useHotkeys({ 'Alt+M': () => { (document.activeElement?.closest('tr')?.querySelector('[data-line-note]') as HTMLButtonElement | null)?.click(); } });
}

/** หมายเหตุเพิ่มเติมของแฟ้มหลัก (S-MF-02): สินค้า 10 บรรทัด · ลูกค้า/ผู้จำหน่าย 5 บรรทัด */
export function MasterNotesDialog({ entity, id, title, onClose, canEdit }: { entity: 'item' | 'customer' | 'supplier'; id: string; title: string; onClose: () => void; canEdit: boolean }) {
  const q = useQuery({ queryKey: ['master-notes', entity, id], queryFn: () => api.get<{ max: number; notes: string[] }>(`/api/v1/master-notes/${entity}/${id}`), staleTime: 0 });
  const [v, setV] = useState<string[]>([]);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => { if (q.data) setV(q.data.notes); }, [q.data]);
  const save = async () => {
    if (!canEdit) return;
    try { await api.put(`/api/v1/master-notes/${entity}/${id}`, { notes: v }); toast('บันทึกหมายเหตุแล้ว'); onClose(); } catch (e) { setErr(e); }
  };
  useHotkeys({ F9: save, 'Ctrl+S': save });
  return (
    <Modal title={`หมายเหตุเพิ่มเติม ${title}`} onClose={onClose} footer={<><button onClick={onClose}>ยกเลิก <kbd>Esc</kbd></button><button className="primary" disabled={!canEdit} onClick={save}>ตกลง <kbd>F9</kbd></button></>}>
      <ErrorBox error={err ?? q.error} />
      {q.data && <LinesEditor value={v} onChange={setV} max={q.data.max} disabled={!canEdit} />}
    </Modal>
  );
}
