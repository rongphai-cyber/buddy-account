import { d, postedLineDesc } from '@buddy/core';
import type { Db } from '../../db.js';

/**
 * ใบสำคัญที่ระบบลงบัญชีไว้ก่อน 17/11/2569 บรรทัดไม่มีคำอธิบาย → แสดงคำอธิบายตามรูปแบบเดียวกับตอนลงบัญชี (postedLineDesc)
 * ตอนอ่าน — ไม่แก้ข้อมูลเดิม · เฉพาะบรรทัดที่มีบทบาทการลงบัญชี (posting_role) · บรรทัดที่ป้อนเองยังว่างตามเดิม (รายงานใช้คำอธิบายหัว)
 * บรรทัดรับ/จ่ายด้วยเช็ค: หาเช็คของเอกสารต้นทางที่ยอดตรงกับบรรทัด → ใส่เลขที่เช็ค
 */
export async function fillPostedDesc<T extends { description: string | null; posting_role?: string | null; debit: string; credit: string }>(
  db: Db, companyId: string, rows: T[], head: (r: T) => string | null | undefined, source: (r: T) => string | null | undefined,
): Promise<T[]> {
  const need = rows.filter((r) => !r.description && r.posting_role);
  if (!need.length) return rows;
  const hids = [...new Set(need.filter((r) => r.posting_role === 'PAYMENT').map(source).filter((x): x is string => !!x))];
  const chq = hids.length ? await db.selectFrom('fin_cheque').select(['source_header_id', 'cheque_no', 'amount']).where('company_id', '=', companyId).where('instrument', '=', 'CHEQUE')
    .where('deleted_at', 'is', null).where('source_header_id', 'in', hids).execute() : [];
  for (const r of need) {
    const amt = d(r.debit || 0).plus(d(r.credit || 0));
    const no = r.posting_role === 'PAYMENT' ? chq.find((c) => c.source_header_id === source(r) && d(c.amount).eq(amt))?.cheque_no : null;
    r.description = postedLineDesc(head(r), { role: r.posting_role, debit: r.debit }, no);
  }
  return rows;
}
