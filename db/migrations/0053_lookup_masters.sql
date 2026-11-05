-- docs/18 ข้อ 12 (เจ้าของ 05/11/2569): ข้อมูลหลักที่เพิ่มเองได้ แทนช่องพิมพ์อิสระ/รายการตายตัว — ตารางข้อมูล 70–76 + รายการตั้งต้นให้ทุกบริษัท (ตรงกับ LOOKUP_SEEDS ใน packages/core/src/menu.ts)
INSERT INTO md_lookup_type (id, code, name_th, has_rate) VALUES (gen_random_uuid(), '70', 'คำนำหน้าชื่อ', false) ON CONFLICT DO NOTHING;
INSERT INTO md_lookup_type (id, code, name_th, has_rate) VALUES (gen_random_uuid(), '71', 'ตำแหน่ง', false) ON CONFLICT DO NOTHING;
INSERT INTO md_lookup_type (id, code, name_th, has_rate) VALUES (gen_random_uuid(), '72', 'เงื่อนไขการชำระเงิน', false) ON CONFLICT DO NOTHING;
INSERT INTO md_lookup_type (id, code, name_th, has_rate) VALUES (gen_random_uuid(), '73', 'ประเภทพนักงาน', false) ON CONFLICT DO NOTHING;
INSERT INTO md_lookup_type (id, code, name_th, has_rate) VALUES (gen_random_uuid(), '74', 'สาเหตุที่พ้นสภาพพนักงาน', false) ON CONFLICT DO NOTHING;
INSERT INTO md_lookup_type (id, code, name_th, has_rate) VALUES (gen_random_uuid(), '75', 'เหตุผลการยกเลิก/ลบเอกสาร', false) ON CONFLICT DO NOTHING;
INSERT INTO md_lookup_type (id, code, name_th, has_rate) VALUES (gen_random_uuid(), '76', 'สัญชาติ', false) ON CONFLICT DO NOTHING;
INSERT INTO md_lookup (id, company_id, type_code, code, name_th, name_en, status)
  SELECT gen_random_uuid(), c.id, '70', v.code, v.th, v.en, 'A' FROM sys_company c CROSS JOIN (VALUES ('01', 'บริษัท', 'Company'), ('02', 'บริษัทมหาชน', 'Public Company'), ('03', 'ห้างหุ้นส่วนจำกัด', 'Limited Partnership'), ('04', 'ห้างหุ้นส่วนสามัญ', 'Ordinary Partnership'), ('05', 'ร้าน', 'Shop'), ('06', 'คุณ', 'Khun'), ('07', 'นาย', 'Mr.'), ('08', 'นาง', 'Mrs.'), ('09', 'นางสาว', 'Miss'), ('10', 'มูลนิธิ', 'Foundation'), ('11', 'สมาคม', 'Association')) AS v(code, th, en)
  WHERE c.deleted_at IS NULL ON CONFLICT DO NOTHING;
INSERT INTO md_lookup (id, company_id, type_code, code, name_th, name_en, status)
  SELECT gen_random_uuid(), c.id, '71', v.code, v.th, v.en, 'A' FROM sys_company c CROSS JOIN (VALUES ('01', 'กรรมการผู้จัดการ', 'Managing Director'), ('02', 'ผู้จัดการ', 'Manager'), ('03', 'ฝ่ายบัญชี', 'Accounting'), ('04', 'ฝ่ายการเงิน', 'Finance'), ('05', 'ฝ่ายจัดซื้อ', 'Purchasing'), ('06', 'ฝ่ายขาย', 'Sales'), ('07', 'พนักงานขาย', 'Salesperson'), ('08', 'พนักงาน', 'Staff')) AS v(code, th, en)
  WHERE c.deleted_at IS NULL ON CONFLICT DO NOTHING;
INSERT INTO md_lookup (id, company_id, type_code, code, name_th, name_en, status)
  SELECT gen_random_uuid(), c.id, '72', v.code, v.th, v.en, 'A' FROM sys_company c CROSS JOIN (VALUES ('01', 'เงินสด', 'Cash'), ('02', 'โอนเงิน', 'Bank transfer'), ('03', 'เช็ค', 'Cheque'), ('04', 'เครดิต 30 วัน', 'Credit 30 days'), ('05', 'เครดิต 60 วัน', 'Credit 60 days'), ('06', '2/10, n/30', '2/10, n/30')) AS v(code, th, en)
  WHERE c.deleted_at IS NULL ON CONFLICT DO NOTHING;
INSERT INTO md_lookup (id, company_id, type_code, code, name_th, name_en, status)
  SELECT gen_random_uuid(), c.id, '73', v.code, v.th, v.en, 'A' FROM sys_company c CROSS JOIN (VALUES ('01', 'ประจำ', 'Permanent'), ('02', 'รายวัน', 'Daily'), ('03', 'ทดลองงาน', 'Probation'), ('04', 'ชั่วคราว', 'Temporary'), ('05', 'กรรมการ', 'Director')) AS v(code, th, en)
  WHERE c.deleted_at IS NULL ON CONFLICT DO NOTHING;
INSERT INTO md_lookup (id, company_id, type_code, code, name_th, name_en, status)
  SELECT gen_random_uuid(), c.id, '74', v.code, v.th, v.en, 'A' FROM sys_company c CROSS JOIN (VALUES ('01', 'ลาออก', 'Resigned'), ('02', 'เลิกจ้าง', 'Dismissed'), ('03', 'สิ้นสุดสัญญา', 'End of contract'), ('04', 'เกษียณ', 'Retired'), ('05', 'เสียชีวิต', 'Deceased')) AS v(code, th, en)
  WHERE c.deleted_at IS NULL ON CONFLICT DO NOTHING;
INSERT INTO md_lookup (id, company_id, type_code, code, name_th, name_en, status)
  SELECT gen_random_uuid(), c.id, '75', v.code, v.th, v.en, 'A' FROM sys_company c CROSS JOIN (VALUES ('01', 'คีย์ข้อมูลผิด', 'Keyed in error'), ('02', 'ออกเอกสารซ้ำ', 'Duplicate document'), ('03', 'ลูกค้า/ผู้จำหน่ายยกเลิก', 'Cancelled by customer/supplier'), ('04', 'เปลี่ยนแปลงราคาหรือจำนวน', 'Price or quantity changed'), ('05', 'ออกเอกสารใหม่แทน', 'Replaced by a new document')) AS v(code, th, en)
  WHERE c.deleted_at IS NULL ON CONFLICT DO NOTHING;
INSERT INTO md_lookup (id, company_id, type_code, code, name_th, name_en, status)
  SELECT gen_random_uuid(), c.id, '76', v.code, v.th, v.en, 'A' FROM sys_company c CROSS JOIN (VALUES ('01', 'ไทย', 'Thai'), ('02', 'เมียนมา', 'Myanmar'), ('03', 'ลาว', 'Lao'), ('04', 'กัมพูชา', 'Cambodian'), ('05', 'เวียดนาม', 'Vietnamese'), ('06', 'จีน', 'Chinese'), ('07', 'ญี่ปุ่น', 'Japanese')) AS v(code, th, en)
  WHERE c.deleted_at IS NULL ON CONFLICT DO NOTHING;
