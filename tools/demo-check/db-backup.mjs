// สำรอง/คืนฐานข้อมูลทั้งก้อนด้วยการคัดลอกฐาน (PostgreSQL ของเครื่องนี้) — ต้องปิด server ก่อน (ฐานต้นทางห้ามมีผู้เชื่อมต่อ)
//   node tools/local-pg/pg.mjs run -- node tools/demo-check/db-backup.mjs save <ชื่อ>      คัดลอกฐานจริง → <ชื่อ>
//   node tools/local-pg/pg.mjs run -- node tools/demo-check/db-backup.mjs list
//   node tools/local-pg/pg.mjs run -- node tools/demo-check/db-backup.mjs restore <ชื่อ>   ฐานจริงกลับเป็น <ชื่อ> (ฐานปัจจุบันเก็บไว้เป็น <ฐาน>_before_restore)
import pg from 'file:///E:/BuddyAccount/apps/server/node_modules/pg/lib/index.js';

const src = new URL(process.env.DATABASE_URL ?? '');
if (!src.pathname || src.pathname === '/') { console.error('ต้องรันผ่าน tools/local-pg/pg.mjs run --'); process.exit(1); }
const live = src.pathname.slice(1);
const admin = new pg.Client({ connectionString: Object.assign(new URL(src), { pathname: '/postgres' }).toString() });
const [cmd, name] = process.argv.slice(2);
const ok = (n) => /^[a-z][a-z0-9_]{2,40}$/.test(n ?? '');
await admin.connect();
try {
  if (cmd === 'save') {
    if (!ok(name)) throw new Error('ตั้งชื่อเป็นตัวอักษรอังกฤษเล็ก ตัวเลข _ เช่น buddy_backup_20261030');
    await admin.query(`CREATE DATABASE ${name} TEMPLATE ${live}`);
    console.log(`สำรองฐาน ${live} → ${name} แล้ว`);
  } else if (cmd === 'list') {
    for (const r of (await admin.query(`SELECT datname, pg_size_pretty(pg_database_size(datname)) AS size FROM pg_database WHERE datname LIKE 'buddy%' ORDER BY 1`)).rows) console.log(`${r.datname}\t${r.size}`);
  } else if (cmd === 'restore') {
    if (!ok(name)) throw new Error('ระบุชื่อฐานสำรอง');
    await admin.query(`ALTER DATABASE ${live} RENAME TO ${live}_before_restore`);
    await admin.query(`CREATE DATABASE ${live} TEMPLATE ${name}`);
    console.log(`คืนฐาน ${live} จาก ${name} แล้ว (ฐานเดิมเก็บเป็น ${live}_before_restore)`);
  } else console.log('คำสั่ง: save <ชื่อ> | list | restore <ชื่อ>');
} catch (e) { console.error('ไม่สำเร็จ:', e.message); process.exitCode = 1; } finally { await admin.end(); }
