import { flattenMenu } from './menu.js';

/**
 * ตารางสิทธิ์รายเมนูแบบต้นไม้ รายช่อง
 * - HANDOFF 161 (เจ้าของ 20/11/2569 "กรณีเลือกอนุญาตทั้งระบบงาน ให้ Y ทุกระบบเหมือนกัน หรือเลือก ซื้อ รวม ทุกเมนูย่อยก็ถูกเลือกเหมือนกัน ถ้าไม่อยากได้สิทธิไหนก็ไปแก้ได้")
 * - HANDOFF 197 (เจ้าของ 26/11/2569 "เมื่อกนดกลุ่มแล้วเบื้องต้นใช้สิทธิรายเมนูตามที่กำนหดในกลุ่ม แต่สามารถปรับเองเพิ่มเติม … (สิทธิกลุ่มได้สิทธิก่อน)"):
 *   ทีละช่อง — ช่องว่าง = ไม่ได้ตั้งที่เมนูนี้ → ใช้ค่าของเมนูหลักที่ใกล้ที่สุดที่ตั้งช่องนั้น แล้ว "ทุกระบบงาน" (ALL) แล้วตารางของกลุ่ม (ลำดับเดียวกัน)
 *   ความหมายเดียวกับ API (permissions.ts tableCell) · ไม่มีค่าเลย = ไม่ได้รับ
 * - ตั้งค่าที่เมนูหลัก: เมนูย่อยที่ไม่ได้ตั้งช่องนั้นได้ค่าใหม่ทันที · เมนูย่อยที่ตั้งช่องนั้นไว้ต่าง = ถามก่อน (ใช้ค่าเดียวกันทั้งหมด = ล้างช่องของเมนูย่อย / คงค่าเดิม)
 * - เลือก "ตามกลุ่ม/ตามเมนูหลัก" = ล้างช่อง (ไม่เก็บ)
 */
export const PERM_ALL = 'ALL';
export const PERM_COLS = ['can_read', 'can_add', 'can_edit', 'can_cancel', 'can_delete', 'can_print', 'can_approve'] as const;
export type PermCol = (typeof PERM_COLS)[number];
/** ช่องที่ตั้งเองของเมนูหนึ่ง — ไม่มี/'' = ไม่ได้ตั้ง */
export type PermRowVals = Partial<Record<PermCol, string>>;
export type PermRows = Record<string, PermRowVals>;
/** ค่าที่ช่องหนึ่งได้รับ: from = เมนูที่ตั้งค่านั้น · layer own = ตารางของตัวเอง (ผู้ใช้/กลุ่มที่กำลังแก้) · group = ตารางของกลุ่มของผู้ใช้ */
export type PermSource = { v: string; from: string; layer: 'own' | 'group' };

const FLAT = flattenMenu();
/** เมนูหลักของแต่ละเมนู (เมนูระดับบนสุด → ALL) */
export const PERM_PARENT: ReadonlyMap<string, string | null> = new Map<string, string | null>([[PERM_ALL, null], ...FLAT.map((m) => [m.code, m.parent ?? PERM_ALL] as [string, string])]);
const CHILDREN = new Map<string, string[]>();
for (const [c, p] of PERM_PARENT) if (p) CHILDREN.set(p, [...(CHILDREN.get(p) ?? []), c]);

