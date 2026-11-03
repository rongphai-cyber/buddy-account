import { d } from './money.js';

/**
 * WTS Connect v1 (docs/17 ข้อ 3.2 · B0.2): ยอดที่ระบบต้นทางคำนวณ (`source_totals` ในคำขอ) ต้องตรงกับที่ Buddy คำนวณทุกสตางค์
 * ต่างแม้ 0.01 → ไม่บันทึก (422 AMOUNT_MISMATCH) · ห้ามปัดให้ตรงเงียบ ๆ
 */
export const SOURCE_TOTAL_FIELDS = {
  net_amount: 'ยอดสุทธิ (รวม VAT)',
  taxable_amount: 'มูลค่าก่อน VAT (ยอดสุทธิ − VAT)',
  vat_amount: 'ภาษีมูลค่าเพิ่ม',
  wht_amount: 'ภาษีหัก ณ ที่จ่าย',
  total: 'ยอดรวมเดบิต = เครดิต (ใบสำคัญ)',
} as const;
export type SourceTotalField = keyof typeof SOURCE_TOTAL_FIELDS;

const MONEY = /^-?\d{1,15}(\.\d{1,2})?$/;

/** ตรวจรูปแบบ `source_totals` → ข้อผิดพลาด (ภาษาไทย) หรือค่าที่ใช้เทียบ */
export function parseSourceTotals(v: unknown): { totals: Partial<Record<SourceTotalField, string>>; errors: string[] } | null {
  if (v === undefined || v === null) return null;
  const errors: string[] = [];
  const totals: Partial<Record<SourceTotalField, string>> = {};
  if (typeof v !== 'object' || Array.isArray(v)) return { totals, errors: ['source_totals ต้องเป็นออบเจ็กต์ เช่น { "net_amount": "30000.00", "vat_amount": "1962.62" }'] };
  const entries = Object.entries(v as Record<string, unknown>);
  if (!entries.length) errors.push('source_totals ว่าง — ส่งอย่างน้อย 1 ยอด เช่น net_amount');
  for (const [k, x] of entries) {
    if (!(k in SOURCE_TOTAL_FIELDS)) { errors.push(`source_totals.${k} ไม่รู้จัก — ใช้ได้: ${Object.keys(SOURCE_TOTAL_FIELDS).join(' ')}`); continue; }
    const s = typeof x === 'number' ? String(x) : x;
    if (typeof s !== 'string' || !MONEY.test(s.trim())) { errors.push(`source_totals.${k} ต้องเป็นข้อความทศนิยมไม่เกิน 2 ตำแหน่ง เช่น "1962.62"`); continue; }
    totals[k as SourceTotalField] = s.trim();
  }
  return { totals, errors };
}

export type TotalMismatch = { field: SourceTotalField; label: string; source: string; buddy: string; diff: string };

/** เทียบยอดต้นทางกับยอดที่ Buddy คำนวณ (ทั้งคู่เป็นข้อความทศนิยม) — คืนรายการที่ต่าง (ว่าง = ตรงทุกสตางค์) */
export function compareSourceTotals(source: Partial<Record<SourceTotalField, string>>, buddy: Partial<Record<SourceTotalField, string | null>>): TotalMismatch[] {
  const out: TotalMismatch[] = [];
  for (const [k, sv] of Object.entries(source) as Array<[SourceTotalField, string]>) {
    const bv = buddy[k];
    const b = d(bv ?? '0'), s = d(sv);
    if (!b.eq(s)) out.push({ field: k, label: SOURCE_TOTAL_FIELDS[k], source: s.toFixed(2), buddy: b.toFixed(2), diff: b.minus(s).toFixed(2) });
  }
  return out;
}
