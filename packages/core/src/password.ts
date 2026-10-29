/**
 * นโยบายรหัสผ่าน (T0.16): อย่างน้อย 8 ตัว มีทั้งตัวอักษรและตัวเลข ไม่ซ้ำกับรหัสผู้ใช้
 * ไม่บังคับเปลี่ยนตามรอบเวลา (เจ้าของเลือก — ใช้ยืนยันตัวตนสองขั้นแทน)
 * คืนข้อความบอกวิธีแก้ หรือ null = ใช้ได้
 */
export const PASSWORD_RULE = 'อย่างน้อย 8 ตัวอักษร มีทั้งตัวอักษรและตัวเลข';
export function passwordProblem(pw: string, username?: string | null): string | null {
  if (pw.length < 8) return `รหัสผ่านสั้นเกินไป — ต้อง${PASSWORD_RULE}`;
  if (pw.length > 200) return 'รหัสผ่านยาวเกิน 200 ตัวอักษร';
  if (!/\p{L}/u.test(pw) || !/\d/.test(pw)) return `รหัสผ่านต้องมีทั้งตัวอักษรและตัวเลข (${PASSWORD_RULE})`;
  if (username && pw.toLowerCase() === username.toLowerCase()) return 'รหัสผ่านต้องไม่เหมือนรหัสผู้ใช้';
  if (/^(.)\1+$/.test(pw)) return 'รหัสผ่านเป็นตัวซ้ำทั้งหมด เดาง่ายเกินไป';
  return null;
}
