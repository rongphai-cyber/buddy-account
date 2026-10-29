import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { d } from '@buddy/core';
import type { Db } from '../db.js';
import { badRequest, notFound, parse, requireCompany } from '../http.js';
import { logActivity } from '../audit.js';
import { closingOf, fiscalYearOf, leafTotals, loadChart } from './gl/balances.js';

/**
 * กระทบยอดเงินฝากธนาคาร — เทียบยอดตามบัญชี (ใบสำคัญของบัญชี GL ที่ผูกกับบัญชีเงินฝาก) กับใบแจ้งยอดธนาคาร
 * ติ๊กรายการที่ปรากฏใน statement (gl_journal_line.bank_cleared_date) · ยอดตามบัญชี − เงินฝากระหว่างทาง + เช็ค/รายการจ่ายที่ธนาคารยังไม่ตัด = ยอดตาม statement
 */
const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ไม่ถูกต้อง');

async function bankOf(db: Db, companyId: string, id: string) {
  const b = await db.selectFrom('md_bank_account').select(['id', 'code', 'name', 'account_number', 'gl_account_id']).where('id', '=', id).where('company_id', '=', companyId).where('deleted_at', 'is', null).executeTakeFirst();
  if (!b) throw notFound('บัญชีเงินฝาก');
  if (!b.gl_account_id) throw badRequest(`บัญชีเงินฝาก ${b.code} ยังไม่ได้ผูกเลขที่บัญชี — กำหนดที่ รายละเอียดบัญชีเงินฝาก`);
  return b as typeof b & { gl_account_id: string };
}

