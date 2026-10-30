/**
 * คำนวณยอดเอกสารซื้อ/ขาย (คู่มือบทที่ 11–12 แนวคิดร่วม) — ตรงกับวิธีเก็บของ Express
 * ประเภทราคา: 0 ยกเว้นภาษี · 1 ราคารวมภาษี (VAT = ฐาน × r/(100+r)) · 2 ราคาไม่รวมภาษี (VAT = ฐาน × r/100)
 * ส่วนลด: จำนวนเงิน (1500) · เปอร์เซ็นต์ (10% หรือ 10+) · ส่วนลดซ้อน (5+2% = ลด 5% แล้วลดต่ออีก 2%) · คั่นด้วย , (5+,200) — ดู discountAmount
 * บรรทัด: line_amount = จำนวน × ราคา − ส่วนลดบรรทัด (ตามประเภทราคาของเอกสาร)
 *         net_amount = ยอดไม่รวม VAT หลังเฉลี่ยส่วนลดท้ายบิล (เครื่องลงบัญชีใช้ยอดนี้ลงบัญชีขาย/ซื้อ)
 */
import { d, Decimal, type MoneyInput } from './money.js';

const r2 = (v: Decimal) => v.toDecimalPlaces(2);

/** "10+" → "10%" แบบ Express (ทุกช่วงที่คั่นด้วย ,) · ช่องว่างตัดทิ้ง */
export function normalizeDiscount(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, '').split(',').map((t) => (/^[\d.+]+\+$/.test(t) ? t.slice(0, -1) + '%' : t)).join(',');
}

/**
 * ส่วนลดเป็นจำนวนเงินจากข้อความ — null = รูปแบบไม่ถูกต้อง (ข้อกำหนดเจ้าของ 30/10/2569)
 * - 200 = ลด 200 บาท · 5% หรือ 5+ = ลด 5% (+ ท้ายตัวเลข = % คีย์ง่ายกว่า)
 * - 5+2% หรือ 5+2+ = ลด 5% แล้วลดต่ออีก 2% (ส่วนลดซ้อนแบบ Express)
 * - คั่นด้วย , = ลดต่อกันตามลำดับ เช่น 5+,200 = ลด 5% แล้วลดเพิ่มอีก 200 บาท
 * - +5 (เครื่องหมายนำหน้า) หรือ 5+2 (ไม่มี % / + ปิดท้าย) = ไม่ถูกรูปแบบ
 */
export function discountAmount(text: string | null | undefined, base: MoneyInput): Decimal | null {
  const t = normalizeDiscount(text);
  if (!t) return d(0);
  const b = d(base);
  let rest = b;
  for (const part of t.split(',')) {
    if (part.endsWith('%')) {
      const ps = part.slice(0, -1).split('+');
      if (ps.some((x) => !/^\d+(\.\d+)?$/.test(x))) return null;
      for (const x of ps) rest = rest.minus(r2(rest.times(d(x)).div(100)));
    } else if (/^\d+(\.\d+)?$/.test(part)) rest = rest.minus(r2(d(part)));
    else return null;
  }
  return b.minus(rest);
}

