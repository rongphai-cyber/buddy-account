/**
 * มัดจำรับในใบเสร็จ + คืนเงินมัดจำ (05/11/2569 — WTS-Living ย้ายออก)
 * ตัวเลขตัวอย่าง (คำนวณมือ):
 *  AI  รับเงินประกันห้อง 9,600 (ไม่มี VAT) เงินสด            Dr 1111-00 9,600.00 / Cr 2135-02 เงินมัดจำรับ 9,600.00
 *  IV  ค่าเช่า 3,500 (ยกเว้น VAT) + น้ำ/ไฟ 978.65 (VAT 7%)     VAT = 978.65 × 7% = 68.5055 → 68.51 · รวม 3,500 + 978.65 + 68.51 = 4,547.16
 *      ภาษีเกณฑ์เงินสด                                       Dr 1130-02 4,547.16 / Cr ขาย 4,478.65 / Cr 2136-02 ภาษีขายรอเรียกเก็บ 68.51
 *  RE1 ชำระด้วยมัดจำเต็มยอด 4,547.16 (เงินสด 0)            Dr 2135-02 4,547.16 / Cr 1130-02 4,547.16 · Dr 2136-02 68.51 / Cr 2136-01 68.51
 *      มัดจำคงเหลือ 9,600 − 4,547.16 = 5,052.84
 *  IV  ค่าเสียหาย 300 (ไม่มี VAT) → RE2 ชำระด้วยมัดจำ 300   คงเหลือ 5,052.84 − 300 = 4,752.84
 *  RD  คืนเงินมัดจำ 4,752.84 โอนจากธนาคาร                  Dr 2135-02 4,752.84 / Cr 1114-02 4,752.84 → คงเหลือ 0
 *  งบทดลอง: 2135-02 = −9,600 + 4,547.16 + 300 + 4,752.84 = 0 · 1114-02 = −4,752.84 · 1111-00 = 9,600 · 1130-02 = 0 · 2136-02 = 0 · 2136-01 = −68.51
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDatabase, type Database } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { taxIdCheckDigit } from '@buddy/core';

const tid = (n: number) => { const b = `0105562${String(n).padStart(5, '0')}`; return b + taxIdCheckDigit(b); };
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
/** WTS-Living ส่งด้วยกุญแจ API + X-Source-* */
async function send(url: string, body: unknown, ref: string, version = 1) {
  const r = await app.inject({ method: 'POST', url, payload: body as object, headers: { authorization: `Bearer ${key}`, 'x-source-system': 'wts-living', 'x-source-ref': ref, 'x-source-version': String(version) } });
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

describe('มัดจำรับ: ใบเสร็จหักมัดจำ + คืนเงินมัดจำ (WTS-Living ย้ายออก)', () => {
  const ids: Record<string, string> = {};
  const co: Record<string, string> = {};
  type TbRow = { account_no: string; closing: string };
  const tb = async () => {
    const r = (await call('GET', '/api/v1/reports/trial-balance?from=2026-01-01&to=2026-12-31')).body as { balanced: boolean; rows: TbRow[] };
    return { balanced: r.balanced, of: (no: string) => r.rows.find((x) => x.account_no === no)?.closing ?? '0.00' };
  };
  const lines = async (id: string | undefined) => ((await call('GET', `/api/v1/docs/${id}/journal`)).body.journals.filter((j: { doc_status: string }) => j.doc_status === 'N')[0].lines as Array<{ account_no: string; debit: string; credit: string }>)
    .map((l) => `${l.account_no}:${l.debit}:${l.credit}`).sort();
  const remaining = async () => (await call('GET', `/api/v1/ar-deposits/${ids.ai}`)).body.remaining as string;
  const select = (c: string) => call('POST', '/api/v1/auth/select', { company_id: co[c] });
  const ai = (party: string | undefined, amount: number, extra: Record<string, unknown> = {}) => ({ doc_type_id: ids['type:AI'], doc_date: '2026-06-01', party_id: party, price_type: '0', vat_rate: 0, lines: [{ description: 'เงินประกันห้อง 101', amount }], ...extra });
  const re = (inv: string | undefined, amount: string, deps: Array<{ header_id: string | undefined; amount: string }>, extra: Record<string, unknown> = {}) =>
    ({ doc_type_id: ids['type:RE'], doc_date: '2026-07-31', party_id: ids.tenant, settlements: [{ invoice_header_id: inv, amount }], deposits: deps, ...extra });
  const rd = (amount: string, extra: Record<string, unknown> = {}) => ({ doc_type_id: ids['type:RD'], doc_date: '2026-07-31', party_id: ids.tenant, deposits: [{ header_id: ids.ai, amount }],
    payments: [{ payment_method_id: ids['pm:TO'], amount }], ...extra });

  it('sets up two companies, a dorm tenant, services and an API key', async () => {
    expect((await call('POST', '/api/v1/setup', { username: 'admin', display_name: 'ผู้ดูแล', password: 'secret123' })).status).toBe(200);
    for (const [c, name] of [['A', 'นิติบุคคลอาคารชุด ทดสอบ'], ['B', 'บริษัท อื่น จำกัด']] as const) {
      const r = await call('POST', '/api/v1/companies', { code: `LIV${c}`, name_th: name, fiscal_start: '2026-01-01', chart: 'express' });
      expect(r.status).toBe(200);
      co[c] = r.body.id;
    }
    // บริษัท B: ลูกค้า + ใบมัดจำของ B (ใช้ทดสอบข้ามบริษัท)
    await select('B');
    const bCus = (await call('POST', '/api/v1/customers', { code: 'T-B01', name: 'ผู้เช่าบริษัทอื่น', tax_id: tid(9) })).body.id;
    const bAi = await call('POST', '/api/v1/ar-deposits', { ...ai(bCus, 1000), doc_type_id: (await call('GET', '/api/v1/trade-defaults/AI')).body.types[0].id });
    expect([bAi.status, bAi.body.error?.message]).toEqual([200, undefined]);
    ids.otherAi = bAi.body.id;

    await select('A');
    const chart = (await call('GET', '/api/v1/gl/accounts')).body as Array<{ id: string; account_no: string }>;
    const acc = (n: string) => chart.find((x) => x.account_no === n)!.id;
    ids.tenant = (await call('POST', '/api/v1/customers', { code: 'R101', name: 'ผู้เช่าห้อง 101', tax_id: tid(1) })).body.id;
    ids.tenant2 = (await call('POST', '/api/v1/customers', { code: 'R102', name: 'ผู้เช่าห้อง 102', tax_id: tid(2) })).body.id;
    for (const [k, code, name, vat] of [['RENT', '90-RENT-000001', 'ค่าเช่าห้อง', '0'], ['UTIL', '90-UTIL-000001', 'ค่าน้ำ/ค่าไฟ', '1'], ['DAMAGE', '90-DAMG-000001', 'ค่าเสียหายห้องพัก', '0']] as const) {
      const r = await call('POST', '/api/v1/services', { code, name_th: name, vat_code: vat, accounts: { revenue: acc('4100-11') } });
      expect([code, r.status, r.body?.error?.message]).toEqual([code, 200, undefined]);
      ids[k] = r.body.id;
    }
    // วิธีจ่ายชำระ: โอนจากบัญชีธนาคาร 1114-02
    const pms = (await call('GET', '/api/v1/payment-methods/P')).body as Array<Record<string, unknown>>;
    const put = await call('PUT', '/api/v1/payment-methods/P', { rows: [...pms.map(({ used: _u, ...r }) => r),
      { seq: String(pms.length + 1).padStart(2, '0'), code: 'TO', name_th: 'โอนออกจากธนาคาร', name_en: null, kind: 'OTHER', creates_cheque: false, gl_account_id: acc('1114-02'), bank_account_id: null, status: 'A' }] });
    expect([put.status, put.body?.error?.message]).toEqual([200, undefined]);
    for (const m of (await call('GET', '/api/v1/payment-methods/P')).body as Array<{ id: string; code: string }>) ids[`pm:${m.code}`] = m.id;
    for (const c of ['AI', 'IV', 'RE', 'PS', 'RD']) ids[`type:${c}`] = (await call('GET', `/api/v1/trade-defaults/${c}`)).body.types[0]?.id;
    expect(ids['type:RD']).toBeTruthy();   // บริษัทใหม่ได้ประเภทเอกสาร RD คืนเงินมัดจำ
    const me = (await call('GET', '/api/v1/auth/me')).body;
    key = (await call('POST', '/api/v1/api-keys', { name: 'WTS-Living', user_id: me.user.id })).body.key;
    expect(key).toMatch(/^bk_/);
  });

  it('AI 9,600 → IV 4,547.16 cash-basis VAT → RE paid fully by deposit: Dr deposit / Cr AR, pending VAT → due', async () => {
    const a = await call('POST', '/api/v1/ar-deposits', ai(ids.tenant, 9600));
    expect([a.status, a.body.error?.message, a.body.net_amount]).toEqual([200, undefined, '9600.00']);
    ids.ai = a.body.id;
    const iv = await call('POST', '/api/v1/sales-invoices', { doc_type_id: ids['type:IV'], doc_date: '2026-07-01', party_id: ids.tenant, price_type: '2', vat_rate: 7, vat_basis: '2',
      lines: [{ item_id: ids.RENT, qty: 1, unit_price: 3500 }, { item_id: ids.UTIL, qty: 1, unit_price: 978.65 }] });
    expect([iv.status, iv.body.error?.message, iv.body.net_amount]).toEqual([200, undefined, '4547.16']);
    ids.iv = iv.body.id;
    expect(await lines(iv.body.id)).toEqual(['1130-02:4547.16:0.00', '2136-02:0.00:68.51', '4100-11:0.00:4478.65'].sort());

    // ยอดชำระจริง = มัดจำ 4,547.16 + เงินสด 0
    const r1 = await call('POST', '/api/v1/ar-receipts', re(ids.iv, '4547.16', [{ header_id: ids.ai, amount: '4547.16' }]));
    expect([r1.status, r1.body.error?.message, r1.body.cash_amount, r1.body.deposit_amount]).toEqual([200, undefined, '0.00', '4547.16']);
    ids.re1 = r1.body.id;
    expect(await lines(r1.body.id)).toEqual(['2135-02:4547.16:0.00', '1130-02:0.00:4547.16', '2136-02:68.51:0.00', '2136-01:0.00:68.51'].sort());
    expect(await remaining()).toBe('5052.84');
    // ภาษีขายถึงกำหนดตอนรับชำระ (แฟ้มภาษีขายของใบเสร็จ 68.51)
    const vat = (await call('GET', `/api/v1/vat/S?header_id=${ids.re1}`)).body;
    expect(JSON.stringify(vat)).toContain('68.51');
    const t = await tb();
    expect([t.balanced, t.of('2136-02'), t.of('2136-01'), t.of('1130-02')]).toEqual([true, '0.00', '-68.51', '0.00']);
    // อ่านใบเสร็จ: แสดงมัดจำที่หัก
    const one = (await call('GET', `/api/v1/ar-receipts/${ids.re1}`)).body;
    expect(one.deposits.map((x: { doc_no: string; amount: string }) => x.amount)).toEqual(['4547.16']);
    expect(one.deposit_amount).toBe('4547.16');
  });

  it('editing the RE counts its own deposit back (no false over-deduction)', async () => {
    const e = await call('PUT', `/api/v1/ar-receipts/${ids.re1}`, re(ids.iv, '4547.16', [{ header_id: ids.ai, amount: '4547.16' }], { remark: 'แก้หมายเหตุ' }));
    expect([e.status, e.body.error?.message]).toEqual([200, undefined]);
    expect(await remaining()).toBe('5052.84');
  });

  it('refuses over-deduction, other customers, PS, VAT deposits and another company\'s AI', async () => {
    // ค่าเสียหาย 300 (ไม่มี VAT)
    const iv2 = await call('POST', '/api/v1/sales-invoices', { doc_type_id: ids['type:IV'], doc_date: '2026-07-31', party_id: ids.tenant, price_type: '0', vat_rate: 0, lines: [{ item_id: ids.DAMAGE, qty: 1, unit_price: 300 }] });
    expect([iv2.status, iv2.body.net_amount]).toEqual([200, '300.00']);
    ids.iv2 = iv2.body.id;
    const over = await call('POST', '/api/v1/ar-receipts', re(ids.iv2, '300', [{ header_id: ids.ai, amount: '5052.85' }]));
    expect([over.status, over.body.error.message]).toEqual([400, expect.stringMatching(/มากกว่ายอดมัดจำคงเหลือ 5052\.84/)]);
    // มัดจำ + เงินโอนเกินยอดบิล → เงินสดติดลบ
    const tooMuch = await call('POST', '/api/v1/ar-receipts', re(ids.iv2, '300', [{ header_id: ids.ai, amount: '300' }], { cash_amount: '10' }));
    expect(tooMuch.status).toBe(400);
    // ใบมัดจำของบริษัทอื่น (ข้ามบริษัท) → ไม่พบ
    const cross = await call('POST', '/api/v1/ar-receipts', re(ids.iv2, '300', [{ header_id: ids.otherAi, amount: '300' }]));
    expect([cross.status, cross.body.error.message]).toEqual([400, expect.stringMatching(/ไม่พบใบรับเงินมัดจำของ R101/)]);
    const crossRd = await call('POST', '/api/v1/ar-deposit-refunds', { ...rd('100'), deposits: [{ header_id: ids.otherAi, amount: '100' }] });
    expect([crossRd.status, crossRd.body.error.message]).toEqual([400, expect.stringMatching(/ไม่พบใบรับเงินมัดจำ/)]);
    // มัดจำของผู้เช่าห้องอื่น
    const other = await call('POST', '/api/v1/ar-deposits', ai(ids.tenant2, 500));
    const wrong = await call('POST', '/api/v1/ar-receipts', re(ids.iv2, '300', [{ header_id: other.body.id, amount: '300' }]));
    expect(wrong.body.error.message).toMatch(/ไม่พบใบรับเงินมัดจำของ R101/);
    // ใบสำคัญจ่ายหักมัดจำรับไม่ได้
    const ps = await call('POST', '/api/v1/ap-payments', { doc_type_id: ids['type:PS'], doc_date: '2026-07-31', party_id: ids.tenant, settlements: [{ invoice_header_id: ids.iv2, amount: '300' }], deposits: [{ header_id: ids.ai, amount: '300' }] });
    expect(ps.status).toBe(400);
    // มัดจำที่มี VAT: หักในใบเสร็จ/คืนไม่ได้ (ภาษีจะถึงกำหนดซ้ำ)
    const vatAi = await call('POST', '/api/v1/ar-deposits', ai(ids.tenant, 1070, { price_type: '1', vat_rate: 7, lines: [{ description: 'มัดจำค่าตกแต่ง', amount: 1070 }] }));
    expect([vatAi.status, vatAi.body.error?.message]).toEqual([200, undefined]);
    ids.vatAi = vatAi.body.id;
    expect((await call('POST', '/api/v1/ar-receipts', re(ids.iv2, '300', [{ header_id: ids.vatAi, amount: '300' }]))).body.error.message).toMatch(/มีภาษีมูลค่าเพิ่ม.*หักในบิลขาย/);
    expect((await call('POST', '/api/v1/ar-deposit-refunds', { ...rd('100'), deposits: [{ header_id: ids.vatAi, amount: '100' }] })).body.error.message).toMatch(/มีภาษีมูลค่าเพิ่ม.*ใบลดหนี้/);
    // ไม่เลือกมัดจำในใบคืนเงิน
    expect((await call('POST', '/api/v1/ar-deposit-refunds', { ...rd('100'), deposits: [] })).body.error.message).toMatch(/เลือกใบมัดจำที่จะคืน/);
    expect(await remaining()).toBe('5052.84');
  });

  it('damages RE by deposit 300 through the external API: X-Source idempotent, source_totals checked', async () => {
    const body = re(ids.iv2, '300', [{ header_id: ids.ai, amount: '300' }]);
    const bad = await send('/api/v1/ar-receipts', { ...body, source_totals: { net_amount: '299.99' } }, 'living:R101:2026-07:DAMAGE-RE');
    expect([bad.status, bad.body.error.code]).toEqual([422, 'AMOUNT_MISMATCH']);
    expect(await remaining()).toBe('5052.84');   // ไม่บันทึกอะไร
    const a = await send('/api/v1/ar-receipts', { ...body, source_totals: { net_amount: '300.00', vat_amount: '0.00' } }, 'living:R101:2026-07:DAMAGE-RE');
    expect([a.status, a.body.error?.message, a.body.deposit_amount]).toEqual([201, undefined, '300.00']);
    const b = await send('/api/v1/ar-receipts', { ...body, source_totals: { net_amount: '300.00' } }, 'living:R101:2026-07:DAMAGE-RE');
    expect([b.status, b.body.id, b.body.duplicate]).toEqual([200, a.body.id, true]);
    ids.re2 = a.body.id;
    expect(await lines(ids.re2)).toEqual(['1130-02:0.00:300.00', '2135-02:300.00:0.00'].sort());
    expect(await remaining()).toBe('4752.84');
  });

  it('refund 4,752.84 by bank → outstanding 0, deposit account 0 · AI cannot be cancelled while used · cancel refund restores', async () => {
    const r = await call('POST', '/api/v1/ar-deposit-refunds', rd('4752.84', { your_ref: 'ย้ายออก 31/07/2569' }));
    expect([r.status, r.body.error?.message, r.body.net_amount, r.body.cash_amount]).toEqual([200, undefined, '4752.84', '0.00']);
    ids.rd = r.body.id;
    expect(r.body.doc_no).toMatch(/^RD\d{7}$/);
    expect(await lines(ids.rd)).toEqual(['1114-02:0.00:4752.84', '2135-02:4752.84:0.00'].sort());
    expect(await remaining()).toBe('0.00');
    expect((await call('GET', `/api/v1/deposits/open?module=AR&party_id=${ids.tenant}`)).body.rows.map((x: { header_id: string }) => x.header_id)).not.toContain(ids.ai);
    let t = await tb();
    expect({ ok: t.balanced, dep: t.of('2135-02'), bank: t.of('1114-02'), cash: t.of('1111-00'), ar: t.of('1130-02'), pend: t.of('2136-02'), vat: t.of('2136-01') })
      .toEqual({ ok: true, dep: '-1500.00', bank: '-4752.84', cash: '11170.00', ar: '0.00', pend: '0.00', vat: '-138.51' });
    // ↑ 2135-02 เหลือเฉพาะมัดจำที่ยังไม่ใช้: ห้อง 102 500 + มัดจำมี VAT 1,000 (1,070 รวม VAT 70 → ภาษีขาย) · ห้อง 101 เหลือ 0 (−9,600 + 4,547.16 + 300 + 4,752.84)
    // เงินสด 9,600 + 500 + 1,070 = 11,170 · ภาษีขาย 68.51 + 70 = 138.51
    // หักในใบเสร็จ/คืนเงินแล้ว → ยกเลิกใบมัดจำไม่ได้
    const ai = (await call('GET', `/api/v1/ar-deposits/${ids.ai}`)).body;
    expect(ai.used_by.map((u: { doc_class: string }) => u.doc_class).sort()).toEqual(['RD', 'RE', 'RE']);
    expect((await call('POST', `/api/v1/ar-deposits/${ids.ai}/cancel`, { reason: 'x' })).body.error.message).toMatch(/หักในบิลแล้วหรือคืนเงินแล้ว/);
    // คืนเกินคงเหลือ
    expect((await call('POST', '/api/v1/ar-deposit-refunds', rd('0.01'))).body.error.message).toMatch(/มากกว่ายอดมัดจำคงเหลือ 0\.00/);
    // ยกเลิกใบคืนเงิน → คงเหลือกลับ 4,752.84 · ใบสำคัญยกเลิก
    expect((await call('POST', `/api/v1/ar-deposit-refunds/${ids.rd}/cancel`, { reason: 'โอนผิดบัญชี' })).status).toBe(200);
    expect(await remaining()).toBe('4752.84');
    t = await tb();
    expect([t.of('1114-02'), t.of('2135-02')]).toEqual(['0.00', '-6252.84']);   // −1,500 − 4,752.84
    // ใบที่ยกเลิกแล้วลบได้ (เลขที่ว่าง)
    expect((await call('POST', `/api/v1/docs/doc/${ids.rd}/delete`, { reason: 'บันทึกซ้ำ' })).status).toBe(200);
  });

  it('refund through the external API (idempotent) → deposit account back to the expected balance', async () => {
    const body = rd('4752.84');
    const bad = await send('/api/v1/ar-deposit-refunds', { ...body, source_totals: { net_amount: '4752.00' } }, 'living:R101:MOVEOUT:REFUND');
    expect([bad.status, bad.body.error.code]).toEqual([422, 'AMOUNT_MISMATCH']);
    const a = await send('/api/v1/ar-deposit-refunds', { ...body, source_totals: { net_amount: '4752.84' } }, 'living:R101:MOVEOUT:REFUND');
    expect([a.status, a.body.error?.message]).toEqual([201, undefined]);
    const b = await send('/api/v1/ar-deposit-refunds', { ...body, source_totals: { net_amount: '4752.84' } }, 'living:R101:MOVEOUT:REFUND');
    expect([b.status, b.body.id, b.body.duplicate]).toEqual([200, a.body.id, true]);
    expect(await remaining()).toBe('0.00');
    const t = await tb();
    expect([t.balanced, t.of('1114-02'), t.of('2135-02')]).toEqual([true, '-4752.84', '-1500.00']);
    // อ่าน/พิมพ์ใบคืนเงินมัดจำ
    const one = (await call('GET', `/api/v1/ar-deposit-refunds/${a.body.id}`)).body;
    expect([one.doc_class, one.deposits[0].doc_no, one.deposits[0].amount, one.source_system]).toEqual(['RD', expect.stringMatching(/^AI/), '4752.84', 'wts-living']);
    const list = (await call('GET', '/api/v1/ar-deposit-refunds?status=N')).body;
    expect(list.rows.map((x: { id: string }) => x.id)).toEqual([a.body.id]);
    const pr = (await call('GET', `/api/v1/print/doc/${a.body.id}`)).body.data;
    expect([pr.title, pr.lines.map((l: { amount: string }) => l.amount), pr.payments.map((p: { amount: string }) => p.amount), pr.totals.at(-1).value]).toEqual(['ใบคืนเงินมัดจำ', ['4752.84'], ['4752.84'], '4752.84']);
    // ใบเสร็จที่ชำระด้วยมัดจำ: พิมพ์ "หักเงินมัดจำ" ในส่วนชำระ
    const pre = (await call('GET', `/api/v1/print/doc/${ids.re1}`)).body.data;
    expect(pre.payments).toEqual([expect.objectContaining({ method: 'หักเงินมัดจำ', amount: '4547.16' })]);
  });

  it('another company cannot read or cancel the refund', async () => {
    await select('B');
    const r = (await call('GET', '/api/v1/ar-deposit-refunds?status=all')).body;
    expect(r.rows).toEqual([]);
    const any = (await call('GET', '/api/v1/ar-receipts')).body.rows;
    expect(any).toEqual([]);
    await select('A');
    const id = (await call('GET', '/api/v1/ar-deposit-refunds?status=N')).body.rows[0].id;
    await select('B');
    expect((await call('GET', `/api/v1/ar-deposit-refunds/${id}`)).status).toBe(404);
    expect((await call('POST', `/api/v1/ar-deposit-refunds/${id}/cancel`, { reason: 'x' })).status).toBe(404);
    await select('A');
  });
});
