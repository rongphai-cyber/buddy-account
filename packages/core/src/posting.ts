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
  wht_amount?: MoneyInput; cash_discount_amount?: MoneyInput; interest_amount?: MoneyInput; fx_amount?: MoneyInput;
}
/** บรรทัดสินค้า (item_id) หรือบรรทัดบัญชี (account_id — เงินสดย่อย) */
export interface PostLine { item_id: string | null; net_amount: MoneyInput; account_id?: string | null; /** Perpetual: ต้นทุนของบรรทัดที่ตัด/รับสต๊อก */ cost_amount?: MoneyInput; stock_effect?: number | null; movement_code?: string | null }
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
export const POSTING_CLASSES = ['IV', 'DR', 'HS', 'CN', 'RR', 'CP', 'HP', 'DN', 'RE', 'PS', 'AI', 'AE', 'OE', 'OI', 'VR', 'OU', 'JU', 'CA', 'BD', 'BW', 'BT', 'BU', 'BV'] as const;

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
    if (r.perpetual) return pick(['2', g.inv], ['3', r.def('INVENTORY')]);
    return pick(['2', g.pret], ['3', r.def('PURCHASE_RETURN')]);
  };

  /** Perpetual (ค่าเริ่มต้นระบบสินค้า ข้อ 4): ขาย Dr ต้นทุนขาย / Cr สินค้า · รับคืน กลับด้าน — ตามต้นทุนของบรรทัดที่ตัด/รับสต๊อก */
  const perpetualCost = (eff: 1 | -1) => {
    if (!r.perpetual) return;
    for (const l of lines) {
      if (l.stock_effect !== eff || !l.item_id || d(l.cost_amount).isZero()) continue;
      const { group: g } = r.item(l.item_id);
      const cogs = pick(['2', g.cogs], ['3', r.def('COGS')]), inv = pick(['2', g.inv], ['3', r.def('INVENTORY')]);
      if (eff < 0) { D(cogs, d(l.cost_amount), 'COGS'); C(inv, d(l.cost_amount), 'INVENTORY'); } else { D(inv, d(l.cost_amount), 'INVENTORY'); C(cogs, d(l.cost_amount), 'COGS'); }
    }
  };

  if (cls === 'IV' || cls === 'DR' || cls === 'HS') {
    if (cls !== 'HS') D(partyAr, net, 'AR');
    else {   // ขายเงินสด: วิธีรับชำระอื่นลงตามบัญชีของวิธีนั้น ที่เหลือเป็นเงินสด
      const wht = d(h.wht_amount ?? 0);
      D(pick(['3', r.def('PREPAID_TAX')]), wht, 'WHT');
      D(pick(['3', r.def('CASH')]), cashRest(net.minus(wht)), 'CASH');
      for (const p of pays) D(payAcct(p), d(p.amount), 'PAYMENT');
    }
    for (const l of lines) C(lineAccount('SALES', l.item_id), d(l.net_amount), 'SALES');
    C(pick(['3', r.def(vatRole('OUTPUT_VAT'))]), vat, 'OUTPUT_VAT');
    if (!depositUsed.isZero()) D(pick(['3', r.def('DEPOSIT_RECEIVED')]), depositUsed, 'DEPOSIT_RECEIVED');
    perpetualCost(-1);
  } else if (cls === 'CN') {
    C(partyAr, net, 'AR');
    for (const l of lines) D(lineAccount('SALES_RETURN', l.item_id), d(l.net_amount), 'SALES_RETURN');
    D(pick(['3', r.def(vatRole('OUTPUT_VAT'))]), vat, 'OUTPUT_VAT');
    perpetualCost(1);
  } else if (cls === 'RR' || cls === 'CP' || cls === 'HP') {
    for (const l of lines) D(lineAccount('PURCHASE', l.item_id), d(l.net_amount), 'PURCHASE');
    D(pick(['3', r.def(vatRole('INPUT_VAT'))]), vat, 'INPUT_VAT');
    if (cls === 'HP') {
      const wht = d(h.wht_amount ?? 0);
      C(pick(['3', r.def('WHT_PAYABLE')]), wht, 'WHT');
      C(pick(['1', r.slot(dt, cls, 'CASH')], ['3', r.def('CASH')]), cashRest(net.minus(wht)), 'CASH');
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
    const wht = d(h.wht_amount ?? 0), disc = d(h.cash_discount_amount ?? 0), intr = d(h.interest_amount ?? 0), fx = d(h.fx_amount ?? 0);
    (isRe ? D : C)(pick(['3', r.def(isRe ? 'PREPAID_TAX' : 'WHT_PAYABLE')]), wht, 'WHT');
    (isRe ? D : C)(pick(['3', r.def(isRe ? 'SALES_DISCOUNT' : 'PURCHASE_DISCOUNT')]), disc, 'CASH_DISCOUNT');
    (isRe ? C : D)(pick(['3', r.def(isRe ? 'INTEREST_INCOME' : 'INTEREST_EXPENSE')]), intr, 'INTEREST');
    // ผลต่างอัตราแลกเปลี่ยน (บทที่ 26): กำไร Cr / ขาดทุน Dr บัญชีกำไร(ขาดทุน)จากอัตราแลกเปลี่ยน — รับ: กำไรได้เงินมากขึ้น · จ่าย: กำไรจ่ายน้อยลง
    if (!fx.isZero()) { const fxAcct = pick(['3', r.def('FX_GAIN_LOSS')]); if (fx.gt(0)) C(fxAcct, fx, 'FX'); else D(fxAcct, fx.neg(), 'FX'); }
    (isRe ? D : C)(cash, cashRest(partyTotal.minus(wht).minus(disc).plus(intr).plus(isRe ? fx : fx.neg())), 'CASH');
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
  } else if ((cls === 'OU' || cls === 'JU' || cls === 'CA') && (r.perpetual || (cls === 'OU' && !!r.slot(dt, cls, 'ISSUE_DEBIT') && !!r.slot(dt, cls, 'ISSUE_CREDIT')))) {
    // เอกสารสินค้า (บทที่ 14): ลงบัญชีเมื่อ Perpetual — จ่ายใช้ภายในลงด้วยแม้ Periodic เมื่อประเภทเอกสารกำหนดบัญชีครบ 2 ช่อง (ยืนยันจากใบสำคัญ Express เช่น XS: Dr ค่าสินค้าตัวอย่าง / Cr ต้นทุนขาย)
    for (const l of lines) {
      if (!l.item_id) continue;
      const v = l.movement_code === '8' ? d(l.cost_amount) : d(l.cost_amount).times(l.stock_effect ?? 0);   // มูลค่าเข้า(+)/ออก(−)
      if (v.isZero()) continue;
      // จ่ายใช้ภายใน: ช่อง 1 = Dr บัญชีเบิกใช้ · ช่อง 2 = Cr (แทนบัญชีสินค้าของกลุ่ม)
      const inv = pick(...(cls === 'OU' ? [['1', r.slot(dt, cls, 'ISSUE_CREDIT')] as [Layer, string | null]] : []), ['2', r.item(l.item_id).group.inv], ['3', r.def('INVENTORY')]);
      const other = cls === 'OU' ? pick(['1', r.slot(dt, cls, 'ISSUE_DEBIT')], ['3', r.def('OTHER_EXPENSE')])
        : cls === 'JU' ? pick(['1', r.slot(dt, cls, v.lt(0) ? 'ADJ_DEBIT' : 'ADJ_CREDIT')], ['3', r.def(v.lt(0) ? 'OTHER_EXPENSE' : 'OTHER_INCOME')])
          : pick(['1', r.slot(dt, cls, 'COST_ADJ')], ['3', r.def('SUSPENSE')]);
      if (v.gt(0)) { D(inv, v, 'INVENTORY'); C(other, v, cls === 'CA' ? 'COST_ADJ' : 'STOCK_ADJ'); } else { D(other, v.neg(), cls === 'OU' ? 'ISSUE' : 'STOCK_ADJ'); C(inv, v.neg(), 'INVENTORY'); }
    }
  } else if (cls === 'BD' || cls === 'BW' || cls === 'BT' || cls === 'BU' || cls === 'BV') {
    // เอกสารธนาคาร (บทที่ 13): บรรทัดบัญชี (line_kind G) = บัญชีเงินฝาก ยอดมีเครื่องหมาย (+ เข้า / − ออก) · อีกฝั่งตามประเภทเอกสาร → บัญชีเพื่อลงรายวัน
    let inn = d(0), outt = d(0);
    for (const l of lines) {
      const v = d(l.net_amount);
      D(pick(['2', l.account_id]), v, 'BANK');
      if (v.gt(0)) inn = inn.plus(v); else outt = outt.minus(v);
    }
    const side = (role: string, fallback = role) => pick(['1', r.slot(dt, cls, role)], ['3', r.def(fallback)]);
    if (cls === 'BD') C(side('CASH'), inn, 'CASH');
    else if (cls === 'BW') D(side('CASH'), outt, 'CASH');
    else if (cls === 'BT') D(pick(['3', r.def('BANK_CHARGE')]), outt.minus(inn), 'BANK_CHARGE');   // ค่าธรรมเนียม = ออก − เข้า
    else if (cls === 'BU') {
      // ดอกเบี้ยรับ: ธนาคารหักภาษี ณ ที่จ่าย → ภาษีถูกหัก ณ ที่จ่าย
      const wht = d(h.wht_amount ?? 0);
      D(pick(['3', r.def('PREPAID_TAX')]), wht, 'WHT');
      C(side('BANK_INCOME'), inn.plus(wht), 'BANK_INCOME');
    } else D(side('BANK_EXPENSE', 'BANK_CHARGE'), outt, 'BANK_EXPENSE');
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
/** fx = กำไร(+)/ขาดทุน(−) จากอัตราแลกเปลี่ยน · direction R (รับ) กำไรเพิ่มยอดที่ได้รับ · P (จ่าย) กำไรลดยอดที่ต้องจ่าย */
export function settlementTotals(x: { settlements: MoneyInput[]; interest?: MoneyInput; discount?: MoneyInput; wht?: MoneyInput; fx?: MoneyInput; direction?: 'R' | 'P'; payments: MoneyInput[]; cash?: MoneyInput | null }) {
  const billed = x.settlements.reduce<Decimal>((s, a) => s.plus(d(a)), d(0));
  const fx = d(x.fx || 0).times(x.direction === 'R' ? 1 : -1);
  const due = billed.plus(d(x.interest ?? 0)).minus(d(x.discount ?? 0)).minus(d(x.wht ?? 0)).plus(fx);
  const other = x.payments.reduce<Decimal>((s, a) => s.plus(d(a)), d(0));
  const cash = x.cash === null || x.cash === undefined || x.cash === '' ? due.minus(other) : d(x.cash);
  const paid = cash.plus(other);
  return { billed: billed.toFixed(2), due: due.toFixed(2), other: other.toFixed(2), cash: cash.toFixed(2), paid: paid.toFixed(2), diff: due.minus(paid).toFixed(2), ok: due.minus(paid).abs().lt('0.005') && cash.gte(0) };
}

export function postingBalanced(lines: PostingLine[]): boolean {
  return lines.reduce((s, l) => s.plus(l.debit).minus(l.credit), d(0)).abs().lt('0.005');
}
