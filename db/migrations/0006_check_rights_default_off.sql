-- 0006 สิทธิ์ 7 ชนิดรายเมนู (คู่มือบทที่ 23): ค่าเริ่มต้น "ไม่ตรวจสอบสิทธิ" แบบ Express — ใช้สิทธิ์พื้นฐานตามระดับอนุมัติ
-- ผู้ใช้เดิมยังไม่มีตารางสิทธิ์ (sys_permission ว่าง) ถ้าเปิดตรวจไว้จะใช้งานไม่ได้เลย จึงปิดให้ทั้งหมด แล้วผู้ดูแลเปิดเองรายคน
ALTER TABLE sys_user ALTER COLUMN check_rights SET DEFAULT false;
UPDATE sys_user SET check_rights = false WHERE check_rights AND NOT EXISTS (SELECT 1 FROM sys_permission p WHERE p.subject_type = 'U' AND p.subject_id = sys_user.id AND p.deleted_at IS NULL);
COMMENT ON COLUMN sys_user.check_rights IS 'ตรวจสอบสิทธิ์ก่อนใช้งาน: true = จำกัดเพิ่มตามตารางสิทธิ์รายเมนู (sys_permission), false = ใช้สิทธิ์พื้นฐานตามระดับอนุมัติ (คู่มือบทที่ 23)';
