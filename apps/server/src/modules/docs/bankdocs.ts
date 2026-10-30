import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { BANK_KINDS, d, type BankKind } from '@buddy/core';
import type { Db } from '../../db.js';
import { badRequest, notFound, parse, requireCompany, type AuthContext } from '../../http.js';
import { logActivity } from '../../audit.js';
import { periodFor } from '../gl/journals.js';
import { ledgerOf } from '../gl/reports.js';
import { cancelDocument, postDocument, docNoFor, docNoInput } from './engine.js';
import { branchOf } from './payments.js';

/**
 * การเคลื่อนไหวบัญชีเงินฝาก (คู่มือบทที่ 13 S-BK-02/03 + รายได้/ค่าใช้จ่ายธนาคาร) — module BK
 * บรรทัดบัญชี (line_kind G) = บัญชี GL ของบัญชีเงินฝาก ยอดมีเครื่องหมาย (+ เข้า / − ออก) · อีกฝั่งลงตามประเภทเอกสาร (core buildPosting)
 * BD ฝาก: Dr เงินฝาก / Cr เงินสด · BW ถอน: กลับด้าน · BT โอน: Dr ปลายทาง + Dr ค่าธรรมเนียม / Cr ต้นทาง (รวม)
 * BU ดอกเบี้ยรับ: Dr เงินฝาก (สุทธิ) + Dr ภาษีถูกหัก / Cr รายได้ธนาคาร · BV: Dr ค่าใช้จ่ายธนาคาร / Cr เงินฝาก
 */
type Ctx = AuthContext & { companyId: string };
const uuid = z.string().uuid();
const optId = uuid.nullable().optional().transform((v) => v ?? null);
const money = z.union([z.number(), z.string()]).transform((v) => String(v === '' || v === null ? 0 : v)).refine((v) => !Number.isNaN(Number(v)), 'ต้องเป็นตัวเลข');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ไม่ถูกต้อง');
const body = z.object({
  doc_type_id: uuid, doc_no: docNoInput, doc_date: isoDate, department_id: optId, remark: z.string().trim().max(200).nullable().optional().transform((v) => v || null),
  bank_account_id: uuid, to_bank_account_id: optId, amount: money, fee: money.optional(), wht: money.optional(),
});

