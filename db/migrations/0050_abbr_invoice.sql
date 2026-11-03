-- docs/17 B0.4: ใบกำกับภาษีอย่างย่อจากเครื่อง POS ในขายสดรายวัน (รายงานภาษีขาย 1 บรรทัดต่อเครื่องต่อวัน)
CREATE TABLE doc_abbr_invoice (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  header_id uuid NOT NULL,
  line_no smallint NOT NULL,
  pos_device_code varchar(20) NOT NULL,
  inv_from varchar(20) NOT NULL,
  inv_to varchar(20) NOT NULL,
  inv_count integer NOT NULL,
  base_amount numeric(18,2) DEFAULT 0 NOT NULL,
  vat_amount numeric(18,2) DEFAULT 0 NOT NULL,
  exempt_amount numeric(18,2) DEFAULT 0 NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE doc_abbr_invoice IS 'ใบกำกับภาษีอย่างย่อจากเครื่อง POS ที่รวมอยู่ในขายสด (HS) รายวัน — รายงานภาษีขาย 1 บรรทัดต่อเครื่องต่อวัน (docs/17 B0.4) | Express: (ใหม่)';
COMMENT ON COLUMN doc_abbr_invoice.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN doc_abbr_invoice.company_id IS 'บริษัท';
COMMENT ON COLUMN doc_abbr_invoice.header_id IS 'ขายสด HS ที่รวมยอด';
COMMENT ON COLUMN doc_abbr_invoice.line_no IS 'ลำดับ';
COMMENT ON COLUMN doc_abbr_invoice.pos_device_code IS 'รหัสเครื่อง POS (เลขทะเบียนเครื่องตาม ภ.พ.06)';
COMMENT ON COLUMN doc_abbr_invoice.inv_from IS 'ใบกำกับภาษีอย่างย่อ เลขที่เริ่ม';
COMMENT ON COLUMN doc_abbr_invoice.inv_to IS 'ใบกำกับภาษีอย่างย่อ เลขที่สุดท้าย';
COMMENT ON COLUMN doc_abbr_invoice.inv_count IS 'จำนวนใบ';
COMMENT ON COLUMN doc_abbr_invoice.base_amount IS 'มูลค่าก่อน VAT (ไม่รวม VAT)';
COMMENT ON COLUMN doc_abbr_invoice.vat_amount IS 'ภาษีมูลค่าเพิ่ม';
COMMENT ON COLUMN doc_abbr_invoice.exempt_amount IS 'มูลค่าที่ได้รับยกเว้น VAT';
COMMENT ON COLUMN doc_abbr_invoice.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN doc_abbr_invoice.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN doc_abbr_invoice.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN doc_abbr_invoice.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN doc_abbr_invoice.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN doc_abbr_invoice.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN doc_abbr_invoice.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_doc_abbr_invoice_header_line_no ON doc_abbr_invoice (header_id, line_no) WHERE deleted_at IS NULL;
ALTER TABLE doc_abbr_invoice ADD CONSTRAINT fk_doc_abbr_invoice_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_abbr_invoice_company_id ON doc_abbr_invoice (company_id);
ALTER TABLE doc_abbr_invoice ADD CONSTRAINT fk_doc_abbr_invoice_header_id FOREIGN KEY (header_id) REFERENCES doc_header(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_abbr_invoice_header_id ON doc_abbr_invoice (header_id);
ALTER TABLE doc_abbr_invoice ADD CONSTRAINT fk_doc_abbr_invoice_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_abbr_invoice_created_by ON doc_abbr_invoice (created_by);
ALTER TABLE doc_abbr_invoice ADD CONSTRAINT fk_doc_abbr_invoice_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_abbr_invoice_updated_by ON doc_abbr_invoice (updated_by);
CREATE TRIGGER trg_doc_abbr_invoice_ver BEFORE UPDATE ON doc_abbr_invoice FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_doc_abbr_invoice_log AFTER INSERT OR UPDATE ON doc_abbr_invoice FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_doc_abbr_invoice_del AFTER DELETE ON doc_abbr_invoice FOR EACH ROW EXECUTE FUNCTION sync_log_delete();
CREATE TRIGGER trg_doc_abbr_invoice_rid BEFORE INSERT ON doc_abbr_invoice FOR EACH ROW EXECUTE FUNCTION sync_row_id();
ALTER TABLE doc_abbr_invoice ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buddy_app') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON doc_abbr_invoice TO buddy_app;
  CREATE POLICY buddy_company ON doc_abbr_invoice TO buddy_app USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);
END IF; END $$;
-- แก้แฟ้มภาษีซื้อ/ขายที่โปรแกรมสร้างจากเอกสารราคารวม VAT: มูลค่าต้องไม่รวม VAT (แบบ Express ISVAT.AMT01) — เดิมเก็บยอดรวม VAT ทำให้ ภ.พ.30 ฐานภาษีสูงเกิน
-- เฉพาะรายการอัตโนมัติที่ผู้ใช้ไม่ได้แก้ และยังเป็นยอดรวม VAT ของเอกสาร (ข้อมูลที่นำเข้าจาก Express ไม่ถูกแตะ) · รับ/จ่ายชำระเกณฑ์เงินสดคิดแยกอยู่แล้ว
UPDATE tax_vat_entry v SET base_amount = v.base_amount - v.vat_amount
  FROM doc_header h
 WHERE h.id = v.header_id AND h.company_id = v.company_id AND h.price_type = '1' AND h.doc_class NOT IN ('RE', 'PS')
   AND v.vat_kind IN ('S', 'P') AND v.is_manual = false AND v.is_modified = false AND v.nonclaim_base = 0 AND v.vat_amount <> 0
   AND v.base_amount = abs(h.taxable_amount);
