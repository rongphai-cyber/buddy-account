/**
 * ทดสอบรับมอบ WTS Connect (docs/17 B0.7): ระบบอื่นส่งเอกสารเข้า Buddy ผ่านกุญแจ API ด้วยตัวเลขตัวอย่างข้อ 7
 * → งบทดลองและรายงานภาษีขายตรงทุกสตางค์ · ส่งซ้ำไม่เบิ้ล · บริษัทใหม่ (งบทดลองมีแต่รายการของชุดนี้)
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Database } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { buildApp } from '../src/app.js';
import { openTestDatabase } from './test-db.js';
import { taxIdCheckDigit } from '@buddy/core';

const tid = (n: number) => { const b = `0105561${String(n).padStart(5, '0')}`; return b + taxIdCheckDigit(b); };
let database: Database;
let app: FastifyInstance;
let cookie = '';
let key = '';

async function call(method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown) {
  const r = await app.inject({ method, url, payload: body as object, headers: cookie ? { cookie } : {} });
  const set = r.headers['set-cookie'];
  if (set) cookie = (Array.isArray(set) ? set[0]! : set).split(';')[0]!;
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
}
/** ระบบต้นทางส่งด้วยกุญแจ API + X-Source-* */
async function send(url: string, body: unknown, system: string, ref: string, version = 1) {
  const r = await app.inject({ method: 'POST', url, payload: body as object, headers: { authorization: `Bearer ${key}`, 'x-source-system': system, 'x-source-ref': ref, 'x-source-version': String(version) } });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
}

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.BUDDY_REQUIRE_ADMIN_2FA = '0';
  process.env.BUDDY_SECRET_KEY ??= Buffer.alloc(32, 7).toString('base64');
  // PGlite ในหน่วยความจำ หรือ PostgreSQL จริงเมื่อรันจาก tools/cloud/pg-check.mjs (BUDDY_TEST_DATABASE_URL — docs/20)
  const { cfg, database: d } = await openTestDatabase();
  database = d;
  await migrate(database, cfg.migrationsDir, () => {});
  app = await buildApp(database, cfg);
}, 120_000);
afterAll(async () => { await app?.close(); await database?.close(); });

