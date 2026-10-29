-- T0.16 ยืนยันตัวตนสองขั้น (TOTP) + ล็อกเมื่อใส่รหัสผ่านผิด — ข้อมูลเฉพาะเซิร์ฟเวอร์
CREATE TABLE sys_user_security (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  totp_secret_enc text,
  totp_enabled boolean DEFAULT false NOT NULL,
  totp_enabled_at timestamptz,
  totp_last_step bigint,
  totp_recovery jsonb,
  failed_logins smallint DEFAULT 0 NOT NULL,
  locked_until timestamptz,
  password_changed_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE sys_user_security IS 'ความปลอดภัยการเข้าระบบของผู้ใช้ (T0.16): ยืนยันตัวตนสองขั้น TOTP + ล็อกเมื่อใส่รหัสผ่านผิด — อยู่เฉพาะเซิร์ฟเวอร์ ไม่ซิงก์ลงเครื่องลูก | Express: (ใหม่)';
COMMENT ON COLUMN sys_user_security.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN sys_user_security.user_id IS 'ผู้ใช้';
COMMENT ON COLUMN sys_user_security.totp_secret_enc IS 'กุญแจ TOTP (เข้ารหัส AES-256-GCM ด้วยกุญแจหลักของเครื่องแม่ข่าย)';
COMMENT ON COLUMN sys_user_security.totp_enabled IS 'เปิดยืนยันตัวตนสองขั้นแล้ว (ยืนยันรหัสจากแอปสำเร็จ)';
COMMENT ON COLUMN sys_user_security.totp_enabled_at IS 'เปิดยืนยันตัวตนสองขั้นเมื่อ';
COMMENT ON COLUMN sys_user_security.totp_last_step IS 'ช่วงเวลา (30 วินาที) ของรหัสที่ใช้ล่าสุด — กันใช้รหัสเดิมซ้ำ';
COMMENT ON COLUMN sys_user_security.totp_recovery IS 'รหัสสำรอง (SHA-256) ใช้ได้ครั้งละหนึ่งรหัสเมื่อไม่มีมือถือ';
COMMENT ON COLUMN sys_user_security.failed_logins IS 'จำนวนครั้งที่ใส่รหัสผิดติดกัน';
COMMENT ON COLUMN sys_user_security.locked_until IS 'ล็อกถึงเวลานี้ (ใส่รหัสผิด 5 ครั้ง = 15 นาที)';
COMMENT ON COLUMN sys_user_security.password_changed_at IS 'เปลี่ยนรหัสผ่านล่าสุด';
COMMENT ON COLUMN sys_user_security.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN sys_user_security.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN sys_user_security.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN sys_user_security.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN sys_user_security.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN sys_user_security.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN sys_user_security.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_sys_user_security_user ON sys_user_security (user_id) WHERE deleted_at IS NULL;
ALTER TABLE sys_user_security ADD CONSTRAINT fk_sys_user_security_user_id FOREIGN KEY (user_id) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_user_security_user_id ON sys_user_security (user_id);
ALTER TABLE sys_user_security ADD CONSTRAINT fk_sys_user_security_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_user_security_created_by ON sys_user_security (created_by);
ALTER TABLE sys_user_security ADD CONSTRAINT fk_sys_user_security_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_user_security_updated_by ON sys_user_security (updated_by);
CREATE TRIGGER trg_sys_user_security_ver BEFORE UPDATE ON sys_user_security FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
