import { useQuery } from '@tanstack/react-query';
import { fmt } from '@buddy/core';
import { api } from '../api';
import { Field } from '../ui';

/** แพ็กเกจในแค็ตตาล็อก (HANDOFF 185) */
export interface Pkg {
  id: string; code: string; name_th: string; price_year: string; max_companies: number | null; max_users: number | null; docs_per_month: number | null; file_quota_mb: number | null; ai_per_month: number | null;
  over_company_year: string; over_user_year: string; over_doc: string; over_file_gb_month: string; over_ai: string; status: 'A' | 'I'; sort_order: number; remark: string | null; tenants?: number;
}
/** ค่าในฟอร์ม (ข้อความ — ว่าง = ตามแพ็กเกจ / ไม่จำกัด) */
export interface PackageValues { package_id: string; max_companies: string; max_users: string; docs_per_month: string; file_quota_mb: string; ai_per_month: string; over_action: 'W' | 'S' }
export const packageValues = (t?: Partial<Record<keyof PackageValues, unknown>> | null): PackageValues => ({
  package_id: (t?.package_id as string) ?? '', max_companies: t?.max_companies != null ? String(t.max_companies) : '', max_users: t?.max_users != null ? String(t.max_users) : '',
  docs_per_month: t?.docs_per_month != null ? String(t.docs_per_month) : '', file_quota_mb: t?.file_quota_mb != null ? String(t.file_quota_mb) : '', ai_per_month: t?.ai_per_month != null ? String(t.ai_per_month) : '',
  over_action: (t?.over_action as 'W' | 'S') ?? 'W',
});
const n = (s: string) => (s ? Number(s) : null);
/** ค่าที่ส่งไป API */
export const packageBody = (v: PackageValues) => ({ package_id: v.package_id || null, max_companies: n(v.max_companies), max_users: n(v.max_users), docs_per_month: n(v.docs_per_month), file_quota_mb: n(v.file_quota_mb), ai_per_month: n(v.ai_per_month), over_action: v.over_action });
export const usePackages = () => useQuery({ queryKey: ['packages'], queryFn: () => api.get<Pkg[]>('/api/v1/packages'), staleTime: 60_000 });
export const gbText = (mb: number | null) => (mb === null ? 'ไม่จำกัด' : mb % 1024 === 0 ? `${mb / 1024} GB` : `${mb.toLocaleString()} MB`);

/**
 * เลือกแพ็กเกจ + ขีดจำกัดของลูกค้ารายนี้ (ว่าง = ตามแพ็กเกจ · ไม่มีแพ็กเกจ = ไม่จำกัด) + เมื่อไฟล์/AI ครบ 100%
 * ใช้ทั้งหน้าแก้ไขลูกค้าและหน้าต่างอนุมัติใบสมัคร (ผู้ให้บริการ)
 */
export function PackageFields({ value: v, onChange }: { value: PackageValues; onChange: (v: PackageValues) => void }) {
  const pk = usePackages();
  const p = pk.data?.find((x) => x.id === v.package_id) ?? null;
  const ph = (x: number | null | undefined, unit = '') => (p ? (x === null || x === undefined ? 'ตามแพ็กเกจ: ไม่จำกัด' : `ตามแพ็กเกจ: ${x.toLocaleString()}${unit}`) : 'ไม่จำกัด');
  const hint = p ? 'ว่าง = ตามแพ็กเกจ · ใส่ค่า = ให้ลูกค้ารายนี้ต่างจากแพ็กเกจ' : 'ว่าง = ไม่จำกัด';
  const num = (k: keyof PackageValues) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...v, [k]: e.target.value.replace(/\D/g, '') });
  return (
    <>
      <Field label="แพ็กเกจ" wide hint={p ? `${fmt(p.price_year)} บาท/ปี (ไม่รวม VAT) · บริษัท ${p.max_companies ?? 'ไม่จำกัด'} · ผู้ใช้ ${p.max_users ?? 'ไม่จำกัด'} · เอกสาร ${p.docs_per_month?.toLocaleString() ?? 'ไม่จำกัด'}/เดือน · ไฟล์ ${gbText(p.file_quota_mb)} · AI ${p.ai_per_month?.toLocaleString() ?? 'ไม่จำกัด'}/เดือน` : 'ไม่มีแพ็กเกจ = ไม่จำกัด (ลูกค้าเดิมก่อนมีแพ็กเกจ)'}>
        <select value={v.package_id} onChange={(e) => onChange({ ...v, package_id: e.target.value })} aria-label="แพ็กเกจ">
          <option value="">— ไม่มีแพ็กเกจ (ไม่จำกัด) —</option>
          {pk.data?.filter((x) => x.status === 'A' || x.id === v.package_id).map((x) => <option key={x.id} value={x.id}>{x.name_th} ({x.code}) · {fmt(x.price_year)} บาท/ปี{x.status === 'I' ? ' · เลิกขาย' : ''}</option>)}
        </select>
      </Field>
      <Field label="จำนวนบริษัทสูงสุด" hint={hint}><input className="num" inputMode="numeric" value={v.max_companies} placeholder={ph(p?.max_companies)} onChange={num('max_companies')} /></Field>
      <Field label="จำนวนผู้ใช้สูงสุด" hint={hint}><input className="num" inputMode="numeric" value={v.max_users} placeholder={ph(p?.max_users)} onChange={num('max_users')} /></Field>
      <Field label="เอกสารต่อเดือน" hint="เกินแล้วไม่หยุด (ออกใบกำกับภาษีได้เสมอ) — คิดส่วนเกิน"><input className="num" inputMode="numeric" value={v.docs_per_month} placeholder={ph(p?.docs_per_month)} onChange={num('docs_per_month')} /></Field>
      <Field label="พื้นที่ไฟล์ (MB)" hint="1 GB = 1,024 MB"><input className="num" inputMode="numeric" value={v.file_quota_mb} placeholder={ph(p?.file_quota_mb, ' MB')} onChange={num('file_quota_mb')} /></Field>
      <Field label="อ่านบิลด้วย AI ต่อเดือน"><input className="num" inputMode="numeric" value={v.ai_per_month} placeholder={ph(p?.ai_per_month)} onChange={num('ai_per_month')} /></Field>
      <Field label="เมื่อไฟล์/AI ครบ 100%" hint="เอกสารไม่หยุดเด็ดขาด · บริษัท/ผู้ใช้ เพิ่มเกินไม่ได้เสมอ">
        <select value={v.over_action} onChange={(e) => onChange({ ...v, over_action: e.target.value as 'W' | 'S' })} aria-label="เมื่อไฟล์/AI ครบ 100%">
          <option value="W">เตือนและคิดเงินส่วนเกิน</option><option value="S">หยุด (อัปโหลดไฟล์/อ่านบิลด้วย AI ไม่ได้)</option>
        </select>
      </Field>
    </>
  );
}
