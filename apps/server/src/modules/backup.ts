import type { FastifyInstance } from 'fastify';
import { gunzipSync, gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import type { Db } from '../db.js';
import { badRequest, forbidden, requireCompany, type AuthContext } from '../http.js';
import { logActivity } from '../audit.js';

/**
 * สำรอง / ทดสอบ / นำข้อมูลสำรองมาใช้ รายบริษัท (คู่มือบทที่ 20 S-DM-02/03/04 · T0.15 รายลูกค้า) และข้อมูลผู้ใช้ (บทที่ 23 S-SEC-07/08)
 * แฟ้มสำรอง = gzip ของข้อความทีละบรรทัด: บรรทัดแรกเป็นหัวแฟ้ม (JSON) ต่อด้วย "ชื่อตาราง<TAB>แถวแบบ JSON" — แถวส่งกลับเข้า PostgreSQL ตรง ๆ (ตัวเลขทศนิยมไม่คลาด)
 * นำกลับ: แทนที่ข้อมูลทุกตารางของบริษัทนี้ในทรานแซกชันเดียว (ไม่กระทบบริษัท/ลูกค้าอื่น) · แฟ้มบันทึกเหตุการณ์ไม่ถูกลบ (เพิ่มได้อย่างเดียว)
 */
type Ctx = AuthContext & { companyId: string };
const FORMAT = 'buddy-backup';
const USER_FORMAT = 'buddy-users';
/** ตารางที่ไม่สำรอง/ไม่แทนที่: บันทึกเหตุการณ์ (ห้ามลบ) · คิวซิงก์ · การเข้าระบบ · สิทธิ์ผู้ใช้ (อยู่ในแฟ้มสำรองผู้ใช้ S-SEC-07 แบบ Express) */
const SKIP = new Set(['sys_activity_log', 'sync_change_log', 'sync_inbox', 'sys_session', 'sys_api_key', 'sys_secret', 'sys_company', 'sys_user_company', 'sys_permission']);
const MAX_UPLOAD = 1024 * 1024 * 1024;

async function companyTables(db: Db) {
  return (await sql<{ t: string }>`SELECT c.table_name AS t FROM information_schema.columns c JOIN information_schema.tables x ON x.table_name = c.table_name AND x.table_schema = c.table_schema
      WHERE c.table_schema = 'public' AND c.column_name = 'company_id' AND x.table_type = 'BASE TABLE' ORDER BY c.table_name`.execute(db)).rows.map((r) => r.t).filter((t) => !SKIP.has(t));
}
async function schemaVersion(db: Db) {
  return (await sql<{ v: string | null }>`SELECT max(name) AS v FROM sys_schema_migration`.execute(db)).rows[0]?.v ?? '';
}
const ident = (t: string) => { if (!/^[a-z_][a-z0-9_]*$/.test(t)) throw badRequest(`ชื่อตารางในแฟ้มสำรองไม่ถูกต้อง: ${t}`); return sql.id(t); };

type Header = { format: string; version: number; created_at: string; schema: string; company: { id: string; code: string; name: string; tenant_id: string | null }; company_row?: string; tables: Record<string, number>; sha256: string };
/** อ่านและตรวจแฟ้มสำรอง (S-DM-03) — ไม่แตะฐานข้อมูล */
function readBackup(buf: Buffer, format: string) {
  let text: string;
  try { text = gunzipSync(buf).toString('utf-8'); } catch { throw badRequest('แฟ้มสำรองเสียหาย อ่านไม่ได้ (พบเครื่องหมายจบแฟ้มที่ไม่สมบูรณ์) — ใช้แฟ้มสำรองชุดอื่น'); }
  const nl = text.indexOf('\n');
  let h: Header;
  try { h = JSON.parse(nl < 0 ? text : text.slice(0, nl)); } catch { throw badRequest('ไม่ใช่แฟ้มสำรองของ Buddy Account'); }
  if (h.format !== format) throw badRequest(format === FORMAT ? 'แฟ้มนี้ไม่ใช่แฟ้มสำรองข้อมูลบริษัท' : 'แฟ้มนี้ไม่ใช่แฟ้มสำรองข้อมูลผู้ใช้งาน');
  const body = nl < 0 ? '' : text.slice(nl + 1);
  if (createHash('sha256').update(body).digest('hex') !== h.sha256) throw badRequest('แฟ้มสำรองไม่สมบูรณ์ (ข้อมูลไม่ตรงกับที่บันทึกไว้) — ใช้แฟ้มสำรองชุดอื่น');
  const rows = new Map<string, string[]>();
  for (const line of body.split('\n')) {
    if (!line) continue;
    const tab = line.indexOf('\t');
    const t = line.slice(0, tab);
    if (!rows.has(t)) rows.set(t, []);
    rows.get(t)!.push(line.slice(tab + 1));
  }
  for (const [t, n] of Object.entries(h.tables)) if ((rows.get(t)?.length ?? 0) !== n) throw badRequest(`แฟ้มสำรองไม่สมบูรณ์: ตาราง ${t} มี ${rows.get(t)?.length ?? 0} แถว แต่หัวแฟ้มระบุ ${n}`);
  return { header: h, rows };
}
function writeBackup(header: Omit<Header, 'sha256'>, lines: string[]) {
  const body = lines.length ? lines.join('\n') + '\n' : '';
  const h: Header = { ...header, sha256: createHash('sha256').update(body).digest('hex') };
  return gzipSync(Buffer.from(JSON.stringify(h) + '\n' + body, 'utf-8'), { level: 6 });
}
/**
 * แทรกแถวจากแฟ้ม (ข้อความ JSON ส่งให้ PostgreSQL แปลงชนิดเอง) · companyId = บังคับ company_id ของทุกแถวเป็นบริษัทปัจจุบัน (กันข้อมูลข้ามบริษัทแม้แฟ้มถูกแก้)
 * guard = ปรับปรุงแถวที่มี id ซ้ำเฉพาะเมื่อแถวเดิมผ่านเงื่อนไข (เช่น เป็นของลูกค้ารายนี้) — ไม่ผ่านจะข้าม ไม่ทับข้อมูลรายอื่น
 */
async function insertJson(tx: Db, table: string, rows: string[], opt: { companyId?: string; guard?: ReturnType<typeof sql> } = {}) {
  const cols = opt.guard ? (await sql<{ c: string }>`SELECT column_name AS c FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${table} ORDER BY ordinal_position`.execute(tx)).rows.map((r) => r.c) : [];
  for (let i = 0; i < rows.length; i += 2000) {
    const chunk = '[' + rows.slice(i, i + 2000).join(',') + ']';
    const src = opt.companyId
      ? sql`json_populate_recordset(NULL::${ident(table)}, (SELECT coalesce(jsonb_agg(e || jsonb_build_object('company_id', ${opt.companyId}::text)), '[]'::jsonb) FROM jsonb_array_elements(${chunk}::jsonb) e)::json)`
      : sql`json_populate_recordset(NULL::${ident(table)}, ${chunk}::json)`;
    if (!opt.guard) await sql`INSERT INTO ${ident(table)} SELECT * FROM ${src}`.execute(tx);
    else await sql`INSERT INTO ${ident(table)} AS cur SELECT * FROM ${src}
        ON CONFLICT (id) DO UPDATE SET ${sql.join(cols.filter((c) => c !== 'id').map((c) => sql`${sql.id(c)} = EXCLUDED.${sql.id(c)}`))} WHERE ${opt.guard}`.execute(tx);
  }
}
const stamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');
const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, '_');
function bufferBody(req: { body: unknown }) {
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw badRequest('เลือกแฟ้มสำรองที่จะใช้');
  return req.body;
}

