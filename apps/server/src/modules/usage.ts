import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sql, type RawBuilder } from 'kysely';
import { z } from 'zod';
import { DOCS_DEFINITION, effectiveLimits, limitsForPayer, monthRange, overageLines, quotaBlocked, quotaRows, thisMonthTh, worstLevel, type Limits, type OverageRates, type PackageLimits, type Usage } from '@buddy/core';
import type { Db } from '../db.js';
import { AppError, badRequest, forbidden, notFound, parse, requireAuth } from '../http.js';
import { logActivity } from '../audit.js';

/**
 * แพ็กเกจบริการ + มาตรวัดการใช้งานต่อลูกค้า (HANDOFF 185 · เจ้าของ 25/11/2569 "แบบ A เอกสาร+ไฟล์")
 * ยอดใช้งานคำนวณสดจากข้อมูลทุกครั้ง (ไม่เก็บยอดสะสม) — เอกสาร: ดู DOCS_DEFINITION · ไฟล์: ขนาดรูปบริษัท/ลายเซ็น/รูปสินค้า · AI: อ่านบิลสำเร็จ
 * ทุก API ทำงานนอกขอบเขต RLS ของบริษัท (SELF) — รวมทุกบริษัทของลูกค้า · ลูกค้าเห็นเฉพาะของตัวเอง (ข้อ 7.1) · แค็ตตาล็อก/รายงานส่วนเกิน = ผู้ให้บริการเท่านั้น
 * ไฟล์/AI ครบ 100% และลูกค้าตั้ง "หยุด": ตรวจก่อนเปิดทรานแซกชันของบริษัท (preHandler) แล้วปฏิเสธพร้อมบอกทางแก้ · เอกสารไม่หยุดเด็ดขาด
 */
type PkgRow = PackageLimits & OverageRates & { id: string; code: string; name_th: string; price_year: string; status: string; sort_order: number; remark: string | null };
type TenantRow = { id: string; code: string; name: string; status: string; package_id: string | null; over_action: string; max_companies: number | null; max_users: number | null; docs_per_month: number | null; file_quota_mb: number | null; ai_per_month: number | null; ai_payer: string; ai_limit_usd: string | null };
const PKG_COLS = ['id', 'code', 'name_th', 'price_year', 'max_companies', 'max_users', 'docs_per_month', 'file_quota_mb', 'ai_per_month', 'over_company_year', 'over_user_year', 'over_doc', 'over_file_gb_month', 'over_ai', 'status', 'sort_order', 'remark'] as const;

async function packageOf(db: Db, id: string | null): Promise<PkgRow | null> {
  if (!id) return null;
  return (await db.selectFrom('sys_package').select([...PKG_COLS]).where('id', '=', id).executeTakeFirst() as PkgRow | undefined) ?? null;
}
async function tenantRow(db: Db, tenantId: string): Promise<TenantRow | undefined> {
  return db.selectFrom('sys_tenant').select(['id', 'code', 'name', 'status', 'package_id', 'over_action', 'max_companies', 'max_users', 'docs_per_month', 'file_quota_mb', 'ai_per_month', 'ai_payer', 'ai_limit_usd'])
    .where('id', '=', tenantId).where('deleted_at', 'is', null).executeTakeFirst() as Promise<TenantRow | undefined>;
}
/** ขีดจำกัดที่ใช้จริงของลูกค้า (ค่าของลูกค้าทับแพ็กเกจ · ไม่มีแพ็กเกจและไม่ตั้ง = ไม่จำกัด) · ลูกค้าจ่ายค่า AI เอง = ไม่มีโควตา AI (HANDOFF 190) */
export async function tenantLimits(db: Db, tenantId: string): Promise<{ tenant: TenantRow; pkg: PkgRow | null; limits: Limits } | null> {
  const tenant = await tenantRow(db, tenantId);
  if (!tenant) return null;
  const pkg = await packageOf(db, tenant.package_id);
  return { tenant, pkg, limits: limitsForPayer(effectiveLimits(pkg, tenant), tenant.ai_payer) };
}

