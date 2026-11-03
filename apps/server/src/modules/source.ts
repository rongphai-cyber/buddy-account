import type { FastifyReply, FastifyRequest } from 'fastify';
import { sql } from 'kysely';
import type { Database } from '../db.js';
import { AppError, requireCompany } from '../http.js';
import { logActivity } from '../audit.js';
import { periodFor } from './gl/journals.js';
import { branchStateOf } from './sync/branch.js';

/**
 * WTS Connect v1 (docs/17 ข้อ 3.1 · B0.1): เอกสารที่ระบบอื่น (WTS-POS WTS-Living WTS-SOP) ส่งเข้าผ่านกุญแจ API
 * header  X-Source-System (เช่น wts-pos) · X-Source-Ref (≤ 100 ตัว) · X-Source-Version (จำนวนเต็ม ค่าเริ่มต้น 1)
 *  - ยังไม่มีเอกสารเลขอ้างอิงนี้ → สร้าง ตอบ 201
 *  - มีแล้วรุ่นเท่ากัน → ตอบ 200 เอกสารเดิม (ไม่สร้างซ้ำ) · รุ่นสูงกว่า → แก้เอกสารเดิม (ใบสำคัญถูกแทน) · รุ่นต่ำกว่า → 409 STALE_VERSION
 *  - เอกสารที่มาจากระบบอื่น แก้/ยกเลิกที่หน้าจอ Buddy ไม่ได้ (ทำที่ต้นทาง) ยกเว้นผู้ใช้ระดับอนุมัติ 9 ยกเลิก/ลบได้พร้อมเหตุผล (บันทึก log)
 */
export type Source = { system: string; ref: string; version: number };
type Handler = (req: FastifyRequest, reply: FastifyReply) => unknown;

const H = { system: 'x-source-system', ref: 'x-source-ref', version: 'x-source-version' } as const;

/** ชื่อระบบที่แสดง: wts-pos → WTS-POS */
export const sourceLabel = (s: string) => s.toUpperCase();

const bad = (m: string) => new AppError(400, 'BAD_SOURCE', m);
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim();

export function sourceOf(req: FastifyRequest): Source | null {
  const sys = one(req.headers[H.system]), ref = one(req.headers[H.ref]), ver = one(req.headers[H.version]);
  if (!sys && !ref && !ver) return null;
  if (!req.auth?.apiKeyId) throw bad('ส่ง X-Source-* ได้เฉพาะคำขอที่ใช้กุญแจ API (docs/07) — หน้าจอ Buddy ไม่ต้องส่ง');
  if (!sys || !/^[a-z][a-z0-9-]{1,29}$/.test(sys)) throw bad('X-Source-System ต้องเป็นตัวพิมพ์เล็ก a-z ตัวเลข และ - ยาว 2–30 ตัว เช่น wts-pos');
  if (!ref || ref.length > 100) throw bad('X-Source-Ref ต้องมีค่าและยาวไม่เกิน 100 ตัวอักษร เช่น pos:BK01:2026-10-15:HS');
  const version = ver === undefined || ver === '' ? 1 : Number(ver);
  if (!Number.isInteger(version) || version < 1 || version > 2147483647) throw bad('X-Source-Version ต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป');
  return { system: sys, ref, version };
}

type Found = { table: 'doc_header' | 'gl_journal'; id: string; no: string; date: string; status: string; version: number; system: string; ref: string; cancel_reason: string | null };

async function findById(database: Database, companyId: string, id: string): Promise<Found | null> {
  const db = database.db;
  const h = await db.selectFrom('doc_header').select(['id', 'doc_no as no', 'doc_date as date', 'doc_status as status', 'source_system', 'source_ref', 'source_version', 'cancel_reason'])
    .where('id', '=', id).where('company_id', '=', companyId).where('deleted_at', 'is', null).executeTakeFirst();
  const j = h ? null : await db.selectFrom('gl_journal').select(['id', 'voucher_no as no', 'voucher_date as date', 'doc_status as status', 'source_system', 'source_ref', 'source_version', sql<string | null>`NULL`.as('cancel_reason')])
    .where('id', '=', id).where('company_id', '=', companyId).where('deleted_at', 'is', null).executeTakeFirst();
  const r = h ?? j;
  if (!r?.source_system) return null;
  return { table: h ? 'doc_header' : 'gl_journal', id: r.id, no: r.no, date: String(r.date).slice(0, 10), status: r.status, version: r.source_version ?? 1, system: r.source_system, ref: r.source_ref ?? '', cancel_reason: r.cancel_reason ?? null };
}

