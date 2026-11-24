import type { FastifyInstance, FastifyRequest } from 'fastify';
import { gunzipSync, gzipSync } from 'node:zlib';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { sql } from 'kysely';
import { z } from 'zod';
import { d } from '@buddy/core';
import type { Database, Db } from '../db.js';
import { AppError, badRequest, forbidden, parse, requireCompany, type AuthContext } from '../http.js';
import { logActivity } from '../audit.js';
import { applyPostingTemplate, seedLookups } from '../company-template.js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { REPO_ROOT } from '../config.js';

/**
 * สำรอง / ทดสอบ / นำข้อมูลสำรองมาใช้ รายบริษัท (คู่มือบทที่ 20 S-DM-02/03/04 · T0.15 รายลูกค้า) และข้อมูลผู้ใช้ (บทที่ 23 S-SEC-07/08)
 * แฟ้มสำรอง = gzip ของข้อความทีละบรรทัด: บรรทัดแรกเป็นหัวแฟ้ม (JSON) ต่อด้วย "ชื่อตาราง<TAB>แถวแบบ JSON" — แถวส่งกลับเข้า PostgreSQL ตรง ๆ (ตัวเลขทศนิยมไม่คลาด)
 * HANDOFF 146 (เจ้าของ 19/11/2569 "ทำทั้ง 4 ข้อ"):
 * - เข้ารหัสทั้งแฟ้มด้วยรหัสผ่านที่ผู้ใช้ตั้งตอนสำรอง (AES-256-GCM · กุญแจจาก scrypt ของรหัสผ่าน + salt) · แฟ้มเก่าที่ไม่เข้ารหัสยังนำกลับได้ (เตือน)
 * - นำกลับข้ามรุ่นโปรแกรมได้: แฟ้มจากรุ่นโครงสร้างข้อมูลเก่ากว่า → แทรกตามชื่อช่อง (ช่องใหม่ได้ค่าเริ่มต้น) แล้วทำขั้นปรับข้อมูลของ migration ที่ไม่ใช่การเพิ่มอย่างเดียว
 *   แฟ้มจากรุ่นใหม่กว่า = ปฏิเสธ (อัปเดตโปรแกรมก่อน)
 * - ตรวจหลังนำกลับในทรานแซกชันเดียวกัน: จำนวนแถวทุกตาราง + จำนวนใบสำคัญ/ยอดเดบิต/เครดิต เทียบแฟ้ม → ไม่ตรง = ยกเลิกทั้งหมด
 * นำกลับ: แทนที่ข้อมูลทุกตารางของบริษัทนี้ในทรานแซกชันเดียว (ไม่กระทบบริษัท/ลูกค้าอื่น) · แฟ้มบันทึกเหตุการณ์ไม่ถูกลบ (เพิ่มได้อย่างเดียว)
 */
type Ctx = AuthContext & { companyId: string };
const FORMAT = 'buddy-backup';
const USER_FORMAT = 'buddy-users';
/** ตารางที่ไม่สำรอง/ไม่แทนที่: บันทึกเหตุการณ์ (ห้ามลบ) · คิวซิงก์ · การเข้าระบบ · สิทธิ์ผู้ใช้ (อยู่ในแฟ้มสำรองผู้ใช้ S-SEC-07 แบบ Express) */
const SKIP = new Set(['sys_activity_log', 'sync_change_log', 'sync_inbox', 'sys_session', 'sys_api_key', 'sys_secret', 'sys_company', 'sys_user_company', 'sys_permission']);
const MAX_UPLOAD = 1024 * 1024 * 1024;
/** แฟ้มสำรองรุ่นแรกมีตั้งแต่โครงสร้างข้อมูล 0023 (T6.4 · 29/10/2569) — เก่ากว่านี้ไม่มีจริง */
const OLDEST_SCHEMA = 23;

async function companyTables(db: Db) {
  return (await sql<{ t: string }>`SELECT c.table_name AS t FROM information_schema.columns c JOIN information_schema.tables x ON x.table_name = c.table_name AND x.table_schema = c.table_schema
      WHERE c.table_schema = 'public' AND c.column_name = 'company_id' AND x.table_type = 'BASE TABLE' ORDER BY c.table_name`.execute(db)).rows.map((r) => r.t).filter((t) => !SKIP.has(t));
}
export async function schemaVersion(db: Db) {
  return (await sql<{ v: string | null }>`SELECT max(name) AS v FROM sys_schema_migration`.execute(db)).rows[0]?.v ?? '';
}
const ident = (t: string) => { if (!/^[a-z_][a-z0-9_]*$/.test(t)) throw badRequest(`ชื่อตารางในแฟ้มสำรองไม่ถูกต้อง: ${t}`); return sql.id(t); };
async function tableColumns(db: Db, table: string) {
  return (await sql<{ c: string }>`SELECT column_name AS c FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${table} ORDER BY ordinal_position`.execute(db)).rows.map((r) => r.c);
}

