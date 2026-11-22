import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z, ZodObject, type ZodRawShape } from 'zod';
import { ASSET_DEPR_KEYS, formatDate, importHeaderText, importNeedLabel, ITEM_KINDS, mapMasterImport, masterImportKindOf, newCode,
  type ImportIssue, type MasterImportKind, type MasterRef, type MasterRow, type YearSystem } from '@buddy/core';
import type { Db } from '../db.js';
import { AppError, badRequest, forbidden, notFound, parse, requireCompany, type AuthContext } from '../http.js';
import { logActivity } from '../audit.js';
import { companySettings } from '../company-template.js';
import { ADDR_COLS } from '../address.js';
import { buildXlsx } from '../xlsx.js';
import { allowedFor } from './permissions.js';
import { readSheets } from './trade-import.js';
import { finder } from './import-fields.js';
import { masterSaverOf } from './master-registry.js';

/**
 * นำเข้าข้อมูลหลักจาก Excel (HANDOFF 173 — เจ้าของ 22/11/2569 "เพิ่มใหม่+แก้เมื่อติ๊ก")
 * รหัสใหม่ = เพิ่ม (ว่าง = ออกรหัสให้ตามรูปแบบ) · รหัสที่มีแล้ว = ข้าม · ติ๊ก "แก้ข้อมูลรหัสเดิมด้วย" = แก้เฉพาะช่องที่ใส่ (ว่าง = คงค่าเดิม · ไม่เปลี่ยนรหัส)
 * บันทึกด้วยฟังก์ชันเดียวกับหน้าจอ (ตรวจ ห้ามซ้ำ sys_activity_log ADD/EDIT) · ตรวจ = ลองบันทึกใน SAVEPOINT แล้วถอยกลับ · นำเข้า = ทั้งแฟ้มหรือไม่บันทึกเลย
 * บริษัทจาก session เท่านั้น · ทรัพย์สินที่คิดค่าเสื่อมลงบัญชีแล้ว: แก้ช่องที่ใช้คิดค่าเสื่อมทางนำเข้าไม่ได้ (ข้อ 7 — แก้ที่หน้าจอ)
 */
type Ctx = AuthContext & { companyId: string };
const MAX_FILE = 10 * 1024 * 1024;
const kindOf = (path: string) => { const K = masterImportKindOf(path); if (!K) throw notFound('แฟ้มข้อมูลหลัก'); return K; };
const importBody = z.object({
  file_name: z.string().trim().min(1).max(200), data: z.string().min(1, 'เลือกแฟ้ม').max(Math.ceil(MAX_FILE * 1.4) + 200, 'แฟ้มใหญ่เกิน 10 MB'),
  /** แก้ข้อมูลรหัสเดิมด้วย (ไม่ติ๊ก = ข้ามรหัสที่มีแล้ว) */
  update: z.boolean().default(false), commit: z.boolean().default(false),
});
type Action = 'add' | 'update' | 'skip';
type Result = { row: number; code: string; name: string | null; action: Action; changed: string[]; warnings: string[] };
const TABLE: Record<MasterImportKind['kind'], string> = { customer: 'md_customer', supplier: 'md_supplier', stock: 'md_item', service: 'md_item', asset: 'fa_asset' };
const NAME_KEY = (K: MasterImportKind) => (K.kind === 'customer' || K.kind === 'supplier' ? 'name' : 'name_th');

