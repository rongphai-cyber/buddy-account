/** migration ทั้งหมดต้องให้โครงสร้างเท่ากับ db/generated/schema.sql (ที่สร้างจาก spec) — กันลืมเขียน migration เมื่อแก้ spec */
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sql } from 'kysely';
import { openDatabase } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { REPO_ROOT } from '../src/config.js';

async function columns(dataDir: string, setup: (d: Awaited<ReturnType<typeof openDatabase>>) => Promise<void>) {
  const d = await openDatabase({ dataDir });
  await setup(d);
  const r = await sql<{ t: string; c: string; ty: string; n: string }>`
    SELECT table_name AS t, column_name AS c, data_type AS ty, is_nullable AS n FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name <> 'sys_schema_migration' ORDER BY 1, 2`.execute(d.db);
  await d.close();
  return r.rows.map((x) => `${x.t}.${x.c}:${x.ty}:${x.n}`);
}

describe('schema', () => {
  it('migrations == generated schema', async () => {
    const viaMigrations = await columns('memory://', (d) => migrate(d, resolve(REPO_ROOT, 'db/migrations'), () => {}).then(() => undefined));
    const generated = await readFile(resolve(REPO_ROOT, 'db/generated/schema.sql'), 'utf8');
    const direct = await columns('memory://', (d) => d.execScript(generated));
    const missing = direct.filter((x) => !viaMigrations.includes(x));
    const extra = viaMigrations.filter((x) => !direct.includes(x));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  }, 120_000);
});
