/**
 * ต้นทุนตาม Job / โครงการ (เจ้าของ 17/11/2569 · HANDOFF 129)
 * เจ้าของเลือก: 1ข ไม่บังคับใส่ Job · 2ก Job ที่ปิดแล้วห้ามใช้ในเอกสารใหม่ ใบเก่าคงเดิม · 3ก ขาย/รายได้ใส่ Job ได้
 *               4ก งบรายบัญชีต้นทุน · 5ก ซื้อเข้าคลังที่ใส่ Job = ต้นทุนตอนเบิกใช้
 *
 * บริษัท A ผังบัญชีมาตรฐาน (Perpetual) · Job J1 งบค่าใช้จ่าย (บัญชีหมวด 5 ของรหัสค่าใช้จ่าย) 2,000 · มูลค่าสัญญา 10,000
 *   RR ซื้อสินค้า 10 × 100 = 1,000 + VAT 70 บรรทัด Job J1 → Dr สินค้า 1,000 [J1] (ยังไม่ใช่ต้นทุน — "ซื้อเข้าคลังสำหรับ Job")
 *   OU เบิกใช้ 4 × 100 = 400 Job J1                    → Dr ค่าใช้จ่าย 400 [J1] / Cr สินค้า 400
 *   OE ค่าใช้จ่ายอื่น 500 (แยก VAT) Job J1              → Dr ค่าใช้จ่าย 500 [J1]
 *   JV Dr ค่าใช้จ่าย 250 [J1] / Cr เงินสด 250
 *   IV ขาย 2 × 1,500 = 3,000 Job J1                    → Cr ขาย 3,000 [J1] · ต้นทุนขาย 200 [J1]
 *   → รายได้ 3,000 · ต้นทุน 400 + 500 + 250 + 200 = 1,350 · กำไร 1,650 (55.00%) · ซื้อเข้าคลังสำหรับ Job 1,000 − 400 − 200 ที่ไม่ติด Job = 1,000
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { openDatabase, type Database } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { taxIdCheckDigit } from '@buddy/core';

const tid = (n: number) => { const b = `0105563${String(n).padStart(5, '0')}`; return b + taxIdCheckDigit(b); };

let database: Database;
let app: FastifyInstance;
let cookie = '';

async function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown) {
  const r = await app.inject({ method, url, payload: body as object, headers: cookie ? { cookie } : {} });
  const set = r.headers['set-cookie'];
  if (set) cookie = (Array.isArray(set) ? set[0]! : set).split(';')[0]!;
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
}

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.BUDDY_REQUIRE_ADMIN_2FA = '0';
  process.env.BUDDY_CHANGES_HOLDBACK_MS = '0';
  process.env.BUDDY_SECRET_KEY ??= Buffer.alloc(32, 7).toString('base64');
  const cfg = { ...loadConfig({}), databaseUrl: undefined, dataDir: 'memory://' };
  database = await openDatabase(cfg);
  await migrate(database, cfg.migrationsDir, () => {});
  app = await buildApp(database, cfg);
}, 120_000);
afterAll(async () => { await app?.close(); await database?.close(); });

const co: Record<string, string> = {};
const ids: Record<string, string> = {};
const select = (c: string) => call('POST', '/api/v1/auth/select', { company_id: co[c] });
type Acc = { id: string; account_no: string; account_group: string; is_control: boolean; status: string };
const accounts = async () => (await call('GET', '/api/v1/gl/accounts')).body as Acc[];
const typeOf = async (cls: string) => (await call('GET', `/api/v1/trade-defaults/${cls}`)).body.types[0].id as string;
/** บรรทัดบัญชีของเอกสาร: เลขที่บัญชี:เดบิต:เครดิต:รหัส Job */
const jlines = async (headerId: string) => (await sql<{ s: string }>`
  SELECT g.account_no || ':' || l.debit || ':' || l.credit || ':' || coalesce(p.code, '-') AS s
    FROM doc_header h JOIN gl_journal_line l ON l.journal_id = h.journal_id AND l.deleted_at IS NULL JOIN gl_account g ON g.id = l.account_id LEFT JOIN md_project p ON p.id = l.project_id
   WHERE h.id = ${headerId} ORDER BY 1`.execute(database.db)).rows.map((r) => r.s);
