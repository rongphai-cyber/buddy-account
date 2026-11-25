-- 0080 ใบสำคัญที่ย้ายมาจาก Express ไม่นับเป็นการใช้งานของแพ็กเกจ (HANDOFF 193 · เจ้าของ 26/11/2569 "แก้เลย")
-- เดิมหน้าการใช้งานนับใบสำคัญ GLJNL ที่ย้ายมาเป็น "ใบสำคัญที่บันทึกเอง" ของเดือนที่ย้าย (OCIO 681 · RIA 283)
ALTER TABLE gl_journal ADD COLUMN from_express boolean DEFAULT false NOT NULL;
COMMENT ON COLUMN gl_journal.from_express IS 'ย้ายมาจาก Express (GLJNL) — ไม่นับเป็นการใช้งานของแพ็กเกจ (HANDOFF 193)';

-- ทำเครื่องหมายใบสำคัญที่ย้ายมาแล้ว — กติกาที่พิสูจน์ได้ (ต้องครบทั้งสองข้อ):
-- 1) รหัสแถวเป็น UUID รุ่น 5 — ตัวย้ายข้อมูล (import/express/migrate.ts) สร้างรหัสแบบกำหนดได้ U('jnl', JNLTYP, VOUCHER) = uuid5
--    ส่วน Buddy สร้างใบสำคัญด้วย gen_random_uuid()/randomUUID() = รุ่น 4 เสมอ (คัดลอกบริษัทก็สร้างรหัสใหม่แบบสุ่ม)
-- 2) และอย่างใดอย่างหนึ่ง: created_at ตรงกับเวลาสร้างบริษัท (ตัวย้ายข้อมูลสร้างบริษัทและใบสำคัญในทรานแซกชันเดียว ไม่ระบุ created_at)
--    หรือบริษัทมีหลักฐานว่าย้ายจาก Express (เอกสารที่มี express_rectype หรือบันทึก IMPORT_EXPRESS)
-- ปิด trigger ระหว่างทำเครื่องหมาย — ไม่เพิ่มรุ่นของแถว/เวลาแก้ไข ไม่ส่งเป็นการเปลี่ยนแปลงให้เครื่องสาขา · ไม่แตะยอดเงินใด ๆ
ALTER TABLE gl_journal DISABLE TRIGGER USER;
UPDATE gl_journal j SET from_express = true
  FROM sys_company c
 WHERE c.id = j.company_id
   AND substr(j.id::text, 15, 1) = '5'
   AND (j.created_at = c.created_at
        OR EXISTS (SELECT 1 FROM doc_header h WHERE h.company_id = c.id AND h.express_rectype IS NOT NULL)
        OR EXISTS (SELECT 1 FROM sys_activity_log l WHERE l.company_id = c.id AND l.action = 'IMPORT_EXPRESS'));
ALTER TABLE gl_journal ENABLE TRIGGER USER;
