// สร้างอัตโนมัติจาก db/spec/spec.py ด้วย `pnpm db:gen` — ห้ามแก้ไฟล์นี้ด้วยมือ
import type { ColumnType } from 'kysely';
type Gen<T> = ColumnType<T, T | undefined, T>;
/** ลูกค้าผู้ใช้บริการ (tenant) — หนึ่งรายมีได้หลายบริษัท ข้อมูลแต่ละรายแยกขาดจากกัน — Buddy Account */
export interface SysTenantTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** รหัสลูกค้าผู้ใช้บริการ */
  code: string;
  /** ชื่อลูกค้าผู้ใช้บริการ (เจ้าของบัญชี) */
  name: string;
  /** อีเมลผู้ติดต่อ */
  contact_email: Gen<string | null>;
  /** โทรศัพท์ผู้ติดต่อ */
  contact_phone: Gen<string | null>;
  /** แพ็กเกจ */
  plan: Gen<string>;
  /** จำนวนบริษัทสูงสุด (ว่าง = ไม่จำกัด) */
  max_companies: Gen<number | null>;
  /** จำนวนผู้ใช้สูงสุด (ว่าง = ไม่จำกัด) */
  max_users: Gen<number | null>;
  /** วันหมดอายุการใช้งาน */
  expires_on: Gen<string | null>;
  /** A=ใช้งาน S=ระงับ I=เลิกใช้ */
  status: Gen<string>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** บริษัท (หนึ่งฐานข้อมูลรองรับหลายบริษัท) */
export interface SysCompanyTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** ลูกค้าผู้ใช้บริการที่เป็นเจ้าของบริษัทนี้ */
  tenant_id: string;
  /** รหัสบริษัท (เดิมคือชื่อโฟลเดอร์ข้อมูล เช่น TESTRice) */
  code: string;
  /** ชื่อกิจการภาษาไทย */
  name_th: string;
  /** ชื่อกิจการภาษาอังกฤษ */
  name_en: Gen<string | null>;
  /** ที่อยู่ภาษาไทย */
  address_th: Gen<string | null>;
  /** ที่อยู่ภาษาอังกฤษ */
  address_en: Gen<string | null>;
  /** โทรศัพท์ */
  phone: Gen<string | null>;
  /** เลขประจำตัวผู้เสียภาษี 13 หลัก */
  tax_id: Gen<string | null>;
  /** เลขทะเบียนการค้า/นิติบุคคล */
  trade_reg_no: Gen<string | null>;
  /** เลขที่บัญชีนายจ้างประกันสังคม */
  social_security_no: Gen<string | null>;
  /** สกุลเงินหลัก */
  base_currency: Gen<string>;
  /** ระบบปี B=พ.ศ. C=ค.ศ. */
  year_system: Gen<string>;
  /** A=ใช้งาน I=เลิกใช้ */
  status: Gen<string>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** สาขา / จุดทำงาน (สำนักงานใหญ่ สาขา โรงแรมแต่ละแห่ง) */
export interface SysBranchTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** รหัสสาขา */
  code: string;
  /** ชื่อสาขา */
  name: string;
  /** เลขที่สาขาตามกรมสรรพากร (00000 = สำนักงานใหญ่) */
  tax_branch_no: Gen<string>;
  /** ที่อยู่สาขา (พิมพ์บนใบกำกับภาษี) */
  address: Gen<string | null>;
  /** เป็นสำนักงานใหญ่ */
  is_head_office: Gen<boolean>;
  /** คลังหลักของสาขา */
  default_warehouse_id: Gen<string | null>;
  /** สถานะ */
  status: Gen<string>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** ผู้ใช้งาน */
export interface SysUserTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** ลูกค้าผู้ใช้บริการที่ผู้ใช้สังกัด (ว่าง = เจ้าหน้าที่ผู้ให้บริการโปรแกรม) */
  tenant_id: Gen<string | null>;
  /** รหัสผู้ใช้ (USERID ใน Express ยาว 8) */
  username: string;
  /** ชื่อผู้ใช้ */
  display_name: string;
  /** รหัสผ่านแบบ hash (argon2/bcrypt) — เก็บใน client เพื่อเข้าระบบตอนออฟไลน์ */
  password_hash: Gen<string | null>;
  /** กลุ่มผู้ใช้ */
  user_group_id: Gen<string | null>;
  /** ระดับอนุมัติ 0–9 */
  approval_level: Gen<number>;
  /** ตรวจสอบสิทธิ์ก่อนใช้งาน: true = จำกัดเพิ่มตามตารางสิทธิ์รายเมนู (sys_permission), false = ใช้สิทธิ์พื้นฐานตามระดับอนุมัติ (คู่มือบทที่ 23) */
  check_rights: Gen<boolean>;
  /** ภาษาเมนู th/en */
  menu_language: Gen<string>;
  /** เครื่องพิมพ์ประจำ */
  default_printer: Gen<string | null>;
  /** สถานะ */
  status: Gen<string>;
  /** เข้าระบบครั้งล่าสุด */
  last_login_at: Gen<string | null>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** การเข้าระบบ (session) ของผู้ใช้ — Buddy Account */
export interface SysSessionTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** ผู้ใช้ */
  user_id: string;
  /** SHA-256 ของ token ใน cookie (ไม่เก็บ token จริง) */
  token_hash: string;
  /** บริษัทที่เลือกอยู่ */
  current_company_id: Gen<string | null>;
  /** สาขาที่เลือกอยู่ */
  current_branch_id: Gen<string | null>;
  /** วันที่ทำการ (Express: เปลี่ยนวันทำการ) */
  work_date: Gen<string | null>;
  /** หมดอายุ */
  expires_at: string;
  /** IP ที่เข้าระบบ */
  ip_address: Gen<string | null>;
  /** เบราว์เซอร์ */
  user_agent: Gen<string | null>;
  /** ออกจากระบบเมื่อ */
  ended_at: Gen<string | null>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** กลุ่มผู้ใช้ */
export interface SysUserGroupTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** ลูกค้าผู้ใช้บริการ (ว่าง = กลุ่มของผู้ให้บริการ) */
  tenant_id: Gen<string | null>;
  /** รหัสกลุ่ม */
  code: string;
  /** ชื่อกลุ่ม */
  name: string;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** ผู้ใช้ ↔ บริษัท/สาขาที่เข้าได้ */
export interface SysUserCompanyTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** ผู้ใช้ */
  user_id: string;
  /** จำกัดเฉพาะสาขา (ว่าง = ทุกสาขา) */
  branch_id: Gen<string | null>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** รายการเมนู/ฟังก์ชันที่ใช้กำหนดสิทธิ์ */
export interface SysMenuTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** รหัสเมนู เช่น AR.IV, GL.JV */
  code: string;
  /** ชื่อเมนู */
  name_th: string;
  /** ชื่อเมนูภาษาอังกฤษ */
  name_en: Gen<string | null>;
  /** เมนูแม่ */
  parent_id: Gen<string | null>;
  /** ลำดับ */
  sort_order: Gen<number>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** สิทธิ์ 7 ชนิดต่อ ผู้ใช้/กลุ่ม × บริษัท × เมนู */
export interface SysPermissionTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** U=ผู้ใช้ G=กลุ่ม */
  subject_type: string;
  /** id ของผู้ใช้หรือกลุ่ม */
  subject_id: string;
  /** เมนู */
  menu_id: string;
  /** อ่าน Y/L/N/S */
  can_read: Gen<string>;
  /** เพิ่ม */
  can_add: Gen<string>;
  /** แก้ไข */
  can_edit: Gen<string>;
  /** ยกเลิกเอกสาร */
  can_cancel: Gen<string>;
  /** ลบ */
  can_delete: Gen<string>;
  /** พิมพ์ */
  can_print: Gen<string>;
  /** อนุมัติ */
  can_approve: Gen<string>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** เครื่อง/อุปกรณ์ที่ลงทะเบียนใช้งานออฟไลน์ */
export interface SysDeviceTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** สาขาที่เครื่องนี้ประจำ */
  branch_id: string;
  /** รหัสเครื่อง (ใช้ในเลขที่เอกสารออฟไลน์ เช่น POS1) */
  code: string;
  /** ชื่อเครื่อง */
  name: string;
  /** server/desktop/pos/mobile */
  kind: Gen<string>;
  /** กุญแจสาธารณะสำหรับยืนยันตัวเครื่องตอนซิงก์ */
  public_key: Gen<string | null>;
  /** ซิงก์สำเร็จครั้งล่าสุด */
  last_sync_at: Gen<string | null>;
  /** ลำดับ change log ล่าสุดที่ดึงแล้ว */
  last_pull_seq: Gen<number>;
  /** A=ใช้งาน I=ระงับ (ระงับแล้วซิงก์ไม่ได้) */
  status: Gen<string>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** ค่าเริ่มต้นของระบบแบบ key–value (แทนฟิลด์ 244 ช่องใน ISINFO) */
export interface SysSettingTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** ค่าเฉพาะสาขา (ว่าง = ทั้งบริษัท) */
  branch_id: Gen<string | null>;
  /** ระบบ: GEN IC AR AP FN GL FA */
  module: string;
  /** ชื่อค่า เช่น ic.posting_method */
  key: string;
  /** ค่า (JSON) */
  value: unknown;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** นิยามค่าเริ่มต้นแต่ละตัว (ชนิด ค่า default และฟิลด์ต้นทางใน Express) */
export interface SysSettingDefTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** ชื่อค่า */
  key: string;
  /** ระบบ */
  module: string;
  /** bool/int/decimal/text/code/account */
  data_type: string;
  /** ค่าเริ่มต้น */
  default_value: Gen<unknown | null>;
  /** คำอธิบาย */
  label_th: string;
  /** ฟิลด์ใน ISINFO */
  express_field: Gen<string | null>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** บันทึกการใช้งาน (Log file) — เพิ่มได้อย่างเดียว เก็บ ≥ 2 ปี */
export interface SysActivityLogTable {
  /** ลำดับ (PK) */
  seq: Gen<number>;
  /** บริษัท */
  company_id: Gen<string | null>;
  /** วันเวลา */
  occurred_at: Gen<string>;
  /** ผู้ทำรายการ */
  user_id: Gen<string | null>;
  /** ผู้อนุมัติแทน (override) */
  auth_user_id: Gen<string | null>;
  /** เครื่องที่ทำรายการ */
  device_id: Gen<string | null>;
  /** ระบบ */
  module: Gen<string | null>;
  /** รหัสเหตุการณ์ เช่น LOGIN ADD EDIT CANCEL DELETE PRINT APPROVE RESTORE */
  action: string;
  /** เลขที่เอกสาร */
  doc_no: Gen<string | null>;
  /** ตารางที่เกี่ยวข้อง */
  table_name: Gen<string | null>;
  /** แถวที่เกี่ยวข้อง */
  row_id: Gen<string | null>;
  /** รายละเอียด/ค่าเดิม-ค่าใหม่ */
  detail: Gen<unknown | null>;
}
/** แบบฟอร์มพิมพ์เอกสารที่ผู้ใช้กำหนด (ฟอร์ม 1–9 ต่อชนิดเอกสาร) — แทนภาษารายงานของ Express */
export interface SysPrintFormTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** ชนิดเอกสาร (doc_class เช่น IV RE PS หรือ GL = ใบสำคัญ) */
  scope: string;
  /** หมายเลขฟอร์ม 1–9 (ตรงกับเมนูพิมพ์) */
  slot: number;
  /** ชื่อแบบฟอร์ม */
  name: string;
  /** ต้นแบบ grid=มีเส้น plain=ไม่มีเส้น half=ครึ่งหน้า (A5) cont=ต่อเนื่อง 9.5 นิ้ว */
  base: Gen<string>;
  /** รายละเอียดแบบฟอร์ม (หัวเรื่อง คอลัมน์ ช่องลงชื่อ สำเนา ขนาดอักษร …) */
  layout: unknown;
  /** A=ใช้งาน I=ไม่แสดงในเมนู */
  status: Gen<string>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** รายงานที่ผู้ใช้สร้างจากรายงานต้นฉบับ (เงื่อนไข + คอลัมน์ที่แสดง) */
