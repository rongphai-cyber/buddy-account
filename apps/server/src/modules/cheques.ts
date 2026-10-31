import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { d } from '@buddy/core';
import type { Db } from '../db.js';
import { badRequest, notFound, parse, requireCompany, type AuthContext } from '../http.js';
import { logActivity } from '../audit.js';
import { createJournal, periodFor } from './gl/journals.js';
import { docNoFor, docNoInput } from './docs/engine.js';
import { branchOf } from './docs/payments.js';

/**
 * เช็ครับ/เช็คจ่าย (คู่มือบทที่ 13 S-BK-04..13) — fin_cheque + ประวัติสถานะ fin_cheque_event
 * เช็ครับ: 00 ในมือ → นำฝาก 01 รอเรียกเก็บ → ผ่าน 10 (ลงบัญชี Dr เงินฝาก + ค่าธรรมเนียม / Cr บัญชีเช็ครับของวิธีชำระ) · คืน → 02 ยื่นใหม่ (ประวัติ 20 เช็คคืน)
 * เช็คจ่าย: 05 เช็คจ่าย → ผ่าน 10 (Dr บัญชีเช็คจ่ายของวิธีชำระ / Cr เงินฝาก) · ใบนำฝาก BQ ผ่านได้ทั้งใบเท่านั้น
 * ยอดเงินฝากเพิ่มเฉพาะตอนผ่านเช็ค (ใบสำคัญ) — ไม่มียอดสะสม
 */
type Ctx = AuthContext & { companyId: string };
const uuid = z.string().uuid();
const optId = uuid.nullable().optional().transform((v) => v ?? null);
const str = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ไม่ถูกต้อง');
const money = z.union([z.number(), z.string()]).transform((v) => String(v === '' || v === null ? 0 : v)).refine((v) => !Number.isNaN(Number(v)), 'ต้องเป็นตัวเลข');
export const CHEQUE_STATUS: Record<string, string> = { '00': 'เช็คในมือ', '01': 'รอเรียกเก็บ', '02': 'เช็คคืนยื่นใหม่', '05': 'เช็คจ่าย', '10': 'เช็คผ่าน', '19': 'ผ่าน (โอน)', '20': 'เช็คคืน', '21': 'ตัดหนี้สูญ' };

async function bookOf(db: Db, companyId: string, kind: string) {
  const r = await db.selectFrom('gl_journal_route').select('journal_book_id').where('company_id', '=', companyId).where('txn_kind', '=', kind).where('deleted_at', 'is', null).executeTakeFirst();
  const b = r?.journal_book_id ?? (await db.selectFrom('gl_journal_book').select('id').where('company_id', '=', companyId).where('code', '=', '00').where('deleted_at', 'is', null).executeTakeFirst())?.id;
  if (!b) throw badRequest('ไม่พบสมุดรายวันสำหรับลงบัญชี — กำหนดที่ เริ่มระบบ › เลขที่เอกสาร');
  return b;
}
async function defAcc(db: Db, companyId: string, role: string) {
  const r = await db.selectFrom('gl_default_account').select('account_id').where('company_id', '=', companyId).where('role', '=', role).where('deleted_at', 'is', null).executeTakeFirst();
  if (r?.account_id) return r.account_id;
  const s = await db.selectFrom('gl_default_account').select('account_id').where('company_id', '=', companyId).where('role', '=', 'SUSPENSE').where('deleted_at', 'is', null).executeTakeFirst();
  if (!s?.account_id) throw badRequest(`ยังไม่ได้กำหนดบัญชีเพื่อลงรายวัน (${role}) — กำหนดที่ เริ่มระบบ › เชื่อมต่อบัญชี`);
  return s.account_id;
}
/** บัญชีเช็ครับ/จ่ายของเช็ค = บัญชีของวิธีชำระในเอกสารที่รับ/จ่ายเช็ค (ตรงกับฝั่งที่ลงไว้ตอนรับ/จ่าย) → บัญชีเพื่อลงรายวัน */
async function chequeAcc(db: Db, companyId: string, chequeId: string, direction: string) {
  const r = (await sql<{ gl: string | null }>`SELECT m.gl_account_id AS gl FROM doc_payment p JOIN md_payment_method m ON m.id = p.payment_method_id
      WHERE p.company_id = ${companyId} AND p.cheque_id = ${chequeId} AND p.deleted_at IS NULL AND m.gl_account_id IS NOT NULL ORDER BY p.created_at LIMIT 1`.execute(db)).rows[0];
  return r?.gl ?? (await defAcc(db, companyId, direction === 'R' ? 'CHEQUE_RECEIVED' : 'CHEQUE_PAID'));
}
async function bankAcc(db: Db, companyId: string, bankAccountId: string | null) {
  if (!bankAccountId) throw badRequest('เลือกบัญชีเงินฝาก');
  const b = await db.selectFrom('md_bank_account').select(['id', 'code', 'gl_account_id']).where('id', '=', bankAccountId).where('company_id', '=', companyId).where('deleted_at', 'is', null).executeTakeFirst();
  if (!b) throw badRequest('ไม่พบบัญชีเงินฝากที่เลือก');
  if (!b.gl_account_id) throw badRequest(`บัญชีเงินฝาก ${b.code} ยังไม่ได้ผูกเลขที่บัญชี — กำหนดที่ รายละเอียดบัญชีเงินฝาก`);
  return b.gl_account_id;
}
const event = (db: Db, a: Ctx, chequeId: string, date: string, from: string | null, to: string, reason: string | null = null, headerId: string | null = null) =>
  db.insertInto('fin_cheque_event').values({ company_id: a.companyId, cheque_id: chequeId, event_date: date, from_status: from, to_status: to, reason, header_id: headerId, created_by: a.userId }).execute();
