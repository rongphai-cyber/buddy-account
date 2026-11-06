/**
 * คืนเงินมัดจำที่มี VAT ด้วยใบลดหนี้ (06/11/2569 — เจ้าของ "คืนเงินมัดจำที่มี VAT ด้วยใบลดหนี้")
 * ตัวเลขคำนวณมือ (VAT 7%):
 *  (a) AI แยก VAT 10,000 + 700 = 10,700 → RD 4,000: ก่อน VAT 4,000.00 VAT 280.00 จ่าย 4,280.00 · RD 6,000 (ปิดยอด): VAT 700 − 280 = 420.00 จ่าย 6,420.00
 *  (b) AI รวม VAT 10,700 (VAT 700 มัดจำรับ 10,000) → RD 5,000: ก่อน VAT 5,000 × 100/107 = 4,672.897 → 4,672.90 VAT 327.10
 *      RD 5,700 (ปิดยอด): VAT 700 − 327.10 = 372.90 ก่อน VAT 5,327.10
 *  (c) AI รวม VAT 1,000 (VAT 65.42 ก่อน VAT 934.58) → RD 333: 333 × 100/107 = 311.2149 → 311.21 VAT 21.79
 *      RD 667 (ปิดยอด): VAT 65.42 − 21.79 = 43.63 ก่อน VAT 623.37 (สูตรปกติได้ 623.36 + 43.64 จะเหลือ 0.01)
 *  งบทดลองหลังคืนครบ: 2135-02 เงินมัดจำรับ = −(10,000 + 10,000 + 934.58) + (4,000 + 6,000 + 4,672.90 + 5,327.10 + 311.21 + 623.37) = 0.00
 *                      2136-01 ภาษีขาย = −(700 + 700 + 65.42) + (280 + 420 + 327.10 + 372.90 + 21.79 + 43.63) = 0.00
 *  รายงานภาษีขาย ก.ค.: 6 รายการติดลบ มูลค่า −20,934.58 ภาษี −1,465.42 · มิ.ย. (ใบมัดจำ) มูลค่า 20,934.58 ภาษี 1,465.42
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDatabase, type Database } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { taxIdCheckDigit } from '@buddy/core';

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

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.BUDDY_REQUIRE_ADMIN_2FA = '0';
  process.env.BUDDY_SECRET_KEY ??= Buffer.alloc(32, 7).toString('base64');
  const cfg = { ...loadConfig({}), databaseUrl: undefined, dataDir: 'memory://' };
  database = await openDatabase(cfg);
  await migrate(database, cfg.migrationsDir, () => {});
  app = await buildApp(database, cfg);
}, 120_000);
afterAll(async () => { await app?.close(); await database?.close(); });

describe('ใบคืนเงินมัดจำที่มี VAT = ใบลดหนี้', () => {
  const ids: Record<string, string> = {};
  const co: Record<string, string> = {};
  type TbRow = { account_no: string; closing: string };
  const tb = async () => {
    const r = (await call('GET', '/api/v1/reports/trial-balance?from=2026-01-01&to=2026-12-31')).body as { balanced: boolean; rows: TbRow[] };
    return { balanced: r.balanced, of: (no: string) => r.rows.find((x) => x.account_no === no)?.closing ?? '0.00' };
  };
  const lines = async (id: string | undefined) => ((await call('GET', `/api/v1/docs/${id}/journal`)).body.journals.filter((j: { doc_status: string }) => j.doc_status === 'N')[0].lines as Array<{ account_no: string; debit: string; credit: string }>)
    .map((l) => `${l.account_no}:${l.debit}:${l.credit}`).sort();
  const remaining = async (ai: string) => (await call('GET', `/api/v1/ar-deposits/${ai}`)).body.remaining as string;
  const select = (c: string) => call('POST', '/api/v1/auth/select', { company_id: co[c] });
  const ai = (pt: '0' | '1' | '2', amount: number, rate = 7) => ({ doc_type_id: ids['type:AI'], doc_date: '2026-06-15', party_id: ids.cus, price_type: pt, vat_rate: pt === '0' ? 0 : rate,
    lines: [{ description: 'มัดจำค่าตกแต่งร้าน', amount }] });
  const rd = (deps: Array<[string, string]>, extra: Record<string, unknown> = {}) => ({ doc_type_id: ids['type:RD'], doc_date: '2026-07-20', party_id: ids.cus,
    deposits: deps.map(([k, amount]) => ({ header_id: ids[k], amount })), remark: 'ยกเลิกสัญญาตกแต่งร้าน คืนเงินมัดจำ', ...extra });
  const vatS = async (header: string, status = 'N') => (await call('GET', `/api/v1/vat/S?header_id=${header}&status=${status}`)).body.rows as Array<{ tax_invoice_no: string; tax_invoice_date: string; month: string; description: string; base_amount: string; vat_amount: string; doc_status: string; sign: number }>;
  const report = async (period: string) => (await call('POST', '/api/v1/rpt/6.3/run', { params: { period } })).body as { rows: Array<{ t?: string; c: Record<string, string | number> }> };

  it('sets up two companies, a customer and a bank payment method', async () => {
    expect((await call('POST', '/api/v1/setup', { username: 'admin', display_name: 'ผู้ดูแล', password: 'secret123' })).status).toBe(200);
    for (const [c, name] of [['A', 'บริษัท รับตกแต่ง จำกัด'], ['B', 'บริษัท อื่น จำกัด']] as const) {
      const r = await call('POST', '/api/v1/companies', { code: `RDV${c}`, name_th: name, fiscal_start: '2026-01-01', chart: 'express' });
      expect(r.status).toBe(200);
      co[c] = r.body.id;
    }
    await select('A');
    const chart = (await call('GET', '/api/v1/gl/accounts')).body as Array<{ id: string; account_no: string }>;
    const acc = (n: string) => chart.find((x) => x.account_no === n)!.id;
    ids.cus = (await call('POST', '/api/v1/customers', { code: 'C001', name: 'ร้านกาแฟ ทดสอบ', tax_id: tid(1), tax_branch_no: '00000', address_1: '1 ถนนนิมมานเหมินท์', zip_code: '50200' })).body.id;
    const pms = (await call('GET', '/api/v1/payment-methods/P')).body as Array<Record<string, unknown>>;
    const put = await call('PUT', '/api/v1/payment-methods/P', { rows: [...pms.map(({ used: _u, ...r }) => r),
      { seq: String(pms.length + 1).padStart(2, '0'), code: 'TO', name_th: 'โอนออกจากธนาคาร', name_en: null, kind: 'OTHER', creates_cheque: false, gl_account_id: acc('1114-02'), bank_account_id: null, status: 'A' }] });
    expect([put.status, put.body?.error?.message]).toEqual([200, undefined]);
    for (const m of (await call('GET', '/api/v1/payment-methods/P')).body as Array<{ id: string; code: string }>) ids[`pm:${m.code}`] = m.id;
    const svc = await call('POST', '/api/v1/services', { code: '90-SVCS-000001', name_th: 'ค่าบริการ', vat_code: '0', accounts: { revenue: acc('4100-11') } });
    expect([svc.status, svc.body?.error?.message]).toEqual([200, undefined]);
    ids.svc = svc.body.id;
    for (const c of ['AI', 'IV', 'RE', 'RD']) ids[`type:${c}`] = (await call('GET', `/api/v1/trade-defaults/${c}`)).body.types[0]?.id;
    // ใบมัดจำ (a) แยก VAT · (b) รวม VAT · (c) รวม VAT 1,000 · ไม่มี VAT · แยก VAT อัตรา 10% (ทดสอบปนกัน)
    for (const [k, pt, amt, rate] of [['a', '2', 10000, 7], ['b', '1', 10700, 7], ['c', '1', 1000, 7], ['novat', '0', 500, 0], ['rate10', '2', 1000, 10]] as const) {
      const r = await call('POST', '/api/v1/ar-deposits', ai(pt, amt, rate));
      expect([k, r.status, r.body.error?.message]).toEqual([k, 200, undefined]);
      ids[k] = r.body.id;
    }
    const one = async (k: string) => { const x = (await call('GET', `/api/v1/ar-deposits/${ids[k]}`)).body; return [x.net_amount, x.vat_amount]; };
    expect([await one('a'), await one('b'), await one('c')]).toEqual([['10700.00', '700.00'], ['10700.00', '700.00'], ['1000.00', '65.42']]);
  });

  it('(a) price excluding VAT: refund 4,000 → VAT 280 paid 4,280 · journal Dr deposit + Dr output VAT / Cr bank', async () => {
    // ตัวอย่างการลงบัญชี (ก่อนบันทึก) แสดงบรรทัดภาษีขาย
    const pv = await call('POST', '/api/v1/ar-deposit-refunds/posting-preview', rd([['a', '4000']]));
    expect(pv.body.journals[0].lines.map((l: { account_no: string; debit: string; credit: string; posting_role: string }) => `${l.posting_role}:${l.account_no}:${l.debit}:${l.credit}`).sort())
      .toEqual(['DEPOSIT_RECEIVED:2135-02:4000.00:0.00', 'OUTPUT_VAT:2136-01:280.00:0.00', 'CASH:1111-00:0.00:4280.00'].sort());
    expect(await remaining(ids.a!)).toBe('10000.00');
    const r = await call('POST', '/api/v1/ar-deposit-refunds', rd([['a', '4000']], { payments: [{ payment_method_id: ids['pm:TO'], amount: '4280' }] }));
    expect([r.status, r.body.error?.message, r.body.net_amount, r.body.vat_amount, r.body.cash_amount]).toEqual([200, undefined, '4280.00', '280.00', '0.00']);
    ids.rd1 = r.body.id;
    expect(await lines(ids.rd1)).toEqual(['2135-02:4000.00:0.00', '2136-01:280.00:0.00', '1114-02:0.00:4280.00'].sort());
    expect(await remaining(ids.a!)).toBe('6000.00');
    const h = (await call('GET', `/api/v1/ar-deposit-refunds/${ids.rd1}`)).body;
    expect([h.price_type, h.vat_rate, h.vat_amount, h.taxable_amount, h.net_amount, h.deposit_amount, h.ref_no, h.remark]).toEqual(['2', '7.0000', '280.00', '4000.00', '4280.00', '4000.00', expect.stringMatching(/^AI/), expect.stringMatching(/ยกเลิกสัญญา/)]);
    expect(h.deposits.map((x: { amount: string; vat_amount: string }) => [x.amount, x.vat_amount])).toEqual([['4000.00', '280.00']]);
    // ไม่ระบุวิธีจ่าย = เงินสดเต็มยอดรวม VAT
    const r2 = await call('POST', '/api/v1/ar-deposit-refunds', rd([['a', '6000']]));
    expect([r2.status, r2.body.error?.message, r2.body.net_amount, r2.body.vat_amount, r2.body.cash_amount]).toEqual([200, undefined, '6420.00', '420.00', '6420.00']);
    ids.rd2 = r2.body.id;
    expect(await lines(ids.rd2)).toEqual(['2135-02:6000.00:0.00', '2136-01:420.00:0.00', '1111-00:0.00:6420.00'].sort());
    expect(await remaining(ids.a!)).toBe('0.00');
  });

  it('(b) price including VAT: 5,000 → 4,672.90 + 327.10 · edit recalculates (5,350 → VAT 350.00) · 5,700 closes at 372.90', async () => {
    const r = await call('POST', '/api/v1/ar-deposit-refunds', rd([['b', '5000']]));
    expect([r.status, r.body.error?.message, r.body.net_amount, r.body.vat_amount]).toEqual([200, undefined, '5000.00', '327.10']);
    ids.rd3 = r.body.id;
    expect(await lines(ids.rd3)).toEqual(['2135-02:4672.90:0.00', '2136-01:327.10:0.00', '1111-00:0.00:5000.00'].sort());
    // แก้ยอด → คำนวณใหม่ + แฟ้มภาษีตาม
    const e = await call('PUT', `/api/v1/ar-deposit-refunds/${ids.rd3}`, rd([['b', '5350']]));
    expect([e.status, e.body.error?.message, e.body.net_amount, e.body.vat_amount]).toEqual([200, undefined, '5350.00', '350.00']);
    expect(await lines(ids.rd3)).toEqual(['2135-02:5000.00:0.00', '2136-01:350.00:0.00', '1111-00:0.00:5350.00'].sort());
    expect((await vatS(ids.rd3!)).map((v) => [v.base_amount, v.vat_amount])).toEqual([['5000.00', '350.00']]);
    expect(await remaining(ids.b!)).toBe('5350.00');
    const back = await call('PUT', `/api/v1/ar-deposit-refunds/${ids.rd3}`, rd([['b', '5000']]));
    expect([back.status, back.body.vat_amount]).toEqual([200, '327.10']);
    expect((await vatS(ids.rd3!)).map((v) => [v.base_amount, v.vat_amount])).toEqual([['4672.90', '327.10']]);
    const r4 = await call('POST', '/api/v1/ar-deposit-refunds', rd([['b', '5700']]));
    expect([r4.status, r4.body.error?.message, r4.body.net_amount, r4.body.vat_amount]).toEqual([200, undefined, '5700.00', '372.90']);
    ids.rd4 = r4.body.id;
    expect(await lines(ids.rd4)).toEqual(['2135-02:5327.10:0.00', '2136-01:372.90:0.00', '1111-00:0.00:5700.00'].sort());
  });

  it('(c) exact remainder: 333 → 311.21 + 21.79 · 667 → 623.37 + 43.63 · deposit and output VAT clear to 0.00', async () => {
    const r5 = await call('POST', '/api/v1/ar-deposit-refunds', rd([['c', '333']]));
    expect([r5.status, r5.body.error?.message, r5.body.vat_amount]).toEqual([200, undefined, '21.79']);
    ids.rd5 = r5.body.id;
    expect(await lines(ids.rd5)).toEqual(['2135-02:311.21:0.00', '2136-01:21.79:0.00', '1111-00:0.00:333.00'].sort());
    const r6 = await call('POST', '/api/v1/ar-deposit-refunds', rd([['c', '667']]));
    expect([r6.status, r6.body.error?.message, r6.body.vat_amount, r6.body.net_amount]).toEqual([200, undefined, '43.63', '667.00']);
    ids.rd6 = r6.body.id;
    expect(await lines(ids.rd6)).toEqual(['2135-02:623.37:0.00', '2136-01:43.63:0.00', '1111-00:0.00:667.00'].sort());
    // มัดจำ (a)(b)(c) คืนครบ — เหลือเฉพาะมัดจำไม่มี VAT 500 + อัตรา 10% 1,000 (ภาษี 100)
    const t = await tb();
    expect({ ok: t.balanced, dep: t.of('2135-02'), vat: t.of('2136-01'), bank: t.of('1114-02') }).toEqual({ ok: true, dep: '-1500.00', vat: '-100.00', bank: '-4280.00' });
  });

  it('sales VAT file + report: each RD is a negative credit-note row in the RD month, referencing the AI', async () => {
    const v = (await vatS(ids.rd1!))[0]!;
    const rd1 = (await call('GET', `/api/v1/ar-deposit-refunds/${ids.rd1}`)).body;
    const a = (await call('GET', `/api/v1/ar-deposits/${ids.a}`)).body;
    expect([v.tax_invoice_no, v.tax_invoice_date.slice(0, 10), v.month, v.base_amount, v.vat_amount, v.sign]).toEqual([rd1.doc_no, '2026-07-20', '2026-07', '4000.00', '280.00', -1]);
    expect(v.description).toMatch(new RegExp(`^ลดหนี้ — คืนเงินมัดจำ ร้านกาแฟ ทดสอบ อ้างถึงใบกำกับภาษี ${a.doc_no} ลว\\. 15/06/2569$`));
    const jul = await report('2026-07');
    const rows = jul.rows.filter((x) => !x.t);
    expect(rows.map((x) => [x.c.base, x.c.vat])).toEqual([['-4000.00', '-280.00'], ['-6000.00', '-420.00'], ['-4672.90', '-327.10'], ['-5327.10', '-372.90'], ['-311.21', '-21.79'], ['-623.37', '-43.63']]);
    expect(jul.rows.at(-1)!.c).toMatchObject({ base: '-20934.58', vat: '-1465.42' });
    // แบบแยกตามชนิดเอกสาร: กลุ่ม "ใบลดหนี้ — คืนเงินมัดจำ"
    const bill = (await call('POST', '/api/v1/rpt/6.3/run', { params: { period: '2026-07', variant: 'bill' } })).body as { rows: Array<{ t?: string; c: Record<string, string> }> };
    expect(bill.rows.find((x) => x.t === 'group')?.c.name).toBe('ใบลดหนี้ — คืนเงินมัดจำ');
    // มิ.ย. = ใบมัดจำ (บวก) 10,000 + 10,000 + 934.58 + 1,000 (10%) · ภาษี 700 + 700 + 65.42 + 100
    expect((await report('2026-06')).rows.at(-1)!.c).toMatchObject({ base: '21934.58', vat: '1565.42' });
    // ภ.พ.30 ก.ค.: ภาษีขายเดือนนี้ติดลบตามใบลดหนี้
    const pp30 = (await call('POST', '/api/v1/rpt/6.1/run', { params: { period: '2026-07' } })).body as { rows: Array<{ c: Record<string, string> }> };
    expect(JSON.stringify(pp30.rows)).toContain('-1465.42');
  });

  it('prints as "ใบลดหนี้ / ใบคืนเงินมัดจำ" with original/correct/difference/VAT and the reason', async () => {
    const pr = (await call('GET', `/api/v1/print/doc/${ids.rd2}`)).body.data;
    expect([pr.title, pr.title_en]).toEqual(['ใบลดหนี้ / ใบคืนเงินมัดจำ', 'CREDIT NOTE / DEPOSIT REFUND']);
    expect([pr.company.tax_id !== undefined, pr.party.name, pr.party.tax_id, pr.party.branch]).toEqual([true, 'ร้านกาแฟ ทดสอบ', tid(1), 'สำนักงานใหญ่']);
    expect(pr.lines.map((l: { name: string; amount: string }) => [l.name.replace(/AI\d+/, 'AI'), l.amount])).toEqual([['ใบกำกับภาษีเดิม AI ลงวันที่ 15/06/2569 มูลค่า 10000.00 ภาษี 700.00 — ลดมูลค่า 6000.00 ภาษี 420.00', '6420.00']]);
    expect(pr.totals).toEqual([{ label: 'มูลค่าตามใบกำกับภาษีเดิม', value: '10000.00' }, { label: 'ลดหนี้ครั้งก่อน', value: '4000.00' }, { label: 'มูลค่าที่ถูกต้อง', value: '0.00' },
      { label: 'ผลต่าง', value: '6000.00' }, { label: 'ภาษีมูลค่าเพิ่มของผลต่าง 7%', value: '420.00' }, { label: 'รวมเงินคืนทั้งสิ้น', value: '6420.00' }]);
    expect(pr.fields.remark).toBe('เหตุผลที่ลดหนี้: CDNS04 บอกเลิกสัญญาบริการ — ยกเลิกสัญญาตกแต่งร้าน คืนเงินมัดจำ');
    expect(pr.fields.ref_invoice).toMatch(/^AI\d+ ลงวันที่ 15\/06\/2569$/);
    // ใบแรกไม่มีลดหนี้ครั้งก่อน
    const p1 = (await call('GET', `/api/v1/print/doc/${ids.rd1}`)).body.data;
    expect(p1.totals.map((x: { label: string; value: string }) => `${x.label}=${x.value}`)).toEqual(['มูลค่าตามใบกำกับภาษีเดิม=10000.00', 'มูลค่าที่ถูกต้อง=6000.00', 'ผลต่าง=4000.00', 'ภาษีมูลค่าเพิ่มของผลต่าง 7%=280.00', 'รวมเงินคืนทั้งสิ้น=4280.00']);
  });

  it('cancel restores outstanding, deposit account, output VAT and the VAT report; AI used by an RD cannot be cancelled', async () => {
    expect((await call('POST', `/api/v1/ar-deposits/${ids.a}/cancel`, { reason: 'x' })).body.error.message).toMatch(/คืนเงินแล้ว/);
    expect((await call('POST', `/api/v1/ar-deposit-refunds/${ids.rd2}/cancel`, { reason: 'จ่ายผิดยอด' })).status).toBe(200);
    expect(await remaining(ids.a!)).toBe('6000.00');
    expect((await vatS(ids.rd2!, 'all')).map((v) => v.doc_status)).toEqual(['C']);
    const t = await tb();
    expect([t.balanced, t.of('2135-02'), t.of('2136-01'), t.of('1111-00')]).toEqual([true, '-7500.00', '-520.00', expect.any(String)]);
    expect((await report('2026-07')).rows.at(-1)!.c).toMatchObject({ base: '-14934.58', vat: '-1045.42' });
    // คืนใหม่ปิดยอด: VAT = 700 − 280 (RD ที่ยกเลิกไม่นับ)
    const again = await call('POST', '/api/v1/ar-deposit-refunds', rd([['a', '6000']], { doc_date: '2026-07-25' }));
    expect([again.status, again.body.error?.message, again.body.vat_amount]).toEqual([200, undefined, '420.00']);
    expect((await tb()).of('2136-01')).toBe('-100.00');
  });

  it('refuses mixes, missing reason, other companies; RE still refuses VAT deposits', async () => {
    const mix = await call('POST', '/api/v1/ar-deposit-refunds', rd([['novat', '100'], ['rate10', '100']]));
    expect([mix.status, mix.body.error.message]).toEqual([400, expect.stringMatching(/มีภาษีมูลค่าเพิ่ม แต่ AI\d+ ไม่มี.*แยกเป็นใบคืนเงินมัดจำคนละใบ/)]);
    // มี VAT ทั้งคู่แต่ประเภทราคา/อัตราต่างกัน
    const r5 = await call('POST', '/api/v1/ar-deposits', ai('1', 2140));
    ids.b2 = r5.body.id;
    const pt = await call('POST', '/api/v1/ar-deposit-refunds', rd([['rate10', '100'], ['b2', '100']]));
    expect([pt.status, pt.body.error.message]).toEqual([400, expect.stringMatching(/ราคารวม VAT 7% ต่างจาก .*ราคาแยก VAT 10%.*แยกเป็นใบคืนเงินมัดจำคนละใบ/)]);
    const noReason = await call('POST', '/api/v1/ar-deposit-refunds', rd([['rate10', '100']], { remark: '' }));
    expect([noReason.status, noReason.body.error.message]).toEqual([400, expect.stringMatching(/ต้องระบุเหตุผล/)]);
    // มัดจำไม่มี VAT ไม่ต้องมีเหตุผล · ลงบัญชีแบบเดิม (ไม่มีภาษี)
    const plain = await call('POST', '/api/v1/ar-deposit-refunds', rd([['novat', '500']], { remark: '' }));
    expect([plain.status, plain.body.error?.message, plain.body.vat_amount]).toEqual([200, undefined, '0.00']);
    expect(await lines(plain.body.id)).toEqual(['2135-02:500.00:0.00', '1111-00:0.00:500.00'].sort());
    expect(await vatS(plain.body.id)).toEqual([]);
    // อัตรา 10%: 100 + VAT 10.00
    const ten = await call('POST', '/api/v1/ar-deposit-refunds', rd([['rate10', '100']]));
    expect([ten.status, ten.body.net_amount, ten.body.vat_amount]).toEqual([200, '110.00', '10.00']);
    // ใบเสร็จยังหักมัดจำที่มี VAT ไม่ได้
    const iv = await call('POST', '/api/v1/sales-invoices', { doc_type_id: ids['type:IV'], doc_date: '2026-07-31', party_id: ids.cus, price_type: '0', vat_rate: 0, lines: [{ item_id: ids.svc, qty: 1, unit_price: 100 }] });
    expect([iv.status, iv.body.error?.message, JSON.stringify(iv.body.error?.details)]).toEqual([200, undefined, undefined]);
    const re = await call('POST', '/api/v1/ar-receipts', { doc_type_id: ids['type:RE'], doc_date: '2026-07-31', party_id: ids.cus, settlements: [{ invoice_header_id: iv.body.id, amount: '100' }], deposits: [{ header_id: ids.b2, amount: '100' }] });
    expect([re.status, re.body.error.message]).toEqual([400, expect.stringMatching(/มีภาษีมูลค่าเพิ่ม.*หักในบิลขาย/)]);
    // บริษัทอื่น: ใช้ใบมัดจำของบริษัท A ไม่ได้ · อ่าน/ยกเลิกใบคืนเงินของ A ไม่ได้ · รายงานภาษีไม่เห็น
    await select('B');
    const bCus = (await call('POST', '/api/v1/customers', { code: 'C001', name: 'ลูกค้าบริษัท B', tax_id: tid(9) })).body.id;
    const bRd = (await call('GET', '/api/v1/trade-defaults/RD')).body.types[0].id;
    const cross = await call('POST', '/api/v1/ar-deposit-refunds', { doc_type_id: bRd, doc_date: '2026-07-20', party_id: bCus, remark: 'x', deposits: [{ header_id: ids.b, amount: '100' }] });
    expect([cross.status, cross.body.error.message]).toEqual([400, expect.stringMatching(/ไม่พบใบรับเงินมัดจำ/)]);
    const crossParty = await call('POST', '/api/v1/ar-deposit-refunds', { doc_type_id: bRd, doc_date: '2026-07-20', party_id: ids.cus, remark: 'x', deposits: [{ header_id: ids.b, amount: '100' }] });
    expect([crossParty.status, crossParty.body.error.message]).toEqual([400, expect.stringMatching(/ไม่พบลูกค้า/)]);
    expect((await call('GET', `/api/v1/ar-deposit-refunds/${ids.rd1}`)).status).toBe(404);
    expect((await call('POST', `/api/v1/ar-deposit-refunds/${ids.rd1}/cancel`, { reason: 'x' })).status).toBe(404);
    expect((await call('GET', `/api/v1/deposits/open?module=AR&party_id=${ids.cus}`)).body.rows).toEqual([]);
    expect((await report('2026-07')).rows.at(-1)!.c).toMatchObject({ base: '0.00', vat: '0.00' });
    await select('A');
  });

  it('open deposits list gives the screen what it needs for the exact-remainder VAT', async () => {
    const rows = (await call('GET', `/api/v1/deposits/open?module=AR&party_id=${ids.cus}`)).body.rows as Array<{ header_id: string; price_type: string; vat_rate: string; outstanding: string; rd_vat: string; other_use: boolean }>;
    const r = rows.find((x) => x.header_id === ids.rate10)!;
    expect([r.price_type, r.vat_rate, r.outstanding, r.rd_vat, r.other_use]).toEqual(['2', '10.0000', '900.00', '10.00', false]);
  });
});