const jobOf = (s: string[]) => s.filter((x) => !x.endsWith(':-'));

describe('setup', () => {
  it('two companies, items, supplier, customer', async () => {
    expect((await call('POST', '/api/v1/setup', { username: 'admin', display_name: 'ผู้ดูแล', password: 'secret123' })).status).toBe(200);
    for (const c of ['A', 'B']) {
      const r = await call('POST', '/api/v1/companies', { code: `JB${c}`, name_th: `บริษัท Job ${c}`, fiscal_start: '2026-01-01', chart: 'express' });
      expect(r.status).toBe(200);
      co[c] = r.body.id;
      await select(c);
      const sp = await call('POST', '/api/v1/suppliers', { code: 'S001', name: `ผู้จำหน่าย ${c}`, tax_id: tid(c === 'A' ? 1 : 2) });
      const cu = await call('POST', '/api/v1/customers', { code: 'C001', name: `ลูกค้า ${c}`, tax_id: tid(c === 'A' ? 3 : 4) });
      expect([sp.status, sp.body.error?.message, cu.status, cu.body.error?.message]).toEqual([200, undefined, 200, undefined]);
      ids[`sup${c}`] = sp.body.id;
      ids[`cus${c}`] = cu.body.id;
    }
    await select('A');
    const acc = await accounts();
    const leaf5 = acc.filter((x) => x.account_group === '5' && !x.is_control && x.status === 'A');
    ids.exp = leaf5[0]!.id;
    ids.cash = acc.find((x) => x.account_no === '1111-00')!.id;
    const u = await call('POST', '/api/v1/data-tables/20/rows', { code: 'BAG', name_th: 'ถุง', rate: '1' });
    expect(u.status, JSON.stringify(u.body)).toBe(201);
    ids.unit = u.body.id;
    ids.wh = (await call('GET', '/api/v1/lookups?types=WH')).body.WH[0]?.id ?? (await call('POST', '/api/v1/data-tables/21/rows', { code: 'W1', name_th: 'คลังหน้างาน' })).body.id;
    expect(ids.wh).toBeTruthy();
    const it = await call('POST', '/api/v1/items', { code: '01-JOBA-000001', name_th: 'ปูนซีเมนต์', base_unit_id: ids.unit, std_cost: '100' });
    expect([it.status, it.body.error?.message]).toEqual([200, undefined]);
    ids.item = it.body.id;
    const ex = await call('POST', '/api/v1/other-expenses', { code: '95-5200-91', name_th: 'ค่าแรงช่าง', accounts: { expense: ids.exp } });
    expect([ex.status, ex.body.error?.message]).toEqual([200, undefined]);
    ids.expItem = ex.body.id;
  });
});

