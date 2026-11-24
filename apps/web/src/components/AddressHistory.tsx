import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { todayIso } from '@buddy/core';
import { api } from '../api';
import { useCan } from '../session';
import { Confirm, DateInput, DateText, ErrorBox, Field, Modal, Pill, toast, useHotkeys } from '../ui';
import { AddressFields } from './AddressFields';

export interface AddrHistRow {
  id: string; branch_id: string | null; effective_from: string; effective_to: string | null;
  address_th_1: string; address_th_2: string; address_en_1: string; address_en_2: string; zip_code: string | null; remark: string | null;
  in_effect: boolean; future: boolean; [k: string]: unknown;
}
type Resp = { branch_id: string | null; today: string; rows: AddrHistRow[] };

/** ประวัติที่อยู่ของบริษัท (branchId ว่าง) หรือของสาขา — ใช้ร่วมหน้ารายละเอียดกิจการและหน้าสาขา */
export function useAddressHistory(branchId?: string | null) {
  return useQuery({ queryKey: ['company-addresses', branchId ?? 'hq'], queryFn: () => api.get<Resp>('/api/v1/company/addresses', branchId ? { branch_id: branchId } : {}) });
}

/**
 * ประวัติที่อยู่ (HANDOFF 180 · เจ้าของ 24/11/2569 "ปี 2567 ใช้ที่ 303 … ปี 2568 เป็น 340 … เอกสารแต่ละช่วงเวลาจะต้องออกให้ถูกต้อง")
 * เอกสารพิมพ์ที่อยู่ที่มีผล ณ วันที่เอกสาร · ย้ายที่อยู่ = เพิ่มที่อยู่ใหม่พร้อมวันที่มีผล · แก้ที่อยู่ที่ช่องด้านบน = แก้รายการที่ใช้อยู่วันนี้
 */
export function AddressHistory({ branchId, onChanged }: { branchId?: string | null; onChanged?: () => void }) {
  const qc = useQueryClient();
  const can = useCan(branchId ? 'SET.BRANCH' : 'SET.CO');
  const q = useAddressHistory(branchId);
  const [edit, setEdit] = useState<AddrHistRow | 'new' | null>(null);
  const done = () => {
    setEdit(null);
    qc.invalidateQueries({ queryKey: ['company-addresses'] }); qc.invalidateQueries({ queryKey: ['company'] }); qc.invalidateQueries({ queryKey: ['branches'] });
    onChanged?.();
  };
  const cur = q.data?.rows.find((r) => r.in_effect);
  return (
    <section className="card addr-hist" aria-label="ประวัติที่อยู่">
      <div className="row"><h3 style={{ margin: 0 }}>ประวัติที่อยู่</h3>
        <button type="button" className="primary" disabled={!can('edit')} onClick={() => setEdit('new')}>+ เพิ่มที่อยู่ใหม่ (ย้ายที่อยู่)</button></div>
      <p className="hint">เอกสารพิมพ์ที่อยู่ที่มีผล ณ วันที่ของเอกสาร{branchId ? ' (สาขาที่ไม่มีที่อยู่ของตัวเองใช้ที่อยู่สำนักงานใหญ่)' : ''} · ย้ายที่อยู่ ให้กด "เพิ่มที่อยู่ใหม่" แล้วใส่วันที่มีผล — เอกสารก่อนวันนั้นยังพิมพ์ที่อยู่เดิม
        {cur && <> · แก้ที่อยู่ที่ช่องด้านบน = แก้รายการที่ใช้อยู่ (มีผลตั้งแต่ <b><DateText v={cur.effective_from} /></b>)</>}</p>
      <ErrorBox error={q.error} />
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th style={{ width: 120 }}>มีผลตั้งแต่</th><th style={{ width: 120 }}>ถึง</th><th>ที่อยู่ที่พิมพ์ในเอกสาร</th><th style={{ width: 160 }}>หมายเหตุ</th><th style={{ width: 90 }}>สถานะ</th></tr></thead>
          <tbody>
            {q.data?.rows.map((r) => (
              <tr key={r.id} className="row-open" onClick={() => can('edit') && setEdit(r)}>
                <td><DateText v={r.effective_from} /></td><td>{r.effective_to ? <DateText v={r.effective_to} /> : r.future ? '' : <span className="muted">ปัจจุบัน</span>}</td>
                <td><div data-no-i18n>{r.address_th_1}</div>{r.address_th_2 && <div data-no-i18n>{r.address_th_2}</div>}{(r.address_en_1 || r.address_en_2) && <div className="muted small" data-no-i18n>{[r.address_en_1, r.address_en_2].filter(Boolean).join(' ')}</div>}</td>
                <td className="small" data-no-i18n>{r.remark}</td>
                <td>{r.in_effect ? <Pill tone="m">ใช้อยู่</Pill> : r.future ? <Pill tone="d">ล่วงหน้า</Pill> : <Pill tone="x">เดิม</Pill>}</td>
              </tr>
            ))}
            {q.data && !q.data.rows.length && <tr><td colSpan={5} className="empty">ยังไม่มีประวัติ — ที่อยู่ที่บันทึกด้านบนจะเป็นรายการแรก{branchId ? ' (สาขาที่ไม่มีที่อยู่ใช้ที่อยู่สำนักงานใหญ่)' : ''}</td></tr>}
          </tbody>
        </table>
      </div>
      {edit && <AddressDialog row={edit === 'new' ? null : edit} branchId={branchId ?? null} canDelete={can('edit') && (q.data?.rows.length ?? 0) > (branchId ? 0 : 1)} onClose={() => setEdit(null)} onDone={done} />}
    </section>
  );
}

