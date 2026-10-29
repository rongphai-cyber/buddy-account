/**
 * คำสั่งผู้ดูแล:  pnpm --filter @buddy/server cli <คำสั่ง>
 *   migrate                              รัน migration
 *   create-admin <user> <ชื่อ> <รหัสผ่าน>  สร้างผู้ดูแลระบบ (ถ้ายังไม่มีกลุ่ม ADMIN จะสร้างให้)
 *   company-template <company_id>        ใส่กฎการลงบัญชี + เส้นทางสมุดรายวันให้บริษัท (หลังย้ายข้อมูลจาก Express)
 *   import-express <โฟลเดอร์> <รหัส>       ย้ายข้อมูลจาก Express (.DBF) เป็นบริษัทใหม่ + กฎการลงบัญชี + กระทบยอด (เหมือนหน้าจอ อื่น ๆ › นำข้อมูลจาก Express)
 *   unlock <user>                         ปลดล็อกผู้ใช้ที่ใส่รหัสผิดเกิน 5 ครั้ง
 *   reset-2fa <user>                      ล้างยืนยันตัวตนสองขั้น (ผู้ดูแลทำมือถือหายและไม่มีรหัสสำรอง) — เข้าระบบแล้วตั้งใหม่
 *   posting-compare <รหัสบริษัท>          เทียบเครื่องลงบัญชีกับใบสำคัญที่ Express ลงไว้ (เกณฑ์ P3 ≥ 97%)
 */
import { mkdirSync } from 'node:fs';
import bcrypt from 'bcryptjs';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { migrate } from './migrate.js';
import { applyPostingTemplate } from './company-template.js';
import { comparePosting } from './modules/posting.js';
import { passwordProblem } from '@buddy/core';
import { logActivity } from './audit.js';

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
    const bad = passwordProblem(password, username);
    if (bad) throw new Error(bad);
    const hash = await bcrypt.hash(password, 10);
    const ex = await db.selectFrom('sys_user').select('id').where('username', '=', username).where('deleted_at', 'is', null).executeTakeFirst();
    if (ex) await db.updateTable('sys_user').set({ password_hash: hash, user_group_id: g.id, status: 'A', tenant_id: null }).where('id', '=', ex.id).execute();
    else await db.insertInto('sys_user').values({ username, display_name: name, password_hash: hash, user_group_id: g.id, approval_level: 9 }).execute();
    console.log(`สร้างผู้ดูแลระบบ ${username} แล้ว`);
  } else if (cmd === 'unlock' || cmd === 'reset-2fa') {
    const [username] = args;
    const u = username ? await db.selectFrom('sys_user').select('id').where('username', '=', username).where('deleted_at', 'is', null).executeTakeFirst() : undefined;
    if (!u) throw new Error(`ใช้: ${cmd} <user> (ไม่พบผู้ใช้ ${username ?? ''})`);
    const patch = cmd === 'unlock' ? { failed_logins: 0, locked_until: null } : { totp_secret_enc: null, totp_enabled: false, totp_enabled_at: null, totp_last_step: null, totp_recovery: null, failed_logins: 0, locked_until: null };
    await db.updateTable('sys_user_security').set(patch).where('user_id', '=', u.id).execute();
    await logActivity(db, { companyId: null, userId: null }, { module: 'SYS', action: cmd === 'unlock' ? 'USER_UNLOCK' : 'USER_RESET_2FA', detail: { user_id: u.id, username, via: 'cli' } });
    console.log(cmd === 'unlock' ? `ปลดล็อก ${username} แล้ว` : `ล้างยืนยันตัวตนสองขั้นของ ${username} แล้ว — เข้าระบบแล้วตั้งค่าใหม่`);
  } else if (cmd === 'company-template') {
    const [id] = args;
    if (!id) throw new Error('ใช้: company-template <company_id>');
    await applyPostingTemplate(database.execScript, id);
    console.log('ใส่กฎการลงบัญชีแล้ว');
  } else if (cmd === 'import-express') {
    // ย้ายข้อมูลจากโฟลเดอร์ Express (.DBF) — พอร์ตของ tools/express-import/import.sh: นำเข้า → กฎการลงบัญชี → กระทบยอด
    const [folder, code] = args;
    if (!folder || !code) throw new Error('ใช้: import-express <โฟลเดอร์ข้อมูล Express> <รหัสบริษัท>');
    const { importExpress, validateExpress, folderSource, pythonSummary } = await import('./import/express/migrate.js');
    const src = folderSource(folder);
    const t0 = Date.now();
    const rep = await importExpress(db, src, { code, tenantId: null, onProgress: (s, p) => console.error(`[${String(p).padStart(3)}%] ${s}`) });
    console.error(`นำเข้าเสร็จใน ${((Date.now() - t0) / 1000).toFixed(1)} วินาที — บริษัท ${rep.company_id}`);
    console.log(JSON.stringify(pythonSummary(rep), null, 1));
    if (process.env.BUDDY_IMPORT_SKIP_TEMPLATE !== '1') {
      await applyPostingTemplate(database.execScript, rep.company_id);
      console.error('ใส่กฎการลงบัญชีแล้ว');
      console.log(JSON.stringify(await validateExpress(db, src, rep.company_id), null, 1));
    }
  } else if (cmd === 'posting-compare') {
    const [code] = args;
    const c = await db.selectFrom('sys_company').select('id').where('code', '=', code ?? '').where('deleted_at', 'is', null).executeTakeFirst();
    if (!c) throw new Error('ใช้: posting-compare <รหัสบริษัท>');
    const r = await comparePosting(db, c.id);
    let n = 0, ok = 0, same = 0;
    console.log('หมวด   ใบสำคัญ   ตรงทุกบัญชี        ยอดรวมตรงแต่บัญชีต่าง');
    for (const x of r.byClass) { n += x.n; ok += x.exact; same += x.sameTotal; console.log(`${x.doc_class.padEnd(5)} ${String(x.n).padStart(8)} ${String(x.exact).padStart(8)} (${(100 * x.exact / x.n).toFixed(1).padStart(5)}%) ${String(x.sameTotal).padStart(7)}   เช่น ${x.examples.join(' ')}`); }
    console.log(`รวม ${n} ตรง ${ok} (${(100 * ok / n).toFixed(1)}%) ยอดรวมตรง ${same}`);
    console.log('หาบัญชีได้จากชั้น:', JSON.stringify(r.layers));
  } else {
    console.log('คำสั่ง: migrate | create-admin <user> <ชื่อ> <รหัสผ่าน> | unlock <user> | reset-2fa <user> | company-template <company_id> | posting-compare <รหัสบริษัท>');
  }
} finally {
  await database.close();
}
