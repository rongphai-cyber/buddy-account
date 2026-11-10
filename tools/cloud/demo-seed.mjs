// บริษัทตัวอย่างบนคลาวด์ให้ลูกค้าทดลองใช้ (เจ้าของ 10/11/2569) — ลูกค้าผู้ใช้บริการ DEMO แยกขาดจากบริษัทจริง · ข้อมูลทั้งปี 2569 ครบทุกเมนู
//
//   node tools/cloud/demo-seed.mjs                                         ใส่ในฐานใช้งานจริง wts-prod (เจ้าของรัน — ผู้ช่วยเขียนฐานจริงไม่ได้)
//   node tools/local-pg/pg.mjs run -- node tools/cloud/demo-seed.mjs --rehearse   ซ้อมในเครื่อง: ฐาน rehearse_demo ใหม่ (ลบเมื่อจบ) — ไม่แตะ DEMO
//
// ขั้นตอน (ทุกการเขียนข้อมูลบริษัทผ่าน API เหมือนผู้ใช้คีย์ — tools/demo-check/seed-year.mjs · docs/15)
//  1. ผู้ใช้ชั่วคราว demo.seed (ผู้ให้บริการ · กลุ่มเดียวกับผู้ดูแลคนแรก · รหัสสุ่ม) — ต้องตั้งค่าครั้งแรกบนคลาวด์แล้ว
//  2. เปิด Buddy ชั่วคราวในเครื่องนี้ (พอร์ต 4102) ต่อฐานคลาวด์ด้วยกุญแจหลักเดียวกับคลาวด์ (BUDDY_SECRET_KEY ใน .data/cloud-prod.env)
//  3. สร้างลูกค้า DEMO "ลูกค้าทดลอง (บริษัทตัวอย่าง)" + ผู้ดูแลของลูกค้า demo.admin ผ่าน API
//  4. seed-year.mjs: บริษัท DEMO ทั้งปี + ผู้ใช้ทดลอง sale1 / acc1 + ตรวจ 14 ข้อ
//  5. ปิด demo.seed + ปิด Buddy ชั่วคราว · รหัสผู้ใช้ทดลองเก็บใน .data (ไม่ขึ้นจอ ไม่เข้า git)
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const req = createRequire(join(ROOT, 'apps/server/package.json'));
const pg = req('pg');
const bcrypt = req('bcryptjs');
const REHEARSE = process.argv.includes('--rehearse');
const PORT = 4102;
const BASE = `http://127.0.0.1:${PORT}`;
const SEED_FILE = join(ROOT, REHEARSE ? '.data/rehearse-demo-seed.txt' : '.data/cloud-demo-seed.txt');
const USERS_FILE = join(ROOT, REHEARSE ? '.data/rehearse-demo-users.txt' : '.data/ข้อมูลเข้าระบบ-บริษัทตัวอย่างบนคลาวด์.txt');
const TENANT = { code: 'DEMO', name: 'ลูกค้าทดลอง (บริษัทตัวอย่าง)' };

