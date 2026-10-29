import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { d, ZERO, addMonths, addDays, formatDate, runFsLayout, expandHeader, isFormulaColumn, type FsColumn, type FsLine, Decimal } from '@buddy/core';
import type { Db } from '../../db.js';
import { badRequest, notFound, parse, requireCompany } from '../../http.js';
import { closingOf, fiscalYearOf, isPL, leafTotals, loadChart, rollUp, type Chart, type Totals } from './balances.js';
import { logActivity } from '../../audit.js';
import { budgetTotals } from './budget.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ไม่ถูกต้อง');
const uuid = z.string().uuid();
const t2 = (t: Totals) => ({ opening: t.opening.toFixed(2), debit: t.debit.toFixed(2), credit: t.credit.toFixed(2), closing: closingOf(t).toFixed(2) });

export function reportRoutes(app: FastifyInstance, db: Db) {
  /* ---------------------------------------------------------------- งบทดลอง (รายงาน 5.6.1 งบทดลองแบบเต็ม) */
  app.get('/api/v1/reports/trial-balance', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ from: isoDate, to: isoDate, level: z.coerce.number().int().min(0).max(9).default(0), branch_id: uuid.optional(), department_id: uuid.optional(), zero: z.enum(['0', '1']).default('0') }), req.query);
    if (q.from > q.to) throw badRequest('วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด');
    const fy = await fiscalYearOf(db, a.companyId, q.from);
    if (fy && q.to > fy.end_date) throw badRequest(`ช่วงวันที่ต้องอยู่ในปีบัญชีเดียวกัน (ปี ${fy.code} สิ้นสุด ${fy.end_date})`);
    const chart = await loadChart(db, a.companyId);
    const leaf = await leafTotals(db, a.companyId, chart, q.from, q.to, { branchId: q.branch_id, departmentId: q.department_id });
    const all = rollUp(chart, leaf);
    // level 0 = เฉพาะบัญชีย่อย (บัญชีที่ลงรายการได้); 1..9 = แสดงบัญชีคุมถึงระดับนั้น + บัญชีย่อยที่อยู่สูงกว่า
    const rows = [...chart.byId.values()].filter((x) => {
      if (q.level === 0) return !x.is_control || leaf.has(x.id);
      return x.level <= q.level && (x.level === q.level || !x.is_control || !chart.children.get(x.id)?.length);
    }).map((x) => {
      const t = (q.level === 0 ? leaf.get(x.id) : all.get(x.id)) ?? { opening: ZERO, debit: ZERO, credit: ZERO };
      return { id: x.id, account_no: x.account_no, name_th: x.name_th, name_en: x.name_en, level: x.level, account_group: x.account_group, is_control: x.is_control, ...t2(t) };
    }).filter((r) => q.zero === '1' || !(d(r.opening).isZero() && d(r.debit).isZero() && d(r.credit).isZero()))
      .sort((x, y) => x.account_no.localeCompare(y.account_no));
    const sum = (f: (r: (typeof rows)[number]) => Decimal) => rows.reduce((s, r) => s.plus(f(r)), ZERO).toFixed(2);
    const totals = {
      opening_debit: sum((r) => (d(r.opening).isPositive() ? d(r.opening) : ZERO)), opening_credit: sum((r) => (d(r.opening).isNegative() ? d(r.opening).neg() : ZERO)),
      debit: sum((r) => d(r.debit)), credit: sum((r) => d(r.credit)),
      closing_debit: sum((r) => (d(r.closing).isPositive() ? d(r.closing) : ZERO)), closing_credit: sum((r) => (d(r.closing).isNegative() ? d(r.closing).neg() : ZERO)),
    };
    return { from: q.from, to: q.to, fiscal_year: fy ?? null, rows, totals, balanced: totals.debit === totals.credit && totals.closing_debit === totals.closing_credit && totals.opening_debit === totals.opening_credit };
  });

  /* ---------------------------------------------------------------- บัญชีแยกประเภท */
  app.get('/api/v1/reports/ledger', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ account_id: uuid, from: isoDate, to: isoDate, branch_id: uuid.optional(), department_id: uuid.optional() }), req.query);
    const chart = await loadChart(db, a.companyId);
    const acc = chart.byId.get(q.account_id);
    if (!acc) throw notFound('บัญชี');
    const fam = chart.family(q.account_id);
    const leaf = await leafTotals(db, a.companyId, chart, q.from, q.to, { branchId: q.branch_id, departmentId: q.department_id });
    const opening = fam.reduce((s, id) => s.plus(leaf.get(id)?.opening ?? ZERO), ZERO);
    let s = db.selectFrom('gl_journal_line as l').innerJoin('gl_journal as j', 'j.id', 'l.journal_id').innerJoin('gl_account as g', 'g.id', 'l.account_id')
      .leftJoin('md_department as dp', 'dp.id', 'l.department_id').leftJoin('doc_header as h', 'h.id', 'j.source_header_id')
      .select(['j.id as journal_id', 'j.voucher_no', 'j.voucher_date', 'j.description as journal_description', 'l.description', 'l.debit', 'l.credit', 'g.account_no', 'dp.code as department_code', 'h.doc_no as source_doc_no', 'j.reference'])
      .where('j.company_id', '=', a.companyId).where('j.doc_status', '=', 'N').where('j.deleted_at', 'is', null).where('l.deleted_at', 'is', null)
      .where('l.account_id', 'in', fam).where('j.voucher_date', '>=', q.from).where('j.voucher_date', '<=', q.to);
    if (q.branch_id) s = s.where('j.branch_id', '=', q.branch_id);
    if (q.department_id) s = s.where('l.department_id', '=', q.department_id);
    const lines = await s.orderBy('j.voucher_date').orderBy('j.voucher_no').orderBy('l.line_no').execute();
    let run = opening;
    const rows = lines.map((l) => { run = run.plus(d(l.debit)).minus(d(l.credit)); return { ...l, balance: run.toFixed(2) }; });
    const debit = lines.reduce((x, l) => x.plus(d(l.debit)), ZERO), credit = lines.reduce((x, l) => x.plus(d(l.credit)), ZERO);
    return { account: acc, opening: opening.toFixed(2), rows, debit: debit.toFixed(2), credit: credit.toFixed(2), closing: run.toFixed(2) };
  });

  /* ---------------------------------------------------------------- รายงานสมุดรายวัน */
  app.get('/api/v1/reports/journal-book', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ book_id: uuid.optional(), from: isoDate, to: isoDate }), req.query);
    let s = db.selectFrom('gl_journal as j').innerJoin('gl_journal_book as b', 'b.id', 'j.journal_book_id')
      .select(['j.id', 'j.voucher_no', 'j.voucher_date', 'j.description', 'b.code as book_code', 'b.name_th as book_name'])
      .where('j.company_id', '=', a.companyId).where('j.doc_status', '=', 'N').where('j.deleted_at', 'is', null).where('j.voucher_date', '>=', q.from).where('j.voucher_date', '<=', q.to);
    if (q.book_id) s = s.where('j.journal_book_id', '=', q.book_id);
    const js = await s.orderBy('j.voucher_date').orderBy('j.voucher_no').limit(5000).execute();
    const ids = js.map((j) => j.id);
    const lines = ids.length ? await db.selectFrom('gl_journal_line as l').innerJoin('gl_account as g', 'g.id', 'l.account_id')
      .select(['l.journal_id', 'l.line_no', 'g.account_no', 'g.name_th', 'l.description', 'l.debit', 'l.credit']).where('l.journal_id', 'in', ids).where('l.deleted_at', 'is', null).orderBy('l.journal_id').orderBy('l.line_no').execute() : [];
    const by = new Map<string, typeof lines>();
    for (const l of lines) { const x = by.get(l.journal_id) ?? []; x.push(l); by.set(l.journal_id, x); }
    return { rows: js.map((j) => ({ ...j, lines: by.get(j.id) ?? [] })), truncated: js.length >= 5000 };
  });

  /* ---------------------------------------------------------------- งบการเงิน */
  app.get('/api/v1/fs/layouts', async (req) => {
    const a = requireCompany(req);
    const reps = await db.selectFrom('gl_fs_report').select(['id', 'code', 'name', 'header_lines', 'columns', 'line_set_code', 'number_format']).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).orderBy('code').execute();
    const counts = await db.selectFrom('gl_fs_line').select(['line_set_code', sql<number>`count(*)`.as('n')]).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).groupBy('line_set_code').execute();
    const m = new Map(counts.map((c) => [c.line_set_code, Number(c.n)]));
    return reps.map((r) => ({ ...r, line_count: m.get(r.line_set_code ?? r.code) ?? 0 }));
  });

  app.get('/api/v1/fs/layouts/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const r = await db.selectFrom('gl_fs_report').selectAll().where('id', '=', id).where('company_id', '=', a.companyId).executeTakeFirst();
    if (!r) throw notFound('แบบงบการเงิน');
    const lines = await db.selectFrom('gl_fs_line').select(['id', 'line_no', 'data_type', 'source', 'sign_filter', 'print_condition', 'accumulate', 'description_th', 'description_en', 'department_id'])
      .where('company_id', '=', a.companyId).where('line_set_code', '=', r.line_set_code ?? r.code).where('deleted_at', 'is', null).orderBy('line_no').execute();
    const shared = await db.selectFrom('gl_fs_report').select(['code', 'name']).where('company_id', '=', a.companyId).where('line_set_code', '=', r.line_set_code ?? r.code).where('id', '<>', id).where('deleted_at', 'is', null).execute();
    return { ...r, lines, shared_with: shared };
  });

  const fsLineBody = z.object({
    line_no: z.coerce.number().int().min(1).max(99999),
    data_type: z.enum(['A/C', 'BEG', 'INV', 'VAR', 'TXT', '---', '===']),
    source: z.string().max(60).nullable().optional(), sign_filter: z.enum(['', '+', '-']).nullable().optional(),
    print_condition: z.enum(['', 'Z', 'N', 'C']).nullable().optional(),
    accumulate: z.record(z.enum(['A', 'B', 'C', 'D', 'E']), z.enum(['', '+', '-', '0', '/'])).nullable().optional(),
    description_th: z.string().max(120).nullable().optional(), description_en: z.string().max(120).nullable().optional(),
  });
  const fsBody = z.object({
    code: z.string().trim().min(1, 'ป้อนรหัสงบ').max(10), name: z.string().trim().min(1, 'ป้อนชื่องบ').max(120),
    header_lines: z.array(z.string().max(120)).max(4), columns: z.array(z.object({ expr: z.string().trim().min(1).max(40), head1: z.string().max(40).optional(), head2: z.string().max(40).optional() })).min(1, 'ต้องมีอย่างน้อย 1 คอลัมน์').max(18),
    line_set_code: z.string().trim().min(1).max(10), lines: z.array(fsLineBody).optional(),
  });

  /** สร้าง/แก้ไขแบบงบ (บทที่ 24) — ถ้าส่ง lines มาด้วย จะแทนที่บรรทัดของชุดบรรทัดนั้นทั้งชุด */
  app.post('/api/v1/fs/layouts', async (req) => saveLayout(requireCompany(req), null, parse(fsBody, req.body)));
  app.put('/api/v1/fs/layouts/:id', async (req) => saveLayout(requireCompany(req), parse(z.object({ id: uuid }), req.params).id, parse(fsBody, req.body)));

  async function saveLayout(a: ReturnType<typeof requireCompany>, id: string | null, b: z.infer<typeof fsBody>) {
    return db.transaction().execute(async (tx) => {
      const vals = { code: b.code, name: b.name, header_lines: JSON.stringify(b.header_lines), columns: JSON.stringify(b.columns), line_set_code: b.line_set_code };
      let rid = id;
      if (id) {
        const r = await tx.updateTable('gl_fs_report').set({ ...vals, updated_by: a.userId }).where('id', '=', id).where('company_id', '=', a.companyId).executeTakeFirst();
        if (!Number(r.numUpdatedRows)) throw notFound('แบบงบการเงิน');
      } else {
        rid = (await tx.insertInto('gl_fs_report').values({ ...vals, company_id: a.companyId, created_by: a.userId }).returning('id').executeTakeFirstOrThrow()).id;
      }
      if (b.lines) {
        const nos = new Set<number>();
        for (const l of b.lines) { if (nos.has(l.line_no)) throw badRequest(`เลขบรรทัด ${l.line_no} ซ้ำ`); nos.add(l.line_no); }
        await tx.deleteFrom('gl_fs_line').where('company_id', '=', a.companyId).where('line_set_code', '=', b.line_set_code).execute();
        for (const l of b.lines) {
          await tx.insertInto('gl_fs_line').values({
            company_id: a.companyId, line_set_code: b.line_set_code, line_no: l.line_no, data_type: l.data_type, source: l.source ?? null,
            sign_filter: l.sign_filter || null, print_condition: l.print_condition || null, accumulate: JSON.stringify(l.accumulate ?? {}),
            description_th: l.description_th ?? null, description_en: l.description_en ?? null, created_by: a.userId,
          }).execute();
        }
      }
      await logActivity(tx, a, { module: 'GL', action: id ? 'EDIT' : 'ADD', docNo: b.code, table: 'gl_fs_report', rowId: rid });
      return { id: rid };
    });
  }

  /** คัดลอกแบบงบ (บทที่ 24 S-FS-02) */
  app.post('/api/v1/fs/layouts/:id/copy', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(z.object({ code: z.string().trim().min(1).max(10), name: z.string().trim().min(1).max(120), copy_lines: z.boolean().default(true) }), req.body);
    const src = await db.selectFrom('gl_fs_report').selectAll().where('id', '=', id).where('company_id', '=', a.companyId).executeTakeFirst();
    if (!src) throw notFound('แบบงบการเงิน');
    return db.transaction().execute(async (tx) => {
      const ls = b.copy_lines ? b.code : (src.line_set_code ?? src.code);
      const r = await tx.insertInto('gl_fs_report').values({ company_id: a.companyId, code: b.code, name: b.name, header_lines: JSON.stringify(src.header_lines), columns: JSON.stringify(src.columns), line_set_code: ls, number_format: src.number_format, created_by: a.userId }).returning('id').executeTakeFirstOrThrow();
      if (b.copy_lines) {
        await sql`INSERT INTO gl_fs_line (company_id, line_set_code, line_no, data_type, source, sign_filter, description_th, description_en, print_condition, accumulate, department_id, created_by)
          SELECT company_id, ${ls}, line_no, data_type, source, sign_filter, description_th, description_en, print_condition, accumulate, department_id, ${a.userId}
            FROM gl_fs_line WHERE company_id = ${a.companyId} AND line_set_code = ${src.line_set_code ?? src.code} AND deleted_at IS NULL`.execute(tx);
      }
      return r;
    });
  });

  /** พิมพ์งบการเงิน (บทที่ 24 S-FS-04): แบบที่ผู้ใช้สร้าง (layout_id) หรือ งบตามผังบัญชี (kind=BS|PL) */
  app.get('/api/v1/fs/run', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ layout_id: uuid.optional(), kind: z.enum(['BS', 'PL']).optional(), end: isoDate, branch_id: uuid.optional(), department_id: uuid.optional(), lang: z.enum(['th', 'en']).default('th') }), req.query);
    const company = await db.selectFrom('sys_company').select(['name_th', 'name_en', 'year_system']).where('id', '=', a.companyId).executeTakeFirstOrThrow();
    const chart = await loadChart(db, a.companyId);
    const ctx = await statementContext(db, a.companyId, chart, q.end, { branchId: q.branch_id, departmentId: q.department_id });
    const ys = (company.year_system as 'B' | 'C') ?? 'B';
    const endText = formatDate(q.end, ys);
    if (q.layout_id) {
      const rep = await db.selectFrom('gl_fs_report').selectAll().where('id', '=', q.layout_id).where('company_id', '=', a.companyId).executeTakeFirst();
      if (!rep) throw notFound('แบบงบการเงิน');
      const lines = await db.selectFrom('gl_fs_line').selectAll().where('company_id', '=', a.companyId).where('line_set_code', '=', rep.line_set_code ?? rep.code).where('deleted_at', 'is', null).execute();
      const cols = ((rep.columns as unknown as Array<FsColumn & { department?: string | null }>) ?? []).map((c) => ({ ...c, department_code: c.department ?? null }));
      const res = runFsLayout(lines.map((l) => ({ ...l, accumulate: (l.accumulate as FsLine['accumulate']) ?? {} })), cols, ctx.provider);
      const heads = ((rep.header_lines as unknown as string[]) ?? []).map((h) => expandHeader(h ?? '', { companyName: q.lang === 'en' ? company.name_en || company.name_th : company.name_th, endDateText: endText }));
      const coverage = coverageOf(chart, ctx, lines, rep.line_set_code ?? rep.code);
      return { kind: 'layout', title: rep.name, headers: heads, columns: cols.map((c) => ({ expr: c.expr, head1: c.head1 || defaultHead(c.expr), head2: c.head2 ?? '', formula: isFormulaColumn(c.expr) })), rows: res.rows, missing_accounts: res.missingAccounts, coverage, end: q.end, fiscal_year: ctx.fy };
    }
    const kind = q.kind ?? 'BS';
    return { kind: 'chart', title: kind === 'BS' ? 'งบแสดงฐานะการเงิน (ตามผังบัญชี)' : 'งบกำไรขาดทุน (ตามผังบัญชี)', headers: [company.name_th, kind === 'BS' ? 'งบแสดงฐานะการเงิน' : 'งบกำไรขาดทุน', `${kind === 'BS' ? 'ณ วันที่' : 'สำหรับงวดสิ้นสุดวันที่'} ${endText}`],
      columns: [{ expr: 'BAL', head1: 'ปีปัจจุบัน', head2: '', formula: false }, { expr: 'BAL LY', head1: 'ปีที่แล้ว', head2: '', formula: false }, { expr: '(C1-C2)*100/C2', head1: '% เปลี่ยนแปลง', head2: '', formula: true }],
      rows: chartStatement(chart, ctx, kind), missing_accounts: [], coverage: null, end: q.end, fiscal_year: ctx.fy };
  });
}

