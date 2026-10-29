import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { addDays, d } from '@buddy/core';
import type { Db } from '../../db.js';
import { badRequest, notFound, parse, requireCompany, type AuthContext } from '../../http.js';
import { logActivity } from '../../audit.js';
import { createFiscalYear, companySettings } from '../../company-template.js';
import { closingOf, leafTotals, loadChart, retainedEarningsLeaf } from './balances.js';
import { createJournal } from './journals.js';

type Ctx = AuthContext & { companyId: string };
const uuid = z.string().uuid();
type Fy = { id: string; code: string; start: string; end: string; status: string; closed_at: string | null };

/**
 * ประมวลผลสิ้นปี (คู่มือบทที่ 22) — Buddy ไม่ลบรายการปีเก่า และยอดยกมา/กำไรสะสมคำนวณสดจากใบสำคัญอยู่แล้ว (balances.ts)
 * ดังนั้น "ปิดปี" = ตรวจความพร้อม → (Periodic) ลงใบสำคัญปิดสินค้าคงเหลือ → ล็อคทุกงวดของปี + ตั้งสถานะปิด + สร้างรอบบัญชีปีถัดไปถ้ายังไม่มี
 * เปิดปีกลับได้ (ปีล่าสุดที่ปิด) เพราะไม่มีข้อมูลใดถูกลบ
 */
async function years(db: Db, companyId: string) {
  return (await sql<Fy>`SELECT id, code, start_date::text AS start, end_date::text AS "end", status, closed_at FROM gl_fiscal_year WHERE company_id = ${companyId} AND deleted_at IS NULL ORDER BY start_date`.execute(db)).rows;
}
async function inventoryAccounts(db: Db, companyId: string) {
  return (await sql<{ id: string; account_no: string; name_th: string }>`SELECT DISTINCT g.id, g.account_no, g.name_th FROM gl_account g
      WHERE g.company_id = ${companyId} AND g.deleted_at IS NULL AND (g.id IN (SELECT inventory_account_id FROM md_item_account_group WHERE company_id = ${companyId} AND deleted_at IS NULL)
        OR g.id IN (SELECT account_id FROM gl_default_account WHERE company_id = ${companyId} AND role = 'INVENTORY' AND deleted_at IS NULL)) ORDER BY g.account_no`.execute(db)).rows;
}
const role = async (db: Db, companyId: string, r: string) => (await db.selectFrom('gl_default_account').select('account_id').where('company_id', '=', companyId).where('role', '=', r).where('deleted_at', 'is', null).executeTakeFirst())?.account_id ?? null;

/** ยอดสินค้าต้นปีจากแยกประเภท และปลายปีจากยอดที่ยืนยัน (บัญชีสินค้าคงเหลือ Periodic งวด 12) */
async function periodicFigures(db: Db, companyId: string, fy: Fy) {
  const chart = await loadChart(db, companyId);
  const accs = await inventoryAccounts(db, companyId);
  const tot = await leafTotals(db, companyId, chart, fy.start, fy.end);
  const closing = new Map((await sql<{ account_id: string; amount: string }>`SELECT account_id, sum(amount) AS amount FROM gl_inventory_balance
      WHERE company_id = ${companyId} AND fiscal_year_id = ${fy.id} AND period_no = 12 AND deleted_at IS NULL GROUP BY account_id`.execute(db)).rows.map((r) => [r.account_id, r.amount]));
  return accs.map((x) => ({ account_id: x.id, account_no: x.account_no, name: x.name_th, opening: (tot.get(x.id)?.opening ?? d(0)).toFixed(2),
    ledger_end: tot.get(x.id) ? closingOf(tot.get(x.id)!).toFixed(2) : '0.00', closing: closing.has(x.id) ? d(closing.get(x.id)!).toFixed(2) : null }));
}

