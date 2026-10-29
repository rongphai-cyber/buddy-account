-- 0007 Row-Level Security (T0.14): ป้องกันชั้นที่สอง — แม้ query ลืมกรอง company_id ก็เห็น/เขียนข้อมูลบริษัทอื่นไม่ได้
-- คำขอที่ทำงานกับข้อมูลบริษัท: server เปิดทรานแซกชัน → SET LOCAL ROLE buddy_app → set_config('app.company_id'/'app.tenant_id', …, true)
-- buddy_app ไม่ใช่เจ้าของตาราง จึงอยู่ใต้นโยบายด้านล่าง; เจ้าของฐานข้อมูล (migration, นำเข้าข้อมูล, เข้าระบบ) ไม่ถูกจำกัด
-- โฮสต์ที่สร้าง role ไม่ได้: ข้ามส่วน role ได้ — server ตรวจแล้วทำงานแบบเดิม (กรองในโค้ดอย่างเดียว)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buddy_app') THEN
    CREATE ROLE buddy_app NOLOGIN;
  END IF;
  -- ผู้ใช้ที่เชื่อมต่อ (เจ้าของฐานข้อมูล) ต้องสลับเป็น buddy_app ได้
  IF NOT pg_has_role(current_user, 'buddy_app', 'MEMBER') THEN
    EXECUTE format('GRANT buddy_app TO %I', current_user);
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'สร้าง/มอบ role buddy_app ไม่ได้ — ใช้การกรองในโค้ดอย่างเดียว';
END $$;

DO $$
DECLARE t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buddy_app') THEN RETURN; END IF;
  GRANT USAGE ON SCHEMA public TO buddy_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO buddy_app;
  GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO buddy_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO buddy_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO buddy_app;

  -- ทุกตารางที่มี company_id: เห็น/เขียนได้เฉพาะบริษัทของคำขอ (ไม่ได้ตั้งค่า = ไม่เห็นอะไรเลย)
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
      JOIN information_schema.tables x ON x.table_schema = c.table_schema AND x.table_name = c.table_name AND x.table_type = 'BASE TABLE'
     WHERE c.table_schema = 'public' AND c.column_name = 'company_id' AND c.table_name NOT IN ('sys_user_company', 'sys_activity_log')
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS buddy_company ON %I', t);
    EXECUTE format($p$CREATE POLICY buddy_company ON %I TO buddy_app
      USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid)
      WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid)$p$, t);
  END LOOP;

  -- บันทึกเหตุการณ์: ของบริษัทนี้ หรือเหตุการณ์ระดับระบบ (ไม่มีบริษัท)
  ALTER TABLE sys_activity_log ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS buddy_company ON sys_activity_log;
  CREATE POLICY buddy_company ON sys_activity_log TO buddy_app
    USING (company_id IS NULL OR company_id = nullif(current_setting('app.company_id', true), '')::uuid)
    WITH CHECK (company_id IS NULL OR company_id = nullif(current_setting('app.company_id', true), '')::uuid);

  -- ลูกค้าผู้ใช้บริการ: เจ้าหน้าที่ผู้ให้บริการเห็นทุกราย, ลูกค้าเห็นเฉพาะของตัวเอง
  ALTER TABLE sys_tenant ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS buddy_tenant ON sys_tenant;
  CREATE POLICY buddy_tenant ON sys_tenant TO buddy_app
    USING (current_setting('app.platform', true) = '1' OR id = nullif(current_setting('app.tenant_id', true), '')::uuid);
  ALTER TABLE sys_company ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS buddy_tenant ON sys_company;
  CREATE POLICY buddy_tenant ON sys_company TO buddy_app
    USING (current_setting('app.platform', true) = '1' OR tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
  -- ผู้ใช้/กลุ่ม: ของลูกค้าเดียวกัน หรือเจ้าหน้าที่ผู้ให้บริการ (tenant ว่าง — แสดงชื่อผู้บันทึกเอกสารได้)
  ALTER TABLE sys_user ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS buddy_tenant ON sys_user;
  CREATE POLICY buddy_tenant ON sys_user TO buddy_app
    USING (current_setting('app.platform', true) = '1' OR tenant_id IS NULL OR tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
  ALTER TABLE sys_user_group ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS buddy_tenant ON sys_user_group;
  CREATE POLICY buddy_tenant ON sys_user_group TO buddy_app
    USING (current_setting('app.platform', true) = '1' OR tenant_id IS NULL OR tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
  -- ผู้ใช้ ↔ บริษัท: เฉพาะบริษัทของลูกค้าเดียวกัน
  ALTER TABLE sys_user_company ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS buddy_tenant ON sys_user_company;
  CREATE POLICY buddy_tenant ON sys_user_company TO buddy_app
    USING (current_setting('app.platform', true) = '1' OR company_id IN (SELECT id FROM sys_company))
    WITH CHECK (current_setting('app.platform', true) = '1' OR company_id IN (SELECT id FROM sys_company));
END $$;
