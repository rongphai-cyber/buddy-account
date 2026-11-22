import type { Decimal } from 'decimal.js';
import { d, type MoneyInput } from './money.js';
import { parseInput } from './money.js';
import { CASH_KINDS, TRADE_KINDS } from './doc-calc.js';
import { checkTaxId } from './taxid.js';
import { WHT_INCOME_TYPES, wht50FormOf } from './forms/wht50.js';

/**
 * AI อ่านบิล (T7.7) — กฎที่ไม่ขึ้นกับฐานข้อมูล: ราคาต่อโทเคน · โครงข้อมูลที่ให้ Claude ตอบ · ตรวจ/แปลงผลเป็นร่างเอกสารซื้อ
 * ผลจาก AI เป็นร่างเสมอ ผู้ใช้ตรวจแล้วบันทึกเอง (บันทึก = ลงบัญชี)
 */

/**
 * รุ่น Claude ที่บริษัทเลือกได้ (HANDOFF 166 — เจ้าของ 20/11/2569 "ขอรุ่นที่ถูกที่สุด") · ตั้งที่ เริ่มระบบ › AI อ่านบิล (ค่าตั้ง ai.model)
 * ใช้ทั้งการอ่านบิลและการแนะนำรหัส · fallback = มีรุ่นสำรองฝั่ง Anthropic เมื่อรุ่นนี้ปฏิเสธ (Haiku ไม่มี — ส่ง fallbacks แล้วได้ 400)
 */
export const AI_MODELS = [
  { id: 'claude-haiku-5-5', label: 'ประหยัดที่สุด (Haiku 5.5)', fallback: false },
  { id: 'claude-sonnet-5-5', label: 'สมดุล (Sonnet 5.5)', fallback: true },
  { id: 'claude-opus-5-5', label: 'แม่นยำที่สุด (Opus 5.5)', fallback: true },
] as const;
export type AiModelId = (typeof AI_MODELS)[number]['id'];
/** ค่าเริ่มต้นทุกบริษัท (รวมบริษัทเดิมที่ยังไม่เคยเลือก) = รุ่นถูกที่สุด */
export const AI_MODEL: AiModelId = 'claude-haiku-5-5';
/** ค่าตั้งที่เก็บไว้ → รุ่นที่ใช้ได้ (ไม่มี/ไม่รู้จัก = ค่าเริ่มต้น) */
export function aiModelOf(v: unknown): AiModelId {
  return AI_MODELS.find((m) => m.id === v)?.id ?? AI_MODEL;
}
export const aiModelLabel = (id: string | null | undefined) => AI_MODELS.find((m) => m.id === id)?.label ?? id ?? '';
/**
 * พารามิเตอร์ของคำขอที่ขึ้นกับรุ่น: Sonnet/Opus ส่งต่อรุ่นสำรองเมื่อปฏิเสธ (server-side fallback) · Haiku ไม่ส่ง betas/fallbacks
 * effort ระบุชัดเสมอ (Haiku/Opus ค่าเริ่มต้น medium, Sonnet high) · ไม่ส่ง thinking (ทั้งสามรุ่นคิดแบบ adaptive เอง)
 */
export function aiRequestOptions(model: AiModelId) {
  const fb = AI_MODELS.find((m) => m.id === model)?.fallback ?? false;
  return { model, ...(fb ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}) };
}

/**
 * เอกสารที่เติมจากบิลได้ — ทุกหน้าจอที่คีย์เอกสาร (เจ้าของ 21/11/2569 · HANDOFF 171 "ขอมีอ่านบิลด้วย Ai และ นำเข้า Excel ทั้งสองแบบ")
 * party: supplier = กระดาษจากผู้จำหน่าย (บิลซื้อ ใบลด/เพิ่มหนี้ ใบเสนอราคาผู้ขาย) · customer = กระดาษฝั่งขาย (ใบสั่งซื้อของลูกค้า บิลเขียนมือ) — ลูกค้า = ผู้ซื้อในเอกสาร
 * lines: item = รหัสสินค้า/บริการ (ซื้อใช้รหัสค่าใช้จ่ายได้) · expense = รหัสค่าใช้จ่าย (OE) · income = รหัสรายได้ (OI) · text = คำอธิบาย + จำนวนเงิน (มัดจำ AI/AE)
 * service = เฉพาะรหัสค่าใช้จ่าย (OE — ชื่อเดิม)
 */
export interface AiBillTarget { path: string; cls: string; menu: string; party: 'customer' | 'supplier'; lines: 'item' | 'expense' | 'income' | 'text'; service: boolean }
export const AI_BILL_TARGETS: AiBillTarget[] = [
  ...TRADE_KINDS.map((k) => ({ path: k.path, cls: k.cls, menu: k.menu, party: k.party, lines: 'item' as const, service: false })),
  ...CASH_KINDS.map((k) => ({ path: k.path, cls: k.cls, menu: k.menu, party: k.party, lines: k.lines === 'text' ? 'text' as const : k.itemType === '4' ? 'income' as const : 'expense' as const, service: k.cls === 'OE' })),
];
/** ฝั่งของกระดาษที่อ่าน: ขาย = ลูกค้าเป็นผู้ซื้อในเอกสาร · ซื้อ = ผู้จำหน่ายเป็นผู้ขาย */
export const aiBillSide = (t: Pick<AiBillTarget, 'party'>): 'sale' | 'purchase' => (t.party === 'customer' ? 'sale' : 'purchase');

