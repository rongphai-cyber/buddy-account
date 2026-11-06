/**
 * มัดจำรับ (AI) ที่ใช้นอกบิลขาย (05/11/2569 — WTS-Living ย้ายออก):
 *  - ใบเสร็จรับเงิน (RE) หักเงินมัดจำแทนเงินรับ — ตัดบิลที่ออกไปแล้ว (ค่าเช่า/น้ำไฟ ค่าเสียหาย)
 *  - ใบคืนเงินมัดจำ (RD) คืนยอดที่เหลือให้ลูกค้า
 * ทั้งสองแบบเขียน doc_link DEPOSIT (AI → RE/RD) ยอดคงเหลือใน v_deposit_outstanding จึงลดเอง และกลับคืนเมื่อยกเลิกเอกสาร (view ไม่นับเอกสารที่ยกเลิก)
 *
 * กฎภาษี:
 *  - ใบเสร็จ (RE) หักได้เฉพาะมัดจำที่ไม่มีภาษีมูลค่าเพิ่ม (vat_amount = 0) — มัดจำที่มี VAT ภาษีถึงกำหนดแล้วตอนรับมัดจำ (ออกใบกำกับภาษีแล้ว)
 *    ถ้าหักในใบเสร็จที่ตัดบิลภาษีเกณฑ์เงินสด ภาษีส่วนนั้นจะถึงกำหนดซ้ำ จึงต้องหักในบิลขาย (IV/HS) ซึ่งหักมัดจำก่อนคำนวณ VAT
 *  - ใบคืนเงินมัดจำ (RD) คืนมัดจำที่มี VAT ได้ (06/11/2569) = ใบลดหนี้ ลดภาษีขาย (ม.86/10) — ทุกใบในเอกสารต้องไม่มี VAT ทั้งหมด
 *    หรือมี VAT ประเภทราคา/อัตราเดียวกันทั้งหมด · VAT ต่อใบมัดจำเก็บที่ doc_link.vat_amount (depositRefundVat ใน @buddy/core)
 */
import { sql } from 'kysely';
import { z } from 'zod';
import { d, depositRefundVat, formatDate, type Decimal } from '@buddy/core';
import type { Db } from '../../db.js';
import { badRequest, type AuthContext } from '../../http.js';
import { num } from './payments.js';

type Ctx = AuthContext & { companyId: string };
export const depositsSchema = z.array(z.object({ header_id: z.string().uuid('เลือกใบมัดจำ'), amount: num })).max(50, 'เลือกใบมัดจำได้ไม่เกิน 50 ใบ').default([]);
export type DepositsIn = z.infer<typeof depositsSchema>;
type Use = 'RE' | 'RD';
const VERB: Record<Use, string> = { RE: 'หัก', RD: 'คืน' };

/** มัดจำรับคงเหลือของลูกค้า + ยอดที่เอกสาร ownId ใช้ไว้เดิม (กรณีแก้ไข นับกลับเป็นคงเหลือ) */
export async function receivedDeposits(db: Db, companyId: string, customerId: string, ownId: string | null, only?: string[]) {
  const own = ownId ? sql`(SELECT coalesce(sum(l.amount), 0) FROM doc_link l WHERE l.from_header_id = o.header_id AND l.to_header_id = ${ownId} AND l.link_type = 'DEPOSIT' AND l.deleted_at IS NULL)` : sql`0`;
  const notOwn = ownId ? sql`AND t.id <> ${ownId}` : sql``;
  // ใบคืนเงินที่ปิดยอดภาษีได้ตรงสตางค์: VAT ของใบคืนเงิน (RD) อื่นที่ยังใช้ + มีเอกสารชนิดอื่น (บิล/ใบเสร็จ) ใช้มัดจำนี้อยู่หรือไม่
  const links = (cls: 'RD' | 'other', expr: ReturnType<typeof sql>) => sql`(SELECT ${expr} FROM doc_link l JOIN doc_header t ON t.id = l.to_header_id
      WHERE l.from_header_id = o.header_id AND l.link_type = 'DEPOSIT' AND l.deleted_at IS NULL AND t.doc_status <> 'C' AND t.deleted_at IS NULL ${notOwn} AND ${cls === 'RD' ? sql`t.doc_class = 'RD'` : sql`t.doc_class <> 'RD'`})`;
  return (await sql<{ header_id: string; doc_no: string; doc_date: string; due_date: string | null; doc_type_id: string; price_type: string; vat_rate: string | null; amount: string; vat_amount: string; customer_id: string | null; outstanding: string; own: string; rd_vat: string; other_use: boolean }>`
    SELECT o.header_id, o.doc_no, o.doc_date, o.due_date, h.doc_type_id, o.price_type, h.vat_rate, o.amount, h.vat_amount, o.customer_id, o.outstanding + ${own} AS outstanding, ${own} AS own,
           ${links('RD', sql`coalesce(sum(l.vat_amount), 0)`)} AS rd_vat, ${links('other', sql`count(*) > 0`)} AS other_use
      FROM v_deposit_outstanding o JOIN doc_header h ON h.id = o.header_id
     WHERE o.company_id = ${companyId} AND o.doc_class = 'AI' AND o.customer_id = ${customerId}
       AND ${only ? sql`o.header_id = ANY(${only}::uuid[])` : sql`(o.outstanding > 0 OR ${own} <> 0)`}
     ORDER BY o.doc_date, o.doc_no`.execute(db)).rows;
}