describe('แฟ้ม Job', () => {
  it('add / validate / list; first Job switches the company to "use Job"; logged', async () => {
    await select('A');
    expect((await call('GET', '/api/v1/projects/options')).body).toEqual({ enabled: false, rows: [] });
    const body = { code: 'J1', name_th: 'งานก่อสร้างอาคาร A', customer_id: ids.cusA, ref_no: 'สัญญา 1/2569', manager: 'คุณช่าง', start_date: '2026-01-01', end_date: '2026-12-31', contract_amount: '10000', budgets: [{ account_id: ids.exp, amount: '2000' }] };
    expect((await call('POST', '/api/v1/projects', { ...body, code: '' })).body.error.message).toMatch(/ป้อนรหัส Job/);
    expect((await call('POST', '/api/v1/projects', { ...body, end_date: '2025-01-01' })).body.error.message).toMatch(/วันสิ้นสุด/);
    expect((await call('POST', '/api/v1/projects', { ...body, budgets: [{ account_id: ids.exp, amount: '1' }, { account_id: ids.exp, amount: '2' }] })).body.error.message).toMatch(/ซ้ำ/);
    const ctl = (await accounts()).find((x) => x.is_control)!;
    expect((await call('POST', '/api/v1/projects', { ...body, budgets: [{ account_id: ctl.id, amount: '1' }] })).body.error.message).toMatch(/บัญชีคุม/);
    const r = await call('POST', '/api/v1/projects', body);
    expect([r.status, r.body.error?.message]).toEqual([200, undefined]);
    ids.j1 = r.body.id;
    expect((await call('POST', '/api/v1/projects', body)).body.error.message).toMatch(/รหัส Job J1 ซ้ำ/);
    ids.j2 = (await call('POST', '/api/v1/projects', { code: 'J2', name_th: 'งานที่ปิดแล้ว', status: 'I' })).body.id;
    ids.j3 = (await call('POST', '/api/v1/projects', { code: 'J3', name_th: 'งานยังไม่ใช้' })).body.id;
    const opt = (await call('GET', '/api/v1/projects/options')).body;
    expect([opt.enabled, opt.rows.map((x: { code: string; status: string }) => `${x.code}:${x.status}`)]).toEqual([true, ['J1:A', 'J2:I', 'J3:A']]);
    const one = (await call('GET', `/api/v1/projects/${ids.j1}`)).body;
    expect([one.customer_code, one.contract_amount, one.budgets.map((b: { amount: string }) => b.amount), one.used]).toEqual(['C001', '10000.00', ['2000.00'], false]);
    const list = (await call('GET', '/api/v1/projects')).body as Array<{ code: string; budget_total: string }>;
    expect(list.map((x) => `${x.code}:${Number(x.budget_total)}`)).toEqual(['J1:2000', 'J2:0', 'J3:0']);
    const log = (await sql<{ action: string }>`SELECT action FROM sys_activity_log WHERE table_name = 'md_project' AND row_id = ${ids.j1}`.execute(database.db)).rows.map((x) => x.action);
    expect(log).toEqual(['ADD']);
  });
});

