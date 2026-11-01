import { useEffect, useState } from 'react';
import { useSession } from '../session';
import { Pill } from '../ui';

/**
 * สาขาที่บันทึกเอกสาร/ลงบัญชี (ข้อกำหนดเจ้าของ 01/11/2569 — คีย์เอกสารทุกครั้งต้องเห็นว่าทำงานกับสาขาไหน รายงานแยกสำนักงานใหญ่/สาขาได้)
 * ใบใหม่ = สาขาที่เลือกที่แถบบน หรือสำนักงานใหญ่ถ้าเลือก "ทุกสาขา" · เอกสารเดิม = สาขาของเอกสาร · บันทึกใบถัดไปคงสาขาเดิม
 */
export function useDocBranch(id: string | null | undefined, saved: unknown) {
  const { me } = useSession();
  const def = me?.branch?.id ?? me?.branches.find((b) => b.is_head_office)?.id ?? me?.branches[0]?.id ?? '';
  const [value, set] = useState('');
  useEffect(() => { set(id ? (typeof saved === 'string' ? saved : '') : def); }, [id, saved, def]);
  return { value, set, body: value || null };
}

export function DocBranch({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const { me } = useSession();
  const bs = me?.branches ?? [];
  const b = bs.find((x) => x.id === value);
  const label = (x: { code: string; name: string; is_head_office: boolean }) => `${x.code} ${x.name}${x.is_head_office && !/ใหญ่/.test(x.name) ? ' (สำนักงานใหญ่)' : ''}`;
  if (bs.length <= 1 || disabled) return <span className="doc-branch" title="สาขาที่บันทึกเอกสาร/ลงบัญชี"><Pill tone="n">🏢 {b ? label(b) : value ? '—' : 'สำนักงานใหญ่'}</Pill></span>;
  return (
    <label className="doc-branch" title="สาขาที่บันทึกเอกสาร/ลงบัญชี — รายงานบัญชี/ภาษีแยกตามสาขานี้">
      🏢 <select value={value} aria-label="สาขาที่บันทึก" onChange={(e) => onChange(e.target.value)}>
        {bs.map((x) => <option key={x.id} value={x.id}>{label(x)}</option>)}
      </select>
    </label>
  );
}
