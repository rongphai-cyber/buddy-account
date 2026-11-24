import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { addDays, d } from '@buddy/core';
import type { Db } from './db.js';
import { fileKey, fileStore, scopedStore } from './storage/index.js';
import { assetSchedule, fiscalYears, withProjectedYears, ASSET_COLS, type AssetRow } from './modules/fa.js';

/**
 * คัดลอกบริษัท (คู่มือบทที่ 4 S-CO-04/05/06/07 · HANDOFF 181 — เจ้าของ 24/11/2569 "คัดลอกบริษัท … เปิดแฟ้มข้อมูลใหม่ โดยเลือกลบรายการทั้งหมดยกเว้นรายการข้อมูลหลัก")
 * ไม่ลบข้อมูลของบริษัทเดิมเลย (CLAUDE.md ข้อ 6) — "เปิดแฟ้มข้อมูลใหม่" ของ Express = สร้างบริษัทใหม่ที่มีค่าตั้งระบบ + ข้อมูลหลักที่เลือก
 * - ค่าตั้งระบบ (COPY_SETUP) คัดลอกเสมอ รวมผังบัญชี (ค่าตั้ง ประเภทเอกสาร การเชื่อมต่อบัญชีอ้างผังบัญชี จึงเลือกไม่คัดลอกไม่ได้)
 * - ข้อมูลหลักเลือกเป็นกลุ่มแบบ Express (COPY_GROUPS) · ทรัพย์สินยกค่าเสื่อมสะสมถึงวันก่อนเริ่มปีบัญชีใหม่เป็นยอดยกมา
 * - ทั้งหมด (cloneCompanyFull) = ทุกตารางของบริษัท id ใหม่ทุกแถว แล้วตรวจจำนวนแถว/ใบสำคัญ/เดบิต/เครดิตเท่าบริษัทเดิม ไม่เท่า = ยกเลิกทั้งหมด
 * ทุกแถวได้ id ใหม่ · คอลัมน์ที่อ้างแถวที่คัดลอกถูกแปลงเป็น id ใหม่ · อ้างแถวที่ไม่ได้คัดลอก = ว่าง (ช่องบังคับ = ไม่คัดลอกแถวนั้น)
 */
export const COPY_SETUP = ['gl_account', 'gl_default_account', 'gl_journal_book', 'gl_template', 'gl_template_line', 'md_lookup', 'md_unit', 'md_warehouse', 'md_department', 'md_bank', 'md_project',
  'md_item_account_group', 'md_asset_account_group', 'md_doc_type', 'md_doc_type_account', 'md_payment_method', 'sys_setting', 'sys_print_form', 'sys_report_custom', 'gl_fs_report', 'gl_fs_line',
  'sys_company_image', 'sys_address_history'];
/** กลุ่มข้อมูลหลักที่เลือกได้ (เหมือนหน้าจอ "เปิดแฟ้มข้อมูลใหม่" ของ Express ch04 S-CO-07) */
export const COPY_GROUPS = {
  customers: ['md_customer', 'md_customer_ship_to', 'md_customer_branch'],
  suppliers: ['md_supplier', 'md_supplier_branch', 'md_supplier_bank'],
  salespersons: ['md_salesperson'],
  bank_accounts: ['md_bank_account'],
  items: ['md_item', 'md_item_bom', 'md_item_price_break', 'md_item_reorder', 'md_item_image'],
  serials: ['md_serial', 'md_serial_service'],
  assets: ['fa_asset'],
} as const;
export type CopyGroup = keyof typeof COPY_GROUPS;
export const COPY_GROUP_KEYS = Object.keys(COPY_GROUPS) as CopyGroup[];
/** ข้อมูลประกอบของแฟ้มหลักที่เลือก (ผู้ติดต่อ หมายเหตุ) — คัดลอกเฉพาะของแถวที่คัดลอกมา */
const TAIL = ['md_party_contact', 'md_note'];
/** ขอบเขตเดิมของ API สร้างบริษัท: setup = ค่าตั้ง + บัญชีเงินฝาก · all = + ลูกค้า ผู้จำหน่าย พนักงานขาย สินค้า */
export const LEGACY_SCOPE_GROUPS: Record<'setup' | 'all', CopyGroup[]> = { setup: ['bank_accounts'], all: ['customers', 'suppliers', 'salespersons', 'bank_accounts', 'items'] };
/** ช่องข้อมูลกิจการ (sys_company) ที่คัดลอกไปบริษัทใหม่ — เติมเฉพาะช่องที่บริษัทใหม่ยังว่าง */
const PROFILE_COLS = ['name_en', 'address_th', 'address_en', 'zip_code', 'addr_no', 'addr_moo', 'addr_village', 'addr_building', 'addr_room', 'addr_floor', 'addr_soi', 'addr_road', 'addr_geo_code',
  'phone', 'tax_id', 'trade_reg_no', 'social_security_no'];

