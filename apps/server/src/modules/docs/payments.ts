/**
 * ส่วนรับ/จ่ายเงินที่ใช้ร่วมกันของเอกสาร (ใบเสร็จ ใบสำคัญจ่าย มัดจำ รายได้/ค่าใช้จ่ายอื่น):
 * ชำระโดยอื่น ๆ (S-PM-01 / S-PU-C6) + เช็คเข้าทะเบียน · ภาษีหัก ณ ที่จ่าย (S-PU-C4) เข้าแฟ้ม ภ.ง.ด.3/53
 */
import { sql } from 'kysely';
import { z } from 'zod';
import { d } from '@buddy/core';
import type { Db } from '../../db.js';
import { badRequest, type AuthContext } from '../../http.js';
import { periodFor } from '../gl/journals.js';
import { companySettings } from '../../company-template.js';
import { passOne, voidJournal } from '../cheques.js';

type Ctx = AuthContext & { companyId: string };
const uuid = z.string().uuid();
const optId = uuid.nullable().optional().transform((v) => v ?? null);
const str = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));
export const num = z.union([z.number(), z.string()]).transform((v) => String(v === '' ? 0 : v)).refine((v) => !Number.isNaN(Number(v)), 'ต้องเป็นตัวเลข');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ไม่ถูกต้อง');
const money = (v: ReturnType<typeof d>) => v.toDecimalPlaces(2).toFixed(2);

/** cheque_amount: จำนวนเงินหน้าเช็คเมื่อมากกว่ายอดที่ใช้ชำระ (ส่วนเกิน = ยอดคงเหลือในเช็ค) · cheque_id: ใช้ยอดคงเหลือของเช็คเดิม (S-BK-04) */
export const paymentsSchema = z.array(z.object({ payment_method_id: uuid, amount: num, reference_no: str(30), cheque_date: isoDate.nullable().optional(), bank_id: optId, bank_branch: str(60),
  cheque_amount: num.nullable().optional(), cheque_id: optId })).max(20).default([]);
export const whtSchema = z.array(z.object({
  form_type: z.enum(['S03', 'S53'], { errorMap: () => ({ message: 'เลือกแบบ ภ.ง.ด.3 หรือ ภ.ง.ด.53' }) }),
  income_type: z.string().trim().min(1, 'ป้อนประเภทเงินได้').max(60), rate: num, paid_amount: num, tax_amount: num,
  condition: z.enum(['1', '2', '3']).default('1'), certificate_no: str(30), certificate_date: isoDate.nullable().optional(), is_late: z.boolean().default(false),
})).max(2, 'ป้อนภาษีหัก ณ ที่จ่ายได้ไม่เกิน 2 ประเภทเงินได้').default([]);
type Payments = z.infer<typeof paymentsSchema>;
type Wht = z.infer<typeof whtSchema>;
type Method = { id: string; code: string; kind: string; creates_cheque: boolean; bank_account_id: string | null };

/** วิธีชำระต้องเป็นของฝั่งรับ/จ่ายนี้ · วิธีที่ออกเช็คต้องมีเลขที่เช็ค */
export async function loadMethods(db: Db, companyId: string, direction: 'R' | 'P', payments: Payments) {
  const methods = payments.length ? await db.selectFrom('md_payment_method').select(['id', 'code', 'kind', 'creates_cheque', 'bank_account_id'])
    .where('company_id', '=', companyId).where('direction', '=', direction).where('id', 'in', [...new Set(payments.map((p) => p.payment_method_id))]).where('deleted_at', 'is', null).execute() : [];
  const byId = new Map<string, Method>(methods.map((m) => [m.id, m]));
  payments.forEach((p, i) => {
    const m = byId.get(p.payment_method_id);
    if (!m) throw badRequest(`ชำระโดยอื่นบรรทัดที่ ${i + 1}: ไม่พบวิธี${direction === 'R' ? 'รับ' : 'จ่าย'}ชำระนี้ — ดูที่ เริ่มระบบ › วิธีรับ/จ่ายชำระหนี้`);
    if (d(p.amount).isZero()) throw badRequest(`ชำระโดยอื่นบรรทัดที่ ${i + 1} (${m.code}): ป้อนจำนวนเงิน`);
    if (m.creates_cheque && !p.reference_no && !p.cheque_id) throw badRequest(`ชำระโดยอื่นบรรทัดที่ ${i + 1} (${m.code}): ป้อนเลขที่เช็ค`);
    if (p.cheque_amount != null && d(p.cheque_amount).lt(d(p.amount))) throw badRequest(`ชำระโดยอื่นบรรทัดที่ ${i + 1} (${m.code}): จำนวนเงินหน้าเช็คต้องไม่น้อยกว่ายอดที่ใช้ชำระ`);
  });
  return byId;
}

