import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { STARTER_TEMPLATES } from '@buddy/core';
import { api } from '../api';
import { useCan } from '../session';
import { ErrorBox, Field, Modal, toast } from '../ui';

/** ตัวอย่างสูงสุด 6 รายการ + จำนวนที่เหลือ */
const examples = (add: string[]) => add.slice(0, 6).join(' · ') + (add.length <= 6 ? '' : ' · … อีก ' + String(add.length - 6));
type Preview = { template: string; added: number; tables: Array<{ key: string; label: string; add: string[]; skip: number }> };

/** ประเภทธุรกิจสำหรับข้อมูลตั้งต้น (กำหนดบริษัทใหม่ · สมัครใช้งาน · อนุมัติใบสมัคร) — HANDOFF 160 */
export function StarterSelect({ value, onChange, blank = true, disabled }: { value: string; onChange: (v: string) => void; blank?: boolean; disabled?: boolean }) {
  return (
    <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {STARTER_TEMPLATES.filter((t) => blank || t.key !== 'BLANK').map((t) => <option key={t.key} value={t.key}>{t.th}</option>)}
    </select>
  );
}
export const starterHint = (key: string) => STARTER_TEMPLATES.find((t) => t.key === key)?.hint ?? '';

/**
 * บริษัทที่มีอยู่แล้ว: "เติมข้อมูลตั้งต้นตามประเภทธุรกิจ…" (HANDOFF 160) — เลือกประเภท ดูรายการที่จะเพิ่ม แล้วยืนยัน
 * เพิ่มเฉพาะรหัสที่ยังไม่มี ไม่แก้สิ่งที่ตั้งเองไว้ · ทุกรายการแก้/ลบเองได้ภายหลัง (ลบได้เมื่อยังไม่ถูกใช้)
 */
export function StarterFillButton() {
  const can = useCan('SET.CO')('edit');
  const [open, setOpen] = useState(false);
  if (!can) return null;
  return <>
    <button onClick={() => setOpen(true)}>เติมข้อมูลตั้งต้นตามประเภทธุรกิจ…</button>
    {open && <StarterFillDialog onClose={() => setOpen(false)} />}
  </>;
}

function StarterFillDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [t, setT] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['starter-preview', t], queryFn: () => api.get<{ last: string | null; preview: Preview }>('/api/v1/company/starter-data', t ? { template: t } : undefined) });
  const cur = t ?? q.data?.preview.template ?? 'TRADE';
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const p = q.data?.preview;
  const go = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.post<Preview>('/api/v1/company/starter-data', { template: cur });
      toast(`เติมข้อมูลตั้งต้นแล้ว ${r.added} รายการ — แก้ไขหรือลบได้ที่เมนู เริ่มระบบ`);
      await qc.invalidateQueries();
      onClose();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <Modal title="เติมข้อมูลตั้งต้นตามประเภทธุรกิจ" size="wide" onClose={onClose} footer={<>
      <button onClick={onClose}>ยกเลิก</button>
      <button className="primary" disabled={busy || !p?.added} onClick={go}>{busy ? 'กำลังเติม…' : p?.added ? `เติมข้อมูล ${p.added} รายการ` : 'มีครบแล้ว'}</button>
    </>}>
      <ErrorBox error={err ?? q.error} />
      <div className="form-grid">
        <Field label="ประเภทธุรกิจ" hint={starterHint(cur)}><StarterSelect value={cur} blank={false} onChange={setT} /></Field>
      </div>
      <p className="small muted">เพิ่มเฉพาะรหัสที่ยังไม่มี — สิ่งที่ตั้งเองไว้แล้วไม่ถูกแก้ · ทุกรายการแก้ไขได้ และลบได้ถ้ายังไม่ถูกใช้ในเอกสาร{q.data?.last ? ` · เติมครั้งล่าสุด: ${STARTER_TEMPLATES.find((x) => x.key === q.data!.last)?.th ?? q.data.last}` : ''}</p>
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th style={{ width: 190 }}>ตาราง</th><th style={{ width: 80 }} className="r">เพิ่ม</th><th style={{ width: 90 }} className="r">มีแล้ว (ข้าม)</th><th>ตัวอย่างที่จะเพิ่ม</th></tr></thead>
          <tbody>
            {p?.tables.map((x) => (
              <tr key={x.key}><td>{x.label}</td><td className="r">{x.add.length}</td><td className="r muted">{x.skip}</td>
                <td className="small" data-no-i18n>{examples(x.add)}</td></tr>
            ))}
            {q.isLoading && <tr><td colSpan={4} className="empty">กำลังตรวจ…</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="small muted">วิธีรับ/จ่ายแบบเงินโอนและเช็คจ่าย ต้องผูกกับบัญชีเงินฝากของกิจการ — เพิ่มบัญชีเงินฝากที่ ธนาคาร › รายละเอียดบัญชีเงินฝาก แล้วตั้งที่ วิธีรับ/จ่ายชำระหนี้</p>
    </Modal>
  );
}
