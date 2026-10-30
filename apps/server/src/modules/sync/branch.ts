import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { sql, type RawBuilder } from 'kysely';
import { z } from 'zod';
import { formatDocNo, offlineActionOf, OFFLINE_ACTIONS } from '@buddy/core';
import type { Database, Db } from '../../db.js';
import { AppError, badRequest, forbidden, notFound, parse, requireAuth } from '../../http.js';
import { logActivity } from '../../audit.js';
import { decryptSecret, encryptSecret } from '../../secret.js';
import type { SyncCapture } from '../../sync-context.js';
import { insertJson, schemaVersion } from '../backup.js';
import { importTenant, unseal } from '../tenant-move.js';

/**
 * T7.8 ออฟไลน์สาขา — ฝั่งเครื่องสาขา (Buddy Account ที่ติดตั้งที่สาขา ตั้งค่าด้วยรหัสตั้งเครื่องจากสำนักงานใหญ่)
 * - บันทึกได้เฉพาะงานใน OFFLINE_ACTIONS (core/sync.ts) งานอื่นทำที่สำนักงานใหญ่ · เลขที่เอกสารจากช่วงที่จองให้เครื่อง
 * - ทุกเอกสารที่บันทึก: จดรหัสแถวที่สร้าง + คำขอเดิม ลง sync_outbox ในทรานแซกชันเดียวกับเอกสาร (ไฟดับกลางทางไม่มีเอกสารครึ่งใบ)
 * - ซิงก์ทุก 30 วินาที (BUDDY_SYNC_SECONDS): ส่งคิวตามลำดับ → ดึงแถวที่เปลี่ยนจากสำนักงานใหญ่มาทับ (รหัสแถวเดียวกัน)
 * - สำนักงานใหญ่ไม่รับเอกสารใด = คิวหยุดที่เอกสารนั้นจนกว่าจะ "ส่งใหม่" (หลังแก้ที่สำนักงานใหญ่) หรือ "ยกเลิกเอกสารนี้ที่สาขา"
 * สถานะเก็บแยกตามฐานข้อมูล (ชุดทดสอบเปิดสำนักงานใหญ่และสาขาในโปรแกรมเดียว)
 */
type State = { device_id: string; device_code: string; company_id: string; branch_id: string; central_url: string; token: string; last_pull_seq: number; users_stamp: string };
const states = new WeakMap<Database, State>();
export const branchStateOf = (database: Database) => states.get(database) ?? null;
const rows = async <T = Record<string, unknown>>(db: Db, q: RawBuilder<unknown>) => (await q.execute(db)).rows as T[];

async function readState(db: Db) {
  return Object.fromEntries((await rows<{ key: string; value: string | null }>(db, sql`SELECT key, value FROM sync_state`)).map((r) => [r.key, r.value ?? '']));
}
async function setState(db: Db, kv: Record<string, string | number | null>) {
  for (const [k, v] of Object.entries(kv))
    await sql`INSERT INTO sync_state (key, value) VALUES (${k}, ${v === null ? null : String(v)}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`.execute(db);
}
export async function loadBranchState(database: Database) {
  const s = await readState(database.db);
  const state: State | null = s.mode === 'branch' ? { device_id: s.device_id!, device_code: s.device_code!, company_id: s.company_id!, branch_id: s.branch_id!, central_url: s.central_url!,
    token: decryptSecret(s.token_enc ?? '') ?? '', last_pull_seq: Number(s.last_pull_seq ?? 0), users_stamp: s.users_stamp ?? '' } : null;
  if (state) states.set(database, state); else states.delete(database);
  return state;
}

/** เครื่องสาขาบันทึก/แก้ได้เฉพาะงานที่ทำตอนออฟไลน์ได้ + เข้าระบบ/เลือกบริษัท/พิมพ์/เรียกรายงาน/ซิงก์ */
const BRANCH_WRITE_OK = new Set(['POST /api/v1/auth/login', 'POST /api/v1/auth/login/totp', 'POST /api/v1/auth/logout', 'POST /api/v1/auth/select',
  'POST /api/v1/print/:kind/:id/printed', 'POST /api/v1/rpt/:code/run']);
