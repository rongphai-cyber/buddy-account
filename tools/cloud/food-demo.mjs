#!/usr/bin/env node
// ตัวอย่างทั้งระบบ: บริษัท ดับบลิวทีเอส ฟู้ด (ทดลอง) จำกัด — Buddy WFOOD + WTS-POS WF (เจ้าของ 11/11/2569 · HANDOFF ข้อ 117 · README ข้อ 10)
//
//   node tools\cloud\food-demo.mjs                     คลาวด์ (อ่าน .data\cloud-prod.env)
//   node tools/local-pg/pg.mjs run -- node tools/cloud/food-demo.mjs --rehearse
//                                                      ซ้อม: สำเนา DEMO ในเครื่อง + Buddy ชั่วคราว (พอร์ต 4105) + WTS-POS ฐานชั่วคราว แล้วลบทิ้ง
//
// 1) Buddy: บริษัทใหม่ WFOOD (คัดลอกผังบัญชี/ประเภทเอกสาร/ค่าตั้งจาก DEMO — tools/cloud/food-company.mts) · ลูกค้าเดียวกับ DEMO (ผู้ดูแลเห็นทันที)
// 2) Buddy: กุญแจ API ของ WFOOD (ระบบ wts-pos · ในนามผู้ดูแลของลูกค้า) — ยกเลิกรุ่นก่อนชื่อเดียวกัน
// 3) WTS-POS: บริษัท WF ผูกกับ WFOOD (tools/hub/link-buddy.mts — กุญแจเข้ารหัสด้วยกุญแจหลักของ POS)
// 4) WTS-POS: ข้อมูลทั้งระบบ + ยอดขาย 14 วัน + ครัวกลาง + ส่งเข้า Buddy (E:\WTS-POS\tools\hub\food-demo.mts)
// รันซ้ำได้ (ข้ามของที่มีแล้ว · ออกกุญแจเครื่อง/PIN ใหม่) · กุญแจ/PIN อยู่ในไฟล์ .data\ข้อมูลเข้า-ตัวอย่างทั้งระบบ.txt (ไม่ขึ้นจอ · ไม่เข้า git)
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const POS_ROOT = resolve(process.env.WTSPOS_ROOT ?? 'E:/WTS-POS');
const pg = createRequire(join(ROOT, 'apps/server/package.json'))('pg');
const REHEARSE = process.argv.includes('--rehearse');
const PORT = 4105;
const PG17 = join(ROOT, '.data/pg17/pgsql/bin');
const OUT = join(ROOT, REHEARSE ? '.data/rehearse-food-demo.txt' : '.data/ข้อมูลเข้า-ตัวอย่างทั้งระบบ.txt');
const BUDDY_CODE = 'WFOOD', POS_CODE = 'WF', NAME = 'บริษัท ดับบลิวทีเอส ฟู้ด (ทดลอง) จำกัด';
const KEY_NAME = 'WTS-POS (เชื่อมบนคลาวด์)';

