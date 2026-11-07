// ตรวจ PostgreSQL บนคลาวด์ (Supabase) สำหรับ Buddy Account · WTS-POS · WTS-Living — S0 ของแผน docs/20
//
//   node tools/cloud/pg-check.mjs                    ใช้ค่าจาก .data/cloud-s0.env (เจ้าของกรอก — ไม่เข้า git)
//   node tools/cloud/pg-check.mjs --i-created-this-test-project   ครั้งแรก: ยืนยันว่าเป็นโปรเจกต์ทดสอบที่เพิ่งสร้าง
//   node tools/cloud/pg-check.mjs --local-pg         ซ้อมกับ PostgreSQL 16 ของ Buddy (พอร์ต 5544) ในฐานชั่วคราวที่สร้างแล้วลบทิ้ง
//   node tools/cloud/pg-check.mjs --sim-supabase     ซ้อมกับ PostgreSQL ชั่วคราวแยก (พอร์ต 5549) ที่ผู้เชื่อมต่อไม่ใช่ superuser แบบ Supabase
//   ตัวเลือก: --apps buddy,pos,living  --env <ไฟล์>  --report <ไฟล์>  --skip-tests  --r2-only (ตรวจเฉพาะ R2)
//   1 โปรเจกต์ 3 ฐาน (เจ้าของเลือก 07/11/2569): ไฟล์ค่าตั้งมี SUPABASE_PROJECT_URL (ฐาน postgres ของโปรเจกต์) แทน *_DATABASE_URL
//     → เครื่องมือสร้างฐาน s0_buddy · s0_wtspos · s0_wtsliving ในโปรเจกต์นั้น (ครั้งแรกต้อง --i-created-this-test-project)
//     ซ้อมแบบเดียวกันในเครื่อง: --local-pg --one-project  หรือ  --sim-supabase --one-project
//   ที่เก็บไฟล์ R2 (docs/20 ข้อ 9): มี R2_ACCOUNT_ID R2_BUCKET R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY ในไฟล์ค่าตั้ง = ทดสอบ put/get/ที่อยู่แบบเซ็น/delete
//   (โหมดซ้อม = R2 จำลองในเครื่องที่ตรวจลายเซ็นจริง)
//
// ความปลอดภัย: ไม่พิมพ์ URL / รหัสผ่าน / ชื่อเครื่อง (ปิดบังทุกบรรทัด รวมผลของโปรแกรมย่อย) · ไม่ยอมแตะฐานที่มีตารางของระบบอื่น
// (ต้องว่าง หรือมีเครื่องหมาย wts_s0_check.marker ที่เครื่องมือนี้สร้างเอง) · ล้างข้อมูลได้เฉพาะสิ่งที่สร้างหลังเครื่องหมาย
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const requireServer = createRequire(join(ROOT, 'apps/server/package.json'));
const pg = requireServer('pg');

/* ------------------------------------------------------------------ อาร์กิวเมนต์ */
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const MODE = flag('--local-pg') ? 'local-pg' : flag('--sim-supabase') ? 'sim-supabase' : 'env';
const CONFIRMED = flag('--i-created-this-test-project') || MODE !== 'env';
const SKIP_TESTS = flag('--skip-tests');
const R2_ONLY = flag('--r2-only');
const ENV_FILE = resolve(opt('--env', join(ROOT, '.data/cloud-s0.env')));
const REPORT = resolve(opt('--report', join(ROOT, MODE === 'env' ? '.data/cloud-s0-report.md' : `.data/cloud-s0-report-${MODE}.md`)));
const ONE_PROJECT_FLAG = flag('--one-project');
const PHASES = opt('--apps', 'buddy,pos,living').split(',').map((s) => s.trim()).filter(Boolean);

/** แอปที่ตรวจ: ที่อยู่ repo · ชื่อตัวแปร · role ใต้ RLS · ตารางที่บันทึก migration · ตารางที่ใช้พิสูจน์ RLS */
const APPS = {
  buddy: { name: 'Buddy Account', key: 'BUDDY', root: ROOT, role: 'buddy_app', migTable: 'public.sys_schema_migration', testEnv: 'BUDDY_TEST_DATABASE_URL' },
  pos: { name: 'WTS-POS', key: 'WTSPOS', root: resolve(process.env.WTSPOS_ROOT ?? 'E:/WTS-POS'), role: 'wtspos_app', migTable: 'public.schema_migration', testEnv: 'WTSPOS_TEST_DATABASE_URL', rlsTable: 'pos.outbox' },
  living: { name: 'WTS-Living', key: 'WTSLIVING', root: resolve(process.env.WTSLIVING_ROOT ?? 'E:/WTS-Living'), role: 'wtsliving_app', migTable: 'public.schema_migration', testEnv: 'WTSLIVING_TEST_DATABASE_URL', rlsTable: 'core.outbox' },
};
for (const p of PHASES) if (!APPS[p]) fail(`ไม่รู้จักโปรแกรม "${p}" — ใช้ buddy, pos, living`);
/** POS / Living ส่งเอกสารเข้า Buddy จึงต้องมีฐานของ Buddy ด้วยเสมอ */
const NEEDED = [...new Set(['buddy', ...PHASES])];

/* ------------------------------------------------------------------ ปิดบังความลับ */
const secrets = new Set();
function addSecretsFromUrl(u) {
  if (!u) return;
  secrets.add(u);
  try {
    const x = new URL(u);
    for (const s of [x.password, x.hostname, x.host]) if (s && s.length >= 3) { secrets.add(s); try { secrets.add(decodeURIComponent(s)); } catch { /* */ } }
    // ชื่อผู้ใช้ของ pooler Supabase = postgres.<project-ref> · ชื่อเครื่องตรง = db.<project-ref>.supabase.co
    const user = decodeURIComponent(x.username);
    if (user && user !== 'postgres') secrets.add(user);
    const ref = user.split('.')[1] ?? x.hostname.match(/^db\.([a-z0-9]+)\./i)?.[1];
    if (ref && ref.length >= 6) secrets.add(ref);
    for (const k of ['sslrootcert', 'sslcert', 'sslkey']) { const v = x.searchParams.get(k); if (v) secrets.add(v); }
  } catch { /* URL เสีย — ปิดบังทั้งสตริงไว้แล้ว */ }
}
function mask(text) {
  let t = String(text ?? '');
  t = t.replace(/postgres(?:ql)?:\/\/[^\s'"`)]+/gi, 'postgres://***');
  for (const s of [...secrets].sort((a, b) => b.length - a.length)) t = t.split(s).join('***');
  return t;
}
const log = [];
function out(line = '') { const m = mask(line); log.push(m); console.log(m); }
function fail(msg) { console.error(mask(`✗ ${msg}`)); process.exit(1); }

/* ------------------------------------------------------------------ ไฟล์ค่าตั้ง */
function readEnvFile(file) {
  if (!existsSync(file)) {
    fail(`ไม่พบ ${file}\n  คัดลอก tools/cloud/cloud-s0.env.example ไปเป็นไฟล์นี้ แล้วใส่ connection string ของ Supabase (ห้ามวางรหัสผ่านในแชท) — ดู tools/cloud/README.md`);
  }
  const env = {};
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (v && !v.includes('<') && !v.includes('YOUR-')) env[line.slice(0, i).trim()] = v;
  }
  return env;
}

/** ชื่อฐานของแต่ละโปรแกรมในโหมด 1 โปรเจกต์ (ฐานทดสอบ S0 — ฐานใช้งานจริงตอน S1 ตั้งชื่อใหม่ buddy / wtspos / wtsliving) */
const S0_DB = { buddy: 's0_buddy', pos: 's0_wtspos', living: 's0_wtsliving' };
let ONE_PROJECT = false;

/* ------------------------------------------------------------------ PostgreSQL */
async function connect(url, extra = {}) {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 20_000, statement_timeout: 120_000, ...extra });
  c.on('error', () => {});
  try { await c.connect(); } catch (e) { throw new Error(sslHint(e)); }
  return c;
}
function sslHint(e) {
  const m = e?.message ?? String(e);
  if (/self[- ]signed|certificate|unable to verify|SSL/i.test(m)) {
    return `${m} — ตรวจ SSL: ดาวน์โหลดใบรับรอง CA ของ Supabase (Project Settings › Database › SSL) ไว้ที่ .data/supabase-ca.crt แล้วต่อท้าย URL ด้วย ?sslmode=verify-full&sslrootcert=<ที่อยู่ไฟล์> (ดู tools/cloud/README.md)`;
  }
  if (/password authentication failed/i.test(m)) return `${m} — รหัสผ่านฐานข้อมูลไม่ถูก (ตั้งใหม่ได้ที่ Project Settings › Database)`;
  if (/ENOTFOUND|ENETUNREACH|EHOSTUNREACH|ETIMEDOUT|timeout/i.test(m)) return `${m} — ต่อเครื่องไม่ได้: ที่อยู่ "Direct connection" ของ Supabase ใช้ IPv6 เท่านั้น ถ้าเครือข่ายนี้ไม่มี IPv6 ให้ใช้ "Session pooler" (พอร์ต 5432) แทน`;
  return m;
}
const q1 = async (c, text, params) => (await c.query(text, params)).rows[0];
const ident = (s) => `"${String(s).replace(/"/g, '""')}"`;

