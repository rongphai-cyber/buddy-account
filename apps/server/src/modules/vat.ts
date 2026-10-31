import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { d } from '@buddy/core';
import type { Db } from '../db.js';
import { badRequest, notFound, parse, requireCompany, type AuthContext } from '../http.js';
import { logActivity } from '../audit.js';
import { closingOf, leafTotals, loadChart } from './gl/balances.js';

/**
 * แฟ้มภาษีซื้อ/ภาษีขาย (คู่มือบทที่ 16 S-TX-01..08)
 * รายการเกิดจากเอกสารอัตโนมัติเมื่อบันทึก (syncVatEntries) — ภาษีเกณฑ์เงินสดเกิดที่ใบเสร็จ/ใบสำคัญจ่าย
 * ยอดเก็บเป็นบวกแบบ Express — ใบลดหนี้ (CN/DN) แสดง/รวมเป็นลบ
 */
type Ctx = Pick<AuthContext, 'userId'> & { companyId: string; branchId?: string | null };
export const VAT_CLASSES: Record<'S' | 'P', string[]> = { S: ['IV', 'HS', 'DR', 'CN', 'AI', 'OI', 'RE'], P: ['RR', 'HP', 'CP', 'DN', 'AE', 'OE', 'PS'] };
const NEG = ['CN', 'DN'];
const DESC: Record<string, string> = {
  IV: 'ขายเชื่อให้', HS: 'ขายสดให้', DR: 'เพิ่มหนี้', CN: 'ลดหนี้/รับคืน', AI: 'รับเงินมัดจำจาก', OI: 'รายได้อื่น ๆ', RE: 'รับชำระหนี้จาก',
  RR: 'ซื้อเชื่อจาก', HP: 'ซื้อสดจาก', CP: 'เพิ่มหนี้จาก', DN: 'ลดหนี้/ส่งคืน', AE: 'จ่ายเงินมัดจำ', OE: 'ค่าใช้จ่ายอื่น', PS: 'จ่ายชำระหนี้',
};
const signSql = sql`CASE WHEN h.doc_class IN ('CN','DN') THEN -1 ELSE 1 END`;

/** งวดภาษี = งวดบัญชีที่มีวันที่นี้ (ไม่ตรวจงวดปิด — แฟ้มภาษียื่นเพิ่มเติมได้) */
async function periodIdOf(db: Db, companyId: string, date: string) {
  const p = await db.selectFrom('gl_period').select('id').where('company_id', '=', companyId).where('deleted_at', 'is', null).where('start_date', '<=', date).where('end_date', '>=', date).orderBy('period_no').executeTakeFirst();
  if (!p) throw badRequest(`วันที่ ${date} ไม่อยู่ในรอบบัญชี — กำหนดรอบบัญชีก่อน (Message# 71)`);
  return p.id;
}

