import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { ITEM_KINDS } from '@buddy/core';
import type { Db } from '../db.js';
import { badRequest, notFound, parse, requireCompany } from '../http.js';
import { logActivity } from '../audit.js';
import { decodeImage, imageDataUrl } from './company-images.js';

/**
 * รูปภาพสินค้า (ข้อกำหนดเจ้าของ 30/10/2569: "สินค้ามีบาร์โค้ด หมายเลขเครื่อง รูปภาพ")
 * สูงสุด 8 รูปต่อรหัส รูปละ ≤ 300 KB (หน้าจอย่อให้เอง) + รูปย่อสำหรับรายการ · รูปแรกเป็นรูปหลักอัตโนมัติ
 * บันทึกทันที (ไม่ต้องกด F9) · ใช้ได้ทุกชนิดรหัส สิทธิ์ตามเมนูของชนิดนั้น (แก้ไข)
 */
export const MAX_ITEM_IMAGES = 8;
const MAX_THUMB_BYTES = 40 * 1024;
const thumbUrl = z.string().max(Math.ceil(MAX_THUMB_BYTES * 1.4) + 100, 'รูปย่อใหญ่เกินไป').regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/, 'รูปย่อต้องเป็น PNG หรือ JPG');
const uuid = z.string().uuid();

/** รหัสรูปหลักของสินค้า (ใส่ใน select ของรายการ/หน้าค้นหา) */
export const mainImageId = sql<string | null>`(SELECT m.id FROM md_item_image m WHERE m.item_id = i.id AND m.is_main AND m.deleted_at IS NULL LIMIT 1)`;