export interface SysReportCustomTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** รหัสรายงานของผู้ใช้ เช่น U01 */
  code: string;
  /** รหัสรายงานต้นฉบับ เช่น 1.1.1 */
  base_code: string;
  /** ชื่อรายงาน (หัวรายงาน) */
  name: string;
  /** เงื่อนไขที่บันทึกไว้ */
  params: unknown;
  /** คอลัมน์ที่ซ่อน */
  hidden_cols: Gen<unknown | null>;
  /** พิมพ์แนวนอน (ว่าง = ตามต้นฉบับ) */
  landscape: Gen<boolean | null>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** ปีบัญชี */
export interface GlFiscalYearTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** รหัสปี เช่น 2569 */
  code: string;
  /** วันเริ่มปีบัญชี */
  start_date: string;
  /** วันสิ้นปีบัญชี */
  end_date: string;
  /** O=เปิด C=ปิดบัญชีแล้ว */
  status: Gen<string>;
  /** วันที่ประมวลผลสิ้นปี */
  closed_at: Gen<string | null>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** งวดบัญชี (เดือน) และสถานะปิดงวด */
export interface GlPeriodTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** ปีบัญชี */
  fiscal_year_id: string;
  /** งวดที่ 1–12 (13 = งวดปรับปรุงปิดบัญชี) */
  period_no: number;
  /** วันเริ่มงวด */
  start_date: string;
  /** วันสิ้นงวด */
  end_date: string;
  /** ปิดงวดแล้ว ห้ามบันทึก/แก้ไข */
  is_locked: Gen<boolean>;
  /** ผู้ปิดงวด */
  locked_by: Gen<string | null>;
  /** เวลาที่ปิดงวด */
  locked_at: Gen<string | null>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** ผังบัญชี */
export interface GlAccountTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** เลขที่บัญชี (ตาม mask เช่น 9999-99) */
  account_no: string;
  /** ชื่อบัญชีภาษาไทย */
  name_th: string;
  /** ชื่อบัญชีภาษาอังกฤษ */
  name_en: Gen<string | null>;
  /** บัญชีคุม */
  parent_id: Gen<string | null>;
  /** ระดับบัญชี 1–9 */
  level: Gen<number>;
  /** หมวด 1=สินทรัพย์ 2=หนี้สิน 3=ทุน 4=รายได้ 5=ค่าใช้จ่าย */
  account_group: string;
  /** บัญชีคุม (ห้ามลงรายการโดยตรง) */
  is_control: Gen<boolean>;
  /** ยอดปกติ D=เดบิต C=เครดิต */
  normal_side: string;
  /** ต้องระบุแผนกเมื่อลงบัญชี */
  use_department: Gen<boolean>;
  /** ต้องระบุโครงการ/Job */
  use_project: Gen<boolean>;
  /** บัญชีสำหรับรวมงบ */
  consol_account: Gen<string | null>;
  /** สถานะ */
  status: Gen<string>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** สมุดรายวัน (00 ทั่วไป 01 จ่าย 02 รับ 03 ขาย 04 ซื้อ …) */
export interface GlJournalBookTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** รหัสสมุด เช่น 00 */
  code: string;
  /** prefix เลขที่ใบสำคัญ เช่น JV PV RV SV UV */
  prefix: string;
  /** ชื่อสมุด */
  name_th: string;
  /** ชื่อภาษาอังกฤษ */
  name_en: Gen<string | null>;
  /** แม่แบบรายการบัญชีเริ่มต้น */
  template_id: Gen<string | null>;
  /** ระดับอนุมัติ */
  approve_level: Gen<number>;
  /** วิธีการพิมพ์หรือรับรอง 1=พิมพ์ก่อนรับรอง 2=รับรองก่อนพิมพ์ */
  approve_method: Gen<string | null>;
  /** พิมพ์ใบสำคัญซ้ำ ต้องขออนุมัติระดับ */
  reprint_level: Gen<number | null>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** บัญชีมาตรฐานสำหรับลงบัญชีอัตโนมัติ (34 บทบาท) — ชั้นที่ 3 ของการหาบัญชี */
export interface GlDefaultAccountTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** บทบาทบัญชี เช่น CASH AR INVENTORY OUTPUT_VAT (ดู seed) */
  role: string;
  /** บัญชี */
  account_id: string;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** ประเภทรายการ → สมุดรายวันที่ใช้ลงบัญชี */
export interface GlJournalRouteTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** ประเภทรายการ เช่น CREDIT_SALE AR_RECEIPT PASS_CHEQUE_RCV */
  txn_kind: string;
  /** สมุดรายวัน */
  journal_book_id: string;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** กฎการลงบัญชีอัตโนมัติ: เอกสารแต่ละชนิดลง Dr/Cr บทบาทใด ด้วยยอดใด */
export interface GlPostingRuleTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** หมวดเอกสาร (doc_header.doc_class) เช่น IV RE RR CN */
  doc_class: string;
  /** ลำดับบรรทัด */
  seq: number;
  /** เงื่อนไข เช่น PERPETUAL_ONLY, VAT_ACCRUAL, VAT_CASH, HAS_DEPOSIT */
  condition: Gen<string | null>;
  /** D หรือ C */
  side: string;
  /** บทบาทบัญชีที่ต้องหา เช่น AR SALES OUTPUT_VAT */
  account_role: string;
  /** ยอดที่ใช้ เช่น H.net_amount H.vat_amount L.cost_amount P.amount */
  amount_source: string;
  /** H=ต่อเอกสาร L=ต่อบรรทัดรายการ P=ต่อบรรทัดวิธีชำระ S=ต่อรายการตัดหนี้ */
  per: Gen<string>;
  /** คำอธิบาย */
  description: Gen<string | null>;
  /** คู่มือไม่ได้ระบุ ผู้ออกแบบอนุมาน — ต้องให้ผู้สอบบัญชียืนยัน */
  is_assumed: Gen<boolean>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** แม่แบบรายการบัญชี */
export interface GlTemplateTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** รหัสแม่แบบ */
  code: string;
  /** คำอธิบาย */
  name: string;
  /** คำอธิบายภาษาอังกฤษ */
  name_en: Gen<string | null>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** บรรทัดของแม่แบบ */
export interface GlTemplateLineTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** แม่แบบ */
  template_id: string;
  /** ลำดับ */
  line_no: number;
  /** บัญชี */
  account_id: Gen<string | null>;
  /** แผนก */
  department_id: Gen<string | null>;
  /** คำอธิบาย */
  description: Gen<string | null>;
  /** D/C */
  side: string;
  /** จำนวนเงิน (ว่าง = ให้ป้อน) */
  amount: Gen<string | null>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** ชนิดตารางอ้างอิง (TABTYP) */
export interface MdLookupTypeTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** รหัสชนิด เช่น 22 หมวดสินค้า 40 เขตการขาย */
  code: string;
  /** ชื่อชนิด */
  name_th: string;
  /** มีช่องอัตรา/ตัวเลข */
  has_rate: Gen<boolean>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** ตารางอ้างอิงทั่วไป (หมวดสินค้า เขตการขาย ขนส่งโดย เหตุผลยกเลิก ประเภทลูกค้า ฯลฯ) */
export interface MdLookupTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** ชนิด (md_lookup_type.code) */
  type_code: string;
  /** รหัส */
  code: string;
  /** ชื่อย่อไทย */
  short_th: Gen<string | null>;
  /** ชื่อย่ออังกฤษ */
  short_en: Gen<string | null>;
  /** ชื่อเต็มไทย */
  name_th: string;
  /** ชื่อเต็มอังกฤษ */
  name_en: Gen<string | null>;
  /** อัตรา/ตัวเลขประกอบ */
  rate: Gen<string | null>;
  /** สถานะ */
  status: Gen<string>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** หน่วยนับ */
export interface MdUnitTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** รหัสหน่วย เช่น PC MT */
  code: string;
  /** ชื่อหน่วย */
  name_th: string;
  /** ชื่อภาษาอังกฤษ */
  name_en: Gen<string | null>;
  /** ชื่อย่อไทย */
  short_th: Gen<string | null>;
  /** ชื่อย่ออังกฤษ */
  short_en: Gen<string | null>;
  /** อัตรา: ตัวคูณให้เป็นหน่วยย่อย เช่น โหล = 12 (คู่มือหน้า 87) */
  rate: Gen<string | null>;
  /** สถานะ */
  status: Gen<string>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** คลังสินค้า */
export interface MdWarehouseTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** รหัสคลัง เช่น HO SW */
  code: string;
  /** ชื่อคลัง */
  name_th: string;
  /** ชื่อภาษาอังกฤษ */
  name_en: Gen<string | null>;
  /** ชื่อย่อไทย */
  short_th: Gen<string | null>;
  /** ชื่อย่ออังกฤษ */
  short_en: Gen<string | null>;
  /** สาขาที่คลังสังกัด */
  branch_id: Gen<string | null>;
  /** สถานะ */
  status: Gen<string>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** แผนก / ศูนย์ต้นทุน */
export interface MdDepartmentTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** รหัสแผนก */
  code: string;
  /** ชื่อเต็มไทย */
  name_th: string;
  /** ชื่อเต็มอังกฤษ */
  name_en: Gen<string | null>;
  /** ชื่อย่อไทย (คู่มือบทที่ 6 หน้า 90) */
  short_name_th: Gen<string | null>;
  /** ชื่อย่ออังกฤษ */
  short_name_en: Gen<string | null>;
  /** สถานะ */
  status: Gen<string>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** ธนาคาร */
export interface MdBankTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** รหัสธนาคาร */
  code: string;
  /** ชื่อธนาคาร */
  name_th: string;
  /** ชื่อภาษาอังกฤษ */
  name_en: Gen<string | null>;
  /** ชื่อย่อไทย */
  short_th: Gen<string | null>;
  /** ชื่อย่ออังกฤษ */
  short_en: Gen<string | null>;
  /** สถานะ */
  status: Gen<string>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** โครงการ / Job */
export interface MdProjectTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** รหัสโครงการ */
  code: string;
  /** ชื่อโครงการ */
  name_th: string;
  /** ชื่อภาษาอังกฤษ */
  name_en: Gen<string | null>;
  /** ลูกค้า */
  customer_id: Gen<string | null>;
  /** วันเริ่ม */
  start_date: Gen<string | null>;
  /** วันสิ้นสุด */
  end_date: Gen<string | null>;
  /** สถานะ */
  status: Gen<string>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** งบประมาณโครงการแยกขั้นตอน/รหัสต้นทุน */
export interface MdProjectBudgetTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** โครงการ */
  project_id: string;
  /** ขั้นตอน */
  phase: Gen<string | null>;
  /** รหัสต้นทุน */
  cost_code: Gen<string | null>;
  /** ประมาณการค่าใช้จ่าย */
  est_expense: Gen<string | null>;
  /** ประมาณการรายได้ */
  est_revenue: Gen<string | null>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** กลุ่มบัญชีสินค้า — ชั้นที่ 2 ของการหาบัญชีสำหรับสินค้า */
export interface MdItemAccountGroupTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** รหัสกลุ่ม */
  code: string;
  /** ชื่อกลุ่ม */
  name_th: string;
  /** ชื่อภาษาอังกฤษ */
  name_en: Gen<string | null>;
  /** F=FIFO A=ถัวเฉลี่ย (ว่าง=ตามค่าบริษัท) */
  cost_method: Gen<string | null>;
  /** กลุ่มเฉพาะของสินค้าบริการ/รายได้อื่น/ค่าใช้จ่ายอื่น 1 รายการ (Express METHOD='-') — ไม่แสดงในรายการกลุ่มบัญชี แก้ที่หน้าจอสินค้า */
  item_specific: Gen<boolean>;
  /** บัญชีสินค้า (ค่าใช้จ่าย สำหรับรหัสค่าใช้จ่ายอื่น) */
  inventory_account_id: Gen<string | null>;
  /** บัญชีต้นทุนขาย */
  cogs_account_id: Gen<string | null>;
  /** บัญชีขาย */
  sales_account_id: Gen<string | null>;
  /** บัญชีรับคืน */
  sales_return_account_id: Gen<string | null>;
  /** บัญชีซื้อ (Periodic) */
  purchase_account_id: Gen<string | null>;
  /** บัญชีส่งคืน (Periodic) */
  purchase_return_account_id: Gen<string | null>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** สินค้า / บริการ / รหัสค่าใช้จ่ายอื่น / รหัสรายได้อื่น */
