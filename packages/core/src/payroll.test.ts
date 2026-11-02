import { describe, expect, it } from 'vitest';
import {
  allowanceBreakdown, annualTax, calcPay, checkAllowances, checkTaxRules, monthTax, PAY_ITEM_DEFAULTS, payrollJournal, serviceLength, severanceDays,
  severanceSeparateTax, severanceSplit, ssoContribution, ssoRateOn, taxRulesFor, wageFor,
  type PaidMonth, type PayCalcInput, type PayItemDef, type PayrollTaxRules, type TaxBearer,
} from './payroll.js';

/** ตัวเลขชุดเดียวกับชุดทดสอบระบบเงินเดือนของ WTS-ERP (Payroll-WHT ของเจ้าของ) */
const RULES = taxRulesFor(2026).rules;
const OLD_SSO: PayrollTaxRules = { ...RULES, sso_yearly_cap: '9000' };

function runYear(rules: PayrollTaxRules, months: Array<{ regular: string; special?: string; sso: string; tax_manual?: string }>, o: { bearer?: TaxBearer; start?: number; allowances?: Record<string, string | number | boolean> } = {}) {
  const start = o.start ?? 1;
  const prior: PaidMonth[] = [];
  return months.map((m, k) => {
    const r = monthTax({ rules, allowances: o.allowances ?? {}, bearer: o.bearer ?? 'W', start_month: start, end_month: 12, month: start + k, prior, regular: m.regular, special: m.special ?? '0', sso: m.sso, tax_manual: m.tax_manual ?? null });
    prior.push({ regular: m.regular, special: m.special ?? '0', tax: r.tax.toFixed(2), special_tax: r.special_tax.toFixed(2), sso: m.sso });
    return r;
  });
}
const taxes = (rows: ReturnType<typeof runYear>) => rows.map((r) => r.tax.toFixed(2));

