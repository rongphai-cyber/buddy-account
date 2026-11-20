import { sql, type Kysely } from 'kysely';
import { STARTER_TABLES, starterData, type StarterKey } from '@buddy/core';
import type { DB } from './db.js';
import { setSetting } from './company-template.js';

/**
 * ใส่ข้อมูลตั้งต้นตามประเภทธุรกิจ (HANDOFF 160 · packages/core/src/starter-data.ts) — ทำซ้ำได้:
 * ใส่เฉพาะรหัสที่ยังไม่มี (รวมที่ลบไปแล้วก็ใส่ใหม่ได้ · ไม่แก้แถวเดิม) · ค่าเริ่มต้นแต่ละระบบ ใส่เฉพาะที่บริษัทยังไม่ได้ตั้ง
 * dryRun = ดูก่อน (ไม่บันทึก) · บัญชีอ้างด้วยเลขที่บัญชีในผังของบริษัท (ไม่มี = ว่าง → ลงบัญชีตามบัญชีมาตรฐานของบริษัท)
 */
export type StarterReport = { template: StarterKey; tables: Array<{ key: string; label: string; add: string[]; skip: number }>; added: number };
export async function applyStarter(db: Kysely<DB>, companyId: string, key: StarterKey, actor: string | null, dryRun = false): Promise<StarterReport> {
  const t = starterData(key);
  const out: StarterReport = { template: key, tables: [], added: 0 };
  if (!t) return out;
  const acc = new Map((await db.selectFrom('gl_account').select(['id', 'account_no']).where('company_id', '=', companyId).where('deleted_at', 'is', null).execute()).map((a) => [a.account_no, a.id]));
  const A = (no?: string) => (no ? acc.get(no) ?? null : null);
  const report = (k: string, add: string[], skip: number) => { out.tables.push({ key: k, label: STARTER_TABLES.find((x) => x[0] === k)?.[1] ?? k, add, skip }); out.added += add.length; };
  const have = async (table: 'md_unit' | 'md_warehouse' | 'md_bank' | 'md_department' | 'md_item_account_group' | 'md_asset_account_group') =>
    new Set((await db.selectFrom(table).select('code').where('company_id', '=', companyId).where('deleted_at', 'is', null).execute()).map((r) => r.code.toUpperCase()));
  const simple = async (k: string, table: 'md_unit' | 'md_warehouse' | 'md_bank' | 'md_department' | 'md_item_account_group' | 'md_asset_account_group',
    rows: Array<{ code: string; th: string }>, values: (r: never) => Record<string, unknown>) => {
    const h = await have(table);
    const add = rows.filter((r) => !h.has(r.code.toUpperCase()));
    if (!dryRun && add.length) await db.insertInto(table).values(add.map((r) => ({ company_id: companyId, code: r.code, name_th: r.th, created_by: actor, ...values(r as never) })) as never).execute();
    report(k, add.map((r) => `${r.code} ${r.th}`), rows.length - add.length);
  };
  await simple('units', 'md_unit', t.units, (r: { en: string; rate?: number }) => ({ name_en: r.en, rate: r.rate != null ? String(r.rate) : null, status: 'A' }));
  await simple('warehouses', 'md_warehouse', t.warehouses, (r: { en: string }) => ({ name_en: r.en, status: 'A' }));
  await simple('banks', 'md_bank', t.banks, (r: { en: string }) => ({ name_en: r.en, status: 'A' }));
  await simple('departments', 'md_department', t.departments, (r: { en: string }) => ({ name_en: r.en, status: 'A' }));
  // ตารางข้อมูลอื่น (md_lookup แยกตามรหัสตาราง)
  {
    const h = new Set((await db.selectFrom('md_lookup').select(['type_code', 'code']).where('company_id', '=', companyId).where('deleted_at', 'is', null).execute()).map((r) => `${r.type_code}|${r.code.toUpperCase()}`));
    const add = t.lookups.flatMap((g) => g.rows.filter((r) => !h.has(`${g.type}|${r.code.toUpperCase()}`)).map((r) => ({ type: g.type, ...r })));
    if (!dryRun && add.length) await db.insertInto('md_lookup').values(add.map((r) => ({ company_id: companyId, type_code: r.type, code: r.code, name_th: r.th, name_en: r.en, status: 'A', created_by: actor }))).execute();
    report('lookups', add.map((r) => `${r.type}·${r.code} ${r.th}`), t.lookups.reduce((s, g) => s + g.rows.length, 0) - add.length);
  }
  await simple('itemGroups', 'md_item_account_group', t.itemGroups, (r: (typeof t.itemGroups)[number]) => ({
    name_en: r.en, cost_method: r.cost ?? null, item_specific: r.item_specific ?? false, inventory_account_id: A(r.inventory), cogs_account_id: A(r.cogs), sales_account_id: A(r.sales),
    sales_return_account_id: A(r.sales_return), purchase_account_id: A(r.purchase), purchase_return_account_id: A(r.purchase_return) }));
  await simple('assetGroups', 'md_asset_account_group', t.assetGroups, (r: (typeof t.assetGroups)[number]) => ({
    name_en: r.en, asset_account_id: A(r.asset), depr_expense_account_id: A(r.expense), accum_depr_account_id: A(r.accum) }));
  // วิธีรับ/จ่ายชำระ (รหัสไม่ซ้ำต่อทิศทาง)
  {
    const h = new Set((await db.selectFrom('md_payment_method').select(['direction', 'code']).where('company_id', '=', companyId).where('deleted_at', 'is', null).execute()).map((r) => `${r.direction}|${r.code.toUpperCase()}`));
    const add = t.paymentMethods.filter((r) => !h.has(`${r.direction}|${r.code.toUpperCase()}`));
    if (!dryRun && add.length) await db.insertInto('md_payment_method').values(add.map((r) => ({ company_id: companyId, direction: r.direction, code: r.code, seq: r.seq, name_th: r.th, name_en: r.en,
      kind: r.kind, gl_account_id: A(r.account), creates_cheque: !!r.cheque, status: 'A', created_by: actor }))).execute();
    report('paymentMethods', add.map((r) => `${r.direction === 'R' ? 'รับ' : 'จ่าย'} ${r.code} ${r.th}`), t.paymentMethods.length - add.length);
  }
  // ค่าเริ่มต้นแต่ละระบบ: เฉพาะคีย์ที่บริษัทยังไม่ได้ตั้งเอง
  {
    const set = new Set((await db.selectFrom('sys_setting').select('key').where('company_id', '=', companyId).where('branch_id', 'is', null).where('deleted_at', 'is', null).execute()).map((r) => r.key));
    const add = Object.entries(t.settings).filter(([k]) => !set.has(k));
    if (!dryRun) for (const [k, v] of add) await setSetting(db, companyId, k, v, actor ?? undefined);
    report('settings', add.map(([k, v]) => `${k} = ${String(v)}`), Object.keys(t.settings).length - add.length);
  }
  return out;
}

/** ประเภทธุรกิจที่บริษัทเลือกไว้ล่าสุด (จากบันทึกการทำงาน) — หน้ารายละเอียดกิจการเลือกไว้ให้ */
export async function lastStarter(db: Kysely<DB>, companyId: string): Promise<StarterKey | null> {
  const r = (await sql<{ t: string | null }>`SELECT detail->>'template' AS t FROM sys_activity_log WHERE company_id = ${companyId} AND action = 'STARTER_DATA' ORDER BY occurred_at DESC LIMIT 1`.execute(db)).rows[0];
  return (r?.t as StarterKey | undefined) ?? null;
}