export interface MdItemTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** รหัสสินค้า */
  code: string;
  /** 0=สินค้า 1=สินค้าชุดธรรมดา 2=สินค้าชุดพิเศษ 3=สินค้าบริการ 4=รายได้อื่น 5=ค่าใช้จ่ายอื่น */
  item_type: Gen<string>;
  /** บาร์โค้ด */
  barcode: Gen<string | null>;
  /** ชื่อสินค้า */
  name_th: string;
  /** ชื่อภาษาอังกฤษ */
  name_en: Gen<string | null>;
  /** ระดับสินค้า (วัตถุดิบ/ประกอบ/สำเร็จรูป) lookup 23 */
  item_level: Gen<string | null>;
  /** หมวดสินค้า lookup 22 */
  category_code: Gen<string | null>;
  /** กลุ่มบัญชีสินค้า */
  account_group_id: Gen<string | null>;
  /** หน่วยนับหลัก (หน่วยเล็ก) */
  base_unit_id: Gen<string | null>;
  /** หน่วยนับสต๊อก/ตรวจนับ */
  count_unit_id: Gen<string | null>;
  /** ตัวคูณหน่วยตรวจนับ */
  count_factor: Gen<string | null>;
  /** หน่วยซื้อ */
  purchase_unit_id: Gen<string | null>;
  /** ตัวคูณหน่วยซื้อ */
  purchase_factor: Gen<string>;
  /** หน่วยขาย */
  sales_unit_id: Gen<string | null>;
  /** ตัวคูณหน่วยขาย */
  sales_factor: Gen<string>;
  /** ราคาทุนมาตรฐาน */
  std_cost: Gen<string | null>;
  /** ราคาขาย 1 */
  price_1: Gen<string | null>;
  /** ราคาขาย 2 */
  price_2: Gen<string | null>;
  /** ราคาขาย 3 */
  price_3: Gen<string | null>;
  /** ราคาขาย 4 */
  price_4: Gen<string | null>;
  /** ราคาขาย 5 */
  price_5: Gen<string | null>;
  /** ประเภท VAT ของสินค้า (0=ยกเว้น 1=มี VAT ว่าง=ตามเอกสาร) */
  vat_code: Gen<string | null>;
  /** Y/N/A=ตามค่าบริษัท */
  allow_negative: Gen<string | null>;
  /** ผู้จำหน่ายหลัก */
  default_supplier_id: Gen<string | null>;
  /** สินค้าทดแทน */
  substitute_item_id: Gen<string | null>;
  /** บรรจุ/หีบห่อ */
  packing: Gen<string | null>;
  /** ช่องกำหนดเอง 1 (ISINFO.ST_STR1) */
  udf_1: Gen<string | null>;
  /** ช่องกำหนดเอง 2 */
  udf_2: Gen<string | null>;
  /** ช่องกำหนดเอง 3 */
  udf_3: Gen<string | null>;
  /** ช่องกำหนดเอง 4 */
  udf_4: Gen<string | null>;
  /** วันที่กำหนดเอง (เช่น วันหมดอายุ) */
  udf_date_1: Gen<string | null>;
  /** วันที่กำหนดเอง 2 */
  udf_date_2: Gen<string | null>;
  /** ตัวเลขกำหนดเอง */
  udf_num_1: Gen<string | null>;
  /** หมายเหตุ */
  remark: Gen<string | null>;
  /** สถานะ */
  status: Gen<string>;
  /** วันที่เลิกใช้ */
  inactive_date: Gen<string | null>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** ส่วนประกอบสินค้าชุด */
export interface MdItemBomTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** สินค้าชุด */
  parent_item_id: string;
  /** ลำดับ */
  line_no: number;
  /** สินค้าประกอบ */
  component_item_id: string;
  /** จำนวนต่อชุด */
  qty: string;
  /** ราคาทุน */
  std_cost: Gen<string | null>;
  /** ราคาขาย */
  sell_price: Gen<string | null>;
  /** คลังที่ตัดส่วนประกอบ */
  warehouse_id: Gen<string | null>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** ตารางราคาตามปริมาณ/ช่วงเวลา */
export interface MdItemPriceBreakTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** สินค้า */
  item_id: string;
  /** หน่วย */
  unit_id: Gen<string | null>;
  /** ตัวคูณ */
  factor: Gen<string | null>;
  /** ปริมาณขั้นต่ำ */
  min_qty: string;
  /** ราคาเป็น % ส่วนลด */
  is_percent: Gen<boolean>;
  /** ราคา 1 */
  price_1: Gen<string | null>;
  /** ราคา 2 */
  price_2: Gen<string | null>;
  /** ราคา 3 */
  price_3: Gen<string | null>;
  /** ราคา 4 */
  price_4: Gen<string | null>;
  /** ราคา 5 */
  price_5: Gen<string | null>;
  /** วันเริ่ม */
  start_date: Gen<string | null>;
  /** วันสิ้นสุด */
  end_date: Gen<string | null>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** จุดสั่งซื้อแยกคลัง/ช่วงเวลา */
export interface MdItemReorderTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** สินค้า */
  item_id: string;
  /** คลัง */
  warehouse_id: string;
  /** เดือน/วันที่เริ่ม (MMDD) */
  start_mmdd: string;
  /** จุดสั่งซื้อ */
  min_qty: Gen<string | null>;
  /** จำนวนสูงสุด */
  max_qty: Gen<string | null>;
  /** ซื้อครั้งละ */
  order_qty: Gen<string | null>;
  /** ยอดขายโครงการ */
  projected_sales: Gen<string | null>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** ลูกค้า */
export interface MdCustomerTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** รหัสลูกค้า */
  code: string;
  /** ประเภทลูกค้า lookup 45 */
  customer_type: Gen<string | null>;
  /** คำนำหน้า */
  title: Gen<string | null>;
  /** ชื่อลูกค้า */
  name: string;
  /** ชื่อภาษาอังกฤษ */
  name_en: Gen<string | null>;
  /** ที่อยู่ 1 */
  address_1: Gen<string | null>;
  /** ที่อยู่ 2 */
  address_2: Gen<string | null>;
  /** ที่อยู่ 3 */
  address_3: Gen<string | null>;
  /** รหัสไปรษณีย์ */
  zip_code: Gen<string | null>;
  /** โทรศัพท์ */
  phone: Gen<string | null>;
  /** อีเมล (ใหม่) */
  email: Gen<string | null>;
  /** ผู้ติดต่อ */
  contact: Gen<string | null>;
  /** เลขผู้เสียภาษี */
  tax_id: Gen<string | null>;
  /** เลขที่สาขาของลูกค้า (00000 = สนญ.) */
  tax_branch_no: Gen<string | null>;
  /** พนักงานขาย */
  salesperson_id: Gen<string | null>;
  /** เขตการขาย lookup 40 */
  sales_area_code: Gen<string | null>;
  /** ขนส่งโดย lookup 41 */
  ship_via_code: Gen<string | null>;
  /** เครดิต (วัน) */
  credit_days: Gen<number | null>;
  /** เงื่อนไขการชำระ */
  payment_terms: Gen<string | null>;
  /** ตารางราคาที่ใช้ 0–5 */
  price_level: Gen<string | null>;
  /** ส่วนลด (เช่น 5%+2) */
  discount_text: Gen<string | null>;
  /** วงเงินอนุมัติ */
  credit_limit: Gen<string | null>;
  /** บัญชีลูกหนี้ (ชั้นที่ 2) */
  ar_account_id: Gen<string | null>;
  /** ผู้ชำระเงินแทน */
  payer_id: Gen<string | null>;
  /** แบบภาษีหัก ณ ที่จ่ายที่ลูกค้าหักเรา */
  wht_form: Gen<string | null>;
  /** อัตราภาษีหัก ณ ที่จ่าย */
  wht_rate: Gen<string | null>;
  /** หมวดภาษีหัก ณ ที่จ่าย (ตาราง 55) [สันนิษฐาน] */
  wht_category: Gen<string | null>;
  /** เงื่อนไขการหักภาษี 1=หัก ณ ที่จ่าย 2=ออกให้ตลอดไป 3=ออกให้ครั้งเดียว */
  wht_condition: Gen<string | null>;
  /** รหัสสถานที่ส่งของประจำ */
  default_ship_to: Gen<string | null>;
  /** ติดตามการขาย [สันนิษฐาน] */
  track_sales: Gen<string | null>;
  /** หมายเหตุ */
  remark: Gen<string | null>;
  /** สถานะ */
  status: Gen<string>;
  /** วันที่เลิกใช้ */
  inactive_date: Gen<string | null>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** สถานที่ส่งของของลูกค้า */
export interface MdCustomerShipToTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** ลูกค้า */
  customer_id: Gen<string | null>;
  /** รหัสสถานที่ส่ง */
  code: string;
  /** ที่อยู่ 1 */
  address_1: Gen<string | null>;
  /** ที่อยู่ 2 */
  address_2: Gen<string | null>;
  /** ที่อยู่ 3 */
  address_3: Gen<string | null>;
  /** รหัสไปรษณีย์ */
  zip_code: Gen<string | null>;
  /** โทรศัพท์ */
  phone: Gen<string | null>;
  /** ผู้ติดต่อ */
  contact: Gen<string | null>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** ผู้จำหน่าย / เจ้าหนี้ */
export interface MdSupplierTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** รหัสผู้จำหน่าย */
  code: string;
  /** ประเภท lookup 46 */
  supplier_type: Gen<string | null>;
  /** คำนำหน้า */
  title: Gen<string | null>;
  /** ชื่อผู้จำหน่าย */
  name: string;
  /** ชื่อภาษาอังกฤษ */
  name_en: Gen<string | null>;
  /** ที่อยู่ 1 */
  address_1: Gen<string | null>;
  /** ที่อยู่ 2 */
  address_2: Gen<string | null>;
  /** ที่อยู่ 3 */
  address_3: Gen<string | null>;
  /** รหัสไปรษณีย์ */
  zip_code: Gen<string | null>;
  /** โทรศัพท์ */
  phone: Gen<string | null>;
  /** ผู้ติดต่อ */
  contact: Gen<string | null>;
  /** เลขผู้เสียภาษี */
  tax_id: Gen<string | null>;
  /** เลขที่สาขา */
  tax_branch_no: Gen<string | null>;
  /** ประเภทราคา 0=ไม่มี VAT 1=รวม VAT 2=แยก VAT */
  price_type: Gen<string | null>;
  /** อัตรา VAT */
  vat_rate: Gen<string | null>;
  /** ขนส่งโดย */
  ship_via_code: Gen<string | null>;
  /** เครดิต (วัน) */
  credit_days: Gen<number | null>;
  /** เงื่อนไขการชำระ */
  payment_terms: Gen<string | null>;
  /** ส่วนลด */
  discount_text: Gen<string | null>;
  /** วงเงิน */
  credit_limit: Gen<string | null>;
  /** บัญชีเจ้าหนี้ (ชั้นที่ 2) */
  ap_account_id: Gen<string | null>;
  /** แบบ ภ.ง.ด. S03=ภ.ง.ด.3 S53=ภ.ง.ด.53 */
  wht_form: Gen<string | null>;
  /** ประเภทเงินได้ที่จ่าย */
  wht_income_desc: Gen<string | null>;
  /** อัตราภาษีหัก ณ ที่จ่าย */
  wht_rate: Gen<string | null>;
  /** เงื่อนไข 1=หัก ณ ที่จ่าย 2=ออกให้ตลอดไป 3=ออกให้ครั้งเดียว */
  wht_condition: Gen<string | null>;
  /** ระงับการจ่าย */
  on_hold: Gen<boolean>;
  /** หมายเหตุ */
  remark: Gen<string | null>;
  /** สถานะ */
  status: Gen<string>;
  /** วันที่เลิกใช้ */
  inactive_date: Gen<string | null>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** ผู้ติดต่อของลูกค้า/ผู้จำหน่าย (ข้อเสนอ: หลายคน — Express มีช่องเดียว) */
