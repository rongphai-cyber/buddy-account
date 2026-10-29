import type { Decimal } from 'decimal.js';
import { d } from './money.js';
import { parseInput } from './money.js';
import { CASH_KINDS, TRADE_KINDS } from './doc-calc.js';

/**
 * AI อ่านบิล (T7.7) — กฎที่ไม่ขึ้นกับฐานข้อมูล: ราคาต่อโทเคน · โครงข้อมูลที่ให้ Claude ตอบ · ตรวจ/แปลงผลเป็นร่างเอกสารซื้อ
 * ผลจาก AI เป็นร่างเสมอ ผู้ใช้ตรวจแล้วบันทึกเอง (บันทึก = ลงบัญชี)
 */
export const AI_MODEL = 'claude-opus-5-5';

/** เอกสารที่เติมจากบิลได้: ซื้อเงินเชื่อ/เงินสด (รายการเป็นสินค้า) · บันทึกค่าใช้จ่ายอื่น ๆ (รายการเป็นรหัสค่าใช้จ่าย) */
export const AI_BILL_TARGETS = [
  ...TRADE_KINDS.filter((k) => k.module === 'AP' && !k.refInvoice && !k.order).map((k) => ({ path: k.path, menu: k.menu, service: false })),
  ...CASH_KINDS.filter((k) => k.cls === 'OE').map((k) => ({ path: k.path, menu: k.menu, service: true })),
];

/** ราคาต่อ 1 ล้านโทเคน (ดอลลาร์สหรัฐ) ตามราคาของ Anthropic ณ ต.ค. 2569 — รุ่นที่ไม่รู้จักคิดราคาสูงสุดไว้ก่อน (ไม่ให้เกินเพดานโดยไม่รู้ตัว) */
export const AI_PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25 },
};
const MAX_PRICE = { input: 10, output: 50, cacheRead: 1 };

export interface AiUsage { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }

/** ค่าใช้จ่ายของการเรียกหนึ่งครั้ง — ถ้ามีการสลับรุ่น (fallback) คิดตามรุ่นที่แพงกว่า · เขียนแคชคิด 1.25 เท่าของขาเข้า */
export function aiCost(usage: AiUsage, ...models: Array<string | null | undefined>): Decimal {
  const ps = models.filter(Boolean).map((m) => AI_PRICES[m!] ?? MAX_PRICE);
  const p = ps.length ? ps.reduce((a, b) => (b.input > a.input ? b : a)) : MAX_PRICE;
  const m = 1_000_000;
  return d(usage.input_tokens ?? 0).times(p.input).div(m)
    .plus(d(usage.output_tokens ?? 0).times(p.output).div(m))
    .plus(d(usage.cache_read_input_tokens ?? 0).times(p.cacheRead).div(m))
    .plus(d(usage.cache_creation_input_tokens ?? 0).times(p.input * 1.25).div(m))
    .toDecimalPlaces(4);
}

const str = { anyOf: [{ type: 'string' }, { type: 'null' }] } as const;
/** โครงข้อมูลที่ให้ Claude ตอบ (structured outputs — ทุกช่อง required, ว่าง = null) */
export const BILL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['doc_kind', 'supplier', 'doc_no', 'doc_date', 'price_type', 'vat_rate', 'lines', 'subtotal', 'discount', 'vat_amount', 'total', 'notes'],
  properties: {
    doc_kind: { type: 'string', enum: ['tax_invoice', 'receipt_tax_invoice', 'abbreviated_tax_invoice', 'invoice', 'receipt', 'other'] },
    supplier: {
      type: 'object', additionalProperties: false, required: ['name', 'tax_id', 'branch_no', 'address'],
      properties: { name: str, tax_id: str, branch_no: str, address: str },
    },
    doc_no: str,
    doc_date: str,
    price_type: { type: 'string', enum: ['excl_vat', 'incl_vat', 'no_vat'] },
    vat_rate: str,
    lines: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['description', 'qty', 'unit', 'unit_price', 'amount'],
        properties: { description: { type: 'string' }, qty: str, unit: str, unit_price: str, amount: str },
      },
    },
    subtotal: str, discount: str, vat_amount: str, total: str,
    notes: { type: 'array', items: { type: 'string' } },
  },
} as const;