async function findBySource(database: Database, companyId: string, s: Source): Promise<Found | null> {
  const db = database.db;
  const h = await db.selectFrom('doc_header').select(['id', 'doc_no as no', 'doc_date as date', 'doc_status as status', 'source_version', 'cancel_reason'])
    .where('company_id', '=', companyId).where('source_system', '=', s.system).where('source_ref', '=', s.ref).where('deleted_at', 'is', null).executeTakeFirst();
  const j = h ? null : await db.selectFrom('gl_journal').select(['id', 'voucher_no as no', 'voucher_date as date', 'doc_status as status', 'source_version', sql<string | null>`NULL`.as('cancel_reason')])
    .where('company_id', '=', companyId).where('source_system', '=', s.system).where('source_ref', '=', s.ref).where('deleted_at', 'is', null).executeTakeFirst();
  const r = h ?? j;
  if (!r) return null;
  return { table: h ? 'doc_header' : 'gl_journal', id: r.id, no: r.no, date: String(r.date).slice(0, 10), status: r.status, version: r.source_version ?? 1, system: s.system, ref: s.ref, cancel_reason: r.cancel_reason ?? null };
}

async function stamp(database: Database, companyId: string, table: 'doc_header' | 'gl_journal', id: string, s: Source) {
  const set = { source_system: s.system, source_ref: s.ref, source_version: s.version };
  try {
    const r = table === 'doc_header'
      ? await database.db.updateTable('doc_header').set(set).where('id', '=', id).where('company_id', '=', companyId).where('deleted_at', 'is', null).executeTakeFirst()
      : await database.db.updateTable('gl_journal').set(set).where('id', '=', id).where('company_id', '=', companyId).where('deleted_at', 'is', null).executeTakeFirst();
    return Number(r.numUpdatedRows) > 0;
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new AppError(409, 'DUPLICATE_SOURCE', `เลขอ้างอิง ${s.ref} ถูกส่งเข้ามาพร้อมกันสองครั้ง — ส่งใหม่อีกครั้ง (ระบบจะตอบเอกสารเดิม)`);
    throw e;
  }
}

const periodClosed = (s: Source) => new AppError(409, 'PERIOD_CLOSED', `เอกสารอ้างอิง ${s.ref} อยู่ในงวดที่ปิดแล้ว แก้ย้อนหลังไม่ได้ — ส่งเป็นเอกสารปรับปรุงด้วยเลขอ้างอิงใหม่ในงวดที่เปิดอยู่`);

/** API ที่แก้เนื้อหา/ยอดไม่ได้ แต่ทำกับเอกสารจากระบบอื่นได้ (พิมพ์ · หนังสือรับรองที่ได้รับ · ลงบัญชีใหม่ตามค่าตั้ง · คัดลอกเป็นใบใหม่) */
const FREE = /\/(printed|wht-cert|repost|copy|posting-preview)$/;
const CANCEL = /\/cancel$|^POST \/api\/v1\/docs\/:kind\/:id\/delete$/;

/** เอกสารจากระบบอื่น: หน้าจอ/ระบบอื่นแก้ ยกเลิก ลบ ไม่ได้ — ต้องทำที่ระบบต้นทาง (ส่ง X-Source-System เดียวกัน) */
async function guardLocked(database: Database, req: FastifyRequest, routeKey: string, src: Source | null) {
  const id = (req.params as { id?: unknown } | undefined)?.id;
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id) || FREE.test(routeKey)) return;
  const a = requireCompany(req);
  const f = await findById(database, a.companyId, id);
  if (!f || src?.system === f.system) return;
  if (CANCEL.test(routeKey) && a.approvalLevel >= 9) {
    await logActivity(database.db, a, { module: 'SOURCE', action: 'SOURCE_OVERRIDE', docNo: f.no, table: f.table, rowId: f.id, detail: { route: routeKey, source_system: f.system, source_ref: f.ref, reason: (req.body as { reason?: unknown } | undefined)?.reason ?? null } });
    return;
  }
  throw new AppError(403, 'SOURCE_LOCKED', `เอกสาร ${f.no} มาจาก ${sourceLabel(f.system)} (อ้างอิง ${f.ref}) — แก้หรือยกเลิกที่โปรแกรม ${sourceLabel(f.system)} · ผู้ใช้ระดับอนุมัติ 9 ยกเลิกได้โดยระบุเหตุผล`);
}