/**
 * ตรวจมัดจำที่ใบเสร็จหัก/ใบคืนเงินคืน: ใบรับเงินมัดจำของลูกค้ารายนี้ บริษัทนี้ ยังไม่ยกเลิก ลงวันที่ไม่หลังเอกสาร
 * ยอด > 0 และไม่เกินคงเหลือ (ไม่นับยอดที่เอกสารนี้ใช้ไว้เดิม) · ใบเสร็จ: ไม่มี VAT เท่านั้น
 * ใบคืนเงิน: แยกยอดคืนเป็นก่อน VAT / VAT / เงินที่จ่าย (depositRefundVat) — ไม่มี VAT ทั้งหมด หรือมี VAT ประเภทราคา/อัตราเดียวกันทั้งหมด
 */
export async function checkReceivedDeposits(db: Db, companyId: string, x: { use: Use; customerId: string; partyCode: string; ownId: string | null; date: string; deposits: DepositsIn }) {
  const ids = x.deposits.map((p) => p.header_id);
  if (new Set(ids).size !== ids.length) throw badRequest('เลือกใบมัดจำซ้ำในเอกสารเดียวกัน — รวมยอดไว้บรรทัดเดียว');
  const rows = ids.length ? new Map((await receivedDeposits(db, companyId, x.customerId, x.ownId, ids)).map((r) => [r.header_id, r])) : new Map();
  const verb = VERB[x.use];
  let total: Decimal = d(0), vatT: Decimal = d(0), baseT: Decimal = d(0), paidT: Decimal = d(0);
  let first: { doc_no: string; vat: boolean; price_type: string; vat_rate: string } | null = null;
  const out = x.deposits.map((p, i) => {
    const o = rows.get(p.header_id);
    if (!o) throw badRequest(`มัดจำบรรทัดที่ ${i + 1}: ไม่พบใบรับเงินมัดจำของ ${x.partyCode} ที่ยังไม่ยกเลิก — เลือกจากรายการมัดจำคงเหลือของลูกค้ารายนี้`, [{ field: `deposits.${i}.header_id`, message: 'ไม่พบใบมัดจำ' }]);
    const hasVat = !d(o.vat_amount).isZero();
    if (hasVat && x.use === 'RE') throw badRequest(`${o.doc_no} เป็นมัดจำที่มีภาษีมูลค่าเพิ่ม (ออกใบกำกับภาษีตอนรับมัดจำแล้ว) — หักในใบเสร็จไม่ได้ เพราะภาษีจะถึงกำหนดซ้ำ ให้หักในบิลขาย (ขายเงินเชื่อ/ขายเงินสด แท็บหักเงินมัดจำ) แทน`,
      [{ field: `deposits.${i}.header_id`, message: 'มัดจำมีภาษีมูลค่าเพิ่ม' }]);
    // ใบคืนเงิน 1 ใบ = ใบลดหนี้ 1 ใบ: ไม่ปนมัดจำมี/ไม่มี VAT และประเภทราคา/อัตราต้องเหมือนกัน
    const rate = d(o.vat_rate ?? 0).toString();
    if (!first) first = { doc_no: o.doc_no, vat: hasVat, price_type: o.price_type, vat_rate: rate };
    else if (first.vat !== hasVat) throw badRequest(`${o.doc_no} ${hasVat ? 'มี' : 'ไม่มี'}ภาษีมูลค่าเพิ่ม แต่ ${first.doc_no} ${first.vat ? 'มี' : 'ไม่มี'} — คืนมัดจำที่มี VAT (ใบลดหนี้) กับไม่มี VAT ในใบเดียวกันไม่ได้ ให้แยกเป็นใบคืนเงินมัดจำคนละใบ`,
      [{ field: `deposits.${i}.header_id`, message: 'แยกเป็นใบคืนเงินมัดจำคนละใบ' }]);
    else if (hasVat && (first.price_type !== o.price_type || first.vat_rate !== rate)) throw badRequest(`${o.doc_no} เป็นมัดจำ${o.price_type === '1' ? 'ราคารวม VAT' : 'ราคาแยก VAT'} ${rate}% ต่างจาก ${first.doc_no} (${first.price_type === '1' ? 'ราคารวม VAT' : 'ราคาแยก VAT'} ${first.vat_rate}%) — ให้แยกเป็นใบคืนเงินมัดจำคนละใบ`,
      [{ field: `deposits.${i}.header_id`, message: 'แยกเป็นใบคืนเงินมัดจำคนละใบ' }]);
    const day = String(o.doc_date).slice(0, 10);
    if (day > x.date) throw badRequest(`${o.doc_no} ลงวันที่ ${formatDate(day, 'B')} หลังวันที่เอกสาร (${formatDate(x.date, 'B')}) — ${verb}มัดจำก่อนวันที่รับมัดจำไม่ได้ เปลี่ยนวันที่เอกสาร หรือเอาใบมัดจำนี้ออก`);
    const amt = d(p.amount).toDecimalPlaces(2);
    if (amt.lte(0)) throw badRequest(`${o.doc_no}: ป้อนยอด${verb}มัดจำมากกว่า 0`, [{ field: `deposits.${i}.amount`, message: 'ต้องมากกว่า 0' }]);
    if (amt.gt(d(o.outstanding))) throw badRequest(`${o.doc_no}: ${verb}มัดจำ ${amt.toFixed(2)} มากกว่ายอดมัดจำคงเหลือ ${d(o.outstanding).toFixed(2)} — ป้อนไม่เกินยอดคงเหลือ`, [{ field: `deposits.${i}.amount`, message: `ไม่เกิน ${d(o.outstanding).toFixed(2)}` }]);
    const v = depositRefundVat({ amount: amt, price_type: o.price_type, vat_rate: o.vat_rate, deposit_vat: o.vat_amount, outstanding: o.outstanding, other_rd_vat: o.rd_vat, other_use: !!o.other_use });
    total = total.plus(amt); vatT = vatT.plus(v.vat); baseT = baseT.plus(v.base); paidT = paidT.plus(v.paid);
    return { header_id: o.header_id, amount: amt.toFixed(2), doc_no: o.doc_no, doc_date: day, vat_amount: x.use === 'RD' ? v.vat.toFixed(2) : null, base: v.base.toFixed(2), paid: v.paid.toFixed(2) };
  });
  const f = first as { price_type: string; vat_rate: string; vat: boolean } | null;
  return { total: total.toDecimalPlaces(2), vat: vatT, base: baseT, paid: paidT, rows: out, hasVat: !!f?.vat, price_type: f?.vat ? f.price_type : '0', vat_rate: f?.vat ? f.vat_rate : '0' };
}

