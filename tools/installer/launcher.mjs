// ตัวเปิดโปรแกรม Buddy Account ฉบับติดตั้งบน Windows (T7.4) — รวมเป็นไฟล์เดียวด้วย esbuild ตอนสร้างตัวติดตั้ง
//   node launcher.mjs          เปิดฐานข้อมูล + โปรแกรม แล้วเปิดเบราว์เซอร์ (ถ้าเปิดอยู่แล้ว เปิดเบราว์เซอร์อย่างเดียว)
//   node launcher.mjs stop     ปิดโปรแกรมและฐานข้อมูล
//   node launcher.mjs status   แสดงสถานะ
// โครงโฟลเดอร์โปรแกรม: <ติดตั้ง>\node\node.exe · <ติดตั้ง>\app\launcher.mjs · app\server\main.mjs · app\pgsql\bin · app\apps\web\dist · app\db\...
// ข้อมูลอยู่แยกจากโปรแกรม: %LOCALAPPDATA%\BuddyAccount (เปลี่ยนได้ด้วย BUDDY_HOME) — ถอนการติดตั้ง/อัปเดตแล้วข้อมูลยังอยู่
import { execFile, spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import pg from 'pg';

const run = promisify(execFile);
const APP = dirname(fileURLToPath(import.meta.url));
const NODE = process.execPath;
const HOME = process.env.BUDDY_HOME ?? join(process.env.LOCALAPPDATA ?? homedir(), 'BuddyAccount');
const PGDATA = join(HOME, 'pgdata');
const LOGS = join(HOME, 'logs');
const CONFIG = join(HOME, 'config.json');
const PIDFILE = join(HOME, 'server.pid');
const STOPPING = join(HOME, 'stopping');   // สั่งปิดจากเมนู "ปิด Buddy Account" — ไม่ใช่โปรแกรมล้ม
const BIN = join(APP, 'pgsql', 'bin');
const VERSION = (() => { try { return JSON.parse(readFileSync(join(APP, 'version.json'), 'utf8')); } catch { return { version: '0.0.0' }; } })();

const say = (s) => console.log(s);
const portFree = (port, host = '127.0.0.1') => new Promise((ok) => {
  const s = createServer().once('error', () => ok(false)).once('listening', () => s.close(() => ok(true)));
  s.listen(port, host);
});
async function firstFree(from) { for (let p = from; p < from + 50; p++) if (await portFree(p)) return p; throw new Error(`ไม่มีพอร์ตว่างตั้งแต่ ${from}`); }

/** ตั้งค่าเครื่อง: สร้างครั้งแรก แก้ได้ที่ config.json (host 0.0.0.0 = ให้เครื่องอื่นในวง LAN เข้าใช้) */
async function config() {
  mkdirSync(LOGS, { recursive: true });
  let c = existsSync(CONFIG) ? JSON.parse(readFileSync(CONFIG, 'utf8')) : null;
  if (!c) {
    c = { port: 4100, host: '127.0.0.1', pgPort: await firstFree(5546), pgPassword: randomBytes(18).toString('base64url') };
    writeFileSync(CONFIG, JSON.stringify(c, null, 2));
  }
  if (process.env.BUDDY_PORT) c.port = Number(process.env.BUDDY_PORT);
  return c;
}
const pgUrl = (c, db = 'buddy') => `postgres://postgres:${encodeURIComponent(c.pgPassword)}@127.0.0.1:${c.pgPort}/${db}`;
const appUrl = (c) => `http://localhost:${c.port}`;

async function health(c) {
  try { const r = await fetch(`http://127.0.0.1:${c.port}/api/v1/health`, { signal: AbortSignal.timeout(1500) }); return r.ok ? await r.json() : null; } catch { return null; }
}
async function pgRunning() {
  if (!existsSync(join(PGDATA, 'PG_VERSION'))) return false;
  try { await run(join(BIN, 'pg_ctl.exe'), ['status', '-D', PGDATA], { windowsHide: true }); return true; } catch { return false; }
}

async function startPg(c) {
  if (!existsSync(join(PGDATA, 'PG_VERSION'))) {
    say('ครั้งแรก: กำลังสร้างฐานข้อมูล (ประมาณ 1 นาที) …');
    const pw = join(HOME, 'pw.tmp');
    writeFileSync(pw, c.pgPassword);
    try { await run(join(BIN, 'initdb.exe'), ['-D', PGDATA, '-U', 'postgres', `--pwfile=${pw}`, '-E', 'UTF8', '--locale=C', '-A', 'scram-sha-256'], { windowsHide: true }); }
    finally { rmSync(pw, { force: true }); }
  }
  if (!(await pgRunning())) {
    if (!(await portFree(c.pgPort))) throw new Error(`พอร์ตฐานข้อมูล ${c.pgPort} ถูกโปรแกรมอื่นใช้อยู่ — แก้ "pgPort" ใน ${CONFIG} เป็นเลขอื่นแล้วเปิดใหม่`);
    // เปิดแยกตัว (stdio ignore ไม่งั้นบน Windows ค้าง) · รับเฉพาะเครื่องนี้ — เครื่องอื่นเข้าผ่านโปรแกรมเท่านั้น
    const code = await new Promise((ok, bad) => {
      const p = spawn(join(BIN, 'pg_ctl.exe'), ['start', '-D', PGDATA, '-w', '-t', '120', '-l', join(LOGS, 'postgres.log'), '-o', `-p ${c.pgPort} -c listen_addresses=127.0.0.1`], { stdio: 'ignore', windowsHide: true });
      p.once('error', bad); p.once('exit', ok);
    });
    if (code !== 0) throw new Error(`เปิดฐานข้อมูลไม่สำเร็จ — ดูรายละเอียดที่ ${join(LOGS, 'postgres.log')}`);
  }
  const cl = new pg.Client({ connectionString: pgUrl(c, 'postgres') });
  await cl.connect();
  try { if (!(await cl.query("SELECT 1 FROM pg_database WHERE datname = 'buddy'")).rowCount) await cl.query("CREATE DATABASE buddy ENCODING 'UTF8'"); }
  finally { await cl.end(); }
}
async function stopPg() { if (await pgRunning()) await run(join(BIN, 'pg_ctl.exe'), ['stop', '-D', PGDATA, '-m', 'fast', '-w'], { windowsHide: true }); }

function openBrowser(url) { spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true, windowsHide: true }).unref(); }

