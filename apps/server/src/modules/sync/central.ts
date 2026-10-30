import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { sql, type RawBuilder } from 'kysely';
import { z } from 'zod';
import { docNoSeq, formatDocNo, offlineActionOf, OFFLINE_DOC_CLASSES, SYNC_BLOCK_SIZE, SYNC_REFILL_RATIO } from '@buddy/core';
import type { Db } from '../../db.js';
import { AppError, badRequest, notFound, parse, requireCompany, unauthorized } from '../../http.js';
import { logActivity } from '../../audit.js';
import { decryptSecret } from '../../secret.js';
import { replays } from '../../sync-context.js';
import { SESSION_COOKIE, tenantActive } from '../auth.js';
import { schemaVersion } from '../backup.js';
import { exportTenant, seal } from '../tenant-move.js';

/**
 * T7.8 ออฟไลน์สาขา — ฝั่งสำนักงานใหญ่
 * - เครื่องสาขา (sys_device): ผู้ดูแลเพิ่มเครื่อง → ได้รหัสตั้งเครื่อง (แสดงครั้งเดียว เก็บเฉพาะ SHA-256 ใน public_key)
 * - ช่วงเลขที่ (md_doc_number_block): จอง 200 เลขต่อประเภทเอกสารที่ออกได้ตอนออฟไลน์ เลื่อนเลขถัดไปของสำนักงานใหญ่ข้ามช่วงนั้น
 * - /sync/bootstrap: สำเนาบริษัท + ผู้ใช้ของลูกค้า (แฟ้มเข้ารหัสด้วยรหัสเครื่อง) · /sync/push: บันทึกคำขอที่สาขาส่งมาด้วยตรรกะเดียวกัน
 *   (ผู้ใช้เดิม รหัสแถวเดิม เลขที่เดิม) ไม่ผ่าน = เข้าคิวให้คนตัดสิน (sync_conflict) · /sync/pull: แถวที่เปลี่ยนตั้งแต่ลำดับที่เครื่องมี
 */
const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const rows = async <T = Record<string, unknown>>(db: Db, q: RawBuilder<unknown>) => (await q.execute(db)).rows as T[];
type Device = { id: string; code: string; company_id: string; branch_id: string; tenant_id: string | null; status: string };
/** ตารางที่ไม่ส่งให้เครื่องสาขา (ข้อมูลเฉพาะเซิร์ฟเวอร์ / คิวซิงก์) */
const PULL_SKIP = new Set(['sync_conflict', 'sync_inbox', 'sync_change_log', 'sys_api_key', 'sys_secret', 'sys_ai_usage']);

export async function deviceOf(db: Db, req: FastifyRequest): Promise<Device> {
  const token = String(req.headers['x-buddy-device'] ?? '');
  if (!token) throw unauthorized();
  const d = (await rows<Device & { co_deleted: boolean; t_status: string | null; t_expires: string | null }>(db, sql`
    SELECT d.id, d.code, d.company_id, d.branch_id, d.status, c.tenant_id, c.deleted_at IS NOT NULL AS co_deleted, t.status AS t_status, t.expires_on::text AS t_expires
    FROM sys_device d JOIN sys_company c ON c.id = d.company_id LEFT JOIN sys_tenant t ON t.id = c.tenant_id
    WHERE d.public_key = ${sha(token)} AND d.deleted_at IS NULL`))[0];
  if (!d) throw new AppError(401, 'DEVICE_UNKNOWN', 'รหัสเครื่องสาขาไม่ถูกต้อง — ขอรหัสตั้งเครื่องใหม่จากผู้ดูแลที่สำนักงานใหญ่');
  if (d.status !== 'A') throw new AppError(403, 'DEVICE_SUSPENDED', `เครื่อง ${d.code} ถูกระงับที่สำนักงานใหญ่ — ติดต่อผู้ดูแลระบบ`);
  if (d.co_deleted || (d.tenant_id && !tenantActive(d.t_status, d.t_expires))) throw new AppError(403, 'TENANT_SUSPENDED', 'บริษัท/ลูกค้าผู้ใช้บริการนี้ถูกระงับ');
  await sql`UPDATE sys_device SET last_sync_at = now() WHERE id = ${d.id}`.execute(db);
  return d;
}