export function checkWht(wht: Wht) {
  wht.forEach((w, i) => {
    if (d(w.paid_amount).lte(0)) throw badRequest(`ภาษีหัก ณ ที่จ่ายกลุ่ม ${i + 1}: ป้อนจำนวนเงินที่จ่าย`);
    if (d(w.tax_amount).lt(0) || d(w.rate).lt(0) || d(w.rate).gt(100)) throw badRequest(`ภาษีหัก ณ ที่จ่ายกลุ่ม ${i + 1}: อัตราหรือภาษีไม่ถูกต้อง`);
  });
  return wht.reduce((s, w) => s.plus(d(w.tax_amount)), d(0));
}

export async function branchOf(db: Db, a: Ctx) {
  return a.branchId ?? (await db.selectFrom('sys_branch').select('id').where('company_id', '=', a.companyId).where('is_head_office', '=', true).executeTakeFirstOrThrow()).id;
}

/** เช็คที่เอกสารนี้ออก: ยังไม่นำฝาก/ผ่าน จึงแก้หรือยกเลิกเอกสารได้ (นำออกจากทะเบียนเช็ค) */
/** ผ่านเช็คจ่ายทันที (ค่าเริ่มต้นระบบการเงิน ข้อ 1) — ยกเลิก/แก้เอกสารต้นทางจะยกเลิกการผ่านให้เอง */
export const AUTO_PASS = 'ผ่านเช็คจ่ายทันที (ค่าเริ่มต้นระบบการเงิน)';
export async function releaseCheques(db: Db, a: Ctx, headerId: string, docNo: string) {
  // คืนยอดคงเหลือให้เช็คเดิมที่เอกสารนี้นำมาใช้
  for (const r of (await sql<{ cheque_id: string; amount: string }>`SELECT p.cheque_id, p.amount FROM doc_payment p JOIN fin_cheque f ON f.id = p.cheque_id
      WHERE p.company_id = ${a.companyId} AND p.header_id = ${headerId} AND p.deleted_at IS NULL AND f.source_header_id IS DISTINCT FROM ${headerId}`.execute(db)).rows)
    await db.updateTable('fin_cheque').set({ remaining_amount: sql`remaining_amount + ${r.amount}` as never, is_settled: false, updated_by: a.userId }).where('id', '=', r.cheque_id).execute();
  const reused = (await sql<{ cheque_no: string; doc_no: string }>`SELECT f.cheque_no, h.doc_no FROM fin_cheque f JOIN doc_payment p ON p.cheque_id = f.id AND p.header_id <> ${headerId} AND p.deleted_at IS NULL
      JOIN doc_header h ON h.id = p.header_id AND h.doc_status <> 'C' WHERE f.company_id = ${a.companyId} AND f.source_header_id = ${headerId} AND f.deleted_at IS NULL LIMIT 1`.execute(db)).rows[0];
  if (reused) throw badRequest(`ยอดคงเหลือของเช็ค ${reused.cheque_no} ถูกใช้ใน ${reused.doc_no} แล้ว — ยกเลิก/แก้ ${reused.doc_no} ก่อน`);
  for (const c of (await sql<{ id: string; pass_journal_id: string }>`SELECT f.id, f.pass_journal_id FROM fin_cheque f WHERE f.company_id = ${a.companyId} AND f.source_header_id = ${headerId} AND f.deleted_at IS NULL
      AND f.direction = 'P' AND f.status = '10' AND f.pass_journal_id IS NOT NULL AND f.deposit_header_id IS NULL
      AND (SELECT e.reason FROM fin_cheque_event e WHERE e.cheque_id = f.id AND e.to_status = '10' ORDER BY e.created_at DESC LIMIT 1) = ${AUTO_PASS}`.execute(db)).rows) {
    await voidJournal(db, a, c.pass_journal_id, `แก้/ยกเลิก ${docNo}`);
    await db.updateTable('fin_cheque').set({ status: '05', pass_date: null, pass_journal_id: null }).where('id', '=', c.id).execute();
  }
  const used = await db.selectFrom('fin_cheque').select('cheque_no').where('company_id', '=', a.companyId).where('source_header_id', '=', headerId).where('deleted_at', 'is', null)
    .where((e) => e.or([e('status', 'not in', ['00', '05']), e('deposit_header_id', 'is not', null), e('pass_journal_id', 'is not', null), e('writeoff_journal_id', 'is not', null)])).executeTakeFirst();
  if (used) throw badRequest(`เช็ค ${used.cheque_no} ของ ${docNo} นำฝาก/ผ่านแล้ว — ยกเลิกรายการเช็คก่อน (บทที่ 13)`);
  await db.updateTable('fin_cheque').set({ deleted_at: sql`now()` as never, updated_by: a.userId }).where('company_id', '=', a.companyId).where('source_header_id', '=', headerId).where('deleted_at', 'is', null).execute();
}