const secrets = new Set();
const mask = (t) => { let s = String(t ?? '').replace(/postgres(?:ql)?:\/\/[^\s'"`)]+/gi, 'postgres://***'); for (const x of secrets) if (x && x.length >= 6) s = s.split(x).join('***'); return s; };
const out = (l = '') => console.log(mask(l));
const fail = (m) => { out(`✗ ${m}`); process.exit(1); };
const withDb = (url, db) => { const u = new URL(url); u.pathname = `/${db}`; return u.toString(); };
const randPass = (p) => `${p}-${randomBytes(9).toString('base64url')}7a`;

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

function run(cmd, args, env, { quiet = false } = {}) {
  return new Promise((done) => {
    const ch = spawn(cmd, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = [];
    const onData = (d) => {
      for (const l of String(d).split(/\r?\n/)) {
        if (!l.trim()) continue;
        tail.push(l); if (tail.length > 40) tail = tail.slice(-40);
        if (!quiet) out(`  ${l}`);
      }
    };
    ch.stdout.on('data', onData);
    ch.stderr.on('data', onData);
    ch.on('close', (code) => done({ code, tail }));
  });
}

/* ---------------------------------------------------------------- เป้าหมาย */
let dbUrl, secretKey, admin;
if (REHEARSE) {
  if (!process.env.DATABASE_URL) fail('โหมดซ้อมต้องรันผ่าน node tools/local-pg/pg.mjs run --');
  admin = new pg.Client({ connectionString: withDb(process.env.DATABASE_URL, 'postgres') });
  await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS rehearse_demo WITH (FORCE)');
  await admin.query(`CREATE DATABASE rehearse_demo ENCODING 'UTF8'`);
  dbUrl = withDb(process.env.DATABASE_URL, 'rehearse_demo');
  secretKey = randomBytes(32).toString('base64');
} else {
  const envFile = join(ROOT, '.data/cloud-prod.env');
  if (!existsSync(envFile)) fail('ไม่พบ .data/cloud-prod.env');
  const env = readEnv(envFile);
  if (!env.SUPABASE_PROJECT_URL) fail('ไม่พบ SUPABASE_PROJECT_URL ใน .data/cloud-prod.env');
  if (!env.BUDDY_SECRET_KEY) fail('ไม่พบ BUDDY_SECRET_KEY ใน .data/cloud-prod.env — รัน node tools/cloud/put-secrets.mjs ก่อน');
  dbUrl = withDb(env.SUPABASE_PROJECT_URL, 'buddy');
  secretKey = env.BUDDY_SECRET_KEY;
}
secrets.add(dbUrl); secrets.add(secretKey);
out(`# บริษัทตัวอย่างบนคลาวด์ — ${REHEARSE ? 'ซ้อมในเครื่อง (ฐาน rehearse_demo)' : 'ฐานใช้งานจริง wts-prod / buddy'}`);

const db = new pg.Client({ connectionString: dbUrl });
await db.connect();
const q = async (t, p) => (await db.query(t, p)).rows;
let server;
let ok = false;
try {
  if (REHEARSE) {
    // ซ้อม: ฐานใหม่ต้องมีผู้ดูแลคนแรกเหมือนเจ้าของตั้งค่าครั้งแรกบนคลาวด์ — สร้างผ่านหน้า setup หลังเปิด server (ด้านล่าง)
  } else {
    const n = (await q(`SELECT count(*)::int AS n FROM sys_user WHERE tenant_id IS NULL AND status = 'A' AND deleted_at IS NULL AND username <> 'demo.seed'`))[0]?.n ?? 0;
    if (!n) fail('ยังไม่ได้ตั้งค่าครั้งแรกบนคลาวด์ — เปิด https://app.worktruesolution.net สร้างผู้ดูแลระบบก่อน แล้วรันใหม่');
    const t = await q(`SELECT t.id FROM sys_tenant t JOIN sys_company c ON c.tenant_id = t.id AND c.deleted_at IS NULL WHERE t.code = $1 AND c.code = $1`, [TENANT.code]);
    if (t.length) fail('มีบริษัทตัวอย่าง DEMO บนคลาวด์แล้ว — ไม่สร้างซ้ำ');
  }

  // 2) เปิด Buddy ชั่วคราว
  const env = { ...process.env, DATABASE_URL: dbUrl, BUDDY_SECRET_KEY: secretKey, PORT: String(PORT), HOST: '127.0.0.1', BUDDY_REQUIRE_ADMIN_2FA: '0', LOG_LEVEL: 'warn' };
  delete env.BUDDY_DATA_DIR;
  server = spawn(process.execPath, [join(ROOT, 'apps/server/node_modules/tsx/dist/cli.mjs'), 'src/main.ts'], { cwd: join(ROOT, 'apps/server'), env, stdio: ['ignore', 'ignore', 'pipe'] });
  let serverErr = '';
  server.stderr.on('data', (d) => { serverErr = (serverErr + d).slice(-2000); });
  let up = false;
  for (let i = 0; i < 180 && !up; i++) {
    try { up = (await fetch(`${BASE}/api/v1/health`)).ok; } catch { /* */ }
    if (!up) await new Promise((r) => setTimeout(r, 1000));
    if (server.exitCode !== null) break;
  }
  if (!up) fail(`เปิด Buddy ชั่วคราวไม่สำเร็จ — ${serverErr.split(/\r?\n/).filter(Boolean).slice(-3).join(' / ')}`);
  out('✓ เปิด Buddy ชั่วคราว (พอร์ต 4102) ต่อฐานแล้ว');

  if (REHEARSE) {
    const r = await fetch(`${BASE}/api/v1/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'owner', display_name: 'เจ้าของ (ซ้อม)', password: randPass('Own') }) });
    if (!r.ok) fail(`ซ้อม: ตั้งค่าครั้งแรกไม่สำเร็จ (${r.status})`);
  }

  // 1) ผู้ใช้ชั่วคราว demo.seed — กลุ่มเดียวกับผู้ดูแลคนแรกของผู้ให้บริการ
  const seedPass = randPass('Seed');
  secrets.add(seedPass);
  const grp = (await q(`SELECT user_group_id FROM sys_user WHERE tenant_id IS NULL AND status = 'A' AND deleted_at IS NULL AND username <> 'demo.seed' ORDER BY created_at LIMIT 1`))[0];
  if (!grp) fail('ไม่พบผู้ดูแลระบบของผู้ให้บริการ');
  const hash = await bcrypt.hash(seedPass, 10);
  const cur = (await q(`SELECT id FROM sys_user WHERE username = 'demo.seed' AND tenant_id IS NULL`))[0];
  if (cur) await q(`UPDATE sys_user SET password_hash = $1, status = 'A', user_group_id = $2, approval_level = 9, deleted_at = NULL WHERE id = $3`, [hash, grp.user_group_id, cur.id]);
  else await q(`INSERT INTO sys_user (tenant_id, username, display_name, password_hash, user_group_id, approval_level) VALUES (NULL, 'demo.seed', 'ผู้ใส่ข้อมูลตัวอย่าง (ชั่วคราว)', $1, $2, 9)`, [hash, grp.user_group_id]);
  writeFileSync(SEED_FILE, `ผู้ใช้ชั่วคราวสำหรับใส่บริษัทตัวอย่าง (ปิดเองเมื่อจบ)\nรหัสผู้ใช้: demo.seed\nรหัสผ่าน: ${seedPass}\n`, 'utf8');
  out('✓ ผู้ใช้ชั่วคราว demo.seed พร้อม');

  // 3) ลูกค้า DEMO + ผู้ดูแลของลูกค้า (ผ่าน API ของผู้ให้บริการ)
  let cookie = '';
  const call = async (method, url, body) => {
    const r = await fetch(BASE + url, { method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const login = await call('POST', '/api/v1/auth/login', { username: 'demo.seed', password: seedPass });
  if (login.status !== 200) fail(`demo.seed เข้าระบบไม่ได้ (${login.status})`);
  const tenants = (await call('GET', '/api/v1/tenants')).body ?? [];
  const adminPass = randPass('Demo');
  secrets.add(adminPass);
  if (!tenants.some((t) => t.code === TENANT.code)) {
    const r = await call('POST', '/api/v1/tenants', { ...TENANT, admin_username: 'demo.admin', admin_name: 'ผู้ดูแลบริษัทตัวอย่าง', admin_password: adminPass });
    if (r.status !== 200) fail(`สร้างลูกค้า DEMO ไม่ได้ (${r.status}) ${JSON.stringify(r.body?.error ?? r.body).slice(0, 200)}`);
    out('✓ สร้างลูกค้าทดลอง DEMO + ผู้ดูแล demo.admin');
  } else out('  ลูกค้า DEMO มีอยู่แล้ว (ใช้ต่อ)');

  // 4) บริษัท DEMO ทั้งปี
  out('▶ ใส่ข้อมูลทั้งปี (seed-year.mjs — บนคลาวด์ใช้เวลานานกว่าในเครื่องเพราะฐานอยู่สิงคโปร์)');
  const r = await run(process.execPath, [join(ROOT, 'tools/demo-check/seed-year.mjs')],
    { ...process.env, SEED_LIVE: '1', BASE, DATABASE_URL: dbUrl, DEMO_SEED_FILE: SEED_FILE, DEMO_USERS_FILE: USERS_FILE }, { quiet: false });
  if (r.code !== 0) { out(`✗ seed-year จบด้วย exit ${r.code}`); }
  else {
    ok = true;
    const users = existsSync(USERS_FILE) ? readFileSync(USERS_FILE, 'utf8') : '';
    writeFileSync(USERS_FILE, `${users}\nผู้ดูแลของลูกค้าทดลอง (ตั้งค่าได้ทุกอย่างของบริษัทตัวอย่าง — ต้องเปิดยืนยันตัวตนสองขั้นเมื่อเข้าครั้งแรก)\nรหัสผู้ใช้: demo.admin\nรหัสผ่าน: ${adminPass}\n`, 'utf8');
  }
} finally {
  // 5) ปิด demo.seed + ปิด server ชั่วคราว
  await db.query(`UPDATE sys_user SET status = 'I' WHERE username = 'demo.seed' AND tenant_id IS NULL`).catch(() => {});
  await db.query(`UPDATE sys_session SET ended_at = now() WHERE ended_at IS NULL AND user_id IN (SELECT id FROM sys_user WHERE username = 'demo.seed')`).catch(() => {});
  rmSync(SEED_FILE, { force: true });
  if (server && server.exitCode === null) server.kill();
  await db.end().catch(() => {});
  if (REHEARSE && admin) {
    await new Promise((r) => setTimeout(r, 1500));
    await admin.query('DROP DATABASE IF EXISTS rehearse_demo WITH (FORCE)').catch((e) => out(`ลบฐานซ้อมไม่ได้: ${e.message}`));
    await admin.end().catch(() => {});
    rmSync(USERS_FILE, { force: true });
    out('ซ้อมเสร็จ — ลบฐาน rehearse_demo แล้ว');
  }
}
out(!ok ? '\n✗ ไม่สำเร็จ (ดูข้อความด้านบน)' : REHEARSE ? '\n✓ ซ้อมผ่าน (ลบฐานและแฟ้มรหัสของการซ้อมแล้ว)' : `\n✓ บริษัทตัวอย่างพร้อม — รหัสผู้ใช้ทดลองอยู่ใน ${USERS_FILE.replace(ROOT, '.')} (ไม่แสดงบนจอ)`);
process.exit(ok ? 0 : 1);
