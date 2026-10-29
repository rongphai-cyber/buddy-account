import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, type Book } from '../../api';
import { ErrorBox, Field, Modal, PageHead, toast, useHotkeys } from '../../ui';
import { useTemplates } from './Templates';

/** สร้างสมุดรายวัน — คู่มือบทที่ 15 S-GL-09 */
export function BooksPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const books = useQuery({ queryKey: ['books'], queryFn: () => api.get<Book[]>('/api/v1/gl/books') });
  const [edit, setEdit] = useState<Book | 'new' | null>(null);
  useHotkeys({ Insert: () => setEdit('new') }, []);
  return (
    <div className="page" data-tone="gl">
      <PageHead eyebrow="บัญชี › สร้างสมุดรายวัน" title="สมุดรายวัน" lead="ตัวนำเลขที่ (prefix) ใช้ขึ้นต้นเลขที่ใบสำคัญ เช่น JV520101001" actions={<button className="primary" onClick={() => setEdit('new')}>+ เพิ่มสมุด <kbd>Ins</kbd></button>} />
      <ErrorBox error={books.error} />
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th>รหัส</th><th>ตัวนำเลขที่</th><th>ชื่อสมุด</th><th>ชื่ออังกฤษ</th><th>ต้นแบบ</th><th className="r">ใบสำคัญ</th><th /></tr></thead>
          <tbody>
            {books.data?.map((b) => (
              <tr key={b.id} className="row-open" onClick={() => setEdit(b)}>
                <td className="mono">{b.code}</td><td className="mono">{b.prefix}</td><td>{b.name_th}</td><td className="muted">{b.name_en}</td><td className="mono">{b.template_code}</td><td className="r">{Number(b.journal_count).toLocaleString()}</td>
                <td><button className="linklike" onClick={(e) => { e.stopPropagation(); nav(`/gl/journals?book=${b.id}`); }}>ดูรายการ</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <BookForm book={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); qc.invalidateQueries({ queryKey: ['books'] }); }} />}
    </div>
  );
}

function BookForm({ book, onClose, onSaved }: { book: Book | null; onClose: () => void; onSaved: () => void }) {
  const templates = useTemplates();
  const [f, setF] = useState({ code: book?.code ?? '', prefix: book?.prefix ?? '', name_th: book?.name_th ?? '', name_en: book?.name_en ?? '', template_id: book?.template_id ?? '',
    approve_level: String(book?.approve_level ?? 0), approve_method: book?.approve_method ?? '', reprint_level: String(book?.reprint_level ?? 0) });
  const [err, setErr] = useState<unknown>(null);
  const body = { ...f, template_id: f.template_id || null };
  const save = () => (book ? api.put(`/api/v1/gl/books/${book.id}`, body) : api.post('/api/v1/gl/books', body)).then(() => { toast('บันทึกแล้ว'); onSaved(); }).catch(setErr);
  useHotkeys({ F9: save, 'Ctrl+S': save }, [f]);
  return (
    <Modal title={book ? `แก้ไขสมุด ${book.code}` : 'เพิ่มสมุดรายวัน'} onClose={onClose} footer={<><button onClick={onClose}>ยกเลิก</button><button className="primary" onClick={save}>บันทึก <kbd>F9</kbd></button></>}>
      <ErrorBox error={err} />
      <div className="form-grid">
        <Field label="รหัสสมุด" req><input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
        <Field label="ตัวนำเลขที่" req hint="เช่น JV PV RV"><input value={f.prefix} onChange={(e) => setF({ ...f, prefix: e.target.value.toUpperCase() })} /></Field>
        <Field label="ชื่อสมุด" req wide><input value={f.name_th} onChange={(e) => setF({ ...f, name_th: e.target.value })} /></Field>
        <Field label="ชื่ออังกฤษ" wide><input value={f.name_en} onChange={(e) => setF({ ...f, name_en: e.target.value })} /></Field>
        <Field label="ต้นแบบ" wide hint="แสดงต้นแบบนี้อัตโนมัติเมื่อเพิ่มใบสำคัญในสมุดเล่มนี้">
          <select value={f.template_id} onChange={(e) => setF({ ...f, template_id: e.target.value })}>
            <option value="">— ไม่ใช้ต้นแบบ —</option>
            {templates.data?.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
          </select>
        </Field>
        <p className="hint wide" style={{ margin: 0 }}>รายละเอียดเพิ่มเติม — การรับรองเอกสาร/พิมพ์ซ้ำ (0 = ไม่ต้องขออนุมัติ)</p>
        <Field label="รับรองเอกสาร ต้องขออนุมัติระดับ"><select value={f.approve_level} onChange={(e) => setF({ ...f, approve_level: e.target.value })}>{[...Array(10).keys()].map((n) => <option key={n} value={n}>{n === 0 ? '0 ไม่ต้องรับรอง' : n}</option>)}</select></Field>
        <Field label="วิธีการพิมพ์ หรือรับรองเอกสาร"><select value={f.approve_method} onChange={(e) => setF({ ...f, approve_method: e.target.value })}><option value="">—</option><option value="1">1 พิมพ์ก่อนรับรอง</option><option value="2">2 รับรองก่อนพิมพ์</option></select></Field>
        <Field label="พิมพ์เอกสารซ้ำ ต้องขออนุมัติระดับ"><select value={f.reprint_level} onChange={(e) => setF({ ...f, reprint_level: e.target.value })}>{[...Array(10).keys()].map((n) => <option key={n} value={n}>{n === 0 ? '0 ไม่ต้องขออนุมัติ' : n}</option>)}</select></Field>
      </div>
    </Modal>
  );
}
