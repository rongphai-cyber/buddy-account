import type { FastifyInstance } from 'fastify';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { sql, type RawBuilder } from 'kysely';
import { z } from 'zod';
import type { Db } from '../db.js';
import { AppError, badRequest, forbidden, notFound, parse, requireAuth } from '../http.js';
import { logActivity } from '../audit.js';
import { decryptSecret, encryptSecret } from '../secret.js';
import { insertJson, readBackup, schemaVersion, writeBackup, type Header } from './backup.js';

/**
 * T0.18 ย้ายลูกค้าผู้ใช้บริการไปเซิร์ฟเวอร์/ฐานข้อมูลแยก (ลูกค้ารายใหญ่)
 * ไม่ต้องแก้โค้ดส่วนอื่น: ติดตั้ง Buddy Account อีกชุดที่ใช้ฐานข้อมูลของตัวเอง แล้วย้ายข้อมูลของลูกค้ารายนั้นด้วยแฟ้ม .buddy-tenant
 * แฟ้ม = ลูกค้า กลุ่มผู้ใช้ ผู้ใช้ (รหัสผ่านเดิม 2FA เดิม) ทุกบริษัทและทุกตารางของบริษัท แฟ้มบันทึกเหตุการณ์ — เข้ารหัสทั้งแฟ้มด้วยรหัสผ่านที่ตั้งตอนส่งออก (AES-256-GCM + scrypt)
 * ค่าลับที่เข้ารหัสด้วยกุญแจของเครื่องแม่ข่าย (กุญแจ 2FA, กุญแจ AI) ถอดก่อนใส่แฟ้ม แล้วเข้ารหัสใหม่ด้วยกุญแจของเครื่องปลายทาง
 * ปลายทาง: ผู้ใช้ที่ไม่ได้อยู่ในลูกค้ารายนี้ (เช่น เจ้าหน้าที่ผู้ให้บริการที่เคยแก้ข้อมูล) ไม่มีในฐานใหม่ → ช่องผู้ทำรายการเป็นว่าง · สิทธิ์รายเมนูจับคู่ด้วยรหัสเมนู
 * ต้นทาง: บันทึก "ย้ายไปที่" แล้วผู้ใช้เข้าระบบเดิมไม่ได้ (บอกที่อยู่ใหม่) และลบข้อมูลเดิมได้ทันทีด้วยการลบของ T0.17
 */
const FORMAT = 'buddy-tenant';
const MAGIC = Buffer.from('BUDDYTENANT1');
const MAX_FILE = 1024 * 1024 * 1024;
/** ตารางรายบริษัทที่ไม่ย้าย: คิวซิงก์ของเครื่องลูก (ซิงก์ใหม่กับเซิร์ฟเวอร์ใหม่) · แฟ้มบันทึกเหตุการณ์ย้ายแยก (ไม่เอาลำดับเดิม) */
const SKIP = new Set(['sync_change_log', 'sync_inbox', 'sync_conflict', 'sys_activity_log']);
const passSchema = z.string().min(12, 'รหัสผ่านของแฟ้มต้องยาวอย่างน้อย 12 ตัวอักษร (แฟ้มมีข้อมูลทั้งหมดของลูกค้า)').max(200);

type Obj = Record<string, unknown>;
type TenantHeader = { format: string; version: number; created_at: string; schema: string; pull_seq?: number; tenant: { id: string; code: string; name: string };
  companies: Array<{ id: string; code: string; name: string; journals: number; debit: string; credit: string }>; tables: Record<string, number>; sha256: string };
const rows = async <T = Obj>(db: Db, q: RawBuilder<unknown>) => (await q.execute(db)).rows as T[];
const texts = (xs: string[]) => sql.join((xs.length ? xs : ['']).map((x) => sql`${x}`));
const ids = (xs: string[]) => sql.join((xs.length ? xs : ['00000000-0000-0000-0000-000000000000']).map((x) => sql`${x}::uuid`));