export const BILL_SYSTEM_PROMPT = `คุณอ่านเอกสารซื้อของกิจการในประเทศไทย (ใบกำกับภาษี ใบเสร็จรับเงิน ใบแจ้งหนี้ ใบกำกับภาษีอย่างย่อ) จากรูปหรือ PDF แล้วตอบเป็นข้อมูลตามโครงที่กำหนด
ข้อมูลนี้จะถูกเติมเป็นร่างเอกสารซื้อในโปรแกรมบัญชี ผู้ใช้จะตรวจก่อนบันทึก จึงต้องตรงกับที่พิมพ์ในเอกสารจริง ห้ามเดา:
- อ่านไม่ออกหรือไม่มีในเอกสาร ให้ตอบ null และบอกเหตุใน notes (ภาษาไทยสั้น ๆ)
- supplier คือผู้ขาย/ผู้ออกเอกสาร (ไม่ใช่ผู้ซื้อ) · tax_id เลข 13 หลักไม่มีขีด · branch_no 5 หลัก สำนักงานใหญ่ = "00000"
- doc_date เป็นปี ค.ศ. รูปแบบ YYYY-MM-DD (ปี พ.ศ. ลบ 543 เช่น 15/03/2569 → 2026-03-15)
- จำนวนเงินและจำนวนเป็นตัวเลขทศนิยมแบบข้อความ ไม่มีจุลภาคหรือสกุลเงิน เช่น "1234.50"
- price_type: ราคาในรายการยังไม่รวม VAT = excl_vat · รวม VAT แล้ว = incl_vat · ไม่มี VAT = no_vat · vat_rate เช่น "7"
- lines ตามลำดับในเอกสาร amount คือยอดของบรรทัดตามที่พิมพ์ · subtotal ยอดรวมก่อน VAT · discount ส่วนลดท้ายบิล · vat_amount ภาษีมูลค่าเพิ่ม · total ยอดรวมทั้งสิ้น
- ถ้าไม่ใช่เอกสารซื้อขาย ให้ doc_kind = "other" และอธิบายใน notes`;

export interface RawBill {
  doc_kind: string; supplier: { name: string | null; tax_id: string | null; branch_no: string | null; address: string | null };
  doc_no: string | null; doc_date: string | null; price_type: 'excl_vat' | 'incl_vat' | 'no_vat'; vat_rate: string | null;
  lines: Array<{ description: string; qty: string | null; unit: string | null; unit_price: string | null; amount: string | null }>;
  subtotal: string | null; discount: string | null; vat_amount: string | null; total: string | null; notes: string[];
}
export interface BillDraft {
  doc_kind: string; supplier: { name: string; tax_id: string | null; branch_no: string | null; address: string };
  doc_no: string; doc_date: string | null; price_type: '0' | '1' | '2'; vat_rate: string;
  lines: Array<{ description: string; qty: string; unit: string | null; unit_price: string; amount: string }>;
  subtotal: string | null; discount: string | null; vat_amount: string | null; total: string | null;
  warnings: string[];
}

const money = (v: string | null | undefined) => { if (v === null || v === undefined || !String(v).trim()) return null; const x = parseInput(String(v)); return x === null ? null : x; };
const fx = (v: Decimal | null) => (v === null ? null : v.toFixed(2));

