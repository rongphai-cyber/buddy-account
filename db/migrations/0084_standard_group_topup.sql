-- 0084 เติมสิทธิ์ที่ขาดของกลุ่มตั้งต้น (HANDOFF 198 ข้อ 5 · ตรวจทาน 197) — ครั้งเดียว ไม่แตะแถวที่มีอยู่
-- กลุ่มตั้งต้นของลูกค้าที่สร้างไปแล้ว (คลาวด์มี SALE PURCH ACC FIN GA HR VIEW แล้ว) ได้แถวเมนูใหม่ตาม STANDARD_GROUPS ใน apps/server/src/standard-groups.ts
--   ฝ่ายขาย/จัดซื้อ/บุคคล: ศูนย์รายงาน (อ่าน พิมพ์) · ฝ่ายธุรการ: ตารางราคาขาย (อ่าน — หน้าสินค้าที่แก้ได้เรียกราคา) + ศูนย์รายงาน
--   ฝ่ายการเงิน: ลงประจำวัน (อ่าน พิมพ์ — สมุดเงินฝากเปิดใบสำคัญ) + ยอดคงเหลือสินค้า (อ่าน พิมพ์)
--   ฝ่ายบัญชี: ปิดงวด · ประมวลผลสิ้นปี (ทำได้ — ต้องระดับอนุมัติ 5 ขึ้นไปตามสิทธิ์พื้นฐาน) · ตรวจสอบข้อมูล · ดูค่าตั้งของระบบ (อ่าน พิมพ์)
-- เฉพาะบริษัทที่กลุ่มนั้นมีแถวสิทธิ์อยู่แล้ว (บริษัทที่ยังไม่มี = ปุ่ม "+ กลุ่มตั้งต้น" ใส่ครบเองตาม STANDARD_GROUPS)
-- ใส่เฉพาะเมนูที่กลุ่มยังไม่มีแถวในบริษัทนั้น — แถวที่ลูกค้าแก้เองไม่ถูกเขียนทับ · ไม่มีกลุ่ม/เมนู = ไม่ทำอะไร
-- กลุ่มของผู้ให้บริการ (tenant_id ว่าง) ไม่แตะ
INSERT INTO sys_permission (company_id, subject_type, subject_id, menu_id, can_read, can_add, can_edit, can_cancel, can_delete, can_print, can_approve)
SELECT gc.company_id, 'G', g.id, m.id, w.r, w.a, w.e, w.c, w.d, w.p, w.ap
  FROM (VALUES
  ('SALE', 'RP.CENTER', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('PURCH', 'RP.CENTER', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('HR', 'RP.CENTER', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('GA', 'IC.PRICE', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text),
  ('GA', 'RP.CENTER', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('FIN', 'GL.JNL', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('FIN', 'IC.STOCK', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('ACC', 'OT.LOCK', 'Y', 'Y', 'Y', 'Y', NULL::text, 'Y', NULL::text),
  ('ACC', 'OT.YE', 'Y', 'Y', 'Y', 'Y', NULL::text, 'Y', NULL::text),
  ('ACC', 'OT.CHECK', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('ACC', 'SET.CO', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('ACC', 'SET.DEF', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('ACC', 'SET.DOCNO', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('ACC', 'SET.PRD', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('ACC', 'SET.LINK', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('ACC', 'SET.PAYM', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('ACC', 'SET.TBL', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('ACC', 'SET.IAG', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('ACC', 'SET.FAG', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('ACC', 'SET.DEPT', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('ACC', 'SET.BRANCH', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text)
  ) AS w(code, menu, r, a, e, c, d, p, ap)
  JOIN sys_user_group g ON g.code = w.code AND g.tenant_id IS NOT NULL AND g.deleted_at IS NULL
  JOIN sys_menu m ON m.code = w.menu AND m.deleted_at IS NULL
  JOIN (SELECT DISTINCT company_id, subject_id FROM sys_permission WHERE subject_type = 'G' AND deleted_at IS NULL) gc ON gc.subject_id = g.id
 WHERE NOT EXISTS (SELECT 1 FROM sys_permission x WHERE x.company_id = gc.company_id AND x.subject_type = 'G' AND x.subject_id = g.id AND x.menu_id = m.id AND x.deleted_at IS NULL);
