/**
 * HANDOFF ข้อ 91: หน้าจอเงินมัดจำยกมา · บัญชีค่าปรับ/ดอกเบี้ยรับต่อประเภทเอกสาร RE · กันลูกหนี้ยกมาลงบัญชีซ้ำกับยอดยกมาที่คีย์ไว้
 *
 * ผังบัญชีมาตรฐาน (express) + ปุ่ม "ตั้งค่าสำหรับ WTS-Living" (บัญชีพักยอดยกมา 3500-00 · เงินประกันผู้เช่า 2135-04 = ช่อง 3 ของ AIL · รายได้ค่าปรับ 4300-07)
 * ปีบัญชีเริ่ม 01/01/2569 (ค.ศ. 2026) · ลูกหนี้ของลูกค้า = 1130-02 · เงินสด 1111-00 · ดอกเบี้ยรับมาตรฐาน (บัญชีเพื่อลงรายวัน INTEREST_INCOME) = 4300-01
 *
 * 1. เงินมัดจำยกมาที่คีย์ที่ Buddy:
 *    DO-1 31/12/2568 5,000.00   Dr 3500-00 5,000.00 / Cr 2135-04 5,000.00 (ไม่มี VAT)
 *    ตัวอย่างการลงบัญชี DO-P 3,000.00 → Dr 3500-00 3,000.00 / Cr 2135-04 3,000.00 · ไม่บันทึกอะไร
 *    RD คืน 1,200.00 จาก DO-1 → ใช้แล้ว 1,200.00 คงเหลือ 3,800.00 · ยกเลิก DO-1 ไม่ได้ · ยกเลิก RD แล้ว → ยกเลิก DO-1 ได้ → ลบได้ เลขที่ว่าง
 *    WTS-Living ส่ง DP-L1 4,000.00 → ที่มา wts-living · หน้าจอแก้ไม่ได้ (403 SOURCE_LOCKED)
 * 2. ค่าปรับชำระล่าช้าในใบเสร็จ (interest_amount) 107.55:
 *    ประเภท REX ช่อง 7 = 4300-07: ตัดลูกหนี้ยกมา 1,000.00 + ค่าปรับ 107.55 → Dr 1111-00 1,107.55 / Cr 1130-02 1,000.00 / Cr 4300-07 107.55
 *    ประเภท REL ช่อง 7 ว่าง:                                  → Dr 1111-00 1,107.55 / Cr 1130-02 1,000.00 / Cr 4300-01 107.55
 * 3. กันลงบัญชีซ้ำ:
 *    ยอดยกมาที่คีย์ Dr 1111-00 2,500 / Cr 3500-00 2,500 (ไม่มีบัญชีลูกหนี้) → OB-G1 1,180.00 post_gl รับ: Dr 1130-02 1,180.00 / Cr 3500-00 1,180.00
 *    ยอดยกมาที่คีย์ Dr 1130-02 2,500 / Cr 3500-00 2,500 → OB-G2 post_gl = 409 OPENING_ALREADY_KEYED (ไม่บันทึก) · OB-G1 รุ่น 2 = 409 · post_gl false = รับ (ไม่มีใบสำคัญ)
 *    บริษัท B (ไม่มียอดยกมาที่คีย์) post_gl = รับ
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { openDatabase, type Database } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { buildApp } from '../src/app.js';
import { loadConfig, REPO_ROOT } from '../src/config.js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

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
async function keyCall(method: 'GET' | 'POST', url: string, body: unknown, ref: string, version = 1) {
  const headers = { authorization: `Bearer ${key}`, 'x-source-system': 'wts-living', 'x-source-ref': ref, 'x-source-version': String(version) };
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

const co: Record<string, string> = {};
const ids: Record<string, string> = {};
const select = (c: string) => call('POST', '/api/v1/auth/select', { company_id: co[c] });
const acc = async (no: string) => ((await call('GET', '/api/v1/gl/accounts')).body as Array<{ id: string; account_no: string }>).find((x) => x.account_no === no)!.id;
const lines = async (id: string | undefined) => ((await call('GET', `/api/v1/docs/${id}/journal`)).body.journals.filter((j: { doc_status: string }) => j.doc_status === 'N')
  .flatMap((j: { lines: Array<{ account_no: string; debit: string; credit: string }> }) => j.lines.map((l) => `${l.account_no}:${l.debit}:${l.credit}`))).sort();
const typeId = async (cls: string, code: string) => ((await call('GET', `/api/v1/trade-defaults/${cls}`)).body.types as Array<{ id: string; code: string }>).find((t) => t.code === code)!.id;
const logs = async (rowId: string | undefined) => (await sql<{ action: string }>`SELECT action FROM sys_activity_log WHERE table_name = 'doc_header' AND row_id = ${rowId!} ORDER BY seq`.execute(database.db)).rows.map((r) => r.action);

describe('setup', () => {
  it('two companies with the WTS-Living setup, a customer and an API key', async () => {
    expect((await call('POST', '/api/v1/setup', { username: 'admin', display_name: 'ผู้ดูแล', password: 'secret123' })).status).toBe(200);
    for (const c of ['A', 'B']) {
      const r = await call('POST', '/api/v1/companies', { code: `DG${c}`, name_th: `บริษัททดสอบ ${c}`, fiscal_start: '2026-01-01', chart: 'express' });
      expect(r.status).toBe(200);
      co[c] = r.body.id;
      await select(c);
      const s = await call('POST', '/api/v1/company/wts-living-setup', {});
      expect([s.status, s.body.blocked]).toEqual([200, 0]);
      ids[`cus${c}`] = (await call('POST', '/api/v1/customers', { code: 'LV00001', name: `ผู้เช่าห้อง 101 (${c})` })).body.id;
    }
    await select('A');
    const me = (await call('GET', '/api/v1/auth/me')).body;
    key = (await call('POST', '/api/v1/api-keys', { name: 'WTS-Living', user_id: me.user.id })).body.key;
    expect(key).toBeTruthy();
  });
});

describe('เงินมัดจำยกมา (หน้าจอ FI.AR.DOB)', () => {
  const dep = (extra: Record<string, unknown>) => ({ party_id: ids.cusA, doc_date: '2025-12-31', price_type: '0', amount: '5000', vat_rate: '0', post_gl: true, ...extra });

  it('keyed at Buddy: Dr the opening account / Cr the deposit account of the doc type, no VAT, logged', async () => {
    await select('A');
    ids.ail = await typeId('AI', 'AIL');
    const r = await call('POST', '/api/v1/ar-deposit-opening', dep({ doc_no: 'DO-1', doc_type_id: ids.ail, ref_no: 'สัญญา 12/2567' }));
    expect([r.status, r.body.error?.message, r.body.net_amount]).toEqual([200, undefined, '5000.00']);
    ids.do1 = r.body.id;
    expect(await lines(ids.do1)).toEqual(['2135-04:0.00:5000.00', '3500-00:5000.00:0.00']);
    expect(await logs(ids.do1)).toEqual(['ADD']);
    const one = (await call('GET', `/api/v1/ar-deposit-opening/${ids.do1}`)).body;
    expect([one.posted, one.used, one.outstanding, one.editable, one.source_system, one.offset_account?.account_no, one.links]).toEqual([true, '0.00', '5000.00', true, null, '3500-00', []]);
  });

  it('the posting preview shows the voucher and saves nothing', async () => {
    const before = (await sql<{ n: string }>`SELECT count(*)::text AS n FROM doc_header WHERE company_id = ${co.A}`.execute(database.db)).rows[0]!.n;
    const p = await call('POST', '/api/v1/ar-deposit-opening/posting-preview', dep({ doc_no: 'DO-P', amount: '3000', doc_type_id: ids.ail }));
    expect([p.status, p.body.error?.message]).toEqual([200, undefined]);
    expect(p.body.journals.flatMap((j: { lines: Array<{ account_no: string; debit: string; credit: string }> }) => j.lines.map((l) => `${l.account_no}:${l.debit}:${l.credit}`)).sort())
      .toEqual(['2135-04:0.00:3000.00', '3500-00:3000.00:0.00']);
    expect((await sql<{ n: string }>`SELECT count(*)::text AS n FROM doc_header WHERE company_id = ${co.A}`.execute(database.db)).rows[0]!.n).toBe(before);
  });

  it('sent by WTS-Living: source shown, read-only on the screen', async () => {
    const r = await keyCall('POST', '/api/v1/ar-deposit-opening', { ...dep({ doc_no: 'DP-L1', amount: '4000', doc_type_id: ids.ail }), source_totals: { net_amount: '4000.00' } }, 'liv:TST:AI-OB:DP-L1');
    expect([r.status, r.body.error?.message]).toEqual([201, undefined]);
    ids.dpl1 = r.body.id;
    expect(await lines(ids.dpl1)).toEqual(['2135-04:0.00:4000.00', '3500-00:4000.00:0.00']);
    const one = (await call('GET', `/api/v1/ar-deposit-opening/${ids.dpl1}`)).body;
    expect([one.source_system, one.source_ref, one.editable]).toEqual(['wts-living', 'liv:TST:AI-OB:DP-L1', false]);
    const ed = await call('PUT', `/api/v1/ar-deposit-opening/${ids.dpl1}`, dep({ doc_no: 'DP-L1', amount: '4500', doc_type_id: ids.ail }));
    expect([ed.status, ed.body.error.code]).toEqual([403, 'SOURCE_LOCKED']);
    const list = (await call('GET', '/api/v1/ar-deposit-opening')).body as { rows: Array<{ doc_no: string; source_system: string | null; used: string; outstanding: string; posted: boolean }>; total: string; opening_account: { account_no: string } };
    expect(list.rows.map((x) => `${x.doc_no}:${x.source_system ?? '-'}:${x.used}:${x.outstanding}:${x.posted}`)).toEqual(['DO-1:-:0.00:5000.00:true', 'DP-L1:wts-living:0.00:4000.00:true']);
    expect([list.total, list.opening_account.account_no]).toEqual(['9000.00', '3500-00']);
    // ค้นหาด้วยเลขอ้างอิงของระบบต้นทาง
    expect((await call('GET', `/api/v1/ar-deposit-opening?q=${encodeURIComponent('AI-OB:DP')}`)).body.rows.map((x: { doc_no: string }) => x.doc_no)).toEqual(['DP-L1']);
  });

  it('used by an RD: links shown, cannot cancel or edit · after the RD is cancelled: cancel, then delete (number free again)', async () => {
    const rd = await call('POST', '/api/v1/ar-deposit-refunds', { doc_type_id: await typeId('RD', 'RDL'), doc_date: '2026-01-31', party_id: ids.cusA, deposits: [{ header_id: ids.do1, amount: '1200' }], cash_amount: '1200' });
    expect([rd.status, rd.body.error?.message]).toEqual([200, undefined]);
    let one = (await call('GET', `/api/v1/ar-deposit-opening/${ids.do1}`)).body;
    expect([one.used, one.outstanding, one.editable, one.links.map((l: { doc_class: string; amount: string; doc_status: string }) => `${l.doc_class}:${l.amount}:${l.doc_status}`)]).toEqual(['1200.00', '3800.00', false, ['RD:1200.00:N']]);
    const c1 = await call('POST', `/api/v1/ar-deposit-opening/${ids.do1}/cancel`, { reason: 'ทดสอบ' });
    expect([c1.status, c1.body.error.message]).toEqual([400, expect.stringMatching(/ใบคืนเงินมัดจำ/)]);
    const ed = await call('PUT', `/api/v1/ar-deposit-opening/${ids.do1}`, dep({ doc_no: 'DO-1', amount: '6000', doc_type_id: ids.ail }));
    expect([ed.status, ed.body.error.message]).toEqual([400, expect.stringMatching(/ใบคืนเงินมัดจำ/)]);
    expect((await call('POST', `/api/v1/ar-deposit-refunds/${rd.body.id}/cancel`, { reason: 'คืนผิด' })).status).toBe(200);
    one = (await call('GET', `/api/v1/ar-deposit-opening/${ids.do1}`)).body;
    expect([one.used, one.outstanding, one.editable]).toEqual(['0.00', '5000.00', true]);
    // ลบได้เฉพาะที่ยกเลิกแล้ว (กติกาข้อ 6)
    expect((await call('POST', `/api/v1/docs/doc/${ids.do1}/delete`, { reason: 'ลบ' })).status).toBe(400);
    expect((await call('POST', `/api/v1/ar-deposit-opening/${ids.do1}/cancel`, { reason: 'คีย์ผิด' })).status).toBe(200);
    expect(await lines(ids.do1)).toEqual([]);
    const del = await call('POST', `/api/v1/docs/doc/${ids.do1}/delete`, { reason: 'คีย์ผิด' });
    expect([del.status, del.body.error?.message]).toEqual([200, undefined]);
    expect(await logs(ids.do1)).toEqual(['ADD', 'CANCEL', 'DELETE']);
    const again = await call('POST', '/api/v1/ar-deposit-opening', dep({ doc_no: 'DO-1', doc_type_id: ids.ail }));
    expect([again.status, again.body.error?.message]).toEqual([200, undefined]);
  });

  it('another company cannot see or touch it', async () => {
    await select('B');
    expect((await call('GET', `/api/v1/ar-deposit-opening/${ids.dpl1}`)).status).toBe(404);
    expect((await call('GET', '/api/v1/ar-deposit-opening')).body.rows).toEqual([]);
    expect((await call('POST', `/api/v1/ar-deposit-opening/${ids.dpl1}/cancel`, { reason: 'x' })).status).toBe(404);
    // ลูกค้าของบริษัท A ใช้ในบริษัท B ไม่ได้
    expect((await call('POST', '/api/v1/ar-deposit-opening/posting-preview', dep({ doc_no: 'X', party_id: ids.cusA }))).status).toBe(400);
    await select('A');
  });
});

describe('บัญชีค่าปรับ/ดอกเบี้ยรับต่อประเภทเอกสาร RE (ช่อง 7)', () => {
  it('the slot shows in the doc type and an RE late fee 107.55 posts Cr the slot account · empty slot = the default', async () => {
    await select('A');
    const rex = await call('POST', '/api/v1/doc-types', { code: 'REX', doc_class: 'RE', name_th: 'ใบเสร็จค่าเช่า', next_no: '1', accounts: [{ slot: 7, account_id: await acc('4300-07') }] });
    expect([rex.status, rex.body.error?.message]).toEqual([200, undefined]);
    const dt = (await call('GET', `/api/v1/doc-types/${rex.body.id}`)).body as { accounts: Array<{ slot: number; role: string; account_no: string }> };
    expect(dt.accounts.map((x) => `${x.slot}:${x.role}:${x.account_no}`)).toEqual(['7:INTEREST_INCOME:4300-07']);
    const ob = async (no: string) => (await call('POST', '/api/v1/ar-opening', { party_id: ids.cusA, doc_no: no, doc_date: '2025-12-31', price_type: '0', amount: '1000', vat_rate: '0' })).body.id as string;
    const re = (type: string, inv: string) => call('POST', '/api/v1/ar-receipts', { doc_type_id: type, doc_date: '2026-01-10', party_id: ids.cusA, settlements: [{ invoice_header_id: inv, amount: '1000' }], interest_amount: '107.55' });
    const a = await re(rex.body.id, await ob('OB-L1'));
    expect([a.status, a.body.error?.message]).toEqual([200, undefined]);
    expect(await lines(a.body.id)).toEqual(['1111-00:1107.55:0.00', '1130-02:0.00:1000.00', '4300-07:0.00:107.55']);
    const b = await re(await typeId('RE', 'REL'), await ob('OB-L2'));
    expect([b.status, b.body.error?.message]).toEqual([200, undefined]);
    expect(await lines(b.body.id)).toEqual(['1111-00:1107.55:0.00', '1130-02:0.00:1000.00', '4300-01:0.00:107.55']);
  });
});

describe('กันลูกหนี้ยกมาลงบัญชีซ้ำกับยอดยกมาที่คีย์ไว้ (409 OPENING_ALREADY_KEYED)', () => {
  const ob = (extra: Record<string, unknown>) => ({ party_id: ids.cusA, doc_date: '2025-12-31', price_type: '1', amount: '1180', vat_rate: '0', post_gl: true, ...extra });
  const keyed = async (ar: boolean) => {
    const r = await call('PUT', '/api/v1/gl/opening', { period_start: '2026-01-01', rows: [
      { account_id: await acc(ar ? '1130-02' : '1111-00'), debit: '2500.00', credit: '0' }, { account_id: await acc('3500-00'), debit: '0', credit: '2500.00' }] });
    expect([r.status, r.body.error?.message]).toEqual([200, undefined]);
  };

  it('no keyed opening on the AR account: accepted and posted', async () => {
    await select('A');
    ids.ivl = await typeId('IV', 'IVL');
    await keyed(false);
    const r = await keyCall('POST', '/api/v1/ar-opening', ob({ doc_no: 'OB-G1', doc_type_id: ids.ivl }), 'liv:TST:OB:OB-G1');
    expect([r.status, r.body.error?.message]).toEqual([201, undefined]);
    ids.g1 = r.body.id;
    expect(await lines(ids.g1)).toEqual(['1130-02:1180.00:0.00', '3500-00:0.00:1180.00']);
  });

  it('keyed opening on the AR account + post_gl: refused with the fix, nothing saved · a new version of a posted one is refused too', async () => {
    await keyed(true);
    const r = await keyCall('POST', '/api/v1/ar-opening', ob({ doc_no: 'OB-G2', doc_type_id: ids.ivl }), 'liv:TST:OB:OB-G2');
    expect([r.status, r.body.error.code]).toEqual([409, 'OPENING_ALREADY_KEYED']);
    expect(r.body.error.message).toMatch(/1130-02/);
    expect(r.body.error.message).toMatch(/2500\.00 \(เดบิต\)/);
    expect(r.body.error.message).toMatch(/บันทึกยอดยกมา/);
    expect(r.body.error.message).toMatch(/post_gl: false/);
    expect((await sql<{ n: string }>`SELECT count(*)::text AS n FROM doc_header WHERE company_id = ${co.A} AND doc_no = 'OB-G2'`.execute(database.db)).rows[0]!.n).toBe('0');
    // ที่หน้าจอ Buddy ก็ปฏิเสธเหมือนกัน
    expect((await call('POST', '/api/v1/ar-opening', ob({ doc_no: 'OB-G3', doc_type_id: ids.ivl }))).body.error.code).toBe('OPENING_ALREADY_KEYED');
    // รุ่นใหม่ของ OB-G1 (แก้บิลยกมาที่ Living) = ยอดจะซ้ำ → ปฏิเสธ ใบสำคัญเดิมยังอยู่
    const v2 = await keyCall('POST', '/api/v1/ar-opening', ob({ doc_no: 'OB-G1', doc_type_id: ids.ivl, amount: '1200' }), 'liv:TST:OB:OB-G1', 2);
    expect([v2.status, v2.body.error.code]).toEqual([409, 'OPENING_ALREADY_KEYED']);
    expect(await lines(ids.g1)).toEqual(['1130-02:1180.00:0.00', '3500-00:0.00:1180.00']);
  });

  it('post_gl false (sub-ledger only) is accepted with no voucher', async () => {
    const r = await keyCall('POST', '/api/v1/ar-opening', ob({ doc_no: 'OB-G2', doc_type_id: ids.ivl, post_gl: false }), 'liv:TST:OB:OB-G2');
    expect([r.status, r.body.error?.message, r.body.journal_id]).toEqual([201, undefined, null]);
    expect(await lines(r.body.id)).toEqual([]);
  });

  it('another company: its own (empty) keyed opening decides — accepted there', async () => {
    await select('B');
    const r = await call('POST', '/api/v1/ar-opening', { ...ob({ doc_no: 'OB-B1' }), party_id: ids.cusB, doc_type_id: await typeId('IV', 'IVL') });
    expect([r.status, r.body.error?.message]).toEqual([200, undefined]);
    expect(await lines(r.body.id)).toEqual(['1130-02:1180.00:0.00', '3500-00:0.00:1180.00']);
    await select('A');
  });
});

describe('สิทธิ์เดิม FI.AR.OB ใช้กับเงินมัดจำยกมาได้เหมือนเดิมหลังแยกเมนู (migration 0060)', () => {
  const migration = () => readFile(resolve(REPO_ROOT, 'db/migrations/0060_menu_deposit_opening_rights.sql'), 'utf8').then((t) => database.execScript(t));
  const dobRows = async (c: string) => Number((await sql<{ n: string }>`SELECT count(*)::text AS n FROM sys_permission p JOIN sys_menu m ON m.id = p.menu_id
    WHERE p.company_id = ${co[c]!} AND m.code = 'FI.AR.DOB' AND p.deleted_at IS NULL`.execute(database.db)).rows[0]!.n);
  const Y = { can_read: 'Y', can_add: 'Y', can_edit: 'Y', can_cancel: 'Y', can_delete: 'N', can_print: 'Y', can_approve: '' };
  let clerkKey = '';
  const asClerk = async (method: 'POST', url: string, body: unknown, ref: string) => {
    const r = await app.inject({ method, url, payload: body as object, headers: { authorization: `Bearer ${clerkKey}`, 'x-source-system': 'wts-living', 'x-source-ref': ref } });
    return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
  };
  const dep = (no: string) => ({ party_id: ids.cusA, doc_no: no, doc_date: '2025-12-31', price_type: '0', amount: '700', vat_rate: '0', doc_type_id: ids.ail, post_gl: true });

  it('a group holding only FI.AR.OB (as before the split) can post an opening deposit through its API key after the migration', async () => {
    await select('A');
    const tenant_id = (await call('GET', '/api/v1/tenants')).body.find((t: { code: string }) => t.code === 'DEFAULT').id;
    const g = (await call('POST', '/api/v1/user-groups', { code: 'OBONLY', name: 'ยอดยกมาเท่านั้น' })).body.id as string;
    ids.group = g;
    const u = await call('POST', '/api/v1/users', { tenant_id, username: 'obclerk', display_name: 'พนักงานยอดยกมา', password: 'obclerk99', approval_level: 5, check_rights: true, user_group_id: g, companies: [co.A, co.B] });
    expect([u.status, u.body.error?.message]).toEqual([200, undefined]);
    // บริษัท A: กลุ่มมีสิทธิ์เฉพาะเมนูลูกหนี้คงค้าง-ยกมา (แบบก่อนแยกเมนู) · บริษัท B: กลุ่มเดียวกันมีเฉพาะขายเงินเชื่อ
    expect((await call('PUT', '/api/v1/permissions', { subject_type: 'G', subject_id: g, rows: [{ menu_code: 'FI.AR.OB', ...Y }] })).status).toBe(200);
    await select('B');
    expect((await call('PUT', '/api/v1/permissions', { subject_type: 'G', subject_id: g, rows: [{ menu_code: 'SA.IV', ...Y }] })).status).toBe(200);
    await select('A');
    clerkKey = (await call('POST', '/api/v1/api-keys', { name: 'WTS-Living (พนักงาน)', user_id: u.body.id })).body.key;
    // ก่อน migration (แถวสิทธิ์ของเมนูใหม่ยังไม่มี) = เสียสิทธิ์ — สิ่งที่ migration 0060 แก้
    expect((await asClerk('POST', '/api/v1/ar-deposit-opening', dep('DOB-1'), 'liv:TST:AI-OB:DOB-1')).status).toBe(403);
    expect(await dobRows('A')).toBe(0);
    await migration();
    expect(await dobRows('A')).toBe(1);
    const r = await asClerk('POST', '/api/v1/ar-deposit-opening', dep('DOB-1'), 'liv:TST:AI-OB:DOB-1');
    expect([r.status, r.body.error?.message]).toEqual([201, undefined]);
    expect(await lines(r.body.id)).toEqual(['2135-04:0.00:700.00', '3500-00:700.00:0.00']);
    // ค่าทุกช่องเท่าแถวเดิม · รันซ้ำไม่สร้างซ้ำ
    const same = await sql<{ a: string; b: string }>`SELECT concat(o.can_read, o.can_add, o.can_edit, o.can_cancel, o.can_delete, o.can_print, o.can_approve) AS a,
        concat(n.can_read, n.can_add, n.can_edit, n.can_cancel, n.can_delete, n.can_print, n.can_approve) AS b
        FROM sys_permission o JOIN sys_menu om ON om.id = o.menu_id AND om.code = 'FI.AR.OB'
        JOIN sys_permission n ON n.company_id = o.company_id AND n.subject_id = o.subject_id AND n.deleted_at IS NULL JOIN sys_menu nm ON nm.id = n.menu_id AND nm.code = 'FI.AR.DOB'
       WHERE o.company_id = ${co.A!} AND o.subject_id = ${g} AND o.deleted_at IS NULL`.execute(database.db);
    expect(same.rows).toEqual([{ a: 'YYYYNYN', b: 'YYYYNYN' }]);
    await migration();
    expect(await dobRows('A')).toBe(1);
  });

  it('the same group in another company is unaffected: no rows created there, still no access', async () => {
    expect(await dobRows('B')).toBe(0);
    const admin = cookie;
    cookie = '';
    await call('POST', '/api/v1/auth/login', { username: 'obclerk', password: 'obclerk99' });
    await select('B');
    const r = await call('POST', '/api/v1/ar-deposit-opening', { ...dep('DOB-B'), party_id: ids.cusB });
    expect(r.status).toBe(403);
    await select('A');
    expect((await call('GET', '/api/v1/ar-deposit-opening')).status).toBe(200);
    cookie = admin;
  });
});
