import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatTaxBranch } from '@buddy/core';
import { api } from '../../api';
import { useSession } from '../../session';
import { useNavigate } from 'react-router-dom';
import { cx, DateText, ErrorBox, Field, Modal, navKey, PageHead, Pill, toast, useHotkeys } from '../../ui';
import { AddressFields } from '../../components/AddressFields';
import { AddressHistory } from '../../components/AddressHistory';
import { MasterBar, useRowSelect } from '../../components/MasterBar';


/** company_address = สำนักงานใหญ่: ที่อยู่ของกิจการที่มีผลวันนี้ (HANDOFF 194) */
interface Branch { id: string; code: string; name: string; tax_branch_no: string; address: string | null; is_head_office: boolean; status: string; company_address?: string; company_address_from?: string | null; [k: string]: unknown }
type AddrAt = { address_th_1: string; address_th_2: string; address_en_1: string; address_en_2: string; zip_code: string | null; effective_from: string | null };

/** ที่อยู่ในรายการ: สำนักงานใหญ่ = จากรายละเอียดกิจการ · สาขาที่ไม่มีที่อยู่ = ใช้ที่อยู่สำนักงานใหญ่ */
function BranchAddress({ b }: { b: Branch }) {
  if (b.is_head_office) return <>{b.company_address ? <span data-no-i18n>{b.company_address}</span> : <span className="muted">ยังไม่มีที่อยู่ — ป้อนที่ เริ่มระบบ › รายละเอียดกิจการ</span>} <span className="muted">(จากรายละเอียดกิจการ)</span></>;
  return b.address ? <span data-no-i18n>{b.address}</span> : <span className="muted">(ใช้ที่อยู่สำนักงานใหญ่)</span>;
}

/** สาขา — เพิ่มเหนือ Express (Express มีแค่ "สาขา#" ของกิจการ) */
export function BranchesPage() {
  const qc = useQueryClient();
  const { refresh } = useSession();
  const q = useQuery({ queryKey: ['branches'], queryFn: () => api.get<Branch[]>('/api/v1/branches') });
  const [edit, setEdit] = useState<Branch | 'new' | null>(null);
  const rs = useRowSelect(q.data);
  return (
    <div className="page" data-tone="setup">
      <PageHead eyebrow="เริ่มระบบ › สาขา" title="สาขา" lead="แต่ละสาขามีเลขที่สาขาตามกรมสรรพากร ใช้พิมพ์บนใบกำกับภาษีและแยกรายงานภาษี" />
      <MasterBar rs={rs} word="สาขา" label={(b) => `${b.code} ${b.name}`} onAdd={() => setEdit('new')} onEdit={(b) => setEdit(b)}
        isActive={(b) => b.status === 'A'} onToggle={(b) => (b.is_head_office ? Promise.reject(new Error('สำนักงานใหญ่เลิกใช้ไม่ได้')) : api.put(`/api/v1/branches/${b.id}`, { ...b, status: b.status === 'A' ? 'I' : 'A' }).then(() => { qc.invalidateQueries({ queryKey: ['branches'] }); refresh(); }))} />
      <ErrorBox error={q.error} />
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th>รหัส</th><th>ชื่อสาขา</th><th>เลขที่สาขา (กรมสรรพากร)</th><th>ที่อยู่</th><th>สถานะ</th></tr></thead>
          <tbody>{q.data?.map((b, i) => <tr key={b.id} className={cx('row-open', b.status === 'I' && 'void', rs.cls(i))} onClick={() => { rs.setSel(i); setEdit(b); }} onMouseEnter={rs.hover(i)}><td className="mono">{b.code}</td><td>{b.name} {b.is_head_office && <Pill tone="n">สำนักงานใหญ่</Pill>}</td><td className="mono">{b.tax_branch_no} · {formatTaxBranch(b.tax_branch_no)}</td><td className="small"><BranchAddress b={b} /></td><td>{b.status === 'A' ? 'ใช้งาน' : 'เลิกใช้'}</td></tr>)}</tbody>
        </table>
      </div>
      {edit && <BranchForm b={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); qc.invalidateQueries({ queryKey: ['branches'] }); refresh(); }} />}
    </div>
  );
}

