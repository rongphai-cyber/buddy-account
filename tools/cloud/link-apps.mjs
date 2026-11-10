// เชื่อม WTS-POS + WTS-Living บนคลาวด์เข้ากับ Buddy บนคลาวด์ (เจ้าของ 10/11/2569 "ทำเครื่องมือคำสั่งเดียวให้" · HANDOFF ข้อ 107)
//
//   node tools/cloud/link-apps.mjs                       ใช้จริง (อ่าน .data/cloud-prod.env) — บริษัท DEMO
//   node tools/cloud/link-apps.mjs --company <รหัส>       บริษัทอื่นใน Buddy (POS/Living ต้องมีบริษัทเดียว หรือตั้ง BUDDY_LINK_COMPANY)
//   node tools/local-pg/pg.mjs run -- node tools/cloud/link-apps.mjs --rehearse
//                                                        ซ้อมกับ PostgreSQL ในเครื่อง ด้วยฐานชั่วคราว rehearse_link_* แล้วลบทิ้ง
//
// ทำอะไร (รันซ้ำได้ — กุญแจรุ่นก่อนชื่อเดียวกันถูกยกเลิก)
//  1) Buddy: ลูกค้าของบริษัทนี้เปิดใช้ WTS-POS + WTS-Living พร้อมที่อยู่โปรแกรมบนคลาวด์ (การ์ดในหน้าเลือกโปรแกรมกดได้) — ลงประวัติ TENANT_MODULES
//  2) Buddy: สร้างกุญแจ API ของบริษัทนี้ในนามผู้ดูแลของลูกค้า (บันทึกได้ · ผูกระบบ wts-pos / wts-living · เห็นเฉพาะเอกสารที่ระบบนั้นส่งเข้ามา) — ลงประวัติ API_KEY_CREATE
//  3) POS / Living: ใส่ที่อยู่ Buddy (buddy-api) + กุญแจ (เข้ารหัสด้วยกุญแจหลักของโปรแกรมนั้น ผ่าน tools/hub/link-buddy.mts ของโปรแกรมนั้น)
//     + รหัสบริษัท Buddy + ปลายทางบัญชี = Buddy — การแก้บริษัทลงประวัติของโปรแกรมนั้นเอง (trigger companies_audit)
//  4) ทดสอบ: เรียก Buddy ผ่าน buddy-api ด้วยกุญแจแต่ละดอก ต้องได้บริษัทเดียวกัน + กุญแจตรวจบัตรผ่าน (JWKS) เปิดได้
// ไม่พิมพ์กุญแจ / รหัสผ่าน / ที่อยู่ฐานข้อมูลออกจอ · กุญแจส่งให้โปรแกรมย่อยทางไฟล์ชั่วคราวที่ลบทันที
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const pg = createRequire(join(ROOT, 'apps/server/package.json'))('pg');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const REHEARSE = argv.includes('--rehearse');
const CODE = opt('--company', 'DEMO');
const BUDDY_API = 'https://buddy-api.worktruesolution.net';
const REHEARSE_PORT = 4103;
const VIA = 'tools/cloud/link-apps.mjs';
const APPS = [
  { key: 'pos', name: 'WTS-POS', source: 'wts-pos', db: 'wtspos', root: resolve(process.env.WTSPOS_ROOT ?? 'E:/WTS-POS'), secretEnv: 'WTSPOS_SECRET_KEY',
    appUrl: 'https://pos.worktruesolution.net/office/' },
  { key: 'living', name: 'WTS-Living', source: 'wts-living', db: 'wtsliving', root: resolve(process.env.WTSLIVING_ROOT ?? 'E:/WTS-Living'), secretEnv: 'WTSLIVING_SECRET_KEY',
    appUrl: 'https://living.worktruesolution.net/office/' },
];

