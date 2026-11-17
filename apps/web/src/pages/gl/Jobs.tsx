import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { d } from '@buddy/core';
import { api } from '../../api';
import { useCan } from '../../session';
import { cx, DateInput, DateText, ErrorBox, Field, Modal, Money, MoneyInput, PageHead, Pill, Tabs, toast, useHotkeys } from '../../ui';
import { MasterBar, useRowSelect } from '../../components/MasterBar';
import { SearchPick } from '../../components/LkSelect';
import { AccountCell, useAccounts } from '../../components/AccountCell';

interface Job { id: string; code: string; name_th: string; name_en: string | null; customer_id: string | null; customer_code: string | null; customer_name: string | null; ref_no: string | null; manager: string | null;
  start_date: string | null; end_date: string | null; status: string; contract_amount: string | null; note: string | null; budget_total?: string }
interface JobOne extends Job { budgets: Array<{ account_id: string; account_no: string; account_name: string; amount: string }>; used: boolean }

/**
 * แฟ้ม Job / โครงการ (เจ้าของ 17/11/2569 · HANDOFF 129)
 * รหัส ชื่อ ลูกค้า เลขที่สัญญา ผู้รับผิดชอบ วันเริ่ม/สิ้นสุด สถานะ (กำลังทำ / ปิดแล้ว) มูลค่าสัญญา หมายเหตุ + งบประมาณรายบัญชี
 * Job ที่ปิดแล้วใช้ในเอกสารใหม่ไม่ได้ (เอกสารเดิมคงไว้) · ลบได้เฉพาะ Job ที่ยังไม่มีเอกสาร
 */
