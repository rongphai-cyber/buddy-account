-- 0074 ประวัติที่อยู่ของกิจการ (สำนักงานใหญ่/สาขา) ตามวันที่มีผล (HANDOFF 180 · เจ้าของ 24/11/2569)
-- "ปี 2567 ใช้ที่ 303 … ปี 2568 เป็น 340 … เอกสารแต่ละช่วงเวลาจะต้องออกให้ถูกต้อง" — เอกสารพิมพ์ที่อยู่ที่มีผล ณ วันที่เอกสาร
-- ที่อยู่ปัจจุบันของทุกบริษัท/สาขาเป็นแถวแรก (มีผลตั้งแต่ต้นปีบัญชีแรกของบริษัท) — เอกสารเดิมพิมพ์ที่อยู่เหมือนเดิม
CREATE TABLE sys_address_history (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  branch_id uuid,
  effective_from date NOT NULL,
  address_th text,
  address_en text,
  zip_code varchar(5),
  addr_no varchar(20),
  addr_moo varchar(20),
  addr_village varchar(100),
  addr_building varchar(40),
  addr_room varchar(20),
  addr_floor varchar(20),
  addr_soi varchar(100),
  addr_road varchar(100),
  addr_geo_code varchar(6),
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
COMMENT ON TABLE sys_address_history IS 'ประวัติที่อยู่ของกิจการ (สำนักงานใหญ่/สาขา) ตามวันที่มีผล — เอกสารพิมพ์ที่อยู่ที่มีผล ณ วันที่เอกสาร (HANDOFF 180 · เจ้าของ 24/11/2569 "ปี 2567 ใช้ที่ 303 … ปี 2568 เป็น 340 … เอกสารแต่ละช่วงเวลาจะต้องออกให้ถูกต้อง") | Express: (ใหม่) — Express มีที่อยู่ชุดเดียวใน ISINFO | ที่อยู่ ณ วันที่ = แถวที่ effective_from มากที่สุดที่ไม่เกินวันนั้น (ก่อนแถวแรก = แถวแรก) · สาขาที่ไม่มีประวัติใช้ของสำนักงานใหญ่ · ช่องที่อยู่ใน sys_company/sys_branch = ที่อยู่ที่มีผลวันนี้ (แก้ที่หน้าจอเดิม = แก้แถวที่มีผลวันนี้)';
COMMENT ON COLUMN sys_address_history.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN sys_address_history.company_id IS 'บริษัท';
COMMENT ON COLUMN sys_address_history.branch_id IS 'สาขา (ว่าง = ที่อยู่ของบริษัท/สำนักงานใหญ่)';
COMMENT ON COLUMN sys_address_history.effective_from IS 'มีผลตั้งแต่วันที่';
COMMENT ON COLUMN sys_address_history.address_th IS 'ที่อยู่ภาษาไทยที่พิมพ์ในเอกสาร (บรรทัด 1–2 คั่นด้วยขึ้นบรรทัดใหม่ · สาขา = ที่อยู่สาขา)';
COMMENT ON COLUMN sys_address_history.address_en IS 'ที่อยู่ภาษาอังกฤษที่พิมพ์ในเอกสาร (บรรทัด 1–2)';
COMMENT ON COLUMN sys_address_history.zip_code IS 'รหัสไปรษณีย์';
COMMENT ON COLUMN sys_address_history.addr_no IS 'ที่อยู่แยกช่อง: เลขที่';
COMMENT ON COLUMN sys_address_history.addr_moo IS 'ที่อยู่แยกช่อง: หมู่ที่';
COMMENT ON COLUMN sys_address_history.addr_village IS 'ที่อยู่แยกช่อง: หมู่บ้าน';
COMMENT ON COLUMN sys_address_history.addr_building IS 'ที่อยู่แยกช่อง: อาคาร';
COMMENT ON COLUMN sys_address_history.addr_room IS 'ที่อยู่แยกช่อง: ห้องเลขที่';
COMMENT ON COLUMN sys_address_history.addr_floor IS 'ที่อยู่แยกช่อง: ชั้นที่';
COMMENT ON COLUMN sys_address_history.addr_soi IS 'ที่อยู่แยกช่อง: ซอย';
COMMENT ON COLUMN sys_address_history.addr_road IS 'ที่อยู่แยกช่อง: ถนน';
COMMENT ON COLUMN sys_address_history.addr_geo_code IS 'ตำบล/แขวง รหัส 6 หลักกรมการปกครอง (จังหวัด/อำเภอได้จากรหัส · packages/core geo-th)';
COMMENT ON COLUMN sys_address_history.remark IS 'หมายเหตุ เช่น ย้ายสำนักงาน';
COMMENT ON COLUMN sys_address_history.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN sys_address_history.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN sys_address_history.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN sys_address_history.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN sys_address_history.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN sys_address_history.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN sys_address_history.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE INDEX ix_sys_address_history_company_branch_effective_from ON sys_address_history (company_id, branch_id, effective_from);
ALTER TABLE sys_address_history ADD CONSTRAINT fk_sys_address_history_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_address_history_company_id ON sys_address_history (company_id);
ALTER TABLE sys_address_history ADD CONSTRAINT fk_sys_address_history_branch_id FOREIGN KEY (branch_id) REFERENCES sys_branch(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_address_history_branch_id ON sys_address_history (branch_id);
ALTER TABLE sys_address_history ADD CONSTRAINT fk_sys_address_history_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_address_history_created_by ON sys_address_history (created_by);
ALTER TABLE sys_address_history ADD CONSTRAINT fk_sys_address_history_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_address_history_updated_by ON sys_address_history (updated_by);
CREATE TRIGGER trg_sys_address_history_ver BEFORE UPDATE ON sys_address_history FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_sys_address_history_log AFTER INSERT OR UPDATE ON sys_address_history FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_sys_address_history_del AFTER DELETE ON sys_address_history FOR EACH ROW EXECUTE FUNCTION sync_log_delete();
CREATE TRIGGER trg_sys_address_history_rid BEFORE INSERT ON sys_address_history FOR EACH ROW EXECUTE FUNCTION sync_row_id();

-- ข้อมูลของบริษัท: เห็นเฉพาะบริษัทที่เลือก (แบบ 0007)
ALTER TABLE sys_address_history ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buddy_app') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON sys_address_history TO buddy_app;
  CREATE POLICY buddy_company ON sys_address_history TO buddy_app USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);
END IF; END $$;

-- แถวแรก: ที่อยู่ปัจจุบันของบริษัท (สำนักงานใหญ่) และของสาขาที่มีที่อยู่ — มีผลตั้งแต่ต้นปีบัญชีแรก (ไม่มีปีบัญชี = วันที่สร้างบริษัท)
INSERT INTO sys_address_history (company_id, branch_id, effective_from, address_th, address_en, zip_code, addr_no, addr_moo, addr_village, addr_building, addr_room, addr_floor, addr_soi, addr_road, addr_geo_code)
SELECT c.id, NULL, coalesce((SELECT min(y.start_date) FROM gl_fiscal_year y WHERE y.company_id = c.id AND y.deleted_at IS NULL), c.created_at::date),
       c.address_th, c.address_en, c.zip_code, c.addr_no, c.addr_moo, c.addr_village, c.addr_building, c.addr_room, c.addr_floor, c.addr_soi, c.addr_road, c.addr_geo_code
  FROM sys_company c WHERE c.deleted_at IS NULL;
INSERT INTO sys_address_history (company_id, branch_id, effective_from, address_th, zip_code, addr_no, addr_moo, addr_village, addr_building, addr_room, addr_floor, addr_soi, addr_road, addr_geo_code)
SELECT b.company_id, b.id, coalesce((SELECT min(y.start_date) FROM gl_fiscal_year y WHERE y.company_id = b.company_id AND y.deleted_at IS NULL), b.created_at::date),
       b.address, b.zip_code, b.addr_no, b.addr_moo, b.addr_village, b.addr_building, b.addr_room, b.addr_floor, b.addr_soi, b.addr_road, b.addr_geo_code
  FROM sys_branch b WHERE b.deleted_at IS NULL AND NOT b.is_head_office AND coalesce(trim(b.address), '') <> '';
