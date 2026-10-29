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

/** ประเภทที่ใช้ตอนเปิดใบใหม่: ตาม ?type= · มีประเภทเดียวใช้ประเภทนั้น · หลายประเภทให้ผู้ใช้เลือก (ไม่ตั้งให้เอง) */
export function initialType<T extends DocType>(types: T[]): T | undefined {
  const want = new URLSearchParams(window.location.search).get('type');
  return types.find((t) => t.id === want) ?? (types.length === 1 ? types[0] : undefined);
}

export function DocTypeTabs({ types, value, onChange, locked, all }: { types: DocType[] | undefined; value: string; onChange: (id: string) => void; locked?: boolean; all?: boolean }) {
  if (!types?.length || (all && types.length < 2)) return null;
  const shown = locked ? types.filter((t) => t.id === value) : types;
  return <Tabs active={value} onChange={(k) => { if (!locked) onChange(k); }}
    tabs={[...(all ? [{ key: '', label: 'ทุกประเภท' }] : []), ...shown.map((t) => ({ key: t.id, label: `${t.code} ${t.name_th}`, color: typeColorIn(types, t.id) }))]} />;
}

/** แจ้งให้เลือกประเภทก่อน (ใบใหม่ที่ยังไม่เลือก) */
export function TypeNotice({ show }: { show: boolean }) {
  return show ? <p className="notebox">เลือกประเภทเอกสารจากแถบด้านบนก่อน — เลขที่เอกสาร การลงบัญชี และค่าเริ่มต้นเป็นไปตามประเภทที่เลือก</p> : null;
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
