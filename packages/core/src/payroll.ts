import Decimal from 'decimal.js';
import { d, round2, ZERO, type MoneyInput } from './money.js';

/**
 * ระบบเงินเดือน — สูตรภาษีเงินได้หัก ณ ที่จ่าย (ภ.ง.ด.1) ประกันสังคม กองทุนสำรองเลี้ยงชีพ และการคิดเงินเดือนรายคน
 * สูตรภาษีตามคำสั่งกรมสรรพากร ป.96/2543 ข้อ 4 (แบบเดียวกับระบบเงินเดือนของ WTS-ERP / Payroll-WHT ของเจ้าของ):
 *   (ก) เงินได้ประจำ ประมาณทั้งปี = ที่จ่ายแล้ว + เดือนนี้ × จำนวนครั้งที่เหลือ → ภาษีทั้งปี เฉลี่ยตามครั้งที่เหลือ
 *   (ข) เงินได้ไม่ประจำ (โบนัส OT ฯลฯ) คิดภาษีส่วนเพิ่มเต็มจำนวนในเดือนที่จ่าย
 * เงินใช้ Decimal ทั้งหมด · ภาษีปัด 2 ตำแหน่งครึ่งขึ้น · ประกันสังคมปัดเป็นบาท
 * ปี (tax_year) เป็น ค.ศ. ภายในโปรแกรม — หน้าจอแสดงตามระบบปีของบริษัท
 */

// ---------------------------------------------------------------- กฎหมาย
export interface TaxBracket { from: string; to: string | null; rate: string }
export interface AllowanceRule {
  code: string; name_th: string; name_en?: string | null;
  /** check = ติ๊ก · count = จำนวนคน · amount = จำนวนเงิน */
  input: 'check' | 'count' | 'amount';
  /** check/count: บาทต่อหน่วย · donation_double: ตัวคูณ (2) */
  per_unit?: string | null; max_count?: number | null; cap?: string | null;
  /** % ของเงินได้ทั้งปี (เงินบริจาค = % ของเงินได้ที่เหลือ) */
  pct?: string | null;
  group?: string | null;
  stage: 'normal' | 'donation_double' | 'donation';
  /** ยอดที่หักผ่านเงินเดือนนับรวมให้เอง (กองทุนสำรองเลี้ยงชีพ) */
  from_payroll?: 'pvd' | null;
  hint?: string;
}
export interface PayrollTaxRules {
  tax_year: number;
  expense_rate: string; expense_cap: string; personal: string;
  brackets: TaxBracket[];
  allowances: AllowanceRule[];
  /** กลุ่ม → เพดานรวม */
  groups: Record<string, string>;
  /** ประกันสังคมหักลดหย่อนได้ไม่เกินปีละ (= 12 × เงินสมทบสูงสุดต่อเดือน) */
  sso_yearly_cap: string;
}
export interface SsoRate { effective_from: string; employee_rate: string; employer_rate: string; wage_min: string; wage_max: string; monthly_min: string; monthly_max: string }

const BRACKETS_2560: TaxBracket[] = [
  { from: '0', to: '150000', rate: '0' }, { from: '150000', to: '300000', rate: '5' }, { from: '300000', to: '500000', rate: '10' },
  { from: '500000', to: '750000', rate: '15' }, { from: '750000', to: '1000000', rate: '20' }, { from: '1000000', to: '2000000', rate: '25' },
  { from: '2000000', to: '5000000', rate: '30' }, { from: '5000000', to: null, rate: '35' },
];
/** รายการลดหย่อน (ภ.ง.ด.91 ปีภาษี 2568–2569) — ลำดับตามแบบ ล.ย.01 */
const ALLOWANCES_2568: AllowanceRule[] = [
  { code: 'spouse', name_th: 'คู่สมรสไม่มีเงินได้', name_en: 'Spouse', input: 'check', per_unit: '60000', stage: 'normal' },
  { code: 'child', name_th: 'บุตร (คนแรก หรือเกิดก่อนปี 2561)', name_en: 'Children', input: 'count', per_unit: '30000', max_count: 10, stage: 'normal' },
  { code: 'child2', name_th: 'บุตรคนที่ 2 ขึ้นไป ที่เกิดตั้งแต่ปี 2561', name_en: 'Second child onward (born 2018+)', input: 'count', per_unit: '60000', max_count: 10, stage: 'normal' },
  { code: 'parent', name_th: 'อุปการะเลี้ยงดูบิดามารดา (อายุ 60 ปีขึ้นไป)', name_en: 'Parents care', input: 'count', per_unit: '30000', max_count: 4, stage: 'normal' },
  { code: 'disabled', name_th: 'อุปการะคนพิการ/ทุพพลภาพ', name_en: 'Disabled dependants', input: 'count', per_unit: '60000', max_count: 10, stage: 'normal' },
  { code: 'prenatal', name_th: 'ค่าฝากครรภ์และคลอดบุตร', name_en: 'Prenatal and birth', input: 'amount', cap: '60000', stage: 'normal' },
  { code: 'life_ins', name_th: 'เบี้ยประกันชีวิต', name_en: 'Life insurance', input: 'amount', cap: '100000', group: 'life_health', stage: 'normal' },
  { code: 'health_ins', name_th: 'เบี้ยประกันสุขภาพ', name_en: 'Health insurance', input: 'amount', cap: '25000', group: 'life_health', stage: 'normal', hint: 'รวมกับเบี้ยประกันชีวิตไม่เกิน 100,000' },
  { code: 'spouse_life_ins', name_th: 'เบี้ยประกันชีวิตคู่สมรส (ไม่มีเงินได้)', name_en: "Spouse's life insurance", input: 'amount', cap: '10000', stage: 'normal' },
  { code: 'parent_health_ins', name_th: 'เบี้ยประกันสุขภาพบิดามารดา', name_en: "Parents' health insurance", input: 'amount', cap: '15000', stage: 'normal' },
  { code: 'pension_ins', name_th: 'เบี้ยประกันชีวิตแบบบำนาญ', name_en: 'Pension insurance', input: 'amount', pct: '15', cap: '200000', group: 'retirement', stage: 'normal' },
  { code: 'pvd', name_th: 'เงินสะสมกองทุนสำรองเลี้ยงชีพ', name_en: 'Provident fund', input: 'amount', pct: '15', cap: '500000', group: 'retirement', stage: 'normal', from_payroll: 'pvd', hint: 'ยอดที่หักผ่านเงินเดือนนับให้อัตโนมัติ ป้อนเฉพาะที่จ่ายเองนอกบริษัท' },
  { code: 'rmf', name_th: 'กองทุนรวมเพื่อการเลี้ยงชีพ (RMF)', name_en: 'RMF', input: 'amount', pct: '30', cap: '500000', group: 'retirement', stage: 'normal' },
  { code: 'ssf', name_th: 'กองทุนรวมเพื่อการออม (SSF)', name_en: 'SSF', input: 'amount', pct: '30', cap: '200000', group: 'retirement', stage: 'normal' },
  { code: 'nsf', name_th: 'กองทุนการออมแห่งชาติ (กอช.)', name_en: 'National Savings Fund', input: 'amount', cap: '30000', group: 'retirement', stage: 'normal' },
  { code: 'thai_esg', name_th: 'กองทุนรวมไทยเพื่อความยั่งยืน (ThaiESG)', name_en: 'ThaiESG', input: 'amount', pct: '30', cap: '300000', stage: 'normal', hint: 'เพดานแยก ไม่รวมกลุ่มเกษียณ' },
  { code: 'home_loan', name_th: 'ดอกเบี้ยเงินกู้ซื้อที่อยู่อาศัย', name_en: 'Home loan interest', input: 'amount', cap: '100000', stage: 'normal' },
  { code: 'other', name_th: 'ค่าลดหย่อนอื่น ๆ', name_en: 'Other allowances', input: 'amount', stage: 'normal', hint: 'เช่น มาตรการรัฐประจำปี — ใส่ยอดที่หักได้จริง' },
  { code: 'donation_edu', name_th: 'เงินบริจาคเพื่อการศึกษา/กีฬา/โรงพยาบาลรัฐ (2 เท่า)', name_en: 'Education donation (×2)', input: 'amount', per_unit: '2', pct: '10', stage: 'donation_double' },
  { code: 'donation', name_th: 'เงินบริจาคทั่วไป', name_en: 'General donation', input: 'amount', pct: '10', stage: 'donation' },
];
const TAX_BASE = { expense_rate: '50', expense_cap: '100000', personal: '60000', brackets: BRACKETS_2560, allowances: ALLOWANCES_2568, groups: { life_health: '100000', retirement: '500000' } };
/** อัตราตามกฎหมายรายปี (ค.ศ.) — ปีที่ไม่มีใช้ปีล่าสุดก่อนหน้าแล้วเตือน (lawYear ≠ ปีที่ขอ) */
export const PAYROLL_TAX_LAW: Record<number, Omit<PayrollTaxRules, 'tax_year' | 'sso_yearly_cap'>> = { 2025: TAX_BASE, 2026: TAX_BASE };

