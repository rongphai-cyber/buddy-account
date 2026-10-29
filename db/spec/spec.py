# -*- coding: utf-8 -*-
"""
Single source of truth for the new accounting database (PostgreSQL server + SQLite offline client).
Each table: name, Thai description, module, sync scope, Express source file(s), columns, keys.
Each column: name, logical type, flags, FK, default, Thai description, Express source field.
"""
from dataclasses import dataclass, field
from typing import List, Optional

@dataclass
class C:
    name: str
    type: str
    nn: bool = False
    fk: Optional[str] = None          # "table" (FK to table.id)
    d: Optional[str] = None           # default (SQL literal)
    th: str = ''                      # Thai description
    src: str = ''                     # Express source  e.g. "ARMAS.CUSCOD"
    chk: Optional[str] = None         # CHECK expression

@dataclass
class T:
    name: str
    th: str
    module: str
    sync: str = 'both'                # both | server | client
    express: str = ''
    cols: List[C] = field(default_factory=list)
    uniq: List[tuple] = field(default_factory=list)
    idx: List[tuple] = field(default_factory=list)
    common: bool = True               # add id/company/audit/sync columns
    company: bool = True
    note: str = ''

MODULES = {
 'sys': 'ระบบ ผู้ใช้ สิทธิ์ อุปกรณ์ และการตั้งค่า',
 'md':  'แฟ้มข้อมูลหลัก (Master data)',
 'doc': 'เอกสารประจำวัน (ขาย ซื้อ สินค้า การเงิน)',
 'fin': 'การเงิน เช็ค และธนาคาร',
 'inv': 'สินค้าคงคลังและต้นทุน',
 'gl':  'บัญชีแยกประเภทและการลงบัญชีอัตโนมัติ',
 'tax': 'ภาษีมูลค่าเพิ่มและภาษีหัก ณ ที่จ่าย',
 'fa':  'ทรัพย์สินถาวร',
 'sync':'การซิงก์ออนไลน์/ออฟไลน์',
}

def lk(name, table, th, src='', nn=False):
    return C(name, 'uuid', nn=nn, fk=table, th=th, src=src)

ST_ACTIVE = "status IN ('A','I')"

TABLES: List[T] = []
def add(t): TABLES.append(t); return t

# =====================================================================
# SYS
# =====================================================================
add(T('sys_tenant', 'ลูกค้าผู้ใช้บริการ (tenant) — หนึ่งรายมีได้หลายบริษัท ข้อมูลแต่ละรายแยกขาดจากกัน — Buddy Account', 'sys', sync='server', express='(ใหม่)', company=False, cols=[
  C('code', 'code20', nn=True, th='รหัสลูกค้าผู้ใช้บริการ'),
  C('name', 'str120', nn=True, th='ชื่อลูกค้าผู้ใช้บริการ (เจ้าของบัญชี)'),
  C('contact_email', 'str120', th='อีเมลผู้ติดต่อ'),
  C('contact_phone', 'str60', th='โทรศัพท์ผู้ติดต่อ'),
  C('plan', 'code20', nn=True, d="'standard'", th='แพ็กเกจ'),
  C('max_companies', 'int', th='จำนวนบริษัทสูงสุด (ว่าง = ไม่จำกัด)'),
  C('max_users', 'int', th='จำนวนผู้ใช้สูงสุด (ว่าง = ไม่จำกัด)'),
  C('expires_on', 'date', th='วันหมดอายุการใช้งาน'),
  C('status', 'char1', nn=True, d="'A'", th='A=ใช้งาน S=ระงับ I=เลิกใช้', chk="status IN ('A','S','I')"),
], uniq=[('code',)]))

add(T('sys_company', 'บริษัท (หนึ่งฐานข้อมูลรองรับหลายบริษัท)', 'sys', express='ISINFO + ทะเบียนบริษัท (บทที่ 4)', company=False, cols=[
  lk('tenant_id', 'sys_tenant', 'ลูกค้าผู้ใช้บริการที่เป็นเจ้าของบริษัทนี้', nn=True),
  C('code', 'code20', nn=True, th='รหัสบริษัท (เดิมคือชื่อโฟลเดอร์ข้อมูล เช่น TESTRice)', src='DATA PATH'),
  C('name_th', 'str120', nn=True, th='ชื่อกิจการภาษาไทย', src='ISINFO.THINAM'),
  C('name_en', 'str120', th='ชื่อกิจการภาษาอังกฤษ', src='ISINFO.ENGNAM'),
  C('address_th', 'text', th='ที่อยู่ภาษาไทย', src='ISINFO.ADDR01+ADDR02'),
  C('address_en', 'text', th='ที่อยู่ภาษาอังกฤษ', src='ISINFO.ADDR01ENG+ADDR02ENG'),
  C('phone', 'str60', th='โทรศัพท์', src='ISINFO.TELNUM'),
  C('tax_id', 'code13', th='เลขประจำตัวผู้เสียภาษี 13 หลัก', src='ISINFO.TAXID'),
  C('trade_reg_no', 'code20', th='เลขทะเบียนการค้า/นิติบุคคล', src='ISINFO.TRDREG'),
  C('social_security_no', 'code20', th='เลขที่บัญชีนายจ้างประกันสังคม', src='ISINFO.SOCIALID'),
  C('base_currency', 'code3', nn=True, d="'THB'", th='สกุลเงินหลัก'),
  C('year_system', 'char1', nn=True, d="'B'", th='ระบบปี B=พ.ศ. C=ค.ศ.', src='ISINFO.YEARTHAI', chk="year_system IN ('B','C')"),
  C('status', 'char1', nn=True, d="'A'", th='A=ใช้งาน I=เลิกใช้', chk=ST_ACTIVE),
], uniq=[('code',)]))

add(T('sys_branch', 'สาขา / จุดทำงาน (สำนักงานใหญ่ สาขา โรงแรมแต่ละแห่ง)', 'sys', express='(ใหม่) — Express มีแค่ "สาขา#" ในเอกสาร', cols=[
  C('code', 'code10', nn=True, th='รหัสสาขา'),
  C('name', 'str120', nn=True, th='ชื่อสาขา'),
  C('tax_branch_no', 'code5', nn=True, d="'00000'", th='เลขที่สาขาตามกรมสรรพากร (00000 = สำนักงานใหญ่)'),
  C('address', 'text', th='ที่อยู่สาขา (พิมพ์บนใบกำกับภาษี)'),
  C('is_head_office', 'bool', nn=True, d='false', th='เป็นสำนักงานใหญ่'),
  lk('default_warehouse_id', 'md_warehouse', 'คลังหลักของสาขา', 'ISINFO.MAINLOC'),
  C('status', 'char1', nn=True, d="'A'", th='สถานะ', chk=ST_ACTIVE),
], uniq=[('company_id','code')]))

add(T('sys_user', 'ผู้ใช้งาน', 'sys', express='SCUSER (ไฟล์ระบบรักษาความปลอดภัย บทที่ 23)', company=False, cols=[
  lk('tenant_id', 'sys_tenant', 'ลูกค้าผู้ใช้บริการที่ผู้ใช้สังกัด (ว่าง = เจ้าหน้าที่ผู้ให้บริการโปรแกรม)'),
  C('username', 'code30', nn=True, th='รหัสผู้ใช้ (USERID ใน Express ยาว 8)', src='USERID'),
  C('display_name', 'str120', nn=True, th='ชื่อผู้ใช้'),
  C('password_hash', 'text', th='รหัสผ่านแบบ hash (argon2/bcrypt) — เก็บใน client เพื่อเข้าระบบตอนออฟไลน์'),
  lk('user_group_id', 'sys_user_group', 'กลุ่มผู้ใช้'),
  C('approval_level', 'smallint', nn=True, d='0', th='ระดับอนุมัติ 0–9', chk='approval_level BETWEEN 0 AND 9'),
  C('check_rights', 'bool', nn=True, d='true', th='ตรวจสิทธิ์ตามตารางสิทธิ์'),
  C('menu_language', 'char2', nn=True, d="'th'", th='ภาษาเมนู th/en'),
  C('default_printer', 'str60', th='เครื่องพิมพ์ประจำ'),
  C('status', 'char1', nn=True, d="'A'", th='สถานะ', chk=ST_ACTIVE),
  C('last_login_at', 'ts', th='เข้าระบบครั้งล่าสุด'),
], uniq=[('username',)]))

add(T('sys_session', 'การเข้าระบบ (session) ของผู้ใช้ — Buddy Account', 'sys', sync='server', express='(ใหม่)', company=False, cols=[
  lk('user_id', 'sys_user', 'ผู้ใช้', nn=True),
  C('token_hash', 'str100', nn=True, th='SHA-256 ของ token ใน cookie (ไม่เก็บ token จริง)'),
  lk('current_company_id', 'sys_company', 'บริษัทที่เลือกอยู่'),
  lk('current_branch_id', 'sys_branch', 'สาขาที่เลือกอยู่'),
  C('work_date', 'date', th='วันที่ทำการ (Express: เปลี่ยนวันทำการ)'),
  C('expires_at', 'ts', nn=True, th='หมดอายุ'),
  C('ip_address', 'str60', th='IP ที่เข้าระบบ'),
  C('user_agent', 'str200', th='เบราว์เซอร์'),
  C('ended_at', 'ts', th='ออกจากระบบเมื่อ'),
], uniq=[('token_hash',)]))

add(T('sys_user_group', 'กลุ่มผู้ใช้', 'sys', express='SCUSER (กลุ่ม)', company=False, cols=[
  lk('tenant_id', 'sys_tenant', 'ลูกค้าผู้ใช้บริการ (ว่าง = กลุ่มของผู้ให้บริการ)'),
  C('code', 'code20', nn=True, th='รหัสกลุ่ม'),
  C('name', 'str120', nn=True, th='ชื่อกลุ่ม'),
], uniq=[('tenant_id','code')]))

add(T('sys_user_company', 'ผู้ใช้ ↔ บริษัท/สาขาที่เข้าได้', 'sys', express='กลุ่มบริษัท (บทที่ 4)', cols=[
  lk('user_id', 'sys_user', 'ผู้ใช้', nn=True),
  lk('branch_id', 'sys_branch', 'จำกัดเฉพาะสาขา (ว่าง = ทุกสาขา)'),
], uniq=[('company_id','user_id','branch_id')]))

add(T('sys_menu', 'รายการเมนู/ฟังก์ชันที่ใช้กำหนดสิทธิ์', 'sys', express='SCMENU', company=False, cols=[
  C('code', 'code30', nn=True, th='รหัสเมนู เช่น AR.IV, GL.JV'),
  C('name_th', 'str120', nn=True, th='ชื่อเมนู'),
  C('name_en', 'str120', th='ชื่อเมนูภาษาอังกฤษ'),
  lk('parent_id', 'sys_menu', 'เมนูแม่'),
  C('sort_order', 'int', nn=True, d='0', th='ลำดับ'),
], uniq=[('code',)]))

add(T('sys_permission', 'สิทธิ์ 7 ชนิดต่อ ผู้ใช้/กลุ่ม × บริษัท × เมนู', 'sys', express='SCACCLV (บทที่ 23)', cols=[
  C('subject_type', 'char1', nn=True, th='U=ผู้ใช้ G=กลุ่ม', chk="subject_type IN ('U','G')"),
  C('subject_id', 'uuid', nn=True, th='id ของผู้ใช้หรือกลุ่ม'),
  lk('menu_id', 'sys_menu', 'เมนู', nn=True),
  C('can_read', 'char1', nn=True, d="'N'", th='อ่าน Y/L/N/S'),
  C('can_add', 'char1', nn=True, d="'N'", th='เพิ่ม'),
  C('can_edit', 'char1', nn=True, d="'N'", th='แก้ไข'),
  C('can_cancel', 'char1', nn=True, d="'N'", th='ยกเลิกเอกสาร'),
  C('can_delete', 'char1', nn=True, d="'N'", th='ลบ'),
  C('can_print', 'char1', nn=True, d="'N'", th='พิมพ์'),
  C('can_approve', 'char1', nn=True, d="'N'", th='อนุมัติ'),
], uniq=[('company_id','subject_type','subject_id','menu_id')]))

add(T('sys_device', 'เครื่อง/อุปกรณ์ที่ลงทะเบียนใช้งานออฟไลน์', 'sync', express='(ใหม่)', cols=[
  lk('branch_id', 'sys_branch', 'สาขาที่เครื่องนี้ประจำ', nn=True),
  C('code', 'code10', nn=True, th='รหัสเครื่อง (ใช้ในเลขที่เอกสารออฟไลน์ เช่น POS1)'),
  C('name', 'str120', nn=True, th='ชื่อเครื่อง'),
  C('kind', 'code10', nn=True, d="'desktop'", th='server/desktop/pos/mobile'),
  C('public_key', 'text', th='กุญแจสาธารณะสำหรับยืนยันตัวเครื่องตอนซิงก์'),
  C('last_sync_at', 'ts', th='ซิงก์สำเร็จครั้งล่าสุด'),
  C('last_pull_seq', 'bigint', nn=True, d='0', th='ลำดับ change log ล่าสุดที่ดึงแล้ว'),
  C('status', 'char1', nn=True, d="'A'", th='A=ใช้งาน I=ระงับ (ระงับแล้วซิงก์ไม่ได้)', chk=ST_ACTIVE),
], uniq=[('company_id','code')]))

add(T('sys_setting', 'ค่าเริ่มต้นของระบบแบบ key–value (แทนฟิลด์ 244 ช่องใน ISINFO)', 'sys', express='ISINFO', cols=[
  lk('branch_id', 'sys_branch', 'ค่าเฉพาะสาขา (ว่าง = ทั้งบริษัท)'),
  C('module', 'code10', nn=True, th='ระบบ: GEN IC AR AP FN GL FA'),
  C('key', 'code40', nn=True, th='ชื่อค่า เช่น ic.posting_method'),
  C('value', 'json', nn=True, th='ค่า (JSON)'),
], uniq=[('company_id','branch_id','key')], note='รายการ key ทั้งหมดดู seed ใน sys_setting_def'))

add(T('sys_setting_def', 'นิยามค่าเริ่มต้นแต่ละตัว (ชนิด ค่า default และฟิลด์ต้นทางใน Express)', 'sys', express='ISINFO', company=False, cols=[
  C('key', 'code40', nn=True, th='ชื่อค่า'),
  C('module', 'code10', nn=True, th='ระบบ'),
  C('data_type', 'code10', nn=True, th='bool/int/decimal/text/code/account'),
  C('default_value', 'json', th='ค่าเริ่มต้น'),
  C('label_th', 'str200', nn=True, th='คำอธิบาย'),
  C('express_field', 'str60', th='ฟิลด์ใน ISINFO'),
], uniq=[('key',)]))

