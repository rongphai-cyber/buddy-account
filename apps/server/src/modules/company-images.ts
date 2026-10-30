import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Db } from '../db.js';
import { badRequest, notFound, parse, requireCompany } from '../http.js';
import { logActivity } from '../audit.js';

/**
 * โลโก้และลายเซ็นของบริษัทสำหรับพิมพ์เอกสาร (ข้อกำหนดเจ้าของ 30/10/2569: "ใส่โลโก้ ลายเซ็นต์ต่างๆ ได้")
 * เก็บในฐานข้อมูลของบริษัท (base64 · PNG/JPEG ≤ 300 KB) — อยู่ในแฟ้มสำรองและส่งให้เครื่องสาขาพร้อมข้อมูลอื่น
 * แก้ไขได้เฉพาะผู้มีสิทธิ์แก้แบบฟอร์ม (RP.FORM ระดับ 9) · ทุกคนที่พิมพ์เอกสารได้เห็นรูปในเอกสาร
 */
export const MAX_IMAGE_BYTES = 300 * 1024;
export const imageDataUrl = z.string().max(Math.ceil(MAX_IMAGE_BYTES * 1.4) + 100, 'รูปใหญ่เกิน 300 KB — ย่อรูปก่อน').regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/, 'ใช้รูป PNG หรือ JPG เท่านั้น');
export type CompanyImages = { logo: string | null; signs: Record<string, { name: string; data: string }> };

/** ตรวจว่าเป็นรูปจริง (ลายเซ็นแฟ้ม) และขนาดไม่เกิน */
export function decodeImage(url: string) {
  const [head, b64] = url.split(',') as [string, string];
  const mime = head.slice(5, head.indexOf(';'));
  const buf = Buffer.from(b64, 'base64');
  if (buf.length > MAX_IMAGE_BYTES) throw badRequest(`รูปขนาด ${Math.round(buf.length / 1024)} KB ใหญ่เกิน 300 KB — ย่อรูปก่อน`);
  const png = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if ((mime === 'image/png' && !png) || (mime === 'image/jpeg' && !jpg)) throw badRequest('แฟ้มนี้ไม่ใช่รูป PNG/JPG ที่ถูกต้อง');
  return { mime, b64, bytes: buf.length };
}

/** รูปทั้งหมดของบริษัทในรูปแบบที่ใช้พิมพ์ (data URL) */
export async function companyImages(db: Db, companyId: string): Promise<CompanyImages> {
  const rows = (await sql<{ id: string; kind: string; name: string; mime: string; data: string }>`SELECT id, kind, name, mime, data FROM sys_company_image
      WHERE company_id = ${companyId} AND deleted_at IS NULL ORDER BY kind, name`.execute(db)).rows;
  const url = (r: { mime: string; data: string }) => `data:${r.mime};base64,${r.data}`;
  const logo = rows.find((r) => r.kind === 'LOGO');
  return { logo: logo ? url(logo) : null, signs: Object.fromEntries(rows.filter((r) => r.kind === 'SIGN').map((r) => [r.id, { name: r.name, data: url(r) }])) };
}

export function companyImageRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/v1/company-images', async (req) => {
    const a = requireCompany(req);
    return (await sql<{ id: string; kind: string; name: string; mime: string; bytes: number; data: string; updated_at: string }>`SELECT id, kind, name, mime, bytes, data, updated_at FROM sys_company_image
        WHERE company_id = ${a.companyId} AND deleted_at IS NULL ORDER BY kind, name`.execute(db)).rows.map((r) => ({ ...r, data: `data:${r.mime};base64,${r.data}` }));
  });
  /** โลโก้: มีได้รูปเดียว — อัปโหลดใหม่แทนรูปเดิม */
  app.put('/api/v1/company-images/logo', async (req) => {
    const a = requireCompany(req);
    const { data } = parse(z.object({ data: imageDataUrl }), req.body);
    const img = decodeImage(data);
    const cur = (await sql<{ id: string }>`SELECT id FROM sys_company_image WHERE company_id = ${a.companyId} AND kind = 'LOGO' AND deleted_at IS NULL`.execute(db)).rows[0];
    if (cur) await sql`UPDATE sys_company_image SET mime = ${img.mime}, data = ${img.b64}, bytes = ${img.bytes}, updated_by = ${a.userId} WHERE id = ${cur.id}`.execute(db);
    else await sql`INSERT INTO sys_company_image (company_id, kind, name, mime, data, bytes, created_by) VALUES (${a.companyId}, 'LOGO', 'LOGO', ${img.mime}, ${img.b64}, ${img.bytes}, ${a.userId})`.execute(db);
    await logActivity(db, a, { module: 'RP', action: 'SET_LOGO', detail: { bytes: img.bytes } });
    return { ok: true };
  });
  /** ลายเซ็น: ตั้งชื่อได้หลายรูป (เช่น กรรมการผู้จัดการ ผู้รับเงิน) — แบบฟอร์มเลือกรูปให้แต่ละช่องลงชื่อ */
  app.post('/api/v1/company-images/signs', async (req) => {
    const a = requireCompany(req);
    const b = parse(z.object({ name: z.string().trim().min(1, 'ตั้งชื่อลายเซ็น เช่น กรรมการผู้จัดการ').max(120), data: imageDataUrl }), req.body);
    const img = decodeImage(b.data);
    if ((await sql`SELECT 1 FROM sys_company_image WHERE company_id = ${a.companyId} AND kind = 'SIGN' AND name = ${b.name} AND deleted_at IS NULL`.execute(db)).rows.length)
      throw badRequest(`มีลายเซ็นชื่อ "${b.name}" อยู่แล้ว — ใช้ชื่ออื่น หรือลบรูปเดิมก่อน`);
    const r = (await sql<{ id: string }>`INSERT INTO sys_company_image (company_id, kind, name, mime, data, bytes, created_by) VALUES (${a.companyId}, 'SIGN', ${b.name}, ${img.mime}, ${img.b64}, ${img.bytes}, ${a.userId}) RETURNING id`.execute(db)).rows[0]!;
    await logActivity(db, a, { module: 'RP', action: 'ADD_SIGN', table: 'sys_company_image', rowId: r.id, detail: { name: b.name } });
    return { id: r.id };
  });
  app.delete('/api/v1/company-images/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    // ลบรูปจริง (ลายเซ็นเป็นข้อมูลส่วนบุคคล) คงแถวไว้ให้ประวัติ
    const r = await sql`UPDATE sys_company_image SET data = '', bytes = 0, deleted_at = now(), updated_by = ${a.userId} WHERE id = ${id} AND company_id = ${a.companyId} AND deleted_at IS NULL`.execute(db);
    if (!Number(r.numAffectedRows ?? 0)) throw notFound('รูป');
    await logActivity(db, a, { module: 'RP', action: 'DELETE_IMAGE', table: 'sys_company_image', rowId: id });
    return { ok: true };
  });
}