/* ───────────────────────── แฟ้มที่เข้ารหัส ───────────────────────── */
/** หัวแฟ้มเข้ารหัส: MAGIC · salt 16 · iv 12 · ค่าตรวจรหัสผ่าน 16 (HMAC ของกุญแจ — บอกได้ว่ารหัสผิด หรือแฟ้มเสีย) · tag 16 · ข้อมูล */
const MAGIC = Buffer.from('BUDDYBACKUP2');
const GZIP = Buffer.from([0x1f, 0x8b]);
export const BACKUP_PASSWORD_MIN = 8;
const keyOf = (pass: string, salt: Buffer) => scryptSync(pass.normalize('NFC'), salt, 32);
const checkOf = (key: Buffer) => createHmac('sha256', key).update('buddy-backup-password-check').digest().subarray(0, 16);
export function sealBackup(gz: Buffer, pass: string) {
  const salt = randomBytes(16), iv = randomBytes(12), key = keyOf(pass, salt);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(gz), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, checkOf(key), c.getAuthTag(), ct]);
}
export const isSealedBackup = (buf: Buffer) => buf.length > MAGIC.length + 60 && buf.subarray(0, MAGIC.length).equals(MAGIC);
export function unsealBackup(buf: Buffer, pass: string) {
  let o = MAGIC.length;
  const salt = buf.subarray(o, o += 16), iv = buf.subarray(o, o += 12), check = buf.subarray(o, o += 16), tag = buf.subarray(o, o += 16);
  const key = keyOf(pass, salt);
  if (!timingSafeEqual(checkOf(key), check)) throw new AppError(400, 'BACKUP_PASSWORD_WRONG', 'รหัสผ่านของแฟ้มสำรองไม่ถูกต้อง — ป้อนรหัสที่ตั้งไว้ตอนสำรอง (ตัวพิมพ์เล็ก/ใหญ่และภาษาต้องตรง)');
  try {
    const dc = createDecipheriv('aes-256-gcm', key, iv);
    dc.setAuthTag(tag);
    return Buffer.concat([dc.update(buf.subarray(o)), dc.final()]);
  } catch { throw badRequest('แฟ้มสำรองเสียหาย (รหัสผ่านถูกต้องแต่ข้อมูลในแฟ้มถูกแก้หรือไม่ครบ) — ใช้แฟ้มสำรองชุดอื่น'); }
}
/** เปิดแฟ้มที่อัปโหลด: เข้ารหัส = ต้องมีรหัสผ่าน · gzip เดิม = แฟ้มรุ่นก่อนที่ไม่เข้ารหัส (นำกลับได้ พร้อมคำเตือน) */
export function openBackup(buf: Buffer, pass: string | null, format: string) {
  if (isSealedBackup(buf)) {
    if (!pass) throw new AppError(400, 'BACKUP_PASSWORD_REQUIRED', 'แฟ้มสำรองนี้เข้ารหัสไว้ — ป้อนรหัสผ่านของแฟ้มที่ตั้งไว้ตอนสำรอง');
    return { ...readBackup(unsealBackup(buf, pass), format), encrypted: true };
  }
  if (!buf.subarray(0, 2).equals(GZIP)) throw badRequest('แฟ้มสำรองเสียหาย อ่านไม่ได้ (ไม่ใช่แฟ้ม .buddy ของ Buddy Account) — ใช้แฟ้มสำรองชุดอื่น');
  return { ...readBackup(buf, format), encrypted: false };
}
/** รหัสผ่านของแฟ้มส่งมาทางหัวคำขอ (ไม่อยู่ใน URL · ไม่บันทึกลง log) — encodeURIComponent เพื่อรองรับภาษาไทย */
function passOf(req: FastifyRequest) {
  const h = req.headers['x-backup-password'];
  if (typeof h !== 'string' || !h) return null;
  try { return decodeURIComponent(h); } catch { return h; }
}
/** ชื่อแฟ้มที่ผู้ใช้เลือก (ไว้บันทึกเหตุการณ์เท่านั้น) */
function fileNameOf(req: FastifyRequest) {
  const h = req.headers['x-backup-file'];
  if (typeof h !== 'string' || !h) return null;
  let s = h; try { s = decodeURIComponent(h); } catch { /* ใช้ตามที่ส่งมา */ }
  return s.replace(/[\u0000-\u001f]/g, '').slice(0, 120);
}
const passwordBody = z.object({ password: z.string().min(BACKUP_PASSWORD_MIN, `รหัสผ่านของแฟ้มสำรองต้องยาวอย่างน้อย ${BACKUP_PASSWORD_MIN} ตัวอักษร`).max(200, 'รหัสผ่านยาวเกินไป') });

/* ───────────────────────── อ่าน/เขียนแฟ้ม ───────────────────────── */
export type Totals = { journals: number; debit: string; credit: string };
export type Header = { format: string; version: number; created_at: string; schema: string; company: { id: string; code: string; name: string; tenant_id: string | null }; company_row?: string;
  tables: Record<string, number>; totals?: Totals; sha256: string };
/** อ่านและตรวจแฟ้มสำรอง (S-DM-03) — ไม่แตะฐานข้อมูล */
export function readBackup(buf: Buffer, format: string) {
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
  if (h.totals) {
    const f = totalsOfRows(rows);
    if (f.journals !== h.totals.journals || !d(f.debit).eq(h.totals.debit) || !d(f.credit).eq(h.totals.credit)) throw badRequest('แฟ้มสำรองไม่สมบูรณ์ (ยอดใบสำคัญในแฟ้มไม่ตรงกับหัวแฟ้ม) — ใช้แฟ้มสำรองชุดอื่น');
  }
  return { header: h, rows };
}
export function writeBackup(header: Omit<Header, 'sha256'>, lines: string[]) {
  const body = lines.length ? lines.join('\n') + '\n' : '';
  const h: Header = { ...header, sha256: createHash('sha256').update(body).digest('hex') };
  return gzipSync(Buffer.from(JSON.stringify(h) + '\n' + body, 'utf-8'), { level: 6 });
}
/** ยอดตรวจของบริษัท: จำนวนใบสำคัญ + ผลรวมเดบิต/เครดิต (ไม่นับที่ลบ) — คำนวณเหมือนกันทั้งในฐานและจากแถวในแฟ้ม */
export async function totalsOf(db: Db, companyId: string): Promise<Totals> {
  return (await sql<Totals>`SELECT (SELECT count(*)::int FROM gl_journal WHERE company_id = ${companyId} AND deleted_at IS NULL) AS journals,
      coalesce(sum(debit), 0)::text AS debit, coalesce(sum(credit), 0)::text AS credit FROM gl_journal_line WHERE company_id = ${companyId} AND deleted_at IS NULL`.execute(db)).rows[0]!;
}
export function totalsOfRows(rows: Map<string, string[]>): Totals {
  let journals = 0, debit = d(0), credit = d(0);
  for (const r of rows.get('gl_journal') ?? []) if (JSON.parse(r).deleted_at == null) journals++;
  for (const r of rows.get('gl_journal_line') ?? []) { const x = JSON.parse(r); if (x.deleted_at == null) { debit = debit.plus(x.debit ?? 0); credit = credit.plus(x.credit ?? 0); } }
  return { journals, debit: debit.toFixed(2), credit: credit.toFixed(2) };
}