add(T('sys_activity_log', 'บันทึกการใช้งาน (Log file) — เพิ่มได้อย่างเดียว เก็บ ≥ 2 ปี', 'sys', sync='server', express='ISLOG (บทที่ 23)', common=False, cols=[
  C('seq', 'bigserial', nn=True, th='ลำดับ (PK)'),
  C('company_id', 'uuid', fk='sys_company', th='บริษัท'),
  C('occurred_at', 'ts', nn=True, d='now()', th='วันเวลา', src='ISLOG.TRNDATE+TRNTIME'),
  lk('user_id', 'sys_user', 'ผู้ทำรายการ', 'ISLOG.USERID'),
  lk('auth_user_id', 'sys_user', 'ผู้อนุมัติแทน (override)', 'ISLOG.AUTHID'),
  lk('device_id', 'sys_device', 'เครื่องที่ทำรายการ'),
  C('module', 'code10', th='ระบบ', src='ISLOG.MODULE'),
  C('action', 'code20', nn=True, th='รหัสเหตุการณ์ เช่น LOGIN ADD EDIT CANCEL DELETE PRINT APPROVE RESTORE', src='ISLOG.TRNCODE'),
  C('doc_no', 'code30', th='เลขที่เอกสาร', src='ISLOG.DOCNUM'),
  C('table_name', 'code40', th='ตารางที่เกี่ยวข้อง'),
  C('row_id', 'uuid', th='แถวที่เกี่ยวข้อง'),
  C('detail', 'json', th='รายละเอียด/ค่าเดิม-ค่าใหม่'),
]))

# =====================================================================
# GL setup (needed by md)
# =====================================================================
add(T('gl_fiscal_year', 'ปีบัญชี', 'gl', express='ISPRD', cols=[
  C('code', 'code10', nn=True, th='รหัสปี เช่น 2569'),
  C('start_date', 'date', nn=True, th='วันเริ่มปีบัญชี', src='ISPRD.BEG1'),
  C('end_date', 'date', nn=True, th='วันสิ้นปีบัญชี', src='ISPRD.END12'),
  C('status', 'char1', nn=True, d="'O'", th='O=เปิด C=ปิดบัญชีแล้ว', chk="status IN ('O','C')"),
  C('closed_at', 'ts', th='วันที่ประมวลผลสิ้นปี'),
], uniq=[('company_id','code')], note='Express เก็บ 24 งวด (ปีนี้ + ปีหน้า) ในแถวเดียว ระบบใหม่เก็บปีละแถว ไม่จำกัดจำนวนปี'))

add(T('gl_period', 'งวดบัญชี (เดือน) และสถานะปิดงวด', 'gl', express='ISPRD.BEGn/ENDn/LOCKn', cols=[
  lk('fiscal_year_id', 'gl_fiscal_year', 'ปีบัญชี', nn=True),
  C('period_no', 'smallint', nn=True, th='งวดที่ 1–12 (13 = งวดปรับปรุงปิดบัญชี)', chk='period_no BETWEEN 1 AND 13'),
  C('start_date', 'date', nn=True, th='วันเริ่มงวด', src='ISPRD.BEGn'),
  C('end_date', 'date', nn=True, th='วันสิ้นงวด', src='ISPRD.ENDn'),
  C('is_locked', 'bool', nn=True, d='false', th='ปิดงวดแล้ว ห้ามบันทึก/แก้ไข', src='ISPRD.LOCKn'),
  lk('locked_by', 'sys_user', 'ผู้ปิดงวด'),
  C('locked_at', 'ts', th='เวลาที่ปิดงวด'),
], uniq=[('company_id','fiscal_year_id','period_no')]))

add(T('gl_account', 'ผังบัญชี', 'gl', express='GLACC', cols=[
  C('account_no', 'code20', nn=True, th='เลขที่บัญชี (ตาม mask เช่น 9999-99)', src='GLACC.ACCNUM'),
  C('name_th', 'str120', nn=True, th='ชื่อบัญชีภาษาไทย', src='GLACC.ACCNAM'),
  C('name_en', 'str120', th='ชื่อบัญชีภาษาอังกฤษ', src='GLACC.ACCNAM2'),
  lk('parent_id', 'gl_account', 'บัญชีคุม', 'GLACC.PARENT'),
  C('level', 'smallint', nn=True, d='1', th='ระดับบัญชี 1–9', src='GLACC.LEVEL'),
  C('account_group', 'char1', nn=True, th='หมวด 1=สินทรัพย์ 2=หนี้สิน 3=ทุน 4=รายได้ 5=ค่าใช้จ่าย', src='GLACC.GROUP', chk="account_group IN ('1','2','3','4','5')"),
  C('is_control', 'bool', nn=True, d='false', th='บัญชีคุม (ห้ามลงรายการโดยตรง)', src='GLACC.ACCTYP (1=คุม 0=ย่อย)'),
  C('normal_side', 'char1', nn=True, th='ยอดปกติ D=เดบิต C=เครดิต', src='GLACC.NATURE (0=D 1=C)', chk="normal_side IN ('D','C')"),
  C('use_department', 'bool', nn=True, d='false', th='ต้องระบุแผนกเมื่อลงบัญชี', src='GLACC.USEDEP'),
  C('use_project', 'bool', nn=True, d='false', th='ต้องระบุโครงการ/Job', src='GLACC.USEJOB'),
  C('consol_account', 'code20', th='บัญชีสำหรับรวมงบ', src='GLACC.CONSOL'),
  C('status', 'char1', nn=True, d="'A'", th='สถานะ', src='GLACC.STATUS', chk=ST_ACTIVE),
], uniq=[('company_id','account_no')]))

add(T('gl_journal_book', 'สมุดรายวัน (00 ทั่วไป 01 จ่าย 02 รับ 03 ขาย 04 ซื้อ …)', 'gl', express="ISRUN (DOCTYP='GL') + ISTAB TABTYP 10", cols=[
  C('code', 'code10', nn=True, th='รหัสสมุด เช่น 00', src='ISRUN.DOCCOD'),
  C('prefix', 'code10', nn=True, th='prefix เลขที่ใบสำคัญ เช่น JV PV RV SV UV', src='ISRUN.PREFIX'),
  C('name_th', 'str120', nn=True, th='ชื่อสมุด', src='ISRUN.POSDES'),
  C('name_en', 'str120', th='ชื่อภาษาอังกฤษ', src='ISRUN.POSDES2'),
  lk('template_id', 'gl_template', 'แม่แบบรายการบัญชีเริ่มต้น'),
  C('approve_level', 'smallint', nn=True, d='0', th='ระดับอนุมัติ'),
], uniq=[('company_id','code')]))

add(T('gl_default_account', 'บัญชีมาตรฐานสำหรับลงบัญชีอัตโนมัติ (34 บทบาท) — ชั้นที่ 3 ของการหาบัญชี', 'gl', express='ISINFO.ACCNUM00–ACCNUM34 (เริ่มระบบ 5.2)', cols=[
  C('role', 'code30', nn=True, th='บทบาทบัญชี เช่น CASH AR INVENTORY OUTPUT_VAT (ดู seed)'),
  lk('account_id', 'gl_account', 'บัญชี', nn=True),
], uniq=[('company_id','role')]))

add(T('gl_journal_route', 'ประเภทรายการ → สมุดรายวันที่ใช้ลงบัญชี', 'gl', express='ISINFO.*JNL (CRESALJNL, ARRCPJNL …)', cols=[
  C('txn_kind', 'code30', nn=True, th='ประเภทรายการ เช่น CREDIT_SALE AR_RECEIPT PASS_CHEQUE_RCV'),
  lk('journal_book_id', 'gl_journal_book', 'สมุดรายวัน', nn=True),
], uniq=[('company_id','txn_kind')]))

add(T('gl_posting_rule', 'กฎการลงบัญชีอัตโนมัติ: เอกสารแต่ละชนิดลง Dr/Cr บทบาทใด ด้วยยอดใด', 'gl', express='(ใหม่ — ทำให้ตรรกะที่ Express ฝังในโปรแกรมเป็นข้อมูล)', cols=[
  C('doc_class', 'code4', nn=True, th='หมวดเอกสาร (doc_header.doc_class) เช่น IV RE RR CN'),
  C('seq', 'smallint', nn=True, th='ลำดับบรรทัด'),
  C('condition', 'code40', th='เงื่อนไข เช่น PERPETUAL_ONLY, VAT_ACCRUAL, VAT_CASH, HAS_DEPOSIT'),
  C('side', 'char1', nn=True, th='D หรือ C', chk="side IN ('D','C')"),
  C('account_role', 'code30', nn=True, th='บทบาทบัญชีที่ต้องหา เช่น AR SALES OUTPUT_VAT'),
  C('amount_source', 'code40', nn=True, th='ยอดที่ใช้ เช่น H.net_amount H.vat_amount L.cost_amount P.amount'),
  C('per', 'char1', nn=True, d="'H'", th='H=ต่อเอกสาร L=ต่อบรรทัดรายการ P=ต่อบรรทัดวิธีชำระ S=ต่อรายการตัดหนี้', chk="per IN ('H','L','P','S')"),
  C('description', 'str200', th='คำอธิบาย'),
  C('is_assumed', 'bool', nn=True, d='false', th='คู่มือไม่ได้ระบุ ผู้ออกแบบอนุมาน — ต้องให้ผู้สอบบัญชียืนยัน'),
], uniq=[('company_id','doc_class','seq')]))

add(T('gl_template', 'แม่แบบรายการบัญชี', 'gl', express='GLTPL', cols=[
  C('code', 'code10', nn=True, th='รหัสแม่แบบ', src='GLTPL.TPLCOD'),
  C('name', 'str120', nn=True, th='คำอธิบาย', src='GLTPL.DESCRP'),
], uniq=[('company_id','code')]))
add(T('gl_template_line', 'บรรทัดของแม่แบบ', 'gl', express='GLTPLIT', cols=[
  lk('template_id', 'gl_template', 'แม่แบบ', nn=True),
  C('line_no', 'smallint', nn=True, th='ลำดับ'),
  lk('account_id', 'gl_account', 'บัญชี', 'GLTPLIT.ACCNUM'),
  lk('department_id', 'md_department', 'แผนก', 'GLTPLIT.DEPCOD'),
  C('description', 'str120', th='คำอธิบาย', src='GLTPLIT.DESCRP'),
  C('side', 'char1', nn=True, th='D/C', src='GLTPLIT.JNLTYP (0=D 1=C)', chk="side IN ('D','C')"),
  C('amount', 'money', th='จำนวนเงิน (ว่าง = ให้ป้อน)', src='GLTPLIT.AMOUNT'),
], uniq=[('template_id','line_no')]))

# =====================================================================
# MASTER DATA
# =====================================================================
add(T('md_lookup_type', 'ชนิดตารางอ้างอิง (TABTYP)', 'md', express='ISTAB.TABTYP', company=False, cols=[
  C('code', 'code4', nn=True, th='รหัสชนิด เช่น 22 หมวดสินค้า 40 เขตการขาย'),
  C('name_th', 'str120', nn=True, th='ชื่อชนิด'),
  C('has_rate', 'bool', nn=True, d='false', th='มีช่องอัตรา/ตัวเลข'),
], uniq=[('code',)]))

add(T('md_lookup', 'ตารางอ้างอิงทั่วไป (หมวดสินค้า เขตการขาย ขนส่งโดย เหตุผลยกเลิก ประเภทลูกค้า ฯลฯ)', 'md', express='ISTAB', cols=[
  C('type_code', 'code4', nn=True, th='ชนิด (md_lookup_type.code)', src='ISTAB.TABTYP'),
  C('code', 'code10', nn=True, th='รหัส', src='ISTAB.TYPCOD'),
  C('short_th', 'str30', th='ชื่อย่อไทย', src='ISTAB.SHORTNAM'),
  C('short_en', 'str30', th='ชื่อย่ออังกฤษ', src='ISTAB.SHORTNAM2'),
  C('name_th', 'str120', nn=True, th='ชื่อเต็มไทย', src='ISTAB.TYPDES'),
  C('name_en', 'str120', th='ชื่อเต็มอังกฤษ', src='ISTAB.TYPDES2'),
  C('rate', 'qty', th='อัตรา/ตัวเลขประกอบ', src='ISTAB.FLD02'),
  C('status', 'char1', nn=True, d="'A'", th='สถานะ', src='ISTAB.STATUS', chk=ST_ACTIVE),
], uniq=[('company_id','type_code','code')]))

add(T('md_unit', 'หน่วยนับ', 'md', express="ISTAB TABTYP '20'", cols=[
  C('code', 'code10', nn=True, th='รหัสหน่วย เช่น PC MT', src='ISTAB.TYPCOD'),
  C('name_th', 'str60', nn=True, th='ชื่อหน่วย', src='ISTAB.TYPDES'),
  C('name_en', 'str60', th='ชื่อภาษาอังกฤษ', src='ISTAB.TYPDES2'),
], uniq=[('company_id','code')]))

add(T('md_warehouse', 'คลังสินค้า', 'md', express="ISTAB TABTYP '21'", cols=[
  C('code', 'code10', nn=True, th='รหัสคลัง เช่น HO SW', src='ISTAB.TYPCOD'),
  C('name_th', 'str120', nn=True, th='ชื่อคลัง', src='ISTAB.TYPDES'),
  C('name_en', 'str120', th='ชื่อภาษาอังกฤษ', src='ISTAB.TYPDES2'),
  lk('branch_id', 'sys_branch', 'สาขาที่คลังสังกัด'),
  C('status', 'char1', nn=True, d="'A'", th='สถานะ', chk=ST_ACTIVE),
], uniq=[('company_id','code')]))

add(T('md_department', 'แผนก / ศูนย์ต้นทุน', 'md', express="ISTAB TABTYP '50'", cols=[
  C('code', 'code10', nn=True, th='รหัสแผนก', src='ISTAB.TYPCOD'),
  C('name_th', 'str120', nn=True, th='ชื่อเต็มไทย', src='ISTAB.TYPDES'),
  C('name_en', 'str120', th='ชื่อเต็มอังกฤษ', src='ISTAB.TYPDES2'),
  C('short_name_th', 'str30', th='ชื่อย่อไทย (คู่มือบทที่ 6 หน้า 90)', src='ISTAB.SHORTNAM'),
  C('short_name_en', 'str30', th='ชื่อย่ออังกฤษ', src='ISTAB.SHORTNAM2'),
  C('status', 'char1', nn=True, d="'A'", th='สถานะ', chk=ST_ACTIVE),
], uniq=[('company_id','code')]))

add(T('md_bank', 'ธนาคาร', 'md', express="ISTAB TABTYP '01'", cols=[
  C('code', 'code10', nn=True, th='รหัสธนาคาร', src='ISTAB.TYPCOD'),
  C('name_th', 'str120', nn=True, th='ชื่อธนาคาร', src='ISTAB.TYPDES'),
  C('name_en', 'str120', th='ชื่อภาษาอังกฤษ', src='ISTAB.TYPDES2'),
], uniq=[('company_id','code')]))

add(T('md_project', 'โครงการ / Job', 'md', express='JBMAS', cols=[
  C('code', 'code10', nn=True, th='รหัสโครงการ', src='JBMAS.JOBCOD'),
  C('name_th', 'str120', nn=True, th='ชื่อโครงการ', src='JBMAS.JOBNAM'),
  C('name_en', 'str120', th='ชื่อภาษาอังกฤษ', src='JBMAS.JOBNAM2'),
  lk('customer_id', 'md_customer', 'ลูกค้า', 'JBMAS.CUSCOD'),
  C('start_date', 'date', th='วันเริ่ม', src='JBMAS.BEGIN'),
  C('end_date', 'date', th='วันสิ้นสุด', src='JBMAS.END'),
  C('status', 'char1', nn=True, d="'A'", th='สถานะ', src='JBMAS.STATUS', chk=ST_ACTIVE),
], uniq=[('company_id','code')]))
add(T('md_project_budget', 'งบประมาณโครงการแยกขั้นตอน/รหัสต้นทุน', 'md', express='JBLIST', cols=[
  lk('project_id', 'md_project', 'โครงการ', nn=True),
  C('phase', 'code10', th='ขั้นตอน', src='JBLIST.PHASE'),
  C('cost_code', 'code10', th='รหัสต้นทุน', src='JBLIST.COSCOD'),
  C('est_expense', 'money', th='ประมาณการค่าใช้จ่าย', src='JBLIST.ESTEXP'),
  C('est_revenue', 'money', th='ประมาณการรายได้', src='JBLIST.ESTREV'),
], uniq=[('project_id','phase','cost_code')]))

