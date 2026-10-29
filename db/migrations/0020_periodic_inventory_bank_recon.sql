-- T4.8 บัญชีสินค้าคงเหลือ Periodic (S-GL-14/15, Express GLINV) + กระทบยอดเงินฝากธนาคาร
CREATE TABLE gl_inventory_balance (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  fiscal_year_id uuid NOT NULL,
  account_id uuid NOT NULL,
  department_id uuid,
  period_no smallint NOT NULL,
  amount numeric(18,2) NOT NULL,
  source char(1) DEFAULT 'M' NOT NULL CHECK (source IN ('M','S')),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE gl_inventory_balance IS 'บัญชีสินค้าคงเหลือ (Periodic) — ยอดคงเหลือปลายงวดที่ผู้ใช้ยืนยัน ใช้ในงบการเงินแทนยอดบัญชี | Express: GLINV';
COMMENT ON COLUMN gl_inventory_balance.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN gl_inventory_balance.company_id IS 'บริษัท';
COMMENT ON COLUMN gl_inventory_balance.fiscal_year_id IS 'ปีบัญชี';
COMMENT ON COLUMN gl_inventory_balance.account_id IS 'บัญชีสินค้าคงเหลือ [Express: GLINV.ACCNUM]';
COMMENT ON COLUMN gl_inventory_balance.department_id IS 'แผนก [Express: GLINV.DEPCOD]';
COMMENT ON COLUMN gl_inventory_balance.period_no IS 'งวด 1–12 (0 = ยอดยกมาปีปัจจุบัน) [Express: GLINV.BEG/BAL1..12]';
COMMENT ON COLUMN gl_inventory_balance.amount IS 'ยอดคงเหลือปลายงวด [Express: GLINV.BAL1..12]';
COMMENT ON COLUMN gl_inventory_balance.source IS 'M=ป้อนเอง S=คำนวณจากระบบสินค้า (F5)';
COMMENT ON COLUMN gl_inventory_balance.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN gl_inventory_balance.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN gl_inventory_balance.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN gl_inventory_balance.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN gl_inventory_balance.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN gl_inventory_balance.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN gl_inventory_balance.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE INDEX ix_gl_inventory_balance_company_fiscal_year_account ON gl_inventory_balance (company_id, fiscal_year_id, account_id);
ALTER TABLE gl_inventory_balance ADD CONSTRAINT fk_gl_inventory_balance_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_inventory_balance_company_id ON gl_inventory_balance (company_id);
ALTER TABLE gl_inventory_balance ADD CONSTRAINT fk_gl_inventory_balance_fiscal_year_id FOREIGN KEY (fiscal_year_id) REFERENCES gl_fiscal_year(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_inventory_balance_fiscal_year_id ON gl_inventory_balance (fiscal_year_id);
ALTER TABLE gl_inventory_balance ADD CONSTRAINT fk_gl_inventory_balance_account_id FOREIGN KEY (account_id) REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_inventory_balance_account_id ON gl_inventory_balance (account_id);
ALTER TABLE gl_inventory_balance ADD CONSTRAINT fk_gl_inventory_balance_department_id FOREIGN KEY (department_id) REFERENCES md_department(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_inventory_balance_department_id ON gl_inventory_balance (department_id);
ALTER TABLE gl_inventory_balance ADD CONSTRAINT fk_gl_inventory_balance_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_inventory_balance_created_by ON gl_inventory_balance (created_by);
ALTER TABLE gl_inventory_balance ADD CONSTRAINT fk_gl_inventory_balance_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_inventory_balance_updated_by ON gl_inventory_balance (updated_by);
CREATE TRIGGER trg_gl_inventory_balance_ver BEFORE UPDATE ON gl_inventory_balance FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_gl_inventory_balance_log AFTER INSERT OR UPDATE ON gl_inventory_balance FOR EACH ROW EXECUTE FUNCTION sync_log_change();
ALTER TABLE gl_inventory_balance ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buddy_app') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON gl_inventory_balance TO buddy_app;
  CREATE POLICY buddy_company ON gl_inventory_balance TO buddy_app USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);
END IF; END $$;
CREATE TABLE fin_bank_statement (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  bank_account_id uuid NOT NULL,
  statement_date date NOT NULL,
  closing_balance numeric(18,2) NOT NULL,
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
COMMENT ON TABLE fin_bank_statement IS 'ยอดตามใบแจ้งยอดธนาคาร (Bank statement) สำหรับกระทบยอดเงินฝาก | Express: (ใหม่)';
COMMENT ON COLUMN fin_bank_statement.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN fin_bank_statement.company_id IS 'บริษัท';
COMMENT ON COLUMN fin_bank_statement.bank_account_id IS 'บัญชีเงินฝาก';
COMMENT ON COLUMN fin_bank_statement.statement_date IS 'วันที่ใบแจ้งยอด';
COMMENT ON COLUMN fin_bank_statement.closing_balance IS 'ยอดคงเหลือตามใบแจ้งยอด';
COMMENT ON COLUMN fin_bank_statement.remark IS 'หมายเหตุ';
COMMENT ON COLUMN fin_bank_statement.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN fin_bank_statement.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN fin_bank_statement.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN fin_bank_statement.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN fin_bank_statement.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN fin_bank_statement.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN fin_bank_statement.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_fin_bank_statement_company_bank_account_statement_date ON fin_bank_statement (company_id, COALESCE(bank_account_id, '00000000-0000-0000-0000-000000000000'::uuid), statement_date) WHERE deleted_at IS NULL;
ALTER TABLE fin_bank_statement ADD CONSTRAINT fk_fin_bank_statement_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_fin_bank_statement_company_id ON fin_bank_statement (company_id);
ALTER TABLE fin_bank_statement ADD CONSTRAINT fk_fin_bank_statement_bank_account_id FOREIGN KEY (bank_account_id) REFERENCES md_bank_account(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_fin_bank_statement_bank_account_id ON fin_bank_statement (bank_account_id);
ALTER TABLE fin_bank_statement ADD CONSTRAINT fk_fin_bank_statement_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_fin_bank_statement_created_by ON fin_bank_statement (created_by);
ALTER TABLE fin_bank_statement ADD CONSTRAINT fk_fin_bank_statement_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_fin_bank_statement_updated_by ON fin_bank_statement (updated_by);
CREATE TRIGGER trg_fin_bank_statement_ver BEFORE UPDATE ON fin_bank_statement FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_fin_bank_statement_log AFTER INSERT OR UPDATE ON fin_bank_statement FOR EACH ROW EXECUTE FUNCTION sync_log_change();
ALTER TABLE fin_bank_statement ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buddy_app') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON fin_bank_statement TO buddy_app;
  CREATE POLICY buddy_company ON fin_bank_statement TO buddy_app USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);
END IF; END $$;
ALTER TABLE gl_journal_line ADD COLUMN bank_cleared_date date;
COMMENT ON COLUMN gl_journal_line.bank_cleared_date IS 'กระทบยอดธนาคาร: วันที่รายการปรากฏใน Bank statement (เฉพาะบรรทัดบัญชีเงินฝาก)';