/** สร้าง/แทนรายการภาษีของเอกสาร (เรียกตอนบันทึกเอกสาร) — รายการที่ผู้ใช้แก้ในแฟ้มคงเลขที่/วันที่ใบกำกับ งวด ยื่นเพิ่มเติม ไว้ */
export async function syncVatEntries(tx: Db, ctx: Ctx, headerId: string) {
  const h = await tx.selectFrom('doc_header').select(['id', 'doc_class', 'doc_no', 'doc_date', 'payment_date', 'vat_date', 'vat_basis', 'price_type', 'ref_no', 'ref_date', 'your_ref', 'branch_id', 'department_id', 'is_opening',
    'party_name', 'party_tax_id', 'party_tax_branch_no', 'taxable_amount', 'vat_amount', 'zero_rate_amount', 'exempt_amount', 'doc_status'])
    .where('id', '=', headerId).where('company_id', '=', ctx.companyId).executeTakeFirst();
  if (!h || h.is_opening) return;
  const kind = VAT_CLASSES.S.includes(h.doc_class) ? 'S' : VAT_CLASSES.P.includes(h.doc_class) ? 'P' : null;
  if (!kind) return;
  if (h.doc_class === 'RE') await syncChargeVat(tx, ctx, h);
  let base = d(0), vat = d(0), zero = d(0), exempt = d(0);
  if (h.doc_class === 'RE' || h.doc_class === 'PS') {
    // ภาษีเกณฑ์เงินสด: เกิด ณ วันรับ/จ่ายชำระ ตามยอดภาษีของบิลที่ตัด
    const s = (await sql<{ amount: string; vat: string }>`SELECT coalesce(sum(CASE WHEN express_rectype = '5' THEN -amount ELSE amount END), 0) AS amount,
        coalesce(sum(CASE WHEN express_rectype = '5' THEN -vat_amount ELSE vat_amount END), 0) AS vat FROM doc_settlement WHERE payment_header_id = ${headerId} AND deleted_at IS NULL AND vat_amount <> 0`.execute(tx)).rows[0]!;
    vat = d(s.vat); base = d(s.amount).minus(vat);
  } else if (h.vat_basis !== '2') { base = d(h.taxable_amount); vat = d(h.vat_amount); zero = d(h.zero_rate_amount); exempt = d(h.exempt_amount); }
  const old = await tx.selectFrom('tax_vat_entry').selectAll().where('header_id', '=', headerId).where('company_id', '=', ctx.companyId).where('vat_kind', '=', kind).where('is_manual', '=', false).where('deleted_at', 'is', null).execute();
  // ภาษีขาย: บิลที่มีแต่รายการยกเว้นก็เข้าแฟ้ม (รายงานภาษีขายแยก 3 ประเภท 7% / 0% / ยกเว้น — ข้อกำหนดเจ้าของ)
  if (vat.isZero() && zero.isZero() && (kind !== 'S' || exempt.isZero())) {
    if (old.length) await tx.updateTable('tax_vat_entry').set({ deleted_at: sql`now()` as never }).where('id', 'in', old.map((o) => o.id)).execute();
    return;
  }
  // ยอดเก็บเป็นบวก (แบบ Express) — ใบเสร็จที่ตัดใบลดหนี้มากกว่าบิลให้เป็นลบได้
  const abs = (x: ReturnType<typeof d>) => (NEG.includes(h.doc_class) ? x.abs() : x);
  const prev = old.find((o) => o.is_modified);
  const ap = kind === 'P';
  const taxNo = ap ? ((h.doc_class === 'CP' || h.doc_class === 'DN' ? h.your_ref : h.ref_no) || h.doc_no) : h.doc_no;
  const taxDate = String((ap ? h.ref_date : null) ?? (h.doc_class === 'RE' || h.doc_class === 'PS' ? h.payment_date : null) ?? h.doc_date).slice(0, 10);
  const vatDate = String(h.vat_date ?? taxDate).slice(0, 10);
  const same = prev && d(prev.base_amount).plus(d(prev.nonclaim_base)).eq(abs(base)) && d(prev.vat_amount).plus(d(prev.nonclaim_vat)).eq(abs(vat)) && d(prev.zero_rate_amount).eq(abs(zero)) && d(prev.exempt_amount).eq(abs(exempt));
  if (same && old.length === 1) {
    await tx.updateTable('tax_vat_entry').set({ doc_no: h.doc_no, doc_date: String(h.doc_date).slice(0, 10), doc_status: h.doc_status === 'C' ? 'C' : 'N', updated_by: ctx.userId }).where('id', '=', prev.id).execute();
    return;
  }
  if (old.length) await tx.updateTable('tax_vat_entry').set({ deleted_at: sql`now()` as never }).where('id', 'in', old.map((o) => o.id)).execute();
  await tx.insertInto('tax_vat_entry').values({
    company_id: ctx.companyId, vat_kind: kind, header_id: headerId, branch_id: h.branch_id, doc_no: h.doc_no, doc_date: String(h.doc_date).slice(0, 10),
    tax_invoice_no: prev?.tax_invoice_no ?? taxNo, tax_invoice_date: prev ? String(prev.tax_invoice_date).slice(0, 10) : taxDate,
    vat_period_id: prev?.vat_period_id ?? (await periodIdOf(tx, ctx.companyId, vatDate)), is_late: prev?.is_late ?? false, department_id: h.department_id,
    description: (prev?.description ?? [DESC[h.doc_class], h.party_name].filter(Boolean).join(' ')).slice(0, 200), party_name: h.party_name, party_tax_id: h.party_tax_id, party_tax_branch_no: h.party_tax_branch_no,
    base_amount: abs(base).toFixed(2), vat_amount: abs(vat).toFixed(2), zero_rate_amount: abs(zero).toFixed(2), exempt_amount: abs(exempt).toFixed(2), is_modified: !!prev, remark: prev?.remark ?? null, created_by: ctx.userId,
  }).execute();
}

