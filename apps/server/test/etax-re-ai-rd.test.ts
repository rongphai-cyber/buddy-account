/**
 * e-Tax XML ของ RE (ใบเสร็จรับเงิน/ใบกำกับภาษี) · AI (รับเงินมัดจำที่มี VAT) · RD (คืนเงินมัดจำที่มี VAT = ใบลดหนี้) — HANDOFF ข้อ 89
 * ตัวเลข (คำนวณมือ, VAT 7%):
 *  RE  ภาพ B87: บิลภาษีเกณฑ์เงินสด ค่าเช่า 4,500 (ยกเว้น) + ค่าน้ำ 18 × 10 + ค่าไฟ 80 × 8 = 820 (VAT 57.40) = 5,377.40 · บิลค่าปรับ 107.55 (ไม่มี VAT)
 *      → T03: ฐาน VAT 820.00 · VAT 57.40 · FRE 4,607.55 · รวม 5,484.95 (= ใบพิมพ์ RE = รายการภาษีขายของ RE)
 *  AI  แยก VAT 10,000 + 700 = 10,700 → T03
 *  RD  คืน 4,000 ของ AI ข้างบน → 81: เดิม 10,000 · ที่ถูกต้อง 6,000 · ผลต่าง 4,000 · VAT 280.00 · รวม 4,280.00 · CDNS04 + เหตุผลจากหมายเหตุ
 *  (c) AI รวม VAT 1,000 (VAT 65.42) · RD 333 (VAT 21.79) แล้ว RD 667 (ปิดยอด VAT 65.42 − 21.79 = 43.63) → เดิม 934.58 · ลดครั้งก่อน 311.21 · ที่ถูกต้อง 0.00 · ผลต่าง 623.37
 *  RD คืน 2 ใบมัดจำ (AI 1,000 + 70 และ AI 2,000 + 140 คืนเต็ม) → อ้างใบกำกับเดิม 2 ใบ · ผลต่าง 3,000.00 VAT 210.00
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { openDatabase, type Database } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { readZip } from '../src/zip.js';
import { ETAX_NOT_TAX_INVOICE, taxIdCheckDigit } from '@buddy/core';

const tid = (n: number) => { const b = `0105564${String(n).padStart(5, '0')}`; return b + taxIdCheckDigit(b); };
let database: Database;
let app: FastifyInstance;
let cookie = '';

type Res = { status: number; body: any };   // eslint-disable-line @typescript-eslint/no-explicit-any
async function call(method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown): Promise<Res> {
  const r = await app.inject({ method, url, payload: body as object, headers: cookie ? { cookie } : {} });
  const set = r.headers['set-cookie'];
  if (set) cookie = (Array.isArray(set) ? set[0]! : set).split(';')[0]!;
  const parsed = (() => { if (!r.body) return null; try { return JSON.parse(r.body); } catch { return r.body; } })();
  return { status: r.statusCode, body: parsed };
}
const inOrder = (x: string, parts: string[]) => { let at = 0; for (const s of parts) { const i = x.indexOf(s, at); expect(i, s).toBeGreaterThanOrEqual(0); at = i; } };
const amt = (tag: string, v: string) => `${tag} currencyID="THB">${v}<`;

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

describe('e-Tax XML: RE T03 · AI T03 · RD 81 (HANDOFF ข้อ 89)', () => {
  const ids: Record<string, string> = {};
  const no: Record<string, string> = {};
  const co: Record<string, string> = {};
  const select = (c: string) => call('POST', '/api/v1/auth/select', { company_id: co[c] });
  type Row = { id: string; doc_no: string; doc_class: string; type_code: string; net_amount: string; purpose_code: string | null; errors: string[] };
  const list = async (from: string, to: string) => (await call('GET', `/api/v1/etax/docs?from=${from}&to=${to}`)).body.rows as Row[];
  const xml = async (k: string) => { const r = await call('GET', `/api/v1/etax/doc/${ids[k]}`); expect([k, r.status, typeof r.body === 'string' ? '' : r.body?.error?.message]).toEqual([k, 200, '']); return r.body as string; };
  const ai = (pt: '0' | '1' | '2', amount: number, desc = 'มัดจำค่าตกแต่งร้าน') => ({ doc_type_id: ids['type:AI'], doc_date: '2026-06-15', party_id: ids.cus, price_type: pt, vat_rate: pt === '0' ? 0 : 7,
    lines: [{ description: desc, amount }] });
  const rd = (deps: Array<[string, string]>, remark = 'ยกเลิกสัญญาตกแต่งร้าน คืนเงินมัดจำ') => ({ doc_type_id: ids['type:RD'], doc_date: '2026-07-20', party_id: ids.cus,
    deposits: deps.map(([k, amount]) => ({ header_id: ids[k], amount })), remark });
  const save = async (k: string, path: string, body: unknown) => {
    const r = await call('POST', `/api/v1/${path}`, body);
    expect([k, [200, 201].includes(r.status), r.body?.error?.message]).toEqual([k, true, undefined]);
    ids[k] = r.body.id; no[k] = r.body.doc_no;
    return r.body;
  };

  it('sets up company A (tax ID + address with postcode), a customer, services; company B', async () => {
    expect((await call('POST', '/api/v1/setup', { username: 'admin', display_name: 'ผู้ดูแล', password: 'secret123' })).status).toBe(200);
    for (const [c, name] of [['A', 'บริษัท อีแท็กซ์ ทดสอบ จำกัด'], ['B', 'บริษัท อื่น จำกัด']] as const) {
      const r = await call('POST', '/api/v1/companies', { code: `ETX${c}`, name_th: name, fiscal_start: '2026-01-01', chart: 'express' });
      expect(r.status).toBe(200);
      co[c] = r.body.id;
    }
    await sql`UPDATE sys_company SET tax_id = ${tid(50)}, address_th = '99 ถนนทดสอบ แขวงทดสอบ เขตทดสอบ กรุงเทพฯ 10500' WHERE id = ${co.A!}`.execute(database.db);
    await select('A');
    const chart = (await call('GET', '/api/v1/gl/accounts')).body as Array<{ id: string; account_no: string }>;
    const acc = (n: string) => chart.find((x) => x.account_no === n)!.id;
    ids.cus = (await call('POST', '/api/v1/customers', { code: 'C001', name: 'บริษัท ผู้เช่า จำกัด', tax_id: tid(1), tax_branch_no: '00000', address_1: '12 ซอยผู้เช่า กรุงเทพฯ', zip_code: '10110' })).body.id;
    for (const [k, code, name, vat] of [['RENT', '90-RENT-000001', 'ค่าเช่าห้อง', '0'], ['WATER', '90-WATR-000001', 'ค่าน้ำ', '1'], ['ELEC', '90-ELEC-000001', 'ค่าไฟ', '1'], ['LATE', '90-LATE-000001', 'ค่าปรับชำระล่าช้า', '0']] as const) {
      const r = await call('POST', '/api/v1/services', { code, name_th: name, vat_code: vat, accounts: { revenue: acc('4100-11') } });
      expect([code, r.status, r.body?.error?.message]).toEqual([code, 200, undefined]);
      ids[k] = r.body.id;
    }
    for (const c of ['IV', 'RE', 'AI', 'RD']) ids[`type:${c}`] = (await call('GET', `/api/v1/trade-defaults/${c}`)).body.types[0]?.id;
  });

  it('RE settling a cash-basis VAT bill exports as T03: 820.00 / 57.40 / exempt 4,607.55 / 5,484.95 = RE print = VAT report row', async () => {
    const iv = await save('iv', 'sales-invoices', { doc_type_id: ids['type:IV'], doc_date: '2026-05-01', party_id: ids.cus, price_type: '2', vat_rate: 7, vat_basis: '2',
      lines: [{ item_id: ids.RENT, qty: 1, unit_price: 4500 }, { item_id: ids.WATER, qty: 18, unit_price: 10 }, { item_id: ids.ELEC, qty: 80, unit_price: 8 }] });
    expect(iv.net_amount).toBe('5377.40');
    await save('late', 'sales-invoices', { doc_type_id: ids['type:IV'], doc_date: '2026-05-20', party_id: ids.cus, price_type: '0', vat_rate: 0, lines: [{ item_id: ids.LATE, qty: 1, unit_price: 107.55 }] });
    await save('re', 'ar-receipts', { doc_type_id: ids['type:RE'], doc_date: '2026-05-20', party_id: ids.cus,
      settlements: [{ invoice_header_id: ids.iv, amount: '5377.40', vat_amount: '57.40' }, { invoice_header_id: ids.late, amount: '107.55' }] });

    // รายการ: RE = T03 · บิลภาษีเกณฑ์เงินสด (พิมพ์ "ใบแจ้งหนี้") ไม่อยู่ในรายการ · บิลค่าปรับไม่มี VAT = T02 ยกเว้นภาษีเหมือนเดิม
    const rows = await list('2026-05-01', '2026-05-31');
    expect(rows.map((r) => `${r.doc_no}:${r.type_code}:${r.net_amount}:${r.errors.length}`)).toEqual([`${no.late}:T02:107.55:0`, `${no.re}:T03:5484.95:0`]);
    const cb = await call('GET', `/api/v1/etax/doc/${ids.iv}`);
    expect([cb.status, cb.body.error.message]).toEqual([400, expect.stringContaining(ETAX_NOT_TAX_INVOICE.IV)]);

    const x = await xml('re');
    inOrder(x, ['<rsm:TaxInvoice_CrossIndustryInvoice', `<ram:ID>${no.re}</ram:ID>`, '<ram:Name>ใบเสร็จรับเงิน/ใบกำกับภาษี', '<ram:TypeCode>T03', '<ram:IssueDateTime>2026-05-20T00:00:00',
      'schemeID="TXID">' + tid(50) + '00000', '<ram:PostcodeCode>10500', 'BuyerTradeParty', 'schemeID="TXID">' + tid(1) + '00000', '<ram:PostcodeCode>10110',
      '<ram:TypeCode>VAT', '<ram:CalculatedRate>7', amt('ram:BasisAmount', '820.00'), amt('ram:CalculatedAmount', '57.40'), '<ram:TypeCode>FRE', amt('ram:BasisAmount', '4607.55'),
      amt('ram:LineTotalAmount', '5427.55'), amt('ram:TaxBasisTotalAmount', '5427.55'), amt('ram:TaxTotalAmount', '57.40'), amt('ram:GrandTotalAmount', '5484.95'),
      'ค่าเช่าห้อง', amt('ram:NetLineTotalAmount', '4500.00'), 'ค่าน้ำ', 'unitCode="EA">18<', amt('ram:NetLineTotalAmount', '180.00'), 'ค่าไฟ', amt('ram:NetLineTotalAmount', '640.00'),
      'ค่าปรับชำระล่าช้า', amt('ram:NetLineTotalAmount', '107.55')]);
    expect(x).not.toContain('DueDateDateTime');

    // ใบพิมพ์ RE และรายการภาษีขายของ RE ยอดเดียวกัน
    const p = (await call('GET', `/api/v1/print/doc/${ids.re}`)).body.data;
    const tot = Object.fromEntries(p.totals.map((t: { label: string; value: string }) => [t.label, t.value]));
    expect([p.title, tot['มูลค่าสินค้า/บริการที่มีภาษีมูลค่าเพิ่ม'], tot['ภาษีมูลค่าเพิ่ม 7%'], tot['มูลค่าที่ไม่มีภาษีมูลค่าเพิ่ม'], tot['รวมยอดชำระ']]).toEqual(['ใบเสร็จรับเงิน/ใบกำกับภาษี', '820.00', '57.40', '4607.55', '5484.95']);
    const vat = (await call('GET', `/api/v1/vat/S?header_id=${ids.re}`)).body.rows as Array<{ base_amount: string; vat_amount: string; tax_invoice_no: string }>;
    expect(vat.map((r) => `${r.tax_invoice_no}:${r.base_amount}:${r.vat_amount}`)).toEqual([`${no.re}:820.00:57.40`]);
  });

  it('RE without VAT is not a tax invoice: not listed, single export refused with the Thai reason', async () => {
    await save('ivPlain', 'sales-invoices', { doc_type_id: ids['type:IV'], doc_date: '2026-05-25', party_id: ids.cus, price_type: '0', vat_rate: 0, lines: [{ item_id: ids.RENT, qty: 1, unit_price: 3500 }] });
    await save('rePlain', 'ar-receipts', { doc_type_id: ids['type:RE'], doc_date: '2026-05-26', party_id: ids.cus, settlements: [{ invoice_header_id: ids.ivPlain, amount: '3500' }] });
    expect((await list('2026-05-01', '2026-05-31')).some((r) => r.id === ids.rePlain)).toBe(false);
    const r = await call('GET', `/api/v1/etax/doc/${ids.rePlain}`);
    expect([r.status, r.body.error.message]).toEqual([400, `สร้างแฟ้ม e-Tax ของ ${no.rePlain} ไม่ได้: ${ETAX_NOT_TAX_INVOICE.RE}`]);
  });

  it('AI with VAT exports as T03 (deposit description, 10,000 + 700); AI without VAT is refused', async () => {
    await save('a', 'ar-deposits', ai('2', 10000));
    await save('c', 'ar-deposits', ai('1', 1000, 'มัดจำค่าป้าย'));
    await save('m1', 'ar-deposits', ai('2', 1000, 'มัดจำงวดที่ 1'));
    await save('m2', 'ar-deposits', ai('2', 2000, 'มัดจำงวดที่ 2'));
    await save('novat', 'ar-deposits', ai('0', 500, 'มัดจำไม่มีภาษี'));
    const rows = await list('2026-06-01', '2026-06-30');
    expect(rows.map((r) => `${r.doc_no}:${r.doc_class}:${r.type_code}:${r.net_amount}:${r.errors.length}`).sort()).toEqual([
      `${no.a}:AI:T03:10700.00:0`, `${no.c}:AI:T03:1000.00:0`, `${no.m1}:AI:T03:1070.00:0`, `${no.m2}:AI:T03:2140.00:0`].sort());
    inOrder(await xml('a'), ['<ram:Name>ใบเสร็จรับเงิน/ใบกำกับภาษี', '<ram:TypeCode>T03', '<ram:TypeCode>VAT', amt('ram:BasisAmount', '10000.00'), amt('ram:CalculatedAmount', '700.00'),
      amt('ram:LineTotalAmount', '10000.00'), amt('ram:TaxBasisTotalAmount', '10000.00'), amt('ram:GrandTotalAmount', '10700.00'), 'มัดจำค่าตกแต่งร้าน', amt('ram:NetLineTotalAmount', '10000.00')]);
    // รวม VAT 1,000: ฐาน 934.58 VAT 65.42 ราคาต่อหน่วยไม่รวม VAT (1,000 × 100/107 ทศนิยม 4 ตำแหน่ง แบบเดียวกับบิลขาย)
    inOrder(await xml('c'), [amt('ram:BasisAmount', '934.58'), amt('ram:CalculatedAmount', '65.42'), amt('ram:GrandTotalAmount', '1000.00'), 'มัดจำค่าป้าย', amt('ram:ChargeAmount', '934.5794'), amt('ram:NetLineTotalAmount', '934.58')]);
    const r = await call('GET', `/api/v1/etax/doc/${ids.novat}`);
    expect([r.status, r.body.error.message]).toEqual([400, `สร้างแฟ้ม e-Tax ของ ${no.novat} ไม่ได้: ${ETAX_NOT_TAX_INVOICE.AI}`]);
  });

  it('RD with VAT = credit note 81: AI reference (T03), original/correct/difference, VAT 280.00, CDNS04 + remark; (c) exact remainder 43.63', async () => {
    await save('rd1', 'ar-deposit-refunds', rd([['a', '4000']]));
    await save('rd333', 'ar-deposit-refunds', rd([['c', '333']]));
    const last = await save('rd667', 'ar-deposit-refunds', rd([['c', '667']], 'ยกเลิกสัญญาทำป้าย'));
    expect(last.vat_amount).toBe('43.63');
    const rows = (await list('2026-07-01', '2026-07-31')).filter((r) => r.doc_class === 'RD');
    expect(rows.map((r) => `${r.doc_no}:${r.type_code}:${r.purpose_code}:${r.net_amount}:${r.errors.length}`)).toEqual([`${no.rd1}:81:CDNS04:4280.00:0`, `${no.rd333}:81:CDNS04:333.00:0`, `${no.rd667}:81:CDNS04:667.00:0`]);
    const x = await xml('rd1');
    inOrder(x, ['<rsm:DebitCreditNote_CrossIndustryInvoice', '<ram:Name>ใบลดหนี้', '<ram:TypeCode>81', '<ram:Purpose>ยกเลิกสัญญาตกแต่งร้าน คืนเงินมัดจำ', '<ram:PurposeCode>CDNS04',
      'AdditionalReferencedDocument', `<ram:IssuerAssignedID>${no.a}`, '<ram:IssueDateTime>2026-06-15T00:00:00', '<ram:ReferenceTypeCode>T03',
      amt('ram:BasisAmount', '4000.00'), amt('ram:CalculatedAmount', '280.00'), amt('ram:OriginalInformationAmount', '10000.00'), amt('ram:LineTotalAmount', '6000.00'),
      amt('ram:DifferenceInformationAmount', '4000.00'), amt('ram:TaxBasisTotalAmount', '4000.00'), amt('ram:TaxTotalAmount', '280.00'), amt('ram:GrandTotalAmount', '4280.00'),
      `คืนเงินมัดจำตามใบกำกับภาษี ${no.a} ลงวันที่ 15/06/2569`, amt('ram:NetLineTotalAmount', '4000.00')]);
    expect(x.match(/<ram:AdditionalReferencedDocument>/g)?.length).toBe(1);
    expect(x).not.toContain('AllowanceTotalAmount');
    // ใบพิมพ์ RD ยอดเดียวกัน
    const pr = (await call('GET', `/api/v1/print/doc/${ids.rd1}`)).body.data;
    expect(pr.totals.map((t: { label: string; value: string }) => `${t.label}=${t.value}`)).toEqual(['มูลค่าตามใบกำกับภาษีเดิม=10000.00', 'มูลค่าที่ถูกต้อง=6000.00', 'ผลต่าง=4000.00', 'ภาษีมูลค่าเพิ่มของผลต่าง 7%=280.00', 'รวมเงินคืนทั้งสิ้น=4280.00']);
    // (c) ใบปิดยอด: ลดครั้งก่อน 311.21 → ที่ถูกต้อง 0.00
    inOrder(await xml('rd667'), ['<ram:Purpose>ยกเลิกสัญญาทำป้าย', amt('ram:BasisAmount', '623.37'), amt('ram:CalculatedAmount', '43.63'), amt('ram:OriginalInformationAmount', '934.58'),
      amt('ram:LineTotalAmount', '0.00'), amt('ram:DifferenceInformationAmount', '623.37'), amt('ram:TaxTotalAmount', '43.63'), amt('ram:GrandTotalAmount', '667.00')]);
    const p6 = (await call('GET', `/api/v1/print/doc/${ids.rd667}`)).body.data;
    expect(p6.totals.slice(0, 5).map((t: { value: string }) => t.value)).toEqual(['934.58', '311.21', '0.00', '623.37', '43.63']);
    // ฉบับแรกของ (c): ที่ถูกต้อง 934.58 − 311.21 = 623.37
    inOrder(await xml('rd333'), [amt('ram:CalculatedAmount', '21.79'), amt('ram:OriginalInformationAmount', '934.58'), amt('ram:LineTotalAmount', '623.37'), amt('ram:DifferenceInformationAmount', '311.21')]);
  });

  it('RD refunding two AIs references both original tax invoices; RD without VAT refused', async () => {
    const both = await save('rdBoth', 'ar-deposit-refunds', rd([['m1', '1000'], ['m2', '2000']]));
    expect([both.vat_amount, both.net_amount]).toEqual(['210.00', '3210.00']);
    const x = await xml('rdBoth');
    expect(x.match(/<ram:AdditionalReferencedDocument>/g)?.length).toBe(2);
    inOrder(x, [`<ram:IssuerAssignedID>${no.m1}`, '<ram:ReferenceTypeCode>T03', `<ram:IssuerAssignedID>${no.m2}`, '<ram:ReferenceTypeCode>T03', amt('ram:OriginalInformationAmount', '3000.00'),
      amt('ram:LineTotalAmount', '0.00'), amt('ram:DifferenceInformationAmount', '3000.00'), amt('ram:TaxTotalAmount', '210.00'), amt('ram:GrandTotalAmount', '3210.00'),
      `ใบกำกับภาษี ${no.m1}`, amt('ram:NetLineTotalAmount', '1000.00'), `ใบกำกับภาษี ${no.m2}`, amt('ram:NetLineTotalAmount', '2000.00')]);
    await save('rdPlain', 'ar-deposit-refunds', rd([['novat', '500']], ''));
    expect((await list('2026-07-01', '2026-07-31')).some((r) => r.id === ids.rdPlain)).toBe(false);
    const r = await call('GET', `/api/v1/etax/doc/${ids.rdPlain}`);
    expect([r.status, r.body.error.message]).toEqual([400, `สร้างแฟ้ม e-Tax ของ ${no.rdPlain} ไม่ได้: ${ETAX_NOT_TAX_INVOICE.RD}`]);
  });

  it('zip export: period = VAT documents only; selected non-VAT docs are skipped with the reason; logged', async () => {
    const z = await app.inject({ method: 'GET', url: '/api/v1/etax/export?from=2026-05-01&to=2026-07-31', headers: { cookie } });
    expect([z.statusCode, z.headers['content-type']]).toEqual([200, 'application/zip']);
    const files = readZip(z.rawPayload);
    const names = [...files.keys()];
    for (const f of [`T03_${no.re}.xml`, `T03_${no.a}.xml`, `81_${no.rd1}.xml`, `81_${no.rdBoth}.xml`, `T02_${no.late}.xml`, 'สรุป.csv']) expect(names, f).toContain(f);
    for (const f of [no.iv, no.rePlain, no.novat, no.rdPlain]) expect(names.some((n) => n.endsWith(`_${f}.xml`)), f).toBe(false);
    expect(files.get(`T03_${no.re}.xml`)!.toString('utf8')).toBe((await call('GET', `/api/v1/etax/doc/${ids.re}`)).body);
    // เลือกเอง: RE ไม่มี VAT + RD ไม่มี VAT ข้ามพร้อมเหตุผลใน สรุป.csv · AI ที่มี VAT ได้แฟ้ม
    const sel = await app.inject({ method: 'GET', url: `/api/v1/etax/export?from=2026-05-01&to=2026-07-31&ids=${ids.rePlain},${ids.rdPlain},${ids.a}`, headers: { cookie } });
    expect(sel.statusCode).toBe(200);
    const sf = readZip(sel.rawPayload);
    expect([...sf.keys()].sort()).toEqual([`T03_${no.a}.xml`, 'สรุป.csv'].sort());
    const csv = sf.get('สรุป.csv')!.toString('utf8');
    expect(csv).toContain(`${no.rePlain},2026-05-26,T03,"บริษัท ผู้เช่า จำกัด",3500.00,"ข้าม: ${ETAX_NOT_TAX_INVOICE.RE}"`);
    expect(csv).toContain(`"ข้าม: ${ETAX_NOT_TAX_INVOICE.RD}"`);
    expect(csv).toContain(`${no.a},2026-06-15,T03,"บริษัท ผู้เช่า จำกัด",10700.00,สร้างแฟ้มแล้ว`);
    const log = await database.db.selectFrom('sys_activity_log').select(['action', 'doc_no']).where('company_id', '=', co.A!).where('action', '=', 'ETAX_EXPORT').execute();
    // RE เปิดรายฉบับ 2 ครั้ง (ข้อแรก + เทียบกับแฟ้มใน zip) · zip 2 ครั้ง
    expect(log.filter((l) => l.doc_no === no.re).length).toBe(2);
    expect(log.filter((l) => !l.doc_no).length).toBe(2);
  });

  it('company B cannot list, open or export company A documents', async () => {
    await select('B');
    expect(await list('2026-05-01', '2026-07-31')).toEqual([]);
    for (const k of ['re', 'a', 'rd1', 'rdBoth']) expect([k, (await call('GET', `/api/v1/etax/doc/${ids[k]}`)).status]).toEqual([k, 404]);
    const x = await call('GET', `/api/v1/etax/export?from=2026-05-01&to=2026-07-31&ids=${ids.re},${ids.a},${ids.rd1}`);
    expect([x.status, x.body.error.message]).toEqual([400, expect.stringMatching(/ไม่มีเอกสารขาย/)]);
    await select('A');
  });
});
