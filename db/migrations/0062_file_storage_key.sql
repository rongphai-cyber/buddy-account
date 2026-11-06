-- 0062 ที่เก็บไฟล์ (docs/20 ข้อ 9): รูปโลโก้/ลายเซ็น และรูปสินค้าเก็บใน Cloudflare R2 ได้ เมื่อ server ตั้ง FILES_DRIVER=r2
-- storage_key = <company_id>/<kind>/<uuid>.<ext> · ว่าง = รูปอยู่ในช่อง data แบบเดิม (ค่าเริ่มต้น local ไม่เปลี่ยนพฤติกรรม)
ALTER TABLE sys_company_image ADD COLUMN storage_key varchar(200);
COMMENT ON COLUMN sys_company_image.storage_key IS 'ที่อยู่ไฟล์ในที่เก็บไฟล์ R2 <company_id>/<kind>/<uuid>.<ext> (docs/20) — ว่าง = รูปอยู่ในช่อง data';
ALTER TABLE md_item_image ADD COLUMN storage_key varchar(200);
COMMENT ON COLUMN md_item_image.storage_key IS 'ที่อยู่รูปเต็มในที่เก็บไฟล์ R2 <company_id>/item-image/<uuid>.<ext> (docs/20) — ว่าง = รูปอยู่ในช่อง data';