/** ประกันสังคม ม.33 — กฎกระทรวงปรับเพดานค่าจ้าง 3 ระยะ (17,500 ปี 2569–2571 · 20,000 ปี 2572–2574 · 23,000 ตั้งแต่ 2575) */
export const SSO_LAW: SsoRate[] = [
  { effective_from: '2025-01-01', employee_rate: '5', employer_rate: '5', wage_min: '1650', wage_max: '15000', monthly_min: '83', monthly_max: '750' },
  { effective_from: '2026-01-01', employee_rate: '5', employer_rate: '5', wage_min: '1650', wage_max: '17500', monthly_min: '83', monthly_max: '875' },
  { effective_from: '2029-01-01', employee_rate: '5', employer_rate: '5', wage_min: '1650', wage_max: '20000', monthly_min: '83', monthly_max: '1000' },
  { effective_from: '2032-01-01', employee_rate: '5', employer_rate: '5', wage_min: '1650', wage_max: '23000', monthly_min: '83', monthly_max: '1150' },
];

/** อัตราประกันสังคม ณ วันที่ (บริษัทกำหนดแทนได้ เช่น ช่วงรัฐลดเงินสมทบ — แถวที่ใหม่กว่าชนะ) */
export function ssoRateOn(date: string, overrides: SsoRate[] = []): SsoRate | null {
  const all = [...SSO_LAW, ...overrides].filter((r) => r.effective_from <= date).sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  return all.length ? all[all.length - 1]! : null;
}

/** กฎภาษีของปี: บริษัทแก้เอง (override) > กฎหมายในโปรแกรม (ปีล่าสุดที่ไม่เกิน) · lawYear = ปีของตารางที่ใช้จริง */
export function taxRulesFor(year: number, override?: Partial<Omit<PayrollTaxRules, 'tax_year'>> | null, ssoOverrides: SsoRate[] = []): { rules: PayrollTaxRules; lawYear: number | null } {
  const years = Object.keys(PAYROLL_TAX_LAW).map(Number).filter((y) => y <= year).sort((a, b) => a - b);
  const lawYear = years.length ? years[years.length - 1]! : null;
  const base = PAYROLL_TAX_LAW[lawYear ?? Math.min(...Object.keys(PAYROLL_TAX_LAW).map(Number))]!;
  const sso = ssoRateOn(`${year}-01-01`, ssoOverrides);
  const rules: PayrollTaxRules = { ...base, ...(override ?? {}), tax_year: year, sso_yearly_cap: override?.sso_yearly_cap ?? d(sso?.monthly_max ?? 0).times(12).toFixed(2) };
  return { rules, lawYear: override ? year : lawYear };
}

/** ตรวจกฎภาษีที่บริษัทแก้เอง — คืนข้อความผิดพลาด (ไม่มี = ใช้ได้) */
export function checkTaxRules(r: Partial<PayrollTaxRules>): string | null {
  const num = (v: unknown) => v != null && /^\d+(\.\d+)?$/.test(String(v));
  if (!num(r.expense_rate) || !num(r.expense_cap) || !num(r.personal)) return 'อัตราค่าใช้จ่าย เพดานค่าใช้จ่าย และค่าลดหย่อนส่วนตัว ต้องเป็นตัวเลข';
  const b = r.brackets ?? [];
  if (!b.length || d(b[0]!.from).gt(0)) return 'ขั้นภาษีต้องเริ่มที่ 0';
  for (let i = 0; i < b.length; i++) {
    const x = b[i]!;
    if (!num(x.from) || !num(x.rate) || (x.to != null && !num(x.to))) return `ขั้นภาษีแถวที่ ${i + 1} ต้องเป็นตัวเลข`;
    if (i < b.length - 1 && (x.to == null || !d(x.to).eq(b[i + 1]!.from))) return `ขั้นภาษีแถวที่ ${i + 1}: "ถึง" ต้องเท่ากับ "ตั้งแต่" ของแถวถัดไป`;
  }
  if (b[b.length - 1]!.to != null) return 'ขั้นภาษีแถวสุดท้ายต้องไม่มีเพดาน (ช่อง "ถึง" ว่าง)';
  return null;
}

// ---------------------------------------------------------------- ภาษีขั้นบันได
const pct = (v: MoneyInput) => d(v).div(100);
const minD = (a: Decimal, ...rest: Decimal[]) => rest.reduce((m, x) => (x.lt(m) ? x : m), a);
const maxD = (a: Decimal, b: Decimal) => (a.gt(b) ? a : b);
/** ค่าที่ผู้ใช้ป้อน: จำนวนบวก ไม่ใช่ = 0 (ติ๊ก = 1) */
const positive = (v: unknown): Decimal => {
  if (v === true) return new Decimal(1);
  if (v == null || v === false || v === '') return ZERO;
  const s = String(v).replace(/,/g, '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return ZERO;
  const x = new Decimal(s);
  return x.gt(0) ? x : ZERO;
};
const round0 = (v: Decimal) => v.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);

