import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { addDays, addMonths, d, ZERO, type Decimal } from '@buddy/core';
import type { Db } from '../../db.js';
import { badRequest, parse, requireCompany } from '../../http.js';

/**
 * แดชบอร์ดผู้บริหาร (RP.DASH) — สรุปสดจากเอกสารและใบสำคัญ ไม่มียอดสะสมแยก
 * ยอดขาย = บรรทัดขายเชื่อ/ขายสด/เพิ่มหนี้ (+) ลดหนี้ (−) ก่อน VAT หลังหักส่วนลด (net_amount ของบรรทัด = ยอดที่ลงบัญชีขาย)
 * ลูกหนี้/เจ้าหนี้คงค้าง ณ วันสิ้นช่วง (นับการตัดหนี้ถึงวันนั้น) · รายได้/ค่าใช้จ่าย/กำไร จากบัญชีหมวด 4 / 5 (รวมยอดปีที่แล้วที่ป้อนเอง)
 * เงินสดรับ/จ่าย = ผลต่างสุทธิของบัญชีเงินสด/เงินสดย่อย/เงินฝากต่อใบสำคัญ (โอนระหว่างบัญชีเงินหักล้างกันเอง)
 */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ต้องเป็น ปปปป-ดด-วว');
const query = z.object({
  from: isoDate, to: isoDate, branch_id: z.string().uuid().optional(),
  grain: z.enum(['day', 'month', 'quarter']).default('month'),
  category: z.string().max(10).optional(), customer_type: z.string().max(4).optional(),
});
type Q = z.infer<typeof query>;
const AGING = ['ยังไม่ถึงกำหนด', '1–30 วัน', '31–60 วัน', '61–90 วัน', 'เกิน 90 วัน'];
const money = (x: Decimal | null) => (x === null ? null : x.toFixed(2));
const daysIn = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
const shiftYear = (iso: string, n: number) => addMonths(iso, 12 * n);