export function seal(gz: Buffer, pass: string) {
  const salt = randomBytes(16), iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', scryptSync(pass, salt, 32), iv);
  const ct = Buffer.concat([c.update(gz), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), ct]);
}
export function unseal(buf: Buffer, pass: string) {
  if (buf.length < MAGIC.length + 44 || !buf.subarray(0, MAGIC.length).equals(MAGIC)) throw badRequest('ไม่ใช่แฟ้มย้ายลูกค้าของ Buddy Account (.buddy-tenant)');
  let o = MAGIC.length;
  const salt = buf.subarray(o, o += 16), iv = buf.subarray(o, o += 12), tag = buf.subarray(o, o += 16);
  try {
    const d = createDecipheriv('aes-256-gcm', scryptSync(pass, salt, 32), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(buf.subarray(o)), d.final()]);
  } catch { throw badRequest('รหัสผ่านของแฟ้มไม่ถูกต้อง หรือแฟ้มเสียหาย'); }
}

async function companyTables(db: Db) {
  return (await rows<{ t: string }>(db, sql`SELECT c.table_name AS t FROM information_schema.columns c JOIN information_schema.tables x ON x.table_name = c.table_name AND x.table_schema = c.table_schema
      WHERE c.table_schema = 'public' AND c.column_name = 'company_id' AND x.table_type = 'BASE TABLE' AND c.table_name <> 'sys_company' ORDER BY c.table_name`)).map((r) => r.t).filter((t) => !SKIP.has(t));
}
/** ยอดตรวจรายบริษัท: จำนวนใบสำคัญ + ผลรวมเดบิต/เครดิต (ไม่นับที่ลบ) — คำนวณเหมือนกันทั้งต้นทางและปลายทาง */
async function checksOf(db: Db, companyId: string) {
  return (await rows<{ journals: number; debit: string; credit: string }>(db, sql`SELECT (SELECT count(*)::int FROM gl_journal WHERE company_id = ${companyId} AND deleted_at IS NULL) AS journals,
      coalesce(sum(debit), 0)::text AS debit, coalesce(sum(credit), 0)::text AS credit FROM gl_journal_line WHERE company_id = ${companyId} AND deleted_at IS NULL`))[0]!;
}

/**
 * ส่งออกลูกค้าหนึ่งราย → แฟ้มที่เข้ารหัสแล้ว (อ่านในทรานแซกชันเดียว ข้อมูลไม่ขาดตอน)
 * companyIds = เฉพาะบางบริษัท (T7.8 ตั้งเครื่องสาขา) · pull_seq = ลำดับ sync_change_log ล่าสุด ณ เวลาส่งออก (เครื่องสาขาดึงต่อจากนี้)
 */
