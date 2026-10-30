import { AsyncLocalStorage } from 'node:async_hooks';
import { Kysely, PostgresDialect, CompiledQuery, sql, type Transaction, type Dialect, type DatabaseConnection, type Driver, type QueryResult, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import type { DB } from '../../../db/generated/db-types.js';
import { parseCapturedIds } from '@buddy/core';
import { AppError } from './http.js';
import { syncCtx } from './sync-context.js';

export type { DB };
export type Db = Kysely<DB>;

/** ชนิดข้อมูลที่แปลงเหมือนกันทั้ง PostgreSQL และ PGlite: เงิน = ข้อความ, วันที่ = 'yyyy-mm-dd', int8 = number */
const OID = { INT8: 20, NUMERIC: 1700, DATE: 1082, TIMESTAMPTZ: 1184, TIMESTAMP: 1114 } as const;

pg.types.setTypeParser(OID.INT8, (v) => Number(v));
pg.types.setTypeParser(OID.DATE, (v) => v);
pg.types.setTypeParser(OID.TIMESTAMPTZ, (v) => new Date(v).toISOString());
pg.types.setTypeParser(OID.NUMERIC, (v) => v);

export interface Database {
  /** ใช้ในโค้ดทั่วไป: ถ้าอยู่ในคำขอที่เปิดทรานแซกชันระดับบริษัท จะใช้ทรานแซกชันนั้นอัตโนมัติ */
  db: Db;
  /** การเชื่อมต่อจริง (เจ้าของฐานข้อมูล) — ใช้เปิดทรานแซกชันต่อคำขอเท่านั้น */
  raw: Db;
  mode: 'postgres' | 'pglite';
  /** รันสคริปต์ SQL หลายคำสั่ง (ใช้กับ migration) */
  execScript(sqlText: string): Promise<void>;
  close(): Promise<void>;
}

/* ------------------------------------------------------------------ PGlite (ติดตั้งในเครื่อง) */
/** PGlite มีการเชื่อมต่อเดียว: ใช้คิวให้ทีละงาน เพื่อไม่ให้ทรานแซกชันของสองคำขอซ้อนกัน */
class Mutex {
  private tail: Promise<void> = Promise.resolve();
  lock(): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    const prev = this.tail;
    this.tail = prev.then(() => next);
    return prev.then(() => release);
  }
}

class PGliteDriver implements Driver {
  private mutex = new Mutex();
  private releases = new WeakMap<DatabaseConnection, () => void>();
  constructor(private client: PGlite) {}
  async init() {}
  async acquireConnection(): Promise<DatabaseConnection> {
    const release = await this.mutex.lock();
    const client = this.client;
    const conn: DatabaseConnection = {
      async executeQuery<R>(q: CompiledQuery): Promise<QueryResult<R>> {
        const r = await client.query<R>(q.sql, [...q.parameters]);
        return { rows: r.rows, numAffectedRows: r.affectedRows !== undefined ? BigInt(r.affectedRows) : undefined };
      },
      // eslint-disable-next-line require-yield
      async *streamQuery() { throw new Error('PGlite ไม่รองรับ stream'); },
    };
    this.releases.set(conn, release);
    return conn;
  }
  async beginTransaction(c: DatabaseConnection) { await c.executeQuery(CompiledQuery.raw('BEGIN')); }
  async commitTransaction(c: DatabaseConnection) { await c.executeQuery(CompiledQuery.raw('COMMIT')); }
  async rollbackTransaction(c: DatabaseConnection) { await c.executeQuery(CompiledQuery.raw('ROLLBACK')); }
  async releaseConnection(c: DatabaseConnection) { this.releases.get(c)?.(); }
  async destroy() { await this.client.close(); }
}

async function openPglite(dataDir: string): Promise<Database> {
  const client = await PGlite.create(dataDir, {
    parsers: {
      [OID.INT8]: (v: string) => Number(v),
      [OID.DATE]: (v: string) => v,
      [OID.NUMERIC]: (v: string) => v,
      [OID.TIMESTAMPTZ]: (v: string) => new Date(v).toISOString(),
    },
  });
  const dialect: Dialect = {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new PGliteDriver(client),
    createIntrospector: (db) => new PostgresIntrospector(db),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  };
  const raw = new Kysely<DB>({ dialect });
  return {
    db: scoped(raw), raw, mode: 'pglite',
    async execScript(text) { await client.exec(text); },
    async close() { await raw.destroy(); },
  };
}

/* ------------------------------------------------------------------ PostgreSQL (Cloud / Server) */
async function openPostgres(url: string): Promise<Database> {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  const raw = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  return {
    db: scoped(raw), raw, mode: 'postgres',
    async execScript(text) {
      const c = await pool.connect();
      try { await c.query(text); } finally { c.release(); }
    },
    async close() { await raw.destroy(); },
  };
}