export interface MdPartyContactTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** C=ลูกค้า S=ผู้จำหน่าย */
  party_type: string;
  /** id ของลูกค้าหรือผู้จำหน่าย */
  party_id: string;
  /** ลำดับ */
  line_no: number;
  /** ชื่อผู้ติดต่อ */
  name: string;
  /** ตำแหน่ง/หน้าที่ เช่น จัดซื้อ บัญชี */
  position: Gen<string | null>;
  /** โทรศัพท์ */
  phone: Gen<string | null>;
  /** อีเมล */
  email: Gen<string | null>;
  /** ผู้ติดต่อหลัก (แสดงในเอกสาร) */
  is_primary: Gen<boolean>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** บัญชีธนาคารของผู้จำหน่าย (ข้อเสนอ: ใช้โอนจ่ายชำระหนี้) */
export interface MdSupplierBankTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** ผู้จำหน่าย */
  supplier_id: string;
  /** ลำดับ */
  line_no: number;
  /** ธนาคาร (ตารางธนาคาร) */
  bank_code: string;
  /** สาขา */
  branch: Gen<string | null>;
  /** เลขที่บัญชี */
  account_no: string;
  /** ชื่อบัญชี */
  account_name: Gen<string | null>;
  /** บัญชีที่ใช้โอนเป็นประจำ */
  is_default: Gen<boolean>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** พนักงานขาย */
export interface MdSalespersonTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** รหัสพนักงานขาย */
  code: string;
  /** ชื่อ */
  name: string;
  /** ตำแหน่ง */
  position: Gen<string | null>;
  /** ประเภท lookup 47 */
  salesperson_type: Gen<string | null>;
  /** เขตการขาย */
  sales_area_code: Gen<string | null>;
  /** อัตราค่าคอมมิชชั่น % */
  commission_rate: Gen<string | null>;
  /** ที่อยู่ */
  address: Gen<string | null>;
  /** รหัสไปรษณีย์ */
  zip_code: Gen<string | null>;
  /** โทรศัพท์ */
  phone: Gen<string | null>;
  /** เลขผู้เสียภาษี */
  tax_id: Gen<string | null>;
  /** เลขประกันสังคม */
  social_security_no: Gen<string | null>;
  /** สถานะ */
  status: Gen<string>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** เป้าการขายรายงวด */
export interface MdSalesTargetTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** พนักงานขาย */
  salesperson_id: string;
  /** งวด */
  period_id: string;
  /** เป้าการขาย */
  target_amount: string;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** บัญชีเงินฝากของกิจการ */
export interface MdBankAccountTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** รหัสบัญชีเงินฝาก เช่น C1 S1 */
  code: string;
  /** ธนาคาร */
  bank_id: Gen<string | null>;
  /** ชื่อบัญชี/ธนาคาร */
  name: string;
  /** สาขาธนาคาร */
  branch: Gen<string | null>;
  /** ชื่อย่อ */
  short_name: Gen<string | null>;
  /** เลขที่บัญชีธนาคาร */
  account_number: Gen<string | null>;
  /** C=กระแสรายวัน S=ออมทรัพย์ F=ฝากประจำ/ต่างประเทศ */
  account_kind: Gen<string | null>;
  /** บัญชีแยกประเภท */
  gl_account_id: Gen<string | null>;
  /** สกุลเงิน */
  currency: Gen<string>;
  /** ยอดยกมา */
  opening_balance: Gen<string | null>;
  /** วันที่ยอดยกมา */
  opening_date: Gen<string | null>;
  /** สถานะ */
  status: Gen<string>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** ประเภทเอกสารและพฤติกรรม (prefix สมุดรายวัน อนุมัติ บัญชี) */
export interface MdDocTypeTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** prefix เอกสาร เช่น IV TI RR PS */
  code: string;
  /** หมวดเอกสาร (กำหนดตรรกะ) = ISRUN.DOCTYP เช่น IV=ขายเชื่อ CN=ลดหนี้/รับคืน RR=ซื้อเชื่อ DN=ลดหนี้/ส่งคืน OU=เบิกใช้ JU=ปรับปรุง/ตรวจนับ */
  doc_class: string;
  /** ระบบ AR AP SO PO IC BK GL PC */
  module: string;
  /** ชื่อเอกสาร */
  name_th: string;
  /** ชื่อภาษาอังกฤษ */
  name_en: Gen<string | null>;
  /** ชื่อย่อ */
  short_name: Gen<string | null>;
  /** เลขที่ถัดไป (ส่วนตัวเลข 7 หลักต่อท้าย prefix ไม่เริ่มใหม่ทุกปี — คู่มือบทที่ 9) */
  next_no: Gen<number>;
  /** สมุดรายวันที่ลงบัญชี */
  journal_book_id: Gen<string | null>;
  /** สูตรคำอธิบายรายการบัญชี เช่น "ขายเชื่อให้ {party.name}" */
  journal_desc_template: Gen<string | null>;
  /** แผนก default */
  department_id: Gen<string | null>;
  /** คลัง default */
  warehouse_id: Gen<string | null>;
  /** ประเภทราคา default 0/1/2 */
  price_type: Gen<string | null>;
  /** อัตรา VAT default */
  vat_rate: Gen<string | null>;
  /** เกณฑ์ภาษีบริการ 1=เกณฑ์สิทธิ 2=เกณฑ์เงินสด */
  vat_basis: Gen<string | null>;
  /** แยกประเภท VAT รายบรรทัด */
  vat_per_line: Gen<boolean>;
  /** วิธีอนุมัติ */
  approve_method: Gen<string | null>;
  /** ระดับอนุมัติ */
  approve_level: Gen<number | null>;
  /** ระดับที่พิมพ์ซ้ำได้ */
  reprint_level: Gen<number | null>;
  /** ระดับที่ยกเลิกได้ */
  cancel_level: Gen<number | null>;
  /** ระดับที่ลบได้ */
  delete_level: Gen<number | null>;
  /** ระดับอนุมัติเกินวงเงิน */
  over_limit_level: Gen<number | null>;
  /** พิมพ์อัตโนมัติหลังบันทึก */
  auto_print: Gen<boolean>;
  /** ฟอร์มที่ใช้พิมพ์ 1–9 */
  form_no: Gen<number | null>;
  /** ป้อนรายการด้วยบาร์โค้ด */
  use_barcode: Gen<boolean>;
  /** เป็นใบกำกับภาษี (ต้องเรียงเลขต่อเนื่องตามสาขา/เล่ม) */
  is_tax_invoice: Gen<boolean>;
  /** สถานะ */
  status: Gen<string>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** บัญชีที่กำหนดไว้ที่ประเภทเอกสาร — ชั้นที่ 1 ของการหาบัญชี */
export interface MdDocTypeAccountTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** ประเภทเอกสาร */
  doc_type_id: string;
  /** ช่องที่ 1–12 ตาม Express */
  slot: number;
  /** บทบาทบัญชีของช่องนี้ (ตาม doc_class) */
  role: Gen<string | null>;
  /** บัญชี */
  account_id: string;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** วิธีรับ/จ่ายเงิน (เงินสด เช็ค โอน หัก ณ ที่จ่าย ส่วนลด ฯลฯ) */
export interface MdPaymentMethodTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** R=รับ P=จ่าย */
  direction: string;
  /** รหัส 2 ตัว (นำหน้าเลขที่ในรายการชำระ เช่น QR TR TS) */
  code: string;
  /** ลำดับในจอ */
  seq: Gen<string | null>;
  /** ชื่อวิธีชำระ */
  name_th: string;
  /** ชื่อภาษาอังกฤษ */
  name_en: Gen<string | null>;
  /** CASH CHEQUE TRANSFER CARD WHT DISCOUNT DEPOSIT FX OTHER */
  kind: Gen<string>;
  /** บัญชีที่ลง */
  gl_account_id: Gen<string | null>;
  /** บัญชีเงินฝากที่เกี่ยวข้อง (โอน/เช็ค) */
  bank_account_id: Gen<string | null>;
  /** สร้างรายการในทะเบียนเช็ค/โอน (fin_cheque) */
  creates_cheque: Gen<boolean>;
  /** สถานะ */
  status: Gen<string>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** ช่วงเลขที่เอกสารที่จองให้แต่ละเครื่อง — ออกเลขได้ตอนออฟไลน์โดยไม่ซ้ำ */
export interface MdDocNumberBlockTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** ประเภทเอกสาร */
  doc_type_id: string;
  /** สาขา */
  branch_id: string;
  /** เครื่องที่ได้รับช่วงเลข (ว่าง = ใช้บนเซิร์ฟเวอร์) */
  device_id: Gen<string | null>;
  /** ชุด/เล่ม เช่น 2569 หรือ 2569-POS1 */
  series: string;
  /** รูปแบบเลขที่ */
  format: Gen<string>;
  /** เลขเริ่มของช่วง */
  range_start: number;
  /** เลขสุดท้ายของช่วง */
  range_end: number;
  /** เลขถัดไปที่จะใช้ */
  next_no: number;
  /** A=ใช้งาน F=ใช้หมด X=คืน/ยกเลิก */
  status: Gen<string>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** หัวเอกสารทุกชนิด (ขาย ซื้อ สั่งขาย สั่งซื้อ สินค้า การเงิน เงินสดย่อย) */
