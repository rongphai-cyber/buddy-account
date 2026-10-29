-- T7.5 กุญแจ API ให้ระบบอื่นเชื่อมต่อ
CREATE TABLE sys_api_key (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  name varchar(120) NOT NULL,
  key_prefix varchar(20) NOT NULL,
  key_hash varchar(100) NOT NULL,
  read_only boolean DEFAULT false NOT NULL,
  expires_on date,
  status char(1) DEFAULT 'A' NOT NULL CHECK (status IN ('A','I')),
  last_used_at timestamptz,
  last_used_ip varchar(60),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE sys_api_key IS 'กุญแจ API ให้ระบบอื่นเชื่อมต่อ (T7.5) — ทำงานในนามผู้ใช้ที่ผูกไว้ ในบริษัทนี้เท่านั้น สิทธิ์ตามผู้ใช้นั้น | Express: (ใหม่)';
COMMENT ON COLUMN sys_api_key.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN sys_api_key.company_id IS 'บริษัท';
COMMENT ON COLUMN sys_api_key.user_id IS 'ทำงานในนามผู้ใช้ (สิทธิ์ตามผู้ใช้นี้)';
COMMENT ON COLUMN sys_api_key.name IS 'ชื่อกุญแจ เช่น ระบบหน้าร้าน';
COMMENT ON COLUMN sys_api_key.key_prefix IS 'ส่วนต้นของกุญแจ (เปิดเผยได้ ใช้ค้นหา/แสดงในรายการ)';
COMMENT ON COLUMN sys_api_key.key_hash IS 'SHA-256 ของส่วนลับ (ไม่เก็บกุญแจจริง — แสดงครั้งเดียวตอนสร้าง)';
COMMENT ON COLUMN sys_api_key.read_only IS 'อ่านอย่างเดียว (GET เท่านั้น)';
COMMENT ON COLUMN sys_api_key.expires_on IS 'หมดอายุ (ว่าง = ไม่หมดอายุ)';
COMMENT ON COLUMN sys_api_key.status IS 'A=ใช้งาน I=ยกเลิกแล้ว';
COMMENT ON COLUMN sys_api_key.last_used_at IS 'ใช้ครั้งล่าสุด';
COMMENT ON COLUMN sys_api_key.last_used_ip IS 'IP ที่ใช้ครั้งล่าสุด';
COMMENT ON COLUMN sys_api_key.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN sys_api_key.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN sys_api_key.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN sys_api_key.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN sys_api_key.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN sys_api_key.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN sys_api_key.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_sys_api_key_key_prefix ON sys_api_key (key_prefix) WHERE deleted_at IS NULL;
ALTER TABLE sys_api_key ADD CONSTRAINT fk_sys_api_key_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_api_key_company_id ON sys_api_key (company_id);
ALTER TABLE sys_api_key ADD CONSTRAINT fk_sys_api_key_user_id FOREIGN KEY (user_id) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_api_key_user_id ON sys_api_key (user_id);
ALTER TABLE sys_api_key ADD CONSTRAINT fk_sys_api_key_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_api_key_created_by ON sys_api_key (created_by);
ALTER TABLE sys_api_key ADD CONSTRAINT fk_sys_api_key_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_api_key_updated_by ON sys_api_key (updated_by);
CREATE TRIGGER trg_sys_api_key_ver BEFORE UPDATE ON sys_api_key FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
ALTER TABLE sys_api_key ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buddy_app') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON sys_api_key TO buddy_app;
  CREATE POLICY buddy_company ON sys_api_key TO buddy_app USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);
END IF; END $$;