type Row = Record<string, unknown>;
async function metaOf(tx: Db) {
  const has = new Set((await sql<{ t: string }>`SELECT table_name AS t FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'company_id'`.execute(tx)).rows.map((r) => r.t));
  const fks = (await sql<{ tbl: string; col: string; ref: string }>`SELECT kcu.table_name AS tbl, kcu.column_name AS col, ccu.table_name AS ref
      FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
      JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
     WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`.execute(tx)).rows;
  const notNull = new Set((await sql<{ k: string }>`SELECT table_name || '.' || column_name AS k FROM information_schema.columns WHERE table_schema = 'public' AND is_nullable = 'NO'`.execute(tx)).rows.map((r) => r.k));
  return { has, fks, notNull };
}

/** ช่องข้อมูลกิจการ: เติมช่องที่บริษัทใหม่ยังว่างจากบริษัทเดิม (ที่อยู่ เลขผู้เสียภาษี …) */
export async function copyProfile(tx: Db, fromId: string, toId: string) {
  await sql`UPDATE sys_company n SET ${sql.join(PROFILE_COLS.map((c) => sql`${sql.id(c)} = COALESCE(n.${sql.id(c)}, s.${sql.id(c)})`))}, year_system = s.year_system
      FROM sys_company s WHERE n.id = ${toId} AND s.id = ${fromId}`.execute(tx);
}

/**
 * ค่าเสื่อมสะสมของทรัพย์สิน ณ วันที่ asOf (คำนวณสดแบบรายงานทะเบียนทรัพย์สิน: ยกมา + งวดที่ลงแล้ว/คำนวณ ที่สิ้นงวดไม่เกินวันนั้น)
 * ทรัพย์สินที่ขาย/ตัดจำหน่ายก่อนวันเริ่มปีใหม่ = ไม่ยกไป
 */
export async function assetCarryForward(tx: Db, companyId: string, asOf: string) {
  const fys = withProjectedYears(await fiscalYears(tx, companyId), asOf);
  const assets = (await sql<AssetRow>`SELECT ${ASSET_COLS} FROM fa_asset a WHERE a.company_id = ${companyId} AND a.deleted_at IS NULL`.execute(tx)).rows;
  const posted = new Map<string, Map<string, string>>();
  for (const r of (await sql<{ asset_id: string; period_id: string; amount: string }>`SELECT asset_id, period_id, amount FROM fa_depreciation WHERE company_id = ${companyId} AND deleted_at IS NULL`.execute(tx)).rows) {
    if (!posted.has(r.asset_id)) posted.set(r.asset_id, new Map()); posted.get(r.asset_id)!.set(r.period_id, r.amount);
  }
  let until = fys.findIndex((y) => y.start <= asOf && asOf <= y.end); if (until < 0) until = fys.length - 1;
  const pend = new Map(fys.flatMap((y) => y.periods.map((x) => [x.id, x.end])));
  const out = new Map<string, { accum: string; skip: boolean }>();
  for (const x of assets) {
    if (x.sold_date && x.sold_date <= asOf) { out.set(x.id, { accum: '0', skip: true }); continue; }
    if (x.start_date > asOf) { out.set(x.id, { accum: d(x.accum_depr_bf).toFixed(2), skip: false }); continue; }
    let acc = d(x.accum_depr_bf);
    if (fys.length) {
      const s = assetSchedule(x, fys, posted.get(x.id) ?? new Map(), until);
      for (const y of s.years) for (const m of y.months) { const e = pend.get(m.period_id); if (e && e <= asOf) acc = acc.plus(m.amount); }
    }
    out.set(x.id, { accum: acc.toFixed(2), skip: false });
  }
  return out;
}