add(T('md_item_account_group', 'กลุ่มบัญชีสินค้า — ชั้นที่ 2 ของการหาบัญชีสำหรับสินค้า', 'md', express="ISACC (ACCTYP='S')", cols=[
  C('code', 'code10', nn=True, th='รหัสกลุ่ม', src='ISACC.ACCCOD'),
  C('name_th', 'str120', nn=True, th='ชื่อกลุ่ม', src='ISACC.ACCDES'),
  C('name_en', 'str120', th='ชื่อภาษาอังกฤษ', src='ISACC.ACCDES2'),
  C('cost_method', 'char1', th='F=FIFO A=ถัวเฉลี่ย (ว่าง=ตามค่าบริษัท)', src='ISACC.METHOD', chk="cost_method IS NULL OR cost_method IN ('F','A')"),
  lk('inventory_account_id', 'gl_account', 'บัญชีสินค้า (ค่าใช้จ่าย สำหรับรหัสค่าใช้จ่ายอื่น)', 'ISACC.ACCNUM01'),
  lk('cogs_account_id', 'gl_account', 'บัญชีต้นทุนขาย', 'ISACC.ACCNUM02'),
  lk('sales_account_id', 'gl_account', 'บัญชีขาย', 'ISACC.ACCNUM03'),
  lk('sales_return_account_id', 'gl_account', 'บัญชีรับคืน', 'ISACC.ACCNUM04'),
  lk('purchase_account_id', 'gl_account', 'บัญชีซื้อ (Periodic)', 'ISACC.ACCNUM05'),
  lk('purchase_return_account_id', 'gl_account', 'บัญชีส่งคืน (Periodic)', 'ISACC.ACCNUM06'),
], uniq=[('company_id','code')]))

add(T('md_item', 'สินค้า / บริการ / รหัสค่าใช้จ่ายอื่น / รหัสรายได้อื่น', 'md', express='STMAS', cols=[
  C('code', 'code30', nn=True, th='รหัสสินค้า', src='STMAS.STKCOD'),
  C('item_type', 'char1', nn=True, d="'0'", th='0=สินค้า 1=สินค้าชุด 2=บริการ 4=รายได้อื่น 5=ค่าใช้จ่ายอื่น', src='STMAS.STKTYP', chk="item_type IN ('0','1','2','3','4','5')"),
  C('barcode', 'code30', th='บาร์โค้ด', src='STMAS.BARCOD'),
  C('name_th', 'str120', nn=True, th='ชื่อสินค้า', src='STMAS.STKDES'),
  C('name_en', 'str120', th='ชื่อภาษาอังกฤษ', src='STMAS.STKDES2'),
  C('item_level', 'code4', th='ระดับสินค้า (วัตถุดิบ/ประกอบ/สำเร็จรูป) lookup 23', src='STMAS.STKLEV'),
  C('category_code', 'code10', th='หมวดสินค้า lookup 22', src='STMAS.STKGRP'),
  lk('account_group_id', 'md_item_account_group', 'กลุ่มบัญชีสินค้า', 'STMAS.ACCCOD'),
  lk('base_unit_id', 'md_unit', 'หน่วยนับหลัก (หน่วยเล็ก)', 'STMAS.QUCOD'),
  lk('count_unit_id', 'md_unit', 'หน่วยนับสต๊อก/ตรวจนับ', 'STMAS.CQUCOD'),
  C('count_factor', 'qty', th='ตัวคูณหน่วยตรวจนับ', src='STMAS.CFACTOR'),
  lk('purchase_unit_id', 'md_unit', 'หน่วยซื้อ', 'STMAS.PQUCOD'),
  C('purchase_factor', 'qty', nn=True, d='1', th='ตัวคูณหน่วยซื้อ', src='STMAS.PFACTOR'),
  lk('sales_unit_id', 'md_unit', 'หน่วยขาย', 'STMAS.SQUCOD'),
  C('sales_factor', 'qty', nn=True, d='1', th='ตัวคูณหน่วยขาย', src='STMAS.SFACTOR'),
  C('std_cost', 'qty', th='ราคาทุนมาตรฐาน', src='STMAS.STNPR'),
  C('price_1', 'qty', th='ราคาขาย 1', src='STMAS.SELLPR1'),
  C('price_2', 'qty', th='ราคาขาย 2', src='STMAS.SELLPR2'),
  C('price_3', 'qty', th='ราคาขาย 3', src='STMAS.SELLPR3'),
  C('price_4', 'qty', th='ราคาขาย 4', src='STMAS.SELLPR4'),
  C('price_5', 'qty', th='ราคาขาย 5', src='STMAS.SELLPR5'),
  C('vat_code', 'char1', th='ประเภท VAT ของสินค้า (0=ยกเว้น 1=มี VAT ว่าง=ตามเอกสาร)', src='STMAS.VATCOD'),
  C('allow_negative', 'char1', th='Y/N/A=ตามค่าบริษัท', src='STMAS.NEGALLOW'),
  lk('default_supplier_id', 'md_supplier', 'ผู้จำหน่ายหลัก', 'STMAS.SUPCOD'),
  lk('substitute_item_id', 'md_item', 'สินค้าทดแทน', 'STMAS.STKCODS'),
  C('packing', 'str30', th='บรรจุ/หีบห่อ', src='STMAS.PACKING'),
  C('udf_1', 'str30', th='ช่องกำหนดเอง 1 (ISINFO.ST_STR1)', src='STMAS.STR1'),
  C('udf_2', 'str30', th='ช่องกำหนดเอง 2', src='STMAS.STR2'),
  C('udf_3', 'str30', th='ช่องกำหนดเอง 3', src='STMAS.STR3'),
  C('udf_4', 'str30', th='ช่องกำหนดเอง 4', src='STMAS.STR4'),
  C('udf_date_1', 'date', th='วันที่กำหนดเอง (เช่น วันหมดอายุ)', src='STMAS.DAT1'),
  C('remark', 'text', th='หมายเหตุ', src='STMAS.REMARK'),
  C('status', 'char1', nn=True, d="'A'", th='สถานะ', src='STMAS.STATUS', chk=ST_ACTIVE),
  C('inactive_date', 'date', th='วันที่เลิกใช้', src='STMAS.INACTDAT'),
], uniq=[('company_id','code')], idx=[('company_id','barcode'),('company_id','name_th')],
 note='ยอดคงเหลือ/ราคาซื้อขายล่าสุด (TOTBAL, LPURPR, LSELLPR …) ไม่เก็บในแฟ้มหลัก ย้ายไป inv_stock_balance ซึ่งคำนวณจากรายการ'))

add(T('md_item_bom', 'ส่วนประกอบสินค้าชุด', 'md', express='STBOM', cols=[
  lk('parent_item_id', 'md_item', 'สินค้าชุด', 'STBOM.PSTKCOD', nn=True),
  C('line_no', 'smallint', nn=True, th='ลำดับ', src='STBOM.SEQNUM'),
  lk('component_item_id', 'md_item', 'สินค้าประกอบ', 'STBOM.STKCOD', nn=True),
  C('qty', 'qty', nn=True, th='จำนวนต่อชุด', src='STBOM.BOMQTY'),
  C('std_cost', 'qty', th='ราคาทุน', src='STBOM.STNPR'),
  C('sell_price', 'qty', th='ราคาขาย', src='STBOM.SELLPR'),
  lk('warehouse_id', 'md_warehouse', 'คลังที่ตัดส่วนประกอบ', 'STBOM.LOCCOD'),
], uniq=[('parent_item_id','line_no')]))

add(T('md_item_price_break', 'ตารางราคาตามปริมาณ/ช่วงเวลา', 'md', express='STPRI', cols=[
  lk('item_id', 'md_item', 'สินค้า', 'STPRI.STKCOD', nn=True),
  lk('unit_id', 'md_unit', 'หน่วย', 'STPRI.QU'),
  C('factor', 'qty', th='ตัวคูณ', src='STPRI.FACTOR'),
  C('min_qty', 'qty', nn=True, th='ปริมาณขั้นต่ำ', src='STPRI.QTY'),
  C('is_percent', 'bool', nn=True, d='false', th='ราคาเป็น % ส่วนลด', src='STPRI.PERCENT'),
  C('price_1', 'qty', th='ราคา 1', src='STPRI.SELLPR1'),
  C('price_2', 'qty', th='ราคา 2', src='STPRI.SELLPR2'),
  C('price_3', 'qty', th='ราคา 3', src='STPRI.SELLPR3'),
  C('price_4', 'qty', th='ราคา 4', src='STPRI.SELLPR4'),
  C('price_5', 'qty', th='ราคา 5', src='STPRI.SELLPR5'),
  C('start_date', 'date', th='วันเริ่ม', src='STPRI.START'),
  C('end_date', 'date', th='วันสิ้นสุด', src='STPRI.END'),
]))

add(T('md_item_reorder', 'จุดสั่งซื้อแยกคลัง/ช่วงเวลา', 'md', express='STMIN', cols=[
  lk('item_id', 'md_item', 'สินค้า', 'STMIN.STKCOD', nn=True),
  lk('warehouse_id', 'md_warehouse', 'คลัง', 'STMIN.LOCCOD', nn=True),
  C('start_mmdd', 'code4', nn=True, th='เดือน/วันที่เริ่ม (MMDD)', src='STMIN.MMDD'),
  C('min_qty', 'qty', th='จุดสั่งซื้อ', src='STMIN.MINQTY'),
  C('max_qty', 'qty', th='จำนวนสูงสุด', src='STMIN.MAXQTY'),
  C('order_qty', 'qty', th='ซื้อครั้งละ', src='STMIN.REOQTY'),
  C('projected_sales', 'qty', th='ยอดขายโครงการ', src='STMIN.PRJSAL'),
], uniq=[('item_id','warehouse_id','start_mmdd')]))

add(T('md_customer', 'ลูกค้า', 'md', express='ARMAS', cols=[
  C('code', 'code20', nn=True, th='รหัสลูกค้า', src='ARMAS.CUSCOD'),
  C('customer_type', 'code4', th='ประเภทลูกค้า lookup 45', src='ARMAS.CUSTYP'),
  C('title', 'str30', th='คำนำหน้า', src='ARMAS.PRENAM'),
  C('name', 'str120', nn=True, th='ชื่อลูกค้า', src='ARMAS.CUSNAM'),
  C('name_en', 'str120', th='ชื่อภาษาอังกฤษ', src='ARMAS.CUSNAM2'),
  C('address_1', 'str100', th='ที่อยู่ 1', src='ARMAS.ADDR01'),
  C('address_2', 'str100', th='ที่อยู่ 2', src='ARMAS.ADDR02'),
  C('address_3', 'str100', th='ที่อยู่ 3', src='ARMAS.ADDR03'),
  C('zip_code', 'code10', th='รหัสไปรษณีย์', src='ARMAS.ZIPCOD'),
  C('phone', 'str60', th='โทรศัพท์', src='ARMAS.TELNUM'),
  C('email', 'str120', th='อีเมล (ใหม่)'),
  C('contact', 'str60', th='ผู้ติดต่อ', src='ARMAS.CONTACT'),
  C('tax_id', 'code13', th='เลขผู้เสียภาษี', src='ARMAS.TAXID'),
  C('tax_branch_no', 'code5', th='เลขที่สาขาของลูกค้า (00000 = สนญ.)'),
  lk('salesperson_id', 'md_salesperson', 'พนักงานขาย', 'ARMAS.SLMCOD'),
  C('sales_area_code', 'code10', th='เขตการขาย lookup 40', src='ARMAS.AREACOD'),
  C('ship_via_code', 'code10', th='ขนส่งโดย lookup 41', src='ARMAS.DLVBY'),
  C('credit_days', 'smallint', th='เครดิต (วัน)', src='ARMAS.PAYTRM'),
  C('payment_terms', 'str60', th='เงื่อนไขการชำระ', src='ARMAS.PAYCOND'),
  C('price_level', 'char1', th='ตารางราคาที่ใช้ 0–5', src='ARMAS.TABPR'),
  C('discount_text', 'str20', th='ส่วนลด (เช่น 5%+2)', src='ARMAS.DISC'),
  C('credit_limit', 'money', th='วงเงินอนุมัติ', src='ARMAS.CRLINE'),
  lk('ar_account_id', 'gl_account', 'บัญชีลูกหนี้ (ชั้นที่ 2)', 'ARMAS.ACCNUM'),
  lk('payer_id', 'md_customer', 'ผู้ชำระเงินแทน', 'ARMAS.PAYER'),
  C('wht_form', 'code4', th='แบบภาษีหัก ณ ที่จ่ายที่ลูกค้าหักเรา', src='ARMAS.TAXTYP'),
  C('wht_rate', 'rate', th='อัตราภาษีหัก ณ ที่จ่าย', src='ARMAS.TAXRAT'),
  C('remark', 'text', th='หมายเหตุ', src='ARMAS.REMARK'),
  C('status', 'char1', nn=True, d="'A'", th='สถานะ', src='ARMAS.STATUS', chk=ST_ACTIVE),
  C('inactive_date', 'date', th='วันที่เลิกใช้', src='ARMAS.INACTDAT'),
], uniq=[('company_id','code')], idx=[('company_id','name')],
 note='BALANCE, CHQRCV, LASIVC และยอดรายงวดใน ARBAL เป็นค่าคำนวณ ระบบใหม่ได้จาก v_ar_outstanding / doc_header'))

add(T('md_customer_ship_to', 'สถานที่ส่งของของลูกค้า', 'md', express='ARSHIP', cols=[
  lk('customer_id', 'md_customer', 'ลูกค้า', 'ARSHIP.CUSCOD'),
  C('code', 'code10', nn=True, th='รหัสสถานที่ส่ง', src='ARSHIP.SHIPTO'),
  C('address_1', 'str100', th='ที่อยู่ 1', src='ARSHIP.ADDR01'),
  C('address_2', 'str100', th='ที่อยู่ 2', src='ARSHIP.ADDR02'),
  C('address_3', 'str100', th='ที่อยู่ 3', src='ARSHIP.ADDR03'),
  C('zip_code', 'code10', th='รหัสไปรษณีย์', src='ARSHIP.ZIPCOD'),
  C('phone', 'str60', th='โทรศัพท์', src='ARSHIP.TELNUM'),
  C('contact', 'str60', th='ผู้ติดต่อ', src='ARSHIP.CONTACT'),
], uniq=[('company_id','customer_id','code')], note="CUSCOD='@@@@@@@@@@' ใน Express = สถานที่ส่งใช้ร่วมทุกลูกค้า → customer_id ว่าง"))

