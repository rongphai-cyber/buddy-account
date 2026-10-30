-- T0.17 PDPA: ทะเบียนคำขอของเจ้าของข้อมูล + วันที่ลงนาม DPA / เลิกใช้บริการ / ลบข้อมูลของลูกค้าผู้ใช้บริการ
ALTER TABLE sys_tenant ADD COLUMN dpa_signed_on date;
ALTER TABLE sys_tenant ADD COLUMN terminated_on date;
ALTER TABLE sys_tenant ADD COLUMN purge_after date;
ALTER TABLE sys_tenant ADD COLUMN purged_at timestamptz;
COMMENT ON COLUMN sys_tenant.dpa_signed_on IS 'วันที่ลงนามข้อตกลงการประมวลผลข้อมูลส่วนบุคคล (DPA) กับผู้ให้บริการ (T0.17)';
COMMENT ON COLUMN sys_tenant.terminated_on IS 'วันที่เลิกใช้บริการ (ตั้งเมื่อเปลี่ยนสถานะเป็น I)';
COMMENT ON COLUMN sys_tenant.purge_after IS 'ลบข้อมูลได้ตั้งแต่วันนี้ (เลิกใช้บริการ + 90 วัน ให้ลูกค้าขอสำเนาข้อมูลก่อน)';
COMMENT ON COLUMN sys_tenant.purged_at IS 'ลบข้อมูลทั้งหมดของลูกค้าแล้วเมื่อ (เหลือเฉพาะรหัสและแฟ้มบันทึกเหตุการณ์)';
CREATE TABLE sys_pdpa_request (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  request_type varchar(10) NOT NULL CHECK (request_type IN ('ACCESS','PORT','RECTIFY','ERASE','OBJECT')),
  subject_type varchar(10) NOT NULL CHECK (subject_type IN ('CUSTOMER','SUPPLIER','SALESPERSON','CONTACT')),
  subject_id uuid,
  subject_code varchar(20),
  received_on date NOT NULL,
  status char(1) DEFAULT 'D' NOT NULL CHECK (status IN ('O','D','R')),
  erase_mode varchar(10),
  reason varchar(200),
  result jsonb,
  completed_on date,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE sys_pdpa_request IS 'ทะเบียนคำขอของเจ้าของข้อมูลส่วนบุคคล (PDPA ม.30–36, บันทึกตาม ม.39) — ขอดู/ขอสำเนา ขอแก้ ขอลบ ขอคัดค้าน และผลการดำเนินการ (T0.17) | Express: (ใหม่)';
COMMENT ON COLUMN sys_pdpa_request.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN sys_pdpa_request.company_id IS 'บริษัท';
COMMENT ON COLUMN sys_pdpa_request.request_type IS 'ACCESS=ขอดู/ขอรับสำเนา PORT=ขอโอนย้าย RECTIFY=ขอแก้ไข ERASE=ขอลบ/ทำให้ไม่ระบุตัวตน OBJECT=คัดค้าน/ระงับใช้';
COMMENT ON COLUMN sys_pdpa_request.subject_type IS 'CUSTOMER SUPPLIER SALESPERSON CONTACT';
COMMENT ON COLUMN sys_pdpa_request.subject_id IS 'id ของเจ้าของข้อมูล (ลูกค้า/ผู้จำหน่าย/พนักงานขาย/ผู้ติดต่อ)';
COMMENT ON COLUMN sys_pdpa_request.subject_code IS 'รหัสของเจ้าของข้อมูล (ไม่เก็บชื่อ — ทะเบียนนี้ต้องไม่เป็นที่เก็บข้อมูลส่วนบุคคลเสียเอง)';
COMMENT ON COLUMN sys_pdpa_request.received_on IS 'วันที่ได้รับคำขอ';
COMMENT ON COLUMN sys_pdpa_request.status IS 'O=รอดำเนินการ D=ดำเนินการแล้ว R=ปฏิเสธ';
COMMENT ON COLUMN sys_pdpa_request.erase_mode IS 'การลบที่ทำ: CONTACT=ลบข้อมูลติดต่อ FULL=ปิดบังทั้งหมด';
COMMENT ON COLUMN sys_pdpa_request.reason IS 'เหตุผล (เช่น เหตุที่ปฏิเสธ: ต้องเก็บเอกสารบัญชี/ภาษี 5 ปี)';
COMMENT ON COLUMN sys_pdpa_request.result IS 'สิ่งที่ดำเนินการ (ชื่อช่อง/จำนวนแถว — ไม่เก็บค่าข้อมูล)';
COMMENT ON COLUMN sys_pdpa_request.completed_on IS 'วันที่ดำเนินการเสร็จ/แจ้งผล';
COMMENT ON COLUMN sys_pdpa_request.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN sys_pdpa_request.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN sys_pdpa_request.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN sys_pdpa_request.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN sys_pdpa_request.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN sys_pdpa_request.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN sys_pdpa_request.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE INDEX ix_sys_pdpa_request_company_received_on ON sys_pdpa_request (company_id, received_on);
ALTER TABLE sys_pdpa_request ADD CONSTRAINT fk_sys_pdpa_request_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_pdpa_request_company_id ON sys_pdpa_request (company_id);
ALTER TABLE sys_pdpa_request ADD CONSTRAINT fk_sys_pdpa_request_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_pdpa_request_created_by ON sys_pdpa_request (created_by);
ALTER TABLE sys_pdpa_request ADD CONSTRAINT fk_sys_pdpa_request_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_pdpa_request_updated_by ON sys_pdpa_request (updated_by);
CREATE TRIGGER trg_sys_pdpa_request_ver BEFORE UPDATE ON sys_pdpa_request FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
ALTER TABLE sys_pdpa_request ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buddy_app') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON sys_pdpa_request TO buddy_app;
  CREATE POLICY buddy_company ON sys_pdpa_request TO buddy_app USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);
END IF; END $$;