export interface DocHeaderTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** สาขาที่ออกเอกสาร */
  branch_id: string;
  /** ประเภทเอกสาร (prefix) */
  doc_type_id: string;
  /** ชนิดเอกสาร = หมวดเอกสารของ Express (ISRUN.DOCTYP): ขาย QT SO AI IV HS DR CN(ลดหนี้) OI BS(วางบิล) RE | ซื้อ PO AE RR HP CP DN(ลดหนี้) OE BR PS | สินค้า OU RL JU CA | ธนาคาร BD BW BT BU BV BQ QP | เงินสดย่อย DP VR */
  doc_class: string;
  /** AR AP SO PO IC BK PC */
  module: string;
  /** RECTYP เดิมของ Express (เก็บไว้ตรวจย้อน) */
  express_rectype: Gen<string | null>;
  /** เลขที่เอกสาร */
  doc_no: string;
  /** เลขชั่วคราว (ออฟไลน์ ยังไม่ได้เลขจริง) — ใช้เฉพาะเอกสารที่ไม่ใช่ใบกำกับภาษี */
  is_provisional_no: Gen<boolean>;
  /** วันที่เอกสาร */
  doc_date: string;
  /** งวดบัญชีของเอกสาร */
  period_id: Gen<string | null>;
  /** ลูกค้า */
  customer_id: Gen<string | null>;
  /** ผู้จำหน่าย */
  supplier_id: Gen<string | null>;
  /** Bill to (ชื่อบนใบกำกับ) */
  bill_to_customer_id: Gen<string | null>;
  /** สถานที่ส่งของ */
  ship_to_id: Gen<string | null>;
  /** เลขผู้เสียภาษีของคู่ค้า (snapshot ตอนออกเอกสาร) */
  party_tax_id: Gen<string | null>;
  /** สาขาของคู่ค้า (snapshot) */
  party_tax_branch_no: Gen<string | null>;
  /** ชื่อคู่ค้า (snapshot ตอนออกใบกำกับ) */
  party_name: Gen<string | null>;
  /** ที่อยู่คู่ค้า (snapshot) */
  party_address: Gen<string | null>;
  /** พนักงานขาย */
  salesperson_id: Gen<string | null>;
  /** แผนก */
  department_id: Gen<string | null>;
  /** โครงการ */
  project_id: Gen<string | null>;
  /** เขตการขาย */
  sales_area_code: Gen<string | null>;
  /** ขนส่งโดย */
  ship_via_code: Gen<string | null>;
  /** คลัง (เอกสารสินค้า) */
  warehouse_id: Gen<string | null>;
  /** คลังปลายทาง (โอนย้าย) */
  to_warehouse_id: Gen<string | null>;
  /** บัญชีเงินฝาก (เอกสารธนาคาร/นำฝาก) */
  bank_account_id: Gen<string | null>;
  /** โอนเข้าบัญชี (โอนเงินระหว่างบัญชี BT) */
  to_bank_account_id: Gen<string | null>;
  /** อ้างอิง/เลขที่ PO ของลูกค้า */
  your_ref: Gen<string | null>;
  /** เลขที่ใบกำกับ/บิลของผู้จำหน่าย */
  ref_no: Gen<string | null>;
  /** วันที่อ้างอิง */
  ref_date: Gen<string | null>;
  /** เครดิต (วัน) */
  credit_days: Gen<number | null>;
  /** วันครบกำหนด */
  due_date: Gen<string | null>;
  /** วันส่งของ/รับของ (SO/PO) */
  delivery_date: Gen<string | null>;
  /** กำหนดวันส่ง/รับรายบรรทัด */
  delivery_date_per_line: Gen<boolean>;
  /** 0=ยกเว้น/ไม่มี VAT 1=ราคารวม VAT 2=ราคาแยก VAT */
  price_type: Gen<string>;
  /** สกุลเงิน */
  currency: Gen<string>;
  /** อัตราแลกเปลี่ยน */
  exchange_rate: Gen<string>;
  /** รวมเงินก่อนหักส่วนลด */
  amount: Gen<string>;
  /** สูตรส่วนลดท้ายบิล เช่น 5%+100 */
  discount_text: Gen<string | null>;
  /** ส่วนลดท้ายบิล */
  discount_amount: Gen<string>;
  /** หลังหักส่วนลด */
  amount_after_discount: Gen<string>;
  /** หักเงินมัดจำ */
  deposit_amount: Gen<string>;
  /** มูลค่าอัตรา 0% */
  zero_rate_amount: Gen<string>;
  /** มูลค่าก่อน VAT */
  taxable_amount: Gen<string>;
  /** อัตรา VAT */
  vat_rate: Gen<string | null>;
  /** ภาษีมูลค่าเพิ่ม */
  vat_amount: Gen<string>;
  /** ยอดสุทธิ (รวม VAT) */
  net_amount: Gen<string>;
  /** ภาษีหัก ณ ที่จ่าย */
  wht_amount: Gen<string>;
  /** รับ/จ่ายเป็นเงินสด */
  cash_amount: Gen<string>;
  /** รับ/จ่ายเป็นเช็ค/อื่น */
  cheque_amount: Gen<string>;
  /** ดอกเบี้ยรับ/จ่าย */
  interest_amount: Gen<string>;
  /** ส่วนลดเงินสด */
  cash_discount_amount: Gen<string>;
  /** ยอดที่ชำระ/ตัดแล้ว */
  settled_amount: Gen<string>;
  /** ยอดคงค้าง */
  outstanding_amount: Gen<string>;
  /** ค่าคอมมิชชั่น */
  commission_amount: Gen<string>;
  /** เกณฑ์ภาษี 1=สิทธิ 2=เงินสด 3=ทั้งสอง */
  vat_basis: Gen<string | null>;
  /** วันที่ใบกำกับภาษี (ยื่นภาษี) */
  vat_date: Gen<string | null>;
  /** งวดภาษีที่ยื่น */
  vat_period_id: Gen<string | null>;
  /** ยื่นเพิ่มเติม (ใบกำกับมาช้า) */
  vat_late: Gen<boolean>;
  /** D=ร่าง(ออฟไลน์) N=ปกติ M=ใช้ครบ/ปิดแล้ว C=ยกเลิก */
  doc_status: Gen<string>;
  /** ตัดชำระ/ส่งของครบแล้ว */
  is_settled: Gen<boolean>;
  /** วันที่ครบ */
  settled_date: Gen<string | null>;
  /** วันนัดชำระ (ใบวางบิล) */
  appointment_date: Gen<string | null>;
  /** วันที่รับ/จ่ายเงินจริง (ใบเสร็จ RE / ใบสำคัญจ่าย PS) — ไม่จำเป็นต้องตรงวันที่เอกสาร */
  payment_date: Gen<string | null>;
  /** ลูกหนี้/เจ้าหนี้คงค้างยกมา (คู่มือ S-OB-03/04): ลงวันที่ก่อนเริ่มใช้ ไม่ลงบัญชี ไม่ตัดสต๊อก ไม่เข้าแฟ้มภาษี */
  is_opening: Gen<boolean>;
  /** เงื่อนไขการชำระ */
  payment_terms: Gen<string | null>;
  /** หมายเหตุสั้น */
  remark: Gen<string | null>;
  /** N=ยังไม่ลงบัญชี Y=ลงแล้ว P=รอเซิร์ฟเวอร์ลง */
  gl_posted: Gen<string>;
  /** ใบสำคัญที่เกิดจากเอกสารนี้ */
  journal_id: Gen<string | null>;
  /** ผู้อนุมัติ */
  approved_by: Gen<string | null>;
  /** เวลาอนุมัติ */
  approved_at: Gen<string | null>;
  /** ผู้อนุมัติแทน */
  auth_user_id: Gen<string | null>;
  /** จำนวนครั้งที่พิมพ์ */
  print_count: Gen<number>;
  /** ผู้พิมพ์ล่าสุด */
  last_printed_by: Gen<string | null>;
  /** วันเวลาพิมพ์ล่าสุด */
  last_printed_at: Gen<string | null>;
  /** เหตุผลยกเลิก */
  cancel_reason: Gen<string | null>;
  /** เครื่องที่สร้างเอกสาร (ออฟไลน์) */
  device_id: Gen<string | null>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** บรรทัดรายการของเอกสาร (สินค้า บริการ ค่าใช้จ่าย บัญชี) */
export interface DocLineTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** หัวเอกสาร */
  header_id: string;
  /** ลำดับบรรทัด */
  line_no: number;
  /** I=สินค้า/บริการ G=บรรทัดบัญชี (ระบุบัญชีตรง) T=ข้อความ K=ส่วนประกอบสินค้าชุดที่ตัด/รับสต๊อก (อ้างบรรทัดชุดด้วย source_line_id) */
  line_kind: Gen<string>;
  /** สินค้า/บริการ/รหัสค่าใช้จ่าย */
  item_id: Gen<string | null>;
  /** บัญชี (บรรทัดบัญชี เช่น เงินสดย่อย ค่าใช้จ่ายอื่น) */
  account_id: Gen<string | null>;
  /** รายละเอียด (แก้ชื่อสินค้าได้) */
  description: Gen<string | null>;
  /** คลัง */
  warehouse_id: Gen<string | null>;
  /** แผนก */
  department_id: Gen<string | null>;
  /** โครงการ */
  project_id: Gen<string | null>;
  /** ขั้นตอนโครงการ */
  project_phase: Gen<string | null>;
  /** รหัสต้นทุน */
  cost_code: Gen<string | null>;
  /** จำนวน (หน่วยที่ป้อน) */
  qty: Gen<string>;
  /** หน่วย */
  unit_id: Gen<string | null>;
  /** ตัวคูณเป็นหน่วยหลัก */
  factor: Gen<string>;
  /** จำนวนเป็นหน่วยหลัก = qty × factor */
  base_qty: Gen<string>;
  /** ราคาต่อหน่วย */
  unit_price: Gen<string>;
  /** สูตรส่วนลดรายบรรทัด */
  discount_text: Gen<string | null>;
  /** ส่วนลดรายบรรทัด */
  discount_amount: Gen<string>;
  /** จำนวนเงิน (ตามประเภทราคาของเอกสาร) */
  line_amount: Gen<string>;
  /** มูลค่าสุทธิก่อน VAT (หลังเฉลี่ยส่วนลดท้ายบิล) */
  net_amount: Gen<string>;
  /** ประเภท VAT รายบรรทัด */
  vat_code: Gen<string | null>;
  /** ของแถม */
  is_free: Gen<boolean>;
  /** รับคืน/ส่งคืนแล้วเข้าสต๊อก (ใบลดหนี้) */
  return_to_stock: Gen<boolean | null>;
  /** ผลต่อสต๊อก +1 รับเข้า −1 จ่ายออก 0 ไม่กระทบ */
  stock_effect: Gen<number>;
  /** รหัสการเคลื่อนไหวเดิม (POSOPR: 0 ซื้อ 1 รับ/ปรับเพิ่ม 2 รับคืน 3 โอนออก 4 โอนเข้า 5 ปรับต้นทุน 6 เบิกใช้ 7 ส่งคืน 8 ปรับปรุง 9 ขาย : ตรวจนับ = เพิ่มหนี้ > คชจ.อื่น) */
  movement_code: Gen<string | null>;
  /** ต้นทุนต่อหน่วยหลัก (คำนวณตอน post) */
  cost_unit: Gen<string | null>;
  /** มูลค่าต้นทุน (คำนวณตอน post) */
  cost_amount: Gen<string | null>;
  /** มูลค่าขายสุทธิ (สำหรับรายงานกำไรขั้นต้น) */
  sales_value: Gen<string | null>;
  /** บรรทัดต้นทาง (บรรทัด SO/PO/IV ที่อ้างถึง) */
  source_line_id: Gen<string | null>;
  /** ลูกค้าของบรรทัด (denormalized จากหัว — ใช้ค้นสต๊อกการ์ดตามคู่ค้า) */
  party_customer_id: Gen<string | null>;
  /** ผู้จำหน่ายของบรรทัด */
  party_supplier_id: Gen<string | null>;
  /** พนักงานขาย */
  salesperson_id: Gen<string | null>;
  /** จำนวนสั่ง (SO/PO) */
  ordered_qty: Gen<string | null>;
  /** ค้างส่ง/ค้างรับ */
  remaining_qty: Gen<string | null>;
  /** จำนวนยกเลิก */
  cancelled_qty: Gen<string | null>;
  /** เหตุผลยกเลิก lookup 42/43 */
  cancel_reason_code: Gen<string | null>;
  /** วันที่ยกเลิก */
  cancel_date: Gen<string | null>;
  /** วันส่ง/รับของรายบรรทัด */
  delivery_date: Gen<string | null>;
  /** บัญชีเดบิตที่ระบุเอง (ทับกฎ) */
  gl_debit_account_id: Gen<string | null>;
  /** บัญชีเครดิตที่ระบุเอง (ทับกฎ) */
  gl_credit_account_id: Gen<string | null>;
  /** บรรจุ */
  packing: Gen<string | null>;
  /** สถานะเบิกชดเชย (เงินสดย่อย) */
  reimburse_flag: Gen<string | null>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** หมายเหตุเพิ่มเติมของเอกสาร/บรรทัด (สูงสุด 10 บรรทัด) */
export interface DocNoteTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** เอกสาร */
  header_id: string;
  /** บรรทัด (ว่าง = ระดับเอกสาร) */
  line_id: Gen<string | null>;
  /** ลำดับหมายเหตุ */
  seq: number;
  /** ข้อความ */
  text: string;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** หมายเหตุเพิ่มเติมของแฟ้มหลัก (สินค้า ลูกค้า ผู้จำหน่าย) สูงสุด 10 บรรทัด */
export interface MdNoteTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** ITEM CUSTOMER SUPPLIER */
  entity_type: string;
  /** id ของสินค้า/ลูกค้า/ผู้จำหน่าย */
  entity_id: string;
  /** ลำดับ */
  seq: number;
  /** ข้อความ */
  text: string;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** ความสัมพันธ์ระหว่างเอกสาร (อ้างถึง/แปลง/หักมัดจำ/ลดหนี้) */
