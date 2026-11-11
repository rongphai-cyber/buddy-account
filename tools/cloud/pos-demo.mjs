#!/usr/bin/env node
// ข้อมูลทดลองเครื่องขาย WTS-POS บนคลาวด์ (HANDOFF ข้อ 116 · README ข้อ 9) — เจ้าของรัน
//
//   node tools\cloud\pos-demo.mjs                      คลาวด์: บริษัทใน WTS-POS ที่เชื่อม Buddy (บริษัทตัวอย่าง DEMO)
//   node tools/local-pg/pg.mjs run -- node tools/cloud/pos-demo.mjs --rehearse
//                                                      ซ้อม: สำเนา DEMO ในเครื่อง + Buddy ชั่วคราว (พอร์ต 4104) + WTS-POS ฐานชั่วคราว แล้วลบทิ้ง
//
// งานจริงอยู่ที่ E:\WTS-POS\tools\hub\pos-demo.mts (ผ่าน API ของ WTS-POS + กุญแจ Buddy ของบริษัท) — ไฟล์นี้ส่งที่อยู่ฐาน/กุญแจหลักให้ และซ้อม
// ผล: เมนูร้านกาแฟ 14 · ร้าน CF01 · เครื่องขาย 2 · พนักงาน 2 (PIN) · บริการ POS-FOOD / POS-BEV ใน Buddy
// กุญแจเครื่อง/PIN อยู่ในไฟล์ .data\ข้อมูลเข้าทดลอง-เครื่องขาย-คลาวด์.txt (ไม่ขึ้นจอ · ไม่เข้า git)
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
const PORT = 4104;
const PG17 = join(ROOT, '.data/pg17/pgsql/bin');
const OUT = join(ROOT, REHEARSE ? '.data/rehearse-pos-demo.txt' : '.data/ข้อมูลเข้าทดลอง-เครื่องขาย-คลาวด์.txt');

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
function run(cmd, args, cwd, env) {
  return new Promise((done) => {
    const ch = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let text = '';
    ch.stdout.on('data', (d) => { text += d; });
    ch.stderr.on('data', (d) => { text += d; });
    ch.on('close', (code) => done({ code, lines: text.split(/\r?\n/).filter((l) => l.trim()) }));
    ch.on('error', (e) => done({ code: -1, lines: [String(e)] }));
  });
}
if (!existsSync(join(POS_ROOT, 'tools/hub/pos-demo.mts')) || !existsSync(tsxOf(POS_ROOT)))
  await fail(`ไม่พบ ${POS_ROOT}\\tools\\hub\\pos-demo.mts หรือแพ็กเกจของ WTS-POS — git pull และ pnpm install ใน ${POS_ROOT}`);

