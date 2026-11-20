/**
 * บันทึกพร้อมกันจากหลายเครื่อง (HANDOFF 158 · เจ้าของ 20/11/2569 "แก้ชุดกันยอดผิด") — ต้องใช้ PostgreSQL จริง (หลายการเชื่อมต่อพร้อมกัน)
 * PGlite มีการเชื่อมต่อเดียว คำขอพร้อมกันถูกเรียงคิวเอง จึงจำลองการชนไม่ได้ → ข้ามเมื่อไม่ได้ตั้ง BUDDY_TEST_PG_URL (ฐานข้อมูลว่างที่ลบทิ้งได้)
 * ใช้: BUDDY_TEST_PG_URL=<ฐานว่าง> pnpm --filter @buddy/server exec vitest run test/concurrency.pg.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { taxIdCheckDigit } from '@buddy/core';
import { openDatabase, type Database } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const PG = process.env.BUDDY_TEST_PG_URL;
const tid = (n: number) => { const b = `0105563${String(n).padStart(5, '0')}`; return b + taxIdCheckDigit(b); };
let database: Database;
let app: FastifyInstance;
let cookie = '';
async function call(method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown) {
  const r = await app.inject({ method, url, payload: body as object, headers: cookie ? { cookie } : {} });
  const set = r.headers['set-cookie'];
  if (set) cookie = (Array.isArray(set) ? set[0]! : set).split(';')[0]!;
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
}
/** สองคำขอพร้อมกัน (คนละการเชื่อมต่อฐานข้อมูล) */
const both = <A, B>(a: () => Promise<A>, b: () => Promise<B>) => Promise.all([a(), b()]);