/** schema ของระบบ/ของ Supabase ที่มีอยู่แล้วในโปรเจกต์ใหม่ — ไม่ใช่ข้อมูลของโปรแกรมใด */
const PLATFORM_SCHEMAS = new Set(['information_schema', 'auth', 'storage', 'realtime', '_realtime', 'extensions', 'graphql', 'graphql_public', 'vault',
  'pgsodium', 'pgsodium_masks', 'supabase_functions', 'supabase_migrations', 'net', 'pgbouncer', 'cron', '_analytics', 'pgtle', 'topology', 'tiger', 'tiger_data', 'pgmq']);
const MARK = 'wts_s0_check';
const NOT_EXT = `NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')`;

/** schema ที่ไม่ใช่ของระบบ + จำนวนตาราง/view/sequence ในแต่ละ schema (ไม่นับของ extension) */
async function inventory(c) {
  const r = await c.query(`SELECT n.nspname AS s,
      (SELECT count(*)::int FROM pg_class c WHERE c.relnamespace = n.oid AND c.relkind IN ('r','p','v','m','S','f') AND ${NOT_EXT}) AS rels
    FROM pg_namespace n WHERE n.nspname NOT LIKE 'pg\\_%' ORDER BY 1`);
  return r.rows.filter((x) => !PLATFORM_SCHEMAS.has(x.s));
}

async function readMarker(c) {
  if (!(await q1(c, `SELECT to_regclass('${MARK}.marker')::text AS t`)).t) return null;
  return q1(c, `SELECT app, created_at, baseline_schemas, run_count FROM ${MARK}.marker LIMIT 1`);
}

/**
 * ประตูความปลอดภัย: ฐานต้องว่าง (ไม่มี schema/ตารางของโปรแกรมใด) หรือมีเครื่องหมายของเครื่องมือนี้สำหรับโปรแกรมเดียวกัน
 * คืน { ok, marker, reason, foreign }
 */
async function safetyGate(c, app) {
  const marker = await readMarker(c);
  const inv = await inventory(c);
  if (marker) {
    if (marker.app !== app) return { ok: false, reason: `ฐานนี้เตรียมไว้ให้ "${marker.app}" ไม่ใช่ "${app}" — แต่ละโปรแกรมต้องใช้ฐานของตัวเอง (ตรวจว่าไม่ได้ใส่ URL เดียวกันซ้ำ)` };
    return { ok: true, marker };
  }
  const foreign = inv.filter((x) => x.s !== MARK && (x.s !== 'public' || x.rels > 0));
  if (foreign.length) {
    return { ok: false, foreign, reason: `ฐานนี้มีข้อมูลของระบบอื่นอยู่แล้ว (${foreign.map((x) => `${x.s}: ${x.rels} ตาราง/วิว`).join(', ')}) — ไม่ใช่ฐานทดสอบที่ว่าง จึงไม่แตะต้อง` };
  }
  return { ok: true, marker: null, empty: true };
}

async function createMarker(c, app) {
  const baseline = (await c.query(`SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg\\_%' ORDER BY 1`)).rows.map((r) => r.nspname);
  await c.query(`CREATE SCHEMA IF NOT EXISTS ${MARK}`);
  await c.query(`CREATE TABLE ${MARK}.marker (app text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), baseline_schemas text[] NOT NULL, run_count int NOT NULL DEFAULT 0,
    note text NOT NULL DEFAULT 'สร้างโดย Buddy tools/cloud/pg-check.mjs (docs/20 S0) — ฐานทดสอบ ลบได้ทั้งฐาน')`);
  await c.query(`INSERT INTO ${MARK}.marker (app, baseline_schemas) VALUES ($1, $2)`, [app, baseline.filter((s) => s !== MARK)]);
  return readMarker(c);
}

/** ล้างทุกอย่างที่โปรแกรมสร้างหลังเครื่องหมาย (ฐานที่มีเครื่องหมายของโปรแกรมนี้เท่านั้น) — role ของโปรแกรมคงไว้ */
async function resetDatabase(c, app) {
  const m = await readMarker(c);
  if (!m || m.app !== app) throw new Error('ไม่มีเครื่องหมายของเครื่องมือนี้ — ไม่ล้างข้อมูล');
  const keep = new Set([...m.baseline_schemas, MARK, 'public', ...PLATFORM_SCHEMAS]);
  const schemas = (await c.query(`SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg\\_%'`)).rows.map((r) => r.nspname).filter((s) => !keep.has(s));
  for (const s of schemas) await c.query(`DROP SCHEMA ${ident(s)} CASCADE`);
  const drops = (await c.query(`
    SELECT 1 AS o, format('DROP VIEW IF EXISTS public.%I CASCADE', relname) AS q FROM pg_class c WHERE relnamespace = 'public'::regnamespace AND relkind = 'v' AND ${NOT_EXT}
    UNION ALL SELECT 2, format('DROP MATERIALIZED VIEW IF EXISTS public.%I CASCADE', relname) FROM pg_class c WHERE relnamespace = 'public'::regnamespace AND relkind = 'm' AND ${NOT_EXT}
    UNION ALL SELECT 3, format('DROP TABLE IF EXISTS public.%I CASCADE', relname) FROM pg_class c WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','p') AND ${NOT_EXT}
    UNION ALL SELECT 4, format('DROP SEQUENCE IF EXISTS public.%I CASCADE', relname) FROM pg_class c WHERE relnamespace = 'public'::regnamespace AND relkind = 'S' AND ${NOT_EXT}
    UNION ALL SELECT 5, format('DROP %s IF EXISTS %s CASCADE', CASE c.prokind WHEN 'p' THEN 'PROCEDURE' WHEN 'a' THEN 'AGGREGATE' ELSE 'FUNCTION' END, c.oid::regprocedure)
      FROM pg_proc c WHERE pronamespace = 'public'::regnamespace AND ${NOT_EXT}
    UNION ALL SELECT 6, format('DROP TYPE IF EXISTS public.%I CASCADE', typname) FROM pg_type c
      WHERE typnamespace = 'public'::regnamespace AND typtype IN ('e','d','r','m','c') AND (typtype <> 'c' OR (SELECT relkind FROM pg_class WHERE oid = c.typrelid) = 'c') AND ${NOT_EXT}
    ORDER BY 1`)).rows;
  for (const d of drops) await c.query(d.q);
  await c.query(`UPDATE ${MARK}.marker SET run_count = run_count + 1`);
  return { schemas: schemas.length, objects: drops.length };
}

