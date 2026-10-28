import { Kysely, PostgresDialect, CompiledQuery, type Dialect, type DatabaseConnection, type Driver, type QueryResult, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import type { DB } from '../../../db/generated/db-types.js';

export type { DB };
export type Db = Kysely<DB>;

/** ชนิดข้อมูลที่แปลงเหมือนกันทั้ง PostgreSQL และ PGlite: เงิน = ข้อความ, วันที่ = 'yyyy-mm-dd', int8 = number */
const OID = { INT8: 20, NUMERIC: 1700, DATE: 1082, TIMESTAMPTZ: 1184, TIMESTAMP: 1114 } as const;

pg.types.setTypeParser(OID.INT8, (v) => Number(v));
pg.types.setTypeParser(OID.DATE, (v) => v);
pg.types.setTypeParser(OID.TIMESTAMPTZ, (v) => new Date(v).toISOString());
pg.types.setTypeParser(OID.NUMERIC, (v) => v);

export interface Database {
  db: Db;
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
  const db = new Kysely<DB>({ dialect });
  return {
    db, mode: 'pglite',
    async execScript(text) { await client.exec(text); },
    async close() { await db.destroy(); },
  };
}

/* ------------------------------------------------------------------ PostgreSQL (Cloud / Server) */
async function openPostgres(url: string): Promise<Database> {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  return {
    db, mode: 'postgres',
    async execScript(text) {
      const c = await pool.connect();
      try { await c.query(text); } finally { c.release(); }
    },
    async close() { await db.destroy(); },
  };
}

export async function openDatabase(opts: { databaseUrl?: string; dataDir?: string }): Promise<Database> {
  if (opts.databaseUrl) return openPostgres(opts.databaseUrl);
  if (opts.dataDir) return openPglite(opts.dataDir);
  throw new Error('ต้องกำหนด DATABASE_URL (PostgreSQL) หรือ BUDDY_DATA_DIR (ติดตั้งในเครื่อง)');
}