/** ตรวจ/แปลงผลจาก AI → ร่างเอกสาร + ข้อสังเกตที่ผู้ใช้ต้องตรวจ (ภาษาไทย) */
export function normalizeBill(raw: RawBill): BillDraft {
  const w: string[] = [...(raw.notes ?? []).filter(Boolean).map((n) => `AI: ${n}`)];
  if (raw.doc_kind === 'other') w.push('ไม่แน่ใจว่าเป็นเอกสารซื้อขาย — ตรวจแฟ้มที่เลือก');
  if (raw.doc_kind === 'abbreviated_tax_invoice') w.push('เป็นใบกำกับภาษีอย่างย่อ — ใช้ขอคืนภาษีซื้อไม่ได้');
  const tax = (raw.supplier?.tax_id ?? '').replace(/\D/g, '');
  if (raw.supplier?.tax_id && tax.length !== 13) w.push(`เลขผู้เสียภาษีผู้ขาย "${raw.supplier.tax_id}" ไม่ครบ 13 หลัก`);
  const branch = (raw.supplier?.branch_no ?? '').replace(/\D/g, '');
  const date = raw.doc_date && /^\d{4}-\d{2}-\d{2}$/.test(raw.doc_date) ? raw.doc_date : null;
  if (raw.doc_date && !date) w.push(`วันที่เอกสาร "${raw.doc_date}" อ่านไม่ได้ — ป้อนเอง`);
  if (date && Number(date.slice(0, 4)) > 2400) w.push('วันที่น่าจะเป็นปี พ.ศ. — ตรวจวันที่');
  const pt = raw.price_type === 'incl_vat' ? '1' : raw.price_type === 'no_vat' ? '0' : '2';
  const rate = money(raw.vat_rate) ?? d(pt === '0' ? 0 : 7);
  const lines = (raw.lines ?? []).map((l, i) => {
    const q = money(l.qty), p = money(l.unit_price), a = money(l.amount);
    const qty = q ?? (a && p && !p.isZero() ? a.div(p).toDecimalPlaces(4) : d(1));
    const price = p ?? (a ? a.div(qty.isZero() ? 1 : qty).toDecimalPlaces(4) : null);
    if (price === null) w.push(`บรรทัดที่ ${i + 1}: อ่านราคาไม่ได้`);
    const amount = a ?? (price ? qty.times(price).toDecimalPlaces(2) : null);
    if (a && price && qty.times(price).toDecimalPlaces(2).minus(a).abs().gt(0.01)) w.push(`บรรทัดที่ ${i + 1}: จำนวน × ราคา ไม่เท่ากับยอดบรรทัด (อาจมีส่วนลด) — ตรวจ`);
    return { description: (l.description ?? '').trim().slice(0, 200), qty: qty.toString(), unit: l.unit?.trim() || null, unit_price: price ? price.toString() : '', amount: fx(amount) ?? '' };
  });
  if (!lines.length) w.push('ไม่พบรายการสินค้า/บริการ');
  const sub = money(raw.subtotal), disc = money(raw.discount), vat = money(raw.vat_amount), total = money(raw.total);
  const sumLines = lines.reduce((s, l) => s.plus(d(l.amount || 0)), d(0));
  // ยอดรวมบรรทัด − ส่วนลด (+ VAT ถ้าราคาไม่รวม VAT) = ยอดรวมทั้งสิ้น
  if (total) {
    const calc = sumLines.minus(disc ?? 0).plus(pt === '2' ? (vat ?? 0) : 0);
    if (calc.minus(total).abs().gt(0.05)) w.push(`ยอดรายการรวม ${sumLines.toFixed(2)} ไม่สอดคล้องกับยอดรวมทั้งสิ้น ${total.toFixed(2)} ในเอกสาร — ตรวจรายการ/ส่วนลด`);
  } else w.push('ไม่พบยอดรวมทั้งสิ้นในเอกสาร');
  if (pt !== '0' && vat && sub && !rate.isZero()) {
    const base = pt === '1' ? sub.minus(vat) : sub;
    if (base.times(rate).div(100).toDecimalPlaces(2).minus(vat).abs().gt(0.05) && sub.times(rate).div(100).toDecimalPlaces(2).minus(vat).abs().gt(0.05)) w.push(`VAT ${vat.toFixed(2)} ไม่เท่ากับ ${rate.toString()}% ของฐาน — ตรวจ`);
  }
  return {
    doc_kind: raw.doc_kind,
    supplier: { name: (raw.supplier?.name ?? '').trim(), tax_id: tax.length === 13 ? tax : null, branch_no: branch ? branch.padStart(5, '0').slice(-5) : null, address: (raw.supplier?.address ?? '').trim() },
    doc_no: (raw.doc_no ?? '').trim().slice(0, 30), doc_date: date, price_type: pt, vat_rate: rate.toString(), lines,
    subtotal: fx(sub), discount: fx(disc), vat_amount: fx(vat), total: fx(total), warnings: w,
  };
}
