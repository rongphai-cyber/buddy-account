/**
 * แฟ้มสินค้า (คู่มือบทที่ 7) — ชนิดรหัสในแฟ้มสินค้า กฎรูปแบบรหัส และการเฉลี่ยราคาสินค้าชุด
 * STMAS.STKTYP: 0 สินค้า · 1 ชุดธรรมดา · 2 ชุดพิเศษ · 3 สินค้าบริการ · 4 รายได้อื่น · 5 ค่าใช้จ่ายอื่น
 */
import { d, type Decimal, type MoneyInput } from './money.js';

export type ItemKind = 'stock' | 'kit' | 'service' | 'income' | 'expense';
export interface ItemKindDef { kind: ItemKind; types: string[]; menu: string; path: string; route: string; label: string; screen: string }
/** หน้าจอ/สิทธิ์/API ของแต่ละชนิดรหัส (ใช้ร่วมกันระหว่าง server และหน้าจอ) */
export const ITEM_KINDS: Record<ItemKind, ItemKindDef> = {
  stock: { kind: 'stock', types: ['0'], menu: 'IC.ITEM', path: 'items', route: '/ic/items', label: 'สินค้า', screen: 'S-IC-01' },
  kit: { kind: 'kit', types: ['1', '2'], menu: 'IC.KIT', path: 'kits', route: '/ic/kits', label: 'สินค้าชุด', screen: 'S-IC-03' },
  service: { kind: 'service', types: ['3'], menu: 'IC.SRV', path: 'services', route: '/ic/services', label: 'สินค้าบริการ', screen: 'S-IC-05' },
  income: { kind: 'income', types: ['4'], menu: 'SA.INC', path: 'other-incomes', route: '/ar/other-incomes', label: 'รายได้อื่น', screen: 'S-SO-02' },
  expense: { kind: 'expense', types: ['5'], menu: 'PU.EXP', path: 'other-expenses', route: '/ap/other-expenses', label: 'ค่าใช้จ่ายอื่น', screen: 'S-AP-02' },
};
export const itemKindOf = (type: string): ItemKind => (Object.values(ITEM_KINDS).find((k) => k.types.includes(type))?.kind ?? 'stock');
export const ITEM_TYPE_TH: Record<string, string> = { '0': 'สินค้า', '1': 'ชุดธรรมดา', '2': 'ชุดพิเศษ', '3': 'บริการ', '4': 'รายได้อื่น', '5': 'ค่าใช้จ่ายอื่น' };

/**
 * รหัสตรงรูปแบบหรือไม่ (เริ่มระบบ 1.3.1 เช่น 99-!!!!-!!!!!!) — 9 = ตัวเลข · ! หรือ X = ตัวอักษรใดก็ได้ · อื่น ๆ = ตัวคั่นต้องตรงตัว
 * ป้อนสั้นกว่ารูปแบบได้ (แบบ Express ที่เติมช่องว่างท้าย) แต่ยาวเกินไม่ได้
 */
export function fitsMask(mask: string | null | undefined, code: string): { ok: boolean; error?: string } {
  if (!mask) return { ok: true };
  if (code.length > mask.length) return { ok: false, error: `รหัสยาวเกินรูปแบบ ${mask} (${mask.length} ตัว)` };
  for (let i = 0; i < code.length; i++) {
    const m = mask[i]!, c = code[i]!;
    if (m === '9' ? !/\d/.test(c) : m === '!' || m.toUpperCase() === 'X' ? /\s/.test(c) : c !== m)
      return { ok: false, error: `รหัสไม่ตรงรูปแบบ ${mask} ที่ตัวที่ ${i + 1} (${m === '9' ? 'ต้องเป็นตัวเลข' : m === '!' || m.toUpperCase() === 'X' ? 'ห้ามเว้นวรรค' : `ต้องเป็น "${m}"`})` };
  }
  return { ok: true };
}
/** ตำแหน่ง ! ในรูปแบบเป็นตัวพิมพ์ใหญ่ */
export function applyMaskCase(mask: string | null | undefined, code: string): string {
  if (!mask) return code;
  return [...code].map((c, i) => (mask[i] === '!' ? c.toUpperCase() : c)).join('');
}

/**
 * เฉลี่ยราคาสินค้าชุดธรรมดาให้ส่วนประกอบตามสัดส่วน (ราคา × จำนวน) — คู่มือหน้า 108–109
 * ราคาของส่วนประกอบเป็น 0 ใช้ราคาสำรอง (ราคาทุนมาตรฐาน / ราคาขายที่ 1 ของสินค้านั้น)
 * ผลรวมเท่ากับยอดเต็มเสมอ (เศษสตางค์ไปที่บรรทัดสุดท้าย)
 */
export function allocateKit(total: MoneyInput, comps: Array<{ qty: MoneyInput; price: MoneyInput; fallback?: MoneyInput }>, places = 2): Decimal[] {
  const weights = comps.map((c) => d(c.qty).times(d(c.price).isZero() ? d(c.fallback) : d(c.price)));
  const sumW = weights.reduce((s, w) => s.plus(w), d(0));
  const t = d(total);
  if (sumW.isZero()) return comps.map((_, i) => (i === 0 ? t : d(0)));
  const out = weights.map((w) => t.times(w).div(sumW).toDecimalPlaces(places));
  const diff = t.minus(out.reduce((s, v) => s.plus(v), d(0)));
  if (!diff.isZero()) out[out.length - 1] = out[out.length - 1]!.plus(diff);
  return out;
}
