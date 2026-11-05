-- docs/17 B6: Hub + ล็อกอินกลาง — ที่อยู่โปรแกรมต่อลูกค้า (Hub เปิดพร้อมบัตรผ่าน) · สถานะคิวส่งเอกสารที่โปรแกรมอื่นรายงานเข้ามา (SyncStatus รวม)
ALTER TABLE sys_tenant_module ADD COLUMN app_url varchar(200);
COMMENT ON COLUMN sys_tenant_module.app_url IS 'ที่อยู่หน้าเว็บของโปรแกรมสำหรับลูกค้านี้ — Hub เปิดพร้อมบัตรผ่าน (docs/17 B6) เช่น https://wtspos.example.com/office/';
-- sys_source_status: สถานะคิวส่งเอกสารของโปรแกรมอื่น (WTS-POS WTS-SOP …) ที่รายงานเข้ามาด้วยกุญแจ API — Hub แสดง SyncStatus รวม + ตัวเลขสำคัญต่อไทล์ (docs/17 B6.2) · แถวเดียวต่อบริษัทต่อระบบ เขียนทับทุกครั้ง  [Express: (ใหม่)]
CREATE TABLE sys_source_status (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  source_system varchar(30) NOT NULL,
  pending integer DEFAULT 0 NOT NULL,
  failed integer DEFAULT 0 NOT NULL,
  oldest_pending_at timestamptz,
  last_sent_at timestamptz,
  message varchar(200),
  metric_label varchar(60),
  metric_value varchar(40),
  reported_at timestamptz DEFAULT now() NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE sys_source_status IS 'สถานะคิวส่งเอกสารของโปรแกรมอื่น (WTS-POS WTS-SOP …) ที่รายงานเข้ามาด้วยกุญแจ API — Hub แสดง SyncStatus รวม + ตัวเลขสำคัญต่อไทล์ (docs/17 B6.2) · แถวเดียวต่อบริษัทต่อระบบ เขียนทับทุกครั้ง | Express: (ใหม่)';
COMMENT ON COLUMN sys_source_status.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN sys_source_status.company_id IS 'บริษัท';
COMMENT ON COLUMN sys_source_status.source_system IS 'ระบบต้นทาง เช่น wts-pos wts-sop';
COMMENT ON COLUMN sys_source_status.pending IS 'จำนวนรายการรอส่งเข้า Buddy';
COMMENT ON COLUMN sys_source_status.failed IS 'จำนวนรายการส่งไม่ผ่าน (ต้องแก้ที่ต้นทาง)';
COMMENT ON COLUMN sys_source_status.oldest_pending_at IS 'รายการรอส่งที่เก่าที่สุดเกิดเมื่อ';
COMMENT ON COLUMN sys_source_status.last_sent_at IS 'ส่งเข้า Buddy สำเร็จล่าสุดเมื่อ';
COMMENT ON COLUMN sys_source_status.message IS 'ข้อความจากต้นทาง เช่น เหตุที่ส่งไม่ผ่าน';
COMMENT ON COLUMN sys_source_status.metric_label IS 'ชื่อตัวเลขสำคัญที่แสดงบนไทล์ เช่น ยอดขายวันนี้';
COMMENT ON COLUMN sys_source_status.metric_value IS 'ตัวเลขสำคัญ (ข้อความทศนิยม/ข้อความ) เช่น 12345.00';
COMMENT ON COLUMN sys_source_status.reported_at IS 'รายงานล่าสุดเมื่อ (เวลาเซิร์ฟเวอร์ Buddy)';
COMMENT ON COLUMN sys_source_status.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN sys_source_status.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN sys_source_status.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN sys_source_status.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN sys_source_status.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN sys_source_status.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN sys_source_status.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_sys_source_status_company_source_system ON sys_source_status (company_id, source_system) WHERE deleted_at IS NULL;

ALTER TABLE sys_source_status ADD CONSTRAINT fk_sys_source_status_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_source_status_company_id ON sys_source_status (company_id);
ALTER TABLE sys_source_status ADD CONSTRAINT fk_sys_source_status_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_source_status_created_by ON sys_source_status (created_by);
ALTER TABLE sys_source_status ADD CONSTRAINT fk_sys_source_status_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_source_status_updated_by ON sys_source_status (updated_by);
CREATE TRIGGER trg_sys_source_status_ver BEFORE UPDATE ON sys_source_status FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_sys_source_status_rid BEFORE INSERT ON sys_source_status FOR EACH ROW EXECUTE FUNCTION sync_row_id();
-- ข้อมูลของบริษัท: เห็นเฉพาะบริษัทที่เลือก (แบบ sys_ai_usage)
ALTER TABLE sys_source_status ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buddy_app') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON sys_source_status TO buddy_app;
  CREATE POLICY buddy_company ON sys_source_status TO buddy_app USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);
END IF; END $$;