describe('ภาษีเงินเดือน ภ.ง.ด.1 (ป.96/2543 — ตัวเลขเดียวกับ WTS-ERP)', () => {
  it('กฎหมายปี 2569: ขั้นภาษี ค่าใช้จ่าย ลดหย่อนส่วนตัว เพดานประกันสังคม 10,500', () => {
    expect(RULES.expense_cap).toBe('100000');
    expect(RULES.personal).toBe('60000');
    expect(RULES.sso_yearly_cap).toBe('10500.00');
    expect(taxRulesFor(2025).rules.sso_yearly_cap).toBe('9000.00');
    expect(taxRulesFor(2030)).toMatchObject({ lawYear: 2026 });   // ปีที่ยังไม่มีตาราง ใช้ปีล่าสุดแล้วเตือน
    expect(taxRulesFor(2030).rules.sso_yearly_cap).toBe('12000.00');   // เพดาน 20,000 ตั้งแต่ปี 2572
  });
  it('A. 50,000 ต่อเดือน + เงินได้ไม่ประจำ ม.ค./ก.พ. (เพดานประกันสังคมเดิม 9,000)', () => {
    const rows = runYear(OLD_SSO, [{ regular: '50000', special: '20000', sso: '750' }, { regular: '50000', special: '60000', sso: '750' }, { regular: '50000', sso: '750' }]);
    expect(taxes(rows)).toEqual(['3716.67', '8266.67', '1716.67']);
    expect(rows[0]!.annual_regular_tax.toFixed(2)).toBe('20600.00');
    expect(rows[1]!.special_tax.toFixed(2)).toBe('6550.00');
  });
  it('B. ชุดเดียวกันด้วยเพดานปี 2569 (875 / 10,500)', () => {
    const rows = runYear(RULES, [{ regular: '50000', special: '20000', sso: '875' }, { regular: '50000', special: '60000', sso: '875' }, { regular: '50000', sso: '875' }]);
    expect(taxes(rows)).toEqual(['3704.17', '8179.17', '1704.17']);
    expect(rows[1]!.special_tax.toFixed(2)).toBe('6475.00');
  });
  it('C. ขึ้นเงินเดือนเดือน ก.ค. — ภาษีทั้งปีรวมได้พอดี 26,450.00', () => {
    const rows = runYear(RULES, Array.from({ length: 12 }, (_, k) => ({ regular: k < 6 ? '50000' : '60000', sso: '875' })));
    expect(taxes(rows).slice(0, 6)).toEqual(['1704.17', '1704.17', '1704.17', '1704.17', '1704.17', '1704.16']);
    expect(taxes(rows).slice(6)).toEqual(['2704.17', '2704.16', '2704.17', '2704.16', '2704.17', '2704.16']);
    expect(rows[11]!.tax_ytd.toFixed(2)).toBe('26450.00');
  });
  it('D. ผู้รับภาระภาษี: หัก ณ ที่จ่าย / ออกให้ครั้งเดียว / ออกให้ตลอดไป / ไม่หัก', () => {
    const one = (bearer: TaxBearer) => runYear(RULES, [{ regular: '30000', sso: '875' }], { bearer })[0]!;
    expect(one('W').tax.toFixed(2)).toBe('164.58');
    expect(one('O').tax.toFixed(2)).toBe('172.81');
    expect(one('O').employer_paid_tax.toFixed(2)).toBe('172.81');
    expect(one('F').tax.toFixed(2)).toBe('173.25');
    expect(one('N').tax.toFixed(2)).toBe('0.00');
  });
  it('E. ลดเงินเดือนหนึ่งเดือน แล้วกลับมาเท่าเดิม', () => {
    expect(taxes(runYear(RULES, [{ regular: '30000', sso: '875' }, { regular: '20000', sso: '875' }, { regular: '30000', sso: '875' }]))).toEqual(['164.58', '0.00', '131.04']);
  });
  it('F. OT 10 ชั่วโมงเดือน ก.ย. บนเงินเดือน 30,000', () => {
    const rows = runYear(RULES, Array.from({ length: 9 }, (_, k) => ({ regular: '30000', special: k === 8 ? '1875' : '0', sso: '875' })));
    expect(taxes(rows)).toEqual(['164.58', '164.58', '164.58', '164.58', '164.59', '164.58', '164.59', '164.58', '258.34']);
    expect(rows[8]!.special_tax.toFixed(2)).toBe('93.75');
    expect(rows[8]!.tax_ytd.toFixed(2)).toBe('1575.00');
  });
  it('เริ่มงานเดือน เม.ย. 45,000: คิด 9 ครั้ง 405,000 − 100,000 − 60,000 − 7,875 → ภาษีปี 4,356.25', () => {
    const r = runYear(RULES, [{ regular: '45000', sso: '875' }], { start: 4 })[0]!;
    expect(r.periods).toBe(9);
    expect(r.annual_regular_income.toFixed(2)).toBe('405000.00');
    expect(r.annual_regular_tax.toFixed(2)).toBe('4356.25');
    expect(r.tax.toFixed(2)).toBe('484.03');
  });
  it('ภาษีป้อนเอง: เก็บตามที่ป้อน ผลต่างเฉลี่ยไปเดือนที่เหลือ', () => {
    const rows = runYear(RULES, [{ regular: '30000', sso: '875', tax_manual: '500' }, { regular: '30000', sso: '875' }]);
    expect(taxes(rows)).toEqual(['500.00', '134.09']);
    expect(rows[0]!.tax_manual).toBe(true);
  });
});