/**
 * แทรกแถวจากแฟ้ม (ข้อความ JSON ส่งให้ PostgreSQL แปลงชนิดเอง) — ระบุชื่อช่องตามที่มีในแฟ้ม (แฟ้มรุ่นเก่า: ช่องที่เพิ่มภายหลังได้ค่าเริ่มต้นของช่อง ไม่ใช่ NULL)
 * companyId = บังคับ company_id ของทุกแถวเป็นบริษัทปัจจุบัน (กันข้อมูลข้ามบริษัทแม้แฟ้มถูกแก้)
 * guard = ปรับปรุงแถวที่มี id ซ้ำเฉพาะเมื่อแถวเดิมผ่านเงื่อนไข (เช่น เป็นของลูกค้ารายนี้) — ไม่ผ่านจะข้าม ไม่ทับข้อมูลรายอื่น
 */
export async function insertJson(tx: Db, table: string, rows: string[], opt: { companyId?: string; guard?: ReturnType<typeof sql> } = {}) {
  if (!rows.length) return;
  const have = await tableColumns(tx, table);
  const keys = new Set(Object.keys(JSON.parse(rows[0]!)));
  if (opt.companyId) keys.add('company_id');
  const cols = have.filter((c) => keys.has(c));
  const list = sql.join(cols.map((c) => sql.id(c)));
  for (let i = 0; i < rows.length; i += 2000) {
    const chunk = '[' + rows.slice(i, i + 2000).join(',') + ']';
    const src = opt.companyId
      ? sql`json_populate_recordset(NULL::${ident(table)}, (SELECT coalesce(jsonb_agg(e || jsonb_build_object('company_id', ${opt.companyId}::text)), '[]'::jsonb) FROM jsonb_array_elements(${chunk}::jsonb) e)::json)`
      : sql`json_populate_recordset(NULL::${ident(table)}, ${chunk}::json)`;
    if (!opt.guard) await sql`INSERT INTO ${ident(table)} (${list}) SELECT ${list} FROM ${src}`.execute(tx);
    else await sql`INSERT INTO ${ident(table)} AS cur (${list}) SELECT ${list} FROM ${src}
        ON CONFLICT (id) DO UPDATE SET ${sql.join(cols.filter((c) => c !== 'id').map((c) => sql`${sql.id(c)} = EXCLUDED.${sql.id(c)}`))} WHERE ${opt.guard}`.execute(tx);
  }
}

/* ───────────────────────── นำกลับข้ามรุ่น ───────────────────────── */
const numOf = (name: string) => { const m = /^(\d{4})_/.exec(name); return m ? Number(m[1]) : NaN; };
type Step = { n: number; name: string; run: (tx: Db, id: string) => Promise<unknown> };
/**
 * migration ที่ "ไม่ใช่การเพิ่มอย่างเดียว" (ตรวจทุกไฟล์ 0023–0067 แล้ว · HANDOFF 146) — ทำซ้ำกับข้อมูลของบริษัทที่นำกลับ เมื่อแฟ้มเก่ากว่า migration นั้น
 * migration อื่นเพิ่มตาราง/ช่องที่ว่างได้หรือมีค่าเริ่มต้นเท่ากับที่ให้แถวเดิม → แทรกตามชื่อช่องก็ถูกต้องแล้ว
 * เพิ่ม migration ใหม่ที่แปลงข้อมูลเดิม: ต้องเพิ่มขั้นที่นี่ (ชุดทดสอบตรวจว่าไฟล์ migration ที่มี UPDATE/DELETE/INSERT ข้อมูลบริษัทอยู่ในรายการ)
 */
