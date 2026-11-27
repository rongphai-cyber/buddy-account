-- 0086 คำขอย้ายบริษัทข้ามลูกค้า (HANDOFF 204 C2): ผู้ให้บริการขอ → ผู้ดูแลระบบของลูกค้าเดิมยืนยันในบัญชีของตัวเองก่อนย้าย
-- ตารางระบบ (ไม่มี company_id — ไม่อยู่ใต้ RLS ของข้อมูลบริษัท) · server ตรวจผู้ยืนยัน = ADMIN ของลูกค้าเดิม
CREATE TABLE sys_company_move_request (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  source_tenant_id uuid NOT NULL,
  target_tenant_id uuid NOT NULL,
  company_ids jsonb NOT NULL,
  company_codes varchar(200) NOT NULL,
  status char(1) DEFAULT 'P' NOT NULL CHECK (status IN ('P','A','R','X')),
  expires_at timestamptz NOT NULL,
  decided_by uuid,
  decided_at timestamptz,
  result jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE sys_company_move_request IS 'คำขอย้ายบริษัทข้ามลูกค้า (HANDOFF 204 C2) — ผู้ให้บริการขอ แล้วผู้ดูแลระบบ (ADMIN) ของลูกค้าเดิมยืนยันในบัญชีของตัวเองก่อนย้าย | Express: (ใหม่)';
COMMENT ON COLUMN sys_company_move_request.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN sys_company_move_request.source_tenant_id IS 'ลูกค้าเดิม (ผู้ยืนยัน)';
COMMENT ON COLUMN sys_company_move_request.target_tenant_id IS 'ลูกค้าปลายทาง';
COMMENT ON COLUMN sys_company_move_request.company_ids IS 'บริษัทที่จะย้าย (รหัสแถว)';
COMMENT ON COLUMN sys_company_move_request.company_codes IS 'รหัสบริษัทที่จะย้าย (แสดงผล)';
COMMENT ON COLUMN sys_company_move_request.status IS 'P=รอผู้ดูแลของลูกค้าเดิมยืนยัน A=ยืนยันและย้ายแล้ว R=ลูกค้าปฏิเสธ X=ผู้ให้บริการยกเลิก';
COMMENT ON COLUMN sys_company_move_request.expires_at IS 'หมดอายุคำขอ (ยังไม่ยืนยัน = ใช้ไม่ได้)';
COMMENT ON COLUMN sys_company_move_request.decided_by IS 'ผู้ยืนยัน/ปฏิเสธ (ผู้ดูแลของลูกค้าเดิม)';
COMMENT ON COLUMN sys_company_move_request.decided_at IS 'เวลาที่ยืนยัน/ปฏิเสธ';
COMMENT ON COLUMN sys_company_move_request.result IS 'ผลการย้าย (จำนวนผู้ใช้ สิทธิ์ กุญแจ API ที่เปลี่ยน)';
COMMENT ON COLUMN sys_company_move_request.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN sys_company_move_request.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN sys_company_move_request.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN sys_company_move_request.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN sys_company_move_request.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN sys_company_move_request.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN sys_company_move_request.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
ALTER TABLE sys_company_move_request ADD CONSTRAINT fk_sys_company_move_request_source_tenant_id FOREIGN KEY (source_tenant_id) REFERENCES sys_tenant(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_company_move_request_source_tenant_id ON sys_company_move_request (source_tenant_id);
ALTER TABLE sys_company_move_request ADD CONSTRAINT fk_sys_company_move_request_target_tenant_id FOREIGN KEY (target_tenant_id) REFERENCES sys_tenant(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_company_move_request_target_tenant_id ON sys_company_move_request (target_tenant_id);
ALTER TABLE sys_company_move_request ADD CONSTRAINT fk_sys_company_move_request_decided_by FOREIGN KEY (decided_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_company_move_request_decided_by ON sys_company_move_request (decided_by);
ALTER TABLE sys_company_move_request ADD CONSTRAINT fk_sys_company_move_request_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_company_move_request_created_by ON sys_company_move_request (created_by);
ALTER TABLE sys_company_move_request ADD CONSTRAINT fk_sys_company_move_request_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_company_move_request_updated_by ON sys_company_move_request (updated_by);
CREATE TRIGGER trg_sys_company_move_request_ver BEFORE UPDATE ON sys_company_move_request FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
