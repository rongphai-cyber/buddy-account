-- ระบบเงินเดือน ระยะ 3 (03/11/2569): การยื่นแบบ/นำส่ง ภ.ง.ด.1 ภ.ง.ด.1ก ประกันสังคม กองทุนสำรองเลี้ยงชีพ
CREATE TABLE pay_filing (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  form varchar(10) NOT NULL CHECK (form IN ('PND1','PND1A','SSO','PVD')),
  period date NOT NULL,
  filing_no smallint DEFAULT 0 NOT NULL CHECK (filing_no BETWEEN 0 AND 9),
  branch_id uuid,
  headcount integer DEFAULT 0 NOT NULL,
  base_amount numeric(18,2) DEFAULT 0 NOT NULL,
  amount numeric(18,2) DEFAULT 0 NOT NULL,
  surcharge numeric(18,2) DEFAULT 0 NOT NULL,
  filed_date date NOT NULL,
  receipt_no varchar(60),
  pay_account_id uuid,
  surcharge_account_id uuid,
  journal_id uuid,
  status char(1) DEFAULT 'A' NOT NULL CHECK (status IN ('A','C')),
  note varchar(200),
  cancel_reason varchar(200),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE pay_filing IS 'การยื่นแบบ/นำส่งของระบบเงินเดือน (ภ.ง.ด.1 ภ.ง.ด.1ก ประกันสังคม กองทุนสำรองเลี้ยงชีพ) — นำส่งเงิน = ใบสำคัญจ่าย · ยื่น ภ.ง.ด.1/ประกันสังคมแล้วรอบเงินเดือนของเดือนนั้นแก้ไม่ได้ | Express: (ใหม่)';
COMMENT ON COLUMN pay_filing.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN pay_filing.company_id IS 'บริษัท';
COMMENT ON COLUMN pay_filing.form IS 'PND1 PND1A SSO PVD';
COMMENT ON COLUMN pay_filing.period IS 'เดือนภาษี (วันที่ 1) · ภ.ง.ด.1ก = 1 ม.ค. ของปี';
COMMENT ON COLUMN pay_filing.filing_no IS '0 = ยื่นปกติ · 1–9 = ยื่นเพิ่มเติมครั้งที่';
COMMENT ON COLUMN pay_filing.branch_id IS 'สาขาที่ยื่น (ว่าง = รวมทุกสาขา)';
COMMENT ON COLUMN pay_filing.headcount IS 'จำนวนราย';
COMMENT ON COLUMN pay_filing.base_amount IS 'เงินได้/ค่าจ้างรวม';
COMMENT ON COLUMN pay_filing.amount IS 'ภาษี/เงินสมทบที่นำส่ง';
COMMENT ON COLUMN pay_filing.surcharge IS 'เงินเพิ่ม/ค่าปรับ';
COMMENT ON COLUMN pay_filing.filed_date IS 'วันที่ยื่น/นำส่ง';
COMMENT ON COLUMN pay_filing.receipt_no IS 'เลขที่ใบเสร็จ/เลขอ้างอิงการยื่น';
COMMENT ON COLUMN pay_filing.pay_account_id IS 'บัญชีที่จ่ายเงิน (เงินสด/เงินฝาก)';
COMMENT ON COLUMN pay_filing.surcharge_account_id IS 'บัญชีค่าใช้จ่ายเงินเพิ่ม/ค่าปรับ';
COMMENT ON COLUMN pay_filing.journal_id IS 'ใบสำคัญนำส่ง';
COMMENT ON COLUMN pay_filing.status IS 'A=ยื่นแล้ว C=ยกเลิก';
COMMENT ON COLUMN pay_filing.note IS 'หมายเหตุ';
COMMENT ON COLUMN pay_filing.cancel_reason IS 'เหตุผลที่ยกเลิก';
COMMENT ON COLUMN pay_filing.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN pay_filing.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN pay_filing.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN pay_filing.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN pay_filing.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN pay_filing.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN pay_filing.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE INDEX ix_pay_filing_company_form_period ON pay_filing (company_id, form, period);
ALTER TABLE pay_filing ADD CONSTRAINT fk_pay_filing_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_filing_company_id ON pay_filing (company_id);
ALTER TABLE pay_filing ADD CONSTRAINT fk_pay_filing_branch_id FOREIGN KEY (branch_id) REFERENCES sys_branch(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_filing_branch_id ON pay_filing (branch_id);
ALTER TABLE pay_filing ADD CONSTRAINT fk_pay_filing_pay_account_id FOREIGN KEY (pay_account_id) REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_filing_pay_account_id ON pay_filing (pay_account_id);
ALTER TABLE pay_filing ADD CONSTRAINT fk_pay_filing_surcharge_account_id FOREIGN KEY (surcharge_account_id) REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_filing_surcharge_account_id ON pay_filing (surcharge_account_id);
ALTER TABLE pay_filing ADD CONSTRAINT fk_pay_filing_journal_id FOREIGN KEY (journal_id) REFERENCES gl_journal(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_filing_journal_id ON pay_filing (journal_id);
ALTER TABLE pay_filing ADD CONSTRAINT fk_pay_filing_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_filing_created_by ON pay_filing (created_by);
ALTER TABLE pay_filing ADD CONSTRAINT fk_pay_filing_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_filing_updated_by ON pay_filing (updated_by);
CREATE TRIGGER trg_pay_filing_ver BEFORE UPDATE ON pay_filing FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_pay_filing_log AFTER INSERT OR UPDATE ON pay_filing FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_pay_filing_del AFTER DELETE ON pay_filing FOR EACH ROW EXECUTE FUNCTION sync_log_delete();
CREATE TRIGGER trg_pay_filing_rid BEFORE INSERT ON pay_filing FOR EACH ROW EXECUTE FUNCTION sync_row_id();
ALTER TABLE pay_filing ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buddy_app') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON pay_filing TO buddy_app;
  CREATE POLICY buddy_company ON pay_filing TO buddy_app USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);
END IF; END $$;