/** ข้อความแนะนำเมื่อส่วนลดไม่ถูกรูปแบบ */
export const DISCOUNT_HINT = 'เช่น 200 (บาท) · 5% หรือ 5+ (เปอร์เซ็นต์) · 5+2+ (5% แล้วอีก 2%) · 5+,200 (5% แล้วลดอีก 200 บาท)';

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
    if (disc === null) errors.push(`บรรทัดที่ ${i + 1}: ส่วนลด "${l.discount_text}" ไม่ถูกรูปแบบ (${DISCOUNT_HINT})`);
    const dd = disc ?? d(0);
    if (dd.gt(gross.abs())) errors.push(`บรรทัดที่ ${i + 1}: ส่วนลดมากกว่าจำนวนเงิน`);
    return { gross, disc: dd, amount: gross.minus(dd), exempt: !!l.vat_exempt };
  });
  const amount = lines.reduce((s, l) => s.plus(l.amount), d(0));
  const hd = discountAmount(input.discount_text, amount);
  if (hd === null) errors.push(`ส่วนลดท้ายบิล "${input.discount_text}" ไม่ถูกรูปแบบ (${DISCOUNT_HINT})`);
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
export interface TradeKind {
  path: string; cls: string; module: 'AR' | 'AP'; menu: string; party: 'customer' | 'supplier'; label: string; payments?: boolean; refInvoice?: boolean; route: string;
  /** ใบเสนอราคา/ใบสั่งขาย/ใบสั่งซื้อ: ไม่ลงบัญชี ไม่ตั้งหนี้ — หัวเอกสารเก็บระบบ SO/PO ตาม Express */
  order?: 'SO' | 'PO';
  /** บิลที่อ้างรายการจากใบสั่งขาย (SO) / ใบสั่งซื้อ (PO) ได้ (คู่มือ S-IV-02..04, S-PU-03a) */
  orderRef?: 'SO' | 'PO';
}
export const TRADE_KINDS: TradeKind[] = [
  { path: 'sales-invoices', cls: 'IV', module: 'AR', menu: 'SA.IV', party: 'customer', label: 'ขายเงินเชื่อ', route: '/sa/invoices', orderRef: 'SO' },
  { path: 'cash-sales', cls: 'HS', module: 'AR', menu: 'SA.IV', party: 'customer', label: 'ขายเงินสด', payments: true, route: '/sa/cash-sales', orderRef: 'SO' },
  { path: 'ar-debit-notes', cls: 'DR', module: 'AR', menu: 'FI.AR.DR', party: 'customer', label: 'ใบเพิ่มหนี้ (ลูกหนี้)', refInvoice: true, route: '/fi/ar/debit-notes' },
  { path: 'ar-credit-notes', cls: 'CN', module: 'AR', menu: 'FI.AR.SR', party: 'customer', label: 'ใบลดหนี้/รับคืนสินค้า', refInvoice: true, route: '/fi/ar/credit-notes' },
  { path: 'purchase-invoices', cls: 'RR', module: 'AP', menu: 'PU.RR', party: 'supplier', label: 'ซื้อเงินเชื่อ', route: '/pu/invoices', orderRef: 'PO' },
  { path: 'cash-purchases', cls: 'HP', module: 'AP', menu: 'PU.RR', party: 'supplier', label: 'ซื้อเงินสด', payments: true, route: '/pu/cash-purchases', orderRef: 'PO' },
  { path: 'ap-debit-notes', cls: 'CP', module: 'AP', menu: 'FI.AP.CP', party: 'supplier', label: 'ใบเพิ่มหนี้ (เจ้าหนี้)', refInvoice: true, route: '/fi/ap/debit-notes' },
  { path: 'ap-credit-notes', cls: 'DN', module: 'AP', menu: 'FI.AP.GR', party: 'supplier', label: 'ใบลดหนี้/ส่งคืนสินค้า', refInvoice: true, route: '/fi/ap/credit-notes' },
  { path: 'quotations', cls: 'QT', module: 'AR', menu: 'SA.QT', party: 'customer', label: 'ใบเสนอราคา', order: 'SO', route: '/sa/quotations' },
  { path: 'sales-orders', cls: 'SO', module: 'AR', menu: 'SA.SO', party: 'customer', label: 'ใบสั่งขาย', order: 'SO', route: '/sa/orders' },
  { path: 'purchase-orders', cls: 'PO', module: 'AP', menu: 'PU.PO', party: 'supplier', label: 'ใบสั่งซื้อ', order: 'PO', route: '/pu/orders' },
];

/** ใบเสร็จรับเงิน RE (คู่มือบทที่ 12 S-RE-01) / ใบสำคัญจ่าย PS (บทที่ 11 S-PU-07): ตัดบิลค้างได้หลายใบ ใบลดหนี้ (neg) นำมาหักเป็นยอดลบ */
export interface SettleKind {
  path: string; cls: 'RE' | 'PS'; module: 'AR' | 'AP'; menu: string; party: 'customer' | 'supplier'; label: string; route: string;
  /** หมวดบิลที่ตัดได้ → รหัสรายการตัด (express_rectype: 3 บิล 4 เพิ่มหนี้ 5 ลดหนี้) */
  open: Record<string, '3' | '4' | '5'>; neg: string; direction: 'R' | 'P';
}
export const SETTLE_KINDS: SettleKind[] = [
  { path: 'ar-receipts', cls: 'RE', module: 'AR', menu: 'FI.AR.RE', party: 'customer', label: 'รับชำระหนี้', route: '/fi/ar/receipts', open: { IV: '3', DR: '4', CN: '5' }, neg: 'CN', direction: 'R' },
  { path: 'ap-payments', cls: 'PS', module: 'AP', menu: 'FI.AP.PS', party: 'supplier', label: 'จ่ายชำระหนี้', route: '/fi/ap/payments', open: { RR: '3', CP: '4', DN: '5' }, neg: 'DN', direction: 'P' },
];

