import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Db } from '../db.js';
import { badRequest, notFound, parse, requireCompany } from '../http.js';
import { logActivity } from '../audit.js';

/**
 * หมายเหตุเพิ่มเติม (Alt+R) — เอกสาร: ระดับเอกสารและรายบรรทัดสินค้า (คู่มือ S-SL-02 / S-PU-C2) · แฟ้มหลัก: สินค้า 10 บรรทัด ลูกค้า/ผู้จำหน่าย 5 บรรทัด (S-MF-02)
 * พิมพ์ออกในแบบฟอร์มเอกสาร (ส่วน "หมายเหตุ") · เอกสารที่ยกเลิกแล้วแก้หมายเหตุไม่ได้
 */
const uuid = z.string().uuid();
const lines = (max: number) => z.array(z.string().trim().max(200)).max(max).transform((xs) => xs.map((x) => x.trim()).filter(Boolean));
export const ENTITY = { item: { type: 'ITEM', table: 'md_item', max: 10, menu: 'IC.ITEM' }, customer: { type: 'CUSTOMER', table: 'md_customer', max: 5, menu: 'SA.CUS' }, supplier: { type: 'SUPPLIER', table: 'md_supplier', max: 5, menu: 'PU.SUP' } } as const;

export function noteRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/v1/notes/:kind/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ kind: z.literal('doc'), id: uuid }), req.params);
    const h = await db.selectFrom('doc_header').select(['doc_no', 'doc_status']).where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!h) throw notFound('เอกสาร');
    const notes = (await sql<{ line_id: string | null; text: string }>`SELECT line_id, text FROM doc_note WHERE header_id = ${id} AND company_id = ${a.companyId} AND deleted_at IS NULL ORDER BY seq`.execute(db)).rows;
    const ls = (await sql<{ id: string; line_no: number; code: string | null; name: string | null }>`SELECT l.id, l.line_no, coalesce(i.code, g.account_no) AS code, l.description AS name FROM doc_line l
        LEFT JOIN md_item i ON i.id = l.item_id LEFT JOIN gl_account g ON g.id = l.account_id WHERE l.header_id = ${id} AND l.deleted_at IS NULL AND l.line_kind <> 'K' ORDER BY l.line_no`.execute(db)).rows;
    return { doc_no: h.doc_no, editable: h.doc_status !== 'C', doc: notes.filter((n) => !n.line_id).map((n) => n.text),
      lines: ls.map((l) => ({ line_id: l.id, line_no: l.line_no, code: l.code, name: l.name, notes: notes.filter((n) => n.line_id === l.id).map((n) => n.text) })) };
  });
  app.put('/api/v1/notes/:kind/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ kind: z.literal('doc'), id: uuid }), req.params);
    const b = parse(z.object({ doc: lines(20).default([]), lines: z.record(uuid, lines(10)).default({}) }), req.body);
    const h = await db.selectFrom('doc_header').select(['doc_no', 'doc_status']).where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!h) throw notFound('เอกสาร');
    if (h.doc_status === 'C') throw badRequest('เอกสารถูกยกเลิกแล้ว แก้หมายเหตุไม่ได้');
    const own = new Set((await db.selectFrom('doc_line').select('id').where('header_id', '=', id).where('deleted_at', 'is', null).execute()).map((l) => l.id));
    const bad = Object.keys(b.lines).find((l) => !own.has(l));
    if (bad) throw badRequest('บรรทัดที่ระบุไม่อยู่ในเอกสารนี้');
    await db.transaction().execute(async (tx) => {
      await tx.deleteFrom('doc_note').where('header_id', '=', id).where('company_id', '=', a.companyId).execute();
      const rows = [...b.doc.map((text, i) => ({ line_id: null as string | null, seq: i + 1, text })), ...Object.entries(b.lines).flatMap(([line_id, xs]) => xs.map((text, i) => ({ line_id, seq: i + 1, text })))];
      if (rows.length) await tx.insertInto('doc_note').values(rows.map((r) => ({ ...r, header_id: id, company_id: a.companyId, created_by: a.userId, updated_by: a.userId }))).execute();
      await logActivity(tx, a, { module: 'DOC', action: 'EDIT_NOTES', docNo: h.doc_no, table: 'doc_note', rowId: id, detail: { lines: rows.length } });
    });
    return { ok: true };
  });

  /** สถานะเอกสารตามตารางข้อมูล: ใบเสนอราคา (ตาราง 44 · S-QT-01) · ใบจ่าย/ใบเบิกเงินสดย่อย (ตาราง 53 · S-GL-11) */
  const STATUS_TABLE: Record<string, string> = { QT: '44', DP: '53', VR: '53' };
  app.get('/api/v1/doc-status/:kind/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ kind: z.literal('doc'), id: uuid }), req.params);
    const h = await db.selectFrom('doc_header').select(['doc_class', 'status_code']).where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!h) throw notFound('เอกสาร');
    const table = STATUS_TABLE[h.doc_class] ?? null;
    const options = table ? await db.selectFrom('md_lookup').select(['code', 'name_th']).where('company_id', '=', a.companyId).where('type_code', '=', table).where('deleted_at', 'is', null).orderBy('code').execute() : [];
    return { table, status_code: h.status_code, options };
  });
  app.put('/api/v1/doc-status/:kind/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ kind: z.literal('doc'), id: uuid }), req.params);
    const { status_code } = parse(z.object({ status_code: z.string().trim().max(10).nullable().transform((v) => v || null) }), req.body);
    const h = await db.selectFrom('doc_header').select(['doc_no', 'doc_class', 'status_code']).where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!h) throw notFound('เอกสาร');
    const table = STATUS_TABLE[h.doc_class];
    if (!table) throw badRequest('เอกสารชนิดนี้ไม่มีสถานะตามตารางข้อมูล');
    if (status_code && !(await db.selectFrom('md_lookup').select('id').where('company_id', '=', a.companyId).where('type_code', '=', table).where('code', '=', status_code).where('deleted_at', 'is', null).executeTakeFirst()))
      throw badRequest(`ไม่พบสถานะ ${status_code} ในตารางข้อมูล ${table} — เพิ่มที่ เริ่มระบบ › ตารางข้อมูล`);
    await db.transaction().execute(async (tx) => {
      await tx.updateTable('doc_header').set({ status_code, updated_by: a.userId }).where('id', '=', id).execute();
      await logActivity(tx, a, { module: 'DOC', action: 'EDIT_STATUS', docNo: h.doc_no, table: 'doc_header', rowId: id, detail: { from: h.status_code, to: status_code } });
    });
    return { status_code };
  });

  app.get('/api/v1/master-notes/:entity/:id', async (req) => {
    const a = requireCompany(req);
    const p = parse(z.object({ entity: z.enum(['item', 'customer', 'supplier']), id: uuid }), req.params);
    const e = ENTITY[p.entity];
    const own = (await sql<{ id: string }>`SELECT id FROM ${sql.table(e.table)} WHERE id = ${p.id} AND company_id = ${a.companyId} AND deleted_at IS NULL`.execute(db)).rows[0];
    if (!own) throw notFound('ข้อมูล');
    const rows = await db.selectFrom('md_note').select('text').where('company_id', '=', a.companyId).where('entity_type', '=', e.type).where('entity_id', '=', p.id).where('deleted_at', 'is', null).orderBy('seq').execute();
    return { max: e.max, notes: rows.map((r) => r.text) };
  });
  app.put('/api/v1/master-notes/:entity/:id', async (req) => {
    const a = requireCompany(req);
    const p = parse(z.object({ entity: z.enum(['item', 'customer', 'supplier']), id: uuid }), req.params);
    const e = ENTITY[p.entity];
    const b = parse(z.object({ notes: lines(e.max) }), req.body);
    const own = (await sql<{ code: string }>`SELECT code FROM ${sql.table(e.table)} WHERE id = ${p.id} AND company_id = ${a.companyId} AND deleted_at IS NULL`.execute(db)).rows[0];
    if (!own) throw notFound('ข้อมูล');
    await db.transaction().execute(async (tx) => {
      await tx.deleteFrom('md_note').where('company_id', '=', a.companyId).where('entity_type', '=', e.type).where('entity_id', '=', p.id).execute();
      if (b.notes.length) await tx.insertInto('md_note').values(b.notes.map((text, i) => ({ company_id: a.companyId, entity_type: e.type, entity_id: p.id, seq: i + 1, text, created_by: a.userId, updated_by: a.userId }))).execute();
      await logActivity(tx, a, { module: 'MD', action: 'EDIT_NOTES', docNo: own.code, table: e.table, rowId: p.id, detail: { lines: b.notes.length } });
    });
    return { ok: true };
  });
}
