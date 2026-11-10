// ส่งความลับของโปรแกรมขึ้น Cloudflare (wrangler secret) — S1 ของ docs/20 · HANDOFF ข้อ 105 · เจ้าของรันเอง (ผู้ช่วยแตะความลับของฐานจริงไม่ได้)
//
//   node tools/cloud/put-secrets.mjs                 ทั้ง 3 โปรแกรม (Worker ต้องมีแล้ว — สร้างจาก Workers Builds)
//   node tools/cloud/put-secrets.mjs --app buddy     เฉพาะโปรแกรมเดียว (buddy · pos · living)
//   node tools/cloud/put-secrets.mjs --dry-run       แสดงว่าจะส่งชื่ออะไรให้ Worker ไหน (ไม่แสดงค่า ไม่ส่ง)
//
// อ่าน .data/cloud-prod.env (SUPABASE_PROJECT_URL จาก set-supabase-url.ps1)
// - DATABASE_URL ของแต่ละโปรแกรม = ที่อยู่โปรเจกต์ + ชื่อฐาน (buddy / wtspos / wtsliving) + ใบรับรอง CA ในรูป container (/app/tools/cloud/supabase-ca.crt)
// - กุญแจหลักของแต่ละโปรแกรม (BUDDY_SECRET_KEY / WTSPOS_SECRET_KEY / WTSLIVING_SECRET_KEY): ไม่มี = สร้างใหม่ 32 ไบต์ แล้วเก็บใน .data/cloud-prod.env
//   ⚠️ กุญแจนี้ถอดรหัสข้อมูลลับในฐาน (กุญแจ API, 2FA) — สำรองไฟล์ .data/cloud-prod.env ไว้ในที่ปลอดภัย หายแล้วกู้ข้อมูลลับคืนไม่ได้
// - ส่งด้วย wrangler secret bulk (ไฟล์ชั่วคราวใน .data ลบทันทีหลังส่ง) · ไม่พิมพ์ค่าใด ๆ ออกจอ
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ENV_FILE = join(ROOT, '.data/cloud-prod.env');
const CA_IN_CONTAINER = '/app/tools/cloud/supabase-ca.crt';
const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const only = (() => { const i = argv.indexOf('--app'); return i >= 0 ? argv[i + 1] : null; })();

const APPS = [
  { key: 'buddy', name: 'Buddy Account', worker: 'wts-buddy', db: 'buddy', secretKey: 'BUDDY_SECRET_KEY' },
  { key: 'pos', name: 'WTS-POS', worker: 'wts-pos', db: 'wtspos', secretKey: 'WTSPOS_SECRET_KEY' },
  { key: 'living', name: 'WTS-Living', worker: 'wts-living', db: 'wtsliving', secretKey: 'WTSLIVING_SECRET_KEY' },
];

const fail = (m) => { console.error(`✗ ${m}`); process.exit(1); };
if (only && !APPS.some((a) => a.key === only)) fail(`ไม่รู้จัก --app ${only} — ใช้ buddy · pos · living`);
if (!existsSync(ENV_FILE)) fail('ไม่พบ .data/cloud-prod.env — รัน powershell -ExecutionPolicy Bypass -File tools\\cloud\\set-supabase-url.ps1 -EnvFile .data\\cloud-prod.env');

const raw = readFileSync(ENV_FILE, 'utf8');
const nl = raw.includes('\r\n') ? '\r\n' : '\n';
const lines = raw.split(/\r?\n/);
const env = {};
for (const l of lines) {
  const t = l.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
}
const project = env.SUPABASE_PROJECT_URL;
if (!project || project.includes('YOUR-') || project.includes('<')) fail('ไม่พบ SUPABASE_PROJECT_URL ใน .data/cloud-prod.env');
if (!existsSync(join(ROOT, 'tools/cloud/supabase-ca.crt'))) fail('ไม่พบ tools/cloud/supabase-ca.crt (ใบรับรอง CA ของ Supabase ที่ใส่ใน image)');

function dbUrl(db) {
  const u = new URL(project);
  u.pathname = `/${db}`;
  u.searchParams.delete('sslrootcert');
  u.searchParams.set('sslmode', 'verify-full');
  u.searchParams.set('sslrootcert', CA_IN_CONTAINER);
  return u.toString();
}

// กุญแจหลักที่ยังไม่มี → สร้างและเก็บก่อนส่ง (รันซ้ำได้ ใช้ค่าเดิม)
let added = 0;
for (const a of APPS) {
  if (env[a.secretKey]) continue;
  env[a.secretKey] = randomBytes(32).toString('base64');
  lines.push(`${a.secretKey}=${env[a.secretKey]}`);
  added++;
}
if (added && !DRY) writeFileSync(ENV_FILE, lines.join(nl).replace(/(\r?\n)*$/, nl), 'utf8');

const run = (args) => new Promise((done) => {
  const ch = spawn('npx', ['--yes', 'wrangler@4', ...args], { cwd: ROOT, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  let buf = '';
  ch.stdout.on('data', (d) => { buf += d; });
  ch.stderr.on('data', (d) => { buf += d; });
  ch.on('close', (code) => done({ code, text: buf }));
});
const clean = (t) => t.split(/\r?\n/).map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').trim()).filter((l) => l && !/wrangler \d|───|update available/.test(l));

let ok = true;
for (const a of APPS.filter((x) => !only || x.key === only)) {
  const secrets = { DATABASE_URL: dbUrl(a.db), [a.secretKey]: env[a.secretKey] };
  console.log(`\n## ${a.name} → Worker ${a.worker}: ${Object.keys(secrets).join(', ')}`);
  if (DRY) { console.log('  (ทดลอง — ไม่ส่ง)'); continue; }
  const tmp = join(ROOT, `.data/tmp-secrets-${a.key}.json`);
  try {
    writeFileSync(tmp, JSON.stringify(secrets), { encoding: 'utf8', mode: 0o600 });
    const r = await run(['secret', 'bulk', tmp, '--name', a.worker]);
    const out = clean(r.text).filter((l) => !Object.values(secrets).some((v) => l.includes(v)));
    for (const l of out.slice(-4)) console.log(`  ${l}`);
    if (r.code !== 0) {
      ok = false;
      if (/not found|does not exist|10007/i.test(r.text)) console.log(`  ✗ ยังไม่มี Worker ${a.worker} — เชื่อม GitHub ใน Workers Builds ให้ Cloudflare สร้างก่อน แล้วรันใหม่`);
    } else console.log('  ✓ ส่งแล้ว — container จะใช้ค่าใหม่เมื่อเปิดครั้งถัดไป');
  } finally { rmSync(tmp, { force: true }); }
}
if (added) console.log(DRY ? `\n(ทดลอง) จะสร้างกุญแจหลักใหม่ ${added} ชุด ตอนรันจริง` : `\nสร้างกุญแจหลักใหม่ ${added} ชุด เก็บใน .data/cloud-prod.env — สำรองไฟล์นี้ไว้ในที่ปลอดภัย`);
console.log(ok ? '\n✓ เสร็จ' : '\n✗ มีบางโปรแกรมไม่สำเร็จ (ดูด้านบน)');
process.exit(ok ? 0 : 2);