/** จองช่วงเลขที่ให้เครื่องเมื่อเลขที่เหลือในช่วงต่ำกว่า 20% (ประเภทเอกสารที่ออกได้ตอนออฟไลน์) */
export async function reserveBlocks(db: Db, d: Device) {
  return db.transaction().execute(async (tx) => {
    const types = await rows<{ id: string; code: string }>(tx, sql`SELECT id, code FROM md_doc_type WHERE company_id = ${d.company_id} AND deleted_at IS NULL
        AND doc_class IN (${sql.join(OFFLINE_DOC_CLASSES)}) ORDER BY code`);
    let added = 0;
    for (const t of types) {
      const left = Number((await rows<{ n: string | null }>(tx, sql`SELECT sum(range_end - next_no + 1)::text AS n FROM md_doc_number_block
          WHERE company_id = ${d.company_id} AND device_id = ${d.id} AND doc_type_id = ${t.id} AND status = 'A' AND deleted_at IS NULL`))[0]?.n ?? 0);
      if (left >= SYNC_BLOCK_SIZE * SYNC_REFILL_RATIO) continue;
      const cur = (await rows<{ next_no: string }>(tx, sql`SELECT next_no FROM md_doc_type WHERE id = ${t.id} FOR UPDATE`))[0]!;
      // เริ่มหลังเลขสูงสุดที่ใช้แล้ว (กันชนกับเอกสารที่ตั้งเลขเอง)
      const used = await rows<{ doc_no: string }>(tx, sql`SELECT doc_no FROM doc_header WHERE company_id = ${d.company_id} AND doc_no LIKE ${t.code + '%'} AND deleted_at IS NULL`);
      const maxUsed = used.map((u) => docNoSeq(t.code, u.doc_no) ?? 0).reduce((a, b) => Math.max(a, b), 0);
      const start = Math.max(Number(cur.next_no), maxUsed + 1);
      const end = start + SYNC_BLOCK_SIZE - 1;
      await sql`UPDATE md_doc_type SET next_no = ${end + 1} WHERE id = ${t.id}`.execute(tx);
      await sql`INSERT INTO md_doc_number_block (company_id, doc_type_id, branch_id, device_id, series, format, range_start, range_end, next_no, status)
          VALUES (${d.company_id}, ${t.id}, ${d.branch_id}, ${d.id}, ${t.code}, ${t.code + '{seq:7}'}, ${start}, ${end}, ${start}, 'A')`.execute(tx);
      added++;
    }
    return added;
  });
}

/** สำนักงานใหญ่ตอนรับเอกสารจากสาขา: ใช้เลขที่เดิม — ต้องอยู่ในช่วงที่จองให้เครื่องนั้น และยังไม่มีเอกสารเลขนี้ */
export async function replayDocNo(tx: Db, companyId: string, docTypeId: string, deviceId: string, docNo: string) {
  const t = (await rows<{ code: string }>(tx, sql`SELECT code FROM md_doc_type WHERE id = ${docTypeId} AND company_id = ${companyId}`))[0];
  const n = t ? docNoSeq(t.code, docNo) : null;
  if (!t || n === null) throw new AppError(409, 'DUPLICATE_NO', `เลขที่ ${docNo} ไม่ตรงกับประเภทเอกสาร`);
  const b = (await rows<{ id: string }>(tx, sql`SELECT id FROM md_doc_number_block WHERE company_id = ${companyId} AND device_id = ${deviceId} AND doc_type_id = ${docTypeId}
      AND ${n} BETWEEN range_start AND range_end AND status IN ('A', 'F') AND deleted_at IS NULL FOR UPDATE`))[0];
  if (!b) throw new AppError(409, 'DUPLICATE_NO', `เลขที่ ${docNo} ไม่อยู่ในช่วงเลขที่จองให้เครื่องนี้`);
  if ((await rows(tx, sql`SELECT 1 FROM doc_header WHERE company_id = ${companyId} AND doc_no = ${docNo} AND deleted_at IS NULL`)).length)
    throw new AppError(409, 'DUPLICATE_NO', `เลขที่ ${docNo} มีเอกสารอยู่แล้วที่สำนักงานใหญ่`);
  await sql`UPDATE md_doc_number_block SET next_no = greatest(next_no, ${n + 1}) WHERE id = ${b.id}`.execute(tx);
  return formatDocNo(t.code, n);
}