export function itemImageRoutes(app: FastifyInstance, db: Db) {
  /** แฟ้มรูป (ใช้กับ <img src>) — size=thumb รูปย่อ · ข้อมูลรูปของรหัสเดิมไม่เปลี่ยน จึงให้เบราว์เซอร์จำไว้ได้ */
  app.get('/api/v1/item-images/:imageId', async (req, reply) => {
    const a = requireCompany(req);
    const { imageId } = parse(z.object({ imageId: uuid }), req.params);
    const q = parse(z.object({ size: z.enum(['thumb', 'full']).default('full') }), req.query);
    const r = (await sql<{ mime: string; data: string; thumb: string }>`SELECT mime, data, thumb FROM md_item_image WHERE id = ${imageId} AND company_id = ${a.companyId} AND deleted_at IS NULL`.execute(db)).rows[0];
    if (!r) throw notFound('รูป');
    const [mime, b64] = q.size === 'thumb' ? [r.thumb.slice(5, r.thumb.indexOf(';')), r.thumb.slice(r.thumb.indexOf(',') + 1)] : [r.mime, r.data];
    reply.header('content-type', mime).header('cache-control', 'private, max-age=86400');
    return Buffer.from(b64, 'base64');
  });

  for (const K of Object.values(ITEM_KINDS)) {
    const base = `/api/v1/${K.path}/:id/images`;
    const itemOf = async (companyId: string, id: string) => {
      const it = await db.selectFrom('md_item').select(['id', 'code']).where('id', '=', id).where('company_id', '=', companyId).where('deleted_at', 'is', null).where('item_type', 'in', K.types).executeTakeFirst();
      if (!it) throw notFound(K.label);
      return it;
    };
    const list = async (companyId: string, itemId: string) => (await sql<{ id: string; line_no: number; is_main: boolean; name: string | null; bytes: number }>`SELECT id, line_no, is_main, name, bytes
        FROM md_item_image WHERE company_id = ${companyId} AND item_id = ${itemId} AND deleted_at IS NULL ORDER BY is_main DESC, line_no`.execute(db)).rows;

    app.get(base, async (req) => {
      const a = requireCompany(req);
      const { id } = parse(z.object({ id: uuid }), req.params);
      await itemOf(a.companyId, id);
      return list(a.companyId, id);
    });

    app.post(base, async (req) => {
      const a = requireCompany(req);
      const { id } = parse(z.object({ id: uuid }), req.params);
      const b = parse(z.object({ data: imageDataUrl, thumb: thumbUrl, name: z.string().trim().max(120).nullable().optional() }), req.body);
      const it = await itemOf(a.companyId, id);
      const img = decodeImage(b.data);
      if (Buffer.from(b.thumb.slice(b.thumb.indexOf(',') + 1), 'base64').length > MAX_THUMB_BYTES) throw badRequest('รูปย่อใหญ่เกินไป');
      return db.transaction().execute(async (tx) => {
        const cur = (await sql<{ n: number; last: number | null }>`SELECT count(*)::int AS n, max(line_no) AS last FROM md_item_image WHERE company_id = ${a.companyId} AND item_id = ${id} AND deleted_at IS NULL`.execute(tx)).rows[0]!;
        if (cur.n >= MAX_ITEM_IMAGES) throw badRequest(`${K.label} ${it.code} มีรูปครบ ${MAX_ITEM_IMAGES} รูปแล้ว — ลบรูปเดิมก่อนเพิ่มรูปใหม่`);
        const r = (await sql<{ id: string }>`INSERT INTO md_item_image (company_id, item_id, line_no, is_main, name, mime, data, thumb, bytes, created_by)
            VALUES (${a.companyId}, ${id}, ${(cur.last ?? 0) + 1}, ${cur.n === 0}, ${b.name ?? null}, ${img.mime}, ${img.b64}, ${b.thumb}, ${img.bytes}, ${a.userId}) RETURNING id`.execute(tx)).rows[0]!;
        await logActivity(tx, a, { module: 'IC', action: 'ADD_IMAGE', docNo: it.code, table: 'md_item_image', rowId: r.id, detail: { bytes: img.bytes } });
        return { id: r.id };
      });
    });

    /** ตั้งเป็นรูปหลัก (แสดงในรายการสินค้าและหน้าค้นหา) */
    app.put(`${base}/:imageId/main`, async (req) => {
      const a = requireCompany(req);
      const { id, imageId } = parse(z.object({ id: uuid, imageId: uuid }), req.params);
      const it = await itemOf(a.companyId, id);
      if (!(await list(a.companyId, id)).some((x) => x.id === imageId)) throw notFound('รูป');
      await db.transaction().execute(async (tx) => {
        await sql`UPDATE md_item_image SET is_main = (id = ${imageId}), updated_by = ${a.userId} WHERE company_id = ${a.companyId} AND item_id = ${id} AND deleted_at IS NULL AND is_main <> (id = ${imageId})`.execute(tx);
        await logActivity(tx, a, { module: 'IC', action: 'MAIN_IMAGE', docNo: it.code, table: 'md_item_image', rowId: imageId });
      });
      return { ok: true };
    });

    /** ลบรูป — ล้างข้อมูลรูป คงแถวไว้ให้ประวัติ · ลบรูปหลักแล้วรูปถัดไปเป็นรูปหลักแทน */
    app.delete(`${base}/:imageId`, async (req) => {
      const a = requireCompany(req);
      const { id, imageId } = parse(z.object({ id: uuid, imageId: uuid }), req.params);
      const it = await itemOf(a.companyId, id);
      await db.transaction().execute(async (tx) => {
        const r = (await sql<{ is_main: boolean }>`SELECT is_main FROM md_item_image WHERE id = ${imageId} AND company_id = ${a.companyId} AND item_id = ${id} AND deleted_at IS NULL FOR UPDATE`.execute(tx)).rows[0];
        if (!r) throw notFound('รูป');
        await sql`UPDATE md_item_image SET data = '', thumb = '', bytes = 0, is_main = false, deleted_at = now(), updated_by = ${a.userId} WHERE id = ${imageId}`.execute(tx);
        if (r.is_main) await sql`UPDATE md_item_image SET is_main = true, updated_by = ${a.userId} WHERE id = (SELECT id FROM md_item_image WHERE company_id = ${a.companyId} AND item_id = ${id} AND deleted_at IS NULL ORDER BY line_no LIMIT 1)`.execute(tx);
        await logActivity(tx, a, { module: 'IC', action: 'DELETE_IMAGE', docNo: it.code, table: 'md_item_image', rowId: imageId });
      });
      return { ok: true };
    });
  }
}
