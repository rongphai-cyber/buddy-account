/**
 * ตั้งค่าสำหรับ WTS-Living + ฟีดบัญชีของประเภทเอกสาร/รหัสรายได้ + ยอดยกมาที่ลงบัญชี (HANDOFF ข้อ 86)
 *
 * ผังบัญชีมาตรฐาน (express) — บัญชีที่ปุ่มสร้าง (เลขต่อจากบัญชีพี่น้อง คิดไว้ก่อน):
 *   เงินประกันผู้เช่า 2135-04 (ใต้ 2135-00 เงินมัดจำรับ: 01–03 มีแล้ว) · รายได้ค่าส่วนกลางรับล่วงหน้า 2133-02 (ใต้ 2133-00: มี 01)
 *   เงินกองทุนจากสมาชิก 3400-00 · บัญชีพักยอดยกมา 3500-00 (ใต้ 3000-00: 3100 3200 3300 มีแล้ว)
 *   รายได้ค่าเช่า 4200-60 · ค่าน้ำค่าไฟ 4200-70 · ค่าส่วนกลาง 4200-80 · ค่าบริการอื่น 4200-90 (ใต้ 4200-00: 10–50 มีแล้ว)
 *   รายได้ค่าปรับ 4300-07 · รายได้ค่าเสียหาย 4300-08 (ใต้ 4300-00: 01–06 มีแล้ว)
 *
 * ยอดยกมาที่ลงบัญชี (ปีบัญชีเริ่ม 01/01/2569 · ค.ศ. 2026):
 *   สำนักงานบัญชีบันทึกยอดยกมาทั้งชุดจากระบบเดิม (ลูกหนี้/เงินประกันของ WTS-Living ใส่ที่บัญชีพักยอดยกมาแทน):
 *     Dr 1111-00 เงินสด 6,220.00 / Cr 2136-02 ภาษีขายรอเรียกเก็บ 70.00 / Cr 3500-00 บัญชีพักยอดยกมา 6,150.00 (= ลูกหนี้ 2,250 − เงินประกัน 8,400)
 *   OB-1 ลูกหนี้ยกมา 31/12/2568 1,180.00 ไม่มี VAT              Dr 1130-02 1,180.00 / Cr 3500-00 1,180.00
 *   OB-2 ลูกหนี้ยกมา 31/12/2568 1,070.00 (VAT ยังไม่ถึงกำหนด 70) Dr 1130-02 1,070.00 / Cr 3500-00 1,070.00 — ไม่มีบรรทัดภาษี (ภาษีขายรอเรียกเก็บอยู่ในยอดยกมาแล้ว)
 *        รับชำระ 10/01/2569 (RE เงินสด 1,070)                      Dr 1111-00 1,070 / Cr 1130-02 1,070 · Dr 2136-02 70 / Cr 2136-01 70
 *   DP-1 เงินประกันยกมา 31/12/2568 8,400.00                      Dr 3500-00 8,400.00 / Cr 2135-04 8,400.00
 *        คืนเงินประกัน 31/01/2569 (RD เงินสด 8,400)                Dr 2135-04 8,400 / Cr 1111-00 8,400 → มัดจำคงเหลือ 0
 *   ยอดยกมา 01/01/2569: 1130-02 = 2,250.00 · 3500-00 = −6,150 − 1,180 − 1,070 + 8,400 = 0.00 · 2136-02 = −70.00 · 2135-04 = −8,400.00 · 1111-00 = 6,220.00
 *   ยอดยกไป 31/12/2569: 1130-02 = 1,180.00 · 3500-00 = 0.00 · 2136-02 = 0.00 · 2136-01 = −70.00 · 2135-04 = 0.00 · 1111-00 = 6,220 + 1,070 − 8,400 = −1,110.00
 *   OB-3 ลูกหนี้ยกมาลงวันที่หลังวันเริ่มใช้ 31/03/2569 500.00 (Living เริ่มใช้ทีหลัง) → ใบสำคัญเดือนมีนาคม (ยกเลิกในทดสอบ)
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { openDatabase, type Database } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

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
async function keyCall(method: 'GET' | 'POST', url: string, body?: unknown, ref?: string) {
  const headers: Record<string, string> = { authorization: `Bearer ${key}` };
  if (ref) Object.assign(headers, { 'x-source-system': 'wts-living', 'x-source-ref': ref, 'x-source-version': '1' });
  const r = await app.inject({ method, url, payload: body as object, headers });
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

type Row = { group: string; key: string; code: string; status: string; account?: { no: string; name: string } | null };
describe('ตั้งค่าสำหรับ WTS-Living', () => {
  const co: Record<string, string> = {};
  const select = (c: string) => call('POST', '/api/v1/auth/select', { company_id: co[c] });
  const acc = async (no: string) => ((await call('GET', '/api/v1/gl/accounts')).body as Array<{ id: string; account_no: string }>).find((x) => x.account_no === no)?.id;
  const count = async (t: 'gl_account' | 'md_doc_type' | 'md_item' | 'md_payment_method', c: string) =>
    Number((await sql<{ n: string }>`SELECT count(*)::text AS n FROM ${sql.table(t)} WHERE company_id = ${co[c]} AND deleted_at IS NULL`.execute(database.db)).rows[0]!.n);

  it('sets up two companies (express / th_en charts), a clerk, and an API key', async () => {
    expect((await call('POST', '/api/v1/setup', { username: 'admin', display_name: 'ผู้ดูแล', password: 'secret123' })).status).toBe(200);
    for (const [c, chart] of [['A', 'express'], ['B', 'th_en']] as const) {
      const r = await call('POST', '/api/v1/companies', { code: `LV${c}`, name_th: `หอพักทดสอบ ${c}`, fiscal_start: '2026-01-01', chart });
      expect(r.status).toBe(200);
      co[c] = r.body.id;
    }
    await select('A');
    const tenant_id = (await call('GET', '/api/v1/tenants')).body.find((t: { code: string }) => t.code === 'DEFAULT').id;
    expect((await call('POST', '/api/v1/users', { tenant_id, username: 'lvclerk', display_name: 'พนักงาน ระดับ 9', password: 'lvclerk99', approval_level: 9, companies: [co.A, co.B] })).status).toBe(200);
    const me = (await call('GET', '/api/v1/auth/me')).body;
    key = (await call('POST', '/api/v1/api-keys', { name: 'WTS-Living', user_id: me.user.id })).body.key;
  });

  it('shows the checklist without changing anything: accounts it will create and which account each uses', async () => {
    await select('A');
    const before = await count('gl_account', 'A');
    const r = await call('GET', '/api/v1/company/wts-living-setup');
    expect(r.status).toBe(200);
    const rows = r.body.rows as Row[];
    const accounts = Object.fromEntries(rows.filter((x) => x.group === 'account').map((x) => [x.key, `${x.status}:${x.code}`]));
    expect(accounts).toEqual({
      deposit: 'create:2135-04', advance: 'create:2133-02', prepaid: 'create:2133-03', fund: 'create:3400-00', opening: 'create:3500-00',
      rent: 'create:4200-60', utility: 'create:4200-70', common: 'create:4200-80', service: 'create:4200-90', penalty: 'create:4300-07', damage: 'create:4300-08',
    });
    const by = (code: string) => rows.find((x) => x.code === code)!;
    expect([by('AIL').status, by('AIL').account?.no, by('IVL').status, by('REL').status, by('RDL').status]).toEqual(['create', '2135-04', 'create', 'create', 'create']);
    expect([by('ADL').status, by('ADL').account?.no]).toEqual(['create', '2133-03']);
    expect([by('LVDP').account?.no, by('50-LIVR-ADVC').account?.no, by('50-LIVR-FUND').account?.no, by('50-LIVR-UTIL').account?.no]).toEqual(['2135-04', '2133-02', '3400-00', '4200-70']);
    expect([by('OPENING_BALANCE').status, by('LV').status, by('gen.allow_blank_party_tax_id').status]).toEqual(['set', 'create', 'set']);
    expect([r.body.blocked, await count('gl_account', 'A')]).toEqual([0, before]);
  });

  it('only an admin of the company, from the screen: a clerk and an API key are refused', async () => {
    const admin = cookie;
    cookie = ''; await call('POST', '/api/v1/auth/login', { username: 'lvclerk', password: 'lvclerk99' });
    await select('A');
    const r = await call('POST', '/api/v1/company/wts-living-setup', {});
    expect([r.status, r.body.error.message]).toEqual([403, expect.stringMatching(/ผู้ดูแลระบบ/)]);
    cookie = admin;
    expect((await keyCall('POST', '/api/v1/company/wts-living-setup', {})).status).toBe(403);
    expect((await keyCall('GET', '/api/v1/company/wts-living-setup')).status).toBe(403);
    expect((await sql<{ n: string }>`SELECT count(*)::text AS n FROM md_doc_type WHERE company_id = ${co.A} AND code = 'IVL' AND deleted_at IS NULL`.execute(database.db)).rows[0]!.n).toBe('0');
  });

  it('creates whatever is missing in one go, logs it, and a second press creates nothing', async () => {
    await select('A');
    const r = await call('POST', '/api/v1/company/wts-living-setup', {});
    expect([r.status, r.body.error?.message, r.body.blocked]).toEqual([200, undefined, 0]);
    expect(r.body.created).toEqual(expect.arrayContaining(['account:2135-04', 'account:3500-00', 'role:OPENING_BALANCE', 'book:LV', 'doc_type:IVL', 'doc_type:AIL', 'payment_method:LVDP', 'item:50-LIVR-RENT', 'setting:gen.allow_blank_party_tax_id']));
    expect(r.body.created).toHaveLength(11 + 1 + 1 + 5 + 1 + 8 + 1);
    const q = await sql<{ code: string; doc_class: string; vat_basis: string | null; is_tax_invoice: boolean; slot3: string | null; book: string | null }>`
      SELECT t.code, t.doc_class, t.vat_basis, t.is_tax_invoice, (SELECT g.account_no FROM md_doc_type_account x JOIN gl_account g ON g.id = x.account_id WHERE x.doc_type_id = t.id AND x.slot = 3 AND x.deleted_at IS NULL) AS slot3,
             (SELECT b.code FROM gl_journal_book b WHERE b.id = t.journal_book_id) AS book
        FROM md_doc_type t WHERE t.company_id = ${co.A} AND t.code IN ('IVL', 'REL', 'AIL', 'RDL', 'ADL') ORDER BY t.code`.execute(database.db);
    expect(q.rows).toEqual([
      { code: 'ADL', doc_class: 'AI', vat_basis: null, is_tax_invoice: false, slot3: '2133-03', book: '02' },
      { code: 'AIL', doc_class: 'AI', vat_basis: null, is_tax_invoice: false, slot3: '2135-04', book: '02' },
      { code: 'IVL', doc_class: 'IV', vat_basis: '2', is_tax_invoice: false, slot3: null, book: '03' },
      { code: 'RDL', doc_class: 'RD', vat_basis: null, is_tax_invoice: false, slot3: null, book: '01' },
      { code: 'REL', doc_class: 'RE', vat_basis: null, is_tax_invoice: true, slot3: null, book: '02' },
    ]);
    const items = await sql<{ code: string; item_type: string; vat_code: string; no: string }>`SELECT i.code, i.item_type, i.vat_code, a.account_no AS no FROM md_item i JOIN md_item_account_group g ON g.id = i.account_group_id JOIN gl_account a ON a.id = g.sales_account_id
      WHERE i.company_id = ${co.A} AND i.code LIKE '50-LIVR-%' ORDER BY i.code`.execute(database.db);
    expect(items.rows.map((x) => `${x.code}:${x.item_type}:${x.vat_code}:${x.no}`)).toEqual([
      '50-LIVR-ADVC:3:0:2133-02', '50-LIVR-COMM:3:0:4200-80', '50-LIVR-DMG:3:0:4300-08', '50-LIVR-FUND:3:0:3400-00',
      '50-LIVR-LATE:3:0:4300-07', '50-LIVR-RENT:3:0:4200-60', '50-LIVR-SERV:3:1:4200-90', '50-LIVR-UTIL:3:0:4200-70',
    ]);
    const pm = (await sql<{ no: string }>`SELECT a.account_no AS no FROM md_payment_method p JOIN gl_account a ON a.id = p.gl_account_id WHERE p.company_id = ${co.A} AND p.code = 'LVDP' AND p.direction = 'R'`.execute(database.db)).rows;
    expect(pm).toEqual([{ no: '2135-04' }]);
    expect((await sql<{ v: unknown }>`SELECT value AS v FROM sys_setting WHERE company_id = ${co.A} AND key = 'gen.allow_blank_party_tax_id' AND deleted_at IS NULL`.execute(database.db)).rows[0]?.v).toBe(true);
    const log = (await sql<{ n: string }>`SELECT count(*)::text AS n FROM sys_activity_log WHERE company_id = ${co.A} AND action = 'WTS_LIVING_SETUP'`.execute(database.db)).rows[0]!.n;
    expect(log).toBe('1');
    // กดซ้ำ: ไม่สร้างอะไร ทุกรายการ "มีแล้ว"
    const n = await count('gl_account', 'A');
    const again = await call('POST', '/api/v1/company/wts-living-setup', {});
    expect([again.body.created, again.body.create, await count('gl_account', 'A')]).toEqual([[], 0, n]);
    expect((again.body.rows as Row[]).every((x) => x.status === 'exists')).toBe(true);
  });

  it('another company: nothing was created there · existing records with the agreed codes/names are used, not overwritten', async () => {
    await select('B');
    const plan = (await call('GET', '/api/v1/company/wts-living-setup')).body.rows as Row[];
    expect(plan.filter((x) => x.status === 'exists' && x.group !== 'customer')).toEqual([]);
    // ผังไทย–อังกฤษ: ใช้บัญชีชื่อ "เงินประกันผู้เช่า" ที่มีอยู่ + ประเภทเอกสาร AIL เดิม (ช่องบัญชีอื่น) ไม่ถูกแก้
    const parent = ((await call('GET', '/api/v1/gl/accounts')).body as Array<{ id: string; account_no: string; level: number }>).find((x) => x.account_no === '2130-00')!;
    const mine = await call('POST', '/api/v1/gl/accounts', { account_no: '2130-50', name_th: 'เงินประกันผู้เช่า', parent_id: parent.id, level: parent.level + 1, account_group: '2', is_control: false });
    expect(mine.status).toBe(200);
    const other = await acc('2134-00');
    expect((await call('POST', '/api/v1/doc-types', { code: 'AIL', doc_class: 'AI', name_th: 'มัดจำของเดิม', next_no: '1', accounts: [{ slot: 3, account_id: other }] })).status).toBe(200);
    const r = await call('POST', '/api/v1/company/wts-living-setup', {});
    expect([r.status, r.body.blocked]).toEqual([200, 0]);
    const rows = r.body.rows as Row[];
    const by = (k: string) => rows.find((x) => x.key === k || x.code === k)!;
    // บัญชีเงินประกัน = ช่อง 3 ของ AIL เดิม (ของที่ผูกอยู่ก่อน) · ไม่สร้าง 2133-03 · AIL ชื่อเดิม
    expect([by('deposit').status, by('deposit').code, by('AIL').status, by('AIL').account?.no, by('LVDP').account?.no]).toEqual(['exists', '2134-00', 'exists', '2134-00', '2134-00']);
    expect((await sql<{ name_th: string }>`SELECT name_th FROM md_doc_type WHERE company_id = ${co.B} AND code = 'AIL'`.execute(database.db)).rows).toEqual([{ name_th: 'มัดจำของเดิม' }]);
    // th_en: ไม่มีบัญชีคุม "รายได้จากการให้บริการ" → ใต้บัญชีขายเชื่อ 4100-00 · ส่วนของผู้ถือหุ้น 3000-00 มีถึง 3500-00
    expect([by('rent').code, by('utility').code, by('fund').code, by('opening').code, by('advance').code]).toEqual(['4100-07', '4100-08', '3600-00', '3700-00', '2133-03']);
    // A ไม่เปลี่ยน
    await select('A');
    expect((await call('GET', '/api/v1/company/wts-living-setup')).body.create).toBe(0);
  });

  it('the feed carries the accounts of doc types and income codes, the role accounts and the journal books (additive)', async () => {
    await select('A');
    const full = await keyCall('GET', '/api/v1/changes?types=doc_type,item,default_account,journal_book');
    expect(full.status).toBe(200);
    type Ch = { type: string; id: string; data: Record<string, unknown> };
    const ch = full.body.changes as Ch[];
    const ail = ch.find((x) => x.type === 'doc_type' && x.data.code === 'AIL')!;
    const dep = await acc('2135-04');
    expect(ail.data).toMatchObject({ code: 'AIL', doc_class: 'AI', accounts: [{ slot: 3, role: 'DEPOSIT_RECEIVED', account_id: dep }] });
    expect(ch.find((x) => x.type === 'doc_type' && x.data.code === 'IVL')!.data).toMatchObject({ vat_basis: '2', accounts: [] });
    expect(ch.find((x) => x.type === 'item' && x.data.code === '50-LIVR-ADVC')!.data.revenue_account_id).toBe(await acc('2133-02'));
    expect(ch.find((x) => x.type === 'default_account' && x.data.role === 'OPENING_BALANCE')!.data.account_id).toBe(await acc('3500-00'));
    expect(ch.find((x) => x.type === 'journal_book' && x.data.code === 'LV')!.data).toMatchObject({ prefix: 'LV', name_th: 'สมุดรายวัน WTS-Living' });
    // ข้ามบริษัท: ฟีดของกุญแจนี้ไม่มีของบริษัท B
    const bAil = (await sql<{ id: string }>`SELECT id FROM md_doc_type WHERE company_id = ${co.B} AND code = 'AIL'`.execute(database.db)).rows[0]!.id;
    expect(ch.some((x) => x.id === bAil)).toBe(false);
    // แก้เฉพาะบัญชีของประเภทเอกสาร (แถว md_doc_type_account) → ฟีดรอบถัดไปส่ง AIL ใหม่
    const cursor = full.body.next_cursor as string;
    const opening = await acc('3500-00');
    await sql`UPDATE md_doc_type_account SET account_id = ${opening!} WHERE doc_type_id = ${ail.id} AND slot = 3`.execute(database.db);
    const next = await keyCall('GET', `/api/v1/changes?types=doc_type&since=${cursor}`);
    expect((next.body.changes as Ch[]).map((x) => [x.data.code, (x.data.accounts as Array<{ account_id: string }>)[0]?.account_id])).toEqual([['AIL', opening]]);
    await sql`UPDATE md_doc_type_account SET account_id = ${dep!} WHERE doc_type_id = ${ail.id} AND slot = 3`.execute(database.db);
  });
});

describe('ยอดยกมาที่ลงบัญชี (ลูกหนี้/เงินประกันยกมาจาก WTS-Living)', () => {
  const ids: Record<string, string> = {};
  const lines = async (id: string | undefined) => ((await call('GET', `/api/v1/docs/${id}/journal`)).body.journals.filter((j: { doc_status: string }) => j.doc_status === 'N')
    .flatMap((j: { voucher_date: string; lines: Array<{ account_no: string; debit: string; credit: string }> }) => j.lines.map((l) => `${String(j.voucher_date).slice(0, 10)} ${l.account_no}:${l.debit}:${l.credit}`))).sort();
  const tb = async () => {
    const r = (await call('GET', '/api/v1/reports/trial-balance?from=2026-01-01&to=2026-12-31')).body as { balanced: boolean; rows: Array<{ account_no: string; closing: string; opening: string }> };
    return { balanced: r.balanced, closing: (no: string) => r.rows.find((x) => x.account_no === no)?.closing ?? '0.00', opening: (no: string) => r.rows.find((x) => x.account_no === no)?.opening ?? '0.00' };
  };
  const ob = (extra: Record<string, unknown>) => ({ party_id: ids.tenant, doc_date: '2025-12-31', price_type: '1', amount: '1180', vat_rate: '0', ...extra });

  it('a receivable brought forward posts Dr AR (of the IV type) / Cr the opening account — not income, no VAT', async () => {
    // สำนักงานบัญชี: ยอดยกมาทั้งชุดจากระบบเดิม — ส่วนลูกหนี้/เงินประกันของ Living อยู่ที่บัญชีพักยอดยกมา
    const no = async (n: string) => ((await call('GET', '/api/v1/gl/accounts')).body as Array<{ id: string; account_no: string }>).find((x) => x.account_no === n)!.id;
    const opening = await call('PUT', '/api/v1/gl/opening', { period_start: '2026-01-01', rows: [
      { account_id: await no('1111-00'), debit: '6220.00', credit: '0' },
      { account_id: await no('2136-02'), debit: '0', credit: '70.00' },
      { account_id: await no('3500-00'), debit: '0', credit: '6150.00' },
    ] });
    expect([opening.status, opening.body.error?.message]).toEqual([200, undefined]);
    ids.tenant = (await call('POST', '/api/v1/customers', { code: 'LV00001', name: 'ผู้เช่าห้อง 101' })).body.id;
    ids.ivl = (await call('GET', '/api/v1/trade-defaults/IV')).body.types.find((t: { code: string }) => t.code === 'IVL').id;
    ids.ail = (await call('GET', '/api/v1/trade-defaults/AI')).body.types.find((t: { code: string }) => t.code === 'AIL').id;
    const r = await keyCall('POST', '/api/v1/ar-opening', { ...ob({ doc_no: 'OB-1', doc_type_id: ids.ivl, post_gl: true }), source_totals: { net_amount: '1180.00', vat_amount: '0.00' } }, 'liv:TST:OB:OB-1');
    expect([r.status, r.body.error?.message]).toEqual([201, undefined]);
    ids.ob1 = r.body.id;
    expect(r.body.journal_id).toBeTruthy();
    expect(await lines(ids.ob1)).toEqual(['2025-12-31 1130-02:1180.00:0.00', '2025-12-31 3500-00:0.00:1180.00']);
    expect((await sql<{ n: string }>`SELECT count(*)::text AS n FROM tax_vat_entry WHERE header_id = ${ids.ob1} AND deleted_at IS NULL`.execute(database.db)).rows[0]!.n).toBe('0');
    // ส่งซ้ำ: เอกสารเดิม ใบสำคัญเดียว
    const again = await keyCall('POST', '/api/v1/ar-opening', ob({ doc_no: 'OB-1', doc_type_id: ids.ivl, post_gl: true }), 'liv:TST:OB:OB-1');
    expect([again.status, again.body.duplicate]).toEqual([200, true]);
    expect((await sql<{ n: string }>`SELECT count(*)::text AS n FROM gl_journal WHERE source_header_id = ${ids.ob1} AND deleted_at IS NULL`.execute(database.db)).rows[0]!.n).toBe('1');
  });

  it('VAT not yet due is not posted again (it is in the opening balances) and becomes due at the receipt', async () => {
    const r = await call('POST', '/api/v1/ar-opening', ob({ doc_no: 'OB-2', amount: '1070', vat_amount: '70', post_gl: true }));
    expect([r.status, r.body.error?.message]).toEqual([200, undefined]);
    ids.ob2 = r.body.id;
    expect(await lines(ids.ob2)).toEqual(['2025-12-31 1130-02:1070.00:0.00', '2025-12-31 3500-00:0.00:1070.00']);
    const reType = (await call('GET', '/api/v1/trade-defaults/RE')).body?.types?.[0]?.id ?? (await sql<{ id: string }>`SELECT id FROM md_doc_type WHERE company_id = (SELECT company_id FROM doc_header WHERE id = ${ids.ob2}) AND code = 'REL'`.execute(database.db)).rows[0]!.id;
    const re = await call('POST', '/api/v1/ar-receipts', { doc_type_id: reType, doc_date: '2026-01-10', party_id: ids.tenant, settlements: [{ invoice_header_id: ids.ob2, amount: '1070' }] });
    expect([re.status, re.body.error?.message]).toEqual([200, undefined]);
    expect(await lines(re.body.id)).toEqual(['2026-01-10 1111-00:1070.00:0.00', '2026-01-10 1130-02:0.00:1070.00', '2026-01-10 2136-01:0.00:70.00', '2026-01-10 2136-02:70.00:0.00']);
  });

  it('a deposit brought forward: Dr the opening account / Cr the deposit of AIL, then refunded with RD to zero', async () => {
    const r = await keyCall('POST', '/api/v1/ar-deposit-opening', { party_id: ids.tenant, doc_no: 'DP-1', doc_date: '2025-12-31', price_type: '0', amount: '8400', vat_rate: '0', doc_type_id: ids.ail, post_gl: true, source_totals: { net_amount: '8400.00' } }, 'liv:TST:AI-OB:DP-1');
    expect([r.status, r.body.error?.message]).toEqual([201, undefined]);
    ids.dp1 = r.body.id;
    expect(await lines(ids.dp1)).toEqual(['2025-12-31 2135-04:0.00:8400.00', '2025-12-31 3500-00:8400.00:0.00']);
    expect((await call('GET', `/api/v1/ar-deposit-opening/${ids.dp1}`)).body.outstanding).toBe('8400.00');
    // มีภาษีไม่รับ · ยกเลิกไม่ได้เมื่อคืนเงินแล้ว
    expect((await call('POST', '/api/v1/ar-deposit-opening', { party_id: ids.tenant, doc_no: 'DP-X', doc_date: '2025-12-31', price_type: '1', amount: '1070', vat_rate: '7', post_gl: true })).body.error.message).toMatch(/มี VAT/);
    const rd = await call('POST', '/api/v1/ar-deposit-refunds', { doc_type_id: (await call('GET', '/api/v1/trade-defaults/RD')).body?.types?.[0]?.id, doc_date: '2026-01-31', party_id: ids.tenant, deposits: [{ header_id: ids.dp1, amount: '8400' }], cash_amount: '8400' });
    expect([rd.status, rd.body.error?.message]).toEqual([200, undefined]);
    expect((await call('GET', `/api/v1/ar-deposit-opening/${ids.dp1}`)).body.outstanding).toBe('0.00');
    const cancel = await call('POST', `/api/v1/ar-deposit-opening/${ids.dp1}/cancel`, { reason: 'ทดสอบ' });
    expect([cancel.status, cancel.body.error.message]).toEqual([400, expect.stringMatching(/ใบคืนเงินมัดจำ/)]);
  });

  it('the trial balance: the opening clearing account comes to 0, the rest as computed by hand, balanced', async () => {
    const t = await tb();
    expect(t.balanced).toBe(true);
    expect(['1130-02', '3500-00', '2136-02', '2135-04', '1111-00'].map(t.opening)).toEqual(['2250.00', '0.00', '-70.00', '-8400.00', '6220.00']);
    expect(['1130-02', '3500-00', '2136-02', '2136-01', '2135-04', '1111-00'].map(t.closing)).toEqual(['1180.00', '0.00', '0.00', '-70.00', '0.00', '-1110.00']);
  });

  it('rules: the opening account must be a balance-sheet sub-account of this company · dated after the start = an open period', async () => {
    const income = (await call('GET', '/api/v1/gl/accounts')).body.find((x: { account_no: string }) => x.account_no === '4200-60').id;
    expect((await call('POST', '/api/v1/ar-opening', ob({ doc_no: 'OB-9', post_gl: true, offset_account_id: income }))).body.error.message).toMatch(/ไม่ใช่รายได้ปีนี้/);
    const ctl = (await call('GET', '/api/v1/gl/accounts')).body.find((x: { account_no: string }) => x.account_no === '3000-00').id;
    expect((await call('POST', '/api/v1/ar-opening', ob({ doc_no: 'OB-9', post_gl: true, offset_account_id: ctl }))).body.error.message).toMatch(/บัญชีคุม/);
    const otherCo = (await sql<{ id: string }>`SELECT a.id FROM gl_account a JOIN sys_company c ON c.id = a.company_id WHERE c.code = 'LVB' AND a.account_no = '3200-00'`.execute(database.db)).rows[0]!.id;
    expect((await call('POST', '/api/v1/ar-opening', ob({ doc_no: 'OB-9', post_gl: true, offset_account_id: otherCo }))).body.error.message).toMatch(/ไม่พบบัญชีคู่/);
    // แบบเดิม (ไม่ลงบัญชี) ยังต้องก่อนวันเริ่มใช้ · ลงบัญชีหลังวันเริ่มใช้ได้
    expect((await call('POST', '/api/v1/ar-opening', ob({ doc_no: 'OB-3', doc_date: '2026-03-31', amount: '500' }))).body.error.message).toMatch(/ก่อนวันเริ่มใช้/);
    const late = await call('POST', '/api/v1/ar-opening', ob({ doc_no: 'OB-3', doc_date: '2026-03-31', amount: '500', post_gl: true }));
    expect([late.status, late.body.error?.message]).toEqual([200, undefined]);
    expect(await lines(late.body.id)).toEqual(['2026-03-31 1130-02:500.00:0.00', '2026-03-31 3500-00:0.00:500.00']);
    // เจ้าหนี้ยกมาไม่ลงบัญชีแบบนี้
    expect((await call('POST', '/api/v1/ap-opening', { party_id: ids.tenant, doc_no: 'AP-1', doc_date: '2025-12-31', price_type: '1', amount: '100', vat_rate: '0', post_gl: true })).body.error.message).toMatch(/เฉพาะลูกหนี้/);
    // แก้เป็นไม่ลงบัญชี → ใบสำคัญถูกยกเลิก · ยกเลิกเอกสาร → ใบสำคัญยกเลิก ยอดหาย
    const cancel = await call('POST', `/api/v1/ar-opening/${late.body.id}/cancel`, { reason: 'ทดสอบยกเลิก' });
    expect(cancel.status).toBe(200);
    expect(await lines(late.body.id)).toEqual([]);
    const ed = await call('PUT', `/api/v1/ar-opening/${ids.ob1}`, ob({ doc_no: 'OB-1', doc_type_id: ids.ivl, post_gl: false }));
    expect(ed.status).toBe(403);   // มาจาก WTS-Living — แก้ที่ต้นทาง
    const t = await tb();
    expect([t.closing('1130-02'), t.balanced]).toEqual(['1180.00', true]);
    const logs = (await sql<{ n: string }>`SELECT count(*)::text AS n FROM sys_activity_log WHERE table_name = 'doc_header' AND row_id = ${late.body.id} AND action IN ('ADD', 'CANCEL')`.execute(database.db)).rows[0]!.n;
    expect(logs).toBe('2');
  });
});
