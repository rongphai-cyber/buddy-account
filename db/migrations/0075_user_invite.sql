-- HANDOFF 184: ลิงก์เชิญผู้ใช้ตั้งรหัสผ่านเอง (ผู้ดูแลของลูกค้าส่งทาง LINE) — ข้อมูลเฉพาะเซิร์ฟเวอร์ ไม่มี company_id (สิทธิ์ใช้ได้ตามตารางทั้งหมดของ 0007)
CREATE TABLE sys_user_invite (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  tenant_id uuid,
  token_hash varchar(100) NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE sys_user_invite IS 'ลิงก์เชิญผู้ใช้ตั้งรหัสผ่านเอง (HANDOFF 184 · เจ้าของ 24/11/2569) — ผู้ดูแลของลูกค้าสร้างลิงก์ส่งทาง LINE · ใช้ได้ครั้งเดียว มีวันหมดอายุ ยกเลิก/ออกใหม่ได้ · เก็บเฉพาะ hash ของ token · ผู้ดูแลไม่เห็นรหัสผ่าน — อยู่เฉพาะเซิร์ฟเวอร์ ไม่ซิงก์ลงเครื่องลูก | Express: (ใหม่)';
COMMENT ON COLUMN sys_user_invite.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN sys_user_invite.user_id IS 'ผู้ใช้ที่ถูกเชิญ';
COMMENT ON COLUMN sys_user_invite.tenant_id IS 'ลูกค้าผู้ใช้บริการของผู้ใช้ (ว่าง = เจ้าหน้าที่ผู้ให้บริการ)';
COMMENT ON COLUMN sys_user_invite.token_hash IS 'SHA-256 ของ token ในลิงก์ (ไม่เก็บ token จริง)';
COMMENT ON COLUMN sys_user_invite.expires_at IS 'ลิงก์หมดอายุ';
COMMENT ON COLUMN sys_user_invite.used_at IS 'ใช้ลิงก์ตั้งรหัสผ่านแล้วเมื่อ (ใช้ได้ครั้งเดียว)';
COMMENT ON COLUMN sys_user_invite.revoked_at IS 'ยกเลิกลิงก์เมื่อ (ผู้ดูแลยกเลิก หรือออกลิงก์ใหม่แทน)';
COMMENT ON COLUMN sys_user_invite.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN sys_user_invite.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN sys_user_invite.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN sys_user_invite.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN sys_user_invite.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN sys_user_invite.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN sys_user_invite.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_sys_user_invite_token_hash ON sys_user_invite (token_hash) WHERE deleted_at IS NULL;
ALTER TABLE sys_user_invite ADD CONSTRAINT fk_sys_user_invite_user_id FOREIGN KEY (user_id) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_user_invite_user_id ON sys_user_invite (user_id);
ALTER TABLE sys_user_invite ADD CONSTRAINT fk_sys_user_invite_tenant_id FOREIGN KEY (tenant_id) REFERENCES sys_tenant(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_user_invite_tenant_id ON sys_user_invite (tenant_id);
ALTER TABLE sys_user_invite ADD CONSTRAINT fk_sys_user_invite_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_user_invite_created_by ON sys_user_invite (created_by);
ALTER TABLE sys_user_invite ADD CONSTRAINT fk_sys_user_invite_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_user_invite_updated_by ON sys_user_invite (updated_by);
CREATE TRIGGER trg_sys_user_invite_ver BEFORE UPDATE ON sys_user_invite FOR EACH ROW EXECUTE FUNCTION sys_bump_version();

DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buddy_app') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON sys_user_invite TO buddy_app;
END IF; END $$;