async function save(db: Db, a: Ctx, K: BankKind, id: string | null, b: z.infer<typeof body>) {
  const dt = await db.selectFrom('md_doc_type').select(['id', 'doc_class', 'status', 'department_id']).where('id', '=', b.doc_type_id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
  if (!dt || dt.doc_class !== K.cls) throw badRequest(`เลือกประเภทเอกสารของ${K.label}`);
  if (!id && dt.status !== 'A') throw badRequest('ประเภทเอกสารนี้เลิกใช้แล้ว');
  const ids = [b.bank_account_id, ...(K.cls === 'BT' && b.to_bank_account_id ? [b.to_bank_account_id] : [])];
  const banks = await db.selectFrom('md_bank_account').select(['id', 'code', 'name', 'gl_account_id', 'status']).where('company_id', '=', a.companyId).where('id', 'in', ids).where('deleted_at', 'is', null).execute();
  const bank = (bid: string) => {
    const x = banks.find((k) => k.id === bid);
    if (!x) throw badRequest('ไม่พบบัญชีเงินฝากที่เลือก');
    if (!x.gl_account_id) throw badRequest(`บัญชีเงินฝาก ${x.code} ยังไม่ได้ผูกเลขที่บัญชี — กำหนดที่ รายละเอียดบัญชีเงินฝาก`);
    return x;
  };
  const from = bank(b.bank_account_id);
  const amount = d(b.amount), fee = d(b.fee ?? 0), wht = d(b.wht ?? 0);
  if (amount.lte(0)) throw badRequest('จำนวนเงินต้องมากกว่า 0');
  if (fee.lt(0) || wht.lt(0)) throw badRequest('ค่าธรรมเนียม/ภาษีต้องไม่ติดลบ');
  if (K.cls === 'BU' && wht.gte(amount)) throw badRequest('ภาษีที่ธนาคารหักต้องน้อยกว่าดอกเบี้ยรับ');
  type L = { account_id: string; amount: string; description: string };
  let lines: L[], net: string;
  if (K.cls === 'BT') {
    if (!b.to_bank_account_id) throw badRequest('เลือกบัญชีที่โอนเข้า');
    if (b.to_bank_account_id === b.bank_account_id) throw badRequest('บัญชีที่โอนออกและโอนเข้าต้องต่างกัน');
    const to = bank(b.to_bank_account_id);
    const total = amount.plus(fee);
    lines = [{ account_id: from.gl_account_id!, amount: total.neg().toFixed(2), description: `โอนออก ${from.code} ${from.name}` }, { account_id: to.gl_account_id!, amount: amount.toFixed(2), description: `โอนเข้า ${to.code} ${to.name}` }];
    net = total.toFixed(2);
  } else {
    const inflow = K.cls === 'BD' || K.cls === 'BU';
    const v = K.cls === 'BU' ? amount.minus(wht) : amount;
    lines = [{ account_id: from.gl_account_id!, amount: (inflow ? v : v.neg()).toFixed(2), description: `${K.short} ${from.code} ${from.name}` }];
    net = v.toFixed(2);
  }
  const header = { doc_type_id: dt.id, doc_class: K.cls, module: 'BK', doc_date: b.doc_date, department_id: b.department_id ?? dt.department_id, remark: b.remark,
    bank_account_id: b.bank_account_id, to_bank_account_id: K.cls === 'BT' ? b.to_bank_account_id : null, amount: amount.toFixed(2), wht_amount: K.cls === 'BU' ? wht.toFixed(2) : '0', net_amount: net, updated_by: a.userId };
  return db.transaction().execute(async (tx) => {
    await periodFor(tx, a.companyId, b.doc_date);
    let hid = id, docNo: string;
    if (id) {
      const cur = await tx.selectFrom('doc_header').select(['doc_no', 'doc_status', 'doc_class', 'doc_date']).where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
      if (!cur || cur.doc_class !== K.cls) throw notFound(K.label);
      if (cur.doc_status === 'C') throw badRequest('เอกสารนี้ถูกยกเลิกแล้ว แก้ไขไม่ได้');
      await periodFor(tx, a.companyId, String(cur.doc_date).slice(0, 10));
      docNo = cur.doc_no;
      await tx.updateTable('doc_header').set(header).where('id', '=', id).execute();
      await tx.updateTable('doc_line').set({ deleted_at: sql`now()` as never }).where('header_id', '=', id).where('deleted_at', 'is', null).execute();
    } else {
      docNo = await docNoFor(tx, a.companyId, dt.id, b.doc_no);
      hid = (await tx.insertInto('doc_header').values({ ...header, company_id: a.companyId, branch_id: await branchOf(tx, a), doc_no: docNo, doc_status: 'N', created_by: a.userId }).returning('id').executeTakeFirstOrThrow()).id;
    }
    await tx.insertInto('doc_line').values(lines.map((l, i) => ({ company_id: a.companyId, header_id: hid!, line_no: i + 1, line_kind: 'G', account_id: l.account_id, description: l.description,
      department_id: header.department_id, qty: '1', line_amount: l.amount, net_amount: l.amount, created_by: a.userId }))).execute();
    const curJ = id ? await tx.selectFrom('gl_journal').select('id').where('source_header_id', '=', id).where('doc_status', '=', 'N').where('deleted_at', 'is', null).executeTakeFirst() : undefined;
    const posted = await postDocument(tx, a, hid!, curJ?.id);
    await logActivity(tx, a, { module: 'BK', action: id ? 'EDIT' : 'ADD', docNo, table: 'doc_header', rowId: hid });
    return { id: hid!, doc_no: docNo, journal_id: posted.journal_id, net_amount: net };
  });
}

export function bankDocRoutes(app: FastifyInstance, db: Db) {
  for (const K of BANK_KINDS) {
    const base = `/api/v1/${K.path}`;
    app.get(base, async (req) => {
      const a = requireCompany(req);
      const q = parse(z.object({ q: z.string().optional(), from: isoDate.optional(), to: isoDate.optional(), bank_account_id: uuid.optional(), type_id: uuid.optional(), limit: z.coerce.number().int().min(1).max(2000).default(300) }), req.query);
      const like = q.q?.trim() ? `%${q.q.trim()}%` : null;
      const rows = (await sql`SELECT h.id, h.doc_no, h.doc_date, h.remark, h.amount, h.wht_amount, h.net_amount, h.doc_status, b.code AS bank_code, b.name AS bank_name, tb.code AS to_bank_code, tb.name AS to_bank_name, j.voucher_no, j.id AS journal_id
          FROM doc_header h LEFT JOIN md_bank_account b ON b.id = h.bank_account_id LEFT JOIN md_bank_account tb ON tb.id = h.to_bank_account_id
          LEFT JOIN gl_journal j ON j.id = h.journal_id
         WHERE h.company_id = ${a.companyId} AND h.doc_class = ${K.cls} AND h.deleted_at IS NULL ${q.from ? sql`AND h.doc_date >= ${q.from}` : sql``} ${q.to ? sql`AND h.doc_date <= ${q.to}` : sql``}
           ${q.bank_account_id ? sql`AND (h.bank_account_id = ${q.bank_account_id} OR h.to_bank_account_id = ${q.bank_account_id})` : sql``} ${like ? sql`AND (h.doc_no ILIKE ${like} OR h.remark ILIKE ${like})` : sql``} ${q.type_id ? sql`AND h.doc_type_id = ${q.type_id}` : sql``}
         ORDER BY h.doc_date DESC, h.doc_no DESC LIMIT ${q.limit}`.execute(db)).rows;
      return { rows };
    });
    app.get(`${base}/:id`, async (req) => {
      const a = requireCompany(req);
      const { id } = parse(z.object({ id: uuid }), req.params);
      const h = await db.selectFrom('doc_header').select(['id', 'doc_no', 'doc_date', 'doc_type_id', 'department_id', 'remark', 'bank_account_id', 'to_bank_account_id', 'amount', 'wht_amount', 'net_amount', 'doc_status', 'journal_id'])
        .where('id', '=', id).where('company_id', '=', a.companyId).where('doc_class', '=', K.cls).where('deleted_at', 'is', null).executeTakeFirst();
      if (!h) throw notFound(K.label);
      const fee = K.cls === 'BT' ? d(h.net_amount).minus(d(h.amount)).toFixed(2) : '0.00';
      return { ...h, fee, editable: h.doc_status !== 'C' };
    });
    app.post(base, async (req) => save(db, requireCompany(req), K, null, parse(body, req.body)));
    app.put(`${base}/:id`, async (req) => save(db, requireCompany(req), K, parse(z.object({ id: uuid }), req.params).id, parse(body, req.body)));
    app.post(`${base}/:id/cancel`, async (req) => {
      const a = requireCompany(req);
      const { id } = parse(z.object({ id: uuid }), req.params);
      const { reason } = parse(z.object({ reason: z.string().trim().min(1, 'ป้อนเหตุผลที่ยกเลิก').max(200) }), req.body);
      const h = await db.selectFrom('doc_header').select('id').where('id', '=', id).where('company_id', '=', a.companyId).where('doc_class', '=', K.cls).where('deleted_at', 'is', null).executeTakeFirst();
      if (!h) throw notFound(K.label);
      return cancelDocument(db, a, id, reason);
    });
  }
  /** สมุดเงินฝาก: ความเคลื่อนไหวของบัญชี GL ที่ผูกกับบัญชีเงินฝาก (คำนวณสดจากใบสำคัญ — ตรงกับงบทดลองเสมอ) */
  app.get('/api/v1/bank-book', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ bank_account_id: uuid, from: isoDate, to: isoDate }), req.query);
    const b = await db.selectFrom('md_bank_account').select(['id', 'code', 'name', 'account_number', 'gl_account_id']).where('id', '=', q.bank_account_id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!b) throw notFound('บัญชีเงินฝาก');
    if (!b.gl_account_id) throw badRequest(`บัญชีเงินฝาก ${b.code} ยังไม่ได้ผูกเลขที่บัญชี — กำหนดที่ รายละเอียดบัญชีเงินฝาก`);
    return { bank: b, ...(await ledgerOf(db, a.companyId, b.gl_account_id, q.from, q.to, {})) };
  });
}