export async function exportTenant(db: Db, tenantId: string, pass: string, opt: { companyIds?: string[] } = {}) {
  return db.transaction().setIsolationLevel('repeatable read').execute(async (tx) => {
    const tenant = (await rows<Obj>(tx, sql`SELECT to_jsonb(t) AS j FROM sys_tenant t WHERE id = ${tenantId} AND deleted_at IS NULL`))[0]?.j as Obj | undefined;
    if (!tenant) throw notFound('ลูกค้าผู้ใช้บริการ');
    if (tenant.purged_at) throw badRequest('ลบข้อมูลของลูกค้ารายนี้ไปแล้ว — ไม่มีข้อมูลให้ย้าย');
    const lines: string[] = [];
    const tables: Record<string, number> = {};
    const put = (t: string, rs: Obj[]) => { tables[t] = (tables[t] ?? 0) + rs.length; for (const r of rs) lines.push(`${t}\t${JSON.stringify(r)}`); };
    const all = async (q: RawBuilder<unknown>) => (await rows<{ j: Obj }>(tx, q)).map((r) => r.j);
    put('sys_tenant', [tenant]);
    put('sys_user_group', await all(sql`SELECT to_jsonb(x) AS j FROM sys_user_group x WHERE tenant_id = ${tenantId}`));
    const users = await all(sql`SELECT to_jsonb(x) AS j FROM sys_user x WHERE tenant_id = ${tenantId}`);
    put('sys_user', users);
    const userIds = users.map((u) => String(u.id));
    // กุญแจ 2FA: ถอดรหัสด้วยกุญแจของเครื่องนี้ (ถอดไม่ได้ = ผู้ใช้ตั้ง 2FA ใหม่ที่ปลายทาง)
    put('sys_user_security', (await all(sql`SELECT to_jsonb(x) AS j FROM sys_user_security x WHERE user_id IN (${ids(userIds)})`)).map((r) => {
      const plain = typeof r.totp_secret_enc === 'string' ? decryptSecret(r.totp_secret_enc) : null;
      return { ...r, totp_secret_enc: null, _totp_plain: plain, ...(plain ? {} : { totp_enabled: false }) };
    }));
    const only = opt.companyIds ? sql`AND id IN (${ids(opt.companyIds)})` : sql``;
    const companies = await all(sql`SELECT to_jsonb(x) AS j FROM sys_company x WHERE tenant_id = ${tenantId} ${only}`);
    put('sys_company', companies);
    const cids = companies.map((c) => String(c.id));
    const menus = new Map((await rows<{ id: string; code: string }>(tx, sql`SELECT id, code FROM sys_menu`)).map((m) => [m.id, m.code]));
    for (const t of await companyTables(tx)) {
      let rs = await all(sql`SELECT to_jsonb(x) AS j FROM ${sql.id(t)} x WHERE company_id IN (${ids(cids)})`);
      if (t === 'sys_permission') rs = rs.map((r) => ({ ...r, _menu_code: menus.get(String(r.menu_id)) ?? null }));
      if (t === 'sys_secret') rs = rs.map((r) => ({ ...r, value_enc: '', _plain: decryptSecret(String(r.value_enc)) }));
      if (rs.length) put(t, rs);
    }
    put('sys_activity_log', await all(sql`SELECT to_jsonb(x) - 'seq' AS j FROM sys_activity_log x
        WHERE company_id IN (${ids(cids)}) OR (company_id IS NULL AND user_id IN (${ids(userIds)})) ORDER BY seq`));
    const pullSeq = Number((await rows<{ s: string | null }>(tx, sql`SELECT max(seq)::text AS s FROM sync_change_log WHERE company_id IN (${ids(cids)})`))[0]?.s ?? 0);
    const header = { format: FORMAT, version: 1, created_at: new Date().toISOString(), schema: await schemaVersion(tx), pull_seq: pullSeq,
      tenant: { id: tenantId, code: String(tenant.code), name: String(tenant.name) },
      companies: await Promise.all(companies.map(async (c) => ({ id: String(c.id), code: String(c.code), name: String(c.name_th), ...(await checksOf(tx, String(c.id))) }))), tables };
    const gz = writeBackup(header as unknown as Omit<Header, 'sha256'>, lines);
    return { file: seal(gz, pass), header, rows: lines.length };
  });
}