describe('Job ในเอกสาร → บรรทัดบัญชี', () => {
  it('purchase (RR): stock bought for the Job carries the Job on the inventory line only', async () => {
    const r = await call('POST', '/api/v1/purchase-invoices', { doc_type_id: await typeOf('RR'), doc_date: '2026-03-01', party_id: ids.supA, price_type: '2', vat_rate: 7, project_id: ids.j1,
      lines: [{ item_id: ids.item, warehouse_id: ids.wh, qty: '10', unit_id: ids.unit, unit_price: '100', project_id: ids.j1 }] });
    expect([r.status, r.body.error?.message]).toEqual([200, undefined]);
    ids.rr = r.body.id;
    const j = await jlines(ids.rr!);
    expect(jobOf(j)).toHaveLength(1);
    expect(jobOf(j)[0]).toMatch(/:1000\.00:0\.00:J1$/);
    const doc = (await call('GET', `/api/v1/purchase-invoices/${ids.rr}`)).body;
    expect([doc.project_id, doc.lines[0].project_id]).toEqual([ids.j1, ids.j1]);
  });

  it('closed Job cannot be used in a new document (line number told); unknown/other-company Job refused', async () => {
    const base = { doc_type_id: await typeOf('RR'), doc_date: '2026-03-02', party_id: ids.supA, price_type: '2', vat_rate: 7 };
    const bad = await call('POST', '/api/v1/purchase-invoices', { ...base, lines: [{ item_id: ids.item, warehouse_id: ids.wh, qty: '1', unit_id: ids.unit, unit_price: '1', project_id: ids.j2 }] });
    expect([bad.status, bad.body.error.message]).toEqual([400, expect.stringMatching(/บรรทัดที่ 1: Job J2 ปิดแล้ว/)]);
    const bad2 = await call('POST', '/api/v1/purchase-invoices', { ...base, project_id: ids.j2, lines: [{ item_id: ids.item, warehouse_id: ids.wh, qty: '1', unit_id: ids.unit, unit_price: '1' }] });
    expect([bad2.status, bad2.body.error.message]).toEqual([400, expect.stringMatching(/Job J2 ปิดแล้ว/)]);
    const bad3 = await call('POST', '/api/v1/purchase-invoices', { ...base, lines: [{ item_id: ids.item, warehouse_id: ids.wh, qty: '1', unit_id: ids.unit, unit_price: '1', project_id: '00000000-0000-7000-8000-000000000001' }] });
    expect([bad3.status, bad3.body.error.message]).toEqual([400, expect.stringMatching(/ไม่พบJob\/โครงการนี้/)]);
  });

  it('internal issue (OU): cost of the Job happens here (5ก)', async () => {
    const r = await call('POST', '/api/v1/stock-issues', { doc_type_id: await typeOf('OU'), doc_date: '2026-03-05', remark: 'เบิกไปหน้างาน', lines: [{ item_id: ids.item, warehouse_id: ids.wh, qty: 4, project_id: ids.j1 }] });
    expect([r.status, r.body.error?.message]).toEqual([200, undefined]);
    ids.ou = r.body.id;
    const j = await jlines(ids.ou!);
    expect(jobOf(j)).toHaveLength(1);
    expect(jobOf(j)[0]).toMatch(/:400\.00:0\.00:J1$/);
    expect((await call('GET', `/api/v1/stock-issues/${ids.ou}`)).body.lines[0].project_id).toBe(ids.j1);
  });

  it('other expense (OE) line Job', async () => {
    const r = await call('POST', '/api/v1/other-expense-docs', { doc_type_id: await typeOf('OE'), doc_date: '2026-03-06', party_name: 'ช่างรายวัน', price_type: '2', vat_rate: 7, lines: [{ item_id: ids.expItem, amount: 500, project_id: ids.j1 }] });
    expect([r.status, r.body.error?.message]).toEqual([200, undefined]);
    ids.oe = r.body.id;
    const acc = (await accounts()).find((x) => x.id === ids.exp)!;
    expect(jobOf(await jlines(ids.oe!))).toEqual([`${acc.account_no}:500.00:0.00:J1`]);
  });

  it('journal voucher (JV) line Job · closed Job refused on a new voucher', async () => {
    const book = (await call('GET', '/api/v1/gl/books')).body.find((b: { code: string }) => b.code === '00').id;
    const r = await call('POST', '/api/v1/gl/journals', { journal_book_id: book, voucher_date: '2026-03-07', lines: [{ account_id: ids.exp, debit: '250', project_id: ids.j1 }, { account_id: ids.cash, credit: '250' }] });
    expect([r.status, r.body.error?.message]).toEqual([200, undefined]);
    ids.jv = r.body.id;
    const one = (await call('GET', `/api/v1/gl/journals/${ids.jv}`)).body;
    expect(one.lines.map((l: { project_code: string | null }) => l.project_code)).toEqual(['J1', null]);
    const bad = await call('POST', '/api/v1/gl/journals', { journal_book_id: book, voucher_date: '2026-03-07', lines: [{ account_id: ids.exp, debit: '1', project_id: ids.j2 }, { account_id: ids.cash, credit: '1' }] });
    expect([bad.status, bad.body.error.message]).toEqual([400, expect.stringMatching(/บรรทัดที่ 1: Job J2 ปิดแล้ว/)]);
  });

  it('sale (IV) line Job: revenue and cost of goods sold of the Job', async () => {
    const r = await call('POST', '/api/v1/sales-invoices', { doc_type_id: await typeOf('IV'), doc_date: '2026-03-10', party_id: ids.cusA, price_type: '2', vat_rate: 7,
      lines: [{ item_id: ids.item, warehouse_id: ids.wh, qty: '2', unit_id: ids.unit, unit_price: '1500', project_id: ids.j1 }] });
    expect([r.status, r.body.error?.message]).toEqual([200, undefined]);
    ids.iv = r.body.id;
    const j = jobOf(await jlines(ids.iv!));
    expect(j).toHaveLength(2);
    expect(j.some((x) => /:0\.00:3000\.00:J1$/.test(x)) && j.some((x) => /:200\.00:0\.00:J1$/.test(x))).toBe(true);
  });

  it('Job closed later: old documents still edit with it; new ones cannot', async () => {
    const cur = (await call('GET', `/api/v1/projects/${ids.j1}`)).body;
    expect(cur.used).toBe(true);
    const close = await call('PUT', `/api/v1/projects/${ids.j1}`, { ...cur, status: 'I', budgets: cur.budgets.map((b: { account_id: string; amount: string }) => ({ account_id: b.account_id, amount: b.amount })) });
    expect([close.status, close.body.error?.message]).toEqual([200, undefined]);
    const jv = (await call('GET', `/api/v1/gl/journals/${ids.jv}`)).body;
    const ed = await call('PUT', `/api/v1/gl/journals/${ids.jv}`, { journal_book_id: jv.journal_book_id, voucher_date: '2026-03-07', description: 'แก้คำอธิบาย',
      lines: jv.lines.map((l: { account_id: string; project_id: string | null; debit: string; credit: string }) => ({ account_id: l.account_id, project_id: l.project_id, debit: l.debit, credit: l.credit })) });
    expect([ed.status, ed.body.error?.message]).toEqual([200, undefined]);
    const book = jv.journal_book_id;
    const nw = await call('POST', '/api/v1/gl/journals', { journal_book_id: book, voucher_date: '2026-03-08', lines: [{ account_id: ids.exp, debit: '1', project_id: ids.j1 }, { account_id: ids.cash, credit: '1' }] });
    expect([nw.status, nw.body.error.message]).toEqual([400, expect.stringMatching(/Job J1 ปิดแล้ว/)]);
    await call('PUT', `/api/v1/projects/${ids.j1}`, { ...cur, status: 'A', budgets: cur.budgets.map((b: { account_id: string; amount: string }) => ({ account_id: b.account_id, amount: b.amount })) });
  });

  it('delete: used Job refused, unused Job deleted', async () => {
    expect((await call('DELETE', `/api/v1/projects/${ids.j1}`)).body.error.message).toMatch(/ลบไม่ได้/);
    expect((await call('DELETE', `/api/v1/projects/${ids.j3}`)).status).toBe(200);
    expect((await call('GET', `/api/v1/projects/${ids.j3}`)).status).toBe(404);
  });
});

