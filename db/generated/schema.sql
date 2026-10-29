-- =====================================================================
-- Buddy Account — โครงสร้างฐานข้อมูล (ออกแบบตามโครงสร้างโปรแกรม Express)
-- สร้างอัตโนมัติจาก spec.py  — อย่าแก้ไฟล์นี้ด้วยมือ ให้แก้ spec แล้วสร้างใหม่
-- =====================================================================
-- ต้องใช้ PostgreSQL 13+ (gen_random_uuid มีในตัว) — ใช้ได้ทั้ง PostgreSQL และ PGlite

-- sys_tenant: ลูกค้าผู้ใช้บริการ (tenant) — หนึ่งรายมีได้หลายบริษัท ข้อมูลแต่ละรายแยกขาดจากกัน — Buddy Account  [Express: (ใหม่)]
CREATE TABLE sys_tenant (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  code varchar(20) NOT NULL,
  name varchar(120) NOT NULL,
  contact_email varchar(120),
  contact_phone varchar(60),
  plan varchar(20) DEFAULT 'standard' NOT NULL,
  max_companies integer,
  max_users integer,
  expires_on date,
  status char(1) DEFAULT 'A' NOT NULL CHECK (status IN ('A','S','I')),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE sys_tenant IS 'ลูกค้าผู้ใช้บริการ (tenant) — หนึ่งรายมีได้หลายบริษัท ข้อมูลแต่ละรายแยกขาดจากกัน — Buddy Account | Express: (ใหม่)';
COMMENT ON COLUMN sys_tenant.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN sys_tenant.code IS 'รหัสลูกค้าผู้ใช้บริการ';
COMMENT ON COLUMN sys_tenant.name IS 'ชื่อลูกค้าผู้ใช้บริการ (เจ้าของบัญชี)';
COMMENT ON COLUMN sys_tenant.contact_email IS 'อีเมลผู้ติดต่อ';
COMMENT ON COLUMN sys_tenant.contact_phone IS 'โทรศัพท์ผู้ติดต่อ';
COMMENT ON COLUMN sys_tenant.plan IS 'แพ็กเกจ';
COMMENT ON COLUMN sys_tenant.max_companies IS 'จำนวนบริษัทสูงสุด (ว่าง = ไม่จำกัด)';
COMMENT ON COLUMN sys_tenant.max_users IS 'จำนวนผู้ใช้สูงสุด (ว่าง = ไม่จำกัด)';
COMMENT ON COLUMN sys_tenant.expires_on IS 'วันหมดอายุการใช้งาน';
COMMENT ON COLUMN sys_tenant.status IS 'A=ใช้งาน S=ระงับ I=เลิกใช้';
COMMENT ON COLUMN sys_tenant.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN sys_tenant.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN sys_tenant.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN sys_tenant.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN sys_tenant.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN sys_tenant.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN sys_tenant.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_sys_tenant_code ON sys_tenant (code) WHERE deleted_at IS NULL;

-- sys_company: บริษัท (หนึ่งฐานข้อมูลรองรับหลายบริษัท)  [Express: ISINFO + ทะเบียนบริษัท (บทที่ 4)]
CREATE TABLE sys_company (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  code varchar(20) NOT NULL,
  name_th varchar(120) NOT NULL,
  name_en varchar(120),
  address_th text,
  address_en text,
  phone varchar(60),
  tax_id varchar(13),
  trade_reg_no varchar(20),
  social_security_no varchar(20),
  base_currency varchar(3) DEFAULT 'THB' NOT NULL,
  year_system char(1) DEFAULT 'B' NOT NULL CHECK (year_system IN ('B','C')),
  status char(1) DEFAULT 'A' NOT NULL CHECK (status IN ('A','I')),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE sys_company IS 'บริษัท (หนึ่งฐานข้อมูลรองรับหลายบริษัท) | Express: ISINFO + ทะเบียนบริษัท (บทที่ 4)';
COMMENT ON COLUMN sys_company.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN sys_company.tenant_id IS 'ลูกค้าผู้ใช้บริการที่เป็นเจ้าของบริษัทนี้';
COMMENT ON COLUMN sys_company.code IS 'รหัสบริษัท (เดิมคือชื่อโฟลเดอร์ข้อมูล เช่น TESTRice) [Express: DATA PATH]';
COMMENT ON COLUMN sys_company.name_th IS 'ชื่อกิจการภาษาไทย [Express: ISINFO.THINAM]';
COMMENT ON COLUMN sys_company.name_en IS 'ชื่อกิจการภาษาอังกฤษ [Express: ISINFO.ENGNAM]';
COMMENT ON COLUMN sys_company.address_th IS 'ที่อยู่ภาษาไทย [Express: ISINFO.ADDR01+ADDR02]';
COMMENT ON COLUMN sys_company.address_en IS 'ที่อยู่ภาษาอังกฤษ [Express: ISINFO.ADDR01ENG+ADDR02ENG]';
COMMENT ON COLUMN sys_company.phone IS 'โทรศัพท์ [Express: ISINFO.TELNUM]';
COMMENT ON COLUMN sys_company.tax_id IS 'เลขประจำตัวผู้เสียภาษี 13 หลัก [Express: ISINFO.TAXID]';
COMMENT ON COLUMN sys_company.trade_reg_no IS 'เลขทะเบียนการค้า/นิติบุคคล [Express: ISINFO.TRDREG]';
COMMENT ON COLUMN sys_company.social_security_no IS 'เลขที่บัญชีนายจ้างประกันสังคม [Express: ISINFO.SOCIALID]';
COMMENT ON COLUMN sys_company.base_currency IS 'สกุลเงินหลัก';
COMMENT ON COLUMN sys_company.year_system IS 'ระบบปี B=พ.ศ. C=ค.ศ. [Express: ISINFO.YEARTHAI]';
COMMENT ON COLUMN sys_company.status IS 'A=ใช้งาน I=เลิกใช้';
COMMENT ON COLUMN sys_company.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN sys_company.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN sys_company.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN sys_company.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN sys_company.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN sys_company.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN sys_company.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_sys_company_code ON sys_company (code) WHERE deleted_at IS NULL;

-- sys_branch: สาขา / จุดทำงาน (สำนักงานใหญ่ สาขา โรงแรมแต่ละแห่ง)  [Express: (ใหม่) — Express มีแค่ "สาขา#" ในเอกสาร]
CREATE TABLE sys_branch (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  code varchar(10) NOT NULL,
  name varchar(120) NOT NULL,
  tax_branch_no varchar(5) DEFAULT '00000' NOT NULL,
  address text,
  is_head_office boolean DEFAULT false NOT NULL,
  default_warehouse_id uuid,
  status char(1) DEFAULT 'A' NOT NULL CHECK (status IN ('A','I')),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE sys_branch IS 'สาขา / จุดทำงาน (สำนักงานใหญ่ สาขา โรงแรมแต่ละแห่ง) | Express: (ใหม่) — Express มีแค่ "สาขา#" ในเอกสาร';
COMMENT ON COLUMN sys_branch.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN sys_branch.company_id IS 'บริษัท';
COMMENT ON COLUMN sys_branch.code IS 'รหัสสาขา';
COMMENT ON COLUMN sys_branch.name IS 'ชื่อสาขา';
COMMENT ON COLUMN sys_branch.tax_branch_no IS 'เลขที่สาขาตามกรมสรรพากร (00000 = สำนักงานใหญ่)';
COMMENT ON COLUMN sys_branch.address IS 'ที่อยู่สาขา (พิมพ์บนใบกำกับภาษี)';
COMMENT ON COLUMN sys_branch.is_head_office IS 'เป็นสำนักงานใหญ่';
COMMENT ON COLUMN sys_branch.default_warehouse_id IS 'คลังหลักของสาขา [Express: ISINFO.MAINLOC]';
COMMENT ON COLUMN sys_branch.status IS 'สถานะ';
COMMENT ON COLUMN sys_branch.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN sys_branch.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN sys_branch.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN sys_branch.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN sys_branch.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN sys_branch.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN sys_branch.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_sys_branch_company_code ON sys_branch (company_id, code) WHERE deleted_at IS NULL;

-- sys_user: ผู้ใช้งาน  [Express: SCUSER (ไฟล์ระบบรักษาความปลอดภัย บทที่ 23)]
CREATE TABLE sys_user (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid,
  username varchar(30) NOT NULL,
  display_name varchar(120) NOT NULL,
  password_hash text,
  user_group_id uuid,
  approval_level smallint DEFAULT 0 NOT NULL CHECK (approval_level BETWEEN 0 AND 9),
  check_rights boolean DEFAULT false NOT NULL,
  menu_language char(2) DEFAULT 'th' NOT NULL,
  default_printer varchar(60),
  status char(1) DEFAULT 'A' NOT NULL CHECK (status IN ('A','I')),
  last_login_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE sys_user IS 'ผู้ใช้งาน | Express: SCUSER (ไฟล์ระบบรักษาความปลอดภัย บทที่ 23)';
COMMENT ON COLUMN sys_user.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN sys_user.tenant_id IS 'ลูกค้าผู้ใช้บริการที่ผู้ใช้สังกัด (ว่าง = เจ้าหน้าที่ผู้ให้บริการโปรแกรม)';
COMMENT ON COLUMN sys_user.username IS 'รหัสผู้ใช้ (USERID ใน Express ยาว 8) [Express: USERID]';
COMMENT ON COLUMN sys_user.display_name IS 'ชื่อผู้ใช้';
COMMENT ON COLUMN sys_user.password_hash IS 'รหัสผ่านแบบ hash (argon2/bcrypt) — เก็บใน client เพื่อเข้าระบบตอนออฟไลน์';
COMMENT ON COLUMN sys_user.user_group_id IS 'กลุ่มผู้ใช้';
COMMENT ON COLUMN sys_user.approval_level IS 'ระดับอนุมัติ 0–9';
COMMENT ON COLUMN sys_user.check_rights IS 'ตรวจสอบสิทธิ์ก่อนใช้งาน: true = จำกัดเพิ่มตามตารางสิทธิ์รายเมนู (sys_permission), false = ใช้สิทธิ์พื้นฐานตามระดับอนุมัติ (คู่มือบทที่ 23)';
COMMENT ON COLUMN sys_user.menu_language IS 'ภาษาเมนู th/en';
COMMENT ON COLUMN sys_user.default_printer IS 'เครื่องพิมพ์ประจำ';
COMMENT ON COLUMN sys_user.status IS 'สถานะ';
COMMENT ON COLUMN sys_user.last_login_at IS 'เข้าระบบครั้งล่าสุด';
COMMENT ON COLUMN sys_user.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN sys_user.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN sys_user.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN sys_user.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN sys_user.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN sys_user.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN sys_user.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_sys_user_username ON sys_user (username) WHERE deleted_at IS NULL;

-- sys_session: การเข้าระบบ (session) ของผู้ใช้ — Buddy Account  [Express: (ใหม่)]
CREATE TABLE sys_session (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  token_hash varchar(100) NOT NULL,
  current_company_id uuid,
  current_branch_id uuid,
  work_date date,
  expires_at timestamptz NOT NULL,
  ip_address varchar(60),
  user_agent varchar(200),
  ended_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE sys_session IS 'การเข้าระบบ (session) ของผู้ใช้ — Buddy Account | Express: (ใหม่)';
COMMENT ON COLUMN sys_session.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN sys_session.user_id IS 'ผู้ใช้';
COMMENT ON COLUMN sys_session.token_hash IS 'SHA-256 ของ token ใน cookie (ไม่เก็บ token จริง)';
COMMENT ON COLUMN sys_session.current_company_id IS 'บริษัทที่เลือกอยู่';
COMMENT ON COLUMN sys_session.current_branch_id IS 'สาขาที่เลือกอยู่';
COMMENT ON COLUMN sys_session.work_date IS 'วันที่ทำการ (Express: เปลี่ยนวันทำการ)';
COMMENT ON COLUMN sys_session.expires_at IS 'หมดอายุ';
COMMENT ON COLUMN sys_session.ip_address IS 'IP ที่เข้าระบบ';
COMMENT ON COLUMN sys_session.user_agent IS 'เบราว์เซอร์';
COMMENT ON COLUMN sys_session.ended_at IS 'ออกจากระบบเมื่อ';
COMMENT ON COLUMN sys_session.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN sys_session.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN sys_session.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN sys_session.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN sys_session.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN sys_session.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN sys_session.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_sys_session_token_hash ON sys_session (token_hash) WHERE deleted_at IS NULL;

-- sys_user_group: กลุ่มผู้ใช้  [Express: SCUSER (กลุ่ม)]
CREATE TABLE sys_user_group (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid,
  code varchar(20) NOT NULL,
  name varchar(120) NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE sys_user_group IS 'กลุ่มผู้ใช้ | Express: SCUSER (กลุ่ม)';
COMMENT ON COLUMN sys_user_group.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN sys_user_group.tenant_id IS 'ลูกค้าผู้ใช้บริการ (ว่าง = กลุ่มของผู้ให้บริการ)';
COMMENT ON COLUMN sys_user_group.code IS 'รหัสกลุ่ม';
COMMENT ON COLUMN sys_user_group.name IS 'ชื่อกลุ่ม';
COMMENT ON COLUMN sys_user_group.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN sys_user_group.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN sys_user_group.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN sys_user_group.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN sys_user_group.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN sys_user_group.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN sys_user_group.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_sys_user_group_tenant_code ON sys_user_group (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), code) WHERE deleted_at IS NULL;

-- sys_user_company: ผู้ใช้ ↔ บริษัท/สาขาที่เข้าได้  [Express: กลุ่มบริษัท (บทที่ 4)]
CREATE TABLE sys_user_company (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  branch_id uuid,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE sys_user_company IS 'ผู้ใช้ ↔ บริษัท/สาขาที่เข้าได้ | Express: กลุ่มบริษัท (บทที่ 4)';
COMMENT ON COLUMN sys_user_company.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN sys_user_company.company_id IS 'บริษัท';
COMMENT ON COLUMN sys_user_company.user_id IS 'ผู้ใช้';
COMMENT ON COLUMN sys_user_company.branch_id IS 'จำกัดเฉพาะสาขา (ว่าง = ทุกสาขา)';
COMMENT ON COLUMN sys_user_company.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN sys_user_company.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN sys_user_company.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN sys_user_company.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN sys_user_company.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN sys_user_company.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN sys_user_company.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_sys_user_company_company_user_branch ON sys_user_company (company_id, user_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE deleted_at IS NULL;

-- sys_menu: รายการเมนู/ฟังก์ชันที่ใช้กำหนดสิทธิ์  [Express: SCMENU]
CREATE TABLE sys_menu (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  code varchar(30) NOT NULL,
  name_th varchar(120) NOT NULL,
  name_en varchar(120),
  parent_id uuid,
  sort_order integer DEFAULT 0 NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE sys_menu IS 'รายการเมนู/ฟังก์ชันที่ใช้กำหนดสิทธิ์ | Express: SCMENU';
COMMENT ON COLUMN sys_menu.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN sys_menu.code IS 'รหัสเมนู เช่น AR.IV, GL.JV';
COMMENT ON COLUMN sys_menu.name_th IS 'ชื่อเมนู';
COMMENT ON COLUMN sys_menu.name_en IS 'ชื่อเมนูภาษาอังกฤษ';
COMMENT ON COLUMN sys_menu.parent_id IS 'เมนูแม่';
COMMENT ON COLUMN sys_menu.sort_order IS 'ลำดับ';
COMMENT ON COLUMN sys_menu.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN sys_menu.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN sys_menu.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN sys_menu.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN sys_menu.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN sys_menu.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN sys_menu.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_sys_menu_code ON sys_menu (code) WHERE deleted_at IS NULL;

-- sys_permission: สิทธิ์ 7 ชนิดต่อ ผู้ใช้/กลุ่ม × บริษัท × เมนู  [Express: SCACCLV (บทที่ 23)]
CREATE TABLE sys_permission (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  subject_type char(1) NOT NULL CHECK (subject_type IN ('U','G')),
  subject_id uuid NOT NULL,
  menu_id uuid NOT NULL,
  can_read char(1) DEFAULT 'N' NOT NULL,
  can_add char(1) DEFAULT 'N' NOT NULL,
  can_edit char(1) DEFAULT 'N' NOT NULL,
  can_cancel char(1) DEFAULT 'N' NOT NULL,
  can_delete char(1) DEFAULT 'N' NOT NULL,
  can_print char(1) DEFAULT 'N' NOT NULL,
  can_approve char(1) DEFAULT 'N' NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE sys_permission IS 'สิทธิ์ 7 ชนิดต่อ ผู้ใช้/กลุ่ม × บริษัท × เมนู | Express: SCACCLV (บทที่ 23)';
COMMENT ON COLUMN sys_permission.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN sys_permission.company_id IS 'บริษัท';
COMMENT ON COLUMN sys_permission.subject_type IS 'U=ผู้ใช้ G=กลุ่ม';
COMMENT ON COLUMN sys_permission.subject_id IS 'id ของผู้ใช้หรือกลุ่ม';
COMMENT ON COLUMN sys_permission.menu_id IS 'เมนู';
COMMENT ON COLUMN sys_permission.can_read IS 'อ่าน Y/L/N/S';
COMMENT ON COLUMN sys_permission.can_add IS 'เพิ่ม';
COMMENT ON COLUMN sys_permission.can_edit IS 'แก้ไข';
COMMENT ON COLUMN sys_permission.can_cancel IS 'ยกเลิกเอกสาร';
COMMENT ON COLUMN sys_permission.can_delete IS 'ลบ';
COMMENT ON COLUMN sys_permission.can_print IS 'พิมพ์';
COMMENT ON COLUMN sys_permission.can_approve IS 'อนุมัติ';
COMMENT ON COLUMN sys_permission.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN sys_permission.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN sys_permission.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN sys_permission.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN sys_permission.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN sys_permission.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN sys_permission.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_sys_permission_company_subject_type_subject_menu ON sys_permission (company_id, subject_type, subject_id, menu_id) WHERE deleted_at IS NULL;

-- sys_device: เครื่อง/อุปกรณ์ที่ลงทะเบียนใช้งานออฟไลน์  [Express: (ใหม่)]
CREATE TABLE sys_device (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  code varchar(10) NOT NULL,
  name varchar(120) NOT NULL,
  kind varchar(10) DEFAULT 'desktop' NOT NULL,
  public_key text,
  last_sync_at timestamptz,
  last_pull_seq bigint DEFAULT 0 NOT NULL,
  status char(1) DEFAULT 'A' NOT NULL CHECK (status IN ('A','I')),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE sys_device IS 'เครื่อง/อุปกรณ์ที่ลงทะเบียนใช้งานออฟไลน์ | Express: (ใหม่)';
COMMENT ON COLUMN sys_device.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN sys_device.company_id IS 'บริษัท';
COMMENT ON COLUMN sys_device.branch_id IS 'สาขาที่เครื่องนี้ประจำ';
COMMENT ON COLUMN sys_device.code IS 'รหัสเครื่อง (ใช้ในเลขที่เอกสารออฟไลน์ เช่น POS1)';
COMMENT ON COLUMN sys_device.name IS 'ชื่อเครื่อง';
COMMENT ON COLUMN sys_device.kind IS 'server/desktop/pos/mobile';
COMMENT ON COLUMN sys_device.public_key IS 'กุญแจสาธารณะสำหรับยืนยันตัวเครื่องตอนซิงก์';
COMMENT ON COLUMN sys_device.last_sync_at IS 'ซิงก์สำเร็จครั้งล่าสุด';
COMMENT ON COLUMN sys_device.last_pull_seq IS 'ลำดับ change log ล่าสุดที่ดึงแล้ว';
COMMENT ON COLUMN sys_device.status IS 'A=ใช้งาน I=ระงับ (ระงับแล้วซิงก์ไม่ได้)';
COMMENT ON COLUMN sys_device.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN sys_device.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN sys_device.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN sys_device.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN sys_device.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN sys_device.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN sys_device.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_sys_device_company_code ON sys_device (company_id, code) WHERE deleted_at IS NULL;

-- sys_setting: ค่าเริ่มต้นของระบบแบบ key–value (แทนฟิลด์ 244 ช่องใน ISINFO)  [Express: ISINFO]
CREATE TABLE sys_setting (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  branch_id uuid,
  module varchar(10) NOT NULL,
  key varchar(40) NOT NULL,
  value jsonb NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE sys_setting IS 'ค่าเริ่มต้นของระบบแบบ key–value (แทนฟิลด์ 244 ช่องใน ISINFO) | Express: ISINFO | รายการ key ทั้งหมดดู seed ใน sys_setting_def';
COMMENT ON COLUMN sys_setting.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN sys_setting.company_id IS 'บริษัท';
COMMENT ON COLUMN sys_setting.branch_id IS 'ค่าเฉพาะสาขา (ว่าง = ทั้งบริษัท)';
COMMENT ON COLUMN sys_setting.module IS 'ระบบ: GEN IC AR AP FN GL FA';
COMMENT ON COLUMN sys_setting.key IS 'ชื่อค่า เช่น ic.posting_method';
COMMENT ON COLUMN sys_setting.value IS 'ค่า (JSON)';
COMMENT ON COLUMN sys_setting.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN sys_setting.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN sys_setting.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN sys_setting.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN sys_setting.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN sys_setting.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN sys_setting.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_sys_setting_company_branch_key ON sys_setting (company_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), key) WHERE deleted_at IS NULL;

-- sys_setting_def: นิยามค่าเริ่มต้นแต่ละตัว (ชนิด ค่า default และฟิลด์ต้นทางใน Express)  [Express: ISINFO]
CREATE TABLE sys_setting_def (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  key varchar(40) NOT NULL,
  module varchar(10) NOT NULL,
  data_type varchar(10) NOT NULL,
  default_value jsonb,
  label_th varchar(200) NOT NULL,
  express_field varchar(60),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE sys_setting_def IS 'นิยามค่าเริ่มต้นแต่ละตัว (ชนิด ค่า default และฟิลด์ต้นทางใน Express) | Express: ISINFO';
COMMENT ON COLUMN sys_setting_def.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN sys_setting_def.key IS 'ชื่อค่า';
COMMENT ON COLUMN sys_setting_def.module IS 'ระบบ';
COMMENT ON COLUMN sys_setting_def.data_type IS 'bool/int/decimal/text/code/account';
COMMENT ON COLUMN sys_setting_def.default_value IS 'ค่าเริ่มต้น';
COMMENT ON COLUMN sys_setting_def.label_th IS 'คำอธิบาย';
COMMENT ON COLUMN sys_setting_def.express_field IS 'ฟิลด์ใน ISINFO';
COMMENT ON COLUMN sys_setting_def.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN sys_setting_def.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN sys_setting_def.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN sys_setting_def.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN sys_setting_def.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN sys_setting_def.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN sys_setting_def.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_sys_setting_def_key ON sys_setting_def (key) WHERE deleted_at IS NULL;

-- sys_activity_log: บันทึกการใช้งาน (Log file) — เพิ่มได้อย่างเดียว เก็บ ≥ 2 ปี  [Express: ISLOG (บทที่ 23)]
CREATE TABLE sys_activity_log (
  seq bigserial NOT NULL,
  company_id uuid,
  occurred_at timestamptz DEFAULT now() NOT NULL,
  user_id uuid,
  auth_user_id uuid,
  device_id uuid,
  module varchar(10),
  action varchar(20) NOT NULL,
  doc_no varchar(30),
  table_name varchar(40),
  row_id uuid,
  detail jsonb,
  PRIMARY KEY (seq)
);
COMMENT ON TABLE sys_activity_log IS 'บันทึกการใช้งาน (Log file) — เพิ่มได้อย่างเดียว เก็บ ≥ 2 ปี | Express: ISLOG (บทที่ 23)';
COMMENT ON COLUMN sys_activity_log.seq IS 'ลำดับ (PK)';
COMMENT ON COLUMN sys_activity_log.company_id IS 'บริษัท';
COMMENT ON COLUMN sys_activity_log.occurred_at IS 'วันเวลา [Express: ISLOG.TRNDATE+TRNTIME]';
COMMENT ON COLUMN sys_activity_log.user_id IS 'ผู้ทำรายการ [Express: ISLOG.USERID]';
COMMENT ON COLUMN sys_activity_log.auth_user_id IS 'ผู้อนุมัติแทน (override) [Express: ISLOG.AUTHID]';
COMMENT ON COLUMN sys_activity_log.device_id IS 'เครื่องที่ทำรายการ';
COMMENT ON COLUMN sys_activity_log.module IS 'ระบบ [Express: ISLOG.MODULE]';
COMMENT ON COLUMN sys_activity_log.action IS 'รหัสเหตุการณ์ เช่น LOGIN ADD EDIT CANCEL DELETE PRINT APPROVE RESTORE [Express: ISLOG.TRNCODE]';
COMMENT ON COLUMN sys_activity_log.doc_no IS 'เลขที่เอกสาร [Express: ISLOG.DOCNUM]';
COMMENT ON COLUMN sys_activity_log.table_name IS 'ตารางที่เกี่ยวข้อง';
COMMENT ON COLUMN sys_activity_log.row_id IS 'แถวที่เกี่ยวข้อง';
COMMENT ON COLUMN sys_activity_log.detail IS 'รายละเอียด/ค่าเดิม-ค่าใหม่';

-- gl_fiscal_year: ปีบัญชี  [Express: ISPRD]
CREATE TABLE gl_fiscal_year (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  code varchar(10) NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status char(1) DEFAULT 'O' NOT NULL CHECK (status IN ('O','C')),
  closed_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE gl_fiscal_year IS 'ปีบัญชี | Express: ISPRD | Express เก็บ 24 งวด (ปีนี้ + ปีหน้า) ในแถวเดียว ระบบใหม่เก็บปีละแถว ไม่จำกัดจำนวนปี';
COMMENT ON COLUMN gl_fiscal_year.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN gl_fiscal_year.company_id IS 'บริษัท';
COMMENT ON COLUMN gl_fiscal_year.code IS 'รหัสปี เช่น 2569';
COMMENT ON COLUMN gl_fiscal_year.start_date IS 'วันเริ่มปีบัญชี [Express: ISPRD.BEG1]';
COMMENT ON COLUMN gl_fiscal_year.end_date IS 'วันสิ้นปีบัญชี [Express: ISPRD.END12]';
COMMENT ON COLUMN gl_fiscal_year.status IS 'O=เปิด C=ปิดบัญชีแล้ว';
COMMENT ON COLUMN gl_fiscal_year.closed_at IS 'วันที่ประมวลผลสิ้นปี';
COMMENT ON COLUMN gl_fiscal_year.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN gl_fiscal_year.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN gl_fiscal_year.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN gl_fiscal_year.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN gl_fiscal_year.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN gl_fiscal_year.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN gl_fiscal_year.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_gl_fiscal_year_company_code ON gl_fiscal_year (company_id, code) WHERE deleted_at IS NULL;

-- gl_period: งวดบัญชี (เดือน) และสถานะปิดงวด  [Express: ISPRD.BEGn/ENDn/LOCKn]
CREATE TABLE gl_period (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  fiscal_year_id uuid NOT NULL,
  period_no smallint NOT NULL CHECK (period_no BETWEEN 1 AND 13),
  start_date date NOT NULL,
  end_date date NOT NULL,
  is_locked boolean DEFAULT false NOT NULL,
  locked_by uuid,
  locked_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE gl_period IS 'งวดบัญชี (เดือน) และสถานะปิดงวด | Express: ISPRD.BEGn/ENDn/LOCKn';
COMMENT ON COLUMN gl_period.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN gl_period.company_id IS 'บริษัท';
COMMENT ON COLUMN gl_period.fiscal_year_id IS 'ปีบัญชี';
COMMENT ON COLUMN gl_period.period_no IS 'งวดที่ 1–12 (13 = งวดปรับปรุงปิดบัญชี)';
COMMENT ON COLUMN gl_period.start_date IS 'วันเริ่มงวด [Express: ISPRD.BEGn]';
COMMENT ON COLUMN gl_period.end_date IS 'วันสิ้นงวด [Express: ISPRD.ENDn]';
COMMENT ON COLUMN gl_period.is_locked IS 'ปิดงวดแล้ว ห้ามบันทึก/แก้ไข [Express: ISPRD.LOCKn]';
COMMENT ON COLUMN gl_period.locked_by IS 'ผู้ปิดงวด';
COMMENT ON COLUMN gl_period.locked_at IS 'เวลาที่ปิดงวด';
COMMENT ON COLUMN gl_period.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN gl_period.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN gl_period.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN gl_period.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN gl_period.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN gl_period.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN gl_period.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_gl_period_company_fiscal_year_period_no ON gl_period (company_id, fiscal_year_id, period_no) WHERE deleted_at IS NULL;

-- gl_account: ผังบัญชี  [Express: GLACC]
CREATE TABLE gl_account (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  account_no varchar(20) NOT NULL,
  name_th varchar(120) NOT NULL,
  name_en varchar(120),
  parent_id uuid,
  level smallint DEFAULT 1 NOT NULL,
  account_group char(1) NOT NULL CHECK (account_group IN ('1','2','3','4','5')),
  is_control boolean DEFAULT false NOT NULL,
  normal_side char(1) NOT NULL CHECK (normal_side IN ('D','C')),
  use_department boolean DEFAULT false NOT NULL,
  use_project boolean DEFAULT false NOT NULL,
  consol_account varchar(20),
  status char(1) DEFAULT 'A' NOT NULL CHECK (status IN ('A','I')),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE gl_account IS 'ผังบัญชี | Express: GLACC';
COMMENT ON COLUMN gl_account.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN gl_account.company_id IS 'บริษัท';
COMMENT ON COLUMN gl_account.account_no IS 'เลขที่บัญชี (ตาม mask เช่น 9999-99) [Express: GLACC.ACCNUM]';
COMMENT ON COLUMN gl_account.name_th IS 'ชื่อบัญชีภาษาไทย [Express: GLACC.ACCNAM]';
COMMENT ON COLUMN gl_account.name_en IS 'ชื่อบัญชีภาษาอังกฤษ [Express: GLACC.ACCNAM2]';
COMMENT ON COLUMN gl_account.parent_id IS 'บัญชีคุม [Express: GLACC.PARENT]';
COMMENT ON COLUMN gl_account.level IS 'ระดับบัญชี 1–9 [Express: GLACC.LEVEL]';
COMMENT ON COLUMN gl_account.account_group IS 'หมวด 1=สินทรัพย์ 2=หนี้สิน 3=ทุน 4=รายได้ 5=ค่าใช้จ่าย [Express: GLACC.GROUP]';
COMMENT ON COLUMN gl_account.is_control IS 'บัญชีคุม (ห้ามลงรายการโดยตรง) [Express: GLACC.ACCTYP (1=คุม 0=ย่อย)]';
COMMENT ON COLUMN gl_account.normal_side IS 'ยอดปกติ D=เดบิต C=เครดิต [Express: GLACC.NATURE (0=D 1=C)]';
COMMENT ON COLUMN gl_account.use_department IS 'ต้องระบุแผนกเมื่อลงบัญชี [Express: GLACC.USEDEP]';
COMMENT ON COLUMN gl_account.use_project IS 'ต้องระบุโครงการ/Job [Express: GLACC.USEJOB]';
COMMENT ON COLUMN gl_account.consol_account IS 'บัญชีสำหรับรวมงบ [Express: GLACC.CONSOL]';
COMMENT ON COLUMN gl_account.status IS 'สถานะ [Express: GLACC.STATUS]';
COMMENT ON COLUMN gl_account.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN gl_account.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN gl_account.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN gl_account.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN gl_account.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN gl_account.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN gl_account.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_gl_account_company_account_no ON gl_account (company_id, account_no) WHERE deleted_at IS NULL;

-- gl_journal_book: สมุดรายวัน (00 ทั่วไป 01 จ่าย 02 รับ 03 ขาย 04 ซื้อ …)  [Express: ISRUN (DOCTYP='GL') + ISTAB TABTYP 10]
CREATE TABLE gl_journal_book (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  code varchar(10) NOT NULL,
  prefix varchar(10) NOT NULL,
  name_th varchar(120) NOT NULL,
  name_en varchar(120),
  template_id uuid,
  approve_level smallint DEFAULT 0 NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE gl_journal_book IS 'สมุดรายวัน (00 ทั่วไป 01 จ่าย 02 รับ 03 ขาย 04 ซื้อ …) | Express: ISRUN (DOCTYP=''GL'') + ISTAB TABTYP 10';
COMMENT ON COLUMN gl_journal_book.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN gl_journal_book.company_id IS 'บริษัท';
COMMENT ON COLUMN gl_journal_book.code IS 'รหัสสมุด เช่น 00 [Express: ISRUN.DOCCOD]';
COMMENT ON COLUMN gl_journal_book.prefix IS 'prefix เลขที่ใบสำคัญ เช่น JV PV RV SV UV [Express: ISRUN.PREFIX]';
COMMENT ON COLUMN gl_journal_book.name_th IS 'ชื่อสมุด [Express: ISRUN.POSDES]';
COMMENT ON COLUMN gl_journal_book.name_en IS 'ชื่อภาษาอังกฤษ [Express: ISRUN.POSDES2]';
COMMENT ON COLUMN gl_journal_book.template_id IS 'แม่แบบรายการบัญชีเริ่มต้น';
COMMENT ON COLUMN gl_journal_book.approve_level IS 'ระดับอนุมัติ';
COMMENT ON COLUMN gl_journal_book.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN gl_journal_book.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN gl_journal_book.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN gl_journal_book.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN gl_journal_book.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN gl_journal_book.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN gl_journal_book.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_gl_journal_book_company_code ON gl_journal_book (company_id, code) WHERE deleted_at IS NULL;

-- gl_default_account: บัญชีมาตรฐานสำหรับลงบัญชีอัตโนมัติ (34 บทบาท) — ชั้นที่ 3 ของการหาบัญชี  [Express: ISINFO.ACCNUM00–ACCNUM34 (เริ่มระบบ 5.2)]
CREATE TABLE gl_default_account (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  role varchar(30) NOT NULL,
  account_id uuid NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE gl_default_account IS 'บัญชีมาตรฐานสำหรับลงบัญชีอัตโนมัติ (34 บทบาท) — ชั้นที่ 3 ของการหาบัญชี | Express: ISINFO.ACCNUM00–ACCNUM34 (เริ่มระบบ 5.2)';
COMMENT ON COLUMN gl_default_account.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN gl_default_account.company_id IS 'บริษัท';
COMMENT ON COLUMN gl_default_account.role IS 'บทบาทบัญชี เช่น CASH AR INVENTORY OUTPUT_VAT (ดู seed)';
COMMENT ON COLUMN gl_default_account.account_id IS 'บัญชี';
COMMENT ON COLUMN gl_default_account.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN gl_default_account.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN gl_default_account.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN gl_default_account.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN gl_default_account.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN gl_default_account.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN gl_default_account.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_gl_default_account_company_role ON gl_default_account (company_id, role) WHERE deleted_at IS NULL;

-- gl_journal_route: ประเภทรายการ → สมุดรายวันที่ใช้ลงบัญชี  [Express: ISINFO.*JNL (CRESALJNL, ARRCPJNL …)]
CREATE TABLE gl_journal_route (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  txn_kind varchar(30) NOT NULL,
  journal_book_id uuid NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE gl_journal_route IS 'ประเภทรายการ → สมุดรายวันที่ใช้ลงบัญชี | Express: ISINFO.*JNL (CRESALJNL, ARRCPJNL …)';
COMMENT ON COLUMN gl_journal_route.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN gl_journal_route.company_id IS 'บริษัท';
COMMENT ON COLUMN gl_journal_route.txn_kind IS 'ประเภทรายการ เช่น CREDIT_SALE AR_RECEIPT PASS_CHEQUE_RCV';
COMMENT ON COLUMN gl_journal_route.journal_book_id IS 'สมุดรายวัน';
COMMENT ON COLUMN gl_journal_route.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN gl_journal_route.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN gl_journal_route.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN gl_journal_route.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN gl_journal_route.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN gl_journal_route.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN gl_journal_route.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_gl_journal_route_company_txn_kind ON gl_journal_route (company_id, txn_kind) WHERE deleted_at IS NULL;

-- gl_posting_rule: กฎการลงบัญชีอัตโนมัติ: เอกสารแต่ละชนิดลง Dr/Cr บทบาทใด ด้วยยอดใด  [Express: (ใหม่ — ทำให้ตรรกะที่ Express ฝังในโปรแกรมเป็นข้อมูล)]
CREATE TABLE gl_posting_rule (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  doc_class varchar(4) NOT NULL,
  seq smallint NOT NULL,
  condition varchar(40),
  side char(1) NOT NULL CHECK (side IN ('D','C')),
  account_role varchar(30) NOT NULL,
  amount_source varchar(40) NOT NULL,
  per char(1) DEFAULT 'H' NOT NULL CHECK (per IN ('H','L','P','S')),
  description varchar(200),
  is_assumed boolean DEFAULT false NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE gl_posting_rule IS 'กฎการลงบัญชีอัตโนมัติ: เอกสารแต่ละชนิดลง Dr/Cr บทบาทใด ด้วยยอดใด | Express: (ใหม่ — ทำให้ตรรกะที่ Express ฝังในโปรแกรมเป็นข้อมูล)';
COMMENT ON COLUMN gl_posting_rule.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN gl_posting_rule.company_id IS 'บริษัท';
COMMENT ON COLUMN gl_posting_rule.doc_class IS 'หมวดเอกสาร (doc_header.doc_class) เช่น IV RE RR CN';
COMMENT ON COLUMN gl_posting_rule.seq IS 'ลำดับบรรทัด';
COMMENT ON COLUMN gl_posting_rule.condition IS 'เงื่อนไข เช่น PERPETUAL_ONLY, VAT_ACCRUAL, VAT_CASH, HAS_DEPOSIT';
COMMENT ON COLUMN gl_posting_rule.side IS 'D หรือ C';
COMMENT ON COLUMN gl_posting_rule.account_role IS 'บทบาทบัญชีที่ต้องหา เช่น AR SALES OUTPUT_VAT';
COMMENT ON COLUMN gl_posting_rule.amount_source IS 'ยอดที่ใช้ เช่น H.net_amount H.vat_amount L.cost_amount P.amount';
COMMENT ON COLUMN gl_posting_rule.per IS 'H=ต่อเอกสาร L=ต่อบรรทัดรายการ P=ต่อบรรทัดวิธีชำระ S=ต่อรายการตัดหนี้';
COMMENT ON COLUMN gl_posting_rule.description IS 'คำอธิบาย';
COMMENT ON COLUMN gl_posting_rule.is_assumed IS 'คู่มือไม่ได้ระบุ ผู้ออกแบบอนุมาน — ต้องให้ผู้สอบบัญชียืนยัน';
COMMENT ON COLUMN gl_posting_rule.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN gl_posting_rule.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN gl_posting_rule.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN gl_posting_rule.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN gl_posting_rule.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN gl_posting_rule.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN gl_posting_rule.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_gl_posting_rule_company_doc_class_seq ON gl_posting_rule (company_id, doc_class, seq) WHERE deleted_at IS NULL;

-- gl_template: แม่แบบรายการบัญชี  [Express: GLTPL]
CREATE TABLE gl_template (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  code varchar(10) NOT NULL,
  name varchar(120) NOT NULL,
  name_en varchar(120),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE gl_template IS 'แม่แบบรายการบัญชี | Express: GLTPL';
COMMENT ON COLUMN gl_template.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN gl_template.company_id IS 'บริษัท';
COMMENT ON COLUMN gl_template.code IS 'รหัสแม่แบบ [Express: GLTPL.TPLCOD]';
COMMENT ON COLUMN gl_template.name IS 'คำอธิบาย [Express: GLTPL.DESCRP]';
COMMENT ON COLUMN gl_template.name_en IS 'คำอธิบายภาษาอังกฤษ [Express: GLTPL.DESCRP2]';
COMMENT ON COLUMN gl_template.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN gl_template.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN gl_template.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN gl_template.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN gl_template.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN gl_template.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN gl_template.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_gl_template_company_code ON gl_template (company_id, code) WHERE deleted_at IS NULL;

-- gl_template_line: บรรทัดของแม่แบบ  [Express: GLTPLIT]
CREATE TABLE gl_template_line (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  template_id uuid NOT NULL,
  line_no smallint NOT NULL,
  account_id uuid,
  department_id uuid,
  description varchar(120),
  side char(1) NOT NULL CHECK (side IN ('D','C')),
  amount numeric(18,2),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE gl_template_line IS 'บรรทัดของแม่แบบ | Express: GLTPLIT';
COMMENT ON COLUMN gl_template_line.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN gl_template_line.company_id IS 'บริษัท';
COMMENT ON COLUMN gl_template_line.template_id IS 'แม่แบบ';
COMMENT ON COLUMN gl_template_line.line_no IS 'ลำดับ';
COMMENT ON COLUMN gl_template_line.account_id IS 'บัญชี [Express: GLTPLIT.ACCNUM]';
COMMENT ON COLUMN gl_template_line.department_id IS 'แผนก [Express: GLTPLIT.DEPCOD]';
COMMENT ON COLUMN gl_template_line.description IS 'คำอธิบาย [Express: GLTPLIT.DESCRP]';
COMMENT ON COLUMN gl_template_line.side IS 'D/C [Express: GLTPLIT.JNLTYP (0=D 1=C)]';
COMMENT ON COLUMN gl_template_line.amount IS 'จำนวนเงิน (ว่าง = ให้ป้อน) [Express: GLTPLIT.AMOUNT]';
COMMENT ON COLUMN gl_template_line.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN gl_template_line.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN gl_template_line.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN gl_template_line.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN gl_template_line.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN gl_template_line.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN gl_template_line.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_gl_template_line_template_line_no ON gl_template_line (template_id, line_no) WHERE deleted_at IS NULL;

-- md_lookup_type: ชนิดตารางอ้างอิง (TABTYP)  [Express: ISTAB.TABTYP]
CREATE TABLE md_lookup_type (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  code varchar(4) NOT NULL,
  name_th varchar(120) NOT NULL,
  has_rate boolean DEFAULT false NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE md_lookup_type IS 'ชนิดตารางอ้างอิง (TABTYP) | Express: ISTAB.TABTYP';
COMMENT ON COLUMN md_lookup_type.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN md_lookup_type.code IS 'รหัสชนิด เช่น 22 หมวดสินค้า 40 เขตการขาย';
COMMENT ON COLUMN md_lookup_type.name_th IS 'ชื่อชนิด';
COMMENT ON COLUMN md_lookup_type.has_rate IS 'มีช่องอัตรา/ตัวเลข';
COMMENT ON COLUMN md_lookup_type.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN md_lookup_type.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN md_lookup_type.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN md_lookup_type.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN md_lookup_type.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN md_lookup_type.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN md_lookup_type.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_md_lookup_type_code ON md_lookup_type (code) WHERE deleted_at IS NULL;

-- md_lookup: ตารางอ้างอิงทั่วไป (หมวดสินค้า เขตการขาย ขนส่งโดย เหตุผลยกเลิก ประเภทลูกค้า ฯลฯ)  [Express: ISTAB]
CREATE TABLE md_lookup (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  type_code varchar(4) NOT NULL,
  code varchar(10) NOT NULL,
  short_th varchar(30),
  short_en varchar(30),
  name_th varchar(120) NOT NULL,
  name_en varchar(120),
  rate numeric(18,4),
  status char(1) DEFAULT 'A' NOT NULL CHECK (status IN ('A','I')),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE md_lookup IS 'ตารางอ้างอิงทั่วไป (หมวดสินค้า เขตการขาย ขนส่งโดย เหตุผลยกเลิก ประเภทลูกค้า ฯลฯ) | Express: ISTAB';
COMMENT ON COLUMN md_lookup.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN md_lookup.company_id IS 'บริษัท';
COMMENT ON COLUMN md_lookup.type_code IS 'ชนิด (md_lookup_type.code) [Express: ISTAB.TABTYP]';
COMMENT ON COLUMN md_lookup.code IS 'รหัส [Express: ISTAB.TYPCOD]';
COMMENT ON COLUMN md_lookup.short_th IS 'ชื่อย่อไทย [Express: ISTAB.SHORTNAM]';
COMMENT ON COLUMN md_lookup.short_en IS 'ชื่อย่ออังกฤษ [Express: ISTAB.SHORTNAM2]';
COMMENT ON COLUMN md_lookup.name_th IS 'ชื่อเต็มไทย [Express: ISTAB.TYPDES]';
COMMENT ON COLUMN md_lookup.name_en IS 'ชื่อเต็มอังกฤษ [Express: ISTAB.TYPDES2]';
COMMENT ON COLUMN md_lookup.rate IS 'อัตรา/ตัวเลขประกอบ [Express: ISTAB.FLD02]';
COMMENT ON COLUMN md_lookup.status IS 'สถานะ [Express: ISTAB.STATUS]';
COMMENT ON COLUMN md_lookup.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN md_lookup.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN md_lookup.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN md_lookup.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN md_lookup.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN md_lookup.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN md_lookup.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_md_lookup_company_type_code_code ON md_lookup (company_id, type_code, code) WHERE deleted_at IS NULL;

-- md_unit: หน่วยนับ  [Express: ISTAB TABTYP '20']
CREATE TABLE md_unit (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  code varchar(10) NOT NULL,
  name_th varchar(60) NOT NULL,
  name_en varchar(60),
  short_th varchar(30),
  short_en varchar(30),
  rate numeric(18,4),
  status char(1) DEFAULT 'A' NOT NULL CHECK (status IN ('A','I')),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE md_unit IS 'หน่วยนับ | Express: ISTAB TABTYP ''20''';
COMMENT ON COLUMN md_unit.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN md_unit.company_id IS 'บริษัท';
COMMENT ON COLUMN md_unit.code IS 'รหัสหน่วย เช่น PC MT [Express: ISTAB.TYPCOD]';
COMMENT ON COLUMN md_unit.name_th IS 'ชื่อหน่วย [Express: ISTAB.TYPDES]';
COMMENT ON COLUMN md_unit.name_en IS 'ชื่อภาษาอังกฤษ [Express: ISTAB.TYPDES2]';
COMMENT ON COLUMN md_unit.short_th IS 'ชื่อย่อไทย [Express: ISTAB.SHORTNAM]';
COMMENT ON COLUMN md_unit.short_en IS 'ชื่อย่ออังกฤษ [Express: ISTAB.SHORTNAM2]';
COMMENT ON COLUMN md_unit.rate IS 'อัตรา: ตัวคูณให้เป็นหน่วยย่อย เช่น โหล = 12 (คู่มือหน้า 87) [Express: ISTAB.FLD02]';
COMMENT ON COLUMN md_unit.status IS 'สถานะ';
COMMENT ON COLUMN md_unit.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN md_unit.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN md_unit.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN md_unit.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN md_unit.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN md_unit.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN md_unit.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_md_unit_company_code ON md_unit (company_id, code) WHERE deleted_at IS NULL;

-- md_warehouse: คลังสินค้า  [Express: ISTAB TABTYP '21']
CREATE TABLE md_warehouse (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  code varchar(10) NOT NULL,
  name_th varchar(120) NOT NULL,
  name_en varchar(120),
  short_th varchar(30),
  short_en varchar(30),
  branch_id uuid,
  status char(1) DEFAULT 'A' NOT NULL CHECK (status IN ('A','I')),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE md_warehouse IS 'คลังสินค้า | Express: ISTAB TABTYP ''21''';
COMMENT ON COLUMN md_warehouse.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN md_warehouse.company_id IS 'บริษัท';
COMMENT ON COLUMN md_warehouse.code IS 'รหัสคลัง เช่น HO SW [Express: ISTAB.TYPCOD]';
COMMENT ON COLUMN md_warehouse.name_th IS 'ชื่อคลัง [Express: ISTAB.TYPDES]';
COMMENT ON COLUMN md_warehouse.name_en IS 'ชื่อภาษาอังกฤษ [Express: ISTAB.TYPDES2]';
COMMENT ON COLUMN md_warehouse.short_th IS 'ชื่อย่อไทย [Express: ISTAB.SHORTNAM]';
COMMENT ON COLUMN md_warehouse.short_en IS 'ชื่อย่ออังกฤษ [Express: ISTAB.SHORTNAM2]';
COMMENT ON COLUMN md_warehouse.branch_id IS 'สาขาที่คลังสังกัด';
COMMENT ON COLUMN md_warehouse.status IS 'สถานะ';
COMMENT ON COLUMN md_warehouse.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN md_warehouse.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN md_warehouse.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN md_warehouse.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN md_warehouse.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN md_warehouse.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN md_warehouse.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_md_warehouse_company_code ON md_warehouse (company_id, code) WHERE deleted_at IS NULL;

-- md_department: แผนก / ศูนย์ต้นทุน  [Express: ISTAB TABTYP '50']
CREATE TABLE md_department (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  code varchar(10) NOT NULL,
  name_th varchar(120) NOT NULL,
  name_en varchar(120),
  short_name_th varchar(30),
  short_name_en varchar(30),
  status char(1) DEFAULT 'A' NOT NULL CHECK (status IN ('A','I')),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE md_department IS 'แผนก / ศูนย์ต้นทุน | Express: ISTAB TABTYP ''50''';
COMMENT ON COLUMN md_department.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN md_department.company_id IS 'บริษัท';
COMMENT ON COLUMN md_department.code IS 'รหัสแผนก [Express: ISTAB.TYPCOD]';
COMMENT ON COLUMN md_department.name_th IS 'ชื่อเต็มไทย [Express: ISTAB.TYPDES]';
COMMENT ON COLUMN md_department.name_en IS 'ชื่อเต็มอังกฤษ [Express: ISTAB.TYPDES2]';
COMMENT ON COLUMN md_department.short_name_th IS 'ชื่อย่อไทย (คู่มือบทที่ 6 หน้า 90) [Express: ISTAB.SHORTNAM]';
COMMENT ON COLUMN md_department.short_name_en IS 'ชื่อย่ออังกฤษ [Express: ISTAB.SHORTNAM2]';
COMMENT ON COLUMN md_department.status IS 'สถานะ';
COMMENT ON COLUMN md_department.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN md_department.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN md_department.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN md_department.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN md_department.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN md_department.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN md_department.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_md_department_company_code ON md_department (company_id, code) WHERE deleted_at IS NULL;

-- md_bank: ธนาคาร  [Express: ISTAB TABTYP '01']
CREATE TABLE md_bank (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  code varchar(10) NOT NULL,
  name_th varchar(120) NOT NULL,
  name_en varchar(120),
  short_th varchar(30),
  short_en varchar(30),
  status char(1) DEFAULT 'A' NOT NULL CHECK (status IN ('A','I')),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE md_bank IS 'ธนาคาร | Express: ISTAB TABTYP ''01''';
COMMENT ON COLUMN md_bank.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN md_bank.company_id IS 'บริษัท';
COMMENT ON COLUMN md_bank.code IS 'รหัสธนาคาร [Express: ISTAB.TYPCOD]';
COMMENT ON COLUMN md_bank.name_th IS 'ชื่อธนาคาร [Express: ISTAB.TYPDES]';
COMMENT ON COLUMN md_bank.name_en IS 'ชื่อภาษาอังกฤษ [Express: ISTAB.TYPDES2]';
COMMENT ON COLUMN md_bank.short_th IS 'ชื่อย่อไทย [Express: ISTAB.SHORTNAM]';
COMMENT ON COLUMN md_bank.short_en IS 'ชื่อย่ออังกฤษ [Express: ISTAB.SHORTNAM2]';
COMMENT ON COLUMN md_bank.status IS 'สถานะ';
COMMENT ON COLUMN md_bank.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN md_bank.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN md_bank.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN md_bank.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN md_bank.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN md_bank.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN md_bank.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_md_bank_company_code ON md_bank (company_id, code) WHERE deleted_at IS NULL;

-- md_project: โครงการ / Job  [Express: JBMAS]
CREATE TABLE md_project (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  code varchar(10) NOT NULL,
  name_th varchar(120) NOT NULL,
  name_en varchar(120),
  customer_id uuid,
  start_date date,
  end_date date,
  status char(1) DEFAULT 'A' NOT NULL CHECK (status IN ('A','I')),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE md_project IS 'โครงการ / Job | Express: JBMAS';
COMMENT ON COLUMN md_project.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN md_project.company_id IS 'บริษัท';
COMMENT ON COLUMN md_project.code IS 'รหัสโครงการ [Express: JBMAS.JOBCOD]';
COMMENT ON COLUMN md_project.name_th IS 'ชื่อโครงการ [Express: JBMAS.JOBNAM]';
COMMENT ON COLUMN md_project.name_en IS 'ชื่อภาษาอังกฤษ [Express: JBMAS.JOBNAM2]';
COMMENT ON COLUMN md_project.customer_id IS 'ลูกค้า [Express: JBMAS.CUSCOD]';
COMMENT ON COLUMN md_project.start_date IS 'วันเริ่ม [Express: JBMAS.BEGIN]';
COMMENT ON COLUMN md_project.end_date IS 'วันสิ้นสุด [Express: JBMAS.END]';
COMMENT ON COLUMN md_project.status IS 'สถานะ [Express: JBMAS.STATUS]';
COMMENT ON COLUMN md_project.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN md_project.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN md_project.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN md_project.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN md_project.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN md_project.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN md_project.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_md_project_company_code ON md_project (company_id, code) WHERE deleted_at IS NULL;

-- md_project_budget: งบประมาณโครงการแยกขั้นตอน/รหัสต้นทุน  [Express: JBLIST]
CREATE TABLE md_project_budget (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  phase varchar(10),
  cost_code varchar(10),
  est_expense numeric(18,2),
  est_revenue numeric(18,2),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE md_project_budget IS 'งบประมาณโครงการแยกขั้นตอน/รหัสต้นทุน | Express: JBLIST';
COMMENT ON COLUMN md_project_budget.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN md_project_budget.company_id IS 'บริษัท';
COMMENT ON COLUMN md_project_budget.project_id IS 'โครงการ';
COMMENT ON COLUMN md_project_budget.phase IS 'ขั้นตอน [Express: JBLIST.PHASE]';
COMMENT ON COLUMN md_project_budget.cost_code IS 'รหัสต้นทุน [Express: JBLIST.COSCOD]';
COMMENT ON COLUMN md_project_budget.est_expense IS 'ประมาณการค่าใช้จ่าย [Express: JBLIST.ESTEXP]';
COMMENT ON COLUMN md_project_budget.est_revenue IS 'ประมาณการรายได้ [Express: JBLIST.ESTREV]';
COMMENT ON COLUMN md_project_budget.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN md_project_budget.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN md_project_budget.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN md_project_budget.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN md_project_budget.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN md_project_budget.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN md_project_budget.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_md_project_budget_project_phase_cost_code ON md_project_budget (project_id, phase, cost_code) WHERE deleted_at IS NULL;

-- md_item_account_group: กลุ่มบัญชีสินค้า — ชั้นที่ 2 ของการหาบัญชีสำหรับสินค้า  [Express: ISACC (ACCTYP='S')]
CREATE TABLE md_item_account_group (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  code varchar(10) NOT NULL,
  name_th varchar(120) NOT NULL,
  name_en varchar(120),
  cost_method char(1) CHECK (cost_method IS NULL OR cost_method IN ('F','A')),
  item_specific boolean DEFAULT false NOT NULL,
  inventory_account_id uuid,
  cogs_account_id uuid,
  sales_account_id uuid,
  sales_return_account_id uuid,
  purchase_account_id uuid,
  purchase_return_account_id uuid,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE md_item_account_group IS 'กลุ่มบัญชีสินค้า — ชั้นที่ 2 ของการหาบัญชีสำหรับสินค้า | Express: ISACC (ACCTYP=''S'')';
COMMENT ON COLUMN md_item_account_group.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN md_item_account_group.company_id IS 'บริษัท';
COMMENT ON COLUMN md_item_account_group.code IS 'รหัสกลุ่ม [Express: ISACC.ACCCOD]';
COMMENT ON COLUMN md_item_account_group.name_th IS 'ชื่อกลุ่ม [Express: ISACC.ACCDES]';
COMMENT ON COLUMN md_item_account_group.name_en IS 'ชื่อภาษาอังกฤษ [Express: ISACC.ACCDES2]';
COMMENT ON COLUMN md_item_account_group.cost_method IS 'F=FIFO A=ถัวเฉลี่ย (ว่าง=ตามค่าบริษัท) [Express: ISACC.METHOD]';
COMMENT ON COLUMN md_item_account_group.item_specific IS 'กลุ่มเฉพาะของสินค้าบริการ/รายได้อื่น/ค่าใช้จ่ายอื่น 1 รายการ (Express METHOD=''-'') — ไม่แสดงในรายการกลุ่มบัญชี แก้ที่หน้าจอสินค้า [Express: ISACC.METHOD=''-'']';
COMMENT ON COLUMN md_item_account_group.inventory_account_id IS 'บัญชีสินค้า (ค่าใช้จ่าย สำหรับรหัสค่าใช้จ่ายอื่น) [Express: ISACC.ACCNUM01]';
COMMENT ON COLUMN md_item_account_group.cogs_account_id IS 'บัญชีต้นทุนขาย [Express: ISACC.ACCNUM02]';
COMMENT ON COLUMN md_item_account_group.sales_account_id IS 'บัญชีขาย [Express: ISACC.ACCNUM03]';
COMMENT ON COLUMN md_item_account_group.sales_return_account_id IS 'บัญชีรับคืน [Express: ISACC.ACCNUM04]';
COMMENT ON COLUMN md_item_account_group.purchase_account_id IS 'บัญชีซื้อ (Periodic) [Express: ISACC.ACCNUM05]';
COMMENT ON COLUMN md_item_account_group.purchase_return_account_id IS 'บัญชีส่งคืน (Periodic) [Express: ISACC.ACCNUM06]';
COMMENT ON COLUMN md_item_account_group.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN md_item_account_group.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN md_item_account_group.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN md_item_account_group.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN md_item_account_group.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN md_item_account_group.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN md_item_account_group.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_md_item_account_group_company_code ON md_item_account_group (company_id, code) WHERE deleted_at IS NULL;

-- md_item: สินค้า / บริการ / รหัสค่าใช้จ่ายอื่น / รหัสรายได้อื่น  [Express: STMAS]
CREATE TABLE md_item (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  code varchar(30) NOT NULL,
  item_type char(1) DEFAULT '0' NOT NULL CHECK (item_type IN ('0','1','2','3','4','5')),
  barcode varchar(30),
  name_th varchar(120) NOT NULL,
  name_en varchar(120),
  item_level varchar(4),
  category_code varchar(10),
  account_group_id uuid,
  base_unit_id uuid,
  count_unit_id uuid,
  count_factor numeric(18,4),
  purchase_unit_id uuid,
  purchase_factor numeric(18,4) DEFAULT 1 NOT NULL,
  sales_unit_id uuid,
  sales_factor numeric(18,4) DEFAULT 1 NOT NULL,
  std_cost numeric(18,4),
  price_1 numeric(18,4),
  price_2 numeric(18,4),
  price_3 numeric(18,4),
  price_4 numeric(18,4),
  price_5 numeric(18,4),
  vat_code char(1),
  allow_negative char(1),
  default_supplier_id uuid,
  substitute_item_id uuid,
  packing varchar(30),
  udf_1 varchar(30),
  udf_2 varchar(30),
  udf_3 varchar(30),
  udf_4 varchar(30),
  udf_date_1 date,
  udf_date_2 date,
  udf_num_1 numeric(18,4),
  remark text,
  status char(1) DEFAULT 'A' NOT NULL CHECK (status IN ('A','I')),
  inactive_date date,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE md_item IS 'สินค้า / บริการ / รหัสค่าใช้จ่ายอื่น / รหัสรายได้อื่น | Express: STMAS | ยอดคงเหลือ/ราคาซื้อขายล่าสุด (TOTBAL, LPURPR, LSELLPR …) ไม่เก็บในแฟ้มหลัก ย้ายไป inv_stock_balance ซึ่งคำนวณจากรายการ';
COMMENT ON COLUMN md_item.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN md_item.company_id IS 'บริษัท';
COMMENT ON COLUMN md_item.code IS 'รหัสสินค้า [Express: STMAS.STKCOD]';
COMMENT ON COLUMN md_item.item_type IS '0=สินค้า 1=สินค้าชุดธรรมดา 2=สินค้าชุดพิเศษ 3=สินค้าบริการ 4=รายได้อื่น 5=ค่าใช้จ่ายอื่น [Express: STMAS.STKTYP]';
COMMENT ON COLUMN md_item.barcode IS 'บาร์โค้ด [Express: STMAS.BARCOD]';
COMMENT ON COLUMN md_item.name_th IS 'ชื่อสินค้า [Express: STMAS.STKDES]';
COMMENT ON COLUMN md_item.name_en IS 'ชื่อภาษาอังกฤษ [Express: STMAS.STKDES2]';
COMMENT ON COLUMN md_item.item_level IS 'ระดับสินค้า (วัตถุดิบ/ประกอบ/สำเร็จรูป) lookup 23 [Express: STMAS.STKLEV]';
COMMENT ON COLUMN md_item.category_code IS 'หมวดสินค้า lookup 22 [Express: STMAS.STKGRP]';
COMMENT ON COLUMN md_item.account_group_id IS 'กลุ่มบัญชีสินค้า [Express: STMAS.ACCCOD]';
COMMENT ON COLUMN md_item.base_unit_id IS 'หน่วยนับหลัก (หน่วยเล็ก) [Express: STMAS.QUCOD]';
COMMENT ON COLUMN md_item.count_unit_id IS 'หน่วยนับสต๊อก/ตรวจนับ [Express: STMAS.CQUCOD]';
COMMENT ON COLUMN md_item.count_factor IS 'ตัวคูณหน่วยตรวจนับ [Express: STMAS.CFACTOR]';
COMMENT ON COLUMN md_item.purchase_unit_id IS 'หน่วยซื้อ [Express: STMAS.PQUCOD]';
COMMENT ON COLUMN md_item.purchase_factor IS 'ตัวคูณหน่วยซื้อ [Express: STMAS.PFACTOR]';
COMMENT ON COLUMN md_item.sales_unit_id IS 'หน่วยขาย [Express: STMAS.SQUCOD]';
COMMENT ON COLUMN md_item.sales_factor IS 'ตัวคูณหน่วยขาย [Express: STMAS.SFACTOR]';
COMMENT ON COLUMN md_item.std_cost IS 'ราคาทุนมาตรฐาน [Express: STMAS.STNPR]';
COMMENT ON COLUMN md_item.price_1 IS 'ราคาขาย 1 [Express: STMAS.SELLPR1]';
COMMENT ON COLUMN md_item.price_2 IS 'ราคาขาย 2 [Express: STMAS.SELLPR2]';
COMMENT ON COLUMN md_item.price_3 IS 'ราคาขาย 3 [Express: STMAS.SELLPR3]';
COMMENT ON COLUMN md_item.price_4 IS 'ราคาขาย 4 [Express: STMAS.SELLPR4]';
COMMENT ON COLUMN md_item.price_5 IS 'ราคาขาย 5 [Express: STMAS.SELLPR5]';
COMMENT ON COLUMN md_item.vat_code IS 'ประเภท VAT ของสินค้า (0=ยกเว้น 1=มี VAT ว่าง=ตามเอกสาร) [Express: STMAS.VATCOD]';
COMMENT ON COLUMN md_item.allow_negative IS 'Y/N/A=ตามค่าบริษัท [Express: STMAS.NEGALLOW]';
COMMENT ON COLUMN md_item.default_supplier_id IS 'ผู้จำหน่ายหลัก [Express: STMAS.SUPCOD]';
COMMENT ON COLUMN md_item.substitute_item_id IS 'สินค้าทดแทน [Express: STMAS.STKCODS]';
COMMENT ON COLUMN md_item.packing IS 'บรรจุ/หีบห่อ [Express: STMAS.PACKING]';
COMMENT ON COLUMN md_item.udf_1 IS 'ช่องกำหนดเอง 1 (ISINFO.ST_STR1) [Express: STMAS.STR1]';
COMMENT ON COLUMN md_item.udf_2 IS 'ช่องกำหนดเอง 2 [Express: STMAS.STR2]';
COMMENT ON COLUMN md_item.udf_3 IS 'ช่องกำหนดเอง 3 [Express: STMAS.STR3]';
COMMENT ON COLUMN md_item.udf_4 IS 'ช่องกำหนดเอง 4 [Express: STMAS.STR4]';
COMMENT ON COLUMN md_item.udf_date_1 IS 'วันที่กำหนดเอง (เช่น วันหมดอายุ) [Express: STMAS.DAT1]';
COMMENT ON COLUMN md_item.udf_date_2 IS 'วันที่กำหนดเอง 2 [Express: STMAS.DAT2]';
COMMENT ON COLUMN md_item.udf_num_1 IS 'ตัวเลขกำหนดเอง [Express: STMAS.NUM1]';
COMMENT ON COLUMN md_item.remark IS 'หมายเหตุ [Express: STMAS.REMARK]';
COMMENT ON COLUMN md_item.status IS 'สถานะ [Express: STMAS.STATUS]';
COMMENT ON COLUMN md_item.inactive_date IS 'วันที่เลิกใช้ [Express: STMAS.INACTDAT]';
COMMENT ON COLUMN md_item.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN md_item.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN md_item.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN md_item.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN md_item.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN md_item.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN md_item.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_md_item_company_code ON md_item (company_id, code) WHERE deleted_at IS NULL;
CREATE INDEX ix_md_item_company_barcode ON md_item (company_id, barcode);
CREATE INDEX ix_md_item_company_name_th ON md_item (company_id, name_th);

-- md_item_bom: ส่วนประกอบสินค้าชุด  [Express: STBOM]
CREATE TABLE md_item_bom (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  parent_item_id uuid NOT NULL,
  line_no smallint NOT NULL,
  component_item_id uuid NOT NULL,
  qty numeric(18,4) NOT NULL,
  std_cost numeric(18,4),
  sell_price numeric(18,4),
  warehouse_id uuid,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE md_item_bom IS 'ส่วนประกอบสินค้าชุด | Express: STBOM';
COMMENT ON COLUMN md_item_bom.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN md_item_bom.company_id IS 'บริษัท';
COMMENT ON COLUMN md_item_bom.parent_item_id IS 'สินค้าชุด [Express: STBOM.PSTKCOD]';
COMMENT ON COLUMN md_item_bom.line_no IS 'ลำดับ [Express: STBOM.SEQNUM]';
COMMENT ON COLUMN md_item_bom.component_item_id IS 'สินค้าประกอบ [Express: STBOM.STKCOD]';
COMMENT ON COLUMN md_item_bom.qty IS 'จำนวนต่อชุด [Express: STBOM.BOMQTY]';
COMMENT ON COLUMN md_item_bom.std_cost IS 'ราคาทุน [Express: STBOM.STNPR]';
COMMENT ON COLUMN md_item_bom.sell_price IS 'ราคาขาย [Express: STBOM.SELLPR]';
COMMENT ON COLUMN md_item_bom.warehouse_id IS 'คลังที่ตัดส่วนประกอบ [Express: STBOM.LOCCOD]';
COMMENT ON COLUMN md_item_bom.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN md_item_bom.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN md_item_bom.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN md_item_bom.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN md_item_bom.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN md_item_bom.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN md_item_bom.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_md_item_bom_parent_item_line_no ON md_item_bom (parent_item_id, line_no) WHERE deleted_at IS NULL;

-- md_item_price_break: ตารางราคาตามปริมาณ/ช่วงเวลา  [Express: STPRI]
CREATE TABLE md_item_price_break (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  item_id uuid NOT NULL,
  unit_id uuid,
  factor numeric(18,4),
  min_qty numeric(18,4) NOT NULL,
  is_percent boolean DEFAULT false NOT NULL,
  price_1 numeric(18,4),
  price_2 numeric(18,4),
  price_3 numeric(18,4),
  price_4 numeric(18,4),
  price_5 numeric(18,4),
  start_date date,
  end_date date,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE md_item_price_break IS 'ตารางราคาตามปริมาณ/ช่วงเวลา | Express: STPRI';
COMMENT ON COLUMN md_item_price_break.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN md_item_price_break.company_id IS 'บริษัท';
COMMENT ON COLUMN md_item_price_break.item_id IS 'สินค้า [Express: STPRI.STKCOD]';
COMMENT ON COLUMN md_item_price_break.unit_id IS 'หน่วย [Express: STPRI.QU]';
COMMENT ON COLUMN md_item_price_break.factor IS 'ตัวคูณ [Express: STPRI.FACTOR]';
COMMENT ON COLUMN md_item_price_break.min_qty IS 'ปริมาณขั้นต่ำ [Express: STPRI.QTY]';
COMMENT ON COLUMN md_item_price_break.is_percent IS 'ราคาเป็น % ส่วนลด [Express: STPRI.PERCENT]';
COMMENT ON COLUMN md_item_price_break.price_1 IS 'ราคา 1 [Express: STPRI.SELLPR1]';
COMMENT ON COLUMN md_item_price_break.price_2 IS 'ราคา 2 [Express: STPRI.SELLPR2]';
COMMENT ON COLUMN md_item_price_break.price_3 IS 'ราคา 3 [Express: STPRI.SELLPR3]';
COMMENT ON COLUMN md_item_price_break.price_4 IS 'ราคา 4 [Express: STPRI.SELLPR4]';
COMMENT ON COLUMN md_item_price_break.price_5 IS 'ราคา 5 [Express: STPRI.SELLPR5]';
COMMENT ON COLUMN md_item_price_break.start_date IS 'วันเริ่ม [Express: STPRI.START]';
COMMENT ON COLUMN md_item_price_break.end_date IS 'วันสิ้นสุด [Express: STPRI.END]';
COMMENT ON COLUMN md_item_price_break.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN md_item_price_break.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN md_item_price_break.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN md_item_price_break.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN md_item_price_break.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN md_item_price_break.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN md_item_price_break.origin_device_id IS 'เครื่องที่สร้างแถวนี้';

-- md_item_reorder: จุดสั่งซื้อแยกคลัง/ช่วงเวลา  [Express: STMIN]
CREATE TABLE md_item_reorder (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  item_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  start_mmdd varchar(4) NOT NULL,
  min_qty numeric(18,4),
  max_qty numeric(18,4),
  order_qty numeric(18,4),
  projected_sales numeric(18,4),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE md_item_reorder IS 'จุดสั่งซื้อแยกคลัง/ช่วงเวลา | Express: STMIN';
COMMENT ON COLUMN md_item_reorder.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN md_item_reorder.company_id IS 'บริษัท';
COMMENT ON COLUMN md_item_reorder.item_id IS 'สินค้า [Express: STMIN.STKCOD]';
COMMENT ON COLUMN md_item_reorder.warehouse_id IS 'คลัง [Express: STMIN.LOCCOD]';
COMMENT ON COLUMN md_item_reorder.start_mmdd IS 'เดือน/วันที่เริ่ม (MMDD) [Express: STMIN.MMDD]';
COMMENT ON COLUMN md_item_reorder.min_qty IS 'จุดสั่งซื้อ [Express: STMIN.MINQTY]';
COMMENT ON COLUMN md_item_reorder.max_qty IS 'จำนวนสูงสุด [Express: STMIN.MAXQTY]';
COMMENT ON COLUMN md_item_reorder.order_qty IS 'ซื้อครั้งละ [Express: STMIN.REOQTY]';
COMMENT ON COLUMN md_item_reorder.projected_sales IS 'ยอดขายโครงการ [Express: STMIN.PRJSAL]';
COMMENT ON COLUMN md_item_reorder.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN md_item_reorder.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN md_item_reorder.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN md_item_reorder.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN md_item_reorder.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN md_item_reorder.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN md_item_reorder.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_md_item_reorder_item_warehouse_start_mmdd ON md_item_reorder (item_id, warehouse_id, start_mmdd) WHERE deleted_at IS NULL;

-- md_customer: ลูกค้า  [Express: ARMAS]
CREATE TABLE md_customer (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  code varchar(20) NOT NULL,
  customer_type varchar(4),
  title varchar(30),
  name varchar(120) NOT NULL,
  name_en varchar(120),
  address_1 varchar(100),
  address_2 varchar(100),
  address_3 varchar(100),
  zip_code varchar(10),
  phone varchar(60),
  email varchar(120),
  contact varchar(60),
  tax_id varchar(13),
  tax_branch_no varchar(5),
  salesperson_id uuid,
  sales_area_code varchar(10),
  ship_via_code varchar(10),
  credit_days smallint,
  payment_terms varchar(60),
  price_level char(1),
  discount_text varchar(20),
  credit_limit numeric(18,2),
  ar_account_id uuid,
  payer_id uuid,
  wht_form varchar(4),
  wht_rate numeric(9,4),
  wht_category varchar(4),
  wht_condition char(1),
  default_ship_to varchar(10),
  track_sales char(1),
  remark text,
  status char(1) DEFAULT 'A' NOT NULL CHECK (status IN ('A','I')),
  inactive_date date,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE md_customer IS 'ลูกค้า | Express: ARMAS | BALANCE, CHQRCV, LASIVC และยอดรายงวดใน ARBAL เป็นค่าคำนวณ ระบบใหม่ได้จาก v_ar_outstanding / doc_header';
COMMENT ON COLUMN md_customer.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN md_customer.company_id IS 'บริษัท';
COMMENT ON COLUMN md_customer.code IS 'รหัสลูกค้า [Express: ARMAS.CUSCOD]';
COMMENT ON COLUMN md_customer.customer_type IS 'ประเภทลูกค้า lookup 45 [Express: ARMAS.CUSTYP]';
COMMENT ON COLUMN md_customer.title IS 'คำนำหน้า [Express: ARMAS.PRENAM]';
COMMENT ON COLUMN md_customer.name IS 'ชื่อลูกค้า [Express: ARMAS.CUSNAM]';
COMMENT ON COLUMN md_customer.name_en IS 'ชื่อภาษาอังกฤษ [Express: ARMAS.CUSNAM2]';
COMMENT ON COLUMN md_customer.address_1 IS 'ที่อยู่ 1 [Express: ARMAS.ADDR01]';
COMMENT ON COLUMN md_customer.address_2 IS 'ที่อยู่ 2 [Express: ARMAS.ADDR02]';
COMMENT ON COLUMN md_customer.address_3 IS 'ที่อยู่ 3 [Express: ARMAS.ADDR03]';
COMMENT ON COLUMN md_customer.zip_code IS 'รหัสไปรษณีย์ [Express: ARMAS.ZIPCOD]';
COMMENT ON COLUMN md_customer.phone IS 'โทรศัพท์ [Express: ARMAS.TELNUM]';
COMMENT ON COLUMN md_customer.email IS 'อีเมล (ใหม่)';
COMMENT ON COLUMN md_customer.contact IS 'ผู้ติดต่อ [Express: ARMAS.CONTACT]';
COMMENT ON COLUMN md_customer.tax_id IS 'เลขผู้เสียภาษี [Express: ARMAS.TAXID]';
COMMENT ON COLUMN md_customer.tax_branch_no IS 'เลขที่สาขาของลูกค้า (00000 = สนญ.)';
COMMENT ON COLUMN md_customer.salesperson_id IS 'พนักงานขาย [Express: ARMAS.SLMCOD]';
COMMENT ON COLUMN md_customer.sales_area_code IS 'เขตการขาย lookup 40 [Express: ARMAS.AREACOD]';
COMMENT ON COLUMN md_customer.ship_via_code IS 'ขนส่งโดย lookup 41 [Express: ARMAS.DLVBY]';
COMMENT ON COLUMN md_customer.credit_days IS 'เครดิต (วัน) [Express: ARMAS.PAYTRM]';
COMMENT ON COLUMN md_customer.payment_terms IS 'เงื่อนไขการชำระ [Express: ARMAS.PAYCOND]';
COMMENT ON COLUMN md_customer.price_level IS 'ตารางราคาที่ใช้ 0–5 [Express: ARMAS.TABPR]';
COMMENT ON COLUMN md_customer.discount_text IS 'ส่วนลด (เช่น 5%+2) [Express: ARMAS.DISC]';
COMMENT ON COLUMN md_customer.credit_limit IS 'วงเงินอนุมัติ [Express: ARMAS.CRLINE]';
COMMENT ON COLUMN md_customer.ar_account_id IS 'บัญชีลูกหนี้ (ชั้นที่ 2) [Express: ARMAS.ACCNUM]';
COMMENT ON COLUMN md_customer.payer_id IS 'ผู้ชำระเงินแทน [Express: ARMAS.PAYER]';
COMMENT ON COLUMN md_customer.wht_form IS 'แบบภาษีหัก ณ ที่จ่ายที่ลูกค้าหักเรา [Express: ARMAS.TAXTYP]';
COMMENT ON COLUMN md_customer.wht_rate IS 'อัตราภาษีหัก ณ ที่จ่าย [Express: ARMAS.TAXRAT]';
COMMENT ON COLUMN md_customer.wht_category IS 'หมวดภาษีหัก ณ ที่จ่าย (ตาราง 55) [สันนิษฐาน] [Express: ARMAS.TAXGRP]';
COMMENT ON COLUMN md_customer.wht_condition IS 'เงื่อนไขการหักภาษี 1=หัก ณ ที่จ่าย 2=ออกให้ตลอดไป 3=ออกให้ครั้งเดียว [Express: ARMAS.TAXCOND]';
COMMENT ON COLUMN md_customer.default_ship_to IS 'รหัสสถานที่ส่งของประจำ [Express: ARMAS.SHIPTO]';
COMMENT ON COLUMN md_customer.track_sales IS 'ติดตามการขาย [สันนิษฐาน] [Express: ARMAS.TRACKSAL]';
COMMENT ON COLUMN md_customer.remark IS 'หมายเหตุ [Express: ARMAS.REMARK]';
COMMENT ON COLUMN md_customer.status IS 'สถานะ [Express: ARMAS.STATUS]';
COMMENT ON COLUMN md_customer.inactive_date IS 'วันที่เลิกใช้ [Express: ARMAS.INACTDAT]';
COMMENT ON COLUMN md_customer.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN md_customer.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN md_customer.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN md_customer.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN md_customer.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN md_customer.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN md_customer.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_md_customer_company_code ON md_customer (company_id, code) WHERE deleted_at IS NULL;
CREATE INDEX ix_md_customer_company_name ON md_customer (company_id, name);

-- md_customer_ship_to: สถานที่ส่งของของลูกค้า  [Express: ARSHIP]
CREATE TABLE md_customer_ship_to (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  customer_id uuid,
  code varchar(10) NOT NULL,
  address_1 varchar(100),
  address_2 varchar(100),
  address_3 varchar(100),
  zip_code varchar(10),
  phone varchar(60),
  contact varchar(60),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE md_customer_ship_to IS 'สถานที่ส่งของของลูกค้า | Express: ARSHIP | CUSCOD=''@@@@@@@@@@'' ใน Express = สถานที่ส่งใช้ร่วมทุกลูกค้า → customer_id ว่าง';
COMMENT ON COLUMN md_customer_ship_to.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN md_customer_ship_to.company_id IS 'บริษัท';
COMMENT ON COLUMN md_customer_ship_to.customer_id IS 'ลูกค้า [Express: ARSHIP.CUSCOD]';
COMMENT ON COLUMN md_customer_ship_to.code IS 'รหัสสถานที่ส่ง [Express: ARSHIP.SHIPTO]';
COMMENT ON COLUMN md_customer_ship_to.address_1 IS 'ที่อยู่ 1 [Express: ARSHIP.ADDR01]';
COMMENT ON COLUMN md_customer_ship_to.address_2 IS 'ที่อยู่ 2 [Express: ARSHIP.ADDR02]';
COMMENT ON COLUMN md_customer_ship_to.address_3 IS 'ที่อยู่ 3 [Express: ARSHIP.ADDR03]';
COMMENT ON COLUMN md_customer_ship_to.zip_code IS 'รหัสไปรษณีย์ [Express: ARSHIP.ZIPCOD]';
COMMENT ON COLUMN md_customer_ship_to.phone IS 'โทรศัพท์ [Express: ARSHIP.TELNUM]';
COMMENT ON COLUMN md_customer_ship_to.contact IS 'ผู้ติดต่อ [Express: ARSHIP.CONTACT]';
COMMENT ON COLUMN md_customer_ship_to.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN md_customer_ship_to.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN md_customer_ship_to.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN md_customer_ship_to.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN md_customer_ship_to.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN md_customer_ship_to.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN md_customer_ship_to.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_md_customer_ship_to_company_customer_code ON md_customer_ship_to (company_id, COALESCE(customer_id, '00000000-0000-0000-0000-000000000000'::uuid), code) WHERE deleted_at IS NULL;

-- md_supplier: ผู้จำหน่าย / เจ้าหนี้  [Express: APMAS]
CREATE TABLE md_supplier (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  code varchar(20) NOT NULL,
  supplier_type varchar(4),
  title varchar(30),
  name varchar(120) NOT NULL,
  name_en varchar(120),
  address_1 varchar(100),
  address_2 varchar(100),
  address_3 varchar(100),
  zip_code varchar(10),
  phone varchar(60),
  contact varchar(60),
  tax_id varchar(13),
  tax_branch_no varchar(5),
  price_type char(1),
  vat_rate numeric(9,4),
  ship_via_code varchar(10),
  credit_days smallint,
  payment_terms varchar(60),
  discount_text varchar(20),
  credit_limit numeric(18,2),
  ap_account_id uuid,
  wht_form varchar(4),
  wht_income_desc varchar(60),
  wht_rate numeric(9,4),
  wht_condition char(1),
  on_hold boolean DEFAULT false NOT NULL,
  remark text,
  status char(1) DEFAULT 'A' NOT NULL CHECK (status IN ('A','I')),
  inactive_date date,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE md_supplier IS 'ผู้จำหน่าย / เจ้าหนี้ | Express: APMAS';
COMMENT ON COLUMN md_supplier.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN md_supplier.company_id IS 'บริษัท';
COMMENT ON COLUMN md_supplier.code IS 'รหัสผู้จำหน่าย [Express: APMAS.SUPCOD]';
COMMENT ON COLUMN md_supplier.supplier_type IS 'ประเภท lookup 46 [Express: APMAS.SUPTYP]';
COMMENT ON COLUMN md_supplier.title IS 'คำนำหน้า [Express: APMAS.PRENAM]';
COMMENT ON COLUMN md_supplier.name IS 'ชื่อผู้จำหน่าย [Express: APMAS.SUPNAM]';
COMMENT ON COLUMN md_supplier.name_en IS 'ชื่อภาษาอังกฤษ [Express: APMAS.SUPNAM2]';
COMMENT ON COLUMN md_supplier.address_1 IS 'ที่อยู่ 1 [Express: APMAS.ADDR01]';
COMMENT ON COLUMN md_supplier.address_2 IS 'ที่อยู่ 2 [Express: APMAS.ADDR02]';
COMMENT ON COLUMN md_supplier.address_3 IS 'ที่อยู่ 3 [Express: APMAS.ADDR03]';
COMMENT ON COLUMN md_supplier.zip_code IS 'รหัสไปรษณีย์ [Express: APMAS.ZIPCOD]';
COMMENT ON COLUMN md_supplier.phone IS 'โทรศัพท์ [Express: APMAS.TELNUM]';
COMMENT ON COLUMN md_supplier.contact IS 'ผู้ติดต่อ [Express: APMAS.CONTACT]';
COMMENT ON COLUMN md_supplier.tax_id IS 'เลขผู้เสียภาษี [Express: APMAS.TAXID]';
COMMENT ON COLUMN md_supplier.tax_branch_no IS 'เลขที่สาขา';
COMMENT ON COLUMN md_supplier.price_type IS 'ประเภทราคา 0=ไม่มี VAT 1=รวม VAT 2=แยก VAT [Express: APMAS.FLGVAT]';
COMMENT ON COLUMN md_supplier.vat_rate IS 'อัตรา VAT [Express: APMAS.VATRAT]';
COMMENT ON COLUMN md_supplier.ship_via_code IS 'ขนส่งโดย [Express: APMAS.DLVBY]';
COMMENT ON COLUMN md_supplier.credit_days IS 'เครดิต (วัน) [Express: APMAS.PAYTRM]';
COMMENT ON COLUMN md_supplier.payment_terms IS 'เงื่อนไขการชำระ [Express: APMAS.PAYCOND]';
COMMENT ON COLUMN md_supplier.discount_text IS 'ส่วนลด [Express: APMAS.DISC]';
COMMENT ON COLUMN md_supplier.credit_limit IS 'วงเงิน [Express: APMAS.CRLINE]';
COMMENT ON COLUMN md_supplier.ap_account_id IS 'บัญชีเจ้าหนี้ (ชั้นที่ 2) [Express: APMAS.ACCNUM]';
COMMENT ON COLUMN md_supplier.wht_form IS 'แบบ ภ.ง.ด. S03=ภ.ง.ด.3 S53=ภ.ง.ด.53 [Express: APMAS.TAXTYP]';
COMMENT ON COLUMN md_supplier.wht_income_desc IS 'ประเภทเงินได้ที่จ่าย [Express: APMAS.TAXDES]';
COMMENT ON COLUMN md_supplier.wht_rate IS 'อัตราภาษีหัก ณ ที่จ่าย [Express: APMAS.TAXRAT]';
COMMENT ON COLUMN md_supplier.wht_condition IS 'เงื่อนไข 1=หัก ณ ที่จ่าย 2=ออกให้ตลอดไป 3=ออกให้ครั้งเดียว [Express: APMAS.TAXCOND]';
COMMENT ON COLUMN md_supplier.on_hold IS 'ระงับการจ่าย [Express: APMAS.ONHOLD]';
COMMENT ON COLUMN md_supplier.remark IS 'หมายเหตุ [Express: APMAS.REMARK]';
COMMENT ON COLUMN md_supplier.status IS 'สถานะ [Express: APMAS.STATUS]';
COMMENT ON COLUMN md_supplier.inactive_date IS 'วันที่เลิกใช้ [Express: APMAS.INACTDAT]';
COMMENT ON COLUMN md_supplier.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN md_supplier.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN md_supplier.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN md_supplier.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN md_supplier.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN md_supplier.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN md_supplier.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_md_supplier_company_code ON md_supplier (company_id, code) WHERE deleted_at IS NULL;
CREATE INDEX ix_md_supplier_company_name ON md_supplier (company_id, name);

-- md_party_contact: ผู้ติดต่อของลูกค้า/ผู้จำหน่าย (ข้อเสนอ: หลายคน — Express มีช่องเดียว)  [Express: (ใหม่) ARMAS/APMAS.CONTACT]
CREATE TABLE md_party_contact (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  party_type char(1) NOT NULL CHECK (party_type IN ('C','S')),
  party_id uuid NOT NULL,
  line_no smallint NOT NULL,
  name varchar(120) NOT NULL,
  position varchar(60),
  phone varchar(60),
  email varchar(120),
  is_primary boolean DEFAULT false NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE md_party_contact IS 'ผู้ติดต่อของลูกค้า/ผู้จำหน่าย (ข้อเสนอ: หลายคน — Express มีช่องเดียว) | Express: (ใหม่) ARMAS/APMAS.CONTACT';
COMMENT ON COLUMN md_party_contact.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN md_party_contact.company_id IS 'บริษัท';
COMMENT ON COLUMN md_party_contact.party_type IS 'C=ลูกค้า S=ผู้จำหน่าย';
COMMENT ON COLUMN md_party_contact.party_id IS 'id ของลูกค้าหรือผู้จำหน่าย';
COMMENT ON COLUMN md_party_contact.line_no IS 'ลำดับ';
COMMENT ON COLUMN md_party_contact.name IS 'ชื่อผู้ติดต่อ';
COMMENT ON COLUMN md_party_contact.position IS 'ตำแหน่ง/หน้าที่ เช่น จัดซื้อ บัญชี';
COMMENT ON COLUMN md_party_contact.phone IS 'โทรศัพท์';
COMMENT ON COLUMN md_party_contact.email IS 'อีเมล';
COMMENT ON COLUMN md_party_contact.is_primary IS 'ผู้ติดต่อหลัก (แสดงในเอกสาร)';
COMMENT ON COLUMN md_party_contact.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN md_party_contact.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN md_party_contact.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN md_party_contact.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN md_party_contact.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN md_party_contact.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN md_party_contact.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_md_party_contact_company_party_type_party_line_no ON md_party_contact (company_id, party_type, party_id, line_no) WHERE deleted_at IS NULL;

-- md_supplier_bank: บัญชีธนาคารของผู้จำหน่าย (ข้อเสนอ: ใช้โอนจ่ายชำระหนี้)  [Express: (ใหม่)]
CREATE TABLE md_supplier_bank (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  supplier_id uuid NOT NULL,
  line_no smallint NOT NULL,
  bank_code varchar(10) NOT NULL,
  branch varchar(60),
  account_no varchar(20) NOT NULL,
  account_name varchar(120),
  is_default boolean DEFAULT false NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE md_supplier_bank IS 'บัญชีธนาคารของผู้จำหน่าย (ข้อเสนอ: ใช้โอนจ่ายชำระหนี้) | Express: (ใหม่)';
COMMENT ON COLUMN md_supplier_bank.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN md_supplier_bank.company_id IS 'บริษัท';
COMMENT ON COLUMN md_supplier_bank.supplier_id IS 'ผู้จำหน่าย';
COMMENT ON COLUMN md_supplier_bank.line_no IS 'ลำดับ';
COMMENT ON COLUMN md_supplier_bank.bank_code IS 'ธนาคาร (ตารางธนาคาร)';
COMMENT ON COLUMN md_supplier_bank.branch IS 'สาขา';
COMMENT ON COLUMN md_supplier_bank.account_no IS 'เลขที่บัญชี';
COMMENT ON COLUMN md_supplier_bank.account_name IS 'ชื่อบัญชี';
COMMENT ON COLUMN md_supplier_bank.is_default IS 'บัญชีที่ใช้โอนเป็นประจำ';
COMMENT ON COLUMN md_supplier_bank.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN md_supplier_bank.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN md_supplier_bank.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN md_supplier_bank.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN md_supplier_bank.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN md_supplier_bank.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN md_supplier_bank.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_md_supplier_bank_company_supplier_line_no ON md_supplier_bank (company_id, supplier_id, line_no) WHERE deleted_at IS NULL;

-- md_salesperson: พนักงานขาย  [Express: OESLM]
CREATE TABLE md_salesperson (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  code varchar(20) NOT NULL,
  name varchar(120) NOT NULL,
  position varchar(60),
  salesperson_type varchar(4),
  sales_area_code varchar(10),
  commission_rate numeric(9,4),
  address text,
  zip_code varchar(10),
  phone varchar(60),
  tax_id varchar(13),
  social_security_no varchar(20),
  status char(1) DEFAULT 'A' NOT NULL CHECK (status IN ('A','I')),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE md_salesperson IS 'พนักงานขาย | Express: OESLM';
COMMENT ON COLUMN md_salesperson.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN md_salesperson.company_id IS 'บริษัท';
COMMENT ON COLUMN md_salesperson.code IS 'รหัสพนักงานขาย [Express: OESLM.SLMCOD]';
COMMENT ON COLUMN md_salesperson.name IS 'ชื่อ [Express: OESLM.SLMNAM]';
COMMENT ON COLUMN md_salesperson.position IS 'ตำแหน่ง [Express: OESLM.POSITN]';
COMMENT ON COLUMN md_salesperson.salesperson_type IS 'ประเภท lookup 47 [Express: OESLM.SLMTYP]';
COMMENT ON COLUMN md_salesperson.sales_area_code IS 'เขตการขาย [Express: OESLM.AREACOD]';
COMMENT ON COLUMN md_salesperson.commission_rate IS 'อัตราค่าคอมมิชชั่น % [Express: OESLM.COMRATE]';
COMMENT ON COLUMN md_salesperson.address IS 'ที่อยู่ [Express: OESLM.ADDR01-03]';
COMMENT ON COLUMN md_salesperson.zip_code IS 'รหัสไปรษณีย์ [Express: OESLM.ZIPCOD]';
COMMENT ON COLUMN md_salesperson.phone IS 'โทรศัพท์ [Express: OESLM.TELNUM]';
COMMENT ON COLUMN md_salesperson.tax_id IS 'เลขผู้เสียภาษี [Express: OESLM.TAXID]';
COMMENT ON COLUMN md_salesperson.social_security_no IS 'เลขประกันสังคม [Express: OESLM.SOCIALID]';
COMMENT ON COLUMN md_salesperson.status IS 'สถานะ [Express: OESLM.STATUS]';
COMMENT ON COLUMN md_salesperson.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN md_salesperson.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN md_salesperson.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN md_salesperson.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN md_salesperson.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN md_salesperson.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN md_salesperson.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_md_salesperson_company_code ON md_salesperson (company_id, code) WHERE deleted_at IS NULL;

-- md_sales_target: เป้าการขายรายงวด  [Express: OESLM.TAR1–TAR12NY]
CREATE TABLE md_sales_target (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  salesperson_id uuid NOT NULL,
  period_id uuid NOT NULL,
  target_amount numeric(18,2) NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE md_sales_target IS 'เป้าการขายรายงวด | Express: OESLM.TAR1–TAR12NY';
COMMENT ON COLUMN md_sales_target.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN md_sales_target.company_id IS 'บริษัท';
COMMENT ON COLUMN md_sales_target.salesperson_id IS 'พนักงานขาย';
COMMENT ON COLUMN md_sales_target.period_id IS 'งวด';
COMMENT ON COLUMN md_sales_target.target_amount IS 'เป้าการขาย';
COMMENT ON COLUMN md_sales_target.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN md_sales_target.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN md_sales_target.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN md_sales_target.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN md_sales_target.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN md_sales_target.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN md_sales_target.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_md_sales_target_salesperson_period ON md_sales_target (salesperson_id, period_id) WHERE deleted_at IS NULL;

-- md_bank_account: บัญชีเงินฝากของกิจการ  [Express: BKMAS]
CREATE TABLE md_bank_account (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  code varchar(10) NOT NULL,
  bank_id uuid,
  name varchar(120) NOT NULL,
  branch varchar(60),
  short_name varchar(20),
  account_number varchar(30),
  account_kind char(1),
  gl_account_id uuid,
  currency varchar(3) DEFAULT 'THB' NOT NULL,
  opening_balance numeric(18,2),
  opening_date date,
  status char(1) DEFAULT 'A' NOT NULL CHECK (status IN ('A','I')),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE md_bank_account IS 'บัญชีเงินฝากของกิจการ | Express: BKMAS';
COMMENT ON COLUMN md_bank_account.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN md_bank_account.company_id IS 'บริษัท';
COMMENT ON COLUMN md_bank_account.code IS 'รหัสบัญชีเงินฝาก เช่น C1 S1 [Express: BKMAS.BNKACC]';
COMMENT ON COLUMN md_bank_account.bank_id IS 'ธนาคาร';
COMMENT ON COLUMN md_bank_account.name IS 'ชื่อบัญชี/ธนาคาร [Express: BKMAS.BNKNAM]';
COMMENT ON COLUMN md_bank_account.branch IS 'สาขาธนาคาร [Express: BKMAS.BRANCH]';
COMMENT ON COLUMN md_bank_account.short_name IS 'ชื่อย่อ [Express: BKMAS.SHORTNAM]';
COMMENT ON COLUMN md_bank_account.account_number IS 'เลขที่บัญชีธนาคาร [Express: BKMAS.BNKNUM]';
COMMENT ON COLUMN md_bank_account.account_kind IS 'C=กระแสรายวัน S=ออมทรัพย์ F=ฝากประจำ/ต่างประเทศ';
COMMENT ON COLUMN md_bank_account.gl_account_id IS 'บัญชีแยกประเภท [Express: BKMAS.ACCNUM]';
COMMENT ON COLUMN md_bank_account.currency IS 'สกุลเงิน';
COMMENT ON COLUMN md_bank_account.opening_balance IS 'ยอดยกมา [Express: BKMAS.BALFWD]';
COMMENT ON COLUMN md_bank_account.opening_date IS 'วันที่ยอดยกมา [Express: BKMAS.BALDAT]';
COMMENT ON COLUMN md_bank_account.status IS 'สถานะ';
COMMENT ON COLUMN md_bank_account.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN md_bank_account.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN md_bank_account.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN md_bank_account.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN md_bank_account.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN md_bank_account.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN md_bank_account.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_md_bank_account_company_code ON md_bank_account (company_id, code) WHERE deleted_at IS NULL;

-- md_doc_type: ประเภทเอกสารและพฤติกรรม (prefix สมุดรายวัน อนุมัติ บัญชี)  [Express: ISRUN (DOCTYP <> 'ZR','ZP','GL')]
CREATE TABLE md_doc_type (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  code varchar(10) NOT NULL,
  doc_class varchar(4) NOT NULL,
  module varchar(4) NOT NULL,
  name_th varchar(120) NOT NULL,
  name_en varchar(120),
  short_name varchar(10),
  next_no bigint DEFAULT 1 NOT NULL,
  journal_book_id uuid,
  journal_desc_template varchar(200),
  department_id uuid,
  warehouse_id uuid,
  price_type char(1),
  vat_rate numeric(9,4),
  vat_basis char(1),
  vat_per_line boolean DEFAULT false NOT NULL,
  approve_method char(1),
  approve_level smallint,
  reprint_level smallint,
  cancel_level smallint,
  delete_level smallint,
  over_limit_level smallint,
  auto_print boolean DEFAULT false NOT NULL,
  form_no smallint,
  use_barcode boolean DEFAULT false NOT NULL,
  is_tax_invoice boolean DEFAULT false NOT NULL,
  status char(1) DEFAULT 'A' NOT NULL CHECK (status IN ('A','I')),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE md_doc_type IS 'ประเภทเอกสารและพฤติกรรม (prefix สมุดรายวัน อนุมัติ บัญชี) | Express: ISRUN (DOCTYP <> ''ZR'',''ZP'',''GL'')';
COMMENT ON COLUMN md_doc_type.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN md_doc_type.company_id IS 'บริษัท';
COMMENT ON COLUMN md_doc_type.code IS 'prefix เอกสาร เช่น IV TI RR PS [Express: ISRUN.PREFIX]';
COMMENT ON COLUMN md_doc_type.doc_class IS 'หมวดเอกสาร (กำหนดตรรกะ) = ISRUN.DOCTYP เช่น IV=ขายเชื่อ CN=ลดหนี้/รับคืน RR=ซื้อเชื่อ DN=ลดหนี้/ส่งคืน OU=เบิกใช้ JU=ปรับปรุง/ตรวจนับ [Express: ISRUN.DOCTYP]';
COMMENT ON COLUMN md_doc_type.module IS 'ระบบ AR AP SO PO IC BK GL PC';
COMMENT ON COLUMN md_doc_type.name_th IS 'ชื่อเอกสาร [Express: ISRUN.POSDES]';
COMMENT ON COLUMN md_doc_type.name_en IS 'ชื่อภาษาอังกฤษ [Express: ISRUN.POSDES2]';
COMMENT ON COLUMN md_doc_type.short_name IS 'ชื่อย่อ [Express: ISRUN.SHORTNAM]';
COMMENT ON COLUMN md_doc_type.next_no IS 'เลขที่ถัดไป (ส่วนตัวเลข 7 หลักต่อท้าย prefix ไม่เริ่มใหม่ทุกปี — คู่มือบทที่ 9) [Express: ISRUN.DOCNUM]';
COMMENT ON COLUMN md_doc_type.journal_book_id IS 'สมุดรายวันที่ลงบัญชี [Express: ISRUN.JNLTYP]';
COMMENT ON COLUMN md_doc_type.journal_desc_template IS 'สูตรคำอธิบายรายการบัญชี เช่น "ขายเชื่อให้ {party.name}" [Express: ISRUN.JNLEXP]';
COMMENT ON COLUMN md_doc_type.department_id IS 'แผนก default [Express: ISRUN.DEPCOD]';
COMMENT ON COLUMN md_doc_type.warehouse_id IS 'คลัง default [Express: ISRUN.LOCCOD]';
COMMENT ON COLUMN md_doc_type.price_type IS 'ประเภทราคา default 0/1/2 [Express: ISRUN.FLGVAT]';
COMMENT ON COLUMN md_doc_type.vat_rate IS 'อัตรา VAT default [Express: ISRUN.VATRAT]';
COMMENT ON COLUMN md_doc_type.vat_basis IS 'เกณฑ์ภาษีบริการ 1=เกณฑ์สิทธิ 2=เกณฑ์เงินสด [Express: ISRUN.SRV_VATTYP]';
COMMENT ON COLUMN md_doc_type.vat_per_line IS 'แยกประเภท VAT รายบรรทัด [Express: ISRUN.VAT_INITEM]';
COMMENT ON COLUMN md_doc_type.approve_method IS 'วิธีอนุมัติ [Express: ISRUN.APPROV_MET]';
COMMENT ON COLUMN md_doc_type.approve_level IS 'ระดับอนุมัติ [Express: ISRUN.APPROV_LEV]';
COMMENT ON COLUMN md_doc_type.reprint_level IS 'ระดับที่พิมพ์ซ้ำได้ [Express: ISRUN.REPRN_LEV]';
COMMENT ON COLUMN md_doc_type.cancel_level IS 'ระดับที่ยกเลิกได้ [Express: ISRUN.CANCEL_LEV]';
COMMENT ON COLUMN md_doc_type.delete_level IS 'ระดับที่ลบได้ [Express: ISRUN.DELETE_LEV]';
COMMENT ON COLUMN md_doc_type.over_limit_level IS 'ระดับอนุมัติเกินวงเงิน [Express: ISRUN.OVRLIN_LEV]';
COMMENT ON COLUMN md_doc_type.auto_print IS 'พิมพ์อัตโนมัติหลังบันทึก [Express: ISRUN.AUTOPRN]';
COMMENT ON COLUMN md_doc_type.form_no IS 'ฟอร์มที่ใช้พิมพ์ 1–9 [Express: ISRUN.WHICHFORM]';
COMMENT ON COLUMN md_doc_type.use_barcode IS 'ป้อนรายการด้วยบาร์โค้ด [Express: ISRUN.USEBARCOD]';
COMMENT ON COLUMN md_doc_type.is_tax_invoice IS 'เป็นใบกำกับภาษี (ต้องเรียงเลขต่อเนื่องตามสาขา/เล่ม)';
COMMENT ON COLUMN md_doc_type.status IS 'สถานะ';
COMMENT ON COLUMN md_doc_type.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN md_doc_type.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN md_doc_type.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN md_doc_type.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN md_doc_type.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN md_doc_type.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN md_doc_type.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_md_doc_type_company_code ON md_doc_type (company_id, code) WHERE deleted_at IS NULL;

-- md_doc_type_account: บัญชีที่กำหนดไว้ที่ประเภทเอกสาร — ชั้นที่ 1 ของการหาบัญชี  [Express: ISRUN.ACCNUM01–ACCNUM12]
CREATE TABLE md_doc_type_account (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  doc_type_id uuid NOT NULL,
  slot smallint NOT NULL CHECK (slot BETWEEN 1 AND 12),
  role varchar(30),
  account_id uuid NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE md_doc_type_account IS 'บัญชีที่กำหนดไว้ที่ประเภทเอกสาร — ชั้นที่ 1 ของการหาบัญชี | Express: ISRUN.ACCNUM01–ACCNUM12';
COMMENT ON COLUMN md_doc_type_account.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN md_doc_type_account.company_id IS 'บริษัท';
COMMENT ON COLUMN md_doc_type_account.doc_type_id IS 'ประเภทเอกสาร';
COMMENT ON COLUMN md_doc_type_account.slot IS 'ช่องที่ 1–12 ตาม Express';
COMMENT ON COLUMN md_doc_type_account.role IS 'บทบาทบัญชีของช่องนี้ (ตาม doc_class)';
COMMENT ON COLUMN md_doc_type_account.account_id IS 'บัญชี';
COMMENT ON COLUMN md_doc_type_account.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN md_doc_type_account.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN md_doc_type_account.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN md_doc_type_account.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN md_doc_type_account.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN md_doc_type_account.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN md_doc_type_account.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_md_doc_type_account_doc_type_slot ON md_doc_type_account (doc_type_id, slot) WHERE deleted_at IS NULL;

-- md_payment_method: วิธีรับ/จ่ายเงิน (เงินสด เช็ค โอน หัก ณ ที่จ่าย ส่วนลด ฯลฯ)  [Express: ISRUN DOCTYP='ZR'(รับ)/'ZP'(จ่าย) + เริ่มระบบ 1.4.2/1.5.2]
CREATE TABLE md_payment_method (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  direction char(1) NOT NULL CHECK (direction IN ('R','P')),
  code varchar(10) NOT NULL,
  seq varchar(4),
  name_th varchar(120) NOT NULL,
  name_en varchar(120),
  kind varchar(10) DEFAULT 'OTHER' NOT NULL,
  gl_account_id uuid,
  bank_account_id uuid,
  creates_cheque boolean DEFAULT false NOT NULL,
  status char(1) DEFAULT 'A' NOT NULL CHECK (status IN ('A','I')),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE md_payment_method IS 'วิธีรับ/จ่ายเงิน (เงินสด เช็ค โอน หัก ณ ที่จ่าย ส่วนลด ฯลฯ) | Express: ISRUN DOCTYP=''ZR''(รับ)/''ZP''(จ่าย) + เริ่มระบบ 1.4.2/1.5.2';
COMMENT ON COLUMN md_payment_method.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN md_payment_method.company_id IS 'บริษัท';
COMMENT ON COLUMN md_payment_method.direction IS 'R=รับ P=จ่าย [Express: ISRUN.DOCTYP]';
COMMENT ON COLUMN md_payment_method.code IS 'รหัส 2 ตัว (นำหน้าเลขที่ในรายการชำระ เช่น QR TR TS) [Express: ISRUN.PREFIX]';
COMMENT ON COLUMN md_payment_method.seq IS 'ลำดับในจอ [Express: ISRUN.DOCCOD]';
COMMENT ON COLUMN md_payment_method.name_th IS 'ชื่อวิธีชำระ [Express: ISRUN.POSDES]';
COMMENT ON COLUMN md_payment_method.name_en IS 'ชื่อภาษาอังกฤษ [Express: ISRUN.POSDES2]';
COMMENT ON COLUMN md_payment_method.kind IS 'CASH CHEQUE TRANSFER CARD WHT DISCOUNT DEPOSIT FX OTHER';
COMMENT ON COLUMN md_payment_method.gl_account_id IS 'บัญชีที่ลง [Express: ISRUN.ACCNUM01]';
COMMENT ON COLUMN md_payment_method.bank_account_id IS 'บัญชีเงินฝากที่เกี่ยวข้อง (โอน/เช็ค)';
COMMENT ON COLUMN md_payment_method.creates_cheque IS 'สร้างรายการในทะเบียนเช็ค/โอน (fin_cheque)';
COMMENT ON COLUMN md_payment_method.status IS 'สถานะ';
COMMENT ON COLUMN md_payment_method.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN md_payment_method.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN md_payment_method.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN md_payment_method.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN md_payment_method.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN md_payment_method.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN md_payment_method.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_md_payment_method_company_direction_code ON md_payment_method (company_id, direction, code) WHERE deleted_at IS NULL;

-- md_doc_number_block: ช่วงเลขที่เอกสารที่จองให้แต่ละเครื่อง — ออกเลขได้ตอนออฟไลน์โดยไม่ซ้ำ  [Express: ISRUN.DOCNUM (เลขถัดไป)]
CREATE TABLE md_doc_number_block (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  doc_type_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  device_id uuid,
  series varchar(20) NOT NULL,
  format varchar(40) DEFAULT '{prefix}{yy}{mm}-{seq:5}' NOT NULL,
  range_start bigint NOT NULL,
  range_end bigint NOT NULL,
  next_no bigint NOT NULL,
  status char(1) DEFAULT 'A' NOT NULL CHECK (status IN ('A','F','X')),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id),
  CHECK (range_start <= next_no AND next_no <= range_end + 1)
);
COMMENT ON TABLE md_doc_number_block IS 'ช่วงเลขที่เอกสารที่จองให้แต่ละเครื่อง — ออกเลขได้ตอนออฟไลน์โดยไม่ซ้ำ | Express: ISRUN.DOCNUM (เลขถัดไป)';
COMMENT ON COLUMN md_doc_number_block.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN md_doc_number_block.company_id IS 'บริษัท';
COMMENT ON COLUMN md_doc_number_block.doc_type_id IS 'ประเภทเอกสาร';
COMMENT ON COLUMN md_doc_number_block.branch_id IS 'สาขา';
COMMENT ON COLUMN md_doc_number_block.device_id IS 'เครื่องที่ได้รับช่วงเลข (ว่าง = ใช้บนเซิร์ฟเวอร์)';
COMMENT ON COLUMN md_doc_number_block.series IS 'ชุด/เล่ม เช่น 2569 หรือ 2569-POS1';
COMMENT ON COLUMN md_doc_number_block.format IS 'รูปแบบเลขที่';
COMMENT ON COLUMN md_doc_number_block.range_start IS 'เลขเริ่มของช่วง';
COMMENT ON COLUMN md_doc_number_block.range_end IS 'เลขสุดท้ายของช่วง';
COMMENT ON COLUMN md_doc_number_block.next_no IS 'เลขถัดไปที่จะใช้';
COMMENT ON COLUMN md_doc_number_block.status IS 'A=ใช้งาน F=ใช้หมด X=คืน/ยกเลิก';
COMMENT ON COLUMN md_doc_number_block.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN md_doc_number_block.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN md_doc_number_block.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN md_doc_number_block.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN md_doc_number_block.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN md_doc_number_block.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN md_doc_number_block.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_md_doc_number_block_doc_type_branch_series_range_start ON md_doc_number_block (doc_type_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), series, range_start) WHERE deleted_at IS NULL;

-- doc_header: หัวเอกสารทุกชนิด (ขาย ซื้อ สั่งขาย สั่งซื้อ สินค้า การเงิน เงินสดย่อย)  [Express: ARTRN + APTRN + OESO + POPR + STTRN + ARBIL/APBIL + GLPTT + BKTRN(ส่วนเอกสาร)]
CREATE TABLE doc_header (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  doc_type_id uuid NOT NULL,
  doc_class varchar(4) NOT NULL,
  module varchar(4) NOT NULL,
  express_rectype char(1),
  doc_no varchar(30) NOT NULL,
  is_provisional_no boolean DEFAULT false NOT NULL,
  doc_date date NOT NULL,
  period_id uuid,
  customer_id uuid,
  supplier_id uuid,
  bill_to_customer_id uuid,
  ship_to_id uuid,
  party_tax_id varchar(13),
  party_tax_branch_no varchar(5),
  party_name varchar(200),
  party_address text,
  salesperson_id uuid,
  department_id uuid,
  project_id uuid,
  sales_area_code varchar(10),
  ship_via_code varchar(10),
  warehouse_id uuid,
  to_warehouse_id uuid,
  bank_account_id uuid,
  your_ref varchar(60),
  ref_no varchar(30),
  ref_date date,
  credit_days smallint,
  due_date date,
  delivery_date date,
  delivery_date_per_line boolean DEFAULT false NOT NULL,
  price_type char(1) DEFAULT '2' NOT NULL CHECK (price_type IN ('0','1','2')),
  currency varchar(3) DEFAULT 'THB' NOT NULL,
  exchange_rate numeric(9,4) DEFAULT 1 NOT NULL,
  amount numeric(18,2) DEFAULT 0 NOT NULL,
  discount_text varchar(20),
  discount_amount numeric(18,2) DEFAULT 0 NOT NULL,
  amount_after_discount numeric(18,2) DEFAULT 0 NOT NULL,
  deposit_amount numeric(18,2) DEFAULT 0 NOT NULL,
  zero_rate_amount numeric(18,2) DEFAULT 0 NOT NULL,
  taxable_amount numeric(18,2) DEFAULT 0 NOT NULL,
  vat_rate numeric(9,4),
  vat_amount numeric(18,2) DEFAULT 0 NOT NULL,
  net_amount numeric(18,2) DEFAULT 0 NOT NULL,
  wht_amount numeric(18,2) DEFAULT 0 NOT NULL,
  cash_amount numeric(18,2) DEFAULT 0 NOT NULL,
  cheque_amount numeric(18,2) DEFAULT 0 NOT NULL,
  interest_amount numeric(18,2) DEFAULT 0 NOT NULL,
  cash_discount_amount numeric(18,2) DEFAULT 0 NOT NULL,
  settled_amount numeric(18,2) DEFAULT 0 NOT NULL,
  outstanding_amount numeric(18,2) DEFAULT 0 NOT NULL,
  commission_amount numeric(18,2) DEFAULT 0 NOT NULL,
  vat_basis char(1),
  vat_date date,
  vat_period_id uuid,
  vat_late boolean DEFAULT false NOT NULL,
  doc_status char(1) DEFAULT 'N' NOT NULL CHECK (doc_status IN ('D','N','M','C')),
  is_settled boolean DEFAULT false NOT NULL,
  settled_date date,
  appointment_date date,
  payment_date date,
  is_opening boolean DEFAULT false NOT NULL,
  payment_terms varchar(60),
  remark text,
  gl_posted char(1) DEFAULT 'N' NOT NULL,
  journal_id uuid,
  approved_by uuid,
  approved_at timestamptz,
  auth_user_id uuid,
  print_count smallint DEFAULT 0 NOT NULL,
  last_printed_by uuid,
  last_printed_at timestamptz,
  cancel_reason varchar(200),
  device_id uuid,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE doc_header IS 'หัวเอกสารทุกชนิด (ขาย ซื้อ สั่งขาย สั่งซื้อ สินค้า การเงิน เงินสดย่อย) | Express: ARTRN + APTRN + OESO + POPR + STTRN + ARBIL/APBIL + GLPTT + BKTRN(ส่วนเอกสาร) | รวมเอกสารทุกระบบไว้ตารางเดียวตามแนว ARTRN/APTRN ของ Express — ทำให้การออกเลข การซิงก์ การลงบัญชี และ audit ใช้กลไกเดียวกัน';
COMMENT ON COLUMN doc_header.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN doc_header.company_id IS 'บริษัท';
COMMENT ON COLUMN doc_header.branch_id IS 'สาขาที่ออกเอกสาร';
COMMENT ON COLUMN doc_header.doc_type_id IS 'ประเภทเอกสาร (prefix) [Express: ISRUN]';
COMMENT ON COLUMN doc_header.doc_class IS 'ชนิดเอกสาร = หมวดเอกสารของ Express (ISRUN.DOCTYP): ขาย QT SO AI IV HS DR CN(ลดหนี้) OI BS(วางบิล) RE | ซื้อ PO AE RR HP CP DN(ลดหนี้) OE BR PS | สินค้า OU RL JU CA | ธนาคาร BD BW BT BU BV BQ QP | เงินสดย่อย DP VR [Express: ARTRN/APTRN.RECTYP, OESO.SORECTYP, STTRN.POSOPR]';
COMMENT ON COLUMN doc_header.module IS 'AR AP SO PO IC BK PC';
COMMENT ON COLUMN doc_header.express_rectype IS 'RECTYP เดิมของ Express (เก็บไว้ตรวจย้อน) [Express: RECTYP]';
COMMENT ON COLUMN doc_header.doc_no IS 'เลขที่เอกสาร [Express: DOCNUM / SONUM / PONUM / BILNUM]';
COMMENT ON COLUMN doc_header.is_provisional_no IS 'เลขชั่วคราว (ออฟไลน์ ยังไม่ได้เลขจริง) — ใช้เฉพาะเอกสารที่ไม่ใช่ใบกำกับภาษี';
COMMENT ON COLUMN doc_header.doc_date IS 'วันที่เอกสาร [Express: DOCDAT / SODAT / PODAT / BILDAT]';
COMMENT ON COLUMN doc_header.period_id IS 'งวดบัญชีของเอกสาร';
COMMENT ON COLUMN doc_header.customer_id IS 'ลูกค้า [Express: ARTRN.CUSCOD / OESO.CUSCOD / ARBIL.CUSCOD]';
COMMENT ON COLUMN doc_header.supplier_id IS 'ผู้จำหน่าย [Express: APTRN.SUPCOD / POPR.SUPCOD / APBIL.SUPCOD]';
COMMENT ON COLUMN doc_header.bill_to_customer_id IS 'Bill to (ชื่อบนใบกำกับ)';
COMMENT ON COLUMN doc_header.ship_to_id IS 'สถานที่ส่งของ [Express: SHIPTO]';
COMMENT ON COLUMN doc_header.party_tax_id IS 'เลขผู้เสียภาษีของคู่ค้า (snapshot ตอนออกเอกสาร)';
COMMENT ON COLUMN doc_header.party_tax_branch_no IS 'สาขาของคู่ค้า (snapshot)';
COMMENT ON COLUMN doc_header.party_name IS 'ชื่อคู่ค้า (snapshot ตอนออกใบกำกับ)';
COMMENT ON COLUMN doc_header.party_address IS 'ที่อยู่คู่ค้า (snapshot)';
COMMENT ON COLUMN doc_header.salesperson_id IS 'พนักงานขาย [Express: SLMCOD]';
COMMENT ON COLUMN doc_header.department_id IS 'แผนก [Express: DEPCOD]';
COMMENT ON COLUMN doc_header.project_id IS 'โครงการ';
COMMENT ON COLUMN doc_header.sales_area_code IS 'เขตการขาย [Express: AREACOD]';
COMMENT ON COLUMN doc_header.ship_via_code IS 'ขนส่งโดย [Express: DLVBY]';
COMMENT ON COLUMN doc_header.warehouse_id IS 'คลัง (เอกสารสินค้า) [Express: STTRN.LOCCOD]';
COMMENT ON COLUMN doc_header.to_warehouse_id IS 'คลังปลายทาง (โอนย้าย) [Express: STTRN.PEOPLE]';
COMMENT ON COLUMN doc_header.bank_account_id IS 'บัญชีเงินฝาก (เอกสารธนาคาร/นำฝาก) [Express: BKTRN.BNKACC]';
COMMENT ON COLUMN doc_header.your_ref IS 'อ้างอิง/เลขที่ PO ของลูกค้า [Express: YOUREF]';
COMMENT ON COLUMN doc_header.ref_no IS 'เลขที่ใบกำกับ/บิลของผู้จำหน่าย [Express: APTRN.REFNUM / STTRN.REFNUM]';
COMMENT ON COLUMN doc_header.ref_date IS 'วันที่อ้างอิง [Express: STTRN.REFDAT]';
COMMENT ON COLUMN doc_header.credit_days IS 'เครดิต (วัน) [Express: PAYTRM]';
COMMENT ON COLUMN doc_header.due_date IS 'วันครบกำหนด [Express: DUEDAT]';
COMMENT ON COLUMN doc_header.delivery_date IS 'วันส่งของ/รับของ (SO/PO) [Express: OESO.DLVDAT / POPR.RCVDAT]';
COMMENT ON COLUMN doc_header.delivery_date_per_line IS 'กำหนดวันส่ง/รับรายบรรทัด [Express: DLVDAT_IT / RCVDAT_IT]';
COMMENT ON COLUMN doc_header.price_type IS '0=ยกเว้น/ไม่มี VAT 1=ราคารวม VAT 2=ราคาแยก VAT [Express: FLGVAT]';
COMMENT ON COLUMN doc_header.currency IS 'สกุลเงิน';
COMMENT ON COLUMN doc_header.exchange_rate IS 'อัตราแลกเปลี่ยน';
COMMENT ON COLUMN doc_header.amount IS 'รวมเงินก่อนหักส่วนลด [Express: AMOUNT]';
COMMENT ON COLUMN doc_header.discount_text IS 'สูตรส่วนลดท้ายบิล เช่น 5%+100 [Express: DISC]';
COMMENT ON COLUMN doc_header.discount_amount IS 'ส่วนลดท้ายบิล [Express: DISCAMT]';
COMMENT ON COLUMN doc_header.amount_after_discount IS 'หลังหักส่วนลด [Express: AFTDISC]';
COMMENT ON COLUMN doc_header.deposit_amount IS 'หักเงินมัดจำ [Express: ADVAMT]';
COMMENT ON COLUMN doc_header.zero_rate_amount IS 'มูลค่าอัตรา 0% [Express: AMTRAT0]';
COMMENT ON COLUMN doc_header.taxable_amount IS 'มูลค่าก่อน VAT [Express: TOTAL / NETVAL]';
COMMENT ON COLUMN doc_header.vat_rate IS 'อัตรา VAT [Express: VATRAT]';
COMMENT ON COLUMN doc_header.vat_amount IS 'ภาษีมูลค่าเพิ่ม [Express: VATAMT]';
COMMENT ON COLUMN doc_header.net_amount IS 'ยอดสุทธิ (รวม VAT) [Express: NETAMT]';
COMMENT ON COLUMN doc_header.wht_amount IS 'ภาษีหัก ณ ที่จ่าย [Express: TAX]';
COMMENT ON COLUMN doc_header.cash_amount IS 'รับ/จ่ายเป็นเงินสด [Express: CSHRCV / CSHPAY]';
COMMENT ON COLUMN doc_header.cheque_amount IS 'รับ/จ่ายเป็นเช็ค/อื่น [Express: CHQRCV / CHQPAY]';
COMMENT ON COLUMN doc_header.interest_amount IS 'ดอกเบี้ยรับ/จ่าย [Express: INTRCV / INTPAY]';
COMMENT ON COLUMN doc_header.cash_discount_amount IS 'ส่วนลดเงินสด';
COMMENT ON COLUMN doc_header.settled_amount IS 'ยอดที่ชำระ/ตัดแล้ว [Express: RCVAMT / PAYAMT]';
COMMENT ON COLUMN doc_header.outstanding_amount IS 'ยอดคงค้าง [Express: REMAMT]';
COMMENT ON COLUMN doc_header.commission_amount IS 'ค่าคอมมิชชั่น [Express: COMAMT]';
COMMENT ON COLUMN doc_header.vat_basis IS 'เกณฑ์ภาษี 1=สิทธิ 2=เงินสด 3=ทั้งสอง [Express: SRV_VATTYP]';
COMMENT ON COLUMN doc_header.vat_date IS 'วันที่ใบกำกับภาษี (ยื่นภาษี) [Express: VATDAT]';
COMMENT ON COLUMN doc_header.vat_period_id IS 'งวดภาษีที่ยื่น [Express: VATPRD]';
COMMENT ON COLUMN doc_header.vat_late IS 'ยื่นเพิ่มเติม (ใบกำกับมาช้า) [Express: VATLATE]';
COMMENT ON COLUMN doc_header.doc_status IS 'D=ร่าง(ออฟไลน์) N=ปกติ M=ใช้ครบ/ปิดแล้ว C=ยกเลิก [Express: DOCSTAT]';
COMMENT ON COLUMN doc_header.is_settled IS 'ตัดชำระ/ส่งของครบแล้ว [Express: CMPLAPP]';
COMMENT ON COLUMN doc_header.settled_date IS 'วันที่ครบ [Express: CMPLDAT]';
COMMENT ON COLUMN doc_header.appointment_date IS 'วันนัดชำระ (ใบวางบิล) [Express: ARBIL/APBIL.APPDAT]';
COMMENT ON COLUMN doc_header.payment_date IS 'วันที่รับ/จ่ายเงินจริง (ใบเสร็จ RE / ใบสำคัญจ่าย PS) — ไม่จำเป็นต้องตรงวันที่เอกสาร';
COMMENT ON COLUMN doc_header.is_opening IS 'ลูกหนี้/เจ้าหนี้คงค้างยกมา (คู่มือ S-OB-03/04): ลงวันที่ก่อนเริ่มใช้ ไม่ลงบัญชี ไม่ตัดสต๊อก ไม่เข้าแฟ้มภาษี';
COMMENT ON COLUMN doc_header.payment_terms IS 'เงื่อนไขการชำระ [Express: PAYCOND]';
COMMENT ON COLUMN doc_header.remark IS 'หมายเหตุสั้น [Express: REMARK]';
COMMENT ON COLUMN doc_header.gl_posted IS 'N=ยังไม่ลงบัญชี Y=ลงแล้ว P=รอเซิร์ฟเวอร์ลง [Express: POSTGL]';
COMMENT ON COLUMN doc_header.journal_id IS 'ใบสำคัญที่เกิดจากเอกสารนี้';
COMMENT ON COLUMN doc_header.approved_by IS 'ผู้อนุมัติ [Express: APPROVE]';
COMMENT ON COLUMN doc_header.approved_at IS 'เวลาอนุมัติ';
COMMENT ON COLUMN doc_header.auth_user_id IS 'ผู้อนุมัติแทน [Express: AUTHID]';
COMMENT ON COLUMN doc_header.print_count IS 'จำนวนครั้งที่พิมพ์ [Express: PRNCNT]';
COMMENT ON COLUMN doc_header.last_printed_by IS 'ผู้พิมพ์ล่าสุด [Express: USERPRN]';
COMMENT ON COLUMN doc_header.last_printed_at IS 'วันเวลาพิมพ์ล่าสุด [Express: PRNDAT+PRNTIM]';
COMMENT ON COLUMN doc_header.cancel_reason IS 'เหตุผลยกเลิก';
COMMENT ON COLUMN doc_header.device_id IS 'เครื่องที่สร้างเอกสาร (ออฟไลน์)';
COMMENT ON COLUMN doc_header.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN doc_header.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN doc_header.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN doc_header.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN doc_header.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN doc_header.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN doc_header.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_doc_header_company_doc_type_doc_no ON doc_header (company_id, doc_type_id, doc_no) WHERE deleted_at IS NULL;
CREATE INDEX ix_doc_header_company_doc_class_doc_date ON doc_header (company_id, doc_class, doc_date);
CREATE INDEX ix_doc_header_company_customer_doc_date ON doc_header (company_id, customer_id, doc_date);
CREATE INDEX ix_doc_header_company_supplier_doc_date ON doc_header (company_id, supplier_id, doc_date);
CREATE INDEX ix_doc_header_company_doc_no ON doc_header (company_id, doc_no);

-- doc_line: บรรทัดรายการของเอกสาร (สินค้า บริการ ค่าใช้จ่าย บัญชี)  [Express: STCRD + OESOIT + POPRIT + GLPTTIT + BKTRNIT]
CREATE TABLE doc_line (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  header_id uuid NOT NULL,
  line_no smallint NOT NULL,
  line_kind char(1) DEFAULT 'I' NOT NULL CHECK (line_kind IN ('I','G','T')),
  item_id uuid,
  account_id uuid,
  description varchar(200),
  warehouse_id uuid,
  department_id uuid,
  project_id uuid,
  project_phase varchar(10),
  cost_code varchar(10),
  qty numeric(18,4) DEFAULT 0 NOT NULL,
  unit_id uuid,
  factor numeric(18,4) DEFAULT 1 NOT NULL,
  base_qty numeric(18,4) DEFAULT 0 NOT NULL,
  unit_price numeric(18,4) DEFAULT 0 NOT NULL,
  discount_text varchar(20),
  discount_amount numeric(18,2) DEFAULT 0 NOT NULL,
  line_amount numeric(18,2) DEFAULT 0 NOT NULL,
  net_amount numeric(18,2) DEFAULT 0 NOT NULL,
  vat_code char(1),
  is_free boolean DEFAULT false NOT NULL,
  return_to_stock boolean,
  stock_effect smallint DEFAULT 0 NOT NULL CHECK (stock_effect IN (-1,0,1)),
  movement_code char(1),
  cost_unit numeric(18,4),
  cost_amount numeric(18,2),
  sales_value numeric(18,2),
  source_line_id uuid,
  party_customer_id uuid,
  party_supplier_id uuid,
  salesperson_id uuid,
  ordered_qty numeric(18,4),
  remaining_qty numeric(18,4),
  cancelled_qty numeric(18,4),
  cancel_reason_code varchar(10),
  cancel_date date,
  delivery_date date,
  gl_debit_account_id uuid,
  gl_credit_account_id uuid,
  packing varchar(30),
  reimburse_flag char(1),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE doc_line IS 'บรรทัดรายการของเอกสาร (สินค้า บริการ ค่าใช้จ่าย บัญชี) | Express: STCRD + OESOIT + POPRIT + GLPTTIT + BKTRNIT | ฟิลด์ต้นทุนรายล็อตใน STCRD (MLOTNUM MREMBAL LOTBAL …) ย้ายไป inv_cost_layer / inv_stock_ledger';
COMMENT ON COLUMN doc_line.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN doc_line.company_id IS 'บริษัท';
COMMENT ON COLUMN doc_line.header_id IS 'หัวเอกสาร [Express: DOCNUM]';
COMMENT ON COLUMN doc_line.line_no IS 'ลำดับบรรทัด [Express: SEQNUM]';
COMMENT ON COLUMN doc_line.line_kind IS 'I=สินค้า/บริการ G=บรรทัดบัญชี (ระบุบัญชีตรง) T=ข้อความ';
COMMENT ON COLUMN doc_line.item_id IS 'สินค้า/บริการ/รหัสค่าใช้จ่าย [Express: STCRD.STKCOD]';
COMMENT ON COLUMN doc_line.account_id IS 'บัญชี (บรรทัดบัญชี เช่น เงินสดย่อย ค่าใช้จ่ายอื่น) [Express: GLPTTIT.ACCNUM]';
COMMENT ON COLUMN doc_line.description IS 'รายละเอียด (แก้ชื่อสินค้าได้) [Express: STCRD.STKDES]';
COMMENT ON COLUMN doc_line.warehouse_id IS 'คลัง [Express: STCRD.LOCCOD]';
COMMENT ON COLUMN doc_line.department_id IS 'แผนก [Express: STCRD.DEPCOD]';
COMMENT ON COLUMN doc_line.project_id IS 'โครงการ [Express: STCRD.JOBCOD]';
COMMENT ON COLUMN doc_line.project_phase IS 'ขั้นตอนโครงการ [Express: STCRD.PHASE]';
COMMENT ON COLUMN doc_line.cost_code IS 'รหัสต้นทุน [Express: STCRD.COSCOD]';
COMMENT ON COLUMN doc_line.qty IS 'จำนวน (หน่วยที่ป้อน) [Express: TRNQTY / ORDQTY]';
COMMENT ON COLUMN doc_line.unit_id IS 'หน่วย [Express: TQUCOD]';
COMMENT ON COLUMN doc_line.factor IS 'ตัวคูณเป็นหน่วยหลัก [Express: TFACTOR]';
COMMENT ON COLUMN doc_line.base_qty IS 'จำนวนเป็นหน่วยหลัก = qty × factor [Express: XTRNQTY]';
COMMENT ON COLUMN doc_line.unit_price IS 'ราคาต่อหน่วย [Express: UNITPR]';
COMMENT ON COLUMN doc_line.discount_text IS 'สูตรส่วนลดรายบรรทัด [Express: DISC]';
COMMENT ON COLUMN doc_line.discount_amount IS 'ส่วนลดรายบรรทัด [Express: DISCAMT]';
COMMENT ON COLUMN doc_line.line_amount IS 'จำนวนเงิน (ตามประเภทราคาของเอกสาร) [Express: TRNVAL]';
COMMENT ON COLUMN doc_line.net_amount IS 'มูลค่าสุทธิก่อน VAT (หลังเฉลี่ยส่วนลดท้ายบิล) [Express: NETVAL]';
COMMENT ON COLUMN doc_line.vat_code IS 'ประเภท VAT รายบรรทัด [Express: VATCOD]';
COMMENT ON COLUMN doc_line.is_free IS 'ของแถม [Express: FREE]';
COMMENT ON COLUMN doc_line.return_to_stock IS 'รับคืน/ส่งคืนแล้วเข้าสต๊อก (ใบลดหนี้) [Express: RETSTK]';
COMMENT ON COLUMN doc_line.stock_effect IS 'ผลต่อสต๊อก +1 รับเข้า −1 จ่ายออก 0 ไม่กระทบ';
COMMENT ON COLUMN doc_line.movement_code IS 'รหัสการเคลื่อนไหวเดิม (POSOPR: 0 ซื้อ 1 รับ/ปรับเพิ่ม 2 รับคืน 3 โอนออก 4 โอนเข้า 5 ปรับต้นทุน 6 เบิกใช้ 7 ส่งคืน 8 ปรับปรุง 9 ขาย : ตรวจนับ = เพิ่มหนี้ > คชจ.อื่น) [Express: STCRD.POSOPR]';
COMMENT ON COLUMN doc_line.cost_unit IS 'ต้นทุนต่อหน่วยหลัก (คำนวณตอน post) [Express: XUNITPR]';
COMMENT ON COLUMN doc_line.cost_amount IS 'มูลค่าต้นทุน (คำนวณตอน post) [Express: XTRNVAL]';
COMMENT ON COLUMN doc_line.sales_value IS 'มูลค่าขายสุทธิ (สำหรับรายงานกำไรขั้นต้น) [Express: XSALVAL]';
COMMENT ON COLUMN doc_line.source_line_id IS 'บรรทัดต้นทาง (บรรทัด SO/PO/IV ที่อ้างถึง) [Express: STCRD.RDOCNUM]';
COMMENT ON COLUMN doc_line.party_customer_id IS 'ลูกค้าของบรรทัด (denormalized จากหัว — ใช้ค้นสต๊อกการ์ดตามคู่ค้า) [Express: STCRD.PEOPLE]';
COMMENT ON COLUMN doc_line.party_supplier_id IS 'ผู้จำหน่ายของบรรทัด [Express: STCRD.PEOPLE]';
COMMENT ON COLUMN doc_line.salesperson_id IS 'พนักงานขาย [Express: STCRD.SLMCOD]';
COMMENT ON COLUMN doc_line.ordered_qty IS 'จำนวนสั่ง (SO/PO) [Express: OESOIT/POPRIT.ORDQTY]';
COMMENT ON COLUMN doc_line.remaining_qty IS 'ค้างส่ง/ค้างรับ [Express: REMQTY]';
COMMENT ON COLUMN doc_line.cancelled_qty IS 'จำนวนยกเลิก [Express: CANCELQTY]';
COMMENT ON COLUMN doc_line.cancel_reason_code IS 'เหตุผลยกเลิก lookup 42/43 [Express: CANCELTYP]';
COMMENT ON COLUMN doc_line.cancel_date IS 'วันที่ยกเลิก [Express: CANCELDAT]';
COMMENT ON COLUMN doc_line.delivery_date IS 'วันส่ง/รับของรายบรรทัด [Express: DLVDAT / RCVDAT]';
COMMENT ON COLUMN doc_line.gl_debit_account_id IS 'บัญชีเดบิตที่ระบุเอง (ทับกฎ) [Express: STCRD.ACCNUMDR]';
COMMENT ON COLUMN doc_line.gl_credit_account_id IS 'บัญชีเครดิตที่ระบุเอง (ทับกฎ) [Express: STCRD.ACCNUMCR]';
COMMENT ON COLUMN doc_line.packing IS 'บรรจุ [Express: PACKING]';
COMMENT ON COLUMN doc_line.reimburse_flag IS 'สถานะเบิกชดเชย (เงินสดย่อย) [Express: STCRD.REIMBURSE]';
COMMENT ON COLUMN doc_line.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN doc_line.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN doc_line.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN doc_line.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN doc_line.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN doc_line.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN doc_line.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_doc_line_header_line_no ON doc_line (header_id, line_no) WHERE deleted_at IS NULL;
CREATE INDEX ix_doc_line_item_warehouse ON doc_line (item_id, warehouse_id);
CREATE INDEX ix_doc_line_source_line ON doc_line (source_line_id);

-- doc_note: หมายเหตุเพิ่มเติมของเอกสาร/บรรทัด (สูงสุด 10 บรรทัด)  [Express: ARTRNRM]
CREATE TABLE doc_note (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  header_id uuid NOT NULL,
  line_id uuid,
  seq smallint NOT NULL,
  text varchar(200) NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE doc_note IS 'หมายเหตุเพิ่มเติมของเอกสาร/บรรทัด (สูงสุด 10 บรรทัด) | Express: ARTRNRM | SEQNUM ''@1'' = หมายเหตุระดับเอกสาร '' 1'' = หมายเหตุของบรรทัดที่ 1';
COMMENT ON COLUMN doc_note.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN doc_note.company_id IS 'บริษัท';
COMMENT ON COLUMN doc_note.header_id IS 'เอกสาร [Express: ARTRNRM.DOCNUM]';
COMMENT ON COLUMN doc_note.line_id IS 'บรรทัด (ว่าง = ระดับเอกสาร) [Express: ARTRNRM.SEQNUM]';
COMMENT ON COLUMN doc_note.seq IS 'ลำดับหมายเหตุ';
COMMENT ON COLUMN doc_note.text IS 'ข้อความ [Express: ARTRNRM.REMARK]';
COMMENT ON COLUMN doc_note.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN doc_note.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN doc_note.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN doc_note.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN doc_note.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN doc_note.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN doc_note.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_doc_note_header_line_seq ON doc_note (header_id, COALESCE(line_id, '00000000-0000-0000-0000-000000000000'::uuid), seq) WHERE deleted_at IS NULL;

-- md_note: หมายเหตุเพิ่มเติมของแฟ้มหลัก (สินค้า ลูกค้า ผู้จำหน่าย) สูงสุด 10 บรรทัด  [Express: ARTRNRM (DOCNUM = รหัสสินค้า/ผู้จำหน่าย)]
CREATE TABLE md_note (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  entity_type varchar(10) NOT NULL CHECK (entity_type IN ('ITEM','CUSTOMER','SUPPLIER')),
  entity_id uuid NOT NULL,
  seq smallint NOT NULL,
  text varchar(200) NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE md_note IS 'หมายเหตุเพิ่มเติมของแฟ้มหลัก (สินค้า ลูกค้า ผู้จำหน่าย) สูงสุด 10 บรรทัด | Express: ARTRNRM (DOCNUM = รหัสสินค้า/ผู้จำหน่าย) | พบจากข้อมูลจริง: ARTRNRM ไม่ได้เก็บแค่หมายเหตุเอกสาร แต่เก็บหมายเหตุของสินค้า/ผู้จำหน่ายด้วย โดยใช้รหัสแทนเลขที่เอกสาร';
COMMENT ON COLUMN md_note.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN md_note.company_id IS 'บริษัท';
COMMENT ON COLUMN md_note.entity_type IS 'ITEM CUSTOMER SUPPLIER';
COMMENT ON COLUMN md_note.entity_id IS 'id ของสินค้า/ลูกค้า/ผู้จำหน่าย';
COMMENT ON COLUMN md_note.seq IS 'ลำดับ';
COMMENT ON COLUMN md_note.text IS 'ข้อความ [Express: ARTRNRM.REMARK]';
COMMENT ON COLUMN md_note.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN md_note.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN md_note.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN md_note.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN md_note.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN md_note.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN md_note.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_md_note_entity_type_entity_seq ON md_note (entity_type, entity_id, seq) WHERE deleted_at IS NULL;

-- doc_link: ความสัมพันธ์ระหว่างเอกสาร (อ้างถึง/แปลง/หักมัดจำ/ลดหนี้)  [Express: ARTRN.SONUM/ADVNUM, APTRN.PONUM/ADVNUM]
CREATE TABLE doc_link (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  from_header_id uuid NOT NULL,
  to_header_id uuid NOT NULL,
  link_type varchar(10) NOT NULL,
  amount numeric(18,2),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE doc_link IS 'ความสัมพันธ์ระหว่างเอกสาร (อ้างถึง/แปลง/หักมัดจำ/ลดหนี้) | Express: ARTRN.SONUM/ADVNUM, APTRN.PONUM/ADVNUM';
COMMENT ON COLUMN doc_link.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN doc_link.company_id IS 'บริษัท';
COMMENT ON COLUMN doc_link.from_header_id IS 'เอกสารต้นทาง (เช่น SO, PO, AI, AE, IV เดิม)';
COMMENT ON COLUMN doc_link.to_header_id IS 'เอกสารปลายทาง (IV, RR, SR …)';
COMMENT ON COLUMN doc_link.link_type IS 'FULFIL (SO→IV, PO→RR) CONVERT (QT→SO) DEPOSIT (AI→IV, AE→RR) ADJUST (IV→DR/SR, RR→CP/GR)';
COMMENT ON COLUMN doc_link.amount IS 'จำนวนเงินที่หัก/อ้างถึง (เช่น ยอดหักมัดจำ)';
COMMENT ON COLUMN doc_link.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN doc_link.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN doc_link.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN doc_link.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN doc_link.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN doc_link.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN doc_link.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_doc_link_from_header_to_header_link_type ON doc_link (from_header_id, to_header_id, link_type) WHERE deleted_at IS NULL;

-- doc_bill_item: รายการใบกำกับในใบวางบิล / ใบรับวางบิล  [Express: ARTRN.BILNUM / APTRN.BILNUM (+ARBILIT/APBILIT)]
CREATE TABLE doc_bill_item (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  bill_header_id uuid NOT NULL,
  invoice_header_id uuid NOT NULL,
  amount numeric(18,2) NOT NULL,
  vat_amount numeric(18,2),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE doc_bill_item IS 'รายการใบกำกับในใบวางบิล / ใบรับวางบิล | Express: ARTRN.BILNUM / APTRN.BILNUM (+ARBILIT/APBILIT)';
COMMENT ON COLUMN doc_bill_item.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN doc_bill_item.company_id IS 'บริษัท';
COMMENT ON COLUMN doc_bill_item.bill_header_id IS 'ใบวางบิล BI / ใบรับวางบิล BR';
COMMENT ON COLUMN doc_bill_item.invoice_header_id IS 'ใบกำกับ/ใบเพิ่มหนี้/ลดหนี้ ที่วางบิล';
COMMENT ON COLUMN doc_bill_item.amount IS 'ยอดที่วางบิล';
COMMENT ON COLUMN doc_bill_item.vat_amount IS 'ภาษี [Express: ARBILIT.VATAMT]';
COMMENT ON COLUMN doc_bill_item.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN doc_bill_item.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN doc_bill_item.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN doc_bill_item.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN doc_bill_item.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN doc_bill_item.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN doc_bill_item.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_doc_bill_item_bill_header_invoice_header ON doc_bill_item (bill_header_id, invoice_header_id) WHERE deleted_at IS NULL;

-- doc_settlement: การตัดชำระหนี้ (ใบเสร็จ RE / ใบสำคัญจ่าย PS ตัดใบกำกับใด เท่าใด)  [Express: ARRCPIT / APRCPIT]
CREATE TABLE doc_settlement (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  payment_header_id uuid,
  payment_journal_id uuid,
  invoice_header_id uuid NOT NULL,
  express_rectype char(1),
  amount numeric(18,2) NOT NULL,
  vat_amount numeric(18,2) DEFAULT 0 NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id),
  CHECK ((payment_header_id IS NULL) <> (payment_journal_id IS NULL))
);
COMMENT ON TABLE doc_settlement IS 'การตัดชำระหนี้ (ใบเสร็จ RE / ใบสำคัญจ่าย PS ตัดใบกำกับใด เท่าใด) | Express: ARRCPIT / APRCPIT | ต้องมี payment_header_id หรือ payment_journal_id อย่างใดอย่างหนึ่ง (CHECK)';
COMMENT ON COLUMN doc_settlement.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN doc_settlement.company_id IS 'บริษัท';
COMMENT ON COLUMN doc_settlement.payment_header_id IS 'ใบรับชำระ/จ่ายชำระ [Express: RCPNUM]';
COMMENT ON COLUMN doc_settlement.payment_journal_id IS 'หรือ ใบสำคัญ JV ที่ใช้ตัดหนี้ (พบในข้อมูลจริง) [Express: RCPNUM = GLJNL.VOUCHER]';
COMMENT ON COLUMN doc_settlement.invoice_header_id IS 'เอกสารที่ถูกตัด (IV DR SR AI / RR CP GR AE) [Express: DOCNUM]';
COMMENT ON COLUMN doc_settlement.express_rectype IS 'RECTYP ของเอกสารที่ถูกตัด [Express: RECTYP]';
COMMENT ON COLUMN doc_settlement.amount IS 'ยอดที่ตัดชำระ [Express: RCVAMT / PAYAMT]';
COMMENT ON COLUMN doc_settlement.vat_amount IS 'ภาษีที่ถึงกำหนด (เกณฑ์เงินสด) [Express: VATAMT]';
COMMENT ON COLUMN doc_settlement.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN doc_settlement.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN doc_settlement.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN doc_settlement.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN doc_settlement.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN doc_settlement.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN doc_settlement.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_doc_settlement_payment_header_payment_journal_invoice_hea ON doc_settlement (COALESCE(payment_header_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(payment_journal_id, '00000000-0000-0000-0000-000000000000'::uuid), invoice_header_id) WHERE deleted_at IS NULL;
CREATE INDEX ix_doc_settlement_invoice_header ON doc_settlement (invoice_header_id);

-- doc_payment: วิธีรับ/จ่ายเงินของเอกสาร (เงินสด เช็ค โอน หัก ณ ที่จ่าย …)  [Express: ARRCPCQ / APRCPCQ]
CREATE TABLE doc_payment (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  header_id uuid NOT NULL,
  line_no smallint NOT NULL,
  payment_method_id uuid NOT NULL,
  reference_no varchar(30),
  amount numeric(18,2) NOT NULL,
  cheque_id uuid,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE doc_payment IS 'วิธีรับ/จ่ายเงินของเอกสาร (เงินสด เช็ค โอน หัก ณ ที่จ่าย …) | Express: ARRCPCQ / APRCPCQ';
COMMENT ON COLUMN doc_payment.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN doc_payment.company_id IS 'บริษัท';
COMMENT ON COLUMN doc_payment.header_id IS 'เอกสาร (RE PS AI AE HS HP OI OE DP) [Express: RCPNUM]';
COMMENT ON COLUMN doc_payment.line_no IS 'ลำดับ';
COMMENT ON COLUMN doc_payment.payment_method_id IS 'วิธีชำระ (2 ตัวแรกของ CHQNUM) [Express: CHQNUM[1:2]]';
COMMENT ON COLUMN doc_payment.reference_no IS 'เลขที่อ้างอิง (เลขเช็ค/เลขโอน) [Express: CHQNUM[3:]]';
COMMENT ON COLUMN doc_payment.amount IS 'จำนวนเงิน (บวก=รับ/จ่ายจริง ลบ=ส่วนหัก) [Express: RCVAMT / PAYAMT]';
COMMENT ON COLUMN doc_payment.cheque_id IS 'รายการในทะเบียนเช็ค/โอน [Express: BKTRN.CHQNUM]';
COMMENT ON COLUMN doc_payment.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN doc_payment.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN doc_payment.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN doc_payment.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN doc_payment.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN doc_payment.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN doc_payment.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_doc_payment_header_line_no ON doc_payment (header_id, line_no) WHERE deleted_at IS NULL;

-- fin_cheque: ทะเบียนเช็ครับ/เช็คจ่าย และรายการโอนผ่านธนาคาร  [Express: BKTRN]
CREATE TABLE fin_cheque (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  branch_id uuid,
  direction char(1) NOT NULL CHECK (direction IN ('R','P')),
  instrument varchar(10) NOT NULL,
  cheque_no varchar(30) NOT NULL,
  cheque_date date NOT NULL,
  bank_id uuid,
  bank_branch varchar(60),
  bank_account_id uuid,
  customer_id uuid,
  supplier_id uuid,
  payee_name varchar(120),
  department_id uuid,
  received_date date,
  deposit_date date,
  pass_date date,
  amount numeric(18,2) NOT NULL,
  charge numeric(18,2) DEFAULT 0 NOT NULL,
  net_amount numeric(18,2) NOT NULL,
  remaining_amount numeric(18,2) DEFAULT 0 NOT NULL,
  status varchar(4) NOT NULL,
  is_settled boolean DEFAULT false NOT NULL,
  source_header_id uuid,
  deposit_header_id uuid,
  pass_journal_id uuid,
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
COMMENT ON TABLE fin_cheque IS 'ทะเบียนเช็ครับ/เช็คจ่าย และรายการโอนผ่านธนาคาร | Express: BKTRN';
COMMENT ON COLUMN fin_cheque.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN fin_cheque.company_id IS 'บริษัท';
COMMENT ON COLUMN fin_cheque.branch_id IS 'สาขา';
COMMENT ON COLUMN fin_cheque.direction IS 'R=รับ P=จ่าย [Express: BKTRN.BKTRNTYP]';
COMMENT ON COLUMN fin_cheque.instrument IS 'CHEQUE TRANSFER CARD [Express: BKTRN.BKTRNTYP (QR/QP=เช็ค bR/bP=โอน)]';
COMMENT ON COLUMN fin_cheque.cheque_no IS 'เลขที่เช็ค/อ้างอิง [Express: BKTRN.CHQNUM]';
COMMENT ON COLUMN fin_cheque.cheque_date IS 'วันที่หน้าเช็ค [Express: BKTRN.CHQDAT]';
COMMENT ON COLUMN fin_cheque.bank_id IS 'ธนาคารของเช็ค (เช็ครับ) [Express: BKTRN.BNKCOD]';
COMMENT ON COLUMN fin_cheque.bank_branch IS 'สาขาธนาคาร [Express: BKTRN.BRANCH]';
COMMENT ON COLUMN fin_cheque.bank_account_id IS 'บัญชีเงินฝากของกิจการ (นำฝาก/สั่งจ่าย) [Express: BKTRN.BNKACC]';
COMMENT ON COLUMN fin_cheque.customer_id IS 'ลูกค้าผู้สั่งจ่าย [Express: BKTRN.CUSCOD]';
COMMENT ON COLUMN fin_cheque.supplier_id IS 'ผู้รับเงิน [Express: BKTRN.CUSCOD]';
COMMENT ON COLUMN fin_cheque.payee_name IS 'ชื่อบนเช็ค [Express: BKTRN.NAME]';
COMMENT ON COLUMN fin_cheque.department_id IS 'แผนก [Express: BKTRN.DEPCOD]';
COMMENT ON COLUMN fin_cheque.received_date IS 'วันที่รับเช็ค [Express: BKTRN.GETDAT]';
COMMENT ON COLUMN fin_cheque.deposit_date IS 'วันที่นำฝาก [Express: BKTRN.PAYINDAT]';
COMMENT ON COLUMN fin_cheque.pass_date IS 'วันที่เช็คผ่าน [Express: BKTRN.TRNDAT]';
COMMENT ON COLUMN fin_cheque.amount IS 'จำนวนเงินหน้าเช็ค [Express: BKTRN.AMOUNT]';
COMMENT ON COLUMN fin_cheque.charge IS 'ค่าธรรมเนียม [Express: BKTRN.CHARGE]';
COMMENT ON COLUMN fin_cheque.net_amount IS 'ยอดสุทธิเข้าบัญชี [Express: BKTRN.NETAMT]';
COMMENT ON COLUMN fin_cheque.remaining_amount IS 'ยอดเช็คที่ยังไม่ได้ใช้ตัดหนี้ [Express: BKTRN.REMAMT]';
COMMENT ON COLUMN fin_cheque.status IS 'สถานะเช็ค (ISTAB 02): 00 ในมือ 01 รอเรียกเก็บ 02 คืนยื่นใหม่ 05 คืน 10 ผ่าน 19 ผ่าน(โอน) … [Express: BKTRN.CHQSTAT]';
COMMENT ON COLUMN fin_cheque.is_settled IS 'ใช้ตัดหนี้ครบแล้ว [Express: BKTRN.CMPLAPP]';
COMMENT ON COLUMN fin_cheque.source_header_id IS 'เอกสารที่รับ/จ่ายเช็คนี้ [Express: BKTRN.VOUCHER]';
COMMENT ON COLUMN fin_cheque.deposit_header_id IS 'ใบนำฝากเช็ค BQ/SQ [Express: BKTRNIT.DEPNUM]';
COMMENT ON COLUMN fin_cheque.pass_journal_id IS 'ใบสำคัญผ่านเช็ค';
COMMENT ON COLUMN fin_cheque.remark IS 'หมายเหตุ [Express: BKTRN.REMARK]';
COMMENT ON COLUMN fin_cheque.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN fin_cheque.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN fin_cheque.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN fin_cheque.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN fin_cheque.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN fin_cheque.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN fin_cheque.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_fin_cheque_company_direction_cheque_no_bank_account ON fin_cheque (company_id, direction, cheque_no, COALESCE(bank_account_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE deleted_at IS NULL;
CREATE INDEX ix_fin_cheque_company_status_cheque_date ON fin_cheque (company_id, status, cheque_date);

-- fin_cheque_event: ประวัติสถานะเช็ค (นำฝาก ผ่าน คืน ยื่นใหม่ ขายลด)  [Express: (Express เก็บเฉพาะสถานะล่าสุด)]
CREATE TABLE fin_cheque_event (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  cheque_id uuid NOT NULL,
  event_date date NOT NULL,
  from_status varchar(4),
  to_status varchar(4) NOT NULL,
  reason varchar(200),
  header_id uuid,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE fin_cheque_event IS 'ประวัติสถานะเช็ค (นำฝาก ผ่าน คืน ยื่นใหม่ ขายลด) | Express: (Express เก็บเฉพาะสถานะล่าสุด)';
COMMENT ON COLUMN fin_cheque_event.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN fin_cheque_event.company_id IS 'บริษัท';
COMMENT ON COLUMN fin_cheque_event.cheque_id IS 'เช็ค';
COMMENT ON COLUMN fin_cheque_event.event_date IS 'วันที่';
COMMENT ON COLUMN fin_cheque_event.from_status IS 'สถานะเดิม';
COMMENT ON COLUMN fin_cheque_event.to_status IS 'สถานะใหม่';
COMMENT ON COLUMN fin_cheque_event.reason IS 'เหตุผล (เช่น เช็คคืนเพราะเงินไม่พอ)';
COMMENT ON COLUMN fin_cheque_event.header_id IS 'เอกสารที่ทำให้เปลี่ยนสถานะ';
COMMENT ON COLUMN fin_cheque_event.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN fin_cheque_event.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN fin_cheque_event.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN fin_cheque_event.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN fin_cheque_event.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN fin_cheque_event.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN fin_cheque_event.origin_device_id IS 'เครื่องที่สร้างแถวนี้';

-- fin_bank_ledger: สมุดบัญชีเงินฝาก (ทุกการเคลื่อนไหว ใช้กระทบยอดธนาคาร)  [Express: (คำนวณจาก BKTRN/เอกสาร)]
CREATE TABLE fin_bank_ledger (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  bank_account_id uuid NOT NULL,
  txn_date date NOT NULL,
  amount numeric(18,2) NOT NULL,
  header_id uuid,
  cheque_id uuid,
  description varchar(200),
  statement_ref varchar(30),
  reconciled_at date,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE fin_bank_ledger IS 'สมุดบัญชีเงินฝาก (ทุกการเคลื่อนไหว ใช้กระทบยอดธนาคาร) | Express: (คำนวณจาก BKTRN/เอกสาร)';
COMMENT ON COLUMN fin_bank_ledger.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN fin_bank_ledger.company_id IS 'บริษัท';
COMMENT ON COLUMN fin_bank_ledger.bank_account_id IS 'บัญชีเงินฝาก';
COMMENT ON COLUMN fin_bank_ledger.txn_date IS 'วันที่';
COMMENT ON COLUMN fin_bank_ledger.amount IS 'จำนวนเงิน (+ฝาก −ถอน)';
COMMENT ON COLUMN fin_bank_ledger.header_id IS 'เอกสารต้นทาง';
COMMENT ON COLUMN fin_bank_ledger.cheque_id IS 'เช็ค/โอน';
COMMENT ON COLUMN fin_bank_ledger.description IS 'คำอธิบาย';
COMMENT ON COLUMN fin_bank_ledger.statement_ref IS 'อ้างอิง Bank statement (กระทบยอด)';
COMMENT ON COLUMN fin_bank_ledger.reconciled_at IS 'วันที่กระทบยอดแล้ว';
COMMENT ON COLUMN fin_bank_ledger.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN fin_bank_ledger.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN fin_bank_ledger.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN fin_bank_ledger.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN fin_bank_ledger.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN fin_bank_ledger.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN fin_bank_ledger.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE INDEX ix_fin_bank_ledger_bank_account_txn_date ON fin_bank_ledger (bank_account_id, txn_date);

-- inv_stock_ledger: บัญชีคุมสินค้า (สต๊อกการ์ด) — หนึ่งแถวต่อการเคลื่อนไหวที่ post แล้ว  [Express: STCRD (ส่วนที่ POSOPR ≠ ว่าง)]
CREATE TABLE inv_stock_ledger (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  item_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  txn_date date NOT NULL,
  line_id uuid NOT NULL,
  movement_code char(1) NOT NULL,
  qty numeric(18,4) NOT NULL,
  unit_cost numeric(18,4) NOT NULL,
  value numeric(18,2) NOT NULL,
  balance_qty numeric(18,4),
  balance_value numeric(18,2),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE inv_stock_ledger IS 'บัญชีคุมสินค้า (สต๊อกการ์ด) — หนึ่งแถวต่อการเคลื่อนไหวที่ post แล้ว | Express: STCRD (ส่วนที่ POSOPR ≠ ว่าง)';
COMMENT ON COLUMN inv_stock_ledger.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN inv_stock_ledger.company_id IS 'บริษัท';
COMMENT ON COLUMN inv_stock_ledger.item_id IS 'สินค้า [Express: STCRD.STKCOD]';
COMMENT ON COLUMN inv_stock_ledger.warehouse_id IS 'คลัง [Express: STCRD.LOCCOD]';
COMMENT ON COLUMN inv_stock_ledger.txn_date IS 'วันที่ [Express: STCRD.DOCDAT]';
COMMENT ON COLUMN inv_stock_ledger.line_id IS 'บรรทัดเอกสาร [Express: STCRD]';
COMMENT ON COLUMN inv_stock_ledger.movement_code IS 'รหัสการเคลื่อนไหว (POSOPR) [Express: STCRD.POSOPR]';
COMMENT ON COLUMN inv_stock_ledger.qty IS 'จำนวนหน่วยหลัก (+เข้า −ออก) [Express: XTRNQTY]';
COMMENT ON COLUMN inv_stock_ledger.unit_cost IS 'ต้นทุนต่อหน่วย [Express: XUNITPR]';
COMMENT ON COLUMN inv_stock_ledger.value IS 'มูลค่า (+/−) [Express: XTRNVAL]';
COMMENT ON COLUMN inv_stock_ledger.balance_qty IS 'ยอดคงเหลือหลังรายการ (running)';
COMMENT ON COLUMN inv_stock_ledger.balance_value IS 'มูลค่าคงเหลือหลังรายการ';
COMMENT ON COLUMN inv_stock_ledger.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN inv_stock_ledger.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN inv_stock_ledger.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN inv_stock_ledger.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN inv_stock_ledger.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN inv_stock_ledger.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN inv_stock_ledger.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE INDEX ix_inv_stock_ledger_item_warehouse_txn_date ON inv_stock_ledger (item_id, warehouse_id, txn_date);

-- inv_cost_layer: ล็อตต้นทุน FIFO (รับเข้าแต่ละครั้ง และยอดคงเหลือของล็อต)  [Express: STCRD.MLOTNUM/MREMBAL/MREMVAL]
CREATE TABLE inv_cost_layer (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  item_id uuid NOT NULL,
  warehouse_id uuid,
  receipt_line_id uuid NOT NULL,
  lot_date date NOT NULL,
  qty_in numeric(18,4) NOT NULL,
  value_in numeric(18,2) NOT NULL,
  qty_remaining numeric(18,4) NOT NULL,
  value_remaining numeric(18,2) NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE inv_cost_layer IS 'ล็อตต้นทุน FIFO (รับเข้าแต่ละครั้ง และยอดคงเหลือของล็อต) | Express: STCRD.MLOTNUM/MREMBAL/MREMVAL';
COMMENT ON COLUMN inv_cost_layer.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN inv_cost_layer.company_id IS 'บริษัท';
COMMENT ON COLUMN inv_cost_layer.item_id IS 'สินค้า';
COMMENT ON COLUMN inv_cost_layer.warehouse_id IS 'คลัง (ถ้าคิดต้นทุนแยกคลัง)';
COMMENT ON COLUMN inv_cost_layer.receipt_line_id IS 'บรรทัดที่รับเข้า (เกิดล็อต)';
COMMENT ON COLUMN inv_cost_layer.lot_date IS 'วันที่ล็อต';
COMMENT ON COLUMN inv_cost_layer.qty_in IS 'จำนวนรับ';
COMMENT ON COLUMN inv_cost_layer.value_in IS 'มูลค่ารับ';
COMMENT ON COLUMN inv_cost_layer.qty_remaining IS 'จำนวนคงเหลือในล็อต [Express: MREMBAL]';
COMMENT ON COLUMN inv_cost_layer.value_remaining IS 'มูลค่าคงเหลือในล็อต [Express: MREMVAL]';
COMMENT ON COLUMN inv_cost_layer.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN inv_cost_layer.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN inv_cost_layer.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN inv_cost_layer.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN inv_cost_layer.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN inv_cost_layer.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN inv_cost_layer.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE INDEX ix_inv_cost_layer_item_warehouse_lot_date ON inv_cost_layer (item_id, warehouse_id, lot_date);

-- inv_cost_consumption: การตัดล็อต FIFO ของบรรทัดจ่ายออก  [Express: STCRD.MLOTNUM ของบรรทัดจ่ายออก]
CREATE TABLE inv_cost_consumption (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  issue_line_id uuid NOT NULL,
  layer_id uuid NOT NULL,
  qty numeric(18,4) NOT NULL,
  value numeric(18,2) NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE inv_cost_consumption IS 'การตัดล็อต FIFO ของบรรทัดจ่ายออก | Express: STCRD.MLOTNUM ของบรรทัดจ่ายออก';
COMMENT ON COLUMN inv_cost_consumption.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN inv_cost_consumption.company_id IS 'บริษัท';
COMMENT ON COLUMN inv_cost_consumption.issue_line_id IS 'บรรทัดจ่ายออก';
COMMENT ON COLUMN inv_cost_consumption.layer_id IS 'ล็อตที่ถูกตัด';
COMMENT ON COLUMN inv_cost_consumption.qty IS 'จำนวนที่ตัด';
COMMENT ON COLUMN inv_cost_consumption.value IS 'มูลค่าที่ตัด';
COMMENT ON COLUMN inv_cost_consumption.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN inv_cost_consumption.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN inv_cost_consumption.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN inv_cost_consumption.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN inv_cost_consumption.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN inv_cost_consumption.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN inv_cost_consumption.origin_device_id IS 'เครื่องที่สร้างแถวนี้';

-- inv_stock_balance: ยอดคงเหลือปัจจุบันต่อสินค้า×คลัง (สรุปจาก ledger; client ใช้แบบอ่านอย่างเดียว)  [Express: STLOC (+STMAS.TOTBAL)]
CREATE TABLE inv_stock_balance (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  item_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  qty_on_hand numeric(18,4) DEFAULT 0 NOT NULL,
  value_on_hand numeric(18,2) DEFAULT 0 NOT NULL,
  avg_cost numeric(18,4),
  qty_on_order numeric(18,4) DEFAULT 0 NOT NULL,
  qty_reserved numeric(18,4) DEFAULT 0 NOT NULL,
  qty_offline_pending numeric(18,4) DEFAULT 0 NOT NULL,
  last_purchase_date date,
  last_sale_date date,
  last_move_date date,
  last_count_date date,
  shelf varchar(10),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE inv_stock_balance IS 'ยอดคงเหลือปัจจุบันต่อสินค้า×คลัง (สรุปจาก ledger; client ใช้แบบอ่านอย่างเดียว) | Express: STLOC (+STMAS.TOTBAL) | ยอดรายงวด QTY1–QTY12NY/VAL1–VAL12NY ใน STLOC ไม่เก็บ ใช้ view จาก inv_stock_ledger';
COMMENT ON COLUMN inv_stock_balance.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN inv_stock_balance.company_id IS 'บริษัท';
COMMENT ON COLUMN inv_stock_balance.item_id IS 'สินค้า [Express: STLOC.STKCOD]';
COMMENT ON COLUMN inv_stock_balance.warehouse_id IS 'คลัง [Express: STLOC.LOCCOD]';
COMMENT ON COLUMN inv_stock_balance.qty_on_hand IS 'ยอดคงเหลือ [Express: STLOC.LOCBAL]';
COMMENT ON COLUMN inv_stock_balance.value_on_hand IS 'มูลค่าคงเหลือ [Express: STLOC.LOCVAL]';
COMMENT ON COLUMN inv_stock_balance.avg_cost IS 'ต้นทุนเฉลี่ย/หน่วย [Express: STLOC.UNITPR]';
COMMENT ON COLUMN inv_stock_balance.qty_on_order IS 'ค้างรับจาก PO [Express: STLOC.LOCREO]';
COMMENT ON COLUMN inv_stock_balance.qty_reserved IS 'ค้างส่งตาม SO [Express: STLOC.LOCRES]';
COMMENT ON COLUMN inv_stock_balance.qty_offline_pending IS '(client) ยอดที่ตัด/รับในเครื่องแต่ยังไม่ซิงก์';
COMMENT ON COLUMN inv_stock_balance.last_purchase_date IS 'ซื้อล่าสุด [Express: STLOC.LPURDAT]';
COMMENT ON COLUMN inv_stock_balance.last_sale_date IS 'ขายล่าสุด [Express: STLOC.LSELDAT]';
COMMENT ON COLUMN inv_stock_balance.last_move_date IS 'เคลื่อนไหวล่าสุด [Express: STLOC.LMOVDAT]';
COMMENT ON COLUMN inv_stock_balance.last_count_date IS 'ตรวจนับล่าสุด [Express: STLOC.TAKDAT]';
COMMENT ON COLUMN inv_stock_balance.shelf IS 'ชั้นเก็บ [Express: STLOC.AREA]';
COMMENT ON COLUMN inv_stock_balance.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN inv_stock_balance.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN inv_stock_balance.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN inv_stock_balance.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN inv_stock_balance.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN inv_stock_balance.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN inv_stock_balance.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_inv_stock_balance_company_item_warehouse ON inv_stock_balance (company_id, item_id, warehouse_id) WHERE deleted_at IS NULL;

-- inv_stock_count: ผลการตรวจนับสินค้า  [Express: STTAK]
CREATE TABLE inv_stock_count (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  item_id uuid NOT NULL,
  count_date date NOT NULL,
  shelf varchar(10),
  counted_qty numeric(18,4),
  counted_unit_qty numeric(18,4),
  system_qty numeric(18,4),
  diff_qty numeric(18,4),
  flag char(1) DEFAULT '1' NOT NULL,
  adjust_line_id uuid,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE inv_stock_count IS 'ผลการตรวจนับสินค้า | Express: STTAK';
COMMENT ON COLUMN inv_stock_count.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN inv_stock_count.company_id IS 'บริษัท';
COMMENT ON COLUMN inv_stock_count.warehouse_id IS 'คลัง [Express: STTAK.LOCCOD]';
COMMENT ON COLUMN inv_stock_count.item_id IS 'สินค้า [Express: STTAK.STKCOD]';
COMMENT ON COLUMN inv_stock_count.count_date IS 'วันที่ตรวจนับ [Express: STTAK.TAKDAT]';
COMMENT ON COLUMN inv_stock_count.shelf IS 'พื้นที่/ชั้นเก็บ [Express: STTAK.AREA]';
COMMENT ON COLUMN inv_stock_count.counted_qty IS 'จำนวนที่นับได้ (หน่วยหลัก) [Express: STTAK.PHYBAL]';
COMMENT ON COLUMN inv_stock_count.counted_unit_qty IS 'จำนวนนับในหน่วยตรวจนับ [Express: STTAK.XQUQTY]';
COMMENT ON COLUMN inv_stock_count.system_qty IS 'ยอดตามระบบ ณ วันนับ';
COMMENT ON COLUMN inv_stock_count.diff_qty IS 'ผลต่าง [Express: STTAK.DIFQTY]';
COMMENT ON COLUMN inv_stock_count.flag IS '1=เตรียมนับ 3=บันทึกผลนับ 6=ปรับปรุงแล้ว [Express: STTAK.TAKFLG]';
COMMENT ON COLUMN inv_stock_count.adjust_line_id IS 'บรรทัดใบปรับปรุง TK ที่สร้าง [Express: STTAK.DOCNUM+SEQNUM]';
COMMENT ON COLUMN inv_stock_count.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN inv_stock_count.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN inv_stock_count.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN inv_stock_count.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN inv_stock_count.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN inv_stock_count.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN inv_stock_count.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_inv_stock_count_company_warehouse_item_count_date ON inv_stock_count (company_id, warehouse_id, item_id, count_date) WHERE deleted_at IS NULL;

-- md_serial: ทะเบียนหมายเลขเครื่อง/Serial และการรับประกัน  [Express: ISSN]
CREATE TABLE md_serial (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  serial_no varchar(40) NOT NULL,
  machine_no varchar(40),
  category_code varchar(10),
  item_id uuid,
  sale_line_id uuid,
  sale_date date,
  warranty_end date,
  customer_id uuid,
  description varchar(200),
  ref_code varchar(30),
  customer_name varchar(200),
  salesperson_id uuid,
  print_count integer DEFAULT 0 NOT NULL,
  last_printed_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE md_serial IS 'ทะเบียนหมายเลขเครื่อง/Serial และการรับประกัน | Express: ISSN';
COMMENT ON COLUMN md_serial.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN md_serial.company_id IS 'บริษัท';
COMMENT ON COLUMN md_serial.serial_no IS 'หมายเลขเครื่อง [Express: ISSN.SERIAL]';
COMMENT ON COLUMN md_serial.machine_no IS 'Machine No. [Express: ISSN.M_NO]';
COMMENT ON COLUMN md_serial.category_code IS 'หมวดสินค้า [Express: ISSN.STKGRP]';
COMMENT ON COLUMN md_serial.item_id IS 'สินค้า';
COMMENT ON COLUMN md_serial.sale_line_id IS 'บรรทัดขาย [Express: ISSN.IVCNUM]';
COMMENT ON COLUMN md_serial.sale_date IS 'วันที่ขาย [Express: ISSN.SAL_DATE]';
COMMENT ON COLUMN md_serial.warranty_end IS 'สิ้นสุดประกัน [Express: ISSN.EXP_DATE]';
COMMENT ON COLUMN md_serial.customer_id IS 'ลูกค้า [Express: ISSN.CUSCOD]';
COMMENT ON COLUMN md_serial.description IS 'รายละเอียด [Express: ISSN.DESCRIP]';
COMMENT ON COLUMN md_serial.ref_code IS 'รหัสอ้างอิง (สื่อความหมาย เช่น CDROM ASUS 48X) [Express: ISSN.M_INFO]';
COMMENT ON COLUMN md_serial.customer_name IS 'ชื่อลูกค้า (กรณีไม่มีรหัส) [Express: ISSN.CUSNAM]';
COMMENT ON COLUMN md_serial.salesperson_id IS 'ผู้ขาย [Express: ISSN.SLMNAM]';
COMMENT ON COLUMN md_serial.print_count IS 'จำนวนครั้งที่พิมพ์บัตรรับประกัน [Express: ISSN.PRNCNT]';
COMMENT ON COLUMN md_serial.last_printed_at IS 'พิมพ์บัตรรับประกันล่าสุด [Express: ISSN.PRNDAT]';
COMMENT ON COLUMN md_serial.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN md_serial.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN md_serial.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN md_serial.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN md_serial.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN md_serial.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN md_serial.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_md_serial_company_serial_no ON md_serial (company_id, serial_no) WHERE deleted_at IS NULL;

-- md_serial_service: ประวัติการซ่อม/บริการของ Serial  [Express: ISSNIT]
CREATE TABLE md_serial_service (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  serial_id uuid NOT NULL,
  service_date date NOT NULL,
  service_by varchar(60),
  detail text,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE md_serial_service IS 'ประวัติการซ่อม/บริการของ Serial | Express: ISSNIT';
COMMENT ON COLUMN md_serial_service.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN md_serial_service.company_id IS 'บริษัท';
COMMENT ON COLUMN md_serial_service.serial_id IS 'Serial';
COMMENT ON COLUMN md_serial_service.service_date IS 'วันที่ [Express: ISSNIT.DATE]';
COMMENT ON COLUMN md_serial_service.service_by IS 'ผู้ให้บริการ [Express: ISSNIT.SERVANT]';
COMMENT ON COLUMN md_serial_service.detail IS 'รายละเอียด [Express: ISSNIT.SERVDESC]';
COMMENT ON COLUMN md_serial_service.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN md_serial_service.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN md_serial_service.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN md_serial_service.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN md_serial_service.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN md_serial_service.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN md_serial_service.origin_device_id IS 'เครื่องที่สร้างแถวนี้';

-- gl_journal: ใบสำคัญ / รายการสมุดรายวัน (ทั้งบันทึกเองและที่ระบบอื่นส่งมา)  [Express: GLJNL]
CREATE TABLE gl_journal (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  branch_id uuid,
  journal_book_id uuid NOT NULL,
  voucher_no varchar(30) NOT NULL,
  voucher_date date NOT NULL,
  period_id uuid NOT NULL,
  description varchar(200),
  reference varchar(30),
  source_module varchar(4),
  source_header_id uuid,
  status char(1) DEFAULT 'U' NOT NULL CHECK (status IN ('U','P')),
  doc_status char(1) DEFAULT 'N' NOT NULL CHECK (doc_status IN ('N','C')),
  reversal_of_id uuid,
  posted_by uuid,
  posted_at timestamptz,
  total_debit numeric(18,2) DEFAULT 0 NOT NULL,
  total_credit numeric(18,2) DEFAULT 0 NOT NULL,
  print_count smallint DEFAULT 0 NOT NULL,
  approved_by uuid,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE gl_journal IS 'ใบสำคัญ / รายการสมุดรายวัน (ทั้งบันทึกเองและที่ระบบอื่นส่งมา) | Express: GLJNL';
COMMENT ON COLUMN gl_journal.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN gl_journal.company_id IS 'บริษัท';
COMMENT ON COLUMN gl_journal.branch_id IS 'สาขา';
COMMENT ON COLUMN gl_journal.journal_book_id IS 'สมุดรายวัน [Express: GLJNL.JNLTYP]';
COMMENT ON COLUMN gl_journal.voucher_no IS 'เลขที่ใบสำคัญ (เอกสารจากระบบอื่นใช้เลขเดียวกับเอกสาร) [Express: GLJNL.VOUCHER]';
COMMENT ON COLUMN gl_journal.voucher_date IS 'วันที่ [Express: GLJNL.VOUDAT]';
COMMENT ON COLUMN gl_journal.period_id IS 'งวดบัญชี';
COMMENT ON COLUMN gl_journal.description IS 'คำอธิบาย [Express: GLJNL.DESCRP]';
COMMENT ON COLUMN gl_journal.reference IS 'อ้างอิง [Express: GLJNL.REFNUM]';
COMMENT ON COLUMN gl_journal.source_module IS 'ระบบต้นทาง (ว่าง = บันทึกเองใน GL) [Express: GLJNL.SRCJNL]';
COMMENT ON COLUMN gl_journal.source_header_id IS 'เอกสารต้นทาง';
COMMENT ON COLUMN gl_journal.status IS 'U=ยังไม่ผ่านรายการ P=ผ่านรายการแล้ว (Post) [Express: GLJNL.TRNSTAT]';
COMMENT ON COLUMN gl_journal.doc_status IS 'N=ปกติ C=ยกเลิก [Express: GLJNL.DOCSTAT]';
COMMENT ON COLUMN gl_journal.reversal_of_id IS 'กลับรายการของใบสำคัญใด [Express: GLJNL.REVERSE]';
COMMENT ON COLUMN gl_journal.posted_by IS 'ผู้ผ่านรายการ [Express: GLJNL.POSTID]';
COMMENT ON COLUMN gl_journal.posted_at IS 'วันที่ผ่านรายการ [Express: GLJNL.POSDAT]';
COMMENT ON COLUMN gl_journal.total_debit IS 'รวมเดบิต';
COMMENT ON COLUMN gl_journal.total_credit IS 'รวมเครดิต';
COMMENT ON COLUMN gl_journal.print_count IS 'จำนวนครั้งที่พิมพ์ [Express: GLJNL.PRNCNT]';
COMMENT ON COLUMN gl_journal.approved_by IS 'ผู้อนุมัติ [Express: GLJNL.APPROVE]';
COMMENT ON COLUMN gl_journal.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN gl_journal.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN gl_journal.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN gl_journal.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN gl_journal.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN gl_journal.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN gl_journal.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_gl_journal_company_journal_book_voucher_no ON gl_journal (company_id, journal_book_id, voucher_no) WHERE deleted_at IS NULL;
CREATE INDEX ix_gl_journal_company_voucher_date ON gl_journal (company_id, voucher_date);
CREATE INDEX ix_gl_journal_source_header ON gl_journal (source_header_id);

-- gl_journal_line: รายการเดบิต/เครดิตของใบสำคัญ  [Express: GLJNLIT]
CREATE TABLE gl_journal_line (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  journal_id uuid NOT NULL,
  line_no smallint NOT NULL,
  account_id uuid NOT NULL,
  department_id uuid,
  project_id uuid,
  project_phase varchar(10),
  cost_code varchar(10),
  description varchar(200),
  debit numeric(18,2) DEFAULT 0 NOT NULL,
  credit numeric(18,2) DEFAULT 0 NOT NULL,
  posting_role varchar(30),
  resolved_from char(1),
  changed_from_account_id uuid,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id),
  CHECK (debit >= 0 AND credit >= 0 AND (debit = 0 OR credit = 0))
);
COMMENT ON TABLE gl_journal_line IS 'รายการเดบิต/เครดิตของใบสำคัญ | Express: GLJNLIT | CHECK: แต่ละบรรทัดมีได้แค่เดบิตหรือเครดิต; ผลรวมต่อใบสำคัญต้องเท่ากัน (ตรวจด้วย trigger ตอน post)';
COMMENT ON COLUMN gl_journal_line.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN gl_journal_line.company_id IS 'บริษัท';
COMMENT ON COLUMN gl_journal_line.journal_id IS 'ใบสำคัญ [Express: GLJNLIT.VOUCHER]';
COMMENT ON COLUMN gl_journal_line.line_no IS 'ลำดับ [Express: GLJNLIT.SEQIT]';
COMMENT ON COLUMN gl_journal_line.account_id IS 'บัญชี [Express: GLJNLIT.ACCNUM]';
COMMENT ON COLUMN gl_journal_line.department_id IS 'แผนก [Express: GLJNLIT.DEPCOD]';
COMMENT ON COLUMN gl_journal_line.project_id IS 'โครงการ [Express: GLJNLIT.JOBCOD]';
COMMENT ON COLUMN gl_journal_line.project_phase IS 'ขั้นตอนโครงการ [Express: GLJNLIT.PHASE]';
COMMENT ON COLUMN gl_journal_line.cost_code IS 'รหัสต้นทุน [Express: GLJNLIT.COSCOD]';
COMMENT ON COLUMN gl_journal_line.description IS 'คำอธิบายรายการ [Express: GLJNLIT.DESCRP]';
COMMENT ON COLUMN gl_journal_line.debit IS 'เดบิต [Express: GLJNLIT.AMOUNT เมื่อ TRNTYP=''0'']';
COMMENT ON COLUMN gl_journal_line.credit IS 'เครดิต [Express: GLJNLIT.AMOUNT เมื่อ TRNTYP=''1'']';
COMMENT ON COLUMN gl_journal_line.posting_role IS 'บทบาทที่กฎใช้หาบัญชี (ตรวจย้อนได้ว่าทำไมลงบัญชีนี้)';
COMMENT ON COLUMN gl_journal_line.resolved_from IS 'หาบัญชีได้จากชั้นใด 1=ประเภทเอกสาร 2=แฟ้มหลัก 3=บัญชีมาตรฐาน S=บัญชีพัก M=ป้อนเอง';
COMMENT ON COLUMN gl_journal_line.changed_from_account_id IS 'บัญชีเดิมก่อนแก้ [Express: GLJNLIT.CHGACCFROM]';
COMMENT ON COLUMN gl_journal_line.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN gl_journal_line.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN gl_journal_line.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN gl_journal_line.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN gl_journal_line.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN gl_journal_line.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN gl_journal_line.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_gl_journal_line_journal_line_no ON gl_journal_line (journal_id, line_no) WHERE deleted_at IS NULL;
CREATE INDEX ix_gl_journal_line_account ON gl_journal_line (account_id);

-- gl_balance: ยอดสะสมรายงวดต่อบัญชี×แผนก (สรุปจาก gl_journal_line)  [Express: GLBAL (DEBITn/CREDITn ×36 ช่อง)]
CREATE TABLE gl_balance (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  account_id uuid NOT NULL,
  department_id uuid,
  period_id uuid NOT NULL,
  opening numeric(18,2) DEFAULT 0 NOT NULL,
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
COMMENT ON TABLE gl_balance IS 'ยอดสะสมรายงวดต่อบัญชี×แผนก (สรุปจาก gl_journal_line) | Express: GLBAL (DEBITn/CREDITn ×36 ช่อง)';
COMMENT ON COLUMN gl_balance.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN gl_balance.company_id IS 'บริษัท';
COMMENT ON COLUMN gl_balance.account_id IS 'บัญชี [Express: GLBAL.ACCNUM]';
COMMENT ON COLUMN gl_balance.department_id IS 'แผนก [Express: GLBAL.DEPCOD]';
COMMENT ON COLUMN gl_balance.period_id IS 'งวด';
COMMENT ON COLUMN gl_balance.opening IS 'ยอดยกมาต้นงวด (เฉพาะงวดแรกของปี) [Express: GLBAL.BEGLY]';
COMMENT ON COLUMN gl_balance.debit IS 'รวมเดบิตในงวด [Express: GLBAL.DEBITn]';
COMMENT ON COLUMN gl_balance.credit IS 'รวมเครดิตในงวด [Express: GLBAL.CREDITn]';
COMMENT ON COLUMN gl_balance.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN gl_balance.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN gl_balance.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN gl_balance.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN gl_balance.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN gl_balance.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN gl_balance.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_gl_balance_company_account_department_period ON gl_balance (company_id, account_id, COALESCE(department_id, '00000000-0000-0000-0000-000000000000'::uuid), period_id) WHERE deleted_at IS NULL;

-- gl_budget: งบประมาณรายงวด  [Express: GLBUD]
CREATE TABLE gl_budget (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  account_id uuid NOT NULL,
  department_id uuid,
  period_id uuid NOT NULL,
  amount numeric(18,2) NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE gl_budget IS 'งบประมาณรายงวด | Express: GLBUD';
COMMENT ON COLUMN gl_budget.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN gl_budget.company_id IS 'บริษัท';
COMMENT ON COLUMN gl_budget.account_id IS 'บัญชี [Express: GLBUD.ACCNUM]';
COMMENT ON COLUMN gl_budget.department_id IS 'แผนก [Express: GLBUD.DEPCOD]';
COMMENT ON COLUMN gl_budget.period_id IS 'งวด';
COMMENT ON COLUMN gl_budget.amount IS 'งบประมาณ [Express: GLBUD.AMTn]';
COMMENT ON COLUMN gl_budget.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN gl_budget.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN gl_budget.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN gl_budget.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN gl_budget.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN gl_budget.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN gl_budget.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_gl_budget_company_account_department_period ON gl_budget (company_id, account_id, COALESCE(department_id, '00000000-0000-0000-0000-000000000000'::uuid), period_id) WHERE deleted_at IS NULL;

-- gl_prior_year_balance: ยอดปีที่แล้วที่ป้อนเอง (คู่มือบทที่ 15 S-GL-16) — ใช้กับปีที่ไม่มีใบสำคัญในระบบ (เริ่มใช้กลางปี/ย้ายจากโปรแกรมอื่น) สำหรับงบเปรียบเทียบเท่านั้น ไม่ยกไปปีถัดไป  [Express: GLBAL (BEGLY + DEBITn/CREDITn ของปีที่แล้ว)]
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

-- gl_fs_report: แบบงบการเงินที่ผู้ใช้สร้าง  [Express: GLREP]
CREATE TABLE gl_fs_report (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  code varchar(10) NOT NULL,
  name varchar(120) NOT NULL,
  header_lines jsonb,
  columns jsonb,
  line_set_code varchar(10),
  number_format varchar(20),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE gl_fs_report IS 'แบบงบการเงินที่ผู้ใช้สร้าง | Express: GLREP';
COMMENT ON COLUMN gl_fs_report.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN gl_fs_report.company_id IS 'บริษัท';
COMMENT ON COLUMN gl_fs_report.code IS 'รหัสงบ [Express: GLREP.REPCOD]';
COMMENT ON COLUMN gl_fs_report.name IS 'ชื่องบ [Express: GLREP.REPNAM]';
COMMENT ON COLUMN gl_fs_report.header_lines IS 'หัวรายงาน 4 บรรทัด [Express: GLREP.HEAD_1–4]';
COMMENT ON COLUMN gl_fs_report.columns IS 'นิยามคอลัมน์ ≤18 (หัว สูตร BAL/PTD/BAL LY แผนก %) [Express: GLREP.Cn_HD1/2, FLDn, DEPn, PCENTn, PRINTn]';
COMMENT ON COLUMN gl_fs_report.line_set_code IS 'ชุดบรรทัด [Express: GLREP.LINCOD]';
COMMENT ON COLUMN gl_fs_report.number_format IS 'รูปแบบตัวเลข [Express: GLREP.PICT_1]';
COMMENT ON COLUMN gl_fs_report.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN gl_fs_report.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN gl_fs_report.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN gl_fs_report.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN gl_fs_report.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN gl_fs_report.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN gl_fs_report.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_gl_fs_report_company_code ON gl_fs_report (company_id, code) WHERE deleted_at IS NULL;

-- gl_fs_line: บรรทัดของงบการเงิน  [Express: GLREPIT]
CREATE TABLE gl_fs_line (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  line_set_code varchar(10) NOT NULL,
  line_no integer NOT NULL,
  data_type varchar(4) NOT NULL,
  source varchar(60),
  sign_filter char(1),
  description_th varchar(120),
  description_en varchar(120),
  print_condition char(1),
  accumulate jsonb,
  department_id uuid,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE gl_fs_line IS 'บรรทัดของงบการเงิน | Express: GLREPIT';
COMMENT ON COLUMN gl_fs_line.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN gl_fs_line.company_id IS 'บริษัท';
COMMENT ON COLUMN gl_fs_line.line_set_code IS 'ชุดบรรทัด [Express: GLREPIT.REPCOD]';
COMMENT ON COLUMN gl_fs_line.line_no IS 'เลขบรรทัด [Express: GLREPIT.LINNUM]';
COMMENT ON COLUMN gl_fs_line.data_type IS 'A/C=บัญชี VAR=ตัวแปร ---=เส้น TXT=ข้อความ [Express: GLREPIT.DATTYP]';
COMMENT ON COLUMN gl_fs_line.source IS 'ช่วงบัญชี/ตัวแปร [Express: GLREPIT.SRCDAT]';
COMMENT ON COLUMN gl_fs_line.sign_filter IS '+ เฉพาะยอดบวก − เฉพาะยอดลบ [Express: GLREPIT.FILTER]';
COMMENT ON COLUMN gl_fs_line.description_th IS 'คำอธิบาย [Express: GLREPIT.DESCRP]';
COMMENT ON COLUMN gl_fs_line.description_en IS 'คำอธิบายอังกฤษ [Express: GLREPIT.DESCRP2]';
COMMENT ON COLUMN gl_fs_line.print_condition IS 'Z=ไม่พิมพ์ถ้าศูนย์ N=ไม่พิมพ์ [Express: GLREPIT.PRNCON]';
COMMENT ON COLUMN gl_fs_line.accumulate IS 'สะสมเข้าตัวแปร A–E (+/−/0) [Express: GLREPIT.VAR_A–VAR_E]';
COMMENT ON COLUMN gl_fs_line.department_id IS 'แผนก [Express: GLREPIT.DEPCOD]';
COMMENT ON COLUMN gl_fs_line.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN gl_fs_line.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN gl_fs_line.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN gl_fs_line.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN gl_fs_line.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN gl_fs_line.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN gl_fs_line.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_gl_fs_line_company_line_set_code_line_no ON gl_fs_line (company_id, line_set_code, line_no) WHERE deleted_at IS NULL;

-- tax_vat_entry: ทะเบียนภาษีซื้อ/ภาษีขาย (รายงานภาษี ภ.พ.30)  [Express: ISVAT]
CREATE TABLE tax_vat_entry (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  vat_kind char(1) NOT NULL CHECK (vat_kind IN ('P','S')),
  header_id uuid,
  journal_id uuid,
  branch_id uuid,
  doc_no varchar(30) NOT NULL,
  doc_date date NOT NULL,
  tax_invoice_no varchar(30),
  tax_invoice_date date NOT NULL,
  vat_period_id uuid NOT NULL,
  is_late boolean DEFAULT false NOT NULL,
  department_id uuid,
  description varchar(200),
  party_name varchar(200),
  party_tax_id varchar(13),
  party_tax_branch_no varchar(5),
  base_amount numeric(18,2) DEFAULT 0 NOT NULL,
  vat_amount numeric(18,2) DEFAULT 0 NOT NULL,
  zero_rate_amount numeric(18,2) DEFAULT 0 NOT NULL,
  nonclaim_base numeric(18,2) DEFAULT 0 NOT NULL,
  nonclaim_vat numeric(18,2) DEFAULT 0 NOT NULL,
  is_manual boolean DEFAULT false NOT NULL,
  is_modified boolean DEFAULT false NOT NULL,
  doc_status char(1) DEFAULT 'N' NOT NULL CHECK (doc_status IN ('N','C')),
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
COMMENT ON TABLE tax_vat_entry IS 'ทะเบียนภาษีซื้อ/ภาษีขาย (รายงานภาษี ภ.พ.30) | Express: ISVAT';
COMMENT ON COLUMN tax_vat_entry.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN tax_vat_entry.company_id IS 'บริษัท';
COMMENT ON COLUMN tax_vat_entry.vat_kind IS 'P=ภาษีซื้อ S=ภาษีขาย [Express: ISVAT.VATREC]';
COMMENT ON COLUMN tax_vat_entry.header_id IS 'เอกสารต้นทาง [Express: ISVAT.DOCNUM]';
COMMENT ON COLUMN tax_vat_entry.journal_id IS 'ใบสำคัญต้นทาง (บันทึกผ่าน JV/เงินสดย่อย)';
COMMENT ON COLUMN tax_vat_entry.branch_id IS 'สาขาที่ยื่น';
COMMENT ON COLUMN tax_vat_entry.doc_no IS 'เลขที่เอกสารภายใน [Express: ISVAT.DOCNUM]';
COMMENT ON COLUMN tax_vat_entry.doc_date IS 'วันที่เอกสารภายใน [Express: ISVAT.DOCDAT]';
COMMENT ON COLUMN tax_vat_entry.tax_invoice_no IS 'เลขที่ใบกำกับภาษี [Express: ISVAT.REFNUM]';
COMMENT ON COLUMN tax_vat_entry.tax_invoice_date IS 'วันที่ใบกำกับภาษี [Express: ISVAT.VATDAT]';
COMMENT ON COLUMN tax_vat_entry.vat_period_id IS 'งวดภาษีที่ยื่น [Express: ISVAT.VATPRD]';
COMMENT ON COLUMN tax_vat_entry.is_late IS 'ยื่นเพิ่มเติม/ใบกำกับมาช้า [Express: ISVAT.LATE]';
COMMENT ON COLUMN tax_vat_entry.department_id IS 'แผนก [Express: ISVAT.DEPCOD]';
COMMENT ON COLUMN tax_vat_entry.description IS 'คำอธิบาย [Express: ISVAT.DESCRP]';
COMMENT ON COLUMN tax_vat_entry.party_name IS 'ชื่อผู้ขาย/ผู้ซื้อ';
COMMENT ON COLUMN tax_vat_entry.party_tax_id IS 'เลขผู้เสียภาษี';
COMMENT ON COLUMN tax_vat_entry.party_tax_branch_no IS 'สาขา';
COMMENT ON COLUMN tax_vat_entry.base_amount IS 'มูลค่าสินค้า/บริการ [Express: ISVAT.AMT01]';
COMMENT ON COLUMN tax_vat_entry.vat_amount IS 'ภาษี [Express: ISVAT.VAT01]';
COMMENT ON COLUMN tax_vat_entry.zero_rate_amount IS 'มูลค่าอัตรา 0% / ยกเว้น [Express: ISVAT.AMTRAT0]';
COMMENT ON COLUMN tax_vat_entry.nonclaim_base IS 'มูลค่าภาษีซื้อที่ขอคืนไม่ได้ [Express: ISVAT.AMT02]';
COMMENT ON COLUMN tax_vat_entry.nonclaim_vat IS 'ภาษีซื้อที่ขอคืนไม่ได้ [Express: ISVAT.VAT02]';
COMMENT ON COLUMN tax_vat_entry.is_manual IS 'บันทึกเองในระบบภาษี [Express: ISVAT.SELF_ADDED]';
COMMENT ON COLUMN tax_vat_entry.is_modified IS 'ถูกแก้ไขในระบบภาษี [Express: ISVAT.HAD_MODIFY]';
COMMENT ON COLUMN tax_vat_entry.doc_status IS 'N=ปกติ C=ยกเลิก [Express: ISVAT.DOCSTAT]';
COMMENT ON COLUMN tax_vat_entry.remark IS 'หมายเหตุ [Express: ISVAT.REMARK]';
COMMENT ON COLUMN tax_vat_entry.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN tax_vat_entry.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN tax_vat_entry.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN tax_vat_entry.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN tax_vat_entry.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN tax_vat_entry.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN tax_vat_entry.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE INDEX ix_tax_vat_entry_company_vat_kind_vat_period_tax_invoice_dat ON tax_vat_entry (company_id, vat_kind, vat_period_id, tax_invoice_date);

-- tax_wht_entry: ทะเบียนภาษีหัก ณ ที่จ่าย / หนังสือรับรอง 50 ทวิ  [Express: ISTAX]
CREATE TABLE tax_wht_entry (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  form_type varchar(4) NOT NULL,
  header_id uuid,
  branch_id uuid,
  certificate_no varchar(30),
  certificate_date date NOT NULL,
  tax_period_id uuid NOT NULL,
  is_late boolean DEFAULT false NOT NULL,
  supplier_id uuid,
  customer_id uuid,
  payee_name varchar(200) NOT NULL,
  payee_address text,
  payee_tax_id varchar(13),
  payee_tax_branch_no varchar(5),
  income_type varchar(60),
  paid_amount numeric(18,2) NOT NULL,
  rate numeric(9,4) NOT NULL,
  tax_amount numeric(18,2) NOT NULL,
  condition char(1),
  social_security_amount numeric(18,2),
  provident_fund_amount numeric(18,2),
  department_id uuid,
  print_count smallint DEFAULT 0 NOT NULL,
  doc_status char(1) DEFAULT 'N' NOT NULL CHECK (doc_status IN ('N','C')),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE tax_wht_entry IS 'ทะเบียนภาษีหัก ณ ที่จ่าย / หนังสือรับรอง 50 ทวิ | Express: ISTAX';
COMMENT ON COLUMN tax_wht_entry.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN tax_wht_entry.company_id IS 'บริษัท';
COMMENT ON COLUMN tax_wht_entry.form_type IS 'S03=ภ.ง.ด.3 S53=ภ.ง.ด.53 Z03/Z53=ถูกหัก [Express: ISTAX.TAXTYP]';
COMMENT ON COLUMN tax_wht_entry.header_id IS 'เอกสารต้นทาง (PS OE AE …) [Express: ISTAX.REFNUM]';
COMMENT ON COLUMN tax_wht_entry.branch_id IS 'สาขาที่ยื่น';
COMMENT ON COLUMN tax_wht_entry.certificate_no IS 'เลขที่หนังสือรับรอง [Express: ISTAX.TAXNUM]';
COMMENT ON COLUMN tax_wht_entry.certificate_date IS 'วันที่หัก/ออกหนังสือ [Express: ISTAX.TAXDAT]';
COMMENT ON COLUMN tax_wht_entry.tax_period_id IS 'เดือนภาษีที่ยื่น [Express: ISTAX.TAXPRD]';
COMMENT ON COLUMN tax_wht_entry.is_late IS 'ยื่นเพิ่มเติม [Express: ISTAX.LATE]';
COMMENT ON COLUMN tax_wht_entry.supplier_id IS 'ผู้ถูกหัก [Express: ISTAX.PEOPLE]';
COMMENT ON COLUMN tax_wht_entry.customer_id IS 'ผู้หัก (กรณีถูกหัก) [Express: ISTAX.PEOPLE]';
COMMENT ON COLUMN tax_wht_entry.payee_name IS 'ชื่อ (snapshot) [Express: ISTAX.NAME]';
COMMENT ON COLUMN tax_wht_entry.payee_address IS 'ที่อยู่ (snapshot) [Express: ISTAX.ADDR]';
COMMENT ON COLUMN tax_wht_entry.payee_tax_id IS 'เลขผู้เสียภาษี [Express: ISTAX.TAXID]';
COMMENT ON COLUMN tax_wht_entry.payee_tax_branch_no IS 'สาขา';
COMMENT ON COLUMN tax_wht_entry.income_type IS 'ประเภทเงินได้ [Express: ISTAX.TAXDES]';
COMMENT ON COLUMN tax_wht_entry.paid_amount IS 'จำนวนเงินที่จ่าย [Express: ISTAX.AMOUNT]';
COMMENT ON COLUMN tax_wht_entry.rate IS 'อัตรา % [Express: ISTAX.TAXRAT]';
COMMENT ON COLUMN tax_wht_entry.tax_amount IS 'ภาษีที่หัก [Express: ISTAX.TAXAMT]';
COMMENT ON COLUMN tax_wht_entry.condition IS '1=หัก ณ ที่จ่าย 2=ออกให้ตลอดไป 3=ออกให้ครั้งเดียว [Express: ISTAX.TAXCOND]';
COMMENT ON COLUMN tax_wht_entry.social_security_amount IS 'เงินสมทบประกันสังคม [Express: ISTAX.SOCIALAMT]';
COMMENT ON COLUMN tax_wht_entry.provident_fund_amount IS 'เงินสะสมกองทุนสำรองเลี้ยงชีพ [Express: ISTAX.POVDNT]';
COMMENT ON COLUMN tax_wht_entry.department_id IS 'แผนก [Express: ISTAX.DEPCOD]';
COMMENT ON COLUMN tax_wht_entry.print_count IS 'จำนวนครั้งที่พิมพ์ [Express: ISTAX.PRNCNT]';
COMMENT ON COLUMN tax_wht_entry.doc_status IS 'N=ปกติ C=ยกเลิก';
COMMENT ON COLUMN tax_wht_entry.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN tax_wht_entry.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN tax_wht_entry.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN tax_wht_entry.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN tax_wht_entry.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN tax_wht_entry.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN tax_wht_entry.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE INDEX ix_tax_wht_entry_company_form_type_tax_period ON tax_wht_entry (company_id, form_type, tax_period_id);

-- md_asset_account_group: กลุ่มบัญชีทรัพย์สิน  [Express: ISACC (ACCTYP='F')]
CREATE TABLE md_asset_account_group (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  code varchar(10) NOT NULL,
  name_th varchar(120) NOT NULL,
  name_en varchar(120),
  asset_account_id uuid,
  depr_expense_account_id uuid,
  accum_depr_account_id uuid,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE md_asset_account_group IS 'กลุ่มบัญชีทรัพย์สิน | Express: ISACC (ACCTYP=''F'')';
COMMENT ON COLUMN md_asset_account_group.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN md_asset_account_group.company_id IS 'บริษัท';
COMMENT ON COLUMN md_asset_account_group.code IS 'รหัสกลุ่ม [Express: ISACC.ACCCOD]';
COMMENT ON COLUMN md_asset_account_group.name_th IS 'ชื่อกลุ่ม [Express: ISACC.ACCDES]';
COMMENT ON COLUMN md_asset_account_group.name_en IS 'ชื่อภาษาอังกฤษ [Express: ISACC.ACCDES2]';
COMMENT ON COLUMN md_asset_account_group.asset_account_id IS 'บัญชีทรัพย์สิน [Express: ISACC.ACCNUM01]';
COMMENT ON COLUMN md_asset_account_group.depr_expense_account_id IS 'บัญชีค่าเสื่อมราคา [Express: ISACC.ACCNUM02]';
COMMENT ON COLUMN md_asset_account_group.accum_depr_account_id IS 'บัญชีค่าเสื่อมราคาสะสม [Express: ISACC.ACCNUM03]';
COMMENT ON COLUMN md_asset_account_group.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN md_asset_account_group.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN md_asset_account_group.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN md_asset_account_group.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN md_asset_account_group.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN md_asset_account_group.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN md_asset_account_group.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_md_asset_account_group_company_code ON md_asset_account_group (company_id, code) WHERE deleted_at IS NULL;

-- fa_asset: ทะเบียนทรัพย์สินถาวร  [Express: FAMAS]
CREATE TABLE fa_asset (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  code varchar(30) NOT NULL,
  name_th varchar(120) NOT NULL,
  name_en varchar(120),
  category_code varchar(10),
  account_group_id uuid NOT NULL,
  is_depreciable boolean DEFAULT true NOT NULL,
  serial_no varchar(40),
  department_id uuid,
  branch_id uuid,
  purchase_date date NOT NULL,
  cost numeric(18,2) NOT NULL,
  salvage_value numeric(18,2) DEFAULT 1 NOT NULL,
  method char(1) DEFAULT '1' NOT NULL CHECK (method IN ('0','1','2')),
  start_date date NOT NULL,
  useful_life_years smallint,
  rate numeric(9,4),
  end_date date,
  depr_monthly boolean DEFAULT true NOT NULL,
  accum_depr_bf numeric(18,2) DEFAULT 0 NOT NULL,
  sold_date date,
  sold_amount numeric(18,2),
  sold_header_id uuid,
  status char(1) DEFAULT 'A' NOT NULL CHECK (status IN ('A','S','I')),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE fa_asset IS 'ทะเบียนทรัพย์สินถาวร | Express: FAMAS';
COMMENT ON COLUMN fa_asset.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN fa_asset.company_id IS 'บริษัท';
COMMENT ON COLUMN fa_asset.code IS 'รหัสทรัพย์สิน [Express: FAMAS.FASCOD]';
COMMENT ON COLUMN fa_asset.name_th IS 'ชื่อทรัพย์สิน [Express: FAMAS.FASDES]';
COMMENT ON COLUMN fa_asset.name_en IS 'ชื่อภาษาอังกฤษ [Express: FAMAS.FASDES2]';
COMMENT ON COLUMN fa_asset.category_code IS 'หมวดทรัพย์สิน lookup 52 [Express: FAMAS.FASGRP]';
COMMENT ON COLUMN fa_asset.account_group_id IS 'กลุ่มบัญชีทรัพย์สิน [Express: FAMAS.ACCCOD]';
COMMENT ON COLUMN fa_asset.is_depreciable IS 'คิดค่าเสื่อม [Express: FAMAS.FASTYP]';
COMMENT ON COLUMN fa_asset.serial_no IS 'หมายเลขเครื่อง/ทะเบียน [Express: FAMAS.SERIAL]';
COMMENT ON COLUMN fa_asset.department_id IS 'แผนก [Express: FAMAS.DEPCOD]';
COMMENT ON COLUMN fa_asset.branch_id IS 'สาขาที่ตั้งทรัพย์สิน';
COMMENT ON COLUMN fa_asset.purchase_date IS 'วันที่ซื้อ [Express: FAMAS.PURDAT]';
COMMENT ON COLUMN fa_asset.cost IS 'ราคาทุน [Express: FAMAS.COSVAL]';
COMMENT ON COLUMN fa_asset.salvage_value IS 'ราคาซาก [Express: FAMAS.SALVAG]';
COMMENT ON COLUMN fa_asset.method IS '0=ไม่คิด 1=เส้นตรง 2=ยอดลดลง [Express: FAMAS.METHOD]';
COMMENT ON COLUMN fa_asset.start_date IS 'วันเริ่มคิดค่าเสื่อม [Express: FAMAS.STRDAT]';
COMMENT ON COLUMN fa_asset.useful_life_years IS 'อายุการใช้งาน (ปี) [Express: FAMAS.LIFE]';
COMMENT ON COLUMN fa_asset.rate IS 'อัตราค่าเสื่อม % [Express: FAMAS.RATE]';
COMMENT ON COLUMN fa_asset.end_date IS 'วันที่คิดค่าเสื่อมครบ [Express: FAMAS.ENDDAT]';
COMMENT ON COLUMN fa_asset.depr_monthly IS 'คิดรายเดือน (N=รายปี) [Express: FAMAS.DPRMONLY]';
COMMENT ON COLUMN fa_asset.accum_depr_bf IS 'ค่าเสื่อมสะสมยกมา [Express: FAMAS.ACCMBF]';
COMMENT ON COLUMN fa_asset.sold_date IS 'วันที่ขาย/ตัดจำหน่าย [Express: FAMAS.SALDAT]';
COMMENT ON COLUMN fa_asset.sold_amount IS 'ราคาขาย [Express: FAMAS.SALAMT]';
COMMENT ON COLUMN fa_asset.sold_header_id IS 'เอกสารขายทรัพย์สิน';
COMMENT ON COLUMN fa_asset.status IS 'A=ใช้งาน S=ขาย/ตัดจำหน่าย I=เลิกใช้ [Express: FAMAS.STATUS]';
COMMENT ON COLUMN fa_asset.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN fa_asset.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN fa_asset.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN fa_asset.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN fa_asset.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN fa_asset.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN fa_asset.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_fa_asset_company_code ON fa_asset (company_id, code) WHERE deleted_at IS NULL;

-- fa_depreciation: ค่าเสื่อมราคารายงวดของทรัพย์สิน  [Express: FAMAS.DEPR1–DEPR12NY]
CREATE TABLE fa_depreciation (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  period_id uuid NOT NULL,
  amount numeric(18,2) NOT NULL,
  journal_id uuid,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE fa_depreciation IS 'ค่าเสื่อมราคารายงวดของทรัพย์สิน | Express: FAMAS.DEPR1–DEPR12NY';
COMMENT ON COLUMN fa_depreciation.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN fa_depreciation.company_id IS 'บริษัท';
COMMENT ON COLUMN fa_depreciation.asset_id IS 'ทรัพย์สิน';
COMMENT ON COLUMN fa_depreciation.period_id IS 'งวด';
COMMENT ON COLUMN fa_depreciation.amount IS 'ค่าเสื่อมราคางวดนี้ [Express: FAMAS.DEPRn]';
COMMENT ON COLUMN fa_depreciation.journal_id IS 'ใบสำคัญที่ลงค่าเสื่อม';
COMMENT ON COLUMN fa_depreciation.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN fa_depreciation.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN fa_depreciation.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN fa_depreciation.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN fa_depreciation.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN fa_depreciation.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN fa_depreciation.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_fa_depreciation_asset_period ON fa_depreciation (asset_id, period_id) WHERE deleted_at IS NULL;

-- sync_change_log: บันทึกการเปลี่ยนแปลงบนเซิร์ฟเวอร์ (ใช้ให้เครื่องลูกดึงเฉพาะส่วนที่เปลี่ยน)  [Express: (ใหม่)]
CREATE TABLE sync_change_log (
  seq bigserial NOT NULL,
  company_id uuid NOT NULL,
  branch_id uuid,
  table_name varchar(40) NOT NULL,
  row_id uuid NOT NULL,
  op char(1) NOT NULL CHECK (op IN ('U','D')),
  row_version bigint NOT NULL,
  changed_at timestamptz DEFAULT now() NOT NULL,
  origin_device_id uuid,
  PRIMARY KEY (seq)
);
COMMENT ON TABLE sync_change_log IS 'บันทึกการเปลี่ยนแปลงบนเซิร์ฟเวอร์ (ใช้ให้เครื่องลูกดึงเฉพาะส่วนที่เปลี่ยน) | Express: (ใหม่)';
COMMENT ON COLUMN sync_change_log.seq IS 'ลำดับเพิ่มขึ้นเรื่อยๆ (PK) — เครื่องลูกจำค่าล่าสุดที่ดึงแล้ว';
COMMENT ON COLUMN sync_change_log.company_id IS 'บริษัท';
COMMENT ON COLUMN sync_change_log.branch_id IS 'สาขา (ใช้กรองว่าเครื่องไหนต้องได้รับ)';
COMMENT ON COLUMN sync_change_log.table_name IS 'ตาราง';
COMMENT ON COLUMN sync_change_log.row_id IS 'แถว';
COMMENT ON COLUMN sync_change_log.op IS 'U=insert/update D=delete(soft)';
COMMENT ON COLUMN sync_change_log.row_version IS 'เวอร์ชันของแถว';
COMMENT ON COLUMN sync_change_log.changed_at IS 'เวลา';
COMMENT ON COLUMN sync_change_log.origin_device_id IS 'เครื่องที่ส่งการเปลี่ยนแปลงมา (ไม่ต้องส่งกลับเครื่องเดิม)';
CREATE INDEX ix_sync_change_log_company_seq ON sync_change_log (company_id, seq);
CREATE INDEX ix_sync_change_log_table_name_row ON sync_change_log (table_name, row_id);

-- sync_inbox: รายการที่เครื่องลูกส่งขึ้นมา (กันประมวลผลซ้ำด้วย idempotency key)  [Express: (ใหม่)]
CREATE TABLE sync_inbox (
  idempotency_key uuid NOT NULL,
  company_id uuid NOT NULL,
  device_id uuid NOT NULL,
  received_at timestamptz DEFAULT now() NOT NULL,
  table_name varchar(40) NOT NULL,
  row_id uuid NOT NULL,
  result varchar(10) NOT NULL,
  message text,
  PRIMARY KEY (idempotency_key)
);
COMMENT ON TABLE sync_inbox IS 'รายการที่เครื่องลูกส่งขึ้นมา (กันประมวลผลซ้ำด้วย idempotency key) | Express: (ใหม่)';
COMMENT ON COLUMN sync_inbox.idempotency_key IS '= sync_outbox.id ของเครื่องลูก (PK)';
COMMENT ON COLUMN sync_inbox.company_id IS 'บริษัท';
COMMENT ON COLUMN sync_inbox.device_id IS 'เครื่อง';
COMMENT ON COLUMN sync_inbox.received_at IS 'เวลาที่รับ';
COMMENT ON COLUMN sync_inbox.table_name IS 'ตาราง';
COMMENT ON COLUMN sync_inbox.row_id IS 'แถว';
COMMENT ON COLUMN sync_inbox.result IS 'APPLIED REJECTED CONFLICT';
COMMENT ON COLUMN sync_inbox.message IS 'เหตุผลถ้าไม่สำเร็จ';

-- sync_conflict: ความขัดแย้งที่ต้องให้คนตัดสิน  [Express: (ใหม่)]
CREATE TABLE sync_conflict (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  table_name varchar(40) NOT NULL,
  row_id uuid NOT NULL,
  device_id uuid,
  server_version bigint,
  client_version bigint,
  client_payload jsonb NOT NULL,
  reason varchar(30) NOT NULL,
  resolution varchar(20),
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE sync_conflict IS 'ความขัดแย้งที่ต้องให้คนตัดสิน | Express: (ใหม่)';
COMMENT ON COLUMN sync_conflict.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN sync_conflict.company_id IS 'บริษัท';
COMMENT ON COLUMN sync_conflict.table_name IS 'ตาราง';
COMMENT ON COLUMN sync_conflict.row_id IS 'แถว';
COMMENT ON COLUMN sync_conflict.device_id IS 'เครื่องที่ส่งค่าที่ขัดแย้ง';
COMMENT ON COLUMN sync_conflict.server_version IS 'เวอร์ชันบนเซิร์ฟเวอร์';
COMMENT ON COLUMN sync_conflict.client_version IS 'เวอร์ชันที่เครื่องลูกแก้มาจาก';
COMMENT ON COLUMN sync_conflict.client_payload IS 'ค่าที่เครื่องลูกส่งมา';
COMMENT ON COLUMN sync_conflict.reason IS 'VERSION_MISMATCH PERIOD_LOCKED NEGATIVE_STOCK CREDIT_LIMIT DUPLICATE_NO PERMISSION';
COMMENT ON COLUMN sync_conflict.resolution IS 'KEEP_SERVER KEEP_CLIENT MERGED';
COMMENT ON COLUMN sync_conflict.resolved_by IS 'ผู้ตัดสิน';
COMMENT ON COLUMN sync_conflict.resolved_at IS 'เวลาที่ตัดสิน';
COMMENT ON COLUMN sync_conflict.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN sync_conflict.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN sync_conflict.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN sync_conflict.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN sync_conflict.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN sync_conflict.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN sync_conflict.origin_device_id IS 'เครื่องที่สร้างแถวนี้';

-- sync_outbox: (เครื่องลูก) คิวรายการที่บันทึกตอนออฟไลน์ รอส่งขึ้นเซิร์ฟเวอร์ตามลำดับ  [Express: (ใหม่)]
CREATE TABLE sync_outbox (
  id uuid NOT NULL,
  seq bigint NOT NULL,
  table_name varchar(40) NOT NULL,
  row_id uuid NOT NULL,
  op char(1) NOT NULL,
  base_version bigint,
  payload jsonb NOT NULL,
  tx_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  status varchar(10) DEFAULT 'PENDING' NOT NULL,
  last_error text,
  PRIMARY KEY (id)
);
COMMENT ON TABLE sync_outbox IS '(เครื่องลูก) คิวรายการที่บันทึกตอนออฟไลน์ รอส่งขึ้นเซิร์ฟเวอร์ตามลำดับ | Express: (ใหม่)';
COMMENT ON COLUMN sync_outbox.id IS 'idempotency key (PK)';
COMMENT ON COLUMN sync_outbox.seq IS 'ลำดับในเครื่อง (ส่งตามลำดับนี้)';
COMMENT ON COLUMN sync_outbox.table_name IS 'ตาราง';
COMMENT ON COLUMN sync_outbox.row_id IS 'แถว';
COMMENT ON COLUMN sync_outbox.op IS 'U/D';
COMMENT ON COLUMN sync_outbox.base_version IS 'เวอร์ชันที่แก้มาจาก (ตรวจ conflict)';
COMMENT ON COLUMN sync_outbox.payload IS 'ข้อมูลทั้งแถว';
COMMENT ON COLUMN sync_outbox.tx_id IS 'กลุ่มรายการที่ต้องส่งพร้อมกัน (หัว+บรรทัดของเอกสารเดียว)';
COMMENT ON COLUMN sync_outbox.created_at IS 'เวลาที่บันทึก';
COMMENT ON COLUMN sync_outbox.attempts IS 'จำนวนครั้งที่พยายามส่ง';
COMMENT ON COLUMN sync_outbox.status IS 'PENDING SENT APPLIED REJECTED CONFLICT';
COMMENT ON COLUMN sync_outbox.last_error IS 'ข้อผิดพลาดล่าสุด';

-- sync_state: (เครื่องลูก) สถานะการซิงก์ของเครื่องนี้  [Express: (ใหม่)]
CREATE TABLE sync_state (
  key varchar(40) NOT NULL,
  value text,
  PRIMARY KEY (key)
);
COMMENT ON TABLE sync_state IS '(เครื่องลูก) สถานะการซิงก์ของเครื่องนี้ | Express: (ใหม่)';
COMMENT ON COLUMN sync_state.key IS 'ชื่อค่า เช่น last_pull_seq device_id company_id (PK)';
COMMENT ON COLUMN sync_state.value IS 'ค่า';

-- ---------------------------------------------------------------- Foreign keys
-- DEFERRABLE INITIALLY DEFERRED: ให้รับข้อมูลซิงก์หลายตารางในทรานแซกชันเดียวโดยไม่ต้องเรียงลำดับ
ALTER TABLE sys_tenant ADD CONSTRAINT fk_sys_tenant_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_tenant_created_by ON sys_tenant (created_by);
ALTER TABLE sys_tenant ADD CONSTRAINT fk_sys_tenant_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_tenant_updated_by ON sys_tenant (updated_by);
ALTER TABLE sys_company ADD CONSTRAINT fk_sys_company_tenant_id FOREIGN KEY (tenant_id) REFERENCES sys_tenant(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_company_tenant_id ON sys_company (tenant_id);
ALTER TABLE sys_company ADD CONSTRAINT fk_sys_company_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_company_created_by ON sys_company (created_by);
ALTER TABLE sys_company ADD CONSTRAINT fk_sys_company_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_company_updated_by ON sys_company (updated_by);
ALTER TABLE sys_branch ADD CONSTRAINT fk_sys_branch_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_branch_company_id ON sys_branch (company_id);
ALTER TABLE sys_branch ADD CONSTRAINT fk_sys_branch_default_warehouse_id FOREIGN KEY (default_warehouse_id) REFERENCES md_warehouse(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_branch_default_warehouse_id ON sys_branch (default_warehouse_id);
ALTER TABLE sys_branch ADD CONSTRAINT fk_sys_branch_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_branch_created_by ON sys_branch (created_by);
ALTER TABLE sys_branch ADD CONSTRAINT fk_sys_branch_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_branch_updated_by ON sys_branch (updated_by);
ALTER TABLE sys_user ADD CONSTRAINT fk_sys_user_tenant_id FOREIGN KEY (tenant_id) REFERENCES sys_tenant(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_user_tenant_id ON sys_user (tenant_id);
ALTER TABLE sys_user ADD CONSTRAINT fk_sys_user_user_group_id FOREIGN KEY (user_group_id) REFERENCES sys_user_group(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_user_user_group_id ON sys_user (user_group_id);
ALTER TABLE sys_user ADD CONSTRAINT fk_sys_user_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_user_created_by ON sys_user (created_by);
ALTER TABLE sys_user ADD CONSTRAINT fk_sys_user_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_user_updated_by ON sys_user (updated_by);
ALTER TABLE sys_session ADD CONSTRAINT fk_sys_session_user_id FOREIGN KEY (user_id) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_session_user_id ON sys_session (user_id);
ALTER TABLE sys_session ADD CONSTRAINT fk_sys_session_current_company_id FOREIGN KEY (current_company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_session_current_company_id ON sys_session (current_company_id);
ALTER TABLE sys_session ADD CONSTRAINT fk_sys_session_current_branch_id FOREIGN KEY (current_branch_id) REFERENCES sys_branch(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_session_current_branch_id ON sys_session (current_branch_id);
ALTER TABLE sys_session ADD CONSTRAINT fk_sys_session_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_session_created_by ON sys_session (created_by);
ALTER TABLE sys_session ADD CONSTRAINT fk_sys_session_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_session_updated_by ON sys_session (updated_by);
ALTER TABLE sys_user_group ADD CONSTRAINT fk_sys_user_group_tenant_id FOREIGN KEY (tenant_id) REFERENCES sys_tenant(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_user_group_tenant_id ON sys_user_group (tenant_id);
ALTER TABLE sys_user_group ADD CONSTRAINT fk_sys_user_group_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_user_group_created_by ON sys_user_group (created_by);
ALTER TABLE sys_user_group ADD CONSTRAINT fk_sys_user_group_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_user_group_updated_by ON sys_user_group (updated_by);
ALTER TABLE sys_user_company ADD CONSTRAINT fk_sys_user_company_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_user_company_company_id ON sys_user_company (company_id);
ALTER TABLE sys_user_company ADD CONSTRAINT fk_sys_user_company_user_id FOREIGN KEY (user_id) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_user_company_user_id ON sys_user_company (user_id);
ALTER TABLE sys_user_company ADD CONSTRAINT fk_sys_user_company_branch_id FOREIGN KEY (branch_id) REFERENCES sys_branch(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_user_company_branch_id ON sys_user_company (branch_id);
ALTER TABLE sys_user_company ADD CONSTRAINT fk_sys_user_company_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_user_company_created_by ON sys_user_company (created_by);
ALTER TABLE sys_user_company ADD CONSTRAINT fk_sys_user_company_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_user_company_updated_by ON sys_user_company (updated_by);
ALTER TABLE sys_menu ADD CONSTRAINT fk_sys_menu_parent_id FOREIGN KEY (parent_id) REFERENCES sys_menu(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_menu_parent_id ON sys_menu (parent_id);
ALTER TABLE sys_menu ADD CONSTRAINT fk_sys_menu_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_menu_created_by ON sys_menu (created_by);
ALTER TABLE sys_menu ADD CONSTRAINT fk_sys_menu_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_menu_updated_by ON sys_menu (updated_by);
ALTER TABLE sys_permission ADD CONSTRAINT fk_sys_permission_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_permission_company_id ON sys_permission (company_id);
ALTER TABLE sys_permission ADD CONSTRAINT fk_sys_permission_menu_id FOREIGN KEY (menu_id) REFERENCES sys_menu(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_permission_menu_id ON sys_permission (menu_id);
ALTER TABLE sys_permission ADD CONSTRAINT fk_sys_permission_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_permission_created_by ON sys_permission (created_by);
ALTER TABLE sys_permission ADD CONSTRAINT fk_sys_permission_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_permission_updated_by ON sys_permission (updated_by);
ALTER TABLE sys_device ADD CONSTRAINT fk_sys_device_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_device_company_id ON sys_device (company_id);
ALTER TABLE sys_device ADD CONSTRAINT fk_sys_device_branch_id FOREIGN KEY (branch_id) REFERENCES sys_branch(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_device_branch_id ON sys_device (branch_id);
ALTER TABLE sys_device ADD CONSTRAINT fk_sys_device_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_device_created_by ON sys_device (created_by);
ALTER TABLE sys_device ADD CONSTRAINT fk_sys_device_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_device_updated_by ON sys_device (updated_by);
ALTER TABLE sys_setting ADD CONSTRAINT fk_sys_setting_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_setting_company_id ON sys_setting (company_id);
ALTER TABLE sys_setting ADD CONSTRAINT fk_sys_setting_branch_id FOREIGN KEY (branch_id) REFERENCES sys_branch(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_setting_branch_id ON sys_setting (branch_id);
ALTER TABLE sys_setting ADD CONSTRAINT fk_sys_setting_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_setting_created_by ON sys_setting (created_by);
ALTER TABLE sys_setting ADD CONSTRAINT fk_sys_setting_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_setting_updated_by ON sys_setting (updated_by);
ALTER TABLE sys_setting_def ADD CONSTRAINT fk_sys_setting_def_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_setting_def_created_by ON sys_setting_def (created_by);
ALTER TABLE sys_setting_def ADD CONSTRAINT fk_sys_setting_def_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_setting_def_updated_by ON sys_setting_def (updated_by);
ALTER TABLE sys_activity_log ADD CONSTRAINT fk_sys_activity_log_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_activity_log_company_id ON sys_activity_log (company_id);
ALTER TABLE sys_activity_log ADD CONSTRAINT fk_sys_activity_log_user_id FOREIGN KEY (user_id) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_activity_log_user_id ON sys_activity_log (user_id);
ALTER TABLE sys_activity_log ADD CONSTRAINT fk_sys_activity_log_auth_user_id FOREIGN KEY (auth_user_id) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_activity_log_auth_user_id ON sys_activity_log (auth_user_id);
ALTER TABLE sys_activity_log ADD CONSTRAINT fk_sys_activity_log_device_id FOREIGN KEY (device_id) REFERENCES sys_device(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sys_activity_log_device_id ON sys_activity_log (device_id);
ALTER TABLE gl_fiscal_year ADD CONSTRAINT fk_gl_fiscal_year_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_fiscal_year_company_id ON gl_fiscal_year (company_id);
ALTER TABLE gl_fiscal_year ADD CONSTRAINT fk_gl_fiscal_year_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_fiscal_year_created_by ON gl_fiscal_year (created_by);
ALTER TABLE gl_fiscal_year ADD CONSTRAINT fk_gl_fiscal_year_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_fiscal_year_updated_by ON gl_fiscal_year (updated_by);
ALTER TABLE gl_period ADD CONSTRAINT fk_gl_period_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_period_company_id ON gl_period (company_id);
ALTER TABLE gl_period ADD CONSTRAINT fk_gl_period_fiscal_year_id FOREIGN KEY (fiscal_year_id) REFERENCES gl_fiscal_year(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_period_fiscal_year_id ON gl_period (fiscal_year_id);
ALTER TABLE gl_period ADD CONSTRAINT fk_gl_period_locked_by FOREIGN KEY (locked_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_period_locked_by ON gl_period (locked_by);
ALTER TABLE gl_period ADD CONSTRAINT fk_gl_period_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_period_created_by ON gl_period (created_by);
ALTER TABLE gl_period ADD CONSTRAINT fk_gl_period_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_period_updated_by ON gl_period (updated_by);
ALTER TABLE gl_account ADD CONSTRAINT fk_gl_account_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_account_company_id ON gl_account (company_id);
ALTER TABLE gl_account ADD CONSTRAINT fk_gl_account_parent_id FOREIGN KEY (parent_id) REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_account_parent_id ON gl_account (parent_id);
ALTER TABLE gl_account ADD CONSTRAINT fk_gl_account_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_account_created_by ON gl_account (created_by);
ALTER TABLE gl_account ADD CONSTRAINT fk_gl_account_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_account_updated_by ON gl_account (updated_by);
ALTER TABLE gl_journal_book ADD CONSTRAINT fk_gl_journal_book_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_journal_book_company_id ON gl_journal_book (company_id);
ALTER TABLE gl_journal_book ADD CONSTRAINT fk_gl_journal_book_template_id FOREIGN KEY (template_id) REFERENCES gl_template(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_journal_book_template_id ON gl_journal_book (template_id);
ALTER TABLE gl_journal_book ADD CONSTRAINT fk_gl_journal_book_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_journal_book_created_by ON gl_journal_book (created_by);
ALTER TABLE gl_journal_book ADD CONSTRAINT fk_gl_journal_book_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_journal_book_updated_by ON gl_journal_book (updated_by);
ALTER TABLE gl_default_account ADD CONSTRAINT fk_gl_default_account_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_default_account_company_id ON gl_default_account (company_id);
ALTER TABLE gl_default_account ADD CONSTRAINT fk_gl_default_account_account_id FOREIGN KEY (account_id) REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_default_account_account_id ON gl_default_account (account_id);
ALTER TABLE gl_default_account ADD CONSTRAINT fk_gl_default_account_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_default_account_created_by ON gl_default_account (created_by);
ALTER TABLE gl_default_account ADD CONSTRAINT fk_gl_default_account_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_default_account_updated_by ON gl_default_account (updated_by);
ALTER TABLE gl_journal_route ADD CONSTRAINT fk_gl_journal_route_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_journal_route_company_id ON gl_journal_route (company_id);
ALTER TABLE gl_journal_route ADD CONSTRAINT fk_gl_journal_route_journal_book_id FOREIGN KEY (journal_book_id) REFERENCES gl_journal_book(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_journal_route_journal_book_id ON gl_journal_route (journal_book_id);
ALTER TABLE gl_journal_route ADD CONSTRAINT fk_gl_journal_route_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_journal_route_created_by ON gl_journal_route (created_by);
ALTER TABLE gl_journal_route ADD CONSTRAINT fk_gl_journal_route_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_journal_route_updated_by ON gl_journal_route (updated_by);
ALTER TABLE gl_posting_rule ADD CONSTRAINT fk_gl_posting_rule_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_posting_rule_company_id ON gl_posting_rule (company_id);
ALTER TABLE gl_posting_rule ADD CONSTRAINT fk_gl_posting_rule_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_posting_rule_created_by ON gl_posting_rule (created_by);
ALTER TABLE gl_posting_rule ADD CONSTRAINT fk_gl_posting_rule_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_posting_rule_updated_by ON gl_posting_rule (updated_by);
ALTER TABLE gl_template ADD CONSTRAINT fk_gl_template_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_template_company_id ON gl_template (company_id);
ALTER TABLE gl_template ADD CONSTRAINT fk_gl_template_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_template_created_by ON gl_template (created_by);
ALTER TABLE gl_template ADD CONSTRAINT fk_gl_template_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_template_updated_by ON gl_template (updated_by);
ALTER TABLE gl_template_line ADD CONSTRAINT fk_gl_template_line_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_template_line_company_id ON gl_template_line (company_id);
ALTER TABLE gl_template_line ADD CONSTRAINT fk_gl_template_line_template_id FOREIGN KEY (template_id) REFERENCES gl_template(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_template_line_template_id ON gl_template_line (template_id);
ALTER TABLE gl_template_line ADD CONSTRAINT fk_gl_template_line_account_id FOREIGN KEY (account_id) REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_template_line_account_id ON gl_template_line (account_id);
ALTER TABLE gl_template_line ADD CONSTRAINT fk_gl_template_line_department_id FOREIGN KEY (department_id) REFERENCES md_department(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_template_line_department_id ON gl_template_line (department_id);
ALTER TABLE gl_template_line ADD CONSTRAINT fk_gl_template_line_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_template_line_created_by ON gl_template_line (created_by);
ALTER TABLE gl_template_line ADD CONSTRAINT fk_gl_template_line_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_template_line_updated_by ON gl_template_line (updated_by);
ALTER TABLE md_lookup_type ADD CONSTRAINT fk_md_lookup_type_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_lookup_type_created_by ON md_lookup_type (created_by);
ALTER TABLE md_lookup_type ADD CONSTRAINT fk_md_lookup_type_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_lookup_type_updated_by ON md_lookup_type (updated_by);
ALTER TABLE md_lookup ADD CONSTRAINT fk_md_lookup_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_lookup_company_id ON md_lookup (company_id);
ALTER TABLE md_lookup ADD CONSTRAINT fk_md_lookup_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_lookup_created_by ON md_lookup (created_by);
ALTER TABLE md_lookup ADD CONSTRAINT fk_md_lookup_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_lookup_updated_by ON md_lookup (updated_by);
ALTER TABLE md_unit ADD CONSTRAINT fk_md_unit_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_unit_company_id ON md_unit (company_id);
ALTER TABLE md_unit ADD CONSTRAINT fk_md_unit_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_unit_created_by ON md_unit (created_by);
ALTER TABLE md_unit ADD CONSTRAINT fk_md_unit_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_unit_updated_by ON md_unit (updated_by);
ALTER TABLE md_warehouse ADD CONSTRAINT fk_md_warehouse_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_warehouse_company_id ON md_warehouse (company_id);
ALTER TABLE md_warehouse ADD CONSTRAINT fk_md_warehouse_branch_id FOREIGN KEY (branch_id) REFERENCES sys_branch(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_warehouse_branch_id ON md_warehouse (branch_id);
ALTER TABLE md_warehouse ADD CONSTRAINT fk_md_warehouse_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_warehouse_created_by ON md_warehouse (created_by);
ALTER TABLE md_warehouse ADD CONSTRAINT fk_md_warehouse_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_warehouse_updated_by ON md_warehouse (updated_by);
ALTER TABLE md_department ADD CONSTRAINT fk_md_department_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_department_company_id ON md_department (company_id);
ALTER TABLE md_department ADD CONSTRAINT fk_md_department_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_department_created_by ON md_department (created_by);
ALTER TABLE md_department ADD CONSTRAINT fk_md_department_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_department_updated_by ON md_department (updated_by);
ALTER TABLE md_bank ADD CONSTRAINT fk_md_bank_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_bank_company_id ON md_bank (company_id);
ALTER TABLE md_bank ADD CONSTRAINT fk_md_bank_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_bank_created_by ON md_bank (created_by);
ALTER TABLE md_bank ADD CONSTRAINT fk_md_bank_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_bank_updated_by ON md_bank (updated_by);
ALTER TABLE md_project ADD CONSTRAINT fk_md_project_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_project_company_id ON md_project (company_id);
ALTER TABLE md_project ADD CONSTRAINT fk_md_project_customer_id FOREIGN KEY (customer_id) REFERENCES md_customer(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_project_customer_id ON md_project (customer_id);
ALTER TABLE md_project ADD CONSTRAINT fk_md_project_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_project_created_by ON md_project (created_by);
ALTER TABLE md_project ADD CONSTRAINT fk_md_project_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_project_updated_by ON md_project (updated_by);
ALTER TABLE md_project_budget ADD CONSTRAINT fk_md_project_budget_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_project_budget_company_id ON md_project_budget (company_id);
ALTER TABLE md_project_budget ADD CONSTRAINT fk_md_project_budget_project_id FOREIGN KEY (project_id) REFERENCES md_project(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_project_budget_project_id ON md_project_budget (project_id);
ALTER TABLE md_project_budget ADD CONSTRAINT fk_md_project_budget_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_project_budget_created_by ON md_project_budget (created_by);
ALTER TABLE md_project_budget ADD CONSTRAINT fk_md_project_budget_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_project_budget_updated_by ON md_project_budget (updated_by);
ALTER TABLE md_item_account_group ADD CONSTRAINT fk_md_item_account_group_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_item_account_group_company_id ON md_item_account_group (company_id);
ALTER TABLE md_item_account_group ADD CONSTRAINT fk_md_item_account_group_inventory_account_id FOREIGN KEY (inventory_account_id) REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_item_account_group_inventory_account_id ON md_item_account_group (inventory_account_id);
ALTER TABLE md_item_account_group ADD CONSTRAINT fk_md_item_account_group_cogs_account_id FOREIGN KEY (cogs_account_id) REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_item_account_group_cogs_account_id ON md_item_account_group (cogs_account_id);
ALTER TABLE md_item_account_group ADD CONSTRAINT fk_md_item_account_group_sales_account_id FOREIGN KEY (sales_account_id) REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_item_account_group_sales_account_id ON md_item_account_group (sales_account_id);
ALTER TABLE md_item_account_group ADD CONSTRAINT fk_md_item_account_group_sales_return_account_id FOREIGN KEY (sales_return_account_id) REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_item_account_group_sales_return_account_id ON md_item_account_group (sales_return_account_id);
ALTER TABLE md_item_account_group ADD CONSTRAINT fk_md_item_account_group_purchase_account_id FOREIGN KEY (purchase_account_id) REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_item_account_group_purchase_account_id ON md_item_account_group (purchase_account_id);
ALTER TABLE md_item_account_group ADD CONSTRAINT fk_md_item_account_group_purchase_return_account_id FOREIGN KEY (purchase_return_account_id) REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_item_account_group_purchase_return_account_id ON md_item_account_group (purchase_return_account_id);
ALTER TABLE md_item_account_group ADD CONSTRAINT fk_md_item_account_group_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_item_account_group_created_by ON md_item_account_group (created_by);
ALTER TABLE md_item_account_group ADD CONSTRAINT fk_md_item_account_group_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_item_account_group_updated_by ON md_item_account_group (updated_by);
ALTER TABLE md_item ADD CONSTRAINT fk_md_item_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_item_company_id ON md_item (company_id);
ALTER TABLE md_item ADD CONSTRAINT fk_md_item_account_group_id FOREIGN KEY (account_group_id) REFERENCES md_item_account_group(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_item_account_group_id ON md_item (account_group_id);
ALTER TABLE md_item ADD CONSTRAINT fk_md_item_base_unit_id FOREIGN KEY (base_unit_id) REFERENCES md_unit(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_item_base_unit_id ON md_item (base_unit_id);
ALTER TABLE md_item ADD CONSTRAINT fk_md_item_count_unit_id FOREIGN KEY (count_unit_id) REFERENCES md_unit(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_item_count_unit_id ON md_item (count_unit_id);
ALTER TABLE md_item ADD CONSTRAINT fk_md_item_purchase_unit_id FOREIGN KEY (purchase_unit_id) REFERENCES md_unit(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_item_purchase_unit_id ON md_item (purchase_unit_id);
ALTER TABLE md_item ADD CONSTRAINT fk_md_item_sales_unit_id FOREIGN KEY (sales_unit_id) REFERENCES md_unit(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_item_sales_unit_id ON md_item (sales_unit_id);
ALTER TABLE md_item ADD CONSTRAINT fk_md_item_default_supplier_id FOREIGN KEY (default_supplier_id) REFERENCES md_supplier(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_item_default_supplier_id ON md_item (default_supplier_id);
ALTER TABLE md_item ADD CONSTRAINT fk_md_item_substitute_item_id FOREIGN KEY (substitute_item_id) REFERENCES md_item(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_item_substitute_item_id ON md_item (substitute_item_id);
ALTER TABLE md_item ADD CONSTRAINT fk_md_item_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_item_created_by ON md_item (created_by);
ALTER TABLE md_item ADD CONSTRAINT fk_md_item_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_item_updated_by ON md_item (updated_by);
ALTER TABLE md_item_bom ADD CONSTRAINT fk_md_item_bom_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_item_bom_company_id ON md_item_bom (company_id);
ALTER TABLE md_item_bom ADD CONSTRAINT fk_md_item_bom_parent_item_id FOREIGN KEY (parent_item_id) REFERENCES md_item(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_item_bom_parent_item_id ON md_item_bom (parent_item_id);
ALTER TABLE md_item_bom ADD CONSTRAINT fk_md_item_bom_component_item_id FOREIGN KEY (component_item_id) REFERENCES md_item(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_item_bom_component_item_id ON md_item_bom (component_item_id);
ALTER TABLE md_item_bom ADD CONSTRAINT fk_md_item_bom_warehouse_id FOREIGN KEY (warehouse_id) REFERENCES md_warehouse(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_item_bom_warehouse_id ON md_item_bom (warehouse_id);
ALTER TABLE md_item_bom ADD CONSTRAINT fk_md_item_bom_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_item_bom_created_by ON md_item_bom (created_by);
ALTER TABLE md_item_bom ADD CONSTRAINT fk_md_item_bom_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_item_bom_updated_by ON md_item_bom (updated_by);
ALTER TABLE md_item_price_break ADD CONSTRAINT fk_md_item_price_break_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_item_price_break_company_id ON md_item_price_break (company_id);
ALTER TABLE md_item_price_break ADD CONSTRAINT fk_md_item_price_break_item_id FOREIGN KEY (item_id) REFERENCES md_item(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_item_price_break_item_id ON md_item_price_break (item_id);
ALTER TABLE md_item_price_break ADD CONSTRAINT fk_md_item_price_break_unit_id FOREIGN KEY (unit_id) REFERENCES md_unit(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_item_price_break_unit_id ON md_item_price_break (unit_id);
ALTER TABLE md_item_price_break ADD CONSTRAINT fk_md_item_price_break_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_item_price_break_created_by ON md_item_price_break (created_by);
ALTER TABLE md_item_price_break ADD CONSTRAINT fk_md_item_price_break_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_item_price_break_updated_by ON md_item_price_break (updated_by);
ALTER TABLE md_item_reorder ADD CONSTRAINT fk_md_item_reorder_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_item_reorder_company_id ON md_item_reorder (company_id);
ALTER TABLE md_item_reorder ADD CONSTRAINT fk_md_item_reorder_item_id FOREIGN KEY (item_id) REFERENCES md_item(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_item_reorder_item_id ON md_item_reorder (item_id);
ALTER TABLE md_item_reorder ADD CONSTRAINT fk_md_item_reorder_warehouse_id FOREIGN KEY (warehouse_id) REFERENCES md_warehouse(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_item_reorder_warehouse_id ON md_item_reorder (warehouse_id);
ALTER TABLE md_item_reorder ADD CONSTRAINT fk_md_item_reorder_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_item_reorder_created_by ON md_item_reorder (created_by);
ALTER TABLE md_item_reorder ADD CONSTRAINT fk_md_item_reorder_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_item_reorder_updated_by ON md_item_reorder (updated_by);
ALTER TABLE md_customer ADD CONSTRAINT fk_md_customer_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_customer_company_id ON md_customer (company_id);
ALTER TABLE md_customer ADD CONSTRAINT fk_md_customer_salesperson_id FOREIGN KEY (salesperson_id) REFERENCES md_salesperson(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_customer_salesperson_id ON md_customer (salesperson_id);
ALTER TABLE md_customer ADD CONSTRAINT fk_md_customer_ar_account_id FOREIGN KEY (ar_account_id) REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_customer_ar_account_id ON md_customer (ar_account_id);
ALTER TABLE md_customer ADD CONSTRAINT fk_md_customer_payer_id FOREIGN KEY (payer_id) REFERENCES md_customer(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_customer_payer_id ON md_customer (payer_id);
ALTER TABLE md_customer ADD CONSTRAINT fk_md_customer_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_customer_created_by ON md_customer (created_by);
ALTER TABLE md_customer ADD CONSTRAINT fk_md_customer_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_customer_updated_by ON md_customer (updated_by);
ALTER TABLE md_customer_ship_to ADD CONSTRAINT fk_md_customer_ship_to_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_customer_ship_to_company_id ON md_customer_ship_to (company_id);
ALTER TABLE md_customer_ship_to ADD CONSTRAINT fk_md_customer_ship_to_customer_id FOREIGN KEY (customer_id) REFERENCES md_customer(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_customer_ship_to_customer_id ON md_customer_ship_to (customer_id);
ALTER TABLE md_customer_ship_to ADD CONSTRAINT fk_md_customer_ship_to_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_customer_ship_to_created_by ON md_customer_ship_to (created_by);
ALTER TABLE md_customer_ship_to ADD CONSTRAINT fk_md_customer_ship_to_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_customer_ship_to_updated_by ON md_customer_ship_to (updated_by);
ALTER TABLE md_supplier ADD CONSTRAINT fk_md_supplier_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_supplier_company_id ON md_supplier (company_id);
ALTER TABLE md_supplier ADD CONSTRAINT fk_md_supplier_ap_account_id FOREIGN KEY (ap_account_id) REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_supplier_ap_account_id ON md_supplier (ap_account_id);
ALTER TABLE md_supplier ADD CONSTRAINT fk_md_supplier_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_supplier_created_by ON md_supplier (created_by);
ALTER TABLE md_supplier ADD CONSTRAINT fk_md_supplier_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_supplier_updated_by ON md_supplier (updated_by);
ALTER TABLE md_party_contact ADD CONSTRAINT fk_md_party_contact_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_party_contact_company_id ON md_party_contact (company_id);
ALTER TABLE md_party_contact ADD CONSTRAINT fk_md_party_contact_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_party_contact_created_by ON md_party_contact (created_by);
ALTER TABLE md_party_contact ADD CONSTRAINT fk_md_party_contact_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_party_contact_updated_by ON md_party_contact (updated_by);
ALTER TABLE md_supplier_bank ADD CONSTRAINT fk_md_supplier_bank_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_supplier_bank_company_id ON md_supplier_bank (company_id);
ALTER TABLE md_supplier_bank ADD CONSTRAINT fk_md_supplier_bank_supplier_id FOREIGN KEY (supplier_id) REFERENCES md_supplier(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_supplier_bank_supplier_id ON md_supplier_bank (supplier_id);
ALTER TABLE md_supplier_bank ADD CONSTRAINT fk_md_supplier_bank_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_supplier_bank_created_by ON md_supplier_bank (created_by);
ALTER TABLE md_supplier_bank ADD CONSTRAINT fk_md_supplier_bank_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_supplier_bank_updated_by ON md_supplier_bank (updated_by);
ALTER TABLE md_salesperson ADD CONSTRAINT fk_md_salesperson_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_salesperson_company_id ON md_salesperson (company_id);
ALTER TABLE md_salesperson ADD CONSTRAINT fk_md_salesperson_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_salesperson_created_by ON md_salesperson (created_by);
ALTER TABLE md_salesperson ADD CONSTRAINT fk_md_salesperson_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_salesperson_updated_by ON md_salesperson (updated_by);
ALTER TABLE md_sales_target ADD CONSTRAINT fk_md_sales_target_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_sales_target_company_id ON md_sales_target (company_id);
ALTER TABLE md_sales_target ADD CONSTRAINT fk_md_sales_target_salesperson_id FOREIGN KEY (salesperson_id) REFERENCES md_salesperson(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_sales_target_salesperson_id ON md_sales_target (salesperson_id);
ALTER TABLE md_sales_target ADD CONSTRAINT fk_md_sales_target_period_id FOREIGN KEY (period_id) REFERENCES gl_period(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_sales_target_period_id ON md_sales_target (period_id);
ALTER TABLE md_sales_target ADD CONSTRAINT fk_md_sales_target_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_sales_target_created_by ON md_sales_target (created_by);
ALTER TABLE md_sales_target ADD CONSTRAINT fk_md_sales_target_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_sales_target_updated_by ON md_sales_target (updated_by);
ALTER TABLE md_bank_account ADD CONSTRAINT fk_md_bank_account_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_bank_account_company_id ON md_bank_account (company_id);
ALTER TABLE md_bank_account ADD CONSTRAINT fk_md_bank_account_bank_id FOREIGN KEY (bank_id) REFERENCES md_bank(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_bank_account_bank_id ON md_bank_account (bank_id);
ALTER TABLE md_bank_account ADD CONSTRAINT fk_md_bank_account_gl_account_id FOREIGN KEY (gl_account_id) REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_bank_account_gl_account_id ON md_bank_account (gl_account_id);
ALTER TABLE md_bank_account ADD CONSTRAINT fk_md_bank_account_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_bank_account_created_by ON md_bank_account (created_by);
ALTER TABLE md_bank_account ADD CONSTRAINT fk_md_bank_account_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_bank_account_updated_by ON md_bank_account (updated_by);
ALTER TABLE md_doc_type ADD CONSTRAINT fk_md_doc_type_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_doc_type_company_id ON md_doc_type (company_id);
ALTER TABLE md_doc_type ADD CONSTRAINT fk_md_doc_type_journal_book_id FOREIGN KEY (journal_book_id) REFERENCES gl_journal_book(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_doc_type_journal_book_id ON md_doc_type (journal_book_id);
ALTER TABLE md_doc_type ADD CONSTRAINT fk_md_doc_type_department_id FOREIGN KEY (department_id) REFERENCES md_department(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_doc_type_department_id ON md_doc_type (department_id);
ALTER TABLE md_doc_type ADD CONSTRAINT fk_md_doc_type_warehouse_id FOREIGN KEY (warehouse_id) REFERENCES md_warehouse(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_doc_type_warehouse_id ON md_doc_type (warehouse_id);
ALTER TABLE md_doc_type ADD CONSTRAINT fk_md_doc_type_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_doc_type_created_by ON md_doc_type (created_by);
ALTER TABLE md_doc_type ADD CONSTRAINT fk_md_doc_type_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_doc_type_updated_by ON md_doc_type (updated_by);
ALTER TABLE md_doc_type_account ADD CONSTRAINT fk_md_doc_type_account_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_doc_type_account_company_id ON md_doc_type_account (company_id);
ALTER TABLE md_doc_type_account ADD CONSTRAINT fk_md_doc_type_account_doc_type_id FOREIGN KEY (doc_type_id) REFERENCES md_doc_type(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_doc_type_account_doc_type_id ON md_doc_type_account (doc_type_id);
ALTER TABLE md_doc_type_account ADD CONSTRAINT fk_md_doc_type_account_account_id FOREIGN KEY (account_id) REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_doc_type_account_account_id ON md_doc_type_account (account_id);
ALTER TABLE md_doc_type_account ADD CONSTRAINT fk_md_doc_type_account_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_doc_type_account_created_by ON md_doc_type_account (created_by);
ALTER TABLE md_doc_type_account ADD CONSTRAINT fk_md_doc_type_account_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_doc_type_account_updated_by ON md_doc_type_account (updated_by);
ALTER TABLE md_payment_method ADD CONSTRAINT fk_md_payment_method_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_payment_method_company_id ON md_payment_method (company_id);
ALTER TABLE md_payment_method ADD CONSTRAINT fk_md_payment_method_gl_account_id FOREIGN KEY (gl_account_id) REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_payment_method_gl_account_id ON md_payment_method (gl_account_id);
ALTER TABLE md_payment_method ADD CONSTRAINT fk_md_payment_method_bank_account_id FOREIGN KEY (bank_account_id) REFERENCES md_bank_account(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_payment_method_bank_account_id ON md_payment_method (bank_account_id);
ALTER TABLE md_payment_method ADD CONSTRAINT fk_md_payment_method_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_payment_method_created_by ON md_payment_method (created_by);
ALTER TABLE md_payment_method ADD CONSTRAINT fk_md_payment_method_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_payment_method_updated_by ON md_payment_method (updated_by);
ALTER TABLE md_doc_number_block ADD CONSTRAINT fk_md_doc_number_block_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_doc_number_block_company_id ON md_doc_number_block (company_id);
ALTER TABLE md_doc_number_block ADD CONSTRAINT fk_md_doc_number_block_doc_type_id FOREIGN KEY (doc_type_id) REFERENCES md_doc_type(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_doc_number_block_doc_type_id ON md_doc_number_block (doc_type_id);
ALTER TABLE md_doc_number_block ADD CONSTRAINT fk_md_doc_number_block_branch_id FOREIGN KEY (branch_id) REFERENCES sys_branch(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_doc_number_block_branch_id ON md_doc_number_block (branch_id);
ALTER TABLE md_doc_number_block ADD CONSTRAINT fk_md_doc_number_block_device_id FOREIGN KEY (device_id) REFERENCES sys_device(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_doc_number_block_device_id ON md_doc_number_block (device_id);
ALTER TABLE md_doc_number_block ADD CONSTRAINT fk_md_doc_number_block_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_doc_number_block_created_by ON md_doc_number_block (created_by);
ALTER TABLE md_doc_number_block ADD CONSTRAINT fk_md_doc_number_block_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_doc_number_block_updated_by ON md_doc_number_block (updated_by);
ALTER TABLE doc_header ADD CONSTRAINT fk_doc_header_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_header_company_id ON doc_header (company_id);
ALTER TABLE doc_header ADD CONSTRAINT fk_doc_header_branch_id FOREIGN KEY (branch_id) REFERENCES sys_branch(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_header_branch_id ON doc_header (branch_id);
ALTER TABLE doc_header ADD CONSTRAINT fk_doc_header_doc_type_id FOREIGN KEY (doc_type_id) REFERENCES md_doc_type(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_header_doc_type_id ON doc_header (doc_type_id);
ALTER TABLE doc_header ADD CONSTRAINT fk_doc_header_period_id FOREIGN KEY (period_id) REFERENCES gl_period(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_header_period_id ON doc_header (period_id);
ALTER TABLE doc_header ADD CONSTRAINT fk_doc_header_customer_id FOREIGN KEY (customer_id) REFERENCES md_customer(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_header_customer_id ON doc_header (customer_id);
ALTER TABLE doc_header ADD CONSTRAINT fk_doc_header_supplier_id FOREIGN KEY (supplier_id) REFERENCES md_supplier(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_header_supplier_id ON doc_header (supplier_id);
ALTER TABLE doc_header ADD CONSTRAINT fk_doc_header_bill_to_customer_id FOREIGN KEY (bill_to_customer_id) REFERENCES md_customer(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_header_bill_to_customer_id ON doc_header (bill_to_customer_id);
ALTER TABLE doc_header ADD CONSTRAINT fk_doc_header_ship_to_id FOREIGN KEY (ship_to_id) REFERENCES md_customer_ship_to(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_header_ship_to_id ON doc_header (ship_to_id);
ALTER TABLE doc_header ADD CONSTRAINT fk_doc_header_salesperson_id FOREIGN KEY (salesperson_id) REFERENCES md_salesperson(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_header_salesperson_id ON doc_header (salesperson_id);
ALTER TABLE doc_header ADD CONSTRAINT fk_doc_header_department_id FOREIGN KEY (department_id) REFERENCES md_department(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_header_department_id ON doc_header (department_id);
ALTER TABLE doc_header ADD CONSTRAINT fk_doc_header_project_id FOREIGN KEY (project_id) REFERENCES md_project(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_header_project_id ON doc_header (project_id);
ALTER TABLE doc_header ADD CONSTRAINT fk_doc_header_warehouse_id FOREIGN KEY (warehouse_id) REFERENCES md_warehouse(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_header_warehouse_id ON doc_header (warehouse_id);
ALTER TABLE doc_header ADD CONSTRAINT fk_doc_header_to_warehouse_id FOREIGN KEY (to_warehouse_id) REFERENCES md_warehouse(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_header_to_warehouse_id ON doc_header (to_warehouse_id);
ALTER TABLE doc_header ADD CONSTRAINT fk_doc_header_bank_account_id FOREIGN KEY (bank_account_id) REFERENCES md_bank_account(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_header_bank_account_id ON doc_header (bank_account_id);
ALTER TABLE doc_header ADD CONSTRAINT fk_doc_header_vat_period_id FOREIGN KEY (vat_period_id) REFERENCES gl_period(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_header_vat_period_id ON doc_header (vat_period_id);
ALTER TABLE doc_header ADD CONSTRAINT fk_doc_header_journal_id FOREIGN KEY (journal_id) REFERENCES gl_journal(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_header_journal_id ON doc_header (journal_id);
ALTER TABLE doc_header ADD CONSTRAINT fk_doc_header_approved_by FOREIGN KEY (approved_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_header_approved_by ON doc_header (approved_by);
ALTER TABLE doc_header ADD CONSTRAINT fk_doc_header_auth_user_id FOREIGN KEY (auth_user_id) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_header_auth_user_id ON doc_header (auth_user_id);
ALTER TABLE doc_header ADD CONSTRAINT fk_doc_header_last_printed_by FOREIGN KEY (last_printed_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_header_last_printed_by ON doc_header (last_printed_by);
ALTER TABLE doc_header ADD CONSTRAINT fk_doc_header_device_id FOREIGN KEY (device_id) REFERENCES sys_device(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_header_device_id ON doc_header (device_id);
ALTER TABLE doc_header ADD CONSTRAINT fk_doc_header_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_header_created_by ON doc_header (created_by);
ALTER TABLE doc_header ADD CONSTRAINT fk_doc_header_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_header_updated_by ON doc_header (updated_by);
ALTER TABLE doc_line ADD CONSTRAINT fk_doc_line_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_line_company_id ON doc_line (company_id);
ALTER TABLE doc_line ADD CONSTRAINT fk_doc_line_header_id FOREIGN KEY (header_id) REFERENCES doc_header(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_line_header_id ON doc_line (header_id);
ALTER TABLE doc_line ADD CONSTRAINT fk_doc_line_item_id FOREIGN KEY (item_id) REFERENCES md_item(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_line_item_id ON doc_line (item_id);
ALTER TABLE doc_line ADD CONSTRAINT fk_doc_line_account_id FOREIGN KEY (account_id) REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_line_account_id ON doc_line (account_id);
ALTER TABLE doc_line ADD CONSTRAINT fk_doc_line_warehouse_id FOREIGN KEY (warehouse_id) REFERENCES md_warehouse(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_line_warehouse_id ON doc_line (warehouse_id);
ALTER TABLE doc_line ADD CONSTRAINT fk_doc_line_department_id FOREIGN KEY (department_id) REFERENCES md_department(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_line_department_id ON doc_line (department_id);
ALTER TABLE doc_line ADD CONSTRAINT fk_doc_line_project_id FOREIGN KEY (project_id) REFERENCES md_project(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_line_project_id ON doc_line (project_id);
ALTER TABLE doc_line ADD CONSTRAINT fk_doc_line_unit_id FOREIGN KEY (unit_id) REFERENCES md_unit(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_line_unit_id ON doc_line (unit_id);
ALTER TABLE doc_line ADD CONSTRAINT fk_doc_line_source_line_id FOREIGN KEY (source_line_id) REFERENCES doc_line(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_line_source_line_id ON doc_line (source_line_id);
ALTER TABLE doc_line ADD CONSTRAINT fk_doc_line_party_customer_id FOREIGN KEY (party_customer_id) REFERENCES md_customer(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_line_party_customer_id ON doc_line (party_customer_id);
ALTER TABLE doc_line ADD CONSTRAINT fk_doc_line_party_supplier_id FOREIGN KEY (party_supplier_id) REFERENCES md_supplier(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_line_party_supplier_id ON doc_line (party_supplier_id);
ALTER TABLE doc_line ADD CONSTRAINT fk_doc_line_salesperson_id FOREIGN KEY (salesperson_id) REFERENCES md_salesperson(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_line_salesperson_id ON doc_line (salesperson_id);
ALTER TABLE doc_line ADD CONSTRAINT fk_doc_line_gl_debit_account_id FOREIGN KEY (gl_debit_account_id) REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_line_gl_debit_account_id ON doc_line (gl_debit_account_id);
ALTER TABLE doc_line ADD CONSTRAINT fk_doc_line_gl_credit_account_id FOREIGN KEY (gl_credit_account_id) REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_line_gl_credit_account_id ON doc_line (gl_credit_account_id);
ALTER TABLE doc_line ADD CONSTRAINT fk_doc_line_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_line_created_by ON doc_line (created_by);
ALTER TABLE doc_line ADD CONSTRAINT fk_doc_line_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_line_updated_by ON doc_line (updated_by);
ALTER TABLE doc_note ADD CONSTRAINT fk_doc_note_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_note_company_id ON doc_note (company_id);
ALTER TABLE doc_note ADD CONSTRAINT fk_doc_note_header_id FOREIGN KEY (header_id) REFERENCES doc_header(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_note_header_id ON doc_note (header_id);
ALTER TABLE doc_note ADD CONSTRAINT fk_doc_note_line_id FOREIGN KEY (line_id) REFERENCES doc_line(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_note_line_id ON doc_note (line_id);
ALTER TABLE doc_note ADD CONSTRAINT fk_doc_note_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_note_created_by ON doc_note (created_by);
ALTER TABLE doc_note ADD CONSTRAINT fk_doc_note_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_note_updated_by ON doc_note (updated_by);
ALTER TABLE md_note ADD CONSTRAINT fk_md_note_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_note_company_id ON md_note (company_id);
ALTER TABLE md_note ADD CONSTRAINT fk_md_note_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_note_created_by ON md_note (created_by);
ALTER TABLE md_note ADD CONSTRAINT fk_md_note_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_note_updated_by ON md_note (updated_by);
ALTER TABLE doc_link ADD CONSTRAINT fk_doc_link_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_link_company_id ON doc_link (company_id);
ALTER TABLE doc_link ADD CONSTRAINT fk_doc_link_from_header_id FOREIGN KEY (from_header_id) REFERENCES doc_header(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_link_from_header_id ON doc_link (from_header_id);
ALTER TABLE doc_link ADD CONSTRAINT fk_doc_link_to_header_id FOREIGN KEY (to_header_id) REFERENCES doc_header(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_link_to_header_id ON doc_link (to_header_id);
ALTER TABLE doc_link ADD CONSTRAINT fk_doc_link_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_link_created_by ON doc_link (created_by);
ALTER TABLE doc_link ADD CONSTRAINT fk_doc_link_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_link_updated_by ON doc_link (updated_by);
ALTER TABLE doc_bill_item ADD CONSTRAINT fk_doc_bill_item_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_bill_item_company_id ON doc_bill_item (company_id);
ALTER TABLE doc_bill_item ADD CONSTRAINT fk_doc_bill_item_bill_header_id FOREIGN KEY (bill_header_id) REFERENCES doc_header(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_bill_item_bill_header_id ON doc_bill_item (bill_header_id);
ALTER TABLE doc_bill_item ADD CONSTRAINT fk_doc_bill_item_invoice_header_id FOREIGN KEY (invoice_header_id) REFERENCES doc_header(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_bill_item_invoice_header_id ON doc_bill_item (invoice_header_id);
ALTER TABLE doc_bill_item ADD CONSTRAINT fk_doc_bill_item_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_bill_item_created_by ON doc_bill_item (created_by);
ALTER TABLE doc_bill_item ADD CONSTRAINT fk_doc_bill_item_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_bill_item_updated_by ON doc_bill_item (updated_by);
ALTER TABLE doc_settlement ADD CONSTRAINT fk_doc_settlement_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_settlement_company_id ON doc_settlement (company_id);
ALTER TABLE doc_settlement ADD CONSTRAINT fk_doc_settlement_payment_header_id FOREIGN KEY (payment_header_id) REFERENCES doc_header(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_settlement_payment_header_id ON doc_settlement (payment_header_id);
ALTER TABLE doc_settlement ADD CONSTRAINT fk_doc_settlement_payment_journal_id FOREIGN KEY (payment_journal_id) REFERENCES gl_journal(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_settlement_payment_journal_id ON doc_settlement (payment_journal_id);
ALTER TABLE doc_settlement ADD CONSTRAINT fk_doc_settlement_invoice_header_id FOREIGN KEY (invoice_header_id) REFERENCES doc_header(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_settlement_invoice_header_id ON doc_settlement (invoice_header_id);
ALTER TABLE doc_settlement ADD CONSTRAINT fk_doc_settlement_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_settlement_created_by ON doc_settlement (created_by);
ALTER TABLE doc_settlement ADD CONSTRAINT fk_doc_settlement_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_settlement_updated_by ON doc_settlement (updated_by);
ALTER TABLE doc_payment ADD CONSTRAINT fk_doc_payment_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_payment_company_id ON doc_payment (company_id);
ALTER TABLE doc_payment ADD CONSTRAINT fk_doc_payment_header_id FOREIGN KEY (header_id) REFERENCES doc_header(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_payment_header_id ON doc_payment (header_id);
ALTER TABLE doc_payment ADD CONSTRAINT fk_doc_payment_payment_method_id FOREIGN KEY (payment_method_id) REFERENCES md_payment_method(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_payment_payment_method_id ON doc_payment (payment_method_id);
ALTER TABLE doc_payment ADD CONSTRAINT fk_doc_payment_cheque_id FOREIGN KEY (cheque_id) REFERENCES fin_cheque(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_payment_cheque_id ON doc_payment (cheque_id);
ALTER TABLE doc_payment ADD CONSTRAINT fk_doc_payment_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_payment_created_by ON doc_payment (created_by);
ALTER TABLE doc_payment ADD CONSTRAINT fk_doc_payment_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_payment_updated_by ON doc_payment (updated_by);
ALTER TABLE fin_cheque ADD CONSTRAINT fk_fin_cheque_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_fin_cheque_company_id ON fin_cheque (company_id);
ALTER TABLE fin_cheque ADD CONSTRAINT fk_fin_cheque_branch_id FOREIGN KEY (branch_id) REFERENCES sys_branch(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_fin_cheque_branch_id ON fin_cheque (branch_id);
ALTER TABLE fin_cheque ADD CONSTRAINT fk_fin_cheque_bank_id FOREIGN KEY (bank_id) REFERENCES md_bank(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_fin_cheque_bank_id ON fin_cheque (bank_id);
ALTER TABLE fin_cheque ADD CONSTRAINT fk_fin_cheque_bank_account_id FOREIGN KEY (bank_account_id) REFERENCES md_bank_account(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_fin_cheque_bank_account_id ON fin_cheque (bank_account_id);
ALTER TABLE fin_cheque ADD CONSTRAINT fk_fin_cheque_customer_id FOREIGN KEY (customer_id) REFERENCES md_customer(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_fin_cheque_customer_id ON fin_cheque (customer_id);
ALTER TABLE fin_cheque ADD CONSTRAINT fk_fin_cheque_supplier_id FOREIGN KEY (supplier_id) REFERENCES md_supplier(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_fin_cheque_supplier_id ON fin_cheque (supplier_id);
ALTER TABLE fin_cheque ADD CONSTRAINT fk_fin_cheque_department_id FOREIGN KEY (department_id) REFERENCES md_department(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_fin_cheque_department_id ON fin_cheque (department_id);
ALTER TABLE fin_cheque ADD CONSTRAINT fk_fin_cheque_source_header_id FOREIGN KEY (source_header_id) REFERENCES doc_header(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_fin_cheque_source_header_id ON fin_cheque (source_header_id);
ALTER TABLE fin_cheque ADD CONSTRAINT fk_fin_cheque_deposit_header_id FOREIGN KEY (deposit_header_id) REFERENCES doc_header(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_fin_cheque_deposit_header_id ON fin_cheque (deposit_header_id);
ALTER TABLE fin_cheque ADD CONSTRAINT fk_fin_cheque_pass_journal_id FOREIGN KEY (pass_journal_id) REFERENCES gl_journal(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_fin_cheque_pass_journal_id ON fin_cheque (pass_journal_id);
ALTER TABLE fin_cheque ADD CONSTRAINT fk_fin_cheque_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_fin_cheque_created_by ON fin_cheque (created_by);
ALTER TABLE fin_cheque ADD CONSTRAINT fk_fin_cheque_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_fin_cheque_updated_by ON fin_cheque (updated_by);
ALTER TABLE fin_cheque_event ADD CONSTRAINT fk_fin_cheque_event_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_fin_cheque_event_company_id ON fin_cheque_event (company_id);
ALTER TABLE fin_cheque_event ADD CONSTRAINT fk_fin_cheque_event_cheque_id FOREIGN KEY (cheque_id) REFERENCES fin_cheque(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_fin_cheque_event_cheque_id ON fin_cheque_event (cheque_id);
ALTER TABLE fin_cheque_event ADD CONSTRAINT fk_fin_cheque_event_header_id FOREIGN KEY (header_id) REFERENCES doc_header(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_fin_cheque_event_header_id ON fin_cheque_event (header_id);
ALTER TABLE fin_cheque_event ADD CONSTRAINT fk_fin_cheque_event_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_fin_cheque_event_created_by ON fin_cheque_event (created_by);
ALTER TABLE fin_cheque_event ADD CONSTRAINT fk_fin_cheque_event_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_fin_cheque_event_updated_by ON fin_cheque_event (updated_by);
ALTER TABLE fin_bank_ledger ADD CONSTRAINT fk_fin_bank_ledger_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_fin_bank_ledger_company_id ON fin_bank_ledger (company_id);
ALTER TABLE fin_bank_ledger ADD CONSTRAINT fk_fin_bank_ledger_bank_account_id FOREIGN KEY (bank_account_id) REFERENCES md_bank_account(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_fin_bank_ledger_bank_account_id ON fin_bank_ledger (bank_account_id);
ALTER TABLE fin_bank_ledger ADD CONSTRAINT fk_fin_bank_ledger_header_id FOREIGN KEY (header_id) REFERENCES doc_header(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_fin_bank_ledger_header_id ON fin_bank_ledger (header_id);
ALTER TABLE fin_bank_ledger ADD CONSTRAINT fk_fin_bank_ledger_cheque_id FOREIGN KEY (cheque_id) REFERENCES fin_cheque(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_fin_bank_ledger_cheque_id ON fin_bank_ledger (cheque_id);
ALTER TABLE fin_bank_ledger ADD CONSTRAINT fk_fin_bank_ledger_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_fin_bank_ledger_created_by ON fin_bank_ledger (created_by);
ALTER TABLE fin_bank_ledger ADD CONSTRAINT fk_fin_bank_ledger_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_fin_bank_ledger_updated_by ON fin_bank_ledger (updated_by);
ALTER TABLE inv_stock_ledger ADD CONSTRAINT fk_inv_stock_ledger_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_inv_stock_ledger_company_id ON inv_stock_ledger (company_id);
ALTER TABLE inv_stock_ledger ADD CONSTRAINT fk_inv_stock_ledger_item_id FOREIGN KEY (item_id) REFERENCES md_item(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_inv_stock_ledger_item_id ON inv_stock_ledger (item_id);
ALTER TABLE inv_stock_ledger ADD CONSTRAINT fk_inv_stock_ledger_warehouse_id FOREIGN KEY (warehouse_id) REFERENCES md_warehouse(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_inv_stock_ledger_warehouse_id ON inv_stock_ledger (warehouse_id);
ALTER TABLE inv_stock_ledger ADD CONSTRAINT fk_inv_stock_ledger_line_id FOREIGN KEY (line_id) REFERENCES doc_line(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_inv_stock_ledger_line_id ON inv_stock_ledger (line_id);
ALTER TABLE inv_stock_ledger ADD CONSTRAINT fk_inv_stock_ledger_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_inv_stock_ledger_created_by ON inv_stock_ledger (created_by);
ALTER TABLE inv_stock_ledger ADD CONSTRAINT fk_inv_stock_ledger_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_inv_stock_ledger_updated_by ON inv_stock_ledger (updated_by);
ALTER TABLE inv_cost_layer ADD CONSTRAINT fk_inv_cost_layer_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_inv_cost_layer_company_id ON inv_cost_layer (company_id);
ALTER TABLE inv_cost_layer ADD CONSTRAINT fk_inv_cost_layer_item_id FOREIGN KEY (item_id) REFERENCES md_item(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_inv_cost_layer_item_id ON inv_cost_layer (item_id);
ALTER TABLE inv_cost_layer ADD CONSTRAINT fk_inv_cost_layer_warehouse_id FOREIGN KEY (warehouse_id) REFERENCES md_warehouse(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_inv_cost_layer_warehouse_id ON inv_cost_layer (warehouse_id);
ALTER TABLE inv_cost_layer ADD CONSTRAINT fk_inv_cost_layer_receipt_line_id FOREIGN KEY (receipt_line_id) REFERENCES doc_line(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_inv_cost_layer_receipt_line_id ON inv_cost_layer (receipt_line_id);
ALTER TABLE inv_cost_layer ADD CONSTRAINT fk_inv_cost_layer_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_inv_cost_layer_created_by ON inv_cost_layer (created_by);
ALTER TABLE inv_cost_layer ADD CONSTRAINT fk_inv_cost_layer_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_inv_cost_layer_updated_by ON inv_cost_layer (updated_by);
ALTER TABLE inv_cost_consumption ADD CONSTRAINT fk_inv_cost_consumption_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_inv_cost_consumption_company_id ON inv_cost_consumption (company_id);
ALTER TABLE inv_cost_consumption ADD CONSTRAINT fk_inv_cost_consumption_issue_line_id FOREIGN KEY (issue_line_id) REFERENCES doc_line(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_inv_cost_consumption_issue_line_id ON inv_cost_consumption (issue_line_id);
ALTER TABLE inv_cost_consumption ADD CONSTRAINT fk_inv_cost_consumption_layer_id FOREIGN KEY (layer_id) REFERENCES inv_cost_layer(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_inv_cost_consumption_layer_id ON inv_cost_consumption (layer_id);
ALTER TABLE inv_cost_consumption ADD CONSTRAINT fk_inv_cost_consumption_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_inv_cost_consumption_created_by ON inv_cost_consumption (created_by);
ALTER TABLE inv_cost_consumption ADD CONSTRAINT fk_inv_cost_consumption_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_inv_cost_consumption_updated_by ON inv_cost_consumption (updated_by);
ALTER TABLE inv_stock_balance ADD CONSTRAINT fk_inv_stock_balance_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_inv_stock_balance_company_id ON inv_stock_balance (company_id);
ALTER TABLE inv_stock_balance ADD CONSTRAINT fk_inv_stock_balance_item_id FOREIGN KEY (item_id) REFERENCES md_item(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_inv_stock_balance_item_id ON inv_stock_balance (item_id);
ALTER TABLE inv_stock_balance ADD CONSTRAINT fk_inv_stock_balance_warehouse_id FOREIGN KEY (warehouse_id) REFERENCES md_warehouse(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_inv_stock_balance_warehouse_id ON inv_stock_balance (warehouse_id);
ALTER TABLE inv_stock_balance ADD CONSTRAINT fk_inv_stock_balance_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_inv_stock_balance_created_by ON inv_stock_balance (created_by);
ALTER TABLE inv_stock_balance ADD CONSTRAINT fk_inv_stock_balance_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_inv_stock_balance_updated_by ON inv_stock_balance (updated_by);
ALTER TABLE inv_stock_count ADD CONSTRAINT fk_inv_stock_count_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_inv_stock_count_company_id ON inv_stock_count (company_id);
ALTER TABLE inv_stock_count ADD CONSTRAINT fk_inv_stock_count_warehouse_id FOREIGN KEY (warehouse_id) REFERENCES md_warehouse(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_inv_stock_count_warehouse_id ON inv_stock_count (warehouse_id);
ALTER TABLE inv_stock_count ADD CONSTRAINT fk_inv_stock_count_item_id FOREIGN KEY (item_id) REFERENCES md_item(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_inv_stock_count_item_id ON inv_stock_count (item_id);
ALTER TABLE inv_stock_count ADD CONSTRAINT fk_inv_stock_count_adjust_line_id FOREIGN KEY (adjust_line_id) REFERENCES doc_line(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_inv_stock_count_adjust_line_id ON inv_stock_count (adjust_line_id);
ALTER TABLE inv_stock_count ADD CONSTRAINT fk_inv_stock_count_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_inv_stock_count_created_by ON inv_stock_count (created_by);
ALTER TABLE inv_stock_count ADD CONSTRAINT fk_inv_stock_count_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_inv_stock_count_updated_by ON inv_stock_count (updated_by);
ALTER TABLE md_serial ADD CONSTRAINT fk_md_serial_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_serial_company_id ON md_serial (company_id);
ALTER TABLE md_serial ADD CONSTRAINT fk_md_serial_item_id FOREIGN KEY (item_id) REFERENCES md_item(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_serial_item_id ON md_serial (item_id);
ALTER TABLE md_serial ADD CONSTRAINT fk_md_serial_sale_line_id FOREIGN KEY (sale_line_id) REFERENCES doc_line(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_serial_sale_line_id ON md_serial (sale_line_id);
ALTER TABLE md_serial ADD CONSTRAINT fk_md_serial_customer_id FOREIGN KEY (customer_id) REFERENCES md_customer(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_serial_customer_id ON md_serial (customer_id);
ALTER TABLE md_serial ADD CONSTRAINT fk_md_serial_salesperson_id FOREIGN KEY (salesperson_id) REFERENCES md_salesperson(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_serial_salesperson_id ON md_serial (salesperson_id);
ALTER TABLE md_serial ADD CONSTRAINT fk_md_serial_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_serial_created_by ON md_serial (created_by);
ALTER TABLE md_serial ADD CONSTRAINT fk_md_serial_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_serial_updated_by ON md_serial (updated_by);
ALTER TABLE md_serial_service ADD CONSTRAINT fk_md_serial_service_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_serial_service_company_id ON md_serial_service (company_id);
ALTER TABLE md_serial_service ADD CONSTRAINT fk_md_serial_service_serial_id FOREIGN KEY (serial_id) REFERENCES md_serial(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_serial_service_serial_id ON md_serial_service (serial_id);
ALTER TABLE md_serial_service ADD CONSTRAINT fk_md_serial_service_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_serial_service_created_by ON md_serial_service (created_by);
ALTER TABLE md_serial_service ADD CONSTRAINT fk_md_serial_service_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_serial_service_updated_by ON md_serial_service (updated_by);
ALTER TABLE gl_journal ADD CONSTRAINT fk_gl_journal_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_journal_company_id ON gl_journal (company_id);
ALTER TABLE gl_journal ADD CONSTRAINT fk_gl_journal_branch_id FOREIGN KEY (branch_id) REFERENCES sys_branch(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_journal_branch_id ON gl_journal (branch_id);
ALTER TABLE gl_journal ADD CONSTRAINT fk_gl_journal_journal_book_id FOREIGN KEY (journal_book_id) REFERENCES gl_journal_book(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_journal_journal_book_id ON gl_journal (journal_book_id);
ALTER TABLE gl_journal ADD CONSTRAINT fk_gl_journal_period_id FOREIGN KEY (period_id) REFERENCES gl_period(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_journal_period_id ON gl_journal (period_id);
ALTER TABLE gl_journal ADD CONSTRAINT fk_gl_journal_source_header_id FOREIGN KEY (source_header_id) REFERENCES doc_header(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_journal_source_header_id ON gl_journal (source_header_id);
ALTER TABLE gl_journal ADD CONSTRAINT fk_gl_journal_reversal_of_id FOREIGN KEY (reversal_of_id) REFERENCES gl_journal(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_journal_reversal_of_id ON gl_journal (reversal_of_id);
ALTER TABLE gl_journal ADD CONSTRAINT fk_gl_journal_posted_by FOREIGN KEY (posted_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_journal_posted_by ON gl_journal (posted_by);
ALTER TABLE gl_journal ADD CONSTRAINT fk_gl_journal_approved_by FOREIGN KEY (approved_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_journal_approved_by ON gl_journal (approved_by);
ALTER TABLE gl_journal ADD CONSTRAINT fk_gl_journal_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_journal_created_by ON gl_journal (created_by);
ALTER TABLE gl_journal ADD CONSTRAINT fk_gl_journal_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_journal_updated_by ON gl_journal (updated_by);
ALTER TABLE gl_journal_line ADD CONSTRAINT fk_gl_journal_line_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_journal_line_company_id ON gl_journal_line (company_id);
ALTER TABLE gl_journal_line ADD CONSTRAINT fk_gl_journal_line_journal_id FOREIGN KEY (journal_id) REFERENCES gl_journal(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_journal_line_journal_id ON gl_journal_line (journal_id);
ALTER TABLE gl_journal_line ADD CONSTRAINT fk_gl_journal_line_account_id FOREIGN KEY (account_id) REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_journal_line_account_id ON gl_journal_line (account_id);
ALTER TABLE gl_journal_line ADD CONSTRAINT fk_gl_journal_line_department_id FOREIGN KEY (department_id) REFERENCES md_department(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_journal_line_department_id ON gl_journal_line (department_id);
ALTER TABLE gl_journal_line ADD CONSTRAINT fk_gl_journal_line_project_id FOREIGN KEY (project_id) REFERENCES md_project(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_journal_line_project_id ON gl_journal_line (project_id);
ALTER TABLE gl_journal_line ADD CONSTRAINT fk_gl_journal_line_changed_from_account_id FOREIGN KEY (changed_from_account_id) REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_journal_line_changed_from_account_id ON gl_journal_line (changed_from_account_id);
ALTER TABLE gl_journal_line ADD CONSTRAINT fk_gl_journal_line_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_journal_line_created_by ON gl_journal_line (created_by);
ALTER TABLE gl_journal_line ADD CONSTRAINT fk_gl_journal_line_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_journal_line_updated_by ON gl_journal_line (updated_by);
ALTER TABLE gl_balance ADD CONSTRAINT fk_gl_balance_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_balance_company_id ON gl_balance (company_id);
ALTER TABLE gl_balance ADD CONSTRAINT fk_gl_balance_account_id FOREIGN KEY (account_id) REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_balance_account_id ON gl_balance (account_id);
ALTER TABLE gl_balance ADD CONSTRAINT fk_gl_balance_department_id FOREIGN KEY (department_id) REFERENCES md_department(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_balance_department_id ON gl_balance (department_id);
ALTER TABLE gl_balance ADD CONSTRAINT fk_gl_balance_period_id FOREIGN KEY (period_id) REFERENCES gl_period(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_balance_period_id ON gl_balance (period_id);
ALTER TABLE gl_balance ADD CONSTRAINT fk_gl_balance_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_balance_created_by ON gl_balance (created_by);
ALTER TABLE gl_balance ADD CONSTRAINT fk_gl_balance_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_balance_updated_by ON gl_balance (updated_by);
ALTER TABLE gl_budget ADD CONSTRAINT fk_gl_budget_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_budget_company_id ON gl_budget (company_id);
ALTER TABLE gl_budget ADD CONSTRAINT fk_gl_budget_account_id FOREIGN KEY (account_id) REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_budget_account_id ON gl_budget (account_id);
ALTER TABLE gl_budget ADD CONSTRAINT fk_gl_budget_department_id FOREIGN KEY (department_id) REFERENCES md_department(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_budget_department_id ON gl_budget (department_id);
ALTER TABLE gl_budget ADD CONSTRAINT fk_gl_budget_period_id FOREIGN KEY (period_id) REFERENCES gl_period(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_budget_period_id ON gl_budget (period_id);
ALTER TABLE gl_budget ADD CONSTRAINT fk_gl_budget_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_budget_created_by ON gl_budget (created_by);
ALTER TABLE gl_budget ADD CONSTRAINT fk_gl_budget_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_budget_updated_by ON gl_budget (updated_by);
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
ALTER TABLE gl_fs_report ADD CONSTRAINT fk_gl_fs_report_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_fs_report_company_id ON gl_fs_report (company_id);
ALTER TABLE gl_fs_report ADD CONSTRAINT fk_gl_fs_report_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_fs_report_created_by ON gl_fs_report (created_by);
ALTER TABLE gl_fs_report ADD CONSTRAINT fk_gl_fs_report_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_fs_report_updated_by ON gl_fs_report (updated_by);
ALTER TABLE gl_fs_line ADD CONSTRAINT fk_gl_fs_line_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_fs_line_company_id ON gl_fs_line (company_id);
ALTER TABLE gl_fs_line ADD CONSTRAINT fk_gl_fs_line_department_id FOREIGN KEY (department_id) REFERENCES md_department(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_fs_line_department_id ON gl_fs_line (department_id);
ALTER TABLE gl_fs_line ADD CONSTRAINT fk_gl_fs_line_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_fs_line_created_by ON gl_fs_line (created_by);
ALTER TABLE gl_fs_line ADD CONSTRAINT fk_gl_fs_line_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_gl_fs_line_updated_by ON gl_fs_line (updated_by);
ALTER TABLE tax_vat_entry ADD CONSTRAINT fk_tax_vat_entry_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_tax_vat_entry_company_id ON tax_vat_entry (company_id);
ALTER TABLE tax_vat_entry ADD CONSTRAINT fk_tax_vat_entry_header_id FOREIGN KEY (header_id) REFERENCES doc_header(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_tax_vat_entry_header_id ON tax_vat_entry (header_id);
ALTER TABLE tax_vat_entry ADD CONSTRAINT fk_tax_vat_entry_journal_id FOREIGN KEY (journal_id) REFERENCES gl_journal(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_tax_vat_entry_journal_id ON tax_vat_entry (journal_id);
ALTER TABLE tax_vat_entry ADD CONSTRAINT fk_tax_vat_entry_branch_id FOREIGN KEY (branch_id) REFERENCES sys_branch(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_tax_vat_entry_branch_id ON tax_vat_entry (branch_id);
ALTER TABLE tax_vat_entry ADD CONSTRAINT fk_tax_vat_entry_vat_period_id FOREIGN KEY (vat_period_id) REFERENCES gl_period(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_tax_vat_entry_vat_period_id ON tax_vat_entry (vat_period_id);
ALTER TABLE tax_vat_entry ADD CONSTRAINT fk_tax_vat_entry_department_id FOREIGN KEY (department_id) REFERENCES md_department(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_tax_vat_entry_department_id ON tax_vat_entry (department_id);
ALTER TABLE tax_vat_entry ADD CONSTRAINT fk_tax_vat_entry_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_tax_vat_entry_created_by ON tax_vat_entry (created_by);
ALTER TABLE tax_vat_entry ADD CONSTRAINT fk_tax_vat_entry_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_tax_vat_entry_updated_by ON tax_vat_entry (updated_by);
ALTER TABLE tax_wht_entry ADD CONSTRAINT fk_tax_wht_entry_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_tax_wht_entry_company_id ON tax_wht_entry (company_id);
ALTER TABLE tax_wht_entry ADD CONSTRAINT fk_tax_wht_entry_header_id FOREIGN KEY (header_id) REFERENCES doc_header(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_tax_wht_entry_header_id ON tax_wht_entry (header_id);
ALTER TABLE tax_wht_entry ADD CONSTRAINT fk_tax_wht_entry_branch_id FOREIGN KEY (branch_id) REFERENCES sys_branch(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_tax_wht_entry_branch_id ON tax_wht_entry (branch_id);
ALTER TABLE tax_wht_entry ADD CONSTRAINT fk_tax_wht_entry_tax_period_id FOREIGN KEY (tax_period_id) REFERENCES gl_period(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_tax_wht_entry_tax_period_id ON tax_wht_entry (tax_period_id);
ALTER TABLE tax_wht_entry ADD CONSTRAINT fk_tax_wht_entry_supplier_id FOREIGN KEY (supplier_id) REFERENCES md_supplier(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_tax_wht_entry_supplier_id ON tax_wht_entry (supplier_id);
ALTER TABLE tax_wht_entry ADD CONSTRAINT fk_tax_wht_entry_customer_id FOREIGN KEY (customer_id) REFERENCES md_customer(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_tax_wht_entry_customer_id ON tax_wht_entry (customer_id);
ALTER TABLE tax_wht_entry ADD CONSTRAINT fk_tax_wht_entry_department_id FOREIGN KEY (department_id) REFERENCES md_department(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_tax_wht_entry_department_id ON tax_wht_entry (department_id);
ALTER TABLE tax_wht_entry ADD CONSTRAINT fk_tax_wht_entry_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_tax_wht_entry_created_by ON tax_wht_entry (created_by);
ALTER TABLE tax_wht_entry ADD CONSTRAINT fk_tax_wht_entry_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_tax_wht_entry_updated_by ON tax_wht_entry (updated_by);
ALTER TABLE md_asset_account_group ADD CONSTRAINT fk_md_asset_account_group_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_asset_account_group_company_id ON md_asset_account_group (company_id);
ALTER TABLE md_asset_account_group ADD CONSTRAINT fk_md_asset_account_group_asset_account_id FOREIGN KEY (asset_account_id) REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_asset_account_group_asset_account_id ON md_asset_account_group (asset_account_id);
ALTER TABLE md_asset_account_group ADD CONSTRAINT fk_md_asset_account_group_depr_expense_account_id FOREIGN KEY (depr_expense_account_id) REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_asset_account_group_depr_expense_account_id ON md_asset_account_group (depr_expense_account_id);
ALTER TABLE md_asset_account_group ADD CONSTRAINT fk_md_asset_account_group_accum_depr_account_id FOREIGN KEY (accum_depr_account_id) REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_asset_account_group_accum_depr_account_id ON md_asset_account_group (accum_depr_account_id);
ALTER TABLE md_asset_account_group ADD CONSTRAINT fk_md_asset_account_group_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_asset_account_group_created_by ON md_asset_account_group (created_by);
ALTER TABLE md_asset_account_group ADD CONSTRAINT fk_md_asset_account_group_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_asset_account_group_updated_by ON md_asset_account_group (updated_by);
ALTER TABLE fa_asset ADD CONSTRAINT fk_fa_asset_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_fa_asset_company_id ON fa_asset (company_id);
ALTER TABLE fa_asset ADD CONSTRAINT fk_fa_asset_account_group_id FOREIGN KEY (account_group_id) REFERENCES md_asset_account_group(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_fa_asset_account_group_id ON fa_asset (account_group_id);
ALTER TABLE fa_asset ADD CONSTRAINT fk_fa_asset_department_id FOREIGN KEY (department_id) REFERENCES md_department(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_fa_asset_department_id ON fa_asset (department_id);
ALTER TABLE fa_asset ADD CONSTRAINT fk_fa_asset_branch_id FOREIGN KEY (branch_id) REFERENCES sys_branch(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_fa_asset_branch_id ON fa_asset (branch_id);
ALTER TABLE fa_asset ADD CONSTRAINT fk_fa_asset_sold_header_id FOREIGN KEY (sold_header_id) REFERENCES doc_header(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_fa_asset_sold_header_id ON fa_asset (sold_header_id);
ALTER TABLE fa_asset ADD CONSTRAINT fk_fa_asset_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_fa_asset_created_by ON fa_asset (created_by);
ALTER TABLE fa_asset ADD CONSTRAINT fk_fa_asset_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_fa_asset_updated_by ON fa_asset (updated_by);
ALTER TABLE fa_depreciation ADD CONSTRAINT fk_fa_depreciation_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_fa_depreciation_company_id ON fa_depreciation (company_id);
ALTER TABLE fa_depreciation ADD CONSTRAINT fk_fa_depreciation_asset_id FOREIGN KEY (asset_id) REFERENCES fa_asset(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_fa_depreciation_asset_id ON fa_depreciation (asset_id);
ALTER TABLE fa_depreciation ADD CONSTRAINT fk_fa_depreciation_period_id FOREIGN KEY (period_id) REFERENCES gl_period(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_fa_depreciation_period_id ON fa_depreciation (period_id);
ALTER TABLE fa_depreciation ADD CONSTRAINT fk_fa_depreciation_journal_id FOREIGN KEY (journal_id) REFERENCES gl_journal(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_fa_depreciation_journal_id ON fa_depreciation (journal_id);
ALTER TABLE fa_depreciation ADD CONSTRAINT fk_fa_depreciation_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_fa_depreciation_created_by ON fa_depreciation (created_by);
ALTER TABLE fa_depreciation ADD CONSTRAINT fk_fa_depreciation_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_fa_depreciation_updated_by ON fa_depreciation (updated_by);
ALTER TABLE sync_change_log ADD CONSTRAINT fk_sync_change_log_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sync_change_log_company_id ON sync_change_log (company_id);
ALTER TABLE sync_inbox ADD CONSTRAINT fk_sync_inbox_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sync_inbox_company_id ON sync_inbox (company_id);
ALTER TABLE sync_inbox ADD CONSTRAINT fk_sync_inbox_device_id FOREIGN KEY (device_id) REFERENCES sys_device(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sync_inbox_device_id ON sync_inbox (device_id);
ALTER TABLE sync_conflict ADD CONSTRAINT fk_sync_conflict_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sync_conflict_company_id ON sync_conflict (company_id);
ALTER TABLE sync_conflict ADD CONSTRAINT fk_sync_conflict_device_id FOREIGN KEY (device_id) REFERENCES sys_device(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sync_conflict_device_id ON sync_conflict (device_id);
ALTER TABLE sync_conflict ADD CONSTRAINT fk_sync_conflict_resolved_by FOREIGN KEY (resolved_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sync_conflict_resolved_by ON sync_conflict (resolved_by);
ALTER TABLE sync_conflict ADD CONSTRAINT fk_sync_conflict_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sync_conflict_created_by ON sync_conflict (created_by);
ALTER TABLE sync_conflict ADD CONSTRAINT fk_sync_conflict_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_sync_conflict_updated_by ON sync_conflict (updated_by);


-- ---------------------------------------------------------------- Functions
-- เพิ่ม row_version และ updated_at ทุกครั้งที่แก้ไข
CREATE OR REPLACE FUNCTION sys_bump_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW IS DISTINCT FROM OLD THEN
    NEW.row_version := OLD.row_version + 1;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$;

-- บันทึกการเปลี่ยนแปลงลง sync_change_log ให้เครื่องลูกดึงไป
CREATE OR REPLACE FUNCTION sync_log_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_company uuid; v_branch uuid; j jsonb;
BEGIN
  j := to_jsonb(NEW);
  v_company := COALESCE((j->>'company_id')::uuid, CASE WHEN TG_TABLE_NAME='sys_company' THEN NEW.id END);
  v_branch  := (j->>'branch_id')::uuid;
  IF v_company IS NULL THEN RETURN NEW; END IF;   -- ตารางระดับระบบ (ผู้ใช้/เมนู) ส่งทุกบริษัทผ่าน endpoint แยก
  INSERT INTO sync_change_log(company_id, branch_id, table_name, row_id, op, row_version, origin_device_id)
  VALUES (v_company, v_branch, TG_TABLE_NAME, NEW.id,
          CASE WHEN NEW.deleted_at IS NOT NULL THEN 'D' ELSE 'U' END,
          NEW.row_version, NULLIF(current_setting('app.device_id', true), '')::uuid);
  RETURN NEW;
END $$;

-- ห้ามแก้/ลบ log (กรมสรรพากรกำหนดให้เก็บ ≥ 2 ปี)
CREATE OR REPLACE FUNCTION sys_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'sys_activity_log is append-only'; END $$;

-- ใบสำคัญที่ผ่านรายการ (status = P) ต้องเดบิต = เครดิต
CREATE OR REPLACE FUNCTION gl_check_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d numeric; c numeric;
BEGIN
  IF NEW.status = 'P' AND NEW.doc_status = 'N' THEN
    SELECT COALESCE(sum(debit),0), COALESCE(sum(credit),0) INTO d, c
      FROM gl_journal_line WHERE journal_id = NEW.id AND deleted_at IS NULL;
    IF d <> c THEN
      RAISE EXCEPTION 'Journal % not balanced: debit % <> credit %', NEW.voucher_no, d, c;
    END IF;
  END IF;
  RETURN NULL;
END $$;

-- ห้ามบันทึก/แก้ไขเอกสารในงวดที่ปิดแล้ว (Express: ISPRD.LOCKn)
CREATE OR REPLACE FUNCTION gl_check_period_open() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_locked boolean; v_date date; j jsonb;
BEGIN
  j := to_jsonb(NEW);
  v_date := COALESCE((j->>'voucher_date')::date, (j->>'doc_date')::date);
  SELECT p.is_locked INTO v_locked FROM gl_period p
   WHERE p.company_id = NEW.company_id AND v_date BETWEEN p.start_date AND p.end_date AND p.deleted_at IS NULL
   ORDER BY p.period_no LIMIT 1;
  IF COALESCE(v_locked, false) AND current_setting('app.allow_locked_period', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Period is locked for date %', v_date USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------- Attach triggers
CREATE TRIGGER trg_sys_company_ver BEFORE UPDATE ON sys_company FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_sys_branch_ver BEFORE UPDATE ON sys_branch FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_sys_user_ver BEFORE UPDATE ON sys_user FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_sys_user_group_ver BEFORE UPDATE ON sys_user_group FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_sys_user_company_ver BEFORE UPDATE ON sys_user_company FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_sys_menu_ver BEFORE UPDATE ON sys_menu FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_sys_permission_ver BEFORE UPDATE ON sys_permission FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_sys_device_ver BEFORE UPDATE ON sys_device FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_sys_setting_ver BEFORE UPDATE ON sys_setting FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_sys_setting_def_ver BEFORE UPDATE ON sys_setting_def FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_gl_fiscal_year_ver BEFORE UPDATE ON gl_fiscal_year FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_gl_period_ver BEFORE UPDATE ON gl_period FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_gl_account_ver BEFORE UPDATE ON gl_account FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_gl_journal_book_ver BEFORE UPDATE ON gl_journal_book FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_gl_default_account_ver BEFORE UPDATE ON gl_default_account FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_gl_journal_route_ver BEFORE UPDATE ON gl_journal_route FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_gl_posting_rule_ver BEFORE UPDATE ON gl_posting_rule FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_gl_template_ver BEFORE UPDATE ON gl_template FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_gl_template_line_ver BEFORE UPDATE ON gl_template_line FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_md_lookup_type_ver BEFORE UPDATE ON md_lookup_type FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_md_lookup_ver BEFORE UPDATE ON md_lookup FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_md_unit_ver BEFORE UPDATE ON md_unit FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_md_warehouse_ver BEFORE UPDATE ON md_warehouse FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_md_department_ver BEFORE UPDATE ON md_department FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_md_bank_ver BEFORE UPDATE ON md_bank FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_md_project_ver BEFORE UPDATE ON md_project FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_md_project_budget_ver BEFORE UPDATE ON md_project_budget FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_md_item_account_group_ver BEFORE UPDATE ON md_item_account_group FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_md_item_ver BEFORE UPDATE ON md_item FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_md_item_bom_ver BEFORE UPDATE ON md_item_bom FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_md_item_price_break_ver BEFORE UPDATE ON md_item_price_break FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_md_item_reorder_ver BEFORE UPDATE ON md_item_reorder FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_md_customer_ver BEFORE UPDATE ON md_customer FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_md_customer_ship_to_ver BEFORE UPDATE ON md_customer_ship_to FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_md_supplier_ver BEFORE UPDATE ON md_supplier FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_md_party_contact_ver BEFORE UPDATE ON md_party_contact FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_md_supplier_bank_ver BEFORE UPDATE ON md_supplier_bank FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_md_salesperson_ver BEFORE UPDATE ON md_salesperson FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_md_sales_target_ver BEFORE UPDATE ON md_sales_target FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_md_bank_account_ver BEFORE UPDATE ON md_bank_account FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_md_doc_type_ver BEFORE UPDATE ON md_doc_type FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_md_doc_type_account_ver BEFORE UPDATE ON md_doc_type_account FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_md_payment_method_ver BEFORE UPDATE ON md_payment_method FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_md_doc_number_block_ver BEFORE UPDATE ON md_doc_number_block FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_doc_header_ver BEFORE UPDATE ON doc_header FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_doc_line_ver BEFORE UPDATE ON doc_line FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_doc_note_ver BEFORE UPDATE ON doc_note FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_md_note_ver BEFORE UPDATE ON md_note FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_doc_link_ver BEFORE UPDATE ON doc_link FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_doc_bill_item_ver BEFORE UPDATE ON doc_bill_item FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_doc_settlement_ver BEFORE UPDATE ON doc_settlement FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_doc_payment_ver BEFORE UPDATE ON doc_payment FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_fin_cheque_ver BEFORE UPDATE ON fin_cheque FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_fin_cheque_event_ver BEFORE UPDATE ON fin_cheque_event FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_inv_stock_balance_ver BEFORE UPDATE ON inv_stock_balance FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_inv_stock_count_ver BEFORE UPDATE ON inv_stock_count FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_md_serial_ver BEFORE UPDATE ON md_serial FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_md_serial_service_ver BEFORE UPDATE ON md_serial_service FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_gl_journal_ver BEFORE UPDATE ON gl_journal FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_gl_journal_line_ver BEFORE UPDATE ON gl_journal_line FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_gl_budget_ver BEFORE UPDATE ON gl_budget FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_gl_prior_year_balance_ver BEFORE UPDATE ON gl_prior_year_balance FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_gl_fs_report_ver BEFORE UPDATE ON gl_fs_report FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_gl_fs_line_ver BEFORE UPDATE ON gl_fs_line FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_tax_vat_entry_ver BEFORE UPDATE ON tax_vat_entry FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_tax_wht_entry_ver BEFORE UPDATE ON tax_wht_entry FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_md_asset_account_group_ver BEFORE UPDATE ON md_asset_account_group FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_fa_asset_ver BEFORE UPDATE ON fa_asset FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_fa_depreciation_ver BEFORE UPDATE ON fa_depreciation FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_sync_conflict_ver BEFORE UPDATE ON sync_conflict FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_sys_tenant_ver BEFORE UPDATE ON sys_tenant FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_sys_session_ver BEFORE UPDATE ON sys_session FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_fin_bank_ledger_ver BEFORE UPDATE ON fin_bank_ledger FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_inv_stock_ledger_ver BEFORE UPDATE ON inv_stock_ledger FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_inv_cost_layer_ver BEFORE UPDATE ON inv_cost_layer FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_inv_cost_consumption_ver BEFORE UPDATE ON inv_cost_consumption FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_gl_balance_ver BEFORE UPDATE ON gl_balance FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_sys_company_log AFTER INSERT OR UPDATE ON sys_company FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_sys_branch_log AFTER INSERT OR UPDATE ON sys_branch FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_sys_user_log AFTER INSERT OR UPDATE ON sys_user FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_sys_user_group_log AFTER INSERT OR UPDATE ON sys_user_group FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_sys_user_company_log AFTER INSERT OR UPDATE ON sys_user_company FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_sys_menu_log AFTER INSERT OR UPDATE ON sys_menu FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_sys_permission_log AFTER INSERT OR UPDATE ON sys_permission FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_sys_device_log AFTER INSERT OR UPDATE ON sys_device FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_sys_setting_log AFTER INSERT OR UPDATE ON sys_setting FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_sys_setting_def_log AFTER INSERT OR UPDATE ON sys_setting_def FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_gl_fiscal_year_log AFTER INSERT OR UPDATE ON gl_fiscal_year FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_gl_period_log AFTER INSERT OR UPDATE ON gl_period FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_gl_account_log AFTER INSERT OR UPDATE ON gl_account FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_gl_journal_book_log AFTER INSERT OR UPDATE ON gl_journal_book FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_gl_default_account_log AFTER INSERT OR UPDATE ON gl_default_account FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_gl_journal_route_log AFTER INSERT OR UPDATE ON gl_journal_route FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_gl_posting_rule_log AFTER INSERT OR UPDATE ON gl_posting_rule FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_gl_template_log AFTER INSERT OR UPDATE ON gl_template FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_gl_template_line_log AFTER INSERT OR UPDATE ON gl_template_line FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_md_lookup_type_log AFTER INSERT OR UPDATE ON md_lookup_type FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_md_lookup_log AFTER INSERT OR UPDATE ON md_lookup FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_md_unit_log AFTER INSERT OR UPDATE ON md_unit FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_md_warehouse_log AFTER INSERT OR UPDATE ON md_warehouse FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_md_department_log AFTER INSERT OR UPDATE ON md_department FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_md_bank_log AFTER INSERT OR UPDATE ON md_bank FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_md_project_log AFTER INSERT OR UPDATE ON md_project FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_md_project_budget_log AFTER INSERT OR UPDATE ON md_project_budget FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_md_item_account_group_log AFTER INSERT OR UPDATE ON md_item_account_group FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_md_item_log AFTER INSERT OR UPDATE ON md_item FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_md_item_bom_log AFTER INSERT OR UPDATE ON md_item_bom FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_md_item_price_break_log AFTER INSERT OR UPDATE ON md_item_price_break FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_md_item_reorder_log AFTER INSERT OR UPDATE ON md_item_reorder FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_md_customer_log AFTER INSERT OR UPDATE ON md_customer FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_md_customer_ship_to_log AFTER INSERT OR UPDATE ON md_customer_ship_to FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_md_supplier_log AFTER INSERT OR UPDATE ON md_supplier FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_md_party_contact_log AFTER INSERT OR UPDATE ON md_party_contact FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_md_supplier_bank_log AFTER INSERT OR UPDATE ON md_supplier_bank FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_md_salesperson_log AFTER INSERT OR UPDATE ON md_salesperson FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_md_sales_target_log AFTER INSERT OR UPDATE ON md_sales_target FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_md_bank_account_log AFTER INSERT OR UPDATE ON md_bank_account FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_md_doc_type_log AFTER INSERT OR UPDATE ON md_doc_type FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_md_doc_type_account_log AFTER INSERT OR UPDATE ON md_doc_type_account FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_md_payment_method_log AFTER INSERT OR UPDATE ON md_payment_method FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_md_doc_number_block_log AFTER INSERT OR UPDATE ON md_doc_number_block FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_doc_header_log AFTER INSERT OR UPDATE ON doc_header FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_doc_line_log AFTER INSERT OR UPDATE ON doc_line FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_doc_note_log AFTER INSERT OR UPDATE ON doc_note FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_md_note_log AFTER INSERT OR UPDATE ON md_note FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_doc_link_log AFTER INSERT OR UPDATE ON doc_link FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_doc_bill_item_log AFTER INSERT OR UPDATE ON doc_bill_item FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_doc_settlement_log AFTER INSERT OR UPDATE ON doc_settlement FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_doc_payment_log AFTER INSERT OR UPDATE ON doc_payment FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_fin_cheque_log AFTER INSERT OR UPDATE ON fin_cheque FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_fin_cheque_event_log AFTER INSERT OR UPDATE ON fin_cheque_event FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_inv_stock_balance_log AFTER INSERT OR UPDATE ON inv_stock_balance FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_inv_stock_count_log AFTER INSERT OR UPDATE ON inv_stock_count FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_md_serial_log AFTER INSERT OR UPDATE ON md_serial FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_md_serial_service_log AFTER INSERT OR UPDATE ON md_serial_service FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_gl_journal_log AFTER INSERT OR UPDATE ON gl_journal FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_gl_journal_line_log AFTER INSERT OR UPDATE ON gl_journal_line FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_gl_budget_log AFTER INSERT OR UPDATE ON gl_budget FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_gl_prior_year_balance_log AFTER INSERT OR UPDATE ON gl_prior_year_balance FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_gl_fs_report_log AFTER INSERT OR UPDATE ON gl_fs_report FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_gl_fs_line_log AFTER INSERT OR UPDATE ON gl_fs_line FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_tax_vat_entry_log AFTER INSERT OR UPDATE ON tax_vat_entry FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_tax_wht_entry_log AFTER INSERT OR UPDATE ON tax_wht_entry FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_md_asset_account_group_log AFTER INSERT OR UPDATE ON md_asset_account_group FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_fa_asset_log AFTER INSERT OR UPDATE ON fa_asset FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_fa_depreciation_log AFTER INSERT OR UPDATE ON fa_depreciation FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_sync_conflict_log AFTER INSERT OR UPDATE ON sync_conflict FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE CONSTRAINT TRIGGER trg_gl_journal_balanced AFTER INSERT OR UPDATE ON gl_journal DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gl_check_balanced();
CREATE TRIGGER trg_gl_journal_period BEFORE INSERT OR UPDATE ON gl_journal FOR EACH ROW EXECUTE FUNCTION gl_check_period_open();
CREATE TRIGGER trg_doc_header_period BEFORE INSERT OR UPDATE ON doc_header FOR EACH ROW EXECUTE FUNCTION gl_check_period_open();
CREATE TRIGGER trg_activity_log_ro BEFORE UPDATE OR DELETE ON sys_activity_log FOR EACH ROW EXECUTE FUNCTION sys_append_only();


-- ---------------------------------------------------------------- Views (แทนยอดสะสมที่ Express เก็บในแฟ้มหลัก)
-- ลูกหนี้คงค้างรายใบ (แทน ARMAS.BALANCE / ARTRN.REMAMT) · ยอดตัด (settled) เป็นบวกเสมอ ใบลดหนี้คงค้าง = −(ยอด − ที่ตัดแล้ว) · ไม่นับใบเสร็จ/ใบสำคัญที่ยกเลิก
CREATE OR REPLACE VIEW v_ar_outstanding AS
SELECT h.company_id, h.customer_id, h.id AS header_id, h.doc_class, h.doc_no, h.doc_date, h.due_date,
       CASE WHEN h.doc_class = 'CN' THEN -h.net_amount ELSE h.net_amount END AS amount,
       COALESCE(s.settled, 0) AS settled,
       CASE WHEN h.doc_class = 'CN' THEN -(h.net_amount - COALESCE(s.settled, 0)) ELSE h.net_amount - COALESCE(s.settled, 0) END AS outstanding
FROM doc_header h
LEFT JOIN (SELECT s.invoice_header_id, sum(s.amount) settled FROM doc_settlement s
             LEFT JOIN doc_header p ON p.id = s.payment_header_id LEFT JOIN gl_journal j ON j.id = s.payment_journal_id
            WHERE s.deleted_at IS NULL AND COALESCE(p.doc_status, 'N') <> 'C' AND COALESCE(j.doc_status, 'N') <> 'C' GROUP BY 1) s
       ON s.invoice_header_id = h.id
WHERE h.module = 'AR' AND h.doc_class IN ('IV','DR','CN') AND h.doc_status <> 'C' AND h.deleted_at IS NULL;

-- เจ้าหนี้คงค้างรายใบ
CREATE OR REPLACE VIEW v_ap_outstanding AS
SELECT h.company_id, h.supplier_id, h.id AS header_id, h.doc_class, h.doc_no, h.doc_date, h.due_date,
       CASE WHEN h.doc_class = 'DN' THEN -h.net_amount ELSE h.net_amount END AS amount,
       COALESCE(s.settled, 0) AS settled,
       CASE WHEN h.doc_class = 'DN' THEN -(h.net_amount - COALESCE(s.settled, 0)) ELSE h.net_amount - COALESCE(s.settled, 0) END AS outstanding
FROM doc_header h
LEFT JOIN (SELECT s.invoice_header_id, sum(s.amount) settled FROM doc_settlement s
             LEFT JOIN doc_header p ON p.id = s.payment_header_id LEFT JOIN gl_journal j ON j.id = s.payment_journal_id
            WHERE s.deleted_at IS NULL AND COALESCE(p.doc_status, 'N') <> 'C' AND COALESCE(j.doc_status, 'N') <> 'C' GROUP BY 1) s
       ON s.invoice_header_id = h.id
WHERE h.module = 'AP' AND h.doc_class IN ('RR','CP','DN') AND h.doc_status <> 'C' AND h.deleted_at IS NULL;

-- มัดจำคงเหลือรายใบ (AI/AE) = ยอดมัดจำ (ตามประเภทราคาของใบมัดจำ) − ที่หักในบิลแล้ว (doc_link DEPOSIT ไปเอกสารที่ไม่ยกเลิก)
CREATE OR REPLACE VIEW v_deposit_outstanding AS
SELECT h.company_id, h.module, h.customer_id, h.supplier_id, h.id AS header_id, h.doc_class, h.doc_no, h.doc_date, h.due_date, h.price_type,
       h.amount, COALESCE(u.used, 0) AS used, h.amount - COALESCE(u.used, 0) AS outstanding
FROM doc_header h
LEFT JOIN (SELECT l.from_header_id, sum(l.amount) used FROM doc_link l JOIN doc_header t ON t.id = l.to_header_id
            WHERE l.link_type = 'DEPOSIT' AND l.deleted_at IS NULL AND t.doc_status <> 'C' AND t.deleted_at IS NULL GROUP BY 1) u
       ON u.from_header_id = h.id
WHERE h.doc_class IN ('AI','AE') AND h.doc_status <> 'C' AND h.deleted_at IS NULL;

-- ใบสั่งขาย/ใบสั่งซื้อรายบรรทัด: ยอดค้างส่ง/ค้างรับ = สั่ง − ยกเลิก − ส่งแล้ว (บรรทัดบิลที่อ้าง source_line_id ในเอกสารที่ไม่ยกเลิก)
-- บรรทัดที่ย้ายจาก Express มี remaining_qty (REMQTY ณ วันย้าย) เป็นยอดตั้งต้น
CREATE OR REPLACE VIEW v_order_line AS
SELECT l.company_id, h.id AS header_id, h.doc_class, h.doc_no, h.doc_date, h.customer_id, h.supplier_id, h.price_type,
       l.id AS line_id, l.line_no, l.item_id, l.description, l.warehouse_id, l.unit_id, l.factor, l.unit_price, l.discount_text, l.is_free, l.delivery_date,
       COALESCE(l.ordered_qty, l.qty) AS ordered_qty, COALESCE(l.cancelled_qty, 0) AS cancelled_qty, COALESCE(dl.delivered, 0) AS delivered_qty,
       CASE WHEN l.remaining_qty IS NOT NULL THEN l.remaining_qty - COALESCE(dl.delivered, 0)
            ELSE COALESCE(l.ordered_qty, l.qty) - COALESCE(l.cancelled_qty, 0) - COALESCE(dl.delivered, 0) END AS remaining_qty
FROM doc_line l JOIN doc_header h ON h.id = l.header_id
LEFT JOIN (SELECT s.source_line_id, sum(s.qty) delivered FROM doc_line s JOIN doc_header t ON t.id = s.header_id
            WHERE s.source_line_id IS NOT NULL AND s.deleted_at IS NULL AND t.doc_status <> 'C' AND t.deleted_at IS NULL GROUP BY 1) dl
       ON dl.source_line_id = l.id
WHERE h.doc_class IN ('SO','PO') AND h.doc_status <> 'C' AND h.deleted_at IS NULL AND l.deleted_at IS NULL;

-- ความเคลื่อนไหวสินค้า (สต๊อกการ์ด) จากบรรทัดเอกสาร: จำนวนหน่วยหลัก + มูลค่าต้นทุน (+เข้า −ออก) — movement 8 มูลค่าตามเครื่องหมาย
CREATE OR REPLACE VIEW v_stock_move AS
SELECT h.company_id, l.item_id, l.warehouse_id, h.doc_date, h.id AS header_id, h.doc_class, h.doc_no, l.id AS line_id, l.line_no, l.movement_code,
       l.base_qty * l.stock_effect AS qty,
       CASE WHEN l.movement_code = '8' THEN COALESCE(l.cost_amount, 0) ELSE COALESCE(l.cost_amount, 0) * l.stock_effect END AS value
FROM doc_line l JOIN doc_header h ON h.id = l.header_id
WHERE h.doc_status <> 'C' AND h.deleted_at IS NULL AND l.deleted_at IS NULL AND l.stock_effect <> 0 AND l.item_id IS NOT NULL AND l.warehouse_id IS NOT NULL;

-- ยอดสต๊อกคงเหลือต่อสินค้า×คลัง (แทน STLOC — กติกาข้อ 8 ไม่เก็บยอดสะสม)
CREATE OR REPLACE VIEW v_stock_balance AS
SELECT company_id, item_id, warehouse_id, sum(qty) AS qty, sum(value) AS value, max(doc_date) AS last_move_date
FROM v_stock_move GROUP BY 1, 2, 3;

-- งบทดลองรายงวด (แทน GLBAL)
CREATE OR REPLACE VIEW v_trial_balance AS
SELECT j.company_id, j.period_id, l.account_id, l.department_id,
       sum(l.debit) AS debit, sum(l.credit) AS credit, sum(l.debit - l.credit) AS net
FROM gl_journal j JOIN gl_journal_line l ON l.journal_id = j.id AND l.deleted_at IS NULL
WHERE j.doc_status = 'N' AND j.deleted_at IS NULL
GROUP BY 1,2,3,4;

-- ยอดคงเหลือสินค้าจากบัญชีคุมสินค้า (ตรวจกับ inv_stock_balance)
CREATE OR REPLACE VIEW v_stock_from_ledger AS
SELECT company_id, item_id, warehouse_id, sum(qty) AS qty, sum(value) AS value
FROM inv_stock_ledger WHERE deleted_at IS NULL GROUP BY 1,2,3;

