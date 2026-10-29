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
    'party_name', 'party_tax_id', 'party_tax_branch_no', 'taxable_amount', 'vat_amount', 'zero_rate_amount', 'doc_status'])
    .where('id', '=', headerId).where('company_id', '=', ctx.companyId).executeTakeFirst();
  if (!h || h.is_opening) return;
  const kind = VAT_CLASSES.S.includes(h.doc_class) ? 'S' : VAT_CLASSES.P.includes(h.doc_class) ? 'P' : null;
  if (!kind) return;
  let base = d(0), vat = d(0), zero = d(0);
  if (h.doc_class === 'RE' || h.doc_class === 'PS') {
    // ภาษีเกณฑ์เงินสด: เกิด ณ วันรับ/จ่ายชำระ ตามยอดภาษีของบิลที่ตัด
    const s = (await sql<{ amount: string; vat: string }>`SELECT coalesce(sum(CASE WHEN express_rectype = '5' THEN -amount ELSE amount END), 0) AS amount,
        coalesce(sum(CASE WHEN express_rectype = '5' THEN -vat_amount ELSE vat_amount END), 0) AS vat FROM doc_settlement WHERE payment_header_id = ${headerId} AND deleted_at IS NULL AND vat_amount <> 0`.execute(tx)).rows[0]!;
    vat = d(s.vat); base = d(s.amount).minus(vat);
  } else if (h.vat_basis !== '2') { base = d(h.taxable_amount); vat = d(h.vat_amount); zero = d(h.zero_rate_amount); }
  const old = await tx.selectFrom('tax_vat_entry').selectAll().where('header_id', '=', headerId).where('company_id', '=', ctx.companyId).where('is_manual', '=', false).where('deleted_at', 'is', null).execute();
  if (vat.isZero() && zero.isZero()) {
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
  const same = prev && d(prev.base_amount).plus(d(prev.nonclaim_base)).eq(abs(base)) && d(prev.vat_amount).plus(d(prev.nonclaim_vat)).eq(abs(vat)) && d(prev.zero_rate_amount).eq(abs(zero));
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
    base_amount: abs(base).toFixed(2), vat_amount: abs(vat).toFixed(2), zero_rate_amount: abs(zero).toFixed(2), is_modified: !!prev, remark: prev?.remark ?? null, created_by: ctx.userId,
  }).execute();
}

