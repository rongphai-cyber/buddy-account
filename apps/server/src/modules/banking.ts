import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { d } from '@buddy/core';
import type { Db } from '../db.js';
import { badRequest, conflict, notFound, parse, requireCompany, type AuthContext } from '../http.js';
import { logActivity } from '../audit.js';
import { checkAccount } from './parties.js';

type Ctx = AuthContext & { companyId: string };
const uuid = z.string().uuid();
const optId = uuid.nullable().optional().transform((v) => v ?? null);
const str = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));

/* ------------------------------------------------------------------ บัญชีเงินฝาก S-CQ-01 / S-BK-01 */
const bankBody = z.object({
  code: z.string().trim().min(1, 'ป้อนรหัสบัญชีเงินฝาก').max(10), name: z.string().trim().min(1, 'ป้อนชื่อบัญชีเงินฝาก').max(120),
  bank_id: optId, branch: str(60), account_number: str(30), short_name: str(20),
  account_kind: z.enum(['', 'C', 'S', 'F', 'H']).nullable().optional().transform((v) => v || null),
  gl_account_id: z.string({ required_error: 'เลือกเลขที่บัญชี (ผังบัญชี)', invalid_type_error: 'เลือกเลขที่บัญชี (ผังบัญชี)' }).uuid('เลือกเลขที่บัญชี (ผังบัญชี)'), currency: z.string().trim().length(3).default('THB'),
  opening_balance: z.union([z.number(), z.string()]).nullable().optional().transform((v) => (v === '' || v === null || v === undefined ? null : d(v).toFixed(2))),
  opening_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().transform((v) => v ?? null),
  status: z.enum(['A', 'I']).default('A'),
});

