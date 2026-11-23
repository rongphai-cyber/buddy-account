import { sql, type RawBuilder } from 'kysely';
import type { Db } from '../../db.js';

/**
 * ชื่อคู่ค้าในเอกสาร (HANDOFF 177): เอกสารที่บันทึกจากหน้าจอ/นำเข้า Excel เก็บชื่อ ที่อยู่ เลขผู้เสียภาษีของลูกค้า/ผู้จำหน่ายไว้ในหัวเอกสารเสมอ
 * แต่เอกสารที่ย้ายจาก Express รุ่นก่อน HANDOFF 177 ไม่มี → หน้ารายการ/รายงานใช้ชื่อจากข้อมูลหลักแทนเมื่อหัวเอกสารว่าง
 */
export const masterName = (p: string): RawBuilder<string> => sql`nullif(trim(concat_ws(' ', ${sql.ref(`${p}.title`)}, ${sql.ref(`${p}.name`)})), '')`;
/** ชื่อในหัวเอกสาร ไม่มี = ชื่อจากข้อมูลหลัก (h = หัวเอกสาร, p = ตารางลูกค้า/ผู้จำหน่ายที่ join แล้ว) */
export const partyNameSql = (h: string, p: string): RawBuilder<string> => sql`coalesce(nullif(${sql.ref(`${h}.party_name`)}, ''), ${masterName(p)})`;

/**
 * แฟ้มภาษีซื้อ/ขาย: แถวที่ไม่มีชื่อคู่ค้าเลย (ย้ายจาก Express — ISVAT ไม่มีชื่อ) ใช้ชื่อ/เลขผู้เสียภาษี/สาขา จากหัวเอกสาร แล้วจากข้อมูลหลัก
 * แถวที่มีชื่ออยู่แล้ว (รวมใบกำกับอย่างย่อ POS ที่ตั้งใจไม่มีเลขผู้ซื้อ) ใช้ตามเดิม
 * ต้อง LEFT JOIN doc_header เป็น h ก่อน แล้วใส่ vatPartyJoin ต่อท้าย
 */
export const vatPartyJoin = sql`LEFT JOIN md_customer vpc ON vpc.id = h.customer_id LEFT JOIN md_supplier vps ON vps.id = h.supplier_id`;
const missing = sql`coalesce(v.party_name, '') = ''`;
export const vatPartyName = sql<string | null>`CASE WHEN ${missing} THEN coalesce(nullif(h.party_name, ''), ${masterName('vpc')}, ${masterName('vps')}) ELSE v.party_name END`;
export const vatPartyTaxId = sql<string | null>`CASE WHEN ${missing} THEN coalesce(nullif(h.party_tax_id, ''), vpc.tax_id, vps.tax_id) ELSE v.party_tax_id END`;
export const vatPartyBranch = sql<string | null>`CASE WHEN ${missing} THEN coalesce(nullif(h.party_tax_branch_no, ''), vpc.tax_branch_no, vps.tax_branch_no) ELSE v.party_tax_branch_no END`;

/**
 * เติมชื่อ/ที่อยู่/เลขผู้เสียภาษี/สาขา ที่ว่างในหัวเอกสาร จากข้อมูลหลักลูกค้า/ผู้จำหน่าย แล้วเติมแฟ้มภาษีที่ไม่มีชื่อจากหัวเอกสาร
 * ใช้ตอนย้ายข้อมูลจาก Express (HANDOFF 177) — เติมเฉพาะช่องที่ว่าง ไม่แก้ค่าที่มีอยู่ ไม่แตะยอดเงิน
 */
export async function fillPartyFromMaster(db: Db, companyId: string): Promise<{ headers: number; vat: number }> {
  let headers = 0;
  for (const [tbl, col] of [['md_customer', 'customer_id'], ['md_supplier', 'supplier_id']] as const) {
    const r = await sql`UPDATE doc_header h SET
        party_name = coalesce(nullif(h.party_name, ''), left(${masterName('m')}, 200)),
        party_address = coalesce(nullif(h.party_address, ''), left(nullif(trim(concat_ws(' ', m.address_1, m.address_2, m.address_3, m.zip_code)), ''), 500)),
        party_tax_id = coalesce(nullif(h.party_tax_id, ''), m.tax_id),
        party_tax_branch_no = coalesce(nullif(h.party_tax_branch_no, ''), m.tax_branch_no, CASE WHEN m.tax_id IS NOT NULL THEN '00000' END)
      FROM ${sql.table(tbl)} m
      WHERE h.company_id = ${companyId} AND m.id = h.${sql.ref(col)} AND m.company_id = h.company_id AND coalesce(h.party_name, '') = ''`.execute(db);
    headers += Number(r.numAffectedRows ?? 0);
  }
  const v = await sql`UPDATE tax_vat_entry v SET party_name = h.party_name, party_tax_id = coalesce(nullif(v.party_tax_id, ''), h.party_tax_id),
        party_tax_branch_no = coalesce(nullif(v.party_tax_branch_no, ''), h.party_tax_branch_no)
      FROM doc_header h
      WHERE v.company_id = ${companyId} AND h.id = v.header_id AND h.company_id = v.company_id AND coalesce(v.party_name, '') = '' AND coalesce(h.party_name, '') <> ''`.execute(db);
  return { headers, vat: Number(v.numAffectedRows ?? 0) };
}
