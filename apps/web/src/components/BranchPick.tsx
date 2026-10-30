import { useState } from 'react';

const label = (no: string) => (no === '00000' ? '00000 สำนักงานใหญ่' : `${no} สาขาที่ ${Number(no)}`);

/**
 * เลือกสาขาของคู่ค้า (ข้อกำหนดเจ้าของ 30/10/2569): รายการให้เลือก = สำนักงานใหญ่ + สาขาในแฟ้มคู่ค้า + สาขาที่เคยใช้ · ว่าง = สำนักงานใหญ่
 * ตัวเลือกสุดท้าย "คีย์เลขสาขาอื่น" เปลี่ยนเป็นช่องคีย์ 5 หลัก (ไม่ครบเติม 0 หน้า)
 */
export function BranchPick({ value, options, disabled, onChange }: { value: string; options?: string[] | null; disabled?: boolean; onChange: (v: string) => void }) {
  const [own, setOwn] = useState(false);
  const v = /^\d{5}$/.test(value) ? value : '00000';
  if (own) {
    return <input className="mono" value={value} maxLength={5} inputMode="numeric" autoFocus placeholder="เช่น 00001" aria-label="สาขาของคู่ค้า" title="คีย์เลขสาขา 5 หลัก — ไม่ครบเติม 0 ข้างหน้าให้ · ว่าง = สำนักงานใหญ่"
      onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
      onBlur={() => { onChange(value ? value.padStart(5, '0') : '00000'); setOwn(false); }} />;
  }
  const opts = [...new Set(['00000', ...(options ?? []), v])].filter((x) => /^\d{5}$/.test(x)).sort();
  return (
    <select className="mono" value={v} disabled={disabled} aria-label="สาขาของคู่ค้า" title="สาขาของคู่ค้า (ว่าง = สำนักงานใหญ่)"
      onChange={(e) => { if (e.target.value === '*') { onChange(''); setOwn(true); } else onChange(e.target.value); }}>
      {opts.map((o) => <option key={o} value={o}>{label(o)}</option>)}
      <option value="*">คีย์เลขสาขาอื่น…</option>
    </select>
  );
}