/** แบบฟอร์ม: แผ่นนำเข้า (หัวสีชมพู * = ต้องมีเมื่อเพิ่มใหม่) + แผ่นคำอธิบาย */
export function buildMasterTemplate(K: MasterImportKind, sample: { date: string }): Buffer {
  const cols = K.columns;
  const kinds = Object.fromEntries(cols.map((c, i) => [i, c.need === 'req' ? 'req' : c.need === 'cond' ? 'cond' : null] as const).filter((x) => x[1])) as Record<number, 'req' | 'cond'>;
  const ex = cols.map((c) => (c.format === 'date' && c.need === 'req' ? sample.date : c.example));
  const help: string[][] = [['คอลัมน์', 'จำเป็น', 'คำอธิบาย'], ...cols.map((c) => [c.th, importNeedLabel(c), c.hint]), ['', '', ''],
    ['', '', `หนึ่งแถว = ${K.label}หนึ่งรหัส · รหัสที่ยังไม่มี = เพิ่มใหม่ (ว่าง = ออกรหัสให้) · รหัสที่มีแล้ว = ข้าม — ติ๊ก "แก้ข้อมูลรหัสเดิมด้วย" ตอนนำเข้าเพื่อแก้`],
    ['', '', 'แก้ข้อมูล: แก้เฉพาะช่องที่ใส่ค่า · ช่องว่าง = คงค่าเดิม (ไม่ลบค่าเดิม) · เปลี่ยนรหัสไม่ได้ · แท็บย่อย (สาขา ผู้ติดต่อ สถานที่ส่ง บัญชีธนาคาร) คงเดิม แก้ที่หน้าจอ'],
    ['', '', 'หัวคอลัมน์สีชมพู มี * = ต้องมีเมื่อเพิ่มใหม่ · สีเหลือง = ต้องมีตามเงื่อนไข · อื่น ๆ เว้นว่างได้ (ค่าเริ่มต้นเดียวกับหน้าจอ) · แฟ้มต้องมีหัวคอลัมน์ตามแบบฟอร์มอย่างน้อย 3 คอลัมน์ (สลับลำดับได้ ไม่ต้องมีครบ)'],
    ['', '', 'ช่องรหัสอ้างอิง (บัญชี กลุ่มบัญชี หน่วย พนักงานขาย แผนก ผู้จำหน่าย) ใส่รหัสหรือชื่อที่มีในโปรแกรมแล้ว — ระบบไม่เพิ่มให้'],
    ...(K.kind === 'asset' ? [['', '', 'ทรัพย์สินที่คิดค่าเสื่อมลงบัญชีแล้ว: แก้ได้เฉพาะชื่อ หมวด หมายเลขเครื่อง แผนก — ช่องที่ใช้คิดค่าเสื่อม (กลุ่มบัญชี ราคาทุน วันที่ วิธี อายุ ฯลฯ) แก้ที่หน้าจอทรัพย์สิน']] : []),
    ['', '', 'เลือกแฟ้มแล้วระบบตรวจก่อน (ยังไม่บันทึก) แสดงแต่ละแถวว่า เพิ่ม / แก้ / ข้าม · กดนำเข้าแล้วบันทึกทุกแถวพร้อมกัน — ถ้าผิดแถวเดียวจะไม่บันทึกเลย'],
    ['', '', 'ลบแถวตัวอย่างก่อนใช้ · ชื่อหัวคอลัมน์ห้ามแก้ · บันทึกเป็น .xlsx (หรือ .csv)']];
  return buildXlsx([
    { name: 'นำเข้า', rows: [cols.map((c) => importHeaderText(c)), ex], headKinds: kinds, textCols: cols.map((c, i) => (c.format === 'number' || c.format === 'int' ? -1 : i)).filter((i) => i >= 0),
      numCols: cols.map((c, i) => (c.format === 'number' ? i : -1)).filter((i) => i >= 0), widths: cols.map((c) => (c.key.startsWith('address') || c.key === 'remark' || c.key.startsWith('name') ? 28 : 16)) },
    { name: 'คำอธิบาย', rows: help, widths: [26, 34, 110] },
  ]);
}