export interface DocLinkTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** เอกสารต้นทาง (เช่น SO, PO, AI, AE, IV เดิม) */
  from_header_id: string;
  /** เอกสารปลายทาง (IV, RR, SR …) */
  to_header_id: string;
  /** FULFIL (SO→IV, PO→RR) CONVERT (QT→SO) DEPOSIT (AI→IV, AE→RR) ADJUST (IV→DR/SR, RR→CP/GR) */
  link_type: string;
  /** จำนวนเงินที่หัก/อ้างถึง (เช่น ยอดหักมัดจำ) */
  amount: Gen<string | null>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** รายการใบกำกับในใบวางบิล / ใบรับวางบิล */
export interface DocBillItemTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** ใบวางบิล BI / ใบรับวางบิล BR */
  bill_header_id: string;
  /** ใบกำกับ/ใบเพิ่มหนี้/ลดหนี้ ที่วางบิล */
  invoice_header_id: string;
  /** ยอดที่วางบิล */
  amount: string;
  /** ภาษี */
  vat_amount: Gen<string | null>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** การตัดชำระหนี้ (ใบเสร็จ RE / ใบสำคัญจ่าย PS ตัดใบกำกับใด เท่าใด) */
export interface DocSettlementTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** ใบรับชำระ/จ่ายชำระ */
  payment_header_id: Gen<string | null>;
  /** หรือ ใบสำคัญ JV ที่ใช้ตัดหนี้ (พบในข้อมูลจริง) */
  payment_journal_id: Gen<string | null>;
  /** เอกสารที่ถูกตัด (IV DR SR AI / RR CP GR AE) */
  invoice_header_id: string;
  /** RECTYP ของเอกสารที่ถูกตัด */
  express_rectype: Gen<string | null>;
  /** ยอดที่ตัดชำระ */
  amount: string;
  /** ภาษีที่ถึงกำหนด (เกณฑ์เงินสด) */
  vat_amount: Gen<string>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** วิธีรับ/จ่ายเงินของเอกสาร (เงินสด เช็ค โอน หัก ณ ที่จ่าย …) */
export interface DocPaymentTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** เอกสาร (RE PS AI AE HS HP OI OE DP) */
  header_id: string;
  /** ลำดับ */
  line_no: number;
  /** วิธีชำระ (2 ตัวแรกของ CHQNUM) */
  payment_method_id: string;
  /** เลขที่อ้างอิง (เลขเช็ค/เลขโอน) */
  reference_no: Gen<string | null>;
  /** จำนวนเงิน (บวก=รับ/จ่ายจริง ลบ=ส่วนหัก) */
  amount: string;
  /** รายการในทะเบียนเช็ค/โอน */
  cheque_id: Gen<string | null>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** ทะเบียนเช็ครับ/เช็คจ่าย และรายการโอนผ่านธนาคาร */
export interface FinChequeTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** สาขา */
  branch_id: Gen<string | null>;
  /** R=รับ P=จ่าย */
  direction: string;
  /** CHEQUE TRANSFER CARD */
  instrument: string;
  /** เลขที่เช็ค/อ้างอิง */
  cheque_no: string;
  /** วันที่หน้าเช็ค */
  cheque_date: string;
  /** ธนาคารของเช็ค (เช็ครับ) */
  bank_id: Gen<string | null>;
  /** สาขาธนาคาร */
  bank_branch: Gen<string | null>;
  /** บัญชีเงินฝากของกิจการ (นำฝาก/สั่งจ่าย) */
  bank_account_id: Gen<string | null>;
  /** ลูกค้าผู้สั่งจ่าย */
  customer_id: Gen<string | null>;
  /** ผู้รับเงิน */
  supplier_id: Gen<string | null>;
  /** ชื่อบนเช็ค */
  payee_name: Gen<string | null>;
  /** แผนก */
  department_id: Gen<string | null>;
  /** วันที่รับเช็ค */
  received_date: Gen<string | null>;
  /** วันที่นำฝาก */
  deposit_date: Gen<string | null>;
  /** วันที่เช็คผ่าน */
  pass_date: Gen<string | null>;
  /** จำนวนเงินหน้าเช็ค */
  amount: string;
  /** ค่าธรรมเนียม */
  charge: Gen<string>;
  /** ยอดสุทธิเข้าบัญชี */
  net_amount: string;
  /** ยอดเช็คที่ยังไม่ได้ใช้ตัดหนี้ */
  remaining_amount: Gen<string>;
  /** ยอดคงเหลือในเช็คที่ตัดเป็นรายได้อื่น (S-BK-12) */
  written_off_amount: Gen<string>;
  /** ใบสำคัญตัดยอดคงเหลือเป็นรายได้ */
  writeoff_journal_id: Gen<string | null>;
  /** สถานะเช็ค (ISTAB 02): 00 ในมือ 01 รอเรียกเก็บ 02 คืนยื่นใหม่ 05 คืน 10 ผ่าน 19 ผ่าน(โอน) … */
  status: string;
  /** ใช้ตัดหนี้ครบแล้ว */
  is_settled: Gen<boolean>;
  /** เอกสารที่รับ/จ่ายเช็คนี้ */
  source_header_id: Gen<string | null>;
  /** ใบนำฝากเช็ค BQ/SQ */
  deposit_header_id: Gen<string | null>;
  /** ใบสำคัญผ่านเช็ค */
  pass_journal_id: Gen<string | null>;
  /** หมายเหตุ */
  remark: Gen<string | null>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** ประวัติสถานะเช็ค (นำฝาก ผ่าน คืน ยื่นใหม่ ขายลด) */
export interface FinChequeEventTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** เช็ค */
  cheque_id: string;
  /** วันที่ */
  event_date: string;
  /** สถานะเดิม */
  from_status: Gen<string | null>;
  /** สถานะใหม่ */
  to_status: string;
  /** เหตุผล (เช่น เช็คคืนเพราะเงินไม่พอ) */
  reason: Gen<string | null>;
  /** เอกสารที่ทำให้เปลี่ยนสถานะ */
  header_id: Gen<string | null>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** สมุดบัญชีเงินฝาก (ทุกการเคลื่อนไหว ใช้กระทบยอดธนาคาร) */
export interface FinBankLedgerTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** บัญชีเงินฝาก */
  bank_account_id: string;
  /** วันที่ */
  txn_date: string;
  /** จำนวนเงิน (+ฝาก −ถอน) */
  amount: string;
  /** เอกสารต้นทาง */
  header_id: Gen<string | null>;
  /** เช็ค/โอน */
  cheque_id: Gen<string | null>;
  /** คำอธิบาย */
  description: Gen<string | null>;
  /** อ้างอิง Bank statement (กระทบยอด) */
  statement_ref: Gen<string | null>;
  /** วันที่กระทบยอดแล้ว */
  reconciled_at: Gen<string | null>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** บัญชีคุมสินค้า (สต๊อกการ์ด) — หนึ่งแถวต่อการเคลื่อนไหวที่ post แล้ว */
export interface InvStockLedgerTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** สินค้า */
  item_id: string;
  /** คลัง */
  warehouse_id: string;
  /** วันที่ */
  txn_date: string;
  /** บรรทัดเอกสาร */
  line_id: string;
  /** รหัสการเคลื่อนไหว (POSOPR) */
  movement_code: string;
  /** จำนวนหน่วยหลัก (+เข้า −ออก) */
  qty: string;
  /** ต้นทุนต่อหน่วย */
  unit_cost: string;
  /** มูลค่า (+/−) */
  value: string;
  /** ยอดคงเหลือหลังรายการ (running) */
  balance_qty: Gen<string | null>;
  /** มูลค่าคงเหลือหลังรายการ */
  balance_value: Gen<string | null>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** ล็อตต้นทุน FIFO (รับเข้าแต่ละครั้ง และยอดคงเหลือของล็อต) */
export interface InvCostLayerTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** สินค้า */
  item_id: string;
  /** คลัง (ถ้าคิดต้นทุนแยกคลัง) */
  warehouse_id: Gen<string | null>;
  /** บรรทัดที่รับเข้า (เกิดล็อต) */
  receipt_line_id: string;
  /** วันที่ล็อต */
  lot_date: string;
  /** จำนวนรับ */
  qty_in: string;
  /** มูลค่ารับ */
  value_in: string;
  /** จำนวนคงเหลือในล็อต */
  qty_remaining: string;
  /** มูลค่าคงเหลือในล็อต */
  value_remaining: string;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** การตัดล็อต FIFO ของบรรทัดจ่ายออก */
export interface InvCostConsumptionTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** บรรทัดจ่ายออก */
  issue_line_id: string;
  /** ล็อตที่ถูกตัด */
  layer_id: string;
  /** จำนวนที่ตัด */
  qty: string;
  /** มูลค่าที่ตัด */
  value: string;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** ยอดคงเหลือปัจจุบันต่อสินค้า×คลัง (สรุปจาก ledger; client ใช้แบบอ่านอย่างเดียว) */
export interface InvStockBalanceTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** สินค้า */
  item_id: string;
  /** คลัง */
  warehouse_id: string;
  /** ยอดคงเหลือ */
  qty_on_hand: Gen<string>;
  /** มูลค่าคงเหลือ */
  value_on_hand: Gen<string>;
  /** ต้นทุนเฉลี่ย/หน่วย */
  avg_cost: Gen<string | null>;
  /** ค้างรับจาก PO */
  qty_on_order: Gen<string>;
  /** ค้างส่งตาม SO */
  qty_reserved: Gen<string>;
  /** (client) ยอดที่ตัด/รับในเครื่องแต่ยังไม่ซิงก์ */
  qty_offline_pending: Gen<string>;
  /** ซื้อล่าสุด */
  last_purchase_date: Gen<string | null>;
  /** ขายล่าสุด */
  last_sale_date: Gen<string | null>;
  /** เคลื่อนไหวล่าสุด */
  last_move_date: Gen<string | null>;
  /** ตรวจนับล่าสุด */
  last_count_date: Gen<string | null>;
  /** ชั้นเก็บ */
  shelf: Gen<string | null>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** ผลการตรวจนับสินค้า */
export interface InvStockCountTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** คลัง */
  warehouse_id: string;
  /** สินค้า */
  item_id: string;
  /** วันที่ตรวจนับ */
  count_date: string;
  /** พื้นที่/ชั้นเก็บ */
  shelf: Gen<string | null>;
  /** จำนวนที่นับได้ (หน่วยหลัก) */
  counted_qty: Gen<string | null>;
  /** จำนวนนับในหน่วยตรวจนับ */
  counted_unit_qty: Gen<string | null>;
  /** ยอดตามระบบ ณ วันนับ */
  system_qty: Gen<string | null>;
  /** ผลต่าง */
  diff_qty: Gen<string | null>;
  /** 1=เตรียมนับ 3=บันทึกผลนับ 6=ปรับปรุงแล้ว */
  flag: Gen<string>;
  /** บรรทัดใบปรับปรุง TK ที่สร้าง */
  adjust_line_id: Gen<string | null>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** ทะเบียนหมายเลขเครื่อง/Serial และการรับประกัน */
export interface MdSerialTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** หมายเลขเครื่อง */
  serial_no: string;
  /** Machine No. */
  machine_no: Gen<string | null>;
  /** หมวดสินค้า */
  category_code: Gen<string | null>;
  /** สินค้า */
  item_id: Gen<string | null>;
  /** บรรทัดขาย */
  sale_line_id: Gen<string | null>;
  /** วันที่ขาย */
  sale_date: Gen<string | null>;
  /** สิ้นสุดประกัน */
  warranty_end: Gen<string | null>;
  /** ลูกค้า */
  customer_id: Gen<string | null>;
  /** รายละเอียด */
  description: Gen<string | null>;
  /** รหัสอ้างอิง (สื่อความหมาย เช่น CDROM ASUS 48X) */
  ref_code: Gen<string | null>;
  /** ชื่อลูกค้า (กรณีไม่มีรหัส) */
  customer_name: Gen<string | null>;
  /** ผู้ขาย */
  salesperson_id: Gen<string | null>;
  /** จำนวนครั้งที่พิมพ์บัตรรับประกัน */
  print_count: Gen<number>;
  /** พิมพ์บัตรรับประกันล่าสุด */
  last_printed_at: Gen<string | null>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** ประวัติการซ่อม/บริการของ Serial */
