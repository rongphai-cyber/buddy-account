/**
 * ย้ายรูปเดิมที่อยู่ในฐานข้อมูลขึ้นที่เก็บไฟล์ (docs/20 ข้อ 9) — ไม่บังคับ: ไม่ย้ายก็ใช้ได้ (อ่านที่เดิม · บันทึกใหม่ไปที่ใหม่)
 *   pnpm --filter @buddy/server cli files-migrate            ทดลอง: นับแถว/ขนาดที่จะย้าย ไม่เปลี่ยนอะไร
 *   FILES_DRIVER=r2 … cli files-migrate --apply              ย้ายจริง: อัปโหลด → ตั้ง storage_key → ล้างช่อง data (ทีละแถว)
 */
import { sql } from 'kysely';
import type { Database } from '../db.js';
import { fileKey, type FileStore } from './files.js';

const TABLES = [
  { table: 'sys_company_image', kind: (r: { kind: string }) => (r.kind === 'LOGO' ? 'logo' : 'sign') },
  { table: 'md_item_image', kind: () => 'item-image' },
] as const;

export interface MigrateResult { table: string; rows: number; bytes: number; moved: number }

export async function migrateFiles(database: Database, store: FileStore, opts: { apply: boolean; log?: (m: string) => void; limit?: number }): Promise<MigrateResult[]> {
  const log = opts.log ?? console.log;
  if (opts.apply && store.driver !== 'r2') throw new Error('ย้ายจริงได้เมื่อตั้ง FILES_DRIVER=r2 และค่า R2_* ครบแล้ว');
  const out: MigrateResult[] = [];
  for (const t of TABLES) {
    const rows = (await sql<{ id: string; company_id: string; kind: string; mime: string; data: string }>`SELECT id, company_id, ${sql.raw(t.table === 'sys_company_image' ? 'kind' : "'ITEM'")} AS kind, mime, data
        FROM ${sql.table(t.table)} WHERE deleted_at IS NULL AND storage_key IS NULL AND data <> '' ORDER BY created_at LIMIT ${opts.limit ?? 100000}`.execute(database.raw)).rows;
    const bytes = rows.reduce((s, r) => s + Math.floor((r.data.length * 3) / 4), 0);
    const res: MigrateResult = { table: t.table, rows: rows.length, bytes, moved: 0 };
    log(`${t.table}: ${rows.length} รูป ${(bytes / 1024 / 1024).toFixed(2)} MB ${opts.apply ? '→ ย้ายขึ้นที่เก็บไฟล์' : '(ทดลอง — ใส่ --apply เพื่อย้ายจริง)'}`);
    if (opts.apply) {
      for (const r of rows) {
        const key = fileKey(r.company_id, t.kind(r), r.mime);
        await store.put(key, Buffer.from(r.data, 'base64'), r.mime);
        const u = await sql`UPDATE ${sql.table(t.table)} SET storage_key = ${key}, data = '' WHERE id = ${r.id} AND storage_key IS NULL AND data = ${r.data}`.execute(database.raw);
        if (Number(u.numAffectedRows ?? 0)) res.moved++;
        else await store.delete(key); // แถวถูกแก้ระหว่างย้าย — คงของเดิม
      }
      log(`  ย้ายแล้ว ${res.moved}/${rows.length}`);
    }
    out.push(res);
  }
  return out;
}