const defaultHead = (e: string) => ({ BAL: 'ยอดสะสม', PTD: 'ประจำงวด', 'BAL LY': 'ปีที่แล้ว', 'PTD LY': 'งวดเดียวกันปีที่แล้ว', BUD: 'งบประมาณสะสม', 'PTD BUD': 'งบประมาณงวดนี้' } as Record<string, string>)[e.trim().toUpperCase()] ?? e;

interface StatementCtx {
  fy: { code: string; start_date: string; end_date: string } | null;
  provider: { value: (kind: string, accountNo: string, dt: 'A/C' | 'BEG' | 'INV') => Decimal | null; accountExists: (no: string) => boolean };
  bal: (accountNo: string, which: 'BAL' | 'BAL LY') => Decimal | null;
}

/** เตรียมยอดของทุกบัญชีที่งบต้องใช้: สิ้นงวด, ประจำงวด, ปีที่แล้ว, ต้นปี/ต้นงวด */
async function statementContext(db: Db, companyId: string, chart: Chart, end: string, f: { branchId?: string; departmentId?: string }): Promise<StatementCtx> {
  const fy = await fiscalYearOf(db, companyId, end);
  if (!fy) throw badRequest('วันที่สิ้นงวดไม่อยู่ในรอบบัญชี');
  const p = await db.selectFrom('gl_period').select(['start_date']).where('company_id', '=', companyId).where('deleted_at', 'is', null).where('start_date', '<=', end).where('end_date', '>=', end).orderBy('period_no').executeTakeFirst();
  const pStart = p?.start_date ?? end;
  const endLY = addDays(addMonths(addDays(end, 1), -12), -1);
  const fyLY = await fiscalYearOf(db, companyId, endLY);
  const pStartLY = addMonths(pStart, -12);
  const ytd = rollUp(chart, await leafTotals(db, companyId, chart, fy.start_date, end, f));
  const ptd = rollUp(chart, await leafTotals(db, companyId, chart, pStart, end, f));
  const hasLY = !!fyLY;
  const ytdLY = hasLY ? rollUp(chart, await leafTotals(db, companyId, chart, fyLY!.start_date, endLY, f)) : null;
  const ptdLY = hasLY ? rollUp(chart, await leafTotals(db, companyId, chart, pStartLY, endLY, f)) : null;
  // งบประมาณ (S-GL-17): BUD = ต้นปีถึงสิ้นงวด, PTD BUD = เฉพาะงวด
  const budYtd = await budgetTotals(db, companyId, chart, fy.start_date, end, f.departmentId);
  const budPtd = await budgetTotals(db, companyId, chart, pStart, end, f.departmentId);
  const nat = (no: string, m: Map<string, Totals> | null, part: 'closing' | 'move' | 'opening') => {
    if (!m) return null;
    const acc = chart.byNo.get(no);
    if (!acc) return ZERO;
    const t = m.get(acc.id);
    if (!t) return ZERO;
    const v = part === 'closing' ? closingOf(t) : part === 'move' ? t.debit.minus(t.credit) : t.opening;
    return chart.natural(acc.id, v);
  };
  const provider = {
    accountExists: (no: string) => chart.byNo.has(no),
    value(kind: string, no: string, dt: 'A/C' | 'BEG' | 'INV') {
      const ly = kind.includes('LY');
      const isPtd = kind.startsWith('PTD');
      if (kind.includes('BUD')) {
        if (dt !== 'A/C') return null;
        const acc = chart.byNo.get(no);
        return acc ? (isPtd ? budPtd : budYtd).get(acc.id) ?? ZERO : ZERO;
      }
      if (dt === 'BEG') return nat(no, ly ? (isPtd ? ptdLY : ytdLY) : isPtd ? ptd : ytd, 'opening');
      // INV: สินค้าคงเหลือปลายงวด — Periodic ใช้ยอดบัญชีสินค้าคงเหลือ ณ สิ้นงวด (เฟส 4: ใช้ยอดตรวจนับ/บัญชีสินค้าคงเหลือ)
      if (dt === 'INV') return nat(no, ly ? ytdLY : ytd, 'closing');
      if (isPtd) return nat(no, ly ? ptdLY : ptd, 'move');
      const acc = chart.byNo.get(no);
      // บัญชีงบดุล ใช้ยอดคงเหลือ; บัญชีกำไรขาดทุน ใช้ยอดสะสมตั้งแต่ต้นปี (closing ของช่วงต้นปี–สิ้นงวด เพราะยกมาเป็นศูนย์)
      return nat(no, ly ? ytdLY : ytd, acc && isPL(acc.account_group) ? 'closing' : 'closing');
    },
  };
  return { fy: { code: fy.code, start_date: fy.start_date, end_date: fy.end_date }, provider, bal: (no, which) => provider.value(which, no, 'A/C') };
}

