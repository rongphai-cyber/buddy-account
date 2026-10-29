/**
 * เครื่องลงบัญชีอัตโนมัติ (คู่มือบทที่ 10) — สร้างรายการ Dr/Cr จากเอกสาร
 * ลำดับการหาบัญชี: 1 บัญชีที่ประเภทเอกสาร → 2 แฟ้มหลัก (ลูกค้า ผู้จำหน่าย กลุ่มบัญชีสินค้า วิธีชำระ เช็ค) → 3 บัญชีเพื่อลงรายวัน → หาไม่ได้ = บัญชีพัก
 * พอร์ตจากต้นแบบ tools/express-import/posting_engine.py (ตรงใบสำคัญ Express 97.0% ของ 15,382 ใบ) — แก้ตรรกะต้องแก้ทั้งสองที่ หรือเลิกใช้ต้นแบบ
 * ฟังก์ชันบริสุทธิ์: ไม่แตะฐานข้อมูล ตัวหาบัญชี (PostingResolver) มาจาก server
 */
import { d, type Decimal, type MoneyInput } from './money.js';

export interface PostHeader {
  id: string; doc_class: string; doc_type_id: string | null; customer_id: string | null; supplier_id: string | null;
  net_amount: MoneyInput; vat_amount: MoneyInput; deposit_amount: MoneyInput; vat_basis: string | null;
  /** ใบเสร็จ/ใบจ่าย: ภาษีหัก ณ ที่จ่าย ส่วนลดเงินสด ดอกเบี้ย (ผลต่างระหว่างยอดตัดหนี้กับเงินที่รับ/จ่ายจริง) */
  wht_amount?: MoneyInput; cash_discount_amount?: MoneyInput; interest_amount?: MoneyInput;
}
/** บรรทัดสินค้า (item_id) หรือบรรทัดบัญชี (account_id — เงินสดย่อย) */
export interface PostLine { item_id: string | null; net_amount: MoneyInput; account_id?: string | null }
export interface PostPayment { method_id: string | null; amount: MoneyInput; cheque_id: string | null }
/** รายการตัดหนี้ในใบเสร็จ/ใบจ่าย · rectype '0' = ตัดเงินมัดจำ (ลงผ่านวิธีชำระ) · '5' = ใบลดหนี้ที่นำมาหัก (ยอดลบ) */
export interface PostSettlement { amount: MoneyInput; vat: MoneyInput; party_id: string | null; rectype: string | null }
export interface ItemGroup { inv: string | null; cogs: string | null; sales: string | null; sret: string | null; pur: string | null; pret: string | null }

export interface PostingResolver {
  /** ชั้น 1: บัญชีที่ประเภทเอกสาร ตามบทบาทของช่อง (DOC_SLOT_ROLES) */
  slot(docTypeId: string | null, docClass: string, role: string): string | null;
  customer(id: string | null): string | null;
  supplier(id: string | null): string | null;
  item(id: string): { type: string | null; group: Partial<ItemGroup> };
  paymentMethod(id: string | null): string | null;
  cheque(id: string | null): string | null;
  /** ชั้น 3: บัญชีเพื่อลงรายวัน (gl_default_account) */
  def(role: string): string | null;
  /** บันทึกบัญชีสินค้าแบบ Perpetual (ค่าเริ่มต้นระบบสินค้า ข้อ 4) */
  perpetual: boolean;
}
export type Layer = '1' | '2' | '3' | 'S';
export interface PostingLine { account_id: string | null; debit: Decimal; credit: Decimal; role: string; layer: Layer }

/** หมวดเอกสารที่ลงบัญชีด้วยเครื่องนี้ */
export const POSTING_CLASSES = ['IV', 'DR', 'HS', 'CN', 'RR', 'CP', 'HP', 'DN', 'RE', 'PS', 'AI', 'AE', 'OE', 'OI', 'VR'] as const;