export async function openDatabase(opts: { databaseUrl?: string; dataDir?: string }): Promise<Database> {
  if (opts.databaseUrl) return openPostgres(opts.databaseUrl);
  if (opts.dataDir) return openPglite(opts.dataDir);
  throw new Error('ต้องกำหนด DATABASE_URL (PostgreSQL) หรือ BUDDY_DATA_DIR (ติดตั้งในเครื่อง)');
}

/* ------------------------------------------------------------------ Row-Level Security (T0.14) */
/**
 * คำขอที่ทำงานกับข้อมูลของบริษัท: เปิดทรานแซกชันเดียวทั้งคำขอ สลับเป็น role buddy_app (ไม่ใช่เจ้าของตาราง จึงอยู่ใต้ RLS)
 * และตั้ง app.company_id / app.tenant_id — นโยบาย RLS ในฐานข้อมูลให้เห็น/เขียนได้เฉพาะแถวของบริษัทนั้น
 * แม้โค้ดลืมกรอง company_id ก็ข้ามบริษัทไม่ได้ (ป้องกันชั้นที่สอง)
 */
const scope = new AsyncLocalStorage<{ tx: Transaction<DB> }>();
export const APP_ROLE = 'buddy_app';

/** Kysely ที่ส่งต่อไปยังทรานแซกชันของคำขอปัจจุบัน (ถ้ามี) — db.transaction() ภายในคำขอใช้ทรานแซกชันเดิม */
function scoped(base: Db): Db {
  return new Proxy(base, {
    get(target, prop) {
      const store = scope.getStore();
      if (store && prop === 'transaction') return () => ({ execute: <T>(fn: (tx: Transaction<DB>) => Promise<T>) => fn(store.tx), setIsolationLevel() { return this; } });
      const cur = store?.tx ?? target;
      const v = Reflect.get(cur, prop, cur);
      return typeof v === 'function' ? v.bind(cur) : v;
    },
  });
}

/** RLS ใช้ได้เมื่อมี role buddy_app และผู้ใช้ที่เชื่อมต่อสลับเป็น role นี้ได้ (โฮสต์บางแห่งสร้าง role ไม่ได้ → ทำงานแบบเดิม) */
export async function rlsAvailable(database: Database): Promise<boolean> {
  const r = await sql<{ ok: boolean }>`SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${APP_ROLE}) AND pg_has_role(current_user, ${APP_ROLE}, 'MEMBER') AS ok`.execute(database.raw);
  return !!r.rows[0]?.ok;
}

/** ทำงานในขอบเขตของบริษัท (ใต้ RLS) — ทุก query ผ่าน database.db ภายใน fn ใช้ทรานแซกชันนี้ */
export function runInCompanyScope<T>(database: Database, ctx: { companyId: string; tenantId: string | null; isPlatform: boolean; rls?: boolean }, fn: () => Promise<T>): Promise<T> {
  return database.raw.transaction().execute(async (tx) => {
    if (ctx.rls !== false) await sql.raw(`SET LOCAL ROLE ${APP_ROLE}`).execute(tx);
    await sql`SELECT set_config('app.company_id', ${ctx.companyId}, true), set_config('app.tenant_id', ${ctx.tenantId ?? ''}, true), set_config('app.platform', ${ctx.isPlatform ? '1' : '0'}, true)`.execute(tx);
    // T7.8 ออฟไลน์สาขา (sync-context.ts)
    const sc = syncCtx.getStore();
    if (sc?.replay) await sql`SELECT set_config('app.force_ids', ${JSON.stringify(sc.replay.forceIds)}, true)`.execute(tx);
    if (sc?.capture) await sql`SELECT set_config('app.capture', 'on', true), set_config('app.cap', '', true)`.execute(tx);
    const result = await scope.run({ tx }, fn);
    if (sc?.replay) {
      // ทุกรหัสที่เครื่องสาขาสร้างต้องถูกใช้ครบ — ไม่ครบ = ผลที่สำนักงานใหญ่ต่างจากที่สาขา → ยกเลิกทั้งเอกสาร
      for (const [t, ids] of Object.entries(sc.replay.forceIds)) {
        const used = Number((await sql<{ p: string | null }>`SELECT current_setting(${'app.fp_' + t}, true) AS p`.execute(tx)).rows[0]?.p || 0);
        if (used !== ids.length) throw new AppError(409, 'SYNC_REPLAY_MISMATCH', `ผลการบันทึกที่สำนักงานใหญ่ไม่ตรงกับที่เครื่องสาขา (${t} ${used}/${ids.length} แถว) — ข้อมูลของสองเครื่องต่างกัน ให้ซิงก์ข้อมูลใหม่แล้วบันทึกเอกสารนี้อีกครั้ง`);
      }
    }
    if (sc?.capture) {
      const cap = (await sql<{ c: string | null }>`SELECT current_setting('app.cap', true) AS c`.execute(tx)).rows[0]?.c;
      await sc.capture.onCommit(tx, parseCapturedIds(cap));
    }
    return result;
  });
}