/** ข้อมูลเซิร์ฟเวอร์ + สิทธิ์ของผู้เชื่อมต่อ (ไม่มีชื่อเครื่อง/ผู้ใช้) */
async function probe(c) {
  const v = await q1(c, `SELECT current_setting('server_version') AS version, current_setting('server_version_num')::int AS num, version() AS full`);
  const me = await q1(c, `SELECT rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, rolreplication FROM pg_roles WHERE rolname = current_user`);
  const dbCreate = (await q1(c, `SELECT has_database_privilege(current_database(), 'CREATE') AS ok`)).ok;
  const ssl = await q1(c, `SELECT ssl, version FROM pg_stat_ssl WHERE pid = pg_backend_pid()`).catch(() => null);
  const exts = (await c.query(`SELECT extname, extversion FROM pg_extension ORDER BY 1`)).rows.map((r) => `${r.extname} ${r.extversion}`);
  const avail = (await q1(c, `SELECT count(*)::int AS n FROM pg_available_extensions`)).n;
  const selfGrant = v.num >= 160000 ? (await q1(c, `SELECT current_setting('createrole_self_grant', true) AS s`)).s : null;
  const uuid = !!(await q1(c, `SELECT gen_random_uuid() AS u`)).u;
  // TLS ฝั่งเครื่องนี้ดูจาก socket จริง · pg_stat_ssl = ช่วงที่ฐานเห็น (ผ่าน pooler ของ Supabase = ช่วง pooler→ฐานภายในเครือข่าย Supabase ไม่ใช่ช่วงของเรา)
  const tls = !!c.connection?.stream?.encrypted;
  const sslText = tls
    ? `เข้ารหัส TLS จากเครื่องนี้ ✓${ssl?.ssl ? ` · ถึงฐาน ${ssl.version}` : ' (ผ่าน pooler — ช่วง pooler→ฐานอยู่ภายใน Supabase)'}`
    : (ssl?.ssl ? `SSL ${ssl.version}` : 'ไม่เข้ารหัส ✗');
  return { version: v.version, num: v.num, platform: /supabase/i.test(v.full) ? 'Supabase' : '', me, dbCreate, ssl: sslText, tls, exts, avail, selfGrant, uuid };
}

/** ลองสร้าง/ลบ role และฐานข้อมูลจริง (หลังผ่านประตูความปลอดภัยแล้ว) + ตรวจกับดัก PostgreSQL 16 (สมาชิกแต่ SET ROLE ไม่ได้) */
async function tryCreate(c, num) {
  const tag = `wts_s0_probe_${randomBytes(4).toString('hex')}`;
  const res = { createRole: false, setRoleWithoutGrant: null, setRoleAfterGrant: null, createDatabase: false, notes: [] };
  try {
    await c.query(`CREATE ROLE ${tag} NOLOGIN`);
    res.createRole = true;
    const trySet = async () => { try { await c.query('BEGIN'); await c.query(`SET LOCAL ROLE ${tag}`); return true; } catch { return false; } finally { await c.query('ROLLBACK').catch(() => {}); } };
    res.setRoleWithoutGrant = await trySet();
    if (!res.setRoleWithoutGrant) {
      try { await c.query(`GRANT ${tag} TO CURRENT_USER${num >= 160000 ? ' WITH SET TRUE' : ''}`); } catch (e) { res.notes.push(`GRANT: ${e.message}`); }
      res.setRoleAfterGrant = await trySet();
    }
  } catch (e) { res.notes.push(`CREATE ROLE: ${e.message}`); }
  finally { await c.query(`DROP ROLE IF EXISTS ${tag}`).catch(() => {}); }
  try {
    await c.query(`CREATE DATABASE ${tag}`);
    res.createDatabase = true;
    await c.query(`DROP DATABASE IF EXISTS ${tag}`);
  } catch (e) { res.notes.push(`CREATE DATABASE: ${e.message}`); }
  return res;
}

/** transaction pooler: SET LOCAL อยู่ในทรานแซกชันเดียว · ไม่รั่วไปทรานแซกชันถัดไป · คำสั่งมีพารามิเตอร์ · ตัวเลือกตอนเชื่อมต่อ (TimeZone ของ POS/Living) */
async function poolerChecks(url) {
  const r = {};
  const c = await connect(url);
  try {
    await c.query('BEGIN');
    await c.query(`SELECT set_config('app.company_id', $1, true)`, ['11111111-1111-1111-1111-111111111111']);
    r.setLocalInTx = (await q1(c, `SELECT current_setting('app.company_id', true) AS v`)).v === '11111111-1111-1111-1111-111111111111';
    await c.query('COMMIT');
    let leaked = false;
    for (let i = 0; i < 5; i++) leaked ||= ((await q1(c, `SELECT coalesce(current_setting('app.company_id', true), '') AS v`)).v !== '');
    r.noLeakAfterCommit = !leaked;
    r.params = (await q1(c, 'SELECT $1::int + 1 AS n', [41])).n === 42;
    const pids = new Set();
    for (let i = 0; i < 6; i++) pids.add((await q1(c, 'SELECT pg_backend_pid() AS p')).p);
    r.backendsSeen = pids.size;
  } finally { await c.end().catch(() => {}); }
  try {
    const t = await connect(url, { options: '-c TimeZone=Asia/Bangkok' });
    r.startupOptions = (await q1(t, 'SHOW TimeZone')).TimeZone === 'Asia/Bangkok' ? 'ใช้ได้' : 'ถูกละเว้น';
    await t.end();
  } catch (e) { r.startupOptions = `ถูกปฏิเสธ (${e.message})`; }
  return r;
}

/** หลัง migration: role ของโปรแกรมมีจริง ไม่ข้าม RLS และผู้เชื่อมต่อสลับเป็น role นั้นได้ */
async function roleCheck(c, role) {
  const r = await q1(c, `SELECT rolbypassrls FROM pg_roles WHERE rolname = $1`, [role]);
  if (!r) return { exists: false };
  let canSet = false;
  try { await c.query('BEGIN'); await c.query(`SET LOCAL ROLE ${ident(role)}`); canSet = true; } catch { /* */ } finally { await c.query('ROLLBACK').catch(() => {}); }
  const noRls = (await c.query(`SELECT n.nspname || '.' || k.relname AS t FROM pg_class k JOIN pg_namespace n ON n.oid = k.relnamespace
      WHERE k.relkind = 'r' AND NOT k.relrowsecurity AND n.nspname NOT IN ('pg_catalog','information_schema', '${MARK}')
        AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = k.oid AND a.attname = 'company_id' AND NOT a.attisdropped) ORDER BY 1`)).rows.map((x) => x.t);
  // Supabase: role anon/authenticated ได้สิทธิ์บนตารางใน public อัตโนมัติ — ถ้า Data API เปิด ตารางที่ไม่มี RLS อ่านได้ด้วยกุญแจ anon
  let anon = null;
  if ((await q1(c, `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AS ok`)).ok) {
    anon = (await c.query(`SELECT n.nspname || '.' || k.relname AS t FROM pg_class k JOIN pg_namespace n ON n.oid = k.relnamespace
        WHERE k.relkind IN ('r','v','m') AND n.nspname NOT IN ('pg_catalog','information_schema','${MARK}') AND n.nspname NOT IN (${[...PLATFORM_SCHEMAS].map((x) => `'${x}'`).join(',')})
          AND has_table_privilege('anon', k.oid, 'SELECT') AND NOT k.relrowsecurity ORDER BY 1`)).rows.map((x) => x.t);
  }
  return { exists: true, bypass: r.rolbypassrls, canSet, noRls, anon };
}