describe('ค่าลดหย่อน', () => {
  const amount = (b: ReturnType<typeof allowanceBreakdown>, code: string) => b.lines.find((l) => l.code === code)?.amount.toFixed(2);
  it('บุตร บิดามารดา (สูงสุด 4 คน)', () => {
    const b = allowanceBreakdown(RULES, { spouse: true, child: 1, child2: 2, parent: 9 }, '600000', '10500');
    expect([amount(b, 'spouse'), amount(b, 'child'), amount(b, 'child2'), amount(b, 'parent')]).toEqual(['60000.00', '30000.00', '120000.00', '120000.00']);
    expect(b.total.toFixed(2)).toBe('500500.00');
  });
  it('ประกันสุขภาพ 25,000 · ชีวิต+สุขภาพ 100,000 · กลุ่มเกษียณ 500,000 · ThaiESG เพดานแยก 300,000', () => {
    const b = allowanceBreakdown(RULES, { life_ins: '90000', health_ins: '30000', rmf: '400000', ssf: '200000', thai_esg: '400000' }, '1200000', '10500');
    expect(amount(b, 'group:life_health')).toBe('100000.00');
    expect(amount(b, 'group:retirement')).toBe('500000.00');
    expect(amount(b, 'thai_esg')).toBe('300000.00');
  });
  it('กองทุนสำรองเลี้ยงชีพที่หักผ่านเงินเดือนนับรวมให้เอง ไม่เกิน 15%', () => {
    expect(amount(allowanceBreakdown(RULES, { pvd: '1000' }, '360000', '10500', '10800'), 'pvd')).toBe('11800.00');
    expect(amount(allowanceBreakdown(RULES, {}, '360000', '10500', '90000'), 'pvd')).toBe('54000.00');
  });
  it('เงินบริจาคคิดท้ายสุด: การศึกษา 2 เท่า แต่ละอย่างไม่เกิน 10% ของที่เหลือ', () => {
    const v = { donation_edu: '10000', donation: '5000' };
    const b = allowanceBreakdown(RULES, v, '360000', '10500');
    expect([amount(b, 'donation_edu'), amount(b, 'donation')]).toEqual(['18950.00', '5000.00']);
    expect(b.netIncome.toFixed(2)).toBe('165550.00');
    expect(annualTax(RULES, v, '360000', '10500').toFixed(2)).toBe('777.50');
  });
  it('ตรวจค่าที่ป้อน: จำนวนคนต้องเป็นจำนวนเต็ม ไม่ใช่จำนวนเงิน', () => {
    expect(checkAllowances(RULES, { child: 2, life_ins: '15000' })).toBeNull();
    expect(checkAllowances(RULES, { child: '30000' })).toMatch(/จำนวนคน/);
    expect(checkAllowances(RULES, { nope: 1 })).toMatch(/ไม่รู้จัก/);
  });
  it('ตรวจขั้นภาษีที่บริษัทแก้เอง', () => {
    expect(checkTaxRules(RULES)).toBeNull();
    expect(checkTaxRules({ ...RULES, brackets: [{ from: '0', to: '150000', rate: '0' }, { from: '160000', to: null, rate: '5' }] })).toMatch(/ถัดไป/);
    expect(checkTaxRules({ ...RULES, brackets: [{ from: '0', to: '150000', rate: '0' }] })).toMatch(/สุดท้าย/);
  });
});

describe('ประกันสังคม', () => {
  const R = ssoRateOn('2026-06-30')!;
  it('5% ของค่าจ้าง 1,650–17,500 ปัดเป็นบาท 83–875', () => {
    const c = (w: string) => ssoContribution(w, R).employee.toFixed(2);
    expect([c('30000'), c('15000'), c('12345'), c('12350'), c('1000'), c('0')]).toEqual(['875.00', '750.00', '617.00', '618.00', '83.00', '0.00']);
    expect(ssoContribution('30000', R).employer.toFixed(2)).toBe('875.00');
  });
  it('เพดานตามวันที่: 750 ปี 2568 · 875 ปี 2569–2571 · 1,000 ปี 2572 · 1,150 ปี 2575', () => {
    expect(['2025-12-31', '2026-01-01', '2028-12-31', '2029-01-01', '2032-01-01'].map((x) => ssoRateOn(x)!.monthly_max)).toEqual(['750', '875', '875', '1000', '1150']);
  });
});

