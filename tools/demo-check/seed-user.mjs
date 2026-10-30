// ผู้ใช้ชั่วคราวสำหรับใส่ข้อมูลทดลองผ่าน API (ไม่มียืนยันตัวตนสองขั้น — ใช้เฉพาะตอนใส่ข้อมูล แล้วปิด)
//   node tools/local-pg/pg.mjs run -- node tools/demo-check/seed-user.mjs on    สร้าง/เปิด demo.seed (รหัสผ่านสุ่ม เก็บใน .data/ข้อมูลเข้าระบบ-ผู้ใส่ข้อมูลทดลอง.txt)
//   node tools/local-pg/pg.mjs run -- node tools/demo-check/seed-user.mjs off   ปิดผู้ใช้นี้ (สถานะเลิกใช้)
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import pg from 'file:///E:/BuddyAccount/apps/server/node_modules/pg/lib/index.js';
import bcrypt from 'file:///E:/BuddyAccount/apps/server/node_modules/bcryptjs/index.js';

const FILE = 'E:/BuddyAccount/.data/ข้อมูลเข้าระบบ-ผู้ใส่ข้อมูลทดลอง.txt';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const cmd = process.argv[2];
if (cmd === 'on') {
  const pass = 'Seed-' + randomBytes(9).toString('base64url');
  const admin = (await c.query(`SELECT user_group_id FROM sys_user WHERE username = 'admin'`)).rows[0];
  const hash = await bcrypt.hash(pass, 10);
  const cur = (await c.query(`SELECT id FROM sys_user WHERE username = 'demo.seed'`)).rows[0];
  if (cur) await c.query(`UPDATE sys_user SET password_hash = $1, status = 'A', user_group_id = $2, approval_level = 9, deleted_at = NULL WHERE id = $3`, [hash, admin.user_group_id, cur.id]);
  else await c.query(`INSERT INTO sys_user (tenant_id, username, display_name, password_hash, user_group_id, approval_level) VALUES (NULL, 'demo.seed', 'ผู้ใส่ข้อมูลทดลอง', $1, $2, 9)`, [hash, admin.user_group_id]);
  writeFileSync(FILE, `ผู้ใช้ชั่วคราวสำหรับใส่ข้อมูลทดลอง (ปิดหลังใส่ข้อมูลเสร็จ)\nรหัสผู้ใช้: demo.seed\nรหัสผ่าน: ${pass}\n`, 'utf8');
  console.log('เปิดผู้ใช้ demo.seed แล้ว (รหัสผ่านอยู่ในแฟ้มใน .data)');
} else if (cmd === 'off') {
  await c.query(`UPDATE sys_user SET status = 'I' WHERE username = 'demo.seed'`);
  await c.query(`UPDATE sys_session SET ended_at = now() WHERE ended_at IS NULL AND user_id = (SELECT id FROM sys_user WHERE username = 'demo.seed')`);
  console.log('ปิดผู้ใช้ demo.seed แล้ว');
} else console.log('คำสั่ง: on | off');
await c.end();