type CompanyUse = { id: string; code: string; name_th: string; docs: number; vouchers: number; file_bytes: number; ai: number; db_bytes?: number };
/** การใช้งานของเดือน (เวลาไทย) ทุกบริษัทของลูกค้า + รวม */
export async function tenantUsage(db: Db, tenantId: string, month: string, opts: { dbSize?: boolean } = {}): Promise<{ usage: Usage; companies: CompanyUse[]; ai_cost_usd: string }> {
  const { from, to } = monthRange(month);
  const cos = await db.selectFrom('sys_company').select(['id', 'code', 'name_th']).where('tenant_id', '=', tenantId).where('deleted_at', 'is', null).orderBy('code').execute();
  const ids = cos.map((c) => c.id);
  const users = Number((await db.selectFrom('sys_user').select(sql<number>`count(*)`.as('n')).where('tenant_id', '=', tenantId).where('deleted_at', 'is', null).executeTakeFirstOrThrow()).n);
  const by = async (q: RawBuilder<{ c: string; n: string }>) => new Map((await q.execute(db)).rows.map((r) => [r.c, Number(r.n)]));
  const none = ['00000000-0000-0000-0000-000000000000'];
  const idList = ids.length ? ids : none;
  // เอกสาร: สร้างในเดือน (รวมที่ยกเลิก/ลบภายหลัง) ไม่นับที่ย้ายมาจาก Express
  const docs = await by(sql<{ c: string; n: string }>`SELECT company_id::text AS c, count(*)::text AS n FROM doc_header
      WHERE company_id = ANY(${idList}::uuid[]) AND created_at >= ${from}::timestamptz AND created_at < ${to}::timestamptz AND express_rectype IS NULL GROUP BY 1`);
  // ใบสำคัญที่บันทึกเอง (ไม่ได้มาจากเอกสาร/ค่าเสื่อม/ปิดปี)
  const vouchers = await by(sql<{ c: string; n: string }>`SELECT company_id::text AS c, count(*)::text AS n FROM gl_journal
      WHERE company_id = ANY(${idList}::uuid[]) AND created_at >= ${from}::timestamptz AND created_at < ${to}::timestamptz AND source_header_id IS NULL AND coalesce(source_module, 'GL') = 'GL' GROUP BY 1`);
  const files = await by(sql<{ c: string; n: string }>`SELECT c, sum(b)::text AS n FROM (
      SELECT company_id::text AS c, bytes::bigint AS b FROM sys_company_image WHERE company_id = ANY(${idList}::uuid[]) AND deleted_at IS NULL
      UNION ALL SELECT company_id::text, bytes::bigint FROM md_item_image WHERE company_id = ANY(${idList}::uuid[]) AND deleted_at IS NULL) x GROUP BY c`);
  const ai = await by(sql<{ c: string; n: string }>`SELECT company_id::text AS c, count(*)::text AS n FROM sys_ai_usage
      WHERE company_id = ANY(${idList}::uuid[]) AND created_at >= ${from}::timestamptz AND created_at < ${to}::timestamptz AND status = 'OK' AND deleted_at IS NULL GROUP BY 1`);
  // ค่า AI (ดอลลาร์ตามโทเคนจริง ทุกสถานะ) — ลูกค้าที่ WTS จ่ายให้ = ต้นทุนของผู้ให้บริการ (HANDOFF 190)
  const aiCost = (await sql<{ v: string }>`SELECT coalesce(sum(cost_usd), 0)::text AS v FROM sys_ai_usage
      WHERE company_id = ANY(${idList}::uuid[]) AND created_at >= ${from}::timestamptz AND created_at < ${to}::timestamptz AND deleted_at IS NULL`.execute(db)).rows[0]!.v;
  const dbBytes = opts.dbSize && ids.length ? await dbEstimate(db, ids) : null;
  const companies: CompanyUse[] = cos.map((c) => ({ id: c.id, code: c.code, name_th: c.name_th, docs: (docs.get(c.id) ?? 0) + (vouchers.get(c.id) ?? 0), vouchers: vouchers.get(c.id) ?? 0,
    file_bytes: files.get(c.id) ?? 0, ai: ai.get(c.id) ?? 0, ...(dbBytes ? { db_bytes: dbBytes.get(c.id) ?? 0 } : {}) }));
  const sum = (k: 'docs' | 'file_bytes' | 'ai') => companies.reduce((s, c) => s + c[k], 0);
  return { usage: { companies: cos.length, users, docs: sum('docs'), file_bytes: sum('file_bytes'), ai: sum('ai') }, companies, ai_cost_usd: aiCost };
}
/** ขนาดข้อมูลโดยประมาณต่อบริษัท (ผู้ให้บริการดูต้นทุน — ไม่ใช้คิดเงิน) จากตารางที่ใหญ่ที่สุด */
const BIG_TABLES = ['doc_header', 'doc_line', 'gl_journal', 'gl_journal_line', 'tax_vat_entry', 'inv_stock_ledger', 'sys_activity_log', 'md_item', 'md_customer', 'md_supplier', 'sys_company_image', 'md_item_image'];
async function dbEstimate(db: Db, ids: string[]) {
  const out = new Map<string, number>();
  for (const t of BIG_TABLES) {
    const r = await sql<{ c: string; n: string }>`SELECT company_id::text AS c, coalesce(sum(pg_column_size(x.*)), 0)::text AS n FROM ${sql.table(t)} x WHERE company_id = ANY(${ids}::uuid[]) GROUP BY 1`.execute(db);
    for (const x of r.rows) out.set(x.c, (out.get(x.c) ?? 0) + Number(x.n));
  }
  return out;
}