export function bankingRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/v1/bank-accounts', async (req) => {
    const a = requireCompany(req);
    return db.selectFrom('md_bank_account as b').leftJoin('gl_account as g', 'g.id', 'b.gl_account_id').leftJoin('md_bank as k', 'k.id', 'b.bank_id')
      .select(['b.id', 'b.code', 'b.name', 'b.branch', 'b.account_number', 'b.short_name', 'b.account_kind', 'b.bank_id', 'k.code as bank_code', 'k.name_th as bank_name', 'b.gl_account_id', 'g.account_no', 'g.name_th as account_name',
        'b.currency', 'b.opening_balance', 'b.opening_date', 'b.status',
        sql<number>`(SELECT count(*) FROM fin_cheque c WHERE c.bank_account_id = b.id AND c.deleted_at IS NULL)`.as('cheque_count'),
        sql<number>`(SELECT count(*) FROM md_payment_method p WHERE p.bank_account_id = b.id AND p.deleted_at IS NULL)`.as('method_count')])
      .where('b.company_id', '=', a.companyId).where('b.deleted_at', 'is', null).orderBy('b.code').execute();
  });
  async function save(a: Ctx, id: string | null, b: z.infer<typeof bankBody>) {
    const code = b.code.toUpperCase();
    // ไม่พบ (รวมถึงของบริษัทอื่น) ต้องตอบก่อนตรวจข้อมูล
    if (id && !(await db.selectFrom('md_bank_account').select('id').where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst())) throw notFound('บัญชีเงินฝาก');
    const dup = await db.selectFrom('md_bank_account').select('id').where('company_id', '=', a.companyId).where('code', '=', code).where('deleted_at', 'is', null).executeTakeFirst();
    if (dup && dup.id !== id) throw conflict(`รหัสบัญชีเงินฝาก ${code} มีอยู่แล้ว`);
    await checkAccount(db, a.companyId, b.gl_account_id, 'gl_account_id');
    if (b.bank_id && !(await db.selectFrom('md_bank').select('id').where('id', '=', b.bank_id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst())) throw badRequest('ไม่พบธนาคารนี้ในตารางธนาคาร');
    const row = { ...b, code };
    return db.transaction().execute(async (tx) => {
      if (id) {
        const before = await tx.selectFrom('md_bank_account').selectAll().where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
        if (!before) throw notFound('บัญชีเงินฝาก');
        await tx.updateTable('md_bank_account').set({ ...row, updated_by: a.userId }).where('id', '=', id).execute();
        await logActivity(tx, a, { module: 'FI', action: 'EDIT', docNo: code, table: 'md_bank_account', rowId: id, detail: { before } });
        return { id };
      }
      const r = await tx.insertInto('md_bank_account').values({ ...row, company_id: a.companyId, created_by: a.userId }).returning('id').executeTakeFirstOrThrow();
      await logActivity(tx, a, { module: 'FI', action: 'ADD', docNo: code, table: 'md_bank_account', rowId: r.id });
      return { id: r.id };
    });
  }
  app.post('/api/v1/bank-accounts', async (req) => save(requireCompany(req), null, parse(bankBody, req.body)));
  app.put('/api/v1/bank-accounts/:id', async (req) => save(requireCompany(req), parse(z.object({ id: uuid }), req.params).id, parse(bankBody, req.body)));
  app.delete('/api/v1/bank-accounts/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = await db.selectFrom('md_bank_account').select('code').where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!b) throw notFound('บัญชีเงินฝาก');
    const used = await sql<{ n: number }>`SELECT (SELECT count(*) FROM fin_cheque WHERE bank_account_id = ${id} AND deleted_at IS NULL) + (SELECT count(*) FROM md_payment_method WHERE bank_account_id = ${id} AND deleted_at IS NULL) AS n`.execute(db);
    if (Number(used.rows[0]?.n)) throw badRequest(`บัญชีเงินฝาก ${b.code} มีเช็ค/รายการโอน หรือผูกกับวิธีรับ-จ่ายชำระแล้ว ลบไม่ได้ — เปลี่ยนสถานะเป็นเลิกใช้แทน`);
    await db.updateTable('md_bank_account').set({ deleted_at: sql`now()` as never, updated_by: a.userId }).where('id', '=', id).execute();
    await logActivity(db, a, { module: 'FI', action: 'DELETE', docNo: b.code, table: 'md_bank_account', rowId: id });
    return { ok: true };
  });

  /* ------------------------------------------------------------------ วิธีรับชำระหนี้ S-SET-06 / วิธีจ่ายชำระหนี้ S-SET-08 */
  const dirParam = z.object({ direction: z.enum(['R', 'P']) });
  app.get('/api/v1/payment-methods/:direction', async (req) => {
    const a = requireCompany(req);
    const { direction } = parse(dirParam, req.params);
    return db.selectFrom('md_payment_method as p').leftJoin('gl_account as g', 'g.id', 'p.gl_account_id').leftJoin('md_bank_account as b', 'b.id', 'p.bank_account_id')
      .select(['p.id', 'p.seq', 'p.code', 'p.name_th', 'p.name_en', 'p.kind', 'p.creates_cheque', 'p.gl_account_id', 'g.account_no', 'p.bank_account_id', 'b.code as bank_code', 'p.status',
        sql<number>`(SELECT count(*) FROM doc_payment x WHERE x.payment_method_id = p.id AND x.deleted_at IS NULL)`.as('used')])
      .where('p.company_id', '=', a.companyId).where('p.direction', '=', direction).where('p.deleted_at', 'is', null)
      .orderBy(sql`coalesce(p.seq, '99')`).orderBy('p.code').execute();
  });
  const pmRow = z.object({
    id: uuid.optional(), seq: str(4), code: z.string().trim().min(1, 'ป้อนรหัส').max(2, 'รหัสวิธีชำระ 2 ตัว (นำหน้าเลขที่รายการ)').transform((v) => v.toUpperCase()),
    name_th: z.string().trim().min(1, 'ป้อนคำอธิบายไทย').max(120), name_en: str(120),
    kind: z.enum(['CASH', 'CHEQUE', 'TRANSFER', 'CARD', 'WHT', 'DISCOUNT', 'DEPOSIT', 'FX', 'OTHER']).default('OTHER'),
    creates_cheque: z.boolean().default(false), gl_account_id: optId, bank_account_id: optId, status: z.enum(['A', 'I']).default('A'),
  });
  app.put('/api/v1/payment-methods/:direction', async (req) => {
    const a = requireCompany(req);
    const { direction } = parse(dirParam, req.params);
    const { rows } = parse(z.object({ rows: z.array(pmRow).max(200) }), req.body);
    const seen = new Set<string>();
    for (const [i, r] of rows.entries()) {
      if (seen.has(r.code)) throw badRequest(`รหัส ${r.code} ซ้ำ (บรรทัดที่ ${i + 1})`);
      seen.add(r.code);
      await checkAccount(db, a.companyId, r.gl_account_id, 'gl_account_id');
      if (r.bank_account_id && !(await db.selectFrom('md_bank_account').select('id').where('id', '=', r.bank_account_id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst())) throw badRequest(`บรรทัดที่ ${i + 1}: ไม่พบบัญชีเงินฝากนี้`);
      // คู่มือหน้า 75–76: เงินโอนป้อนรหัสธนาคาร (ไม่ต้องป้อนเลขที่บัญชี) · อื่น ๆ ป้อนเลขที่บัญชี
      if (!r.gl_account_id && !r.bank_account_id) throw badRequest(`บรรทัดที่ ${i + 1} (${r.code}): ป้อนเลขที่บัญชี หรือเลือกธนาคาร (บัญชีเงินฝาก) สำหรับเงินโอน`);
      if (r.kind === 'TRANSFER' && !r.bank_account_id) throw badRequest(`บรรทัดที่ ${i + 1} (${r.code}): เงินโอนต้องเลือกธนาคาร (บัญชีเงินฝาก) เพื่อให้ปรากฏใน statement`);
    }
    const existing = await db.selectFrom('md_payment_method as p').select(['p.id', 'p.code', sql<number>`(SELECT count(*) FROM doc_payment x WHERE x.payment_method_id = p.id AND x.deleted_at IS NULL)`.as('used')])
      .where('p.company_id', '=', a.companyId).where('p.direction', '=', direction).where('p.deleted_at', 'is', null).execute();
    const keep = new Set(rows.map((r) => r.id).filter(Boolean));
    for (const r of rows) if (r.id && !existing.some((e) => e.id === r.id)) throw notFound('วิธีชำระ');
    const removed = existing.filter((e) => !keep.has(e.id));
    const usedRemoved = removed.find((e) => Number(e.used) > 0);
    if (usedRemoved) throw badRequest(`วิธีชำระ ${usedRemoved.code} ใช้ในเอกสารแล้ว ลบไม่ได้ — เปลี่ยนสถานะเป็นเลิกใช้แทน`);
    await db.transaction().execute(async (tx) => {
      // ลบก่อน เพื่อให้นำรหัสเดิมมาใช้ใหม่ได้ในการบันทึกครั้งเดียวกัน
      for (const e of removed) await tx.updateTable('md_payment_method').set({ deleted_at: sql`now()` as never, updated_by: a.userId }).where('id', '=', e.id).execute();
      // เปลี่ยนรหัสสลับกันได้: ตั้งรหัสชั่วคราวก่อน
      for (const r of rows.filter((x) => x.id)) await tx.updateTable('md_payment_method').set({ code: sql`'~' || substr(id::text, 1, 8)` as never }).where('id', '=', r.id!).execute();
      for (const { id, ...r } of rows) {
        if (id) await tx.updateTable('md_payment_method').set({ ...r, updated_by: a.userId }).where('id', '=', id).execute();
        else await tx.insertInto('md_payment_method').values({ ...r, direction, company_id: a.companyId, created_by: a.userId }).execute();
      }
      await logActivity(tx, a, { module: 'SET', action: 'EDIT', docNo: direction === 'R' ? 'วิธีรับชำระ' : 'วิธีจ่ายชำระ', table: 'md_payment_method', detail: { rows: rows.length, removed: removed.map((e) => e.code) } });
    });
    return { ok: true };
  });
}
