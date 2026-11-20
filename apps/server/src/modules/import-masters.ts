import { sql } from 'kysely';
import { applyMaskCase, fitsMask, importPartyKey, newCode, type ImportIssue, type ImportParty } from '@buddy/core';
import type { Db } from '../db.js';
import type { AuthContext } from '../http.js';
import { logActivity } from '../audit.js';
import { companySettings } from '../company-template.js';
import { allowedFor } from './permissions.js';

/**
 * นำเข้า Excel: ลูกค้า/ผู้จำหน่าย/สินค้าที่ยังไม่มีในโปรแกรม → เพิ่มให้อัตโนมัติ (เจ้าของ 20/11/2569 · HANDOFF 167)
 * 1) วางแผน (plan*): หารายเดิม — คู่ค้า: รหัส → เลขผู้เสียภาษี+สาขา → ชื่อตรงกันทุกตัว · สินค้า: รหัส/บาร์โค้ด → ชื่อตรงกัน · ไม่พบ = "จะเพิ่มใหม่" (รหัสจากแฟ้ม หรือออกรหัสต่อจากแบบที่บริษัทใช้)
 * 2) เพิ่ม (createMasters): ในทรานแซกชันเดียวกับเอกสาร (ผิดฉบับเดียวไม่บันทึกทั้งแฟ้ม รวมข้อมูลหลัก) · บันทึก sys_activity_log ทุกราย · company_id จาก session เท่านั้น
 * สิทธิ์: ต้องเพิ่มได้ที่เมนูลูกค้า/ผู้จำหน่าย/สินค้า/สินค้าบริการ · รหัสค่าใช้จ่ายอื่นไม่เพิ่มให้ (ต้องมีบัญชีค่าใช้จ่าย)
 */
type Ctx = AuthContext & { companyId: string };
export type PartySide = 'customer' | 'supplier';
const SIDE = {
  customer: { tbl: 'md_customer', branchTbl: 'md_customer_branch', fk: 'customer_id', who: 'ลูกค้า', menu: 'SA.CUS', module: 'AR', fallback: 'C001' },
  supplier: { tbl: 'md_supplier', branchTbl: 'md_supplier_branch', fk: 'supplier_id', who: 'ผู้จำหน่าย', menu: 'PU.SUP', module: 'AP', fallback: 'S001' },
} as const;

export interface PartyRow { id: string; code: string; title: string | null; name: string; status: string; tax_id: string | null; tax_branch_no: string | null }
export interface PlannedParty { key: string; code: string; name: string; tax_id: string | null; tax_branch_no: string; address: string | null; phone: string | null; row: number; id?: string }
/** ผลการหาคู่ค้าของเอกสาร: พบ (branch = สาขาที่ใช้ในเอกสาร ถ้าหาจากเลขผู้เสียภาษี) · เพิ่มใหม่ · ใช้ชื่ออย่างเดียว (ค่าใช้จ่ายอื่น) · ผิด */
export type PartyHit = { kind: 'found'; party: PartyRow; branch: string | null } | { kind: 'new'; plan: PlannedParty } | { kind: 'name'; name: string } | { kind: 'error'; message: string };

const low = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const fullName = (p: { title: string | null; name: string }) => [p.title, p.name].filter(Boolean).join(' ');
/** รหัสใหม่ไม่ซ้ำกับรหัสที่มีหรือที่เพิ่งออกในแฟ้มนี้ — ต่อจากรหัสเดิมที่ตรงรูปแบบ หรือสร้างจากรูปแบบ (core newCode · HANDOFF 170 ข้อ H) */
function freshCode(pool: string[], taken: Set<string>, fallback: string, mask?: string | null, label?: string) {
  const c = newCode(mask, pool, taken, fallback, label);
  if (!c) throw new Error('ออกรหัสใหม่ไม่ได้');
  return c;
}
/** ที่อยู่ยาว → 3 บรรทัด บรรทัดละไม่เกิน 100 ตัว (ตัดที่ช่องว่าง) */
export function splitAddress(a: string | null): [string | null, string | null, string | null] {
  const out: string[] = [];
  let rest = (a ?? '').trim().replace(/\s+/g, ' ');
  while (rest && out.length < 3) {
    if (rest.length <= 100 || out.length === 2) { out.push(rest.slice(0, 100)); break; }
    const cut = rest.lastIndexOf(' ', 100);
    const at = cut > 30 ? cut : 100;
    out.push(rest.slice(0, at).trim()); rest = rest.slice(at).trim();
  }
  return [out[0] ?? null, out[1] ?? null, out[2] ?? null];
}

