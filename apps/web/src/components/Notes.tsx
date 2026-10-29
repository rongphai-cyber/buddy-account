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

type DocNotes = { doc_no: string; editable: boolean; doc: string[]; lines: Array<{ line_id: string; line_no: number; code: string | null; name: string | null; notes: string[] }> };
/** หมายเหตุเพิ่มเติมของเอกสาร (Alt+R · S-SL-02 / S-PU-C2): ระดับเอกสาร + รายบรรทัดสินค้า (บันทึกเอกสารก่อน) */
export function DocNotesDialog({ id, onClose, canEdit }: { id: string; onClose: () => void; canEdit: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['doc-notes', id], queryFn: () => api.get<DocNotes>(`/api/v1/notes/doc/${id}`), staleTime: 0 });
  const [doc, setDoc] = useState<string[]>([]);
  const [lines, setLines] = useState<Record<string, string[]>>({});
  const [sel, setSel] = useState<string>('');
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => { if (q.data) { setDoc(q.data.doc); setLines(Object.fromEntries(q.data.lines.map((l) => [l.line_id, l.notes]))); } }, [q.data]);
  const editable = canEdit && !!q.data?.editable;
  const save = async () => {
    if (!editable) return;
    try { await api.put(`/api/v1/notes/doc/${id}`, { doc, lines: Object.fromEntries(Object.entries(lines).filter(([, v]) => v.some((x) => x.trim()))) }); toast('บันทึกหมายเหตุแล้ว'); qc.invalidateQueries({ queryKey: ['print'] }); onClose(); }
    catch (e) { setErr(e); }
  };
  useHotkeys({ F9: save, 'Ctrl+S': save });
  const cur = q.data?.lines.find((l) => l.line_id === sel);
  return (
    <Modal title={`หมายเหตุเพิ่มเติม ${q.data?.doc_no ?? ''}`} onClose={onClose} footer={<><button onClick={onClose}>ยกเลิก <kbd>Esc</kbd></button><button className="primary" disabled={!editable} onClick={save}>ตกลง <kbd>F9</kbd></button></>}>
      <ErrorBox error={err ?? q.error} />
      {q.data && <>
        <label className="small">หมายเหตุของ <select value={sel} onChange={(e) => setSel(e.target.value)}><option value="">ทั้งเอกสาร</option>
          {q.data.lines.map((l) => <option key={l.line_id} value={l.line_id}>บรรทัด {l.line_no} {l.code} {l.name}{(lines[l.line_id] ?? []).some((x) => x.trim()) ? ' ✎' : ''}</option>)}</select></label>
        {sel ? <LinesEditor key={sel} value={lines[sel] ?? []} onChange={(v) => setLines({ ...lines, [sel]: v })} max={10} disabled={!editable} />
          : <LinesEditor key="doc" value={doc} onChange={setDoc} max={20} disabled={!editable} />}
        {cur && <p className="hint">หมายเหตุของรายการ {cur.code} — พิมพ์ต่อท้ายบรรทัดสินค้า</p>}
        {!q.data.editable && <p className="hint">เอกสารถูกยกเลิกแล้ว — ดูได้อย่างเดียว</p>}
      </>}
    </Modal>
  );
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