export const COMPANY_STEPS: Step[] = [
  { n: 38, name: 'หมายเหตุรายบรรทัดย้ายเข้าบรรทัดเอกสาร', run: async (tx, id) => {
    await sql`UPDATE doc_line l SET line_note = x.t, line_note_print = true
      FROM (SELECT line_id, string_agg(text, E'\n' ORDER BY seq) AS t FROM doc_note WHERE company_id = ${id} AND line_id IS NOT NULL AND deleted_at IS NULL GROUP BY line_id) x
      WHERE l.id = x.line_id AND l.company_id = ${id}`.execute(tx);
    await sql`UPDATE doc_note SET deleted_at = now() WHERE company_id = ${id} AND line_id IS NOT NULL AND deleted_at IS NULL`.execute(tx);
  } },
  { n: 39, name: 'บัญชีมาตรฐาน ภ.พ.36 / ภาษีถูกหักเรียกคืน', run: (tx, id) => sql`INSERT INTO gl_default_account (company_id, role, account_id)
      SELECT a.company_id, x.role, a.id FROM gl_account a JOIN (VALUES ('PP36_PAYABLE', '2138-00', '%36%'), ('INPUT_VAT_PP36', '1157-00', '%รอเครดิต%'), ('WHT_RECOVERABLE', '1130-04', 'ลูกหนี้อื่น%')) AS x(role, no, name) ON x.no = a.account_no AND a.name_th LIKE x.name
      WHERE a.company_id = ${id} AND a.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM gl_default_account g WHERE g.company_id = a.company_id AND g.role = x.role AND g.deleted_at IS NULL)`.execute(tx) },
  { n: 50, name: 'มูลค่าภาษีของเอกสารราคารวม VAT', run: (tx, id) => sql`UPDATE tax_vat_entry v SET base_amount = v.base_amount - v.vat_amount FROM doc_header h
      WHERE v.company_id = ${id} AND h.id = v.header_id AND h.company_id = v.company_id AND h.price_type = '1' AND h.doc_class NOT IN ('RE', 'PS')
        AND v.vat_kind IN ('S', 'P') AND v.is_manual = false AND v.is_modified = false AND v.nonclaim_base = 0 AND v.vat_amount <> 0 AND v.base_amount = abs(h.taxable_amount)`.execute(tx) },
  { n: 53, name: 'ตารางข้อมูลตั้งต้น (คำนำหน้าชื่อ ตำแหน่ง …)', run: (tx, id) => seedLookups(tx, id) },
  { n: 55, name: 'ประเภทเอกสาร คืนเงินมัดจำ (RD)', run: (tx, id) => sql`INSERT INTO md_doc_type (id, company_id, code, doc_class, module, name_th, name_en, journal_book_id, is_tax_invoice)
      SELECT gen_random_uuid(), ${id}::uuid, 'RD', 'RD', 'AR', 'คืนเงินมัดจำ', 'Deposit Refund', (SELECT b.id FROM gl_journal_book b WHERE b.company_id = ${id} AND b.code = '01' AND b.deleted_at IS NULL LIMIT 1), false
      WHERE NOT EXISTS (SELECT 1 FROM md_doc_type t WHERE t.company_id = ${id} AND t.code = 'RD' AND t.deleted_at IS NULL)`.execute(tx) },
  { n: 56, name: 'VAT ของมัดจำที่คืน', run: (tx, id) => sql`UPDATE doc_link SET vat_amount = 0 WHERE company_id = ${id} AND link_type = 'DEPOSIT'
      AND to_header_id IN (SELECT h.id FROM doc_header h WHERE h.company_id = ${id} AND h.doc_class = 'RD')`.execute(tx) },
  // 0074 ประวัติที่อยู่ (HANDOFF 180): แฟ้มสำรองรุ่นก่อนไม่มีประวัติ → ที่อยู่ปัจจุบันเป็นแถวแรก (มีผลตั้งแต่ต้นปีบัญชีแรก)
  { n: 74, name: 'ประวัติที่อยู่ของกิจการ (แถวแรก = ที่อยู่ปัจจุบัน)', run: async (tx, id) => {
    await sql`INSERT INTO sys_address_history (company_id, branch_id, effective_from, address_th, address_en, zip_code, addr_no, addr_moo, addr_village, addr_building, addr_room, addr_floor, addr_soi, addr_road, addr_geo_code)
      SELECT c.id, NULL, coalesce((SELECT min(y.start_date) FROM gl_fiscal_year y WHERE y.company_id = c.id AND y.deleted_at IS NULL), c.created_at::date),
             c.address_th, c.address_en, c.zip_code, c.addr_no, c.addr_moo, c.addr_village, c.addr_building, c.addr_room, c.addr_floor, c.addr_soi, c.addr_road, c.addr_geo_code
        FROM sys_company c WHERE c.id = ${id} AND NOT EXISTS (SELECT 1 FROM sys_address_history h WHERE h.company_id = c.id AND h.branch_id IS NULL AND h.deleted_at IS NULL)`.execute(tx);
    await sql`INSERT INTO sys_address_history (company_id, branch_id, effective_from, address_th, zip_code, addr_no, addr_moo, addr_village, addr_building, addr_room, addr_floor, addr_soi, addr_road, addr_geo_code)
      SELECT b.company_id, b.id, coalesce((SELECT min(y.start_date) FROM gl_fiscal_year y WHERE y.company_id = b.company_id AND y.deleted_at IS NULL), b.created_at::date),
             b.address, b.zip_code, b.addr_no, b.addr_moo, b.addr_village, b.addr_building, b.addr_room, b.addr_floor, b.addr_soi, b.addr_road, b.addr_geo_code
        FROM sys_branch b WHERE b.company_id = ${id} AND b.deleted_at IS NULL AND NOT b.is_head_office AND coalesce(trim(b.address), '') <> ''
         AND NOT EXISTS (SELECT 1 FROM sys_address_history h WHERE h.branch_id = b.id AND h.deleted_at IS NULL)`.execute(tx);
  } },
];
/** แฟ้มสำรองผู้ใช้: 0060 คัดลอกสิทธิ์ ยอดยกมาลูกหนี้ → เงินมัดจำยกมา (ทำกับบริษัทของลูกค้ารายนี้) */
export const USER_STEPS: Step[] = [
  { n: 60, name: 'สิทธิ์เมนู บันทึกเงินมัดจำยกมา', run: (tx, tid) => sql`INSERT INTO sys_permission (company_id, subject_type, subject_id, menu_id, can_read, can_add, can_edit, can_cancel, can_delete, can_print, can_approve, created_by)
      SELECT p.company_id, p.subject_type, p.subject_id, dm.id, p.can_read, p.can_add, p.can_edit, p.can_cancel, p.can_delete, p.can_print, p.can_approve, p.created_by
        FROM sys_permission p JOIN sys_menu o ON o.id = p.menu_id AND o.code = 'FI.AR.OB' AND o.deleted_at IS NULL JOIN sys_menu dm ON dm.code = 'FI.AR.DOB' AND dm.deleted_at IS NULL
       WHERE p.deleted_at IS NULL AND p.company_id IN (SELECT id FROM sys_company WHERE tenant_id = ${tid})
         AND NOT EXISTS (SELECT 1 FROM sys_permission q WHERE q.company_id = p.company_id AND q.subject_type = p.subject_type AND q.subject_id = p.subject_id AND q.menu_id = dm.id AND q.deleted_at IS NULL)`.execute(tx) },
  { n: 68, name: 'คงสิทธิ์สำรองข้อมูลของผู้ใช้ระดับ 5–8', run: (tx, tid) => backupRightsStep(tx, tid) },
];
/** migration 0068 (คงสิทธิ์สำรอง/นำกลับของผู้ใช้เดิม) ทำซ้ำเฉพาะผู้ใช้ของลูกค้ารายนี้ — ใช้คำสั่งเดียวกับไฟล์ migration เพิ่มเงื่อนไขลูกค้า */
async function backupRightsStep(tx: Db, tid: string) {
  if (!/^[0-9a-f-]{36}$/i.test(tid)) throw badRequest('รหัสลูกค้าไม่ถูกต้อง');
  const text = await readFile(resolve(REPO_ROOT, 'db/migrations/0068_backup_rights_explicit.sql'), 'utf8');
  const marker = "AND coalesce(g.code, '') <> 'ADMIN'";
  const stmts = text.split(/\r?\n/).filter((l) => !l.startsWith('--')).join('\n').split(/;\s*(?:\n|$)/).map((x) => x.trim()).filter(Boolean);
  for (const st of stmts) {
    if (!st.includes(marker)) throw new Error('0068: รูปแบบคำสั่งเปลี่ยน');
    await sql.raw(st.replace(marker, `${marker} AND x.tenant_id = '${tid}'`)).execute(tx);
  }
}

