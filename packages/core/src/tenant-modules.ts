/**
 * โมดูล/โปรแกรมของ WTS Solutions ที่ลูกค้าผู้ใช้บริการซื้อใช้ได้ (docs/17 B0.6) — Hub แสดงไทล์ตามนี้
 * buddy เปิดเป็นค่าเริ่มต้น (ลูกค้าเดิมใช้ต่อได้) · โมดูลอื่นต้องเปิดให้ก่อน
 */
export const TENANT_MODULES = [
  { key: 'buddy', label: 'Buddy Account (ระบบบัญชี)', default_on: true },
  { key: 'pos', label: 'WTS-POS (หน้าร้าน ครัวกลาง แฟรนไชส์)', default_on: false },
  { key: 'living', label: 'WTS-Living (หอพัก อพาร์ตเมนต์ นิติบุคคล)', default_on: false },
  { key: 'hr', label: 'WTS-SOP (HR และเงินเดือน)', default_on: false },
  { key: 'hotel', label: 'Hotel (โรงแรม)', default_on: false },
  { key: 'spa', label: 'Spa (สปา)', default_on: false },
] as const;
export type TenantModuleKey = (typeof TENANT_MODULES)[number]['key'];
export const isTenantModuleKey = (k: string): k is TenantModuleKey => TENANT_MODULES.some((m) => m.key === k);

export type TenantModuleRow = { module_key: string; enabled: boolean; valid_to: string | null; seats: number | null; remark?: string | null; app_url?: string | null };

/**
 * สิทธิ์เปิดโปรแกรมรายผู้ใช้ (sys_user.app_access · เจ้าของ 09/11/2569) — ผู้ดูแลระบบของลูกค้ากำหนดที่ ผู้ใช้งานและสิทธิ์
 * null = ทุกโปรแกรมที่ลูกค้าเปิดใช้ (ค่าเดิมของผู้ใช้ทุกคน) · [] = ยังไม่ให้เปิดโปรแกรมใด · ค่าที่ไม่รู้จักถูกตัด · เรียงตาม TENANT_MODULES
 */
export function normalizeAppAccess(v: unknown): TenantModuleKey[] | null {
  let x = v;
  if (typeof x === 'string') { try { x = JSON.parse(x); } catch { return null; } }   // เครื่องสาขา (SQLite) เก็บเป็นข้อความ JSON
  if (!Array.isArray(x)) return null;
  const keys = new Set(x.map(String));
  return TENANT_MODULES.map((m) => m.key).filter((k) => keys.has(k));
}
/** ผู้ใช้เปิดโปรแกรมนี้ได้ไหม (ยังต้องผ่านสิทธิ์ระดับลูกค้า tenantModuleStatus อีกชั้น) — ผู้ดูแลระบบได้เสมอ */
export function userCanOpen(apps: readonly string[] | null | undefined, key: TenantModuleKey, isAdmin = false): boolean {
  return isAdmin || apps == null || apps.includes(key);
}
/** ผู้ใช้ที่ไม่มีสิทธิ์ Buddy (เปิดได้เฉพาะโปรแกรมอื่น) ยังใช้เมนูเหล่านี้ของ Buddy ได้: หน้าเปิดโปรแกรม + เปลี่ยนรหัสผ่าน/ยืนยันตัวตน */
export const HUB_ONLY_MENUS: readonly string[] = ['OT.HUB', 'OT.PASS'];
/** ใช้ได้เฉพาะหน้าเปิดโปรแกรม (ไม่เห็นเมนูบัญชี) */
export const hubOnly = (apps: readonly string[] | null | undefined, isAdmin = false) => !userCanOpen(apps, 'buddy', isAdmin);

/** สถานะโมดูลทุกตัวของลูกค้า: แถวที่ตั้งไว้ หรือค่าเริ่มต้น · active = เปิดและยังไม่หมดอายุ (วันที่ YYYY-MM-DD ค.ศ. · ใช้ได้ถึงสิ้นวัน valid_to) */
export function tenantModuleStatus(rows: TenantModuleRow[], today: string) {
  return TENANT_MODULES.map((m) => {
    const r = rows.find((x) => x.module_key === m.key);
    const enabled = r ? r.enabled : m.default_on;
    const valid_to = r?.valid_to ? String(r.valid_to).slice(0, 10) : null;
    const expired = !!valid_to && valid_to < today;
    return { key: m.key, label: m.label, enabled, valid_to, seats: r?.seats ?? null, remark: r?.remark ?? null, app_url: r?.app_url ?? null, active: enabled && !expired, expired };
  });
}
