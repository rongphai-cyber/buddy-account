-- 0064 ต้นทุนตาม Job / โครงการ (เจ้าของ 17/11/2569 · HANDOFF 129)
-- แฟ้ม Job เพิ่มเลขที่สัญญา ผู้รับผิดชอบ มูลค่าสัญญา หมายเหตุ · งบประมาณรายบัญชี (md_project_budget.account_id)
-- ตาราง md_project / md_project_budget มีอยู่แล้วตั้งแต่ baseline (เปิด RLS แล้วใน 0007) — เพิ่มคอลัมน์อย่างเดียว ข้อมูลเดิมไม่เปลี่ยน
ALTER TABLE md_project ADD COLUMN ref_no varchar(30);
ALTER TABLE md_project ADD COLUMN manager varchar(60);
ALTER TABLE md_project ADD COLUMN contract_amount numeric(18,2);
ALTER TABLE md_project ADD COLUMN note text;
COMMENT ON COLUMN md_project.ref_no IS 'เลขที่สัญญา/PO ของลูกค้า [Express: JBMAS.PONUM]';
COMMENT ON COLUMN md_project.manager IS 'ผู้รับผิดชอบ [Express: JBMAS.MANAGER]';
COMMENT ON COLUMN md_project.contract_amount IS 'มูลค่าสัญญา (รายได้ที่คาด)';
COMMENT ON COLUMN md_project.note IS 'หมายเหตุ';
COMMENT ON COLUMN md_project.status IS 'สถานะ A=กำลังทำ I=ปิดแล้ว (ปิดแล้วใช้ในเอกสารใหม่ไม่ได้ — เจ้าของ 17/11/2569) [Express: JBMAS.STATUS]';

ALTER TABLE md_project_budget ADD COLUMN account_id uuid;
COMMENT ON COLUMN md_project_budget.account_id IS 'บัญชีที่ตั้งงบ (งบรายบัญชี)';
ALTER TABLE md_project_budget ADD CONSTRAINT fk_md_project_budget_account_id FOREIGN KEY (account_id) REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_project_budget_account_id ON md_project_budget (account_id);
CREATE UNIQUE INDEX uq_md_project_budget_project_account ON md_project_budget (project_id, account_id) WHERE deleted_at IS NULL;
