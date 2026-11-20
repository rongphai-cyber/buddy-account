import { flattenMenu } from './menu.js';

/**
 * ตารางสิทธิ์รายเมนูแบบต้นไม้ (HANDOFF 161 · เจ้าของ 20/11/2569 "กรณีเลือกอนุญาตทั้งระบบงาน ให้ Y ทุกระบบเหมือนกัน หรือเลือก ซื้อ รวม ทุกเมนูย่อยก็ถูกเลือกเหมือนกัน ถ้าไม่อยากได้สิทธิไหนก็ไปแก้ได้")
 * ความหมายเดียวกับ API (permissions.ts tableValue): เมนูที่มีแถวสิทธิ์ = ใช้ค่าทั้ง 7 ช่องของแถวนั้น (ว่าง = N) · ไม่มีแถว = ใช้แถวของเมนูหลักที่ใกล้ที่สุด แล้ว "ทุกระบบงาน" (ALL)
 * - แถวที่ไม่มี: หน้าจอแสดงค่าที่ได้จากเมนูหลัก (จาง) · แก้ช่องใด = สร้างแถวจากค่าที่ได้รับอยู่ แล้วเปลี่ยนเฉพาะช่องนั้น
 * - ตั้งค่าที่เมนูหลัก: เมนูย่อยที่ไม่มีแถวได้ค่าใหม่ทันที · เมนูย่อยที่มีแถวตั้งไว้ต่าง = ถามก่อน (ใช้ค่าเดียวกันทั้งหมด / คงค่าเดิม)
 * - ก่อนบันทึก: แถวที่เหมือนค่าที่ได้จากเมนูหลักทุกช่อง ไม่ต้องเก็บ (สิทธิ์ที่ได้จริงเท่าเดิม)
 */
export const PERM_ALL = 'ALL';
export const PERM_COLS = ['can_read', 'can_add', 'can_edit', 'can_cancel', 'can_delete', 'can_print', 'can_approve'] as const;
export type PermCol = (typeof PERM_COLS)[number];
export type PermRowVals = Record<PermCol, string>;
export type PermRows = Record<string, PermRowVals>;

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
/** ค่าที่เมนูนี้ได้รับจากเมนูหลักที่ใกล้ที่สุดที่มีแถว (ไม่นับแถวของตัวเอง) — null = ไม่มีเลย (ใช้ไม่ได้) */
export function permInherited(rows: PermRows, code: string): { from: string; row: PermRowVals } | null {
  for (let p = PERM_PARENT.get(code) ?? null; p; p = PERM_PARENT.get(p) ?? null) if (rows[p]) return { from: p, row: rows[p]! };
  return null;
}
const blankToN = (r: Partial<PermRowVals>): PermRowVals => Object.fromEntries(PERM_COLS.map((c) => [c, r[c] || 'N'])) as PermRowVals;
/** แถวที่จะสร้างเมื่อเริ่มแก้เมนูที่ยังไม่มีแถว: ค่าเดียวกับที่ได้รับอยู่ (ไม่มีเลย = N ทุกช่อง) */
export function permMaterialize(rows: PermRows, code: string): PermRowVals {
  return rows[code] ? blankToN(rows[code]!) : blankToN(permInherited(rows, code)?.row ?? {});
}
/** เมนูย่อยที่มีแถวของตัวเอง และตั้งช่องที่จะเปลี่ยนไว้ต่างจากค่าใหม่ — ต้องถามก่อนใช้ค่าเดียวกันทั้งหมด */
export function permConflicts(rows: PermRows, code: string, set: Partial<PermRowVals>): string[] {
  return permDescendants(code).filter((d) => rows[d] && PERM_COLS.some((c) => set[c] !== undefined && (rows[d]![c] || 'N') !== set[c]));
}
/**
 * ตั้งค่าช่อง (หรือทั้งแถว) ที่เมนูนี้ แล้วกระจายลงเมนูย่อย: overwrite = เมนูย่อยที่มีแถวของตัวเองได้ค่าเดียวกันด้วย · keep = คงค่าเดิมของเมนูย่อยที่มีแถว
 * เมนูย่อยที่ไม่มีแถวได้ค่าใหม่จากเมนูหลักอยู่แล้ว (ไม่ต้องสร้างแถว)
 */
export function permSet(rows: PermRows, code: string, set: Partial<PermRowVals>, mode: 'overwrite' | 'keep' = 'overwrite'): PermRows {
  const next: PermRows = { ...rows, [code]: { ...permMaterialize(rows, code), ...stripUndef(set) } };
  if (mode === 'overwrite') for (const d of permDescendants(code)) if (rows[d]) next[d] = { ...blankToN(rows[d]!), ...stripUndef(set) };
  return next;
}
/** ล้างแถว (กลับไปใช้ค่าจากเมนูหลัก) — เมนูย่อยไม่เปลี่ยน */
export function permClear(rows: PermRows, code: string): PermRows {
  const next = { ...rows };
  delete next[code];
  return next;
}
/** ก่อนบันทึก: ตัดแถวที่เหมือนค่าที่ได้จากเมนูหลักทุกช่อง (ALL ไม่มีเมนูหลัก — เก็บเสมอถ้ามี) · ช่องว่าง = N */
export function permCompact(rows: PermRows): PermRows {
  const full: PermRows = Object.fromEntries(Object.entries(rows).map(([k, r]) => [k, blankToN(r)]));
  const out: PermRows = { ...full };
  for (const code of Object.keys(full)) {
    const inh = permInherited(out, code);
    if (inh && PERM_COLS.every((c) => out[code]![c] === inh.row[c])) delete out[code];
  }
  return out;
}
function stripUndef(o: Partial<PermRowVals>) { return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<PermRowVals>; }
