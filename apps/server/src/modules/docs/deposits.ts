/**
 * มัดจำรับ (AI) ที่ใช้นอกบิลขาย (05/11/2569 — WTS-Living ย้ายออก):
 *  - ใบเสร็จรับเงิน (RE) หักเงินมัดจำแทนเงินรับ — ตัดบิลที่ออกไปแล้ว (ค่าเช่า/น้ำไฟ ค่าเสียหาย)
 *  - ใบคืนเงินมัดจำ (RD) คืนยอดที่เหลือให้ลูกค้า
 * ทั้งสองแบบเขียน doc_link DEPOSIT (AI → RE/RD) ยอดคงเหลือใน v_deposit_outstanding จึงลดเอง และกลับคืนเมื่อยกเลิกเอกสาร (view ไม่นับเอกสารที่ยกเลิก)
 *
 * กฎภาษี: ใช้ได้เฉพาะมัดจำที่ไม่มีภาษีมูลค่าเพิ่ม (vat_amount = 0)
 *  - มัดจำที่มี VAT: ภาษีถึงกำหนดแล้วตอนรับมัดจำ (ออกใบกำกับภาษีแล้ว) — ถ้าหักในใบเสร็จที่ตัดบิลภาษีเกณฑ์เงินสด ภาษีส่วนนั้นจะถึงกำหนดซ้ำอีกครั้ง
 *    จึงต้องหักในบิลขาย (IV/HS) ตามเดิม ซึ่งหักมัดจำก่อนคำนวณ VAT
 *  - คืนมัดจำที่มี VAT ต้องลดภาษีขายด้วยใบลดหนี้ — ยังไม่รองรับ
 */
import { sql } from 'kysely';
import { z } from 'zod';
import { d, formatDate, type Decimal } from '@buddy/core';
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
  return (await sql<{ header_id: string; doc_no: string; doc_date: string; due_date: string | null; doc_type_id: string; price_type: string; amount: string; vat_amount: string; customer_id: string | null; outstanding: string; own: string }>`
    SELECT o.header_id, o.doc_no, o.doc_date, o.due_date, h.doc_type_id, o.price_type, o.amount, h.vat_amount, o.customer_id, o.outstanding + ${own} AS outstanding, ${own} AS own
      FROM v_deposit_outstanding o JOIN doc_header h ON h.id = o.header_id
     WHERE o.company_id = ${companyId} AND o.doc_class = 'AI' AND o.customer_id = ${customerId}
       AND ${only ? sql`o.header_id = ANY(${only}::uuid[])` : sql`(o.outstanding > 0 OR ${own} <> 0)`}
     ORDER BY o.doc_date, o.doc_no`.execute(db)).rows;
}

/**
 * ตรวจมัดจำที่ใบเสร็จหัก/ใบคืนเงินคืน: ใบรับเงินมัดจำของลูกค้ารายนี้ บริษัทนี้ ยังไม่ยกเลิก ไม่มี VAT ลงวันที่ไม่หลังเอกสาร
 * ยอด > 0 และไม่เกินคงเหลือ (ไม่นับยอดที่เอกสารนี้ใช้ไว้เดิม)
 */
