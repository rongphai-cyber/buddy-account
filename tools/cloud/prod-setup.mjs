// ตั้งฐานข้อมูลใช้งานจริง (S1 ของ docs/20) ในโปรเจกต์ Supabase "wts-prod" — 1 โปรเจกต์ 4 ฐาน (เจ้าของ 10/11/2569)
//
//   node tools/cloud/prod-setup.mjs --check        ตรวจอย่างเดียว ไม่เปลี่ยนอะไร (อ่าน .data/cloud-prod.env)
//   node tools/cloud/prod-setup.mjs                ตั้งค่า: สร้างฐาน buddy · wtspos · wtsliving · wtshr (ที่ยังไม่มี) → เขตเวลา Asia/Bangkok
//                                                  → migration ของ Buddy / WTS-POS / WTS-Living → ถอนสิทธิ์ anon/authenticated → ตรวจ role/RLS
//   node tools/local-pg/pg.mjs run -- node tools/cloud/prod-setup.mjs --rehearse
//                                                  ซ้อมกับ PostgreSQL ในเครื่อง (พอร์ต 5544) ด้วยฐานชื่อ rehearse_* แล้วลบทิ้ง — ไม่แตะ DEMO
//   node tools/cloud/prod-setup.mjs --r2           ตรวจที่เก็บไฟล์ R2 ของแต่ละโปรแกรม (กุญแจจาก set-r2-keys.ps1): put → get → ที่อยู่แบบเซ็น → ไม่เซ็นต้องถูกปฏิเสธ → delete
//   ตัวเลือก: --env <ไฟล์>
//
// ความปลอดภัย
// - ไม่พิมพ์ URL / รหัสผ่าน / ชื่อเครื่อง / รหัสโปรเจกต์ (ปิดบังทุกบรรทัด รวมผลของโปรแกรมย่อย) · รายงาน .data/cloud-prod-report.md
// - ฐาน postgres ของโปรเจกต์ต้องไม่มีข้อมูลของระบบอื่น (กันวางที่อยู่ของ wts-hr-center/wts-cloud-test ผิดไฟล์)
// - ฐานของโปรแกรมที่มีอยู่แล้วต้องมีเครื่องหมาย wts_prod.marker ของเครื่องมือนี้ หรือว่าง — ไม่งั้นไม่แตะ
// - รันซ้ำได้: migration ทำเฉพาะที่ยังไม่ได้ทำ · ไม่ลบข้อมูลใด ๆ · pg-check (เครื่องมือทดสอบ) ปฏิเสธโปรเจกต์ที่มีฐานเหล่านี้
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const pg = createRequire(join(ROOT, 'apps/server/package.json'))('pg');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const REHEARSE = flag('--rehearse');
const CHECK_ONLY = flag('--check');
const R2_ONLY = flag('--r2');
const ENV_FILE = resolve(opt('--env', join(ROOT, '.data/cloud-prod.env')));
const REPORT = join(ROOT, REHEARSE ? '.data/cloud-prod-report-rehearse.md' : R2_ONLY ? '.data/cloud-prod-r2-report.md' : '.data/cloud-prod-report.md');
const PREFIX = REHEARSE ? 'rehearse_' : '';
const MARK = 'wts_prod';
const TZ = 'Asia/Bangkok';

/** ฐานของแต่ละโปรแกรม · repo · role ใต้ RLS · ตาราง migration — wtshr: สร้างฐานไว้ก่อน โค้ดย้ายตอน S4 (HANDOFF 105) */
const APPS = [
  { key: 'buddy', db: 'buddy', name: 'Buddy Account', root: ROOT, role: 'buddy_app', migTable: 'public.sys_schema_migration' },
  { key: 'pos', db: 'wtspos', name: 'WTS-POS', root: resolve(process.env.WTSPOS_ROOT ?? 'E:/WTS-POS'), role: 'wtspos_app', migTable: 'public.schema_migration' },
  { key: 'living', db: 'wtsliving', name: 'WTS-Living', root: resolve(process.env.WTSLIVING_ROOT ?? 'E:/WTS-Living'), role: 'wtsliving_app', migTable: 'public.schema_migration' },
  { key: 'hr', db: 'wtshr', name: 'WTS-HR', root: null, role: null, migTable: null },
];
/** schema ของระบบ/ของ Supabase — ไม่ใช่ข้อมูลของโปรแกรมใด */
const PLATFORM = new Set(['information_schema', 'auth', 'storage', 'realtime', '_realtime', 'extensions', 'graphql', 'graphql_public', 'vault',
  'pgsodium', 'pgsodium_masks', 'supabase_functions', 'supabase_migrations', 'net', 'pgbouncer', 'cron', '_analytics', 'pgtle', 'topology', 'tiger', 'tiger_data', 'pgmq', MARK]);

