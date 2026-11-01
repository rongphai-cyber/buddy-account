import { sql } from 'kysely';
import { z } from 'zod';
import type { Db } from '../../db.js';

export type PostingPreview = {
  journals: Array<{ voucher_no: string; book_code: string; book_name: string; description: string | null; lines: Array<{ line_no: number; account_no: string; account_name: string; debit: string; credit: string; posting_role: string | null; resolved_from: string | null }> }>;
  warnings: string[];
};

/** ?id= ของเอกสารที่กำลังแก้ไข (ว่าง = เอกสารใหม่) */
export const previewQuery = z.object({ id: z.string().uuid().optional() });

/**
 * ตัวอย่างการลงบัญชีก่อนบันทึก (ข้อกำหนดเจ้าของ 01/11/2569): เรียกฟังก์ชันบันทึกจริงใน SAVEPOINT แล้วถอยกลับทั้งหมด (แบบเดียวกับตรวจแฟ้มนำเข้า)
 * → ใบสำคัญ/ข้อผิดพลาดตรงกับตอนกดบันทึกทุกประการ ไม่ต้องมีสูตรลงบัญชีชุดที่สอง · ไม่มีอะไรถูกบันทึก (เลขที่ log สต๊อก ถอยกลับหมด)
 * คำขอของบริษัททำงานในทรานแซกชันเดียวอยู่แล้ว (db.ts runInCompanyScope) — db.transaction() ในฟังก์ชันบันทึกใช้ทรานแซกชันนั้น
 */
export async function previewSave(db: Db, companyId: string, run: (tx: Db) => Promise<{ id?: string | null; warnings?: string[] }>): Promise<PostingPreview> {
  await sql`SAVEPOINT posting_preview`.execute(db);
  try {
    const r = await run(db);
    // ใบสำคัญของเอกสารนี้ + ใบสำคัญที่เกิดในทรานแซกชันนี้ (เช่น ผ่านเช็คจ่ายทันที) — created_at = now() = เวลาเริ่มทรานแซกชัน
    const js = (await sql<{ id: string; voucher_no: string; book_code: string; book_name: string; description: string | null }>`
      SELECT j.id, j.voucher_no, b.code AS book_code, b.name_th AS book_name, j.description FROM gl_journal j JOIN gl_journal_book b ON b.id = j.journal_book_id
       WHERE j.company_id = ${companyId} AND j.deleted_at IS NULL AND j.doc_status <> 'C' AND (j.source_header_id = ${r.id ?? null}::uuid OR j.created_at = now())
       ORDER BY j.created_at, j.voucher_no`.execute(db)).rows;
    const lines = js.length ? (await sql<{ journal_id: string; line_no: number; account_no: string; account_name: string; debit: string; credit: string; posting_role: string | null; resolved_from: string | null }>`
      SELECT l.journal_id, l.line_no, g.account_no, g.name_th AS account_name, l.debit, l.credit, l.posting_role, l.resolved_from FROM gl_journal_line l JOIN gl_account g ON g.id = l.account_id
       WHERE l.journal_id IN (${sql.join(js.map((j) => j.id))}) AND l.deleted_at IS NULL ORDER BY l.line_no`.execute(db)).rows : [];
    return { journals: js.map(({ id, ...j }) => ({ ...j, lines: lines.filter((l) => l.journal_id === id).map(({ journal_id: _, ...l }) => l) })), warnings: r.warnings ?? [] };
  } finally {
    await sql`ROLLBACK TO SAVEPOINT posting_preview`.execute(db);
  }
}
