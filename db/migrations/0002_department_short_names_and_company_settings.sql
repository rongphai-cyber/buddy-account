-- แผนก: ชื่อย่อไทย/อังกฤษ (คู่มือบทที่ 6 หน้าจอกำหนดแผนก) + ค่าเริ่มต้นรายละเอียดกิจการ (บทที่ 5 ข้อ 4, 5.2, 5.3)
ALTER TABLE md_department ADD COLUMN short_name_th varchar(30);
ALTER TABLE md_department ADD COLUMN short_name_en varchar(30);
COMMENT ON COLUMN md_department.name_th IS 'ชื่อเต็มไทย [Express: ISTAB.TYPDES]';
COMMENT ON COLUMN md_department.name_en IS 'ชื่อเต็มอังกฤษ [Express: ISTAB.TYPDES2]';
COMMENT ON COLUMN md_department.short_name_th IS 'ชื่อย่อไทย (คู่มือบทที่ 6 หน้า 90) [Express: ISTAB.SHORTNAM]';
COMMENT ON COLUMN md_department.short_name_en IS 'ชื่อย่ออังกฤษ [Express: ISTAB.SHORTNAM2]';
INSERT INTO sys_setting_def(id, key, module, data_type, default_value, label_th, express_field) VALUES (gen_random_uuid(), 'gen.business_type', 'GEN', 'code', '"J"'::jsonb, 'ประเภทกิจการ J=นิติบุคคล P=บุคคลธรรมดา', 'ISINFO.BUSTYP') ON CONFLICT DO NOTHING;
INSERT INTO sys_setting_def(id, key, module, data_type, default_value, label_th, express_field) VALUES (gen_random_uuid(), 'gen.branch_short_name', 'GEN', 'text', '""'::jsonb, 'ชื่อย่อสาขา (เริ่มระบบ 1.1 ข้อ 5.2)', 'ISINFO.BRNSHORT') ON CONFLICT DO NOTHING;
INSERT INTO sys_setting_def(id, key, module, data_type, default_value, label_th, express_field) VALUES (gen_random_uuid(), 'gen.allow_blank_party_tax_id', 'GEN', 'bool', 'true'::jsonb, 'ยอมให้เลขผู้เสียภาษีของลูกค้า/ผู้จำหน่ายว่างได้ (ข้อ 5.3)', 'ISINFO.TAXIDBLANK') ON CONFLICT DO NOTHING;
