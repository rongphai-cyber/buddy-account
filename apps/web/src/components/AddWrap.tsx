/**
 * ห่อช่องเลือกแผนก/พนักงานขายเดิม ให้เพิ่มรายการใหม่จากช่องได้ (Insert / ➕ — docs/18 ข้อ 12)
 * บันทึกแล้วโหลดรายการใหม่ แล้วเลือกให้ผ่าน change event ของช่องเดิม (โค้ด onChange เดิมทำงานตามปกติ)
 */
import { useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useCan } from '../session';
import { toast } from '../ui';
import { QuickAdd } from './LkSelect';

const KINDS = {
  dept: { label: 'แผนก', menu: 'SET.DEPT', query: 'departments', post: (b: { code: string; name_th: string; name_en: string }) => api.post<{ id: string }>('/api/v1/departments', { ...b, name_en: b.name_en || null }), needCode: true },
  slm: { label: 'พนักงานขาย', menu: 'SA.SLM', query: 'salespersons', post: (b: { code: string; name_th: string }) => api.post<{ id: string }>('/api/v1/salespersons', { code: b.code, name: b.name_th }), needCode: true },
} as const;

export function AddWrap({ kind, children }: { kind: keyof typeof KINDS; children: ReactNode }) {
  const k = KINDS[kind];
  const qc = useQueryClient();
  const box = useRef<HTMLSpanElement>(null);
  const can = useCan(k.menu)('add');
  const [open, setOpen] = useState(false);
  if (!can) return <>{children}</>;
  const pickNew = (id: string) => {
    // รอให้รายการใหม่ขึ้นในช่องก่อน แล้วเลือกผ่าน change event (React รับเหมือนผู้ใช้เลือกเอง)
    let tries = 0;
    const tick = () => {
      const sel = box.current?.querySelector('select');
      if (sel && [...sel.options].some((o) => o.value === id)) {
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(sel, id);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        sel.focus();
      } else if (tries++ < 40) setTimeout(tick, 50);
    };
    tick();
  };
  return (
    <span ref={box} className="lk-add" onKeyDown={(e) => { if (e.key === 'Insert' && (e.target as HTMLElement).matches('select:not([disabled])')) { e.preventDefault(); setOpen(true); } }}>
      {children}
      <button type="button" className="icon-btn" tabIndex={-1} title={`เพิ่ม${k.label}ใหม่ (Insert)`} aria-label={`เพิ่ม${k.label}ใหม่`} onClick={() => setOpen(true)}>➕</button>
      {open && <QuickAdd title={`เพิ่ม${k.label}`} codeHint="ต้องป้อนรหัส (ไม่ซ้ำ)" onClose={() => setOpen(false)} onSave={async (b) => {
        if (k.needCode && !b.code) throw new Error(`ป้อนรหัส${k.label}ก่อน`);
        const r = await k.post(b);
        await qc.invalidateQueries({ queryKey: [k.query] });
        toast(`เพิ่ม${k.label} ${b.code} ${b.name_th} แล้ว`);
        setOpen(false);
        pickNew(r.id);
      }} />}
    </span>
  );
}
