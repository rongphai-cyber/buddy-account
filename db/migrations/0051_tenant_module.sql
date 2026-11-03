-- docs/17 B0.6: สิทธิ์โมดูลระดับลูกค้าผู้ใช้บริการ (Hub แสดงไทล์ตามนี้)
CREATE TABLE sys_tenant_module (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  module_key varchar(20) NOT NULL,
  enabled boolean DEFAULT true NOT NULL,
  valid_to date,
  seats integer,
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
COMMENT ON TABLE sys_tenant_module IS 'โมดูล/โปรแกรมที่ลูกค้าผู้ใช้บริการใช้ได้ (WTS Solutions: Buddy POS Living HR Hotel Spa) — Hub อ่านเพื่อแสดงไทล์ (docs/17 B0.6) | Express: (ใหม่)';
COMMENT ON COLUMN sys_tenant_module.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN sys_tenant_module.tenant_id IS 'ลูกค้าผู้ใช้บริการ';
COMMENT ON COLUMN sys_tenant_module.module_key IS 'โมดูล: buddy pos living hr hotel spa';
COMMENT ON COLUMN sys_tenant_module.enabled IS 'เปิดใช้';
COMMENT ON COLUMN sys_tenant_module.valid_to IS 'ใช้ได้ถึงวันที่ (ว่าง = ไม่หมดอายุ)';
COMMENT ON COLUMN sys_tenant_module.seats IS 'จำนวนผู้ใช้/เครื่องที่ซื้อ (ว่าง = ไม่จำกัด)';
COMMENT ON COLUMN sys_tenant_module.remark IS 'หมายเหตุ (เลขที่สัญญา/ใบเสนอราคา)';
COMMENT ON COLUMN sys_tenant_module.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN sys_tenant_module.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN sys_tenant_module.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN sys_tenant_module.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN sys_tenant_module.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN sys_tenant_module.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN sys_tenant_module.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_sys_tenant_module_tenant_module_key ON sys_tenant_module (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), module_key) WHERE deleted_at IS NULL;
ALTER TABLE sys_tenant_module ADD CONSTRAINT fk_sys_tenant_module_tenant_id FOREIGN KEY (tenant_id) REFERENCES sys_tenant(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_tenant_module_tenant_id ON sys_tenant_module (tenant_id);
ALTER TABLE sys_tenant_module ADD CONSTRAINT fk_sys_tenant_module_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_tenant_module_created_by ON sys_tenant_module (created_by);
ALTER TABLE sys_tenant_module ADD CONSTRAINT fk_sys_tenant_module_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_tenant_module_updated_by ON sys_tenant_module (updated_by);
CREATE TRIGGER trg_sys_tenant_module_ver BEFORE UPDATE ON sys_tenant_module FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
-- ลูกค้าเห็นเฉพาะโมดูลของตัวเอง · เจ้าหน้าที่ผู้ให้บริการเห็นทุกราย (แบบ sys_tenant)
ALTER TABLE sys_tenant_module ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buddy_app') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON sys_tenant_module TO buddy_app;
  CREATE POLICY buddy_tenant ON sys_tenant_module TO buddy_app
    USING (current_setting('app.platform', true) = '1' OR tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
END IF; END $$;