export function bracketTax(netIncome: MoneyInput, brackets: readonly TaxBracket[]) {
  const net = d(netIncome);
  const rows = [...brackets].sort((a, b) => d(a.from).cmp(d(b.from))).map((b) => {
    const from = d(b.from);
    const upper = b.to == null ? net : minD(net, d(b.to));
    const taxable = net.lte(from) ? ZERO : maxD(ZERO, upper.minus(from));
    return { from: b.from, to: b.to, rate: b.rate, taxable, tax: taxable.times(pct(b.rate)) };
  });
  return { rows, tax: rows.reduce((t, r) => t.plus(r.tax), ZERO) };
}

// ---------------------------------------------------------------- ค่าลดหย่อน
/** ค่าลดหย่อนของพนักงานรายปี: รหัส → true (ติ๊ก) / จำนวนคน / จำนวนเงิน */
export type AllowanceValues = Record<string, string | number | boolean | null | undefined>;
export interface AllowanceLine { code: string; name_th: string; amount: Decimal }

/** ตรวจค่าลดหย่อนที่ป้อน — รหัสที่ไม่รู้จัก, จำนวนคนต้องเป็นจำนวนเต็มไม่เกินที่กำหนด (กันพิมพ์ 30000 ลงช่องจำนวนบุตร) */
export function checkAllowances(rules: PayrollTaxRules, v: AllowanceValues): string | null {
  for (const [k, x] of Object.entries(v)) {
    if (x == null || x === '' || x === false) continue;
    const a = rules.allowances.find((r) => r.code === k);
    if (!a) return `ไม่รู้จักค่าลดหย่อนรหัส ${k}`;
    if (a.input === 'check') continue;
    const s = String(x).replace(/,/g, '').trim();
    if (!/^\d+(\.\d+)?$/.test(s)) return `${a.name_th}: ต้องเป็นตัวเลข`;
    if (a.input === 'count' && (!/^\d+$/.test(s) || (a.max_count != null && Number(s) > a.max_count))) return `${a.name_th}: ใส่จำนวนคน (จำนวนเต็มไม่เกิน ${a.max_count ?? 99}) ไม่ใช่จำนวนเงิน`;
  }
  return null;
}

/**
 * ค่าลดหย่อนทั้งปีเทียบกับเงินได้ทั้งปี (ประมาณ): ค่าใช้จ่าย · ส่วนตัว · ประกันสังคม (ไม่เกินเพดานปี) · รายการตามเพดาน/%
 * · กลุ่มที่มีเพดานรวม · เงินบริจาคคิดท้ายสุดจากเงินได้ที่เหลือ (การศึกษา 2 เท่า ก่อน แล้วทั่วไป)
 */
export function allowanceBreakdown(rules: PayrollTaxRules, values: AllowanceValues, income: MoneyInput, ssoAnnual: MoneyInput, pvdAnnual: MoneyInput = 0) {
  const inc = d(income);
  const lines: AllowanceLine[] = [];
  lines.push({ code: 'expense', name_th: 'หักค่าใช้จ่าย', amount: minD(inc.times(pct(rules.expense_rate)), d(rules.expense_cap)) });
  lines.push({ code: 'personal', name_th: 'ค่าลดหย่อนส่วนตัว', amount: d(rules.personal) });
  const sso = minD(d(ssoAnnual), d(rules.sso_yearly_cap));
  if (sso.gt(0)) lines.push({ code: 'sso', name_th: 'เงินสมทบประกันสังคม', amount: sso });
  const grouped = new Map<string, { amount: Decimal; members: AllowanceLine[] }>();
  for (const a of rules.allowances.filter((x) => x.stage === 'normal')) {
    let amount: Decimal;
    if (a.input === 'check') amount = values[a.code] ? d(a.per_unit) : ZERO;
    else if (a.input === 'count') {
      let n = positive(values[a.code]);
      if (a.max_count) n = minD(n, new Decimal(a.max_count));
      amount = n.times(d(a.per_unit));
    } else {
      amount = positive(values[a.code]);
      if (a.from_payroll === 'pvd') amount = amount.plus(positive(String(pvdAnnual)));
      if (a.pct) amount = minD(amount, inc.times(pct(a.pct)));
      if (a.cap != null) amount = minD(amount, d(a.cap));
    }
    if (amount.lte(0)) continue;
    const line = { code: a.code, name_th: a.name_th, amount };
    if (a.group && rules.groups[a.group] != null) {
      const g = grouped.get(a.group) ?? { amount: ZERO, members: [] };
      g.amount = g.amount.plus(amount); g.members.push(line); grouped.set(a.group, g);
    } else lines.push(line);
  }
  for (const [code, g] of grouped) {
    const cap = d(rules.groups[code]);
    if (g.amount.gt(cap)) lines.push({ code: `group:${code}`, name_th: `${g.members.map((m) => m.name_th).join(' + ')} (เพดานรวม)`, amount: cap });
    else lines.push(...g.members);
  }
  const before = lines.reduce((t, l) => t.plus(l.amount), ZERO);
  const base = maxD(ZERO, inc.minus(before));
  let donations = ZERO, left = base;
  for (const stage of ['donation_double', 'donation'] as const) {
    for (const a of rules.allowances.filter((x) => x.stage === stage)) {
      const given = positive(values[a.code]).times(stage === 'donation_double' ? d(a.per_unit ?? '1') : 1);
      const amount = minD(given, (stage === 'donation_double' ? base : left).times(pct(a.pct ?? '100')));
      if (amount.lte(0)) continue;
      lines.push({ code: a.code, name_th: a.name_th, amount });
      donations = donations.plus(amount);
      if (stage === 'donation_double') left = maxD(ZERO, base.minus(amount));
    }
  }
  const total = before.plus(donations);
  return { lines, total, netIncome: maxD(ZERO, inc.minus(total)) };
}

/** ผู้รับภาระภาษี: W หัก ณ ที่จ่าย · O บริษัทออกให้ครั้งเดียว · F ออกให้ตลอดไป · N ไม่หักภาษี */
export type TaxBearer = 'W' | 'O' | 'F' | 'N';
export const TAX_BEARER_TH: Record<TaxBearer, string> = { W: 'หัก ณ ที่จ่าย', O: 'บริษัทออกให้ครั้งเดียว', F: 'บริษัทออกให้ตลอดไป', N: 'ไม่หักภาษี' };
/** เงื่อนไขในแบบ ภ.ง.ด.1 / 50 ทวิ: 1 หัก ณ ที่จ่าย · 2 ออกให้ตลอดไป · 3 ออกให้ครั้งเดียว */
export const bearerCondition = (b: TaxBearer) => (b === 'F' ? '2' : b === 'O' ? '3' : '1');

/** ภาษีทั้งปีจากเงินได้ — ภาษีที่บริษัทออกให้นับเป็นเงินได้ด้วย (ครั้งเดียว: บวกครั้งเดียว · ตลอดไป: วนจนนิ่ง) */
export function annualTax(rules: PayrollTaxRules, values: AllowanceValues, gross: MoneyInput, ssoAnnual: MoneyInput, bearer: TaxBearer = 'W', pvdAnnual: MoneyInput = 0): Decimal {
  if (bearer === 'N') return ZERO;
  const taxOf = (inc: Decimal) => bracketTax(allowanceBreakdown(rules, values, inc, ssoAnnual, pvdAnnual).netIncome, rules.brackets).tax;
  const g = d(gross);
  if (bearer === 'O') return taxOf(g.plus(taxOf(g)));
  if (bearer === 'F') {
    let t = taxOf(g);
    for (let i = 0; i < 200; i++) {
      const next = taxOf(g.plus(t));
      if (next.minus(t).abs().lt('0.0001')) return next;
      t = next;
    }
    return t;
  }
  return taxOf(g);
}