/**
 * ครอบตัวจัดการ API ข้อมูลบริษัท (ในทรานแซกชันของคำขอ — permissions.ts): ตรวจเอกสารจากระบบอื่น + ส่งซ้ำไม่ลงซ้ำ
 * handlers = ตัวจัดการเดิมของทุก API (ใช้เรียก PUT …/:id ตอนรุ่นสูงกว่า) · authorize = ตรวจสิทธิ์ของ API นั้น
 */
export async function withSource(database: Database, req: FastifyRequest, reply: FastifyReply, routeKey: string, call: () => unknown,
  handlers: Map<string, { handler: Handler; self: unknown }>, authorize: (req: FastifyRequest, method: string, url: string) => Promise<void>) {
  const [method, url] = routeKey.split(' ') as [string, string];
  if (method === 'GET' || method === 'HEAD') return call();
  const src = sourceOf(req);
  if (src && branchStateOf(database)) throw bad('เครื่องสาขาไม่รับเอกสารจากระบบอื่น — ส่งเข้าเครื่องสำนักงานใหญ่');
  await guardLocked(database, req, routeKey, src);
  if (!src || method !== 'POST' || url.includes(':')) return call();

  const a = requireCompany(req);
  const ex = await findBySource(database, a.companyId, src);
  if (ex) {
    const res = { id: ex.id, [ex.table === 'doc_header' ? 'doc_no' : 'voucher_no']: ex.no, source_system: src.system, source_ref: src.ref };
    if (ex.status === 'C') throw new AppError(409, 'SOURCE_CANCELLED', `เอกสาร ${ex.no} (อ้างอิง ${src.ref}) ถูกยกเลิกใน Buddy แล้ว${ex.cancel_reason ? ` — ${ex.cancel_reason}` : ''} · ให้ผู้ดูแลลบเอกสารที่ยกเลิกใน Buddy ก่อน หรือส่งด้วยเลขอ้างอิงใหม่`);
    if (src.version === ex.version) { reply.code(200); return { ...res, source_version: ex.version, duplicate: true }; }
    if (src.version < ex.version) throw new AppError(409, 'STALE_VERSION', `เอกสาร ${ex.no} (อ้างอิง ${src.ref}) เป็นรุ่น ${ex.version} แล้ว — รุ่น ${src.version} ที่ส่งมาเก่ากว่า ไม่บันทึก`);
    // รุ่นสูงกว่า → แก้เอกสารเดิมด้วย API แก้ไขของเอกสารชนิดนั้น (ใบสำคัญถูกแทนตามปกติ)
    const putKey = `PUT ${url}/:id`;
    const put = handlers.get(putKey);
    if (!put) throw new AppError(409, 'SOURCE_NO_EDIT', `เอกสารชนิดนี้แก้ผ่าน API ไม่ได้ — ยกเลิกเอกสาร ${ex.no} ที่ต้นทางแล้วส่งด้วยเลขอ้างอิงใหม่`);
    await authorize(req, 'PUT', `${url}/:id`);
    try { await periodFor(database.db, a.companyId, ex.date); } catch (e) { if ((e as AppError).code === 'PERIOD_LOCKED') throw periodClosed(src); throw e; }
    (req as { params: unknown }).params = { id: ex.id };
    let out: unknown;
    try { out = await put.handler.call(put.self, req, reply); } catch (e) { if ((e as AppError).code === 'PERIOD_LOCKED') throw periodClosed(src); throw e; }
    await stamp(database, a.companyId, ex.table, ex.id, src);
    reply.code(200);
    return { ...(out as object), ...res, source_version: src.version, updated: true };
  }
  const out = await call() as { id?: unknown } | null;
  const id = typeof out?.id === 'string' ? out.id : null;
  if (!id || !((await stamp(database, a.companyId, 'doc_header', id, src)) || (await stamp(database, a.companyId, 'gl_journal', id, src)))) {
    throw bad(`API ${url} ไม่ได้สร้างเอกสารหรือใบสำคัญ จึงรับ X-Source-* ไม่ได้ — ส่งเฉพาะ API สร้างเอกสาร/ใบสำคัญ`);
  }
  reply.code(201);
  return { ...out, source_system: src.system, source_ref: src.ref, source_version: src.version };
}
