-- 0008 ลูกค้า/ผู้จำหน่าย/พนักงานขาย ครบทุกช่องตามคู่มือบทที่ 7 + ข้อเสนอ: หลายผู้ติดต่อ และบัญชีธนาคารผู้จำหน่าย

ALTER TABLE md_customer ADD COLUMN wht_category varchar(4);
COMMENT ON COLUMN md_customer.wht_category IS 'หมวดภาษีหัก ณ ที่จ่าย (ตาราง 55) [สันนิษฐาน] [Express: ARMAS.TAXGRP]';
ALTER TABLE md_customer ADD COLUMN wht_condition char(1);
COMMENT ON COLUMN md_customer.wht_condition IS 'เงื่อนไขการหักภาษี 1=หัก ณ ที่จ่าย 2=ออกให้ตลอดไป 3=ออกให้ครั้งเดียว [Express: ARMAS.TAXCOND]';
ALTER TABLE md_customer ADD COLUMN default_ship_to varchar(10);
COMMENT ON COLUMN md_customer.default_ship_to IS 'รหัสสถานที่ส่งของประจำ [Express: ARMAS.SHIPTO]';
ALTER TABLE md_customer ADD COLUMN track_sales char(1);
COMMENT ON COLUMN md_customer.track_sales IS 'ติดตามการขาย [สันนิษฐาน] [Express: ARMAS.TRACKSAL]';
ALTER TABLE md_salesperson ADD COLUMN zip_code varchar(10);
COMMENT ON COLUMN md_salesperson.zip_code IS 'รหัสไปรษณีย์ [Express: OESLM.ZIPCOD]';
CREATE TABLE md_party_contact (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  party_type char(1) NOT NULL CHECK (party_type IN ('C','S')),
  party_id uuid NOT NULL,
  line_no smallint NOT NULL,
  name varchar(120) NOT NULL,
  position varchar(60),
  phone varchar(60),
  email varchar(120),
  is_primary boolean DEFAULT false NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE md_party_contact IS 'ผู้ติดต่อของลูกค้า/ผู้จำหน่าย (ข้อเสนอ: หลายคน — Express มีช่องเดียว) | Express: (ใหม่) ARMAS/APMAS.CONTACT';
COMMENT ON COLUMN md_party_contact.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN md_party_contact.company_id IS 'บริษัท';
COMMENT ON COLUMN md_party_contact.party_type IS 'C=ลูกค้า S=ผู้จำหน่าย';
COMMENT ON COLUMN md_party_contact.party_id IS 'id ของลูกค้าหรือผู้จำหน่าย';
COMMENT ON COLUMN md_party_contact.line_no IS 'ลำดับ';
COMMENT ON COLUMN md_party_contact.name IS 'ชื่อผู้ติดต่อ';
COMMENT ON COLUMN md_party_contact.position IS 'ตำแหน่ง/หน้าที่ เช่น จัดซื้อ บัญชี';
COMMENT ON COLUMN md_party_contact.phone IS 'โทรศัพท์';
COMMENT ON COLUMN md_party_contact.email IS 'อีเมล';
COMMENT ON COLUMN md_party_contact.is_primary IS 'ผู้ติดต่อหลัก (แสดงในเอกสาร)';
COMMENT ON COLUMN md_party_contact.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN md_party_contact.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN md_party_contact.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN md_party_contact.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN md_party_contact.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN md_party_contact.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN md_party_contact.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_md_party_contact_company_party_type_party_line_no ON md_party_contact (company_id, party_type, party_id, line_no) WHERE deleted_at IS NULL;
ALTER TABLE md_party_contact ADD CONSTRAINT fk_md_party_contact_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_party_contact_company_id ON md_party_contact (company_id);
ALTER TABLE md_party_contact ADD CONSTRAINT fk_md_party_contact_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_party_contact_created_by ON md_party_contact (created_by);
ALTER TABLE md_party_contact ADD CONSTRAINT fk_md_party_contact_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_party_contact_updated_by ON md_party_contact (updated_by);
CREATE TRIGGER trg_md_party_contact_ver BEFORE UPDATE ON md_party_contact FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_md_party_contact_log AFTER INSERT OR UPDATE ON md_party_contact FOR EACH ROW EXECUTE FUNCTION sync_log_change();
ALTER TABLE md_party_contact ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buddy_app') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON md_party_contact TO buddy_app;
  CREATE POLICY buddy_company ON md_party_contact TO buddy_app USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);