type Price = { input: number; output: number; cacheRead: number };
/**
 * ราคาต่อ 1 ล้านโทเคน (ดอลลาร์สหรัฐ) ตามราคาของ Anthropic ณ พ.ย. 2569 — รุ่นที่ไม่รู้จักคิดราคาสูงสุดไว้ก่อน (ไม่ให้เกินเพดานโดยไม่รู้ตัว)
 * Haiku 5.5 มีสองอัตรา: คำขอที่ยาวเกิน 100,000 โทเคน (ขาเข้ารวมแคช) คิดอัตราสูงทั้งคำขอ · อ่านแคช = 0.1 เท่าของขาเข้า (โปรแกรมยังไม่ใช้แคช)
 */
export const AI_PRICES: Record<string, Price & { long?: Price & { over: number } }> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, long: { over: 100_000, input: 0.5, output: 2.5, cacheRead: 0.05 } },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25 },
};
const MAX_PRICE: Price = { input: 10, output: 50, cacheRead: 1 };

export interface AiUsage { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }

/** ค่าใช้จ่ายของการเรียกหนึ่งครั้ง — ถ้ามีการสลับรุ่น (fallback) คิดตามรุ่นที่แพงกว่า · เขียนแคชคิด 1.25 เท่าของขาเข้า */
export function aiCost(usage: AiUsage, ...models: Array<string | null | undefined>): Decimal {
  const prompt = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
  const priceOf = (m: string): Price => { const x = AI_PRICES[m]; return !x ? MAX_PRICE : x.long && prompt > x.long.over ? x.long : x; };
  const ps = models.filter(Boolean).map((m) => priceOf(m!));
  const p = ps.length ? ps.reduce((a, b) => (b.input > a.input ? b : a)) : MAX_PRICE;
  const m = 1_000_000;
  return d(usage.input_tokens ?? 0).times(p.input).div(m)
    .plus(d(usage.output_tokens ?? 0).times(p.output).div(m))
    .plus(d(usage.cache_read_input_tokens ?? 0).times(p.cacheRead).div(m))
    .plus(d(usage.cache_creation_input_tokens ?? 0).times(p.input * 1.25).div(m))
    .toDecimalPlaces(4);
}

/** โทเคนโดยประมาณของบิลหนึ่งใบ (อ่านบิล 1 ครั้ง + แนะนำรหัส 1 ครั้ง) — ใช้แสดงค่าใช้จ่ายต่อบิลของแต่ละรุ่น ค่าจริงขึ้นกับขนาดรูป/จำนวนบรรทัด */
export const AI_TYPICAL_BILL: AiUsage[] = [{ input_tokens: 4000, output_tokens: 1500 }, { input_tokens: 2000, output_tokens: 400 }];
export function aiBillEstimate(model: string): Decimal {
  return AI_TYPICAL_BILL.reduce((t, u) => t.plus(aiCost(u, model)), d(0));
}

/**
 * ช่องข้อความ: ไม่มี/อ่านไม่ออก = "" (HANDOFF 166) — structured outputs รับช่องแบบ anyOf/null ได้ไม่เกิน 16 ช่องต่อโครง
 * (เดิม 18 ช่อง [string, null] → Anthropic ตอบ 400 "too many parameters with union types") จึงไม่ใช้ null ในโครงเลย
 */
const str = { type: 'string' } as const;
/** โครงข้อมูลที่ให้ Claude ตอบ (structured outputs — ทุกช่อง required, ว่าง = "") */
export const BILL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['doc_kind', 'supplier', 'buyer', 'doc_no', 'doc_date', 'price_type', 'vat_rate', 'lines', 'subtotal', 'discount', 'vat_amount', 'wht_amount', 'total', 'notes'],
  properties: {
    doc_kind: { type: 'string', enum: ['tax_invoice', 'receipt_tax_invoice', 'abbreviated_tax_invoice', 'invoice', 'receipt', 'other'] },
    supplier: {
      type: 'object', additionalProperties: false, required: ['name', 'tax_id', 'branch_no', 'address', 'phone'],
      properties: { name: str, tax_id: str, branch_no: str, address: str, phone: str },
    },
    buyer: { type: 'object', additionalProperties: false, required: ['name', 'tax_id', 'branch_no'], properties: { name: str, tax_id: str, branch_no: str } },
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
    subtotal: str, discount: str, vat_amount: str, wht_amount: str, total: str,
    notes: { type: 'array', items: { type: 'string' } },
  },
} as const;

