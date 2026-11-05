/**
 * ช่องเหตุผลการยกเลิก/ลบเอกสาร — ปุ่มเลือกเร็วจากตารางข้อมูล 75 + พิมพ์รายละเอียดต่อได้ (docs/18 ข้อ 12)
 * กด Insert ในช่อง = เพิ่มเหตุผลใหม่ลงตาราง (สิทธิ์เพิ่มของตารางข้อมูล)
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useCan } from '../session';
import { toast } from '../ui';
import { QuickAdd, useLookups } from './LkSelect';

export function ReasonInput({ value, onChange, onEnter, autoFocus = true }: { value: string; onChange: (v: string) => void; onEnter?: () => void; autoFocus?: boolean }) {
  const lk = useLookups('75');
  const qc = useQueryClient();
  const canAdd = useCan('SET.TBL')('add');
  const [adding, setAdding] = useState(false);
  const pick = (name: string) => onChange(value.trim() && !value.startsWith(name) ? `${name} — ${value.trim()}` : name);
  return (
    <>
      <input autoFocus={autoFocus} value={value} maxLength={200} onChange={(e) => onChange(e.target.value)}
        title={canAdd ? 'กด Insert = เพิ่มเหตุผลใหม่ลงรายการ' : undefined}
        onKeyDown={(e) => {
          if (e.key === 'Insert' && canAdd) { e.preventDefault(); setAdding(true); }
          if (e.key === 'Enter' && onEnter) { e.preventDefault(); e.stopPropagation(); onEnter(); }
        }} />
      {!!lk.data?.['75']?.length && <span className="reason-chips">
        {lk.data['75'].map((r) => <button key={r.code} type="button" className="chip" tabIndex={-1} onClick={() => pick(r.name)}>{r.name}</button>)}
      </span>}
      {adding && <QuickAdd title="เพิ่มเหตุผลการยกเลิก/ลบเอกสาร" initialName={value.trim()} onClose={() => setAdding(false)} onSave={async (b) => {
        const r = await api.post<{ code: string; name: string }>('/api/v1/data-tables/75/rows', b);
        await qc.invalidateQueries({ queryKey: ['lookups'] });
        toast(`เพิ่มเหตุผล "${r.name}" แล้ว`);
        onChange(r.name); setAdding(false);
      }} />}
    </>
  );
}