const secrets = new Set();
const mask = (t) => {
  let s = String(t ?? '').replace(/postgres(?:ql)?:\/\/[^\s'"`)]+/gi, 'postgres://***').replace(/bk_[0-9a-f]{12}_[A-Za-z0-9_-]+/g, 'bk_***').replace(/wtspos_[A-Za-z0-9_-]{10,}/g, 'wtspos_***');
  for (const x of [...secrets].sort((a, b) => b.length - a.length)) if (x && x.length >= 6) s = s.split(x).join('***');
  return s;
};
const out = (l = '') => console.log(mask(l));
let cleanup = async () => {};
const fail = async (m) => { out(`✗ ${m}`); await cleanup(); process.exit(1); };
const withDb = (url, db) => { const u = new URL(url); u.pathname = `/${db}`; return u.toString(); };
const sha = (t) => createHash('sha256').update(t).digest('hex');
const tsxOf = (root) => join(root, 'apps/server/node_modules/tsx/dist/cli.mjs');
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
  const env = { ...process.env };
  for (const k of ['BUDDY_DATA_DIR', 'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE']) delete env[k];
  return { ...env, ...extra, PGCONNECT_TIMEOUT: '20' };
}
/** รันโปรแกรมย่อย · live = พิมพ์บรรทัดสถานะ (✓ ✗ …) ทันทีที่มา */
function run(cmd, args, cwd, env, live = false) {
  return new Promise((done) => {
    const ch = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let text = '', buf = '';
    const take = (d) => {
      text += d;
      if (!live) return;
      buf += d;
      const parts = buf.split(/\r?\n/); buf = parts.pop();
      for (const l of parts) if (/^(✓|✗|บริษัท|  …)/.test(l)) out(l);
    };
    ch.stdout.on('data', take);
    ch.stderr.on('data', take);
    ch.on('close', (code) => { if (live && buf && /^(✓|✗)/.test(buf)) out(buf); done({ code, lines: text.split(/\r?\n/).filter((l) => l.trim()) }); });
    ch.on('error', (e) => done({ code: -1, lines: [String(e)] }));
  });
}
for (const f of ['tools/hub/food-demo.mts', 'tools/hub/link-buddy.mts'])
  if (!existsSync(join(POS_ROOT, f)) || !existsSync(tsxOf(POS_ROOT))) await fail(`ไม่พบ ${POS_ROOT}\\${f.replace(/\//g, '\\')} หรือแพ็กเกจของ WTS-POS — git pull และ pnpm install ใน ${POS_ROOT}`);

let buddyUrl, buddyApi, posDb, posKey;
if (REHEARSE) {
  /* ---------------------------------------------------------------- ซ้อม: สำเนา DEMO + ฐาน POS ใหม่ + Buddy ชั่วคราว */
  if (!process.env.DATABASE_URL) await fail('โหมดซ้อมต้องรันผ่าน node tools/local-pg/pg.mjs run --');
  const local = process.env.DATABASE_URL;
  const srcDb = new URL(local).pathname.slice(1);
  const bDb = 'rehearse_fd_buddy', pDb = 'rehearse_fd_pos';
  const admin = new pg.Client({ connectionString: withDb(local, 'postgres') });
  await admin.connect();
  let server;
  cleanup = async () => {
    if (server && server.exitCode === null) { server.kill(); await new Promise((r) => setTimeout(r, 1500)); }
    if (!process.argv.includes('--keep')) for (const d of [bDb, pDb]) await admin.query(`DROP DATABASE IF EXISTS ${d} WITH (FORCE)`).catch((e) => out(`ลบฐาน ${d} ไม่ได้: ${e.message}`));
    await admin.end().catch(() => {});
    rmSync(OUT, { force: true });
    out(process.argv.includes('--keep') ? 'ซ้อมเสร็จ — เก็บฐาน rehearse_fd_* ไว้ดู (ลบไฟล์ผลซ้อมแล้ว)' : 'ซ้อมเสร็จ — ลบฐาน rehearse_fd_* และไฟล์ผลซ้อมแล้ว');
  };
  for (const d of [bDb, pDb]) { await admin.query(`DROP DATABASE IF EXISTS ${d} WITH (FORCE)`); await admin.query(`CREATE DATABASE ${d} ENCODING 'UTF8' TEMPLATE template0`); }
  const u = new URL(local); const pw = decodeURIComponent(u.password); u.password = '';
  const exe = (n) => join(PG17, `${n}.exe`);
  if (!existsSync(exe('pg_dump'))) await fail('ซ้อมต้องมี PostgreSQL 17 ใน .data\\pg17 (README ข้อ 8)');
  const dump = join(ROOT, `.data/rehearse-fd-${randomBytes(4).toString('hex')}.dump`);
  try {
    let r = await run(exe('pg_dump'), ['--no-password', '--format=custom', `--file=${dump}`, `--dbname=${withDb(u.toString(), srcDb)}`], ROOT, childEnv({ PGPASSWORD: pw }));
    if (r.code !== 0) await fail(`ซ้อม: สำเนา DEMO ไม่ได้ — ${r.lines.slice(-2).join(' / ')}`);
    r = await run(exe('pg_restore'), ['--no-password', `--dbname=${withDb(u.toString(), bDb)}`, dump], ROOT, childEnv({ PGPASSWORD: pw }));
    if (r.code !== 0 && r.lines.some((l) => /error:/i.test(l) && !/transaction_timeout/i.test(l))) await fail(`ซ้อม: นำสำเนา DEMO เข้า ${bDb} ไม่ได้ — ${r.lines.filter((l) => /error/i.test(l)).slice(0, 2).join(' / ')}`);
  } finally { rmSync(dump, { force: true }); }
  buddyUrl = withDb(local, bDb);
  posDb = withDb(local, pDb);
  posKey = randomBytes(32).toString('base64');
  secrets.add(buddyUrl); secrets.add(posDb); secrets.add(posKey);
  const r = await run(process.execPath, [tsxOf(POS_ROOT), 'src/cli.ts', 'migrate'], join(POS_ROOT, 'apps/server'), childEnv({ DATABASE_URL: posDb }));
  if (r.code !== 0) await fail(`ซ้อม: migration WTS-POS ไม่ผ่าน — ${r.lines.slice(-3).join(' / ')}`);
  // บนคลาวด์: บริษัท POS เดิม (S1) + เจ้าของที่เข้าจาก Buddy แล้ว
  const p = new pg.Client({ connectionString: posDb }); await p.connect();
  const s1 = (await p.query(`INSERT INTO core.companies (code, name_th) VALUES ('S1', 'TEST CoffeeShop ซ้อม') RETURNING id`)).rows[0];
  const own = (await p.query(`INSERT INTO core.users (username, password_hash, full_name, active) VALUES ('rehearse.owner', '!', 'เจ้าของซ้อม', true) RETURNING id`)).rows[0];
  await p.query(`INSERT INTO core.company_users (company_id, user_id, role, is_active) VALUES ($1, $2, 'owner', true)`, [s1.id, own.id]);
  await p.end();
  // ผู้ดูแลของลูกค้า (บนคลาวด์มี demo.admin — DEMO ในเครื่องไม่มี)
  const b = new pg.Client({ connectionString: buddyUrl }); await b.connect();
  const co = (await b.query(`SELECT id, tenant_id FROM sys_company WHERE code = 'DEMO' AND deleted_at IS NULL`)).rows[0];
  if (!co) await fail('ซ้อม: ไม่พบบริษัท DEMO ในสำเนา');
  const adm = (await b.query(`SELECT u.id FROM sys_user u JOIN sys_user_group g ON g.id = u.user_group_id WHERE g.code = 'ADMIN' AND u.status = 'A' AND u.deleted_at IS NULL AND u.tenant_id = $1 AND g.tenant_id = $1`, [co.tenant_id])).rows[0];
  if (!adm) {
    const g = (await b.query(`SELECT id FROM sys_user_group WHERE tenant_id = $1 AND code = 'ADMIN'`, [co.tenant_id])).rows[0]
      ?? (await b.query(`INSERT INTO sys_user_group (tenant_id, code, name) VALUES ($1, 'ADMIN', 'ผู้ดูแล (ซ้อม)') RETURNING id`, [co.tenant_id])).rows[0];
    await b.query(`INSERT INTO sys_user (tenant_id, username, display_name, password_hash, user_group_id, approval_level) VALUES ($1, 'demo.admin', 'ผู้ดูแลซ้อม', '!', $2, 9)`, [co.tenant_id, g.id]);
  }
  await b.end();
  const env = childEnv({ DATABASE_URL: buddyUrl, BUDDY_SECRET_KEY: randomBytes(32).toString('base64'), PORT: String(PORT), HOST: '127.0.0.1', LOG_LEVEL: 'warn' });
  server = spawn(process.execPath, [tsxOf(ROOT), 'src/main.ts'], { cwd: join(ROOT, 'apps/server'), env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let err = ''; server.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
  let up = false;
  for (let i = 0; i < 120 && !up && server.exitCode === null; i++) {
    try { up = (await fetch(`http://127.0.0.1:${PORT}/api/v1/health`)).ok; } catch { /* */ }
    if (!up) await new Promise((res) => setTimeout(res, 1000));
  }
  if (!up) await fail(`ซ้อม: เปิด Buddy ชั่วคราวไม่สำเร็จ — ${err.split(/\r?\n/).filter(Boolean).slice(-3).join(' / ')}`);
  buddyApi = `http://127.0.0.1:${PORT}`;
  out(`✓ ซ้อม: สำเนา DEMO + Buddy ชั่วคราว (พอร์ต ${PORT}) + WTS-POS ฐานชั่วคราว`);
} else {
  const envFile = join(ROOT, '.data/cloud-prod.env');
  if (!existsSync(envFile)) await fail('ไม่พบ .data/cloud-prod.env');
  const env = readEnv(envFile);
  if (!env.SUPABASE_PROJECT_URL || !env.WTSPOS_SECRET_KEY) await fail('ไม่พบ SUPABASE_PROJECT_URL / WTSPOS_SECRET_KEY ใน .data/cloud-prod.env');
  buddyUrl = withDb(env.SUPABASE_PROJECT_URL, 'buddy');
  posDb = withDb(env.SUPABASE_PROJECT_URL, 'wtspos');
  posKey = env.WTSPOS_SECRET_KEY;
  buddyApi = 'https://buddy-api.worktruesolution.net';
  secrets.add(buddyUrl); secrets.add(posDb); secrets.add(posKey);
  out('# ตัวอย่างทั้งระบบ บริษัท ดับบลิวทีเอส ฟู้ด (ทดลอง) — คลาวด์ wts-prod (ประมาณ 10–20 นาที)');
}

/* ---------------------------------------------------------------- 1) Buddy: บริษัท WFOOD */
let r = await run(process.execPath, [tsxOf(ROOT), '../../tools/cloud/food-company.mts'], join(ROOT, 'apps/server'), childEnv({ DATABASE_URL: buddyUrl, FOOD_CODE: BUDDY_CODE, FOOD_NAME: NAME }));
const made = (() => { try { return JSON.parse(r.lines.filter((l) => l.startsWith('{')).pop() ?? ''); } catch { return null; } })();
if (r.code !== 0 || !made?.id) await fail(`Buddy: สร้างบริษัท ${BUDDY_CODE} ไม่ได้ — ${r.lines.slice(-3).join(' / ')}`);
out(`✓ Buddy: บริษัท ${BUDDY_CODE} ${NAME}${made.created ? ' (สร้างใหม่ — ผังบัญชี/ประเภทเอกสาร/ค่าตั้งจาก DEMO)' : ' (มีอยู่แล้ว)'}`);

/* ---------------------------------------------------------------- 2) Buddy: กุญแจ API ของ WFOOD */
const b = new pg.Client({ connectionString: buddyUrl, connectionTimeoutMillis: 20_000 });
b.on('error', () => {});
await b.connect();
let key;
try {
  const co = (await b.query(`SELECT c.id, c.tenant_id FROM sys_company c WHERE c.id = $1`, [made.id])).rows[0];
  const adm = (await b.query(`SELECT u.id, u.username FROM sys_user u JOIN sys_user_group g ON g.id = u.user_group_id
    WHERE g.code = 'ADMIN' AND u.status = 'A' AND u.deleted_at IS NULL AND u.tenant_id = $1 AND g.tenant_id = $1 ORDER BY u.created_at LIMIT 1`, [co.tenant_id])).rows[0];
  if (!adm) await fail('ไม่พบผู้ดูแลของลูกค้าใน Buddy');
  const log = (action, docNo, rowId, detail) => b.query(`INSERT INTO sys_activity_log (company_id, user_id, module, action, doc_no, table_name, row_id, detail) VALUES ($1, $2, 'SET.API', $3, $4, 'sys_api_key', $5, $6)`,
    [co.id, adm.id, action, docNo, rowId, JSON.stringify({ ...detail, via: 'tools/cloud/food-demo.mjs' })]);
  await b.query('BEGIN');
  const old = (await b.query(`UPDATE sys_api_key SET status = 'I', updated_by = $3, updated_at = now() WHERE company_id = $1 AND name = $2 AND status = 'A' AND deleted_at IS NULL RETURNING id, key_prefix`, [co.id, KEY_NAME, adm.id])).rows;
  for (const o of old) await log('API_KEY_REVOKE', `bk_${o.key_prefix}`, o.id, { name: KEY_NAME });
  const prefix = randomBytes(6).toString('hex'), secret = randomBytes(24).toString('base64url');
  key = `bk_${prefix}_${secret}`;
  const k = (await b.query(`INSERT INTO sys_api_key (company_id, user_id, name, key_prefix, key_hash, read_only, source_system, doc_scope, created_by, updated_by)
    VALUES ($1, $2, $3, $4, $5, false, 'wts-pos', 'S', $2, $2) RETURNING id`, [co.id, adm.id, KEY_NAME, prefix, sha(secret)])).rows[0];
  await log('API_KEY_CREATE', `bk_${prefix}`, k.id, { name: KEY_NAME, user: adm.username, read_only: false, source_system: 'wts-pos', doc_scope: 'S' });
  await b.query('COMMIT');
  out(`✓ Buddy: กุญแจ "${KEY_NAME}" ของ ${BUDDY_CODE} ในนาม ${adm.username} (ยกเลิกรุ่นก่อน ${old.length} ดอก)`);
} catch (e) {
  await b.query('ROLLBACK').catch(() => {});
  await b.end().catch(() => {});
  await fail(`Buddy: ${e.message}`);
}
await b.end();

/* ---------------------------------------------------------------- 3) WTS-POS: บริษัท WF ผูกกับ WFOOD */
const p = new pg.Client({ connectionString: posDb, connectionTimeoutMillis: 20_000 });
p.on('error', () => {});
await p.connect();
await p.query(`INSERT INTO core.companies (code, name_th, year_system) VALUES ($1, $2, 'B') ON CONFLICT DO NOTHING`, [POS_CODE, NAME]).catch(async () =>
  p.query(`INSERT INTO core.companies (code, name_th) SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM core.companies WHERE code = $1)`, [POS_CODE, NAME]));
await p.end();
const file = join(ROOT, `.data/link-fd-${randomBytes(6).toString('hex')}.key`);
try {
  writeFileSync(file, key, { encoding: 'utf8', mode: 0o600 });
  r = await run(process.execPath, [tsxOf(POS_ROOT), 'tools/hub/link-buddy.mts'], POS_ROOT, childEnv({
    DATABASE_URL: posDb, WTSPOS_SECRET_KEY: posKey, BUDDY_LINK_KEY_FILE: file, BUDDY_LINK_URL: buddyApi,
    BUDDY_LINK_DESTINATION: 'buddy', BUDDY_LINK_BUDDY_COMPANY_ID: made.id, BUDDY_LINK_COMPANY: POS_CODE,
  }));
} finally { rmSync(file, { force: true }); }
for (const l of r.lines.filter((x) => /^[✓✗]/.test(x))) out(l);
if (r.code !== 0) await fail(`WTS-POS: ผูกบริษัท ${POS_CODE} กับ ${BUDDY_CODE} ไม่ได้ — ${r.lines.slice(-3).join(' / ')}`);

/* ---------------------------------------------------------------- 4) WTS-POS: ข้อมูลทั้งระบบ */
const demoEnv = { DATABASE_URL: posDb, WTSPOS_SECRET_KEY: posKey, POS_DEMO_OUT: OUT, POS_DEMO_COMPANY: POS_CODE, WTSPOS_FEED_EVERY: '0', WTSPOS_OUTBOX_EVERY: '0' };
r = await run(process.execPath, [tsxOf(POS_ROOT), 'tools/hub/food-demo.mts'], POS_ROOT, childEnv(demoEnv), true);
if (r.code !== 0) { for (const l of r.lines.slice(-6)) if (!/^(✓|✗|  …)/.test(l)) out(`  ${l}`); await fail('สร้างตัวอย่างทั้งระบบไม่สำเร็จ (รันซ้ำได้ — ส่วนที่ทำแล้วจะข้าม)'); }

if (REHEARSE) try {
  const c = new pg.Client({ connectionString: posDb }); await c.connect();
  const n = (await c.query(`SELECT (SELECT count(*) FROM pos.days d JOIN core.companies co ON co.id = d.company_id WHERE co.code = $1) AS days,
      (SELECT count(*) FROM pos.outbox o JOIN core.companies co ON co.id = o.company_id WHERE co.code = $1 AND o.status = 'sent') AS sent,
      (SELECT count(*) FROM pos.outbox o JOIN core.companies co ON co.id = o.company_id WHERE co.code = $1 AND o.status NOT IN ('sent', 'skipped')) AS open,
      (SELECT count(*) FROM pos.stores s JOIN core.companies co ON co.id = s.company_id WHERE co.code = $1) AS stores`, [POS_CODE])).rows[0];
  await c.end();
  const ok = Number(n.days) > 0 && Number(n.sent) > 0 && Number(n.open) === 0 && Number(n.stores) === 3 && existsSync(OUT) && /#pair=wtspos_/.test(readFileSync(OUT, 'utf8'));
  out(`${ok ? '✓' : '✗'} ตรวจ: ร้าน ${n.stores} · ยอดวัน ${n.days} · ส่งเข้า Buddy แล้ว ${n.sent} เอกสาร · ค้าง ${n.open}`);
  const again = await run(process.execPath, [tsxOf(POS_ROOT), 'tools/hub/food-demo.mts'], POS_ROOT, childEnv({ ...demoEnv, POS_DEMO_OUT: OUT + '.again' }));
  const noDup = again.code === 0 && again.lines.some((l) => l.includes('ไม่ส่งซ้ำ'));
  out(`${noDup ? '✓' : '✗'} รันซ้ำ: ${noDup ? 'ไม่สร้างซ้ำ · ยอดขายไม่ส่งซ้ำ · กุญแจ/PIN ใหม่ใช้ได้' : again.lines.filter((l) => /^✗/.test(l)).slice(-2).join(' / ') || again.lines.slice(-2).join(' / ')}`);
  rmSync(OUT + '.again', { force: true });
  await cleanup();
  process.exit(ok && noDup ? 0 : 1);
} catch (e) { await fail(`ซ้อม: ตรวจผลไม่ได้ — ${e.message}`); }
out(`\n✓ เสร็จ — ลิงก์จับคู่เครื่องขาย/PIN อยู่ในไฟล์ ${OUT}`);
out('  เปิดไฟล์: notepad "' + OUT + '"');