async function status(db: Db, a: Ctx, fyId?: string) {
  const ys = await years(db, a.companyId);
  if (!ys.length) throw notFound('ปีบัญชี');
  const work = a.workDate ?? new Date().toISOString().slice(0, 10);
  const fy = fyId ? ys.find((y) => y.id === fyId) : ys.find((y) => y.status === 'O' && y.end < work) ?? ys.find((y) => y.start <= work && work <= y.end) ?? ys.at(-1);
  if (!fy) throw notFound('ปีบัญชี');
  const settings = await companySettings(db, a.companyId);
  const periodic = settings['ic.posting_method'] === 'PERIODIC';
  const tb = (await sql<{ dr: string; cr: string; bad: number }>`SELECT coalesce(sum(total_debit), 0) AS dr, coalesce(sum(total_credit), 0) AS cr, count(*) FILTER (WHERE total_debit <> total_credit)::int AS bad
      FROM gl_journal WHERE company_id = ${a.companyId} AND deleted_at IS NULL AND doc_status = 'N' AND voucher_date BETWEEN ${fy.start} AND ${fy.end}`.execute(db)).rows[0]!;
  // เอกสารที่ควรมีใบสำคัญแต่ไม่มี (ไม่นับ ใบเสนอ/สั่ง/วางบิล · โอนย้ายคลัง · ใบจ่ายเงินสดย่อยที่ลงตอนเบิกชดเชย · เอกสารสินค้าเมื่อเป็น Periodic)
  const unposted = (await sql<{ n: number }>`SELECT count(*)::int AS n FROM doc_header h WHERE h.company_id = ${a.companyId} AND h.deleted_at IS NULL AND h.doc_status <> 'C' AND NOT h.is_opening
      AND h.doc_class NOT IN ('QT', 'SO', 'PO', 'BS', 'BR', 'RL', 'DP') ${periodic ? sql`AND h.module <> 'IC'` : sql``} AND h.doc_date BETWEEN ${fy.start} AND ${fy.end}
      AND NOT EXISTS (SELECT 1 FROM gl_journal j WHERE j.source_header_id = h.id AND j.doc_status = 'N' AND j.deleted_at IS NULL)`.execute(db)).rows[0]!.n;
  const re = await retainedEarningsLeaf(db, a.companyId, await loadChart(db, a.companyId));
  const assets = (await sql<{ n: number }>`SELECT count(*)::int AS n FROM fa_asset WHERE company_id = ${a.companyId} AND deleted_at IS NULL AND is_depreciable AND method <> '0' AND start_date <= ${fy.end} AND (sold_date IS NULL OR sold_date >= ${fy.start})`.execute(db)).rows[0]!.n;
  const faMissing = assets ? (await sql<{ n: number }>`SELECT count(*)::int AS n FROM gl_period p WHERE p.company_id = ${a.companyId} AND p.deleted_at IS NULL AND p.period_no BETWEEN 1 AND 12 AND p.start_date >= ${fy.start} AND p.end_date <= ${fy.end}
      AND NOT EXISTS (SELECT 1 FROM gl_journal j WHERE j.period_id = p.id AND j.source_module = 'FA' AND j.doc_status = 'N' AND j.deleted_at IS NULL)`.execute(db)).rows[0]!.n : 0;
  const unlocked = (await sql<{ n: number }>`SELECT count(*)::int AS n FROM gl_period WHERE company_id = ${a.companyId} AND deleted_at IS NULL AND start_date >= ${fy.start} AND end_date <= ${fy.end} AND NOT is_locked`.execute(db)).rows[0]!.n;
  const earlierOpen = ys.filter((y) => y.end < fy.start && y.status === 'O').map((y) => y.code);
  const next = ys.find((y) => y.start > fy.end) ?? null;
  const inv = periodic ? await periodicFigures(db, a.companyId, fy) : [];
  const invJv = periodic ? (await sql<{ v: string }>`SELECT voucher_no AS v FROM gl_journal WHERE company_id = ${a.companyId} AND deleted_at IS NULL AND doc_status = 'N' AND voucher_date = ${fy.end} AND description = 'ปิดบัญชีสินค้าคงเหลือปลายปี ยกไปปีหน้า'`.execute(db)).rows.map((r) => r.v) : [];
  const checks = [
    { key: 'tb', label: 'ใบสำคัญทั้งปี เดบิตเท่ากับเครดิต', ok: d(tb.dr).eq(tb.cr) && tb.bad === 0, block: true, detail: `เดบิต ${d(tb.dr).toFixed(2)} · เครดิต ${d(tb.cr).toFixed(2)}${tb.bad ? ` · ใบที่ไม่ดุล ${tb.bad} ใบ (รายงาน 5.A.2)` : ''}` },
    { key: 're', label: 'กำหนดบัญชีกำไรสะสม (บัญชีเพื่อลงรายวัน)', ok: !!re, block: true, detail: re ? 'กำไร(ขาดทุน)ของปีปิดเข้าบัญชีกำไรสะสมอัตโนมัติ' : 'กำหนดที่ เริ่มระบบ › การเชื่อมต่อบัญชี บทบาท "บัญชีกำไรสะสม"' },
    { key: 'earlier', label: 'ปิดปีก่อนหน้าครบแล้ว', ok: !earlierOpen.length, block: true, detail: earlierOpen.length ? `ยังไม่ปิดปี ${earlierOpen.join(', ')} — ปิดตามลำดับปี` : '' },
    { key: 'docs', label: 'เอกสารลงบัญชีครบ', ok: unposted === 0, block: false, detail: unposted ? `เอกสาร ${unposted.toLocaleString()} ใบยังไม่ลงบัญชี (ตรวจที่รายงาน 1.H / 2.G)` : '' },
    ...(assets ? [{ key: 'fa', label: 'คิดค่าเสื่อม-ลงบัญชีครบ 12 งวด', ok: faMissing === 0, block: false, detail: faMissing ? `${faMissing} งวดยังไม่มีใบสำคัญค่าเสื่อม (บัญชี › คิดค่าเสื่อม-ลงบัญชี)` : '' }] : []),
    ...(periodic ? [{ key: 'inv', label: 'ลงใบสำคัญปิดบัญชีสินค้าคงเหลือ (Periodic)', ok: invJv.length > 0, block: false, detail: invJv.length ? invJv.join(', ') : 'ยืนยันยอดปลายปีที่ บัญชี › บัญชีสินค้าคงเหลือ แล้วกด "ลงใบสำคัญปิดสินค้า"' }] : []),
  ];
  return { years: ys, fiscal_year: fy, periodic, inventory: inv, checks, unlocked_periods: unlocked, next_year: next ? { id: next.id, code: next.code, start: next.start } : { id: null, code: String(Number(fy.code) + 1), start: addDays(fy.end, 1) } };
}