export function checkBranchWrite(database: Database, method: string, url: string) {
  const state = states.get(database);
  if (!state || method === 'GET' || method === 'HEAD') return;
  if (offlineActionOf(method, url) || BRANCH_WRITE_OK.has(`${method} ${url}`) || url.startsWith('/api/v1/sync/')) return;
  throw new AppError(403, 'BRANCH_READ_ONLY', `เครื่องสาขาบันทึกได้เฉพาะ ${OFFLINE_ACTIONS.map((a) => a.label).join(' ')} — งานนี้ทำที่สำนักงานใหญ่ (${state.central_url})`);
}

/** เครื่องสาขา: งานที่ออฟไลน์ได้ → จดคำขอ + รหัสแถวที่สร้างลงคิวรอส่ง (ในทรานแซกชันของเอกสาร) */
export function branchCapture(database: Database, req: FastifyRequest, routeKey: string): SyncCapture | null {
  if (!states.has(database)) return null;
  const [method, path] = routeKey.split(' ') as [string, string];
  const action = offlineActionOf(method, path);
  if (!action) return null;
  const a = req.auth!;
  return {
    onCommit: async (tx, created) => {
      const headerId = created.doc_header?.[0] ?? null;
      const docNo = headerId ? (await rows<{ doc_no: string }>(tx, sql`SELECT doc_no FROM doc_header WHERE id = ${headerId}`))[0]?.doc_no ?? null : null;
      const id = randomUUID();
      const payload = { method, path, body: req.body ?? {}, user_id: a.userId, work_date: a.workDate ?? null, doc_no: docNo, created, label: action.label };
      await sql`INSERT INTO sync_outbox (id, seq, table_name, row_id, op, payload, tx_id, created_at, status)
          VALUES (${id}, (SELECT coalesce(max(seq), 0) + 1 FROM sync_outbox), 'API', ${headerId ?? created.md_customer?.[0] ?? id}, 'C', ${JSON.stringify(payload)}::jsonb, ${id}, now(), 'PENDING')`.execute(tx);
    },
  };
}

/** เลขที่เอกสารของเครื่องสาขา: จากช่วงที่สำนักงานใหญ่จองให้ (ข้ามเลขที่มีอยู่แล้ว) */
export async function branchDocNo(tx: Db, companyId: string, docTypeId: string, state: { device_id: string }): Promise<string | null> {
  const t = (await rows<{ code: string }>(tx, sql`SELECT code FROM md_doc_type WHERE id = ${docTypeId} AND company_id = ${companyId}`))[0];
  for (;;) {
    const b = (await rows<{ id: string; range_end: string; next_no: string }>(tx, sql`SELECT id, range_end::text, next_no::text FROM md_doc_number_block
        WHERE company_id = ${companyId} AND doc_type_id = ${docTypeId} AND device_id = ${state.device_id} AND status = 'A' AND next_no <= range_end AND deleted_at IS NULL
        ORDER BY range_start LIMIT 1 FOR UPDATE`))[0];
    if (!b || !t) throw badRequest('เลขที่เอกสารที่จองไว้ให้เครื่องสาขานี้หมดแล้ว — ต่ออินเทอร์เน็ตแล้วกด "ซิงก์ตอนนี้" เพื่อขอช่วงเลขเพิ่มจากสำนักงานใหญ่');
    const n = Number(b.next_no), no = formatDocNo(t.code, n);
    await sql`UPDATE md_doc_number_block SET next_no = ${n + 1}, status = CASE WHEN ${n + 1} > range_end THEN 'F' ELSE status END WHERE id = ${b.id}`.execute(tx);
    if (!(await rows(tx, sql`SELECT 1 FROM doc_header WHERE company_id = ${companyId} AND doc_no = ${no} AND deleted_at IS NULL`)).length) return no;
  }
}