export async function voidJournal(db: Db, a: Ctx, id: string | null, reason: string) {
  if (!id) return;
  const j = await db.selectFrom('gl_journal').select(['voucher_no', 'voucher_date', 'doc_status']).where('id', '=', id).where('company_id', '=', a.companyId).executeTakeFirst();
  if (!j || j.doc_status === 'C') return;
  await periodFor(db, a.companyId, String(j.voucher_date).slice(0, 10));
  await db.updateTable('gl_journal').set({ doc_status: 'C', updated_by: a.userId }).where('id', '=', id).execute();
  await logActivity(db, a, { module: 'GL', action: 'CANCEL', docNo: j.voucher_no, table: 'gl_journal', rowId: id, detail: { reason } });
}
export type Chq = { id: string; direction: string; cheque_no: string; status: string; amount: string; charge: string; bank_account_id: string | null; deposit_header_id: string | null; pass_journal_id: string | null; remaining_amount: string; written_off_amount: string; writeoff_journal_id: string | null; source_header_id: string | null; department_id: string | null };
async function loadCheques(db: Db, a: Ctx, ids: string[]) {
  const rows = await db.selectFrom('fin_cheque').select(['id', 'direction', 'cheque_no', 'status', 'amount', 'charge', 'bank_account_id', 'deposit_header_id', 'pass_journal_id', 'remaining_amount', 'written_off_amount', 'writeoff_journal_id', 'source_header_id', 'department_id'])
    .where('company_id', '=', a.companyId).where('id', 'in', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']).where('deleted_at', 'is', null).forUpdate().execute() as Chq[];
  if (rows.length !== new Set(ids).size) throw notFound('เช็ค');
  return rows;
}
const ctxJ = async (db: Db, a: Ctx) => ({ companyId: a.companyId, userId: a.userId, branchId: await branchOf(db, a) });

/** ผ่านเช็คหนึ่งใบ (ไม่อยู่ในใบนำฝาก): ลงบัญชีแล้วเปลี่ยนสถานะ */
export async function passOne(tx: Db, a: Ctx, c: Chq, date: string, reason: string | null = null) {
  const amt = d(c.amount), charge = d(c.charge);
  const bank = await bankAcc(tx, a.companyId, c.bank_account_id);
  const chq = await chequeAcc(tx, a.companyId, c.id, c.direction);
  const lines = c.direction === 'R'
    ? [{ account_id: bank, debit: amt.minus(charge).toFixed(2), credit: '0', description: `ผ่านเช็ครับ ${c.cheque_no}` }, ...(charge.isZero() ? [] : [{ account_id: await defAcc(tx, a.companyId, 'BANK_CHARGE'), debit: charge.toFixed(2), credit: '0', description: 'ค่าธรรมเนียมธนาคาร' }]),
      { account_id: chq, debit: '0', credit: amt.toFixed(2), description: `เช็ค ${c.cheque_no}` }]
    : [{ account_id: chq, debit: amt.toFixed(2), credit: '0', description: `เช็ค ${c.cheque_no}` }, { account_id: bank, debit: '0', credit: amt.toFixed(2), description: `ผ่านเช็คจ่าย ${c.cheque_no}` }];
  const j = await createJournal(tx, await ctxJ(tx, a), { journal_book_id: await bookOf(tx, a.companyId, c.direction === 'R' ? 'PASS_CHEQUE_RCV' : 'PASS_CHEQUE_PAID'), voucher_date: date,
    description: `${c.direction === 'R' ? 'ผ่านเช็ครับ' : 'ผ่านเช็คจ่าย'} ${c.cheque_no}`, reference: c.cheque_no, lines }, '4', { sourceModule: 'BK' });
  await tx.updateTable('fin_cheque').set({ status: '10', pass_date: date, pass_journal_id: j.id, updated_by: a.userId, updated_at: sql`now()` as never }).where('id', '=', c.id).execute();
  await event(tx, a, c.id, date, c.status, '10', reason);
  return j;
}

const chequeBody = z.object({
  direction: z.enum(['R', 'P']), cheque_no: z.string().trim().min(1, 'ป้อนเลขที่เช็ค').max(30), cheque_date: isoDate, bank_id: optId, bank_branch: str(60), bank_account_id: optId,
  customer_id: optId, supplier_id: optId, payee_name: str(120), department_id: optId, received_date: isoDate.nullable().optional().transform((v) => v ?? null), amount: money, remark: str(200),
  /** ป้อนจากสมุดรายวัน (S-GL-04): ใบสำคัญที่มีบรรทัดเช็คจ่าย/เช็ครับล่วงหน้า */
  source_journal_id: optId,
});
const depBody = z.object({ doc_no: docNoInput, cheque_ids: z.array(uuid).min(1, 'เลือกเช็คที่นำฝากอย่างน้อย 1 ใบ').max(500), bank_account_id: uuid, doc_date: isoDate, doc_type_id: optId, remark: str(200), department_id: optId, charge: money.optional(), vat: money.optional(), wht: money.optional(),
  /** ใบขายลดเช็ค (SQR): ธนาคารรับซื้อเช็คก่อนกำหนด — ผ่านทันทีวันที่ขายลด ค่าขายลดลงดอกเบี้ยจ่าย · ใบกำกับภาษีซื้อ#/ลวท. ของค่าธรรมเนียม */
  discount: z.boolean().default(false), ref_no: str(30), ref_date: isoDate.nullable().optional().transform((v) => v ?? null) });

/** บันทึกเช็คผ่านทั้งใบนำฝาก/ใบขายลด: Dr เงินฝาก (สุทธิ) + ค่าธรรมเนียม (ขายลด = ดอกเบี้ยจ่าย) + ภาษีซื้อ + ภาษีถูกหัก / Cr บัญชีเช็ครับ */
async function passSlip(tx: Db, a: Ctx, id: string, pass_date: string) {
  const h = await tx.selectFrom('doc_header').select(['id', 'doc_no', 'doc_status', 'doc_date', 'journal_id', 'bank_account_id', 'net_amount', 'vat_amount', 'wht_amount', 'discount_amount', 'department_id', 'express_rectype'])
    .where('id', '=', id).where('company_id', '=', a.companyId).where('doc_class', '=', 'BQ').where('deleted_at', 'is', null).executeTakeFirst();
  if (!h) throw notFound('ใบนำฝากเช็ค');
  if (h.doc_status === 'C') throw badRequest('ใบนำฝากนี้ถูกยกเลิกแล้ว');
  if (h.journal_id) throw badRequest('ใบนำฝากนี้ผ่านเช็คแล้ว');
  if (pass_date < String(h.doc_date).slice(0, 10)) throw badRequest('วันที่ผ่านต้องไม่ก่อนวันที่นำฝาก');
  const sold = h.express_rectype === 'S';
  const cs = await tx.selectFrom('fin_cheque').select(['id', 'cheque_no', 'amount', 'status']).where('deposit_header_id', '=', id).where('deleted_at', 'is', null).execute();
  if (!cs.length) throw badRequest('ใบนำฝากนี้ไม่มีเช็ค');
  const credits = new Map<string, ReturnType<typeof d>>();
  for (const c of cs) { const acc = await chequeAcc(tx, a.companyId, c.id, 'R'); credits.set(acc, (credits.get(acc) ?? d(0)).plus(d(c.amount))); }
  const dr = (acc: string, v: string) => (d(v).isZero() ? [] : [{ account_id: acc, debit: d(v).toFixed(2), credit: '0', department_id: h.department_id }]);
  const lines = [...dr(await bankAcc(tx, a.companyId, h.bank_account_id), h.net_amount), ...dr(await defAcc(tx, a.companyId, sold ? 'INTEREST_EXPENSE' : 'BANK_CHARGE'), h.discount_amount),
    ...dr(await defAcc(tx, a.companyId, 'INPUT_VAT'), h.vat_amount), ...dr(await defAcc(tx, a.companyId, 'PREPAID_TAX'), h.wht_amount),
    ...[...credits].map(([acc, v]) => ({ account_id: acc, debit: '0', credit: v.toFixed(2), department_id: h.department_id }))];
  const j = await createJournal(tx, await ctxJ(tx, a), { journal_book_id: await bookOf(tx, a.companyId, 'PASS_CHEQUE_RCV'), voucher_date: pass_date, description: `${sold ? 'ขายลดเช็คตามใบขายลด' : 'ผ่านเช็คตามใบนำฝาก'} ${h.doc_no}`, reference: h.doc_no, lines }, '4', { sourceModule: 'BK' });
  await tx.updateTable('doc_header').set({ journal_id: j.id, gl_posted: 'Y', updated_by: a.userId }).where('id', '=', id).execute();
  await tx.updateTable('gl_journal').set({ source_header_id: id }).where('id', '=', j.id).execute();
  for (const c of cs) {
    await tx.updateTable('fin_cheque').set({ status: '10', pass_date, pass_journal_id: j.id, updated_by: a.userId }).where('id', '=', c.id).execute();
    await event(tx, a, c.id, pass_date, c.status, '10', sold ? 'ขายลดเช็ค' : null, id);
  }
  return { voucher_no: j.voucher_no };
}

export function chequeRoutes(app: FastifyInstance, db: Db) {
  /** S-BK-04 / S-BK-13 ทะเบียนเช็ครับ/จ่าย + รายการรอนำฝาก/รอผ่าน (S-BK-07/08/09) */
  app.get('/api/v1/cheques', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ direction: z.enum(['R', 'P']), status: z.string().regex(/^[0-9]{2}(,[0-9]{2})*$/).optional(), q: z.string().optional(), bank_account_id: uuid.optional(),
      instrument: z.enum(['CHEQUE', 'TRANSFER', 'all']).default('CHEQUE'), journal_id: uuid.optional(), header_id: uuid.optional(), from: isoDate.optional(), to: isoDate.optional(), loose: z.enum(['Y', 'N']).default('N'), remaining: z.enum(['Y', 'N']).default('N'), party_id: uuid.optional(), limit: z.coerce.number().int().min(1).max(5000).default(1000) }), req.query);
    const like = q.q?.trim() ? `%${q.q.trim()}%` : null;
    const st = q.status?.split(',');
    const rows = (await sql`SELECT f.id, f.direction, f.instrument, f.cheque_no, f.cheque_date, f.received_date, f.deposit_date, f.pass_date, f.amount, f.charge, f.net_amount, f.remaining_amount, f.written_off_amount, f.status,
          f.bank_branch, bk.code AS bank_code, bk.name_th AS bank_name, ba.code AS account_code, ba.short_name AS account_short, coalesce(f.payee_name, c.name, s.name) AS party_name, coalesce(c.code, s.code) AS party_code,
          h.id AS source_header_id, h.doc_no AS source_doc_no, h.doc_class AS source_doc_class, (SELECT p.payment_method_id FROM doc_payment p WHERE p.cheque_id = f.id AND p.deleted_at IS NULL ORDER BY p.created_at LIMIT 1) AS method_id, dh.doc_no AS deposit_doc_no, dh.id AS deposit_header_id, j.voucher_no AS pass_voucher_no, f.remark
        FROM fin_cheque f LEFT JOIN md_bank bk ON bk.id = f.bank_id LEFT JOIN md_bank_account ba ON ba.id = f.bank_account_id LEFT JOIN md_customer c ON c.id = f.customer_id LEFT JOIN md_supplier s ON s.id = f.supplier_id
        LEFT JOIN doc_header h ON h.id = f.source_header_id LEFT JOIN doc_header dh ON dh.id = f.deposit_header_id LEFT JOIN gl_journal j ON j.id = f.pass_journal_id
       WHERE f.company_id = ${a.companyId} AND f.deleted_at IS NULL AND f.direction = ${q.direction} ${q.instrument !== 'all' ? sql`AND f.instrument = ${q.instrument}` : sql``}
         ${st ? sql`AND f.status IN (${sql.join(st)})` : sql``} ${q.bank_account_id ? sql`AND f.bank_account_id = ${q.bank_account_id}` : sql``}
         ${q.loose === 'Y' ? sql`AND f.deposit_header_id IS NULL` : sql``} ${q.remaining === 'Y' ? sql`AND f.remaining_amount - f.written_off_amount > 0` : sql``}
         ${q.party_id ? sql`AND (f.customer_id = ${q.party_id} OR f.supplier_id = ${q.party_id})` : sql``} ${q.journal_id ? sql`AND f.source_journal_id = ${q.journal_id}` : sql``} ${q.header_id ? sql`AND f.source_header_id = ${q.header_id}` : sql``} ${q.from ? sql`AND f.cheque_date >= ${q.from}` : sql``} ${q.to ? sql`AND f.cheque_date <= ${q.to}` : sql``}
         ${like ? sql`AND (f.cheque_no ILIKE ${like} OR f.payee_name ILIKE ${like} OR c.name ILIKE ${like} OR s.name ILIKE ${like} OR c.code ILIKE ${like} OR s.code ILIKE ${like} OR h.doc_no ILIKE ${like})` : sql``}
       ORDER BY f.cheque_date DESC, f.cheque_no LIMIT ${q.limit}`.execute(db)).rows;
    const sum = (await sql<{ status: string; n: number; amount: string }>`SELECT status, count(*)::int AS n, sum(amount) AS amount FROM fin_cheque WHERE company_id = ${a.companyId} AND deleted_at IS NULL AND direction = ${q.direction}
        ${q.instrument !== 'all' ? sql`AND instrument = ${q.instrument}` : sql``} GROUP BY status ORDER BY status`.execute(db)).rows;
    return { rows, by_status: sum.map((s) => ({ ...s, label: CHEQUE_STATUS[s.status] ?? s.status })) };
  });

  app.get('/api/v1/cheques/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const c = await db.selectFrom('fin_cheque as f').leftJoin('gl_journal as j', 'j.id', 'f.pass_journal_id').leftJoin('gl_journal as w', 'w.id', 'f.writeoff_journal_id').leftJoin('doc_header as dh', 'dh.id', 'f.deposit_header_id')
      .leftJoin('doc_header as h', 'h.id', 'f.source_header_id').leftJoin('md_customer as cu', 'cu.id', 'f.customer_id').leftJoin('md_supplier as su', 'su.id', 'f.supplier_id')
      .leftJoin('md_bank as bk', 'bk.id', 'f.bank_id').leftJoin('md_bank_account as ba', 'ba.id', 'f.bank_account_id')
      .selectAll('f').select(['bk.code as bank_code', 'bk.name_th as bank_name', 'ba.code as account_code', 'ba.name as account_name', 'j.voucher_no as pass_voucher_no', 'w.voucher_no as writeoff_voucher_no', 'dh.doc_no as deposit_doc_no', 'h.doc_no as source_doc_no', 'h.doc_class as source_doc_class', 'cu.code as customer_code', 'cu.name as customer_name', 'su.code as supplier_code', 'su.name as supplier_name'])
      .where('f.id', '=', id).where('f.company_id', '=', a.companyId).where('f.deleted_at', 'is', null).executeTakeFirst();
    if (!c) throw notFound('เช็ค');
    // เอกสารที่เกี่ยวข้อง <F8>: ใบเสร็จ/ใบจ่ายที่ใช้เช็คนี้ (รวมที่ใช้ยอดคงเหลือภายหลัง)
    const docs = (await sql`SELECT h.id, h.doc_no, h.doc_date, h.doc_class, h.net_amount, p.amount, h.doc_status FROM doc_payment p JOIN doc_header h ON h.id = p.header_id
        WHERE p.company_id = ${a.companyId} AND p.cheque_id = ${id} AND p.deleted_at IS NULL ORDER BY h.doc_date, h.doc_no`.execute(db)).rows;
    const events = await db.selectFrom('fin_cheque_event').select(['event_date', 'from_status', 'to_status', 'reason', 'created_at']).where('cheque_id', '=', id).where('company_id', '=', a.companyId).orderBy('created_at').execute();
    return { ...c, docs, events, status_label: CHEQUE_STATUS[c.status] ?? c.status, editable: ['00', '02', '05'].includes(c.status) && !c.pass_journal_id };
  });

  /** เพิ่มเช็คในทะเบียนเอง (เช็คยกมา ณ วันเริ่มใช้ — ไม่ลงบัญชี ยอดบัญชีป้อนที่ บันทึกยอดยกมา) */
  app.post('/api/v1/cheques', async (req) => {
    const a = requireCompany(req);
    const b = parse(chequeBody, req.body);
    if (d(b.amount).lte(0)) throw badRequest('จำนวนเงินต้องมากกว่า 0');
    if (b.direction === 'P' && !b.bank_account_id) throw badRequest('เช็คจ่าย: เลือกบัญชีเงินฝากที่สั่งจ่าย');
    if (b.direction === 'R' && !b.customer_id && !b.payee_name) throw badRequest('เลือกรหัสลูกค้า หรือป้อนผู้สั่งจ่าย');
    if (b.source_journal_id) {
      const jv = await db.selectFrom('gl_journal').select('doc_status').where('id', '=', b.source_journal_id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
      if (!jv || jv.doc_status === 'C') throw badRequest('ไม่พบใบสำคัญที่อ้างถึง (หรือถูกยกเลิกแล้ว)');
    }
    for (const [tbl, v] of [['md_customer', b.customer_id], ['md_supplier', b.supplier_id], ['md_bank', b.bank_id], ['md_bank_account', b.bank_account_id]] as const)
      if (v && !(await db.selectFrom(tbl).select('id').where('id', '=', v).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst())) throw badRequest('ไม่พบข้อมูลที่เลือก (ลูกค้า/ผู้จำหน่าย/ธนาคาร/บัญชีเงินฝาก)');
    return db.transaction().execute(async (tx) => {
      const dup = await tx.selectFrom('fin_cheque').select('id').where('company_id', '=', a.companyId).where('direction', '=', b.direction).where('cheque_no', '=', b.cheque_no).where('deleted_at', 'is', null)
        .where(sql<boolean>`coalesce(bank_account_id::text, '') = ${b.bank_account_id ?? ''}`).executeTakeFirst();
      if (dup) throw badRequest(`เลขที่เช็ค ${b.cheque_no} มีในทะเบียนแล้ว`);
      const status = b.direction === 'R' ? '00' : '05';
      const c = await tx.insertInto('fin_cheque').values({ ...b, company_id: a.companyId, branch_id: await branchOf(tx, a), instrument: 'CHEQUE', amount: d(b.amount).toFixed(2), charge: '0', net_amount: d(b.amount).toFixed(2),
        remaining_amount: '0', status, received_date: b.direction === 'R' ? b.received_date ?? b.cheque_date : null, created_by: a.userId, updated_by: a.userId }).returning('id').executeTakeFirstOrThrow();
      await event(tx, a, c.id, b.received_date ?? b.cheque_date, null, status, 'เพิ่มในทะเบียนเช็ค (ยกมา)');
      await logActivity(tx, a, { module: 'BK', action: 'ADD', docNo: b.cheque_no, table: 'fin_cheque', rowId: c.id });
      return { id: c.id };
    });
  });

  /** แก้ข้อมูลเช็ค (Alt+E — เช่น ลูกค้าเปลี่ยนเช็คใบใหม่หลังเช็คคืน) เฉพาะที่ยังไม่ผ่าน · ยอดเงินแก้ได้เฉพาะเช็คที่ป้อนเอง */
  app.put('/api/v1/cheques/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(chequeBody.partial().extend({ cheque_no: z.string().trim().min(1, 'ป้อนเลขที่เช็ค').max(30) }), req.body);
    return db.transaction().execute(async (tx) => {
      const [c] = await loadCheques(tx, a, [id]);
      if (!['00', '02', '05'].includes(c!.status) || c!.pass_journal_id || c!.deposit_header_id) throw badRequest('เช็คนำฝาก/ผ่านแล้ว แก้ไขไม่ได้ — ยกเลิกการนำฝาก/ผ่านก่อน');
      const dup = await tx.selectFrom('fin_cheque').select('id').where('company_id', '=', a.companyId).where('direction', '=', c!.direction).where('cheque_no', '=', b.cheque_no).where('id', '<>', id).where('deleted_at', 'is', null)
        .where(sql<boolean>`coalesce(bank_account_id::text, '') = ${c!.bank_account_id ?? ''}`).executeTakeFirst();
      if (dup) throw badRequest(`เลขที่เช็ค ${b.cheque_no} มีในทะเบียนแล้ว`);
      const amount = b.amount !== undefined && !c!.source_header_id ? d(b.amount).toFixed(2) : undefined;
      if (b.amount !== undefined && c!.source_header_id && !d(b.amount).eq(d(c!.amount))) throw badRequest('จำนวนเงินของเช็คที่มาจากใบเสร็จ/ใบจ่าย แก้ที่เอกสารต้นทาง');
      await tx.updateTable('fin_cheque').set({ cheque_no: b.cheque_no, ...(b.cheque_date ? { cheque_date: b.cheque_date } : {}), ...(b.bank_id !== undefined ? { bank_id: b.bank_id } : {}), ...(b.bank_branch !== undefined ? { bank_branch: b.bank_branch } : {}),
        ...(b.payee_name !== undefined ? { payee_name: b.payee_name } : {}), ...(b.remark !== undefined ? { remark: b.remark } : {}), ...(b.received_date !== undefined ? { received_date: b.received_date } : {}),
        ...(amount ? { amount, net_amount: amount } : {}), updated_by: a.userId, updated_at: sql`now()` as never }).where('id', '=', id).execute();
      await logActivity(tx, a, { module: 'BK', action: 'EDIT', docNo: b.cheque_no, table: 'fin_cheque', rowId: id });
      return { id };
    });
  });

  /** ลบเช็คที่ป้อนเอง (ยังไม่นำฝาก/ใช้) */
  app.delete('/api/v1/cheques/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    return db.transaction().execute(async (tx) => {
      const [c] = await loadCheques(tx, a, [id]);
      if (c!.source_header_id) throw badRequest('เช็คนี้มาจากใบเสร็จ/ใบจ่าย — ยกเลิกที่เอกสารต้นทาง');
      if (!['00', '05'].includes(c!.status) || c!.deposit_header_id) throw badRequest('เช็คนำฝาก/ผ่านแล้ว ลบไม่ได้');
      if ((await tx.selectFrom('doc_payment').select('id').where('cheque_id', '=', id).where('deleted_at', 'is', null).executeTakeFirst())) throw badRequest('เช็คนี้ถูกใช้ในใบเสร็จ/ใบจ่ายแล้ว ลบไม่ได้');
      await tx.updateTable('fin_cheque').set({ deleted_at: sql`now()` as never, updated_by: a.userId }).where('id', '=', id).execute();
      await logActivity(tx, a, { module: 'BK', action: 'DELETE', docNo: c!.cheque_no, table: 'fin_cheque', rowId: id });
      return { ok: true };
    });
  });

  /** S-BK-07 นำฝากเช็คเป็นใบๆ (ไม่ใช้ใบนำฝาก): 00/02 → 01 · ไม่ลงบัญชี */
  app.post('/api/v1/cheques/deposit', async (req) => {
    const a = requireCompany(req);
    const b = parse(z.object({ cheque_ids: z.array(uuid).min(1).max(500), bank_account_id: uuid, deposit_date: isoDate, charge: money.optional() }), req.body);
    await bankAcc(db, a.companyId, b.bank_account_id);
    return db.transaction().execute(async (tx) => {
      for (const c of await loadCheques(tx, a, b.cheque_ids)) {
        if (c.direction !== 'R' || !['00', '02'].includes(c.status)) throw badRequest(`เช็ค ${c.cheque_no} ไม่ใช่เช็ครับในมือ/คืนยื่นใหม่`);
        const charge = d(b.charge ?? 0);
        if (charge.lt(0) || charge.gte(d(c.amount))) throw badRequest('ค่าธรรมเนียมต้องไม่ติดลบและน้อยกว่าจำนวนเงินในเช็ค');
        await tx.updateTable('fin_cheque').set({ status: '01', bank_account_id: b.bank_account_id, deposit_date: b.deposit_date, charge: charge.toFixed(2), net_amount: d(c.amount).minus(charge).toFixed(2), updated_by: a.userId, updated_at: sql`now()` as never }).where('id', '=', c.id).execute();
        await event(tx, a, c.id, b.deposit_date, c.status, '01');
      }
      return { deposited: b.cheque_ids.length };
    });
  });
  /** ยกเลิกการนำฝาก (เป็นใบๆ) 01 → 00 */
  app.post('/api/v1/cheques/undeposit', async (req) => {
    const a = requireCompany(req);
    const b = parse(z.object({ cheque_ids: z.array(uuid).min(1).max(500) }), req.body);
    return db.transaction().execute(async (tx) => {
      for (const c of await loadCheques(tx, a, b.cheque_ids)) {
        if (c.status !== '01') throw badRequest(`เช็ค ${c.cheque_no} ไม่ได้อยู่ในสถานะรอเรียกเก็บ`);
        if (c.deposit_header_id) throw badRequest(`เช็ค ${c.cheque_no} อยู่ในใบนำฝาก — แก้ที่ใบนำฝาก`);
        await tx.updateTable('fin_cheque').set({ status: '00', deposit_date: null, charge: '0', net_amount: c.amount, updated_by: a.userId }).where('id', '=', c.id).execute();
        await event(tx, a, c.id, new Date().toISOString().slice(0, 10), '01', '00', 'ยกเลิกการนำฝาก');
      }
      return { ok: true };
    });
  });

  /** S-BK-08 ผ่านเช็ครับเป็นใบๆ (ยังไม่นำฝาก = นำฝากพร้อมผ่าน) · S-BK-09 ผ่านเช็คจ่าย — ลงบัญชีต่อใบ */
  app.post('/api/v1/cheques/pass', async (req) => {
    const a = requireCompany(req);
    const b = parse(z.object({ cheque_ids: z.array(uuid).min(1).max(500), pass_date: isoDate, bank_account_id: optId, charge: money.optional() }), req.body);
    return db.transaction().execute(async (tx) => {
      const out = [];
      for (const c of await loadCheques(tx, a, b.cheque_ids)) {
        if (c.deposit_header_id) throw badRequest(`เช็ค ${c.cheque_no} อยู่ในใบนำฝาก — ผ่านได้ทั้งใบนำฝากเท่านั้น`);
        if (c.direction === 'R') {
          if (!['00', '01', '02'].includes(c.status)) throw badRequest(`เช็ค ${c.cheque_no} ผ่านแล้วหรือสถานะไม่ถูกต้อง`);
          if (c.status !== '01') {
            // ยังไม่นำฝาก: ป้อนธนาคารที่นำฝาก (เช็คคืนรับเงินสดแทน = บัญชีเงินฝาก CC ที่ผูกบัญชีเงินสด — S-BK-11)
            if (!b.bank_account_id) throw badRequest(`เช็ค ${c.cheque_no} ยังไม่ได้นำฝาก — เลือกบัญชีที่นำฝาก`);
            const charge = d(b.charge ?? 0);
            await tx.updateTable('fin_cheque').set({ bank_account_id: b.bank_account_id, deposit_date: b.pass_date, charge: charge.toFixed(2), net_amount: d(c.amount).minus(charge).toFixed(2) }).where('id', '=', c.id).execute();
            c.bank_account_id = b.bank_account_id; c.charge = charge.toFixed(2);
          }
        } else if (!['00', '02', '05'].includes(c.status)) throw badRequest(`เช็คจ่าย ${c.cheque_no} ผ่านแล้วหรือสถานะไม่ถูกต้อง`);
        const j = await passOne(tx, a, c, b.pass_date);
        out.push({ id: c.id, voucher_no: j.voucher_no });
      }
      return { passed: out };
    });
  });
  /** ยกเลิกการผ่านเช็ค (ใบสำคัญยกเลิก) 10 → 01 / 05 */
  app.post('/api/v1/cheques/:id/unpass', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const { reason } = parse(z.object({ reason: z.string().trim().min(1, 'ป้อนเหตุผล').max(200) }), req.body);
    return db.transaction().execute(async (tx) => {
      const [c] = await loadCheques(tx, a, [id]);
      if (c!.status !== '10' || !c!.pass_journal_id) throw badRequest('เช็คนี้ยังไม่ได้ผ่านโดยโปรแกรมนี้ (หรือผ่านจากข้อมูลที่ย้ายมา) ยกเลิกไม่ได้');
      if (c!.deposit_header_id) throw badRequest('เช็คนี้ผ่านทั้งใบนำฝาก — ยกเลิกการผ่านที่ใบนำฝาก');
      await voidJournal(tx, a, c!.pass_journal_id, reason);
      const back = c!.direction === 'R' ? '01' : '05';
      await tx.updateTable('fin_cheque').set({ status: back, pass_date: null, pass_journal_id: null, updated_by: a.userId }).where('id', '=', id).execute();
      await event(tx, a, id, new Date().toISOString().slice(0, 10), '10', back, `ยกเลิกการผ่าน: ${reason}`);
      return { status: back };
    });
  });

  /** S-BK-10 บันทึกเช็คคืน: ประวัติ 20 เช็คคืน + เช็คเดิมเป็น 02 เช็คคืนยื่นใหม่ (ผ่านแล้ว = ยกเลิกใบสำคัญผ่านด้วย) */
  app.post('/api/v1/cheques/:id/return', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(z.object({ return_date: isoDate, reason: z.string().trim().min(1, 'ป้อนเหตุผลที่เช็คคืน').max(200) }), req.body);
    return db.transaction().execute(async (tx) => {
      const [c] = await loadCheques(tx, a, [id]);
      if (c!.direction !== 'R') throw badRequest('บันทึกเช็คคืนได้เฉพาะเช็ครับ');
      if (!['01', '10'].includes(c!.status)) throw badRequest('เช็คคืนได้เฉพาะเช็คที่นำฝากแล้ว (รอเรียกเก็บ/ผ่าน)');
      if (c!.deposit_header_id) throw badRequest('เช็คนี้อยู่ในใบนำฝาก — ยกเลิกการผ่าน/นำเช็คออกจากใบนำฝากก่อน');
      if (c!.status === '10') {
        if (!c!.pass_journal_id) throw badRequest('เช็คนี้ผ่านจากข้อมูลที่ย้ายมา — บันทึกกลับรายการทางบัญชีเอง');
        await voidJournal(tx, a, c!.pass_journal_id, `เช็คคืน: ${b.reason}`);
      }
      await tx.updateTable('fin_cheque').set({ status: '02', pass_date: null, pass_journal_id: null, deposit_date: null, updated_by: a.userId, updated_at: sql`now()` as never }).where('id', '=', id).execute();
      await event(tx, a, id, b.return_date, c!.status, '20', b.reason);
      await event(tx, a, id, b.return_date, '20', '02', 'รอยื่นใหม่/เปลี่ยนเช็ค/รับเงินสดแทน');
      return { status: '02', message: 'บันทึกประวัติเช็คคืนเรียบร้อยแล้ว เช็คใบเดิมเปลี่ยนสถานะเป็น "เช็คคืนยื่นใหม่" — ลูกค้าเปลี่ยนเช็คใบใหม่ให้แก้เลขที่เช็ค (Alt+E) · รับเงินสดแทนให้ผ่านเช็คเข้าบัญชีเงินฝากที่ผูกบัญชีเงินสด' };
    });
  });

  /** S-BK-12 ตัดยอดคงเหลือในเช็คเป็นรายได้อื่น: Dr บัญชีเช็ครับ / Cr รายได้อื่น */
  app.post('/api/v1/cheques/:id/write-off', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const { date } = parse(z.object({ date: isoDate }), req.body);
    return db.transaction().execute(async (tx) => {
      const [c] = await loadCheques(tx, a, [id]);
      const left = d(c!.remaining_amount).minus(d(c!.written_off_amount));
      if (c!.direction !== 'R' || left.lte(0)) throw badRequest('เช็คนี้ไม่มียอดคงเหลือจากการชำระใบเสร็จ');
      if (c!.writeoff_journal_id) throw badRequest('ตัดยอดคงเหลือเป็นรายได้แล้ว');
      const j = await createJournal(tx, await ctxJ(tx, a), { journal_book_id: await bookOf(tx, a.companyId, 'CHEQUE_EXCESS_INCOME'), voucher_date: date, description: `ตัดยอดคงเหลือในเช็ค ${c!.cheque_no} เป็นรายได้`, reference: c!.cheque_no,
        lines: [{ account_id: await chequeAcc(tx, a.companyId, id, 'R'), debit: left.toFixed(2), credit: '0', department_id: c!.department_id }, { account_id: await defAcc(tx, a.companyId, 'OTHER_INCOME'), debit: '0', credit: left.toFixed(2), department_id: c!.department_id }] }, '4', { sourceModule: 'BK' });
      await tx.updateTable('fin_cheque').set({ written_off_amount: d(c!.written_off_amount).plus(left).toFixed(2), writeoff_journal_id: j.id, is_settled: true, updated_by: a.userId }).where('id', '=', id).execute();
      await logActivity(tx, a, { module: 'BK', action: 'EDIT', docNo: c!.cheque_no, table: 'fin_cheque', rowId: id, detail: { write_off: left.toFixed(2) } });
      return { voucher_no: j.voucher_no, amount: left.toFixed(2) };
    });
  });
  app.post('/api/v1/cheques/:id/write-off/cancel', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const { reason } = parse(z.object({ reason: z.string().trim().min(1, 'ป้อนเหตุผล').max(200) }), req.body);
    return db.transaction().execute(async (tx) => {
      const [c] = await loadCheques(tx, a, [id]);
      if (!c!.writeoff_journal_id) throw badRequest('เช็คนี้ยังไม่ได้ตัดยอดคงเหลือเป็นรายได้โดยโปรแกรมนี้');
      const j = await tx.selectFrom('gl_journal').select('id').where('id', '=', c!.writeoff_journal_id).executeTakeFirst();
      const amt = (await sql<{ v: string }>`SELECT coalesce(sum(debit), 0) AS v FROM gl_journal_line WHERE journal_id = ${j!.id} AND deleted_at IS NULL`.execute(tx)).rows[0]!.v;
      await voidJournal(tx, a, c!.writeoff_journal_id, reason);
      await tx.updateTable('fin_cheque').set({ written_off_amount: d(c!.written_off_amount).minus(d(amt)).toFixed(2), writeoff_journal_id: null, is_settled: false, updated_by: a.userId }).where('id', '=', id).execute();
      return { ok: true };
    });
  });

  /* ------------------------------------------------ S-BK-05/06 ใบนำฝากเช็ค BQ (ผ่านได้ทั้งใบเท่านั้น) */
  const slipOf = async (tx: Db, a: Ctx, id: string) => {
    const h = await tx.selectFrom('doc_header').select(['id', 'doc_no', 'doc_status', 'doc_date', 'journal_id', 'bank_account_id', 'amount', 'vat_amount', 'wht_amount', 'net_amount', 'department_id'])
      .where('id', '=', id).where('company_id', '=', a.companyId).where('doc_class', '=', 'BQ').where('deleted_at', 'is', null).executeTakeFirst();
    if (!h) throw notFound('ใบนำฝากเช็ค');
    return h;
  };
  const releaseSlip = async (tx: Db, a: Ctx, id: string, date: string) => {
    for (const c of await tx.selectFrom('fin_cheque').select(['id', 'status']).where('deposit_header_id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).execute()) {
      await tx.updateTable('fin_cheque').set({ status: '00', deposit_header_id: null, deposit_date: null, charge: '0', net_amount: sql`amount` as never, updated_by: a.userId }).where('id', '=', c.id).execute();
      await event(tx, a, c.id, date, c.status, '00', 'นำออกจากใบนำฝาก', id);
    }
  };
  const saveSlip = async (a: Ctx, id: string | null, b: z.infer<typeof depBody>) => {
    await bankAcc(db, a.companyId, b.bank_account_id);
    return db.transaction().execute(async (tx) => {
      await periodFor(tx, a.companyId, b.doc_date);
      const dt = b.doc_type_id ? await tx.selectFrom('md_doc_type').select(['id', 'doc_class']).where('id', '=', b.doc_type_id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst()
        : await tx.selectFrom('md_doc_type').select(['id', 'doc_class']).where('company_id', '=', a.companyId).where('doc_class', '=', 'BQ').where('status', '=', 'A').where('deleted_at', 'is', null).orderBy('code').executeTakeFirst();
      if (!dt || dt.doc_class !== 'BQ') throw badRequest('ยังไม่มีประเภทเอกสารใบนำฝากเช็ค (BQ) — เพิ่มที่ เริ่มระบบ › เลขที่เอกสาร');
      let hid = id, docNo: string;
      if (id) {
        const h = await slipOf(tx, a, id);
        if (h.doc_status === 'C') throw badRequest('ใบนำฝากนี้ถูกยกเลิกแล้ว');
        if (h.journal_id) throw badRequest('ใบนำฝากนี้ผ่านเช็คแล้ว — ยกเลิกการผ่านก่อนแก้ไข');
        docNo = h.doc_no;
        await releaseSlip(tx, a, id, b.doc_date);
      } else {
        docNo = await docNoFor(tx, a.companyId, dt.id, b.doc_no);
        hid = (await tx.insertInto('doc_header').values({ company_id: a.companyId, branch_id: await branchOf(tx, a), doc_type_id: dt.id, doc_class: 'BQ', module: 'BK', doc_no: docNo, doc_date: b.doc_date, doc_status: 'N', created_by: a.userId }).returning('id').executeTakeFirstOrThrow()).id;
      }
      const cs = await loadCheques(tx, a, b.cheque_ids);
      for (const c of cs) {
        if (c.direction !== 'R' || !['00', '02'].includes(c.status) || c.deposit_header_id) throw badRequest(`เช็ค ${c.cheque_no} ไม่ใช่เช็ครับในมือ/คืนยื่นใหม่ หรืออยู่ในใบนำฝากอื่น`);
        await tx.updateTable('fin_cheque').set({ status: '01', deposit_header_id: hid, bank_account_id: b.bank_account_id, deposit_date: b.doc_date, charge: '0', net_amount: c.amount, updated_by: a.userId }).where('id', '=', c.id).execute();
        await event(tx, a, c.id, b.doc_date, c.status, '01', null, hid);
      }
      const amount = cs.reduce((s, c) => s.plus(d(c.amount)), d(0)), charge = d(b.charge ?? 0), vat = d(b.vat ?? 0), wht = d(b.wht ?? 0);
      const net = amount.minus(charge).minus(vat).minus(wht);
      if (charge.lt(0) || vat.lt(0) || wht.lt(0) || net.lte(0)) throw badRequest('ค่าธรรมเนียม/ภาษีต้องไม่ติดลบ และเงินเข้าบัญชีสุทธิต้องมากกว่า 0');
      await tx.updateTable('doc_header').set({ doc_date: b.doc_date, bank_account_id: b.bank_account_id, remark: b.remark, department_id: b.department_id, amount: amount.toFixed(2), discount_amount: charge.toFixed(2),
        vat_amount: vat.toFixed(2), wht_amount: wht.toFixed(2), net_amount: net.toFixed(2), express_rectype: b.discount ? 'S' : null, ref_no: b.discount ? b.ref_no : null, ref_date: b.discount ? b.ref_date : null, updated_by: a.userId }).where('id', '=', hid!).execute();
      await logActivity(tx, a, { module: 'BK', action: id ? 'EDIT' : 'ADD', docNo, table: 'doc_header', rowId: hid });
      // ขายลดเช็ค: ธนาคารจ่ายเงินทันที — ผ่านเช็ควันที่ขายลด
      const passed = b.discount ? await passSlip(tx, a, hid!, b.doc_date) : null;
      return { id: hid!, doc_no: docNo, net_amount: net.toFixed(2), voucher_no: passed?.voucher_no ?? null };
    });
  };
  app.get('/api/v1/cheque-deposits', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ q: z.string().optional(), limit: z.coerce.number().int().min(1).max(2000).default(300) }), req.query);
    const like = q.q?.trim() ? `%${q.q.trim()}%` : null;
    const rows = (await sql`SELECT h.id, h.doc_no, h.doc_date, h.remark, h.amount, h.net_amount, h.doc_status, h.express_rectype = 'S' AS discount, ba.code AS account_code, ba.name AS account_name, j.voucher_no,
          (SELECT count(*) FROM fin_cheque f WHERE f.deposit_header_id = h.id AND f.deleted_at IS NULL)::int AS cheques, (SELECT max(f.pass_date) FROM fin_cheque f WHERE f.deposit_header_id = h.id AND f.deleted_at IS NULL) AS pass_date
        FROM doc_header h LEFT JOIN md_bank_account ba ON ba.id = h.bank_account_id LEFT JOIN gl_journal j ON j.id = h.journal_id AND j.doc_status <> 'C'
       WHERE h.company_id = ${a.companyId} AND h.doc_class = 'BQ' AND h.deleted_at IS NULL ${like ? sql`AND (h.doc_no ILIKE ${like} OR h.remark ILIKE ${like})` : sql``}
       ORDER BY h.doc_date DESC, h.doc_no DESC LIMIT ${q.limit}`.execute(db)).rows;
    return { rows };
  });
  app.get('/api/v1/cheque-deposits/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const h = await slipOf(db, a, id);
    const full = await db.selectFrom('doc_header as x').leftJoin('md_bank_account as ba', 'ba.id', 'x.bank_account_id').select(['x.doc_type_id', 'x.remark', 'x.discount_amount as charge', 'ba.code as account_code', 'ba.name as account_name', 'x.ref_no', 'x.ref_date', sql<boolean>`x.express_rectype = 'S'`.as('discount')]).where('x.id', '=', id).executeTakeFirstOrThrow();
    const cheques = await db.selectFrom('fin_cheque as f').leftJoin('md_bank as b', 'b.id', 'f.bank_id').select(['f.id', 'f.cheque_no', 'f.cheque_date', 'b.code as bank_code', 'b.name_th as bank_name', 'f.bank_branch', 'f.amount', 'f.status', 'f.pass_date'])
      .where('f.deposit_header_id', '=', id).where('f.company_id', '=', a.companyId).where('f.deleted_at', 'is', null).orderBy('f.cheque_date').execute();
    const j = h.journal_id ? await db.selectFrom('gl_journal').select(['voucher_no', 'doc_status']).where('id', '=', h.journal_id).executeTakeFirst() : undefined;
    return { ...h, ...full, cheques, pass_voucher_no: j?.doc_status === 'N' ? j.voucher_no : null, passed: !!h.journal_id, editable: h.doc_status !== 'C' && !h.journal_id };
  });
  app.post('/api/v1/cheque-deposits', async (req) => saveSlip(requireCompany(req), null, parse(depBody, req.body)));
  app.put('/api/v1/cheque-deposits/:id', async (req) => saveSlip(requireCompany(req), parse(z.object({ id: uuid }), req.params).id, parse(depBody, req.body)));
  app.post('/api/v1/cheque-deposits/:id/cancel', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const { reason } = parse(z.object({ reason: z.string().trim().min(1, 'ป้อนเหตุผลที่ยกเลิก').max(200) }), req.body);
    return db.transaction().execute(async (tx) => {
      const h = await slipOf(tx, a, id);
      if (h.doc_status === 'C') throw badRequest('ใบนำฝากนี้ถูกยกเลิกแล้ว');
      if (h.journal_id) throw badRequest('ใบนำฝากนี้ผ่านเช็คแล้ว — ยกเลิกการผ่านก่อน');
      await releaseSlip(tx, a, id, String(h.doc_date).slice(0, 10));
      await tx.updateTable('doc_header').set({ doc_status: 'C', updated_by: a.userId }).where('id', '=', id).execute();
      await logActivity(tx, a, { module: 'BK', action: 'CANCEL', docNo: h.doc_no, table: 'doc_header', rowId: id, detail: { reason } });
      return { ok: true };
    });
  });
  /** บันทึกเช็คผ่านทั้งใบนำฝาก: Dr เงินฝาก (สุทธิ) + ค่าธรรมเนียม + ภาษีซื้อ + ภาษีถูกหัก / Cr บัญชีเช็ครับ */
  app.post('/api/v1/cheque-deposits/:id/pass', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const { pass_date } = parse(z.object({ pass_date: isoDate }), req.body);
    return db.transaction().execute((tx) => passSlip(tx, a, id, pass_date));
  });
  app.post('/api/v1/cheque-deposits/:id/unpass', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const { reason } = parse(z.object({ reason: z.string().trim().min(1, 'ป้อนเหตุผล').max(200) }), req.body);
    return db.transaction().execute(async (tx) => {
      const h = await slipOf(tx, a, id);
      if (!h.journal_id) throw badRequest('ใบนำฝากนี้ยังไม่ได้ผ่านเช็ค');
      await voidJournal(tx, a, h.journal_id, reason);
      await tx.updateTable('doc_header').set({ journal_id: null, gl_posted: 'N', updated_by: a.userId }).where('id', '=', id).execute();
      for (const c of await tx.selectFrom('fin_cheque').select('id').where('deposit_header_id', '=', id).where('deleted_at', 'is', null).execute()) {
        await tx.updateTable('fin_cheque').set({ status: '01', pass_date: null, pass_journal_id: null, updated_by: a.userId }).where('id', '=', c.id).execute();
        await event(tx, a, c.id, new Date().toISOString().slice(0, 10), '10', '01', `ยกเลิกการผ่าน: ${reason}`, id);
      }
      return { ok: true };
    });
  });
}
