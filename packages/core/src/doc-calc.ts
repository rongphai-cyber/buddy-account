/**
 * คำนวณยอดเอกสารซื้อ/ขาย (คู่มือบทที่ 11–12 แนวคิดร่วม) — ตรงกับวิธีเก็บของ Express
 * ประเภทราคา: 0 ยกเว้นภาษี · 1 ราคารวมภาษี (VAT = ฐาน × r/(100+r)) · 2 ราคาไม่รวมภาษี (VAT = ฐาน × r/100)
 * ส่วนลด: จำนวนเงิน (1500) · เปอร์เซ็นต์ (10%) · ส่วนลดซ้อน (5+2% = ลด 5% แล้วลดต่ออีก 2%) · "10+" = 10%
 * บรรทัด: line_amount = จำนวน × ราคา − ส่วนลดบรรทัด (ตามประเภทราคาของเอกสาร)
 *         net_amount = ยอดไม่รวม VAT หลังเฉลี่ยส่วนลดท้ายบิล (เครื่องลงบัญชีใช้ยอดนี้ลงบัญชีขาย/ซื้อ)
 */
import { d, type Decimal, type MoneyInput } from './money.js';

const r2 = (v: Decimal) => v.toDecimalPlaces(2);

/** "10+" → "10%" แบบ Express · ช่องว่างตัดทิ้ง */
export function normalizeDiscount(text: string | null | undefined): string {
  const t = (text ?? '').replace(/\s+/g, '');
  return /^[\d.]+\+$/.test(t) ? t.slice(0, -1) + '%' : t;
}

