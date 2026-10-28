import type { Kysely } from 'kysely';
import type { DB } from './db.js';

/** บันทึกเหตุการณ์ลง sys_activity_log (เพิ่มได้อย่างเดียว — trigger ห้ามแก้/ลบ) */
export async function logActivity(
  db: Kysely<DB>,
  who: { companyId: string | null; userId: string | null },
  e: { module: string; action: string; docNo?: string | null; table?: string; rowId?: string | null; detail?: unknown },
) {
  await db.insertInto('sys_activity_log').values({
    company_id: who.companyId, user_id: who.userId, module: e.module.slice(0, 10), action: e.action.slice(0, 20),
    doc_no: e.docNo ?? null, table_name: e.table ?? null, row_id: e.rowId ?? null,
    detail: e.detail === undefined ? null : JSON.stringify(e.detail),
  }).execute();
}