/** หาคู่ค้าของทุกเอกสารในแฟ้ม (ครั้งเดียว) · create=false: ไม่พบ = ผิดเหมือนเดิม · nameOnly: ชื่ออย่างเดียวที่ไม่มีในทะเบียน = ใส่ชื่อในเอกสาร (ค่าใช้จ่ายอื่น) */
export async function planParties(db: Db, companyId: string, side: PartySide, docs: Array<ImportParty & { row: number }>, opt: { create: boolean; nameOnly?: boolean }) {
  const S = SIDE[side];
  const up = (xs: Array<string | null>) => [...new Set(xs.filter((x): x is string => !!x).map((x) => x.toUpperCase()))];
  const codes = up(docs.map((x) => x.party)), taxes = [...new Set(docs.map((x) => x.party_tax_id).filter((x): x is string => !!x))];
  const names = [...new Set(docs.filter((x) => !x.party && !x.party_tax_id && x.party_name).map((x) => low(x.party_name)))];
  const rows = codes.length || taxes.length || names.length ? (await sql<PartyRow>`SELECT id, code, title, name, status, tax_id, tax_branch_no FROM ${sql.table(S.tbl)}
      WHERE company_id = ${companyId} AND deleted_at IS NULL AND (upper(code) = ANY(${codes}::text[]) OR tax_id = ANY(${taxes}::text[])
        OR lower(regexp_replace(btrim(name), '\\s+', ' ', 'g')) = ANY(${names}::text[]) OR lower(regexp_replace(btrim(coalesce(title || ' ', '') || name), '\\s+', ' ', 'g')) = ANY(${names}::text[]))`.execute(db)).rows : [];
  const branches = taxes.length ? (await sql<{ party: string; branch_no: string }>`SELECT b.${sql.ref(S.fk)} AS party, b.branch_no FROM ${sql.table(S.branchTbl)} b
      JOIN ${sql.table(S.tbl)} p ON p.id = b.${sql.ref(S.fk)} WHERE b.company_id = ${companyId} AND b.deleted_at IS NULL AND p.tax_id = ANY(${taxes}::text[])`.execute(db)).rows : [];
  const byCode = new Map(rows.map((p) => [p.code.toUpperCase(), p]));
  const hasBranch = (p: PartyRow, br: string) => (p.tax_branch_no || '00000') === br || branches.some((b) => b.party === p.id && b.branch_no === br);
  const pickActive = (xs: PartyRow[]) => [...xs].sort((a, b) => (a.status === 'I' ? 1 : 0) - (b.status === 'I' ? 1 : 0) || a.code.localeCompare(b.code))[0];
  const s = await companySettings(db, companyId);
  const taxRequired = s['gen.allow_blank_party_tax_id'] === false;
  const planned = new Map<string, PlannedParty>();
  const tick = '"เพิ่มข้อมูลหลักที่ยังไม่มีให้อัตโนมัติ"';
  const hits: PartyHit[] = docs.map((x) => {
    const br = x.party_branch ?? '00000';
    const err = (message: string): PartyHit => ({ kind: 'error', message });
    const inactive = (p: PartyRow) => err(`${S.who} ${p.code} เลิกใช้แล้ว — เปลี่ยนสถานะที่รายละเอียด${S.who}ก่อน`);
    let found: PartyRow | undefined, branch: string | null = null;
    if (x.party) found = byCode.get(x.party.toUpperCase());
    else if (x.party_tax_id) {
      const same = rows.filter((p) => p.tax_id === x.party_tax_id);
      found = pickActive(same.filter((p) => hasBranch(p, br)));
      if (found && (found.tax_branch_no || '00000') !== br) branch = br;
      if (!found && side === 'supplier' && same.length) {
        const o = pickActive(same)!;
        return err(`เลขผู้เสียภาษี ${x.party_tax_id} เป็นของผู้จำหน่าย ${o.code} ${o.name} (สาขา ${o.tax_branch_no || '00000'}) — สาขา ${br} ให้เพิ่มที่แท็บสาขาของ ${o.code} แล้วใส่รหัส ${o.code} ในแฟ้ม`);
      }
    } else if (x.party_name) {
      const same = rows.filter((p) => low(p.name) === low(x.party_name) || low(fullName(p)) === low(x.party_name));
      if (same.length > 1) return err(`ชื่อ${S.who} "${x.party_name}" ตรงกับหลายรหัส (${same.map((p) => p.code).join(', ')}) — ใส่รหัส${S.who}ในแฟ้ม`);
      found = same[0];
    }
    if (found) return found.status === 'I' ? inactive(found) : { kind: 'found', party: found, branch };
    // ไม่พบในทะเบียน
    if (!x.party && !x.party_tax_id && opt.nameOnly) return { kind: 'name', name: x.party_name! };
    const what = x.party ? `รหัส${S.who} ${x.party}` : x.party_tax_id ? `${S.who}เลขผู้เสียภาษี ${x.party_tax_id} สาขา ${br}` : `${S.who}ชื่อ "${x.party_name}"`;
    if (!opt.create) return err(`ไม่พบ${what} — เพิ่มที่ รายละเอียด${S.who}ก่อน หรือติ๊ก ${tick}`);
    if (!x.party_name) return err(`ไม่พบ${what} — ใส่ชื่อ${S.who}ในคอลัมน์ "ชื่อ${S.who}" เพื่อเพิ่มรายใหม่`);
    if (taxRequired && !x.party_tax_id) return err(`${S.who}ใหม่ "${x.party_name}" ต้องมีเลขผู้เสียภาษี (บริษัทตั้งค่าไม่ยอมให้ว่าง) — ใส่ในคอลัมน์ "เลขผู้เสียภาษี"`);
    // เลขผู้เสียภาษีของรายอื่น (ใส่รหัสใหม่แต่เลขซ้ำ): ผู้จำหน่าย = ห้ามทุกสาขา · ลูกค้า = ห้ามสาขาเดียวกันที่ยังใช้
    if (x.party && x.party_tax_id) {
      const o = pickActive(rows.filter((p) => p.tax_id === x.party_tax_id && (side === 'supplier' || (hasBranch(p, br) && p.status !== 'I'))));
      if (o) return err(`เลขผู้เสียภาษี ${x.party_tax_id} เป็นของ${S.who} ${o.code} ${o.name} แล้ว — ใส่รหัส ${o.code} ในแฟ้ม (หรือเว้นรหัสว่างให้หาจากเลขผู้เสียภาษี)`);
    }
    const key = x.party ? `C:${x.party.toUpperCase()}` : importPartyKey(x);
    let plan = planned.get(key);
    if (!plan) {
      plan = { key, code: x.party, name: x.party_name, tax_id: x.party_tax_id, tax_branch_no: br, address: x.party_address, phone: x.party_phone, row: x.row };
      planned.set(key, plan);
    }
    return { kind: 'new', plan };
  });
  // รหัสของรายใหม่ที่ไม่ได้ใส่รหัส: ต่อจากแบบที่บริษัทใช้ (เช่น S015 → S016) ไม่ซ้ำ
  const toCode = [...planned.values()].filter((p) => !p.code);
  if (toCode.length) {
    const all = (await sql<{ code: string }>`SELECT code FROM ${sql.table(S.tbl)} WHERE company_id = ${companyId} AND deleted_at IS NULL`.execute(db)).rows.map((r) => r.code);
    const taken = new Set([...all, ...[...planned.values()].map((p) => p.code)].filter(Boolean).map((c) => c.toUpperCase()));
    for (const p of toCode) p.code = freshCode(all, taken, S.fallback);
  }
  return { hits, planned: [...planned.values()] };
}