export function JobsPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const can = useCan('GL.JOB');
  const q = useQuery({ queryKey: ['projects'], queryFn: () => api.get<Job[]>('/api/v1/projects') });
  const [edit, setEdit] = useState<Job | 'new' | null>(null);
  const rs = useRowSelect(q.data);
  const reload = () => { qc.invalidateQueries({ queryKey: ['projects'] }); qc.invalidateQueries({ queryKey: ['project-options'] }); };
  const toggle = async (x: Job) => {
    const one = await api.get<JobOne>(`/api/v1/projects/${x.id}`);
    await api.put(`/api/v1/projects/${x.id}`, { ...bodyOf(one), status: x.status === 'A' ? 'I' : 'A' });
    reload();
  };
  return (
    <div className="page" data-tone="gl">
      <PageHead eyebrow="บัญชี › Job / โครงการ" title="Job / โครงการ" lead="ใส่ Job ในบรรทัดเอกสารซื้อ ขาย ค่าใช้จ่าย เบิกใช้ และสมุดรายวัน เพื่อดูต้นทุน/กำไรของแต่ละงาน (รายงาน › ต้นทุน/กำไรตาม Job) · ไม่บังคับใส่"
        actions={<button onClick={() => nav('/reports/jobs')}>📊 รายงานต้นทุน/กำไรตาม Job</button>} />
      <MasterBar rs={rs} word="Job" label={(x) => `${x.code} ${x.name_th}`} onAdd={() => setEdit('new')} onEdit={(x) => setEdit(x)} canAdd={can('add')} canEdit={can('edit')} canDelete={can('delete')}
        isActive={(x) => x.status === 'A'} onToggle={toggle}
        onDelete={(x) => api.del(`/api/v1/projects/${x.id}`).then(reload)} deleteText={(x) => `ลบ Job ${x.code}? ลบได้เฉพาะ Job ที่ยังไม่มีเอกสาร — ถ้ามีแล้วให้กด "เลิกใช้" (ปิด Job)`} />
      <ErrorBox error={q.error} />
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th style={{ width: 100 }}>รหัส</th><th>ชื่อ Job / โครงการ</th><th>ลูกค้า</th><th style={{ width: 110 }}>วันเริ่ม</th><th style={{ width: 110 }}>วันสิ้นสุด</th><th className="r" style={{ width: 130 }}>มูลค่าสัญญา</th><th className="r" style={{ width: 130 }}>งบต้นทุน</th><th style={{ width: 100 }}>สถานะ</th></tr></thead>
          <tbody>
            {q.data?.map((x, i) => (
              <tr key={x.id} className={cx('row-open', x.status === 'I' && 'void', rs.cls(i))} onClick={() => { rs.setSel(i); setEdit(x); }} onMouseEnter={rs.hover(i)}>
                <td className="mono">{x.code}</td><td>{x.name_th}{x.ref_no && <span className="muted small"> · {x.ref_no}</span>}</td><td>{x.customer_code && <span className="mono small">{x.customer_code} </span>}{x.customer_name}</td>
                <td><DateText v={x.start_date} /></td><td><DateText v={x.end_date} /></td><td className="r"><Money v={x.contract_amount} /></td><td className="r"><Money v={x.budget_total} blankZero /></td>
                <td>{x.status === 'A' ? <Pill tone="n">กำลังทำ</Pill> : <Pill tone="x">ปิดแล้ว</Pill>}</td>
              </tr>
            ))}
            {q.data && !q.data.length && <tr><td colSpan={8} className="empty">ยังไม่มี Job — กด + เพิ่ม Job (Insert) · เพิ่ม Job แรกแล้วช่อง Job จะขึ้นในเอกสารให้อัตโนมัติ</td></tr>}
          </tbody>
        </table>
      </div>
      {edit && <JobForm id={edit === 'new' ? null : edit.id} canSave={can(edit === 'new' ? 'add' : 'edit')} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

type Budget = { key: number; account_id: string | null; amount: string };
type Form = { code: string; name_th: string; name_en: string; customer: { id: string; code: string; name?: string | null } | null; ref_no: string; manager: string; start_date: string; end_date: string; status: string; contract_amount: string; note: string; budgets: Budget[] };
let seq = 0;
const bodyOf = (x: JobOne) => ({ code: x.code, name_th: x.name_th, name_en: x.name_en, customer_id: x.customer_id, ref_no: x.ref_no, manager: x.manager, start_date: x.start_date ? String(x.start_date).slice(0, 10) : null,
  end_date: x.end_date ? String(x.end_date).slice(0, 10) : null, status: x.status, contract_amount: x.contract_amount, note: x.note, budgets: x.budgets.map((b) => ({ account_id: b.account_id, amount: b.amount })) });

function JobForm({ id, canSave, onClose, onSaved }: { id: string | null; canSave: boolean; onClose: () => void; onSaved: () => void }) {
  const cur = useQuery({ enabled: !!id, queryKey: ['project', id], queryFn: () => api.get<JobOne>(`/api/v1/projects/${id}`), staleTime: 0 });
  const accts = useAccounts();
  const [f, setF] = useState<Form | null>(null);
  const [tab, setTab] = useState('info');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (!f && !id) setF({ code: '', name_th: '', name_en: '', customer: null, ref_no: '', manager: '', start_date: '', end_date: '', status: 'A', contract_amount: '', note: '', budgets: [{ key: ++seq, account_id: null, amount: '' }] });
  if (!f && id && cur.data) {
    const x = cur.data;
    setF({ code: x.code, name_th: x.name_th, name_en: x.name_en ?? '', customer: x.customer_id ? { id: x.customer_id, code: x.customer_code ?? '', name: x.customer_name } : null, ref_no: x.ref_no ?? '', manager: x.manager ?? '',
      start_date: x.start_date ? String(x.start_date).slice(0, 10) : '', end_date: x.end_date ? String(x.end_date).slice(0, 10) : '', status: x.status, contract_amount: x.contract_amount ? d(x.contract_amount).toString() : '', note: x.note ?? '',
      budgets: [...x.budgets.map((b) => ({ key: ++seq, account_id: b.account_id, amount: d(b.amount).toString() })), { key: ++seq, account_id: null, amount: '' }] });
  }
  const set = (p: Partial<Form>) => setF((x) => ({ ...x!, ...p }));
  const setB = (k: number, p: Partial<Budget>) => setF((x) => {
    const bs = x!.budgets.map((b) => (b.key === k ? { ...b, ...p } : b));
    return { ...x!, budgets: bs.at(-1)!.account_id ? [...bs, { key: ++seq, account_id: null, amount: '' }] : bs };
  });
  const total = f?.budgets.reduce((s, b) => s.plus(d(b.amount || 0)), d(0)) ?? d(0);
  const save = async () => {
    if (!f || busy || !canSave) return;
    setErr(null); setBusy(true);
    const body = { code: f.code, name_th: f.name_th, name_en: f.name_en || null, customer_id: f.customer?.id ?? null, ref_no: f.ref_no || null, manager: f.manager || null, start_date: f.start_date || null, end_date: f.end_date || null,
      status: f.status, contract_amount: f.contract_amount || null, note: f.note || null, budgets: f.budgets.filter((b) => b.account_id && b.amount).map((b) => ({ account_id: b.account_id, amount: b.amount })) };
    try {
      await (id ? api.put(`/api/v1/projects/${id}`, body) : api.post('/api/v1/projects', body));
      toast(`บันทึก Job ${f.code} แล้ว`); onSaved();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  useHotkeys({ F9: save, 'Ctrl+S': save }, [f]);
  const accName = (aid: string | null) => accts.data?.find((a) => a.id === aid)?.name_th ?? '';
  const grp = (aid: string | null) => accts.data?.find((a) => a.id === aid)?.account_group;
  return (
    <Modal size="wide" title={id ? `แก้ไข Job ${cur.data?.code ?? ''}` : 'เพิ่ม Job / โครงการ'} onClose={onClose}
      footer={<><button onClick={onClose}>ยกเลิก</button><button className="primary" disabled={busy || !canSave || !f} onClick={save}>บันทึก <kbd>F9</kbd></button></>}>
      <ErrorBox error={err ?? cur.error} />
      {f && <>
        <Tabs active={tab} onChange={setTab} tabs={[{ key: 'info', label: 'ข้อมูล Job' }, { key: 'budget', label: 'งบประมาณ', badge: f.budgets.filter((b) => b.account_id).length || undefined }]} />
        {tab === 'info' && <div className="form-grid">
          <Field label="รหัส Job" req hint="ไม่เกิน 10 ตัวอักษร เช่น J6901"><input value={f.code} maxLength={10} autoFocus={!id} onChange={(e) => set({ code: e.target.value.toUpperCase() })} /></Field>
          <Field label="สถานะ" hint="ปิดแล้ว = ใช้ในเอกสารใหม่ไม่ได้ (เอกสารเดิมคงไว้)"><select value={f.status} onChange={(e) => set({ status: e.target.value })}><option value="A">กำลังทำ</option><option value="I">ปิดแล้ว</option></select></Field>
          <Field label="ชื่อ Job / โครงการ" req wide><input value={f.name_th} maxLength={120} onChange={(e) => set({ name_th: e.target.value })} /></Field>
          <Field label="ชื่อภาษาอังกฤษ" wide><input value={f.name_en} maxLength={120} onChange={(e) => set({ name_en: e.target.value })} /></Field>
          <Field label="ลูกค้า"><SearchPick endpoint="/api/v1/customers" value={f.customer} label={(r: { name: string }) => r.name} onPick={(r: { id: string; code: string; name: string } | null) => set({ customer: r })} /></Field>
          <Field label="เลขที่สัญญา/PO ของลูกค้า"><input value={f.ref_no} maxLength={30} onChange={(e) => set({ ref_no: e.target.value })} /></Field>
          <Field label="ผู้รับผิดชอบ"><input value={f.manager} maxLength={60} onChange={(e) => set({ manager: e.target.value })} /></Field>
          <Field label="มูลค่าสัญญา (รายได้ที่คาด)"><MoneyInput value={f.contract_amount} onChange={(v) => set({ contract_amount: v })} aria-label="มูลค่าสัญญา" /></Field>
          <Field label="วันเริ่ม"><DateInput value={f.start_date} onChange={(v) => set({ start_date: v })} /></Field>
          <Field label="วันสิ้นสุด"><DateInput value={f.end_date} onChange={(v) => set({ end_date: v })} /></Field>
          <Field label="หมายเหตุ" wide><textarea rows={2} value={f.note} maxLength={2000} onChange={(e) => set({ note: e.target.value })} /></Field>
        </div>}
        {tab === 'budget' && <div className="table-wrap lines">
          <p className="hint">งบต้นทุนรายบัญชี (บัญชีหมวด 5 ค่าใช้จ่าย/ต้นทุน) — รายงานเทียบยอดจริงของ Job กับงบนี้ · ตั้งงบบัญชีหมวดอื่นได้ แต่ไม่นับในงบต้นทุนรวม</p>
          <table className="grid">
            <thead><tr><th style={{ width: 36 }}>#</th><th style={{ width: 190 }}>เลขที่บัญชี</th><th>ชื่อบัญชี</th><th className="r" style={{ width: 170 }}>งบประมาณ</th><th style={{ width: 36 }} /></tr></thead>
            <tbody>
              {f.budgets.map((b, i) => (
                <tr key={b.key}>
                  <td className="muted">{i + 1}</td>
                  <td><AccountCell value={b.account_id} onChange={(a) => setB(b.key, { account_id: a?.id ?? null })} aria-label={`เลขที่บัญชีงบ ${i + 1}`} /></td>
                  <td className="small">{accName(b.account_id)}{b.account_id && grp(b.account_id) !== '5' && <span className="muted"> (ไม่นับในงบต้นทุน)</span>}</td>
                  <td><MoneyInput value={b.amount} onChange={(v) => setB(b.key, { amount: v })} aria-label={`งบประมาณ ${i + 1}`} /></td>
                  <td>{b.account_id && <button type="button" className="icon-btn" tabIndex={-1} title="ลบบรรทัด" onClick={() => setF((x) => ({ ...x!, budgets: x!.budgets.filter((y) => y.key !== b.key) }))}>✕</button>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={3} className="r">รวมงบประมาณ</td><td className="r"><b><Money v={total.toFixed(2)} /></b></td><td /></tr></tfoot>
          </table>
        </div>}
      </>}
    </Modal>
  );
}