export type SchemaPlan = { status: 'same' | 'older' | 'newer' | 'unknown' | 'too_old'; file: string; current: string; ok: boolean; message: string | null; steps: Step[] };
/** เทียบรุ่นโครงสร้างข้อมูลของแฟ้มกับระบบ → ขั้นที่ต้องปรับเมื่อแฟ้มเก่ากว่า */
export async function schemaPlan(db: Db, file: string, all: Step[]): Promise<SchemaPlan> {
  const current = await schemaVersion(db);
  const base = { file, current, steps: [] as Step[] };
  if (file === current) return { ...base, status: 'same', ok: true, message: null };
  const known = new Set((await sql<{ name: string }>`SELECT name FROM sys_schema_migration`.execute(db)).rows.map((r) => r.name));
  const fn = numOf(file), cn = numOf(current);
  if (Number.isFinite(fn) && fn > cn) return { ...base, status: 'newer', ok: false, message: `แฟ้มสำรองมาจากโปรแกรมรุ่นใหม่กว่า (โครงสร้างข้อมูล ${file}) แต่ระบบนี้เป็นรุ่น ${current} — อัปเดตโปรแกรมก่อน แล้วจึงนำข้อมูลกลับ` };
  if (!Number.isFinite(fn) || !known.has(file)) return { ...base, status: 'unknown', ok: false, message: `ระบบไม่รู้จักรุ่นโครงสร้างข้อมูลของแฟ้มนี้ (${file || '-'}) — ติดต่อผู้ให้บริการ` };
  if (fn < OLDEST_SCHEMA) return { ...base, status: 'too_old', ok: false, message: `แฟ้มสำรองรุ่นโครงสร้างข้อมูล ${file} เก่าเกินกว่าที่ระบบนำกลับได้ — ติดต่อผู้ให้บริการ` };
  return { ...base, status: 'older', ok: true, message: 'รุ่นเก่ากว่า — นำกลับได้ ระบบจะปรับให้อัตโนมัติ', steps: all.filter((s) => s.n > fn) };
}
/** ช่องข้อมูลของแฟ้มเทียบกับตารางปัจจุบัน: ตาราง/ช่องในแฟ้มที่ระบบไม่มีแล้ว = นำกลับไม่ได้ (ไม่เดาว่าย้ายไปไหน) · ตารางใหม่ที่แฟ้มไม่มี = ว่าง */
export async function columnProblems(db: Db, rows: Map<string, string[]>, allowed: string[]) {
  const problems: string[] = [];
  for (const [t, rs] of rows) {
    if (!allowed.includes(t)) { problems.push(`ตาราง ${t}`); continue; }
    const have = new Set(await tableColumns(db, t));
    const extra = Object.keys(JSON.parse(rs[0]!)).filter((c) => !have.has(c));
    if (extra.length) problems.push(`${t}: ${extra.join(', ')}`);
  }
  return problems.length ? `แฟ้มสำรองมีข้อมูลที่ระบบรุ่นนี้ไม่มีแล้ว (${problems.slice(0, 5).join(' · ')}${problems.length > 5 ? ' …' : ''}) — นำกลับไม่ได้ ติดต่อผู้ให้บริการ` : null;
}

const stamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');
const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, '_');
function bufferBody(req: { body: unknown }) {
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw badRequest('เลือกแฟ้มสำรองที่จะใช้');
  return req.body;
}
const sumRows = (rows: Map<string, string[]>) => [...rows.values()].reduce((s, r) => s + r.length, 0);