/**
 * เอกสารรับ/จ่ายเงินทันที (ไม่ตั้งลูกหนี้/เจ้าหนี้): มัดจำรับ AI (S-AI-01) มัดจำจ่าย AE (S-PU-02) รายได้อื่น OI (S-OI-01) ค่าใช้จ่ายอื่น OE (S-PU-08)
 * lines: text = คำอธิบาย + จำนวนเงิน (มัดจำ) · code = รหัสรายได้/ค่าใช้จ่าย (item_type) · whtEntries = ป้อนรายละเอียดภาษีหัก ณ ที่จ่ายเข้าแฟ้ม ภ.ง.ด.
 */
export interface CashKind {
  path: string; cls: 'AI' | 'AE' | 'OI' | 'OE'; module: 'AR' | 'AP'; menu: string; party: 'customer' | 'supplier'; partyRequired: boolean; label: string; route: string;
  lines: 'text' | 'code'; itemType?: '4' | '5'; direction: 'R' | 'P'; whtEntries: boolean; deposit: boolean;
}
export const CASH_KINDS: CashKind[] = [
  { path: 'ar-deposits', cls: 'AI', module: 'AR', menu: 'SA.AI', party: 'customer', partyRequired: true, label: 'รับเงินมัดจำ', route: '/sa/deposits', lines: 'text', direction: 'R', whtEntries: false, deposit: true },
  { path: 'other-income-docs', cls: 'OI', module: 'AR', menu: 'SA.OI', party: 'customer', partyRequired: false, label: 'บันทึกรายได้อื่น ๆ', route: '/sa/other-income', lines: 'code', itemType: '4', direction: 'R', whtEntries: false, deposit: false },
  { path: 'ap-deposits', cls: 'AE', module: 'AP', menu: 'PU.AE', party: 'supplier', partyRequired: true, label: 'จ่ายเงินมัดจำ', route: '/pu/deposits', lines: 'text', direction: 'P', whtEntries: true, deposit: true },
  { path: 'other-expense-docs', cls: 'OE', module: 'AP', menu: 'PU.OE', party: 'supplier', partyRequired: false, label: 'บันทึกค่าใช้จ่ายอื่น ๆ', route: '/pu/other-expense', lines: 'code', itemType: '5', direction: 'P', whtEntries: true, deposit: false },
];

/** ใบวางบิล BS (คู่มือ S-BI-01) / ใบรับวางบิล BR (S-PU-06): รวมบิลค้างของคู่ค้าเพื่อนัดรับ/จ่ายเงิน — ไม่ลงบัญชี */
export interface BillKind { path: string; cls: 'BS' | 'BR'; module: 'AR' | 'AP'; menu: string; party: 'customer' | 'supplier'; label: string; route: string; open: string[] }
export const BILL_KINDS: BillKind[] = [
  { path: 'ar-bills', cls: 'BS', module: 'AR', menu: 'FI.AR.BI', party: 'customer', label: 'ใบวางบิล', route: '/fi/ar/bills', open: ['IV', 'DR', 'CN'] },
  { path: 'ap-bills', cls: 'BR', module: 'AP', menu: 'FI.AP.BR', party: 'supplier', label: 'ใบรับวางบิล', route: '/fi/ap/bills', open: ['RR', 'CP', 'DN'] },
];