/** POS / Living: role ของโปรแกรมในบริษัทจริงเห็นแถวของตัวเอง · บริษัทอื่น (หรือไม่ได้ตั้ง) = ไม่เห็นอะไร */
async function rlsProof(c, app) {
  const a = APPS[app];
  const m = await q1(c, `SELECT cu.company_id, cu.user_id, (SELECT count(*)::int FROM ${a.rlsTable} t WHERE t.company_id = cu.company_id) AS n
      FROM core.company_users cu WHERE cu.is_active ORDER BY 3 DESC LIMIT 1`);
  if (!m || !m.n) return { ok: false, detail: `ไม่มีแถวใน ${a.rlsTable} ให้พิสูจน์ (ชุดทดสอบยังไม่ได้รัน?)` };
  const scoped = async (company, user) => {
    try {
      await c.query('BEGIN');
      await c.query(`SET LOCAL ROLE ${ident(a.role)}`);
      await c.query(`SELECT set_config('app.company_id', $1, true), set_config('app.user_id', $2, true)`, [company, user]);
      return {
        rows: (await q1(c, `SELECT count(*)::int AS n FROM ${a.rlsTable}`)).n,
        companies: (await q1(c, 'SELECT count(*)::int AS n FROM core.companies')).n,
      };
    } finally { await c.query('ROLLBACK').catch(() => {}); }
  };
  const own = await scoped(m.company_id, m.user_id);
  const other = await scoped(randomUUID(), m.user_id);
  const stranger = await scoped(m.company_id, randomUUID());
  const unset = await scoped('', '');
  const ok = own.rows === m.n && own.companies >= 1 && other.rows === 0 && stranger.rows === 0 && stranger.companies === 0 && unset.rows === 0;
  return { ok, detail: `ตัวเอง ${own.rows}/${m.n} แถว · บริษัทอื่น ${other.rows} · ผู้ใช้ที่ไม่ใช่สมาชิก ${stranger.rows} แถว ${stranger.companies} บริษัท · ไม่ได้ตั้งบริษัท ${unset.rows}` };
}

async function migrationCount(c, app) {
  const files = readdirSync(join(APPS[app].root, 'db/migrations')).filter((f) => /^\d{4}_.+\.sql$/.test(f)).length;
  const applied = (await q1(c, `SELECT count(*)::int AS n FROM ${APPS[app].migTable}`).catch(() => ({ n: 0 }))).n;
  return { files, applied, ok: files === applied };
}

/* ------------------------------------------------------------------ ชุดทดสอบของแต่ละ repo ในโหมด postgres */
const TESTS = {
  buddy: [
    { label: 'Buddy WTS Connect acceptance (docs/17 B0.7)', repo: 'buddy', cwd: 'apps/server', files: ['test/wts-acceptance.test.ts'], reset: ['buddy'] },
    { label: 'Buddy S0: 2 บริษัท · ใบสำคัญ · งบทดลอง · RLS', repo: 'buddy', cwd: 'apps/server', files: ['test/cloud-s0-flow.test.ts'], reset: [] },
  ],
  pos: [
    { label: 'WTS-POS B2.9 acceptance → Buddy (ยอดวัน 30,000 · งบทดลองทุกสตางค์)', repo: 'pos', cwd: '.', files: ['apps/server/test/b29-acceptance.test.ts'], reset: ['buddy', 'pos'] },
  ],
  living: [
    { label: 'WTS-Living B5.2 บิล + ใบเสร็จ → Buddy (5,377.40 · 5,259.95)', repo: 'living', cwd: '.', files: ['apps/server/test/b52-buddy-real.test.ts'], reset: ['buddy', 'living'] },
    { label: 'WTS-Living B5.3 LIVING-ACCEPTANCE §1 + §3 → Buddy', repo: 'living', cwd: '.', files: ['apps/server/test/b53-acceptance.test.ts'], reset: ['buddy', 'living'] },
  ],
};

function vitestBin(repo) {
  const base = repo === 'buddy' ? join(ROOT, 'apps/server') : APPS[repo].root;
  const pkg = createRequire(join(base, 'package.json')).resolve('vitest/package.json');
  return join(dirname(pkg), 'vitest.mjs');
}