/**
 * ค่าตั้งระบบ + ข้อมูลหลักตามกลุ่มที่เลือก (เปิดแฟ้มข้อมูลใหม่ / คัดลอกจากบริษัทต้นแบบ) — ไม่มีรายการประจำวัน ยอดยกมา งบประมาณ สิทธิ์ผู้ใช้
 * newStart = วันเริ่มปีบัญชีของบริษัทใหม่ (ทรัพย์สินยกค่าเสื่อมสะสมถึงวันก่อนหน้า)
 */
export async function copyCompanyData(tx: Db, fromId: string, toId: string, userId: string, groups: readonly CopyGroup[], opt: { newStart?: string } = {}) {
  const { has, fks, notNull } = await metaOf(tx);
  const tables = [...COPY_SETUP, ...COPY_GROUP_KEYS.filter((g) => groups.includes(g)).flatMap((g) => COPY_GROUPS[g]), ...TAIL].filter((t) => has.has(t));
  const fa = groups.includes('assets') && opt.newStart ? await assetCarryForward(tx, fromId, addDays(opt.newStart, -1)) : null;
  const data = new Map<string, Row[]>();
  const map = new Map<string, string>();
  for (const t of tables) {
    const rows = (await sql<{ j: Row }>`SELECT to_jsonb(x) AS j FROM ${sql.table(t)} x WHERE x.company_id = ${fromId} AND x.deleted_at IS NULL`.execute(tx)).rows.map((r) => (typeof r.j === 'string' ? JSON.parse(r.j) : r.j) as Row);
    // ค่าตั้ง/ที่อยู่เฉพาะสาขาของบริษัทต้นแบบไม่คัดลอก (บริษัทใหม่มีสาขาของตัวเอง) · ทรัพย์สินที่ขายแล้วไม่ยกไป
    const keep = t === 'sys_setting' || t === 'sys_address_history' ? rows.filter((r) => !r.branch_id)
      : t === 'fa_asset' && fa ? rows.filter((r) => !fa.get(String(r.id))?.skip) : rows;
    for (const r of keep) map.set(String(r.id), randomUUID());
    data.set(t, keep);
  }
  const counts: Record<string, number> = {};
  for (const t of tables) {
    const refs = fks.filter((f) => f.tbl === t && !['company_id', 'created_by', 'updated_by', 'origin_device_id'].includes(f.col));
    const out: Row[] = [];
    for (const r of data.get(t)!) {
      const n: Row = { ...r, id: map.get(String(r.id)), company_id: toId, created_by: userId, updated_by: userId, origin_device_id: null, row_version: 1 };
      let skip = false;
      for (const f of refs) {
        const v = r[f.col];
        if (v === null || v === undefined) continue;
        const nv = map.get(String(v));
        if (nv) n[f.col] = nv;
        else if (notNull.has(`${t}.${f.col}`)) { skip = true; break; }
        else n[f.col] = null;
      }
      // หมายเหตุแฟ้มหลักอ้างสินค้า/ลูกค้า/ผู้จำหน่ายด้วย entity_id · ผู้ติดต่ออ้างคู่ค้าด้วย party_id (ไม่มี FK) — คัดลอกเฉพาะของแถวที่คัดลอกมา
      for (const k of t === 'md_note' ? ['entity_id'] : t === 'md_party_contact' ? ['party_id'] : []) {
        if (r[k] === undefined) continue;
        const nv = map.get(String(r[k])); if (!nv) skip = true; else n[k] = nv;
      }
      // ทรัพย์สิน: ค่าเสื่อมสะสมถึงวันก่อนเริ่มปีบัญชีใหม่ = ยอดยกมา (ค่าเสื่อมงวดก่อนหน้าอยู่ในยอดนี้แล้ว)
      if (t === 'fa_asset' && fa && opt.newStart) {
        const c = fa.get(String(r.id));
        if (c && r.start_date && String(r.start_date) < opt.newStart) { n.accum_depr_bf = c.accum; n.accum_bf_date = addDays(opt.newStart, -1); }
      }
      if (!skip) out.push(n);
    }
    for (let i = 0; i < out.length; i += 1000) await sql`INSERT INTO ${sql.table(t)} SELECT * FROM json_populate_recordset(NULL::${sql.table(t)}, ${JSON.stringify(out.slice(i, i + 1000))}::json)`.execute(tx);
    counts[t] = out.length;
  }
  await fixJsonIds(tx, toId, tables, map);
  await copyStoredFiles(tx, fromId, toId);
  return counts;
}