export function masterImportRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/v1/master-import/:path/template', async (req, reply) => {
    const a = requireCompany(req);
    const K = kindOf(parse(z.object({ path: z.string() }), req.params).path);
    const co = await db.selectFrom('sys_company').select('year_system').where('id', '=', a.companyId).executeTakeFirstOrThrow();
    reply.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('content-disposition', `attachment; filename="import-${K.path}.xlsx"`);
    return buildMasterTemplate(K, { date: formatDate(new Date().toISOString().slice(0, 10), co.year_system as YearSystem) });
  });

  app.post('/api/v1/master-import/:path', async (req) => {
    const a = requireCompany(req);
    const K = kindOf(parse(z.object({ path: z.string() }), req.params).path);
    const b = parse(importBody, req.body);
    if (!(await allowedFor(db, a, K.menu, 'add')).allowed) throw forbidden(`ไม่มีสิทธิ์เพิ่ม${K.label} — นำเข้าไม่ได้`);
    if (b.update && !(await allowedFor(db, a, K.menu, 'edit')).allowed) throw forbidden(`ไม่มีสิทธิ์แก้${K.label} — ไม่ติ๊ก "แก้ข้อมูลรหัสเดิมด้วย" หรือขอสิทธิ์แก้`);
    const saver = masterSaverOf(app, K.kind);
    if (!saver) throw notFound('แฟ้มข้อมูลหลัก');
    const co = await db.selectFrom('sys_company').select('year_system').where('id', '=', a.companyId).executeTakeFirstOrThrow();
    const sheets = readSheets(b.file_name, Buffer.from(b.data.replace(/^data:[^,]*,/, ''), 'base64'));
    const { rows, errors } = mapMasterImport(sheets[0]?.rows ?? [], co.year_system as YearSystem, K);
    const issues: ImportIssue[] = [...errors];
    const plan = await planRows(db, a, K, rows, b.update, saver.body as ZodObject<ZodRawShape>, issues);
    // ลองบันทึกทุกแถว (ตรวจ = ถอยกลับเสมอ · นำเข้า = เก็บเมื่อไม่มีข้อผิดพลาดเลย)
    const results: Result[] = [];
    let ran = false;
    if (!(b.commit && issues.length)) {
      ran = true;
      await sql`SAVEPOINT master_import_all`.execute(db);
      for (const x of plan) {
        if (x.action === 'skip') { results.push(x.result); continue; }
        await sql`SAVEPOINT master_import`.execute(db);
        try {
          const r = await saver.save(a, x.id, saver.body.parse(x.body) as never);
          results.push({ ...x.result, warnings: [...x.result.warnings, ...(r.warnings ?? [])] });
          await sql`RELEASE SAVEPOINT master_import`.execute(db);
        } catch (e) {
          await sql`ROLLBACK TO SAVEPOINT master_import`.execute(db);
          if (e instanceof z.ZodError) { issues.push({ row: x.result.row, message: `รหัส ${x.result.code}: ${e.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง'}` }); continue; }
          if (!(e instanceof AppError)) throw e;
          issues.push({ row: x.result.row, message: `รหัส ${x.result.code}: ${e.message}` });
        }
      }
      await sql.raw(b.commit && !issues.length ? 'RELEASE SAVEPOINT master_import_all' : 'ROLLBACK TO SAVEPOINT master_import_all').execute(db);
    }
    issues.sort((p, q) => p.row - q.row);
    if (b.commit && issues.length) throw badRequest(ran ? `นำเข้าไม่ได้ — ${issues[0]!.message} (แถว ${issues[0]!.row})` : `นำเข้าไม่ได้ — มีข้อผิดพลาด ${issues.length} รายการ กด "ตรวจแฟ้มอีกครั้ง" ดูรายละเอียด`,
      issues.slice(0, 200).map((x) => ({ field: `row:${x.row}`, message: x.message })));
    results.sort((p, q) => p.row - q.row);
    const count = (act: Action) => results.filter((r) => r.action === act).length;
    if (b.commit) await logActivity(db, a, { module: K.kind === 'asset' ? 'FA' : K.kind === 'customer' ? 'AR' : K.kind === 'supplier' ? 'AP' : 'IC', action: 'IMPORT', table: TABLE[K.kind],
      detail: { file: b.file_name, kind: K.path, added: count('add'), updated: count('update'), skipped: count('skip'), update: b.update } });
    return { ok: !issues.length, committed: b.commit, update: b.update, rows: results, errors: issues, file_rows: rows.length, added: count('add'), updated: count('update'), skipped: count('skip') };
  });
}

type Plan = { id: string | null; action: Action; body: Record<string, unknown>; result: Result };
const dateOnly = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v);
/** ค่าเดียวกันไหม (ตัวเลข 35000 = 35000.00 · วันที่ · ข้อความ) */
const same = (x: unknown, y: unknown) => { const p = String(dateOnly(x) ?? ''), q = String(dateOnly(y) ?? ''); return p === q || (p !== '' && q !== '' && !Number.isNaN(Number(p)) && !Number.isNaN(Number(q)) && Number(p) === Number(q)); };