const monthQ = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'เดือนไม่ถูกต้อง (ปปปป-ดด)').optional() });
const rates = (p: PkgRow | null): OverageRates | null => p ? { over_company_year: p.over_company_year, over_user_year: p.over_user_year, over_doc: p.over_doc, over_file_gb_month: p.over_file_gb_month, over_ai: p.over_ai } : null;
const pkgOut = (p: PkgRow | null) => p ? { id: p.id, code: p.code, name_th: p.name_th, price_year: p.price_year, status: p.status } : null;
/** รายงานของลูกค้าหนึ่งราย (ลูกค้าเห็นของตัวเอง · ผู้ให้บริการเห็นทุกราย + ขนาดข้อมูลโดยประมาณ + ส่วนเกิน) */
export async function tenantReport(db: Db, tenantId: string, month: string, provider: boolean) {
  const plan = await tenantLimits(db, tenantId);
  if (!plan) throw notFound('ลูกค้าผู้ใช้บริการ');
  const { usage, companies, ai_cost_usd } = await tenantUsage(db, tenantId, month, { dbSize: provider });
  const rows = quotaRows(plan.limits, usage);
  const base = {
    month, tenant: { id: plan.tenant.id, code: plan.tenant.code, name: plan.tenant.name, status: plan.tenant.status }, package: pkgOut(plan.pkg),
    over_action: plan.tenant.over_action, limits: plan.limits, usage, rows, level: worstLevel(rows), companies, docs_definition: DOCS_DEFINITION,
    // ผู้จ่ายค่า AI (HANDOFF 190): C = ลูกค้าจ่ายเอง (AI ไม่นับโควตา ไม่คิดส่วนเกิน) · P = WTS จ่ายให้ (เพดานดอลลาร์ต่อเดือน)
    ai_payer: plan.tenant.ai_payer, ai_limit_usd: plan.tenant.ai_payer === 'P' ? plan.tenant.ai_limit_usd : null, ai_cost_usd,
  };
  return provider ? { ...base, overage: overageLines(plan.pkg, plan.limits, usage, rates(plan.pkg)) } : base;
}

