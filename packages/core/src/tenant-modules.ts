/**
 * โมดูล/โปรแกรมของ WTS Solutions ที่ลูกค้าผู้ใช้บริการซื้อใช้ได้ (docs/17 B0.6) — Hub แสดงไทล์ตามนี้
 * buddy เปิดเป็นค่าเริ่มต้น (ลูกค้าเดิมใช้ต่อได้) · โมดูลอื่นต้องเปิดให้ก่อน
 */
export const TENANT_MODULES = [
  { key: 'buddy', label: 'Buddy Account (ระบบบัญชี)', default_on: true },
  { key: 'pos', label: 'WTS-POS (หน้าร้าน ครัวกลาง แฟรนไชส์)', default_on: false },
  { key: 'living', label: 'WTS-Living (หอพัก อพาร์ตเมนต์ นิติบุคคล)', default_on: false },
  { key: 'hr', label: 'WTS-HR (ระบบบุคคลและเงินเดือน)', default_on: false },
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

/** ชื่อระบบต้นทางที่แสดงบนหน้าจอ/ข้อความ (รหัสในฐานข้อมูล/กุญแจ API คงเดิม) — wts-sop แสดงเป็น WTS-HR (เจ้าของ 10/11/2569: "เป็นระบบ HR ทั้งระบบ") */
const SOURCE_NAMES: Record<string, string> = { 'wts-sop': 'WTS-HR' };
export const sourceSystemLabel = (code: string) => SOURCE_NAMES[code.toLowerCase()] ?? code.toUpperCase();

/**
 * เมนูที่ซ่อนจากลูกค้าจนกว่าจะเปิดให้รายลูกค้า (HANDOFF 200 · เจ้าของ 26/11/2569) — ที่เดียวที่กำหนด (หน้าจอและ server ใช้ชุดนี้ คู่กับ PLATFORM_MENUS)
 * เก็บใน sys_tenant_module (module_key = key) ตารางเดียวกับโปรแกรมของลูกค้า แต่ไม่ใช่ไทล์ใน Hub · เจ้าหน้าที่ผู้ให้บริการใช้ได้เสมอ
 * auto = เปิดเองเมื่อลูกค้าใช้โปรแกรมนี้ (active) · autoDevices = เปิดเองเมื่อลูกค้ามีเครื่องสาขาที่ลงทะเบียนไว้แล้ว (เครื่องเดิมจัดการต่อได้)
 */
export const TENANT_FEATURES: ReadonlyArray<{ key: string; label: string; menus: readonly string[]; auto: readonly TenantModuleKey[]; autoDevices?: boolean; hint: string }> = [
  { key: 'express_import', label: 'นำข้อมูลจาก Express', menus: ['OT.IMPORT'], auto: [], hint: 'ปกติผู้ให้บริการย้ายข้อมูลให้ — เปิดเมื่อลูกค้าต้องการนำเข้าเอง' },
  { key: 'devices', label: 'เครื่องสาขา (ออฟไลน์)', menus: ['SET.DEVICE'], auto: ['pos'], autoDevices: true, hint: 'เปิดเองเมื่อลูกค้าใช้ WTS-POS หรือมีเครื่องสาขาที่ลงทะเบียนไว้แล้ว — ติ๊กเพื่อเปิดให้แม้ไม่มี' },
];
export const isTenantFeatureKey = (k: string) => TENANT_FEATURES.some((f) => f.key === k);
/** เมนูที่ต้องเปิดให้รายลูกค้า */
export const TENANT_MENUS: ReadonlySet<string> = new Set(TENANT_FEATURES.flatMap((f) => f.menus));
export const tenantOnlyMenu = (code: string) => TENANT_MENUS.has(code);

/** สถานะเมนูเปิดรายลูกค้า: ติ๊กไว้ (enabled ยังไม่หมดอายุ) หรือเปิดเอง (auto = เหตุที่เปิดเอง) */
export function tenantFeatureStatus(rows: TenantModuleRow[], today: string, ctx: { hasDevices?: boolean } = {}) {
  const mods = tenantModuleStatus(rows, today);
  return TENANT_FEATURES.map((f) => {
    const r = rows.find((x) => x.module_key === f.key);
    const valid_to = r?.valid_to ? String(r.valid_to).slice(0, 10) : null;
    const expired = !!valid_to && valid_to < today;
    const auto = [...mods.filter((m) => m.active && f.auto.includes(m.key as TenantModuleKey)).map((m) => m.label), ...(f.autoDevices && ctx.hasDevices ? ['มีเครื่องสาขาที่ลงทะเบียนไว้'] : [])];
    const enabled = !!r?.enabled;
    return { key: f.key, label: f.label, hint: f.hint, menus: [...f.menus], enabled, valid_to, remark: r?.remark ?? null, expired, auto, active: (enabled && !expired) || auto.length > 0 };
  });
}
/** เมนูที่ลูกค้านี้ยังไม่ได้เปิด (ซ่อนจากลูกค้าทุกคน รวมผู้ดูแลของลูกค้า) */
export function tenantMenusOff(rows: TenantModuleRow[], today: string, ctx: { hasDevices?: boolean } = {}): string[] {
  return tenantFeatureStatus(rows, today, ctx).filter((f) => !f.active).flatMap((f) => f.menus);
}
