import { useNavigate } from 'react-router-dom';
import { useCan } from '../session';
import { docImportPathOf, importPathOf, masterImportKindOf } from '@buddy/core';
import { confirmLeave } from '../unsaved';

/**
 * ปุ่ม "นำเข้า Excel" บนแถบเครื่องมือของหน้าเอกสาร (เจ้าของ 20/11/2569 · HANDOFF 167 — เหมือนปุ่มบนสมุดรายวัน)
 * เปิดหน้านำเข้าโดยเลือกชนิดเอกสารนี้ไว้ · แสดงเมื่อมีสิทธิ์ นำเข้ารายการขาย/ซื้อ (OT.IMPTRADE) และสิทธิ์เพิ่มที่เมนูของเอกสารนี้
 */
/** master = แฟ้มข้อมูลหลัก (customers suppliers items services fa-assets — HANDOFF 173): เพิ่มใหม่ + แก้เมื่อติ๊ก */
export function ImportExcelButton({ cls, menu, label, master }: { cls?: string; menu: string; label: string; master?: string }) {
  const nav = useNavigate();
  const canImp = useCan('OT.IMPTRADE'), canDoc = useCan(menu);
  // ขาย/ซื้อ/ค่าใช้จ่ายอื่น (นำเข้ารายการขาย/ซื้อ) · เอกสารอื่นที่ลงบัญชี: รับ/จ่ายชำระ ธนาคาร คลัง เงินสดย่อย (HANDOFF 171 — หน้าเดียวกัน)
  const path = master ? masterImportKindOf(master)?.path ?? null : importPathOf(cls ?? '') ?? docImportPathOf(cls ?? '');
  if (!path || !canImp('add') || !canDoc('add')) return null;
  return (
    <button type="button" title={master ? `นำเข้า${label}จากแฟ้ม Excel — เพิ่มรหัสใหม่ และแก้รหัสเดิมเมื่อติ๊ก` : `นำเข้า${label}หลายฉบับจากแฟ้ม Excel (.xlsx / .csv)`}
      onClick={() => { void confirmLeave().then((ok) => { if (ok) nav(`/tools/trade-import?kind=${path}`); }); }}>⬆ นำเข้า Excel</button>
  );
}
