-- ระบบเงินเดือน ระยะ 2 (03/11/2569): เลขที่หนังสือรับรอง 50 ทวิ ประจำปีของพนักงาน
CREATE TABLE pay_wht_cert (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  tax_year smallint NOT NULL,
  book_no varchar(20) NOT NULL,
  run_no integer NOT NULL,
  issue_date date NOT NULL,
  print_count smallint DEFAULT 0 NOT NULL,
  last_printed_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE pay_wht_cert IS 'เลขที่หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ) ประจำปีของพนักงาน — ออกครั้งเดียวเก็บถาวร (ยอดคำนวณสดจากรอบเงินเดือนที่บันทึกแล้ว) | Express: (ใหม่)';
COMMENT ON COLUMN pay_wht_cert.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN pay_wht_cert.company_id IS 'บริษัท';
COMMENT ON COLUMN pay_wht_cert.employee_id IS 'พนักงาน';
COMMENT ON COLUMN pay_wht_cert.tax_year IS 'ปีภาษี (ค.ศ.)';
COMMENT ON COLUMN pay_wht_cert.book_no IS 'เล่มที่ (ปี พ.ศ. ที่ออก)';
COMMENT ON COLUMN pay_wht_cert.run_no IS 'เลขที่ (ลำดับในเล่ม)';
COMMENT ON COLUMN pay_wht_cert.issue_date IS 'วันที่ออก (31 ธ.ค. หรือวันที่ออกจากงาน)';
COMMENT ON COLUMN pay_wht_cert.print_count IS 'จำนวนครั้งที่พิมพ์';
COMMENT ON COLUMN pay_wht_cert.last_printed_at IS 'พิมพ์ล่าสุด';
COMMENT ON COLUMN pay_wht_cert.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN pay_wht_cert.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN pay_wht_cert.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN pay_wht_cert.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN pay_wht_cert.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN pay_wht_cert.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN pay_wht_cert.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_pay_wht_cert_employee_tax_year ON pay_wht_cert (employee_id, tax_year) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_pay_wht_cert_company_book_no_run_no ON pay_wht_cert (company_id, book_no, run_no) WHERE deleted_at IS NULL;
ALTER TABLE pay_wht_cert ADD CONSTRAINT fk_pay_wht_cert_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_wht_cert_company_id ON pay_wht_cert (company_id);
ALTER TABLE pay_wht_cert ADD CONSTRAINT fk_pay_wht_cert_employee_id FOREIGN KEY (employee_id) REFERENCES pay_employee(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_wht_cert_employee_id ON pay_wht_cert (employee_id);
ALTER TABLE pay_wht_cert ADD CONSTRAINT fk_pay_wht_cert_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_wht_cert_created_by ON pay_wht_cert (created_by);
ALTER TABLE pay_wht_cert ADD CONSTRAINT fk_pay_wht_cert_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_wht_cert_updated_by ON pay_wht_cert (updated_by);
CREATE TRIGGER trg_pay_wht_cert_ver BEFORE UPDATE ON pay_wht_cert FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_pay_wht_cert_log AFTER INSERT OR UPDATE ON pay_wht_cert FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_pay_wht_cert_del AFTER DELETE ON pay_wht_cert FOR EACH ROW EXECUTE FUNCTION sync_log_delete();
CREATE TRIGGER trg_pay_wht_cert_rid BEFORE INSERT ON pay_wht_cert FOR EACH ROW EXECUTE FUNCTION sync_row_id();
ALTER TABLE pay_wht_cert ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buddy_app') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON pay_wht_cert TO buddy_app;
  CREATE POLICY buddy_company ON pay_wht_cert TO buddy_app USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);
END IF; END $$;
-- PDPA: พนักงาน (ระบบเงินเดือน) เป็นเจ้าของข้อมูลในทะเบียนคำขอได้
ALTER TABLE sys_pdpa_request DROP CONSTRAINT IF EXISTS sys_pdpa_request_subject_type_check;
ALTER TABLE sys_pdpa_request ADD CONSTRAINT sys_pdpa_request_subject_type_check CHECK (subject_type IN ('CUSTOMER','SUPPLIER','SALESPERSON','CONTACT','EMPLOYEE'));
COMMENT ON COLUMN sys_pdpa_request.subject_type IS 'CUSTOMER SUPPLIER SALESPERSON CONTACT EMPLOYEE';