/** บัญชีย่อยที่มียอดแต่แบบงบไม่ได้ดึงไปใช้เลย — สาเหตุที่งบไม่ดุล (พบในข้อมูล Express ตัวอย่าง 18 บัญชี) */
function coverageOf(chart: Chart, ctx: StatementCtx, lines: Array<{ data_type: string; source: string | null }>, lineSet: string) {
  const used = new Set<string>();
  for (const l of lines) {
    if (!['A/C', 'BEG', 'INV'].includes((l.data_type || '').trim())) continue;
    const acc = l.source ? chart.byNo.get(l.source.trim()) : undefined;
    if (acc) for (const id of chart.family(acc.id)) used.add(id);
  }
  const ls = lineSet.toUpperCase();
  const groups = ls.startsWith('BAL') ? '12345' : ls.startsWith('INC') ? '45' : ls.startsWith('COGS') ? '5' : '';
  if (!groups) return { checked: false, missing: [] as Array<{ account_no: string; name_th: string; amount: string }> };
  const missing: Array<{ account_no: string; name_th: string; amount: string }> = [];
  for (const acc of chart.byId.values()) {
    if (acc.is_control && chart.children.get(acc.id)?.length) continue;
    if (!groups.includes(acc.account_group) || used.has(acc.id)) continue;
    if (ls.startsWith('COGS') && !acc.account_no.startsWith('51')) continue;
    const v = ctx.bal(acc.account_no, 'BAL') ?? ZERO;
    if (v.abs().gt('0.004')) missing.push({ account_no: acc.account_no, name_th: acc.name_th, amount: v.toFixed(2) });
  }
  missing.sort((x, y) => d(y.amount).abs().comparedTo(d(x.amount).abs()));
  return { checked: true, missing };
}

