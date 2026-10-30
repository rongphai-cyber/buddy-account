// สำเนาฐาน DEMO สำหรับทดสอบอัตโนมัติ (smoke) เมื่อ admin เปิดยืนยันตัวตนสองขั้นแล้ว — ไม่แตะฐานจริง ไม่ใช้กุญแจ 2FA ของเจ้าของ
// ใช้ผ่าน pg.mjs (ตั้ง DATABASE_URL ของฐานจริงให้):
//   node tools/local-pg/pg.mjs run -- node tools/demo-check/smoke-copy.mjs create      สร้าง buddy_smoke จากฐานจริง (ปิด server ก่อน) แล้วล้าง 2FA/session ในสำเนา
//   node tools/local-pg/pg.mjs run -- node tools/demo-check/smoke-copy.mjs run -- <คำสั่ง>   รันคำสั่ง (เช่น เปิด server) กับสำเนา
//   node tools/local-pg/pg.mjs run -- node tools/demo-check/smoke-copy.mjs drop        ลบสำเนา
import { spawn } from 'node:child_process';
import pg from 'file:///E:/BuddyAccount/apps/server/node_modules/pg/lib/index.js';

const COPY = 'buddy_smoke';
const src = new URL(process.env.DATABASE_URL ?? '');
if (!src.pathname || src.pathname === '/') { console.error('ต้องรันผ่าน tools/local-pg/pg.mjs run --'); process.exit(1); }
const srcDb = src.pathname.slice(1);
const urlOf = (db) => { const u = new URL(src); u.pathname = '/' + db; return u.toString(); };
const [cmd, ...rest] = process.argv.slice(2);

async function admin(fn) {
  const c = new pg.Client({ connectionString: urlOf('postgres') });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

if (cmd === 'create') {
  await admin(async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${COPY}`);
    await c.query(`CREATE DATABASE ${COPY} TEMPLATE ${srcDb}`);   // ต้องไม่มีใครเชื่อมต่อฐานจริงอยู่ (ปิด server ก่อน)
  });
  const c = new pg.Client({ connectionString: urlOf(COPY) });
  await c.connect();
  await c.query(`UPDATE sys_user_security SET totp_enabled = false, totp_secret_enc = NULL, totp_recovery = NULL, failed_logins = 0, locked_until = NULL`);
  await c.query(`UPDATE sys_session SET ended_at = now() WHERE ended_at IS NULL`);
  await c.end();
  console.log(`สร้างสำเนา ${COPY} แล้ว (ล้างยืนยันตัวตนสองขั้นเฉพาะในสำเนา)`);
} else if (cmd === 'drop') {
  await admin((c) => c.query(`DROP DATABASE IF EXISTS ${COPY}`));
  console.log(`ลบสำเนา ${COPY} แล้ว`);
} else if (cmd === 'run') {
  const args = rest[0] === '--' ? rest.slice(1) : rest;
  const child = spawn(args[0], args.slice(1), { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, DATABASE_URL: urlOf(COPY) } });
  child.on('exit', (code) => process.exit(code ?? 0));
} else {
  console.log('คำสั่ง: create | run -- <คำสั่ง> | drop');
}