export const BILL_SYSTEM_PROMPT = `คุณอ่านเอกสารซื้อของกิจการในประเทศไทย (ใบกำกับภาษี ใบเสร็จรับเงิน ใบแจ้งหนี้ ใบกำกับภาษีอย่างย่อ) จากรูปหรือ PDF แล้วตอบเป็นข้อมูลตามโครงที่กำหนด
ข้อมูลนี้จะถูกเติมเป็นร่างเอกสารซื้อในโปรแกรมบัญชี ผู้ใช้จะตรวจก่อนบันทึก จึงต้องตรงกับที่พิมพ์ในเอกสารจริง ห้ามเดา:
- อ่านไม่ออกหรือไม่มีในเอกสาร ให้ตอบ "" (ข้อความว่าง) และบอกเหตุใน notes (ภาษาไทยสั้น ๆ)
- supplier คือผู้ขาย/ผู้ออกเอกสาร (ไม่ใช่ผู้ซื้อ) · tax_id เลข 13 หลักไม่มีขีด · branch_no 5 หลัก สำนักงานใหญ่ = "00000" · phone เบอร์โทรของผู้ขายตามที่พิมพ์
- buyer คือผู้ซื้อ/ลูกค้าที่บิลออกในนาม (ชื่อ เลขผู้เสียภาษี และเลขสาขา 5 หลักตามที่พิมพ์ — ไม่มี = "")
- doc_date เป็นปี ค.ศ. รูปแบบ YYYY-MM-DD (ปี พ.ศ. ลบ 543 เช่น 15/03/2569 → 2026-03-15)
- จำนวนเงินและจำนวนเป็นตัวเลขทศนิยมแบบข้อความ ไม่มีจุลภาคหรือสกุลเงิน เช่น "1234.50"
- price_type: ราคาในรายการยังไม่รวม VAT = excl_vat · รวม VAT แล้ว = incl_vat · ไม่มี VAT = no_vat · vat_rate เช่น "7"
- lines ตามลำดับในเอกสาร amount คือยอดของบรรทัดตามที่พิมพ์ · subtotal ยอดรวมก่อน VAT · discount ส่วนลดท้ายบิล · vat_amount ภาษีมูลค่าเพิ่ม · total ยอดรวมทั้งสิ้นตามที่พิมพ์
- wht_amount ภาษีหัก ณ ที่จ่ายที่พิมพ์ในเอกสาร (เช่น "หัก ณ ที่จ่าย 3%") เป็นจำนวนเงิน · ไม่มี = ""
- ถ้าไม่ใช่เอกสารซื้อขาย ให้ doc_kind = "other" และอธิบายใน notes`;

/**
 * อ่านกระดาษฝั่งขาย (HANDOFF 171): ใบสั่งซื้อของลูกค้า บิล/ใบส่งของเขียนมือ ใบเสนอราคาที่ลูกค้าส่งกลับ — โครงข้อมูลเดียวกับบิลซื้อ
 * ลูกค้า = buyer (ผู้ออกใบสั่งซื้อ) · supplier = ผู้ขาย (ปกติคือกิจการของผู้ใช้) — ระบบเทียบ supplier กับเลขของบริษัทเอง
 */
export const BILL_SYSTEM_PROMPT_SALES = `คุณอ่านเอกสารฝั่งขายของกิจการในประเทศไทย (ใบสั่งซื้อที่ลูกค้าส่งมา บิล/ใบส่งของ/ใบกำกับที่เขียนด้วยมือ ใบเสนอราคา ใบลด/เพิ่มหนี้) จากรูปหรือ PDF แล้วตอบเป็นข้อมูลตามโครงที่กำหนด
ข้อมูลนี้จะถูกเติมเป็นร่างเอกสารขายในโปรแกรมบัญชี ผู้ใช้จะตรวจก่อนบันทึก จึงต้องตรงกับที่พิมพ์หรือเขียนในเอกสารจริง ห้ามเดา:
- อ่านไม่ออกหรือไม่มีในเอกสาร ให้ตอบ "" (ข้อความว่าง) และบอกเหตุใน notes (ภาษาไทยสั้น ๆ)
- buyer คือลูกค้า/ผู้ซื้อ (ในใบสั่งซื้อของลูกค้า = บริษัทที่ออกใบสั่งซื้อ) · tax_id เลข 13 หลักไม่มีขีด · branch_no 5 หลัก สำนักงานใหญ่ = "00000"
- supplier คือผู้ขาย/ผู้รับใบสั่งซื้อ (ปกติคือกิจการของผู้ใช้ — ไม่มีในเอกสาร = "") · address phone ตามที่พิมพ์
- doc_no คือเลขที่ของเอกสารนี้ (เช่น เลขที่ใบสั่งซื้อของลูกค้า เลขที่บิล)
- doc_date เป็นปี ค.ศ. รูปแบบ YYYY-MM-DD (ปี พ.ศ. ลบ 543 เช่น 15/03/2569 → 2026-03-15)
- จำนวนเงินและจำนวนเป็นตัวเลขทศนิยมแบบข้อความ ไม่มีจุลภาคหรือสกุลเงิน เช่น "1234.50"
- price_type: ราคาในรายการยังไม่รวม VAT = excl_vat · รวม VAT แล้ว = incl_vat · ไม่มี VAT = no_vat · vat_rate เช่น "7"
- lines ตามลำดับในเอกสาร amount คือยอดของบรรทัดตามที่พิมพ์ · subtotal ยอดรวมก่อน VAT · discount ส่วนลดท้ายบิล · vat_amount ภาษีมูลค่าเพิ่ม · total ยอดรวมทั้งสิ้นตามที่พิมพ์
- wht_amount ภาษีหัก ณ ที่จ่ายที่พิมพ์ในเอกสาร เป็นจำนวนเงิน · ไม่มี = ""
- ถ้าไม่ใช่เอกสารซื้อขาย ให้ doc_kind = "other" และอธิบายใน notes`;

