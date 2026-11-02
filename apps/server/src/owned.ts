import { sql } from 'kysely';
import type { Db } from './db.js';
import { badRequest } from './http.js';

/**
 * ตารางข้อมูลหลักที่เอกสารอ้างถึงได้ (ทุกตารางมี company_id + deleted_at)
 * FK ตรวจเพียงว่ามีรหัสนี้ ไม่ได้ตรวจว่าเป็นของบริษัทเดียวกัน (กติกาข้อ 7) → ตรวจที่นี่ก่อนบันทึก
 */
const LABEL = {
  md_department: 'แผนก', md_salesperson: 'พนักงานขาย', md_warehouse: 'คลังสินค้า', md_unit: 'หน่วยนับ', md_customer_ship_to: 'สถานที่ส่งของ',
  md_project: 'โครงการ/งาน', md_bank: 'ธนาคาร', md_bank_account: 'บัญชีธนาคาร', md_payment_method: 'วิธีรับ/จ่ายชำระ', md_customer: 'ลูกค้า', md_supplier: 'ผู้จำหน่าย',
  md_item: 'สินค้า', md_item_account_group: 'กลุ่มบัญชีสินค้า', md_asset_account_group: 'กลุ่มบัญชีทรัพย์สิน', md_serial: 'หมายเลขสินค้า', md_doc_type: 'ประเภทเอกสาร',
  gl_account: 'เลขที่บัญชี', gl_journal: 'ใบสำคัญ', gl_journal_book: 'สมุดรายวัน', gl_template: 'แม่แบบใบสำคัญ', fin_cheque: 'เช็ค', doc_header: 'เอกสาร', doc_line: 'บรรทัดเอกสาร',
} as const;
export type OwnedTable = keyof typeof LABEL;
/** รหัสที่ต้องเป็นของบริษัท: field = ช่องบนหน้าจอ (บอกช่องที่ต้องแก้) · line = บรรทัดที่ (1 เป็นต้นไป) · pay = บรรทัดชำระโดยอื่น · label = ชื่อเรียกแทนค่าเริ่มต้นของตาราง */
export type OwnedRef = { table: OwnedTable; id: string | null | undefined; field: string; line?: number; pay?: boolean; label?: string };

/**
 * รหัสที่อ้างถึงทุกตัวต้องเป็นของบริษัทนี้และยังไม่ถูกลบ — ไม่ใช่ → แจ้ง "ไม่พบ…นี้ — เลือก…ใหม่" พร้อมช่อง/บรรทัดที่ต้องแก้
 * ค่าว่างข้ามได้ · อ่านตารางละ 1 ครั้ง
 */
export async function checkOwned(db: Db, companyId: string, refs: OwnedRef[]) {
  const want = refs.filter((r): r is OwnedRef & { id: string } => !!r.id);
  const byTable = new Map<OwnedTable, Set<string>>();
  for (const r of want) byTable.set(r.table, (byTable.get(r.table) ?? new Set()).add(r.id));
  const found = new Set<string>();
  for (const [t, ids] of byTable) {
    const rows = (await sql<{ id: string }>`SELECT id FROM ${sql.table(t)} WHERE company_id = ${companyId} AND deleted_at IS NULL AND id IN (${sql.join([...ids])})`.execute(db)).rows;
    for (const x of rows) found.add(`${t}|${x.id}`);
  }
  const bad = want.find((r) => !found.has(`${r.table}|${r.id}`));
  if (!bad) return;
  const label = bad.label ?? LABEL[bad.table];
  // ข้อความแบบตายตัว (ไม่ซ้อนช่องแทน) เพื่อให้พจนานุกรมอังกฤษจับคู่ได้
  const msg = !bad.line ? `ไม่พบ${label}นี้ในบริษัทนี้ — เลือก${label}ใหม่`
    : bad.pay ? `ชำระโดยอื่นบรรทัดที่ ${bad.line}: ไม่พบ${label}นี้ในบริษัทนี้ — เลือก${label}ใหม่` : `บรรทัดที่ ${bad.line}: ไม่พบ${label}นี้ในบริษัทนี้ — เลือก${label}ใหม่`;
  throw badRequest(msg, [{ field: bad.field, ...(bad.line ? { line: bad.line } : {}), message: `เลือก${label}ใหม่` }]);
}
