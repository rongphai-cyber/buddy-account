import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { isTenantModuleKey, tenantModuleStatus, TENANT_MODULES } from '@buddy/core';
import type { Db } from '../db.js';
import { forbidden, notFound, parse, requireAuth } from '../http.js';
import { logActivity } from '../audit.js';

/**
 * สิทธิ์โมดูลระดับลูกค้าผู้ใช้บริการ (docs/17 ข้อ 5.6 · B0.6)
 *  - GET /api/v1/tenant/modules — ลูกค้าของผู้ใช้/กุญแจนี้ใช้โปรแกรมใดได้บ้าง (Hub แสดงไทล์ · โปรแกรมอื่นตรวจสิทธิ์)
 *  - GET/PUT /api/v1/tenants/:id/modules — เจ้าหน้าที่ผู้ให้บริการตั้งค่า (หน้า ลูกค้าผู้ใช้บริการ)
 */
const today = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);   // วันที่ไทย

async function rowsOf(db: Db, tenantId: string) {
  return (await sql<{ module_key: string; enabled: boolean; valid_to: string | null; seats: number | null; remark: string | null }>`
    SELECT module_key, enabled, valid_to::text AS valid_to, seats, remark FROM sys_tenant_module WHERE tenant_id = ${tenantId} AND deleted_at IS NULL`.execute(db)).rows;
}

const putBody = z.object({
  modules: z.array(z.object({
    key: z.string().refine(isTenantModuleKey, `ไม่รู้จักโมดูล — ใช้ได้: ${TENANT_MODULES.map((m) => m.key).join(' ')}`),
    enabled: z.boolean(),
    valid_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ใช้ได้ถึงต้องเป็น YYYY-MM-DD').nullable().optional().transform((v) => v || null),
    seats: z.coerce.number().int().min(1, 'จำนวนผู้ใช้/เครื่องต้องอย่างน้อย 1').max(100000).nullable().optional().transform((v) => v ?? null),
    remark: z.string().trim().max(200).nullable().optional().transform((v) => v || null),
  })).max(TENANT_MODULES.length),
});

export function tenantModuleRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/v1/tenant/modules', async (req) => {
    const a = requireAuth(req);
    // เจ้าหน้าที่ผู้ให้บริการ (ไม่สังกัดลูกค้า) เห็นทุกโมดูล
    if (!a.tenantId) return { tenant: null, modules: tenantModuleStatus(TENANT_MODULES.map((m) => ({ module_key: m.key, enabled: true, valid_to: null, seats: null })), today()) };
    const t = await db.selectFrom('sys_tenant').select(['code', 'name', 'expires_on', 'status']).where('id', '=', a.tenantId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!t) throw notFound('ลูกค้าผู้ใช้บริการ');
    return { tenant: { code: t.code, name: t.name, expires_on: t.expires_on ? String(t.expires_on).slice(0, 10) : null }, modules: tenantModuleStatus(await rowsOf(db, a.tenantId), today()) };
  });

  const platform = (req: Parameters<typeof requireAuth>[0]) => { const a = requireAuth(req); if (!a.isPlatform) throw forbidden('เฉพาะเจ้าหน้าที่ผู้ให้บริการโปรแกรม'); return a; };
  const tenantOf = async (id: string) => {
    const t = await db.selectFrom('sys_tenant').select(['id', 'code']).where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
    if (!t) throw notFound('ลูกค้าผู้ใช้บริการ');
    return t;
  };
  app.get('/api/v1/tenants/:id/modules', async (req) => {
    platform(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    await tenantOf(id);
    return tenantModuleStatus(await rowsOf(db, id), today());
  });
  app.put('/api/v1/tenants/:id/modules', async (req) => {
    const a = platform(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const b = parse(putBody, req.body);
    const t = await tenantOf(id);
    const before = await rowsOf(db, id);
    for (const m of b.modules) {
      const cur = await db.selectFrom('sys_tenant_module').select('id').where('tenant_id', '=', id).where('module_key', '=', m.key).where('deleted_at', 'is', null).executeTakeFirst();
      const v = { enabled: m.enabled, valid_to: m.valid_to, seats: m.seats, remark: m.remark, updated_by: a.userId };
      if (cur) await db.updateTable('sys_tenant_module').set(v).where('id', '=', cur.id).execute();
      else await db.insertInto('sys_tenant_module').values({ tenant_id: id, module_key: m.key, ...v, created_by: a.userId }).execute();
    }
    const after = tenantModuleStatus(await rowsOf(db, id), today());
    await logActivity(db, { companyId: null, userId: a.userId }, { module: 'SYS', action: 'TENANT_MODULES', table: 'sys_tenant', rowId: id, docNo: t.code, detail: { before, after: b.modules } });
    return after;
  });
}