/** คำตอบของ AI ตาม BILL_SCHEMA: ช่องว่าง = "" (ยังรับ null/ไม่มีช่องได้ — normalizeBill ถือว่าเหมือนกัน) */
type Txt = string | null | undefined;
export interface RawBill {
  doc_kind: string; supplier: { name: Txt; tax_id: Txt; branch_no: Txt; address: Txt; phone?: Txt };
  buyer?: { name: Txt; tax_id: Txt; branch_no?: Txt } | null;
  doc_no: Txt; doc_date: Txt; price_type: 'excl_vat' | 'incl_vat' | 'no_vat'; vat_rate: Txt;
  lines: Array<{ description: Txt; qty: Txt; unit: Txt; unit_price: Txt; amount: Txt }>;
  subtotal: Txt; discount: Txt; vat_amount: Txt; wht_amount?: Txt; total: Txt; notes: string[];
}
export interface BillDraft {
  /** tax_id = เลข 13 หลักที่อ่านได้ (ไม่ครบ = null) · tax_id_read = ตัวเลขตามที่อ่านได้ (ใช้เติมแบบฟอร์มเพิ่มผู้จำหน่ายให้ผู้ใช้แก้) */
  doc_kind: string; supplier: { name: string; tax_id: string | null; tax_id_read: string; branch_no: string | null; address: string; phone: string | null };
  /** ผู้ซื้อตามบิล (ตัวเลขตามที่อ่านได้) — เทียบกับเลขของบริษัทด้วย buyerTaxCheck */
  buyer: { name: string; tax_id_read: string; branch_no?: string | null };
  doc_no: string; doc_date: string | null; price_type: '0' | '1' | '2'; vat_rate: string;
  lines: Array<{ description: string; qty: string; unit: string | null; unit_price: string; amount: string }>;
  subtotal: string | null; discount: string | null; vat_amount: string | null; total: string | null;
  /** ภาษีหัก ณ ที่จ่ายตามบิล (HANDOFF 167): ยอด · ฐาน (ยอดก่อน VAT) · อัตรามาตรฐานที่ใกล้ (1 2 3 5 — ห่างเกิน 0.05% = null ให้ผู้ใช้ใส่เอง) */
  wht: { amount: string; base: string; rate: string | null } | null;
  warnings: string[];
}

/** อัตราภาษีหัก ณ ที่จ่ายที่ใช้บ่อย (ร้อยละ) */
export const WHT_STANDARD_RATES = ['1', '2', '3', '5'] as const;
/** อัตราจากยอดภาษี ÷ ฐาน → อัตรามาตรฐานที่ห่างไม่เกิน 0.05 จุด · ไม่ใกล้อัตราใด = null */
export function whtRateOf(amount: MoneyInput, base: MoneyInput): { raw: string; rate: string | null } {
  const b = d(base);
  if (b.lte(0)) return { raw: '', rate: null };
  const raw = d(amount).div(b).times(100);
  const hit = WHT_STANDARD_RATES.find((r) => raw.minus(r).abs().lte(0.05));
  return { raw: raw.toDecimalPlaces(2).toString(), rate: hit ?? null };
}

/** ข้อความจาก AI → ตัดช่องว่าง · "" / null / "null" / "-" = ไม่มี ("") */
const txt = (v: Txt) => { const t = String(v ?? '').trim(); return /^(null|none|n\/a|-+)$/i.test(t) ? '' : t; };
const money = (v: Txt) => { const t = txt(v); if (!t) return null; const x = parseInput(t); return x === null ? null : x; };
const fx = (v: Decimal | null) => (v === null ? null : v.toFixed(2));

