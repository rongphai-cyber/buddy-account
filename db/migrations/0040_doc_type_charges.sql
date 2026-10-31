-- รายการหักโดยแพลตฟอร์มตั้งที่ประเภทเอกสาร (ข้อกำหนดเจ้าของ 31/10/2569): ค่า GP ค่าการตลาด ค่าโฆษณา ค่าธรรมเนียม + บัญชีที่ลง · ผู้ให้บริการของประเภทเอกสาร
CREATE TABLE md_doc_type_charge (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  doc_type_id uuid NOT NULL,
  line_no smallint NOT NULL,
  name varchar(60) NOT NULL,
  account_id uuid NOT NULL,
  vat_type char(1) DEFAULT '1' NOT NULL CHECK (vat_type IN ('0','1','3')),
  wht_income_type varchar(60),
  wht_rate numeric(9,4) DEFAULT 0 NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE md_doc_type_charge IS 'รายการหักโดยแพลตฟอร์มของประเภทเอกสารใบเสร็จ (ค่า GP ค่าการตลาด ค่าโฆษณา ค่าธรรมเนียม) + บัญชีที่ลง — ข้อกำหนดเจ้าของ 31/10/2569';
COMMENT ON COLUMN md_doc_type_charge.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN md_doc_type_charge.company_id IS 'บริษัท';
COMMENT ON COLUMN md_doc_type_charge.doc_type_id IS 'ประเภทเอกสาร (หมวด RE)';
COMMENT ON COLUMN md_doc_type_charge.line_no IS 'ลำดับ';
COMMENT ON COLUMN md_doc_type_charge.name IS 'ชื่อรายการหัก เช่น ค่า GP/คอมมิชชั่น ค่าการตลาด ค่าโฆษณา';
COMMENT ON COLUMN md_doc_type_charge.account_id IS 'บัญชีค่าใช้จ่ายที่ลง';
COMMENT ON COLUMN md_doc_type_charge.vat_type IS 'ค่าเริ่มต้น VAT: 0=ไม่มี 1=ภาษีซื้อ 7% 3=ภ.พ.36';
COMMENT ON COLUMN md_doc_type_charge.wht_income_type IS 'ประเภทเงินได้ของภาษีหัก ณ ที่จ่าย';
COMMENT ON COLUMN md_doc_type_charge.wht_rate IS 'อัตราภาษีหัก ณ ที่จ่าย %';
COMMENT ON COLUMN md_doc_type_charge.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN md_doc_type_charge.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN md_doc_type_charge.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN md_doc_type_charge.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN md_doc_type_charge.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN md_doc_type_charge.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN md_doc_type_charge.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_md_doc_type_charge_doc_type_line_no ON md_doc_type_charge (doc_type_id, line_no) WHERE deleted_at IS NULL;
ALTER TABLE md_doc_type_charge ADD CONSTRAINT fk_md_doc_type_charge_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_doc_type_charge_company_id ON md_doc_type_charge (company_id);
ALTER TABLE md_doc_type_charge ADD CONSTRAINT fk_md_doc_type_charge_doc_type_id FOREIGN KEY (doc_type_id) REFERENCES md_doc_type(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_doc_type_charge_doc_type_id ON md_doc_type_charge (doc_type_id);
ALTER TABLE md_doc_type_charge ADD CONSTRAINT fk_md_doc_type_charge_account_id FOREIGN KEY (account_id) REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_doc_type_charge_account_id ON md_doc_type_charge (account_id);
ALTER TABLE md_doc_type_charge ADD CONSTRAINT fk_md_doc_type_charge_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_doc_type_charge_created_by ON md_doc_type_charge (created_by);
ALTER TABLE md_doc_type_charge ADD CONSTRAINT fk_md_doc_type_charge_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_doc_type_charge_updated_by ON md_doc_type_charge (updated_by);
CREATE TRIGGER trg_md_doc_type_charge_ver BEFORE UPDATE ON md_doc_type_charge FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_md_doc_type_charge_log AFTER INSERT OR UPDATE ON md_doc_type_charge FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_md_doc_type_charge_del AFTER DELETE ON md_doc_type_charge FOR EACH ROW EXECUTE FUNCTION sync_log_delete();
CREATE TRIGGER trg_md_doc_type_charge_rid BEFORE INSERT ON md_doc_type_charge FOR EACH ROW EXECUTE FUNCTION sync_row_id();
ALTER TABLE md_doc_type_charge ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buddy_app') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON md_doc_type_charge TO buddy_app;
  CREATE POLICY buddy_company ON md_doc_type_charge TO buddy_app USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);
END IF; END $$;
ALTER TABLE md_doc_type ADD COLUMN charge_supplier_id uuid;
COMMENT ON COLUMN md_doc_type.charge_supplier_id IS 'ผู้ให้บริการ (แพลตฟอร์ม) ที่หักค่าบริการก่อนโอน — ใบเสร็จประเภทนี้ (ข้อกำหนดเจ้าของ 31/10/2569)';
ALTER TABLE md_doc_type ADD CONSTRAINT fk_md_doc_type_charge_supplier_id FOREIGN KEY (charge_supplier_id) REFERENCES md_supplier(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_doc_type_charge_supplier_id ON md_doc_type (charge_supplier_id);
ALTER TABLE doc_charge ALTER COLUMN item_id DROP NOT NULL;
ALTER TABLE doc_charge ADD COLUMN account_id uuid;
COMMENT ON COLUMN doc_charge.item_id IS 'รหัสค่าใช้จ่าย (บัญชีค่าใช้จ่ายตามกลุ่มบัญชีของรหัส) — ว่างเมื่อใช้รายการหักที่ตั้งไว้ที่ประเภทเอกสาร';
COMMENT ON COLUMN doc_charge.account_id IS 'บัญชีค่าใช้จ่ายจากรายการหักที่ตั้งไว้ที่ประเภทเอกสาร (มาก่อนรหัสค่าใช้จ่าย)';
ALTER TABLE doc_charge ADD CONSTRAINT fk_doc_charge_account_id FOREIGN KEY (account_id) REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_charge_account_id ON doc_charge (account_id);