function AddressDialog({ row, branchId, canDelete, onClose, onDone }: { row: AddrHistRow | null; branchId: string | null; canDelete: boolean; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState<Record<string, unknown>>(() => row ? { ...row } : { effective_from: todayIso(), address_th_1: '', address_th_2: '', address_en_1: '', address_en_2: '', zip_code: '', remark: '' });
  const [err, setErr] = useState<unknown>(null);
  const [askDel, setAskDel] = useState(false);
  const v = (k: string) => String(f[k] ?? '');
  const save = async () => {
    setErr(null);
    try {
      const body = { ...f, branch_id: branchId };
      if (row) await api.put(`/api/v1/company/addresses/${row.id}`, body); else await api.post('/api/v1/company/addresses', body);
      toast(row ? 'แก้ไขที่อยู่แล้ว' : 'เพิ่มที่อยู่ใหม่แล้ว — เอกสารตั้งแต่วันที่มีผลจะพิมพ์ที่อยู่นี้');
      onDone();
    } catch (e) { setErr(e); }
  };
  const del = () => api.del(`/api/v1/company/addresses/${row!.id}`).then(() => { toast('ลบที่อยู่แล้ว'); onDone(); }).catch((e) => { setAskDel(false); setErr(e); });
  useHotkeys({ F9: save, 'Ctrl+S': save }, [f]);
  return (
    <Modal title={row ? 'แก้ไขที่อยู่ในประวัติ' : 'เพิ่มที่อยู่ใหม่ (ย้ายที่อยู่)'} onClose={onClose}
      footer={<>{row && canDelete && <button className="danger" onClick={() => setAskDel(true)}>ลบ</button>}<button onClick={onClose}>ยกเลิก</button><button className="primary" onClick={save}>บันทึก <kbd>F9</kbd></button></>}>
      <ErrorBox error={err} />
      <div className="form-grid">
        <Field label="มีผลตั้งแต่วันที่" req hint="เอกสารที่ลงวันที่ตั้งแต่วันนี้เป็นต้นไปพิมพ์ที่อยู่นี้ (จนถึงที่อยู่ถัดไป)"><DateInput value={v('effective_from')} onChange={(d) => setF({ ...f, effective_from: d })} autoFocus /></Field>
        <Field label="หมายเหตุ" hint="เช่น ย้ายสำนักงาน"><input value={v('remark')} maxLength={200} onChange={(e) => setF({ ...f, remark: e.target.value })} /></Field>
        <AddressFields value={f} onChange={(p) => setF((x) => ({ ...x, ...p }))} target={branchId ? { kind: 'text', key: 'address_th_1' } : { kind: 'company' }} title={branchId ? 'ที่อยู่สาขา (พิมพ์บนใบกำกับภาษี)' : 'ที่อยู่กิจการ'} />
      </div>
      {askDel && <Confirm title="ลบที่อยู่ในประวัติ" danger text={`ลบที่อยู่ที่มีผลตั้งแต่ ${v('effective_from')}? เอกสารช่วงนั้นจะพิมพ์ที่อยู่ของรายการก่อนหน้าแทน`} onClose={() => setAskDel(false)} onOk={del} />}
    </Modal>
  );
}