const intOpt = z.union([z.number(), z.string()]).nullable().optional().transform((v, ctx) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) { ctx.addIssue({ code: 'custom', message: 'ต้องเป็นจำนวนเต็มตั้งแต่ 0 (ว่าง = ไม่จำกัด)' }); return z.NEVER; }
  return n;
});
const money = z.union([z.number(), z.string()]).transform((v, ctx) => {
  const s = String(v).replace(/,/g, '').trim() || '0';
  if (!/^\d+(\.\d{1,2})?$/.test(s)) { ctx.addIssue({ code: 'custom', message: 'จำนวนเงินไม่ถูกต้อง (ไม่ติดลบ ทศนิยมไม่เกิน 2 ตำแหน่ง)' }); return z.NEVER; }
  return s;
});
const pkgBody = z.object({
  code: z.string().trim().min(1, 'ป้อนรหัสแพ็กเกจ').max(20).regex(/^[A-Za-z0-9_-]+$/, 'รหัสใช้ A-Z 0-9 _ -').transform((v) => v.toUpperCase()),
  name_th: z.string().trim().min(1, 'ป้อนชื่อแพ็กเกจ').max(120), price_year: money,
  max_companies: intOpt, max_users: intOpt, docs_per_month: intOpt, file_quota_mb: intOpt, ai_per_month: intOpt,
  over_company_year: money, over_user_year: money, over_doc: money, over_file_gb_month: money, over_ai: money,
  status: z.enum(['A', 'I']).default('A'), sort_order: z.coerce.number().int().min(0).max(999).default(0), remark: z.string().trim().max(200).nullable().optional().transform((v) => v || null),
});

/** ช่องแพ็กเกจของลูกค้า (หน้าแก้ไขลูกค้า + อนุมัติใบสมัคร) — ไม่ส่ง = คงค่าเดิม · ว่าง = ตามแพ็กเกจ */
const intKeep = z.union([z.number(), z.string(), z.null()]).optional().transform((v, ctx) => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) { ctx.addIssue({ code: 'custom', message: 'ต้องเป็นจำนวนเต็มตั้งแต่ 0 (ว่าง = ตามแพ็กเกจ)' }); return z.NEVER; }
  return n;
});
export const TENANT_PACKAGE_FIELDS = {
  package_id: z.string().uuid().nullable().optional().or(z.literal('').transform(() => null)),
  docs_per_month: intKeep, file_quota_mb: intKeep, ai_per_month: intKeep,
  over_action: z.enum(['W', 'S']).optional(),
  /** ผู้จ่ายค่า AI (HANDOFF 190) — ผู้ให้บริการตั้งเท่านั้น · ไม่ส่ง = คงค่าเดิม */
  ai_payer: z.enum(['C', 'P'], { message: 'เลือกผู้จ่ายค่า AI: ลูกค้าจ่ายเอง หรือ WTS จ่ายให้' }).optional(),
  /** เพดานค่า AI ต่อเดือน (ดอลลาร์สหรัฐ) เมื่อ WTS จ่ายให้ · ว่าง = ไม่จำกัด · ไม่ส่ง = คงค่าเดิม */
  ai_limit_usd: z.union([z.number(), z.string(), z.null()]).optional().transform((v, ctx) => {
    if (v === undefined) return undefined;
    const t = v === null ? '' : String(v).replace(/,/g, '').trim();
    if (t === '') return null;
    if (!/^\d+(\.\d{1,2})?$/.test(t) || Number(t) > 100000) { ctx.addIssue({ code: 'custom', message: 'เพดานค่า AI เป็นดอลลาร์ ไม่ติดลบ ทศนิยมไม่เกิน 2 ตำแหน่ง ไม่เกิน 100,000 (ว่าง = ไม่จำกัด)' }); return z.NEVER; }
    return t;
  }),
};
/** แพ็กเกจที่เลือก → ตรวจว่ามีจริง + plan = รหัสแพ็กเกจ (ไม่ส่ง = ไม่เปลี่ยน) */
export async function packagePlan(db: Db, b: { package_id?: string | null }): Promise<{ package_id?: string | null; plan?: string }> {
  if (b.package_id === undefined) return {};
  if (b.package_id === null) return { package_id: null };
  const p = await packageOf(db, b.package_id);
  if (!p) throw badRequest('ไม่พบแพ็กเกจที่เลือก', [{ field: 'package_id', message: 'ไม่พบแพ็กเกจ' }]);
  return { package_id: p.id, plan: p.code };
}