// ---------------------------------------------------------------- ภาษีรายเดือน
/** ยอดของเดือนก่อน ๆ ในปีเดียวกัน (ตามที่บันทึก) */
export interface PaidMonth { regular: MoneyInput; special: MoneyInput; tax: MoneyInput; special_tax: MoneyInput; sso: MoneyInput; pvd?: MoneyInput }
export interface MonthTaxInput {
  rules: PayrollTaxRules; allowances: AllowanceValues; bearer?: TaxBearer;
  /** 1–12: มกราคม หรือเดือนที่เริ่มงานในปีนี้ */
  start_month: number;
  /** 1–12: ธันวาคม หรือเดือนที่ออกในปีนี้ */
  end_month: number;
  month: number;
  prior: readonly PaidMonth[];
  regular: MoneyInput; special: MoneyInput; sso: MoneyInput; pvd?: MoneyInput;
  /** ภาษีที่ป้อนเอง — ผลต่างเฉลี่ยไปเดือนที่เหลือเอง (สูตรใช้ภาษีที่หักจริง) */
  tax_manual?: MoneyInput;
}

export function monthTax(i: MonthTaxInput) {
  const bearer = i.bearer ?? 'W';
  const sumOf = (k: keyof PaidMonth) => i.prior.reduce((t, m) => t.plus(d(m[k])), ZERO);
  const regularBefore = sumOf('regular'), specialBefore = sumOf('special'), taxBefore = sumOf('tax'), specialTaxBefore = sumOf('special_tax');
  const ssoBefore = sumOf('sso'), pvdBefore = sumOf('pvd');
  const regularTaxBefore = taxBefore.minus(specialTaxBefore);
  const regular = d(i.regular), special = d(i.special), sso = d(i.sso), pvd = d(i.pvd);
  const remaining = Math.max(0, i.end_month - i.month + 1);
  const periods = Math.max(1, i.end_month - i.start_month + 1);
  const annualRegularIncome = regularBefore.plus(regular.times(remaining));
  const ssoAnnual = minD(ssoBefore.plus(sso.times(remaining)), d(i.rules.sso_yearly_cap));
  const pvdAnnual = pvdBefore.plus(pvd.times(remaining));
  const annualRegularTax = annualTax(i.rules, i.allowances, annualRegularIncome, ssoAnnual, bearer, pvdAnnual);
  let regularTax = remaining > 0 ? annualRegularTax.minus(regularTaxBefore).div(remaining) : ZERO;
  if (regularTax.lt(0)) regularTax = ZERO;
  const cumulativeSpecial = specialBefore.plus(special);
  const taxWithSpecial = annualTax(i.rules, i.allowances, annualRegularIncome.plus(cumulativeSpecial), ssoAnnual, bearer, pvdAnnual);
  const specialTax = taxWithSpecial.minus(annualRegularTax).minus(specialTaxBefore);
  const manual = i.tax_manual != null && i.tax_manual !== '';
  let tax = manual ? round2(i.tax_manual) : round2(regularTax.plus(specialTax));
  if (tax.lt(0)) tax = ZERO;
  const net = allowanceBreakdown(i.rules, i.allowances, annualRegularIncome.plus(cumulativeSpecial), ssoAnnual, pvdAnnual);
  return {
    remaining, periods,
    annual_regular_income: round2(annualRegularIncome), sso_annual: round2(ssoAnnual), pvd_annual: round2(pvdAnnual),
    annual_regular_tax: round2(annualRegularTax), regular_tax: round2(regularTax),
    cumulative_special: round2(cumulativeSpecial), special_tax: round2(specialTax),
    annual_income: round2(annualRegularIncome.plus(cumulativeSpecial)), allowances: net, annual_net_income: round2(net.netIncome),
    annual_tax_estimate: round2(taxWithSpecial), tax, tax_manual: manual,
    /** บริษัทออกภาษีให้: ไม่หักจากเงินเดือน แต่ยังต้องนำส่ง */
    employer_paid_tax: bearer === 'O' || bearer === 'F' ? tax : ZERO,
    tax_ytd: round2(taxBefore.plus(tax)),
    /** หักเกินภาษีทั้งปี (ภาษีป้อนเองสูงเกิน — ไม่คืนในเงินเดือน) */
    over_withheld: maxD(ZERO, round2(taxBefore.plus(tax).minus(taxWithSpecial))),
  };
}

// ---------------------------------------------------------------- ประกันสังคม
/** 5% ของค่าจ้างที่อยู่ระหว่างฐานต่ำสุด–สูงสุด ปัดเป็นบาท แล้วไม่ต่ำกว่า/ไม่เกินเงินสมทบต่ำสุด–สูงสุด */
export function ssoContribution(wage: MoneyInput, r: SsoRate) {
  const w = d(wage);
  if (w.lte(0)) return { base: ZERO, employee: ZERO, employer: ZERO };
  const base = minD(maxD(w, d(r.wage_min)), d(r.wage_max));
  const part = (rate: string) => minD(maxD(round0(base.times(pct(rate))), d(r.monthly_min)), d(r.monthly_max));
  return { base, employee: part(r.employee_rate), employer: part(r.employer_rate) };
}