/**
 * ใบเสร็จ: รายการที่แพลตฟอร์มหัก (ข้อกำหนดเจ้าของ 31/10/2569) → ภาษีซื้อ (ใบกำกับในประเทศ) หรือ ภ.พ.36 (ผู้ให้บริการต่างประเทศ งวด = เดือนที่จ่าย)
 * รายการเดิมที่ยอด/เลขที่เท่าเดิมคงไว้ (รักษาที่ผู้ใช้แก้ในแฟ้มภาษี เช่น งวดที่ยื่น)
 */
async function syncChargeVat(tx: Db, ctx: Ctx, h: { id: string; doc_no: string; doc_date: unknown; payment_date: unknown; branch_id: string | null; department_id: string | null; doc_status: string }) {
  const cs = (await sql<{ vat_type: string; amount: string; vat_amount: string; tax_invoice_no: string | null; tax_invoice_date: string | null; title: string | null; name: string; tax_id: string | null; tax_branch_no: string | null; description: string | null }>`
    SELECT c.vat_type, c.amount, c.vat_amount, c.tax_invoice_no, c.tax_invoice_date::text, s.title, s.name, s.tax_id, s.tax_branch_no, c.description
      FROM doc_charge c JOIN md_supplier s ON s.id = c.supplier_id
     WHERE c.company_id = ${ctx.companyId} AND c.header_id = ${h.id} AND c.deleted_at IS NULL AND c.vat_type IN ('1', '3') AND c.vat_amount <> 0 ORDER BY c.line_no`.execute(tx)).rows;
  const old = await tx.selectFrom('tax_vat_entry').selectAll().where('header_id', '=', h.id).where('company_id', '=', ctx.companyId).where('vat_kind', 'in', ['P', 'R']).where('is_manual', '=', false).where('deleted_at', 'is', null).execute();
  const payDate = String(h.payment_date ?? h.doc_date).slice(0, 10), docDate = String(h.doc_date).slice(0, 10);
  const keep = new Set<string>();
  for (const c of cs) {
    const kind = c.vat_type === '3' ? 'R' : 'P';
    const invNo = c.tax_invoice_no ?? h.doc_no, invDate = kind === 'R' ? payDate : (c.tax_invoice_date ?? payDate);
    const prev = old.find((o) => !keep.has(o.id) && o.vat_kind === kind && o.tax_invoice_no === invNo && d(o.base_amount).plus(d(o.nonclaim_base)).eq(d(c.amount)) && d(o.vat_amount).plus(d(o.nonclaim_vat)).eq(d(c.vat_amount)));
    if (prev) { keep.add(prev.id); await tx.updateTable('tax_vat_entry').set({ doc_no: h.doc_no, doc_date: docDate, doc_status: h.doc_status === 'C' ? 'C' : 'N', updated_by: ctx.userId }).where('id', '=', prev.id).execute(); continue; }
    const party = [c.title, c.name].filter(Boolean).join(' ').slice(0, 200);
    await tx.insertInto('tax_vat_entry').values({
      company_id: ctx.companyId, vat_kind: kind, header_id: h.id, branch_id: h.branch_id, doc_no: h.doc_no, doc_date: docDate, tax_invoice_no: invNo, tax_invoice_date: invDate,
      vat_period_id: await periodIdOf(tx, ctx.companyId, kind === 'R' ? payDate : invDate), is_late: false, department_id: h.department_id,
      description: (c.description || `${kind === 'R' ? 'ภ.พ.36 ค่าบริการจาก' : 'ค่าบริการแพลตฟอร์ม'} ${party}`).slice(0, 200), party_name: party, party_tax_id: c.tax_id, party_tax_branch_no: c.tax_branch_no,
      base_amount: d(c.amount).toFixed(2), vat_amount: d(c.vat_amount).toFixed(2), created_by: ctx.userId,
    }).execute();
  }
  const drop = old.filter((o) => !keep.has(o.id)).map((o) => o.id);
  if (drop.length) await tx.updateTable('tax_vat_entry').set({ deleted_at: sql`now()` as never }).where('id', 'in', drop).execute();
}