/* ---------------------------------------------------------------- ปิดบังความลับ */
const secrets = new Set();
function addSecrets(u) {
  if (!u) return;
  secrets.add(u);
  try {
    const x = new URL(u);
    for (const s of [x.password, x.hostname, x.host]) if (s && s.length >= 3) { secrets.add(s); try { secrets.add(decodeURIComponent(s)); } catch { /* */ } }
    const user = decodeURIComponent(x.username);
    if (user && user !== 'postgres') secrets.add(user);
    const ref = user.split('.')[1] ?? x.hostname.match(/^db\.([a-z0-9]+)\./i)?.[1];
    if (ref && ref.length >= 6) secrets.add(ref);
    for (const k of ['sslrootcert']) { const v = x.searchParams.get(k); if (v) secrets.add(v); }
  } catch { /* */ }
}
const mask = (text) => {
  let t = String(text ?? '').replace(/postgres(?:ql)?:\/\/[^\s'"`)]+/gi, 'postgres://***');
  for (const s of [...secrets].sort((a, b) => b.length - a.length)) t = t.split(s).join('***');
  return t;
};
const log = [];
const out = (line = '') => { const m = mask(line); log.push(m); console.log(m); };
const fail = (msg) => { out(`✗ ${msg}`); writeReport(false); process.exit(1); };
function writeReport(ok) {
  try { writeFileSync(REPORT, `${log.join('\n')}\n\n${ok ? '✓ เสร็จ' : '✗ ไม่เสร็จ'} — ${new Date().toISOString()}\n`, 'utf8'); } catch { /* */ }
}

/* ---------------------------------------------------------------- PostgreSQL */
const ident = (s) => `"${String(s).replace(/"/g, '""')}"`;
const withDb = (url, db) => { const u = new URL(url); u.pathname = `/${db}`; return u.toString(); };
async function connect(url) {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 20_000, statement_timeout: 300_000 });
  c.on('error', () => {});
  await c.connect();
  return c;
}
const q1 = async (c, text, params) => (await c.query(text, params)).rows[0];

function readEnvFile(file) {
  if (!existsSync(file)) fail(`ไม่พบ ${file} — รัน powershell -ExecutionPolicy Bypass -File tools\\cloud\\set-supabase-url.ps1 -EnvFile .data\\cloud-prod.env`);
  const env = {};
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    const v = line.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    if (v && !v.includes('<') && !v.includes('YOUR-')) env[line.slice(0, i).trim()] = v;
  }
  return env;
}

/** schema ที่ไม่ใช่ของระบบ + จำนวนตาราง/วิว (ไม่นับของ extension) */
async function inventory(c) {
  const r = await c.query(`SELECT n.nspname AS s, (SELECT count(*)::int FROM pg_class k WHERE k.relnamespace = n.oid AND k.relkind IN ('r','p','v','m','S','f')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = k.oid AND d.deptype = 'e')) AS rels
    FROM pg_namespace n WHERE n.nspname NOT LIKE 'pg\\_%' ORDER BY 1`);
  return r.rows.filter((x) => !PLATFORM.has(x.s) && (x.s !== 'public' || x.rels > 0));
}
const hasRole = async (c, r) => !!(await q1(c, 'SELECT 1 AS x FROM pg_roles WHERE rolname = $1', [r]));

