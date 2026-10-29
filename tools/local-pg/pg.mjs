// PostgreSQL 16 ของ Buddy Account บนเครื่องนี้ (แยกจาก WTS-ERP: โฟลเดอร์ .data/pg และพอร์ตของตัวเอง)
// ใช้:  node tools/local-pg/pg.mjs start | stop | status | url | run -- <คำสั่ง…>
//   run = เปิดฐานข้อมูล (ถ้ายังไม่เปิด) แล้วรันคำสั่งโดยตั้ง DATABASE_URL ให้ เช่น
//         node tools/local-pg/pg.mjs run -- pnpm --filter @buddy/server start
// รหัสผ่านสุ่มครั้งแรกแล้วเก็บใน .data/pg/settings.json (ไม่อยู่ใน git)
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import EmbeddedPostgres from 'embedded-postgres';

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BASE = resolve(process.env.BUDDY_PG_DIR ?? join(ROOT, '.data/pg'));
const DATA = join(BASE, 'data');
const LOG = join(BASE, 'postgres.log');
const SETTINGS = join(BASE, 'settings.json');
const DB_NAME = 'buddy';

function settings() {
  if (existsSync(SETTINGS)) return JSON.parse(readFileSync(SETTINGS, 'utf8'));
  mkdirSync(BASE, { recursive: true });
  const s = { port: Number(process.env.BUDDY_PG_PORT ?? 5544), user: 'postgres', password: randomBytes(18).toString('base64url') };
  writeFileSync(SETTINGS, JSON.stringify(s, null, 2));
  return s;
}
const urlOf = (s, db = DB_NAME) => `postgres://${s.user}:${encodeURIComponent(s.password)}@127.0.0.1:${s.port}/${db}`;

async function pgCtl() {
  const pkg = `@embedded-postgres/${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`;
  // แพ็กเกจไบนารีเป็น dependency ของ embedded-postgres (ไม่ได้อยู่ที่ราก) จึงหาจากตำแหน่งของมัน
  const from = createRequire(createRequire(import.meta.url).resolve('embedded-postgres'));
  return (await import(pathToFileURL(from.resolve(pkg)).href)).pg_ctl;
}
const embedded = (s) => new EmbeddedPostgres({ databaseDir: DATA, user: s.user, password: s.password, port: s.port, persistent: true, initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {}, onError: () => {} });

async function isRunning() {
  if (!existsSync(join(DATA, 'PG_VERSION'))) return false;
  try { await run(await pgCtl(), ['status', '-D', DATA]); return true; } catch { return false; }
}

async function start() {
  const s = settings();
  if (!existsSync(join(DATA, 'PG_VERSION'))) {
    console.log(`สร้างฐานข้อมูลใหม่ที่ ${DATA} …`);
    await embedded(s).initialise();
  }
  if (!(await isRunning())) {
    // เปิดแบบแยกตัว ให้ฐานข้อมูลทำงานต่อหลังคำสั่งนี้จบ (stdio ต้อง ignore ไม่งั้นบน Windows จะค้าง)
    const ctl = await pgCtl();
    const exit = await new Promise((ok, bad) => {
      const c = spawn(ctl, ['start', '-D', DATA, '-w', '-l', LOG, '-o', `-p ${s.port}`], { stdio: 'ignore', windowsHide: true });
      c.once('error', bad); c.once('exit', ok);
    });
    if (exit !== 0) throw new Error(`เปิด PostgreSQL ไม่สำเร็จ (exit ${exit}) — ดู ${LOG} (พอร์ต ${s.port} อาจถูกโปรแกรมอื่นใช้อยู่)`);
  }
  // ใช้ไลบรารี pg ตัวที่มากับ embedded-postgres สร้างฐานข้อมูล buddy ถ้ายังไม่มี
  const { default: pg } = await import(pathToFileURL(createRequire(createRequire(import.meta.url).resolve('embedded-postgres')).resolve('pg')).href);
  const c = new pg.Client({ connectionString: urlOf(s, 'postgres') });
  await c.connect();
  try {
    const has = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB_NAME]);
    if (!has.rowCount) { await c.query(`CREATE DATABASE ${DB_NAME} ENCODING 'UTF8'`); console.log(`สร้างฐานข้อมูล ${DB_NAME} แล้ว`); }
  } finally { await c.end(); }
  console.log(`PostgreSQL ของ Buddy Account พร้อมที่พอร์ต ${s.port}`);
  return s;
}

async function stop() {
  if (!(await isRunning())) { console.log('PostgreSQL ของ Buddy Account ปิดอยู่แล้ว'); return; }
  await run(await pgCtl(), ['stop', '-D', DATA, '-m', 'fast', '-w']);
  console.log('ปิด PostgreSQL ของ Buddy Account แล้ว');
}

const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === 'start') await start();
  else if (cmd === 'stop') await stop();
  else if (cmd === 'status') console.log((await isRunning()) ? `เปิดอยู่ (พอร์ต ${settings().port})` : 'ปิดอยู่');
  else if (cmd === 'url') process.stdout.write(urlOf(settings()));
  else if (cmd === 'run') {
    const args = rest[0] === '--' ? rest.slice(1) : rest;
    if (!args.length) throw new Error('ใช้: run -- <คำสั่ง…>');
    const s = await start();
    const child = spawn(args[0], args.slice(1), { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, DATABASE_URL: urlOf(s) } });
    child.once('exit', (c) => process.exit(c ?? 1));
  } else {
    console.log('ใช้: node tools/local-pg/pg.mjs start | stop | status | url | run -- <คำสั่ง…>');
  }
} catch (e) {
  console.error(e?.message ?? e);
  process.exit(1);
}
