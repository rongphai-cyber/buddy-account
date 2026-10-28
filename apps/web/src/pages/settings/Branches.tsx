import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatTaxBranch } from '@buddy/core';
import { api } from '../../api';
import { useSession } from '../../session';
import { ErrorBox, Field, Modal, PageHead, Pill, toast, useHotkeys } from '../../ui';

interface Branch { id: string; code: string; name: string; tax_branch_no: string; address: string | null; is_head_office: boolean; status: string }

/** สาขา — เพิ่มเหนือ Express (Express มีแค่ "สาขา#" ของกิจการ) */
export function BranchesPage() {
  const qc = useQueryClient();
  const { refresh } = useSession();
  const q = useQuery({ queryKey: ['branches'], queryFn: () => api.get<Branch[]>('/api/v1/branches') });
  const [edit, setEdit] = useState<Branch | 'new' | null>(null);
  useHotkeys({ Insert: () => setEdit('new') }, []);
  return (
    <div className="page" data-tone="setup">
      <PageHead eyebrow="เริ่มระบบ › สาขา" title="สาขา" lead="แต่ละสาขามีเลขที่สาขาตามกรมสรรพากร ใช้พิมพ์บนใบกำกับภาษีและแยกรายงานภาษี" actions={<button className="primary" onClick={() => setEdit('new')}>+ เพิ่มสาขา <kbd>Ins</kbd></button>} />
      <ErrorBox error={q.error} />
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th>รหัส</th><th>ชื่อสาขา</th><th>เลขที่สาขา (กรมสรรพากร)</th><th>ที่อยู่</th><th>สถานะ</th></tr></thead>
          <tbody>{q.data?.map((b) => <tr key={b.id} className="row-open" onClick={() => setEdit(b)}><td className="mono">{b.code}</td><td>{b.name} {b.is_head_office && <Pill tone="n">สำนักงานใหญ่</Pill>}</td><td className="mono">{b.tax_branch_no} · {formatTaxBranch(b.tax_branch_no)}</td><td className="small">{b.address}</td><td>{b.status === 'A' ? 'ใช้งาน' : 'เลิกใช้'}</td></tr>)}</tbody>
        </table>
      </div>
      {edit && <BranchForm b={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); qc.invalidateQueries({ queryKey: ['branches'] }); refresh(); }} />}
    </div>
  );
}

function BranchForm({ b, onClose, onSaved }: { b: Branch | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ code: b?.code ?? '', name: b?.name ?? '', tax_branch_no: b?.tax_branch_no ?? '', address: b?.address ?? '', status: b?.status ?? 'A' });
  const [err, setErr] = useState<unknown>(null);
  const save = () => (b ? api.put(`/api/v1/branches/${b.id}`, f) : api.post('/api/v1/branches', f)).then(() => { toast('บันทึกแล้ว'); onSaved(); }).catch(setErr);
  useHotkeys({ F9: save, 'Ctrl+S': save }, [f]);
  return (
    <Modal title={b ? `แก้ไขสาขา ${b.code}` : 'เพิ่มสาขา'} onClose={onClose} footer={<><button onClick={onClose}>ยกเลิก</button><button className="primary" onClick={save}>บันทึก <kbd>F9</kbd></button></>}>
      <ErrorBox error={err} />
      <div className="form-grid">
        <Field label="รหัสสาขา" req><input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
        <Field label="เลขที่สาขา 5 หลัก" req hint="00000 = สำนักงานใหญ่"><input className="mono" maxLength={5} value={f.tax_branch_no} onChange={(e) => setF({ ...f, tax_branch_no: e.target.value.replace(/\D/g, '') })} /></Field>
        <Field label="ชื่อสาขา" req wide><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="ที่อยู่ (พิมพ์บนใบกำกับภาษี)" wide><textarea rows={2} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        <Field label="สถานะ"><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="A">ใช้งาน</option><option value="I">เลิกใช้</option></select></Field>
      </div>
    </Modal>
  );
}
