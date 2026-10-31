-- รับชำระจากแพลตฟอร์มออนไลน์ (ข้อกำหนดเจ้าของ 31/10/2569): รายการที่แพลตฟอร์มหักก่อนโอน (ค่า GP คอมมิชชั่น ค่าธรรมเนียม ค่าโฆษณา)
-- → ค่าใช้จ่าย + ภาษีซื้อ / ภ.พ.36 (ผู้ให้บริการต่างประเทศ) + ภาษีหัก ณ ที่จ่ายที่เราหัก
CREATE TABLE doc_charge (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  header_id uuid NOT NULL,
  line_no smallint NOT NULL,
  supplier_id uuid NOT NULL,
  item_id uuid NOT NULL,
  description varchar(200),
  amount numeric(18,2) NOT NULL,
  vat_type char(1) DEFAULT '1' NOT NULL CHECK (vat_type IN ('0','1','3')),
  vat_amount numeric(18,2) DEFAULT 0 NOT NULL,
  tax_invoice_no varchar(30),
  tax_invoice_date date,
  wht_form varchar(4),
  wht_income_type varchar(60),
  wht_rate numeric(9,4) DEFAULT 0 NOT NULL,
  wht_amount numeric(18,2) DEFAULT 0 NOT NULL,
  wht_condition char(1) DEFAULT '1' NOT NULL CHECK (wht_condition IN ('1','3')),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE doc_charge IS 'รายการหักจากยอดรับชำระ: ค่า GP/คอมมิชชั่น ค่าธรรมเนียม ค่าโฆษณาที่แพลตฟอร์มออนไลน์หักก่อนโอน (Grab LINE MAN Agoda Booking.com Airbnb — ข้อกำหนดเจ้าของ 31/10/2569)';
COMMENT ON COLUMN doc_charge.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN doc_charge.company_id IS 'บริษัท';
COMMENT ON COLUMN doc_charge.header_id IS 'ใบเสร็จรับเงิน (RE) ที่ถูกหัก';
COMMENT ON COLUMN doc_charge.line_no IS 'ลำดับ';
COMMENT ON COLUMN doc_charge.supplier_id IS 'ผู้ให้บริการ (แพลตฟอร์ม) — ผู้ขายในภาษีซื้อ / ผู้ถูกหักในภาษีหัก ณ ที่จ่าย';
COMMENT ON COLUMN doc_charge.item_id IS 'รหัสค่าใช้จ่าย (บัญชีค่าใช้จ่ายตามกลุ่มบัญชีของรหัส)';
COMMENT ON COLUMN doc_charge.description IS 'รายละเอียด';
COMMENT ON COLUMN doc_charge.amount IS 'ค่าบริการก่อนภาษีมูลค่าเพิ่ม (VAT 0 = ยอดที่ถูกหักทั้งหมด)';
COMMENT ON COLUMN doc_charge.vat_type IS '0=ไม่มี VAT/ขอคืนไม่ได้ 1=ภาษีซื้อ 7% (ใบกำกับภาษีในประเทศ) 3=ภ.พ.36 (ผู้ให้บริการต่างประเทศ นำส่งภาษีแทน)';
COMMENT ON COLUMN doc_charge.vat_amount IS 'ภาษีมูลค่าเพิ่ม';
COMMENT ON COLUMN doc_charge.tax_invoice_no IS 'เลขที่ใบกำกับภาษี/ใบแจ้งหนี้ของผู้ให้บริการ';
COMMENT ON COLUMN doc_charge.tax_invoice_date IS 'วันที่ใบกำกับภาษี';
COMMENT ON COLUMN doc_charge.wht_form IS 'แบบภาษีหัก ณ ที่จ่ายที่เราหัก S03=ภ.ง.ด.3 S53=ภ.ง.ด.53 (ว่าง = ไม่หัก)';
COMMENT ON COLUMN doc_charge.wht_income_type IS 'ประเภทเงินได้ (ค่าบริการ ค่านายหน้า ค่าโฆษณา)';
COMMENT ON COLUMN doc_charge.wht_rate IS 'อัตราภาษีหัก ณ ที่จ่าย %';
COMMENT ON COLUMN doc_charge.wht_amount IS 'ภาษีหัก ณ ที่จ่าย';
COMMENT ON COLUMN doc_charge.wht_condition IS '1=หัก ณ ที่จ่าย (แพลตฟอร์มหักเต็มแล้ว → เรียกคืน) 3=ออกภาษีให้ครั้งเดียว (เป็นค่าใช้จ่าย)';
COMMENT ON COLUMN doc_charge.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN doc_charge.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN doc_charge.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN doc_charge.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN doc_charge.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN doc_charge.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN doc_charge.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_doc_charge_header_line_no ON doc_charge (header_id, line_no) WHERE deleted_at IS NULL;
ALTER TABLE doc_charge ADD CONSTRAINT fk_doc_charge_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_charge_company_id ON doc_charge (company_id);
ALTER TABLE doc_charge ADD CONSTRAINT fk_doc_charge_header_id FOREIGN KEY (header_id) REFERENCES doc_header(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_charge_header_id ON doc_charge (header_id);
ALTER TABLE doc_charge ADD CONSTRAINT fk_doc_charge_supplier_id FOREIGN KEY (supplier_id) REFERENCES md_supplier(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_charge_supplier_id ON doc_charge (supplier_id);
ALTER TABLE doc_charge ADD CONSTRAINT fk_doc_charge_item_id FOREIGN KEY (item_id) REFERENCES md_item(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_charge_item_id ON doc_charge (item_id);
ALTER TABLE doc_charge ADD CONSTRAINT fk_doc_charge_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_charge_created_by ON doc_charge (created_by);
ALTER TABLE doc_charge ADD CONSTRAINT fk_doc_charge_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_charge_updated_by ON doc_charge (updated_by);
CREATE TRIGGER trg_doc_charge_ver BEFORE UPDATE ON doc_charge FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_doc_charge_log AFTER INSERT OR UPDATE ON doc_charge FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_doc_charge_del AFTER DELETE ON doc_charge FOR EACH ROW EXECUTE FUNCTION sync_log_delete();
CREATE TRIGGER trg_doc_charge_rid BEFORE INSERT ON doc_charge FOR EACH ROW EXECUTE FUNCTION sync_row_id();
ALTER TABLE doc_charge ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buddy_app') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON doc_charge TO buddy_app;
  CREATE POLICY buddy_company ON doc_charge TO buddy_app USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);
END IF; END $$;
-- แฟ้มภาษี: R = ภ.พ.36
ALTER TABLE tax_vat_entry DROP CONSTRAINT IF EXISTS tax_vat_entry_vat_kind_check;
ALTER TABLE tax_vat_entry ADD CONSTRAINT tax_vat_entry_vat_kind_check CHECK (vat_kind IN ('P','S','R'));
COMMENT ON COLUMN tax_vat_entry.vat_kind IS 'P=ภาษีซื้อ S=ภาษีขาย R=ภ.พ.36 (ภาษีที่นำส่งแทนผู้ให้บริการต่างประเทศ — เครดิตเป็นภาษีซื้อเดือนถัดไป) [Express: ISVAT.VATREC]';
-- บัญชีเพื่อลงรายวันใหม่ของบริษัทที่มีอยู่ — ผูกให้เมื่อผังบัญชีมีเลขบัญชีตามผังมาตรฐาน (ไม่มี = กำหนดเองที่ เริ่มระบบ › บัญชีเพื่อลงรายวัน)
INSERT INTO gl_default_account (company_id, role, account_id)
  SELECT a.company_id, x.role, a.id FROM gl_account a JOIN (VALUES ('PP36_PAYABLE', '2138-00', '%36%'), ('INPUT_VAT_PP36', '1157-00', '%รอเครดิต%'), ('WHT_RECOVERABLE', '1130-04', 'ลูกหนี้อื่น%')) AS x(role, no, name) ON x.no = a.account_no AND a.name_th LIKE x.name
   WHERE a.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM gl_default_account g WHERE g.company_id = a.company_id AND g.role = x.role AND g.deleted_at IS NULL);
