/**
 * ต่อการ์ดในหน้าเปิดโปรแกรม (Hub) ของบริษัท DEMO กับลิงก์ออนไลน์จริง (เจ้าของ 09/11/2569 ข้อ 3 · HANDOFF ข้อ 99)
 *
 *   node tools/local-pg/pg.mjs run -- node apps/server/node_modules/tsx/dist/cli.mjs tools/hub/link-demo.mts pos     [รหัสบริษัท=DEMO]
 *   node tools/local-pg/pg.mjs run -- node apps/server/node_modules/tsx/dist/cli.mjs tools/hub/link-demo.mts living  [รหัสบริษัท=DEMO]
 *
 * 1) Buddy: ลูกค้าของบริษัทนี้เปิดใช้ WTS-POS + WTS-Living และตั้งที่อยู่โปรแกรมเป็นลิงก์ออนไลน์ (ลงประวัติ TENANT_MODULES)
 * 2) Buddy: สร้างกุญแจ API **อ่านอย่างเดียว** ของบริษัทนี้ ผูกระบบ (wts-pos / wts-living) ในนามผู้ดูแลของลูกค้า — ยกเลิกรุ่นก่อนชื่อเดียวกัน
 * 3) ใส่กุญแจในโปรแกรมนั้น — **ปลายทางบัญชีคงเดิม** (เดโม POS = file · Living บริษัทใหม่ = none → ไม่มีเอกสารเข้า Buddy · งบทดลอง DEMO ไม่เปลี่ยน)
 *    · pos: ผ่าน API ของ WTS-POS (http://127.0.0.1:4200) เข้าด้วยเจ้าของร้านเดโมจาก E:\WTS-POS\.data\ข้อมูลเข้าเดโม.txt
 *    · living: ส่งกุญแจผ่านไฟล์ E:\WTS-Living\.data\buddy-link.key ให้ E:\WTS-Living\tools\hub\link-buddy.mts (อ่านแล้วลบทันที เข้ารหัสด้วยกุญแจของ Living)
 * 4) ทดสอบจริง: ออกบัตรผ่านแบบเดียวกับการกดการ์ด แล้วส่งให้โปรแกรมนั้นตรวจ (ลายเซ็นจาก JWKS ของ Buddy ที่ผูก) — ต้องได้ 200
 * ไม่พิมพ์กุญแจ/รหัสผ่าน/ที่อยู่ฐานข้อมูลออกจอ · ต้องเปิด Buddy (4100) และโปรแกรมนั้นไว้
 */
import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { signSsoToken } from '../../apps/server/src/sso.ts';

const req = createRequire(new URL('../../apps/server/package.json', import.meta.url));
const pg = req('pg') as typeof import('pg');
const APP = process.argv[2];
const CODE = process.argv[3] ?? 'DEMO';
const URLS = { pos: 'https://wtspos.worktruesolution.net/office/', living: 'https://living.worktruesolution.net/office/' } as const;
const TARGET = {
  pos: { name: 'WTS-POS', source: 'wts-pos', aud: 'wts-pos', api: 'http://127.0.0.1:4200/api/v1' },
  living: { name: 'WTS-Living', source: 'wts-living', aud: 'wts-living', api: 'http://127.0.0.1:4300/api/v1' },
} as const;
const BUDDY_LOCAL = 'http://127.0.0.1:4100';
const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const fail = (m: string): never => { console.error('✗ ' + m); process.exit(1); };

