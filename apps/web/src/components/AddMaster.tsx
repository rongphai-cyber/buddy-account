import { CustomerForm, SupplierForm } from '../pages/parties/Parties';
import { ItemForm } from '../pages/items/Items';
import type { ItemKind } from '@buddy/core';

/**
 * เพิ่มข้อมูลหลักจากช่องค้นหา (ข้อกำหนดเจ้าของ: ค้นหาแล้วไม่มี ให้ Popup เพิ่มรายการนั้น — link มาจากข้อมูลหลัก)
 * ใช้ฟอร์มเดียวกับหน้าลูกค้า/ผู้จำหน่าย/สินค้า · สิ่งที่พิมพ์ไว้: ดูเหมือนรหัส = ใส่ช่องรหัส ไม่ใช่ = ใส่ช่องชื่อ
 * โหลดแบบ lazy จาก LkSelect (กันการ import วนกัน)
 */
export type AddKind = 'customer' | 'supplier' | ItemKind;
export default function AddMaster({ kind, text, onClose, onSaved }: { kind: AddKind; text: string; onClose: () => void; onSaved: (code: string) => void }) {
  const t = text.trim();
  const looksCode = /^[A-Za-z0-9._\/-]{1,20}$/.test(t);
  const done = (s?: { id: string; code: string }) => (s ? onSaved(s.code) : onClose());
  if (kind === 'customer') return <CustomerForm id={null} onClose={onClose} onSaved={done} initial={looksCode ? { code: t.toUpperCase() } : { name: t }} />;
  if (kind === 'supplier') return <SupplierForm id={null} onClose={onClose} onSaved={done} initial={looksCode ? { code: t.toUpperCase() } : { name: t }} />;
  return <ItemForm kind={kind} id={null} onClose={onClose} onSaved={done} initial={looksCode ? { code: t.toUpperCase() } : { name_th: t }} />;
}