export function yearEndRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/v1/gl/year-end', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ fiscal_year_id: uuid.optional() }), req.query);
    return status(db, a, q.fiscal_year_id);
  });

  /** ใบสำคัญปิดบัญชีสินค้าคงเหลือ (S-YE-01, Periodic): ปิดสินค้าต้นปีเข้าต้นทุนขาย + ยกสินค้าปลายปีตามที่ยืนยัน */
  app.post('/api/v1/gl/year-end/inventory-jv', async (req) => {
    const a = requireCompany(req);
    const b = parse(z.object({ fiscal_year_id: uuid }), req.body);
    const st = await status(db, a, b.fiscal_year_id);
    if (!st.periodic) throw badRequest('บริษัทนี้บันทึกบัญชีสินค้าแบบ Perpetual — ไม่ต้องลงใบสำคัญปิดสินค้าคงเหลือ');
    if (st.fiscal_year.status === 'C') throw badRequest('ปีนี้ปิดแล้ว — เปิดปีก่อน');
    if (st.checks.find((c) => c.key === 'inv')?.ok) throw badRequest('ลงใบสำคัญปิดสินค้าคงเหลือของปีนี้แล้ว — ยกเลิกใบเดิมก่อนถ้าต้องการลงใหม่');
    const missing = st.inventory.filter((x) => x.closing === null);
    if (missing.length) throw badRequest(`ยังไม่ได้ยืนยันยอดสินค้าคงเหลือปลายปีของบัญชี ${missing.map((x) => x.account_no).join(', ')} — ป้อน/คำนวณที่ บัญชี › บัญชีสินค้าคงเหลือ งวด 12`);
    const cogs = await role(db, a.companyId, 'COGS');
    if (!cogs) throw badRequest('ยังไม่ได้กำหนดบัญชีต้นทุนขาย (บทบาท COGS) ที่ เริ่มระบบ › การเชื่อมต่อบัญชี');
    const book = await db.selectFrom('gl_journal_book').select('id').where('company_id', '=', a.companyId).where('deleted_at', 'is', null).orderBy('code').executeTakeFirst();
    if (!book) throw badRequest('ไม่พบสมุดรายวัน');
    const line = (account_id: string, debit: string, credit: string) => ({ account_id, debit, credit, department_id: null, description: null });
    const out: string[] = [];
    await db.transaction().execute(async (tx) => {
      const open = st.inventory.filter((x) => !d(x.opening).isZero());
      if (open.length) out.push((await createJournal(tx, a, { journal_book_id: book.id, voucher_date: st.fiscal_year.end, description: 'ปิดบัญชีสินค้าคงเหลือต้นปี',
        lines: [line(cogs, open.reduce((s, x) => s.plus(x.opening), d(0)).toFixed(2), '0'), ...open.map((x) => line(x.account_id, '0', x.opening))] } as never)).voucher_no);
      const close = st.inventory.filter((x) => !d(x.closing!).isZero());
      if (close.length) out.push((await createJournal(tx, a, { journal_book_id: book.id, voucher_date: st.fiscal_year.end, description: 'ปิดบัญชีสินค้าคงเหลือปลายปี ยกไปปีหน้า',
        lines: [...close.map((x) => line(x.account_id, x.closing!, '0')), line(cogs, '0', close.reduce((s, x) => s.plus(x.closing!), d(0)).toFixed(2))] } as never)).voucher_no);
    });
    if (!out.length) throw badRequest('ยอดสินค้าคงเหลือต้นปีและปลายปีเป็นศูนย์ — ไม่มีรายการต้องลง');
    return { vouchers: out };
  });

  /** ปิดประมวลผลสิ้นปี (S-YE-02/03/04): พิมพ์ YES ยืนยัน · ล็อคทุกงวด · สถานะปิด · สร้างรอบบัญชีปีถัดไป */
  app.post('/api/v1/gl/year-end/close', async (req) => {
    const a = requireCompany(req);
    const b = parse(z.object({ fiscal_year_id: uuid, confirm: z.string(), next_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), req.body);
    if (b.confirm.trim().toUpperCase() !== 'YES') throw badRequest('ป้อน YES เพื่อยืนยันการประมวลผลสิ้นปี');
    const st = await status(db, a, b.fiscal_year_id);
    if (st.fiscal_year.status === 'C') throw badRequest(`ปี ${st.fiscal_year.code} ปิดแล้ว`);
    const block = st.checks.find((c) => c.block && !c.ok);
    if (block) throw badRequest(`ยังปิดปีไม่ได้: ${block.label} — ${block.detail}`);
    const fy = st.fiscal_year;
    let nextId = st.next_year.id;
    await db.transaction().execute(async (tx) => {
      if (!nextId) {
        const start = b.next_start ?? st.next_year.start;
        if (start <= fy.end) throw badRequest('รอบบัญชีปีใหม่ต้องเริ่มหลังวันสิ้นปีที่ปิด');
        nextId = await createFiscalYear(tx, a.companyId, start, a.userId);
      }
      await tx.updateTable('gl_period').set({ is_locked: true, locked_by: a.userId, locked_at: sql`now()` as never }).where('company_id', '=', a.companyId).where('deleted_at', 'is', null)
        .where('start_date', '>=', fy.start).where('end_date', '<=', fy.end).where('is_locked', '=', false).execute();
      await tx.updateTable('gl_fiscal_year').set({ status: 'C', closed_at: sql`now()` as never, updated_by: a.userId }).where('id', '=', fy.id).execute();
      await logActivity(tx, a, { module: 'GL', action: 'YEAR_END', docNo: fy.code, table: 'gl_fiscal_year', rowId: fy.id, detail: { warnings: st.checks.filter((c) => !c.ok).map((c) => c.label) } });
    });
    return { closed: fy.code, next_year_id: nextId };
  });

  /** เปิดปีที่ปิดแล้วกลับ (เฉพาะปีล่าสุดที่ปิด) — ปลดล็อคทุกงวดของปี */
  app.post('/api/v1/gl/year-end/reopen', async (req) => {
    const a = requireCompany(req);
    const b = parse(z.object({ fiscal_year_id: uuid }), req.body);
    const ys = await years(db, a.companyId);
    const fy = ys.find((y) => y.id === b.fiscal_year_id);
    if (!fy) throw notFound('ปีบัญชี');
    if (fy.status !== 'C') throw badRequest(`ปี ${fy.code} ยังไม่ได้ปิด`);
    const later = ys.find((y) => y.start > fy.end && y.status === 'C');
    if (later) throw badRequest(`ต้องเปิดปี ${later.code} ก่อน (เปิดย้อนจากปีล่าสุด)`);
    await db.transaction().execute(async (tx) => {
      await tx.updateTable('gl_period').set({ is_locked: false, locked_by: null, locked_at: null }).where('company_id', '=', a.companyId).where('deleted_at', 'is', null)
        .where('start_date', '>=', fy.start).where('end_date', '<=', fy.end).execute();
      await tx.updateTable('gl_fiscal_year').set({ status: 'O', closed_at: null, updated_by: a.userId }).where('id', '=', fy.id).execute();
      await logActivity(tx, a, { module: 'GL', action: 'YEAR_REOPEN', docNo: fy.code, table: 'gl_fiscal_year', rowId: fy.id });
    });
    return { reopened: fy.code };
  });
}