add(T('md_supplier', 'ผู้จำหน่าย / เจ้าหนี้', 'md', express='APMAS', cols=[
  C('code', 'code20', nn=True, th='รหัสผู้จำหน่าย', src='APMAS.SUPCOD'),
  C('supplier_type', 'code4', th='ประเภท lookup 46', src='APMAS.SUPTYP'),
  C('title', 'str30', th='คำนำหน้า', src='APMAS.PRENAM'),
  C('name', 'str120', nn=True, th='ชื่อผู้จำหน่าย', src='APMAS.SUPNAM'),
  C('name_en', 'str120', th='ชื่อภาษาอังกฤษ', src='APMAS.SUPNAM2'),
  C('address_1', 'str100', th='ที่อยู่ 1', src='APMAS.ADDR01'),
  C('address_2', 'str100', th='ที่อยู่ 2', src='APMAS.ADDR02'),
  C('address_3', 'str100', th='ที่อยู่ 3', src='APMAS.ADDR03'),
  C('zip_code', 'code10', th='รหัสไปรษณีย์', src='APMAS.ZIPCOD'),
  C('phone', 'str60', th='โทรศัพท์', src='APMAS.TELNUM'),
  C('contact', 'str60', th='ผู้ติดต่อ', src='APMAS.CONTACT'),
  C('tax_id', 'code13', th='เลขผู้เสียภาษี', src='APMAS.TAXID'),
  C('tax_branch_no', 'code5', th='เลขที่สาขา'),
  C('price_type', 'char1', th='ประเภทราคา 0=ไม่มี VAT 1=รวม VAT 2=แยก VAT', src='APMAS.FLGVAT'),
  C('vat_rate', 'rate', th='อัตรา VAT', src='APMAS.VATRAT'),
  C('ship_via_code', 'code10', th='ขนส่งโดย', src='APMAS.DLVBY'),
  C('credit_days', 'smallint', th='เครดิต (วัน)', src='APMAS.PAYTRM'),
  C('payment_terms', 'str60', th='เงื่อนไขการชำระ', src='APMAS.PAYCOND'),
  C('discount_text', 'str20', th='ส่วนลด', src='APMAS.DISC'),
  C('credit_limit', 'money', th='วงเงิน', src='APMAS.CRLINE'),
  lk('ap_account_id', 'gl_account', 'บัญชีเจ้าหนี้ (ชั้นที่ 2)', 'APMAS.ACCNUM'),
  C('wht_form', 'code4', th='แบบ ภ.ง.ด. S03=ภ.ง.ด.3 S53=ภ.ง.ด.53', src='APMAS.TAXTYP'),
  C('wht_income_desc', 'str60', th='ประเภทเงินได้ที่จ่าย', src='APMAS.TAXDES'),
  C('wht_rate', 'rate', th='อัตราภาษีหัก ณ ที่จ่าย', src='APMAS.TAXRAT'),
  C('wht_condition', 'char1', th='เงื่อนไข 1=หัก ณ ที่จ่าย 2=ออกให้ตลอดไป 3=ออกให้ครั้งเดียว', src='APMAS.TAXCOND'),
  C('on_hold', 'bool', nn=True, d='false', th='ระงับการจ่าย', src='APMAS.ONHOLD'),
  C('remark', 'text', th='หมายเหตุ', src='APMAS.REMARK'),
  C('status', 'char1', nn=True, d="'A'", th='สถานะ', src='APMAS.STATUS', chk=ST_ACTIVE),
  C('inactive_date', 'date', th='วันที่เลิกใช้', src='APMAS.INACTDAT'),
], uniq=[('company_id','code')], idx=[('company_id','name')]))

add(T('md_salesperson', 'พนักงานขาย', 'md', express='OESLM', cols=[
  C('code', 'code20', nn=True, th='รหัสพนักงานขาย', src='OESLM.SLMCOD'),
  C('name', 'str120', nn=True, th='ชื่อ', src='OESLM.SLMNAM'),
  C('position', 'str60', th='ตำแหน่ง', src='OESLM.POSITN'),
  C('salesperson_type', 'code4', th='ประเภท lookup 47', src='OESLM.SLMTYP'),
  C('sales_area_code', 'code10', th='เขตการขาย', src='OESLM.AREACOD'),
  C('commission_rate', 'rate', th='อัตราค่าคอมมิชชั่น %', src='OESLM.COMRATE'),
  C('address', 'text', th='ที่อยู่', src='OESLM.ADDR01-03'),
  C('phone', 'str60', th='โทรศัพท์', src='OESLM.TELNUM'),
  C('tax_id', 'code13', th='เลขผู้เสียภาษี', src='OESLM.TAXID'),
  C('social_security_no', 'code20', th='เลขประกันสังคม', src='OESLM.SOCIALID'),
  C('status', 'char1', nn=True, d="'A'", th='สถานะ', src='OESLM.STATUS', chk=ST_ACTIVE),
], uniq=[('company_id','code')]))
add(T('md_sales_target', 'เป้าการขายรายงวด', 'md', express='OESLM.TAR1–TAR12NY', cols=[
  lk('salesperson_id', 'md_salesperson', 'พนักงานขาย', nn=True),
  lk('period_id', 'gl_period', 'งวด', nn=True),
  C('target_amount', 'money', nn=True, th='เป้าการขาย'),
], uniq=[('salesperson_id','period_id')]))

add(T('md_bank_account', 'บัญชีเงินฝากของกิจการ', 'md', express='BKMAS', cols=[
  C('code', 'code10', nn=True, th='รหัสบัญชีเงินฝาก เช่น C1 S1', src='BKMAS.BNKACC'),
  lk('bank_id', 'md_bank', 'ธนาคาร'),
  C('name', 'str120', nn=True, th='ชื่อบัญชี/ธนาคาร', src='BKMAS.BNKNAM'),
  C('branch', 'str60', th='สาขาธนาคาร', src='BKMAS.BRANCH'),
  C('short_name', 'str20', th='ชื่อย่อ', src='BKMAS.SHORTNAM'),
  C('account_number', 'code30', th='เลขที่บัญชีธนาคาร', src='BKMAS.BNKNUM'),
  C('account_kind', 'char1', th='C=กระแสรายวัน S=ออมทรัพย์ F=ฝากประจำ/ต่างประเทศ'),
  lk('gl_account_id', 'gl_account', 'บัญชีแยกประเภท', 'BKMAS.ACCNUM'),
  C('currency', 'code3', nn=True, d="'THB'", th='สกุลเงิน'),
  C('opening_balance', 'money', th='ยอดยกมา', src='BKMAS.BALFWD'),
  C('opening_date', 'date', th='วันที่ยอดยกมา', src='BKMAS.BALDAT'),
  C('status', 'char1', nn=True, d="'A'", th='สถานะ', chk=ST_ACTIVE),
], uniq=[('company_id','code')]))

add(T('md_doc_type', 'ประเภทเอกสารและพฤติกรรม (prefix สมุดรายวัน อนุมัติ บัญชี)', 'md', express="ISRUN (DOCTYP <> 'ZR','ZP','GL')", cols=[
  C('code', 'code10', nn=True, th='prefix เอกสาร เช่น IV TI RR PS', src='ISRUN.PREFIX'),
  C('doc_class', 'code4', nn=True, th='หมวดเอกสาร (กำหนดตรรกะ) = ISRUN.DOCTYP เช่น IV=ขายเชื่อ CN=ลดหนี้/รับคืน RR=ซื้อเชื่อ DN=ลดหนี้/ส่งคืน OU=เบิกใช้ JU=ปรับปรุง/ตรวจนับ', src='ISRUN.DOCTYP'),
  C('module', 'code4', nn=True, th='ระบบ AR AP SO PO IC BK GL PC'),
  C('name_th', 'str120', nn=True, th='ชื่อเอกสาร', src='ISRUN.POSDES'),
  C('name_en', 'str120', th='ชื่อภาษาอังกฤษ', src='ISRUN.POSDES2'),
  C('short_name', 'code10', th='ชื่อย่อ', src='ISRUN.SHORTNAM'),
  lk('journal_book_id', 'gl_journal_book', 'สมุดรายวันที่ลงบัญชี', 'ISRUN.JNLTYP'),
  C('journal_desc_template', 'str200', th='สูตรคำอธิบายรายการบัญชี เช่น "ขายเชื่อให้ {party.name}"', src='ISRUN.JNLEXP'),
  lk('department_id', 'md_department', 'แผนก default', 'ISRUN.DEPCOD'),
  lk('warehouse_id', 'md_warehouse', 'คลัง default', 'ISRUN.LOCCOD'),
  C('price_type', 'char1', th='ประเภทราคา default 0/1/2', src='ISRUN.FLGVAT'),
  C('vat_rate', 'rate', th='อัตรา VAT default', src='ISRUN.VATRAT'),
  C('vat_basis', 'char1', th='เกณฑ์ภาษีบริการ 1=เกณฑ์สิทธิ 2=เกณฑ์เงินสด', src='ISRUN.SRV_VATTYP'),
  C('vat_per_line', 'bool', nn=True, d='false', th='แยกประเภท VAT รายบรรทัด', src='ISRUN.VAT_INITEM'),
  C('approve_method', 'char1', th='วิธีอนุมัติ', src='ISRUN.APPROV_MET'),
  C('approve_level', 'smallint', th='ระดับอนุมัติ', src='ISRUN.APPROV_LEV'),
  C('reprint_level', 'smallint', th='ระดับที่พิมพ์ซ้ำได้', src='ISRUN.REPRN_LEV'),
  C('cancel_level', 'smallint', th='ระดับที่ยกเลิกได้', src='ISRUN.CANCEL_LEV'),
  C('delete_level', 'smallint', th='ระดับที่ลบได้', src='ISRUN.DELETE_LEV'),
  C('over_limit_level', 'smallint', th='ระดับอนุมัติเกินวงเงิน', src='ISRUN.OVRLIN_LEV'),
  C('auto_print', 'bool', nn=True, d='false', th='พิมพ์อัตโนมัติหลังบันทึก', src='ISRUN.AUTOPRN'),
  C('form_no', 'smallint', th='ฟอร์มที่ใช้พิมพ์ 1–9', src='ISRUN.WHICHFORM'),
  C('use_barcode', 'bool', nn=True, d='false', th='ป้อนรายการด้วยบาร์โค้ด', src='ISRUN.USEBARCOD'),
  C('is_tax_invoice', 'bool', nn=True, d='false', th='เป็นใบกำกับภาษี (ต้องเรียงเลขต่อเนื่องตามสาขา/เล่ม)'),
  C('status', 'char1', nn=True, d="'A'", th='สถานะ', chk=ST_ACTIVE),
], uniq=[('company_id','code')]))

add(T('md_doc_type_account', 'บัญชีที่กำหนดไว้ที่ประเภทเอกสาร — ชั้นที่ 1 ของการหาบัญชี', 'md', express='ISRUN.ACCNUM01–ACCNUM12', cols=[
  lk('doc_type_id', 'md_doc_type', 'ประเภทเอกสาร', nn=True),
  C('slot', 'smallint', nn=True, th='ช่องที่ 1–12 ตาม Express', chk='slot BETWEEN 1 AND 12'),
  C('role', 'code30', th='บทบาทบัญชีของช่องนี้ (ตาม doc_class)'),
  lk('account_id', 'gl_account', 'บัญชี', nn=True),
], uniq=[('doc_type_id','slot')]))

add(T('md_payment_method', 'วิธีรับ/จ่ายเงิน (เงินสด เช็ค โอน หัก ณ ที่จ่าย ส่วนลด ฯลฯ)', 'md', express="ISRUN DOCTYP='ZR'(รับ)/'ZP'(จ่าย) + เริ่มระบบ 1.4.2/1.5.2", cols=[
  C('direction', 'char1', nn=True, th='R=รับ P=จ่าย', src='ISRUN.DOCTYP', chk="direction IN ('R','P')"),
  C('code', 'code10', nn=True, th='รหัส 2 ตัว (นำหน้าเลขที่ในรายการชำระ เช่น QR TR TS)', src='ISRUN.PREFIX'),
  C('seq', 'code4', th='ลำดับในจอ', src='ISRUN.DOCCOD'),
  C('name_th', 'str120', nn=True, th='ชื่อวิธีชำระ', src='ISRUN.POSDES'),
  C('name_en', 'str120', th='ชื่อภาษาอังกฤษ', src='ISRUN.POSDES2'),
  C('kind', 'code10', nn=True, d="'OTHER'", th='CASH CHEQUE TRANSFER CARD WHT DISCOUNT DEPOSIT FX OTHER'),
  lk('gl_account_id', 'gl_account', 'บัญชีที่ลง', 'ISRUN.ACCNUM01'),
  lk('bank_account_id', 'md_bank_account', 'บัญชีเงินฝากที่เกี่ยวข้อง (โอน/เช็ค)'),
  C('creates_cheque', 'bool', nn=True, d='false', th='สร้างรายการในทะเบียนเช็ค/โอน (fin_cheque)'),
  C('status', 'char1', nn=True, d="'A'", th='สถานะ', chk=ST_ACTIVE),
], uniq=[('company_id','direction','code')]))

add(T('md_doc_number_block', 'ช่วงเลขที่เอกสารที่จองให้แต่ละเครื่อง — ออกเลขได้ตอนออฟไลน์โดยไม่ซ้ำ', 'sync', express='ISRUN.DOCNUM (เลขถัดไป)', cols=[
  lk('doc_type_id', 'md_doc_type', 'ประเภทเอกสาร', nn=True),
  lk('branch_id', 'sys_branch', 'สาขา', nn=True),
  lk('device_id', 'sys_device', 'เครื่องที่ได้รับช่วงเลข (ว่าง = ใช้บนเซิร์ฟเวอร์)'),
  C('series', 'code20', nn=True, th='ชุด/เล่ม เช่น 2569 หรือ 2569-POS1'),
  C('format', 'str40', nn=True, d="'{prefix}{yy}{mm}-{seq:5}'", th='รูปแบบเลขที่'),
  C('range_start', 'bigint', nn=True, th='เลขเริ่มของช่วง'),
  C('range_end', 'bigint', nn=True, th='เลขสุดท้ายของช่วง'),
  C('next_no', 'bigint', nn=True, th='เลขถัดไปที่จะใช้'),
  C('status', 'char1', nn=True, d="'A'", th='A=ใช้งาน F=ใช้หมด X=คืน/ยกเลิก', chk="status IN ('A','F','X')"),
], uniq=[('doc_type_id','branch_id','series','range_start')]))

