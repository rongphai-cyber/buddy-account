import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { sql } from 'kysely';
import { z } from 'zod';
import { checkTaxId } from '@buddy/core';
import type { Database, Db } from '../db.js';
import { AppError, badRequest, forbidden, notFound, parse, requireAuth, requireCompany, type AuthContext } from '../http.js';
import { canAccessCompany, companiesForUser } from './auth.js';
import { logActivity } from '../audit.js';
import { applyPostingTemplate, companySettings, createFiscalYear, seedChart, seedDocTypes, setSetting } from '../company-template.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ไม่ถูกต้อง');
const uuid = z.string().uuid();
const opt = (n: number) => z.string().trim().max(n).nullable().optional();

export function companyRoutes(app: FastifyInstance, database: Database) {
  const db: Db = database.db;

  /* ---------------------------------------------------------------- รายละเอียดกิจการ (บทที่ 5 S-SET-01) */
  app.get('/api/v1/company', async (req) => {
    const a = requireCompany(req);
    const c = await db.selectFrom('sys_company').selectAll().where('id', '=', a.companyId).executeTakeFirstOrThrow();
    const hq = await db.selectFrom('sys_branch').select(['id', 'tax_branch_no', 'name']).where('company_id', '=', a.companyId).where('is_head_office', '=', true).where('deleted_at', 'is', null).executeTakeFirst();
    const s = await companySettings(db, a.companyId);
    const [addr1, ...addr2] = (c.address_th ?? '').split('\n');
    const [addrEn1, ...addrEn2] = (c.address_en ?? '').split('\n');
    return {
      id: c.id, code: c.code, name_th: c.name_th, name_en: c.name_en, address_th_1: addr1 ?? '', address_th_2: addr2.join(' '), address_en_1: addrEn1 ?? '', address_en_2: addrEn2.join(' '),
      phone: c.phone, tax_id: c.tax_id, trade_reg_no: c.trade_reg_no, social_security_no: c.social_security_no, year_system: c.year_system,
      tax_branch_no: hq?.tax_branch_no ?? '00000', business_type: s['gen.business_type'] ?? 'J', branch_short_name: s['gen.branch_short_name'] ?? '',
      allow_blank_party_tax_id: s['gen.allow_blank_party_tax_id'] ?? true, vat_rate: s['gen.vat_rate'] ?? 7, account_mask: s['gl.account_mask'] ?? '9999-99',
      voucher_numbering: s['gl.voucher_numbering'] ?? '4', use_department: s['gen.use_department'] ?? true, posting_method: s['ic.posting_method'] ?? 'PERIODIC',
    };
  });

  const companyBody = z.object({
    name_th: z.string().trim().min(1, 'ป้อนชื่อบริษัท').max(120), name_en: opt(120),
    address_th_1: opt(120), address_th_2: opt(120), address_en_1: opt(120), address_en_2: opt(120), phone: opt(60),
    business_type: z.enum(['J', 'P']), tax_id: z.string().trim().min(1, 'ป้อนเลขประจำตัวผู้เสียภาษี'),
    tax_branch_no: z.string().trim().regex(/^\d{1,5}$/, 'สาขา# เป็นตัวเลข (สำนักงานใหญ่ = 0)'),
    branch_short_name: opt(30), allow_blank_party_tax_id: z.boolean(), trade_reg_no: opt(20), social_security_no: opt(20),
    year_system: z.enum(['B', 'C']), vat_rate: z.coerce.number().min(0).max(100), account_mask: z.string().trim().min(1).max(20),
    voucher_numbering: z.enum(['4', 'M']), use_department: z.boolean(),
  });
  app.put('/api/v1/company', async (req) => {
    const a = requireCompany(req);
    const b = parse(companyBody, req.body);
    const tax = checkTaxId(b.tax_id);
    if (!tax.ok) throw badRequest(tax.error, [{ field: 'tax_id', message: tax.error }]);
    const join = (x?: string | null, y?: string | null) => [x, y].filter((s) => s && s.trim()).join('\n') || null;
    await db.transaction().execute(async (tx) => {
      await tx.updateTable('sys_company').set({
        name_th: b.name_th, name_en: b.name_en ?? null, address_th: join(b.address_th_1, b.address_th_2), address_en: join(b.address_en_1, b.address_en_2),
        phone: b.phone ?? null, tax_id: tax.normalized, trade_reg_no: b.trade_reg_no ?? null, social_security_no: b.social_security_no ?? null, year_system: b.year_system, updated_by: a.userId,
      }).where('id', '=', a.companyId).execute();
      await tx.updateTable('sys_branch').set({ tax_branch_no: b.tax_branch_no.padStart(5, '0') }).where('company_id', '=', a.companyId).where('is_head_office', '=', true).execute();
      const set = (k: string, v: unknown) => setSetting(tx, a.companyId, k, v, a.userId);
      await set('gen.business_type', b.business_type); await set('gen.branch_short_name', b.branch_short_name ?? '');
      await set('gen.allow_blank_party_tax_id', b.allow_blank_party_tax_id); await set('gen.year_system', b.year_system);
      await set('gen.vat_rate', b.vat_rate); await set('gl.account_mask', b.account_mask); await set('gl.voucher_numbering', b.voucher_numbering);
      await set('gen.use_department', b.use_department);
      await logActivity(tx, a, { module: 'SYS', action: 'EDIT', table: 'sys_company', rowId: a.companyId });
    });
    return { ok: true, warning: tax.kind === 'LEGACY10' ? tax.warning : undefined };
  });

  /* ---------------------------------------------------------------- กำหนดบริษัทใหม่ (บทที่ 4 S-CO-03 / S-CO-07) */
  app.post('/api/v1/companies', async (req) => {
    const a = requireAuth(req);
    if (!a.isAdmin) throw forbidden('เฉพาะผู้ดูแลระบบสร้างบริษัทใหม่ได้');
    const b = parse(z.object({
      code: z.string().trim().min(1, 'ป้อนรหัสบริษัท').max(20).regex(/^[A-Za-z0-9_-]+$/, 'รหัสบริษัทใช้ตัวอักษรอังกฤษ ตัวเลข _ -'),
      name_th: z.string().trim().min(1, 'ป้อนชื่อบริษัท').max(120), tax_id: z.string().trim().optional(),
      fiscal_start: isoDate, chart: z.enum(['express', 'th_en', 'copy', 'none']).default('express'), copy_from_company_id: uuid.optional(),
      tenant_id: uuid.optional(),
    }), req.body);
    // ผู้ดูแลของลูกค้าสร้างได้เฉพาะใน tenant ตัวเอง; ผู้ให้บริการเลือก tenant ได้ (ไม่ระบุ = ลูกค้าเริ่มต้น)
    const tenantId = a.isPlatform ? (b.tenant_id ?? (await defaultTenant(db))) : a.tenantId!;
    const t = await db.selectFrom('sys_tenant').select(['id', 'max_companies', 'status']).where('id', '=', tenantId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!t) throw badRequest('ไม่พบลูกค้าผู้ใช้บริการ');
    if (t.max_companies !== null) {
      const n = await db.selectFrom('sys_company').select(sql<number>`count(*)`.as('n')).where('tenant_id', '=', tenantId).where('deleted_at', 'is', null).executeTakeFirstOrThrow();
      if (Number(n.n) >= t.max_companies) throw badRequest(`แพ็กเกจนี้สร้างบริษัทได้สูงสุด ${t.max_companies} บริษัท`);
    }
    if (b.copy_from_company_id && !(await canAccessCompany(db, a, b.copy_from_company_id))) throw forbidden('ไม่มีสิทธิ์คัดลอกจากบริษัทนี้');
    const exists = await db.selectFrom('sys_company').select('id').where('code', '=', b.code).where('deleted_at', 'is', null).executeTakeFirst();
    if (exists) throw badRequest(`รหัสบริษัท ${b.code} มีอยู่แล้ว`);
    let taxId: string | null = null;
    if (b.tax_id) { const tx = checkTaxId(b.tax_id); if (!tx.ok) throw badRequest(tx.error); taxId = tx.normalized; }
    const id = await db.transaction().execute(async (tx) => {
      const c = await tx.insertInto('sys_company').values({ tenant_id: tenantId, code: b.code, name_th: b.name_th, tax_id: taxId, created_by: a.userId }).returning('id').executeTakeFirstOrThrow();
      await tx.insertInto('sys_branch').values({ company_id: c.id, code: '00000', name: 'สำนักงานใหญ่', tax_branch_no: '00000', is_head_office: true, created_by: a.userId }).execute();
      await createFiscalYear(tx, c.id, b.fiscal_start, a.userId);
      await seedChart(tx, c.id, { chart: b.chart === 'express' || b.chart === 'th_en' ? b.chart : null });
      await seedDocTypes(tx, c.id);
      if (b.chart === 'copy') {
        if (!b.copy_from_company_id) throw badRequest('เลือกบริษัทต้นแบบที่จะคัดลอก');
        await copyChart(tx, b.copy_from_company_id, c.id);
      }
      await logActivity(tx, { companyId: c.id, userId: a.userId }, { module: 'SYS', action: 'NEW_COMPANY', table: 'sys_company', rowId: c.id, detail: { code: b.code, tenant_id: tenantId } });
      return c.id;
    });
    await applyPostingTemplate(database.execScript, id);
    return { id };
  });

  /* ---------------------------------------------------------------- สาขา */
  app.get('/api/v1/branches', async (req) => {
    const a = requireCompany(req);
    return db.selectFrom('sys_branch').select(['id', 'code', 'name', 'tax_branch_no', 'address', 'is_head_office', 'status']).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).orderBy('code').execute();
  });
  const branchBody = z.object({ code: z.string().trim().min(1, 'ป้อนรหัสสาขา').max(10), name: z.string().trim().min(1, 'ป้อนชื่อสาขา').max(120), tax_branch_no: z.string().trim().regex(/^\d{5}$/, 'เลขที่สาขา 5 หลัก เช่น 00001'), address: z.string().max(500).nullable().optional(), status: z.enum(['A', 'I']).default('A') });
  app.post('/api/v1/branches', async (req) => {
    const a = requireCompany(req);
    const b = parse(branchBody, req.body);
    const r = await db.insertInto('sys_branch').values({ ...b, address: b.address ?? null, company_id: a.companyId, is_head_office: false, created_by: a.userId }).returning('id').executeTakeFirstOrThrow();
    await logActivity(db, a, { module: 'SYS', action: 'ADD', docNo: b.code, table: 'sys_branch', rowId: r.id });
    return r;
  });
  app.put('/api/v1/branches/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(branchBody, req.body);
    const r = await db.updateTable('sys_branch').set({ ...b, address: b.address ?? null, updated_by: a.userId }).where('id', '=', id).where('company_id', '=', a.companyId).executeTakeFirst();
    if (!Number(r.numUpdatedRows)) throw notFound('สาขา');
    return { id };
  });

  /* ---------------------------------------------------------------- ผู้ใช้งาน (บทที่ 23 S-SEC-01/02) — เห็นและแก้ได้เฉพาะผู้ใช้ใน tenant ตัวเอง */
  const requireAdmin = (req: Parameters<typeof requireAuth>[0]) => { const a = requireAuth(req); if (!a.isAdmin) throw forbidden('เฉพาะผู้ดูแลระบบ'); return a; };
  /** tenant ที่ผู้ดูแลคนนี้จัดการได้: ผู้ให้บริการระบุได้ทุก tenant (ว่าง = เจ้าหน้าที่ผู้ให้บริการ), ลูกค้าได้เฉพาะของตัวเอง */
  const scopeTenant = (a: AuthContext, requested?: string | null) => (a.isPlatform ? (requested === undefined ? a.tenantId : requested) : a.tenantId);
  /**
   * ผู้ให้บริการที่ไม่ได้ระบุลูกค้า: ใช้ลูกค้าเจ้าของบริษัทที่ให้สิทธิ์ (หรือบริษัทที่เลือกอยู่) — กันกรณีเพิ่มผู้ใช้/กลุ่มให้บริษัทของลูกค้าแล้วถูกปฏิเสธ
   * ระบุ tenant_id: null ตรง ๆ = เจ้าหน้าที่ผู้ให้บริการ
   */
  async function tenantFor(a: AuthContext, requested: string | null | undefined, companies: string[] = []) {
    if (!a.isPlatform || requested !== undefined) return scopeTenant(a, requested) ?? null;
    const ids = companies.length ? companies : a.companyId ? [a.companyId] : [];
    if (!ids.length) return null;
    const ts = [...new Set((await db.selectFrom('sys_company').select('tenant_id').where('id', 'in', ids).execute()).map((c) => c.tenant_id))];
    if (ts.length > 1) throw badRequest('บริษัทที่ให้สิทธิ์ต้องเป็นของลูกค้ารายเดียวกัน');
    return ts[0] ?? null;
  }

  app.get('/api/v1/users', async (req) => {
    const a = requireAdmin(req);
    let uq = db.selectFrom('sys_user as u').leftJoin('sys_user_group as g', 'g.id', 'u.user_group_id').leftJoin('sys_tenant as t', 't.id', 'u.tenant_id')
      .select(['u.id', 'u.username', 'u.display_name', 'u.status', 'u.approval_level', 'u.check_rights', 'u.last_login_at', 'u.user_group_id', 'u.tenant_id', 't.code as tenant_code', 'g.code as group_code', 'g.name as group_name'])
      .where('u.deleted_at', 'is', null);
    let gq = db.selectFrom('sys_user_group').select(['id', 'code', 'name', 'tenant_id']).where('deleted_at', 'is', null);
    if (!a.isPlatform) { uq = uq.where('u.tenant_id', '=', a.tenantId!); gq = gq.where('tenant_id', '=', a.tenantId!); }
    const users = await uq.orderBy('u.username').execute();
    const links = users.length ? await db.selectFrom('sys_user_company').select(['user_id', 'company_id']).where('user_id', 'in', users.map((u) => u.id)).where('deleted_at', 'is', null).execute() : [];
    return { users: users.map((u) => ({ ...u, companies: links.filter((l) => l.user_id === u.id).map((l) => l.company_id) })), groups: await gq.orderBy('code').execute() };
  });
  const userBody = z.object({
    username: z.string().trim().min(1, 'ป้อนรหัสผู้ใช้').max(30).regex(/^[A-Za-z0-9_.@-]+$/, 'รหัสผู้ใช้ใช้ได้เฉพาะตัวอักษรอังกฤษ ตัวเลข _ . @ -'),
    display_name: z.string().trim().min(1, 'ป้อนชื่อผู้ใช้').max(120), password: z.string().min(8, 'รหัสผ่านอย่างน้อย 8 ตัวอักษร').optional(),
    user_group_id: uuid.nullable().optional(), approval_level: z.coerce.number().int().min(0).max(9).default(0), check_rights: z.boolean().default(false), status: z.enum(['A', 'I']).default('A'),
    companies: z.array(uuid).default([]), tenant_id: uuid.nullable().optional(),
  });
  /** ตรวจว่ากลุ่มและบริษัทที่กำหนดให้ผู้ใช้อยู่ใน tenant เดียวกับผู้ใช้ — กันการให้สิทธิ์ข้ามลูกค้า */
  async function checkUserScope(tenantId: string | null, b: z.infer<typeof userBody>) {
    if (b.user_group_id) {
      const g = await db.selectFrom('sys_user_group').select('tenant_id').where('id', '=', b.user_group_id).executeTakeFirst();
      if (!g || (g.tenant_id ?? null) !== tenantId) throw badRequest('กลุ่มผู้ใช้ต้องเป็นของลูกค้ารายเดียวกับผู้ใช้');
    }
    if (b.companies.length) {
      const cs = await db.selectFrom('sys_company').select(['id', 'tenant_id']).where('id', 'in', b.companies).execute();
      if (cs.length !== b.companies.length || cs.some((c) => c.tenant_id !== tenantId)) throw badRequest('บริษัทที่ให้สิทธิ์ต้องเป็นของลูกค้ารายเดียวกับผู้ใช้');
    }
  }
  app.post('/api/v1/users', async (req) => {
    const a = requireAdmin(req);
    const b = parse(userBody, req.body);
    if (!b.password) throw badRequest('ป้อนรหัสผ่านเริ่มต้น');
    const tenantId = await tenantFor(a, b.tenant_id, b.companies);
    await checkUserScope(tenantId, b);
    if (tenantId) {
      const t = await db.selectFrom('sys_tenant').select('max_users').where('id', '=', tenantId).executeTakeFirst();
      if (t?.max_users != null) {
        const n = await db.selectFrom('sys_user').select(sql<number>`count(*)`.as('n')).where('tenant_id', '=', tenantId).where('deleted_at', 'is', null).executeTakeFirstOrThrow();
        if (Number(n.n) >= t.max_users) throw badRequest(`แพ็กเกจนี้มีผู้ใช้ได้สูงสุด ${t.max_users} คน`);
      }
    }
    return db.transaction().execute(async (tx) => {
      const u = await tx.insertInto('sys_user').values({ tenant_id: tenantId, username: b.username, display_name: b.display_name, password_hash: await bcrypt.hash(b.password!, 10), user_group_id: b.user_group_id ?? null, approval_level: b.approval_level, check_rights: b.check_rights, status: b.status, created_by: a.userId }).returning('id').executeTakeFirstOrThrow();
      for (const c of b.companies) await tx.insertInto('sys_user_company').values({ company_id: c, user_id: u.id, created_by: a.userId }).execute();
      await logActivity(tx, a, { module: 'SYS', action: 'ADD_USER', table: 'sys_user', rowId: u.id, detail: { username: b.username, tenant_id: tenantId } });
      return u;
    });
  });
  app.put('/api/v1/users/:id', async (req) => {
    const a = requireAdmin(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(userBody, req.body);
    const cur = await db.selectFrom('sys_user').select(['tenant_id']).where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
    if (!cur || (!a.isPlatform && cur.tenant_id !== a.tenantId)) throw notFound('ผู้ใช้');
    if (id === a.userId && b.status === 'I') throw badRequest('ปิดการใช้งานบัญชีของตัวเองไม่ได้');
    await checkUserScope(cur.tenant_id, b);
    await db.transaction().execute(async (tx) => {
      const patch: Record<string, unknown> = { username: b.username, display_name: b.display_name, user_group_id: b.user_group_id ?? null, approval_level: b.approval_level, check_rights: b.check_rights, status: b.status, updated_by: a.userId };
      if (b.password) patch.password_hash = await bcrypt.hash(b.password, 10);
      await tx.updateTable('sys_user').set(patch).where('id', '=', id).execute();
      await tx.deleteFrom('sys_user_company').where('user_id', '=', id).execute();
      for (const c of b.companies) await tx.insertInto('sys_user_company').values({ company_id: c, user_id: id, created_by: a.userId }).execute();
      if (b.status === 'I' || b.password) await tx.updateTable('sys_session').set({ ended_at: sql`now()` as never }).where('user_id', '=', id).where('ended_at', 'is', null).where('id', '<>', a.sessionId).execute();
      await logActivity(tx, a, { module: 'SYS', action: 'EDIT_USER', table: 'sys_user', rowId: id, detail: { password_changed: !!b.password } });
      // ตั้งรหัสผ่านให้ผู้ใช้อื่น (S-SEC-06 กรณีลืมรหัสผ่าน) — แยกเหตุการณ์ไว้ในรายงานการใช้รหัสผ่าน
      if (b.password && id !== a.userId) await logActivity(tx, a, { module: 'SYS', action: 'RESET_PASSWORD', docNo: b.username, table: 'sys_user', rowId: id });
    });
    return { id };
  });
  app.post('/api/v1/user-groups', async (req) => {
    const a = requireAdmin(req);
    const b = parse(z.object({ code: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9_-]+$/), name: z.string().trim().min(1).max(120), tenant_id: uuid.nullable().optional() }), req.body);
    return db.insertInto('sys_user_group').values({ code: b.code, name: b.name, tenant_id: await tenantFor(a, b.tenant_id), created_by: a.userId }).returning('id').executeTakeFirstOrThrow();
  });

  /* ---------------------------------------------------------------- ลูกค้าผู้ใช้บริการ (tenant) — เฉพาะเจ้าหน้าที่ผู้ให้บริการ */
  const requirePlatform = (req: Parameters<typeof requireAuth>[0]) => { const a = requireAuth(req); if (!a.isPlatform) throw forbidden('เฉพาะเจ้าหน้าที่ผู้ให้บริการโปรแกรม'); return a; };
  app.get('/api/v1/tenants', async (req) => {
    requirePlatform(req);
    return db.selectFrom('sys_tenant as t').select(['t.id', 't.code', 't.name', 't.contact_email', 't.contact_phone', 't.plan', 't.max_companies', 't.max_users', 't.expires_on', 't.status',
      sql<number>`(SELECT count(*) FROM sys_company c WHERE c.tenant_id = t.id AND c.deleted_at IS NULL)`.as('company_count'),
      sql<number>`(SELECT count(*) FROM sys_user u WHERE u.tenant_id = t.id AND u.deleted_at IS NULL)`.as('user_count')])
      .where('t.deleted_at', 'is', null).orderBy('t.code').execute();
  });
  const tenantBody = z.object({
    code: z.string().trim().min(1, 'ป้อนรหัสลูกค้า').max(20).regex(/^[A-Za-z0-9_-]+$/), name: z.string().trim().min(1, 'ป้อนชื่อลูกค้า').max(120),
    contact_email: z.string().trim().email('อีเมลไม่ถูกต้อง').nullable().optional(), contact_phone: opt(60), plan: z.string().trim().max(20).default('standard'),
    max_companies: z.coerce.number().int().min(1).nullable().optional(), max_users: z.coerce.number().int().min(1).nullable().optional(),
    expires_on: isoDate.nullable().optional(), status: z.enum(['A', 'S', 'I']).default('A'),
  });
  /** สร้างลูกค้าใหม่ + กลุ่ม ADMIN ของลูกค้า + ผู้ดูแลคนแรกของลูกค้า */
  app.post('/api/v1/tenants', async (req) => {
    const a = requirePlatform(req);
    const b = parse(tenantBody.extend({ admin_username: userBody.shape.username, admin_name: userBody.shape.display_name, admin_password: z.string().min(8, 'รหัสผ่านอย่างน้อย 8 ตัวอักษร') }), req.body);
    return db.transaction().execute(async (tx) => {
      const t = await tx.insertInto('sys_tenant').values({ code: b.code, name: b.name, contact_email: b.contact_email ?? null, contact_phone: b.contact_phone ?? null, plan: b.plan, max_companies: b.max_companies ?? null, max_users: b.max_users ?? null, expires_on: b.expires_on ?? null, status: b.status, created_by: a.userId }).returning('id').executeTakeFirstOrThrow();
      const g = await tx.insertInto('sys_user_group').values({ tenant_id: t.id, code: 'ADMIN', name: 'ผู้ดูแลระบบของลูกค้า', created_by: a.userId }).returning('id').executeTakeFirstOrThrow();
      await tx.insertInto('sys_user').values({ tenant_id: t.id, username: b.admin_username, display_name: b.admin_name, password_hash: await bcrypt.hash(b.admin_password, 10), user_group_id: g.id, approval_level: 9, created_by: a.userId }).execute();
      await logActivity(tx, a, { module: 'SYS', action: 'NEW_TENANT', table: 'sys_tenant', rowId: t.id, detail: { code: b.code } });
      return t;
    });
  });
  app.put('/api/v1/tenants/:id', async (req) => {
    const a = requirePlatform(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(tenantBody, req.body);
    const r = await db.updateTable('sys_tenant').set({ ...b, contact_email: b.contact_email ?? null, contact_phone: b.contact_phone ?? null, max_companies: b.max_companies ?? null, max_users: b.max_users ?? null, expires_on: b.expires_on ?? null, updated_by: a.userId }).where('id', '=', id).executeTakeFirst();
    if (!Number(r.numUpdatedRows)) throw notFound('ลูกค้าผู้ใช้บริการ');
    if (b.status !== 'A') await db.updateTable('sys_session').set({ ended_at: sql`now()` as never }).where('ended_at', 'is', null).where('user_id', 'in', db.selectFrom('sys_user').select('id').where('tenant_id', '=', id)).execute();
    await logActivity(db, a, { module: 'SYS', action: 'EDIT_TENANT', table: 'sys_tenant', rowId: id, detail: { status: b.status } });
    return { id };
  });

  /* ---------------------------------------------------------------- แฟ้มบันทึกเหตุการณ์ (บทที่ 23 S-SEC-04) — อ่านอย่างเดียว */
  app.get('/api/v1/activity-log', async (req) => {
    const a = requireAuth(req);
    const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(500).default(100), table: z.string().optional(), row_id: uuid.optional() }), req.query);
    let s = db.selectFrom('sys_activity_log as l').leftJoin('sys_user as u', 'u.id', 'l.user_id')
      .select(['l.seq', 'l.occurred_at', 'l.module', 'l.action', 'l.doc_no', 'l.table_name', 'l.row_id', 'l.detail', 'u.username', 'u.display_name']);
    if (!a.isAdmin) s = s.where('l.user_id', '=', a.userId);
    if (!a.isPlatform) {
      // ลูกค้าเห็นเฉพาะเหตุการณ์ของบริษัทใน tenant ตัวเอง และเหตุการณ์ของผู้ใช้ใน tenant ตัวเอง
      const ids = (await companiesForUser(db, a)).map((c) => c.id);
      s = s.where((eb) => eb.or([eb('l.company_id', 'in', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']), eb.and([eb('l.company_id', 'is', null), eb('u.tenant_id', '=', a.tenantId)])]));
    }
    if (a.companyId) s = s.where((eb) => eb.or([eb('l.company_id', '=', a.companyId), eb('l.company_id', 'is', null)]));
    if (q.table) s = s.where('l.table_name', '=', q.table);
    if (q.row_id) s = s.where('l.row_id', '=', q.row_id);
    return s.orderBy('l.seq', 'desc').limit(q.limit).execute();
  });

  /**
   * แฟ้มบันทึกเหตุการณ์ทำงาน (คู่มือบทที่ 23 S-SEC-04 / 04a) — เรียกดูตามเงื่อนไข แทนนิพจน์ FoxPro ของ Express
   * กลุ่มรายงาน: all ทั้งหมด · audit แก้ไขปรับปรุงรายการ · password การใช้รหัสผ่าน · restore การสำรอง/ดึงข้อมูลสำรองมาใช้
   * แฟ้มนี้เพิ่มได้อย่างเดียว (ลบ/แก้ไม่ได้ — กรมสรรพากรกำหนดให้เก็บอย่างน้อย 2 ปี)
   */
  const PASSWORD_ACTS = ['LOGIN', 'LOGIN_FAIL', 'LOGOUT', 'PASSWORD', 'RESET_PASSWORD', 'EDIT_USER'];
  const RESTORE_ACTS = ['BACKUP', 'RESTORE', 'BACKUP_USERS', 'RESTORE_USERS'];
  app.get('/api/v1/activity-log/search', async (req) => {
    const a = requireAuth(req);
    const q = parse(z.object({ kind: z.enum(['all', 'audit', 'password', 'restore']).default('all'), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      time_from: z.string().regex(/^\d{2}:\d{2}$/).optional(), time_to: z.string().regex(/^\d{2}:\d{2}$/).optional(), user: z.string().trim().max(30).optional(), action: z.string().trim().max(20).optional(),
      module: z.string().trim().max(10).optional(), doc_no: z.string().trim().max(30).optional(), q: z.string().trim().max(100).optional(), limit: z.coerce.number().int().min(1).max(5000).default(1000) }), req.query);
    let s = db.selectFrom('sys_activity_log as l').leftJoin('sys_user as u', 'u.id', 'l.user_id').leftJoin('sys_user as au', 'au.id', 'l.auth_user_id').leftJoin('sys_company as c', 'c.id', 'l.company_id')
      .select(['l.seq', 'l.occurred_at', 'l.module', 'l.action', 'l.doc_no', 'l.table_name', 'l.row_id', 'l.detail', 'u.username', 'u.display_name', 'au.username as auth_username', 'c.code as company_code']);
    if (!a.isPlatform) {
      const ids = (await companiesForUser(db, a)).map((c) => c.id);
      s = s.where((eb) => eb.or([eb('l.company_id', 'in', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']), eb.and([eb('l.company_id', 'is', null), eb('u.tenant_id', '=', a.tenantId)])]));
    }
    if (a.companyId) s = s.where((eb) => eb.or([eb('l.company_id', '=', a.companyId), eb('l.company_id', 'is', null)]));
    if (q.kind === 'password') s = s.where('l.action', 'in', PASSWORD_ACTS);
    else if (q.kind === 'restore') s = s.where('l.action', 'in', RESTORE_ACTS);
    else if (q.kind === 'audit') s = s.where('l.action', 'not in', [...PASSWORD_ACTS, ...RESTORE_ACTS, 'PRINT', 'REPRINT']).where('l.action', 'not like', 'USE_%');
    if (q.from) s = s.where(sql<boolean>`(l.occurred_at AT TIME ZONE 'Asia/Bangkok')::date >= ${q.from}::date`);
    if (q.to) s = s.where(sql<boolean>`(l.occurred_at AT TIME ZONE 'Asia/Bangkok')::date <= ${q.to}::date`);
    if (q.time_from) s = s.where(sql<boolean>`to_char(l.occurred_at AT TIME ZONE 'Asia/Bangkok', 'HH24:MI') >= ${q.time_from}`);
    if (q.time_to) s = s.where(sql<boolean>`to_char(l.occurred_at AT TIME ZONE 'Asia/Bangkok', 'HH24:MI') <= ${q.time_to}`);
    if (q.user) s = s.where('u.username', 'ilike', q.user);
    if (q.action) s = s.where('l.action', '=', q.action.toUpperCase());
    if (q.module) s = s.where('l.module', 'ilike', q.module);
    if (q.doc_no) s = s.where('l.doc_no', 'ilike', `${q.doc_no}%`);
    if (q.q) s = s.where(sql<boolean>`l.detail::text ILIKE ${'%' + q.q + '%'}`);
    const rows = await s.orderBy('l.seq', 'desc').limit(q.limit + 1).execute();
    return { rows: rows.slice(0, q.limit), truncated: rows.length > q.limit };
  });
}

async function defaultTenant(db: Db) {
  const t = await db.selectFrom('sys_tenant').select('id').where('code', '=', 'DEFAULT').where('deleted_at', 'is', null).executeTakeFirst();
  if (t) return t.id;
  return (await db.insertInto('sys_tenant').values({ code: 'DEFAULT', name: 'ลูกค้าเริ่มต้น' }).returning('id').executeTakeFirstOrThrow()).id;
}

async function copyChart(tx: Db, fromId: string, toId: string) {
  const src = await tx.selectFrom('gl_account').selectAll().where('company_id', '=', fromId).where('deleted_at', 'is', null).orderBy('level').orderBy('account_no').execute();
  if (!src.length) throw new AppError(400, 'EMPTY_CHART', 'บริษัทต้นแบบไม่มีผังบัญชี');
  const map = new Map<string, string>();
  for (const s of src) {
    const r = await tx.insertInto('gl_account').values({
      company_id: toId, account_no: s.account_no, name_th: s.name_th, name_en: s.name_en, parent_id: s.parent_id ? map.get(s.parent_id) ?? null : null,
      level: s.level, account_group: s.account_group, is_control: s.is_control, normal_side: s.normal_side, use_department: s.use_department, use_project: s.use_project, status: s.status,
    }).returning('id').executeTakeFirstOrThrow();
    map.set(s.id, r.id);
  }
  const roles = await tx.selectFrom('gl_default_account').select(['role', 'account_id']).where('company_id', '=', fromId).where('deleted_at', 'is', null).execute();
  for (const r of roles) if (map.has(r.account_id)) await tx.insertInto('gl_default_account').values({ company_id: toId, role: r.role, account_id: map.get(r.account_id)! }).execute();
}