/** แถว → เพิ่ม/แก้/ข้าม + แบบฟอร์มบันทึกของหน้าจอ (หารหัสอ้างอิง · ค่าเดิมของรหัสที่มีแล้ว) */
async function planRows(db: Db, a: Ctx, K: MasterImportKind, rows: MasterRow[], update: boolean, body: ZodObject<ZodRawShape>, issues: ImportIssue[]): Promise<Plan[]> {
  const tbl = TABLE[K.kind];
  const types = K.kind === 'stock' ? ITEM_KINDS.stock.types : K.kind === 'service' ? ITEM_KINDS.service.types : null;
  const all = (await sql<{ id: string; code: string; item_type: string | null }>`SELECT id, code, ${types ? sql`item_type` : sql`NULL`} AS item_type FROM ${sql.table(tbl)} WHERE company_id = ${a.companyId} AND deleted_at IS NULL`.execute(db)).rows;
  const byCode = new Map(all.map((r) => [r.code.toUpperCase(), r]));
  const taken = new Set(all.map((r) => r.code.toUpperCase()));
  const mask = types ? (await companySettings(db, a.companyId))['ic.item_code_mask'] as string | null ?? null : null;
  const pool = all.filter((r) => !types || types.includes(r.item_type ?? '')).map((r) => r.code);
  const fallback = K.kind === 'customer' ? 'C0001' : K.kind === 'supplier' ? 'S0001' : K.kind === 'stock' ? 'P0001' : K.kind === 'service' ? 'SV001' : 'FA0001';
  const refs = await loadRefs(db, a.companyId, K);
  // ทรัพย์สินที่คิดค่าเสื่อมลงบัญชีแล้ว
  const posted = K.kind === 'asset' ? new Set((await sql<{ asset_id: string }>`SELECT DISTINCT asset_id FROM fa_depreciation WHERE company_id = ${a.companyId} AND deleted_at IS NULL`.execute(db)).rows.map((r) => r.asset_id)) : new Set<string>();
  const keys = Object.keys(body.shape);
  const nameKey = NAME_KEY(K);
  const out: Plan[] = [];
  for (const r of rows) {
    const n0 = issues.length;
    const bad = (m: string) => issues.push({ row: r.row, message: m });
    let code = r.code;
    const hit = code ? byCode.get(code.toUpperCase()) : undefined;
    if (hit && types && !types.includes(hit.item_type ?? '')) { bad(`รหัส ${code} เป็นรหัสในแฟ้มสินค้าชนิดอื่นแล้ว (${Object.values(ITEM_KINDS).find((k) => k.types.includes(hit.item_type ?? ''))?.label ?? ''}) — ใช้รหัสอื่น`); continue; }
    if (hit && !update) { out.push({ id: hit.id, action: 'skip', body: {}, result: { row: r.row, code: hit.code, name: String(r.values[nameKey] ?? ''), action: 'skip', changed: [], warnings: [] } }); continue; }
    // ค่าในแฟ้ม → ช่องของแบบฟอร์ม (รหัสอ้างอิง → id)
    const set: Record<string, unknown> = {};
    const acc: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r.values)) {
      const c = K.columns.find((x) => x.key === k)!;
      let val: unknown = v;
      if (c.ref) { const id = refs[c.ref](String(v)); if (!id) { bad(`ไม่พบ${REF_TH[c.ref]} "${v}" (คอลัมน์ "${c.th}") — ใส่รหัสหรือชื่อที่มีในโปรแกรม`); continue; } val = id; }
      if (k.startsWith('accounts.')) acc[k.slice(9)] = val; else set[k] = val;
    }
    if (issues.length > n0) continue;
    let base: Record<string, unknown>;
    if (hit) {
      base = await existingBody(db, a.companyId, K, hit.id, keys);
      if (K.kind === 'asset' && posted.has(hit.id)) {
        const changed = ASSET_DEPR_KEYS.filter((k) => k in set && !same(set[k], base[k]));
        if (changed.length) { bad(`ทรัพย์สิน ${hit.code} คิดค่าเสื่อมลงบัญชีแล้ว — แก้ ${changed.map((k) => K.columns.find((c) => c.key === k)?.th ?? k).join(', ')} ทางนำเข้าไม่ได้ (กระทบค่าเสื่อมที่ลงบัญชีแล้ว) แก้ที่หน้าจอทรัพย์สิน หรือเว้นช่องเหล่านี้ว่าง`); continue; }
      }
      code = hit.code;
    } else {
      if (!code) {
        const c = newCode(mask, pool, taken, fallback, K.kind === 'service' ? 'SERV' : 'ITEM');
        if (!c) { bad(`ออกรหัส${K.label}ให้ไม่ได้ตามรูปแบบรหัส ${mask ?? ''} — ใส่รหัสเองในคอลัมน์ "${K.columns[0]!.th}"`); continue; }
        code = c; pool.push(c);
      } else taken.add(code.toUpperCase());
      base = { ...DEFAULTS[K.kind] };
    }
    // รายใหม่: ช่องที่ต้องมี (หัวสีชมพู *) ว่าง = ผิดเป็นภาษาไทย บอกคอลัมน์
    if (!hit) {
      const miss = K.columns.filter((c) => c.need === 'req' && !(c.key in set) && !(c.key.startsWith('accounts.') && c.key.slice(9) in acc));
      if (miss.length) { bad(`ไม่มี${miss.map((c) => `"${c.th}"`).join(', ')} — ต้องมีเมื่อเพิ่ม${K.label}ใหม่`); continue; }
    }
    const merged: Record<string, unknown> = { ...base, ...set, code };
    if (Object.keys(acc).length || base.accounts) merged.accounts = { ...(base.accounts as object ?? {}), ...acc };
    const v = body.safeParse(merged);
    if (!v.success) { const i = v.error.issues[0]!; const col = K.columns.find((c) => c.key === i.path.join('.') || c.key === String(i.path[0])); bad(i.code === 'invalid_type' && i.received === 'undefined' ? `ไม่มี${col ? `"${col.th}"` : 'ข้อมูลที่ต้องมี'}` : `${col ? `${col.th}: ` : ''}${i.message}`); continue; }
    const changed = hit ? Object.keys(set).concat(Object.keys(acc).map((k) => `accounts.${k}`)).filter((k) => k !== 'code').map((k) => K.columns.find((c) => c.key === k)?.th ?? k) : [];
    out.push({ id: hit?.id ?? null, action: hit ? 'update' : 'add', body: merged, result: { row: r.row, code, name: String(merged[nameKey] ?? ''), action: hit ? 'update' : 'add', changed, warnings: [] } });
  }
  return out;
}
const DEFAULTS: Record<MasterImportKind['kind'], Record<string, unknown>> = {
  customer: { status: 'A', tax_branch_no: '00000', price_level: '1', wht_condition: '1', on_hold: false },
  supplier: { status: 'A', tax_branch_no: '00000', on_hold: false },
  stock: { status: 'A' }, service: { status: 'A' }, asset: {},
};
const REF_TH: Record<MasterRef, string> = { account: 'เลขที่บัญชี', salesperson: 'พนักงานขาย', unit: 'หน่วยนับ', item_group: 'กลุ่มบัญชีสินค้า', asset_group: 'กลุ่มบัญชีทรัพย์สิน', department: 'แผนก', supplier: 'ผู้จำหน่าย' };

