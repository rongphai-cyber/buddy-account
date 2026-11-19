-- 0066 สาขาของผู้จำหน่าย (เจ้าของ 19/11/2569 · HANDOFF 144)
-- "กรณีเลขผู้เสียภาษีเดียวกัน แต่คนละสาขา ให้เพิ่ม สาขาในฐานข้อมูลเจ้าหนี้รายนั้นๆ" — เจ้าหนี้ยังอยู่ที่รหัสผู้จำหน่าย · เอกสารซื้อเก็บเลขที่/ที่อยู่สาขาที่ออกบิล (doc_header snapshot เดิม) · ข้อมูลเดิมไม่เปลี่ยน
CREATE TABLE md_supplier_branch (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  supplier_id uuid NOT NULL,
  branch_no varchar(5) NOT NULL,
  name varchar(120) NOT NULL,
  address_1 varchar(100),
  address_2 varchar(100),
  address_3 varchar(100),
  zip_code varchar(10),
  addr_no varchar(20),
  addr_moo varchar(20),
  addr_village varchar(100),
  addr_building varchar(40),
  addr_room varchar(20),
  addr_floor varchar(20),
  addr_soi varchar(100),
  addr_road varchar(100),
  addr_geo_code varchar(6),
  phone varchar(60),
  contact varchar(60),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE md_supplier_branch IS 'สาขาของผู้จำหน่าย — บิลที่ออกจากสาขา (ใหม่ — เจ้าของ 19/11/2569: เลขผู้เสียภาษีเดียวกันคนละสาขา ให้เพิ่มสาขาในเจ้าหนี้รายนั้น ไม่สร้างเจ้าหนี้ซ้ำ) | เอกสารซื้อ/ค่าใช้จ่ายเก็บเลขที่สาขาและที่อยู่ของสาขาที่ออกบิล (snapshot ใน doc_header) → ภาษีซื้อใช้สาขานี้ · Express ไม่มีแฟ้มนี้';
COMMENT ON COLUMN md_supplier_branch.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN md_supplier_branch.company_id IS 'บริษัท';
COMMENT ON COLUMN md_supplier_branch.supplier_id IS 'ผู้จำหน่าย (บริษัทเดียวกัน — เจ้าหนี้ยังอยู่ที่รหัสผู้จำหน่ายนี้)';
COMMENT ON COLUMN md_supplier_branch.branch_no IS 'เลขที่สาขาตามกรมสรรพากร 5 หลัก (สาขาตามแฟ้มผู้จำหน่าย = ที่อยู่ในแฟ้มผู้จำหน่าย)';
COMMENT ON COLUMN md_supplier_branch.name IS 'ชื่อสาขา เช่น สาขาเชียงใหม่';
COMMENT ON COLUMN md_supplier_branch.address_1 IS 'ที่อยู่ 1';
COMMENT ON COLUMN md_supplier_branch.address_2 IS 'ที่อยู่ 2';
COMMENT ON COLUMN md_supplier_branch.address_3 IS 'ที่อยู่ 3';
COMMENT ON COLUMN md_supplier_branch.zip_code IS 'รหัสไปรษณีย์';
COMMENT ON COLUMN md_supplier_branch.addr_no IS 'ที่อยู่แยกช่อง: เลขที่';
COMMENT ON COLUMN md_supplier_branch.addr_moo IS 'ที่อยู่แยกช่อง: หมู่ที่';
COMMENT ON COLUMN md_supplier_branch.addr_village IS 'ที่อยู่แยกช่อง: หมู่บ้าน';
COMMENT ON COLUMN md_supplier_branch.addr_building IS 'ที่อยู่แยกช่อง: อาคาร';
COMMENT ON COLUMN md_supplier_branch.addr_room IS 'ที่อยู่แยกช่อง: ห้องเลขที่';
COMMENT ON COLUMN md_supplier_branch.addr_floor IS 'ที่อยู่แยกช่อง: ชั้นที่';
COMMENT ON COLUMN md_supplier_branch.addr_soi IS 'ที่อยู่แยกช่อง: ซอย';
COMMENT ON COLUMN md_supplier_branch.addr_road IS 'ที่อยู่แยกช่อง: ถนน';
COMMENT ON COLUMN md_supplier_branch.addr_geo_code IS 'ตำบล/แขวง รหัส 6 หลักกรมการปกครอง (จังหวัด/อำเภอได้จากรหัส · packages/core geo-th)';
COMMENT ON COLUMN md_supplier_branch.phone IS 'โทรศัพท์';
COMMENT ON COLUMN md_supplier_branch.contact IS 'ผู้ติดต่อ';
COMMENT ON COLUMN md_supplier_branch.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN md_supplier_branch.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN md_supplier_branch.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN md_supplier_branch.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN md_supplier_branch.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN md_supplier_branch.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN md_supplier_branch.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_md_supplier_branch_company_supplier_branch_no ON md_supplier_branch (company_id, supplier_id, branch_no) WHERE deleted_at IS NULL;

ALTER TABLE md_supplier_branch ADD CONSTRAINT fk_md_supplier_branch_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_supplier_branch_company_id ON md_supplier_branch (company_id);
ALTER TABLE md_supplier_branch ADD CONSTRAINT fk_md_supplier_branch_supplier_id FOREIGN KEY (supplier_id) REFERENCES md_supplier(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_supplier_branch_supplier_id ON md_supplier_branch (supplier_id);
ALTER TABLE md_supplier_branch ADD CONSTRAINT fk_md_supplier_branch_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_supplier_branch_created_by ON md_supplier_branch (created_by);
ALTER TABLE md_supplier_branch ADD CONSTRAINT fk_md_supplier_branch_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_supplier_branch_updated_by ON md_supplier_branch (updated_by);
CREATE TRIGGER trg_md_supplier_branch_ver BEFORE UPDATE ON md_supplier_branch FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_md_supplier_branch_log AFTER INSERT OR UPDATE ON md_supplier_branch FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_md_supplier_branch_del AFTER DELETE ON md_supplier_branch FOR EACH ROW EXECUTE FUNCTION sync_log_delete();
CREATE TRIGGER trg_md_supplier_branch_rid BEFORE INSERT ON md_supplier_branch FOR EACH ROW EXECUTE FUNCTION sync_row_id();
-- ข้อมูลของบริษัท: เห็นเฉพาะบริษัทที่เลือก (แบบ 0007)
ALTER TABLE md_supplier_branch ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buddy_app') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON md_supplier_branch TO buddy_app;
  CREATE POLICY buddy_company ON md_supplier_branch TO buddy_app USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);
END IF; END $$;
