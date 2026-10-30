-- ใบสมัครใช้งานจากหน้าสมัครเอง (ข้อกำหนดเจ้าของ 30/10/2569)
CREATE TABLE sys_signup (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  business_name varchar(120) NOT NULL,
  contact_name varchar(120) NOT NULL,
  contact_email varchar(120) NOT NULL,
  contact_phone varchar(60) NOT NULL,
  username varchar(30) NOT NULL,
  password_hash varchar(100),
  accepted_terms_at timestamptz NOT NULL,
  client_ip varchar(60),
  status char(1) DEFAULT 'P' NOT NULL CHECK (status IN ('P','A','R')),
  tenant_id uuid,
  decided_by uuid,
  decided_at timestamptz,
  reject_reason varchar(200),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE sys_signup IS 'ใบสมัครใช้งานจากหน้าสมัครเอง (ข้อกำหนดเจ้าของ 30/10/2569) — ผู้ให้บริการอนุมัติแล้วสร้างลูกค้าผู้ใช้บริการ + ผู้ดูแลคนแรก | Express: (ใหม่)';
COMMENT ON COLUMN sys_signup.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN sys_signup.business_name IS 'ชื่อกิจการ/ร้านที่สมัคร';
COMMENT ON COLUMN sys_signup.contact_name IS 'ชื่อผู้สมัคร (ผู้ติดต่อ)';
COMMENT ON COLUMN sys_signup.contact_email IS 'อีเมลผู้ติดต่อ';
COMMENT ON COLUMN sys_signup.contact_phone IS 'โทรศัพท์ผู้ติดต่อ';
COMMENT ON COLUMN sys_signup.username IS 'รหัสผู้ใช้ที่ขอ (ผู้ดูแลคนแรกของลูกค้า)';
COMMENT ON COLUMN sys_signup.password_hash IS 'รหัสผ่านที่ตั้ง (bcrypt) — ล้างทิ้งเมื่ออนุมัติ/ไม่อนุมัติแล้ว';
COMMENT ON COLUMN sys_signup.accepted_terms_at IS 'เวลาที่ยอมรับเงื่อนไขการใช้บริการและข้อตกลงข้อมูลส่วนบุคคล';
COMMENT ON COLUMN sys_signup.client_ip IS 'IP ที่ส่งใบสมัคร (กันสแปม)';
COMMENT ON COLUMN sys_signup.status IS 'P=รออนุมัติ A=อนุมัติแล้ว R=ไม่อนุมัติ';
COMMENT ON COLUMN sys_signup.tenant_id IS 'ลูกค้าผู้ใช้บริการที่สร้างจากใบสมัครนี้';
COMMENT ON COLUMN sys_signup.decided_by IS 'ผู้อนุมัติ/ไม่อนุมัติ (ว่าง = อนุมัติอัตโนมัติ)';
COMMENT ON COLUMN sys_signup.decided_at IS 'เวลาที่อนุมัติ/ไม่อนุมัติ';
COMMENT ON COLUMN sys_signup.reject_reason IS 'เหตุผลที่ไม่อนุมัติ';
COMMENT ON COLUMN sys_signup.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN sys_signup.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN sys_signup.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN sys_signup.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN sys_signup.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN sys_signup.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN sys_signup.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
ALTER TABLE sys_signup ADD CONSTRAINT fk_sys_signup_tenant_id FOREIGN KEY (tenant_id) REFERENCES sys_tenant(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_signup_tenant_id ON sys_signup (tenant_id);
ALTER TABLE sys_signup ADD CONSTRAINT fk_sys_signup_decided_by FOREIGN KEY (decided_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_signup_decided_by ON sys_signup (decided_by);
ALTER TABLE sys_signup ADD CONSTRAINT fk_sys_signup_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_signup_created_by ON sys_signup (created_by);
ALTER TABLE sys_signup ADD CONSTRAINT fk_sys_signup_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_signup_updated_by ON sys_signup (updated_by);
CREATE TRIGGER trg_sys_signup_ver BEFORE UPDATE ON sys_signup FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