/** ภ.พ.36 ของเดือนก่อน = ภาษีซื้อของเดือนนี้ (ชำระภายในวันที่ 7 ของเดือนถัดไป แล้วใบเสร็จ ภ.พ.36 เป็นใบกำกับภาษีซื้อ) */
export async function pp36Credit(db: Db, companyId: string, month: string) {
  const r = (await sql<{ base: string; vat: string; n: number }>`SELECT coalesce(sum(v.base_amount), 0) AS base, coalesce(sum(v.vat_amount), 0) AS vat, count(*)::int AS n
      FROM tax_vat_entry v JOIN gl_period gp ON gp.id = v.vat_period_id
     WHERE v.company_id = ${companyId} AND v.vat_kind = 'R' AND v.deleted_at IS NULL AND v.doc_status <> 'C'
       AND to_char(gp.start_date, 'YYYY-MM') = to_char((${month + '-01'}::date - interval '1 month'), 'YYYY-MM')`.execute(db)).rows[0]!;
  return { base: d(r.base), vat: d(r.vat), n: r.n };
}

/** ยกเลิกเอกสาร → รายการภาษีอัตโนมัติของเอกสารเป็นยกเลิก */
export async function cancelVatEntries(tx: Db, companyId: string, headerId: string) {
  await tx.updateTable('tax_vat_entry').set({ doc_status: 'C' }).where('company_id', '=', companyId).where('header_id', '=', headerId).where('is_manual', '=', false).where('deleted_at', 'is', null).execute();
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ไม่ถูกต้อง');
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'งวดไม่ถูกต้อง (ปปปป-ดด)');
const num = z.union([z.number(), z.string()]).transform((v) => String(v === '' ? 0 : v)).refine((v) => !Number.isNaN(Number(v)), 'ต้องเป็นตัวเลข');
const str = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));
export const vatEntryBody = z.object({
  tax_invoice_no: z.string().trim().min(1, 'ป้อนเลขที่ใบกำกับภาษี').max(30), tax_invoice_date: isoDate, month, is_late: z.boolean().default(false),
  department_id: z.string().uuid().nullable().optional().transform((v) => v ?? null), description: str(200), party_name: str(200), party_tax_id: str(13), party_tax_branch_no: str(5),
  base_amount: num, vat_amount: num, zero_rate_amount: num.default('0'), exempt_amount: num.default('0'), nonclaim_base: num.default('0'), nonclaim_vat: num.default('0'), remark: str(200),
  /** เพิ่มเอง: เลขที่/วันที่เอกสารภายใน */
  doc_no: str(30), doc_date: isoDate.nullable().optional(),
  /** ป้อนจากสมุดรายวัน (S-GL-03): ใบสำคัญที่มีบรรทัดภาษีซื้อ/ภาษีขาย */
  journal_id: z.string().uuid().nullable().optional().transform((v) => v ?? null),
  /** ป้อนจากใบจ่ายเงินสดย่อย DP (S-GL-11 แท็บรายการภาษีซื้อ) */
  header_id: z.string().uuid().nullable().optional().transform((v) => v ?? null),
});
/** เอกสารที่ป้อนรายการภาษี/ภาษีหัก ณ ที่จ่ายเองได้ (ใบจ่ายเงินสดย่อย) — ต้องเป็นของบริษัทนี้และยังไม่ยกเลิก */
export async function manualTaxDoc(db: Db, companyId: string, headerId: string) {
  const h = await db.selectFrom('doc_header').select(['doc_no', 'doc_date', 'doc_class', 'doc_status']).where('id', '=', headerId).where('company_id', '=', companyId).where('deleted_at', 'is', null).executeTakeFirst();
  if (!h || h.doc_status === 'C') throw badRequest('ไม่พบเอกสารที่อ้างถึง (หรือถูกยกเลิกแล้ว)');
  if (h.doc_class !== 'DP') throw badRequest('ป้อนรายการภาษีเองได้เฉพาะใบจ่ายเงินสดย่อย — เอกสารอื่นระบบสร้างรายการภาษีให้เอง');
  return h;
}

