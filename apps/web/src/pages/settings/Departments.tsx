import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Department } from '../../api';
import { Confirm, ErrorBox, Field, Modal, PageHead, Pill, toast, toastError, useHotkeys, cx } from '../../ui';

/** กำหนดแผนก — คู่มือบทที่ 6 S-SET-03 */
export function DepartmentsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['departments'], queryFn: () => api.get<Department[]>('/api/v1/departments') });
  const [edit, setEdit] = useState<Department | 'new' | null>(null);
  const [del, setDel] = useState<Department | null>(null);
  useHotkeys({ Insert: () => setEdit('new') }, []);
  return (
    <div className="page" data-tone="setup">
      <PageHead eyebrow="เริ่มระบบ › แผนก" title="แผนก" lead="รหัสแผนกใช้ wildcard ได้ตอนพิมพ์งบ เช่น ขาย* = ทุกแผนกที่ขึ้นต้นด้วย ขาย" actions={<button className="primary" onClick={() => setEdit('new')}>+ เพิ่มแผนก <kbd>Ins</kbd></button>} />
      <ErrorBox error={q.error} />
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th>รหัส</th><th>ชื่อย่อไทย</th><th>ชื่อย่ออังกฤษ</th><th>ชื่อเต็มไทย</th><th>ชื่อเต็มอังกฤษ</th><th>สถานะ</th><th /></tr></thead>
          <tbody>
            {q.data?.map((x) => (
              <tr key={x.id} className={cx('row-open', x.status === 'I' && 'void')} onClick={() => setEdit(x)}>
                <td className="mono">{x.code}</td><td>{x.short_name_th}</td><td>{x.short_name_en}</td><td>{x.name_th}</td><td className="muted">{x.name_en}</td>
                <td>{x.status === 'A' ? <Pill tone="n">ใช้งาน</Pill> : <Pill tone="x">เลิกใช้</Pill>}</td>
                <td><button className="icon-btn" title="ลบ" onClick={(e) => { e.stopPropagation(); setDel(x); }}>✕</button></td>
              </tr>
            ))}
            {!q.data?.length && <tr><td colSpan={7} className="empty">ยังไม่มีแผนก</td></tr>}
          </tbody>
        </table>
      </div>
      {edit && <DeptForm x={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); qc.invalidateQueries({ queryKey: ['departments'] }); }} />}
      {del && <Confirm danger title="ลบแผนก" text={`ลบแผนก ${del.code}?`} onClose={() => setDel(null)} onOk={() => api.del(`/api/v1/departments/${del.id}`).then(() => { toast('ลบแล้ว'); setDel(null); qc.invalidateQueries({ queryKey: ['departments'] }); }).catch((e) => { toastError(e); setDel(null); })} />}
    </div>
  );
}

function DeptForm({ x, onClose, onSaved }: { x: Department | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ code: x?.code ?? '', short_name_th: x?.short_name_th ?? '', short_name_en: x?.short_name_en ?? '', name_th: x?.name_th ?? '', name_en: x?.name_en ?? '', status: x?.status ?? 'A' });
  const [err, setErr] = useState<unknown>(null);
  const save = () => (x ? api.put(`/api/v1/departments/${x.id}`, f) : api.post('/api/v1/departments', f)).then(() => { toast('บันทึกแล้ว'); onSaved(); }).catch(setErr);
  useHotkeys({ F9: save, 'Ctrl+S': save }, [f]);
  return (
    <Modal title={x ? `แก้ไขแผนก ${x.code}` : 'เพิ่มแผนก'} onClose={onClose} footer={<><button onClick={onClose}>ยกเลิก</button><button className="primary" onClick={save}>บันทึก <kbd>F9</kbd></button></>}>
      <ErrorBox error={err} />
      <div className="form-grid">
        <Field label="รหัส" req><input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} readOnly={!!x} /></Field>
        <Field label="สถานะ"><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="A">ใช้งาน</option><option value="I">เลิกใช้</option></select></Field>
        <Field label="ชื่อย่อไทย"><input value={f.short_name_th} onChange={(e) => setF({ ...f, short_name_th: e.target.value })} /></Field>
        <Field label="ชื่อย่ออังกฤษ"><input value={f.short_name_en} onChange={(e) => setF({ ...f, short_name_en: e.target.value })} /></Field>
        <Field label="ชื่อเต็มไทย" req wide><input value={f.name_th} onChange={(e) => setF({ ...f, name_th: e.target.value })} /></Field>
        <Field label="ชื่อเต็มอังกฤษ" wide><input value={f.name_en} onChange={(e) => setF({ ...f, name_en: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
