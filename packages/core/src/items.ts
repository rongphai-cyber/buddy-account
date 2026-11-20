/**
 * แฟ้มสินค้า (คู่มือบทที่ 7) — ชนิดรหัสในแฟ้มสินค้า กฎรูปแบบรหัส และการเฉลี่ยราคาสินค้าชุด
 * STMAS.STKTYP: 0 สินค้า · 1 ชุดธรรมดา · 2 ชุดพิเศษ · 3 สินค้าบริการ · 4 รายได้อื่น · 5 ค่าใช้จ่ายอื่น
 */
import { d, type Decimal, type MoneyInput } from './money.js';
import { nextCode } from './ai-bill.js';

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
/**
 * รหัสใหม่ที่ไม่ซ้ำ (นำเข้า Excel เพิ่มสินค้า/บริการ/คู่ค้าให้ — HANDOFF 170 ข้อ H):
 * 1) ต่อจากรหัสเดิมของกลุ่มนี้ที่ตรงรูปแบบ (nextCode — แบบที่ใช้มากที่สุด) · ไม่มีรูปแบบ = ต่อจากรหัสเดิมทั้งหมด (ไม่มีเลย = fallback)
 * 2) ต่อไม่ได้/ไม่มีรหัสที่ตรงรูปแบบ = สร้างจากรูปแบบเอง: กลุ่มสุดท้ายเป็นเลขลำดับ · กลุ่ม 9 อื่น = 9 · กลุ่ม !/X อื่น = label (เช่น 99-SERV-000001)
 * taken = รหัสที่มีแล้ว (ตัวพิมพ์ใหญ่) — รหัสที่ออกให้เพิ่มเข้าไป · null = รูปแบบนี้ออกรหัสไม่ซ้ำไม่ได้
 */
export function newCode(mask: string | null | undefined, pool: string[], taken: Set<string>, fallback: string, label = 'AUTO'): string | null {
  const free = (c: string) => !!c && !taken.has(c.toUpperCase()) && fitsMask(mask, c).ok;
  const fits = pool.filter((c) => fitsMask(mask, c).ok);
  const seq = [...fits];
  if (fits.length || !mask) {
    for (let i = 0; i < 10000; i++) {
      const c = applyMaskCase(mask, nextCode(seq, mask ? '' : fallback));
      if (!c) break;
      if (free(c)) { taken.add(c.toUpperCase()); return c; }
      if (!fitsMask(mask, c).ok) break;   // เลขลำดับยาวเกินรูปแบบ
      seq.push(c);
    }
  }
  if (!mask) return null;
  // จากรูปแบบ: แบ่งกลุ่มตำแหน่งที่ใส่ค่าได้ (9 ! X) คั่นด้วยตัวคั่น
  const groups: Array<{ at: number; len: number; digit: boolean }> = [];
  for (let i = 0; i < mask.length; i++) {
    const m = mask[i]!, slot = m === '9' || m === '!' || m.toUpperCase() === 'X';
    if (!slot) continue;
    const g = groups.at(-1);
    if (g && g.at + g.len === i && g.digit === (m === '9')) g.len++; else groups.push({ at: i, len: 1, digit: m === '9' });
  }
  const last = groups.at(-1);
  if (!last) return null;
  const word = label.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'AUTO';
  const base = [...mask].map((m) => (m === '9' || m === '!' || m.toUpperCase() === 'X' ? '' : m));
  for (const g of groups.slice(0, -1)) for (let k = 0; k < g.len; k++) base[g.at + k] = g.digit ? '9' : word[k] ?? 'X';
  const max = 10 ** Math.min(last.len, 9);
  for (let n = 1; n < max && n < 1000000; n++) {
    const digits = String(n).padStart(last.len, '0');
    const c = base.map((ch, i) => (i >= last.at && i < last.at + last.len ? digits[i - last.at]! : ch)).join('');
    if (free(c)) { taken.add(c.toUpperCase()); return c; }
  }
  return null;
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