const commandSchema = z.object({
  id: z.string().uuid(), seq: z.number().int(), method: z.literal('POST'), path: z.string().max(100), body: z.unknown(),
  user_id: z.string().uuid(), work_date: z.string().nullable().optional(), doc_no: z.string().max(30).nullable().optional(),
  created: z.record(z.array(z.string().uuid())), created_at: z.string().optional(),
});
export type SyncCommand = z.infer<typeof commandSchema>;
const reasonOf = (code: string, msg: string) => /locked|งวด.*ปิด|ปิดงวด/i.test(msg) ? 'PERIOD_LOCKED' : code === 'DUPLICATE_NO' ? 'DUPLICATE_NO' : code === 'FORBIDDEN' ? 'PERMISSION' : code.slice(0, 30) || 'REJECTED';

/** ข้อมูลผู้ใช้ของลูกค้า (เครื่องสาขาเข้าระบบเองได้ตอนออฟไลน์) + ตราประทับไว้ตรวจว่าเปลี่ยนหรือไม่ */
async function usersBlock(db: Db, d: Device) {
  const all = async (q: RawBuilder<unknown>) => (await rows<{ j: Record<string, unknown> }>(db, q)).map((r) => r.j);
  const users = await all(sql`SELECT to_jsonb(x) AS j FROM sys_user x WHERE tenant_id = ${d.tenant_id} ORDER BY id`);
  const ids = users.map((u) => String(u.id));
  const inIds = sql.join((ids.length ? ids : ['00000000-0000-0000-0000-000000000000']).map((x) => sql`${x}::uuid`));
  const groups = await all(sql`SELECT to_jsonb(x) AS j FROM sys_user_group x WHERE tenant_id = ${d.tenant_id} ORDER BY id`);
  const security = (await all(sql`SELECT to_jsonb(x) AS j FROM sys_user_security x WHERE user_id IN (${inIds}) ORDER BY id`))
    .map((r): Record<string, unknown> => ({ ...r, totp_secret_enc: null, _totp_plain: typeof r.totp_secret_enc === 'string' ? decryptSecret(r.totp_secret_enc) : null }));
  const tenant = d.tenant_id ? await all(sql`SELECT to_jsonb(x) AS j FROM sys_tenant x WHERE id = ${d.tenant_id}`) : [];
  const stamp = sha(JSON.stringify([tenant, users, groups, security].map((xs) => xs.map((x) => `${x.id}:${x.row_version}:${x.updated_at}`))));
  return { stamp, data: { tenant, users, groups, security } };
}