/** ตรวจ/แปลงผลจาก AI → ร่างเอกสาร + ข้อสังเกตที่ผู้ใช้ต้องตรวจ (ภาษาไทย) */
export function normalizeBill(raw: RawBill, side: 'sale' | 'purchase' = 'purchase'): BillDraft {
  const w: string[] = [...(raw.notes ?? []).filter(Boolean).map((n) => `AI: ${n}`)];
  if (raw.doc_kind === 'other') w.push('ไม่แน่ใจว่าเป็นเอกสารซื้อขาย — ตรวจแฟ้มที่เลือก');
  if (raw.doc_kind === 'abbreviated_tax_invoice' && side === 'purchase') w.push('เป็นใบกำกับภาษีอย่างย่อ — ใช้ขอคืนภาษีซื้อไม่ได้');
  const taxRead = txt(raw.supplier?.tax_id), tax = taxRead.replace(/\D/g, '');
  if (taxRead && tax.length !== 13 && side === 'purchase') w.push(`เลขผู้เสียภาษีผู้ขาย "${taxRead}" ไม่ครบ 13 หลัก`);
  // ฝั่งขาย (HANDOFF 171): ลูกค้า = ผู้ซื้อในเอกสาร — ตรวจเลขของผู้ซื้อแทน
  const buyerTaxRead = txt(raw.buyer?.tax_id), buyerTax = buyerTaxRead.replace(/\D/g, '');
  if (side === 'sale' && buyerTaxRead && buyerTax.length !== 13) w.push(`เลขผู้เสียภาษีลูกค้า "${buyerTaxRead}" ไม่ครบ 13 หลัก`);
  const buyerBranch = txt(raw.buyer?.branch_no).replace(/\D/g, '');
  const branch = txt(raw.supplier?.branch_no).replace(/\D/g, '');
  const dateRead = txt(raw.doc_date);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateRead) ? dateRead : null;
  if (dateRead && !date) w.push(`วันที่เอกสาร "${dateRead}" อ่านไม่ได้ — ป้อนเอง`);
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
    return { description: txt(l.description).slice(0, 200), qty: qty.toString(), unit: txt(l.unit) || null, unit_price: price ? price.toString() : '', amount: fx(amount) ?? '' };
  });
  if (!lines.length) w.push('ไม่พบรายการสินค้า/บริการ');
  const sub = money(raw.subtotal), disc = money(raw.discount), vat = money(raw.vat_amount), total = money(raw.total);
  const whtAmt = money(raw.wht_amount);
  const wht = whtAmt && whtAmt.gt(0) ? whtAmt : null;
  const sumLines = lines.reduce((s, l) => s.plus(d(l.amount || 0)), d(0));
  // ยอดรวมบรรทัด − ส่วนลด (+ VAT ถ้าราคาไม่รวม VAT) = ยอดรวมทั้งสิ้น · บิลที่หัก ณ ที่จ่าย: ยอดรวมที่พิมพ์เป็นได้ทั้งก่อนหักหรือหลังหัก (HANDOFF 167)
  if (total) {
    const calc = sumLines.minus(disc ?? 0).plus(pt === '2' ? (vat ?? 0) : 0);
    const near = (x: Decimal) => x.minus(total).abs().lte(0.05);
    if (!near(calc) && !(wht && near(calc.minus(wht)))) w.push(`ยอดรายการรวม ${sumLines.toFixed(2)} ไม่สอดคล้องกับยอดรวมทั้งสิ้น ${total.toFixed(2)} ในเอกสาร — ตรวจรายการ/ส่วนลด${wht ? '/ภาษีหัก ณ ที่จ่าย' : ''}`);
  } else w.push('ไม่พบยอดรวมทั้งสิ้นในเอกสาร');
  // ฐานภาษีหัก ณ ที่จ่าย = ยอดก่อน VAT (subtotal · ไม่มี = รายการ − ส่วนลด − VAT ถ้าราคารวม VAT)
  let whtOut: BillDraft['wht'] = null;
  if (wht) {
    const base = sub ?? sumLines.minus(disc ?? 0).minus(pt === '1' ? (vat ?? 0) : 0);
    const r = whtRateOf(wht, base);
    if (!r.rate) w.push(`ภาษีหัก ณ ที่จ่าย ${wht.toFixed(2)} คิดเป็น ${r.raw || '?'}% ของ ${base.toFixed(2)} ไม่ตรงอัตรามาตรฐาน (1 2 3 5%) — ใส่อัตราเองที่แท็บภาษีหัก ณ ที่จ่าย`);
    whtOut = { amount: wht.toFixed(2), base: base.toFixed(2), rate: r.rate };
  }
  if (pt !== '0' && vat && sub && !rate.isZero()) {
    const base = pt === '1' ? sub.minus(vat) : sub;
    if (base.times(rate).div(100).toDecimalPlaces(2).minus(vat).abs().gt(0.05) && sub.times(rate).div(100).toDecimalPlaces(2).minus(vat).abs().gt(0.05)) w.push(`VAT ${vat.toFixed(2)} ไม่เท่ากับ ${rate.toString()}% ของฐาน — ตรวจ`);
  }
  return {
    doc_kind: raw.doc_kind,
    supplier: { name: txt(raw.supplier?.name), tax_id: tax.length === 13 ? tax : null, tax_id_read: tax.slice(0, 20), phone: txt(raw.supplier?.phone).slice(0, 60) || null, branch_no: branch ? branch.padStart(5, '0').slice(-5) : null, address: txt(raw.supplier?.address) },
    buyer: { name: txt(raw.buyer?.name).slice(0, 200), tax_id_read: txt(raw.buyer?.tax_id).replace(/\D/g, '').slice(0, 20), ...(buyerBranch ? { branch_no: buyerBranch.padStart(5, '0').slice(-5) } : {}) },
    doc_no: txt(raw.doc_no).slice(0, 30), doc_date: date, price_type: pt, vat_rate: rate.toString(), lines,
    subtotal: fx(sub), discount: fx(disc), vat_amount: fx(vat), total: fx(total), wht: whtOut, warnings: w,
  };
}

/**
 * แถวภาษีหัก ณ ที่จ่ายของร่างเอกสาร (แท็บภาษีหัก ณ ที่จ่าย — ค่าใช้จ่ายอื่น/ซื้อเงินสด · HANDOFF 167)
 * แบบ ภ.ง.ด. ตามเลขผู้เสียภาษีผู้ขาย · ประเภทเงินได้ตามอัตรา (3% ค่าบริการ 1% ค่าขนส่ง 2% ค่าโฆษณา 5% ค่าเช่า) · ไม่มีอัตรามาตรฐาน = rate ว่างให้ผู้ใช้ใส่
 */