export interface MdSerialServiceTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** Serial */
  serial_id: string;
  /** วันที่ */
  service_date: string;
  /** ผู้ให้บริการ */
  service_by: Gen<string | null>;
  /** รายละเอียด */
  detail: Gen<string | null>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** ใบสำคัญ / รายการสมุดรายวัน (ทั้งบันทึกเองและที่ระบบอื่นส่งมา) */
export interface GlJournalTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** สาขา */
  branch_id: Gen<string | null>;
  /** สมุดรายวัน */
  journal_book_id: string;
  /** เลขที่ใบสำคัญ (เอกสารจากระบบอื่นใช้เลขเดียวกับเอกสาร) */
  voucher_no: string;
  /** วันที่ */
  voucher_date: string;
  /** งวดบัญชี */
  period_id: string;
  /** คำอธิบาย */
  description: Gen<string | null>;
  /** อ้างอิง */
  reference: Gen<string | null>;
  /** ระบบต้นทาง (ว่าง = บันทึกเองใน GL) */
  source_module: Gen<string | null>;
  /** เอกสารต้นทาง */
  source_header_id: Gen<string | null>;
  /** U=ยังไม่ผ่านรายการ P=ผ่านรายการแล้ว (Post) */
  status: Gen<string>;
  /** N=ปกติ C=ยกเลิก */
  doc_status: Gen<string>;
  /** กลับรายการของใบสำคัญใด */
  reversal_of_id: Gen<string | null>;
  /** ผู้ผ่านรายการ */
  posted_by: Gen<string | null>;
  /** วันที่ผ่านรายการ */
  posted_at: Gen<string | null>;
  /** รวมเดบิต */
  total_debit: Gen<string>;
  /** รวมเครดิต */
  total_credit: Gen<string>;
  /** จำนวนครั้งที่พิมพ์ */
  print_count: Gen<number>;
  /** ผู้อนุมัติ */
  approved_by: Gen<string | null>;
  /** เวลารับรอง */
  approved_at: Gen<string | null>;
  /** ผู้พิมพ์ล่าสุด */
  last_printed_by: Gen<string | null>;
  /** วันเวลาพิมพ์ล่าสุด */
  last_printed_at: Gen<string | null>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** รายการเดบิต/เครดิตของใบสำคัญ */
export interface GlJournalLineTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** ใบสำคัญ */
  journal_id: string;
  /** ลำดับ */
  line_no: number;
  /** บัญชี */
  account_id: string;
  /** แผนก */
  department_id: Gen<string | null>;
  /** โครงการ */
  project_id: Gen<string | null>;
  /** ขั้นตอนโครงการ */
  project_phase: Gen<string | null>;
  /** รหัสต้นทุน */
  cost_code: Gen<string | null>;
  /** คำอธิบายรายการ */
  description: Gen<string | null>;
  /** กระทบยอดธนาคาร: วันที่รายการปรากฏใน Bank statement (เฉพาะบรรทัดบัญชีเงินฝาก) */
  bank_cleared_date: Gen<string | null>;
  /** เดบิต */
  debit: Gen<string>;
  /** เครดิต */
  credit: Gen<string>;
  /** บทบาทที่กฎใช้หาบัญชี (ตรวจย้อนได้ว่าทำไมลงบัญชีนี้) */
  posting_role: Gen<string | null>;
  /** หาบัญชีได้จากชั้นใด 1=ประเภทเอกสาร 2=แฟ้มหลัก 3=บัญชีมาตรฐาน S=บัญชีพัก M=ป้อนเอง */
  resolved_from: Gen<string | null>;
  /** บัญชีเดิมก่อนแก้ */
  changed_from_account_id: Gen<string | null>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** ยอดสะสมรายงวดต่อบัญชี×แผนก (สรุปจาก gl_journal_line) */
export interface GlBalanceTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** บัญชี */
  account_id: string;
  /** แผนก */
  department_id: Gen<string | null>;
  /** งวด */
  period_id: string;
  /** ยอดยกมาต้นงวด (เฉพาะงวดแรกของปี) */
  opening: Gen<string>;
  /** รวมเดบิตในงวด */
  debit: Gen<string>;
  /** รวมเครดิตในงวด */
  credit: Gen<string>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** บัญชีสินค้าคงเหลือ (Periodic) — ยอดคงเหลือปลายงวดที่ผู้ใช้ยืนยัน ใช้ในงบการเงินแทนยอดบัญชี */
export interface GlInventoryBalanceTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** ปีบัญชี */
  fiscal_year_id: string;
  /** บัญชีสินค้าคงเหลือ */
  account_id: string;
  /** แผนก */
  department_id: Gen<string | null>;
  /** งวด 1–12 (0 = ยอดยกมาปีปัจจุบัน) */
  period_no: number;
  /** ยอดคงเหลือปลายงวด */
  amount: string;
  /** M=ป้อนเอง S=คำนวณจากระบบสินค้า (F5) */
  source: Gen<string>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** ยอดตามใบแจ้งยอดธนาคาร (Bank statement) สำหรับกระทบยอดเงินฝาก */
export interface FinBankStatementTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** บัญชีเงินฝาก */
  bank_account_id: string;
  /** วันที่ใบแจ้งยอด */
  statement_date: string;
  /** ยอดคงเหลือตามใบแจ้งยอด */
  closing_balance: string;
  /** หมายเหตุ */
  remark: Gen<string | null>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** งบประมาณรายงวด */
export interface GlBudgetTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** บัญชี */
  account_id: string;
  /** แผนก */
  department_id: Gen<string | null>;
  /** งวด */
  period_id: string;
  /** งบประมาณ */
  amount: string;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** ยอดปีที่แล้วที่ป้อนเอง (คู่มือบทที่ 15 S-GL-16) — ใช้กับปีที่ไม่มีใบสำคัญในระบบ (เริ่มใช้กลางปี/ย้ายจากโปรแกรมอื่น) สำหรับงบเปรียบเทียบเท่านั้น ไม่ยกไปปีถัดไป */
export interface GlPriorYearBalanceTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** ปีบัญชีที่ป้อนยอด */
  fiscal_year_id: string;
  /** บัญชี */
  account_id: string;
  /** แผนก */
  department_id: Gen<string | null>;
  /** 0 = ยอดยกมาต้นปี, 1–12 = งวด */
  period_no: number;
  /** เดบิต */
  debit: Gen<string>;
  /** เครดิต */
  credit: Gen<string>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** แบบงบการเงินที่ผู้ใช้สร้าง */
export interface GlFsReportTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** รหัสงบ */
  code: string;
  /** ชื่องบ */
  name: string;
  /** หัวรายงาน 4 บรรทัด */
  header_lines: Gen<unknown | null>;
  /** นิยามคอลัมน์ ≤18 (หัว สูตร BAL/PTD/BAL LY แผนก %) */
  columns: Gen<unknown | null>;
  /** ชุดบรรทัด */
  line_set_code: Gen<string | null>;
  /** รูปแบบตัวเลข */
  number_format: Gen<string | null>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** บรรทัดของงบการเงิน */
export interface GlFsLineTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** ชุดบรรทัด */
  line_set_code: string;
  /** เลขบรรทัด */
  line_no: number;
  /** A/C=บัญชี VAR=ตัวแปร ---=เส้น TXT=ข้อความ */
  data_type: string;
  /** ช่วงบัญชี/ตัวแปร */
  source: Gen<string | null>;
  /** + เฉพาะยอดบวก − เฉพาะยอดลบ */
  sign_filter: Gen<string | null>;
  /** คำอธิบาย */
  description_th: Gen<string | null>;
  /** คำอธิบายอังกฤษ */
  description_en: Gen<string | null>;
  /** Z=ไม่พิมพ์ถ้าศูนย์ N=ไม่พิมพ์ */
  print_condition: Gen<string | null>;
  /** สะสมเข้าตัวแปร A–E (+/−/0) */
  accumulate: Gen<unknown | null>;
  /** แผนก */
  department_id: Gen<string | null>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** ทะเบียนภาษีซื้อ/ภาษีขาย (รายงานภาษี ภ.พ.30) */
export interface TaxVatEntryTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** P=ภาษีซื้อ S=ภาษีขาย */
  vat_kind: string;
  /** เอกสารต้นทาง */
  header_id: Gen<string | null>;
  /** ใบสำคัญต้นทาง (บันทึกผ่าน JV/เงินสดย่อย) */
  journal_id: Gen<string | null>;
  /** สาขาที่ยื่น */
  branch_id: Gen<string | null>;
  /** เลขที่เอกสารภายใน */
  doc_no: string;
  /** วันที่เอกสารภายใน */
  doc_date: string;
  /** เลขที่ใบกำกับภาษี */
  tax_invoice_no: Gen<string | null>;
  /** วันที่ใบกำกับภาษี */
  tax_invoice_date: string;
  /** งวดภาษีที่ยื่น */
  vat_period_id: string;
  /** ยื่นเพิ่มเติม/ใบกำกับมาช้า */
  is_late: Gen<boolean>;
  /** แผนก */
  department_id: Gen<string | null>;
  /** คำอธิบาย */
  description: Gen<string | null>;
  /** ชื่อผู้ขาย/ผู้ซื้อ */
  party_name: Gen<string | null>;
  /** เลขผู้เสียภาษี */
  party_tax_id: Gen<string | null>;
  /** สาขา */
  party_tax_branch_no: Gen<string | null>;
  /** มูลค่าสินค้า/บริการ */
  base_amount: Gen<string>;
  /** ภาษี */
  vat_amount: Gen<string>;
  /** มูลค่าอัตรา 0% / ยกเว้น */
  zero_rate_amount: Gen<string>;
  /** มูลค่าภาษีซื้อที่ขอคืนไม่ได้ */
  nonclaim_base: Gen<string>;
  /** ภาษีซื้อที่ขอคืนไม่ได้ */
  nonclaim_vat: Gen<string>;
  /** บันทึกเองในระบบภาษี */
  is_manual: Gen<boolean>;
  /** ถูกแก้ไขในระบบภาษี */
  is_modified: Gen<boolean>;
  /** N=ปกติ C=ยกเลิก */
  doc_status: Gen<string>;
  /** หมายเหตุ */
  remark: Gen<string | null>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** ทะเบียนภาษีหัก ณ ที่จ่าย / หนังสือรับรอง 50 ทวิ */
export interface TaxWhtEntryTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** S03=ภ.ง.ด.3 S53=ภ.ง.ด.53 Z03/Z53=ถูกหัก */
  form_type: string;
  /** เอกสารต้นทาง (PS OE AE …) */
  header_id: Gen<string | null>;
  /** สาขาที่ยื่น */
  branch_id: Gen<string | null>;
  /** เลขที่หนังสือรับรอง */
  certificate_no: Gen<string | null>;
  /** วันที่หัก/ออกหนังสือ */
  certificate_date: string;
  /** เดือนภาษีที่ยื่น */
  tax_period_id: string;
  /** ยื่นเพิ่มเติม */
  is_late: Gen<boolean>;
  /** ผู้ถูกหัก */
  supplier_id: Gen<string | null>;
  /** ผู้หัก (กรณีถูกหัก) */
  customer_id: Gen<string | null>;
  /** ชื่อ (snapshot) */
  payee_name: string;
  /** ที่อยู่ (snapshot) */
  payee_address: Gen<string | null>;
  /** เลขผู้เสียภาษี */
  payee_tax_id: Gen<string | null>;
  /** สาขา */
  payee_tax_branch_no: Gen<string | null>;
  /** ประเภทเงินได้ */
  income_type: Gen<string | null>;
  /** จำนวนเงินที่จ่าย */
  paid_amount: string;
  /** อัตรา % */
  rate: string;
  /** ภาษีที่หัก */
  tax_amount: string;
  /** 1=หัก ณ ที่จ่าย 2=ออกให้ตลอดไป 3=ออกให้ครั้งเดียว */
  condition: Gen<string | null>;
  /** เงินสมทบประกันสังคม */
  social_security_amount: Gen<string | null>;
  /** เงินสะสมกองทุนสำรองเลี้ยงชีพ */
  provident_fund_amount: Gen<string | null>;
  /** แผนก */
  department_id: Gen<string | null>;
  /** จำนวนครั้งที่พิมพ์ */
  print_count: Gen<number>;
  /** N=ปกติ C=ยกเลิก */
  doc_status: Gen<string>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** กลุ่มบัญชีทรัพย์สิน */
