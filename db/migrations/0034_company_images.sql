-- โลโก้และลายเซ็นสำหรับพิมพ์เอกสาร (ข้อกำหนดเจ้าของ 30/10/2569)
CREATE TABLE sys_company_image (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  kind varchar(10) NOT NULL CHECK (kind IN ('LOGO','SIGN')),
  name varchar(120) NOT NULL,
  mime varchar(30) NOT NULL,
  data text NOT NULL,
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
COMMENT ON TABLE sys_company_image IS 'รูปของบริษัทสำหรับพิมพ์เอกสาร: โลโก้ และลายเซ็นผู้มีอำนาจ (ข้อกำหนดเจ้าของ 30/10/2569) — PNG/JPEG ไม่เกิน 300 KB | Express: (ใหม่)';
COMMENT ON COLUMN sys_company_image.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN sys_company_image.company_id IS 'บริษัท';
COMMENT ON COLUMN sys_company_image.kind IS 'LOGO=โลโก้บริษัท SIGN=ลายเซ็น';
COMMENT ON COLUMN sys_company_image.name IS 'ชื่อ เช่น ลายเซ็นกรรมการผู้จัดการ (โลโก้ = LOGO)';
COMMENT ON COLUMN sys_company_image.mime IS 'image/png หรือ image/jpeg';
COMMENT ON COLUMN sys_company_image.data IS 'รูป (base64)';
COMMENT ON COLUMN sys_company_image.bytes IS 'ขนาดแฟ้ม (ไบต์)';
COMMENT ON COLUMN sys_company_image.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN sys_company_image.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN sys_company_image.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN sys_company_image.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN sys_company_image.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN sys_company_image.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN sys_company_image.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_sys_company_image_company_kind_name ON sys_company_image (company_id, kind, name) WHERE deleted_at IS NULL;
ALTER TABLE sys_company_image ADD CONSTRAINT fk_sys_company_image_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_company_image_company_id ON sys_company_image (company_id);
ALTER TABLE sys_company_image ADD CONSTRAINT fk_sys_company_image_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_company_image_created_by ON sys_company_image (created_by);
ALTER TABLE sys_company_image ADD CONSTRAINT fk_sys_company_image_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_company_image_updated_by ON sys_company_image (updated_by);
CREATE TRIGGER trg_sys_company_image_ver BEFORE UPDATE ON sys_company_image FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_sys_company_image_log AFTER INSERT OR UPDATE ON sys_company_image FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_sys_company_image_del AFTER DELETE ON sys_company_image FOR EACH ROW EXECUTE FUNCTION sync_log_delete();
CREATE TRIGGER trg_sys_company_image_rid BEFORE INSERT ON sys_company_image FOR EACH ROW EXECUTE FUNCTION sync_row_id();
ALTER TABLE sys_company_image ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buddy_app') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON sys_company_image TO buddy_app;
  CREATE POLICY buddy_company ON sys_company_image TO buddy_app USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);
END IF; END $$;
