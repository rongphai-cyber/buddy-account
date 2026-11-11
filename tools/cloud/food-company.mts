/**
 * บริษัทตัวอย่างร้านอาหาร WFOOD ใน Buddy (เจ้าของ 11/11/2569 · HANDOFF ข้อ 117) — ไม่ต้องรันเอง: เรียกจาก tools/cloud/food-demo.mjs
 *   สร้างแบบเดียวกับ "กำหนดบริษัทใหม่" (POST /api/v1/companies · chart=copy · copy_scope=setup จาก DEMO):
 *   ลูกค้าเดียวกับ DEMO · สำนักงานใหญ่ 00000 · ปีบัญชีเดียวกับ DEMO · ผังบัญชี/ประเภทเอกสาร/ค่าตั้ง/การเชื่อมบัญชีของ DEMO (ไม่คัดลอกลูกค้า/สินค้า)
 *   มีแล้ว = ไม่ทำอะไร · ผลเป็น JSON บรรทัดเดียว {"id","code","created"} (ไม่มีความลับ)
 */
import { sql } from 'kysely';
import { openDatabase } from '../../apps/server/src/db.ts';
import { copyCompanyData } from '../../apps/server/src/company-copy.ts';
import { applyPostingTemplate, createFiscalYear } from '../../apps/server/src/company-template.ts';
import { logActivity } from '../../apps/server/src/audit.ts';

const CODE = process.env.FOOD_CODE || 'WFOOD';
const NAME = process.env.FOOD_NAME || 'บริษัท ดับบลิวทีเอส ฟู้ด (ทดลอง) จำกัด';
const FROM = process.env.FOOD_FROM || 'DEMO';
const fail = (m: string): never => { console.error('✗ ' + m); process.exit(1); };
if (!process.env.DATABASE_URL) fail('ต้องมี DATABASE_URL');

const database = await openDatabase({ databaseUrl: process.env.DATABASE_URL });
const db = database.db;
try {
  const have = await db.selectFrom('sys_company').select(['id', 'code']).where('code', '=', CODE).where('deleted_at', 'is', null).executeTakeFirst();
  if (have) {
    console.log(JSON.stringify({ id: have.id, code: have.code, created: false }));
  } else {
    const src = await db.selectFrom('sys_company').select(['id', 'tenant_id']).where('code', '=', FROM).where('deleted_at', 'is', null).executeTakeFirst()
      ?? fail(`ไม่พบบริษัทต้นแบบ ${FROM} ใน Buddy`);
    const adm = (await sql<{ id: string }>`SELECT u.id FROM sys_user u JOIN sys_user_group g ON g.id = u.user_group_id
        WHERE g.code = 'ADMIN' AND u.status = 'A' AND u.deleted_at IS NULL AND u.tenant_id = ${src.tenant_id} AND g.tenant_id = ${src.tenant_id}
        ORDER BY u.created_at LIMIT 1`.execute(db)).rows[0] ?? fail(`ไม่พบผู้ดูแลของลูกค้าเดียวกับ ${FROM}`);
    // ปีบัญชีที่ครอบวันนี้ของบริษัทต้นแบบ (ไม่มี = ต้นปีปฏิทินนี้)
    const today = new Date().toISOString().slice(0, 10);
    const fy = await db.selectFrom('gl_fiscal_year').select(sql<string>`to_char(start_date, 'YYYY-MM-DD')`.as('start')).where('company_id', '=', src.id)
      .where('deleted_at', 'is', null).where('start_date', '<=', today as never).where('end_date', '>=', today as never).executeTakeFirst();
    const start = fy?.start ?? `${today.slice(0, 4)}-01-01`;
    const id = await db.transaction().execute(async (tx) => {
      const c = await tx.insertInto('sys_company').values({ tenant_id: src.tenant_id, code: CODE, name_th: NAME, created_by: adm.id }).returning('id').executeTakeFirstOrThrow();
      await tx.insertInto('sys_branch').values({ company_id: c.id, code: '00000', name: 'สำนักงานใหญ่', tax_branch_no: '00000', is_head_office: true, created_by: adm.id }).execute();
      await createFiscalYear(tx, c.id, start, adm.id);
      const copied = await copyCompanyData(tx, src.id, c.id, adm.id, false);
      if (!copied.gl_account) fail(`บริษัทต้นแบบ ${FROM} ไม่มีผังบัญชี`);
      await logActivity(tx, { companyId: c.id, userId: adm.id }, { module: 'SYS', action: 'NEW_COMPANY', table: 'sys_company', rowId: c.id,
        detail: { code: CODE, tenant_id: src.tenant_id, copied_from: src.id, copied, via: 'tools/cloud/food-demo.mjs' } });
      return c.id;
    });
    await applyPostingTemplate(database.execScript, id);
    console.log(JSON.stringify({ id, code: CODE, created: true }));
  }
} finally {
  await database.close();
}