let posDb, posKey;
if (REHEARSE) {
  /* ---------------------------------------------------------------- ซ้อม */
  if (!process.env.DATABASE_URL) await fail('โหมดซ้อมต้องรันผ่าน node tools/local-pg/pg.mjs run --');
  const local = process.env.DATABASE_URL;
  const srcDb = new URL(local).pathname.slice(1);
  const bDb = 'rehearse_pd_buddy', pDb = 'rehearse_pd_pos';
  const admin = new pg.Client({ connectionString: withDb(local, 'postgres') });
  await admin.connect();
  let server;
  cleanup = async () => {
    if (server && server.exitCode === null) { server.kill(); await new Promise((r) => setTimeout(r, 1500)); }
    for (const d of [bDb, pDb]) await admin.query(`DROP DATABASE IF EXISTS ${d} WITH (FORCE)`).catch((e) => out(`ลบฐาน ${d} ไม่ได้: ${e.message}`));
    await admin.end().catch(() => {});
    rmSync(OUT, { force: true });
    out('ซ้อมเสร็จ — ลบฐาน rehearse_pd_* และไฟล์ผลซ้อมแล้ว');
  };
  for (const d of [bDb, pDb]) { await admin.query(`DROP DATABASE IF EXISTS ${d} WITH (FORCE)`); await admin.query(`CREATE DATABASE ${d} ENCODING 'UTF8' TEMPLATE template0`); }
  // สำเนา DEMO ในเครื่อง (ฐาน ${srcDb}) → rehearse_pd_buddy ด้วย PostgreSQL 17 (README ข้อ 8)
  const u = new URL(local); const pw = decodeURIComponent(u.password); u.password = '';
  const exe = (n) => join(PG17, `${n}.exe`);
  if (!existsSync(exe('pg_dump'))) await fail('ซ้อมต้องมี PostgreSQL 17 ใน .data\\pg17 (README ข้อ 8)');
  const dump = join(ROOT, `.data/rehearse-pd-${randomBytes(4).toString('hex')}.dump`);
  try {
    let r = await run(exe('pg_dump'), ['--no-password', '--format=custom', `--file=${dump}`, `--dbname=${withDb(u.toString(), srcDb)}`], ROOT, childEnv({ PGPASSWORD: pw }));
    if (r.code !== 0) await fail(`ซ้อม: สำเนา DEMO ไม่ได้ — ${r.lines.slice(-2).join(' / ')}`);
    // สิทธิ์ของ role buddy_app ต้องติดมาด้วย (Buddy สลับเป็น role นี้ทุกคำขอ) — เครื่องเดียวกันมี role ครบ จึงคงเจ้าของ/สิทธิ์เดิม
    r = await run(exe('pg_restore'), ['--no-password', `--dbname=${withDb(u.toString(), bDb)}`, dump], ROOT, childEnv({ PGPASSWORD: pw }));
    if (r.code !== 0 && r.lines.some((l) => /error:/i.test(l) && !/transaction_timeout/i.test(l))) await fail(`ซ้อม: นำสำเนา DEMO เข้า ${bDb} ไม่ได้ — ${r.lines.filter((l) => /error/i.test(l)).slice(0, 2).join(' / ')}`);
  } finally { rmSync(dump, { force: true }); }
  const buddyUrl = withDb(local, bDb);
  posDb = withDb(local, pDb);
  posKey = randomBytes(32).toString('base64');
  secrets.add(buddyUrl); secrets.add(posDb); secrets.add(posKey);
  // migration ของ WTS-POS + บริษัทซ้อม
  let r = await run(process.execPath, [tsxOf(POS_ROOT), 'src/cli.ts', 'migrate'], join(POS_ROOT, 'apps/server'), childEnv({ DATABASE_URL: posDb }));
  if (r.code !== 0) await fail(`ซ้อม: migration WTS-POS ไม่ผ่าน — ${r.lines.slice(-3).join(' / ')}`);
  const p = new pg.Client({ connectionString: posDb }); await p.connect();
  const s1 = (await p.query(`INSERT INTO core.companies (code, name_th) VALUES ('S1', 'TEST CoffeeShop ซ้อม') RETURNING id`)).rows[0];
  // บนคลาวด์มีผู้ใช้เจ้าของแล้ว (เปิดหลังร้าน POS จากการ์ดใน Buddy) — เครื่องขายทำงานในนามคนนี้
  const own = (await p.query(`INSERT INTO core.users (username, password_hash, full_name, active) VALUES ('rehearse.owner', '!', 'เจ้าของซ้อม', true) RETURNING id`)).rows[0];
  await p.query(`INSERT INTO core.company_users (company_id, user_id, role, is_active) VALUES ($1, $2, 'owner', true)`, [s1.id, own.id]);
  await p.end();
  // Buddy ชั่วคราวบนสำเนา DEMO
  const env = childEnv({ DATABASE_URL: buddyUrl, BUDDY_SECRET_KEY: randomBytes(32).toString('base64'), PORT: String(PORT), HOST: '127.0.0.1', LOG_LEVEL: 'warn' });
  server = spawn(process.execPath, [tsxOf(ROOT), 'src/main.ts'], { cwd: join(ROOT, 'apps/server'), env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let err = ''; server.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
  let up = false;
  for (let i = 0; i < 120 && !up && server.exitCode === null; i++) {
    try { up = (await fetch(`http://127.0.0.1:${PORT}/api/v1/health`)).ok; } catch { /* */ }
    if (!up) await new Promise((res) => setTimeout(res, 1000));
  }
  if (!up) await fail(`ซ้อม: เปิด Buddy ชั่วคราวไม่สำเร็จ — ${err.split(/\r?\n/).filter(Boolean).slice(-3).join(' / ')}`);
  // กุญแจ API บันทึกได้ของ DEMO (แบบ link-apps) → ใส่ใน WTS-POS ซ้อม
  const b = new pg.Client({ connectionString: buddyUrl }); await b.connect();
  const co = (await b.query(`SELECT id, tenant_id FROM sys_company WHERE code = 'DEMO' AND deleted_at IS NULL`)).rows[0];
  if (!co) await fail('ซ้อม: ไม่พบบริษัท DEMO ในสำเนา');
  // บนคลาวด์ กุญแจเป็นของผู้ดูแลของลูกค้า (demo.admin กลุ่ม ADMIN ของลูกค้า — link-apps) · DEMO ในเครื่องไม่มี → สร้างในสำเนาให้เหมือนคลาวด์
  const findAdm = async () => (await b.query(`SELECT u.id FROM sys_user u JOIN sys_user_group g ON g.id = u.user_group_id
    WHERE g.code = 'ADMIN' AND u.status = 'A' AND u.deleted_at IS NULL AND u.tenant_id = $1 AND g.tenant_id = $1 ORDER BY u.created_at LIMIT 1`, [co.tenant_id])).rows[0];
  let adm = await findAdm();
  if (!adm) {
    const g = (await b.query(`SELECT id FROM sys_user_group WHERE tenant_id = $1 AND code = 'ADMIN'`, [co.tenant_id])).rows[0]
      ?? (await b.query(`INSERT INTO sys_user_group (tenant_id, code, name) VALUES ($1, 'ADMIN', 'ผู้ดูแล (ซ้อม)') RETURNING id`, [co.tenant_id])).rows[0];
    await b.query(`INSERT INTO sys_user (tenant_id, username, display_name, password_hash, user_group_id, approval_level) VALUES ($1, 'demo.admin', 'ผู้ดูแลซ้อม', '!', $2, 9)`, [co.tenant_id, g.id]);
    adm = await findAdm();
  }
  if (!adm) await fail('ซ้อม: สร้างผู้ดูแลของ DEMO ในสำเนาไม่ได้');
  const prefix = randomBytes(6).toString('hex'), secret = randomBytes(24).toString('base64url');
  await b.query(`INSERT INTO sys_api_key (company_id, user_id, name, key_prefix, key_hash, read_only, source_system, doc_scope, created_by, updated_by)
    VALUES ($1, $2, 'WTS-POS (ซ้อม)', $3, $4, false, 'wts-pos', 'S', $2, $2)`, [co.id, adm.id, prefix, sha(secret)]);
  await b.end();
  const file = join(ROOT, `.data/link-pd-${randomBytes(6).toString('hex')}.key`);
  try {
    writeFileSync(file, `bk_${prefix}_${secret}`, { encoding: 'utf8', mode: 0o600 });
    r = await run(process.execPath, [tsxOf(POS_ROOT), 'tools/hub/link-buddy.mts'], POS_ROOT, childEnv({
      DATABASE_URL: posDb, WTSPOS_SECRET_KEY: posKey, BUDDY_LINK_KEY_FILE: file, BUDDY_LINK_URL: `http://127.0.0.1:${PORT}`,
      BUDDY_LINK_DESTINATION: 'buddy', BUDDY_LINK_BUDDY_COMPANY_ID: co.id,
    }));
  } finally { rmSync(file, { force: true }); }
  if (r.code !== 0) await fail(`ซ้อม: เชื่อม WTS-POS ซ้อมกับ Buddy ไม่ได้ — ${r.lines.slice(-3).join(' / ')}`);
  out(`✓ ซ้อม: สำเนา DEMO + Buddy ชั่วคราว (พอร์ต ${PORT}) + WTS-POS ฐานชั่วคราว เชื่อมกันแล้ว`);
} else {
  const envFile = join(ROOT, '.data/cloud-prod.env');
  if (!existsSync(envFile)) await fail('ไม่พบ .data/cloud-prod.env');
  const env = readEnv(envFile);
  if (!env.SUPABASE_PROJECT_URL || !env.WTSPOS_SECRET_KEY) await fail('ไม่พบ SUPABASE_PROJECT_URL / WTSPOS_SECRET_KEY ใน .data/cloud-prod.env');
  posDb = withDb(env.SUPABASE_PROJECT_URL, 'wtspos');
  posKey = env.WTSPOS_SECRET_KEY;
  secrets.add(posDb); secrets.add(posKey);
  out('# ข้อมูลทดลองเครื่องขาย WTS-POS บนคลาวด์ (wts-prod)');
}

const r = await run(process.execPath, [tsxOf(POS_ROOT), 'tools/hub/pos-demo.mts'], POS_ROOT, childEnv({
  DATABASE_URL: posDb, WTSPOS_SECRET_KEY: posKey, POS_DEMO_OUT: OUT, WTSPOS_FEED_EVERY: '0', WTSPOS_OUTBOX_EVERY: '0',
}));
for (const l of r.lines) if (/^[✓✗]|^บริษัท|^ร้าน/.test(l)) out(l);
if (r.code !== 0) { for (const l of r.lines.slice(-5)) if (!/^[✓✗]/.test(l)) out(`  ${l}`); await fail('สร้างข้อมูลทดลองไม่สำเร็จ (รันซ้ำได้ — ส่วนที่ทำแล้วจะข้าม)'); }

if (REHEARSE) try {
  const p = new pg.Client({ connectionString: posDb }); await p.connect();
  const n = (await p.query(`SELECT (SELECT count(*) FROM pos.menu_items) AS items, (SELECT count(*) FROM pos.stores WHERE code = 'CF01') AS stores,
    (SELECT count(*) FROM pos.devices WHERE active) AS tills, (SELECT count(*) FROM core.users WHERE username = 'pos.demo.seed' AND active) AS seed_active`)).rows[0];
  await p.end();
  const fileOk = existsSync(OUT) && /CF01-1[\s\S]*#pair=wtspos_/.test(readFileSync(OUT, 'utf8')) && /PIN \d{4}/.test(readFileSync(OUT, 'utf8'));
  const keysOk = r.lines.some((l) => l.includes('ใช้ได้ทั้ง 2 เครื่อง'));
  const ok = Number(n.items) === 14 && Number(n.stores) === 1 && Number(n.tills) === 2 && Number(n.seed_active) === 0 && fileOk && keysOk;
  out(`${ok ? '✓' : '✗'} ตรวจ: เมนู ${n.items} · ร้าน CF01 ${n.stores} · เครื่องขาย ${n.tills} · ผู้ใช้ชั่วคราวปิดแล้ว ${Number(n.seed_active) === 0 ? 'ใช่' : 'ไม่'} · ไฟล์ข้อมูลเข้า ${fileOk ? 'ครบ' : 'ไม่ครบ'}`);
  // รันซ้ำ = ไม่สร้างซ้ำ
  const again = await run(process.execPath, [tsxOf(POS_ROOT), 'tools/hub/pos-demo.mts'], POS_ROOT, childEnv({ DATABASE_URL: posDb, WTSPOS_SECRET_KEY: posKey, POS_DEMO_OUT: OUT + '.again' }));
  const noDup = again.code === 0 && again.lines.some((l) => l.includes('มีอยู่แล้ว — ไม่สร้างซ้ำ'));
  out(`${noDup ? '✓' : '✗'} รันซ้ำ: ${noDup ? 'ไม่สร้างซ้ำ' : again.lines.slice(-2).join(' / ')}`);
  rmSync(OUT + '.again', { force: true });
  // ซ่อมของรุ่นแรก: เครื่องในนามผู้ใช้ชั่วคราว (ที่ปิดแล้ว) → รันอีกครั้งต้องออกกุญแจ/PIN ใหม่ และกุญแจใหม่ใช้ได้
  const p2 = new pg.Client({ connectionString: posDb }); await p2.connect();
  await p2.query(`UPDATE pos.devices SET acting_user_id = (SELECT id FROM core.users WHERE username = 'pos.demo.seed')`);
  await p2.end();
  const fix = await run(process.execPath, [tsxOf(POS_ROOT), 'tools/hub/pos-demo.mts'], POS_ROOT, childEnv({ DATABASE_URL: posDb, WTSPOS_SECRET_KEY: posKey, POS_DEMO_OUT: OUT }));
  const fixed = fix.code === 0 && fix.lines.some((l) => l.includes('ซ่อมเครื่องขาย 2')) && fix.lines.some((l) => l.includes('ใช้ได้ทั้ง 2 เครื่อง'))
    && /PIN \d{4}/.test(readFileSync(OUT, 'utf8')) && /บัตรกำนัลแจกฟรี 50 บาท \(/.test(readFileSync(OUT, 'utf8'));
  out(`${fixed ? '✓' : '✗'} ซ่อมเครื่องขายรุ่นแรก: ${fixed ? 'กุญแจ/PIN ใหม่ใช้ได้ · บัตรกำนัลเดิมยังอยู่ในไฟล์' : fix.lines.filter((l) => /^[✓✗]|ซ่อม/.test(l)).slice(-3).join(' / ')}`);
  await cleanup();
  process.exit(ok && noDup && fixed ? 0 : 1);
} catch (e) { await fail(`ซ้อม: ตรวจผลไม่ได้ — ${e.message}`); }
out(`\n✓ เสร็จ — กุญแจเครื่อง/PIN อยู่ในไฟล์ ${OUT}`);
out('  เปิดไฟล์: notepad "' + OUT + '"');