/** ช่อง json ที่เก็บ id ของแถวในบริษัท (เช่น รูปลายเซ็นในแบบฟอร์มพิมพ์) → id ใหม่ */
async function fixJsonIds(tx: Db, toId: string, tables: readonly string[], map: Map<string, string>) {
  if (!tables.length || !map.size) return;
  const cols = (await sql<{ t: string; c: string }>`SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = 'public' AND data_type IN ('json', 'jsonb') AND table_name IN (${sql.join([...tables])})`.execute(tx)).rows;
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  for (const { t, c } of cols) {
    const rows = (await sql<{ id: string; v: string }>`SELECT id, ${sql.id(c)}::text AS v FROM ${sql.table(t)} WHERE company_id = ${toId} AND ${sql.id(c)}::text ~* '[0-9a-f]{8}-[0-9a-f]{4}-'`.execute(tx)).rows;
    for (const r of rows) {
      if (!r.id) continue;
      const v2 = r.v.replace(UUID, (m) => map.get(m.toLowerCase()) ?? m);
      if (v2 !== r.v) await sql`UPDATE ${sql.table(t)} SET ${sql.id(c)} = ${v2} WHERE id = ${r.id} AND company_id = ${toId}`.execute(tx);
    }
  }
}

/** รูปในที่เก็บไฟล์ (R2) อยู่ใต้รหัสบริษัท — คัดลอกไฟล์ไปใต้บริษัทใหม่ แล้วชี้แถวไปไฟล์ใหม่ (เก็บในฐานข้อมูล = ไม่มีอะไรต้องทำ) */
async function copyStoredFiles(tx: Db, fromId: string, toId: string) {
  for (const t of ['sys_company_image', 'md_item_image']) {
    const rows = (await sql<{ id: string; storage_key: string; mime: string }>`SELECT id, storage_key, mime FROM ${sql.table(t)} WHERE company_id = ${toId} AND storage_key IS NOT NULL`.execute(tx)).rows;
    if (!rows.length) continue;
    const src = scopedStore(fileStore(), fromId), dst = scopedStore(fileStore(), toId);
    for (const r of rows) {
      const f = await src.get(r.storage_key);
      if (!f) { await sql`UPDATE ${sql.table(t)} SET storage_key = NULL WHERE id = ${r.id}`.execute(tx); continue; }
      const key = fileKey(toId, t === 'sys_company_image' ? 'image' : 'item', r.mime);
      await dst.put(key, f.body, r.mime);
      await sql`UPDATE ${sql.table(t)} SET storage_key = ${key} WHERE id = ${r.id}`.execute(tx);
    }
  }
}

/** ตารางของบริษัทที่ไม่คัดลอกเมื่อคัดลอกทั้งหมด: บันทึกเหตุการณ์ (ห้ามแก้) คิวซิงก์ การเข้าระบบ สิทธิ์ผู้ใช้ (ให้แบบสร้างบริษัทใหม่) เครื่องสาขา กุญแจ/ความลับ การใช้ AI คำขอ PDPA สถานะเชื่อมต่อระบบอื่น */
export const CLONE_SKIP = new Set(['sys_activity_log', 'sync_change_log', 'sync_inbox', 'sync_conflict', 'sys_session', 'sys_api_key', 'sys_secret', 'sys_company', 'sys_user_company', 'sys_permission',
  'sys_device', 'sys_ai_usage', 'sys_pdpa_request', 'sys_source_status']);
export async function cloneTables(tx: Db) {
  return (await sql<{ t: string }>`SELECT c.table_name AS t FROM information_schema.columns c JOIN information_schema.tables x ON x.table_name = c.table_name AND x.table_schema = c.table_schema
      WHERE c.table_schema = 'public' AND c.column_name = 'company_id' AND x.table_type = 'BASE TABLE' ORDER BY c.table_name`.execute(tx)).rows.map((r) => r.t).filter((t) => !CLONE_SKIP.has(t));
}

/**
 * คัดลอกทั้งหมด (HANDOFF 181 ข้อ 2a): ทุกแถวของทุกตารางของบริษัท (รวมที่ลบแบบ soft delete — เลขที่เอกสารและประวัติเหมือนเดิม) id ใหม่
 * แล้วตรวจในทรานแซกชันเดียวกัน: จำนวนแถวทุกตาราง + ใบสำคัญ/เดบิต/เครดิต เท่าบริษัทเดิม — ไม่เท่า = throw (ยกเลิกทั้งหมด)
 */
