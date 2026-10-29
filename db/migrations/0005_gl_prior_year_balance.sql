-- 0005 ยอดปีที่แล้วที่ป้อนเอง (คู่มือบทที่ 15 S-GL-16): ใช้กับปีที่ไม่มีใบสำคัญในระบบ สำหรับงบเปรียบเทียบเท่านั้น

CREATE TABLE gl_prior_year_balance (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  fiscal_year_id uuid NOT NULL,
  account_id uuid NOT NULL,
  department_id uuid,
  period_no smallint NOT NULL CHECK (period_no BETWEEN 0 AND 12),
  debit numeric(18,2) DEFAULT 0 NOT NULL,
  credit numeric(18,2) DEFAULT 0 NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE gl_prior_year_balance IS 'ยอดปีที่แล้วที่ป้อนเอง (คู่มือบทที่ 15 S-GL-16) — ใช้กับปีที่ไม่มีใบสำคัญในระบบ (เริ่มใช้กลางปี/ย้ายจากโปรแกรมอื่น) สำหรับงบเปรียบเทียบเท่านั้น ไม่ยกไปปีถัดไป | Express: GLBAL (BEGLY + DEBITn/CREDITn ของปีที่แล้ว)';
COMMENT ON COLUMN gl_prior_year_balance.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN gl_prior_year_balance.company_id IS 'บริษัท';
COMMENT ON COLUMN gl_prior_year_balance.fiscal_year_id IS 'ปีบัญชีที่ป้อนยอด';
COMMENT ON COLUMN gl_prior_year_balance.account_id IS 'บัญชี [Express: GLBAL.ACCNUM]';
COMMENT ON COLUMN gl_prior_year_balance.department_id IS 'แผนก [Express: GLBAL.DEPCOD]';
COMMENT ON COLUMN gl_prior_year_balance.period_no IS '0 = ยอดยกมาต้นปี, 1–12 = งวด';
COMMENT ON COLUMN gl_prior_year_balance.debit IS 'เดบิต [Express: GLBAL.DEBITn / BEGLY]';
COMMENT ON COLUMN gl_prior_year_balance.credit IS 'เครดิต [Express: GLBAL.CREDITn / BEGLY]';
COMMENT ON COLUMN gl_prior_year_balance.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN gl_prior_year_balance.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN gl_prior_year_balance.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN gl_prior_year_balance.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN gl_prior_year_balance.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN gl_prior_year_balance.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN gl_prior_year_balance.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
ALTER TABLE gl_prior_year_balance ADD CONSTRAINT fk_gl_prior_year_balance_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_prior_year_balance_company_id ON gl_prior_year_balance (company_id);
ALTER TABLE gl_prior_year_balance ADD CONSTRAINT fk_gl_prior_year_balance_fiscal_year_id FOREIGN KEY (fiscal_year_id) REFERENCES gl_fiscal_year(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_prior_year_balance_fiscal_year_id ON gl_prior_year_balance (fiscal_year_id);
ALTER TABLE gl_prior_year_balance ADD CONSTRAINT fk_gl_prior_year_balance_account_id FOREIGN KEY (account_id) REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_prior_year_balance_account_id ON gl_prior_year_balance (account_id);
ALTER TABLE gl_prior_year_balance ADD CONSTRAINT fk_gl_prior_year_balance_department_id FOREIGN KEY (department_id) REFERENCES md_department(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_prior_year_balance_department_id ON gl_prior_year_balance (department_id);
ALTER TABLE gl_prior_year_balance ADD CONSTRAINT fk_gl_prior_year_balance_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_prior_year_balance_created_by ON gl_prior_year_balance (created_by);
ALTER TABLE gl_prior_year_balance ADD CONSTRAINT fk_gl_prior_year_balance_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_prior_year_balance_updated_by ON gl_prior_year_balance (updated_by);
CREATE TRIGGER trg_gl_prior_year_balance_ver BEFORE UPDATE ON gl_prior_year_balance FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_gl_prior_year_balance_log AFTER INSERT OR UPDATE ON gl_prior_year_balance FOR EACH ROW EXECUTE FUNCTION sync_log_change();