describe('WTS Connect acceptance (docs/17 B0.7)', () => {
  const acc: Record<string, string> = {};
  const ids: Record<string, string> = {};
  type TbRow = { account_no: string; closing: string };
  const tb = async (from: string, to: string) => {
    const r = (await call('GET', `/api/v1/reports/trial-balance?from=${from}&to=${to}`)).body as { balanced: boolean; rows: TbRow[] };
    return { balanced: r.balanced, of: (no: string) => r.rows.find((x) => x.account_no === no)?.closing ?? '0.00' };
  };
  const lines = async (id: string) => ((await call('GET', `/api/v1/docs/${id}/journal`)).body.journals[0].lines as Array<{ account_no: string; debit: string; credit: string }>)
    .map((l) => `${l.account_no}:${l.debit}:${l.credit}`).sort();

  it('sets up a fresh company the way WTS-POS needs it', async () => {
    expect((await call('POST', '/api/v1/setup', { username: 'admin', display_name: 'ผู้ดูแล', password: 'secret123' })).status).toBe(200);
    const co = await call('POST', '/api/v1/companies', { code: 'WTSACC', name_th: 'บริษัท ร้านอาหารทดสอบ จำกัด', fiscal_start: '2026-01-01', chart: 'express' });
    expect(co.status).toBe(200);
    await call('POST', '/api/v1/auth/select', { company_id: co.body.id });
    const chart = (await call('GET', '/api/v1/gl/accounts')).body as Array<{ id: string; account_no: string; level: number }>;
    const no = (n: string) => chart.find((x) => x.account_no === n)!;
    for (const n of ['1111-00', '1114-02', '2136-01', '1154-01', '5200-02', '5200-05', '5110-00', '4100-11']) acc[n] = no(n).id;
    // บัญชีเพิ่มสำหรับร้านอาหาร (ตามตารางข้อ 7.1/7.2)
    for (const [n, name, parent, group] of [['1119-01', 'เงินรอเคลียร์ QR', '1110-00', '1'], ['1119-02', 'เงินรอเคลียร์บัตรเครดิต', '1110-00', '1'], ['1130-50', 'ลูกหนี้แพลตฟอร์ม', '1130-00', '1'],
      ['4100-15', 'ขายอาหารและเครื่องดื่ม', '4100-10', '4'], ['5380-91', 'เงินสดขาด/เกิน', '5380-00', '5'], ['5200-96', 'ค่าใช้จ่ายส่งเสริมการขาย', '5200-00', '5']] as const) {
      const p = no(parent);
      const r = await call('POST', '/api/v1/gl/accounts', { account_no: n, name_th: name, parent_id: p.id, level: p.level + 1, account_group: group, is_control: false });
      expect([n, r.status, r.body?.error?.message]).toEqual([n, 200, undefined]);
      acc[n] = r.body.id;
    }
    // วิธีรับชำระ: QR / บัตร → บัญชีพักรอเคลียร์ · โอนเข้าธนาคาร
    const pms = (await call('GET', '/api/v1/payment-methods/R')).body as Array<Record<string, unknown>>;
    const extra = [{ code: 'QR', name_th: 'QR พร้อมเพย์', gl: acc['1119-01'] }, { code: 'CD', name_th: 'บัตรเครดิต', gl: acc['1119-02'] }, { code: 'TB', name_th: 'โอนเข้าธนาคาร', gl: acc['1114-02'] }]
      .map((x, i) => ({ seq: String(pms.length + i + 1).padStart(2, '0'), code: x.code, name_th: x.name_th, name_en: null, kind: 'OTHER', creates_cheque: false, gl_account_id: x.gl, bank_account_id: null, status: 'A' }));
    const put = await call('PUT', '/api/v1/payment-methods/R', { rows: [...pms.map(({ used: _u, ...r }) => r), ...extra] });
    expect([put.status, put.body?.error?.message]).toEqual([200, undefined]);
    for (const m of (await call('GET', '/api/v1/payment-methods/R')).body as Array<{ id: string; code: string }>) ids[`pm:${m.code}`] = m.id;
    // หน่วย/คลัง แล้วกด "ตั้งค่าสำหรับ WTS-POS" (สร้างคลังระหว่างทาง ประเภทเอกสาร OUR… รหัสรายได้ ลูกค้าแพลตฟอร์ม)
    expect((await call('PUT', '/api/v1/data-tables/20', { rows: [{ code: 'KG', short_th: null, short_en: null, name_th: 'กิโลกรัม', name_en: null, rate: '1', status: 'A' }] })).status).toBe(200);
    expect((await call('PUT', '/api/v1/data-tables/21', { rows: [{ code: 'MAIN', short_th: null, short_en: null, name_th: 'คลังครัวกลาง', name_en: null, rate: null, status: 'A' }] })).status).toBe(200);
    const setup = await call('POST', '/api/v1/company/wts-pos-setup', { accounts: { recipe: acc['5110-00'] } });
    expect(setup.status).toBe(200);
    const lk = (await call('GET', '/api/v1/lookups?types=UNIT,WH')).body as { UNIT: Array<{ id: string }>; WH: Array<{ id: string; code: string }> };
    ids.unit = lk.UNIT[0]!.id; ids.main = lk.WH.find((w) => w.code === 'MAIN')!.id; ids.transit = lk.WH.find((w) => w.code.startsWith('TR'))!.id;
    // รหัสรายได้ POS-FOOD → บัญชีขายอาหาร · ลูกค้า/ผู้ให้บริการ
    const food = (await call('GET', '/api/v1/services?q=POS-FOOD')).body.rows[0];
    expect((await call('PUT', `/api/v1/services/${food.id}`, { code: 'POS-FOOD', name_th: 'ขายอาหาร', vat_code: '1', accounts: { revenue: acc['4100-15'] } })).status).toBe(200);
    ids.food = food.id;
    const grabCus = (await call('GET', '/api/v1/customers?q=PF-GRAB')).body.rows[0];
    expect((await call('PUT', `/api/v1/customers/${grabCus.id}`, { code: 'PF-GRAB', name: 'Grab (GrabFood)', tax_id: tid(1), ar_account_id: acc['1130-50'] })).status).toBe(200);
    ids.grab = grabCus.id;
    ids.walkin = (await call('POST', '/api/v1/customers', { code: 'POS-WALKIN', name: 'ลูกค้าหน้าร้าน', tax_id: tid(2) })).body.id;
    ids.franchisee = (await call('POST', '/api/v1/customers', { code: 'FR-001', name: 'ร้านแฟรนไชส์ สาขา 1', tax_id: tid(3) })).body.id;
    ids.grabSup = (await call('POST', '/api/v1/suppliers', { code: 'S-GRAB', name: 'บริษัท แกร็บ ทดสอบ จำกัด', tax_id: tid(4) })).body.id;
    const rice = await call('POST', '/api/v1/items', { code: '01-RICE-000001', name_th: 'ข้าวสาร', base_unit_id: ids.unit, std_cost: '50' });
    expect([rice.status, rice.body?.error?.message]).toEqual([200, undefined]);
    ids.rice = rice.body.id;
    ids.vendor = (await call('POST', '/api/v1/suppliers', { code: 'S-RICE', name: 'ร้านข้าวสารทดสอบ', tax_id: tid(5) })).body.id;
    for (const [code, name] of [['90-FRAN-ROY001', 'ค่าสิทธิ์แฟรนไชส์'], ['90-FRAN-MKT001', 'ค่าการตลาด'], ['90-FRAN-SYS001', 'ค่าระบบ']] as const) {
      const r = await call('POST', '/api/v1/services', { code, name_th: name, vat_code: '1', accounts: { revenue: acc['4100-11'] } });
      expect([code, r.status, r.body?.error?.message]).toEqual([code, 200, undefined]);
      ids[code] = r.body.id;
    }
    const me = (await call('GET', '/api/v1/auth/me')).body;
    key = (await call('POST', '/api/v1/api-keys', { name: 'WTS-POS', user_id: me.user.id })).body.key;
    expect(key).toMatch(/^bk_/);
    for (const c of ['HS', 'IV', 'RE', 'HP', 'RL']) ids[`type:${c}`] = (await call('GET', `/api/v1/trade-defaults/${c}`)).body.types[0].id;
    ids['type:OUR'] = ((await call('GET', '/api/v1/trade-defaults/OU')).body.types as Array<{ id: string; code: string }>).find((t) => t.code === 'OUR')!.id;
  });

  // 7.1 ยอดขายรายวัน ร้าน BK01 15/10/2569: 184 บิล รวม VAT 30,000 → ก่อน VAT 28,037.38 ภาษีขาย 1,962.62
  const hsBody = () => ({ doc_type_id: ids['type:HS'], doc_date: '2026-10-15', party_id: ids.walkin, price_type: '1', vat_rate: 7, lines: [{ item_id: ids.food, qty: 1, unit_price: 27000 }],
    payments: [{ payment_method_id: ids['pm:QR'], amount: 10000 }, { payment_method_id: ids['pm:CD'], amount: 5000 }],
    abbr_invoices: [{ pos_device_code: 'BK01-1', inv_from: 'A0001', inv_to: 'A0120', inv_count: 120, base_amount: '14018.69', vat_amount: '981.31' },
      { pos_device_code: 'BK01-2', inv_from: 'B0001', inv_to: 'B0064', inv_count: 64, base_amount: '11214.95', vat_amount: '785.05' }],
    source_totals: { net_amount: '27000.00', taxable_amount: '25233.64', vat_amount: '1766.36' } });
  const ivBody = () => ({ doc_type_id: ids['type:IV'], doc_date: '2026-10-15', party_id: ids.grab, price_type: '1', vat_rate: 7, your_ref: 'GF-15OCT (42 ออเดอร์)', lines: [{ item_id: ids.food, qty: 1, unit_price: 3000 }],
    source_totals: { net_amount: '3000.00', taxable_amount: '2803.74', vat_amount: '196.26' } });
  const jvBody = async () => ({ journal_book_id: (await call('GET', '/api/v1/gl/books')).body[0].id, voucher_date: '2026-10-15', description: 'เงินสดขาดปิดกะ ร้าน BK01 15/10/2569 (นับได้ 11,980)',
    lines: [{ account_id: acc['5380-91'], debit: '20.00' }, { account_id: acc['1111-00'], credit: '20.00' }], source_totals: { total: '20.00' } });

  it('7.1 daily store sales: HS + platform IV + cash-short JV → trial balance and output VAT report to the satang', async () => {
    const hs = await send('/api/v1/cash-sales', hsBody(), 'wts-pos', 'pos:BK01:2026-10-15:HS');
    expect([hs.status, hs.body.error?.message]).toEqual([201, undefined]);
    const iv = await send('/api/v1/sales-invoices', ivBody(), 'wts-pos', 'pos:BK01:2026-10-15:IV:GRAB');
    expect([iv.status, iv.body.error?.message]).toEqual([201, undefined]);
    const jv = await send('/api/v1/gl/journals', await jvBody(), 'wts-pos', 'pos:BK01:2026-10-15:CASH');
    expect([jv.status, jv.body.error?.message]).toEqual([201, undefined]);
    ids.hs = hs.body.id; ids.iv = iv.body.id;
    const t = await tb('2026-10-01', '2026-10-31');
    expect(t.balanced).toBe(true);
    expect({ cash: t.of('1111-00'), short: t.of('5380-91'), qr: t.of('1119-01'), card: t.of('1119-02'), platform: t.of('1130-50'), sales: t.of('4100-15'), vat: t.of('2136-01') }).toEqual({
      cash: '11980.00', short: '20.00', qr: '10000.00', card: '5000.00', platform: '3000.00', sales: '-28037.38', vat: '-1962.62' });
    // รายงานภาษีขาย ต.ค. 2569: ใบกำกับอย่างย่อ 2 เครื่อง + ใบกำกับเต็มรูปแพลตฟอร์ม รวม 28,037.38 / 1,962.62
    const rep = (await call('POST', '/api/v1/rpt/6.3/run', { params: { period: '2026-10' } })).body.rows as Array<{ t?: string; c: { name?: string; base?: string; vat?: string; doc?: string } }>;
    const items = rep.filter((r) => !r.t && r.c.doc);
    expect(items.map((r) => `${r.c.name}|${String(r.c.base).replace(/,/g, '')}|${String(r.c.vat).replace(/,/g, '')}`)).toEqual([
      'ใบกำกับภาษีอย่างย่อ เลขที่ A0001–A0120|14018.69|981.31', 'ใบกำกับภาษีอย่างย่อ เลขที่ B0001–B0064|11214.95|785.05', 'Grab (GrabFood)|2803.74|196.26']);
    const sum = (k: 'base' | 'vat') => items.reduce((s, r) => s + Math.round(Number(String(r.c[k]).replace(/,/g, '')) * 100), 0);
    expect([sum('base'), sum('vat')]).toEqual([2803738, 196262]);
  });

  it('resending every document does not double anything', async () => {
    const before = await tb('2026-10-01', '2026-10-31');
    for (const [url, body, ref] of [['/api/v1/cash-sales', hsBody(), 'pos:BK01:2026-10-15:HS'], ['/api/v1/sales-invoices', ivBody(), 'pos:BK01:2026-10-15:IV:GRAB'], ['/api/v1/gl/journals', await jvBody(), 'pos:BK01:2026-10-15:CASH']] as const) {
      const r = await send(url, body, 'wts-pos', ref);
      expect([ref, r.status, r.body.duplicate]).toEqual([ref, 200, true]);
    }
    const after = await tb('2026-10-01', '2026-10-31');
    for (const n of ['1111-00', '5380-91', '1119-01', '1119-02', '1130-50', '4100-15', '2136-01']) expect([n, after.of(n)]).toEqual([n, before.of(n)]);
  });

  it('7.2 platform payout: RE with GP/promo/ads charges → bank 1,780', async () => {
    const charge = (account: string, desc: string, amount: string, vat: string, inv: string | null) => ({ supplier_id: ids.grabSup, account_id: account, description: desc, amount, vat_type: inv ? '1' : '0', vat_amount: vat, tax_invoice_no: inv, tax_invoice_date: inv ? '2026-11-05' : null });
    const re = await send('/api/v1/ar-receipts', { doc_type_id: ids['type:RE'], doc_date: '2026-11-05', party_id: ids.grab, settlements: [{ invoice_header_id: ids.iv, amount: 3000 }],
      payments: [{ payment_method_id: ids['pm:TB'], amount: 1780 }],
      charges: [charge(acc['5200-02']!, 'ค่า GP 30%', '900', '63', 'GRAB-TAX-001'), charge(acc['5200-96']!, 'โปรร่วมจ่าย', '150', '0', null), charge(acc['5200-05']!, 'ค่าโฆษณา', '100', '7', 'GRAB-TAX-002')] },
      'wts-pos', 'pos:payout:GRAB:2026-11-05');
    expect([re.status, re.body.error?.message]).toEqual([201, undefined]);
    expect(await lines(re.body.id)).toEqual([`1114-02:1780.00:0.00`, '1130-50:0.00:3000.00', '1154-01:70.00:0.00', '5200-02:900.00:0.00', '5200-05:100.00:0.00', '5200-96:150.00:0.00'].sort());
    const t = await tb('2026-10-01', '2026-11-30');
    expect([t.balanced, t.of('1130-50')]).toEqual([true, '0.00']);   // ลูกหนี้แพลตฟอร์มตัดหมด
  });

  it('7.3 franchise fees: IV 21,100 + VAT 1,477 = 22,577', async () => {
    const r = await send('/api/v1/sales-invoices', { doc_type_id: ids['type:IV'], doc_date: '2026-11-01', party_id: ids.franchisee, price_type: '2', vat_rate: 7,
      lines: [{ item_id: ids['90-FRAN-ROY001'], qty: 1, unit_price: 14000, description: 'ค่าสิทธิ์ 5% ของยอดขาย 280,000' }, { item_id: ids['90-FRAN-MKT001'], qty: 1, unit_price: 5600, description: 'ค่าการตลาด 2%' }, { item_id: ids['90-FRAN-SYS001'], qty: 1, unit_price: 1500 }],
      source_totals: { taxable_amount: '21100.00', vat_amount: '1477.00', net_amount: '22577.00' } }, 'wts-pos', 'fr:fee:FR-001:2026-10');
    expect([r.status, r.body.net_amount, r.body.error?.message]).toEqual([201, '22577.00', undefined]);
  });

  it('stock from POS/central kitchen: HP purchase, OU recipe usage (OUR), RL to the in-transit warehouse — all idempotent', async () => {
    const hp = { doc_type_id: ids['type:HP'], doc_date: '2026-11-02', party_id: ids.vendor, price_type: '2', vat_rate: 7, ref_no: 'RICE-INV-01', ref_date: '2026-11-02', lines: [{ item_id: ids.rice, qty: 10, unit_price: 50, warehouse_id: ids.main }], source_totals: { net_amount: '535.00', vat_amount: '35.00' } };
    const ou = { doc_type_id: ids['type:OUR'], doc_date: '2026-11-03', remark: 'ใช้ตามสูตร ร้าน BK01', lines: [{ item_id: ids.rice, warehouse_id: ids.main, qty: 4 }] };
    const rl = { doc_type_id: ids['type:RL'], doc_date: '2026-11-03', warehouse_id: ids.main, to_warehouse_id: ids.transit, lines: [{ item_id: ids.rice, qty: 2 }] };
    for (const [url, body, ref] of [['/api/v1/cash-purchases', hp, 'pos:BK01:2026-11-02:HP:RICE-INV-01'], ['/api/v1/stock-issues', ou, 'pos:BK01:2026-11-03:OU-RCP'], ['/api/v1/stock-transfers', rl, 'ck:SHIP-0001:SHIP']] as const) {
      const a = await send(url, body, 'wts-pos', ref);
      expect([ref, a.status, a.body.error?.message]).toEqual([ref, 201, undefined]);
      const b = await send(url, body, 'wts-pos', ref);
      expect([ref, b.status, b.body.id]).toEqual([ref, 200, a.body.id]);
      ids[ref] = a.body.id;
    }
    // ใช้ตามสูตร 4 กก. × ทุน 50 = 200 → ต้นทุนขาย (บัญชีที่กำหนดตอนตั้งค่าสำหรับ WTS-POS)
    expect((await lines(ids['pos:BK01:2026-11-03:OU-RCP']!)).find((l) => l.startsWith('5110-00'))).toBe('5110-00:200.00:0.00');
    const bal = (await call('GET', `/api/v1/stock/balances?item_id=${ids.rice}`)).body.rows as Array<{ warehouse_id: string; qty: string }>;
    expect(bal.map((b) => `${b.warehouse_id === ids.main ? 'MAIN' : 'TR'}:${Number(b.qty)}`).sort()).toEqual(['MAIN:4', 'TR:2']);
    expect((await tb('2026-01-01', '2026-12-31')).balanced).toBe(true);
  });
});