/** เขียนบรรทัดชำระโดยอื่น ๆ + เช็ค (สถานะ 00 รอนำฝาก/ผ่าน) */
export async function writePayments(tx: Db, a: Ctx, x: { headerId: string; direction: 'R' | 'P'; payDate: string; methods: Map<string, Method>; payments: Payments;
  customerId: string | null; supplierId: string | null; partyName: string; departmentId: string | null }) {
  const branchId = await branchOf(tx, a);
  let autoPass: boolean | undefined;
  for (const [i, p] of x.payments.entries()) {
    const m = x.methods.get(p.payment_method_id)!;
    let chequeId: string | null = null;
    if (p.cheque_id) {
      // ใช้ยอดคงเหลือในเช็คเดิม: ลูกค้า/ผู้จำหน่ายเดียวกัน ยอดไม่เกินที่เหลือ
      const c = await tx.selectFrom('fin_cheque').select(['id', 'cheque_no', 'direction', 'customer_id', 'supplier_id', 'remaining_amount', 'written_off_amount']).where('id', '=', p.cheque_id)
        .where('company_id', '=', a.companyId).where('deleted_at', 'is', null).forUpdate().executeTakeFirst();
      if (!c || c.direction !== x.direction) throw badRequest(`ชำระโดยอื่นบรรทัดที่ ${i + 1}: ไม่พบเช็คที่มียอดคงเหลือ`);
      if ((x.customerId && c.customer_id && c.customer_id !== x.customerId) || (x.supplierId && c.supplier_id && c.supplier_id !== x.supplierId)) throw badRequest(`เช็ค ${c.cheque_no} เป็นของ${x.direction === 'R' ? 'ลูกค้า' : 'ผู้จำหน่าย'}รายอื่น`);
      const left = d(c.remaining_amount).minus(d(c.written_off_amount));
      if (d(p.amount).gt(left)) throw badRequest(`เช็ค ${c.cheque_no} เหลือยอดใช้ได้ ${left.toFixed(2)} — ป้อนไม่เกินยอดนี้`);
      await tx.updateTable('fin_cheque').set({ remaining_amount: d(c.remaining_amount).minus(d(p.amount)).toFixed(2), is_settled: left.minus(d(p.amount)).isZero(), updated_by: a.userId }).where('id', '=', c.id).execute();
      chequeId = c.id;
    } else if (m.creates_cheque) {
      const dup = await tx.selectFrom('fin_cheque').select('id').where('company_id', '=', a.companyId).where('direction', '=', x.direction).where('cheque_no', '=', p.reference_no!)
        .where('deleted_at', 'is', null).where(sql<boolean>`coalesce(bank_account_id::text, '') = ${m.bank_account_id ?? ''}`).executeTakeFirst();
      if (dup) throw badRequest(`เลขที่เช็ค ${p.reference_no} มีในทะเบียนเช็ค${x.direction === 'R' ? 'รับ' : 'จ่าย'}แล้ว`);
      chequeId = (await tx.insertInto('fin_cheque').values({
        company_id: a.companyId, branch_id: branchId, direction: x.direction, instrument: m.kind === 'TRANSFER' ? 'TRANSFER' : m.kind === 'CARD' ? 'CARD' : 'CHEQUE',
        cheque_no: p.reference_no!, cheque_date: p.cheque_date ?? x.payDate, bank_id: p.bank_id, bank_branch: p.bank_branch, bank_account_id: m.bank_account_id,
        customer_id: x.customerId, supplier_id: x.supplierId, payee_name: x.partyName.slice(0, 120) || null, department_id: x.departmentId,
        received_date: x.direction === 'R' ? x.payDate : null, amount: d(p.cheque_amount ?? p.amount).toFixed(2), charge: '0', net_amount: d(p.cheque_amount ?? p.amount).toFixed(2),
        remaining_amount: d(p.cheque_amount ?? p.amount).minus(d(p.amount)).toFixed(2), status: x.direction === 'R' ? '00' : '05', source_header_id: x.headerId, created_by: a.userId,
      }).returning('id').executeTakeFirstOrThrow()).id;
    }
    await tx.insertInto('doc_payment').values({ company_id: a.companyId, header_id: x.headerId, line_no: i + 1, payment_method_id: m.id, amount: p.amount, reference_no: p.reference_no, cheque_id: chequeId, created_by: a.userId }).execute();
    if (chequeId && !p.cheque_id && x.direction === 'P' && m.kind !== 'TRANSFER' && m.kind !== 'CARD' && (autoPass ??= (await companySettings(tx, a.companyId))['fn.auto_pass_cheque_paid'] === true)) {
      await passOne(tx, a, { id: chequeId, direction: 'P', cheque_no: p.reference_no!, status: '05', amount: d(p.cheque_amount ?? p.amount).toFixed(2), charge: '0', bank_account_id: m.bank_account_id, deposit_header_id: null, pass_journal_id: null,
        remaining_amount: '0', written_off_amount: '0', writeoff_journal_id: null, source_header_id: x.headerId, department_id: x.departmentId }, p.cheque_date ?? x.payDate, AUTO_PASS);
    }
  }
}