export function billWhtRow(b: Pick<BillDraft, 'wht' | 'supplier'>): { form_type: 'S03' | 'S53'; income_type: string; rate: string; paid_amount: string; tax_amount: string } | null {
  if (!b.wht) return null;
  return {
    form_type: wht50FormOf(null, b.supplier.tax_id) === '3' ? 'S03' : 'S53',
    income_type: WHT_INCOME_TYPES.find((x) => x.rate === b.wht!.rate)?.text ?? 'ค่าบริการ',
    rate: b.wht.rate ?? '', paid_amount: b.wht.base, tax_amount: b.wht.amount,
  };
}

/* ───────── แนะนำการลงบัญชีรายบรรทัด (ใช้ข้อมูลของบริษัทนั้นเท่านั้น) ───────── */

/** ประเภทธุรกิจ — ใช้เป็นบริบทให้ AI แนะนำว่ารายการควรเป็นสินค้าหรือค่าใช้จ่าย */
export const AI_BUSINESS_TYPES: Record<string, string> = {
  trading: 'ซื้อมาขายไป (ของที่ซื้อมาขายต่อ = สินค้า ของใช้ในกิจการ = ค่าใช้จ่าย)',
  service: 'ธุรกิจบริการ (ส่วนใหญ่เป็นค่าใช้จ่าย/ต้นทุนบริการ)',
  manufacturing: 'ผลิต (วัตถุดิบ = สินค้า ค่าแรง/โสหุ้ย = ค่าใช้จ่าย)',
  construction: 'รับเหมาก่อสร้าง (วัสดุเข้างาน/ค่าแรงผู้รับเหมาช่วง)',
  other: 'อื่น ๆ',
};

const norm = (s: string) => s.toLowerCase().replace(/[\s.,\-_/()[\]"'*:;#]+/g, '').normalize('NFC');
const grams = (s: string) => { const t = norm(s); const g = new Map<string, number>(); for (let i = 0; i < t.length - 1; i++) { const k = t.slice(i, i + 2); g.set(k, (g.get(k) ?? 0) + 1); } return { g, n: Math.max(0, t.length - 1), t }; };
/** ความคล้ายของข้อความ 0–1 (Dice ของตัวอักษรคู่ติดกัน — ใช้กับภาษาไทยที่ไม่เว้นวรรคได้) */
export function textSim(a: string | null | undefined, b: string | null | undefined): number {
  if (!a || !b) return 0;
  const A = grams(a), B = grams(b);
  if (!A.t || !B.t) return 0;
  if (A.t === B.t) return 1;
  if (A.n === 0 || B.n === 0) return A.t.includes(B.t) || B.t.includes(A.t) ? 0.5 : 0;
  let both = 0;
  for (const [k, v] of A.g) both += Math.min(v, B.g.get(k) ?? 0);
  return (2 * both) / (A.n + B.n);
}

/** คำตอบของ AI เมื่อแนะนำรหัส (เลือกได้เฉพาะรหัสในรายการที่ให้ไป) */
export const SUGGEST_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['lines'],
  properties: {
    lines: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['index', 'code', 'confidence', 'reason'],
        properties: {
          index: { type: 'integer' }, code: str,   // ไม่มีรหัสที่เหมาะ = ""
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          reason: { type: 'string' },
        },
      },
    },
  },
} as const;

export const SUGGEST_SYSTEM_PROMPT = `คุณช่วยพนักงานบัญชีของกิจการไทยเลือกรหัสสินค้า/รหัสค่าใช้จ่ายให้รายการในบิล (บิลซื้อ หรือเอกสารขาย/รายได้ ตามที่บอกใน "เอกสารที่จะบันทึก") ผลเป็นคำแนะนำที่พนักงานบัญชีจะตรวจและยืนยันเอง
- เลือก code ได้เฉพาะรหัสที่อยู่ใน candidates ของบรรทัดนั้น (หรือ expense_codes) เท่านั้น ถ้าไม่มีรหัสที่เหมาะ ให้ code = "" (ข้อความว่าง) และอธิบาย
- ให้น้ำหนักกับประวัติการลงบัญชีของกิจการ (history: เคยลงรหัสนี้กี่ครั้ง กับผู้จำหน่ายรายนี้หรือไม่) มากที่สุด รองลงมาคือแนวทางของกิจการ (guidance) และประเภทธุรกิจ
- ธุรกิจซื้อมาขายไป: ของที่ซื้อมาเพื่อขาย = รหัสสินค้า · ของใช้สิ้นเปลือง ค่าบริการ ค่าสาธารณูปโภค = รหัสค่าใช้จ่าย
- ทรัพย์สินถาวรราคาสูง (เครื่องจักร คอมพิวเตอร์ ยานพาหนะ) ที่ไม่มีรหัสเหมาะ ให้ code = "" และบอกว่าควรบันทึกเป็นสินทรัพย์
- confidence: high = ตรงกับประวัติหรือชื่อรหัสชัดเจน · medium = น่าจะใช่ · low = เดา
- reason ภาษาไทยสั้น ๆ ไม่เกิน 1 ประโยค`;

