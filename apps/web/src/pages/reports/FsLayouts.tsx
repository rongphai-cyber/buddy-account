import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { cx, ErrorBox, Field, KeyHints, Modal, PageHead, toast, useHotkeys } from '../../ui';

interface Layout { id: string; code: string; name: string; line_set_code: string; line_count: number; columns: Array<{ expr: string; head1?: string; head2?: string }>; header_lines: string[] }
interface Line { line_no: number; data_type: string; source: string | null; sign_filter: string | null; print_condition: string | null; accumulate: Record<string, string> | null; description_th: string | null; description_en: string | null }
const VARS = ['A', 'B', 'C', 'D', 'E'] as const;
const DT = ['A/C', 'BEG', 'INV', 'VAR', 'TXT', '---', '==='];

/** สร้างงบการเงิน — คู่มือบทที่ 24 S-FS-01 (หัวรายงาน/คอลัมน์) S-FS-02 (คัดลอก) S-FS-03 (Item Report) */
export function FsLayoutsPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const list = useQuery({ queryKey: ['fs-layouts'], queryFn: () => api.get<Layout[]>('/api/v1/fs/layouts') });
  const [edit, setEdit] = useState<string | 'new' | null>(null);
  const [copy, setCopy] = useState<Layout | null>(null);
  return (
    <div className="page" data-tone="gl">
      <PageHead eyebrow="บัญชี › สร้างงบการเงิน" title="แบบงบการเงิน" lead="แบบงบใช้ภาษาเดียวกับ Express: A/C ยอดบัญชี · BEG ยอดต้นงวด · INV สินค้าปลายงวด · VAR ตัวแปร A–E · TXT ข้อความ · --- === เส้น"
        actions={<button className="primary" onClick={() => setEdit('new')}>+ สร้างแบบงบ</button>} />
      <ErrorBox error={list.error} />
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th>รหัส</th><th>ชื่องบ</th><th>ชุดบรรทัด</th><th>คอลัมน์</th><th className="r">บรรทัด</th><th /></tr></thead>
          <tbody>
            {list.data?.map((l) => (
              <tr key={l.id} className="row-open" onClick={() => setEdit(l.id)}>
                <td className="mono">{l.code}</td><td>{l.name}</td><td className="mono">{l.line_set_code}</td><td className="mono small">{l.columns?.map((c) => c.expr).join(' | ')}</td><td className="r">{l.line_count}</td>
                <td className="actions"><button className="linklike" onClick={(e) => { e.stopPropagation(); nav(`/fs/statements?layout=${l.id}`); }}>พิมพ์งบ</button> <button className="linklike" onClick={(e) => { e.stopPropagation(); setCopy(l); }}>คัดลอก</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <LayoutEditor id={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); qc.invalidateQueries({ queryKey: ['fs-layouts'] }); }} />}
      {copy && <CopyDialog src={copy} onClose={() => setCopy(null)} onDone={() => { setCopy(null); qc.invalidateQueries({ queryKey: ['fs-layouts'] }); }} />}
    </div>
  );
}

function CopyDialog({ src, onClose, onDone }: { src: Layout; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ code: '', name: `${src.name} (สำเนา)`, copy_lines: true });
  const [err, setErr] = useState<unknown>(null);
  return (
    <Modal title={`คัดลอกงบ ${src.code}`} size="confirm" onClose={onClose} footer={<><button onClick={onClose}>ยกเลิก</button><button className="primary" onClick={() => api.post(`/api/v1/fs/layouts/${src.id}/copy`, f).then(() => { toast('คัดลอกแล้ว'); onDone(); }).catch(setErr)}>คัดลอก</button></>}>
      <ErrorBox error={err} />
      <Field label="รหัสงบใหม่" req><input autoFocus value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
      <Field label="ชื่องบใหม่" req><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <label className="inline chk"><input type="checkbox" checked={f.copy_lines} onChange={(e) => setF({ ...f, copy_lines: e.target.checked })} /> คัดลอกบรรทัดเป็นชุดใหม่ (ไม่ติ๊ก = ใช้ชุดบรรทัดร่วมกับงบเดิม)</label>
    </Modal>
  );
}

