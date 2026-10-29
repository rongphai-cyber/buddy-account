-- =====================================================================
-- ฐานข้อมูลเครื่องลูก (ทำงานออฟไลน์) — SQLite 3.35+
-- สร้างอัตโนมัติจาก spec.py — ตารางเหมือนเซิร์ฟเวอร์ทุกคอลัมน์ (ชื่อเดียวกัน) เพื่อให้ซิงก์ตรงตัว
-- ชนิดข้อมูล: uuid/ข้อความ/วันที่ = TEXT (ISO-8601), จำนวนเงิน/จำนวน = TEXT ทศนิยมแบบตรงตัว (เช่น "1234.50")
--             ห้ามเก็บเงินเป็น REAL เพราะทศนิยมคลาดเคลื่อน; boolean = INTEGER 0/1
-- =====================================================================
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- sys_company: บริษัท (หนึ่งฐานข้อมูลรองรับหลายบริษัท)
CREATE TABLE IF NOT EXISTS sys_company (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name_th TEXT NOT NULL,
  name_en TEXT,
  address_th TEXT,
  address_en TEXT,
  phone TEXT,
  tax_id TEXT,
  trade_reg_no TEXT,
  social_security_no TEXT,
  base_currency TEXT NOT NULL DEFAULT 'THB',
  year_system TEXT NOT NULL DEFAULT 'B' CHECK (year_system IN ('B','C')),
  status TEXT NOT NULL DEFAULT 'A' CHECK (status IN ('A','I')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sys_company_code ON sys_company (code) WHERE deleted_at IS NULL;

-- sys_branch: สาขา / จุดทำงาน (สำนักงานใหญ่ สาขา โรงแรมแต่ละแห่ง)
CREATE TABLE IF NOT EXISTS sys_branch (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  tax_branch_no TEXT NOT NULL DEFAULT '00000',
  address TEXT,
  is_head_office INTEGER NOT NULL DEFAULT 0,
  default_warehouse_id TEXT REFERENCES md_warehouse(id) DEFERRABLE INITIALLY DEFERRED,
  status TEXT NOT NULL DEFAULT 'A' CHECK (status IN ('A','I')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sys_branch_company_code ON sys_branch (company_id, code) WHERE deleted_at IS NULL;

-- sys_user: ผู้ใช้งาน
CREATE TABLE IF NOT EXISTS sys_user (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT,
  user_group_id TEXT REFERENCES sys_user_group(id) DEFERRABLE INITIALLY DEFERRED,
  approval_level INTEGER NOT NULL DEFAULT 0 CHECK (approval_level BETWEEN 0 AND 9),
  check_rights INTEGER NOT NULL DEFAULT 0,
  menu_language TEXT NOT NULL DEFAULT 'th',
  default_printer TEXT,
  status TEXT NOT NULL DEFAULT 'A' CHECK (status IN ('A','I')),
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sys_user_username ON sys_user (username) WHERE deleted_at IS NULL;

-- sys_user_group: กลุ่มผู้ใช้
CREATE TABLE IF NOT EXISTS sys_user_group (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sys_user_group_tenant_code ON sys_user_group (IFNULL(tenant_id,''), code) WHERE deleted_at IS NULL;

-- sys_user_company: ผู้ใช้ ↔ บริษัท/สาขาที่เข้าได้
CREATE TABLE IF NOT EXISTS sys_user_company (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  user_id TEXT NOT NULL REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  branch_id TEXT REFERENCES sys_branch(id) DEFERRABLE INITIALLY DEFERRED,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sys_user_company_company_user_branch ON sys_user_company (company_id, user_id, IFNULL(branch_id,'')) WHERE deleted_at IS NULL;

-- sys_menu: รายการเมนู/ฟังก์ชันที่ใช้กำหนดสิทธิ์
CREATE TABLE IF NOT EXISTS sys_menu (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  name_th TEXT NOT NULL,
  name_en TEXT,
  parent_id TEXT REFERENCES sys_menu(id) DEFERRABLE INITIALLY DEFERRED,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sys_menu_code ON sys_menu (code) WHERE deleted_at IS NULL;

-- sys_permission: สิทธิ์ 7 ชนิดต่อ ผู้ใช้/กลุ่ม × บริษัท × เมนู
CREATE TABLE IF NOT EXISTS sys_permission (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('U','G')),
  subject_id TEXT NOT NULL,
  menu_id TEXT NOT NULL REFERENCES sys_menu(id) DEFERRABLE INITIALLY DEFERRED,
  can_read TEXT NOT NULL DEFAULT 'N',
  can_add TEXT NOT NULL DEFAULT 'N',
  can_edit TEXT NOT NULL DEFAULT 'N',
  can_cancel TEXT NOT NULL DEFAULT 'N',
  can_delete TEXT NOT NULL DEFAULT 'N',
  can_print TEXT NOT NULL DEFAULT 'N',
  can_approve TEXT NOT NULL DEFAULT 'N',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sys_permission_company_subject_type_subject_menu ON sys_permission (company_id, subject_type, subject_id, menu_id) WHERE deleted_at IS NULL;

-- sys_device: เครื่อง/อุปกรณ์ที่ลงทะเบียนใช้งานออฟไลน์
CREATE TABLE IF NOT EXISTS sys_device (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  branch_id TEXT NOT NULL REFERENCES sys_branch(id) DEFERRABLE INITIALLY DEFERRED,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'desktop',
  public_key TEXT,
  last_sync_at TEXT,
  last_pull_seq INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'A' CHECK (status IN ('A','I')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sys_device_company_code ON sys_device (company_id, code) WHERE deleted_at IS NULL;

-- sys_setting: ค่าเริ่มต้นของระบบแบบ key–value (แทนฟิลด์ 244 ช่องใน ISINFO)
CREATE TABLE IF NOT EXISTS sys_setting (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  branch_id TEXT REFERENCES sys_branch(id) DEFERRABLE INITIALLY DEFERRED,
  module TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sys_setting_company_branch_key ON sys_setting (company_id, IFNULL(branch_id,''), key) WHERE deleted_at IS NULL;

-- sys_setting_def: นิยามค่าเริ่มต้นแต่ละตัว (ชนิด ค่า default และฟิลด์ต้นทางใน Express)
CREATE TABLE IF NOT EXISTS sys_setting_def (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  module TEXT NOT NULL,
  data_type TEXT NOT NULL,
  default_value TEXT,
  label_th TEXT NOT NULL,
  express_field TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sys_setting_def_key ON sys_setting_def (key) WHERE deleted_at IS NULL;

-- sys_print_form: แบบฟอร์มพิมพ์เอกสารที่ผู้ใช้กำหนด (ฟอร์ม 1–9 ต่อชนิดเอกสาร) — แทนภาษารายงานของ Express
CREATE TABLE IF NOT EXISTS sys_print_form (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  scope TEXT NOT NULL,
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 9),
  name TEXT NOT NULL,
  base TEXT NOT NULL DEFAULT 'grid',
  layout TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'A' CHECK (status IN ('A','I')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sys_print_form_company_scope_slot ON sys_print_form (company_id, scope, slot) WHERE deleted_at IS NULL;

-- sys_report_custom: รายงานที่ผู้ใช้สร้างจากรายงานต้นฉบับ (เงื่อนไข + คอลัมน์ที่แสดง)
CREATE TABLE IF NOT EXISTS sys_report_custom (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  code TEXT NOT NULL,
  base_code TEXT NOT NULL,
  name TEXT NOT NULL,
  params TEXT NOT NULL,
  hidden_cols TEXT,
  landscape INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sys_report_custom_company_code ON sys_report_custom (company_id, code) WHERE deleted_at IS NULL;

-- gl_fiscal_year: ปีบัญชี
CREATE TABLE IF NOT EXISTS gl_fiscal_year (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  code TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'O' CHECK (status IN ('O','C')),
  closed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gl_fiscal_year_company_code ON gl_fiscal_year (company_id, code) WHERE deleted_at IS NULL;

-- gl_period: งวดบัญชี (เดือน) และสถานะปิดงวด
CREATE TABLE IF NOT EXISTS gl_period (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  fiscal_year_id TEXT NOT NULL REFERENCES gl_fiscal_year(id) DEFERRABLE INITIALLY DEFERRED,
  period_no INTEGER NOT NULL CHECK (period_no BETWEEN 1 AND 13),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  is_locked INTEGER NOT NULL DEFAULT 0,
  locked_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  locked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gl_period_company_fiscal_year_period_no ON gl_period (company_id, fiscal_year_id, period_no) WHERE deleted_at IS NULL;

-- gl_account: ผังบัญชี
CREATE TABLE IF NOT EXISTS gl_account (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  account_no TEXT NOT NULL,
  name_th TEXT NOT NULL,
  name_en TEXT,
  parent_id TEXT REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED,
  level INTEGER NOT NULL DEFAULT 1,
  account_group TEXT NOT NULL CHECK (account_group IN ('1','2','3','4','5')),
  is_control INTEGER NOT NULL DEFAULT 0,
  normal_side TEXT NOT NULL CHECK (normal_side IN ('D','C')),
  use_department INTEGER NOT NULL DEFAULT 0,
  use_project INTEGER NOT NULL DEFAULT 0,
  consol_account TEXT,
  status TEXT NOT NULL DEFAULT 'A' CHECK (status IN ('A','I')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gl_account_company_account_no ON gl_account (company_id, account_no) WHERE deleted_at IS NULL;

-- gl_journal_book: สมุดรายวัน (00 ทั่วไป 01 จ่าย 02 รับ 03 ขาย 04 ซื้อ …)
CREATE TABLE IF NOT EXISTS gl_journal_book (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  code TEXT NOT NULL,
  prefix TEXT NOT NULL,
  name_th TEXT NOT NULL,
  name_en TEXT,
  template_id TEXT REFERENCES gl_template(id) DEFERRABLE INITIALLY DEFERRED,
  approve_level INTEGER NOT NULL DEFAULT 0,
  approve_method TEXT,
  reprint_level INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gl_journal_book_company_code ON gl_journal_book (company_id, code) WHERE deleted_at IS NULL;

-- gl_default_account: บัญชีมาตรฐานสำหรับลงบัญชีอัตโนมัติ (34 บทบาท) — ชั้นที่ 3 ของการหาบัญชี
CREATE TABLE IF NOT EXISTS gl_default_account (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  role TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gl_default_account_company_role ON gl_default_account (company_id, role) WHERE deleted_at IS NULL;

-- gl_journal_route: ประเภทรายการ → สมุดรายวันที่ใช้ลงบัญชี
CREATE TABLE IF NOT EXISTS gl_journal_route (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  txn_kind TEXT NOT NULL,
  journal_book_id TEXT NOT NULL REFERENCES gl_journal_book(id) DEFERRABLE INITIALLY DEFERRED,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gl_journal_route_company_txn_kind ON gl_journal_route (company_id, txn_kind) WHERE deleted_at IS NULL;

-- gl_posting_rule: กฎการลงบัญชีอัตโนมัติ: เอกสารแต่ละชนิดลง Dr/Cr บทบาทใด ด้วยยอดใด
CREATE TABLE IF NOT EXISTS gl_posting_rule (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  doc_class TEXT NOT NULL,
  seq INTEGER NOT NULL,
  condition TEXT,
  side TEXT NOT NULL CHECK (side IN ('D','C')),
  account_role TEXT NOT NULL,
  amount_source TEXT NOT NULL,
  per TEXT NOT NULL DEFAULT 'H' CHECK (per IN ('H','L','P','S')),
  description TEXT,
  is_assumed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gl_posting_rule_company_doc_class_seq ON gl_posting_rule (company_id, doc_class, seq) WHERE deleted_at IS NULL;

-- gl_template: แม่แบบรายการบัญชี
CREATE TABLE IF NOT EXISTS gl_template (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  name_en TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gl_template_company_code ON gl_template (company_id, code) WHERE deleted_at IS NULL;

-- gl_template_line: บรรทัดของแม่แบบ
CREATE TABLE IF NOT EXISTS gl_template_line (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  template_id TEXT NOT NULL REFERENCES gl_template(id) DEFERRABLE INITIALLY DEFERRED,
  line_no INTEGER NOT NULL,
  account_id TEXT REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED,
  department_id TEXT REFERENCES md_department(id) DEFERRABLE INITIALLY DEFERRED,
  description TEXT,
  side TEXT NOT NULL CHECK (side IN ('D','C')),
  amount TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gl_template_line_template_line_no ON gl_template_line (template_id, line_no) WHERE deleted_at IS NULL;

-- md_lookup_type: ชนิดตารางอ้างอิง (TABTYP)
CREATE TABLE IF NOT EXISTS md_lookup_type (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  name_th TEXT NOT NULL,
  has_rate INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_md_lookup_type_code ON md_lookup_type (code) WHERE deleted_at IS NULL;

-- md_lookup: ตารางอ้างอิงทั่วไป (หมวดสินค้า เขตการขาย ขนส่งโดย เหตุผลยกเลิก ประเภทลูกค้า ฯลฯ)
CREATE TABLE IF NOT EXISTS md_lookup (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  type_code TEXT NOT NULL,
  code TEXT NOT NULL,
  short_th TEXT,
  short_en TEXT,
  name_th TEXT NOT NULL,
  name_en TEXT,
  rate TEXT,
  status TEXT NOT NULL DEFAULT 'A' CHECK (status IN ('A','I')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_md_lookup_company_type_code_code ON md_lookup (company_id, type_code, code) WHERE deleted_at IS NULL;

-- md_unit: หน่วยนับ
CREATE TABLE IF NOT EXISTS md_unit (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  code TEXT NOT NULL,
  name_th TEXT NOT NULL,
  name_en TEXT,
  short_th TEXT,
  short_en TEXT,
  rate TEXT,
  status TEXT NOT NULL DEFAULT 'A' CHECK (status IN ('A','I')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_md_unit_company_code ON md_unit (company_id, code) WHERE deleted_at IS NULL;

-- md_warehouse: คลังสินค้า
CREATE TABLE IF NOT EXISTS md_warehouse (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  code TEXT NOT NULL,
  name_th TEXT NOT NULL,
  name_en TEXT,
  short_th TEXT,
  short_en TEXT,
  branch_id TEXT REFERENCES sys_branch(id) DEFERRABLE INITIALLY DEFERRED,
  status TEXT NOT NULL DEFAULT 'A' CHECK (status IN ('A','I')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_md_warehouse_company_code ON md_warehouse (company_id, code) WHERE deleted_at IS NULL;

-- md_department: แผนก / ศูนย์ต้นทุน
CREATE TABLE IF NOT EXISTS md_department (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  code TEXT NOT NULL,
  name_th TEXT NOT NULL,
  name_en TEXT,
  short_name_th TEXT,
  short_name_en TEXT,
  status TEXT NOT NULL DEFAULT 'A' CHECK (status IN ('A','I')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_md_department_company_code ON md_department (company_id, code) WHERE deleted_at IS NULL;

-- md_bank: ธนาคาร
CREATE TABLE IF NOT EXISTS md_bank (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  code TEXT NOT NULL,
  name_th TEXT NOT NULL,
  name_en TEXT,
  short_th TEXT,
  short_en TEXT,
  status TEXT NOT NULL DEFAULT 'A' CHECK (status IN ('A','I')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_md_bank_company_code ON md_bank (company_id, code) WHERE deleted_at IS NULL;

-- md_project: โครงการ / Job
CREATE TABLE IF NOT EXISTS md_project (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  code TEXT NOT NULL,
  name_th TEXT NOT NULL,
  name_en TEXT,
  customer_id TEXT REFERENCES md_customer(id) DEFERRABLE INITIALLY DEFERRED,
  start_date TEXT,
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'A' CHECK (status IN ('A','I')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_md_project_company_code ON md_project (company_id, code) WHERE deleted_at IS NULL;

-- md_project_budget: งบประมาณโครงการแยกขั้นตอน/รหัสต้นทุน
CREATE TABLE IF NOT EXISTS md_project_budget (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  project_id TEXT NOT NULL REFERENCES md_project(id) DEFERRABLE INITIALLY DEFERRED,
  phase TEXT,
  cost_code TEXT,
  est_expense TEXT,
  est_revenue TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_md_project_budget_project_phase_cost_code ON md_project_budget (project_id, phase, cost_code) WHERE deleted_at IS NULL;

-- md_item_account_group: กลุ่มบัญชีสินค้า — ชั้นที่ 2 ของการหาบัญชีสำหรับสินค้า
CREATE TABLE IF NOT EXISTS md_item_account_group (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  code TEXT NOT NULL,
  name_th TEXT NOT NULL,
  name_en TEXT,
  cost_method TEXT CHECK (cost_method IS NULL OR cost_method IN ('F','A')),
  item_specific INTEGER NOT NULL DEFAULT 0,
  inventory_account_id TEXT REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED,
  cogs_account_id TEXT REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED,
  sales_account_id TEXT REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED,
  sales_return_account_id TEXT REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED,
  purchase_account_id TEXT REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED,
  purchase_return_account_id TEXT REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_md_item_account_group_company_code ON md_item_account_group (company_id, code) WHERE deleted_at IS NULL;

-- md_item: สินค้า / บริการ / รหัสค่าใช้จ่ายอื่น / รหัสรายได้อื่น
CREATE TABLE IF NOT EXISTS md_item (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  code TEXT NOT NULL,
  item_type TEXT NOT NULL DEFAULT '0' CHECK (item_type IN ('0','1','2','3','4','5')),
  barcode TEXT,
  name_th TEXT NOT NULL,
  name_en TEXT,
  item_level TEXT,
  category_code TEXT,
  account_group_id TEXT REFERENCES md_item_account_group(id) DEFERRABLE INITIALLY DEFERRED,
  base_unit_id TEXT REFERENCES md_unit(id) DEFERRABLE INITIALLY DEFERRED,
  count_unit_id TEXT REFERENCES md_unit(id) DEFERRABLE INITIALLY DEFERRED,
  count_factor TEXT,
  purchase_unit_id TEXT REFERENCES md_unit(id) DEFERRABLE INITIALLY DEFERRED,
  purchase_factor TEXT NOT NULL DEFAULT '1',
  sales_unit_id TEXT REFERENCES md_unit(id) DEFERRABLE INITIALLY DEFERRED,
  sales_factor TEXT NOT NULL DEFAULT '1',
  std_cost TEXT,
  price_1 TEXT,
  price_2 TEXT,
  price_3 TEXT,
  price_4 TEXT,
  price_5 TEXT,
  vat_code TEXT,
  allow_negative TEXT,
  default_supplier_id TEXT REFERENCES md_supplier(id) DEFERRABLE INITIALLY DEFERRED,
  substitute_item_id TEXT REFERENCES md_item(id) DEFERRABLE INITIALLY DEFERRED,
  packing TEXT,
  udf_1 TEXT,
  udf_2 TEXT,
  udf_3 TEXT,
  udf_4 TEXT,
  udf_date_1 TEXT,
  udf_date_2 TEXT,
  udf_num_1 TEXT,
  remark TEXT,
  status TEXT NOT NULL DEFAULT 'A' CHECK (status IN ('A','I')),
  inactive_date TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_md_item_company_code ON md_item (company_id, code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_md_item_company_barcode ON md_item (company_id, barcode);
CREATE INDEX IF NOT EXISTS ix_md_item_company_name_th ON md_item (company_id, name_th);

-- md_item_bom: ส่วนประกอบสินค้าชุด
CREATE TABLE IF NOT EXISTS md_item_bom (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  parent_item_id TEXT NOT NULL REFERENCES md_item(id) DEFERRABLE INITIALLY DEFERRED,
  line_no INTEGER NOT NULL,
  component_item_id TEXT NOT NULL REFERENCES md_item(id) DEFERRABLE INITIALLY DEFERRED,
  qty TEXT NOT NULL,
  std_cost TEXT,
  sell_price TEXT,
  warehouse_id TEXT REFERENCES md_warehouse(id) DEFERRABLE INITIALLY DEFERRED,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_md_item_bom_parent_item_line_no ON md_item_bom (parent_item_id, line_no) WHERE deleted_at IS NULL;

-- md_item_price_break: ตารางราคาตามปริมาณ/ช่วงเวลา
CREATE TABLE IF NOT EXISTS md_item_price_break (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  item_id TEXT NOT NULL REFERENCES md_item(id) DEFERRABLE INITIALLY DEFERRED,
  unit_id TEXT REFERENCES md_unit(id) DEFERRABLE INITIALLY DEFERRED,
  factor TEXT,
  min_qty TEXT NOT NULL,
  is_percent INTEGER NOT NULL DEFAULT 0,
  price_1 TEXT,
  price_2 TEXT,
  price_3 TEXT,
  price_4 TEXT,
  price_5 TEXT,
  start_date TEXT,
  end_date TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);

-- md_item_reorder: จุดสั่งซื้อแยกคลัง/ช่วงเวลา
CREATE TABLE IF NOT EXISTS md_item_reorder (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  item_id TEXT NOT NULL REFERENCES md_item(id) DEFERRABLE INITIALLY DEFERRED,
  warehouse_id TEXT NOT NULL REFERENCES md_warehouse(id) DEFERRABLE INITIALLY DEFERRED,
  start_mmdd TEXT NOT NULL,
  min_qty TEXT,
  max_qty TEXT,
  order_qty TEXT,
  projected_sales TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_md_item_reorder_item_warehouse_start_mmdd ON md_item_reorder (item_id, warehouse_id, start_mmdd) WHERE deleted_at IS NULL;

-- md_customer: ลูกค้า
CREATE TABLE IF NOT EXISTS md_customer (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  code TEXT NOT NULL,
  customer_type TEXT,
  title TEXT,
  name TEXT NOT NULL,
  name_en TEXT,
  address_1 TEXT,
  address_2 TEXT,
  address_3 TEXT,
  zip_code TEXT,
  phone TEXT,
  email TEXT,
  contact TEXT,
  tax_id TEXT,
  tax_branch_no TEXT,
  salesperson_id TEXT REFERENCES md_salesperson(id) DEFERRABLE INITIALLY DEFERRED,
  sales_area_code TEXT,
  ship_via_code TEXT,
  credit_days INTEGER,
  payment_terms TEXT,
  price_level TEXT,
  discount_text TEXT,
  credit_limit TEXT,
  ar_account_id TEXT REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED,
  payer_id TEXT REFERENCES md_customer(id) DEFERRABLE INITIALLY DEFERRED,
  wht_form TEXT,
  wht_rate TEXT,
  wht_category TEXT,
  wht_condition TEXT,
  default_ship_to TEXT,
  track_sales TEXT,
  remark TEXT,
  status TEXT NOT NULL DEFAULT 'A' CHECK (status IN ('A','I')),
  inactive_date TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_md_customer_company_code ON md_customer (company_id, code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_md_customer_company_name ON md_customer (company_id, name);

-- md_customer_ship_to: สถานที่ส่งของของลูกค้า
CREATE TABLE IF NOT EXISTS md_customer_ship_to (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  customer_id TEXT REFERENCES md_customer(id) DEFERRABLE INITIALLY DEFERRED,
  code TEXT NOT NULL,
  address_1 TEXT,
  address_2 TEXT,
  address_3 TEXT,
  zip_code TEXT,
  phone TEXT,
  contact TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_md_customer_ship_to_company_customer_code ON md_customer_ship_to (company_id, IFNULL(customer_id,''), code) WHERE deleted_at IS NULL;

-- md_supplier: ผู้จำหน่าย / เจ้าหนี้
CREATE TABLE IF NOT EXISTS md_supplier (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  code TEXT NOT NULL,
  supplier_type TEXT,
  title TEXT,
  name TEXT NOT NULL,
  name_en TEXT,
  address_1 TEXT,
  address_2 TEXT,
  address_3 TEXT,
  zip_code TEXT,
  phone TEXT,
  contact TEXT,
  tax_id TEXT,
  tax_branch_no TEXT,
  price_type TEXT,
  vat_rate TEXT,
  ship_via_code TEXT,
  credit_days INTEGER,
  payment_terms TEXT,
  discount_text TEXT,
  credit_limit TEXT,
  ap_account_id TEXT REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED,
  wht_form TEXT,
  wht_income_desc TEXT,
  wht_rate TEXT,
  wht_condition TEXT,
  on_hold INTEGER NOT NULL DEFAULT 0,
  remark TEXT,
  status TEXT NOT NULL DEFAULT 'A' CHECK (status IN ('A','I')),
  inactive_date TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_md_supplier_company_code ON md_supplier (company_id, code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_md_supplier_company_name ON md_supplier (company_id, name);

-- md_party_contact: ผู้ติดต่อของลูกค้า/ผู้จำหน่าย (ข้อเสนอ: หลายคน — Express มีช่องเดียว)
CREATE TABLE IF NOT EXISTS md_party_contact (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  party_type TEXT NOT NULL CHECK (party_type IN ('C','S')),
  party_id TEXT NOT NULL,
  line_no INTEGER NOT NULL,
  name TEXT NOT NULL,
  position TEXT,
  phone TEXT,
  email TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_md_party_contact_company_party_type_party_line_no ON md_party_contact (company_id, party_type, party_id, line_no) WHERE deleted_at IS NULL;

-- md_supplier_bank: บัญชีธนาคารของผู้จำหน่าย (ข้อเสนอ: ใช้โอนจ่ายชำระหนี้)
CREATE TABLE IF NOT EXISTS md_supplier_bank (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  supplier_id TEXT NOT NULL REFERENCES md_supplier(id) DEFERRABLE INITIALLY DEFERRED,
  line_no INTEGER NOT NULL,
  bank_code TEXT NOT NULL,
  branch TEXT,
  account_no TEXT NOT NULL,
  account_name TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_md_supplier_bank_company_supplier_line_no ON md_supplier_bank (company_id, supplier_id, line_no) WHERE deleted_at IS NULL;

-- md_salesperson: พนักงานขาย
CREATE TABLE IF NOT EXISTS md_salesperson (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  position TEXT,
  salesperson_type TEXT,
  sales_area_code TEXT,
  commission_rate TEXT,
  address TEXT,
  zip_code TEXT,
  phone TEXT,
  tax_id TEXT,
  social_security_no TEXT,
  status TEXT NOT NULL DEFAULT 'A' CHECK (status IN ('A','I')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_md_salesperson_company_code ON md_salesperson (company_id, code) WHERE deleted_at IS NULL;

-- md_sales_target: เป้าการขายรายงวด
CREATE TABLE IF NOT EXISTS md_sales_target (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  salesperson_id TEXT NOT NULL REFERENCES md_salesperson(id) DEFERRABLE INITIALLY DEFERRED,
  period_id TEXT NOT NULL REFERENCES gl_period(id) DEFERRABLE INITIALLY DEFERRED,
  target_amount TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_md_sales_target_salesperson_period ON md_sales_target (salesperson_id, period_id) WHERE deleted_at IS NULL;

-- md_bank_account: บัญชีเงินฝากของกิจการ
CREATE TABLE IF NOT EXISTS md_bank_account (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  code TEXT NOT NULL,
  bank_id TEXT REFERENCES md_bank(id) DEFERRABLE INITIALLY DEFERRED,
  name TEXT NOT NULL,
  branch TEXT,
  short_name TEXT,
  account_number TEXT,
  account_kind TEXT,
  gl_account_id TEXT REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED,
  currency TEXT NOT NULL DEFAULT 'THB',
  opening_balance TEXT,
  opening_date TEXT,
  status TEXT NOT NULL DEFAULT 'A' CHECK (status IN ('A','I')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_md_bank_account_company_code ON md_bank_account (company_id, code) WHERE deleted_at IS NULL;

-- md_doc_type: ประเภทเอกสารและพฤติกรรม (prefix สมุดรายวัน อนุมัติ บัญชี)
CREATE TABLE IF NOT EXISTS md_doc_type (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  code TEXT NOT NULL,
  doc_class TEXT NOT NULL,
  module TEXT NOT NULL,
  name_th TEXT NOT NULL,
  name_en TEXT,
  short_name TEXT,
  next_no INTEGER NOT NULL DEFAULT 1,
  journal_book_id TEXT REFERENCES gl_journal_book(id) DEFERRABLE INITIALLY DEFERRED,
  journal_desc_template TEXT,
  department_id TEXT REFERENCES md_department(id) DEFERRABLE INITIALLY DEFERRED,
  warehouse_id TEXT REFERENCES md_warehouse(id) DEFERRABLE INITIALLY DEFERRED,
  price_type TEXT,
  vat_rate TEXT,
  vat_basis TEXT,
  vat_per_line INTEGER NOT NULL DEFAULT 0,
  approve_method TEXT,
  approve_level INTEGER,
  reprint_level INTEGER,
  cancel_level INTEGER,
  delete_level INTEGER,
  over_limit_level INTEGER,
  auto_print INTEGER NOT NULL DEFAULT 0,
  form_no INTEGER,
  use_barcode INTEGER NOT NULL DEFAULT 0,
  is_tax_invoice INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'A' CHECK (status IN ('A','I')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_md_doc_type_company_code ON md_doc_type (company_id, code) WHERE deleted_at IS NULL;

-- md_doc_type_account: บัญชีที่กำหนดไว้ที่ประเภทเอกสาร — ชั้นที่ 1 ของการหาบัญชี
CREATE TABLE IF NOT EXISTS md_doc_type_account (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  doc_type_id TEXT NOT NULL REFERENCES md_doc_type(id) DEFERRABLE INITIALLY DEFERRED,
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 12),
  role TEXT,
  account_id TEXT NOT NULL REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_md_doc_type_account_doc_type_slot ON md_doc_type_account (doc_type_id, slot) WHERE deleted_at IS NULL;

-- md_payment_method: วิธีรับ/จ่ายเงิน (เงินสด เช็ค โอน หัก ณ ที่จ่าย ส่วนลด ฯลฯ)
CREATE TABLE IF NOT EXISTS md_payment_method (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  direction TEXT NOT NULL CHECK (direction IN ('R','P')),
  code TEXT NOT NULL,
  seq TEXT,
  name_th TEXT NOT NULL,
  name_en TEXT,
  kind TEXT NOT NULL DEFAULT 'OTHER',
  gl_account_id TEXT REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED,
  bank_account_id TEXT REFERENCES md_bank_account(id) DEFERRABLE INITIALLY DEFERRED,
  creates_cheque INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'A' CHECK (status IN ('A','I')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_md_payment_method_company_direction_code ON md_payment_method (company_id, direction, code) WHERE deleted_at IS NULL;

-- md_doc_number_block: ช่วงเลขที่เอกสารที่จองให้แต่ละเครื่อง — ออกเลขได้ตอนออฟไลน์โดยไม่ซ้ำ
CREATE TABLE IF NOT EXISTS md_doc_number_block (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  doc_type_id TEXT NOT NULL REFERENCES md_doc_type(id) DEFERRABLE INITIALLY DEFERRED,
  branch_id TEXT NOT NULL REFERENCES sys_branch(id) DEFERRABLE INITIALLY DEFERRED,
  device_id TEXT REFERENCES sys_device(id) DEFERRABLE INITIALLY DEFERRED,
  series TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT '{prefix}{yy}{mm}-{seq:5}',
  range_start INTEGER NOT NULL,
  range_end INTEGER NOT NULL,
  next_no INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'A' CHECK (status IN ('A','F','X')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_md_doc_number_block_doc_type_branch_series_range_start ON md_doc_number_block (doc_type_id, IFNULL(branch_id,''), series, range_start) WHERE deleted_at IS NULL;

-- doc_header: หัวเอกสารทุกชนิด (ขาย ซื้อ สั่งขาย สั่งซื้อ สินค้า การเงิน เงินสดย่อย)
CREATE TABLE IF NOT EXISTS doc_header (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  branch_id TEXT NOT NULL REFERENCES sys_branch(id) DEFERRABLE INITIALLY DEFERRED,
  doc_type_id TEXT NOT NULL REFERENCES md_doc_type(id) DEFERRABLE INITIALLY DEFERRED,
  doc_class TEXT NOT NULL,
  module TEXT NOT NULL,
  express_rectype TEXT,
  doc_no TEXT NOT NULL,
  is_provisional_no INTEGER NOT NULL DEFAULT 0,
  doc_date TEXT NOT NULL,
  period_id TEXT REFERENCES gl_period(id) DEFERRABLE INITIALLY DEFERRED,
  customer_id TEXT REFERENCES md_customer(id) DEFERRABLE INITIALLY DEFERRED,
  supplier_id TEXT REFERENCES md_supplier(id) DEFERRABLE INITIALLY DEFERRED,
  bill_to_customer_id TEXT REFERENCES md_customer(id) DEFERRABLE INITIALLY DEFERRED,
  ship_to_id TEXT REFERENCES md_customer_ship_to(id) DEFERRABLE INITIALLY DEFERRED,
  party_tax_id TEXT,
  party_tax_branch_no TEXT,
  party_name TEXT,
  party_address TEXT,
  salesperson_id TEXT REFERENCES md_salesperson(id) DEFERRABLE INITIALLY DEFERRED,
  department_id TEXT REFERENCES md_department(id) DEFERRABLE INITIALLY DEFERRED,
  project_id TEXT REFERENCES md_project(id) DEFERRABLE INITIALLY DEFERRED,
  sales_area_code TEXT,
  ship_via_code TEXT,
  warehouse_id TEXT REFERENCES md_warehouse(id) DEFERRABLE INITIALLY DEFERRED,
  to_warehouse_id TEXT REFERENCES md_warehouse(id) DEFERRABLE INITIALLY DEFERRED,
  bank_account_id TEXT REFERENCES md_bank_account(id) DEFERRABLE INITIALLY DEFERRED,
  to_bank_account_id TEXT REFERENCES md_bank_account(id) DEFERRABLE INITIALLY DEFERRED,
  your_ref TEXT,
  ref_no TEXT,
  ref_date TEXT,
  credit_days INTEGER,
  due_date TEXT,
  delivery_date TEXT,
  delivery_date_per_line INTEGER NOT NULL DEFAULT 0,
  price_type TEXT NOT NULL DEFAULT '2' CHECK (price_type IN ('0','1','2')),
  currency TEXT NOT NULL DEFAULT 'THB',
  exchange_rate TEXT NOT NULL DEFAULT '1',
  amount TEXT NOT NULL DEFAULT '0',
  discount_text TEXT,
  discount_amount TEXT NOT NULL DEFAULT '0',
  amount_after_discount TEXT NOT NULL DEFAULT '0',
  deposit_amount TEXT NOT NULL DEFAULT '0',
  zero_rate_amount TEXT NOT NULL DEFAULT '0',
  taxable_amount TEXT NOT NULL DEFAULT '0',
  vat_rate TEXT,
  vat_amount TEXT NOT NULL DEFAULT '0',
  net_amount TEXT NOT NULL DEFAULT '0',
  wht_amount TEXT NOT NULL DEFAULT '0',
  cash_amount TEXT NOT NULL DEFAULT '0',
  cheque_amount TEXT NOT NULL DEFAULT '0',
  interest_amount TEXT NOT NULL DEFAULT '0',
  cash_discount_amount TEXT NOT NULL DEFAULT '0',
  settled_amount TEXT NOT NULL DEFAULT '0',
  outstanding_amount TEXT NOT NULL DEFAULT '0',
  commission_amount TEXT NOT NULL DEFAULT '0',
  vat_basis TEXT,
  vat_date TEXT,
  vat_period_id TEXT REFERENCES gl_period(id) DEFERRABLE INITIALLY DEFERRED,
  vat_late INTEGER NOT NULL DEFAULT 0,
  doc_status TEXT NOT NULL DEFAULT 'N' CHECK (doc_status IN ('D','N','M','C')),
  status_code TEXT,
  is_settled INTEGER NOT NULL DEFAULT 0,
  settled_date TEXT,
  appointment_date TEXT,
  payment_date TEXT,
  is_opening INTEGER NOT NULL DEFAULT 0,
  payment_terms TEXT,
  remark TEXT,
  gl_posted TEXT NOT NULL DEFAULT 'N',
  journal_id TEXT REFERENCES gl_journal(id) DEFERRABLE INITIALLY DEFERRED,
  approved_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  approved_at TEXT,
  auth_user_id TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  print_count INTEGER NOT NULL DEFAULT 0,
  last_printed_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  last_printed_at TEXT,
  cancel_reason TEXT,
  device_id TEXT REFERENCES sys_device(id) DEFERRABLE INITIALLY DEFERRED,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_doc_header_company_doc_type_doc_no ON doc_header (company_id, doc_type_id, doc_no) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_doc_header_company_doc_class_doc_date ON doc_header (company_id, doc_class, doc_date);
CREATE INDEX IF NOT EXISTS ix_doc_header_company_customer_doc_date ON doc_header (company_id, customer_id, doc_date);
CREATE INDEX IF NOT EXISTS ix_doc_header_company_supplier_doc_date ON doc_header (company_id, supplier_id, doc_date);
CREATE INDEX IF NOT EXISTS ix_doc_header_company_doc_no ON doc_header (company_id, doc_no);

-- doc_line: บรรทัดรายการของเอกสาร (สินค้า บริการ ค่าใช้จ่าย บัญชี)
CREATE TABLE IF NOT EXISTS doc_line (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  header_id TEXT NOT NULL REFERENCES doc_header(id) DEFERRABLE INITIALLY DEFERRED,
  line_no INTEGER NOT NULL,
  line_kind TEXT NOT NULL DEFAULT 'I' CHECK (line_kind IN ('I','G','T','K')),
  item_id TEXT REFERENCES md_item(id) DEFERRABLE INITIALLY DEFERRED,
  account_id TEXT REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED,
  description TEXT,
  warehouse_id TEXT REFERENCES md_warehouse(id) DEFERRABLE INITIALLY DEFERRED,
  department_id TEXT REFERENCES md_department(id) DEFERRABLE INITIALLY DEFERRED,
  project_id TEXT REFERENCES md_project(id) DEFERRABLE INITIALLY DEFERRED,
  project_phase TEXT,
  cost_code TEXT,
  qty TEXT NOT NULL DEFAULT '0',
  unit_id TEXT REFERENCES md_unit(id) DEFERRABLE INITIALLY DEFERRED,
  factor TEXT NOT NULL DEFAULT '1',
  base_qty TEXT NOT NULL DEFAULT '0',
  unit_price TEXT NOT NULL DEFAULT '0',
  discount_text TEXT,
  discount_amount TEXT NOT NULL DEFAULT '0',
  line_amount TEXT NOT NULL DEFAULT '0',
  net_amount TEXT NOT NULL DEFAULT '0',
  vat_code TEXT,
  is_free INTEGER NOT NULL DEFAULT 0,
  return_to_stock INTEGER,
  stock_effect INTEGER NOT NULL DEFAULT 0 CHECK (stock_effect IN (-1,0,1)),
  movement_code TEXT,
  cost_unit TEXT,
  cost_amount TEXT,
  sales_value TEXT,
  source_line_id TEXT REFERENCES doc_line(id) DEFERRABLE INITIALLY DEFERRED,
  party_customer_id TEXT REFERENCES md_customer(id) DEFERRABLE INITIALLY DEFERRED,
  party_supplier_id TEXT REFERENCES md_supplier(id) DEFERRABLE INITIALLY DEFERRED,
  salesperson_id TEXT REFERENCES md_salesperson(id) DEFERRABLE INITIALLY DEFERRED,
  ordered_qty TEXT,
  remaining_qty TEXT,
  cancelled_qty TEXT,
  cancel_reason_code TEXT,
  cancel_date TEXT,
  delivery_date TEXT,
  gl_debit_account_id TEXT REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED,
  gl_credit_account_id TEXT REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED,
  packing TEXT,
  reimburse_flag TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_doc_line_header_line_no ON doc_line (header_id, line_no) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_doc_line_item_warehouse ON doc_line (item_id, warehouse_id);
CREATE INDEX IF NOT EXISTS ix_doc_line_source_line ON doc_line (source_line_id);

-- doc_note: หมายเหตุเพิ่มเติมของเอกสาร/บรรทัด (สูงสุด 10 บรรทัด)
CREATE TABLE IF NOT EXISTS doc_note (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  header_id TEXT NOT NULL REFERENCES doc_header(id) DEFERRABLE INITIALLY DEFERRED,
  line_id TEXT REFERENCES doc_line(id) DEFERRABLE INITIALLY DEFERRED,
  seq INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_doc_note_header_line_seq ON doc_note (header_id, IFNULL(line_id,''), seq) WHERE deleted_at IS NULL;

-- md_note: หมายเหตุเพิ่มเติมของแฟ้มหลัก (สินค้า ลูกค้า ผู้จำหน่าย) สูงสุด 10 บรรทัด
CREATE TABLE IF NOT EXISTS md_note (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('ITEM','CUSTOMER','SUPPLIER')),
  entity_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_md_note_entity_type_entity_seq ON md_note (entity_type, entity_id, seq) WHERE deleted_at IS NULL;

-- doc_link: ความสัมพันธ์ระหว่างเอกสาร (อ้างถึง/แปลง/หักมัดจำ/ลดหนี้)
CREATE TABLE IF NOT EXISTS doc_link (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  from_header_id TEXT NOT NULL REFERENCES doc_header(id) DEFERRABLE INITIALLY DEFERRED,
  to_header_id TEXT NOT NULL REFERENCES doc_header(id) DEFERRABLE INITIALLY DEFERRED,
  link_type TEXT NOT NULL,
  amount TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_doc_link_from_header_to_header_link_type ON doc_link (from_header_id, to_header_id, link_type) WHERE deleted_at IS NULL;

-- doc_bill_item: รายการใบกำกับในใบวางบิล / ใบรับวางบิล
CREATE TABLE IF NOT EXISTS doc_bill_item (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  bill_header_id TEXT NOT NULL REFERENCES doc_header(id) DEFERRABLE INITIALLY DEFERRED,
  invoice_header_id TEXT NOT NULL REFERENCES doc_header(id) DEFERRABLE INITIALLY DEFERRED,
  amount TEXT NOT NULL,
  vat_amount TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_doc_bill_item_bill_header_invoice_header ON doc_bill_item (bill_header_id, invoice_header_id) WHERE deleted_at IS NULL;

-- doc_settlement: การตัดชำระหนี้ (ใบเสร็จ RE / ใบสำคัญจ่าย PS ตัดใบกำกับใด เท่าใด)
CREATE TABLE IF NOT EXISTS doc_settlement (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  payment_header_id TEXT REFERENCES doc_header(id) DEFERRABLE INITIALLY DEFERRED,
  payment_journal_id TEXT REFERENCES gl_journal(id) DEFERRABLE INITIALLY DEFERRED,
  invoice_header_id TEXT NOT NULL REFERENCES doc_header(id) DEFERRABLE INITIALLY DEFERRED,
  express_rectype TEXT,
  amount TEXT NOT NULL,
  vat_amount TEXT NOT NULL DEFAULT '0',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_doc_settlement_payment_header_payment_journal_invoice_header ON doc_settlement (IFNULL(payment_header_id,''), IFNULL(payment_journal_id,''), invoice_header_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_doc_settlement_invoice_header ON doc_settlement (invoice_header_id);

-- doc_payment: วิธีรับ/จ่ายเงินของเอกสาร (เงินสด เช็ค โอน หัก ณ ที่จ่าย …)
CREATE TABLE IF NOT EXISTS doc_payment (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  header_id TEXT NOT NULL REFERENCES doc_header(id) DEFERRABLE INITIALLY DEFERRED,
  line_no INTEGER NOT NULL,
  payment_method_id TEXT NOT NULL REFERENCES md_payment_method(id) DEFERRABLE INITIALLY DEFERRED,
  reference_no TEXT,
  amount TEXT NOT NULL,
  cheque_id TEXT REFERENCES fin_cheque(id) DEFERRABLE INITIALLY DEFERRED,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_doc_payment_header_line_no ON doc_payment (header_id, line_no) WHERE deleted_at IS NULL;

-- fin_cheque: ทะเบียนเช็ครับ/เช็คจ่าย และรายการโอนผ่านธนาคาร
CREATE TABLE IF NOT EXISTS fin_cheque (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  branch_id TEXT REFERENCES sys_branch(id) DEFERRABLE INITIALLY DEFERRED,
  direction TEXT NOT NULL CHECK (direction IN ('R','P')),
  instrument TEXT NOT NULL,
  cheque_no TEXT NOT NULL,
  cheque_date TEXT NOT NULL,
  bank_id TEXT REFERENCES md_bank(id) DEFERRABLE INITIALLY DEFERRED,
  bank_branch TEXT,
  bank_account_id TEXT REFERENCES md_bank_account(id) DEFERRABLE INITIALLY DEFERRED,
  customer_id TEXT REFERENCES md_customer(id) DEFERRABLE INITIALLY DEFERRED,
  supplier_id TEXT REFERENCES md_supplier(id) DEFERRABLE INITIALLY DEFERRED,
  payee_name TEXT,
  department_id TEXT REFERENCES md_department(id) DEFERRABLE INITIALLY DEFERRED,
  received_date TEXT,
  deposit_date TEXT,
  pass_date TEXT,
  amount TEXT NOT NULL,
  charge TEXT NOT NULL DEFAULT '0',
  net_amount TEXT NOT NULL,
  remaining_amount TEXT NOT NULL DEFAULT '0',
  written_off_amount TEXT NOT NULL DEFAULT '0',
  writeoff_journal_id TEXT REFERENCES gl_journal(id) DEFERRABLE INITIALLY DEFERRED,
  status TEXT NOT NULL,
  is_settled INTEGER NOT NULL DEFAULT 0,
  source_header_id TEXT REFERENCES doc_header(id) DEFERRABLE INITIALLY DEFERRED,
  source_journal_id TEXT REFERENCES gl_journal(id) DEFERRABLE INITIALLY DEFERRED,
  deposit_header_id TEXT REFERENCES doc_header(id) DEFERRABLE INITIALLY DEFERRED,
  pass_journal_id TEXT REFERENCES gl_journal(id) DEFERRABLE INITIALLY DEFERRED,
  remark TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_cheque_company_direction_cheque_no_bank_account ON fin_cheque (company_id, direction, cheque_no, IFNULL(bank_account_id,'')) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_fin_cheque_company_status_cheque_date ON fin_cheque (company_id, status, cheque_date);

-- fin_cheque_event: ประวัติสถานะเช็ค (นำฝาก ผ่าน คืน ยื่นใหม่ ขายลด)
CREATE TABLE IF NOT EXISTS fin_cheque_event (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  cheque_id TEXT NOT NULL REFERENCES fin_cheque(id) DEFERRABLE INITIALLY DEFERRED,
  event_date TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  reason TEXT,
  header_id TEXT REFERENCES doc_header(id) DEFERRABLE INITIALLY DEFERRED,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);

-- inv_stock_balance: ยอดคงเหลือปัจจุบันต่อสินค้า×คลัง (สรุปจาก ledger; client ใช้แบบอ่านอย่างเดียว)
CREATE TABLE IF NOT EXISTS inv_stock_balance (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  item_id TEXT NOT NULL REFERENCES md_item(id) DEFERRABLE INITIALLY DEFERRED,
  warehouse_id TEXT NOT NULL REFERENCES md_warehouse(id) DEFERRABLE INITIALLY DEFERRED,
  qty_on_hand TEXT NOT NULL DEFAULT '0',
  value_on_hand TEXT NOT NULL DEFAULT '0',
  avg_cost TEXT,
  qty_on_order TEXT NOT NULL DEFAULT '0',
  qty_reserved TEXT NOT NULL DEFAULT '0',
  qty_offline_pending TEXT NOT NULL DEFAULT '0',
  last_purchase_date TEXT,
  last_sale_date TEXT,
  last_move_date TEXT,
  last_count_date TEXT,
  shelf TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_stock_balance_company_item_warehouse ON inv_stock_balance (company_id, item_id, warehouse_id) WHERE deleted_at IS NULL;

-- inv_stock_count: ผลการตรวจนับสินค้า
CREATE TABLE IF NOT EXISTS inv_stock_count (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  warehouse_id TEXT NOT NULL REFERENCES md_warehouse(id) DEFERRABLE INITIALLY DEFERRED,
  item_id TEXT NOT NULL REFERENCES md_item(id) DEFERRABLE INITIALLY DEFERRED,
  count_date TEXT NOT NULL,
  shelf TEXT,
  counted_qty TEXT,
  counted_unit_qty TEXT,
  system_qty TEXT,
  diff_qty TEXT,
  flag TEXT NOT NULL DEFAULT '1',
  adjust_line_id TEXT REFERENCES doc_line(id) DEFERRABLE INITIALLY DEFERRED,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_stock_count_company_warehouse_item_count_date ON inv_stock_count (company_id, warehouse_id, item_id, count_date) WHERE deleted_at IS NULL;

-- md_serial: ทะเบียนหมายเลขเครื่อง/Serial และการรับประกัน
CREATE TABLE IF NOT EXISTS md_serial (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  serial_no TEXT NOT NULL,
  machine_no TEXT,
  category_code TEXT,
  item_id TEXT REFERENCES md_item(id) DEFERRABLE INITIALLY DEFERRED,
  sale_line_id TEXT REFERENCES doc_line(id) DEFERRABLE INITIALLY DEFERRED,
  sale_date TEXT,
  warranty_end TEXT,
  customer_id TEXT REFERENCES md_customer(id) DEFERRABLE INITIALLY DEFERRED,
  description TEXT,
  ref_code TEXT,
  customer_name TEXT,
  salesperson_id TEXT REFERENCES md_salesperson(id) DEFERRABLE INITIALLY DEFERRED,
  print_count INTEGER NOT NULL DEFAULT 0,
  last_printed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_md_serial_company_serial_no ON md_serial (company_id, serial_no) WHERE deleted_at IS NULL;

-- md_serial_service: ประวัติการซ่อม/บริการของ Serial
CREATE TABLE IF NOT EXISTS md_serial_service (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  serial_id TEXT NOT NULL REFERENCES md_serial(id) DEFERRABLE INITIALLY DEFERRED,
  service_date TEXT NOT NULL,
  service_by TEXT,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);

-- gl_journal: ใบสำคัญ / รายการสมุดรายวัน (ทั้งบันทึกเองและที่ระบบอื่นส่งมา)
CREATE TABLE IF NOT EXISTS gl_journal (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  branch_id TEXT REFERENCES sys_branch(id) DEFERRABLE INITIALLY DEFERRED,
  journal_book_id TEXT NOT NULL REFERENCES gl_journal_book(id) DEFERRABLE INITIALLY DEFERRED,
  voucher_no TEXT NOT NULL,
  voucher_date TEXT NOT NULL,
  period_id TEXT NOT NULL REFERENCES gl_period(id) DEFERRABLE INITIALLY DEFERRED,
  description TEXT,
  reference TEXT,
  source_module TEXT,
  source_header_id TEXT REFERENCES doc_header(id) DEFERRABLE INITIALLY DEFERRED,
  status TEXT NOT NULL DEFAULT 'U' CHECK (status IN ('U','P')),
  doc_status TEXT NOT NULL DEFAULT 'N' CHECK (doc_status IN ('N','C')),
  reversal_of_id TEXT REFERENCES gl_journal(id) DEFERRABLE INITIALLY DEFERRED,
  posted_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  posted_at TEXT,
  total_debit TEXT NOT NULL DEFAULT '0',
  total_credit TEXT NOT NULL DEFAULT '0',
  print_count INTEGER NOT NULL DEFAULT 0,
  approved_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  approved_at TEXT,
  last_printed_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  last_printed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gl_journal_company_journal_book_voucher_no ON gl_journal (company_id, journal_book_id, voucher_no) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_gl_journal_company_voucher_date ON gl_journal (company_id, voucher_date);
CREATE INDEX IF NOT EXISTS ix_gl_journal_source_header ON gl_journal (source_header_id);

-- gl_journal_line: รายการเดบิต/เครดิตของใบสำคัญ
CREATE TABLE IF NOT EXISTS gl_journal_line (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  journal_id TEXT NOT NULL REFERENCES gl_journal(id) DEFERRABLE INITIALLY DEFERRED,
  line_no INTEGER NOT NULL,
  account_id TEXT NOT NULL REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED,
  department_id TEXT REFERENCES md_department(id) DEFERRABLE INITIALLY DEFERRED,
  project_id TEXT REFERENCES md_project(id) DEFERRABLE INITIALLY DEFERRED,
  project_phase TEXT,
  cost_code TEXT,
  description TEXT,
  bank_cleared_date TEXT,
  debit TEXT NOT NULL DEFAULT '0',
  credit TEXT NOT NULL DEFAULT '0',
  posting_role TEXT,
  resolved_from TEXT,
  changed_from_account_id TEXT REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT,
  CHECK (CAST(debit AS NUMERIC) >= 0 AND CAST(credit AS NUMERIC) >= 0 AND (CAST(debit AS NUMERIC) = 0 OR CAST(credit AS NUMERIC) = 0))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gl_journal_line_journal_line_no ON gl_journal_line (journal_id, line_no) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_gl_journal_line_account ON gl_journal_line (account_id);

-- gl_inventory_balance: บัญชีสินค้าคงเหลือ (Periodic) — ยอดคงเหลือปลายงวดที่ผู้ใช้ยืนยัน ใช้ในงบการเงินแทนยอดบัญชี
CREATE TABLE IF NOT EXISTS gl_inventory_balance (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  fiscal_year_id TEXT NOT NULL REFERENCES gl_fiscal_year(id) DEFERRABLE INITIALLY DEFERRED,
  account_id TEXT NOT NULL REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED,
  department_id TEXT REFERENCES md_department(id) DEFERRABLE INITIALLY DEFERRED,
  period_no INTEGER NOT NULL,
  amount TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'M' CHECK (source IN ('M','S')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE INDEX IF NOT EXISTS ix_gl_inventory_balance_company_fiscal_year_account ON gl_inventory_balance (company_id, fiscal_year_id, account_id);

-- fin_bank_statement: ยอดตามใบแจ้งยอดธนาคาร (Bank statement) สำหรับกระทบยอดเงินฝาก
CREATE TABLE IF NOT EXISTS fin_bank_statement (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  bank_account_id TEXT NOT NULL REFERENCES md_bank_account(id) DEFERRABLE INITIALLY DEFERRED,
  statement_date TEXT NOT NULL,
  closing_balance TEXT NOT NULL,
  remark TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_bank_statement_company_bank_account_statement_date ON fin_bank_statement (company_id, IFNULL(bank_account_id,''), statement_date) WHERE deleted_at IS NULL;

-- gl_budget: งบประมาณรายงวด
CREATE TABLE IF NOT EXISTS gl_budget (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  account_id TEXT NOT NULL REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED,
  department_id TEXT REFERENCES md_department(id) DEFERRABLE INITIALLY DEFERRED,
  period_id TEXT NOT NULL REFERENCES gl_period(id) DEFERRABLE INITIALLY DEFERRED,
  amount TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gl_budget_company_account_department_period ON gl_budget (company_id, account_id, IFNULL(department_id,''), period_id) WHERE deleted_at IS NULL;

-- gl_prior_year_balance: ยอดปีที่แล้วที่ป้อนเอง (คู่มือบทที่ 15 S-GL-16) — ใช้กับปีที่ไม่มีใบสำคัญในระบบ (เริ่มใช้กลางปี/ย้ายจากโปรแกรมอื่น) สำหรับงบเปรียบเทียบเท่านั้น ไม่ยกไปปีถัดไป
CREATE TABLE IF NOT EXISTS gl_prior_year_balance (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  fiscal_year_id TEXT NOT NULL REFERENCES gl_fiscal_year(id) DEFERRABLE INITIALLY DEFERRED,
  account_id TEXT NOT NULL REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED,
  department_id TEXT REFERENCES md_department(id) DEFERRABLE INITIALLY DEFERRED,
  period_no INTEGER NOT NULL CHECK (period_no BETWEEN 0 AND 12),
  debit TEXT NOT NULL DEFAULT '0',
  credit TEXT NOT NULL DEFAULT '0',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);

-- gl_fs_report: แบบงบการเงินที่ผู้ใช้สร้าง
CREATE TABLE IF NOT EXISTS gl_fs_report (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  header_lines TEXT,
  columns TEXT,
  line_set_code TEXT,
  number_format TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gl_fs_report_company_code ON gl_fs_report (company_id, code) WHERE deleted_at IS NULL;

-- gl_fs_line: บรรทัดของงบการเงิน
CREATE TABLE IF NOT EXISTS gl_fs_line (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  line_set_code TEXT NOT NULL,
  line_no INTEGER NOT NULL,
  data_type TEXT NOT NULL,
  source TEXT,
  sign_filter TEXT,
  description_th TEXT,
  description_en TEXT,
  print_condition TEXT,
  accumulate TEXT,
  department_id TEXT REFERENCES md_department(id) DEFERRABLE INITIALLY DEFERRED,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gl_fs_line_company_line_set_code_line_no ON gl_fs_line (company_id, line_set_code, line_no) WHERE deleted_at IS NULL;

-- tax_vat_entry: ทะเบียนภาษีซื้อ/ภาษีขาย (รายงานภาษี ภ.พ.30)
CREATE TABLE IF NOT EXISTS tax_vat_entry (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  vat_kind TEXT NOT NULL CHECK (vat_kind IN ('P','S')),
  header_id TEXT REFERENCES doc_header(id) DEFERRABLE INITIALLY DEFERRED,
  journal_id TEXT REFERENCES gl_journal(id) DEFERRABLE INITIALLY DEFERRED,
  branch_id TEXT REFERENCES sys_branch(id) DEFERRABLE INITIALLY DEFERRED,
  doc_no TEXT NOT NULL,
  doc_date TEXT NOT NULL,
  tax_invoice_no TEXT,
  tax_invoice_date TEXT NOT NULL,
  vat_period_id TEXT NOT NULL REFERENCES gl_period(id) DEFERRABLE INITIALLY DEFERRED,
  is_late INTEGER NOT NULL DEFAULT 0,
  department_id TEXT REFERENCES md_department(id) DEFERRABLE INITIALLY DEFERRED,
  description TEXT,
  party_name TEXT,
  party_tax_id TEXT,
  party_tax_branch_no TEXT,
  base_amount TEXT NOT NULL DEFAULT '0',
  vat_amount TEXT NOT NULL DEFAULT '0',
  zero_rate_amount TEXT NOT NULL DEFAULT '0',
  nonclaim_base TEXT NOT NULL DEFAULT '0',
  nonclaim_vat TEXT NOT NULL DEFAULT '0',
  is_manual INTEGER NOT NULL DEFAULT 0,
  is_modified INTEGER NOT NULL DEFAULT 0,
  doc_status TEXT NOT NULL DEFAULT 'N' CHECK (doc_status IN ('N','C')),
  remark TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE INDEX IF NOT EXISTS ix_tax_vat_entry_company_vat_kind_vat_period_tax_invoice_date ON tax_vat_entry (company_id, vat_kind, vat_period_id, tax_invoice_date);

-- tax_wht_entry: ทะเบียนภาษีหัก ณ ที่จ่าย / หนังสือรับรอง 50 ทวิ
CREATE TABLE IF NOT EXISTS tax_wht_entry (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  form_type TEXT NOT NULL,
  header_id TEXT REFERENCES doc_header(id) DEFERRABLE INITIALLY DEFERRED,
  branch_id TEXT REFERENCES sys_branch(id) DEFERRABLE INITIALLY DEFERRED,
  certificate_no TEXT,
  certificate_date TEXT NOT NULL,
  tax_period_id TEXT NOT NULL REFERENCES gl_period(id) DEFERRABLE INITIALLY DEFERRED,
  is_late INTEGER NOT NULL DEFAULT 0,
  supplier_id TEXT REFERENCES md_supplier(id) DEFERRABLE INITIALLY DEFERRED,
  customer_id TEXT REFERENCES md_customer(id) DEFERRABLE INITIALLY DEFERRED,
  payee_name TEXT NOT NULL,
  payee_address TEXT,
  payee_tax_id TEXT,
  payee_tax_branch_no TEXT,
  income_type TEXT,
  paid_amount TEXT NOT NULL,
  rate TEXT NOT NULL,
  tax_amount TEXT NOT NULL,
  condition TEXT,
  social_security_amount TEXT,
  provident_fund_amount TEXT,
  department_id TEXT REFERENCES md_department(id) DEFERRABLE INITIALLY DEFERRED,
  print_count INTEGER NOT NULL DEFAULT 0,
  doc_status TEXT NOT NULL DEFAULT 'N' CHECK (doc_status IN ('N','C')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE INDEX IF NOT EXISTS ix_tax_wht_entry_company_form_type_tax_period ON tax_wht_entry (company_id, form_type, tax_period_id);

-- md_asset_account_group: กลุ่มบัญชีทรัพย์สิน
CREATE TABLE IF NOT EXISTS md_asset_account_group (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  code TEXT NOT NULL,
  name_th TEXT NOT NULL,
  name_en TEXT,
  asset_account_id TEXT REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED,
  depr_expense_account_id TEXT REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED,
  accum_depr_account_id TEXT REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_md_asset_account_group_company_code ON md_asset_account_group (company_id, code) WHERE deleted_at IS NULL;

-- fa_asset: ทะเบียนทรัพย์สินถาวร
CREATE TABLE IF NOT EXISTS fa_asset (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  code TEXT NOT NULL,
  name_th TEXT NOT NULL,
  name_en TEXT,
  category_code TEXT,
  account_group_id TEXT NOT NULL REFERENCES md_asset_account_group(id) DEFERRABLE INITIALLY DEFERRED,
  is_depreciable INTEGER NOT NULL DEFAULT 1,
  serial_no TEXT,
  department_id TEXT REFERENCES md_department(id) DEFERRABLE INITIALLY DEFERRED,
  branch_id TEXT REFERENCES sys_branch(id) DEFERRABLE INITIALLY DEFERRED,
  purchase_date TEXT NOT NULL,
  cost TEXT NOT NULL,
  salvage_value TEXT NOT NULL DEFAULT '1',
  method TEXT NOT NULL DEFAULT '1' CHECK (method IN ('0','1','2')),
  start_date TEXT NOT NULL,
  useful_life_years INTEGER,
  rate TEXT,
  end_date TEXT,
  depr_monthly INTEGER NOT NULL DEFAULT 1,
  accum_depr_bf TEXT NOT NULL DEFAULT '0',
  accum_bf_date TEXT,
  manual_depr TEXT NOT NULL DEFAULT '0',
  manual_depr_to TEXT,
  sold_date TEXT,
  sold_amount TEXT,
  sold_header_id TEXT REFERENCES doc_header(id) DEFERRABLE INITIALLY DEFERRED,
  status TEXT NOT NULL DEFAULT 'A' CHECK (status IN ('A','S','I')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fa_asset_company_code ON fa_asset (company_id, code) WHERE deleted_at IS NULL;

-- fa_depreciation: ค่าเสื่อมราคารายงวดของทรัพย์สิน
CREATE TABLE IF NOT EXISTS fa_depreciation (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  asset_id TEXT NOT NULL REFERENCES fa_asset(id) DEFERRABLE INITIALLY DEFERRED,
  period_id TEXT NOT NULL REFERENCES gl_period(id) DEFERRABLE INITIALLY DEFERRED,
  amount TEXT NOT NULL,
  journal_id TEXT REFERENCES gl_journal(id) DEFERRABLE INITIALLY DEFERRED,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fa_depreciation_asset_period ON fa_depreciation (asset_id, period_id) WHERE deleted_at IS NULL;

-- sync_conflict: ความขัดแย้งที่ต้องให้คนตัดสิน
CREATE TABLE IF NOT EXISTS sync_conflict (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED,
  table_name TEXT NOT NULL,
  row_id TEXT NOT NULL,
  device_id TEXT REFERENCES sys_device(id) DEFERRABLE INITIALLY DEFERRED,
  server_version INTEGER,
  client_version INTEGER,
  client_payload TEXT NOT NULL,
  reason TEXT NOT NULL,
  resolution TEXT,
  resolved_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED,
  row_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  origin_device_id TEXT
);

-- sync_outbox: (เครื่องลูก) คิวรายการที่บันทึกตอนออฟไลน์ รอส่งขึ้นเซิร์ฟเวอร์ตามลำดับ
CREATE TABLE IF NOT EXISTS sync_outbox (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL,
  table_name TEXT NOT NULL,
  row_id TEXT NOT NULL,
  op TEXT NOT NULL,
  base_version INTEGER,
  payload TEXT NOT NULL,
  tx_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PENDING',
  last_error TEXT
);

-- sync_state: (เครื่องลูก) สถานะการซิงก์ของเครื่องนี้
CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- ---------------------------------------------------------------- Outbox triggers
-- ทุกการเพิ่ม/แก้ในเครื่องลูกจะถูกคิวลง sync_outbox อัตโนมัติ
-- ตอนนำข้อมูลจากเซิร์ฟเวอร์เข้ามา ให้แอปตั้ง sync_state('applying_remote')='1' ก่อน เพื่อไม่ให้คิวกลับขึ้นไป
-- แอปตั้ง sync_state('current_tx') = id ของหัวเอกสาร ก่อนบันทึกหัว+บรรทัด เพื่อให้ส่งเป็นชุดเดียวกัน
CREATE TRIGGER IF NOT EXISTS trg_sys_company_insert_outbox AFTER INSERT ON sys_company
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'sys_company', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'tenant_id', NEW.tenant_id, 'code', NEW.code, 'name_th', NEW.name_th, 'name_en', NEW.name_en, 'address_th', NEW.address_th, 'address_en', NEW.address_en, 'phone', NEW.phone, 'tax_id', NEW.tax_id, 'trade_reg_no', NEW.trade_reg_no, 'social_security_no', NEW.social_security_no, 'base_currency', NEW.base_currency, 'year_system', NEW.year_system, 'status', NEW.status, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_sys_company_update_outbox AFTER UPDATE ON sys_company
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'sys_company', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'tenant_id', NEW.tenant_id, 'code', NEW.code, 'name_th', NEW.name_th, 'name_en', NEW.name_en, 'address_th', NEW.address_th, 'address_en', NEW.address_en, 'phone', NEW.phone, 'tax_id', NEW.tax_id, 'trade_reg_no', NEW.trade_reg_no, 'social_security_no', NEW.social_security_no, 'base_currency', NEW.base_currency, 'year_system', NEW.year_system, 'status', NEW.status, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_sys_company_ver AFTER UPDATE ON sys_company
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE sys_company SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_sys_branch_insert_outbox AFTER INSERT ON sys_branch
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'sys_branch', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'code', NEW.code, 'name', NEW.name, 'tax_branch_no', NEW.tax_branch_no, 'address', NEW.address, 'is_head_office', NEW.is_head_office, 'default_warehouse_id', NEW.default_warehouse_id, 'status', NEW.status, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_sys_branch_update_outbox AFTER UPDATE ON sys_branch
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'sys_branch', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'code', NEW.code, 'name', NEW.name, 'tax_branch_no', NEW.tax_branch_no, 'address', NEW.address, 'is_head_office', NEW.is_head_office, 'default_warehouse_id', NEW.default_warehouse_id, 'status', NEW.status, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_sys_branch_ver AFTER UPDATE ON sys_branch
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE sys_branch SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_sys_user_insert_outbox AFTER INSERT ON sys_user
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'sys_user', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'tenant_id', NEW.tenant_id, 'username', NEW.username, 'display_name', NEW.display_name, 'password_hash', NEW.password_hash, 'user_group_id', NEW.user_group_id, 'approval_level', NEW.approval_level, 'check_rights', NEW.check_rights, 'menu_language', NEW.menu_language, 'default_printer', NEW.default_printer, 'status', NEW.status, 'last_login_at', NEW.last_login_at, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_sys_user_update_outbox AFTER UPDATE ON sys_user
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'sys_user', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'tenant_id', NEW.tenant_id, 'username', NEW.username, 'display_name', NEW.display_name, 'password_hash', NEW.password_hash, 'user_group_id', NEW.user_group_id, 'approval_level', NEW.approval_level, 'check_rights', NEW.check_rights, 'menu_language', NEW.menu_language, 'default_printer', NEW.default_printer, 'status', NEW.status, 'last_login_at', NEW.last_login_at, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_sys_user_ver AFTER UPDATE ON sys_user
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE sys_user SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_sys_user_group_insert_outbox AFTER INSERT ON sys_user_group
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'sys_user_group', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'tenant_id', NEW.tenant_id, 'code', NEW.code, 'name', NEW.name, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_sys_user_group_update_outbox AFTER UPDATE ON sys_user_group
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'sys_user_group', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'tenant_id', NEW.tenant_id, 'code', NEW.code, 'name', NEW.name, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_sys_user_group_ver AFTER UPDATE ON sys_user_group
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE sys_user_group SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_sys_user_company_insert_outbox AFTER INSERT ON sys_user_company
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'sys_user_company', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'user_id', NEW.user_id, 'branch_id', NEW.branch_id, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_sys_user_company_update_outbox AFTER UPDATE ON sys_user_company
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'sys_user_company', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'user_id', NEW.user_id, 'branch_id', NEW.branch_id, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_sys_user_company_ver AFTER UPDATE ON sys_user_company
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE sys_user_company SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_sys_menu_insert_outbox AFTER INSERT ON sys_menu
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'sys_menu', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'code', NEW.code, 'name_th', NEW.name_th, 'name_en', NEW.name_en, 'parent_id', NEW.parent_id, 'sort_order', NEW.sort_order, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_sys_menu_update_outbox AFTER UPDATE ON sys_menu
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'sys_menu', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'code', NEW.code, 'name_th', NEW.name_th, 'name_en', NEW.name_en, 'parent_id', NEW.parent_id, 'sort_order', NEW.sort_order, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_sys_menu_ver AFTER UPDATE ON sys_menu
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE sys_menu SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_sys_permission_insert_outbox AFTER INSERT ON sys_permission
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'sys_permission', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'subject_type', NEW.subject_type, 'subject_id', NEW.subject_id, 'menu_id', NEW.menu_id, 'can_read', NEW.can_read, 'can_add', NEW.can_add, 'can_edit', NEW.can_edit, 'can_cancel', NEW.can_cancel, 'can_delete', NEW.can_delete, 'can_print', NEW.can_print, 'can_approve', NEW.can_approve, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_sys_permission_update_outbox AFTER UPDATE ON sys_permission
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'sys_permission', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'subject_type', NEW.subject_type, 'subject_id', NEW.subject_id, 'menu_id', NEW.menu_id, 'can_read', NEW.can_read, 'can_add', NEW.can_add, 'can_edit', NEW.can_edit, 'can_cancel', NEW.can_cancel, 'can_delete', NEW.can_delete, 'can_print', NEW.can_print, 'can_approve', NEW.can_approve, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_sys_permission_ver AFTER UPDATE ON sys_permission
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE sys_permission SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_sys_device_insert_outbox AFTER INSERT ON sys_device
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'sys_device', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'branch_id', NEW.branch_id, 'code', NEW.code, 'name', NEW.name, 'kind', NEW.kind, 'public_key', NEW.public_key, 'last_sync_at', NEW.last_sync_at, 'last_pull_seq', NEW.last_pull_seq, 'status', NEW.status, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_sys_device_update_outbox AFTER UPDATE ON sys_device
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'sys_device', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'branch_id', NEW.branch_id, 'code', NEW.code, 'name', NEW.name, 'kind', NEW.kind, 'public_key', NEW.public_key, 'last_sync_at', NEW.last_sync_at, 'last_pull_seq', NEW.last_pull_seq, 'status', NEW.status, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_sys_device_ver AFTER UPDATE ON sys_device
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE sys_device SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_sys_setting_insert_outbox AFTER INSERT ON sys_setting
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'sys_setting', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'branch_id', NEW.branch_id, 'module', NEW.module, 'key', NEW.key, 'value', NEW.value, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_sys_setting_update_outbox AFTER UPDATE ON sys_setting
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'sys_setting', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'branch_id', NEW.branch_id, 'module', NEW.module, 'key', NEW.key, 'value', NEW.value, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_sys_setting_ver AFTER UPDATE ON sys_setting
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE sys_setting SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_sys_setting_def_insert_outbox AFTER INSERT ON sys_setting_def
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'sys_setting_def', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'key', NEW.key, 'module', NEW.module, 'data_type', NEW.data_type, 'default_value', NEW.default_value, 'label_th', NEW.label_th, 'express_field', NEW.express_field, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_sys_setting_def_update_outbox AFTER UPDATE ON sys_setting_def
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'sys_setting_def', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'key', NEW.key, 'module', NEW.module, 'data_type', NEW.data_type, 'default_value', NEW.default_value, 'label_th', NEW.label_th, 'express_field', NEW.express_field, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_sys_setting_def_ver AFTER UPDATE ON sys_setting_def
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE sys_setting_def SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_sys_print_form_insert_outbox AFTER INSERT ON sys_print_form
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'sys_print_form', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'scope', NEW.scope, 'slot', NEW.slot, 'name', NEW.name, 'base', NEW.base, 'layout', NEW.layout, 'status', NEW.status, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_sys_print_form_update_outbox AFTER UPDATE ON sys_print_form
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'sys_print_form', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'scope', NEW.scope, 'slot', NEW.slot, 'name', NEW.name, 'base', NEW.base, 'layout', NEW.layout, 'status', NEW.status, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_sys_print_form_ver AFTER UPDATE ON sys_print_form
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE sys_print_form SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_sys_report_custom_insert_outbox AFTER INSERT ON sys_report_custom
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'sys_report_custom', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'code', NEW.code, 'base_code', NEW.base_code, 'name', NEW.name, 'params', NEW.params, 'hidden_cols', NEW.hidden_cols, 'landscape', NEW.landscape, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_sys_report_custom_update_outbox AFTER UPDATE ON sys_report_custom
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'sys_report_custom', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'code', NEW.code, 'base_code', NEW.base_code, 'name', NEW.name, 'params', NEW.params, 'hidden_cols', NEW.hidden_cols, 'landscape', NEW.landscape, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_sys_report_custom_ver AFTER UPDATE ON sys_report_custom
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE sys_report_custom SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_fiscal_year_insert_outbox AFTER INSERT ON gl_fiscal_year
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'gl_fiscal_year', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'code', NEW.code, 'start_date', NEW.start_date, 'end_date', NEW.end_date, 'status', NEW.status, 'closed_at', NEW.closed_at, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_fiscal_year_update_outbox AFTER UPDATE ON gl_fiscal_year
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'gl_fiscal_year', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'code', NEW.code, 'start_date', NEW.start_date, 'end_date', NEW.end_date, 'status', NEW.status, 'closed_at', NEW.closed_at, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_fiscal_year_ver AFTER UPDATE ON gl_fiscal_year
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE gl_fiscal_year SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_period_insert_outbox AFTER INSERT ON gl_period
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'gl_period', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'fiscal_year_id', NEW.fiscal_year_id, 'period_no', NEW.period_no, 'start_date', NEW.start_date, 'end_date', NEW.end_date, 'is_locked', NEW.is_locked, 'locked_by', NEW.locked_by, 'locked_at', NEW.locked_at, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_period_update_outbox AFTER UPDATE ON gl_period
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'gl_period', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'fiscal_year_id', NEW.fiscal_year_id, 'period_no', NEW.period_no, 'start_date', NEW.start_date, 'end_date', NEW.end_date, 'is_locked', NEW.is_locked, 'locked_by', NEW.locked_by, 'locked_at', NEW.locked_at, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_period_ver AFTER UPDATE ON gl_period
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE gl_period SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_account_insert_outbox AFTER INSERT ON gl_account
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'gl_account', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'account_no', NEW.account_no, 'name_th', NEW.name_th, 'name_en', NEW.name_en, 'parent_id', NEW.parent_id, 'level', NEW.level, 'account_group', NEW.account_group, 'is_control', NEW.is_control, 'normal_side', NEW.normal_side, 'use_department', NEW.use_department, 'use_project', NEW.use_project, 'consol_account', NEW.consol_account, 'status', NEW.status, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_account_update_outbox AFTER UPDATE ON gl_account
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'gl_account', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'account_no', NEW.account_no, 'name_th', NEW.name_th, 'name_en', NEW.name_en, 'parent_id', NEW.parent_id, 'level', NEW.level, 'account_group', NEW.account_group, 'is_control', NEW.is_control, 'normal_side', NEW.normal_side, 'use_department', NEW.use_department, 'use_project', NEW.use_project, 'consol_account', NEW.consol_account, 'status', NEW.status, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_account_ver AFTER UPDATE ON gl_account
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE gl_account SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_journal_book_insert_outbox AFTER INSERT ON gl_journal_book
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'gl_journal_book', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'code', NEW.code, 'prefix', NEW.prefix, 'name_th', NEW.name_th, 'name_en', NEW.name_en, 'template_id', NEW.template_id, 'approve_level', NEW.approve_level, 'approve_method', NEW.approve_method, 'reprint_level', NEW.reprint_level, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_journal_book_update_outbox AFTER UPDATE ON gl_journal_book
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'gl_journal_book', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'code', NEW.code, 'prefix', NEW.prefix, 'name_th', NEW.name_th, 'name_en', NEW.name_en, 'template_id', NEW.template_id, 'approve_level', NEW.approve_level, 'approve_method', NEW.approve_method, 'reprint_level', NEW.reprint_level, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_journal_book_ver AFTER UPDATE ON gl_journal_book
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE gl_journal_book SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_default_account_insert_outbox AFTER INSERT ON gl_default_account
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'gl_default_account', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'role', NEW.role, 'account_id', NEW.account_id, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_default_account_update_outbox AFTER UPDATE ON gl_default_account
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'gl_default_account', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'role', NEW.role, 'account_id', NEW.account_id, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_default_account_ver AFTER UPDATE ON gl_default_account
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE gl_default_account SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_journal_route_insert_outbox AFTER INSERT ON gl_journal_route
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'gl_journal_route', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'txn_kind', NEW.txn_kind, 'journal_book_id', NEW.journal_book_id, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_journal_route_update_outbox AFTER UPDATE ON gl_journal_route
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'gl_journal_route', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'txn_kind', NEW.txn_kind, 'journal_book_id', NEW.journal_book_id, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_journal_route_ver AFTER UPDATE ON gl_journal_route
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE gl_journal_route SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_posting_rule_insert_outbox AFTER INSERT ON gl_posting_rule
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'gl_posting_rule', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'doc_class', NEW.doc_class, 'seq', NEW.seq, 'condition', NEW.condition, 'side', NEW.side, 'account_role', NEW.account_role, 'amount_source', NEW.amount_source, 'per', NEW.per, 'description', NEW.description, 'is_assumed', NEW.is_assumed, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_posting_rule_update_outbox AFTER UPDATE ON gl_posting_rule
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'gl_posting_rule', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'doc_class', NEW.doc_class, 'seq', NEW.seq, 'condition', NEW.condition, 'side', NEW.side, 'account_role', NEW.account_role, 'amount_source', NEW.amount_source, 'per', NEW.per, 'description', NEW.description, 'is_assumed', NEW.is_assumed, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_posting_rule_ver AFTER UPDATE ON gl_posting_rule
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE gl_posting_rule SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_template_insert_outbox AFTER INSERT ON gl_template
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'gl_template', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'code', NEW.code, 'name', NEW.name, 'name_en', NEW.name_en, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_template_update_outbox AFTER UPDATE ON gl_template
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'gl_template', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'code', NEW.code, 'name', NEW.name, 'name_en', NEW.name_en, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_template_ver AFTER UPDATE ON gl_template
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE gl_template SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_template_line_insert_outbox AFTER INSERT ON gl_template_line
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'gl_template_line', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'template_id', NEW.template_id, 'line_no', NEW.line_no, 'account_id', NEW.account_id, 'department_id', NEW.department_id, 'description', NEW.description, 'side', NEW.side, 'amount', NEW.amount, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_template_line_update_outbox AFTER UPDATE ON gl_template_line
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'gl_template_line', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'template_id', NEW.template_id, 'line_no', NEW.line_no, 'account_id', NEW.account_id, 'department_id', NEW.department_id, 'description', NEW.description, 'side', NEW.side, 'amount', NEW.amount, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_template_line_ver AFTER UPDATE ON gl_template_line
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE gl_template_line SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_md_lookup_type_insert_outbox AFTER INSERT ON md_lookup_type
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_lookup_type', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'code', NEW.code, 'name_th', NEW.name_th, 'has_rate', NEW.has_rate, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_lookup_type_update_outbox AFTER UPDATE ON md_lookup_type
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_lookup_type', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'code', NEW.code, 'name_th', NEW.name_th, 'has_rate', NEW.has_rate, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_lookup_type_ver AFTER UPDATE ON md_lookup_type
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE md_lookup_type SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_md_lookup_insert_outbox AFTER INSERT ON md_lookup
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_lookup', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'type_code', NEW.type_code, 'code', NEW.code, 'short_th', NEW.short_th, 'short_en', NEW.short_en, 'name_th', NEW.name_th, 'name_en', NEW.name_en, 'rate', NEW.rate, 'status', NEW.status, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_lookup_update_outbox AFTER UPDATE ON md_lookup
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_lookup', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'type_code', NEW.type_code, 'code', NEW.code, 'short_th', NEW.short_th, 'short_en', NEW.short_en, 'name_th', NEW.name_th, 'name_en', NEW.name_en, 'rate', NEW.rate, 'status', NEW.status, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_lookup_ver AFTER UPDATE ON md_lookup
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE md_lookup SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_md_unit_insert_outbox AFTER INSERT ON md_unit
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_unit', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'code', NEW.code, 'name_th', NEW.name_th, 'name_en', NEW.name_en, 'short_th', NEW.short_th, 'short_en', NEW.short_en, 'rate', NEW.rate, 'status', NEW.status, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_unit_update_outbox AFTER UPDATE ON md_unit
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_unit', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'code', NEW.code, 'name_th', NEW.name_th, 'name_en', NEW.name_en, 'short_th', NEW.short_th, 'short_en', NEW.short_en, 'rate', NEW.rate, 'status', NEW.status, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_unit_ver AFTER UPDATE ON md_unit
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE md_unit SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_md_warehouse_insert_outbox AFTER INSERT ON md_warehouse
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_warehouse', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'code', NEW.code, 'name_th', NEW.name_th, 'name_en', NEW.name_en, 'short_th', NEW.short_th, 'short_en', NEW.short_en, 'branch_id', NEW.branch_id, 'status', NEW.status, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_warehouse_update_outbox AFTER UPDATE ON md_warehouse
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_warehouse', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'code', NEW.code, 'name_th', NEW.name_th, 'name_en', NEW.name_en, 'short_th', NEW.short_th, 'short_en', NEW.short_en, 'branch_id', NEW.branch_id, 'status', NEW.status, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_warehouse_ver AFTER UPDATE ON md_warehouse
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE md_warehouse SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_md_department_insert_outbox AFTER INSERT ON md_department
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_department', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'code', NEW.code, 'name_th', NEW.name_th, 'name_en', NEW.name_en, 'short_name_th', NEW.short_name_th, 'short_name_en', NEW.short_name_en, 'status', NEW.status, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_department_update_outbox AFTER UPDATE ON md_department
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_department', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'code', NEW.code, 'name_th', NEW.name_th, 'name_en', NEW.name_en, 'short_name_th', NEW.short_name_th, 'short_name_en', NEW.short_name_en, 'status', NEW.status, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_department_ver AFTER UPDATE ON md_department
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE md_department SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_md_bank_insert_outbox AFTER INSERT ON md_bank
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_bank', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'code', NEW.code, 'name_th', NEW.name_th, 'name_en', NEW.name_en, 'short_th', NEW.short_th, 'short_en', NEW.short_en, 'status', NEW.status, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_bank_update_outbox AFTER UPDATE ON md_bank
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_bank', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'code', NEW.code, 'name_th', NEW.name_th, 'name_en', NEW.name_en, 'short_th', NEW.short_th, 'short_en', NEW.short_en, 'status', NEW.status, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_bank_ver AFTER UPDATE ON md_bank
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE md_bank SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_md_project_insert_outbox AFTER INSERT ON md_project
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_project', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'code', NEW.code, 'name_th', NEW.name_th, 'name_en', NEW.name_en, 'customer_id', NEW.customer_id, 'start_date', NEW.start_date, 'end_date', NEW.end_date, 'status', NEW.status, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_project_update_outbox AFTER UPDATE ON md_project
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_project', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'code', NEW.code, 'name_th', NEW.name_th, 'name_en', NEW.name_en, 'customer_id', NEW.customer_id, 'start_date', NEW.start_date, 'end_date', NEW.end_date, 'status', NEW.status, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_project_ver AFTER UPDATE ON md_project
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE md_project SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_md_project_budget_insert_outbox AFTER INSERT ON md_project_budget
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_project_budget', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'project_id', NEW.project_id, 'phase', NEW.phase, 'cost_code', NEW.cost_code, 'est_expense', NEW.est_expense, 'est_revenue', NEW.est_revenue, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_project_budget_update_outbox AFTER UPDATE ON md_project_budget
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_project_budget', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'project_id', NEW.project_id, 'phase', NEW.phase, 'cost_code', NEW.cost_code, 'est_expense', NEW.est_expense, 'est_revenue', NEW.est_revenue, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_project_budget_ver AFTER UPDATE ON md_project_budget
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE md_project_budget SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_md_item_account_group_insert_outbox AFTER INSERT ON md_item_account_group
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_item_account_group', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'code', NEW.code, 'name_th', NEW.name_th, 'name_en', NEW.name_en, 'cost_method', NEW.cost_method, 'item_specific', NEW.item_specific, 'inventory_account_id', NEW.inventory_account_id, 'cogs_account_id', NEW.cogs_account_id, 'sales_account_id', NEW.sales_account_id, 'sales_return_account_id', NEW.sales_return_account_id, 'purchase_account_id', NEW.purchase_account_id, 'purchase_return_account_id', NEW.purchase_return_account_id, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_item_account_group_update_outbox AFTER UPDATE ON md_item_account_group
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_item_account_group', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'code', NEW.code, 'name_th', NEW.name_th, 'name_en', NEW.name_en, 'cost_method', NEW.cost_method, 'item_specific', NEW.item_specific, 'inventory_account_id', NEW.inventory_account_id, 'cogs_account_id', NEW.cogs_account_id, 'sales_account_id', NEW.sales_account_id, 'sales_return_account_id', NEW.sales_return_account_id, 'purchase_account_id', NEW.purchase_account_id, 'purchase_return_account_id', NEW.purchase_return_account_id, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_item_account_group_ver AFTER UPDATE ON md_item_account_group
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE md_item_account_group SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_md_item_insert_outbox AFTER INSERT ON md_item
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_item', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'code', NEW.code, 'item_type', NEW.item_type, 'barcode', NEW.barcode, 'name_th', NEW.name_th, 'name_en', NEW.name_en, 'item_level', NEW.item_level, 'category_code', NEW.category_code, 'account_group_id', NEW.account_group_id, 'base_unit_id', NEW.base_unit_id, 'count_unit_id', NEW.count_unit_id, 'count_factor', NEW.count_factor, 'purchase_unit_id', NEW.purchase_unit_id, 'purchase_factor', NEW.purchase_factor, 'sales_unit_id', NEW.sales_unit_id, 'sales_factor', NEW.sales_factor, 'std_cost', NEW.std_cost, 'price_1', NEW.price_1, 'price_2', NEW.price_2, 'price_3', NEW.price_3, 'price_4', NEW.price_4, 'price_5', NEW.price_5, 'vat_code', NEW.vat_code, 'allow_negative', NEW.allow_negative, 'default_supplier_id', NEW.default_supplier_id, 'substitute_item_id', NEW.substitute_item_id, 'packing', NEW.packing, 'udf_1', NEW.udf_1, 'udf_2', NEW.udf_2, 'udf_3', NEW.udf_3, 'udf_4', NEW.udf_4, 'udf_date_1', NEW.udf_date_1, 'udf_date_2', NEW.udf_date_2, 'udf_num_1', NEW.udf_num_1, 'remark', NEW.remark, 'status', NEW.status, 'inactive_date', NEW.inactive_date, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_item_update_outbox AFTER UPDATE ON md_item
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_item', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'code', NEW.code, 'item_type', NEW.item_type, 'barcode', NEW.barcode, 'name_th', NEW.name_th, 'name_en', NEW.name_en, 'item_level', NEW.item_level, 'category_code', NEW.category_code, 'account_group_id', NEW.account_group_id, 'base_unit_id', NEW.base_unit_id, 'count_unit_id', NEW.count_unit_id, 'count_factor', NEW.count_factor, 'purchase_unit_id', NEW.purchase_unit_id, 'purchase_factor', NEW.purchase_factor, 'sales_unit_id', NEW.sales_unit_id, 'sales_factor', NEW.sales_factor, 'std_cost', NEW.std_cost, 'price_1', NEW.price_1, 'price_2', NEW.price_2, 'price_3', NEW.price_3, 'price_4', NEW.price_4, 'price_5', NEW.price_5, 'vat_code', NEW.vat_code, 'allow_negative', NEW.allow_negative, 'default_supplier_id', NEW.default_supplier_id, 'substitute_item_id', NEW.substitute_item_id, 'packing', NEW.packing, 'udf_1', NEW.udf_1, 'udf_2', NEW.udf_2, 'udf_3', NEW.udf_3, 'udf_4', NEW.udf_4, 'udf_date_1', NEW.udf_date_1, 'udf_date_2', NEW.udf_date_2, 'udf_num_1', NEW.udf_num_1, 'remark', NEW.remark, 'status', NEW.status, 'inactive_date', NEW.inactive_date, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_item_ver AFTER UPDATE ON md_item
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE md_item SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_md_item_bom_insert_outbox AFTER INSERT ON md_item_bom
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_item_bom', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'parent_item_id', NEW.parent_item_id, 'line_no', NEW.line_no, 'component_item_id', NEW.component_item_id, 'qty', NEW.qty, 'std_cost', NEW.std_cost, 'sell_price', NEW.sell_price, 'warehouse_id', NEW.warehouse_id, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_item_bom_update_outbox AFTER UPDATE ON md_item_bom
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_item_bom', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'parent_item_id', NEW.parent_item_id, 'line_no', NEW.line_no, 'component_item_id', NEW.component_item_id, 'qty', NEW.qty, 'std_cost', NEW.std_cost, 'sell_price', NEW.sell_price, 'warehouse_id', NEW.warehouse_id, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_item_bom_ver AFTER UPDATE ON md_item_bom
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE md_item_bom SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_md_item_price_break_insert_outbox AFTER INSERT ON md_item_price_break
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_item_price_break', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'item_id', NEW.item_id, 'unit_id', NEW.unit_id, 'factor', NEW.factor, 'min_qty', NEW.min_qty, 'is_percent', NEW.is_percent, 'price_1', NEW.price_1, 'price_2', NEW.price_2, 'price_3', NEW.price_3, 'price_4', NEW.price_4, 'price_5', NEW.price_5, 'start_date', NEW.start_date, 'end_date', NEW.end_date, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_item_price_break_update_outbox AFTER UPDATE ON md_item_price_break
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_item_price_break', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'item_id', NEW.item_id, 'unit_id', NEW.unit_id, 'factor', NEW.factor, 'min_qty', NEW.min_qty, 'is_percent', NEW.is_percent, 'price_1', NEW.price_1, 'price_2', NEW.price_2, 'price_3', NEW.price_3, 'price_4', NEW.price_4, 'price_5', NEW.price_5, 'start_date', NEW.start_date, 'end_date', NEW.end_date, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_item_price_break_ver AFTER UPDATE ON md_item_price_break
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE md_item_price_break SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_md_item_reorder_insert_outbox AFTER INSERT ON md_item_reorder
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_item_reorder', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'item_id', NEW.item_id, 'warehouse_id', NEW.warehouse_id, 'start_mmdd', NEW.start_mmdd, 'min_qty', NEW.min_qty, 'max_qty', NEW.max_qty, 'order_qty', NEW.order_qty, 'projected_sales', NEW.projected_sales, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_item_reorder_update_outbox AFTER UPDATE ON md_item_reorder
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_item_reorder', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'item_id', NEW.item_id, 'warehouse_id', NEW.warehouse_id, 'start_mmdd', NEW.start_mmdd, 'min_qty', NEW.min_qty, 'max_qty', NEW.max_qty, 'order_qty', NEW.order_qty, 'projected_sales', NEW.projected_sales, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_item_reorder_ver AFTER UPDATE ON md_item_reorder
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE md_item_reorder SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_md_customer_insert_outbox AFTER INSERT ON md_customer
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_customer', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'code', NEW.code, 'customer_type', NEW.customer_type, 'title', NEW.title, 'name', NEW.name, 'name_en', NEW.name_en, 'address_1', NEW.address_1, 'address_2', NEW.address_2, 'address_3', NEW.address_3, 'zip_code', NEW.zip_code, 'phone', NEW.phone, 'email', NEW.email, 'contact', NEW.contact, 'tax_id', NEW.tax_id, 'tax_branch_no', NEW.tax_branch_no, 'salesperson_id', NEW.salesperson_id, 'sales_area_code', NEW.sales_area_code, 'ship_via_code', NEW.ship_via_code, 'credit_days', NEW.credit_days, 'payment_terms', NEW.payment_terms, 'price_level', NEW.price_level, 'discount_text', NEW.discount_text, 'credit_limit', NEW.credit_limit, 'ar_account_id', NEW.ar_account_id, 'payer_id', NEW.payer_id, 'wht_form', NEW.wht_form, 'wht_rate', NEW.wht_rate, 'wht_category', NEW.wht_category, 'wht_condition', NEW.wht_condition, 'default_ship_to', NEW.default_ship_to, 'track_sales', NEW.track_sales, 'remark', NEW.remark, 'status', NEW.status, 'inactive_date', NEW.inactive_date, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_customer_update_outbox AFTER UPDATE ON md_customer
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_customer', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'code', NEW.code, 'customer_type', NEW.customer_type, 'title', NEW.title, 'name', NEW.name, 'name_en', NEW.name_en, 'address_1', NEW.address_1, 'address_2', NEW.address_2, 'address_3', NEW.address_3, 'zip_code', NEW.zip_code, 'phone', NEW.phone, 'email', NEW.email, 'contact', NEW.contact, 'tax_id', NEW.tax_id, 'tax_branch_no', NEW.tax_branch_no, 'salesperson_id', NEW.salesperson_id, 'sales_area_code', NEW.sales_area_code, 'ship_via_code', NEW.ship_via_code, 'credit_days', NEW.credit_days, 'payment_terms', NEW.payment_terms, 'price_level', NEW.price_level, 'discount_text', NEW.discount_text, 'credit_limit', NEW.credit_limit, 'ar_account_id', NEW.ar_account_id, 'payer_id', NEW.payer_id, 'wht_form', NEW.wht_form, 'wht_rate', NEW.wht_rate, 'wht_category', NEW.wht_category, 'wht_condition', NEW.wht_condition, 'default_ship_to', NEW.default_ship_to, 'track_sales', NEW.track_sales, 'remark', NEW.remark, 'status', NEW.status, 'inactive_date', NEW.inactive_date, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_customer_ver AFTER UPDATE ON md_customer
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE md_customer SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_md_customer_ship_to_insert_outbox AFTER INSERT ON md_customer_ship_to
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_customer_ship_to', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'customer_id', NEW.customer_id, 'code', NEW.code, 'address_1', NEW.address_1, 'address_2', NEW.address_2, 'address_3', NEW.address_3, 'zip_code', NEW.zip_code, 'phone', NEW.phone, 'contact', NEW.contact, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_customer_ship_to_update_outbox AFTER UPDATE ON md_customer_ship_to
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_customer_ship_to', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'customer_id', NEW.customer_id, 'code', NEW.code, 'address_1', NEW.address_1, 'address_2', NEW.address_2, 'address_3', NEW.address_3, 'zip_code', NEW.zip_code, 'phone', NEW.phone, 'contact', NEW.contact, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_customer_ship_to_ver AFTER UPDATE ON md_customer_ship_to
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE md_customer_ship_to SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_md_supplier_insert_outbox AFTER INSERT ON md_supplier
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_supplier', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'code', NEW.code, 'supplier_type', NEW.supplier_type, 'title', NEW.title, 'name', NEW.name, 'name_en', NEW.name_en, 'address_1', NEW.address_1, 'address_2', NEW.address_2, 'address_3', NEW.address_3, 'zip_code', NEW.zip_code, 'phone', NEW.phone, 'contact', NEW.contact, 'tax_id', NEW.tax_id, 'tax_branch_no', NEW.tax_branch_no, 'price_type', NEW.price_type, 'vat_rate', NEW.vat_rate, 'ship_via_code', NEW.ship_via_code, 'credit_days', NEW.credit_days, 'payment_terms', NEW.payment_terms, 'discount_text', NEW.discount_text, 'credit_limit', NEW.credit_limit, 'ap_account_id', NEW.ap_account_id, 'wht_form', NEW.wht_form, 'wht_income_desc', NEW.wht_income_desc, 'wht_rate', NEW.wht_rate, 'wht_condition', NEW.wht_condition, 'on_hold', NEW.on_hold, 'remark', NEW.remark, 'status', NEW.status, 'inactive_date', NEW.inactive_date, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_supplier_update_outbox AFTER UPDATE ON md_supplier
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_supplier', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'code', NEW.code, 'supplier_type', NEW.supplier_type, 'title', NEW.title, 'name', NEW.name, 'name_en', NEW.name_en, 'address_1', NEW.address_1, 'address_2', NEW.address_2, 'address_3', NEW.address_3, 'zip_code', NEW.zip_code, 'phone', NEW.phone, 'contact', NEW.contact, 'tax_id', NEW.tax_id, 'tax_branch_no', NEW.tax_branch_no, 'price_type', NEW.price_type, 'vat_rate', NEW.vat_rate, 'ship_via_code', NEW.ship_via_code, 'credit_days', NEW.credit_days, 'payment_terms', NEW.payment_terms, 'discount_text', NEW.discount_text, 'credit_limit', NEW.credit_limit, 'ap_account_id', NEW.ap_account_id, 'wht_form', NEW.wht_form, 'wht_income_desc', NEW.wht_income_desc, 'wht_rate', NEW.wht_rate, 'wht_condition', NEW.wht_condition, 'on_hold', NEW.on_hold, 'remark', NEW.remark, 'status', NEW.status, 'inactive_date', NEW.inactive_date, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_supplier_ver AFTER UPDATE ON md_supplier
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE md_supplier SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_md_party_contact_insert_outbox AFTER INSERT ON md_party_contact
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_party_contact', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'party_type', NEW.party_type, 'party_id', NEW.party_id, 'line_no', NEW.line_no, 'name', NEW.name, 'position', NEW.position, 'phone', NEW.phone, 'email', NEW.email, 'is_primary', NEW.is_primary, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_party_contact_update_outbox AFTER UPDATE ON md_party_contact
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_party_contact', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'party_type', NEW.party_type, 'party_id', NEW.party_id, 'line_no', NEW.line_no, 'name', NEW.name, 'position', NEW.position, 'phone', NEW.phone, 'email', NEW.email, 'is_primary', NEW.is_primary, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_party_contact_ver AFTER UPDATE ON md_party_contact
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE md_party_contact SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_md_supplier_bank_insert_outbox AFTER INSERT ON md_supplier_bank
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_supplier_bank', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'supplier_id', NEW.supplier_id, 'line_no', NEW.line_no, 'bank_code', NEW.bank_code, 'branch', NEW.branch, 'account_no', NEW.account_no, 'account_name', NEW.account_name, 'is_default', NEW.is_default, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_supplier_bank_update_outbox AFTER UPDATE ON md_supplier_bank
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_supplier_bank', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'supplier_id', NEW.supplier_id, 'line_no', NEW.line_no, 'bank_code', NEW.bank_code, 'branch', NEW.branch, 'account_no', NEW.account_no, 'account_name', NEW.account_name, 'is_default', NEW.is_default, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_supplier_bank_ver AFTER UPDATE ON md_supplier_bank
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE md_supplier_bank SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_md_salesperson_insert_outbox AFTER INSERT ON md_salesperson
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_salesperson', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'code', NEW.code, 'name', NEW.name, 'position', NEW.position, 'salesperson_type', NEW.salesperson_type, 'sales_area_code', NEW.sales_area_code, 'commission_rate', NEW.commission_rate, 'address', NEW.address, 'zip_code', NEW.zip_code, 'phone', NEW.phone, 'tax_id', NEW.tax_id, 'social_security_no', NEW.social_security_no, 'status', NEW.status, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_salesperson_update_outbox AFTER UPDATE ON md_salesperson
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_salesperson', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'code', NEW.code, 'name', NEW.name, 'position', NEW.position, 'salesperson_type', NEW.salesperson_type, 'sales_area_code', NEW.sales_area_code, 'commission_rate', NEW.commission_rate, 'address', NEW.address, 'zip_code', NEW.zip_code, 'phone', NEW.phone, 'tax_id', NEW.tax_id, 'social_security_no', NEW.social_security_no, 'status', NEW.status, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_salesperson_ver AFTER UPDATE ON md_salesperson
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE md_salesperson SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_md_sales_target_insert_outbox AFTER INSERT ON md_sales_target
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_sales_target', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'salesperson_id', NEW.salesperson_id, 'period_id', NEW.period_id, 'target_amount', NEW.target_amount, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_sales_target_update_outbox AFTER UPDATE ON md_sales_target
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_sales_target', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'salesperson_id', NEW.salesperson_id, 'period_id', NEW.period_id, 'target_amount', NEW.target_amount, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_sales_target_ver AFTER UPDATE ON md_sales_target
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE md_sales_target SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_md_bank_account_insert_outbox AFTER INSERT ON md_bank_account
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_bank_account', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'code', NEW.code, 'bank_id', NEW.bank_id, 'name', NEW.name, 'branch', NEW.branch, 'short_name', NEW.short_name, 'account_number', NEW.account_number, 'account_kind', NEW.account_kind, 'gl_account_id', NEW.gl_account_id, 'currency', NEW.currency, 'opening_balance', NEW.opening_balance, 'opening_date', NEW.opening_date, 'status', NEW.status, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_bank_account_update_outbox AFTER UPDATE ON md_bank_account
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_bank_account', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'code', NEW.code, 'bank_id', NEW.bank_id, 'name', NEW.name, 'branch', NEW.branch, 'short_name', NEW.short_name, 'account_number', NEW.account_number, 'account_kind', NEW.account_kind, 'gl_account_id', NEW.gl_account_id, 'currency', NEW.currency, 'opening_balance', NEW.opening_balance, 'opening_date', NEW.opening_date, 'status', NEW.status, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_bank_account_ver AFTER UPDATE ON md_bank_account
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE md_bank_account SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_md_doc_type_insert_outbox AFTER INSERT ON md_doc_type
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_doc_type', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'code', NEW.code, 'doc_class', NEW.doc_class, 'module', NEW.module, 'name_th', NEW.name_th, 'name_en', NEW.name_en, 'short_name', NEW.short_name, 'next_no', NEW.next_no, 'journal_book_id', NEW.journal_book_id, 'journal_desc_template', NEW.journal_desc_template, 'department_id', NEW.department_id, 'warehouse_id', NEW.warehouse_id, 'price_type', NEW.price_type, 'vat_rate', NEW.vat_rate, 'vat_basis', NEW.vat_basis, 'vat_per_line', NEW.vat_per_line, 'approve_method', NEW.approve_method, 'approve_level', NEW.approve_level, 'reprint_level', NEW.reprint_level, 'cancel_level', NEW.cancel_level, 'delete_level', NEW.delete_level, 'over_limit_level', NEW.over_limit_level, 'auto_print', NEW.auto_print, 'form_no', NEW.form_no, 'use_barcode', NEW.use_barcode, 'is_tax_invoice', NEW.is_tax_invoice, 'status', NEW.status, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_doc_type_update_outbox AFTER UPDATE ON md_doc_type
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_doc_type', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'code', NEW.code, 'doc_class', NEW.doc_class, 'module', NEW.module, 'name_th', NEW.name_th, 'name_en', NEW.name_en, 'short_name', NEW.short_name, 'next_no', NEW.next_no, 'journal_book_id', NEW.journal_book_id, 'journal_desc_template', NEW.journal_desc_template, 'department_id', NEW.department_id, 'warehouse_id', NEW.warehouse_id, 'price_type', NEW.price_type, 'vat_rate', NEW.vat_rate, 'vat_basis', NEW.vat_basis, 'vat_per_line', NEW.vat_per_line, 'approve_method', NEW.approve_method, 'approve_level', NEW.approve_level, 'reprint_level', NEW.reprint_level, 'cancel_level', NEW.cancel_level, 'delete_level', NEW.delete_level, 'over_limit_level', NEW.over_limit_level, 'auto_print', NEW.auto_print, 'form_no', NEW.form_no, 'use_barcode', NEW.use_barcode, 'is_tax_invoice', NEW.is_tax_invoice, 'status', NEW.status, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_doc_type_ver AFTER UPDATE ON md_doc_type
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE md_doc_type SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_md_doc_type_account_insert_outbox AFTER INSERT ON md_doc_type_account
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_doc_type_account', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'doc_type_id', NEW.doc_type_id, 'slot', NEW.slot, 'role', NEW.role, 'account_id', NEW.account_id, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_doc_type_account_update_outbox AFTER UPDATE ON md_doc_type_account
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_doc_type_account', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'doc_type_id', NEW.doc_type_id, 'slot', NEW.slot, 'role', NEW.role, 'account_id', NEW.account_id, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_doc_type_account_ver AFTER UPDATE ON md_doc_type_account
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE md_doc_type_account SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_md_payment_method_insert_outbox AFTER INSERT ON md_payment_method
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_payment_method', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'direction', NEW.direction, 'code', NEW.code, 'seq', NEW.seq, 'name_th', NEW.name_th, 'name_en', NEW.name_en, 'kind', NEW.kind, 'gl_account_id', NEW.gl_account_id, 'bank_account_id', NEW.bank_account_id, 'creates_cheque', NEW.creates_cheque, 'status', NEW.status, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_payment_method_update_outbox AFTER UPDATE ON md_payment_method
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_payment_method', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'direction', NEW.direction, 'code', NEW.code, 'seq', NEW.seq, 'name_th', NEW.name_th, 'name_en', NEW.name_en, 'kind', NEW.kind, 'gl_account_id', NEW.gl_account_id, 'bank_account_id', NEW.bank_account_id, 'creates_cheque', NEW.creates_cheque, 'status', NEW.status, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_payment_method_ver AFTER UPDATE ON md_payment_method
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE md_payment_method SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_md_doc_number_block_insert_outbox AFTER INSERT ON md_doc_number_block
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_doc_number_block', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'doc_type_id', NEW.doc_type_id, 'branch_id', NEW.branch_id, 'device_id', NEW.device_id, 'series', NEW.series, 'format', NEW.format, 'range_start', NEW.range_start, 'range_end', NEW.range_end, 'next_no', NEW.next_no, 'status', NEW.status, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_doc_number_block_update_outbox AFTER UPDATE ON md_doc_number_block
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_doc_number_block', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'doc_type_id', NEW.doc_type_id, 'branch_id', NEW.branch_id, 'device_id', NEW.device_id, 'series', NEW.series, 'format', NEW.format, 'range_start', NEW.range_start, 'range_end', NEW.range_end, 'next_no', NEW.next_no, 'status', NEW.status, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_doc_number_block_ver AFTER UPDATE ON md_doc_number_block
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE md_doc_number_block SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_doc_header_insert_outbox AFTER INSERT ON doc_header
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'doc_header', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_patch(json_object('id', NEW.id, 'company_id', NEW.company_id, 'branch_id', NEW.branch_id, 'doc_type_id', NEW.doc_type_id, 'doc_class', NEW.doc_class, 'module', NEW.module, 'express_rectype', NEW.express_rectype, 'doc_no', NEW.doc_no, 'is_provisional_no', NEW.is_provisional_no, 'doc_date', NEW.doc_date, 'period_id', NEW.period_id, 'customer_id', NEW.customer_id, 'supplier_id', NEW.supplier_id, 'bill_to_customer_id', NEW.bill_to_customer_id, 'ship_to_id', NEW.ship_to_id, 'party_tax_id', NEW.party_tax_id, 'party_tax_branch_no', NEW.party_tax_branch_no, 'party_name', NEW.party_name, 'party_address', NEW.party_address, 'salesperson_id', NEW.salesperson_id, 'department_id', NEW.department_id, 'project_id', NEW.project_id, 'sales_area_code', NEW.sales_area_code, 'ship_via_code', NEW.ship_via_code, 'warehouse_id', NEW.warehouse_id, 'to_warehouse_id', NEW.to_warehouse_id, 'bank_account_id', NEW.bank_account_id, 'to_bank_account_id', NEW.to_bank_account_id, 'your_ref', NEW.your_ref, 'ref_no', NEW.ref_no, 'ref_date', NEW.ref_date, 'credit_days', NEW.credit_days, 'due_date', NEW.due_date, 'delivery_date', NEW.delivery_date, 'delivery_date_per_line', NEW.delivery_date_per_line, 'price_type', NEW.price_type, 'currency', NEW.currency, 'exchange_rate', NEW.exchange_rate, 'amount', NEW.amount, 'discount_text', NEW.discount_text, 'discount_amount', NEW.discount_amount, 'amount_after_discount', NEW.amount_after_discount, 'deposit_amount', NEW.deposit_amount, 'zero_rate_amount', NEW.zero_rate_amount, 'taxable_amount', NEW.taxable_amount, 'vat_rate', NEW.vat_rate, 'vat_amount', NEW.vat_amount, 'net_amount', NEW.net_amount, 'wht_amount', NEW.wht_amount, 'cash_amount', NEW.cash_amount, 'cheque_amount', NEW.cheque_amount, 'interest_amount', NEW.interest_amount, 'cash_discount_amount', NEW.cash_discount_amount, 'settled_amount', NEW.settled_amount, 'outstanding_amount', NEW.outstanding_amount, 'commission_amount', NEW.commission_amount, 'vat_basis', NEW.vat_basis, 'vat_date', NEW.vat_date, 'vat_period_id', NEW.vat_period_id, 'vat_late', NEW.vat_late), json_object('doc_status', NEW.doc_status, 'status_code', NEW.status_code, 'is_settled', NEW.is_settled, 'settled_date', NEW.settled_date, 'appointment_date', NEW.appointment_date, 'payment_date', NEW.payment_date, 'is_opening', NEW.is_opening, 'payment_terms', NEW.payment_terms, 'remark', NEW.remark, 'gl_posted', NEW.gl_posted, 'journal_id', NEW.journal_id, 'approved_by', NEW.approved_by, 'approved_at', NEW.approved_at, 'auth_user_id', NEW.auth_user_id, 'print_count', NEW.print_count, 'last_printed_by', NEW.last_printed_by, 'last_printed_at', NEW.last_printed_at, 'cancel_reason', NEW.cancel_reason, 'device_id', NEW.device_id, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id)),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_doc_header_update_outbox AFTER UPDATE ON doc_header
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'doc_header', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_patch(json_object('id', NEW.id, 'company_id', NEW.company_id, 'branch_id', NEW.branch_id, 'doc_type_id', NEW.doc_type_id, 'doc_class', NEW.doc_class, 'module', NEW.module, 'express_rectype', NEW.express_rectype, 'doc_no', NEW.doc_no, 'is_provisional_no', NEW.is_provisional_no, 'doc_date', NEW.doc_date, 'period_id', NEW.period_id, 'customer_id', NEW.customer_id, 'supplier_id', NEW.supplier_id, 'bill_to_customer_id', NEW.bill_to_customer_id, 'ship_to_id', NEW.ship_to_id, 'party_tax_id', NEW.party_tax_id, 'party_tax_branch_no', NEW.party_tax_branch_no, 'party_name', NEW.party_name, 'party_address', NEW.party_address, 'salesperson_id', NEW.salesperson_id, 'department_id', NEW.department_id, 'project_id', NEW.project_id, 'sales_area_code', NEW.sales_area_code, 'ship_via_code', NEW.ship_via_code, 'warehouse_id', NEW.warehouse_id, 'to_warehouse_id', NEW.to_warehouse_id, 'bank_account_id', NEW.bank_account_id, 'to_bank_account_id', NEW.to_bank_account_id, 'your_ref', NEW.your_ref, 'ref_no', NEW.ref_no, 'ref_date', NEW.ref_date, 'credit_days', NEW.credit_days, 'due_date', NEW.due_date, 'delivery_date', NEW.delivery_date, 'delivery_date_per_line', NEW.delivery_date_per_line, 'price_type', NEW.price_type, 'currency', NEW.currency, 'exchange_rate', NEW.exchange_rate, 'amount', NEW.amount, 'discount_text', NEW.discount_text, 'discount_amount', NEW.discount_amount, 'amount_after_discount', NEW.amount_after_discount, 'deposit_amount', NEW.deposit_amount, 'zero_rate_amount', NEW.zero_rate_amount, 'taxable_amount', NEW.taxable_amount, 'vat_rate', NEW.vat_rate, 'vat_amount', NEW.vat_amount, 'net_amount', NEW.net_amount, 'wht_amount', NEW.wht_amount, 'cash_amount', NEW.cash_amount, 'cheque_amount', NEW.cheque_amount, 'interest_amount', NEW.interest_amount, 'cash_discount_amount', NEW.cash_discount_amount, 'settled_amount', NEW.settled_amount, 'outstanding_amount', NEW.outstanding_amount, 'commission_amount', NEW.commission_amount, 'vat_basis', NEW.vat_basis, 'vat_date', NEW.vat_date, 'vat_period_id', NEW.vat_period_id, 'vat_late', NEW.vat_late), json_object('doc_status', NEW.doc_status, 'status_code', NEW.status_code, 'is_settled', NEW.is_settled, 'settled_date', NEW.settled_date, 'appointment_date', NEW.appointment_date, 'payment_date', NEW.payment_date, 'is_opening', NEW.is_opening, 'payment_terms', NEW.payment_terms, 'remark', NEW.remark, 'gl_posted', NEW.gl_posted, 'journal_id', NEW.journal_id, 'approved_by', NEW.approved_by, 'approved_at', NEW.approved_at, 'auth_user_id', NEW.auth_user_id, 'print_count', NEW.print_count, 'last_printed_by', NEW.last_printed_by, 'last_printed_at', NEW.last_printed_at, 'cancel_reason', NEW.cancel_reason, 'device_id', NEW.device_id, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id)),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_doc_header_ver AFTER UPDATE ON doc_header
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE doc_header SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_doc_line_insert_outbox AFTER INSERT ON doc_line
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'doc_line', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'header_id', NEW.header_id, 'line_no', NEW.line_no, 'line_kind', NEW.line_kind, 'item_id', NEW.item_id, 'account_id', NEW.account_id, 'description', NEW.description, 'warehouse_id', NEW.warehouse_id, 'department_id', NEW.department_id, 'project_id', NEW.project_id, 'project_phase', NEW.project_phase, 'cost_code', NEW.cost_code, 'qty', NEW.qty, 'unit_id', NEW.unit_id, 'factor', NEW.factor, 'base_qty', NEW.base_qty, 'unit_price', NEW.unit_price, 'discount_text', NEW.discount_text, 'discount_amount', NEW.discount_amount, 'line_amount', NEW.line_amount, 'net_amount', NEW.net_amount, 'vat_code', NEW.vat_code, 'is_free', NEW.is_free, 'return_to_stock', NEW.return_to_stock, 'stock_effect', NEW.stock_effect, 'movement_code', NEW.movement_code, 'cost_unit', NEW.cost_unit, 'cost_amount', NEW.cost_amount, 'sales_value', NEW.sales_value, 'source_line_id', NEW.source_line_id, 'party_customer_id', NEW.party_customer_id, 'party_supplier_id', NEW.party_supplier_id, 'salesperson_id', NEW.salesperson_id, 'ordered_qty', NEW.ordered_qty, 'remaining_qty', NEW.remaining_qty, 'cancelled_qty', NEW.cancelled_qty, 'cancel_reason_code', NEW.cancel_reason_code, 'cancel_date', NEW.cancel_date, 'delivery_date', NEW.delivery_date, 'gl_debit_account_id', NEW.gl_debit_account_id, 'gl_credit_account_id', NEW.gl_credit_account_id, 'packing', NEW.packing, 'reimburse_flag', NEW.reimburse_flag, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_doc_line_update_outbox AFTER UPDATE ON doc_line
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'doc_line', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'header_id', NEW.header_id, 'line_no', NEW.line_no, 'line_kind', NEW.line_kind, 'item_id', NEW.item_id, 'account_id', NEW.account_id, 'description', NEW.description, 'warehouse_id', NEW.warehouse_id, 'department_id', NEW.department_id, 'project_id', NEW.project_id, 'project_phase', NEW.project_phase, 'cost_code', NEW.cost_code, 'qty', NEW.qty, 'unit_id', NEW.unit_id, 'factor', NEW.factor, 'base_qty', NEW.base_qty, 'unit_price', NEW.unit_price, 'discount_text', NEW.discount_text, 'discount_amount', NEW.discount_amount, 'line_amount', NEW.line_amount, 'net_amount', NEW.net_amount, 'vat_code', NEW.vat_code, 'is_free', NEW.is_free, 'return_to_stock', NEW.return_to_stock, 'stock_effect', NEW.stock_effect, 'movement_code', NEW.movement_code, 'cost_unit', NEW.cost_unit, 'cost_amount', NEW.cost_amount, 'sales_value', NEW.sales_value, 'source_line_id', NEW.source_line_id, 'party_customer_id', NEW.party_customer_id, 'party_supplier_id', NEW.party_supplier_id, 'salesperson_id', NEW.salesperson_id, 'ordered_qty', NEW.ordered_qty, 'remaining_qty', NEW.remaining_qty, 'cancelled_qty', NEW.cancelled_qty, 'cancel_reason_code', NEW.cancel_reason_code, 'cancel_date', NEW.cancel_date, 'delivery_date', NEW.delivery_date, 'gl_debit_account_id', NEW.gl_debit_account_id, 'gl_credit_account_id', NEW.gl_credit_account_id, 'packing', NEW.packing, 'reimburse_flag', NEW.reimburse_flag, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_doc_line_ver AFTER UPDATE ON doc_line
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE doc_line SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_doc_note_insert_outbox AFTER INSERT ON doc_note
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'doc_note', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'header_id', NEW.header_id, 'line_id', NEW.line_id, 'seq', NEW.seq, 'text', NEW.text, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_doc_note_update_outbox AFTER UPDATE ON doc_note
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'doc_note', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'header_id', NEW.header_id, 'line_id', NEW.line_id, 'seq', NEW.seq, 'text', NEW.text, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_doc_note_ver AFTER UPDATE ON doc_note
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE doc_note SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_md_note_insert_outbox AFTER INSERT ON md_note
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_note', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'entity_type', NEW.entity_type, 'entity_id', NEW.entity_id, 'seq', NEW.seq, 'text', NEW.text, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_note_update_outbox AFTER UPDATE ON md_note
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_note', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'entity_type', NEW.entity_type, 'entity_id', NEW.entity_id, 'seq', NEW.seq, 'text', NEW.text, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_note_ver AFTER UPDATE ON md_note
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE md_note SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_doc_link_insert_outbox AFTER INSERT ON doc_link
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'doc_link', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'from_header_id', NEW.from_header_id, 'to_header_id', NEW.to_header_id, 'link_type', NEW.link_type, 'amount', NEW.amount, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_doc_link_update_outbox AFTER UPDATE ON doc_link
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'doc_link', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'from_header_id', NEW.from_header_id, 'to_header_id', NEW.to_header_id, 'link_type', NEW.link_type, 'amount', NEW.amount, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_doc_link_ver AFTER UPDATE ON doc_link
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE doc_link SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_doc_bill_item_insert_outbox AFTER INSERT ON doc_bill_item
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'doc_bill_item', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'bill_header_id', NEW.bill_header_id, 'invoice_header_id', NEW.invoice_header_id, 'amount', NEW.amount, 'vat_amount', NEW.vat_amount, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_doc_bill_item_update_outbox AFTER UPDATE ON doc_bill_item
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'doc_bill_item', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'bill_header_id', NEW.bill_header_id, 'invoice_header_id', NEW.invoice_header_id, 'amount', NEW.amount, 'vat_amount', NEW.vat_amount, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_doc_bill_item_ver AFTER UPDATE ON doc_bill_item
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE doc_bill_item SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_doc_settlement_insert_outbox AFTER INSERT ON doc_settlement
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'doc_settlement', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'payment_header_id', NEW.payment_header_id, 'payment_journal_id', NEW.payment_journal_id, 'invoice_header_id', NEW.invoice_header_id, 'express_rectype', NEW.express_rectype, 'amount', NEW.amount, 'vat_amount', NEW.vat_amount, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_doc_settlement_update_outbox AFTER UPDATE ON doc_settlement
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'doc_settlement', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'payment_header_id', NEW.payment_header_id, 'payment_journal_id', NEW.payment_journal_id, 'invoice_header_id', NEW.invoice_header_id, 'express_rectype', NEW.express_rectype, 'amount', NEW.amount, 'vat_amount', NEW.vat_amount, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_doc_settlement_ver AFTER UPDATE ON doc_settlement
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE doc_settlement SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_doc_payment_insert_outbox AFTER INSERT ON doc_payment
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'doc_payment', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'header_id', NEW.header_id, 'line_no', NEW.line_no, 'payment_method_id', NEW.payment_method_id, 'reference_no', NEW.reference_no, 'amount', NEW.amount, 'cheque_id', NEW.cheque_id, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_doc_payment_update_outbox AFTER UPDATE ON doc_payment
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'doc_payment', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'header_id', NEW.header_id, 'line_no', NEW.line_no, 'payment_method_id', NEW.payment_method_id, 'reference_no', NEW.reference_no, 'amount', NEW.amount, 'cheque_id', NEW.cheque_id, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_doc_payment_ver AFTER UPDATE ON doc_payment
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE doc_payment SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_fin_cheque_insert_outbox AFTER INSERT ON fin_cheque
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'fin_cheque', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'branch_id', NEW.branch_id, 'direction', NEW.direction, 'instrument', NEW.instrument, 'cheque_no', NEW.cheque_no, 'cheque_date', NEW.cheque_date, 'bank_id', NEW.bank_id, 'bank_branch', NEW.bank_branch, 'bank_account_id', NEW.bank_account_id, 'customer_id', NEW.customer_id, 'supplier_id', NEW.supplier_id, 'payee_name', NEW.payee_name, 'department_id', NEW.department_id, 'received_date', NEW.received_date, 'deposit_date', NEW.deposit_date, 'pass_date', NEW.pass_date, 'amount', NEW.amount, 'charge', NEW.charge, 'net_amount', NEW.net_amount, 'remaining_amount', NEW.remaining_amount, 'written_off_amount', NEW.written_off_amount, 'writeoff_journal_id', NEW.writeoff_journal_id, 'status', NEW.status, 'is_settled', NEW.is_settled, 'source_header_id', NEW.source_header_id, 'source_journal_id', NEW.source_journal_id, 'deposit_header_id', NEW.deposit_header_id, 'pass_journal_id', NEW.pass_journal_id, 'remark', NEW.remark, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_fin_cheque_update_outbox AFTER UPDATE ON fin_cheque
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'fin_cheque', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'branch_id', NEW.branch_id, 'direction', NEW.direction, 'instrument', NEW.instrument, 'cheque_no', NEW.cheque_no, 'cheque_date', NEW.cheque_date, 'bank_id', NEW.bank_id, 'bank_branch', NEW.bank_branch, 'bank_account_id', NEW.bank_account_id, 'customer_id', NEW.customer_id, 'supplier_id', NEW.supplier_id, 'payee_name', NEW.payee_name, 'department_id', NEW.department_id, 'received_date', NEW.received_date, 'deposit_date', NEW.deposit_date, 'pass_date', NEW.pass_date, 'amount', NEW.amount, 'charge', NEW.charge, 'net_amount', NEW.net_amount, 'remaining_amount', NEW.remaining_amount, 'written_off_amount', NEW.written_off_amount, 'writeoff_journal_id', NEW.writeoff_journal_id, 'status', NEW.status, 'is_settled', NEW.is_settled, 'source_header_id', NEW.source_header_id, 'source_journal_id', NEW.source_journal_id, 'deposit_header_id', NEW.deposit_header_id, 'pass_journal_id', NEW.pass_journal_id, 'remark', NEW.remark, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_fin_cheque_ver AFTER UPDATE ON fin_cheque
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE fin_cheque SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_fin_cheque_event_insert_outbox AFTER INSERT ON fin_cheque_event
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'fin_cheque_event', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'cheque_id', NEW.cheque_id, 'event_date', NEW.event_date, 'from_status', NEW.from_status, 'to_status', NEW.to_status, 'reason', NEW.reason, 'header_id', NEW.header_id, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_fin_cheque_event_update_outbox AFTER UPDATE ON fin_cheque_event
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'fin_cheque_event', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'cheque_id', NEW.cheque_id, 'event_date', NEW.event_date, 'from_status', NEW.from_status, 'to_status', NEW.to_status, 'reason', NEW.reason, 'header_id', NEW.header_id, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_fin_cheque_event_ver AFTER UPDATE ON fin_cheque_event
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE fin_cheque_event SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_inv_stock_balance_insert_outbox AFTER INSERT ON inv_stock_balance
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'inv_stock_balance', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'item_id', NEW.item_id, 'warehouse_id', NEW.warehouse_id, 'qty_on_hand', NEW.qty_on_hand, 'value_on_hand', NEW.value_on_hand, 'avg_cost', NEW.avg_cost, 'qty_on_order', NEW.qty_on_order, 'qty_reserved', NEW.qty_reserved, 'qty_offline_pending', NEW.qty_offline_pending, 'last_purchase_date', NEW.last_purchase_date, 'last_sale_date', NEW.last_sale_date, 'last_move_date', NEW.last_move_date, 'last_count_date', NEW.last_count_date, 'shelf', NEW.shelf, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_inv_stock_balance_update_outbox AFTER UPDATE ON inv_stock_balance
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'inv_stock_balance', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'item_id', NEW.item_id, 'warehouse_id', NEW.warehouse_id, 'qty_on_hand', NEW.qty_on_hand, 'value_on_hand', NEW.value_on_hand, 'avg_cost', NEW.avg_cost, 'qty_on_order', NEW.qty_on_order, 'qty_reserved', NEW.qty_reserved, 'qty_offline_pending', NEW.qty_offline_pending, 'last_purchase_date', NEW.last_purchase_date, 'last_sale_date', NEW.last_sale_date, 'last_move_date', NEW.last_move_date, 'last_count_date', NEW.last_count_date, 'shelf', NEW.shelf, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_inv_stock_balance_ver AFTER UPDATE ON inv_stock_balance
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE inv_stock_balance SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_inv_stock_count_insert_outbox AFTER INSERT ON inv_stock_count
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'inv_stock_count', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'warehouse_id', NEW.warehouse_id, 'item_id', NEW.item_id, 'count_date', NEW.count_date, 'shelf', NEW.shelf, 'counted_qty', NEW.counted_qty, 'counted_unit_qty', NEW.counted_unit_qty, 'system_qty', NEW.system_qty, 'diff_qty', NEW.diff_qty, 'flag', NEW.flag, 'adjust_line_id', NEW.adjust_line_id, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_inv_stock_count_update_outbox AFTER UPDATE ON inv_stock_count
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'inv_stock_count', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'warehouse_id', NEW.warehouse_id, 'item_id', NEW.item_id, 'count_date', NEW.count_date, 'shelf', NEW.shelf, 'counted_qty', NEW.counted_qty, 'counted_unit_qty', NEW.counted_unit_qty, 'system_qty', NEW.system_qty, 'diff_qty', NEW.diff_qty, 'flag', NEW.flag, 'adjust_line_id', NEW.adjust_line_id, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_inv_stock_count_ver AFTER UPDATE ON inv_stock_count
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE inv_stock_count SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_md_serial_insert_outbox AFTER INSERT ON md_serial
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_serial', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'serial_no', NEW.serial_no, 'machine_no', NEW.machine_no, 'category_code', NEW.category_code, 'item_id', NEW.item_id, 'sale_line_id', NEW.sale_line_id, 'sale_date', NEW.sale_date, 'warranty_end', NEW.warranty_end, 'customer_id', NEW.customer_id, 'description', NEW.description, 'ref_code', NEW.ref_code, 'customer_name', NEW.customer_name, 'salesperson_id', NEW.salesperson_id, 'print_count', NEW.print_count, 'last_printed_at', NEW.last_printed_at, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_serial_update_outbox AFTER UPDATE ON md_serial
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_serial', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'serial_no', NEW.serial_no, 'machine_no', NEW.machine_no, 'category_code', NEW.category_code, 'item_id', NEW.item_id, 'sale_line_id', NEW.sale_line_id, 'sale_date', NEW.sale_date, 'warranty_end', NEW.warranty_end, 'customer_id', NEW.customer_id, 'description', NEW.description, 'ref_code', NEW.ref_code, 'customer_name', NEW.customer_name, 'salesperson_id', NEW.salesperson_id, 'print_count', NEW.print_count, 'last_printed_at', NEW.last_printed_at, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_serial_ver AFTER UPDATE ON md_serial
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE md_serial SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_md_serial_service_insert_outbox AFTER INSERT ON md_serial_service
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_serial_service', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'serial_id', NEW.serial_id, 'service_date', NEW.service_date, 'service_by', NEW.service_by, 'detail', NEW.detail, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_serial_service_update_outbox AFTER UPDATE ON md_serial_service
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_serial_service', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'serial_id', NEW.serial_id, 'service_date', NEW.service_date, 'service_by', NEW.service_by, 'detail', NEW.detail, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_serial_service_ver AFTER UPDATE ON md_serial_service
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE md_serial_service SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_journal_insert_outbox AFTER INSERT ON gl_journal
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'gl_journal', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'branch_id', NEW.branch_id, 'journal_book_id', NEW.journal_book_id, 'voucher_no', NEW.voucher_no, 'voucher_date', NEW.voucher_date, 'period_id', NEW.period_id, 'description', NEW.description, 'reference', NEW.reference, 'source_module', NEW.source_module, 'source_header_id', NEW.source_header_id, 'status', NEW.status, 'doc_status', NEW.doc_status, 'reversal_of_id', NEW.reversal_of_id, 'posted_by', NEW.posted_by, 'posted_at', NEW.posted_at, 'total_debit', NEW.total_debit, 'total_credit', NEW.total_credit, 'print_count', NEW.print_count, 'approved_by', NEW.approved_by, 'approved_at', NEW.approved_at, 'last_printed_by', NEW.last_printed_by, 'last_printed_at', NEW.last_printed_at, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_journal_update_outbox AFTER UPDATE ON gl_journal
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'gl_journal', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'branch_id', NEW.branch_id, 'journal_book_id', NEW.journal_book_id, 'voucher_no', NEW.voucher_no, 'voucher_date', NEW.voucher_date, 'period_id', NEW.period_id, 'description', NEW.description, 'reference', NEW.reference, 'source_module', NEW.source_module, 'source_header_id', NEW.source_header_id, 'status', NEW.status, 'doc_status', NEW.doc_status, 'reversal_of_id', NEW.reversal_of_id, 'posted_by', NEW.posted_by, 'posted_at', NEW.posted_at, 'total_debit', NEW.total_debit, 'total_credit', NEW.total_credit, 'print_count', NEW.print_count, 'approved_by', NEW.approved_by, 'approved_at', NEW.approved_at, 'last_printed_by', NEW.last_printed_by, 'last_printed_at', NEW.last_printed_at, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_journal_ver AFTER UPDATE ON gl_journal
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE gl_journal SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_journal_line_insert_outbox AFTER INSERT ON gl_journal_line
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'gl_journal_line', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'journal_id', NEW.journal_id, 'line_no', NEW.line_no, 'account_id', NEW.account_id, 'department_id', NEW.department_id, 'project_id', NEW.project_id, 'project_phase', NEW.project_phase, 'cost_code', NEW.cost_code, 'description', NEW.description, 'bank_cleared_date', NEW.bank_cleared_date, 'debit', NEW.debit, 'credit', NEW.credit, 'posting_role', NEW.posting_role, 'resolved_from', NEW.resolved_from, 'changed_from_account_id', NEW.changed_from_account_id, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_journal_line_update_outbox AFTER UPDATE ON gl_journal_line
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'gl_journal_line', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'journal_id', NEW.journal_id, 'line_no', NEW.line_no, 'account_id', NEW.account_id, 'department_id', NEW.department_id, 'project_id', NEW.project_id, 'project_phase', NEW.project_phase, 'cost_code', NEW.cost_code, 'description', NEW.description, 'bank_cleared_date', NEW.bank_cleared_date, 'debit', NEW.debit, 'credit', NEW.credit, 'posting_role', NEW.posting_role, 'resolved_from', NEW.resolved_from, 'changed_from_account_id', NEW.changed_from_account_id, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_journal_line_ver AFTER UPDATE ON gl_journal_line
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE gl_journal_line SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_inventory_balance_insert_outbox AFTER INSERT ON gl_inventory_balance
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'gl_inventory_balance', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'fiscal_year_id', NEW.fiscal_year_id, 'account_id', NEW.account_id, 'department_id', NEW.department_id, 'period_no', NEW.period_no, 'amount', NEW.amount, 'source', NEW.source, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_inventory_balance_update_outbox AFTER UPDATE ON gl_inventory_balance
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'gl_inventory_balance', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'fiscal_year_id', NEW.fiscal_year_id, 'account_id', NEW.account_id, 'department_id', NEW.department_id, 'period_no', NEW.period_no, 'amount', NEW.amount, 'source', NEW.source, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_inventory_balance_ver AFTER UPDATE ON gl_inventory_balance
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE gl_inventory_balance SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_fin_bank_statement_insert_outbox AFTER INSERT ON fin_bank_statement
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'fin_bank_statement', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'bank_account_id', NEW.bank_account_id, 'statement_date', NEW.statement_date, 'closing_balance', NEW.closing_balance, 'remark', NEW.remark, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_fin_bank_statement_update_outbox AFTER UPDATE ON fin_bank_statement
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'fin_bank_statement', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'bank_account_id', NEW.bank_account_id, 'statement_date', NEW.statement_date, 'closing_balance', NEW.closing_balance, 'remark', NEW.remark, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_fin_bank_statement_ver AFTER UPDATE ON fin_bank_statement
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE fin_bank_statement SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_budget_insert_outbox AFTER INSERT ON gl_budget
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'gl_budget', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'account_id', NEW.account_id, 'department_id', NEW.department_id, 'period_id', NEW.period_id, 'amount', NEW.amount, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_budget_update_outbox AFTER UPDATE ON gl_budget
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'gl_budget', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'account_id', NEW.account_id, 'department_id', NEW.department_id, 'period_id', NEW.period_id, 'amount', NEW.amount, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_budget_ver AFTER UPDATE ON gl_budget
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE gl_budget SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_prior_year_balance_insert_outbox AFTER INSERT ON gl_prior_year_balance
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'gl_prior_year_balance', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'fiscal_year_id', NEW.fiscal_year_id, 'account_id', NEW.account_id, 'department_id', NEW.department_id, 'period_no', NEW.period_no, 'debit', NEW.debit, 'credit', NEW.credit, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_prior_year_balance_update_outbox AFTER UPDATE ON gl_prior_year_balance
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'gl_prior_year_balance', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'fiscal_year_id', NEW.fiscal_year_id, 'account_id', NEW.account_id, 'department_id', NEW.department_id, 'period_no', NEW.period_no, 'debit', NEW.debit, 'credit', NEW.credit, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_prior_year_balance_ver AFTER UPDATE ON gl_prior_year_balance
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE gl_prior_year_balance SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_fs_report_insert_outbox AFTER INSERT ON gl_fs_report
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'gl_fs_report', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'code', NEW.code, 'name', NEW.name, 'header_lines', NEW.header_lines, 'columns', NEW.columns, 'line_set_code', NEW.line_set_code, 'number_format', NEW.number_format, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_fs_report_update_outbox AFTER UPDATE ON gl_fs_report
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'gl_fs_report', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'code', NEW.code, 'name', NEW.name, 'header_lines', NEW.header_lines, 'columns', NEW.columns, 'line_set_code', NEW.line_set_code, 'number_format', NEW.number_format, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_fs_report_ver AFTER UPDATE ON gl_fs_report
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE gl_fs_report SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_fs_line_insert_outbox AFTER INSERT ON gl_fs_line
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'gl_fs_line', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'line_set_code', NEW.line_set_code, 'line_no', NEW.line_no, 'data_type', NEW.data_type, 'source', NEW.source, 'sign_filter', NEW.sign_filter, 'description_th', NEW.description_th, 'description_en', NEW.description_en, 'print_condition', NEW.print_condition, 'accumulate', NEW.accumulate, 'department_id', NEW.department_id, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_fs_line_update_outbox AFTER UPDATE ON gl_fs_line
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'gl_fs_line', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'line_set_code', NEW.line_set_code, 'line_no', NEW.line_no, 'data_type', NEW.data_type, 'source', NEW.source, 'sign_filter', NEW.sign_filter, 'description_th', NEW.description_th, 'description_en', NEW.description_en, 'print_condition', NEW.print_condition, 'accumulate', NEW.accumulate, 'department_id', NEW.department_id, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_gl_fs_line_ver AFTER UPDATE ON gl_fs_line
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE gl_fs_line SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_tax_vat_entry_insert_outbox AFTER INSERT ON tax_vat_entry
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'tax_vat_entry', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'vat_kind', NEW.vat_kind, 'header_id', NEW.header_id, 'journal_id', NEW.journal_id, 'branch_id', NEW.branch_id, 'doc_no', NEW.doc_no, 'doc_date', NEW.doc_date, 'tax_invoice_no', NEW.tax_invoice_no, 'tax_invoice_date', NEW.tax_invoice_date, 'vat_period_id', NEW.vat_period_id, 'is_late', NEW.is_late, 'department_id', NEW.department_id, 'description', NEW.description, 'party_name', NEW.party_name, 'party_tax_id', NEW.party_tax_id, 'party_tax_branch_no', NEW.party_tax_branch_no, 'base_amount', NEW.base_amount, 'vat_amount', NEW.vat_amount, 'zero_rate_amount', NEW.zero_rate_amount, 'nonclaim_base', NEW.nonclaim_base, 'nonclaim_vat', NEW.nonclaim_vat, 'is_manual', NEW.is_manual, 'is_modified', NEW.is_modified, 'doc_status', NEW.doc_status, 'remark', NEW.remark, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_tax_vat_entry_update_outbox AFTER UPDATE ON tax_vat_entry
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'tax_vat_entry', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'vat_kind', NEW.vat_kind, 'header_id', NEW.header_id, 'journal_id', NEW.journal_id, 'branch_id', NEW.branch_id, 'doc_no', NEW.doc_no, 'doc_date', NEW.doc_date, 'tax_invoice_no', NEW.tax_invoice_no, 'tax_invoice_date', NEW.tax_invoice_date, 'vat_period_id', NEW.vat_period_id, 'is_late', NEW.is_late, 'department_id', NEW.department_id, 'description', NEW.description, 'party_name', NEW.party_name, 'party_tax_id', NEW.party_tax_id, 'party_tax_branch_no', NEW.party_tax_branch_no, 'base_amount', NEW.base_amount, 'vat_amount', NEW.vat_amount, 'zero_rate_amount', NEW.zero_rate_amount, 'nonclaim_base', NEW.nonclaim_base, 'nonclaim_vat', NEW.nonclaim_vat, 'is_manual', NEW.is_manual, 'is_modified', NEW.is_modified, 'doc_status', NEW.doc_status, 'remark', NEW.remark, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_tax_vat_entry_ver AFTER UPDATE ON tax_vat_entry
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE tax_vat_entry SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_tax_wht_entry_insert_outbox AFTER INSERT ON tax_wht_entry
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'tax_wht_entry', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'form_type', NEW.form_type, 'header_id', NEW.header_id, 'branch_id', NEW.branch_id, 'certificate_no', NEW.certificate_no, 'certificate_date', NEW.certificate_date, 'tax_period_id', NEW.tax_period_id, 'is_late', NEW.is_late, 'supplier_id', NEW.supplier_id, 'customer_id', NEW.customer_id, 'payee_name', NEW.payee_name, 'payee_address', NEW.payee_address, 'payee_tax_id', NEW.payee_tax_id, 'payee_tax_branch_no', NEW.payee_tax_branch_no, 'income_type', NEW.income_type, 'paid_amount', NEW.paid_amount, 'rate', NEW.rate, 'tax_amount', NEW.tax_amount, 'condition', NEW.condition, 'social_security_amount', NEW.social_security_amount, 'provident_fund_amount', NEW.provident_fund_amount, 'department_id', NEW.department_id, 'print_count', NEW.print_count, 'doc_status', NEW.doc_status, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_tax_wht_entry_update_outbox AFTER UPDATE ON tax_wht_entry
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'tax_wht_entry', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'form_type', NEW.form_type, 'header_id', NEW.header_id, 'branch_id', NEW.branch_id, 'certificate_no', NEW.certificate_no, 'certificate_date', NEW.certificate_date, 'tax_period_id', NEW.tax_period_id, 'is_late', NEW.is_late, 'supplier_id', NEW.supplier_id, 'customer_id', NEW.customer_id, 'payee_name', NEW.payee_name, 'payee_address', NEW.payee_address, 'payee_tax_id', NEW.payee_tax_id, 'payee_tax_branch_no', NEW.payee_tax_branch_no, 'income_type', NEW.income_type, 'paid_amount', NEW.paid_amount, 'rate', NEW.rate, 'tax_amount', NEW.tax_amount, 'condition', NEW.condition, 'social_security_amount', NEW.social_security_amount, 'provident_fund_amount', NEW.provident_fund_amount, 'department_id', NEW.department_id, 'print_count', NEW.print_count, 'doc_status', NEW.doc_status, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_tax_wht_entry_ver AFTER UPDATE ON tax_wht_entry
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE tax_wht_entry SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_md_asset_account_group_insert_outbox AFTER INSERT ON md_asset_account_group
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_asset_account_group', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'code', NEW.code, 'name_th', NEW.name_th, 'name_en', NEW.name_en, 'asset_account_id', NEW.asset_account_id, 'depr_expense_account_id', NEW.depr_expense_account_id, 'accum_depr_account_id', NEW.accum_depr_account_id, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_asset_account_group_update_outbox AFTER UPDATE ON md_asset_account_group
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'md_asset_account_group', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'code', NEW.code, 'name_th', NEW.name_th, 'name_en', NEW.name_en, 'asset_account_id', NEW.asset_account_id, 'depr_expense_account_id', NEW.depr_expense_account_id, 'accum_depr_account_id', NEW.accum_depr_account_id, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_md_asset_account_group_ver AFTER UPDATE ON md_asset_account_group
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE md_asset_account_group SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_fa_asset_insert_outbox AFTER INSERT ON fa_asset
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'fa_asset', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'code', NEW.code, 'name_th', NEW.name_th, 'name_en', NEW.name_en, 'category_code', NEW.category_code, 'account_group_id', NEW.account_group_id, 'is_depreciable', NEW.is_depreciable, 'serial_no', NEW.serial_no, 'department_id', NEW.department_id, 'branch_id', NEW.branch_id, 'purchase_date', NEW.purchase_date, 'cost', NEW.cost, 'salvage_value', NEW.salvage_value, 'method', NEW.method, 'start_date', NEW.start_date, 'useful_life_years', NEW.useful_life_years, 'rate', NEW.rate, 'end_date', NEW.end_date, 'depr_monthly', NEW.depr_monthly, 'accum_depr_bf', NEW.accum_depr_bf, 'accum_bf_date', NEW.accum_bf_date, 'manual_depr', NEW.manual_depr, 'manual_depr_to', NEW.manual_depr_to, 'sold_date', NEW.sold_date, 'sold_amount', NEW.sold_amount, 'sold_header_id', NEW.sold_header_id, 'status', NEW.status, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_fa_asset_update_outbox AFTER UPDATE ON fa_asset
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'fa_asset', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'code', NEW.code, 'name_th', NEW.name_th, 'name_en', NEW.name_en, 'category_code', NEW.category_code, 'account_group_id', NEW.account_group_id, 'is_depreciable', NEW.is_depreciable, 'serial_no', NEW.serial_no, 'department_id', NEW.department_id, 'branch_id', NEW.branch_id, 'purchase_date', NEW.purchase_date, 'cost', NEW.cost, 'salvage_value', NEW.salvage_value, 'method', NEW.method, 'start_date', NEW.start_date, 'useful_life_years', NEW.useful_life_years, 'rate', NEW.rate, 'end_date', NEW.end_date, 'depr_monthly', NEW.depr_monthly, 'accum_depr_bf', NEW.accum_depr_bf, 'accum_bf_date', NEW.accum_bf_date, 'manual_depr', NEW.manual_depr, 'manual_depr_to', NEW.manual_depr_to, 'sold_date', NEW.sold_date, 'sold_amount', NEW.sold_amount, 'sold_header_id', NEW.sold_header_id, 'status', NEW.status, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_fa_asset_ver AFTER UPDATE ON fa_asset
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE fa_asset SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_fa_depreciation_insert_outbox AFTER INSERT ON fa_depreciation
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'fa_depreciation', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'asset_id', NEW.asset_id, 'period_id', NEW.period_id, 'amount', NEW.amount, 'journal_id', NEW.journal_id, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_fa_depreciation_update_outbox AFTER UPDATE ON fa_depreciation
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'fa_depreciation', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'asset_id', NEW.asset_id, 'period_id', NEW.period_id, 'amount', NEW.amount, 'journal_id', NEW.journal_id, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_fa_depreciation_ver AFTER UPDATE ON fa_depreciation
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE fa_depreciation SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_sync_conflict_insert_outbox AFTER INSERT ON sync_conflict
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'sync_conflict', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          NULL, json_object('id', NEW.id, 'company_id', NEW.company_id, 'table_name', NEW.table_name, 'row_id', NEW.row_id, 'device_id', NEW.device_id, 'server_version', NEW.server_version, 'client_version', NEW.client_version, 'client_payload', NEW.client_payload, 'reason', NEW.reason, 'resolution', NEW.resolution, 'resolved_by', NEW.resolved_by, 'resolved_at', NEW.resolved_at, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_sync_conflict_update_outbox AFTER UPDATE ON sync_conflict
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1' AND NEW.row_version <> OLD.row_version
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))), (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), 'sync_conflict', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          OLD.row_version, json_object('id', NEW.id, 'company_id', NEW.company_id, 'table_name', NEW.table_name, 'row_id', NEW.row_id, 'device_id', NEW.device_id, 'server_version', NEW.server_version, 'client_version', NEW.client_version, 'client_payload', NEW.client_payload, 'reason', NEW.reason, 'resolution', NEW.resolution, 'resolved_by', NEW.resolved_by, 'resolved_at', NEW.resolved_at, 'created_at', NEW.created_at, 'created_by', NEW.created_by, 'updated_at', NEW.updated_at, 'updated_by', NEW.updated_by, 'row_version', NEW.row_version, 'deleted_at', NEW.deleted_at, 'origin_device_id', NEW.origin_device_id),
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_sync_conflict_ver AFTER UPDATE ON sync_conflict
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE sync_conflict SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