describe('รายงานต้นทุน/กำไรตาม Job', () => {
  it('summary: revenue, cost, profit, budget; stock bought for the Job shown apart (not double counted)', async () => {
    const r = (await call('GET', '/api/v1/reports/jobs')).body;
    const j1 = r.rows.find((x: { code: string }) => x.code === 'J1');
    expect([j1.revenue, j1.cost, j1.profit, j1.margin, j1.budget, j1.budget_left, j1.budget_used, j1.stock_for_job, j1.contract_amount])
      .toEqual(['3000.00', '1350.00', '1650.00', '55.00', '2000.00', '650.00', '67.50', '1000.00', '10000.00']);
    expect([r.totals.revenue, r.totals.cost, r.totals.profit]).toEqual(['3000.00', '1350.00', '1650.00']);
    // ช่วงวันที่: ก่อนขาย = ต้นทุน OU+OE+JV เท่านั้น
    const early = (await call('GET', '/api/v1/reports/jobs?from=2026-03-01&to=2026-03-07')).body.rows.find((x: { code: string }) => x.code === 'J1');
    expect([early.revenue, early.cost]).toEqual(['0.00', '1150.00']);
    expect((await call('GET', '/api/v1/reports/jobs?status=I')).body.rows.map((x: { code: string }) => x.code)).toEqual(['J2']);
  });

  it('detail by account with budget; ledger and trial balance filter by Job agree', async () => {
    const r = (await call('GET', `/api/v1/reports/jobs/${ids.j1}`)).body;
    expect([r.revenue.actual, r.cost.actual, r.cost.budget, r.other.actual, r.profit, r.margin]).toEqual(['3000.00', '1350.00', '2000.00', '1000.00', '1650.00', '55.00']);
    const expRow = r.cost.rows.find((x: { account_id: string }) => x.account_id === ids.exp);
    expect([expRow.budget, expRow.actual === '750.00' || expRow.actual === '1150.00']).toEqual(['2000.00', true]);
    const led = (await call('GET', `/api/v1/reports/ledgers?from=2026-01-01&to=2026-12-31&project_id=${ids.j1}`)).body;
    // บรรทัด Job J1: สินค้า 1,000 + ค่าใช้จ่าย 400 + 500 + 250 + ต้นทุนขาย 200 (เดบิต) · ขาย 3,000 (เครดิต)
    expect([led.debit, led.credit]).toEqual(['2350.00', '3000.00']);
    const tb = (await call('GET', `/api/v1/reports/trial-balance?from=2026-01-01&to=2026-12-31&project_id=${ids.j1}`)).body;
    expect([tb.totals.debit, tb.totals.credit]).toEqual(['2350.00', '3000.00']);
    const all = (await call('GET', '/api/v1/reports/trial-balance?from=2026-01-01&to=2026-12-31')).body;
    expect(all.balanced).toBe(true);
  });
});

