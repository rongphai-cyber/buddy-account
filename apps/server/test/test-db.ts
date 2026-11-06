/**
 * ฐานข้อมูลของชุดทดสอบ: ปกติ PGlite ในหน่วยความจำ · BUDDY_TEST_DATABASE_URL = PostgreSQL จริง (โหมด postgres ของ
 * tools/cloud/pg-check.mjs — docs/20) · ฐานนั้นต้องเป็นฐานที่ pg-check เตรียมไว้ (มี wts_s0_check.marker) ไม่งั้นไม่ยอมรัน
 * — กันชี้ผิดไปฐานที่ใช้งานจริง (DEMO / ลูกค้า) แล้วชุดทดสอบเขียนข้อมูลทดลองลงไป
 */
import { sql } from 'kysely';
import { openDatabase, type Database } from '../src/db.js';
import { loadConfig, type Config } from '../src/config.js';

export const TEST_DATABASE_URL = process.env.BUDDY_TEST_DATABASE_URL || undefined;

export async function assertCheckDatabase(database: Database, envName = 'BUDDY_TEST_DATABASE_URL') {
  const r = await sql<{ ok: string | null }>`SELECT to_regclass('wts_s0_check.marker')::text AS ok`.execute(database.raw);
  if (!r.rows[0]?.ok) {
    await database.close();
    throw new Error(`${envName} ต้องชี้ฐานทดสอบที่ tools/cloud/pg-check.mjs เตรียมไว้ (ไม่พบ wts_s0_check.marker) — ไม่รันชุดทดสอบกับฐานนี้`);
  }
}

export async function openTestDatabase(): Promise<{ cfg: Config; database: Database }> {
  const cfg: Config = TEST_DATABASE_URL
    ? { ...loadConfig({}), databaseUrl: TEST_DATABASE_URL, dataDir: undefined }
    : { ...loadConfig({}), databaseUrl: undefined, dataDir: 'memory://' };
  const database = await openDatabase(cfg);
  if (TEST_DATABASE_URL) await assertCheckDatabase(database);
  return { cfg, database };
}