export function backupRoutes(app: FastifyInstance, db: Db) {
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: MAX_UPLOAD }, (_req, body, done) => done(null, body));

  /** สำรองข้อมูลบริษัทปัจจุบัน → ดาวน์โหลดแฟ้ม YYYYMMDD-รหัสบริษัท.buddy (S-DM-02) */
  app.get('/api/v1/backup/company', async (req, reply) => {
    const a = requireCompany(req);
    const co = (await sql<{ id: string; code: string; name_th: string; tenant_id: string | null; j: string }>`SELECT id, code, name_th, tenant_id, to_json(c)::text AS j FROM sys_company c WHERE id = ${a.companyId}`.execute(db)).rows[0]!;
    const lines: string[] = [];
    const tables: Record<string, number> = {};
    for (const t of await companyTables(db)) {
      const rs = (await sql<{ j: string }>`SELECT to_json(x)::text AS j FROM ${ident(t)} x WHERE x.company_id = ${a.companyId}`.execute(db)).rows;
      tables[t] = rs.length;
      for (const r of rs) lines.push(`${t}\t${r.j}`);
    }
    const buf = writeBackup({ format: FORMAT, version: 1, created_at: new Date().toISOString(), schema: await schemaVersion(db),
      company: { id: co.id, code: co.code, name: co.name_th, tenant_id: co.tenant_id }, company_row: co.j, tables }, lines);
    await logActivity(db, a, { module: 'OT', action: 'BACKUP', docNo: co.code, table: 'sys_company', rowId: co.id, detail: { rows: lines.length, bytes: buf.length } });
    reply.header('content-type', 'application/gzip').header('content-disposition', `attachment; filename="${stamp()}-${safe(co.code)}.buddy"`);
    return buf;
  });

  /** ทดสอบแฟ้มสำรอง (S-DM-03): ตรวจความสมบูรณ์ แสดงบริษัท วันที่สำรอง จำนวนแถว — ไม่เปลี่ยนข้อมูล */
  app.post('/api/v1/backup/verify', { bodyLimit: MAX_UPLOAD }, async (req) => {
    const a = requireCompany(req);
    const { header, rows } = readBackup(bufferBody(req), FORMAT);
    const current = await schemaVersion(db);
    return { company: header.company, created_at: header.created_at, schema: header.schema, schema_ok: header.schema === current, same_company: header.company.id === a.companyId,
      rows: [...rows.values()].reduce((s, r) => s + r.length, 0), tables: header.tables };
  });

  /** นำข้อมูลสำรองมาใช้ (S-DM-04): แทนที่ข้อมูลทั้งหมดของบริษัทปัจจุบันด้วยแฟ้มสำรองของบริษัทเดียวกัน */
  app.post('/api/v1/backup/restore', { bodyLimit: MAX_UPLOAD }, async (req) => {
    const a = requireCompany(req);
    const q = req.query as { confirm?: string };
    if ((q.confirm ?? '').toUpperCase() !== 'YES') throw badRequest('ป้อน YES เพื่อยืนยันการนำข้อมูลสำรองมาใช้ (ข้อมูลปัจจุบันของบริษัทนี้จะถูกแทนที่ทั้งหมด)');
    const { header, rows } = readBackup(bufferBody(req), FORMAT);
    if (header.company.id !== a.companyId) throw badRequest(`แฟ้มสำรองนี้เป็นของบริษัท ${header.company.code} ${header.company.name} — เลือกบริษัทนั้นก่อนนำข้อมูลกลับ (นำข้อมูลข้ามบริษัทไม่ได้)`);
    const current = await schemaVersion(db);
    if (header.schema !== current) throw badRequest(`แฟ้มสำรองมาจากโปรแกรมรุ่นโครงสร้างข้อมูล ${header.schema || '-'} แต่ระบบปัจจุบันเป็น ${current} — ใช้แฟ้มสำรองที่ทำจากรุ่นเดียวกัน`);
    const tables = await companyTables(db);
    const unknown = [...rows.keys()].filter((t) => !tables.includes(t));
    if (unknown.length) throw badRequest(`แฟ้มสำรองมีตารางที่ระบบไม่รู้จัก: ${unknown.join(', ')}`);
    const started = Date.now();
    await db.transaction().execute(async (tx) => {
      await sql`SET CONSTRAINTS ALL DEFERRED`.execute(tx);
      for (const t of tables) await sql`DELETE FROM ${ident(t)} WHERE company_id = ${a.companyId}`.execute(tx);
      for (const [t, rs] of rows) await insertJson(tx, t, rs, { companyId: a.companyId });
      if (header.company_row) await sql`UPDATE sys_company c SET name_th = r.name_th, name_en = r.name_en, address_th = r.address_th, address_en = r.address_en, phone = r.phone, tax_id = r.tax_id,
          trade_reg_no = r.trade_reg_no, year_system = r.year_system FROM json_populate_record(NULL::sys_company, ${header.company_row}::json) r WHERE c.id = ${a.companyId} AND r.id = c.id`.execute(tx);
      await logActivity(tx, a, { module: 'OT', action: 'RESTORE', docNo: header.company.code, table: 'sys_company', rowId: a.companyId, detail: { created_at: header.created_at, rows: [...rows.values()].reduce((s, r) => s + r.length, 0) } });
    });
    return { restored: header.company.code, created_at: header.created_at, rows: [...rows.values()].reduce((s, r) => s + r.length, 0), seconds: Math.round((Date.now() - started) / 100) / 10 };
  });

  // ---------------------------------------------------------------- ข้อมูลผู้ใช้งาน (S-SEC-07/08) ของลูกค้า (tenant) ปัจจุบัน
  const tenantOf = (a: Ctx) => { if (!a.isAdmin) throw forbidden('สำรอง/นำข้อมูลผู้ใช้กลับได้เฉพาะผู้ดูแลระบบ'); if (!a.tenantId) throw badRequest('บัญชีผู้ให้บริการไม่มีข้อมูลผู้ใช้ของลูกค้า — เข้าระบบด้วยผู้ดูแลของลูกค้า'); return a.tenantId; };
  app.get('/api/v1/backup/users', async (req, reply) => {
    const a = requireCompany(req);
    const tid = tenantOf(a);
    const parts: Array<[string, string[]]> = [
      ['sys_user_group', (await sql<{ j: string }>`SELECT to_json(x)::text AS j FROM sys_user_group x WHERE x.tenant_id = ${tid}`.execute(db)).rows.map((r) => r.j)],
      ['sys_user', (await sql<{ j: string }>`SELECT to_json(x)::text AS j FROM sys_user x WHERE x.tenant_id = ${tid}`.execute(db)).rows.map((r) => r.j)],
      ['sys_user_company', (await sql<{ j: string }>`SELECT to_json(x)::text AS j FROM sys_user_company x WHERE x.user_id IN (SELECT id FROM sys_user WHERE tenant_id = ${tid})`.execute(db)).rows.map((r) => r.j)],
      ['sys_permission', (await sql<{ j: string }>`SELECT to_json(x)::text AS j FROM sys_permission x WHERE x.company_id IN (SELECT id FROM sys_company WHERE tenant_id = ${tid})`.execute(db)).rows.map((r) => r.j)],
    ];
    const lines = parts.flatMap(([t, rs]) => rs.map((r) => `${t}\t${r}`));
    const co = await db.selectFrom('sys_company').select(['code', 'name_th']).where('id', '=', a.companyId).executeTakeFirstOrThrow();
    const buf = writeBackup({ format: USER_FORMAT, version: 1, created_at: new Date().toISOString(), schema: await schemaVersion(db), company: { id: a.companyId, code: co.code, name: co.name_th, tenant_id: tid },
      tables: Object.fromEntries(parts.map(([t, rs]) => [t, rs.length])) }, lines);
    await logActivity(db, a, { module: 'SEC', action: 'BACKUP_USERS', detail: Object.fromEntries(parts.map(([t, rs]) => [t, rs.length])) });
    reply.header('content-type', 'application/gzip').header('content-disposition', `attachment; filename="${stamp()}-users.buddy"`);
    return buf;
  });
  /** นำข้อมูลผู้ใช้ที่สำรองไว้กลับ: ทับผู้ใช้/กลุ่ม/สิทธิ์ที่มีอยู่ด้วยค่าในแฟ้ม (รหัสผ่านกลับเป็นตอนสำรอง) เพิ่มรายการที่ถูกลบไป — ไม่ลบรายการที่สร้างหลังสำรอง */
  app.post('/api/v1/backup/users/restore', { bodyLimit: 50 * 1024 * 1024 }, async (req) => {
    const a = requireCompany(req);
    const tid = tenantOf(a);
    if (((req.query as { confirm?: string }).confirm ?? '').toUpperCase() !== 'YES') throw badRequest('ป้อน YES เพื่อยืนยัน — ข้อมูลผู้ใช้และรหัสผ่านจะกลับเป็นตามแฟ้มสำรอง');
    const { header, rows } = readBackup(bufferBody(req), USER_FORMAT);
    if (header.company.tenant_id !== tid) throw badRequest('แฟ้มสำรองผู้ใช้นี้เป็นของลูกค้ารายอื่น นำมาใช้ไม่ได้');
    if (header.schema !== await schemaVersion(db)) throw badRequest('แฟ้มสำรองผู้ใช้มาจากโปรแกรมรุ่นอื่น — ใช้แฟ้มที่ทำจากรุ่นเดียวกัน');
    const companies = new Set((await db.selectFrom('sys_company').select('id').where('tenant_id', '=', tid).execute()).map((c) => c.id));
    const users = new Set((rows.get('sys_user') ?? []).map((r) => JSON.parse(r).id as string));
    for (const r of rows.get('sys_user') ?? []) if (JSON.parse(r).tenant_id !== tid) throw badRequest('แฟ้มสำรองผู้ใช้มีข้อมูลของลูกค้ารายอื่น');
    for (const r of rows.get('sys_user_group') ?? []) if (JSON.parse(r).tenant_id !== tid) throw badRequest('แฟ้มสำรองผู้ใช้มีข้อมูลของลูกค้ารายอื่น');
    for (const r of rows.get('sys_permission') ?? []) if (!companies.has(JSON.parse(r).company_id)) throw badRequest('แฟ้มสำรองผู้ใช้มีสิทธิ์ของบริษัทที่ไม่ใช่ของลูกค้านี้');
    for (const r of rows.get('sys_user_company') ?? []) { const x = JSON.parse(r); if (!users.has(x.user_id) || !companies.has(x.company_id)) throw badRequest('แฟ้มสำรองผู้ใช้มีการผูกบริษัทที่ไม่ถูกต้อง'); }
    await db.transaction().execute(async (tx) => {
      await sql`SET CONSTRAINTS ALL DEFERRED`.execute(tx);
      // กลุ่ม/ผู้ใช้: ทับตาม id เฉพาะแถวที่เป็นของลูกค้ารายนี้ · การผูกบริษัทและตารางสิทธิ์: แทนที่ทั้งชุดของลูกค้ารายนี้
      for (const t of ['sys_user_group', 'sys_user'] as const) if (rows.get(t)?.length) await insertJson(tx, t, rows.get(t)!, { guard: sql`cur.tenant_id = ${tid}` });
      await sql`DELETE FROM sys_user_company WHERE user_id IN (SELECT id FROM sys_user WHERE tenant_id = ${tid})`.execute(tx);
      await sql`DELETE FROM sys_permission WHERE company_id IN (SELECT id FROM sys_company WHERE tenant_id = ${tid})`.execute(tx);
      for (const t of ['sys_user_company', 'sys_permission']) if (rows.get(t)?.length) await insertJson(tx, t, rows.get(t)!);
      await logActivity(tx, a, { module: 'SEC', action: 'RESTORE_USERS', detail: Object.fromEntries([...rows].map(([t, r]) => [t, r.length])) });
    });
    return { restored: Object.fromEntries([...rows].map(([t, r]) => [t, r.length])), created_at: header.created_at };
  });
}