function runChild(cmd, args, { cwd, env }) {
  return new Promise((ok) => {
    const t0 = Date.now();
    const child = spawn(cmd, args, { cwd, env, windowsHide: true });
    const lines = [];
    const feed = (buf) => {
      for (const l of buf.toString('utf8').split(/\r?\n/)) {
        const s = mask(l.replace(/\x1b\[[0-9;]*m/g, '')).trimEnd();
        if (!s) continue;
        lines.push(s);
        if (/✓|✗|×|FAIL|Error|Tests|Test Files|expected|AssertionError|→/.test(s)) console.log(`    ${s}`);
      }
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.once('exit', (code) => ok({ code: code ?? 1, ms: Date.now() - t0, lines }));
  });
}

async function runTest(t, urls) {
  const env = { ...process.env, NODE_ENV: 'test', NO_COLOR: '1', FORCE_COLOR: '0', BUDDY_ROOT: ROOT };
  delete env.DATABASE_URL;
  for (const k of Object.keys(APPS)) delete env[APPS[k].testEnv];
  for (const [app, url] of Object.entries(urls)) env[APPS[app].testEnv] = url;
  const r = await runChild(process.execPath, [vitestBin(t.repo), 'run', ...t.files, '--testTimeout=900000', '--hookTimeout=1200000', '--no-file-parallelism'], { cwd: join(APPS[t.repo].root, t.cwd), env });
  const summary = r.lines.filter((l) => /^\s*Tests\s+/.test(l)).pop()?.trim() ?? '';
  const passed = Number(summary.match(/(\d+) passed/)?.[1] ?? 0);
  const failed = Number(summary.match(/(\d+) failed/)?.[1] ?? 0);
  const skipped = Number(summary.match(/(\d+) skipped/)?.[1] ?? 0);
  const ok = r.code === 0 && passed > 0 && failed === 0 && skipped === 0;
  const errs = ok ? [] : r.lines.filter((l) => /Error|expected|FAIL|×/.test(l)).slice(0, 12);
  return { ok, code: r.code, ms: r.ms, passed, failed, skipped, summary, errs };
}

/* ------------------------------------------------------------------ เป้าหมาย: โหมดซ้อมในเครื่อง */
async function freePort(port) {
  return new Promise((ok) => { const s = createServer(); s.once('error', () => ok(false)); s.listen(port, '127.0.0.1', () => s.close(() => ok(true))); });
}

async function localTargets() {
  const settings = JSON.parse(readFileSync(join(ROOT, '.data/pg/settings.json'), 'utf8'));
  const base = (db) => `postgres://${settings.user}:${encodeURIComponent(settings.password)}@127.0.0.1:${settings.port}/${db}`;
  addSecretsFromUrl(base('postgres'));
  const admin = await connect(base('postgres'));
  const tag = `s0chk_${randomBytes(3).toString('hex')}`;
  const rolesBefore = new Set((await admin.query(`SELECT rolname FROM pg_roles`)).rows.map((r) => r.rolname));
  const dbs = {};
  for (const app of NEEDED) dbs[app] = `${tag}_${app}`;
  if (ONE_PROJECT_FLAG) { ONE_PROJECT = true; await ensureProjectDatabases(base('postgres'), dbs, { checkProject: false }); }
  else for (const app of NEEDED) await admin.query(`CREATE DATABASE ${dbs[app]} ENCODING 'UTF8'`);
  const foreign = `${tag}_foreign`;
  await admin.query(`CREATE DATABASE ${foreign}`);
  const fc = await connect(base(foreign));
  await fc.query(`CREATE TABLE public.employees (id int PRIMARY KEY, name text)`);
  await fc.end();
  await admin.end();
  return {
    label: `PostgreSQL 16 ของ Buddy บนเครื่องนี้ (พอร์ต ${settings.port})${ONE_PROJECT ? ' · แบบ 1 โปรเจกต์ 3 ฐาน (สร้างผ่าน URL เดียว)' : ''} · ฐานชั่วคราว ${tag}_* (ลบทิ้งเมื่อจบ — ไม่แตะ DEMO / buddy_backup_*)`,
    direct: Object.fromEntries(NEEDED.map((a) => [a, base(dbs[a])])),
    pooler: {},
    foreignUrl: base(foreign),
    async cleanup() {
      const c = await connect(base('postgres'));
      try {
        for (const d of [...Object.values(dbs), foreign]) await c.query(`DROP DATABASE IF EXISTS ${d} WITH (FORCE)`);
        const created = (await c.query(`SELECT rolname FROM pg_roles`)).rows.map((r) => r.rolname).filter((r) => !rolesBefore.has(r));
        for (const r of created) await c.query(`DROP ROLE IF EXISTS ${ident(r)}`).catch((e) => out(`  ลบ role ${r} ไม่ได้: ${e.message}`));
        const left = (await c.query(`SELECT count(*)::int AS n FROM pg_database WHERE datname LIKE $1`, [`${tag}%`])).rows[0].n;
        out(`  ลบฐานชั่วคราว ${tag}_* แล้ว (เหลือ ${left}) · ลบ role ที่สร้างระหว่างซ้อม ${created.length} (${created.join(', ') || '-'})`);
      } finally { await c.end(); }
    },
  };
}

/** PostgreSQL ชั่วคราวแยก: superuser = supabase_admin · ผู้เชื่อมต่อ = postgres (CREATEROLE CREATEDB BYPASSRLS ไม่ใช่ superuser แบบ Supabase) + schema auth/storage */
async function simTargets() {
  const port = Number(process.env.S0_SIM_PORT ?? 5549);
  if (!(await freePort(port))) fail(`พอร์ต ${port} ถูกใช้อยู่ — ตั้ง S0_SIM_PORT เป็นพอร์ตว่าง`);
  const dir = join(ROOT, '.data/s0-sim');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const { default: EmbeddedPostgres } = await import(pathToFileURL(createRequire(join(ROOT, 'package.json')).resolve('embedded-postgres')).href);
  const suPw = randomBytes(18).toString('base64url');
  const appPw = randomBytes(18).toString('base64url');
  const pgs = new EmbeddedPostgres({ databaseDir: join(dir, 'data'), user: 'supabase_admin', password: suPw, port, persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {}, onError: () => {} });
  await pgs.initialise();
  await pgs.start();
  const su = (db) => `postgres://supabase_admin:${suPw}@127.0.0.1:${port}/${db}`;
  const app = (db) => `postgres://postgres:${appPw}@127.0.0.1:${port}/${db}`;
  addSecretsFromUrl(su('postgres'));
  addSecretsFromUrl(app('postgres'));
  const admin = await connect(su('postgres'));
  await admin.query(`CREATE ROLE postgres LOGIN PASSWORD '${appPw}' CREATEROLE CREATEDB REPLICATION BYPASSRLS`);
  // role ของ Data API ของ Supabase + สิทธิ์อัตโนมัติบนตารางที่ postgres สร้างใน public
  await admin.query(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN`);
  const dbs = {};
  for (const a of [...(ONE_PROJECT_FLAG ? [] : NEEDED), 'foreign']) {
    dbs[a] = `sim_${a}`;
    await admin.query(`CREATE DATABASE ${dbs[a]} OWNER postgres ENCODING 'UTF8'`);
    const c = await connect(su(dbs[a]));
    // แบบโปรเจกต์ Supabase ใหม่: schema auth / storage ของแพลตฟอร์มมีตารางอยู่แล้ว (ต้องไม่ถูกนับเป็นข้อมูลโปรแกรม และห้ามถูกล้าง)
    await c.query(`CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY); CREATE SCHEMA storage; CREATE TABLE storage.objects (id uuid PRIMARY KEY); CREATE SCHEMA extensions;
      GRANT USAGE ON SCHEMA public TO anon, authenticated;
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated`);
    await c.end();
  }
  await admin.end();
  if (ONE_PROJECT_FLAG) {
    // แบบ Supabase จริง: role postgres (ไม่ใช่ superuser) สร้างฐานเองผ่าน URL ของฐาน postgres
    ONE_PROJECT = true;
    for (const a of NEEDED) dbs[a] = `sim_${a}`;
    await ensureProjectDatabases(app('postgres'), dbs);
  }
  const fc = await connect(app(dbs.foreign));
  await fc.query(`CREATE TABLE public.employees (id int PRIMARY KEY, name text)`);
  await fc.end();
  return {
    label: `PostgreSQL 16 ชั่วคราวแยก (พอร์ต ${port}) จำลองสิทธิ์ Supabase: ผู้เชื่อมต่อ "postgres" ไม่ใช่ superuser (CREATEROLE CREATEDB BYPASSRLS)${ONE_PROJECT ? ' · แบบ 1 โปรเจกต์ 3 ฐาน (postgres สร้างฐานเอง)' : ' + schema auth/storage'}`,
    direct: Object.fromEntries(NEEDED.map((a) => [a, app(dbs[a])])),
    pooler: {},
    foreignUrl: app(dbs.foreign),
    async cleanup() {
      const c = await connect(su('postgres'));
      const kept = [];
      for (const a of ONE_PROJECT ? [] : NEEDED) {
        const d = await connect(su(dbs[a]));
        const n = (await q1(d, `SELECT (SELECT count(*)::int FROM auth.users) + (SELECT count(*)::int FROM pg_class WHERE relnamespace = 'storage'::regnamespace) AS n`)).n;
        kept.push(`${a}:${n >= 1 ? 'auth/storage ยังอยู่' : 'หาย!'}`);
        await d.end();
      }
      await c.end();
      await pgs.stop();
      rmSync(dir, { recursive: true, force: true });
      out(`  ${kept.length ? `schema ของแพลตฟอร์มหลังล้างข้อมูล: ${kept.join(' · ')} · ` : ''}ปิดและลบ PostgreSQL ชั่วคราวแล้ว`);
    },
  };
}

/** ที่อยู่เดียวกันแต่ชี้ฐานอื่น (เปลี่ยนเฉพาะชื่อฐานท้าย URL) */
function withDb(url, db) {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

/**
 * โหมด 1 โปรเจกต์: ตรวจว่าโปรเจกต์ว่าง (ฐาน postgres ไม่มีตารางของระบบอื่น — กันวาง URL ของ WTS-SOP หรือโปรเจกต์ที่ใช้งานอยู่)
 * สร้างฐานของแต่ละโปรแกรมที่ยังไม่มี แล้วยืนยันว่าเชื่อมต่อแล้วได้ฐานที่ขอจริง (pooler บางแบบเลือกฐานไม่ได้)
 */
async function ensureProjectDatabases(projectUrl, names, { checkProject = true } = {}) {
  const c = await connect(projectUrl);
  const made = [];
  try {
    if (checkProject) {
      const foreign = (await inventory(c)).filter((x) => x.s !== MARK && (x.s !== 'public' || x.rels > 0));
      if (foreign.length) fail(`ฐาน postgres ของโปรเจกต์นี้มีข้อมูลของระบบอื่นอยู่แล้ว (${foreign.map((x) => `${x.s}: ${x.rels} ตาราง/วิว`).join(', ')}) — ใช้โปรเจกต์ Supabase ใหม่ที่ว่างเท่านั้น (ไม่ใช่โปรเจกต์ WTS-SOP) จึงไม่สร้างอะไร`);
    }
    for (const app of NEEDED) {
      const db = names[app];
      if (await q1(c, 'SELECT 1 AS x FROM pg_database WHERE datname = $1', [db])) continue;
      if (!CONFIRMED) fail(`ยังไม่มีฐาน ${db} ในโปรเจกต์ — รันใหม่พร้อม --i-created-this-test-project ถ้าเป็นโปรเจกต์ทดสอบที่ท่านเพิ่งสร้างเอง (เครื่องมือจะสร้างฐาน ${NEEDED.map((a) => names[a]).join(', ')})`);
      try { await c.query(`CREATE DATABASE ${ident(db)}`); } catch (e) { fail(`สร้างฐาน ${db} ไม่ได้: ${e.message} — ผู้เชื่อมต่อต้องมีสิทธิ์ CREATEDB (role postgres ของ Supabase มี)`); }
      made.push(db);
    }
  } finally { await c.end().catch(() => {}); }
  for (const app of NEEDED) {
    let d;
    try { d = await connect(withDb(projectUrl, names[app])); } catch (e) {
      fail(`ต่อฐาน ${names[app]} ไม่ได้: ${e.message} — ถ้าใช้ "Session pooler" แล้วเลือกฐานอื่นไม่ได้ ให้ใช้ "Direct connection" ของโปรเจกต์แทน (ดู tools/cloud/README.md)`);
    }
    try {
      const r = await q1(d, `SELECT current_database() AS db, pg_encoding_to_char(encoding) AS enc FROM pg_database WHERE datname = current_database()`);
      if (r.db !== names[app]) fail(`ขอฐาน ${names[app]} แต่ได้ "${r.db}" — ที่อยู่นี้เลือกฐานไม่ได้ ใช้ "Direct connection" ของโปรเจกต์แทน (ดู tools/cloud/README.md)`);
      if (r.enc !== 'UTF8') fail(`ฐาน ${names[app]} เข้ารหัส ${r.enc} ต้องเป็น UTF8 — ลบฐานแล้วสร้างใหม่ด้วย ENCODING 'UTF8'`);
    } finally { await d.end().catch(() => {}); }
  }
  return made;
}

let ENV = {};
async function envTargets() {
  const env = (ENV = readEnvFile(ENV_FILE));
  for (const v of Object.values(env)) if (/^postgres/i.test(v)) addSecretsFromUrl(v);
  const direct = {};
  const pooler = {};
  if (env.SUPABASE_PROJECT_URL) {
    const own = NEEDED.filter((a) => env[`${APPS[a].key}_DATABASE_URL`]);
    if (own.length) fail(`ใส่ทั้ง SUPABASE_PROJECT_URL และ ${own.map((a) => `${APPS[a].key}_DATABASE_URL`).join(', ')} — เลือกแบบเดียว (1 โปรเจกต์ 3 ฐาน = SUPABASE_PROJECT_URL อย่างเดียว)`);
    ONE_PROJECT = true;
    const made = await ensureProjectDatabases(env.SUPABASE_PROJECT_URL, S0_DB);
    for (const app of NEEDED) {
      direct[app] = withDb(env.SUPABASE_PROJECT_URL, S0_DB[app]);
      if (env.SUPABASE_POOLER_URL) pooler[app] = withDb(env.SUPABASE_POOLER_URL, S0_DB[app]);
    }
    return { label: `1 โปรเจกต์ 3 ฐาน จาก ${ENV_FILE.replace(ROOT, '.')} · ฐาน ${NEEDED.map((a) => S0_DB[a]).join(', ')}${made.length ? ` (สร้างใหม่ ${made.join(', ')})` : ''}`, direct, pooler, cleanup: async () => {} };
  }
  for (const app of NEEDED) {
    const d = env[`${APPS[app].key}_DATABASE_URL`];
    if (!d) fail(`ไม่พบ ${APPS[app].key}_DATABASE_URL ใน ${ENV_FILE} (${APPS[app].name} ต้องมีฐานของตัวเอง) — หรือใช้ SUPABASE_PROJECT_URL แบบ 1 โปรเจกต์ 3 ฐาน`);
    direct[app] = d;
    if (env[`${APPS[app].key}_POOLER_URL`]) pooler[app] = env[`${APPS[app].key}_POOLER_URL`];
  }
  return { label: `ฐานข้อมูลจาก ${ENV_FILE.replace(ROOT, '.')}`, direct, pooler, cleanup: async () => {} };
}

/* ------------------------------------------------------------------ ลำดับงาน */
const results = { probes: {}, gates: {}, creates: {}, poolers: {}, roles: {}, migrations: {}, rls: {}, tests: [], negative: null, r2: null };

/* ------------------------------------------------------------------ ที่เก็บไฟล์ R2 (docs/20 ข้อ 9) */
const R2_KEYS = ['R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];
async function r2Check() {
  const mock = MODE !== 'env';
  const have = R2_KEYS.filter((k) => ENV[k]);
  if (!mock && !have.length) { out('\nที่เก็บไฟล์ R2: ไม่มีค่า R2_* ในไฟล์ค่าตั้ง — ข้าม'); return null; }
  if (!mock && have.length < R2_KEYS.length) { out(`\n✗ ที่เก็บไฟล์ R2: ค่าไม่ครบ ขาด ${R2_KEYS.filter((k) => !ENV[k]).join(', ')}`); return { ok: false, mock, steps: [] }; }
  for (const k of R2_KEYS) if (ENV[k] && ENV[k].length >= 3) secrets.add(ENV[k]);
  const env = { ...process.env, NO_COLOR: '1', ...(mock ? { R2_CHECK_MOCK: '1' } : Object.fromEntries(R2_KEYS.map((k) => [k, ENV[k]]))) };
  delete env.DATABASE_URL;
  const tsx = join(dirname(requireServer.resolve('tsx/package.json')), 'dist/cli.mjs');
  out(`\n## ที่เก็บไฟล์ Cloudflare R2${mock ? ' (R2 จำลองในเครื่อง — ตรวจลายเซ็น SigV4 จริง)' : ''}`);
  const r = await runChild(process.execPath, [tsx, join(ROOT, 'tools/cloud/r2-check.ts')], { cwd: join(ROOT, 'apps/server'), env });
  const line = r.lines.find((l) => l.startsWith('R2CHECK '));
  const res = line ? JSON.parse(line.slice(8)) : { steps: [{ step: 'start', ok: false, ms: 0, detail: r.lines.slice(-5).join(' / ') }] };
  for (const st of res.steps) out(`  ${st.ok ? '✓' : '✗'} ${st.step} · ${st.ms} ms${st.detail ? ` · ${st.detail}` : ''}`);
  return { ok: r.code === 0 && res.steps.length > 0 && res.steps.every((x) => x.ok), mock, steps: res.steps };
}

async function main() {
  for (const p of PHASES) if (!existsSync(join(APPS[p].root, 'apps/server/src/app.ts'))) fail(`ไม่พบ repo ของ ${APPS[p].name} ที่ ${APPS[p].root}`);
  out(`# ตรวจ PostgreSQL บนคลาวด์ (S0 · docs/20) — ${new Date().toISOString()}`);
  if (R2_ONLY) {
    if (MODE === 'env') ENV = readEnvFile(ENV_FILE);
    results.label = 'ตรวจเฉพาะที่เก็บไฟล์ R2';
    results.r2 = await r2Check();
    const ok = !!results.r2?.ok;
    writeReport(ok);
    out(`\n${ok ? '✓ ผ่านทั้งหมด' : '✗ มีรายการไม่ผ่าน'} — สรุปที่ ${REPORT.replace(ROOT, '.')}`);
    process.exit(ok ? 0 : 2);
  }
  const T = MODE === 'local-pg' ? await localTargets() : MODE === 'sim-supabase' ? await simTargets() : await envTargets();
  results.label = T.label;
  out(`เป้าหมาย: ${T.label}`);
  let allOk = true;
  try {
    // 0) ประตูความปลอดภัยต้องปฏิเสธฐานที่มีข้อมูลระบบอื่น (โหมดซ้อม: ฐานปลอมที่มีตาราง employees)
    if (T.foreignUrl) {
      const c = await connect(T.foreignUrl);
      const g = await safetyGate(c, 'buddy');
      await c.end();
      results.negative = !g.ok;
      out(`ประตูความปลอดภัย: ฐานที่มีตารางของระบบอื่น → ${g.ok ? '✗ ยอมรัน (ผิด!)' : '✓ ปฏิเสธ'}${g.ok ? '' : ` (${g.reason})`}`);
      if (g.ok) allOk = false;
    }
    // 1) ตรวจทุกฐานก่อนแตะอะไร
    for (const app of NEEDED) {
      for (const [kind, url] of [['direct', T.direct[app]], ['pooler', T.pooler[app]]]) {
        if (!url) continue;
        const c = await connect(url);
        try {
          const p = await probe(c);
          const g = await safetyGate(c, app);
          results.probes[`${app}:${kind}`] = p;
          results.gates[`${app}:${kind}`] = g;
          out(`\n## ${APPS[app].name} (${kind === 'direct' ? 'ต่อตรง/session' : 'transaction pooler'})`);
          out(`  PostgreSQL ${p.version}${p.platform ? ` (${p.platform})` : ''} · ${p.ssl} · extension ที่ติดตั้ง ${p.exts.length} (${p.exts.join(', ') || '-'}) · มีให้ติดตั้ง ${p.avail} · gen_random_uuid ${p.uuid ? '✓' : '✗'}`);
          out(`  ผู้เชื่อมต่อ: superuser ${p.me.rolsuper ? 'ใช่' : 'ไม่'} · CREATEROLE ${p.me.rolcreaterole ? 'ได้' : 'ไม่ได้'} · CREATEDB ${p.me.rolcreatedb ? 'ได้' : 'ไม่ได้'} · BYPASSRLS ${p.me.rolbypassrls ? 'ใช่' : 'ไม่'} · CREATE ในฐาน ${p.dbCreate ? 'ได้' : 'ไม่ได้'}${p.selfGrant !== null ? ` · createrole_self_grant="${p.selfGrant}"` : ''}`);
          if (!g.ok) { out(`  ✗ ไม่รัน: ${g.reason}`); allOk = false; continue; }
          if (g.marker) out(`  ✓ ฐานทดสอบของเครื่องมือนี้ (สร้าง ${new Date(g.marker.created_at).toISOString().slice(0, 10)} · รันมาแล้ว ${g.marker.run_count} ครั้ง)`);
          else if (kind === 'pooler') { out('  ✗ ไม่รัน: pooler ต้องชี้ฐานเดียวกับ URL ต่อตรง (ซึ่งต้องเตรียมก่อน) — ตรวจว่าเป็นโปรเจกต์เดียวกัน'); allOk = false; }
          else if (!CONFIRMED) { out('  ✗ ฐานว่าง แต่ยังไม่ได้ยืนยัน — รันใหม่พร้อม --i-created-this-test-project ถ้าเป็นโปรเจกต์ทดสอบที่ท่านเพิ่งสร้างเอง'); allOk = false; }
          else { await createMarker(c, app); out('  ✓ ฐานว่าง — สร้างเครื่องหมาย wts_s0_check.marker แล้ว (รอบต่อไปรันซ้ำได้โดยไม่ต้องยืนยัน)'); }
        } finally { await c.end().catch(() => {}); }
      }
    }
    if (!allOk) throw new Error('STOP');
    // 2) สร้าง role / ฐานข้อมูลได้ไหม (ลองจริงแล้วลบ) + pooler
    for (const app of NEEDED) {
      const c = await connect(T.direct[app]);
      try {
        const cr = await tryCreate(c, results.probes[`${app}:direct`].num);
        results.creates[app] = cr;
        out(`\n${APPS[app].name}: CREATE ROLE ${cr.createRole ? '✓' : '✗'} · SET ROLE หลังสร้าง ${cr.setRoleWithoutGrant === null ? '-' : cr.setRoleWithoutGrant ? '✓' : '✗ (ต้อง GRANT … WITH SET TRUE)'}${cr.setRoleAfterGrant === null ? '' : ` → หลัง GRANT ${cr.setRoleAfterGrant ? '✓' : '✗'}`} · CREATE DATABASE ${cr.createDatabase ? '✓' : '✗'}`);
        for (const n of cr.notes) out(`  หมายเหตุ: ${n}`);
      } finally { await c.end(); }
      if (T.pooler[app]) {
        const pr = await poolerChecks(T.pooler[app]);
        results.poolers[app] = pr;
        out(`  pooler: SET LOCAL ในทรานแซกชัน ${pr.setLocalInTx ? '✓' : '✗'} · ไม่รั่วหลัง COMMIT ${pr.noLeakAfterCommit ? '✓' : '✗'} · คำสั่งมีพารามิเตอร์ ${pr.params ? '✓' : '✗'} · backend ที่เจอ ${pr.backendsSeen} · ตัวเลือก TimeZone ตอนเชื่อมต่อ: ${pr.startupOptions}`);
        if (!pr.setLocalInTx || !pr.noLeakAfterCommit || !pr.params) allOk = false;
      }
    }
    // 3) ชุดทดสอบของแต่ละ repo ในโหมด postgres (ต่อตรง แล้วผ่าน pooler ถ้ามี)
    const sets = [['direct', T.direct]];
    if (Object.keys(T.pooler).length) sets.push(['pooler', Object.fromEntries(NEEDED.map((a) => [a, T.pooler[a] ?? T.direct[a]]))]);
    for (const [kind, urls] of SKIP_TESTS ? [] : sets) {
      for (const phase of PHASES) {
        for (const t of TESTS[phase]) {
          for (const app of t.reset) {
            const c = await connect(T.direct[app]);
            try { const r = await resetDatabase(c, app); out(`  ล้างฐาน ${APPS[app].name}: ${r.schemas} schema · ${r.objects} ตาราง/วิว/ฟังก์ชัน`); } finally { await c.end(); }
          }
          out(`\n▶ [${kind}] ${t.label}`);
          const need = Object.fromEntries([...new Set(['buddy', t.repo])].map((a) => [a, urls[a]]));
          const r = await runTest(t, need);
          results.tests.push({ kind, label: t.label, ...r });
          out(`  ${r.ok ? '✓' : '✗'} ${r.summary || `exit ${r.code}`} · ${(r.ms / 1000).toFixed(1)} วินาที`);
          for (const e of r.errs) out(`    ${e}`);
          if (!r.ok) allOk = false;
        }
        // หลังชุดทดสอบของโปรแกรม: migration ครบ · role · RLS
        const app = phase;
        const c = await connect(urls[app]);
        try {
          const mg = await migrationCount(c, app);
          const rc = await roleCheck(c, APPS[app].role);
          results.migrations[`${app}:${kind}`] = mg;
          results.roles[`${app}:${kind}`] = rc;
          out(`  migration ${mg.applied}/${mg.files} ${mg.ok ? '✓' : '✗'} · role ${APPS[app].role}: ${rc.exists ? `มี · BYPASSRLS ${rc.bypass ? '✗ ใช่' : '✓ ไม่'} · SET ROLE ${rc.canSet ? '✓' : '✗'}` : '✗ ไม่มี'} · ตารางมี company_id ที่ไม่เปิด RLS: ${rc.noRls?.length ? rc.noRls.join(', ') : 'ไม่มี ✓'}`);
          if (!mg.ok || !rc.exists || rc.bypass || !rc.canSet) allOk = false;
          if (rc.anon?.length) out(`  ⚠ role anon ของ Supabase อ่านได้ ${rc.anon.length} ตาราง/วิวที่ไม่มี RLS (เช่น ${rc.anon.slice(0, 3).join(', ')}) — ปิด Data API ของโปรเจกต์ (docs/20 ข้อ 1)`);
          if (app !== 'buddy') {
            const p = await rlsProof(c, app);
            results.rls[`${app}:${kind}`] = p;
            out(`  RLS ${APPS[app].role}: ${p.ok ? '✓' : '✗'} ${p.detail}`);
            if (!p.ok) allOk = false;
          } else {
            const t = results.tests.filter((x) => x.kind === kind && x.label.startsWith('Buddy S0')).pop();
            results.rls[`buddy:${kind}`] = { ok: !!t?.ok, detail: 'พิสูจน์ในชุดทดสอบ cloud-s0-flow: buddy_app ของบริษัท A เห็นใบสำคัญบริษัท B = 0 แถว และเขียนข้ามบริษัทถูกปฏิเสธ' };
          }
        } finally { await c.end(); }
      }
    }
  } catch (e) {
    if (e.message !== 'STOP') { out(`\n✗ หยุด: ${e.message}`); allOk = false; }
  } finally {
    await T.cleanup().catch((e) => out(`  ล้างของชั่วคราวไม่สำเร็จ: ${e.message}`));
  }
  results.r2 = await r2Check().catch((e) => ({ ok: false, mock: MODE !== 'env', steps: [{ step: 'start', ok: false, ms: 0, detail: e.message }] }));
  if (results.r2 && !results.r2.ok) allOk = false;
  writeReport(allOk);
  out(`\n${allOk ? '✓ ผ่านทั้งหมด' : '✗ มีรายการไม่ผ่าน'} — สรุปที่ ${REPORT.replace(ROOT, '.')}`);
  process.exit(allOk ? 0 : 2);
}

/* ------------------------------------------------------------------ รายงาน (ไม่มีความลับ) */
function writeReport(allOk) {
  const L = [];
  const yes = (b) => (b ? '✓' : '✗');
  L.push(`# ผลตรวจฐานข้อมูลบนคลาวด์ S0 / Cloud database check S0`, '');
  L.push(`- วันที่ / Date: ${new Date().toISOString()}`);
  L.push(`- โหมด / Mode: ${MODE}${ONE_PROJECT ? ' · 1 โปรเจกต์ 3 ฐาน / one project, 3 databases' : ''} — ${results.label ?? ''}`);
  L.push(`- ผลรวม / Overall: **${allOk ? 'ผ่าน / PASS' : 'ไม่ผ่าน / FAIL'}**`);
  L.push(`- ไม่มี URL รหัสผ่าน หรือชื่อเครื่องในรายงานนี้ / No URLs, passwords or hosts in this report.`, '');
  if (results.negative !== null) L.push(`ประตูความปลอดภัย (ฐานที่มีตารางของระบบอื่นต้องถูกปฏิเสธ) / Safety gate refuses a database with foreign tables: ${yes(results.negative)}`, '');
  L.push('## เซิร์ฟเวอร์และสิทธิ์ / Server and privileges', '');
  L.push('| ฐาน / DB | PostgreSQL | SSL | superuser | CREATEROLE | CREATEDB | BYPASSRLS | extensions | ประตูความปลอดภัย / gate |', '|---|---|---|---|---|---|---|---|---|');
  for (const [k, p] of Object.entries(results.probes)) {
    const g = results.gates[k];
    L.push(`| ${k} | ${p.version}${p.platform ? ` ${p.platform}` : ''} | ${p.ssl} | ${p.me.rolsuper ? 'yes' : 'no'} | ${p.me.rolcreaterole ? 'yes' : 'no'} | ${p.me.rolcreatedb ? 'yes' : 'no'} | ${p.me.rolbypassrls ? 'yes' : 'no'} | ${p.exts.length} (${p.exts.join(', ') || '-'}) | ${g?.ok ? 'ok' : `ไม่รัน: ${g?.reason ?? ''}`} |`);
  }
  if (Object.keys(results.creates).length) {
    L.push('', '## สร้าง role / ฐานข้อมูล (ลองจริงแล้วลบ) / CREATE ROLE / DATABASE (tried, then dropped)', '');
    L.push('| ฐาน | CREATE ROLE | SET ROLE ทันที / right after create | หลัง GRANT … WITH SET TRUE | CREATE DATABASE | หมายเหตุ |', '|---|---|---|---|---|---|');
    for (const [k, c] of Object.entries(results.creates)) L.push(`| ${k} | ${yes(c.createRole)} | ${c.setRoleWithoutGrant === null ? '-' : yes(c.setRoleWithoutGrant)} | ${c.setRoleAfterGrant === null ? '-' : yes(c.setRoleAfterGrant)} | ${yes(c.createDatabase)} | ${c.notes.join('; ').replace(/\|/g, '/') || '-'} |`);
  }
  if (Object.keys(results.poolers).length) {
    L.push('', '## Transaction pooler', '');
    L.push('| ฐาน | SET LOCAL ในทรานแซกชัน | ไม่รั่วหลัง COMMIT / no leak | พารามิเตอร์ / params | backend | ตัวเลือกตอนเชื่อมต่อ (TimeZone) |', '|---|---|---|---|---|---|');
    for (const [k, p] of Object.entries(results.poolers)) L.push(`| ${k} | ${yes(p.setLocalInTx)} | ${yes(p.noLeakAfterCommit)} | ${yes(p.params)} | ${p.backendsSeen} | ${p.startupOptions} |`);
  }
  if (results.tests.length) {
    L.push('', '## ชุดทดสอบของแต่ละโปรแกรมบนฐานนี้ / Each repo’s tests on this database', '');
    L.push('| ทาง / path | ชุดทดสอบ / suite | ผล / result | เวลา / time |', '|---|---|---|---|');
    for (const t of results.tests) L.push(`| ${t.kind} | ${t.label} | ${yes(t.ok)} ${t.summary || `exit ${t.code}`} | ${(t.ms / 1000).toFixed(1)} s |`);
    L.push('', '| ฐาน | migration | role ใต้ RLS / RLS role | RLS พิสูจน์ / proof |', '|---|---|---|---|');
    for (const k of Object.keys(results.migrations)) {
      const m = results.migrations[k]; const r = results.roles[k]; const p = results.rls[k];
      L.push(`| ${k} | ${m.applied}/${m.files} ${yes(m.ok)} | ${r.exists ? `BYPASSRLS ${r.bypass ? 'yes ✗' : 'no ✓'} · SET ROLE ${yes(r.canSet)}${r.anon?.length ? ` · ⚠ anon อ่านได้ ${r.anon.length} ตาราง (ปิด Data API)` : ''}` : 'ไม่มี ✗'} | ${p ? `${yes(p.ok)} ${p.detail}` : '-'} |`);
    }
  }
  if (results.r2) {
    L.push('', `## ที่เก็บไฟล์ Cloudflare R2 / File storage${results.r2.mock ? ' (R2 จำลองในเครื่อง / local mock that checks SigV4)' : ''}`, '');
    L.push('| ขั้น / step | ผล / result | เวลา / time | รายละเอียด / detail |', '|---|---|---|---|');
    for (const st of results.r2.steps) L.push(`| ${st.step} | ${yes(st.ok)} | ${st.ms} ms | ${String(st.detail ?? '-').replace(/\|/g, '/')} |`);
  }
  L.push('', '## บันทึกการรัน (ปิดบังแล้ว) / Run log (masked)', '', '```', ...log, '```', '');
  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, mask(L.join('\n')), 'utf8');
}

main().catch((e) => { console.error(mask(`✗ ${e?.stack ?? e}`)); process.exit(1); });