# =====================================================================
# DOCUMENTS
# =====================================================================
DOC_STATUS = "doc_status IN ('D','N','M','C')"
add(T('doc_header', 'หัวเอกสารทุกชนิด (ขาย ซื้อ สั่งขาย สั่งซื้อ สินค้า การเงิน เงินสดย่อย)', 'doc',
      express='ARTRN + APTRN + OESO + POPR + STTRN + ARBIL/APBIL + GLPTT + BKTRN(ส่วนเอกสาร)', cols=[
  lk('branch_id', 'sys_branch', 'สาขาที่ออกเอกสาร', nn=True),
  lk('doc_type_id', 'md_doc_type', 'ประเภทเอกสาร (prefix)', 'ISRUN', nn=True),
  C('doc_class', 'code4', nn=True, th='ชนิดเอกสาร = หมวดเอกสารของ Express (ISRUN.DOCTYP): ขาย QT SO AI IV HS DR CN(ลดหนี้) OI BS(วางบิล) RE | ซื้อ PO AE RR HP CP DN(ลดหนี้) OE BR PS | สินค้า OU RL JU CA | ธนาคาร BD BW BT BU BV BQ QP | เงินสดย่อย DP VR', src='ARTRN/APTRN.RECTYP, OESO.SORECTYP, STTRN.POSOPR'),
  C('module', 'code4', nn=True, th='AR AP SO PO IC BK PC'),
  C('express_rectype', 'char1', th='RECTYP เดิมของ Express (เก็บไว้ตรวจย้อน)', src='RECTYP'),
  C('doc_no', 'code30', nn=True, th='เลขที่เอกสาร', src='DOCNUM / SONUM / PONUM / BILNUM'),
  C('is_provisional_no', 'bool', nn=True, d='false', th='เลขชั่วคราว (ออฟไลน์ ยังไม่ได้เลขจริง) — ใช้เฉพาะเอกสารที่ไม่ใช่ใบกำกับภาษี'),
  C('doc_date', 'date', nn=True, th='วันที่เอกสาร', src='DOCDAT / SODAT / PODAT / BILDAT'),
  lk('period_id', 'gl_period', 'งวดบัญชีของเอกสาร'),
  lk('customer_id', 'md_customer', 'ลูกค้า', 'ARTRN.CUSCOD / OESO.CUSCOD / ARBIL.CUSCOD'),
  lk('supplier_id', 'md_supplier', 'ผู้จำหน่าย', 'APTRN.SUPCOD / POPR.SUPCOD / APBIL.SUPCOD'),
  lk('bill_to_customer_id', 'md_customer', 'Bill to (ชื่อบนใบกำกับ)'),
  lk('ship_to_id', 'md_customer_ship_to', 'สถานที่ส่งของ', 'SHIPTO'),
  C('party_tax_id', 'code13', th='เลขผู้เสียภาษีของคู่ค้า (snapshot ตอนออกเอกสาร)'),
  C('party_tax_branch_no', 'code5', th='สาขาของคู่ค้า (snapshot)'),
  C('party_name', 'str200', th='ชื่อคู่ค้า (snapshot ตอนออกใบกำกับ)'),
  C('party_address', 'text', th='ที่อยู่คู่ค้า (snapshot)'),
  lk('salesperson_id', 'md_salesperson', 'พนักงานขาย', 'SLMCOD'),
  lk('department_id', 'md_department', 'แผนก', 'DEPCOD'),
  lk('project_id', 'md_project', 'โครงการ'),
  C('sales_area_code', 'code10', th='เขตการขาย', src='AREACOD'),
  C('ship_via_code', 'code10', th='ขนส่งโดย', src='DLVBY'),
  lk('warehouse_id', 'md_warehouse', 'คลัง (เอกสารสินค้า)', 'STTRN.LOCCOD'),
  lk('to_warehouse_id', 'md_warehouse', 'คลังปลายทาง (โอนย้าย)', 'STTRN.PEOPLE'),
  lk('bank_account_id', 'md_bank_account', 'บัญชีเงินฝาก (เอกสารธนาคาร/นำฝาก)', 'BKTRN.BNKACC'),
  C('your_ref', 'str60', th='อ้างอิง/เลขที่ PO ของลูกค้า', src='YOUREF'),
  C('ref_no', 'code30', th='เลขที่ใบกำกับ/บิลของผู้จำหน่าย', src='APTRN.REFNUM / STTRN.REFNUM'),
  C('ref_date', 'date', th='วันที่อ้างอิง', src='STTRN.REFDAT'),
  C('credit_days', 'smallint', th='เครดิต (วัน)', src='PAYTRM'),
  C('due_date', 'date', th='วันครบกำหนด', src='DUEDAT'),
  C('delivery_date', 'date', th='วันส่งของ/รับของ (SO/PO)', src='OESO.DLVDAT / POPR.RCVDAT'),
  C('delivery_date_per_line', 'bool', nn=True, d='false', th='กำหนดวันส่ง/รับรายบรรทัด', src='DLVDAT_IT / RCVDAT_IT'),
  C('price_type', 'char1', nn=True, d="'2'", th='0=ยกเว้น/ไม่มี VAT 1=ราคารวม VAT 2=ราคาแยก VAT', src='FLGVAT', chk="price_type IN ('0','1','2')"),
  C('currency', 'code3', nn=True, d="'THB'", th='สกุลเงิน'),
  C('exchange_rate', 'rate', nn=True, d='1', th='อัตราแลกเปลี่ยน'),
  C('amount', 'money', nn=True, d='0', th='รวมเงินก่อนหักส่วนลด', src='AMOUNT'),
  C('discount_text', 'str20', th='สูตรส่วนลดท้ายบิล เช่น 5%+100', src='DISC'),
  C('discount_amount', 'money', nn=True, d='0', th='ส่วนลดท้ายบิล', src='DISCAMT'),
  C('amount_after_discount', 'money', nn=True, d='0', th='หลังหักส่วนลด', src='AFTDISC'),
  C('deposit_amount', 'money', nn=True, d='0', th='หักเงินมัดจำ', src='ADVAMT'),
  C('zero_rate_amount', 'money', nn=True, d='0', th='มูลค่าอัตรา 0%', src='AMTRAT0'),
  C('taxable_amount', 'money', nn=True, d='0', th='มูลค่าก่อน VAT', src='TOTAL / NETVAL'),
  C('vat_rate', 'rate', th='อัตรา VAT', src='VATRAT'),
  C('vat_amount', 'money', nn=True, d='0', th='ภาษีมูลค่าเพิ่ม', src='VATAMT'),
  C('net_amount', 'money', nn=True, d='0', th='ยอดสุทธิ (รวม VAT)', src='NETAMT'),
  C('wht_amount', 'money', nn=True, d='0', th='ภาษีหัก ณ ที่จ่าย', src='TAX'),
  C('cash_amount', 'money', nn=True, d='0', th='รับ/จ่ายเป็นเงินสด', src='CSHRCV / CSHPAY'),
  C('cheque_amount', 'money', nn=True, d='0', th='รับ/จ่ายเป็นเช็ค/อื่น', src='CHQRCV / CHQPAY'),
  C('interest_amount', 'money', nn=True, d='0', th='ดอกเบี้ยรับ/จ่าย', src='INTRCV / INTPAY'),
  C('cash_discount_amount', 'money', nn=True, d='0', th='ส่วนลดเงินสด'),
  C('settled_amount', 'money', nn=True, d='0', th='ยอดที่ชำระ/ตัดแล้ว', src='RCVAMT / PAYAMT'),
  C('outstanding_amount', 'money', nn=True, d='0', th='ยอดคงค้าง', src='REMAMT'),
  C('commission_amount', 'money', nn=True, d='0', th='ค่าคอมมิชชั่น', src='COMAMT'),
  C('vat_basis', 'char1', th='เกณฑ์ภาษี 1=สิทธิ 2=เงินสด 3=ทั้งสอง', src='SRV_VATTYP'),
  C('vat_date', 'date', th='วันที่ใบกำกับภาษี (ยื่นภาษี)', src='VATDAT'),
  lk('vat_period_id', 'gl_period', 'งวดภาษีที่ยื่น', 'VATPRD'),
  C('vat_late', 'bool', nn=True, d='false', th='ยื่นเพิ่มเติม (ใบกำกับมาช้า)', src='VATLATE'),
  C('doc_status', 'char1', nn=True, d="'N'", th='D=ร่าง(ออฟไลน์) N=ปกติ M=ใช้ครบ/ปิดแล้ว C=ยกเลิก', src='DOCSTAT', chk=DOC_STATUS),
  C('is_settled', 'bool', nn=True, d='false', th='ตัดชำระ/ส่งของครบแล้ว', src='CMPLAPP'),
  C('settled_date', 'date', th='วันที่ครบ', src='CMPLDAT'),
  C('appointment_date', 'date', th='วันนัดชำระ (ใบวางบิล)', src='ARBIL/APBIL.APPDAT'),
  C('payment_terms', 'str60', th='เงื่อนไขการชำระ', src='PAYCOND'),
  C('remark', 'text', th='หมายเหตุสั้น', src='REMARK'),
  C('gl_posted', 'char1', nn=True, d="'N'", th='N=ยังไม่ลงบัญชี Y=ลงแล้ว P=รอเซิร์ฟเวอร์ลง', src='POSTGL'),
  lk('journal_id', 'gl_journal', 'ใบสำคัญที่เกิดจากเอกสารนี้'),
  lk('approved_by', 'sys_user', 'ผู้อนุมัติ', 'APPROVE'),
  C('approved_at', 'ts', th='เวลาอนุมัติ'),
  lk('auth_user_id', 'sys_user', 'ผู้อนุมัติแทน', 'AUTHID'),
  C('print_count', 'smallint', nn=True, d='0', th='จำนวนครั้งที่พิมพ์', src='PRNCNT'),
  lk('last_printed_by', 'sys_user', 'ผู้พิมพ์ล่าสุด', 'USERPRN'),
  C('last_printed_at', 'ts', th='วันเวลาพิมพ์ล่าสุด', src='PRNDAT+PRNTIM'),
  C('cancel_reason', 'str200', th='เหตุผลยกเลิก'),
  lk('device_id', 'sys_device', 'เครื่องที่สร้างเอกสาร (ออฟไลน์)'),
], uniq=[('company_id','doc_type_id','doc_no')],
 idx=[('company_id','doc_class','doc_date'),('company_id','customer_id','doc_date'),('company_id','supplier_id','doc_date'),('company_id','doc_no')],
 note='รวมเอกสารทุกระบบไว้ตารางเดียวตามแนว ARTRN/APTRN ของ Express — ทำให้การออกเลข การซิงก์ การลงบัญชี และ audit ใช้กลไกเดียวกัน'))

add(T('doc_line', 'บรรทัดรายการของเอกสาร (สินค้า บริการ ค่าใช้จ่าย บัญชี)', 'doc', express='STCRD + OESOIT + POPRIT + GLPTTIT + BKTRNIT', cols=[
  lk('header_id', 'doc_header', 'หัวเอกสาร', 'DOCNUM', nn=True),
  C('line_no', 'smallint', nn=True, th='ลำดับบรรทัด', src='SEQNUM'),
  C('line_kind', 'char1', nn=True, d="'I'", th='I=สินค้า/บริการ G=บรรทัดบัญชี (ระบุบัญชีตรง) T=ข้อความ', chk="line_kind IN ('I','G','T')"),
  lk('item_id', 'md_item', 'สินค้า/บริการ/รหัสค่าใช้จ่าย', 'STCRD.STKCOD'),
  lk('account_id', 'gl_account', 'บัญชี (บรรทัดบัญชี เช่น เงินสดย่อย ค่าใช้จ่ายอื่น)', 'GLPTTIT.ACCNUM'),
  C('description', 'str200', th='รายละเอียด (แก้ชื่อสินค้าได้)', src='STCRD.STKDES'),
  lk('warehouse_id', 'md_warehouse', 'คลัง', 'STCRD.LOCCOD'),
  lk('department_id', 'md_department', 'แผนก', 'STCRD.DEPCOD'),
  lk('project_id', 'md_project', 'โครงการ', 'STCRD.JOBCOD'),
  C('project_phase', 'code10', th='ขั้นตอนโครงการ', src='STCRD.PHASE'),
  C('cost_code', 'code10', th='รหัสต้นทุน', src='STCRD.COSCOD'),
  C('qty', 'qty', nn=True, d='0', th='จำนวน (หน่วยที่ป้อน)', src='TRNQTY / ORDQTY'),
  lk('unit_id', 'md_unit', 'หน่วย', 'TQUCOD'),
  C('factor', 'qty', nn=True, d='1', th='ตัวคูณเป็นหน่วยหลัก', src='TFACTOR'),
  C('base_qty', 'qty', nn=True, d='0', th='จำนวนเป็นหน่วยหลัก = qty × factor', src='XTRNQTY'),
  C('unit_price', 'qty', nn=True, d='0', th='ราคาต่อหน่วย', src='UNITPR'),
  C('discount_text', 'str20', th='สูตรส่วนลดรายบรรทัด', src='DISC'),
  C('discount_amount', 'money', nn=True, d='0', th='ส่วนลดรายบรรทัด', src='DISCAMT'),
  C('line_amount', 'money', nn=True, d='0', th='จำนวนเงิน (ตามประเภทราคาของเอกสาร)', src='TRNVAL'),
  C('net_amount', 'money', nn=True, d='0', th='มูลค่าสุทธิก่อน VAT (หลังเฉลี่ยส่วนลดท้ายบิล)', src='NETVAL'),
  C('vat_code', 'char1', th='ประเภท VAT รายบรรทัด', src='VATCOD'),
  C('is_free', 'bool', nn=True, d='false', th='ของแถม', src='FREE'),
  C('return_to_stock', 'bool', th='รับคืน/ส่งคืนแล้วเข้าสต๊อก (ใบลดหนี้)', src='RETSTK'),
  C('stock_effect', 'smallint', nn=True, d='0', th='ผลต่อสต๊อก +1 รับเข้า −1 จ่ายออก 0 ไม่กระทบ', chk='stock_effect IN (-1,0,1)'),
  C('movement_code', 'char1', th='รหัสการเคลื่อนไหวเดิม (POSOPR: 0 ซื้อ 1 รับ/ปรับเพิ่ม 2 รับคืน 3 โอนออก 4 โอนเข้า 5 ปรับต้นทุน 6 เบิกใช้ 7 ส่งคืน 8 ปรับปรุง 9 ขาย : ตรวจนับ = เพิ่มหนี้ > คชจ.อื่น)', src='STCRD.POSOPR'),
  C('cost_unit', 'qty', th='ต้นทุนต่อหน่วยหลัก (คำนวณตอน post)', src='XUNITPR'),
  C('cost_amount', 'money', th='มูลค่าต้นทุน (คำนวณตอน post)', src='XTRNVAL'),
  C('sales_value', 'money', th='มูลค่าขายสุทธิ (สำหรับรายงานกำไรขั้นต้น)', src='XSALVAL'),
  lk('source_line_id', 'doc_line', 'บรรทัดต้นทาง (บรรทัด SO/PO/IV ที่อ้างถึง)', 'STCRD.RDOCNUM'),
  lk('party_customer_id', 'md_customer', 'ลูกค้าของบรรทัด (denormalized จากหัว — ใช้ค้นสต๊อกการ์ดตามคู่ค้า)', 'STCRD.PEOPLE'),
  lk('party_supplier_id', 'md_supplier', 'ผู้จำหน่ายของบรรทัด', 'STCRD.PEOPLE'),
  lk('salesperson_id', 'md_salesperson', 'พนักงานขาย', 'STCRD.SLMCOD'),
  C('ordered_qty', 'qty', th='จำนวนสั่ง (SO/PO)', src='OESOIT/POPRIT.ORDQTY'),
  C('remaining_qty', 'qty', th='ค้างส่ง/ค้างรับ', src='REMQTY'),
  C('cancelled_qty', 'qty', th='จำนวนยกเลิก', src='CANCELQTY'),
  C('cancel_reason_code', 'code10', th='เหตุผลยกเลิก lookup 42/43', src='CANCELTYP'),
  C('cancel_date', 'date', th='วันที่ยกเลิก', src='CANCELDAT'),
  C('delivery_date', 'date', th='วันส่ง/รับของรายบรรทัด', src='DLVDAT / RCVDAT'),
  lk('gl_debit_account_id', 'gl_account', 'บัญชีเดบิตที่ระบุเอง (ทับกฎ)', 'STCRD.ACCNUMDR'),
  lk('gl_credit_account_id', 'gl_account', 'บัญชีเครดิตที่ระบุเอง (ทับกฎ)', 'STCRD.ACCNUMCR'),
  C('packing', 'str30', th='บรรจุ', src='PACKING'),
  C('reimburse_flag', 'char1', th='สถานะเบิกชดเชย (เงินสดย่อย)', src='STCRD.REIMBURSE'),
], uniq=[('header_id','line_no')], idx=[('item_id','warehouse_id'),('source_line_id',)],
 note='ฟิลด์ต้นทุนรายล็อตใน STCRD (MLOTNUM MREMBAL LOTBAL …) ย้ายไป inv_cost_layer / inv_stock_ledger'))

