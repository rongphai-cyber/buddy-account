import { useQuery } from '@tanstack/react-query';
import { HOLD_RULES, holdLabel } from '@buddy/core';
import { api } from '../../api';

/** ป้ายหน้าคำอธิบายในรายการค้นหาคู่ค้า */
export const holdTag = (party: 'customer' | 'supplier', r: { on_hold?: boolean }) => (r.on_hold ? `⛔ ${holdLabel(party)} · ` : '');

/**
 * กล่องเตือนเมื่อเลือกคู่ค้าที่ถูกระงับการขาย/ระงับจ่าย (ข้อกำหนดเจ้าของ 01/11/2569)
 * แดง = เอกสารชนิดนี้บันทึกได้เฉพาะผู้มีระดับอนุมัติ · เหลือง = เตือนอย่างเดียว — server ตรวจซ้ำตอนบันทึก
 * ใช้ query เดียวกับสาขาของคู่ค้า (แคชเดียวกัน ไม่ยิงซ้ำ)
 */
export function HoldNote({ party, partyId, cls }: { party: 'customer' | 'supplier'; partyId?: string | null; cls: string }) {
  const path = party === 'customer' ? '/api/v1/customers' : '/api/v1/suppliers';
  const q = useQuery({ enabled: !!partyId, queryKey: ['party-branches', party, partyId], queryFn: () => api.get<{ tax_branches: string[]; code?: string; on_hold?: boolean; on_hold_reason?: string | null }>(`${path}/${partyId}`) });
  const rule = HOLD_RULES[party][cls];
  const p = q.data;
  if (!rule || !p?.on_hold) return null;
  const who = party === 'customer' ? 'ลูกค้า' : 'ผู้จำหน่าย';
  const head = `${who} ${p.code ?? ''} ถูก${holdLabel(party)}`;
  const why = p.on_hold_reason?.trim() ?? '';
  const what = rule === 'block' ? `บันทึกได้เฉพาะผู้มีระดับอนุมัติตามค่าเริ่มต้นระบบ — หรือยกเลิกการระงับที่แฟ้ม${who}` : 'บันทึกได้ (แจ้งเตือนเท่านั้น)';
  return (
    <div className={`notebox${rule === 'block' ? ' bad' : ''}`} role="alert" data-hold={rule}>
      ⛔ <b>{head}</b>{why && <> · เหตุผล: <span data-no-i18n>{why}</span></>} — {what}
    </div>
  );
}