/** รายละเอียดภาษีหัก ณ ที่จ่าย → แฟ้ม ภ.ง.ด.3/53 (เลขที่หนังสือรับรองเริ่มต้น = เลขที่เอกสาร วันที่ = วันที่จ่าย) */
export async function writeWht(tx: Db, a: Ctx, x: { headerId: string; docNo: string; payDate: string; wht: Wht; supplierId: string | null; departmentId: string | null;
  payee: { name: string; address: string | null; tax_id: string | null; branch_no: string | null } }) {
  const branchId = await branchOf(tx, a);
  for (const w of x.wht) {
    const cdate = w.certificate_date ?? x.payDate;
    const per = await periodFor(tx, a.companyId, cdate);
    await tx.insertInto('tax_wht_entry').values({
      company_id: a.companyId, form_type: w.form_type, header_id: x.headerId, branch_id: branchId, certificate_no: w.certificate_no ?? x.docNo, certificate_date: cdate, tax_period_id: per.id, is_late: w.is_late,
      supplier_id: x.supplierId, payee_name: x.payee.name, payee_address: x.payee.address, payee_tax_id: x.payee.tax_id, payee_tax_branch_no: x.payee.branch_no,
      income_type: w.income_type, paid_amount: money(d(w.paid_amount)), rate: w.rate, tax_amount: money(d(w.tax_amount)), condition: w.condition, department_id: x.departmentId, created_by: a.userId,
    }).execute();
  }
}

/** แก้ไข/ยกเลิกเอกสาร: ล้างส่วนชำระเดิม (soft delete) */
export async function clearMoneyParts(tx: Db, headerId: string) {
  for (const tb of ['doc_payment', 'tax_wht_entry'] as const)
    await tx.updateTable(tb).set({ deleted_at: sql`now()` as never }).where('header_id', '=', headerId).where('deleted_at', 'is', null).execute();
}

/** รายละเอียดส่วนชำระของเอกสาร (หน้าจอ) */
export async function readMoneyParts(db: Db, companyId: string, headerId: string) {
  const payments = await db.selectFrom('doc_payment as p').leftJoin('md_payment_method as m', 'm.id', 'p.payment_method_id').leftJoin('fin_cheque as c', 'c.id', 'p.cheque_id')
    .select(['p.line_no', 'p.payment_method_id', 'm.code as method_code', 'm.name_th as method_name', 'm.creates_cheque', 'p.amount', 'p.reference_no', 'c.cheque_date', 'c.bank_id', 'c.bank_branch', 'c.status as cheque_status', 'p.cheque_id', 'c.amount as cheque_face', 'c.cheque_no', sql<boolean>`c.source_header_id = ${headerId}`.as('own_cheque')])
    .where('p.header_id', '=', headerId).where('p.deleted_at', 'is', null).orderBy('p.line_no').execute();
  const wht = await db.selectFrom('tax_wht_entry').select(['id', 'form_type', 'income_type', 'rate', 'paid_amount', 'tax_amount', 'condition', 'certificate_no', 'certificate_date', 'is_late', 'doc_status'])
    .where('header_id', '=', headerId).where('company_id', '=', companyId).where('deleted_at', 'is', null).orderBy('created_at').execute();
  return { payments, wht };
}