function LayoutEditor({ id, onClose, onSaved }: { id: string | null; onClose: () => void; onSaved: () => void }) {
  const q = useQuery({ enabled: !!id, queryKey: ['fs-layout', id], queryFn: () => api.get<Layout & { lines: Line[]; shared_with: Array<{ code: string }> }>(`/api/v1/fs/layouts/${id}`) });
  const [h, setH] = useState({ code: '', name: '', line_set_code: '', header_lines: ['\\NAME', '', 'สิ้นสุด ณ วันที่ \\END_PRD', ''], columns: [{ expr: 'BAL', head1: '', head2: '' }] as Array<{ expr: string; head1?: string; head2?: string }> });
  const [lines, setLines] = useState<Line[]>([]);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => {
    if (!q.data) return;
    const hl = [...(q.data.header_lines ?? [])]; while (hl.length < 4) hl.push('');
    setH({ code: q.data.code, name: q.data.name, line_set_code: q.data.line_set_code ?? q.data.code, header_lines: hl, columns: q.data.columns ?? [] });
    setLines(q.data.lines.map((l) => ({ ...l, accumulate: l.accumulate ?? {} })));
  }, [q.data]);
  const setL = (i: number, p: Partial<Line>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...p } : l)));
  const addAfter = (i: number) => setLines((ls) => { const base = ls[i]?.line_no ?? 0; const next = ls[i + 1]?.line_no ?? base + 20; const no = Math.floor((base + next) / 2) === base ? base + 1 : Math.floor((base + next) / 2); const n = [...ls]; n.splice(i + 1, 0, { line_no: no, data_type: 'A/C', source: '', sign_filter: '', print_condition: 'Z', accumulate: {}, description_th: '', description_en: '' }); return n; });
  const save = () => api[id ? 'put' : 'post'](id ? `/api/v1/fs/layouts/${id}` : '/api/v1/fs/layouts', { ...h, line_set_code: h.line_set_code || h.code, lines: lines.map((l) => ({ ...l, source: l.source || null, sign_filter: l.sign_filter || '', print_condition: l.print_condition || '' })) })
    .then(() => { toast('บันทึกแบบงบแล้ว'); onSaved(); }).catch(setErr);
  useHotkeys({ F9: save, 'Ctrl+S': save }, [h, lines]);
  return (
    <Modal size="wide" title={id ? `แก้ไขแบบงบ ${h.code}` : 'สร้างแบบงบการเงิน'} onClose={onClose} footer={<><button onClick={onClose}>ยกเลิก</button><button className="primary" onClick={save}>บันทึก <kbd>F9</kbd></button></>}>
      <ErrorBox error={err} />
      {q.data?.shared_with?.length ? <p className="notebox">ชุดบรรทัด {h.line_set_code} ใช้ร่วมกับงบ {q.data.shared_with.map((s) => s.code).join(', ')} — แก้บรรทัดแล้วงบเหล่านั้นเปลี่ยนด้วย</p> : null}
      <div className="form-grid three">
        <Field label="รหัสงบ" req><input value={h.code} onChange={(e) => setH({ ...h, code: e.target.value })} /></Field>
        <Field label="ชื่องบ" req><input value={h.name} onChange={(e) => setH({ ...h, name: e.target.value })} /></Field>
        <Field label="ชุดบรรทัด" hint="ว่าง = ใช้รหัสงบ"><input value={h.line_set_code} onChange={(e) => setH({ ...h, line_set_code: e.target.value })} /></Field>
        {h.header_lines.map((x, i) => <Field key={i} label={`หัวรายงานบรรทัด ${i + 1}`} hint={i === 0 ? '\\NAME = ชื่อบริษัท · \\END_PRD = วันสิ้นงวด' : undefined}><input value={x} onChange={(e) => setH({ ...h, header_lines: h.header_lines.map((y, k) => (k === i ? e.target.value : y)) })} /></Field>)}
      </div>
      <h3>คอลัมน์ (สูงสุด 18)</h3>
      <div className="cols-edit">
        {h.columns.map((c, i) => (
          <span key={i} className="col-chip">
            <input value={c.expr} title="BAL / PTD / BAL LY / PTD LY หรือสูตร เช่น (C1-C2)*100/C2" onChange={(e) => setH({ ...h, columns: h.columns.map((x, k) => (k === i ? { ...x, expr: e.target.value } : x)) })} />
            <input value={c.head1 ?? ''} placeholder="หัวคอลัมน์" onChange={(e) => setH({ ...h, columns: h.columns.map((x, k) => (k === i ? { ...x, head1: e.target.value } : x)) })} />
            <button className="icon-btn" onClick={() => setH({ ...h, columns: h.columns.filter((_, k) => k !== i) })}>✕</button>
          </span>
        ))}
        {h.columns.length < 18 && <button onClick={() => setH({ ...h, columns: [...h.columns, { expr: 'BAL', head1: '' }] })}>+ คอลัมน์</button>}
      </div>
      <h3>บรรทัด (Item Report)</h3>
      <div className="table-wrap lines fs-lines">
        <table className="grid">
          <thead><tr><th>บรรทัด</th><th>ชนิด</th><th>บัญชี/ตัวแปร</th><th>กรอง</th><th>พิมพ์</th>{VARS.map((v) => <th key={v} className="c">{v}</th>)}<th>คำอธิบาย</th><th>คำอธิบายอังกฤษ</th><th /></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className={cx(l.print_condition === 'N' && 'muted')}>
                <td><input className="num" style={{ width: 64 }} value={l.line_no} onChange={(e) => setL(i, { line_no: Number(e.target.value) || 0 })} /></td>
                <td><select value={l.data_type} onChange={(e) => setL(i, { data_type: e.target.value })}>{DT.map((x) => <option key={x}>{x}</option>)}</select></td>
                <td><input className="mono" style={{ width: 96 }} value={l.source ?? ''} onChange={(e) => setL(i, { source: e.target.value })} /></td>
                <td><select value={l.sign_filter ?? ''} onChange={(e) => setL(i, { sign_filter: e.target.value })}><option value="">—</option><option value="+">+</option><option value="-">−</option></select></td>
                <td><select value={l.print_condition ?? ''} onChange={(e) => setL(i, { print_condition: e.target.value })} title="Z = ไม่พิมพ์ถ้าศูนย์ · N = ไม่พิมพ์ · C = กึ่งกลาง"><option value="">พิมพ์</option><option value="Z">Z</option><option value="N">N</option><option value="C">C</option></select></td>
                {VARS.map((v) => <td key={v}><select className="var" value={l.accumulate?.[v] ?? ''} onChange={(e) => setL(i, { accumulate: { ...l.accumulate, [v]: e.target.value } })}><option value="" /> <option value="+">+</option><option value="-">−</option><option value="0">0</option><option value="/">/</option></select></td>)}
                <td><input value={l.description_th ?? ''} onChange={(e) => setL(i, { description_th: e.target.value })} /></td>
                <td><input value={l.description_en ?? ''} onChange={(e) => setL(i, { description_en: e.target.value })} /></td>
                <td className="nowrap"><button className="icon-btn" title="แทรกบรรทัดถัดไป" onClick={() => addAfter(i)}>＋</button><button className="icon-btn" title="ลบ" onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))}>✕</button></td>
              </tr>
            ))}
            {!lines.length && <tr><td colSpan={13} className="empty"><button onClick={() => addAfter(-1)}>+ เพิ่มบรรทัดแรก</button></td></tr>}
          </tbody>
        </table>
      </div>
      <KeyHints keys={[['F9', 'บันทึก'], ['Esc', 'ปิด']]} />
    </Modal>
  );
}