export function bankReconRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/v1/bank-recon', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ bank_account_id: uuid, statement_date: isoDate, from: isoDate.optional() }), req.query);
    const b = await bankOf(db, a.companyId, q.bank_account_id);
    const fy = await fiscalYearOf(db, a.companyId, q.statement_date);
    if (!fy) throw badRequest('วันที่ใบแจ้งยอดไม่อยู่ในรอบบัญชี');
    // รายการก่อน "ตั้งแต่" ถือว่ากระทบแล้ว (ค่าเริ่มต้น = ต้นปีบัญชี — ยอดยกมาตรงกับธนาคาร)
    const from = q.from ?? String(fy.start_date).slice(0, 10);
    const chart = await loadChart(db, a.companyId);
    const t = (await leafTotals(db, a.companyId, chart, String(fy.start_date).slice(0, 10), q.statement_date)).get(b.gl_account_id);
    const book = t ? closingOf(t) : d(0);
    const lines = (await sql<{ id: string; voucher_no: string; voucher_date: string; description: string | null; debit: string; credit: string; bank_cleared_date: string | null; source_doc_no: string | null; reference: string | null }>`
        SELECT l.id, j.voucher_no, j.voucher_date, coalesce(l.description, j.description) AS description, l.debit, l.credit, l.bank_cleared_date, h.doc_no AS source_doc_no, j.reference
          FROM gl_journal_line l JOIN gl_journal j ON j.id = l.journal_id LEFT JOIN doc_header h ON h.id = j.source_header_id
         WHERE j.company_id = ${a.companyId} AND j.doc_status = 'N' AND j.deleted_at IS NULL AND l.deleted_at IS NULL AND l.account_id = ${b.gl_account_id}
           AND j.voucher_date >= ${from} AND j.voucher_date <= ${q.statement_date} AND (l.bank_cleared_date IS NULL OR l.bank_cleared_date >= ${q.statement_date})
         ORDER BY j.voucher_date, j.voucher_no, l.line_no LIMIT 5000`.execute(db)).rows;
    const open = lines.filter((l) => !l.bank_cleared_date || String(l.bank_cleared_date).slice(0, 10) > q.statement_date);
    const inTransit = open.reduce((s, l) => s.plus(d(l.debit)), d(0)), outstanding = open.reduce((s, l) => s.plus(d(l.credit)), d(0));
    const adjusted = book.minus(inTransit).plus(outstanding);
    const st = await db.selectFrom('fin_bank_statement').select(['closing_balance', 'remark']).where('company_id', '=', a.companyId).where('bank_account_id', '=', b.id).where('statement_date', '=', q.statement_date).where('deleted_at', 'is', null).executeTakeFirst();
    const statements = await db.selectFrom('fin_bank_statement').select(['statement_date', 'closing_balance']).where('company_id', '=', a.companyId).where('bank_account_id', '=', b.id).where('deleted_at', 'is', null).orderBy('statement_date', 'desc').limit(24).execute();
    return { bank: b, from, book_balance: book.toFixed(2), deposits_in_transit: inTransit.toFixed(2), outstanding_payments: outstanding.toFixed(2), adjusted_balance: adjusted.toFixed(2),
      statement_balance: st ? d(st.closing_balance).toFixed(2) : null, remark: st?.remark ?? null, difference: st ? adjusted.minus(d(st.closing_balance)).toFixed(2) : null,
      lines: lines.map((l) => ({ ...l, cleared: !!l.bank_cleared_date && String(l.bank_cleared_date).slice(0, 10) <= q.statement_date })), statements, truncated: lines.length >= 5000 };
  });

  /** ยอดตามใบแจ้งยอด (ป้อน/แก้) */
  app.put('/api/v1/bank-recon/statement', async (req) => {
    const a = requireCompany(req);
    const b = parse(z.object({ bank_account_id: uuid, statement_date: isoDate, closing_balance: z.union([z.string(), z.number()]).transform(String).refine((v) => !Number.isNaN(Number(v)), 'ต้องเป็นตัวเลข'), remark: z.string().trim().max(200).nullable().optional() }), req.body);
    const bank = await bankOf(db, a.companyId, b.bank_account_id);
    return db.transaction().execute(async (tx) => {
      await tx.updateTable('fin_bank_statement').set({ deleted_at: sql`now()` as never, updated_by: a.userId }).where('company_id', '=', a.companyId).where('bank_account_id', '=', bank.id).where('statement_date', '=', b.statement_date).where('deleted_at', 'is', null).execute();
      await tx.insertInto('fin_bank_statement').values({ company_id: a.companyId, bank_account_id: bank.id, statement_date: b.statement_date, closing_balance: d(b.closing_balance).toFixed(2), remark: b.remark || null, created_by: a.userId, updated_by: a.userId }).execute();
      await logActivity(tx, a, { module: 'BK', action: 'EDIT', docNo: `${bank.code} ${b.statement_date}`, table: 'fin_bank_statement', rowId: null });
      return { ok: true };
    });
  });

  /** ติ๊ก/ยกเลิกติ๊ก รายการที่ปรากฏใน statement */
  app.post('/api/v1/bank-recon/clear', async (req) => {
    const a = requireCompany(req);
    const b = parse(z.object({ bank_account_id: uuid, statement_date: isoDate, line_ids: z.array(uuid).min(1).max(5000), cleared: z.boolean() }), req.body);
    const bank = await bankOf(db, a.companyId, b.bank_account_id);
    return db.transaction().execute(async (tx) => {
      const ok = (await sql<{ id: string }>`SELECT l.id FROM gl_journal_line l JOIN gl_journal j ON j.id = l.journal_id
          WHERE j.company_id = ${a.companyId} AND l.account_id = ${bank.gl_account_id} AND l.deleted_at IS NULL AND j.doc_status = 'N' AND j.voucher_date <= ${b.statement_date} AND l.id IN (${sql.join(b.line_ids)})`.execute(tx)).rows;
      if (ok.length !== new Set(b.line_ids).size) throw badRequest('มีรายการที่ไม่ใช่ของบัญชีเงินฝากนี้ หรือลงวันที่หลังวันที่ใบแจ้งยอด');
      await tx.updateTable('gl_journal_line').set({ bank_cleared_date: b.cleared ? b.statement_date : null }).where('id', 'in', b.line_ids).execute();
      await logActivity(tx, a, { module: 'BK', action: 'EDIT', docNo: `${bank.code} ${b.statement_date}`, table: 'gl_journal_line', rowId: null, detail: { cleared: b.cleared, lines: b.line_ids.length } });
      return { updated: b.line_ids.length };
    });
  });
}