export function syncCentralRoutes(app: FastifyInstance, db: Db) {
  // ---------------------------------------------------------------- เครื่องสาขา (ผู้ดูแลของบริษัท เมนู SET.DEVICE)
  app.get('/api/v1/devices', async (req) => {
    const a = requireCompany(req);
    return rows(db, sql`SELECT d.id, d.code, d.name, d.status, d.last_sync_at, d.created_at, b.code AS branch_code, b.name AS branch_name,
        (SELECT count(*)::int FROM sync_conflict c WHERE c.device_id = d.id AND c.resolution IS NULL AND c.deleted_at IS NULL) AS conflicts,
        (SELECT count(*)::int FROM sync_inbox i WHERE i.device_id = d.id AND i.result = 'APPLIED') AS applied,
        (SELECT coalesce(json_agg(json_build_object('code', t.code, 'left', x.left_no)), '[]'::json) FROM
          (SELECT doc_type_id, sum(range_end - next_no + 1)::int AS left_no FROM md_doc_number_block WHERE device_id = d.id AND status = 'A' AND deleted_at IS NULL GROUP BY doc_type_id) x
          JOIN md_doc_type t ON t.id = x.doc_type_id) AS blocks
      FROM sys_device d JOIN sys_branch b ON b.id = d.branch_id WHERE d.company_id = ${a.companyId} AND d.deleted_at IS NULL ORDER BY d.code`);
  });
  const newToken = (code: string) => `bd_${code}_${randomBytes(24).toString('base64url')}`;
  app.post('/api/v1/devices', async (req) => {
    const a = requireCompany(req);
    const b = parse(z.object({ code: z.string().trim().min(1, 'ป้อนรหัสเครื่อง').max(10).regex(/^[A-Za-z0-9-]+$/, 'รหัสเครื่องใช้ตัวอักษรอังกฤษ ตัวเลข -'), name: z.string().trim().min(1, 'ป้อนชื่อเครื่อง').max(120), branch_id: z.string().uuid('เลือกสาขา') }), req.body);
    if (!(await rows(db, sql`SELECT 1 FROM sys_branch WHERE id = ${b.branch_id} AND company_id = ${a.companyId} AND deleted_at IS NULL`)).length) throw badRequest('ไม่พบสาขานี้');
    if ((await rows(db, sql`SELECT 1 FROM sys_device WHERE company_id = ${a.companyId} AND code = ${b.code} AND deleted_at IS NULL`)).length) throw badRequest(`รหัสเครื่อง ${b.code} มีอยู่แล้ว`);
    const token = newToken(b.code);
    const r = (await rows<{ id: string }>(db, sql`INSERT INTO sys_device (company_id, branch_id, code, name, kind, public_key, status, created_by)
        VALUES (${a.companyId}, ${b.branch_id}, ${b.code}, ${b.name}, 'desktop', ${sha(token)}, 'A', ${a.userId}) RETURNING id`))[0]!;
    await logActivity(db, a, { module: 'SEC', action: 'ADD_DEVICE', docNo: b.code, table: 'sys_device', rowId: r.id });
    return { id: r.id, setup_code: token };
  });
  /** ออกรหัสตั้งเครื่องใหม่ (รหัสเดิมใช้ไม่ได้ทันที) */
  app.post('/api/v1/devices/:id/new-code', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const d = (await rows<{ code: string }>(db, sql`SELECT code FROM sys_device WHERE id = ${id} AND company_id = ${a.companyId} AND deleted_at IS NULL`))[0];
    if (!d) throw notFound('เครื่องสาขา');
    const token = newToken(d.code);
    await sql`UPDATE sys_device SET public_key = ${sha(token)}, status = 'A', updated_by = ${a.userId} WHERE id = ${id}`.execute(db);
    await logActivity(db, a, { module: 'SEC', action: 'DEVICE_CODE', docNo: d.code, table: 'sys_device', rowId: id });
    return { id, setup_code: token };
  });
  /** ระงับเครื่อง (หาย/เลิกใช้): ส่ง/ดึงข้อมูลไม่ได้ ช่วงเลขที่ยังไม่ใช้ถูกยกเลิก */
  app.post('/api/v1/devices/:id/suspend', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const d = (await rows<{ code: string }>(db, sql`SELECT code FROM sys_device WHERE id = ${id} AND company_id = ${a.companyId} AND deleted_at IS NULL`))[0];
    if (!d) throw notFound('เครื่องสาขา');
    await sql`UPDATE sys_device SET status = 'I', updated_by = ${a.userId} WHERE id = ${id}`.execute(db);
    await sql`UPDATE md_doc_number_block SET status = 'X' WHERE device_id = ${id} AND status = 'A'`.execute(db);
    await logActivity(db, a, { module: 'SEC', action: 'SUSPEND_DEVICE', docNo: d.code, table: 'sys_device', rowId: id });
    return { id };
  });
  /** เอกสารจากสาขาที่บันทึกไม่ผ่าน (รอคนตัดสิน — แก้ที่สำนักงานใหญ่แล้วให้สาขากดส่งใหม่ หรือสาขายกเลิกเอกสารนั้น) */
  app.get('/api/v1/devices/:id/conflicts', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    return rows(db, sql`SELECT c.id, c.reason, c.client_payload, c.created_at, c.resolution, c.resolved_at FROM sync_conflict c
        WHERE c.company_id = ${a.companyId} AND c.device_id = ${id} AND c.deleted_at IS NULL ORDER BY c.created_at DESC LIMIT 200`);
  });

  // ---------------------------------------------------------------- เครื่องสาขาเรียก (ยืนยันด้วยรหัสเครื่องใน header x-buddy-device)
  app.post('/api/v1/sync/bootstrap', async (req, reply) => {
    const d = await deviceOf(db, req);
    await reserveBlocks(db, d);
    if (!d.tenant_id) throw badRequest('บริษัทนี้ไม่มีลูกค้าผู้ใช้บริการ');
    const r = await exportTenant(db, d.tenant_id, String(req.headers['x-buddy-device']), { companyIds: [d.company_id] });
    await logActivity(db, { companyId: d.company_id, userId: null }, { module: 'SYNC', action: 'DEVICE_BOOTSTRAP', docNo: d.code, table: 'sys_device', rowId: d.id, detail: { rows: r.rows } });
    reply.header('content-type', 'application/octet-stream').header('x-buddy-device-id', d.id).header('x-buddy-device-code', d.code).header('x-buddy-branch-id', d.branch_id);
    return r.file;
  });

  /** รับคำขอที่สาขาบันทึกไว้ ทีละรายการตามลำดับ — รายการไหนไม่ผ่านหยุดที่รายการนั้น (รายการหลังอาจอ้างถึง) */
  app.post('/api/v1/sync/push', { bodyLimit: 50 * 1024 * 1024 }, async (req) => {
    const d = await deviceOf(db, req);
    const b = parse(z.object({ schema: z.string(), blocks: z.array(z.object({ id: z.string().uuid(), next_no: z.number().int() })).default([]), commands: z.array(commandSchema).max(500) }), req.body);
    const schema = await schemaVersion(db);
    if (b.schema !== schema) throw new AppError(409, 'SCHEMA_MISMATCH', `โปรแกรมที่เครื่องสาขา (${b.schema}) กับสำนักงานใหญ่ (${schema}) เป็นคนละรุ่น — อัปเดตเครื่องสาขาก่อนซิงก์`);
    for (const x of b.blocks) await sql`UPDATE md_doc_number_block SET next_no = greatest(next_no, ${x.next_no}), status = CASE WHEN status = 'A' AND ${x.next_no} > range_end THEN 'F' ELSE status END
        WHERE id = ${x.id} AND device_id = ${d.id}`.execute(db);
    const results: Array<{ id: string; result: 'APPLIED' | 'REJECTED'; message?: string; duplicate?: boolean }> = [];
    for (const c of [...b.commands].sort((x, y) => x.seq - y.seq)) {
      const done = (await rows<{ result: string }>(db, sql`SELECT result FROM sync_inbox WHERE idempotency_key = ${c.id} AND device_id = ${d.id}`))[0];
      if (done?.result === 'APPLIED') { results.push({ id: c.id, result: 'APPLIED', duplicate: true }); continue; }
      const r = await replay(app, db, d, c);
      const headerId = c.created.doc_header?.[0] ?? c.created.md_customer?.[0] ?? c.id;
      await sql`INSERT INTO sync_inbox (idempotency_key, company_id, device_id, table_name, row_id, result, message) VALUES (${c.id}, ${d.company_id}, ${d.id}, 'API', ${headerId}, ${r.ok ? 'APPLIED' : 'REJECTED'}, ${r.ok ? null : r.message})
          ON CONFLICT (idempotency_key) DO UPDATE SET result = EXCLUDED.result, message = EXCLUDED.message, received_at = now()`.execute(db);
      if (r.ok) { results.push({ id: c.id, result: 'APPLIED' }); continue; }
      await sql`INSERT INTO sync_conflict (company_id, table_name, row_id, device_id, client_payload, reason) VALUES (${d.company_id}, 'API', ${headerId}, ${d.id}, ${JSON.stringify({ ...c, message: r.message })}::jsonb, ${reasonOf(r.code, r.message)})`.execute(db);
      results.push({ id: c.id, result: 'REJECTED', message: r.message });
      break;
    }
    await reserveBlocks(db, d);
    return { schema, results };
  });

  /** แถวที่เปลี่ยนที่สำนักงานใหญ่ตั้งแต่ลำดับ since (ครั้งละไม่เกิน 3,000 รายการ) + ข้อมูลผู้ใช้เมื่อมีการเปลี่ยน (เข้ารหัสด้วยรหัสเครื่อง) */
  app.post('/api/v1/sync/pull', async (req) => {
    const d = await deviceOf(db, req);
    const b = parse(z.object({ since: z.number().int().min(0), users_stamp: z.string().nullable().optional(), limit: z.number().int().min(1).max(5000).default(3000) }), req.body);
    const log = await rows<{ seq: string; table_name: string; row_id: string }>(db, sql`SELECT seq::text AS seq, table_name, row_id FROM sync_change_log
        WHERE company_id = ${d.company_id} AND seq > ${b.since} ORDER BY seq LIMIT ${b.limit}`);
    const byTable = new Map<string, Set<string>>();
    for (const l of log) if (!PULL_SKIP.has(l.table_name)) { if (!byTable.has(l.table_name)) byTable.set(l.table_name, new Set()); byTable.get(l.table_name)!.add(l.row_id); }
    const out: Array<{ t: string; j: Record<string, unknown> }> = [];
    const menus = new Map((await rows<{ id: string; code: string }>(db, sql`SELECT id, code FROM sys_menu`)).map((m) => [m.id, m.code]));
    // แถวที่ยังอยู่ = ส่งค่าปัจจุบัน · แถวที่ถูกลบจริงแล้ว (มีใน log แต่ไม่มีในตาราง) = ให้เครื่องสาขาลบตาม
    const deleted: Array<{ t: string; id: string }> = [];
    for (const [t, idSet] of byTable) {
      if (!/^[a-z_][a-z0-9_]*$/.test(t)) continue;
      const list = sql.join([...idSet].map((x) => sql`${x}::uuid`));
      const own = t === 'sys_company' ? sql`x.id = ${d.company_id}` : sql`x.company_id = ${d.company_id}`;
      const found = new Set<string>();
      for (const r of await rows<{ j: Record<string, unknown> }>(db, sql`SELECT to_jsonb(x) AS j FROM ${sql.id(t)} x WHERE x.id IN (${list}) AND ${own}`)) {
        found.add(String(r.j.id));
        out.push({ t, j: t === 'sys_device' ? { ...r.j, public_key: null } : t === 'sys_permission' ? { ...r.j, _menu_code: menus.get(String(r.j.menu_id)) ?? null } : r.j });
      }
      for (const id of idSet) if (!found.has(id)) deleted.push({ t, id });
    }
    const users = await usersBlock(db, d);
    const token = String(req.headers['x-buddy-device']);
    return { schema: await schemaVersion(db), to_seq: log.length ? Number(log.at(-1)!.seq) : b.since, more: log.length === b.limit, rows: out, deleted,
      users_stamp: users.stamp, users: users.stamp === b.users_stamp ? null : seal(gzipSync(Buffer.from(JSON.stringify(users.data))), token).toString('base64') };
  });
}

