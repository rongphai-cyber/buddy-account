import { sql, type Kysely } from 'kysely';
import type { DB } from './db.js';

/**
 * กลุ่มผู้ใช้ตั้งต้นของลูกค้า (HANDOFF 159 · เจ้าของ 20/11/2569 "ทำทั้ง 2 อย่าง") — แบบเดียวกับ ฝ่ายขาย/ฝ่ายบัญชี ของบริษัททดลอง (tools/demo-check/seed-year.mjs)
 * ผู้ดูแลของลูกค้าเลือกกลุ่มให้พนักงานได้ทันที ไม่ต้องตั้งสิทธิ์รายเมนูเองตั้งแต่ศูนย์ · แก้สิทธิ์ของกลุ่มต่อได้ที่ สิทธิ์รายเมนู
 * สิทธิ์ตามระดับอนุมัติยังใช้ซ้อน (เช่น ยกเลิก/ลบ ต้องระดับ 5 ขึ้นไป · เงินเดือน/ความปลอดภัยไม่ให้)
 */
type V = 'Y' | 'N' | 'S';
type Row = { menu: string; read?: V; add?: V; edit?: V; cancel?: V; delete?: V; print?: V; approve?: V };
const FULL = { read: 'Y', add: 'Y', edit: 'Y', cancel: 'Y', print: 'Y' } as const;
const SEE = { read: 'Y', print: 'Y' } as const;
export const STANDARD_GROUPS: Array<{ code: string; name: string; rows: Row[] }> = [
  { code: 'SALE', name: 'ฝ่ายขาย', rows: [
    { menu: 'SA', ...FULL }, { menu: 'FI.AR', ...FULL }, { menu: 'IC.STOCK', ...SEE }, { menu: 'IC.ITEM', read: 'Y' }, { menu: 'IC.SRV', read: 'Y' }, { menu: 'IC.KIT', read: 'Y' },
    { menu: 'IC.PRICE', read: 'Y' }, { menu: 'RP.SA', ...SEE }, { menu: 'RP.IC', ...SEE } ] },
  { code: 'PURCH', name: 'ฝ่ายจัดซื้อ', rows: [
    { menu: 'PU', ...FULL }, { menu: 'FI.AP', ...FULL }, { menu: 'IC', ...FULL }, { menu: 'RP.PU', ...SEE }, { menu: 'RP.IC', ...SEE } ] },
  { code: 'ACC', name: 'ฝ่ายบัญชี', rows: [
    { menu: 'GL', ...FULL, approve: 'Y' }, { menu: 'TX', ...FULL }, { menu: 'FI', ...FULL }, { menu: 'FI.BK', ...FULL }, { menu: 'RP', ...SEE },
    { menu: 'SA', ...SEE }, { menu: 'PU', ...SEE }, { menu: 'IC', ...SEE } ] },
  // แบบเดียวกับผู้ใช้ดูอย่างเดียวของผู้ให้บริการ (POST /tenants/:id/viewers): ทุกระบบงาน อ่าน Y · พิมพ์ออกจอ S · ที่เหลือ N
  { code: 'VIEW', name: 'ดูอย่างเดียว (อ่าน/พิมพ์ออกจอ)', rows: [{ menu: 'ALL', read: 'Y', print: 'S' }] },
];
const COLS = { read: 'can_read', add: 'can_add', edit: 'can_edit', cancel: 'can_cancel', delete: 'can_delete', print: 'can_print', approve: 'can_approve' } as const;

/**
 * กลุ่มตั้งต้นของลูกค้า (ไม่ซ้ำ ทำซ้ำได้):
 * - createGroups = สร้างกลุ่มที่ยังไม่มี (สร้างลูกค้าใหม่ · ปุ่ม "เพิ่มกลุ่มตั้งต้น" ของผู้ให้บริการ) · false = ใช้เฉพาะกลุ่มตั้งต้นที่ลูกค้ามีอยู่ (เพิ่มบริษัทใหม่)
 * - ใส่สิทธิ์ให้เฉพาะบริษัทที่กลุ่มนั้นยังไม่มีแถวสิทธิ์เลย — สิทธิ์ที่ลูกค้าแก้เองไม่ถูกเขียนทับ
 */
export async function ensureStandardGroups(tx: Kysely<DB>, tenantId: string, actor: string | null, opts: { createGroups: boolean; companyIds?: string[] }) {
  const menus = new Map((await tx.selectFrom('sys_menu').select(['id', 'code']).where('deleted_at', 'is', null).execute()).map((m) => [m.code, m.id]));
  let companies = (await tx.selectFrom('sys_company').select('id').where('tenant_id', '=', tenantId).where('deleted_at', 'is', null).execute()).map((c) => c.id);
  if (opts.companyIds) companies = companies.filter((c) => opts.companyIds!.includes(c));
  const created: string[] = [];
  let rows = 0;
  for (const g of STANDARD_GROUPS) {
    let grp = await tx.selectFrom('sys_user_group').select('id').where('tenant_id', '=', tenantId).where('code', '=', g.code).where('deleted_at', 'is', null).executeTakeFirst();
    if (!grp) {
      if (!opts.createGroups) continue;
      grp = await tx.insertInto('sys_user_group').values({ tenant_id: tenantId, code: g.code, name: g.name, created_by: actor }).returning('id').executeTakeFirstOrThrow();
      created.push(g.code);
    }
    for (const companyId of companies) {
      const has = await tx.selectFrom('sys_permission').select('id').where('company_id', '=', companyId).where('subject_type', '=', 'G').where('subject_id', '=', grp.id).where('deleted_at', 'is', null).executeTakeFirst();
      if (has) continue;
      const values = g.rows.filter((r) => menus.has(r.menu)).map((r) => ({
        company_id: companyId, subject_type: 'G', subject_id: grp!.id, menu_id: menus.get(r.menu)!, created_by: actor,
        ...Object.fromEntries(Object.entries(COLS).map(([k, col]) => [col, r[k as keyof typeof COLS] ?? 'N'])),
      }));
      if (values.length) { await tx.insertInto('sys_permission').values(values as never).execute(); rows += values.length; }
    }
  }
  return { created, rows, companies: companies.length };
}

/** บริษัทที่ผู้ใช้/กลุ่มแต่ละรายมีแถวสิทธิ์ (หน้าผู้ใช้งาน: เตือนเมื่อ "ตรวจสอบสิทธิ์ก่อนใช้งาน" แต่ไม่มีสิทธิ์ในบริษัทที่เลือก) */
export async function permissionCompanies(db: Kysely<DB>, subjectIds: string[]) {
  if (!subjectIds.length) return new Map<string, string[]>();
  const r = await sql<{ subject_id: string; companies: string[] }>`SELECT subject_id, array_agg(DISTINCT company_id::text) AS companies FROM sys_permission
     WHERE deleted_at IS NULL AND subject_id = ANY(${subjectIds}::uuid[]) GROUP BY subject_id`.execute(db);
  return new Map(r.rows.map((x) => [x.subject_id, x.companies]));
}