async function periodOfMonth(db: Db, companyId: string, m: string) {
  const p = await db.selectFrom('gl_period').select('id').where('company_id', '=', companyId).where('deleted_at', 'is', null).where(sql<boolean>`to_char(start_date, 'YYYY-MM') = ${m}`).orderBy('period_no').executeTakeFirst();
  if (!p) throw badRequest(`ไม่พบงวด ${m} ในรอบบัญชี — กำหนดรอบบัญชีก่อน`);
  return p.id;
}

/** เส้นทางแยกตามแฟ้ม (P = ภาษีซื้อ เมนู FI.VAT.IN · S = ภาษีขาย เมนู FI.VAT.OUT) เพื่อให้สิทธิ์ตามเมนูของแต่ละแฟ้ม */
export const VAT_KINDS = [{ kind: 'P', menu: 'FI.VAT.IN' }, { kind: 'S', menu: 'FI.VAT.OUT' }] as const;

export function vatRoutes(app: FastifyInstance, db: Db) {
  for (const { kind } of VAT_KINDS) {
    /** S-TX-02 / S-TX-06: แฟ้มภาษีของงวด (ยื่นรวมในงวด) · late=Y เฉพาะยื่นเพิ่มเติม */
    app.get(`/api/v1/vat/${kind}`, async (req) => {
      const a = requireCompany(req);
      const q = parse(z.object({ month: month.optional(), late: z.enum(['all', 'N', 'Y']).default('all'), status: z.enum(['N', 'C', 'all']).default('N'), q: z.string().optional(), journal_id: z.string().uuid().optional(), invoice_id: z.string().uuid().optional(), header_id: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(5000).default(3000) }), req.query);
      const like = q.q?.trim() ? `%${q.q.trim()}%` : null;
      const where = sql.join([sql`v.company_id = ${a.companyId}`, sql`v.vat_kind = ${kind}`, sql`v.deleted_at IS NULL`,
        ...(q.month ? [sql`to_char(p.start_date, 'YYYY-MM') = ${q.month}`] : []), ...(q.journal_id ? [sql`v.journal_id = ${q.journal_id}`] : []), ...(q.header_id ? [sql`v.header_id = ${q.header_id}`] : []), ...(q.invoice_id ? [sql`(v.header_id = ${q.invoice_id} OR v.header_id IN (SELECT s.payment_header_id FROM doc_settlement s WHERE s.invoice_header_id = ${q.invoice_id} AND s.company_id = ${a.companyId} AND s.deleted_at IS NULL))`] : []), ...(q.late !== 'all' ? [sql`v.is_late = ${q.late === 'Y'}`] : []), ...(q.status !== 'all' ? [sql`v.doc_status = ${q.status}`] : []),
        ...(like ? [sql`(v.tax_invoice_no ILIKE ${like} OR v.doc_no ILIKE ${like} OR v.party_name ILIKE ${like} OR v.party_tax_id ILIKE ${like} OR v.description ILIKE ${like})`] : [])], sql` AND `);
      const rows = (await sql<{ base_amount: string; vat_amount: string; zero_rate_amount: string; exempt_amount: string; nonclaim_base: string; nonclaim_vat: string; sign: number; doc_status: string }>`
        SELECT v.id, v.tax_invoice_no, v.tax_invoice_date, v.doc_no, v.doc_date, to_char(p.start_date, 'YYYY-MM') AS month, v.is_late, v.description, v.party_name, v.party_tax_id, v.party_tax_branch_no,
               v.base_amount, v.vat_amount, v.zero_rate_amount, v.exempt_amount, v.nonclaim_base, v.nonclaim_vat, v.is_manual, v.is_modified, v.doc_status, v.remark, v.department_id,
               h.id AS header_id, h.doc_class, ${signSql} AS sign
          FROM tax_vat_entry v JOIN gl_period p ON p.id = v.vat_period_id LEFT JOIN doc_header h ON h.id = v.header_id
         WHERE ${where} ORDER BY ${kind === 'P' ? sql`v.doc_date, v.doc_no` : sql`v.tax_invoice_date, v.tax_invoice_no`} LIMIT ${q.limit}`.execute(db)).rows;
      const sum = (k: 'base_amount' | 'vat_amount' | 'zero_rate_amount' | 'exempt_amount' | 'nonclaim_base' | 'nonclaim_vat') => rows.filter((r) => r.doc_status !== 'C').reduce((s, r) => s.plus(d(r[k]).times(r.sign)), d(0)).toFixed(2);
      return { rows, totals: { base: sum('base_amount'), vat: sum('vat_amount'), zero: sum('zero_rate_amount'), exempt: sum('exempt_amount'), nonclaim_base: sum('nonclaim_base'), nonclaim_vat: sum('nonclaim_vat') } };
    });
    /** S-TX-03 / S-TX-07: แก้รายการ — รายการจากเอกสารย้ายยอดระหว่างขอคืนได้/ไม่ได้ได้ แต่ยอดรวมต้องเท่าเดิม */
    app.put(`/api/v1/vat/${kind}/:id`, async (req) => {
      const a = requireCompany(req);
      const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
      const b = parse(vatEntryBody, req.body);
      const cur = await db.selectFrom('tax_vat_entry').selectAll().where('id', '=', id).where('company_id', '=', a.companyId).where('vat_kind', '=', kind).where('deleted_at', 'is', null).executeTakeFirst();
      if (!cur) throw notFound('รายการภาษี');
      if (cur.doc_status === 'C') throw badRequest('รายการนี้ถูกยกเลิกแล้ว');
      if (cur.vat_kind === 'S' && (!d(b.nonclaim_base).isZero() || !d(b.nonclaim_vat).isZero())) throw badRequest('ภาษีขายไม่มีช่องขอคืนไม่ได้');
      if (!cur.is_manual) {
        const okBase = d(b.base_amount).plus(d(b.nonclaim_base)).eq(d(cur.base_amount).plus(d(cur.nonclaim_base)));
        const okVat = d(b.vat_amount).plus(d(b.nonclaim_vat)).eq(d(cur.vat_amount).plus(d(cur.nonclaim_vat)));
        if (!okBase || !okVat || !d(b.zero_rate_amount).eq(d(cur.zero_rate_amount)) || !d(b.exempt_amount).eq(d(cur.exempt_amount))) throw badRequest('รายการที่มาจากเอกสาร ย้ายยอดระหว่างขอคืนได้/ขอคืนไม่ได้ได้เท่านั้น — ยอดรวมแก้ที่เอกสารต้นทาง');
      }
      const per = await periodOfMonth(db, a.companyId, b.month);
      await db.transaction().execute(async (tx) => {
        await tx.updateTable('tax_vat_entry').set({ tax_invoice_no: b.tax_invoice_no, tax_invoice_date: b.tax_invoice_date, vat_period_id: per, is_late: b.is_late, department_id: b.department_id, description: b.description,
          party_name: b.party_name, party_tax_id: b.party_tax_id, party_tax_branch_no: b.party_tax_branch_no, base_amount: d(b.base_amount).toFixed(2), vat_amount: d(b.vat_amount).toFixed(2),
          zero_rate_amount: d(b.zero_rate_amount).toFixed(2), exempt_amount: d(b.exempt_amount).toFixed(2), nonclaim_base: d(b.nonclaim_base).toFixed(2), nonclaim_vat: d(b.nonclaim_vat).toFixed(2), remark: b.remark,
          ...(cur.is_manual && b.doc_no ? { doc_no: b.doc_no, doc_date: b.doc_date ?? b.tax_invoice_date } : {}), is_modified: !cur.is_manual, updated_by: a.userId }).where('id', '=', id).execute();
        await logActivity(tx, a, { module: 'TAX', action: 'EDIT', docNo: cur.tax_invoice_no ?? cur.doc_no, table: 'tax_vat_entry', rowId: id });
      });
      return { ok: true };
    });
    /** เพิ่มรายการเอง (เช่น ใบกำกับที่ไม่ได้มาจากเอกสารในระบบ) */
    app.post(`/api/v1/vat/${kind}`, async (req) => addManualVat(db, requireCompany(req), kind, parse(vatEntryBody, req.body)));
    /** ยกเลิกรายการที่เพิ่มเอง (รายการจากเอกสารยกเลิกพร้อมเอกสาร) */
    app.post(`/api/v1/vat/${kind}/:id/cancel`, async (req) => {
      const a = requireCompany(req);
      const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
      const cur = await db.selectFrom('tax_vat_entry').select(['is_manual', 'doc_status', 'tax_invoice_no', 'doc_no']).where('id', '=', id).where('company_id', '=', a.companyId).where('vat_kind', '=', kind).where('deleted_at', 'is', null).executeTakeFirst();
      if (!cur) throw notFound('รายการภาษี');
      if (!cur.is_manual) throw badRequest('รายการนี้มาจากเอกสาร — ยกเลิกที่เอกสารต้นทาง');
      if (cur.doc_status === 'C') throw badRequest('รายการนี้ถูกยกเลิกแล้ว');
      await db.transaction().execute(async (tx) => {
        await tx.updateTable('tax_vat_entry').set({ doc_status: 'C', updated_by: a.userId }).where('id', '=', id).execute();
        await logActivity(tx, a, { module: 'TAX', action: 'CANCEL', docNo: cur.tax_invoice_no ?? cur.doc_no, table: 'tax_vat_entry', rowId: id });
      });
      return { ok: true };
    });
  }

  /**
   * T1.15 / S-ME-01: ใบสำคัญปรับปรุงภาษีมูลค่าเพิ่มประจำเดือน — ยอดคงเหลือบัญชีภาษีขาย/ภาษีซื้อ ณ สิ้นเดือน
   * Dr ภาษีขาย / Cr ภาษีซื้อ / ผลต่าง Cr เจ้าหนี้กรมสรรพากร (หรือ Dr ลูกหนี้กรมสรรพากร เมื่อภาษีซื้อมากกว่า)
   */
  app.get('/api/v1/gl/vat-closing', async (req) => {
    const a = requireCompany(req);
    const { month: m } = parse(z.object({ month }), req.query);
    const end = (await sql<{ e: string }>`SELECT (date_trunc('month', ${m + '-01'}::date) + interval '1 month - 1 day')::date::text AS e`.execute(db)).rows[0]!.e;
    const roles = await db.selectFrom('gl_default_account as r').leftJoin('gl_account as g', 'g.id', 'r.account_id').select(['r.role', 'r.account_id', 'g.account_no', 'g.name_th'])
      .where('r.company_id', '=', a.companyId).where('r.deleted_at', 'is', null).where('r.role', 'in', ['OUTPUT_VAT', 'INPUT_VAT', 'VAT_PAYABLE', 'VAT_REFUND', 'INPUT_VAT_PP36', 'INPUT_VAT_PENDING']).execute();
    const role = (k: string) => roles.find((r) => r.role === k && r.account_id);
    // ยอดคงเหลือ ณ สิ้นเดือนแบบเดียวกับแยกประเภท (ยอดยกมา + รายการ)
    const totals = await leafTotals(db, a.companyId, await loadChart(db, a.companyId), `${m}-01`, end);
    const bal = async (acc: string | null | undefined) => { const t = acc ? totals.get(acc) : undefined; return t ? closingOf(t) : d(0); };
    const out = role('OUTPUT_VAT'), inp = role('INPUT_VAT');
    if (!out || !inp) throw badRequest('ยังไม่ได้กำหนดบัญชีภาษีขาย/ภาษีซื้อ — กำหนดที่ เริ่มระบบ › การเชื่อมต่อบัญชี › บัญชีเพื่อลงรายวัน');
    const outBal = (await bal(out.account_id)).neg();   // ภาษีขายยอดเครดิต
    const inBal = await bal(inp.account_id);           // ภาษีซื้อยอดเดบิต
    // ภ.พ.36 ที่นำส่งเดือนก่อน: โอนจากภาษีซื้อรอเครดิตมาหักในเดือนนี้ (ข้อกำหนดเจ้าของ 31/10/2569)
    const pp36 = (await pp36Credit(db, a.companyId, m)).vat;
    const pp36Acc = role('INPUT_VAT_PP36') ?? role('INPUT_VAT_PENDING');
    const net = outBal.minus(inBal).minus(pp36);
    const settle = net.gte(0) ? role('VAT_PAYABLE') : role('VAT_REFUND');
    const line = (r: typeof out | undefined, debit: ReturnType<typeof d>, credit: ReturnType<typeof d>, desc: string) =>
      ({ account_id: r?.account_id ?? null, account_no: r?.account_no ?? null, account_name: r?.name_th ?? null, description: desc, debit: debit.toFixed(2), credit: credit.toFixed(2) });
    const lines = [
      ...(!outBal.isZero() ? [line(out, outBal.gt(0) ? outBal : d(0), outBal.lt(0) ? outBal.neg() : d(0), 'ปิดภาษีขาย')] : []),
      ...(!inBal.isZero() ? [line(inp, inBal.lt(0) ? inBal.neg() : d(0), inBal.gt(0) ? inBal : d(0), 'ปิดภาษีซื้อ')] : []),
      ...(!pp36.isZero() ? [line(pp36Acc, d(0), pp36, 'ภาษีซื้อจาก ภ.พ.36 เดือนก่อน')] : []),
      ...(!net.isZero() ? [line(settle, net.lt(0) ? net.neg() : d(0), net.gt(0) ? net : d(0), net.gt(0) ? 'ภาษีมูลค่าเพิ่มค้างจ่าย' : 'ภาษีมูลค่าเพิ่มรอขอคืน')] : []),
    ];
    return { date: end, description: `ปรับปรุงภาษีมูลค่าเพิ่มประจำเดือน ${m.slice(5)}/${m.slice(0, 4)}`, output_vat: outBal.toFixed(2), input_vat: inBal.toFixed(2), pp36_vat: pp36.toFixed(2), net: net.toFixed(2), lines,
      missing: !settle ? (net.gte(0) ? 'VAT_PAYABLE' : 'VAT_REFUND') : null };
  });
}