/** Supabase ให้ anon/authenticated มีสิทธิ์บน public อัตโนมัติ — ถอนออกทั้งหมด (Data API ปิดแล้ว นี่คือชั้นที่สอง) */
async function revokeApiRoles(c) {
  const roles = [];
  for (const r of ['anon', 'authenticated']) if (await hasRole(c, r)) roles.push(r);
  if (!roles.length) return 'ไม่มี role anon/authenticated (ไม่ใช่ Supabase) — ข้าม';
  const who = roles.map(ident).join(', ');
  const schemas = (await c.query(`SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema' AND NOT (nspname = ANY($1))`, [[...PLATFORM]])).rows.map((x) => x.nspname);
  for (const s of schemas) {
    for (const kind of ['TABLES', 'SEQUENCES', 'FUNCTIONS']) {
      await c.query(`REVOKE ALL ON ALL ${kind} IN SCHEMA ${ident(s)} FROM ${who}`);
      await c.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${ident(s)} REVOKE ALL ON ${kind} FROM ${who}`);
    }
    await c.query(`REVOKE ALL ON SCHEMA ${ident(s)} FROM ${who}`);
  }
  return `ถอนสิทธิ์ ${roles.join('/')} ใน ${schemas.length} schema (${schemas.join(', ') || '-'})`;
}
/** ตารางที่ anon ยังอ่านได้ (ต้องเป็น 0) */
async function anonReadable(c) {
  if (!(await hasRole(c, 'anon'))) return null;
  return (await c.query(`SELECT n.nspname || '.' || k.relname AS t FROM pg_class k JOIN pg_namespace n ON n.oid = k.relnamespace
      WHERE k.relkind IN ('r','v','m','p') AND n.nspname NOT LIKE 'pg\\_%' AND NOT (n.nspname = ANY($1)) AND has_table_privilege('anon', k.oid, 'SELECT') ORDER BY 1`, [[...PLATFORM]])).rows.map((x) => x.t);
}
async function roleCheck(c, role) {
  const r = await q1(c, 'SELECT rolbypassrls FROM pg_roles WHERE rolname = $1', [role]);
  if (!r) return { exists: false };
  let canSet = false;
  try { await c.query('BEGIN'); await c.query(`SET LOCAL ROLE ${ident(role)}`); canSet = true; } catch { /* */ } finally { await c.query('ROLLBACK').catch(() => {}); }
  const noRls = (await c.query(`SELECT n.nspname || '.' || k.relname AS t FROM pg_class k JOIN pg_namespace n ON n.oid = k.relnamespace
      WHERE k.relkind = 'r' AND NOT k.relrowsecurity AND n.nspname NOT IN ('pg_catalog', 'information_schema', '${MARK}')
        AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = k.oid AND a.attname = 'company_id' AND NOT a.attisdropped) ORDER BY 1`)).rows.map((x) => x.t);
  return { exists: true, bypass: r.rolbypassrls, canSet, noRls };
}
async function markerOf(c) {
  if (!(await q1(c, `SELECT 1 AS x FROM pg_namespace WHERE nspname = '${MARK}'`))) return null;
  return q1(c, `SELECT app, created_at FROM ${MARK}.marker LIMIT 1`).catch(() => null);
}
async function writeMarker(c, app) {
  await c.query(`CREATE SCHEMA IF NOT EXISTS ${MARK}`);
  await c.query(`CREATE TABLE IF NOT EXISTS ${MARK}.marker (app text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), note text)`);
  await c.query(`INSERT INTO ${MARK}.marker (app, note) VALUES ($1, 'ฐานใช้งานจริง WTS — สร้างโดย tools/cloud/prod-setup.mjs (ห้ามใช้ pg-check)') ON CONFLICT (app) DO NOTHING`, [app]);
}

function runChild(cmd, args, { cwd, env }) {
  return new Promise((done) => {
    const ch = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    ch.stdout.on('data', (d) => { buf += d; });
    ch.stderr.on('data', (d) => { buf += d; });
    ch.on('close', (code) => done({ code, text: buf }));
    ch.on('error', (e) => done({ code: -1, text: String(e) }));
  });
}
async function runMigrate(app, url) {
  const env = { ...process.env, DATABASE_URL: url };
  for (const k of ['BUDDY_DATA_DIR', 'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE']) delete env[k];
  const tsx = join(app.root, 'apps/server/node_modules/tsx/dist/cli.mjs');
  if (!existsSync(tsx)) return { code: -1, text: `ไม่พบ ${tsx} — ติดตั้งแพ็กเกจของ ${app.name} ก่อน (pnpm install)` };
  return runChild(process.execPath, [tsx, 'src/cli.ts', 'migrate'], { cwd: join(app.root, 'apps/server'), env });
}
function migrationFiles(app) {
  return readdirSync(join(app.root, 'db/migrations')).filter((f) => /^\d{4}_.+\.sql$/.test(f)).length;
}

/* ---------------------------------------------------------------- R2 */
const R2_APPS = [['BUDDY', 'Buddy Account'], ['WTSPOS', 'WTS-POS'], ['WTSLIVING', 'WTS-Living']];
async function r2Main() {
  const env = readEnvFile(ENV_FILE);
  out(`# ตรวจที่เก็บไฟล์ R2 (S1 · docs/20 ข้อ 9) — ${new Date().toISOString()}`);
  if (!env.R2_ACCOUNT_ID) fail('ไม่พบ R2_ACCOUNT_ID — รัน powershell -ExecutionPolicy Bypass -File tools\\cloud\\set-r2-keys.ps1');
  secrets.add(env.R2_ACCOUNT_ID);
  const tsx = join(ROOT, 'apps/server/node_modules/tsx/dist/cli.mjs');
  let ok = true;
  let any = false;
  for (const [k, name] of R2_APPS) {
    const cfg = { R2_ACCOUNT_ID: env.R2_ACCOUNT_ID, R2_BUCKET: env[`${k}_R2_BUCKET`], R2_ACCESS_KEY_ID: env[`${k}_R2_ACCESS_KEY_ID`], R2_SECRET_ACCESS_KEY: env[`${k}_R2_SECRET_ACCESS_KEY`] };
    out(`\n## ${name}`);
    if (!cfg.R2_BUCKET || !cfg.R2_ACCESS_KEY_ID || !cfg.R2_SECRET_ACCESS_KEY) { out('  ยังไม่มีกุญแจ — ข้าม'); ok = false; continue; }
    any = true;
    for (const v of [cfg.R2_ACCESS_KEY_ID, cfg.R2_SECRET_ACCESS_KEY]) secrets.add(v);
    const childEnv = { ...process.env, NO_COLOR: '1', ...cfg };
    delete childEnv.DATABASE_URL;
    const r = await runChild(process.execPath, [tsx, join(ROOT, 'tools/cloud/r2-check.ts')], { cwd: join(ROOT, 'apps/server'), env: childEnv });
    const lines = r.text.split(/\r?\n/);
    const line = lines.find((l) => l.startsWith('R2CHECK '));
    const res = line ? JSON.parse(line.slice(8)) : { steps: [{ step: 'start', ok: false, ms: 0, detail: mask(lines.filter(Boolean).slice(-3).join(' / ')) }] };
    out(`  bucket ${cfg.R2_BUCKET}`);
    for (const st of res.steps) out(`  ${st.ok ? '✓' : '✗'} ${st.step} · ${st.ms} ms${st.detail ? ` · ${st.detail}` : ''}`);
    if (r.code !== 0 || !res.steps.length || !res.steps.every((x) => x.ok)) ok = false;
  }
  if (!any) ok = false;
  writeReport(ok);
  out(`\n${ok ? '✓ ผ่านทั้งหมด' : '✗ มีรายการไม่ผ่าน'} — รายงาน ${REPORT.replace(ROOT, '.')}`);
  process.exit(ok ? 0 : 2);
}

