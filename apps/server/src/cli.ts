/**
 * คำสั่งผู้ดูแล:  pnpm --filter @buddy/server cli <คำสั่ง>
 *   migrate                              รัน migration
 *   create-admin <user> <ชื่อ> <รหัสผ่าน>  สร้างผู้ดูแลระบบ (ถ้ายังไม่มีกลุ่ม ADMIN จะสร้างให้)
 *   company-template <company_id>        ใส่กฎการลงบัญชี + เส้นทางสมุดรายวันให้บริษัท (หลังย้ายข้อมูลจาก Express)
 */
import { mkdirSync } from 'node:fs';
import bcrypt from 'bcryptjs';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { migrate } from './migrate.js';
import { applyPostingTemplate } from './company-template.js';

const [cmd, ...args] = process.argv.slice(2);
const cfg = loadConfig();
if (cfg.dataDir) mkdirSync(cfg.dataDir, { recursive: true });
const database = await openDatabase(cfg);
const { db } = database;
try {
  await migrate(database, cfg.migrationsDir);
  if (cmd === 'migrate') { /* done */ }
  else if (cmd === 'create-admin') {
    const [username, name, password] = args;
    if (!username || !name || !password) throw new Error('ใช้: create-admin <user> <ชื่อ> <รหัสผ่าน>');
    let g = await db.selectFrom('sys_user_group').select('id').where('code', '=', 'ADMIN').where('tenant_id', 'is', null).executeTakeFirst(); // ผู้ดูแลของผู้ให้บริการ (ไม่สังกัด tenant)
    if (!g) g = await db.insertInto('sys_user_group').values({ code: 'ADMIN', name: 'ผู้ดูแลระบบ' }).returning('id').executeTakeFirstOrThrow();
    const hash = await bcrypt.hash(password, 10);
    const ex = await db.selectFrom('sys_user').select('id').where('username', '=', username).where('deleted_at', 'is', null).executeTakeFirst();
    if (ex) await db.updateTable('sys_user').set({ password_hash: hash, user_group_id: g.id, status: 'A', tenant_id: null }).where('id', '=', ex.id).execute();
    else await db.insertInto('sys_user').values({ username, display_name: name, password_hash: hash, user_group_id: g.id, approval_level: 9 }).execute();
    console.log(`สร้างผู้ดูแลระบบ ${username} แล้ว`);
  } else if (cmd === 'company-template') {
    const [id] = args;
    if (!id) throw new Error('ใช้: company-template <company_id>');
    await applyPostingTemplate(database.execScript, id);
    console.log('ใส่กฎการลงบัญชีแล้ว');
  } else {
    console.log('คำสั่ง: migrate | create-admin <user> <ชื่อ> <รหัสผ่าน> | company-template <company_id>');
  }
} finally {
  await database.close();
}