export function buildPosting(h: PostHeader, lines: PostLine[], pays: PostPayment[], setts: PostSettlement[], r: PostingResolver): PostingLine[] {
  const out: PostingLine[] = [];
  type Acct = [string | null, Layer];
  const pick = (...c: Array<[Layer, string | null | undefined]>): Acct => {
    for (const [layer, a] of c) if (a) return [a, layer];
    return [r.def('SUSPENSE'), 'S'];
  };
  const D = (acct: Acct, amt: Decimal, role: string) => {
    if (amt.isZero()) return;
    out.push({ account_id: acct[0], debit: amt.gt(0) ? amt : d(0), credit: amt.gt(0) ? d(0) : amt.neg(), role, layer: acct[1] });
  };
  const C = (acct: Acct, amt: Decimal, role: string) => D(acct, amt.neg(), role);
  const cls = h.doc_class, dt = h.doc_type_id;
  const net = d(h.net_amount), vat = d(h.vat_amount);
  const vatRole = (base: string) => (h.vat_basis === '2' ? `${base}_PENDING` : base);
  const partyAr = pick(['2', r.customer(h.customer_id)], ['3', r.def('AR')]);
  const partyAp = pick(['1', r.slot(dt, cls, 'AP')], ['2', r.supplier(h.supplier_id)], ['3', r.def('AP')]);
  const receiving = ['RE', 'AI', 'OI', 'HS'].includes(cls);
  const payAcct = (p: PostPayment) => pick(['2', r.paymentMethod(p.method_id)], ['2', r.cheque(p.cheque_id)], ['3', r.def(receiving ? 'CHEQUE_RECEIVED' : 'CHEQUE_PAID')]);
  const cash = pick(['3', r.def('CASH')]);
  const gross = lines.reduce((s, l) => s.plus(d(l.net_amount)), d(0)).plus(vat);
  // ยอดมัดจำที่หักจริง = (รายการ + VAT) − ยอดสุทธิ
  const depositUsed = d(h.deposit_amount).isZero() ? d(0) : gross.minus(net);
  const paysTotal = pays.reduce((s, p) => s.plus(d(p.amount)), d(0));
  // ส่วนที่เหลือหลังวิธีชำระ = เงินสด (Express เก็บที่หัวเอกสาร)
  const cashRest = (total: Decimal) => (total.minus(paysTotal).gte('0.01') ? total.minus(paysTotal) : d(0));

  const lineAccount = (kind: 'SALES' | 'SALES_RETURN' | 'PURCHASE' | 'PURCHASE_RETURN', itemId: string | null): Acct => {
    const { type, group: g } = r.item(itemId ?? '');
    if (kind === 'SALES') return pick(['1', r.slot(dt, cls, 'SALES')], ['2', g.sales], ['3', r.def(cls === 'HS' ? 'CASH_SALES' : 'CREDIT_SALES')]);
    if (kind === 'SALES_RETURN') return pick(['2', g.sret], ['3', r.def('SALES_RETURN')]);
    // รหัสค่าใช้จ่ายอื่น (5) และ '2' ตามข้อมูลที่ย้ายมา → บัญชีค่าใช้จ่ายในกลุ่ม (ช่อง 1) — ดู HANDOFF เรื่องความหมาย item_type
    const expense = type === '5' || type === '2';
    if (kind === 'PURCHASE') {
      if (expense) return pick(['2', g.inv], ['3', r.def('OTHER_EXPENSE')]);
      if (r.perpetual) return pick(['2', g.inv], ['3', r.def('INVENTORY')]);
      return pick(['2', g.pur], ['3', r.def('PURCHASES')]);
    }
    if (expense) return pick(['2', g.inv], ['3', r.def('OTHER_EXPENSE')]);
    return pick(['2', g.pret], ['3', r.def('PURCHASE_RETURN')]);
  };

  if (cls === 'IV' || cls === 'DR' || cls === 'HS') {
    if (cls !== 'HS') D(partyAr, net, 'AR');
    else {   // ขายเงินสด: วิธีรับชำระอื่นลงตามบัญชีของวิธีนั้น ที่เหลือเป็นเงินสด
      D(pick(['3', r.def('CASH')]), cashRest(net), 'CASH');
      for (const p of pays) D(payAcct(p), d(p.amount), 'PAYMENT');
    }
    for (const l of lines) C(lineAccount('SALES', l.item_id), d(l.net_amount), 'SALES');
    C(pick(['3', r.def(vatRole('OUTPUT_VAT'))]), vat, 'OUTPUT_VAT');
    if (!depositUsed.isZero()) D(pick(['3', r.def('DEPOSIT_RECEIVED')]), depositUsed, 'DEPOSIT_RECEIVED');
  } else if (cls === 'CN') {
    C(partyAr, net, 'AR');
    for (const l of lines) D(lineAccount('SALES_RETURN', l.item_id), d(l.net_amount), 'SALES_RETURN');
    D(pick(['3', r.def(vatRole('OUTPUT_VAT'))]), vat, 'OUTPUT_VAT');
  } else if (cls === 'RR' || cls === 'CP' || cls === 'HP') {
    for (const l of lines) D(lineAccount('PURCHASE', l.item_id), d(l.net_amount), 'PURCHASE');
    D(pick(['3', r.def(vatRole('INPUT_VAT'))]), vat, 'INPUT_VAT');
    if (cls === 'HP') {
      C(pick(['1', r.slot(dt, cls, 'CASH')], ['3', r.def('CASH')]), cashRest(net), 'CASH');
      for (const p of pays) C(payAcct(p), d(p.amount), 'PAYMENT');
    } else C(partyAp, net, 'AP');
    if (!depositUsed.isZero() && cls !== 'CP') C(pick(['3', r.def('DEPOSIT_PAID')]), depositUsed, 'DEPOSIT_PAID');
  } else if (cls === 'DN') {
    D(partyAp, net, 'AP');
    for (const l of lines) C(lineAccount('PURCHASE_RETURN', l.item_id), d(l.net_amount), 'PURCHASE_RETURN');
    C(pick(['3', r.def(vatRole('INPUT_VAT'))]), vat, 'INPUT_VAT');
  } else if (cls === 'RE' || cls === 'PS') {
    const isRe = cls === 'RE';
    let partyTotal = d(0);
    for (const s of setts) {
      if (s.rectype === '0') continue;   // ตัดเงินมัดจำ: ลงผ่านวิธีชำระ "หักมัดจำ" ไม่กระทบลูกหนี้/เจ้าหนี้
      const sign = s.rectype === '5' ? -1 : 1;
      const amt = d(s.amount).times(sign);
      partyTotal = partyTotal.plus(amt);
      const party = pick(['2', isRe ? r.customer(s.party_id) : r.supplier(s.party_id)], ['3', r.def(isRe ? 'AR' : 'AP')]);
      (isRe ? C : D)(party, amt, isRe ? 'AR' : 'AP');
      const v = d(s.vat).times(sign);
      if (!v.isZero()) {   // ภาษีเกณฑ์เงินสด: โอนจากรอเรียกเก็บ/ยังไม่ถึงกำหนด เป็นภาษีจริง
        if (isRe) { D(pick(['3', r.def('OUTPUT_VAT_PENDING')]), v, 'OUTPUT_VAT_PENDING'); C(pick(['3', r.def('OUTPUT_VAT')]), v, 'OUTPUT_VAT'); }
        else { D(pick(['3', r.def('INPUT_VAT')]), v, 'INPUT_VAT'); C(pick(['3', r.def('INPUT_VAT_PENDING')]), v, 'INPUT_VAT_PENDING'); }
      }
    }
    // ผลต่าง (คู่มือหน้า 186, 229): RE Dr ภาษีถูกหัก + Dr ส่วนลดจ่าย / Cr ดอกเบี้ยรับ · PS Cr ภาษีหัก ณ ที่จ่ายค้างจ่าย + Cr ส่วนลดรับ / Dr ดอกเบี้ยจ่าย
    const wht = d(h.wht_amount ?? 0), disc = d(h.cash_discount_amount ?? 0), intr = d(h.interest_amount ?? 0);
    (isRe ? D : C)(pick(['3', r.def(isRe ? 'PREPAID_TAX' : 'WHT_PAYABLE')]), wht, 'WHT');
    (isRe ? D : C)(pick(['3', r.def(isRe ? 'SALES_DISCOUNT' : 'PURCHASE_DISCOUNT')]), disc, 'CASH_DISCOUNT');
    (isRe ? C : D)(pick(['3', r.def(isRe ? 'INTEREST_INCOME' : 'INTEREST_EXPENSE')]), intr, 'INTEREST');
    (isRe ? D : C)(cash, cashRest(partyTotal.minus(wht).minus(disc).plus(intr)), 'CASH');
    for (const p of pays) (isRe ? D : C)(payAcct(p), d(p.amount), 'PAYMENT');
  } else if (cls === 'AI' || cls === 'OI') {
    // ภาษีถูกหัก ณ ที่จ่าย: Dr ภาษีจ่ายล่วงหน้า แทนเงินสดส่วนนั้น
    const wht = d(h.wht_amount ?? 0);
    D(pick(['3', r.def('PREPAID_TAX')]), wht, 'WHT');
    D(cash, cashRest(net.minus(wht)), 'CASH');
    for (const p of pays) D(payAcct(p), d(p.amount), 'PAYMENT');
    if (cls === 'AI') C(pick(['1', r.slot(dt, cls, 'DEPOSIT_RECEIVED')], ['3', r.def('DEPOSIT_RECEIVED')]), net.minus(vat), 'DEPOSIT_RECEIVED');
    else for (const l of lines) C(lineAccount('SALES', l.item_id), d(l.net_amount), 'OTHER_INCOME');
    C(pick(['3', r.def('OUTPUT_VAT')]), vat, 'OUTPUT_VAT');
  } else if (cls === 'VR') {
    // เบิกชดเชยเงินสดย่อย (S-GL-13): Dr บัญชีตามรายการจ่าย (ค่าใช้จ่าย/ตั้งวงเงิน) / Cr เงินสดหรือวิธีจ่าย (เช็ค โอน)
    for (const l of lines) D(pick(['2', l.account_id]), d(l.net_amount), 'EXPENSE');
    C(pick(['1', r.slot(dt, cls, 'CASH')], ['3', r.def('CASH')]), cashRest(net), 'CASH');
    for (const p of pays) C(payAcct(p), d(p.amount), 'PAYMENT');
  } else if (cls === 'AE' || cls === 'OE') {
    if (cls === 'AE') D(pick(['1', r.slot(dt, cls, 'DEPOSIT_PAID')], ['3', r.def('DEPOSIT_PAID')]), net.minus(vat), 'DEPOSIT_PAID');
    else for (const l of lines) D(lineAccount('PURCHASE', l.item_id), d(l.net_amount), 'EXPENSE');
    D(pick(['3', r.def('INPUT_VAT')]), vat, 'INPUT_VAT');
    const wht = d(h.wht_amount ?? 0);
    C(pick(['3', r.def('WHT_PAYABLE')]), wht, 'WHT');
    C(pick(['1', r.slot(dt, cls, 'CASH')], ['3', r.def('CASH')]), cashRest(net.minus(wht)), 'CASH');
    for (const p of pays) C(payAcct(p), d(p.amount), 'PAYMENT');
  }
  return out;
}