/** ยกเลิกเอกสาร → รายการภาษีอัตโนมัติของเอกสารเป็นยกเลิก */
export async function cancelVatEntries(tx: Db, companyId: string, headerId: string) {
  await tx.updateTable('tax_vat_entry').set({ doc_status: 'C' }).where('company_id', '=', companyId).where('header_id', '=', headerId).where('is_manual', '=', false).where('deleted_at', 'is', null).execute();
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ไม่ถูกต้อง');
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'งวดไม่ถูกต้อง (ปปปป-ดด)');
const num = z.union([z.number(), z.string()]).transform((v) => String(v === '' ? 0 : v)).refine((v) => !Number.isNaN(Number(v)), 'ต้องเป็นตัวเลข');
const str = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));
const entryBody = z.object({
  tax_invoice_no: z.string().trim().min(1, 'ป้อนเลขที่ใบกำกับภาษี').max(30), tax_invoice_date: isoDate, month, is_late: z.boolean().default(false),
  department_id: z.string().uuid().nullable().optional().transform((v) => v ?? null), description: str(200), party_name: str(200), party_tax_id: str(13), party_tax_branch_no: str(5),
  base_amount: num, vat_amount: num, zero_rate_amount: num.default('0'), nonclaim_base: num.default('0'), nonclaim_vat: num.default('0'), remark: str(200),
  /** เพิ่มเอง: เลขที่/วันที่เอกสารภายใน */
  doc_no: str(30), doc_date: isoDate.nullable().optional(),
});

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
      const q = parse(z.object({ month: month.optional(), late: z.enum(['all', 'N', 'Y']).default('all'), status: z.enum(['N', 'C', 'all']).default('N'), q: z.string().optional(), limit: z.coerce.number().int().min(1).max(5000).default(3000) }), req.query);
      const like = q.q?.trim() ? `%${q.q.trim()}%` : null;
      const where = sql.join([sql`v.company_id = ${a.companyId}`, sql`v.vat_kind = ${kind}`, sql`v.deleted_at IS NULL`,
        ...(q.month ? [sql`to_char(p.start_date, 'YYYY-MM') = ${q.month}`] : []), ...(q.late !== 'all' ? [sql`v.is_late = ${q.late === 'Y'}`] : []), ...(q.status !== 'all' ? [sql`v.doc_status = ${q.status}`] : []),
        ...(like ? [sql`(v.tax_invoice_no ILIKE ${like} OR v.doc_no ILIKE ${like} OR v.party_name ILIKE ${like} OR v.party_tax_id ILIKE ${like} OR v.description ILIKE ${like})`] : [])], sql` AND `);
      const rows = (await sql<{ base_amount: string; vat_amount: string; zero_rate_amount: string; nonclaim_base: string; nonclaim_vat: string; sign: number; doc_status: string }>`
        SELECT v.id, v.tax_invoice_no, v.tax_invoice_date, v.doc_no, v.doc_date, to_char(p.start_date, 'YYYY-MM') AS month, v.is_late, v.description, v.party_name, v.party_tax_id, v.party_tax_branch_no,
               v.base_amount, v.vat_amount, v.zero_rate_amount, v.nonclaim_base, v.nonclaim_vat, v.is_manual, v.is_modified, v.doc_status, v.remark, v.department_id,
               h.id AS header_id, h.doc_class, ${signSql} AS sign
          FROM tax_vat_entry v JOIN gl_period p ON p.id = v.vat_period_id LEFT JOIN doc_header h ON h.id = v.header_id
         WHERE ${where} ORDER BY ${kind === 'P' ? sql`v.doc_date, v.doc_no` : sql`v.tax_invoice_date, v.tax_invoice_no`} LIMIT ${q.limit}`.execute(db)).rows;
      const sum = (k: 'base_amount' | 'vat_amount' | 'zero_rate_amount' | 'nonclaim_base' | 'nonclaim_vat') => rows.filter((r) => r.doc_status !== 'C').reduce((s, r) => s.plus(d(r[k]).times(r.sign)), d(0)).toFixed(2);
      return { rows, totals: { base: sum('base_amount'), vat: sum('vat_amount'), zero: sum('zero_rate_amount'), nonclaim_base: sum('nonclaim_base'), nonclaim_vat: sum('nonclaim_vat') } };
    });
    /** S-TX-03 / S-TX-07: แก้รายการ — รายการจากเอกสารย้ายยอดระหว่างขอคืนได้/ไม่ได้ได้ แต่ยอดรวมต้องเท่าเดิม */
    app.put(`/api/v1/vat/${kind}/:id`, async (req) => {
      const a = requireCompany(req);
      const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
      const b = parse(entryBody, req.body);
      const cur = await db.selectFrom('tax_vat_entry').selectAll().where('id', '=', id).where('company_id', '=', a.companyId).where('vat_kind', '=', kind).where('deleted_at', 'is', null).executeTakeFirst();
      if (!cur) throw notFound('รายการภาษี');
      if (cur.doc_status === 'C') throw badRequest('รายการนี้ถูกยกเลิกแล้ว');
      if (cur.vat_kind === 'S' && (!d(b.nonclaim_base).isZero() || !d(b.nonclaim_vat).isZero())) throw badRequest('ภาษีขายไม่มีช่องขอคืนไม่ได้');
      if (!cur.is_manual) {
        const okBase = d(b.base_amount).plus(d(b.nonclaim_base)).eq(d(cur.base_amount).plus(d(cur.nonclaim_base)));
        const okVat = d(b.vat_amount).plus(d(b.nonclaim_vat)).eq(d(cur.vat_amount).plus(d(cur.nonclaim_vat)));
        if (!okBase || !okVat || !d(b.zero_rate_amount).eq(d(cur.zero_rate_amount))) throw badRequest('รายการที่มาจากเอกสาร ย้ายยอดระหว่างขอคืนได้/ขอคืนไม่ได้ได้เท่านั้น — ยอดรวมแก้ที่เอกสารต้นทาง');
      }
      const per = await periodOfMonth(db, a.companyId, b.month);
      await db.transaction().execute(async (tx) => {
        await tx.updateTable('tax_vat_entry').set({ tax_invoice_no: b.tax_invoice_no, tax_invoice_date: b.tax_invoice_date, vat_period_id: per, is_late: b.is_late, department_id: b.department_id, description: b.description,
          party_name: b.party_name, party_tax_id: b.party_tax_id, party_tax_branch_no: b.party_tax_branch_no, base_amount: d(b.base_amount).toFixed(2), vat_amount: d(b.vat_amount).toFixed(2),
          zero_rate_amount: d(b.zero_rate_amount).toFixed(2), nonclaim_base: d(b.nonclaim_base).toFixed(2), nonclaim_vat: d(b.nonclaim_vat).toFixed(2), remark: b.remark,
          ...(cur.is_manual && b.doc_no ? { doc_no: b.doc_no, doc_date: b.doc_date ?? b.tax_invoice_date } : {}), is_modified: !cur.is_manual, updated_by: a.userId }).where('id', '=', id).execute();
        await logActivity(tx, a, { module: 'TAX', action: 'EDIT', docNo: cur.tax_invoice_no ?? cur.doc_no, table: 'tax_vat_entry', rowId: id });
      });
      return { ok: true };
    });
    /** เพิ่มรายการเอง (เช่น ใบกำกับที่ไม่ได้มาจากเอกสารในระบบ) */
    app.post(`/api/v1/vat/${kind}`, async (req) => {
      const a = requireCompany(req);
      const b = parse(entryBody, req.body);
      if (kind === 'S' && (!d(b.nonclaim_base).isZero() || !d(b.nonclaim_vat).isZero())) throw badRequest('ภาษีขายไม่มีช่องขอคืนไม่ได้');
      const per = await periodOfMonth(db, a.companyId, b.month);
      return db.transaction().execute(async (tx) => {
        const branch = a.branchId ?? (await tx.selectFrom('sys_branch').select('id').where('company_id', '=', a.companyId).where('is_head_office', '=', true).executeTakeFirstOrThrow()).id;
        const r = await tx.insertInto('tax_vat_entry').values({ company_id: a.companyId, vat_kind: kind, branch_id: branch, doc_no: b.doc_no ?? b.tax_invoice_no, doc_date: b.doc_date ?? b.tax_invoice_date,
          tax_invoice_no: b.tax_invoice_no, tax_invoice_date: b.tax_invoice_date, vat_period_id: per, is_late: b.is_late, department_id: b.department_id, description: b.description, party_name: b.party_name,
          party_tax_id: b.party_tax_id, party_tax_branch_no: b.party_tax_branch_no, base_amount: d(b.base_amount).toFixed(2), vat_amount: d(b.vat_amount).toFixed(2), zero_rate_amount: d(b.zero_rate_amount).toFixed(2),
          nonclaim_base: d(b.nonclaim_base).toFixed(2), nonclaim_vat: d(b.nonclaim_vat).toFixed(2), is_manual: true, remark: b.remark, created_by: a.userId }).returning('id').executeTakeFirstOrThrow();
        await logActivity(tx, a, { module: 'TAX', action: 'ADD', docNo: b.tax_invoice_no, table: 'tax_vat_entry', rowId: r.id });
        return { id: r.id };
      });
    });
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
      .where('r.company_id', '=', a.companyId).where('r.deleted_at', 'is', null).where('r.role', 'in', ['OUTPUT_VAT', 'INPUT_VAT', 'VAT_PAYABLE', 'VAT_REFUND']).execute();
    const role = (k: string) => roles.find((r) => r.role === k && r.account_id);
    // ยอดคงเหลือ ณ สิ้นเดือนแบบเดียวกับแยกประเภท (ยอดยกมา + รายการ)
    const totals = await leafTotals(db, a.companyId, await loadChart(db, a.companyId), `${m}-01`, end);
    const bal = async (acc: string | null | undefined) => { const t = acc ? totals.get(acc) : undefined; return t ? closingOf(t) : d(0); };
    const out = role('OUTPUT_VAT'), inp = role('INPUT_VAT');
    if (!out || !inp) throw badRequest('ยังไม่ได้กำหนดบัญชีภาษีขาย/ภาษีซื้อ — กำหนดที่ เริ่มระบบ › การเชื่อมต่อบัญชี › บัญชีเพื่อลงรายวัน');
    const outBal = (await bal(out.account_id)).neg();   // ภาษีขายยอดเครดิต
    const inBal = await bal(inp.account_id);           // ภาษีซื้อยอดเดบิต
    const net = outBal.minus(inBal);
    const settle = net.gte(0) ? role('VAT_PAYABLE') : role('VAT_REFUND');
    const line = (r: typeof out | undefined, debit: ReturnType<typeof d>, credit: ReturnType<typeof d>, desc: string) =>
      ({ account_id: r?.account_id ?? null, account_no: r?.account_no ?? null, account_name: r?.name_th ?? null, description: desc, debit: debit.toFixed(2), credit: credit.toFixed(2) });
    const lines = [
      ...(!outBal.isZero() ? [line(out, outBal.gt(0) ? outBal : d(0), outBal.lt(0) ? outBal.neg() : d(0), 'ปิดภาษีขาย')] : []),
      ...(!inBal.isZero() ? [line(inp, inBal.lt(0) ? inBal.neg() : d(0), inBal.gt(0) ? inBal : d(0), 'ปิดภาษีซื้อ')] : []),
      ...(!net.isZero() ? [line(settle, net.lt(0) ? net.neg() : d(0), net.gt(0) ? net : d(0), net.gt(0) ? 'ภาษีมูลค่าเพิ่มค้างจ่าย' : 'ภาษีมูลค่าเพิ่มรอขอคืน')] : []),
    ];
    return { date: end, description: `ปรับปรุงภาษีมูลค่าเพิ่มประจำเดือน ${m.slice(5)}/${m.slice(0, 4)}`, output_vat: outBal.toFixed(2), input_vat: inBal.toFixed(2), net: net.toFixed(2), lines,
      missing: !settle ? (net.gte(0) ? 'VAT_PAYABLE' : 'VAT_REFUND') : null };
  });
}