/* ---------------------------------------------------------------- ปิดบังความลับ */
const secrets = new Set();
const mask = (t) => {
  let s = String(t ?? '').replace(/postgres(?:ql)?:\/\/[^\s'"`)]+/gi, 'postgres://***').replace(/bk_[0-9a-f]{12}_[A-Za-z0-9_-]+/g, 'bk_***');
  for (const x of [...secrets].sort((a, b) => b.length - a.length)) if (x && x.length >= 6) s = s.split(x).join('***');
  return s;
};
const out = (l = '') => console.log(mask(l));
let cleanup = async () => {};
const fail = async (m) => { out(`✗ ${m}`); await cleanup(); process.exit(1); };
const withDb = (url, db) => { const u = new URL(url); u.pathname = `/${db}`; return u.toString(); };
const sha = (t) => createHash('sha256').update(t).digest('hex');

function readEnv(file) {
  const env = {};
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const l = raw.trim();
    if (!l || l.startsWith('#')) continue;
    const i = l.indexOf('=');
    if (i > 0) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}
function childEnv(extra) {
  const env = { ...process.env, ...extra };
  for (const k of ['BUDDY_DATA_DIR', 'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'BUDDY_LINK_COMPANY_FILE']) delete env[k];
  return env;
}
function run(cmd, args, cwd, env) {
  return new Promise((done) => {
    const ch = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    ch.stdout.on('data', (d) => { text += d; });
    ch.stderr.on('data', (d) => { text += d; });
    ch.on('close', (code) => done({ code, lines: text.split(/\r?\n/).filter((l) => l.trim()) }));
    ch.on('error', (e) => done({ code: -1, lines: [String(e)] }));
  });
}
const tsxOf = (root) => join(root, 'apps/server/node_modules/tsx/dist/cli.mjs');

/* ---------------------------------------------------------------- เป้าหมาย */
let buddyUrl, buddyApi, admin, server;
const appDb = {}, appKey = {};
for (const a of APPS) if (!existsSync(join(a.root, 'tools/hub/link-buddy.mts')) || !existsSync(tsxOf(a.root)))
  await fail(`ไม่พบ ${a.root}\\tools\\hub\\link-buddy.mts หรือแพ็กเกจของ ${a.name} — ดึงโค้ดล่าสุด (git pull) และ pnpm install ใน ${a.root}`);

if (REHEARSE) {
  if (!process.env.DATABASE_URL) await fail('โหมดซ้อมต้องรันผ่าน node tools/local-pg/pg.mjs run --');
  admin = new pg.Client({ connectionString: withDb(process.env.DATABASE_URL, 'postgres') });
  await admin.connect();
  const dbs = ['rehearse_link_buddy', ...APPS.map((a) => `rehearse_link_${a.key}`)];
  cleanup = async () => {
    if (server && server.exitCode === null) { server.kill(); await new Promise((r) => setTimeout(r, 1500)); }
    for (const d of dbs) await admin.query(`DROP DATABASE IF EXISTS ${d} WITH (FORCE)`).catch((e) => out(`ลบฐาน ${d} ไม่ได้: ${e.message}`));
    await admin.end().catch(() => {});
    out('ซ้อมเสร็จ — ลบฐาน rehearse_link_* แล้ว');
  };
  for (const d of dbs) { await admin.query(`DROP DATABASE IF EXISTS ${d} WITH (FORCE)`); await admin.query(`CREATE DATABASE ${d} ENCODING 'UTF8'`); }
  buddyUrl = withDb(process.env.DATABASE_URL, 'rehearse_link_buddy');
  for (const a of APPS) { appDb[a.key] = withDb(process.env.DATABASE_URL, `rehearse_link_${a.key}`); appKey[a.key] = randomBytes(32).toString('base64'); }
  buddyApi = `http://127.0.0.1:${REHEARSE_PORT}`;
} else {
  const envFile = join(ROOT, '.data/cloud-prod.env');
  if (!existsSync(envFile)) await fail('ไม่พบ .data/cloud-prod.env');
  const env = readEnv(envFile);
  if (!env.SUPABASE_PROJECT_URL) await fail('ไม่พบ SUPABASE_PROJECT_URL ใน .data/cloud-prod.env');
  buddyUrl = withDb(env.SUPABASE_PROJECT_URL, 'buddy');
  for (const a of APPS) {
    if (!env[a.secretEnv]) await fail(`ไม่พบ ${a.secretEnv} ใน .data/cloud-prod.env — รัน node tools/cloud/put-secrets.mjs ก่อน`);
    appDb[a.key] = withDb(env.SUPABASE_PROJECT_URL, a.db);
    appKey[a.key] = env[a.secretEnv];
  }
  buddyApi = BUDDY_API;
}
secrets.add(buddyUrl);
for (const a of APPS) { secrets.add(appDb[a.key]); secrets.add(appKey[a.key]); }
out(`# เชื่อม WTS-POS + WTS-Living เข้ากับ Buddy — ${REHEARSE ? 'ซ้อมในเครื่อง (ฐาน rehearse_link_*)' : 'คลาวด์ wts-prod'} · บริษัท ${CODE}`);

/* ---------------------------------------------------------------- ซ้อม: เตรียมฐาน */
async function migrate(root, url, name) {
  const r = await run(process.execPath, [tsxOf(root), 'src/cli.ts', 'migrate'], join(root, 'apps/server'), childEnv({ DATABASE_URL: url }));
  if (r.code !== 0) await fail(`ซ้อม: migration ของ ${name} ไม่ผ่าน — ${r.lines.slice(-3).join(' / ')}`);
}
if (REHEARSE) {
  await migrate(ROOT, buddyUrl, 'Buddy');
  for (const a of APPS) await migrate(a.root, appDb[a.key], a.name);
  const b = new pg.Client({ connectionString: buddyUrl }); await b.connect();
  const t = (await b.query(`INSERT INTO sys_tenant (code, name) VALUES ($1, 'ลูกค้าซ้อม') RETURNING id`, [CODE])).rows[0];
  await b.query(`INSERT INTO sys_company (tenant_id, code, name_th) VALUES ($1, $2, 'บริษัทซ้อม')`, [t.id, CODE]);
  const g = (await b.query(`INSERT INTO sys_user_group (tenant_id, code, name) VALUES ($1, 'ADMIN', 'ผู้ดูแล') RETURNING id`, [t.id])).rows[0];
  await b.query(`INSERT INTO sys_user (tenant_id, username, display_name, password_hash, user_group_id, approval_level) VALUES ($1, 'demo.admin', 'ผู้ดูแลซ้อม', '!', $2, 9)`, [t.id, g.id]);
  await b.end();
  for (const a of APPS) {
    const c = new pg.Client({ connectionString: appDb[a.key] }); await c.connect();
    await c.query(`INSERT INTO core.companies (code, name_th) VALUES ('S1', 'ร้านซ้อม')`);
    await c.end();
  }
  const env = childEnv({ DATABASE_URL: buddyUrl, BUDDY_SECRET_KEY: randomBytes(32).toString('base64'), PORT: String(REHEARSE_PORT), HOST: '127.0.0.1', LOG_LEVEL: 'warn' });
  server = spawn(process.execPath, [tsxOf(ROOT), 'src/main.ts'], { cwd: join(ROOT, 'apps/server'), env, stdio: ['ignore', 'ignore', 'pipe'] });
  let err = ''; server.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
  let up = false;
  for (let i = 0; i < 120 && !up && server.exitCode === null; i++) {
    try { up = (await fetch(`${buddyApi}/api/v1/health`)).ok; } catch { /* */ }
    if (!up) await new Promise((r) => setTimeout(r, 1000));
  }
  if (!up) await fail(`ซ้อม: เปิด Buddy ชั่วคราวไม่สำเร็จ — ${err.split(/\r?\n/).filter(Boolean).slice(-3).join(' / ')}`);
  out(`✓ ซ้อม: เตรียมฐาน 3 ฐาน + เปิด Buddy ชั่วคราว (พอร์ต ${REHEARSE_PORT}) แทน buddy-api`);
}

/* ---------------------------------------------------------------- 1–2) Buddy */
const db = new pg.Client({ connectionString: buddyUrl, connectionTimeoutMillis: 20_000 });
db.on('error', () => {});
await db.connect();
const one = async (q, p = []) => (await db.query(q, p)).rows[0];
const log = (companyId, userId, module, action, docNo, table, rowId, detail) =>
  db.query(`INSERT INTO sys_activity_log (company_id, user_id, module, action, doc_no, table_name, row_id, detail) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [companyId, userId, module, action, docNo, table, rowId, JSON.stringify({ ...detail, via: VIA })]);
const keys = {};
let co, adm;
try {
  co = await one(`SELECT c.id, c.code, c.name_th, c.tenant_id, t.code AS tenant_code FROM sys_company c JOIN sys_tenant t ON t.id = c.tenant_id
    WHERE c.code = $1 AND c.deleted_at IS NULL`, [CODE]);
  if (!co) await fail(`ไม่พบบริษัท ${CODE} ใน Buddy`);
  adm = await one(`SELECT u.id, u.username FROM sys_user u JOIN sys_user_group g ON g.id = u.user_group_id
    WHERE g.code = 'ADMIN' AND u.status = 'A' AND u.deleted_at IS NULL AND u.tenant_id = $1 AND g.tenant_id = $1 ORDER BY u.created_at LIMIT 1`, [co.tenant_id]);
  if (!adm) await fail(`ไม่พบผู้ดูแลของลูกค้า ${co.tenant_code} ใน Buddy (กลุ่ม ADMIN ของลูกค้า)`);
  out(`บริษัท ${co.code} ${co.name_th} · ลูกค้า ${co.tenant_code} · กุญแจในนาม ${adm.username}`);

  await db.query('BEGIN');
  const before = (await db.query(`SELECT module_key, enabled, app_url FROM sys_tenant_module WHERE tenant_id = $1 AND deleted_at IS NULL`, [co.tenant_id])).rows;
  const changes = APPS.filter((a) => { const r = before.find((x) => x.module_key === a.key); return !r || !r.enabled || r.app_url !== a.appUrl; });
  for (const a of changes) {
    if (before.find((r) => r.module_key === a.key))
      await db.query(`UPDATE sys_tenant_module SET enabled = true, app_url = $3, updated_by = $4, updated_at = now() WHERE tenant_id = $1 AND module_key = $2 AND deleted_at IS NULL`, [co.tenant_id, a.key, a.appUrl, adm.id]);
    else await db.query(`INSERT INTO sys_tenant_module (tenant_id, module_key, enabled, app_url, created_by) VALUES ($1, $2, true, $3, $4)`, [co.tenant_id, a.key, a.appUrl, adm.id]);
  }
  if (changes.length) await log(null, adm.id, 'SYS', 'TENANT_MODULES', co.tenant_code, 'sys_tenant', co.tenant_id, { before, after: changes.map((a) => ({ key: a.key, enabled: true, app_url: a.appUrl })) });
  out(`✓ Buddy: ลูกค้า ${co.tenant_code} เปิดใช้ ${APPS.map((a) => `${a.name} → ${a.appUrl}`).join(' · ')}${changes.length ? '' : ' (ตั้งไว้แล้ว)'}`);

  for (const a of APPS) {
    const name = `${a.name} (เชื่อมบนคลาวด์)`;
    const old = (await db.query(`UPDATE sys_api_key SET status = 'I', updated_by = $3, updated_at = now() WHERE company_id = $1 AND name = $2 AND status = 'A' AND deleted_at IS NULL RETURNING id, key_prefix`,
      [co.id, name, adm.id])).rows;
    for (const o of old) await log(co.id, adm.id, 'SET.API', 'API_KEY_REVOKE', `bk_${o.key_prefix}`, 'sys_api_key', o.id, { name });
    const prefix = randomBytes(6).toString('hex'), secret = randomBytes(24).toString('base64url');
    keys[a.key] = `bk_${prefix}_${secret}`;
    const k = await one(`INSERT INTO sys_api_key (company_id, user_id, name, key_prefix, key_hash, read_only, source_system, doc_scope, created_by, updated_by)
      VALUES ($1, $2, $3, $4, $5, false, $6, 'S', $2, $2) RETURNING id`, [co.id, adm.id, name, prefix, sha(secret), a.source]);
    await log(co.id, adm.id, 'SET.API', 'API_KEY_CREATE', `bk_${prefix}`, 'sys_api_key', k.id, { name, user: adm.username, read_only: false, source_system: a.source, doc_scope: 'S' });
    out(`✓ Buddy: กุญแจ "${name}" bk_${prefix}_… (บันทึกได้ · ระบบ ${a.source}) — ยกเลิกรุ่นก่อน ${old.length} ดอก`);
  }
  await db.query('COMMIT');
} catch (e) {
  await db.query('ROLLBACK').catch(() => {});
  await db.end().catch(() => {});
  await fail(`Buddy: ${e.message}`);
}
await db.end();

/* ---------------------------------------------------------------- 3) POS / Living */
let ok = true;
for (const a of APPS) {
  const file = join(ROOT, `.data/link-${a.key}-${randomBytes(6).toString('hex')}.key`);
  let r;
  try {
    writeFileSync(file, keys[a.key], { encoding: 'utf8', mode: 0o600 });
    r = await run(process.execPath, [tsxOf(a.root), 'tools/hub/link-buddy.mts'], a.root, childEnv({
      DATABASE_URL: appDb[a.key], [a.secretEnv]: appKey[a.key], BUDDY_LINK_KEY_FILE: file, BUDDY_LINK_URL: buddyApi,
      BUDDY_LINK_DESTINATION: 'buddy', BUDDY_LINK_BUDDY_COMPANY_ID: co.id,
    }));
  } finally { rmSync(file, { force: true }); }
  for (const l of r.lines.filter((x) => /^[✓✗]/.test(x))) out(l);
  if (r.code !== 0) { ok = false; for (const l of r.lines.slice(-6)) if (!/^[✓✗]/.test(l)) out(`  ${l}`); out(`✗ ใส่กุญแจใน ${a.name} ไม่สำเร็จ`); }
}

/* ---------------------------------------------------------------- 4) ทดสอบผ่าน buddy-api */
async function getJson(path, key) {
  try {
    const r = await fetch(`${buddyApi}${path}`, { headers: { accept: 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) }, signal: AbortSignal.timeout(30_000) });
    let body = null; try { body = await r.json(); } catch { /* */ }
    return { status: r.status, body };
  } catch (e) { return { status: 0, body: { error: { message: e.message } } }; }
}
const jwks = await getJson('/api/v1/sso/jwks');
if (jwks.status === 200 && Array.isArray(jwks.body?.keys) && jwks.body.keys.length) out(`✓ กุญแจตรวจบัตรผ่าน (JWKS) เปิดได้ที่ ${buddyApi}`);
else { ok = false; out(`✗ เปิดกุญแจตรวจบัตรผ่านไม่ได้ (${jwks.status}) — ตรวจ Access app buddy-api (Bypass)`); }
for (const a of APPS) {
  const me = await getJson('/api/v1/auth/me', keys[a.key]);
  if (me.status === 200 && me.body?.company?.id === co.id) out(`✓ ${a.name}: กุญแจใช้ได้ผ่าน ${buddyApi} — บริษัท ${me.body.company.code ?? co.code}`);
  else { ok = false; out(`✗ ${a.name}: เรียก Buddy ด้วยกุญแจไม่ผ่าน (${me.status}) ${JSON.stringify(me.body?.error ?? '').slice(0, 200)}`); }
}

await cleanup();
out(ok ? `\n✓ เชื่อมครบ — ${REHEARSE ? 'ซ้อมผ่าน' : `เข้า Buddy ด้วยผู้ใช้ของบริษัท ${CODE} (เช่น ${adm.username}) แล้วกดการ์ด WTS-POS / WTS-Living ในหน้าเลือกโปรแกรม`}` : '\n✗ ยังไม่ครบ (ดูข้อความด้านบน) — รันซ้ำได้');
process.exit(ok ? 0 : 1);
