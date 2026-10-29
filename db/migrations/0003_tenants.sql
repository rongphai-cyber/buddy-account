-- 0003 หลายลูกค้าผู้ใช้บริการ (tenant): ลูกค้าแต่ละรายมีบริษัท ผู้ใช้ และกลุ่มผู้ใช้ของตัวเอง ข้อมูลแยกขาดจากกัน

-- sys_tenant: ลูกค้าผู้ใช้บริการ (tenant) — หนึ่งรายมีได้หลายบริษัท ข้อมูลแต่ละรายแยกขาดจากกัน — Buddy Account  [Express: (ใหม่)]
CREATE TABLE sys_tenant (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  code varchar(20) NOT NULL,
  name varchar(120) NOT NULL,
  contact_email varchar(120),
  contact_phone varchar(60),
  plan varchar(20) DEFAULT 'standard' NOT NULL,
  max_companies integer,
  max_users integer,
  expires_on date,
  status char(1) DEFAULT 'A' NOT NULL CHECK (status IN ('A','S','I')),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE sys_tenant IS 'ลูกค้าผู้ใช้บริการ (tenant) — หนึ่งรายมีได้หลายบริษัท ข้อมูลแต่ละรายแยกขาดจากกัน — Buddy Account | Express: (ใหม่)';
COMMENT ON COLUMN sys_tenant.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN sys_tenant.code IS 'รหัสลูกค้าผู้ใช้บริการ';
COMMENT ON COLUMN sys_tenant.name IS 'ชื่อลูกค้าผู้ใช้บริการ (เจ้าของบัญชี)';
COMMENT ON COLUMN sys_tenant.contact_email IS 'อีเมลผู้ติดต่อ';
COMMENT ON COLUMN sys_tenant.contact_phone IS 'โทรศัพท์ผู้ติดต่อ';
COMMENT ON COLUMN sys_tenant.plan IS 'แพ็กเกจ';
COMMENT ON COLUMN sys_tenant.max_companies IS 'จำนวนบริษัทสูงสุด (ว่าง = ไม่จำกัด)';
COMMENT ON COLUMN sys_tenant.max_users IS 'จำนวนผู้ใช้สูงสุด (ว่าง = ไม่จำกัด)';
COMMENT ON COLUMN sys_tenant.expires_on IS 'วันหมดอายุการใช้งาน';
COMMENT ON COLUMN sys_tenant.status IS 'A=ใช้งาน S=ระงับ I=เลิกใช้';
COMMENT ON COLUMN sys_tenant.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN sys_tenant.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN sys_tenant.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN sys_tenant.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN sys_tenant.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN sys_tenant.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN sys_tenant.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_sys_tenant_code ON sys_tenant (code) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_sys_tenant_ver BEFORE UPDATE ON sys_tenant FOR EACH ROW EXECUTE FUNCTION sys_bump_version();

ALTER TABLE sys_company ADD COLUMN tenant_id uuid;
ALTER TABLE sys_user ADD COLUMN tenant_id uuid;
ALTER TABLE sys_user_group ADD COLUMN tenant_id uuid;
-- บริษัทที่มีอยู่แล้ว (ติดตั้งเดิม/นำเข้าจาก Express) อยู่ในลูกค้าเริ่มต้นรายเดียว; ผู้ใช้เดิมกลุ่ม ADMIN เป็นผู้ดูแลระบบของผู้ให้บริการ
INSERT INTO sys_tenant (code, name) SELECT 'DEFAULT', 'ลูกค้าเริ่มต้น' WHERE EXISTS (SELECT 1 FROM sys_company) OR EXISTS (SELECT 1 FROM sys_user);
UPDATE sys_company SET tenant_id = (SELECT id FROM sys_tenant WHERE code = 'DEFAULT') WHERE tenant_id IS NULL;
UPDATE sys_user u SET tenant_id = (SELECT id FROM sys_tenant WHERE code = 'DEFAULT') WHERE tenant_id IS NULL AND NOT EXISTS (SELECT 1 FROM sys_user_group g WHERE g.id = u.user_group_id AND g.code = 'ADMIN');
ALTER TABLE sys_company ALTER COLUMN tenant_id SET NOT NULL;
DROP INDEX IF EXISTS uq_sys_user_group_code;
CREATE UNIQUE INDEX uq_sys_user_group_tenant_code ON sys_user_group (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), code) WHERE deleted_at IS NULL;
COMMENT ON COLUMN sys_company.tenant_id IS 'ลูกค้าผู้ใช้บริการที่เป็นเจ้าของบริษัทนี้';
COMMENT ON COLUMN sys_user.tenant_id IS 'ลูกค้าผู้ใช้บริการที่ผู้ใช้สังกัด (ว่าง = เจ้าหน้าที่ผู้ให้บริการโปรแกรม)';
COMMENT ON COLUMN sys_user_group.tenant_id IS 'ลูกค้าผู้ใช้บริการ (ว่าง = กลุ่มของผู้ให้บริการ)';
ALTER TABLE sys_company ADD CONSTRAINT fk_sys_company_tenant_id FOREIGN KEY (tenant_id) REFERENCES sys_tenant(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_company_tenant_id ON sys_company (tenant_id);
ALTER TABLE sys_user ADD CONSTRAINT fk_sys_user_tenant_id FOREIGN KEY (tenant_id) REFERENCES sys_tenant(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_user_tenant_id ON sys_user (tenant_id);
ALTER TABLE sys_user_group ADD CONSTRAINT fk_sys_user_group_tenant_id FOREIGN KEY (tenant_id) REFERENCES sys_tenant(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_user_group_tenant_id ON sys_user_group (tenant_id);
