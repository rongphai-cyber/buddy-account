import bcrypt from 'bcryptjs';
import { sql, type Kysely } from 'kysely';
import { passwordProblem } from '@buddy/core';
import type { DB } from './db.js';
import { logActivity } from './audit.js';

/**
 * cli create-admin (tools/cloud/reset-admin.ps1 · ลืมรหัสผ่านผู้ดูแลระบบ): สร้างหรือตั้งรหัสผ่านใหม่ให้ผู้ดูแลระบบของผู้ให้บริการ (กลุ่ม ADMIN ไม่สังกัดลูกค้า)
 * HANDOFF 155: รหัสผู้ใช้ที่เป็นผู้ใช้ของลูกค้า (tenant_id ไม่ว่าง เช่น demo.admin) = ปฏิเสธ — เดิมย้ายผู้ใช้นั้นเป็นเจ้าหน้าที่ผู้ให้บริการ (เห็นทุกลูกค้า) = ยกระดับสิทธิ์โดยไม่ตั้งใจ
 * ได้เฉพาะ: ผู้ใช้เดิมที่เป็นเจ้าหน้าที่ผู้ให้บริการอยู่แล้ว (tenant_id ว่าง) หรือรหัสผู้ใช้ใหม่ · หาผู้ใช้แบบไม่สนตัวพิมพ์เล็ก/ใหญ่ (เหมือนหน้าเข้าระบบ)
 */
export async function createOrResetAdmin(db: Kysely<DB>, username: string, name: string, password: string): Promise<'created' | 'reset'> {
  const bad = passwordProblem(password, username);
  if (bad) throw new Error(bad);
  const ex = await db.selectFrom('sys_user').select(['id', 'username', 'tenant_id']).where(sql`lower(username)`, '=', username.toLowerCase()).where('deleted_at', 'is', null).executeTakeFirst();
  if (ex?.tenant_id) {
    throw new Error(`รหัสผู้ใช้ ${ex.username} เป็นผู้ใช้ของลูกค้า ไม่ใช่ผู้ดูแลระบบของผู้ให้บริการ — คำสั่งนี้ไม่เปลี่ยนให้ (กันการได้สิทธิ์เห็นทุกลูกค้า)\n`
      + '  • ลืมรหัสผ่านผู้ดูแลระบบของผู้ให้บริการ: ใส่รหัสผู้ใช้ของตัวเอง (ผู้ใช้คนแรกที่ตั้งตอนตั้งค่าครั้งแรก เช่น admin)\n'
      + `  • ผู้ใช้ของลูกค้าลืมรหัสผ่าน: เข้าระบบด้วยรหัสผู้ดูแลระบบของผู้ให้บริการ แล้วตั้งรหัสใหม่ให้ ${ex.username} ที่หน้า ผู้ใช้งานและสิทธิ์`);
  }
  let g = await db.selectFrom('sys_user_group').select('id').where('code', '=', 'ADMIN').where('tenant_id', 'is', null).where('deleted_at', 'is', null).executeTakeFirst();
  if (!g) g = await db.insertInto('sys_user_group').values({ code: 'ADMIN', name: 'ผู้ดูแลระบบ' }).returning('id').executeTakeFirstOrThrow();
  const hash = await bcrypt.hash(password, 10);
  if (ex) {
    await db.updateTable('sys_user').set({ password_hash: hash, user_group_id: g.id, status: 'A' }).where('id', '=', ex.id).where('tenant_id', 'is', null).execute();
    await logActivity(db, { companyId: null, userId: null }, { module: 'SYS', action: 'USER_RESET_PASSWORD', detail: { user_id: ex.id, username: ex.username, via: 'cli' } });
    return 'reset';
  }
  const u = await db.insertInto('sys_user').values({ username, display_name: name, password_hash: hash, user_group_id: g.id, approval_level: 9 }).returning('id').executeTakeFirstOrThrow();
  await logActivity(db, { companyId: null, userId: null }, { module: 'SYS', action: 'ADD_USER', detail: { user_id: u.id, username, via: 'cli', admin: true } });
  return 'created';
}