/** บันทึกคำขอของสาขาซ้ำที่สำนักงานใหญ่ ในนามผู้ใช้เดิม (session ชั่วคราว) ด้วยรหัสแถวและเลขที่เดิม */
async function replay(app: FastifyInstance, db: Db, d: Device, c: SyncCommand): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  if (!offlineActionOf(c.method, c.path)) return { ok: false, code: 'NOT_OFFLINE', message: `${c.method} ${c.path} ไม่ใช่งานที่ทำที่เครื่องสาขาได้` };
  const u = (await rows<{ id: string }>(db, sql`SELECT u.id FROM sys_user u WHERE u.id = ${c.user_id} AND u.tenant_id IS NOT DISTINCT FROM ${d.tenant_id} AND u.status = 'A' AND u.deleted_at IS NULL`))[0];
  if (!u) return { ok: false, code: 'PERMISSION', message: 'ผู้ใช้ที่บันทึกเอกสารนี้ถูกระงับหรือไม่มีที่สำนักงานใหญ่' };
  const token = randomBytes(32).toString('base64url');
  await sql`INSERT INTO sys_session (user_id, token_hash, expires_at, current_company_id, current_branch_id, work_date, user_agent)
      VALUES (${u.id}, ${sha(token)}, now() + interval '10 minutes', ${d.company_id}, ${d.branch_id}, ${c.work_date ?? null}, ${'buddy-sync ' + d.code})`.execute(db);
  const key = randomBytes(24).toString('hex');
  replays.set(key, { deviceId: d.id, forceIds: c.created, docNo: c.doc_no ?? null });
  try {
    const res = await app.inject({ method: c.method, url: c.path, payload: c.body as object, headers: { cookie: `${SESSION_COOKIE}=${token}`, 'user-agent': 'buddy-sync', 'x-buddy-replay': key } });
    if (res.statusCode < 300) return { ok: true };
    let e: { code?: string; message?: string } = {};
    try { e = JSON.parse(res.body).error ?? {}; } catch { /* ไม่ใช่ JSON */ }
    return { ok: false, code: e.code ?? String(res.statusCode), message: e.message ?? `บันทึกไม่สำเร็จ (${res.statusCode})` };
  } finally {
    replays.delete(key);
    await sql`UPDATE sys_session SET ended_at = now() WHERE token_hash = ${sha(token)}`.execute(db);
  }
}