// ---------------------------------------------------------------- เงินชดเชย (ระยะ 4 — สูตรพร้อมใช้)
export interface SeveranceRules { days_by_service: Array<{ min_years: number; days: number }>; exempt_days: number; exempt_cap: string; expense_per_year: string; second_rate: string; min_years_separate: number }
/** พ.ร.บ.คุ้มครองแรงงาน ม.118 (ฉบับ 2562) · ยกเว้นภาษีไม่เกินค่าจ้าง 400 วันสุดท้ายและไม่เกิน 600,000 · ม.48(5) หัก 7,000 × ปี แล้ว 50% */
export const SEVERANCE_LAW: SeveranceRules = {
  days_by_service: [{ min_years: 0, days: 30 }, { min_years: 1, days: 90 }, { min_years: 3, days: 180 }, { min_years: 6, days: 240 }, { min_years: 10, days: 300 }, { min_years: 20, days: 400 }],
  exempt_days: 400, exempt_cap: '600000', expense_per_year: '7000', second_rate: '50', min_years_separate: 5,
};
/** อายุงาน (เศษปีตั้งแต่ 183 วันนับเป็น 1 ปีสำหรับ ม.48(5)) */
export function serviceLength(hireDate: string, endDate: string) {
  const a = new Date(`${hireDate}T00:00:00Z`), b = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(+a) || Number.isNaN(+b) || b < a) return null;
  const day = 86400000;
  const days = Math.floor((+b - +a) / day) + 1;
  let years = b.getUTCFullYear() - a.getUTCFullYear();
  const anniversary = (n: number) => { const x = new Date(a); x.setUTCFullYear(a.getUTCFullYear() + n); return x; };
  if (anniversary(years) > b) years -= 1;
  const remainDays = Math.floor((+b - +anniversary(years)) / day) + 1;
  return { days, full_years: years, remain_days: remainDays, years_for_tax: years + (remainDays >= 183 ? 1 : 0) };
}
export function severanceDays(s: { days: number; full_years: number } | null, r: SeveranceRules = SEVERANCE_LAW) {
  if (!s || s.days < 120) return 0;
  let hit = r.days_by_service[0]!;
  for (const x of r.days_by_service) if (s.full_years >= x.min_years) hit = x;
  return hit.days;
}
export function severanceSplit(amount: MoneyInput, dailyWage: MoneyInput, allowExempt: boolean, r: SeveranceRules = SEVERANCE_LAW) {
  const amt = maxD(ZERO, d(amount));
  if (!allowExempt) return { exempt: ZERO, taxable: round2(amt) };
  const exempt = round2(minD(amt, round2(d(dailyWage).times(r.exempt_days)), d(r.exempt_cap)));
  return { exempt, taxable: round2(amt.minus(exempt)) };
}
export function severanceSeparateTax(taxable: MoneyInput, yearsForTax: number, brackets: readonly TaxBracket[], r: SeveranceRules = SEVERANCE_LAW) {
  const income = maxD(ZERO, d(taxable));
  const expense1 = round2(minD(income, d(r.expense_per_year).times(Math.max(0, yearsForTax))));
  const after1 = round2(income.minus(expense1));
  const expense2 = round2(after1.times(pct(r.second_rate)));
  const net = round2(after1.minus(expense2));
  return { income, expense1, after1, expense2, net, tax: round2(bracketTax(net, brackets).tax) };
}

// ---------------------------------------------------------------- รายการเงินได้/เงินหัก
/** E เงินได้ · D เงินหัก */
export type PayItemKind = 'E' | 'D';
/** R เงินได้ประจำ (ส่วน ก) · S เงินได้ไม่ประจำ (ส่วน ข) · N ไม่ใช่เงินได้ที่ต้องเสียภาษี */
export type PayTaxBucket = 'R' | 'S' | 'N';
/** AMOUNT จำนวนเงิน · WAGE ค่าจ้างตามประวัติ · HOURS/DAYS/MINUTES จำนวน × อัตราค่าจ้าง × ตัวคูณ · SYSTEM โปรแกรมคิด (ภาษี ประกันสังคม กองทุน) */
export type PayCalc = 'AMOUNT' | 'WAGE' | 'HOURS' | 'DAYS' | 'MINUTES' | 'SYSTEM';
export interface PayItemDef {
  code: string; name_th: string; name_en?: string | null; kind: PayItemKind; tax_bucket: PayTaxBucket; sso_base: boolean; pvd_base: boolean;
  calc: PayCalc; multiplier?: string | null; multiplier_daily?: string | null; sign: 1 | -1; gl_role: string; system_code?: string | null;
}
export const PAY_CALC_TH: Record<PayCalc, string> = { AMOUNT: 'จำนวนเงิน', WAGE: 'ค่าจ้างตามอัตรา', HOURS: 'ชั่วโมง × อัตรา', DAYS: 'วัน × อัตรา', MINUTES: 'นาที × อัตรา', SYSTEM: 'โปรแกรมคิดให้' };
export const PAY_BUCKET_TH: Record<PayTaxBucket, string> = { R: 'เงินได้ประจำ', S: 'เงินได้ไม่ประจำ', N: 'ไม่คิดภาษี' };
const E = (code: string, name_th: string, name_en: string, tax_bucket: PayTaxBucket, gl_role: string, x: Partial<PayItemDef> = {}): PayItemDef =>
  ({ code, name_th, name_en, kind: 'E', tax_bucket, sso_base: false, pvd_base: false, calc: 'AMOUNT', sign: 1, gl_role, ...x });
const D = (code: string, name_th: string, name_en: string, gl_role: string, x: Partial<PayItemDef> = {}): PayItemDef =>
  ({ code, name_th, name_en, kind: 'D', tax_bucket: 'N', sso_base: false, pvd_base: false, calc: 'AMOUNT', sign: 1, gl_role, ...x });
/** รายการเริ่มต้นของบริษัท (system_code แก้รหัส/ลบ/เลิกใช้ไม่ได้) */
export const PAY_ITEM_DEFAULTS: PayItemDef[] = [
  E('IN001', 'เงินเดือน/ค่าจ้าง', 'Salary / wages', 'R', 'PAY_SALARY', { sso_base: true, pvd_base: true, calc: 'WAGE', system_code: 'WAGE' }),
  E('IN002', 'ค่าล่วงเวลา (OT)', 'Overtime', 'S', 'PAY_OT', { calc: 'HOURS', multiplier: '1.5', multiplier_daily: '1.5', system_code: 'OT' }),
  E('IN003', 'ค่าทำงานในวันหยุด', 'Holiday work', 'S', 'PAY_OT', { calc: 'HOURS', multiplier: '1', multiplier_daily: '2', system_code: 'HOLIDAY' }),
  E('IN004', 'ค่าล่วงเวลาในวันหยุด', 'Holiday overtime', 'S', 'PAY_OT', { calc: 'HOURS', multiplier: '3', multiplier_daily: '3', system_code: 'HOLIDAY_OT' }),
  E('IN005', 'ค่าตำแหน่ง', 'Position allowance', 'R', 'PAY_ALLOWANCE', { sso_base: true }),
  E('IN006', 'เบี้ยเลี้ยง', 'Allowance', 'S', 'PAY_ALLOWANCE'),
  E('IN007', 'ค่านายหน้า/คอมมิชชั่น', 'Commission', 'S', 'PAY_COMMISSION'),
  E('IN008', 'โบนัส', 'Bonus', 'S', 'PAY_BONUS'),
  E('IN009', 'เบี้ยขยัน', 'Diligence allowance', 'S', 'PAY_ALLOWANCE'),
  E('IN010', 'เงินได้อื่น (คิดภาษี)', 'Other taxable income', 'S', 'PAY_BENEFIT'),
  E('IN011', 'เงินอื่นที่ไม่ใช่เงินได้ (ไม่คิดภาษี)', 'Non-taxable payment', 'N', 'PAY_BENEFIT'),
  E('IN012', 'หักขาดงาน/ลาไม่รับค่าจ้าง', 'Absence (unpaid)', 'R', 'PAY_SALARY', { sso_base: true, pvd_base: true, calc: 'DAYS', sign: -1, system_code: 'ABSENCE' }),
  E('IN013', 'หักมาสาย/กลับก่อน', 'Late / early leave', 'R', 'PAY_SALARY', { sso_base: true, pvd_base: true, calc: 'MINUTES', sign: -1, system_code: 'LATE' }),
  D('ES001', 'ภาษีหัก ณ ที่จ่าย', 'Withholding tax', 'PAY_WHT1_PAYABLE', { calc: 'SYSTEM', system_code: 'TAX' }),
  D('ES002', 'ประกันสังคม', 'Social security', 'PAY_SSO_PAYABLE', { calc: 'SYSTEM', system_code: 'SSO' }),
  D('ES003', 'กองทุนสำรองเลี้ยงชีพ', 'Provident fund', 'PAY_PVD_PAYABLE', { calc: 'SYSTEM', system_code: 'PVD' }),
  D('ES004', 'กยศ./กรอ.', 'Student loan fund', 'PAY_DEDUCTION_PAYABLE'),
  D('ES005', 'เบิกล่วงหน้า', 'Salary advance', 'PAY_EMPLOYEE_ADVANCE'),
  D('ES006', 'สหกรณ์', 'Co-operative', 'PAY_DEDUCTION_PAYABLE'),
  D('ES007', 'หักอื่น', 'Other deduction', 'PAY_DEDUCTION_PAYABLE'),
];
/** บทบาทบัญชีของรายการ (ช่องในการเชื่อมต่อบัญชี) — เงินได้ = ค่าใช้จ่าย · เงินหัก = หนี้สิน/ลูกหนี้ */
export const PAY_EARNING_ROLES = ['PAY_SALARY', 'PAY_OT', 'PAY_ALLOWANCE', 'PAY_BONUS', 'PAY_COMMISSION', 'PAY_BENEFIT'] as const;
export const PAY_DEDUCTION_ROLES = ['PAY_DEDUCTION_PAYABLE', 'PAY_EMPLOYEE_ADVANCE'] as const;
export function checkPayItem(x: Pick<PayItemDef, 'kind' | 'tax_bucket' | 'calc' | 'sign' | 'sso_base' | 'pvd_base' | 'multiplier'>, isSystem: boolean): string | null {
  if (x.kind === 'D') {
    if (x.tax_bucket !== 'N' || x.sso_base || x.pvd_base || x.sign !== 1) return 'รายการหักไม่คิดภาษี ไม่เป็นฐานประกันสังคม/กองทุน และเป็นยอดบวกเสมอ';
    if (!isSystem && x.calc !== 'AMOUNT') return 'รายการหักที่เพิ่มเองต้องเป็น "จำนวนเงิน"';
  }
  if (!isSystem && (x.calc === 'WAGE' || x.calc === 'SYSTEM')) return 'วิธีคิดนี้ใช้กับรายการของโปรแกรมเท่านั้น';
  if (x.multiplier != null && x.multiplier !== '' && x.calc !== 'HOURS') return 'ตัวคูณใช้กับรายการแบบชั่วโมงเท่านั้น';
  return null;
}