/** รหัส/ชื่อ → id ของบริษัทนี้ (ทุก query กรอง company_id) */
async function loadRefs(db: Db, companyId: string, K: MasterImportKind): Promise<Record<MasterRef, (v: string) => string | undefined>> {
  const need = new Set(K.columns.flatMap((c) => (c.ref ? [c.ref] : [])));
  const q = async (ref: MasterRef, s: ReturnType<typeof sql>) => (need.has(ref) ? (await s.execute(db)).rows as Array<{ id: string; code: string; name: string | null }> : []);
  const [account, salesperson, unit, itemGroup, assetGroup, department, supplier] = await Promise.all([
    q('account', sql`SELECT id, account_no AS code, name_th AS name FROM gl_account WHERE company_id = ${companyId} AND deleted_at IS NULL AND status = 'A' AND is_control = false`),
    q('salesperson', sql`SELECT id, code, name FROM md_salesperson WHERE company_id = ${companyId} AND deleted_at IS NULL`),
    q('unit', sql`SELECT id, code, name_th AS name FROM md_unit WHERE company_id = ${companyId} AND deleted_at IS NULL`),
    q('item_group', sql`SELECT id, code, name_th AS name FROM md_item_account_group WHERE company_id = ${companyId} AND deleted_at IS NULL AND NOT item_specific`),
    q('asset_group', sql`SELECT id, code, name_th AS name FROM md_asset_account_group WHERE company_id = ${companyId} AND deleted_at IS NULL`),
    q('department', sql`SELECT id, code, name_th AS name FROM md_department WHERE company_id = ${companyId} AND deleted_at IS NULL`),
    q('supplier', sql`SELECT id, code, name FROM md_supplier WHERE company_id = ${companyId} AND deleted_at IS NULL`),
  ]);
  const f = (rows: Array<{ id: string; code: string; name: string | null }>) => { const g = finder(rows); return (v: string) => g(v)?.id; };
  return { account: f(account), salesperson: f(salesperson), unit: f(unit), item_group: f(itemGroup), asset_group: f(assetGroup), department: f(department), supplier: f(supplier) };
}