add(T('doc_note', 'หมายเหตุเพิ่มเติมของเอกสาร/บรรทัด (สูงสุด 10 บรรทัด)', 'doc', express='ARTRNRM', cols=[
  lk('header_id', 'doc_header', 'เอกสาร', 'ARTRNRM.DOCNUM', nn=True),
  lk('line_id', 'doc_line', 'บรรทัด (ว่าง = ระดับเอกสาร)', 'ARTRNRM.SEQNUM'),
  C('seq', 'smallint', nn=True, th='ลำดับหมายเหตุ'),
  C('text', 'str200', nn=True, th='ข้อความ', src='ARTRNRM.REMARK'),
], uniq=[('header_id','line_id','seq')], note="SEQNUM '@1' = หมายเหตุระดับเอกสาร ' 1' = หมายเหตุของบรรทัดที่ 1"))

add(T('md_note', 'หมายเหตุเพิ่มเติมของแฟ้มหลัก (สินค้า ลูกค้า ผู้จำหน่าย) สูงสุด 10 บรรทัด', 'md', express='ARTRNRM (DOCNUM = รหัสสินค้า/ผู้จำหน่าย)', cols=[
  C('entity_type', 'code10', nn=True, th='ITEM CUSTOMER SUPPLIER', chk="entity_type IN ('ITEM','CUSTOMER','SUPPLIER')"),
  C('entity_id', 'uuid', nn=True, th='id ของสินค้า/ลูกค้า/ผู้จำหน่าย'),
  C('seq', 'smallint', nn=True, th='ลำดับ'),
  C('text', 'str200', nn=True, th='ข้อความ', src='ARTRNRM.REMARK'),
], uniq=[('entity_type','entity_id','seq')], note='พบจากข้อมูลจริง: ARTRNRM ไม่ได้เก็บแค่หมายเหตุเอกสาร แต่เก็บหมายเหตุของสินค้า/ผู้จำหน่ายด้วย โดยใช้รหัสแทนเลขที่เอกสาร'))

add(T('doc_link', 'ความสัมพันธ์ระหว่างเอกสาร (อ้างถึง/แปลง/หักมัดจำ/ลดหนี้)', 'doc', express='ARTRN.SONUM/ADVNUM, APTRN.PONUM/ADVNUM', cols=[
  lk('from_header_id', 'doc_header', 'เอกสารต้นทาง (เช่น SO, PO, AI, AE, IV เดิม)', nn=True),
  lk('to_header_id', 'doc_header', 'เอกสารปลายทาง (IV, RR, SR …)', nn=True),
  C('link_type', 'code10', nn=True, th='FULFIL (SO→IV, PO→RR) CONVERT (QT→SO) DEPOSIT (AI→IV, AE→RR) ADJUST (IV→DR/SR, RR→CP/GR)'),
  C('amount', 'money', th='จำนวนเงินที่หัก/อ้างถึง (เช่น ยอดหักมัดจำ)'),
], uniq=[('from_header_id','to_header_id','link_type')]))

add(T('doc_bill_item', 'รายการใบกำกับในใบวางบิล / ใบรับวางบิล', 'doc', express='ARTRN.BILNUM / APTRN.BILNUM (+ARBILIT/APBILIT)', cols=[
  lk('bill_header_id', 'doc_header', 'ใบวางบิล BI / ใบรับวางบิล BR', nn=True),
  lk('invoice_header_id', 'doc_header', 'ใบกำกับ/ใบเพิ่มหนี้/ลดหนี้ ที่วางบิล', nn=True),
  C('amount', 'money', nn=True, th='ยอดที่วางบิล'),
  C('vat_amount', 'money', th='ภาษี', src='ARBILIT.VATAMT'),
], uniq=[('bill_header_id','invoice_header_id')]))

add(T('doc_settlement', 'การตัดชำระหนี้ (ใบเสร็จ RE / ใบสำคัญจ่าย PS ตัดใบกำกับใด เท่าใด)', 'doc', express='ARRCPIT / APRCPIT', cols=[
  lk('payment_header_id', 'doc_header', 'ใบรับชำระ/จ่ายชำระ', 'RCPNUM'),
  lk('payment_journal_id', 'gl_journal', 'หรือ ใบสำคัญ JV ที่ใช้ตัดหนี้ (พบในข้อมูลจริง)', 'RCPNUM = GLJNL.VOUCHER'),
  lk('invoice_header_id', 'doc_header', 'เอกสารที่ถูกตัด (IV DR SR AI / RR CP GR AE)', 'DOCNUM', nn=True),
  C('express_rectype', 'char1', th='RECTYP ของเอกสารที่ถูกตัด', src='RECTYP'),
  C('amount', 'money', nn=True, th='ยอดที่ตัดชำระ', src='RCVAMT / PAYAMT'),
  C('vat_amount', 'money', nn=True, d='0', th='ภาษีที่ถึงกำหนด (เกณฑ์เงินสด)', src='VATAMT'),
], uniq=[('payment_header_id','payment_journal_id','invoice_header_id')], idx=[('invoice_header_id',)],
 note='ต้องมี payment_header_id หรือ payment_journal_id อย่างใดอย่างหนึ่ง (CHECK)'))

add(T('doc_payment', 'วิธีรับ/จ่ายเงินของเอกสาร (เงินสด เช็ค โอน หัก ณ ที่จ่าย …)', 'doc', express='ARRCPCQ / APRCPCQ', cols=[
  lk('header_id', 'doc_header', 'เอกสาร (RE PS AI AE HS HP OI OE DP)', 'RCPNUM', nn=True),
  C('line_no', 'smallint', nn=True, th='ลำดับ'),
  lk('payment_method_id', 'md_payment_method', 'วิธีชำระ (2 ตัวแรกของ CHQNUM)', 'CHQNUM[1:2]', nn=True),
  C('reference_no', 'code30', th='เลขที่อ้างอิง (เลขเช็ค/เลขโอน)', src='CHQNUM[3:]'),
  C('amount', 'money', nn=True, th='จำนวนเงิน (บวก=รับ/จ่ายจริง ลบ=ส่วนหัก)', src='RCVAMT / PAYAMT'),
  lk('cheque_id', 'fin_cheque', 'รายการในทะเบียนเช็ค/โอน', 'BKTRN.CHQNUM'),
], uniq=[('header_id','line_no')]))

# =====================================================================
# FINANCE
# =====================================================================
add(T('fin_cheque', 'ทะเบียนเช็ครับ/เช็คจ่าย และรายการโอนผ่านธนาคาร', 'fin', express='BKTRN', cols=[
  lk('branch_id', 'sys_branch', 'สาขา'),
  C('direction', 'char1', nn=True, th='R=รับ P=จ่าย', src='BKTRN.BKTRNTYP', chk="direction IN ('R','P')"),
  C('instrument', 'code10', nn=True, th='CHEQUE TRANSFER CARD', src='BKTRN.BKTRNTYP (QR/QP=เช็ค bR/bP=โอน)'),
  C('cheque_no', 'code30', nn=True, th='เลขที่เช็ค/อ้างอิง', src='BKTRN.CHQNUM'),
  C('cheque_date', 'date', nn=True, th='วันที่หน้าเช็ค', src='BKTRN.CHQDAT'),
  lk('bank_id', 'md_bank', 'ธนาคารของเช็ค (เช็ครับ)', 'BKTRN.BNKCOD'),
  C('bank_branch', 'str60', th='สาขาธนาคาร', src='BKTRN.BRANCH'),
  lk('bank_account_id', 'md_bank_account', 'บัญชีเงินฝากของกิจการ (นำฝาก/สั่งจ่าย)', 'BKTRN.BNKACC'),
  lk('customer_id', 'md_customer', 'ลูกค้าผู้สั่งจ่าย', 'BKTRN.CUSCOD'),
  lk('supplier_id', 'md_supplier', 'ผู้รับเงิน', 'BKTRN.CUSCOD'),
  C('payee_name', 'str120', th='ชื่อบนเช็ค', src='BKTRN.NAME'),
  lk('department_id', 'md_department', 'แผนก', 'BKTRN.DEPCOD'),
  C('received_date', 'date', th='วันที่รับเช็ค', src='BKTRN.GETDAT'),
  C('deposit_date', 'date', th='วันที่นำฝาก', src='BKTRN.PAYINDAT'),
  C('pass_date', 'date', th='วันที่เช็คผ่าน', src='BKTRN.TRNDAT'),
  C('amount', 'money', nn=True, th='จำนวนเงินหน้าเช็ค', src='BKTRN.AMOUNT'),
  C('charge', 'money', nn=True, d='0', th='ค่าธรรมเนียม', src='BKTRN.CHARGE'),
  C('net_amount', 'money', nn=True, th='ยอดสุทธิเข้าบัญชี', src='BKTRN.NETAMT'),
  C('remaining_amount', 'money', nn=True, d='0', th='ยอดเช็คที่ยังไม่ได้ใช้ตัดหนี้', src='BKTRN.REMAMT'),
  C('status', 'code4', nn=True, th='สถานะเช็ค (ISTAB 02): 00 ในมือ 01 รอเรียกเก็บ 02 คืนยื่นใหม่ 05 คืน 10 ผ่าน 19 ผ่าน(โอน) …', src='BKTRN.CHQSTAT'),
  C('is_settled', 'bool', nn=True, d='false', th='ใช้ตัดหนี้ครบแล้ว', src='BKTRN.CMPLAPP'),
  lk('source_header_id', 'doc_header', 'เอกสารที่รับ/จ่ายเช็คนี้', 'BKTRN.VOUCHER'),
  lk('deposit_header_id', 'doc_header', 'ใบนำฝากเช็ค BQ/SQ', 'BKTRNIT.DEPNUM'),
  lk('pass_journal_id', 'gl_journal', 'ใบสำคัญผ่านเช็ค'),
  C('remark', 'str200', th='หมายเหตุ', src='BKTRN.REMARK'),
], uniq=[('company_id','direction','cheque_no','bank_account_id')], idx=[('company_id','status','cheque_date')]))

add(T('fin_cheque_event', 'ประวัติสถานะเช็ค (นำฝาก ผ่าน คืน ยื่นใหม่ ขายลด)', 'fin', express='(Express เก็บเฉพาะสถานะล่าสุด)', cols=[
  lk('cheque_id', 'fin_cheque', 'เช็ค', nn=True),
  C('event_date', 'date', nn=True, th='วันที่'),
  C('from_status', 'code4', th='สถานะเดิม'),
  C('to_status', 'code4', nn=True, th='สถานะใหม่'),
  C('reason', 'str200', th='เหตุผล (เช่น เช็คคืนเพราะเงินไม่พอ)'),
  lk('header_id', 'doc_header', 'เอกสารที่ทำให้เปลี่ยนสถานะ'),
]))

add(T('fin_bank_ledger', 'สมุดบัญชีเงินฝาก (ทุกการเคลื่อนไหว ใช้กระทบยอดธนาคาร)', 'fin', sync='server', express='(คำนวณจาก BKTRN/เอกสาร)', cols=[
  lk('bank_account_id', 'md_bank_account', 'บัญชีเงินฝาก', nn=True),
  C('txn_date', 'date', nn=True, th='วันที่'),
  C('amount', 'money', nn=True, th='จำนวนเงิน (+ฝาก −ถอน)'),
  lk('header_id', 'doc_header', 'เอกสารต้นทาง'),
  lk('cheque_id', 'fin_cheque', 'เช็ค/โอน'),
  C('description', 'str200', th='คำอธิบาย'),
  C('statement_ref', 'code30', th='อ้างอิง Bank statement (กระทบยอด)'),
  C('reconciled_at', 'date', th='วันที่กระทบยอดแล้ว'),
], idx=[('bank_account_id','txn_date')]))

# =====================================================================
# INVENTORY (server-computed ledgers; cached on client)
# =====================================================================
add(T('inv_stock_ledger', 'บัญชีคุมสินค้า (สต๊อกการ์ด) — หนึ่งแถวต่อการเคลื่อนไหวที่ post แล้ว', 'inv', sync='server', express='STCRD (ส่วนที่ POSOPR ≠ ว่าง)', cols=[
  lk('item_id', 'md_item', 'สินค้า', 'STCRD.STKCOD', nn=True),
  lk('warehouse_id', 'md_warehouse', 'คลัง', 'STCRD.LOCCOD', nn=True),
  C('txn_date', 'date', nn=True, th='วันที่', src='STCRD.DOCDAT'),
  lk('line_id', 'doc_line', 'บรรทัดเอกสาร', 'STCRD', nn=True),
  C('movement_code', 'char1', nn=True, th='รหัสการเคลื่อนไหว (POSOPR)', src='STCRD.POSOPR'),
  C('qty', 'qty', nn=True, th='จำนวนหน่วยหลัก (+เข้า −ออก)', src='XTRNQTY'),
  C('unit_cost', 'qty', nn=True, th='ต้นทุนต่อหน่วย', src='XUNITPR'),
  C('value', 'money', nn=True, th='มูลค่า (+/−)', src='XTRNVAL'),
  C('balance_qty', 'qty', th='ยอดคงเหลือหลังรายการ (running)'),
  C('balance_value', 'money', th='มูลค่าคงเหลือหลังรายการ'),
], idx=[('item_id','warehouse_id','txn_date')]))

add(T('inv_cost_layer', 'ล็อตต้นทุน FIFO (รับเข้าแต่ละครั้ง และยอดคงเหลือของล็อต)', 'inv', sync='server', express='STCRD.MLOTNUM/MREMBAL/MREMVAL', cols=[
  lk('item_id', 'md_item', 'สินค้า', nn=True),
  lk('warehouse_id', 'md_warehouse', 'คลัง (ถ้าคิดต้นทุนแยกคลัง)'),
  lk('receipt_line_id', 'doc_line', 'บรรทัดที่รับเข้า (เกิดล็อต)', nn=True),
  C('lot_date', 'date', nn=True, th='วันที่ล็อต'),
  C('qty_in', 'qty', nn=True, th='จำนวนรับ'),
  C('value_in', 'money', nn=True, th='มูลค่ารับ'),
  C('qty_remaining', 'qty', nn=True, th='จำนวนคงเหลือในล็อต', src='MREMBAL'),
  C('value_remaining', 'money', nn=True, th='มูลค่าคงเหลือในล็อต', src='MREMVAL'),
], idx=[('item_id','warehouse_id','lot_date')]))

add(T('inv_cost_consumption', 'การตัดล็อต FIFO ของบรรทัดจ่ายออก', 'inv', sync='server', express='STCRD.MLOTNUM ของบรรทัดจ่ายออก', cols=[
  lk('issue_line_id', 'doc_line', 'บรรทัดจ่ายออก', nn=True),
  lk('layer_id', 'inv_cost_layer', 'ล็อตที่ถูกตัด', nn=True),
  C('qty', 'qty', nn=True, th='จำนวนที่ตัด'),
  C('value', 'money', nn=True, th='มูลค่าที่ตัด'),
]))

