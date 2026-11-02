import { d, round2, ZERO, type MoneyInput } from './money.js';
import { bearerCondition, type SsoRate, type TaxBearer } from './payroll.js';
import type { Wht50Data, Wht50Party } from './forms/wht50.js';

/**
 * แบบฟอร์มระบบเงินเดือน (ระยะ 2): ภ.ง.ด.1 / ภ.ง.ด.1ก · 50 ทวิ ประจำปี (ใช้แบบ 50 ทวิ ของกรมสรรพากรตัวเดิม) · สปส.1-10
 * ยอดมาจากรอบเงินเดือนที่บันทึกแล้ว (สถานะ N/P) — ร่างไม่นับ
 */

/** ที่อยู่ตามทะเบียนบ้านแบบไทย — กรุงเทพฯ ใช้ แขวง/เขต ที่อื่นใช้ ตำบล/อำเภอ */
export interface ThaiAddress { house_no?: string | null; moo?: string | null; village?: string | null; building?: string | null; soi?: string | null; road?: string | null;
  subdistrict?: string | null; district?: string | null; province?: string | null; postcode?: string | null }
export function thaiAddress(a: ThaiAddress): string {
  const bkk = /กรุงเทพ/.test(a.province ?? '');
  const t = (v: string | null | undefined) => (v ?? '').trim();
  const part = (label: string, v: string | null | undefined) => (t(v) ? `${label}${t(v)}` : '');
  return [part('เลขที่ ', a.house_no), part('หมู่ ', a.moo), part('', a.building), part('หมู่บ้าน', a.village), part('ซอย', a.soi), part('ถนน', a.road),
    part(bkk ? 'แขวง' : 'ตำบล', a.subdistrict), part(bkk ? 'เขต' : 'อำเภอ', a.district), part(bkk ? '' : 'จังหวัด', a.province), t(a.postcode)].filter(Boolean).join(' ');
}
/** ที่อยู่ครบสำหรับ ภ.ง.ด.1ก (ต้องมีตำบล อำเภอ จังหวัด รหัสไปรษณีย์ 5 หลัก) */
export const addressProblem = (a: ThaiAddress) => (!a.subdistrict || !a.district || !a.province || !/^\d{5}$/.test(a.postcode ?? '') ? 'ที่อยู่ตามทะเบียนบ้านไม่ครบ (ตำบล อำเภอ จังหวัด รหัสไปรษณีย์)' : null);

/** ยอดของพนักงานหนึ่งคนในช่วง (เดือน/ปี) จากรอบเงินเดือนที่บันทึกแล้ว */
export interface PayTotals { regular: MoneyInput; special: MoneyInput; employer_paid_tax: MoneyInput; tax: MoneyInput; sso_ee: MoneyInput; pvd_ee: MoneyInput }
/** เงินได้ตามมาตรา 40(1) ที่ยื่น = ประจำ + ไม่ประจำ + ภาษีที่บริษัทออกให้ (เงินที่ไม่ต้องเสียภาษีไม่นับ) */
export const pnd1Income = (t: Pick<PayTotals, 'regular' | 'special' | 'employer_paid_tax'>) => round2(d(t.regular).plus(d(t.special)).plus(d(t.employer_paid_tax)));

export interface Pnd1Person { employee_id: string; code: string; title: string | null; first_name: string; last_name: string | null; tax_id: string | null; bearer: TaxBearer; pay_date: string; totals: PayTotals; address?: string }
export interface Pnd1Row { no: number; employee_id: string; code: string; tax_id: string | null; title: string | null; first_name: string; last_name: string | null; pay_date: string; income: string; tax: string; condition: '1' | '2' | '3'; address?: string; problem: string | null }
/** แถวใบแนบ ภ.ง.ด.1/1ก: เรียงตามรหัส · ไม่มีเงินได้ไม่แสดง · taxedOnly = เฉพาะคนที่ถูกหักภาษี */
export function pnd1Rows(people: Pnd1Person[], opt: { taxedOnly?: boolean } = {}) {
  const rows: Pnd1Row[] = [];
  for (const p of [...people].sort((a, b) => a.code.localeCompare(b.code))) {
    const income = pnd1Income(p.totals);
    const tax = round2(p.totals.tax);
    if (income.lte(0) && tax.lte(0)) continue;
    if (opt.taxedOnly && tax.lte(0)) continue;
    const id = (p.tax_id ?? '').replace(/\D/g, '');
    rows.push({ no: rows.length + 1, employee_id: p.employee_id, code: p.code, tax_id: p.tax_id, title: p.title, first_name: p.first_name, last_name: p.last_name, pay_date: p.pay_date,
      income: income.toFixed(2), tax: tax.toFixed(2), condition: bearerCondition(p.bearer) as '1' | '2' | '3', address: p.address,
      problem: !p.tax_id ? 'ไม่มีเลขประจำตัวประชาชน' : id.length === 13 ? null : /^[A-Z0-9]{6,20}$/i.test(p.tax_id) ? null : 'เลขประจำตัวประชาชนไม่ครบ 13 หลัก' });
  }
  const total = rows.reduce((s, r) => ({ income: s.income.plus(r.income), tax: s.tax.plus(r.tax) }), { income: ZERO, tax: ZERO });
  return { rows, count: rows.length, income: total.income.toFixed(2), tax: total.tax.toFixed(2) };
}

