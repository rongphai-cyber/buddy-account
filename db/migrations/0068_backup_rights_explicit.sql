-- สำรองข้อมูลทั้งบริษัท / นำข้อมูลสำรองกลับ (เมนู OT.BACKUP เพิ่ม/แก้ไข): ตั้งแต่ HANDOFF 146 ผู้ใช้ระดับ 5–8 ที่ไม่ใช่ผู้ดูแลระบบต้องได้รับสิทธิ์ที่เมนูนี้โดยตรง
-- ข้อมูลอย่างเดียว ไม่เปลี่ยนโครงสร้าง — คงสิทธิ์ของผู้ใช้เดิมทุกคนตามที่ใช้ได้ก่อนอัปเกรด (ผู้ใช้ใหม่หลังจากนี้ = ผู้ดูแลระบบให้สิทธิ์เองที่หน้ากำหนดสิทธิ์):
-- 1) ไม่ได้ "ตรวจสอบสิทธิ์ก่อนใช้งาน" (เดิมใช้ได้ตามระดับ): สร้างแถวผู้ใช้ที่เมนู OT.BACKUP อ่าน/เพิ่ม/แก้ไข/พิมพ์ = Y (มีแถวอยู่แล้ว = ตั้งเพิ่ม/แก้ไขเป็น Y)
-- 2) ตรวจสอบสิทธิ์ก่อนใช้งาน: เดิมได้ค่าตามลำดับ ผู้ใช้(เมนูนี้ › อื่น ๆ › ทุกระบบ) แล้วกลุ่ม — ถ้าเพิ่มหรือแก้ไขเป็น Y/L และยังไม่มีแถวผู้ใช้ที่เมนูนี้ สร้างแถวผู้ใช้ค่าเดียวกันทุกช่อง (ผลทุกการทำงานเท่าเดิม)
-- ผู้ดูแลระบบ (กลุ่ม ADMIN) และระดับ 9 ไม่เปลี่ยน · รันซ้ำได้ (ไม่สร้างซ้ำ)
UPDATE sys_permission p SET can_add = 'Y', can_edit = 'Y'
  FROM sys_user x LEFT JOIN sys_user_group g ON g.id = x.user_group_id
 WHERE p.subject_type = 'U' AND p.subject_id = x.id AND p.deleted_at IS NULL
   AND p.menu_id IN (SELECT id FROM sys_menu WHERE code = 'OT.BACKUP' AND deleted_at IS NULL)
   AND x.deleted_at IS NULL AND NOT x.check_rights AND x.approval_level BETWEEN 5 AND 8 AND coalesce(g.code, '') <> 'ADMIN'
   AND (p.can_add NOT IN ('Y', 'L') OR p.can_edit NOT IN ('Y', 'L'));
INSERT INTO sys_permission (company_id, subject_type, subject_id, menu_id, can_read, can_add, can_edit, can_cancel, can_delete, can_print, can_approve)
SELECT r.company_id, 'U', r.user_id, r.menu_id,
       CASE WHEN r.check_rights THEN coalesce(nullif(r.can_read, ''), 'N') ELSE 'Y' END,
       CASE WHEN r.check_rights THEN coalesce(nullif(r.can_add, ''), 'N') ELSE 'Y' END,
       CASE WHEN r.check_rights THEN coalesce(nullif(r.can_edit, ''), 'N') ELSE 'Y' END,
       CASE WHEN r.check_rights THEN coalesce(nullif(r.can_cancel, ''), 'N') ELSE 'N' END,
       CASE WHEN r.check_rights THEN coalesce(nullif(r.can_delete, ''), 'N') ELSE 'N' END,
       CASE WHEN r.check_rights THEN coalesce(nullif(r.can_print, ''), 'N') ELSE 'Y' END,
       CASE WHEN r.check_rights THEN coalesce(nullif(r.can_approve, ''), 'N') ELSE 'N' END
  FROM (
    SELECT uc.company_id, x.id AS user_id, x.check_rights, bk.id AS menu_id, s.can_read, s.can_add, s.can_edit, s.can_cancel, s.can_delete, s.can_print, s.can_approve
      FROM sys_user x
      JOIN sys_user_company uc ON uc.user_id = x.id AND uc.deleted_at IS NULL
      JOIN sys_company c ON c.id = uc.company_id AND c.deleted_at IS NULL AND c.tenant_id = x.tenant_id
      JOIN sys_menu bk ON bk.code = 'OT.BACKUP' AND bk.deleted_at IS NULL
      LEFT JOIN sys_user_group g ON g.id = x.user_group_id
      LEFT JOIN LATERAL (
        SELECT p.can_read, p.can_add, p.can_edit, p.can_cancel, p.can_delete, p.can_print, p.can_approve
          FROM sys_permission p JOIN sys_menu m ON m.id = p.menu_id AND m.deleted_at IS NULL AND m.code IN ('OT.BACKUP', 'OT', 'ALL')
         WHERE p.company_id = uc.company_id AND p.deleted_at IS NULL
           AND ((p.subject_type = 'U' AND p.subject_id = x.id) OR (p.subject_type = 'G' AND p.subject_id = x.user_group_id))
         ORDER BY CASE p.subject_type WHEN 'U' THEN 0 ELSE 1 END, CASE m.code WHEN 'OT.BACKUP' THEN 0 WHEN 'OT' THEN 1 ELSE 2 END
         LIMIT 1) s ON true
     WHERE x.deleted_at IS NULL AND x.approval_level BETWEEN 5 AND 8 AND coalesce(g.code, '') <> 'ADMIN'
       AND NOT EXISTS (SELECT 1 FROM sys_permission q WHERE q.company_id = uc.company_id AND q.subject_type = 'U' AND q.subject_id = x.id AND q.menu_id = bk.id AND q.deleted_at IS NULL)
  ) r
 WHERE NOT r.check_rights OR r.can_add IN ('Y', 'L') OR r.can_edit IN ('Y', 'L');
