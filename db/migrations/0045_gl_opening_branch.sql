-- ยอดยกมาบัญชีแยกสาขา (ข้อกำหนดเจ้าของ 01/11/2569): งบทดลอง/งบการเงินรายสาขารวมยอดยกมา · ว่าง = สำนักงานใหญ่ (ยอดเดิมทั้งหมด)
ALTER TABLE gl_balance ADD COLUMN branch_id uuid;
COMMENT ON COLUMN gl_balance.branch_id IS 'สาขา (ว่าง = สำนักงานใหญ่ — ข้อกำหนดเจ้าของ 01/11/2569 งบรายสาขารวมยอดยกมา)';
ALTER TABLE gl_balance ADD CONSTRAINT fk_gl_balance_branch_id FOREIGN KEY (branch_id) REFERENCES sys_branch(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_balance_branch_id ON gl_balance (branch_id);
DROP INDEX IF EXISTS uq_gl_balance_company_account_department_period;
CREATE UNIQUE INDEX uq_gl_balance_company_account_department_branch_period ON gl_balance (company_id, account_id, COALESCE(department_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), period_id) WHERE deleted_at IS NULL;