describe('เงินชดเชย (สูตรสำหรับระยะ 4)', () => {
  it('อายุงานและจำนวนวันตาม ม.118', () => {
    expect(serviceLength('2020-01-01', '2026-06-30')).toMatchObject({ full_years: 6, remain_days: 181, years_for_tax: 6 });
    expect(serviceLength('2020-01-01', '2026-07-02')).toMatchObject({ years_for_tax: 7 });
    expect(severanceDays(serviceLength('2020-01-01', '2026-06-30'))).toBe(240);
    expect(severanceDays(serviceLength('2026-01-01', '2026-03-31'))).toBe(0);
  });
  it('ยกเว้นไม่เกิน 400 วัน/600,000 · แยกยื่น ม.48(5)', () => {
    expect(severanceSplit('500000', '1000', true).exempt.toFixed(2)).toBe('400000.00');
    expect(severanceSplit('900000', '2000', true).taxable.toFixed(2)).toBe('300000.00');
    expect(severanceSplit('500000', '1000', false).taxable.toFixed(2)).toBe('500000.00');
    expect(severanceSeparateTax('1000000', 5, RULES.brackets).tax.toFixed(2)).toBe('25750.00');
    expect(severanceSeparateTax('100000', 6, RULES.brackets).net.toFixed(2)).toBe('29000.00');
  });
});

// ---- คิดเงินเดือนรายคน (ตัวเลขจากชุดทดสอบรอบเงินเดือนของ WTS-ERP)
const ITEMS = Object.fromEntries(PAY_ITEM_DEFAULTS.map((x) => [x.code, { ...x, id: x.code }])) as Record<string, PayItemDef & { id: string }>;
const base = (p: Partial<PayCalcInput> & { emp?: Partial<PayCalcInput['employee']> } = {}): PayCalcInput => ({
  rules: RULES, sso: ssoRateOn('2026-01-31'), settings: { hourly_days: 30, hourly_hours: 8, proration_days: 30 }, run_type: 'R',
  period_from: '2026-01-01', period_to: '2026-01-31', pay_date: '2026-01-31',
  salary: [{ effective_from: '2026-01-01', wage_type: 'M', rate: '30000' }],
  wage_item: ITEMS.IN001!, system_items: { TAX: ITEMS.ES001, SSO: ITEMS.ES002, PVD: ITEMS.ES003 }, lines: [], prior: [], ...p,
  employee: { hire_date: '2025-01-01', end_date: null, tax_bearer: 'W', sso_insured: true, pvd_member: false, pvd_employee_rate: 0, pvd_employer_rate: 0, allowances: {}, ...p.emp },
});