/** เอกสารที่จะบันทึก (บอก AI ว่าเลือกรหัสชนิดใดได้) */
const TARGET_TH: Record<'purchase' | 'expense' | 'sale' | 'income', string> = {
  purchase: 'ซื้อเงินเชื่อ/เงินสด (ใช้ได้ทั้งรหัสสินค้าและรหัสค่าใช้จ่าย)',
  expense: 'บันทึกค่าใช้จ่ายอื่น ๆ (ใช้ได้เฉพาะรหัสค่าใช้จ่าย)',
  sale: 'เอกสารขาย ใบสั่งขาย ใบเสนอราคา (เลือกได้เฉพาะรหัสสินค้า/บริการที่ขาย — ไม่มีรหัสค่าใช้จ่าย)',
  income: 'บันทึกรายได้อื่น ๆ (ใช้ได้เฉพาะรหัสรายได้อื่น)',
};
export interface SuggestCandidate { code: string; name: string; kind: 'item' | 'expense'; account?: string | null; history?: number; sameSupplier?: number }
/** ข้อความที่ส่งให้ AI (ข้อมูลของบริษัทนี้เท่านั้น) */
export function suggestPrompt(x: { businessType?: string | null; guidance?: string | null; target: 'purchase' | 'expense' | 'sale' | 'income'; supplierName: string; supplierKnown: boolean;
  lines: Array<{ index: number; description: string; amount: string; candidates: SuggestCandidate[] }>; expenseCodes: SuggestCandidate[] }) {
  const biz = x.businessType ? AI_BUSINESS_TYPES[x.businessType] ?? x.businessType : 'ไม่ระบุ';
  return [
    `ประเภทธุรกิจ: ${biz}`,
    `แนวทางการลงบัญชีของกิจการ (guidance): ${x.guidance?.trim() || '— ไม่มี —'}`,
    `เอกสารที่จะบันทึก: ${TARGET_TH[x.target]}`,
    x.target === 'sale' || x.target === 'income' ? `ลูกค้า: ${x.supplierName || 'ไม่ทราบ'}${x.supplierKnown ? ' (มีในแฟ้มลูกค้า)' : ' (ไม่พบในแฟ้ม)'} — same_supplier = เคยขายรหัสนี้ให้ลูกค้ารายนี้`
      : `ผู้จำหน่าย: ${x.supplierName || 'ไม่ทราบ'}${x.supplierKnown ? ' (มีในแฟ้มผู้จำหน่าย)' : ' (ไม่พบในแฟ้ม)'}`,
    `expense_codes (${x.target === 'income' ? 'รหัสรายได้อื่นทั้งหมดที่ใช้ได้' : x.target === 'sale' ? 'ไม่ใช้ — เอกสารขายเลือกได้เฉพาะ candidates' : 'รหัสค่าใช้จ่ายทั้งหมดที่ใช้ได้'}): ${JSON.stringify(x.expenseCodes.map((c) => ({ code: c.code, name: c.name, account: c.account ?? undefined })))}`,
    `lines: ${JSON.stringify(x.lines.map((l) => ({ index: l.index, description: l.description, amount: l.amount, candidates: l.candidates.map((c) => ({ code: c.code, name: c.name, kind: c.kind, account: c.account ?? undefined, history: c.history || undefined, same_supplier: c.sameSupplier || undefined })) })))}`,
  ].join('\n');
}

/* ───────── เพิ่มผู้จำหน่ายใหม่จากบิลที่อ่าน (เจ้าของ 19/11/2569) ───────── */

/** ข้อความที่อยู่ → 3 บรรทัด (บรรทัดละไม่เกิน max ตัด ณ ช่องว่าง) + รหัสไปรษณีย์ 5 หลักตัวสุดท้าย — ผู้ใช้กด "แยกช่องจากที่อยู่เดิม" ในแบบฟอร์มได้ */
export function addressLines(text: string | null | undefined, max = 100): { address_1: string; address_2: string; address_3: string; zip_code: string } {
  const t0 = String(text ?? '').replace(/\s+/g, ' ').trim();
  const zips = t0.match(/(?:^|\D)(\d{5})(?!\d)/g) ?? [];
  // รหัสไปรษณีย์ท้ายข้อความย้ายไปช่องรหัสไปรษณีย์ (ไม่ให้ซ้ำสองที่)
  const t = t0.replace(/(?:^|\s)\d{5}\s*$/, '').trim();
  const out: string[] = [];
  let rest = t;
  while (rest && out.length < 3) {
    if (rest.length <= max || out.length === 2) { out.push(rest.slice(0, max)); break; }
    const cut = rest.lastIndexOf(' ', max);
    const at = cut > max * 0.4 ? cut : max;
    out.push(rest.slice(0, at).trim()); rest = rest.slice(at).trim();
  }
  return { address_1: out[0] ?? '', address_2: out[1] ?? '', address_3: out[2] ?? '', zip_code: zips.length ? zips[zips.length - 1]!.replace(/\D/g, '') : '' };
}

/** ค่าเริ่มต้นของแบบฟอร์มผู้จำหน่ายจากบิล: ชื่อ เลขผู้เสียภาษี (ตามที่อ่าน ให้ผู้ใช้แก้ถ้าผิด) สาขา (ไม่ระบุ = สำนักงานใหญ่ 00000) ที่อยู่ โทรศัพท์ */
export function supplierFromBill(b: BillDraft) {
  const sp = b.supplier;
  return { name: sp.name.slice(0, 120), tax_id: sp.tax_id ?? sp.tax_id_read ?? '', tax_branch_no: sp.branch_no ?? '00000', phone: (sp.phone ?? '').slice(0, 60), ...addressLines(sp.address) };
}