/** ลูกค้า (ผู้ดูแลของลูกค้า) — ไม่ใช่ผู้ดูแล = 403 · เจ้าหน้าที่ผู้ให้บริการใช้หน้าของผู้ให้บริการ */
const customerAdmin = (req: FastifyRequest) => {
  const a = requireAuth(req);
  if (!a.isAdmin) throw forbidden('เฉพาะผู้ดูแลระบบของกิจการดูการใช้งานและแพ็กเกจได้');
  if (!a.tenantId) throw badRequest('เจ้าหน้าที่ผู้ให้บริการ: ดูการใช้งานของลูกค้าที่ แพ็กเกจและการใช้งานลูกค้า (ผู้ให้บริการ)');
  return { ...a, tenantId: a.tenantId };
};
const platform = (req: FastifyRequest) => { const a = requireAuth(req); if (!a.isPlatform) throw forbidden('เฉพาะเจ้าหน้าที่ผู้ให้บริการโปรแกรม'); return a; };

/** API ที่ใช้ไฟล์/AI — ตรวจโควตาก่อนเปิดทรานแซกชันของบริษัท */
function quotaKeyOf(method: string, url: string): 'files' | 'ai' | null {
  const k = `${method} ${url}`;
  if (k === 'PUT /api/v1/company-images/logo' || k === 'POST /api/v1/company-images/signs' || /^POST \/api\/v1\/[a-z-]+\/:id\/images$/.test(k)) return 'files';
  if (k === 'POST /api/v1/ai/read-bill' || k === 'POST /api/v1/ai/read-bill-text') return 'ai';
  return null;
}
const mb = (bytes: number) => (bytes / 1048576).toLocaleString('en-US', { maximumFractionDigits: 1 });
export async function enforceQuota(db: Db, companyId: string, key: 'files' | 'ai', addBytes = 0) {
  const co = await db.selectFrom('sys_company').select('tenant_id').where('id', '=', companyId).executeTakeFirst();
  if (!co?.tenant_id) return;
  const plan = await tenantLimits(db, co.tenant_id);
  if (!plan || plan.tenant.over_action !== 'S') return;
  const { usage } = await tenantUsage(db, co.tenant_id, thisMonthTh());
  if (!quotaBlocked(key, plan.limits, usage, addBytes)) return;
  throw new AppError(403, 'QUOTA_STOP', key === 'files'
    ? `พื้นที่ไฟล์ของกิจการเต็มแล้ว (ใช้ ${mb(usage.file_bytes)} จาก ${plan.limits.file_mb?.toLocaleString('en-US')} MB · ตั้งให้หยุดเมื่อครบ) — ลบรูปที่ไม่ใช้แล้ว หรือติดต่อผู้ให้บริการเพื่อเพิ่มพื้นที่/เปลี่ยนแพ็กเกจ`
    : `อ่านบิลด้วย AI ครบ ${plan.limits.ai?.toLocaleString('en-US')} บิลของเดือนนี้แล้ว (ตั้งให้หยุดเมื่อครบ) — คีย์เอกสารเองได้ตามปกติ หรือติดต่อผู้ให้บริการเพื่อเพิ่มจำนวน/เปลี่ยนแพ็กเกจ`);
}