export interface ItemRow { id: string; code: string; name_th: string; item_type: string; barcode: string | null; base_unit_id: string | null; sales_unit_id: string | null; sales_factor: string | null; purchase_unit_id: string | null; purchase_factor: string | null; vat_code: string | null }
export interface PlannedItem { key: string; code: string; name: string; kind: '0' | '3'; unit: string | null; row: number; id?: string; unit_id?: string | null }
export type ItemHit = { kind: 'found'; item: ItemRow } | { kind: 'new'; plan: PlannedItem } | { kind: 'error'; message: string };
const ITEM_COLS = sql`id, code, name_th, item_type, barcode, base_unit_id, sales_unit_id, sales_factor, purchase_unit_id, purchase_factor, vat_code`;

/** หาสินค้าของทุกบรรทัดในแฟ้ม · ชื่อหาเฉพาะสินค้า/ชุด/บริการที่ยังใช้ · สินค้าใหม่ต้องมีหน่วย (ไม่มี = หน่วยที่บริษัทใช้มากที่สุด) */
export async function planItems(db: Db, companyId: string, lines: Array<{ row: number; item: string; item_name: string | null; item_kind: '0' | '3' | null; unit: string | null; description: string | null }>, opt: { create: boolean }) {
  const up = (xs: Array<string | null>) => [...new Set(xs.filter((x): x is string => !!x).map((x) => x.toUpperCase()))];
  const codes = up(lines.map((l) => l.item));
  const names = [...new Set(lines.filter((l) => !l.item && l.item_name).map((l) => low(l.item_name)))];
  const rows = codes.length || names.length ? (await sql<ItemRow>`SELECT ${ITEM_COLS} FROM md_item WHERE company_id = ${companyId} AND deleted_at IS NULL
      AND (upper(code) = ANY(${codes}::text[]) OR upper(barcode) = ANY(${codes}::text[]) OR (status = 'A' AND item_type IN ('0', '1', '2', '3') AND lower(regexp_replace(btrim(name_th), '\\s+', ' ', 'g')) = ANY(${names}::text[])))`.execute(db)).rows : [];
  const byCode = new Map(rows.map((i) => [i.code.toUpperCase(), i]));
  for (const i of rows) if (i.barcode && !byCode.has(i.barcode.toUpperCase())) byCode.set(i.barcode.toUpperCase(), i);
  const mask = (await companySettings(db, companyId))['ic.item_code_mask'] as string | undefined;
  const planned = new Map<string, PlannedItem>();
  const tick = '"เพิ่มข้อมูลหลักที่ยังไม่มีให้อัตโนมัติ"';
  const hits: ItemHit[] = lines.map((l) => {
    const err = (message: string): ItemHit => ({ kind: 'error', message });
    let found: ItemRow | undefined;
    if (l.item) found = byCode.get(l.item.toUpperCase());
    else {
      const same = rows.filter((i) => ['0', '1', '2', '3'].includes(i.item_type) && low(i.name_th) === low(l.item_name));
      if (same.length > 1) return err(`ชื่อสินค้า "${l.item_name}" ตรงกับหลายรหัส (${same.map((i) => i.code).join(', ')}) — ใส่รหัสสินค้าในแฟ้ม`);
      found = same[0];
    }
    if (found) return { kind: 'found', item: found };
    const what = l.item ? `รหัสสินค้า ${l.item}` : `สินค้าชื่อ "${l.item_name}"`;
    if (!opt.create) return err(`ไม่พบ${what} — เพิ่มที่ รายละเอียดสินค้าก่อน หรือติ๊ก ${tick}`);
    const name = l.item_name ?? l.description;
    if (!name) return err(`ไม่พบ${what} — ใส่ชื่อสินค้าในคอลัมน์ "ชื่อสินค้า" เพื่อเพิ่มสินค้าใหม่`);
    let code = l.item;
    if (code) {
      code = applyMaskCase(mask, code);
      const f = fitsMask(mask, code);
      if (!f.ok) return err(`รหัสสินค้าใหม่ ${code}: ${f.error}`);
    }
    if (l.unit && l.unit.length > 10) return err(`หน่วย "${l.unit}" ยาวเกิน 10 ตัว — ใช้รหัสหน่วยนับ`);
    const key = code ? `C:${code.toUpperCase()}` : `N:${low(name)}`;
    let plan = planned.get(key);
    if (!plan) { plan = { key, code: code ?? '', name: name.slice(0, 120), kind: l.item_kind ?? '0', unit: l.unit, row: l.row }; planned.set(key, plan); }
    return { kind: 'new', plan };
  });
  const list = [...planned.values()];
  // หน่วยของสินค้าใหม่ที่ไม่ได้ใส่หน่วย = หน่วยย่อยที่สินค้าของบริษัทใช้มากที่สุด
  if (list.some((p) => p.kind === '0' && !p.unit)) {
    const u = (await sql<{ code: string }>`SELECT u.code FROM md_item i JOIN md_unit u ON u.id = i.base_unit_id WHERE i.company_id = ${companyId} AND i.deleted_at IS NULL AND u.deleted_at IS NULL AND i.item_type = '0'
        GROUP BY u.code ORDER BY count(*) DESC, u.code LIMIT 1`.execute(db)).rows[0];
    for (const p of list) if (p.kind === '0' && !p.unit) {
      if (u) p.unit = u.code;
      else hits.forEach((h, i) => { if (h.kind === 'new' && h.plan === p) hits[i] = { kind: 'error', message: `สินค้าใหม่ "${p.name}" ต้องมีหน่วย — ใส่ในคอลัมน์ "หน่วย"` }; });
    }
  }
  const toCode = list.filter((p) => !p.code);
  if (toCode.length) {
    const all = (await sql<{ code: string; item_type: string }>`SELECT code, item_type FROM md_item WHERE company_id = ${companyId} AND deleted_at IS NULL`.execute(db)).rows;
    const taken = new Set([...all.map((r) => r.code), ...list.map((p) => p.code)].filter(Boolean).map((c) => c.toUpperCase()));
    for (const p of toCode) {
      p.code = newCode(mask, all.filter((r) => r.item_type === p.kind).map((r) => r.code), taken, p.kind === '3' ? 'SV001' : 'P0001', p.kind === '3' ? 'SERV' : 'ITEM') ?? '';
      if (!p.code) hits.forEach((h, i) => { if (h.kind === 'new' && h.plan === p) hits[i] = { kind: 'error', message: `ออกรหัสให้สินค้าใหม่ "${p.name}" ตามรูปแบบรหัส ${mask} ไม่ได้ — ใส่รหัสสินค้าในแฟ้ม` }; });
    }
  }
  return { hits, planned: list.filter((p) => hits.some((h) => h.kind === 'new' && h.plan === p)) };
}