/** แก้ไขเอกสาร: ล้างมัดจำที่เอกสารนี้ใช้ไว้เดิม (soft delete) */
export async function clearDepositLinks(tx: Db, headerId: string) {
  await tx.updateTable('doc_link').set({ deleted_at: sql`now()` as never }).where('to_header_id', '=', headerId).where('link_type', '=', 'DEPOSIT').where('deleted_at', 'is', null).execute();
}

/**
 * เขียนมัดจำที่ใช้ (AI → เอกสารนี้) ในทรานแซกชันของเอกสาร — ล็อกใบมัดจำก่อน แล้วตรวจซ้ำว่าไม่มีใบใดติดลบ
 * (กันสองเอกสารใช้มัดจำใบเดียวกันพร้อมกันเกินยอด)
 */
export async function writeDepositLinks(tx: Db, a: Ctx, headerId: string, rows: Array<{ header_id: string; amount: string; vat_amount?: string | null }>) {
  if (!rows.length) return;
  const ids = rows.map((r) => r.header_id);
  await sql`SELECT id FROM doc_header WHERE id = ANY(${ids}::uuid[]) AND company_id = ${a.companyId} FOR UPDATE`.execute(tx);
  await tx.insertInto('doc_link').values(rows.map((r) => ({ company_id: a.companyId, from_header_id: r.header_id, to_header_id: headerId, link_type: 'DEPOSIT', amount: r.amount, vat_amount: r.vat_amount ?? null, created_by: a.userId }))).execute();
  const over = (await sql<{ doc_no: string; outstanding: string }>`SELECT doc_no, outstanding FROM v_deposit_outstanding WHERE header_id = ANY(${ids}::uuid[]) AND outstanding < 0 LIMIT 1`.execute(tx)).rows[0];
  if (over) throw badRequest(`${over.doc_no}: ยอดมัดจำถูกใช้เกินคงเหลือ (มีเอกสารอื่นใช้มัดจำใบนี้พร้อมกัน) — เปิดรายการมัดจำคงเหลือใหม่แล้วบันทึกอีกครั้ง`);
}

/** มัดจำที่เอกสารนี้ใช้ (แสดงในหน้าจอ/พิมพ์) */
export async function readDepositLinks(db: Db, companyId: string, headerId: string) {
  return (await sql<{ header_id: string; doc_no: string; doc_date: string; amount: string; vat_amount: string | null; deposit_amount: string; deposit_vat: string; price_type: string; vat_rate: string | null; outstanding: string | null }>`
    SELECT l.from_header_id AS header_id, f.doc_no, f.doc_date, l.amount, l.vat_amount, f.amount AS deposit_amount, f.vat_amount AS deposit_vat, f.price_type, f.vat_rate, o.outstanding
      FROM doc_link l JOIN doc_header f ON f.id = l.from_header_id LEFT JOIN v_deposit_outstanding o ON o.header_id = f.id
     WHERE l.company_id = ${companyId} AND l.to_header_id = ${headerId} AND l.link_type = 'DEPOSIT' AND l.deleted_at IS NULL ORDER BY f.doc_date, f.doc_no`.execute(db)).rows;
}