async function start() {
  const c = await config();
  const h = await health(c);
  if (h) { say(`Buddy Account เปิดอยู่แล้ว — เปิดเบราว์เซอร์ที่ ${appUrl(c)}`); if (!process.env.BUDDY_NO_BROWSER) openBrowser(appUrl(c)); return; }
  if (!(await portFree(c.port, c.host === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1'))) throw new Error(`พอร์ต ${c.port} ถูกโปรแกรมอื่นใช้อยู่ — แก้ "port" ใน ${CONFIG} เป็นเลขอื่นแล้วเปิดใหม่`);
  say(`Buddy Account ${VERSION.version} — ข้อมูลอยู่ที่ ${HOME}`);
  rmSync(STOPPING, { force: true });
  await startPg(c);
  const log = openSync(join(LOGS, 'server.log'), 'a');
  const srv = spawn(NODE, [join(APP, 'server', 'main.mjs')], {
    stdio: ['ignore', log, log], windowsHide: true,
    env: { ...process.env, DATABASE_URL: pgUrl(c), BUDDY_ROOT: APP, BUDDY_SECRET_FILE: join(HOME, 'secret.key'), PORT: String(c.port), HOST: c.host, BUDDY_VERSION: VERSION.version, NODE_ENV: 'production', LOG_LEVEL: process.env.LOG_LEVEL ?? 'warn' },
  });
  closeSync(log);
  writeFileSync(PIDFILE, String(srv.pid));
  let exited = null;
  srv.once('exit', (code) => { exited = code ?? 0; });
  for (let i = 0; i < 120 && exited === null && !(await health(c)); i++) await new Promise((r) => setTimeout(r, 500));
  if (exited !== null || !(await health(c))) { srv.kill(); throw new Error(`โปรแกรมเปิดไม่สำเร็จ — ดูรายละเอียดที่ ${join(LOGS, 'server.log')}`); }
  say(`พร้อมใช้งานที่ ${appUrl(c)}${c.host === '0.0.0.0' ? ' (เครื่องอื่นในวง LAN เข้าด้วยเลข IP ของเครื่องนี้)' : ''}`);
  say('ปิดหน้าต่างนี้ = ปิดโปรแกรม (ข้อมูลบันทึกแล้วทุกครั้งที่กดบันทึก)');
  if (!process.env.BUDDY_NO_BROWSER) openBrowser(appUrl(c));
  const shutdown = async () => { srv.kill(); rmSync(PIDFILE, { force: true }); await stopPg().catch(() => {}); process.exit(0); };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, shutdown);
  await new Promise((r) => srv.once('exit', r));
  rmSync(PIDFILE, { force: true });
  if (existsSync(STOPPING)) { rmSync(STOPPING, { force: true }); say('ปิดโปรแกรมแล้ว'); }
  else if (exited) say(`โปรแกรมหยุดทำงาน (รหัส ${exited}) — ดู ${join(LOGS, 'server.log')}`);
  await stopPg().catch(() => {});
}

async function stop() {
  const c = await config();
  if (existsSync(PIDFILE)) {
    const pid = Number(readFileSync(PIDFILE, 'utf8'));
    writeFileSync(STOPPING, '');
    try { process.kill(pid); } catch { /* ปิดไปแล้ว */ }
    rmSync(PIDFILE, { force: true });
  }
  for (let i = 0; i < 20 && (await health(c)); i++) await new Promise((r) => setTimeout(r, 250));
  // หน้าต่างโปรแกรมก็ปิดฐานข้อมูลพร้อมกัน — ถ้าอีกฝั่งปิดไปก่อนก็ไม่ถือว่าผิดพลาด
  await stopPg().catch(async (e) => { if (await pgRunning()) throw e; });
  for (let i = 0; i < 20 && existsSync(STOPPING); i++) await new Promise((r) => setTimeout(r, 250));   // ให้หน้าต่างโปรแกรมรับรู้ก่อน
  rmSync(STOPPING, { force: true });
  say('ปิด Buddy Account แล้ว');
}

async function status() {
  const c = await config();
  const h = await health(c);
  say(`โปรแกรม: ${h ? `เปิดอยู่ ${appUrl(c)} (รุ่น ${h.version})` : 'ปิดอยู่'} · ฐานข้อมูล: ${(await pgRunning()) ? `เปิดอยู่ พอร์ต ${c.pgPort}` : 'ปิดอยู่'} · ข้อมูล: ${HOME}`);
}

const cmd = process.argv[2] ?? 'start';
try {
  if (cmd === 'start') await start();
  else if (cmd === 'stop') await stop();
  else if (cmd === 'status') await status();
  else say('ใช้: launcher.mjs [start|stop|status]');
} catch (e) {
  console.error(`\nเกิดข้อผิดพลาด: ${e.message}`);
  process.exitCode = 1;
}