export function usageRoutes(app: FastifyInstance, db: Db) {
  // โควตาไฟล์/AI (โหมด "หยุด") — ก่อนตัวจัดการ (และก่อนทรานแซกชันของบริษัท) · ไม่เกี่ยวกับเอกสาร
  app.addHook('preHandler', async (req) => {
    if (!req.url.startsWith('/api/') || !req.auth?.companyId) return;
    const url = req.routeOptions?.url;
    const key = url ? quotaKeyOf(req.method, url) : null;
    if (!key) return;
    const data = (req.body as { data?: unknown } | undefined)?.data;
    const add = key === 'files' && typeof data === 'string' ? Math.floor((data.length - Math.max(0, data.indexOf(',') + 1)) * 3 / 4) : 0;
    await enforceQuota(db, req.auth.companyId, key, add);
  });

  /** ลูกค้า: การใช้งานและแพ็กเกจของกิจการตัวเอง */
  app.get('/api/v1/usage', async (req) => {
    const a = customerAdmin(req);
    const q = parse(monthQ, req.query);
    return tenantReport(db, a.tenantId, q.month ?? thisMonthTh(), false);
  });
  /** แถบเตือนในโปรแกรม (ผู้ดูแลของลูกค้า): ระดับแย่ที่สุดของเดือนนี้ — ผู้ใช้อื่น/ผู้ให้บริการ = ไม่มี */
  app.get('/api/v1/usage/alert', async (req) => {
    const a = requireAuth(req);
    if (!a.isAdmin || !a.tenantId) return { level: 'none', rows: [] };
    const plan = await tenantLimits(db, a.tenantId);
    if (!plan) return { level: 'none', rows: [] };
    const { usage } = await tenantUsage(db, a.tenantId, thisMonthTh());
    const rows = quotaRows(plan.limits, usage).filter((r) => r.level === 'warn' || r.level === 'over');
    return { level: worstLevel(quotaRows(plan.limits, usage)), rows, over_action: plan.tenant.over_action };
  });

  /* ---------------------------------------------------------------- ผู้ให้บริการ */
  app.get('/api/v1/packages', async (req) => {
    platform(req);
    return db.selectFrom('sys_package').select([...PKG_COLS, sql<number>`(SELECT count(*) FROM sys_tenant t WHERE t.package_id = sys_package.id AND t.deleted_at IS NULL)`.as('tenants')])
      .where('deleted_at', 'is', null).orderBy('sort_order').orderBy('code').execute();
  });
  app.post('/api/v1/packages', async (req) => {
    const a = platform(req);
    const b = parse(pkgBody, req.body);
    if (await db.selectFrom('sys_package').select('id').where('code', '=', b.code).where('deleted_at', 'is', null).executeTakeFirst()) throw badRequest(`รหัสแพ็กเกจ ${b.code} มีอยู่แล้ว — ใช้รหัสอื่น`, [{ field: 'code', message: 'รหัสซ้ำ' }]);
    const r = await db.insertInto('sys_package').values({ ...b, created_by: a.userId } as never).returning('id').executeTakeFirstOrThrow();
    await logActivity(db, a, { module: 'SYS', action: 'ADD_PACKAGE', docNo: b.code, table: 'sys_package', rowId: r.id, detail: b });
    return { id: r.id };
  });
  app.put('/api/v1/packages/:id', async (req) => {
    const a = platform(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const b = parse(pkgBody, req.body);
    const cur = await packageOf(db, id);
    if (!cur) throw notFound('แพ็กเกจ');
    if (await db.selectFrom('sys_package').select('id').where('code', '=', b.code).where('id', '<>', id).where('deleted_at', 'is', null).executeTakeFirst()) throw badRequest(`รหัสแพ็กเกจ ${b.code} มีอยู่แล้ว — ใช้รหัสอื่น`, [{ field: 'code', message: 'รหัสซ้ำ' }]);
    await db.updateTable('sys_package').set({ ...b, updated_by: a.userId } as never).where('id', '=', id).execute();
    if (cur.code !== b.code) await db.updateTable('sys_tenant').set({ plan: b.code }).where('package_id', '=', id).execute();
    await logActivity(db, a, { module: 'SYS', action: 'EDIT_PACKAGE', docNo: b.code, table: 'sys_package', rowId: id, detail: { before: cur, after: b } });
    return { id };
  });
  /** การใช้งานทุกลูกค้า (เดือนที่เลือก) */
  app.get('/api/v1/admin/usage', async (req) => {
    platform(req);
    const q = parse(monthQ, req.query);
    const month = q.month ?? thisMonthTh();
    const ts = await db.selectFrom('sys_tenant').select('id').where('deleted_at', 'is', null).where('purged_at', 'is', null).orderBy('code').execute();
    const rows = [];
    for (const t of ts) rows.push(await tenantReport(db, t.id, month, true));
    return { month, rows };
  });
  app.get('/api/v1/admin/usage/:tenantId', async (req) => {
    platform(req);
    const { tenantId } = parse(z.object({ tenantId: z.string().uuid() }), req.params);
    const q = parse(monthQ, req.query);
    return tenantReport(db, tenantId, q.month ?? thisMonthTh(), true);
  });
}
