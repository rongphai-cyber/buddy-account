-- HANDOFF 185: แพ็กเกจบริการ + ขีดจำกัดการใช้งานของลูกค้า (เจ้าของ 25/11/2569 แบบ A เอกสาร+ไฟล์)
-- ลูกค้าเดิมไม่มีแพ็กเกจ = ไม่จำกัด (ไม่แก้ข้อมูลเดิม) จนกว่าผู้ให้บริการจะกำหนด
CREATE TABLE sys_package (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  code varchar(20) NOT NULL,
  name_th varchar(120) NOT NULL,
  price_year numeric(18,2) DEFAULT 0 NOT NULL,
  max_companies integer,
  max_users integer,
  docs_per_month integer,
  file_quota_mb integer,
  ai_per_month integer,
  over_company_year numeric(18,2) DEFAULT 0 NOT NULL,
  over_user_year numeric(18,2) DEFAULT 0 NOT NULL,
  over_doc numeric(18,2) DEFAULT 0 NOT NULL,
  over_file_gb_month numeric(18,2) DEFAULT 0 NOT NULL,
  over_ai numeric(18,2) DEFAULT 0 NOT NULL,
  status char(1) DEFAULT 'A' NOT NULL CHECK (status IN ('A','I')),
  sort_order integer DEFAULT 0 NOT NULL,
  remark varchar(200),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE sys_package IS 'แพ็กเกจบริการ (HANDOFF 185 · เจ้าของ 25/11/2569 แบบ A เอกสาร+ไฟล์) — ราคาต่อปี ไม่รวม VAT · ขีดจำกัดบริษัท ผู้ใช้ เอกสาร/เดือน พื้นที่ไฟล์ AI/เดือน + อัตราส่วนเกิน · ผู้ให้บริการแก้/เพิ่มได้ · อยู่เฉพาะเซิร์ฟเวอร์ | Express: (ใหม่)';
COMMENT ON COLUMN sys_package.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN sys_package.code IS 'รหัสแพ็กเกจ';
COMMENT ON COLUMN sys_package.name_th IS 'ชื่อแพ็กเกจ';
COMMENT ON COLUMN sys_package.price_year IS 'ราคาต่อปี (บาท ไม่รวม VAT)';
COMMENT ON COLUMN sys_package.max_companies IS 'จำนวนบริษัทสูงสุด (ว่าง = ไม่จำกัด)';
COMMENT ON COLUMN sys_package.max_users IS 'จำนวนผู้ใช้สูงสุด (ว่าง = ไม่จำกัด)';
COMMENT ON COLUMN sys_package.docs_per_month IS 'เอกสารต่อเดือน (ว่าง = ไม่จำกัด · เกินแล้วคิดส่วนเกิน ไม่หยุด)';
COMMENT ON COLUMN sys_package.file_quota_mb IS 'พื้นที่ไฟล์ (MB · ว่าง = ไม่จำกัด)';
COMMENT ON COLUMN sys_package.ai_per_month IS 'อ่านบิลด้วย AI ต่อเดือน (ว่าง = ไม่จำกัด)';
COMMENT ON COLUMN sys_package.over_company_year IS 'ส่วนเกิน: บริษัทเพิ่ม บาทต่อปี';
COMMENT ON COLUMN sys_package.over_user_year IS 'ส่วนเกิน: ผู้ใช้เพิ่ม บาทต่อปี';
COMMENT ON COLUMN sys_package.over_doc IS 'ส่วนเกิน: บาทต่อเอกสาร';
COMMENT ON COLUMN sys_package.over_file_gb_month IS 'ส่วนเกิน: บาทต่อ GB ต่อเดือน';
COMMENT ON COLUMN sys_package.over_ai IS 'ส่วนเกิน: บาทต่อบิลที่อ่านด้วย AI';
COMMENT ON COLUMN sys_package.status IS 'A=ใช้ได้ I=เลิกขาย (ลูกค้าเดิมยังใช้ต่อ)';
COMMENT ON COLUMN sys_package.sort_order IS 'ลำดับแสดง';
COMMENT ON COLUMN sys_package.remark IS 'หมายเหตุ';
COMMENT ON COLUMN sys_package.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN sys_package.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN sys_package.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN sys_package.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN sys_package.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN sys_package.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN sys_package.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_sys_package_code ON sys_package (code) WHERE deleted_at IS NULL;
ALTER TABLE sys_package ADD CONSTRAINT fk_sys_package_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_package_created_by ON sys_package (created_by);
ALTER TABLE sys_package ADD CONSTRAINT fk_sys_package_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_package_updated_by ON sys_package (updated_by);
CREATE TRIGGER trg_sys_package_ver BEFORE UPDATE ON sys_package FOR EACH ROW EXECUTE FUNCTION sys_bump_version();

ALTER TABLE sys_tenant ADD COLUMN package_id uuid;
ALTER TABLE sys_tenant ADD COLUMN docs_per_month integer;
ALTER TABLE sys_tenant ADD COLUMN file_quota_mb integer;
ALTER TABLE sys_tenant ADD COLUMN ai_per_month integer;
ALTER TABLE sys_tenant ADD COLUMN over_action char(1) DEFAULT 'W' NOT NULL CHECK (over_action IN ('W','S'));
COMMENT ON COLUMN sys_tenant.package_id IS 'แพ็กเกจบริการ (HANDOFF 185 · ว่าง = ไม่มีแพ็กเกจ ไม่จำกัด · max_companies/max_users ของลูกค้า = ค่าที่ทับแพ็กเกจ)';
COMMENT ON COLUMN sys_tenant.docs_per_month IS 'เอกสารต่อเดือนของลูกค้านี้ (ว่าง = ตามแพ็กเกจ)';
COMMENT ON COLUMN sys_tenant.file_quota_mb IS 'พื้นที่ไฟล์ MB ของลูกค้านี้ (ว่าง = ตามแพ็กเกจ)';
COMMENT ON COLUMN sys_tenant.ai_per_month IS 'อ่านบิลด้วย AI ต่อเดือนของลูกค้านี้ (ว่าง = ตามแพ็กเกจ)';
COMMENT ON COLUMN sys_tenant.over_action IS 'ไฟล์/AI ครบ 100%: W=เตือนและคิดเงินส่วนเกิน S=หยุด (เอกสารไม่หยุดเด็ดขาด)';
ALTER TABLE sys_tenant ADD CONSTRAINT fk_sys_tenant_package_id FOREIGN KEY (package_id) REFERENCES sys_package(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_tenant_package_id ON sys_tenant (package_id);

DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buddy_app') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON sys_package TO buddy_app;
END IF; END $$;

-- แพ็กเกจตั้งต้น 4 แบบ (ต่อปี ไม่รวม VAT · ไฟล์เป็น MB) — ผู้ให้บริการแก้/เพิ่มได้ที่หน้าจอ
INSERT INTO sys_package (code, name_th, price_year, max_companies, max_users, docs_per_month, file_quota_mb, ai_per_month, over_company_year, over_user_year, over_doc, over_file_gb_month, over_ai, sort_order) VALUES
  ('START', 'เริ่มต้น', 3900, 1, 3, 500, 2048, 50, 900, 600, 0.50, 20, 2.00, 1),
  ('STANDARD', 'มาตรฐาน', 5900, 1, 5, 2000, 5120, 100, 900, 600, 0.50, 20, 2.00, 2),
  ('PRO', 'มืออาชีพ', 9900, 3, 10, 5000, 10240, 300, 900, 600, 0.50, 20, 2.00, 3),
  ('OFFICE', 'สำนักงานบัญชี', 24000, 20, 10, 20000, 30720, 1000, 900, 600, 0.50, 20, 2.00, 4);
