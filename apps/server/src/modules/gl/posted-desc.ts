import { d, postedLineDesc } from '@buddy/core';
import type { Db } from '../../db.js';

/**
 * ใบสำคัญที่ระบบลงบัญชีไว้ก่อน 17/11/2569 บรรทัดไม่มีคำอธิบาย → แสดงคำอธิบายตามรูปแบบเดียวกับตอนลงบัญชี (postedLineDesc)
 * ตอนอ่าน — ไม่แก้ข้อมูลเดิม · เฉพาะบรรทัดที่มีบทบาทการลงบัญชี (posting_role) · บรรทัดที่ป้อนเองยังว่างตามเดิม (รายงานใช้คำอธิบายหัว)
 * บรรทัดรับ/จ่ายด้วยเช็ค: หาเช็คของเอกสารต้นทางที่ยอดตรงกับบรรทัด → ใส่เลขที่เช็ค
 * บรรทัดบัญชีของเอกสาร (เงินสดย่อย เอกสารธนาคาร — บรรทัดที่ระบุเลขที่บัญชีเอง): บัญชีเดียวกันมีบรรทัดเอกสารรายละเอียดเดียว → ใช้รายละเอียดนั้น
 */
export async function fillPostedDesc<T extends { description: string | null; posting_role?: string | null; debit: string; credit: string; account_id?: string | null }>(
  db: Db, companyId: string, rows: T[], head: (r: T) => string | null | undefined, source: (r: T) => string | null | undefined,
): Promise<T[]> {
  const need = rows.filter((r) => !r.description && r.posting_role);
  if (!need.length) return rows;
  const hidsOf = (roles: string[]) => [...new Set(need.filter((r) => roles.includes(r.posting_role!)).map(source).filter((x): x is string => !!x))];
  const chqH = hidsOf(['PAYMENT']), accH = hidsOf(['EXPENSE', 'BANK']);
  const chq = chqH.length ? await db.selectFrom('fin_cheque').select(['source_header_id', 'cheque_no', 'amount']).where('company_id', '=', companyId).where('instrument', '=', 'CHEQUE')
    .where('deleted_at', 'is', null).where('source_header_id', 'in', chqH).execute() : [];
  const acc = accH.length ? await db.selectFrom('doc_line').select(['header_id', 'account_id', 'description']).where('company_id', '=', companyId).where('deleted_at', 'is', null)
    .where('header_id', 'in', accH).where('item_id', 'is', null).where('account_id', 'is not', null).execute() : [];
  for (const r of need) {
    const amt = d(r.debit || 0).plus(d(r.credit || 0));
    const no = r.posting_role === 'PAYMENT' ? chq.find((c) => c.source_header_id === source(r) && d(c.amount).eq(amt))?.cheque_no : null;
    const texts = r.account_id && (r.posting_role === 'EXPENSE' || r.posting_role === 'BANK')
      ? [...new Set(acc.filter((x) => x.header_id === source(r) && x.account_id === r.account_id).map((x) => (x.description ?? '').trim()))] : [];
    const detail = texts.length === 1 && texts[0] ? { text: texts[0], alone: true } : null;
    r.description = postedLineDesc(head(r), { role: r.posting_role, debit: r.debit, detail }, no);
  }
  return rows;
}
