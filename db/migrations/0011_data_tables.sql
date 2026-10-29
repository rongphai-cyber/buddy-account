-- T1.17 ตารางข้อมูล (คู่มือบทที่ 6 S-TBL-00/01): หน่วยนับ คลัง ธนาคาร มีชื่อย่อ/อัตรา/สถานะในตารางของตัวเอง
ALTER TABLE md_unit ADD COLUMN short_th varchar(30);
ALTER TABLE md_unit ADD COLUMN short_en varchar(30);
ALTER TABLE md_unit ADD COLUMN rate numeric(18,4);
ALTER TABLE md_unit ADD COLUMN status char(1) DEFAULT 'A' NOT NULL CHECK (status IN ('A','I'));
COMMENT ON COLUMN md_unit.short_th IS 'ชื่อย่อไทย [Express: ISTAB.SHORTNAM]';
COMMENT ON COLUMN md_unit.short_en IS 'ชื่อย่ออังกฤษ [Express: ISTAB.SHORTNAM2]';
COMMENT ON COLUMN md_unit.rate IS 'อัตรา: ตัวคูณให้เป็นหน่วยย่อย เช่น โหล = 12 (คู่มือหน้า 87) [Express: ISTAB.FLD02]';
COMMENT ON COLUMN md_unit.status IS 'สถานะ';

ALTER TABLE md_warehouse ADD COLUMN short_th varchar(30);
ALTER TABLE md_warehouse ADD COLUMN short_en varchar(30);
COMMENT ON COLUMN md_warehouse.short_th IS 'ชื่อย่อไทย [Express: ISTAB.SHORTNAM]';
COMMENT ON COLUMN md_warehouse.short_en IS 'ชื่อย่ออังกฤษ [Express: ISTAB.SHORTNAM2]';

ALTER TABLE md_bank ADD COLUMN short_th varchar(30);
ALTER TABLE md_bank ADD COLUMN short_en varchar(30);
ALTER TABLE md_bank ADD COLUMN status char(1) DEFAULT 'A' NOT NULL CHECK (status IN ('A','I'));
COMMENT ON COLUMN md_bank.short_th IS 'ชื่อย่อไทย [Express: ISTAB.SHORTNAM]';
COMMENT ON COLUMN md_bank.short_en IS 'ชื่อย่ออังกฤษ [Express: ISTAB.SHORTNAM2]';
COMMENT ON COLUMN md_bank.status IS 'สถานะ';

-- ข้อมูลที่นำเข้าก่อนหน้านี้: ย้ายชื่อย่อ/อัตราจาก md_lookup (ตาราง 01 20 21) มาที่ตารางของตัวเอง แล้วเลิกใช้สำเนาใน md_lookup (รวม 50 แผนก)
UPDATE md_unit u SET short_th = l.short_th, short_en = l.short_en, rate = l.rate
  FROM md_lookup l WHERE l.company_id = u.company_id AND l.type_code = '20' AND l.code = u.code AND l.deleted_at IS NULL;
UPDATE md_warehouse w SET short_th = l.short_th, short_en = l.short_en
  FROM md_lookup l WHERE l.company_id = w.company_id AND l.type_code = '21' AND l.code = w.code AND l.deleted_at IS NULL;
UPDATE md_bank b SET short_th = l.short_th, short_en = l.short_en
  FROM md_lookup l WHERE l.company_id = b.company_id AND l.type_code = '01' AND l.code = b.code AND l.deleted_at IS NULL;
UPDATE md_lookup SET deleted_at = now() WHERE type_code IN ('01', '20', '21', '50') AND deleted_at IS NULL;