// ---------------------------------------------------------------- คิดเงินเดือนรายคน
/** M รายเดือน · D รายวัน · H รายชั่วโมง */
export type WageType = 'M' | 'D' | 'H';
export const WAGE_TYPE_TH: Record<WageType, string> = { M: 'รายเดือน', D: 'รายวัน', H: 'รายชั่วโมง' };
export interface PaySettings { hourly_days: number; hourly_hours: number; proration_days: number }
export const PAY_SETTINGS_DEFAULT: PaySettings = { hourly_days: 30, hourly_hours: 8, proration_days: 30 };
export interface SalaryStep { effective_from: string; wage_type: WageType; rate: MoneyInput }
/** บรรทัดที่ผู้ใช้ป้อน/รายการประจำ (ไม่รวมเงินเดือนและรายการของโปรแกรม) */
export interface PayLineInput { item: PayItemDef & { id: string }; qty?: MoneyInput; amount?: MoneyInput; source: 'MANUAL' | 'RECUR' | 'IMPORT'; note?: string | null }
export interface PayLineOut { item_id: string; code: string; name_th: string; kind: PayItemKind; qty: string | null; rate: string | null; multiplier: string | null; amount: string; source: string; note: string | null }
/** ยอดของรอบอื่นในเดือนภาษีเดียวกัน (เช่น รอบโบนัส) — รวมกันแล้วภาษี/ประกันสังคมทั้งเดือนเท่ากับจ่ายรอบเดียว */
export interface SameMonth { regular: MoneyInput; special: MoneyInput; sso_wage: MoneyInput; sso_ee: MoneyInput; sso_er: MoneyInput; pvd: MoneyInput; tax: MoneyInput; tax_special: MoneyInput }
export interface PayCalcInput {
  rules: PayrollTaxRules; sso: SsoRate | null; settings: PaySettings;
  /** R รอบปกติ (มีเงินเดือนและรายการประจำ) · B รอบเพิ่มเติม/โบนัส (เฉพาะที่ป้อน) */
  run_type: 'R' | 'B';
  period_from: string; period_to: string; pay_date: string;
  employee: { hire_date: string; end_date: string | null; tax_bearer: TaxBearer; sso_insured: boolean; pvd_member: boolean; pvd_employee_rate: MoneyInput; pvd_employer_rate: MoneyInput; allowances: AllowanceValues };
  salary: SalaryStep[];
  wage_item: PayItemDef & { id: string };
  system_items: Partial<Record<'TAX' | 'SSO' | 'PVD', PayItemDef & { id: string }>>;
  /** ป้อนเงินเดือนเอง (ต้องมีเหตุผล) — null = ตามประวัติค่าจ้าง */
  salary_manual?: MoneyInput;
  work_days?: MoneyInput; work_hours?: MoneyInput;
  lines: PayLineInput[];
  prior: PaidMonth[];
  same_month?: SameMonth | null;
  tax_manual?: MoneyInput;
}

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const dayNo = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const daysBetween = (a: string, b: string) => Math.round((dayNo(b) - dayNo(a)) / 86400000) + 1;
/** อัตราค่าจ้าง ณ วันที่ (แถวล่าสุดที่มีผลไม่เกินวันนั้น) */
export function salaryOn(steps: SalaryStep[], date: string): SalaryStep | null {
  const s = [...steps].filter((x) => x.effective_from <= date).sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  return s.length ? s[s.length - 1]! : null;
}
/** อัตราค่าจ้างรายชั่วโมง/รายวัน (เก็บ 4 ตำแหน่ง) ของค่าจ้าง ณ ตอนนี้ */
export function baseRates(step: SalaryStep | null, s: PaySettings) {
  if (!step) return { hourly: ZERO, daily: ZERO };
  const r = d(step.rate);
  const q = (x: Decimal) => x.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
  if (step.wage_type === 'M') return { hourly: q(r.div(s.hourly_days).div(s.hourly_hours)), daily: q(r.div(s.hourly_days)) };
  if (step.wage_type === 'D') return { hourly: q(r.div(s.hourly_hours)), daily: r };
  return { hourly: r, daily: q(r.times(s.hourly_hours)) };
}

