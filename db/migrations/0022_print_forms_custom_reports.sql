-- T5.8 แบบฟอร์มพิมพ์เอกสาร (S-RD-01/02) รายงานของผู้ใช้ (S-RD-03/04) การรับรอง/พิมพ์ซ้ำของสมุดรายวัน (S-GL-10)
CREATE TABLE sys_print_form (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  scope varchar(10) NOT NULL,
  slot smallint NOT NULL CHECK (slot BETWEEN 1 AND 9),
  name varchar(120) NOT NULL,
  base varchar(10) DEFAULT 'grid' NOT NULL,
  layout jsonb NOT NULL,
  status char(1) DEFAULT 'A' NOT NULL CHECK (status IN ('A','I')),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE sys_print_form IS 'แบบฟอร์มพิมพ์เอกสารที่ผู้ใช้กำหนด (ฟอร์ม 1–9 ต่อชนิดเอกสาร) — แทนภาษารายงานของ Express | Express: *.RPT / FORM*.RPT (บทที่ 25 S-RD-01/02)';
COMMENT ON COLUMN sys_print_form.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN sys_print_form.company_id IS 'บริษัท';
COMMENT ON COLUMN sys_print_form.scope IS 'ชนิดเอกสาร (doc_class เช่น IV RE PS หรือ GL = ใบสำคัญ)';
COMMENT ON COLUMN sys_print_form.slot IS 'หมายเลขฟอร์ม 1–9 (ตรงกับเมนูพิมพ์)';
COMMENT ON COLUMN sys_print_form.name IS 'ชื่อแบบฟอร์ม';
COMMENT ON COLUMN sys_print_form.base IS 'ต้นแบบ grid=มีเส้น plain=ไม่มีเส้น half=ครึ่งหน้า (A5) cont=ต่อเนื่อง 9.5 นิ้ว';
COMMENT ON COLUMN sys_print_form.layout IS 'รายละเอียดแบบฟอร์ม (หัวเรื่อง คอลัมน์ ช่องลงชื่อ สำเนา ขนาดอักษร …)';
COMMENT ON COLUMN sys_print_form.status IS 'A=ใช้งาน I=ไม่แสดงในเมนู';
COMMENT ON COLUMN sys_print_form.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN sys_print_form.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN sys_print_form.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN sys_print_form.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN sys_print_form.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN sys_print_form.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN sys_print_form.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_sys_print_form_company_scope_slot ON sys_print_form (company_id, scope, slot) WHERE deleted_at IS NULL;
ALTER TABLE sys_print_form ADD CONSTRAINT fk_sys_print_form_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_print_form_company_id ON sys_print_form (company_id);
ALTER TABLE sys_print_form ADD CONSTRAINT fk_sys_print_form_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_print_form_created_by ON sys_print_form (created_by);
ALTER TABLE sys_print_form ADD CONSTRAINT fk_sys_print_form_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_print_form_updated_by ON sys_print_form (updated_by);
CREATE TRIGGER trg_sys_print_form_ver BEFORE UPDATE ON sys_print_form FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_sys_print_form_log AFTER INSERT OR UPDATE ON sys_print_form FOR EACH ROW EXECUTE FUNCTION sync_log_change();
ALTER TABLE sys_print_form ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buddy_app') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON sys_print_form TO buddy_app;
  CREATE POLICY buddy_company ON sys_print_form TO buddy_app USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);
END IF; END $$;
CREATE TABLE sys_report_custom (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  code varchar(10) NOT NULL,
  base_code varchar(10) NOT NULL,
  name varchar(120) NOT NULL,
  params jsonb NOT NULL,
  hidden_cols jsonb,
  landscape boolean,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE sys_report_custom IS 'รายงานที่ผู้ใช้สร้างจากรายงานต้นฉบับ (เงื่อนไข + คอลัมน์ที่แสดง) | Express: สร้างรายงานใหม่ (บทที่ 25 S-RD-03/04)';
COMMENT ON COLUMN sys_report_custom.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN sys_report_custom.company_id IS 'บริษัท';
COMMENT ON COLUMN sys_report_custom.code IS 'รหัสรายงานของผู้ใช้ เช่น U01';
COMMENT ON COLUMN sys_report_custom.base_code IS 'รหัสรายงานต้นฉบับ เช่น 1.1.1';
COMMENT ON COLUMN sys_report_custom.name IS 'ชื่อรายงาน (หัวรายงาน)';
COMMENT ON COLUMN sys_report_custom.params IS 'เงื่อนไขที่บันทึกไว้';
COMMENT ON COLUMN sys_report_custom.hidden_cols IS 'คอลัมน์ที่ซ่อน';
COMMENT ON COLUMN sys_report_custom.landscape IS 'พิมพ์แนวนอน (ว่าง = ตามต้นฉบับ)';
COMMENT ON COLUMN sys_report_custom.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN sys_report_custom.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN sys_report_custom.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN sys_report_custom.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN sys_report_custom.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN sys_report_custom.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN sys_report_custom.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_sys_report_custom_company_code ON sys_report_custom (company_id, code) WHERE deleted_at IS NULL;
ALTER TABLE sys_report_custom ADD CONSTRAINT fk_sys_report_custom_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_report_custom_company_id ON sys_report_custom (company_id);
ALTER TABLE sys_report_custom ADD CONSTRAINT fk_sys_report_custom_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_report_custom_created_by ON sys_report_custom (created_by);
ALTER TABLE sys_report_custom ADD CONSTRAINT fk_sys_report_custom_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_report_custom_updated_by ON sys_report_custom (updated_by);
CREATE TRIGGER trg_sys_report_custom_ver BEFORE UPDATE ON sys_report_custom FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_sys_report_custom_log AFTER INSERT OR UPDATE ON sys_report_custom FOR EACH ROW EXECUTE FUNCTION sync_log_change();
ALTER TABLE sys_report_custom ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buddy_app') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON sys_report_custom TO buddy_app;
  CREATE POLICY buddy_company ON sys_report_custom TO buddy_app USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);
END IF; END $$;
ALTER TABLE gl_journal_book ADD COLUMN approve_method char(1);
ALTER TABLE gl_journal_book ADD COLUMN reprint_level smallint;
ALTER TABLE gl_journal ADD COLUMN approved_at timestamptz;
ALTER TABLE gl_journal ADD COLUMN last_printed_by uuid;
ALTER TABLE gl_journal ADD COLUMN last_printed_at timestamptz;
COMMENT ON COLUMN gl_journal_book.approve_method IS 'วิธีการพิมพ์หรือรับรอง 1=พิมพ์ก่อนรับรอง 2=รับรองก่อนพิมพ์ [Express: ISRUN.APPROV_MET]';
COMMENT ON COLUMN gl_journal_book.reprint_level IS 'พิมพ์ใบสำคัญซ้ำ ต้องขออนุมัติระดับ [Express: ISRUN.REPRN_LEV]';
COMMENT ON COLUMN gl_journal.approved_at IS 'เวลารับรอง';
COMMENT ON COLUMN gl_journal.last_printed_by IS 'ผู้พิมพ์ล่าสุด [Express: GLJNL.USERPRN]';
COMMENT ON COLUMN gl_journal.last_printed_at IS 'วันเวลาพิมพ์ล่าสุด [Express: GLJNL.PRNDAT]';
ALTER TABLE gl_journal ADD CONSTRAINT fk_gl_journal_last_printed_by FOREIGN KEY (last_printed_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_journal_last_printed_by ON gl_journal (last_printed_by);
