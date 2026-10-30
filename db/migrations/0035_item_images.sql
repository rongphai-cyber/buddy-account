-- รูปภาพสินค้า (ข้อกำหนดเจ้าของ 30/10/2569)
CREATE TABLE md_item_image (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  item_id uuid NOT NULL,
  line_no smallint NOT NULL,
  is_main boolean DEFAULT false NOT NULL,
  name varchar(120),
  mime varchar(30) NOT NULL,
  data text NOT NULL,
  thumb text NOT NULL,
  bytes integer NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE md_item_image IS 'รูปภาพสินค้า (ข้อกำหนดเจ้าของ 30/10/2569) — PNG/JPEG ไม่เกิน 300 KB ต่อรูป สูงสุด 8 รูปต่อรหัส · รูปหลักแสดงในรายการและหน้าค้นหา | Express: (ใหม่)';
COMMENT ON COLUMN md_item_image.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN md_item_image.company_id IS 'บริษัท';
COMMENT ON COLUMN md_item_image.item_id IS 'สินค้า';
COMMENT ON COLUMN md_item_image.line_no IS 'ลำดับรูป';
COMMENT ON COLUMN md_item_image.is_main IS 'รูปหลัก (แสดงในรายการสินค้าและหน้าค้นหา)';
COMMENT ON COLUMN md_item_image.name IS 'ชื่อแฟ้มรูปเดิม';
COMMENT ON COLUMN md_item_image.mime IS 'image/png หรือ image/jpeg';
COMMENT ON COLUMN md_item_image.data IS 'รูป (base64)';
COMMENT ON COLUMN md_item_image.thumb IS 'รูปย่อสำหรับรายการ (JPEG ด้านยาวไม่เกิน 160 px, base64)';
COMMENT ON COLUMN md_item_image.bytes IS 'ขนาดแฟ้มรูป (ไบต์)';
COMMENT ON COLUMN md_item_image.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN md_item_image.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN md_item_image.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN md_item_image.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN md_item_image.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN md_item_image.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN md_item_image.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
ALTER TABLE md_item_image ADD CONSTRAINT fk_md_item_image_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_item_image_company_id ON md_item_image (company_id);
ALTER TABLE md_item_image ADD CONSTRAINT fk_md_item_image_item_id FOREIGN KEY (item_id) REFERENCES md_item(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_item_image_item_id ON md_item_image (item_id);
ALTER TABLE md_item_image ADD CONSTRAINT fk_md_item_image_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_item_image_created_by ON md_item_image (created_by);
ALTER TABLE md_item_image ADD CONSTRAINT fk_md_item_image_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_item_image_updated_by ON md_item_image (updated_by);
CREATE TRIGGER trg_md_item_image_ver BEFORE UPDATE ON md_item_image FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_md_item_image_log AFTER INSERT OR UPDATE ON md_item_image FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_md_item_image_del AFTER DELETE ON md_item_image FOR EACH ROW EXECUTE FUNCTION sync_log_delete();
CREATE TRIGGER trg_md_item_image_rid BEFORE INSERT ON md_item_image FOR EACH ROW EXECUTE FUNCTION sync_row_id();
ALTER TABLE md_item_image ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buddy_app') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON md_item_image TO buddy_app;
  CREATE POLICY buddy_company ON md_item_image TO buddy_app USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);
END IF; END $$;