/** เงินเดือนของงวด: รายเดือนเต็มงวด = อัตราเต็ม · เข้า/ออก/ปรับอัตรากลางงวด = Σ อัตรา × วัน ÷ 30 (ปัดครั้งเดียว) · รายวัน/ชั่วโมง = จำนวน × อัตรา */
export function wageFor(i: Pick<PayCalcInput, 'salary' | 'settings' | 'period_from' | 'period_to' | 'work_days' | 'work_hours' | 'employee'>): { amount: Decimal; qty: string | null; rate: string | null; note: string | null } {
  const from = i.employee.hire_date > i.period_from ? i.employee.hire_date : i.period_from;
  const to = i.employee.end_date && i.employee.end_date < i.period_to ? i.employee.end_date : i.period_to;
  if (to < from) return { amount: ZERO, qty: null, rate: null, note: null };
  const last = salaryOn(i.salary, to);
  if (!last) return { amount: ZERO, qty: null, rate: null, note: 'ไม่มีอัตราค่าจ้าง' };
  if (last.wage_type === 'D') return { amount: round2(d(i.work_days).times(d(last.rate))), qty: d(i.work_days).toFixed(2), rate: d(last.rate).toFixed(2), note: null };
  if (last.wage_type === 'H') return { amount: round2(d(i.work_hours).times(d(last.rate))), qty: d(i.work_hours).toFixed(2), rate: d(last.rate).toFixed(2), note: null };
  // ช่วงที่อัตราคงที่
  const cuts = [...new Set([from, ...i.salary.map((s) => s.effective_from).filter((x) => x > from && x <= to)])].sort();
  const segs = cuts.map((start, k) => {
    const end = k + 1 < cuts.length ? iso(dayNo(cuts[k + 1]!) - 86400000) : to;
    return { start, end, step: salaryOn(i.salary, start) };
  }).filter((s) => s.step);
  const full = from === i.period_from && to === i.period_to;
  if (full && segs.length === 1 && segs[0]!.step!.wage_type === 'M') return { amount: round2(segs[0]!.step!.rate), qty: null, rate: d(segs[0]!.step!.rate).toFixed(2), note: null };
  let amt = ZERO;
  const notes: string[] = [];
  for (const s of segs) {
    if (s.step!.wage_type !== 'M') continue;
    const days = daysBetween(s.start, s.end);
    amt = amt.plus(d(s.step!.rate).times(days).div(i.settings.proration_days));
    notes.push(`${days} วัน × ${d(s.step!.rate).toFixed(2)} ÷ ${i.settings.proration_days}`);
  }
  const days = daysBetween(from, to);
  return { amount: round2(amt), qty: String(days), rate: d(last.rate).toFixed(2), note: notes.join(' + ') };
}

/**
 * คิดเงินเดือนของพนักงานหนึ่งคนในรอบ: บรรทัดเงินได้/เงินหัก → แยกเงินได้ประจำ/ไม่ประจำ → ประกันสังคม (ทั้งเดือนภาษี)
 * → กองทุนสำรองเลี้ยงชีพ → ภาษี (monthTax) → บรรทัดของโปรแกรม → เงินได้สุทธิ
 */
export function calcPay(i: PayCalcInput) {
  const out: PayLineOut[] = [];
  const s = i.settings;
  const nowStep = salaryOn(i.salary, i.period_to) ?? salaryOn(i.salary, i.employee.hire_date);
  const rates = baseRates(nowStep, s);
  const line = (it: PayItemDef & { id: string }, amount: Decimal, source: string, x: { qty?: string | null; rate?: string | null; mult?: string | null; note?: string | null } = {}) =>
    out.push({ item_id: it.id, code: it.code, name_th: it.name_th, kind: it.kind, qty: x.qty ?? null, rate: x.rate ?? null, multiplier: x.mult ?? null, amount: amount.toFixed(2), source, note: x.note ?? null });
  if (i.run_type === 'R') {
    if (i.salary_manual != null && i.salary_manual !== '') line(i.wage_item, round2(i.salary_manual), 'MANUAL', { note: 'ป้อนเอง' });
    else {
      const w = wageFor(i);
      if (!w.amount.isZero() || w.qty) line(i.wage_item, w.amount, 'WAGE', { qty: w.qty, rate: w.rate, note: w.note });
    }
  }
  for (const l of i.lines) {
    if (l.source === 'RECUR' && i.run_type !== 'R') continue;
    const it = l.item;
    if (it.calc === 'HOURS' || it.calc === 'DAYS' || it.calc === 'MINUTES') {
      const qty = d(l.qty);
      if (qty.isZero()) continue;
      const mult = it.calc === 'HOURS' ? d((nowStep?.wage_type === 'D' ? it.multiplier_daily : it.multiplier) ?? it.multiplier ?? 1) : new Decimal(1);
      const base = it.calc === 'DAYS' ? rates.daily : rates.hourly;
      const amt = round2(qty.times(base).times(mult).div(it.calc === 'MINUTES' ? 60 : 1));
      line(it, amt, l.source, { qty: qty.toFixed(2), rate: base.toFixed(4), mult: it.calc === 'HOURS' ? mult.toFixed(2) : null, note: l.note ?? null });
    } else {
      const amt = round2(l.amount);
      if (amt.isZero()) continue;
      line(it, amt, l.source, { note: l.note ?? null });
    }
  }
  // แยกยอด
  const items = new Map<string, PayItemDef>([[i.wage_item.id, i.wage_item], ...i.lines.map((l) => [l.item.id, l.item] as [string, PayItemDef])]);
  let regular = ZERO, special = ZERO, nonTaxable = ZERO, gross = ZERO, ssoWage = ZERO, pvdBase = ZERO, other = ZERO;
  for (const l of out) {
    const it = items.get(l.item_id)!;
    const a = d(l.amount).times(it.sign);
    if (it.kind === 'D') { other = other.plus(a); continue; }
    gross = gross.plus(a);
    if (it.tax_bucket === 'N') nonTaxable = nonTaxable.plus(a);
    else if (it.tax_bucket === 'R') regular = regular.plus(a);
    else special = special.plus(a);
    if (it.sso_base) ssoWage = ssoWage.plus(a);
    if (it.pvd_base) pvdBase = pvdBase.plus(a);
  }
  const sm = i.same_month;
  const smd = (k: keyof SameMonth) => d(sm?.[k]);
  // ประกันสังคม: คิดทั้งเดือนภาษี หักส่วนที่รอบอื่นหักไปแล้ว
  let ssoEe = ZERO, ssoEr = ZERO;
  if (i.employee.sso_insured && i.sso) {
    const c = ssoContribution(smd('sso_wage').plus(ssoWage), i.sso);
    ssoEe = maxD(ZERO, c.employee.minus(smd('sso_ee')));
    ssoEr = maxD(ZERO, c.employer.minus(smd('sso_er')));
  }
  let pvdEe = ZERO, pvdEr = ZERO;
  if (i.employee.pvd_member && pvdBase.gt(0)) {
    pvdEe = round2(pvdBase.times(pct(i.employee.pvd_employee_rate)));
    pvdEr = round2(pvdBase.times(pct(i.employee.pvd_employer_rate)));
  }
  // ภาษี: ทั้งเดือนภาษี แล้วหักภาษีของรอบอื่นในเดือนเดียวกัน
  const y = +i.pay_date.slice(0, 4), m = +i.pay_date.slice(5, 7);
  const startMonth = +i.employee.hire_date.slice(0, 4) === y ? +i.employee.hire_date.slice(5, 7) : 1;
  const endMonth = i.employee.end_date && +i.employee.end_date.slice(0, 4) === y ? +i.employee.end_date.slice(5, 7) : 12;
  const manual = i.tax_manual != null && i.tax_manual !== '';
  const t = monthTax({
    rules: i.rules, allowances: i.employee.allowances, bearer: i.employee.tax_bearer,
    start_month: Math.min(startMonth, m), end_month: Math.max(endMonth, m), month: m, prior: i.prior,
    regular: smd('regular').plus(regular), special: smd('special').plus(special), sso: smd('sso_ee').plus(ssoEe), pvd: smd('pvd').plus(pvdEe),
    tax_manual: manual ? smd('tax').plus(d(i.tax_manual)) : null,
  });
  const tax = i.employee.tax_bearer === 'N' ? ZERO : maxD(ZERO, t.tax.minus(smd('tax')));
  const taxSpecial = i.employee.tax_bearer === 'N' ? ZERO : maxD(ZERO, minD(tax, t.special_tax.minus(smd('tax_special'))));
  const employerPaid = i.employee.tax_bearer === 'O' || i.employee.tax_bearer === 'F' ? tax : ZERO;
  const withheld = tax.minus(employerPaid);
  const sys = i.system_items;
  if (sys.TAX && !withheld.isZero()) line(sys.TAX, withheld, 'SYSTEM', employerPaid.isZero() ? {} : { note: `ภาษีทั้งหมด ${tax.toFixed(2)} บริษัทออกให้ ${employerPaid.toFixed(2)}` });
  if (sys.SSO && !ssoEe.isZero()) line(sys.SSO, ssoEe, 'SYSTEM');
  if (sys.PVD && !pvdEe.isZero()) line(sys.PVD, pvdEe, 'SYSTEM', { note: `${d(i.employee.pvd_employee_rate).toFixed(2)}% ของ ${pvdBase.toFixed(2)}` });
  const net = gross.minus(withheld).minus(ssoEe).minus(pvdEe).minus(other);
  return {
    lines: out,
    regular: round2(regular), special: round2(special), non_taxable: round2(nonTaxable), gross: round2(gross),
    sso_wage: round2(ssoWage), sso_ee: ssoEe, sso_er: ssoEr, pvd_base: round2(pvdBase), pvd_ee: pvdEe, pvd_er: pvdEr,
    tax, tax_special: taxSpecial, employer_paid_tax: employerPaid, other_deductions: round2(other), net_pay: round2(net),
    calc: {
      tax_year: y, start_month: startMonth, end_month: endMonth, remaining: t.remaining, annual_regular_income: t.annual_regular_income.toFixed(2),
      annual_income: t.annual_income.toFixed(2), sso_annual: t.sso_annual.toFixed(2), pvd_annual: t.pvd_annual.toFixed(2),
      annual_regular_tax: t.annual_regular_tax.toFixed(2), annual_tax_estimate: t.annual_tax_estimate.toFixed(2), annual_net_income: t.annual_net_income.toFixed(2),
      regular_tax: t.regular_tax.toFixed(2), special_tax: t.special_tax.toFixed(2), month_tax: t.tax.toFixed(2), other_runs_tax: smd('tax').toFixed(2),
      tax_ytd: d(t.tax_ytd).toFixed(2), over_withheld: t.over_withheld.toFixed(2), tax_manual: manual, bearer: i.employee.tax_bearer,
      allowances: t.allowances.lines.map((l) => ({ code: l.code, name_th: l.name_th, amount: l.amount.toFixed(2) })),
    },
  };
}

