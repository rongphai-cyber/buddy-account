import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import type { Database } from './db.js';

/**
 * รัน migration ใน db/migrations ตามลำดับชื่อไฟล์ (0001_..., 0002_...)
 * ไฟล์ที่รันแล้วบันทึกใน sys_schema_migration พร้อม checksum — ห้ามแก้ไฟล์ที่รันไปแล้ว ให้เพิ่มไฟล์ใหม่แทน
 */
export async function migrate(database: Database, dir: string, log: (m: string) => void = console.log): Promise<string[]> {
  const { db } = database;
  await sql`CREATE TABLE IF NOT EXISTS sys_schema_migration (
    name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`.execute(db);
  const applied = new Map(
    (await sql<{ name: string; checksum: string }>`SELECT name, checksum FROM sys_schema_migration`.execute(db)).rows.map((r) => [r.name, r.checksum]),
  );
  const files = (await readdir(dir)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  const ran: string[] = [];
  for (const f of files) {
    const text = await readFile(join(dir, f), 'utf8');
    const sum = createHash('sha256').update(text).digest('hex');
    const prev = applied.get(f);
    if (prev) {
      if (prev !== sum) log(`คำเตือน: ${f} ถูกแก้หลังจากรันไปแล้ว (checksum ไม่ตรง) — ให้สร้าง migration ใหม่แทนการแก้ไฟล์เดิม`);
      continue;
    }
    log(`กำลังรัน migration ${f} ...`);
    const t = Date.now();
    await database.execScript(`BEGIN;\n${text}\n;INSERT INTO sys_schema_migration(name, checksum) VALUES ('${f.replace(/'/g, "''")}', '${sum}');\nCOMMIT;`);
    log(`  เสร็จใน ${Date.now() - t} ms`);
    ran.push(f);
  }
  return ran;
}
