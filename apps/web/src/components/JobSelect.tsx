/**
 * ช่อง Job/โครงการ (เจ้าของ 17/11/2569 · HANDOFF 129)
 * - แสดงเฉพาะรหัส (ฟอร์มไม่ยาว — แบบเดียวกับแผนก ข้อ 128) · ชี้ดูชื่อเต็ม · ว่าง = "ไม่ระบุ" (ไม่บังคับ — เจ้าของเลือก 1ข)
 * - ตัวเลือกเฉพาะ Job ที่กำลังทำ · Job ที่ปิดแล้วแสดงเฉพาะเมื่อบรรทัดนี้ใช้อยู่เดิม (ข้อ 2ก)
 * - คอลัมน์แสดงเมื่อบริษัทเปิดใช้ Job (รายละเอียดกิจการ) หรือเอกสารมี Job อยู่แล้ว
 * - Job ที่หัวเอกสาร = ค่าเริ่มต้นของบรรทัด: เปลี่ยนหัว → บรรทัดที่ยังเป็นค่าเดิมเปลี่ยนตาม
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

export interface JobOpt { id: string; code: string; name_th: string; name_en?: string | null; status: string }

export function useJobs() {
  const q = useQuery({ queryKey: ['project-options'], queryFn: () => api.get<{ enabled: boolean; rows: JobOpt[] }>('/api/v1/projects/options'), staleTime: 60_000 });
  const rows = q.data?.rows ?? [];
  return { enabled: !!q.data?.enabled, rows, byId: new Map(rows.map((x) => [x.id, x])) };
}

/** แสดงคอลัมน์ Job: บริษัทเปิดใช้ หรือเอกสารนี้มี Job อยู่แล้ว */
export const showJob = (enabled: boolean, ...ids: Array<string | null | undefined>) => enabled || ids.some((x) => !!x);

/** เปลี่ยน Job ที่หัวเอกสาร: บรรทัดที่ยังเป็น Job เดิมของหัว (หรือว่างเมื่อหัวเดิมว่าง) เปลี่ยนตาม */
export function followHeadJob<T extends { project_id?: string | null }>(lines: T[], from: string | null | undefined, to: string | null | undefined): T[] {
  const a = from || null, b = to || null;
  return lines.map((l) => ((l.project_id || null) === a ? { ...l, project_id: b } : l));
}

export function JobSelect({ value, onChange, disabled, label = 'Job/โครงการ', invalid }: { value: string | null | undefined; onChange: (v: string | null) => void; disabled?: boolean; label?: string; invalid?: boolean }) {
  const { rows, byId } = useJobs();
  const cur = value ? byId.get(value) : undefined;
  return (
    <select className="job-select" value={value ?? ''} disabled={disabled} aria-label={label} aria-invalid={invalid || undefined}
      title={cur ? `${cur.code} ${cur.name_th}${cur.status === 'I' ? ' (ปิดแล้ว)' : ''}` : 'ไม่ระบุ Job'} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">ไม่ระบุ</option>
      {rows.filter((x) => x.status === 'A' || x.id === value).map((x) => <option key={x.id} value={x.id} title={x.name_th}>{x.code}{x.status === 'I' ? ' (ปิด)' : ''}</option>)}
    </select>
  );
}
