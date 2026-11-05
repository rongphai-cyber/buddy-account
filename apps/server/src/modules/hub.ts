import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { aggregateSync, d, HUB_APPS, HUB_ORDER, hubTileState, isTenantModuleKey, syncStateOf, syncText, tenantModuleStatus, TENANT_MODULES, type TenantModuleKey } from '@buddy/core';
import type { Db } from '../db.js';
import type { Config } from '../config.js';
import { AppError, badRequest, forbidden, parse, requireCompany } from '../http.js';
import { logActivity } from '../audit.js';
import { jwks, signSsoToken, SSO_TTL_SECONDS } from '../sso.js';

/**
 * WTS Solutions Hub + ล็อกอินกลาง (docs/17 B6.1/B6.2 · ข้อ 5.8)
 *  - GET  /.well-known/jwks.json (และ /api/v1/sso/jwks) — กุญแจสาธารณะให้โปรแกรมอื่นตรวจบัตรผ่าน (ไม่ต้องเข้าระบบ)
 *  - GET  /api/v1/hub — ไทล์ของบริษัทที่เลือก: สิทธิ์โมดูลของลูกค้า + ตัวเลขสำคัญ + สถานะคิวส่งเอกสาร (SyncStatus รวม)
 *  - POST /api/v1/hub/launch — ออกบัตรผ่าน (JWT อายุ 2 นาที) แล้วตอบที่อยู่โปรแกรม + #buddy_sso=… (ส่วนหลัง # ไม่ถูกส่งไปเซิร์ฟเวอร์/ไม่ลง log)
 *  - PUT  /api/v1/source-status — โปรแกรมอื่นรายงานคิวส่งเอกสารของตัวเอง (กุญแจ API เท่านั้น) · เป็นสถานะชั่วคราว ไม่ลง sys_activity_log
 * ตอนขาย/เช็คอิน ไม่มีโปรแกรมไหนต้องรอ Buddy (D11) — Hub เป็นแค่ทางเข้า และรายงานสถานะเป็นงานเสริมที่ล้มเหลวได้
 */
const today = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);   // วันที่ไทย
const iso = z.string().datetime({ offset: true, message: 'เวลาต้องเป็น ISO 8601 เช่น 2026-11-05T14:02:00+07:00' });
const statusBody = z.object({
  system: z.string().trim().regex(/^[a-z][a-z0-9-]{1,29}$/, 'system ต้องเป็นตัวพิมพ์เล็ก a-z ตัวเลข และ - ยาว 2–30 ตัว เช่น wts-pos'),
  pending: z.number().int().min(0).max(100_000_000),
  failed: z.number().int().min(0).max(100_000_000),
  oldest_pending_at: iso.nullable().optional(),
  last_sent_at: iso.nullable().optional(),
  message: z.string().trim().max(200).nullable().optional(),
  metric: z.object({ label: z.string().trim().min(1).max(60), value: z.string().trim().min(1).max(40) }).nullable().optional(),
});

type ModRow = { module_key: string; enabled: boolean; valid_to: string | null; seats: number | null; remark: string | null; app_url: string | null };
async function tenantRows(db: Db, tenantId: string | null): Promise<ModRow[]> {
  if (!tenantId) return [];
  return (await sql<ModRow>`SELECT module_key, enabled, valid_to::text AS valid_to, seats, remark, app_url FROM sys_tenant_module
    WHERE tenant_id = ${tenantId} AND deleted_at IS NULL`.execute(db)).rows;
}

async function companyOf(db: Db, companyId: string) {
  return db.selectFrom('sys_company as c').leftJoin('sys_tenant as t', 't.id', 'c.tenant_id')
    .select(['c.id', 'c.code', 'c.name_th', 'c.tax_id', 'c.tenant_id', 't.code as tenant_code', 't.name as tenant_name'])
    .where('c.id', '=', companyId).where('c.deleted_at', 'is', null).executeTakeFirstOrThrow();
}