/**
 * รหัสถัดไปตามแบบที่บริษัทใช้: กลุ่มรหัส "ตัวนำ + ตัวเลข" ที่มีมากที่สุด (เท่ากัน = กลุ่มที่เลขมากสุด) → เลขมากสุด + 1 เติมศูนย์ให้ยาวเท่าเดิม
 * ไม่มีรหัสแบบนี้ = ใช้ fallback (ผู้ใช้แก้ได้เสมอ)
 */
export function nextCode(codes: Array<string | null | undefined>, fallback = ''): string {
  const g = new Map<string, { n: number; max: number; width: number; prefix: string }>();
  for (const c of codes) {
    const m = String(c ?? '').trim().match(/^(.*?)(\d+)$/);
    if (!m) continue;
    const key = `${m[1]}#${m[2]!.length}`;
    const x = g.get(key) ?? { n: 0, max: 0, width: m[2]!.length, prefix: m[1]! };
    x.n++; x.max = Math.max(x.max, Number(m[2])); g.set(key, x);
  }
  const best = [...g.values()].sort((p, q) => q.n - p.n || q.max - p.max)[0];
  if (!best) return fallback;
  return best.prefix + String(best.max + 1).padStart(best.width, '0');
}

/* ───────── เลขผู้เสียภาษีของผู้ซื้อ = เลขของบริษัทที่นำเข้าบิล (เจ้าของ 19/11/2569) ───────── */

/** ระยะแก้ไข (Levenshtein) ระหว่างตัวเลขสองชุด — ใช้แยก "OCR อ่านเพี้ยน" จาก "เลขของผู้อื่น" */
export function digitDistance(a: string, b: string): number {
  const x = a.replace(/\D/g, ''), y = b.replace(/\D/g, '');
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[y.length]!;
}

export type BuyerCheck = { status: 'none' | 'same' | 'misread' | 'other' | 'unclear'; shown: string | null; message: string | null };
/**
 * ผู้ซื้อในบิลต้องเป็นบริษัทนี้: ตรงกัน หรืออ่านเพี้ยนเล็กน้อย (ต่างไม่เกิน 2 หลัก เช่นขาด 1 หลัก) = แสดงเลขของบริษัท ไม่เตือน
 * เป็นเลข 13 หลักที่ถูกต้องแต่ต่างชัดเจน = "บิลนี้ออกในนามผู้อื่น" · อ่านไม่ชัดและต่างมาก = ให้ตรวจ · บิลไม่มีเลขผู้ซื้อ = ไม่ตรวจ
 */
export function buyerTaxCheck(read: string | null | undefined, companyTaxId: string | null | undefined): BuyerCheck {
  const r = String(read ?? '').replace(/\D/g, ''), c = String(companyTaxId ?? '').replace(/\D/g, '');
  if (!r || !c) return { status: 'none', shown: c || null, message: null };
  if (r === c) return { status: 'same', shown: c, message: null };
  if (digitDistance(r, c) <= 2) return { status: 'misread', shown: c, message: null };
  if (r.length === 13 && checkTaxId(r).ok) return { status: 'other', shown: r, message: `บิลนี้ออกในนามผู้อื่น — เลขผู้ซื้อในบิล ${r} ไม่ใช่เลขของบริษัท (${c}) ตรวจก่อนใช้ขอคืนภาษีซื้อ` };
  return { status: 'unclear', shown: r, message: `อ่านเลขผู้ซื้อในบิลได้ ${r} ไม่ตรงกับเลขของบริษัท (${c}) — ตรวจว่าบิลออกในนามบริษัท` };
}

/* ───────── VAT รวมเป็นค่าใช้จ่าย (บริษัทไม่จด VAT / บิลเจ้าหนี้กลาง — เจ้าของ 19/11/2569) ───────── */

/**
 * บรรทัดบิลแบบ "ไม่มี VAT" ที่ยอดรวมเท่ายอดรวมทั้งสิ้นของบิล: ราคารวม VAT (1) ใช้ตามเดิม · แยก VAT (2) กระจาย VAT ตามสัดส่วนยอดบรรทัด
 * (ใช้ VAT ตามบิลถ้ามี ไม่มีใช้อัตรา) เศษสตางค์ไปบรรทัดสุดท้าย · ราคาต่อหน่วยคำนวณใหม่ (4 ตำแหน่ง)
 */
export function billAsExpense(b: Pick<BillDraft, 'price_type' | 'vat_rate' | 'vat_amount' | 'lines'>): BillDraft['lines'] {
  if (b.price_type !== '2') return b.lines.map((l) => ({ ...l }));
  const amt = (l: BillDraft['lines'][number]) => d(l.amount || 0);
  const sum = b.lines.reduce((t, l) => t.plus(amt(l)), d(0));
  const vat = b.vat_amount ? d(b.vat_amount) : sum.times(d(b.vat_rate || 0)).div(100).toDecimalPlaces(2);
  let left = vat;
  return b.lines.map((l, i) => {
    const share = i === b.lines.length - 1 ? left : sum.isZero() ? d(0) : vat.times(amt(l)).div(sum).toDecimalPlaces(2);
    left = left.minus(share);
    const gross = amt(l).plus(share);
    const q = d(l.qty || 1);
    return { ...l, amount: gross.toFixed(2), unit_price: (q.isZero() ? gross : gross.div(q)).toDecimalPlaces(4).toString() };
  });
}