export function backupRoutes(app: FastifyInstance, database: Database) {
  const db = database.db;
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: MAX_UPLOAD }, (_req, body, done) => done(null, body));

  /** สำรองข้อมูลบริษัทปัจจุบัน → ดาวน์โหลดแฟ้ม YYYYMMDD-รหัสบริษัท.buddy เข้ารหัสด้วยรหัสผ่านที่ผู้ใช้ตั้ง (S-DM-02) */
  app.post('/api/v1/backup/company', async (req, reply) => {
    const a = requireCompany(req);
    const { password } = parse(passwordBody, req.body);
    // อ่านทุกตารางใน snapshot เดียว — ข้อมูลไม่ขาดตอนแม้มีผู้ใช้บันทึกเอกสารระหว่างสำรอง
    const { co, lines, tables, totals, schema } = await db.transaction().setIsolationLevel('repeatable read').execute(async (tx) => {
      const co = (await sql<{ id: string; code: string; name_th: string; tenant_id: string | null; j: string }>`SELECT id, code, name_th, tenant_id, to_json(c)::text AS j FROM sys_company c WHERE id = ${a.companyId}`.execute(tx)).rows[0]!;
      const lines: string[] = [];
      const tables: Record<string, number> = {};
      for (const t of await companyTables(tx)) {
        const rs = (await sql<{ j: string }>`SELECT to_json(x)::text AS j FROM ${ident(t)} x WHERE x.company_id = ${a.companyId}`.execute(tx)).rows;
        tables[t] = rs.length;
        for (const r of rs) lines.push(`${t}\t${r.j}`);
      }
      return { co, lines, tables, totals: await totalsOf(tx, a.companyId), schema: await schemaVersion(tx) };
    });
    const gz = writeBackup({ format: FORMAT, version: 2, created_at: new Date().toISOString(), schema,
      company: { id: co.id, code: co.code, name: co.name_th, tenant_id: co.tenant_id }, company_row: co.j, tables, totals }, lines);
    const buf = sealBackup(gz, password);
    const file = `${stamp()}-${safe(co.code)}.buddy`;
    await logActivity(db, a, { module: 'OT', action: 'BACKUP', docNo: co.code, table: 'sys_company', rowId: co.id, detail: { file, rows: lines.length, bytes: buf.length, encrypted: true, schema, journals: totals.journals } });
    reply.header('content-type', 'application/octet-stream').header('content-disposition', `attachment; filename="${file}"`);
    return buf;
  });

  /** ทดสอบแฟ้มสำรอง (S-DM-03): ตรวจความสมบูรณ์ แสดงบริษัท วันที่สำรอง จำนวนแถว รุ่นโครงสร้างข้อมูล — ไม่เปลี่ยนข้อมูล */
  app.post('/api/v1/backup/verify', { bodyLimit: MAX_UPLOAD }, async (req) => {
    const a = requireCompany(req);
    const { header, rows, encrypted } = openBackup(bufferBody(req), passOf(req), FORMAT);
    const plan = await schemaPlan(db, header.schema, COMPANY_STEPS);
    const cols = plan.ok ? await columnProblems(db, rows, await companyTables(db)) : null;
    const totals = header.totals ?? totalsOfRows(rows);
    return { company: header.company, created_at: header.created_at, schema: header.schema, current_schema: plan.current, schema_status: plan.status,
      schema_ok: plan.ok && !cols, schema_message: cols ?? plan.message, steps: plan.steps.map((s) => s.name), same_company: header.company.id === a.companyId,
      encrypted, rows: sumRows(rows), tables: header.tables, totals };
  });

  /** นำข้อมูลสำรองมาใช้ (S-DM-04): แทนที่ข้อมูลทั้งหมดของบริษัทปัจจุบันด้วยแฟ้มสำรองของบริษัทเดียวกัน */
  app.post('/api/v1/backup/restore', { bodyLimit: MAX_UPLOAD }, async (req) => {
    const a = requireCompany(req);
    const q = req.query as { confirm?: string };
    if ((q.confirm ?? '').toUpperCase() !== 'YES') throw badRequest('ป้อน YES เพื่อยืนยันการนำข้อมูลสำรองมาใช้ (ข้อมูลปัจจุบันของบริษัทนี้จะถูกแทนที่ทั้งหมด)');
    const { header, rows, encrypted } = openBackup(bufferBody(req), passOf(req), FORMAT);
    if (header.company.id !== a.companyId) throw badRequest(`แฟ้มสำรองนี้เป็นของบริษัท ${header.company.code} ${header.company.name} — เลือกบริษัทนั้นก่อนนำข้อมูลกลับ (นำข้อมูลข้ามบริษัทไม่ได้)`);
    const plan = await schemaPlan(db, header.schema, COMPANY_STEPS);
    if (!plan.ok) throw badRequest(plan.message!);
    const tables = await companyTables(db);
    const cols = await columnProblems(db, rows, tables);
    if (cols) throw badRequest(cols);
    const expected = header.totals ?? totalsOfRows(rows);
    const file = fileNameOf(req);
    const started = Date.now();
    const checks = await db.transaction().execute(async (tx) => {
      await sql`SET CONSTRAINTS ALL DEFERRED`.execute(tx);
      for (const t of tables) await sql`DELETE FROM ${ident(t)} WHERE company_id = ${a.companyId}`.execute(tx);
      for (const [t, rs] of rows) await insertJson(tx, t, rs, { companyId: a.companyId });
      if (header.company_row) await sql`UPDATE sys_company c SET name_th = r.name_th, name_en = r.name_en, address_th = r.address_th, address_en = r.address_en, phone = r.phone, tax_id = r.tax_id,
          trade_reg_no = r.trade_reg_no, year_system = r.year_system FROM json_populate_record(NULL::sys_company, ${header.company_row}::json) r WHERE c.id = ${a.companyId} AND r.id = c.id`.execute(tx);
      // ตรวจในทรานแซกชันเดียวกัน (ก่อนขั้นปรับข้อมูล): จำนวนแถวทุกตาราง + ใบสำคัญ/เดบิต/เครดิต ต้องเท่าแฟ้ม — ไม่ตรง = ยกเลิกทั้งหมด ข้อมูลเดิมไม่หาย
      const diff: string[] = [];
      for (const t of tables) {
        const n = (await sql<{ n: number }>`SELECT count(*)::int AS n FROM ${ident(t)} WHERE company_id = ${a.companyId}`.execute(tx)).rows[0]!.n;
        const want = rows.get(t)?.length ?? 0;
        if (n !== want) diff.push(`${t} ${want}→${n}`);
      }
      const got = await totalsOf(tx, a.companyId);
      if (diff.length) throw new AppError(409, 'RESTORE_CHECK_FAILED', `นำข้อมูลกลับแล้วจำนวนแถวไม่ตรงกับแฟ้ม (${diff.slice(0, 3).join(', ')}) — ยกเลิกแล้ว ข้อมูลเดิมยังอยู่ครบ ติดต่อผู้ให้บริการ`);
      if (got.journals !== expected.journals || !d(got.debit).eq(expected.debit) || !d(got.credit).eq(expected.credit))
        throw new AppError(409, 'RESTORE_CHECK_FAILED', `นำข้อมูลกลับแล้วยอดใบสำคัญไม่ตรงกับแฟ้ม (แฟ้ม ${expected.journals} ใบ เดบิต ${expected.debit} เครดิต ${expected.credit} · ได้ ${got.journals} ใบ ${got.debit} / ${got.credit}) — ยกเลิกแล้ว ข้อมูลเดิมยังอยู่ครบ`);
      for (const s of plan.steps) await s.run(tx, a.companyId);
      await logActivity(tx, a, { module: 'OT', action: 'RESTORE', docNo: header.company.code, table: 'sys_company', rowId: a.companyId,
        detail: { file, created_at: header.created_at, rows: sumRows(rows), encrypted, schema_from: header.schema, schema_to: plan.current, steps: plan.steps.map((s) => s.n), journals: got.journals } });
      return { tables: tables.length, rows: sumRows(rows), journals: got.journals, debit: got.debit, credit: got.credit, balanced: d(got.debit).eq(got.credit) };
    });
    // แฟ้มรุ่นเก่า: เติมกฎการลงบัญชีที่เพิ่มในรุ่นหลัง (เหมือนบริษัทใหม่ · ไม่ทับกฎเดิม) — หลังทรานแซกชันของคำขอ commit แล้ว
    // (execScript ใช้การเชื่อมต่ออื่น ถ้าทำระหว่างทรานแซกชันจะรอแถวที่คำขอนี้ล็อกไว้เอง)
    if (plan.status === 'older') (req as { afterCommit?: () => Promise<void> }).afterCommit = () => applyPostingTemplate(database.execScript, a.companyId);
    return { restored: header.company.code, created_at: header.created_at, rows: sumRows(rows), seconds: Math.round((Date.now() - started) / 100) / 10, encrypted,
      upgraded_from: plan.status === 'older' ? header.schema : null, steps: plan.steps.map((s) => s.name), checks };
  });

  // ---------------------------------------------------------------- ข้อมูลผู้ใช้งาน (S-SEC-07/08) ของลูกค้า (tenant) ปัจจุบัน
  const tenantOf = (a: Ctx) => { if (!a.isAdmin) throw forbidden('สำรอง/นำข้อมูลผู้ใช้กลับได้เฉพาะผู้ดูแลระบบ'); if (!a.tenantId) throw badRequest('บัญชีผู้ให้บริการไม่มีข้อมูลผู้ใช้ของลูกค้า — เข้าระบบด้วยผู้ดูแลของลูกค้า'); return a.tenantId; };
  app.post('/api/v1/backup/users', async (req, reply) => {
    const a = requireCompany(req);
    const tid = tenantOf(a);
    const { password } = parse(passwordBody, req.body);
    const parts: Array<[string, string[]]> = await db.transaction().setIsolationLevel('repeatable read').execute(async (tx) => [
      ['sys_user_group', (await sql<{ j: string }>`SELECT to_json(x)::text AS j FROM sys_user_group x WHERE x.tenant_id = ${tid}`.execute(tx)).rows.map((r) => r.j)],
      ['sys_user', (await sql<{ j: string }>`SELECT to_json(x)::text AS j FROM sys_user x WHERE x.tenant_id = ${tid}`.execute(tx)).rows.map((r) => r.j)],
      ['sys_user_company', (await sql<{ j: string }>`SELECT to_json(x)::text AS j FROM sys_user_company x WHERE x.user_id IN (SELECT id FROM sys_user WHERE tenant_id = ${tid})`.execute(tx)).rows.map((r) => r.j)],
      ['sys_permission', (await sql<{ j: string }>`SELECT to_json(x)::text AS j FROM sys_permission x WHERE x.company_id IN (SELECT id FROM sys_company WHERE tenant_id = ${tid})`.execute(tx)).rows.map((r) => r.j)],
    ] as Array<[string, string[]]>);
    const lines = parts.flatMap(([t, rs]) => rs.map((r) => `${t}\t${r}`));
    const co = await db.selectFrom('sys_company').select(['code', 'name_th']).where('id', '=', a.companyId).executeTakeFirstOrThrow();
    const gz = writeBackup({ format: USER_FORMAT, version: 2, created_at: new Date().toISOString(), schema: await schemaVersion(db), company: { id: a.companyId, code: co.code, name: co.name_th, tenant_id: tid },
      tables: Object.fromEntries(parts.map(([t, rs]) => [t, rs.length])) }, lines);
    const buf = sealBackup(gz, password);
    const file = `${stamp()}-users.buddy`;
    await logActivity(db, a, { module: 'SEC', action: 'BACKUP_USERS', detail: { file, encrypted: true, ...Object.fromEntries(parts.map(([t, rs]) => [t, rs.length])) } });
    reply.header('content-type', 'application/octet-stream').header('content-disposition', `attachment; filename="${file}"`);
    return buf;
  });
  /** นำข้อมูลผู้ใช้ที่สำรองไว้กลับ: ทับผู้ใช้/กลุ่ม/สิทธิ์ที่มีอยู่ด้วยค่าในแฟ้ม (รหัสผ่านกลับเป็นตอนสำรอง) เพิ่มรายการที่ถูกลบไป — ไม่ลบรายการที่สร้างหลังสำรอง */
  app.post('/api/v1/backup/users/restore', { bodyLimit: 50 * 1024 * 1024 }, async (req) => {
    const a = requireCompany(req);
    const tid = tenantOf(a);
    if (((req.query as { confirm?: string }).confirm ?? '').toUpperCase() !== 'YES') throw badRequest('ป้อน YES เพื่อยืนยัน — ข้อมูลผู้ใช้และรหัสผ่านจะกลับเป็นตามแฟ้มสำรอง');
    const { header, rows, encrypted } = openBackup(bufferBody(req), passOf(req), USER_FORMAT);
    if (header.company.tenant_id !== tid) throw badRequest('แฟ้มสำรองผู้ใช้นี้เป็นของลูกค้ารายอื่น นำมาใช้ไม่ได้');
    const plan = await schemaPlan(db, header.schema, USER_STEPS);
    if (!plan.ok) throw badRequest(plan.message!.replace('แฟ้มสำรอง', 'แฟ้มสำรองผู้ใช้'));
    const cols = await columnProblems(db, rows, ['sys_user_group', 'sys_user', 'sys_user_company', 'sys_permission']);
    if (cols) throw badRequest(cols);
    const companies = new Set((await db.selectFrom('sys_company').select('id').where('tenant_id', '=', tid).execute()).map((c) => c.id));
    const users = new Set((rows.get('sys_user') ?? []).map((r) => JSON.parse(r).id as string));
    for (const r of rows.get('sys_user') ?? []) if (JSON.parse(r).tenant_id !== tid) throw badRequest('แฟ้มสำรองผู้ใช้มีข้อมูลของลูกค้ารายอื่น');
    for (const r of rows.get('sys_user_group') ?? []) if (JSON.parse(r).tenant_id !== tid) throw badRequest('แฟ้มสำรองผู้ใช้มีข้อมูลของลูกค้ารายอื่น');
    for (const r of rows.get('sys_permission') ?? []) if (!companies.has(JSON.parse(r).company_id)) throw badRequest('แฟ้มสำรองผู้ใช้มีสิทธิ์ของบริษัทที่ไม่ใช่ของลูกค้านี้');
    for (const r of rows.get('sys_user_company') ?? []) { const x = JSON.parse(r); if (!users.has(x.user_id) || !companies.has(x.company_id)) throw badRequest('แฟ้มสำรองผู้ใช้มีการผูกบริษัทที่ไม่ถูกต้อง'); }
    const file = fileNameOf(req);
    await db.transaction().execute(async (tx) => {
      await sql`SET CONSTRAINTS ALL DEFERRED`.execute(tx);
      // กลุ่ม/ผู้ใช้: ทับตาม id เฉพาะแถวที่เป็นของลูกค้ารายนี้ · การผูกบริษัทและตารางสิทธิ์: แทนที่ทั้งชุดของลูกค้ารายนี้
      for (const t of ['sys_user_group', 'sys_user'] as const) if (rows.get(t)?.length) await insertJson(tx, t, rows.get(t)!, { guard: sql`cur.tenant_id = ${tid}` });
      await sql`DELETE FROM sys_user_company WHERE user_id IN (SELECT id FROM sys_user WHERE tenant_id = ${tid})`.execute(tx);
      await sql`DELETE FROM sys_permission WHERE company_id IN (SELECT id FROM sys_company WHERE tenant_id = ${tid})`.execute(tx);
      for (const t of ['sys_user_company', 'sys_permission']) if (rows.get(t)?.length) await insertJson(tx, t, rows.get(t)!);
      const diff: string[] = [];
      const count = async (t: string) => (await sql<{ n: number }>`SELECT count(*)::int AS n FROM ${ident(t)} WHERE ${t === 'sys_permission' ? sql`company_id IN (SELECT id FROM sys_company WHERE tenant_id = ${tid})` : sql`user_id IN (SELECT id FROM sys_user WHERE tenant_id = ${tid})`}`.execute(tx)).rows[0]!.n;
      for (const t of ['sys_user_company', 'sys_permission']) { const n = await count(t); if (n !== (rows.get(t)?.length ?? 0)) diff.push(`${t} ${rows.get(t)?.length ?? 0}→${n}`); }
      if (diff.length) throw new AppError(409, 'RESTORE_CHECK_FAILED', `นำข้อมูลผู้ใช้กลับแล้วจำนวนไม่ตรงกับแฟ้ม (${diff.join(', ')}) — ยกเลิกแล้ว ข้อมูลเดิมยังอยู่ครบ`);
      for (const s of plan.steps) await s.run(tx, tid);
      await logActivity(tx, a, { module: 'SEC', action: 'RESTORE_USERS', detail: { file, created_at: header.created_at, encrypted, schema_from: header.schema, ...Object.fromEntries([...rows].map(([t, r]) => [t, r.length])) } });
    });
    return { restored: Object.fromEntries([...rows].map(([t, r]) => [t, r.length])), created_at: header.created_at, encrypted, upgraded_from: plan.status === 'older' ? header.schema : null };
  });
}