/** ส่วนลดเป็นจำนวนเงินจากข้อความ — null = รูปแบบไม่ถูกต้อง */
export function discountAmount(text: string | null | undefined, base: MoneyInput): Decimal | null {
  const t = normalizeDiscount(text);
  if (!t) return d(0);
  const b = d(base);
  if (t.endsWith('%')) {
    const parts = t.slice(0, -1).split('+');
    if (parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
    let rest = b;
    for (const p of parts) rest = rest.minus(r2(rest.times(d(p)).div(100)));
    return b.minus(rest);
  }
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return r2(d(t));
}

export interface CalcLine { qty: MoneyInput; unit_price: MoneyInput; discount_text?: string | null; vat_exempt?: boolean }
export interface CalcInput { price_type: '0' | '1' | '2'; vat_rate: MoneyInput; lines: CalcLine[]; discount_text?: string | null; deposit_amount?: MoneyInput }
export interface CalcResult {
  lines: Array<{ gross: string; discount_amount: string; line_amount: string; net_amount: string }>;
  amount: string; discount_amount: string; amount_after_discount: string; deposit_amount: string;
  zero_rate_amount: string; taxable_amount: string; vat_amount: string; net_amount: string;
  errors: string[];
}

/** แบ่งยอดตามสัดส่วนน้ำหนัก ปัดเศษให้ผลรวมตรง (ส่วนต่างไปบรรทัดที่มียอดมากสุด) */
function allocate(total: Decimal, weights: Decimal[]): Decimal[] {
  const sum = weights.reduce((s, w) => s.plus(w), d(0));
  if (sum.isZero()) return weights.map((_, i) => (i === 0 ? total : d(0)));
  const out = weights.map((w) => r2(total.times(w).div(sum)));
  const diff = total.minus(out.reduce((s, v) => s.plus(v), d(0)));
  if (!diff.isZero()) { let k = 0; weights.forEach((w, i) => { if (w.abs().gt(weights[k]!.abs())) k = i; }); out[k] = out[k]!.plus(diff); }
  return out;
}

export function computeDoc(input: CalcInput): CalcResult {
  const errors: string[] = [];
  const rate = d(input.vat_rate ?? 0);
  const pt = input.price_type;
  const lines = input.lines.map((l, i) => {
    const gross = r2(d(l.qty).times(d(l.unit_price)));
    const disc = discountAmount(l.discount_text, gross);
    if (disc === null) errors.push(`บรรทัดที่ ${i + 1}: ส่วนลด "${l.discount_text}" ไม่ถูกรูปแบบ (เช่น 1500 หรือ 10% หรือ 5+2%)`);
    const dd = disc ?? d(0);
    if (dd.gt(gross.abs())) errors.push(`บรรทัดที่ ${i + 1}: ส่วนลดมากกว่าจำนวนเงิน`);
    return { gross, disc: dd, amount: gross.minus(dd), exempt: !!l.vat_exempt };
  });
  const amount = lines.reduce((s, l) => s.plus(l.amount), d(0));
  const hd = discountAmount(input.discount_text, amount);
  if (hd === null) errors.push(`ส่วนลดท้ายบิล "${input.discount_text}" ไม่ถูกรูปแบบ (เช่น 1500 หรือ 10% หรือ 5+2%)`);
  const hdisc = hd ?? d(0);
  const after = amount.minus(hdisc);
  const deposit = d(input.deposit_amount ?? 0);
  if (deposit.gt(after)) errors.push('ยอดหักเงินมัดจำมากกว่ายอดหลังหักส่วนลด');
  const base = after.minus(deposit);
  // แยกฐานสินค้ายกเว้นภาษี (แยกประเภท VAT ที่รายการ) ตามสัดส่วนยอดบรรทัด
  const exemptShare = amount.isZero() ? d(0) : lines.filter((l) => l.exempt).reduce((s, l) => s.plus(l.amount), d(0)).div(amount);
  const zeroBase = pt === '0' ? base : r2(base.times(exemptShare));
  const vatBase = base.minus(zeroBase);
  const vat = pt === '0' || rate.isZero() ? d(0) : pt === '1' ? r2(vatBase.times(rate).div(rate.plus(100))) : r2(vatBase.times(rate).div(100));
  const net = pt === '2' ? base.plus(vat) : base;
  // ยอดบรรทัดไม่รวม VAT: (ยอดสุทธิ − VAT) + มัดจำส่วนที่ไม่รวม VAT → เฉลี่ยตามยอดบรรทัด
  const depositExVat = pt === '1' && !rate.isZero() ? r2(deposit.times(100).div(rate.plus(100))) : deposit;
  const lineNet = allocate(net.minus(vat).plus(depositExVat), lines.map((l) => l.amount));
  return {
    lines: lines.map((l, i) => ({ gross: l.gross.toFixed(2), discount_amount: l.disc.toFixed(2), line_amount: l.amount.toFixed(2), net_amount: lineNet[i]!.toFixed(2) })),
    amount: amount.toFixed(2), discount_amount: hdisc.toFixed(2), amount_after_discount: after.toFixed(2), deposit_amount: deposit.toFixed(2),
    zero_rate_amount: zeroBase.toFixed(2), taxable_amount: vatBase.toFixed(2), vat_amount: vat.toFixed(2), net_amount: net.toFixed(2), errors,
  };
}

/** วันครบกำหนด = วันที่เอกสาร + เครดิต (วัน) */
export function dueDate(docDate: string, creditDays: number | null | undefined): string {
  const t = new Date(`${docDate}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + (creditDays ?? 0));
  return t.toISOString().slice(0, 10);
}

/** เอกสารซื้อ/ขาย (ใช้โครงเดียวกัน) — เส้นทาง API/หน้าจอ, หมวดเอกสาร, เมนูสิทธิ์ */
export interface TradeKind { path: string; cls: string; module: 'AR' | 'AP'; menu: string; party: 'customer' | 'supplier'; label: string; payments?: boolean; refInvoice?: boolean; route: string }
export const TRADE_KINDS: TradeKind[] = [
  { path: 'sales-invoices', cls: 'IV', module: 'AR', menu: 'SA.IV', party: 'customer', label: 'ขายเงินเชื่อ', route: '/sa/invoices' },
  { path: 'cash-sales', cls: 'HS', module: 'AR', menu: 'SA.IV', party: 'customer', label: 'ขายเงินสด', payments: true, route: '/sa/cash-sales' },
  { path: 'ar-debit-notes', cls: 'DR', module: 'AR', menu: 'FI.AR.DR', party: 'customer', label: 'ใบเพิ่มหนี้ (ลูกหนี้)', refInvoice: true, route: '/fi/ar/debit-notes' },
  { path: 'ar-credit-notes', cls: 'CN', module: 'AR', menu: 'FI.AR.SR', party: 'customer', label: 'ใบลดหนี้/รับคืนสินค้า', refInvoice: true, route: '/fi/ar/credit-notes' },
  { path: 'purchase-invoices', cls: 'RR', module: 'AP', menu: 'PU.RR', party: 'supplier', label: 'ซื้อเงินเชื่อ', route: '/pu/invoices' },
  { path: 'cash-purchases', cls: 'HP', module: 'AP', menu: 'PU.RR', party: 'supplier', label: 'ซื้อเงินสด', payments: true, route: '/pu/cash-purchases' },
  { path: 'ap-debit-notes', cls: 'CP', module: 'AP', menu: 'FI.AP.CP', party: 'supplier', label: 'ใบเพิ่มหนี้ (เจ้าหนี้)', refInvoice: true, route: '/fi/ap/debit-notes' },
  { path: 'ap-credit-notes', cls: 'DN', module: 'AP', menu: 'FI.AP.GR', party: 'supplier', label: 'ใบลดหนี้/ส่งคืนสินค้า', refInvoice: true, route: '/fi/ap/credit-notes' },
];
