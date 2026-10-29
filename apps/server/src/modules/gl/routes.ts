import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { d, ZERO, addMonths, addDays } from '@buddy/core';
import type { Db } from '../../db.js';
import { badRequest, conflict, notFound, parse, requireCompany } from '../../http.js';
import { logActivity } from '../../audit.js';
import { companySettings } from '../../company-template.js';
import { createFiscalYear } from '../../company-template.js';
import { closingOf, fiscalYearOf, leafTotals, loadChart, rollUp } from './balances.js';
import { cancelJournal, createJournal, getJournal, nextVoucherNo, updateJournal } from './journals.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ไม่ถูกต้อง');
const uuid = z.string().uuid();
const money = z.union([z.string(), z.number()]).nullable().optional();

export function glRoutes(app: FastifyInstance, db: Db) {
  /* ---------------------------------------------------------------- ผังบัญชี (คู่มือบทที่ 7 หน้า 96) */
  app.get('/api/v1/gl/accounts', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ with_balance: z.enum(['0', '1']).optional(), as_of: isoDate.optional() }), req.query);
    const chart = await loadChart(db, a.companyId);
    let bal: Map<string, { closing: string }> | undefined;
    if (q.with_balance === '1') {
      const asOf = q.as_of ?? a.workDate ?? new Date().toISOString().slice(0, 10);
      const fy = await fiscalYearOf(db, a.companyId, asOf);
      const leaf = await leafTotals(db, a.companyId, chart, fy?.start_date ?? asOf, asOf, {});
      const all = rollUp(chart, leaf);
      bal = new Map([...all].map(([id, t]) => [id, { closing: closingOf(t).toFixed(2) }]));
    }
    const usage = await db.selectFrom('gl_journal_line').select(['account_id', sql<number>`count(*)`.as('n')]).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).groupBy('account_id').execute();
    const used = new Map(usage.map((u) => [u.account_id, Number(u.n)]));
    return [...chart.byId.values()].map((x) => ({
      ...x, parent_no: x.parent_id ? chart.byId.get(x.parent_id)?.account_no ?? null : null,
      line_count: used.get(x.id) ?? 0, has_children: (chart.children.get(x.id)?.length ?? 0) > 0,
      balance: bal?.get(x.id)?.closing ?? (bal ? '0.00' : undefined),
    })).sort((x, y) => x.account_no.localeCompare(y.account_no));
  });

  const accountBody = z.object({
    account_no: z.string().trim().min(1, 'ป้อนเลขที่บัญชี').max(20),
    name_th: z.string().trim().min(1, 'ป้อนชื่อบัญชีภาษาไทย').max(120),
    name_en: z.string().trim().max(120).nullable().optional(),
    parent_id: uuid.nullable().optional(),
    level: z.coerce.number().int().min(1, 'ระดับบัญชีเริ่มที่ 1').max(9),
    account_group: z.enum(['1', '2', '3', '4', '5'], { errorMap: () => ({ message: 'เลือกหมวดบัญชี 1–5' }) }),
    is_control: z.boolean(),
    use_department: z.boolean().default(false),
    status: z.enum(['A', 'I']).default('A'),
  });

  async function checkAccount(companyId: string, b: z.infer<typeof accountBody>, selfId?: string) {
    const mask = (await companySettings(db, companyId))['gl.account_mask'];
    if (typeof mask === 'string' && mask) {
      const re = new RegExp('^' + mask.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/9/g, '\\d').replace(/!/g, '.').replace(/X/gi, '[A-Za-z0-9]') + '$');
      if (!re.test(b.account_no)) throw badRequest(`เลขที่บัญชีต้องเป็นรูปแบบ ${mask}`, [{ field: 'account_no', message: `รูปแบบ ${mask}` }]);
    }
    if (b.level > 1 && !b.parent_id) throw badRequest('บัญชีระดับมากกว่า 1 ต้องระบุบัญชีคุม', [{ field: 'parent_id', message: 'ต้องระบุบัญชีคุม' }]);
    if (b.parent_id) {
      const p = await db.selectFrom('gl_account').select(['id', 'level', 'is_control', 'account_group']).where('id', '=', b.parent_id).where('company_id', '=', companyId).where('deleted_at', 'is', null).executeTakeFirst();
      if (!p) throw badRequest('ไม่พบบัญชีคุม');
      if (!p.is_control) throw badRequest('บัญชีคุมที่เลือกเป็นบัญชีย่อย — ต้องเลือกบัญชีที่เป็นบัญชีคุม', [{ field: 'parent_id', message: 'ต้องเป็นบัญชีคุม' }]);
      if (p.level !== b.level - 1) throw badRequest(`บัญชีคุมต้องอยู่สูงกว่าบัญชีนี้ 1 ระดับ (บัญชีคุมระดับ ${p.level})`, [{ field: 'level', message: `ระดับต้องเป็น ${p.level + 1}` }]);
      if (p.account_group !== b.account_group) throw badRequest('หมวดบัญชีต้องเหมือนบัญชีคุม', [{ field: 'account_group', message: 'ต้องเหมือนบัญชีคุม' }]);
      if (selfId && p.id === selfId) throw badRequest('บัญชีคุมเป็นตัวเองไม่ได้');
    }
    const dup = await db.selectFrom('gl_account').select('id').where('company_id', '=', companyId).where('account_no', '=', b.account_no).where('deleted_at', 'is', null).executeTakeFirst();
    if (dup && dup.id !== selfId) throw conflict(`เลขที่บัญชี ${b.account_no} มีอยู่แล้ว`);
  }

  app.post('/api/v1/gl/accounts', async (req) => {
    const a = requireCompany(req);
    const b = parse(accountBody, req.body);
    await checkAccount(a.companyId, b);
    const r = await db.insertInto('gl_account').values({ ...b, name_en: b.name_en ?? null, parent_id: b.parent_id ?? null, normal_side: b.account_group === '1' || b.account_group === '5' ? 'D' : 'C', company_id: a.companyId, created_by: a.userId }).returning('id').executeTakeFirstOrThrow();
    await logActivity(db, a, { module: 'GL', action: 'ADD', docNo: b.account_no, table: 'gl_account', rowId: r.id });
    return r;
  });

  app.put('/api/v1/gl/accounts/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(accountBody, req.body);
    const cur = await db.selectFrom('gl_account').selectAll().where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!cur) throw notFound('บัญชี');
    if (b.account_no !== cur.account_no) throw badRequest('เปลี่ยนเลขที่บัญชีให้ใช้เมนู "เปลี่ยนเลขที่บัญชี" (Ctrl+G)');
    await checkAccount(a.companyId, b, id);
    if (cur.is_control && !b.is_control) {
      const kids = await db.selectFrom('gl_account').select('id').where('parent_id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
      if (kids) throw badRequest('บัญชีนี้มีบัญชีย่อยอยู่ เปลี่ยนเป็นบัญชีย่อยไม่ได้');
    }
    if (!cur.is_control && b.is_control) {
      const used = await db.selectFrom('gl_journal_line').select('id').where('account_id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
      if (used) throw badRequest('บัญชีนี้มีรายการบันทึกแล้ว เปลี่ยนเป็นบัญชีคุมไม่ได้');
    }
    await db.updateTable('gl_account').set({ ...b, name_en: b.name_en ?? null, parent_id: b.parent_id ?? null, updated_by: a.userId }).where('id', '=', id).execute();
    await logActivity(db, a, { module: 'GL', action: 'EDIT', docNo: b.account_no, table: 'gl_account', rowId: id, detail: { before: cur } });
    return { id };
  });

  /** เปลี่ยนเลขที่บัญชี (คู่มือบทที่ 7: S-GL-02, Ctrl+G) — รายการเดิมทั้งหมดตามไปเลขใหม่ เพราะอ้างด้วย id */
  app.post('/api/v1/gl/accounts/:id/renumber', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const { account_no } = parse(z.object({ account_no: z.string().trim().min(1, 'ป้อนเลขที่บัญชีใหม่').max(20) }), req.body);
    const cur = await db.selectFrom('gl_account').selectAll().where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!cur) throw notFound('บัญชี');
    await checkAccount(a.companyId, { ...cur, account_no, status: cur.status as 'A' | 'I', account_group: cur.account_group as '1', name_en: cur.name_en }, id);
    await db.updateTable('gl_account').set({ account_no, updated_by: a.userId }).where('id', '=', id).execute();
    await logActivity(db, a, { module: 'GL', action: 'RENUMBER', docNo: account_no, table: 'gl_account', rowId: id, detail: { from: cur.account_no, to: account_no } });
    return { id, account_no };
  });

  app.delete('/api/v1/gl/accounts/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const cur = await db.selectFrom('gl_account').select(['account_no']).where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!cur) throw notFound('บัญชี');
    const refs = await sql<{ n: number }>`SELECT
        (SELECT count(*) FROM gl_journal_line WHERE account_id = ${id} AND deleted_at IS NULL)
      + (SELECT count(*) FROM gl_account WHERE parent_id = ${id} AND deleted_at IS NULL)
      + (SELECT count(*) FROM gl_balance WHERE account_id = ${id} AND opening <> 0)
      + (SELECT count(*) FROM gl_default_account WHERE account_id = ${id} AND deleted_at IS NULL) AS n`.execute(db);
    if (Number(refs.rows[0]?.n ?? 0) > 0) throw badRequest('บัญชีนี้มีรายการ ยอดยกมา บัญชีย่อย หรือถูกใช้เป็นบัญชีมาตรฐานอยู่ ลบไม่ได้ (เปลี่ยนสถานะเป็นเลิกใช้แทน)');
    await db.updateTable('gl_account').set({ deleted_at: sql`now()` as never, updated_by: a.userId }).where('id', '=', id).execute();
    await logActivity(db, a, { module: 'GL', action: 'DELETE', docNo: cur.account_no, table: 'gl_account', rowId: id });
    return { ok: true };
  });

  /* ---------------------------------------------------------------- บัญชีมาตรฐาน (บทบาท) */
  app.get('/api/v1/gl/default-accounts', async (req) => {
    const a = requireCompany(req);
    return db.selectFrom('gl_default_account as d').innerJoin('gl_account as g', 'g.id', 'd.account_id')
      .select(['d.id', 'd.role', 'd.account_id', 'g.account_no', 'g.name_th']).where('d.company_id', '=', a.companyId).where('d.deleted_at', 'is', null).orderBy('d.role').execute();
  });

  /* ---------------------------------------------------------------- สมุดรายวัน (บทที่ 15: สร้างสมุดรายวัน) */
  app.get('/api/v1/gl/books', async (req) => {
    const a = requireCompany(req);
    return db.selectFrom('gl_journal_book as b').leftJoin('gl_template as t', (j) => j.onRef('t.id', '=', 'b.template_id').on('t.deleted_at', 'is', null))
      .select(['b.id', 'b.code', 'b.prefix', 'b.name_th', 'b.name_en', 'b.approve_level', 'b.template_id', 't.code as template_code',
        sql<number>`(SELECT count(*) FROM gl_journal j WHERE j.journal_book_id = b.id AND j.deleted_at IS NULL)`.as('journal_count')])
      .where('b.company_id', '=', a.companyId).where('b.deleted_at', 'is', null).orderBy('b.code').execute();
  });
  const bookBody = z.object({ code: z.string().trim().min(1, 'ป้อนรหัสสมุด').max(10), prefix: z.string().trim().min(1, 'ป้อนตัวนำเลขที่').max(10).regex(/^[A-Za-z0-9]+$/, 'ตัวนำเลขที่ใช้ตัวอักษรอังกฤษ/ตัวเลข'), name_th: z.string().trim().min(1, 'ป้อนชื่อสมุด').max(120), name_en: z.string().trim().max(120).nullable().optional(), template_id: uuid.nullable().optional() });
  /** ต้นแบบที่ผูกกับสมุด (S-GL-09 ช่อง "ต้นแบบ") ต้องเป็นของบริษัทนี้ */
  async function checkBookTemplate(companyId: string, templateId: string | null | undefined) {
    if (!templateId) return;
    const t = await db.selectFrom('gl_template').select('id').where('id', '=', templateId).where('company_id', '=', companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!t) throw badRequest('ไม่พบต้นแบบวิธีการบันทึกที่เลือก', [{ field: 'template_id', message: 'ไม่พบต้นแบบ' }]);
  }
  app.post('/api/v1/gl/books', async (req) => {
    const a = requireCompany(req);
    const b = parse(bookBody, req.body);
    await checkBookTemplate(a.companyId, b.template_id);
    const r = await db.insertInto('gl_journal_book').values({ ...b, name_en: b.name_en ?? null, template_id: b.template_id ?? null, company_id: a.companyId, created_by: a.userId }).returning('id').executeTakeFirstOrThrow();
    await logActivity(db, a, { module: 'GL', action: 'ADD', docNo: b.code, table: 'gl_journal_book', rowId: r.id });
    return r;
  });
  app.put('/api/v1/gl/books/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(bookBody, req.body);
    await checkBookTemplate(a.companyId, b.template_id);
    const r = await db.updateTable('gl_journal_book').set({ ...b, name_en: b.name_en ?? null, template_id: b.template_id ?? null, updated_by: a.userId }).where('id', '=', id).where('company_id', '=', a.companyId).executeTakeFirst();
    if (!Number(r.numUpdatedRows)) throw notFound('สมุดรายวัน');
    return { id };
  });

  /* ---------------------------------------------------------------- รอบบัญชี / งวด (บทที่ 6, ปิดงวด บทที่ 18) */
  app.get('/api/v1/gl/periods', async (req) => {
    const a = requireCompany(req);
    const years = await db.selectFrom('gl_fiscal_year as y')
      .select(['y.id', 'y.code', 'y.start_date', 'y.end_date', 'y.status',
        sql<number>`(SELECT count(*) FROM gl_journal j WHERE j.company_id = y.company_id AND j.voucher_date BETWEEN y.start_date AND y.end_date AND j.deleted_at IS NULL)`.as('journal_count')])
      .where('y.company_id', '=', a.companyId).where('y.deleted_at', 'is', null).orderBy('y.start_date').execute();
    const periods = await db.selectFrom('gl_period as p').leftJoin('sys_user as u', 'u.id', 'p.locked_by')
      .select(['p.id', 'p.fiscal_year_id', 'p.period_no', 'p.start_date', 'p.end_date', 'p.is_locked', 'p.locked_at', 'u.display_name as locked_by_name'])
      .where('p.company_id', '=', a.companyId).where('p.deleted_at', 'is', null).orderBy('p.start_date').execute();
    return years.map((y) => ({ ...y, periods: periods.filter((p) => p.fiscal_year_id === y.id) }));
  });

  app.post('/api/v1/gl/periods/years', async (req) => {
    const a = requireCompany(req);
    const b = parse(z.object({ start_date: isoDate }), req.body);
    const overlap = await db.selectFrom('gl_fiscal_year').select('code').where('company_id', '=', a.companyId).where('deleted_at', 'is', null)
      .where('start_date', '<=', addDays(addMonths(b.start_date, 12), -1)).where('end_date', '>=', b.start_date).executeTakeFirst();
    if (overlap) throw badRequest(`ช่วงวันที่ซ้อนกับปีบัญชี ${overlap.code}`);
    const id = await createFiscalYear(db, a.companyId, b.start_date, a.userId);
    await logActivity(db, a, { module: 'GL', action: 'ADD_YEAR', table: 'gl_fiscal_year', rowId: id, detail: b });
    return { id };
  });

  /** ปิด/เปิดงวด — ล็อคถึงงวดที่เลือก (ล็อคงวดก่อนหน้าทั้งหมดด้วย) หรือเปิดเฉพาะงวดนั้นและงวดหลังจากนั้น */
  app.post('/api/v1/gl/periods/:id/lock', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const { locked } = parse(z.object({ locked: z.boolean() }), req.body);
    const p = await db.selectFrom('gl_period').select(['id', 'start_date', 'end_date']).where('id', '=', id).where('company_id', '=', a.companyId).executeTakeFirst();
    if (!p) throw notFound('งวดบัญชี');
    const q = db.updateTable('gl_period').where('company_id', '=', a.companyId).where('deleted_at', 'is', null);
    const r = locked
      ? await q.set({ is_locked: true, locked_by: a.userId, locked_at: sql`now()` as never }).where('end_date', '<=', p.end_date).where('is_locked', '=', false).executeTakeFirst()
      : await q.set({ is_locked: false, locked_by: null, locked_at: null }).where('start_date', '>=', p.start_date).where('is_locked', '=', true).executeTakeFirst();
    await logActivity(db, a, { module: 'GL', action: locked ? 'LOCK' : 'UNLOCK', table: 'gl_period', rowId: id, detail: { until: p.end_date } });
    return { changed: Number(r.numUpdatedRows) };
  });

  /* ---------------------------------------------------------------- ใบสำคัญ (บทที่ 15 S-GL-02) */
  app.get('/api/v1/gl/journals', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({
      book_id: uuid.optional(), from: isoDate.optional(), to: isoDate.optional(), q: z.string().optional(),
      source: z.enum(['all', 'gl', 'other']).default('all'), status: z.enum(['all', 'N', 'C']).default('all'),
      limit: z.coerce.number().int().min(1).max(1000).default(200), offset: z.coerce.number().int().min(0).default(0),
    }), req.query);
    let s = db.selectFrom('gl_journal as j').innerJoin('gl_journal_book as b', 'b.id', 'j.journal_book_id').leftJoin('doc_header as h', 'h.id', 'j.source_header_id')
      .select(['j.id', 'j.voucher_no', 'j.voucher_date', 'j.description', 'j.reference', 'j.total_debit', 'j.doc_status', 'j.source_module', 'j.source_header_id',
        'b.code as book_code', 'b.prefix as book_prefix', 'h.doc_no as source_doc_no', 'h.doc_class as source_doc_class'])
      .where('j.company_id', '=', a.companyId).where('j.deleted_at', 'is', null);
    if (q.book_id) s = s.where('j.journal_book_id', '=', q.book_id);
    if (q.from) s = s.where('j.voucher_date', '>=', q.from);
    if (q.to) s = s.where('j.voucher_date', '<=', q.to);
    if (q.status !== 'all') s = s.where('j.doc_status', '=', q.status);
    if (q.source === 'gl') s = s.where('j.source_header_id', 'is', null);
    if (q.source === 'other') s = s.where('j.source_header_id', 'is not', null);
    if (q.q) {
      const like = `%${q.q.trim()}%`;
      s = s.where((eb) => eb.or([eb('j.voucher_no', 'ilike', like), eb('j.description', 'ilike', like), eb('j.reference', 'ilike', like), eb('h.doc_no', 'ilike', like)]));
    }
    const total = await s.clearSelect().select(sql<number>`count(*)`.as('n')).executeTakeFirstOrThrow();
    const rows = await s.orderBy('j.voucher_date', 'desc').orderBy('j.voucher_no', 'desc').limit(q.limit).offset(q.offset).execute();
    // total_debit ของรายการที่ย้ายมาอาจเป็น 0 — คำนวณจากบรรทัด
    const ids = rows.filter((r) => d(r.total_debit).isZero()).map((r) => r.id);
    if (ids.length) {
      const sums = await db.selectFrom('gl_journal_line').select(['journal_id', sql<string>`sum(debit)`.as('dr')]).where('journal_id', 'in', ids).where('deleted_at', 'is', null).groupBy('journal_id').execute();
      const m = new Map(sums.map((x) => [x.journal_id, x.dr]));
      for (const r of rows) if (m.has(r.id)) r.total_debit = d(m.get(r.id)).toFixed(2);
    }
    return { total: Number(total.n), rows };
  });

  app.get('/api/v1/gl/journals/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    return getJournal(db, a.companyId, id);
  });

  app.get('/api/v1/gl/journals-next-no', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ book_id: uuid, date: isoDate }), req.query);
    const style = String((await companySettings(db, a.companyId))['gl.voucher_numbering'] ?? '4');
    return { voucher_no: await nextVoucherNo(db, a.companyId, q.book_id, q.date, style) };
  });

  const journalBody = z.object({
    journal_book_id: uuid, voucher_date: isoDate, voucher_no: z.string().trim().max(30).nullable().optional(),
    description: z.string().trim().max(200).nullable().optional(), reference: z.string().trim().max(30).nullable().optional(),
    lines: z.array(z.object({ account_id: uuid.nullable(), department_id: uuid.nullable().optional(), description: z.string().max(200).nullable().optional(), debit: money, credit: money })).min(1, 'ป้อนรายการบัญชี').max(999),
  });
  app.post('/api/v1/gl/journals', async (req) => {
    const a = requireCompany(req);
    const b = parse(journalBody, req.body);
    const style = String((await companySettings(db, a.companyId))['gl.voucher_numbering'] ?? '4');
    return createJournal(db, a, b, style);
  });
  app.put('/api/v1/gl/journals/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    return updateJournal(db, a, id, parse(journalBody, req.body));
  });
  app.post('/api/v1/gl/journals/:id/cancel', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const { reason } = parse(z.object({ reason: z.string().trim().min(1, 'ป้อนเหตุผลที่ยกเลิก').max(200) }), req.body);
    return cancelJournal(db, a, id, reason);
  });

  /* ---------------------------------------------------------------- แผนก (บทที่ 6 S-SET-03) */
  app.get('/api/v1/departments', async (req) => {
    const a = requireCompany(req);
    return db.selectFrom('md_department').select(['id', 'code', 'name_th', 'name_en', 'short_name_th', 'short_name_en', 'status']).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).orderBy('code').execute();
  });
  const deptBody = z.object({ code: z.string().trim().min(1, 'ป้อนรหัสแผนก').max(10), name_th: z.string().trim().min(1, 'ป้อนชื่อเต็มไทย').max(120), name_en: z.string().trim().max(120).nullable().optional(), short_name_th: z.string().trim().max(30).nullable().optional(), short_name_en: z.string().trim().max(30).nullable().optional(), status: z.enum(['A', 'I']).default('A') });
  app.post('/api/v1/departments', async (req) => {
    const a = requireCompany(req);
    const b = parse(deptBody, req.body);
    const r = await db.insertInto('md_department').values({ ...b, name_en: b.name_en ?? null, short_name_th: b.short_name_th ?? null, short_name_en: b.short_name_en ?? null, company_id: a.companyId, created_by: a.userId }).returning('id').executeTakeFirstOrThrow();
    await logActivity(db, a, { module: 'GL', action: 'ADD', docNo: b.code, table: 'md_department', rowId: r.id });
    return r;
  });
  app.put('/api/v1/departments/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(deptBody, req.body);
    const r = await db.updateTable('md_department').set({ ...b, name_en: b.name_en ?? null, short_name_th: b.short_name_th ?? null, short_name_en: b.short_name_en ?? null, updated_by: a.userId }).where('id', '=', id).where('company_id', '=', a.companyId).executeTakeFirst();
    if (!Number(r.numUpdatedRows)) throw notFound('แผนก');
    return { id };
  });
  app.delete('/api/v1/departments/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const used = await db.selectFrom('gl_journal_line').select('id').where('department_id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
    if (used) throw badRequest('แผนกนี้มีรายการบัญชีแล้ว ลบไม่ได้ (เปลี่ยนสถานะเป็นเลิกใช้แทน)');
    await db.updateTable('md_department').set({ deleted_at: sql`now()` as never }).where('id', '=', id).where('company_id', '=', a.companyId).execute();
    return { ok: true };
  });

  /* ---------------------------------------------------------------- ยอดยกมา GL (บทที่ 8 S-OB-06) */
  app.get('/api/v1/gl/opening', async (req) => {
    const a = requireCompany(req);
    const rows = await db.selectFrom('gl_balance as b').innerJoin('gl_period as p', 'p.id', 'b.period_id').innerJoin('gl_account as g', 'g.id', 'b.account_id').leftJoin('md_department as dp', 'dp.id', 'b.department_id')
      .select(['b.id', 'b.account_id', 'g.account_no', 'g.name_th', 'b.department_id', 'dp.code as department_code', 'b.opening', 'p.start_date'])
      .where('b.company_id', '=', a.companyId).where('b.deleted_at', 'is', null).where('b.opening', '<>', '0').orderBy('g.account_no').execute();
    const first = await db.selectFrom('gl_period').select(['id', 'start_date']).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).orderBy('start_date').limit(1).executeTakeFirst();
    const total = rows.reduce((s, r) => s.plus(d(r.opening)), ZERO);
    return { as_of_period_start: rows[0]?.start_date ?? first?.start_date ?? null, rows, net: total.toFixed(2) };
  });

  /** บันทึกยอดยกมาทั้งชุด (แทนที่ของเดิม) — ยอดสุทธิต้องเป็นศูนย์ (เดบิต = เครดิต) */
  app.put('/api/v1/gl/opening', async (req) => {
    const a = requireCompany(req);
    const b = parse(z.object({ period_start: isoDate, rows: z.array(z.object({ account_id: uuid, department_id: uuid.nullable().optional(), debit: money, credit: money })) }), req.body);
    const net = b.rows.reduce((s, r) => s.plus(d(r.debit)).minus(d(r.credit)), ZERO);
    if (!net.isZero()) throw badRequest(`ยอดยกมาไม่ดุล: เดบิตต่างจากเครดิต ${net.abs().toFixed(2)}`);
    return db.transaction().execute(async (tx) => {
      const p = await tx.selectFrom('gl_period').select(['id', 'is_locked']).where('company_id', '=', a.companyId).where('start_date', '=', b.period_start).where('deleted_at', 'is', null).executeTakeFirst();
      if (!p) throw badRequest('ไม่พบงวดที่เริ่มต้นวันที่นี้ — ยอดยกมาต้องบันทึกที่งวดแรกของรอบบัญชี');
      const chart = await loadChart(tx, a.companyId);
      for (const r of b.rows) {
        const acc = chart.byId.get(r.account_id);
        if (!acc) throw badRequest('มีบัญชีที่ไม่พบในผังบัญชี');
        if (acc.is_control) throw badRequest(`บัญชี ${acc.account_no} เป็นบัญชีคุม บันทึกยอดยกมาไม่ได้`);
      }
      await tx.updateTable('gl_balance').set({ opening: '0' }).where('company_id', '=', a.companyId).where('opening', '<>', '0').execute();
      for (const r of b.rows) {
        const amt = d(r.debit).minus(d(r.credit));
        if (amt.isZero()) continue;
        const ex = await tx.selectFrom('gl_balance').select('id').where('company_id', '=', a.companyId).where('account_id', '=', r.account_id).where('period_id', '=', p.id)
          .where(sql<boolean>`department_id IS NOT DISTINCT FROM ${r.department_id ?? null}::uuid`).executeTakeFirst();
        if (ex) await tx.updateTable('gl_balance').set({ opening: amt.toFixed(2) }).where('id', '=', ex.id).execute();
        else await tx.insertInto('gl_balance').values({ company_id: a.companyId, account_id: r.account_id, department_id: r.department_id ?? null, period_id: p.id, opening: amt.toFixed(2) }).execute();
      }
      await logActivity(tx, a, { module: 'GL', action: 'OPENING', table: 'gl_balance', detail: { rows: b.rows.length, period_start: b.period_start } });
      return { ok: true };
    });
  });
}
