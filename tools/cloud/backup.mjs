#!/usr/bin/env node
// สำรองฐานข้อมูลบนคลาวด์ + ทดสอบกู้คืนจริง (S1 · HANDOFF ข้อ 112 · README ข้อ 8)
//
//   node tools/cloud/backup.mjs                 สำรอง 4 ฐาน (buddy wtspos wtsliving wtshr) จาก .data/cloud-prod.env แล้วทดสอบกู้คืนทันที
//   node tools/cloud/backup.mjs --verify [โฟลเดอร์]   ทดสอบกู้คืนอย่างเดียว (ไม่ระบุ = ชุดล่าสุด)
//   node tools/local-pg/pg.mjs run -- node tools/cloud/backup.mjs --rehearse
//                                               ซ้อมกับ PostgreSQL ในเครื่อง (DEMO) — เก็บที่ .data/backup-rehearse แล้วลบทิ้ง (--keep = ไม่ลบ)
//
// ที่เก็บ: WTS_BACKUP_DIR (ค่าเริ่มต้น E:\WTS-Backup\cloud) → <พ.ศ.-เดือน-วัน_ชั่วโมงนาที>\<ฐาน>.dump + manifest.json · เก็บ 30 วัน (ชุดใหม่ผ่านแล้วจึงลบชุดเก่า)
// โปรแกรม: PostgreSQL 17 ใน .data/pg17/pgsql/bin (WTS_PG17_BIN) — pg_dump ต้องรุ่นไม่ต่ำกว่าฐานบนคลาวด์ (17)
// สำรอง: นับแถวทุกตาราง + ยอดเดบิต/เครดิตของ Buddy ใน snapshot เดียวกับ pg_dump (--snapshot) → ตัวเลขตรงกับไฟล์สำรองเป๊ะ
// ทดสอบกู้คืน: เปิดฐานชั่วคราว PostgreSQL 17 ในเครื่อง (พอร์ตว่าง · ไม่แตะฐานใช้งาน) → pg_restore ทุกไฟล์ → นับแถวเทียบ manifest + ยอดเดบิต/เครดิต → ปิดและลบ
// ความลับ: รหัสผ่านส่งให้ pg_dump ทาง PGPASSWORD ไม่อยู่ในบรรทัดคำสั่ง · ข้อความบนจอปิดบังที่อยู่ฐาน
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const pg = createRequire(join(ROOT, 'apps/server/package.json'))('pg');
const argv = process.argv.slice(2);
const REHEARSE = argv.includes('--rehearse');
const VERIFY_ONLY = argv.includes('--verify');
const DBS = ['buddy', 'wtspos', 'wtsliving', 'wtshr'];
const KEEP_DAYS = 30;
const BIN = resolve(process.env.WTS_PG17_BIN ?? join(ROOT, '.data/pg17/pgsql/bin'));
const EXE = (n) => join(BIN, process.platform === 'win32' ? `${n}.exe` : n);
const BACKUP_ROOT = resolve(process.env.WTS_BACKUP_DIR ?? (REHEARSE ? join(ROOT, '.data/backup-rehearse') : 'E:/WTS-Backup/cloud'));
const FOLDER_RE = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})$/;