/** สิทธิ์เพิ่มข้อมูลหลักที่ต้องใช้ → ข้อผิดพลาดรายแถว (บอกสิทธิ์ที่ขาด) */
export async function masterRightIssues(db: Db, a: Ctx, side: PartySide, parties: PlannedParty[], items: PlannedItem[]): Promise<ImportIssue[]> {
  const out: ImportIssue[] = [];
  const S = SIDE[side];
  if (parties.length && !(await allowedFor(db, a, S.menu, 'add')).allowed)
    for (const p of parties) out.push({ row: p.row, message: `ไม่มีสิทธิ์เพิ่ม${S.who} (เมนู รายละเอียด${S.who}) — ${S.who} ${p.code} ${p.name} ยังไม่มีในโปรแกรม ให้ผู้มีสิทธิ์เพิ่มก่อน หรือขอสิทธิ์เพิ่ม${S.who}` });
  for (const [kind, menu, label] of [['0', 'IC.ITEM', 'สินค้า'], ['3', 'IC.SRV', 'สินค้าบริการ']] as const) {
    const xs = items.filter((i) => i.kind === kind);
    if (xs.length && !(await allowedFor(db, a, menu, 'add')).allowed)
      for (const i of xs) out.push({ row: i.row, message: `ไม่มีสิทธิ์เพิ่ม${label} (เมนู รายละเอียด${label}) — ${i.code} ${i.name} ยังไม่มีในโปรแกรม ให้ผู้มีสิทธิ์เพิ่มก่อน หรือขอสิทธิ์เพิ่ม${label}` });
  }
  return out;
}

