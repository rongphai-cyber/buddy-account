import { sql, type Kysely } from 'kysely';
import type { DB } from './db.js';

/**
 * กลุ่มผู้ใช้ตั้งต้นของลูกค้า (HANDOFF 159 · เจ้าของ 20/11/2569 "ทำทั้ง 2 อย่าง") — แบบเดียวกับ ฝ่ายขาย/ฝ่ายบัญชี ของบริษัททดลอง (tools/demo-check/seed-year.mjs)
 * HANDOFF 197 (เจ้าของ 26/11/2569 "ตั้งค่ากลุ่มต่างๆตามลักษณ์งาน … Admin ฝ่ายขาย ฝ่ายบัญชี ฝ่ายจัดชื้อ ฝ่ายการเงิน ฝ่ายธุรการ ฝ่ายบุคคล"): เพิ่ม FIN GA HR
 * ผู้ดูแลของลูกค้าเลือกกลุ่มให้พนักงานได้ทันที ไม่ต้องตั้งสิทธิ์รายเมนูเองตั้งแต่ศูนย์ · แก้สิทธิ์ของกลุ่มต่อได้ที่ สิทธิ์รายเมนู · ช่องที่ไม่ระบุ = ว่าง (ไม่ได้รับ)
 * สิทธิ์ตามระดับอนุมัติยังใช้ซ้อน: ยกเลิก/ลบ/รับรอง ต้องระดับ 5 ขึ้นไป · เงินเดือนทุกเมนู (รวมอ่าน) ต้องระดับ 5 ขึ้นไป · ระบบความปลอดภัยต้องระดับ 9
 */