// ---------------------------------------------------------------- ติดต่อสำนักงานใหญ่
export type Transport = (path: string, body: unknown, token: string, baseUrl: string) => Promise<{ status: number; headers: Record<string, string>; body: Buffer }>;
const fetchTransport: Transport = async (path, body, token, baseUrl) => {
  const r = await fetch(baseUrl.replace(/\/+$/, '') + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-buddy-device': token }, body: JSON.stringify(body ?? {}), signal: AbortSignal.timeout(120_000) });
  return { status: r.status, headers: Object.fromEntries(r.headers.entries()), body: Buffer.from(await r.arrayBuffer()) };
};
let transport: Transport = fetchTransport;
/** ชุดทดสอบใช้ส่งคำขอเข้าเซิร์ฟเวอร์จำลอง (app.inject) แทนเครือข่ายจริง */
export function setSyncTransport(t: Transport | null) { transport = t ?? fetchTransport; }
async function call<T>(state: State, path: string, body: unknown): Promise<T> {
  let r;
  try { r = await transport(path, body, state.token, state.central_url); } catch (e) { throw new AppError(503, 'CENTRAL_UNREACHABLE', `ติดต่อสำนักงานใหญ่ไม่ได้ (${e instanceof Error ? e.message : String(e)}) — ทำงานต่อได้ เอกสารจะส่งเมื่อต่ออินเทอร์เน็ตได้`); }
  if (r.status >= 300) {
    let e: { code?: string; message?: string } = {};
    try { e = JSON.parse(r.body.toString('utf8')).error ?? {}; } catch { /* ไม่ใช่ JSON */ }
    throw new AppError(r.status === 401 || r.status === 403 ? r.status : 502, e.code ?? 'CENTRAL_ERROR', `สำนักงานใหญ่: ${e.message ?? `ตอบกลับ ${r.status}`}`);
  }
  return JSON.parse(r.body.toString('utf8')) as T;
}

/** ตั้งเครื่องนี้เป็นเครื่องสาขา: ดึงสำเนาบริษัท + ผู้ใช้จากสำนักงานใหญ่ (เครื่องต้องยังไม่มีข้อมูล) */
export async function setupBranch(database: Database, centralUrl: string, code: string) {
  const db = database.db;
  if ((await rows(db, sql`SELECT 1 FROM sys_user LIMIT 1`)).length || (await rows(db, sql`SELECT 1 FROM sys_company LIMIT 1`)).length)
    throw badRequest('ตั้งเป็นเครื่องสาขาได้เฉพาะเครื่องที่ยังไม่มีข้อมูล (ติดตั้งใหม่)');
  let r;
  try { r = await transport('/api/v1/sync/bootstrap', {}, code, centralUrl); } catch (e) { throw badRequest(`ติดต่อสำนักงานใหญ่ที่ ${centralUrl} ไม่ได้ — ตรวจที่อยู่และอินเทอร์เน็ต (${e instanceof Error ? e.message : e})`); }
  if (r.status >= 300) {
    let msg = `ตอบกลับ ${r.status}`;
    try { msg = JSON.parse(r.body.toString('utf8')).error?.message ?? msg; } catch { /* ไม่ใช่ JSON */ }
    throw badRequest(`สำนักงานใหญ่ไม่ให้ตั้งเครื่อง: ${msg}`);
  }
  const imp = await importTenant(db, r.body, code, null);
  const company = imp.companies[0];
  if (!company) throw badRequest('สำนักงานใหญ่ไม่ได้ส่งข้อมูลบริษัทมา');
  await setState(db, { mode: 'branch', central_url: centralUrl.replace(/\/+$/, ''), token_enc: encryptSecret(code), device_id: r.headers['x-buddy-device-id'] ?? '', device_code: r.headers['x-buddy-device-code'] ?? '',
    branch_id: r.headers['x-buddy-branch-id'] ?? '', company_id: company.id, last_pull_seq: imp.pull_seq, users_stamp: '', last_ok_at: new Date().toISOString(), last_error: null });
  const state = (await loadBranchState(database))!;
  return { company: company.code, device: state.device_code, tenant: imp.tenant.code, ok: imp.ok };
}

const running = new WeakMap<Database, Promise<void>>();
/** ซิงก์หนึ่งรอบ: ส่งคิว → ดึงการเปลี่ยนแปลง (ไม่มีอินเทอร์เน็ต = จดข้อผิดพลาดไว้ ทำงานต่อได้) */
export function syncNow(database: Database): Promise<void> {
  const s = states.get(database);
  if (!s) return Promise.resolve();
  let p = running.get(database);
  if (!p) { p = doSync(database.db, s).finally(() => running.delete(database)); running.set(database, p); }
  return p;
}
async function doSync(db: Db, s: State) {
  try {
    const schema = await schemaVersion(db);
    if (!(await rows(db, sql`SELECT 1 FROM sync_outbox WHERE status = 'CONFLICT' LIMIT 1`)).length) {
      const pend = await rows<{ id: string; seq: string; payload: Record<string, unknown> }>(db, sql`SELECT id, seq::text, payload FROM sync_outbox WHERE status = 'PENDING' ORDER BY seq LIMIT 200`);
      if (pend.length) {
        const blocks = (await rows<{ id: string; next_no: string }>(db, sql`SELECT id, next_no::text FROM md_doc_number_block WHERE device_id = ${s.device_id}`)).map((b) => ({ id: b.id, next_no: Number(b.next_no) }));
        const r = await call<{ results: Array<{ id: string; result: string; message?: string }> }>(s, '/api/v1/sync/push', { schema, blocks, commands: pend.map((p) => ({ ...p.payload, id: p.id, seq: Number(p.seq) })) });
        for (const x of r.results)
          await sql`UPDATE sync_outbox SET status = ${x.result === 'APPLIED' ? 'APPLIED' : 'CONFLICT'}, last_error = ${x.message ?? null}, attempts = attempts + 1 WHERE id = ${x.id}`.execute(db);
      }
    }
    // ดึงทุกชุดก่อนแล้วใช้ในทรานแซกชันเดียว (แถวอ้างถึงกันข้ามชุดได้)
    const got: Array<{ t: string; j: Record<string, unknown> }> = [];
    const deleted: Array<{ t: string; id: string }> = [];
    let since = s.last_pull_seq, users: string | null = null, stamp = s.users_stamp;
    for (;;) {
      const r = await call<{ schema: string; to_seq: number; more: boolean; rows: typeof got; deleted?: typeof deleted; users: string | null; users_stamp: string }>(s, '/api/v1/sync/pull', { since, users_stamp: stamp });
      if (r.schema !== schema) throw new AppError(409, 'SCHEMA_MISMATCH', `โปรแกรมเครื่องสาขา (${schema}) กับสำนักงานใหญ่ (${r.schema}) เป็นคนละรุ่น — อัปเดตเครื่องสาขา`);
      got.push(...r.rows); deleted.push(...(r.deleted ?? [])); since = r.to_seq;
      if (r.users) { users = r.users; stamp = r.users_stamp; }
      if (!r.more) break;
    }
    await applyPull(db, s, got, users, deleted);
    await setState(db, { last_pull_seq: since, users_stamp: stamp, last_ok_at: new Date().toISOString(), last_error: null });
    s.last_pull_seq = since; s.users_stamp = stamp;
  } catch (e) {
    await setState(db, { last_error: e instanceof Error ? e.message : String(e) });
  } finally {
    await setState(db, { last_sync_at: new Date().toISOString() });
  }
}

/** ใช้แถวจากสำนักงานใหญ่ทับของเครื่องนี้ (รหัสแถวเดียวกัน) — ช่วงเลขที่คงเลขถัดไปที่มากกว่า · ผู้ใช้ที่ไม่อยู่ในเครื่องนี้ = ว่าง · สิทธิ์จับคู่ด้วยรหัสเมนู */
async function applyPull(db: Db, state: State, got: Array<{ t: string; j: Record<string, unknown> }>, usersSealed: string | null, deleted: Array<{ t: string; id: string }>) {
  if (!got.length && !usersSealed && !deleted.length) return;
  await db.transaction().execute(async (tx) => {
    await sql`SET CONSTRAINTS ALL DEFERRED`.execute(tx);
    await sql`SELECT set_config('app.allow_locked_period', 'on', true)`.execute(tx);
    // แถวที่สำนักงานใหญ่ลบจริงแล้ว (เช่น บรรทัดใบสำคัญเดิมตอนแก้ไข) — ยกเว้นที่ยังส่งค่ามาในชุดนี้
    const keep = new Set(got.map((g) => `${g.t}:${g.j.id}`));
    const del = new Map<string, string[]>();
    for (const x of deleted) if (!keep.has(`${x.t}:${x.id}`) && /^[a-z_][a-z0-9_]*$/.test(x.t)) { if (!del.has(x.t)) del.set(x.t, []); del.get(x.t)!.push(x.id); }
    for (const [t, ids] of del) await sql`DELETE FROM ${sql.id(t)} WHERE id IN (${sql.join(ids.map((x) => sql`${x}::uuid`))})`.execute(tx);
    const byTable = new Map<string, Array<Record<string, unknown>>>();
    if (usersSealed) {
      const u = JSON.parse(gunzipSync(unseal(Buffer.from(usersSealed, 'base64'), state.token)).toString('utf8')) as Record<string, Array<Record<string, unknown>>>;
      byTable.set('sys_tenant', u.tenant ?? []); byTable.set('sys_user_group', u.groups ?? []); byTable.set('sys_user', u.users ?? []);
      byTable.set('sys_user_security', (u.security ?? []).map((r) => ({ ...r, totp_secret_enc: r._totp_plain ? encryptSecret(String(r._totp_plain)) : null })));
    }
    for (const g of got) { if (!byTable.has(g.t)) byTable.set(g.t, []); byTable.get(g.t)!.push(g.j); }
    for (const [t, rs] of byTable) byTable.set(t, [...new Map(rs.map((r) => [String(r.id), r])).values()]);   // แถวล่าสุดของแต่ละรหัส
    const users = new Set([...(await rows<{ id: string }>(tx, sql`SELECT id FROM sys_user`)).map((r) => r.id), ...(byTable.get('sys_user') ?? []).map((r) => String(r.id))]);
    const fk = await rows<{ t: string; c: string }>(tx, sql`SELECT src.relname AS t, a.attname AS c FROM pg_constraint k JOIN pg_class src ON src.oid = k.conrelid
        JOIN pg_class dst ON dst.oid = k.confrelid JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1] WHERE k.contype = 'f' AND dst.relname = 'sys_user'`);
    for (const { t, c } of fk) for (const r of byTable.get(t) ?? []) if (r[c] && !users.has(String(r[c]))) r[c] = null;
    if (byTable.has('sys_permission')) {
      const menus = new Map((await rows<{ id: string; code: string }>(tx, sql`SELECT id, code FROM sys_menu WHERE deleted_at IS NULL`)).map((m) => [m.code, m.id]));
      byTable.set('sys_permission', byTable.get('sys_permission')!.filter((r) => menus.has(String(r._menu_code))).map((r) => ({ ...r, menu_id: menus.get(String(r._menu_code)) })));
    }
    const blocks = new Map((await rows<{ id: string; next_no: string }>(tx, sql`SELECT id, next_no::text FROM md_doc_number_block`)).map((b) => [b.id, Number(b.next_no)]));
    for (const [t, rs] of byTable) if (rs.length) await insertJson(tx, t, rs.map((r) => JSON.stringify(r)), { guard: sql`true` });
    for (const [id, n] of blocks) await sql`UPDATE md_doc_number_block SET next_no = ${n} WHERE id = ${id} AND next_no < ${n}`.execute(tx);
  });
}

const timers = new WeakMap<Database, NodeJS.Timeout>();
export function startSyncLoop(database: Database) {
  const sec = Number(process.env.BUDDY_SYNC_SECONDS ?? 30);
  if (!states.has(database) || !sec || timers.has(database)) return;
  const t = setInterval(() => { void syncNow(database); }, sec * 1000);
  t.unref();
  timers.set(database, t);
  void syncNow(database);
}
export function stopSyncLoop(database: Database) { const t = timers.get(database); if (t) clearInterval(t); timers.delete(database); }

export function syncBranchRoutes(app: FastifyInstance, database: Database) {
  const db = database.db;
  /** ตั้งเครื่องสาขา (เครื่องที่ติดตั้งใหม่ ยังไม่มีผู้ใช้) */
  app.post('/api/v1/sync/setup-branch', async (req) => {
    const b = parse(z.object({ central_url: z.string().trim().url('ที่อยู่สำนักงานใหญ่ไม่ถูกต้อง เช่น https://buddy.example.com').max(200), setup_code: z.string().trim().min(10, 'ป้อนรหัสตั้งเครื่องจากสำนักงานใหญ่').max(200) }), req.body);
    const r = await setupBranch(database, b.central_url, b.setup_code);
    await logActivity(db, { companyId: states.get(database)!.company_id, userId: null }, { module: 'SYNC', action: 'BRANCH_SETUP', docNo: r.device, detail: { central: b.central_url } });
    startSyncLoop(database);
    return r;
  });
  /** สถานะซิงก์ (แถบด้านบนของเครื่องสาขา + หน้าซิงก์) */
  app.get('/api/v1/sync/status', async (req) => {
    requireAuth(req);
    const state = states.get(database);
    if (!state) return { mode: 'central' };
    const s = await readState(db);
    const queue = await rows<{ id: string; status: string; label: string; doc_no: string | null; last_error: string | null; created_at: string; attempts: number }>(db, sql`
      SELECT id, status, payload->>'label' AS label, payload->>'doc_no' AS doc_no, last_error, created_at, attempts FROM sync_outbox
      WHERE status IN ('PENDING', 'CONFLICT') ORDER BY seq`);
    const blocks = await rows<{ code: string; left: number }>(db, sql`SELECT t.code, sum(b.range_end - b.next_no + 1)::int AS left FROM md_doc_number_block b JOIN md_doc_type t ON t.id = b.doc_type_id
        WHERE b.device_id = ${state.device_id} AND b.status = 'A' AND b.deleted_at IS NULL GROUP BY t.code ORDER BY t.code`);
    const recent = await rows(db, sql`SELECT id, payload->>'label' AS label, payload->>'doc_no' AS doc_no, created_at FROM sync_outbox WHERE status = 'APPLIED' ORDER BY seq DESC LIMIT 20`);
    return { mode: 'branch', device_code: state.device_code, central_url: state.central_url, last_sync_at: s.last_sync_at || null, last_ok_at: s.last_ok_at || null, last_error: s.last_error || null,
      pending: queue.filter((q) => q.status === 'PENDING').length, queue, blocks, recent, actions: OFFLINE_ACTIONS.map((a) => a.label) };
  });
  app.post('/api/v1/sync/now', async (req) => {
    requireAuth(req);
    if (!states.has(database)) throw badRequest('เครื่องนี้ไม่ใช่เครื่องสาขา');
    await syncNow(database);
    return { ok: true };
  });
  const outboxOf = async (id: string) => {
    const o = (await rows<{ id: string; status: string; payload: { created: Record<string, string[]>; label: string; doc_no: string | null } }>(db, sql`SELECT id, status, payload FROM sync_outbox WHERE id = ${id}`))[0];
    if (!o) throw notFound('รายการรอส่ง');
    return o;
  };
  /** ส่งใหม่ (แก้ที่สำนักงานใหญ่แล้ว เช่น เปิดงวด) */
  app.post('/api/v1/sync/outbox/:id/retry', async (req) => {
    const a = requireAuth(req);
    const o = await outboxOf(parse(z.object({ id: z.string().uuid() }), req.params).id);
    if (o.status !== 'CONFLICT') throw badRequest('รายการนี้ไม่ได้ติดปัญหา');
    await sql`UPDATE sync_outbox SET status = 'PENDING', last_error = NULL WHERE id = ${o.id}`.execute(db);
    await logActivity(db, { companyId: states.get(database)?.company_id ?? null, userId: a.userId }, { module: 'SYNC', action: 'SYNC_RETRY', docNo: o.payload.doc_no });
    await syncNow(database);
    return { ok: true };
  });
  /** ยกเลิกเอกสารที่สำนักงานใหญ่ไม่รับ: ลบแถวที่เอกสารนี้สร้างไว้ในเครื่องสาขา (เอกสารนี้ไม่เคยเข้าสำนักงานใหญ่) — เฉพาะผู้ดูแล */
  app.post('/api/v1/sync/outbox/:id/discard', async (req) => {
    const a = requireAuth(req);
    if (!a.isAdmin) throw forbidden('เฉพาะผู้ดูแลระบบยกเลิกเอกสารที่ส่งไม่ผ่านได้');
    const o = await outboxOf(parse(z.object({ id: z.string().uuid() }), req.params).id);
    if (o.status !== 'CONFLICT') throw badRequest('ยกเลิกได้เฉพาะเอกสารที่สำนักงานใหญ่ไม่รับ');
    try {
      await db.transaction().execute(async (tx) => {
        await sql`SET CONSTRAINTS ALL DEFERRED`.execute(tx);
        await sql`SELECT set_config('app.allow_locked_period', 'on', true)`.execute(tx);
        for (const [t, ids] of Object.entries(o.payload.created)) {
          if (!/^[a-z_][a-z0-9_]*$/.test(t) || !ids.length) continue;
          await sql`DELETE FROM ${sql.id(t)} WHERE id IN (${sql.join(ids.map((x) => sql`${x}::uuid`))})`.execute(tx);
        }
        await sql`UPDATE sync_outbox SET status = 'REJECTED' WHERE id = ${o.id}`.execute(tx);
      });
    } catch {
      throw badRequest(`ยกเลิก ${o.payload.label} ${o.payload.doc_no ?? ''} ไม่ได้ — มีเอกสารอื่นในเครื่องสาขาอ้างถึง ให้ยกเลิกเอกสารนั้นก่อน`);
    }
    await logActivity(db, { companyId: states.get(database)?.company_id ?? null, userId: a.userId }, { module: 'SYNC', action: 'SYNC_DISCARD', docNo: o.payload.doc_no, detail: { label: o.payload.label } });
    await syncNow(database);
    return { ok: true };
  });
}
