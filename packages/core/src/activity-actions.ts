/**
 * ชื่อภาษาไทยของรหัสเหตุการณ์ในแฟ้มบันทึกเหตุการณ์ (sys_activity_log.action) — HANDOFF 207c
 * ใช้ที่ สิ่งที่เจ้าหน้าที่ทำกับบัญชีลูกค้า (ศูนย์ผู้ให้บริการ) และ สิ่งที่ผู้ให้บริการทำกับบัญชีของท่าน (ลูกค้า)
 * กุญแจ = รหัสที่เก็บจริง (ช่อง action ยาวไม่เกิน 20 ตัว — logActivity ตัดส่วนเกิน เช่น TENANT_STANDARD_GROUPS → TENANT_STANDARD_GROU)
 * ชุดทดสอบ apps/server/test/action-labels.test.ts ตรวจว่ารหัสทุกตัวที่ server บันทึกได้มีชื่อไทยที่นี่ — เพิ่มรหัสใหม่ต้องเพิ่มชื่อ
 */
export const ACTION_CODE_MAX = 20;
/** รหัสที่เก็บจริงในฐานข้อมูล */
export const storedAction = (code: string) => code.slice(0, ACTION_CODE_MAX);

export const ACTION_LABEL: Readonly<Record<string, string>> = {
  // ลูกค้าผู้ใช้บริการ (ศูนย์ผู้ให้บริการ)
  NEW_TENANT: 'เพิ่มลูกค้า', EDIT_TENANT: 'แก้ไขลูกค้า (สถานะ แพ็กเกจ วันหมดอายุ)', PURGE_TENANT: 'ลบข้อมูลลูกค้าตามกำหนด', TENANT_MODULES: 'เปิด/ปิดโปรแกรมและเมนูของลูกค้า',
  TENANT_STANDARD_GROU: 'สร้างกลุ่มผู้ใช้ตั้งต้น', TENANT_DEMO_ON: 'ตั้งเป็นข้อมูลตัวอย่าง', TENANT_DEMO_OFF: 'เลิกเป็นข้อมูลตัวอย่าง', PV_VIEW: 'เปิดดูภาพรวมของลูกค้า',
  EXPORT_TENANT: 'ส่งออกแฟ้มย้ายลูกค้า', IMPORT_TENANT: 'นำเข้าแฟ้มย้ายลูกค้า', MOVE_REQUEST: 'ขอย้ายบริษัทข้ามลูกค้า', MOVE_REJECT: 'ปฏิเสธการย้ายบริษัท', MOVE_COMPANY: 'ย้ายบริษัทข้ามลูกค้า',
  TENANT_MFA_ON: 'บังคับยืนยันตัวตนสองขั้นทุกผู้ใช้', TENANT_MFA_OFF: 'เลิกบังคับยืนยันตัวตนสองขั้น', TENANT_CONTACT: 'แก้ไขผู้ติดต่อของกิจการ', SET_MODULES: 'ตั้งโปรแกรมที่ผู้ใช้เปิดได้',
  // ผู้ใช้และสิทธิ์
  ADD_USER: 'เพิ่มผู้ใช้', EDIT_USER: 'แก้ไขผู้ใช้', RESET_PASSWORD: 'ตั้งรหัสผ่านให้ผู้ใช้', USER_RESET_PASSWORD: 'ตั้งรหัสผ่านใหม่ (ผู้ดูแลเซิร์ฟเวอร์)', USER_UNLOCK: 'ปลดล็อกผู้ใช้',
  USER_RESET_2FA: 'ล้างการยืนยันตัวตนสองขั้น (2FA)', INVITE_EMAIL: 'ส่งลิงก์ตั้งรหัสผ่านทางอีเมลของลูกค้า', INVITE_CREATE: 'สร้างลิงก์เชิญ', INVITE_REVOKE: 'ยกเลิกลิงก์เชิญ', INVITE_ACCEPT: 'ตั้งรหัสผ่านจากลิงก์เชิญ',
  EDIT_GROUP: 'แก้ไขกลุ่มผู้ใช้', DELETE_GROUP: 'ลบกลุ่มผู้ใช้', STANDARD_GROUPS: 'สร้างกลุ่มผู้ใช้ตั้งต้น', PERMISSION: 'แก้สิทธิ์', PERMISSION_COPY: 'คัดลอกสิทธิ์',
  API_KEY_CREATE: 'สร้างกุญแจ API', API_KEY_REVOKE: 'ยกเลิกกุญแจ API', API_KEY_SCOPE: 'แก้ขอบเขตกุญแจ API',
  // เข้าระบบและความปลอดภัย
  LOGIN: 'เข้าระบบ', LOGOUT: 'ออกจากระบบ', LOGIN_FAIL: 'ป้อนรหัสผ่านผิด', LOGIN_LOCKED: 'บัญชีถูกล็อกชั่วคราว', SESSION_REPLACED: 'เข้าระบบจากเครื่องอื่น (ตัดการใช้งานเดิม)', PASSWORD: 'เปลี่ยนรหัสผ่าน',
  SETUP: 'ตั้งผู้ดูแลระบบคนแรก', SET_THEME: 'เปลี่ยนสไตล์หน้าจอ', MFA_ENABLE: 'เปิดยืนยันตัวตนสองขั้น', MFA_DISABLE: 'ปิดยืนยันตัวตนสองขั้น', MFA_RECOVERY_NEW: 'สร้างรหัสสำรอง 2FA ใหม่',
  MFA_RECOVERY_USED: 'ใช้รหัสสำรอง 2FA', REVEAL: 'เปิดดูข้อมูลที่ปิดบัง',
  // บริษัทและข้อมูลทั้งบริษัท
  NEW_COMPANY: 'เพิ่มบริษัท', COPY_COMPANY: 'สร้างบริษัทโดยคัดลอกจากบริษัทเดิม', DELETE_COMPANY: 'ลบบริษัท', RESTORE_COMPANY: 'กู้บริษัทที่ลบ', STARTER_DATA: 'ใส่ข้อมูลตั้งต้นของบริษัท',
  CHART_TEMPLATE: 'ผังบัญชีตั้งต้น', SET_LOGO: 'ตั้งโลโก้บริษัท', BRANCH_SETUP: 'ตั้งสาขา', SETTINGS: 'แก้ค่าตั้งของบริษัท', BACKUP: 'สำรองข้อมูลบริษัท', RESTORE: 'นำข้อมูลสำรองมาใช้',
  BACKUP_USERS: 'สำรองข้อมูลผู้ใช้', RESTORE_USERS: 'นำข้อมูลผู้ใช้กลับ', IMPORT_EXPRESS: 'นำข้อมูลจาก Express', FIX_YEAR: 'แก้วันที่ปีผิดระบบ', ADD_YEAR: 'เพิ่มปีบัญชี',
  PDPA_REQUEST: 'คำขอข้อมูลส่วนบุคคล (PDPA)', PDPA_ACCESS: 'ส่งสำเนาข้อมูลส่วนบุคคล (PDPA)', PDPA_ERASE: 'ลบข้อมูลส่วนบุคคล (PDPA)',
  // โปรแกรมที่เชื่อมและเครื่องสาขา
  HUB_LAUNCH: 'เปิดโปรแกรมจาก Hub', WTS_POS_SETUP: 'ตั้งการเชื่อม WTS-POS', WTS_LIVING_SETUP: 'ตั้งการเชื่อม WTS-Living', ADD_DEVICE: 'เพิ่มเครื่องสาขา', DEVICE_CODE: 'ออกรหัสติดตั้งเครื่องสาขา',
  DEVICE_BOOTSTRAP: 'ติดตั้งข้อมูลเครื่องสาขา', SUSPEND_DEVICE: 'ระงับเครื่องสาขา', SYNC_RETRY: 'ส่งข้อมูลจากเครื่องสาขาอีกครั้ง', SYNC_DISCARD: 'ทิ้งรายการที่ส่งจากเครื่องสาขาไม่ได้',
  SET_PAY_SOURCE: 'ตั้งแหล่งข้อมูลรับชำระ', SOURCE_OVERRIDE: 'ยอมรับรายการจากระบบอื่น',
  // ผู้ให้บริการ (ทั้งระบบ)
  SIGNUP: 'สมัครใช้งาน', SIGNUP_REJECT: 'ไม่อนุมัติใบสมัคร', SIGNUP_SETTINGS: 'ตั้งค่าหน้าสมัครใช้งาน', MAIL_SENT: 'ส่งอีเมลเรื่องใบสมัคร', MAIL_FAILED: 'ส่งอีเมลเรื่องใบสมัครไม่สำเร็จ',
  MAIL_SKIPPED: 'ไม่ได้ส่งอีเมลเรื่องใบสมัคร', MAIL_SETTINGS: 'ตั้งค่าอีเมลของผู้ให้บริการ', ADD_PACKAGE: 'เพิ่มแพ็กเกจ', EDIT_PACKAGE: 'แก้ไขแพ็กเกจ',
  AI_PLATFORM_KEY_SET: 'ตั้งกุญแจ AI ของผู้ให้บริการ', AI_PLATFORM_KEY_REMO: 'ลบกุญแจ AI ของผู้ให้บริการ', AI_CONFIG: 'ตั้งค่า AI อ่านบิล', AI_KEY_SET: 'ตั้งกุญแจ AI ของกิจการ',
  AI_KEY_REMOVE: 'ลบกุญแจ AI ของกิจการ', AI_READ_BILL: 'อ่านบิลด้วย AI', AI_IMPORT_MAP: 'จับคู่คอลัมน์นำเข้าด้วย AI',
  ALERT_LOCKED: '⚠ แจ้งเตือน: พยายามเปิดข้อมูลของลูกค้าจริงซ้ำ ๆ', ALERT_LOGIN_FAIL: '⚠ แจ้งเตือน: ใส่รหัสผิดซ้ำ ๆ', ALERT_BURST: '⚠ แจ้งเตือน: ทำรายการถี่ผิดปกติ',
  // เอกสารและข้อมูลหลัก
  ADD: 'เพิ่ม', EDIT: 'แก้ไข', CANCEL: 'ยกเลิก', CANCEL_LINE: 'ยกเลิกบรรทัด', DELETE: 'ลบ', PRINT: 'พิมพ์', REPRINT: 'พิมพ์ซ้ำ', APPROVE: 'รับรอง', UNAPPROVE: 'ยกเลิกรับรอง',
  POST: 'ลงบัญชี', REPOST: 'ลงบัญชีใหม่', RENUMBER: 'เรียงเลขที่ใหม่', RECODE: 'เปลี่ยนรหัส', EDIT_CODE: 'แก้รหัส', EDIT_STATUS: 'เปลี่ยนสถานะ', EDIT_NOTES: 'แก้หมายเหตุ',
  EDIT_PRICE: 'แก้ราคา', EDIT_REORDER: 'แก้จุดสั่งซื้อ', HOLD_OVERRIDE: 'ยกเว้นการระงับขาย', OPENING: 'ยอดยกมา', PRIOR_YEAR: 'ยอดปีก่อน', BUDGET: 'งบประมาณ', YTD: 'ยอดสะสมต้นปี',
  YTD_DEL: 'ลบยอดสะสมต้นปี', RECURRING: 'รายการประจำ', RECURRING_DEL: 'ลบรายการประจำ', IMPORT: 'นำเข้าข้อมูล', IMPORT_MAP_SAVE: 'บันทึกการจับคู่คอลัมน์นำเข้า', EXPORT: 'ส่งออกข้อมูล',
  ETAX_EXPORT: 'ส่งออก e-Tax', FILE: 'แนบแฟ้ม', ADD_IMAGE: 'เพิ่มรูป', DELETE_IMAGE: 'ลบรูป', MAIN_IMAGE: 'ตั้งรูปหลัก', ADD_SIGN: 'เพิ่มลายเซ็น', SAVE_REPORT: 'บันทึกรูปแบบรายงาน',
  LOCK: 'ปิดงวด', UNLOCK: 'เปิดงวด', REOPEN: 'เปิดงวดกลับ', YEAR_END: 'ประมวลผลสิ้นปี', YEAR_REOPEN: 'เปิดปีกลับ', DEPRECIATE: 'คิดค่าเสื่อม', SOLD: 'ขาย/ตัดจำหน่ายทรัพย์สิน',
  UNSOLD: 'ยกเลิกการขายทรัพย์สิน', WHT_CERT: 'หนังสือรับรองหัก ณ ที่จ่าย', W50_ISSUE: 'ออกหนังสือรับรอง 50 ทวิ', PAY: 'จ่ายเงินเดือน', UNPAY: 'ยกเลิกจ่ายเงินเดือน',
  SALARY: 'เงินเดือน', SALARY_DEL: 'ลบเงินเดือน', ALLOWANCE: 'ค่าลดหย่อน',
};
/** ชื่อไทยของรหัสเหตุการณ์ — ไม่มีในรายการ = ชื่อกลาง (ไม่แสดงรหัสดิบ) */
export function actionLabel(code: string): string {
  const c = storedAction(code);
  if (ACTION_LABEL[c]) return ACTION_LABEL[c]!;
  if (c.startsWith('USE_')) return 'ใช้งานเมนูที่ตั้งให้บันทึก';
  if (c.startsWith('ALERT_')) return '⚠ แจ้งเตือนการใช้งานผิดปกติ';
  return 'รายการอื่นของระบบ';
}