type V = 'Y' | 'N' | 'S';
type Row = { menu: string; read?: V; add?: V; edit?: V; cancel?: V; delete?: V; print?: V; approve?: V };
const FULL = { read: 'Y', add: 'Y', edit: 'Y', cancel: 'Y', print: 'Y' } as const;
const SEE = { read: 'Y', print: 'Y' } as const;
/** ค่าตั้งของระบบที่ฝ่ายบัญชีดูได้ (HANDOFF 198) — แก้ต้องระดับอนุมัติ 5 ขึ้นไปตามสิทธิ์พื้นฐาน */
const ACC_SETTINGS = ['SET.CO', 'SET.DEF', 'SET.DOCNO', 'SET.PRD', 'SET.LINK', 'SET.PAYM', 'SET.TBL', 'SET.IAG', 'SET.FAG', 'SET.DEPT', 'SET.BRANCH'];
export const STANDARD_GROUPS: Array<{ code: string; name: string; rows: Row[] }> = [
  // ฝ่ายขาย: เอกสารขาย ลูกค้า พนักงานขาย · ใบวางบิล · ดูลูกหนี้ สินค้าคงเหลือ ราคา · รายงานขาย/สินค้า
  { code: 'SALE', name: 'ฝ่ายขาย', rows: [
    { menu: 'SA', ...FULL }, { menu: 'FI.AR', ...FULL }, { menu: 'IC.STOCK', ...SEE }, { menu: 'IC.ITEM', read: 'Y' }, { menu: 'IC.SRV', read: 'Y' }, { menu: 'IC.KIT', read: 'Y' },
    { menu: 'IC.PRICE', read: 'Y' }, { menu: 'RP.SA', ...SEE }, { menu: 'RP.IC', ...SEE }, { menu: 'RP.CENTER', ...SEE } ] },
  // ฝ่ายจัดซื้อ: เอกสารซื้อ ผู้จำหน่าย ค่าใช้จ่าย · เจ้าหนี้ · สินค้าทั้งระบบ · รายงานซื้อ/สินค้า
  { code: 'PURCH', name: 'ฝ่ายจัดซื้อ', rows: [
    { menu: 'PU', ...FULL }, { menu: 'FI.AP', ...FULL }, { menu: 'IC', ...FULL }, { menu: 'RP.PU', ...SEE }, { menu: 'RP.IC', ...SEE }, { menu: 'RP.CENTER', ...SEE } ] },
  // ฝ่ายบัญชี: บัญชีแยกประเภท (รวมรับรองเอกสาร) ภาษี การเงิน ธนาคาร · ดูขาย/ซื้อ/สินค้า · ทุกรายงาน
  { code: 'ACC', name: 'ฝ่ายบัญชี', rows: [
    { menu: 'GL', ...FULL, approve: 'Y' }, { menu: 'TX', ...FULL }, { menu: 'FI', ...FULL }, { menu: 'FI.BK', ...FULL }, { menu: 'RP', ...SEE },
    { menu: 'SA', ...SEE }, { menu: 'PU', ...SEE }, { menu: 'IC', ...SEE },
    // HANDOFF 198 (ตรวจทาน 197): ปิดงวด ประมวลผลสิ้นปี ตรวจสอบข้อมูล · ดูค่าตั้งของระบบ (ค่าเริ่มต้น เลขที่เอกสาร รอบบัญชี การเชื่อมต่อบัญชี …) — แก้ค่าตั้งต้องระดับ 5
    { menu: 'OT.LOCK', ...FULL }, { menu: 'OT.YE', ...FULL }, { menu: 'OT.CHECK', ...SEE },
    ...ACC_SETTINGS.map((menu) => ({ menu, ...SEE })) ] },
  // ฝ่ายการเงิน (ใหม่ 197): รับ/จ่ายชำระ ลูกหนี้/เจ้าหนี้ เงินสดย่อย ธนาคาร เช็ค ภาษีหัก ณ ที่จ่าย · ดูภาษีซื้อ/ขาย ขาย ซื้อ · รายงานการเงิน
  { code: 'FIN', name: 'ฝ่ายการเงิน', rows: [
    { menu: 'FI', ...FULL }, { menu: 'FI.BK', ...FULL }, { menu: 'TX.WHT', ...FULL }, { menu: 'FI.VAT', ...SEE }, { menu: 'SA', ...SEE }, { menu: 'PU', ...SEE },
    { menu: 'RP.DASH', read: 'Y' }, { menu: 'RP.SA', ...SEE }, { menu: 'RP.PU', ...SEE }, { menu: 'RP.CHQ', ...SEE },
    // HANDOFF 198: สมุดเงินฝากเปิดใบสำคัญ (ดู) · ดูสินค้าคงเหลือ
    { menu: 'GL.JNL', ...SEE }, { menu: 'IC.STOCK', ...SEE } ] },
  // ฝ่ายธุรการ (ใหม่ 197): ข้อมูลหลัก (ลูกค้า ผู้จำหน่าย สินค้า บริการ ชุดสินค้า พนักงานขาย) · ดู/พิมพ์ใบเสนอราคา ใบสั่งขาย/ซื้อ และเอกสารขาย/ซื้อ — ไม่ลงเงิน
  { code: 'GA', name: 'ฝ่ายธุรการ', rows: [
    { menu: 'SA', ...SEE }, { menu: 'PU', ...SEE }, { menu: 'SA.CUS', read: 'Y', add: 'Y', edit: 'Y', print: 'Y' }, { menu: 'PU.SUP', read: 'Y', add: 'Y', edit: 'Y', print: 'Y' },
    { menu: 'SA.SLM', read: 'Y', add: 'Y', edit: 'Y', print: 'Y' }, { menu: 'IC.ITEM', read: 'Y', add: 'Y', edit: 'Y', print: 'Y' }, { menu: 'IC.SRV', read: 'Y', add: 'Y', edit: 'Y', print: 'Y' },
    { menu: 'IC.KIT', read: 'Y', add: 'Y', edit: 'Y', print: 'Y' }, { menu: 'IC.STOCK', ...SEE },
    // HANDOFF 198: หน้าสินค้าที่ฝ่ายธุรการแก้ได้ อ่านตารางราคาขาย (ไม่งั้น 403) · ศูนย์รายงาน
    { menu: 'IC.PRICE', read: 'Y' }, { menu: 'RP.CENTER', ...SEE } ] },
  // ฝ่ายบุคคล (ใหม่ 197): ระบบเงินเดือนทั้งหมด — ต้องระดับอนุมัติ 5 ขึ้นไปจึงเปิดได้ (ข้อมูลลับ) · ตั้งค่ารายการ/อัตรา = เมนูกำหนดค่า
  { code: 'HR', name: 'ฝ่ายบุคคล', rows: [{ menu: 'PAY', ...FULL }, { menu: 'RP.CENTER', ...SEE }] },
  // แบบเดียวกับผู้ใช้ดูอย่างเดียวของผู้ให้บริการ (POST /tenants/:id/viewers): ทุกระบบงาน อ่าน Y · พิมพ์ออกจอ S · ที่เหลือ N
  { code: 'VIEW', name: 'ดูอย่างเดียว (อ่าน/พิมพ์ออกจอ)', rows: [{ menu: 'ALL', read: 'Y', add: 'N', edit: 'N', cancel: 'N', delete: 'N', print: 'S', approve: 'N' }] },
];
const COLS = { read: 'can_read', add: 'can_add', edit: 'can_edit', cancel: 'can_cancel', delete: 'can_delete', print: 'can_print', approve: 'can_approve' } as const;

/**
 * กลุ่มตั้งต้นของลูกค้า (ไม่ซ้ำ ทำซ้ำได้):
 * - createGroups = สร้างกลุ่มที่ยังไม่มี (สร้างลูกค้าใหม่ · ปุ่ม "เพิ่มกลุ่มตั้งต้น" ของผู้ให้บริการ) · false = ใช้เฉพาะกลุ่มตั้งต้นที่ลูกค้ามีอยู่ (เพิ่มบริษัทใหม่)
 * - ใส่สิทธิ์ให้เฉพาะบริษัทที่กลุ่มนั้นยังไม่มีแถวสิทธิ์เลย — สิทธิ์ที่ลูกค้าแก้เองไม่ถูกเขียนทับ (กลุ่มที่ลูกค้าตั้งรหัสเดียวกันไว้เองก็ไม่แตะ ถ้ามีแถวแล้ว)
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
        ...Object.fromEntries(Object.entries(COLS).map(([k, col]) => [col, r[k as keyof typeof COLS] ?? null])),
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