if (APP !== 'pos' && APP !== 'living') fail('ระบุโปรแกรม: pos หรือ living');
const T = TARGET[APP as 'pos' | 'living'];
const KEY_NAME = `${T.name} เข้าจาก Hub (อ่านอย่างเดียว)`;
if (!process.env.DATABASE_URL) fail('ต้องรันผ่าน tools/local-pg/pg.mjs run --');
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const one = async <R,>(q: string, p: unknown[] = []) => (await db.query(q, p)).rows[0] as R | undefined;
const log = (companyId: string | null, userId: string, module: string, action: string, docNo: string, table: string, rowId: string | null, detail: unknown) =>
  db.query(`INSERT INTO sys_activity_log (company_id, user_id, module, action, doc_no, table_name, row_id, detail) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [companyId, userId, module, action, docNo, table, rowId, JSON.stringify({ ...(detail as object), via: 'tools/hub/link-demo.mts' })]);

// ---- 1) บริษัท + ผู้ดูแลของลูกค้า
const co = await one<{ id: string; code: string; name_th: string; tax_id: string | null; tenant_id: string; tenant_code: string; tenant_name: string }>(
  `SELECT c.id, c.code, c.name_th, c.tax_id, c.tenant_id, t.code AS tenant_code, t.name AS tenant_name FROM sys_company c JOIN sys_tenant t ON t.id = c.tenant_id
    WHERE c.code = $1 AND c.deleted_at IS NULL`, [CODE]) ?? fail(`ไม่พบบริษัท ${CODE}`);
const admin = await one<{ id: string; username: string; display_name: string; tenant_id: string | null }>(
  `SELECT u.id, u.username, u.display_name, u.tenant_id FROM sys_user u JOIN sys_user_group g ON g.id = u.user_group_id
    WHERE g.code = 'ADMIN' AND u.status = 'A' AND u.deleted_at IS NULL AND (u.tenant_id = $1 OR u.tenant_id IS NULL) AND g.tenant_id IS NOT DISTINCT FROM u.tenant_id
    ORDER BY (u.tenant_id IS NULL), u.created_at LIMIT 1`, [co.tenant_id]) ?? fail('ไม่พบผู้ดูแลระบบของลูกค้านี้');
console.log(`บริษัท ${co.code} ${co.name_th} · ลูกค้า ${co.tenant_code} · ผู้ดูแล ${admin.username} · โปรแกรม ${T.name}`);

// ---- 2) เปิด POS + Living ให้ลูกค้า พร้อมที่อยู่ออนไลน์ (ตั้งแล้วไม่ตั้งซ้ำ)
const before = (await db.query(`SELECT module_key, enabled, valid_to, seats, remark, app_url FROM sys_tenant_module WHERE tenant_id = $1 AND deleted_at IS NULL`, [co.tenant_id])).rows;
const changes = (['pos', 'living'] as const).filter((k) => { const r = before.find((x) => x.module_key === k); return !r || !r.enabled || r.app_url !== URLS[k]; });
for (const key of changes) {
  const cur = before.find((r) => r.module_key === key);
  if (cur) await db.query(`UPDATE sys_tenant_module SET enabled = true, app_url = $3, updated_by = $4, updated_at = now() WHERE tenant_id = $1 AND module_key = $2 AND deleted_at IS NULL`, [co.tenant_id, key, URLS[key], admin.id]);
  else await db.query(`INSERT INTO sys_tenant_module (tenant_id, module_key, enabled, app_url, created_by) VALUES ($1, $2, true, $3, $4)`, [co.tenant_id, key, URLS[key], admin.id]);
}
if (changes.length) await log(null, admin.id, 'SYS', 'TENANT_MODULES', co.tenant_code, 'sys_tenant', co.tenant_id, { before, after: changes.map((k) => ({ key: k, enabled: true, app_url: URLS[k] })) });
console.log(`✓ ลูกค้าเปิดใช้ WTS-POS → ${URLS.pos} · WTS-Living → ${URLS.living}${changes.length ? '' : ' (ตั้งไว้แล้ว)'}`);

// ---- 3) กุญแจ API อ่านอย่างเดียว (ยกเลิกรุ่นก่อนชื่อเดียวกัน)
const old = (await db.query(`UPDATE sys_api_key SET status = 'I', updated_by = $3, updated_at = now() WHERE company_id = $1 AND name = $2 AND status = 'A' AND deleted_at IS NULL RETURNING id, key_prefix`, [co.id, KEY_NAME, admin.id])).rows;
for (const o of old) await log(co.id, admin.id, 'SET.API', 'API_KEY_REVOKE', `bk_${o.key_prefix}`, 'sys_api_key', o.id, { name: KEY_NAME });
const prefix = randomBytes(6).toString('hex'), secret = randomBytes(24).toString('base64url');
const key = `bk_${prefix}_${secret}`;
const k = (await db.query(`INSERT INTO sys_api_key (company_id, user_id, name, key_prefix, key_hash, read_only, source_system, doc_scope, created_by, updated_by)
  VALUES ($1, $2, $3, $4, $5, true, $6, 'S', $2, $2) RETURNING id`, [co.id, admin.id, KEY_NAME, prefix, sha(secret), T.source])).rows[0] as { id: string };
await log(co.id, admin.id, 'SET.API', 'API_KEY_CREATE', `bk_${prefix}`, 'sys_api_key', k.id, { name: KEY_NAME, user: admin.username, read_only: true, source_system: T.source });
console.log(`✓ กุญแจ API อ่านอย่างเดียว bk_${prefix}_… (ยกเลิกรุ่นก่อน ${old.length} ดอก)`);

// ---- 4) ใส่กุญแจในโปรแกรม (ปลายทางบัญชีคงเดิม)
let cookie = '';
const call = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(T.api + path, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const set = r.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0]!;
  const text = await r.text();
  try { return { status: r.status, body: text ? JSON.parse(text) : null }; } catch { return { status: r.status, body: { raw: text.slice(0, 200) } }; }
};
let progCompany = '';
if (APP === 'pos') {
  const creds = readFileSync('E:/WTS-POS/.data/ข้อมูลเข้าเดโม.txt', 'utf8');
  const m = /ชื่อผู้ใช้\s+(owner)\s+รหัส(?:ผ่าน)?\s+(\S+)/.exec(creds) ?? fail('อ่านรหัสเจ้าของร้านเดโมจาก E:\\WTS-POS\\.data\\ข้อมูลเข้าเดโม.txt ไม่ได้');
  const login = await call('POST', '/auth/login', { username: m[1], password: m[2] });
  if (login.status !== 200) fail(`เข้าระบบ WTS-POS ไม่ได้ (${login.status}) — เปิด เปิด WTS-POS.cmd ก่อน`);
  const cur = await call('GET', '/company');
  if (cur.status !== 200) fail(`อ่านบริษัทใน WTS-POS ไม่ได้ (${cur.status})`);
  const c = cur.body;
  const put = await call('PUT', '/company', { nameTh: c.nameTh, taxId: c.taxId ?? '', vatRate: c.vatRate, destination: c.destination, buddyUrl: BUDDY_LOCAL, buddyKey: key,
    sopUrl: c.sopUrl ?? null, yearSystem: c.yearSystem, showCurrency: c.showCurrency });
  if (put.status !== 200) fail(`บันทึกการเชื่อม Buddy ใน WTS-POS ไม่ได้ (${put.status}) ${JSON.stringify(put.body?.error ?? put.body).slice(0, 300)}`);
  progCompany = `${c.code} ${c.nameTh}`;
  console.log(`✓ WTS-POS บริษัท ${progCompany}: ที่อยู่ Buddy ${BUDDY_LOCAL} · กุญแจ …${put.body.buddyKeyHint} · ปลายทางบัญชี "${put.body.destination}" (คงเดิม)`);
} else {
  const handoff = 'E:/WTS-Living/.data/buddy-link.key';
  let r: ReturnType<typeof spawnSync<string>>;
  try {
    writeFileSync(handoff, key, { encoding: 'utf8', mode: 0o600 });
    const env = { ...process.env };
    delete env.DATABASE_URL;   // ให้ตัวช่วยฐานข้อมูลของ Living ตั้งของ Living เอง
    // ตัวช่วย pg.mjs ของ Living รันคำสั่งผ่าน shell บน Windows — ใช้ "node" (ไม่ใช่ process.execPath ที่มีช่องว่าง "Program Files")
    r = spawnSync(process.execPath, ['tools/local-pg/pg.mjs', 'run', '--', 'node', 'apps/server/node_modules/tsx/dist/cli.mjs', 'tools/hub/link-buddy.mts'],
      { cwd: 'E:/WTS-Living', env, encoding: 'utf8' });
  } finally { rmSync(handoff, { force: true }); }   // ลบไฟล์ส่งต่อเสมอ (ก่อน fail ซึ่งออกจากโปรแกรมทันที)
  const lines = `${r.stdout ?? ''}${r.stderr ?? ''}`.split(/\r?\n/).filter(Boolean);
  for (const l of lines.filter((x) => x.startsWith('✓') || x.startsWith('✗'))) console.log(l);
  if (r.status !== 0) {
    // แสดงท้ายข้อความผิดพลาด โดยปิดที่อยู่ฐานข้อมูลและกุญแจ
    for (const l of lines.slice(-8)) console.error('  ' + l.replace(/postgres(ql)?:\/\/\S+/g, '<db>').replace(/bk_\S+/g, '<key>'));
    fail('ใส่กุญแจใน WTS-Living ไม่สำเร็จ (ดูข้อความด้านบน)');
  }
}

// ---- 5) ทดสอบบัตรผ่านจริง (แบบเดียวกับกดการ์ดใน Hub)
const { token } = signSsoToken({ iss: BUDDY_LOCAL, aud: T.aud, sub: admin.id, name: admin.display_name, preferred_username: admin.username,
  buddy: { tenant: { id: co.tenant_id, code: co.tenant_code, name: co.tenant_name }, company: { id: co.id, code: co.code, name_th: co.name_th, tax_id: co.tax_id }, branch: null, admin: true, platform: !admin.tenant_id } });
cookie = '';
const sso = await call('POST', '/auth/buddy-sso', { token });
if (sso.status !== 200) fail(`${T.name} ไม่รับบัตรผ่าน (${sso.status}) ${JSON.stringify(sso.body?.error ?? sso.body).slice(0, 300)}`);
console.log(`✓ ทดสอบบัตรผ่าน: ${T.name} รับแล้ว — เข้าในนาม ${sso.body.user?.username ?? '(ผู้ใช้จาก Buddy)'}${progCompany ? ` บริษัท ${progCompany}` : ''}`);
await db.end();