describe('ข้ามบริษัทไม่ได้', () => {
  it('company B cannot see, use, change, delete or report on company A Jobs', async () => {
    await select('B');
    expect((await call('GET', '/api/v1/projects')).body).toEqual([]);
    expect((await call('GET', '/api/v1/projects/options')).body).toEqual({ enabled: false, rows: [] });
    expect((await call('GET', `/api/v1/projects/${ids.j1}`)).status).toBe(404);
    expect((await call('PUT', `/api/v1/projects/${ids.j1}`, { code: 'J1', name_th: 'แย่ง' })).status).toBe(404);
    expect((await call('DELETE', `/api/v1/projects/${ids.j1}`)).status).toBe(404);
    expect((await call('GET', `/api/v1/reports/jobs/${ids.j1}`)).status).toBe(404);
    expect((await call('GET', '/api/v1/reports/jobs')).body.rows).toEqual([]);
    const acc = await accounts();
    const book = (await call('GET', '/api/v1/gl/books')).body.find((b: { code: string }) => b.code === '00').id;
    const jv = await call('POST', '/api/v1/gl/journals', { journal_book_id: book, voucher_date: '2026-03-07', lines: [{ account_id: acc.find((x) => x.account_no === '1111-00')!.id, debit: '1', project_id: ids.j1 }, { account_id: acc.find((x) => x.account_no === '1111-00')!.id, credit: '1' }] });
    expect([jv.status, jv.body.error.message]).toEqual([400, expect.stringMatching(/ไม่พบJob\/โครงการนี้/)]);
    // งบที่อ้างบัญชีของบริษัท A ไม่ได้
    expect((await call('POST', '/api/v1/projects', { code: 'B1', name_th: 'งาน B', budgets: [{ account_id: ids.exp, amount: '1' }] })).status).toBe(400);
    expect((await call('GET', `/api/v1/reports/ledgers?from=2026-01-01&to=2026-12-31&project_id=${ids.j1}`)).body.debit).toBe('0.00');
    await select('A');
  });
});