// ---------------------------------------------------------------- ใบสำคัญเงินเดือน
export interface PayPostEmployee {
  department_id: string | null;
  lines: Array<{ amount: MoneyInput; kind: PayItemKind; sign: 1 | -1; gl_role: string; account_id?: string | null; system_code?: string | null }>;
  tax: MoneyInput; employer_paid_tax: MoneyInput; sso_ee: MoneyInput; sso_er: MoneyInput; pvd_ee: MoneyInput; pvd_er: MoneyInput; net_pay: MoneyInput;
}
export interface PayPostLine { role: string; account_id: string | null; department_id: string | null; debit: string; credit: string }
/**
 * ใบสำคัญเงินเดือน (ตั้งค้างจ่าย) หนึ่งใบต่อรอบ รวมตามบัญชี × แผนก ไม่แสดงชื่อพนักงาน:
 * Dr เงินได้แต่ละรายการ (หักขาด/มาสายเป็นยอดลบ) + เงินสมทบนายจ้าง + ภาษีที่บริษัทออกให้ ·
 * Cr ภาษีหัก ณ ที่จ่าย ภ.ง.ด.1 (ทั้งหมดที่ต้องนำส่ง) · ประกันสังคม (ลูกจ้าง+นายจ้าง) · กองทุนสำรองฯ · เงินหักอื่น · เงินเดือนค้างจ่าย (สุทธิ)
 * หนี้สินรวมเป็นบรรทัดเดียวไม่แยกแผนก · account_id ของรายการ (ถ้ากำหนด) ชนะบทบาท
 */
export function payrollJournal(emps: PayPostEmployee[]): PayPostLine[] {
  const g = new Map<string, { role: string; account_id: string | null; department_id: string | null; amt: Decimal }>();
  const add = (role: string, account: string | null | undefined, dept: string | null, amt: Decimal) => {
    if (amt.isZero()) return;
    const k = `${role}|${account ?? ''}|${dept ?? ''}`;
    const e = g.get(k) ?? { role, account_id: account ?? null, department_id: dept, amt: ZERO };
    e.amt = e.amt.plus(amt); g.set(k, e);
  };
  for (const e of emps) {
    for (const l of e.lines) {
      if (l.system_code === 'TAX' || l.system_code === 'SSO' || l.system_code === 'PVD') continue;
      const a = d(l.amount).times(l.sign);
      if (l.kind === 'E') add(l.gl_role, l.account_id, e.department_id, a);
      else add(l.gl_role, l.account_id, null, a.neg());
    }
    add('PAY_SSO_EXPENSE', null, e.department_id, d(e.sso_er));
    add('PAY_PVD_EXPENSE', null, e.department_id, d(e.pvd_er));
    add('PAY_TAX_BORNE', null, e.department_id, d(e.employer_paid_tax));
    add('PAY_WHT1_PAYABLE', null, null, d(e.tax).neg());
    add('PAY_SSO_PAYABLE', null, null, d(e.sso_ee).plus(d(e.sso_er)).neg());
    add('PAY_PVD_PAYABLE', null, null, d(e.pvd_ee).plus(d(e.pvd_er)).neg());
    add('PAY_ACCRUED', null, null, d(e.net_pay).neg());
  }
  return [...g.values()].filter((x) => !x.amt.isZero())
    .sort((a, b) => (a.amt.gt(0) ? 0 : 1) - (b.amt.gt(0) ? 0 : 1))
    .map((x) => ({ role: x.role, account_id: x.account_id, department_id: x.department_id, debit: x.amt.gt(0) ? x.amt.toFixed(2) : '0.00', credit: x.amt.lt(0) ? x.amt.neg().toFixed(2) : '0.00' }));
}
