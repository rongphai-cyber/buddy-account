import { d, round2 } from './money.js';
import { taxIdCheckDigit } from './taxid.js';
import { BE_OFFSET } from './date.js';

/**
 * แฟ้มยื่นแบบระบบเงินเดือน (ระยะ 3) — รูปแบบเดียวกับระบบเงินเดือนของ WTS-ERP
 * - RD Prep (โปรแกรมโอนย้ายข้อมูลของกรมสรรพากร): ไม่มีหัว · ช่องคั่นด้วย | · CRLF ทุกบรรทัด · UTF-8 หรือ TIS-620
 * - e-Filing "FORMAT กลาง v2.0" (16/06/2568): บรรทัด H 22 ช่อง + D 26 ช่อง · CRLF ระหว่างบรรทัด ไม่มีขึ้นบรรทัดท้ายแฟ้ม
 * - ไฟล์โอนเงินเดือน CSV (UTF-8 BOM)
 * ⚠️ ต้องลองนำเข้าโปรแกรมของกรมสรรพากรจริงก่อนยื่นครั้งแรก
 */

/** อักขระที่ RD Prep ไม่รับในคำนำหน้า/ชื่อ */
const REFUSED = /[*+/\\!$%#&@,'"|‘’“”]/;
/** ข้อความในช่อง: | และขึ้นบรรทัดเป็นช่องว่าง · ยุบช่องว่างซ้ำ */
export const rdField = (s: string | null | undefined) => (s ?? '').replace(/[|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
const money2 = (v: string | number) => round2(d(v)).toFixed(2);
const beDate = (iso: string, sep: string) => `${iso.slice(8, 10)}${sep}${iso.slice(5, 7)}${sep}${Number(iso.slice(0, 4)) + BE_OFFSET}`;
export const validThaiId = (id: string | null | undefined) => !!id && /^\d{13}$/.test(id) && taxIdCheckDigit(id.slice(0, 12)) === Number(id[12]);

export interface RdPerson {
  no: number; tax_id: string | null; title: string | null; first_name: string; last_name: string | null; pay_date: string; income: string; tax: string; condition: string;
  /** ภ.ง.ด.1ก: ที่อยู่ตามทะเบียนบ้าน */
  addr?: { house_no?: string | null; moo?: string | null; village?: string | null; building?: string | null; soi?: string | null; road?: string | null; subdistrict?: string | null; district?: string | null; province?: string | null; postcode?: string | null };
}
/** ตรวจก่อนสร้างแฟ้ม — คืนปัญหารายคน (ว่าง = สร้างได้) */
export function rdProblems(rows: RdPerson[], annual: boolean): string[] {
  const out: string[] = [];
  for (const r of rows) {
    const who = `ลำดับ ${r.no} ${r.first_name}`;
    if (!validThaiId(r.tax_id)) out.push(`${who}: เลขประจำตัวประชาชนไม่ถูกต้อง (ต้องเป็น 13 หลักที่ผ่านการตรวจ)`);
    if (!r.last_name) out.push(`${who}: ไม่มีนามสกุล`);
    if (REFUSED.test(`${r.title ?? ''}${r.first_name}${r.last_name ?? ''}`)) out.push(`${who}: คำนำหน้า/ชื่อมีอักขระที่กรมสรรพากรไม่รับ (* + / \\ ! $ % # & @ , ' " |)`);
    if (annual && (!r.addr?.subdistrict || !r.addr?.district || !r.addr?.province || !/^\d{5}$/.test(r.addr?.postcode ?? ''))) out.push(`${who}: ที่อยู่ตามทะเบียนบ้านไม่ครบ (ตำบล อำเภอ จังหวัด รหัสไปรษณีย์)`);
  }
  return out;
}
const addrPart = (v: string | null | undefined) => { const t = rdField(v); return REFUSED.test(t) ? '' : t; };

/** แฟ้ม RD Prep ภ.ง.ด.1 (11 ช่อง) / ภ.ง.ด.1ก (21 ช่อง: + ตำบล อำเภอ จังหวัด รหัสไปรษณีย์ เลขที่ หมู่ หมู่บ้าน อาคาร ซอย ถนน) */
export function rdPrepText(rows: RdPerson[], annual: boolean, year?: number): string {
  return rows.map((r) => {
    const f = [String(r.no), r.tax_id ?? '', rdField(r.title) || '-', rdField(r.first_name), rdField(r.last_name), annual ? `31/12/${(year ?? 0) + BE_OFFSET}` : beDate(r.pay_date, '/'),
      money2(r.income), money2(r.tax), '401N', '0.00', r.condition];
    if (annual) { const a = r.addr ?? {}; f.push(rdField(a.subdistrict), rdField(a.district), rdField(a.province), rdField(a.postcode), rdField(a.house_no), rdField(a.moo), rdField(a.village), rdField(a.building), rdField(a.soi), rdField(a.road)); }
    return f.join('|') + '\r\n';
  }).join('');
}
export const rdPrepName = (taxId: string, branch6: string, year: number, month: number | null) =>
  month ? `PND1_${taxId}_${branch6}_${year + BE_OFFSET}_${String(month).padStart(2, '0')}_00_RDPrep.txt` : `PND1A_${taxId}_${branch6}_${year + BE_OFFSET}_00_00_RDPrep.txt`;

/** TIS-620 (Windows-874): ไทย U+0E01–0E5B → 0xA1–0xFB · ASCII คงเดิม · อื่น ๆ = ? */
export function tis620(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out[i] = c < 0x80 ? c : c >= 0x0e01 && c <= 0x0e5b ? c - 0x0e01 + 0xa1 : 0x3f;
  }
  return out;
}

/** e-Filing FORMAT กลาง v2.0 */
export interface EfilingHead { company_tax_id: string; branch6: string; branch_name: string; form: 'PND1' | 'PND1A'; year: number; month: number | null; filing_no: number; internet: boolean; efiling_user: string }
export function efilingProblems(h: EfilingHead): string[] {
  const out: string[] = [];
  if (!validThaiId(h.company_tax_id)) out.push('เลขประจำตัวผู้เสียภาษีของบริษัทไม่ถูกต้อง — แก้ที่ เริ่มระบบ › รายละเอียดกิจการ');
  if (!h.efiling_user) out.push('ยังไม่ได้ตั้งชื่อผู้ใช้ e-Filing ของกรมสรรพากร — ตั้งที่ ตั้งค่าระบบเงินเดือน');
  if (h.filing_no < 0 || h.filing_no > 9) out.push('ครั้งที่ยื่นเพิ่มเติมต้องเป็น 0–9');
  return out;
}
export function efilingText(h: EfilingHead, rows: RdPerson[]): string {
  const income = rows.reduce((s, r) => s.plus(r.income), d(0)), tax = rows.reduce((s, r) => s.plus(r.tax), d(0));
  const head = ['H', '0000', h.company_tax_id, h.branch6, '1', h.form, h.company_tax_id, h.branch6, h.branch6 === '000000' ? 'สำนักงานใหญ่' : `สาขาที่ ${h.branch6}`, '0',
    h.month ? String(h.month).padStart(2, '0') : '00', String(h.year + BE_OFFSET), '', String(h.filing_no).padStart(2, '0'), String(rows.length), money2(income.toFixed(2)), money2(tax.toFixed(2)), '0.00', money2(tax.toFixed(2)),
    h.internet ? money2(tax.toFixed(2)) : '0.00', rdField(h.efiling_user), h.internet ? '2' : '1'];
  const lines = rows.map((r) => {
    const a = r.addr ?? {};
    return ['D', String(r.no), h.branch6, r.tax_id ?? '', '0000000000', rdField(r.title) || '-', rdField(r.first_name), rdField(r.last_name), h.month ? beDate(r.pay_date, '') : `3112${h.year + BE_OFFSET}`,
      '0.00', money2(r.income), money2(r.tax), '1', r.condition, addrPart(a.building), '', '', addrPart(a.village), addrPart(a.house_no), addrPart(a.moo), addrPart(a.soi), addrPart(a.road),
      rdField(a.subdistrict), rdField(a.district), rdField(a.province), rdField(a.postcode)].join('|');
  });
  return [head.join('|'), ...lines].join('\r\n');
}
export const efilingName = (h: EfilingHead) => `${h.form}_${h.company_tax_id}_${h.branch6}_${h.year + BE_OFFSET}_${h.month ? String(h.month).padStart(2, '0') : '00'}_${String(h.filing_no).padStart(2, '0')}_00.txt`;

/** ไฟล์โอนเงินเดือนเข้าธนาคาร (CSV ทั่วไป ใช้ทำรายการโอนหลายบัญชี) — เฉพาะคนที่รับโอนและยอดสุทธิมากกว่า 0 */
export interface BankRow { code: string; name: string; bank_code: string | null; bank_name: string | null; account_no: string | null; account_name: string | null; net: string }
export function bankCsv(rows: BankRow[]): { text: string; problems: string[]; count: number; total: string } {
  const q = (s: string | null | undefined) => `"${(s ?? '').replace(/"/g, '""')}"`;
  const use = rows.filter((r) => d(r.net).gt(0));
  const problems = use.filter((r) => !r.account_no).map((r) => `${r.code} ${r.name}: ไม่มีเลขที่บัญชีธนาคาร — แก้ที่ทะเบียนพนักงาน`);
  const lines = ['รหัสพนักงาน,ชื่อ,ธนาคาร,ชื่อธนาคาร,เลขบัญชี,ชื่อบัญชี,จำนวนเงิน', ...use.map((r) => [q(r.code), q(r.name), q(r.bank_code), q(r.bank_name), q(r.account_no), q(r.account_name || r.name), money2(r.net)].join(','))];
  return { text: '﻿' + lines.join('\r\n') + '\r\n', problems, count: use.length, total: use.reduce((s, r) => s.plus(r.net), d(0)).toFixed(2) };
}

/** แฟ้ม e-Service ประกันสังคม: แถว [เลขประจำตัวประชาชน, คำนำหน้า, ชื่อ, สกุล, ค่าจ้าง (จ่ายจริง ไม่ตัดเพดาน), เงินสมทบ] */
export interface SsoFileRow { tax_id: string | null; title: string | null; first_name: string; last_name: string | null; wage_paid: string; ee: string }
export function ssoFileProblems(employerNo: string, rows: SsoFileRow[]): string[] {
  const out: string[] = [];
  if (!/^\d{10}$/.test(employerNo)) out.push('เลขที่บัญชีนายจ้าง (ประกันสังคม) ต้องเป็นตัวเลข 10 หลัก — ตั้งที่ ตั้งค่าระบบเงินเดือน ข้อ 1');
  for (const r of rows) {
    if (!validThaiId(r.tax_id)) out.push(`${r.first_name}: เลขประจำตัวประชาชนไม่ถูกต้อง`);
    if (!r.title) out.push(`${r.first_name}: ไม่มีคำนำหน้าชื่อ`);
  }
  return out;
}
export const ssoFileName = (employerNo: string, year: number, month: number) => `${employerNo}_${String(month).padStart(2, '0')}${year + BE_OFFSET}.xls`;