describe('คิดเงินเดือนรายคน', () => {
  it('เดือน ม.ค. 30,000: ประกันสังคม 875/875 ภาษี 164.58 สุทธิ 28,960.42', () => {
    const r = calcPay(base());
    expect([r.regular, r.sso_ee, r.sso_er, r.tax, r.net_pay].map((x) => x.toFixed(2))).toEqual(['30000.00', '875.00', '875.00', '164.58', '28960.42']);
    expect(r.calc.annual_regular_tax).toBe('1975.00');
    expect(r.calc.annual_net_income).toBe('189500.00');
    expect(r.lines.map((l) => l.code)).toEqual(['IN001', 'ES001', 'ES002']);
  });
  it('เข้างาน 16 ม.ค.: 16 วัน × 30,000 ÷ 30 + รายการประจำ 1,500 + หักเบิกล่วงหน้า 2,000', () => {
    const r = calcPay(base({ emp: { hire_date: '2026-01-16' }, salary: [{ effective_from: '2026-01-16', wage_type: 'M', rate: '30000' }], lines: [{ item: ITEMS.IN006!, amount: '1500', source: 'RECUR' }, { item: ITEMS.ES005!, amount: '2000', source: 'RECUR' }] }));
    expect(r.lines[0]).toMatchObject({ code: 'IN001', amount: '16000.00', qty: '16', note: '16 วัน × 30000.00 ÷ 30' });
    expect([r.special, r.gross, r.sso_ee, r.tax, r.other_deductions, r.net_pay].map((x) => x.toFixed(2))).toEqual(['1500.00', '17500.00', '800.00', '0.00', '2000.00', '14700.00']);
  });
  it('รายวัน 400: ยังไม่ป้อนวัน = 0 · 20 วัน = 8,000 ประกันสังคม 400', () => {
    const daily = { salary: [{ effective_from: '2025-01-01', wage_type: 'D' as const, rate: '400' }] };
    expect(calcPay(base(daily)).gross.toFixed(2)).toBe('0.00');
    const r = calcPay(base({ ...daily, work_days: '20' }));
    expect([r.gross, r.sso_ee, r.net_pay].map((x) => x.toFixed(2))).toEqual(['8000.00', '400.00', '7600.00']);
  });
  it('เดือน ก.พ. OT 10 ชั่วโมง: 125 × 1.5 × 10 = 1,875 ภาษี 258.33 (ส่วน ข 93.75)', () => {
    const prior: PaidMonth[] = [{ regular: '30000', special: '0', tax: '164.58', special_tax: '0', sso: '875' }];
    const r = calcPay(base({ period_from: '2026-02-01', period_to: '2026-02-28', pay_date: '2026-02-28', prior, lines: [{ item: ITEMS.IN002!, qty: '10', source: 'MANUAL' }] }));
    expect(r.lines.find((l) => l.code === 'IN002')).toMatchObject({ amount: '1875.00', rate: '125.0000', multiplier: '1.50' });
    expect([r.tax, r.tax_special, r.net_pay].map((x) => x.toFixed(2))).toEqual(['258.33', '93.75', '30741.67']);
  });
  it('ขาดงาน 1 วัน มาสาย 20 นาที OT วันหยุด (รายเดือน 30,000)', () => {
    const r = calcPay(base({ lines: [{ item: ITEMS.IN002!, qty: '2', source: 'MANUAL' }, { item: ITEMS.IN003!, qty: '12', source: 'MANUAL' }, { item: ITEMS.IN004!, qty: '2', source: 'MANUAL' }, { item: ITEMS.IN013!, qty: '20', source: 'MANUAL' }, { item: ITEMS.IN012!, qty: '1', source: 'MANUAL' }] }));
    expect(r.lines.slice(1, 6).map((l) => l.amount)).toEqual(['375.00', '1500.00', '750.00', '41.67', '1000.00']);
    expect(r.gross.toFixed(2)).toBe('31583.33');
  });
  it('รายวัน 450: 20 วัน + OT 4 ชม. + เสาร์ 8 ชม. (2 เท่า) − สาย 50 นาที = 10,190.62', () => {
    const r = calcPay(base({ salary: [{ effective_from: '2025-01-01', wage_type: 'D', rate: '450' }], work_days: '20', lines: [{ item: ITEMS.IN002!, qty: '4', source: 'MANUAL' }, { item: ITEMS.IN003!, qty: '8', source: 'MANUAL' }, { item: ITEMS.IN013!, qty: '50', source: 'MANUAL' }] }));
    expect(r.gross.toFixed(2)).toBe('10190.62');
  });
  it('ปรับเงินเดือนกลางเดือน: คิดตามวันแต่ละช่วง', () => {
    const w = wageFor(base({ salary: [{ effective_from: '2025-01-01', wage_type: 'M', rate: '30000' }, { effective_from: '2026-01-16', wage_type: 'M', rate: '36000' }] }));
    expect([w.amount.toFixed(2), w.note]).toEqual(['34200.00', '15 วัน × 30000.00 ÷ 30 + 16 วัน × 36000.00 ÷ 30']);
  });
  it('รอบโบนัสในเดือนเดียวกัน: ไม่มีเงินเดือน ภาษีส่วนเพิ่มเท่านั้น ประกันสังคมไม่หักซ้ำ', () => {
    const same = { regular: '30000', special: '0', sso_wage: '30000', sso_ee: '875', sso_er: '875', pvd: '0', tax: '164.58', tax_special: '0' };
    const r = calcPay(base({ run_type: 'B', same_month: same, lines: [{ item: ITEMS.IN008!, amount: '60000', source: 'MANUAL' }] }));
    expect(r.lines.map((l) => l.code)).toEqual(['IN008', 'ES001']);
    expect([r.sso_ee, r.tax].map((x) => x.toFixed(2))).toEqual(['0.00', '3000.00']);   // 60,000 × 5% (เงินได้สุทธิทั้งปีอยู่ขั้น 150,000–300,000)
  });
  it('บริษัทออกภาษีให้: ไม่หักจากเงินเดือน สุทธิไม่ลด', () => {
    const r = calcPay(base({ emp: { tax_bearer: 'O' } }));
    expect([r.tax, r.employer_paid_tax, r.net_pay].map((x) => x.toFixed(2))).toEqual(['172.81', '172.81', '29125.00']);
    expect(r.lines.some((l) => l.code === 'ES001')).toBe(false);
  });
  it('กองทุนสำรองเลี้ยงชีพ 3%/3% ของเงินเดือน', () => {
    const r = calcPay(base({ emp: { pvd_member: true, pvd_employee_rate: '3', pvd_employer_rate: '3' } }));
    expect([r.pvd_ee, r.pvd_er].map((x) => x.toFixed(2))).toEqual(['900.00', '900.00']);
  });
});