/** เพิ่มข้อมูลหลักตามแผน (ทรานแซกชันของคำขอ) — ใส่ id ให้แผน · หน่วยที่ยังไม่มีเพิ่มให้ (อัตรา 1) */
export async function createMasters(db: Db, a: Ctx, side: PartySide, parties: PlannedParty[], items: PlannedItem[], file: string) {
  const S = SIDE[side];
  const detail = { from: 'IMPORT', file };
  const s = parties.length ? await companySettings(db, a.companyId) : {};
  for (const p of parties) {
    const [a1, a2, a3] = splitAddress(p.address);
    const base = { company_id: a.companyId, code: p.code, name: p.name, tax_id: p.tax_id, tax_branch_no: p.tax_branch_no, address_1: a1, address_2: a2, address_3: a3, phone: p.phone, status: 'A', wht_condition: '1', created_by: a.userId };
    p.id = side === 'customer'
      ? (await db.insertInto('md_customer').values({ ...base, price_level: '1' }).returning('id').executeTakeFirstOrThrow()).id
      : (await db.insertInto('md_supplier').values({ ...base, price_type: '2', vat_rate: String(s['gen.vat_rate'] ?? 7) }).returning('id').executeTakeFirstOrThrow()).id;
    await logActivity(db, a, { module: S.module, action: 'ADD', docNo: p.code, table: S.tbl, rowId: p.id, detail: { ...detail, tax_id: p.tax_id, tax_branch_no: p.tax_branch_no } });
  }
  if (!items.length) return { units: [] as string[] };
  const want = [...new Set(items.map((i) => i.unit).filter((x): x is string => !!x).map((x) => x.toUpperCase()))];
  const have = new Map((await sql<{ id: string; code: string }>`SELECT id, code FROM md_unit WHERE company_id = ${a.companyId} AND deleted_at IS NULL AND upper(code) = ANY(${want}::text[])`.execute(db)).rows.map((u) => [u.code.toUpperCase(), u.id]));
  const units: string[] = [];
  for (const i of items) if (i.unit && !have.has(i.unit.toUpperCase())) {
    const id = (await db.insertInto('md_unit').values({ company_id: a.companyId, code: i.unit, name_th: i.unit, rate: '1', status: 'A', created_by: a.userId }).returning('id').executeTakeFirstOrThrow()).id;
    have.set(i.unit.toUpperCase(), id); units.push(i.unit);
    await logActivity(db, a, { module: 'IC', action: 'ADD', docNo: i.unit, table: 'md_unit', rowId: id, detail });
  }
  // กลุ่มบัญชีของสินค้าใหม่ = กลุ่มที่สินค้าของบริษัทใช้มากที่สุด (ไม่มี = ใช้บัญชีตามประเภทเอกสาร/บัญชีหลัก) · บริการไม่มีกลุ่ม (ใช้บัญชีตามประเภทเอกสาร/บัญชีหลัก — กำหนดบัญชีรายได้ภายหลังที่รายละเอียดสินค้าบริการ)
  const group = items.some((i) => i.kind === '0') ? (await sql<{ id: string }>`SELECT g.id FROM md_item i JOIN md_item_account_group g ON g.id = i.account_group_id
      WHERE i.company_id = ${a.companyId} AND i.deleted_at IS NULL AND i.item_type = '0' AND g.deleted_at IS NULL AND g.item_specific = false GROUP BY g.id, g.code ORDER BY count(*) DESC, g.code LIMIT 1`.execute(db)).rows[0]?.id ?? null : null;
  for (const i of items) {
    i.unit_id = i.unit ? have.get(i.unit.toUpperCase()) ?? null : null;
    i.id = (await db.insertInto('md_item').values({ company_id: a.companyId, code: i.code, name_th: i.name, item_type: i.kind, status: 'A', account_group_id: i.kind === '0' ? group : null,
      base_unit_id: i.unit_id, purchase_factor: '1', sales_factor: '1', created_by: a.userId }).returning('id').executeTakeFirstOrThrow()).id;
    await logActivity(db, a, { module: 'IC', action: 'ADD', docNo: i.code, table: 'md_item', rowId: i.id, detail });
  }
  return { units };
}
