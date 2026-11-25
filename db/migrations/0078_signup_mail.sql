-- HANDOFF 187: อีเมลแจ้งใบสมัคร/อนุมัติ ผ่าน Cloudflare Email Service — ค่าตั้งของผู้ให้บริการ + บันทึกการส่ง (ข้อมูลเฉพาะเซิร์ฟเวอร์ ไม่มี company_id)
CREATE TABLE sys_platform_setting (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  key varchar(40) NOT NULL,
  value jsonb NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE sys_platform_setting IS 'ค่าตั้งของผู้ให้บริการ (ทั้งระบบ ไม่ใช่ของบริษัท) เช่น อีเมลรับแจ้งเตือนใบสมัคร Reply-To ผู้ส่ง (HANDOFF 187) — เก็บในฐานข้อมูล ไม่อยู่ใน repo · อยู่เฉพาะเซิร์ฟเวอร์ | Express: (ใหม่)';
COMMENT ON COLUMN sys_platform_setting.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN sys_platform_setting.key IS 'ชื่อค่า เช่น mail.signup_notify';
COMMENT ON COLUMN sys_platform_setting.value IS 'ค่า (JSON)';
COMMENT ON COLUMN sys_platform_setting.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN sys_platform_setting.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN sys_platform_setting.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN sys_platform_setting.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN sys_platform_setting.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN sys_platform_setting.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN sys_platform_setting.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_sys_platform_setting_key ON sys_platform_setting (key) WHERE deleted_at IS NULL;
ALTER TABLE sys_platform_setting ADD CONSTRAINT fk_sys_platform_setting_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_platform_setting_created_by ON sys_platform_setting (created_by);
ALTER TABLE sys_platform_setting ADD CONSTRAINT fk_sys_platform_setting_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_platform_setting_updated_by ON sys_platform_setting (updated_by);
CREATE TRIGGER trg_sys_platform_setting_ver BEFORE UPDATE ON sys_platform_setting FOR EACH ROW EXECUTE FUNCTION sys_bump_version();

CREATE TABLE sys_mail_log (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  signup_id uuid,
  tenant_id uuid,
  kind varchar(20) NOT NULL,
  recipients varchar(500) NOT NULL,
  subject varchar(200),
  status char(1) NOT NULL CHECK (status IN ('S','F','K')),
  message_id varchar(200),
  error varchar(500),
  attempts integer DEFAULT 1 NOT NULL,
  last_attempt_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE sys_mail_log IS 'อีเมลที่ระบบส่ง (HANDOFF 187): แจ้งผู้ให้บริการเมื่อมีใบสมัคร · แจ้งผู้สมัครว่าได้รับ/อนุมัติ/ไม่อนุมัติ — สถานะต่อใบสมัครและชนิด ส่งใหม่ได้ · ไม่เก็บเนื้อหา (สร้างใหม่จากใบสมัครตอนส่งซ้ำ) · อยู่เฉพาะเซิร์ฟเวอร์ | Express: (ใหม่)';
COMMENT ON COLUMN sys_mail_log.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN sys_mail_log.signup_id IS 'ใบสมัครที่เกี่ยวข้อง';
COMMENT ON COLUMN sys_mail_log.tenant_id IS 'ลูกค้าผู้ใช้บริการ (เมื่ออนุมัติแล้ว)';
COMMENT ON COLUMN sys_mail_log.kind IS 'ชนิด: SIGNUP_NOTIFY แจ้งผู้ให้บริการ · SIGNUP_RECEIVED ได้รับใบสมัคร · SIGNUP_APPROVED อนุมัติแล้ว · SIGNUP_REJECTED ไม่อนุมัติ';
COMMENT ON COLUMN sys_mail_log.recipients IS 'ผู้รับ (คั่นด้วยจุลภาค)';
COMMENT ON COLUMN sys_mail_log.subject IS 'หัวเรื่อง';
COMMENT ON COLUMN sys_mail_log.status IS 'S=ส่งแล้ว F=ส่งไม่สำเร็จ K=ไม่ได้ส่ง (ปิดการส่งอีเมล/ไม่มีผู้รับ)';
COMMENT ON COLUMN sys_mail_log.message_id IS 'รหัสข้อความจากผู้ให้บริการส่งอีเมล';
COMMENT ON COLUMN sys_mail_log.error IS 'ข้อผิดพลาด (ไม่มีความลับ)';
COMMENT ON COLUMN sys_mail_log.attempts IS 'จำนวนครั้งที่ส่ง';
COMMENT ON COLUMN sys_mail_log.last_attempt_at IS 'ส่งครั้งล่าสุดเมื่อ';
COMMENT ON COLUMN sys_mail_log.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN sys_mail_log.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN sys_mail_log.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN sys_mail_log.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN sys_mail_log.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN sys_mail_log.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN sys_mail_log.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE INDEX ix_sys_mail_log_signup_kind ON sys_mail_log (signup_id, kind);
ALTER TABLE sys_mail_log ADD CONSTRAINT fk_sys_mail_log_signup_id FOREIGN KEY (signup_id) REFERENCES sys_signup(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_mail_log_signup_id ON sys_mail_log (signup_id);
ALTER TABLE sys_mail_log ADD CONSTRAINT fk_sys_mail_log_tenant_id FOREIGN KEY (tenant_id) REFERENCES sys_tenant(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_mail_log_tenant_id ON sys_mail_log (tenant_id);
ALTER TABLE sys_mail_log ADD CONSTRAINT fk_sys_mail_log_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_mail_log_created_by ON sys_mail_log (created_by);
ALTER TABLE sys_mail_log ADD CONSTRAINT fk_sys_mail_log_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_mail_log_updated_by ON sys_mail_log (updated_by);
CREATE TRIGGER trg_sys_mail_log_ver BEFORE UPDATE ON sys_mail_log FOR EACH ROW EXECUTE FUNCTION sys_bump_version();

DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buddy_app') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON sys_platform_setting, sys_mail_log TO buddy_app;
END IF; END $$;