/* ---------------------------------------------------------------- main */
async function main() {
  if (R2_ONLY) return r2Main();
  let projectUrl;
  if (REHEARSE) {
    const local = process.env.DATABASE_URL;
    if (!local) fail('โหมดซ้อมต้องรันผ่าน node tools/local-pg/pg.mjs run -- node tools/cloud/prod-setup.mjs --rehearse');
    projectUrl = withDb(local, 'postgres');
  } else {
    const env = readEnvFile(ENV_FILE);
    projectUrl = env.SUPABASE_PROJECT_URL;
    if (!projectUrl) fail(`ไม่พบ SUPABASE_PROJECT_URL ใน ${ENV_FILE}`);
    if (/@(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(projectUrl)) fail('ที่อยู่ชี้เครื่องนี้ — ใช้ --rehearse สำหรับซ้อม (กันชนฐาน DEMO ชื่อ buddy)');
  }
  addSecrets(projectUrl);
  out(`# ตั้งฐานข้อมูลใช้งานจริง (S1 · docs/20) — ${new Date().toISOString()}`);
  out(`โหมด: ${REHEARSE ? 'ซ้อมในเครื่อง (ฐาน rehearse_* ลบเมื่อจบ)' : CHECK_ONLY ? 'ตรวจอย่างเดียว' : 'ตั้งค่า'}`);

  const admin = await connect(projectUrl);
  let ok = true;
  const made = [];
  // ซ้อม: จำลอง role anon/authenticated ของ Supabase (ให้สิทธิ์อ่านก่อน แล้วดูว่าเครื่องมือถอนได้หมด) — ลบเมื่อจบ
  let simRoles = false;
  if (REHEARSE && !(await hasRole(admin, 'anon'))) {
    await admin.query('CREATE ROLE anon NOLOGIN');
    await admin.query('CREATE ROLE authenticated NOLOGIN');
    simRoles = true;
  }
  try {
    const v = await q1(admin, `SELECT current_setting('server_version') AS v, current_user AS u,
      (SELECT rolcreatedb FROM pg_roles WHERE rolname = current_user) AS createdb, (SELECT rolcreaterole FROM pg_roles WHERE rolname = current_user) AS createrole`);
    const supa = await hasRole(admin, 'anon');
    out(`PostgreSQL ${v.v}${supa ? ' (Supabase)' : ''} · CREATEDB ${v.createdb ? '✓' : '✗'} · CREATEROLE ${v.createrole ? '✓' : '✗'}`);
    if (!v.createdb) fail('ผู้เชื่อมต่อสร้างฐานไม่ได้ — ใช้ role postgres ของโปรเจกต์ (Connect › Session pooler)');

    // ประตูความปลอดภัย: ฐาน postgres ของโปรเจกต์ต้องไม่มีข้อมูลของระบบอื่น
    const foreign = await inventory(admin);
    if (foreign.length) fail(`ฐาน postgres ของโปรเจกต์นี้มีข้อมูลของระบบอื่น (${foreign.map((x) => `${x.s}: ${x.rels}`).join(', ')}) — ไม่ใช่โปรเจกต์ wts-prod ที่ว่าง จึงไม่แตะอะไร`);
    const s0 = (await admin.query(`SELECT datname FROM pg_database WHERE datname LIKE 's0\\_%'`)).rows.map((x) => x.datname);
    if (s0.length && !REHEARSE) fail(`โปรเจกต์นี้มีฐานทดสอบของ pg-check (${s0.join(', ')}) = โปรเจกต์ทดสอบ wts-cloud-test — ไฟล์ .data/cloud-prod.env ต้องเป็นที่อยู่ของ wts-prod`);

    if (!CHECK_ONLY) { out(`ฐาน postgres: ${await revokeApiRoles(admin)}`); await writeMarker(admin, 'project'); }
    const leftover = await anonReadable(admin);
    if (leftover?.length) { ok = false; out(`  ✗ anon ยังอ่านได้: ${leftover.join(', ')}`); }

    for (const app of APPS) {
      const db = PREFIX + app.db;
      out(`\n## ${app.name} — ฐาน ${db}`);
      const exists = !!(await q1(admin, 'SELECT 1 AS x FROM pg_database WHERE datname = $1', [db]));
      if (!exists) {
        if (CHECK_ONLY) { out('  ยังไม่มีฐาน'); ok = false; continue; }
        await admin.query(`CREATE DATABASE ${ident(db)} ENCODING 'UTF8'`);
        made.push(db);
        out('  ✓ สร้างฐานแล้ว (UTF8)');
      }
      const url = withDb(projectUrl, db);
      const c = await connect(url);
      try {
        const cur = await q1(c, `SELECT current_database() AS db, pg_encoding_to_char(d.encoding) AS enc FROM pg_database d WHERE d.datname = current_database()`);
        if (cur.db !== db) fail(`ขอฐาน ${db} แต่ได้ "${cur.db}" — ที่อยู่นี้เลือกฐานไม่ได้ ใช้ "Direct connection" ของโปรเจกต์แทน`);
        if (cur.enc !== 'UTF8') fail(`ฐาน ${db} เข้ารหัส ${cur.enc} — ต้องเป็น UTF8`);
        const mk = await markerOf(c);
        const content = await inventory(c);
        if (exists && !mk && content.length) fail(`ฐาน ${db} มีข้อมูลอยู่แล้วแต่ไม่ใช่ของเครื่องมือนี้ (${content.map((x) => x.s).join(', ')}) — ไม่แตะ`);
        if (!CHECK_ONLY) {
          await writeMarker(c, app.key);
          await admin.query(`ALTER DATABASE ${ident(db)} SET timezone TO '${TZ}'`);
        }
        const tz = await q1(admin, `SELECT coalesce((SELECT array_to_string(setconfig, ',') FROM pg_db_role_setting s JOIN pg_database d ON d.oid = s.setdatabase WHERE d.datname = $1 AND s.setrole = 0), '') AS cfg`, [db]);
        const tzOk = tz.cfg.toLowerCase().includes(`timezone=${TZ.toLowerCase()}`);
        out(`  เขตเวลาฐาน: ${tzOk ? `✓ ${TZ}` : `✗ ยังไม่ตั้ง (${tz.cfg || '-'})`}`);
        if (!tzOk) ok = false;
      } finally { await c.end().catch(() => {}); }

      if (app.root) {
        if (!existsSync(join(app.root, 'apps/server/src/cli.ts'))) fail(`ไม่พบ repo ของ ${app.name} ที่ ${app.root}`);
        if (!CHECK_ONLY) {
          const r = await runMigrate(app, url);
          const last = r.text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-3);
          out(`  migration: ${r.code === 0 ? '✓' : `✗ exit ${r.code}`} ${mask(last.join(' · '))}`);
          if (r.code !== 0) { ok = false; continue; }
        }
        const c2 = await connect(url);
        try {
          const files = migrationFiles(app);
          const applied = (await q1(c2, `SELECT count(*)::int AS n FROM ${app.migTable}`).catch(() => ({ n: 0 }))).n;
          out(`  migration ${applied}/${files} ${applied === files ? '✓' : '✗'}`);
          if (applied !== files) ok = false;
          if (simRoles) {
            await c2.query('GRANT USAGE ON SCHEMA public TO anon, authenticated');
            await c2.query('GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated');
            await c2.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon, authenticated');
            out(`  (ซ้อม) ให้ anon อ่านได้ก่อน ${(await anonReadable(c2)).length} ตาราง`);
          }
          if (!CHECK_ONLY) out(`  ${await revokeApiRoles(c2)}`);
          const rc = await roleCheck(c2, app.role);
          out(`  role ${app.role}: ${rc.exists ? `มี · BYPASSRLS ${rc.bypass ? '✗ ใช่' : '✓ ไม่'} · SET ROLE ${rc.canSet ? '✓' : '✗'} · ตารางมี company_id ที่ไม่มี RLS ${rc.noRls.length ? `✗ ${rc.noRls.join(', ')}` : '✓ 0'}` : '✗ ไม่มี'}`);
          if (!rc.exists || rc.bypass || !rc.canSet || rc.noRls.length) ok = false;
          const an = await anonReadable(c2);
          if (an !== null) { out(`  anon อ่านได้: ${an.length ? `✗ ${an.length} ตาราง` : '✓ 0 ตาราง'}`); if (an.length) ok = false; }
        } finally { await c2.end().catch(() => {}); }
      } else {
        out('  สร้างฐานไว้ก่อน — โค้ด WTS-HR ย้ายมาใช้ฐานนี้ในขั้น S4 (ยังไม่มี migration)');
        if (!CHECK_ONLY) { const c3 = await connect(url); try { out(`  ${await revokeApiRoles(c3)}`); } finally { await c3.end().catch(() => {}); } }
      }
    }
  } finally {
    if (REHEARSE) {
      for (const app of APPS) {
        const db = PREFIX + app.db;
        await admin.query(`DROP DATABASE IF EXISTS ${ident(db)} WITH (FORCE)`).catch((e) => out(`  ลบ ${db} ไม่ได้: ${e.message}`));
      }
      await admin.query(`DROP SCHEMA IF EXISTS ${MARK} CASCADE`).catch(() => {});
      if (simRoles) {
        for (const r of ['anon', 'authenticated']) await admin.query(`DROP ROLE IF EXISTS ${r}`).catch((e) => out(`  ลบ role ${r} ไม่ได้: ${e.message}`));
      }
      out(`\nซ้อมเสร็จ — ลบฐาน rehearse_* แล้ว`);
    }
    await admin.end().catch(() => {});
  }
  writeReport(ok);
  out(`\n${ok ? '✓ ผ่านทั้งหมด' : '✗ มีรายการไม่ผ่าน'} — รายงาน ${REPORT.replace(ROOT, '.')}`);
  process.exit(ok ? 0 : 2);
}

main().catch((e) => fail(e?.message ?? String(e)));