describe('ใบสำคัญเงินเดือน', () => {
  it('รวมตามบัญชี × แผนก — ตัวอย่าง A 30,000 แผนก ACC · B 20,000 + เบี้ยเลี้ยง 1,000 + หักอื่น 500', () => {
    const L = (code: string, amount: string) => { const it = ITEMS[code]!; return { amount, kind: it.kind, sign: it.sign, gl_role: it.gl_role, system_code: it.system_code }; };
    const j = payrollJournal([
      { department_id: 'ACC', lines: [L('IN001', '30000'), L('ES001', '164.58'), L('ES002', '875')], tax: '164.58', employer_paid_tax: '0', sso_ee: '875', sso_er: '875', pvd_ee: '0', pvd_er: '0', net_pay: '28960.42' },
      { department_id: null, lines: [L('IN001', '20000'), L('IN006', '1000'), L('ES007', '500'), L('ES002', '875')], tax: '0', employer_paid_tax: '0', sso_ee: '875', sso_er: '875', pvd_ee: '0', pvd_er: '0', net_pay: '19625.00' },
    ]);
    const dr = j.reduce((s, l) => s + Number(l.debit) * 100, 0) / 100, cr = j.reduce((s, l) => s + Number(l.credit) * 100, 0) / 100;
    expect(dr).toBe(52750);
    expect(cr).toBe(52750);
    expect(j.map((l) => `${l.role}|${l.department_id ?? ''}|${l.debit}|${l.credit}`)).toEqual([
      'PAY_SALARY|ACC|30000.00|0.00', 'PAY_SSO_EXPENSE|ACC|875.00|0.00', 'PAY_SALARY||20000.00|0.00', 'PAY_ALLOWANCE||1000.00|0.00', 'PAY_SSO_EXPENSE||875.00|0.00',
      'PAY_WHT1_PAYABLE||0.00|164.58', 'PAY_SSO_PAYABLE||0.00|3500.00', 'PAY_ACCRUED||0.00|48585.42', 'PAY_DEDUCTION_PAYABLE||0.00|500.00',
    ]);
  });
});
