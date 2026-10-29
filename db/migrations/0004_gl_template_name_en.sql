-- ต้นแบบวิธีการบันทึก (คู่มือบทที่ 15 S-GL-01): คำอธิบายภาษาอังกฤษ ตามแฟ้ม GLTPL ของ Express
ALTER TABLE gl_template ADD COLUMN name_en varchar(120);
COMMENT ON COLUMN gl_template.name_en IS 'คำอธิบายภาษาอังกฤษ [Express: GLTPL.DESCRP2]';
