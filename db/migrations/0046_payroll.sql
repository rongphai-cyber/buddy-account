-- ระบบเงินเดือน ระยะ 1 (02/11/2569): รายการเงินได้/เงินหัก ทะเบียนพนักงาน ประวัติค่าจ้าง ค่าลดหย่อน รายการประจำ ยอดยกมา อัตราตามกฎหมาย รอบเงินเดือน
CREATE TABLE pay_item (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  code varchar(20) NOT NULL,
  name_th varchar(120) NOT NULL,
  name_en varchar(120),
  kind char(1) NOT NULL CHECK (kind IN ('E','D')),
  tax_bucket char(1) DEFAULT 'N' NOT NULL CHECK (tax_bucket IN ('R','S','N')),
  sso_base boolean DEFAULT false NOT NULL,
  pvd_base boolean DEFAULT false NOT NULL,
  calc varchar(10) DEFAULT 'AMOUNT' NOT NULL CHECK (calc IN ('AMOUNT','WAGE','HOURS','DAYS','MINUTES','SYSTEM')),
  multiplier numeric(9,4),
  multiplier_daily numeric(9,4),
  sign smallint DEFAULT 1 NOT NULL CHECK (sign IN (1,-1)),
  gl_role varchar(30) NOT NULL,
  account_id uuid,
  system_code varchar(20),
  sort_order integer DEFAULT 0 NOT NULL,
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
COMMENT ON TABLE pay_item IS 'รายการเงินได้/เงินหักของเงินเดือน — รายการของโปรแกรม (system_code) แก้รหัส/ลบ/เลิกใช้ไม่ได้ | Express: (ใหม่)';
COMMENT ON COLUMN pay_item.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN pay_item.company_id IS 'บริษัท';
COMMENT ON COLUMN pay_item.code IS 'รหัสรายการ เช่น IN001 ES001';
COMMENT ON COLUMN pay_item.name_th IS 'ชื่อไทย';
COMMENT ON COLUMN pay_item.name_en IS 'ชื่ออังกฤษ';
COMMENT ON COLUMN pay_item.kind IS 'E=เงินได้ D=เงินหัก';
COMMENT ON COLUMN pay_item.tax_bucket IS 'R=เงินได้ประจำ S=เงินได้ไม่ประจำ N=ไม่คิดภาษี';
COMMENT ON COLUMN pay_item.sso_base IS 'นับเป็นค่าจ้างคิดเงินสมทบประกันสังคม';
COMMENT ON COLUMN pay_item.pvd_base IS 'นับเป็นค่าจ้างคิดกองทุนสำรองเลี้ยงชีพ';
COMMENT ON COLUMN pay_item.calc IS 'AMOUNT WAGE HOURS DAYS MINUTES SYSTEM';
COMMENT ON COLUMN pay_item.multiplier IS 'ตัวคูณ (OT) พนักงานรายเดือน';
COMMENT ON COLUMN pay_item.multiplier_daily IS 'ตัวคูณ (OT) พนักงานรายวัน/ชั่วโมง';
COMMENT ON COLUMN pay_item.sign IS '1 หรือ -1 (หักขาดงาน/มาสาย ลดค่าจ้าง)';
COMMENT ON COLUMN pay_item.gl_role IS 'บทบาทบัญชี (การเชื่อมต่อบัญชี) เมื่อไม่ได้กำหนดบัญชีเอง';
COMMENT ON COLUMN pay_item.account_id IS 'บัญชีที่ลง (ว่าง = ตามบทบาท)';
COMMENT ON COLUMN pay_item.system_code IS 'WAGE OT HOLIDAY HOLIDAY_OT ABSENCE LATE TAX SSO PVD — รายการของโปรแกรม';
COMMENT ON COLUMN pay_item.sort_order IS 'ลำดับแสดง';
COMMENT ON COLUMN pay_item.status IS 'A=ใช้งาน I=เลิกใช้';
COMMENT ON COLUMN pay_item.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN pay_item.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN pay_item.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN pay_item.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN pay_item.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN pay_item.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN pay_item.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_pay_item_company_code ON pay_item (company_id, code) WHERE deleted_at IS NULL;
CREATE TABLE pay_employee (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  code varchar(20) NOT NULL,
  title varchar(30),
  first_name varchar(100) NOT NULL,
  last_name varchar(100),
  first_name_en varchar(100),
  last_name_en varchar(100),
  nickname varchar(60),
  tax_id varchar(20),
  gender char(1) CHECK (gender IN ('M','F')),
  birth_date date,
  nationality varchar(60),
  reg_house_no varchar(30),
  reg_moo varchar(10),
  reg_village varchar(100),
  reg_building varchar(100),
  reg_soi varchar(100),
  reg_road varchar(100),
  reg_subdistrict varchar(100),
  reg_district varchar(100),
  reg_province varchar(100),
  reg_postcode varchar(5),
  current_address text,
  phone varchar(60),
  email varchar(120),
  department_id uuid,
  branch_id uuid,
  position varchar(100),
  employee_type varchar(60),
  hire_date date NOT NULL,
  end_date date,
  end_reason varchar(120),
  wage_type char(1) DEFAULT 'M' NOT NULL CHECK (wage_type IN ('M','D','H')),
  pay_method char(1) DEFAULT 'B' NOT NULL CHECK (pay_method IN ('B','C')),
  bank_id uuid,
  bank_account_no varchar(20),
  bank_account_name varchar(120),
  tax_bearer char(1) DEFAULT 'W' NOT NULL CHECK (tax_bearer IN ('W','O','F','N')),
  sso_insured boolean DEFAULT true NOT NULL,
  sso_hospital varchar(120),
  pvd_member boolean DEFAULT false NOT NULL,
  pvd_join_date date,
  pvd_employee_rate numeric(9,4) DEFAULT 0 NOT NULL,
  pvd_employer_rate numeric(9,4) DEFAULT 0 NOT NULL,
  note text,
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
COMMENT ON TABLE pay_employee IS 'ทะเบียนพนักงาน (ระบบเงินเดือน) | Express: (ใหม่)';
COMMENT ON COLUMN pay_employee.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN pay_employee.company_id IS 'บริษัท';
COMMENT ON COLUMN pay_employee.code IS 'รหัสพนักงาน';
COMMENT ON COLUMN pay_employee.title IS 'คำนำหน้า';
COMMENT ON COLUMN pay_employee.first_name IS 'ชื่อ';
COMMENT ON COLUMN pay_employee.last_name IS 'นามสกุล';
COMMENT ON COLUMN pay_employee.first_name_en IS 'ชื่ออังกฤษ';
COMMENT ON COLUMN pay_employee.last_name_en IS 'นามสกุลอังกฤษ';
COMMENT ON COLUMN pay_employee.nickname IS 'ชื่อเล่น';
COMMENT ON COLUMN pay_employee.tax_id IS 'เลขประจำตัวประชาชน 13 หลัก (= เลขผู้เสียภาษี/เลขประกันสังคม) หรือเลขหนังสือเดินทาง';
COMMENT ON COLUMN pay_employee.gender IS 'M=ชาย F=หญิง';
COMMENT ON COLUMN pay_employee.birth_date IS 'วันเกิด';
COMMENT ON COLUMN pay_employee.nationality IS 'สัญชาติ';
COMMENT ON COLUMN pay_employee.reg_house_no IS 'ที่อยู่ตามทะเบียนบ้าน: เลขที่';
COMMENT ON COLUMN pay_employee.reg_moo IS 'หมู่ที่';
COMMENT ON COLUMN pay_employee.reg_village IS 'หมู่บ้าน';
COMMENT ON COLUMN pay_employee.reg_building IS 'อาคาร';
COMMENT ON COLUMN pay_employee.reg_soi IS 'ซอย';
COMMENT ON COLUMN pay_employee.reg_road IS 'ถนน';
COMMENT ON COLUMN pay_employee.reg_subdistrict IS 'ตำบล/แขวง';
COMMENT ON COLUMN pay_employee.reg_district IS 'อำเภอ/เขต';
COMMENT ON COLUMN pay_employee.reg_province IS 'จังหวัด';
COMMENT ON COLUMN pay_employee.reg_postcode IS 'รหัสไปรษณีย์';
COMMENT ON COLUMN pay_employee.current_address IS 'ที่อยู่ปัจจุบัน (ว่าง = ตามทะเบียนบ้าน)';
COMMENT ON COLUMN pay_employee.phone IS 'โทรศัพท์';
COMMENT ON COLUMN pay_employee.email IS 'อีเมล';
COMMENT ON COLUMN pay_employee.department_id IS 'แผนก (ลงบัญชีค่าใช้จ่ายตามแผนก)';
COMMENT ON COLUMN pay_employee.branch_id IS 'สาขาที่สังกัด (ว่าง = สำนักงานใหญ่)';
COMMENT ON COLUMN pay_employee.position IS 'ตำแหน่ง';
COMMENT ON COLUMN pay_employee.employee_type IS 'ประเภทพนักงาน เช่น ประจำ รายวัน ทดลองงาน';
COMMENT ON COLUMN pay_employee.hire_date IS 'วันเริ่มงาน';
COMMENT ON COLUMN pay_employee.end_date IS 'วันที่ออก (วันทำงานวันสุดท้าย)';
COMMENT ON COLUMN pay_employee.end_reason IS 'สาเหตุที่ออก';
COMMENT ON COLUMN pay_employee.wage_type IS 'M=รายเดือน D=รายวัน H=รายชั่วโมง (ตามประวัติค่าจ้างล่าสุด)';
COMMENT ON COLUMN pay_employee.pay_method IS 'B=โอนเข้าบัญชี C=เงินสด';
COMMENT ON COLUMN pay_employee.bank_id IS 'ธนาคารที่รับเงินเดือน';
COMMENT ON COLUMN pay_employee.bank_account_no IS 'เลขที่บัญชีธนาคาร';
COMMENT ON COLUMN pay_employee.bank_account_name IS 'ชื่อบัญชี';
COMMENT ON COLUMN pay_employee.tax_bearer IS 'W=หัก ณ ที่จ่าย O=บริษัทออกให้ครั้งเดียว F=ออกให้ตลอดไป N=ไม่หักภาษี';
COMMENT ON COLUMN pay_employee.sso_insured IS 'เป็นผู้ประกันตน ม.33';
COMMENT ON COLUMN pay_employee.sso_hospital IS 'สถานพยาบาลประกันสังคม';
COMMENT ON COLUMN pay_employee.pvd_member IS 'เป็นสมาชิกกองทุนสำรองเลี้ยงชีพ';
COMMENT ON COLUMN pay_employee.pvd_join_date IS 'วันที่เข้ากองทุน';
COMMENT ON COLUMN pay_employee.pvd_employee_rate IS 'อัตราเงินสะสม (ลูกจ้าง) %';
COMMENT ON COLUMN pay_employee.pvd_employer_rate IS 'อัตราเงินสมทบ (นายจ้าง) %';
COMMENT ON COLUMN pay_employee.note IS 'หมายเหตุ';
COMMENT ON COLUMN pay_employee.status IS 'A=ใช้งาน I=เลิกใช้';
COMMENT ON COLUMN pay_employee.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN pay_employee.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN pay_employee.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN pay_employee.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN pay_employee.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN pay_employee.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN pay_employee.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_pay_employee_company_code ON pay_employee (company_id, code) WHERE deleted_at IS NULL;
CREATE INDEX ix_pay_employee_company_tax ON pay_employee (company_id, tax_id);
CREATE TABLE pay_salary (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  effective_from date NOT NULL,
  wage_type char(1) NOT NULL CHECK (wage_type IN ('M','D','H')),
  rate numeric(18,2) NOT NULL,
  reason varchar(200),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE pay_salary IS 'ประวัติค่าจ้างของพนักงาน (อัตราที่มีผลตั้งแต่วันที่) | Express: (ใหม่)';
COMMENT ON COLUMN pay_salary.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN pay_salary.company_id IS 'บริษัท';
COMMENT ON COLUMN pay_salary.employee_id IS 'พนักงาน';
COMMENT ON COLUMN pay_salary.effective_from IS 'มีผลตั้งแต่';
COMMENT ON COLUMN pay_salary.wage_type IS 'M=รายเดือน D=รายวัน H=รายชั่วโมง';
COMMENT ON COLUMN pay_salary.rate IS 'อัตราค่าจ้าง (บาทต่อเดือน/วัน/ชั่วโมง)';
COMMENT ON COLUMN pay_salary.reason IS 'เหตุผล เช่น เริ่มงาน ปรับประจำปี';
COMMENT ON COLUMN pay_salary.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN pay_salary.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN pay_salary.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN pay_salary.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN pay_salary.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN pay_salary.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN pay_salary.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_pay_salary_employee_effective_from ON pay_salary (employee_id, effective_from) WHERE deleted_at IS NULL;
CREATE TABLE pay_allowance (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  tax_year smallint NOT NULL,
  allowance_values jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE pay_allowance IS 'ค่าลดหย่อนภาษีของพนักงานรายปี | Express: (ใหม่)';
COMMENT ON COLUMN pay_allowance.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN pay_allowance.company_id IS 'บริษัท';
COMMENT ON COLUMN pay_allowance.employee_id IS 'พนักงาน';
COMMENT ON COLUMN pay_allowance.tax_year IS 'ปีภาษี (ค.ศ.)';
COMMENT ON COLUMN pay_allowance.allowance_values IS 'รหัสค่าลดหย่อน → ติ๊ก/จำนวนคน/จำนวนเงิน (รหัสตาม PayrollTaxRules.allowances)';
COMMENT ON COLUMN pay_allowance.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN pay_allowance.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN pay_allowance.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN pay_allowance.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN pay_allowance.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN pay_allowance.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN pay_allowance.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_pay_allowance_employee_tax_year ON pay_allowance (employee_id, tax_year) WHERE deleted_at IS NULL;
CREATE TABLE pay_recurring (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  item_id uuid NOT NULL,
  amount numeric(18,2) NOT NULL,
  from_month date NOT NULL,
  to_month date,
  note varchar(200),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE pay_recurring IS 'รายการประจำของพนักงาน (เงินได้/เงินหักทุกงวด) | Express: (ใหม่)';
COMMENT ON COLUMN pay_recurring.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN pay_recurring.company_id IS 'บริษัท';
COMMENT ON COLUMN pay_recurring.employee_id IS 'พนักงาน';
COMMENT ON COLUMN pay_recurring.item_id IS 'รายการ (เฉพาะแบบจำนวนเงิน)';
COMMENT ON COLUMN pay_recurring.amount IS 'จำนวนเงินต่องวด';
COMMENT ON COLUMN pay_recurring.from_month IS 'ตั้งแต่เดือน (วันที่ 1)';
COMMENT ON COLUMN pay_recurring.to_month IS 'ถึงเดือน (ว่าง = ไม่มีกำหนด)';
COMMENT ON COLUMN pay_recurring.note IS 'หมายเหตุ';
COMMENT ON COLUMN pay_recurring.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN pay_recurring.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN pay_recurring.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN pay_recurring.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN pay_recurring.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN pay_recurring.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN pay_recurring.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE TABLE pay_ytd_opening (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  tax_year smallint NOT NULL,
  through_month smallint NOT NULL CHECK (through_month BETWEEN 1 AND 12),
  regular numeric(18,2) DEFAULT 0 NOT NULL,
  special numeric(18,2) DEFAULT 0 NOT NULL,
  tax numeric(18,2) DEFAULT 0 NOT NULL,
  special_tax numeric(18,2) DEFAULT 0 NOT NULL,
  sso numeric(18,2) DEFAULT 0 NOT NULL,
  pvd numeric(18,2) DEFAULT 0 NOT NULL,
  note varchar(200),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE pay_ytd_opening IS 'ยอดสะสมยกมาต้นปีของพนักงาน (เริ่มใช้โปรแกรมกลางปี) | Express: (ใหม่)';
COMMENT ON COLUMN pay_ytd_opening.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN pay_ytd_opening.company_id IS 'บริษัท';
COMMENT ON COLUMN pay_ytd_opening.employee_id IS 'พนักงาน';
COMMENT ON COLUMN pay_ytd_opening.tax_year IS 'ปีภาษี (ค.ศ.)';
COMMENT ON COLUMN pay_ytd_opening.through_month IS 'ยอดถึงสิ้นเดือนที่ (1–12)';
COMMENT ON COLUMN pay_ytd_opening.regular IS 'เงินได้ประจำที่จ่ายแล้ว';
COMMENT ON COLUMN pay_ytd_opening.special IS 'เงินได้ไม่ประจำที่จ่ายแล้ว';
COMMENT ON COLUMN pay_ytd_opening.tax IS 'ภาษีที่หักแล้วทั้งหมด';
COMMENT ON COLUMN pay_ytd_opening.special_tax IS 'ภาษีของเงินได้ไม่ประจำ (ส่วนหนึ่งของภาษีที่หักแล้ว)';
COMMENT ON COLUMN pay_ytd_opening.sso IS 'เงินสมทบประกันสังคม (ลูกจ้าง)';
COMMENT ON COLUMN pay_ytd_opening.pvd IS 'เงินสะสมกองทุนสำรองเลี้ยงชีพ (ลูกจ้าง)';
COMMENT ON COLUMN pay_ytd_opening.note IS 'หมายเหตุ';
COMMENT ON COLUMN pay_ytd_opening.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN pay_ytd_opening.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN pay_ytd_opening.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN pay_ytd_opening.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN pay_ytd_opening.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN pay_ytd_opening.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN pay_ytd_opening.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_pay_ytd_opening_employee_tax_year ON pay_ytd_opening (employee_id, tax_year) WHERE deleted_at IS NULL;
CREATE TABLE pay_law (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  kind varchar(10) NOT NULL CHECK (kind IN ('TAX','SSO')),
  effective_from date NOT NULL,
  rules jsonb NOT NULL,
  note varchar(200),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE pay_law IS 'อัตราภาษีเงินได้/ประกันสังคมที่บริษัทกำหนดแทนค่าตามกฎหมายในโปรแกรม | Express: (ใหม่)';
COMMENT ON COLUMN pay_law.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN pay_law.company_id IS 'บริษัท';
COMMENT ON COLUMN pay_law.kind IS 'TAX=ภาษีรายปี SSO=อัตราประกันสังคม';
COMMENT ON COLUMN pay_law.effective_from IS 'TAX = 1 ม.ค. ของปีภาษี · SSO = วันที่มีผล';
COMMENT ON COLUMN pay_law.rules IS 'กฎ (PayrollTaxRules หรือ SsoRate)';
COMMENT ON COLUMN pay_law.note IS 'หมายเหตุ เช่น ประกาศที่อ้างอิง';
COMMENT ON COLUMN pay_law.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN pay_law.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN pay_law.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN pay_law.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN pay_law.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN pay_law.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN pay_law.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_pay_law_company_kind_effective_from ON pay_law (company_id, kind, effective_from) WHERE deleted_at IS NULL;
CREATE TABLE pay_run (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  doc_no varchar(30),
  run_type char(1) DEFAULT 'R' NOT NULL CHECK (run_type IN ('R','B')),
  branch_id uuid,
  period_from date NOT NULL,
  period_to date NOT NULL,
  pay_date date NOT NULL,
  tax_month date NOT NULL,
  status char(1) DEFAULT 'D' NOT NULL CHECK (status IN ('D','N','P','C')),
  journal_id uuid,
  pay_journal_id uuid,
  pay_account_id uuid,
  paid_date date,
  headcount integer DEFAULT 0 NOT NULL,
  total_gross numeric(18,2) DEFAULT 0 NOT NULL,
  total_tax numeric(18,2) DEFAULT 0 NOT NULL,
  total_sso_ee numeric(18,2) DEFAULT 0 NOT NULL,
  total_sso_er numeric(18,2) DEFAULT 0 NOT NULL,
  total_pvd_ee numeric(18,2) DEFAULT 0 NOT NULL,
  total_pvd_er numeric(18,2) DEFAULT 0 NOT NULL,
  total_deductions numeric(18,2) DEFAULT 0 NOT NULL,
  total_net numeric(18,2) DEFAULT 0 NOT NULL,
  calculated_at timestamptz,
  note varchar(200),
  cancel_reason varchar(200),
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE pay_run IS 'รอบเงินเดือน — บันทึก = ออกเลขที่และลงบัญชีตั้งค้างจ่ายทันที · จ่าย = ใบสำคัญจ่าย | Express: (ใหม่)';
COMMENT ON COLUMN pay_run.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN pay_run.company_id IS 'บริษัท';
COMMENT ON COLUMN pay_run.doc_no IS 'เลขที่ (PYปปดดนนนน — ออกตอนบันทึกครั้งแรก)';
COMMENT ON COLUMN pay_run.run_type IS 'R=รอบปกติ B=รอบเพิ่มเติม/โบนัส';
COMMENT ON COLUMN pay_run.branch_id IS 'สาขา (ว่าง = สำนักงานใหญ่) — พนักงานของสาขานี้';
COMMENT ON COLUMN pay_run.period_from IS 'งวดตั้งแต่';
COMMENT ON COLUMN pay_run.period_to IS 'งวดถึง';
COMMENT ON COLUMN pay_run.pay_date IS 'วันที่จ่าย (= เดือนภาษี ภ.ง.ด.1 / ประกันสังคม)';
COMMENT ON COLUMN pay_run.tax_month IS 'เดือนภาษี (วันที่ 1 ของเดือนที่จ่าย)';
COMMENT ON COLUMN pay_run.status IS 'D=ร่าง N=บันทึกแล้ว (ลงบัญชี) P=จ่ายแล้ว C=ยกเลิก';
COMMENT ON COLUMN pay_run.journal_id IS 'ใบสำคัญตั้งค้างจ่าย';
COMMENT ON COLUMN pay_run.pay_journal_id IS 'ใบสำคัญจ่ายเงินเดือน';
COMMENT ON COLUMN pay_run.pay_account_id IS 'บัญชีที่จ่ายเงิน (เงินสด/เงินฝาก)';
COMMENT ON COLUMN pay_run.paid_date IS 'วันที่จ่ายจริง';
COMMENT ON COLUMN pay_run.headcount IS 'จำนวนพนักงาน';
COMMENT ON COLUMN pay_run.total_gross IS 'รวมเงินได้';
COMMENT ON COLUMN pay_run.total_tax IS 'รวมภาษี (รวมที่บริษัทออกให้)';
COMMENT ON COLUMN pay_run.total_sso_ee IS 'ประกันสังคมลูกจ้าง';
COMMENT ON COLUMN pay_run.total_sso_er IS 'ประกันสังคมนายจ้าง';
COMMENT ON COLUMN pay_run.total_pvd_ee IS 'กองทุนสำรองฯ ลูกจ้าง';
COMMENT ON COLUMN pay_run.total_pvd_er IS 'กองทุนสำรองฯ นายจ้าง';
COMMENT ON COLUMN pay_run.total_deductions IS 'รวมเงินหักอื่น';
COMMENT ON COLUMN pay_run.total_net IS 'รวมจ่ายสุทธิ';
COMMENT ON COLUMN pay_run.calculated_at IS 'เวลาคำนวณล่าสุด';
COMMENT ON COLUMN pay_run.note IS 'หมายเหตุ';
COMMENT ON COLUMN pay_run.cancel_reason IS 'เหตุผลที่ยกเลิก';
COMMENT ON COLUMN pay_run.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN pay_run.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN pay_run.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN pay_run.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN pay_run.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN pay_run.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN pay_run.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE INDEX ix_pay_run_company_tax_month ON pay_run (company_id, tax_month);
CREATE TABLE pay_run_employee (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  run_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  department_id uuid,
  wage_type char(1) DEFAULT 'M' NOT NULL,
  tax_bearer char(1) DEFAULT 'W' NOT NULL,
  work_days numeric(18,4),
  work_hours numeric(18,4),
  salary_manual numeric(18,2),
  salary_manual_reason varchar(200),
  tax_manual numeric(18,2),
  regular numeric(18,2) DEFAULT 0 NOT NULL,
  special numeric(18,2) DEFAULT 0 NOT NULL,
  non_taxable numeric(18,2) DEFAULT 0 NOT NULL,
  gross numeric(18,2) DEFAULT 0 NOT NULL,
  sso_wage numeric(18,2) DEFAULT 0 NOT NULL,
  sso_ee numeric(18,2) DEFAULT 0 NOT NULL,
  sso_er numeric(18,2) DEFAULT 0 NOT NULL,
  pvd_base numeric(18,2) DEFAULT 0 NOT NULL,
  pvd_ee numeric(18,2) DEFAULT 0 NOT NULL,
  pvd_er numeric(18,2) DEFAULT 0 NOT NULL,
  tax numeric(18,2) DEFAULT 0 NOT NULL,
  tax_special numeric(18,2) DEFAULT 0 NOT NULL,
  employer_paid_tax numeric(18,2) DEFAULT 0 NOT NULL,
  other_deductions numeric(18,2) DEFAULT 0 NOT NULL,
  net_pay numeric(18,2) DEFAULT 0 NOT NULL,
  tax_calc jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid,
  row_version bigint DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  origin_device_id uuid,
  PRIMARY KEY (id)
);
COMMENT ON TABLE pay_run_employee IS 'พนักงานในรอบเงินเดือน (ยอดที่คำนวณ) | Express: (ใหม่)';
COMMENT ON COLUMN pay_run_employee.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN pay_run_employee.company_id IS 'บริษัท';
COMMENT ON COLUMN pay_run_employee.run_id IS 'รอบเงินเดือน';
COMMENT ON COLUMN pay_run_employee.employee_id IS 'พนักงาน';
COMMENT ON COLUMN pay_run_employee.department_id IS 'แผนก ณ วันคำนวณ';
COMMENT ON COLUMN pay_run_employee.wage_type IS 'ประเภทค่าจ้าง ณ วันคำนวณ';
COMMENT ON COLUMN pay_run_employee.tax_bearer IS 'ผู้รับภาระภาษี ณ วันคำนวณ';
COMMENT ON COLUMN pay_run_employee.work_days IS 'จำนวนวันทำงาน (รายวัน)';
COMMENT ON COLUMN pay_run_employee.work_hours IS 'จำนวนชั่วโมงทำงาน (รายชั่วโมง)';
COMMENT ON COLUMN pay_run_employee.salary_manual IS 'เงินเดือนที่ป้อนเอง (ว่าง = ตามประวัติค่าจ้าง)';
COMMENT ON COLUMN pay_run_employee.salary_manual_reason IS 'เหตุผลที่ป้อนเงินเดือนเอง';
COMMENT ON COLUMN pay_run_employee.tax_manual IS 'ภาษีที่ป้อนเอง (ว่าง = คำนวณ)';
COMMENT ON COLUMN pay_run_employee.regular IS 'เงินได้ประจำ';
COMMENT ON COLUMN pay_run_employee.special IS 'เงินได้ไม่ประจำ';
COMMENT ON COLUMN pay_run_employee.non_taxable IS 'เงินที่ไม่ต้องเสียภาษี';
COMMENT ON COLUMN pay_run_employee.gross IS 'รวมเงินได้';
COMMENT ON COLUMN pay_run_employee.sso_wage IS 'ค่าจ้างที่คิดประกันสังคม';
COMMENT ON COLUMN pay_run_employee.sso_ee IS 'ประกันสังคมลูกจ้าง';
COMMENT ON COLUMN pay_run_employee.sso_er IS 'ประกันสังคมนายจ้าง';
COMMENT ON COLUMN pay_run_employee.pvd_base IS 'ค่าจ้างที่คิดกองทุนสำรองฯ';
COMMENT ON COLUMN pay_run_employee.pvd_ee IS 'กองทุนสำรองฯ ลูกจ้าง';
COMMENT ON COLUMN pay_run_employee.pvd_er IS 'กองทุนสำรองฯ นายจ้าง';
COMMENT ON COLUMN pay_run_employee.tax IS 'ภาษีของรอบนี้ (รวมที่บริษัทออกให้)';
COMMENT ON COLUMN pay_run_employee.tax_special IS 'ภาษีส่วนของเงินได้ไม่ประจำ';
COMMENT ON COLUMN pay_run_employee.employer_paid_tax IS 'ภาษีที่บริษัทออกให้';
COMMENT ON COLUMN pay_run_employee.other_deductions IS 'เงินหักอื่น';
COMMENT ON COLUMN pay_run_employee.net_pay IS 'จ่ายสุทธิ';
COMMENT ON COLUMN pay_run_employee.tax_calc IS 'ที่มาของภาษี (ภาษีคำนวณอย่างไร)';
COMMENT ON COLUMN pay_run_employee.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN pay_run_employee.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN pay_run_employee.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN pay_run_employee.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN pay_run_employee.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN pay_run_employee.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN pay_run_employee.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE UNIQUE INDEX uq_pay_run_employee_run_employee ON pay_run_employee (run_id, employee_id) WHERE deleted_at IS NULL;
CREATE TABLE pay_run_line (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  run_id uuid NOT NULL,
  run_employee_id uuid NOT NULL,
  item_id uuid NOT NULL,
  qty numeric(18,4),
  rate numeric(18,4),
  multiplier numeric(9,4),
  amount numeric(18,2) NOT NULL,
  source varchar(10) NOT NULL CHECK (source IN ('WAGE','RECUR','MANUAL','IMPORT','SYSTEM')),
  note varchar(200),
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
COMMENT ON TABLE pay_run_line IS 'บรรทัดเงินได้/เงินหักของพนักงานในรอบเงินเดือน | Express: (ใหม่)';
COMMENT ON COLUMN pay_run_line.id IS 'รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)';
COMMENT ON COLUMN pay_run_line.company_id IS 'บริษัท';
COMMENT ON COLUMN pay_run_line.run_id IS 'รอบเงินเดือน';
COMMENT ON COLUMN pay_run_line.run_employee_id IS 'พนักงานในรอบ';
COMMENT ON COLUMN pay_run_line.item_id IS 'รายการ';
COMMENT ON COLUMN pay_run_line.qty IS 'จำนวน (ชั่วโมง/วัน/นาที)';
COMMENT ON COLUMN pay_run_line.rate IS 'อัตราต่อหน่วย';
COMMENT ON COLUMN pay_run_line.multiplier IS 'ตัวคูณ';
COMMENT ON COLUMN pay_run_line.amount IS 'จำนวนเงิน (บวกเสมอ — ทิศตามรายการ)';
COMMENT ON COLUMN pay_run_line.source IS 'WAGE RECUR MANUAL IMPORT SYSTEM';
COMMENT ON COLUMN pay_run_line.note IS 'ที่มา เช่น 16 วัน × 30000 ÷ 30';
COMMENT ON COLUMN pay_run_line.sort_order IS 'ลำดับ';
COMMENT ON COLUMN pay_run_line.created_at IS 'เวลาสร้าง';
COMMENT ON COLUMN pay_run_line.created_by IS 'ผู้สร้าง [Express: CREBY]';
COMMENT ON COLUMN pay_run_line.updated_at IS 'เวลาแก้ไขล่าสุด [Express: CHGDAT]';
COMMENT ON COLUMN pay_run_line.updated_by IS 'ผู้แก้ไขล่าสุด [Express: USERID]';
COMMENT ON COLUMN pay_run_line.row_version IS 'เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)';
COMMENT ON COLUMN pay_run_line.deleted_at IS 'ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)';
COMMENT ON COLUMN pay_run_line.origin_device_id IS 'เครื่องที่สร้างแถวนี้';
CREATE INDEX ix_pay_run_line_run_employee ON pay_run_line (run_employee_id);
ALTER TABLE pay_item ADD CONSTRAINT fk_pay_item_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_item_company_id ON pay_item (company_id);
ALTER TABLE pay_item ADD CONSTRAINT fk_pay_item_account_id FOREIGN KEY (account_id) REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_item_account_id ON pay_item (account_id);
ALTER TABLE pay_item ADD CONSTRAINT fk_pay_item_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_item_created_by ON pay_item (created_by);
ALTER TABLE pay_item ADD CONSTRAINT fk_pay_item_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_item_updated_by ON pay_item (updated_by);
CREATE TRIGGER trg_pay_item_ver BEFORE UPDATE ON pay_item FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_pay_item_log AFTER INSERT OR UPDATE ON pay_item FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_pay_item_del AFTER DELETE ON pay_item FOR EACH ROW EXECUTE FUNCTION sync_log_delete();
CREATE TRIGGER trg_pay_item_rid BEFORE INSERT ON pay_item FOR EACH ROW EXECUTE FUNCTION sync_row_id();
ALTER TABLE pay_employee ADD CONSTRAINT fk_pay_employee_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_employee_company_id ON pay_employee (company_id);
ALTER TABLE pay_employee ADD CONSTRAINT fk_pay_employee_department_id FOREIGN KEY (department_id) REFERENCES md_department(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_employee_department_id ON pay_employee (department_id);
ALTER TABLE pay_employee ADD CONSTRAINT fk_pay_employee_branch_id FOREIGN KEY (branch_id) REFERENCES sys_branch(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_employee_branch_id ON pay_employee (branch_id);
ALTER TABLE pay_employee ADD CONSTRAINT fk_pay_employee_bank_id FOREIGN KEY (bank_id) REFERENCES md_bank(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_employee_bank_id ON pay_employee (bank_id);
ALTER TABLE pay_employee ADD CONSTRAINT fk_pay_employee_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_employee_created_by ON pay_employee (created_by);
ALTER TABLE pay_employee ADD CONSTRAINT fk_pay_employee_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_employee_updated_by ON pay_employee (updated_by);
CREATE TRIGGER trg_pay_employee_ver BEFORE UPDATE ON pay_employee FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_pay_employee_log AFTER INSERT OR UPDATE ON pay_employee FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_pay_employee_del AFTER DELETE ON pay_employee FOR EACH ROW EXECUTE FUNCTION sync_log_delete();
CREATE TRIGGER trg_pay_employee_rid BEFORE INSERT ON pay_employee FOR EACH ROW EXECUTE FUNCTION sync_row_id();
ALTER TABLE pay_salary ADD CONSTRAINT fk_pay_salary_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_salary_company_id ON pay_salary (company_id);
ALTER TABLE pay_salary ADD CONSTRAINT fk_pay_salary_employee_id FOREIGN KEY (employee_id) REFERENCES pay_employee(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_salary_employee_id ON pay_salary (employee_id);
ALTER TABLE pay_salary ADD CONSTRAINT fk_pay_salary_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_salary_created_by ON pay_salary (created_by);
ALTER TABLE pay_salary ADD CONSTRAINT fk_pay_salary_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_salary_updated_by ON pay_salary (updated_by);
CREATE TRIGGER trg_pay_salary_ver BEFORE UPDATE ON pay_salary FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_pay_salary_log AFTER INSERT OR UPDATE ON pay_salary FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_pay_salary_del AFTER DELETE ON pay_salary FOR EACH ROW EXECUTE FUNCTION sync_log_delete();
CREATE TRIGGER trg_pay_salary_rid BEFORE INSERT ON pay_salary FOR EACH ROW EXECUTE FUNCTION sync_row_id();
ALTER TABLE pay_allowance ADD CONSTRAINT fk_pay_allowance_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_allowance_company_id ON pay_allowance (company_id);
ALTER TABLE pay_allowance ADD CONSTRAINT fk_pay_allowance_employee_id FOREIGN KEY (employee_id) REFERENCES pay_employee(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_allowance_employee_id ON pay_allowance (employee_id);
ALTER TABLE pay_allowance ADD CONSTRAINT fk_pay_allowance_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_allowance_created_by ON pay_allowance (created_by);
ALTER TABLE pay_allowance ADD CONSTRAINT fk_pay_allowance_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_allowance_updated_by ON pay_allowance (updated_by);
CREATE TRIGGER trg_pay_allowance_ver BEFORE UPDATE ON pay_allowance FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_pay_allowance_log AFTER INSERT OR UPDATE ON pay_allowance FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_pay_allowance_del AFTER DELETE ON pay_allowance FOR EACH ROW EXECUTE FUNCTION sync_log_delete();
CREATE TRIGGER trg_pay_allowance_rid BEFORE INSERT ON pay_allowance FOR EACH ROW EXECUTE FUNCTION sync_row_id();
ALTER TABLE pay_recurring ADD CONSTRAINT fk_pay_recurring_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_recurring_company_id ON pay_recurring (company_id);
ALTER TABLE pay_recurring ADD CONSTRAINT fk_pay_recurring_employee_id FOREIGN KEY (employee_id) REFERENCES pay_employee(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_recurring_employee_id ON pay_recurring (employee_id);
ALTER TABLE pay_recurring ADD CONSTRAINT fk_pay_recurring_item_id FOREIGN KEY (item_id) REFERENCES pay_item(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_recurring_item_id ON pay_recurring (item_id);
ALTER TABLE pay_recurring ADD CONSTRAINT fk_pay_recurring_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_recurring_created_by ON pay_recurring (created_by);
ALTER TABLE pay_recurring ADD CONSTRAINT fk_pay_recurring_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_recurring_updated_by ON pay_recurring (updated_by);
CREATE TRIGGER trg_pay_recurring_ver BEFORE UPDATE ON pay_recurring FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_pay_recurring_log AFTER INSERT OR UPDATE ON pay_recurring FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_pay_recurring_del AFTER DELETE ON pay_recurring FOR EACH ROW EXECUTE FUNCTION sync_log_delete();
CREATE TRIGGER trg_pay_recurring_rid BEFORE INSERT ON pay_recurring FOR EACH ROW EXECUTE FUNCTION sync_row_id();
ALTER TABLE pay_ytd_opening ADD CONSTRAINT fk_pay_ytd_opening_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_ytd_opening_company_id ON pay_ytd_opening (company_id);
ALTER TABLE pay_ytd_opening ADD CONSTRAINT fk_pay_ytd_opening_employee_id FOREIGN KEY (employee_id) REFERENCES pay_employee(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_ytd_opening_employee_id ON pay_ytd_opening (employee_id);
ALTER TABLE pay_ytd_opening ADD CONSTRAINT fk_pay_ytd_opening_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_ytd_opening_created_by ON pay_ytd_opening (created_by);
ALTER TABLE pay_ytd_opening ADD CONSTRAINT fk_pay_ytd_opening_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_ytd_opening_updated_by ON pay_ytd_opening (updated_by);
CREATE TRIGGER trg_pay_ytd_opening_ver BEFORE UPDATE ON pay_ytd_opening FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_pay_ytd_opening_log AFTER INSERT OR UPDATE ON pay_ytd_opening FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_pay_ytd_opening_del AFTER DELETE ON pay_ytd_opening FOR EACH ROW EXECUTE FUNCTION sync_log_delete();
CREATE TRIGGER trg_pay_ytd_opening_rid BEFORE INSERT ON pay_ytd_opening FOR EACH ROW EXECUTE FUNCTION sync_row_id();
ALTER TABLE pay_law ADD CONSTRAINT fk_pay_law_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_law_company_id ON pay_law (company_id);
ALTER TABLE pay_law ADD CONSTRAINT fk_pay_law_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_law_created_by ON pay_law (created_by);
ALTER TABLE pay_law ADD CONSTRAINT fk_pay_law_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_law_updated_by ON pay_law (updated_by);
CREATE TRIGGER trg_pay_law_ver BEFORE UPDATE ON pay_law FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_pay_law_log AFTER INSERT OR UPDATE ON pay_law FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_pay_law_del AFTER DELETE ON pay_law FOR EACH ROW EXECUTE FUNCTION sync_log_delete();
CREATE TRIGGER trg_pay_law_rid BEFORE INSERT ON pay_law FOR EACH ROW EXECUTE FUNCTION sync_row_id();
ALTER TABLE pay_run ADD CONSTRAINT fk_pay_run_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_run_company_id ON pay_run (company_id);
ALTER TABLE pay_run ADD CONSTRAINT fk_pay_run_branch_id FOREIGN KEY (branch_id) REFERENCES sys_branch(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_run_branch_id ON pay_run (branch_id);
ALTER TABLE pay_run ADD CONSTRAINT fk_pay_run_journal_id FOREIGN KEY (journal_id) REFERENCES gl_journal(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_run_journal_id ON pay_run (journal_id);
ALTER TABLE pay_run ADD CONSTRAINT fk_pay_run_pay_journal_id FOREIGN KEY (pay_journal_id) REFERENCES gl_journal(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_run_pay_journal_id ON pay_run (pay_journal_id);
ALTER TABLE pay_run ADD CONSTRAINT fk_pay_run_pay_account_id FOREIGN KEY (pay_account_id) REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_run_pay_account_id ON pay_run (pay_account_id);
ALTER TABLE pay_run ADD CONSTRAINT fk_pay_run_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_run_created_by ON pay_run (created_by);
ALTER TABLE pay_run ADD CONSTRAINT fk_pay_run_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_run_updated_by ON pay_run (updated_by);
CREATE INDEX IF NOT EXISTS ix_fk_pay_run_employee_company_id ON pay_run_employee (company_id);
CREATE INDEX IF NOT EXISTS ix_fk_pay_run_employee_run_id ON pay_run_employee (run_id);
CREATE INDEX IF NOT EXISTS ix_fk_pay_run_employee_employee_id ON pay_run_employee (employee_id);
CREATE INDEX IF NOT EXISTS ix_fk_pay_run_employee_department_id ON pay_run_employee (department_id);
CREATE INDEX IF NOT EXISTS ix_fk_pay_run_employee_created_by ON pay_run_employee (created_by);
CREATE INDEX IF NOT EXISTS ix_fk_pay_run_employee_updated_by ON pay_run_employee (updated_by);
CREATE INDEX IF NOT EXISTS ix_fk_pay_run_line_company_id ON pay_run_line (company_id);
CREATE INDEX IF NOT EXISTS ix_fk_pay_run_line_run_id ON pay_run_line (run_id);
CREATE INDEX IF NOT EXISTS ix_fk_pay_run_line_run_employee_id ON pay_run_line (run_employee_id);
CREATE INDEX IF NOT EXISTS ix_fk_pay_run_line_item_id ON pay_run_line (item_id);
CREATE INDEX IF NOT EXISTS ix_fk_pay_run_line_created_by ON pay_run_line (created_by);
CREATE INDEX IF NOT EXISTS ix_fk_pay_run_line_updated_by ON pay_run_line (updated_by);
CREATE TRIGGER trg_pay_run_ver BEFORE UPDATE ON pay_run FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_pay_run_log AFTER INSERT OR UPDATE ON pay_run FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_pay_run_del AFTER DELETE ON pay_run FOR EACH ROW EXECUTE FUNCTION sync_log_delete();
CREATE TRIGGER trg_pay_run_rid BEFORE INSERT ON pay_run FOR EACH ROW EXECUTE FUNCTION sync_row_id();
ALTER TABLE pay_run_employee ADD CONSTRAINT fk_pay_run_employee_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_run_employee_company_id ON pay_run_employee (company_id);
ALTER TABLE pay_run_employee ADD CONSTRAINT fk_pay_run_employee_run_id FOREIGN KEY (run_id) REFERENCES pay_run(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_run_employee_run_id ON pay_run_employee (run_id);
ALTER TABLE pay_run_employee ADD CONSTRAINT fk_pay_run_employee_employee_id FOREIGN KEY (employee_id) REFERENCES pay_employee(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_run_employee_employee_id ON pay_run_employee (employee_id);
ALTER TABLE pay_run_employee ADD CONSTRAINT fk_pay_run_employee_department_id FOREIGN KEY (department_id) REFERENCES md_department(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_run_employee_department_id ON pay_run_employee (department_id);
ALTER TABLE pay_run_employee ADD CONSTRAINT fk_pay_run_employee_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_run_employee_created_by ON pay_run_employee (created_by);
ALTER TABLE pay_run_employee ADD CONSTRAINT fk_pay_run_employee_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_run_employee_updated_by ON pay_run_employee (updated_by);
CREATE TRIGGER trg_pay_run_employee_ver BEFORE UPDATE ON pay_run_employee FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_pay_run_employee_log AFTER INSERT OR UPDATE ON pay_run_employee FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_pay_run_employee_del AFTER DELETE ON pay_run_employee FOR EACH ROW EXECUTE FUNCTION sync_log_delete();
CREATE TRIGGER trg_pay_run_employee_rid BEFORE INSERT ON pay_run_employee FOR EACH ROW EXECUTE FUNCTION sync_row_id();
ALTER TABLE pay_run_line ADD CONSTRAINT fk_pay_run_line_company_id FOREIGN KEY (company_id) REFERENCES sys_company(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_run_line_company_id ON pay_run_line (company_id);
ALTER TABLE pay_run_line ADD CONSTRAINT fk_pay_run_line_run_id FOREIGN KEY (run_id) REFERENCES pay_run(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_run_line_run_id ON pay_run_line (run_id);
ALTER TABLE pay_run_line ADD CONSTRAINT fk_pay_run_line_run_employee_id FOREIGN KEY (run_employee_id) REFERENCES pay_run_employee(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_run_line_run_employee_id ON pay_run_line (run_employee_id);
ALTER TABLE pay_run_line ADD CONSTRAINT fk_pay_run_line_item_id FOREIGN KEY (item_id) REFERENCES pay_item(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_run_line_item_id ON pay_run_line (item_id);
ALTER TABLE pay_run_line ADD CONSTRAINT fk_pay_run_line_created_by FOREIGN KEY (created_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_run_line_created_by ON pay_run_line (created_by);
ALTER TABLE pay_run_line ADD CONSTRAINT fk_pay_run_line_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_pay_run_line_updated_by ON pay_run_line (updated_by);
CREATE TRIGGER trg_pay_run_line_ver BEFORE UPDATE ON pay_run_line FOR EACH ROW EXECUTE FUNCTION sys_bump_version();
CREATE TRIGGER trg_pay_run_line_log AFTER INSERT OR UPDATE ON pay_run_line FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER trg_pay_run_line_del AFTER DELETE ON pay_run_line FOR EACH ROW EXECUTE FUNCTION sync_log_delete();
CREATE TRIGGER trg_pay_run_line_rid BEFORE INSERT ON pay_run_line FOR EACH ROW EXECUTE FUNCTION sync_row_id();
ALTER TABLE pay_item ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buddy_app') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON pay_item TO buddy_app;
  CREATE POLICY buddy_company ON pay_item TO buddy_app USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);
END IF; END $$;
ALTER TABLE pay_employee ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buddy_app') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON pay_employee TO buddy_app;
  CREATE POLICY buddy_company ON pay_employee TO buddy_app USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);
END IF; END $$;
ALTER TABLE pay_salary ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buddy_app') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON pay_salary TO buddy_app;
  CREATE POLICY buddy_company ON pay_salary TO buddy_app USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);
END IF; END $$;
ALTER TABLE pay_allowance ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buddy_app') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON pay_allowance TO buddy_app;
  CREATE POLICY buddy_company ON pay_allowance TO buddy_app USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);
END IF; END $$;
ALTER TABLE pay_recurring ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buddy_app') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON pay_recurring TO buddy_app;
  CREATE POLICY buddy_company ON pay_recurring TO buddy_app USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);
END IF; END $$;
ALTER TABLE pay_ytd_opening ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buddy_app') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON pay_ytd_opening TO buddy_app;
  CREATE POLICY buddy_company ON pay_ytd_opening TO buddy_app USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);
END IF; END $$;
ALTER TABLE pay_law ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buddy_app') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON pay_law TO buddy_app;
  CREATE POLICY buddy_company ON pay_law TO buddy_app USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);
END IF; END $$;
ALTER TABLE pay_run ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buddy_app') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON pay_run TO buddy_app;
  CREATE POLICY buddy_company ON pay_run TO buddy_app USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);
END IF; END $$;
ALTER TABLE pay_run_employee ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buddy_app') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON pay_run_employee TO buddy_app;
  CREATE POLICY buddy_company ON pay_run_employee TO buddy_app USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);
END IF; END $$;
ALTER TABLE pay_run_line ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buddy_app') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON pay_run_line TO buddy_app;
  CREATE POLICY buddy_company ON pay_run_line TO buddy_app USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);
END IF; END $$;