/** นำเข้าแฟ้มย้ายลูกค้า (ฐานข้อมูลปลายทาง) — ทรานแซกชันเดียว · ซ้ำกับข้อมูลที่มีอยู่ = ไม่นำเข้าเลย */
export async function importTenant(db: Db, buf: Buffer, pass: string, userId: string | null) {
  const { header: h0, rows: data } = readBackup(unseal(buf, pass), FORMAT);
  const h = h0 as unknown as TenantHeader;
  const current = await schemaVersion(db);
  if (h.schema !== current) throw badRequest(`แฟ้มมาจากโปรแกรมรุ่นโครงสร้างข้อมูล ${h.schema || '-'} แต่เครื่องนี้เป็น ${current} — อัปเดตโปรแกรมทั้งสองเครื่องให้เป็นรุ่นเดียวกันก่อน`);
  const parsed = new Map([...data].map(([t, rs]) => [t, rs.map((r) => JSON.parse(r) as Obj)]));
  const get = (t: string) => parsed.get(t) ?? [];
  const tables = new Set(await companyTables(db));
  const unknown = [...parsed.keys()].filter((t) => !tables.has(t) && !['sys_tenant', 'sys_user_group', 'sys_user', 'sys_user_security', 'sys_company', 'sys_activity_log'].includes(t));
  if (unknown.length) throw badRequest(`แฟ้มมีตารางที่เครื่องนี้ไม่รู้จัก: ${unknown.join(', ')}`);
  for (const t of get('sys_user')) if (t.tenant_id !== h.tenant.id) throw badRequest('แฟ้มมีผู้ใช้ของลูกค้ารายอื่น');
  for (const c of get('sys_company')) if (c.tenant_id !== h.tenant.id) throw badRequest('แฟ้มมีบริษัทของลูกค้ารายอื่น');
  const cids = get('sys_company').map((c) => String(c.id));
  for (const [t, rs] of parsed) if (tables.has(t)) for (const r of rs) if (!cids.includes(String(r.company_id))) throw badRequest(`แฟ้มมีข้อมูลของบริษัทที่ไม่อยู่ในลูกค้ารายนี้ (${t})`);

  // ซ้ำกับที่มีอยู่ในเครื่องนี้
  const users = get('sys_user');
  const userIds = users.map((u) => String(u.id));
  const clash: string[] = [];
  if ((await rows(db, sql`SELECT 1 FROM sys_tenant WHERE id = ${h.tenant.id} OR (code = ${h.tenant.code} AND deleted_at IS NULL)`)).length) clash.push(`ลูกค้า ${h.tenant.code}`);
  for (const r of await rows<{ code: string }>(db, sql`SELECT code FROM sys_company WHERE id IN (${ids(cids)}) OR (deleted_at IS NULL AND code IN (${texts(get('sys_company').map((c) => String(c.code)))}))`)) clash.push(`บริษัท ${r.code}`);
  const names = users.filter((u) => !u.deleted_at).map((u) => String(u.username));
  for (const r of await rows<{ username: string }>(db, sql`SELECT username FROM sys_user WHERE id IN (${ids(userIds)}) OR (deleted_at IS NULL AND username IN (${texts(names)}))`)) clash.push(`ผู้ใช้ ${r.username}`);
  if (clash.length) throw new AppError(409, 'TENANT_EXISTS', `เครื่องนี้มีข้อมูลซ้ำกับแฟ้มแล้ว: ${[...new Set(clash)].join(', ')} — นำเข้าซ้ำไม่ได้ (ถ้าเป็นการลองครั้งก่อน ให้ลบลูกค้านั้นก่อน)`);

  // ช่องที่อ้างผู้ใช้ (created_by, approved_by …) ที่ไม่ใช่ผู้ใช้ของลูกค้ารายนี้ → ว่าง
  const fkUser = await rows<{ t: string; c: string }>(db, sql`SELECT src.relname AS t, a.attname AS c FROM pg_constraint k JOIN pg_class src ON src.oid = k.conrelid
      JOIN pg_class dst ON dst.oid = k.confrelid JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1] WHERE k.contype = 'f' AND dst.relname = 'sys_user'`);
  const keep = new Set(userIds);
  let cleared = 0;
  for (const { t, c } of fkUser) for (const r of get(t)) if (r[c] && !keep.has(String(r[c]))) { r[c] = null; cleared++; }
  const menus = new Map((await rows<{ id: string; code: string }>(db, sql`SELECT id, code FROM sys_menu WHERE deleted_at IS NULL`)).map((m) => [m.code, m.id]));
  if (parsed.has('sys_permission')) parsed.set('sys_permission', get('sys_permission').filter((r) => menus.has(String(r._menu_code))).map((r) => ({ ...r, menu_id: menus.get(String(r._menu_code)) })));
  if (parsed.has('sys_user_security')) parsed.set('sys_user_security', get('sys_user_security').map((r) => ({ ...r, totp_secret_enc: r._totp_plain ? encryptSecret(String(r._totp_plain)) : null })));
  if (parsed.has('sys_secret')) parsed.set('sys_secret', get('sys_secret').filter((r) => r._plain).map((r) => ({ ...r, value_enc: encryptSecret(String(r._plain)) })));

  const started = Date.now();
  const counts: Record<string, number> = {};
  await db.transaction().execute(async (tx) => {
    await sql`SET CONSTRAINTS ALL DEFERRED`.execute(tx);
    await sql`SELECT set_config('app.allow_locked_period', 'on', true)`.execute(tx);
    const order = ['sys_tenant', 'sys_user_group', 'sys_user', 'sys_user_security', 'sys_company', ...[...parsed.keys()].filter((t) => tables.has(t)).sort()];
    for (const t of order) {
      const rs = get(t);
      if (!rs.length) continue;
      await insertJson(tx, t, rs.map((r) => JSON.stringify(r)));
      counts[t] = rs.length;
    }
    // แฟ้มบันทึกเหตุการณ์: ต่อท้ายตามลำดับเดิม ลำดับที่ (seq) ของเครื่องนี้
    const logs = get('sys_activity_log');
    const cols = (await rows<{ c: string }>(tx, sql`SELECT column_name AS c FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sys_activity_log' AND column_name <> 'seq' ORDER BY ordinal_position`)).map((r) => sql.id(r.c));
    for (let i = 0; i < logs.length; i += 2000) {
      const chunk = JSON.stringify(logs.slice(i, i + 2000));
      await sql`INSERT INTO sys_activity_log (${sql.join(cols)}) SELECT ${sql.join(cols)} FROM json_populate_recordset(NULL::sys_activity_log, ${chunk}::json)`.execute(tx);
    }
    counts.sys_activity_log = logs.length;
    await sql`SELECT set_config('app.allow_locked_period', 'off', true)`.execute(tx);
    await logActivity(tx, { companyId: null, userId }, { module: 'SYS', action: 'IMPORT_TENANT', docNo: h.tenant.code, table: 'sys_tenant', rowId: h.tenant.id,
      detail: { exported_at: h.created_at, companies: h.companies.map((c) => c.code), rows: Object.values(counts).reduce((s, n) => s + n, 0) } });
  });
  // ตรวจหลังนำเข้า: ใบสำคัญและยอดเดบิต/เครดิตรายบริษัทต้องเท่าต้นทาง
  const checks = await Promise.all(h.companies.map(async (c) => {
    const now = await checksOf(db, c.id);
    return { code: c.code, name: c.name, source: { journals: c.journals, debit: c.debit, credit: c.credit }, target: now,
      ok: now.journals === c.journals && Number(now.debit) === Number(c.debit) && Number(now.credit) === Number(c.credit) };
  }));
  return { tenant: h.tenant, companies: h.companies.map((c) => ({ id: c.id, code: c.code })), pull_seq: h.pull_seq ?? 0, exported_at: h.created_at, counts, users_cleared: cleared, checks, ok: checks.every((c) => c.ok), seconds: Math.round((Date.now() - started) / 100) / 10 };
}