/** 50 ทวิ ประจำปีของพนักงาน (แบบ ภ.ง.ด.1ก · เงินได้ 40(1) บรรทัดที่ 1) */
export function payWht50(i: { payer: Wht50Party; payee: Wht50Party; book_no: string; run_no: string; issue_date: string; totals: PayTotals; bearer: TaxBearer }): Wht50Data {
  const income = pnd1Income(i.totals);
  return {
    book_no: i.book_no, run_no: i.run_no, payer: i.payer, payee: i.payee, form: '1ก',
    lines: [{ row: '1', date: i.issue_date, amount: income.toFixed(2), tax: round2(i.totals.tax).toFixed(2) }],
    funds: { sso: d(i.totals.sso_ee).isZero() ? '' : round2(i.totals.sso_ee).toFixed(2), pvd: d(i.totals.pvd_ee).isZero() ? '' : round2(i.totals.pvd_ee).toFixed(2) },
    condition: bearerCondition(i.bearer) as Wht50Data['condition'], issue_date: i.issue_date,
  };
}
/** วันที่ออกหนังสือรับรอง: 31 ธ.ค. หรือวันที่ออกจากงานในปีนั้น */
export const w50IssueDate = (year: number, endDate: string | null) => (endDate && endDate.slice(0, 4) === String(year) ? endDate : `${year}-12-31`);

/** สปส.1-10 ส่วนที่ 2: ค่าจ้างที่ใช้คำนวณ (ไม่ต่ำ/ไม่เกินฐาน) + เงินสมทบผู้ประกันตน · ส่วนที่ 1: รวมค่าจ้าง เงินสมทบลูกจ้าง/นายจ้าง */
export interface SsoPerson { employee_id: string; code: string; title: string | null; first_name: string; last_name: string | null; tax_id: string | null; wage: MoneyInput; ee: MoneyInput; er: MoneyInput }
export function ssoForm(people: SsoPerson[], rate: SsoRate | null) {
  const rows = [...people].filter((p) => d(p.wage).gt(0) || d(p.ee).gt(0)).sort((a, b) => a.code.localeCompare(b.code)).map((p, k) => {
    const wage = d(p.wage);
    const capped = rate ? round2(wage.lt(rate.wage_min) ? d(rate.wage_min) : wage.gt(rate.wage_max) ? d(rate.wage_max) : wage) : round2(wage);
    const id = (p.tax_id ?? '').replace(/\D/g, '');
    return { no: k + 1, employee_id: p.employee_id, code: p.code, tax_id: p.tax_id, title: p.title, first_name: p.first_name, last_name: p.last_name, wage_paid: round2(wage).toFixed(2), wage: capped.toFixed(2),
      ee: round2(p.ee).toFixed(2), er: round2(p.er).toFixed(2), problem: id.length === 13 ? null : 'ไม่มีเลขประจำตัวประชาชน 13 หลัก' };
  });
  const sumOf = (k: 'wage' | 'ee' | 'er' | 'wage_paid') => rows.reduce((s, r) => s.plus(r[k]), ZERO).toFixed(2);
  const ee = sumOf('ee'), er = sumOf('er');
  return { rows, count: rows.length, wage: sumOf('wage'), wage_paid: sumOf('wage_paid'), ee, er, total: d(ee).plus(er).toFixed(2), employee_rate: rate?.employee_rate ?? '', employer_rate: rate?.employer_rate ?? '' };
}
