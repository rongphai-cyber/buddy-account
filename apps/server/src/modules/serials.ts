import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Db } from '../db.js';
import { badRequest, notFound, parse, requireCompany } from '../http.js';
import { logActivity } from '../audit.js';

/**
 * ทะเบียนหมายเลขสินค้า (คู่มือบทที่ 14 S-IC-12 ทะเบียน · S-IC-13 บัตรรับประกัน · S-IC-14 รายงานประวัติบริการ)
 * ข้อมูลทะเบียนเท่านั้น ไม่กระทบสต๊อก/บัญชี · ประวัติบริการ (ซ่อม/บำรุง/เปลี่ยนอะไหล่) แก้ทั้งชุดพร้อมทะเบียน
 */
const uuid = z.string().uuid();
const optId = uuid.nullable().optional().transform((v) => v ?? null);
const str = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ไม่ถูกต้อง').nullable().optional().transform((v) => v || null);
const body = z.object({
  serial_no: z.string().trim().min(1, 'ป้อนหมายเลขสินค้า (Serial No.)').max(40), machine_no: str(40), ref_code: str(30), item_id: optId, category_code: str(10), description: str(200),
  sale_date: date, warranty_end: date, customer_id: optId, customer_name: str(200), salesperson_id: optId,
  services: z.array(z.object({ service_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ป้อนวันที่บริการ'), service_by: str(60), detail: str(2000) })).max(500).default([]),
});

export function serialRoutes(app: FastifyInstance, db: Db) {
  const select = (companyId: string) => db.selectFrom('md_serial as s').leftJoin('md_item as i', 'i.id', 's.item_id').leftJoin('md_customer as c', 'c.id', 's.customer_id').leftJoin('md_salesperson as p', 'p.id', 's.salesperson_id')
    .select(['s.id', 's.serial_no', 's.machine_no', 's.ref_code', 's.item_id', 'i.code as item_code', 'i.name_th as item_name', 's.category_code', 's.description', 's.sale_date', 's.warranty_end',
      's.customer_id', 'c.code as customer_code', sql<string>`coalesce(s.customer_name, trim(coalesce(c.title, '') || ' ' || c.name))`.as('customer_name'), 'c.address_1', 'c.address_2', 'c.address_3', 'c.zip_code',
      's.salesperson_id', 'p.code as salesperson_code', 'p.name as salesperson_name', 's.print_count', 's.last_printed_at'])
    .where('s.company_id', '=', companyId).where('s.deleted_at', 'is', null);

  app.get('/api/v1/serials', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ q: z.string().optional(), limit: z.coerce.number().int().min(1).max(5000).default(500), with_services: z.enum(['Y', 'N']).default('N') }), req.query);
    const like = q.q?.trim() ? `%${q.q.trim()}%` : null;
    const rows = await select(a.companyId)
      .$if(!!like, (qb) => qb.where((e) => e.or([e('s.serial_no', 'ilike', like!), e('s.machine_no', 'ilike', like!), e('s.ref_code', 'ilike', like!), e('s.description', 'ilike', like!), e('c.name', 'ilike', like!), e('s.customer_name', 'ilike', like!)])))
      .orderBy('s.serial_no').limit(q.limit).execute();
    // S-IC-14 รายงานประวัติการให้บริการ: เรียงตามหมายเลขสินค้า พร้อมบรรทัดประวัติ
    const services = q.with_services === 'Y' && rows.length ? await db.selectFrom('md_serial_service').select(['serial_id', 'service_date', 'service_by', 'detail'])
      .where('company_id', '=', a.companyId).where('deleted_at', 'is', null).where('serial_id', 'in', rows.map((r) => r.id)).orderBy('service_date').execute() : [];
    return { rows: rows.map((r) => ({ ...r, services: services.filter((s) => s.serial_id === r.id) })) };
  });

  app.get('/api/v1/serials/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const s = await select(a.companyId).where('s.id', '=', id).executeTakeFirst();
    if (!s) throw notFound('หมายเลขสินค้า');
    const services = await db.selectFrom('md_serial_service').select(['id', 'service_date', 'service_by', 'detail']).where('serial_id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).orderBy('service_date').execute();
    return { ...s, services };
  });

  const save = async (a: ReturnType<typeof requireCompany>, id: string | null, b: z.infer<typeof body>) => {
    const chk = async (tbl: 'md_item' | 'md_customer' | 'md_salesperson', v: string | null, label: string) => {
      if (v && !(await db.selectFrom(tbl).select('id').where('id', '=', v).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst())) throw badRequest(`ไม่พบ${label}ที่เลือก`);
    };
    await chk('md_item', b.item_id, 'สินค้า'); await chk('md_customer', b.customer_id, 'ลูกค้า'); await chk('md_salesperson', b.salesperson_id, 'ผู้ขาย');
    if (b.sale_date && b.warranty_end && b.warranty_end < b.sale_date) throw badRequest('วันที่หมดประกันต้องไม่ก่อนวันที่ขาย');
    const { services, ...row } = b;
    return db.transaction().execute(async (tx) => {
      const dup = await tx.selectFrom('md_serial').select('id').where('company_id', '=', a.companyId).where('serial_no', '=', b.serial_no).where('deleted_at', 'is', null).executeTakeFirst();
      if (dup && dup.id !== id) throw badRequest(`หมายเลขสินค้า ${b.serial_no} มีในทะเบียนแล้ว`);
      let sid = id;
      if (id) {
        const cur = await tx.selectFrom('md_serial').select('id').where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
        if (!cur) throw notFound('หมายเลขสินค้า');
        await tx.updateTable('md_serial').set({ ...row, updated_by: a.userId, updated_at: sql`now()` as never }).where('id', '=', id).execute();
        await tx.updateTable('md_serial_service').set({ deleted_at: sql`now()` as never, updated_by: a.userId }).where('serial_id', '=', id).where('deleted_at', 'is', null).execute();
      } else {
        sid = (await tx.insertInto('md_serial').values({ ...row, company_id: a.companyId, created_by: a.userId, updated_by: a.userId }).returning('id').executeTakeFirstOrThrow()).id;
      }
      if (services.length) await tx.insertInto('md_serial_service').values(services.map((s) => ({ ...s, company_id: a.companyId, serial_id: sid!, created_by: a.userId, updated_by: a.userId }))).execute();
      await logActivity(tx, a, { module: 'IC', action: id ? 'EDIT' : 'ADD', docNo: b.serial_no, table: 'md_serial', rowId: sid });
      return { id: sid };
    });
  };
  app.post('/api/v1/serials', async (req) => save(requireCompany(req), null, parse(body, req.body)));
  app.put('/api/v1/serials/:id', async (req) => save(requireCompany(req), parse(z.object({ id: uuid }), req.params).id, parse(body, req.body)));
  app.delete('/api/v1/serials/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const s = await db.selectFrom('md_serial').select(['id', 'serial_no']).where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!s) throw notFound('หมายเลขสินค้า');
    await db.transaction().execute(async (tx) => {
      await tx.updateTable('md_serial').set({ deleted_at: sql`now()` as never, updated_by: a.userId }).where('id', '=', id).execute();
      await logActivity(tx, a, { module: 'IC', action: 'DELETE', docNo: s.serial_no, table: 'md_serial', rowId: id });
    });
    return { ok: true };
  });
  /** S-IC-13 นับการพิมพ์บัตรรับประกัน (พิมพ์ได้หลังบันทึกครบ) */
  app.post('/api/v1/serials/:id/printed', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const r = await db.updateTable('md_serial').set({ print_count: sql`print_count + 1` as never, last_printed_at: sql`now()` as never }).where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).returning('print_count').executeTakeFirst();
    if (!r) throw notFound('หมายเลขสินค้า');
    return r;
  });
}