export interface MdAssetAccountGroupTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** รหัสกลุ่ม */
  code: string;
  /** ชื่อกลุ่ม */
  name_th: string;
  /** ชื่อภาษาอังกฤษ */
  name_en: Gen<string | null>;
  /** บัญชีทรัพย์สิน */
  asset_account_id: Gen<string | null>;
  /** บัญชีค่าเสื่อมราคา */
  depr_expense_account_id: Gen<string | null>;
  /** บัญชีค่าเสื่อมราคาสะสม */
  accum_depr_account_id: Gen<string | null>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** ทะเบียนทรัพย์สินถาวร */
export interface FaAssetTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** รหัสทรัพย์สิน */
  code: string;
  /** ชื่อทรัพย์สิน */
  name_th: string;
  /** ชื่อภาษาอังกฤษ */
  name_en: Gen<string | null>;
  /** หมวดทรัพย์สิน lookup 52 */
  category_code: Gen<string | null>;
  /** กลุ่มบัญชีทรัพย์สิน */
  account_group_id: string;
  /** คิดค่าเสื่อม */
  is_depreciable: Gen<boolean>;
  /** หมายเลขเครื่อง/ทะเบียน */
  serial_no: Gen<string | null>;
  /** แผนก */
  department_id: Gen<string | null>;
  /** สาขาที่ตั้งทรัพย์สิน */
  branch_id: Gen<string | null>;
  /** วันที่ซื้อ */
  purchase_date: string;
  /** ราคาทุน */
  cost: string;
  /** ราคาซาก */
  salvage_value: Gen<string>;
  /** 0=ไม่คิด 1=เส้นตรง 2=ยอดลดลง */
  method: Gen<string>;
  /** วันเริ่มคิดค่าเสื่อม */
  start_date: string;
  /** อายุการใช้งาน (ปี) */
  useful_life_years: Gen<number | null>;
  /** อัตราค่าเสื่อม % */
  rate: Gen<string | null>;
  /** วันที่คิดค่าเสื่อมครบ */
  end_date: Gen<string | null>;
  /** คิดรายเดือน (N=รายปี) */
  depr_monthly: Gen<boolean>;
  /** ค่าเสื่อมสะสมยกมา */
  accum_depr_bf: Gen<string>;
  /** ค่าเสื่อมสะสมยกมา ณ วันที่ (ยอดยกมาครอบคลุมถึงก่อนวันนี้ · ว่าง = ยอดยกมาเป็นศูนย์ เริ่มคิดตั้งแต่วันเริ่มใช้) */
  accum_bf_date: Gen<string | null>;
  /** ค่าเสื่อมที่คำนวณเอง (ตั้งแต่ต้นปีถึงวันที่คำนวณเอง) */
  manual_depr: Gen<string>;
  /** คำนวณเองถึงวันที่ — โปรแกรมคิดต่อจากวันถัดไป */
  manual_depr_to: Gen<string | null>;
  /** วันที่ขาย/ตัดจำหน่าย */
  sold_date: Gen<string | null>;
  /** ราคาขาย */
  sold_amount: Gen<string | null>;
  /** เอกสารขายทรัพย์สิน */
  sold_header_id: Gen<string | null>;
  /** A=ใช้งาน S=ขาย/ตัดจำหน่าย I=เลิกใช้ */
  status: Gen<string>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** ค่าเสื่อมราคารายงวดของทรัพย์สิน */
export interface FaDepreciationTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** ทรัพย์สิน */
  asset_id: string;
  /** งวด */
  period_id: string;
  /** ค่าเสื่อมราคางวดนี้ */
  amount: string;
  /** ใบสำคัญที่ลงค่าเสื่อม */
  journal_id: Gen<string | null>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
/** บันทึกการเปลี่ยนแปลงบนเซิร์ฟเวอร์ (ใช้ให้เครื่องลูกดึงเฉพาะส่วนที่เปลี่ยน) */
export interface SyncChangeLogTable {
  /** ลำดับเพิ่มขึ้นเรื่อยๆ (PK) — เครื่องลูกจำค่าล่าสุดที่ดึงแล้ว */
  seq: Gen<number>;
  /** บริษัท */
  company_id: string;
  /** สาขา (ใช้กรองว่าเครื่องไหนต้องได้รับ) */
  branch_id: Gen<string | null>;
  /** ตาราง */
  table_name: string;
  /** แถว */
  row_id: string;
  /** U=insert/update D=delete(soft) */
  op: string;
  /** เวอร์ชันของแถว */
  row_version: number;
  /** เวลา */
  changed_at: Gen<string>;
  /** เครื่องที่ส่งการเปลี่ยนแปลงมา (ไม่ต้องส่งกลับเครื่องเดิม) */
  origin_device_id: Gen<string | null>;
}
/** รายการที่เครื่องลูกส่งขึ้นมา (กันประมวลผลซ้ำด้วย idempotency key) */
export interface SyncInboxTable {
  /** = sync_outbox.id ของเครื่องลูก (PK) */
  idempotency_key: string;
  /** บริษัท */
  company_id: string;
  /** เครื่อง */
  device_id: string;
  /** เวลาที่รับ */
  received_at: Gen<string>;
  /** ตาราง */
  table_name: string;
  /** แถว */
  row_id: string;
  /** APPLIED REJECTED CONFLICT */
  result: string;
  /** เหตุผลถ้าไม่สำเร็จ */
  message: Gen<string | null>;
}
/** ความขัดแย้งที่ต้องให้คนตัดสิน */
export interface SyncConflictTable {
  /** รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน) */
  id: Gen<string>;
  /** บริษัท */
  company_id: string;
  /** ตาราง */
  table_name: string;
  /** แถว */
  row_id: string;
  /** เครื่องที่ส่งค่าที่ขัดแย้ง */
  device_id: Gen<string | null>;
  /** เวอร์ชันบนเซิร์ฟเวอร์ */
  server_version: Gen<number | null>;
  /** เวอร์ชันที่เครื่องลูกแก้มาจาก */
  client_version: Gen<number | null>;
  /** ค่าที่เครื่องลูกส่งมา */
  client_payload: unknown;
  /** VERSION_MISMATCH PERIOD_LOCKED NEGATIVE_STOCK CREDIT_LIMIT DUPLICATE_NO PERMISSION */
  reason: string;
  /** KEEP_SERVER KEEP_CLIENT MERGED */
  resolution: Gen<string | null>;
  /** ผู้ตัดสิน */
  resolved_by: Gen<string | null>;
  /** เวลาที่ตัดสิน */
  resolved_at: Gen<string | null>;
  /** เวลาสร้าง */
  created_at: Gen<string>;
  /** ผู้สร้าง */
  created_by: Gen<string | null>;
  /** เวลาแก้ไขล่าสุด */
  updated_at: Gen<string>;
  /** ผู้แก้ไขล่าสุด */
  updated_by: Gen<string | null>;
  /** เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict) */
  row_version: Gen<number>;
  /** ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ) */
  deleted_at: Gen<string | null>;
  /** เครื่องที่สร้างแถวนี้ */
  origin_device_id: Gen<string | null>;
}
export interface DB {
  sys_tenant: SysTenantTable;
  sys_company: SysCompanyTable;
  sys_branch: SysBranchTable;
  sys_user: SysUserTable;
  sys_session: SysSessionTable;
  sys_user_group: SysUserGroupTable;
  sys_user_company: SysUserCompanyTable;
  sys_menu: SysMenuTable;
  sys_permission: SysPermissionTable;
  sys_device: SysDeviceTable;
  sys_setting: SysSettingTable;
  sys_setting_def: SysSettingDefTable;
  sys_activity_log: SysActivityLogTable;
  sys_print_form: SysPrintFormTable;
  sys_report_custom: SysReportCustomTable;
  gl_fiscal_year: GlFiscalYearTable;
  gl_period: GlPeriodTable;
  gl_account: GlAccountTable;
  gl_journal_book: GlJournalBookTable;
  gl_default_account: GlDefaultAccountTable;
  gl_journal_route: GlJournalRouteTable;
  gl_posting_rule: GlPostingRuleTable;
  gl_template: GlTemplateTable;
  gl_template_line: GlTemplateLineTable;
  md_lookup_type: MdLookupTypeTable;
  md_lookup: MdLookupTable;
  md_unit: MdUnitTable;
  md_warehouse: MdWarehouseTable;
  md_department: MdDepartmentTable;
  md_bank: MdBankTable;
  md_project: MdProjectTable;
  md_project_budget: MdProjectBudgetTable;
  md_item_account_group: MdItemAccountGroupTable;
  md_item: MdItemTable;
  md_item_bom: MdItemBomTable;
  md_item_price_break: MdItemPriceBreakTable;
  md_item_reorder: MdItemReorderTable;
  md_customer: MdCustomerTable;
  md_customer_ship_to: MdCustomerShipToTable;
  md_supplier: MdSupplierTable;
  md_party_contact: MdPartyContactTable;
  md_supplier_bank: MdSupplierBankTable;
  md_salesperson: MdSalespersonTable;
  md_sales_target: MdSalesTargetTable;
  md_bank_account: MdBankAccountTable;
  md_doc_type: MdDocTypeTable;
  md_doc_type_account: MdDocTypeAccountTable;
  md_payment_method: MdPaymentMethodTable;
  md_doc_number_block: MdDocNumberBlockTable;
  doc_header: DocHeaderTable;
  doc_line: DocLineTable;
  doc_note: DocNoteTable;
  md_note: MdNoteTable;
  doc_link: DocLinkTable;
  doc_bill_item: DocBillItemTable;
  doc_settlement: DocSettlementTable;
  doc_payment: DocPaymentTable;
  fin_cheque: FinChequeTable;
  fin_cheque_event: FinChequeEventTable;
  fin_bank_ledger: FinBankLedgerTable;
  inv_stock_ledger: InvStockLedgerTable;
  inv_cost_layer: InvCostLayerTable;
  inv_cost_consumption: InvCostConsumptionTable;
  inv_stock_balance: InvStockBalanceTable;
  inv_stock_count: InvStockCountTable;
  md_serial: MdSerialTable;
  md_serial_service: MdSerialServiceTable;
  gl_journal: GlJournalTable;
  gl_journal_line: GlJournalLineTable;
  gl_balance: GlBalanceTable;
  gl_inventory_balance: GlInventoryBalanceTable;
  fin_bank_statement: FinBankStatementTable;
  gl_budget: GlBudgetTable;
  gl_prior_year_balance: GlPriorYearBalanceTable;
  gl_fs_report: GlFsReportTable;
  gl_fs_line: GlFsLineTable;
  tax_vat_entry: TaxVatEntryTable;
  tax_wht_entry: TaxWhtEntryTable;
  md_asset_account_group: MdAssetAccountGroupTable;
  fa_asset: FaAssetTable;
  fa_depreciation: FaDepreciationTable;
  sync_change_log: SyncChangeLogTable;
  sync_inbox: SyncInboxTable;
  sync_conflict: SyncConflictTable;
}