export function dashboardRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/v1/dashboard', async (req) => {
    const a = requireCompany(req);
    const q = parse(query, req.query);
    if (q.from > q.to) throw badRequest('วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด');
    if (daysIn(q.from, q.to) > 1100) throw badRequest('ช่วงวันที่ยาวเกิน 3 ปี — เลือกช่วงให้สั้นลง');
    const c = a.companyId;
    const branch = q.branch_id ?? null;
    const brH = sql`AND (${branch}::uuid IS NULL OR h.branch_id = ${branch}::uuid)`;
    const brJ = sql`AND (${branch}::uuid IS NULL OR j.branch_id = ${branch}::uuid)`;
    const catW = q.category ? sql`AND i.category_code = ${q.category}` : sql``;
    const ctypeW = q.customer_type ? sql`AND cu.customer_type = ${q.customer_type}` : sql``;
    // ช่วงเทียบ: ช่วงก่อนหน้ายาวเท่ากัน · ช่วงเดียวกันปีที่แล้ว
    const len = daysIn(q.from, q.to);
    const prev = { from: addDays(q.from, -len), to: addDays(q.from, -1) };
    const ly = { from: shiftYear(q.from, -1), to: shiftYear(q.to, -1) };

    const salesFrom = sql`FROM doc_line l JOIN doc_header h ON h.id = l.header_id LEFT JOIN md_item i ON i.id = l.item_id LEFT JOIN md_customer cu ON cu.id = h.customer_id
      WHERE h.company_id = ${c} AND h.doc_class IN ('IV', 'HS', 'DR', 'CN') AND h.doc_status <> 'C' AND h.deleted_at IS NULL AND l.deleted_at IS NULL AND NOT h.is_opening
        AND l.line_kind IS DISTINCT FROM 'K' ${brH} ${catW} ${ctypeW}`;
    const signed = sql`CASE WHEN h.doc_class = 'CN' THEN -l.net_amount ELSE l.net_amount END`;
    const sales = async (r: { from: string; to: string }) =>
      d((await sql<{ v: string | null; n: string }>`SELECT sum(${signed}) AS v, count(DISTINCT h.id) AS n ${salesFrom} AND h.doc_date BETWEEN ${r.from} AND ${r.to}`.execute(db)).rows[0]?.v ?? 0);

    // ยอดคงค้าง ณ วันที่ แยกตามอายุหนี้
    const owed = async (ar: boolean, asOf: string) => {
      const minus = ar ? 'CN' : 'DN';
      const rows = (await sql<{ b: number; v: string }>`SELECT b, sum(o) AS v FROM (
          SELECT (CASE WHEN h.doc_class = ${minus} THEN -1 ELSE 1 END) * (h.net_amount - coalesce((SELECT sum(x.amount) FROM doc_settlement x LEFT JOIN doc_header pay ON pay.id = x.payment_header_id
                    LEFT JOIN gl_journal j ON j.id = x.payment_journal_id WHERE x.invoice_header_id = h.id AND x.deleted_at IS NULL AND coalesce(pay.doc_status, 'N') <> 'C'
                    AND coalesce(j.doc_status, 'N') <> 'C' AND coalesce(pay.doc_date, j.voucher_date) <= ${asOf}), 0)) AS o,
                 CASE WHEN ${asOf}::date - coalesce(h.due_date, h.doc_date) <= 0 THEN 0 WHEN ${asOf}::date - coalesce(h.due_date, h.doc_date) <= 30 THEN 1
                      WHEN ${asOf}::date - coalesce(h.due_date, h.doc_date) <= 60 THEN 2 WHEN ${asOf}::date - coalesce(h.due_date, h.doc_date) <= 90 THEN 3 ELSE 4 END AS b
            FROM doc_header h ${ar ? sql`LEFT JOIN md_customer cu ON cu.id = h.customer_id` : sql``}
           WHERE h.company_id = ${c} AND h.module = ${ar ? 'AR' : 'AP'} AND h.doc_class IN (${sql.join(ar ? ['IV', 'DR', 'CN'] : ['RR', 'CP', 'DN'])})
             AND h.doc_status <> 'C' AND h.deleted_at IS NULL AND h.doc_date <= ${asOf} ${brH} ${ar ? ctypeW : sql``}) t
        WHERE o <> 0 GROUP BY b`.execute(db)).rows;
      const buckets = AGING.map((_, i) => d(rows.find((r) => Number(r.b) === i)?.v ?? 0));
      return { total: buckets.reduce((s, x) => s.plus(x), ZERO), buckets };
    };

    // บัญชีเงิน: เงินสด เงินสดย่อย และบัญชีเงินฝากทุกบัญชี
    const cashIds = (await sql<{ id: string }>`SELECT account_id AS id FROM gl_default_account WHERE company_id = ${c} AND deleted_at IS NULL AND role IN ('CASH', 'PETTY_CASH')
        UNION SELECT gl_account_id FROM md_bank_account WHERE company_id = ${c} AND deleted_at IS NULL AND gl_account_id IS NOT NULL`.execute(db)).rows.map((r) => r.id);
    const cashFlow = async (r: { from: string; to: string }) => {
      if (!cashIds.length) return { in: ZERO, out: ZERO, deposit_ar: ZERO, deposit_ap: ZERO, n: 0 };
      const x = (await sql<{ i: string | null; o: string | null; n: string }>`SELECT sum(GREATEST(net, 0)) AS i, sum(GREATEST(-net, 0)) AS o, count(*) AS n FROM (
          SELECT j.id, sum(l.debit - l.credit) AS net FROM gl_journal_line l JOIN gl_journal j ON j.id = l.journal_id
           WHERE j.company_id = ${c} AND j.doc_status = 'N' AND j.deleted_at IS NULL AND l.deleted_at IS NULL AND j.voucher_date BETWEEN ${r.from} AND ${r.to}
             AND l.account_id IN (${sql.join(cashIds)}) ${brJ} GROUP BY j.id) t`.execute(db)).rows[0]!;
      // หักมัดจำที่ทำแล้ว: ขาย Dr เงินมัดจำรับ · ซื้อ Cr เงินมัดจำจ่าย
      const dep = (await sql<{ ar: string | null; ap: string | null }>`SELECT sum(CASE WHEN l.posting_role = 'DEPOSIT_RECEIVED' THEN l.debit END) AS ar, sum(CASE WHEN l.posting_role = 'DEPOSIT_PAID' THEN l.credit END) AS ap
          FROM gl_journal_line l JOIN gl_journal j ON j.id = l.journal_id
         WHERE j.company_id = ${c} AND j.doc_status = 'N' AND j.deleted_at IS NULL AND l.deleted_at IS NULL AND j.voucher_date BETWEEN ${r.from} AND ${r.to}
           AND j.source_module IS DISTINCT FROM 'GL' ${brJ}`.execute(db)).rows[0]!;
      return { in: d(x.i ?? 0), out: d(x.o ?? 0), deposit_ar: d(dep.ar ?? 0), deposit_ap: d(dep.ap ?? 0), n: Number(x.n) };
    };

    // รายได้/ค่าใช้จ่ายรายเดือนจากบัญชี (ใบสำคัญ + ยอดปีที่แล้วที่ป้อนเอง)
    const plMonths = async (r: { from: string; to: string }) => {
      const rows = (await sql<{ m: string; rev: string | null; exp: string | null }>`SELECT to_char(m, 'YYYY-MM') AS m, sum(rev) AS rev, sum(exp) AS exp FROM (
          SELECT date_trunc('month', j.voucher_date) AS m, sum(CASE WHEN a.account_group = '4' THEN l.credit - l.debit ELSE 0 END) AS rev,
                 sum(CASE WHEN a.account_group >= '5' THEN l.debit - l.credit ELSE 0 END) AS exp
            FROM gl_journal_line l JOIN gl_journal j ON j.id = l.journal_id JOIN gl_account a ON a.id = l.account_id
           WHERE j.company_id = ${c} AND j.doc_status = 'N' AND j.deleted_at IS NULL AND l.deleted_at IS NULL AND a.account_group >= '4'
             AND j.voucher_date BETWEEN ${r.from} AND ${r.to} ${brJ} GROUP BY 1
          UNION ALL
          SELECT date_trunc('month', pp.start_date), sum(CASE WHEN a.account_group = '4' THEN pb.credit - pb.debit ELSE 0 END), sum(CASE WHEN a.account_group >= '5' THEN pb.debit - pb.credit ELSE 0 END)
            FROM gl_prior_year_balance pb JOIN gl_period pp ON pp.fiscal_year_id = pb.fiscal_year_id AND pp.period_no = pb.period_no AND pp.deleted_at IS NULL
            JOIN gl_account a ON a.id = pb.account_id
           WHERE pb.company_id = ${c} AND pb.deleted_at IS NULL AND pb.period_no > 0 AND a.account_group >= '4' AND ${branch}::uuid IS NULL
             AND pp.start_date >= date_trunc('month', ${r.from}::date) AND pp.end_date <= ${r.to} GROUP BY 1) t GROUP BY 1 ORDER BY 1`.execute(db)).rows;
      return rows.map((x) => ({ month: x.m, revenue: d(x.rev ?? 0), expense: d(x.exp ?? 0) }));
    };
    const plTotal = (rows: Awaited<ReturnType<typeof plMonths>>) => rows.reduce((s, x) => ({ revenue: s.revenue.plus(x.revenue), expense: s.expense.plus(x.expense), n: s.n + 1 }), { revenue: ZERO, expense: ZERO, n: 0 });

    const kpis = async (r: { from: string; to: string }) => {
      const [s, ar, ap, cf, pl] = await Promise.all([sales(r), owed(true, r.to), owed(false, r.to), cashFlow(r), plMonths(r)]);
      const t = plTotal(pl);
      const profit = t.revenue.minus(t.expense);
      return {
        sales: money(s), ar: money(ar.total), ap: money(ap.total),
        cash_in: money(cf.in), cash_out: money(cf.out), cash_net: money(cf.in.minus(cf.out)), cash_vouchers: cf.n,
        deposit_ar: money(cf.deposit_ar), deposit_ap: money(cf.deposit_ap),
        revenue: t.n ? money(t.revenue) : null, expense: t.n ? money(t.expense) : null, profit: t.n ? money(profit) : null,
        margin: t.n && !t.revenue.isZero() ? profit.times(100).div(t.revenue).toFixed(2) : null,
      };
    };

    // ยอดขายตามช่วงเวลา (วัน/เดือน/ไตรมาส) ของช่วงนี้ และช่วงเดียวกันปีที่แล้ว (เลื่อนวันที่ +1 ปีให้ตรงช่อง)
    const unit = q.grain === 'day' ? 'day' : q.grain === 'quarter' ? 'quarter' : 'month';
    if (unit === 'day' && len > 92) throw badRequest('ดูรายวันได้ไม่เกิน 92 วัน — เลือกรายเดือนหรือช่วงที่สั้นลง');
    const trendOf = async (r: { from: string; to: string }, shift: number) => (await sql<{ k: string; v: string | null; n: string }>`SELECT to_char(date_trunc(${unit}, (h.doc_date + make_interval(years => ${shift}))::date), 'YYYY-MM-DD') AS k,
        sum(${signed}) AS v, count(DISTINCT h.id) AS n ${salesFrom} AND h.doc_date BETWEEN ${r.from} AND ${r.to} GROUP BY 1`.execute(db)).rows;
    const [kCur, kPrev, kLy, tCur, tLy, plCur, arNow, apNow] = await Promise.all([kpis(q), kpis(prev), kpis(ly), trendOf(q, 0), trendOf(ly, 1), plMonths(q), owed(true, q.to), owed(false, q.to)]);
    const keys: string[] = [];
    for (let k = q.from; k <= q.to;) {
      const start = unit === 'day' ? k : unit === 'month' ? `${k.slice(0, 7)}-01` : `${k.slice(0, 4)}-${String(Math.floor((Number(k.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;
      if (keys.at(-1) !== start) keys.push(start);
      k = unit === 'day' ? addDays(k, 1) : addMonths(start, unit === 'month' ? 1 : 3);
    }
    const trend = keys.map((k) => {
      const c0 = tCur.find((x) => x.k === k), l0 = tLy.find((x) => x.k === k);
      const end = unit === 'day' ? k : addDays(addMonths(k, unit === 'month' ? 1 : 3), -1);
      return { key: k, from: k < q.from ? q.from : k, to: end > q.to ? q.to : end, sales: money(d(c0?.v ?? 0)), docs: Number(c0?.n ?? 0), sales_ly: l0 ? money(d(l0.v ?? 0)) : null };
    });

    // สินค้าขายดี 10 อันดับ และยอดตามหมวดสินค้า (ไม่รวมบรรทัดที่ไม่มีรหัสสินค้า)
    const top = (await sql<{ id: string; code: string; name: string; qty: string; v: string }>`SELECT i.id, i.code, i.name_th AS name, sum(CASE WHEN h.doc_class = 'CN' THEN -l.base_qty ELSE l.base_qty END) AS qty, sum(${signed}) AS v
        ${salesFrom} AND l.item_id IS NOT NULL AND h.doc_date BETWEEN ${q.from} AND ${q.to} GROUP BY i.id, i.code, i.name_th HAVING sum(${signed}) <> 0 ORDER BY 5 DESC LIMIT 10`.execute(db)).rows;
    const cats = (await sql<{ code: string | null; name: string | null; v: string }>`SELECT i.category_code AS code, (SELECT k.name_th FROM md_lookup k WHERE k.company_id = ${c} AND k.type_code = '22' AND k.code = i.category_code AND k.deleted_at IS NULL LIMIT 1) AS name, sum(${signed}) AS v
        ${salesFrom} AND l.item_id IS NOT NULL AND h.doc_date BETWEEN ${q.from} AND ${q.to} GROUP BY i.category_code HAVING sum(${signed}) <> 0 ORDER BY 3 DESC LIMIT 12`.execute(db)).rows;

    return {
      range: { from: q.from, to: q.to }, prev, ly, grain: unit,
      kpis: { current: kCur, prev: kPrev, ly: kLy },
      trend,
      top_items: top.map((x) => ({ id: x.id, code: x.code, name: x.name, qty: d(x.qty).toString(), amount: money(d(x.v)) })),
      categories: cats.map((x) => ({ code: x.code, name: x.name ?? (x.code ? x.code : 'ไม่ระบุหมวด'), amount: money(d(x.v)) })),
      aging: { buckets: AGING, as_of: q.to, ar: arNow.buckets.map(money), ap: apNow.buckets.map(money) },
      pl: plCur.map((x) => ({ month: x.month, revenue: money(x.revenue), expense: money(x.expense), profit: money(x.revenue.minus(x.expense)) })),
    };
  });
}