/** เมนูย่อยทุกชั้นของเมนูนี้ (ALL = ทุกเมนู) */
export function permDescendants(code: string): string[] {
  const out: string[] = [];
  const walk = (c: string) => { for (const k of CHILDREN.get(c) ?? []) { out.push(k); walk(k); } };
  walk(code);
  return out;
}
/** เมนูนี้ → เมนูหลักทุกชั้น → ALL */
export function permChain(code: string): string[] {
  const out: string[] = [];
  for (let c: string | null = code; c; c = PERM_PARENT.get(c) ?? (c === PERM_ALL ? null : PERM_ALL)) { out.push(c); if (c === PERM_ALL) break; }
  return out;
}
const val = (r: PermRowVals | undefined, col: PermCol) => (r?.[col] ?? '').trim();
/** ค่าของช่องตามสาย (รวมช่องของเมนูนี้เอง) — ตารางของตัวเองก่อน แล้วของกลุ่ม · null = ไม่มีค่าเลย */
export function permCell(own: PermRows, code: string, col: PermCol, group?: PermRows | null): PermSource | null {
  for (const c of permChain(code)) { const v = val(own[c], col); if (v) return { v, from: c, layer: 'own' }; }
  if (group) for (const c of permChain(code)) { const v = val(group[c], col); if (v) return { v, from: c, layer: 'group' }; }
  return null;
}
/** ค่าที่ช่องนี้จะได้ถ้าไม่ตั้งเอง (ไม่นับช่องของเมนูนี้ในตารางของตัวเอง) */
export function permInheritedCell(own: PermRows, code: string, col: PermCol, group?: PermRows | null): PermSource | null {
  const { [code]: _self, ...rest } = own;
  void _self;
  return permCell({ ...rest, [code]: {} }, code, col, group);
}
/** ช่องที่ตั้งเองที่เมนูนี้ (ไม่ว่าง) */
export const permOwn = (rows: PermRows, code: string, col: PermCol) => val(rows[code], col);
/** เมนูย่อยที่ตั้งช่องที่จะเปลี่ยนไว้เอง และต่างจากค่าใหม่ — ต้องถามก่อนใช้ค่าเดียวกันทั้งหมด */
export function permConflicts(rows: PermRows, code: string, set: PermRowVals): string[] {
  const cols = PERM_COLS.filter((c) => set[c] !== undefined && set[c] !== '');
  return permDescendants(code).filter((d) => cols.some((c) => { const v = val(rows[d], c); return v && v !== set[c]; }));
}
/**
 * ตั้งค่าช่อง (หรือทั้งแถว) ที่เมนูนี้ — '' = ล้างช่อง (ตามกลุ่ม/เมนูหลัก)
 * overwrite = เมนูย่อยที่ตั้งช่องเหล่านี้ไว้เองถูกล้าง (ได้ค่าใหม่จากเมนูนี้) · keep = คงค่าเดิมของเมนูย่อย
 */
export function permSet(rows: PermRows, code: string, set: PermRowVals, mode: 'overwrite' | 'keep' = 'overwrite'): PermRows {
  const next: PermRows = { ...rows };
  const put = (c: string, patch: PermRowVals) => {
    const r: PermRowVals = { ...(next[c] ?? {}) };
    for (const k of PERM_COLS) if (patch[k] !== undefined) { if (patch[k]) r[k] = patch[k]; else delete r[k]; }
    if (PERM_COLS.some((k) => val(r, k))) next[c] = r; else delete next[c];
  };
  put(code, set);
  if (mode === 'overwrite') {
    const clear = Object.fromEntries(PERM_COLS.filter((c) => set[c]).map((c) => [c, ''])) as PermRowVals;
    for (const d of permDescendants(code)) if (next[d]) put(d, clear);
  }
  return next;
}
/** ล้างทั้งแถว (ทุกช่องกลับไปตามกลุ่ม/เมนูหลัก) — เมนูย่อยไม่เปลี่ยน */
export function permClear(rows: PermRows, code: string): PermRows {
  const next = { ...rows };
  delete next[code];
  return next;
}
/** ก่อนบันทึก: เก็บเฉพาะช่องที่ตั้งเอง (ตัดช่องว่าง/แถวว่าง) — ค่าที่ตั้งเองเก็บไว้แม้เท่ากับค่าที่ได้รับ (ผู้ใช้ตั้งใจล็อกไว้) */
export function permCompact(rows: PermRows): PermRows {
  const out: PermRows = {};
  for (const [code, r] of Object.entries(rows)) {
    const keep = Object.fromEntries(PERM_COLS.filter((c) => val(r, c)).map((c) => [c, val(r, c)])) as PermRowVals;
    if (Object.keys(keep).length) out[code] = keep;
  }
  return out;
}
/** เครื่องหมายของค่า (HANDOFF 197 เจ้าของ ข้อ 6 "ขอแสดงเครื่องหมายให้ทุกช่อง") */
export function permMark(v: string | null | undefined): string {
  switch ((v ?? '').trim()) {
    case 'Y': return '✓';
    case 'L': return '✓L';
    case 'S': return 'S';
    case 'N': return '✗';
    default: return '✗';
  }
}