export async function cloneCompanyFull(tx: Db, fromId: string, toId: string) {
  const tables = await cloneTables(tx);
  // งวดที่ปิดแล้วของบริษัทเดิมคัดลอกได้ (ทริกเกอร์ตรวจงวดปิด · เฉพาะทรานแซกชันนี้)
  await sql`SELECT set_config('app.allow_locked_period', 'on', true)`.execute(tx);
  await sql`SET CONSTRAINTS ALL DEFERRED`.execute(tx);
  await sql`CREATE TEMP TABLE IF NOT EXISTS _clone_map (o uuid PRIMARY KEY, n uuid NOT NULL) ON COMMIT DROP`.execute(tx);
  await sql`DELETE FROM _clone_map`.execute(tx);
  await sql`INSERT INTO _clone_map VALUES (${fromId}::uuid, ${toId}::uuid)`.execute(tx);
  const cols = (await sql<{ t: string; c: string; ty: string }>`SELECT table_name AS t, column_name AS c, data_type AS ty FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name IN (${sql.join(tables)}) ORDER BY table_name, ordinal_position`.execute(tx)).rows;
  const colsOf = (t: string) => cols.filter((x) => x.t === t);
  for (const t of tables) if (colsOf(t).some((c) => c.c === 'id')) await sql`INSERT INTO _clone_map SELECT id, gen_random_uuid() FROM ${sql.table(t)} WHERE company_id = ${fromId}`.execute(tx);
  const q = (c: string) => `"${c.replace(/"/g, '""')}"`;
  const want: Record<string, number> = {};
  for (const t of tables) {
    const cs = colsOf(t);
    const sel = cs.map(({ c, ty }) => c === 'id' ? `(SELECT m.n FROM _clone_map m WHERE m.o = x.id)`
      : c === 'company_id' ? `'${toId}'::uuid`
      : c === 'origin_device_id' ? 'NULL'
      : ty === 'uuid' ? `CASE WHEN x.${q(c)} IS NULL THEN NULL ELSE COALESCE((SELECT m.n FROM _clone_map m WHERE m.o = x.${q(c)}), x.${q(c)}) END`
      : `x.${q(c)}`);
    await sql.raw(`INSERT INTO ${q(t)} (${cs.map((c) => q(c.c)).join(', ')}) SELECT ${sel.join(', ')} FROM ${q(t)} x WHERE x.company_id = '${fromId}'::uuid`).execute(tx);
    want[t] = (await sql<{ n: number }>`SELECT count(*)::int AS n FROM ${sql.table(t)} WHERE company_id = ${fromId}`.execute(tx)).rows[0]!.n;
  }
  const map = new Map((await sql<{ o: string; n: string }>`SELECT o::text AS o, n::text AS n FROM _clone_map`.execute(tx)).rows.map((r) => [r.o, r.n]));
  await fixJsonIds(tx, toId, tables, map);
  await copyStoredFiles(tx, fromId, toId);
  // ตรวจ: จำนวนแถวทุกตาราง + ใบสำคัญ/เดบิต/เครดิต
  const diff: string[] = [];
  for (const t of tables) {
    const n = (await sql<{ n: number }>`SELECT count(*)::int AS n FROM ${sql.table(t)} WHERE company_id = ${toId}`.execute(tx)).rows[0]!.n;
    if (n !== want[t]) diff.push(`${t} ${want[t]}→${n}`);
  }
  const tot = async (id: string) => (await sql<{ j: number; dr: string; cr: string }>`SELECT (SELECT count(*)::int FROM gl_journal WHERE company_id = ${id} AND deleted_at IS NULL) AS j,
      coalesce(sum(debit), 0)::text AS dr, coalesce(sum(credit), 0)::text AS cr FROM gl_journal_line WHERE company_id = ${id} AND deleted_at IS NULL`.execute(tx)).rows[0]!;
  const [a, b] = [await tot(fromId), await tot(toId)];
  const totalsOk = a.j === b.j && d(a.dr).eq(b.dr) && d(a.cr).eq(b.cr);
  return { tables: tables.length, rows: Object.values(want).reduce((s, n) => s + n, 0), diff, totals: { source: a, copy: b }, ok: !diff.length && totalsOk };
}