/** งบตามผังบัญชี — ดุลกับงบทดลองเสมอ */
function chartStatement(chart: Chart, ctx: StatementCtx, kind: 'BS' | 'PL') {
  type Row = { kind: 'text'; text: string; textEn: string; center: boolean; line_no: number } | { kind: 'rule'; double: boolean; line_no: number } | { kind: 'value'; text: string; textEn: string; values: (string | null)[]; account?: string; isTotal: boolean; line_no: number };
  const rows: Row[] = [];
  let n = 0;
  const v = (no: string) => [ctx.bal(no, 'BAL'), ctx.bal(no, 'BAL LY')];
  const pct = (x: (Decimal | null)[]) => (x[0] && x[1] && !x[1].isZero() ? x[0].minus(x[1]).times(100).div(x[1].abs()) : null);
  const fmt = (x: (Decimal | null)[]) => [...x, pct(x)].map((y) => (y === null ? null : y.toFixed(2)));
  const nz = (no: string) => v(no).some((x) => x && x.abs().gt('0.004'));
  const sumOf = (ids: string[]) => [0, 1].map((i) => ids.reduce<Decimal | null>((s, id) => { const x = v(chart.byId.get(id)!.account_no)[i]; return s === null || x === null || x === undefined ? null : s.plus(x); }, ZERO));
  const roots = (g: string) => chart.roots().filter((r) => r.account_group === g);
  const section = (g: string, title: string, titleEn: string) => {
    rows.push({ kind: 'text', text: title, textEn: titleEn, center: true, line_no: ++n });
    const top = roots(g);
    for (const r of top) for (const c2 of chart.children.get(r.id) ?? [r.id]) {
      const a2 = chart.byId.get(c2)!;
      if (!nz(a2.account_no)) continue;
      const kids = (chart.children.get(c2) ?? []).filter((k) => nz(chart.byId.get(k)!.account_no));
      if (kids.length > 1) {
        rows.push({ kind: 'text', text: a2.name_th, textEn: a2.name_en ?? a2.name_th, center: false, line_no: ++n });
        for (const k of kids) { const a3 = chart.byId.get(k)!; rows.push({ kind: 'value', text: '   ' + a3.name_th, textEn: '   ' + (a3.name_en ?? a3.name_th), values: fmt(v(a3.account_no)), account: a3.account_no, isTotal: false, line_no: ++n }); }
        rows.push({ kind: 'rule', double: false, line_no: ++n });
        rows.push({ kind: 'value', text: '      รวม' + a2.name_th, textEn: '      Total ' + (a2.name_en ?? a2.name_th), values: fmt(v(a2.account_no)), isTotal: true, line_no: ++n });
      } else rows.push({ kind: 'value', text: a2.name_th, textEn: a2.name_en ?? a2.name_th, values: fmt(v(a2.account_no)), account: a2.account_no, isTotal: false, line_no: ++n });
    }
    return sumOf(top.map((t) => t.id));
  };
  if (kind === 'BS') {
    const assets = section('1', 'สินทรัพย์', 'Assets');
    rows.push({ kind: 'rule', double: false, line_no: ++n });
    rows.push({ kind: 'value', text: 'รวมสินทรัพย์', textEn: 'Total Assets', values: fmt(assets), isTotal: true, line_no: ++n });
    rows.push({ kind: 'rule', double: true, line_no: ++n });
    const liab = section('2', 'หนี้สิน', 'Liabilities');
    rows.push({ kind: 'rule', double: false, line_no: ++n });
    rows.push({ kind: 'value', text: '      รวมหนี้สิน', textEn: '      Total Liabilities', values: fmt(liab), isTotal: true, line_no: ++n });
    const eq = section('3', 'ส่วนของผู้ถือหุ้น', "Shareholders' Equity");
    const inc = sumOf(roots('4').map((r) => r.id)), exp = sumOf([...roots('5'), ...chart.roots().filter((r) => r.account_group > '5')].map((r) => r.id));
    const profit = [0, 1].map((i) => (inc[i] == null || exp[i] == null ? null : inc[i]!.minus(exp[i]!)));
    rows.push({ kind: 'value', text: '   กำไร (ขาดทุน) ปีปัจจุบัน', textEn: '   Profit (loss) for the year', values: fmt(profit), isTotal: false, line_no: ++n });
    const eqT = [0, 1].map((i) => (eq[i] == null || profit[i] == null ? null : eq[i]!.plus(profit[i]!)));
    rows.push({ kind: 'rule', double: false, line_no: ++n });
    rows.push({ kind: 'value', text: '      รวมส่วนของผู้ถือหุ้น', textEn: "      Total Shareholders' Equity", values: fmt(eqT), isTotal: true, line_no: ++n });
    rows.push({ kind: 'rule', double: false, line_no: ++n });
    rows.push({ kind: 'value', text: 'รวมหนี้สินและส่วนของผู้ถือหุ้น', textEn: "Total Liabilities and Shareholders' Equity", values: fmt([0, 1].map((i) => (liab[i] == null || eqT[i] == null ? null : liab[i]!.plus(eqT[i]!)))), isTotal: true, line_no: ++n });
    rows.push({ kind: 'rule', double: true, line_no: ++n });
  } else {
    const inc = section('4', 'รายได้', 'Revenue');
    rows.push({ kind: 'rule', double: false, line_no: ++n });
    rows.push({ kind: 'value', text: '      รวมรายได้', textEn: '      Total Revenue', values: fmt(inc), isTotal: true, line_no: ++n });
    const exp = section('5', 'ค่าใช้จ่าย', 'Expenses');
    rows.push({ kind: 'rule', double: false, line_no: ++n });
    rows.push({ kind: 'value', text: '      รวมค่าใช้จ่าย', textEn: '      Total Expenses', values: fmt(exp), isTotal: true, line_no: ++n });
    rows.push({ kind: 'rule', double: false, line_no: ++n });
    rows.push({ kind: 'value', text: 'กำไร (ขาดทุน) สุทธิ', textEn: 'Net Profit (Loss)', values: fmt([0, 1].map((i) => (inc[i] == null || exp[i] == null ? null : inc[i]!.minus(exp[i]!)))), isTotal: true, line_no: ++n });
    rows.push({ kind: 'rule', double: true, line_no: ++n });
  }
  return rows;
}
