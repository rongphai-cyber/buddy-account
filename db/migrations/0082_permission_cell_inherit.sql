-- 0082 สิทธิ์รายเมนูแบบรายช่อง (HANDOFF 197 · เจ้าของ 26/11/2569 "เมื่อกำหนดกลุ่มแล้วเบื้องต้นใช้สิทธิรายเมนูตามที่กำหนดในกลุ่ม แต่สามารถปรับเองเพิ่มเติมตามตารางสิทธิเพิ่มได้อีก")
-- ช่องว่าง (NULL) = ไม่ได้ตั้งที่เมนูนี้ → ใช้ค่าจากเมนูหลัก/ทุกระบบงานของผู้ใช้ แล้วจากกลุ่มของผู้ใช้
-- ไม่แก้ข้อมูลเดิม: แถวเดิมทุกแถวมีค่าครบ 7 ช่อง (ช่องที่ไม่ได้เลือกเก็บเป็น N) → สิทธิ์ที่ได้จริงเท่าเดิมทุกช่อง
ALTER TABLE sys_permission ALTER COLUMN can_read DROP NOT NULL, ALTER COLUMN can_read DROP DEFAULT,
  ALTER COLUMN can_add DROP NOT NULL, ALTER COLUMN can_add DROP DEFAULT,
  ALTER COLUMN can_edit DROP NOT NULL, ALTER COLUMN can_edit DROP DEFAULT,
  ALTER COLUMN can_cancel DROP NOT NULL, ALTER COLUMN can_cancel DROP DEFAULT,
  ALTER COLUMN can_delete DROP NOT NULL, ALTER COLUMN can_delete DROP DEFAULT,
  ALTER COLUMN can_print DROP NOT NULL, ALTER COLUMN can_print DROP DEFAULT,
  ALTER COLUMN can_approve DROP NOT NULL, ALTER COLUMN can_approve DROP DEFAULT;
COMMENT ON TABLE sys_permission IS 'สิทธิ์ 7 ชนิดต่อ ผู้ใช้/กลุ่ม × บริษัท × เมนู — รายช่อง: ช่องว่างได้ค่าจากเมนูหลัก แล้วจากกลุ่มของผู้ใช้ (HANDOFF 197) | Express: SCACCLV (บทที่ 23)';
COMMENT ON COLUMN sys_permission.can_read IS 'อ่าน Y/L/N/S · ว่าง = ตามเมนูหลัก/กลุ่ม (HANDOFF 197)';
COMMENT ON COLUMN sys_permission.can_add IS 'เพิ่ม · ว่าง = ตามเมนูหลัก/กลุ่ม';
COMMENT ON COLUMN sys_permission.can_edit IS 'แก้ไข · ว่าง = ตามเมนูหลัก/กลุ่ม';
COMMENT ON COLUMN sys_permission.can_cancel IS 'ยกเลิกเอกสาร · ว่าง = ตามเมนูหลัก/กลุ่ม';
COMMENT ON COLUMN sys_permission.can_delete IS 'ลบ · ว่าง = ตามเมนูหลัก/กลุ่ม';
COMMENT ON COLUMN sys_permission.can_print IS 'พิมพ์ · ว่าง = ตามเมนูหลัก/กลุ่ม';
COMMENT ON COLUMN sys_permission.can_approve IS 'อนุมัติ · ว่าง = ตามเมนูหลัก/กลุ่ม';