END IF; END $$;
CREATE TABLE md_supplier_bank (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  supplier_id uuid NOT NULL,
  line_no smallint NOT NULL,
  bank_code varchar(10) NOT NULL,
  branch varchar(60),
  account_no varchar(20) NOT NULL,
  account_name varchar(120),
  is_default boolean DEFAULT false NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE md_supplier_bank IS 'บัญชีธนาคารของผู้จำหน่าย (ข้อเสนอ: ใช้โอนจ่ายชำระหนี้) | Express: (ใหม่)';
COMMENT ON COLUMN md_supplier_bank.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN md_supplier_bank.company_id IS 'บริษัท';
COMMENT ON COLUMN md_supplier_bank.supplier_id IS 'ผู้จำหน่าย';
COMMENT ON COLUMN md_supplier_bank.line_no IS 'ลำดับ';
COMMENT ON COLUMN md_supplier_bank.bank_code IS 'ธนาคาร (ตารางธนาคาร)';
COMMENT ON COLUMN md_supplier_bank.branch IS 'สาขา';
COMMENT ON COLUMN md_supplier_bank.account_no IS 'เลขที่บัญชี';
COMMENT ON COLUMN md_supplier_bank.account_name IS 'ชื่อบัญชี';
COMMENT ON COLUMN md_supplier_bank.is_default IS 'บัญชีที่ใช้โอนเป็นประจำ';
COMMENT ON COLUMN md_supplier_bank.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN md_supplier_bank.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN md_supplier_bank.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN md_supplier_bank.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN md_supplier_bank.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN md_supplier_bank.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN md_supplier_bank.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_md_supplier_bank_company_supplier_line_no ON md_supplier_bank (company_id, supplier_id, line_no) WHERE deleted_at IS NULL;
ALTER TABLE md_supplier_bank ADD CONSTRAINT fk_md_supplier_bank_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_supplier_bank_company_id ON md_supplier_bank (company_id);
ALTER TABLE md_supplier_bank ADD CONSTRAINT fk_md_supplier_bank_supplier_id FOREIGN KEY (supplier_id) REFERENCES md_supplier(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_supplier_bank_supplier_id ON md_supplier_bank (supplier_id);
ALTER TABLE md_supplier_bank ADD CONSTRAINT fk_md_supplier_bank_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_supplier_bank_created_by ON md_supplier_bank (created_by);
ALTER TABLE md_supplier_bank ADD CONSTRAINT fk_md_supplier_bank_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_supplier_bank_updated_by ON md_supplier_bank (updated_by);
CREATE TRIGGER trg_md_supplier_bank_ver BEFORE UPDATE ON md_supplier_bank FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_md_supplier_bank_log AFTER INSERT OR UPDATE ON md_supplier_bank FOR EACH ROW EXECUTE FUNCTION sync_log_change();
ALTER TABLE md_supplier_bank ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buddy_app') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON md_supplier_bank TO buddy_app;
  CREATE POLICY buddy_company ON md_supplier_bank TO buddy_app USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);
END IF; END $$;

-- Row-Level Security (T0.14) ครอบ view ด้วย: view ปกติทำงานด้วยสิทธิ์เจ้าของ (ข้าม RLS) — ให้ใช้สิทธิ์ของผู้เรียกแทน
DO $$
DECLARE v text;
BEGIN
  FOR v IN SELECT viewname FROM pg_views WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER VIEW %I SET (security_invoker = true)', v);
  END LOOP;
END $$;
