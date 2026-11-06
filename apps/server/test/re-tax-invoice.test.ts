/**
 * ใบเสร็จรับเงิน/ใบกำกับภาษีของ Buddy = ใบกำกับภาษีตัวจริงของ WTS-Living (docs/19 ข้อ 3 4 · HANDOFF ข้อ 87)
 * ตัวเลข (คำนวณมือ):
 *  IV  ค่าเช่า 3,500 (ยกเว้น VAT) + น้ำ/ไฟ 978.65 (VAT 7% = 68.5055 → 68.51) ภาษีเกณฑ์เงินสด = 4,547.16
 *  IV  ค่าปรับ 107.55 (ไม่มี VAT)
 *  RE  ตัดทั้งสองใบ 4,547.16 + 107.55 = 4,654.71 → ภาษีถึงกำหนด 68.51 · มูลค่าที่มี VAT 978.65 · มูลค่าที่ไม่มี VAT 3,500 + 107.55 = 3,607.55
 *  รายงานภาษีขายของ RE: ฐาน 978.65 ภาษี 68.51 (= ที่พิมพ์บน RE)
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

type Res = { status: number; body: any };   // eslint-disable-line @typescript-eslint/no-explicit-any
async function call(method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown): Promise<Res> {
  const r = await app.inject({ method, url, payload: body as object, headers: cookie ? { cookie } : {} });
  const set = r.headers['set-cookie'];
  if (set) cookie = (Array.isArray(set) ? set[0]! : set).split(';')[0]!;
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
}
async function withKey(key: string, method: 'GET' | 'POST', url: string, body?: unknown, h: Record<string, string> = {}): Promise<Res> {
  const r = await app.inject({ method, url, payload: body as object, headers: { authorization: `Bearer ${key}`, ...h } });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
}
const living = (ref: string) => ({ 'x-source-system': 'wts-living', 'x-source-ref': ref });

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

describe('RE = ใบเสร็จรับเงิน/ใบกำกับภาษีเต็มรูป + กุญแจ API ของ WTS-Living ดึงไปพิมพ์', () => {
  const ids: Record<string, string> = {};
  const keys: Record<string, string> = {};
  const co: Record<string, string> = {};
  const select = (c: string) => call('POST', '/api/v1/auth/select', { company_id: co[c] });

  it('sets up company A (tax ID, address) with a tenant, services and keys; company B with its own key', async () => {
    expect((await call('POST', '/api/v1/setup', { username: 'admin', display_name: 'ผู้ดูแล', password: 'secret123' })).status).toBe(200);
    for (const [c, name] of [['A', 'บริษัท ลิฟวิ่ง ทดสอบ จำกัด'], ['B', 'บริษัท อื่น จำกัด']] as const) {
      const r = await call('POST', '/api/v1/companies', { code: `RTI${c}`, name_th: name, fiscal_start: '2026-01-01', chart: 'express' });
      expect(r.status).toBe(200);
      co[c] = r.body.id;
    }
    const me = (await call('GET', '/api/v1/auth/me')).body;
    await select('B');
    keys.B = (await call('POST', '/api/v1/api-keys', { name: 'WTS-Living B', user_id: me.user.id })).body.key;
    await select('A');
    const c = (await call('GET', '/api/v1/company')).body;
    const put = await call('PUT', '/api/v1/company', { ...c, tax_id: tid(50), address_th_1: '99 ถนนทดสอบ แขวงทดสอบ', address_th_2: 'เขตทดสอบ กรุงเทพฯ', tax_branch_no: '0' });
    expect([put.status, put.body?.error?.message]).toEqual([200, undefined]);
    const chart = (await call('GET', '/api/v1/gl/accounts')).body as Array<{ id: string; account_no: string }>;
    const acc = (n: string) => chart.find((x) => x.account_no === n)!.id;
    ids.tenant = (await call('POST', '/api/v1/customers', { code: 'LV0001', name: 'บริษัท ผู้เช่า จำกัด', tax_id: tid(1), tax_branch_no: '00000', address_1: '12 ซอยผู้เช่า', address_2: 'กรุงเทพฯ 10110' })).body.id;
    for (const [k, code, name, vat] of [['RENT', '90-RENT-000001', 'ค่าเช่าห้อง', '0'], ['UTIL', '90-UTIL-000001', 'ค่าน้ำ/ค่าไฟ', '1'], ['LATE', '90-LATE-000001', 'ค่าปรับชำระล่าช้า', '0']] as const) {
      const r = await call('POST', '/api/v1/services', { code, name_th: name, vat_code: vat, accounts: { revenue: acc('4100-11') } });
      expect([code, r.status, r.body?.error?.message]).toEqual([code, 200, undefined]);
      ids[k] = r.body.id;
    }
    for (const t of ['IV', 'RE']) ids[`type:${t}`] = (await call('GET', `/api/v1/trade-defaults/${t}`)).body.types[0]?.id;
    keys.A = (await call('POST', '/api/v1/api-keys', { name: 'WTS-Living', user_id: me.user.id })).body.key;
    const bound = await call('POST', '/api/v1/api-keys', { name: 'WTS-Living ผูกระบบ', user_id: me.user.id, source_system: 'wts-living' });
    keys.bound = bound.body.key;
    ids.boundKey = bound.body.id;
    keys.all = (await call('POST', '/api/v1/api-keys', { name: 'รายงานกลาง', user_id: me.user.id, doc_scope: 'A' })).body.key;
    expect((await call('POST', '/api/v1/api-keys', { name: 'ผิด', user_id: me.user.id, source_system: 'WTS Living' })).status).toBe(400);
    const list = (await call('GET', '/api/v1/api-keys')).body as Array<{ name: string; source_system: string | null; doc_scope: string }>;
    expect(list.map((k) => `${k.name}:${k.source_system}:${k.doc_scope}`).sort()).toEqual(['WTS-Living:null:S', 'WTS-Living ผูกระบบ:wts-living:S', 'รายงานกลาง:null:A'].sort());
  });

  it('Living sends IV (cash-basis VAT) + IV late fee + RE; the IV prints as "ใบแจ้งหนี้", the RE as a full tax invoice', async () => {
    const iv = await withKey(keys.A!, 'POST', '/api/v1/sales-invoices', { doc_type_id: ids['type:IV'], doc_date: '2026-05-01', party_id: ids.tenant, price_type: '2', vat_rate: 7, vat_basis: '2',
      lines: [{ item_id: ids.RENT, qty: 1, unit_price: 3500 }, { item_id: ids.UTIL, qty: 1, unit_price: 978.65 }] }, living('liv:T:IV:B6905-001'));
    expect([iv.status, iv.body.error?.message, iv.body.net_amount]).toEqual([201, undefined, '4547.16']);
    ids.iv = iv.body.id;
    const late = await withKey(keys.A!, 'POST', '/api/v1/sales-invoices', { doc_type_id: ids['type:IV'], doc_date: '2026-05-20', party_id: ids.tenant, price_type: '0', vat_rate: 0,
      lines: [{ item_id: ids.LATE, qty: 1, unit_price: 107.55 }] }, living('liv:T:IV-LATE:R6905-001'));
    expect([late.status, late.body.net_amount]).toEqual([201, '107.55']);
    ids.late = late.body.id;
    const re = await withKey(keys.A!, 'POST', '/api/v1/ar-receipts', { doc_type_id: ids['type:RE'], doc_date: '2026-05-20', party_id: ids.tenant,
      settlements: [{ invoice_header_id: ids.iv, amount: '4547.16', vat_amount: '68.51' }, { invoice_header_id: ids.late, amount: '107.55' }] }, living('liv:T:RE:R6905-001'));
    expect([re.status, re.body.error?.message, re.body.net_amount]).toEqual([201, undefined, '4654.71']);
    ids.re = re.body.id;

    // บิลภาษีเกณฑ์เงินสด: ใบกำกับภาษีคือ RE → บิลไม่มีคำว่า "ใบกำกับภาษี"
    const pIv = (await call('GET', `/api/v1/print/doc/${ids.iv}`)).body.data;
    expect([pIv.title, pIv.title_en]).toEqual(['ใบแจ้งหนี้', 'INVOICE']);

    const p = (await call('GET', `/api/v1/print/doc/${ids.re}`)).body.data;
    // (1) คำว่าใบกำกับภาษี
    expect([p.title, p.title_en, p.receipt_tax]).toEqual(['ใบเสร็จรับเงิน/ใบกำกับภาษี', 'RECEIPT / TAX INVOICE', true]);
    // (2) ผู้ขาย: ชื่อ ที่อยู่ เลขประจำตัว + สำนักงานใหญ่
    expect(p.company).toMatchObject({ name: 'บริษัท ลิฟวิ่ง ทดสอบ จำกัด', tax_id: tid(50), branch: 'สำนักงานใหญ่' });
    expect(p.company.address).toContain('99 ถนนทดสอบ');
    // (3) ผู้ซื้อ: ชื่อ ที่อยู่ เลขประจำตัว + สาขา
    expect(p.party).toMatchObject({ name: 'บริษัท ผู้เช่า จำกัด', tax_id: tid(1), branch: 'สำนักงานใหญ่' });
    expect(p.party.address).toContain('12 ซอยผู้เช่า');
    // (4)(7) เลขที่ วันที่
    expect([p.doc_no, p.doc_date.slice(0, 10)]).toEqual([re.body.doc_no, '2026-05-20']);
    // (5) รายการบริการ จำนวน มูลค่า (บรรทัดของบิลที่ชำระ)
    expect(p.detail.map((x: { kind: string; name: string; ref_amount: string }) => `${x.kind}:${x.name}:${x.ref_amount}`)).toEqual([
      `bill:ขายเงินเชื่อ:4547.16`, 'item:ค่าเช่าห้อง  1  × 3,500.00:3500.00', 'item:ค่าน้ำ/ค่าไฟ  1  × 978.65:978.65', `bill:ขายเงินเชื่อ:107.55`, 'item:ค่าปรับชำระล่าช้า  1  × 107.55:107.55']);
    // (6) ภาษีแยกจากมูลค่า + อัตรา · มูลค่าที่ไม่มี VAT แยกบรรทัด
    const tot = Object.fromEntries(p.totals.map((t: { label: string; value: string }) => [t.label, t.value]));
    expect(tot).toMatchObject({ 'รวมยอดชำระ': '4654.71', 'มูลค่าสินค้า/บริการที่มีภาษีมูลค่าเพิ่ม': '978.65', 'ภาษีมูลค่าเพิ่ม 7%': '68.51', 'มูลค่าที่ไม่มีภาษีมูลค่าเพิ่ม': '3607.55', 'ยอดสุทธิ': '4654.71' });
    expect(p.amount_text).toBe('สี่พันหกร้อยห้าสิบสี่บาทเจ็ดสิบเอ็ดสตางค์');

    // ภาษีที่พิมพ์ = รายการภาษีขายของ RE
    const vat = (await call('GET', `/api/v1/vat/S?header_id=${ids.re}`)).body;
    expect(vat.rows.map((r: { base_amount: string; vat_amount: string; tax_invoice_no: string }) => `${r.tax_invoice_no}:${r.base_amount}:${r.vat_amount}`)).toEqual([`${re.body.doc_no}:978.65:68.51`]);
    expect([vat.totals.base, vat.totals.vat]).toEqual([tot['มูลค่าสินค้า/บริการที่มีภาษีมูลค่าเพิ่ม'], tot['ภาษีมูลค่าเพิ่ม 7%']]);
    // ค่าเช่าที่ยกเว้น VAT ในบิลเดียวกันอยู่ช่องยกเว้น ไม่ใช่ฐานภาษี (เดิมฐาน = 4,547.16 − 68.51 = 4,478.65)
    expect(vat.totals.exempt).toBe('3500.00');
  });

  it('an RE with no VAT stays an ordinary receipt', async () => {
    const iv = await withKey(keys.A!, 'POST', '/api/v1/sales-invoices', { doc_type_id: ids['type:IV'], doc_date: '2026-06-01', party_id: ids.tenant, price_type: '0', vat_rate: 0,
      lines: [{ item_id: ids.RENT, qty: 1, unit_price: 3500 }] }, living('liv:T:IV:B6906-001'));
    const re = await withKey(keys.A!, 'POST', '/api/v1/ar-receipts', { doc_type_id: ids['type:RE'], doc_date: '2026-06-05', party_id: ids.tenant, settlements: [{ invoice_header_id: iv.body.id, amount: '3500' }] }, living('liv:T:RE:R6906-001'));
    expect(re.status).toBe(201);
    const p = (await call('GET', `/api/v1/print/doc/${re.body.id}`)).body.data;
    expect([p.title, p.receipt_tax, p.totals.some((t: { label: string }) => /ภาษีมูลค่าเพิ่ม/.test(t.label))]).toEqual(['ใบเสร็จรับเงิน', false, false]);
    expect((await call('GET', `/api/v1/vat/S?header_id=${re.body.id}`)).body.rows).toEqual([]);
  });

  it('GET /api/v1/docs/:id/print: the key\'s own source only — first fetch = ต้นฉบับ, then สำเนา, logged, nothing else changes', async () => {
    const before = (await call('GET', `/api/v1/ar-receipts/${ids.re}`)).body;
    const r1 = await withKey(keys.A!, 'GET', `/api/v1/docs/${ids.re}/print`, undefined, { 'x-source-system': 'wts-living' });
    expect([r1.status, r1.body.error?.message, r1.body.copy, r1.body.doc_status, r1.body.data.title, r1.body.data.source_system]).toEqual([200, undefined, 'ต้นฉบับ', 'N', 'ใบเสร็จรับเงิน/ใบกำกับภาษี', 'wts-living']);
    expect(r1.body.data.totals.find((t: { label: string }) => t.label === 'ภาษีมูลค่าเพิ่ม 7%').value).toBe('68.51');
    const r2 = await withKey(keys.bound!, 'GET', `/api/v1/docs/${ids.re}/print`, undefined, { 'x-source-system': 'wts-living' });
    expect([r2.status, r2.body.copy, r2.body.data.print_count]).toEqual([200, 'สำเนา', 2]);
    // เอกสาร/บัญชีไม่เปลี่ยน (นับเฉพาะจำนวนครั้งที่พิมพ์ เหมือนปุ่มพิมพ์ของ Buddy)
    const after = (await call('GET', `/api/v1/ar-receipts/${ids.re}`)).body;
    expect([after.net_amount, after.doc_status, after.doc_no, after.journal_id ?? null]).toEqual([before.net_amount, before.doc_status, before.doc_no, before.journal_id ?? null]);
    // log: PRINT แล้ว REPRINT ผ่าน API
    const info = (await call('GET', `/api/v1/record-info/doc/${ids.re}`)).body;
    expect(info.log.filter((l: { action: string }) => /PRINT/.test(l.action)).map((l: { action: string }) => l.action)).toEqual(['REPRINT', 'PRINT']);
    expect(info.print_count).toBe(2);
    const log = (await database.db.selectFrom('sys_activity_log').select(['action', 'detail']).where('row_id', '=', ids.re!).where('action', 'in', ['PRINT', 'REPRINT']).execute());
    expect(log.map((l) => (typeof l.detail === 'string' ? JSON.parse(l.detail) : l.detail)).map((x: { via: string; system: string; copy: string }) => `${x.via}:${x.system}:${x.copy}`).sort()).toEqual(['api:wts-living:ต้นฉบับ', 'api:wts-living:สำเนา']);
  });

  it('refuses: other company (404), other source (404), Buddy-keyed doc (404), bound key in another system\'s name (403), no header (400), session (400)', async () => {
    const ok = { 'x-source-system': 'wts-living' };
    // ข้ามบริษัท: กุญแจบริษัท B ไม่เห็นเอกสารของ A
    expect((await withKey(keys.B!, 'GET', `/api/v1/docs/${ids.re}/print`, undefined, ok)).status).toBe(404);
    // ข้ามระบบ: อ้างเป็น wts-pos ไม่เห็นเอกสารที่ wts-living ส่ง
    expect((await withKey(keys.A!, 'GET', `/api/v1/docs/${ids.re}/print`, undefined, { 'x-source-system': 'wts-pos' })).status).toBe(404);
    // กุญแจที่ผูก wts-living อ้างเป็นระบบอื่นไม่ได้
    const mm = await withKey(keys.bound!, 'GET', `/api/v1/docs/${ids.re}/print`, undefined, { 'x-source-system': 'wts-pos' });
    expect([mm.status, mm.body.error.code]).toEqual([403, 'SOURCE_MISMATCH']);
    // เอกสารที่คีย์ใน Buddy (ไม่มีระบบต้นทาง)
    const own = await call('POST', '/api/v1/sales-invoices', { doc_type_id: ids['type:IV'], doc_date: '2026-06-10', party_id: ids.tenant, price_type: '0', vat_rate: 0, lines: [{ item_id: ids.RENT, qty: 1, unit_price: 100 }] });
    expect(own.status).toBe(200);
    expect((await withKey(keys.A!, 'GET', `/api/v1/docs/${own.body.id}/print`, undefined, ok)).status).toBe(404);
    // ขอบเขตทุกเอกสาร (doc_scope A) เห็นได้ ไม่ต้องส่ง X-Source-System
    expect((await withKey(keys.all!, 'GET', `/api/v1/docs/${own.body.id}/print`)).status).toBe(200);
    // ไม่ส่ง X-Source-System (ขอบเขต S) · ไม่มีเอกสาร · หน้าจอ (cookie)
    expect((await withKey(keys.A!, 'GET', `/api/v1/docs/${ids.re}/print`)).body.error.code).toBe('BAD_SOURCE');
    expect((await withKey(keys.A!, 'GET', `/api/v1/docs/00000000-0000-4000-8000-000000000000/print`, undefined, ok)).status).toBe(404);
    expect((await call('GET', `/api/v1/docs/${ids.re}/print`)).status).toBe(400);
    // ตั้งขอบเขตทีหลัง (log API_KEY_SCOPE) แล้วใช้ได้ทันที
    const sc = await call('PUT', `/api/v1/api-keys/${ids.boundKey}/scope`, { source_system: 'wts-pos', doc_scope: 'S' });
    expect([sc.status, sc.body?.error?.message]).toEqual([200, undefined]);
    expect((await withKey(keys.bound!, 'GET', `/api/v1/docs/${ids.re}/print`, undefined, ok)).body.error.code).toBe('SOURCE_MISMATCH');
    const lg = await database.db.selectFrom('sys_activity_log').select('action').where('row_id', '=', ids.boundKey!).where('action', '=', 'API_KEY_SCOPE').execute();
    expect(lg.length).toBe(1);
    // บริษัทอื่นแก้ขอบเขตกุญแจของ A ไม่ได้
    await select('B');
    expect((await call('PUT', `/api/v1/api-keys/${ids.boundKey}/scope`, { source_system: null, doc_scope: 'A' })).status).toBe(404);
  });
});
