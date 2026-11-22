import { useNavigate } from 'react-router-dom';
import { useCan } from '../session';
import { docImportPathOf, importPathOf } from '@buddy/core';
import { confirmLeave } from '../unsaved';

/**
 * ปุ่ม "นำเข้า Excel" บนแถบเครื่องมือของหน้าเอกสาร (เจ้าของ 20/11/2569 · HANDOFF 167 — เหมือนปุ่มบนสมุดรายวัน)
 * เปิดหน้านำเข้าโดยเลือกชนิดเอกสารนี้ไว้ · แสดงเมื่อมีสิทธิ์ นำเข้ารายการขาย/ซื้อ (OT.IMPTRADE) และสิทธิ์เพิ่มที่เมนูของเอกสารนี้
 */
export function ImportExcelButton({ cls, menu, label }: { cls: string; menu: string; label: string }) {
  const nav = useNavigate();
  const canImp = useCan('OT.IMPTRADE'), canDoc = useCan(menu);
  // ขาย/ซื้อ/ค่าใช้จ่ายอื่น (นำเข้ารายการขาย/ซื้อ) · เอกสารอื่นที่ลงบัญชี: รับ/จ่ายชำระ ธนาคาร คลัง เงินสดย่อย (HANDOFF 171 — หน้าเดียวกัน)
  const path = importPathOf(cls) ?? docImportPathOf(cls);
  if (!path || !canImp('add') || !canDoc('add')) return null;
  return (
    <button type="button" title={`นำเข้า${label}หลายฉบับจากแฟ้ม Excel (.xlsx / .csv)`}
      onClick={() => { void confirmLeave().then((ok) => { if (ok) nav(`/tools/trade-import?kind=${path}`); }); }}>⬆ นำเข้า Excel</button>
  );
}
