import { sql } from 'kysely';
import { d, type ImportIssue, type ImportPayment } from '@buddy/core';
import type { Db } from '../db.js';

/**
 * นำเข้า Excel ให้ครบทุกช่องของหน้าจอเอกสาร (เจ้าของ 20/11/2569 · HANDOFF 169)
 * รหัสในแฟ้ม (แผนก Job พนักงานขาย เขตการขาย ขนส่งโดย คลัง สถานที่ส่ง วิธีชำระ) → id/รหัสของบริษัทใน session · รับรหัสหรือชื่อ (ตรงทุกตัวอักษร)
 */
type Row = { id: string; code: string; name: string | null };
const up = (v: string) => v.trim().toUpperCase();
const low = (v: string | null | undefined) => (v ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
/** หา id จากรหัส (ไม่สนตัวพิมพ์) แล้วจากชื่อ */
export function finder(rows: Row[]) {
  const byCode = new Map(rows.map((r) => [up(r.code), r]));
  return (v: string | null | undefined): Row | undefined => {
    if (!v) return undefined;
    return byCode.get(up(v)) ?? rows.find((r) => low(r.name) === low(v));
  };
}
export async function loadRefs(db: Db, companyId: string) {
  const q = async (s: ReturnType<typeof sql>) => (await s.execute(db)).rows as Row[];
  const [dept, job, slm, area, via, wh] = await Promise.all([
    q(sql`SELECT id, code, name_th AS name FROM md_department WHERE company_id = ${companyId} AND deleted_at IS NULL`),
    q(sql`SELECT id, code, name_th AS name FROM md_project WHERE company_id = ${companyId} AND deleted_at IS NULL`),
    q(sql`SELECT id, code, name FROM md_salesperson WHERE company_id = ${companyId} AND deleted_at IS NULL`),
    q(sql`SELECT code AS id, code, name_th AS name FROM md_lookup WHERE company_id = ${companyId} AND type_code = '40' AND deleted_at IS NULL`),
    q(sql`SELECT code AS id, code, name_th AS name FROM md_lookup WHERE company_id = ${companyId} AND type_code = '41' AND deleted_at IS NULL`),
    q(sql`SELECT id, code, name_th AS name FROM md_warehouse WHERE company_id = ${companyId} AND deleted_at IS NULL`),
  ]);
  return { dept: finder(dept), job: finder(job), slm: finder(slm), area: finder(area), via: finder(via), wh: finder(wh) };
}
export type Refs = Awaited<ReturnType<typeof loadRefs>>;

/** สถานที่ส่งของลูกค้า (หาตามรหัส/ที่อยู่ของลูกค้ารายนั้น) */
export async function shipTosOf(db: Db, companyId: string, customerIds: string[]) {
  const rows = customerIds.length ? (await sql<{ id: string; code: string; customer_id: string; address_1: string | null }>`SELECT id, code, customer_id, address_1 FROM md_customer_ship_to
      WHERE company_id = ${companyId} AND deleted_at IS NULL AND customer_id = ANY(${customerIds}::uuid[])`.execute(db)).rows : [];
  return (customerId: string, v: string) => rows.find((r) => r.customer_id === customerId && (up(r.code) === up(v) || low(r.address_1) === low(v)));
}

type Method = { id: string; code: string; name_th: string; kind: string; creates_cheque: boolean; gl_account_id: string | null; bank_account_id: string | null; status: string };
/** วิธีรับ (R) / จ่าย (P) ชำระของบริษัท */
export async function methodsOf(db: Db, companyId: string, direction: 'R' | 'P') {
  const rows = (await sql<Method>`SELECT id, code, name_th, kind, creates_cheque, gl_account_id, bank_account_id, status FROM md_payment_method
      WHERE company_id = ${companyId} AND direction = ${direction} AND deleted_at IS NULL ORDER BY code`.execute(db)).rows;
  const f = finder(rows.map((r) => ({ id: r.id, code: r.code, name: r.name_th })));
  return (v: string) => { const r = f(v); return r ? rows.find((x) => x.id === r.id)! : undefined; };
}

/**
 * การรับ/จ่ายชำระของเอกสารหนึ่งฉบับ (ขายสด/ซื้อสด/ค่าใช้จ่ายอื่น) แบบเดียวกับแท็บ "ชำระโดยอื่น ๆ" ของหน้าจอ:
 * วิธีเงินสด = ยอดเงินสดคงเหลือ (ไม่เป็นบรรทัด) · วิธีอื่นเป็นบรรทัด (วิธี ยอด เลขที่อ้างอิง/เช็ค วันที่เช็ค)
 * ยอดรวมแผ่นรับ/จ่ายชำระ = ยอดรวมทั้งสิ้น − ภาษีหัก ณ ที่จ่าย · วิธีเดียวที่แผ่นหลัก = ทั้งยอด · ไม่ใส่ = เงินสดทั้งหมด
 */
export function buildPayments(o: { ref: string; row: number; due: string; label: string; recv: boolean; main: { method: string | null; pay_ref: string | null } | null; sheet: ImportPayment[]; method: (v: string) => Method | undefined; issues: ImportIssue[] }) {
  const word = o.recv ? 'รับ' : 'จ่าย', sheetName = o.recv ? 'รับชำระ' : 'จ่ายชำระ';
  const bad = (row: number, m: string) => { o.issues.push({ row, message: `เลขที่อ้างอิง ${o.ref}: ${m}` }); };
  if (o.sheet.length && o.main?.method) { bad(o.row, `ใส่วิธีชำระทั้งในแผ่นนำเข้าและแผ่น "${sheetName}" — ใช้อย่างใดอย่างหนึ่ง (แบ่งหลายวิธี = แผ่น "${sheetName}")`); return null; }
  const lines = o.sheet.length ? o.sheet.map((p) => ({ row: p.row, method: p.method, amount: p.amount, ref: p.pay_ref, cheque_date: p.cheque_date }))
    : o.main?.method ? [{ row: o.row, method: o.main.method, amount: o.due, ref: o.main.pay_ref, cheque_date: null }] : [];
  const n0 = o.issues.length;
  const out: Array<{ payment_method_id: string; amount: string; reference_no: string | null; cheque_date?: string | null }> = [];
  for (const l of lines) {
    const m = o.method(l.method);
    if (!m) { bad(l.row, `ไม่พบวิธี${word}ชำระ "${l.method}" — ใช้รหัสหรือชื่อตาม เริ่มระบบ › วิธีรับ/จ่ายชำระหนี้ (ฝั่ง${word})`); continue; }
    if (m.status === 'I') { bad(l.row, `วิธี${word}ชำระ ${m.code} เลิกใช้แล้ว`); continue; }
    if (m.kind === 'CASH') continue;                                   // เงินสด = ยอดเงินสดคงเหลือของเอกสาร
    if ((m.creates_cheque || m.kind === 'CHEQUE') && !l.ref) { bad(l.row, `วิธี${word}ชำระ ${m.code} ${m.name_th} ต้องมีเลขที่เช็ค/เลขที่อ้างอิง — ใส่ในคอลัมน์ "เลขที่อ้างอิง/เช็ค"`); continue; }
    if (!m.gl_account_id && !m.bank_account_id) { bad(l.row, `วิธี${word}ชำระ ${m.code} ${m.name_th} ยังไม่ได้ผูกบัญชีเงินฝาก/บัญชีแยกประเภท — กำหนดที่ เริ่มระบบ › วิธีรับ/จ่ายชำระหนี้ ก่อน`); continue; }
    out.push({ payment_method_id: m.id, amount: d(l.amount).toFixed(2), reference_no: l.ref, ...(l.cheque_date ? { cheque_date: l.cheque_date } : {}) });
  }
  if (o.sheet.length) {
    const sum = o.sheet.reduce((s, p) => s.plus(d(p.amount)), d(0));
    if (!sum.minus(d(o.due)).abs().lt(0.005)) bad(o.sheet[0]!.row, `ยอด${word}ชำระรวม ${sum.toFixed(2)} ไม่เท่ากับยอดที่ต้อง${word} ${d(o.due).toFixed(2)} (รวมทั้งสิ้น − ภาษีหัก ณ ที่จ่าย) — แก้แผ่น "${sheetName}"`);
  }
  return o.issues.length > n0 ? null : out;
}
