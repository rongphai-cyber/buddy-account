-- T7.7 AI อ่านบิล: ค่าลับเข้ารหัส (กุญแจ API) + บันทึกการใช้/ค่าใช้จ่าย
CREATE TABLE sys_secret (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  code varchar(20) NOT NULL,
  value_enc text NOT NULL,
  hint varchar(60),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE sys_secret IS 'ค่าลับของบริษัท (เข้ารหัส AES-256-GCM ด้วยกุญแจของเครื่องแม่ข่าย) เช่น กุญแจ API ของ Claude (T7.7) — ไม่ส่งกลับหน้าจอ ไม่อยู่ในแฟ้มสำรอง/คัดลอกบริษัท | Express: (ใหม่)';
COMMENT ON COLUMN sys_secret.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN sys_secret.company_id IS 'บริษัท';
COMMENT ON COLUMN sys_secret.code IS 'ชนิดค่าลับ เช่น ANTHROPIC_KEY';
COMMENT ON COLUMN sys_secret.value_enc IS 'ค่าที่เข้ารหัสแล้ว (iv.tag.ciphertext แบบ base64)';
COMMENT ON COLUMN sys_secret.hint IS 'ส่วนท้ายสำหรับแสดง เช่น …abcd';
COMMENT ON COLUMN sys_secret.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN sys_secret.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN sys_secret.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN sys_secret.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN sys_secret.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN sys_secret.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN sys_secret.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_sys_secret_company_code ON sys_secret (company_id, code) WHERE deleted_at IS NULL;
ALTER TABLE sys_secret ADD CONSTRAINT fk_sys_secret_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_secret_company_id ON sys_secret (company_id);
ALTER TABLE sys_secret ADD CONSTRAINT fk_sys_secret_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_secret_created_by ON sys_secret (created_by);
ALTER TABLE sys_secret ADD CONSTRAINT fk_sys_secret_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_secret_updated_by ON sys_secret (updated_by);
CREATE TRIGGER trg_sys_secret_ver BEFORE UPDATE ON sys_secret FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
ALTER TABLE sys_secret ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buddy_app') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON sys_secret TO buddy_app;
  CREATE POLICY buddy_company ON sys_secret TO buddy_app USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);
END IF; END $$;
CREATE TABLE sys_ai_usage (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  user_id uuid,
  purpose varchar(20) DEFAULT 'BILL' NOT NULL,
  model varchar(60),
  input_tokens integer DEFAULT 0 NOT NULL,
  output_tokens integer DEFAULT 0 NOT NULL,
  cache_read_tokens integer DEFAULT 0 NOT NULL,
  cache_write_tokens integer DEFAULT 0 NOT NULL,
  cost_usd numeric(18,4) DEFAULT 0 NOT NULL,
  status varchar(10) NOT NULL,
  file_name varchar(200),
  file_size integer,
  message varchar(500),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE sys_ai_usage IS 'การเรียกใช้ AI อ่านบิล (T7.7) — จำนวนโทเคนและค่าใช้จ่าย ใช้คุมเพดานรายเดือน | Express: (ใหม่)';
COMMENT ON COLUMN sys_ai_usage.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN sys_ai_usage.company_id IS 'บริษัท';
COMMENT ON COLUMN sys_ai_usage.user_id IS 'ผู้เรียกใช้';
COMMENT ON COLUMN sys_ai_usage.purpose IS 'งานที่ใช้ BILL=อ่านบิล';
COMMENT ON COLUMN sys_ai_usage.model IS 'รุ่นโมเดลที่ตอบจริง';
COMMENT ON COLUMN sys_ai_usage.input_tokens IS 'โทเคนขาเข้า (ไม่รวมแคช)';
COMMENT ON COLUMN sys_ai_usage.output_tokens IS 'โทเคนขาออก';
COMMENT ON COLUMN sys_ai_usage.cache_read_tokens IS 'โทเคนที่อ่านจากแคช';
COMMENT ON COLUMN sys_ai_usage.cache_write_tokens IS 'โทเคนที่เขียนแคช';
COMMENT ON COLUMN sys_ai_usage.cost_usd IS 'ค่าใช้จ่ายโดยประมาณ (ดอลลาร์สหรัฐ) ตามราคาต่อโทเคน';
COMMENT ON COLUMN sys_ai_usage.status IS 'OK / ERROR / REFUSED';
COMMENT ON COLUMN sys_ai_usage.file_name IS 'ชื่อแฟ้มที่อ่าน';
COMMENT ON COLUMN sys_ai_usage.file_size IS 'ขนาดแฟ้ม (ไบต์)';
COMMENT ON COLUMN sys_ai_usage.message IS 'ข้อความผิดพลาด';
COMMENT ON COLUMN sys_ai_usage.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN sys_ai_usage.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN sys_ai_usage.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN sys_ai_usage.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN sys_ai_usage.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN sys_ai_usage.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN sys_ai_usage.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
ALTER TABLE sys_ai_usage ADD CONSTRAINT fk_sys_ai_usage_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_ai_usage_company_id ON sys_ai_usage (company_id);
ALTER TABLE sys_ai_usage ADD CONSTRAINT fk_sys_ai_usage_user_id FOREIGN KEY (user_id) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_ai_usage_user_id ON sys_ai_usage (user_id);
ALTER TABLE sys_ai_usage ADD CONSTRAINT fk_sys_ai_usage_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_ai_usage_created_by ON sys_ai_usage (created_by);
ALTER TABLE sys_ai_usage ADD CONSTRAINT fk_sys_ai_usage_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_ai_usage_updated_by ON sys_ai_usage (updated_by);
CREATE TRIGGER trg_sys_ai_usage_ver BEFORE UPDATE ON sys_ai_usage FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
ALTER TABLE sys_ai_usage ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buddy_app') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON sys_ai_usage TO buddy_app;
  CREATE POLICY buddy_company ON sys_ai_usage TO buddy_app USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);
END IF; END $$;