function BranchForm({ b, onClose, onSaved }: { b: Branch | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Record<string, unknown>>({ ...Object.fromEntries(Object.entries(b ?? {}).map(([k, v]) => [k, v ?? ''])), code: b?.code ?? '', name: b?.name ?? '', tax_branch_no: b?.tax_branch_no ?? '', address: b?.address ?? '', status: b?.status ?? 'A' });
  const v = (k: string) => String(f[k] ?? '');
  const [err, setErr] = useState<unknown>(null);
  const ho = !!b?.is_head_office;
  // สำนักงานใหญ่: ส่งเฉพาะรหัส ชื่อ เลขที่สาขา สถานะ — ที่อยู่แก้ที่รายละเอียดกิจการ (HANDOFF 194)
  const body = () => (ho ? { code: f.code, name: f.name, tax_branch_no: f.tax_branch_no, status: f.status } : f);
  const save = () => (b ? api.put(`/api/v1/branches/${b.id}`, body()) : api.post('/api/v1/branches', f)).then(() => { toast('บันทึกแล้ว'); onSaved(); }).catch(setErr);
  useHotkeys({ F9: save, 'Ctrl+S': save }, [f]);
  return (
    <Modal title={b ? `แก้ไขสาขา ${b.code}` : 'เพิ่มสาขา'} onClose={onClose} footer={<><button onClick={onClose}>ยกเลิก</button><button className="primary" onClick={save}>บันทึก <kbd>F9</kbd></button></>}>
      <ErrorBox error={err} />
      <div className="form-grid" onKeyDown={(e) => navKey(e, save)}>
        <Field label="รหัสสาขา" req><input value={v('code')} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
        <Field label="เลขที่สาขา 5 หลัก" req hint="00000 = สำนักงานใหญ่"><input className="mono" maxLength={5} value={v('tax_branch_no')} onChange={(e) => setF({ ...f, tax_branch_no: e.target.value.replace(/\D/g, '') })} /></Field>
        <Field label="ชื่อสาขา" req wide><input value={v('name')} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        {ho ? <HeadOfficeAddress /> : <>
          <p className="hint branch-addr-help">ที่อยู่นี้พิมพ์บนใบกำกับภาษีที่ออกในนามสาขานี้ · ย้ายที่อยู่สาขา = กด เพิ่มที่อยู่ใหม่ ด้านล่าง</p>
          <AddressFields value={f} onChange={(p) => setF((x) => ({ ...x, ...p }))} target={{ kind: 'text', key: 'address' }} title="ที่อยู่สาขา (พิมพ์บนใบกำกับภาษี)" />
        </>}
        <Field label="สถานะ" hint={ho ? 'สำนักงานใหญ่เลิกใช้ไม่ได้' : undefined}><select value={v('status')} disabled={ho} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="A">ใช้งาน</option><option value="I">เลิกใช้</option></select></Field>
      </div>
      {/* ประวัติที่อยู่ของสาขา (HANDOFF 180) — สาขาสำนักงานใหญ่ใช้ประวัติที่อยู่ที่หน้ารายละเอียดกิจการ */}
      {b && !ho && <AddressHistory branchId={b.id} />}
    </Modal>
  );
}

/**
 * ที่อยู่สำนักงานใหญ่ (อ่านอย่างเดียว · HANDOFF 194 · เจ้าของ 26/11/2569) = ที่อยู่ของกิจการที่มีผลวันนี้ใน เริ่มระบบ › รายละเอียดกิจการ
 * เอกสารที่ออกในนามสำนักงานใหญ่พิมพ์ที่อยู่ ณ วันที่เอกสารจากประวัติที่อยู่ของกิจการ — ไม่ต้องกรอกซ้ำที่หน้าสาขา
 */
function HeadOfficeAddress() {
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['company-address-at', 'today'], queryFn: () => api.get<AddrAt>('/api/v1/company/address-at') });
  const a = q.data;
  const th = a ? [a.address_th_1, a.address_th_2].filter((x) => x && x.trim()) : [];
  const en = a ? [a.address_en_1, a.address_en_2].filter((x) => x && x.trim()).join(' ') : '';
  return (
    <section className="addr-box ho-addr" aria-label="ที่อยู่สำนักงานใหญ่">
      <div className="addr-title">ที่อยู่สำนักงานใหญ่ (พิมพ์บนใบกำกับภาษี)</div>
      <ErrorBox error={q.error} />
      {a && (th.length
        ? <div className="ho-addr-text">{th.map((l, i) => <div key={i} data-no-i18n>{l}</div>)}{a.zip_code && !th.join(' ').includes(a.zip_code) && <div data-no-i18n>{a.zip_code}</div>}{en && <div className="muted small" data-no-i18n>{en}</div>}</div>
        : <p className="notebox">ยังไม่มีที่อยู่ของกิจการ — ป้อนที่ เริ่มระบบ › รายละเอียดกิจการ</p>)}
      {a?.effective_from && <p className="hint">มีผลตั้งแต่ <b><DateText v={a.effective_from} /></b></p>}
      <p className="hint">ดึงจาก เริ่มระบบ › รายละเอียดกิจการ (ที่อยู่ที่มีผลวันนี้) — ไม่ต้องกรอกซ้ำที่นี่ · เอกสารพิมพ์ที่อยู่ที่มีผล ณ วันที่ของเอกสาร</p>
      <div><button type="button" className="primary" onClick={() => nav('/settings/company')}>แก้ที่อยู่ / ย้ายที่อยู่สำนักงานใหญ่ ที่ เริ่มระบบ › รายละเอียดกิจการ</button></div>
    </section>
  );
}
