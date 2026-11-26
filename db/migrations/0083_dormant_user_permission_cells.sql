-- 0083 แก้ข้อมูลครั้งเดียว (HANDOFF 198 ข้อ 2 · ตรวจทาน 197): แถวสิทธิ์รายผู้ใช้ที่ "หลับ" อยู่ก่อน 197
-- ก่อน 197: หน้าสิทธิ์รายเมนูบันทึกช่องที่ไม่ได้ติ๊กเป็น 'N' ทุกช่อง และผู้ใช้ที่ไม่ได้ตั้ง "ตรวจสอบสิทธิ์" (check_rights = false)
--   โปรแกรมไม่อ่านแถวเหล่านี้เลย (ใช้ตามระดับอนุมัติ) → 'N' ในแถวเก่าไม่ได้แปลว่า "ห้าม" แค่ "ไม่ได้ติ๊ก"
-- ตั้งแต่ 197: ช่องที่มีค่าในแถวของผู้ใช้มีผลเสมอ → 'N' เก่าจะกลายเป็น "ห้าม" เช่น แถว "ทุกระบบงาน" ที่ติ๊กแค่อ่าน = เพิ่ม/แก้ไขไม่ได้ทุกเมนู
-- แก้: แถวของผู้ใช้ที่ check_rights = false ซึ่งเขียนก่อน 0082 (ทุกช่องมีค่า · updated_at ไม่เกินเวลาที่รัน 0082)
--   ช่อง 'N' (และ 'S' พิมพ์ออกจอ ที่เดิมก็ไม่มีผล) → ว่าง = ตามกลุ่ม/เมนูหลัก/ระดับอนุมัติ · ช่อง 'Y'/'L' คงไว้ (ก่อน 197 ระดับอนุมัติตรวจก่อนเสมอ
--   ช่อง Y จึงให้ไม่เกินระดับ → ผู้ใช้ไม่มีกลุ่ม ได้ผลเท่าก่อน 197 ทุกช่อง) · แถวที่ว่างทุกช่อง = ตั้ง deleted_at
-- แถวที่เขียนหลัง 0082 (หน้าสิทธิ์ใหม่บันทึกเฉพาะช่องที่ตั้งเอง) และผู้ใช้ที่ตั้งซ่อนเมนู/ตรวจสอบสิทธิ์ (แถวเคยมีผลจริง) ไม่แตะ
-- ไม่มี 0082 ในฐาน (ไม่ควรเกิด) = ไม่แตะอะไร
WITH m AS (SELECT applied_at FROM sys_schema_migration WHERE name = '0082_permission_cell_inherit.sql'),
target AS (
  SELECT p.id FROM sys_permission p
    JOIN sys_user u ON u.id = p.subject_id AND u.deleted_at IS NULL AND NOT u.check_rights
   WHERE p.subject_type = 'U' AND p.deleted_at IS NULL
     AND p.updated_at <= (SELECT applied_at FROM m)
     AND p.can_read IS NOT NULL AND p.can_add IS NOT NULL AND p.can_edit IS NOT NULL AND p.can_cancel IS NOT NULL
     AND p.can_delete IS NOT NULL AND p.can_print IS NOT NULL AND p.can_approve IS NOT NULL
     AND ('N' IN (p.can_read, p.can_add, p.can_edit, p.can_cancel, p.can_delete, p.can_print, p.can_approve) OR p.can_print = 'S')
)
UPDATE sys_permission p SET
  can_read = CASE WHEN p.can_read IN ('N', 'S') THEN NULL ELSE p.can_read END,
  can_add = CASE WHEN p.can_add IN ('N', 'S') THEN NULL ELSE p.can_add END,
  can_edit = CASE WHEN p.can_edit IN ('N', 'S') THEN NULL ELSE p.can_edit END,
  can_cancel = CASE WHEN p.can_cancel IN ('N', 'S') THEN NULL ELSE p.can_cancel END,
  can_delete = CASE WHEN p.can_delete IN ('N', 'S') THEN NULL ELSE p.can_delete END,
  can_print = CASE WHEN p.can_print IN ('N', 'S') THEN NULL ELSE p.can_print END,
  can_approve = CASE WHEN p.can_approve IN ('N', 'S') THEN NULL ELSE p.can_approve END,
  updated_at = now(), row_version = p.row_version + 1
FROM target WHERE p.id = target.id;

UPDATE sys_permission SET deleted_at = now(), updated_at = now(), row_version = row_version + 1
 WHERE subject_type = 'U' AND deleted_at IS NULL
   AND can_read IS NULL AND can_add IS NULL AND can_edit IS NULL AND can_cancel IS NULL AND can_delete IS NULL AND can_print IS NULL AND can_approve IS NULL;
