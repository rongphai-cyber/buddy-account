import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Db } from '../db.js';
import { notFound, parse, requireCompany } from '../http.js';

/**
 * ปุ่มไปเอกสารแรก / ก่อนหน้า / ถัดไป / สุดท้าย (แถบเครื่องมือทุกหน้าเอกสาร — ข้อกำหนดเจ้าของ 30/10/2569 เหมือน Express |< < > >|)
 * เอกสาร: ชนิดเดียวกัน (doc_class + ยกมา/ไม่ยกมา) เรียงตามเลขที่ · ใบสำคัญ: สมุดรายวันเดียวกัน เรียงตามเลขที่ใบสำคัญ
 */
type Pos = { id: string; no: string } | null;
export function neighborRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/v1/neighbors/:kind/:id', async (req) => {
    const a = requireCompany(req);
    const p = parse(z.object({ kind: z.enum(['doc', 'journal']), id: z.string().uuid() }), req.params);
    const one = async (q: ReturnType<typeof sql>) => ((await q.execute(db)).rows[0] as Pos | undefined) ?? null;
    if (p.kind === 'doc') {
      const h = await db.selectFrom('doc_header').select(['doc_no', 'doc_class', 'is_opening']).where('id', '=', p.id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
      if (!h) throw notFound('เอกสาร');
      const base = sql`FROM doc_header WHERE company_id = ${a.companyId} AND doc_class = ${h.doc_class} AND is_opening = ${h.is_opening} AND deleted_at IS NULL`;
      return {
        first: await one(sql`SELECT id, doc_no AS no ${base} ORDER BY doc_no LIMIT 1`), prev: await one(sql`SELECT id, doc_no AS no ${base} AND doc_no < ${h.doc_no} ORDER BY doc_no DESC LIMIT 1`),
        next: await one(sql`SELECT id, doc_no AS no ${base} AND doc_no > ${h.doc_no} ORDER BY doc_no LIMIT 1`), last: await one(sql`SELECT id, doc_no AS no ${base} ORDER BY doc_no DESC LIMIT 1`),
      };
    }
    const j = await db.selectFrom('gl_journal').select(['voucher_no', 'journal_book_id']).where('id', '=', p.id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!j) throw notFound('ใบสำคัญ');
    const base = sql`FROM gl_journal WHERE company_id = ${a.companyId} AND journal_book_id = ${j.journal_book_id} AND deleted_at IS NULL`;
    return {
      first: await one(sql`SELECT id, voucher_no AS no ${base} ORDER BY voucher_no LIMIT 1`), prev: await one(sql`SELECT id, voucher_no AS no ${base} AND voucher_no < ${j.voucher_no} ORDER BY voucher_no DESC LIMIT 1`),
      next: await one(sql`SELECT id, voucher_no AS no ${base} AND voucher_no > ${j.voucher_no} ORDER BY voucher_no LIMIT 1`), last: await one(sql`SELECT id, voucher_no AS no ${base} ORDER BY voucher_no DESC LIMIT 1`),
    };
  });
  /** เปิดเอกสารจากรหัส (ลิงก์เลขที่อ้างอิงในแท็บต่าง ๆ ที่ไม่รู้ชนิดเอกสาร) — สิทธิ์อ่านตามเมนูของเอกสารนั้น */
  app.get('/api/v1/locate/:kind/:id', async (req) => {
    const a = requireCompany(req);
    const p = parse(z.object({ kind: z.enum(['doc']), id: z.string().uuid() }), req.params);
    const h = await db.selectFrom('doc_header').select(['doc_no', 'doc_class', 'is_opening']).where('id', '=', p.id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!h) throw notFound('เอกสาร');
    return h;
  });
}