export async function checkReceivedDeposits(db: Db, companyId: string, x: { use: Use; customerId: string; partyCode: string; ownId: string | null; date: string; deposits: DepositsIn }) {
  const ids = x.deposits.map((p) => p.header_id);
  if (new Set(ids).size !== ids.length) throw badRequest('เลือกใบมัดจำซ้ำในเอกสารเดียวกัน — รวมยอดไว้บรรทัดเดียว');
  const rows = ids.length ? new Map((await receivedDeposits(db, companyId, x.customerId, x.ownId, ids)).map((r) => [r.header_id, r])) : new Map();
  const verb = VERB[x.use];
  let total: Decimal = d(0);
  const out = x.deposits.map((p, i) => {
    const o = rows.get(p.header_id);
    if (!o) throw badRequest(`มัดจำบรรทัดที่ ${i + 1}: ไม่พบใบรับเงินมัดจำของ ${x.partyCode} ที่ยังไม่ยกเลิก — เลือกจากรายการมัดจำคงเหลือของลูกค้ารายนี้`, [{ field: `deposits.${i}.header_id`, message: 'ไม่พบใบมัดจำ' }]);
    if (!d(o.vat_amount).isZero()) throw badRequest(x.use === 'RE'
      ? `${o.doc_no} เป็นมัดจำที่มีภาษีมูลค่าเพิ่ม (ออกใบกำกับภาษีตอนรับมัดจำแล้ว) — หักในใบเสร็จไม่ได้ เพราะภาษีจะถึงกำหนดซ้ำ ให้หักในบิลขาย (ขายเงินเชื่อ/ขายเงินสด แท็บหักเงินมัดจำ) แทน`
      : `${o.doc_no} เป็นมัดจำที่มีภาษีมูลค่าเพิ่ม — คืนมัดจำที่ออกใบกำกับภาษีแล้วต้องลดภาษีขายด้วยใบลดหนี้ ซึ่งหน้านี้ยังทำไม่ได้ · ให้หักในบิลขายแทน หรือบันทึกคืนด้วยใบสำคัญทั่วไปพร้อมปรับภาษีขาย`,
      [{ field: `deposits.${i}.header_id`, message: 'มัดจำมีภาษีมูลค่าเพิ่ม' }]);
    const day = String(o.doc_date).slice(0, 10);
    if (day > x.date) throw badRequest(`${o.doc_no} ลงวันที่ ${formatDate(day, 'B')} หลังวันที่เอกสาร (${formatDate(x.date, 'B')}) — ${verb}มัดจำก่อนวันที่รับมัดจำไม่ได้ เปลี่ยนวันที่เอกสาร หรือเอาใบมัดจำนี้ออก`);
    const amt = d(p.amount);
    if (amt.lte(0)) throw badRequest(`${o.doc_no}: ป้อนยอด${verb}มัดจำมากกว่า 0`, [{ field: `deposits.${i}.amount`, message: 'ต้องมากกว่า 0' }]);
    if (amt.gt(d(o.outstanding))) throw badRequest(`${o.doc_no}: ${verb}มัดจำ ${amt.toFixed(2)} มากกว่ายอดมัดจำคงเหลือ ${d(o.outstanding).toFixed(2)} — ป้อนไม่เกินยอดคงเหลือ`, [{ field: `deposits.${i}.amount`, message: `ไม่เกิน ${d(o.outstanding).toFixed(2)}` }]);
    total = total.plus(amt);
    return { header_id: o.header_id, amount: amt.toDecimalPlaces(2).toFixed(2), doc_no: o.doc_no };
  });
  return { total: total.toDecimalPlaces(2), rows: out };
}

/** แก้ไขเอกสาร: ล้างมัดจำที่เอกสารนี้ใช้ไว้เดิม (soft delete) */
export async function clearDepositLinks(tx: Db, headerId: string) {
  await tx.updateTable('doc_link').set({ deleted_at: sql`now()` as never }).where('to_header_id', '=', headerId).where('link_type', '=', 'DEPOSIT').where('deleted_at', 'is', null).execute();
}

/**
 * เขียนมัดจำที่ใช้ (AI → เอกสารนี้) ในทรานแซกชันของเอกสาร — ล็อกใบมัดจำก่อน แล้วตรวจซ้ำว่าไม่มีใบใดติดลบ
 * (กันสองเอกสารใช้มัดจำใบเดียวกันพร้อมกันเกินยอด)
 */
export async function writeDepositLinks(tx: Db, a: Ctx, headerId: string, rows: Array<{ header_id: string; amount: string }>) {
  if (!rows.length) return;
  const ids = rows.map((r) => r.header_id);
  await sql`SELECT id FROM doc_header WHERE id = ANY(${ids}::uuid[]) AND company_id = ${a.companyId} FOR UPDATE`.execute(tx);
  await tx.insertInto('doc_link').values(rows.map((r) => ({ company_id: a.companyId, from_header_id: r.header_id, to_header_id: headerId, link_type: 'DEPOSIT', amount: r.amount, created_by: a.userId }))).execute();
  const over = (await sql<{ doc_no: string; outstanding: string }>`SELECT doc_no, outstanding FROM v_deposit_outstanding WHERE header_id = ANY(${ids}::uuid[]) AND outstanding < 0 LIMIT 1`.execute(tx)).rows[0];
  if (over) throw badRequest(`${over.doc_no}: ยอดมัดจำถูกใช้เกินคงเหลือ (มีเอกสารอื่นใช้มัดจำใบนี้พร้อมกัน) — เปิดรายการมัดจำคงเหลือใหม่แล้วบันทึกอีกครั้ง`);
}

/** มัดจำที่เอกสารนี้ใช้ (แสดงในหน้าจอ/พิมพ์) */
export async function readDepositLinks(db: Db, companyId: string, headerId: string) {
  return (await sql<{ header_id: string; doc_no: string; doc_date: string; amount: string; deposit_amount: string; outstanding: string | null }>`
    SELECT l.from_header_id AS header_id, f.doc_no, f.doc_date, l.amount, f.amount AS deposit_amount, o.outstanding
      FROM doc_link l JOIN doc_header f ON f.id = l.from_header_id LEFT JOIN v_deposit_outstanding o ON o.header_id = f.id
     WHERE l.company_id = ${companyId} AND l.to_header_id = ${headerId} AND l.link_type = 'DEPOSIT' AND l.deleted_at IS NULL ORDER BY f.doc_date, f.doc_no`.execute(db)).rows;
}