/**
 * ต้นทุนสินค้าที่จ่ายออก (บทที่ 14 · ตั้งต้นที่กลุ่มบัญชีสินค้า): คำนวณสดจากประวัติความเคลื่อนไหว ไม่เก็บล็อตสะสม
 * ถัวเฉลี่ย = มูลค่าคงเหลือ ÷ จำนวนคงเหลือ · FIFO = ตัดจากรับเข้าเก่าสุด ต่อจากจำนวนที่จ่ายไปก่อนหน้า
 * ยอดไม่พอ (ติดลบ/ไม่มีรับเข้า) ใช้ต้นทุนหน่วยล่าสุดที่รู้ หรือ fallback (เช่น ราคาทุนมาตรฐาน)
 */
export function averageCost(balanceQty: MoneyInput, balanceValue: MoneyInput, qty: MoneyInput, fallbackUnit: MoneyInput = 0): string {
  const q = d(balanceQty);
  const unit = q.gt(0) ? d(balanceValue).div(q) : d(fallbackUnit);
  return unit.times(d(qty)).toDecimalPlaces(2).toFixed(2);
}
export function fifoCost(receipts: Array<{ qty: MoneyInput; value: MoneyInput }>, issuedBefore: MoneyInput, qty: MoneyInput, fallbackUnit: MoneyInput = 0): string {
  let start = d(issuedBefore), need = d(qty), cost = d(0), pos = d(0), lastUnit = d(fallbackUnit);
  for (const r of receipts) {
    const rq = d(r.qty);
    if (rq.lte(0)) continue;
    const unit = d(r.value).div(rq);
    lastUnit = unit;
    const end = pos.plus(rq);
    if (need.gt(0) && end.gt(start)) {
      const take = Decimal.min(end.minus(Decimal.max(start, pos)), need);
      cost = cost.plus(take.times(unit)); need = need.minus(take); start = start.plus(take);
    }
    pos = end;
  }
  if (need.gt(0)) cost = cost.plus(need.times(lastUnit));
  return cost.toDecimalPlaces(2).toFixed(2);
}

/** เอกสารสินค้า (คู่มือบทที่ 14): จ่ายใช้ภายใน OU · โอนย้ายระหว่างคลัง RL · ปรับปรุงเพิ่ม/ลด JU · เพิ่ม/ลดต้นทุน CA */
/** เอกสารธนาคาร (คู่มือบทที่ 13 S-BK-02/03 + รายได้/ค่าใช้จ่ายธนาคาร) — ยอดเงินฝากคำนวณสดจากใบสำคัญของบัญชีเงินฝาก */
export interface BankKind { path: string; cls: 'BD' | 'BW' | 'BT' | 'BU' | 'BV'; label: string; route: string; short: string }
export const BANK_KINDS: BankKind[] = [
  { path: 'bank-deposits', cls: 'BD', label: 'ฝากเงินสด', short: 'ฝาก', route: '/fi/bank/deposits' },
  { path: 'bank-withdrawals', cls: 'BW', label: 'ถอนเงินสด', short: 'ถอน', route: '/fi/bank/withdrawals' },
  { path: 'bank-transfers', cls: 'BT', label: 'โอนเงินระหว่างบัญชี', short: 'โอน', route: '/fi/bank/transfers' },
  { path: 'bank-incomes', cls: 'BU', label: 'รายได้ธนาคาร (ดอกเบี้ยรับ)', short: 'รายได้', route: '/fi/bank/incomes' },
  { path: 'bank-expenses', cls: 'BV', label: 'ค่าใช้จ่ายธนาคาร (ค่าธรรมเนียม/ดอกเบี้ยจ่าย)', short: 'ค่าใช้จ่าย', route: '/fi/bank/expenses' },
];
export interface StockKind { path: string; cls: 'OU' | 'RL' | 'JU' | 'CA'; label: string; route: string }
export const STOCK_KINDS: StockKind[] = [
  { path: 'stock-issues', cls: 'OU', label: 'จ่ายสินค้าใช้ภายใน', route: '/ic/issues' },
  { path: 'stock-transfers', cls: 'RL', label: 'โอนย้ายระหว่างคลัง', route: '/ic/transfers' },
  { path: 'stock-adjustments', cls: 'JU', label: 'ปรับปรุงเพิ่ม/ลดสินค้า', route: '/ic/adjustments' },
  { path: 'cost-adjustments', cls: 'CA', label: 'เพิ่ม/ลดต้นทุนสินค้า', route: '/ic/cost-adjustments' },
];