/* ---------------------------------------------------------------- ปิดบังความลับ */
const secrets = new Set();
const mask = (t) => {
  let s = String(t ?? '').replace(/postgres(?:ql)?:\/\/[^\s'"`)]+/gi, 'postgres://***');
  for (const x of [...secrets].sort((a, b) => b.length - a.length)) if (x && x.length >= 6) s = s.split(x).join('***');
  return s;
};
const out = (l = '') => console.log(mask(l));
let cleanup = async () => {};
const fail = async (m) => { out(`✗ ${m}`); await cleanup(); process.exit(1); };

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
const withDb = (url, db) => { const u = new URL(url); u.pathname = `/${db}`; return u.toString(); };
/** แยกรหัสผ่านออกจากที่อยู่ — ส่งให้โปรแกรม PostgreSQL ทาง PGPASSWORD */
const split = (url) => { const u = new URL(url); const pw = decodeURIComponent(u.password); u.password = ''; return { url: u.toString(), pw }; };
function pgEnv(pw) {
  const env = { ...process.env, PGPASSWORD: pw ?? '', PGCONNECT_TIMEOUT: '20' };
  for (const k of ['PGHOST', 'PGPORT', 'PGUSER', 'PGDATABASE', 'PGSERVICE', 'PGSSLMODE']) delete env[k];
  return env;
}
function run(cmd, args, { env, cwd = ROOT, input } = {}) {
  return new Promise((done) => {
    const ch = spawn(cmd, args, { cwd, env: env ?? process.env, stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    let so = '', se = '';
    ch.stdout.on('data', (d) => { so += d; });
    ch.stderr.on('data', (d) => { se += d; });
    if (input) ch.stdin.end(input);
    ch.on('close', (code) => done({ code, out: so, err: se }));
    ch.on('error', (e) => done({ code: -1, out: '', err: String(e) }));
  });
}
/** pg_ctl บน Windows: เซิร์ฟเวอร์ที่เปิดถือท่อ stdout/stderr ไว้ → รอ 'close' ไม่จบ — ปล่อยท่อ แล้วรอแค่ 'exit' */
function runExit(cmd, args) {
  return new Promise((done) => {
    const ch = spawn(cmd, args, { cwd: ROOT, stdio: 'ignore', windowsHide: true });
    ch.on('exit', (code) => done({ code }));
    ch.on('error', () => done({ code: -1 }));
  });
}
const logTail = (f) => { try { return readFileSync(f, 'utf8').trim().split(/\r?\n/).slice(-2).join(' | '); } catch { return ''; } };
const sha256File =(f) => new Promise((ok, no) => { const h = createHash('sha256'); createReadStream(f).on('data', (d) => h.update(d)).on('end', () => ok(h.digest('hex'))).on('error', no); });
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
const freePort = () => new Promise((ok) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
function thaiStamp(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return { folder: `${Number(p.year) + 543}-${p.month}-${p.day}_${p.hour}${p.minute}`, text: `${p.day}/${p.month}/${Number(p.year) + 543} ${p.hour}:${p.minute}` };
}

/** นับแถวทุกตาราง (ไม่รวมตารางระบบ) + ยอดเดบิต/เครดิตของ Buddy — ใช้ทั้งตอนสำรอง (ใน snapshot) และหลังกู้คืน */
async function measure(c) {
  const tables = (await c.query(`SELECT n.nspname AS s, c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_%' ORDER BY 1, 2`)).rows;
  const rows = {};
  for (const { s, t } of tables) rows[`${s}.${t}`] = Number((await c.query(`SELECT count(*)::bigint AS n FROM "${s.replace(/"/g, '""')}"."${t.replace(/"/g, '""')}"`)).rows[0].n);
  const checks = {};
  if (rows['public.gl_journal_line'] !== undefined && rows['public.gl_journal'] !== undefined) {
    const r = (await c.query(`SELECT coalesce(sum(l.debit), 0)::text AS dr, coalesce(sum(l.credit), 0)::text AS cr FROM gl_journal_line l
        JOIN gl_journal j ON j.id = l.journal_id WHERE j.doc_status <> 'C' AND j.deleted_at IS NULL`)).rows[0];
    checks.gl = { debit: r.dr, credit: r.cr };
  }
  return { rows, checks };
}

/* ---------------------------------------------------------------- สำรอง */
async function backup(sourceUrl, dbs, label) {
  const stamp = thaiStamp();
  const dir = join(BACKUP_ROOT, stamp.folder);
  if (existsSync(dir)) await fail(`มีโฟลเดอร์ ${dir} อยู่แล้ว — รอ 1 นาทีแล้วรันใหม่`);
  mkdirSync(dir, { recursive: true });
  const manifest = { format: 'wts-cloud-backup', version: 1, source: label, created_at: new Date().toISOString(), created_th: stamp.text, pg_dump: '', server: '', dbs: {} };
  manifest.pg_dump = (await run(EXE('pg_dump'), ['--version'])).out.trim();
  for (const db of dbs) {
    const { url, pw } = split(withDb(sourceUrl, db));
    const c = new pg.Client({ connectionString: withDb(sourceUrl, db) });
    try { await c.connect(); } catch (e) { await fail(`${db}: ต่อฐานไม่ได้ — ${e.message}`); }
    manifest.server ||= (await c.query('SHOW server_version')).rows[0].server_version;
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snap = (await c.query('SELECT pg_export_snapshot() AS s')).rows[0].s;
    const m = await measure(c);
    const file = join(dir, `${db}.dump`);
    const t0 = Date.now();
    const r = await run(EXE('pg_dump'), ['--format=custom', '--compress=6', `--snapshot=${snap}`, '--no-password', `--file=${file}`, `--dbname=${url}`], { env: pgEnv(pw) });
    await c.query('COMMIT').catch(() => {});
    await c.end().catch(() => {});
    if (r.code !== 0) await fail(`${db}: pg_dump ไม่สำเร็จ — ${r.err.trim().split(/\r?\n/).slice(-3).join(' | ')}`);
    const bytes = statSync(file).size;
    manifest.dbs[db] = { file: `${db}.dump`, bytes, sha256: await sha256File(file), tables: Object.keys(m.rows).length, rows_total: Object.values(m.rows).reduce((a, b) => a + b, 0), rows: m.rows, checks: m.checks };
    out(`✓ สำรอง ${db}: ${manifest.dbs[db].tables} ตาราง ${manifest.dbs[db].rows_total.toLocaleString('en-US')} แถว · ${mb(bytes)} · ${((Date.now() - t0) / 1000).toFixed(0)} วินาที${m.checks.gl ? ` · เดบิต ${m.checks.gl.debit} = เครดิต ${m.checks.gl.credit}` : ''}`);
  }
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}

/* ---------------------------------------------------------------- ทดสอบกู้คืน */
async function verify(dir) {
  const mf = join(dir, 'manifest.json');
  if (!existsSync(mf)) await fail(`ไม่พบ ${mf}`);
  const manifest = JSON.parse(readFileSync(mf, 'utf8'));
  const tmp = join(ROOT, `.data/restore-check-${randomBytes(4).toString('hex')}`);
  const port = await freePort();
  let started = false;
  const prevCleanup = cleanup;
  cleanup = async () => {
    if (started) await runExit(EXE('pg_ctl'), ['stop', '-D', tmp, '-m', 'fast', '-w']);
    rmSync(tmp, { recursive: true, force: true });
    await prevCleanup();
  };
  const init = await run(EXE('initdb'), ['-D', tmp, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--no-locale', '--no-instructions']);
  if (init.code !== 0) await fail(`เปิดฐานชั่วคราวไม่ได้ (initdb) — ${init.err.trim().split(/\r?\n/).slice(-2).join(' | ')}`);
  const st = await runExit(EXE('pg_ctl'), ['start', '-D', tmp, '-w', '-t', '60', '-l', join(tmp, 'server.log'), '-o', `-p ${port} -c listen_addresses=127.0.0.1 -c fsync=off`]);
  if (st.code !== 0) await fail(`เปิดฐานชั่วคราวไม่ได้ (pg_ctl) — ${logTail(join(tmp, 'server.log'))}`);
  started = true;
  const local = (db) => `postgres://postgres@127.0.0.1:${port}/${db}`;
  const admin = new pg.Client({ connectionString: local('postgres') });
  await admin.connect();
  const problems = [];
  for (const [db, info] of Object.entries(manifest.dbs)) {
    const file = join(dir, info.file);
    if (!existsSync(file)) { problems.push(`${db}: ไม่พบไฟล์ ${info.file}`); continue; }
    if (await sha256File(file) !== info.sha256) { problems.push(`${db}: ไฟล์เสีย (sha256 ไม่ตรง)`); continue; }
    await admin.query(`CREATE DATABASE "${db}" ENCODING 'UTF8' TEMPLATE template0`);
    // role ที่นโยบาย RLS อ้างถึง (buddy_app / wtspos_app / …) ต้องมีก่อน — role อยู่นอกไฟล์สำรองของฐาน
    const schema = await run(EXE('pg_restore'), ['--schema-only', '--file=-', file]);
    const roles = new Set();
    for (const m of schema.out.matchAll(/^CREATE POLICY[\s\S]*?\bTO\s+([a-z_][a-z0-9_]*(?:\s*,\s*[a-z_][a-z0-9_]*)*)/gim)) for (const r of m[1].split(',')) roles.add(r.trim());
    roles.delete('public');
    for (const r of roles) await admin.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${r}') THEN CREATE ROLE "${r}" NOLOGIN; END IF; END $$`);
    const t0 = Date.now();
    const r = await run(EXE('pg_restore'), ['--no-owner', '--no-privileges', '--jobs=2', `--dbname=${local(db)}`, file]);
    const errors = r.err.split(/\r?\n/).filter((l) => /error:/i.test(l));
    // ส่วนขยายของ Supabase ที่ฐานในเครื่องไม่มี = ไม่นับเป็นปัญหา (ข้อมูลโปรแกรมไม่ใช้) · อย่างอื่น = ปัญหา
    const real = errors.filter((l) => !/extension|COMMENT ON EXTENSION|pg_graphql|pg_stat_statements|supabase_vault|pgsodium/i.test(l));
    if (real.length) problems.push(`${db}: pg_restore แจ้งข้อผิดพลาด ${real.length} ข้อ เช่น ${real.slice(0, 2).join(' | ')}`);
    const c = new pg.Client({ connectionString: local(db) });
    await c.connect();
    const m = await measure(c);
    await c.end();
    const diff = [];
    for (const [t, n] of Object.entries(info.rows)) if (m.rows[t] !== n) diff.push(`${t} ${n}→${m.rows[t] ?? 'ไม่มีตาราง'}`);
    if (diff.length) problems.push(`${db}: จำนวนแถวไม่ตรง ${diff.length} ตาราง เช่น ${diff.slice(0, 3).join(', ')}`);
    if (info.checks?.gl && (m.checks.gl?.debit !== info.checks.gl.debit || m.checks.gl?.credit !== info.checks.gl.credit))
      problems.push(`${db}: ยอดเดบิต/เครดิตไม่ตรง (${info.checks.gl.debit}/${info.checks.gl.credit} → ${m.checks.gl?.debit}/${m.checks.gl?.credit})`);
    const ok = !problems.some((p) => p.startsWith(`${db}:`));
    out(`${ok ? '✓' : '✗'} กู้คืน ${db}: ${Object.keys(m.rows).length} ตาราง ${Object.values(m.rows).reduce((a, b) => a + b, 0).toLocaleString('en-US')} แถว ${ok ? 'ตรงกับตอนสำรอง' : '— ไม่ผ่าน'} · ${((Date.now() - t0) / 1000).toFixed(0)} วินาที${info.checks?.gl ? ` · เดบิต ${m.checks.gl?.debit} = เครดิต ${m.checks.gl?.credit}` : ''}${errors.length > real.length ? ` · ข้ามส่วนขยายของ Supabase ${errors.length - real.length} ข้อ` : ''}`);
  }
  await admin.end();
  await runExit(EXE('pg_ctl'), ['stop', '-D', tmp, '-m', 'fast', '-w']);
  started = false;
  rmSync(tmp, { recursive: true, force: true });
  cleanup = prevCleanup;
  const result = { checked_at: new Date().toISOString(), ok: problems.length === 0, problems };
  writeFileSync(join(dir, 'restore-check.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

/** ลบชุดที่เก่ากว่า 30 วัน (เฉพาะชื่อโฟลเดอร์รูปแบบของเครื่องมือนี้ · เก็บชุดล่าสุดเสมอ) */
function prune() {
  const now = Date.now();
  const sets = readdirSync(BACKUP_ROOT).filter((n) => FOLDER_RE.test(n)).sort();
  const removed = [];
  for (const n of sets.slice(0, -1)) {
    const [, y, mo, d] = FOLDER_RE.exec(n);
    const at = Date.UTC(Number(y) - 543, Number(mo) - 1, Number(d));
    if (now - at > KEEP_DAYS * 86_400_000) { rmSync(join(BACKUP_ROOT, n), { recursive: true, force: true }); removed.push(n); }
  }
  return removed;
}
const latest = () => readdirSync(BACKUP_ROOT).filter((n) => FOLDER_RE.test(n) && existsSync(join(BACKUP_ROOT, n, 'manifest.json'))).sort().pop();

/* ---------------------------------------------------------------- เริ่ม */
for (const n of ['pg_dump', 'pg_restore', 'initdb', 'pg_ctl']) if (!existsSync(EXE(n)))
  await fail(`ไม่พบ ${EXE(n)} — ต้องมี PostgreSQL 17 ใน .data\\pg17 (README ข้อ 8)`);
mkdirSync(BACKUP_ROOT, { recursive: true });
const history = join(BACKUP_ROOT, 'ประวัติการสำรอง.txt');
const note = (line) => { try { appendFileSync(history, `${thaiStamp().text}  ${line}\r\n`); } catch { /* ไม่มีสิทธิ์เขียน = ข้าม */ } };

if (VERIFY_ONLY) {
  const arg = argv[argv.indexOf('--verify') + 1];
  const dir = arg && !arg.startsWith('--') ? resolve(arg) : (latest() ? join(BACKUP_ROOT, latest()) : null);
  if (!dir) await fail(`ยังไม่มีชุดสำรองใน ${BACKUP_ROOT}`);
  out(`# ทดสอบกู้คืน ${dir}`);
  const v = await verify(dir);
  if (!v.ok) { for (const p of v.problems) out(`  ✗ ${p}`); note(`✗ ทดสอบกู้คืน ${dir} ไม่ผ่าน`); process.exit(1); }
  note(`✓ ทดสอบกู้คืน ${dir} ผ่าน`);
  out('✓ กู้คืนได้ครบ ตรงกับตอนสำรองทุกตาราง');
  process.exit(0);
}

let source, dbs, label;
if (REHEARSE) {
  if (!process.env.DATABASE_URL) await fail('โหมดซ้อมต้องรันผ่าน node tools/local-pg/pg.mjs run --');
  const a = new pg.Client({ connectionString: withDb(process.env.DATABASE_URL, 'postgres') });
  await a.connect();
  const have = new Set((await a.query('SELECT datname FROM pg_database')).rows.map((r) => r.datname));
  await a.end();
  const local = new URL(process.env.DATABASE_URL).pathname.slice(1);
  dbs = [...new Set([local, ...DBS])].filter((d) => have.has(d));
  source = process.env.DATABASE_URL;
  label = 'rehearse (PostgreSQL ในเครื่อง)';
} else {
  const envFile = join(ROOT, '.data/cloud-prod.env');
  if (!existsSync(envFile)) await fail('ไม่พบ .data/cloud-prod.env');
  const env = readEnv(envFile);
  if (!env.SUPABASE_PROJECT_URL) await fail('ไม่พบ SUPABASE_PROJECT_URL ใน .data/cloud-prod.env');
  source = env.SUPABASE_PROJECT_URL;
  dbs = DBS;
  label = 'wts-prod (Supabase)';
}
secrets.add(source);
try { secrets.add(decodeURIComponent(new URL(source).password)); } catch { /* ไม่มีรหัสผ่าน */ }

out(`# สำรองข้อมูล — ${label} · ${dbs.join(', ')} → ${BACKUP_ROOT}`);
const dir = await backup(source, dbs, label);
const v = await verify(dir);
const total = Object.values(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')).dbs).reduce((a, d) => a + d.bytes, 0);
if (!v.ok) {
  for (const p of v.problems) out(`  ✗ ${p}`);
  note(`✗ สำรอง ${dbs.length} ฐาน ${mb(total)} แต่ทดสอบกู้คืนไม่ผ่าน — ${dir}`);
  out(`✗ ไฟล์สำรองอยู่ที่ ${dir} แต่ทดสอบกู้คืนไม่ผ่าน — แจ้งผู้ช่วย (ไม่ลบชุดเก่า)`);
  process.exit(1);
}
const removed = REHEARSE ? [] : prune();
note(`✓ สำรอง ${dbs.length} ฐาน ${mb(total)} · ทดสอบกู้คืนผ่าน — ${dir}${removed.length ? ` · ลบชุดเก่า ${removed.length}` : ''}`);
out(`✓ สำรองเสร็จและทดสอบกู้คืนผ่าน — ${dir} (${mb(total)})${removed.length ? ` · ลบชุดเก่ากว่า ${KEEP_DAYS} วัน ${removed.length} ชุด` : ''}`);
if (REHEARSE && !argv.includes('--keep')) { rmSync(dir, { recursive: true, force: true }); out('ซ้อมเสร็จ — ลบไฟล์สำรองที่ซ้อมแล้ว'); }
