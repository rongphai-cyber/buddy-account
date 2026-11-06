-- เงินมัดจำยกมาย้ายสิทธิ์จากเมนู FI.AR.OB (ลูกหนี้คงค้าง-ยกมา) ไปเมนูของตัวเอง FI.AR.DOB (HANDOFF ข้อ 91)
-- ข้อมูลอย่างเดียว ไม่เปลี่ยนโครงสร้าง: ทุกบริษัท ทุกกลุ่ม/ผู้ใช้ที่มีแถวสิทธิ์ FI.AR.OB → แถว FI.AR.DOB ค่าเดียวกันทุกช่อง (รวมค่า N)
-- ผลสิทธิ์ของเงินมัดจำยกมาจึงเท่าก่อนอัปเกรดทุกประการ (ไม่มีแถว OB = ไม่สร้าง ใช้ค่าของกลุ่มเมนูแม่ตามเดิม) · รันซ้ำได้ (ไม่สร้างซ้ำ ไม่ทับแถว DOB ที่มีแล้ว)
-- แถวเมนูสร้างที่นี่ถ้ายังไม่มี (ตอนเปิด server syncMenus จัดชื่อ/ลำดับ/เมนูแม่ให้ตาม packages/core/src/menu.ts)
INSERT INTO sys_menu (code, name_th, sort_order)
SELECT 'FI.AR.DOB', 'บันทึกเงินมัดจำยกมา', 0
 WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE code = 'FI.AR.DOB' AND deleted_at IS NULL);

INSERT INTO sys_permission (company_id, subject_type, subject_id, menu_id, can_read, can_add, can_edit, can_cancel, can_delete, can_print, can_approve, created_by)
SELECT p.company_id, p.subject_type, p.subject_id, d.id, p.can_read, p.can_add, p.can_edit, p.can_cancel, p.can_delete, p.can_print, p.can_approve, p.created_by
  FROM sys_permission p
  JOIN sys_menu o ON o.id = p.menu_id AND o.code = 'FI.AR.OB' AND o.deleted_at IS NULL
  JOIN sys_menu d ON d.code = 'FI.AR.DOB' AND d.deleted_at IS NULL
 WHERE p.deleted_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM sys_permission q WHERE q.company_id = p.company_id AND q.subject_type = p.subject_type AND q.subject_id = p.subject_id
                      AND q.menu_id = d.id AND q.deleted_at IS NULL);