/** รวมรายการตามบัญชี (ยอดสุทธิ Dr−Cr) — ใช้เทียบกับใบสำคัญ และตรวจดุล */
export function netByAccount(lines: PostingLine[]): Map<string | null, Decimal> {
  const m = new Map<string | null, Decimal>();
  for (const l of lines) m.set(l.account_id, (m.get(l.account_id) ?? d(0)).plus(l.debit).minus(l.credit));
  return m;
}
/**
 * ยอดของใบเสร็จ/ใบจ่าย (คู่มือหน้า 185, 228): ยอดชำระตามใบกำกับ (ยอดตัดหนี้ ใบลดหนี้ติดลบ) + ดอกเบี้ย − ส่วนลด − ภาษีหัก ณ ที่จ่าย
 * ต้องเท่ากับยอดชำระจริง (เงินสด + ชำระโดยอื่น) — ไม่ระบุเงินสด = ส่วนที่เหลือเป็นเงินสด
 */
export function settlementTotals(x: { settlements: MoneyInput[]; interest?: MoneyInput; discount?: MoneyInput; wht?: MoneyInput; payments: MoneyInput[]; cash?: MoneyInput | null }) {
  const billed = x.settlements.reduce<Decimal>((s, a) => s.plus(d(a)), d(0));
  const due = billed.plus(d(x.interest ?? 0)).minus(d(x.discount ?? 0)).minus(d(x.wht ?? 0));
  const other = x.payments.reduce<Decimal>((s, a) => s.plus(d(a)), d(0));
  const cash = x.cash === null || x.cash === undefined || x.cash === '' ? due.minus(other) : d(x.cash);
  const paid = cash.plus(other);
  return { billed: billed.toFixed(2), due: due.toFixed(2), other: other.toFixed(2), cash: cash.toFixed(2), paid: paid.toFixed(2), diff: due.minus(paid).toFixed(2), ok: due.minus(paid).abs().lt('0.005') && cash.gte(0) };
}

export function postingBalanced(lines: PostingLine[]): boolean {
  return lines.reduce((s, l) => s.plus(l.debit).minus(l.credit), d(0)).abs().lt('0.005');
}