/** ค่าเดิมของรหัสที่มีแล้วในรูปแบบฟอร์มบันทึกของหน้าจอ — รวมแท็บย่อย (สาขา ผู้ติดต่อ สถานที่ส่ง บัญชีธนาคาร) ให้คงเดิม */
async function existingBody(db: Db, companyId: string, K: MasterImportKind, id: string, keys: string[]): Promise<Record<string, unknown>> {
  const row = (await sql<Record<string, unknown>>`SELECT * FROM ${sql.table(TABLE[K.kind])} WHERE id = ${id} AND company_id = ${companyId}`.execute(db)).rows[0]!;
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in row && row[k] !== null && row[k] !== undefined) out[k] = typeof row[k] === 'number' || typeof row[k] === 'boolean' ? row[k] : dateOnly(row[k]) instanceof Object ? row[k] : String(dateOnly(row[k]));
  if (K.kind === 'customer' || K.kind === 'supplier') {
    const cust = K.kind === 'customer', col = cust ? 'customer_id' : 'supplier_id';
    out.contacts = (await sql<Record<string, unknown>>`SELECT name, position, phone, email, is_primary FROM md_party_contact WHERE company_id = ${companyId} AND party_type = ${cust ? 'C' : 'S'} AND party_id = ${id} AND deleted_at IS NULL ORDER BY line_no`.execute(db)).rows;
    out.branches = (await sql<Record<string, unknown>>`SELECT branch_no, name, address_1, address_2, address_3, zip_code, ${sql.join(ADDR_COLS.map((c) => sql.ref(c)))}, phone, contact
        FROM ${sql.table(cust ? 'md_customer_branch' : 'md_supplier_branch')} WHERE company_id = ${companyId} AND ${sql.ref(col)} = ${id} AND deleted_at IS NULL ORDER BY branch_no`.execute(db)).rows;
    if (cust) out.ship_tos = (await sql<Record<string, unknown>>`SELECT code, address_1, address_2, address_3, zip_code, ${sql.join(ADDR_COLS.map((c) => sql.ref(c)))}, phone, contact, branch_no
        FROM md_customer_ship_to WHERE company_id = ${companyId} AND customer_id = ${id} AND deleted_at IS NULL ORDER BY code`.execute(db)).rows;
    else out.banks = (await sql<Record<string, unknown>>`SELECT bank_code, branch, account_no, account_name, is_default FROM md_supplier_bank WHERE company_id = ${companyId} AND supplier_id = ${id} AND deleted_at IS NULL ORDER BY line_no`.execute(db)).rows;
    for (const arr of ['contacts', 'branches', 'ship_tos', 'banks']) if (Array.isArray(out[arr])) out[arr] = (out[arr] as Array<Record<string, unknown>>).map((x) => Object.fromEntries(Object.entries(x).filter(([, v]) => v !== null)));
  }
  if (K.kind === 'service' && row.account_group_id) {
    const g = (await sql<Record<string, string | null> & { item_specific: boolean }>`SELECT * FROM md_item_account_group WHERE id = ${row.account_group_id as string} AND company_id = ${companyId}`.execute(db)).rows[0];
    if (g?.item_specific) out.accounts = { revenue: g.sales_account_id, revenue_return: g.sales_return_account_id, cost_dr: g.cogs_account_id, cost_cr: g.inventory_account_id };
  }
  return out;
}