add(T('inv_stock_balance', 'ยอดคงเหลือปัจจุบันต่อสินค้า×คลัง (สรุปจาก ledger; client ใช้แบบอ่านอย่างเดียว)', 'inv', express='STLOC (+STMAS.TOTBAL)', cols=[
  lk('item_id', 'md_item', 'สินค้า', 'STLOC.STKCOD', nn=True),
  lk('warehouse_id', 'md_warehouse', 'คลัง', 'STLOC.LOCCOD', nn=True),
  C('qty_on_hand', 'qty', nn=True, d='0', th='ยอดคงเหลือ', src='STLOC.LOCBAL'),
  C('value_on_hand', 'money', nn=True, d='0', th='มูลค่าคงเหลือ', src='STLOC.LOCVAL'),
  C('avg_cost', 'qty', th='ต้นทุนเฉลี่ย/หน่วย', src='STLOC.UNITPR'),
  C('qty_on_order', 'qty', nn=True, d='0', th='ค้างรับจาก PO', src='STLOC.LOCREO'),
  C('qty_reserved', 'qty', nn=True, d='0', th='ค้างส่งตาม SO', src='STLOC.LOCRES'),
  C('qty_offline_pending', 'qty', nn=True, d='0', th='(client) ยอดที่ตัด/รับในเครื่องแต่ยังไม่ซิงก์'),
  C('last_purchase_date', 'date', th='ซื้อล่าสุด', src='STLOC.LPURDAT'),
  C('last_sale_date', 'date', th='ขายล่าสุด', src='STLOC.LSELDAT'),
  C('last_move_date', 'date', th='เคลื่อนไหวล่าสุด', src='STLOC.LMOVDAT'),
  C('last_count_date', 'date', th='ตรวจนับล่าสุด', src='STLOC.TAKDAT'),
  C('shelf', 'code10', th='ชั้นเก็บ', src='STLOC.AREA'),
], uniq=[('company_id','item_id','warehouse_id')],
 note='ยอดรายงวด QTY1–QTY12NY/VAL1–VAL12NY ใน STLOC ไม่เก็บ ใช้ view จาก inv_stock_ledger'))

add(T('inv_stock_count', 'ผลการตรวจนับสินค้า', 'inv', express='STTAK', cols=[
  lk('warehouse_id', 'md_warehouse', 'คลัง', 'STTAK.LOCCOD', nn=True),
  lk('item_id', 'md_item', 'สินค้า', 'STTAK.STKCOD', nn=True),
  C('count_date', 'date', nn=True, th='วันที่ตรวจนับ', src='STTAK.TAKDAT'),
  C('shelf', 'code10', th='พื้นที่/ชั้นเก็บ', src='STTAK.AREA'),
  C('counted_qty', 'qty', th='จำนวนที่นับได้ (หน่วยหลัก)', src='STTAK.PHYBAL'),
  C('counted_unit_qty', 'qty', th='จำนวนนับในหน่วยตรวจนับ', src='STTAK.XQUQTY'),
  C('system_qty', 'qty', th='ยอดตามระบบ ณ วันนับ'),
  C('diff_qty', 'qty', th='ผลต่าง', src='STTAK.DIFQTY'),
  C('flag', 'char1', nn=True, d="'1'", th='1=เตรียมนับ 3=บันทึกผลนับ 6=ปรับปรุงแล้ว', src='STTAK.TAKFLG'),
  lk('adjust_line_id', 'doc_line', 'บรรทัดใบปรับปรุง TK ที่สร้าง', 'STTAK.DOCNUM+SEQNUM'),
], uniq=[('company_id','warehouse_id','item_id','count_date')]))

add(T('md_serial', 'ทะเบียนหมายเลขเครื่อง/Serial และการรับประกัน', 'md', express='ISSN', cols=[
  C('serial_no', 'code40', nn=True, th='หมายเลขเครื่อง', src='ISSN.SERIAL'),
  C('machine_no', 'code40', th='Machine No.', src='ISSN.M_NO'),
  C('category_code', 'code10', th='หมวดสินค้า', src='ISSN.STKGRP'),
  lk('item_id', 'md_item', 'สินค้า'),
  lk('sale_line_id', 'doc_line', 'บรรทัดขาย', 'ISSN.IVCNUM'),
  C('sale_date', 'date', th='วันที่ขาย', src='ISSN.SAL_DATE'),
  C('warranty_end', 'date', th='สิ้นสุดประกัน', src='ISSN.EXP_DATE'),
  lk('customer_id', 'md_customer', 'ลูกค้า', 'ISSN.CUSCOD'),
  C('description', 'str200', th='รายละเอียด', src='ISSN.DESCRIP'),
], uniq=[('company_id','serial_no')]))
add(T('md_serial_service', 'ประวัติการซ่อม/บริการของ Serial', 'md', express='ISSNIT', cols=[
  lk('serial_id', 'md_serial', 'Serial', nn=True),
  C('service_date', 'date', nn=True, th='วันที่', src='ISSNIT.DATE'),
  C('service_by', 'str60', th='ผู้ให้บริการ', src='ISSNIT.SERVANT'),
  C('detail', 'text', th='รายละเอียด', src='ISSNIT.SERVDESC'),
]))

# =====================================================================
# GL transactions
# =====================================================================
add(T('gl_journal', 'ใบสำคัญ / รายการสมุดรายวัน (ทั้งบันทึกเองและที่ระบบอื่นส่งมา)', 'gl', express='GLJNL', cols=[
  lk('branch_id', 'sys_branch', 'สาขา'),
  lk('journal_book_id', 'gl_journal_book', 'สมุดรายวัน', 'GLJNL.JNLTYP', nn=True),
  C('voucher_no', 'code30', nn=True, th='เลขที่ใบสำคัญ (เอกสารจากระบบอื่นใช้เลขเดียวกับเอกสาร)', src='GLJNL.VOUCHER'),
  C('voucher_date', 'date', nn=True, th='วันที่', src='GLJNL.VOUDAT'),
  lk('period_id', 'gl_period', 'งวดบัญชี', nn=True),
  C('description', 'str200', th='คำอธิบาย', src='GLJNL.DESCRP'),
  C('reference', 'code30', th='อ้างอิง', src='GLJNL.REFNUM'),
  C('source_module', 'code4', th='ระบบต้นทาง (ว่าง = บันทึกเองใน GL)', src='GLJNL.SRCJNL'),
  lk('source_header_id', 'doc_header', 'เอกสารต้นทาง'),
  C('status', 'char1', nn=True, d="'U'", th='U=ยังไม่ผ่านรายการ P=ผ่านรายการแล้ว (Post)', src='GLJNL.TRNSTAT', chk="status IN ('U','P')"),
  C('doc_status', 'char1', nn=True, d="'N'", th='N=ปกติ C=ยกเลิก', src='GLJNL.DOCSTAT', chk="doc_status IN ('N','C')"),
  lk('reversal_of_id', 'gl_journal', 'กลับรายการของใบสำคัญใด', 'GLJNL.REVERSE'),
  lk('posted_by', 'sys_user', 'ผู้ผ่านรายการ', 'GLJNL.POSTID'),
  C('posted_at', 'ts', th='วันที่ผ่านรายการ', src='GLJNL.POSDAT'),
  C('total_debit', 'money', nn=True, d='0', th='รวมเดบิต'),
  C('total_credit', 'money', nn=True, d='0', th='รวมเครดิต'),
  C('print_count', 'smallint', nn=True, d='0', th='จำนวนครั้งที่พิมพ์', src='GLJNL.PRNCNT'),
  lk('approved_by', 'sys_user', 'ผู้อนุมัติ', 'GLJNL.APPROVE'),
], uniq=[('company_id','journal_book_id','voucher_no')], idx=[('company_id','voucher_date'),('source_header_id',)]))

add(T('gl_journal_line', 'รายการเดบิต/เครดิตของใบสำคัญ', 'gl', express='GLJNLIT', cols=[
  lk('journal_id', 'gl_journal', 'ใบสำคัญ', 'GLJNLIT.VOUCHER', nn=True),
  C('line_no', 'smallint', nn=True, th='ลำดับ', src='GLJNLIT.SEQIT'),
  lk('account_id', 'gl_account', 'บัญชี', 'GLJNLIT.ACCNUM', nn=True),
  lk('department_id', 'md_department', 'แผนก', 'GLJNLIT.DEPCOD'),
  lk('project_id', 'md_project', 'โครงการ', 'GLJNLIT.JOBCOD'),
  C('project_phase', 'code10', th='ขั้นตอนโครงการ', src='GLJNLIT.PHASE'),
  C('cost_code', 'code10', th='รหัสต้นทุน', src='GLJNLIT.COSCOD'),
  C('description', 'str200', th='คำอธิบายรายการ', src='GLJNLIT.DESCRP'),
  C('debit', 'money', nn=True, d='0', th='เดบิต', src="GLJNLIT.AMOUNT เมื่อ TRNTYP='0'"),
  C('credit', 'money', nn=True, d='0', th='เครดิต', src="GLJNLIT.AMOUNT เมื่อ TRNTYP='1'"),
  C('posting_role', 'code30', th='บทบาทที่กฎใช้หาบัญชี (ตรวจย้อนได้ว่าทำไมลงบัญชีนี้)'),
  C('resolved_from', 'char1', th='หาบัญชีได้จากชั้นใด 1=ประเภทเอกสาร 2=แฟ้มหลัก 3=บัญชีมาตรฐาน S=บัญชีพัก M=ป้อนเอง'),
  lk('changed_from_account_id', 'gl_account', 'บัญชีเดิมก่อนแก้', 'GLJNLIT.CHGACCFROM'),
], uniq=[('journal_id','line_no')], idx=[('account_id',)],
 note='CHECK: แต่ละบรรทัดมีได้แค่เดบิตหรือเครดิต; ผลรวมต่อใบสำคัญต้องเท่ากัน (ตรวจด้วย trigger ตอน post)'))

add(T('gl_balance', 'ยอดสะสมรายงวดต่อบัญชี×แผนก (สรุปจาก gl_journal_line)', 'gl', sync='server', express='GLBAL (DEBITn/CREDITn ×36 ช่อง)', cols=[
  lk('account_id', 'gl_account', 'บัญชี', 'GLBAL.ACCNUM', nn=True),
  lk('department_id', 'md_department', 'แผนก', 'GLBAL.DEPCOD'),
  lk('period_id', 'gl_period', 'งวด', nn=True),
  C('opening', 'money', nn=True, d='0', th='ยอดยกมาต้นงวด (เฉพาะงวดแรกของปี)', src='GLBAL.BEGLY'),
  C('debit', 'money', nn=True, d='0', th='รวมเดบิตในงวด', src='GLBAL.DEBITn'),
  C('credit', 'money', nn=True, d='0', th='รวมเครดิตในงวด', src='GLBAL.CREDITn'),
], uniq=[('company_id','account_id','department_id','period_id')]))

add(T('gl_budget', 'งบประมาณรายงวด', 'gl', express='GLBUD', cols=[
  lk('account_id', 'gl_account', 'บัญชี', 'GLBUD.ACCNUM', nn=True),
  lk('department_id', 'md_department', 'แผนก', 'GLBUD.DEPCOD'),
  lk('period_id', 'gl_period', 'งวด', nn=True),
  C('amount', 'money', nn=True, th='งบประมาณ', src='GLBUD.AMTn'),
], uniq=[('company_id','account_id','department_id','period_id')]))

add(T('gl_fs_report', 'แบบงบการเงินที่ผู้ใช้สร้าง', 'gl', express='GLREP', cols=[
  C('code', 'code10', nn=True, th='รหัสงบ', src='GLREP.REPCOD'),
  C('name', 'str120', nn=True, th='ชื่องบ', src='GLREP.REPNAM'),
  C('header_lines', 'json', th='หัวรายงาน 4 บรรทัด', src='GLREP.HEAD_1–4'),
  C('columns', 'json', th='นิยามคอลัมน์ ≤18 (หัว สูตร BAL/PTD/BAL LY แผนก %)', src='GLREP.Cn_HD1/2, FLDn, DEPn, PCENTn, PRINTn'),
  C('line_set_code', 'code10', th='ชุดบรรทัด', src='GLREP.LINCOD'),
  C('number_format', 'str20', th='รูปแบบตัวเลข', src='GLREP.PICT_1'),
], uniq=[('company_id','code')]))
add(T('gl_fs_line', 'บรรทัดของงบการเงิน', 'gl', express='GLREPIT', cols=[
  C('line_set_code', 'code10', nn=True, th='ชุดบรรทัด', src='GLREPIT.REPCOD'),
  C('line_no', 'int', nn=True, th='เลขบรรทัด', src='GLREPIT.LINNUM'),
  C('data_type', 'code4', nn=True, th='A/C=บัญชี VAR=ตัวแปร ---=เส้น TXT=ข้อความ', src='GLREPIT.DATTYP'),
  C('source', 'str60', th='ช่วงบัญชี/ตัวแปร', src='GLREPIT.SRCDAT'),
  C('sign_filter', 'char1', th='+ เฉพาะยอดบวก − เฉพาะยอดลบ', src='GLREPIT.FILTER'),
  C('description_th', 'str120', th='คำอธิบาย', src='GLREPIT.DESCRP'),
  C('description_en', 'str120', th='คำอธิบายอังกฤษ', src='GLREPIT.DESCRP2'),
  C('print_condition', 'char1', th='Z=ไม่พิมพ์ถ้าศูนย์ N=ไม่พิมพ์', src='GLREPIT.PRNCON'),
  C('accumulate', 'json', th='สะสมเข้าตัวแปร A–E (+/−/0)', src='GLREPIT.VAR_A–VAR_E'),
  lk('department_id', 'md_department', 'แผนก', 'GLREPIT.DEPCOD'),
], uniq=[('company_id','line_set_code','line_no')]))