/** เพิ่มรายการภาษีเอง (แฟ้มภาษี / แท็บภาษีของใบสำคัญ / เงินสดย่อย DP) — เรียกในทรานแซกชันของผู้เรียกได้ (บันทึกพร้อมใบสำคัญใหม่) */
export async function addManualVat(db: Db, a: ReturnType<typeof requireCompany>, kind: 'P' | 'S', b: z.infer<typeof vatEntryBody>) {
  if (kind === 'S' && (!d(b.nonclaim_base).isZero() || !d(b.nonclaim_vat).isZero())) throw badRequest('ภาษีขายไม่มีช่องขอคืนไม่ได้');
  const per = await periodOfMonth(db, a.companyId, b.month);
  const jv = b.journal_id ? await db.selectFrom('gl_journal').select(['voucher_no', 'voucher_date', 'doc_status']).where('id', '=', b.journal_id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst() : undefined;
  if (b.journal_id && (!jv || jv.doc_status === 'C')) throw badRequest('ไม่พบใบสำคัญที่อ้างถึง (หรือถูกยกเลิกแล้ว)');
  if (jv) { b.doc_no = b.doc_no ?? jv.voucher_no; b.doc_date = b.doc_date ?? String(jv.voucher_date).slice(0, 10); }
  if (b.header_id) { const dh = await manualTaxDoc(db, a.companyId, b.header_id); b.doc_no = b.doc_no ?? dh.doc_no; b.doc_date = b.doc_date ?? String(dh.doc_date).slice(0, 10); }
  return db.transaction().execute(async (tx) => {
    const branch = a.branchId ?? (await tx.selectFrom('sys_branch').select('id').where('company_id', '=', a.companyId).where('is_head_office', '=', true).executeTakeFirstOrThrow()).id;
    const r = await tx.insertInto('tax_vat_entry').values({ company_id: a.companyId, vat_kind: kind, branch_id: branch, doc_no: b.doc_no ?? b.tax_invoice_no, doc_date: b.doc_date ?? b.tax_invoice_date,
      tax_invoice_no: b.tax_invoice_no, tax_invoice_date: b.tax_invoice_date, vat_period_id: per, is_late: b.is_late, department_id: b.department_id, description: b.description, party_name: b.party_name,
      party_tax_id: b.party_tax_id, party_tax_branch_no: b.party_tax_branch_no, base_amount: d(b.base_amount).toFixed(2), vat_amount: d(b.vat_amount).toFixed(2), zero_rate_amount: d(b.zero_rate_amount).toFixed(2), exempt_amount: d(b.exempt_amount).toFixed(2),
      nonclaim_base: d(b.nonclaim_base).toFixed(2), nonclaim_vat: d(b.nonclaim_vat).toFixed(2), is_manual: true, remark: b.remark, journal_id: b.journal_id, header_id: b.header_id, created_by: a.userId }).returning('id').executeTakeFirstOrThrow();
    await logActivity(tx, a, { module: 'TAX', action: 'ADD', docNo: b.tax_invoice_no, table: 'tax_vat_entry', rowId: r.id });
    return { id: r.id };
  });
}
