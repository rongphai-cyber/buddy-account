import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { typeColorIn } from '../bookColor';
import { Tabs } from '../ui';

/**
 * ประเภทเอกสารเป็นแถบสี (แบบเดียวกับสมุดรายวัน): เลือกประเภทก่อนเพิ่ม → ฟอร์มเปิดในประเภทนั้น สีเดียวกันทั้งแถบ ปุ่มเพิ่ม และหัวฟอร์ม
 * หน้ารายการ: แถบ "ทุกประเภท" + แต่ละประเภท (เก็บใน ?type= ของ URL) · ฟอร์ม: ใบใหม่เลือกได้ ใบที่บันทึกแล้วแสดงเฉพาะประเภทของใบนั้น
 */
export type DocType = { id: string; code: string; name_th: string };

/** จำประเภทที่ผู้ใช้เลือกล่าสุดของหน้าจอนี้ (เฉพาะเครื่องนี้) */
const lastKey = () => `buddy.lastType:${window.location.pathname.replace(/\/(new|[0-9a-f-]{36})$/, '')}`;
/**
 * ประเภทที่ใช้ตอนเปิดใบใหม่ — ใบใหม่มีประเภทเสมอ เลขที่ถัดไปขึ้นทันที F9 ไม่ต้องเตือนเลือกประเภท (เจ้าของ 18/11/2569)
 * ตาม ?type= → ประเภทที่ผู้ใช้เลือกล่าสุดในหน้าจอนี้ → รหัสสั้นสุด/เรียงก่อน (ประเภทหลักแบบ Express เช่น IV ก่อน IVL ของ WTS-Living) · เปลี่ยนจากแถบได้
 */
export function initialType<T extends DocType>(types: T[]): T | undefined {
  const want = new URLSearchParams(window.location.search).get('type');
  let last: string | null = null;
  try { last = localStorage.getItem(lastKey()); } catch { /* ไม่มีที่เก็บ = ใช้ลำดับปกติ */ }
  return types.find((t) => t.id === want) ?? types.find((t) => t.id === last) ?? [...types].sort((a, b) => a.code.length - b.code.length || a.code.localeCompare(b.code))[0];
}

export function DocTypeTabs({ types, value, onChange, locked, all }: { types: DocType[] | undefined; value: string; onChange: (id: string) => void; locked?: boolean; all?: boolean }) {
  if (!types?.length || (all && types.length < 2)) return null;
  // เอกสารที่บันทึกแล้วเปลี่ยนประเภทไม่ได้ — ป้ายประเภทในแถวหัวเรื่องบอกอยู่แล้ว ไม่ต้องมีแถบซ้ำอีกแถว (เจ้าของ 18/11/2569)
  if (locked) return null;
  return <Tabs active={value} onChange={(k) => { if (!all && k) { try { localStorage.setItem(lastKey(), k); } catch { /* ไม่จำก็ได้ */ } } onChange(k); }}
    tabs={[...(all ? [{ key: '', label: 'ทุกประเภท' }] : []), ...types.map((t) => ({ key: t.id, label: `${t.code} ${t.name_th}`, color: typeColorIn(types, t.id) }))]} />;
}

/** แจ้งให้เลือกประเภทก่อน (ใบใหม่ที่ยังไม่เลือก) — ป้ายเล็กข้างแถบประเภท ไม่กินแถว (เจ้าของ 18/11/2569 รอบ 3) · เลือกแล้วหายไป */
export function TypeNotice({ show }: { show: boolean }) {
  return show ? <span className="type-notice" role="note" title="เลขที่เอกสาร การลงบัญชี และค่าเริ่มต้นเป็นไปตามประเภทที่เลือก">ⓘ เลือกประเภทเอกสารก่อน</span> : null;
}
export const NO_TYPE_MSG = 'เลือกประเภทเอกสาร (แถบด้านบน) ก่อนบันทึก';

/** หน้ารายการ: แถบประเภท + ตัวกรอง + ที่อยู่สำหรับเพิ่มใบใหม่ในประเภทที่เลือก */
export function useTypeTabs(cls: string) {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('type') ?? '';
  const types = useQuery({ queryKey: ['trade-defaults', cls], queryFn: () => api.get<{ types: DocType[] }>(`/api/v1/trade-defaults/${cls}`) });
  const cur = types.data?.types.find((t) => t.id === tab);
  return {
    tab, cur, color: typeColorIn(types.data?.types, tab),
    setTab: (k: string) => setSp((p) => { const n = new URLSearchParams(p); if (k) n.set('type', k); else n.delete('type'); return n; }, { replace: true }),
    newUrl: (base: string) => (tab ? `${base}?type=${tab}` : base),
    tabs: (onChange?: (k: string) => void) => <DocTypeTabs all types={types.data?.types} value={tab} onChange={(k) => { setSp((p) => { const n = new URLSearchParams(p); if (k) n.set('type', k); else n.delete('type'); return n; }, { replace: true }); onChange?.(k); }} />,
  };
}