# =====================================================================
# TAX
# =====================================================================
add(T('tax_vat_entry', 'ทะเบียนภาษีซื้อ/ภาษีขาย (รายงานภาษี ภ.พ.30)', 'tax', express='ISVAT', cols=[
  C('vat_kind', 'char1', nn=True, th='P=ภาษีซื้อ S=ภาษีขาย', src='ISVAT.VATREC', chk="vat_kind IN ('P','S')"),
  lk('header_id', 'doc_header', 'เอกสารต้นทาง', 'ISVAT.DOCNUM'),
  lk('journal_id', 'gl_journal', 'ใบสำคัญต้นทาง (บันทึกผ่าน JV/เงินสดย่อย)'),
  lk('branch_id', 'sys_branch', 'สาขาที่ยื่น'),
  C('doc_no', 'code30', nn=True, th='เลขที่เอกสารภายใน', src='ISVAT.DOCNUM'),
  C('doc_date', 'date', nn=True, th='วันที่เอกสารภายใน', src='ISVAT.DOCDAT'),
  C('tax_invoice_no', 'code30', th='เลขที่ใบกำกับภาษี', src='ISVAT.REFNUM'),
  C('tax_invoice_date', 'date', nn=True, th='วันที่ใบกำกับภาษี', src='ISVAT.VATDAT'),
  lk('vat_period_id', 'gl_period', 'งวดภาษีที่ยื่น', 'ISVAT.VATPRD', nn=True),
  C('is_late', 'bool', nn=True, d='false', th='ยื่นเพิ่มเติม/ใบกำกับมาช้า', src='ISVAT.LATE'),
  lk('department_id', 'md_department', 'แผนก', 'ISVAT.DEPCOD'),
  C('description', 'str200', th='คำอธิบาย', src='ISVAT.DESCRP'),
  C('party_name', 'str200', th='ชื่อผู้ขาย/ผู้ซื้อ'),
  C('party_tax_id', 'code13', th='เลขผู้เสียภาษี'),
  C('party_tax_branch_no', 'code5', th='สาขา'),
  C('base_amount', 'money', nn=True, d='0', th='มูลค่าสินค้า/บริการ', src='ISVAT.AMT01'),
  C('vat_amount', 'money', nn=True, d='0', th='ภาษี', src='ISVAT.VAT01'),
  C('zero_rate_amount', 'money', nn=True, d='0', th='มูลค่าอัตรา 0% / ยกเว้น', src='ISVAT.AMTRAT0'),
  C('nonclaim_base', 'money', nn=True, d='0', th='มูลค่าภาษีซื้อที่ขอคืนไม่ได้', src='ISVAT.AMT02'),
  C('nonclaim_vat', 'money', nn=True, d='0', th='ภาษีซื้อที่ขอคืนไม่ได้', src='ISVAT.VAT02'),
  C('is_manual', 'bool', nn=True, d='false', th='บันทึกเองในระบบภาษี', src='ISVAT.SELF_ADDED'),
  C('is_modified', 'bool', nn=True, d='false', th='ถูกแก้ไขในระบบภาษี', src='ISVAT.HAD_MODIFY'),
  C('doc_status', 'char1', nn=True, d="'N'", th='N=ปกติ C=ยกเลิก', src='ISVAT.DOCSTAT', chk="doc_status IN ('N','C')"),
  C('remark', 'str200', th='หมายเหตุ', src='ISVAT.REMARK'),
], idx=[('company_id','vat_kind','vat_period_id','tax_invoice_date')]))

add(T('tax_wht_entry', 'ทะเบียนภาษีหัก ณ ที่จ่าย / หนังสือรับรอง 50 ทวิ', 'tax', express='ISTAX', cols=[
  C('form_type', 'code4', nn=True, th='S03=ภ.ง.ด.3 S53=ภ.ง.ด.53 Z03/Z53=ถูกหัก', src='ISTAX.TAXTYP'),
  lk('header_id', 'doc_header', 'เอกสารต้นทาง (PS OE AE …)', 'ISTAX.REFNUM'),
  lk('branch_id', 'sys_branch', 'สาขาที่ยื่น'),
  C('certificate_no', 'code30', th='เลขที่หนังสือรับรอง', src='ISTAX.TAXNUM'),
  C('certificate_date', 'date', nn=True, th='วันที่หัก/ออกหนังสือ', src='ISTAX.TAXDAT'),
  lk('tax_period_id', 'gl_period', 'เดือนภาษีที่ยื่น', 'ISTAX.TAXPRD', nn=True),
  C('is_late', 'bool', nn=True, d='false', th='ยื่นเพิ่มเติม', src='ISTAX.LATE'),
  lk('supplier_id', 'md_supplier', 'ผู้ถูกหัก', 'ISTAX.PEOPLE'),
  lk('customer_id', 'md_customer', 'ผู้หัก (กรณีถูกหัก)', 'ISTAX.PEOPLE'),
  C('payee_name', 'str200', nn=True, th='ชื่อ (snapshot)', src='ISTAX.NAME'),
  C('payee_address', 'text', th='ที่อยู่ (snapshot)', src='ISTAX.ADDR'),
  C('payee_tax_id', 'code13', th='เลขผู้เสียภาษี', src='ISTAX.TAXID'),
  C('payee_tax_branch_no', 'code5', th='สาขา'),
  C('income_type', 'str60', th='ประเภทเงินได้', src='ISTAX.TAXDES'),
  C('paid_amount', 'money', nn=True, th='จำนวนเงินที่จ่าย', src='ISTAX.AMOUNT'),
  C('rate', 'rate', nn=True, th='อัตรา %', src='ISTAX.TAXRAT'),
  C('tax_amount', 'money', nn=True, th='ภาษีที่หัก', src='ISTAX.TAXAMT'),
  C('condition', 'char1', th='1=หัก ณ ที่จ่าย 2=ออกให้ตลอดไป 3=ออกให้ครั้งเดียว', src='ISTAX.TAXCOND'),
  C('social_security_amount', 'money', th='เงินสมทบประกันสังคม', src='ISTAX.SOCIALAMT'),
  C('provident_fund_amount', 'money', th='เงินสะสมกองทุนสำรองเลี้ยงชีพ', src='ISTAX.POVDNT'),
  lk('department_id', 'md_department', 'แผนก', 'ISTAX.DEPCOD'),
  C('print_count', 'smallint', nn=True, d='0', th='จำนวนครั้งที่พิมพ์', src='ISTAX.PRNCNT'),
  C('doc_status', 'char1', nn=True, d="'N'", th='N=ปกติ C=ยกเลิก', chk="doc_status IN ('N','C')"),
], idx=[('company_id','form_type','tax_period_id')]))

# =====================================================================
# FIXED ASSETS
# =====================================================================
add(T('md_asset_account_group', 'กลุ่มบัญชีทรัพย์สิน', 'fa', express="ISACC (ACCTYP='F')", cols=[
  C('code', 'code10', nn=True, th='รหัสกลุ่ม', src='ISACC.ACCCOD'),
  C('name_th', 'str120', nn=True, th='ชื่อกลุ่ม', src='ISACC.ACCDES'),
  C('name_en', 'str120', th='ชื่อภาษาอังกฤษ', src='ISACC.ACCDES2'),
  lk('asset_account_id', 'gl_account', 'บัญชีทรัพย์สิน', 'ISACC.ACCNUM01'),
  lk('depr_expense_account_id', 'gl_account', 'บัญชีค่าเสื่อมราคา', 'ISACC.ACCNUM02'),
  lk('accum_depr_account_id', 'gl_account', 'บัญชีค่าเสื่อมราคาสะสม', 'ISACC.ACCNUM03'),
], uniq=[('company_id','code')]))

add(T('fa_asset', 'ทะเบียนทรัพย์สินถาวร', 'fa', express='FAMAS', cols=[
  C('code', 'code30', nn=True, th='รหัสทรัพย์สิน', src='FAMAS.FASCOD'),
  C('name_th', 'str120', nn=True, th='ชื่อทรัพย์สิน', src='FAMAS.FASDES'),
  C('name_en', 'str120', th='ชื่อภาษาอังกฤษ', src='FAMAS.FASDES2'),
  C('category_code', 'code10', th='หมวดทรัพย์สิน lookup 52', src='FAMAS.FASGRP'),
  lk('account_group_id', 'md_asset_account_group', 'กลุ่มบัญชีทรัพย์สิน', 'FAMAS.ACCCOD', nn=True),
  C('is_depreciable', 'bool', nn=True, d='true', th='คิดค่าเสื่อม', src='FAMAS.FASTYP'),
  C('serial_no', 'code40', th='หมายเลขเครื่อง/ทะเบียน', src='FAMAS.SERIAL'),
  lk('department_id', 'md_department', 'แผนก', 'FAMAS.DEPCOD'),
  lk('branch_id', 'sys_branch', 'สาขาที่ตั้งทรัพย์สิน'),
  C('purchase_date', 'date', nn=True, th='วันที่ซื้อ', src='FAMAS.PURDAT'),
  C('cost', 'money', nn=True, th='ราคาทุน', src='FAMAS.COSVAL'),
  C('salvage_value', 'money', nn=True, d='1', th='ราคาซาก', src='FAMAS.SALVAG'),
  C('method', 'char1', nn=True, d="'1'", th='0=ไม่คิด 1=เส้นตรง 2=ยอดลดลง', src='FAMAS.METHOD', chk="method IN ('0','1','2')"),
  C('start_date', 'date', nn=True, th='วันเริ่มคิดค่าเสื่อม', src='FAMAS.STRDAT'),
  C('useful_life_years', 'smallint', th='อายุการใช้งาน (ปี)', src='FAMAS.LIFE'),
  C('rate', 'rate', th='อัตราค่าเสื่อม %', src='FAMAS.RATE'),
  C('end_date', 'date', th='วันที่คิดค่าเสื่อมครบ', src='FAMAS.ENDDAT'),
  C('depr_monthly', 'bool', nn=True, d='true', th='คิดรายเดือน (N=รายปี)', src='FAMAS.DPRMONLY'),
  C('accum_depr_bf', 'money', nn=True, d='0', th='ค่าเสื่อมสะสมยกมา', src='FAMAS.ACCMBF'),
  C('sold_date', 'date', th='วันที่ขาย/ตัดจำหน่าย', src='FAMAS.SALDAT'),
  C('sold_amount', 'money', th='ราคาขาย', src='FAMAS.SALAMT'),
  lk('sold_header_id', 'doc_header', 'เอกสารขายทรัพย์สิน'),
  C('status', 'char1', nn=True, d="'A'", th='A=ใช้งาน S=ขาย/ตัดจำหน่าย I=เลิกใช้', src='FAMAS.STATUS', chk="status IN ('A','S','I')"),
], uniq=[('company_id','code')]))

add(T('fa_depreciation', 'ค่าเสื่อมราคารายงวดของทรัพย์สิน', 'fa', express='FAMAS.DEPR1–DEPR12NY', cols=[
  lk('asset_id', 'fa_asset', 'ทรัพย์สิน', nn=True),
  lk('period_id', 'gl_period', 'งวด', nn=True),
  C('amount', 'money', nn=True, th='ค่าเสื่อมราคางวดนี้', src='FAMAS.DEPRn'),
  lk('journal_id', 'gl_journal', 'ใบสำคัญที่ลงค่าเสื่อม'),
], uniq=[('asset_id','period_id')]))

# =====================================================================
# SYNC infrastructure
# =====================================================================
add(T('sync_change_log', 'บันทึกการเปลี่ยนแปลงบนเซิร์ฟเวอร์ (ใช้ให้เครื่องลูกดึงเฉพาะส่วนที่เปลี่ยน)', 'sync', sync='server', common=False, express='(ใหม่)', cols=[
  C('seq', 'bigserial', nn=True, th='ลำดับเพิ่มขึ้นเรื่อยๆ (PK) — เครื่องลูกจำค่าล่าสุดที่ดึงแล้ว'),
  C('company_id', 'uuid', nn=True, fk='sys_company', th='บริษัท'),
  C('branch_id', 'uuid', th='สาขา (ใช้กรองว่าเครื่องไหนต้องได้รับ)'),
  C('table_name', 'code40', nn=True, th='ตาราง'),
  C('row_id', 'uuid', nn=True, th='แถว'),
  C('op', 'char1', nn=True, th='U=insert/update D=delete(soft)', chk="op IN ('U','D')"),
  C('row_version', 'bigint', nn=True, th='เวอร์ชันของแถว'),
  C('changed_at', 'ts', nn=True, d='now()', th='เวลา'),
  C('origin_device_id', 'uuid', th='เครื่องที่ส่งการเปลี่ยนแปลงมา (ไม่ต้องส่งกลับเครื่องเดิม)'),
], idx=[('company_id','seq'),('table_name','row_id')]))

add(T('sync_inbox', 'รายการที่เครื่องลูกส่งขึ้นมา (กันประมวลผลซ้ำด้วย idempotency key)', 'sync', sync='server', common=False, express='(ใหม่)', cols=[
  C('idempotency_key', 'uuid', nn=True, th='= sync_outbox.id ของเครื่องลูก (PK)'),
  C('company_id', 'uuid', nn=True, fk='sys_company', th='บริษัท'),
  C('device_id', 'uuid', nn=True, fk='sys_device', th='เครื่อง'),
  C('received_at', 'ts', nn=True, d='now()', th='เวลาที่รับ'),
  C('table_name', 'code40', nn=True, th='ตาราง'),
  C('row_id', 'uuid', nn=True, th='แถว'),
  C('result', 'code10', nn=True, th='APPLIED REJECTED CONFLICT'),
  C('message', 'text', th='เหตุผลถ้าไม่สำเร็จ'),
]))

add(T('sync_conflict', 'ความขัดแย้งที่ต้องให้คนตัดสิน', 'sync', sync='both', express='(ใหม่)', cols=[
  C('table_name', 'code40', nn=True, th='ตาราง'),
  C('row_id', 'uuid', nn=True, th='แถว'),
  lk('device_id', 'sys_device', 'เครื่องที่ส่งค่าที่ขัดแย้ง'),
  C('server_version', 'bigint', th='เวอร์ชันบนเซิร์ฟเวอร์'),
  C('client_version', 'bigint', th='เวอร์ชันที่เครื่องลูกแก้มาจาก'),
  C('client_payload', 'json', nn=True, th='ค่าที่เครื่องลูกส่งมา'),
  C('reason', 'code30', nn=True, th='VERSION_MISMATCH PERIOD_LOCKED NEGATIVE_STOCK CREDIT_LIMIT DUPLICATE_NO PERMISSION'),
  C('resolution', 'code20', th='KEEP_SERVER KEEP_CLIENT MERGED'),
  lk('resolved_by', 'sys_user', 'ผู้ตัดสิน'),
  C('resolved_at', 'ts', th='เวลาที่ตัดสิน'),
]))

add(T('sync_outbox', '(เครื่องลูก) คิวรายการที่บันทึกตอนออฟไลน์ รอส่งขึ้นเซิร์ฟเวอร์ตามลำดับ', 'sync', sync='client', common=False, express='(ใหม่)', cols=[
  C('id', 'uuid', nn=True, th='idempotency key (PK)'),
  C('seq', 'bigint', nn=True, th='ลำดับในเครื่อง (ส่งตามลำดับนี้)'),
  C('table_name', 'code40', nn=True, th='ตาราง'),
  C('row_id', 'uuid', nn=True, th='แถว'),
  C('op', 'char1', nn=True, th='U/D'),
  C('base_version', 'bigint', th='เวอร์ชันที่แก้มาจาก (ตรวจ conflict)'),
  C('payload', 'json', nn=True, th='ข้อมูลทั้งแถว'),
  C('tx_id', 'uuid', nn=True, th='กลุ่มรายการที่ต้องส่งพร้อมกัน (หัว+บรรทัดของเอกสารเดียว)'),
  C('created_at', 'ts', nn=True, th='เวลาที่บันทึก'),
  C('attempts', 'int', nn=True, d='0', th='จำนวนครั้งที่พยายามส่ง'),
  C('status', 'code10', nn=True, d="'PENDING'", th='PENDING SENT APPLIED REJECTED CONFLICT'),
  C('last_error', 'text', th='ข้อผิดพลาดล่าสุด'),
]))

add(T('sync_state', '(เครื่องลูก) สถานะการซิงก์ของเครื่องนี้', 'sync', sync='client', common=False, express='(ใหม่)', cols=[
  C('key', 'code40', nn=True, th='ชื่อค่า เช่น last_pull_seq device_id company_id (PK)'),
  C('value', 'text', th='ค่า'),
]))

# ---------------------------------------------------------------------
# ordering helper: tables in dependency-friendly order for docs
ORDER = [t.name for t in TABLES]