/** ยอดขายเดือนนี้ (ก่อน VAT หลังส่วนลด) — สูตรเดียวกับแดชบอร์ดผู้บริหาร คำนวณสดจากเอกสาร */
async function salesThisMonth(db: Db, companyId: string) {
  const to = today(), from = `${to.slice(0, 8)}01`;
  const r = (await sql<{ v: string | null }>`SELECT sum(CASE WHEN h.doc_class = 'CN' THEN -l.net_amount ELSE l.net_amount END) AS v
    FROM doc_line l JOIN doc_header h ON h.id = l.header_id
    WHERE h.company_id = ${companyId} AND h.doc_class IN ('IV', 'HS', 'DR', 'CN') AND h.doc_status <> 'C' AND h.deleted_at IS NULL AND l.deleted_at IS NULL
      AND NOT h.is_opening AND l.line_kind IS DISTINCT FROM 'K' AND h.doc_date BETWEEN ${from} AND ${to}`.execute(db)).rows[0];
  return d(r?.v ?? 0).toFixed(2);
}

const originOf = (req: FastifyRequest, cfg: Config) => cfg.publicUrl ?? `${req.protocol}://${req.host}`;

export function hubRoutes(app: FastifyInstance, db: Db, cfg: Config) {
  const keySet = async () => jwks();
  app.get('/.well-known/jwks.json', keySet);
  app.get('/api/v1/sso/jwks', keySet);

  app.get('/api/v1/hub', async (req) => {
    const a = requireCompany(req);
    if (a.apiKeyId) throw forbidden('Hub ใช้ผ่านหน้าจอเท่านั้น — กุญแจ API ใช้ GET /api/v1/tenant/modules');
    const c = await companyOf(db, a.companyId);
    const rows = await tenantRows(db, c.tenant_id);
    const mods = tenantModuleStatus(rows, today());
    const status = (await db.selectFrom('sys_source_status').selectAll().where('company_id', '=', a.companyId).where('deleted_at', 'is', null).execute());
    const now = new Date();
    const apps = HUB_ORDER.map((key) => {
      const hub = HUB_APPS[key], m = mods.find((x) => x.key === key)!, url = rows.find((r) => r.module_key === key)?.app_url ?? null;
      const tile = hubTileState(key, m, url);
      const st = hub.source ? status.find((s) => s.source_system === hub.source) : undefined;
      const state = st ? syncStateOf(st, now) : null;
      return {
        key, name: hub.name, description: hub.description, mark: hub.mark, tone: hub.tone, launch: hub.launch,
        status: tile.status, reason: tile.reason, valid_to: m.valid_to,
        // ลิงก์ธรรมดา (ยังไม่รับบัตรผ่าน) ให้ที่อยู่ไปเลย · แบบบัตรผ่านต้องกดเปิด (POST launch)
        url: hub.launch === 'link' && tile.status === 'active' ? url : null,
        metric: st?.metric_label && st.metric_value ? { label: st.metric_label, value: st.metric_value, at: st.reported_at } : null,
        sync: st && state ? { state, pending: st.pending, failed: st.failed, reported_at: st.reported_at, last_sent_at: st.last_sent_at, oldest_pending_at: st.oldest_pending_at, message: st.message, text: syncText(state, st.pending, st.failed, hub.name) } : null,
      };
    });
    // Buddy เอง: ยอดขายเดือนนี้
    const erp = apps.find((x) => x.key === 'buddy')!;
    erp.metric = { label: 'ยอดขายเดือนนี้ (ก่อน VAT)', value: await salesThisMonth(db, a.companyId), at: now.toISOString() };
    // สถานะรวม: เฉพาะโปรแกรมที่เปิดใช้อยู่
    const live = status.filter((s) => apps.some((x) => x.status === 'active' && HUB_APPS[x.key].source === s.source_system));
    const agg = aggregateSync(live, now);
    return {
      tenant: c.tenant_id ? { code: c.tenant_code, name: c.tenant_name } : null,
      company: { id: c.id, code: c.code, name_th: c.name_th },
      apps,
      sync: agg ? { ...agg, text: syncText(agg.state, agg.pending, agg.failed) } : null,
    };
  });

  app.post('/api/v1/hub/launch', async (req) => {
    const a = requireCompany(req);
    if (a.apiKeyId) throw forbidden('บัตรผ่านออกให้ผู้ใช้ที่เข้าระบบผ่านหน้าจอเท่านั้น');
    const { module } = parse(z.object({ module: z.string().refine(isTenantModuleKey, `ไม่รู้จักโปรแกรม — ใช้ได้: ${TENANT_MODULES.map((m) => m.key).join(' ')}`) }), req.body);
    const key = module as TenantModuleKey;
    const hub = HUB_APPS[key];
    if (hub.launch !== 'sso' || !hub.audience) throw badRequest(hub.launch === 'link' ? `${hub.name} ยังไม่รับบัตรผ่าน — เปิดจากลิงก์แล้วเข้าระบบที่ ${hub.name}` : `${hub.name} ยังเปิดจาก Hub ไม่ได้`);
    const c = await companyOf(db, a.companyId);
    const rows = await tenantRows(db, c.tenant_id);
    const m = tenantModuleStatus(rows, today()).find((x) => x.key === key)!;
    const url = rows.find((r) => r.module_key === key)?.app_url ?? null;
    const tile = hubTileState(key, m, url);
    if (tile.status !== 'active') throw forbidden(tile.reason ?? `เปิด ${hub.name} ไม่ได้`);
    if (!url) throw new AppError(409, 'APP_URL_MISSING', tile.reason!);
    const branch = a.branchId ? await db.selectFrom('sys_branch').select(['id', 'code', 'name']).where('id', '=', a.branchId).where('company_id', '=', a.companyId).executeTakeFirst() : undefined;
    const { token, claims } = signSsoToken({
      iss: originOf(req, cfg), aud: hub.audience, sub: a.userId, name: a.displayName, preferred_username: a.username,
      buddy: {
        tenant: c.tenant_id ? { id: c.tenant_id, code: c.tenant_code ?? '', name: c.tenant_name ?? '' } : null,
        company: { id: c.id, code: c.code, name_th: c.name_th, tax_id: c.tax_id ?? null },
        branch: branch ? { id: branch.id, code: branch.code, name: branch.name } : null,
        admin: a.isAdmin, platform: a.isPlatform,
      },
    });
    await logActivity(db, a, { module: 'SYS', action: 'HUB_LAUNCH', table: 'sys_tenant_module', docNo: hub.name, detail: { module: key, aud: hub.audience, jti: claims.jti, exp: claims.exp } });
    return { url: `${url}#buddy_sso=${token}`, expires_in: SSO_TTL_SECONDS };
  });

  app.put('/api/v1/source-status', async (req) => {
    const a = requireCompany(req);
    if (!a.apiKeyId) throw forbidden('รายงานสถานะได้เฉพาะโปรแกรมที่ใช้กุญแจ API ของบริษัท');
    const b = parse(statusBody, req.body);
    const v = {
      pending: b.pending, failed: b.failed, oldest_pending_at: b.oldest_pending_at ?? null, last_sent_at: b.last_sent_at ?? null,
      message: b.message || null, metric_label: b.metric?.label ?? null, metric_value: b.metric?.value ?? null,
      reported_at: sql<string>`now()`, updated_by: a.userId, updated_at: sql<string>`now()`,
    };
    const cur = await db.selectFrom('sys_source_status').select('id').where('company_id', '=', a.companyId).where('source_system', '=', b.system).where('deleted_at', 'is', null).executeTakeFirst();
    if (cur) await db.updateTable('sys_source_status').set(v).where('id', '=', cur.id).execute();
    else await db.insertInto('sys_source_status').values({ company_id: a.companyId, source_system: b.system, ...v, created_by: a.userId }).execute();
    return { ok: true, state: syncStateOf({ pending: b.pending, failed: b.failed, reported_at: new Date() }) };
  });
}
