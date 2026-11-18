-- 0065 สาขาของลูกค้า + Bill to ในนามสาขา (เจ้าของ 18/11/2569 · HANDOFF 135)
-- "Bill to หมายถึงให้ออกบิลในนามบริษัทนั้น สาขาอื่นๆ ที่มี รวมถึงสถานที่ส่งของที่เป็นของสาขาๆ นั้นๆ" — ลูกหนี้ยังอยู่ที่รหัสลูกค้า
-- md_customer_branch ใหม่ (สำนักงานใหญ่ 00000 = ที่อยู่ในแฟ้มลูกค้า) · md_customer_ship_to.branch_no ผูกสถานที่ส่งของกับสาขา (ว่าง = ทุกสาขา) · ข้อมูลเดิมไม่เปลี่ยน
ALTER TABLE md_customer_ship_to ADD COLUMN branch_no varchar(5);
COMMENT ON COLUMN md_customer_ship_to.branch_no IS 'สาขาของลูกค้าที่สถานที่นี้สังกัด (ใหม่ — เจ้าของ 18/11/2569 · ว่าง = ใช้ได้ทุกสาขา)';
-- md_customer_branch: สาขาของลูกค้า — Bill to ออกใบกำกับในนามสาขา (ใหม่ — เจ้าของ 18/11/2569: สำนักงานสั่งสินค้าให้สาขา ออกบิลถึงสาขานั้นโดยตรง)
CREATE TABLE md_customer_branch (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  customer_id uuid NOT NULL,
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
COMMENT ON TABLE md_customer_branch IS 'สาขาของลูกค้า — Bill to ออกใบกำกับในนามสาขา (ใหม่ — เจ้าของ 18/11/2569: สำนักงานสั่งสินค้าให้สาขา ออกบิลถึงสาขานั้นโดยตรง) | ใบกำกับภาษี/รายงานภาษีขายใช้ชื่อลูกค้า + ที่อยู่และเลขที่สาขานี้ (snapshot ใน doc_header) · Express ไม่มีแฟ้มนี้ (Bill to ของ Express = รหัสลูกค้าอื่น)';
COMMENT ON COLUMN md_customer_branch.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN md_customer_branch.company_id IS 'บริษัท';
COMMENT ON COLUMN md_customer_branch.customer_id IS 'ลูกค้า (บริษัทเดียวกัน — ลูกหนี้ยังอยู่ที่รหัสลูกค้านี้)';
COMMENT ON COLUMN md_customer_branch.branch_no IS 'เลขที่สาขาตามกรมสรรพากร 5 หลัก (สำนักงานใหญ่ 00000 = ที่อยู่ในแฟ้มลูกค้า)';
COMMENT ON COLUMN md_customer_branch.name IS 'ชื่อสาขา เช่น สาขาเชียงใหม่';
COMMENT ON COLUMN md_customer_branch.address_1 IS 'ที่อยู่ 1';
COMMENT ON COLUMN md_customer_branch.address_2 IS 'ที่อยู่ 2';
COMMENT ON COLUMN md_customer_branch.address_3 IS 'ที่อยู่ 3';
COMMENT ON COLUMN md_customer_branch.zip_code IS 'รหัสไปรษณีย์';
COMMENT ON COLUMN md_customer_branch.addr_no IS 'ที่อยู่แยกช่อง: เลขที่';
COMMENT ON COLUMN md_customer_branch.addr_moo IS 'ที่อยู่แยกช่อง: หมู่ที่';
COMMENT ON COLUMN md_customer_branch.addr_village IS 'ที่อยู่แยกช่อง: หมู่บ้าน';
COMMENT ON COLUMN md_customer_branch.addr_building IS 'ที่อยู่แยกช่อง: อาคาร';
COMMENT ON COLUMN md_customer_branch.addr_room IS 'ที่อยู่แยกช่อง: ห้องเลขที่';
COMMENT ON COLUMN md_customer_branch.addr_floor IS 'ที่อยู่แยกช่อง: ชั้นที่';
COMMENT ON COLUMN md_customer_branch.addr_soi IS 'ที่อยู่แยกช่อง: ซอย';
COMMENT ON COLUMN md_customer_branch.addr_road IS 'ที่อยู่แยกช่อง: ถนน';
COMMENT ON COLUMN md_customer_branch.addr_geo_code IS 'ตำบล/แขวง รหัส 6 หลักกรมการปกครอง (จังหวัด/อำเภอได้จากรหัส · packages/core geo-th)';
COMMENT ON COLUMN md_customer_branch.phone IS 'โทรศัพท์';
COMMENT ON COLUMN md_customer_branch.contact IS 'ผู้ติดต่อ';
COMMENT ON COLUMN md_customer_branch.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN md_customer_branch.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN md_customer_branch.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN md_customer_branch.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN md_customer_branch.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN md_customer_branch.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN md_customer_branch.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_md_customer_branch_company_customer_branch_no ON md_customer_branch (company_id, COALESCE(customer_id, '00000000-0000-0000-0000-000000000000'::uuid), branch_no) WHERE deleted_at IS NULL;

ALTER TABLE md_customer_branch ADD CONSTRAINT fk_md_customer_branch_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_customer_branch_company_id ON md_customer_branch (company_id);
ALTER TABLE md_customer_branch ADD CONSTRAINT fk_md_customer_branch_customer_id FOREIGN KEY (customer_id) REFERENCES md_customer(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_customer_branch_customer_id ON md_customer_branch (customer_id);
ALTER TABLE md_customer_branch ADD CONSTRAINT fk_md_customer_branch_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_customer_branch_created_by ON md_customer_branch (created_by);
ALTER TABLE md_customer_branch ADD CONSTRAINT fk_md_customer_branch_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_customer_branch_updated_by ON md_customer_branch (updated_by);
CREATE TRIGGER trg_md_customer_branch_ver BEFORE UPDATE ON md_customer_branch FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_md_customer_branch_log AFTER INSERT OR UPDATE ON md_customer_branch FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_md_customer_branch_del AFTER DELETE ON md_customer_branch FOR EACH ROW EXECUTE FUNCTION sync_log_delete();
CREATE TRIGGER trg_md_customer_branch_rid BEFORE INSERT ON md_customer_branch FOR EACH ROW EXECUTE FUNCTION sync_row_id();
-- ข้อมูลของบริษัท: เห็นเฉพาะบริษัทที่เลือก (แบบ 0007)
ALTER TABLE md_customer_branch ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buddy_app') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON md_customer_branch TO buddy_app;
  CREATE POLICY buddy_company ON md_customer_branch TO buddy_app USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);
END IF; END $$;