describe.skipIf(!PG)('saving at the same time from two devices (HANDOFF 158 · real PostgreSQL)', () => {
  const ids: Record<string, string> = {};
  let companyId = '';
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.BUDDY_REQUIRE_ADMIN_2FA = '0';
    process.env.BUDDY_SECRET_KEY ??= Buffer.alloc(32, 7).toString('base64');
    const cfg = { ...loadConfig({}), databaseUrl: PG, dataDir: undefined };
    database = await openDatabase(cfg);
    await migrate(database, cfg.migrationsDir, () => {});
    app = await buildApp(database, cfg);
    expect((await call('POST', '/api/v1/setup', { username: 'admin', display_name: 'ผู้ดูแล', password: 'secret123' })).status).toBe(200);
    const co = await call('POST', '/api/v1/companies', { code: 'CONC', name_th: 'บริษัท ทดสอบพร้อมกัน จำกัด', fiscal_start: '2026-01-01', chart: 'express' });
    expect([co.status, co.body.error?.message]).toEqual([200, undefined]);
    companyId = co.body.id;
    await call('POST', '/api/v1/auth/select', { company_id: companyId });
    ids.cus = (await call('POST', '/api/v1/customers', { code: 'C1', name: 'ลูกค้าพร้อมกัน', tax_id: tid(1) })).body.id;
    ids.sup = (await call('POST', '/api/v1/suppliers', { code: 'S1', name: 'ผู้จำหน่ายพร้อมกัน', tax_id: tid(2) })).body.id;
    const unit = ((await call('GET', '/api/v1/lookups?types=UNIT')).body.UNIT as Array<{ id: string }> | undefined)?.[0]?.id
      ?? (await call('POST', '/api/v1/data-tables/20/rows', { code: 'PCS', name_th: 'ชิ้น', rate: 1 })).body.id;
    ids.wh = ((await call('GET', '/api/v1/lookups?types=WH')).body.WH as Array<{ id: string }> | undefined)?.[0]?.id
      ?? (await call('POST', '/api/v1/data-tables/21/rows', { code: 'W1', name_th: 'คลังหลัก' })).body.id;
    ids.item = (await call('POST', '/api/v1/items', { code: '01-CONC-000001', name_th: 'สินค้าขายพร้อมกัน', base_unit_id: unit, std_cost: '50' })).body.id;
    for (const c of ['IV', 'HS', 'RE', 'RR']) ids[`type:${c}`] = (await call('GET', `/api/v1/trade-defaults/${c}`)).body.types[0].id;
    ids.book = (await call('GET', '/api/v1/gl/books')).body[0].id;
    const chart = (await call('GET', '/api/v1/gl/accounts')).body as Array<{ id: string; account_no: string; is_postable?: boolean }>;
    ids.cash = chart.find((a) => a.account_no === '1111-00')!.id;
    ids.service = (await call('POST', '/api/v1/services', { base_unit_id: unit, code: '90-CONC-000001', name_th: 'ค่าบริการ', vat_code: '0', accounts: { revenue: chart.find((a) => a.account_no === '4100-11')!.id } })).body.id;
    expect(ids.service).toBeTruthy();
    // รับสินค้าเข้า 5 ชิ้น · ไม่ยอมให้ติดลบ ตรวจยอด ณ ปัจจุบัน
    const rr = await call('POST', '/api/v1/purchase-invoices', { doc_type_id: ids['type:RR'], doc_date: '2026-03-01', party_id: ids.sup, price_type: '2', vat_rate: 7, lines: [{ item_id: ids.item, warehouse_id: ids.wh, qty: 5, unit_price: 100 }] });
    expect([rr.status, rr.body.error?.message]).toEqual([200, undefined]);
    expect((await call('PUT', '/api/v1/settings', { values: { 'ic.allow_negative': 'N', 'ic.negative_check_level': '1' } })).status).toBe(200);
  }, 180_000);
  afterAll(async () => { await app?.close(); await database?.close(); });

  const invoice = async (amount: number, extra: Record<string, unknown> = {}) => {
    const r = await call('POST', '/api/v1/sales-invoices', { doc_type_id: ids['type:IV'], doc_date: '2026-03-10', party_id: ids.cus, price_type: '0', vat_rate: 0, lines: [{ item_id: ids.service, qty: 1, unit_price: amount }], ...extra });
    expect([r.status, r.body.error?.message]).toEqual([200, undefined]);
    return r.body.id as string;
  };
  const receipt = (inv: string, amount: string) => call('POST', '/api/v1/ar-receipts', { doc_type_id: ids['type:RE'], doc_date: '2026-03-15', party_id: ids.cus, settlements: [{ invoice_header_id: inv, amount }] });
  const outstanding = async (inv: string) => (await sql<{ outstanding: string; settled: string }>`SELECT outstanding, settled FROM v_ar_outstanding WHERE header_id = ${inv}`.execute(database.db)).rows[0];

  it('two receipts for the same invoice at once: one is saved, the other gets a Thai "เกินยอดคงค้าง" message — never paid twice', async () => {
    for (let round = 0; round < 3; round++) {
      const inv = await invoice(1000);
      const [a, b] = await both(() => receipt(inv, '1000.00'), () => receipt(inv, '1000.00'));
      const ok = [a, b].filter((r) => r.status === 200), bad = [a, b].filter((r) => r.status !== 200);
      expect([ok.length, bad.length]).toEqual([1, 1]);
      expect(bad[0]!.body.error.message).toMatch(/เกินยอดคงค้าง|มากกว่ายอดคงค้าง/);
      expect(await outstanding(inv)).toMatchObject({ outstanding: '0.00', settled: '1000.00' });
    }
  });

  it('cancel an invoice while a receipt for it is being saved: never an active receipt on a cancelled invoice (iron rule)', async () => {
    for (let round = 0; round < 3; round++) {
      const inv = await invoice(500);
      const [r, c] = await both(() => receipt(inv, '500.00'), () => call('POST', `/api/v1/sales-invoices/${inv}/cancel`, { reason: 'ทดสอบพร้อมกัน' }));
      expect([r.status, c.status].filter((s) => s === 200)).toHaveLength(1);
      const bad = (await sql<{ n: number }>`SELECT count(*)::int AS n FROM doc_settlement s JOIN doc_header p ON p.id = s.payment_header_id JOIN doc_header i ON i.id = s.invoice_header_id
          WHERE s.invoice_header_id = ${inv} AND s.deleted_at IS NULL AND p.doc_status <> 'C' AND i.doc_status = 'C'`.execute(database.db)).rows[0]!.n;
      expect(bad).toBe(0);
      if (c.status !== 200) expect(c.body.error.message).toMatch(/รับ\/จ่ายชำระแล้ว|อ้างถึงอยู่/);
      if (r.status !== 200) expect(r.body.error.message).toMatch(/ถูกยกเลิก|ไม่พบบิลค้าง/);
    }
  });

  it('a credit sale and a cash sale of the last 5 in stock at once (negative stock not allowed): one is refused, stock never goes below 0', async () => {
    // ต่างประเภทเอกสาร = ไม่รอกันที่เลขที่เอกสาร (ประเภทเดียวกันรอกันที่ md_doc_type อยู่แล้ว) — ชนกันได้จริงเฉพาะที่ตรวจคงเหลือ
    const qty = async () => Number((await sql<{ q: string }>`SELECT coalesce(sum(qty), 0) AS q FROM v_stock_move WHERE company_id = ${companyId} AND item_id = ${ids.item}`.execute(database.db)).rows[0]!.q);
    const line = { item_id: ids.item, warehouse_id: ids.wh, qty: 5, unit_price: 200 };
    for (let round = 0; round < 3; round++) {
      expect(await qty()).toBe(5);
      const [a, b] = await both(() => call('POST', '/api/v1/sales-invoices', { doc_type_id: ids['type:IV'], doc_date: '2026-03-20', party_id: ids.cus, price_type: '2', vat_rate: 7, lines: [line] }),
        () => call('POST', '/api/v1/cash-sales', { doc_type_id: ids['type:HS'], doc_date: '2026-03-20', party_id: ids.cus, price_type: '2', vat_rate: 7, lines: [line] }));
      expect([a.status, b.status].sort()).toEqual([200, 400]);
      expect([a, b].find((r) => r.status === 400)!.body.error.message).toMatch(/ไม่พอจ่าย/);
      expect(await qty()).toBe(0);
      // คืนสต๊อกสำหรับรอบถัดไป: ยกเลิกใบที่บันทึกได้
      const okOne = a.status === 200 ? ['sales-invoices', a.body.id] : ['cash-sales', b.body.id];
      expect((await call('POST', `/api/v1/${okOne[0]}/${okOne[1]}/cancel`, { reason: 'รอบถัดไป' })).status).toBe(200);
    }
  });

  it('two journal vouchers in the same book and day at once: both saved with consecutive numbers, no raw duplicate error', async () => {
    const jv = () => call('POST', '/api/v1/gl/journals', { journal_book_id: ids.book, voucher_date: '2026-03-25', lines: [{ account_id: ids.cash, debit: '10' }, { account_id: ids.cash, credit: '10' }] });
    for (let round = 0; round < 3; round++) {
      const rs = await Promise.all([jv(), jv(), jv()]);
      expect(rs.map((r) => [r.status, r.body.error?.message])).toEqual(rs.map(() => [200, undefined]));
      const nos = rs.map((r) => r.body.voucher_no as string);
      expect(new Set(nos).size).toBe(3);
    }
  });

  it('the same typed document number on two devices at once: one saved, the other told in Thai (no index name)', async () => {
    const [a, b] = await both(() => call('POST', '/api/v1/sales-invoices', { doc_type_id: ids['type:IV'], doc_no: 'IV-SAME-158', doc_date: '2026-03-26', party_id: ids.cus, price_type: '0', vat_rate: 0, lines: [{ item_id: ids.service, qty: 1, unit_price: 1 }] }),
      () => call('POST', '/api/v1/sales-invoices', { doc_type_id: ids['type:IV'], doc_no: 'IV-SAME-158', doc_date: '2026-03-26', party_id: ids.cus, price_type: '0', vat_rate: 0, lines: [{ item_id: ids.service, qty: 1, unit_price: 1 }] }));
    const bad = [a, b].filter((r) => r.status !== 200);
    expect(bad).toHaveLength(1);
    expect(bad[0]!.body.error.message).toMatch(/มีอยู่แล้ว|มีผู้บันทึกไปก่อนแล้ว/);
    expect(bad[0]!.body.error.message).not.toMatch(/uq_/);
  });

  it('locking a period while a document is saved in it: the save either finishes first or is refused — never lands in a locked period', async () => {
    const list = ((await call('GET', '/api/v1/gl/periods')).body as Array<{ periods: Array<{ id: string; period_no: number; start_date: string }> }>).flatMap((y) => y.periods);
    const apr = list.find((p) => String(p.start_date).slice(0, 7) === '2026-04');
    expect(apr).toBeTruthy();
    const save = () => call('POST', '/api/v1/sales-invoices', { doc_type_id: ids['type:IV'], doc_date: '2026-04-30', party_id: ids.cus, price_type: '0', vat_rate: 0, lines: [{ item_id: ids.service, qty: 1, unit_price: 10 }] });
    const lock = () => call('POST', `/api/v1/gl/periods/${apr!.id}/lock`, { locked: true });
    const [s, l] = await both(save, lock);
    expect(l.status).toBe(200);
    if (s.status !== 200) expect(s.body.error.message).toMatch(/งวดที่ปิดแล้ว/);
  });
});