export function tenantMoveRoutes(app: FastifyInstance, db: Db) {
  const requirePlatform = (req: Parameters<typeof requireAuth>[0]) => { const a = requireAuth(req); if (!a.isPlatform) throw forbidden('เฉพาะเจ้าหน้าที่ผู้ให้บริการโปรแกรม'); return a; };
  /** ส่งออกลูกค้าเป็นแฟ้มย้าย (ดาวน์โหลด) */
  app.post('/api/v1/tenants/:id/export', async (req, reply) => {
    const a = requirePlatform(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const { passphrase } = parse(z.object({ passphrase: passSchema }), req.body);
    const r = await exportTenant(db, id, passphrase);
    await logActivity(db, a, { module: 'SYS', action: 'EXPORT_TENANT', docNo: r.header.tenant.code, table: 'sys_tenant', rowId: id, detail: { rows: r.rows, bytes: r.file.length, companies: r.header.companies.map((c) => c.code) } });
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    reply.header('content-type', 'application/octet-stream').header('content-disposition', `attachment; filename="${stamp}-${r.header.tenant.code.replace(/[^A-Za-z0-9_-]+/g, '_')}.buddy-tenant"`);
    return r.file;
  });
  /** นำเข้าแฟ้มย้ายลูกค้า (เนื้อแฟ้มดิบ) — รหัสผ่านของแฟ้มส่งใน header x-buddy-passphrase (ไม่ใส่ใน URL) */
  app.post('/api/v1/tenants/import', { bodyLimit: MAX_FILE }, async (req) => {
    const a = requirePlatform(req);
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw badRequest('เลือกแฟ้ม .buddy-tenant ที่จะนำเข้า');
    const pass = parse(passSchema, req.headers['x-buddy-passphrase'] ? decodeURIComponent(String(req.headers['x-buddy-passphrase'])) : '');
    return importTenant(db, req.body, pass, a.userId);
  });
}
