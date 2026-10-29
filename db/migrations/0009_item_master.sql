-- T2.3 แฟ้มสินค้า (คู่มือบทที่ 7 S-IC-01…07, บทที่ 5 S-SET-04)
-- 1) ความหมายของ STMAS.STKTYP ที่ถูกต้อง: ชุดธรรมดา/ชุดพิเศษ = 1/2 (ดัชนี CDX ของ Express รวม 1 กับ 2 เป็นสินค้าชุด) บริการ = 3
COMMENT ON COLUMN md_item.item_type IS '0=สินค้า 1=สินค้าชุดธรรมดา 2=สินค้าชุดพิเศษ 3=สินค้าบริการ 4=รายได้อื่น 5=ค่าใช้จ่ายอื่น [Express: STMAS.STKTYP]';

-- 2) ฟิลด์เพิ่มเติมของสินค้าที่ยังไม่มีที่เก็บ (ค่าเริ่มต้นระบบสินค้า ข้อ 21 วันที่2, ข้อ 22 ตัวเลข)
ALTER TABLE md_item ADD COLUMN udf_date_2 date;
ALTER TABLE md_item ADD COLUMN udf_num_1 numeric(18,4);
COMMENT ON COLUMN md_item.udf_date_2 IS 'วันที่กำหนดเอง 2 [Express: STMAS.DAT2]';
COMMENT ON COLUMN md_item.udf_num_1 IS 'ตัวเลขกำหนดเอง [Express: STMAS.NUM1]';

-- 3) กลุ่มบัญชีเฉพาะสินค้า: Express สร้างกลุ่มซ่อนให้บริการ/รายได้อื่น/ค่าใช้จ่ายอื่นทีละรายการ (METHOD='-')
ALTER TABLE md_item_account_group ADD COLUMN item_specific boolean DEFAULT false NOT NULL;
COMMENT ON COLUMN md_item_account_group.item_specific IS 'กลุ่มเฉพาะของสินค้าบริการ/รายได้อื่น/ค่าใช้จ่ายอื่น 1 รายการ (Express METHOD=''-'') — ไม่แสดงในรายการกลุ่มบัญชี แก้ที่หน้าจอสินค้า [Express: ISACC.METHOD=''-'']';
-- กลุ่มที่นำเข้าแล้วจาก Express: ไม่มีวิธีคิดต้นทุน และถูกใช้โดยสินค้าที่ไม่ใช่สินค้าคงคลังเพียงรายการเดียว
UPDATE md_item_account_group g SET item_specific = true
 WHERE g.cost_method IS NULL
   AND (SELECT count(*) FROM md_item i WHERE i.account_group_id = g.id AND i.deleted_at IS NULL) = 1
   AND NOT EXISTS (SELECT 1 FROM md_item i WHERE i.account_group_id = g.id AND i.item_type IN ('0', '1', '2'));
